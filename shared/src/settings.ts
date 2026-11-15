import type { DateStr, TimeStr } from './domain';

export const NOTIFICATION_TYPES = [
  'schedule_change_tomorrow',
  'schedule_change_today',
  'new_exam',
  'new_homework',
  'new_grade',
  'teacher_message',
  'morning_summary',
  'evening_homework',
  /** The next lesson on the lock screen during the school day (ideas פ1): the phone's own, off until switched on. */
  'next_lesson',
  'sync_broken',
  'relogin_needed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Types the user may not switch off (design-doc §7 — silent failure is forbidden). */
export const UNDISABLEABLE: readonly NotificationType[] = ['sync_broken', 'relogin_needed'];

export interface QuietHours {
  enabled: boolean;
  /** Inclusive start, may wrap past midnight. */
  from: TimeStr;
  /** Exclusive end. */
  to: TimeStr;
}

/**
 * Which of the class's published lessons are actually the owner's (design-doc
 * §7). The school site shows the whole class's grid; a student takes a subset.
 */
export interface LessonFilter {
  /**
   * Hide-list entries: a Shahaf subject exactly as the site prints it, or
   * `subject @ teacher` when the same subject is published for two groups.
   */
  hiddenSubjects: string[];
  /**
   * The student's own names for subjects (logic/ownNames.ts): key → name, kept
   * beside the hide list, with at most 200 entries and 40 characters a name. A
   * key is a line's hide-list entry, `block:<letter>` or `subject:<canonical>`.
   * Absent on settings from before the feature; read it with `subjectNamesOf`.
   */
  subjectNames?: Record<string, string>;
}

/** Which Google Calendar content stays off the timeline (design-doc §7). */
export interface CalendarFilter {
  /** Whole calendars, by Google calendar id. */
  hiddenCalendarIds: string[];
  /**
   * Single events by Google event id, or whole recurring series by the id that
   * precedes the `_<instance>` suffix Google gives each occurrence.
   */
  hiddenEventIds: string[];
}

/**
 * Which of the published exams are the owner's (design-doc §7). The school
 * site's exam schedule covers the whole grade — a block exam lists six
 * subjects of which a student sits one — so each exam gets a switch.
 */
export interface ExamFilter {
  /** Hide-list of exam natural keys. Everything else is relevant. */
  hiddenKeys: string[];
}

/**
 * The absence tracker (חיסורים): the school allows up to and including a share
 * of a subject's lessons in the semester (15% at most schools) to be missed
 * without justification.
 */
export interface AttendanceSettings {
  /** The school's limit, a percent of the semester's lessons, inclusive. */
  limitPercent: number;
  /** How many unjustified lates count as one absence. */
  latesPerAbsence: number;
  /** The owner's own days without lessons (a trip, a school day off) that no calendar knows. */
  daysOff: DateStr[];
  /**
   * The semester's first and last day, inclusive. Empty until set: the
   * server fills in `currentSemester` for whichever is missing.
   */
  semesterStart: DateStr;
  semesterEnd: DateStr;
}

/**
 * Who uses the app on this phone (docs/parents-plan.md): a student, or a
 * parent who follows their child's class without the child's Mashov.
 */
export type Audience = 'student' | 'parent';

export interface UserSettings {
  /**
   * A parent sees the class's timetable, changes, exams and messages: no
   * tasks or planning tab, none of the School tab's Mashov parts, and a
   * morning summary titled with the hour school ends. Kept on the phone only.
   */
  audience: Audience;
  notifications: Record<NotificationType, boolean>;
  quietHours: QuietHours;
  morningSummaryTime: TimeStr;
  /** When the `evening_homework` reminder ("מחר להגיש: …") goes out, `HH:mm`. */
  eveningReminderTime: TimeStr;
  /** Shahaf `cls` value; empty until the class is picked in onboarding. */
  classId: string;
  className: string;
  /** Mirror the relevant exams and school events into a dedicated Google calendar (design-doc §5.2). */
  examsToCalendar: boolean;
  /** "חופש" — pauses all school-source notifications. */
  vacationMode: boolean;
  lessons: LessonFilter;
  calendars: CalendarFilter;
  exams: ExamFilter;
  attendance: AttendanceSettings;
}

export const DEFAULT_SETTINGS: UserSettings = {
  audience: 'student',
  notifications: {
    schedule_change_tomorrow: true,
    schedule_change_today: true,
    new_exam: true,
    new_homework: true,
    new_grade: false,
    teacher_message: false,
    morning_summary: true,
    evening_homework: true,
    next_lesson: false,
    sync_broken: true,
    relogin_needed: true,
  },
  quietHours: { enabled: true, from: '23:00', to: '06:30' },
  morningSummaryTime: '07:00',
  eveningReminderTime: '20:00',
  classId: '',
  className: '',
  examsToCalendar: true,
  vacationMode: false,
  lessons: { hiddenSubjects: [], subjectNames: {} },
  calendars: { hiddenCalendarIds: [], hiddenEventIds: [] },
  exams: { hiddenKeys: [] },
  attendance: { limitPercent: 15, latesPerAbsence: 3, daysOff: [], semesterStart: '', semesterEnd: '' },
};

/**
 * The Ministry's usual semesters around `today`: 1 September to 31 January,
 * then 1 February to 20 June. Schools move the boundary by a few days, which
 * is why the owner can edit both ends.
 */
export function currentSemester(today: DateStr): { semesterStart: DateStr; semesterEnd: DateStr } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (m >= 9) return { semesterStart: `${y}-09-01`, semesterEnd: `${y + 1}-01-31` };
  if (m === 1) return { semesterStart: `${y - 1}-09-01`, semesterEnd: `${y}-01-31` };
  return { semesterStart: `${y}-02-01`, semesterEnd: `${y}-06-20` };
}

/**
 * What `PUT /settings` accepts: any subset, nested records included. The flat
 * fields (`morningSummaryTime`, `eveningReminderTime`, `vacationMode`, …) come
 * through the `Partial<Omit<…>>`; the server validates the `HH:mm` ones.
 */
export type SettingsPatch = Partial<Omit<UserSettings, 'notifications' | 'quietHours' | 'lessons' | 'calendars' | 'exams' | 'attendance'>> & {
  notifications?: Partial<Record<NotificationType, boolean>>;
  quietHours?: Partial<QuietHours>;
  lessons?: Partial<LessonFilter>;
  calendars?: Partial<CalendarFilter>;
  exams?: Partial<ExamFilter>;
  attendance?: Partial<AttendanceSettings>;
};

/** Hebrew labels for the settings screen. UI strings live with the type they describe. */
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  schedule_change_tomorrow: 'שינוי במערכת של מחר',
  schedule_change_today: 'שינוי במערכת של היום',
  new_exam: 'מבחן חדש',
  new_homework: 'שיעורי בית חדשים',
  new_grade: 'ציון חדש',
  teacher_message: 'הודעה ממורה',
  morning_summary: 'סיכום בוקר',
  evening_homework: 'תזכורת ערב: מה להגיש מחר',
  next_lesson: 'השיעור הבא על מסך הנעילה',
  sync_broken: 'תקלה בחיבור',
  relogin_needed: 'נדרשת התחברות מחדש',
};
