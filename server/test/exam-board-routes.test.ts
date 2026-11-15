/**
 * `POST /v2/device/exam-board/preview` (plan: exam-board-sources, task 5): what the server found at a link or in
 * a file, and nothing saved. The route takes input from strangers, so most of this file is about its limits:
 * the counter, the sizes, and that nothing a device sends reaches the log. `fetch`, `lookup` and the calendar's
 * ICS are fakes; no test touches a network. The database is a stand-in with only the calls the routes may make,
 * so a write a route should not make is a TypeError.
 *
 * The save, `PUT /v2/device/exam-board` (task 6), is tested further down: what it keeps, the lock that decides who
 * may replace a class's board, and requests that come at the same moment. The stand-in lets requests interleave
 * between the calls of each, as they would over a network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassFeed, DeviceResponse, ExamBoardPreview, RegisterDeviceResponse } from '@sederyom/shared';
import { CLASS_FEED_PAST_DAYS } from '@sederyom/shared';
import { FEED_EXAM_PAST_DAYS } from '../../app/src/local/examPrefs';
import { calendarExams } from '@sederyom/shared/logic/exam-board/calendar';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { BoardError } from '../src/exam-board/errors';
import { extractBoard } from '../src/exam-board/extract';
import type { LinkDeps } from '../src/exam-board/link';
import { icsFetcher } from '../src/exam-board/preview';
import { RecordingPusher } from '../src/notify/push.js';
import { buildServices } from '../src/services.js';

// `vi.fn(real)`, so that a test can make the extractor throw once and every other test gets the real one.
vi.mock('../src/exam-board/extract', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/exam-board/extract')>();
  return { ...real, extractBoard: vi.fn(real.extractBoard) };
});

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const fixtureBytes = (...path: string[]) => new Uint8Array(readFileSync(join(FIXTURES, ...path)));
const fixtureText = (...path: string[]) => readFileSync(join(FIXTURES, ...path), 'utf8');
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  SCHEDULER_ENABLED: 'false',
  LOG_LEVEL: 'silent',
};
const silent = { info: () => {}, warn: () => {}, error: () => {} };

/** The day the xlsx fixtures were made for; the calendar fixture reaches from 2024 to 2027, so it has exams on both sides. */
const NOW = new Date('2026-11-10T09:00:00Z');
const TODAY = '2026-11-10';
const HOUR = 60 * 60 * 1000;

const PUBLIC_IP = '93.184.216.34';
const HADARIM_URL =
  'https://hadarimschool.co.il/%D7%A9%D7%9B%D7%91%D7%AA-%D7%99%D7%91-%D7%AA%D7%A9%D7%A2%D7%95/%D7%9C%D7%95%D7%97-%D7%94%D7%9E%D7%91%D7%97%D7%A0%D7%99%D7%9D-%D7%99%D7%91/';
const HADARIM_ID = '8auulv95lhqscbron8a6gucrtc@group.calendar.google.com';
const BASE = 'https://board.example.org';

// ---- the database stand-in --------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string };

const time = (v: unknown): unknown => (v instanceof Date ? v.getTime() : v);

/** Prisma's `where` for the shapes the route uses: equality, `gt`/`gte`/`lt`/`lte`, `OR`. Anything else fails loudly. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (key === 'OR') return (want as Record<string, unknown>[]).some((w) => matches(row, w));
    const have = row[key];
    if (want === null || typeof want !== 'object' || want instanceof Date) return time(have) === time(want);
    return Object.entries(want).every(([op, arg]) => {
      // a comparison with NULL is never true
      if (have === null || have === undefined) return false;
      const a = time(have) as number;
      const b = time(arg) as number;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      if (op === 'lte') return a <= b;
      throw new Error(`the stand-in does not know the filter ${op}`);
    });
  });
}

/** Prisma's `data` for an update: a value, `Prisma.DbNull` (stored as null), or `{ increment }`. */
function applied(row: Row, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === Prisma.DbNull) row[key] = null;
    else if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
      const [[op, by]] = Object.entries(value) as [[string, number]];
      if (op !== 'increment') throw new Error(`the stand-in does not know the operation ${op}`);
      row[key] = (row[key] as number) + by;
    } else row[key] = value;
  }
}

/**
 * A call to a database takes a turn of the event loop, so that requests which come at the same moment interleave
 * between their calls as they would over a network. The statement itself then runs to its end alone.
 */
const roundTrip = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A row as a read gives it: a copy, so that what a caller holds is as the row was when it read it, not as it is now. */
const copy = (row: Row | undefined): Row | null => (row ? { ...row } : null);

/** What a class row holds besides its name: all of it null, as a class nobody has given a board is. */
const CLASS_DEFAULTS = {
  examCalendarId: null, examCalendarSetBy: null, exams: null, examsPolledAt: null, examsOkAt: null, examsError: null,
  examBoardKind: null, examBoardSetAt: null, examBoardAnnouncedAt: null,
};

/** What Prisma throws for an `update` whose `where` matches no row. */
const notFound = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

/**
 * Just what the routes may touch: finding a device by its token, registering one, finding the class, the
 * conditional `updateMany` of the counter, and the writes a board makes to its class (`updateMany`, and
 * `update` with the extra fields of `where` Prisma 5 takes, a miss being P2025). A statement runs to its end
 * before another starts, as a row-locking `UPDATE ... WHERE` does.
 */
function memoryDb() {
  let n = 0;
  const devices: Row[] = [];
  const classes: Row[] = [];
  const follows: { deviceId: string; classId: string; prefs: unknown; createdAt: Date }[] = [];
  const events: Row[] = [];
  const eventFailure = { on: false };
  const withSchool = (cls: Row | undefined) => (cls ? { ...cls, school: { shahafUrl: `https://${String(cls.schoolId)}.shahaf.site` } } : null);
  const prisma = {
    device: {
      findUnique: async ({ where, include }: { where: Record<string, unknown>; include?: unknown }) => {
        await roundTrip();
        const row = copy(devices.find((d) => matches(d, where)));
        if (!row || !include) return row;
        return {
          ...row,
          class: withSchool(classes.find((c) => c.id === row.classId)),
          follows: follows.filter((f) => f.deviceId === row.id).map((f) => ({ classId: f.classId, prefs: f.prefs, class: withSchool(classes.find((c) => c.id === f.classId)) })),
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        await roundTrip();
        // `lastSeenAt` is the database's default, the moment the row is made
        const row = { id: `dev${++n}`, pushToken: null, classId: null, boardPreviewCount: 0, boardPreviewWindowAt: null, lastSeenAt: new Date(), ...data };
        devices.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        await roundTrip();
        const row = devices.find((d) => d.id === where.id);
        if (!row) throw notFound();
        applied(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        await roundTrip();
        const hit = devices.filter((d) => matches(d, where));
        hit.forEach((d) => applied(d, data));
        return { count: hit.length };
      },
    },
    classFollow: {
      findUnique: async ({ where }: { where: { deviceId_classId: { deviceId: string; classId: string } } }) => {
        await roundTrip();
        return follows.find((f) => f.deviceId === where.deviceId_classId.deviceId && f.classId === where.deviceId_classId.classId) ?? null;
      },
    },
    schoolClass: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        await roundTrip();
        return copy(classes.find((c) => c.id === where.id));
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        await roundTrip();
        const row = classes.find((c) => matches(c, where));
        if (!row) throw notFound();
        applied(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        await roundTrip();
        const hit = classes.filter((c) => matches(c, where));
        hit.forEach((c) => applied(c, data));
        return { count: hit.length };
      },
    },
    classSnapshot: { findMany: async () => [] },
    // The event that tells a class of its board (`announceBoard`): `eventFailure.on` makes the database refuse it.
    classChangeEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        await roundTrip();
        if (eventFailure.on) throw new RangeError('LEAKMARK the database said this');
        const row = { id: `event${events.length + 1}`, ...data };
        events.push(row);
        return row;
      },
    },
  };
  // (the feed of a class some device follows: `findFirst` by its site and number, which only a followed class answers)
  Object.assign(prisma.schoolClass, {
    findFirst: async ({ where }: { where: { shahafClassId: string; school: { shahafUrl: string } } }) => {
      await roundTrip();
      const hit = classes.find(
        (c) =>
          c.shahafClassId === where.shahafClassId &&
          `https://${String(c.schoolId)}.shahaf.site` === where.school.shahafUrl &&
          (devices.some((d) => d.classId === c.id) || follows.some((f) => f.classId === c.id)),
      );
      return withSchool(hit);
    },
  });
  return { prisma, devices, classes, follows, events, eventFailure };
}

// ---- the world --------------------------------------------------------------------------------

type Reply = Response | (() => Response | Promise<Response>);
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
const bytesOf = (body: Uint8Array, type = 'application/octet-stream') => new Response(body, { status: 200, headers: { 'content-type': type } });

