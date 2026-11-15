/**
 * The morning summary and the evening reminder, as text and as a decision
 * (plan Phase 2): what they say, and whether a day gets one at all.
 *
 * Every phone schedules them for itself from the days it builds
 * (app/src/notify/summaries.ts). Pure: day views and settings in, the push out.
 * Reading the days, the homework behind tasks and Classroom stays with the
 * phone, and so does the sending.
 *
 * ## The morning summary (design-doc §5.3)
 *
 * One rich push on school days at the configured time. Skips Saturday,
 * holidays and vacation mode.
 *
 * The title is the news (W4-11) — what a student wants from the lock screen
 * before reading on:
 *
 *   הלימודים נגמרים ב־10:30 · 4 בוטלו   ← cancellations end the day early
 *   הלימודים מתחילים ב־10:00 · 2 בוטלו  ← …or start it late
 *   08:00–14:10 · 7 שיעורים          ← nothing cancelled
 *
 * The body is at most three short lines (R-1):
 *
 *   08:00–10:30 · פיזיקה              ← what still takes place, subjects once each
 *   להגשה היום: אנגלית, מתמטיקה       ← open homework due today
 *   ביומן: משמרת בגלידריה ×2          ← then exams, the calendar, the tasks
 *
 * The clock span leads the first line only when the title does not already
 * carry it. Subjects are named as the app names them (`plainSubject`), and
 * a name the student gave one on the phone as they typed it.
 *
 * ## The evening reminder (plan R12)
 *
 * At `eveningReminderTime`, what is due on the next school day — "מחר
 * להגיש: היסטוריה, מתמטיקה" — and that day's exam when there is one. Google
 * Tasks has dates but no times, so this is the reminder a student gets
 * instead of one per task.
 *
 * The next school day (W4-1) is not always tomorrow. On the last school day
 * before a break — a Thursday, the eve of a holiday — the reminder is about
 * the day school resumes: "ביום ראשון להגיש: …", "ביום ראשון מבחן ב…". The
 * evenings inside the break say nothing (that day was already announced),
 * except the last one, which is "מחר" again; Friday evening never says
 * anything. `eveningTarget` decides, over the day views `nextSchoolDay`
 * reads, so the reminder, the widget and Today agree on which day is next.
 *
 * Unlike the morning summary it respects quiet hours, and it says nothing when
 * nothing is due (an exam two days off counts as due; see W6-10 below).
 *
 * Homework the student turned into a task leaves the day's homework (the task
 * stands for it), so it is read back off that day's tasks: an open task with
 * a `linkedHomeworkKey` is homework due, named by its homework's subject.
 * Other tasks due that day follow the homework when the lines have room.
 *
 * What is still open on the evening's own day closes the body (W5-1): "עוד
 * לא סימנת: פיזיקה (להיום)" — homework due today that was not ticked off,
 * and open tasks due today. It says "להיום" whichever day the reminder is
 * about, so it reads the same under "מחר" and under "ביום ראשון". It adds to
 * a reminder that goes out anyway and is never a reason to send one: an
 * evening with nothing due on the next school day stays quiet.
 *
 * An exam a few days off gets a line of its own (W6-10): "בעוד 3 ימים: מבחן
 * באנגלית" — the owner's exams on the nearest day two to four days from this
 * evening, other than the day the reminder is about (its exam has a line
 * already). The count is from the evening, so it says the same thing however
 * far the next school day is. It follows the exam line, before the line about
 * today: what is due, then what is coming, then what is still open. Two days
 * out it is worth an evening on its own; three or four days out it only rides
 * along, or one exam would fill four evenings in a row.
 *
 * Classroom work due on the day (plan §14.5) is homework too: on the same
 * line, by subject, unless it was handed in. A "עשיתי" on the phone is not
 * known on the server, so work marked only there is still named.
 *
 * What goes in the bag (ideas פ2): "מחר לתיק: מחשבון, בגדי ספורט", what the
 * student wrote for each subject taught on the day, as the day is after the
 * changes (a cancelled PE lesson takes its sports clothes out). Unlike an
 * exam further off it is a reason to send: alone it is the title, and with
 * anything else it takes a line before the line about today.
 */
import type {
  Audience, CalendarEvent, ClassroomWork, DateStr, DayView, Exam, Lesson, NotificationType, PushPayload, Task, TimelineItem, TimeStr, UserSettings,
} from '../index';
import { UNDISABLEABLE } from '../index';
import { daysBetween, holdsSchool, nextSchoolDay } from './build';
import { examSubjectKey } from './exam-match';
import { canonicalSubject, plainSubject } from './subjects';
import { addDays, isInQuietHours, sundayIndex } from './time';

