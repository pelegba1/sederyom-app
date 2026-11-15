/**
 * Mashov mail against the real shapes (plan §14.1, §14.9), de-identified in
 * `fixtures/mashov-w7/`: the date is when the message was sent, never when
 * the server fetched it; the body comes from the conversation detail, read
 * sparingly; the grade-wide recipient list never survives; and a message
 * whose date or body changes is not announced again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { describe, expect, it } from 'vitest';
import { MASHOV_PATHS } from '@sederyom/shared/logic/mashov/api';
import { decodeEntities, htmlToText } from '@sederyom/shared/logic/mashov/html';
import {
  MAIL_MAX_PAGES, MAIL_PAGE_SIZE, MESSAGE_BODY_READS_PER_POLL, conversationBody, normalizeMessage, readConversation, readInbox, readMessages, senderName,
  type MashovMessage, type StoredMessage,
} from '@sederyom/shared/logic/mashov/messages';
import type { NormalizedEntity } from '../src/adapters/types.js';
import { type PendingChange, planNotifications } from '../src/notify/engine.js';
import { MemorySnapshotStore, applyDelta, type ChangeEventDraft } from '../src/sync/delta.js';

const ZONE = 'Asia/Jerusalem';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'mashov-w7', name), 'utf8')) as T;
}

type Conversation = Record<string, unknown> & { conversationId: string; sendTime?: string; messages: Record<string, unknown>[] };

const inbox = () => fixture<Conversation[]>('conversations.json');
const detail = () => fixture<Conversation>('conversation.json');

/** A detail answer for any conversation: the captured one, with that conversation's id, time and a body naming it. */
function detailFor(conversation: Conversation): Conversation {
  const base = detail();
  const newest = conversation.messages[0]!;
  return {
    ...base,
    conversationId: conversation.conversationId,
    sendTime: conversation.sendTime,
    messages: [{ ...base.messages[0]!, sendTime: newest.sendTime, body: `<p>גוף ${conversation.conversationId}</p>` }],
  };
}

function detailServer(rows: Conversation[]) {
  const calls: string[] = [];
  const byId = new Map(rows.map((r) => [r.conversationId, r]));
  return {
    calls,
    detail: async (id: string) => {
      calls.push(id);
      const conversation = byId.get(id);
      if (!conversation) throw new Error(`no conversation ${id}`);
      return detailFor(conversation);
    },
  };
}

function storedFrom(messages: MashovMessage[]): Map<string, StoredMessage> {
  return new Map(messages.map((m) => [m.naturalKey, { body: m.body, bodyFor: m.bodyFor }]));
}

describe('message dates', () => {
  it('dates every conversation by its sendTime, read as Israel time', () => {
    const messages = inbox().map((c) => normalizeMessage(c, ZONE)!);
    expect(messages).toHaveLength(17);
    // Mashov shows 12:27; the answer says T12:27:32. Same wall clock, Israel's offset.
    expect(messages[0]!.date).toBe('2026-10-08T12:27:32.000+03:00');
    for (const [i, c] of inbox().entries()) {
      expect(messages[i]!.date!.slice(0, 19)).toBe(c.sendTime);
    }
  });

  it('falls back to the newest message, by time and not by position', () => {
    const c = inbox()[1]!; // two messages, 4.10 and 17.9
    delete c.sendTime;
    c.messages.reverse();
    expect(normalizeMessage(c, ZONE)!.date).toBe('2026-10-04T12:28:25.000+03:00');
  });

  it('never falls back to now: no time at all is null', () => {
    const c = inbox()[0]!;
    delete c.sendTime;
    for (const m of c.messages) delete m.sendTime;
    const head = readConversation(c, ZONE)!;
    expect(head.message.date).toBeNull();
    expect(head.sendTime).toBeNull();
  });

  it('is the same on every read — a poll later does not move it', () => {
    const c = inbox()[2]!;
    expect(normalizeMessage(c, ZONE)).toEqual(normalizeMessage(structuredClone(c), ZONE));
  });

  it('keys by conversation, so a reply is the same message, not a new one', () => {
    const c = inbox()[0]!;
    const reply = structuredClone(c);
    reply.sendTime = '2026-10-09T08:00:00';
    reply.messages.unshift({ ...c.messages[0]!, sendTime: '2026-10-09T08:00:00' });
    expect(normalizeMessage(reply, ZONE)!.naturalKey).toBe(normalizeMessage(c, ZONE)!.naturalKey);
  });
});

