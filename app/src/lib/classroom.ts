/**
 * Google Classroom work in the app (plan §14.5): which assignments a list
 * shows, in what order, how their due date reads, and the one word for where
 * each stands. Pure, with type-only imports and no clock of its own, and
 * app/test/classroom.test.cjs tests it at a fixed day.
 *
 * No screen shows Classroom work now (plan 2f): the phone reads no
 * Classroom. The rules stay for when it is read again; the task list still
 * uses the undated heading (`UNDATED_HEADING`, `undatedHeadingAt`).
 *
 * Where an assignment stands:
 *  - "הוגש": Classroom says it was handed in (TURNED_IN or RETURNED). Read
 *    only: the app cannot hand anything in.
 *  - "עשיתי": the student marked it done on the phone; Classroom never hears of it.
 *  - open: neither.
 */
import type { ClassroomSubmissionState, ClassroomWork, DateStr } from '@sederyom/shared';
import type { TaskFilter, TodoEntry } from './planner';

/** One run of a line; the same shape as `Part` in lib/today.ts, so `PartsText` draws it. */
export interface DuePart {
  text: string;
  ltr?: boolean;
  tone?: 'alert';
}

/** Overdue work older than this is left to Classroom: its "Missing" list grows all year. */
export const LATE_WINDOW_DAYS = 14;
/** Undated work not touched for this long is left to Classroom too. */
export const UNDATED_WINDOW_DAYS = 30;

export const CLASSROOM_TAG = 'Classroom';
export const UNDATED_HEADING = 'בלי תאריך';

export type ClassroomStatus = 'handedIn' | 'doneHere' | 'open';

export function isHandedIn(state: ClassroomSubmissionState | null): boolean {
  return state === 'TURNED_IN' || state === 'RETURNED';
}

/** Where `work` stands; Classroom's word wins over a mark on the phone. */
export function classroomStatus(work: Pick<ClassroomWork, 'naturalKey' | 'state'>, done: ReadonlySet<string>): ClassroomStatus {
  if (isHandedIn(work.state)) return 'handedIn';
  return done.has(work.naturalKey) ? 'doneHere' : 'open';
}

/** The status word under the box: "הוגש", "עשיתי" — and "עשיתי" too beside an open box, as on homework. */
export function statusWord(status: ClassroomStatus): string {
  return status === 'handedIn' ? 'הוגש' : 'עשיתי';
}

export function isClassroomDone(work: Pick<ClassroomWork, 'naturalKey' | 'state'>, done: ReadonlySet<string>): boolean {
  return classroomStatus(work, done) !== 'open';
}

