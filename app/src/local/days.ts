/**
 * Days built on the phone, from what the phone keeps (plan Phase 2e). The
 * server's `loadDays` reads its tables; this reads the phone's stores and
 * maps them to the same domain lists, then calls the same `assembleDays`.
 *
 * | What          | From                                                                 |
 * |---------------|----------------------------------------------------------------------|
 * | Lessons       | `planLessonRows` over the class feed's lessons and Mashov's grid,    |
 * |               | with Mashov's own timetable changes on the days the grid fills       |
 * | Events        | Google `calendar_event`, named by `calendar`, cancelled ones dropped  |
 * | Tasks         | Google `task`, open and not deleted, due within the span             |
 * | Exams         | the feed's (site and exam calendar), Mashov's, bagrut, deduplicated,  |
 * |               | then under the student's own names and dates for them (`examPrefs.ts`) |
 * | School events | the feed's                                                           |
 * | Homework      | Mashov's, due by `deriveDueDate` over the same lessons               |
 * | Settings      | the student's, kept on the phone (`userSettings.ts`)                 |
 *
 * The days `assembleDays` built are then named by the student's names for
 * subjects (`subjectNames.ts`): after everything that hides, dedupes or
 * matches by the sources' names, never before.
 *
 * How it differs from the days the server once built for the owner:
 * - The grade's exam calendar (`school_site`) arrives only once the class has one set.
 * - `changeSeenAt` is when the phone first saw a change (`changes.ts`), on the site or in Mashov.
 * - Homework `done` / `linkedTaskId` are the phone's own (`homeworkState.ts`), and a task's
 *   `linkedHomeworkKey` is read back off them: the task a homework item points at points back at it.
 * - The "בית ספר" and exam calendars are the ones the phone knows (`deviceCalendars`).
 * - A week the site withdrew is refilled from Mashov's grid: the feed has no tombstones.
 */
import type {
  BagrutExam, CalendarEvent, ClassFeed, DateStr, DayView, Exam, ExamOption, HomeworkItem, Lesson, LessonStatus, SchoolEvent, Source, Task, UserSettings,
} from '@sederyom/shared';
import { NEXT_EXAM_WINDOW_DAYS, seriesIdOf } from '@sederyom/shared';
import { assembleDays } from '@sederyom/shared/logic/assemble';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import { withoutSiteTwins, type OwnerLessons } from '@sederyom/shared/logic/exam-match';
import type { TimetableLine } from '@sederyom/shared/logic/filters';
import type { NormalizedCalendar, NormalizedCalendarEvent } from '@sederyom/shared/logic/google/calendar';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import { deriveDueDate, type HomeworkPayload } from '@sederyom/shared/logic/homework';
import { bagrutEntities, isBagrutKey, withoutBagrutDuplicates } from '@sederyom/shared/logic/mashov/bagrut';
import {
  LESSON_HORIZON, planLessonRows, type LessonRow, type ShahafSighting, type TimetableChange, type TimetableSlot,
} from '@sederyom/shared/logic/merge';
import { examOptions } from '@sederyom/shared/logic/options';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { addDays, atTime, todayStr } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { changeKey, type ChangeSightings } from './changes';
import { keptExams, ownExam, type ExamPrefs } from './examPrefs';
import { isManualKey, type ManualExam } from './manualExams';
import { isOwnBoardFeed, type OwnBoard } from './ownBoard';
import type { HomeworkStates } from './homeworkState';
import { namedDays, namedExam, namesOfSources } from './subjectNames';

/** The calendar the phone mirrors exams into (`google/mirror.ts`). */
export const SCHOOL_CALENDAR_NAME = 'בית ספר';

export interface LocalSources {
  feed: ClassFeed | null;
  /** `mashov.read`'s entities. */
  mashov: readonly NormalizedEntity[];
  bagrut: readonly BagrutExam[];
  /** Exams the student added by hand (`manualExams.ts`). */
  manualExams?: readonly ManualExam[];
  /** The student's names and dates for exams, and the exams the Google calendar leaves out (`examPrefs.ts`). */
  examPrefs?: ExamPrefs;
  /** `google.kept`. */
  google: readonly KeptEntity[];
  settings: UserSettings;
  /**
   * The "בית ספר" calendar and the grade's exam calendar, if the student
   * subscribes to it in Google, as the phone knows them (`deviceCalendars`).
   * Their events are exams already, so neither reaches the timeline.
   */
  calendars?: LocalCalendars;
  /** When the phone first saw each change (`recordChanges`); without it no change is marked new. */
  changeSeen?: ChangeSightings;
  /** Homework the student ticked off or made a task of (`homeworkState.ts`). */
  homeworkState?: HomeworkStates;
  /** What the student brings to each subject (`packList.ts`), for the evening reminder's bag line. */
  pack?: Readonly<Record<string, string>>;
  zone: string;
  now: Date;
}

