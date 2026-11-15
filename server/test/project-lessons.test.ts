import { describe, expect, it } from 'vitest';
import type { DateStr } from '@sederyom/shared';
import type { ParsedLesson } from '../src/adapters/shahaf/parser.js';
import type { MashovSlot } from '@sederyom/shared/logic/mashov/normalize';
import { planLessonRows, type ShahafSighting } from '@sederyom/shared/logic/merge';
import { addDays, schoolDayInfo } from '../src/lib/time.js';

const ZONE = 'Asia/Jerusalem';
const TODAY = '2026-09-01'; // Tuesday; the week runs Sun 30.08 – Fri 04.09
/** The projection horizon: 7 days back, 21 ahead — Tue 25.08 to Tue 22.09. */
const DATES: DateStr[] = Array.from({ length: 29 }, (_v, i) => addDays(TODAY, i - 7, ZONE));

function shahafLesson(date: DateStr, over: Partial<ParsedLesson> = {}): ShahafSighting {
  return {
    date,
    lesson: {
      date, hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'ספרות', teacher: 'לוי', room: '12',
      status: 'regular', substitute: null, note: null, ...over,
    },
  };
}

/** Mashov's recurring grid: one lesson Sunday to Thursday, nothing on Friday. */
const SLOTS: MashovSlot[] = ['מתמטיקה', 'אנגלית', 'היסטוריה', 'פיזיקה', 'אזרחות'].map((subject, dayOfWeek) => ({
  dayOfWeek, hourIndex: 1, subject, teacher: null, room: null, groupName: null, startTime: '08:00', endTime: '08:45',
}));

function plan(shahaf: ShahafSighting[], dates: DateStr[] = DATES) {
  const rows = planLessonRows(dates, shahaf, SLOTS, ZONE);
  const projected = rows.filter((r) => r.source === 'mashov').map((r) => r.date);
  return { rows, projected };
}

/** Days Shahaf published lessons on: the current week to Tuesday, and all of next week. */
const PUBLISHED = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];

describe('lesson projection (F6)', () => {
  it('fills only the weeks the site has not published, on school days', () => {
    const { rows, projected } = plan(PUBLISHED.map((d) => shahafLesson(d)));
    expect(rows.filter((r) => r.source === 'shahaf').map((r) => r.date)).toEqual(PUBLISHED);
    // Sun 13.09 is the second day of Rosh Hashana, Sun 20.09 Erev Yom Kippur,
    // Mon 21.09 Yom Kippur and Tue 22.09 the Sukkot vacation; Fridays and
    // Saturdays have no slot or no school.
    expect(projected).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
    expect(schoolDayInfo('2026-09-13', ZONE).isSchoolDay).toBe(false);
    expect(schoolDayInfo('2026-09-20', ZONE).isSchoolDay).toBe(false);
    expect(schoolDayInfo('2026-09-21', ZONE).isSchoolDay).toBe(false);
    expect(schoolDayInfo('2026-09-22', ZONE).isSchoolDay).toBe(false);
  });

  it('leaves an empty day inside a published week empty', () => {
    const { rows } = plan(PUBLISHED.map((d) => shahafLesson(d)));
    // Wed 02.09 – Fri 04.09: the site published the week, with nothing on those days.
    expect(rows.filter((r) => ['2026-09-02', '2026-09-03', '2026-09-04'].includes(r.date))).toEqual([]);
  });

  it('never projects into the past before what the site published', () => {
    const { rows } = plan(PUBLISHED.map((d) => shahafLesson(d)));
    expect(rows.some((r) => r.date < '2026-08-30')).toBe(false);
  });

  it('projects the slot as a regular lesson from Mashov', () => {
    const { rows } = plan(PUBLISHED.map((d) => shahafLesson(d)));
    expect(rows.find((r) => r.date === '2026-09-14')).toEqual({
      date: '2026-09-14', hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'אנגלית', teacher: null, room: null,
      status: 'regular', substitute: null, note: null, source: 'mashov',
    });
  });

  it('treats a week whose lessons were withdrawn as published', () => {
    const withdrawn: ShahafSighting[] = ['2026-09-14', '2026-09-15'].map((date) => ({ date, lesson: null }));
    // Two weeks further than the horizon: 20.09–03.10 is Yom Kippur and Sukkot, without a school day.
    const through = Array.from({ length: 43 }, (_v, i) => addDays(TODAY, i - 7, ZONE));
    const { projected } = plan([...PUBLISHED.map((d) => shahafLesson(d)), ...withdrawn], through);
    expect(projected).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  it('treats an empty week before a published one as published empty (a vacation)', () => {
    const { projected } = plan([shahafLesson('2026-08-31'), shahafLesson('2026-09-14')]);
    expect(projected.filter((d) => d < '2026-09-20')).toEqual([]);
  });

  it('projects every school day of the horizon when the site has published nothing', () => {
    const { projected } = plan([]);
    // 25–31.08 is summer vacation; from 01.09 every school day with a slot.
    expect(projected[0]).toBe('2026-09-01');
    expect(projected).toEqual(
      DATES.filter((d) => schoolDayInfo(d, ZONE).isSchoolDay && SLOTS.some((s) => s.dayOfWeek === new Date(`${d}T12:00:00Z`).getUTCDay())),
    );
  });

  it('projects nothing without a Mashov grid', () => {
    expect(planLessonRows(DATES, [], [], ZONE)).toEqual([]);
  });
});
