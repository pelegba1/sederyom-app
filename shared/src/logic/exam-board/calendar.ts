/**
 * The grade's exam calendar (design-doc §6.4): a public Google calendar the
 * school site embeds. One reader for the server, which polls it hourly for the
 * classes that follow one, and for the phone, which reads a calendar a student
 * points it at before anything is saved.
 *
 * School websites publish a grade's exam schedule ("לוח מבחנים שכבה י״ב") as
 * the embedded calendar; its ICS feed is public and needs no credentials, and
 * every event inside the current school year becomes an `exam` entity. The
 * whole grade shares one calendar, so which of these exams are actually a
 * student's is decided on the phone by `exams.hiddenKeys` (design-doc §7),
 * never here.
 */
import type { ClassExam } from '../../devices';
import type { DateStr } from '../../index';
import type { NormalizedEntity } from '../entities';
import { addDays } from '../time';
import { parseIcs, type IcsEvent } from './ics';
import { cleanText } from './text';

/** Google serves any public calendar's ICS at this well-known path. */
export function examCalendarIcsUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 (either alphabet is turned into the standard one before this), read
 * as UTF-8; `null` when the bytes are not UTF-8. By hand, because the phone
 * runs this too and Hermes has neither Node's byte buffers nor, reliably, a
 * base64 decoder of its own. Like Node's, it skips characters outside the
 * alphabet and stops at the first `=`.
 */
function base64ToUtf8(b64: string): string | null {
  let bits = 0;
  let acc = 0;
  let escaped = '';
  for (const ch of b64) {
    if (ch === '=') break;
    const six = BASE64.indexOf(ch);
    if (six < 0) continue;
    acc = (acc << 6) | six;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      escaped += `%${((acc >> bits) & 0xff).toString(16).padStart(2, '0')}`;
      acc &= (1 << bits) - 1;
    }
  }
  try {
    // Every byte as %XX is the one UTF-8 reader the engine always has.
    return decodeURIComponent(escaped);
  } catch {
    return null;
  }
}

/**
 * A public Google calendar's id, or `null`, from whichever form a student
 * finds it in:
 * - the id itself;
 * - the embed URL a school site's "לוח מבחנים" page carries (`calendar/embed?src=<id>`);
 * - the "add this calendar" link Google shares (`calendar/u/0?cid=<base64 of the id>`);
 * - the calendar's public iCal address (`calendar/ical/<id>/public/basic.ics`).
 * The server fetches only Google's fixed ICS address for it
 * (`examCalendarIcsUrl`), so the id is all that is taken from the device.
 */