/** A push as either side sends it: the server through Expo, a phone as a local notification. */
export interface SummaryPush {
  title: string;
  body: string;
  payload: PushPayload;
}

// ---- the rules every notification follows ----

export function isEnabled(settings: UserSettings, type: NotificationType): boolean {
  if (UNDISABLEABLE.includes(type)) return true;
  return settings.notifications[type] === true;
}

/** Quiet hours defer everything except the morning summary (design-doc §7). */
export function isSuppressedByQuietHours(type: NotificationType, settings: UserSettings, nowTime: string): boolean {
  if (!settings.quietHours.enabled) return false;
  if (type === 'morning_summary') return false;
  const { from, to } = settings.quietHours;
  return isInQuietHours(nowTime, from, to);
}

// ---- the morning summary ----

/** The body never runs longer than this. */
const MORNING_MAX_LINES = 3;
/** Subjects named on the lessons line before "ועוד N". */
const LESSON_SUBJECTS_SHOWN = 4;
/** Subjects named on the homework line before "ועוד N". */
const HOMEWORK_SUBJECTS_SHOWN = 3;
/** Calendar events named before "ועוד N". */
const EVENTS_SHOWN = 2;

export function composeMorningSummary(day: DayView, opts: { audience?: Audience } = {}): SummaryPush {
  const lessons = day.timeline
    .filter((i): i is Extract<TimelineItem, { kind: 'lesson' }> => i.kind === 'lesson')
    .map((i) => i.lesson);
  const events = day.timeline
    .filter((i): i is Extract<TimelineItem, { kind: 'event' }> => i.kind === 'event')
    .map((i) => i.event);
  const tasks = day.timeline.filter((i): i is Extract<TimelineItem, { kind: 'task' }> => i.kind === 'task');

  // The day is the lessons that still take place; the cancelled ones are a count.
  const held = lessons.filter((l) => l.status !== 'cancelled');
  const { title, spanShown } = opts.audience === 'parent' ? parentHeadline(lessons, held) : headline(lessons, held);

  const lines: string[] = [];
  if (held.length > 0) {
    const span = clockSpan(held);
    lines.push(span && !spanShown ? `${span.from}–${span.to} · ${lessonSubjects(held)}` : lessonSubjects(held));
  }

  const due = day.homework.filter((h) => !h.done);
  if (due.length > 0) lines.push(`להגשה היום: ${listedNames(shownSubjects(due), HOMEWORK_SUBJECTS_SHOWN)}`);

  // Only as far as the room left reaches.
  const extras = [
    day.examsToday.length > 0 ? `מבחן היום: ${examNames(day.examsToday)}` : null,
    day.examsTomorrow.length > 0 ? `מבחן מחר: ${examNames(day.examsTomorrow)}` : null,
    events.length > 0 ? `ביומן: ${listedNames(eventNames(events), EVENTS_SHOWN)}` : null,
    tasks.length > 0 ? plural(tasks.length, 'משימה אחת להיום', 'משימות להיום') : null,
  ];
  for (const line of extras) if (line && lines.length < MORNING_MAX_LINES) lines.push(line);

  return {
    title,
    body: lines.slice(0, MORNING_MAX_LINES).join('\n'),
    payload: { type: 'morning_summary', deepLink: 'today', date: day.date, refreshWidget: true },
  };
}

/**
 * The morning summary for `day`, or null for a morning that gets none: the
 * switch is off, or the day holds no school — a holiday, a Saturday, "חופש"
 * (the day is no school day in vacation mode) or a Friday without lessons.
 * The same rule as the evening reminder's. Quiet hours do not apply to it.
 */
export function planMorningSummary(day: DayView, settings: UserSettings, zone: string): SummaryPush | null {
  if (!settings.notifications.morning_summary) return null;
  if (!holdsSchool(day, zone)) return null;
  return composeMorningSummary(day, { audience: settings.audience });
}

/**
 * A parent's title (docs/parents-plan.md): the hour school ends, every day,
 * since that is when someone comes to pick the child up: "היום מסיימים
 * ב־12:20", and after it the cancellations, counted as the student's title
 * counts them. The body's first line then carries the whole span. With no
 * lesson left, or no times, the title is the student's.
 */
function parentHeadline(lessons: Lesson[], held: Lesson[]): { title: string; spanShown: boolean } {
  const kept = clockSpan(held);
  if (held.length === 0 || !kept) return headline(lessons, held);
  const cancelled = lessons.length - held.length;
  const head = `היום מסיימים ב־${kept.to}`;
  if (cancelled === 0) return { title: head, spanShown: false };
  return { title: `${head} · ${cancelled === 1 ? 'שיעור אחד בוטל' : `${cancelled} בוטלו`}`, spanShown: false };
}

