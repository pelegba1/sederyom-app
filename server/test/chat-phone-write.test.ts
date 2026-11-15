/**
 * The write step of the chat connection (app/src/chat/write.ts): after a read
 * the phone fits its copy of the school day, seals it with K and puts it,
 * unless nothing changed within the hour; a chat found gone makes it forget
 * the link and K; a copy still too big after fitting is not put at all.
 *
 * The server is a fake that records the ciphertexts; the storage is a Map.
 * Nothing here reaches the phone's natives, so only `expo-constants` is
 * faked (`device/v2.ts` reads the API address through it).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_SNAPSHOT_JSON_MAX, DEFAULT_CHAT_SHARES, DEFAULT_SETTINGS, chatHash, fromB64u, openChat, toB64u,
  type ChatMessage, type ChatShares, type ChatSnapshot,
} from '@sederyom/shared';
import type { ChatState } from '../../app/src/chat/store';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const ZONE = 'Asia/Jerusalem';
/** A plain school Wednesday, 4.11.2026, 10:00 in Jerusalem. */
const NOW = new Date('2026-11-04T10:00:00+02:00');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const { demoData, demoSettings } = await import('../../app/src/demo/data');
const { demoSourcesFrom } = await import('../../app/src/demo/sources');
const { buildChatSnapshot, fitChatSnapshot } = await import('../../app/src/chat/snapshot');
const { CHAT_KEYS, forgetChatLink, readChatState, saveChatState, withoutChats } = await import('../../app/src/chat/store');
const { CHAT_REWRITE_AFTER_MS, snapshotHash, writeChat } = await import('../../app/src/chat/write');
const { V2Error } = await import('../../app/src/device/v2');

type Sources = ReturnType<typeof demoSourcesFrom>;

const ALL: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };
const SCHOOL = { name: null, className: 'י״א 2' };
const AT = NOW.toISOString();
const MINUTE = 60_000;
const later = (from: Date, minutes: number): Date => new Date(from.getTime() + minutes * MINUTE);

/** K as the phone keeps it: 32 bytes, base64url. */
const KEY = toB64u(Uint8Array.from({ length: 32 }, (_v, i) => i + 1));

const sources = (): Sources => demoSourcesFrom(demoData(NOW, ZONE), demoSettings(DEFAULT_SETTINGS), NOW, ZONE);
/** A message Mashov gave no date to: it is dated by the read that brought it. */
const undated = (n: number) =>
  ({ source: 'mashov', kind: 'message', naturalKey: `msg|${n}`, payload: { naturalKey: `msg|${n}`, date: null, title: `הודעה ${n}`, body: 'בלי תאריך', from: 'המחנכת', bodyFor: 'x' } }) as unknown as Sources['mashov'][number];
const withUndated = (src: Sources): Sources => ({ ...src, mashov: [...src.mashov, undated(1)] });

/** The copy as the phone builds it after the read at `at`. */
const buildAt = (src: Sources, at: string, shares: ChatShares = ALL): ChatSnapshot => buildChatSnapshot(src, shares, SCHOOL, at, { readAt: at });
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const LINKED: ChatState = { key: KEY, shares: DEFAULT_CHAT_SHARES, linked: true, lastHash: null, lastWrittenAt: null, codeExpiresAt: null };

/** A store holding `chat.state` as the phone keeps it once a chat is linked, with `over` changed. */
function linked(over: Partial<ChatState> = {}) {
  const kv = memoryKv();
  saveChatState(kv, { ...LINKED, ...over });
  return kv;
}

/** `/v2/chat/snapshot` as a fake: every ciphertext put is kept; `answer` decides what the put gives. */
function fakeServer(answer: () => 'ok' | 'no_device' = () => 'ok') {
  const puts: string[] = [];
  return {
    puts,
    putSnapshot: async (ciphertext: string): Promise<'ok' | 'no_device'> => {
      puts.push(ciphertext);
      return answer();
    },
  };
}

/** A server that refuses the put, as the real one does: with a status and an `error` code. */
const refusing = (status: number, code: string) => fakeServer(() => {
  throw new V2Error(status, `${code} (english)`, code);
});