function shiftDate(value: DateStr, days: number): DateStr {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sunday-first, as lib/format.ts names them. */
const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

function shortDate(date: DateStr): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/**
 * Still worth listing: due no more than `LATE_WINDOW_DAYS` ago, or, without
 * a due date, touched in the last `UNDATED_WINDOW_DAYS`. A list that
 * included every assignment of the year would bury this week's.
 */
export function isRecent(work: Pick<ClassroomWork, 'dueDate' | 'updatedAt'>, today: DateStr): boolean {
  if (work.dueDate) return work.dueDate >= shiftDate(today, -LATE_WINDOW_DAYS);
  const touched = work.updatedAt.slice(0, 10);
  return touched >= shiftDate(today, -UNDATED_WINDOW_DAYS);
}

/**
 * The Classroom work a task list shows, under the same status filter and
 * search as the tasks and the homework: "היום", "מחר" and "באיחור" by due
 * date; "הושלמו" what was handed in or marked here. `keep`: marked a moment
 * ago and still in place (W5-19), as in `selectTasks`.
 */
export function selectClassroom(
  work: readonly ClassroomWork[],
  options: { today: DateStr; filter: TaskFilter; search: string; done: ReadonlySet<string>; keep?: ReadonlySet<string> },
): ClassroomWork[] {
  const search = options.search.trim().toLocaleLowerCase();
  const tomorrow = shiftDate(options.today, 1);
  return work
    .filter((w) => {
      const kept = options.keep?.has(w.naturalKey) === true;
      if (!kept && !isRecent(w, options.today)) return false;
      if (search && !`${w.title} ${w.courseName} ${w.subject ?? ''} ${w.description ?? ''}`.toLocaleLowerCase().includes(search)) return false;
      const finished = isClassroomDone(w, options.done);
      if (options.filter === 'completed') return finished || kept;
      if (finished && !kept) return false;
      if (options.filter === 'today') return w.dueDate === options.today;
      if (options.filter === 'tomorrow') return w.dueDate === tomorrow;
      if (options.filter === 'overdue') return w.dueDate !== null && w.dueDate < options.today;
      return true;
    })
    .sort(byDue);
}

function byDue(a: ClassroomWork, b: ClassroomWork): number {
  return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
    || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99')
    || a.title.localeCompare(b.title, 'he');
}

/** A row of the task list: a task, a homework item, or Classroom work. */
export type ListEntry = TodoEntry | { kind: 'classroom'; work: ClassroomWork };

function dueOf(entry: TodoEntry): DateStr | null {
  return entry.kind === 'task' ? entry.task.due : entry.homework.dueDate;
}

/**
 * Classroom work among the tasks and the homework (`todoEntries`), by due
 * date: on a day it shares, it comes first, as homework does; undated, it
 * comes last. Under "הושלמו" it follows everything, as homework does there.
 */
export function withClassroom(entries: readonly TodoEntry[], work: readonly ClassroomWork[], filter: TaskFilter): ListEntry[] {
  const classroom = work.map((w): ListEntry => ({ kind: 'classroom', work: w }));
  if (filter === 'completed') return [...entries, ...classroom];
  const out: ListEntry[] = [];
  let i = 0;
  for (const c of work) {
    const due = c.dueDate;
    // Everything due before it, or (undated) everything at all, goes first.
    while (i < entries.length) {
      const other = dueOf(entries[i]!);
      const before = due === null ? true : other !== null && other < due;
      if (!before) break;
      out.push(entries[i++]!);
    }
    out.push({ kind: 'classroom', work: c });
  }
  while (i < entries.length) out.push(entries[i++]!);
  return out;
}

/** The due date of any row; null when it has none. */
export function entryDue(entry: ListEntry): DateStr | null {
  return entry.kind === 'classroom' ? entry.work.dueDate : dueOf(entry);
}

/**
 * Where the "בלי תאריך" heading goes: before the first undated row, once
 * dated rows came before it — a heading separates, and over a list of
 * undated rows alone it would say nothing. -1 for no heading; never under
 * "הושלמו", which is ordered by when, not by due date.
 */
export function undatedHeadingAt(entries: readonly ListEntry[], filter: TaskFilter): number {
  if (filter === 'completed') return -1;
  const at = entries.findIndex((e) => entryDue(e) === null);
  return at > 0 ? at : -1;
}

/**
 * "להגשה היום עד 14:00", "להגשה מחר", "להגשה עד יום חמישי 15.10", "להגשה
 * ב־6.10, באיחור", "בלי תאריך הגשה" — homework's wording (lib/today.ts),
 * with the hour on the day itself and the next, when it is not the end of
 * the day. Dates and times are `ltr` parts. Work that is done is never
 * "באיחור".
 */
export function classroomDueParts(
  work: Pick<ClassroomWork, 'dueDate' | 'dueTime'>,
  today: DateStr,
  done = false,
): DuePart[] {
  const due = work.dueDate;
  if (!due) return [{ text: 'בלי תאריך הגשה' }];
  const time = work.dueTime && work.dueTime !== '23:59' ? work.dueTime : null;
  const at = (lead: string): DuePart[] => (time ? [{ text: `${lead} עד ` }, { text: time, ltr: true }] : [{ text: lead }]);
  if (due === today) return at('להגשה היום');
  if (due === shiftDate(today, 1)) return at('להגשה מחר');
  if (due < today) {
    const parts: DuePart[] = [{ text: 'להגשה ב־' }, { text: shortDate(due), ltr: true }];
    if (!done) parts.push({ text: ', באיחור', tone: 'alert' });
    return parts;
  }
  const weekday = WEEKDAYS[new Date(`${due}T12:00:00Z`).getUTCDay()] ?? '';
  return [{ text: `להגשה עד ${weekday} ` }, { text: shortDate(due), ltr: true }];
}

/** The line as plain text, for an accessibility label. */
export function dueText(parts: readonly DuePart[]): string {
  return parts.map((p) => p.text).join('');
}

/** What the row says it is about: the timetable subject, or the course's own name. */
export function workSubject(work: Pick<ClassroomWork, 'subject' | 'courseName'>): string {
  return work.subject ?? work.courseName;
}

/** How much of the list is open and late, for the header's count (W5-18): Classroom counts as homework. */
export function classroomCounts(work: readonly ClassroomWork[], today: DateStr, done: ReadonlySet<string>): { open: number; overdue: number } {
  const open = selectClassroom(work, { today, filter: 'open', search: '', done });
  return { open: open.length, overdue: open.filter((w) => w.dueDate !== null && w.dueDate < today).length };
}

/** The most marks kept on the phone; the oldest go first. */
export const MAX_DONE_KEYS = 500;

/** The phone's marks, from storage; anything unreadable is no marks. */
export function parseDoneKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** `keys` with `key` marked or unmarked, newest last, at most `MAX_DONE_KEYS`. */
export function toggleDoneKey(keys: readonly string[], key: string, on: boolean): string[] {
  const rest = keys.filter((k) => k !== key);
  const next = on ? [...rest, key] : rest;
  return next.slice(-MAX_DONE_KEYS);
}