/**
 * The title, and whether it shows the whole clock span of the day (so the
 * body need not repeat it):
 *
 *  - nothing cancelled: "08:00–14:10 · 7 שיעורים";
 *  - the day now ends early: "הלימודים נגמרים ב־10:30 · 4 בוטלו" ("נגמר" alone left
 *    Maya asking what ends, run 4);
 *  - it now starts late: "הלימודים מתחילים ב־10:00 · 2 בוטלו";
 *  - both, or a gap in the middle: "10:00–12:30 · 4 בוטלו";
 *  - every lesson cancelled: "אין שיעורים היום · 7 בוטלו";
 *  - no clock times in the timetable: the count, "7 שיעורים · 2 בוטלו".
 */
function headline(lessons: Lesson[], held: Lesson[]): { title: string; spanShown: boolean } {
  const cancelled = lessons.length - held.length;
  const gone = cancelled === 1 ? 'שיעור אחד בוטל' : `${cancelled} בוטלו`;
  const withGone = (head: string) => (cancelled > 0 ? `${head} · ${gone}` : head);

  if (held.length === 0) return { title: withGone('אין שיעורים היום'), spanShown: true };
  const kept = clockSpan(held);
  const count = plural(held.length, 'שיעור אחד', 'שיעורים');
  if (!kept) return { title: withGone(count), spanShown: true };
  if (cancelled === 0) return { title: `${kept.from}–${kept.to} · ${count}`, spanShown: true };

  // The timetable as published, cancelled lessons included: what changed about the day's edges.
  const planned = clockSpan(lessons) ?? kept;
  const late = kept.from > planned.from;
  const early = kept.to < planned.to;
  if (early && !late) return { title: `הלימודים נגמרים ב־${kept.to} · ${gone}`, spanShown: false };
  if (late && !early) return { title: `הלימודים מתחילים ב־${kept.from} · ${gone}`, spanShown: false };
  return { title: `${kept.from}–${kept.to} · ${gone}`, spanShown: true };
}

/** From the first start to the last end; null when the timetable has no times. */
function clockSpan(lessons: Lesson[]): { from: string; to: string } | null {
  const starts = lessons.map((l) => l.startTime).filter((t): t is string => Boolean(t)).sort();
  const ends = lessons.map((l) => l.endTime).filter((t): t is string => Boolean(t)).sort();
  if (starts.length === 0 || ends.length === 0) return null;
  return { from: starts[0]!, to: ends[ends.length - 1]! };
}

/** What the summaries name a subject from: `subject` is shown, `originalSubject` set when it is a name the student gave. */
interface SubjectLike {
  subject: string;
  originalSubject?: string;
}

/**
 * A subject as the summaries name it: a name the student gave (on the phone,
 * `originalSubject` set) as they typed it; any other as the app names it
 * (`plainSubject`, without its level or group).
 */
function shownPlain(item: SubjectLike): string {
  return item.originalSubject !== undefined ? item.subject : plainSubject(item.subject);
}

/** One subject, whatever it is shown as: by the source's name (`canonicalSubject`), as `plainSubjects` tells them apart. */
function subjectGroup(item: SubjectLike): string {
  const source = item.originalSubject ?? item.subject;
  return canonicalSubject(source) || source;
}

/** Each subject once (`subjectGroup`), in first-seen order, named as `shownPlain` names it. */
function shownSubjects(items: readonly SubjectLike[]): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const key = subjectGroup(item);
    if (!seen.has(key)) seen.set(key, shownPlain(item));
  }
  return unique([...seen.values()]);
}

/**
 * "פיזיקה, אנגלית (מ״מ)" — each subject once, without its level or group,
 * in timetable order; a change other than a cancellation is named after it:
 * the change of the subject's first lesson that changed. Two subjects shown
 * under one name (a block the student named "פיזיקה", beside the physics
 * line) are said once, as one subject's lessons are.
 */
function lessonSubjects(held: Lesson[]): string {
  // `at`: the lesson whose change it is, in timetable order.
  const bySubject = new Map<string, { name: string; change: string | null; at: number }>();
  held.forEach((lesson, at) => {
    const key = subjectGroup(lesson);
    const entry = bySubject.get(key) ?? { name: shownPlain(lesson), change: null, at };
    if (entry.change === null && lesson.status !== 'regular') {
      entry.change = statusWord(lesson.status);
      entry.at = at;
    }
    bySubject.set(key, entry);
  });
  const byName = new Map<string, { change: string | null; at: number }>();
  for (const { name, change, at } of bySubject.values()) {
    const seen = byName.get(name);
    // A Map keeps the place a name was first set at.
    if (!seen || (change !== null && (seen.change === null || at < seen.at))) byName.set(name, { change, at });
  }
  const names = [...byName].map(([name, s]) => (s.change ? `${name} (${s.change})` : name));
  return listedNames(names, LESSON_SUBJECTS_SHOWN);
}

