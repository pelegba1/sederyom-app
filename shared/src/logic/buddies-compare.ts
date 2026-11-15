/**
 * Two students' days, side by side (friends spec §4.6): when each starts and
 * ends, whether they do so together, the windows both are free in, and the
 * lessons they sit in together.
 *
 * Pure: the two lists of lessons for one date in, a description of the day out.
 * Where the lessons come from — the phone's own timetable, the friend's class
 * feed, or the lessons a friend from a school without a Shahaf site put in the
 * box (§4.1) — stays with the caller, and so does turning the result into the
 * "Today" row, the friends list and the friend's screen. Cancellations are
 * dropped here, so the caller can hand over the day as the feed has it.
 *
 * ## How the two days are compared
 *
 *  - `clock` — every lesson on both sides has a start and an end. This is the
 *    usual case. Starts and ends are together when they differ by less than
 *    `TOGETHER_MINUTES`; a window is a gap of at least `WINDOW_MIN_MINUTES`
 *    that neither side has a lesson in, between the later start and the earlier
 *    end.
 *  - `period` — some lesson has no time (Mashov's timetable has none at some
 *    schools), but the two are at one school, so period 4 is the same hour for
 *    both. Starts and ends are together when the first and the last period
 *    agree; a window is a period neither has a lesson in.
 *  - `none` — no times, and two schools: nothing can be compared. Both days are
 *    still described, with the flags false and no windows or lessons together.
 *
 * Further down, in the same spirit, come the other things the screens say about
 * a comparison: the exams two students share (§2.3, §2.4), the lines under the
 * "now" card on Today (§2.2), and the way a few friends' names are listed.
 */
import { DateTime } from 'luxon';
import { BUDDY_EXAM_DAYS, TOGETHER_MINUTES, WINDOW_MIN_MINUTES, type BuddyExam } from '../buddies';
import type { DateStr, LessonStatus, TimeStr } from '../domain';
import { examSubjectKey, parseExamTitle } from './exam-match';
import { subjectsMatch, teachersMatch } from './subjects';
import { addDays, toDateStr } from './time';

/** One lesson of a day being compared. Only what the comparison reads. */
export interface CompareLesson {
  hourIndex: number;
  /** `null` when the school's timetable has no times. */
  start: TimeStr | null;
  end: TimeStr | null;
  subject: string;
  teacher: string | null;
  status: LessonStatus;
}

/** A stretch of the day: in clock times, or in periods (first to last, both included). */
export type Span =
  | { by: 'clock'; from: TimeStr; to: TimeStr }
  | { by: 'period'; from: number; to: number };

/** One student's day: its edges as the times and periods of the lessons that make them. */
export interface SideDay {
  /**
   * By the clock, the earliest start of the day. By period (or when nothing can
   * be compared), the start of the first period: `null` when it has no time,
   * even if a later lesson does.
   */
  start: TimeStr | null;
  /** The latest end of the day; by period, the end of the last period, `null` when it has no time. */
  end: TimeStr | null;
  firstHour: number;
  lastHour: number;
}

export interface DayCompare {
  /** What the comparison rests on; `none` means it could not be made. */
  by: 'clock' | 'period' | 'none';
  /** `null` when there is no lesson that day, or every one of them is cancelled. */
  mine: SideDay | null;
  theirs: SideDay | null;
  startTogether: boolean;
  endTogether: boolean;
  /** In time order. */
  windows: Span[];
  /** In time order. `subject` and `start` are the first student's own. */
  together: { hourIndex: number; start: TimeStr | null; subject: string }[];
}

/**
 * Compares two days. `mine` and `theirs` are one date's lessons for each side,
 * cancelled ones included (they are ignored). `samePeriods` says that the two
 * are at one school, so a period number means the same hour for both; it only
 * matters when some lesson has no time.
 */
export function compareDays(
  mine: readonly CompareLesson[],
  theirs: readonly CompareLesson[],
  opts: { samePeriods: boolean },
): DayCompare {
  const a = mine.filter(held);
  const b = theirs.filter(held);
  const timed = [...a, ...b].every((l) => toMinutes(l.start) !== null && toMinutes(l.end) !== null);
  const by = timed ? 'clock' : opts.samePeriods ? 'period' : 'none';

  const dayA = a.length > 0 ? sideDay(a, by === 'clock') : null;
  const dayB = b.length > 0 ? sideDay(b, by === 'clock') : null;
  const result: DayCompare = {
    by,
    mine: dayA,
    theirs: dayB,
    startTogether: false,
    endTogether: false,
    windows: [],
    together: [],
  };
  if (!dayA || !dayB || by === 'none') return result;

  if (by === 'clock') {
    compareByClock(result, a, b);
  } else {
    compareByPeriod(result, a, b, dayA, dayB);
  }
  return result;
}

