/**
 * What the phone keeps about friends (docs/superpowers/specs/2026-10-29-friends-design.md,
 * 4 and 4.3), under `buddies.*` in the app's key-value store.
 *
 * | Key                     | Holds                                                                 |
 * |-------------------------|-----------------------------------------------------------------------|
 * | `buddies.state`         | `BuddiesState`: my name, the friends, the invites not yet answered,   |
 * |                         | and my answers to links whose write is not yet known to have arrived  |
 * | `buddies.incoming`      | the secret of a link opened here, until the invitee has answered it   |
 * | `buddies.feed|<site>|<class>` | the class feed of a friend's class, read for them (`buddyFeedKey`) |
 * | `buddies.school`        | Mashov's id of my school (`Semel`), as last read from the session, to |
 * |                         | tell a friend at my school when neither school has a site            |
 *
 * Pure over `KeyValue`: MMKV in the app, a Map in the tests. `KeyValue` has no
 * delete, so what is taken is overwritten with `''`, which reads as nothing.
 * The secrets in here never leave the phone: the server is given box ids and
 * ciphertext only (`crypto.ts`).
 */
import type { BuddyBoxContent, BuddyGradesContent, BuddyShares, Instant } from '@sederyom/shared';
import { BUDDY_INVITE_TTL_DAYS, BUDDY_LINK_SLOTS } from '@sederyom/shared';
import type { KeyValue } from '../mashov/sync';
import { readBoxContent, readGradesContent } from './validate';

/** Where each part is kept. */
export const BUDDY_KEYS = { state: 'buddies.state', incoming: 'buddies.incoming', feedPrefix: 'buddies.feed|', school: 'buddies.school' } as const;

/** One friend: a pairing both made, and what each phone knows of it. */
export interface Buddy {
  /** This phone's own handle for the friend; never sent anywhere. */
  id: string;
  /** Who invited whom: the one who made the link is the inviter. */
  role: 'inviter' | 'invitee';
  /** The pair secret (S2) the box ids and the key come from. */
  secret: string;
  /** The name the friend gave themselves. */
  name: string;
  /** My own name for them; `''` means theirs. */
  label: string;
  /** What I share with them. */
  shares: BuddyShares;
  /** Their box, as last read; `null` before the first. */
  theirs: BuddyBoxContent | null;
  /** When their box was last read from the server. */
  readAt: Instant | null;
  /** Whether their box was ever read, so "not there yet" and "gone" are told apart. */
  everRead: boolean;
  /** My box for them as last written: its content hash (`boxHash`) and when. */
  written: { hash: string; at: Instant } | null;
  /**
   * What they chose to share, as the invite (when I accepted) or the reply (when
   * I invited) carried it: all I know of their choices before their box is read.
   * `theirSharesOf` prefers the box once it is read; this stays, unused, after.
   * Absent for a friend kept before grades were shared.
   */
  offered?: BuddyShares;
  /** Their grades box as last read; `null` when none is kept (never read, or no longer shared). */
  theirGrades: BuddyGradesContent | null;
  /**
   * My grades box for them as last written: its content hash and when; `null` when none is there. A hash of `''` is a
   * first write whose answer is not known yet (`syncGradeBoxes`): the box may be there.
   */
  gradesWritten: { hash: string; at: Instant } | null;
  /** The dot on the grades tab (grades spec 2.4): they turned grades on, and I have not opened the tab since. */
  gradesDot: boolean;
  addedAt: Instant;
  /**
   * The id of the reply box I wrote when I accepted their link (an invitee
   * only), until their box is first read here and it is deleted. Kept as the
   * id: the link's secret it comes from is not kept once the link is used.
   */
  replyId?: string;
  /**
   * The invite box of the link that made this friendship, kept as long as it
   * lasts. An invitee's phone knows by it that a link opened again is one it
   * already answered; an inviter's closes that link when this friend is removed,
   * or they could answer it again. Absent for a friend made before links took
   * several answers.
   */
  inviteId?: string;
}

