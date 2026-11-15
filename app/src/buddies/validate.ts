/**
 * What a friend's box may hold, checked before any of it is used
 * (docs/superpowers/specs/2026-10-29-friends-design.md, 4.2 and 4.3).
 *
 * Opening a box proves only that whoever wrote it knew the secret: anyone a
 * link was forwarded to can read an invite and answer it, and a friend's phone
 * may run another version of the app or have a bug. Nothing on this phone
 * should break over what another phone wrote. So each guard takes the parsed
 * JSON as `unknown` and gives back the content with the fields this version
 * knows, each of its documented type, and nothing else; or `null`, and the
 * caller treats the box as one it could not read (`protocol.ts`).
 *
 * How versions meet. A box's format only grows: a later version ADDS optional
 * fields, never changes what a field means, and a value this version does not
 * know (a new lesson status, a new absence level) is taken as its plainest
 * kind (`'regular'`, `'ok'`). So a box with `v` above 1 is read as version 1,
 * and what this version does not know of it is left out.
 *
 * How much one mistake costs. A box's own fields (`v`, `at`, `name`, `shares`)
 * are all or nothing: without them nothing in it can be trusted. Below them a
 * pair box is read part by part: a lesson, an exam or an absence subject that
 * does not read is dropped and its neighbours kept; a `timetable` or an
 * `absences` part whose own fields do not read is dropped whole, and the rest
 * of the box kept; an optional field of the wrong kind is left out.
 *
 * A grades box (`readGradesContent`, docs/superpowers/specs/2026-10-30-buddies-grades-design.md,
 * 4.3) is read the same way: `v` and `at` all or nothing; below them a subject,
 * a grade and a bagrut row are each read on their own and dropped when they do
 * not read (a grade with neither a number nor words does not); a `from` or a
 * `bagrut` that does not read is left out. An optional
 * field with no value is absent or `null` in a box, and read as absent; one
 * that holds something else makes its item not read.
 *
 * A name is text another phone wrote that this one puts in its sentences, so
 * it may not hold what would turn a sentence around it or break its line
 * (`isBuddyText`; `isBuddyName` is it for a friend's name). A subject, a grade's
 * name or words, and a questionnaire's name are such text too.
 *
 * Pure, so the tests run it as is.
 */
import type {
  BuddyAbsence, BuddyBagrutRow, BuddyBoxContent, BuddyExam, BuddyGrade, BuddyGradesContent, BuddyGradeSubject, BuddyInviteContent, BuddyLesson,
  BuddyReplyContent, BuddyShares, BuddyTimetable, LessonStatus,
} from '@sederyom/shared';
import { BUDDY_GRADE_NAME_MAX, BUDDY_GRADE_SUBJECT_MAX, BUDDY_GRADES_MAX, BUDDY_LINK_SLOTS, BUDDY_NAME_MAX, LESSON_STATUSES } from '@sederyom/shared';
import { fromB64u, isPairingSecret } from './crypto';

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNumberOrNull = (value: unknown): value is number | null => value === null || isNumber(value);
/** `YYYY-MM-DD`, as every date in a box is written. */
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** `YYYY-MM`, as a bagrut sitting is written. */
const isMoed = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
/** A time a date reads from, as `Instant`s are written. */
const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
/** `HH:mm` or `null`: the shape only, as the Mashov reader leaves it (`clockTime`), not a range. */
const isTime = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value));
/** A status this version knows; any other is a later version's, read as a plain lesson. */
const statusOf = (value: unknown): LessonStatus => ((LESSON_STATUSES as readonly unknown[]).includes(value) ? (value as LessonStatus) : 'regular');
/** A level this version knows; any other is a later version's, read as nothing to warn of. */
const levelOf = (value: unknown): BuddyAbsence['level'] => (value === 'close' || value === 'over' ? value : 'ok');
/** Version 1 or later: a later one only adds fields (see above). */
const isVersion = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 1;

