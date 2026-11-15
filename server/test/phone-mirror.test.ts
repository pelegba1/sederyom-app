/**
 * The "בית ספר" calendar kept by the phone (app/src/google/mirror.ts, plan
 * Phase 2e): the phone makes its own calendar, fills it, and keeps it hourly.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ClassFeed } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { mirrorState, runPhoneMirror } from '../../app/src/google/mirror';

const ZONE = 'Asia/Jerusalem';
// Wednesday 21.10.2026. The run takes its today from the clock, so the clock is set there too:
// the trip and the mock exam ahead of it, last month's exam behind.
const NOW = new Date('2026-10-21T08:00:00Z');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });
afterAll(() => {
  vi.useRealTimers();
});

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: NOW.toISOString(),
  freshness: null,
  lessons: [],
  changes: [],
  exams: [
    { naturalKey: 'site-exam|mock', date: '2026-11-01', subject: 'מתכונת באנגלית', details: null, source: 'school_site' },
    { naturalKey: 'site-exam|past', date: '2026-10-01', subject: 'עבר', details: null, source: 'school_site' },
  ],
  events: [{ naturalKey: 'shahaf-event|trip', date: '2026-10-30', title: 'טיול שנתי', details: null }],
  messages: [],
};

const src = (examsToCalendar = true) => ({
  feed: FEED, mashov: [], bagrut: [], google: [], settings: { ...DEFAULT_SETTINGS, examsToCalendar }, zone: ZONE, now: NOW,
});

/** An event the mirror made on an earlier run, as Google lists it back. */
interface Owned { id: string; key: string; date: string; summary: string }

function fakeGoogle(owned: readonly Owned[] = []) {
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  const requester: GoogleRequester = {
    async request<T>(url: string, init: RequestInit = {}): Promise<T> {
      const method = init.method ?? 'GET';
      calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (method === 'POST' && url.endsWith('/calendars')) return { id: 'phone-cal' } as T;
      if (method === 'GET' && url.endsWith('/calendars/phone-cal')) return { id: 'phone-cal' } as T;
      if (method === 'GET' && url.includes('/events?')) {
        return {
          items: owned.map((e) => ({
            id: e.id,
            summary: e.summary,
            start: { date: e.date },
            end: { date: e.date },
            extendedProperties: { private: { sederyomKey: e.key, sederyomOwner: 'sederyom' } },
          })),
        } as T;
      }
      return {} as T;
    },
  };
  /** The ids of the events the run deleted. */
  const deleted = () => calls.filter((c) => c.method === 'DELETE').map((c) => decodeURIComponent(c.url.split('/').pop()!));
  return { requester, calls, deleted };
}

/** A phone whose calendar is already made: the run goes straight to the events. */
function madeKv() {
  const kv = memoryKv();
  kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal' }));
  return kv;
}

