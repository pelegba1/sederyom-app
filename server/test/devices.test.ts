/**
 * `/v2` (plan Phase 2): devices with their own tokens. Every route but
 * registration needs one, and a device reaches its own row and its class's
 * public feed, nothing else; the single owner's routes are gone (404).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassFeed, ClassHistory, DeviceResponse, RegisterDeviceResponse } from '@sederyom/shared';
import { MAX_FOLLOWED_CLASSES } from '@sederyom/shared';
import { calendarExams } from '@sederyom/shared/logic/exam-board/calendar';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { BoardError } from '../src/exam-board/errors.js';
import { buildServices } from '../src/services.js';
import { RecordingPusher } from '../src/notify/push.js';
import { hashDeviceToken, namesOf, normalizeCalendarId, normalizeShahafUrl } from '../src/lib/devices.js';

/** The single owner's old static token: a bearer like any other now, and no device's. */
const OWNER = '0123456789abcdef0123456789abcdef';
const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  SCHEDULER_ENABLED: 'false',
  LOG_LEVEL: 'silent',
};
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const FIXTURES = join(__dirname, '..', 'fixtures', 'shahaf-schools');

type Row = Record<string, unknown> & { id: string };

/** What a class row holds beside its name: all of it null, as a class nobody has given a board is. */
const CLASS_DEFAULTS = {
  examCalendarId: null, examCalendarSetBy: null, exams: null, examsPolledAt: null, examsOkAt: null, examsError: null,
  examBoardKind: null, examBoardSetAt: null, examBoardAnnouncedAt: null,
};
/** Prisma's `data` as the row keeps it: its DbNull (an object) is null. */
const stored = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === Prisma.DbNull ? null : v]));

/** Just the tables `/v2` touches, with Prisma's call shapes. */
function memoryDb() {
  let n = 0;
  const id = () => `id${++n}`;
  const devices: Row[] = [];
  const schools: Row[] = [];
  const classes: Row[] = [];
  const snapshots: { classId: string; kind: string; naturalKey: string; payload: unknown; deletedAt: Date | null }[] = [];
  const notifications: { deviceId: string }[] = [];
  const history: Record<string, unknown>[] = [];
  const examHistory: Record<string, unknown>[] = [];
  const follows: { deviceId: string; classId: string; prefs: unknown; createdAt: Date }[] = [];
  const changeEvents: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => (k === 'NOT' ? !matches(row, v as Record<string, unknown>) : row[k] === v));
  const classWithSchool = (classId: unknown) => {
    const cls = classes.find((c) => c.id === classId);
    return cls ? { ...cls, school: schools.find((s) => s.id === cls.schoolId) } : null;
  };
  const withClass = (d: Row | undefined, include?: unknown) => {
    if (!d || !include) return d ?? null;
    return {
      ...d,
      class: classWithSchool(d.classId),
      follows: follows.filter((f) => f.deviceId === d.id).map((f) => ({ classId: f.classId, prefs: f.prefs, class: classWithSchool(f.classId) })),
    };
  };
  const removeFollows = (gone: (f: (typeof follows)[number]) => boolean) => {
    const before = follows.length;
    for (let i = follows.length - 1; i >= 0; i--) if (gone(follows[i]!)) follows.splice(i, 1);
    return { count: before - follows.length };
  };
  const prisma = {
    device: {
      findUnique: async ({ where, include }: { where: Record<string, unknown>; include?: unknown }) =>
        withClass(devices.find((d) => matches(d, where)), include),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id(), pushToken: null, classId: null, ...data };
        devices.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = devices.find((d) => d.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = devices.filter((d) => matches(d, where));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        // `class_follow` cascades with its device.
        removeFollows((f) => f.deviceId === where.id);
        return devices.splice(devices.findIndex((d) => d.id === where.id), 1)[0];
      },
    },
    classFollow: {
      findUnique: async ({ where }: { where: { deviceId_classId: { deviceId: string; classId: string } } }) =>
        follows.find((f) => f.deviceId === where.deviceId_classId.deviceId && f.classId === where.deviceId_classId.classId) ?? null,
      deleteMany: async ({ where }: { where: { deviceId: string; classId: string | { notIn: string[] } } }) =>
        removeFollows((f) =>
          f.deviceId === where.deviceId && (typeof where.classId === 'string' ? f.classId === where.classId : !where.classId.notIn.includes(f.classId))),
      upsert: async ({ where, create, update }: { where: { deviceId_classId: { deviceId: string; classId: string } }; create: { deviceId: string; classId: string; prefs: unknown }; update: { prefs: unknown } }) => {
        const key = where.deviceId_classId;
        const row = follows.find((f) => f.deviceId === key.deviceId && f.classId === key.classId);
        if (row) return Object.assign(row, update);
        const added = { ...create, createdAt: new Date() };
        follows.push(added);
        return added;
      },
    },
    school: {
      upsert: async ({ where, create, update }: { where: { shahafUrl: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        let row = schools.find((s) => s.shahafUrl === where.shahafUrl);
        if (row) Object.assign(row, update);
        else schools.push((row = { id: id(), ...create }));
        return row;
      },
    },
    schoolClass: {
      upsert: async ({ where, create, update }: { where: { schoolId_shahafClassId: { schoolId: string; shahafClassId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.schoolId_shahafClassId;
        let row = classes.find((c) => c.schoolId === key.schoolId && c.shahafClassId === key.shahafClassId);
        if (row) Object.assign(row, update);
        else classes.push((row = { id: id(), lastOkAt: null, freshness: null, ...CLASS_DEFAULTS, ...create }));
        return row;
      },
      // `where` may name more than the id (Prisma 5): a row that does not match it is P2025.
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = classes.find((c) => matches(c, where));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        Object.assign(row, stored(data));
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = classes.filter((c) => matches(c, where));
        hit.forEach((c) => Object.assign(c, stored(data)));
        return { count: hit.length };
      },
      findUnique: async ({ where }: { where: { id: string } }) => classes.find((c) => c.id === where.id) ?? null,
      // A class of that site and id that some device follows: as its own, or as one of a parent's others (`FOLLOWED`).
      findFirst: async ({ where }: { where: { shahafClassId: string; school: { shahafUrl: string }; OR: Record<string, { some: object }>[] } }) => {
        const followed = (cls: Row) =>
          where.OR.some((clause) => {
            const [[relation, filter]] = Object.entries(clause) as [[string, { some: object }]];
            expect(filter, `the stand-in understands only "some: {}", not ${JSON.stringify(filter)}`).toEqual({ some: {} });
            if (relation === 'devices') return devices.some((d) => d.classId === cls.id);
            if (relation === 'follows') return follows.some((f) => f.classId === cls.id);
            throw new Error(`the stand-in does not know the relation ${relation}`);
          });
        const hit = classes.find(
          (c) => c.shahafClassId === where.shahafClassId && schools.find((s) => s.id === c.schoolId)?.shahafUrl === where.school.shahafUrl && followed(c),
        );
        return hit ? classWithSchool(hit.id) : null;
      },
    },
    classSnapshot: {
      findMany: async ({ where }: { where: { classId: string; deletedAt: null } }) =>
        snapshots.filter((s) => s.classId === where.classId && s.deletedAt === null),
    },
    // The event that tells a class of its exam board (`announceBoard`).
    classChangeEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id(), ...data };
        changeEvents.push(row);
        return row;
      },
    },
    // `GET /v2/class/history`: a class's rows from a day on, by date and then period.
    classLessonHistory: {
      findMany: async ({ where }: { where: { classId: string; date: { gte: string } } }) =>
        history
          .filter((h) => h.classId === where.classId && (h.date as string) >= where.date.gte)
          .sort((x, y) => (x.date === y.date ? (x.hourIndex as number) - (y.hourIndex as number) : (x.date as string) < (y.date as string) ? -1 : 1)),
    },
    classExamHistory: {
      findMany: async ({ where }: { where: { classId: string; date: { gte: string } } }) =>
        examHistory
          .filter((h) => h.classId === where.classId && (h.date as string) >= where.date.gte)
          .sort((x, y) => ((x.date as string) < (y.date as string) ? -1 : 1)),
    },
    deviceNotification: {
      deleteMany: async ({ where }: { where: { deviceId: string } }) => {
        const before = notifications.length;
        for (let i = notifications.length - 1; i >= 0; i--) if (notifications[i]!.deviceId === where.deviceId) notifications.splice(i, 1);
        return { count: before - notifications.length };
      },
    },
    // `DELETE /v2/device` settles the device's friends' boxes in its transaction; this suite has none (buddies-routes.test.ts does).
    buddyBox: {
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    // ... and its chat connection (`chatRowsOf`); this suite has none (chat-device-routes.test.ts does).
    chatAuthCode: { deleteMany: async () => ({ count: 0 }) },
    chatToken: { deleteMany: async () => ({ count: 0 }) },
    chatGrant: { deleteMany: async () => ({ count: 0 }) },
    chatCode: { deleteMany: async () => ({ count: 0 }) },
    chatSnapshot: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, devices, schools, classes, snapshots, notifications, follows, changeEvents, history, examHistory };
}

