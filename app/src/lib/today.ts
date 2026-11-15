/**
 * The pure logic behind "היום שלי" (plans A1, R2): what is on now and what
 * comes next, the day's real span once cancellations are taken out, the
 * day line, what is overdue, runs of cancelled lessons, days without
 * school, and the plain-Hebrew wording of a lesson's status. No React and no
 * clock of its own — callers pass `now` / `today`, so every rule here is
 * tested at a fixed time (app/test/today.test.cjs).
 *
 * Times come back as `Part`s: the screen renders the `ltr` ones through `Ltr`,
 * because a range like "08:00–10:30" inside a Hebrew line would otherwise come
 * out reversed on Android.
 */
import type {
  CalendarEvent, ClassroomWork, DateStr, DayView, HomeworkItem, Lesson, LessonStatus, NextExam, SchoolEvent, Source, SubjectOption, Task, TimelineItem,
} from '@sederyom/shared';
import { isClassroomDone, selectClassroom } from './classroom';
import {
  addDays, countdownLabel, dayDateParts, daysUntil, formatShortDate, isolateRanges, plural, shownSubject, stripGroup, timeOf, toDateStr, weekdayName,
  type SubjectItem,
} from './format';
import { LESSONS_COPY, groupLessonOptions, shortWeekday, type MashovLink } from './school';

/**
 * One run of a line. `ltr` runs (times, ranges) go through `Ltr`; `tone`
 * draws a run stronger (the day's span) or in the cancel colour ("2 באיחור").
 */
export interface Part {
  text: string;
  ltr?: boolean;
  tone?: 'strong' | 'alert';
}

/** The line as plain text — for accessibility labels and tests. */
export function partsText(parts: Part[]): string {
  return parts.map((p) => p.text).join('');
}

/** `HH:mm` → minutes from midnight; `null` when missing or malformed. */
export function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes from midnight → `HH:mm`. */
export function clockOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

const ltr = (text: string): Part => ({ text, ltr: true });

export function lessonsOf(timeline: TimelineItem[]): Lesson[] {
  return timeline.flatMap((i) => (i.kind === 'lesson' ? [i.lesson] : []));
}

/** Lessons with anything other than `regular` — what the changes chip counts and lists. */
export function changedLessons(timeline: TimelineItem[]): Lesson[] {
  return lessonsOf(timeline).filter((l) => l.status !== 'regular');
}

/**
 * Where an event sits on `date`, in minutes from midnight. An event that began
 * the day before starts at 0, one that runs past midnight ends at 1440.
 */
function eventMinutes(iso: string, date: DateStr): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = toDateStr(d);
  if (day < date) return 0;
  if (day > date) return 24 * 60;
  return d.getHours() * 60 + d.getMinutes();
}

/** Something on the day with a start and an end: a lesson that takes place, or a timed event. */
export interface Slot {
  kind: 'lesson' | 'event';
  title: string;
  start: number;
  end: number;
}

/**
 * The day's timed slots, by start time (a lesson before an event that starts
 * with it). Cancelled lessons are not slots — nothing happens in them — and
 * neither are all-day events or anything without a clock time.
 */
export function timedSlots(timeline: TimelineItem[], date: DateStr): Slot[] {
  const slots: Slot[] = [];
  for (const item of timeline) {
    if (item.kind === 'lesson') {
      const { lesson } = item;
      if (lesson.status === 'cancelled') continue;
      const start = minutesOf(lesson.startTime);
      const end = minutesOf(lesson.endTime);
      if (start === null || end === null) continue;
      slots.push({ kind: 'lesson', title: shownSubject(lesson), start, end });
    } else if (item.kind === 'event') {
      const { event } = item;
      if (event.allDay) continue;
      const start = eventMinutes(event.start, date);
      const end = eventMinutes(event.end, date);
      if (start === null || end === null || end <= start || start >= 24 * 60) continue;
      slots.push({ kind: 'event', title: event.summary, start, end });
    }
  }
  return slots.sort((a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'lesson' ? -1 : 1));
}

/** When the first lesson that takes place starts, `HH:mm`; `null` on a day without one. */
export function firstLessonStart(timeline: TimelineItem[]): string | null {
  const starts = lessonsOf(timeline)
    .filter((l) => l.status !== 'cancelled')
    .map((l) => minutesOf(l.startTime))
    .filter((m): m is number => m !== null);
  return starts.length > 0 ? clockOf(Math.min(...starts)) : null;
}

export type NowNextTone = 'now' | 'break' | 'before' | 'done' | 'free';

/** What the card at the top of today says, in two lines. */
export interface NowNext {
  tone: NowNextTone;
  primary: Part[];
  secondary: Part[] | null;
}

/** A gap between lessons longer than this is "זמן פנוי", not a break. */
const BREAK_MAX_MINUTES = 30;

/** What comes next, time first (plan §16.2): "ב־15:15 שיעור פרטי במתמטיקה". */
function nextParts(slot: Slot): Part[] {
  return [{ text: 'ב־' }, ltr(clockOf(slot.start)), { text: ` ${slot.title}` }];
}

/** What the "now" row says once the school day is over (plan §16.2). */
export const SCHOOL_DONE = 'סיימת להיום.';

/**
 * "What now?" for today (F3), in at most two short lines beside the time in
 * the margin (plan §16.2: the time has a column of its own, so the lines do
 * not say "עכשיו"):
 *   - in a lesson:        "פיזיקה עד 09:30" / "ב־09:45 אנגלית"
 *   - between lessons:    "הפסקה" / "ב־09:45 אנגלית"
 *   - before school:      "מתחילים ב־08:00" / "השיעור הראשון: פיזיקה"
 *   - school over, an event to come: "סיימת להיום." / "ב־17:00 חוג"
 *   - after the last one: "סיימת להיום." / "מחר מתחילים ב־08:00"
 * Cancelled lessons never count as now or next, so a day whose last lessons
 * were cancelled ends at the last one that takes place. `nextStart` is the
 * next school day's first lesson (`firstLessonStart`), when known, and
 * `nextWord` names that day: "מחר", or "ביום ראשון" on a Thursday
 * (`nextDayWord`). `null` when there is nothing worth saying.
 */
export function nowNext(
  timeline: TimelineItem[],
  date: DateStr,
  now: Date,
  nextStart: string | null = null,
  nextWord = 'מחר',
): NowNext | null {
  const t = minutesNow(now);
  const slots = timedSlots(timeline, date);
  const lessons = slots.filter((s) => s.kind === 'lesson');
  const schoolStart = lessons.length > 0 ? lessons[0]!.start : null;
  const schoolEnd = lessons.length > 0 ? Math.max(...lessons.map((s) => s.end)) : null;
  const tomorrow: Part[] | null = nextStart ? [{ text: `${nextWord} מתחילים ב־` }, ltr(nextStart)] : null;

  // A lesson wins over an event that overlaps it; `slots` is sorted, so the first match is the earliest.
  const running = slots.filter((s) => s.start <= t && t < s.end);
  const current = running.find((s) => s.kind === 'lesson') ?? running[0] ?? null;
  const next = slots.find((s) => s.start > t) ?? null;

  if (current) {
    const lastLesson = current.kind === 'lesson' && !slots.some((s) => s.kind === 'lesson' && s.start > t);
    return {
      tone: 'now',
      primary: [{ text: `${current.title} עד ` }, ltr(clockOf(current.end))],
      secondary: next ? nextParts(next) : lastLesson ? [{ text: 'זה השיעור האחרון להיום' }] : null,
    };
  }

  if (next) {
    if (schoolStart !== null && t < schoolStart && next.kind === 'lesson') {
      return {
        tone: 'before',
        primary: [{ text: 'מתחילים ב־' }, ltr(clockOf(schoolStart))],
        secondary: [{ text: `השיעור הראשון: ${next.title}` }],
      };
    }
    if (schoolStart !== null && schoolEnd !== null && t >= schoolStart && t < schoolEnd) {
      // Until when is the next line's time: "הפסקה" over "ב־09:45 אנגלית".
      const gap = next.start - t;
      return {
        tone: 'break',
        primary: [{ text: gap > BREAK_MAX_MINUTES ? 'זמן פנוי' : 'הפסקה' }],
        secondary: nextParts(next),
      };
    }
    if (schoolEnd !== null && t >= schoolEnd) {
      return { tone: 'done', primary: [{ text: SCHOOL_DONE }], secondary: nextParts(next) };
    }
    return { tone: 'free', primary: nextParts(next), secondary: null };
  }

  if (lessons.length > 0) return { tone: 'done', primary: [{ text: SCHOOL_DONE }], secondary: tomorrow };
  // Only events today, and they are over: say exactly that, not "done for the day".
  if (slots.length > 0) return { tone: 'free', primary: [{ text: 'אין עוד אירועים היום' }], secondary: tomorrow };
  return tomorrow ? { tone: 'free', primary: tomorrow, secondary: null } : null;
}

/**
 * The next school day in a word, for "… מתחילים ב־08:00": "מחר" when it is
 * tomorrow, else the weekday — "ביום ראשון" on a Thursday (W4-1).
 */
