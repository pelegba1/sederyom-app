/**
 * Exams and school events → a dedicated Google calendar, "בית ספר"
 * (design-doc §5.2). Shared (plan Phase 2e): the phone mirrors with its own
 * sign-in, whose `calendar.app.created` scope reaches only calendars the
 * phone made.
 *
 * Idempotent: every event the mirror owns carries
 * `extendedProperties.private.sederyomKey` with the item's natural key, so a
 * second run creates nothing new. Deleting the calendar in Google is a
 * supported user action: it is made again on the next run.
 */
import type { Exam, SchoolEvent, UserSettings } from '../../index';
import { filterExams } from '../filters';
import { withQuery } from '../http';
import { addDays } from '../time';
import type { GoogleCalendarEventResource } from './calendar';
import type { GoogleRequester } from './requester';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
export const SCHOOL_CALENDAR_NAME = 'בית ספר';
const OWNER_TAG = 'sederyom';

export interface MirrorItem {
  summary: string;
  description: string | null;
  date: string;
}

/**
 * What belongs in the calendar: the owner's exams (design-doc §7: the grade's
 * schedule lists every block exam, and a hidden one leaves the calendar too)
 * and the school's events, from today on, by natural key.
 */
export function mirrorItems(exams: readonly Exam[], schoolEvents: readonly SchoolEvent[], settings: UserSettings, today: string): Map<string, MirrorItem> {
  const wanted = new Map<string, MirrorItem>();
  for (const e of filterExams(exams.filter((x) => x.date >= today), settings)) {
    wanted.set(e.naturalKey, { summary: `מבחן · ${e.subject}`, description: e.details, date: e.date });
  }
  for (const e of schoolEvents.filter((x) => x.date >= today)) {
    wanted.set(e.naturalKey, { summary: e.title, description: e.details, date: e.date });
  }
  return wanted;
}

/**
 * The calendar's id: `known` while Google still has it, else a new "בית ספר".
 * `created` says which, so the caller can keep the new id.
 */
export async function ensureMirrorCalendar(
  requester: GoogleRequester,
  known: string | null,
  zone: string,
): Promise<{ id: string; created: boolean }> {
  if (known) {
    try {
      await requester.request<{ id: string }>(`${CAL_API}/calendars/${encodeURIComponent(known)}`);
      return { id: known, created: false };
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status !== 404 && status !== 410) throw err;
    }
  }
  const made = await requester.request<{ id: string }>(`${CAL_API}/calendars`, {
    method: 'POST',
    body: JSON.stringify({ summary: SCHOOL_CALENDAR_NAME, timeZone: zone }),
  });
  return { id: made.id, created: true };
}

export interface MirrorResult {
  created: number;
  updated: number;
  removed: number;
}

/**
 * The days gone by stay in the calendar: an event dated before `before` that
 * `wanted` no longer has is removed only when `gone(key)` says its item is
 * really gone. `wanted` runs from today on, and what the sources carry of
 * the past runs short of the calendar's (the class feed a week back).
 */
export interface MirrorPast {
  before: string;
  gone: (key: string) => boolean;
}

/**
 * Makes the calendar hold `wanted`: creates, moves and removes the events the
 * mirror owns. With `past`, the events gone by stay unless `past.gone` says
 * otherwise; without it, the calendar holds exactly `wanted`.
 */
export async function mirrorToCalendar(
  requester: GoogleRequester,
  calendarId: string,
  wanted: ReadonlyMap<string, MirrorItem>,
  zone: string,
  past?: MirrorPast,
): Promise<MirrorResult> {
  const events = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const existing = await listOwnedEvents(requester, events);
  const result: MirrorResult = { created: 0, updated: 0, removed: 0 };

  for (const [key, item] of wanted) {
    const body = {
      summary: item.summary,
      description: item.description ?? undefined,
      // All-day: Google's `end.date` is exclusive.
      start: { date: item.date },
      end: { date: addDays(item.date, 1, zone) },
      extendedProperties: { private: { sederyomKey: key, sederyomOwner: OWNER_TAG } },
      transparency: 'transparent',
    };
    const found = existing.get(key);
    if (!found) {
      await requester.request(events, { method: 'POST', body: JSON.stringify(body) });
      result.created += 1;
    } else if (found.summary !== body.summary || found.start?.date !== body.start.date) {
      await requester.request(`${events}/${encodeURIComponent(found.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      result.updated += 1;
    }
  }

  for (const [key, event] of existing) {
    if (wanted.has(key)) continue;
    // An all-day event, as the mirror makes them; one without a date goes as before.
    const date = event.start?.date ?? event.start?.dateTime?.slice(0, 10);
    if (past && date && date < past.before && !past.gone(key)) continue;
    await requester.request(`${events}/${encodeURIComponent(event.id)}`, { method: 'DELETE' });
    result.removed += 1;
  }
  return result;
}

async function listOwnedEvents(requester: GoogleRequester, events: string): Promise<Map<string, GoogleCalendarEventResource>> {
  const out = new Map<string, GoogleCalendarEventResource>();
  let pageToken: string | undefined;
  do {
    const res = await requester.request<{ items?: GoogleCalendarEventResource[]; nextPageToken?: string }>(
      withQuery(events, { privateExtendedProperty: `sederyomOwner=${OWNER_TAG}`, maxResults: 250, showDeleted: false, pageToken }),
    );
    for (const item of res.items ?? []) {
      const key = item.extendedProperties?.private?.sederyomKey;
      if (key) out.set(key, item);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}
