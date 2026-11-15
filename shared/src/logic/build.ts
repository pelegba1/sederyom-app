/**
 * View builders — the merge lives server-side so the app, the widget and the
 * morning summary all render the identical truth (design-doc §5, §4).
 *
 * These are pure functions over already-loaded rows; the DB loading lives in
 * `views/load.ts`. That split is what lets the tests assert the *composed*
 * result (a cancelled Shahaf lesson must arrive at /day cancelled).
 */
import type {
  AgendaDay, AgendaItem, AgendaView, CalendarEvent, DateStr, DayView, Exam, HomeworkItem, Lesson, NextExam,
  SchoolEvent, Task, TimelineItem, WeekView, WidgetDay, WidgetEvent, WidgetExam, WidgetFeed, WidgetHomework,
  WidgetLesson, WidgetTask,
} from '../index';
import { NEXT_EXAM_WINDOW_DAYS } from '../index';
import { DateTime } from 'luxon';
import { addDays, atTime, calendarDay, hebrewDateHe, schoolDayInfo, sundayIndex, weekdayNameHe } from './time';

export interface DayInputs {
  date: DateStr;
  zone: string;
  now: Date;
  lessons: Lesson[];
  events: CalendarEvent[];
  tasks: Task[];
  /**
   * Relevant (not hidden) exams from this day through `NEXT_EXAM_WINDOW_DAYS`
   * after it. Exams outside that span are ignored.
   */
  exams: Exam[];
  schoolEvents: SchoolEvent[];
  /** Homework due this day. Items due on another day are ignored. */
  homework?: HomeworkItem[];
  /** Manual "חופש" override from settings. */
  vacationMode: boolean;
}

/** Lessons sort by their start time; a lesson with no clock time falls back to its period. */
function lessonSortKey(lesson: Lesson): string {
  const time = lesson.startTime ?? `${String(7 + lesson.hourIndex).padStart(2, '0')}:00`;
  return `${time}|1|${String(lesson.hourIndex).padStart(2, '0')}`;
}

/** Each start's time of day in the zone, kept: asking the zone is slow, and the same events fill every day and week built. */
const startTimes = new Map<string, string>();

function eventSortKey(event: CalendarEvent, zone: string): string {
  if (event.allDay) return '00:00|0|';
  const key = `${zone}|${event.start}`;
  let time = startTimes.get(key);
  if (time === undefined) {
    if (startTimes.size >= 4096) startTimes.clear();
    time = DateTime.fromISO(event.start, { zone }).toFormat('HH:mm');
    startTimes.set(key, time);
  }
  return `${time}|2|`;
}

/** Tasks carry a date but no time, so they sit at the end of the day. */
function taskSortKey(): string {
  return '23:59|3|';
}

export function buildDayView(input: DayInputs): DayView {
  const { date, zone } = input;
  const school = schoolDayInfo(date, zone);
  const tomorrow = addDays(date, 1, zone);
  const isSchoolDay = school.isSchoolDay && !input.vacationMode;

  // Lessons from Mashov's recurring grid stand in for a week the school site
  // has not published (`projectLessons`). The projection already skips
  // holidays; on a day the owner declared "חופש" they are a guess about a day
  // that is not happening, so they go.
  const projected = input.lessons.length > 0 && input.lessons.every((l) => l.source === 'mashov');
  const lessons = projected && !isSchoolDay ? [] : input.lessons;

  const timeline: TimelineItem[] = [
    ...lessons.map((lesson): TimelineItem => ({ kind: 'lesson', sortKey: lessonSortKey(lesson), lesson })),
    ...input.events.map((event): TimelineItem => ({ kind: 'event', sortKey: eventSortKey(event, zone), event })),
    ...input.tasks.map((task): TimelineItem => ({ kind: 'task', sortKey: taskSortKey(), task })),
  ].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  return {
    date,
    weekdayName: weekdayNameHe(date, zone),
    hebrewDate: hebrewDateHe(date, zone),
    isSchoolDay,
    holidayName: input.vacationMode ? (school.holidayName ?? 'חופש') : school.holidayName,
    timeline,
    examsToday: input.exams.filter((e) => e.date === date),
    examsTomorrow: input.exams.filter((e) => e.date === tomorrow),
    changeCount: lessons.filter((l) => l.status !== 'regular').length,
    events: input.schoolEvents.filter((e) => e.date === date),
    homework: (input.homework ?? []).filter((h) => h.dueDate === date).sort(byHomeworkOrder),
    nextExam: nextExamFrom(date, input.exams, zone),
    projected: projected && isSchoolDay,
    generatedAt: DateTime.fromJSDate(input.now).setZone(zone).toISO()!,
  };
}

