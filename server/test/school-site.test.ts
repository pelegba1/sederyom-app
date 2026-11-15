/**
 * The school website's exam schedule (design-doc §6.4): a public Google
 * calendar, read through its ICS feed. The fixture is the real feed for
 * "לוח מבחנים שכבת י"ב", captured 2026-09-17, three school years deep.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIcs, parseProperty, unescapeText, unfold } from '../src/adapters/school-site/ics.js';
import {
  SchoolSiteAdapter, examCalendarIcsUrl, examTitle, examsFromCalendar, schoolYearOf,
} from '../src/adapters/school-site/index.js';

const ZONE = 'Asia/Jerusalem';
const fixture = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'school-site', 'exams-yb.ics'), 'utf8');
const TODAY = '2026-09-17';

describe('ics reader', () => {
  it('reads the calendar name and every event', () => {
    const cal = parseIcs(fixture, { zone: ZONE });
    expect(cal.name).toBe('לוח מבחנים שכבת י"ב');
    expect(cal.timezone).toBe('Asia/Jerusalem');
    expect(cal.events).toHaveLength(192);
    expect(cal.events.every((e) => e.allDay)).toBe(true);
  });

  it('treats an all-day DTEND as exclusive, across a month boundary too', () => {
    const cal = parseIcs(fixture, { zone: ZONE });
    const oneDay = cal.events.find((e) => e.uid === '4kr1h3hl0r1t5suk310rjcejlt@google.com')!;
    expect(oneDay.summary).toBe('י"ב מבדק במדעי המחשב גוש');
    expect([oneDay.startDate, oneDay.endDate]).toEqual(['2024-09-30', '2024-09-30']);

    const twoDays = cal.events.find((e) => e.uid === '7uducfvo82i7aftnvkern7sg7g@google.com')!;
    expect(twoDays.summary).toBe('י"ב טורניר כספות');
    expect([twoDays.startDate, twoDays.endDate]).toEqual(['2025-03-25', '2025-03-26']);
  });

  it('unescapes text and the HTML entities the school types into descriptions', () => {
    expect(unescapeText('שאלון 471 - 4 יח&quot\\;ל \\n שאלון 572\\, חלק ב')).toBe('שאלון 471 - 4 יח"ל \n שאלון 572, חלק ב');
    expect(unescapeText('a\\\\b &amp; c')).toBe('a\\b & c');
  });

  it('unfolds continuation lines and splits parameters from values', () => {
    expect(unfold('SUMMARY:יב טור\r\n ניר\r\nUID:x')).toEqual(['SUMMARY:יב טורניר', 'UID:x']);
    const prop = parseProperty('DTSTART;TZID=Asia/Jerusalem:20261110T103000')!;
    expect(prop).toEqual({ name: 'DTSTART', params: { TZID: 'Asia/Jerusalem' }, value: '20261110T103000' });
    // A value may itself contain colons.
    expect(parseProperty('URL:https://example.com/a:b')!.value).toBe('https://example.com/a:b');
  });

  it('converts a timed start to a calendar day in the target zone', () => {
    const cal = parseIcs(
      ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:late', 'DTSTART:20261110T225900Z', 'DTEND:20261110T235900Z', 'SUMMARY:x', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
      { zone: ZONE },
    );
    // 22:59 UTC is 00:59 the next day in Jerusalem.
    expect(cal.events[0]!.startDate).toBe('2026-11-11');
    expect(cal.events[0]!.allDay).toBe(false);
  });
});

describe('exam schedule', () => {
  it('knows which school year a day belongs to', () => {
    expect(schoolYearOf('2026-09-17')).toEqual({ start: '2026-09-01', end: '2027-08-31' });
    expect(schoolYearOf('2027-03-01')).toEqual({ start: '2026-09-01', end: '2027-08-31' });
    expect(schoolYearOf('2026-08-20')).toEqual({ start: '2025-09-01', end: '2026-08-31' });
  });

  it('drops the grade prefix from a title and nothing else', () => {
    expect(examTitle(' י"ב- מבחן בגוש ב ')).toBe('מבחן בגוש ב');
    expect(examTitle("יב מבחן גוש א'")).toBe("מבחן גוש א'");
    expect(examTitle(' י"ב - הדמיה ממוחשבת בביולוגיה')).toBe('הדמיה ממוחשבת בביולוגיה');
    expect(examTitle('יב תאריך הגשת ביו חקר')).toBe('תאריך הגשת ביו חקר');
    expect(examTitle('בגרות בהיסטוריה - רק למשפרים')).toBe('בגרות בהיסטוריה - רק למשפרים');
    // Every grade's calendar, not only י״ב's.
    expect(examTitle('י"א- מבחן בתנ"ך')).toBe('מבחן בתנ"ך');
    expect(examTitle("ט' מבחן במתמטיקה")).toBe('מבחן במתמטיקה');
    expect(examTitle('ח - בוחן באנגלית')).toBe('בוחן באנגלית');
    expect(examTitle('י"א2 גוש')).toBe('י"א2 גוש');
    // A class name is information; only the bare grade token goes.
    expect(examTitle('י"ב2+ גוש- מתכונת במעבדה בפיזיקה-')).toBe('י"ב2+ גוש- מתכונת במעבדה בפיזיקה');
  });

  it('keeps only this school year, one exam per calendar event', () => {
    const cal = parseIcs(fixture, { zone: ZONE });
    const exams = examsFromCalendar(cal.events, TODAY, ZONE);
    expect(exams).toHaveLength(33);
    expect(exams.every((e) => e.source === 'school_site' && e.kind === 'exam')).toBe(true);
    expect(exams.every((e) => e.payload.date >= '2026-09-01' && e.payload.date <= '2027-08-31')).toBe(true);

    const hebrew = exams.find((e) => e.naturalKey === 'site-exam|5pk68ukh1j4ssmgc8dku53e2ac@google.com')!;
    expect(hebrew.payload).toEqual({ date: '2026-11-19', subject: 'מבחן בעברית', details: null });

    const math = exams.find((e) => e.naturalKey === 'site-exam|2kph37bjrt1v8nmjj0g9m61vs7@google.com')!;
    expect(math.payload.subject).toBe('בגרות במתמטיקה - רק למשפרים');
    expect(math.payload.details).toContain('4 יח"ל');
    expect(math.payload.details).toContain('\n');
  });

  it('expands a multi-day event, converts timed ones, and skips cancelled, recurring and last year', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:multi', 'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261105', 'SUMMARY:יב טורניר', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:timed', 'DTSTART:20261110T083000Z', 'DTEND:20261110T100000Z', 'SUMMARY:יב- מבחן בעברית',
      'DESCRIPTION:שאלון 1\\, שאלון 2\\nחלק ב', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:gone', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261112', 'SUMMARY:יב מבוטל', 'STATUS:CANCELLED', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:weekly', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261113', 'RRULE:FREQ=WEEKLY', 'SUMMARY:יב חוזר', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:lastyear', 'DTSTART;VALUE=DATE:20260520', 'DTEND;VALUE=DATE:20260521', 'SUMMARY:יב מבחן ישן', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const warnings: string[] = [];
    const exams = examsFromCalendar(parseIcs(ics, { zone: ZONE }).events, TODAY, ZONE, (m) => warnings.push(m));

    expect(exams.map((e) => e.naturalKey)).toEqual(['site-exam|multi|2026-11-03', 'site-exam|multi|2026-11-04', 'site-exam|timed']);
    expect(exams[2]!.payload).toEqual({ date: '2026-11-10', subject: 'מבחן בעברית', details: 'שאלון 1, שאלון 2\nחלק ב' });
    expect(warnings).toEqual(['recurring event skipped: weekly "יב חוזר"']);
  });

  it('polls the public ICS of the configured calendar and reports a complete exam scope', async () => {
    const urls: string[] = [];
    const adapter = new SchoolSiteAdapter({
      calendarId: 'abc@group.calendar.google.com',
      zone: ZONE,
      fetcher: async (url) => {
        urls.push(url);
        return fixture;
      },
    });
    const result = await adapter.poll({
      now: new Date('2026-09-17T19:00:00+03:00'),
      classId: '53',
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(urls).toEqual([examCalendarIcsUrl('abc@group.calendar.google.com')]);
    expect(urls[0]).toBe('https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics');
    expect(result.entities).toHaveLength(33);
    expect(result.completeScopes).toEqual([{ kind: 'exam' }]);
    // The latest edit of any event is the calendar's own freshness.
    expect(result.sourceFreshness?.toISOString()).toBe('2026-09-17T09:43:25.000Z');
  });
});
