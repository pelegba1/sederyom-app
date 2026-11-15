import type {
  CalendarEvent, DateStr, Exam, Grade, Homework, Instant, Lesson,
  SchoolEvent, SchoolMessage, Source, Task, TimeStr,
} from './domain';

/*
 * Routes, for orientation (the server registers them; the app's client calls them):
 *   GET    /day?date=           DayView
 *   GET    /week?offset=        WeekView
 *   GET    /agenda?days=14      AgendaView
 *   GET    /widget-feed         WidgetFeed
 *   GET    /status              StatusResponse
 *   GET    /school              SchoolFeeds
 *   GET    /school/attendance  AttendanceResponse
 *   PATCH  /school/homework/:key  SetHomeworkDoneBody → SetHomeworkDoneResponse
 *   POST   /sessions/mashov     MashovSessionBody → MashovSessionResponse
 *   DELETE /sessions/mashov     DisconnectResponse
 *   DELETE /oauth/google        DisconnectResponse
 */
import type { NotificationType, UserSettings } from './settings';

/** One row on the Today/Week timeline, already merged server-side. */
export type TimelineItem =
  | { kind: 'lesson'; sortKey: string; lesson: Lesson }
  | { kind: 'event'; sortKey: string; event: CalendarEvent }
  | { kind: 'task'; sortKey: string; task: Task };

/** A Mashov homework item, and whether the owner ticked it off in the app. */
export type HomeworkItem = Homework & { done: boolean };

/** How far ahead `DayView.nextExam` looks, in days from the view's date. */
export const NEXT_EXAM_WINDOW_DAYS = 21;

/** The next relevant exam as seen from one day. */
export interface NextExam {
  exam: Exam;
  /** Whole days from the view's `date` to `exam.date`; 0 when it is that day. */
  daysAway: number;
}

export interface DayView {
  date: DateStr;
  /** Hebrew weekday name, e.g. "יום שלישי". */
  weekdayName: string;
  /** Hebrew calendar date, e.g. "י״א באלול". */
  hebrewDate: string;
  isSchoolDay: boolean;
  holidayName: string | null;
  timeline: TimelineItem[];
  examsToday: Exam[];
  examsTomorrow: Exam[];
  /** Count of lessons whose status is not `regular`. */
  changeCount: number;
  events: SchoolEvent[];
  /** Homework whose `dueDate` is this day, done and open alike. */
  homework: HomeworkItem[];
  /**
   * The nearest relevant (not hidden) exam from this day on, within
   * `NEXT_EXAM_WINDOW_DAYS`; `null` when there is none in that window.
   */
  nextExam: NextExam | null;
  /**
   * The lessons are projected from the fixed Mashov timetable because the
   * school site has not published this week yet — show them as "צפוי".
   */
  projected: boolean;
  generatedAt: Instant;
}

/** One row of the planning list ("הקרוב אליי"). */
export type AgendaItem =
  | { kind: 'exam'; exam: Exam; daysAway: number }
  | { kind: 'homework'; homework: HomeworkItem }
  | { kind: 'task'; task: Task }
  /** A school event from the site's events tab. */
  | { kind: 'event'; event: SchoolEvent }
  /** A Google Calendar event, filtered like the timeline (hidden calendars and events stay out). */
  | { kind: 'calendar'; event: CalendarEvent };

export interface AgendaDay {
  date: DateStr;
  /** Hebrew weekday name, e.g. "יום שלישי". */
  weekdayName: string;
  /** In this order of kinds: exam, homework, task, event, calendar. Empty on a day with nothing planned. */
  items: AgendaItem[];
}

/** `GET /agenda?days=N` without `days`. */
export const AGENDA_DEFAULT_DAYS = 14;
/** The most `GET /agenda` serves in one call. */
export const AGENDA_MAX_DAYS = 31;

/**
 * `GET /agenda?days=14` — what is planned from today on: relevant exams,
 * homework by due date, tasks by due date, school and calendar events. Built
 * from the same load as `/week`, so the two never disagree.
 */
export interface AgendaView {
  /** Today. */
  from: DateStr;
  /** Last day included: `from + days - 1`. */
  to: DateStr;
  /** Every day from `from` to `to`, ascending, empty days included. */
  days: AgendaDay[];
  generatedAt: Instant;
}

export interface WeekView {
  /** 0 = current week, matches the Shahaf site's `week` param. */
  offset: number;
  startDate: DateStr;
  endDate: DateStr;
  days: DayView[];
  exams: Exam[];
  schoolEvents: SchoolEvent[];
  generatedAt: Instant;
}