describe('message sender and title', () => {
  it('takes the newest message’s sender', () => {
    const c = inbox()[10]!; // newest by מורה 3, the earlier one by מורה 7
    expect(normalizeMessage(c, ZONE)!.from).toBe('מורה 3');
  });

  it('drops the role Mashov writes before a slash', () => {
    expect(senderName('מורים/מורה 1')).toBe('מורה 1');
    expect(senderName('מורה 1')).toBe('מורה 1');
    expect(senderName(null)).toBeNull();
  });

  it('falls back to the conversation’s own sender field', () => {
    const c = inbox()[0]!;
    for (const m of c.messages) delete m.senderName;
    c.senderName = 'מזכירות';
    expect(normalizeMessage(c, ZONE)!.from).toBe('מזכירות');
  });

  it('has no body before its detail is read', () => {
    expect(normalizeMessage(inbox()[0], ZONE)).toMatchObject({ title: 'הודעה 1', body: '', bodyFor: null });
  });

  it('never throws on a row it cannot understand', () => {
    for (const junk of [null, undefined, 42, 'string', [], {}]) expect(normalizeMessage(junk, ZONE)).toBeNull();
  });
});

describe('HTML to text', () => {
  it('reads the captured body', () => {
    expect(conversationBody(detail(), ZONE)).toBe('תלמידים יקרים, זו הודעה לדוגמה.');
  });

  it('breaks lines at <br>, </p> and </div>, and keeps one blank line at most', () => {
    expect(htmlToText('<p>שורה 1<br>שורה 2</p><p>&nbsp;</p><p></p><p>שורה 3</p>')).toBe('שורה 1\nשורה 2\n\nשורה 3');
    expect(htmlToText('<div>א</div><div>ב</div>')).toBe('א\nב');
    expect(htmlToText('<p>a</p><br><br><br><br/><p>b</p>')).toBe('a\n\nb');
  });

  it('reads source newlines in HTML as spaces, and collapses spaces', () => {
    expect(htmlToText('<p>שלום\n   לכולם</p>')).toBe('שלום לכולם');
  });

  it('keeps the line breaks of a body that has no markup', () => {
    expect(htmlToText('שורה ראשונה\n\n\n\nשורה שנייה')).toBe('שורה ראשונה\n\nשורה שנייה');
  });

  it('drops styles, scripts and comments', () => {
    expect(htmlToText('<style>p{color:red}</style><!-- x --><p>טקסט</p><script>alert(1)</script>')).toBe('טקסט');
  });

  it('decodes entities, and leaves an unknown one as written', () => {
    expect(htmlToText('<p>&lt;b&gt; &amp; &quot;ציטוט&quot; &#1488;&#x5D1; &unknown;</p>')).toBe('<b> & "ציטוט" אב &unknown;');
    expect(decodeEntities('&#0; &#xD800;')).toBe('&#0; &#xD800;');
  });
});

describe('the recipient list', () => {
  it('never reaches the payload: only the body is read from the detail', async () => {
    const rows = inbox();
    const { messages } = await readMessages(rows, { zone: ZONE, stored: new Map(), detail: async () => detail(), limit: 1 });
    const json = JSON.stringify(messages);
    expect(messages[0]!.body).toBe('תלמידים יקרים, זו הודעה לדוגמה.');
    for (const leak of ['recipients', 'cc', 'displayName', 'תלמיד/ה', 'קבוצה', 'files', 'קובץ-1.pdf', 'mshv-contact']) {
      expect(json).not.toContain(leak);
    }
  });
});

