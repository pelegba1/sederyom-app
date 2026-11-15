/**
 * The write step of the chat connection (docs/superpowers/specs/2026-11-04-chat-connection-design.md,
 * 4.2): after a read the phone builds its copy of the school day, fits it to
 * the size the server takes, seals it with K and puts it at
 * `PUT /v2/chat/snapshot`.
 *
 * - An unchanged copy is not written again (its hash, taken without the read
 *   time, is the last one's), unless the last write is an hour old, so that
 *   "עודכן ב־…" stays true; a change of what is shared writes at once (`force`).
 * - A chat found gone (`409 no_chat`), or a server with no device for the phone
 *   (a 401, which `chatServer` has already answered by forgetting the identity),
 *   means no chat is left: the link and K are forgotten, and nothing is written
 *   from then on. Except that a chat found gone while a code made for another
 *   chat is still out keeps K and the code, and goes back to a code waiting
 *   (`withoutChats`): that chat's copy is sealed with the same K when it comes.
 *   A device the server forgot took its codes with it: that always forgets.
 * - A copy still over `CHAT_SNAPSHOT_JSON_MAX` after fitting is not put (the
 *   server would refuse it), and the state stays as it was.
 * - Any other failure is the caller's: it is thrown, and nothing is kept of the
 *   write that failed.
 *
 * Over `KeyValue` and a server that has only `putSnapshot`, so a test can fake
 * both; kept apart from `run.ts` (which needs the phone's natives).
 */
import type { ChatSnapshot } from '@sederyom/shared';
import { CHAT_SNAPSHOT_JSON_MAX, chatHash, fromB64u, sealChat } from '@sederyom/shared';
import { V2Error, type ChatServer } from '../device/v2';
import type { KeyValue } from '../mashov/sync';
import { fitChatSnapshot } from './snapshot';
import { forgetChatLink, readChatState, saveChatState, withoutChats } from './store';

/** An unchanged copy is written again once the last write is this old (spec 4.2). */
export const CHAT_REWRITE_AFTER_MS = 3_600_000;

/** K is 32 bytes. */
const KEY_BYTES = 32;

/**
 * The hash that says whether the copy changed: `chatHash` without `at`, where a
 * message dated by the read that brought it (Mashov gave it no date: its `date`
 * is `at`) counts as undated. Two reads of the same content then hash alike,
 * though the second one's `at` and those messages' dates are later.
 *
 * Only a message's value changes, never where it sits among the keys, which is
 * the order `chatHash` follows.
 */
export function snapshotHash(s: ChatSnapshot): string {
  if (!s.messages) return chatHash(s);
  return chatHash({ ...s, messages: s.messages.map((m) => (m.date === s.at ? { ...m, date: '' } : m)) });
}

/** The size the copy is sealed at: its JSON in bytes (the measure `fitChatSnapshot` cuts to). */
const sizeOf = (s: ChatSnapshot): number => new TextEncoder().encode(JSON.stringify(s)).length;

/** Whether `lastWrittenAt` is a time less than `CHAT_REWRITE_AFTER_MS` before `now`; a time that is not one, or is ahead of the clock, is not. */
function recentlyWritten(lastWrittenAt: string | null, now: Date): boolean {
  const written = lastWrittenAt === null ? Number.NaN : Date.parse(lastWrittenAt);
  const age = now.getTime() - written;
  return age >= 0 && age < CHAT_REWRITE_AFTER_MS;
}

/**
 * - `written`: the copy was put, and its hash and time are kept.
 * - `same`: nothing changed within the hour, and nothing was put.
 * - `unlinked`: no chat is linked (or none is left, or K is unusable): the link is forgotten, and nothing was put.
 * - `too_large`: the copy is over the cap even fitted: nothing was put, and nothing was changed.
 */
export type ChatWriteOutcome = 'written' | 'same' | 'unlinked' | 'too_large';

export interface ChatWriteDeps {
  kv: KeyValue;
  server: Pick<ChatServer, 'putSnapshot'>;
  /** The copy as the phone has it now; called only when a chat is linked and K is usable. */
  build: () => ChatSnapshot;
  now: Date;
  /** Write even if nothing changed: the student changed what is shared. */
  force?: boolean;
}

/**
 * Puts the phone's copy for the linked chats, or says why not. Throws what the server's call throws, other than a chat found gone.
 *
 * Callers must serialize: it saves the state it read before its await, so it is safe only inside `run.ts`'s `inTurn` queue, one at a time with every other change of `chat.state`.
 */
export async function writeChat(deps: ChatWriteDeps): Promise<ChatWriteOutcome> {
  const { kv, server, build, now, force = false } = deps;
  const state = readChatState(kv);
  if (!state.linked) return 'unlinked';
  // Linked, but K is missing or is not 32 bytes: nothing can be sealed, and a chat could never open it. As if no chat were left.
  const key = state.key === null ? null : fromB64u(state.key);
  if (key === null || key.length !== KEY_BYTES) {
    saveChatState(kv, forgetChatLink(state));
    return 'unlinked';
  }

  const fit = fitChatSnapshot(build());
  if (sizeOf(fit) > CHAT_SNAPSHOT_JSON_MAX) return 'too_large';

  const hash = snapshotHash(fit);
  if (!force && hash === state.lastHash && recentlyWritten(state.lastWrittenAt, now)) return 'same';

  let put: Awaited<ReturnType<ChatServer['putSnapshot']>>;
  try {
    put = await server.putSnapshot(sealChat(fit, key));
  } catch (err) {
    // The chat was cut from its side or by the server's sweep: no chat is left, and so no K to keep, unless a code made for another chat is still out (`withoutChats`).
    if (err instanceof V2Error && err.code === 'no_chat') {
      saveChatState(kv, withoutChats(state, now));
      return 'unlinked';
    }
    throw err;
  }
  if (put === 'no_device') {
    saveChatState(kv, forgetChatLink(state));
    return 'unlinked';
  }
  saveChatState(kv, { ...state, lastHash: hash, lastWrittenAt: now.toISOString() });
  return 'written';
}