/**
 * "משמרת בגלידריה ×2" — an event once, however many calendars or copies
 * carry it, in the day's order.
 */
function eventNames(events: CalendarEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const name = event.summary.replace(/\s+/g, ' ').trim() || 'אירוע';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
}

/**
 * The subject a summary names an exam by, "אנגלית" for "מבחן באנגלית"; `''`
 * when its title names none. On the phone, a name the student gave the
 * subject (`Exam.subjectName`) is that name, as typed: "מבחן היום: פיזיקה";
 * a name they gave this exam alone (`originalSubject` set, no `subjectName`)
 * is said in full.
 */
function summarySubject(exam: Exam): string {
  if (exam.subjectName !== undefined) return exam.subjectName;
  return exam.originalSubject !== undefined ? '' : examSubjectKey(exam.subject);
}

/** "אנגלית" for "מבחן באנגלית"; the title itself when it names no subject. */
function examNames(exams: Exam[]): string {
  return [...new Set(exams.map((e) => summarySubject(e) || e.subject))].join(', ');
}

/** "א, ב, ג ועוד 2". */
function listedNames(names: string[], shown: number): string {
  const head = names.slice(0, shown).join(', ');
  return names.length > shown ? `${head} ועוד ${names.length - shown}` : head;
}

/** "שיעור אחד" / "7 שיעורים" — Appendix א: numbers through `plural`. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

function statusWord(status: string): string {
  switch (status) {
    case 'substitution': return 'מ״מ';
    case 'moved': return 'הועבר';
    case 'remote': return 'מרחוק';
    case 'exam': return 'מבחן';
    default: return 'שינוי';
  }
}

// ---- the evening reminder ----

/**
 * How many lines the body lists before "ועוד N": the homework due, the line
 * about today when there is one, and other tasks into what is left.
 */
const EVENING_MAX_LINES = 3;

/** How many names the line about today lists before "ועוד N". */
const MAX_OPEN_NAMES = 3;

/** How many days from the evening an exam ahead is named, at the nearest and the furthest (W6-10). */
const SOON_FROM = 2;
const SOON_UNTIL = 4;

/** An exam this close is worth an evening of its own; further off it only joins a reminder that goes out anyway. */
const SOON_ALONE_UNTIL = 2;

/** The homework behind a task, as the reminder names it. */
export interface LinkedHomework {
  subject: string;
  /** On the phone, with the student's own name in `subject`: the name Mashov gave it. */
  originalSubject?: string;
  text: string;
  done: boolean;
}

interface DueLine {
  subject: string;
  line: string;
}

/** The day an evening's reminder is about, and how the reminder says it ("מחר", "ביום ראשון"). */
export interface EveningTarget {
  day: DayView;
  when: string;
}

/** The owner's exams on one day a few days off, and how many days from the evening that is (W6-10). */
export interface ExamsSoon {
  exams: Exam[];
  daysAway: number;
}

/** Friday evening is Shabbat: no reminder, whatever is due on Sunday. */
export function isQuietEvening(date: DateStr, zone: string): boolean {
  return sundayIndex(date, zone) === 5;
}

/**
 * Whether the evening of `date` gets no reminder whatever is due, by what is
 * known before any day is read: the switch, "חופש", quiet hours at `time`
 * (deferring it past them would deliver "tomorrow" on the day itself), and
 * Friday evening.
 */
export function eveningReminderOff(settings: UserSettings, date: DateStr, time: TimeStr, zone: string): boolean {
  if (!isEnabled(settings, 'evening_homework')) return true;
  // "חופש" pauses everything about school.
  if (settings.vacationMode) return true;
  if (isSuppressedByQuietHours('evening_homework', settings, time)) return true;
  return isQuietEvening(date, zone);
}

/**
 * Which day this evening's reminder is about, or null for an evening that
 * gets none. `today` is this evening's day; `ahead` the days after it (at
 * least `NEXT_SCHOOL_DAY_WITHIN` of them for a long break to be seen through).
 *
 *  - The next school day is tomorrow: "מחר" — an ordinary evening, Saturday
 *    night, the last night of a holiday.
 *  - It is further off and today held school: the eve of the break, named by
 *    its weekday — "ביום ראשון" on a Thursday, "ביום שלישי" before Yom Kippur.
 *  - It is further off and today was a day off too: nothing; the eve of the
 *    break already said it.
 *  - Friday evening, or no school day within reach: nothing.
 */