/**
 * `ics` serves a calendar's feed (`services.fetchIcs`); without it every calendar is unreachable, as with no
 * network, and no test here reaches one.
 */
function world(opts: { ics?: (calendarId: string) => string | Promise<string>; logStream?: { write(line: string): void } } = {}) {
  const db = memoryDb();
  const fetched: string[] = [];
  const icsAsked: string[] = [];
  const env = loadEnv({ ...ENV, ...(opts.logStream ? { LOG_LEVEL: 'trace' } : {}) } as unknown as NodeJS.ProcessEnv);
  const services = buildServices(env, db.prisma as never, silent, new RecordingPusher(), {
    shahafFetcherFor: (siteUrl) => async () => {
      fetched.push(siteUrl);
      const school = new URL(siteUrl).hostname.split('.')[0]!;
      return readFileSync(join(FIXTURES, school, 'root.html'), 'utf8');
    },
    fetchIcs: async (calendarId) => {
      icsAsked.push(calendarId);
      if (!opts.ics) throw new BoardError('unreachable');
      return opts.ics(calendarId);
    },
  });
  const app = buildApp({ services, ...(opts.logStream ? { logStream: opts.logStream } : {}) });
  return { app, db, fetched, icsAsked };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: ReturnType<typeof world>['app']): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/v2/devices', payload: { platform: 'android' } });
  expect(res.statusCode).toBe(201);
  return (res.json() as RegisterDeviceResponse).token;
}

