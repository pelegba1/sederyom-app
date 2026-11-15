/**
 * The lesson cards: what was scheduled, and what the server saw change.
 *
 * A **slot** is one date and period with every one of the student's lines in
 * it. `backfill` rows (read back from the site, which keeps the grid and drops
 * the changes) only say a lesson was scheduled; a change counts only on a slot
 * whose every line the server itself observed.
 */
import type { ClassHistoryLesson, DateStr } from '../../index';
import { isHiddenLesson } from '../filters';
import { canonicalSubject, subjectKey } from '../subjects';
import { minutesOf, schoolDayInfo, weekStart, weekdayNameHe } from '../time';
import { UNNAMED_LESSON, shownNames, type ShownNames } from './names';
import { round1, schoolYearStart, soleLeader, type WrappedCard, type WrappedInput, type WrappedRecord } from './types';

export interface Slot {
  date: DateStr;
  hourIndex: number;
  /** The earliest start and the latest end among the lines; null when no line has one. */
  start: string | null;
  end: string | null;
  minutes: number | null;
  lines: ClassHistoryLesson[];
  /** The names the slot's subjects are shown under, one per subject, in the lines' order. */
  subjects: string[];
  /** Every line was seen by the server in real time. */
  observed: boolean;
  /** Observed, and every line was cancelled when it began: a free period. */
  cancelled: boolean;
}

export interface Day {
  date: DateStr;
  /** By period. */
  slots: Slot[];
}

const MIN_WEEKS = 4;
const MIN_CANCELLED = 5;
const MIN_LEADER = 3;
const MIN_SLEEP = 2;
const MIN_SUBSTITUTES = 3;

/**
 * The hour a lesson left: the site prints a moved lesson at both ends, and this row is the empty one
 * ("הועבר לשעה 4"). The lesson is counted where it landed.
 */
function movedAway(lesson: ClassHistoryLesson): boolean {
  return lesson.source === 'observed' && lesson.status === 'moved' && /^הועבר לשעה/.test(lesson.note ?? '');
}

