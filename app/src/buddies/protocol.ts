/**
 * Friends made by a link, and their boxes kept in step
 * (docs/superpowers/specs/2026-10-29-friends-design.md, 4.3 to 4.5).
 *
 *   A  createInvite   S, a one-off key pair; the invite box (S, 'invite') holds
 *                     A's name, what A offers, the public key and how many may
 *                     answer, sealed with S
 *   B  acceptInvite   reads it; S2; the first free reply box (S, 'reply',
 *                     'reply-1', and on) holds B's name, shares and S2, sealed
 *                     to A's public key; B's box (S2, 'b2a')
 *   A  syncBuddies    opens the replies; A's box (S2, 'a2b') for each
 *   B  syncBuddies    reads A's box for the first time, deletes the reply box
 *
 * From there on everything comes from S2, which never travelled in a link, and
 * each person who answers has an S2 of their own. The server holds each box for
 * the device that wrote it first, so a reply box answers once: a phone that
 * finds one taken goes on to the next, and only with none left is the link
 * `'used'`. The ids and ciphertext are all the server ever sees.
 *
 * A link stays open for all who answer it, and closes (its invite box goes) when
 * every reply box is taken, it is `BUDDY_INVITE_TTL_DAYS` old, the friends are
 * at `MAX_BUDDIES`, I close it (`cancelInvites`), or I remove a friend who came
 * by it, who could otherwise answer it again (`removeBuddy`). An invite from an
 * older app says nothing of how many: it has the one reply box, and ends with
 * its first answer. An older app answering a new link writes that one box too.
 *
 * A friendship ends when a box this phone has read before is gone: the friend
 * deleted it (`removeBuddy`). A box never read is one not written yet, as when
 * B has answered and A has not synced, and is waited for (4.5), for a week and
 * a day: past that the pairing did not complete, and it ends too.
 *
 * The server keeps a used link's invite and reply boxes as empty marks once
 * their writers delete them, which read as no box and which nobody can write
 * again: a link forwarded after it was used reads `'gone'` (or `'used'`) and
 * cannot be armed again under the inviter's name.
 *
 * Pure over the server (`BuddyServer`) and the storage (`KeyValue`), so the
 * tests drive two phones and the server in memory; the app gives the device's
 * `/v2/buddies` calls and MMKV. Each step reads the state afresh after the
 * server has answered and saves what it changed, so a step that fails keeps
 * the steps before it, and a change made meanwhile (a friend removed, a name
 * given) is not written over.
 *
 * A write whose answer is lost (a timeout) may still have reached the server.
 * So what a write starts is saved before it: an invite as `unsent` until its
 * box is confirmed, which the sync takes back since its link was never given;
 * an answer to a link as a `PendingAnswer`, which is written again, the very
 * same reply, until confirmed, since the inviter may already hold its secret.
 *
 * Grades go in a second box each way, from the same S2 (`a2b-grades`,
 * `b2a-grades`; docs/superpowers/specs/2026-10-30-buddies-grades-design.md,
 * 4.2 to 4.4), and only while both friends share them: my choice
 * (`Buddy.shares.grades`) and theirs as their box last said it, or their invite
 * or reply before it was read (`theirSharesOf`). The phone that writes keeps
 * the rule, so no grade leaves a phone before the friend chose to share back;
 * the bagrut part goes only when both chose that too. A sync reads their
 * grades box with their main box, in the same request, and only then writes
 * or deletes mine (`syncGradeBoxes`), so a friend who turns grades on gets mine
 * in the sync that sees it. What this phone keeps of their grades
 * (`Buddy.theirGrades`) goes as soon as the rule stops holding, or their box is
 * not there. A grades box that is not there never ends a friendship: only the
 * main box does.
 */
import type {
  BuddyBoxContent, BuddyGradesContent, BuddyInviteContent, BuddyReplyContent, BuddyShares, PutBuddyBoxesBody, PutBuddyBoxesResponse, ReadBuddyBoxesResponse,
} from '@sederyom/shared';
import {
  BUDDY_BOX_ID, BUDDY_GRADES_REWRITE_DAYS, BUDDY_INVITE_TTL_DAYS, BUDDY_LINK_SLOTS, BUDDY_PUT_MAX, BUDDY_READ_MAX, BUDDY_REWRITE_MINUTES, MAX_BUDDIES,
} from '@sederyom/shared';
import { isolateName } from '../lib/format';
import type { KeyValue } from '../mashov/sync';
import { boxHash, fitBox } from './content';
import { boxIdOf, isPairingSecret, keyOf, newKeyPair, newSecret, openFrom, openSealed, replyLabel, seal, sealTo, type BuddyBoxLabel } from './crypto';
import { fitGrades, gradesHash } from './grades';
import { keptShares, readBuddies, saveBuddies, theirSharesOf, type Buddy, type BuddiesState, type PendingAnswer, type PendingInvite } from './store';
import { isBuddyName, readBoxContent, readGradesContent, readInviteContent, readReplyContent } from './validate';

/**
 * The device's `/v2/buddies` calls (spec 5). `remove` takes as many ids as
 * `read`. A refusal throws an error with the answer's HTTP `status`
 * (`V2Error`); anything else thrown means the server was not reached.
 */
export interface BuddyServer {
  put(boxes: PutBuddyBoxesBody['boxes']): Promise<PutBuddyBoxesResponse>;
  read(ids: string[]): Promise<ReadBuddyBoxesResponse>;
  remove(ids: string[]): Promise<void>;
}

