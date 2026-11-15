/**
 * The exam board's shared pieces (plan: exam-board-sources, task 1): the key of
 * a row that came from a file, the calendar-id reader that must run on the
 * phone as well as here, and the grade calendar's exams read in one call.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarExams, examsFromCalendar, normalizeCalendarId } from '@sederyom/shared/logic/exam-board/calendar';
import { parseIcs } from '@sederyom/shared/logic/exam-board/ics';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';

const ZONE = 'Asia/Jerusalem';
const TODAY = '2026-09-17';
const CAL = 'c_0123abcd@group.calendar.google.com';

describe('uploadedExamKey', () => {
  it('is the same for the same day and the same title, whatever the spaces', () => {
    expect(uploadedExamKey('2026-11-09', 'מבחן בערבית ט1-3')).toBe(uploadedExamKey('2026-11-09', ' מבחן  בערבית ט1-3 '));
  });

  it('differs between days', () => {
    expect(uploadedExamKey('2026-11-09', 'מבחן בערבית ט1-3')).not.toBe(uploadedExamKey('2026-11-10', 'מבחן בערבית ט1-3'));
  });

  it('differs between titles', () => {
    expect(uploadedExamKey('2026-11-09', 'מבחן בערבית')).not.toBe(uploadedExamKey('2026-11-09', 'מבחן בעברית'));
  });

  it('does not tell a straight quote from the Hebrew one, nor an apostrophe from a geresh', () => {
    const d = '2026-11-09';
    expect(uploadedExamKey(d, "מבחן ט'5")).toBe(uploadedExamKey(d, 'מבחן ט׳5'));
    expect(uploadedExamKey(d, 'בגרות י"ב')).toBe(uploadedExamKey(d, 'בגרות י״ב'));
  });

  it('starts with the prefix of an uploaded exam', () => {
    for (const title of ['מבחן בערבית ט1-3', '', 'x']) {
      expect(uploadedExamKey('2026-11-09', title)).toMatch(/^site-exam\|up\|[0-9a-f]{8}$/);
    }
  });
});

describe('normalizeCalendarId without Buffer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the cid= link on a phone, where there is no Buffer and no atob', () => {
    // What Google shares: the id in base64, URL-safe or not, padded or not.
    const cid = Buffer.from(CAL).toString('base64');
    const urlSafe = cid.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const links = [
      `https://calendar.google.com/calendar/u/0?cid=${cid}`,
      `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(cid)}`,
      `https://calendar.google.com/calendar/u/0?cid=${urlSafe}`,
    ];

    const read: (string | null)[] = [];
    vi.stubGlobal('Buffer', undefined);
    vi.stubGlobal('atob', undefined);
    try {
      for (const link of links) read.push(normalizeCalendarId(link));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(read).toEqual([CAL, CAL, CAL]);
  });

  it('refuses a cid= that is not base64 of an id', () => {
    expect(normalizeCalendarId('https://calendar.google.com/calendar/u/0?cid=!!!')).toBeNull();
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/u/0?cid=${Buffer.from('not a calendar').toString('base64')}`)).toBeNull();
    expect(normalizeCalendarId('https://calendar.google.com/calendar/u/0?cid=%E0%A4%A')).toBeNull();
  });

  it('still reads the other forms', () => {
    expect(normalizeCalendarId(CAL)).toBe(CAL);
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(CAL)}&ctz=Asia%2FJerusalem`)).toBe(CAL);
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL)}/public/basic.ics`)).toBe(CAL);
    expect(normalizeCalendarId('not a calendar')).toBeNull();
  });
});

describe('calendarExams', () => {
  const ics = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'school-site', 'exams-yb.ics'), 'utf8');

  it('gives the calendar its name and its exams in the shape of the class feed', () => {
    const { name, exams } = calendarExams(ics, TODAY, ZONE);
    expect(name).toBe('לוח מבחנים שכבת י"ב');
    expect(exams).toHaveLength(33);
    expect(exams.every((e) => e.source === 'school_site')).toBe(true);

    const hebrew = exams.find((e) => e.naturalKey === 'site-exam|5pk68ukh1j4ssmgc8dku53e2ac@google.com')!;
    expect(hebrew).toEqual({
      naturalKey: 'site-exam|5pk68ukh1j4ssmgc8dku53e2ac@google.com',
      date: '2026-11-19',
      subject: 'מבחן בעברית',
      details: null,
      source: 'school_site',
    });
  });

  it('is the same exams as the adapter reads, one for one', () => {
    const entities = examsFromCalendar(parseIcs(ics, { zone: ZONE }).events, TODAY, ZONE);
    expect(calendarExams(ics, TODAY, ZONE).exams.map((e) => e.naturalKey)).toEqual(entities.map((e) => e.naturalKey));
  });

  it('has no name for a calendar that has none, and no exams for text that is no calendar', () => {
    expect(calendarExams('BEGIN:VCALENDAR\nEND:VCALENDAR', TODAY, ZONE)).toEqual({ name: null, exams: [] });
    expect(calendarExams('<html></html>', TODAY, ZONE)).toEqual({ name: null, exams: [] });
  });
});
