/**
 * The absence tracker (חיסורים), against Mashov's real answers, de-identified
 * in fixtures/mashov-attendance (`/behave`, `/lessonsCount`, `/groups`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, currentSemester } from '@sederyom/shared';
import { applySettingsPatch, mergeSettings } from '@sederyom/shared/logic/options';
import {
  attendanceEntities, normalizeAttendance, type AttendancePayload, type LessonCountPayload,
} from '@sederyom/shared/logic/mashov/attendance';
import { buildGroupIndex } from '@sederyom/shared/logic/mashov/normalize';
import { buildAttendance, daysAhead, remainingLessons } from '@sederyom/shared/logic/attendance';
import { schoolDayInfo } from '@sederyom/shared/logic/time';

const ZONE = 'Asia/Jerusalem';
const fixture = (name: string): unknown[] =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'mashov-attendance', `${name}.json`), 'utf8')) as unknown[];

const groups = buildGroupIndex(fixture('groups'));
const entities = attendanceEntities(fixture('behave'), fixture('lessonsCount'), groups);
const events = entities.filter((e) => e.kind === 'attendance').map((e) => e.payload as AttendancePayload);
const counts = entities.filter((e) => e.kind === 'lesson_count').map((e) => e.payload as LessonCountPayload);
// The fixtures are from the first semester of 2026–27.
const settings = { ...DEFAULT_SETTINGS.attendance, semesterStart: '2026-09-01', semesterEnd: '2027-02-02' };

describe('Mashov attendance', () => {
  it('keeps absences and lates only, each once', () => {
    // 24 events: 23 absences and one "אי הכנת שיעורי בית".
    expect(events).toHaveLength(23);
    expect(new Set(entities.map((e) => e.naturalKey)).size).toBe(entities.length);
    expect(events.every((e) => e.kind === 'absence')).toBe(true);
  });

  it('reads a justification only once one was given: -1 and 0 are unjustified', () => {
    expect(events.filter((e) => e.justified)).toHaveLength(9);
    expect(events.filter((e) => e.justified).every((e) => e.justification === 'פעילות בית ספרית')).toBe(true);
    expect(events.filter((e) => !e.justified).every((e) => e.justification === null)).toBe(true);
    const zero = normalizeAttendance({ achvaCode: 61, lessonDate: '2026-10-01T00:00:00', justificationId: 0, justification: 'לא מוצדק', lessonId: 1 }, groups);
    expect(zero?.justified).toBe(false);
    const late = normalizeAttendance({ achvaCode: 62, lessonDate: '2026-10-01T00:00:00', justificationId: -1, lessonId: 2 }, groups);
    expect(late?.kind).toBe('late');
  });

  it('names each group by its subject, with the lessons held and the weekly hours', () => {
    expect(counts).toHaveLength(8);
    expect(counts.find((c) => c.groupId === '8550')).toEqual({ groupId: '8550', subject: 'מתמטיקה 5 יח"ל', held: 21, weeklyHours: 7 });
  });
});

describe('days ahead', () => {
  it('leaves out Shabbat, the Ministry vacations and the owner\'s days off', () => {
    expect(schoolDayInfo('2026-12-08', ZONE)).toEqual({ isSchoolDay: false, holidayName: 'חופשת חנוכה' });
    expect(schoolDayInfo('2026-12-13', ZONE).isSchoolDay).toBe(true);
    expect(schoolDayInfo('2026-10-27', ZONE).holidayName).toBe('יום הבחירות');

    const { schoolDays, daysOff } = daysAhead({ ...settings, daysOff: ['2026-11-04'] }, '2026-10-16', ZONE);
    expect(schoolDays[0]).toBe('2026-10-18');
    expect(schoolDays.at(-1)).toBe('2027-02-02');
    expect(schoolDays).not.toContain('2026-12-09');
    expect(schoolDays).not.toContain('2026-11-04');
    expect(daysOff.map((d) => d.date)).toEqual(['2026-10-27', '2026-11-04', '2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11']);
    expect(daysOff.find((d) => d.date === '2026-11-04')).toEqual({ date: '2026-11-04', name: 'יום חופש שלך', own: true });
  });

  it('counts a subject\'s weekly slots on each school day, or its weekly hours when the grid lacks it', () => {
    // One week, Sunday 18.10 to Saturday 24.10 2026.
    const week = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
    const slots = [
      { dayOfWeek: 0, subject: 'מתמטיקה 5 יח"ל' },
      { dayOfWeek: 0, subject: 'מתמטיקה 5 יח"ל' },
      { dayOfWeek: 3, subject: 'מתמטיקה 5 יח"ל' },
    ];
    const left = remainingLessons(counts, slots, week, ZONE);
    expect(left.get('8550')).toEqual({ lessons: 3, from: 'grid' });
    // היסטוריה is not in this grid: 2 a week, over five weekdays.
    expect(left.get('7942')).toEqual({ lessons: 2, from: 'weeklyHours' });
    // A timetable row may spell the subject its own way.
    expect(remainingLessons(counts, [{ dayOfWeek: 1, subject: 'פיזיקה' }], week, ZONE).get('5272')).toEqual({ lessons: 1, from: 'grid' });
  });
});

describe('buildAttendance', () => {
  const view = buildAttendance({ counts, events, slots: [], settings, today: '2026-10-16', zone: ZONE, fetchedAt: null });

  it('tallies what counts and what does not, per group', () => {
    const math = view.subjects.find((s) => s.groupId === '8550')!;
    expect(math).toMatchObject({ held: 21, absences: 6, justifiedAbsences: 2, lates: 0 });
    expect(math.events[0]!.date).toBe('2026-09-15');
    const network = view.subjects.find((s) => s.groupId === '181')!;
    expect(network.absences).toBe(6);
    const physics = view.subjects.find((s) => s.groupId === '5272')!;
    expect(physics).toMatchObject({ absences: 2, justifiedAbsences: 3 });
    expect(view.limit).toBe(0.15);
  });

  it('counts only the semester\'s events', () => {
    const later = buildAttendance({ counts, events, slots: [], settings: { ...settings, semesterStart: '2026-10-01' }, today: '2026-10-16', zone: ZONE, fetchedAt: null });
    expect(later.subjects.find((s) => s.groupId === '181')!.absences).toBe(2);
  });
});

describe('attendance settings', () => {
  it('fill in for settings stored before them', () => {
    expect(mergeSettings({ vacationMode: true }, '2026-10-16').attendance).toEqual({
      ...DEFAULT_SETTINGS.attendance, semesterStart: '2026-09-01', semesterEnd: '2027-01-31',
    });
    // A semester the student set stays as they set it.
    const own = { attendance: { semesterStart: '2026-09-01', semesterEnd: '2027-02-02' } };
    expect(mergeSettings(own, '2026-10-16').attendance).toMatchObject(own.attendance);
  });
});

describe('the semester nobody set', () => {
  it("is the Ministry's usual one around today", () => {
    expect(currentSemester('2026-10-16')).toEqual({ semesterStart: '2026-09-01', semesterEnd: '2027-01-31' });
    expect(currentSemester('2027-01-20')).toEqual({ semesterStart: '2026-09-01', semesterEnd: '2027-01-31' });
    expect(currentSemester('2027-03-10')).toEqual({ semesterStart: '2027-02-01', semesterEnd: '2027-06-20' });
  });

  it('moves on to the second semester by itself, and to the next year after the summer', () => {
    const on = (stored: unknown, today: string): string => {
      const { semesterStart, semesterEnd } = mergeSettings(stored, today).attendance;
      return `${semesterStart} – ${semesterEnd}`;
    };
    // What any save during the first semester stores, as if the student had set it.
    const savedInA = { attendance: { semesterStart: '2026-09-01', semesterEnd: '2027-01-31' } };
    expect(on(savedInA, '2027-01-31')).toBe('2026-09-01 – 2027-01-31');
    expect(on(savedInA, '2027-02-01')).toBe('2027-02-01 – 2027-06-20');
    expect(on(savedInA, '2027-06-20')).toBe('2027-02-01 – 2027-06-20');
    // A school whose first semester ends on 2.2 starts its second on 3.2.
    expect(on({ attendance: { semesterStart: '2026-09-01', semesterEnd: '2027-02-02' } }, '2027-02-03')).toBe('2027-02-03 – 2027-06-20');
    // The summer keeps the second semester (as the student set it); September starts a new year.
    expect(on(savedInA, '2027-07-15')).toBe('2027-02-01 – 2027-06-20');
    const savedInB = { attendance: { semesterStart: '2027-02-01', semesterEnd: '2027-06-30' } };
    expect(on(savedInB, '2027-08-20')).toBe('2027-02-01 – 2027-06-30');
    expect(on(savedInB, '2027-09-01')).toBe('2027-09-01 – 2028-01-31');
    expect(on(savedInA, '2027-09-05')).toBe('2027-09-01 – 2028-01-31');
  });

  it("counts the second semester's absences once it begins", () => {
    // The old failure end to end: a setting saved in October, the tracker opened in February.
    const saved = applySettingsPatch(mergeSettings({}, '2026-10-23'), { vacationMode: false }, '2026-10-23');
    const february = mergeSettings(saved, '2027-02-10').attendance;
    const absence = events.find((e) => e.kind === 'absence' && !e.justified)!;
    const view = buildAttendance({
      counts, events: [...events, { ...absence, date: '2027-02-08' }], slots: [], settings: february, today: '2027-02-10', zone: ZONE, fetchedAt: null,
    });
    const subject = view.subjects.find((s) => s.groupId === absence.groupId)!;
    // February's absence counts; the first semester's do not.
    expect(subject.absences).toBe(1);
    expect(subject.events.map((e) => e.date)).toEqual(['2027-02-08']);
  });

  it("carries the school's own limit into the view", () => {
    const view = buildAttendance({ counts, events, slots: [], settings: { ...settings, limitPercent: 20 }, today: '2026-10-16', zone: ZONE, fetchedAt: null });
    expect(view.limit).toBe(0.2);
  });
});
