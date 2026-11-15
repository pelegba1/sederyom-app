/**
 * The Ministry's vacations on the phone (ideas ל1). The app is built with a
 * list (`SCHOOL_DAYS_OFF`), and a date missing from it, or one the Ministry
 * moves, would wait for the next release and for every student to update: a
 * vacation day shown as a school day, and the absence tracker counting its
 * lessons. So the phone asks the server for its list (`GET /v2/calendar`) at
 * most once a day, keeps the answer, and builds its days with whichever list
 * is newer (`takeSchoolDaysOff`). The stored one is taken before anything
 * builds a day: the app, the widgets and the background task all start in
 * `index.js`, which takes it first.
 *
 * Pure but for the fetch, which is passed in like the storage, so the tests
 * drive it with a map.
 */
import type { SchoolCalendarResponse } from '@sederyom/shared';
import { takeSchoolDaysOff } from '@sederyom/shared/logic/time';
import { API_BASE_URL } from '../config';
import type { KeyValue } from '../mashov/sync';

export const CALENDAR_KEYS = {
  /** The server's last answer, as it came. */
  served: 'school.calendar',
  /** When the server last answered, an ISO instant. */
  askedAt: 'school.calendarAskedAt',
} as const;

/** How long an answer stands before the phone asks again: the list changes a few times a year. */
export const CALENDAR_EVERY_MS = 20 * 60 * 60_000;

function storedCalendar(kv: KeyValue): SchoolCalendarResponse | null {
  try {
    const raw = kv.getString(CALENDAR_KEYS.served);
    return raw ? (JSON.parse(raw) as SchoolCalendarResponse) : null;
  } catch {
    return null;
  }
}

/** Builds the days with the stored list when it is newer than the app's own. True when it was taken. Never throws. */
export function applyStoredSchoolCalendar(kv: KeyValue): boolean {
  try {
    return takeSchoolDaysOff(storedCalendar(kv));
  } catch {
    return false;
  }
}

/**
 * Asks the server for its list, unless it answered in the last
 * `CALENDAR_EVERY_MS`, keeps the answer and builds the days with it from
 * then on. True when the list kept changed. A server from before the route
 * (404) counts as an answer, so it is not asked on every refresh; no answer
 * at all keeps what the phone had, and the next refresh asks again.
 */
export async function refreshSchoolCalendar(kv: KeyValue, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<boolean> {
  const asked = Date.parse(kv.getString(CALENDAR_KEYS.askedAt) ?? '');
  if (Number.isFinite(asked) && asked <= now.getTime() && now.getTime() - asked < CALENDAR_EVERY_MS) return false;
  try {
    const res = await fetchImpl(`${API_BASE_URL}/v2/calendar`, { method: 'GET' });
    kv.set(CALENDAR_KEYS.askedAt, now.toISOString());
    if (!res.ok) return false;
    const served = JSON.stringify(await res.json());
    if (served === kv.getString(CALENDAR_KEYS.served)) return false;
    kv.set(CALENDAR_KEYS.served, served);
    applyStoredSchoolCalendar(kv);
    return true;
  } catch {
    return false;
  }
}
