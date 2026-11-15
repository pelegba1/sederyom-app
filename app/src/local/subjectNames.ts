/**
 * The student's own names for subjects on what the phone builds (design
 * 2026-11-05, "איפה מחליפים"): the days, the exam lists, and Mashov's grades,
 * homework and absences. Each item is named once, where it is built, and keeps
 * the source's name in `originalSubject`, the way an exam's own name does
 * (`examPrefs.ts`). The resolver is the shared one the server's pushes call
 * too (`shared/logic/ownNames.ts`), so a lesson has one name on every screen
 * and in every push.
 *
 * What matches or identifies runs first and reads the source's names: the days
 * are named after `assembleDays` built them (hiding, the exams' dedupe, the
 * homework filter), Mashov's lists after they were filtered.
 *
 * With no names (`ctx` is `null`), or for an item no name applies to, each of
 * these gives back the very object it was given: the days cost nothing, and
 * what did not change stays the same object for whatever keeps it.
 *
 * Pure: the sources in, the items out.
 */
import type { AttendanceSubject, DayView, Exam, Grade, Lesson, NextExam, SubjectOption, TimelineItem } from '@sederyom/shared';
import { parseExamTitle } from '@sederyom/shared/logic/exam-match';
import { isHiddenLesson, type TimetableLine } from '@sederyom/shared/logic/filters';
import {
  blockNameKey, examTitle, lessonName, lineBlock, mashovName, nameContext, siteLines, subjectNameKey, withSubjectName,
  type NameContext, type SubjectNames,
} from '@sederyom/shared/logic/ownNames';
import { subjectsMatch } from '@sederyom/shared/logic/subjects';
import { groupLessonOptions, type LessonGroup } from '../lib/school';
import { lessonHideKeys } from '../lib/today';
import type { LocalSources } from './days';

/**
 * The names of the class on screen, against the lines the student keeps: the
 * site's lines (`feed.lessons`, as the server reads them) minus the hide list.
 * `null` when there are none.
 */
export function namesOfSources(src: Pick<LocalSources, 'feed' | 'settings'>): NameContext | null {
  const { subjectNames, hiddenSubjects } = src.settings.lessons;
  // Before the site's lines are gone through: most phones have no names.
  if (!subjectNames || Object.keys(subjectNames).length === 0) return null;
  return nameContext(subjectNames, siteLines(src.feed?.lessons ?? []), hiddenSubjects);
}

/** `item` under `name`, the source's name kept; `item` itself when there is no name, or it is the same. */
function renamed<T extends { subject: string; originalSubject?: string }>(item: T, name: string | null): T {
  return name === null || name === item.subject ? item : { ...item, subject: name, originalSubject: item.subject };
}

/** A lesson of the day or the week, by its line (a lesson of Mashov's grid as a Mashov item). */
export function namedLesson(lesson: Lesson, ctx: NameContext | null): Lesson {
  if (ctx === null || lesson.originalSubject !== undefined) return lesson;
  return renamed(lesson, lessonName(ctx, lesson));
}

/**
 * An exam, with the name it took in `subjectName`. Never over a name the
 * student gave this exam alone (`originalSubject` set by `renamedExam`): that
 * one wins.
 *
 * - An exam from Mashov's own list (`source` Mashov, no `kind`) carries
 *   Mashov's subject, not a title: it is named as Mashov's grades and
 *   homework are, the name whole ("אנגלית 5 יח"ל" → "English").
 * - Any other, bagrut and those added by hand among them, is a title: only
 *   the words that read the subject change ("מבחן גוש ב׳" → "מבחן פיזיקה").
 */
export function namedExam(exam: Exam, ctx: NameContext | null): Exam {
  if (ctx === null || exam.originalSubject !== undefined) return exam;
  if (examTitleIsSubject(exam)) {
    const name = mashovName(ctx, { subject: exam.subject });
    return name === null || name === exam.subject ? exam : { ...exam, subject: name, originalSubject: exam.subject, subjectName: name };
  }
  const named = examTitle(ctx, exam.subject);
  return named === null ? exam : { ...exam, subject: named.title, originalSubject: exam.subject, subjectName: named.name };
}