export interface LocalCalendars {
  school: string | null;
  /** The exam calendar the student's class follows. */
  exam: string | null;
  /**
   * The calendar the phone's own exam board reads, when that is a calendar (`ownBoard.ts`): kept off the timeline
   * beside the class's, which stays off whatever the student's board is.
   */
  ownExam?: string | null;
}

/** Every exam calendar to keep off the timeline and to mark in Settings: the class's and, if there is one, the phone's own. */
export function examCalendarIds(calendars: LocalCalendars | undefined): string[] {
  return [calendars?.exam, calendars?.ownExam].filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * A device's calendars to keep off the timeline: the "בית ספר" calendar the
 * phone keeps (`google/mirror.ts`; by its name until it has made one), and the
 * exam calendar its class follows, which the feed's exams already come from,
 * and the calendar the phone's own exam board reads when it is a calendar
 * (`ownBoard.ts`, `ownExam`). Without them, an exam calendar the student also
 * subscribes to in Google showed every exam twice. The class's calendar stays
 * off whatever the student's own board is: they may still follow it in Google,
 * and its events are not shown as events.
 */
export function deviceCalendars(mirrorCalendarId: string | null, feed: ClassFeed | null, own: OwnBoard | null = null): LocalCalendars {
  return { school: mirrorCalendarId, exam: feed?.class.examCalendarId ?? null, ...(own?.kind === 'calendar' ? { ownExam: own.calendarId } : {}) };
}

const ofKind = <T>(list: readonly { kind: string; payload: unknown }[], kind: string): T[] =>
  list.filter((e) => e.kind === kind).map((e) => e.payload as T);

function span(dates: readonly DateStr[], zone: string, today: DateStr): DateStr[] {
  const sorted = [...dates].sort();
  let from = addDays(today, -LESSON_HORIZON.back, zone);
  let to = addDays(today, LESSON_HORIZON.ahead, zone);
  if (sorted.length > 0 && sorted[0]! < from) from = sorted[0]!;
  if (sorted.length > 0 && sorted[sorted.length - 1]! > to) to = sorted[sorted.length - 1]!;
  const out: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1, zone)) out.push(d);
  return out;
}

function toLesson(row: LessonRow, seen: ChangeSightings | undefined): Lesson {
  const changeSeenAt = row.status !== 'regular' ? seen?.[changeKey(row)] ?? null : null;
  return {
    date: row.date,
    hourIndex: row.hourIndex,
    startTime: row.startTime,
    endTime: row.endTime,
    subject: row.subject,
    teacher: row.teacher,
    room: row.room,
    status: row.status as LessonStatus,
    substitute: row.substitute,
    note: row.note,
    source: row.source as Source,
    changeSeenAt,
  };
}

/** As the server does it: the stored string through a `Date`, then into the zone. */
function instant(value: string, zone: string): string {
  return DateTime.fromJSDate(new Date(value)).setZone(zone).toISO()!;
}

/**
 * Each kept event as the app shows it, made once: its two instants are the
 * zone's, and the zone is slow to ask. By the payload, which stays the same
 * object while Google's read does (`loadLocalSources`), and so do the
 * calendars' names with it.
 */
const shownEvents = new WeakMap<NormalizedCalendarEvent, { zone: string; event: CalendarEvent }>();

function shownEvent(e: NormalizedCalendarEvent, zone: string, names: Map<string, string>): CalendarEvent {
  const kept = shownEvents.get(e);
  if (kept?.zone === zone) return kept.event;
  const event = toEvent(e, zone, names);
  shownEvents.set(e, { zone, event });
  return event;
}

function toEvent(e: NormalizedCalendarEvent, zone: string, names: Map<string, string>): CalendarEvent {
  return {
    id: e.googleId,
    calendarId: e.calendarId,
    calendarName: names.get(e.calendarId) ?? null,
    seriesId: seriesIdOf(e.googleId),
    summary: e.summary,
    location: e.location,
    start: instant(e.start, zone),
    end: instant(e.end, zone),
    allDay: e.allDay,
  };
}