export interface WidgetLesson {
  hourIndex: number;
  startTime: TimeStr | null;
  endTime: TimeStr | null;
  subject: string;
  /** With the student's own name in `subject`: the name the source gave the lesson, which its colour goes by. */
  originalSubject?: string;
  status: Lesson['status'];
  detail: string | null;
}

export interface WidgetEvent {
  summary: string;
  start: Instant;
  end: Instant;
  allDay: boolean;
}

export interface WidgetTask {
  id: string;
  title: string;
  due: DateStr | null;
  listTitle: string | null;
}

export interface WidgetExam {
  subject: string;
  date: DateStr;
  /** Whole days from the feed's `date`; negative once it has passed. */
  daysAway: number;
  /**
   * `subject` is a name the student gave the exam on the phone
   * (`Exam.originalSubject` set, no `subjectName`): shown whole, never cut to
   * a subject's short form. Absent otherwise, and always on the server's feed.
   */
  named?: true;
  /**
   * The student's name for the exam's subject, which the title took
   * (`Exam.subjectName`, on the phone): the widgets say "מבחן" and this name,
   * as the week grid's tag does. Absent otherwise, and always on the server's feed.
   */
  subjectName?: string;
}

/** One day of the schedule widget's window — the same merge `/day` serves. */
export interface WidgetDay {
  date: DateStr;
  weekdayName: string;
  hebrewDate: string;
  isSchoolDay: boolean;
  holidayName: string | null;
  lessons: WidgetLesson[];
  events: WidgetEvent[];
  tasksDue: WidgetTask[];
  exams: WidgetExam[];
  changeCount: number;
}

/** How far the widget feed reaches around today (design-doc §4). */
export const WIDGET_DAYS_BACK = 2;
export const WIDGET_DAYS_AHEAD = 6;

/** Open homework due soon, as the widgets show it. */
export interface WidgetHomework {
  /** `Homework.naturalKey`. */
  key: string;
  subject: string;
  /** With the student's own name in `subject` (on the phone): the name Mashov gave it, so `subject` is shown as typed. */
  originalSubject?: string;
  text: string;
  due: DateStr;
}

export interface WidgetFeed {
  date: DateStr;
  weekdayName: string;
  hebrewDate: string;
  /** Today's lessons — `days` holds the same list under today's date. */
  lessons: WidgetLesson[];
  nextEvent: { summary: string; start: Instant } | null;
  tasksDueToday: { id: string; title: string }[];
  /** Every open task, due-soonest first, undated last. */
  openTasks: WidgetTask[];
  openTaskCount: number;
  nextExam: WidgetExam | null;
  /** The next few exams from today on, ascending. */
  upcomingExams: WidgetExam[];
  /** Open (not done) homework due today or tomorrow, due date ascending. */
  homeworkDue: WidgetHomework[];
  changeCount: number;
  /**
   * `WIDGET_DAYS_BACK` days before today through `WIDGET_DAYS_AHEAD` after,
   * ascending, today included — what the schedule widget pages through.
   */
  days: WidgetDay[];
  generatedAt: Instant;
}

export type SyncState = 'ok' | 'degraded' | 'broken';

/** Mashov session lifetime measurements (plan S3) — for diagnosis, not for the main UI. */
export interface MashovSessionTimes {
  /** When the app captured the session now held. */
  capturedAt: Instant | null;
  /** Last authenticated request Mashov answered. */
  lastOkAt: Instant | null;
  /** First 401 after `lastOkAt`; `null` while the session still works. */
  failedAt: Instant | null;
  /** Last time the server saved a token Mashov renewed for this session; `null` if it never has. */
  rotatedAt?: Instant | null;
}

export interface SourceStatus {
  source: Source;
  state: SyncState;
  lastOkAt: Instant | null;
  consecutiveFailures: number;
  degradedSince: Instant | null;
  /** Raw technical error, for the "פרטים טכניים" disclosure only. Show `message` instead. */
  lastError: string | null;
  /**
   * Hebrew, for the user: what is wrong and what to do ("משוב ניתק את החיבור.
   * צריך להתחבר שוב (לוקח דקה)"). `null` when there is nothing to say.
   */
  message: string | null;
  /** The connected account, e.g. the Google address. `null` when unknown or not connected. */
  account: string | null;
  /** Mashov only. */
  session?: MashovSessionTimes;
  /** Source-reported freshness (Shahaf "מעודכן ל"). */
  sourceFreshness: Instant | null;
  /** Whether the user must re-authenticate this source. */
  needsReauth: boolean;
  /**
   * Whether the server holds credentials for this source at all — a captured
   * Mashov session, a Google refresh token. Distinct from `lastOkAt`: a source
   * can be configured and still waiting for its first successful poll.
   */
  configured: boolean;
}

