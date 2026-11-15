/**
 * The parser was written against one school's Shahaf site. These are seven
 * other schools' sites as served on 2026-10-19 (the week of 18.10, one class
 * each): the class list and the week have to come out of every one of them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClassOptions, parseTimetable } from '../src/adapters/shahaf/parser.js';

const DIR = join(__dirname, '..', 'fixtures', 'shahaf-schools');
const WEEK = '2026-10-18';

/** school → [classes on the site, lessons in the fixture week]. */
const SCHOOLS: Record<string, [number, number]> = {
  'school-b': [23, 74],
  'school-f': [22, 94],
  // Its public page lists a single class.
  'school-d': [1, 43],
  'school-e': [65, 75],
  'school-a': [45, 305],
  'school-c': [49, 215],
  'school-g': [30, 94],
};

const read = (school: string, file: string) => readFileSync(join(DIR, school, file), 'utf8');

describe.each(Object.entries(SCHOOLS))('%s', (school, [classCount, lessonCount]) => {
  it('lists its classes', () => {
    const classes = parseClassOptions(read(school, 'root.html'));
    expect(classes).toHaveLength(classCount);
    expect(classes.every((c) => c.id !== '' && c.name !== '')).toBe(true);
  });

  it('yields the week, without warnings', () => {
    const warnings: string[] = [];
    const parsed = parseTimetable(read(school, 'changestable.html'), WEEK, { zone: 'Asia/Jerusalem', onWarn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(parsed.days[0]).toBe(WEEK);
    expect(parsed.lessons).toHaveLength(lessonCount);
    expect(parsed.freshness).not.toBeNull();
    expect(parsed.lessons.every((l) => l.subject !== '' && l.date >= WEEK)).toBe(true);
  });
});
