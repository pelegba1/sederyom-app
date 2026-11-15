/**
 * When homework is due (plan Phase 2e: shared, so the phone dates it the way
 * the server does). Mashov dates an item by the lesson it was given in; the
 * due date is the next lesson of that subject.
 */
import type { DateStr } from '../index';
import { isHiddenLesson } from './filters';
import { subjectKey, subjectsMatch, teachersMatch } from './subjects';
import { addDays } from './time';

/** The normalized Mashov homework payload, as far as the projection reads it. */
export interface HomeworkPayload {
  /** The adapter's date: the assignment date unless `dueExplicit`. */
  dueDate: DateStr | null;
  subject: string;
  text: string;
  /** True only when Mashov carried an explicit due/submission date. */
  dueExplicit?: boolean;
  /** The group and teacher, when the adapter knows them — they pick between parallel groups. */
  groupName?: string | null;
  teacher?: string | null;
}

/** One row of the `lesson` table, as far as the due-date search reads it. */
export interface DueLesson {
  date: DateStr;
  hourIndex: number;
  subject: string;
  teacher: string | null;
  status: string;
  source: string;
}

/** How far after the assignment date the next lesson is looked for. */
export const DUE_LOOKAHEAD_DAYS = 14;

/**
 * When a homework item is due. An explicit due date stands. Otherwise the
 * item's date is the lesson it was given in, and it is due at the next lesson
 * of the same subject — strictly after that day, within `DUE_LOOKAHEAD_DAYS`:
 *
 * - Shahaf lessons first; Mashov's projected grid only when Shahaf has none.
 * - Cancelled lessons and lines the owner hid ("not my lessons") never count.
 * - Among the rest, the owner's own group wins: a lesson whose teacher matches
 *   the item's, or whose published line is the item's group or subject exactly.
 *   Without such a lesson, any lesson of the subject does.
 * - With no lesson found, the assignment date is kept.
 *
 * Pure, so every rule is tested without a database.
 */
export function deriveDueDate(
  item: HomeworkPayload,
  lessons: readonly DueLesson[],
  zone: string,
  hiddenSubjects: readonly string[] = [],
): DateStr | null {
  const assigned = item.dueDate;
  if (item.dueExplicit === true || !assigned) return assigned;
  const until = addDays(assigned, DUE_LOOKAHEAD_DAYS, zone);
  const names = [item.subject, item.groupName].filter((n): n is string => Boolean(n));

  const candidates = lessons.filter(
    (l) =>
      l.date > assigned &&
      l.date <= until &&
      l.status !== 'cancelled' &&
      !isHiddenLesson(hiddenSubjects, l) &&
      names.some((n) => subjectsMatch(n, l.subject)),
  );
  for (const source of ['shahaf', 'mashov']) {
    const pool = candidates.filter((l) => l.source === source);
    if (pool.length === 0) continue;
    const own = pool.filter((l) => isOwnGroup(item, names, l));
    const next = (own.length > 0 ? own : pool).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hourIndex - b.hourIndex))[0]!;
    return next.date;
  }
  return assigned;
}

function isOwnGroup(item: HomeworkPayload, names: string[], lesson: DueLesson): boolean {
  if (teachersMatch(item.teacher ?? null, lesson.teacher) === true) return true;
  const line = subjectKey(lesson.subject);
  return names.some((n) => subjectKey(n) === line);
}