describe("the phone's exam calendar", () => {
  it('makes and fills its own calendar on the first run, and keeps it hourly after', async () => {
    const kv = memoryKv();
    const g = fakeGoogle();
    const state = await runPhoneMirror({ kv, requester: g.requester, src: src(), now: NOW });

    expect(g.calls[0]).toMatchObject({ method: 'POST', url: 'https://www.googleapis.com/calendar/v3/calendars', body: { summary: 'בית ספר', timeZone: ZONE } });
    const posted = g.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/calendars/phone-cal/events'));
    // Today on: the mock exam and the trip, not last month's exam.
    expect(posted.map((c) => c.body!.summary).sort()).toEqual(['טיול שנתי', 'מבחן · מתכונת באנגלית']);
    expect(state).toMatchObject({ calendarId: 'phone-cal', lastError: null, lastRunAt: NOW.toISOString() });

    g.calls.length = 0;
    await runPhoneMirror({ kv, requester: g.requester, src: src(), now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(g.calls).toEqual([]);
    await runPhoneMirror({ kv, requester: g.requester, src: src(), now: new Date(NOW.getTime() + 61 * 60_000) });
    expect(g.calls[0]).toMatchObject({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/calendars/phone-cal' });
  });

  it('makes nothing while the exams are not wanted in Google, and the calendar once they are', async () => {
    const kv = memoryKv();
    const g = fakeGoogle();
    await runPhoneMirror({ kv, requester: g.requester, src: src(false), now: NOW });
    expect(g.calls).toEqual([]);
    expect(mirrorState(kv).calendarId).toBeNull();

    await runPhoneMirror({ kv, requester: g.requester, src: src(true), now: NOW });
    expect(g.calls[0]).toMatchObject({ method: 'POST', url: 'https://www.googleapis.com/calendar/v3/calendars' });
    expect(g.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/calendars/phone-cal/events'))).toHaveLength(2);
  });

  it('records what went wrong when Google refuses', async () => {
    const kv = memoryKv();
    const failing: GoogleRequester = { request: async () => { throw new Error('Google 403'); } };
    const state = await runPhoneMirror({ kv, requester: failing, src: src(), now: NOW });
    expect(state).toMatchObject({ calendarId: null, lastError: 'Google 403' });
    expect(mirrorState(kv).lastError).toBe('Google 403');
  });

  it('holds every child\'s exams on a parent\'s phone, each under its class, so a switch of child takes none out', async () => {
    const kv = memoryKv();
    const g = fakeGoogle();
    const shown = { ...src(), settings: { ...DEFAULT_SETTINGS, examsToCalendar: true, classId: '7', className: 'יב2' } };
    const other = {
      ...src(),
      feed: {
        ...FEED,
        class: { ...FEED.class, classId: '8', className: 'ח1' },
        exams: [{ naturalKey: 'site-exam|ח1-math', date: '2026-11-03', subject: 'מתמטיקה', details: null, source: 'school_site' as const }],
        events: [],
      },
      settings: { ...DEFAULT_SETTINGS, examsToCalendar: true, classId: '8', className: 'ח1' },
    };
    await runPhoneMirror({ kv, requester: g.requester, src: shown, others: [{ src: other, className: 'ח1' }], now: NOW });
    const posted = g.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/calendars/phone-cal/events'));
    expect(posted.map((c) => c.body!.summary).sort()).toEqual(['טיול שנתי', 'מבחן · מתכונת באנגלית (יב2)', 'מבחן · מתמטיקה (ח1)']);
  });

  it('keeps an exam it already put in the calendar once the exam is behind', async () => {
    const g = fakeGoogle([
      // Still in the feed, a few weeks back.
      { id: 'ev-past', key: 'site-exam|past', date: '2026-10-01', summary: 'מבחן · עבר' },
      // Gone from the feed, which carries a week back: an exam sat, not one the school took back.
      { id: 'ev-older', key: 'site-exam|older', date: '2026-09-15', summary: 'מבחן · היסטוריה' },
      { id: 'ev-bagrut', key: 'bagrut|35182', date: '2026-10-12', summary: 'מבחן · בגרות באנגלית' },
      // A school event gone by stays too.
      { id: 'ev-old-trip', key: 'shahaf-event|old-trip', date: '2026-10-10', summary: 'יום ספורט' },
    ]);
    await runPhoneMirror({ kv: madeKv(), requester: g.requester, src: src(), now: NOW });
    expect(g.deleted()).toEqual([]);
    // And nothing gone by is made again or changed.
    const touched = g.calls.filter((c) => c.method !== 'GET').map((c) => c.body?.summary);
    expect(touched.sort()).toEqual(['טיול שנתי', 'מבחן · מתכונת באנגלית']);
  });

  it('still takes out a past exam the student hid, kept out of Google, or added by hand and deleted', async () => {
    const g = fakeGoogle([
      { id: 'ev-hidden', key: 'site-exam|past', date: '2026-10-01', summary: 'מבחן · עבר' },
      { id: 'ev-skipped', key: 'site-exam|skipped', date: '2026-10-05', summary: 'מבחן · ספרות' },
      { id: 'ev-manual-gone', key: 'manual|gone', date: '2026-10-08', summary: 'מבחן · ביולוגיה' },
      { id: 'ev-manual-kept', key: 'manual|kept', date: '2026-10-09', summary: 'מבחן · כימיה' },
    ]);
    const s = {
      ...src(),
      settings: { ...DEFAULT_SETTINGS, examsToCalendar: true, exams: { ...DEFAULT_SETTINGS.exams, hiddenKeys: ['site-exam|past'] } },
      examPrefs: { renames: {}, calendarSkip: ['site-exam|skipped'], dates: {} },
      manualExams: [{ naturalKey: 'manual|kept', date: '2026-10-09', subject: 'כימיה', details: null, createdAt: '2026-10-01T08:00:00Z' }],
    };
    await runPhoneMirror({ kv: madeKv(), requester: g.requester, src: s, now: NOW });
    expect(g.deleted().sort()).toEqual(['ev-hidden', 'ev-manual-gone', 'ev-skipped']);
  });

  it('renames an exam ahead in place, its event the same one', async () => {
    const g = fakeGoogle([
      { id: 'ev-mock', key: 'site-exam|mock', date: '2026-11-01', summary: 'מבחן · מתכונת באנגלית' },
      { id: 'ev-trip', key: 'shahaf-event|trip', date: '2026-10-30', summary: 'טיול שנתי' },
    ]);
    const s = { ...src(), examPrefs: { renames: { 'site-exam|mock': 'מתכונת' }, calendarSkip: [], dates: {} } };
    await runPhoneMirror({ kv: madeKv(), requester: g.requester, src: s, now: NOW });
    const written = g.calls.filter((c) => c.method !== 'GET');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ method: 'PATCH', body: { summary: 'מבחן · מתכונת', start: { date: '2026-11-01' } } });
    expect(written[0]!.url).toMatch(/\/events\/ev-mock$/);
  });

  it('still takes out an exam from today on that the school took off its list', async () => {
    const g = fakeGoogle([
      { id: 'ev-today', key: 'site-exam|today-cancelled', date: '2026-10-21', summary: 'מבחן · גאוגרפיה' },
      { id: 'ev-ahead', key: 'site-exam|cancelled', date: '2026-11-05', summary: 'מבחן · פיזיקה' },
    ]);
    await runPhoneMirror({ kv: madeKv(), requester: g.requester, src: src(), now: NOW });
    expect(g.deleted().sort()).toEqual(['ev-ahead', 'ev-today']);
  });

  it('keeps a past exam of a parent\'s other child, and takes out one that child\'s settings hide', async () => {
    const g = fakeGoogle([
      { id: 'ev-sibling-past', key: 'site-exam|ח1-old', date: '2026-10-02', summary: 'מבחן · תנ"ך (ח1)' },
      { id: 'ev-sibling-hidden', key: 'site-exam|ח1-hidden', date: '2026-10-03', summary: 'מבחן · אנגלית (ח1)' },
    ]);
    const other = {
      ...src(),
      feed: { ...FEED, class: { ...FEED.class, classId: '8', className: 'ח1' }, exams: [], events: [] },
      settings: { ...DEFAULT_SETTINGS, examsToCalendar: true, classId: '8', className: 'ח1', exams: { ...DEFAULT_SETTINGS.exams, hiddenKeys: ['site-exam|ח1-hidden'] } },
    };
    await runPhoneMirror({ kv: madeKv(), requester: g.requester, src: src(), others: [{ src: other, className: 'ח1' }], now: NOW });
    expect(g.deleted()).toEqual(['ev-sibling-hidden']);
  });

  it('respects "the exams in Google" being off', async () => {
    const kv = memoryKv();
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal' }));
    const g = fakeGoogle();
    await runPhoneMirror({ kv, requester: g.requester, src: src(false), now: NOW });
    expect(g.calls).toEqual([]);
  });
});
