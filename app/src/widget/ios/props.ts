/**
 * What the iPhone widgets draw, worked out in the app (plan stage 5).
 *
 * An `expo-widgets` widget is a function that runs inside the widget
 * extension, serialised as its own source: it cannot import anything, so it
 * cannot run `model.ts`. The app does the thinking here instead — the same
 * functions the Android widgets call, the same words — and hands each widget
 * a timeline of ready-to-draw props: one entry per moment the picture
 * changes (a lesson starts or ends, midnight), each built against its own
 * clock. The widget files (`*.ios.tsx` beside this one) only draw them.
 *
 * Pure, like `model.ts`: no React Native imports, so
 * `test/widget-ios-props.test.cjs` runs it under plain node.
 */
import type { DateStr, WidgetDay, WidgetExam, WidgetFeed, WidgetHomework, WidgetLesson, WidgetTask } from '@sederyom/shared';
import { addDays, isolateRanges, stripGroup } from '../../lib/format';
import type { SubjectSlots } from '../../lib/subjectColors';
import { dark, light, type Palette } from '../../theme';
import {
  changeBadge, clockNow, clockOf, currentLessonIndex, dayDateTitle, dayHeaderLine, daysBetween, dueCounts, dueLabel,
  emptyDayText, eventLine, examRow, feedDays, homeworkFocus, homeworkInView, homeworkLine, lessonColorKey, lessonTitle, moreLine, nextBucketLabel,
  nextExamLine, nextSchoolDate, orderTasks, overviewDay, overviewSideLayout, resolveDay, sectionHeading, tasksSummary,
  tasksWidgetRows, weekdayShort, widgetSubjectColor, type DueTone, type SummaryTone,
} from '../model';

// ---- the ink: theme tokens, both pages ----

/** The tokens a widget draws with. The widget picks a page by the phone's scheme. */
export interface Ink {
  bg: string;
  rule: string;
  margin: string;
  text: string;
  strong: string;
  muted: string;
  faint: string;
  accent: string;
  change: string;
  changeSoft: string;
  cancel: string;
  mark: string;
  onMark: string;
  ok: string;
}

function ink(p: Record<keyof Palette, string>): Ink {
  const out: Ink = {
    bg: p.bg, rule: p.border, margin: p.margin, text: p.text, strong: p.textStrong, muted: p.textMuted,
    faint: p.textFaint, accent: p.accent, change: p.change, changeSoft: p.changeSoft, cancel: p.cancel,
    mark: p.mark, onMark: p.onMark, ok: p.ok,
  };
  for (const key of Object.keys(out) as (keyof Ink)[]) out[key] = hex8(out[key]);
  return out;
}

/** `rgba(232,80,91,.55)` → `#E8505B8C`: the one colour form the native side is sure to read. */
export function hex8(color: string): string {
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
  if (!rgba) return color.toUpperCase();
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `#${byte(Number(rgba[1]))}${byte(Number(rgba[2]))}${byte(Number(rgba[3]))}${byte(Number(rgba[4]) * 255)}`;
}

export const INK: { light: Ink; dark: Ink } = { light: ink(light), dark: ink(dark) };

/** A colour token's name, so a row says "cancel" and the widget looks it up on the page it draws. */
export type Tone = keyof Ink;

// ---- what every widget carries ----

interface Base {
  ink: { light: Ink; dark: Ink };
  /** "עודכן 07:42", or with ", לא עדכני" once it is older than `STALE_AFTER_MS`. */
  updated: string;
  stale: boolean;
}

/** No feed yet: the title and one line, until the app has loaded once. */
export interface EmptyProps extends Base {
  kind: 'empty';
  title: string;
  line: string;
}

