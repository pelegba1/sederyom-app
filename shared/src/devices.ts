/**
 * The many-students API (plan Phase 2), under `/v2`. A device holds its own
 * token; the server knows the device's class and what it wants pushed, and
 * nothing of the student's own: Mashov and Google stay on the phone.
 */
import type { ClassOption } from './api';
import type { DateStr, LessonStatus, ScheduleChange } from './domain';
import type { SchoolDayOff } from './logic/time';
import { DEFAULT_SETTINGS, type QuietHours } from './settings';

/** The pushes the server can send a device: news from the class's Shahaf site. */
export const DEVICE_NOTIFICATION_TYPES = ['schedule_change_tomorrow', 'schedule_change_today', 'new_exam'] as const;
export type DeviceNotificationType = (typeof DEVICE_NOTIFICATION_TYPES)[number];

export interface DevicePrefs {
  notifications: Record<DeviceNotificationType, boolean>;
  quietHours: QuietHours;
  /** "חופש": no school pushes until it is switched off. */
  vacationMode: boolean;
  /**
   * The class's lines that are not this student's (`LessonFilter.hiddenSubjects`):
   * a subject as the site prints it, or `subject @ teacher`.
   */
  hiddenSubjects: string[];
  /**
   * The student's own names for subjects (`LessonFilter.subjectNames`): key → name,
   * for the pushes to speak in. A write that carries it replaces the whole map.
   */
  subjectNames: Record<string, string>;
}

export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  notifications: { schedule_change_tomorrow: true, schedule_change_today: true, new_exam: true },
  quietHours: DEFAULT_SETTINGS.quietHours,
  vacationMode: false,
  hiddenSubjects: [],
  subjectNames: {},
};

export type DevicePlatform = 'android' | 'ios';

/** `POST /v2/devices`. */
export interface RegisterDeviceBody {
  platform: DevicePlatform;
}

/** The token is shown once; the server keeps only its hash. */
export interface RegisterDeviceResponse {
  deviceId: string;
  token: string;
}

/** The class a device follows, as the device chose it. */
export interface DeviceClass {
  /** The school's Shahaf site, `https://<school>.shahaf.site`. */
  siteUrl: string;
  /** The site's `cls` value. */
  classId: string;
  className: string;
  /** The grade's exam calendar the class follows, a public Google calendar id; `null` when none is known. */
  examCalendarId?: string | null;
  /** The class's exam board, a Google calendar or rows brought from a page or a file; `null`/missing: none. */
  examBoard?: ExamBoardInfo | null;
}

/**
 * The classes one device follows, at most: its own and five more, a parent's
 * six children (parents mode, stage 2). A bound, not a need: the server reads
 * a few classes a tick for every device together (`CLASS_POLLS_PER_TICK`).
 */
export const MAX_FOLLOWED_CLASSES = 6;

/** A class a device follows besides its own, with that class's lines that are not this child's. */
export interface FollowedClass extends DeviceClass {
  hiddenSubjects: string[];
}

/** `GET /v2/device`. */
export interface DeviceResponse {
  deviceId: string;
  platform: DevicePlatform;
  class: DeviceClass | null;
  prefs: DevicePrefs;
  hasPushToken: boolean;
  /** The classes it follows besides `class`. Missing from a server from before parents mode's stage 2. */
  otherClasses?: FollowedClass[];
}

/** `PUT /v2/device`: any subset. `class: null` stops following a class. */
export interface UpdateDeviceBody {
  pushToken?: string | null;
  class?: DeviceClass | null;
  prefs?: Partial<Omit<DevicePrefs, 'notifications' | 'quietHours'>> & {
    notifications?: Partial<Record<DeviceNotificationType, boolean>>;
    quietHours?: Partial<QuietHours>;
  };
  /** Mashov's school id, when the device knows it. Informational. */
  semel?: number;
  /**
   * The grade's exam calendar for the device's class: its Google calendar id,
   * or the embed URL the school site's exam page carries. `null` clears it.
   */
  examCalendar?: string | null;
}

/**
 * `PUT /v2/device/classes`: every class the device follows besides its own
 * (`class` of `PUT /v2/device`), replacing the ones before; `[]` follows none.
 * Its own class, if listed, is skipped.
 */
export interface UpdateDeviceClassesBody {
  classes: { siteUrl: string; classId: string; hiddenSubjects?: string[]; subjectNames?: Record<string, string> }[];
}

/**
 * `GET /v2/calendar`: the Ministry's vacations as the server's build has them
 * (`SCHOOL_DAYS_OFF`), for a phone whose own copy is older. No token needed.
 */