export function nextDayWord(next: DateStr, today: DateStr): string {
  return next === addDays(today, 1) ? 'מחר' : `ב${weekdayName(next)}`;
}

/**
 * The heading of what is due on the next school day: "מחר להגשה", or "ליום
 * ראשון להגשה" (W4-1). With rows from the days without school before it
 * (`carried`: Friday's work under Sunday's heading, each row saying its own
 * day), "להגשה עד יום ראשון", as the day's own list says it (run 8, Noa:
 * Friday's homework under "ליום ראשון להגשה").
 */
export function nextDueTitle(next: DateStr, today: DateStr, carried = false): string {
  if (carried) return dueSectionTitle(next, today, true);
  return next === addDays(today, 1) ? 'מחר להגשה' : `ל${weekdayName(next)} להגשה`;
}

/** The heading of the next school day's study sessions (W6-6): "מחר ללמוד", "ביום ראשון ללמוד". */
export function nextStudyTitle(next: DateStr, today: DateStr): string {
  return `${nextDayWord(next, today)} ללמוד`;
}

/** What tapping the now/next card does, and the word at its end that says so. */
export type NowCardAction =
  | { kind: 'now'; label: string }
  | { kind: 'day'; date: DateStr; label: string };

/**
 * The card at the top of today used to carry a "⌄" that looked like "open"
 * but only scrolled — and did nothing once the page was already there (W5-6,
 * Itai, Maya, Daniel). Now the card says what a tap does:
 *   - while the day is under way (something running or still ahead, once the
 *     first thing has begun): "קפיצה לעכשיו", to the timeline's "now" line —
 *     a bare "לעכשיו" read as a label, not as what a tap does (W6-7, Maya);
 *   - once everything on the day is over: the next school day, "למחר" or
 *     "ליום ראשון" — the evening question, answered by a tap, never by a jump;
 *   - before the day starts, or with nothing to go to: no action.
 * `next` is the next school day, when known.
 */
export function nowCardAction(timeline: TimelineItem[], date: DateStr, now: Date, next: DateStr | null): NowCardAction | null {
  const toNext: NowCardAction | null = next ? { kind: 'day', date: next, label: `ל${next === addDays(date, 1) ? 'מחר' : weekdayName(next)}` } : null;
  const slots = timedSlots(timeline, date);
  if (slots.length === 0) return toNext;
  const t = minutesNow(now);
  if (t < slots[0]!.start) return null;
  if (t < Math.max(...slots.map((s) => s.end))) return { kind: 'now', label: 'קפיצה לעכשיו' };
  return toNext;
}

/**
 * Where the "now" line goes: before the first item that starts later than
 * `now`, or at the end when everything has started. Items without a clock
 * time (all-day events, tasks) never hold it back.
 */
export function nowInsertionIndex(timeline: TimelineItem[], now: Date): number {
  const t = minutesNow(now);
  for (let i = 0; i < timeline.length; i += 1) {
    const start = itemStartMinutes(timeline[i]!);
    if (start !== null && start > t) return i;
  }
  return timeline.length;
}

function itemStartMinutes(item: TimelineItem): number | null {
  if (item.kind === 'lesson') return minutesOf(item.lesson.startTime);
  if (item.kind === 'event') {
    if (item.event.allDay) return null;
    const d = new Date(item.event.start);
    return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
  }
  return null;
}

export interface DaySummary {
  total: number;
  /** Lessons that take place: everything but the cancelled ones. */
  active: number;
  cancelled: number;
  /** First start and last end among the lessons that take place — the real day. */
  start: string | null;
  end: string | null;
}

export function daySummary(timeline: TimelineItem[]): DaySummary {
  const lessons = lessonsOf(timeline);
  const active = lessons.filter((l) => l.status !== 'cancelled');
  const starts = active.map((l) => minutesOf(l.startTime)).filter((m): m is number => m !== null);
  const ends = active.map((l) => minutesOf(l.endTime)).filter((m): m is number => m !== null);
  return {
    total: lessons.length,
    active: active.length,
    cancelled: lessons.length - active.length,
    start: starts.length > 0 ? clockOf(Math.min(...starts)) : null,
    end: ends.length > 0 ? clockOf(Math.max(...ends)) : null,
  };
}

/** The day's lessons in one line, and its real span (`dayLine`). */
export interface DayLine {
  /** "3 שיעורים, 4 בוטלו", "כל השיעורים בוטלו". */
  lessons: string;
  /** "08:00–10:30": the first start to the last end of the lessons that take place; `null` without clock times. */
  span: string | null;
}

/**
 * The day's lessons as one plain line (plan §16.2: a count and what was
 * cancelled, said with a comma, not a chain of "·"): "3 שיעורים, 4 בוטלו",
 * "שיעור אחד, אחד בוטל", "3 שיעורים". Nothing is said about zero.
 *
 * Every lesson cancelled reads "כל השיעורים בוטלו" — unless `hidden`: the
 * student has hidden lessons ("השיעורים שלי", "זה לא השיעור שלי"), and the
 * day view comes without them, so "all" would be a claim about what is left.
 * Maya hid physics and read "כל השיעורים בוטלו" as the school cancelling her
 * whole day (run 5). Then the count says only what is known: "4 שיעורים בוטלו".
 *
 * Inside "3 שיעורים" and "4 בוטלו" the space is non-breaking, so a number
 * never ends one line while its word starts the next (W4, Daniel). `null` on
 * a day without lessons.
 */
export function dayLine(summary: DaySummary, hidden = false): DayLine | null {
  if (summary.total === 0) return null;
  let lessons: string;
  if (summary.active > 0) {
    const gone = summary.cancelled === 0 ? '' : summary.cancelled === 1 ? ', אחד בוטל' : `, ${keepTogether(`${summary.cancelled} בוטלו`)}`;
    lessons = `${keepTogether(plural(summary.active, 'שיעור אחד', 'שיעורים'))}${gone}`;
  } else if (hidden) {
    lessons = keepTogether(summary.total === 1 ? 'שיעור אחד בוטל' : `${summary.total} שיעורים בוטלו`);
  } else {
    lessons = summary.total === 1 ? 'השיעור היחיד בוטל' : 'כל השיעורים בוטלו';
  }
  const span = summary.active > 0 && summary.start && summary.end ? `${summary.start}–${summary.end}` : null;
  return { lessons, span };
}

/**
 * The next day after `after` with a lesson of `lesson`'s subject that takes
 * place, among `days` (the week views the screen has) — the due date for
 * "משימה לשיעור הבא" from a lesson's sheet (W4, Itai: homework is due next
 * lesson). The subject as the site names it wins; failing that anywhere, the
 * same subject without its group or level. `null` when what is known has
 * none. By the source's names on both sides (`originalSubject`), whatever
 * name the student gave it.
 */
export function nextLessonDate(
  lesson: SubjectItem,
  after: DateStr,
  days: readonly { date: DateStr; timeline: TimelineItem[] }[],
): DateStr | null {
  const subject = lesson.originalSubject ?? lesson.subject;
  const later = days.filter((d) => d.date > after).sort((a, b) => a.date.localeCompare(b.date));
  const takesPlace = (d: { timeline: TimelineItem[] }, match: (source: string) => boolean): boolean =>
    lessonsOf(d.timeline).some((l) => l.status !== 'cancelled' && match(l.originalSubject ?? l.subject));
  const exact = later.find((d) => takesPlace(d, (source) => source === subject));
  if (exact) return exact.date;
  const plain = stripGroup(subject);
  return later.find((d) => takesPlace(d, (source) => stripGroup(source) === plain))?.date ?? null;
}

/** How far the page moves down, from where it last turned, before the "+" steps aside. */
export const FAB_SCROLL_SLOP = 8;
/**
 * How far it moves back up before the "+" returns: about a row (Wave 7). At
 * the old 8 the small pull back that settles a section in place brought the
 * "+" back over its last row (Maya, run 6).
 */
export const FAB_RETURN_SLOP = 48;
/** Within this much of the top or the end of the page the "+" always shows. */
const FAB_EDGE = 24;

export interface ScrollSample {
  y: number;
  contentHeight: number;
  viewportHeight: number;
}

/** Whether the "+" shows, and where the page last turned — what a move is measured from. */
export interface FabScroll {
  shown: boolean;
  fromY: number;
}

/**
 * The "+" after the page moved to `s.y` (W5-6, Daniel: mid-page it sat on
 * the end of a card's line — "ליום ראשון להגשה: אנגלית, …" — at 1.0 as at
 * 1.3; no padding at the bottom can help a card in the middle):
 *   - reading down, more than `FAB_SCROLL_SLOP` from where the page last
 *     turned, it steps aside;
 *   - going back up, more than `FAB_RETURN_SLOP`, it returns — a nudge back
 *     to settle a section in place leaves it aside (Wave 7, Maya);
 *   - at the top and at the end of the page it is always there, and the end
 *     has room for it (`listEndClearance`).
 * `fromY` follows the page while it moves the way that keeps the "+" as it
 * is, so a slow drag adds up from the turn.
 */
