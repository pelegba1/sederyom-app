/**
 * The student's own word on an exam, from its sheet: a name of their own for
 * it ("לשנות שם"), a date of their own for it ("לשנות תאריך"), and whether
 * the "בית ספר" calendar the phone keeps in Google carries it ("להציג ביומן
 * Google"). Kept on the phone, by the exam's natural key; the server never
 * sees any of them.
 *
 * - A name and a date show wherever the phone shows the exam: `local/days.ts`
 *   gives the exams it builds their name and date (`ownExam`), and
 *   `api/hooks.ts` the server's lists. The exam keeps its source's name in
 *   `originalSubject` and its source's date in `originalDate`, which matching
 *   still goes by (twins, "is it mine", a friend's comparison, what is sent
 *   to a friend). An empty name gives the source's back; so does a date that
 *   is the source's own.
 * - A date holds only while the source still says what it said when the
 *   student moved the exam (`sourceDate`): when the school moves it, the
 *   school's date wins and the student's falls (`movedExam`, `pruneExamDates`).
 *   An exam the student added by hand changes its stored date instead
 *   (`setManualExamDate`), with no layer over it.
 * - Out of the calendar is not hidden: the exam stays in the app, and only
 *   the phone's mirror (`google/mirror.ts`) leaves it out. "לא המבחן שלי,
 *   להסתיר" is the one that hides an exam everywhere.
 *
 * Pure on purpose (a key-value store in, plain data out), like
 * `manualExams.ts`, so tests can load it.
 */
import type { ClassFeed, DateStr, Exam, Source } from '@sederyom/shared';
import { CLASS_FEED_PAST_DAYS, SOURCES } from '@sederyom/shared';
import { isBagrutKey } from '@sederyom/shared/logic/mashov/bagrut';
import { addDays } from '@sederyom/shared/logic/time';
import { validDate } from '../lib/planner';
import { isManualKey, type KV } from './manualExams';
import type { OwnBoard } from './ownBoard';

export const EXAM_PREFS_KEY = 'exams.prefs';

/** A name longer than this is cut: a title line, not a note. */
export const EXAM_NAME_MAX = 80;

/**
 * How many days back the class feed reaches: the server sends the class's exams dated from seven days before today on
 * (`CLASS_FEED_PAST_DAYS`, the one number the server's feed route dates by). An exam older than that is no longer in
 * the feed, whatever the school still has; an exam whose date is inside it and is not there was taken off the school's
 * list.
 */
export const FEED_EXAM_PAST_DAYS = CLASS_FEED_PAST_DAYS;

/** An exam as its source gave it, kept with the student's date for the days the source's list no longer carries it. */
export interface KeptExam {
  /** The source's own name for the exam, never the student's: their name for it is applied by key, as for any exam. */
  subject: string;
  details: string | null;
  source: Source;
}

/** What `setExamDate` copies of an exam: an `Exam` is one, shown or as listed. */
export type ExamCopy = Pick<Exam, 'subject' | 'details' | 'source'> & Partial<Pick<Exam, 'originalSubject'>>;

/** The student's date for an exam, with the date its source gave it when they chose theirs. */
export interface ExamDate {
  date: DateStr;
  sourceDate: DateStr;
  /** The exam as its source gave it then; absent in an entry kept before the copies, or with a copy that did not read. */
  kept?: KeptExam;
}

export interface ExamPrefs {
  /** Natural key → the student's name for the exam. */
  renames: Record<string, string>;
  /** Natural keys of the exams the Google calendar leaves out. */
  calendarSkip: string[];
  /** Natural key → the student's date for the exam, which holds while the source still says `sourceDate`. */
  dates: Record<string, ExamDate>;
}

export const NO_EXAM_PREFS: ExamPrefs = { renames: {}, calendarSkip: [], dates: {} };

export function readExamPrefs(kv: Pick<KV, 'getString'>): ExamPrefs {
  try {
    const raw = JSON.parse(kv.getString(EXAM_PREFS_KEY) ?? '{}') as Partial<ExamPrefs> | null;
    const renames: Record<string, string> = {};
    if (raw && typeof raw.renames === 'object' && raw.renames !== null && !Array.isArray(raw.renames)) {
      for (const [key, name] of Object.entries(raw.renames)) {
        if (typeof name === 'string' && name.trim()) renames[key] = name;
      }
    }
    const calendarSkip = Array.isArray(raw?.calendarSkip) ? raw.calendarSkip.filter((k): k is string => typeof k === 'string') : [];
    return { renames, calendarSkip, dates: readDates(raw?.dates) };
  } catch {
    return { renames: {}, calendarSkip: [], dates: {} };
  }
}

