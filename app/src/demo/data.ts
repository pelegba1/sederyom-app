/**
 * The demo's made-up student (Google Play's "App access", and anyone who wants
 * a look before connecting anything): an 11th grader in ״י״א 2״ at a school
 * that does not exist, with a week of lessons, a substitute and a cancelled
 * lesson, exams, a school event, homework, grades, messages, bagrut, absences,
 * and a Google calendar and task list. Everything is invented.
 *
 * Built for the day it is asked for and never stored, so the demo always
 * shows the current week; and in the shapes the real sources keep (the class
 * feed, Mashov's entities, bagrut, Google's kept entities), so every screen
 * draws it through its usual path (`local/days.ts`, `local/phoneApi.ts`).
 *
 * Placed by school days (`schoolDayInfo`), as a school's site would publish
 * them: lessons only on days school is held, the substitute on the first
 * school day from today and the cancellation on the one after it, homework
 * due on them, exams and events on the school days ahead, and grades,
 * messages and absences on the ones behind. No name here is anyone's, and no
 * id is Mashov's or a school site's.
 *
 * Pure: the clock and the zone in, plain data out, so tests can load it.
 */
import type {
  BagrutExam, ClassEvent, ClassExam, ClassFeed, ClassLesson, ClassOption, DateStr, NotificationLogEntry, NotificationType,
  SourceStatus, StatusResponse, UserSettings,
} from '@sederyom/shared';
import { DEFAULT_SETTINGS, currentSemester } from '@sederyom/shared';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import type { NormalizedCalendar, NormalizedCalendarEvent } from '@sederyom/shared/logic/google/calendar';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import type { AttendancePayload, LessonCountPayload } from '@sederyom/shared/logic/mashov/attendance';
import type { MashovMessage } from '@sederyom/shared/logic/mashov/messages';
import type { MashovGrade, MashovHomework, MashovSlot } from '@sederyom/shared/logic/mashov/normalize';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { addDays, schoolDayInfo, sundayIndex, weekStart, weekdayNameHe } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { changeKey, type ChangeSightings } from '../local/changes';
import type { HomeworkStates } from '../local/homeworkState';

/** The class, as a school's site would list it: "יא2" reads ״י״א 2״. */
export const DEMO_CLASS: ClassOption = { id: 'demo-class', name: 'יא2' };

/** No school's site: `.invalid` is reserved, and the screens are never given it (`demo/api.ts`). */
export const DEMO_SITE = 'https://demo.invalid';

/** The teachers: ordinary first names and common surnames, none of them from the tests' fixtures. */
export const DEMO_TEACHERS = {
  math: 'מיכל כהן',
  english: 'רונית אברהם',
  physics: 'אבי רוזן',
  biology: 'נטע אלון',
  history: 'אורנה מזרחי',
  literature: 'נוגה שפירא',
  bible: 'דוד וייס',
  civics: 'שירה ביטון',
  pe: 'עידו שטרן',
  homeroom: 'הילה ברגר',
} as const;

/** Who stands in for the lesson with a substitute. */
export const DEMO_SUBSTITUTE = 'אסנת קליין';

/** Every person the demo names. */
export const DEMO_PEOPLE: readonly string[] = [...Object.values(DEMO_TEACHERS), DEMO_SUBSTITUTE];

type SubjectId = 'math' | 'english' | 'physics' | 'biology' | 'history' | 'literature' | 'bible' | 'civics' | 'hebrew' | 'pe' | 'homeroom';

interface Line {
  subject: string;
  teacher: string;
  room: string;
  groupId: string;
}

const HOMEROOM = 'חדר 214';
const T = DEMO_TEACHERS;

