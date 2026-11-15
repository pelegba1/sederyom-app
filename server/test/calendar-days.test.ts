/**
 * The date helpers count plain `YYYY-MM-DD` days without the zone
 * (`calendarDay` in shared/logic/time.ts): the phone asked the zone's `Intl`
 * thousands of times for one week it built, and taps waited behind it. Here
 * they answer exactly as Luxon did, for every day of a leap year, in zones
 * with and without daylight saving (Santiago's clock skips midnight itself),
 * and anything that is not a plain date still goes Luxon's way: it throws, or
 * answers, as before. The kept answers (`parseDateStr`, `atTime`,
 * `schoolDayInfo`) are the same as asking again.
 */
import { DateTime } from 'luxon';
import { afterEach, describe, expect, it } from 'vitest';
import { daysBetween } from '@sederyom/shared/logic/build';
import { subjectsMatch } from '@sederyom/shared/logic/subjects';
import { addDays, atTime, calendarDay, parseDateStr, schoolDayInfo, sundayIndex, takeSchoolDaysOff, weekStart } from '@sederyom/shared/logic/time';

// The helpers as they were, through Luxon.
function luxonDay(date: string, zone: string): DateTime {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new Error(`invalid date string: ${date}`);
  return dt.startOf('day');
}
const luxonAddDays = (date: string, days: number, zone: string) => luxonDay(date, zone).plus({ days }).toISODate()!;
const luxonSundayIndex = (date: string, zone: string) => luxonDay(date, zone).weekday % 7;
const luxonMidnight = (date: string, zone: string) => luxonDay(date, zone).set({ hour: 0, minute: 0 });
const luxonDaysBetween = (from: string, to: string, zone: string) =>
  Math.round(luxonMidnight(to, zone).diff(luxonMidnight(from, zone), 'days').days);

const ZONES = ['Asia/Jerusalem', 'America/Santiago', 'UTC'];
const STEPS = [-400, -1, 0, 1, 7, 366];

function everyDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = DateTime.fromISO(from, { zone: 'UTC' }); d.toISODate()! <= to; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}
// A leap year: its 29 February, and both clock changes of each zone.
const DAYS = everyDay('2028-01-01', '2028-12-31');

afterEach(() => {
  takeSchoolDaysOff(null);
});

describe('plain dates without the zone', () => {
  it.each(ZONES)('addDays, sundayIndex, weekStart and daysBetween answer as Luxon did in %s', (zone) => {
    const wrong: string[] = [];
    for (const date of DAYS) {
      if (sundayIndex(date, zone) !== luxonSundayIndex(date, zone)) wrong.push(`sundayIndex ${date}`);
      if (weekStart(date, 1, zone) !== luxonAddDays(date, -luxonSundayIndex(date, zone) + 7, zone)) wrong.push(`weekStart ${date}`);
      for (const n of STEPS) {
        const later = luxonAddDays(date, n, zone);
        if (addDays(date, n, zone) !== later) wrong.push(`addDays ${date} ${n}`);
        if (daysBetween(date, later, zone) !== luxonDaysBetween(date, later, zone)) wrong.push(`daysBetween ${date} ${later}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('counts a real date only, from the year 1000 on', () => {
    expect(calendarDay('1970-01-01', 'UTC')).toBe(0);
    expect(calendarDay('2026-11-01', 'Asia/Jerusalem')).toBe(20758);
    for (const notOne of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-05', '20261101', '2026-11-01T10:00', '0999-12-31', '', 'abc']) {
      expect(calendarDay(notOne, 'UTC')).toBeNull();
    }
    expect(calendarDay('2028-02-29', 'UTC')).not.toBeNull();
    expect(calendarDay('2026-11-01', 'Not/AZone')).toBeNull();
  });

  it('leaves what is not a plain date to Luxon: the same answer, or the same error', () => {
    for (const input of ['2026-11-01T10:00', '20261101', '2026-W44-7', '0999-12-31']) {
      expect(addDays(input, 3, 'Asia/Jerusalem')).toBe(luxonAddDays(input, 3, 'Asia/Jerusalem'));
      expect(sundayIndex(input, 'Asia/Jerusalem')).toBe(luxonSundayIndex(input, 'Asia/Jerusalem'));
    }
    for (const bad of ['2026-02-30', '2026-13-01', 'abc', '']) {
      expect(() => addDays(bad, 1, 'Asia/Jerusalem')).toThrow(`invalid date string: ${bad}`);
      expect(() => sundayIndex(bad, 'Asia/Jerusalem')).toThrow(`invalid date string: ${bad}`);
    }
    expect(() => addDays('2026-11-01', 1, 'Not/AZone')).toThrow('invalid date string: 2026-11-01');
    // Half a day is Luxon's to add, as before.
    expect(addDays('2026-03-26', 0.5, 'Asia/Jerusalem')).toBe(luxonAddDays('2026-03-26', 0.5, 'Asia/Jerusalem'));
  });
});

describe('kept answers', () => {
  it('parseDateStr and atTime give what Luxon gives, the clock change in Israel included', () => {
    for (const date of ['2026-03-26', '2026-03-27', '2026-10-24', '2026-10-25', '2026-11-01']) {
      expect(parseDateStr(date, 'Asia/Jerusalem').toISO()).toBe(luxonDay(date, 'Asia/Jerusalem').toISO());
      for (const time of ['00:00', '01:30', '02:30', '08:15', '23:59']) {
        const [h, m] = time.split(':').map(Number);
        const want = luxonDay(date, 'Asia/Jerusalem').set({ hour: h, minute: m }).toISO();
        expect(atTime(date, time, 'Asia/Jerusalem').toISO()).toBe(want);
        expect(atTime(date, time, 'Asia/Jerusalem').toISO()).toBe(want);
      }
    }
    expect(() => parseDateStr('2026-02-30')).toThrow('invalid date string: 2026-02-30');
  });

  it('schoolDayInfo follows the days-off list it has now, and an answer changed by a caller is its own', () => {
    expect(schoolDayInfo('2026-11-03', 'Asia/Jerusalem')).toEqual({ isSchoolDay: true, holidayName: null });
    takeSchoolDaysOff({ revision: 99, daysOff: [{ from: '2026-11-03', to: '2026-11-03', name: 'יום בדיקה' }] });
    expect(schoolDayInfo('2026-11-03', 'Asia/Jerusalem')).toEqual({ isSchoolDay: false, holidayName: 'יום בדיקה' });
    takeSchoolDaysOff(null);
    const info = schoolDayInfo('2026-11-03', 'Asia/Jerusalem');
    expect(info).toEqual({ isSchoolDay: true, holidayName: null });
    info.isSchoolDay = false;
    expect(schoolDayInfo('2026-11-03', 'Asia/Jerusalem').isSchoolDay).toBe(true);
  });

  it('subjectsMatch answers the same asked twice, either way round', () => {
    for (const [a, b, same] of [['אנגלית', 'אנגלית דוברי', true], ['חינוך', 'חינוך גופני', false], ['מדעי המחשב', 'מדעי הסביבה', false]] as const) {
      expect(subjectsMatch(a, b)).toBe(same);
      expect(subjectsMatch(a, b)).toBe(same);
      expect(subjectsMatch(b, a)).toBe(same);
    }
  });
});