function world(opts: { routes?: Record<string, Reply>; ics?: (id: string) => string | Promise<string>; logStream?: { write(line: string): void }; logLevel?: string } = {}) {
  const db = memoryDb();
  const fetched: string[] = [];
  const icsAsked: string[] = [];
  const link: LinkDeps = {
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      const reply = opts.routes?.[url];
      if (!reply) throw new TypeError(`fetch failed: no route for ${url}`);
      // a body is read once: each ask gets its own copy
      const res = typeof reply === 'function' ? await reply() : reply.clone();
      return res;
    }) as typeof fetch,
    lookup: async () => [PUBLIC_IP],
  };
  const env = loadEnv({ ...ENV, ...(opts.logLevel ? { LOG_LEVEL: opts.logLevel } : {}) } as unknown as NodeJS.ProcessEnv);
  const services = buildServices(env, db.prisma as never, silent, new RecordingPusher(), {
    link,
    fetchIcs: async (id) => {
      icsAsked.push(id);
      return (opts.ics ?? (() => fixtureText('school-site', 'exams-yb.ics')))(id);
    },
  });
  const app = buildApp({ services, ...(opts.logStream ? { logStream: opts.logStream } : {}) });
  return { app, db, fetched, icsAsked };
}
type World = ReturnType<typeof world>;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const PATH = '/v2/device/exam-board/preview';

async function register(w: World): Promise<string> {
  const res = await w.app.inject({ method: 'POST', url: '/v2/devices', payload: { platform: 'android' } });
  expect(res.statusCode).toBe(201);
  return (res.json() as RegisterDeviceResponse).token;
}

/** A device that follows a class of that name. */
async function device(w: World, className: string | null = 'ט3'): Promise<string> {
  const token = await register(w);
  if (className !== null) {
    w.db.classes.push({ id: 'cls1', name: className, schoolId: 'sch1', shahafClassId: '1', ...CLASS_DEFAULTS });
    w.db.devices.at(-1)!.classId = 'cls1';
  }
  return token;
}

const preview = (w: World, token: string, payload: unknown) => w.app.inject({ method: 'POST', url: PATH, headers: auth(token), payload: payload as never });
const fileOf = (bytes: Uint8Array, name = 'board.xlsx') => ({ file: { name, base64: b64(bytes) } });
const codeOf = (res: { json(): unknown }) => (res.json() as { error: string }).error;

beforeEach(() => {
  // only the date is faked: the link reader's 10 seconds and the route's 25 stay on the real timers
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

// ---- who may ask ------------------------------------------------------------------------------

describe('who may ask for a preview', () => {
  it('needs a device token', async () => {
    const w = world();
    expect((await w.app.inject({ method: 'POST', url: PATH, payload: { link: 'x.org' } })).statusCode).toBe(401);
    expect((await w.app.inject({ method: 'POST', url: PATH, headers: auth('made-up-token'), payload: { link: 'x.org' } })).statusCode).toBe(401);
    expect(w.fetched).toEqual([]);
  });

  it('answers 409 no_class to a device that follows no class, and reads nothing', async () => {
    const w = world();
    const token = await device(w, null);
    const res = await preview(w, token, fileOf(fixtureBytes('exam-board', 'grade9-list.xlsx')));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'no_class', message: expect.any(String) });
    expect(w.db.devices[0]!.boardPreviewCount).toBe(0);
  });
});

// ---- a link -----------------------------------------------------------------------------------

