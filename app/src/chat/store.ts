/**
 * What the phone keeps about its chats (docs/superpowers/specs/2026-11-04-chat-connection-design.md,
 * 4.1 and 4.5), under `chat.state` in the app's key-value store.
 *
 * | Key          | Holds                                                                    |
 * |--------------|--------------------------------------------------------------------------|
 * | `chat.state` | `ChatState`: K, what a chat may read, whether a chat is linked, when the |
 * |              | last code expires, and the last copy written (its content hash and when) |
 *
 * K is 32 random bytes made once for the phone and used for every chat it
 * links; it is made when the first code is asked for and forgotten, with the
 * link, when no chat is left (`forgetChatLink`). It sits in the phone's own
 * storage and goes nowhere but `POST /v2/chat/codes` and, inside a chat's
 * tokens, to that chat: never to a log, a toast or a screen.
 *
 * Between a code made and its chat seen, K is there and the link is not: a code
 * is waiting (`chatHoldsDevice`). The device is kept for it, because deleting
 * the device would delete the chat that connects with that code; it is let go
 * once the code has expired with no chat (`chatCodeLive`, and `chat/run.ts`).
 * The code's expiry is kept when its chat is linked, too (it may be an older code's
 * chat, with a newer code still out): once no chat is left, K goes when the last
 * code made has expired.
 *
 * Pure over `KeyValue`: MMKV in the app, a Map in the tests. Kept apart from
 * `run.ts` (which needs the phone's natives) so that the rest of the app can ask
 * `chatLinked` and `chatHoldsDevice` without pulling them in.
 */
import type { ChatShares } from '@sederyom/shared';
import { DEFAULT_CHAT_SHARES, toB64u } from '@sederyom/shared';
import nacl from 'tweetnacl';
import type { KeyValue } from '../mashov/sync';

/** Where the state is kept. */
export const CHAT_KEYS = { state: 'chat.state' } as const;

/** Everything under `chat.state`. */
export interface ChatState {
  /**
   * K as base64url (43 characters); `null` before the first code and once no chat is left (or the code made for one has
   * expired with none). One for every chat the phone links: a later code carries the same K as the first.
   */
  key: string | null;
  /** What a chat may read; the snapshot carries it. Kept when the link is forgotten. */
  shares: ChatShares;
  /** Whether a chat has been seen on the server and none has been found gone since: the phone writes its copy while this is on. */
  linked: boolean;
  /** `chatHash` of the copy as last written, so an unchanged copy is not written again. */
  lastHash: string | null;
  /** When that copy was written. */
  lastWrittenAt: string | null;
  /**
   * The expiry of the last code made, as the server gave it (a code made later replaces it). Set whether or not a chat is
   * linked, so that a code made for a second chat keeps K when the first is cut (`withoutChats`). Never cleared when a chat
   * is linked: the chat may have come with an older code, and clearing would take the newest code's expiry away. A spent
   * code's expiry ages out through `chatCodeLive` (K may outlast a cut chat by up to the code's ten minutes and the grace
   * past them, which is harmless); it is cleared when everything is forgotten (`forgetChatLink`). `null` before any code.
   */
  codeExpiresAt: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * Choices as kept: each one that is not a boolean reads as its default, so a field added later is off (or on) as the contract says.
 * Only the contract's own switches are read, so one it dropped (the Google switch of a development build from before 2026-11-05) is not carried on from the store.
 */
export function keptShares(value: unknown): ChatShares {
  const stored = isRecord(value) ? value : {};
  const shares: ChatShares = { ...DEFAULT_CHAT_SHARES };
  for (const name of Object.keys(shares) as Array<keyof ChatShares>) {
    const choice = stored[name];
    if (typeof choice === 'boolean') shares[name] = choice;
  }
  return shares;
}

/** The chat state; an unlinked one with the default shares when there is none or it does not read. */
export function readChatState(kv: KeyValue): ChatState {
  let raw: unknown = null;
  try {
    const stored = kv.getString(CHAT_KEYS.state);
    raw = stored ? JSON.parse(stored) : null;
  } catch {
    raw = null;
  }
  const stored = isRecord(raw) ? raw : {};
  return {
    key: textOrNull(stored.key),
    shares: keptShares(stored.shares),
    linked: stored.linked === true,
    lastHash: textOrNull(stored.lastHash),
    lastWrittenAt: textOrNull(stored.lastWrittenAt),
    codeExpiresAt: textOrNull(stored.codeExpiresAt),
  };
}

/** Keeps the whole state; the caller reads, changes and saves. */
export function saveChatState(kv: KeyValue, state: ChatState): void {
  kv.set(CHAT_KEYS.state, JSON.stringify(state));
}

/** Whether a chat is linked on this phone: the friends' idle-device drop asks before it deletes the device (and the chats with it). */
export function chatLinked(kv: KeyValue): boolean {
  return readChatState(kv).linked;
}

/**
 * Whether the phone needs its device for a chat: one is linked, or a code is
 * waiting for one (K is made with the first code, and kept until it is
 * forgotten). The friends' idle-device drop asks this, not `chatLinked`: the
 * device's deletion takes every chat with it, including one that connects with
 * a code the phone has just made.
 */
export function chatHoldsDevice(kv: KeyValue): boolean {
  const state = readChatState(kv);
  return state.linked || state.key !== null;
}

/** A code counts as live this long after its expiry: the expiry is the server's clock, and a phone whose clock runs ahead must not let K go while the server still takes the code. */
export const CHAT_CODE_GRACE_MS = 60_000;

/**
 * Whether the code waiting for a chat can still be used at `now`: it has an
 * expiry that reads, and `CHAT_CODE_GRACE_MS` past it is ahead. A code with none
 * (K made, the server never answered with a code) or one that does not read is not.
 */
export function chatCodeLive(state: ChatState, now: Date): boolean {
  const expires = state.codeExpiresAt === null ? Number.NaN : Date.parse(state.codeExpiresAt);
  return now.getTime() < expires + CHAT_CODE_GRACE_MS;
}

/** The state once no chat is left: no link, no K, no code waiting, no last write. What the student chose to share stays for the next one. */
export function forgetChatLink(state: ChatState): ChatState {
  return { ...state, linked: false, key: null, lastHash: null, lastWrittenAt: null, codeExpiresAt: null };
}

/**
 * The state once the server has no chat for the device (the last one was cut, or the sweep found it gone). If a code
 * is still out (made for another chat, and not yet used), its chat will carry K, so K and the code stay and the phone
 * goes back to a code waiting: no link, nothing written until that chat comes. With no code out, everything is
 * forgotten as `forgetChatLink` does. Not for a device the server forgot: its codes went with it.
 */
export function withoutChats(state: ChatState, now: Date): ChatState {
  if (state.key === null || !chatCodeLive(state, now)) return forgetChatLink(state);
  return { ...state, linked: false, lastHash: null, lastWrittenAt: null };
}

/** A new K: 32 bytes from the phone's random source (`buddies/random.ts` sets it up where `run.ts` loads), as base64url. */
export function newChatKey(): string {
  return toB64u(nacl.randomBytes(32));
}
