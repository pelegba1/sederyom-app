/**
 * All date/time reasoning in SederYom is Asia/Jerusalem, explicitly.
 * Nothing in this codebase may rely on the host timezone.
 */
import { DateTime } from 'luxon';
import { HDate, HebrewCalendar, flags } from '@hebcal/core';
import type { DateStr, TimeStr } from '../index';

export const TZ = 'Asia/Jerusalem';

export function nowTz(zone: string = TZ): DateTime {
  return DateTime.now().setZone(zone);
}

export function todayStr(zone: string = TZ): DateStr {
  return nowTz(zone).toISODate()!;
}

export function toDateStr(dt: DateTime): DateStr {
  return dt.toISODate()!;
}

/*
 * Calendar arithmetic without the zone. A `YYYY-MM-DD` plus some days, or its
 * weekday, is the same in every zone whose clock never skips a whole day
 * (Israel's never has). Through Luxon each one asked `Intl` for the zone's
 * offset, and the phone asked thousands of times for one week it built.
 * Anything that is not such a date, or a zone Luxon does not know, goes
 * Luxon's way, so it throws or answers as it always did.
 */
const DAY_MS = 86_400_000;
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const zonesKnown = new Map<string, boolean>();

function knownZone(zone: string): boolean {
  let known = zonesKnown.get(zone);
  if (known === undefined) {
    known = DateTime.fromISO('2000-01-01', { zone }).isValid;
    zonesKnown.set(zone, known);
  }
  return known;
}

/**
 * `date` as days since 1970-01-01, for a real date of the years 1000–9999 in a
 * zone Luxon knows; `null` for anything else.
 */
export function calendarDay(date: string, zone: string = TZ): number | null {
  const m = PLAIN_DATE.exec(date);
  if (!m || !knownZone(zone)) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (year < 1000) return null;
  const ms = Date.UTC(year, month, day);
  const back = new Date(ms);
  if (back.getUTCMonth() !== month || back.getUTCDate() !== day) return null;
  return ms / DAY_MS;
}