export interface StatusResponse {
  sources: SourceStatus[];
  serverTime: Instant;
}

export interface NotificationLogEntry {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  sentAt: Instant;
}

export interface SchoolFeeds {
  grades: Grade[];
  homework: HomeworkItem[];
  messages: SchoolMessage[];
  exams: Exam[];
}

/** The School screen's sub-tabs; also what a push may deep-link to. */
export type SchoolTab = 'exams' | 'grades' | 'homework' | 'messages' | 'bagrut' | 'attendance';

/**
 * One bagrut questionnaire in one sitting (plan §14.2, §14.9), joined from
 * Mashov's `bagrut/grades` and `bagrut/sheelonim`. Mashov gives no units and no
 * weight within the subject: those come from the app's catalog or the owner.
 */
export interface BagrutExam {
  /** `bagrut|{semel}|{moed}`. */
  naturalKey: string;
  /** The Ministry's questionnaire code, e.g. 35571. */
  semel: number;
  /** As Mashov names it: "מתמטיקה - תכנית חדשה (הערכה חיצונית)". */
  name: string;
  /** The sitting, `YYYY-MM` (Mashov's 202606). */
  moed: string;
  /** "היבחנות חיצונית" → external; "ציון בית ספרי" → school; else null. */
  method: 'external' | 'school' | null;
  /** `shnaty`: the school's grade for the questionnaire (מגן). */
  schoolGrade: number | null;
  /** `test`: the exam itself. */
  examGrade: number | null;
  /** `final`, as Mashov reports it. */
  finalGrade: number | null;
  /** `moeLastAcceptedGrade`: what the Ministry last accepted, when it says. */
  acceptedGrade: number | null;
  /** `going`: registered for this sitting. */
  registered: boolean;
  examDate: DateStr | null;
  startTime: TimeStr | null;
  endTime: TimeStr | null;
}

export interface BagrutResponse {
  exams: BagrutExam[];
  /** When the server last read them from Mashov; `null` before the first read. */
  fetchedAt: Instant | null;
}

/** One absence or late Mashov recorded (`/behave`, codes 61 and 62). */
export interface AttendanceEvent {
  date: DateStr;
  /** The period, as Mashov numbers it. */
  hour: number | null;
  kind: 'absence' | 'late';
  /** True once a justification was approved (`justificationId` > 0). */
  justified: boolean;
  /** The justification's name, e.g. "אישור רפואי"; null when there is none. */
  justification: string | null;
}

/** One subject group in the semester: what was held, what is left, what was missed. */
export interface AttendanceSubject {
  groupId: string;
  subject: string;
  /** Set only on the phone, with the student's own name in `subject`: the name Mashov gave it. */
  originalSubject?: string;
  /** Lessons held so far, as Mashov counts them (`lessonsCount`) — the school's own denominator. */
  held: number;
  /** Lessons still ahead until the semester ends, from the weekly timetable minus days off. */
  remaining: number;
  /** Where `remaining` came from: the weekly timetable, or Mashov's `weeklyHours` when the timetable lacks the subject. */
  remainingFrom: 'grid' | 'weeklyHours';
  weeklyHours: number | null;
  /** Unjustified absences and lates in the semester: what counts toward the limit. */
  absences: number;
  lates: number;
  /** Justified ones, shown but not counted. */
  justifiedAbsences: number;
  justifiedLates: number;
  /** Newest first. */
  events: AttendanceEvent[];
}

/** A day off ahead that the remaining count leaves out. */
export interface AttendanceDayOff {
  date: DateStr;
  name: string;
  /** The owner added it (`settings.attendance.daysOff`), so it can be removed. */
  own: boolean;
}

/** `GET /school/attendance`: the absence tracker (חיסורים). */
export interface AttendanceResponse {
  semesterStart: DateStr;
  semesterEnd: DateStr;
  /** The limit, a share of the semester's lessons that may be missed, inclusive. */
  limit: number;
  latesPerAbsence: number;
  subjects: AttendanceSubject[];
  /** School days off between tomorrow and the semester's end, weekends aside. */
  daysOffAhead: AttendanceDayOff[];
  /** When the server last read attendance from Mashov; `null` before the first read. */
  fetchedAt: Instant | null;
}