describe('a link', () => {
  it('to a page with a calendar answers with the calendar, its name, its exams this school year and the next five', async () => {
    const w = world({ routes: { [HADARIM_URL]: html(fixtureText('exam-board', 'hadarim-page.html')) } });
    const token = await device(w);
    const res = await preview(w, token, { link: HADARIM_URL });
    expect(res.statusCode).toBe(200);
    const got = res.json() as Extract<ExamBoardPreview, { kind: 'calendar' }>;
    expect(got.kind).toBe('calendar');
    expect(got.calendars).toHaveLength(1);
    const [cal] = got.calendars;
    expect(cal!.calendarId).toBe(HADARIM_ID);
    expect(cal!.name).toBe('לוח מבחנים שכבת י"ב');
    expect(cal!.count).toBeGreaterThan(0);
    expect(w.icsAsked).toEqual([HADARIM_ID]);

    // the count and the first five from today on come from the same exams the class feed would show
    const exams = calendarExams(fixtureText('school-site', 'exams-yb.ics'), TODAY, 'Asia/Jerusalem').exams;
    expect(cal!.count).toBe(exams.length);
    const dates = exams.map((e) => e.date!).filter((d) => d >= TODAY).sort();
    expect(cal!.upcoming).toHaveLength(5);
    expect(cal!.upcoming.map((u) => u.date)).toEqual(dates.slice(0, 5));
    expect(cal!.upcoming.every((u) => u.date >= TODAY && u.subject.length > 0)).toBe(true);
  });

  it('that is a calendar needs no page: the calendar is the answer', async () => {
    const w = world();
    const token = await device(w);
    const embed = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(HADARIM_ID)}&ctz=Asia%2FJerusalem`;
    const res = await preview(w, token, { link: embed });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { calendars: { calendarId: string }[] }).calendars.map((c) => c.calendarId)).toEqual([HADARIM_ID]);
    expect(w.fetched).toEqual([]);
  });

  it('with several calendars lists them all, each read on its own, and leaves out one that cannot be read', async () => {
    const two = `<iframe src="https://calendar.google.com/calendar/embed?src=a1%40group.calendar.google.com&amp;src=b2%40group.calendar.google.com"></iframe>`;
    const w = world({
      routes: { [`${BASE}/exams`]: html(two) },
      ics: (id) => {
        if (id.startsWith('b2')) throw new BoardError('unreachable');
        return fixtureText('school-site', 'exams-yb.ics');
      },
    });
    const token = await device(w);
    const both = await preview(w, token, { link: `${BASE}/exams` });
    expect(both.statusCode).toBe(200);
    expect((both.json() as { calendars: { calendarId: string }[] }).calendars.map((c) => c.calendarId)).toEqual(['a1@group.calendar.google.com']);
    expect([...w.icsAsked].sort()).toEqual(['a1@group.calendar.google.com', 'b2@group.calendar.google.com']);
  });

  describe('to a calendar that costs too much to read (S-C1)', () => {
    const embedOf = (...ids: string[]) =>
      `<iframe src="https://calendar.google.com/calendar/embed?${ids.map((id) => `src=${encodeURIComponent(id)}`).join('&amp;')}"></iframe>`;
    /** A calendar of `n` one-day exams in this school year, and `extra` events after them. */
    const icsOf = (n: number, extra: string[] = []) => [
      'BEGIN:VCALENDAR', 'X-WR-CALNAME:big',
      ...Array.from({ length: n }, (_, i) => {
        const day = new Date(Date.UTC(2026, 8, 1 + (i % 360))).toISOString().slice(0, 10).replace(/-/g, '');
        return `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART;VALUE=DATE:${day}\r\nSUMMARY:מבחן ${i}\r\nEND:VEVENT`;
      }),
      ...extra,
      'END:VCALENDAR',
    ].join('\r\n');

    it('is too_big when it gives more than 2,000 exams', async () => {
      const w = world({ routes: { [`${BASE}/exams`]: html(embedOf('big@group.calendar.google.com')) }, ics: () => icsOf(2001) });
      const token = await device(w);
      const res = await preview(w, token, { link: `${BASE}/exams` });
      expect(res.statusCode).toBe(422);
      expect(codeOf(res)).toBe('too_big');
    });

    it('is left out beside one that can be read', async () => {
      const w = world({
        routes: { [`${BASE}/exams`]: html(embedOf('big@group.calendar.google.com', 'a1@group.calendar.google.com')) },
        ics: (id) => (id.startsWith('big') ? icsOf(2001) : fixtureText('school-site', 'exams-yb.ics')),
      });
      const token = await device(w);
      const res = await preview(w, token, { link: `${BASE}/exams` });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { calendars: { calendarId: string }[] }).calendars.map((c) => c.calendarId)).toEqual(['a1@group.calendar.google.com']);
    });

    it('counts no year-long event as an exam, and answers with the next five in order', async () => {
      const w = world({ routes: { [`${BASE}/exams`]: html(embedOf('year@group.calendar.google.com')) }, ics: () => fixtureText('school-site', 'year-long-events.ics') });
      const token = await device(w);
      const res = await preview(w, token, { link: `${BASE}/exams` });
      expect(res.statusCode).toBe(200);
      const [cal] = (res.json() as Extract<ExamBoardPreview, { kind: 'calendar' }>).calendars;
      expect(cal!.count).toBe(19);
      expect(cal!.upcoming.map((u) => u.date)).toEqual(['2026-11-10', '2026-11-24', '2027-03-01', '2027-03-02', '2027-03-03']);
    });

    it('answers a short answer for an event with a description of 1.9MB and a title of 50,000 characters', async () => {
      const long = [
        'BEGIN:VEVENT', 'UID:long', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261215',
        `SUMMARY:${'מ'.repeat(50_000)}`, `DESCRIPTION:${'x'.repeat(1_900_000)}`, 'END:VEVENT',
      ];
      const w = world({ routes: { [`${BASE}/exams`]: html(embedOf('long@group.calendar.google.com')) }, ics: () => icsOf(3, long) });
      const token = await device(w);
      const res = await preview(w, token, { link: `${BASE}/exams` });
      expect(res.statusCode).toBe(200);
      const [cal] = (res.json() as Extract<ExamBoardPreview, { kind: 'calendar' }>).calendars;
      expect(cal!.count).toBe(3 + 14);
      expect(cal!.upcoming).toHaveLength(5);
      expect(cal!.upcoming.every((u) => u.subject.length <= 200)).toBe(true);
      expect(res.body.length).toBeLessThan(5_000);
    });
  });

  it('is unreachable when no calendar of the page can be read', async () => {
    const w = world({
      routes: { [`${BASE}/exams`]: html(`<iframe src="https://calendar.google.com/calendar/embed?src=a1%40group.calendar.google.com"></iframe>`) },
      ics: () => {
        throw new BoardError('unreachable');
      },
    });
    const token = await device(w);
    const res = await preview(w, token, { link: `${BASE}/exams` });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'unreachable', message: expect.any(String) });
  });

  it('to an xlsx is read like a file', async () => {
    const w = world({ routes: { [`${BASE}/board.xlsx`]: bytesOf(fixtureBytes('exam-board', 'grade9-list.xlsx')) } });
    const token = await device(w);
    const res = await preview(w, token, { link: `${BASE}/board.xlsx` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'rows', layout: 'list' });
  });

  it('that the link reader refuses answers with the reader\'s code', async () => {
    const w = world({ routes: { [`${BASE}/page`]: html('<p>nothing here</p>') } });
    const token = await device(w);
    const none = await preview(w, token, { link: `${BASE}/page` });
    expect([none.statusCode, codeOf(none)]).toEqual([422, 'no_board']);
    const http = await preview(w, token, { link: 'http://board.example.org/page' });
    expect([http.statusCode, codeOf(http)]).toEqual([422, 'unreachable']);
    const text = await preview(w, token, { link: 'no address in this text' });
    expect([text.statusCode, codeOf(text)]).toEqual([422, 'unreachable']);
  });

  it('answers with a Hebrew sentence for every code', async () => {
    const w = world({ routes: { [`${BASE}/page`]: html('<p>nothing here</p>') } });
    const token = await device(w);
    const res = await preview(w, token, { link: `${BASE}/page` });
    expect(res.json()).toEqual({ error: 'no_board', message: 'לא מצאנו לוח מבחנים בדף הזה.' });
  });
});

// ---- a file -----------------------------------------------------------------------------------

describe('a file', () => {
  it('of grade 9 (a list) answers with its rows', async () => {
    const w = world();
    const token = await device(w, 'ט3');
    const res = await preview(w, token, fileOf(fixtureBytes('exam-board', 'grade9-list.xlsx')));
    expect(res.statusCode).toBe(200);
    const got = res.json() as Extract<ExamBoardPreview, { kind: 'rows' }>;
    expect(got.kind).toBe('rows');
    expect(got.layout).toBe('list');
    expect(got.rows.length).toBeGreaterThan(0);
    expect(got.rows[0]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), title: expect.any(String), details: null, isExam: expect.any(Boolean) });
    expect(Array.isArray(got.skipped)).toBe(true);
  });

  it('of grade 12 (a grid) asks for a column when the class has none, and then reads the one picked', async () => {
    const w = world();
    const token = await device(w, 'י3');
    const bytes = fixtureBytes('exam-board', 'grade12-grid.xlsx');
    const asked = await preview(w, token, fileOf(bytes));
    expect(asked.statusCode).toBe(200);
    const columns = (asked.json() as Extract<ExamBoardPreview, { kind: 'columns' }>);
    expect(columns.kind).toBe('columns');
    expect(columns.columns).toContain('י"ב1');

    const picked = await preview(w, token, { ...fileOf(bytes), column: 'י"ב1' });
    expect(picked.statusCode).toBe(200);
    expect(picked.json()).toMatchObject({ kind: 'rows', layout: 'grid' });
  });

  it('takes the extension in any case, and only .xlsx', async () => {
    const w = world();
    const token = await device(w);
    const bytes = fixtureBytes('exam-board', 'grade9-list.xlsx');
    expect((await preview(w, token, fileOf(bytes, 'Board.XLSX'))).statusCode).toBe(200);
    for (const name of ['board.xls', 'board.xlsm', 'board.csv', 'board', 'board.xlsx.pdf', '']) {
      const res = await preview(w, token, fileOf(bytes, name));
      expect([name, res.statusCode, codeOf(res)]).toEqual([name, 422, 'unsupported_file']);
    }
  });

  it('refuses a PDF, with the code', async () => {
    const w = world();
    const token = await device(w);
    const pdf = strToU8('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    const res = await preview(w, token, fileOf(pdf, 'board.pdf'));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'unsupported_file', message: expect.any(String) });
    // a PDF that says it is an xlsx is not one either
    const lying = await preview(w, token, fileOf(pdf, 'board.xlsx'));
    expect([lying.statusCode, codeOf(lying)]).toEqual([422, 'unsupported_file']);
  });

  it('is unsupported when it is not base64, before anything is opened', async () => {
    const w = world();
    const token = await device(w);
    const good = b64(fixtureBytes('exam-board', 'grade9-list.xlsx'));
    for (const base64 of ['not base64!!', `${good.slice(0, 40)}\n${good.slice(40)}`, `${good.slice(0, 40)}-${good.slice(41)}`, 'A', 'AAAAA']) {
      const res = await preview(w, token, { file: { name: 'board.xlsx', base64 } });
      expect([base64.slice(0, 12), res.statusCode, codeOf(res)]).toEqual([base64.slice(0, 12), 422, 'unsupported_file']);
    }
  });

  it('is too big above 1MB once decoded, and not at 1MB', async () => {
    const w = world();
    const token = await device(w);
    const MB = 1024 * 1024;
    const over = await preview(w, token, fileOf(new Uint8Array(MB + 1)));
    expect([over.statusCode, codeOf(over)]).toEqual([422, 'too_big']);
    // exactly 1MB passes the size check and is then, being zeros, not a workbook
    const exact = await preview(w, token, fileOf(new Uint8Array(MB)));
    expect([exact.statusCode, codeOf(exact)]).toEqual([422, 'unsupported_file']);
  });

  it('is too big when its merges fill more than 20,000 cells, though it stores two', async () => {
    const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const cell = (ref: string) => `<c r="${ref}" t="inlineStr"><is><t>x</t></is></c>`;
    const book = zipSync({
      'xl/workbook.xml': strToU8(`<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        `<worksheet xmlns="${MAIN}"><sheetData><row r="1">${cell('A1')}</row><row r="200">${cell('IV200')}</row></sheetData>` +
          `<mergeCells count="1"><mergeCell ref="A1:IV200"/></mergeCells></worksheet>`,
      ),
    });
    const w = world();
    const token = await device(w);
    const res = await preview(w, token, fileOf(book));
    expect([res.statusCode, codeOf(res)]).toEqual([422, 'too_big']);
  });

  it('whose layout is not known answers unknown_layout', async () => {
    const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const book = zipSync({
      'xl/workbook.xml': strToU8(`<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>`,
      ),
    });
    const w = world();
    const token = await device(w);
    const res = await preview(w, token, fileOf(book));
    expect([res.statusCode, codeOf(res)]).toEqual([422, 'unknown_layout']);
  });
});

// ---- the body ---------------------------------------------------------------------------------

describe('the body', () => {
  it('that is not JSON is answered by the app\'s own handler, not by the route\'s', async () => {
    const w = world();
    const token = await device(w);
    const res = await w.app.inject({
      method: 'POST', url: PATH, headers: { ...auth(token), 'content-type': 'application/json' }, payload: '{"link": "board.exa',
    });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('invalid_json');
    expect(w.db.devices[0]!.boardPreviewCount).toBe(0);
  });

  it('has exactly one of link and file', async () => {
    const w = world();
    const token = await device(w);
    const file = fileOf(fixtureBytes('exam-board', 'grade9-list.xlsx'));
    for (const body of [{ link: 'board.example.org', ...file }, {}, { column: 'ט1' }, { link: '' }, { link: 'x'.repeat(2001) }, { link: 7 }, { file: { name: 'a.xlsx' } }, { ...file, column: 'c'.repeat(101) }]) {
      const res = await preview(w, token, body);
      expect([JSON.stringify(body).slice(0, 30), res.statusCode]).toEqual([JSON.stringify(body).slice(0, 30), 400]);
      expect(codeOf(res)).toBe('invalid_preview');
    }
    expect(w.fetched).toEqual([]);
  });

  it('is cut off above 1.5MB, with the too_big a phone knows', async () => {
    const w = world();
    const token = await device(w);
    const res = await preview(w, token, { file: { name: 'board.xlsx', base64: 'A'.repeat(1.5 * 1024 * 1024) } });
    expect(res.statusCode).toBe(422);
    expect(codeOf(res)).toBe('too_big');
    // and a body that big under a wrong token is not even read
    const refused = await w.app.inject({ method: 'POST', url: PATH, headers: auth('made-up-token'), payload: { file: { name: 'board.xlsx', base64: 'A'.repeat(1.5 * 1024 * 1024) } } });
    expect(refused.statusCode).toBe(401);
  });

  it('takes a file of 1MB, which is 1.33MB of base64', async () => {
    const w = world();
    const token = await device(w);
    const res = await preview(w, token, fileOf(new Uint8Array(1024 * 1024)));
    expect(res.statusCode).toBe(422);
    expect(codeOf(res)).toBe('unsupported_file');
  });
});

// ---- the counter ------------------------------------------------------------------------------