/** A link of mine that is still open: until its time is up, it is full, or I close it. */
export interface PendingInvite {
  /** The one-off secret in the link (S1). */
  secret: string;
  /** The one-off X25519 secret key the reply is sealed to. */
  secretKey: string;
  /** What I offered to share. */
  shares: BuddyShares;
  createdAt: Instant;
  /** How many people can answer it. Absent for an invite made before links took several answers: it ends with its first. */
  slots?: number;
  /** The reply boxes already taken in: each counts once toward `slots`, and is not read again. */
  repliesRead?: string[];
  /**
   * Set from just before the invite box is written until the server confirms
   * it. Still set after that, the write threw: the box may be there all the
   * same, but its link was never given out, so the sync takes the box back
   * once no write of it can still be on its way.
   */
  unsent?: true;
}

/**
 * My answer to someone's link, kept from just before its reply box is written
 * until the server has confirmed it. A write whose answer is lost (a timeout)
 * may still have reached the server, and the inviter may already be pairing
 * with the secret in it; so the very same reply is written again (by the
 * next sync, or when the link is opened again) rather than a new one made.
 */
export interface PendingAnswer {
  /** The reply box's id. */
  replyId: string;
  /** The link's other free reply boxes, tried in turn when another phone gets to this one first. */
  spare?: string[];
  /** The invite box's id, to tell a link that is gone from one still waiting. */
  inviteId: string;
  /** The pair secret (S2) the reply carries. */
  secret: string;
  /** The inviter's name. */
  name: string;
  /** What I share with them. */
  shares: BuddyShares;
  /** What the invite offered: their choices, kept for the friend this makes (`Buddy.offered`). */
  offered: BuddyShares;
  /** The reply as sealed to the inviter's key: it cannot be sealed again, the key is theirs. */
  ciphertext: string;
}

/** Everything under `buddies.state`. */
export interface BuddiesState {
  /** The name friends see for me; `''` before I have chosen one. */
  myName: string;
  buddies: Buddy[];
  invites: PendingInvite[];
  /** My answers to links, until the server has them (`PendingAnswer`). */
  answers: PendingAnswer[];
  /** A friend arrived or changed since the friends screen was last open. */
  unseen: boolean;
  /** One-time lines to show once, such as an ended friendship or an accepted invite. */
  notes: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const instant = (value: unknown): Instant | null => (typeof value === 'string' ? value : null);

/**
 * Choices as the phone keeps them. What is not clearly shared is not: a field that is not `true` reads as `false`, and so
 * does a record with no object at all. `grades` and `bagrut` came later: they are there only when on (missing reads as
 * off, as in a friend's box), and `bagrut` counts only along with `grades`. The same rule keeps what I offer and answer
 * with (`createInvite`, `acceptInvite`). Not `validate.ts`'s reading of a box's choices, which refuses what is not a
 * boolean, and keeps a `false`.
 */
export function keptShares(value: unknown): BuddyShares {
  const stored = isRecord(value) ? value : {};
  const shares: BuddyShares = { timetable: stored.timetable === true, absences: stored.absences === true };
  if (stored.grades === true) {
    shares.grades = true;
    if (stored.bagrut === true) shares.bagrut = true;
  }
  return shares;
}

/**
 * What the friend shares with me: their box as last read says it; before the
 * first read, what their invite or reply offered (`Buddy.offered`); and when
 * neither is known (a friend kept by an older app), nothing.
 */
export const theirSharesOf = (buddy: Buddy): BuddyShares => buddy.theirs?.shares ?? buddy.offered ?? { timetable: false, absences: false };

/** A box as last written, `{ hash, at }`; `null` when it is not that. */
function writtenOf(value: unknown): { hash: string; at: Instant } | null {
  return isRecord(value) && typeof value.hash === 'string' && typeof value.at === 'string' ? { hash: value.hash, at: value.at } : null;
}

function buddyOf(value: unknown): Buddy | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.secret !== 'string') return null;
  if (value.role !== 'inviter' && value.role !== 'invitee') return null;
  const buddy: Buddy = {
    id: value.id,
    role: value.role,
    secret: value.secret,
    name: text(value.name),
    label: text(value.label),
    shares: keptShares(value.shares),
    theirs: readBoxContent(value.theirs),
    readAt: instant(value.readAt),
    everRead: value.everRead === true,
    written: writtenOf(value.written),
    theirGrades: readGradesContent(value.theirGrades),
    gradesWritten: writtenOf(value.gradesWritten),
    gradesDot: value.gradesDot === true,
    addedAt: text(value.addedAt),
  };
  if (isRecord(value.offered)) buddy.offered = keptShares(value.offered);
  if (typeof value.replyId === 'string') buddy.replyId = value.replyId;
  if (typeof value.inviteId === 'string') buddy.inviteId = value.inviteId;
  return buddy;
}