export function normalizeCalendarId(input: string): string | null {
  const raw = input.trim();
  const decode = (s: string): string | null => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  let value: string | null = raw;
  const src = /[?&]src=([^&#\s]+)/.exec(raw);
  const cid = /[?&]cid=([^&#\s]+)/.exec(raw);
  const ical = /\/calendar\/ical\/([^/?#\s]+)\/public\//.exec(raw);
  if (src) value = decode(src[1]!);
  else if (ical) value = decode(ical[1]!);
  else if (cid) {
    const b64 = decode(cid[1]!);
    value = b64 === null ? null : base64ToUtf8(b64.replace(/-/g, '+').replace(/_/g, '/'));
  }
  return value !== null && /^[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,100}\.[A-Za-z]{2,}$/.test(value) ? value : null;
}

/**
 * The school year `today` belongs to: 1 September through 31 August. The
 * calendar carries every year since it was created, and last year's exams
 * are neither news nor anyone's business any more.
 */
export function schoolYearOf(today: DateStr): { start: DateStr; end: DateStr } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const startYear = m >= 9 ? y : y - 1;
  return { start: `${startYear}-09-01`, end: `${startYear + 1}-08-31` };
}

/**
 * The calendar prefixes most titles with the grade — "י"ב- מבחן באזרחות",
 * "ט' מבחן גוש א'" — which says nothing inside an app that already knows
 * the grade. Strip that token only; "י"ב2+ גוש" names a class and stays.
 */
const GRADE_PREFIX = /^(?:י["״׳']?[אבגד]|[זחטי]["״׳']?)(?=[\s\-–:,.]|$)[\s\-–:,.]*/;

export function examTitle(summary: string): string {
  // Cleaned as every title of a board is (`cleanText`): no control, no bidi mark, no zero-width character, one line.
  return cleanText(summary)
    .replace(GRADE_PREFIX, '')
    .replace(/[\s\-–:,.]+$/, '')
    .trim();
}

/** `site-exam|<uid>`, plus the day for an event that spans several. */
export function examNaturalKey(uid: string, date: DateStr, multiDay: boolean): string {
  return multiDay ? `site-exam|${uid}|${date}` : `site-exam|${uid}`;
}

export interface SiteExamPayload {
  date: DateStr;
  subject: string;
  details: string | null;
}

/**
 * The longest an exam lasts, in days: an event longer than this (a term, "שנת הלימודים", a season of holidays) is
 * not one, and is skipped. Each day of an event is an exam of its own, so without this a calendar of year-long
 * events was read into hundreds of exams an event.
 */
export const MAX_EXAM_SPAN_DAYS = 14;

/**
 * The most exams one calendar may give for a school year. A real grade's calendar gives a few hundred; past this the
 * calendar is refused (`CalendarTooBigError`), wherever it is read.
 */
export const MAX_CALENDAR_EXAMS = 2000;

/**
 * A calendar that gives more than `MAX_CALENDAR_EXAMS` exams. Each caller says what that means for it: the preview
 * answers `too_big`, the server's reads keep nothing of it and note the error, the phone keeps the read before.
 */
export class CalendarTooBigError extends Error {
  constructor() {
    super(`the calendar gives more than ${MAX_CALENDAR_EXAMS} exams`);
    this.name = 'CalendarTooBigError';
  }
}

/** Whether `err` is a `CalendarTooBigError`, by its name as well, for an error that crossed a module boundary. */
export function isCalendarTooBig(err: unknown): boolean {
  return err instanceof CalendarTooBigError || (err instanceof Error && err.name === 'CalendarTooBigError');
}

/** A day `days` away from `date`, by the calendar alone (no zone: a day is a day). */
function shiftDay(date: DateStr, days: number): DateStr {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** How many days an event runs, its first and last day both counted. */
function spanDays(start: DateStr, end: DateStr): number {
  const [a, b] = [start, end].map((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  }) as [number, number];
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * The days an event of the school year around `today` can start on, as written in its `DTSTART` (`parseIcs`'s
 * `startsBetween`): from `MAX_EXAM_SPAN_DAYS` and a day before the year (an event that begins before it and reaches
 * into it, and a start written in a zone behind), to a day after it (one written in a zone ahead). Anything else is
 * plainly outside the year and is not parsed at all; the calendar keeps every year since it was made.
 */
export function examStartWindow(today: DateStr): { from: DateStr; to: DateStr } {
  const year = schoolYearOf(today);
  return { from: shiftDay(year.start, -(MAX_EXAM_SPAN_DAYS + 1)), to: shiftDay(year.end, 1) };
}

/**
 * Pure: which exams a parsed calendar publishes for the school year around
 * `today`. Cancelled and recurring events are dropped, the latter with a
 * warning — an exam is not a weekly event, and silently expanding one would
 * invent exams. So is an event of more than `MAX_EXAM_SPAN_DAYS` days, with a
 * warning; and a calendar that gives more than `MAX_CALENDAR_EXAMS` exams
 * throws `CalendarTooBigError` as soon as it passes them.
 */
export function examsFromCalendar(
  events: IcsEvent[],
  today: DateStr,
  zone: string,
  onWarn: (msg: string) => void = () => {},
): NormalizedEntity<SiteExamPayload>[] {
  const year = schoolYearOf(today);
  const out: NormalizedEntity<SiteExamPayload>[] = [];
  for (const ev of events) {
    if (ev.status === 'CANCELLED') continue;
    if (ev.recurring) {
      onWarn(`recurring event skipped: ${ev.uid} "${ev.summary}"`);
      continue;
    }
    const subject = examTitle(ev.summary);
    if (!subject) continue;
    if (ev.endDate < year.start || ev.startDate > year.end) continue;
    const days = spanDays(ev.startDate, ev.endDate);
    if (days > MAX_EXAM_SPAN_DAYS) {
      onWarn(`event of ${days} days skipped: ${ev.uid}`);
      continue;
    }

    const multiDay = ev.endDate > ev.startDate;
    for (let date = ev.startDate; date <= ev.endDate; date = addDays(date, 1, zone)) {
      if (date < year.start || date > year.end) continue;
      if (out.length >= MAX_CALENDAR_EXAMS) throw new CalendarTooBigError();
      out.push({
        source: 'school_site',
        kind: 'exam',
        naturalKey: examNaturalKey(ev.uid, date, multiDay),
        payload: { date, subject, details: ev.description },
      });
    }
  }
  return out;
}

/**
 * A calendar's ICS text as the class feed carries its exams: each one
 * marked `school_site`, in the shape the server stores for a class and the
 * phone merges. `name` is Google's display name for the calendar
 * (`X-WR-CALNAME`), for a student to recognise it by. Only the events that may
 * be of the school year are parsed (`examStartWindow`); throws
 * `CalendarTooBigError` for a calendar of more than `MAX_CALENDAR_EXAMS` exams.
 */
export function calendarExams(icsText: string, today: DateStr, zone: string): { name: string | null; exams: ClassExam[] } {
  const calendar = parseIcs(icsText, { zone, startsBetween: examStartWindow(today) });
  const exams = examsFromCalendar(calendar.events, today, zone).map(
    (e): ClassExam => ({
      naturalKey: e.naturalKey,
      date: e.payload.date,
      subject: e.payload.subject,
      details: e.payload.details,
      source: 'school_site',
    }),
  );
  return { name: calendar.name, exams };
}
