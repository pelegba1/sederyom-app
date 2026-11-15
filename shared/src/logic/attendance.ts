/**
 * The absence tracker (חיסורים), as one pure function over Mashov's counts and
 * attendance events, the student's weekly grid and the attendance settings.
 * The server's `GET /school/attendance` and the phone (plan Phase 2, a
 * friend's phone) build the same response with it.
 *
 * "Ahead" is the student's own weekly grid from Mashov (`timetable_slot`),
 * walked day by day from tomorrow to `semesterEnd`, skipping every day that is
 * not a school day (`schoolDayInfo`: Shabbat, chag, the Ministry's vacations)
 * and the owner's own days off. Today is left out: Mashov's count already
 * has whatever lessons of today were reported.
 */
import type {
  AttendanceDayOff, AttendanceEvent, AttendanceResponse, AttendanceSubject, AttendanceSettings, DateStr,
} from '../index';
import type { AttendancePayload, LessonCountPayload } from './mashov/attendance';
import { subjectsMatch } from './subjects';
import { addDays, schoolDayInfo, sundayIndex } from './time';

/** The weekly grid's part this view needs. */
export interface SlotLike {
  dayOfWeek: number;
  subject: string;
}

export interface AttendanceInput {
  counts: LessonCountPayload[];
  events: AttendancePayload[];
  slots: SlotLike[];
  settings: AttendanceSettings;
  today: DateStr;
  zone: string;
  fetchedAt: string | null;
}

/** School days from tomorrow to the semester's end, and the days off among them. */
export function daysAhead(settings: AttendanceSettings, today: DateStr, zone: string): { schoolDays: DateStr[]; daysOff: AttendanceDayOff[] } {
  const own = new Set(settings.daysOff);
  const schoolDays: DateStr[] = [];
  const daysOff: AttendanceDayOff[] = [];
  for (let date = addDays(today, 1, zone); date <= settings.semesterEnd; date = addDays(date, 1, zone)) {
    if (own.has(date)) {
      daysOff.push({ date, name: 'יום חופש שלך', own: true });
      continue;
    }
    const info = schoolDayInfo(date, zone);
    if (info.isSchoolDay) schoolDays.push(date);
    // Shabbat goes without saying.
    else if (sundayIndex(date, zone) !== 6) daysOff.push({ date, name: info.holidayName ?? 'חופש', own: false });
  }
  return { schoolDays, daysOff };
}

/** Lessons ahead per group: its weekly slots on each school day, or `weeklyHours` over Sunday–Thursday when the grid has none. */
export function remainingLessons(
  counts: LessonCountPayload[],
  slots: SlotLike[],
  schoolDays: DateStr[],
  zone: string,
): Map<string, Remaining> {
  const perDay = new Map<string, number[]>();
  for (const slot of slots) {
    const days = perDay.get(slot.subject) ?? [0, 0, 0, 0, 0, 0, 0];
    days[slot.dayOfWeek] = (days[slot.dayOfWeek] ?? 0) + 1;
    perDay.set(slot.subject, days);
  }
  const dows = schoolDays.map((d) => sundayIndex(d, zone));
  const out = new Map<string, Remaining>();
  for (const count of counts) {
    // The grid and the count both name a group by Mashov's subject; the loose match covers a
    // timetable row that spells it its own way ("פיזיקה מורחב" against "פיזיקה").
    const days = perDay.get(count.subject)
      ?? [...perDay].find(([subject]) => subjectsMatch(subject, count.subject))?.[1];
    if (days) {
      out.set(count.groupId, { lessons: dows.reduce((sum, dow) => sum + (days[dow] ?? 0), 0), from: 'grid' });
    } else {
      const weekdays = dows.filter((dow) => dow <= 4).length;
      out.set(count.groupId, { lessons: Math.round(((count.weeklyHours ?? 0) * weekdays) / 5), from: 'weeklyHours' });
    }
  }
  return out;
}

export interface Remaining {
  lessons: number;
  from: AttendanceSubject['remainingFrom'];
}

export function buildAttendance(input: AttendanceInput): AttendanceResponse {
  const { counts, events, slots, settings, today, zone } = input;
  const { schoolDays, daysOff } = daysAhead(settings, today, zone);
  const remaining = remainingLessons(counts, slots, schoolDays, zone);
  const inSemester = events.filter((e) => e.date >= settings.semesterStart && e.date <= settings.semesterEnd);

  const subjects: AttendanceSubject[] = counts.map((count) => {
    const mine = inSemester.filter((e) => e.groupId === count.groupId);
    const tally = (kind: AttendanceEvent['kind'], justified: boolean) => mine.filter((e) => e.kind === kind && e.justified === justified).length;
    return {
      groupId: count.groupId,
      subject: count.subject,
      held: count.held,
      remaining: remaining.get(count.groupId)?.lessons ?? 0,
      remainingFrom: remaining.get(count.groupId)?.from ?? 'weeklyHours',
      weeklyHours: count.weeklyHours,
      absences: tally('absence', false),
      lates: tally('late', false),
      justifiedAbsences: tally('absence', true),
      justifiedLates: tally('late', true),
      events: mine
        .map(({ date, hour, kind, justified, justification }) => ({ date, hour, kind, justified, justification }))
        .sort((a, b) => (a.date === b.date ? (b.hour ?? 0) - (a.hour ?? 0) : a.date < b.date ? 1 : -1)),
    };
  });
  subjects.sort((a, b) => a.subject.localeCompare(b.subject, 'he'));

  return {
    semesterStart: settings.semesterStart,
    semesterEnd: settings.semesterEnd,
    limit: settings.limitPercent / 100,
    latesPerAbsence: settings.latesPerAbsence,
    subjects,
    daysOffAhead: daysOff,
    fetchedAt: input.fetchedAt,
  };
}