describe('reading message bodies', () => {
  it(`reads at most ${MESSAGE_BODY_READS_PER_POLL} details a poll, newest first, until the backlog is in`, async () => {
    const rows = inbox();
    const server = detailServer(rows);
    let stored = new Map<string, StoredMessage>();
    const readsPerPoll: number[] = [];
    let messages: MashovMessage[] = [];
    for (let poll = 0; poll < 6; poll += 1) {
      const result = await readMessages(rows, { zone: ZONE, stored, detail: server.detail });
      readsPerPoll.push(result.reads);
      messages = result.messages;
      stored = storedFrom(messages);
    }
    expect(readsPerPoll).toEqual([5, 5, 5, 2, 0, 0]);
    // Each conversation read once, in inbox order.
    expect(server.calls).toEqual(rows.map((r) => r.conversationId));
    expect(messages.every((m, i) => m.body === `גוף ${rows[i]!.conversationId}` && m.bodyFor === rows[i]!.sendTime)).toBe(true);
  });

  it('keeps the bodies it has for conversations past the limit, so none flips back to empty', async () => {
    const rows = inbox();
    const server = detailServer(rows);
    const first = await readMessages(rows, { zone: ZONE, stored: new Map(), detail: server.detail, limit: 2 });
    const second = await readMessages(rows, { zone: ZONE, stored: storedFrom(first.messages), detail: server.detail, limit: 2 });
    expect(second.messages.slice(0, 4).map((m) => m.body)).toEqual(rows.slice(0, 4).map((r) => `גוף ${r.conversationId}`));
  });

  it('reads a conversation again when its sendTime moves — a reply came in', async () => {
    const rows = inbox();
    const server = detailServer(rows);
    let stored = new Map<string, StoredMessage>();
    for (let poll = 0; poll < 4; poll += 1) stored = storedFrom((await readMessages(rows, { zone: ZONE, stored, detail: server.detail })).messages);
    server.calls.length = 0;

    rows[3]!.sendTime = '2026-10-09T08:15:00';
    rows[3]!.messages[0]!.sendTime = '2026-10-09T08:15:00';
    const { reads, messages } = await readMessages(rows, { zone: ZONE, stored, detail: server.detail });
    expect(reads).toBe(1);
    expect(server.calls).toEqual([rows[3]!.conversationId]);
    expect(messages[3]!.bodyFor).toBe('2026-10-09T08:15:00');
  });

  it('keeps the old body when a detail fails, and tries it again next poll', async () => {
    const rows = inbox().slice(0, 2);
    const errors: string[] = [];
    let fail = true;
    const read = (stored: Map<string, StoredMessage>) =>
      readMessages(rows, {
        zone: ZONE,
        stored,
        detail: async (id) => {
          if (fail && id === rows[0]!.conversationId) throw new Error('HTTP 500');
          return detailFor(rows.find((r) => r.conversationId === id)!);
        },
        onError: (id, err) => errors.push(`${id}: ${err.message}`),
      });
    const first = await read(new Map([[`mashov-msg|${rows[0]!.conversationId}`, { body: 'ישן', bodyFor: '2026-01-01T00:00:00' }]]));
    expect(first.messages[0]).toMatchObject({ body: 'ישן', bodyFor: '2026-01-01T00:00:00' });
    expect(errors).toEqual([`${rows[0]!.conversationId}: HTTP 500`]);

    fail = false;
    const second = await read(storedFrom(first.messages));
    expect(second.reads).toBe(1);
    expect(second.messages[0]!.body).toBe(`גוף ${rows[0]!.conversationId}`);
  });

  it('reads no detail when it cannot see what is stored', async () => {
    const server = detailServer(inbox());
    const { reads, messages } = await readMessages(inbox(), { zone: ZONE, stored: null, detail: server.detail });
    expect(reads).toBe(0);
    expect(server.calls).toEqual([]);
    expect(messages.every((m) => m.body === '')).toBe(true);
  });
});