export function eveningTarget(today: DayView, ahead: readonly DayView[], zone: string): EveningTarget | null {
  if (isQuietEvening(today.date, zone)) return null;
  const next = nextSchoolDay(today.date, ahead, zone);
  if (!next) return null;
  if (next.date === addDays(today.date, 1, zone)) return { day: next, when: 'מחר' };
  if (!holdsSchool(today, zone)) return null;
  // A week off: "ביום שלישי" on a Tuesday would read as today.
  const nextWeek = daysBetween(today.date, next.date, zone) >= 7;
  return { day: next, when: `ב${next.weekdayName}${nextWeek ? ' הבא' : ''}` };
}

/**
 * The exams on the nearest of `ahead` that is `SOON_FROM`–`SOON_UNTIL` days
 * from `today`, leaving out `target` (the reminder's exam line names its
 * exams); null when there are none. The days' `examsToday` are the owner's
 * exams already, without the ones switched off.
 */
export function examsSoon(today: DayView, ahead: readonly DayView[], target: DayView, zone: string): ExamsSoon | null {
  const found = ahead
    .filter((d) => d.date !== target.date && d.examsToday.length > 0)
    .map((d) => ({ exams: d.examsToday, daysAway: daysBetween(today.date, d.date, zone) }))
    .filter((s) => s.daysAway >= SOON_FROM && s.daysAway <= SOON_UNTIL)
    .sort((a, b) => a.daysAway - b.daysAway);
  return found[0] ?? null;
}

/** How `composeEveningReminder` reads the day it is about, and the evening's own day. */
export interface EveningOptions {
  /** The homework behind the tasks on either day, by key (`linkedHomeworkKeys`). */
  linked?: ReadonlyMap<string, LinkedHomework>;
  /** How the reminder names the day: "מחר" (the default), or "ביום ראשון" after a break (`eveningTarget`). */
  when?: string;
  /** This evening's own day, for what is still open on it (`openToday`). */
  today?: DayView | null;
  /** An exam a few days off (`examsSoon`), for its line (W6-10). */
  soon?: ExamsSoon | null;
  /**
   * Classroom work due that day and not handed in (plan §14.5): homework like
   * Mashov's, on the same line, by its subject (or its course's name).
   */
  classroom?: readonly Pick<ClassroomWork, 'subject' | 'courseName' | 'title'>[];
  /** What the student brings to each subject, by `packKey` (ideas פ2): the bag's line. */
  pack?: Readonly<Record<string, string>>;
}

/** Most characters the bag's line lists before it is cut. */
const PACK_LINE_MAX = 90;

/** The key the student's "what to bring" is kept under: the subject as the app names it, whatever its group or level. */
export function packKey(subject: string): string {
  return canonicalSubject(subject) || plainSubject(subject);
}

/**
 * What goes in the bag for `day` (ideas פ2): what the student wrote for each
 * subject taught that day, as the day is after the changes (a cancelled
 * lesson brings nothing), in the day's order, each once.
 */
export function packItems(day: DayView, pack: Readonly<Record<string, string>>): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const item of day.timeline) {
    if (item.kind !== 'lesson' || item.lesson.status === 'cancelled') continue;
    // Kept under the source's name: a name the student gave the subject later does not lose it.
    const key = packKey(item.lesson.originalSubject ?? item.lesson.subject);
    const text = oneLine(pack[key] ?? '');
    if (!text || seen.has(key) || items.includes(text)) continue;
    seen.add(key);
    items.push(text);
  }
  return items;
}

/** "מחר לתיק: מחשבון, בגדי ספורט", or null when the day asks for nothing. */
function packPhrase(day: DayView, pack: Readonly<Record<string, string>>, when: string): string | null {
  const items = packItems(day, pack);
  return items.length > 0 ? truncate(`${when} לתיק: ${items.join(', ')}`, PACK_LINE_MAX) : null;
}

/**
 * The push for the evening before `day`, or null when nothing is due.
 * `day.homework` is every item due that day; the ones ticked off are left
 * out. `day.examsToday` is already the owner's exams only.
 *
 * The body lists the homework due, then other tasks, `EVENING_MAX_LINES`
 * lines in all, and the line about `today` (W5-1) and the line about an exam
 * a few days off (W6-10) each take one of them: they come before other tasks,
 * after the homework due. The exam line follows what is listed, then the
 * exam a few days off, and the line about today closes the body.
 *
 * With nothing due and no exam on `day`, an exam `SOON_ALONE_UNTIL` days off
 * is the headline; one further off is no reason to send.
 */
