/**
 * Google Calendar adapter (design-doc §6.2).
 * Incremental sync via `syncToken`; on HTTP 410 the token is dropped and the
 * next poll is a full resync of the configured window.
 */
import type { Source } from '../../index';
import { DateTime } from 'luxon';
import type { Adapter, AdapterContext, NormalizedEntity, PollResult } from '../entities';
import { withQuery } from '../http';
import type { GoogleRequester } from './requester';

const CAL_API = 'https://www.googleapis.com/calendar/v3';

export interface CursorStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface GoogleCalendarEventResource {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface EventsListResponse {
  items?: GoogleCalendarEventResource[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface CalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
  backgroundColor?: string;
}

/** One calendar as the settings screen lists it. */
export interface NormalizedCalendar {
  id: string;
  summary: string;
  primary: boolean;
  color: string | null;
}

export function normalizeCalendar(cal: CalendarListEntry): NormalizedCalendar {
  return { id: cal.id, summary: cal.summary ?? cal.id, primary: cal.primary === true, color: cal.backgroundColor ?? null };
}

export class GoogleCalendarAdapter implements Adapter {
  readonly source: Source = 'google_calendar';

  constructor(
    private readonly tokens: GoogleRequester,
    private readonly cursors: CursorStore,
    private readonly opts: { zone: string; windowDaysBack: number; windowDaysAhead: number },
  ) {}

  private cursorKey(calendarId: string): string {
    return `gcal:syncToken:${calendarId}`;
  }

  async listCalendars(): Promise<CalendarListEntry[]> {
    const res = await this.tokens.request<{ items?: CalendarListEntry[] }>(`${CAL_API}/users/me/calendarList?maxResults=250`);
    return res.items ?? [];
  }

  async poll(ctx: AdapterContext): Promise<PollResult> {
    const calendars = await this.listCalendars();
    const entities: NormalizedEntity[] = [];
    const fullyResynced: string[] = [];

    for (const cal of calendars) {
      // The calendar list is an entity of its own: it is what lets the settings
      // screen offer per-calendar switches, and the timeline name its events.
      entities.push({ source: this.source, kind: 'calendar', naturalKey: cal.id, payload: normalizeCalendar(cal) });
      const { items, full } = await this.listEvents(cal.id, ctx);
      if (full) fullyResynced.push(cal.id);
      for (const item of items) {
        entities.push({
          source: this.source,
          kind: 'calendar_event',
          naturalKey: `${cal.id}|${item.id}`,
          partition: cal.id,
          payload: normalizeEvent(cal, item, this.opts.zone),
        });
      }
    }

    // Only a full resync enumerates a calendar exhaustively; an incremental page
    // carries cancellations explicitly, so pruning is never needed for it.
    return {
      entities,
      completeScopes: [
        ...fullyResynced.map((id) => ({ kind: 'calendar_event' as const, partition: id })),
        // calendarList is always enumerated in full, so a removed calendar prunes.
        { kind: 'calendar' as const },
      ],
    };
  }

  private async listEvents(calendarId: string, ctx: AdapterContext): Promise<{ items: GoogleCalendarEventResource[]; full: boolean }> {
    const key = this.cursorKey(calendarId);
    const syncToken = await this.cursors.get(key);
    try {
      return await this.pageThrough(calendarId, syncToken, ctx);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 410 && syncToken) {
        ctx.logger.warn({ calendarId }, 'calendar syncToken expired (410) — full resync');
        await this.cursors.delete(key);
        return this.pageThrough(calendarId, null, ctx);
      }
      throw err;
    }
  }

  private async pageThrough(
    calendarId: string,
    syncToken: string | null,
    ctx: AdapterContext,
  ): Promise<{ items: GoogleCalendarEventResource[]; full: boolean }> {
    const items: GoogleCalendarEventResource[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    const now = DateTime.fromJSDate(ctx.now).setZone(this.opts.zone);

    do {
      const url = withQuery(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        maxResults: 250,
        singleEvents: true,
        showDeleted: true,
        ...(syncToken
          ? { syncToken }
          : {
              timeMin: now.minus({ days: this.opts.windowDaysBack }).startOf('day').toISO()!,
              timeMax: now.plus({ days: this.opts.windowDaysAhead }).endOf('day').toISO()!,
              orderBy: 'startTime',
            }),
        pageToken,
      });

      const res = await this.tokens.request<EventsListResponse>(url);
      items.push(...(res.items ?? []));
      pageToken = res.nextPageToken;
      nextSyncToken = res.nextSyncToken;
    } while (pageToken);

    if (nextSyncToken) await this.cursors.set(this.cursorKey(calendarId), nextSyncToken);
    return { items, full: !syncToken };
  }
}

export interface NormalizedCalendarEvent {
  googleId: string;
  calendarId: string;
  calendarSummary: string | null;
  summary: string;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  cancelled: boolean;
}

export function normalizeEvent(
  cal: CalendarListEntry,
  item: GoogleCalendarEventResource,
  zone: string,
): NormalizedCalendarEvent {
  const allDay = Boolean(item.start?.date);
  const start = allDay
    ? DateTime.fromISO(item.start!.date!, { zone }).startOf('day')
    : DateTime.fromISO(item.start?.dateTime ?? '', { zone });
  // Google's all-day `end.date` is exclusive; make it the inclusive end of the last day.
  const end = allDay
    ? DateTime.fromISO(item.end?.date ?? item.start!.date!, { zone }).startOf('day')
    : DateTime.fromISO(item.end?.dateTime ?? item.start?.dateTime ?? '', { zone });

  return {
    googleId: item.id,
    calendarId: cal.id,
    calendarSummary: cal.summary ?? null,
    summary: item.summary ?? '(ללא כותרת)',
    location: item.location ?? null,
    start: start.isValid ? start.toISO()! : '',
    end: end.isValid ? end.toISO()! : '',
    allDay,
    cancelled: item.status === 'cancelled',
  };
}
