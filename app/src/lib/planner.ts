import type { CreateTaskBody, DateStr, HomeworkItem, Instant, Task, TaskListOption } from '@sederyom/shared';
import { countdownLabel, daysUntil, dueLabel, formatDate, formatShortDate, isolateRanges, plural, shownSubject, toDateStr, type SubjectItem } from './format';

const iso = (date: Date): string => date.toISOString().slice(0, 10);

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && iso(date) === value;
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

export function shiftMonth(value: string, months: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, end));
  return iso(date);
}

/**
 * The first of `value`'s month: what a month grid shows. Paging the grid moves
 * this, never the chosen day (W4-12c: paging a month used to pick the same
 * day in the next month, and a task saved then got a date nobody chose).
 */
export function monthOf(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function monthDates(value: string): string[] {
  const first = `${value.slice(0, 7)}-01`;
  const start = shiftDate(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
  const next = shiftMonth(first, 1);
  const count = Math.ceil((Date.parse(`${next}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000 / 7) * 7;
  return Array.from({ length: count }, (_, i) => shiftDate(start, i));
}

export type TaskFilter = 'open' | 'today' | 'tomorrow' | 'overdue' | 'completed';

/** When a task was last touched, which for a completed one is when it was ticked; unknown sorts last. */
function touchedAt(task: Task): number {
  const at = task.updated ? Date.parse(task.updated) : NaN;
  return Number.isFinite(at) ? at : -Infinity;
}

/**
 * The task list under the status, list and search filters. Open work is
 * ordered by due date, overdue first and undated last; "הושלמו" is ordered by
 * when each task was completed, newest first (B3).
 *
 * `keep` holds tasks just ticked (or unticked) that stay in place a moment
 * longer, drawn ticked, so the tick is seen before the row leaves (W5-19,
 * Daniel: "it just vanishes").
 */
export function selectTasks(
  tasks: Task[],
  options: { today: string; filter: TaskFilter; listId: string | null; search: string; keep?: ReadonlySet<string> },
): Task[] {
  const search = options.search.trim().toLocaleLowerCase();
  const tomorrow = shiftDate(options.today, 1);
  const selected = tasks.filter(task => {
    if (options.listId && task.listId !== options.listId) return false;
    if (search && !`${task.title} ${task.notes ?? ''}`.toLocaleLowerCase().includes(search)) return false;
    const kept = options.keep?.has(task.id) === true;
    if (options.filter === 'completed') return task.completed || kept;
    if (task.completed && !kept) return false;
    if (options.filter === 'today') return task.due === options.today;
    if (options.filter === 'tomorrow') return task.due === tomorrow;
    if (options.filter === 'overdue') return task.due !== null && task.due < options.today;
    return true;
  });
  if (options.filter === 'completed') {
    return selected.sort((a, b) => {
      const ta = touchedAt(a);
      const tb = touchedAt(b);
      return ta === tb ? a.title.localeCompare(b.title, 'he') : tb > ta ? 1 : -1;
    });
  }
  return selected.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'he'));
}

/**
 * Whether a homework item already lives on as a task. `taskIds` is every task
 * the app knows (open and completed): a link to a task that has since been
 * deleted — the "בטל" after "הוסף למשימות שלי", or a delete in Google Tasks —
 * no longer counts, so the homework shows up again. `null` trusts the link.
 */
export function isLinkedToTask(item: Pick<HomeworkItem, 'linkedTaskId'>, taskIds: ReadonlySet<string> | null): boolean {
  if (!item.linkedTaskId) return false;
  return taskIds === null || taskIds.has(item.linkedTaskId);
}

/**
 * The "שיעורי בית ממשוב" section under the same status filter and search as
 * the task list (B11), by due date: "היום" is homework due today, "באיחור"
 * open homework whose date has passed, "הושלמו" homework marked done.
 * Homework that is already a task is left out — the task stands for it.
 */
export function selectHomework(
  items: HomeworkItem[],
  options: { today: string; filter: TaskFilter; search: string; taskIds: ReadonlySet<string> | null; keep?: ReadonlySet<string> },
): HomeworkItem[] {
  const search = options.search.trim().toLocaleLowerCase();
  const tomorrow = shiftDate(options.today, 1);
  return items.filter(item => {
    if (isLinkedToTask(item, options.taskIds)) return false;
    if (search && !`${item.subject} ${item.text}`.toLocaleLowerCase().includes(search)) return false;
    // `keep`: ticked a moment ago and still in place, as in `selectTasks`.
    const kept = options.keep?.has(item.naturalKey) === true;
    if (options.filter === 'completed') return item.done === true || kept;
    if (item.done && !kept) return false;
    if (options.filter === 'today') return item.dueDate === options.today;
    if (options.filter === 'tomorrow') return item.dueDate === tomorrow;
    if (options.filter === 'overdue') return item.dueDate !== null && item.dueDate < options.today;
    return true;
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.subject.localeCompare(b.subject, 'he'));
}

/** Nothing under a filter, tasks and homework both (R-12). */
const EMPTY_BOTH: Record<TaskFilter, string> = {
  open: 'הכול פנוי כאן. אפשר לנשום או לתכנן קדימה.',
  today: 'אין משימות או שיעורי בית להיום',
  tomorrow: 'אין משימות או שיעורי בית למחר',
  overdue: 'אין משימות או שיעורי בית באיחור',
  completed: 'עוד אין משימות או שיעורי בית שסומנו כבוצעו',
};

/** No tasks under a filter, while the homework is not known yet (loading, failed, Mashov not connected). */
const EMPTY_TASKS: Record<TaskFilter, string> = {
  // Not "אין משימות פתוחות": the header's counter already says so, right above.
  open: 'הכול פנוי כאן. אפשר לנשום או לתכנן קדימה.',
  today: 'אין משימות להיום',
  tomorrow: 'אין משימות למחר',
  overdue: 'אין משימות באיחור',
  completed: 'עוד אין משימות שהושלמו',
};

export interface TasksEmptyState {
  /** The one empty state, in the list's place; null when there is something to list. */
  text: string | null;
  /**
   * Whether a line about the homework shows under the list: only while it is
   * not known (loading, failed, Mashov not connected). Known homework is in
   * the list itself (W5-18).
   */
  homeworkNote: boolean;
}

/**
 * The Tasks screen's empty state under one filter (R-12). One message, and
 * an honest one: never "אין משימות באיחור" above overdue homework.
 *
 * - Tasks or homework listed: no message — they are the list.
 * - Neither: one message for both ("אין משימות או שיעורי בית באיחור").
 * - No tasks, homework not known (`homework: null` — still loading, failed,
 *   or Mashov not connected): a message about the tasks alone, and a line
 *   about the homework says what is going on with it.
 */
export function tasksEmptyState(options: { filter: TaskFilter; search: boolean; tasks: number; homework: number | null }): TasksEmptyState {
  const homeworkNote = options.homework === null;
  if (options.tasks > 0 || (options.homework ?? 0) > 0) return { text: null, homeworkNote };
  if (homeworkNote) {
    return { text: options.search ? 'לא נמצאו משימות שמתאימות לחיפוש' : EMPTY_TASKS[options.filter], homeworkNote };
  }
  return { text: options.search ? 'לא נמצאו משימות או שיעורי בית שמתאימים לחיפוש' : EMPTY_BOTH[options.filter], homeworkNote };
}

/** One row of the Tasks screen's list: a Google task, or a Mashov homework item. */
export type TodoEntry =
  | { kind: 'task'; task: Task }
  | { kind: 'homework'; homework: HomeworkItem };

/**
 * Tasks and Mashov homework as one list (W5-18, Itai, three runs in a row: "רשימה
 * אחת של מה שאני צריך לעשות"). Both come in filtered and sorted
 * (`selectTasks`, `selectHomework`) and are merged by due date — overdue
 * first, undated last — homework before a task due the same day. Under
 * "הושלמו" the tasks keep their completion order and the homework, which has
 * no completion time, follows.
 */
export function todoEntries(tasks: readonly Task[], homework: readonly HomeworkItem[], filter: TaskFilter): TodoEntry[] {
  const t = tasks.map((task): TodoEntry => ({ kind: 'task', task }));
  const h = homework.map((item): TodoEntry => ({ kind: 'homework', homework: item }));
  if (filter === 'completed') return [...t, ...h];
  const due = (entry: TodoEntry): string => (entry.kind === 'task' ? entry.task.due : entry.homework.dueDate) ?? '9999';
  const out: TodoEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < t.length || j < h.length) {
    if (j < h.length && (i >= t.length || due(h[j]!) <= due(t[i]!))) out.push(h[j++]!);
    else out.push(t[i++]!);
  }
  return out;
}

/**
 * The Tasks header's count: everything open in the list, tasks and homework
 * together (W5-18), as one number, "24 פתוחות", and how many of them are
 * late ("2 באיחור"), which the screen writes after it in the red pen. Run 8:
 * "12 משימות, 12 שיעורי בית, 2 באיחור" read as 24 or as 12. Each row names
 * its own kind ("שיעורי בית", "Classroom"), so the count need not. With no
 * homework open or known, the tasks alone: "10 פתוחות", "משימה פתוחה אחת".
 */
export function todoCounter(counts: { tasks: number; homework: number | null; overdue: number }): { text: string; overdue: string | null } {
  const { tasks, homework, overdue } = counts;
  const open = tasks + (homework ?? 0);
  let text: string;
  if (open === 0) text = homework === 0 ? 'אין משימות או שיעורי בית פתוחים' : 'אין משימות פתוחות';
  else if (!homework) text = plural(tasks, 'משימה פתוחה אחת', 'פתוחות');
  else text = plural(open, 'אחת פתוחה', 'פתוחות');
  return { text, overdue: overdue > 0 ? plural(overdue, 'אחת באיחור', 'באיחור') : null };
}

/** Between the pieces of the Tasks header's count, the late count included. */
export const COUNT_SEPARATOR = ', ';

/**
 * A task row's due line (`dueLabel`): "6.10, באיחור" for a late one. Under
 * a "באיחור" heading (`underLate`, Today's late section) the word is said
 * once already, so the line says how late instead — "6.10, לפני 3 ימים",
 * or "אתמול" — still in the warning colour (`overdue`), as T's homework rows
 * do ("להגשה ב־6.10, לפני 3 ימים").
 */
export function taskDueText(
  due: DateStr,
  opts: { completed?: boolean; underLate?: boolean; now?: Date } = {},
): { text: string; overdue: boolean } {
  const label = dueLabel(due, opts);
  if (!label.overdue || !opts.underLate) return label;
  const days = daysUntil(due, opts.now);
  return { text: days === -1 ? countdownLabel(days) : `${formatShortDate(due)}, ${countdownLabel(days)}`, overdue: true };
}

/** U+00A0: a space a line does not break at. */
const NBSP = String.fromCharCode(0xa0);

/** `text` that wraps as one piece: its spaces do not break. */
export function unbroken(text: string): string {
  return text.replace(/ /g, NBSP);
}

/**
 * The Tasks header's count as it is drawn (W6-9): the count, then
 * `COUNT_SEPARATOR` and how many are late, that last in the red pen. The line
 * may wrap to a second line, but only after a comma: never inside "אחת
 * באיחור" or "12 שיעורי בית". Cut to one line it read "10 משימות · 9 שיעורי
 * בית · אחת באי…", and "באיחור" was exactly what went (Maya, Daniel, run 5).
 * `overdue` starts with its separator, so a line never opens on the comma.
 */
export function counterLine(count: { text: string; overdue: string | null }): { text: string; overdue: string | null } {
  // One piece alone — "אין משימות או שיעורי בית פתוחים" — wraps as a sentence does.
  if (count.overdue === null && !count.text.includes(COUNT_SEPARATOR)) return count;
  const pieces = (line: string): string => line.split(COUNT_SEPARATOR).map(unbroken).join(COUNT_SEPARATOR);
  return { text: pieces(count.text), overdue: count.overdue ? `${COUNT_SEPARATOR}${unbroken(count.overdue)}` : null };
}

/**
 * What the margin of a dated row says (plan §16.1): "היום", "מחר", or the
 * date ("6.10", through `Ltr`), as the due line said it before (`dueLabel`).
 * `null` for a row without a date: its margin stays empty.
 */
export function dueMarginText(due: DateStr | null | undefined, today: DateStr): string | null {
  if (!due) return null;
  if (due === today) return 'היום';
  if (due === shiftDate(today, 1)) return 'מחר';
  return formatShortDate(due);
}

/** Whether a dated row is late: due before today and not done. Done work is never late (B2). */
export function isLate(due: DateStr | null | undefined, today: DateStr, done = false): boolean {
  return !done && Boolean(due) && (due as DateStr) < today;
}

/**
 * Where a horizontal row's scroll ends, given the first offset it reported
 * after the student started scrolling (`firstX`) and how far it can scroll
 * (`max`). A right-to-left row starts at one end or the other depending on
 * the platform (0 or `max`; the web counts down from 0), so the start is read
 * off the first move: the end is the other side. Used to drop the "more"
 * cue of the Tasks chip row once its last chip is in view (W6-9).
 */
export function scrollEndOffset(firstX: number, max: number): number {
  if (firstX < 0) return -max;
  return firstX <= max / 2 ? max : 0;
}

/** How long a just-ticked row stays in place, ticked, before it leaves the list (W5-19). */
export const TICK_LINGER_MS = 900;

/**
 * "הושלמה ב־8.10" for a completed task (R-15): the day it was last changed,
 * which for a ticked task is the tick. Close by it reads "הושלמה היום" or
 * "הושלמה אתמול"; another year's date is written in full ("ב־2.12.2023"),
 * so the same chore done twice reads as two different days. `date` goes
 * through `Ltr`. Null when the time is unknown.
 */
export function completedLabel(updated: Instant | null | undefined, today: DateStr): { lead: string; date: string | null } | null {
  if (!updated) return null;
  const at = new Date(updated);
  if (!Number.isFinite(at.getTime())) return null;
  const day = toDateStr(at);
  if (day >= today) return { lead: 'הושלמה היום', date: null };
  if (day === shiftDate(today, -1)) return { lead: 'הושלמה אתמול', date: null };
  return { lead: 'הושלמה ב־', date: day.slice(0, 4) === today.slice(0, 4) ? formatShortDate(day) : formatDate(day) };
}

/** `completedLabel` as one string, for an accessibility label. */
export function completedText(label: { lead: string; date: string | null }): string {
  return `${label.lead}${label.date ?? ''}`;
}

/** The longest homework text that goes into a task's title; the whole text then goes to its notes. */
export const HOMEWORK_TITLE_MAX = 60;

/** `text` cut at a word boundary to at most `max` characters, with "…" when cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** "בית ספר" (or "בית הספר"): the Google Tasks list homework goes into when there is one. */
const SCHOOL_LIST = /^בית\s*ה?ספר$/;

export function schoolListId(lists: readonly TaskListOption[]): string | null {
  return lists.find(list => SCHOOL_LIST.test(list.title.trim()))?.id ?? null;
}

/**
 * "הוסף למשימות שלי" for a homework item (F16): a short title — the subject
 * without its group and level, then the assignment's first line ("אנגלית:
 * לקרוא את הפרק השלישי") — with the full text in the notes when the title
 * had to shorten it. Goes into the "בית ספר" list when `listId` is given,
 * otherwise into the default list.
 */
export function homeworkTaskBody(
  item: Pick<HomeworkItem, 'naturalKey' | 'subject' | 'originalSubject' | 'text' | 'dueDate'>,
  listId: string | null,
): CreateTaskBody {
  const full = item.text.trim();
  const firstLine = (full.split(/\r?\n/).find(line => line.trim() !== '') ?? '').replace(/\s+/g, ' ').trim();
  const short = clip(firstLine, HOMEWORK_TITLE_MAX);
  const subject = shownSubject(item);
  const shortened = short !== full.replace(/\s+/g, ' ');
  return {
    title: short ? `${subject}: ${short}` : subject,
    notes: shortened && full ? full : null,
    due: item.dueDate ?? null,
    fromHomeworkKey: item.naturalKey,
    ...(listId ? { listId } : {}),
  };
}

/** Which due-date chip of the compose sheet a date selects. */
export type DueChoice = 'today' | 'tomorrow' | 'nextSchoolDay' | 'nextWeek' | 'none' | 'custom';

/** 0 for Sunday … 6 for Saturday, whatever the device's time zone. */
function weekday(date: DateStr): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/**
 * The first school day after `today`, for "יום הלימודים הבא". The week
 * counted here runs Sunday to Thursday: Saturday is off, and Friday — a
 * short day at most — is not what "the next school day" means.
 */
export function nextSchoolDay(today: DateStr): DateStr {
  let day = shiftDate(today, 1);
  while (weekday(day) > 4) day = shiftDate(day, 1);
  return day;
}

/** A preset due-date chip: its key and the date it stands for (null for "ללא תאריך"). */
export interface DueOption {
  key: Exclude<DueChoice, 'custom'>;
  date: DateStr | null;
}

/**
 * The compose sheet's preset due dates for `today`, in order (R-13): "היום",
 * "מחר", "יום הלימודים הבא", "בעוד שבוע", "ללא תאריך" — "תאריך אחר" comes
 * after them. "יום הלימודים הבא" is there only when tomorrow is a Friday or
 * a Saturday, when it means Sunday; any other day it would just be "מחר".
 */
export function dueOptions(today: DateStr): DueOption[] {
  const tomorrow = shiftDate(today, 1);
  const school = nextSchoolDay(today);
  return [
    { key: 'today', date: today },
    { key: 'tomorrow', date: tomorrow },
    ...(school !== tomorrow ? [{ key: 'nextSchoolDay' as const, date: school }] : []),
    { key: 'nextWeek', date: shiftDate(today, 7) },
    { key: 'none', date: null },
  ];
}

/**
 * The chip for `date` (B9): the preset it is, in the order shown, or
 * "תאריך אחר" for any other day. Editing a task due next Sunday on a
 * Thursday selects "יום הלימודים הבא".
 */
export function dueChoiceFor(date: DateStr | null | undefined, today: DateStr): DueChoice {
  if (!date) return 'none';
  return dueOptions(today).find((option) => option.date === date)?.key ?? 'custom';
}

/**
 * The due date the compose sheet saves for the chip `choice`: a preset's own
 * date, or for "תאריך אחר" the day picked in the month grid (`custom`, '' until
 * one is). `ready` is false only for "תאריך אחר" with no valid day picked yet.
 */
export function composeDue(choice: DueChoice, custom: string, today: DateStr): { due: DateStr | null; ready: boolean } {
  if (choice === 'custom') return validDate(custom) ? { due: custom, ready: true } : { due: null, ready: false };
  return { due: dueOptions(today).find((option) => option.key === choice)?.date ?? null, ready: true };
}

/**
 * Whether the compose sheet can save (its button, and Enter in the title):
 * a title that is more than spaces, nothing already saving, and a due date
 * that is ready (`composeDue`). A day picked under "תאריך אחר" counts like a
 * preset's date (run 8, Noa: "תאריך אחר" with 13.10 seemed not to save).
 */
export function canSubmitTask(state: { title: string; choice: DueChoice; custom: string; pending: boolean; today: DateStr }): boolean {
  return !state.pending && state.title.trim().length > 0 && composeDue(state.choice, state.custom, state.today).ready;
}

// ---------------------------------------------------------------------------
// Wave 4
// ---------------------------------------------------------------------------

/** U+200F, the right-to-left mark: a strong right-to-left letter that draws nothing. */
const RLM = String.fromCharCode(0x200f);

/**
 * A field's placeholder, for a right-to-left field. Ending it with a
 * right-to-left mark keeps the closing "?" or "…" at the end of the sentence
 * (on the left) wherever the field lays out left to right — the web build,
 * or a hint drawn before any text has set the field's direction. Without it
 * the reader saw "?מה צריך לעשות" and "…חיפוש" (Daniel, run 3).
 */
export function rtlPlaceholder(text: string): string {
  return text.endsWith(RLM) ? text : `${text}${RLM}`;
}

/**
 * How long, after a sheet closes, a tap on the list under it is ignored. The
 * tap that closed the sheet with its X also landed on the task row under the
 * X and opened that task — twice in a row (Maya, run 3).
 */
export const SHEET_CLOSE_GUARD_MS = 450;

/** Whether a press at `now` counts: not within `guardMs` after a sheet closed at `closedAt` (ms). */
export function pressAllowed(now: number, closedAt: number | null, guardMs: number = SHEET_CLOSE_GUARD_MS): boolean {
  if (closedAt === null) return true;
  // A clock that went back (a time-zone change) never blocks presses for good.
  return now < closedAt || now - closedAt >= guardMs;
}

/** The longest task title a toast quotes; a longer one is cut at a word, with "…". */
export const TOAST_TITLE_MAX = 40;

/**
 * A toast about one task, naming it: "הושלמה: לקרוא פרק 3" (Daniel: "הושלמה"
 * alone did not say which). Ranges in the title stay in order ("שאלות 1–5").
 */
export function taskToastText(lead: string, title: string): string {
  const name = clip(title.replace(/\s+/g, ' ').trim(), TOAST_TITLE_MAX);
  return name ? `${lead}: ${isolateRanges(name)}` : lead;
}

/** The toast after ticking a task off, or back on. */
export function toggleToastText(task: Pick<Task, 'title' | 'completed'>): string {
  return taskToastText(task.completed ? 'הוחזרה לפתוחות' : 'הושלמה', task.title);
}

/**
 * What brings a deleted task back (W4, Daniel: a delete closes the sheet at
 * once, with "החזרה"). Google Tasks cannot undelete, so it is created again:
 * the same title, notes, date and list, and linked again to the homework it
 * came from, so the homework does not reappear beside it.
 */
export function restoreTaskBody(task: Pick<Task, 'title' | 'notes' | 'due' | 'listId' | 'linkedHomeworkKey'>): CreateTaskBody {
  return {
    title: task.title,
    notes: task.notes,
    due: task.due,
    listId: task.listId,
    ...(task.linkedHomeworkKey ? { fromHomeworkKey: task.linkedHomeworkKey } : {}),
  };
}

/**
 * Moving a task to another list (W5-19, Maya and Daniel: it was saved in "המשימות
 * שלי" and belonged in "בית ספר"). Google Tasks cannot move a task, and the
 * update carries no list, so the task is created in the new list — the same
 * body that brings back a deleted one (`restoreTaskBody`), with the edits
 * the sheet holds — and the old one is deleted after. Created first: a
 * failure leaves the old task where it was, and the homework it came from
 * is linked to the new one before the old one's delete unlinks it.
 */
export function movedTaskBody(
  task: Pick<Task, 'title' | 'notes' | 'due' | 'listId' | 'linkedHomeworkKey'>,
  edits: Pick<Task, 'title' | 'notes' | 'due'>,
  listId: string,
): CreateTaskBody {
  return restoreTaskBody({ ...task, ...edits, listId });
}

/** Whether saving the sheet moves `task` to another list: a list picked, and not its own. */
export function movesTask(task: Pick<Task, 'listId'>, listId: string | null): listId is string {
  return listId !== null && listId !== task.listId;
}

/**
 * The title a task for a lesson starts with — "שיעורי בית בפיזיקה" — from the
 * lesson sheet's "משימה לשיעור הבא". The subject without its group or level;
 * a name the student gave it as typed (`shownSubject`).
 */
export function lessonTaskTitle(lesson: SubjectItem): string {
  return `שיעורי בית ב${shownSubject(lesson)}`;
}