describe('reading the inbox in pages', () => {
  /** `n` conversations, newest first, as Mashov lists them. */
  const conversations = (n: number): Conversation[] =>
    Array.from({ length: n }, (_, i) => ({
      conversationId: `c${i}`,
      subject: `הודעה ${i}`,
      sendTime: new Date(Date.UTC(2026, 9, 28, 12) - i * 3_600_000).toISOString().slice(0, 19),
      messages: [],
    }));

  /** A Mashov that honours `skip`, or with `ignoreSkip` always answers the first page; records each skip asked for. */
  function pager(all: unknown[], opts: { ignoreSkip?: boolean; failAt?: number } = {}) {
    const skips: number[] = [];
    return {
      skips,
      page: async (skip: number) => {
        skips.push(skip);
        if (skip === opts.failAt) throw new Error('HTTP 500');
        const from = opts.ignoreSkip ? 0 : skip;
        return all.slice(from, from + MAIL_PAGE_SIZE);
      },
    };
  }

  const read = (all: unknown[], mashov: ReturnType<typeof pager>, onError?: (skip: number, error: Error) => void) =>
    readInbox(all.slice(0, MAIL_PAGE_SIZE), mashov.page, ZONE, onError);

  it('asks for the page by its skip, with take=20', () => {
    expect(MASHOV_PATHS.mail()).toBe('/api/mail/inbox/conversations?skip=0&take=20');
    expect(MASHOV_PATHS.mail(40)).toBe('/api/mail/inbox/conversations?skip=40&take=20');
  });

  it('reads pages of 20 until a short one', async () => {
    const all = conversations(47);
    const mashov = pager(all);
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all);
    expect(inboxRead).toMatchObject({ pages: 3, complete: true });
    expect(mashov.skips).toEqual([20, 40]);
  });

  it(`stops at ${MAIL_MAX_PAGES} pages`, async () => {
    const all = conversations(150);
    const mashov = pager(all);
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all.slice(0, 100));
    // The cap is not a failure: only a page that throws makes the read incomplete.
    expect(inboxRead).toMatchObject({ pages: MAIL_MAX_PAGES, complete: true });
    expect(mashov.skips).toEqual([20, 40, 60, 80]);
  });

  it('stops when a page brings nothing new, as when Mashov ignores skip', async () => {
    const all = conversations(150);
    const mashov = pager(all, { ignoreSkip: true });
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all.slice(0, 20));
    expect(inboxRead).toMatchObject({ pages: 2, complete: true });
    expect(mashov.skips).toEqual([20]);
  });

  it('keeps what it has when a later page fails, and says so', async () => {
    const all = conversations(100);
    const mashov = pager(all, { failAt: 40 });
    const errors: [number, string][] = [];
    const inboxRead = await read(all, mashov, (skip, error) => errors.push([skip, error.message]));
    expect(inboxRead.rows).toEqual(all.slice(0, 40));
    expect(inboxRead).toMatchObject({ pages: 2, complete: false });
    expect(errors).toEqual([[40, 'HTTP 500']]);
    expect(mashov.skips).toEqual([20, 40]);
  });

  it('asks for no second page when the first is short', async () => {
    const all = conversations(12);
    const mashov = pager(all);
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all);
    expect(inboxRead).toMatchObject({ pages: 1, complete: true });
    expect(mashov.skips).toEqual([]);
  });

  it('counts a row it cannot read as new, and a repeated id as seen', async () => {
    const first = conversations(20);
    // No id, no subject, nothing to key it by: the read keeps it, as it cannot tell it from another.
    const unreadable = { messages: [] };
    const second = [unreadable, unreadable, first[3]!, ...conversations(25).slice(20, 22)];
    const inboxRead = await readInbox(first, async () => second, ZONE);
    // Both unreadable rows stay; the repeat of c3 is dropped.
    expect(inboxRead.rows).toEqual([...first, unreadable, unreadable, ...conversations(25).slice(20, 22)]);
  });

  it('merges id-less rows with the same subject and send time, as readConversation keys them alike', async () => {
    const first = conversations(20);
    const row = (subject: string, sendTime: string) => ({ subject, sendTime, messages: [] });
    const second = [
      row('בלי מזהה', '2026-10-20T08:00:00'),
      // The same conversation again, in another object.
      row('בלי מזהה', '2026-10-20T08:00:00'),
      // Another subject, and another time: both are new.
      row('נושא אחר', '2026-10-20T08:00:00'),
      row('בלי מזהה', '2026-10-21T08:00:00'),
    ];
    const inboxRead = await readInbox(first, async () => second, ZONE);
    expect(inboxRead.rows).toEqual([...first, second[0], second[2], second[3]]);
  });

  it('reads the id the way readConversation does: a row with only `id` is matched when Mashov ignores skip', async () => {
    // Mashov's list rows carry `id` on some servers; `readConversation` falls back to it.
    const all = conversations(150).map(({ conversationId, ...rest }) => ({ id: conversationId, ...rest }));
    const mashov = pager(all, { ignoreSkip: true });
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all.slice(0, 20));
    expect(inboxRead).toMatchObject({ pages: 2, complete: true });
    expect(mashov.skips).toEqual([20]);
  });

  it('matches id-less first-page rows too, so an ignored skip still ends the read', async () => {
    const all = conversations(150).map(({ conversationId: _id, ...rest }) => rest);
    const mashov = pager(all, { ignoreSkip: true });
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all.slice(0, 20));
    expect(inboxRead).toMatchObject({ pages: 2, complete: true });
    expect(mashov.skips).toEqual([20]);
  });

  it('matches a row whose id sits only on its newest message', async () => {
    const all = conversations(150).map(({ conversationId, ...rest }) => ({ ...rest, messages: [{ conversationId, sendTime: rest.sendTime }] }));
    const mashov = pager(all, { ignoreSkip: true });
    const inboxRead = await read(all, mashov);
    expect(inboxRead.rows).toEqual(all.slice(0, 20));
    expect(inboxRead).toMatchObject({ pages: 2, complete: true });
  });
});