describe('a device token, and what it opens', () => {
  it('opens nothing outside /v2: the owner\'s routes are gone', async () => {
    const { app } = world();
    const token = await register(app);
    for (const url of ['/day', '/week', '/settings', '/status', '/school', '/tasks', '/widget-feed', '/notifications']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(token) });
      expect(res.statusCode, url).toBe(404);
    }
    const sync = await app.inject({ method: 'POST', url: '/sync', headers: auth(token) });
    expect(sync.statusCode).toBe(404);
  });

  it('refuses the owner\'s old token on /v2, and no token at all', async () => {
    const { app } = world();
    expect((await app.inject({ method: 'GET', url: '/v2/device', headers: auth(OWNER) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v2/device' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth('made-up-token') })).statusCode).toBe(401);
  });

  it('keeps only the hash of a device token', async () => {
    const { app, db } = world();
    const token = await register(app);
    expect(db.devices[0]!.tokenHash).toBe(hashDeviceToken(token));
    expect(JSON.stringify(db.devices)).not.toContain(token);
  });
});

/**
 * The app's client sends `content-type: application/json` with every request,
 * body or not, and Fastify's own parser answers an empty JSON body with 400 —
 * which is what "סנכרון עכשיו" once showed the user. An empty body is read as
 * no body; a malformed one is still refused.
 */
describe('the JSON the app sends', () => {
  const json = { 'content-type': 'application/json' };

  it('takes a bodiless request that still says application/json', async () => {
    const { app } = world();
    const token = await register(app);
    const res = await app.inject({ method: 'PUT', url: '/v2/device', headers: { ...auth(token), ...json } });
    expect(res.statusCode).toBe(200);
    // Registration reads the empty body as no body too: what is missing is the platform, not valid JSON.
    const reg = await app.inject({ method: 'POST', url: '/v2/devices', headers: json });
    expect(reg.statusCode).toBe(400);
    expect(reg.json().error).toBe('invalid_device');
  });

  it('still refuses a malformed body', async () => {
    const { app, db } = world();
    const token = await register(app);
    const res = await app.inject({
      method: 'PUT', url: '/v2/device', headers: { ...auth(token), ...json }, payload: '{"prefs": {"vacationMode": tru',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).not.toBe('invalid_device');
    expect(db.devices[0]!.prefs).toEqual(expect.objectContaining({ vacationMode: false }));
  });
});

describe('a device', () => {
  it('registers, picks a school and a class, and reads it back', async () => {
    const { app, db } = world();
    const token = await register(app);
    const res = await app.inject({
      method: 'PUT', url: '/v2/device', headers: auth(token),
      payload: { class: { siteUrl: 'https://School-C.shahaf.site/', classId: '12144' }, semel: 123456, pushToken: 'ExponentPushToken[abc]' },
    });
    expect(res.statusCode).toBe(200);
    const device = res.json() as DeviceResponse;
    // The name comes from the site, not from the device.
    expect(device.class).toEqual({ siteUrl: 'https://school-c.shahaf.site', classId: '12144', className: "יא' 4", examCalendarId: null });
    expect(device.hasPushToken).toBe(true);
    expect(db.schools).toHaveLength(1);
    expect(db.schools[0]).toMatchObject({ shahafUrl: 'https://school-c.shahaf.site', semel: 123456 });

    const again = await app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) });
    expect((again.json() as DeviceResponse).class?.classId).toBe('12144');
  });

  it('refuses a class the site does not list', async () => {
    const { app, db } = world();
    const token = await register(app);
    const res = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl: 'school-c.shahaf.site', classId: '99999' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unknown_class');
    expect(db.classes).toHaveLength(0);
  });

  /** SSRF: the server fetches what the device names, so it may name only a Shahaf site. */
  it('never fetches a site that is not a Shahaf site', async () => {
    const { app, fetched } = world();
    const token = await register(app);
    for (const siteUrl of ['http://169.254.169.254/', 'https://evil.example/', 'https://dugma.shahaf.site.evil.example', 'https://dugma.shahaf.site:8443', 'https://dugma.shahaf.site/admin']) {
      const res = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl, classId: '1' } } });
      expect(res.statusCode, siteUrl).toBe(400);
      const list = await app.inject({ method: 'GET', url: `/v2/classes?site=${encodeURIComponent(siteUrl)}`, headers: auth(token) });
      expect(list.statusCode, siteUrl).toBe(400);
    }
    expect(fetched).toEqual([]);
  });

  it('lists a school\'s classes', async () => {
    const { app } = world();
    const token = await register(app);
    const res = await app.inject({ method: 'GET', url: '/v2/classes?site=school-g.shahaf.site', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().classes).toHaveLength(30);
  });

  it('lists them without a device too: the phone registers only when it follows a class', async () => {
    const { app, db, fetched } = world();
    const res = await app.inject({ method: 'GET', url: '/v2/classes?site=school-g.shahaf.site' });
    expect(res.statusCode).toBe(200);
    expect(res.json().classes).toHaveLength(30);
    expect(db.devices).toHaveLength(0);
    // Still only a Shahaf site, and every other route still wants a token.
    expect((await app.inject({ method: 'GET', url: '/v2/classes?site=https%3A%2F%2Fevil.example%2F' })).statusCode).toBe(400);
    expect(fetched).toEqual(['https://school-g.shahaf.site']);
    expect((await app.inject({ method: 'PUT', url: '/v2/device', payload: { pushToken: 'x' } })).statusCode).toBe(401);
  });

  it('merges its preferences instead of replacing them', async () => {
    const { app } = world();
    const token = await register(app);
    await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { prefs: { hiddenSubjects: ['ספרות'] } } });
    const res = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { prefs: { notifications: { new_exam: false } } } });
    const { prefs } = res.json() as DeviceResponse;
    expect(prefs.hiddenSubjects).toEqual(['ספרות']);
    expect(prefs.notifications).toEqual({ schedule_change_tomorrow: true, schedule_change_today: true, new_exam: false });
    const bad = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { prefs: { quietHours: { from: '25:00' } } } });
    expect(bad.statusCode).toBe(400);
  });

  describe("the student's own names for subjects", () => {
    const BLOCK = "גוש ב' (יב)";
    const putPrefs = (app: ReturnType<typeof world>['app'], token: string, prefs: object) =>
      app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { prefs } });

    it('keeps them in the preferences, and a later write without them leaves them alone', async () => {
      const { app, db } = world();
      const token = await register(app);
      // A device that never sent any answers {} (the default), not a missing field.
      expect(((await app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) })).json() as DeviceResponse).prefs.subjectNames).toEqual({});

      const res = await putPrefs(app, token, { subjectNames: { [BLOCK]: 'פיזיקה' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as DeviceResponse).prefs.subjectNames).toEqual({ [BLOCK]: 'פיזיקה' });

      const later = await putPrefs(app, token, { vacationMode: true, hiddenSubjects: ['ספרות'] });
      expect((later.json() as DeviceResponse).prefs.subjectNames).toEqual({ [BLOCK]: 'פיזיקה' });
      const read = await app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) });
      expect((read.json() as DeviceResponse).prefs.subjectNames).toEqual({ [BLOCK]: 'פיזיקה' });
      expect(namesOf(db.devices[0]!.prefs)).toEqual({ [BLOCK]: 'פיזיקה' });
    });

    it('stores them cleaned: whitespace collapsed and trimmed, and a name that cleans to nothing left out', async () => {
      const { app, db } = world();
      const token = await register(app);
      // Zod's min(1) lets "   " through; the cleaner is what drops it.
      const res = await putPrefs(app, token, { subjectNames: { a: '  x  y ', b: '   ', c: 'שם\tעם רווח' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as DeviceResponse).prefs.subjectNames).toEqual({ a: 'x y', c: 'שם עם רווח' });
      expect((db.devices[0]!.prefs as { subjectNames: unknown }).subjectNames).toEqual({ a: 'x y', c: 'שם עם רווח' });
    });

    it('replaces the whole map when one is sent, key by key never, and {} clears it', async () => {
      const { app } = world();
      const token = await register(app);
      await putPrefs(app, token, { subjectNames: { a: 'אחד', b: 'שניים' } });
      const replaced = await putPrefs(app, token, { subjectNames: { c: 'שלושה' } });
      expect((replaced.json() as DeviceResponse).prefs.subjectNames).toEqual({ c: 'שלושה' });
      const cleared = await putPrefs(app, token, { subjectNames: {} });
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as DeviceResponse).prefs.subjectNames).toEqual({});
    });

    it('takes a name of 40 characters, 200 names, and a key of 200 characters', async () => {
      const { app } = world();
      const token = await register(app);
      const edge = {
        ['k'.repeat(200)]: 'א'.repeat(40),
        ...Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`key${i}`, 'שם'])),
      };
      expect(Object.keys(edge)).toHaveLength(200);
      const res = await putPrefs(app, token, { subjectNames: edge });
      expect(res.statusCode).toBe(200);
      expect(Object.keys((res.json() as DeviceResponse).prefs.subjectNames)).toHaveLength(200);
    });

    it('refuses a name that is too long, has a line break or is empty, and a map or a key that is too big', async () => {
      const { app } = world();
      const token = await register(app);
      await putPrefs(app, token, { subjectNames: { keep: 'נשאר' } });
      const tooMany = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`key${i}`, 'שם']));
      const bad: Record<string, object> = {
        'a name of 41 characters': { x: 'א'.repeat(41) },
        'a name with a line feed': { x: 'שורה\nשנייה' },
        'a name with a carriage return': { x: 'שורה\rשנייה' },
        'an empty name': { x: '' },
        '201 keys': tooMany,
        'a key of 201 characters': { ['k'.repeat(201)]: 'שם' },
        'an empty key': { '': 'שם' },
        'a name that is not a string': { x: 7 },
        'a list': ['שם'],
      };
      for (const [what, subjectNames] of Object.entries(bad)) {
        const res = await putPrefs(app, token, { subjectNames });
        expect(res.statusCode, what).toBe(400);
        expect(res.json().error, what).toBe('invalid_device');
      }
      // Nothing of the refused writes got in.
      const read = await app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) });
      expect((read.json() as DeviceResponse).prefs.subjectNames).toEqual({ keep: 'נשאר' });
    });
  });

  it('hands its push token over when the same phone registers again', async () => {
    const { app, db } = world();
    const first = await register(app);
    const second = await register(app);
    await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(first), payload: { pushToken: 'ExponentPushToken[same]' } });
    await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(second), payload: { pushToken: 'ExponentPushToken[same]' } });
    expect(db.devices.map((d) => d.pushToken)).toEqual([null, 'ExponentPushToken[same]']);
  });

  it('reads its class\'s feed, and says so when it has no class yet', async () => {
    const { app, db } = world();
    const token = await register(app);
    const none = await app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) });
    expect(none.statusCode).toBe(409);

    await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } } });
    const classId = db.classes[0]!.id;
    const lesson = { date: '2099-01-04', hourIndex: 2, startTime: '09:00', endTime: '09:45', subject: 'היסטוריה', teacher: null, room: null, status: 'cancelled', substitute: null, note: null };
    db.snapshots.push(
      { classId, kind: 'lesson', naturalKey: 'l1', payload: lesson, deletedAt: null },
      { classId, kind: 'lesson', naturalKey: 'old', payload: { ...lesson, date: '2000-01-01' }, deletedAt: null },
      { classId, kind: 'exam', naturalKey: 'e1', payload: { date: '2099-01-05', subject: 'מבחן בהיסטוריה', details: null }, deletedAt: null },
      { classId, kind: 'exam', naturalKey: 'gone', payload: { date: '2099-01-06', subject: 'נמחק', details: null }, deletedAt: new Date() },
      { classId: 'another-class', kind: 'exam', naturalKey: 'x', payload: { date: '2099-01-05', subject: 'לא שלך', details: null }, deletedAt: null },
    );
    const res = await app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const feed = res.json() as ClassFeed;
    expect(feed.class.classId).toBe('12144');
    expect(feed.lessons).toEqual([lesson]);
    expect(feed.exams).toEqual([{ naturalKey: 'e1', date: '2099-01-05', subject: 'מבחן בהיסטוריה', details: null, source: 'shahaf' }]);
  });

  describe('the class history', () => {
    const row = (classId: string, date: string, over: Record<string, unknown> = {}) => ({
      classId, date, hourIndex: 1, subject: 'אנגלית', teacher: 'שרון', room: '108', startTime: '08:00', endTime: '08:45',
      status: 'regular', substitute: null, note: null, source: 'observed', changeSeenAt: null, frozenAt: new Date(), ...over,
    });
    async function followed() {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00+02:00') });
      const { app, db } = world();
      const token = await register(app);
      await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } } });
      const classId = db.classes[0]!.id;
      db.history.push(
        row(classId, '2026-09-01', { source: 'backfill' }),
        row(classId, '2026-10-20'),
        row(classId, '2026-10-26', { status: 'cancelled', changeSeenAt: new Date('2026-10-25T15:00:00.000Z') }),
        row(classId, '2026-10-26', { hourIndex: 3, teacher: '', subject: 'חינוך' }),
        row('another-class', '2026-10-26', { subject: 'לא שלך' }),
        row(classId, '2025-12-01', { subject: 'שנה שעברה' }),
      );
      db.examHistory.push(
        { classId, naturalKey: 'shahaf-exam|1', date: '2026-10-21', subject: 'מבחן בהיסטוריה', details: null, source: 'shahaf', frozenAt: new Date() },
        { classId: 'another-class', naturalKey: 'x', date: '2026-10-21', subject: 'לא שלך', details: null, source: 'shahaf', frozenAt: new Date() },
      );
      return { app, token };
    }
    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers the device\'s class for the school year, with what it covers', async () => {
      const { app, token } = await followed();
      const res = await app.inject({ method: 'GET', url: '/v2/class/history', headers: auth(token) });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ClassHistory;
      expect(body.class.classId).toBe('12144');
      expect(body.coverage).toEqual({ observedFrom: '2026-10-20', from: '2026-09-01', to: '2026-10-26' });
      expect(body.lessons.map((l) => [l.date, l.hourIndex, l.subject, l.source, l.status])).toEqual([
        ['2026-09-01', 1, 'אנגלית', 'backfill', 'regular'],
        ['2026-10-20', 1, 'אנגלית', 'observed', 'regular'],
        ['2026-10-26', 1, 'אנגלית', 'observed', 'cancelled'],
        ['2026-10-26', 3, 'חינוך', 'observed', 'regular'],
      ]);
      expect(body.lessons[2]).toMatchObject({ teacher: 'שרון', changeSeenAt: '2026-10-25T15:00:00.000Z' });
      // A lesson with no teacher is stored under '' and goes out as none.
      expect(body.lessons[3]!.teacher).toBeNull();
      expect(body.lessons[0]).not.toHaveProperty('classId');
      expect(body.lessons[0]).not.toHaveProperty('frozenAt');
      expect(body.exams).toEqual([{ naturalKey: 'shahaf-exam|1', date: '2026-10-21', subject: 'מבחן בהיסטוריה', details: null, source: 'shahaf' }]);
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
    });

    it('narrows the rows by `from`, and not what it covers', async () => {
      const { app, token } = await followed();
      const body = (await app.inject({ method: 'GET', url: '/v2/class/history?from=2026-10-26', headers: auth(token) })).json() as ClassHistory;
      expect(body.lessons.map((l) => l.date)).toEqual(['2026-10-26', '2026-10-26']);
      expect(body.exams).toEqual([]);
      expect(body.coverage).toEqual({ observedFrom: '2026-10-20', from: '2026-09-01', to: '2026-10-26' });
    });

    it('never reaches before the school year, whatever `from` says', async () => {
      const { app, token } = await followed();
      const body = (await app.inject({ method: 'GET', url: '/v2/class/history?from=2020-01-01', headers: auth(token) })).json() as ClassHistory;
      expect(body.lessons.some((l) => l.subject === 'שנה שעברה')).toBe(false);
      expect(body.coverage.from).toBe('2026-09-01');
    });

    it('refuses a `from` that is not a day', async () => {
      const { app, token } = await followed();
      for (const from of ['yesterday', '2026-13-40', '26-10-2026', '']) {
        const res = await app.inject({ method: 'GET', url: `/v2/class/history?from=${from}`, headers: auth(token) });
        expect(res.statusCode, from).toBe(400);
      }
    });

    it('says so when the device has no class, and answers empty for a class with no history yet', async () => {
      const { app } = world();
      const token = await register(app);
      expect((await app.inject({ method: 'GET', url: '/v2/class/history', headers: auth(token) })).statusCode).toBe(409);
      await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } } });
      const body = (await app.inject({ method: 'GET', url: '/v2/class/history', headers: auth(token) })).json() as ClassHistory;
      expect(body).toMatchObject({ coverage: { observedFrom: null, from: null, to: null }, lessons: [], exams: [] });
    });

    it('needs a device', async () => {
      const { app } = world();
      expect((await app.inject({ method: 'GET', url: '/v2/class/history' })).statusCode).toBe(401);
    });
  });

  it('deletes itself, and with it every push it was sent', async () => {
    const { app, db } = world();
    const token = await register(app);
    db.notifications.push({ deviceId: db.devices[0]!.id }, { deviceId: 'someone-else' });
    const res = await app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(db.devices).toHaveLength(0);
    expect(db.notifications).toEqual([{ deviceId: 'someone-else' }]);
    expect((await app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) })).statusCode).toBe(401);
  });
});