/** One lesson on a ruled line. */
export interface LessonRow {
  /** The start, "08:50" — or the hour's number without one. */
  time: string;
  subject: string;
  /** The subject's dot, on each page. */
  dot: { light: string; dark: string };
  /** past: faint; now: blue time, dashed rule, "עד"; cancelled: the red pen, struck. */
  state: 'past' | 'now' | 'cancelled' | 'plain';
  /** "עד 09:35" on the lesson in progress. */
  until?: string;
  /** Who or where, muted, at the row's end ("מר כהן", "חדר 214"). */
  detail?: string;
  /** The change in a word on the pink highlighter: "מ״מ", "הועבר", "מרחוק". */
  change?: string;
  /** An exam: the subject on the yellow highlighter, "פיזיקה, מבחן". */
  exam?: boolean;
}

/** One day of the schedule widget. */
export interface ScheduleDay {
  /** "יום ראשון 1.11", "מחר, שני 2.11". */
  title: string;
  /** "08:00–13:55, אחד בוטל", or the Hebrew date on a day without lessons. */
  line: string;
  /** "מבחן פיזיקה" on the yellow highlighter beside the title. */
  exam?: string;
  /** "2 שינויים" on the pink highlighter beside the line. */
  change?: string;
  rows: LessonRow[];
  /** "ועוד 3 שיעורים" in the footer. */
  more?: string;
  /** "אין לימודים" and the like, instead of rows. */
  empty?: string;
  /** The day before, as a letter in the margin ("ה׳"); absent at the window's start. */
  prev?: string;
  hasNext: boolean;
}

export interface ScheduleProps extends Base {
  kind: 'schedule';
  days: ScheduleDay[];
  /** Index of today in `days`. */
  today: number;
  /** Where the widget is paged to, from today. Set by its own buttons. */
  offset: number;
}

/** A line of the tasks widget: the margin says when, the line says what. */
export interface TaskRow {
  /** "איחור", "היום", "מחר", "חמישי", "8.11" — empty for an undated task. */
  when: string;
  whenTone: Tone;
  whenBold: boolean;
  text: string;
  /** Mashov homework: "ש״ב" in blue where a task has its box. */
  homework: boolean;
  /** The box's ink: the red pen for a late task. */
  box: Tone;
}

export interface TasksProps extends Base {
  kind: 'tasks';
  /** "1 באיחור", "2 למחר", "הכול סגור". */
  summary: string;
  summaryTone: Tone;
  rows: TaskRow[];
  /** "אין משימות פתוחות" when there is nothing at all. */
  empty?: string;
  more?: string;
}

/** A line of the overview's side column, on the same ruled line as a lesson. */
export interface SideLine {
  kind: 'head' | 'text' | 'exam' | 'task' | 'ok' | 'blank';
  text: string;
  /** A task's "איחור" / "היום" / "מחר", at the line's end. */
  when?: string;
  whenTone?: Tone;
}

export interface OverviewProps extends Base {
  kind: 'overview';
  title: string;
  line: string;
  change?: string;
  /** The page's ruled lines, top to bottom; a lesson, a side line, or both, or neither. */
  rows: { lesson?: LessonRow; side?: SideLine }[];
  empty?: string;
}

// ---- sizes: an iPhone widget comes in one fixed size per family ----

/**
 * Ruled lines per widget. A family's height runs from 148 pt (iPhone SE) to
 * 170 pt (Pro Max) — 324 to 382 for the large one — and the widget is never
 * told its size, so the count is the one that fits the smallest, and the
 * lines grow on a taller phone (the widget files give them a min and max).
 */
export const IOS_ROWS = { schedule: 3, tasks: 3, overview: 9 } as const;

// ---- shared pieces ----

export interface BuildInput {
  feed: WidgetFeed | null;
  /** The moment this entry shows. */
  now: Date;
  /** The app's subject colours (`readSubjectSlots`), so the widget and the app agree. */
  slots?: SubjectSlots;
  /** `updatedLabel(feed)`. */
  updated: string;
  /** When the feed counts as old (`generatedAt` + `STALE_AFTER_MS`), in ms. */
  staleAt: number;
}

function base(input: BuildInput): Base {
  const stale = input.now.getTime() > input.staleAt;
  return { ink: INK, updated: stale ? `${input.updated}, לא עדכני` : input.updated, stale };
}