/** Each subject's line, as the site prints it, with its Mashov group. */
const LINES: Readonly<Record<SubjectId, Line>> = {
  math: { subject: 'מתמטיקה', teacher: T.math, room: HOMEROOM, groupId: 'demo-math' },
  english: { subject: 'אנגלית', teacher: T.english, room: 'חדר 108', groupId: 'demo-english' },
  physics: { subject: 'פיזיקה', teacher: T.physics, room: 'מעבדת פיזיקה', groupId: 'demo-physics' },
  biology: { subject: 'ביולוגיה', teacher: T.biology, room: 'מעבדת ביולוגיה', groupId: 'demo-biology' },
  history: { subject: 'היסטוריה', teacher: T.history, room: HOMEROOM, groupId: 'demo-history' },
  literature: { subject: 'ספרות', teacher: T.literature, room: HOMEROOM, groupId: 'demo-literature' },
  bible: { subject: 'תנ״ך', teacher: T.bible, room: HOMEROOM, groupId: 'demo-bible' },
  civics: { subject: 'אזרחות', teacher: T.civics, room: HOMEROOM, groupId: 'demo-civics' },
  hebrew: { subject: 'לשון', teacher: T.homeroom, room: HOMEROOM, groupId: 'demo-hebrew' },
  pe: { subject: 'חינוך גופני', teacher: T.pe, room: 'אולם הספורט', groupId: 'demo-pe' },
  homeroom: { subject: 'חינוך', teacher: T.homeroom, room: HOMEROOM, groupId: 'demo-homeroom' },
};

/** The bells: periods of 45 minutes, with the two long breaks. */
const BELLS: Readonly<Record<number, readonly [string, string]>> = {
  1: ['08:00', '08:45'],
  2: ['08:45', '09:30'],
  3: ['09:45', '10:30'],
  4: ['10:30', '11:15'],
  5: ['11:35', '12:20'],
  6: ['12:20', '13:05'],
  7: ['13:15', '14:00'],
  8: ['14:00', '14:45'],
  9: ['14:50', '15:35'],
};

/**
 * The week, Sunday to Friday, period 1 first: seven to nine lessons a day, four
 * on Friday. `null` is a free period, as most timetables have one or two: on
 * Monday the fourth, on Wednesday the fifth. The demo's friend's class has the
 * same (`demo/buddies.ts`), so the two share a window on those days.
 */
const WEEK: readonly (readonly (SubjectId | null)[])[] = [
  ['math', 'math', 'english', 'history', 'physics', 'physics', 'literature', 'bible'],
  ['biology', 'biology', 'math', null, 'english', 'civics', 'bible', 'homeroom'],
  ['english', 'math', 'physics', 'physics', 'history', 'literature', 'biology', 'biology', 'civics'],
  ['pe', 'pe', 'civics', 'math', null, 'english', 'biology', 'physics'],
  ['math', 'english', 'bible', 'literature', 'physics', 'biology', 'history', 'hebrew'],
  ['homeroom', 'hebrew', 'bible', 'math'],
];

/** The period that has a substitute on the first school day. */
const SUBSTITUTE_PERIOD = 3;

/** How far the school days around today are looked for: past the summer break. */
const LOOK_DAYS = 120;

/** Everything the demo shows, in the shapes the phone keeps the real sources in. */
export interface DemoData {
  feed: ClassFeed;
  /** Mashov's read: the grid, homework, grades, messages, absences and lesson counts. */
  mashov: NormalizedEntity[];
  bagrut: BagrutExam[];
  /** Google's kept entities: two calendars and their events, one task list and its tasks. */
  google: KeptEntity[];
  /** The two changes, as seen a while ago: the timeline marks them new. */
  changeSeen: ChangeSightings;
  /** One homework item already ticked off. */
  homeworkState: HomeworkStates;
  /** A few notifications, as if they had come. */
  notifications: NotificationLogEntry[];
  /** The 16 school days before today, the last first: the days its grades, messages and absences fall on, and the made-up friend's grades (`demo/buddies.ts`) with them. */
  pastDays: DateStr[];
}

/** The day the demo is built around: `now`'s date in `zone`. */
export function demoToday(now: Date, zone: string): DateStr {
  return DateTime.fromJSDate(now).setZone(zone).toISODate()!;
}

/** `count` school days from `from` on (`step` 1), or before it (`step` -1). */
function schoolDays(from: DateStr, step: 1 | -1, count: number, zone: string): DateStr[] {
  const out: DateStr[] = [];
  for (let i = 0, d = from; out.length < count && i < LOOK_DAYS; i += 1, d = addDays(d, step, zone)) {
    if (WEEK[sundayIndex(d, zone)] && schoolDayInfo(d, zone).isSchoolDay) out.push(d);
  }
  return out;
}

