/**
 * Shahaf adapter — a school's `<school>.shahaf.site` (design-doc §6.1).
 *
 * Read-only HTML scrape. The class views were publicly reachable during Spike 2
 * (2026-08-28, no cookie required). If that changes during the school year the
 * fetcher below is the single place that needs the WebView-captured cookie —
 * see `ShahafAdapter` options.
 */
import type { ClassOption, DateStr, Source } from '@sederyom/shared';
import type { Adapter, AdapterContext, NormalizedEntity, PollResult, Scope } from '../types.js';
import { AuthError } from '../types.js';
import {
  parseChanges, parseClassOptions, parseDatedList, parseFreshness, parseMessages, parseTimetable,
  type ParsedLesson,
} from './parser.js';
import { toDateStr, weekStart } from '../../lib/time.js';
import { DateTime } from 'luxon';

export type ShahafTab = 'changestable' | 'timetable' | 'changes' | 'exams' | 'events' | 'messages';

export interface ShahafFetcher {
  (params: { tab?: ShahafTab; cls?: string; week?: number }): Promise<string>;
}

export interface ShahafAdapterOptions {
  baseUrl: string;
  zone: string;
  weeksAhead: number;
  /** Overridable for tests and for the fixture suite. */
  fetcher?: ShahafFetcher;
  /** Set only if the site starts requiring login (design-doc §6.1 open risk). */
  cookieHeader?: string | null;
}

export function createShahafFetcher(opts: ShahafAdapterOptions): ShahafFetcher {
  return async ({ tab, cls, week }) => {
    const url = new URL('/', opts.baseUrl);
    if (cls) url.searchParams.set('cls', cls);
    if (tab) url.searchParams.set('tab', tab);
    if (week !== undefined && week !== 0) url.searchParams.set('week', String(week));
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'accept': 'text/html',
        'accept-language': 'he-IL,he;q=0.9',
        'user-agent': 'SederYom/1.0 (personal aggregator)',
        ...(opts.cookieHeader ? { cookie: opts.cookieHeader } : {}),
      },
    });
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`shahaf returned ${res.status} — the site now requires login`);
    }
    if (!res.ok) throw new Error(`shahaf ${tab ?? 'root'} returned HTTP ${res.status}`);
    // A redirect into the sign-in page is the other way "needs login" shows up.
    if (/\/Account\/SignIn/i.test(res.url) || (!body.includes('tt-module') && /SignIn/i.test(body) && body.length < 8000)) {
      throw new AuthError('shahaf redirected to sign-in — session capture required');
    }
    return body;
  };
}

/** `date|hour|subject|teacher` — see the note where it is used. */
export function lessonNaturalKey(lesson: Pick<ParsedLesson, 'date' | 'hourIndex' | 'subject' | 'teacher'>): string {
  return `${lesson.date}|${lesson.hourIndex}|${lesson.subject}|${lesson.teacher ?? ''}`;
}

export class ShahafAdapter implements Adapter {
  readonly source: Source = 'shahaf';
  private readonly fetcher: ShahafFetcher;

  constructor(private readonly opts: ShahafAdapterOptions) {
    this.fetcher = opts.fetcher ?? createShahafFetcher(opts);
  }

  /** Class list for the onboarding picker; read by option *value*, never position. */
  async fetchClasses(): Promise<ClassOption[]> {
    return parseClassOptions(await this.fetcher({}));
  }

  /**
   * One class's lessons this week (with its changes), for "איפה המורה?"
   * (`teachers/day.ts`): read on their own, never through `poll`, so nothing
   * here becomes a snapshot or an event. Throws on a page without the grid, as
   * `poll` does: an unread class would say its teachers are free.
   */
  async fetchClassWeek(classId: string, now: Date): Promise<ParsedLesson[]> {
    const zone = this.opts.zone;
    const anchor = weekStart(toDateStr(DateTime.fromJSDate(now).setZone(zone)), 0, zone);
    const html = await this.fetcher({ tab: 'changestable', cls: classId, week: 0 });
    let parsed = parseTimetable(html, anchor, { zone });
    if (parsed.days.length === 0) throw new Error(`shahaf class ${classId}: no timetable on the page`);
    if (parsed.unresolvedArrows > 0) {
      const lessons = await this.regularWeek(classId, anchor).read();
      if (lessons.length > 0) parsed = parseTimetable(html, anchor, { zone, regular: lessons });
    }
    return parsed.lessons;
  }

  /**
   * A week that has passed, `weeksBack` weeks before the current one (0: this
   * week), for the class history's fill (`history/backfill.ts`). Checked live
   * on 2026-11-10: the site answers back to the year's first week, with the
   * regular grid and almost none of the changes the week had. Read on its own,
   * like `fetchClassWeek`: nothing here becomes a snapshot or an event. `days`
   * is empty when the page has no grid; the caller decides what that means.
   */
  async fetchPastWeek(classId: string, weeksBack: number, now: Date): Promise<{ days: DateStr[]; lessons: ParsedLesson[] }> {
    const zone = this.opts.zone;
    const anchor = weekStart(toDateStr(DateTime.fromJSDate(now).setZone(zone)), -weeksBack, zone);
    const html = await this.fetcher({ tab: 'changestable', cls: classId, week: weeksBack === 0 ? 0 : -weeksBack });
    const parsed = parseTimetable(html, anchor, { zone });
    return { days: parsed.days, lessons: parsed.lessons };
  }