export function composeEveningReminder(day: DayView, options: EveningOptions = {}): SummaryPush | null {
  const { linked = new Map<string, LinkedHomework>(), when = 'מחר', today = null, soon = null, classroom = [], pack = {} } = options;
  const tasks = openTasks(day);
  const listed = new Set(day.homework.map((h) => h.naturalKey));

  const due: DueLine[] = [
    ...day.homework.filter((h) => !h.done).map((h) => homeworkLine(h, h.text)),
    ...tasks.flatMap((t) => linkedLine(t, linked, listed)),
    ...classroom.map((w) => homeworkLine({ subject: w.subject ?? w.courseName }, w.title)),
  ];
  const others = tasks
    .filter((t) => !t.linkedHomeworkKey)
    .sort(byTitle)
    .map((t) => `משימה: ${truncate(oneLine(t.title), 60)}`);
  const exams = day.examsToday;
  const soonAlone = soon !== null && soon.daysAway <= SOON_ALONE_UNTIL;
  // What goes in the bag is a reason to send of its own: the student wrote it to be reminded (ideas פ2).
  const packLine = packPhrase(day, pack, when);
  if (due.length === 0 && exams.length === 0 && !soonAlone && !packLine) return null;

  const subjects = unique(due.map((d) => d.subject));
  const examLine = exams.length > 0 ? examPhrase(exams, when) : null;
  const soonLine = soon ? soonPhrase(soon) : null;
  const stillOpen = today ? stillOpenLine(openToday(today, linked)) : null;
  // The lines about today, about the exam ahead and about the bag each take one of the lines, ahead
  // of other tasks; the homework due keeps one at least.
  const room = Math.max(1, EVENING_MAX_LINES - (stillOpen ? 1 : 0) - (soonLine ? 1 : 0) - (packLine && (due.length > 0 || examLine || soonAlone) ? 1 : 0));

  let title: string;
  const lines: string[] = [];
  // The day a tap opens on: the one the reminder is about.
  let date = day.date;
  if (due.length > 0) {
    title = `${when} להגיש: ${subjects.join(', ')}`;
    for (const d of due.slice(0, room)) lines.push(d.line);
    if (due.length > room) lines.push(`ועוד ${due.length - room}`);
    // Other tasks only into lines the homework left free.
    else lines.push(...others.slice(0, room - due.length));
    if (examLine) lines.push(examLine);
    if (soonLine) lines.push(soonLine);
    if (packLine) lines.push(packLine);
  } else if (examLine) {
    title = examLine;
    lines.push(...exams.map(examDetailLine));
    if (soonLine) lines.push(soonLine);
    if (packLine) lines.push(packLine);
  } else if (soonAlone) {
    // Only the exam ahead: the reminder is about its day.
    title = soonLine!;
    lines.push(...soon!.exams.map(examDetailLine));
    if (packLine) lines.push(packLine);
    date = soon!.exams[0]!.date;
  } else {
    // Only the bag: "מחר לתיק: מחשבון, בגדי ספורט", and an exam further off rides along.
    title = packLine!;
    if (soonLine) lines.push(soonLine);
  }
  if (stillOpen) lines.push(stillOpen);

  return {
    title,
    body: lines.join('\n'),
    payload: { type: 'evening_homework', deepLink: 'today', date, refreshWidget: true },
  };
}

/** What `planEveningReminder` needs beyond the days. */
export interface EveningPlanOptions {
  zone: string;
  /** The wall time the reminder goes out at, `HH:mm`, for quiet hours. */
  time: TimeStr;
  /** The homework behind the days' tasks, by key (`linkedHomeworkKeys`). */
  linked?: ReadonlyMap<string, LinkedHomework>;
  /** Classroom work due on the day the reminder is about; none on a phone. */
  classroom?: EveningOptions['classroom'];
  /** What the student brings to each subject (`packKey`). */
  pack?: EveningOptions['pack'];
}

/**
 * The whole evening decision over days already at hand: whether this
 * evening gets a reminder (`eveningReminderOff`, `eveningTarget`), which day
 * it is about, an exam a few days off, what is still open today, and the
 * push itself; null for an evening that stays quiet. `today` is the
 * evening's own day, `ahead` at least `NEXT_SCHOOL_DAY_WITHIN` days after it.
 */
export function planEveningReminder(
  today: DayView,
  ahead: readonly DayView[],
  settings: UserSettings,
  options: EveningPlanOptions,
): SummaryPush | null {
  const { zone, time, linked, classroom, pack } = options;
  if (eveningReminderOff(settings, today.date, time, zone)) return null;
  const target = eveningTarget(today, ahead, zone);
  // A Saturday or a holiday tomorrow, inside a break, or a long break ahead.
  if (!target) return null;
  const soon = examsSoon(today, ahead, target.day, zone);
  return composeEveningReminder(target.day, { linked, when: target.when, today, soon, classroom, pack });
}

