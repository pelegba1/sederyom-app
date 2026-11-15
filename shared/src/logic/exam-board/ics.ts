/**
 * A small iCalendar reader — just enough for a Google Calendar's public ICS
 * feed: VEVENT blocks with all-day or timed starts, folded lines, escaped
 * text. Recurrence rules are reported, not expanded; the exam schedule has
 * none, and an exam that repeats weekly would be a parser bug, not a fact.
 */
import { DateTime } from 'luxon';
import type { DateStr } from '../../index';
import { cleanLines } from './text';

export interface IcsEvent {
  uid: string;
  summary: string;
  /**
   * The event's details, one line to each line they were written on, every line cleaned (`cleanLines`: no NUL, no
   * other control, no bidi mark, no zero-width character) and the empty ones dropped; `null` when nothing is left.
   */
  description: string | null;
  location: string | null;
  /** First calendar day in the target zone. */
  startDate: DateStr;
  /** Last calendar day in the target zone, inclusive. */
  endDate: DateStr;
  allDay: boolean;
  /** `CONFIRMED` / `TENTATIVE` / `CANCELLED`, as published. */
  status: string | null;
  /** Carries an RRULE; the caller decides what to do with it. */
  recurring: boolean;
  lastModified: Date | null;
}

export interface IcsCalendar {
  /** `X-WR-CALNAME`, Google's display name for the calendar. */
  name: string | null;
  /** `X-WR-TIMEZONE`, what floating times are in. */
  timezone: string | null;
  events: IcsEvent[];
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** One line into name, parameters and value; the value may contain colons. */
export function parseProperty(line: string): Property | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = head.split(';');
  const name = (rawName ?? '').trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** RFC 5545 §3.3.11 text escapes, then the HTML entities Google lets through. */
export function unescapeText(raw: string): string {
  const text = raw
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
  return decodeEntities(text);
}

/**
 * Whether a numeric entity names a character a database can keep: a code point of Unicode, not NUL and not half of
 * a surrogate pair (Postgres refuses both in text and in `jsonb`).
 */
function keepableCodePoint(code: number): boolean {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // One that names no such character is dropped: it would throw (past U+10FFFF) and fail the whole calendar.
    .replace(/&#(\d+);/g, (_m, code: string) => (keepableCodePoint(Number(code)) ? String.fromCodePoint(Number(code)) : ''))
    .replace(/&amp;/g, '&');
}

/**
 * A DTSTART/DTEND value as a calendar day in `zone`. `VALUE=DATE` is a day
 * already; a timed value is converted from its own zone (TZID, `Z`, or the
 * calendar's floating zone) first.
 */
export function toLocalDay(prop: Property, zone: string, floatingZone: string | null): DateStr | null {
  const value = prop.value.trim();
  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const dt = DateTime.fromFormat(value, 'yyyyMMdd', { zone });
    return dt.isValid ? dt.toISODate() : null;
  }
  const utc = value.endsWith('Z');
  const sourceZone = utc ? 'utc' : (prop.params.TZID ?? floatingZone ?? zone);
  const dt = DateTime.fromFormat(utc ? value.slice(0, -1) : value, "yyyyMMdd'T'HHmmss", { zone: sourceZone });
  return dt.isValid ? dt.setZone(zone).toISODate() : null;
}

/** Unfolds continuation lines (CRLF + one whitespace) into their property. */
export function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

export interface ParseIcsOptions {
  zone: string;
  /**
   * Only events whose `DTSTART` is written as a day from `from` to `to` (inclusive, `yyyy-mm-dd`) are read; the rest
   * are dropped on the text of their start, before any date of theirs is parsed. The day is the one written, in the
   * value's own zone, so the window has to leave a margin for an event that reaches into it and for a zone that
   * writes the day before or after. A start that is not written as a day is read, and dropped if it does not parse.
   * Without it every event is read.
   */
  startsBetween?: { from: DateStr; to: DateStr };
}

/** The day a `DTSTART` value is written as (`20261110`, `20261110T083000Z`), or `null` when it is not one. */
function writtenDay(value: string): DateStr | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseIcs(text: string, opts: ParseIcsOptions): IcsCalendar {
  const calendar: IcsCalendar = { name: null, timezone: null, events: [] };
  let current: Map<string, Property> | null = null;
  // VALARM and friends nest inside VEVENT; their properties are not the event's.
  let nested = 0;

  for (const line of unfold(text)) {
    const prop = parseProperty(line);
    if (!prop) continue;

    if (prop.name === 'BEGIN') {
      const block = prop.value.trim().toUpperCase();
      if (block === 'VEVENT' && current === null) current = new Map();
      else if (current !== null) nested += 1;
      continue;
    }
    if (prop.name === 'END') {
      const block = prop.value.trim().toUpperCase();
      if (nested > 0) {
        nested -= 1;
      } else if (block === 'VEVENT' && current !== null) {
        const event = toEvent(current, opts.zone, calendar.timezone, opts.startsBetween);
        if (event) calendar.events.push(event);
        current = null;
      }
      continue;
    }

    if (current !== null) {
      if (nested === 0 && !current.has(prop.name)) current.set(prop.name, prop);
      continue;
    }
    if (prop.name === 'X-WR-CALNAME') calendar.name = unescapeText(prop.value).trim() || null;
    if (prop.name === 'X-WR-TIMEZONE') calendar.timezone = prop.value.trim() || null;
  }

  return calendar;
}

function toEvent(
  props: Map<string, Property>,
  zone: string,
  floatingZone: string | null,
  window: ParseIcsOptions['startsBetween'],
): IcsEvent | null {
  const start = props.get('DTSTART');
  const uid = props.get('UID')?.value.trim();
  if (!start || !uid) return null;
  if (window) {
    const day = writtenDay(start.value);
    if (day !== null && (day < window.from || day > window.to)) return null;
  }
  const startDate = toLocalDay(start, zone, floatingZone);
  if (!startDate) return null;

  const allDay = start.params.VALUE === 'DATE' || /^\d{8}$/.test(start.value.trim());
  const end = props.get('DTEND');
  let endDate = startDate;
  if (end) {
    const endDay = toLocalDay(end, zone, floatingZone);
    if (endDay) {
      // An all-day DTEND is exclusive: a one-day event ends "tomorrow". A timed
      // end is inclusive of its own day, midnight excepted.
      endDate = allDay || end.params.VALUE === 'DATE'
        ? DateTime.fromISO(endDay, { zone }).minus({ days: 1 }).toISODate()!
        : endsAtMidnight(end) ? DateTime.fromISO(endDay, { zone }).minus({ days: 1 }).toISODate()! : endDay;
      if (endDate < startDate) endDate = startDate;
    }
  }

  const modified = props.get('LAST-MODIFIED')?.value.trim();
  const lastModified = modified
    ? DateTime.fromFormat(modified.replace(/Z$/, ''), "yyyyMMdd'T'HHmmss", { zone: 'utc' })
    : null;

  return {
    uid,
    summary: unescapeText(props.get('SUMMARY')?.value ?? '').trim(),
    // Kept with its line breaks (a list of subjects, one to a line), each line cleaned: what is stored for a class and
    // sent to every phone that follows it cannot carry a character the database refuses.
    description: cleanLines(unescapeText(props.get('DESCRIPTION')?.value ?? '')) || null,
    location: unescapeText(props.get('LOCATION')?.value ?? '').trim() || null,
    startDate,
    endDate,
    allDay,
    status: props.get('STATUS')?.value.trim().toUpperCase() || null,
    recurring: props.has('RRULE'),
    lastModified: lastModified?.isValid ? lastModified.toJSDate() : null,
  };
}

function endsAtMidnight(prop: Property): boolean {
  return /T000000Z?$/.test(prop.value.trim());
}