export function fabAfterScroll(state: FabScroll, s: ScrollSample): FabScroll {
  const y = s.y;
  if (y <= FAB_EDGE || y + s.viewportHeight >= s.contentHeight - FAB_EDGE) return { shown: true, fromY: y };
  const dy = y - state.fromY;
  if (state.shown) {
    if (dy > FAB_SCROLL_SLOP) return { shown: false, fromY: y };
    // Up while shown: measured down from the highest point.
    return dy < 0 ? { shown: true, fromY: y } : state;
  }
  if (dy < -FAB_RETURN_SLOP) return { shown: true, fromY: y };
  // Down while aside: measured up from the lowest point.
  return dy > 0 ? { shown: false, fromY: y } : state;
}

/** U+00A0: a space the line never breaks at. */
export const NBSP = '\u00A0';

function keepTogether(text: string): string {
  return text.replace(/ /g, NBSP);
}

/**
 * A task that is studying, not something to hand in (W6-6, Noa, run 5: "you
 * don't hand in studying"): the study tasks the exam sheet adds ("ללמוד
 * למבחן באנגלית · 20.10 (1/3)", `studyTask` in lib/school.ts), and any task
 * the student titled the same way ("ללמוד פרק 3").
 */
export function isStudyTask(title: string): boolean {
  return /^\s*ללמוד(?:\s|:|$)/.test(title);
}

/**
 * What is still to do on the day (F1): open Google tasks due that day — the
 * day view only carries open ones — plus Mashov homework not yet ticked off.
 * Study tasks are counted apart (`study`, W6-6): `total` is what is handed
 * in — homework and the other tasks — and never includes them.
 */
export function dueCounts(
  timeline: TimelineItem[],
  homework: HomeworkItem[] | null | undefined,
): { tasks: number; homework: number; study: number; total: number } {
  const open = timeline.flatMap((i) => (i.kind === 'task' && !i.task.completed ? [i.task] : []));
  const study = open.filter((t) => isStudyTask(t.title)).length;
  const tasks = open.length - study;
  const hw = (homework ?? []).filter((h) => !h.done).length;
  return { tasks, homework: hw, study, total: tasks + hw };
}

/** What a day of the week strip carries a dot for (W5-6, Daniel: the week and the month have them, the strip did not). */
export interface DayMarks {
  exam: boolean;
  change: boolean;
  due: boolean;
}

/**
 * A day's dots: an exam that day, a change in its timetable (a cancellation
 * included), something open to hand in. A study session is not handed in
 * (W6-6, Noa), so alone it puts no dot — the legend and a screen reader say
 * "להגשה", as the week grid's legend does.
 */
export function dayMarks(day: Pick<DayView, 'examsToday' | 'changeCount' | 'timeline' | 'homework'>): DayMarks {
  return { exam: day.examsToday.length > 0, change: day.changeCount > 0, due: dueCounts(day.timeline, day.homework).total > 0 };
}

/** One kind of dot in the week strip's legend (W6-6, Daniel: only the screen reader knew what they meant). */
export type MarkKind = keyof DayMarks;

/** The legend's words, in the order the dots are drawn. */
export const MARK_WORDS: Readonly<Record<MarkKind, string>> = { exam: 'מבחן', change: 'שינוי במערכת', due: 'להגשה' };

/**
 * The kinds of dot that show on any of `dates` — what the legend under the
 * strip explains, so it names only what is on screen. Empty without any.
 */
export function legendKinds(marks: Readonly<Record<string, DayMarks>> | undefined, dates: readonly DateStr[]): MarkKind[] {
  const kinds: MarkKind[] = ['exam', 'change', 'due'];
  return kinds.filter((k) => dates.some((d) => marks?.[d]?.[k] === true));
}

/** The dots in words, for the day's button: "מבחן, שינויים במערכת, יש להגשה"; `''` without any. */
export function marksLabel(marks: DayMarks): string {
  return [marks.exam ? 'מבחן' : null, marks.change ? 'שינויים במערכת' : null, marks.due ? 'יש להגשה' : null].filter(Boolean).join(', ');
}

/** How far back "באיחור" on today reaches — the same two weeks the school screen keeps loud. */
export const OVERDUE_WINDOW_DAYS = 14;

/** One row of today's "באיחור" section. */
export type OverdueItem =
  | { kind: 'homework'; due: DateStr; homework: HomeworkItem }
  | { kind: 'classroom'; due: DateStr; work: ClassroomWork }
  | { kind: 'task'; due: DateStr; task: Task };

const OVERDUE_KIND_ORDER: Record<OverdueItem['kind'], number> = { homework: 0, classroom: 1, task: 2 };

/**
 * Today's "באיחור" (R-7): Mashov homework not ticked off and Google tasks not
 * completed, due before today and no more than `OVERDUE_WINDOW_DAYS` ago
 * (today − 14 still counts). Homework that already lives on as a task is left
 * out — the task stands for it — unless that task is gone (deleted, or the
 * "ביטול" after "הוסף למשימות שלי"): `tasks` is every task the app knows,
 * and when it is unknown (`null`) the link is trusted.
 *
 * Classroom work too (run 7, Itai and Noa: the task list said "2 באיחור" and
 * Today said one): not handed in, not marked "עשיתי" here (`classroomDone`),
 * due before today — picked by the task list's own rule (`selectClassroom`
 * under "באיחור", lib/classroom.ts), so both screens count the same work.
 *
 * Oldest first; on the same day homework, then Classroom, then tasks.
 */
export function overdueItems(
  homework: readonly HomeworkItem[] | null | undefined,
  tasks: readonly Task[] | null | undefined,
  today: DateStr,
  classroom: { work?: readonly ClassroomWork[] | null; done?: ReadonlySet<string> } = {},
): OverdueItem[] {
  const cutoff = addDays(today, -OVERDUE_WINDOW_DAYS);
  const inWindow = (due: DateStr | null): due is DateStr => due !== null && due >= cutoff && due < today;
  const taskIds = tasks ? new Set(tasks.map((t) => t.id)) : null;
  const linked = (h: HomeworkItem): boolean => h.linkedTaskId !== null && (taskIds === null || taskIds.has(h.linkedTaskId));

  const items: OverdueItem[] = [];
  for (const h of homework ?? []) {
    if (!h.done && !linked(h) && inWindow(h.dueDate)) items.push({ kind: 'homework', due: h.dueDate, homework: h });
  }
  const late = selectClassroom(classroom.work ?? [], { today, filter: 'overdue', search: '', done: classroom.done ?? new Set() });
  for (const w of late) if (w.dueDate) items.push({ kind: 'classroom', due: w.dueDate, work: w });
  for (const t of tasks ?? []) {
    if (!t.completed && inWindow(t.due)) items.push({ kind: 'task', due: t.due, task: t });
  }
  const name = (i: OverdueItem): string => (i.kind === 'homework' ? i.homework.subject : i.kind === 'task' ? i.task.title : i.work.title);
  return items.sort((a, b) => a.due.localeCompare(b.due)
    || OVERDUE_KIND_ORDER[a.kind] - OVERDUE_KIND_ORDER[b.kind]
    || name(a).localeCompare(name(b), 'he'));
}

/**
 * What the timeline draws:
 *   - `item`: an item as it is. `slim` marks a calendar event on a school day
 *     that falls in school hours (or lasts all day): drawn as one quiet line,
 *     so the lessons stay what the eye finds first (W4, Itai).
 *   - `lessons`: lessons in a row of the same subject and status, one card
 *     ("1–3 פיזיקה").
 *   - `cancelledRun`: a run of cancelled lessons folded into one row (R-9).
 */
export type DayEntry =
  | {
    kind: 'item'; item: TimelineItem; slim?: boolean;
    /**
     * The key of the folded cancelled run this item belongs with: an event
     * that fell between its lessons (drawn after the folded row), or, once
     * the run is opened (`expandRuns`), one of its lessons.
     */
    run?: string;
  }
  | { kind: 'lessons'; key: string; lessons: Lesson[] }
  | {
    kind: 'cancelledRun'; key: string; lessons: Lesson[];
    /** The whole line, for a screen reader: "שיעורים 4–7 בוטלו · חופשי מ־10:30" (`cancelledRunLabel`). */
    label: Part[];
    /** What the gap means, drawn under the struck periods: "חופשי מ־10:30" (`cancelledRunFree`). */
    free: Part[] | null;
    /** Its lessons as the day's timeline items, for when it is opened (`expandRuns`). */
    items: TimelineItem[];
  };

/** Cancelled lessons in a row fold into one line from this many on; a lone one stays a full card. */
export const CANCELLED_RUN_MIN = 2;

type LessonItem = Extract<TimelineItem, { kind: 'lesson' }>;

/**
 * Lessons that read as one: the same subject, status, teacher, substitute,
 * note and room. The subject by the source's name: two lines the student
 * gave one name are still two.
 */
function blockKey(lesson: Lesson): string {
  return [lesson.originalSubject ?? lesson.subject, lesson.status, lesson.teacher, lesson.substitute, lesson.note, lesson.room].join('|');
}

