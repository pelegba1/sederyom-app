/**
 * "איפה המורה?" (docs/superpowers/specs/2026-11-04-teacher-search-design.md):
 * today's day of every teacher at one school, from all of its class
 * timetables. The Shahaf site has no teacher view, so every class is read and
 * turned inside out (`buildTeacherWeek`, shared logic; the demo builds its
 * own class's the same way).
 *
 * Kept apart from the class polls on purpose: nothing here is a snapshot or an
 * event, so no read of it can ever notify.
 */
import type { ClassOption, DateStr, TeacherDay } from '@sederyom/shared';
import { buildTeacherWeek } from '@sederyom/shared/logic/teachers';
import type { ParsedLesson } from '../adapters/shahaf/parser.js';

/** What a school's row keeps: the day read, and the day it was read for. */
export interface StoredTeacherDay {
  /** The school day the read was for, in the school's zone; the answer's `date` is null when it had no lessons. */
  forDate: DateStr;
  date: DateStr | null;
  teachers: TeacherDay[];
}

export interface ClassWeekReader {
  fetchClasses(): Promise<ClassOption[]>;
  fetchClassWeek(classId: string, now: Date): Promise<ParsedLesson[]>;
}

/** Pages read at once: about two seconds for a 32-class site, and gentle with it. */
const AT_ONCE = 4;

/** Reads every class on the site and builds `today`'s teachers. Throws when any class cannot be read. */
export async function readTeacherDay(site: ClassWeekReader, today: DateStr, now: Date): Promise<StoredTeacherDay> {
  const options = await site.fetchClasses();
  const read: { className: string; lessons: ParsedLesson[] }[] = new Array(options.length);
  let next = 0;
  const worker = async () => {
    while (next < options.length) {
      const i = next++;
      const option = options[i]!;
      read[i] = { className: option.name, lessons: await site.fetchClassWeek(option.id, now) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, options.length) }, worker));
  const teachers = buildTeacherWeek(read, today);
  // A day no one teaches (a Saturday, a holiday) is no day: no list of names with nothing in them.
  if (!teachers.some((t) => t.periods.length > 0)) return { forDate: today, date: null, teachers: [] };
  return { forDate: today, date: today, teachers };
}