/** A kept Google task as the app shows it. */
export function toTask(t: NormalizedTask): Task {
  return {
    id: t.googleId,
    listId: t.listId,
    listTitle: t.listTitle,
    title: t.title,
    notes: t.notes,
    due: t.due,
    completed: t.completed,
    updated: t.updated ? new Date(t.updated).toISOString() : null,
    linkedHomeworkKey: null,
  };
}

/**
 * Task id → the homework made into it, from the homework's side
 * (`linkedTaskId`): the server keeps both ends of the link, the phone only
 * this one. The evening reminder names such a task by its homework, as the
 * server's does, and the week's "להגשה" counts it as homework.
 */
function homeworkByTask(states: HomeworkStates | undefined): Map<string, string> {
  const byTask = new Map<string, string>();
  for (const [key, state] of Object.entries(states ?? {})) {
    if (state.linkedTaskId) byTask.set(state.linkedTaskId, key);
  }
  return byTask;
}

interface ExamRow {
  naturalKey: string;
  date: DateStr;
  subject: string;
  details: string | null;
  source: Source;
  startTime?: string | null;
  endTime?: string | null;
}

/**
 * What the sources list, before any twin is taken out: one row for each exam with a date, and the key of every exam
 * they list, a dateless one and a twin included (`listedExamKeys`).
 */
function listedRows(
  feed: ClassFeed | null,
  mashov: readonly NormalizedEntity[],
  bagrut: readonly BagrutExam[],
  today: DateStr,
  manual: readonly ManualExam[] = [],
): { rows: ExamRow[]; keys: Set<string> } {
  const rows: ExamRow[] = manual.map((e) => ({ naturalKey: e.naturalKey, date: e.date, subject: e.subject, details: e.details, source: 'mashov' as Source }));
  for (const e of feed?.exams ?? []) {
    if (e.date) rows.push({ naturalKey: e.naturalKey, date: e.date, subject: e.subject, details: e.details ?? null, source: e.source ?? 'shahaf' });
  }
  for (const e of mashov.filter((m) => m.kind === 'exam')) {
    const p = e.payload as { date: DateStr; subject: string; details: string | null };
    rows.push({ naturalKey: e.naturalKey, date: p.date, subject: p.subject, details: p.details ?? null, source: 'mashov' });
  }
  for (const e of bagrutEntities(bagrut, today)) {
    const p = e.payload as { date: DateStr; subject: string; details: string | null; startTime?: string | null; endTime?: string | null };
    rows.push({ naturalKey: e.naturalKey, date: p.date, subject: p.subject, details: p.details ?? null, source: 'mashov', startTime: p.startTime ?? null, endTime: p.endTime ?? null });
  }
  return { rows, keys: new Set([...rows.map((r) => r.naturalKey), ...(feed?.exams ?? []).map((e) => e.naturalKey)]) };
}

/**
 * The key of every exam the sources list now: the class feed (under the phone's own board when it has one), Mashov's
 * exams and bagrut, and the ones the student added. A copy kept of an exam stands in only for a key that is not here
 * (`keptExams`), and `forgetAbsentCopies` takes the copy of a key that is not here while the school's date is recent.
 */
export function listedExamKeys(src: Pick<LocalSources, 'feed' | 'mashov' | 'bagrut' | 'manualExams'>, today: DateStr): Set<string> {
  return listedRows(src.feed, src.mashov, src.bagrut, today, src.manualExams).keys;
}

/**
 * Every exam the sources list, on the sources' dates, each once; and the exams
 * the student moved that the sources no longer carry, from the copies kept with
 * their dates (`keptExams`, by `prefs` and `today`), on the school's date too,
 * after the twins are taken out: they go on from here as any exam does.
 */
function examRows(
  feed: ClassFeed | null,
  mashov: readonly NormalizedEntity[],
  bagrut: readonly BagrutExam[],
  today: DateStr,
  manual: readonly ManualExam[] = [],
  prefs?: ExamPrefs,
): ExamRow[] {
  const { rows, keys } = listedRows(feed, mashov, bagrut, today, manual);
  // A bagrut sitting the schedule also lists, then an exam both the site and the exam calendar list: once each.
  const listed = withoutSiteTwins(withoutBagrutDuplicates(rows));
  // Whatever a source lists is not the copy's to stand in for, whether twin detection dropped it or its date is empty.
  // With a board of the student's own over the class's, the class board's copies are hidden with it (and kept).
  const kept = keptExams(prefs, keys, today, { classBoardHidden: isOwnBoardFeed(feed) }).map((e): ExamRow => ({
    naturalKey: e.naturalKey, date: e.date, subject: e.subject, details: e.details, source: e.source,
  }));
  return kept.length === 0 ? listed : [...listed, ...kept];
}