function dateOf(now: Date): DateStr {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The feed as it reads on `today`: an entry after midnight belongs to the
 * next day of the window, and every "today" in `model.ts` is the feed's
 * `date`. Exams count their days from it too. `null` once the window has no
 * such day — then the feed is too old to say anything about today.
 */
export function feedOn(feed: WidgetFeed, today: DateStr): WidgetFeed | null {
  if (today === feed.date) return feed;
  const day = feedDays(feed).find((d) => d.date === today);
  if (!day) return null;
  const shift = daysBetween(feed.date, today);
  const exams = (list: WidgetExam[]): WidgetExam[] =>
    list.map((e) => ({ ...e, daysAway: e.daysAway - shift })).filter((e) => e.daysAway >= 0);
  return {
    ...feed,
    date: today,
    weekdayName: day.weekdayName,
    hebrewDate: day.hebrewDate,
    lessons: day.lessons,
    changeCount: day.changeCount,
    upcomingExams: exams(feed.upcomingExams ?? []),
    nextExam: exams(feed.nextExam ? [feed.nextExam] : [])[0] ?? null,
    days: feedDays(feed).map((d) => ({ ...d, exams: exams(d.exams) })),
  };
}

const STATUS_WORD: Partial<Record<WidgetLesson['status'], string>> = {
  substitution: 'מ״מ',
  moved: 'הועבר',
  remote: 'מרחוק',
};

/** The lesson the list leads with: the one before the lesson on now, so the one on now sits near the top. */
export function firstRow(day: WidgetDay, clock: string | null, rows: number): number {
  if (clock === null || day.lessons.length <= rows) return 0;
  const current = currentLessonIndex(day, clock);
  const next = current >= 0 ? current : day.lessons.findIndex((l) => l.startTime !== null && l.startTime > clock);
  if (next < 0) return 0;
  return Math.max(0, Math.min(next - 1, day.lessons.length - rows));
}

function lessonRow(lesson: WidgetLesson, clock: string | null, current: boolean, colorOf: { light: (s: string) => string; dark: (s: string) => string }): LessonRow {
  const row: LessonRow = {
    time: lesson.startTime ?? String(lesson.hourIndex),
    subject: lessonTitle(lesson),
    dot: { light: hex8(colorOf.light(lessonColorKey(lesson))), dark: hex8(colorOf.dark(lessonColorKey(lesson))) },
    state: 'plain',
  };
  if (lesson.status === 'cancelled') {
    row.state = 'cancelled';
    return row;
  }
  if (current) {
    row.state = 'now';
    if (lesson.endTime) row.until = `עד ${lesson.endTime}`;
  } else if (clock !== null && lesson.endTime !== null && lesson.endTime <= clock) {
    row.state = 'past';
  }
  if (lesson.status === 'exam') row.exam = true;
  const word = STATUS_WORD[lesson.status];
  if (word) row.change = word;
  // The feed writes a substitute as "מ״מ: name"; the mark already says מ״מ.
  const detail = lesson.detail?.replace(/^מ״מ:\s*/, '').trim();
  if (detail && !current) row.detail = isolateRanges(detail);
  return row;
}

function dayLessonRows(day: WidgetDay, clock: string | null, rows: number, colorOf: Parameters<typeof lessonRow>[3]): { rows: LessonRow[]; more?: string } {
  const current = clock === null ? -1 : currentLessonIndex(day, clock);
  const from = firstRow(day, clock, rows);
  const shown = day.lessons.slice(from, from + rows);
  const hidden = day.lessons.length - from - shown.length;
  return {
    rows: shown.map((l, i) => lessonRow(l, clock, from + i === current, colorOf)),
    more: hidden > 0 ? (hidden === 1 ? 'ועוד שיעור אחד' : `ועוד ${hidden} שיעורים`) : undefined,
  };
}

function colorsFor(feed: WidgetFeed, slots: SubjectSlots) {
  return { light: widgetSubjectColor(feed, 'light', slots), dark: widgetSubjectColor(feed, 'dark', slots) };
}

/**
 * "מבחן פיזיקה" for one exam that day, "2 מבחנים" for more; a name of the
 * student's own is theirs, and their name for its subject stands for the subject.
 */
function dayExamMark(day: WidgetDay): string | undefined {
  if (day.exams.length === 0) return undefined;
  if (day.exams.length > 1) return `${day.exams.length} מבחנים`;
  const exam = day.exams[0]!;
  // The title's line has room for the whole name: "מבחן פיזיקה", not the side column's "פיז׳".
  if (exam.subjectName !== undefined) return `מבחן ${exam.subjectName}`;
  return exam.named ? exam.subject : `מבחן ${stripGroup(exam.subject)}`;
}

const WEEKDAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function weekdayLetter(date: DateStr): string {
  return WEEKDAY_LETTER[new Date(`${date}T12:00:00`).getDay()] ?? '';
}

// ---- 1. מערכת ----

export function buildSchedule(input: BuildInput): ScheduleProps | EmptyProps {
  const feed = input.feed ? feedOn(input.feed, dateOf(input.now)) : null;
  if (!feed) return emptyProps(input, 'מערכת');
  const days = feedDays(feed);
  const today = resolveDay(feed, null);
  const todayIndex = days.findIndex((d) => d.date === today.day.date);
  const colorOf = colorsFor(feed, input.slots ?? {});
  const clock = clockNow(input.now);
  return {
    ...base(input),
    kind: 'schedule',
    today: todayIndex,
    offset: 0,
    days: days.map((day, i): ScheduleDay => {
      const offset = i - todayIndex;
      const list = day.lessons.length > 0 ? dayLessonRows(day, offset === 0 ? clock : null, IOS_ROWS.schedule, colorOf) : { rows: [] };
      const badge = changeBadge(day);
      return {
        title: dayDateTitle(day, offset),
        line: dayHeaderLine(day),
        exam: dayExamMark(day),
        change: day.lessons.length > 0 && badge.changed ? badge.text : undefined,
        rows: list.rows,
        more: list.more,
        empty: day.lessons.length === 0 ? emptyDayText(day) : undefined,
        prev: i > 0 ? weekdayLetter(days[i - 1]!.date) : undefined,
        hasNext: i < days.length - 1,
      };
    }),
  };
}

// ---- 2. משימות ----

/**
 * When a task is due, in the margin's few letters: "איחור", "היום", "מחר",
 * then the weekday ("חמישי") within the week and the date beyond it. The
 * margin is the time column of the page, so the long forms of `dueLabel`
 * ("באיחור 3 ימים") stay with the app.
 */
export function marginDue(item: Pick<WidgetTask, 'due'>, today: DateStr, nextSchool: DateStr | null): { text: string; tone: Tone; bold: boolean } {
  const due = dueLabel(item, today, nextSchool);
  if (!item.due || due.tone === 'none') return { text: '', tone: 'muted', bold: false };
  const days = daysBetween(today, item.due);
  if (days < 0) return { text: 'איחור', tone: 'cancel', bold: true };
  if (days === 0) return { text: 'היום', tone: 'change', bold: true };
  if (days === 1) return { text: 'מחר', tone: 'accent', bold: true };
  if (days <= 6) return { text: weekdayShort(dayName(item.due)), tone: 'muted', bold: false };
  return { text: due.text, tone: 'muted', bold: false };
}

function dayName(date: DateStr): string {
  const names = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
  return names[new Date(`${date}T12:00:00`).getDay()] ?? '';
}

const SUMMARY_TONE: Record<SummaryTone, Tone> = { overdue: 'cancel', today: 'change', soon: 'accent', open: 'muted', clear: 'ok' };

export function buildTasks(input: BuildInput): TasksProps | EmptyProps {
  const feed = input.feed ? feedOn(input.feed, dateOf(input.now)) : null;
  if (!feed) return emptyProps(input, 'משימות');
  const clock = clockNow(input.now);
  const homework = homeworkInView(feed, clock);
  const tasks = orderTasks(feed.openTasks ?? [], feed.date);
  const nextSchool = nextSchoolDate(feed);
  const total = feed.openTaskCount ?? tasks.length;
  const split = tasksWidgetRows(IOS_ROWS.tasks, homework.length, tasks.length);
  const shownHomework = homework.slice(0, split.homework);
  const shownTasks = tasks.slice(0, split.tasks);
  const summary = tasksSummary(
    { ...dueCounts([...homework, ...tasks], feed.date, nextSchool), open: total + homework.length },
    nextBucketLabel(feed.date, nextSchool),
  );
  const row = (item: WidgetTask | WidgetHomework, text: string, isHomework: boolean): TaskRow => {
    const when = marginDue(item, feed.date, nextSchool);
    return { when: when.text, whenTone: when.tone, whenBold: when.bold, text, homework: isHomework, box: when.tone === 'cancel' ? 'cancel' : 'muted' };
  };
  const rows = [
    ...shownHomework.map((h) => row(h, homeworkLine(h), true)),
    ...shownTasks.map((t) => row(t, isolateRanges(t.title), false)),
  ];
  return {
    ...base(input),
    kind: 'tasks',
    summary: summary.text,
    summaryTone: SUMMARY_TONE[summary.tone],
    rows,
    empty: rows.length === 0 ? 'אין משימות פתוחות' : undefined,
    more: moreLine(homework.length - shownHomework.length, tasks.length - shownTasks.length) ?? undefined,
  };
}

// ---- 3. סדר יום ----

const DUE_TONES: DueTone[] = ['overdue', 'today', 'soon'];

/**
 * The side column, line by line, in `overviewSideLayout`'s priority: the
 * homework due (a heading and the subjects on one line), the next exam on
 * the highlighter, the tasks due this week, the calendar. A blank line
 * parts two sections when the page has one to spare.
 */
export function overviewSide(feed: WidgetFeed, clock: string, lines: number): SideLine[] {
  const lead = overviewDay(feed, clock);
  const nextSchool = nextSchoolDate(feed);
  const allEvents = lead.day.events.filter((e) => e.allDay || lead.offset !== 0 || clockOf(e.end) > clock);
  const allExams = feed.upcomingExams ?? (feed.nextExam ? [feed.nextExam] : []);
  const allTasks = orderTasks(feed.openTasks ?? [], feed.date).filter((t) => DUE_TONES.includes(dueLabel(t, feed.date).tone));
  const homework = homeworkFocus(feed, clock);
  // The subjects share one line, so homework is one row under its heading;
  // the calendar's heading shares its first row ("ביומן: 17:00 חוג").
  const side = overviewSideLayout(lines, {
    homework: homework ? 1 : 0, events: allEvents.length, exams: allExams.length, tasks: allTasks.length,
  });

  const sections: SideLine[][] = [];
  if (homework && side.homework > 0) {
    sections.push([
      // "להגשה מחר" → "שיעורי בית למחר", "להגשה ביום ראשון" → "שיעורי בית ליום ראשון".
      { kind: 'head', text: homework.label.replace(/^להגשה ב?/, 'שיעורי בית ל') },
      { kind: 'text', text: homework.subjects.join(', ') },
    ]);
  }
  if (side.examLine && allExams[0]) sections.push([{ kind: 'exam', text: nextExamLine(allExams[0]) }]);
  if (side.exams > 0) {
    sections.push([{ kind: 'head', text: 'מבחנים' }, ...allExams.slice(0, side.exams).map((e): SideLine => ({ kind: 'text', text: examRow(e) }))]);
  }
  if (side.tasks > 0) {
    const shown = allTasks.slice(0, side.tasks);
    sections.push([
      { kind: 'head', text: sectionHeading('משימות', allTasks.length, shown.length) },
      ...shown.map((t): SideLine => {
        const when = marginDue(t, feed.date, nextSchool);
        return { kind: 'task', text: isolateRanges(t.title), when: when.text, whenTone: when.tone };
      }),
    ]);
  } else if (side.noTasksLine) {
    sections.push([{ kind: 'ok', text: 'אין משימות דחופות' }]);
  }
  if (side.events > 0) {
    // The heading's line is spent on the first event: one line more than the layout counted, so one event more fits.
    const events = allEvents.slice(0, side.events + 1);
    sections.push(events.map((e, i): SideLine => ({ kind: 'text', text: i === 0 ? `ביומן: ${eventLine(e)}` : eventLine(e) })));
  }

  const out: SideLine[] = [];
  let spare = lines - sections.reduce((n, s) => n + s.length, 0);
  sections.forEach((section, i) => {
    if (i > 0 && spare > 0) {
      out.push({ kind: 'blank', text: '' });
      spare -= 1;
    }
    out.push(...section);
  });
  return out.slice(0, lines);
}

export function buildOverview(input: BuildInput): OverviewProps | EmptyProps {
  const feed = input.feed ? feedOn(input.feed, dateOf(input.now)) : null;
  if (!feed) return emptyProps(input, 'סדר יום');
  const clock = clockNow(input.now);
  const lead = overviewDay(feed, clock);
  const colorOf = colorsFor(feed, input.slots ?? {});
  const lines = IOS_ROWS.overview;
  const lessons = lead.day.lessons.length > 0
    ? dayLessonRows(lead.day, lead.offset === 0 ? clock : null, lines, colorOf).rows
    : [];
  const side = overviewSide(feed, clock, lines);
  const badge = changeBadge(lead.day);
  const rows = Array.from({ length: lines }, (_, i) => ({ lesson: lessons[i], side: side[i] }));
  return {
    ...base(input),
    kind: 'overview',
    title: dayDateTitle(lead.day, lead.offset),
    line: dayHeaderLine(lead.day),
    change: lead.day.lessons.length > 0 && badge.changed ? badge.text : undefined,
    rows,
    empty: lead.day.lessons.length === 0 ? emptyDayText(lead.day) : undefined,
  };
}

function emptyProps(input: BuildInput, title: string): EmptyProps {
  return { ...base(input), updated: '', stale: false, kind: 'empty', title, line: 'אפשר לפתוח את האפליקציה כדי לטעון נתונים' };
}

// ---- the timeline ----

/** At most this many entries per widget: each carries its own props, and they all sit in the App Group. */
export const MAX_ENTRIES = 40;

/**
 * The moments the widgets change from `now` on: every lesson's start and
 * end today and tomorrow, both midnights, and the moment the feed goes
 * stale. WidgetKit keeps the last entry up once the list runs out, so the
 * list ends on the morning after tomorrow's midnight.
 */
export function entryTimes(feed: WidgetFeed | null, now: Date, staleAt: number = Number.NaN): Date[] {
  const times = new Set<number>([now.getTime()]);
  /** Kept whatever the cap: the widget must never stay on a day that has ended. */
  const midnights = new Set<number>();
  const today = dateOf(now);
  const at = (date: DateStr, hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    const [y, mo, d] = date.split('-').map(Number);
    return new Date(y!, mo! - 1, d!, h ?? 0, m ?? 0, 0, 0).getTime();
  };
  for (const date of [today, addDays(today, 1)]) {
    const day = feed ? feedDays(feed).find((d) => d.date === date) : undefined;
    for (const lesson of day?.lessons ?? []) {
      if (lesson.startTime) times.add(at(date, lesson.startTime));
      if (lesson.endTime) times.add(at(date, lesson.endTime));
    }
    midnights.add(at(addDays(date, 1), '00:00') + 1000);
  }
  if (Number.isFinite(staleAt)) times.add(staleAt + 1);
  const rest = [...times]
    .filter((t) => t >= now.getTime() && !midnights.has(t))
    .sort((a, b) => a - b)
    .slice(0, MAX_ENTRIES - midnights.size);
  return [...rest, ...midnights].sort((a, b) => a - b).map((t) => new Date(t));
}