const at = (date: DateStr, time: string, zone: string): string => DateTime.fromISO(`${date}T${time}`, { zone }).toISO()!;
const ago = (now: Date, minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();

function lessonOn(date: DateStr, hourIndex: number, id: SubjectId): ClassLesson {
  const line = LINES[id];
  const [startTime, endTime] = BELLS[hourIndex] ?? [null, null];
  return {
    date, hourIndex, startTime, endTime, subject: line.subject, teacher: line.teacher, room: line.room,
    status: 'regular', substitute: null, note: null,
  };
}

/** The periods of `id` on `date`'s weekday, period 1 first. */
function periodsOf(id: SubjectId, date: DateStr, zone: string): number[] {
  return (WEEK[sundayIndex(date, zone)] ?? []).flatMap((s, i) => (s === id ? [i + 1] : []));
}

/** The first of `days` from index `from` on with a lesson of `id`, or the one at `from` when none has. */
function firstWith(id: SubjectId, days: readonly DateStr[], from: number, zone: string): DateStr | undefined {
  return days.slice(from).find((d) => periodsOf(id, d, zone).length > 0) ?? days[from];
}

/**
 * The site's lessons: last week, this week and next (the weeks after are
 * Mashov's grid, as for a real class), on the days school is held. The
 * substitute and the cancellation are on two of them.
 */
function feedLessons(today: DateStr, zone: string, substituteOn: DateStr | undefined, cancelledOn: DateStr | undefined): ClassLesson[] {
  const lessons: ClassLesson[] = [];
  const last = addDays(weekStart(today, 1, zone), 5, zone);
  for (let d = weekStart(today, -1, zone); d <= last; d = addDays(d, 1, zone)) {
    const periods = WEEK[sundayIndex(d, zone)];
    if (!periods || !schoolDayInfo(d, zone).isSchoolDay) continue;
    periods.forEach((id, i) => {
      if (id) lessons.push(lessonOn(d, i + 1, id));
    });
  }
  return lessons.map((l) => {
    if (l.date === substituteOn && l.hourIndex === SUBSTITUTE_PERIOD) return { ...l, status: 'substitution', substitute: DEMO_SUBSTITUTE };
    if (l.date === cancelledOn && l.hourIndex === (WEEK[sundayIndex(l.date, zone)]?.length ?? 0)) return { ...l, status: 'cancelled' };
    return l;
  });
}

const entity = <T>(kind: NormalizedEntity['kind'], naturalKey: string, payload: T, partition?: string): NormalizedEntity =>
  ({ source: 'mashov', kind, naturalKey, payload, ...(partition ? { partition } : {}) });

/** Mashov's weekly grid, as `readMashov` keeps it. */
function slots(): NormalizedEntity[] {
  return WEEK.flatMap((periods, dayOfWeek) => periods.flatMap((id, i): NormalizedEntity[] => {
    if (!id) return [];
    const line = LINES[id];
    const [startTime, endTime] = BELLS[i + 1] ?? [null, null];
    const slot: MashovSlot = {
      dayOfWeek, hourIndex: i + 1, subject: line.subject, teacher: line.teacher, room: line.room,
      groupName: `${line.subject} ${DEMO_CLASS.name}`, startTime, endTime, groupId: line.groupId,
    };
    return [entity('timetable_slot', `mashov-slot|${dayOfWeek}|${i + 1}|${line.subject}`, slot, `dow:${dayOfWeek}`)];
  }));
}

/**
 * Lessons held so far this semester, as Mashov counts them: the grid's
 * lessons of each weekday up to yesterday, less a tenth for the days off.
 */
function lessonsHeld(id: SubjectId, semesterStart: DateStr, today: DateStr, zone: string): number {
  let held = 0;
  for (let d = semesterStart; d < today; d = addDays(d, 1, zone)) held += periodsOf(id, d, zone).length;
  return Math.round(held * 0.9);
}

function weeklyHours(id: SubjectId): number {
  return WEEK.reduce((sum, periods) => sum + periods.filter((s) => s === id).length, 0);
}

/** One questionnaire in one sitting, with the grades it has once it is sat. */
interface Sitting {
  semel: number;
  name: string;
  moed: string;
  date: DateStr | null;
  method: BagrutExam['method'];
  school: number | null;
  exam: number | null;
  final: number | null;
}

/** The registered sittings, by the school year `today` is in: 10th grade's summer behind, 11th grade's ahead. */
function bagrut(today: DateStr, zone: string): BagrutExam[] {
  const year = Number(today.slice(0, 4));
  const y = Number(today.slice(5, 7)) >= 9 ? year : year - 1;
  const rows: Sitting[] = [
    { semel: 11251, name: 'עברית: הבעה ולשון', moed: `${y}-06`, date: `${y}-06-02`, method: 'external', school: 88, exam: 84, final: 86 },
    { semel: 1261, name: 'תנ״ך', moed: `${y}-06`, date: `${y}-06-09`, method: 'external', school: 85, exam: 79, final: 82 },
    // Tanakh's second questionnaire, assessed at school: the subject is complete, so the average has a number.
    { semel: 1263, name: 'תנ״ך', moed: `${y}-06`, date: null, method: 'school', school: 90, exam: null, final: 90 },
    { semel: 22221, name: 'היסטוריה', moed: `${y}-06`, date: null, method: 'school', school: 92, exam: null, final: 92 },
    { semel: 16471, name: 'אנגלית', moed: `${y + 1}-01`, date: weekdayFrom(`${y + 1}-01-19`, zone), method: 'external', school: 94, exam: 90, final: 92 },
    { semel: 35571, name: 'מתמטיקה', moed: `${y + 1}-06`, date: weekdayFrom(`${y + 1}-06-08`, zone), method: 'external', school: 90, exam: 87, final: 88 },
  ];
  const month = today.slice(0, 7);
  return rows.map((r): BagrutExam => {
    // A sitting still ahead has no grades yet, the school's at most.
    const sat = r.moed < month || (r.date !== null && r.date < today);
    return {
      naturalKey: `bagrut|${r.semel}|${r.moed}`,
      semel: r.semel,
      name: r.name,
      moed: r.moed,
      method: r.method,
      schoolGrade: sat || r.method === 'external' ? r.school : null,
      examGrade: sat ? r.exam : null,
      finalGrade: sat ? r.final : null,
      acceptedGrade: sat ? r.final : null,
      registered: true,
      examDate: r.date,
      startTime: r.date ? '09:00' : null,
      endTime: r.date ? '12:00' : null,
    };
  });
}

/** `date`, or the Sunday after it when it falls on a Friday or a Saturday. */
function weekdayFrom(date: DateStr, zone: string): DateStr {
  const dow = sundayIndex(date, zone);
  return dow === 5 ? addDays(date, 2, zone) : dow === 6 ? addDays(date, 1, zone) : date;
}

const PERSONAL = 'demo-personal';
const FAMILY = 'demo-family';
const TASK_LIST = 'demo-tasks';

function calendarEvent(id: string, calendarId: string, summary: string, start: string, end: string, allDay = false, location: string | null = null): KeptEntity {
  const payload: NormalizedCalendarEvent = {
    googleId: id, calendarId, calendarSummary: calendarId === PERSONAL ? 'אישי' : 'משפחה', summary, location, start, end, allDay, cancelled: false,
  };
  return { kind: 'calendar_event', naturalKey: `${calendarId}|${id}`, partition: calendarId, payload };
}

function task(id: string, title: string, due: DateStr | null, completed = false, notes: string | null = null): KeptEntity {
  const payload: NormalizedTask = {
    googleId: id, listId: TASK_LIST, listTitle: 'המשימות שלי', title, notes, due, completed, completedAt: null, deleted: false, updated: null,
  };
  return { kind: 'task', naturalKey: `${TASK_LIST}|${id}`, partition: TASK_LIST, payload };
}

/** A calendar of its own and the family's, with a few weeks of afternoons; and a short task list. */
function google(today: DateStr, ahead: (n: number) => DateStr, behind: (n: number) => DateStr, zone: string): KeptEntity[] {
  const calendars: NormalizedCalendar[] = [
    { id: PERSONAL, summary: 'אישי', primary: true, color: '#7986cb' },
    { id: FAMILY, summary: 'משפחה', primary: false, color: '#f6bf26' },
  ];
  const out: KeptEntity[] = calendars.map((c) => ({ kind: 'calendar', naturalKey: c.id, partition: null, payload: c }));

  // A weekly basketball practice and a guitar lesson, a week back to three ahead, as Google sends a series.
  for (let d = addDays(today, -7, zone); d <= addDays(today, 21, zone); d = addDays(d, 1, zone)) {
    const dow = sundayIndex(d, zone);
    const stamp = d.replace(/-/g, '');
    if (dow === 1 || dow === 3) {
      out.push(calendarEvent(`demo-basketball_${stamp}`, PERSONAL, 'אימון כדורסל', at(d, '17:00', zone), at(d, '18:30', zone), false, 'מרכז הספורט'));
    }
    if (dow === 4) out.push(calendarEvent(`demo-guitar_${stamp}`, PERSONAL, 'שיעור גיטרה', at(d, '16:00', zone), at(d, '16:45', zone)));
  }
  const birthday = addDays(today, 4, zone);
  out.push(calendarEvent('demo-birthday', FAMILY, 'יום הולדת לסבתא', at(birthday, '00:00', zone), at(addDays(birthday, 1, zone), '00:00', zone), true));
  const dentist = addDays(today, 9, zone);
  out.push(calendarEvent('demo-dentist', PERSONAL, 'תור לרופאת שיניים', at(dentist, '16:30', zone), at(dentist, '17:00', zone)));

  out.push({ kind: 'task_list', naturalKey: TASK_LIST, partition: null, payload: { id: TASK_LIST, title: 'המשימות שלי' } });
  out.push(
    task('demo-task-notebook', 'לקנות מחברת משבצות', ahead(0)),
    task('demo-task-library', 'להחזיר את הספר לספרייה', ahead(1)),
    task('demo-task-form', 'להביא אישור הורים ליום הספורט', ahead(3)),
    task('demo-task-slides', 'לסיים את המצגת בהיסטוריה', ahead(6), false, 'השקופיות על שנות המדינה הראשונות'),
    task('demo-task-print', 'להדפיס את דף העבודה בפיזיקה', behind(0), true),
    task('demo-task-dates', 'לבדוק את מועדי הבגרות בחורף', null),
  );
  return out;
}

export function demoData(now: Date, zone: string): DemoData {
  const today = demoToday(now, zone);
  const coming = schoolDays(today, 1, 16, zone);
  const past = schoolDays(addDays(today, -1, zone), -1, 16, zone);
  // Never out of school days in practice; the calendar's days, should the search come back short.
  const ahead = (n: number): DateStr => coming[n] ?? addDays(today, n + 1, zone);
  const behind = (n: number): DateStr => past[n] ?? addDays(today, -(n + 1), zone);
  const comingDays = Array.from({ length: 16 }, (_v, n) => ahead(n));
  const pastDays = Array.from({ length: 16 }, (_v, n) => behind(n));

  // The substitute on the first school day from today, the cancellation on the next.
  const substituteOn = ahead(0);
  const cancelledOn = ahead(1);
  const lessons = feedLessons(today, zone, substituteOn, cancelledOn);
  const changeSeen: ChangeSightings = {};
  const substituted = lessons.find((l) => l.status === 'substitution');
  const cancelled = lessons.find((l) => l.status === 'cancelled');
  if (substituted) changeSeen[changeKey(substituted)] = ago(now, 45);
  if (cancelled) changeSeen[changeKey(cancelled)] = ago(now, 180);

  const exams: ClassExam[] = [
    { naturalKey: 'demo-exam|math', date: firstWith('math', comingDays, 3, zone) ?? null, subject: 'מבחן במתמטיקה', details: 'פונקציות וחקירת פונקציה' },
    { naturalKey: 'demo-exam|english', date: firstWith('english', comingDays, 7, zone) ?? null, subject: 'בוחן באנגלית', details: 'אוצר מילים, יחידות 3 ו־4' },
    { naturalKey: 'demo-exam|history', date: firstWith('history', comingDays, 12, zone) ?? null, subject: 'מבחן בהיסטוריה', details: 'הקמת המדינה' },
  ];
  const events: ClassEvent[] = [
    { naturalKey: 'demo-event|sports', date: ahead(4), title: 'יום ספורט שכבתי', details: 'בתלבושת ספורט, עם כובע ובקבוק מים' },
    { naturalKey: 'demo-event|parents', date: ahead(9), title: 'אסיפת הורים', details: 'משעה 17:00, בכיתות' },
  ];
  const feed: ClassFeed = {
    class: { siteUrl: DEMO_SITE, classId: DEMO_CLASS.id, className: DEMO_CLASS.name, examCalendarId: null },
    lastOkAt: ago(now, 12),
    freshness: ago(now, 200),
    lessons,
    changes: [],
    exams,
    events,
    messages: [],
  };

  const homework: [string, SubjectId, DateStr, string][] = [
    ['demo-hw|lab', 'biology', ahead(0), 'לסיים את דוח המעבדה על התא'],
    ['demo-hw|math', 'math', ahead(1), 'תרגילים 4 עד 9 בעמוד 112'],
    ['demo-hw|english', 'english', ahead(1), 'לקרוא את הפרק השלישי ולענות על שאלות 1 עד 5'],
    ['demo-hw|literature', 'literature', ahead(1), 'פסקה על הדמות הראשית בסיפור'],
    ['demo-hw|physics', 'physics', ahead(3), 'דף עבודה על תנועה במעגל'],
    ['demo-hw|history', 'history', ahead(5), 'סיכום של הפרק על הקמת המדינה'],
  ];
  // Two to four grades a subject over the last three weeks, so each has an average; two of them exams.
  const grades: [string, SubjectId, DateStr, number, string][] = [
    ['demo-1', 'math', behind(1), 92, 'מבחן במשוואות'],
    ['demo-7', 'math', behind(6), 85, 'בוחן בפונקציה ריבועית'],
    ['demo-8', 'math', behind(13), 88, 'עבודה בסדרות'],
    ['demo-2', 'english', behind(3), 88, 'בוחן אוצר מילים'],
    ['demo-9', 'english', behind(10), 91, 'חיבור: מכתב רשמי'],
    ['demo-3', 'physics', behind(4), 95, 'עבודת מעבדה'],
    ['demo-10', 'physics', behind(9), 82, 'בוחן בקינמטיקה'],
    ['demo-11', 'physics', behind(14), 87, 'דף עבודה בווקטורים'],
    ['demo-4', 'history', behind(7), 84, 'עבודה על מלחמת העולם השנייה'],
    ['demo-12', 'history', behind(12), 90, 'בוחן על הצהרת בלפור'],
    ['demo-13', 'biology', behind(2), 94, 'דוח מעבדה: מיקרוסקופ'],
    ['demo-5', 'biology', behind(9), 90, 'מבחן על התא'],
    ['demo-14', 'literature', behind(5), 89, 'עבודה על השיר'],
    ['demo-6', 'literature', behind(12), 81, 'בוחן קריאה'],
    ['demo-15', 'bible', behind(8), 93, 'בוחן בספר שמואל'],
    ['demo-16', 'bible', behind(15), 86, 'עבודה על דמותו של דוד'],
  ];
  const sports = ahead(4);
  const messages: [string, string, string, string, string][] = [
    ['demo-msg|sports', T.homeroom, at(behind(0), '15:10', zone), 'יום ספורט שכבתי',
      // Its time is the day's start and its "להביא" what to take: the message's summary line reads them.
      `שלום לכולם, ב${weekdayNameHe(sports, zone)} יתקיים יום ספורט שכבתי. נפגשים ב־08:00 במגרש, בתלבושת ספורט. צריך להביא כובע ובקבוק מים.`],
    ['demo-msg|math', T.math, at(behind(1), '12:40', zone), 'חומר למבחן במתמטיקה',
      'המבחן יכלול פונקציות וחקירת פונקציה, עמודים 80 עד 112 בספר. בשיעור הקרוב נעשה חזרה. למבחן צריך להביא מחשבון.'],
    ['demo-msg|history', T.history, at(behind(3), '18:05', zone), 'המצגת בהיסטוריה',
      'תזכורת: את המצגת על הקמת המדינה מגישים עד סוף השבוע הבא. אפשר לעבוד בזוגות.'],
  ];
  // The nth school day behind today with a lesson of the subject, and the absence or late in its first period.
  // One in homeroom, which the tracker lists first (the fewest absences allowed), so its top row has one.
  const absences: [SubjectId, number, 'absence' | 'late', string | null][] = [
    ['homeroom', 1, 'absence', null],
    ['pe', 0, 'late', null],
    ['math', 2, 'absence', 'אישור רפואי'],
    ['math', 8, 'absence', null],
    ['physics', 5, 'absence', null],
    ['english', 1, 'late', null],
    ['english', 6, 'late', null],
    ['history', 3, 'late', null],
  ];
  const { semesterStart } = currentSemester(today);
  const counted = Object.keys(LINES) as SubjectId[];

  const mashov: NormalizedEntity[] = [
    ...slots(),
    ...homework.map(([key, id, dueDate, text]) =>
      entity<MashovHomework>('homework', key, { naturalKey: key, dueDate, dueExplicit: true, subject: LINES[id].subject, text })),
    // As `readMashov` has it: a graded exam is a grade only, never an exam too.
    ...grades.map(([key, id, date, value, notes]) => {
      const grade: MashovGrade = {
        naturalKey: `mashov-grade|${key}`, date, subject: LINES[id].subject, value, valueText: null, weight: null, notes, isExam: /מבחן|בחינה/.test(notes),
      };
      return entity('grade', grade.naturalKey, grade);
    }),
    ...messages.map(([key, from, date, title, body]) =>
      entity<MashovMessage>('message', key, { naturalKey: key, date, title, body, from, bodyFor: date })),
    ...absences.flatMap(([id, nth, kind, justification]) => {
      const date = pastDays.filter((d) => periodsOf(id, d, zone).length > 0)[nth];
      if (!date) return [];
      const event: AttendancePayload = {
        date, hour: periodsOf(id, date, zone)[0] ?? null, kind, justified: justification !== null, justification,
        groupId: LINES[id].groupId, subject: LINES[id].subject,
      };
      return [entity('attendance', `demo-att|${date}|${id}|${kind}`, event)];
    }),
    ...counted.map((id) => entity<LessonCountPayload>('lesson_count', `mashov-count|${LINES[id].groupId}`, {
      groupId: LINES[id].groupId, subject: LINES[id].subject, held: lessonsHeld(id, semesterStart, today, zone), weeklyHours: weeklyHours(id),
    })),
  ];

  const note = (id: number, type: NotificationType, title: string, body: string, payload: Record<string, unknown>, sentAt: string): NotificationLogEntry =>
    ({ id, type, title, body, payload: { type, refreshWidget: true, ...payload }, sentAt });
  const cancelledName = cancelled ? `${weekdayNameHe(cancelled.date, zone)}, שיעור ${cancelled.hourIndex}: ${cancelled.subject} מבוטל` : null;
  const notifications: NotificationLogEntry[] = [
    ...(cancelled && cancelledName
      ? [note(3, 'schedule_change_tomorrow', 'שינוי במערכת', cancelledName, { deepLink: 'today', date: cancelled.date }, ago(now, 180))]
      : []),
    note(2, 'new_homework', 'שיעורי בית באנגלית', 'לקרוא את הפרק השלישי ולענות על שאלות 1 עד 5', { deepLink: 'school', tab: 'homework' }, at(behind(0), '15:05', zone)),
    note(1, 'new_grade', 'ציון חדש במתמטיקה', '92, מבחן במשוואות', { deepLink: 'school', tab: 'grades' }, at(behind(1), '16:20', zone)),
  ];

  return {
    feed,
    mashov,
    bagrut: bagrut(today, zone),
    google: google(today, ahead, behind, zone),
    changeSeen,
    homeworkState: { 'demo-hw|literature': { done: true, linkedTaskId: null } },
    notifications,
    pastDays,
  };
}

/**
 * What "מצב חיבורים" and every screen that asks are told: each source
 * connected and read a few minutes ago, with nothing to say.
 */
export function demoStatus(now: Date): StatusResponse {
  const lastOkAt = ago(now, 4);
  const connected = (source: SourceStatus['source']): SourceStatus => ({
    source, configured: true, state: 'ok', lastOkAt, consecutiveFailures: 0, degradedSince: null, lastError: null, message: null,
    account: null, sourceFreshness: null, needsReauth: false,
  });
  return { serverTime: now.toISOString(), sources: [connected('shahaf'), connected('mashov'), connected('google_calendar'), connected('google_tasks')] };
}

/**
 * What entering the demo sets: its class, the notifications as a new student
 * has them, and no exams in a Google calendar: the demo writes nothing to
 * Google, so no screen may say its exams are there (Settings keeps it off).
 */
export function demoSettings(settings: UserSettings): UserSettings {
  return {
    ...settings, classId: DEMO_CLASS.id, className: DEMO_CLASS.name, notifications: { ...DEFAULT_SETTINGS.notifications }, examsToCalendar: false,
  };
}
