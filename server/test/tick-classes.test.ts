/**
 * The tick, now that the server serves only devices (2f switchover, B1): it
 * polls the followed classes' sites and exam calendars and pushes their
 * changes, and touches no table but the class ones. The single owner's
 * sources, settings, read models and summaries are gone with their tables'
 * last reader, so a tick on a database without them works the same. It also
 * empties the friends' invites and replies that nobody answered into marks, and
 * forgets the boxes (marks too) that have gone stale (`buddy_box`). The chat
 * connection's own cleanup has its suite (`chat-cleanup.test.ts`); here its
 * tables only have to be there and quiet.
 */
import { describe, expect, it } from 'vitest';
import type { Services } from '../src/services.js';
import { loadEnv } from '../src/env.js';
import { RecordingPusher } from '../src/notify/push.js';
import { runTick } from '../src/sync/tick.js';

/** The chat connection's tables, which the tick only sweeps (`chat-cleanup.test.ts`). */
const CHAT_TABLES = ['chatCode', 'chatAuthCode', 'chatToken', 'chatGrant', 'chatClient', 'chatSnapshot', 'chatAttempt'];
/** The tables the tick may read and write; any other model is a test failure. */
const CLASS_TABLES = new Set(['schoolClass', 'device', 'classFollow', 'classSnapshot', 'classChangeEvent', 'deviceNotification', 'buddyBox', ...CHAT_TABLES, '$transaction']);

const SITE = 'https://dugma.shahaf.site';
const CALENDAR = 'exams@group.calendar.google.com';
// Tuesday 27.10.2026: 10:00 and 03:00 in Jerusalem, inside and outside the active window.
const IN_WINDOW = new Date('2026-10-27T08:00:00Z');
const AT_NIGHT = new Date('2026-10-27T01:00:00Z');

type Args = { where?: Record<string, unknown>; data?: Record<string, unknown> };
type Handler = (args: Args) => unknown;

/**
 * A friend's box, as far as the cleanup reads it; `ciphertext` `''` is the mark a used link leaves.
 * `writerDeviceId` is `null` once its device is gone. The sweep never asks who wrote a box, so the
 * stand-in refuses a query that does.
 */
type BoxRow = { id: string; kind: string; ciphertext: string; createdAt: Date; updatedAt: Date; writerDeviceId?: string | null };

/**
 * The `where` of `buddyBox.updateMany` and `deleteMany`: `OR` of clauses made of `kind: { in }`,
 * `ciphertext: { not }`, `createdAt: { lt }` and `updatedAt: { lt }`. Anything else is a failure, so
 * the stand-in cannot pass a query it misreads.
 */
function boxMatches(row: BoxRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Record<string, unknown>[]).some((clause) => boxMatches(row, clause));
    if (key === 'kind') return (value as { in: string[] }).in.includes(row.kind);
    if (key === 'ciphertext') return row.ciphertext !== (value as { not: string }).not;
    if (key === 'createdAt' || key === 'updatedAt') return row[key].getTime() < (value as { lt: Date }).lt.getTime();
    throw new Error(`the stand-in does not read ${key} in a buddy_box query`);
  });
}

