/**
 * The Ministry's vacations (ideas ל1): תשפ״ז's days off past Hanukkah, the
 * chag's own name on its days, and the server's copy of the list, which a
 * phone takes when it is newer than its own (app/src/local/schoolCalendar.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCHOOL_CALENDAR_REVISION, SCHOOL_DAYS_OFF, schoolDayInfo, takeSchoolDaysOff, validSchoolDaysOff,
} from '@sederyom/shared/logic/time';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildServices } from '../src/services.js';
import { RecordingPusher } from '../src/notify/push.js';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { CALENDAR_KEYS, applyStoredSchoolCalendar, refreshSchoolCalendar } = await import('../../app/src/local/schoolCalendar');

const ZONE = 'Asia/Jerusalem';
const off = (date: string) => schoolDayInfo(date, ZONE);

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

afterEach(() => {
  takeSchoolDaysOff(null);
});

describe('תשפ״ז', () => {
  it('has Purim, Pesach, Yom HaAtzmaut and Erev Shavuot off', () => {
    expect(off('2027-03-23')).toEqual({ isSchoolDay: false, holidayName: 'פורים' });
    expect(off('2027-03-24')).toEqual({ isSchoolDay: false, holidayName: 'שושן פורים' });
    expect(off('2027-03-25').isSchoolDay).toBe(true);
    for (const date of ['2027-04-13', '2027-04-18', '2027-04-21']) expect(off(date)).toEqual({ isSchoolDay: false, holidayName: 'חופשת פסח' });
    expect(off('2027-04-29').isSchoolDay).toBe(true);
    expect(off('2027-05-12')).toEqual({ isSchoolDay: false, holidayName: 'יום העצמאות' });
    expect(off('2027-05-13').isSchoolDay).toBe(true);
    expect(off('2027-06-10')).toEqual({ isSchoolDay: false, holidayName: 'ערב שבועות' });
    expect(off('2027-06-11').isSchoolDay).toBe(false);
    expect(off('2027-06-13').isSchoolDay).toBe(true);
  });

  it('names a chag inside a vacation by the chag', () => {
    const first = off('2027-04-22');
    expect(first.isSchoolDay).toBe(false);
    expect(first.holidayName).not.toBe('חופשת פסח');
    // hebcal's name, with its niqqud: "פֶּסַח א׳".
    expect(first.holidayName!.replace(/[֑-ׇ]/g, '')).toContain('פסח');
    expect(off('2027-04-25').holidayName).not.toBe('חופשת פסח');
  });

  it('keeps Lag BaOmer and Yom HaZikaron school days, and the summer from 21.6', () => {
    expect(off('2027-05-25').isSchoolDay).toBe(true);
    expect(off('2027-05-11').isSchoolDay).toBe(true);
    expect(off('2027-06-20').isSchoolDay).toBe(true);
    expect(off('2027-06-21')).toEqual({ isSchoolDay: false, holidayName: 'חופשת הקיץ' });
  });

  it('has the days around Yom Kippur and Sukkot off', () => {
    expect(off('2026-09-11').holidayName).toBe('ערב ראש השנה');
    expect(off('2026-09-20').holidayName).toBe('ערב יום כיפור');
    expect(off('2026-09-21').isSchoolDay).toBe(false);
    expect(off('2026-09-23').holidayName).toBe('חופשת סוכות');
    expect(off('2026-09-28').isSchoolDay).toBe(false);
    expect(off('2026-10-04').isSchoolDay).toBe(true);
  });

  it('is a list the phones would take', () => {
    expect(validSchoolDaysOff(SCHOOL_DAYS_OFF)).toBe(true);
  });
});

describe('the server\'s list', () => {
  const served = (revision: number, daysOff: unknown) => ({ revision, daysOff });

  it('is taken when it is at least as new as the built-in one', () => {
    expect(takeSchoolDaysOff(served(SCHOOL_CALENDAR_REVISION + 1, [{ from: '2027-01-05', to: '2027-01-05', name: 'שביתה' }]))).toBe(true);
    expect(off('2027-01-05')).toEqual({ isSchoolDay: false, holidayName: 'שביתה' });
    // The newer list is the whole list: a day it leaves out is a school day again.
    expect(off('2027-03-23').isSchoolDay).toBe(true);
  });

  it('is left for the built-in one when older or malformed', () => {
    expect(takeSchoolDaysOff(served(SCHOOL_CALENDAR_REVISION - 1, []))).toBe(false);
    expect(off('2027-03-23').isSchoolDay).toBe(false);
    expect(takeSchoolDaysOff(served(SCHOOL_CALENDAR_REVISION + 1, [{ from: '5.1.2027', to: '2027-01-05', name: 'x' }]))).toBe(false);
    expect(takeSchoolDaysOff(served(SCHOOL_CALENDAR_REVISION + 1, [{ from: '2027-01-06', to: '2027-01-05', name: 'x' }]))).toBe(false);
    expect(takeSchoolDaysOff(served(SCHOOL_CALENDAR_REVISION + 1, 'all of them'))).toBe(false);
    expect(off('2027-03-23').isSchoolDay).toBe(false);
  });

  it('is served without a device token', async () => {
    const env = loadEnv({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db', CRON_SECRET: 'test-cron-secret-0123456789abcdef',
      SCHEDULER_ENABLED: 'false', LOG_LEVEL: 'silent',
    } as unknown as NodeJS.ProcessEnv);
    // No table is read: the list is the build's own.
    const silent = { info: () => {}, warn: () => {}, error: () => {} };
    const app = buildApp({ services: buildServices(env, {} as never, silent, new RecordingPusher()) });
    const res = await app.inject({ method: 'GET', url: '/v2/calendar' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revision: SCHOOL_CALENDAR_REVISION, daysOff: SCHOOL_DAYS_OFF });
    await app.close();
  });
});

describe('on the phone', () => {
  const NOW = new Date('2026-10-28T10:00:00Z');
  const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('keeps the server\'s answer and builds the days with it', async () => {
    const kv = memoryKv();
    const fetchImpl = answer({ revision: SCHOOL_CALENDAR_REVISION + 1, daysOff: [{ from: '2027-01-05', to: '2027-01-05', name: 'שביתה' }] });
    expect(await refreshSchoolCalendar(kv, fetchImpl, NOW)).toBe(true);
    expect(off('2027-01-05').holidayName).toBe('שביתה');
    // A phone started again takes it from the storage, before any day is built.
    takeSchoolDaysOff(null);
    expect(applyStoredSchoolCalendar(kv)).toBe(true);
    expect(off('2027-01-05').holidayName).toBe('שביתה');
  });

  it('asks at most once a day, and again the day after', async () => {
    const kv = memoryKv();
    const fetchImpl = answer({ revision: SCHOOL_CALENDAR_REVISION, daysOff: SCHOOL_DAYS_OFF });
    await refreshSchoolCalendar(kv, fetchImpl, NOW);
    await refreshSchoolCalendar(kv, fetchImpl, new Date(NOW.getTime() + 60 * 60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await refreshSchoolCalendar(kv, fetchImpl, new Date(NOW.getTime() + 21 * 60 * 60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps its list when the server has none, and asks again only the next day', async () => {
    const kv = memoryKv();
    const fetchImpl = answer({ error: 'not_found' }, 404);
    expect(await refreshSchoolCalendar(kv, fetchImpl, NOW)).toBe(false);
    expect(kv.getString(CALENDAR_KEYS.served)).toBeUndefined();
    expect(off('2027-03-23').holidayName).toBe('פורים');
    await refreshSchoolCalendar(kv, fetchImpl, new Date(NOW.getTime() + 60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks again at the next refresh when there was no answer', async () => {
    const kv = memoryKv();
    const down = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await refreshSchoolCalendar(kv, down, NOW)).toBe(false);
    expect(kv.getString(CALENDAR_KEYS.askedAt)).toBeUndefined();
  });
});
