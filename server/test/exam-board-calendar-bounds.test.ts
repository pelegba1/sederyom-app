/**
 * The bounds on reading a calendar (final review, S-C1): a calendar is a stranger's text, read on the server (the
 * preview, the read right after a calendar is set, the hourly read) and on the phone (its own board), so what it costs
 * to read has to be bounded by the calendar's size, not by what its events say:
 * - an event of more than `MAX_EXAM_SPAN_DAYS` days is no exam, and is skipped (a year-long event made 365);
 * - a calendar of more than `MAX_CALENDAR_EXAMS` exams is refused (`CalendarTooBigError`);
 * - an event whose start is plainly outside the school year is dropped before its dates are parsed.
 * And an entity that names no character (S-M2) is dropped, not thrown on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarTooBigError, MAX_CALENDAR_EXAMS, MAX_EXAM_SPAN_DAYS, calendarExams, examsFromCalendar, isCalendarTooBig,
} from '@sederyom/shared/logic/exam-board/calendar';
import { parseIcs, unescapeText } from '@sederyom/shared/logic/exam-board/ics';

const ZONE = 'Asia/Jerusalem';
const TODAY = '2026-11-10';
const YEAR_LONG = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'school-site', 'year-long-events.ics'), 'utf8');

/** A calendar of `events`, each `[uid, dtstart, dtend]` all-day (`yyyyMMdd`, the end exclusive), titled by its uid. */
function calendarOf(events: [string, string, string][], extra = ''): string {
  return [
    'BEGIN:VCALENDAR',
    ...events.map(([uid, start, end]) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nSUMMARY:מבחן ${uid}${extra}\r\nEND:VEVENT`),
    'END:VCALENDAR',
  ].join('\r\n');
}

/** `n` one-day exams, one a day from 1 September (wrapping inside the school year). */
function oneDayExams(n: number): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (let i = 0; i < n; i += 1) {
    const day = DateTime.fromISO('2026-09-01').plus({ days: i % 360 });
    out.push([`e${i}`, day.toFormat('yyyyMMdd'), day.plus({ days: 1 }).toFormat('yyyyMMdd')]);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a calendar with events that last a year', () => {
  it('skips each event of more than 14 days, with a warning, and keeps the exams around them', () => {
    const warnings: string[] = [];
    const exams = examsFromCalendar(parseIcs(YEAR_LONG, { zone: ZONE }).events, TODAY, ZONE, (m) => warnings.push(m));
    expect(MAX_EXAM_SPAN_DAYS).toBe(14);
    const byUid = new Map<string, string[]>();
    for (const e of exams) {
      const uid = e.naturalKey.split('|')[1]!;
      byUid.set(uid, [...(byUid.get(uid) ?? []), e.payload.date]);
    }
    // A year, most of one, and 15 days: none of them an exam.
    expect([...byUid.keys()].sort()).toEqual(['fourteen-days@google.com', 'history@google.com', 'into-the-year@google.com', 'math@google.com']);
    // 14 days are still an exam, a day each; one that began before the year counts its days inside it.
    expect(byUid.get('fourteen-days@google.com')).toHaveLength(14);
    expect(byUid.get('into-the-year@google.com')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(exams).toHaveLength(19);
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toMatch(/year-long-1@google\.com/);
    expect(warnings.join('\n')).toMatch(/year-long-2@google\.com/);
    expect(warnings.join('\n')).toMatch(/fifteen-days@google\.com/);
  });

  it('gives calendarExams the same exams, and a feed of thousands of year-long events costs nothing', () => {
    expect(calendarExams(YEAR_LONG, TODAY, ZONE).exams).toHaveLength(19);
    // The reviewer's probe, in small: every event a whole school year.
    const huge = calendarOf(Array.from({ length: 3000 }, (_, i): [string, string, string] => [`y${i}`, '20260901', '20270901']));
    const started = Date.now();
    expect(calendarExams(huge, TODAY, ZONE).exams).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('a calendar with more exams than a board may hold', () => {
  it('takes 2,000 exams and refuses 2,001, with an error the callers can tell', () => {
    expect(MAX_CALENDAR_EXAMS).toBe(2000);
    expect(calendarExams(calendarOf(oneDayExams(2000)), TODAY, ZONE).exams).toHaveLength(2000);
    let thrown: unknown;
    try {
      calendarExams(calendarOf(oneDayExams(2001)), TODAY, ZONE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CalendarTooBigError);
    expect(isCalendarTooBig(thrown)).toBe(true);
    expect(isCalendarTooBig(new Error('other'))).toBe(false);
    // The hourly read goes through `examsFromCalendar` itself: the same bound there.
    expect(() => examsFromCalendar(parseIcs(calendarOf(oneDayExams(2001)), { zone: ZONE }).events, TODAY, ZONE)).toThrow(CalendarTooBigError);
  });

  it('counts the days of the events it expands: 150 events of 14 days are 2,100 exams', () => {
    const fortnights = Array.from({ length: 150 }, (_, i): [string, string, string] => {
      const day = DateTime.fromISO('2026-09-01').plus({ days: i * 2 });
      return [`f${i}`, day.toFormat('yyyyMMdd'), day.plus({ days: 14 }).toFormat('yyyyMMdd')];
    });
    expect(() => calendarExams(calendarOf(fortnights), TODAY, ZONE)).toThrow(CalendarTooBigError);
  });
});

describe('an event that starts plainly outside the school year', () => {
  it('is dropped before any of its dates is parsed', () => {
    const old = Array.from({ length: 500 }, (_, i): [string, string, string] => [`old${i}`, '20150105', '20150106']);
    const text = calendarOf([...old, ['now1', '20261124', '20261125'], ['now2', '20261201', '20261202']]);
    const parse = vi.spyOn(DateTime, 'fromFormat');
    const { exams } = calendarExams(text, TODAY, ZONE);
    expect(exams.map((e) => e.naturalKey)).toEqual(['site-exam|now1', 'site-exam|now2']);
    // A handful of parses for the two events of this year, none for the 500 of 2015.
    expect(parse.mock.calls.length).toBeLessThan(10);
  });

  it('keeps an event whose start is just outside the year but which reaches into it, or is inside it in the target zone', () => {
    const text = [
      'BEGIN:VCALENDAR',
      // starts 14 days before the year, ends on its first day
      'BEGIN:VEVENT', 'UID:edge', 'DTSTART;VALUE=DATE:20260819', 'DTEND;VALUE=DATE:20260902', 'SUMMARY:מבחן השלמה', 'END:VEVENT',
      // 31 August 22:00 UTC is 1 September 01:00 in Jerusalem
      'BEGIN:VEVENT', 'UID:late', 'DTSTART:20260831T220000Z', 'DTEND:20260831T230000Z', 'SUMMARY:מבחן בלילה', 'END:VEVENT',
      // the last day of the year, written as the next day in a zone ahead of it
      'BEGIN:VEVENT', 'UID:ahead', 'DTSTART;TZID=Pacific/Kiritimati:20270901T060000', 'DTEND;TZID=Pacific/Kiritimati:20270901T070000', 'SUMMARY:מבחן אחרון', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const exams = calendarExams(text, TODAY, ZONE).exams.map((e) => [e.naturalKey, e.date]);
    expect(exams).toEqual([
      ['site-exam|edge|2026-09-01', '2026-09-01'],
      ['site-exam|late', '2026-09-01'],
      ['site-exam|ahead', '2027-08-31'],
    ]);
  });

  it('is read as before without a window: parseIcs on its own drops nothing', () => {
    const text = calendarOf([['old', '20150105', '20150106']]);
    expect(parseIcs(text, { zone: ZONE }).events.map((e) => e.uid)).toEqual(['old']);
    expect(parseIcs(text, { zone: ZONE, startsBetween: { from: '2026-08-17', to: '2027-09-01' } }).events).toEqual([]);
  });
});

describe('an entity that names no character (S-M2)', () => {
  it('is dropped, and the rest of the text is read', () => {
    expect(unescapeText('א&#1114112;ב')).toBe('אב');
    expect(unescapeText('א&#0;ב')).toBe('אב');
    expect(unescapeText('א&#55296;ב')).toBe('אב');
    expect(unescapeText('א&#57343;ב')).toBe('אב');
    expect(unescapeText('א&#99999999999999999999;ב')).toBe('אב');
    // a real one is still a character
    expect(unescapeText('&#1488;&#128512;')).toBe('א😀');
  });

  it('does not fail the calendar it is in', () => {
    const text = calendarOf([['e1', '20261124', '20261125']], ' &#1114112;&#0;');
    expect(calendarExams(text, TODAY, ZONE).exams.map((e) => e.subject)).toEqual(['מבחן e1']);
  });
});