describe('no notification burst', () => {
  // Teacher messages are off by default; on here, or nothing could be announced at all.
  const settings = { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, teacher_message: true } };
  const plan = (events: ChangeEventDraft[]) =>
    planNotifications(
      events.map((e, i): PendingChange => ({ id: i + 1, source: e.source, kind: e.kind, naturalKey: e.naturalKey, change: e.change, payload: e.payload })),
      { settings, today: '2026-10-09', tomorrow: '2026-10-10', nowTime: '16:00' },
    );
  const entities = (messages: MashovMessage[]): NormalizedEntity[] =>
    messages.map((m) => ({ source: 'mashov', kind: 'message', naturalKey: m.naturalKey, payload: m }));

  /**
   * What is stored today: the old normalizer's payload, dated by the fetch
   * and with no body. The first poll after the fix rewrites all of them.
   */
  function storedBeforeTheFix(): MashovMessage[] {
    return inbox().map((c) => ({ ...normalizeMessage(c, ZONE)!, date: '2026-10-09T10:00:00.000+03:00' }));
  }

  it('re-dating and filling in the stored messages announces none of them', async () => {
    const store = new MemorySnapshotStore();
    const old = storedBeforeTheFix().map(({ bodyFor: _b, ...rest }) => rest as MashovMessage);
    await applyDelta(store, 'mashov', entities(old), [{ kind: 'message' }], new Date('2026-10-09T07:00:00Z'));

    const rows = inbox();
    const { messages } = await readMessages(rows, { zone: ZONE, stored: new Map(), detail: detailServer(rows).detail });
    const delta = await applyDelta(store, 'mashov', entities(messages), [{ kind: 'message' }], new Date('2026-10-09T07:15:00Z'));
    expect(delta.updated).toBe(17);
    expect(delta.created).toBe(0);
    const { planned, discardedIds } = plan(delta.events);
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(17);
  });

  it('a date-only change is an update, and an update never notifies', async () => {
    const store = new MemorySnapshotStore();
    const before = normalizeMessage(inbox()[0], ZONE)!;
    await applyDelta(store, 'mashov', entities([before]), [{ kind: 'message' }], new Date());
    const after = { ...before, date: '2026-10-08T12:30:00.000+03:00' };
    const delta = await applyDelta(store, 'mashov', entities([after]), [{ kind: 'message' }], new Date());
    expect(delta.events.map((e) => e.change)).toEqual(['updated']);
    expect(plan(delta.events).planned).toEqual([]);
  });

  it('while a conversation that is really new still notifies', async () => {
    const store = new MemorySnapshotStore();
    const [first, ...rest] = inbox().map((c) => normalizeMessage(c, ZONE)!);
    await applyDelta(store, 'mashov', entities(rest), [{ kind: 'message' }], new Date());
    const delta = await applyDelta(store, 'mashov', entities([first!, ...rest]), [{ kind: 'message' }], new Date());
    const { planned } = plan(delta.events);
    expect(planned.map((p) => [p.type, p.push.title])).toEqual([['teacher_message', 'הודעה ממורה 1']]);
  });
});