/** The dates of a stored `dates`: each entry with two real days is kept, as `{date, sourceDate}` and nothing else; anything else is dropped. */
function readDates(raw: unknown): Record<string, ExamDate> {
  const dates: Record<string, ExamDate> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return dates;
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { date, sourceDate, kept } = entry as Partial<Record<keyof ExamDate, unknown>>;
    if (typeof date !== 'string' || typeof sourceDate !== 'string' || !validDate(date) || !validDate(sourceDate)) continue;
    const copy = readKept(kept);
    dates[key] = copy ? { date, sourceDate, kept: copy } : { date, sourceDate };
  }
  return dates;
}

/** A stored copy of an exam; one that is not a whole copy is none (the date it came with works without it). */
function readKept(raw: unknown): KeptExam | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const k = raw as Record<string, unknown>;
  const text = (v: unknown): v is string | null | undefined => v === undefined || v === null || typeof v === 'string';
  if (typeof k.subject !== 'string' || k.subject.trim() === '') return undefined;
  if (typeof k.source !== 'string' || !(SOURCES as readonly string[]).includes(k.source)) return undefined;
  if (!text(k.details)) return undefined;
  return { subject: k.subject, details: k.details ?? null, source: k.source as Source };
}

/** The copy of `exam` that is kept: as its source gave it (`originalSubject` of one under a name of the student's), nothing of the date or the key. */
function copyOf(exam: ExamCopy): KeptExam {
  return { subject: exam.originalSubject ?? exam.subject, details: exam.details, source: exam.source };
}

function write(kv: KV, prefs: ExamPrefs): ExamPrefs {
  kv.set(EXAM_PREFS_KEY, JSON.stringify(prefs));
  return prefs;
}

/** A typed name as it is kept: on one line, without the spaces around it, cut at `EXAM_NAME_MAX`. */
export function cleanExamName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, EXAM_NAME_MAX).trim();
}

/**
 * What "לשמור" keeps of a typed name: the name, cleaned, or `null` for the
 * source's name back, when it is empty or one of the names the exam had
 * before it was renamed (`originals`: the source's, and the title the app
 * gave it, "בגרות באנגלית, מודול G" for Mashov's "אנגלית"). The caller
 * compares it with the name kept now, and changes nothing when they agree.
 */
export function nameToKeep(draft: string, originals: readonly string[]): string | null {
  const clean = cleanExamName(draft);
  return clean && !originals.some((o) => cleanExamName(o) === clean) ? clean : null;
}

/**
 * Names the exam. An empty name, or the source's own (`original`), clears
 * it, and the exam takes the source's name back. Returns the prefs as stored.
 */
export function setExamName(kv: KV, naturalKey: string, name: string | null, original?: string): ExamPrefs {
  const prefs = readExamPrefs(kv);
  const clean = cleanExamName(name);
  const renames = { ...prefs.renames };
  if (!clean || (original !== undefined && clean === cleanExamName(original))) delete renames[naturalKey];
  else renames[naturalKey] = clean;
  return write(kv, { ...prefs, renames });
}

/**
 * Moves the exam to `date` for the student alone, against `sourceDate`: the
 * date its source gives it now, which the student's holds only as long as the
 * source keeps saying it (`movedExam`). `null`, or the source's own date,
 * takes the student's date away. Returns the prefs as stored.
 *
 * Only a real day in `yyyy-mm-dd` is kept, and for an exam from a source: one
 * the student added by hand has its stored date changed (`setManualExamDate`)
 * and no entry here, and a bagrut exam from Mashov's own list (the Ministry's
 * sitting) is not moved at all. Anything else leaves the prefs as they were,
 * unwritten.
 *
 * With `exam` (the exam as the sheet holds it, or its fields) the entry also
 * keeps a copy of it as its source gave it, for the days the source's list no
 * longer carries it (`keptExams`). Without it, the copy already kept for the
 * same `sourceDate` stays; for another source date there is none, since it is
 * not the exam that was kept.
 */