/** A cancelled lesson is not a lesson: nobody is in it, and it takes no time. */
function held(lesson: CompareLesson): boolean {
  return lesson.status !== 'cancelled';
}

/** Minutes since midnight, or `null` for a missing or unreadable time. */
function toMinutes(time: TimeStr | null): number | null {
  const m = time === null ? null : /^(\d{1,2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The edges of one side's day. By the clock they are the earliest start and the
 * latest end of any lesson; by period, the times of the first and of the last
 * period (which may have none).
 */
function sideDay(lessons: readonly CompareLesson[], byClock: boolean): SideDay {
  const firstHour = Math.min(...lessons.map((l) => l.hourIndex));
  const lastHour = Math.max(...lessons.map((l) => l.hourIndex));
  const opening = byClock ? lessons : lessons.filter((l) => l.hourIndex === firstHour);
  const closing = byClock ? lessons : lessons.filter((l) => l.hourIndex === lastHour);
  return {
    start: extreme(opening.map((l) => l.start), -1),
    end: extreme(closing.map((l) => l.end), 1),
    firstHour,
    lastHour,
  };
}

/** The earliest (`-1`) or the latest (`1`) of the readable times, as it was written; `null` when none reads. */
function extreme(times: readonly (TimeStr | null)[], direction: 1 | -1): TimeStr | null {
  let best: TimeStr | null = null;
  let bestMinutes = 0;
  for (const time of times) {
    const minutes = toMinutes(time);
    if (time === null || minutes === null) continue;
    if (best === null || (minutes - bestMinutes) * direction > 0) {
      best = time;
      bestMinutes = minutes;
    }
  }
  return best;
}

/** Whether two lessons at the same hour are one lesson the two sit in: same subject, and not different teachers. */
function sameLesson(x: CompareLesson, y: CompareLesson): boolean {
  return subjectsMatch(x.subject, y.subject) && teachersMatch(x.teacher, y.teacher) !== false;
}

/** A lesson with its times, as written and in minutes since midnight. */
interface Slot {
  lesson: CompareLesson;
  start: TimeStr;
  end: TimeStr;
  from: number;
  to: number;
}

/** The lessons whose times read; by the clock that is every one of them. */
function slotsOf(lessons: readonly CompareLesson[]): Slot[] {
  return lessons.flatMap((lesson) => {
    const { start, end } = lesson;
    const from = toMinutes(start);
    const to = toMinutes(end);
    return start === null || end === null || from === null || to === null ? [] : [{ lesson, start, end, from, to }];
  });
}

function compareByClock(
  result: DayCompare,
  lessonsA: readonly CompareLesson[],
  lessonsB: readonly CompareLesson[],
): void {
  const a = slotsOf(lessonsA).sort((x, y) => x.from - y.from || x.lesson.hourIndex - y.lesson.hourIndex);
  const b = slotsOf(lessonsB);
  const startA = Math.min(...a.map((s) => s.from));
  const startB = Math.min(...b.map((s) => s.from));
  const endA = Math.max(...a.map((s) => s.to));
  const endB = Math.max(...b.map((s) => s.to));
  result.startTogether = Math.abs(startA - startB) < TOGETHER_MINUTES;
  result.endTogether = Math.abs(endA - endB) < TOGETHER_MINUTES;

  // The gaps of the union of both days: a break that touches a free lesson is
  // one gap with it, which is why 11:15–12:20 is a window and not two.
  const union = [...a, ...b].sort((x, y) => x.from - y.from);
  const earliest = Math.max(startA, startB);
  const latest = Math.min(endA, endB);
  let reach = union[0]!;
  for (const slot of union.slice(1)) {
    // A gap is made of lesson edges, so it lies wholly inside or wholly outside
    // the stretch both are in school; it cannot straddle an edge of it.
    const gap = slot.from - reach.to;
    if (gap >= WINDOW_MIN_MINUTES && reach.to >= earliest && slot.from <= latest) {
      result.windows.push({ by: 'clock', from: reach.end, to: slot.start });
    }
    if (slot.to > reach.to) reach = slot;
  }

  for (const { lesson, from } of a) {
    if (b.some((other) => Math.abs(from - other.from) < TOGETHER_MINUTES && sameLesson(lesson, other.lesson))) {
      result.together.push({ hourIndex: lesson.hourIndex, start: lesson.start, subject: lesson.subject });
    }
  }
}

function compareByPeriod(
  result: DayCompare,
  a: readonly CompareLesson[],
  b: readonly CompareLesson[],
  dayA: SideDay,
  dayB: SideDay,
): void {
  result.startTogether = dayA.firstHour === dayB.firstHour;
  result.endTogether = dayA.lastHour === dayB.lastHour;

  const busy = new Set([...a, ...b].map((l) => l.hourIndex));
  const last = Math.min(dayA.lastHour, dayB.lastHour);
  let from: number | null = null;
  for (let hour = Math.max(dayA.firstHour, dayB.firstHour); hour <= last + 1; hour++) {
    const free = hour <= last && !busy.has(hour);
    if (free && from === null) from = hour;
    if (!free && from !== null) {
      result.windows.push({ by: 'period', from, to: hour - 1 });
      from = null;
    }
  }

  for (const lesson of [...a].sort((x, y) => x.hourIndex - y.hourIndex)) {
    if (b.some((other) => other.hourIndex === lesson.hourIndex && sameLesson(lesson, other))) {
      result.together.push({ hourIndex: lesson.hourIndex, start: lesson.start, subject: lesson.subject });
    }
  }
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

/**
 * How one exam stands against the other student's:
 *  - `together` — the same subject on the same day (one row for the two);
 *  - `same_subject` — the same subject in the same week, on another day
 *    (a row for each of the two exams, each with the other's date);
 *  - `mine` / `theirs` — an exam only one of the two has.
 */
export type ExamPairing = 'together' | 'same_subject' | 'mine' | 'theirs';

export interface ExamCompareRow {
  date: DateStr;
  /** As the student whose exam this row is calls it; for `together`, mine. */
  title: string;
  who: ExamPairing;
  /** For `same_subject`, the date of the other student's exam of that subject; otherwise `null`. */
  otherDate: DateStr | null;
  /** Whose exam the row is: the first student's (a `together` row is theirs too, as one row) or the other's. */
  owner: 'mine' | 'theirs';
}

/** An exam inside the days being shown, with what the pairing reads. */
interface DatedExam {
  exam: BuddyExam;
  /** What the exam is about: the subject the box carries, or the one the title reads as. */
  subject: string;
  /** The Sunday that starts the exam's week. */
  week: DateStr;
}

/**
 * The Sunday on or before `date`, in `zone`; `null` when `date` is not a real
 * calendar date. luxon's weeks start on Monday (`weekday` 1) and end on Sunday
 * (7), which is not how a school week goes, so the Sunday is found by hand.
 */
function sundayOf(date: DateStr, zone: string): DateStr | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = DateTime.fromISO(date, { zone });
  return day.isValid ? toDateStr(day.minus({ days: day.weekday % 7 })) : null;
}

/**
 * The exams in `[from, from + BUDDY_EXAM_DAYS)`, by date. An exam whose date
 * does not read is not an exam this can place, and is left out: the exams come
 * from a friend's box, which this code does not control.
 */
function examsInReach(exams: readonly BuddyExam[], from: DateStr, zone: string): DatedExam[] {
  const until = addDays(from, BUDDY_EXAM_DAYS, zone);
  const found: DatedExam[] = [];
  for (const exam of exams) {
    if (exam.date < from || exam.date >= until) continue;
    const week = sundayOf(exam.date, zone);
    if (week === null) continue;
    found.push({ exam, subject: exam.subject.trim() || examSubjectKey(exam.title) || blockKey(exam.title), week });
  }
  return found.sort((x, y) => (x.exam.date < y.exam.date ? -1 : x.exam.date > y.exam.date ? 1 : 0));
}

/**
 * A block exam ("מבחן גוש ב'") names a slot, not a subject: each student sits
 * one subject of the block, and the title is the same for both. Two of the
 * same block on one day are one sitting. A block with no letter names none.
 */
function blockKey(title: string): string {
  const { block } = parseExamTitle(title);
  return block ? `גוש ${block}` : '';
}

/**
 * What one exam is to the other student's exams: `together` when one of them is
 * the same subject on the same day; else `same_subject`, with the date of the
 * earliest such exam in its week; else `null`. An exam whose subject (or
 * block, `blockKey`) cannot be read matches nothing.
 */
function pairWith(
  exam: DatedExam,
  others: readonly DatedExam[],
): { who: 'together' | 'same_subject'; otherDate: DateStr | null } | null {
  const same = others.filter((other) => subjectsMatch(exam.subject, other.subject));
  if (same.some((other) => other.exam.date === exam.exam.date)) return { who: 'together', otherDate: null };
  const sameWeek = same.find((other) => other.week === exam.week);
  return sameWeek ? { who: 'same_subject', otherDate: sameWeek.exam.date } : null;
}

/**
 * Two students' exams side by side, for the next `BUDDY_EXAM_DAYS` days from
 * `from` (the day itself in, the day `BUDDY_EXAM_DAYS` later out), by date. An
 * exam's week runs Sunday to Saturday in `zone`. Both lists are limited to
 * those days before they meet, so a partner past the edge is not one.
 */
export function compareExams(
  mine: readonly BuddyExam[],
  theirs: readonly BuddyExam[],
  from: DateStr,
  zone: string,
): ExamCompareRow[] {
  const a = examsInReach(mine, from, zone);
  const b = examsInReach(theirs, from, zone);
  const rows: ExamCompareRow[] = [];
  for (const exam of a) {
    const pair = pairWith(exam, b);
    rows.push({
      date: exam.exam.date,
      title: exam.exam.title,
      who: pair?.who ?? 'mine',
      otherDate: pair?.otherDate ?? null,
      owner: 'mine',
    });
  }
  for (const exam of b) {
    const pair = pairWith(exam, a);
    // Already a row of mine: the two sit it together, and one row says so.
    if (pair?.who === 'together') continue;
    rows.push({
      date: exam.exam.date,
      title: exam.exam.title,
      who: pair?.who ?? 'theirs',
      otherDate: pair?.otherDate ?? null,
      owner: 'theirs',
    });
  }
  // Stable: on one day, mine come before theirs.
  return rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** One of my exams, and the friends who sit the same subject. */
export interface ExamWithBuddies {
  date: DateStr;
  title: string;
  /** Friends with the same subject on the same day, in the order given. */
  together: string[];
  /** Friends with the same subject in the same week, on another day, in the order given. */
  sameSubject: string[];
}

/**
 * My exams in the next `BUDDY_EXAM_DAYS` days that at least one friend shares
 * (the same match as `compareExams`, run against each friend), by date. The
 * ones nobody shares are not listed.
 */
export function examsWithBuddies(
  mine: readonly BuddyExam[],
  buddies: readonly { name: string; exams: readonly BuddyExam[] }[],
  from: DateStr,
  zone: string,
): ExamWithBuddies[] {
  const reach = buddies.map((buddy) => ({ name: buddy.name, exams: examsInReach(buddy.exams, from, zone) }));
  const shared: ExamWithBuddies[] = [];
  for (const exam of examsInReach(mine, from, zone)) {
    const together: string[] = [];
    const sameSubject: string[] = [];
    for (const buddy of reach) {
      const pair = pairWith(exam, buddy.exams);
      if (pair?.who === 'together') together.push(buddy.name);
      else if (pair?.who === 'same_subject') sameSubject.push(buddy.name);
    }
    if (together.length > 0 || sameSubject.length > 0) {
      shared.push({ date: exam.exam.date, title: exam.exam.title, together, sameSubject });
    }
  }
  return shared;
}

// ---------------------------------------------------------------------------
// The lines on Today
// ---------------------------------------------------------------------------

/**
 * A line under the "now" card (spec §2.2): a window both are free in, or the
 * end or the start of the day the names share with me. `at` is a time by the
 * clock, and the first or last period (`hourIndex`) when the days were compared
 * by period; for an end, it is the time or period of MY end. `ids` are the
 * friends' ids, beside `names` one for one: two friends may go by one name,
 * and a tap on the line opens the first of them.
 */
export type TodayBuddyLine =
  | { kind: 'window'; span: Span; names: string[]; ids: string[] }
  | { kind: 'end' | 'start'; at: TimeStr | number; names: string[]; ids: string[] };

/** One friend's day against mine, as `todayBuddyLines` takes it. */
export interface TodayBuddyDay {
  id: string;
  name: string;
  compare: DayCompare;
}

/** How many lines Today gives to friends, at the most. */
const TODAY_BUDDY_LINES = 2;

/**
 * What to say about the friends under today's "now" card. At most two lines, in
 * this order of priority:
 *  1. the earliest window not yet over, with every friend who has that exact
 *     window. A window by the clock is over once `nowTime` reaches its end; a
 *     window by period is never over, for a period cannot be set against a
 *     clock. When friends are compared both ways, the one by the clock comes
 *     first, since only it is known to still be ahead;
 *  2. the friends who end the day with me, at my end;
 *  3. the friends who start the day with me, but only by the clock and only
 *     while `nowTime` is before my start.
 * A friend that could not be compared (`none`), or has no day, or I have none,
 * gives nothing. The end line is not held back once the day is over: whether to
 * ask at all then is the caller's.
 */
export function todayBuddyLines(
  days: readonly TodayBuddyDay[],
  nowTime: TimeStr,
): TodayBuddyLine[] {
  const now = toMinutes(nowTime);
  const comparable = days.filter(({ compare }) => compare.by !== 'none' && compare.mine && compare.theirs);
  const lines: TodayBuddyLine[] = [];

  const coming = comingWindow(comparable, now);
  if (coming) lines.push(coming);

  const end = edgeLine('end', comparable);
  if (end) lines.push(end);

  const start = edgeLine('start', comparable);
  if (start && now !== null && typeof start.at === 'string') {
    const at = toMinutes(start.at);
    if (at !== null && now < at) lines.push(start);
  }
  return lines.slice(0, TODAY_BUDDY_LINES);
}

/** Whether a window is still ahead, or going on, at `now` (minutes). */
function windowNotOver(span: Span, now: number | null): boolean {
  if (span.by === 'period') return true;
  const to = toMinutes(span.to);
  return to === null || now === null || to > now;
}

/** A window's place in the day, for putting windows in order: by the clock before by period, then start, then end. */
function windowRank(span: Span): [number, number, number] {
  return span.by === 'clock'
    ? [0, toMinutes(span.from) ?? Infinity, toMinutes(span.to) ?? Infinity]
    : [1, span.from, span.to];
}

/** Negative when `x` comes before `y` in the day, zero for one and the same window. */
function compareWindows(x: Span, y: Span): number {
  const a = windowRank(x);
  const b = windowRank(y);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The window line: the earliest window not yet over, with every friend who has that exact window. */
function comingWindow(
  days: readonly TodayBuddyDay[],
  now: number | null,
): TodayBuddyLine | null {
  const ahead = days.flatMap(({ compare }) => compare.windows).filter((span) => windowNotOver(span, now));
  if (ahead.length === 0) return null;
  const first = ahead.reduce((best, span) => (compareWindows(span, best) < 0 ? span : best));
  const sharing = days.filter(({ compare }) => compare.windows.some((span) => compareWindows(span, first) === 0));
  return { kind: 'window', span: first, names: sharing.map(({ name }) => name), ids: sharing.map(({ id }) => id) };
}

/**
 * My own edge of the day in one comparison: by the clock my earliest start or
 * latest end, by period my last period. By period there is no start line, so
 * `null` for it, and `null` too where the time is not known.
 */
function myEdge(compare: DayCompare, kind: 'start' | 'end'): TimeStr | number | null {
  const mine = compare.mine;
  if (!mine) return null;
  if (compare.by === 'clock') return kind === 'end' ? mine.end : mine.start;
  if (compare.by === 'period' && kind === 'end') return mine.lastHour;
  return null;
}

/**
 * The "end together" or "start together" line: the friends who share my edge of
 * the day, named at my own. Friends compared by the clock come first, then those
 * compared by period; the line takes the first kind there is, since the edge of
 * one kind cannot be said as the other.
 */
function edgeLine(
  kind: 'start' | 'end',
  days: readonly TodayBuddyDay[],
): Extract<TodayBuddyLine, { kind: 'end' | 'start' }> | null {
  const together = days.filter(({ compare }) => (kind === 'end' ? compare.endTogether : compare.startTogether));
  for (const by of ['clock', 'period'] as const) {
    const group = together.filter(({ compare }) => compare.by === by);
    const at = group.length > 0 ? myEdge(group[0]!.compare, kind) : null;
    if (at === null) continue;
    const sharing = group.filter(({ compare }) => myEdge(compare, kind) === at);
    return { kind, at, names: sharing.map(({ name }) => name), ids: sharing.map(({ id }) => id) };
  }
  return null;
}

/**
 * Names as Hebrew lists them: "נועה", "נועה ויואב", and from three on the first
 * and the count of the rest, "נועה ועוד 2".
 */
export function namesList(names: readonly string[]): string {
  // The "ו" ("and") is a prefix of the last name, not a word of its own.
  if (names.length <= 2) return names.join(' ו');
  return `${names[0]} ועוד ${names.length - 1}`;
}
