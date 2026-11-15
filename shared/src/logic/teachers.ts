/**
 * "איפה המורה?" (docs/superpowers/specs/2026-11-04-teacher-search-design.md):
 * every class timetable turned into each teacher's day (the server's, from
 * the whole site; the demo's, from its one class), finding a teacher by what a
 * student types, and where the teacher is at a time of day. Pure: the phone
 * runs the last two on every keystroke and every minute.
 *
 * The parser is left as it is: the two shapes it reads with the teacher in
 * the wrong place are put right here (`teacherOf`), because changing the
 * parser changes lesson keys, and a changed key is a "ירד מהמערכת" push to
 * every student of the class (9731ff3).
 */
import type { ClassLesson, TeacherDay, TeacherPeriod } from '../devices';
import type { DateStr, TimeStr } from '../domain';
import { minutesOf } from './time';

/** A fill-in in a free period: "אשכול יהודית -> חדר: מעבדת מחשבים 4", read as the subject, with no teacher. */
const RE_FILL_IN = /^(.+?)\s*->\s*(?:חדר:\s*(.+))?$/;
/** A group's exam: "מבחן X, מעבדת מחשבים 1<br>לקבוצה של עזרא עמית" leaves "מעבדת מחשבים 1 · לקבוצה של עזרא עמית" as the teacher. */
const RE_GROUP_OF = /^(?:(.*?)\s*·\s*)?לקבוצה של\s+(.+)$/;
/** The group's place after the subject, in brackets: "מתמטיקה 5 יח״ל (יב3)". */
const RE_PLACE = /^(.*?)\s*\(([^()]+)\)\s*$/;
/** Where a moved lesson left from: the teacher is in the hour it went to. */
const RE_MOVED_AWAY = /^הועבר לשעה/;

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

interface Placed {
  teacher: string;
  period: TeacherPeriod;
}

/** Who a lesson places where: its teacher, and the one giving it instead when there is one. */
export function teacherOf(lesson: ClassLesson, className: string): Placed[] {
  const base = {
    hourIndex: lesson.hourIndex,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    classes: [className],
    note: clean(lesson.note),
  };
  let teacher = clean(lesson.teacher);
  let subject = lesson.subject;
  let room = clean(lesson.room);
  // The group's place, printed after the subject: "מתמטיקה 5 יח״ל (יב3)", "מדעי המחשב (מעבדת מחשבים 1)".
  const place = RE_PLACE.exec(subject);
  if (place && clean(place[1])) {
    subject = clean(place[1])!;
    room ??= clean(place[2]);
  }

  if (teacher === null) {
    const fill = RE_FILL_IN.exec(subject);
    const who = clean(fill?.[1]);
    if (!who) return [];
    return [{
      teacher: who,
      period: { ...base, subject: 'מילוי מקום', room: clean(fill?.[2]), status: 'substitution', coveredBy: null, covering: '' },
    }];
  }
  const group = RE_GROUP_OF.exec(teacher);
  if (group) {
    teacher = clean(group[2])!;
    room = clean(group[1]) ?? room;
  }

  const substitute = clean(lesson.substitute);
  if (lesson.status === 'substitution') {
    // A change with no lesson under it names the one who comes (the parser puts them in both).
    if (substitute === teacher) {
      return [{ teacher, period: { ...base, subject, room, status: 'substitution', coveredBy: null, covering: '' } }];
    }
    // Their lesson, given by someone the site does not name.
    if (substitute === null) {
      return [{ teacher, period: { ...base, subject, room, status: 'substitution', coveredBy: '', covering: null } }];
    }
    return [
      { teacher, period: { ...base, subject, room, status: 'substitution', coveredBy: substitute, covering: null } },
      { teacher: substitute, period: { ...base, subject, room, status: 'substitution', coveredBy: null, covering: teacher } },
    ];
  }
  if (lesson.status === 'moved' && base.note !== null && RE_MOVED_AWAY.test(base.note)) {
    // Still listed, so a student sees why the hour is empty; `teacherIsThere` reads it as cancelled.
    return [{ teacher, period: { ...base, subject, room, status: 'cancelled', coveredBy: null, covering: null } }];
  }
  return [{ teacher, period: { ...base, subject, room, status: lesson.status, coveredBy: null, covering: null } }];
}

/**
 * Every teacher's periods on `date`, by name. One group printed in several
 * classes' timetables (same teacher, period and subject) is one period with
 * all of its classes. When the classes disagree on the status, the change
 * wins: one class's "בוטל" is the group's.
 */
