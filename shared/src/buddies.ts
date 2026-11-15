/**
 * The friends feature ("חברים"): a student shares their timetable, exams and
 * absence counts with a friend, and each phone compares the two. The numbers
 * (spec §6), the content of a box (§4.2) and the `/v2/buddies` API (§5).
 * Everything a box holds is encrypted on the phone; the server sees only an
 * id and ciphertext, never plaintext, a pairing secret or a name.
 */
import type { DateStr, Instant, LessonStatus, TimeStr } from './domain';

/** Friends plus pending invites, at most (spec §6). */
export const MAX_BUDDIES = 20;
/** An invite not answered by then is deleted, on the server and on the inviter's phone (§4.3). */
export const BUDDY_INVITE_TTL_DAYS = 7;
/**
 * A box not written for this long is swept by `/cron/tick` (§4.5): past a summer
 * break without opening the app (about 70 days, and Android seldom runs the
 * background refresh of an app nobody opens), so a summer does not end every friendship.
 */
export const BUDDY_BOX_STALE_DAYS = 120;
/** The box is rewritten at least this often even when its content is unchanged, so "updated N ago" stays true (§4.2). */
export const BUDDY_REWRITE_MINUTES = 60;
/** How far ahead the box's exams reach, from today (§4.2). */
export const BUDDY_EXAM_DAYS = 14;
/** The longest name one gives a friend, in characters. */
export const BUDDY_NAME_MAX = 20;
/** The most grades in a grades box: the newest, as many as the grades tab shows, in whole days (a day the cap would cut in two is left out; grades spec §4.3). */
export const BUDDY_GRADES_MAX = 200;
/** The longest assessment name in a grades box, in characters: a longer one is cut and ends in "…". */
export const BUDDY_GRADE_NAME_MAX = 40;
/** The longest subject name, bagrut questionnaire name or grade in words (`text`) in a grades box, in characters: a longer one is cut and ends in "…", and the reader refuses one over it. */
export const BUDDY_GRADE_SUBJECT_MAX = 60;
/** A grades box is rewritten at least this often even when unchanged, so the stale sweep (`BUDDY_BOX_STALE_DAYS`) never takes it. */
export const BUDDY_GRADES_REWRITE_DAYS = 30;
/** Two starts or ends "together" when they differ by strictly less than this (§4.6). */
export const TOGETHER_MINUTES = 10;
/** A shared window is at least this long (§4.6). */
export const WINDOW_MIN_MINUTES = 30;
/** Boxes in one `PUT /v2/buddies/boxes` (§5). */
export const BUDDY_PUT_MAX = 25;
/** Ids in one `POST /v2/buddies/read` (§5). */
export const BUDDY_READ_MAX = 50;
/** Boxes one device may hold. */
export const BUDDY_BOXES_PER_DEVICE = 60;
/** How many people can answer one link, each in a reply box of their own: a friend list's worth, as no link can make more friends than that (§4.3). */
export const BUDDY_LINK_SLOTS = MAX_BUDDIES;
/**
 * The longest `ciphertext` of an `invite` or a `reply` box, in base64url
 * characters (§5): a name, two switches and a key or a secret take a few hundred.
 */
export const BUDDY_INVITE_CIPHERTEXT_MAX = 4_096;
/**
 * The longest `ciphertext` of a `pair` box, in base64url characters (§5, §6):
 * two weeks of lessons of a school without a Shahaf site take well under it, and
 * the phone trims a box that would not fit (`buddies/content.ts`, and
 * `buddies/grades.ts` for a grades box).
 */
export const BUDDY_PAIR_CIPHERTEXT_MAX = 32_768;

/** The longest `ciphertext` a box of `kind` may have. */
export function buddyCiphertextMax(kind: BuddyBoxKind): number {
  return kind === 'pair' ? BUDDY_PAIR_CIPHERTEXT_MAX : BUDDY_INVITE_CIPHERTEXT_MAX;
}

/** A box id: 16 random-looking bytes in base64url (§4.2). */
export const BUDDY_BOX_ID = /^[A-Za-z0-9_-]{22}$/;

/** What a box is for: an invitation, its answer, or one direction of a friendship (§4.3). */
export type BuddyBoxKind = 'invite' | 'reply' | 'pair';

/** What one shares with a friend, by category (§4.2). */
export interface BuddyShares {
  timetable: boolean;
  absences: boolean;
  /** Missing reads as `false`: a friend's phone may run an older app that never writes it. */
  grades?: boolean;
  /** Counts only along with `grades`. */
  bagrut?: boolean;
}

/** What a new friend gets by default: grades are an optional share, off until one chooses it. */
export const DEFAULT_BUDDY_SHARES: BuddyShares = { timetable: true, absences: true };

/** One lesson of a school without a Shahaf site, as the sharer's phone computed it (§4.2). */
export interface BuddyLesson {
  date: DateStr;
  hourIndex: number;
  /** `null` when the school's Mashov timetable has no times. */
  start: TimeStr | null;
  end: TimeStr | null;
  subject: string;
  teacher: string | null;
  status: LessonStatus;
}

/** One exam as the sharer sees it, after their own renames and hidden exams (§4.2). */
export interface BuddyExam {
  date: DateStr;
  /** `examSubjectKey(title)`. */
  subject: string;
  /** As shown on the sharer's phone. */
  title: string;
}

/** One subject's absence count, computed on the sharer's phone by their own settings (§4.2). */
export interface BuddyAbsence {
  subject: string;
  counted: number;
  allowed: number;
  level: 'ok' | 'close' | 'over';
}