describe('normalizeShahafUrl', () => {
  it('takes a Shahaf subdomain in any spelling, and nothing else', () => {
    expect(normalizeShahafUrl('https://dugma.shahaf.site/')).toBe('https://dugma.shahaf.site');
    expect(normalizeShahafUrl('School-E.shahaf.site')).toBe('https://school-e.shahaf.site');
    expect(normalizeShahafUrl(' http://school-c.shahaf.site ')).toBe('https://school-c.shahaf.site');
    for (const bad of ['', 'shahaf.site', 'https://www.shahaf.site', 'https://a.b.shahaf.site', 'https://-x.shahaf.site', 'https://x.shahaf.site/path', 'https://user@x.shahaf.site', 'https://x.shahaf.site:80', 'https://x.shahaf.site?x=1', 'file:///etc/passwd']) {
      expect(normalizeShahafUrl(bad), bad).toBeNull();
    }
  });
});

describe('namesOf', () => {
  it("reads a device's or a followed class's names, and nothing from what is not a map of names", () => {
    expect(namesOf({ hiddenSubjects: [], subjectNames: { 'subject:אנגלית': 'אנגלית (בהרבה)' } })).toEqual({ 'subject:אנגלית': 'אנגלית (בהרבה)' });
    // The tolerant reader: names cleaned, non-strings and empty names dropped.
    expect(namesOf({ subjectNames: { a: '  שם   ארוך ', b: 3, c: '   ', d: null } })).toEqual({ a: 'שם ארוך' });
    for (const none of [null, undefined, 'x', 7, [], {}, { hiddenSubjects: ['ספרות'] }, { subjectNames: null }, { subjectNames: ['שם'] }, { subjectNames: 'שם' }]) {
      expect(namesOf(none), JSON.stringify(none)).toEqual({});
    }
  });
});

