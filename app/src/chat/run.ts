import '../buddies/random';
/**
 * The chat connection on the phone (docs/superpowers/specs/2026-11-04-chat-connection-design.md,
 * 4.1, 4.2 and 4.5): the refresh step, and the page's model and actions.
 *
 * - `refreshChat`, a step of `refreshLocalSources` after the friends' step:
 *   while a chat is linked it builds the phone's copy of the school day from
 *   what the phone holds, seals it with K and puts it (`writeChat`), unless
 *   nothing changed within the hour. With no chat linked and no code waiting
 *   for one it does nothing at all, and never reaches the network. While a code
 *   waits (K made, the link not on) it asks the server whether the chat came,
 *   and lets K go once the code has expired with none.
 * - `chatScreen`: the page's model over the chats the server says the device
 *   has (`view.ts`). It also keeps the link in step with them (`syncLink`): the
 *   first time a chat appears it links and writes the copy once, and when none
 *   is left (or the server forgot the device) it forgets the link and K (4.1).
 *   A phone with neither a link nor K (no code ever made, or K forgotten) has
 *   nothing to keep in step: the page is the empty one, with no request.
 * - The page's changes: a code for a new chat (`makeChatCode`, which makes K
 *   when the phone has none and saves it before asking), what is shared
 *   (`setChatShares`, written at once), an approval, and the cuts.
 *
 * One at a time: each waits for the one before (a single queue), so a write
 * never races a change of what is shared or a chat cut; every change of
 * `chat.state` is made inside it, `writeChat` included. A failure says
 * ״לא הצלחנו להתחבר. כדאי לנסות שוב.״ (`CHAT_COPY.failed`) or, for a copy too
 * big for the server, `CHAT_COPY.tooLarge`; never the server's words, and
 * nothing that holds K, a code, the copy or its ciphertext. Nothing at all
 * for a parent (no chats for a parent's phone, spec 1.2); in the demo nothing
 * reaches the network, the page is empty, and a change says
 * ״בהדגמה זה לא נשמר״.
 *
 * The import above installs the random source tweetnacl needs on the phone
 * (`buddies/random.ts`): the background task and the widget reach this file
 * without the app's entry.
 */
import type { ChatShares, ChatStatusResponse, CreateChatCodeResponse } from '@sederyom/shared';
import { TIMEZONE } from '../config';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { DEVICE_PLATFORM } from '../device/platform';
import { V2Error, chatServer } from '../device/v2';
import { readGradeWeights } from '../lib/gradeWeightsStore';
import { displayClassName } from '../lib/onboarding';
import { loadLocalSources } from '../local/source';
import { userSettings } from '../local/userSettings';
import { readFirstSeen } from '../mashov/gradeFirstSeen';
import { localRead } from '../mashov/sync';
import { storage } from '../widget/feedCache';
import { CHAT_COPY } from './copy';
import { buildChatSnapshot } from './snapshot';
import { chatCodeLive, forgetChatLink, keptShares, newChatKey, readChatState, saveChatState, withoutChats } from './store';
import { chatScreenModel, type ChatScreenView } from './view';
import { writeChat, type ChatWriteOutcome } from './write';

// ---------------------------------------------------------------------------
// One at a time
// ---------------------------------------------------------------------------

/** The last operation asked for, done or failed; the next one waits for it. */
let queue: Promise<unknown> = Promise.resolve();

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// The refresh step
// ---------------------------------------------------------------------------

const server = () => chatServer(storage, DEVICE_PLATFORM);

/** The copy of the school day as the phone has it now, for the chats that may read `shares`. */
function buildNow(now: Date) {
  const settings = userSettings();
  const readAt = localRead(storage)?.at;
  // The Mashov read the copy is of; a phone that never read has no messages or grades to date by it, so the moment will do.
  const at = readAt ?? now.toISOString();
  return buildChatSnapshot(
    loadLocalSources(now),
    readChatState(storage).shares,
    // The phone keeps no school name for a student (Mashov's `Semel` is an id, not a name): the chat's answers do without.
    { name: null, className: displayClassName(settings.className) || null },
    at,
    { firstSeen: readFirstSeen(storage), readAt, weights: readGradeWeights() },
  );
}