/** An exam from Mashov's own list carries Mashov's subject in place of a title: a name replaces it whole. */
export function examTitleIsSubject(exam: Pick<Exam, 'source' | 'kind'>): boolean {
  return exam.source === 'mashov' && exam.kind === undefined;
}

/** An item Mashov names, by the one kept line of its subject, else the subject's own name. */
function namedFromMashov<T extends { subject: string; originalSubject?: string }>(item: T, ctx: NameContext | null): T {
  if (ctx === null || item.originalSubject !== undefined) return item;
  return renamed(item, mashovName(ctx, { subject: item.subject }));
}

export function namedHomework<H extends { subject: string; originalSubject?: string }>(item: H, ctx: NameContext | null): H {
  return namedFromMashov(item, ctx);
}

export function namedGrade(grade: Grade, ctx: NameContext | null): Grade {
  return namedFromMashov(grade, ctx);
}

export function namedAttendanceSubject(s: AttendanceSubject, ctx: NameContext | null): AttendanceSubject {
  return namedFromMashov(s, ctx);
}

/** `list` itself when `name` changes none of it, else a copy with the ones it changed. */
function mapped<T>(list: T[], name: (item: T) => T): T[] {
  let out: T[] | null = null;
  list.forEach((item, i) => {
    const next = name(item);
    if (next !== item) (out ??= list.slice())[i] = next;
  });
  return out ?? list;
}

/**
 * The days as `assembleDays` built them, named: the timeline's lessons, the
 * day's exams and the next one, and the homework due. A day nothing in it is
 * named stays the same object.
 */
export function namedDays(days: DayView[], ctx: NameContext | null): DayView[] {
  if (ctx === null) return days;
  // One exam is on several days' lists (today's, the day before's "tomorrow", the next exam): named once.
  const exams = new Map<Exam, Exam>();
  const exam = (e: Exam): Exam => {
    let named = exams.get(e);
    if (named === undefined) exams.set(e, (named = namedExam(e, ctx)));
    return named;
  };
  const item = (i: TimelineItem): TimelineItem => {
    if (i.kind !== 'lesson') return i;
    const lesson = namedLesson(i.lesson, ctx);
    return lesson === i.lesson ? i : { ...i, lesson };
  };
  return mapped(days, (day) => {
    const timeline = mapped(day.timeline, item);
    const examsToday = mapped(day.examsToday, exam);
    const examsTomorrow = mapped(day.examsTomorrow, exam);
    const homework = mapped(day.homework, (h) => namedHomework(h, ctx));
    const nextExam = day.nextExam && namedNext(day.nextExam, exam);
    const same = timeline === day.timeline && examsToday === day.examsToday && examsTomorrow === day.examsTomorrow
      && homework === day.homework && nextExam === day.nextExam;
    return same ? day : { ...day, timeline, examsToday, examsTomorrow, homework, nextExam };
  });
}

function namedNext(next: NextExam, exam: (e: Exam) => Exam): NextExam {
  const shown = exam(next.exam);
  return shown === next.exam ? next : { ...next, exam: shown };
}

// ---------------------------------------------------------------------------
// Where a rename is saved

/**
 * What saving a name writes and clearing it deletes. `keys` are where the name
 * goes: every key of the row of "השיעורים שלי" the thing belongs to, so a
 * merged row ("אזרחות" and "אזרחות (יב2)") is named once, or, when it has no
 * line, the key of its block or subject. `clear` is those and every other
 * key that could give the same thing a name, which "להחזיר את השם המקורי"
 * deletes so that the source's name really comes back.
 */
export interface NameTarget {
  keys: string[];
  clear: string[];
}