function world(opts: { eventsFail?: boolean; boxesFail?: boolean; boxes?: BoxRow[] } = {}) {
  const calls: { model: string; op: string; args: Args }[] = [];
  const boxes = [...(opts.boxes ?? [])];
  /** The events that tell a class of its exam board. */
  const boardEvents: Record<string, unknown>[] = [];
  const handlers: Record<string, Record<string, Handler>> = {
    schoolClass: {
      // The exam-calendar query asks for classes with a calendar; the site query does not.
      findMany: (args) =>
        args.where && 'examCalendarId' in args.where
          ? [{ id: 'class-1', examCalendarId: CALENDAR }]
          : [{ id: 'class-1', shahafClassId: '36', lastOkAt: null, school: { shahafUrl: SITE } }],
      update: (args) => ({ id: (args.where as { id: string }).id }),
      // The class is told of its exam board once: the one place that says so is a conditional update that changes one row.
      updateMany: () => ({ count: 1 }),
      // ... and the event names the device that set the calendar (`examCalendarSetBy`), which is not told of its own board.
      findUnique: () => ({ examCalendarSetBy: 'dev-setter' }),
    },
    classSnapshot: { findMany: () => [] },
    classChangeEvent: {
      findMany: () => {
        if (opts.eventsFail) throw new Error('db down');
        return [];
      },
      create: (args) => {
        boardEvents.push(args.data ?? {});
        return {};
      },
    },
    deviceNotification: { deleteMany: () => ({ count: 0 }) },
    ...Object.fromEntries(CHAT_TABLES.map((table) => [table, { deleteMany: () => ({ count: 0 }) }])),
    buddyBox: {
      // `data` is `{ ciphertext, updatedAt }`: only what it names changes, as in Prisma.
      updateMany: (args) => {
        if (opts.boxesFail) throw new Error('boxes down');
        const hit = boxes.filter((b) => boxMatches(b, args.where ?? {}));
        for (const b of hit) Object.assign(b, args.data);
        return { count: hit.length };
      },
      deleteMany: (args) => {
        if (opts.boxesFail) throw new Error('boxes down');
        const gone = boxes.filter((b) => boxMatches(b, args.where ?? {}));
        for (const b of gone) boxes.splice(boxes.indexOf(b), 1);
        return { count: gone.length };
      },
    },
  };
  const prisma = new Proxy({}, {
    get(_target, model) {
      if (typeof model !== 'string') return undefined;
      if (!CLASS_TABLES.has(model)) throw new Error(`the tick touched prisma.${model}`);
      return new Proxy({}, {
        get(_inner, op) {
          if (typeof op !== 'string') return undefined;
          return async (args: Args = {}) => {
            calls.push({ model, op, args });
            const handler = handlers[model]?.[op];
            if (!handler) throw new Error(`unexpected prisma.${model}.${op}`);
            return handler(args);
          };
        },
      });
    },
  });

  const env = loadEnv({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db', CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  } as unknown as NodeJS.ProcessEnv);
  const polledSites: string[] = [];
  const readCalendars: string[] = [];
  /** What the tick logged as an error, by its message. */
  const logged: string[] = [];
  const services = {
    env,
    prisma,
    logger: { info: () => {}, warn: () => {}, error: (_obj: unknown, msg: string) => void logged.push(msg) },
    pusher: new RecordingPusher(),
    shahafFor: (siteUrl: string) => ({
      poll: async () => {
        polledSites.push(siteUrl);
        return { entities: [], completeScopes: [], sourceFreshness: null };
      },
    }),
    schoolSiteFor: (calendarId: string) => ({
      poll: async () => {
        readCalendars.push(calendarId);
        return {
          entities: [{ source: 'school_site', kind: 'exam', naturalKey: 'site-exam|1', payload: { date: '2026-11-02', subject: 'מבחן באנגלית', details: null } }],
          completeScopes: [],
        };
      },
    }),
  } as unknown as Services;
  return { services, calls, polledSites, readCalendars, boxes, logged, boardEvents };
}

describe('a tick', () => {
  it('polls the followed classes and their exam calendars, touching only the class tables (and sweeping the chat ones)', async () => {
    const { services, calls, polledSites, readCalendars, boardEvents } = world();
    const result = await runTick(services, IN_WINDOW);
    expect(result.errors).toEqual([]);
    expect(result.classes).toEqual({ polled: 1, failed: 0, events: 0, sent: 0, deferred: 0, closed: 0, examCalendars: 1 });
    // The calendar's first exams tell the class, before the same tick's push run looks for events.
    expect(boardEvents).toEqual([
      { classId: 'class-1', kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy: 'dev-setter' }, partition: null } },
    ]);
    expect(polledSites).toEqual([SITE]);
    expect(readCalendars).toEqual([CALENDAR]);
    // The calendar's exams are kept whole on the class row.
    const saved = calls.find((c) => c.model === 'schoolClass' && c.op === 'update' && c.args.data && 'exams' in c.args.data);
    expect(saved?.args.data?.exams).toEqual([{ naturalKey: 'site-exam|1', date: '2026-11-02', subject: 'מבחן באנגלית', details: null }]);
    // Only a class with a calendar is read: a board brought from a file is not overwritten by one.
    const asked = calls.find((c) => c.model === 'schoolClass' && c.op === 'findMany' && 'examCalendarId' in (c.args.where ?? {}));
    expect(asked?.args.where).toMatchObject({ examCalendarId: { not: null }, examBoardKind: null });
    expect(new Set(calls.map((c) => c.model))).toEqual(new Set(['schoolClass', 'classSnapshot', 'classChangeEvent', 'deviceNotification', 'buddyBox', ...CHAT_TABLES]));
  });

  it('forgets the pushes sent more than 30 days ago, and only those', async () => {
    const { services, calls } = world();
    await runTick(services, IN_WINDOW);
    const forget = calls.filter((c) => c.model === 'deviceNotification');
    expect(forget.map((c) => c.op)).toEqual(['deleteMany']);
    const before = (forget[0]!.args.where as { sentAt: { lt: Date } }).sentAt.lt;
    expect((IN_WINDOW.getTime() - before.getTime()) / (24 * 3600_000)).toBe(30);
  });

  const day = 24 * 3600_000;
  const ago = (days: number) => new Date(IN_WINDOW.getTime() - days * day);
  /** A box made `created` days before the tick and last written `updated` days before it; `ciphertext` `''` for a mark. */
  const box = (id: string, kind: string, created: number, updated = created, ciphertext = 'abc'): BoxRow =>
    ({ id, kind, ciphertext, createdAt: ago(created), updatedAt: ago(updated), writerDeviceId: 'device-1' });
  const stateOf = (boxes: BoxRow[]) => boxes.map((b) => [b.id, b.ciphertext === '' ? 'mark' : 'live']);

  it('turns an invite or a reply nobody answered in 7 days into a mark, and forgets a box not written in 120', async () => {
    const { services, boxes } = world({
      boxes: [
        box('invite-8d', 'invite', 8),
        box('invite-6d', 'invite', 6),
        box('reply-8d', 'reply', 8),
        box('reply-6d', 'reply', 6),
        // A pair box is older than a week and is not an invite: only its last update counts.
        box('pair-8d', 'pair', 8),
        box('pair-121d', 'pair', 200, 121),
        box('pair-119d', 'pair', 200, 119),
        // A used link's mark (its writer deleted it, R22) is not an invite waiting: it stays its 120 days, so the link cannot be armed again.
        box('used-invite-8d', 'invite', 8, 2, ''),
        box('used-reply-100d', 'reply', 100, 100, ''),
        box('used-invite-121d', 'invite', 130, 121, ''),
      ],
    });
    const result = await runTick(services, IN_WINDOW);
    expect(result.errors).toEqual([]);
    // An expired invite or reply loses its content and keeps its row, as the mark its link needs.
    expect(stateOf(boxes)).toEqual([
      ['invite-8d', 'mark'],
      ['invite-6d', 'live'],
      ['reply-8d', 'mark'],
      ['reply-6d', 'live'],
      ['pair-8d', 'live'],
      ['pair-119d', 'live'],
      ['used-invite-8d', 'mark'],
      ['used-reply-100d', 'mark'],
    ]);
    // Dated by this tick, so that it keeps its 120 days from now; a mark that was there is left as dated.
    expect(boxes.find((b) => b.id === 'invite-8d')!.updatedAt).toEqual(IN_WINDOW);
    expect(boxes.find((b) => b.id === 'reply-8d')!.updatedAt).toEqual(IN_WINDOW);
    expect(boxes.find((b) => b.id === 'used-invite-8d')!.updatedAt).toEqual(ago(2));
    // Its kind and its writer are what they were: the writer's own PUT of its id is `taken` (routes test).
    expect(boxes.find((b) => b.id === 'invite-8d')).toMatchObject({ kind: 'invite', writerDeviceId: 'device-1' });
  });

  it('empties before it deletes', async () => {
    const { services, calls } = world({ boxes: [box('invite-8d', 'invite', 8)] });
    await runTick(services, IN_WINDOW);
    expect(calls.filter((c) => c.model === 'buddyBox').map((c) => c.op)).toEqual(['updateMany', 'deleteMany']);
    expect(calls.find((c) => c.model === 'buddyBox' && c.op === 'updateMany')!.args.data).toEqual({ ciphertext: '', updatedAt: IN_WINDOW });
  });

  it('keeps a swept invite as a mark for 120 days from the sweep, then deletes it', async () => {
    const { services, boxes } = world({ boxes: [box('invite-8d', 'invite', 8)] });
    await runTick(services, IN_WINDOW);
    expect(stateOf(boxes)).toEqual([['invite-8d', 'mark']]);

    // Later ticks leave it: it is a mark now, not an invite waiting, and its date is the sweep's, not the invite's.
    const at = (days: number) => new Date(IN_WINDOW.getTime() + days * day);
    await runTick(services, at(30));
    await runTick(services, at(119));
    expect(stateOf(boxes)).toEqual([['invite-8d', 'mark']]);
    expect(boxes[0]!.updatedAt).toEqual(IN_WINDOW);
    // A tick 121 days after the sweep that made it forgets it.
    const result = await runTick(services, at(121));
    expect(result.errors).toEqual([]);
    expect(boxes).toEqual([]);
  });

  it('leaves a live pair box at 8 days alone, and forgets a mark with no writer after 120', async () => {
    const { services, boxes } = world({
      boxes: [
        box('pair-8d', 'pair', 8),
        { ...box('left-100d', 'invite', 100, 100, ''), writerDeviceId: null },
        { ...box('left-121d', 'invite', 130, 121, ''), writerDeviceId: null },
        { ...box('left-reply-121d', 'reply', 130, 121, ''), writerDeviceId: null },
      ],
    });
    const result = await runTick(services, IN_WINDOW);
    expect(result.errors).toEqual([]);
    expect(stateOf(boxes)).toEqual([['pair-8d', 'live'], ['left-100d', 'mark']]);
    expect(boxes[0]!.updatedAt).toEqual(ago(8));
  });

  it('reports a failure forgetting friend boxes without stopping the rest of the tick', async () => {
    const { services, calls, logged } = world({ boxesFail: true });
    const result = await runTick(services, IN_WINDOW);
    expect(result.errors).toEqual([expect.stringMatching(/^buddy boxes: .*boxes down/)]);
    // The words the runbook tells an operator to look for.
    expect(logged).toEqual(['forgetting stale buddy boxes threw']);
    expect(result.classes).toMatchObject({ polled: 1 });
    expect(calls.some((c) => c.model === 'deviceNotification' && c.op === 'deleteMany')).toBe(true);
  });

  it('polls a site every 15 minutes in the active window and hourly outside it, less the slack', async () => {
    const dueBefore = async (now: Date) => {
      const { services, calls } = world();
      await runTick(services, now);
      const sites = calls.find((c) => c.model === 'schoolClass' && c.op === 'findMany' && !('examCalendarId' in (c.args.where ?? {})))!;
      const or = (sites.args.where as { OR: { polledAt?: { lt: Date } | null }[] }).OR;
      return (now.getTime() - or.find((o) => o.polledAt)!.polledAt!.lt.getTime()) / 60_000;
    };
    expect(await dueBefore(IN_WINDOW)).toBe(13);
    expect(await dueBefore(AT_NIGHT)).toBe(58);
  });

  it('reports a failure in the class step instead of throwing', async () => {
    const { services } = world({ eventsFail: true });
    const result = await runTick(services, IN_WINDOW);
    expect(result.classes).toBeNull();
    expect(result.errors).toEqual([expect.stringMatching(/^classes: .*db down/)]);
  });
});