/** Days since 1970-01-01 as a `YYYY-MM-DD`; `null` outside the years 1000–9999. */
function fromCalendarDay(day: number): DateStr | null {
  const dt = new Date(day * DAY_MS);
  const year = dt.getUTCFullYear();
  if (year < 1000 || year > 9999) return null;
  return `${year}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Kept answers of the pure functions below; a full one starts again rather than grow. */
function remember<V>(kept: Map<string, V>, key: string, value: V): V {
  if (kept.size >= 4096) kept.clear();
  kept.set(key, value);
  return value;
}

const startsOfDay = new Map<string, DateTime>();

/** Start of the given calendar day in Asia/Jerusalem. */
export function parseDateStr(date: DateStr, zone: string = TZ): DateTime {
  const key = `${zone}|${date}`;
  const kept = startsOfDay.get(key);
  if (kept) return kept;
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new Error(`invalid date string: ${date}`);
  // A DateTime never changes, so the same one serves every caller.
  return remember(startsOfDay, key, dt.startOf('day'));
}

export function addDays(date: DateStr, days: number, zone: string = TZ): DateStr {
  const day = Number.isInteger(days) ? calendarDay(date, zone) : null;
  const sum = day === null ? null : fromCalendarDay(day + days);
  return sum ?? toDateStr(parseDateStr(date, zone).plus({ days }));
}

const instants = new Map<string, DateTime>();

/** Combines a `YYYY-MM-DD` and a `HH:mm` into an instant in Asia/Jerusalem. */
export function atTime(date: DateStr, time: TimeStr, zone: string = TZ): DateTime {
  const key = `${zone}|${date}|${time}`;
  const kept = instants.get(key);
  if (kept) return kept;
  const [h, m] = time.split(':').map(Number);
  return remember(instants, key, parseDateStr(date, zone).set({ hour: h ?? 0, minute: m ?? 0 }));
}

const WEEKDAY_HE = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

/** Hebrew weekday name; index 0 = Sunday, matching the Shahaf table's `data-day`. */
export function weekdayNameHe(date: DateStr, zone: string = TZ): string {
  return WEEKDAY_HE[sundayIndex(date, zone)]!;
}

/** 0 = Sunday .. 6 = Saturday. Luxon weekday is 1 = Monday .. 7 = Sunday. */
export function sundayIndex(date: DateStr, zone: string = TZ): number {
  const day = calendarDay(date, zone);
  // 1970-01-01 was a Thursday.
  return day === null ? parseDateStr(date, zone).weekday % 7 : (((day + 4) % 7) + 7) % 7;
}

/** Sunday that starts the week containing `date`, shifted by `offset` weeks. */
export function weekStart(date: DateStr, offset = 0, zone: string = TZ): DateStr {
  return addDays(date, -sundayIndex(date, zone) + offset * 7, zone);
}

const HEB_MONTHS: Record<string, string> = {
  Nisan: 'ניסן', Iyyar: 'אייר', Sivan: 'סיוון', Tamuz: 'תמוז', Av: 'אב', Elul: 'אלול',
  Tishrei: 'תשרי', Cheshvan: 'חשוון', Kislev: 'כסלו', Tevet: 'טבת', "Sh'vat": 'שבט',
  Adar: 'אדר', 'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳',
};

const GEMATRIYA_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const GEMATRIYA_TENS = ['', 'י', 'כ', 'ל'];

/** Hebrew day-of-month in letters: 1 → "א׳", 11 → "י״א", 15 → "ט״ו". */
export function hebrewDayLetters(day: number): string {
  if (day === 15) return 'ט״ו';
  if (day === 16) return 'ט״ז';
  const tens = Math.floor(day / 10);
  const ones = day % 10;
  const letters = `${GEMATRIYA_TENS[tens] ?? ''}${GEMATRIYA_ONES[ones] ?? ''}`;
  if (letters.length === 1) return `${letters}׳`;
  return `${letters.slice(0, -1)}״${letters.slice(-1)}`;
}

/** e.g. "י״א באלול" — matches the header in the UI kit. */
export function hebrewDateHe(date: DateStr, zone: string = TZ): string {
  const dt = parseDateStr(date, zone);
  const hd = new HDate(new Date(dt.year, dt.month - 1, dt.day));
  const monthEn = hd.getMonthName();
  const monthHe = HEB_MONTHS[monthEn] ?? monthEn;
  const prefix = /^[בכפ]/.test(monthHe) ? 'ב' : 'ב';
  return `${hebrewDayLetters(hd.getDate())} ${prefix}${monthHe}`;
}

export interface SchoolDayInfo {
  isSchoolDay: boolean;
  holidayName: string | null;
}

/** One of the Ministry's vacations, or a day the law closes schools: an inclusive range. */
export interface SchoolDayOff {
  from: DateStr;
  to: DateStr;
  name: string;
}

/**
 * Days off the Hebrew calendar does not mark as Yom Tov: the Ministry of
 * Education's vacations and the days the law closes schools, one school year
 * at a time; add the next year's from its לוח חופשות. A range may cover a
 * chag: the chag's own name wins on its days (`schoolDayInfo`).
 *
 * תשפ״ז, per the Ministry's calendar as Mako and Antro published it (the two
 * agree; Hanukkah was also checked against Israel Hayom's copy, which could
 * not be read on 2026-10-28): ערב ראש השנה 11.9; Yom Kippur to Sukkot 20.9–3.10
 * (the chagim and Chol HaMoed are hebcal's); Hanukkah 6–11.12 (back on 13.12);
 * Purim and Shushan Purim 23–24.3 (back on 25.3, everywhere); Pesach
 * 13–28.4 (back on 29.4); Yom HaAtzmaut 12.5; Erev Shavuot 10.6 (Shavuot is
 * the 11th, back on 13.6). Lag BaOmer (25.5) and Yom HaZikaron are school
 * days. Middle and high schools end on 20.6, the summer rule below. Election
 * day 27.10.2026 is a שבתון by law.
 *
 * The phone takes the server's copy of this list when it is newer
 * (`SCHOOL_CALENDAR_REVISION`, `takeSchoolDaysOff`): a date fixed here reaches
 * every phone with the next server deploy, not the next app release.
 */
export const SCHOOL_DAYS_OFF: readonly SchoolDayOff[] = [
  { from: '2026-09-11', to: '2026-09-11', name: 'ערב ראש השנה' },
  { from: '2026-09-20', to: '2026-09-20', name: 'ערב יום כיפור' },
  { from: '2026-09-22', to: '2026-09-25', name: 'חופשת סוכות' },
  { from: '2026-10-27', to: '2026-10-27', name: 'יום הבחירות' },
  { from: '2026-12-06', to: '2026-12-11', name: 'חופשת חנוכה' },
  { from: '2027-03-23', to: '2027-03-23', name: 'פורים' },
  { from: '2027-03-24', to: '2027-03-24', name: 'שושן פורים' },
  { from: '2027-04-13', to: '2027-04-28', name: 'חופשת פסח' },
  { from: '2027-05-12', to: '2027-05-12', name: 'יום העצמאות' },
  { from: '2027-06-10', to: '2027-06-10', name: 'ערב שבועות' },
];

/** Raised with every change to `SCHOOL_DAYS_OFF`, so a phone can tell whose list is newer. */
export const SCHOOL_CALENDAR_REVISION = 2;

/** The list `schoolDayInfo` reads: the built-in one, unless the phone took a newer one. */
let daysOff: readonly SchoolDayOff[] = SCHOOL_DAYS_OFF;

/** What a list from elsewhere must look like to be used: dates as `YYYY-MM-DD`, in order, and a name. */
export function validSchoolDaysOff(list: unknown): list is SchoolDayOff[] {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  return Array.isArray(list) && list.length <= 500 && list.every((v: Partial<SchoolDayOff> | null) =>
    typeof v === 'object' && v !== null
    && typeof v.from === 'string' && day.test(v.from)
    && typeof v.to === 'string' && day.test(v.to) && v.from <= v.to
    && typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 60);
}

/**
 * The list `schoolDayInfo` reads from now on: `served`, the server's, when it
 * is at least as new as the built-in one and reads as a list; the built-in
 * one otherwise (and for `null`). True when `served` was taken.
 */
export function takeSchoolDaysOff(served: { revision: number; daysOff: unknown } | null): boolean {
  const take = served !== null && Number.isInteger(served.revision) && served.revision >= SCHOOL_CALENDAR_REVISION
    && validSchoolDaysOff(served.daysOff);
  daysOff = take ? served.daysOff as SchoolDayOff[] : SCHOOL_DAYS_OFF;
  schoolDays.clear();
  return take;
}

/** `schoolDayInfo`'s answers for the list `daysOff` holds now; hebcal is slow to ask, and every day built asks. */
const schoolDays = new Map<string, SchoolDayInfo>();

/**
 * Israeli school-day approximation (design-doc §5.3): no Saturday, no Yom Tov,
 * no Chol HaMoed, no Ministry vacation (`SCHOOL_DAYS_OFF`), and no summer
 * vacation. Deliberately an approximation — the "חופש" toggle in Settings is
 * the manual override.
 */
export function schoolDayInfo(date: DateStr, zone: string = TZ): SchoolDayInfo {
  const key = `${zone}|${date}`;
  const info = schoolDays.get(key) ?? remember(schoolDays, key, schoolDayOf(date, zone));
  // A copy: a caller that changes its answer changes no one else's.
  return { ...info };
}

function schoolDayOf(date: DateStr, zone: string): SchoolDayInfo {
  const dow = sundayIndex(date, zone);
  if (dow === 6) return { isSchoolDay: false, holidayName: 'שבת' };

  const dt = parseDateStr(date, zone);
  const jsDate = new Date(dt.year, dt.month - 1, dt.day);

  // Summer vacation: 21 June through 31 August. Middle and high schools end on
  // 20 June; elementary schools on 30 June, but the app is for 7th grade and up.
  const inSummer =
    (dt.month === 6 && dt.day >= 21) || dt.month === 7 || dt.month === 8;
  if (inSummer) return { isSchoolDay: false, holidayName: 'חופשת הקיץ' };

  const holiday = holidayOn(jsDate);
  if (holiday) return { isSchoolDay: false, holidayName: holiday };

  const vacation = daysOff.find((v) => date >= v.from && date <= v.to);
  if (vacation) return { isSchoolDay: false, holidayName: vacation.name };
  return { isSchoolDay: true, holidayName: null };
}

/** The chag, Chol HaMoed or major fast on the day, by hebcal's Hebrew name; `null` on any other day. */
function holidayOn(jsDate: Date): string | null {
  const events = HebrewCalendar.calendar({
    start: jsDate,
    end: jsDate,
    il: true,
    noMinorFast: true,
    noSpecialShabbat: true,
    noRoshChodesh: true,
  });
  for (const ev of events) {
    const f = ev.getFlags();
    // eslint-disable-next-line no-bitwise
    if (f & flags.CHAG || f & flags.CHOL_HAMOED || f & flags.MAJOR_FAST) return ev.render('he');
  }
  return null;
}

/** True when `time` falls inside the quiet window, which may wrap past midnight. */
export function isInQuietHours(time: TimeStr, from: TimeStr, to: TimeStr): boolean {
  const t = minutesOf(time);
  const a = minutesOf(from);
  const b = minutesOf(to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

export function minutesOf(time: TimeStr): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timeStrOf(dt: DateTime): TimeStr {
  return dt.toFormat('HH:mm');
}

/** True inside the school-sources' fast-poll window (design-doc §5.1). */
export function inActiveWindow(now: DateTime, start: TimeStr, end: TimeStr): boolean {
  const t = now.hour * 60 + now.minute;
  return t >= minutesOf(start) && t <= minutesOf(end);
}