/**
 * A row as the app's exam, under the student's name and on the student's date
 * for it when they gave them. After `withoutBagrutDuplicates` and
 * `withoutSiteTwins`, which compare the sources' names and dates: a renamed or
 * moved exam is still the same exam as its twin. So every filter by date runs
 * after this one, on the date the exam is shown on.
 */
function toExam(row: ExamRow, prefs: ExamPrefs | undefined): Exam {
  return ownExam(sourceExam(row), prefs);
}

function sourceExam(row: ExamRow): Exam {
  const exam: Exam = { naturalKey: row.naturalKey, date: row.date, subject: row.subject, details: row.details, source: row.source };
  if (isManualKey(row.naturalKey)) return { ...exam, kind: 'manual' };
  if (!isBagrutKey(row.naturalKey)) return exam;
  return { ...exam, kind: 'bagrut', startTime: row.startTime ?? null, endTime: row.endTime ?? null };
}

/** The class's published lines, as the server reads them off its lesson table. */
function timetableLines(lessons: readonly LessonRow[]): TimetableLine[] {
  const seen = new Map<string, TimetableLine>();
  for (const l of lessons) {
    if (l.source !== 'shahaf' || l.status === 'exam') continue;
    seen.set(`${l.subject}\u0000${l.teacher ?? ''}`, { subject: l.subject, teacher: l.teacher });
  }
  return [...seen.values()];
}

function homeworkFrom(src: LocalSources, rows: readonly LessonRow[]): HomeworkItem[] {
  return src.mashov
    .filter((e) => e.kind === 'homework')
    .map((e) => {
      const p = e.payload as HomeworkPayload;
      return {
        naturalKey: e.naturalKey,
        dueDate: deriveDueDate(p, rows as LessonRow[], src.zone, src.settings.lessons.hiddenSubjects),
        subject: p.subject,
        text: p.text,
        linkedTaskId: src.homeworkState?.[e.naturalKey]?.linkedTaskId ?? null,
        done: src.homeworkState?.[e.naturalKey]?.done ?? false,
      };
    });
}

/** The class feed's lessons, Mashov's grid and Mashov's changes to it, over `dates`. */
function lessonRows(src: LocalSources, dates: DateStr[]): LessonRow[] {
  const sightings: ShahafSighting[] = (src.feed?.lessons ?? []).map((lesson) => ({ date: lesson.date, lesson }));
  const slots = ofKind<TimetableSlot>(src.mashov, 'timetable_slot');
  return planLessonRows(dates, sightings, slots, src.zone, ofKind<TimetableChange>(src.mashov, 'timetable_change'));
}

/** The lesson rows the phone's days are built on, over the usual horizon. */
export function localLessonRows(src: LocalSources): LessonRow[] {
  return lessonRows(src, span([], src.zone, todayStr(src.zone)));
}

/** Every homework item Mashov has, due by the same lessons (the server's `GET /school` homework). */
export function localHomework(src: LocalSources): HomeworkItem[] {
  return homeworkFrom(src, localLessonRows(src));
}

/** The class's published lines, for the subject picker and the homework filter. */
export function localTimetableLines(src: LocalSources): TimetableLine[] {
  return timetableLines(localLessonRows(src));
}