/** Classroom's own submission states, as its API names them. */
export type ClassroomSubmissionState = 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';

/** An assignment from Google Classroom (plan §14.5), with this student's submission. */
export interface ClassroomWork {
  /** `classroom|{courseId}|{courseWorkId}`. */
  naturalKey: string;
  courseId: string;
  courseName: string;
  /** The timetable subject the course matched (`subjectsMatch`), else null. */
  subject: string | null;
  title: string;
  description: string | null;
  dueDate: DateStr | null;
  dueTime: TimeStr | null;
  /** Opens it in Classroom. */
  link: string;
  state: ClassroomSubmissionState | null;
  late: boolean;
  /** `assignedGrade` once returned. */
  grade: number | null;
  maxPoints: number | null;
  updatedAt: Instant;
}

export interface ClassroomMaterial {
  naturalKey: string;
  courseId: string;
  courseName: string;
  subject: string | null;
  title: string;
  link: string;
  updatedAt: Instant;
}

export interface ClassroomFeed {
  work: ClassroomWork[];
  materials: ClassroomMaterial[];
  /** The connected account, or null when Classroom is not connected. */
  account: string | null;
}

export interface ClassOption {
  id: string;
  name: string;
}

/** One published line of the class timetable, for the "my lessons" picker. */
export interface SubjectOption {
  /** What to store in `hiddenSubjects` to hide this line. */
  key: string;
  /** Subject exactly as the site prints it. */
  name: string;
  teacher: string | null;
  /** Whether Mashov's personal timetable carries a matching group. */
  inMashov: boolean;
  /** Lessons with this subject and teacher across the fetched weeks. */
  count: number;
}

export interface CalendarOption {
  id: string;
  name: string;
  primary: boolean;
  /** The "בית ספר" mirror this server maintains (design-doc §5.2); never shown on the timeline. */
  isSchoolCalendar: boolean;
  /**
   * The grade's exam schedule, which the school site publishes as a public
   * calendar and the owner may also subscribe to in Google. Its events reach
   * the app as exams (design-doc §6.4), so on the timeline they would be the
   * same thing twice; never shown there.
   */
  isExamCalendar: boolean;
}

/**
 * Whether an exam looks like the owner's, judged against their lessons. A
 * recommendation only — it never changes the hide-list by itself.
 */
export interface ExamMatch {
  /** `true` matches a lesson the owner keeps, `false` does not, `null` when there is too little to tell. */
  mine: boolean | null;
  /** Hebrew, short, why it is not theirs: "רק למשפרים", "גוש א׳ — מקצוע אחר", "לא במערכת שלך". */
  reason: string | null;
}

/** One published exam, for the "my exams" picker. */
export interface ExamOption extends Exam {
  /** Whether it is on the hide-list (`exams.hiddenKeys`). */
  hidden: boolean;
  /**
   * The subject the exam is about, as one key for every exam of that subject
   * ("מבחן באנגלית", "בגרות באנגלית - G" → "אנגלית") — what the picker groups
   * by. A readable Hebrew subject name; `''` when the title names no subject
   * (a block exam, "מועד ב׳").
   */
  subjectKey: string;
  match: ExamMatch;
}

/** A hidden event, resolved to something the user can recognise. */
export interface HiddenEventOption {
  id: string;
  summary: string;
  /** True when `id` names a whole recurring series rather than one occurrence. */
  series: boolean;
}

export interface TaskListOption {
  id: string;
  title: string;
}

export interface CreateTaskBody {
  title: string;
  notes?: string | null;
  due?: DateStr | null;
  listId?: string;
  /** When set, links the new task to a Mashov homework item. */
  fromHomeworkKey?: string;
}

export interface UpdateTaskBody {
  title?: string;
  notes?: string | null;
  due?: DateStr | null;
  completed?: boolean;
}

export interface TasksResponse {
  items: Task[];
  /** Every Google Tasks list, for the compose sheet's list picker. */
  lists: TaskListOption[];
}

/**
 * What `POST /sessions/mashov` answers. The server verifies the captured session
 * against Mashov before replying, so "saved" and "works" are never confused:
 * `verified` is the outcome of a real poll, and `error` says why it failed.
 */