/** The box's timetable part, present when `shares.timetable` (§4.2). */
export interface BuddyTimetable {
  /** The class's Shahaf site; `null` for a school without one. */
  siteUrl: string | null;
  classId: string;
  className: string;
  /** The class's lines that are not the sharer's (`LessonFilter.hiddenSubjects`). */
  hiddenSubjects: string[];
  /** From today to `BUDDY_EXAM_DAYS` ahead. */
  exams: BuddyExam[];
  /**
   * This week and the next; only for a school without a Shahaf site. Absent
   * there too when even one week would not fit the box (`BUDDY_PAIR_CIPHERTEXT_MAX`).
   */
  lessons?: BuddyLesson[];
  /** Set when `lessons` holds only this week's: two weeks would not fit the box. */
  lessonsTrimmed?: true;
  /** Mashov's school id, sent with `lessons` to tell friends of one school. */
  mashovSchool?: string | null;
}

/** A `pair` box, JSON before encryption (spec §4.2). */
export interface BuddyBoxContent {
  v: 1;
  /** When the Mashov read it was built from happened. */
  at: Instant;
  /** The sharer's name, as the friend sees it. */
  name: string;
  shares: BuddyShares;
  timetable?: BuddyTimetable;
  absences?: { semesterStart: DateStr; semesterEnd: DateStr; subjects: BuddyAbsence[] };
}

/** One grade of the sharer's, as the grades tab shows it; a field with no value is not written at all. */
export interface BuddyGrade {
  date: DateStr;
  /** The assessment's name, at most `BUDDY_GRADE_NAME_MAX` characters. */
  name?: string;
  value?: number;
  /** A grade in words ("עבר"), when there is no number. */
  text?: string;
}

/** One subject of the grades box (`stripGroup`'d, as the grades tab names it). */
export interface BuddyGradeSubject {
  subject: string;
  /** By the sharer's own weights, to one decimal, over the grades kept (the newest, in whole days, at most `BUDDY_GRADES_MAX`) before the size trim; `null` with no numeric grade. */
  average: number | null;
  /** How many of its numeric grades the average leaves out, at a weight of 0% (`SubjectAverage.uncounted`); absent when none, and in a box from an older app. */
  uncounted?: number;
  /** Newest first. */
  grades: BuddyGrade[];
}

/** One bagrut questionnaire: its latest sitting that has a grade of Mashov's own (never a status code, never what the student entered). */
export interface BuddyBagrutRow {
  semel: number;
  name: string;
  /** The sitting, `YYYY-MM`. */
  moed: string;
  /** The school's grade (מגן). */
  school?: number;
  exam?: number;
  final?: number;
}

/** A grades box, a `pair` box of its own (grades spec §4.3): JSON before encryption. */
export interface BuddyGradesContent {
  v: 1;
  /** When the Mashov read it was built from happened. */
  at: Instant;
  subjects: BuddyGradeSubject[];
  /** The oldest date still in the box, set when older grades were left out: over `BUDDY_GRADES_MAX`, or so that the box fits (`BUDDY_PAIR_CIPHERTEXT_MAX`). It may be the day after the newest grade, when every grade went. */
  from?: DateStr;
  /** Only when both friends share it; `[]` when shared and nothing is graded yet. */
  bagrut?: BuddyBagrutRow[];
}

/** An `invite` box: a name and the categories, no data; `inviterKey` is a one-time X25519 public key (spec §4.3). */
export interface BuddyInviteContent {
  v: 1;
  name: string;
  shares: BuddyShares;
  inviterKey: string;
  /** How many people can answer this link, at most `BUDDY_LINK_SLOTS`. Missing (an invite from an older app): one. */
  slots?: number;
}

/** A `reply` box, sealed to `inviterKey`: the invitee's name and categories, and the new secret (spec §4.3). */
export interface BuddyReplyContent {
  v: 1;
  name: string;
  shares: BuddyShares;
  secret: string;
}

/**
 * `PUT /v2/buddies/boxes`: at most `BUDDY_PUT_MAX` boxes; `ciphertext` is
 * base64url, at most `buddyCiphertextMax(kind)` characters, or the whole
 * request is a 400 (spec §5).
 */
export interface PutBuddyBoxesBody {
  boxes: { id: string; kind: BuddyBoxKind; ciphertext: string }[];
}

/**
 * One answer per box; `taken` means another device wrote it first, or its id
 * is a used link's (an invite or a reply its writer deleted, kept empty so it
 * is never written again), and `too_many` that this device is at
 * `BUDDY_BOXES_PER_DEVICE` (spec §5).
 */
export interface PutBuddyBoxesResponse {
  results: { id: string; ok: boolean; error?: 'taken' | 'too_many' }[];
}

/** `POST /v2/buddies/read`: at most `BUDDY_READ_MAX` ids (spec §5). */
export interface ReadBuddyBoxesBody {
  ids: string[];
}

/** A box that does not exist, or a used link's empty one, comes back with `ciphertext` and `updatedAt` `null` (spec §5). */
export interface ReadBuddyBoxesResponse {
  boxes: { id: string; ciphertext: string | null; updatedAt: Instant | null }[];
}

/**
 * `DELETE /v2/buddies/boxes`: only the device that wrote a box can delete it.
 * A `pair` box goes; an `invite` or a `reply` is emptied and stays, so its link
 * cannot be used again, until the stale sweep (spec §5).
 */
export interface DeleteBuddyBoxesBody {
  ids: string[];
}