/**
 * The day's items (tasks aside) as the timeline draws them:
 *   - cancelled lessons in a row, `CANCELLED_RUN_MIN` or more, fold into one
 *     `cancelledRun` (R-9);
 *   - lessons that take place in consecutive periods with the same subject and
 *     status (`blockKey`) become one `lessons` card;
 *   - a calendar event between the lessons of a run or a block does not break
 *     it (W4-12b): it is drawn right after the folded row, at its own time. A
 *     lesson that does not belong — one that takes place amid cancelled ones,
 *     another subject — does break it.
 * Events on a school day in school hours, and all-day ones, are `slim`.
 *
 * `lessonsApart` (the setting under "מראה", testers 2026-11-07): no `lessons`
 * card, each period a row of its own. A cancelled run still folds; it opens
 * with a tap.
 */
export function dayEntries(items: TimelineItem[], date: DateStr, opts: { lessonsApart?: boolean } = {}): DayEntry[] {
  const active = lessonsOf(items).filter((l) => l.status !== 'cancelled');
  const span = schoolSpan(active);
  const entries: DayEntry[] = [];
  const asItem = (item: TimelineItem): Extract<DayEntry, { kind: 'item' }> => ({ kind: 'item', item, slim: isSlimEvent(item, date, span) });

  /** The run or block being built: its lessons, and everything met since it began, in order. */
  let group: { cancelled: boolean; lessons: LessonItem[]; seen: TimelineItem[] } | null = null;
  const flush = (): void => {
    if (!group) return;
    const lessons = group.lessons.map((i) => i.lesson);
    const folded = group.cancelled ? lessons.length >= CANCELLED_RUN_MIN : lessons.length >= 2;
    if (!folded) {
      for (const item of group.seen) entries.push(asItem(item));
    } else {
      const first = lessons[0]!;
      const last = lessons[lessons.length - 1]!;
      const key = `${group.cancelled ? 'run' : 'block'}-${first.hourIndex}-${last.hourIndex}`;
      entries.push(group.cancelled
        ? {
          kind: 'cancelledRun', key, lessons, items: group.lessons,
          label: cancelledRunLabel(lessons, active), free: cancelledRunFree(lessons, active),
        }
        : { kind: 'lessons', key, lessons });
      // What sat between the lessons follows the folded row; a run's, marked as its own (`expandRuns`).
      for (const item of group.seen) {
        if (item.kind !== 'lesson') entries.push(group.cancelled ? { ...asItem(item), run: key } : asItem(item));
      }
    }
    group = null;
  };
  const joins = (lesson: Lesson): boolean => {
    if (!group) return false;
    if (group.cancelled) return lesson.status === 'cancelled';
    if (opts.lessonsApart) return false;
    const last = group.lessons[group.lessons.length - 1]!.lesson;
    return lesson.status !== 'cancelled' && blockKey(lesson) === blockKey(last) && lesson.hourIndex === last.hourIndex + 1;
  };

  for (const item of items) {
    if (item.kind === 'lesson') {
      if (!joins(item.lesson)) {
        flush();
        group = { cancelled: item.lesson.status === 'cancelled', lessons: [], seen: [] };
      }
      group!.lessons.push(item);
      group!.seen.push(item);
    } else if (item.kind === 'event' && group) {
      group.seen.push(item);
    } else {
      flush();
      entries.push(asItem(item));
    }
  }
  flush();
  return entries;
}

/**
 * The timeline with the cancelled runs in `open` (by their keys) opened: the
 * run's row stays, and under it its lessons and the events that fell between
 * them, in the order of the clock (run 8: "שיעורים 4–7 בוטלו" opened listed
 * 10:30, 11:30, 12:15, 13:25 and only then "13:00 ישיבת מועצת תלמידים").
 * Each lesson stays a row of its own that opens its details. A closed run is
 * left as `dayEntries` gave it: the row, then its events.
 */
export function expandRuns(entries: readonly DayEntry[], open: ReadonlySet<string>): DayEntry[] {
  const out: DayEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    out.push(entry);
    if (entry.kind !== 'cancelledRun' || !open.has(entry.key)) continue;
    const between: DayEntry[] = [];
    while (i + 1 < entries.length) {
      const next = entries[i + 1]!;
      if (next.kind !== 'item' || next.run !== entry.key) break;
      between.push(next);
      i += 1;
    }
    const lessons: DayEntry[] = entry.items.map((item) => ({ kind: 'item', item, run: entry.key }));
    out.push(...byClock(lessons, between));
  }
  return out;
}

/**
 * `lessons` (in period order) with `events` (in their own order) set among
 * them by start time: an event goes before the first lesson that starts after
 * it. The lessons keep their order whatever their times; an event without a
 * time stays after the ones before it.
 */
function byClock(lessons: readonly DayEntry[], events: readonly DayEntry[]): DayEntry[] {
  const out: DayEntry[] = [];
  let e = 0;
  for (const lesson of lessons) {
    const starts = entryStartMinutes(lesson);
    while (starts !== null && e < events.length) {
      const at = entryStartMinutes(events[e]!);
      if (at === null || at >= starts) break;
      out.push(events[e]!);
      e += 1;
    }
    out.push(lesson);
  }
  out.push(...events.slice(e));
  return out;
}

/** First start and last end of the lessons that take place, in minutes; `null` without clock times. */
function schoolSpan(active: Lesson[]): { start: number; end: number } | null {
  const starts = active.map((l) => minutesOf(l.startTime)).filter((m): m is number => m !== null);
  const ends = active.map((l) => minutesOf(l.endTime)).filter((m): m is number => m !== null);
  return starts.length > 0 && ends.length > 0 ? { start: Math.min(...starts), end: Math.max(...ends) } : null;
}

function isSlimEvent(item: TimelineItem, date: DateStr, span: { start: number; end: number } | null): boolean {
  if (item.kind !== 'event' || !span) return false;
  if (item.event.allDay) return true;
  const start = eventMinutes(item.event.start, date);
  const end = eventMinutes(item.event.end, date);
  return start !== null && end !== null && start < span.end && end > span.start;
}

/** "1–3" for a block of periods, "4" for one. */
export function periodsLabel(lessons: Lesson[]): string {
  const hours = lessons.map((l) => l.hourIndex);
  const first = Math.min(...hours);
  const last = Math.max(...hours);
  return first === last ? String(first) : `${first}–${last}`;
}

/**
 * A lesson card's period, said as one (W6-7, Maya: a bare "1–3" beside the
 * subject looked like a grade or a date): "שיעורים 1–3", "שיעור 4". The
 * number runs through `Ltr`.
 */
export function periodsParts(lessons: Lesson[]): Part[] {
  const label = periodsLabel(lessons);
  return [{ text: label.includes('–') ? 'שיעורים ' : 'שיעור ' }, ltr(label)];
}

/**
 * "רק בית ספר" (W6-6, Itai): the day's calendar events folded into one row,
 * "3 אירועים ביומן" — the row adds what a tap does ("להציג").
 */
export function calendarFoldLabel(count: number): string {
  return plural(count, 'אירוע אחד ביומן', 'אירועים ביומן');
}

/** "08:00–10:30": the first start to the last end; `null` when either is unknown. */
export function blockTimeLabel(lessons: Lesson[]): string | null {
  const start = lessons[0]?.startTime ?? null;
  const end = lessons[lessons.length - 1]?.endTime ?? null;
  return start && end ? `${start}–${end}` : null;
}

/**
 * The periods of a run of cancelled lessons: "שיעורים 4–7", "שיעור 4".
 * Periods that do not follow each other (a free period between) are listed:
 * "שיעורים 4, 6". The numbers run through `Ltr`.
 */
export function cancelledRunPeriods(run: Lesson[]): Part[] {
  const hours = [...new Set(run.map((l) => l.hourIndex))].sort((a, b) => a - b);
  const contiguous = hours.every((h, i) => i === 0 || h === hours[i - 1]! + 1);
  return hours.length === 1
    ? [{ text: 'שיעור ' }, ltr(String(hours[0]))]
    : [{ text: 'שיעורים ' }, ltr(contiguous ? `${hours[0]}–${hours[hours.length - 1]}` : hours.join(', '))];
}

/**
 * What the gap a run of cancelled lessons leaves means:
 *   - after the last lesson that takes place: "חופשי מ־10:30" (when it ended);
 *   - before the first one: "מתחילים ב־10:45";
 *   - between two: "חופשי 10:30–12:30";
 *   - nothing takes place, the times are unknown, or a lesson that takes place
 *     overlaps the run: `null`.
 */
export function cancelledRunFree(run: Lesson[], active: Lesson[]): Part[] | null {
  const starts = run.map((l) => minutesOf(l.startTime));
  const ends = run.map((l) => minutesOf(l.endTime));
  if (starts.some((m) => m === null) || ends.some((m) => m === null)) return null;
  const runStart = Math.min(...(starts as number[]));
  const runEnd = Math.max(...(ends as number[]));

  const timed = active.flatMap((l) => {
    const start = minutesOf(l.startTime);
    const end = minutesOf(l.endTime);
    return start === null || end === null ? [] : [{ start, end }];
  });
  if (timed.some((l) => l.start < runEnd && l.end > runStart)) return null;
  const before = timed.filter((l) => l.end <= runStart).map((l) => l.end);
  const after = timed.filter((l) => l.start >= runEnd).map((l) => l.start);
  const prevEnd = before.length > 0 ? clockOf(Math.max(...before)) : null;
  const nextStart = after.length > 0 ? clockOf(Math.min(...after)) : null;
  if (prevEnd && nextStart) return [{ text: 'חופשי ' }, ltr(`${prevEnd}–${nextStart}`)];
  if (prevEnd) return [{ text: 'חופשי מ־' }, ltr(prevEnd)];
  if (nextStart) return [{ text: 'מתחילים ב־' }, ltr(nextStart)];
  return null;
}