/** The one-time lines the friends screen shows (`BuddiesState.notes`); each name in an isolate (`isolateName`), as in `BUDDY_COPY`. */
export const BUDDY_NOTES = {
  accepted: (name: string) => `${isolateName(name)} עכשיו ברשימת החברים שלך`,
  ended: (name: string) => `${isolateName(name)}: כבר לא חברים`,
  /** A friend whose first box never came within a week and a day: the pairing did not complete (4.5). */
  incomplete: (name: string) => `${isolateName(name)}: החיבור לא הושלם`,
} as const;

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Longer than any write takes: an unsent invite younger than this may still have its write on the way. */
const UNSENT_MINUTES = 10;

/** The state as it is now, changed by `change` and saved. */
function update(kv: KeyValue, change: (state: BuddiesState) => void): void {
  const state = readBuddies(kv);
  change(state);
  saveBuddies(kv, state);
}

/** A box id, or `null` for a secret that is not one: a damaged record is skipped, not let throw. */
function idOf(secret: string, label: BuddyBoxLabel): string | null {
  try {
    return boxIdOf(secret, label);
  } catch {
    return null;
  }
}

/** The reply boxes of a link that takes `slots` answers, first to last; a damaged secret has none. */
function replyIdsOf(secret: string, slots: number): string[] {
  const ids: string[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const id = idOf(secret, replyLabel(slot));
    if (id) ids.push(id);
  }
  return ids;
}

/** The inviter writes a2b and reads b2a; the invitee the other way round. The grades boxes go the same way. */
const outLabel = (buddy: Buddy): BuddyBoxLabel => (buddy.role === 'inviter' ? 'a2b' : 'b2a');
const inLabel = (buddy: Buddy): BuddyBoxLabel => (buddy.role === 'inviter' ? 'b2a' : 'a2b');
const outGradesLabel = (buddy: Buddy): BuddyBoxLabel => (buddy.role === 'inviter' ? 'a2b-grades' : 'b2a-grades');
const inGradesLabel = (buddy: Buddy): BuddyBoxLabel => (buddy.role === 'inviter' ? 'b2a-grades' : 'a2b-grades');

/**
 * Every box I may have written for a friend: my main box, my grades box, and
 * my reply to their link while it is kept. The one list each ending goes by
 * (`removeBuddy`, `dropAllBoxes`, a friend gone in `readTheirs`), so a box
 * added later is not forgotten in one of them. An id this phone cannot make is
 * `null`, which `removeAll` skips.
 */
const myBoxIds = (buddy: Buddy): (string | null | undefined)[] => [idOf(buddy.secret, outLabel(buddy)), idOf(buddy.secret, outGradesLabel(buddy)), buddy.replyId];

/** The friend as this phone shows them: my name for them, else theirs as their box says it now. */
const shownName = (buddy: Buddy): string => buddy.label || buddy.theirs?.name || buddy.name;

/**
 * My grades box for one friend, as Mashov last gave them on this phone, with
 * the bagrut part when `withBagrut` (`myGradesContent`); `null` when Mashov was
 * never read here, and then nothing is written.
 */
export type MyGrades = (withBagrut: boolean) => BuddyGradesContent | null;

/** Whether grades go between us: both of us chose them (grades spec 4.2). */
const gradesBoth = (buddy: Buddy): boolean => buddy.shares.grades === true && theirSharesOf(buddy).grades === true;

/** Whether the bagrut part goes too: both of us chose that as well. */
const bagrutBoth = (buddy: Buddy): boolean => gradesBoth(buddy) && buddy.shares.bagrut === true && theirSharesOf(buddy).bagrut === true;

/** Whether they share grades, or the bagrut, that I do not: what the grades tab's dot is for (grades spec 2.4). */
const asksOfMe = (mine: BuddyShares, theirs: BuddyShares): boolean =>
  (theirs.grades === true && mine.grades !== true) || (theirs.bagrut === true && mine.bagrut !== true);

/**
 * How long a friend whose box was never read here is waited for: longer than
 * any link lives (`BUDDY_INVITE_TTL_DAYS`), and a day more. Past it the
 * pairing did not complete: the other phone removed me before my first read,
 * never came back for my answer, or lost its own (4.5).
 */
const FIRST_BOX_DAYS = BUDDY_INVITE_TTL_DAYS + 1;

/** The phone's handle for a friend (`Buddy.id`, never sent anywhere): both phones of a pair come to the same one. */
const localId = (pairSecret: string): string => boxIdOf(pairSecret, 'a2b').slice(0, 8);