export interface SchoolCalendarResponse {
  revision: number;
  daysOff: SchoolDayOff[];
}

/** `GET /v2/classes?site=`: the school site's class list. */
export interface ClassListResponse {
  siteUrl: string;
  classes: ClassOption[];
}

/** One lesson as the class's site publishes it. */
export interface ClassLesson {
  date: DateStr;
  hourIndex: number;
  startTime: string | null;
  endTime: string | null;
  subject: string;
  teacher: string | null;
  room: string | null;
  status: LessonStatus;
  substitute: string | null;
  note: string | null;
}

export interface ClassDatedItem {
  naturalKey: string;
  date: DateStr | null;
}

export interface ClassExam extends ClassDatedItem {
  subject: string;
  details: string | null;
  /** `shahaf`: the class's site. `school_site`: the grade's exam calendar. */
  source?: 'shahaf' | 'school_site';
}

export interface ClassEvent extends ClassDatedItem {
  title: string;
  details: string | null;
}

export interface ClassMessage extends Omit<ClassDatedItem, 'date'> {
  date: string | null;
  title: string;
  body: string;
}

/**
 * How many days back the class feed reaches: its dated lessons, changes, exams and events are from this many days
 * before today on. The server dates the feed by it, and the phone counts on it (an exam dated inside it and absent
 * from the feed was taken off the school's list; one older is simply out of the feed).
 */
export const CLASS_FEED_PAST_DAYS = 7;

/**
 * One lesson that has passed, as it was when it began (year wrapped). `observed`:
 * the server was reading the class's site at the time, so `status` is what
 * happened. `backfill`: read from the site afterwards, which keeps the regular
 * grid and almost none of its changes, so it says what was scheduled and must
 * never be counted as a change or as the lack of one.
 */
export interface ClassHistoryLesson extends Omit<ClassLesson, 'status'> {
  /** null: the lesson had no start time to judge its state by. */
  status: LessonStatus | null;
  source: 'observed' | 'backfill';
  /** When the change was first seen (ISO); null for a regular lesson and for every `backfill` row. */
  changeSeenAt: string | null;
}

/** `GET /v2/class/history`: the device's class through the school year so far. `?from=` narrows the rows only. */
export interface ClassHistory {
  class: DeviceClass;
  /**
   * What the server holds for the class this school year, whatever `from` asked for: the first
   * day with observed rows, and the first and last day with any row. null where there is none.
   */
  coverage: { observedFrom: DateStr | null; from: DateStr | null; to: DateStr | null };
  lessons: ClassHistoryLesson[];
  /** The exams whose day has passed. */
  exams: ClassExam[];
}

/**
 * `GET /v2/class/feed`: everything the class's site says, as the server last
 * read it. The merge with the student's own Mashov timetable happens on the
 * phone. `?site=&cls=` asks for another class the device follows
 * (`otherClasses`); a server from before parents mode's stage 2 ignores them
 * and answers with the device's own class, so the phone checks `class`.
 */
export interface ClassFeed {
  class: DeviceClass;
  /** Last successful read of the site; `null` before the first one. */
  lastOkAt: string | null;
  /** The site's own "מעודכן ל". */
  freshness: string | null;
  lessons: ClassLesson[];
  changes: ScheduleChange[];
  exams: ClassExam[];
  /**
   * The class site's (`shahaf`) exams that `exams` leaves out because the class's exam board lists them too
   * (`withoutSiteTwins`), dated by the same rule as `exams`; absent when there are none, and from a server from
   * before the phone's own exam board. A phone that lays a board of its own over the class's puts them back
   * (`withOwnBoard`); the others never read them.
   */
  siteTwins?: ClassExam[];
  events: ClassEvent[];
  messages: ClassMessage[];
}

/**
 * One period of one teacher's day, gathered from every class timetable on the
 * school's Shahaf site (`GET /v2/teachers`). The site has no teacher view: a
 * group drawn from several classes is printed in each of them, and is one
 * period here, with all of its classes.
 */
export interface TeacherPeriod {
  hourIndex: number;
  startTime: string | null;
  endTime: string | null;
  subject: string;
  /** The classes whose timetables list it, as the site names them. */
  classes: string[];
  /** Only when the site says (a fill-in's or an exam's room); a regular lesson has none. */
  room: string | null;
  /**
   * `regular`, `exam`, `moved`…: the teacher is there. `cancelled`: no lesson.
   * `substitution` with `coveredBy`: another teacher gives this teacher's lesson.
   * `substitution` with `covering`: this teacher gives another's lesson, or fills a free period.
   */
  status: LessonStatus;
  /** Who gives this teacher's lesson instead, when the site names them. */
  coveredBy: string | null;
  /** Whose lesson this teacher gives; `''` for a fill-in that names no one. */
  covering: string | null;
  note: string | null;
}