export interface MashovSessionResponse {
  ok: true;
  verified: boolean;
  error: string | null;
  /** Student GUID read from the auth cookie, for display. */
  userId: string | null;
  /** The auth cookie's own `exp` claim — a hint, not what Mashov enforces. */
  expiresAt: Instant | null;
  counts: { created: number; updated: number; deleted: number } | null;
}

export interface MashovSessionBody {
  /** Raw `Cookie` header value captured from the WebView. */
  cookieHeader: string;
  /** Mashov sends its CSRF token as `x-csrf-token`; captured when present. */
  csrfToken?: string | null;
  /** Whatever the app could read about the logged-in user, for display only. */
  userId?: string | null;
  capturedAt?: Instant;
}

export interface PushTokenBody {
  token: string;
  platform: 'android' | 'ios';
}

/**
 * `PATCH /school/homework/:key` — tick a homework item off in the app, or
 * back on. `:key` is `encodeURIComponent(Homework.naturalKey)`. Mashov is not
 * written to; the mark lives on this server. Answers the updated item.
 */
export interface SetHomeworkDoneBody {
  done: boolean;
}
export type SetHomeworkDoneResponse = HomeworkItem;

/**
 * `DELETE /sessions/mashov` (forget the captured session) and
 * `DELETE /oauth/google` (revoke the refresh token and forget it). Both are
 * idempotent: disconnecting what is not connected still answers ok.
 */
export interface DisconnectResponse {
  ok: true;
}

export interface SettingsResponse {
  settings: UserSettings;
  classes: ClassOption[];
  /** Every line the school site publishes for the class, with its Mashov match. */
  subjects: SubjectOption[];
  /** Whether Mashov has delivered a personal timetable to match against. */
  mashovKnown: boolean;
  calendars: CalendarOption[];
  hiddenEvents: HiddenEventOption[];
  /** Every upcoming exam from every source, hidden ones included, ascending by date. */
  exams: ExamOption[];
  /** The school's Shahaf site, for "פתח באתר"; `null` when the server has none. */
  schoolSiteUrl: string | null;
  /** Where the class list comes from, for the class step and the class picker when there is none. */
  site: SchoolSiteState;
}

/**
 * The school's Shahaf site as the phone knows it (plan Phase 3). Many schools
 * use Mashov without one: the student may paste its address, or go on without
 * a site, and the days then come from Mashov alone.
 */
export interface SchoolSiteState {
  /** `https://<school>.shahaf.site`, or `null` when none is known. */
  url: string | null;
  /**
   * Where `url` came from: the class the phone follows, the address the
   * student pasted, or Mashov's answer. `none`: Mashov answered, and named no
   * Shahaf site. `unknown`: Mashov was not asked (a class list is kept) or
   * could not say (not connected, an error, or no network). With Mashov
   * connected and no list, `none` and `unknown` alike lead to pasting the
   * address or going on without a site (`classStepPage`).
   */
  from: 'class' | 'pasted' | 'mashov' | 'none' | 'unknown';
  /** The student chose to go on without a site: no class to follow, and nothing said about a missing one. */
  withoutSite: boolean;
}

/**
 * A settings update returns only the settings. It deliberately does *not*
 * carry `classes`: fetching the school's class list means scraping the site,
 * which has no place in the path of toggling a switch — and returning a
 * one-item stand-in is worse than returning nothing, because a client that
 * caches the response then believes there is only one class to choose from.
 */
export interface SettingsUpdateResponse {
  settings: UserSettings;
}

/** `POST /oauth/link`: where the browser goes to begin a Google consent. */
export interface OAuthLinkResponse {
  url: string;
}

export interface ApiError {
  error: string;
  message: string;
}

/** Data payload attached to every push; drives deep links and widget refresh. */
export interface PushPayload {
  type: NotificationType;
  /** Screen the app should open on tap. `planning` is the "תכנון" tab (route `Calendar`). */
  deepLink: 'today' | 'week' | 'school' | 'tasks' | 'notifications' | 'mashov-login' | 'settings' | 'planning';
  /** The day a `today` / `week` / `planning` link opens on. */
  date?: DateStr;
  /** With `school` + `tab: 'exams'`: the exam to bring into view (`Exam.naturalKey`). */
  examKey?: string;
  /** With `school`: which sub-tab to open. */
  tab?: SchoolTab;
  /** The class it is about, on a phone that follows more than one (a parent's children). */
  class?: { siteUrl: string; classId: string };
  refreshWidget: true;
}