export function setExamDate(kv: KV, naturalKey: string, date: DateStr | null, sourceDate: DateStr, exam?: ExamCopy): ExamPrefs {
  const prefs = readExamPrefs(kv);
  if (isManualKey(naturalKey) || isBagrutKey(naturalKey)) return prefs;
  if (date !== null && !(validDate(date) && validDate(sourceDate))) return prefs;
  const dates = { ...prefs.dates };
  if (date === null || date === sourceDate) delete dates[naturalKey];
  else {
    const before = dates[naturalKey];
    const kept = exam ? copyOf(exam) : before?.sourceDate === sourceDate ? before.kept : undefined;
    dates[naturalKey] = kept ? { date, sourceDate, kept } : { date, sourceDate };
  }
  return write(kv, { ...prefs, dates });
}

/**
 * The exams the student moved whose source no longer lists them, as their
 * source gave them (on the school's date, for `movedExam` to put on the
 * student's), from the copies kept with their dates. Only an exam whose
 * school's date has left the feed's window by age (`FEED_EXAM_PAST_DAYS`)
 * counts: inside the window, a key that is not listed was taken off the
 * school's list, and the exam is gone. And only while the student's own date
 * is not itself more than that past: the entry is dead then (`pruneExamDates`).
 * `listed` is every key the sources list now; an entry without a copy, and an
 * exam added by hand, give none.
 *
 * A copy is only ever of an exam the sources listed while the entry was made,
 * and `forgetAbsentCopies` takes it away as soon as a refresh sees the exam
 * absent inside the window, so that an exam the school removed (or re-dated
 * under another key) does not come back when its date ages out. The limit that
 * remains: a phone not refreshed at all between the removal and that day has
 * not seen the absence, and the copy then shows.
 *
 * `opts.classBoardHidden`: a board of the student's own is laid over the
 * class's feed (`withOwnBoard`), so the class board's exams are not shown, and
 * neither is a copy of one of them (`school_site`) that the own board does not
 * list. The copy stays, and shows again once the own board is taken away.
 */
export function keptExams(
  prefs: ExamPrefs | undefined,
  listed: ReadonlySet<string>,
  today: DateStr,
  opts: { classBoardHidden?: boolean } = {},
): Exam[] {
  const entries = Object.entries(prefs?.dates ?? {});
  if (entries.length === 0) return [];
  const from = addDays(today, -FEED_EXAM_PAST_DAYS);
  const exams: Exam[] = [];
  for (const [naturalKey, { date, sourceDate, kept }] of entries) {
    if (!kept || isManualKey(naturalKey) || listed.has(naturalKey)) continue;
    if (opts.classBoardHidden && kept.source === 'school_site') continue;
    if (sourceDate >= from || date < from) continue;
    exams.push({ naturalKey, date: sourceDate, ...kept });
  }
  return exams;
}

/** Which of the sources' lists a refresh read successfully, by the `source` of the exams in them; one that is not a key is not known to have been. */
export type ExamSourcesRead = Partial<Record<Source, boolean>>;

/**
 * What a refresh read, for `forgetAbsentCopies`: the class feed (the site's exams, `shahaf`, and the class's exam
 * schedule, `school_site`), Mashov, and the phone's own board. With a board of the student's own (`ownBoard` is not
 * `null`) the `school_site` exams are the board's, and what was observed of them is what was observed of the board
 * (`ownBoardObserved`), whatever the feed: the class board's exams are not among the keys then. Without one they are
 * the feed's. A source not named here is not known to have been read.
 */
export function examSourcesRead(read: { feed: boolean; mashov: boolean; ownBoard: boolean | null }): ExamSourcesRead {
  return { shahaf: read.feed, school_site: read.ownBoard === null ? read.feed : read.ownBoard, mashov: read.mashov };
}

/**
 * Whether a refresh observed the exams of the phone's own board, as `examSourcesRead` takes it: `null` when the phone
 * has none. Only over a feed (with none, the board is laid over nothing, and lists nothing): a board of rows, kept on
 * the phone, is known at every refresh; a calendar only once it was read, and not when its read failed in this very
 * refresh. "בלי הלוח של הכיתה" (`none`) observes nothing: the class board is hidden, not read, and its exams' copies are
 * not to be forgotten for it.
 */
export function ownBoardObserved(own: OwnBoard | null, hasFeed: boolean, readFailed: boolean): boolean | null {
  if (own === null) return null;
  if (!hasFeed || own.kind === 'none') return false;
  return own.kind === 'rows' || (own.readAt !== null && !readFailed);
}