/** The nearest exam from `date` on, within `NEXT_EXAM_WINDOW_DAYS`; ties by subject. */
function nextExamFrom(date: DateStr, exams: Exam[], zone: string): NextExam | null {
  const candidates = exams
    .filter((e) => e.date >= date)
    .map((exam) => ({ exam, daysAway: daysBetween(date, exam.date, zone) }))
    .filter((c) => c.daysAway <= NEXT_EXAM_WINDOW_DAYS)
    .sort((a, b) => a.daysAway - b.daysAway || a.exam.subject.localeCompare(b.exam.subject, 'he'));
  return candidates[0] ?? null;
}

/** How far ahead "the next school day" is looked for. */
export const NEXT_SCHOOL_DAY_WITHIN = 7;

/**
 * Whether school takes place on a day, by the rule the app's Today screen
 * uses (`noSchoolDay` in app/src/lib/today.ts): a school day by the calendar,
 * except a Friday with no lessons on it. The calendar counts every Friday
 * that is not a holiday; most schools have none, and a Friday without a
 * timetable is not where "the next school day" lands.
 */
export function holdsSchool(day: Pick<DayView, 'date' | 'isSchoolDay' | 'timeline'>, zone: string): boolean {
  if (!day.isSchoolDay) return false;
  return sundayIndex(day.date, zone) !== 5 || day.timeline.some((i) => i.kind === 'lesson');
}

/**
 * "יום הלימודים הבא": the first of `days` after `from`, within
 * `NEXT_SCHOOL_DAY_WITHIN` days, that holds school; null when none of them
 * does (a long break, or days the caller did not load).
 */
export function nextSchoolDay(from: DateStr, days: readonly DayView[], zone: string): DayView | null {
  const until = addDays(from, NEXT_SCHOOL_DAY_WITHIN, zone);
  return days
    .filter((d) => d.date > from && d.date <= until && holdsSchool(d, zone))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0] ?? null;
}

function byHomeworkOrder(a: HomeworkItem, b: HomeworkItem): number {
  return a.subject.localeCompare(b.subject, 'he') || (a.naturalKey < b.naturalKey ? -1 : a.naturalKey > b.naturalKey ? 1 : 0);
}

export interface WeekInputs {
  offset: number;
  startDate: DateStr;
  zone: string;
  now: Date;
  days: DayView[];
  exams: Exam[];
  schoolEvents: SchoolEvent[];
}

export function buildWeekView(input: WeekInputs): WeekView {
  return {
    offset: input.offset,
    startDate: input.startDate,
    endDate: addDays(input.startDate, 5, input.zone),
    days: input.days,
    exams: input.exams,
    schoolEvents: input.schoolEvents,
    generatedAt: DateTime.fromJSDate(input.now).setZone(input.zone).toISO()!,
  };
}

export interface AgendaInputs {
  /** Today; the first day listed and the origin of every exam's `daysAway`. */
  from: DateStr;
  /** The day views for `from` onward, one per day — the same ones `/day` and `/week` serve. */
  days: DayView[];
  zone: string;
  now: Date;
}

/**
 * The planning list ("הקרוב אליי"). Nothing here is loaded on its own: every
 * item is read off a day view, so the agenda cannot list an exam the week
 * hides or miss a task the day shows.
 */