/**
 * What text from another phone may not hold: control characters (C0, DEL and
 * C1, line breaks and tabs among them), the direction marks (LRM, RLM, ALM),
 * the embeddings and overrides (U+202A to U+202E), the isolates (U+2066 to
 * U+2069), and the line and paragraph separators. A zero-width joiner stays,
 * for emoji. Exported for the builder of a grades box, which takes these out
 * of what it writes (`boxText`), so that its reader never refuses it.
 */
export function notInAName(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x061c || code === 0x200e || code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x2028 || code === 0x2029;
}

/** The line breaks and tabs among `notInAName`: they part words. */
const BREAKS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029]);

/**
 * A name typed or pasted on this phone, made one `isBuddyName` takes: what
 * `notInAName` refuses, which nobody sees (the direction marks a paste from
 * a chat brings along), taken out, a line break or a tab made a space, and
 * doubled spaces made one; `''` when nothing is left. Only for my own
 * typing: a name from a friend's phone is read or refused as it came.
 */
export function cleanBuddyName(raw: string): string {
  return [...raw]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (BREAKS.has(code)) return ' ';
      return notInAName(code) ? '' : ch;
    })
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Whether `value` is text this phone may put in a sentence: some text, at most
 * `max` characters (counted as characters, not UTF-16 units, so what the
 * sender's field allowed, and what a builder cut by characters, is never
 * refused here), and nothing in it that would reorder or break the line it is
 * shown in (`notInAName`).
 */
export function isBuddyText(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const chars = [...value];
  return chars.length <= max && !chars.some((ch) => notInAName(ch.codePointAt(0) ?? 0));
}

/**
 * Whether `value` is a name a friend may go by: text of at most
 * `BUDDY_NAME_MAX` characters (`isBuddyText`). The sender checks its own name
 * by the same rule, so a link is never made that its reader would refuse.
 */
export function isBuddyName(value: unknown): value is string {
  return isBuddyText(value, BUDDY_NAME_MAX);
}

/** A subject, a questionnaire name or a grade in words: the builder cuts each to this (`boxText`). */
const isGradesText = (value: unknown): value is string => isBuddyText(value, BUDDY_GRADE_SUBJECT_MAX);
const isGradeName = (value: unknown): value is string => isBuddyText(value, BUDDY_GRADE_NAME_MAX);

/**
 * The switches: `timetable` and `absences` are all or nothing. `grades` and
 * `bagrut` came later, so an older phone writes neither, and each is kept only
 * when a boolean. `bagrut` counts only along with `grades`: without it, it is off.
 */
function sharesOf(value: unknown): BuddyShares | null {
  if (!isRecord(value) || typeof value.timetable !== 'boolean' || typeof value.absences !== 'boolean') return null;
  const shares: BuddyShares = { timetable: value.timetable, absences: value.absences };
  if (typeof value.grades === 'boolean') shares.grades = value.grades;
  if (typeof value.bagrut === 'boolean') shares.bagrut = value.bagrut && value.grades === true;
  return shares;
}

/** Each item through `read`, those that read; `null` when `value` is no list at all. */
function itemsOf<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(read).filter((item): item is T => item !== null);
}

/**
 * An invite box: who invites, what they offer, the 32-byte X25519 key an answer is sealed to, and how many may answer it:
 * left out when it does not read, as in an invite from an older app, and held to `BUDDY_LINK_SLOTS`, so another phone never sets how much this one reads.
 */
export function readInviteContent(value: unknown): BuddyInviteContent | null {
  if (!isRecord(value) || !isVersion(value.v) || !isBuddyName(value.name)) return null;
  const shares = sharesOf(value.shares);
  if (!shares || !isText(value.inviterKey) || fromB64u(value.inviterKey)?.length !== 32) return null;
  const invite: BuddyInviteContent = { v: 1, name: value.name, shares, inviterKey: value.inviterKey };
  if (isNumber(value.slots) && Number.isInteger(value.slots) && value.slots >= 1) invite.slots = Math.min(value.slots, BUDDY_LINK_SLOTS);
  return invite;
}