/**
 * Whether the feed a refresh was given is a read of the class's site: it is there, the server has read the site
 * (`lastOkAt`), and it holds something. A feed with nothing in it is a site nothing could be read from, not a class
 * that lists no exams, and says nothing about an exam being absent. And it is the class on screen (`shown`, the
 * student's or the child's): by its class id, and by its site when both are known. A feed of the class the device
 * still follows, when following the one on screen failed, says nothing of the exams on screen.
 */
export function isFeedObserved(feed: ClassFeed | null, shown: { classId: string; siteUrl?: string | null }): boolean {
  if (feed === null || feed.lastOkAt === null) return false;
  if (feed.class.classId !== shown.classId) return false;
  if (shown.siteUrl && feed.class.siteUrl && feed.class.siteUrl !== shown.siteUrl) return false;
  return (feed.lessons?.length ?? 0) + (feed.exams?.length ?? 0) + (feed.events?.length ?? 0) > 0;
}

/**
 * Takes the copy off an entry whose exam a refresh saw absent: its key is in none of the sources' lists (`listed`)
 * while the school's date is still inside the feed's window (`sourceDate >= today - FEED_EXAM_PAST_DAYS`), where an
 * exam that is not there was taken off the school's list (or re-dated under another key). It is the student's date
 * that stays; the copy is what would bring the exam back on the day the school's date ages out of the window, and
 * the school took it away. Only when the read of the source the copy came from worked in this refresh (`read`): a
 * failed read, a stored list from an earlier one, or a source not known to have been read, is no observation.
 * Writes only when something goes. Returns the prefs as stored.
 */
export function forgetAbsentCopies(kv: KV, listed: ReadonlySet<string>, today: DateStr, read: ExamSourcesRead): ExamPrefs {
  const prefs = readExamPrefs(kv);
  const from = addDays(today, -FEED_EXAM_PAST_DAYS);
  const dates = { ...prefs.dates };
  let changed = false;
  for (const [naturalKey, own] of Object.entries(dates)) {
    if (!own.kept || listed.has(naturalKey) || own.sourceDate < from || read[own.kept.source] !== true) continue;
    const { kept: _kept, ...rest } = own;
    dates[naturalKey] = rest;
    changed = true;
  }
  return changed ? write(kv, { ...prefs, dates }) : prefs;
}

/**
 * Takes the copy off every entry (the dates stay): the class changed, and an exam of the old class is not one of the
 * new. Writes only when some entry has a copy. Returns the prefs as stored.
 */
export function dropKeptCopies(kv: KV): ExamPrefs {
  const prefs = readExamPrefs(kv);
  if (!Object.values(prefs.dates).some((d) => d.kept)) return prefs;
  const dates = Object.fromEntries(Object.entries(prefs.dates).map(([key, { kept: _kept, ...rest }]) => [key, rest]));
  return write(kv, { ...prefs, dates });
}

/**
 * Whether the student's date for an exam will not hold: it is more than `FEED_EXAM_PAST_DAYS` before `today` and the
 * school's (`sourceDate`) is past too, so no exam is left for it to hold (`keptExams` shows none from then). The one
 * rule `pruneExamDates` takes such an entry away by, and the exam sheet asks before it moves an exam to such a day.
 * (A school's date still ahead is an exam the student moved into the past; that stays moved.)
 */
export function isDeadExamDate(date: DateStr, sourceDate: DateStr, today: DateStr): boolean {
  return date < addDays(today, -FEED_EXAM_PAST_DAYS) && sourceDate < today;
}

/**
 * Takes away the dates of the exams a read says another date for: the source
 * moved the exam, so the student's date has fallen (`movedExam` ignores it
 * already; this keeps it from coming back should the source go back to the
 * date it had). Compared with the date the source gives (`originalDate` of an
 * exam already under the student's date), exam by exam.
 *
 * A date is never taken away only because its exam is not in the read: the
 * exam may only be absent from this read and come back. So a partial list, or
 * an empty one, takes nothing for the exams it lacks. Only a date that is long
 * past goes without its exam being there: when the student's date is more than
 * `FEED_EXAM_PAST_DAYS` before `today` and the school's is past too, there is
 * no exam left for it to hold (`keptExams` shows none from then). The caller
 * gives the exams of every source it read, as the days are built from. Writes
 * only when something goes. Returns the prefs as stored.
 */