/** The student's school days of this school year before `today`, oldest first. */
export function myDays(input: WrappedInput, names: ShownNames = shownNames(input)): Day[] {
  const from = schoolYearStart(input.today);
  const ownOff = new Set(input.ownDaysOff);
  const schoolDay = new Map<DateStr, boolean>();
  const isSchoolDay = (date: DateStr) => {
    let known = schoolDay.get(date);
    if (known === undefined) {
      known = !ownOff.has(date) && schoolDayInfo(date, input.zone).isSchoolDay;
      schoolDay.set(date, known);
    }
    return known;
  };

  const seen = new Set<string>();
  const slots = new Map<string, ClassHistoryLesson[]>();
  for (const lesson of input.history?.lessons ?? []) {
    if (lesson.date < from || lesson.date >= input.today) continue;
    if (isHiddenLesson(input.hiddenSubjects, lesson) || !isSchoolDay(lesson.date) || movedAway(lesson)) continue;
    // The phone adds each read to what it kept: the same row may be there twice.
    const id = `${lesson.date}|${lesson.hourIndex}|${subjectKey(lesson.subject)}|${lesson.teacher ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = `${lesson.date}|${lesson.hourIndex}`;
    const lines = slots.get(key);
    if (lines) lines.push(lesson);
    else slots.set(key, [lesson]);
  }

  const days = new Map<DateStr, Slot[]>();
  for (const lines of slots.values()) {
    const first = lines[0]!;
    const starts = lines.map((l) => l.startTime).filter((t): t is string => t !== null).sort();
    const ends = lines.map((l) => l.endTime).filter((t): t is string => t !== null).sort();
    const start = starts[0] ?? null;
    const end = ends[ends.length - 1] ?? null;
    const length = start && end ? minutesOf(end) - minutesOf(start) : 0;
    const observed = lines.every((l) => l.source === 'observed');
    const slot: Slot = {
      date: first.date, hourIndex: first.hourIndex, start, end, minutes: length > 0 ? length : null, lines, observed,
      subjects: subjectsOf(lines, names),
      cancelled: observed && lines.every((l) => l.status === 'cancelled'),
    };
    const day = days.get(first.date);
    if (day) day.push(slot);
    else days.set(first.date, [slot]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, slots: list.sort((a, b) => a.hourIndex - b.hourIndex) }));
}

/** One name per subject (two lines of one subject are one), and a name two subjects share said once. */
function subjectsOf(lines: readonly ClassHistoryLesson[], names: ShownNames): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const line of lines) {
    const key = canonicalSubject(line.subject) || line.subject;
    if (seen.has(key)) continue;
    seen.add(key);
    out.add(names.lesson(line));
  }
  return [...out];
}

const subjectOf = (slot: Slot): string => slot.subjects.join(' / ');

function record(slot: Slot, kind: WrappedRecord['kind'], amount: number | null): WrappedRecord {
  return { date: slot.date, hour: slot.hourIndex, subject: subjectOf(slot), title: null, kind, amount };
}

function weeksOf(days: readonly Day[], zone: string): number {
  return new Set(days.map((d) => weekStart(d.date, 0, zone))).size;
}

/** The first and last day the server's own record covers, among the student's days. */
function observedSpan(days: readonly Day[]): { from: DateStr | null; to: DateStr | null } {
  const observed = days.filter((d) => d.slots.some((s) => s.observed));
  return { from: observed[0]?.date ?? null, to: observed[observed.length - 1]?.date ?? null };
}

export function introCard(days: readonly Day[]): WrappedCard {
  return {
    id: 'intro', value: days.length, params: { observedFrom: observedSpan(days).from },
    from: days[0]?.date ?? null, to: days[days.length - 1]?.date ?? null, shareable: true, records: [],
  };
}

export function hoursCard(days: readonly Day[], zone: string): WrappedCard | null {
  if (weeksOf(days, zone) < MIN_WEEKS) return null;
  const slots = days.flatMap((d) => d.slots);
  const minutes = slots.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  return {
    id: 'hours', value: Math.round(minutes / 60),
    params: { lessons: slots.length, days: days.length, minutes, untimed: slots.filter((s) => s.minutes === null).length },
    from: days[0]!.date, to: days[days.length - 1]!.date, shareable: true,
    records: days.map((d) => ({ date: d.date, hour: null, subject: null, title: null, kind: 'day', amount: d.slots.length })),
  };
}

export function cancelledCards(days: readonly Day[], zone: string): WrappedCard[] {
  const cancelled = days.flatMap((d) => d.slots.filter((s) => s.cancelled));
  if (cancelled.length < MIN_CANCELLED) return [];
  const span = observedSpan(days);
  const minutes = cancelled.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  const cards: WrappedCard[] = [{
    id: 'cancelled', value: cancelled.length,
    params: { minutes, hours: round1(minutes / 60), untimed: cancelled.filter((s) => s.minutes === null).length },
    from: span.from, to: span.to, shareable: true, records: cancelled.map((s) => record(s, 'cancelled', s.minutes)),
  }];

  const bySubject = new Map<string, number>();
  const byWeekday = new Map<string, number>();
  for (const slot of cancelled) {
    // A lesson with no subject to show leads nothing.
    for (const subject of slot.subjects) if (subject !== UNNAMED_LESSON) bySubject.set(subject, (bySubject.get(subject) ?? 0) + 1);
    const weekday = weekdayNameHe(slot.date, zone);
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + 1);
  }
  const subject = soleLeader(bySubject);
  if (subject && subject.count >= MIN_LEADER) {
    const weekday = soleLeader(byWeekday);
    const named = weekday && weekday.count >= MIN_LEADER ? weekday : null;
    cards.push({
      id: 'cancelledTop', value: subject.count,
      params: { subject: subject.key, weekday: named?.key ?? null, weekdayCount: named?.count ?? null, total: cancelled.length },
      from: span.from, to: span.to, shareable: true,
      records: cancelled
        .filter((s) => s.subjects.includes(subject.key))
        .map((s) => record(s, 'cancelled', s.minutes)),
    });
  }
  return cards;
}

/** A day whose first lesson was cancelled and that still had a lesson: the time until that lesson began. */
export function sleepCard(days: readonly Day[]): WrappedCard | null {
  const records: WrappedRecord[] = [];
  for (const day of days) {
    const first = day.slots[0];
    if (!first?.cancelled) continue;
    const held = day.slots.find((s) => !s.cancelled);
    if (!held || !held.observed) continue;
    records.push(record(first, 'sleep', first.start && held.start ? minutesOf(held.start) - minutesOf(first.start) : null));
  }
  if (records.length < MIN_SLEEP) return null;
  const span = observedSpan(days);
  return {
    id: 'sleep', value: records.length,
    params: { minutes: records.reduce((sum, r) => sum + (r.amount ?? 0), 0), untimed: records.filter((r) => r.amount === null).length },
    from: span.from, to: span.to, shareable: true, records,
  };
}

/**
 * Substitutes, and lessons the site marked as changed in another way: moved (counted once, where the
 * lesson landed) or a change it did not name. A room change is a regular row with another room, and is
 * not known here.
 */
export function substitutesCard(days: readonly Day[], names: ShownNames): WrappedCard | null {
  const records: WrappedRecord[] = [];
  for (const day of days) {
    for (const slot of day.slots) {
      for (const line of slot.lines) {
        if (line.source !== 'observed' || (line.status !== 'substitution' && line.status !== 'moved')) continue;
        records.push({ date: slot.date, hour: slot.hourIndex, subject: names.lesson(line), title: null, kind: line.status, amount: null });
      }
    }
  }
  if (records.length < MIN_SUBSTITUTES) return null;
  const span = observedSpan(days);
  const substitutions = records.filter((r) => r.kind === 'substitution').length;
  return {
    id: 'substitutes', value: records.length, params: { substitutions, moved: records.length - substitutions },
    from: span.from, to: span.to, shareable: true, records,
  };
}

/** The day with the most lessons scheduled and the one with the fewest; of equals, the earliest. */
export function daysCard(days: readonly Day[], zone: string): WrappedCard | null {
  if (weeksOf(days, zone) < MIN_WEEKS) return null;
  const most = Math.max(...days.map((d) => d.slots.length));
  const fewest = Math.min(...days.map((d) => d.slots.length));
  const longest = days.filter((d) => d.slots.length === most);
  const shortest = days.find((d) => d.slots.length === fewest)!;
  const first = longest[0]!;
  const starts = first.slots.map((s) => s.start).filter((t): t is string => t !== null).sort();
  const ends = first.slots.map((s) => s.end).filter((t): t is string => t !== null).sort();
  const dayRecord = (d: Day): WrappedRecord => ({ date: d.date, hour: null, subject: null, title: null, kind: 'day', amount: d.slots.length });
  return {
    id: 'days', value: most,
    params: {
      longestDate: first.date, longestWeekday: weekdayNameHe(first.date, zone), longestDays: longest.length,
      longestStart: starts[0] ?? null, longestEnd: ends[ends.length - 1] ?? null,
      shortestLessons: fewest, shortestDate: shortest.date, shortestWeekday: weekdayNameHe(shortest.date, zone),
    },
    from: days[0]!.date, to: days[days.length - 1]!.date, shareable: true,
    records: [...longest.map(dayRecord), ...(fewest < most ? [dayRecord(shortest)] : [])],
  };
}