export function buildAgendaView(input: AgendaInputs): AgendaView {
  const { from, zone } = input;
  const days = input.days
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((day): AgendaDay => ({ date: day.date, weekdayName: day.weekdayName, items: agendaItems(day, from, zone) }));
  return {
    from,
    to: days.length > 0 ? days[days.length - 1]!.date : from,
    days,
    generatedAt: DateTime.fromJSDate(input.now).setZone(zone).toISO()!,
  };
}

/** Kinds in the contract's order: exam, homework, task, event, calendar. */
function agendaItems(day: DayView, from: DateStr, zone: string): AgendaItem[] {
  const exams = day.examsToday
    .slice()
    .sort((a, b) => a.subject.localeCompare(b.subject, 'he'))
    .map((exam): AgendaItem => ({ kind: 'exam', exam, daysAway: daysBetween(from, exam.date, zone) }));
  const homework = day.homework.map((h): AgendaItem => ({ kind: 'homework', homework: h }));
  const tasks = day.timeline
    .filter((i): i is Extract<TimelineItem, { kind: 'task' }> => i.kind === 'task')
    .map((i) => i.task)
    .sort((a, b) => a.title.localeCompare(b.title, 'he'))
    .map((task): AgendaItem => ({ kind: 'task', task }));
  const schoolEvents = day.events.map((event): AgendaItem => ({ kind: 'event', event }));
  // Already in timeline order: all-day first, then by start time.
  const calendar = day.timeline
    .filter((i): i is Extract<TimelineItem, { kind: 'event' }> => i.kind === 'event')
    .map((i): AgendaItem => ({ kind: 'calendar', event: i.event }));
  return [...exams, ...homework, ...tasks, ...schoolEvents, ...calendar];
}

export interface WidgetInputs {
  /** Today. */
  day: DayView;
  /**
   * The days the schedule widget pages through, today among them, ascending.
   * Defaults to today alone.
   */
  days?: DayView[];
  zone: string;
  now: Date;
  /** All open tasks, any due date, for the tasks widget. */
  openTasks: Task[];
  /** Upcoming exams from today onwards, ascending. */
  upcomingExams: Exam[];
}

/** How many exams the main widget lists. */
const UPCOMING_EXAMS = 3;

export function buildWidgetFeed(input: WidgetInputs): WidgetFeed {
  const { day, zone } = input;
  const nowDt = DateTime.fromJSDate(input.now).setZone(zone);

  const exams = input.upcomingExams
    .filter((e) => e.date >= day.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => widgetExam(e, daysBetween(day.date, e.date, zone)));

  const openTasks = input.openTasks
    .slice()
    .sort(byDueSoonest)
    .map((t): WidgetTask => ({ id: t.id, title: t.title, due: t.due, listTitle: t.listTitle }));

  const toWidgetDay = (d: DayView): WidgetDay => widgetDay(d, openTasks, (date) => daysBetween(day.date, date, zone));
  const days = (input.days ?? [day])
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(toWidgetDay);

  const today = days.find((d) => d.date === day.date) ?? toWidgetDay(day);

  // From the same day views the window carries, so the widget and Today agree:
  // today through the next school day — on a Thursday, Sunday's homework, not
  // only Friday's (W4-1). Without a school day in the window, through tomorrow.
  const around = input.days ?? [];
  const dueUntil = nextSchoolDay(day.date, around, zone)?.date ?? addDays(day.date, 1, zone);
  const dueSoon = [day, ...around.filter((d) => d.date > day.date && d.date <= dueUntil)];
  const homeworkDue = dueSoon
    .flatMap((d) => d.homework)
    // Homework already turned into a task shows as that task, not twice.
    .filter((h): h is HomeworkItem & { dueDate: DateStr } => !h.done && h.linkedTaskId === null && h.dueDate !== null)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : byHomeworkOrder(a, b)))
    .map((h): WidgetHomework => ({
      key: h.naturalKey,
      subject: h.subject,
      // Only with a name of the student's own, so other feeds stay as they were.
      ...(h.originalSubject !== undefined ? { originalSubject: h.originalSubject } : {}),
      text: h.text,
      due: h.dueDate,
    }));

  const nextEvent = day.timeline
    .filter((i): i is Extract<TimelineItem, { kind: 'event' }> => i.kind === 'event')
    .map((i) => i.event)
    .filter((e) => e.allDay || DateTime.fromISO(e.start, { zone }) >= nowDt)
    .sort((a, b) => (a.start < b.start ? -1 : 1))[0];

  return {
    date: day.date,
    weekdayName: day.weekdayName,
    hebrewDate: day.hebrewDate,
    lessons: today.lessons,
    nextEvent: nextEvent ? { summary: nextEvent.summary, start: nextEvent.start } : null,
    tasksDueToday: today.tasksDue.map((t) => ({ id: t.id, title: t.title })),
    openTasks,
    openTaskCount: openTasks.length,
    nextExam: exams[0] ?? null,
    upcomingExams: exams.slice(0, UPCOMING_EXAMS),
    homeworkDue,
    changeCount: day.changeCount,
    days,
    generatedAt: nowDt.toISO()!,
  };
}

