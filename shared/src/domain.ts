/**
 * Core domain types shared by server and app.
 * Dates are ISO strings. Calendar days are `YYYY-MM-DD` in Asia/Jerusalem.
 * Times of day are `HH:mm` in Asia/Jerusalem.
 */

/**
 * `school_site` is the school's own website (e.g. `<school>.mashov.info`),
 * which publishes the grade's exam schedule as a public Google calendar —
 * distinct from `shahaf`, the timetable site.
 */
export const SOURCES = ['google_calendar', 'google_tasks', 'mashov', 'shahaf', 'school_site', 'google_classroom'] as const;
export type Source = (typeof SOURCES)[number];

/** Calendar day in Asia/Jerusalem, `YYYY-MM-DD`. */
export type DateStr = string;
/** Time of day in Asia/Jerusalem, `HH:mm`. */
export type TimeStr = string;
/** Absolute instant, ISO-8601 with offset. */
export type Instant = string;

export const LESSON_STATUSES = ['regular', 'cancelled', 'substitution', 'moved', 'exam', 'event', 'remote'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export interface Lesson {
  date: DateStr;
  /** Period number as published by the school (0..10). */
  hourIndex: number;
  startTime: TimeStr | null;
  endTime: TimeStr | null;
  subject: string;
  teacher: string | null;
  room: string | null;
  status: LessonStatus;
  /** Substitute teacher name, when `status === 'substitution'`. */
  substitute: string | null;
  /** Free-text note carried from the change row ("הועבר משיעור 7"). */
  note: string | null;
  source: Source;
  /**
   * When the server first saw this lesson's change published (a cancellation,
   * a substitute, a move) — what "השינוי פורסם ב־…" shows. `null` for a
   * regular lesson, and for a change the server cannot date.
   */
  changeSeenAt: Instant | null;
  /**
   * Set only on the phone, when the student gave the subject a name of their
   * own (shared/logic/ownNames.ts): `subject` is then their name, shown
   * everywhere, and this the name the source gave the lesson, which hiding,
   * colours and matching still go by. Never set by the server's feed.
   */
  originalSubject?: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  /** Display name of the calendar the event lives in, when the server knows it. */
  calendarName: string | null;
  /** For one occurrence of a recurring event: the id the whole series shares. */
  seriesId: string | null;
  summary: string;
  location: string | null;
  start: Instant;
  end: Instant;
  allDay: boolean;
}

export interface Task {
  id: string;
  listId: string;
  listTitle: string | null;
  title: string;
  notes: string | null;
  /** Google Tasks only carries a date for due, no time. */
  due: DateStr | null;
  completed: boolean;
  updated: Instant | null;
  /** Set when this task was created from a Mashov homework item. */
  linkedHomeworkKey: string | null;
}

export interface Exam {
  naturalKey: string;
  date: DateStr;
  subject: string;
  details: string | null;
  source: Source;
  /**
   * A bagrut exam from Mashov's own list (plan §14.9): it comes with its hours.
   * `manual`: one the student added on the phone. Absent on the grade's schedule.
   */
  kind?: 'bagrut' | 'manual';
  startTime?: TimeStr | null;
  endTime?: TimeStr | null;
  /**
   * Set only on the phone, when the student gave the exam a name of their own
   * (app/src/local/examPrefs.ts): `subject` is then their name, shown
   * everywhere, and this the name its source gave it, which matching ("is
   * this exam mine?", its subject group) still goes by. Never set by the server.
   */
  originalSubject?: string;
  /**
   * Set only on the phone, when the student moved the exam to a date of their
   * own (app/src/local/examPrefs.ts): `date` is then theirs, shown and
   * scheduled everywhere, and this the date its source gave it, which matching
   * (twins, "is this exam mine?", a friend's comparison, what is sent to a
   * friend) still goes by. Never set by the server.
   */
  originalDate?: DateStr;
  /**
   * Set with `originalSubject` when the name came from the subject's own name
   * (shared/logic/ownNames.ts), not from this exam's: the name that replaced
   * the subject's words in the title. A name given to this exam alone leaves
   * it unset, and wins over this one.
   */
  subjectName?: string;
}

export interface Homework {
  naturalKey: string;
  dueDate: DateStr | null;
  subject: string;
  text: string;
  /** Google Task id, when the user turned this into a task. */
  linkedTaskId: string | null;
  /** Set only on the phone, with the student's own name in `subject`: the name Mashov gave it. */
  originalSubject?: string;
}

export interface Grade {
  naturalKey: string;
  date: DateStr;
  subject: string;
  /** Numeric grade when the source gives one; some entries are textual. */
  value: number | null;
  valueText: string | null;
  weight: number | null;
  notes: string | null;
  /** When this grade was first seen (on the phone: app `mashov/gradeFirstSeen.ts`), null when unknown — drives the "new since last visit" marker. */
  firstSeen: Instant | null;
  /** Set only on the phone, with the student's own name in `subject`: the name Mashov gave it. */
  originalSubject?: string;
}

export interface SchoolMessage {
  naturalKey: string;
  source: Source;
  date: Instant;
  title: string;
  body: string;
  from: string | null;
  /**
   * True when the source gave no send time and `date` is when the server first
   * saw the message (plan §14.1): the app says "התקבלה", not "נשלחה".
   */
  dateIsFirstSeen?: boolean;
  /** Mashov's body not read yet; search sees only the title and sender. */
  bodyPending?: boolean;
}

export interface SchoolEvent {
  naturalKey: string;
  date: DateStr;
  title: string;
  details: string | null;
  source: Source;
}

/** One published change row from the Shahaf `changes` tab. */
export interface ScheduleChange {
  naturalKey: string;
  date: DateStr;
  hourIndex: number | null;
  kind: 'cancelled' | 'substitution' | 'moved' | 'remote' | 'exam' | 'event' | 'other';
  subject: string | null;
  text: string;
}