// ---- a parent's children (parents mode, stage 2) ----

/** One child's morning, on a parent's phone with more than one: the child's name, day and own summary. */
export interface ChildMorning {
  label: string;
  day: DayView;
  push: SummaryPush;
}

/**
 * The most children a parent's title names. One line of a notification's
 * title holds about 40 letters, and three names with their times already
 * fill it: with more, the title says less, and the body still has a line
 * for each.
 */
const CHILDREN_NAMED = 3;

/**
 * A parent's morning summary on a phone with more than one child: when each
 * one ends in the title, "מסיימים היום: נועה ב־12:20, יואב ב־13:10", and a
 * line for each in the body, the name first: the hours, what was cancelled,
 * an exam today. With more than `CHILDREN_NAMED`, the title is when the
 * first and the last end, "מסיימים היום בין 12:20 ל־14:00". Only the
 * children with school that day are given (each one's `planMorningSummary`);
 * with one, that child's own summary after the name.
 */
export function childrenMorningSummary(parts: readonly ChildMorning[]): SummaryPush | null {
  const [first] = parts;
  if (!first) return null;
  if (parts.length === 1) return { ...first.push, title: `${first.label}: ${first.push.title}` };
  const ends: string[] = [];
  const times: string[] = [];
  let noLessons = 0;
  const lines: string[] = [];
  for (const { label, day } of parts) {
    const lessons = day.timeline.filter((i): i is Extract<TimelineItem, { kind: 'lesson' }> => i.kind === 'lesson').map((i) => i.lesson);
    const held = lessons.filter((l) => l.status !== 'cancelled');
    const span = clockSpan(held);
    const cancelled = lessons.length - held.length;
    if (held.length === 0) {
      ends.push(`${label} בלי שיעורים`);
      noLessons += 1;
    } else if (span) {
      ends.push(`${label} ב־${span.to}`);
      times.push(span.to);
    }
    const facts = [
      held.length === 0 ? 'אין שיעורים' : span ? `${span.from}–${span.to}` : plural(held.length, 'שיעור אחד', 'שיעורים'),
      cancelled === 0 ? null : cancelled === 1 ? 'שיעור אחד בוטל' : `${cancelled} בוטלו`,
      day.examsToday.length > 0 ? `מבחן היום: ${examNames(day.examsToday)}` : null,
    ];
    lines.push(`${label}: ${facts.filter(Boolean).join(', ')}`);
  }
  return {
    // No child's timetable has times: the first one's own title, as with one child.
    title: endsTitle(parts.length, ends, times, noLessons) ?? `${first.label}: ${first.push.title}`,
    // A line for each child: the list on the phone is short (`MAX_FOLLOWED_CLASSES`).
    body: lines.join('\n'),
    payload: first.push.payload,
  };
}

/**
 * The title of a parent's morning (`childrenMorningSummary`): each child's
 * end by name, or with more than `CHILDREN_NAMED` the first and the last
 * end. `null` when no child's timetable has times.
 */
function endsTitle(children: number, ends: readonly string[], times: readonly string[], noLessons: number): string | null {
  if (children <= CHILDREN_NAMED) return ends.length > 0 ? `מסיימים היום: ${ends.join(', ')}` : null;
  if (noLessons === children) return 'היום אין שיעורים';
  const sorted = [...times].sort();
  const [earliest, latest] = [sorted[0], sorted[sorted.length - 1]];
  if (!earliest || !latest) return null;
  return earliest === latest ? `מסיימים היום ב־${latest}` : `מסיימים היום בין ${earliest} ל־${latest}`;
}

/** One child's evening reminder, on a parent's phone with more than one. */
export interface ChildEvening {
  label: string;
  push: SummaryPush;
}

/**
 * A parent's evening reminder on a phone with more than one child: each
 * child's reminder on a line of its own, the name first, under "תזכורת ערב:
 * נועה, יואב", or with more than `CHILDREN_NAMED` under "תזכורת ערב ל־4
 * ילדים". Only the children with something to remind of are given; with one,
 * that child's own reminder after the name.
 */
export function childrenEveningReminder(parts: readonly ChildEvening[]): SummaryPush | null {
  const [first] = parts;
  if (!first) return null;
  if (parts.length === 1) return { ...first.push, title: `${first.label}: ${first.push.title}` };
  return {
    title: parts.length <= CHILDREN_NAMED ? `תזכורת ערב: ${parts.map((p) => p.label).join(', ')}` : `תזכורת ערב ל־${parts.length} ילדים`,
    body: parts.map((p) => `${p.label}: ${p.push.title}`).join('\n'),
    payload: first.push.payload,
  };
}