/**
 * "שיעורים 4–7 בוטלו, חופשי מ־10:30" — the periods (`cancelledRunPeriods`),
 * and what the gap means (`cancelledRunFree`), as one line for a screen
 * reader. The row draws the two apart: the periods struck through, the gap
 * under them.
 */
export function cancelledRunLabel(run: Lesson[], active: Lesson[]): Part[] {
  const periods = cancelledRunPeriods(run);
  const single = new Set(run.map((l) => l.hourIndex)).size === 1;
  const free = cancelledRunFree(run, active);
  return [...periods, { text: single ? ' בוטל' : ' בוטלו' }, ...(free ? [{ text: ', ' }, ...free] : [])];
}

function entryStartMinutes(entry: DayEntry): number | null {
  if (entry.kind === 'item') return itemStartMinutes(entry.item);
  const starts = entry.lessons.map((l) => minutesOf(l.startTime)).filter((m): m is number => m !== null);
  return starts.length > 0 ? Math.min(...starts) : null;
}

function entryEndMinutes(entry: DayEntry, date: DateStr): number | null {
  if (entry.kind === 'item') {
    const { item } = entry;
    if (item.kind === 'lesson') return minutesOf(item.lesson.endTime);
    if (item.kind === 'event') return item.event.allDay ? 24 * 60 : eventMinutes(item.event.end, date);
    return null;
  }
  const ends = entry.lessons.map((l) => minutesOf(l.endTime));
  return ends.some((m) => m === null) ? null : Math.max(...(ends as number[]));
}

/**
 * Whether an entry is over at `now` on `date` (W4-8): it has ended — the last
 * lesson of a block or a run, an event's end. Anything without an end time
 * (a task, an untimed lesson) is never over; an all-day event lasts the day.
 */
export function entryIsPast(entry: DayEntry, date: DateStr, now: Date): boolean {
  const end = entryEndMinutes(entry, date);
  return end !== null && end <= minutesNow(now);
}

/**
 * `nowInsertionIndex` over the folded timeline: a run of cancelled lessons
 * (or a block of lessons) counts from its first start, so "now" goes before
 * the row until it begins and after it from then on — never inside it.
 */
export function nowEntryIndex(entries: DayEntry[], now: Date): number {
  const t = minutesNow(now);
  for (let i = 0; i < entries.length; i += 1) {
    const start = entryStartMinutes(entries[i]!);
    if (start !== null && start > t) return i;
  }
  return entries.length;
}

/**
 * School events that take the whole day (W5-3): a trip, a tour, a sports day,
 * a "יום שיא", gadna, a journey. Matched as a word in the title — with the
 * prefixes Hebrew glues on ("הטיול", "למסע") — so "מסעדה" is not a journey.
 */
