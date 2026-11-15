/**
 * The year in review ("סיכום שנה", design 2026-11-10 §8–§9): what goes in, and
 * the cards that come out.
 *
 * Every number is a count or a sum of rows that came in: nothing is estimated,
 * and a card that has too little behind it is not returned. Each card carries
 * the rows it counted (`records`), which is what "מאיפה המספר" shows.
 */
import type { ClassHistory, DateStr, Grade } from '../../index';
import type { NormalizedTask } from '../google/tasks';
import type { SubjectNames } from '../ownNames';
import type { AttendancePayload, LessonCountPayload } from '../mashov/attendance';

export type WrappedCardId =
  | 'intro' | 'hours' | 'held' | 'cancelled' | 'cancelledTop' | 'sleep' | 'substitutes' | 'days' | 'exams' | 'tasks'
  | 'attendance' | 'grades' | 'outro';

/**
 * One row behind a number. There is no field for a teacher or a substitute, on
 * purpose: a record cannot carry one. `amount` is a grade only under `kind: 'grade'`,
 * which only the grades card writes.
 */
export interface WrappedRecord {
  date: DateStr | null;
  hour: number | null;
  subject: string | null;
  /** A task's title; null elsewhere. */
  title: string | null;
  kind: 'day' | 'held' | 'cancelled' | 'sleep' | 'substitution' | 'moved' | 'exam' | 'task' | 'homework' | 'absence' | 'late' | 'grade';
  /** Lessons of a day, minutes of a free period, lessons held, a grade; null where the row is the fact. */
  amount: number | null;
}

export interface WrappedCard {
  id: WrappedCardId;
  /** The card's one number. */
  value: number;
  /** What the sentence around the number needs. */
  params: Record<string, string | number | null>;
  /** The days the number covers, inclusive; null when it covers none. */
  from: DateStr | null;
  to: DateStr | null;
  /** False for grades and attendance: those cards have no share button. */
  shareable: boolean;
  records: WrappedRecord[];
}

export interface WrappedInput {
  today: DateStr;
  zone: string;
  /** `GET /v2/class/history` as the phone keeps it; null before the first read. */
  history: Pick<ClassHistory, 'coverage' | 'lessons' | 'exams'> | null;
  /** `settings.lessons.hiddenSubjects`: the class's lines that are not this student's. */
  hiddenSubjects: readonly string[];
  /** `settings.lessons.subjectNames`: the student's own names for subjects, which the cards show. */
  subjectNames: SubjectNames;
  /** The names the student gave single exams (`ExamPrefs.renames`), by natural key: such a name is shown as it is. */
  examNames: Readonly<Record<string, string>>;
  /** `settings.exams.hiddenKeys`. */
  hiddenExamKeys: readonly string[];
  /** `settings.attendance.daysOff`. */
  ownDaysOff: readonly DateStr[];
  manualExams: readonly { naturalKey: string; date: DateStr; subject: string }[];
  /** null without a Mashov connection. */
  mashov: {
    counts: readonly LessonCountPayload[];
    attendance: readonly AttendancePayload[];
    grades: readonly Pick<Grade, 'date' | 'subject' | 'value'>[];
  } | null;
  /** Google's tasks or the phone's own; null when there are none to read. */
  tasks: readonly Pick<NormalizedTask, 'title' | 'due' | 'completed' | 'completedAt' | 'deleted'>[] | null;
  /** The homework ticks that kept their moment (`HomeworkState.doneAt`); no subject once Mashov stopped listing the item. */
  homework: readonly { subject: string | null; doneAt: string }[];
}

/** 1 September of the school year `today` is in; July and August still belong to the year that ended. */
export function schoolYearStart(today: DateStr): DateStr {
  const year = Number(today.slice(0, 4));
  return `${Number(today.slice(5, 7)) >= 9 ? year : year - 1}-09-01`;
}

/** One decimal place. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The entry that stands alone at the top; null on a tie or an empty map. */
export function soleLeader<K>(counts: Map<K, number>): { key: K; count: number } | null {
  let best: { key: K; count: number } | null = null;
  let tied = false;
  for (const [key, count] of counts) {
    if (!best || count > best.count) {
      best = { key, count };
      tied = false;
    } else if (count === best.count) tied = true;
  }
  return best && !tied ? best : null;
}