/**
 * An exam as the widgets carry it: `subjectName` only on one named by the
 * student's name for its subject, `named` only on one they gave a name of its
 * own, both on the phone, so other feeds stay as they were.
 */
function widgetExam(e: Exam, daysAway: number): WidgetExam {
  const exam: WidgetExam = { subject: e.subject, date: e.date, daysAway };
  if (e.subjectName !== undefined) return { ...exam, subjectName: e.subjectName };
  return e.originalSubject !== undefined ? { ...exam, named: true } : exam;
}

function widgetDay(day: DayView, openTasks: WidgetTask[], daysFromToday: (date: DateStr) => number): WidgetDay {
  return {
    date: day.date,
    weekdayName: day.weekdayName,
    hebrewDate: day.hebrewDate,
    isSchoolDay: day.isSchoolDay,
    holidayName: day.holidayName,
    lessons: day.timeline
      .filter((i): i is Extract<TimelineItem, { kind: 'lesson' }> => i.kind === 'lesson')
      .map(({ lesson }): WidgetLesson => ({
        hourIndex: lesson.hourIndex,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        subject: lesson.subject,
        // The source's name, which the lesson's colour goes by; only with a name of the student's own.
        ...(lesson.originalSubject !== undefined ? { originalSubject: lesson.originalSubject } : {}),
        status: lesson.status,
        detail: widgetDetail(lesson),
      })),
    events: day.timeline
      .filter((i): i is Extract<TimelineItem, { kind: 'event' }> => i.kind === 'event')
      .map(({ event }): WidgetEvent => ({ summary: event.summary, start: event.start, end: event.end, allDay: event.allDay })),
    tasksDue: openTasks.filter((t) => t.due === day.date),
    exams: day.examsToday.map((e) => widgetExam(e, daysFromToday(e.date))),
    changeCount: day.changeCount,
  };
}

function widgetDetail(lesson: Lesson): string | null {
  if (lesson.status === 'substitution' && lesson.substitute) return `מ״מ: ${lesson.substitute}`;
  if (lesson.status === 'cancelled') return lesson.note ?? 'מבוטל';
  if (lesson.note) return lesson.note;
  return lesson.room ?? lesson.teacher;
}

export function byDueSoonest(a: Task, b: Task): number {
  if (a.due === b.due) return a.title < b.title ? -1 : 1;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  return a.due < b.due ? -1 : 1;
}

export function daysBetween(from: DateStr, to: DateStr, zone: string): number {
  // Plain dates are counted apart without the zone (`calendarDay`), as Luxon would have counted them.
  const a = calendarDay(from, zone);
  const b = calendarDay(to, zone);
  if (a !== null && b !== null) return b - a;
  return Math.round(atTime(to, '00:00', zone).diff(atTime(from, '00:00', zone), 'days').days);
}