export interface TeacherDay {
  /** As the site prints it: family name first ("פינטו ציפי"). */
  name: string;
  /** By period. */
  periods: TeacherPeriod[];
}

/**
 * `GET /v2/teachers[?site=]`: today's day of every teacher at a school the
 * device follows a class at. `date` is null on a day the site shows no lessons
 * (a Saturday, a holiday): then `teachers` is empty.
 */
export interface TeachersResponse {
  siteUrl: string;
  date: DateStr | null;
  /** When the server read the site for this answer. */
  readAt: string;
  teachers: TeacherDay[];
}

/*
 * The exam board: a class's exam schedule brought from a page link or an Excel
 * file instead of typed in (`POST /v2/device/exam-board/preview`, then a save).
 * A preview says what the server found and changes nothing.
 */

/** One row of a board as read, before the student has looked at it. */
export interface BoardRow {
  date: DateStr;
  title: string;
  details: string | null;
  /** Whether the row looks like an exam, as opposed to a trip or a holiday on the same board. */
  isExam: boolean;
}

/** Text of a board that could not be made a row. */
export interface BoardSkipped {
  text: string;
  reason: 'date' | 'out_of_year';
}

/** A public Google calendar a page link led to. */
export interface CalendarPreview {
  calendarId: string;
  name: string | null;
  count: number;
  /** The first exams still ahead, to recognise the calendar by. */
  upcoming: { date: DateStr; subject: string }[];
}

/** What the server found at a link or in a file. */
export type ExamBoardPreview =
  | { kind: 'calendar'; calendars: CalendarPreview[] }
  | { kind: 'rows'; layout: 'list' | 'grid'; rows: BoardRow[]; skipped: BoardSkipped[] }
  | { kind: 'columns'; columns: string[] };

/** `POST /v2/device/exam-board/preview`: exactly one of `link` and `file`; `column` answers a `columns` preview. */
export interface ExamBoardPreviewBody {
  link?: string;
  file?: { name: string; base64: string };
  column?: string;
}

/** Why a preview or a save was refused; the `error` of a 422 (`no_class`: 409, `rate_limited`: 429). */
export const EXAM_BOARD_ERRORS = [
  'no_class', 'unreachable', 'no_board', 'private_sheet', 'unsupported_file', 'too_big', 'unknown_layout', 'rate_limited', 'bad_rows',
] as const;
export type ExamBoardError = (typeof EXAM_BOARD_ERRORS)[number];

/** The rows a student confirmed, to save as the class's board. */
export interface SaveExamBoardBody {
  rows: { date: DateStr; title: string; details: string | null }[];
}

/** A class's exam board as a device sees it. */
export interface ExamBoardInfo {
  kind: 'calendar' | 'upload';
  /** When it was last set; `null` only for a calendar set before the board had a time of its own. */
  setAt: string | null;
  /** How many exams the class has from it; a calendar that was just set and is not read yet has none. */
  count: number;
  /** Whether this device is the one that brought it. */
  mine: boolean;
  /**
   * Whether this device's save would be let through now: it brought the board, or the one that did has left the
   * class (or there is none on record), and the class is the device's own. `false` for a class the device only
   * follows, as a board is set only on a device's own class. Not the same as `mine`: a classmate may replace a
   * board whose setter is gone, though it is not theirs.
   */
  mayChange: boolean;
}

/** Merges a prefs patch over the current prefs (or the defaults). */
export function mergeDevicePrefs(current: unknown, patch: UpdateDeviceBody['prefs'] = {}): DevicePrefs {
  const c = (current ?? {}) as Partial<DevicePrefs>;
  return {
    ...DEFAULT_DEVICE_PREFS,
    ...c,
    ...patch,
    notifications: { ...DEFAULT_DEVICE_PREFS.notifications, ...(c.notifications ?? {}), ...(patch.notifications ?? {}) },
    quietHours: { ...DEFAULT_DEVICE_PREFS.quietHours, ...(c.quietHours ?? {}), ...(patch.quietHours ?? {}) },
    hiddenSubjects: patch.hiddenSubjects ?? c.hiddenSubjects ?? DEFAULT_DEVICE_PREFS.hiddenSubjects,
    // Replaced whole when the patch has it, like `hiddenSubjects`: never merged key by key.
    subjectNames: patch.subjectNames ?? c.subjectNames ?? DEFAULT_DEVICE_PREFS.subjectNames,
  };
}