/** Places taken toward `MAX_BUDDIES`: friends, invites, and answers that will be friends. */
const used = (state: BuddiesState): number => state.buddies.length + state.invites.length + state.answers.length;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Each id's ciphertext, `null` for a box that is not there; ids the server did not answer are left out. */
async function readAll(server: BuddyServer, ids: readonly string[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  for (const part of chunks([...new Set(ids)], BUDDY_READ_MAX)) {
    for (const box of (await server.read(part)).boxes) found.set(box.id, box.ciphertext);
  }
  return found;
}

/** Whether each box was written, by id. */
async function putAll(server: BuddyServer, boxes: PutBuddyBoxesBody['boxes']): Promise<Map<string, boolean>> {
  const written = new Map<string, boolean>();
  for (const part of chunks(boxes, BUDDY_PUT_MAX)) {
    for (const result of (await server.put(part)).results) written.set(result.id, result.ok);
  }
  return written;
}

/** Only ids that are box ids: one damaged record must not have the server refuse the whole request. */
async function removeAll(server: BuddyServer, ids: readonly (string | null | undefined)[]): Promise<void> {
  const known = [...new Set(ids.filter((id): id is string => typeof id === 'string' && BUDDY_BOX_ID.test(id)))];
  for (const part of chunks(known, BUDDY_READ_MAX)) await server.remove(part);
}

/** The phone's own name, which every box carries: refused here rather than in a box its reader would refuse. */
function myName(state: BuddiesState): string {
  if (!isBuddyName(state.myName)) throw new Error('a name for friends comes first');
  return state.myName;
}

/**
 * A new invite: its secret, for the link (`buddyUrl`), or `'full'` when friends
 * and invites are at `MAX_BUDDIES`. The invite box holds my name, what I offer,
 * a one-off public key, and how many may answer: as many as there is room for,
 * so that a link nobody can be added from does not say otherwise. The key's
 * secret half stays here with the invite.
 * Throws when the box is not confirmed written (the server, or this device's
 * box cap). The invite is saved `unsent` before the write and left so only
 * when the write threw, since its box may be there all the same.
 */
export async function createInvite(kv: KeyValue, server: BuddyServer, shares: BuddyShares, now: Date): Promise<string | 'full'> {
  const state = readBuddies(kv);
  if (used(state) >= MAX_BUDDIES) return 'full';
  const offered = keptShares(shares);
  const secret = newSecret();
  const keys = newKeyPair();
  const slots = Math.min(BUDDY_LINK_SLOTS, MAX_BUDDIES - used(state));
  const content: BuddyInviteContent = { v: 1, name: myName(state), shares: offered, inviterKey: keys.publicKey, slots };
  const invite: PendingInvite = { secret, secretKey: keys.secretKey, shares: offered, createdAt: now.toISOString(), slots, unsent: true };
  update(kv, (s) => {
    s.invites.push(invite);
  });
  const id = boxIdOf(secret, 'invite');
  const result = (await server.put([{ id, kind: 'invite', ciphertext: seal(content, keyOf(secret)) }])).results.find((r) => r.id === id);
  update(kv, (s) => {
    const kept = s.invites.find((i) => i.secret === secret);
    if (result?.ok && kept) delete kept.unsent;
    // A refusal is an answer: nothing was written, so nothing is kept.
    else if (result) s.invites = s.invites.filter((i) => i.secret !== secret);
  });
  if (!result?.ok) throw new Error(`the invite was not written: ${result?.error ?? 'no answer'}`);
  return secret;
}

/**
 * The invite a link opens and its reply boxes that read free, from one read.
 * `'gone'` when the invite box is not there (it ran out, or was closed) or does
 * not read as an invite; `'used'` while it is there and every reply box holds
 * an answer. A box that reads free may still be a used one's empty mark, which
 * reads as no box: only the write can tell, and it goes on to the next
 * (`finishAnswer`). How many there are is the invite's to say, so all that any
 * invite could have are read at once.
 */
async function fetchInvite(server: BuddyServer, secret: string): Promise<{ invite: BuddyInviteContent; free: string[] } | 'used' | 'gone'> {
  if (!isPairingSecret(secret)) return 'gone';
  const inviteId = boxIdOf(secret, 'invite');
  const replyIds = replyIdsOf(secret, BUDDY_LINK_SLOTS);
  const found = await readAll(server, [inviteId, ...replyIds]);
  const sealed = found.get(inviteId) ?? null;
  if (sealed === null) return 'gone';
  const invite = readInviteContent(openSealed<unknown>(sealed, keyOf(secret)));
  if (!invite) return 'gone';
  const free = replyIds.slice(0, invite.slots ?? 1).filter((id) => (found.get(id) ?? null) === null);
  return free.length > 0 ? { invite, free } : 'used';
}

/** Who invites and what they offer, for the sheet that asks whether to accept. */
export async function readInvite(server: BuddyServer, secret: string): Promise<{ name: string; shares: BuddyShares } | 'used' | 'gone'> {
  const fetched = await fetchInvite(server, secret);
  return typeof fetched === 'string' ? fetched : { name: fetched.invite.name, shares: fetched.invite.shares };
}

/**
 * Writes the boxes of `buddies` that are due: never written, changed since
 * (`boxHash`, which leaves out `at`), or written `BUDDY_REWRITE_MINUTES` ago,
 * so "updated N ago" stays true and the server's sweep does not take the box
 * in a holiday (4.2). A box another device holds (`'taken'`) or one over this
 * device's cap stays due and is tried again next time. A box goes as it fits
 * the server's size cap (`fitBox`): one that cannot be made to fit is not
 * sent, and stays due.
 */
async function writeBoxes(
  kv: KeyValue,
  server: BuddyServer,
  buddies: readonly Buddy[],
  myContent: (shares: BuddyShares) => BuddyBoxContent,
  now: Date,
): Promise<void> {
  const due: { buddyId: string; id: string; hash: string; ciphertext: string }[] = [];
  for (const buddy of buddies) {
    const content = fitBox(myContent(buddy.shares), now);
    if (!content) continue;
    const hash = boxHash(content);
    const age = buddy.written ? now.getTime() - Date.parse(buddy.written.at) : Number.NaN;
    if (buddy.written?.hash === hash && age >= 0 && age < BUDDY_REWRITE_MINUTES * MINUTE) continue;
    const id = idOf(buddy.secret, outLabel(buddy));
    if (id) due.push({ buddyId: buddy.id, id, hash, ciphertext: seal(content, keyOf(buddy.secret)) });
  }
  if (due.length === 0) return;
  const written = await putAll(server, due.map(({ id, ciphertext }) => ({ id, kind: 'pair' as const, ciphertext })));
  const at = now.toISOString();
  update(kv, (s) => {
    for (const buddy of s.buddies) {
      const box = due.find((d) => d.buddyId === buddy.id);
      if (box && written.get(box.id) === true) buddy.written = { hash: box.hash, at };
    }
  });
}

/**
 * `gradesWritten`'s hash while a first write's answer is not known: no box has
 * it (`gradesHash` is 22 characters), so the box stays due, and counts as one
 * that may be there.
 */
const UNCONFIRMED = '';

/** A grades box without its bagrut part. */
const withoutBagrut = ({ bagrut: _bagrut, ...rest }: BuddyGradesContent): BuddyGradesContent => rest;

/**
 * My grades boxes for `buddies`, by what is known of their choices now (4.2,
 * 4.4): in a sync, what step 3 has just read.
 *
 * Where the rule no longer holds (I turned grades off, or their box says they
 * did) a grades box I wrote (`gradesWritten`) is deleted first, and then
 * forgotten; it needs no `myGrades`. Where it holds, the box is built from
 * `myGrades`, with the bagrut part only when both chose that too (left out
 * here otherwise, whatever `myGrades` gave), and fitted to the server's cap
 * (`fitGrades`). It is written when it changed since (`gradesHash`, which
 * leaves out `at`), or when the last write is `BUDDY_GRADES_REWRITE_DAYS` old,
 * so the server's sweep never takes it; not hourly, as the main box is:
 * "updated N ago" comes from that one. No `myGrades`, a phone that never read
 * Mashov (`null`), or a box nothing makes fit: nothing is written, and the
 * friend waits for a first one. A box another device holds, or one over this
 * device's cap, stays due.
 *
 * What a write starts is saved before it: a first write is kept as
 * `UNCONFIRMED` until the server confirms it, since a write whose answer is
 * lost may have arrived all the same. Kept so, the box is written again while
 * the rule holds, and deleted once it does not.
 */
async function syncGradeBoxes(kv: KeyValue, server: BuddyServer, buddies: readonly Buddy[], myGrades: MyGrades | undefined, now: Date): Promise<void> {
  const stop = new Map<string, string | null>();
  const due: { buddyId: string; id: string; hash: string; ciphertext: string }[] = [];
  /** Built once for each bagrut choice, however many friends: it is the same box. */
  const built = new Map<boolean, BuddyGradesContent | null>();
  for (const buddy of buddies) {
    if (!gradesBoth(buddy)) {
      if (buddy.gradesWritten) stop.set(buddy.id, idOf(buddy.secret, outGradesLabel(buddy)));
      continue;
    }
    if (!myGrades) continue;
    const withBagrut = bagrutBoth(buddy);
    if (!built.has(withBagrut)) {
      const content = myGrades(withBagrut);
      built.set(withBagrut, content && fitGrades(withBagrut ? content : withoutBagrut(content)));
    }
    const content = built.get(withBagrut);
    if (!content) continue;
    const hash = gradesHash(content);
    const age = buddy.gradesWritten ? now.getTime() - Date.parse(buddy.gradesWritten.at) : Number.NaN;
    if (buddy.gradesWritten?.hash === hash && age >= 0 && age < BUDDY_GRADES_REWRITE_DAYS * DAY) continue;
    const id = idOf(buddy.secret, outGradesLabel(buddy));
    if (id) due.push({ buddyId: buddy.id, id, hash, ciphertext: seal(content, keyOf(buddy.secret)) });
  }
  if (stop.size > 0) {
    await removeAll(server, [...stop.values()]);
    update(kv, (s) => {
      for (const buddy of s.buddies) if (stop.has(buddy.id)) buddy.gradesWritten = null;
    });
  }
  if (due.length === 0) return;
  const at = now.toISOString();
  update(kv, (s) => {
    for (const buddy of s.buddies) {
      if (!buddy.gradesWritten && due.some((d) => d.buddyId === buddy.id)) buddy.gradesWritten = { hash: UNCONFIRMED, at };
    }
  });
  const written = await putAll(server, due.map(({ id, ciphertext }) => ({ id, kind: 'pair' as const, ciphertext })));
  update(kv, (s) => {
    for (const buddy of s.buddies) {
      const box = due.find((d) => d.buddyId === buddy.id);
      // Kept even if the rule stopped holding meanwhile: the box is there, and the next sync deletes it. A refusal keeps what was.
      if (box && written.get(box.id) === true) buddy.gradesWritten = { hash: box.hash, at };
    }
  });
}

/** Whether `secret` is the link of an invite of mine: opening it here makes no friend (`acceptInvite` answers `'own'`). */
export function isOwnInvite(kv: KeyValue, secret: string): boolean {
  return readBuddies(kv).invites.some((invite) => invite.secret === secret);
}

/**
 * The friend, or the answer not yet confirmed, that this phone made from the
 * link of `secret`, which must be a whole one. A friend made before links took
 * several answers is known by its reply box, while that is kept.
 */
function madeHere(state: BuddiesState, secret: string): 'paired' | PendingAnswer | null {
  const inviteId = boxIdOf(secret, 'invite');
  const replyId = boxIdOf(secret, 'reply');
  if (state.buddies.some((b) => (b.role === 'invitee' && b.inviteId === inviteId) || b.replyId === replyId)) return 'paired';
  return state.answers.find((a) => a.inviteId === inviteId) ?? null;
}

/**
 * Whether this phone answered the link: a friend made from it, or an answer
 * not yet confirmed. A link stays open after its first answers, so the friend
 * counts for as long as the friendship lasts: otherwise opening the link again
 * would make the same friend twice. `acceptInvite` confirms or finishes it
 * instead, so the link may be opened again.
 */
export function isAnsweredHere(kv: KeyValue, secret: string): boolean {
  return isPairingSecret(secret) && madeHere(readBuddies(kv), secret) !== null;
}

type Finished = 'added' | 'had' | 'used' | 'gone';

/** Whether `err` is the server's answer refusing a call (it carries the HTTP `status`, `BuddyServer`), not a server out of reach. */
const refused = (err: unknown): boolean => err instanceof Error && typeof (err as { status?: unknown }).status === 'number';

/** A refusal the server answered with a 200: a write it did not confirm. */
const refusal = (message: string): Error => Object.assign(new Error(message), { status: 200 });

const settled = (finished: Finished): 'ok' | 'used' | 'gone' => (finished === 'added' || finished === 'had' ? 'ok' : finished);

/** Whether a saved answer can be written as it is: a damaged one never could be, and is dropped. */
const sound = (answer: PendingAnswer): boolean =>
  isPairingSecret(answer.secret) && BUDDY_BOX_ID.test(answer.replyId) && BUDDY_BOX_ID.test(answer.inviteId) && /^[A-Za-z0-9_-]+$/.test(answer.ciphertext) &&
  (answer.spare ?? []).every((id) => BUDDY_BOX_ID.test(id));

/**
 * Writes the reply of `answer` and, once the server confirms it, makes the
 * friend and writes my box for them, and my grades box when both of us chose
 * grades (what the invite offered says theirs; `syncGradeBoxes`), so a pairing
 * with both on passes grades after one sync of each phone. The same reply is
 * written every time, never a new one: written again, it is `ok` when it is
 * mine. `'taken'` means another phone has that box and my write never landed:
 * the reply goes on to the link's next free box (`spare`), saved before that
 * write as before every other, and with none left the answer is dropped. With
 * `check`, for an answer whose earlier write has an unknown fate, the two boxes
 * are read first: with neither there, my reply never arrived and the invite is
 * gone, and the answer is dropped as `'gone'`. A write that throws keeps the
 * answer. Making the friend twice makes one (`'had'`), so a double tap, or a
 * tap and a sync, end in one friend.
 */
async function finishAnswer(
  kv: KeyValue,
  server: BuddyServer,
  first: PendingAnswer,
  myContent: (shares: BuddyShares) => BuddyBoxContent,
  now: Date,
  check: boolean,
  myGrades: MyGrades | undefined,
): Promise<Finished> {
  let answer = first;
  const drop = () => {
    const { replyId } = answer;
    update(kv, (s) => {
      s.answers = s.answers.filter((a) => a.replyId !== replyId);
    });
  };
  if (!sound(answer)) {
    drop();
    return 'gone';
  }
  if (check) {
    const found = await readAll(server, [answer.inviteId, answer.replyId]);
    if ((found.get(answer.inviteId) ?? null) === null && (found.get(answer.replyId) ?? null) === null) {
      drop();
      return 'gone';
    }
  }
  for (;;) {
    const { replyId, ciphertext, spare } = answer;
    const result = (await server.put([{ id: replyId, kind: 'reply', ciphertext }])).results.find((r) => r.id === replyId);
    if (!result) throw refusal('the answer was not confirmed');
    if (result.ok) break;
    if (result.error !== 'taken') {
      drop();
      throw refusal(`the answer was not written: ${result.error ?? 'refused'}`);
    }
    const [next, ...rest] = spare ?? [];
    if (next === undefined) {
      drop();
      return 'used';
    }
    const moved: PendingAnswer = { ...answer, replyId: next, spare: rest };
    update(kv, (s) => {
      s.answers = s.answers.map((a) => (a.replyId === replyId ? moved : a));
    });
    answer = moved;
  }

  const written = answer;
  const id = localId(written.secret);
  let added = false;
  update(kv, (s) => {
    s.answers = s.answers.filter((a) => a.replyId !== written.replyId);
    if (s.buddies.some((b) => b.id === id)) return;
    s.buddies.push({
      id, role: 'invitee', secret: written.secret, name: written.name, label: '', shares: written.shares, offered: written.offered,
      theirs: null, readAt: null, everRead: false, written: null, theirGrades: null, gradesWritten: null,
      gradesDot: asksOfMe(written.shares, written.offered), addedAt: now.toISOString(), replyId: written.replyId, inviteId: written.inviteId,
    });
    added = true;
  });
  try {
    await writeBoxes(kv, server, readBuddies(kv).buddies.filter((b) => b.id === id), myContent, now);
    await syncGradeBoxes(kv, server, readBuddies(kv).buddies.filter((b) => b.id === id), myGrades, now);
  } catch {
    // `written` (or `gradesWritten`) is still null, so the next sync writes it.
  }
  return added ? 'added' : 'had';
}

/**
 * Answers the invite a link carries: `'ok'` and a new friend, or `'own'` (my
 * own link: nothing is done), `'full'`, `'used'` (other phones took every reply
 * box), `'gone'`. The answer is saved (`PendingAnswer`), then its reply written
 * alone, to the first free box and on to the next while another phone holds it:
 * with none left, nothing else was written, and
 * nothing is kept. A link this phone answered before is finished, or found
 * done, rather than answered again (`isAnsweredHere`). Throws when this phone
 * has no name yet, or the reply was not confirmed (the server, a lost answer,
 * this device's box cap); after a lost answer, the next sync or the next
 * opening of the link finishes it. `myGrades` is what my grades box is built
 * from, written at once when the invite offered grades and I chose them too.
 */
export async function acceptInvite(
  kv: KeyValue,
  server: BuddyServer,
  secret: string,
  myShares: BuddyShares,
  myContent: (shares: BuddyShares) => BuddyBoxContent,
  now: Date,
  myGrades?: MyGrades,
): Promise<'ok' | 'used' | 'gone' | 'full' | 'own'> {
  const state = readBuddies(kv);
  if (state.invites.some((invite) => invite.secret === secret)) return 'own';
  if (!isPairingSecret(secret)) return 'gone';
  const before = madeHere(state, secret);
  if (before === 'paired') return 'ok';
  if (before) return settled(await finishAnswer(kv, server, before, myContent, now, true, myGrades));
  if (used(state) >= MAX_BUDDIES) return 'full';
  const name = myName(state);
  const fetched = await fetchInvite(server, secret);
  // Another tap on the link may have answered it while this one waited.
  const meanwhile = madeHere(readBuddies(kv), secret);
  if (meanwhile === 'paired') return 'ok';
  if (meanwhile) return settled(await finishAnswer(kv, server, meanwhile, myContent, now, true, myGrades));
  if (typeof fetched === 'string') return fetched;

  const { invite, free } = fetched;
  const [replyId, ...spare] = free;
  if (replyId === undefined) return 'used';
  const shares = keptShares(myShares);
  const pairSecret = newSecret();
  const reply: BuddyReplyContent = { v: 1, name, shares, secret: pairSecret };
  const answer: PendingAnswer = {
    replyId, spare, inviteId: boxIdOf(secret, 'invite'), secret: pairSecret, name: invite.name, shares, offered: keptShares(invite.shares),
    ciphertext: sealTo(reply, invite.inviterKey),
  };
  update(kv, (s) => {
    s.answers.push(answer);
  });
  return settled(await finishAnswer(kv, server, answer, myContent, now, false, myGrades));
}

/**
 * Step 0: my answers not yet confirmed, finished or dropped (`finishAnswer`),
 * so a pairing whose answer was lost completes without the link, grades box
 * and all. A friend made here arrives as one from my own invites does: a note,
 * and `unseen`. An
 * answer the server refuses (`refused`) is passed over, and the others go
 * on, and so does the sync: one answer the server keeps refusing never holds
 * back the friends I have. A refused answer is kept for the next sync, and
 * dropped once its link is gone (the check finds neither box), a week on at
 * the most; one the server answered it will not write is dropped at once
 * (`finishAnswer`). A server out of reach fails the sync here, as in every
 * step.
 */
async function finishAnswers(
  kv: KeyValue,
  server: BuddyServer,
  myContent: (shares: BuddyShares) => BuddyBoxContent,
  now: Date,
  myGrades: MyGrades | undefined,
): Promise<string[]> {
  const names: string[] = [];
  for (const answer of readBuddies(kv).answers) {
    let finished: Finished;
    try {
      finished = await finishAnswer(kv, server, answer, myContent, now, true, myGrades);
    } catch (err) {
      if (!refused(err)) throw err;
      continue;
    }
    if (finished !== 'added') continue;
    names.push(answer.name);
    update(kv, (s) => {
      s.notes.push(BUDDY_NOTES.accepted(answer.name));
      s.unseen = true;
    });
  }
  return names;
}

/**
 * Step 1: the answers to my invites. Each answer that opens and reads makes a
 * friend, and is not taken in again (`repliesRead`). An invite says how many it
 * takes and stays open for them: its box goes, and it with it, once every reply
 * box is taken in, it is `BUDDY_INVITE_TTL_DAYS` old (or its time does not
 * read), or there is no room for another friend. An answer past that room is
 * left unread and its sender's pairing does not complete (`FIRST_BOX_DAYS`). An
 * invite from an older app ends with its first answer. An answer that came in
 * time still counts after the invite's days, or its sender would wait for me
 * for good. An answer that does not read is left for next time.
 * An `unsent` invite has no answer to look for; it is dropped, box and all,
 * `UNSENT_MINUTES` after it was made. A friend whose answer shares grades (or
 * the bagrut) that my invite did not arrives with the grades tab's dot.
 */
async function takeAnswers(kv: KeyValue, server: BuddyServer, now: Date): Promise<string[]> {
  const { buddies, invites, answers } = readBuddies(kv);
  if (invites.length === 0) return [];
  const replyIds = new Map<string, string[]>();
  for (const invite of invites) {
    if (invite.unsent) continue;
    const seen = new Set(invite.repliesRead);
    replyIds.set(invite.secret, replyIdsOf(invite.secret, invite.slots ?? 1).filter((id) => !seen.has(id)));
  }
  const toRead = [...replyIds.values()].flat();
  const found = toRead.length > 0 ? await readAll(server, toRead) : new Map<string, string | null>();

  const arrived: Buddy[] = [];
  const done = new Set<string>();
  const taken = new Map<string, string[]>();
  const drop: (string | null)[] = [];
  const at = now.toISOString();
  /** Places held besides `invite`'s own, which it gives up on closing: friends, answers on their way, other open invites. */
  const placesBesides = (invite: PendingInvite): number =>
    buddies.length + arrived.length + answers.length + invites.filter((other) => other !== invite && !done.has(other.secret)).length;
  for (const invite of invites) {
    const age = now.getTime() - Date.parse(invite.createdAt);
    if (invite.unsent) {
      // Its write may still be on its way; after that, the box goes if it is there.
      if (age < UNSENT_MINUTES * MINUTE) continue;
      done.add(invite.secret);
      drop.push(idOf(invite.secret, 'invite'));
      continue;
    }
    const newly: string[] = [];
    for (const replyId of replyIds.get(invite.secret) ?? []) {
      const ciphertext = found.get(replyId) ?? null;
      const reply = ciphertext === null ? null : readReplyContent(openFrom<unknown>(ciphertext, invite.secretKey));
      if (!reply) continue;
      // An older app's invite kept its place for its one answer.
      if (invite.slots !== undefined && placesBesides(invite) >= MAX_BUDDIES) break;
      newly.push(replyId);
      const id = localId(reply.secret);
      if (![...buddies, ...arrived].some((b) => b.id === id || b.secret === reply.secret)) {
        const offered = keptShares(reply.shares);
        const inviteId = idOf(invite.secret, 'invite');
        arrived.push({
          id, role: 'inviter', secret: reply.secret, name: reply.name, label: '', shares: invite.shares, offered,
          theirs: null, readAt: null, everRead: false, written: null, theirGrades: null, gradesWritten: null,
          gradesDot: asksOfMe(invite.shares, offered), addedAt: at, ...(inviteId ? { inviteId } : {}),
        });
      }
    }
    if (newly.length > 0) taken.set(invite.secret, newly);
    const expired = !(age < BUDDY_INVITE_TTL_DAYS * DAY);
    const closes = invite.slots === undefined
      ? newly.length > 0
      : (invite.repliesRead?.length ?? 0) + newly.length >= invite.slots || placesBesides(invite) >= MAX_BUDDIES;
    if (!expired && !closes) continue;
    done.add(invite.secret);
    drop.push(idOf(invite.secret, 'invite'));
  }
  if (done.size === 0 && taken.size === 0) return [];
  await removeAll(server, drop);
  const names: string[] = [];
  update(kv, (s) => {
    s.invites = s.invites.filter((invite) => !done.has(invite.secret));
    for (const invite of s.invites) {
      const newly = taken.get(invite.secret);
      if (newly) invite.repliesRead = [...(invite.repliesRead ?? []), ...newly];
    }
    for (const buddy of arrived) {
      if (s.buddies.some((b) => b.id === buddy.id)) continue;
      s.buddies.push(buddy);
      s.notes.push(BUDDY_NOTES.accepted(buddy.name));
      s.unseen = true;
      names.push(buddy.name);
    }
  });
  return names;
}

/**
 * Step 3: my friends' boxes. One that opens and reads is theirs from now on,
 * and their name with it (they may have renamed themselves); an invitee's
 * first one also means the reply box has done its work, and it goes. One that
 * is there but does not read changes nothing: the last good one stays, and
 * the friendship with it. One that is gone ends the friendship only when it
 * was read before (4.5); then my boxes for them go too, the grades box with
 * the main one. A friend whose box was never read here at all ends
 * `FIRST_BOX_DAYS` after they were added (or when that time does not read),
 * with a note of its own: the pairing did not complete.
 *
 * Their grades box is read in the same request, while I share grades: with
 * mine off nothing of theirs is kept, so it is not asked for. It is kept
 * (`theirGrades`) when both of us share grades, by their box as just read, and
 * it opens and reads; its bagrut part only when both chose that too, since
 * their box may still hold it from before I turned it off. Otherwise none is
 * kept: the rule does not hold, or the box is not there or does not read. That
 * never ends the friendship, and leaves no note. A friend whose box newly says
 * they share grades (or the bagrut) that I do not gets the grades tab's dot;
 * one whose box no longer asks anything of me loses it.
 */
async function readTheirs(kv: KeyValue, server: BuddyServer, now: Date): Promise<string[]> {
  const { buddies } = readBuddies(kv);
  const inIds = new Map<string, string>();
  const gradesIds = new Map<string, string>();
  for (const buddy of buddies) {
    const id = idOf(buddy.secret, inLabel(buddy));
    if (id) inIds.set(buddy.id, id);
    const gradesId = buddy.shares.grades === true ? idOf(buddy.secret, inGradesLabel(buddy)) : null;
    if (gradesId) gradesIds.set(buddy.id, gradesId);
  }
  if (inIds.size === 0) return [];
  const found = await readAll(server, [...inIds.values(), ...gradesIds.values()]);

  /** Each friend's grades box as read, `null` for one not there or that does not read; a friend whose box the server did not answer is left out. */
  const grades = new Map<string, BuddyGradesContent | null>();
  for (const buddy of buddies) {
    const id = gradesIds.get(buddy.id);
    if (!id || !found.has(id)) continue;
    const ciphertext = found.get(id) ?? null;
    grades.set(buddy.id, ciphertext === null ? null : readGradesContent(openSealed<unknown>(ciphertext, keyOf(buddy.secret))));
  }

  const opened = new Map<string, BuddyBoxContent>();
  /** Each friend that goes, and the note it leaves. */
  const gone = new Map<string, (name: string) => string>();
  const drop: (string | null | undefined)[] = [];
  for (const buddy of buddies) {
    const id = inIds.get(buddy.id);
    if (!id || !found.has(id)) continue;
    const ciphertext = found.get(id) ?? null;
    const content = ciphertext === null ? null : readBoxContent(openSealed<unknown>(ciphertext, keyOf(buddy.secret)));
    if (content) {
      opened.set(buddy.id, content);
      drop.push(buddy.replyId);
      continue;
    }
    let note: ((name: string) => string) | null = null;
    if (buddy.everRead) note = ciphertext === null ? BUDDY_NOTES.ended : null;
    else if (!(now.getTime() - Date.parse(buddy.addedAt) < FIRST_BOX_DAYS * DAY)) note = BUDDY_NOTES.incomplete;
    if (!note) continue;
    gone.set(buddy.id, note);
    drop.push(...myBoxIds(buddy));
  }
  await removeAll(server, drop);
  const names: string[] = [];
  update(kv, (s) => {
    // Named as the state has them now, and only those still in it: one removed here meanwhile needs no note.
    for (const buddy of s.buddies) {
      const note = gone.get(buddy.id);
      if (!note) continue;
      names.push(shownName(buddy));
      s.notes.push(note(shownName(buddy)));
    }
    s.buddies = s.buddies.filter((b) => !gone.has(b.id));
    for (const buddy of s.buddies) {
      const content = opened.get(buddy.id);
      const before = theirSharesOf(buddy);
      if (content) {
        buddy.theirs = content;
        buddy.name = content.name;
        buddy.readAt = content.at;
        buddy.everRead = true;
        delete buddy.replyId;
      }
      // By the state as it is now: my choice may have changed while the server answered.
      const after = theirSharesOf(buddy);
      const turnedOn = (!before.grades && after.grades === true && !buddy.shares.grades) || (!before.bagrut && after.bagrut === true && !buddy.shares.bagrut);
      const turnedOff = (before.grades === true && !after.grades) || (before.bagrut === true && !after.bagrut);
      if (turnedOn) buddy.gradesDot = true;
      else if (turnedOff && !asksOfMe(buddy.shares, after)) buddy.gradesDot = false;
      if (!gradesBoth(buddy)) buddy.theirGrades = null;
      else if (grades.has(buddy.id)) {
        const read = grades.get(buddy.id) ?? null;
        if (read && !bagrutBoth(buddy)) delete read.bagrut;
        buddy.theirGrades = read;
      }
    }
  });
  return names;
}

/**
 * One refresh of everything friends (4.4): my answers not yet confirmed, the
 * answers to my invites, then my boxes, then theirs (the grades boxes with
 * them), then my grades boxes by what was just read (`syncGradeBoxes`). In
 * that order, a friend who just answered gets my box in the same sync, and one
 * who just turned grades on gets my grades. `accepted` and `ended` are the
 * friends who arrived and who left (or whose pairing never completed), by the
 * name this phone shows. Network failures throw, after saving what the steps
 * before them did; an answer the server refuses waits for the next sync and
 * the rest go on (`finishAnswers`), as does a record this phone cannot make an
 * id for. With no `myGrades` no grades box is written, though one the rule no
 * longer allows is still deleted.
 */
export async function syncBuddies(
  kv: KeyValue,
  server: BuddyServer,
  myContent: (shares: BuddyShares) => BuddyBoxContent,
  now: Date,
  myGrades?: MyGrades,
): Promise<{ accepted: string[]; ended: string[] }> {
  const accepted = [...(await finishAnswers(kv, server, myContent, now, myGrades)), ...(await takeAnswers(kv, server, now))];
  await writeBoxes(kv, server, readBuddies(kv).buddies, myContent, now);
  const ended = await readTheirs(kv, server, now);
  await syncGradeBoxes(kv, server, readBuddies(kv).buddies, myGrades, now);
  return { accepted, ended };
}

/**
 * Ends a friendship from my side: my boxes for them go, the grades box with
 * the main one whatever is known of it, and my reply to their link if their
 * box was never read here, then they do. Their phone sees my box gone on its
 * next sync (4.5). A friend who came by a link of mine that is still open takes
 * it with them: they could otherwise answer it again and be back with one tap.
 * A failure on the server throws and keeps them.
 */
export async function removeBuddy(kv: KeyValue, server: BuddyServer, id: string): Promise<void> {
  const state = readBuddies(kv);
  const buddy = state.buddies.find((b) => b.id === id);
  if (!buddy) return;
  const link = openLinkOf(state, buddy);
  await removeAll(server, [...myBoxIds(buddy), link ? buddy.inviteId : null]);
  update(kv, (s) => {
    s.buddies = s.buddies.filter((b) => b.id !== id);
    if (link) s.invites = s.invites.filter((invite) => invite.secret !== link.secret);
  });
}

/** The link of mine, still open, that `buddy` came by. */
function openLinkOf(state: BuddiesState, buddy: Buddy): PendingInvite | undefined {
  if (buddy.role !== 'inviter' || buddy.inviteId === undefined) return undefined;
  return state.invites.find((invite) => idOf(invite.secret, 'invite') === buddy.inviteId);
}

/** Whether removing `buddy` also closes a link of mine (`removeBuddy`): the sheet that asks says so, since others may still be meant to use it. */
export const removalClosesLink = (state: BuddiesState, buddy: Buddy): boolean => openLinkOf(state, buddy) !== undefined;

/**
 * I stopped sharing grades with a friend (grades spec 2.5, 4.4). Their grades
 * (`theirGrades`) leave the phone first, before the server is asked anything;
 * then my grades box for them goes from the server, whatever is known of it,
 * not on the next sync; then the phone forgets it (`gradesWritten`). Called
 * once my choice says off, or the next sync writes it again. A failure on the
 * server throws, with their grades gone all the same and `gradesWritten` kept:
 * the caller may let it go, since the next sync deletes the box, the rule no
 * longer holding.
 */
export async function stopGrades(kv: KeyValue, server: BuddyServer, id: string): Promise<void> {
  const buddy = readBuddies(kv).buddies.find((b) => b.id === id);
  if (!buddy) return;
  update(kv, (s) => {
    const kept = s.buddies.find((b) => b.id === id);
    if (kept) kept.theirGrades = null;
  });
  await removeAll(server, [idOf(buddy.secret, outGradesLabel(buddy))]);
  update(kv, (s) => {
    const kept = s.buddies.find((b) => b.id === id);
    if (kept) kept.gradesWritten = null;
  });
}

/**
 * Closes my links that are still open (the friends screen's grey row): their
 * boxes go, which the server keeps as used marks, so a link already shared
 * reads `'gone'` and cannot be armed again; then they go from the phone. The
 * friends who already answered them stay. An invite still `unsent` was never
 * given out and is the sync's to take back. A failure on the server throws and
 * keeps them.
 */
export async function cancelInvites(kv: KeyValue, server: BuddyServer): Promise<void> {
  const sent = readBuddies(kv).invites.filter((invite) => !invite.unsent).map((invite) => invite.secret);
  if (sent.length === 0) return;
  await removeAll(server, sent.map((secret) => idOf(secret, 'invite')));
  const gone = new Set(sent);
  update(kv, (s) => {
    s.invites = s.invites.filter((invite) => !gone.has(invite.secret));
  });
}

/**
 * Every box this phone wrote, deleted: my boxes and my grades boxes, my
 * replies not yet read or not yet confirmed, my invites. For ״למחוק את הנתונים
 * שלי״, before the device goes (4.5); the state is the caller's to clear.
 */
export async function dropAllBoxes(kv: KeyValue, server: BuddyServer): Promise<void> {
  const { buddies, invites, answers } = readBuddies(kv);
  await removeAll(server, [
    ...buddies.flatMap(myBoxIds),
    ...invites.map((invite) => idOf(invite.secret, 'invite')),
    ...answers.map((answer) => answer.replyId),
  ]);
}
