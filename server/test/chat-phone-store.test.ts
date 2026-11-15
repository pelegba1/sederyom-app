/**
 * What the phone keeps about its chats (app/src/chat/store.ts): one small state
 * under `chat.state` with K, the shares and the last write, read leniently,
 * and K made fresh from the phone's random source. Pure over `KeyValue`: a Map
 * here, MMKV in the app.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_SHARES, fromB64u } from '@sederyom/shared';
import type { ChatState } from '../../app/src/chat/store';
import {
  CHAT_CODE_GRACE_MS, CHAT_KEYS, chatCodeLive, chatHoldsDevice, chatLinked, forgetChatLink, keptShares, newChatKey, readChatState, saveChatState, withoutChats,
} from '../../app/src/chat/store';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const EMPTY: ChatState = { key: null, shares: DEFAULT_CHAT_SHARES, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null };

describe('the chat state', () => {
  it('keeps itself under chat.state', () => {
    expect(CHAT_KEYS.state).toBe('chat.state');
  });

  it('reads as unlinked, with the default shares, on an empty store', () => {
    expect(readChatState(memoryKv())).toEqual(EMPTY);
  });

  it('reads the same for stored text that is not JSON, or not an object', () => {
    for (const text of ['{not json', 'null', '[1,2]', '"text"', '42', '']) {
      const kv = memoryKv();
      kv.set(CHAT_KEYS.state, text);
      expect(readChatState(kv)).toEqual(EMPTY);
    }
  });

  it('does not hand out the shared default object itself', () => {
    const state = readChatState(memoryKv());
    state.shares.grades = true;
    expect(DEFAULT_CHAT_SHARES.grades).toBe(false);
    expect(readChatState(memoryKv()).shares.grades).toBe(false);
  });

  it('reads a share that is missing as its default', () => {
    const kv = memoryKv();
    kv.set(CHAT_KEYS.state, JSON.stringify({ key: 'k', linked: true, shares: { homework: false, bagrut: true } }));
    const state = readChatState(kv);
    // grades was never stored: off, its default. homework and bagrut are as stored.
    expect(state.shares).toEqual({ ...DEFAULT_CHAT_SHARES, homework: false, bagrut: true });
    expect(state.shares.grades).toBe(DEFAULT_CHAT_SHARES.grades);
  });

  it('reads a share that is not a boolean as its default', () => {
    const kv = memoryKv();
    kv.set(CHAT_KEYS.state, JSON.stringify({ shares: { homework: 'no', grades: 1, bagrut: null, absences: {}, messages: 'true', google: [] } }));
    expect(readChatState(kv).shares).toEqual(DEFAULT_CHAT_SHARES);
    kv.set(CHAT_KEYS.state, JSON.stringify({ shares: 'all' }));
    expect(readChatState(kv).shares).toEqual(DEFAULT_CHAT_SHARES);
  });

  it('reads the shares a development build stored, with the Google switch, without it', () => {
    const kv = memoryKv();
    const stored = { homework: true, grades: true, bagrut: false, absences: true, messages: false, google: true };
    kv.set(CHAT_KEYS.state, JSON.stringify({ key: 'k', linked: true, shares: stored }));
    const { shares } = readChatState(kv);
    expect('google' in shares).toBe(false);
    expect(shares).toEqual({ homework: true, grades: true, bagrut: false, absences: true, messages: false });
    // What a screen hands back with a stray switch is kept without it, too.
    expect('google' in keptShares(stored)).toBe(false);
    // And once the state is saved again the switch is gone from the store.
    saveChatState(kv, readChatState(kv));
    expect(kv.map.get(CHAT_KEYS.state)).not.toContain('google');
  });

  it('reads the other fields only as what they should be', () => {
    const kv = memoryKv();
    kv.set(CHAT_KEYS.state, JSON.stringify({ key: 7, linked: 'yes', lastHash: ['x'], lastWrittenAt: 5, codeExpiresAt: 1_800_000_000_000 }));
    expect(readChatState(kv)).toEqual(EMPTY);
    // A state saved before the field existed has none.
    kv.set(CHAT_KEYS.state, JSON.stringify({ key: 'k', linked: true }));
    expect(readChatState(kv).codeExpiresAt).toBeNull();
    kv.set(CHAT_KEYS.state, JSON.stringify({ codeExpiresAt: '' }));
    expect(readChatState(kv).codeExpiresAt).toBeNull();
    // An empty key is no key.
    kv.set(CHAT_KEYS.state, JSON.stringify({ key: '', linked: true }));
    expect(readChatState(kv)).toEqual({ ...EMPTY, linked: true });
  });

  it('gives back what was saved', () => {
    const kv = memoryKv();
    const state: ChatState = {
      key: newChatKey(),
      shares: { homework: true, grades: true, bagrut: false, absences: true, messages: false },
      linked: true,
      lastHash: 'ab12'.repeat(32),
      lastWrittenAt: '2026-11-05T08:00:00.000Z',
      codeExpiresAt: '2026-11-05T08:10:00.000Z',
    };
    saveChatState(kv, state);
    expect(readChatState(kv)).toEqual(state);
    expect(kv.map.has(CHAT_KEYS.state)).toBe(true);
  });

  it('tells whether a chat is linked without the other fields', () => {
    const kv = memoryKv();
    expect(chatLinked(kv)).toBe(false);
    saveChatState(kv, { ...EMPTY, key: newChatKey(), linked: true });
    expect(chatLinked(kv)).toBe(true);
    saveChatState(kv, forgetChatLink(readChatState(kv)));
    expect(chatLinked(kv)).toBe(false);
  });

  it('holds the device for a linked chat, and for a code waiting for one (K made, no chat yet)', () => {
    const kv = memoryKv();
    // The truth table: linked or K.
    for (const [key, linked, holds] of [[null, false, false], [newChatKey(), false, true], [null, true, true], [newChatKey(), true, true]] as const) {
      saveChatState(kv, { ...EMPTY, key, linked });
      expect(chatHoldsDevice(kv)).toBe(holds);
    }
    // And nothing stored holds nothing.
    expect(chatHoldsDevice(memoryKv())).toBe(false);
    // The write path still goes by the link alone: a code waiting is not a chat to write for.
    saveChatState(kv, { ...EMPTY, key: newChatKey(), linked: false });
    expect(chatLinked(kv)).toBe(false);
    // Once everything is forgotten the device is let go.
    saveChatState(kv, forgetChatLink({ ...EMPTY, key: newChatKey(), linked: false, codeExpiresAt: '2026-11-05T08:10:00.000Z' }));
    expect(chatHoldsDevice(kv)).toBe(false);
  });

  it('tells whether the code waiting for a chat can still be used, with a minute of grace for the phone\'s clock', () => {
    const now = new Date('2026-11-05T08:00:00.000Z');
    const live = (codeExpiresAt: string | null) => chatCodeLive({ ...EMPTY, key: 'k', codeExpiresAt }, now);
    expect(CHAT_CODE_GRACE_MS).toBe(60_000);
    expect(live('2026-11-05T08:10:00.000Z')).toBe(true);
    expect(live('2026-11-05T08:00:00.001Z')).toBe(true);
    // Expired by the server's clock, but within the minute the phone's may be ahead by: still live.
    expect(live('2026-11-05T08:00:00.000Z')).toBe(true);
    expect(live('2026-11-05T07:59:00.001Z')).toBe(true);
    // A whole minute past, no longer.
    expect(live('2026-11-05T07:59:00.000Z')).toBe(false);
    expect(live('2026-11-05T07:50:00.000Z')).toBe(false);
    // None made yet, or one that does not read: not a code that can be used.
    expect(live(null)).toBe(false);
    expect(live('לא תאריך')).toBe(false);
  });

  it('keeps K and the code when the last chat goes while a code is still out, and forgets everything otherwise', () => {
    const now = new Date('2026-11-05T08:00:00.000Z');
    const shares = { ...DEFAULT_CHAT_SHARES, grades: true };
    const live = '2026-11-05T08:05:00.000Z';
    const lapsed = '2026-11-05T07:50:00.000Z';
    const linked = (codeExpiresAt: string | null): ChatState => ({
      key: 'k', shares, linked: true, lastHash: 'h', lastWrittenAt: '2026-11-05T07:30:00.000Z', codeExpiresAt,
    });
    // Linked and a code out: back to a code waiting, with nothing written, K and the code kept.
    expect(withoutChats(linked(live), now)).toEqual({ key: 'k', shares, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: live });
    // No code out, one that expired, or one that does not read: as if no chat were left.
    for (const codeExpiresAt of [null, lapsed, 'לא תאריך']) {
      expect(withoutChats(linked(codeExpiresAt), now)).toEqual(forgetChatLink(linked(codeExpiresAt)));
    }
    // A code already waiting, with no link: live stays, expired goes.
    expect(withoutChats({ ...linked(live), linked: false, lastHash: null, lastWrittenAt: null }, now).key).toBe('k');
    expect(withoutChats({ ...linked(lapsed), linked: false, lastHash: null, lastWrittenAt: null }, now).key).toBeNull();
    // The old state is not changed.
    const before = linked(live);
    withoutChats(before, now);
    expect(before).toEqual(linked(live));
  });

  it('forgets the link and K and the last write and the code, and keeps the shares', () => {
    const shares = { homework: false, grades: true, bagrut: true, absences: false, messages: true };
    const before: ChatState = {
      key: newChatKey(), shares, linked: true, lastHash: 'h', lastWrittenAt: '2026-11-05T08:00:00.000Z', codeExpiresAt: '2026-11-05T08:10:00.000Z',
    };
    const after = forgetChatLink(before);
    expect(after).toEqual({ key: null, shares, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null });
    // The old state is not changed.
    expect(before.linked).toBe(true);
    expect(before.key).not.toBeNull();
  });
});

describe('the chat key', () => {
  it('is 43 characters of base64url that are 32 bytes', () => {
    for (let i = 0; i < 20; i += 1) {
      const key = newChatKey();
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fromB64u(key)).toHaveLength(32);
    }
  });

  it('is new each time', () => {
    const keys = new Set(Array.from({ length: 20 }, () => newChatKey()));
    expect(keys.size).toBe(20);
  });
});