  /**
   * The class's regular week (`tab=timetable`), read at most once and only
   * when a change needs it (`ParsedTimetable.unresolvedArrows`). A failed read
   * is no lessons: the change is then named after its teacher, as before the
   * grid was read at all, and the poll goes on.
   */
  private regularWeek(classId: string, today: DateStr): { read(): Promise<ParsedLesson[]> } {
    let pending: Promise<ParsedLesson[]> | null = null;
    return {
      read: () =>
        (pending ??= this.fetcher({ tab: 'timetable', cls: classId })
          .then((html) => parseTimetable(html, weekStart(today, 0, this.opts.zone), { zone: this.opts.zone }).lessons)
          .catch(() => [])),
    };
  }

  async poll(ctx: AdapterContext): Promise<PollResult> {
    const entities: NormalizedEntity[] = [];
    const completeScopes: Scope[] = [];
    const zone = this.opts.zone;
    const today = toDateStr(DateTime.fromJSDate(ctx.now).setZone(zone));
    const year = DateTime.fromJSDate(ctx.now).setZone(zone).year;
    let freshness: Date | null = null;

    const regular = this.regularWeek(ctx.classId, today);
    /** Days a page of this poll has already shown, so a week read twice is claimed once. */
    const claimed = new Set<DateStr>();
    for (let week = 0; week <= this.opts.weeksAhead; week += 1) {
      const anchor = weekStart(today, week, zone);
      const html = await this.fetcher({ tab: 'changestable', cls: ctx.classId, week });
      const onWarn = (msg: string) => ctx.logger.warn({ source: 'shahaf', week, msg }, 'timetable parse warning');
      let parsed = parseTimetable(html, anchor, { zone, onWarn });
      if (parsed.unresolvedArrows > 0) {
        const lessons = await regular.read();
        if (lessons.length > 0) parsed = parseTimetable(html, anchor, { zone, onWarn, regular: lessons });
      }
      freshness ??= parsed.freshness;
      // A page without the grid is not an empty week: the site is down, changed its markup, or
      // answered with something else. Claiming its days would prune every lesson and tell every
      // student of the class that their lessons were dropped. Even the empty summer weeks have it.
      if (parsed.days.length === 0) throw new Error(`shahaf week ${week}: no timetable on the page`);

      // Scope per day so an emptied day prunes correctly without touching other weeks. The days
      // are the ones the page's header carries, not this Sunday's week counted on: right after
      // the school day on Friday the site moves on, `week=0` shows the coming week, and counting
      // claimed the week that had just ended as empty (every Friday at about 14:00, a "deleted"
      // for each of its lessons and a "created" for each of the week after's; test/shahaf-friday).
      const fresh = new Set(parsed.days.filter((date) => !claimed.has(date)));
      if (fresh.size === 0) continue;
      for (const date of fresh) {
        claimed.add(date);
        completeScopes.push({ kind: 'lesson', partition: date });
      }

      for (const lesson of parsed.lessons) {
        if (!fresh.has(lesson.date)) continue;
        entities.push({
          source: 'shahaf',
          kind: 'lesson',
          // The teacher is part of the identity: two groups of one subject share
          // a period, and without it the second would overwrite the first in
          // the snapshot. Existing rows were re-keyed by the migration
          // `20260905120000_lesson_key_teacher`, so the change emits no events.
          naturalKey: lessonNaturalKey(lesson),
          partition: lesson.date,
          payload: lesson,
        });
      }
    }

    const [changesHtml, examsHtml, eventsHtml, messagesHtml] = await Promise.all([
      this.fetcher({ tab: 'changes', cls: ctx.classId }),
      this.fetcher({ tab: 'exams', cls: ctx.classId }),
      this.fetcher({ tab: 'events', cls: ctx.classId }),
      this.fetcher({ tab: 'messages', cls: ctx.classId }),
    ]);
    freshness ??= parseFreshness(changesHtml, zone);

    for (const change of parseChanges(changesHtml, { zone, year })) {
      entities.push({ source: 'shahaf', kind: 'change', naturalKey: change.naturalKey, payload: change });
    }
    completeScopes.push({ kind: 'change' });

    for (const exam of parseDatedList(examsHtml, 'shahaf-exam', { zone, year })) {
      entities.push({
        source: 'shahaf',
        kind: 'exam',
        naturalKey: exam.naturalKey,
        payload: { date: exam.date, subject: exam.title, details: exam.details },
      });
    }
    completeScopes.push({ kind: 'exam' });

    for (const ev of parseDatedList(eventsHtml, 'shahaf-event', { zone, year })) {
      entities.push({
        source: 'shahaf',
        kind: 'school_event',
        naturalKey: ev.naturalKey,
        payload: { date: ev.date, title: ev.title, details: ev.details },
      });
    }
    completeScopes.push({ kind: 'school_event' });

    for (const msg of parseMessages(messagesHtml, { zone, year })) {
      entities.push({
        source: 'shahaf',
        kind: 'message',
        naturalKey: msg.naturalKey,
        payload: { date: msg.date, title: msg.title, body: msg.details ?? msg.title, from: null },
      });
    }
    completeScopes.push({ kind: 'message' });

    return { entities, completeScopes, sourceFreshness: freshness };
  }
}
