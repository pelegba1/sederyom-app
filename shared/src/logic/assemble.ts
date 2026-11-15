/**
 * Days as the user sees them, from what was read (plan Phase 2e).
 *
 * The second half of the server's `loadDays`, shared so the phone assembles
 * its days with the same rules: the class timetable minus the lessons that
 * are not the student's, the calendars minus what they hid, the exams minus
 * the ones they switched off, the homework minus hidden lessons' and what
 * became a task, and then one `buildDayView` per date. Filtering happens
 * before the views are built, so `changeCount`, the widget's span, the agenda
 * and the morning summary all describe the same filtered day.
 *
 * What each side reads, and how its rows become these domain lists, stays
 * with that side: the server's rows carry `Date` objects, the phone's carry
 * normalized payloads.
 */
import type { CalendarEvent, DateStr, DayView, Exam, HomeworkItem, Lesson, SchoolEvent, Task, UserSettings } from '../index';
import { NEXT_EXAM_WINDOW_DAYS } from '../index';
import { buildDayView } from './build';
import { filterEvents, filterExams, filterHomework, filterLessons, type EventFilter, type TimetableLine } from './filters';
import { addDays, atTime } from './time';

export interface DayInputs {
  zone: string;
  now: Date;
  settings: UserSettings;
  /** Every lesson of the span, each with its `changeSeenAt` where known. */
  lessons: Lesson[];
  events: CalendarEvent[];
  /** Open tasks due within the span. */
  tasks: Task[];
  /** Exams from the span's first day through `NEXT_EXAM_WINDOW_DAYS` past its last. */
  exams: Exam[];
  schoolEvents: SchoolEvent[];
  homework: HomeworkItem[];
  calendarFilter: EventFilter;
  /**
   * The class's published lines, for a hidden subject that has no lesson in
   * the span (`filterHomework`). Needed only when something is hidden and
   * there is homework; empty otherwise.
   */
  timetableLines: TimetableLine[];
}

export function assembleDays(input: DayInputs, dates: readonly DateStr[]): DayView[] {
  const { zone, settings } = input;
  const lessons = filterLessons(input.lessons, settings);
  const events = filterEvents(input.events, input.calendarFilter);
  const exams = filterExams(input.exams, settings);
  const homework = filterHomework(input.homework, settings, input.timetableLines);

  return dates.map((date) => {
    const dayStart = atTime(date, '00:00', zone).toMillis();
    const dayEnd = atTime(addDays(date, 1, zone), '00:00', zone).toMillis();
    const examsUntil = addDays(date, NEXT_EXAM_WINDOW_DAYS, zone);
    return buildDayView({
      date,
      zone,
      now: input.now,
      vacationMode: settings.vacationMode,
      lessons: lessons.filter((l) => l.date === date),
      // Starts before the day ends, ends after it starts.
      events: events.filter((e) => Date.parse(e.start) < dayEnd && Date.parse(e.end) > dayStart),
      tasks: input.tasks.filter((t) => t.due === date),
      exams: exams.filter((e) => e.date >= date && e.date <= examsUntil),
      schoolEvents: input.schoolEvents.filter((e) => e.date === date),
      homework: homework.filter((h) => h.dueDate === date),
    });
  });
}
