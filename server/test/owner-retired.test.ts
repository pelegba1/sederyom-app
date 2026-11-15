/**
 * The single-owner mode is gone from the server (2f switchover, B1). The
 * routes that held one person's school data, and the static token that opened
 * them, are not there any more: every such path answers 404, whatever it
 * carries. Outside `/v2` (devices.test.ts) what is left is `/health` and
 * `/cron/tick`, which runs only with its own secret.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildServices } from '../src/services.js';
import { RecordingPusher } from '../src/notify/push.js';

const tick = vi.hoisted(() => ({
  runTick: vi.fn(async () => ({
    classes: { polled: 1, failed: 0, events: 0, sent: 0, deferred: 0, closed: 0, examCalendars: 0 },
    errors: [] as string[],
  })),
}));
vi.mock('../src/sync/tick.js', () => tick);

const SECRET = 'test-cron-secret-0123456789abcdef';
/** The owner's old static bearer token, still set in the environment as it may be on Vercel. */
const OLD_OWNER_TOKEN = '0123456789abcdef0123456789abcdef';
const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CRON_SECRET: SECRET,
  API_BEARER_TOKEN: OLD_OWNER_TOKEN,
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PUBLIC_BASE_URL: 'https://example.test',
  LOG_LEVEL: 'silent',
  SCHEDULER_ENABLED: 'false',
};

function app() {
  const env = loadEnv(ENV as unknown as NodeJS.ProcessEnv);
  // Nothing outside `/v2` reads the database: any use of it fails the request.
  const prisma = new Proxy({}, {
    get(_target, name) {
      throw new Error(`prisma.${String(name)} touched`);
    },
  });
  const silent = { info: () => {}, warn: () => {}, error: () => {} };
  return buildApp({ services: buildServices(env, prisma as never, silent, new RecordingPusher()) });
}

/** Every route of the single-owner API. */
const OWNER_ROUTES: [string, string][] = [
  ['GET', '/settings'],
  ['GET', '/school'],
  ['POST', '/calendar-sync/hand-over'],
  ['DELETE', '/push-token'],
  ['PUT', '/settings'],
  ['GET', '/status'],
  ['GET', '/notifications'],
  ['POST', '/push-token'],
  ['POST', '/push-test'],
  ['POST', '/sessions/mashov'],
  ['DELETE', '/sessions/mashov'],
  ['GET', '/day'],
  ['GET', '/week'],
  ['GET', '/agenda'],
  ['GET', '/widget-feed'],
  ['POST', '/sync'],
  ['GET', '/tasks'],
  ['POST', '/tasks'],
  ['PATCH', '/tasks/task-1'],
  ['DELETE', '/tasks/task-1'],
  ['GET', '/school/grades'],
  ['GET', '/school/homework'],
  ['PATCH', '/school/homework/mashov-hw%7C91'],
  ['PUT', '/school/homework/mashov-hw%7C91/link'],
  ['GET', '/school/messages'],
  ['GET', '/school/exams'],
  ['GET', '/school/bagrut'],
  ['GET', '/school/attendance'],
  ['GET', '/school/classroom'],
  ['DELETE', '/calendar-sync/hand-over'],
  ['POST', '/oauth/link'],
  ['GET', '/oauth/google/start'],
  ['GET', '/oauth/google/callback?code=x&state=y'],
  ['DELETE', '/oauth/google'],
  ['DELETE', '/oauth/classroom'],
];

describe('the owner\'s routes', () => {
  it('answer 404, with the old owner token, another bearer, or none', async () => {
    const server = app();
    for (const [method, url] of OWNER_ROUTES) {
      const withBody = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
      for (const authorization of [`Bearer ${OLD_OWNER_TOKEN}`, 'Bearer some-other-token', undefined]) {
        const res = await server.inject({
          method: method as 'GET',
          url,
          headers: {
            ...(authorization ? { authorization } : {}),
            ...(withBody ? { 'content-type': 'application/json' } : {}),
          },
          ...(withBody ? { payload: JSON.stringify({ token: 'ExponentPushToken[x]', calendarId: 'c@example.com' }) } : {}),
        });
        expect(res.statusCode, `${method} ${url} (${authorization ?? 'no token'})`).toBe(404);
      }
    }
    await server.close();
  });

  it('leave /health answering, without a token', async () => {
    const server = app();
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await server.close();
  });
});

describe('/cron/tick', () => {
  it('refuses a request without the cron secret, or with the owner\'s old token', async () => {
    const server = app();
    tick.runTick.mockClear();
    const refused = [
      { method: 'GET', url: '/cron/tick' },
      { method: 'POST', url: '/cron/tick' },
      { method: 'GET', url: '/cron/tick?secret=wrong' },
      { method: 'GET', url: '/cron/tick?secret=' },
      { method: 'POST', url: '/cron/tick', headers: { authorization: 'Bearer wrong' } },
      // The owner's old token is no key to it (it was, while CRON_SECRET could be left unset).
      { method: 'GET', url: `/cron/tick?secret=${OLD_OWNER_TOKEN}` },
      { method: 'POST', url: '/cron/tick', headers: { authorization: `Bearer ${OLD_OWNER_TOKEN}` } },
    ] as const;
    for (const req of refused) {
      const res = await server.inject(req);
      expect(res.statusCode, `${req.method} ${req.url}`).toBe(401);
    }
    expect(tick.runTick).not.toHaveBeenCalled();
    await server.close();
  });

  it('runs the tick with the secret, in the query or as a bearer token, and reports the classes', async () => {
    const server = app();
    tick.runTick.mockClear();
    const byQuery = await server.inject({ method: 'GET', url: `/cron/tick?secret=${SECRET}&wait=1` });
    expect(byQuery.statusCode).toBe(200);
    expect(byQuery.json()).toMatchObject({ ok: true, classes: { polled: 1 }, errors: [] });
    const byHeader = await server.inject({ method: 'POST', url: '/cron/tick?wait=1', headers: { authorization: `Bearer ${SECRET}` } });
    expect(byHeader.statusCode).toBe(200);
    expect(tick.runTick).toHaveBeenCalledTimes(2);
    await server.close();
  });
});

describe('the environment', () => {
  it('requires CRON_SECRET, and a long one', () => {
    const { CRON_SECRET: _omit, ...without } = ENV;
    expect(() => loadEnv(without as unknown as NodeJS.ProcessEnv)).toThrow(/CRON_SECRET/);
    expect(() => loadEnv({ ...ENV, CRON_SECRET: 'short' } as unknown as NodeJS.ProcessEnv)).toThrow(/CRON_SECRET/);
  });

  it('needs none of the owner\'s variables', () => {
    const env = loadEnv({ DATABASE_URL: ENV.DATABASE_URL, CRON_SECRET: SECRET } as unknown as NodeJS.ProcessEnv);
    expect(env.CRON_SECRET).toBe(SECRET);
    expect(Object.keys(env)).not.toContain('API_BEARER_TOKEN');
    expect(Object.keys(env)).not.toContain('ENCRYPTION_KEY');
  });
});