const isParent = (): boolean => userSettings().audience === 'parent';

/** The copy, written now whatever changed (the student changed what is shared, or the first chat came). In turn only: see `writeChat`. */
function writeNow(now: Date): Promise<ChatWriteOutcome> {
  return writeChat({ kv: storage, server: server(), build: () => buildNow(now), now, force: true });
}

/**
 * Brings the link in step with the chats the server says the device has, and
 * returns that status (`null`: no device, or the server forgot it). In turn only.
 * - A chat where the phone had none linked: it is linked now, and the copy is
 *   written once, forced, so the chat has one to read. The code's expiry is left
 *   as it is: the code may not be the last one made (`makeChatCode` keeps the
 *   newest's), so it ages out through `chatCodeLive` instead. (A phone with no K
 *   to seal it with finds that out in `writeChat`, which forgets the link again.)
 *   A write that fails is let go: the phone is linked, and the next refresh writes.
 * - No device (the server forgot it, and its codes with it): the link and K are
 *   forgotten, whatever the copy had and whatever code was out.
 * - No chat left on a device the server knows (spec 4.1; the page's side of
 *   Review Focus 3): the link and K are forgotten, unless a code made for another
 *   chat is still out, which will carry K to its chat: then the phone goes back
 *   to a code waiting, K and the code kept (`withoutChats`).
 * - A code waiting for its chat (K made, no link) and no chat yet: while the code
 *   can still be used nothing is changed; once it has expired K is forgotten, so
 *   that the device is no longer held for it.
 * - Otherwise nothing is changed and nothing is written: a look at the page
 *   writes nothing.
 */
async function syncLink(now: Date): Promise<ChatStatusResponse | null> {
  const status = await server().status();
  const state = readChatState(storage);
  if (status !== null && status.chats.length > 0) {
    if (!state.linked) {
      saveChatState(storage, { ...state, linked: true });
      await writeNow(now).catch(() => undefined);
    }
  } else if (status === null) {
    if (state.linked || state.key !== null) saveChatState(storage, forgetChatLink(state));
  } else if (state.linked || (state.key !== null && !chatCodeLive(state, now))) {
    saveChatState(storage, withoutChats(state, now));
  }
  return status;
}

/**
 * What `writeChat` said; `null` when there was nothing to write for: a parent, no chat linked, or a code still
 * waiting for its chat. While a code waits (`chatHoldsDevice` keeps the device for it) the status is read, so that
 * a chat that came while the page was closed is linked and gets its copy, and a code that expired lets K go. A
 * status that does not arrive is let go: nothing changes, and the next refresh asks again.
 */
async function refreshNow(): Promise<ChatWriteOutcome | null> {
  if (isParent()) return null;
  const now = new Date();
  const state = readChatState(storage);
  if (state.linked) return writeChat({ kv: storage, server: server(), build: () => buildNow(now), now });
  if (state.key !== null) await syncLink(now).catch(() => undefined);
  return null;
}

/**
 * The chat part of a refresh (4.2); nothing in the demo or for a parent, and no network while no chat is linked
 * and no code is waiting for one.
 * Rejects with `CHAT_COPY.tooLarge` for a copy the server would refuse, and with `CHAT_COPY.failed` for anything
 * else: these two errors are all that leaves, whatever went wrong inside.
 */
