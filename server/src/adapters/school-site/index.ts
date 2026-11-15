/**
 * School-site adapter — the grade's exam schedule (design-doc §6.4).
 *
 * School websites publish a grade's exam schedule ("לוח מבחנים שכבה י״ב") as
 * an embedded public Google calendar. Its ICS feed is fetched here without
 * credentials and every event inside the current school year becomes an
 * `exam` entity. The whole grade shares one calendar, so which of these exams
 * are actually a student's is decided on the phone by `exams.hiddenKeys`
 * (design-doc §7), never here.
 */
import { DateTime } from 'luxon';
import type { Source } from '@sederyom/shared';
import { examCalendarIcsUrl, examStartWindow, examsFromCalendar } from '@sederyom/shared/logic/exam-board/calendar';
import type { Adapter, AdapterContext, PollResult } from '../types.js';
import { toDateStr } from '../../lib/time.js';
import { parseIcs } from './ics.js';

// The calendar's rules moved to `shared` (the phone reads a public calendar with them too);
// they stay importable from here.
export {
  examCalendarIcsUrl, examNaturalKey, examsFromCalendar, examTitle, schoolYearOf, type SiteExamPayload,
} from '@sederyom/shared/logic/exam-board/calendar';

export interface SchoolSiteFetcher {
  (url: string): Promise<string>;
}

export interface SchoolSiteAdapterOptions {
  /** Google calendar id, as in the site's `calendar/embed?src=` iframe. */
  calendarId: string;
  zone: string;
  /** Overridable for tests. */
  fetcher?: SchoolSiteFetcher;
}

export function createSchoolSiteFetcher(): SchoolSiteFetcher {
  return async (url) => {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { accept: 'text/calendar', 'user-agent': 'SederYom/1.0 (personal aggregator)' },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`exam calendar returned HTTP ${res.status}`);
    if (!/BEGIN:VCALENDAR/i.test(body)) throw new Error('exam calendar did not answer with an iCalendar feed');
    return body;
  };
}

export class SchoolSiteAdapter implements Adapter {
  readonly source: Source = 'school_site';
  private readonly fetcher: SchoolSiteFetcher;

  constructor(private readonly opts: SchoolSiteAdapterOptions) {
    this.fetcher = opts.fetcher ?? createSchoolSiteFetcher();
  }

  async poll(ctx: AdapterContext): Promise<PollResult> {
    const ics = await this.fetcher(examCalendarIcsUrl(this.opts.calendarId));
    const today = toDateStr(DateTime.fromJSDate(ctx.now).setZone(this.opts.zone));
    // Only the events that may be of this school year are parsed; a calendar of more exams than a board holds throws
    // (`CalendarTooBigError`), and the hourly read notes it as a failed read.
    const calendar = parseIcs(ics, { zone: this.opts.zone, startsBetween: examStartWindow(today) });

    const entities = examsFromCalendar(calendar.events, today, this.opts.zone, (msg) =>
      ctx.logger.warn({ source: 'school_site', msg }, 'exam calendar warning'),
    );

    // The calendar's own idea of when it last changed — the latest edit of any
    // event — is the source's freshness.
    let freshness: Date | null = null;
    for (const ev of calendar.events) {
      if (ev.lastModified && (!freshness || ev.lastModified > freshness)) freshness = ev.lastModified;
    }

    // The feed is the whole calendar every time, so `exam` is a complete scope
    // and an exam removed from the site is pruned here.
    return { entities, completeScopes: [{ kind: 'exam' }], sourceFreshness: freshness };
  }
}