/** A reply box: who answered, what they share, and the pair secret, which must be a whole one (`isPairingSecret`). */
export function readReplyContent(value: unknown): BuddyReplyContent | null {
  if (!isRecord(value) || !isVersion(value.v) || !isBuddyName(value.name)) return null;
  const shares = sharesOf(value.shares);
  if (!shares || !isText(value.secret) || !isPairingSecret(value.secret)) return null;
  return { v: 1, name: value.name, shares, secret: value.secret };
}

function examOf(value: unknown): BuddyExam | null {
  if (!isRecord(value) || !isDate(value.date) || !isText(value.subject) || !isText(value.title)) return null;
  return { date: value.date, subject: value.subject, title: value.title };
}

function lessonOf(value: unknown): BuddyLesson | null {
  if (!isRecord(value) || !isDate(value.date) || !isNumber(value.hourIndex) || !isTime(value.start) || !isTime(value.end)) return null;
  if (!isText(value.subject) || !isTextOrNull(value.teacher)) return null;
  return {
    date: value.date, hourIndex: value.hourIndex, start: value.start, end: value.end, subject: value.subject, teacher: value.teacher,
    status: statusOf(value.status),
  };
}

/** The timetable part, or `null` when its own fields do not read (a lesson or an exam that does not is only dropped). */
function timetableOf(value: unknown): BuddyTimetable | null {
  if (!isRecord(value) || !isTextOrNull(value.siteUrl) || !isText(value.classId) || !isText(value.className)) return null;
  const hiddenSubjects = itemsOf(value.hiddenSubjects, (s) => (isText(s) ? s : null));
  const exams = itemsOf(value.exams, examOf);
  if (!hiddenSubjects || !exams) return null;
  const timetable: BuddyTimetable = { siteUrl: value.siteUrl, classId: value.classId, className: value.className, hiddenSubjects, exams };
  if (value.lessons !== undefined) {
    const lessons = itemsOf(value.lessons, lessonOf);
    if (!lessons) return null;
    timetable.lessons = lessons;
  }
  if (value.lessonsTrimmed === true) timetable.lessonsTrimmed = true;
  if (isTextOrNull(value.mashovSchool)) timetable.mashovSchool = value.mashovSchool;
  return timetable;
}

/** One subject's count; `null` for one whose numbers JSON could not carry (NaN and Infinity come as `null`). */
function absenceOf(value: unknown): BuddyAbsence | null {
  if (!isRecord(value) || !isText(value.subject) || !isNumber(value.counted) || !isNumber(value.allowed)) return null;
  return { subject: value.subject, counted: value.counted, allowed: value.allowed, level: levelOf(value.level) };
}

/** The absences part, or `null` when its own fields do not read (a subject that does not is only dropped). */
function absencesOf(value: unknown): NonNullable<BuddyBoxContent['absences']> | null {
  if (!isRecord(value) || !isDate(value.semesterStart) || !isDate(value.semesterEnd)) return null;
  const subjects = itemsOf(value.subjects, absenceOf);
  return subjects ? { semesterStart: value.semesterStart, semesterEnd: value.semesterEnd, subjects } : null;
}

/**
 * A pair box, as `myBoxContent` writes it, read as the header says: `at` must
 * be a time a date reads, since it is shown as "updated N ago", and the name a
 * name; `timetable` and `absences` may be absent (not shared, no attendance
 * read yet, or not readable), and each is read on its own. Which of them is
 * there is not held against `shares`: the view goes by `shares`.
 */
export function readBoxContent(value: unknown): BuddyBoxContent | null {
  if (!isRecord(value) || !isVersion(value.v) || !isInstant(value.at) || !isBuddyName(value.name)) return null;
  const shares = sharesOf(value.shares);
  if (!shares) return null;
  const content: BuddyBoxContent = { v: 1, at: value.at, name: value.name, shares };
  const timetable = value.timetable === undefined || value.timetable === null ? null : timetableOf(value.timetable);
  if (timetable) content.timetable = timetable;
  const absences = value.absences === undefined || value.absences === null ? null : absencesOf(value.absences);
  if (absences) content.absences = absences;
  return content;
}