const base = (): ChatSnapshot => buildAt(sources(), AT, DEFAULT_CHAT_SHARES);
const stateText = (kv: ReturnType<typeof memoryKv>): string | undefined => kv.map.get(CHAT_KEYS.state);

describe('snapshotHash', () => {
  it('is the hash of the copy without its read time', () => {
    const snapshot = base();
    expect(snapshotHash(snapshot)).toBe(chatHash(snapshot));
    expect(snapshotHash({ ...snapshot, at: '2026-11-04T10:30:00.000Z' })).toBe(snapshotHash(snapshot));
  });

  it('does not tell a message that has no date of its own from the read that dated it', () => {
    const src = withUndated(sources());
    const first = buildAt(src, AT);
    const next = buildAt(src, later(NOW, 30).toISOString());
    // What differs between the two is the read time and that message's date, and nothing else.
    expect(first.at).not.toBe(next.at);
    const undatedOf = (s: ChatSnapshot) => s.messages!.find((m) => m.title === 'הודעה 1')!;
    expect(undatedOf(first).date).toBe(first.at);
    expect(undatedOf(next).date).toBe(next.at);
    expect(wire({ ...first, at: '', messages: first.messages!.filter((m) => m.title !== 'הודעה 1') })).toEqual(
      wire({ ...next, at: '', messages: next.messages!.filter((m) => m.title !== 'הודעה 1') }),
    );
    expect(chatHash(first)).not.toBe(chatHash(next));
    expect(snapshotHash(first)).toBe(snapshotHash(next));
  });

  it('still tells a message that has a date of its own apart when that date changes', () => {
    const first = buildAt(sources(), AT);
    const messages: ChatMessage[] = first.messages!.map((m, i) => (i === 0 ? { ...m, date: '2020-01-01T00:00:00.000Z' } : m));
    expect(snapshotHash({ ...first, messages })).not.toBe(snapshotHash(first));
    // A new message, or a changed body, is a change as well.
    expect(snapshotHash({ ...first, messages: [...first.messages!, { date: AT, from: null, title: 'חדשה', body: '' }] })).not.toBe(snapshotHash(first));
  });

  it('keeps the keys where the builder wrote them, so an unchanged copy hashes alike', () => {
    const src = withUndated(sources());
    const first = buildAt(src, AT);
    expect(Object.keys(first)).toContain('messages');
    expect(Object.keys(JSON.parse(JSON.stringify({ ...first, messages: first.messages!.map((m) => ({ ...m, date: '' })) })))).toEqual(Object.keys(first));
    expect(snapshotHash(first)).toBe(snapshotHash(buildAt(src, AT)));
  });
});

