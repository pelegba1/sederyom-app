/**
 * The cards that are not about the timetable: exams, tasks, and what Mashov
 * keeps (lessons held, attendance, grades). Attendance and grades are the
 * student's own business: those two cards are never shareable.
 */
import { DateTime } from 'luxon';
import type { DateStr } from '../../index';
import { addDays, parseDateStr, toDateStr, weekStart } from '../time';
import { shownNames, type ShownNames } from './names';
import { round1, schoolYearStart, soleLeader, type WrappedCard, type WrappedInput, type WrappedRecord } from './types';

const MIN_HELD_SUBJECTS = 3;
const MIN_EXAMS = 3;
const MIN_BUSY_WEEK = 2;
const MIN_DONE = 10;
const MIN_STREAK = 3;
const MIN_GRADES = 5;
const MIN_GRADES_PER_HALF = 3;
const MIN_GRADES_FOR_BEST = 2;

const byDate = (a: WrappedRecord, b: WrappedRecord) => ((a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0);

/** Mashov's own count of the lessons held in each of the student's groups. */
export function heldCard(input: WrappedInput, names: ShownNames = shownNames(input)): WrappedCard | null {
  const counts = (input.mashov?.counts ?? []).filter((c) => c.held > 0);
  if (counts.length < MIN_HELD_SUBJECTS) return null;
  const top = soleLeader(new Map(counts.map((c) => [c.groupId, c.held])));
  const topGroup = top ? counts.find((c) => c.groupId === top.key)! : null;
  return {
    id: 'held', value: counts.reduce((sum, c) => sum + c.held, 0),
    params: { subjects: counts.length, top: topGroup ? names.fromMashov(topGroup.subject) : null, topHeld: topGroup?.held ?? null },
    from: schoolYearStart(input.today), to: input.today, shareable: true,
    records: counts
      .map((c): WrappedRecord => ({ date: null, hour: null, subject: names.fromMashov(c.subject), title: null, kind: 'held', amount: c.held }))
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
  };
}

/** The exams whose day has passed: the class's, minus the ones the student switched off, plus the ones added by hand. */
export function examsCard(input: WrappedInput, names: ShownNames = shownNames(input)): WrappedCard | null {
  const from = schoolYearStart(input.today);
  const hidden = new Set(input.hiddenExamKeys);
  const seen = new Set<string>();
  const records: WrappedRecord[] = [];
  const all = [...(input.history?.exams ?? []), ...input.manualExams];
  // An inherited property ("constructor") is no name.
  const ownName = (key: string): string | null => {
    const name = Object.prototype.hasOwnProperty.call(input.examNames, key) ? input.examNames[key] : undefined;
    return typeof name === 'string' && name.trim() !== '' ? name : null;
  };
  for (const exam of all) {
    if (!exam.date || exam.date < from || exam.date >= input.today) continue;
    if (hidden.has(exam.naturalKey) || seen.has(exam.naturalKey)) continue;
    seen.add(exam.naturalKey);
    records.push({ date: exam.date, hour: null, subject: ownName(exam.naturalKey) ?? names.exam(exam.subject), title: null, kind: 'exam', amount: null });
  }
  if (records.length < MIN_EXAMS) return null;
  records.sort(byDate);

  const perWeek = new Map<DateStr, number>();
  for (const r of records) {
    const week = weekStart(r.date!, 0, input.zone);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  const busiest = soleLeader(perWeek);
  const named = busiest && busiest.count >= MIN_BUSY_WEEK ? busiest : null;
  return {
    id: 'exams', value: records.length, params: { weekStart: named?.key ?? null, weekCount: named?.count ?? null },
    from: records[0]!.date, to: records[records.length - 1]!.date, shareable: true, records,
  };
}

/** Tasks completed and homework ticked, by the moment each was done. */
export function tasksCard(input: WrappedInput, names: ShownNames = shownNames(input)): WrappedCard | null {
  const from = schoolYearStart(input.today);
  const dayOf = (iso: string): DateStr | null => {
    const dt = DateTime.fromISO(iso, { setZone: true }).setZone(input.zone);
    return dt.isValid ? toDateStr(dt) : null;
  };
  const inYear = (day: DateStr | null): day is DateStr => day !== null && day >= from && day <= input.today;

  const records: WrappedRecord[] = [];
  let withDue = 0;
  let beforeDue = 0;
  for (const task of input.tasks ?? []) {
    if (!task.completed || task.deleted || !task.completedAt) continue;
    const day = dayOf(task.completedAt);
    if (!inYear(day)) continue;
    records.push({ date: day, hour: null, subject: null, title: task.title, kind: 'task', amount: null });
    if (task.due) {
      withDue += 1;
      if (day <= task.due) beforeDue += 1;
    }
  }
  const tasks = records.length;
  for (const item of input.homework) {
    const day = dayOf(item.doneAt);
    if (inYear(day)) records.push({ date: day, hour: null, subject: item.subject ? names.fromMashov(item.subject) : null, title: null, kind: 'homework', amount: null });
  }
  if (records.length < MIN_DONE) return null;
  records.sort(byDate);

  const days = [...new Set(records.map((r) => r.date!))];
  let streak = 0;
  let run = 0;
  days.forEach((day, i) => {
    run = i > 0 && addDays(days[i - 1]!, 1, input.zone) === day ? run + 1 : 1;
    if (run > streak) streak = run;
  });
  return {
    id: 'tasks', value: records.length,
    params: { tasks, homework: records.length - tasks, withDue, beforeDue, streak: streak >= MIN_STREAK ? streak : null },
    from: records[0]!.date, to: records[records.length - 1]!.date, shareable: true, records,
  };
}

/** This school year's absences and lates, as Mashov lists them. Never shared. */
export function attendanceCard(input: WrappedInput, names: ShownNames = shownNames(input)): WrappedCard | null {
  const from = schoolYearStart(input.today);
  const events = (input.mashov?.attendance ?? []).filter((e) => e.date >= from && e.date <= input.today);
  if (events.length === 0) return null;
  const records = events
    .map((e): WrappedRecord => ({ date: e.date, hour: e.hour, subject: e.subject ? names.fromMashov(e.subject) : null, title: null, kind: e.kind, amount: null }))
    .sort(byDate);
  const absences = events.filter((e) => e.kind === 'absence').length;
  return {
    id: 'attendance', value: events.length,
    params: { absences, lates: events.length - absences, justified: events.filter((e) => e.justified).length },
    from, to: input.today, shareable: false, records,
  };
}

/** The plain average of this year's numeric grades, with no weights. Never shared. */
export function gradesCard(input: WrappedInput, names: ShownNames = shownNames(input)): WrappedCard | null {
  const from = schoolYearStart(input.today);
  const grades = (input.mashov?.grades ?? [])
    .filter((g): g is { date: DateStr; subject: string; value: number } => g.value !== null && g.date >= from && g.date <= input.today);
  if (grades.length < MIN_GRADES) return null;
  const average = (list: readonly { value: number }[]) => list.reduce((sum, g) => sum + g.value, 0) / list.length;

  const bySubject = new Map<string, { value: number }[]>();
  for (const g of grades) {
    const subject = names.fromMashov(g.subject);
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), g]);
  }
  const averages = new Map([...bySubject].filter(([, list]) => list.length >= MIN_GRADES_FOR_BEST).map(([s, list]) => [s, average(list)]));
  const best = soleLeader(averages);

  // The halves: up to the middle day between 1 September and today, and after it.
  const span = Math.floor(parseDateStr(input.today, input.zone).diff(parseDateStr(from, input.zone), 'days').days);
  const middle = addDays(from, Math.floor(span / 2), input.zone);
  const first = grades.filter((g) => g.date <= middle);
  const second = grades.filter((g) => g.date > middle);
  const trend = first.length >= MIN_GRADES_PER_HALF && second.length >= MIN_GRADES_PER_HALF ? round1(average(second) - average(first)) : null;

  return {
    id: 'grades', value: round1(average(grades)),
    params: { count: grades.length, best: best?.key ?? null, bestAverage: best ? round1(best.count) : null, trend, middle },
    from, to: input.today, shareable: false,
    records: grades
      .map((g): WrappedRecord => ({ date: g.date, hour: null, subject: names.fromMashov(g.subject), title: null, kind: 'grade', amount: g.value }))
      .sort(byDate),
  };
}