describe('ten previews an hour', () => {
  const body = () => fileOf(fixtureBytes('exam-board', 'grade9-list.xlsx'));

  it('answers the 11th with 429, and 200 again an hour after the first', async () => {
    const w = world();
    const token = await device(w);
    for (let i = 1; i <= 10; i++) expect([i, (await preview(w, token, body())).statusCode]).toEqual([i, 200]);
    const eleventh = await preview(w, token, body());
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json()).toEqual({ error: 'rate_limited', message: expect.any(String) });

    vi.setSystemTime(new Date(NOW.getTime() + HOUR));
    expect((await preview(w, token, body())).statusCode).toBe(200);
  });

  it('holds until the hour is over to the millisecond, and a refused call does not move it', async () => {
    const w = world();
    const token = await device(w);
    for (let i = 0; i < 10; i++) await preview(w, token, body());

    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60 * 1000));
    expect((await preview(w, token, body())).statusCode).toBe(429);
    vi.setSystemTime(new Date(NOW.getTime() + HOUR - 1));
    expect((await preview(w, token, body())).statusCode).toBe(429);
    // the window is the first call's hour, though a call was refused half way through it
    vi.setSystemTime(new Date(NOW.getTime() + HOUR));
    expect((await preview(w, token, body())).statusCode).toBe(200);
  });

  it('opens a new window at the first call after the old one, with ten more', async () => {
    const w = world();
    const token = await device(w);
    for (let i = 0; i < 3; i++) await preview(w, token, body());
    const later = new Date(NOW.getTime() + 2 * HOUR);
    vi.setSystemTime(later);
    for (let i = 1; i <= 10; i++) expect([i, (await preview(w, token, body())).statusCode]).toEqual([i, 200]);
    expect((await preview(w, token, body())).statusCode).toBe(429);
    expect(w.db.devices[0]).toMatchObject({ boardPreviewCount: 10, boardPreviewWindowAt: later });
  });

  it('counts each device on its own', async () => {
    const w = world();
    const first = await device(w);
    for (let i = 0; i < 10; i++) await preview(w, first, body());
    expect((await preview(w, first, body())).statusCode).toBe(429);
    const second = await register(w);
    w.db.devices.at(-1)!.classId = 'cls1';
    expect((await preview(w, second, body())).statusCode).toBe(200);
  });

  it('lets exactly one of three at the same moment have the 10th', async () => {
    const w = world();
    const token = await device(w);
    for (let i = 0; i < 9; i++) await preview(w, token, body());
    const at_once = await Promise.all([preview(w, token, body()), preview(w, token, body()), preview(w, token, body())]);
    expect(at_once.map((r) => r.statusCode).sort()).toEqual([200, 429, 429]);
    expect(w.db.devices[0]!.boardPreviewCount).toBe(10);
  });

  it('lets none of a crowd at the first call of a window lose their turn', async () => {
    const w = world();
    const token = await device(w);
    const crowd = await Promise.all(Array.from({ length: 12 }, () => preview(w, token, body())));
    expect(crowd.filter((r) => r.statusCode === 200)).toHaveLength(10);
    expect(crowd.filter((r) => r.statusCode === 429)).toHaveLength(2);
  });

  it('takes no turn for a body that is refused before any work, or a device with no class', async () => {
    const w = world();
    const token = await device(w);
    for (let i = 0; i < 12; i++) expect((await preview(w, token, {})).statusCode).toBe(400);
    expect(w.db.devices[0]!.boardPreviewCount).toBe(0);
    expect((await preview(w, token, body())).statusCode).toBe(200);
    expect(w.db.devices[0]!.boardPreviewCount).toBe(1);

    const classless = await device(w, null);
    expect((await preview(w, classless, body())).statusCode).toBe(409);
    expect(w.db.devices.at(-1)!.boardPreviewCount).toBe(0);
  });

  it('takes the turn before the work: a link that cannot be read still counts', async () => {
    const w = world();
    const token = await device(w);
    for (let i = 0; i < 10; i++) expect((await preview(w, token, { link: `${BASE}/gone` })).statusCode).toBe(422);
    expect((await preview(w, token, { link: `${BASE}/gone` })).statusCode).toBe(429);
  });
});

// ---- bounds and leaks -------------------------------------------------------------------------

describe('the work', () => {
  it('is cut off after 25 seconds with unreachable', async () => {
    // (faking again on top of the Date-only fakes of beforeEach does not add the timers: start over)
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    // a server that never answers (the link reader's own 10 seconds are on the AbortSignal, which is not faked here)
    const w = world({ routes: { [`${BASE}/slow`]: () => new Promise<Response>(() => {}) } });
    const token = await device(w);
    const pending = preview(w, token, { link: `${BASE}/slow` });
    // the 25 seconds start where the work does: wait (on the real clock) until the link reader has asked the network
    for (let i = 0; i < 200 && w.fetched.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(w.fetched).toEqual([`${BASE}/slow`]);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(24_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'unreachable', message: expect.any(String) });
  });

  it('writes nothing: a class is as it was, and a device changes only its counter', async () => {
    const w = world({ routes: { [HADARIM_URL]: html(fixtureText('exam-board', 'hadarim-page.html')) } });
    const token = await device(w, 'י3');
    const classBefore = JSON.stringify(w.db.classes);
    const deviceBefore = { ...w.db.devices[0]! };
    const grid = fixtureBytes('exam-board', 'grade12-grid.xlsx');
    for (const body of [{ link: HADARIM_URL }, fileOf(fixtureBytes('exam-board', 'grade9-list.xlsx')), fileOf(grid), { ...fileOf(grid), column: 'י"ב1' }, fileOf(strToU8('%PDF'), 'a.pdf')]) {
      await preview(w, token, body);
    }
    expect(JSON.stringify(w.db.classes)).toBe(classBefore);
    const { boardPreviewCount, boardPreviewWindowAt, ...rest } = w.db.devices[0]!;
    const { boardPreviewCount: _c, boardPreviewWindowAt: _w, ...restBefore } = deviceBefore;
    expect(rest).toEqual(restBefore);
    expect(boardPreviewCount).toBe(5);
    expect(boardPreviewWindowAt).toEqual(NOW);
  });
});

describe('the real fetchIcs', () => {
  const ICS_URL = (id: string) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
  const ID = 'a1@group.calendar.google.com';

  /** The fetcher over a fake network that answers one URL. */
  function over(answer: Response) {
    const asked: string[] = [];
    const link: LinkDeps = {
      fetch: (async (input: string | URL | Request) => {
        asked.push(String(input));
        return answer;
      }) as typeof fetch,
      lookup: async () => [PUBLIC_IP],
    };
    return { fetchIcs: icsFetcher(link), asked };
  }
  const refusal = (p: Promise<unknown>) => p.then(() => 'answered', (e: unknown) => (e instanceof BoardError ? e.code : `other: ${String(e)}`));

  it('asks Google for the feed of the calendar at its fixed address and gives back the text', async () => {
    const feed = fixtureText('school-site', 'exams-yb.ics');
    const { fetchIcs, asked } = over(new Response(feed, { status: 200, headers: { 'content-type': 'text/calendar' } }));
    expect(await fetchIcs(ID)).toBe(feed);
    expect(asked).toEqual([ICS_URL(ID)]);
  });

  it('does not take an answer that is not a feed', async () => {
    const { fetchIcs } = over(new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await refusal(fetchIcs(ID))).toBe('unreachable');
  });

  it('stops at 2MB', async () => {
    const big = `BEGIN:VCALENDAR\n${'X'.repeat(2 * 1024 * 1024)}`;
    const { fetchIcs } = over(new Response(big, { status: 200, headers: { 'content-type': 'text/calendar' } }));
    expect(await refusal(fetchIcs(ID))).toBe('too_big');
  });

  it('gives up on a calendar that is not there', async () => {
    const { fetchIcs } = over(new Response('not found', { status: 404 }));
    expect(await refusal(fetchIcs(ID))).toBe('unreachable');
  });
});

// ---- saving a board ---------------------------------------------------------------------------

const SAVE = '/v2/device/exam-board';
const CAL = '7e3b9d14a2c6f805@group.calendar.google.com';
const ROWS = [
  { date: '2026-11-20', title: 'מבחן במתמטיקה', details: 'פרקים 1-3' },
  { date: '2026-12-02', title: 'מבחן באנגלית', details: null },
  { date: '2027-01-14', title: 'בוחן בפיזיקה', details: null },
];
const LOCKED = { error: 'calendar_locked', message: 'ללוח המבחנים של הכיתה כבר יש קישור, ורק מי שהוסיף אותו יכול להחליף או להסיר אותו.' };

const save = (w: World, token: string, rows: unknown) =>
  w.app.inject({ method: 'PUT', url: SAVE, headers: auth(token), payload: { rows } as never });
const putDevice = (w: World, token: string, payload: object) =>
  w.app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload });
const getDevice = async (w: World, token: string) =>
  (await w.app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) })).json() as DeviceResponse;
/** Another device of the class the first one follows. */
async function classmate(w: World): Promise<string> {
  const token = await register(w);
  w.db.devices.at(-1)!.classId = 'cls1';
  return token;
}
const board = (w: World) => w.db.classes[0]!;
const keysOf = (w: World) => (board(w).exams as { naturalKey: string }[]).map((e) => e.naturalKey);