/**
 * An optional field of a grades box: `undefined` when it has no value (this
 * version leaves such a field out; another phone may write `null`), `null` when
 * it holds something `fits` refuses, else the value.
 */
function optional<T>(value: unknown, fits: (value: unknown) => value is T): T | null | undefined {
  if (value === undefined || value === null) return undefined;
  return fits(value) ? value : null;
}

/**
 * One grade; `null` for one whose date is no date, or whose name, number or
 * words do not read, and for one with neither a number nor words: the builder
 * never writes such a grade (`myGradesContent`), and it has nothing to show.
 */
function gradeOf(value: unknown): BuddyGrade | null {
  if (!isRecord(value) || !isDate(value.date)) return null;
  const name = optional(value.name, isGradeName);
  const number = optional(value.value, isNumber);
  const words = optional(value.text, isGradesText);
  if (name === null || number === null || words === null) return null;
  if (number === undefined && words === undefined) return null;
  const grade: BuddyGrade = { date: value.date };
  if (name !== undefined) grade.name = name;
  if (number !== undefined) grade.value = number;
  if (words !== undefined) grade.text = words;
  return grade;
}

/** How many grades an average leaves out: a whole number, at least one, and no more than a box holds. */
const isUncounted = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value > 0 && value <= BUDDY_GRADES_MAX;

/**
 * One subject with its grades, however few: a subject the trim left with none
 * reads, with its average. A count of grades left out that does not read only
 * goes, as in a box from an app older than it: it explains the average, and
 * the subject is whole without it.
 */
function gradeSubjectOf(value: unknown): BuddyGradeSubject | null {
  if (!isRecord(value) || !isGradesText(value.subject) || !isNumberOrNull(value.average)) return null;
  const grades = itemsOf(value.grades, gradeOf);
  if (!grades) return null;
  const subject: BuddyGradeSubject = { subject: value.subject, average: value.average, grades };
  if (isUncounted(value.uncounted)) subject.uncounted = value.uncounted;
  return subject;
}

/** One bagrut questionnaire; `null` for one whose code, name or sitting do not read, or whose grade is not a number. */
function bagrutRowOf(value: unknown): BuddyBagrutRow | null {
  if (!isRecord(value) || !isNumber(value.semel) || !isGradesText(value.name) || !isMoed(value.moed)) return null;
  const school = optional(value.school, isNumber);
  const exam = optional(value.exam, isNumber);
  const final = optional(value.final, isNumber);
  if (school === null || exam === null || final === null) return null;
  const row: BuddyBagrutRow = { semel: value.semel, name: value.name, moed: value.moed };
  if (school !== undefined) row.school = school;
  if (exam !== undefined) row.exam = exam;
  if (final !== undefined) row.final = final;
  return row;
}

/**
 * A grades box, as `myGradesContent` writes it (and `fitGrades` trims it),
 * read as the header says: `at` must be a time a date reads, as in the main
 * box; `subjects` must be a list, though it may be empty. `from` is kept when a
 * date, and `bagrut` when a list (an empty one is the questionnaires of a
 * student with none graded: it stays).
 */
export function readGradesContent(value: unknown): BuddyGradesContent | null {
  if (!isRecord(value) || !isVersion(value.v) || !isInstant(value.at)) return null;
  const subjects = itemsOf(value.subjects, gradeSubjectOf);
  if (!subjects) return null;
  const content: BuddyGradesContent = { v: 1, at: value.at, subjects };
  if (isDate(value.from)) content.from = value.from;
  const bagrut = itemsOf(value.bagrut, bagrutRowOf);
  if (bagrut) content.bagrut = bagrut;
  return content;
}