export function refreshChat(): Promise<void> {
  if (isDemo()) return Promise.resolve();
  return inTurn(refreshNow).then(
    (outcome) => {
      if (outcome === 'too_large') throw new Error(CHAT_COPY.tooLarge);
    },
    () => {
      throw new Error(CHAT_COPY.failed);
    },
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** An error that already says what it should: `action` lets it through as it is, and wraps any other as `CHAT_COPY.failed`. */
class Said extends Error {}

const failed = (err: unknown): never => {
  throw err instanceof Said ? err : new Error(CHAT_COPY.failed);
};

/** A change the page asks for: in turn, and in Hebrew when it fails; refused in the demo. */
function action<T>(work: () => Promise<T>): Promise<T> {
  if (isDemo()) return Promise.reject(new Error(DEMO_COPY.notSaved));
  return inTurn(work).catch(failed);
}

/**
 * The page's model at `now`. A read, so it is allowed in the demo and for a
 * parent, where it is the empty page and nothing reaches the network. So it is
 * for a phone that never made a code (or has forgotten K): no chat is linked and
 * none is waiting for a code, and the status is not asked for. Rejects with
 * `CHAT_COPY.failed` when the status does not arrive.
 */
export function chatScreen(now: Date): Promise<ChatScreenView> {
  if (isDemo() || isParent()) return Promise.resolve(chatScreenModel(null, readChatState(storage).shares, now, TIMEZONE));
  return inTurn(async () => {
    const state = readChatState(storage);
    if (!state.linked && state.key === null) return chatScreenModel(null, state.shares, now, TIMEZONE);
    const status = await syncLink(now);
    return chatScreenModel(status, readChatState(storage).shares, now, TIMEZONE);
  }).catch(failed);
}

/**
 * A code for a new chat, with K: the one the phone has, or a new one saved before
 * the request (so a code is never out without its K kept). K is forgotten when no
 * chat is left (spec 4.1), so a phone that holds K (linked, or with a code
 * waiting for its chat) first asks the server what chats it has, before the code:
 * a chat that came with the older code is linked then, and so cannot take this
 * code's expiry away when it is linked later; if none is left, or the server
 * forgot the device, the phone starts over with a new K. `'full'` for a device
 * that has all the chats it can. Never for a parent.
 */
export function makeChatCode(): Promise<CreateChatCodeResponse | 'full'> {
  return action(async () => {
    if (isParent()) throw new Error(CHAT_COPY.failed);
    if (readChatState(storage).key !== null) await syncLink(new Date());
    const kept = readChatState(storage);
    const key = kept.key ?? newChatKey();
    if (kept.key === null) saveChatState(storage, { ...kept, key });
    try {
      const made = await server().createCode(key);
      // The code is waiting for its chat from here on; until it expires the device is kept for it (`chatHoldsDevice`).
      saveChatState(storage, { ...readChatState(storage), codeExpiresAt: made.expiresAt });
      return made;
    } catch (err) {
      if (err instanceof V2Error && err.code === 'too_many') return 'full';
      throw err;
    }
  });
}

/**
 * What the chats may read. Kept, and, while a chat is linked, written at once so
 * that a choice turned off stops reaching the chat now. A write that fails keeps
 * the choice (the next refresh writes it) and says so; so does a copy too big
 * with the new choice.
 */
export function setChatShares(shares: ChatShares): Promise<void> {
  return action(async () => {
    if (isParent()) return;
    const state = readChatState(storage);
    saveChatState(storage, { ...state, shares: keptShares(shares) });
    if (!state.linked) return;
    if ((await writeNow(new Date())) === 'too_large') throw new Said(CHAT_COPY.tooLarge);
  });
}

/** Confirms a chat from a host the app does not know. */
export function approveChat(id: string): Promise<void> {
  return action(async () => {
    if (isParent()) return;
    await server().approve(id);
  });
}

/**
 * Cuts one chat. One the device no longer has is as good as cut. Then the status
 * is read, and the link goes with the last chat; a status that does not arrive is
 * let go, and the next look at the page settles it.
 */
export function cutChat(id: string): Promise<void> {
  return action(async () => {
    if (isParent()) return;
    try {
      await server().cut(id);
    } catch (err) {
      if (!(err instanceof V2Error && err.code === 'not_found')) throw err;
    }
    await syncLink(new Date()).catch(() => undefined);
  });
}

/** Cuts every chat, with the codes and the copy on the server; the link and K are forgotten with them. */
export function cutAllChats(): Promise<void> {
  return action(async () => {
    if (isParent()) return;
    await server().cutAll();
    saveChatState(storage, forgetChatLink(readChatState(storage)));
  });
}