describe('saving a board', () => {
  it('stores the rows as the class\'s exams, and says whose board it is', async () => {
    const w = world();
    const token = await device(w);
    const res = await save(w, token, ROWS);
    expect(res.statusCode).toBe(200);
    expect(board(w)).toMatchObject({
      examCalendarId: null, examBoardKind: 'upload', examBoardSetAt: NOW, examCalendarSetBy: w.db.devices[0]!.id,
      examsPolledAt: NOW, examsOkAt: NOW, examsError: null,
    });
    expect(board(w).exams).toEqual(ROWS.map((r) => ({ naturalKey: uploadedExamKey(r.date, r.title), date: r.date, subject: r.title, details: r.details })));
    const answer = res.json() as DeviceResponse;
    expect(answer.deviceId).toBe(w.db.devices[0]!.id);
    expect(answer.class).toMatchObject({ examCalendarId: null, examBoard: { kind: 'upload', setAt: NOW.toISOString(), count: 3, mine: true } });
  });

  it('goes out in the class feed as the school site\'s exams, under keys that tell a file from a calendar', async () => {
    const w = world();
    const token = await device(w);
    await save(w, token, ROWS);
    const feed = (await w.app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).json() as ClassFeed;
    expect(feed.exams.map((e) => e.source)).toEqual(['school_site', 'school_site', 'school_site']);
    expect(feed.exams.every((e) => /^site-exam\|up\|[0-9a-f]{8}$/.test(e.naturalKey))).toBe(true);
    expect(feed.exams.map((e) => [e.date, e.subject, e.details])).toEqual(ROWS.map((r) => [r.date, r.title, r.details]));
  });

  it('goes out in the feed from CLASS_FEED_PAST_DAYS days back, the window the phone counts on too (ledger L228)', async () => {
    const w = world();
    const token = await device(w);
    expect(CLASS_FEED_PAST_DAYS).toBe(7);
    expect(FEED_EXAM_PAST_DAYS).toBe(CLASS_FEED_PAST_DAYS);
    board(w).exams = [
      { naturalKey: 'site-exam|edge', date: '2026-11-03', subject: 'מבחן בגבול', details: null },
      { naturalKey: 'site-exam|out', date: '2026-11-02', subject: 'מבחן ישן', details: null },
    ];
    const feed = (await w.app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).json() as ClassFeed;
    expect(feed.exams.map((e) => e.naturalKey)).toEqual(['site-exam|edge']);
  });

  it('tells the device that brought it that it is its own, and a classmate that it is not', async () => {
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    expect((await getDevice(w, token)).class?.examBoard).toBeUndefined();
    await save(w, token, ROWS);
    expect((await getDevice(w, token)).class?.examBoard).toEqual({ kind: 'upload', setAt: NOW.toISOString(), count: 3, mine: true, mayChange: true });
    // the setter follows the class, so the board is not the classmate's to replace
    expect((await getDevice(w, other)).class?.examBoard).toEqual({ kind: 'upload', setAt: NOW.toISOString(), count: 3, mine: false, mayChange: false });
  });

  it('says in the feed, as in the device, whether the board may be replaced by the one that asks', async () => {
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    const feedOf = async (t: string) => ((await w.app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(t) })).json() as ClassFeed).class.examBoard;
    expect(await feedOf(token)).toMatchObject({ mine: true, mayChange: true });
    expect(await feedOf(other)).toMatchObject({ mine: false, mayChange: false });
  });

  describe('tells a classmate whether the lock would let its save through', () => {
    const infoOf = async (w: World, token: string) => (await getDevice(w, token)).class?.examBoard;

    it('is false while the device that brought the board follows the class, as its own or through a follow', async () => {
      const w = world();
      const token = await device(w);
      const other = await classmate(w);
      await save(w, token, ROWS);
      expect(await infoOf(w, other)).toMatchObject({ mine: false, mayChange: false });
      // it moved to another class but still follows this one as a parent's other child's
      const setter = w.db.devices[0]!;
      setter.classId = 'cls9';
      w.db.follows.push({ deviceId: setter.id, classId: 'cls1', prefs: {}, createdAt: NOW });
      expect(await infoOf(w, other)).toMatchObject({ mine: false, mayChange: false });
      expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(403);
    });

    it('is true once the device that brought it has left the class, and the save then makes the classmate the setter', async () => {
      const w = world();
      const token = await device(w);
      const other = await classmate(w);
      await save(w, token, ROWS);
      w.db.devices[0]!.classId = 'cls9';
      expect(await infoOf(w, other)).toMatchObject({ kind: 'upload', count: 3, mine: false, mayChange: true });

      const res = await save(w, other, ROWS.slice(0, 2));
      expect(res.statusCode).toBe(200);
      expect((res.json() as DeviceResponse).class?.examBoard).toMatchObject({ count: 2, mine: true, mayChange: true });
      expect(await infoOf(w, other)).toMatchObject({ mine: true, mayChange: true });
      // and the board is the other one's now: the old setter, back in the class, may not take it back
      w.db.devices[0]!.classId = 'cls1';
      expect(await infoOf(w, token)).toMatchObject({ mine: false, mayChange: false });
      expect((await save(w, token, ROWS)).statusCode).toBe(403);
    });

    it('is true for a calendar from before the board had a setter', async () => {
      const w = world();
      await device(w);
      const other = await classmate(w);
      Object.assign(board(w), { examCalendarId: CAL, examCalendarSetBy: null });
      expect(await infoOf(w, other)).toMatchObject({ kind: 'calendar', mine: false, mayChange: true });
    });

    it('is true for a setter that is gone altogether', async () => {
      const w = world();
      await device(w);
      Object.assign(board(w), { examBoardKind: 'upload', examCalendarSetBy: 'a-device-that-was-deleted' });
      expect(await infoOf(w, await classmate(w))).toMatchObject({ mine: false, mayChange: true });
    });

    it('is false for a class the device only follows, whoever the board belongs to', async () => {
      const w = world();
      await device(w);
      // the setter has left, so the lock would let any follower of the class through; a parent's phone with
      // another class of its own is not one, because a board is set on a device's own class only
      Object.assign(board(w), { examBoardKind: 'upload', examCalendarSetBy: 'a-device-that-was-deleted', exams: [] });
      const parent = await register(w);
      w.db.devices.at(-1)!.classId = 'cls9';
      w.db.classes.push({ id: 'cls9', name: 'ח1', schoolId: 'sch9', shahafClassId: '9', ...CLASS_DEFAULTS });
      w.db.follows.push({ deviceId: w.db.devices.at(-1)!.id, classId: 'cls1', prefs: {}, createdAt: NOW });
      const answer = await getDevice(w, parent);
      expect(answer.class?.examBoard).toBeUndefined();
      expect(answer.otherClasses?.[0]).toMatchObject({ classId: '1', examBoard: { kind: 'upload', mine: false, mayChange: false } });
    });

    it('is false in the feed of a class that is a friend\'s, not the device\'s own', async () => {
      const w = world();
      const token = await device(w);
      await save(w, token, ROWS);
      // the setter is gone, so the lock would let a follower of the class through: the friend follows another class
      board(w).examCalendarSetBy = 'a-device-that-was-deleted';
      expect(await infoOf(w, await classmate(w))).toMatchObject({ mayChange: true });
      w.db.classes.push({ id: 'cls2', name: 'ח2', schoolId: 'sch2', shahafClassId: '2', ...CLASS_DEFAULTS });
      const friend = await register(w);
      w.db.devices.at(-1)!.classId = 'cls2';
      const feed = await w.app.inject({ method: 'GET', url: '/v2/class/feed?site=https%3A%2F%2Fsch1.shahaf.site&cls=1', headers: auth(friend) });
      expect(feed.statusCode).toBe(200);
      expect((feed.json() as ClassFeed).class.examBoard).toMatchObject({ kind: 'upload', mine: false, mayChange: false });
    });
  });

  it('is replaced by the device that brought it, the same rows keeping their keys and a new row getting its own', async () => {
    const w = world();
    const token = await device(w);
    await save(w, token, ROWS);
    const first = keysOf(w);
    expect(first).toHaveLength(3);
    const again = await save(w, token, [...ROWS, { date: '2027-03-03', title: 'מבחן בהיסטוריה', details: null }]);
    expect(again.statusCode).toBe(200);
    expect(keysOf(w).slice(0, 3)).toEqual(first);
    expect(keysOf(w)).toHaveLength(4);
    expect(new Set(keysOf(w)).size).toBe(4);
    // and a shorter list is the whole board: what it leaves out is gone
    await save(w, token, ROWS.slice(0, 1));
    expect(keysOf(w)).toEqual(first.slice(0, 1));
  });

  it('is not replaced or cleared by a classmate, by a file or by a calendar: the core of the lock', async () => {
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    const before = JSON.stringify(board(w));

    const file = await save(w, other, [{ date: '2026-11-25', title: 'מבחן של מישהו אחר', details: null }]);
    expect([file.statusCode, file.json()]).toEqual([403, LOCKED]);
    // a board from a file has no calendar id, which used to read as "no board", so anyone could replace it
    const calendar = await putDevice(w, other, { examCalendar: CAL });
    expect([calendar.statusCode, calendar.json()]).toMatchObject([403, { error: 'calendar_locked' }]);
    const clear = await putDevice(w, other, { examCalendar: null });
    expect(clear.statusCode).toBe(403);
    expect(w.icsAsked).toEqual([]);
    expect(JSON.stringify(board(w))).toBe(before);
  });

  it('is anyone\'s to replace once the device that brought it has left the class, and not before', async () => {
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    const setter = w.db.devices[0]!;

    // it follows the class as a parent's other child's: still its board
    setter.classId = 'cls9';
    w.db.follows.push({ deviceId: setter.id, classId: 'cls1', prefs: {}, createdAt: NOW });
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(403);
    // it follows nothing of the class: the board passes on
    w.db.follows.length = 0;
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(200);
    expect(board(w).examCalendarSetBy).toBe(w.db.devices[1]!.id);
  });

  it('passes to a classmate once the device that brought it has not been seen for 30 days, and not before (S-I3)', async () => {
    const DAY = 24 * HOUR;
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    const setter = w.db.devices[0]!;

    // seen yesterday: still its board
    setter.lastSeenAt = new Date(NOW.getTime() - DAY);
    expect((await getDevice(w, other)).class?.examBoard).toMatchObject({ mine: false, mayChange: false });
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(403);
    expect((await putDevice(w, other, { examCalendar: null })).statusCode).toBe(403);
    // seen 30 days ago, to the millisecond: still its board
    setter.lastSeenAt = new Date(NOW.getTime() - 30 * DAY);
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(403);
    // not seen for 31 days (a reinstall, a new phone): a classmate may change it, and the block says so
    setter.lastSeenAt = new Date(NOW.getTime() - 31 * DAY);
    expect((await getDevice(w, other)).class?.examBoard).toMatchObject({ mine: false, mayChange: true });
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(200);
    expect(board(w).examCalendarSetBy).toBe(w.db.devices[1]!.id);
  });

  it('is anyone\'s to bring where a calendar from before the board has no setter', async () => {
    const w = world();
    await device(w);
    const other = await classmate(w);
    Object.assign(board(w), { examCalendarId: CAL, examCalendarSetBy: null });
    expect((await save(w, other, ROWS)).statusCode).toBe(200);
    expect(board(w)).toMatchObject({ examCalendarId: null, examBoardKind: 'upload', examCalendarSetBy: w.db.devices[1]!.id });
  });

  it('takes a file in the place of a calendar the device set, and leaves nothing of the calendar behind', async () => {
    const w = world();
    const token = await device(w);
    Object.assign(board(w), { examCalendarId: CAL, examCalendarSetBy: w.db.devices[0]!.id, exams: [{ naturalKey: 'site-exam|1', date: '2026-12-01', subject: 'x', details: null }] });
    expect((await save(w, token, ROWS)).statusCode).toBe(200);
    expect(board(w)).toMatchObject({ examCalendarId: null, examBoardKind: 'upload' });
    expect(keysOf(w).every((k) => k.startsWith('site-exam|up|'))).toBe(true);
  });

  it('keeps a row once when two say the same, and cleans what it keeps', async () => {
    const w = world();
    const token = await device(w);
    const res = await save(w, token, [
      { date: '2026-11-20', title: '  מבחן   ב"מתמטיקה"  ', details: ' פרקים\n  1-3 ' },
      // the same exam spelled without the quote marks: the same key, and the first one stays
      { date: '2026-11-20', title: 'מבחן במתמטיקה', details: 'second' },
      { date: '2026-11-21', title: 'מבחן במתמטיקה', details: '   ' },
      { date: '2026-11-22', title: 'מבחן בכימיה' },
    ]);
    expect(res.statusCode).toBe(200);
    expect((board(w).exams as object[]).map((e) => ({ ...e, naturalKey: undefined }))).toEqual([
      { date: '2026-11-20', subject: 'מבחן ב"מתמטיקה"', details: 'פרקים 1-3' },
      { date: '2026-11-21', subject: 'מבחן במתמטיקה', details: null },
      { date: '2026-11-22', subject: 'מבחן בכימיה', details: null },
    ]);
  });

  describe('turns away, with bad_rows and a class as it was,', () => {
    const row = (over: object = {}) => ({ date: '2026-11-20', title: 'מבחן', details: null, ...over });
    const refused = async (rows: unknown) => {
      const w = world();
      const token = await device(w);
      const before = JSON.stringify(w.db.classes);
      const res = await save(w, token, rows);
      expect(JSON.stringify(w.db.classes)).toBe(before);
      return [res.statusCode, (res.json() as { error: string }).error];
    };

    it('401 rows, and none', async () => {
      expect(await refused(Array.from({ length: 401 }, (_, i) => row({ title: `מבחן ${i}` })))).toEqual([422, 'bad_rows']);
      expect(await refused([])).toEqual([422, 'bad_rows']);
    });

    it('a date that is not a day of this school year', async () => {
      for (const date of ['2024-01-01', '2026-08-31', '2027-09-01', '2026-02-30', '2026-13-01', '2026-11-31', '2026-1-5', '20261120', '']) {
        expect([date, ...(await refused([row({ date })]))]).toEqual([date, 422, 'bad_rows']);
      }
    });

    it('a title that is empty once cleaned, or too long, and details that are too long', async () => {
      for (const over of [{ title: '' }, { title: '  \n ' }, { title: 'x'.repeat(201) }, { details: 'x'.repeat(501) }]) {
        expect([JSON.stringify(over).slice(0, 20), ...(await refused([row(over)]))]).toEqual([JSON.stringify(over).slice(0, 20), 422, 'bad_rows']);
      }
    });

    it('one bad row among good ones: nothing is saved', async () => {
      expect(await refused([row(), row({ date: '2024-01-01' }), row({ title: 'אחר' })])).toEqual([422, 'bad_rows']);
    });

    it('a title of nothing but marks and controls, never a 500 (S-M1)', async () => {
      for (const title of ['​​', '\u0000', '‏‮﻿', '\uD800']) {
        expect([title.codePointAt(0), ...(await refused([row({ title })]))]).toEqual([title.codePointAt(0), 422, 'bad_rows']);
      }
    });
  });

  it('keeps no control, bidi mark or zero-width character, and one key for a title with and without them (S-M1)', async () => {
    const w = world();
    const token = await device(w);
    const res = await save(w, token, [
      { date: '2026-11-20', title: '‏מבחן\u0000 ב‮מתמטיקה​', details: 'פרק\u0007 א\uD800\n⁦ב⁩' },
      { date: '2026-11-20', title: 'מבחן במתמטיקה', details: 'השני' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(board(w).exams).toEqual([
      { naturalKey: uploadedExamKey('2026-11-20', 'מבחן במתמטיקה'), date: '2026-11-20', subject: 'מבחן במתמטיקה', details: 'פרק א ב' },
    ]);
  });

  it('takes 400 rows, the first and last day of the school year, and the longest title and details', async () => {
    const w = world();
    const token = await device(w);
    const many = Array.from({ length: 400 }, (_, i) => ({ date: '2026-12-01', title: `מבחן ${i}`, details: null }));
    expect((await save(w, token, many)).statusCode).toBe(200);
    expect(board(w).exams).toHaveLength(400);
    const edges = [
      { date: '2026-09-01', title: 'א'.repeat(200), details: 'ב'.repeat(500) },
      { date: '2027-08-31', title: ` ${'א'.repeat(200)} `, details: null },
    ];
    const res = await save(w, token, edges);
    expect([res.statusCode, (board(w).exams as unknown[]).length]).toEqual([200, 2]);
  });

  it('answers 400 to a body that is not a list of rows, which a phone never sends', async () => {
    const w = world();
    const token = await device(w);
    const before = JSON.stringify(w.db.classes);
    for (const payload of [{}, { rows: 'x' }, { rows: [null] }, { rows: [{ date: 5, title: 'x' }] }, { rows: [{ date: '2026-11-20', title: 5 }] }, { rows: [{ date: '2026-11-20', title: 'x', details: 5 }] }]) {
      const res = await w.app.inject({ method: 'PUT', url: SAVE, headers: auth(token), payload: payload as never });
      expect([JSON.stringify(payload), res.statusCode, (res.json() as { error: string }).error]).toEqual([JSON.stringify(payload), 400, 'invalid_exam_board']);
    }
    expect((await w.app.inject({ method: 'PUT', url: SAVE, headers: auth(token) })).statusCode).toBe(400);
    expect(JSON.stringify(w.db.classes)).toBe(before);
  });

  it('needs a device that follows a class, and sets a board on its own class only', async () => {
    const w = world();
    const classless = await device(w, null);
    const res = await save(w, classless, ROWS);
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'no_class', message: expect.any(String) }]);

    // a parent's phone: no class of its own, another child's class followed
    const parent = await register(w);
    w.db.classes.push({ id: 'cls1', name: 'ט3', schoolId: 'sch1', shahafClassId: '1', ...CLASS_DEFAULTS });
    w.db.follows.push({ deviceId: w.db.devices.at(-1)!.id, classId: 'cls1', prefs: {}, createdAt: NOW });
    expect((await save(w, parent, ROWS)).statusCode).toBe(409);
    expect(board(w)).toMatchObject({ examBoardKind: null, exams: null });
    expect((await w.app.inject({ method: 'PUT', url: SAVE, payload: { rows: ROWS } })).statusCode).toBe(401);
  });

  /** Hebrew letters, to build titles that differ and take two bytes a character in the body. */
  const ALEF = 0x5d0;
  const hebrewWord = (i: number) => String.fromCharCode(ALEF + (i % 27), ALEF + (Math.floor(i / 27) % 27));

  it('takes 400 rows with a 200-character title and 500 characters of details, all Hebrew, which is over 500KB of body', async () => {
    const w = world();
    const token = await device(w);
    const rows = Array.from({ length: 400 }, (_, i) => ({
      date: '2026-12-01',
      title: hebrewWord(i) + 'ב'.repeat(198),
      details: 'ג'.repeat(500),
    }));
    expect(rows.every((r) => r.title.length === 200)).toBe(true);
    const size = Buffer.byteLength(JSON.stringify({ rows }));
    expect(size).toBeGreaterThan(500 * 1024);
    expect(size).toBeLessThan(700 * 1024);
    const res = await save(w, token, rows);
    expect(res.statusCode).toBe(200);
    expect(board(w).exams).toHaveLength(400);
    expect((res.json() as DeviceResponse).class?.examBoard).toMatchObject({ kind: 'upload', count: 400, mine: true });
  });

  it('is cut off above 700KB with the too_big a phone knows, as the preview is, and not below it', async () => {
    const w = world();
    const token = await device(w);
    const withDetails = (bytes: number) => [{ date: '2026-12-01', title: 'מבחן', details: 'x'.repeat(bytes) }];
    // 690KB is read, and is refused for what it holds (the details are over 500 characters), not for its size
    const under = await save(w, token, withDetails(690 * 1024));
    expect([under.statusCode, (under.json() as { error: string }).error]).toEqual([422, 'bad_rows']);
    // 710KB of details and the few bytes round them are over 700KB
    const over = await save(w, token, withDetails(710 * 1024));
    expect([over.statusCode, over.json()]).toEqual([422, { error: 'too_big', message: expect.any(String) }]);
    expect(board(w).exams).toBeNull();
    // and a body that big under a wrong token is not even read
    const refused = await w.app.inject({ method: 'PUT', url: SAVE, headers: auth('made-up-token'), payload: { rows: withDetails(710 * 1024) } });
    expect(refused.statusCode).toBe(401);
  });

  describe('when two requests come at the same moment', () => {
    it('lets one of two devices bring the first board, and the other gets 403 and writes nothing', async () => {
      for (const order of ['first', 'second'] as const) {
        const w = world();
        const a = await device(w);
        const b = await classmate(w);
        const rowsA = [{ date: '2026-11-20', title: 'מבחן של א', details: null }];
        const rowsB = [{ date: '2026-11-21', title: 'מבחן של ב', details: null }, { date: '2026-11-22', title: 'עוד של ב', details: null }];
        // whichever of the two asks first is served first; the one that loses is told so, and wrote nothing
        const asks = [
          { device: w.db.devices[0]!, rows: rowsA, answer: () => save(w, a, rowsA) },
          { device: w.db.devices[1]!, rows: rowsB, answer: () => save(w, b, rowsB) },
        ];
        if (order === 'second') asks.reverse();
        const answers = await Promise.all(asks.map((ask) => ask.answer()));
        expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 403]);
        const winner = asks[answers.findIndex((r) => r.statusCode === 200)]!;
        expect(board(w).examCalendarSetBy).toBe(winner.device.id);
        expect((board(w).exams as { subject: string }[]).map((e) => e.subject)).toEqual(winner.rows.map((r) => r.title));
      }
    });

    it('lets one of a file and a calendar bring the first board', async () => {
      const w = world();
      const a = await device(w);
      const b = await classmate(w);
      const [file, calendar] = await Promise.all([save(w, a, ROWS), putDevice(w, b, { examCalendar: CAL })]);
      expect([file.statusCode, calendar.statusCode].sort()).toEqual([200, 403]);
      if (file.statusCode === 200) expect(board(w)).toMatchObject({ examBoardKind: 'upload', examCalendarId: null, examCalendarSetBy: w.db.devices[0]!.id });
      else expect(board(w)).toMatchObject({ examBoardKind: null, examCalendarId: CAL, examCalendarSetBy: w.db.devices[1]!.id });
    });

    it('does not turn away a device that asks three times at once for the first board: the board the first made is its own', async () => {
      const w = world();
      const a = await device(w);
      const answers = await Promise.all([save(w, a, ROWS.slice(0, 2)), save(w, a, ROWS), save(w, a, ROWS.slice(0, 1))]);
      expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(board(w).examCalendarSetBy).toBe(w.db.devices[0]!.id);
    });
  });
});