export function buildTeacherDays(classes: { className: string; lessons: ClassLesson[] }[], date: DateStr): TeacherDay[] {
  const byTeacher = new Map<string, Map<string, TeacherPeriod>>();
  for (const { className, lessons } of classes) {
    for (const lesson of lessons) {
      if (lesson.date !== date) continue;
      for (const { teacher, period } of teacherOf(lesson, className)) {
        let periods = byTeacher.get(teacher);
        if (!periods) byTeacher.set(teacher, (periods = new Map()));
        const key = `${period.hourIndex}|${period.subject}|${period.covering ?? ''}`;
        const known = periods.get(key);
        if (!known) {
          periods.set(key, period);
          continue;
        }
        for (const c of period.classes) if (!known.classes.includes(c)) known.classes.push(c);
        known.room ??= period.room;
        if (known.status === 'regular' && period.status !== 'regular') {
          known.status = period.status;
          known.coveredBy = period.coveredBy;
          known.note = period.note;
        }
      }
    }
  }
  return [...byTeacher.entries()]
    .map(([name, periods]) => ({ name, periods: [...periods.values()].sort((a, b) => a.hourIndex - b.hourIndex) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/**
 * `date`'s teachers, and with no periods every other teacher the lessons name
 * on any day: so a search for one who does not teach today says so, rather
 * than "not found".
 */
export function buildTeacherWeek(classes: { className: string; lessons: ClassLesson[] }[], date: DateStr): TeacherDay[] {
  const today = buildTeacherDays(classes, date);
  const known = new Set(today.map((d) => d.name));
  const others = new Set<string>();
  for (const { className, lessons } of classes) {
    for (const lesson of lessons) {
      for (const { teacher } of teacherOf(lesson, className)) if (!known.has(teacher)) others.add(teacher);
    }
  }
  return [...today, ...[...others].map((name) => ({ name, periods: [] }))].sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** A name or a query as words to compare: no quotes or gershayim, no hyphens, lower case. */
export function nameWords(text: string): string[] {
  return text
    .replace(/["'״׳`]/g, '')
    .replace(/[-־.,]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The teachers whose name has, for every word typed, a word that starts with
 * it, in any order: the site prints the family name first, a student types
 * either. A name that starts with what was typed comes first, then by name.
 * An empty query finds no one.
 */
export function matchTeachers(days: TeacherDay[], query: string): TeacherDay[] {
  const typed = nameWords(query);
  if (typed.length === 0) return [];
  const hits = days.filter((d) => {
    const words = nameWords(d.name);
    return typed.every((t) => words.some((w) => w.startsWith(t)));
  });
  const joined = typed.join(' ');
  const leads = (d: TeacherDay) => (nameWords(d.name).join(' ').startsWith(joined) ? 0 : 1);
  return hits.sort((a, b) => leads(a) - leads(b) || a.name.localeCompare(b.name, 'he'));
}

/** Whether the teacher is in the period: not when it is cancelled or someone else gives it. */
export function teacherIsThere(period: TeacherPeriod): boolean {
  if (period.status === 'cancelled') return false;
  if (period.status === 'substitution' && period.coveredBy !== null) return false;
  return true;
}

export type TeacherNow =
  /** In a period now. */
  | { kind: 'in'; period: TeacherPeriod; next: TeacherPeriod | null }
  /** Before the day's first period or between two: where they will be next. */
  | { kind: 'free'; next: TeacherPeriod; first: boolean }
  /** After the day's last period. */
  | { kind: 'done' }
  /** Periods today, and every one cancelled or given by someone else. */
  | { kind: 'away' }
  /** No period today at all. */
  | { kind: 'none' };

/**
 * Where the teacher is at `time`, by the periods they are in. A period
 * without both its times is left out: there is no telling whether it is now.
 */
export function teacherNow(day: TeacherDay, time: TimeStr): TeacherNow {
  const t = minutesOf(time);
  const timed = day.periods
    .filter((p) => teacherIsThere(p) && p.startTime !== null && p.endTime !== null)
    .sort((a, b) => minutesOf(a.startTime!) - minutesOf(b.startTime!));
  if (timed.length === 0) return day.periods.some((p) => !teacherIsThere(p)) ? { kind: 'away' } : { kind: 'none' };
  const index = timed.findIndex((p) => minutesOf(p.startTime!) <= t && t < minutesOf(p.endTime!));
  if (index >= 0) {
    const period = timed[index]!;
    const next = timed.slice(index + 1).find((p) => minutesOf(p.startTime!) >= minutesOf(period.endTime!)) ?? null;
    return { kind: 'in', period, next };
  }
  const nextIndex = timed.findIndex((p) => minutesOf(p.startTime!) > t);
  if (nextIndex < 0) return { kind: 'done' };
  return { kind: 'free', next: timed[nextIndex]!, first: nextIndex === 0 };
}