export function buildLocalDays(src: LocalSources, dates: readonly DateStr[]): DayView[] {
  const { zone, settings } = src;
  const today = todayStr(zone);
  const rows = lessonRows(src, span(dates, zone, today));
  const first = [...dates].sort()[0] ?? today;
  const last = [...dates].sort().slice(-1)[0] ?? today;

  const calendars = ofKind<NormalizedCalendar>(src.google, 'calendar');
  const names = new Map(calendars.map((c) => [c.id, c.summary]));
  // By the server's word when it gave one; otherwise the mirror is known by its name.
  const schoolCalendar = src.calendars?.school ?? calendars.find((c) => c.summary === SCHOOL_CALENDAR_NAME)?.id ?? null;
  // Only what overlaps the dates asked for, by the instants `assembleDays` keeps an event on a day by.
  const spanStart = atTime(first, '00:00', zone).toMillis();
  const spanEnd = atTime(addDays(last, 1, zone), '00:00', zone).toMillis();
  const events = ofKind<NormalizedCalendarEvent>(src.google, 'calendar_event')
    .filter((e) => !e.cancelled && e.start !== '' && e.end !== '')
    .filter((e) => Date.parse(e.start) < spanEnd && Date.parse(e.end) > spanStart)
    .map((e) => shownEvent(e, zone, names));
  const madeFrom = homeworkByTask(src.homeworkState);
  const tasks = ofKind<NormalizedTask>(src.google, 'task')
    .filter((t) => !t.completed && !t.deleted && t.due !== null && t.due >= first && t.due <= last)
    .map((t) => ({ ...toTask(t), linkedHomeworkKey: madeFrom.get(t.googleId) ?? null }));

  const examsUntil = addDays(last, NEXT_EXAM_WINDOW_DAYS, zone);
  // By the date the exam is shown on: one the student moved into these days is on them, and one moved out is not.
  const exams = examRows(src.feed, src.mashov, src.bagrut, today, src.manualExams, src.examPrefs)
    .map((row) => toExam(row, src.examPrefs))
    .filter((e) => e.date >= first && e.date <= examsUntil);

  const schoolEvents: SchoolEvent[] = (src.feed?.events ?? [])
    .filter((e): e is typeof e & { date: DateStr } => e.date !== null)
    .map((e) => ({ naturalKey: e.naturalKey, date: e.date, title: e.title, details: e.details ?? null, source: 'shahaf' as Source }));

  const homework = homeworkFrom(src, rows);

  const days = assembleDays(
    {
      zone,
      now: src.now,
      settings,
      lessons: rows.map((row) => toLesson(row, src.changeSeen)),
      events,
      tasks,
      exams,
      schoolEvents,
      homework,
      calendarFilter: {
        hiddenCalendarIds: settings.calendars.hiddenCalendarIds,
        hiddenEventIds: settings.calendars.hiddenEventIds,
        schoolCalendarId: schoolCalendar,
        examCalendarId: src.calendars?.exam ?? null,
        examCalendarIds: examCalendarIds(src.calendars),
      },
      timetableLines: timetableLines(rows),
    },
    dates,
  );
  // Hidden, filtered and deduplicated by the sources' names above; shown under the student's.
  return namedDays(days, namesOfSources(src));
}


/** Every open task, due or not: the widget's task list (the server's `loadWidgetFeed`). */
export function localOpenTasks(src: Pick<LocalSources, 'google'>): Task[] {
  return ofKind<NormalizedTask>(src.google, 'task').filter((t) => !t.completed && !t.deleted).map(toTask);
}

/**
 * Every exam from `from` on, before the user's filters: what the widget's
 * upcoming list, the "בית ספר" calendar and the exam lists start from. Each
 * under the student's name for it, else their name for its subject, and on
 * the student's date for it: `from` and the order are theirs too, so an exam
 * moved from the past into the future is ahead and one moved the other way is not.
 */
export function localExamsFrom(
  src: Pick<LocalSources, 'feed' | 'mashov' | 'bagrut' | 'manualExams' | 'examPrefs' | 'settings'>,
  from: DateStr,
  today: DateStr,
): Exam[] {
  const names = namesOfSources(src);
  return examRows(src.feed, src.mashov, src.bagrut, today, src.manualExams, src.examPrefs)
    .map((row) => toExam(row, src.examPrefs))
    .filter((e) => e.date >= from)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((exam) => namedExam(exam, names));
}

/**
 * "המבחנים שלי" on the phone: `examOptions`, matched against the student's
 * lessons by the names and dates the sources gave the exams
 * (`originalSubject`, `originalDate`), so a name or a date of their own never
 * moves an exam to another subject or makes it "?". Each option is then shown
 * under the student's name and on the student's date, and keeps whether that
 * name was their subject's (`subjectName`).
 */
export function examOptionsAsPublished(exams: readonly Exam[], owner: OwnerLessons, settings: UserSettings): ExamOption[] {
  const published = exams.map(({ originalSubject, subjectName: _subjectName, originalDate, ...e }) => ({
    ...e, subject: originalSubject ?? e.subject, date: originalDate ?? e.date,
  }));
  const shown = new Map(exams.map((e) => [e.naturalKey, e]));
  return examOptions(published, owner, settings).map((option) => {
    const exam = shown.get(option.naturalKey);
    if (exam === undefined) return option;
    // Each independently: an exam may be moved and not renamed, or renamed and not moved.
    let own: ExamOption = option;
    if (exam.originalDate !== undefined) own = { ...own, date: exam.date, originalDate: exam.originalDate };
    if (exam.originalSubject === undefined) return own;
    const named = { ...own, subject: exam.subject, originalSubject: exam.originalSubject };
    return exam.subjectName === undefined ? named : { ...named, subjectName: exam.subjectName };
  });
}