export function pruneExamDates(kv: KV, exams: readonly Exam[], today: DateStr): ExamPrefs {
  const prefs = readExamPrefs(kv);
  const dates = { ...prefs.dates };
  const listed = new Map(exams.map((e) => [e.naturalKey, e.originalDate ?? e.date]));
  let changed = false;
  for (const [naturalKey, own] of Object.entries(dates)) {
    const source = listed.get(naturalKey);
    // The source says another date than the one the student moved the exam from: theirs has fallen.
    const moved = source !== undefined && source !== own.sourceDate;
    // The student's own date is more than a week gone, and the school's is gone too: nothing is left to hold.
    if (moved || isDeadExamDate(own.date, own.sourceDate, today)) {
      delete dates[naturalKey];
      changed = true;
    }
  }
  return changed ? write(kv, { ...prefs, dates }) : prefs;
}

/** Whether the phone's Google calendar carries the exam: every exam does, until the student says otherwise. */
export function isExamInCalendar(prefs: ExamPrefs | undefined, naturalKey: string): boolean {
  return !(prefs?.calendarSkip ?? []).includes(naturalKey);
}

/** Puts the exam in the Google calendar (`on`) or keeps it out. Returns the prefs as stored. */
export function setExamInCalendar(kv: KV, naturalKey: string, on: boolean): ExamPrefs {
  const prefs = readExamPrefs(kv);
  const rest = prefs.calendarSkip.filter((k) => k !== naturalKey);
  return write(kv, { ...prefs, calendarSkip: on ? rest : [...rest, naturalKey] });
}

/**
 * The exam under the student's name for it, its source's name kept in
 * `originalSubject`; under its source's name when there is none (again).
 * Safe to apply twice, and to an exam already renamed with an older name.
 *
 * An exam named by its subject's name (`subjectName`, `subjectNames.ts`) is
 * left as it is when it has no name of its own; one of its own wins over it,
 * and the subject's goes. Without its own name again, it is the source's
 * title until the list is built again with the subject's names.
 *
 * The name alone: the half of `ownExam` that is the name. Nothing that shows
 * an exam calls it by itself, since an exam shown under a name and not under
 * its date is one more place to forget the date; use `ownExam`.
 */
export function renamedExam<E extends Exam>(exam: E, prefs: ExamPrefs | undefined): E {
  const original = exam.originalSubject ?? exam.subject;
  const name = prefs?.renames[exam.naturalKey];
  if (name && name !== original) {
    const { subjectName: _subjectName, ...rest } = exam;
    return { ...rest, subject: name, originalSubject: original } as E;
  }
  if (exam.originalSubject === undefined || exam.subjectName !== undefined) return exam;
  const { originalSubject: _original, ...rest } = exam;
  return { ...rest, subject: original } as E;
}

/**
 * The exam on the student's date for it, its source's date kept in
 * `originalDate`; on its source's date when there is none, or when the source
 * has moved the exam since (the student's entry holds only while the source
 * still says `sourceDate`). Safe to apply twice, and to an exam already moved
 * under older prefs: the source's date is `originalDate` of an exam that has
 * one, so the entry is compared with that.
 *
 * Never an exam the student added by hand, by its key: its stored date is the
 * student's already (`setManualExamDate`). A bagrut exam from Mashov's own
 * list is not special here: it is the sheet that does not offer to move it.
 */
export function movedExam<E extends Exam>(exam: E, prefs: ExamPrefs | undefined): E {
  const source = exam.originalDate ?? exam.date;
  const own = isManualKey(exam.naturalKey) ? undefined : prefs?.dates?.[exam.naturalKey];
  if (own && own.sourceDate === source && own.date !== source) return { ...exam, date: own.date, originalDate: source };
  if (exam.originalDate === undefined) return exam;
  const { originalDate: _original, ...rest } = exam;
  return { ...rest, date: source } as E;
}

/**
 * An exam as the student sees it: under their name for it and on their date
 * for it, the source's name and date kept in `originalSubject` and
 * `originalDate`. The one call for both; every place that shows or schedules
 * an exam on the phone makes it, and matching goes by the source's own.
 */
export function ownExam<E extends Exam>(exam: E, prefs: ExamPrefs | undefined): E {
  return renamedExam(movedExam(exam, prefs), prefs);
}

export function ownExams<E extends Exam>(exams: readonly E[], prefs: ExamPrefs | undefined): E[] {
  return exams.map((e) => ownExam(e, prefs));
}