function once(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

/**
 * The keys a name given from a lesson is saved under: its row of "השיעורים
 * שלי" (by the source's name, as "זה לא השיעור שלי" finds it), or, for a
 * lesson no line of the site holds (Mashov's grid), the subject.
 */
export function lessonNameTarget(
  lesson: Pick<Lesson, 'subject' | 'originalSubject' | 'teacher'>,
  subjects: readonly SubjectOption[],
): NameTarget {
  const source = lesson.originalSubject ?? lesson.subject;
  const row = lessonHideKeys(lesson, subjects);
  const keys = row.length > 0 ? row : [subjectNameKey(source)];
  const block = lineBlock(source);
  return { keys, clear: once([...keys, ...(block !== null ? [blockNameKey(block)] : []), subjectNameKey(source)]) };
}

/**
 * Where a name given to a row of "השיעורים שלי" is saved, and the names that
 * mean "no name". `keys` are the row's own; `clear` adds the block's and the
 * subject's key of each of its names (as `lessonNameTarget` does), so that
 * emptying the name really gives the source's back; `originals` are the
 * names the row had before any was given.
 */
export interface GroupNameTarget extends NameTarget {
  originals: string[];
}

export function groupNameTarget(group: Pick<LessonGroup, 'keys' | 'names' | 'name'>): GroupNameTarget {
  const others = group.names.flatMap((name) => {
    const block = lineBlock(name);
    return [...(block !== null ? [blockNameKey(block)] : []), subjectNameKey(name)];
  });
  return { keys: group.keys, clear: once([...group.keys, ...others]), originals: once([...group.names, group.name]) };
}

/**
 * The name the student gave a row of "השיעורים שלי", else `null`: the one its
 * lessons are shown under (`lessonName`: a line's own name, else its block's,
 * else the subject's), by the first of its lines that has one. The row is
 * written whole, so its lines rarely disagree.
 */
export function groupOwnName(group: Pick<LessonGroup, 'options'>, names: SubjectNames | undefined): string | null {
  if (!names) return null;
  // Only `names` are read for a lesson of the site; the kept lines matter to Mashov's items.
  const ctx: NameContext = { names, kept: [] };
  for (const option of group.options) {
    const name = lessonName(ctx, { subject: option.name, teacher: option.teacher });
    if (name !== null) return name;
  }
  return null;
}

/**
 * The name a typed draft stands for, as saving it would keep it: cleaned, and
 * `null` when it is empty or one of `originals`. The same rule as
 * `useRenameSubject` applies, so a screen can tell a save that changes
 * nothing from one that does.
 */
export function nameOfDraft(draft: string, originals: readonly string[]): string | null {
  const KEY = 'name';
  return withSubjectName({}, [KEY], draft, originals)[KEY] ?? null;
}

/**
 * `lesson` under `name`, the source's name kept in `originalSubject`; `null`
 * gives it the source's name back. For a sheet that is open while the name is
 * given: the days it was opened from take the name a moment later.
 */
export function lessonWithName(lesson: Lesson, name: string | null): Lesson {
  const { originalSubject, ...plain } = lesson;
  const source = originalSubject ?? lesson.subject;
  return name === null ? { ...plain, subject: source } : { ...plain, subject: name, originalSubject: source };
}

/**
 * The keys a name given from an exam is saved under, read the way
 * `examTitle` reads it (the same kept lines, the same block-or-subject
 * choice), so the name saved is the name that shows. `title` is the source's;
 * `subjects` are the class's lines and `hidden` the hide list: a hidden line
 * is not read, as in `nameContext`.
 *
 * - A title that reads a subject, a block too or not ("כימיה- גוש ב"):
 *   every row holding a kept line that matches the subject, else the
 *   subject's key.
 * - A block exam that reads no subject: every row holding a kept line of
 *   that block, else the block's key.
 * - With `whole` (`examTitleIsSubject`: Mashov's own exam, named as Mashov's
 *   grades are, `namedExam`): every row holding a kept line that matches the
 *   whole subject, else the whole subject's key, a block's letter in it or
 *   not. `clear` also holds the key of the subject the title reads.
 * - `null` when the title reads neither (and for a block without a letter,
 *   which has no key).
 */
export function examNameTarget(
  title: string,
  subjects: readonly SubjectOption[],
  hidden: readonly string[],
  whole = false,
): (NameTarget & { label: string }) | null {
  const kept = keptOptions(subjects, hidden);
  const parsed = parseExamTitle(title, kept.map(lineOf));
  let held: SubjectOption[];
  let fallback: string;
  let label = 'לשנות את שם המקצוע';
  // Other keys that could give it the same name, which "להחזיר את השם המקורי" deletes too.
  const also: string[] = [];
  const letter = parsed.block !== null && parsed.block !== '' ? parsed.block : null;
  if (parsed.subject === '' && letter === null) return null;
  if (whole) {
    held = kept.filter((option) => subjectsMatch(title, option.name));
    fallback = subjectNameKey(title);
    if (parsed.subject !== '') also.push(subjectNameKey(parsed.subject));
  } else if (parsed.subject !== '') {
    const subject = parsed.subject;
    held = kept.filter((option) => subjectsMatch(subject, option.name));
    fallback = subjectNameKey(subject);
  } else {
    // No subject read, so the block's letter is.
    const block = letter!;
    held = kept.filter((option) => lineBlock(option.name) === block);
    fallback = blockNameKey(block);
    label = `לשנות את השם של גוש ${block}׳`;
  }
  const lines = new Set(held);
  const rows = groupLessonOptions(subjects).filter((group) => group.options.some((option) => lines.has(option)));
  const keys = rows.length > 0 ? once(rows.flatMap((group) => group.keys)) : [fallback];
  return { label, keys, clear: once([...keys, fallback, ...also]) };
}

/**
 * The words of an exam's title that a name given to its subject replaces, as
 * the student reads them: the subject as the title reads it ("אנגלית" for
 * "מבחן באנגלית"), or for a block exam that reads no subject "גוש ב׳" (and
 * the title's own spelling of it), as `examNameTarget` chooses. The first
 * is what the name's field shows while it is empty; typed back, any of them
 * means no name (`nameOfDraft`). None for a title `examNameTarget` has no
 * target for.
 *
 * With `whole` (`examTitleIsSubject`: Mashov's own exam, whose "title" is its
 * subject, "אנגלית 5 יח״ל") a name replaces all of it, so all of it comes first.
 */
export function examNameOriginals(title: string, subjects: readonly SubjectOption[], hidden: readonly string[], whole = false): string[] {
  const parsed = parseExamTitle(title, keptOptions(subjects, hidden).map(lineOf));
  const words = parsed.subject !== ''
    ? [parsed.subject, parsed.subjectWords]
    : parsed.block !== null && parsed.block !== '' ? [`גוש ${parsed.block}׳`, parsed.blockWords] : [];
  const read = words.filter((word): word is string => word !== null && word !== '');
  return once(whole && read.length > 0 ? [title, ...read] : read);
}

/**
 * `exam` as the lists show it under `names`: its source's title, named the way
 * `localExamsFrom` names it (`namedExam`), over the class's `subjects` minus
 * the `hidden` list. For a sheet that is open while a name is given or taken
 * away: the screen's copy of the exam is as old as the opening, and the lists
 * are built again a moment later. Whatever name the exam wears now is taken off
 * first, so a second name goes onto the school's title, and an exam whose own
 * name hides its subject's (`renamedExam`) is found with the subject's name
 * beneath it. A name of the exam's own goes over the result, as everywhere.
 */
export function examWithNames<E extends Exam>(
  exam: E,
  names: SubjectNames | undefined,
  subjects: readonly SubjectOption[],
  hidden: readonly string[],
): E {
  const { originalSubject, subjectName: _subjectName, ...rest } = exam;
  const source = { ...rest, subject: originalSubject ?? exam.subject } as E;
  return namedExam(source, nameContext(names, subjects.map(lineOf), hidden)) as E;
}

/** The class's lines the student keeps: not the ones the hide list holds, as `nameContext` reads them. */
function keptOptions(subjects: readonly SubjectOption[], hidden: readonly string[]): SubjectOption[] {
  return subjects.filter((option) => !isHiddenLesson(hidden, lineOf(option)));
}

/** A line of the timetable as the hide list and the name resolver see it. */
function lineOf(option: SubjectOption): TimetableLine {
  return { subject: option.name, teacher: option.teacher };
}