// ---- when a device was last seen -------------------------------------------------------------

describe('when a device was last seen (S-I3)', () => {
  it('is written by the feed route at most once a day, by a conditional update', async () => {
    const DAY = 24 * HOUR;
    const w = world();
    const token = await device(w);
    const me = w.db.devices[0]!;
    const writes: unknown[] = [];
    const updateMany = w.db.prisma.device.updateMany;
    w.db.prisma.device.updateMany = async (args) => {
      if ('lastSeenAt' in args.data) writes.push(args);
      return updateMany(args);
    };
    const feed = async () => expect((await w.app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).statusCode).toBe(200);

    // registered just now: a feed read writes nothing
    await feed();
    expect(writes).toHaveLength(0);
    // last seen two days ago: the next read writes it once, and the reads after it that day write nothing
    me.lastSeenAt = new Date(NOW.getTime() - 2 * DAY);
    await feed();
    await feed();
    await feed();
    expect(writes).toHaveLength(1);
    expect(me.lastSeenAt).toEqual(NOW);
    // a day and an hour later, once more
    const later = new Date(NOW.getTime() + DAY + HOUR);
    vi.setSystemTime(later);
    await feed();
    await feed();
    expect(writes).toHaveLength(2);
    expect(me.lastSeenAt).toEqual(later);
  });
});