const FULL_DAY_WORDS = /(?:^|[^א-ת])[ובלהמשכ]{0,2}(?:טיול(?:ים)?|סיור(?:ים)?|יום ה?ספורט|יום ה?שיא|גדנ"?ע|מסע)(?![א-ת])/;
/** A title about the day, not the day itself: "אסיפת הורים לקראת הטיול". */
const ABOUT_THE_DAY = /לקראת|הכנה|אסיפ|תדריך|הרשמ|תשלום|טופס|אישור/;
/** A range of periods ("שיעורים 1–4", "שעות 1-3"): part of the day, always. Not a date range ("12.10–14.10"). */
const PERIOD_RANGE = /(?:שיעור(?:ים)?|שעות)\s*\d{1,2}\s*[-–—]\s*\d{1,2}(?![\d.:])/;
/** A clock range, "08:00–12:00"; its end is groups 3–4. Not a date range ("12.10–14.10", a trip of three days). */
const CLOCK_RANGE = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;
/** An end time, "עד 12:00" / "עד השעה 12:00" / "חזרה עד 18:00". */
const UNTIL = /עד\s+(?:ה?שעה\s+)?(\d{1,2}):(\d{2})/g;
/** An event that ends this close to the end of school still takes the day. */
const DAY_END_SLACK = 30;

/**
 * Whether a school event takes the whole day (W5-3, from the owner's own
 * phone):
 *   - a word for such a day in its title, and the title not about it (a
 *     meeting before the trip, "תשלום עבור הטיול");
 *   - no range of periods ("שיעורים 1–4");
 *   - no time, in the title or the details, that ends the event while school
 *     is still on. With `schoolEnd` (minutes, the day's last lesson) a clock
 *     range or an "עד" time counts only when it ends more than half an hour
 *     before it: "08:00–12:00" on a day to 14:00 is part of it, "יציאה
 *     07:30, חזרה עד 18:00" is the whole day. Without it, any clock range
 *     counts — the spec's own rule — and an "עד" alone does not.
 * A departure time ("יציאה ב־07:30") never counts.
 */
export function isFullDayEvent(event: Pick<SchoolEvent, 'title' | 'details'>, schoolEnd: number | null = null): boolean {
  const title = event.title.replace(/[״"]/g, '"').replace(/\s+/g, ' ');
  if (!FULL_DAY_WORDS.test(title) || ABOUT_THE_DAY.test(title)) return false;
  const text = `${title} ${event.details ?? ''}`;
  if (PERIOD_RANGE.test(text)) return false;
  const minutes = (h: string | undefined, m: string | undefined): number => Number(h) * 60 + Number(m);
  const rangeEnds = [...text.matchAll(CLOCK_RANGE)].map((r) => minutes(r[3], r[4]));
  if (schoolEnd === null) return rangeEnds.length === 0;
  const untilEnds = [...text.matchAll(UNTIL)].map((r) => minutes(r[1], r[2]));
  return [...rangeEnds, ...untilEnds].every((end) => end >= schoolEnd - DAY_END_SLACK);
}

/**
 * The school event that takes over a school day (W5-3): the timeline folds its
 * lessons into one row under a card named by it. Only on a school day with
 * lessons on it — a trip on a Friday changes nothing to fold. The day's end
 * is read from every lesson, the cancelled ones too: the trip is often why
 * they were cancelled. `null` on any other day.
 */
export function fullDayEvent(day: Pick<DayView, 'isSchoolDay' | 'events' | 'timeline'>): SchoolEvent | null {
  const lessons = lessonsOf(day.timeline);
  if (!day.isSchoolDay || lessons.length === 0) return null;
  const end = schoolSpan(lessons)?.end ?? null;
  return day.events.find((e) => isFullDayEvent(e, end)) ?? null;
}

/** The folded row under the event's card: "לפי המערכת: 7 שיעורים". */
export function foldedLessonsLabel(count: number): string {
  return `לפי המערכת: ${plural(count, 'שיעור אחד', 'שיעורים')}`;
}

/** The card at the top of today on such a day: the event, not "עכשיו: פיזיקה" from a timetable that is not kept. */
export function fullDayNowNext(event: Pick<SchoolEvent, 'title'>): NowNext {
  return { tone: 'now', primary: [{ text: event.title }], secondary: null };
}

/** What a day without school says (R-10): "אין לימודים ביום שישי", or the holiday's name over "אין לימודים". */
export interface NoSchool {
  title: string;
  detail: string | null;
}

function isFriday(date: DateStr): boolean {
  return new Date(`${date}T12:00:00`).getDay() === 5;
}

/**
 * Whether `day` is a day without school, and how to say it. The server calls
 * every Friday a school day, so a Friday with no lessons on it is one too.
 * Shabbat and the "חופש" switch say the weekday; a holiday says its name.
 * `null` on a school day.
 */
export function noSchoolDay(day: Pick<DayView, 'date' | 'isSchoolDay' | 'holidayName'>, lessonCount: number): NoSchool | null {
  if (day.isSchoolDay && !(isFriday(day.date) && lessonCount === 0)) return null;
  const name = day.holidayName?.trim() || null;
  if (!day.isSchoolDay && name && name !== 'שבת' && name !== 'חופש') return { title: name, detail: 'אין לימודים' };
  return { title: `אין לימודים ב${weekdayName(day.date)}`, detail: null };
}

/** A day the server has already described — enough to tell whether it is a school day. */
export interface KnownDay {
  date: DateStr;
  isSchoolDay: boolean;
  /** Lessons on the day, cancelled ones included. */
  lessons: number;
  /** The holiday's name, when there is one — for `landingNote`. */
  holidayName?: string | null;
}

/** A day view, or a day of a week view, as a `KnownDay`. */
export function knownDay(day: Pick<DayView, 'date' | 'isSchoolDay' | 'holidayName' | 'timeline'>): KnownDay {
  return { date: day.date, isSchoolDay: day.isSchoolDay, lessons: lessonsOf(day.timeline).length, holidayName: day.holidayName };
}

/**
 * "ליום הלימודים הבא": the first day after `from` that `known` (the week
 * views around it) shows as a school day by the same rule as `noSchoolDay`.
 * Only what the server described counts — a day it has not, such as the
 * summer beyond the fetched weeks, is never guessed — so `null` means there
 * is no button to show.
 */
export function nextSchoolDay(from: DateStr, known: readonly KnownDay[]): DateStr | null {
  const days = known.filter((d) => d.date > from && noSchoolDay({ ...d, holidayName: null }, d.lessons) === null);
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days[0]?.date ?? null;
}

/**
 * Where "היום שלי" lands when it opens on today — from the tab, a tap on the
 * tab, past midnight (W5-2, Itai: "מחר" led to a Friday without school, and
 * then one more tap):
 *   - today is a school day: today, evening included — jumping away from a
 *     day that was would have Noa and Daniel asking where it went;
 *   - today has no school (Friday, Shabbat, a holiday): the next school day;
 *   - `null` while that is not known yet: wait. Once the weeks have `settled`
 *     (loaded, or failed) and still nothing is known, today.
 * A push's `date`, and any day picked by hand ("היום" included), never land.
 */
export function landingDate(today: DateStr, known: readonly KnownDay[], settled: boolean): DateStr | null {
  const self = known.find((d) => d.date === today);
  if (!self) return settled ? today : null;
  if (noSchoolDay({ ...self, holidayName: null }, self.lessons) === null) return today;
  const next = nextSchoolDay(today, known);
  if (next) return next;
  return settled ? today : null;
}

/**
 * The line over a day the screen landed on instead of today (W5-2): why it is
 * not today — "היום אין לימודים, אז עברנו ליום ראשון", or with the holiday's
 * name — beside a way back ("להיום").
 */
export function landingNote(today: DateStr, shown: DateStr, holidayName: string | null): string {
  const name = holidayName?.trim() || null;
  const why = name && name !== 'שבת' && name !== 'חופש' ? `היום ${name} ואין לימודים` : 'היום אין לימודים';
  return `${why}, אז עברנו ל${shown === addDays(today, 1) ? 'מחר' : weekdayName(shown)}`;
}

/** The day stepper's second button (W5-2): the day, its word, and what a screen reader says. */
export interface NextShortcut {
  date: DateStr;
  label: string;
  a11y: string;
}

/**
 * The stepper's "next" button: the next school day after today, named — "מחר",
 * or "ראשון 11.10" on a Thursday. The date is always there (W6-7): a bare "יום
 * ראשון" beside "היום" read as last Sunday (Maya), and clashed with the title
 * on another Sunday, where it stayed unselected (Daniel). "יום הלימודים הבא
 * · 11.10" does not fit the button at 360dp, so those words are what a screen
 * reader says. The arrows still step one day at a time. While the days ahead
 * are unknown it is tomorrow, as it always was.
 */
export function nextShortcut(today: DateStr, known: readonly KnownDay[]): NextShortcut {
  const tomorrow = addDays(today, 1);
  const next = nextSchoolDay(today, known) ?? tomorrow;
  const dated = `${weekdayName(next)} ${formatShortDate(next)}`;
  if (next === tomorrow) return { date: next, label: 'מחר', a11y: `מחר, ${dated}` };
  return { date: next, label: `${weekdayName(next).replace(/^יום /, '')} ${formatShortDate(next)}`, a11y: `יום הלימודים הבא, ${dated}` };
}

/**
 * When a homework item is due, for its row and its sheet: "להגשה היום",
 * "להגשה מחר", "להגשה עד יום חמישי 15.10", or — past it — "להגשה ב־6.10 ·
 * באיחור" (the date through `Ltr`; "באיחור" only while it is still open).
 *
 * `underLate`: the row sits under the "באיחור" heading already, so the word
 * is not said twice (run 5, Daniel) — how long ago it was due says something
 * new instead: "להגשה אתמול", "להגשה ב־6.10, לפני יומיים".
 */
export function homeworkDueParts(item: Pick<HomeworkItem, 'dueDate' | 'done'>, today: DateStr, underLate = false): Part[] {
  const due = item.dueDate;
  if (!due) return [{ text: 'בלי תאריך הגשה' }];
  if (due === today) return [{ text: 'להגשה היום' }];
  if (due === addDays(today, 1)) return [{ text: 'להגשה מחר' }];
  const [, m, d] = due.split('-');
  const short = `${Number(d)}.${Number(m)}`;
  if (due < today) {
    if (underLate) {
      const days = daysUntil(due, new Date(`${today}T12:00:00`));
      if (days === -1) return [{ text: 'להגשה אתמול', tone: 'alert' }];
      return [{ text: 'להגשה ב־' }, ltr(short), { text: `, ${countdownLabel(days)}`, tone: 'alert' }];
    }
    const parts: Part[] = [{ text: 'להגשה ב־' }, ltr(short)];
    if (!item.done) parts.push({ text: ', באיחור', tone: 'alert' });
    return parts;
  }
  return [{ text: `להגשה עד ${weekdayName(due)} ` }, ltr(short)];
}

/**
 * "להגשה היום" / "להגשה מחר" / "להגשה ביום הזה". With rows from the days
 * without school before it (`carried`, Wave 7): "להגשה עד יום ראשון", each row
 * then saying its own day.
 */
export function dueSectionTitle(date: DateStr, today: DateStr, carried = false): string {
  if (carried) return `להגשה עד ${date === addDays(today, 1) ? 'מחר' : weekdayName(date)}`;
  if (date === today) return 'להגשה היום';
  if (date === addDays(today, 1)) return 'להגשה מחר';
  return 'להגשה ביום הזה';
}

/**
 * "ללמוד היום" / "ללמוד מחר" / "ללמוד ביום הזה": the study tasks' own section,
 * apart from what is handed in (W6-6); "ללמוד עד יום ראשון" with carried ones.
 */
export function studySectionTitle(date: DateStr, today: DateStr, carried = false): string {
  if (carried) return `ללמוד עד ${date === addDays(today, 1) ? 'מחר' : weekdayName(date)}`;
  if (date === today) return 'ללמוד היום';
  if (date === addDays(today, 1)) return 'ללמוד מחר';
  return 'ללמוד ביום הזה';
}

/**
 * What tomorrow's "מחר להגשה: …" line names: each open homework's subject
 * (once) and each open task's title, homework first. Study tasks are not
 * handed in, and have a line of their own (`studyNames`, W6-6).
 */
export function dueNames(timeline: TimelineItem[], homework: HomeworkItem[] | null | undefined): string[] {
  const names: string[] = [];
  for (const h of homework ?? []) {
    const name = shownSubject(h);
    if (!h.done && !names.includes(name)) names.push(name);
  }
  for (const i of timeline) if (i.kind === 'task' && !i.task.completed && !isStudyTask(i.task.title)) names.push(i.task.title);
  return names;
}

/**
 * The study tasks of the next school day, for its "ללמוד: …" line (W6-6,
 * Noa): each open one, without the "ללמוד" the line already says —
 * "ללמוד למבחן באנגלית · 20.10 (1/3)" is "מבחן באנגלית · 20.10 (1/3)".
 */
export function studyNames(timeline: TimelineItem[]): string[] {
  return timeline.flatMap((i) => (i.kind === 'task' && !i.task.completed && isStudyTask(i.task.title) ? [studyName(i.task.title)] : []));
}

/** A study task's title without the "ללמוד" its line already says. */
function studyName(title: string): string {
  return title.replace(/^\s*ללמוד[\s:]*/, '').replace(/^ל(?=מבחן|בוחן|בגרות|מתכונת)/, '').trim() || title;
}

// ── What waits for the next school day, and Classroom work (Wave 7) ─────────

/** Due dates from `from` up to, but not including, `to`. */
export interface DueRange {
  from: DateStr;
  to: DateStr;
}

/**
 * The days whose work waits for the next school day (Wave 7, Itai, run 6: a
 * task for "מחר", a Friday, showed nowhere on "היום שלי" — the next day's
 * list jumped to Sunday). What is due on a day without school between today
 * and the next school day (`next`) joins that day's list:
 *   - on today, the line "ליום ראשון להגשה" takes what is due after today
 *     and before Sunday — Friday's and Saturday's. Today's own work has its
 *     own section;
 *   - on the next school day itself, its list takes the same days, and today
 *     too when today has no school (a Friday that opened on Sunday).
 * `null` on any other day, and when there is no such day in between.
 */
export function carryRange(today: DateStr, shown: DateStr, next: DateStr | null, todayIsSchoolDay: boolean): DueRange | null {
  if (!next) return null;
  const span = (from: DateStr, to: DateStr): DueRange | null => (from < to ? { from, to } : null);
  if (shown === today) return span(addDays(today, 1), next);
  if (shown !== next) return null;
  return span(todayIsSchoolDay ? addDays(today, 1) : today, shown);
}

/**
 * Whether today has school, by what the server described (`noSchoolDay`'s
 * rule). The week views leave Shabbat out, so a Saturday they do not list has
 * none; any other day not known yet counts as a school day until it is.
 */
export function todayHasSchool(today: DateStr, known: readonly KnownDay[]): boolean {
  const self = known.find((d) => d.date === today);
  if (self) return noSchoolDay({ ...self, holidayName: null }, self.lessons) === null;
  return new Date(`${today}T12:00:00`).getDay() !== 6;
}

function inRange(due: DateStr | null | undefined, range: DueRange | null): due is DateStr {
  return !!due && !!range && due >= range.from && due < range.to;
}

/** One row of a day's "להגשה" list: Mashov homework, Classroom work, or a Google task. `due` is its own date. */
export type DueEntry =
  | { kind: 'homework'; due: DateStr; homework: HomeworkItem }
  | { kind: 'classroom'; due: DateStr; work: ClassroomWork }
  | { kind: 'task'; due: DateStr; task: Task };

const DUE_KIND_ORDER: Record<DueEntry['kind'], number> = { homework: 0, classroom: 1, task: 2 };

/**
 * A day's "להגשה" list:
 *   - its own homework and tasks, from the day view (study tasks have their
 *     own section, `studyEntries`);
 *   - its Classroom work (plan 14.5), like homework — `classroom` is the feed,
 *     only when Classroom is connected; undated work never shows here;
 *   - what waits for it from the days without school before it (`range`,
 *     `carryRange`): homework from the school feed — not what became a task,
 *     as the day view leaves it out — open tasks, and Classroom work.
 * Oldest first, so Friday's comes before Sunday's; on one day homework,
 * then Classroom, then tasks.
 */
export function dueEntries(
  date: DateStr,
  own: { homework: readonly HomeworkItem[]; tasks: readonly Task[] },
  more: {
    range?: DueRange | null;
    homework?: readonly HomeworkItem[] | null;
    tasks?: readonly Task[] | null;
    classroom?: readonly ClassroomWork[] | null;
  } = {},
): DueEntry[] {
  const range = more.range ?? null;
  const entries: DueEntry[] = [];
  for (const h of more.homework ?? []) {
    if (h.linkedTaskId === null && inRange(h.dueDate, range)) entries.push({ kind: 'homework', due: h.dueDate, homework: h });
  }
  for (const h of own.homework) entries.push({ kind: 'homework', due: date, homework: h });
  for (const w of more.classroom ?? []) {
    if (w.dueDate === date || inRange(w.dueDate, range)) entries.push({ kind: 'classroom', due: w.dueDate!, work: w });
  }
  for (const t of more.tasks ?? []) {
    if (!t.completed && !isStudyTask(t.title) && inRange(t.due, range)) entries.push({ kind: 'task', due: t.due, task: t });
  }
  for (const t of own.tasks) if (!isStudyTask(t.title)) entries.push({ kind: 'task', due: date, task: t });
  // Stable: within a day and a kind, the order they came in.
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => a.entry.due.localeCompare(b.entry.due) || DUE_KIND_ORDER[a.entry.kind] - DUE_KIND_ORDER[b.entry.kind] || a.i - b.i)
    .map(({ entry }) => entry);
}

/** A day's study tasks: the open ones that wait for it from the days without school before it, then its own. */
export function studyEntries(own: readonly Task[], more: { range?: DueRange | null; tasks?: readonly Task[] | null } = {}): Task[] {
  const carried = (more.tasks ?? [])
    .filter((t) => !t.completed && isStudyTask(t.title) && inRange(t.due, more.range ?? null))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  return [...carried, ...own.filter((t) => isStudyTask(t.title))];
}

/** Whether a row of the list is done: homework ticked, Classroom handed in or ticked here, a task completed. */
export function isDueEntryDone(entry: DueEntry, classroomDone: ReadonlySet<string>): boolean {
  if (entry.kind === 'homework') return entry.homework.done;
  if (entry.kind === 'classroom') return isClassroomDone(entry.work, classroomDone);
  return entry.task.completed;
}

/** What is still to hand in on the list; none, and the heading says "הכול סומן כבוצע". */
export function openDueCount(entries: readonly DueEntry[], classroomDone: ReadonlySet<string>): number {
  return entries.filter((e) => !isDueEntryDone(e, classroomDone)).length;
}

/**
 * A carried row's due line on the next school day's list, under "להגשה עד
 * יום ראשון": "להגשה ביום ו׳ 9.10", "להגשה בשבת 10.10" — its own day and
 * date, not "להגשה מחר" (run 7): what a screen reader hears, beside the
 * date the row's margin shows. With an hour that is not the end of the day
 * (Classroom's): "להגשה ביום ו׳ 9.10 עד 14:00".
 */
export function carriedDueParts(due: DateStr, time: string | null = null): Part[] {
  const parts: Part[] = [{ text: `להגשה ב${shortWeekday(due)} ` }, ltr(formatShortDate(due))];
  if (time && time !== '23:59') parts.push({ text: ' עד ' }, ltr(time));
  return parts;
}

/**
 * The strip on "היום שלי" when Mashov is not connected (W5-4, Maya: the
 * homework went on saying "להגשה היום: פיזיקה" with no word that it had
 * stopped updating): what is wrong, and the action. `null` while connected —
 * and while unknown, since `mashovLink` reads that as connected.
 *
 * `renew` (W6-1, stream M): a connection that dropped reconnects in the
 * app's sheet ("מתחברים מחדש למשוב…", `requestMashovRenew`), over the day it
 * was cut from; Mashov never connected goes to the full login screen, which
 * explains the first login — "מחדש" would not be true there.
 */
export function mashovStrip(link: MashovLink): { text: string; action: string; renew: boolean } | null {
  if (link.connected) return null;
  return link.reason === 'needs_reauth'
    ? { text: 'משוב ניתק את החיבור', action: 'להתחבר שוב', renew: true }
    : { text: 'משוב לא מחובר', action: 'להתחבר', renew: false };
}

/**
 * The day a line about its changes names: "היום", "מחר", "אתמול", else
 * "ביום ראשון" ("בשבת") — "ביום הזה" read stiffly (the Wave 9 re-rate).
 */
export function changesDayWord(date: DateStr, today: DateStr): string {
  if (date === today) return 'היום';
  if (date === addDays(today, 1)) return 'מחר';
  if (date === addDays(today, -1)) return 'אתמול';
  return `ב${weekdayName(date)}`;
}

/** The changes row: "4 שינויים היום", "שינוי אחד מחר", "2 שינויים ביום ראשון". */
export function changesLabel(count: number, date: DateStr, today: DateStr): string {
  return `${plural(count, 'שינוי אחד', 'שינויים')} ${changesDayWord(date, today)}`;
}

/** A lesson's status in words a student would use (LessonSheet). */
export function statusExplanation(status: LessonStatus): string {
  switch (status) {
    case 'cancelled': return 'השיעור בוטל ולא יתקיים.';
    case 'substitution': return 'השיעור מתקיים, עם מילוי מקום.';
    case 'moved': return 'השיעור הוזז ממקומו הרגיל במערכת.';
    case 'remote': return 'השיעור מתקיים מרחוק.';
    case 'exam': return 'בשעה הזאת יש מבחן.';
    case 'event': return 'בשעה הזאת יש פעילות של בית הספר.';
    default: return 'שיעור רגיל, בלי שינויים.';
  }
}

const SOURCE_LABELS: Record<Source, string> = {
  shahaf: 'אתר בית הספר',
  school_site: 'אתר בית הספר',
  mashov: 'משוב',
  google_calendar: 'יומן Google',
  google_tasks: 'Google Tasks',
  google_classroom: 'Google Classroom',
};

export function sourceLabel(source: Source): string {
  return SOURCE_LABELS[source] ?? source;
}

function sundayOf(date: DateStr): DateStr {
  return addDays(date, -new Date(`${date}T12:00:00`).getDay());
}

/** Weeks from `today`'s week to `date`'s, Sunday-first — the site's `week` parameter. */
export function weekOffset(date: DateStr, today: DateStr): number {
  const ms = new Date(`${sundayOf(date)}T12:00:00`).getTime() - new Date(`${sundayOf(today)}T12:00:00`).getTime();
  return Math.round(ms / (7 * 86_400_000));
}

/**
 * "פתח באתר" for a lesson the school site published: its changes list for a
 * changed lesson, else the class's week. `siteUrl` is the school's Shahaf
 * site, as `GET /settings` reports it. `null` for anything else (Mashov
 * needs a login, and a projected lesson is not on the site yet), so the
 * button is left out rather than pointing somewhere unhelpful.
 */
export function lessonSiteUrl(
  lesson: Lesson,
  siteUrl: string | null | undefined,
  classId: string | null | undefined,
  today: DateStr,
): string | null {
  if (lesson.source !== 'shahaf' || !siteUrl || !classId) return null;
  const base = siteUrl.replace(/\/+$/, '');
  const cls = `cls=${encodeURIComponent(classId)}`;
  if (lesson.status !== 'regular') return `${base}/?${cls}&tab=changes`;
  const week = weekOffset(lesson.date, today);
  return `${base}/?${cls}&tab=changestable${week !== 0 ? `&week=${week}` : ''}`;
}

/**
 * The site's subject (or teacher) the way the server keys it — its
 * `subjectKey` (server lib/subjects.ts): one kind of quote mark, single
 * spaces. `SubjectOption.name` and `.teacher` arrive in this form.
 */
export function subjectKeyOf(raw: string): string {
  return raw.replace(/[״"]/g, '"').replace(/[׳']/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * What "זה לא השיעור שלי" hides (W5-5, Noa, run 4): the whole row of
 * "השיעורים שלי" that the lesson belongs to. Its own line is found the way
 * the server keys it, and its key is taken from the lines the server lists
 * (`SubjectOption.key` — plain, or "subject @ teacher" when two teachers
 * share the subject), never rebuilt here. The row is U3's
 * (`groupLessonOptions`, W5-7): the lines of one subject and one teacher —
 * "אזרחות" and "אזרחות (יב2)" are one class published twice. Hiding only the
 * one line would leave the row `mixed` there and half the subject's lessons
 * still on the timetable; with every key the row's switch turns off, and can
 * bring it all back.
 *
 * Empty when no line matches — then there is no button, rather than a key no
 * switch shows. The line is found by the source's name (`originalSubject`):
 * a name the student gave the lesson hides the same row.
 */
export function lessonHideKeys(lesson: Pick<Lesson, 'subject' | 'originalSubject' | 'teacher'>, subjects: readonly SubjectOption[]): string[] {
  const name = subjectKeyOf(lesson.originalSubject ?? lesson.subject);
  const teacher = lesson.teacher ? subjectKeyOf(lesson.teacher) : null;
  const byName = subjects.filter((s) => s.name === name);
  const line = byName.find((s) => s.teacher === teacher) ?? (byName.length === 1 ? byName[0] : undefined);
  if (!line) return [];
  return groupLessonOptions(subjects).find((g) => g.keys.includes(line.key))?.keys ?? [line.key];
}

/**
 * The question "זה לא השיעור שלי" asks before it hides anything (V2, Maya,
 * run 5: one tap took physics off every day, and its homework with it, from a
 * button that speaks of one lesson). It names the subject, what goes with it,
 * and where it comes back. `subject` is the name without its group; on a
 * parent's phone the way back is the parent's row (`LESSONS_COPY`).
 */
export function hideLessonQuestion(subject: string, parent = false): { title: string; detail: string } {
  const row = LESSONS_COPY[parent ? 'parent' : 'student'].title;
  return {
    title: `להסתיר את ${subject} בכל הימים?`,
    detail: `גם שיעורי הבית ב${subject} לא יופיעו. אפשר להחזיר בהגדרות, ב״מה מוצג״, תחת ״${row}״.`,
  };
}

/** What the sheet hid today: the subject's name, the keys it added, and the day it was hidden on. */
export interface HiddenFromSheet {
  subject: string;
  keys: string[];
  date: DateStr;
}

/**
 * The lines "הסתרת את פיזיקה · להחזיר" on "היום שלי" (V2, Maya, run 5: the
 * toast went before she could reach "לבטל", and the way back is three screens
 * deep). One for each subject hidden from the lesson sheet on `today`, while
 * any of its keys is still on the hide list (`hidden`) — brought back in
 * "השיעורים שלי", the line goes too. They go at midnight.
 */
export function hiddenFromSheetNotes(
  notes: readonly HiddenFromSheet[],
  hidden: readonly string[],
  today: DateStr,
): HiddenFromSheet[] {
  return notes.filter((n) => n.date === today && n.keys.some((k) => hidden.includes(k)));
}

/**
 * The notes once `keys` went back under `subject` ("לבטל", "להחזיר"): those
 * keys leave its note, and a note with none left goes. Two rows can share a
 * name (two teachers' "חינוך גופני"), so a hide joins the note of its
 * subject (`addHiddenNote`) rather than replacing it, and a "לבטל" for one
 * leaves the other's keys and its line.
 */
export function forgetHiddenKeys(notes: readonly HiddenFromSheet[], subject: string, keys: readonly string[]): HiddenFromSheet[] {
  return notes
    .map((n) => (n.subject === subject ? { ...n, keys: n.keys.filter((k) => !keys.includes(k)) } : n))
    .filter((n) => n.keys.length > 0);
}

/** The notes with one more hide: joined to the note of the same subject and day, if there is one. */
export function addHiddenNote(notes: readonly HiddenFromSheet[], note: HiddenFromSheet): HiddenFromSheet[] {
  const same = notes.find((n) => n.subject === note.subject && n.date === note.date);
  const keys = same ? [...same.keys, ...note.keys.filter((k) => !same.keys.includes(k))] : note.keys;
  return [...notes.filter((n) => n.subject !== note.subject), { ...note, keys }];
}

/** "הסתרת את פיזיקה" — the line's words, beside "להחזיר". */
export function hiddenNoteText(subject: string): string {
  return `הסתרת את ${subject}`;
}

/**
 * A detail row as a screen reader gets it, "שעה: שיעורים 1–2 · 08:00–09:30",
 * with every number range isolated the way the row draws it — a bare "1–2"
 * in a Hebrew string comes out "2–1" wherever that string is shown (W5-5,
 * Daniel, run 4).
 */
export function detailLabel(label: string, value: string | Part[]): string {
  return `${label}: ${isolateRanges(typeof value === 'string' ? value : partsText(value))}`;
}

/** "שיעור 3, 09:45–10:30" pieces: the period, and the clock range when known (a comma, no "·"). */
export function lessonTimeParts(lesson: Lesson): Part[] {
  const parts: Part[] = [{ text: `שיעור ${lesson.hourIndex}` }];
  if (lesson.startTime && lesson.endTime) parts.push({ text: ', ' }, ltr(`${lesson.startTime}–${lesson.endTime}`));
  return parts;
}

/**
 * `lessonTimeParts` for a card that stands for several periods: "שיעורים 1–3,
 * 08:00–10:30". One lesson reads as `lessonTimeParts` does.
 */
export function blockTimeParts(lessons: Lesson[]): Part[] {
  if (lessons.length === 1) return lessonTimeParts(lessons[0]!);
  const parts: Part[] = [{ text: 'שיעורים ' }, ltr(periodsLabel(lessons))];
  const time = blockTimeLabel(lessons);
  if (time) parts.push({ text: ', ' }, ltr(time));
  return parts;
}

/** "כל היום", or "16:00–17:30". */
export function eventTimeLabel(event: CalendarEvent): string {
  if (event.allDay) return 'כל היום';
  const start = timeOf(event.start);
  const end = timeOf(event.end);
  return end ? `${start}–${end}` : start;
}

/** The "מבחן הבא" strip's first line, after the subject; `dated` when it is the date. */
export interface ExamStrip {
  subject: string;
  /** "עוד 12 ימים" on today; on any other day the date, "יום שלישי 20.10". */
  when: Part[];
  /** `when` is the date, so the line under it does not say it again. */
  dated: boolean;
  /** Days from today to the exam, the row's end value; `null` when `when` is the date. */
  days: number | null;
}

/**
 * "יום שלישי 20.10", "שבת 17.10": an exam's date in the one form the app
 * writes it in (`dayDateLabel`, lib/format), the date through `Ltr`.
 */
export function weekdayDateParts(date: DateStr): Part[] {
  const { weekday, date: short } = dayDateParts(date);
  return [{ text: `${weekday} ` }, ltr(short)];
}

/**
 * The "מבחן הבא" strip (F5): one number, never two (Wave 7; Itai, Maya and
 * Daniel, run 6, asked "12 or 9?" of "עוד 12 ימים (9 ימים מיום ראשון)").
 *   - on today: the countdown, "מבחן באנגלית · עוד 12 ימים";
 *   - on any other day: the date and no count at all, "מבחן באנגלית · יום
 *     שלישי 20.10" — a count from today read as wrong on Sunday (W4-12a), and a
 *     count from Sunday beside it read as a second answer (V2).
 * An exam already past (an old day's next exam) shows its date too.
 */
export function examStrip(next: NextExam, today: DateStr, shown: DateStr = today): ExamStrip {
  const days = daysUntil(next.exam.date, new Date(`${today}T12:00:00`));
  // A name of the student's own (`originalSubject` set) is theirs as they wrote it: no group to strip.
  const subject = shownSubject(next.exam);
  if (shown === today && days >= 0) return { subject, when: [{ text: countdownLabel(days) }], dated: false, days };
  return { subject, when: weekdayDateParts(next.exam.date), dated: true, days: null };
}

/** Words that open the name of a place, not of a class group: "(מעבדת פיזיקה)". */
const PLACE = /^(?:מעבד[הת]|חדר|אולם|ספרי[יה]|מגרש|סטודיו|אודיטוריום)/;

/**
 * What the brackets in a subject say, split into where the lesson is and who
 * it is for: "פיזיקה (מעבדת פיזיקה)" is in a place, "אנגלית (יב3)" is for a
 * group — so the lesson sheet labels each for what it is (W4, Maya: "is
 * 'מעבדת פיזיקה' the place or my group?").
 */
export function subjectNotes(subject: string): { group: string | null; place: string | null } {
  const inner = [...subject.matchAll(/\(([^)]*)\)/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  const places = inner.filter((s) => PLACE.test(s));
  const groups = inner.filter((s) => !PLACE.test(s));
  return { group: groups.length > 0 ? groups.join(', ') : null, place: places.length > 0 ? places.join(', ') : null };
}