/** "מתכונת באנגלית · שאלון 016582": an exam by its own title, and its details on one line. */
function examDetailLine(exam: Exam): string {
  return [exam.subject, exam.details ? truncate(oneLine(exam.details), 60) : null].filter(Boolean).join(' · ');
}

/**
 * What is still open on `today`, by name, for the line about it (W5-1): the
 * subject of homework due today that was not ticked off — a task made from
 * homework counts as that homework, as on the day the reminder is about —
 * then the title of every other open task due today.
 */
export function openToday(today: DayView, linked: ReadonlyMap<string, LinkedHomework> = new Map()): string[] {
  const tasks = openTasks(today);
  const listed = new Set(today.homework.map((h) => h.naturalKey));
  const homework = [
    ...today.homework.filter((h) => !h.done).map((h) => homeworkLine(h, h.text)),
    ...tasks.flatMap((t) => linkedLine(t, linked, listed)),
  ];
  const others = tasks
    .filter((t) => !t.linkedHomeworkKey)
    .sort(byTitle)
    .map((t) => truncate(oneLine(t.title), 30));
  return unique([...homework.map((h) => h.subject), ...others]);
}

/** The keys of the homework behind the days' open tasks: what `linked` has to cover. */
export function linkedHomeworkKeys(days: readonly DayView[]): string[] {
  return unique(days.flatMap((day) => openTasks(day).flatMap((t) => (t.linkedHomeworkKey ? [t.linkedHomeworkKey] : []))));
}

/** "עוד לא סימנת: פיזיקה, אנגלית (להיום)", or null when nothing is open. */
function stillOpenLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_OPEN_NAMES).join(', ');
  const more = names.length > MAX_OPEN_NAMES ? ` ועוד ${names.length - MAX_OPEN_NAMES}` : '';
  return `עוד לא סימנת: ${shown}${more} (להיום)`;
}

/** The day's tasks that are not done. */
function openTasks(day: DayView): Task[] {
  return day.timeline
    .filter((i): i is Extract<TimelineItem, { kind: 'task' }> => i.kind === 'task')
    .map((i) => i.task)
    .filter((t) => !t.completed);
}

function byTitle(a: Task, b: Task): number {
  return a.title.localeCompare(b.title, 'he');
}

/** "מחר מבחן באנגלית"; a block exam by its title; several by count and subjects. */
function examPhrase(exams: Exam[], when: string): string {
  if (exams.length === 1) {
    const exam = exams[0]!;
    const subject = summarySubject(exam);
    return subject ? `${when} מבחן ב${subject}` : `${when}: ${exam.subject}`;
  }
  const names = unique(exams.map((e) => summarySubject(e) || e.subject));
  return `${when} ${exams.length} מבחנים: ${names.join(', ')}`;
}

/**
 * "בעוד 3 ימים: מבחן באנגלית", named as `examPhrase` names the exam on the
 * day the reminder is about: a block exam by its title, several by count and
 * subjects.
 */
function soonPhrase(soon: ExamsSoon): string {
  const when = soon.daysAway === 2 ? 'בעוד יומיים' : `בעוד ${soon.daysAway} ימים`;
  if (soon.exams.length === 1) {
    const exam = soon.exams[0]!;
    const subject = summarySubject(exam);
    return `${when}: ${subject ? `מבחן ב${subject}` : exam.subject}`;
  }
  const names = unique(soon.exams.map((e) => summarySubject(e) || e.subject));
  return `${when}: ${soon.exams.length} מבחנים (${names.join(', ')})`;
}

/**
 * Mashov names the group — "אנגלית 5 יח"ל (יב2)"; the reminder names the
 * subject, as the app does, and a name the student gave it as typed.
 */
function homeworkLine(item: SubjectLike, text: string): DueLine {
  const subject = shownPlain(item) || 'כללי';
  return { subject, line: `${subject}: ${truncate(oneLine(text), 60)}` };
}

/**
 * A task made from homework, as that homework: its subject and text, or the
 * task's own title when the homework is gone from Mashov. Nothing when the
 * homework was ticked off, or is listed on the day already.
 */
function linkedLine(task: Task, linked: ReadonlyMap<string, LinkedHomework>, listed: ReadonlySet<string>): DueLine[] {
  const key = task.linkedHomeworkKey;
  if (!key || listed.has(key)) return [];
  const homework = linked.get(key);
  if (homework) return homework.done ? [] : [homeworkLine(homework, homework.text)];
  const title = oneLine(task.title);
  return [{ subject: truncate(title, 30), line: truncate(title, 60) }];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