// ---- telling the class ----------------------------------------------------------------------

describe('telling the class of its board', () => {
  const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nEND:VCALENDAR\r\n';
  const OTHER_CAL = 'aa11bb22cc33dd44@group.calendar.google.com';
  const eventFor = (setBy: string | null) => ({
    id: expect.any(String), classId: 'cls1', kind: 'exam_board', naturalKey: 'exam-board', change: 'created',
    payload: { before: null, after: { setBy }, partition: null },
  });
  const idOf = (w: World, n: number) => w.db.devices[n]!.id;

  it('is one event for the first board a student brings from a file, and the class is marked as told', async () => {
    const w = world();
    const token = await device(w);
    expect((await save(w, token, ROWS)).statusCode).toBe(200);
    expect(w.db.events).toEqual([eventFor(idOf(w, 0))]);
    expect(board(w).examBoardAnnouncedAt).toEqual(NOW);
    // no exam, no name: only who brought it, so that the device is not told of its own board
    expect(JSON.stringify(w.db.events)).not.toContain('מתמטיקה');
  });

  it('is one event for the first calendar the class has when it has an exam, and names the device that set it', async () => {
    const w = world();
    const token = await device(w);
    expect((await putDevice(w, token, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.icsAsked).toEqual([CAL]);
    expect(w.db.events).toEqual([eventFor(idOf(w, 0))]);
    expect(board(w).examBoardAnnouncedAt).toEqual(NOW);
  });

  it('is none for a calendar with no exam in it yet, and the class is not marked: the read that finds one tells it', async () => {
    let feed = EMPTY_ICS;
    const w = world({ ics: () => feed });
    const token = await device(w);
    expect((await putDevice(w, token, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.db.events).toEqual([]);
    expect(board(w).examBoardAnnouncedAt).toBeNull();
    feed = fixtureText('school-site', 'exams-yb.ics');
    expect((await putDevice(w, token, { examCalendar: OTHER_CAL })).statusCode).toBe(200);
    expect(w.db.events).toEqual([eventFor(idOf(w, 0))]);
  });

  it('is none for a calendar too big to read: its id is kept, nothing of it is, and the error is noted (S-C1)', async () => {
    const big = [
      'BEGIN:VCALENDAR',
      ...Array.from({ length: 2001 }, (_, i) => {
        const day = new Date(Date.UTC(2026, 8, 1 + (i % 360))).toISOString().slice(0, 10).replace(/-/g, '');
        return `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART;VALUE=DATE:${day}\r\nSUMMARY:מבחן ${i}\r\nEND:VEVENT`;
      }),
      'END:VCALENDAR',
    ].join('\r\n');
    const w = world({ ics: () => big });
    const token = await device(w);
    const res = await putDevice(w, token, { examCalendar: CAL });
    expect(res.statusCode).toBe(200);
    expect(board(w)).toMatchObject({ examCalendarId: CAL, exams: null, examsOkAt: null, examBoardAnnouncedAt: null, examsPolledAt: NOW });
    expect(String(board(w).examsError)).toMatch(/CalendarTooBigError/);
    expect(w.db.events).toEqual([]);
  });

  it('is none when the board is only replaced: the same file again, a calendar for a file, a file for a calendar', async () => {
    const w = world();
    const token = await device(w);
    await save(w, token, ROWS);
    expect(w.db.events).toHaveLength(1);
    await save(w, token, ROWS.slice(0, 2));
    expect((await putDevice(w, token, { examCalendar: CAL })).statusCode).toBe(200);
    expect(board(w)).toMatchObject({ examCalendarId: CAL, examBoardKind: null });
    expect((await putDevice(w, token, { examCalendar: OTHER_CAL })).statusCode).toBe(200);
    await save(w, token, ROWS);
    expect(board(w)).toMatchObject({ examCalendarId: null, examBoardKind: 'upload' });
    expect(w.db.events).toHaveLength(1);
    expect(board(w).examBoardAnnouncedAt).toEqual(NOW);
  });

  it('is none for a board a classmate is refused, or one the request did not change', async () => {
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    expect((await save(w, other, ROWS)).statusCode).toBe(403);
    expect((await putDevice(w, other, { examCalendar: CAL })).statusCode).toBe(403);
    expect((await save(w, token, [{ date: '2026-02-30', title: 'x' }])).statusCode).toBe(422);
    expect(w.db.events).toHaveLength(1);
  });

  it('is not told again when the board is removed and another brought within 30 days, however often (S-I1)', async () => {
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    expect((await putDevice(w, token, { examCalendar: null })).statusCode).toBe(200);
    // a clear keeps the mark: the class was told
    expect(board(w)).toMatchObject({ examBoardKind: null, examBoardAnnouncedAt: NOW });
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(200);
    // clear and save twice more, a file and then a calendar
    expect((await putDevice(w, other, { examCalendar: null })).statusCode).toBe(200);
    expect((await save(w, other, ROWS)).statusCode).toBe(200);
    expect((await putDevice(w, other, { examCalendar: null })).statusCode).toBe(200);
    expect((await putDevice(w, other, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.db.events).toEqual([eventFor(idOf(w, 0))]);
    expect(board(w).examBoardAnnouncedAt).toEqual(NOW);
  });

  it('is told again when the board was removed and another is brought 31 days after it was told, naming whoever brings it (S-I1)', async () => {
    const DAY = 24 * HOUR;
    const w = world();
    const token = await device(w);
    const other = await classmate(w);
    await save(w, token, ROWS);
    expect((await putDevice(w, token, { examCalendar: null })).statusCode).toBe(200);
    const later = new Date(NOW.getTime() + 31 * DAY);
    vi.setSystemTime(later);
    expect((await save(w, other, ROWS.slice(0, 1))).statusCode).toBe(200);
    expect(w.db.events).toEqual([eventFor(idOf(w, 0)), eventFor(idOf(w, 1))]);
    expect(board(w).examBoardAnnouncedAt).toEqual(later);
    // a board that is only replaced, another 31 days on, still tells no one; nor does a calendar's hourly read
    vi.setSystemTime(new Date(later.getTime() + 31 * DAY));
    expect((await save(w, other, ROWS)).statusCode).toBe(200);
    expect((await putDevice(w, other, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.db.events).toHaveLength(2);
  });

  it('is told 31 days on for a calendar brought where a removed board was, and not within them (S-I1)', async () => {
    const DAY = 24 * HOUR;
    const w = world();
    const token = await device(w);
    expect((await putDevice(w, token, { examCalendar: CAL })).statusCode).toBe(200);
    expect((await putDevice(w, token, { examCalendar: null })).statusCode).toBe(200);
    vi.setSystemTime(new Date(NOW.getTime() + 29 * DAY));
    expect((await putDevice(w, token, { examCalendar: OTHER_CAL })).statusCode).toBe(200);
    expect(w.db.events).toHaveLength(1);
    expect((await putDevice(w, token, { examCalendar: null })).statusCode).toBe(200);
    vi.setSystemTime(new Date(NOW.getTime() + 31 * DAY));
    expect((await putDevice(w, token, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.db.events).toHaveLength(2);
  });

  it('is one event when the same device saves three times at once, and when two devices bring the first board at once', async () => {
    const one = world();
    const a = await device(one);
    expect((await Promise.all([save(one, a, ROWS), save(one, a, ROWS.slice(0, 2)), save(one, a, ROWS.slice(0, 1))])).map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(one.db.events).toEqual([eventFor(idOf(one, 0))]);

    const two = world();
    const first = await device(two);
    const second = await classmate(two);
    const answers = await Promise.all([save(two, first, ROWS), save(two, second, ROWS.slice(0, 2))]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    // the event names the device whose board it is, not the one that was refused
    expect(two.db.events).toEqual([eventFor(board(two).examCalendarSetBy as string)]);
  });

  describe('when the event cannot be made', () => {
    const MARK = 'LEAKMARK';

    it('does not fail the save, takes the mark back, logs the error\'s name only, and tells the class when the board is next saved', async () => {
      const lines: string[] = [];
      const w = world({ logLevel: 'trace', logStream: { write: (line) => void lines.push(line) } });
      const token = await device(w);
      w.db.eventFailure.on = true;
      const res = await save(w, token, ROWS);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(MARK);
      expect(board(w)).toMatchObject({ examBoardKind: 'upload', examBoardAnnouncedAt: null });
      expect(w.db.events).toEqual([]);
      expect(lines.some((l) => l.includes('RangeError'))).toBe(true);
      for (const line of lines) expect(line).not.toContain(MARK);

      w.db.eventFailure.on = false;
      expect((await save(w, token, ROWS.slice(0, 2))).statusCode).toBe(200);
      expect(w.db.events).toEqual([eventFor(idOf(w, 0))]);
      expect(board(w).examBoardAnnouncedAt).toEqual(NOW);
    });

    it('does the same for the calendar a request read at once', async () => {
      const w = world();
      const token = await device(w);
      w.db.eventFailure.on = true;
      const res = await putDevice(w, token, { examCalendar: CAL });
      expect(res.statusCode).toBe(200);
      expect(board(w)).toMatchObject({ examCalendarId: CAL, examBoardAnnouncedAt: null });
      expect((res.json() as DeviceResponse).class).toMatchObject({ examBoard: { kind: 'calendar', mine: true } });
      expect(w.db.events).toEqual([]);
    });
  });
});

describe('the log and the answers', () => {
  const MARK = 'LEAKMARK';

  it('hold nothing a device sent or a page held, whatever the preview comes to', async () => {
    const lines: string[] = [];
    const secretPage = html(`<p>${MARK}page</p><a href="/${MARK}board.pdf">${MARK}</a>`);
    const w = world({
      logLevel: 'trace',
      logStream: { write: (line) => void lines.push(line) },
      routes: { [`${BASE}/${MARK}path`]: secretPage },
    });
    const token = await device(w);
    const grid = fixtureBytes('exam-board', 'grade12-grid.xlsx');
    const answers = [
      await preview(w, token, { link: `${BASE}/${MARK}path` }),
      await preview(w, token, { link: `${BASE}/${MARK}missing` }),
      await preview(w, token, { file: { name: `${MARK}name.xlsx`, base64: b64(grid) } }),
      await preview(w, token, { file: { name: `${MARK}name.pdf`, base64: b64(strToU8(`%PDF ${MARK}`)) } }),
      await preview(w, token, { file: { name: `${MARK}name.xlsx`, base64: `${MARK}!!` } }),
      await preview(w, token, { link: `${MARK}`, file: { name: `${MARK}name.xlsx`, base64: 'AAAA' } }),
    ];
    for (const res of answers) expect(res.body, 'an answer').not.toContain(MARK);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(MARK);
  });

  it('keep what a failing parser says to themselves: the log holds its name only, the answer a code', async () => {
    const lines: string[] = [];
    const w = world({ logLevel: 'trace', logStream: { write: (line) => void lines.push(line) } });
    const token = await device(w);
    vi.mocked(extractBoard).mockImplementationOnce(() => {
      throw new RangeError(`${MARK} a cell said this`);
    });
    const res = await preview(w, token, fileOf(fixtureBytes('exam-board', 'grade9-list.xlsx')));
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'preview_failed', message: expect.any(String) });
    expect(res.body).not.toContain(MARK);
    expect(lines.some((l) => l.includes('RangeError'))).toBe(true);
    for (const line of lines) expect(line).not.toContain(MARK);
  });

  it('keep what a failing calendar says to themselves too: a bug in reading one is a 500, not a calendar that quietly goes missing', async () => {
    const two = `<iframe src="https://calendar.google.com/calendar/embed?src=a1%40group.calendar.google.com&amp;src=b2%40group.calendar.google.com"></iframe>`;
    for (const [what, page] of [['one calendar', `<iframe src="https://calendar.google.com/calendar/embed?src=a1%40group.calendar.google.com"></iframe>`], ['two, the other one fine', two]] as const) {
      const lines: string[] = [];
      const w = world({
        logLevel: 'trace',
        logStream: { write: (line) => void lines.push(line) },
        routes: { [`${BASE}/exams`]: html(page) },
        ics: (id) => {
          if (id.startsWith('a1')) throw new RangeError(`${MARK} a feed said this`);
          return fixtureText('school-site', 'exams-yb.ics');
        },
      });
      const token = await device(w);
      const res = await preview(w, token, { link: `${BASE}/exams` });
      expect([what, res.statusCode, res.json()]).toEqual([what, 500, { error: 'preview_failed', message: expect.any(String) }]);
      expect(res.body).not.toContain(MARK);
      expect(lines.some((l) => l.includes('RangeError'))).toBe(true);
      for (const line of lines) expect(line).not.toContain(MARK);
    }
  });
});
