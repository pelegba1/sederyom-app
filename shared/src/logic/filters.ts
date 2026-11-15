/**
 * The user's own view of the shared data (design-doc §7: "my lessons" and the
 * calendar filters). These run at read time, in one place, so Today, Week, the
 * widget feed and the morning summary agree — and so flipping a switch needs
 * no re-projection.
 */
import type { UserSettings } from '../index';
import { seriesIdOf } from '../index';
import { subjectKey, subjectsMatch } from './subjects';

/** Separates subject from teacher in a hide-list entry that names both. */
export const HIDE_KEY_SEPARATOR = ' @ ';

/**
 * What the hide list stores for a lesson. Plain subject when that is enough;
 * subject and teacher when the same subject is published for two groups, which
 * the live grid does ("מתמטיקה 3 יח"ל" under two teachers).
 */
export function lessonHideKey(lesson: { subject: string; teacher: string | null }, withTeacher: boolean): string {
  const subject = subjectKey(lesson.subject);
  return withTeacher && lesson.teacher ? `${subject}${HIDE_KEY_SEPARATOR}${subjectKey(lesson.teacher)}` : subject;
}

export function isHiddenLesson(hidden: readonly string[], lesson: { subject: string; teacher: string | null }): boolean {
  if (hidden.length === 0) return false;
  const bySubject = lessonHideKey(lesson, false);
  const byBoth = lessonHideKey(lesson, true);
  return hidden.some((h) => {
    const key = subjectKey(h);
    return key === bySubject || key === byBoth;
  });
}

export function filterLessons<T extends { subject: string; teacher: string | null }>(
  lessons: T[],
  settings: Pick<UserSettings, 'lessons'>,
): T[] {
  const hidden = settings.lessons.hiddenSubjects;
  if (hidden.length === 0) return lessons;
  return lessons.filter((l) => !isHiddenLesson(hidden, l));
}

/** One published line of the class timetable: what the hide list is about. */
export interface TimetableLine {
  subject: string;
  teacher: string | null;
}

/**
 * Homework as the day views show it (R-4, R-5):
 *
 * - Not once it became a task (`linkedTaskId`): the task stands for it.
 * - Not for a lesson the owner hid. Mashov names the subject ("פיזיקה"), the
 *   hide list holds the site's lines ("פיזיקה מורחב (יב3)", or
 *   "חינוך גופני @ דנה אלון" for one of two groups), so they rarely agree
 *   character for character. Homework is hidden when its subject is a hidden
 *   key exactly, or when it is the same subject as a hidden line
 *   (`subjectsMatch`) *and* the timetable keeps no line of that subject — a
 *   student who hid one maths group and kept the other still gets the maths
 *   homework. Without a timetable to check, only the exact key hides.
 *
 * Done items stay — the day shows them ticked. `/school` applies the hidden
 * subjects too (`filterHiddenHomework`) but keeps linked items, which the
 * School screen marks as already in the tasks.
 */
export function isShownHomework(
  hidden: readonly string[],
  item: { subject: string; linkedTaskId: string | null },
  timetable: readonly TimetableLine[] = [],
): boolean {
  if (item.linkedTaskId !== null) return false;
  return !isHiddenHomework(hidden, item, timetable);
}

/** The hidden-subject half of `isShownHomework`: whether homework is for a lesson the owner hid. */
export function isHiddenHomework(
  hidden: readonly string[],
  item: { subject: string },
  timetable: readonly TimetableLine[] = [],
): boolean {
  if (hidden.length === 0) return false;
  if (isHiddenLesson(hidden, { subject: item.subject, teacher: null })) return true;
  if (timetable.length === 0) return false;
  const sameSubject = (subject: string) => subjectsMatch(item.subject, subject);
  // The hidden side reads the keys themselves, teacher part dropped, so a line
  // that has since left the grid still counts.
  if (!hidden.some((key) => sameSubject(key.split(HIDE_KEY_SEPARATOR)[0]!))) return false;
  return !timetable.some((line) => sameSubject(line.subject) && !isHiddenLesson(hidden, line));
}

/** `timetable`: the site's lines (`readTimetableLines`), for the subject-level rule above. */
export function filterHomework<T extends { subject: string; linkedTaskId: string | null }>(
  items: T[],
  settings: Pick<UserSettings, 'lessons'>,
  timetable: readonly TimetableLine[] = [],
): T[] {
  return items.filter((h) => isShownHomework(settings.lessons.hiddenSubjects, h, timetable));
}

/** Hidden lessons' homework out, everything else — linked items included — kept. */
export function filterHiddenHomework<T extends { subject: string }>(
  items: T[],
  settings: Pick<UserSettings, 'lessons'>,
  timetable: readonly TimetableLine[] = [],
): T[] {
  const hidden = settings.lessons.hiddenSubjects;
  if (hidden.length === 0) return items;
  return items.filter((h) => !isHiddenHomework(hidden, h, timetable));
}

export interface EventFilter {
  hiddenCalendarIds: readonly string[];
  hiddenEventIds: readonly string[];
  /**
   * The "בית ספר" calendar this server writes exams into (design-doc §5.2).
   * Its events are the exams already shown as chips; on the timeline they
   * would be the same thing twice.
   */
  schoolCalendarId: string | null;
  /**
   * The grade's exam schedule (design-doc §6.4). The owner may also subscribe
   * to it in Google, and then its events arrive twice — once through the
   * Google adapter, once as exams. The exams win; the calendar stays off the
   * timeline.
   */
  examCalendarId?: string | null;
  /**
   * More exam calendars to keep off the timeline, for the same reason: on a phone, the one a student's own exam
   * board reads (`app/src/local/ownBoard.ts`), besides the class's.
   */
  examCalendarIds?: readonly string[];
}

export function isHiddenEvent(event: { id: string; calendarId: string }, filter: EventFilter): boolean {
  if (filter.schoolCalendarId !== null && event.calendarId === filter.schoolCalendarId) return true;
  if (filter.examCalendarId && event.calendarId === filter.examCalendarId) return true;
  if (filter.examCalendarIds?.includes(event.calendarId)) return true;
  if (filter.hiddenCalendarIds.includes(event.calendarId)) return true;
  if (filter.hiddenEventIds.length === 0) return false;
  if (filter.hiddenEventIds.includes(event.id)) return true;
  const series = seriesIdOf(event.id);
  return series !== null && filter.hiddenEventIds.includes(series);
}

export function filterEvents<T extends { id: string; calendarId: string }>(events: T[], filter: EventFilter): T[] {
  return events.filter((e) => !isHiddenEvent(e, filter));
}

/**
 * "My exams" (design-doc §7): the grade's schedule minus what the owner
 * switched off. Keys are the exams' natural keys, so the list survives a
 * re-poll and a projection rebuild alike.
 */
export function isHiddenExam(hidden: readonly string[], exam: { naturalKey: string }): boolean {
  return hidden.length > 0 && hidden.includes(exam.naturalKey);
}

export function filterExams<T extends { naturalKey: string }>(exams: T[], settings: Pick<UserSettings, 'exams'>): T[] {
  const hidden = settings.exams.hiddenKeys;
  if (hidden.length === 0) return exams;
  return exams.filter((e) => !isHiddenExam(hidden, e));
}
