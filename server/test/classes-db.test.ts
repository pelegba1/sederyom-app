/**
 * Plan Phase 2 end to end, on Postgres: devices register and pick a class,
 * the class's site is polled once for all of them, and a cancellation reaches
 * the devices whose student has that lesson — once — and no one else.
 * Runs with `RUN_DB_TESTS=1` against the dev database (never production: it empties the device tables).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassFeed, RegisterDeviceResponse } from '@sederyom/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildServices } from '../src/services.js';
import type { ShahafTab } from '../src/adapters/shahaf/index.js';
import { pollDueClasses } from '../src/sync/classes.js';
import { dispatchClassChanges } from '../src/notify/fanout.js';
import { RecordingPusher } from '../src/notify/push.js';

const enabled = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_TESTS === '1';
const suite = enabled ? describe : describe.skip;

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'shahaf');
const ZONE = 'Asia/Jerusalem';
// 19:30 on Tuesday 1.9.2026, inside the fixture week; the cancellation is on Wednesday, "tomorrow".
const NOW = new Date('2026-09-01T19:30:00+03:00');
const LATER = new Date('2026-09-01T19:50:00+03:00');
const LATER_STILL = new Date('2026-09-01T20:10:00+03:00');

function weekHtml(rows: string): string {
  const days = ['ראשון 30.08', 'שני 31.08', 'שלישי 01.09', 'רביעי 02.09', 'חמישי 03.09', 'שישי 04.09'];
  return `<html><body><div class="tt-module"><table class="TTTable" dir="rtl"><tr><td class="CName"></td>${days
    .map((d, i) => `<td class="CTitle" data-day="${i}">יום ${d}</td>`)
    .join('')}</tr>${rows}</table><div class="UpdateDate">מעודכן ל: 01.09.2026, שעה: 18:40</div></div></body></html>`;
}
function row(hour: number, cells: Record<number, string>): string {
  const tds = Array.from({ length: 6 }, (_v, day) => `<td class="TTCell" data-day="${day}">${cells[day] ?? ''}</td>`).join('');
  return `<tr><td class="CName"><b>${hour}</b></td>${tds}</tr>`;
}
const ENGLISH = '<div class="TTLesson">אנגלית<br/>שרון<br/>חדר 108</div>';
const PHYSICS = '<div class="TTLesson">פיזיקה<br/>לוי<br/>מעבדה 2</div>';
const CANCELLED = '<div class="TTChange TableFreeChange">השיעור מבוטל</div>';
const BASE = weekHtml(row(1, { 2: ENGLISH, 3: ENGLISH }) + row(3, { 2: PHYSICS, 3: PHYSICS }));
const CHANGED = weekHtml(row(1, { 2: ENGLISH, 3: ENGLISH }) + row(3, { 2: PHYSICS, 3: `${PHYSICS}${CANCELLED}` }));

suite('classes and devices (Postgres)', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let pusher: RecordingPusher;
  let services: ReturnType<typeof buildServices>;
  let week = BASE;
  const fetchedSites: string[] = [];
  const logger = { info: () => {}, warn: () => {}, error: () => {} };

  const fetcher = (siteUrl: string) => async ({ tab, cls }: { tab?: ShahafTab; cls?: string; week?: number }): Promise<string> => {
    fetchedSites.push(siteUrl);
    if (!tab) return readFileSync(join(FIXTURES, 'root-classlist.html'), 'utf8');
    // Only class 36's week changes; every other class keeps the first one.
    if (tab === 'changestable') return cls === '36' ? week : BASE;
    return readFileSync(join(FIXTURES, `${tab}-cls36.html`), 'utf8');
  };

  const poll = (now: Date) => pollDueClasses({ prisma, logger, shahafFor: (u) => services.shahafFor(u) }, { now, everyMinutes: 15, limit: 8 });
  const dispatch = (now: Date) => dispatchClassChanges({ prisma, pusher, logger, zone: ZONE }, now);

  async function device(classId: string, pushToken: string, hiddenSubjects: string[] = []): Promise<string> {
    const reg = (await app.inject({ method: 'POST', url: '/v2/devices', payload: { platform: 'android' } })).json() as RegisterDeviceResponse;
    const res = await app.inject({
      method: 'PUT', url: '/v2/device', headers: { authorization: `Bearer ${reg.token}` },
      payload: { class: { siteUrl: 'https://dugma.shahaf.site/', classId }, pushToken, prefs: { hiddenSubjects } },
    });
    expect(res.statusCode).toBe(200);
    return reg.token;
  }

  beforeAll(async () => {
    // The feed reads the wall clock for its horizon; pin it inside the fixture week. Only Date.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const env = loadEnv({ CRON_SECRET: 'test-cron-secret-0123456789abcdef', ...process.env, SCHEDULER_ENABLED: 'false', SHAHAF_WEEKS_AHEAD: '0' });
    prisma = new PrismaClient();
    pusher = new RecordingPusher();
    services = buildServices(env, prisma, logger, pusher, { shahafFetcherFor: fetcher });
    app = buildApp({ services });
    await app.ready();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    week = BASE;
    pusher.sent.length = 0;
    fetchedSites.length = 0;
    await prisma.$transaction([
      prisma.deviceNotification.deleteMany(),
      prisma.classChangeEvent.deleteMany(),
      prisma.classSnapshot.deleteMany(),
      prisma.device.deleteMany(),
      prisma.schoolClass.deleteMany(),
      prisma.school.deleteMany(),
    ]);
  });

  it('polls a class once for all its devices, and pushes a cancellation only to whoever has the lesson', async () => {
    const all = await device('36', 'ExponentPushToken[all]');
    await device('36', 'ExponentPushToken[nophysics]', ['פיזיקה']);
    // Another class of the same school, with nothing new.
    await device('5', 'ExponentPushToken[other]');
    expect(await prisma.school.count()).toBe(1);
    expect(await prisma.schoolClass.count()).toBe(2);

    // First read: the timetable being published is not news.
    fetchedSites.length = 0;
    expect((await poll(NOW)).polled).toBe(2);
    await dispatch(NOW);
    expect(pusher.sent).toEqual([]);
    // Two classes, one site, each page read once per class: 1 week + 4 lists.
    expect(fetchedSites).toHaveLength(10);

    // Not due again 20 minutes later? It is: the cadence is 15.
    week = CHANGED;
    const second = await poll(LATER);
    expect(second.polled).toBe(2);
    expect(second.events).toBeGreaterThan(0);
    const out = await dispatch(LATER);
    expect(out.sent).toBe(1);
    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]!.tokens).toEqual(['ExponentPushToken[all]']);
    expect(pusher.sent[0]!.push.title).toContain('מחר');

    // Considered again, and polled again unchanged: still once.
    await dispatch(LATER);
    expect((await poll(LATER_STILL)).events).toBe(0);
    await dispatch(LATER_STILL);
    expect(pusher.sent).toHaveLength(1);
    expect(await prisma.classChangeEvent.count({ where: { notifiedAt: null } })).toBe(0);

    // The feed carries the cancellation for the phone to merge.
    const feed = (await app.inject({ method: 'GET', url: '/v2/class/feed', headers: { authorization: `Bearer ${all}` } })).json() as ClassFeed;
    expect(feed.lastOkAt).not.toBeNull();
    expect(feed.lessons.find((l) => l.date === '2026-09-02' && l.hourIndex === 3)?.status).toBe('cancelled');
  });

  it('holds a push through quiet hours instead of dropping it', async () => {
    await device('36', 'ExponentPushToken[quiet]');
    const token = (await prisma.device.findFirstOrThrow()).tokenHash;
    await prisma.device.updateMany({ where: { tokenHash: token }, data: { prefs: { quietHours: { enabled: true, from: '19:00', to: '20:00' } } } });
    await poll(NOW);
    week = CHANGED;
    await poll(LATER);
    expect((await dispatch(LATER)).deferred).toBe(1);
    expect(pusher.sent).toHaveLength(0);
    expect(await prisma.classChangeEvent.count({ where: { notifiedAt: null } })).toBeGreaterThan(0);
    await dispatch(LATER_STILL);
    expect(pusher.sent).toHaveLength(1);
  });

  it('stops polling a class nobody follows', async () => {
    const token = await device('36', 'ExponentPushToken[leaving]');
    await app.inject({ method: 'DELETE', url: '/v2/device', headers: { authorization: `Bearer ${token}` } });
    expect((await poll(NOW)).polled).toBe(0);
  });
});