describe("the grade's exam calendar", () => {
  const CAL ='7e3b9d14a2c6f805@group.calendar.google.com';

  it('takes a calendar id or the embed link, and nothing else', () => {
    expect(normalizeCalendarId(CAL)).toBe(CAL);
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/embed?height=600&src=${encodeURIComponent(CAL)}&ctz=Asia%2FJerusalem`)).toBe(CAL);
    // Google's "add this calendar" link carries the id in base64, the public iCal address in its path.
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/u/0?cid=${Buffer.from(CAL).toString('base64')}`)).toBe(CAL);
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL)}/public/basic.ics`)).toBe(CAL);
    for (const bad of ['', 'not a calendar', 'https://evil.example/x.ics', 'a@b', '../../etc@x.com/..', 'x@y.com?z=1', 'https://calendar.google.com/calendar/u/0?cid=bm90IGFuIGlk']) {
      expect(normalizeCalendarId(bad), bad).toBeNull();
    }
  });

  it("is set for the device's class, and its exams join the class feed marked as the calendar's", async () => {
    const { app, db } = world();
    const token = await register(app);
    const noClass = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { examCalendar: CAL } });
    expect(noClass.statusCode).toBe(400);

    await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } } });
    const bad = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { examCalendar: 'https://evil.example/' } });
    expect(bad.statusCode).toBe(400);
    const res = await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { examCalendar: CAL } });
    expect((res.json() as DeviceResponse).class?.examCalendarId).toBe(CAL);

    // What the poller keeps on the class row.
    db.classes[0]!.exams = [{ naturalKey: 'site-exam|1', date: '2099-01-05', subject: 'מתכונת באנגלית', details: null }];
    db.snapshots.push({ classId: db.classes[0]!.id, kind: 'exam', naturalKey: 'shahaf-exam|1', payload: { date: '2099-01-06', subject: 'מבחן בהיסטוריה', details: null }, deletedAt: null });
    // The calendar's exam on the site too: it goes out once, as the calendar's.
    db.snapshots.push({ classId: db.classes[0]!.id, kind: 'exam', naturalKey: 'shahaf-exam|2', payload: { date: '2099-01-05', subject: 'מבחן באנגלית שכבה יב', details: null }, deletedAt: null });
    const feed = (await app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).json() as ClassFeed;
    expect(feed.exams.map((e) => `${e.source} ${e.subject}`).sort()).toEqual(['school_site מתכונת באנגלית', 'shahaf מבחן בהיסטוריה']);
  });

  const OTHER = 'aa11bb22cc33dd44@group.calendar.google.com';
  const put = (app: ReturnType<typeof world>['app'], token: string, payload: object) =>
    app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload });

  it("sends the site's exams that the calendar also lists apart, in `siteTwins`, and leaves `exams` as it was", async () => {
    const { app, db } = world();
    const token = await register(app);
    await put(app, token, { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } });
    await put(app, token, { examCalendar: CAL });
    const classId = db.classes[0]!.id;
    const exam = (naturalKey: string, subject: string, date: string) => ({ classId, kind: 'exam', naturalKey, payload: { date, subject, details: null }, deletedAt: null });
    db.classes[0]!.exams = [
      { naturalKey: 'site-exam|1', date: '2099-01-05', subject: 'י"ב מבחן באנגלית', details: null },
      { naturalKey: 'site-exam|old', date: '2000-01-05', subject: 'י"ב מבחן באנגלית', details: null },
    ];
    db.snapshots.push(
      exam('shahaf-exam|english', 'מבחן באנגלית שכבה יב', '2099-01-05'),
      exam('shahaf-exam|history', 'מבחן בהיסטוריה', '2099-01-06'),
      // A twin of a calendar exam that is long past is not sent either way.
      exam('shahaf-exam|old', 'מבחן באנגלית שכבה יב', '2000-01-05'),
    );

    const feed = (await app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).json() as ClassFeed;
    // `exams` is what it was: the calendar's exam once, the site's other exam.
    expect(feed.exams.map((e) => `${e.source} ${e.naturalKey}`)).toEqual(['shahaf shahaf-exam|history', 'school_site site-exam|1']);
    // The site's exam the calendar also lists, as the site had it, marked `shahaf`, dated by the same rule.
    expect(feed.siteTwins).toEqual([{ naturalKey: 'shahaf-exam|english', date: '2099-01-05', subject: 'מבחן באנגלית שכבה יב', details: null, source: 'shahaf' }]);
  });

  it('has no `siteTwins` at all for a class with no board, or with a board that lists none of the site\'s exams', async () => {
    const { app, db } = world();
    const token = await register(app);
    await put(app, token, { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } });
    const classId = db.classes[0]!.id;
    db.snapshots.push({ classId, kind: 'exam', naturalKey: 'shahaf-exam|history', payload: { date: '2099-01-06', subject: 'מבחן בהיסטוריה', details: null }, deletedAt: null });
    const read = async () => (await app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).json() as ClassFeed;

    const none = await read();
    expect(none.exams.map((e) => e.naturalKey)).toEqual(['shahaf-exam|history']);
    expect('siteTwins' in none).toBe(false);

    await put(app, token, { examCalendar: CAL });
    db.classes[0]!.exams = [{ naturalKey: 'site-exam|1', date: '2099-02-05', subject: 'מתכונת באנגלית', details: null }];
    const board = await read();
    expect(board.exams).toHaveLength(2);
    expect('siteTwins' in board).toBe(false);
  });

  /** Two devices of one class, the first of which set its calendar. */
  async function classmates() {
    const w = world();
    const first = await register(w.app);
    const second = await register(w.app);
    for (const token of [first, second]) await put(w.app, token, { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } });
    expect((await put(w.app, first, { examCalendar: CAL })).statusCode).toBe(200);
    return { ...w, first, second };
  }

  it("is the setter's to replace or clear: a classmate can do neither", async () => {
    const { app, db, first, second } = await classmates();
    db.classes[0]!.exams = [{ naturalKey: 'site-exam|1', date: '2099-01-05', subject: 'מתכונת באנגלית', details: null }];

    const replace = await put(app, second, { examCalendar: OTHER });
    expect(replace.statusCode).toBe(403);
    expect(replace.json()).toMatchObject({ error: 'calendar_locked' });
    expect((await put(app, second, { examCalendar: null })).statusCode).toBe(403);
    expect(db.classes[0]).toMatchObject({ examCalendarId: CAL });
    // The link the class already has is no change: it goes through, and the exams read stay.
    expect((await put(app, second, { examCalendar: CAL })).statusCode).toBe(200);
    expect(db.classes[0]!.exams).toHaveLength(1);

    // The device that set it may.
    expect((await put(app, first, { examCalendar: OTHER })).statusCode).toBe(200);
    expect(db.classes[0]).toMatchObject({ examCalendarId: OTHER, exams: null });
    expect((await put(app, first, { examCalendar: null })).statusCode).toBe(200);
    // Cleared, it is any follower's to set again.
    expect((await put(app, second, { examCalendar: CAL })).statusCode).toBe(200);
    expect(db.classes[0]).toMatchObject({ examCalendarId: CAL, examCalendarSetBy: db.devices[1]!.id });
  });

  it('passes on when the device that set it leaves the class', async () => {
    const moved = await classmates();
    await put(moved.app, moved.first, { class: { siteUrl: 'school-c.shahaf.site', classId: '13900' } });
    expect((await put(moved.app, moved.second, { examCalendar: OTHER })).statusCode).toBe(200);

    const gone = await classmates();
    await gone.app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(gone.first) });
    expect((await put(gone.app, gone.second, { examCalendar: null })).statusCode).toBe(200);
    expect(gone.db.classes[0]).toMatchObject({ examCalendarId: null });
  });
});

/**
 * The class's exam board in its two forms, a Google calendar (`PUT /v2/device {examCalendar}`) and rows from a
 * file or a page (`PUT /v2/device/exam-board`, whose own tests are in exam-board-routes.test.ts): one lock for
 * both, and a new calendar is read in the request that sets it.
 */
describe("the class's exam board, a calendar and a file", () => {
  const CAL = '7e3b9d14a2c6f805@group.calendar.google.com';
  const OTHER = 'aa11bb22cc33dd44@group.calendar.google.com';
  const NOW = new Date('2026-11-10T09:00:00Z');
  const ICS = readFileSync(join(__dirname, '..', 'fixtures', 'school-site', 'exams-yb.ics'), 'utf8');
  const ROWS = [
    { date: '2026-11-20', title: 'מבחן במתמטיקה', details: 'פרקים 1-3' },
    { date: '2026-12-02', title: 'מבחן באנגלית', details: null },
    { date: '2027-01-14', title: 'בוחן בפיזיקה', details: null },
  ];
  type W = ReturnType<typeof world>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const put = (w: W, token: string, payload: object) => w.app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload });
  const upload = (w: W, token: string, rows: object[] = ROWS) =>
    w.app.inject({ method: 'PUT', url: '/v2/device/exam-board', headers: auth(token), payload: { rows } });
  const feedOf = async (w: W, token: string) => (await w.app.inject({ method: 'GET', url: '/v2/class/feed', headers: auth(token) })).json() as ClassFeed;

  /** Two devices of one class, the first of which brought a board from a file. */
  async function uploaded(opts: Parameters<typeof world>[0] = {}) {
    const w = world(opts);
    const first = await register(w.app);
    const second = await register(w.app);
    for (const token of [first, second]) await put(w, token, { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } });
    expect((await upload(w, first)).statusCode).toBe(200);
    return { ...w, first, second };
  }

  it('is not replaced or cleared by a classmate when it came from a file: it has no calendar id to say there is a board', async () => {
    const w = await uploaded({ ics: () => ICS });
    expect(w.db.classes[0]).toMatchObject({ examCalendarId: null, examBoardKind: 'upload' });
    const before = JSON.stringify(w.db.classes);

    const replace = await put(w, w.second, { examCalendar: CAL });
    expect(replace.statusCode).toBe(403);
    expect(replace.json()).toMatchObject({ error: 'calendar_locked' });
    expect((await put(w, w.second, { examCalendar: null })).statusCode).toBe(403);
    expect((await upload(w, w.second, ROWS.slice(0, 1))).statusCode).toBe(403);
    expect(JSON.stringify(w.db.classes)).toBe(before);
    expect(w.icsAsked).toEqual([]);
  });

  it('is replaced by the calendar of the device that brought it, and the calendar\'s exams are in the feed in that request', async () => {
    const w = await uploaded({ ics: () => ICS });
    const res = await put(w, w.first, { examCalendar: CAL });
    expect(res.statusCode).toBe(200);
    expect(w.icsAsked).toEqual([CAL]);

    const read = calendarExams(ICS, '2026-11-10', 'Asia/Jerusalem').exams;
    expect(read.length).toBeGreaterThan(10);
    expect(w.db.classes[0]).toMatchObject({
      examCalendarId: CAL, examBoardKind: null, examBoardSetAt: NOW, examCalendarSetBy: w.db.devices[0]!.id, examsPolledAt: NOW, examsOkAt: NOW, examsError: null,
    });
    expect(w.db.classes[0]!.exams).toEqual(read.map(({ source: _source, ...exam }) => exam));
    expect((res.json() as DeviceResponse).class).toMatchObject({ examCalendarId: CAL, examBoard: { kind: 'calendar', setAt: NOW.toISOString(), count: read.length, mine: true } });

    const feed = await feedOf(w, w.second);
    const expected = read.filter((e) => e.date! >= '2026-11-03').map((e) => e.naturalKey).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(feed.exams.map((e) => e.naturalKey).sort()).toEqual(expected);
    expect(feed.exams.every((e) => e.source === 'school_site' && !e.naturalKey.startsWith('site-exam|up|'))).toBe(true);
    expect((await getDeviceClass(w, w.second)).examBoard).toMatchObject({ kind: 'calendar', mine: false });
  });

  const getDeviceClass = async (w: W, token: string) =>
    ((await w.app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) })).json() as DeviceResponse).class!;

  it('reads the calendar only when its id changed', async () => {
    const w = world({ ics: () => ICS });
    const token = await register(w.app);
    await put(w, token, { class: { siteUrl: 'school-c.shahaf.site', classId: '12144' } });
    await put(w, token, { examCalendar: CAL });
    await put(w, token, { examCalendar: `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(CAL)}` });
    await put(w, token, { prefs: { vacationMode: true } });
    expect(w.icsAsked).toEqual([CAL]);
    await put(w, token, { examCalendar: OTHER });
    expect(w.icsAsked).toEqual([CAL, OTHER]);
    // and a board that is cleared where there is none asks for nothing
    await put(w, token, { examCalendar: null });
    await put(w, token, { examCalendar: null });
    expect(w.icsAsked).toEqual([CAL, OTHER]);
  });

  it('keeps the id and leaves the exams to the next tick when the calendar cannot be read, and still answers 200', async () => {
    for (const fail of [() => { throw new BoardError('unreachable'); }, () => { throw new BoardError('too_big'); }, () => Promise.reject(new TypeError('fetch failed'))]) {
      const w = await uploaded({ ics: fail });
      const res = await put(w, w.first, { examCalendar: CAL });
      expect(res.statusCode).toBe(200);
      // the old board is gone with the change, and the calendar's exams are not there yet: the next tick reads them
      expect(w.db.classes[0]).toMatchObject({ examCalendarId: CAL, examBoardKind: null, exams: null, examsPolledAt: null, examsOkAt: null });
      expect((res.json() as DeviceResponse).class).toMatchObject({ examCalendarId: CAL, examBoard: { kind: 'calendar', count: 0, mine: true } });
    }
  });

  it('logs the name of a failure it did not expect and nothing it said', async () => {
    const lines: string[] = [];
    const w = await uploaded({ logStream: { write: (line) => void lines.push(line) }, ics: () => { throw new RangeError('LEAKMARK the feed said this'); } });
    expect((await put(w, w.first, { examCalendar: CAL })).statusCode).toBe(200);
    expect(lines.some((line) => line.includes('RangeError'))).toBe(true);
    for (const line of lines) expect(line).not.toContain('LEAKMARK');
  });

  it('gives a calendar that does not answer 10 seconds, and then goes on without it', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    const w = await uploaded({ ics: () => new Promise<string>(() => {}) });
    let answer: { statusCode: number } | null = null;
    const pending = put(w, w.first, { examCalendar: CAL }).then((res) => (answer = res));
    for (let i = 0; i < 200 && w.icsAsked.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(w.icsAsked).toEqual([CAL]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).statusCode).toBe(200);
    expect(w.db.classes[0]).toMatchObject({ examCalendarId: CAL, exams: null });
  });

  it('is cleared whole by the device that brought it, in either form, and then is anyone\'s to bring again', async () => {
    for (const form of ['file', 'calendar'] as const) {
      const w = await uploaded({ ics: () => ICS });
      if (form === 'calendar') expect((await put(w, w.first, { examCalendar: CAL })).statusCode).toBe(200);
      w.db.classes[0]!.examBoardAnnouncedAt = NOW;

      const res = await put(w, w.first, { examCalendar: null });
      expect([form, res.statusCode]).toEqual([form, 200]);
      // The mark of the class's last announcement stays (final review, S-I1): a board brought again within 30 days tells no one.
      expect([form, w.db.classes[0]]).toEqual([form, expect.objectContaining({
        examCalendarId: null, examCalendarSetBy: null, exams: null, examsPolledAt: null, examsOkAt: null, examsError: null,
        examBoardKind: null, examBoardSetAt: null, examBoardAnnouncedAt: NOW,
      })]);
      expect('examBoard' in (res.json() as DeviceResponse).class!).toBe(false);
      expect((await feedOf(w, w.second)).exams).toEqual([]);

      expect((await upload(w, w.second)).statusCode).toBe(200);
      expect(w.db.classes[0]).toMatchObject({ examBoardKind: 'upload', examCalendarSetBy: w.db.devices[1]!.id });
    }
  });

  it('is replaced without being announced again: the mark of the first announcement stays', async () => {
    const w = await uploaded({ ics: () => ICS });
    w.db.classes[0]!.examBoardAnnouncedAt = new Date('2026-11-09T08:00:00Z');
    expect((await put(w, w.first, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.db.classes[0]!.examBoardAnnouncedAt).toEqual(new Date('2026-11-09T08:00:00Z'));
    expect((await upload(w, w.first)).statusCode).toBe(200);
    expect(w.db.classes[0]!.examBoardAnnouncedAt).toEqual(new Date('2026-11-09T08:00:00Z'));
  });

  it("tells the class of a calendar's first exams in the request that set it, and not of a calendar that replaces it", async () => {
    const w = await uploaded({ ics: () => ICS });
    // the file's first save told the class; a calendar in its place is the same board
    expect(w.db.changeEvents).toHaveLength(1);
    expect((await put(w, w.first, { examCalendar: CAL })).statusCode).toBe(200);
    expect((await put(w, w.first, { examCalendar: OTHER })).statusCode).toBe(200);
    expect(w.db.changeEvents).toHaveLength(1);

    // removed and brought again within 30 days of the announcement: nobody is told (final review, S-I1)
    expect((await put(w, w.first, { examCalendar: null })).statusCode).toBe(200);
    expect((await put(w, w.second, { examCalendar: CAL })).statusCode).toBe(200);
    expect(w.db.changeEvents).toHaveLength(1);

    // removed, and a calendar brought 31 days after the class was told: its first board again, told once, and not
    // about the device that set it
    expect((await put(w, w.second, { examCalendar: null })).statusCode).toBe(200);
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000));
    expect((await put(w, w.second, { examCalendar: OTHER })).statusCode).toBe(200);
    expect(w.db.changeEvents).toHaveLength(2);
    expect(w.db.changeEvents[1]).toMatchObject({
      classId: w.db.classes[0]!.id, kind: 'exam_board', naturalKey: 'exam-board', change: 'created',
      payload: { before: null, after: { setBy: w.db.devices[1]!.id }, partition: null },
    });
  });

  it('says whose it is also for a class a parent follows besides its own', async () => {
    const w = await uploaded();
    const parent = await register(w.app);
    await put(w, parent, { class: { siteUrl: 'school-c.shahaf.site', classId: '13900' } });
    const res = await w.app.inject({
      method: 'PUT', url: '/v2/device/classes', headers: auth(parent), payload: { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '12144' }] },
    });
    expect(res.statusCode).toBe(200);
    const answer = res.json() as DeviceResponse;
    expect(answer.class?.examBoard).toBeUndefined();
    expect(answer.otherClasses?.[0]).toMatchObject({ classId: '12144', examBoard: { kind: 'upload', count: 3, mine: false, mayChange: false } });
    // a board it brings is its own class's, never that of the class it only follows
    expect((await upload(w, parent)).statusCode).toBe(200);
    expect(w.db.classes.find((c) => c.shahafClassId === '12144')).toMatchObject({ examCalendarSetBy: w.db.devices[0]!.id });
  });

  it('tells a classmate it may bring a board once the device that brought the first has left, and never tells that to a parent of another class', async () => {
    const w = await uploaded();
    const other = (token: string) => getDeviceClass(w, token);
    expect((await other(w.first)).examBoard).toMatchObject({ mine: true, mayChange: true });
    expect((await other(w.second)).examBoard).toMatchObject({ mine: false, mayChange: false });

    const parent = await register(w.app);
    await put(w, parent, { class: { siteUrl: 'school-c.shahaf.site', classId: '13900' } });
    await w.app.inject({
      method: 'PUT', url: '/v2/device/classes', headers: auth(parent), payload: { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '12144' }] },
    });

    // the device that brought the board moves to another class: the lock lets a classmate through
    await put(w, w.first, { class: { siteUrl: 'school-c.shahaf.site', classId: '13900' } });
    expect((await other(w.second)).examBoard).toMatchObject({ mine: false, mayChange: true });
    const seen = ((await w.app.inject({ method: 'GET', url: '/v2/device', headers: auth(parent) })).json() as DeviceResponse).otherClasses?.[0];
    expect(seen).toMatchObject({ classId: '12144', examBoard: { mine: false, mayChange: false } });

    const taken = await upload(w, w.second, ROWS.slice(0, 2));
    expect(taken.statusCode).toBe(200);
    expect((taken.json() as DeviceResponse).class?.examBoard).toMatchObject({ count: 2, mine: true, mayChange: true });
  });
});

/**
 * Parents mode, stage 2: a parent's phone follows its own class, the child on
 * screen, and up to five more, each with that child's hidden lines. The
 * children's names stay on the phone.
 */
describe("a parent's other children", () => {
  const putClasses = (app: ReturnType<typeof world>['app'], token: string, payload: object) =>
    app.inject({ method: 'PUT', url: '/v2/device/classes', headers: auth(token), payload });
  const follow = (app: ReturnType<typeof world>['app'], token: string, classId: string) =>
    app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl: 'school-c.shahaf.site', classId } } });

  /** A device that follows יא' 4 at school C as its own. */
  async function parent() {
    const w = world();
    const token = await register(w.app);
    await follow(w.app, token, '12144');
    w.fetched.length = 0;
    return { ...w, token };
  }

  it('follows other classes, each checked against its site, and reads them back', async () => {
    const { app, db, token, fetched } = await parent();
    const res = await putClasses(app, token, {
      classes: [
        { siteUrl: 'https://School-C.shahaf.site/', classId: '13900', hiddenSubjects: ['פיזיקה'] },
        { siteUrl: 'school-g.shahaf.site', classId: '2' },
      ],
    });
    expect(res.statusCode).toBe(200);
    const device = res.json() as DeviceResponse;
    expect(device.class?.classId).toBe('12144');
    expect(device.otherClasses).toEqual([
      { siteUrl: 'https://school-c.shahaf.site', classId: '13900', className: "ז' 2", examCalendarId: null, hiddenSubjects: ['פיזיקה'] },
      expect.objectContaining({ siteUrl: 'https://school-g.shahaf.site', classId: '2', hiddenSubjects: [] }),
    ]);
    expect(fetched).toEqual(['https://school-c.shahaf.site', 'https://school-g.shahaf.site']);
    expect(((await app.inject({ method: 'GET', url: '/v2/device', headers: auth(token) })).json() as DeviceResponse).otherClasses).toHaveLength(2);

    // A new list replaces the one before, and [] follows none.
    const fewer = await putClasses(app, token, { classes: [{ siteUrl: 'school-g.shahaf.site', classId: '2', hiddenSubjects: ['אמנות'] }] });
    expect((fewer.json() as DeviceResponse).otherClasses).toEqual([expect.objectContaining({ classId: '2', hiddenSubjects: ['אמנות'] })]);
    expect(db.follows).toHaveLength(1);
    await putClasses(app, token, { classes: [] });
    expect(db.follows).toEqual([]);
  });

  it("keeps each child's own names with the class it follows, and {} for a class that sends none", async () => {
    const { app, db, token } = await parent();
    const res = await putClasses(app, token, {
      classes: [
        { siteUrl: 'school-c.shahaf.site', classId: '13900', hiddenSubjects: ['פיזיקה'], subjectNames: { 'subject:אנגלית': 'אנגלית (בהרבה)', "block:ב": 'מדעים' } },
        { siteUrl: 'school-g.shahaf.site', classId: '2' },
      ],
    });
    expect(res.statusCode).toBe(200);
    const idOf = (shahafClassId: string) => db.classes.find((c) => c.shahafClassId === shahafClassId)!.id;
    const prefsOf = (shahafClassId: string) => db.follows.find((f) => f.classId === idOf(shahafClassId))!.prefs;
    expect(prefsOf('13900')).toEqual({ hiddenSubjects: ['פיזיקה'], subjectNames: { 'subject:אנגלית': 'אנגלית (בהרבה)', 'block:ב': 'מדעים' } });
    expect(prefsOf('2')).toEqual({ hiddenSubjects: [], subjectNames: {} });
    expect(namesOf(prefsOf('13900'))).toEqual({ 'subject:אנגלית': 'אנגלית (בהרבה)', 'block:ב': 'מדעים' });
    expect(namesOf(prefsOf('2'))).toEqual({});
    // The GET lists the other classes as before: the names are the server's to push with, not the phone's to read back.
    expect((res.json() as DeviceResponse).otherClasses?.[0]).toEqual(
      { siteUrl: 'https://school-c.shahaf.site', classId: '13900', className: "ז' 2", examCalendarId: null, hiddenSubjects: ['פיזיקה'] },
    );

    // A new list replaces the names of the one before, and a class listed without any has none.
    await putClasses(app, token, { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '13900' }] });
    expect(prefsOf('13900')).toEqual({ hiddenSubjects: [], subjectNames: {} });
  });

  it("stores a follow's names cleaned: whitespace collapsed and trimmed, and a name that cleans to nothing left out", async () => {
    const { app, db, token } = await parent();
    const res = await putClasses(app, token, {
      classes: [{ siteUrl: 'school-c.shahaf.site', classId: '13900', subjectNames: { a: '  x  y ', b: '   ' } }],
    });
    expect(res.statusCode).toBe(200);
    expect(db.follows[0]!.prefs).toEqual({ hiddenSubjects: [], subjectNames: { a: 'x y' } });
  });

  it('refuses names that are too long, have a line break, or are too many, in any entry', async () => {
    const { app, db, token } = await parent();
    const entry = (subjectNames: unknown) => ({ siteUrl: 'school-c.shahaf.site', classId: '13900', subjectNames });
    const bad: Record<string, unknown> = {
      'a name of 41 characters': { x: 'א'.repeat(41) },
      'a name with a line break': { x: 'שורה\nשנייה' },
      'an empty name': { x: '' },
      '201 keys': Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`key${i}`, 'שם'])),
      'a key of 201 characters': { ['k'.repeat(201)]: 'שם' },
    };
    for (const [what, subjectNames] of Object.entries(bad)) {
      const res = await putClasses(app, token, { classes: [{ siteUrl: 'school-g.shahaf.site', classId: '2' }, entry(subjectNames)] });
      expect(res.statusCode, what).toBe(400);
      expect(res.json().error, what).toBe('invalid_classes');
    }
    expect(db.follows).toEqual([]);
  });

  it('follows up to five more, reading each site once', async () => {
    const { app, token, fetched } = await parent();
    const res = await putClasses(app, token, {
      classes: [
        ...['13899', '13900', '13901', '13902'].map((classId) => ({ siteUrl: 'school-c.shahaf.site', classId })),
        { siteUrl: 'school-g.shahaf.site', classId: '2' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as DeviceResponse).otherClasses).toHaveLength(MAX_FOLLOWED_CLASSES - 1);
    expect(fetched).toEqual(['https://school-c.shahaf.site', 'https://school-g.shahaf.site']);
  });

  it('skips its own class and one listed twice, and refuses more than five, or one the site does not list', async () => {
    const { app, db, token, fetched } = await parent();
    const res = await putClasses(app, token, {
      classes: [
        { siteUrl: 'school-c.shahaf.site', classId: '12144' },
        { siteUrl: 'school-c.shahaf.site', classId: '13900' },
        { siteUrl: 'https://school-c.shahaf.site', classId: '13900' },
      ],
    });
    expect((res.json() as DeviceResponse).otherClasses?.map((c) => c.classId)).toEqual(['13900']);

    const classesBefore = db.classes.length;
    fetched.length = 0;
    // Six besides its own, seven in all: one more than a phone may follow, and still a body the route reads.
    const six = ['13899', '13900', '13901', '13902', '13903', '13905'];
    expect(six).toHaveLength(MAX_FOLLOWED_CLASSES);
    const tooMany = await putClasses(app, token, {
      classes: six.map((classId) => ({ siteUrl: 'school-c.shahaf.site', classId })),
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error).toBe('too_many_classes');
    // Refused before any site was read or any class made.
    expect(fetched).toEqual([]);
    expect(db.classes).toHaveLength(classesBefore);

    expect((await putClasses(app, token, { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '99999' }] })).json().error).toBe('unknown_class');
    expect((await putClasses(app, token, { classes: [{ siteUrl: 'https://evil.example/', classId: '1' }] })).json().error).toBe('invalid_site');
    expect((await putClasses(app, token, { classes: 'all' })).json().error).toBe('invalid_classes');
    expect(db.follows.map((f) => f.classId)).toEqual([db.classes.find((c) => c.shahafClassId === '13900')!.id]);
  });

  it("reads another child's class feed, and never a class it does not follow", async () => {
    const { app, db, token } = await parent();
    await putClasses(app, token, { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '13900' }] });
    const other = db.classes.find((c) => c.shahafClassId === '13900')!;
    const own = db.classes.find((c) => c.shahafClassId === '12144')!;
    const exam = (subject: string) => ({ date: '2099-01-05', subject, details: null });
    db.snapshots.push(
      { classId: other.id, kind: 'exam', naturalKey: 'e1', payload: exam('מבחן בתנ״ך'), deletedAt: null },
      { classId: own.id, kind: 'exam', naturalKey: 'e2', payload: exam('מבחן באנגלית'), deletedAt: null },
    );
    const feed = (url: string) => app.inject({ method: 'GET', url, headers: auth(token) });

    const theirs = await feed('/v2/class/feed?site=school-c.shahaf.site&cls=13900');
    expect(theirs.statusCode).toBe(200);
    expect((theirs.json() as ClassFeed).class).toMatchObject({ siteUrl: 'https://school-c.shahaf.site', classId: '13900', className: "ז' 2" });
    expect((theirs.json() as ClassFeed).exams.map((e) => e.subject)).toEqual(['מבחן בתנ״ך']);
    // Its own class, asked for by name or not.
    for (const url of ['/v2/class/feed', `/v2/class/feed?site=${encodeURIComponent('https://school-c.shahaf.site')}&cls=12144`]) {
      expect(((await feed(url)).json() as ClassFeed).exams.map((e) => e.subject), url).toEqual(['מבחן באנגלית']);
    }
    const notFollowed = await feed('/v2/class/feed?site=school-c.shahaf.site&cls=13899');
    expect(notFollowed.statusCode).toBe(409);
    expect(notFollowed.json().error).toBe('not_followed');
    expect((await feed('/v2/class/feed?site=evil.example&cls=1')).statusCode).toBe(400);
    expect((await feed('/v2/class/feed?cls=13900')).statusCode).toBe(400);
  });

  it('turns one of them into its own as one follow, and forgets them all with the device', async () => {
    const { app, db, token } = await parent();
    await putClasses(app, token, { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '13900' }, { siteUrl: 'school-g.shahaf.site', classId: '2' }] });
    // The phone shows the second child now: that class becomes the device's own.
    await follow(app, token, '13900');
    const idOf = (shahafClassId: string) => db.classes.find((c) => c.shahafClassId === shahafClassId)!.id;
    expect(db.follows.map((f) => f.classId)).toEqual([idOf('2')]);
    // And the first child's goes among the others.
    const res = await putClasses(app, token, { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '12144' }, { siteUrl: 'school-g.shahaf.site', classId: '2' }] });
    const device = res.json() as DeviceResponse;
    expect(device.class?.classId).toBe('13900');
    expect(device.otherClasses?.map((c) => c.classId).sort()).toEqual(['12144', '2']);

    await app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(token) });
    expect(db.follows).toEqual([]);
  });

  it("keeps the exam calendar's lock with a parent whose other child is in the class", async () => {
    const CAL = '7e3b9d14a2c6f805@group.calendar.google.com';
    const OTHER = 'aa11bb22cc33dd44@group.calendar.google.com';
    const { app, token } = await parent();
    expect((await app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { examCalendar: CAL } })).statusCode).toBe(200);
    // The parent's phone moves to the other child; the calendar's class is among its others now.
    await follow(app, token, '13900');
    await putClasses(app, token, { classes: [{ siteUrl: 'school-c.shahaf.site', classId: '12144' }] });

    const classmate = await register(app);
    await follow(app, classmate, '12144');
    const swap = () => app.inject({ method: 'PUT', url: '/v2/device', headers: auth(classmate), payload: { examCalendar: OTHER } });
    expect((await swap()).statusCode).toBe(403);
    // Once the parent follows the class no more, it passes on.
    await putClasses(app, token, { classes: [] });
    expect((await swap()).statusCode).toBe(200);
  });
});

/**
 * A feed is a class's public timetable, so a device may read any class some
 * device follows, its own or not: a friend's class (the friends feature, spec
 * §3.2). A class nobody follows is still closed.
 */
describe('a class another device follows', () => {
  const follow = (app: ReturnType<typeof world>['app'], token: string, siteUrl: string, classId: string) =>
    app.inject({ method: 'PUT', url: '/v2/device', headers: auth(token), payload: { class: { siteUrl, classId } } });
  const feed = (app: ReturnType<typeof world>['app'], token: string, site: string, cls: string) =>
    app.inject({ method: 'GET', url: `/v2/class/feed?site=${site}&cls=${cls}`, headers: auth(token) });

  it('carries the site\'s exams its board also lists in `siteTwins`, for a friend\'s class and for a parent\'s other child alike', async () => {
    const { app, db } = world();
    const parent = await register(app);
    await follow(app, parent, 'school-c.shahaf.site', '12144');
    await app.inject({ method: 'PUT', url: '/v2/device/classes', headers: auth(parent), payload: { classes: [{ siteUrl: 'school-g.shahaf.site', classId: '36' }] } });
    const theirs = db.classes.find((c) => c.shahafClassId === '36')!;
    theirs.exams = [{ naturalKey: 'site-exam|1', date: '2099-01-05', subject: 'י"ב מבחן באנגלית', details: null }];
    db.snapshots.push(
      { classId: theirs.id, kind: 'exam', naturalKey: 'shahaf-exam|english', payload: { date: '2099-01-05', subject: 'מבחן באנגלית שכבה יב', details: null }, deletedAt: null },
      { classId: theirs.id, kind: 'exam', naturalKey: 'shahaf-exam|history', payload: { date: '2099-01-06', subject: 'מבחן בהיסטוריה', details: null }, deletedAt: null },
    );

    // A device with no class of its own, reading a class another one follows.
    const friend = await register(app);
    // The parent, reading the class it follows besides its own.
    for (const token of [friend, parent]) {
      const body = (await feed(app, token, 'school-g.shahaf.site', '36')).json() as ClassFeed;
      expect(body.exams.map((e) => e.naturalKey).sort(), token).toEqual(['shahaf-exam|history', 'site-exam|1']);
      expect(body.siteTwins?.map((e) => e.naturalKey), token).toEqual(['shahaf-exam|english']);
    }
    // And its own class, which has no board: no key.
    const own = (await feed(app, parent, 'school-c.shahaf.site', '12144')).json() as ClassFeed;
    expect('siteTwins' in own).toBe(false);
  });

  it('reads the feed of a class another device follows', async () => {
    const { app, db } = world();
    const first = await register(app);
    expect((await follow(app, first, 'school-g.shahaf.site', '36')).statusCode).toBe(200);
    const lessons = db.classes.find((c) => c.shahafClassId === '36')!;
    db.snapshots.push({ classId: lessons.id, kind: 'exam', naturalKey: 'e1', payload: { date: '2099-01-05', subject: 'מבחן בתנ״ך', details: null }, deletedAt: null });

    // A device with no class of its own: a phone that has only a friend.
    const second = await register(app);
    const res = await feed(app, second, 'https://school-g.shahaf.site', '36');
    expect(res.statusCode).toBe(200);
    const body = res.json() as ClassFeed;
    expect(body.class).toMatchObject({ siteUrl: 'https://school-g.shahaf.site', classId: '36' });
    expect(body.exams.map((e) => e.subject)).toEqual(['מבחן בתנ״ך']);
    // Reading it does not make it the device's own class, nor a follow.
    expect(db.devices[1]!.classId).toBeNull();
    expect(db.follows).toEqual([]);
  });

  it('reads the class a parent follows besides its own, too', async () => {
    const { app, db } = world();
    const parent = await register(app);
    await follow(app, parent, 'school-c.shahaf.site', '12144');
    const put = await app.inject({
      method: 'PUT', url: '/v2/device/classes', headers: auth(parent), payload: { classes: [{ siteUrl: 'school-g.shahaf.site', classId: '36' }] },
    });
    expect(put.statusCode).toBe(200);
    expect(db.follows).toHaveLength(1);

    const other = await register(app);
    expect((await feed(app, other, 'school-g.shahaf.site', '36')).statusCode).toBe(200);
  });

  it('is still closed for a class nobody follows', async () => {
    const { app, db } = world();
    const first = await register(app);
    // A class nobody ever asked for.
    const unknown = await feed(app, first, 'school-g.shahaf.site', '36');
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().error).toBe('not_followed');

    // A class that was followed, and is not any more: its rows stay, and the feed does not open.
    await follow(app, first, 'school-g.shahaf.site', '36');
    const second = await register(app);
    expect((await feed(app, second, 'school-g.shahaf.site', '36')).statusCode).toBe(200);
    await follow(app, first, 'school-g.shahaf.site', '2');
    expect(db.classes.some((c) => c.shahafClassId === '36')).toBe(true);
    const gone = await feed(app, second, 'school-g.shahaf.site', '36');
    expect(gone.statusCode).toBe(409);
    expect(gone.json().error).toBe('not_followed');

    // The site is still checked first.
    expect((await feed(app, second, 'evil.example', '36')).statusCode).toBe(400);
  });

  it('answers a site or a class given twice as a bad request, not a failure', async () => {
    const { app } = world();
    const first = await register(app);
    await follow(app, first, 'school-g.shahaf.site', '36');
    const second = await register(app);
    for (const url of [
      '/v2/class/feed?site=school-g.shahaf.site&cls=36&cls=2',
      '/v2/class/feed?site=school-g.shahaf.site&site=school-c.shahaf.site&cls=36',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: auth(second) });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error, url).toBe('invalid_class');
    }
  });
});