describe('writeChat', () => {
  it('writes nothing for a phone with no chat linked', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    const build = vi.fn(base);
    expect(await writeChat({ kv, server, build, now: NOW })).toBe('unlinked');
    expect(server.puts).toEqual([]);
    expect(build).not.toHaveBeenCalled();
    expect(kv.map.size).toBe(0);

    // Unlinked, with K left over and a share chosen: still nothing, and nothing touched.
    const kept = linked({ linked: false, key: KEY, shares: { ...DEFAULT_CHAT_SHARES, grades: true } });
    const before = stateText(kept);
    expect(await writeChat({ kv: kept, server, build, now: NOW })).toBe('unlinked');
    expect(server.puts).toEqual([]);
    expect(stateText(kept)).toBe(before);
  });

  it('forgets the link of a state that is linked but holds no usable K', async () => {
    const stray = { ...DEFAULT_CHAT_SHARES, grades: true };
    // No K; a K that is not base64url; one that is, of 16 bytes; one of 33 bytes.
    for (const key of [null, '*not b64u*', toB64u(new Uint8Array(16).fill(3)), toB64u(new Uint8Array(33).fill(3))]) {
      const old: ChatState = { key, shares: stray, linked: true, lastHash: 'h', lastWrittenAt: AT, codeExpiresAt: null };
      const kv = linked(old);
      const server = fakeServer();
      const build = vi.fn(base);
      expect(await writeChat({ kv, server, build, now: NOW })).toBe('unlinked');
      expect(server.puts).toEqual([]);
      expect(build).not.toHaveBeenCalled();
      expect(readChatState(kv)).toEqual(forgetChatLink(old));
      expect(readChatState(kv)).toMatchObject({ linked: false, key: null, lastHash: null, lastWrittenAt: null, shares: stray });
    }
  });

  it('seals the fitted copy with K, puts it, and keeps its hash and when it was written', async () => {
    const kv = linked({ shares: ALL });
    const server = fakeServer();
    const snapshot = buildAt(sources(), AT);
    expect(await writeChat({ kv, server, build: () => snapshot, now: NOW })).toBe('written');
    expect(server.puts).toHaveLength(1);
    // The server sees a box; only K opens it, and what comes out is the copy.
    expect(server.puts[0]).not.toContain('הודעה');
    expect(openChat(server.puts[0]!, fromB64u(KEY)!)).toEqual(wire(fitChatSnapshot(snapshot)));
    expect(openChat(server.puts[0]!, new Uint8Array(32))).toBeNull();
    expect(readChatState(kv)).toEqual({ ...LINKED, shares: ALL, lastHash: snapshotHash(fitChatSnapshot(snapshot)), lastWrittenAt: NOW.toISOString() });
  });

  it('puts the copy as fitted when it is only too big as built', async () => {
    const kv = linked();
    const server = fakeServer();
    const messages: ChatMessage[] = Array.from({ length: 2000 }, (_v, n) => ({ date: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(), from: 'המחנכת', title: `הודעה ${n}`, body: 'x'.repeat(1000) }));
    const big: ChatSnapshot = { ...base(), messages };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
    expect(await writeChat({ kv, server, build: () => big, now: NOW })).toBe('written');
    const sent = openChat<ChatSnapshot>(server.puts[0]!, fromB64u(KEY)!)!;
    expect(sent.trimmed).toEqual(['messageBodies']);
    expect(sent.messages!.every((m) => m.body === '')).toBe(true);
    expect(readChatState(kv).lastHash).toBe(snapshotHash(fitChatSnapshot(big)));
  });

  it('does not write an unchanged copy again within the hour, and does after it', async () => {
    const kv = linked();
    const server = fakeServer();
    expect(await writeChat({ kv, server, build: base, now: NOW })).toBe('written');
    const first = stateText(kv);

    expect(await writeChat({ kv, server, build: base, now: later(NOW, 10) })).toBe('same');
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 59) })).toBe('same');
    expect(server.puts).toHaveLength(1);
    // Nothing changed, so nothing is kept anew: the time of the last write stays that of the last write.
    expect(stateText(kv)).toBe(first);

    // An hour is not "less than an hour".
    expect(CHAT_REWRITE_AFTER_MS).toBe(3_600_000);
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 61) })).toBe('written');
    expect(server.puts).toHaveLength(2);
    expect(readChatState(kv).lastWrittenAt).toBe(later(NOW, 61).toISOString());
    // And the hour counts from that one.
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 61 + 59) })).toBe('same');
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 61 + 60) })).toBe('written');
  });

  it('writes at once when forced, and when the content changed', async () => {
    const kv = linked();
    const server = fakeServer();
    await writeChat({ kv, server, build: base, now: NOW });
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 1), force: true })).toBe('written');
    expect(server.puts).toHaveLength(2);
    // A different copy within the hour: a homework tick, an exam, a new lesson.
    const changed = (): ChatSnapshot => ({ ...base(), exams: [] });
    expect(await writeChat({ kv, server, build: changed, now: later(NOW, 2) })).toBe('written');
    expect(server.puts).toHaveLength(3);
    expect(await writeChat({ kv, server, build: changed, now: later(NOW, 3) })).toBe('same');
    expect(readChatState(kv).lastHash).toBe(snapshotHash(changed()));
  });

  it('writes again when the time of the last write cannot be believed', async () => {
    for (const lastWrittenAt of ['not a time', later(NOW, 90).toISOString()]) {
      const same = base();
      const kv = linked({ lastHash: snapshotHash(same), lastWrittenAt });
      const server = fakeServer();
      // The hash is the last one's, but the last write is not an hour or less in the past: a clock that went back, or garbage.
      expect(await writeChat({ kv, server, build: () => same, now: NOW })).toBe('written');
      expect(readChatState(kv).lastWrittenAt).toBe(NOW.toISOString());
    }
  });

  it('does not write again for a copy that differs only by its read time (Review Focus 2)', async () => {
    const kv = linked({ shares: ALL });
    const server = fakeServer();
    const src = withUndated(sources());
    const read = (minutes: number) => () => buildAt(src, later(NOW, minutes).toISOString());
    expect(await writeChat({ kv, server, build: read(0), now: NOW })).toBe('written');
    // Another read ten minutes on: a later `at`, and the undated message dated by that read. Same content.
    expect(await writeChat({ kv, server, build: read(10), now: later(NOW, 10) })).toBe('same');
    expect(await writeChat({ kv, server, build: read(40), now: later(NOW, 40) })).toBe('same');
    expect(server.puts).toHaveLength(1);
    // Past the hour it is written all the same, so that "עודכן ב־…" stays true.
    expect(await writeChat({ kv, server, build: read(65), now: later(NOW, 65) })).toBe('written');
    expect(server.puts).toHaveLength(2);
  });

  it('forgets the link and K when the chat is cut (409 no_chat, Review Focus 3)', async () => {
    const old: ChatState = { key: KEY, shares: { ...DEFAULT_CHAT_SHARES, grades: true }, linked: true, lastHash: 'abc', lastWrittenAt: NOW.toISOString(), codeExpiresAt: null };
    const kv = linked(old);
    const server = refusing(409, 'no_chat');
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 90) })).toBe('unlinked');
    expect(server.puts).toHaveLength(1);
    expect(readChatState(kv)).toEqual(forgetChatLink(old));
    expect(readChatState(kv)).toMatchObject({ linked: false, key: null, lastHash: null, lastWrittenAt: null, shares: old.shares });
    // From then on the phone writes nothing and does not even build the copy.
    const build = vi.fn(base);
    expect(await writeChat({ kv, server, build, now: later(NOW, 200) })).toBe('unlinked');
    expect(build).not.toHaveBeenCalled();
    expect(server.puts).toHaveLength(1);
  });

  it('goes back to a code waiting, with K kept, when the chat is cut while a code made for another chat is still out', async () => {
    // A second code, made while this chat was linked, is good for ten more minutes (and a minute of grace): its chat will carry this K.
    const codeExpiresAt = later(NOW, 90 + 5).toISOString();
    const old: ChatState = { key: KEY, shares: { ...DEFAULT_CHAT_SHARES, grades: true }, linked: true, lastHash: 'abc', lastWrittenAt: NOW.toISOString(), codeExpiresAt };
    const kv = linked(old);
    const server = refusing(409, 'no_chat');
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 90) })).toBe('unlinked');
    expect(readChatState(kv)).toEqual({ ...old, linked: false, lastHash: null, lastWrittenAt: null });
    expect(withoutChats(old, later(NOW, 90))).toEqual(readChatState(kv));
    // Not linked, so nothing is written from here on, and the copy is not even built.
    const build = vi.fn(base);
    expect(await writeChat({ kv, server, build, now: later(NOW, 91) })).toBe('unlinked');
    expect(build).not.toHaveBeenCalled();
    expect(server.puts).toHaveLength(1);
    expect(readChatState(kv).key).toBe(KEY);
  });

  it('forgets K all the same when the code made for another chat has expired, or none was made', async () => {
    for (const codeExpiresAt of [later(NOW, 90 - 10).toISOString(), 'לא תאריך', null]) {
      const old: ChatState = { key: KEY, shares: DEFAULT_CHAT_SHARES, linked: true, lastHash: 'abc', lastWrittenAt: NOW.toISOString(), codeExpiresAt };
      const kv = linked(old);
      expect(await writeChat({ kv, server: refusing(409, 'no_chat'), build: base, now: later(NOW, 90) })).toBe('unlinked');
      expect(readChatState(kv)).toEqual(forgetChatLink(old));
    }
  });

  it('forgets the link and K when the server has no device for the phone any more, though a code is out: the device took its codes with it', async () => {
    for (const codeExpiresAt of [null, later(NOW, 90 + 5).toISOString()]) {
      const old: ChatState = { key: KEY, shares: DEFAULT_CHAT_SHARES, linked: true, lastHash: 'abc', lastWrittenAt: NOW.toISOString(), codeExpiresAt };
      const kv = linked(old);
      const server = fakeServer(() => 'no_device');
      expect(await writeChat({ kv, server, build: base, now: later(NOW, 90) })).toBe('unlinked');
      expect(readChatState(kv)).toEqual(forgetChatLink(old));
    }
  });

  it('does not put a copy that is still over the cap after fitting, and keeps the state as it was (Review Focus 5)', async () => {
    const old: ChatState = { key: KEY, shares: DEFAULT_CHAT_SHARES, linked: true, lastHash: 'abc', lastWrittenAt: NOW.toISOString(), codeExpiresAt: null };
    const kv = linked(old);
    const before = stateText(kv);
    const server = fakeServer();
    // Nothing a trim cuts: past days are not cut, the homework is not either.
    const padded = (): ChatSnapshot => {
      const snapshot = base();
      const first = snapshot.days[0]!;
      const lesson = first.lessons[0] ?? { date: first.date, hourIndex: 1, startTime: null, endTime: null, subject: 'מתמטיקה', teacher: null, room: null, status: 'regular' as const, substitute: null, note: null, source: 'shahaf' as const, changeSeenAt: null };
      const days = Array.from({ length: 2000 }, (_v, n) => ({ ...first, date: `2020-01-${String((n % 28) + 1).padStart(2, '0')}`, lessons: [{ ...lesson, note: 'ח'.repeat(300) }] }));
      return { ...snapshot, days };
    };
    const probe = fitChatSnapshot(padded());
    expect(new TextEncoder().encode(JSON.stringify(probe)).length).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);

    // Far past the hour and forced: the size is what stops it.
    expect(await writeChat({ kv, server, build: padded, now: later(NOW, 600), force: true })).toBe('too_large');
    expect(server.puts).toEqual([]);
    expect(stateText(kv)).toBe(before);
  });

  it('measures the cap in bytes, not in characters', async () => {
    const kv = linked();
    const server = fakeServer();
    // 300,000 Hebrew letters are 300,000 characters and 600,000 bytes: over 512 KB only as bytes.
    const heavy = (): ChatSnapshot => ({ ...base(), homework: [{ naturalKey: 'k', dueDate: null, subject: 'מתמטיקה', text: 'א'.repeat(300_000), done: false }] });
    expect(JSON.stringify(heavy()).length).toBeLessThan(CHAT_SNAPSHOT_JSON_MAX);
    expect(await writeChat({ kv, server, build: heavy, now: NOW })).toBe('too_large');
    expect(server.puts).toEqual([]);
  });

  it('throws other failures, and keeps the state as it was', async () => {
    const old: ChatState = { key: KEY, shares: DEFAULT_CHAT_SHARES, linked: true, lastHash: 'abc', lastWrittenAt: NOW.toISOString(), codeExpiresAt: null };
    for (const server of [
      refusing(500, 'internal'),
      refusing(409, 'something_else'),
      refusing(413, 'too_large'),
      fakeServer(() => {
        throw new TypeError('Network request failed');
      }),
    ]) {
      const kv = linked(old);
      const before = stateText(kv);
      await expect(writeChat({ kv, server, build: base, now: later(NOW, 90) })).rejects.toThrow();
      expect(server.puts).toHaveLength(1);
      expect(stateText(kv)).toBe(before);
    }
  });

  it('puts again after a failure, since nothing was kept of the failed write', async () => {
    const kv = linked();
    let fail = true;
    const server = fakeServer(() => {
      if (fail) throw new V2Error(500, 'HTTP 500');
      return 'ok';
    });
    await expect(writeChat({ kv, server, build: base, now: NOW })).rejects.toThrow();
    fail = false;
    expect(await writeChat({ kv, server, build: base, now: later(NOW, 1) })).toBe('written');
    expect(server.puts).toHaveLength(2);
  });
});