/** The text items of a list; none when it is not one. */
const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function inviteOf(value: unknown): PendingInvite | null {
  if (!isRecord(value) || typeof value.secret !== 'string' || typeof value.secretKey !== 'string') return null;
  const invite: PendingInvite = { secret: value.secret, secretKey: value.secretKey, shares: keptShares(value.shares), createdAt: text(value.createdAt) };
  if (value.unsent === true) invite.unsent = true;
  if (typeof value.slots === 'number' && Number.isInteger(value.slots) && value.slots >= 1) invite.slots = Math.min(value.slots, BUDDY_LINK_SLOTS);
  const repliesRead = textsOf(value.repliesRead);
  if (repliesRead.length > 0) invite.repliesRead = repliesRead;
  return invite;
}

function answerOf(value: unknown): PendingAnswer | null {
  if (!isRecord(value)) return null;
  const { replyId, inviteId, secret, name, ciphertext } = value;
  if (typeof replyId !== 'string' || typeof inviteId !== 'string' || typeof secret !== 'string' || typeof name !== 'string' || typeof ciphertext !== 'string') return null;
  // An answer saved before grades were shared offered nothing that was ever read: all off.
  const answer: PendingAnswer = { replyId, inviteId, secret, name, shares: keptShares(value.shares), offered: keptShares(value.offered), ciphertext };
  const spare = textsOf(value.spare);
  if (spare.length > 0) answer.spare = spare;
  return answer;
}

function listOf<T>(value: unknown, read: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(read).filter((item): item is T => item !== null) : [];
}

/** The friends state; an empty one when there is none or it does not read. Entries that are not a friend, an invite or an answer are left out. */
export function readBuddies(kv: KeyValue): BuddiesState {
  let raw: unknown = null;
  try {
    const stored = kv.getString(BUDDY_KEYS.state);
    raw = stored ? JSON.parse(stored) : null;
  } catch {
    raw = null;
  }
  if (!isRecord(raw)) return { myName: '', buddies: [], invites: [], answers: [], unseen: false, notes: [] };
  return {
    myName: text(raw.myName),
    buddies: listOf(raw.buddies, buddyOf),
    invites: listOf(raw.invites, inviteOf),
    answers: listOf(raw.answers, answerOf),
    unseen: raw.unseen === true,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string') : [],
  };
}

/** Keeps the whole state; the caller reads, changes and saves. */
export function saveBuddies(kv: KeyValue, state: BuddiesState): void {
  kv.set(BUDDY_KEYS.state, JSON.stringify(state));
}

/**
 * Keeps the secret of an invite link just opened, until the invitee has
 * answered it: the link may arrive before the phone is ready to ask for a name.
 * A newer link replaces an older one.
 */
export function keepIncomingInvite(kv: KeyValue, secret: string, now: Date): void {
  kv.set(BUDDY_KEYS.incoming, JSON.stringify({ secret, at: now.toISOString() }));
}

/**
 * The kept invite's secret, once: it is cleared whatever it was. `null` when
 * there is none, it does not read, or it is `BUDDY_INVITE_TTL_DAYS` old or
 * more (the inviter's own invite is deleted by then, 4.3).
 */
export function takeIncomingInvite(kv: KeyValue, now: Date): string | null {
  const stored = kv.getString(BUDDY_KEYS.incoming);
  if (!stored) return null;
  kv.set(BUDDY_KEYS.incoming, '');
  try {
    const kept: unknown = JSON.parse(stored);
    if (!isRecord(kept) || typeof kept.secret !== 'string' || typeof kept.at !== 'string') return null;
    const age = now.getTime() - Date.parse(kept.at);
    return age < BUDDY_INVITE_TTL_DAYS * 86_400_000 ? kept.secret : null;
  } catch {
    return null;
  }
}

/**
 * The key a friend's class feed is kept under, when it is not the class this
 * phone follows: `buddies.feed|<site url>|<class id>`. A site url has no `|`,
 * so two classes never share a key.
 */
export function buddyFeedKey(siteUrl: string, classId: string): string {
  return `${BUDDY_KEYS.feedPrefix}${siteUrl}|${classId}`;
}
