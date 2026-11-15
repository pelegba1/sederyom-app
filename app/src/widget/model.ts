/**
 * What the widgets decide before they draw anything — which day the schedule
 * widget shows, how many rows fit, what a due date is called. Pure functions
 * over the feed, with no React Native imports, so `test/widget-model.test.cjs`
 * can run them under plain node (`lib/format` is pure too).
 */
import type { DateStr, WidgetDay, WidgetEvent, WidgetExam, WidgetFeed, WidgetHomework, WidgetLesson, WidgetTask } from '@sederyom/shared';
import { addDays, isolateRanges, plural, shortSubject, shownSubject, weekdayName } from '../lib/format';
import { subjectColorOf, subjectOrder, type SubjectLine, type SubjectSlots } from '../lib/subjectColors';
import type { ColorScheme } from '../theme';

/**
 * Where one schedule widget is paged to. `date` is the feed date the offset
 * was chosen against: a cursor left on "מחר" last night must read as today
 * this morning, not as the day after.
 */
export interface DayCursor {
  date: DateStr;
  offset: number;
}

export interface ResolvedDay {
  day: WidgetDay;
  /** Days from today; 0 is today. */
  offset: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * The window the feed carries. A feed cached before the window existed has
 * only today's fields at the top level; it renders once as a one-day window
 * and is replaced by the next refresh.
 */
export function feedDays(feed: WidgetFeed): WidgetDay[] {
  if (Array.isArray(feed.days) && feed.days.length > 0) return feed.days;
  return [{
    date: feed.date,
    weekdayName: feed.weekdayName,
    hebrewDate: feed.hebrewDate,
    isSchoolDay: true,
    holidayName: null,
    lessons: feed.lessons ?? [],
    events: [],
    tasksDue: (feed.tasksDueToday ?? []).map((t) => ({ id: t.id, title: t.title, due: feed.date, listTitle: null })),
    exams: [],
    changeCount: feed.changeCount ?? 0,
  }];
}

function todayIndex(days: WidgetDay[], today: DateStr): number {
  const idx = days.findIndex((d) => d.date === today);
  return idx >= 0 ? idx : 0;
}

export function resolveDay(feed: WidgetFeed, cursor: DayCursor | null): ResolvedDay {
  const days = feedDays(feed);
  const base = todayIndex(days, feed.date);
  const wanted = cursor && cursor.date === feed.date ? cursor.offset : 0;
  const idx = Math.min(Math.max(base + wanted, 0), days.length - 1);
  return {
    day: days[idx]!,
    offset: idx - base,
    hasPrev: idx > 0,
    hasNext: idx < days.length - 1,
  };
}

/** The cursor after a tap on "previous" (-1), "next" (+1) or "today" (0 delta, reset). */
export function stepCursor(feed: WidgetFeed, cursor: DayCursor | null, delta: number): DayCursor {
  if (delta === 0) return { date: feed.date, offset: 0 };
  const current = resolveDay(feed, cursor);
  const days = feedDays(feed);
  const base = todayIndex(days, feed.date);
  const idx = Math.min(Math.max(base + current.offset + delta, 0), days.length - 1);
  return { date: feed.date, offset: idx - base };
}

/** "היום" / "מחר" / "אתמול" / the weekday name. */
export function relativeDayName(day: WidgetDay, offset: number): string {
  if (offset === 0) return 'היום';
  if (offset === 1) return 'מחר';
  if (offset === -1) return 'אתמול';
  return day.weekdayName;
}

/** "יום שלישי" today, "מחר, רביעי" tomorrow, "יום ראשון" further away (a comma, no "·": Wave 9 re-rate). */
export function dayTitle(day: WidgetDay, offset: number): string {
  if (offset === 0) return day.weekdayName;
  const relative = relativeDayName(day, offset);
  return relative === day.weekdayName ? relative : `${relative}, ${weekdayShort(day.weekdayName)}`;
}

/** `YYYY-MM-DD` → `D.M`. */
export function shortDate(date: DateStr): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/** Weekday without the "יום " prefix — "שלישי" — for the paging controls. */
export function weekdayShort(name: string): string {
  return name.replace(/^יום /, '');
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: DateStr, to: DateStr): number {
  const a = Date.UTC(...splitDate(from));
  const b = Date.UTC(...splitDate(to));
  return Math.round((b - a) / 86_400_000);
}

function splitDate(date: DateStr): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none';

function isFriday(date: DateStr): boolean {
  return new Date(`${date}T12:00:00`).getDay() === 5;
}

/**
 * The first school day after the feed's date in its window (W4-1): Sunday
 * on a Thursday, Monday when Sunday is a holiday. A day counts by the same
 * rule as the app's "היום שלי" — a school day, except a Friday with no
 * lessons. `null` when the window shows none; nothing beyond it is guessed.
 */
export function nextSchoolDate(feed: WidgetFeed): DateStr | null {
  const day = feedDays(feed).find((d) => d.date > feed.date && d.isSchoolDay && !(isFriday(d.date) && d.lessons.length === 0));
  return day?.date ?? null;
}

/**
 * What a task's due date reads as on the widget, and how loudly. Due on the
 * next school day when that is not tomorrow — Sunday, seen on a Thursday —
 * it says the day ("יום ראשון"), not "עוד 3 ימים" (W4-1).
 */
export function dueLabel(task: Pick<WidgetTask, 'due'>, today: DateStr, nextSchool: DateStr | null = null): { text: string; tone: DueTone } {
  if (!task.due) return { text: '', tone: 'none' };
  const days = daysBetween(today, task.due);
  if (days < 0) return { text: days === -1 ? 'אתמול' : `באיחור ${-days} ימים`, tone: 'overdue' };
  if (days === 0) return { text: 'היום', tone: 'today' };
  if (days === 1) return { text: 'מחר', tone: 'soon' };
  if (task.due === nextSchool) return { text: weekdayName(task.due), tone: 'soon' };
  if (days <= 6) return { text: `עוד ${days} ימים`, tone: 'soon' };
  return { text: shortDate(task.due), tone: 'later' };
}

/** "המבחן היום" / "מבחן מחר" / "עוד 3 ימים". */
export function countdown(daysAway: number): string {
  if (daysAway <= 0) return 'המבחן היום';
  if (daysAway === 1) return 'מבחן מחר';
  return `עוד ${daysAway} ימים`;
}

/**
 * The day in a few words, for the widgets' headers (W4, Itai: "08:00–10:30,
 * 4 בוטלו" on the home screen, at 07:40 on the bus): the span of the lessons
 * that take place, then what was cancelled — or, with nothing cancelled, how
 * many lessons. "כל השיעורים בוטלו" when none takes place; "N שיעורים"
 * without clock times; `null` on a day without lessons. The range is
 * isolated left-to-right (U+2066…U+2069): inside a Hebrew line on the widget
 * it would otherwise read "10:30–08:00".
 */
export function daySpan(day: WidgetDay): string | null {
  const lessons = day.lessons;
  if (lessons.length === 0) return null;
  const active = lessons.filter((l) => l.status !== 'cancelled');
  const cancelled = lessons.length - active.length;
  // The count, not "כל השיעורים בוטלו": the feed is already filtered, so with a
  // subject hidden "all" would claim more than the school did (run 5, Maya).
  if (active.length === 0) return lessons.length === 1 ? 'שיעור אחד בוטל' : `${lessons.length} שיעורים בוטלו`;
  const count = plural(active.length, 'שיעור אחד', 'שיעורים');
  const gone = cancelled === 0 ? null : cancelled === 1 ? 'אחד בוטל' : `${cancelled} בוטלו`;
  const starts = active.map((l) => l.startTime).filter((t): t is string => t !== null).sort();
  const ends = active.map((l) => l.endTime).filter((t): t is string => t !== null).sort();
  if (starts.length === 0 || ends.length === 0) return gone ? `${count}, ${gone}` : count;
  const span = isolateRanges(`${starts[0]}–${ends[ends.length - 1]}`);
  return `${span}, ${gone ?? count}`;
}

/**
 * A header's title: the day's name and its date, "יום חמישי 8.10", "מחר,
 * שישי 9.10". The date moved here from the line under it, which held three
 * parts (plan §16.2).
 */
export function dayDateTitle(day: WidgetDay, offset: number): string {
  return `${dayTitle(day, offset)} ${shortDate(day.date)}`;
}

/** A header's second line: the day in a few words (`daySpan`) — or, without lessons, the Hebrew date. */
export function dayHeaderLine(day: WidgetDay): string {
  return daySpan(day) ?? day.hebrewDate;
}

/** What the header badge says about a day's changes. */
export function changeBadge(day: WidgetDay): { text: string; changed: boolean } {
  if (day.changeCount === 1) return { text: 'שינוי אחד', changed: true };
  if (day.changeCount > 1) return { text: `${day.changeCount} שינויים`, changed: true };
  return { text: 'ללא שינויים', changed: false };
}

/** What a day with no lessons says instead of a list. */
export function emptyDayText(day: WidgetDay): string {
  if (day.holidayName) return day.holidayName;
  if (!day.isSchoolDay) return 'אין לימודים';
  return 'אין שיעורים';
}

/** The lesson in progress at `now` (`HH:mm`), or -1. */
export function currentLessonIndex(day: WidgetDay, now: string): number {
  return day.lessons.findIndex((l) => l.startTime !== null && l.endTime !== null && l.startTime <= now && now < l.endTime);
}

/** True once the last lesson with an end time is over. */
export function dayIsOver(day: WidgetDay, now: string): boolean {
  const ends = day.lessons.map((l) => l.endTime).filter((t): t is string => t !== null);
  if (ends.length === 0) return day.lessons.length === 0;
  return ends.every((t) => t <= now);
}

/**
 * Which day the main widget leads with. Today while it still has lessons
 * ahead; once school is out for the day (or today has none), the next school
 * day in the window, because the evening question is "what is tomorrow like".
 */
export function overviewDay(feed: WidgetFeed, now: string): ResolvedDay & { label: string } {
  const today = resolveDay(feed, null);
  if (!dayIsOver(today.day, now)) return { ...today, label: 'היום' };
  const days = feedDays(feed);
  const base = todayIndex(days, feed.date);
  for (let i = base + 1; i < days.length; i += 1) {
    const day = days[i]!;
    if (day.lessons.length > 0) {
      const offset = i - base;
      return { day, offset, hasPrev: true, hasNext: i < days.length - 1, label: relativeDayName(day, offset) };
    }
  }
  return { ...today, label: 'היום' };
}

/**
 * What the lesson row prints as its name, the name the app's own screens
 * print (`shownSubject`): a name the student gave, as typed; the school's
 * without its level and group, "פיזיקה מורחב (מעבדת פיסיקה)" → "פיזיקה". A
 * cancelled one is in the red pen, with `lessonStatusWord` at its end.
 */
export function lessonTitle(lesson: WidgetLesson): string {
  return shownSubject(lesson);
}

/**
 * The name a lesson's colour goes by (`widgetSubjectColor`): the source's,
 * so a name the student gave never moves a lesson to another colour, and the
 * slots the app keeps (`lib/subjectColorStore.ts`) still find it.
 */
export function lessonColorKey(lesson: Pick<WidgetLesson, 'subject' | 'originalSubject'>): string {
  return lesson.originalSubject ?? lesson.subject;
}

/**
 * The word at a lesson row's end in place of its detail: "בוטל" for a
 * cancelled lesson, as on the page (plan §16.1). The widget library draws no
 * strike-through, so the red title and this word say it. `null` otherwise.
 */
export function lessonStatusWord(lesson: Pick<WidgetLesson, 'status'>): string | null {
  return lesson.status === 'cancelled' ? 'בוטל' : null;
}

/**
 * The subjects of the feed's window as subject lines, each with how many
 * lessons it has there — what `subjectOrder` hands the colours out by. The
 * headless widget task has no settings to read, so the window stands in for
 * the fetched weeks; the feed is already without the hidden subjects.
 */
export function feedSubjectLines(feed: WidgetFeed): SubjectLine[] {
  const counts = new Map<string, number>();
  for (const day of feedDays(feed)) {
    for (const lesson of day.lessons) {
      const key = lessonColorKey(lesson);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

/**
 * The subject's colour on the widget (plan §16.1: an 8-point dot): the slot
 * the app keeps for it (`slots`, lib/subjectColorStore.ts), so the widget and
 * the app agree (run 8); else handed out over the feed's own subjects. Asked
 * of a lesson's `lessonColorKey`.
 */
export function widgetSubjectColor(feed: WidgetFeed, scheme: ColorScheme, slots: SubjectSlots = {}): (subject: string) => string {
  return subjectColorOf(subjectOrder(feedSubjectLines(feed)), scheme, slots);
}

export interface RowBudget {
  /** dp taken by everything that is not a list row. */
  fixed: number;
  /** dp per row. */
  row: number;
  min: number;
  max: number;
}

export const SCHEDULE_ROWS: RowBudget = { fixed: 84, row: 22, min: 2, max: 12 };
export const TASK_ROWS: RowBudget = { fixed: 70, row: 24, min: 2, max: 14 };
export const OVERVIEW_ROWS: RowBudget = { fixed: 96, row: 22, min: 3, max: 12 };

/** dp per line of the overview's side column (12sp text, no row padding). */
const OVERVIEW_SIDE_LINE = 16;

/** How many text lines the overview's side column can hold. */
export function overviewSideLines(heightDp: number): number {
  if (!Number.isFinite(heightDp) || heightDp <= 0) return 4;
  return Math.max(4, Math.floor((heightDp - OVERVIEW_ROWS.fixed) / OVERVIEW_SIDE_LINE));
}

export interface SideCounts {
  /** Subjects with homework in focus (`HomeworkFocus.subjects`); none when absent. */
  homework?: number;
  events: number;
  exams: number;
  tasks: number;
}

export interface SideLayout {
  /** Subject rows under "להגשה מחר" / "להגשה היום". */
  homework: number;
  /** The next exam on one line of its own ("מבחן אנג׳ · עוד 3 ימים"), no heading. */
  examLine: boolean;
  /** Rows of the "מבחנים" list, which replaces the line when two exams fit. */
  exams: number;
  tasks: number;
  events: number;
  /** "אין משימות דחופות" — only when there are none, never for tasks that did not fit. */
  noTasksLine: boolean;
}

/** The most subjects the homework section names. */
export const SIDE_HOMEWORK_MAX = 2;

/**
 * How the overview's side column spends its lines (the lessons have their
 * own column and never give up a row to it). A headed section costs its
 * heading plus its rows, and one that would get no rows is dropped rather
 * than left as a bare heading. Priority, highest first:
 *
 *   1. להגשה — homework due (today's during the school day, else tomorrow's):
 *      the reason a student looks at all.
 *   2. The next exam — one line, no heading, so it is almost always there.
 *   3. משימות — tasks late or due within the week.
 *   4. ביומן — the lead day's calendar.
 *   5. "אין משימות דחופות" — reassurance, only with a line to spare.
 *
 * Two passes: first every section gets its smallest useful form in that
 * order (homework, tasks and events a heading and one row, the exam its
 * line), then they grow — homework to two subjects; tasks to two (three when
 * tall); the exam line into a "מבחנים" list of two in a tall widget (a second
 * exam days away is worth less than a second urgent task); events to one (two
 * when tall); and tasks take whatever is left. So a short widget drops the
 * extra rows of a section before it drops a section, and drops sections from
 * the bottom of the list up.
 */
export function overviewSideLayout(lines: number, counts: SideCounts): SideLayout {
  const tall = lines >= 9;
  const homework = counts.homework ?? 0;
  const out: SideLayout = { homework: 0, examLine: false, exams: 0, tasks: 0, events: 0, noTasksLine: false };
  let left = lines;

  if (homework > 0 && left >= 2) { out.homework = 1; left -= 2; }
  if (counts.exams > 0 && left >= 1) { out.examLine = true; left -= 1; }
  if (counts.tasks > 0 && left >= 2) { out.tasks = 1; left -= 2; }
  if (counts.events > 0 && left >= 2) { out.events = 1; left -= 2; }

  const grow = (have: number, want: number): number => {
    const extra = Math.max(0, Math.min(want - have, left));
    left -= extra;
    return have + extra;
  };
  if (out.homework > 0) out.homework = grow(out.homework, Math.min(homework, SIDE_HOMEWORK_MAX));
  if (out.tasks > 0) out.tasks = grow(out.tasks, Math.min(counts.tasks, tall ? 3 : 2));
  // Heading and two rows in place of the one line: two lines more.
  if (out.examLine && tall && counts.exams >= 2 && left >= 2) {
    out.examLine = false;
    out.exams = 2;
    left -= 2;
  }
  if (out.events > 0) out.events = grow(out.events, Math.min(counts.events, tall ? 2 : 1));
  if (out.tasks > 0) out.tasks = grow(out.tasks, counts.tasks);
  if (counts.tasks === 0 && left >= 1) { out.noTasksLine = true; left -= 1; }
  return out;
}

/**
 * A side-column heading, with the section's total when its rows do not show
 * all of it ("משימות (5)", as a fold counts in the app). The number ends the
 * line, where the bidi algorithm leaves it in place.
 */
export function sectionHeading(title: string, total: number, shown: number): string {
  return total > shown ? `${title} (${total})` : title;
}

/**
 * The next exam as one line that says what it is: "מבחן אנג׳, עוד 3 ימים",
 * "מבחן גוש ב׳, מחר". The subject goes short (`shortSubject` reads exam
 * titles too: "מתכונת באנגלית" → "אנג׳") so the count of days still fits.
 * A name of the student's own (`named`) is theirs, whole: "בוחן פתע, מחר".
 * Their name for the exam's subject (`subjectName`) stands for the subject,
 * as typed: "מבחן English, מחר", as the week grid's tag says it.
 */
export function nextExamLine(exam: WidgetExam): string {
  const when = examDayWord(exam.daysAway);
  if (exam.subjectName !== undefined) return `מבחן ${ownExamName(exam.subjectName)}, ${when}`;
  if (exam.named) return `${saysExam(exam.subject) ? '' : 'מבחן '}${ownExamName(exam.subject)}, ${when}`;
  return `מבחן ${shortSubject(exam.subject)}, ${when}`;
}

/** A row of the "מבחנים" list, named the way the line names it: "אנג׳, מבחן מחר". */
export function examRow(exam: WidgetExam): string {
  if (exam.subjectName !== undefined) return `${ownExamName(exam.subjectName)}, ${countdown(exam.daysAway)}`;
  if (exam.named) {
    const name = ownExamName(exam.subject);
    return `${name}, ${saysExam(exam.subject) ? examDayWord(exam.daysAway) : countdown(exam.daysAway)}`;
  }
  return `${shortSubject(exam.subject)}, ${countdown(exam.daysAway)}`;
}

function examDayWord(daysAway: number): string {
  return daysAway <= 0 ? 'היום' : daysAway === 1 ? 'מחר' : `עוד ${daysAway} ימים`;
}

/** Longer than this, a name of the student's own is cut, so the line's count of days still fits. */
export const OWN_EXAM_NAME_MAX = 18;

/**
 * A name the student gave the exam (`WidgetExam.named`) or its subject (`subjectName`), as they wrote it:
 * never cut to a subject's short form, which would keep a word of it
 * ("בוחן פתע, יחידה 3" is not "בוחן"); cut with "…" only when it is long.
 */
function ownExamName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length > OWN_EXAM_NAME_MAX ? `${clean.slice(0, OWN_EXAM_NAME_MAX - 1).trimEnd()}…` : clean;
}

/** A name that already says it is an exam ("בוחן פתע", "הבוחן של רותי"): no "מבחן" before it. */
function saysExam(name: string): boolean {
  return /^ה?(?:מבחן|מבחני|בוחן|בחינ[הת]|בגרות|מתכונת|מבדק|הגש[הת]|שכבתי)/.test(name.trim());
}

// ---- homework (Mashov, open, due today or tomorrow) ----

/**
 * The feed's open homework from its date on, as sent (due date ascending).
 * A feed cached from a server that predates `homeworkDue` has none, which
 * reads as nothing due rather than as an error; a malformed entry is skipped.
 */
export function feedHomework(feed: WidgetFeed): WidgetHomework[] {
  const raw: unknown = (feed as Partial<WidgetFeed>).homeworkDue;
  if (!Array.isArray(raw)) return [];
  const out: WidgetHomework[] = [];
  for (const h of raw as Partial<WidgetHomework>[]) {
    if (!h || typeof h.due !== 'string' || typeof h.subject !== 'string' || h.due < feed.date) continue;
    const item: WidgetHomework = { key: String(h.key ?? ''), subject: h.subject, text: typeof h.text === 'string' ? h.text : '', due: h.due };
    // A name the student gave: shown as typed (`shownSubject`).
    if (typeof h.originalSubject === 'string') item.originalSubject = h.originalSubject;
    out.push(item);
  }
  return out;
}

/**
 * Whether homework due today still matters at `now`: until today's last
 * lesson ends — after that it was handed in or it is too late, and the
 * question is tomorrow. A day without lessons in the feed (a holiday, or a
 * schedule that did not load) has no end to wait for, so today's homework
 * stays all day: a few hours too long beats hiding something that is due.
 */
export function todayHomeworkOpen(feed: WidgetFeed, now: string): boolean {
  const today = resolveDay(feed, null).day;
  return today.lessons.length === 0 || !dayIsOver(today, now);
}

/** The homework the widgets show at `now`: today's while school is on, and everything later. */
export function homeworkInView(feed: WidgetFeed, now: string): WidgetHomework[] {
  const keepToday = todayHomeworkOpen(feed, now);
  return feedHomework(feed)
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => keepToday || h.due !== feed.date)
    .sort((a, b) => a.h.due.localeCompare(b.h.due) || a.i - b.i)
    .map(({ h }) => h);
}

/** "להגשה היום" / "להגשה מחר" / "להגשה ביום ראשון", against the feed's date. */
export function homeworkHeading(due: DateStr, feed: WidgetFeed): string {
  const days = daysBetween(feed.date, due);
  if (days <= 0) return 'להגשה היום';
  if (days === 1) return 'להגשה מחר';
  const name = feedDays(feed).find((d) => d.date === due)?.weekdayName ?? (days <= 6 ? weekdayName(due) : null);
  return name ? `להגשה ב${name}` : `להגשה ב־${shortDate(due)}`;
}

export interface HomeworkFocus {
  due: DateStr;
  /** "להגשה היום" / "להגשה מחר". */
  label: string;
  /** Each subject once, in the feed's order, without group or level ("אנגלית"). */
  subjects: string[];
  /** Homework due that day; more than `subjects` when a subject has two. */
  count: number;
}

/**
 * What the overview's homework section is about: the earliest due day in
 * view — today's during the school day, tomorrow's once it is over or when
 * nothing is left for today. Subjects are named the way the Today screen's
 * "מחר להגשה" line names them (`shownSubject`, each once).
 */
export function homeworkFocus(feed: WidgetFeed, now: string): HomeworkFocus | null {
  const items = homeworkInView(feed, now);
  const first = items[0];
  if (!first) return null;
  const due = items.filter((h) => h.due === first.due);
  const subjects: string[] = [];
  for (const h of due) {
    const name = shownSubject(h);
    if (!subjects.includes(name)) subjects.push(name);
  }
  return { due: first.due, label: homeworkHeading(first.due, feed), subjects, count: due.length };
}

/** A homework row on the tasks widget: the subject, then the assignment's first line, "מתמטיקה: תרגילים 1–5". */
export function homeworkLine(h: WidgetHomework): string {
  const subject = shownSubject(h);
  const first = h.text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find((l) => l !== '') ?? '';
  return first ? `${subject}: ${isolateRanges(first)}` : subject;
}

/** A calendar event on the overview: "17:00 חוג", the title's ranges kept left-to-right. */
export function eventLine(e: Pick<WidgetEvent, 'summary' | 'start' | 'allDay'>): string {
  const summary = isolateRanges(e.summary);
  return e.allDay ? summary : `${clockOf(e.start)} ${summary}`;
}

/**
 * How the tasks widget splits its rows: homework on top, but a task list
 * that has tasks keeps at least one row for them.
 */
export function tasksWidgetRows(rows: number, homework: number, tasks: number): { homework: number; tasks: number } {
  const hw = Math.max(0, Math.min(homework, tasks > 0 ? Math.max(rows - 1, 1) : rows));
  return { homework: hw, tasks: Math.max(0, Math.min(tasks, rows - hw)) };
}

/**
 * How many of `items` (homework and tasks alike) are late, due today, and
 * due by the next school day — tomorrow, or through Sunday on a Thursday
 * (`nextSchool`, W4-1). That last count keeps its old name, `tomorrow`.
 */
export function dueCounts(
  items: Pick<WidgetTask, 'due'>[],
  today: DateStr,
  nextSchool: DateStr | null = null,
): { late: number; today: number; tomorrow: number } {
  const tomorrow = addDays(today, 1);
  const until = nextSchool && nextSchool > tomorrow ? nextSchool : tomorrow;
  const counts = { late: 0, today: 0, tomorrow: 0 };
  for (const item of items) {
    if (!item.due) continue;
    const days = daysBetween(today, item.due);
    if (days < 0) counts.late += 1;
    else if (days === 0) counts.today += 1;
    else if (item.due <= until) counts.tomorrow += 1;
  }
  return counts;
}

/** What the pill calls the next school day's count: "למחר", or "עד יום ראשון" on a Thursday. */
export function nextBucketLabel(today: DateStr, nextSchool: DateStr | null): string {
  return nextSchool && nextSchool > addDays(today, 1) ? `עד ${weekdayName(nextSchool)}` : 'למחר';
}

export type SummaryTone = 'overdue' | 'today' | 'soon' | 'open' | 'clear';

/**
 * The tasks widget's pill, most urgent first. `today` and `tomorrow` count
 * homework and tasks together; `open` is everything shown or not. A bare
 * number before "באיחור" / "להיום" / "למחר" needs no agreement; "פתוחות" does.
 * `nextLabel` names the next-school-day count (`nextBucketLabel`): "2 עד
 * יום ראשון" on a Thursday.
 */
export function tasksSummary(
  c: { late: number; today: number; tomorrow: number; open: number },
  nextLabel = 'למחר',
): { text: string; tone: SummaryTone } {
  if (c.late > 0) return { text: `${c.late} באיחור`, tone: 'overdue' };
  if (c.today > 0) return { text: `${c.today} להיום`, tone: 'today' };
  if (c.tomorrow > 0) return { text: `${c.tomorrow} ${nextLabel}`, tone: 'soon' };
  if (c.open > 0) return { text: plural(c.open, 'אחת פתוחה', 'פתוחות'), tone: 'open' };
  return { text: 'הכול סגור', tone: 'clear' };
}

/** "ועוד 3 משימות" under the tasks widget's list; "ועוד 2 פריטים" once homework is among them. */
export function moreLine(hiddenHomework: number, hiddenTasks: number): string | null {
  const n = Math.max(0, hiddenHomework) + Math.max(0, hiddenTasks);
  if (n === 0) return null;
  return hiddenHomework > 0 ? `ועוד ${plural(n, 'פריט אחד', 'פריטים')}` : `ועוד ${plural(n, 'משימה אחת', 'משימות')}`;
}

/** How many list rows fit in a widget `heightDp` tall. */
export function visibleRows(heightDp: number, budget: RowBudget): number {
  if (!Number.isFinite(heightDp) || heightDp <= 0) return budget.min;
  const rows = Math.floor((heightDp - budget.fixed) / budget.row);
  return Math.min(budget.max, Math.max(budget.min, rows));
}

/** The tasks widget leads with what is due or late; the rest follow by date. */
export function orderTasks(tasks: WidgetTask[], today: DateStr): WidgetTask[] {
  const rank = (t: WidgetTask): number => {
    const tone = dueLabel(t, today).tone;
    return tone === 'overdue' ? 0 : tone === 'today' ? 1 : tone === 'soon' ? 2 : tone === 'later' ? 3 : 4;
  };
  return tasks
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || (a.t.due ?? '9').localeCompare(b.t.due ?? '9') || a.i - b.i)
    .map(({ t }) => t);
}

/** `HH:mm` of an ISO instant in the device's zone, or '' when unparsable. */
export function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function clockNow(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
