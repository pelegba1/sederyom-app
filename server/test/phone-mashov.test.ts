/**
 * Mashov read by the phone (app/src/mashov, plan Phase 2c), run here because
 * it builds on the shared read. The phone's cookie module is native, so it is
 * stubbed; the jar is injected instead.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';

vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { judgeAnswer, phoneMashovApi } = await import('../../app/src/mashov/phone');
const { syncMashov, carriedMessages, localRead, localStatus, localBagrut, KEYS } = await import('../../app/src/mashov/sync');

const ZONE = 'Asia/Jerusalem';
const NOW = new Date('2026-10-19T13:00:00Z');
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const JAR = { MashovAuthToken: jwt({ UserId: 'u-1', Semel: '123456', iat: 1, exp: 2 }), 'Csrf-Token': 'csrf-9' };

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

/** A Mashov that answers lists, counting what it was asked. */
function fakeApi(over: Partial<Record<string, (...args: any[]) => Promise<unknown>>> = {}) {
  const asked: string[] = [];
  const answer = (name: string, value: unknown) => async (...args: unknown[]) => {
    asked.push(name);
    return over[name] ? over[name]!(...args) : value;
  };
  const api = {
    timetable: answer('timetable', [{ day: 1, lesson: 2, groupId: 7 }]),
    homework: answer('homework', []),
    grades: answer('grades', []),
    behave: answer('behave', []),
    lessonsCount: answer('lessonsCount', []),
    groups: answer('groups', [{ groupId: 7, subjectName: 'אנגלית', groupTeachers: [{ teacherName: 'שרון' }] }]),
    bells: answer('bells', [{ lessonNumber: 2, startTime: '08:50', endTime: '09:35' }]),
    mail: answer('mail', []),
    conversation: async () => ({}),
    bagrutGrades: answer('bagrutGrades', []),
    bagrutSheelonim: answer('bagrutSheelonim', []),
  } as unknown as MashovApi;
  return { api, asked };
}

describe('the phone\'s Mashov client', () => {
  it('judges an answer the way the server does', () => {
    expect(judgeAnswer('/x', 200, '[1]')).toEqual([1]);
    expect(() => judgeAnswer('/x', 401, '')).toThrow(expect.objectContaining({ needsReauth: true }));
    expect(() => judgeAnswer('/x', 200, '<!doctype html><html>login')).toThrow(expect.objectContaining({ needsReauth: true }));
    const server = (() => { try { judgeAnswer('/x', 500, ''); } catch (e) { return e as { needsReauth?: boolean }; } })();
    expect(server?.needsReauth).toBeUndefined();
  });

  it('refuses to read without a login', async () => {
    await expect(phoneMashovApi(fetch, async () => ({}))).rejects.toMatchObject({ needsReauth: true });
  });

  it('lets the jar send the cookies, and sends the CSRF token itself', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    const api = await phoneMashovApi(fetchImpl, async () => JAR);
    await api.groups();
    expect(calls[0]!.url).toBe('https://web.mashov.info/api/students/u-1/groups');
    expect(calls[0]!.init.credentials).toBe('include');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('csrf-9');
    expect(headers.cookie).toBeUndefined();
  });
});

describe('syncMashov', () => {
  it('reads, keeps the read, and does not read again within ten minutes unless asked', async () => {
    const kv = memoryKv();
    const { api, asked } = fakeApi();
    const first = await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW });
    expect(first.kind).toBe('ok');
    expect(localRead(kv)?.entities.filter((e) => e.kind === 'timetable_slot')).toHaveLength(1);
    expect(localStatus(kv)).toMatchObject({ lastOkAt: NOW.toISOString(), needsLogin: false });

    const soon = new Date(NOW.getTime() + 5 * 60_000);
    expect((await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => soon })).kind).toBe('skipped');
    expect((await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => soon }, { force: true })).kind).toBe('ok');
    // Bagrut once a day: the forced read the same day did not ask again.
    expect(asked.filter((a) => a === 'bagrutGrades')).toHaveLength(1);
    expect(localBagrut(kv)?.readAt).toBe(NOW.toISOString());
  });

  it('reads 30 conversations from two pages', async () => {
    const kv = memoryKv();
    const all = Array.from({ length: 30 }, (_, i) => ({
      conversationId: `c${i}`,
      subject: `הודעה ${i}`,
      sendTime: new Date(Date.UTC(2026, 9, 18, 12) - i * 3_600_000).toISOString().slice(0, 19),
    }));
    // The first read passes no skip: page one.
    const { api } = fakeApi({ mail: async (skip = 0) => all.slice(skip, skip + 20) });
    expect((await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW })).kind).toBe('ok');
    const read = localRead(kv)!;
    expect(read.entities.filter((e) => e.kind === 'message')).toHaveLength(30);
    expect(read.counts).toMatchObject({ mail: 30, mailPages: 2 });
  });

  it('keeps the older messages when a later inbox page fails, and drops them once Mashov does', async () => {
    const kv = memoryKv();
    const all = Array.from({ length: 30 }, (_, i) => ({
      conversationId: `c${i}`,
      subject: `הודעה ${i}`,
      sendTime: new Date(Date.UTC(2026, 9, 18, 12) - i * 3_600_000).toISOString().slice(0, 19),
    }));
    const messages = () => localRead(kv)!.entities.filter((e) => e.kind === 'message');
    const run = async (api: MashovApi, minutes: number) =>
      syncMashov({ kv, api: async () => api, zone: ZONE, now: () => new Date(NOW.getTime() + minutes * 60_000) }, { force: true });

    await run(fakeApi({ mail: async (skip = 0) => all.slice(skip, skip + 20) }).api, 0);
    expect(messages()).toHaveLength(30);

    // The second page fails: the ten messages on it stay, though this read did not see them.
    const failing = fakeApi({ mail: async (skip = 0) => { if (skip > 0) throw new Error('Mashov returned 500'); return all.slice(0, 20); } });
    await run(failing.api, 15);
    expect(messages()).toHaveLength(30);
    expect(localRead(kv)!.counts).toMatchObject({ mail: 20, mailPages: 1 });

    // Mashov answers whole and has only 25 now: the five it dropped are gone.
    await run(fakeApi({ mail: async (skip = 0) => all.slice(0, 25).slice(skip, skip + 20) }).api, 30);
    expect(messages()).toHaveLength(25);
  });

  it('carries only the dated messages older than what the read got', () => {
    const message = (key: string, date: string | null) => ({ source: 'mashov', kind: 'message', naturalKey: key, payload: { date } }) as never;
    const old = message('old', '2026-09-01T10:00:00+03:00');
    const current = [message('new', '2026-10-20T09:00:00+03:00'), message('undated', null)];
    expect(carriedMessages([old, message('older-undated', null), message('new', '2026-10-20T09:00:00+03:00')], current)).toEqual([old]);
    // Nothing dated in the read: there is no telling what lies past it.
    expect(carriedMessages([old], [message('undated', null)])).toEqual([]);
  });

  it('does not ask for bagrut for a middle-school class', async () => {
    const kv = memoryKv();
    const { api, asked } = fakeApi();
    expect((await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW }, { bagrut: false })).kind).toBe('ok');
    expect(asked.filter((a) => a.startsWith('bagrut'))).toEqual([]);
    expect(localBagrut(kv)).toBeNull();
  });

  it('marks "needs login" on a refused session, and keeps the last good read', async () => {
    const kv = memoryKv();
    const { api } = fakeApi();
    await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW });
    const later = new Date(NOW.getTime() + 3 * 3600_000);
    const refused = fakeApi({ timetable: async () => { throw Object.assign(new Error('Mashov returned 401'), { needsReauth: true }); } });
    const out = await syncMashov({ kv, api: async () => refused.api, zone: ZONE, now: () => later });
    expect(out.kind).toBe('needs-login');
    expect(localStatus(kv)).toMatchObject({ needsLogin: true, lastOkAt: NOW.toISOString(), lastTriedAt: later.toISOString() });
    expect(localRead(kv)?.at).toBe(NOW.toISOString());
  });

  it('keeps when the login was, and when the outage began until a good read ends it', async () => {
    const kv = memoryKv();
    const { api } = fakeApi();
    const loginAt = async () => '2026-10-22T05:47:00.000Z';
    await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW, loginAt });
    expect(localStatus(kv)).toMatchObject({ loginAt: '2026-10-22T05:47:00.000Z', failedAt: null });

    const refused = fakeApi({ timetable: async () => { throw Object.assign(new Error('Mashov returned 401'), { needsReauth: true }); } });
    const first = new Date(NOW.getTime() + 8 * 3600_000);
    const again = new Date(first.getTime() + 3600_000);
    await syncMashov({ kv, api: async () => refused.api, zone: ZONE, now: () => first });
    await syncMashov({ kv, api: async () => refused.api, zone: ZONE, now: () => again });
    // The outage began at the first refusal, not the latest one.
    expect(localStatus(kv)).toMatchObject({ needsLogin: true, failedAt: first.toISOString(), loginAt: '2026-10-22T05:47:00.000Z' });

    const relogin = async () => '2026-10-22T15:00:00.000Z';
    await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => new Date(again.getTime() + 3600_000), loginAt: relogin });
    expect(localStatus(kv)).toMatchObject({ needsLogin: false, failedAt: null, loginAt: '2026-10-22T15:00:00.000Z' });
  });

  describe('a refused session the phone can renew by itself', () => {
    const refusal = async () => { throw Object.assign(new Error('Mashov returned 401'), { needsReauth: true }); };
    const later = new Date(NOW.getTime() + 3 * 3600_000);

    async function readOnce() {
      const kv = memoryKv();
      const { api } = fakeApi();
      await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW });
      return { kv, api };
    }

    it('says nothing while the renewal runs, and one that works leaves no outage behind', async () => {
      const { kv, api } = await readOnce();
      let current = fakeApi({ timetable: refusal }).api;
      let during: unknown = null;
      let refused: unknown = null;
      const out = await syncMashov({
        kv,
        api: async () => current,
        zone: ZONE,
        now: () => later,
        renew: async (status) => {
          during = localStatus(kv);
          refused = status;
          current = api;
          return true;
        },
      });
      expect(out.kind).toBe('ok');
      // What every screen reads: the seconds of the renewal must not say "needs login".
      expect(during).toMatchObject({ needsLogin: false, lastTriedAt: NOW.toISOString() });
      // What the renewal is told: the outage as it would be kept.
      expect(refused).toMatchObject({ needsLogin: true, failedAt: later.toISOString(), lastTriedAt: later.toISOString() });
      expect(localStatus(kv)).toMatchObject({ needsLogin: false, failedAt: null, lastError: null, lastOkAt: later.toISOString() });
    });

    it('keeps the outage when there is no new session, or the renewal breaks', async () => {
      for (const renew of [async () => false, async () => { throw new Error('no network'); }]) {
        const { kv } = await readOnce();
        const refused = fakeApi({ timetable: refusal });
        const out = await syncMashov({ kv, api: async () => refused.api, zone: ZONE, now: () => later, renew });
        expect(out.kind).toBe('needs-login');
        expect(localStatus(kv)).toMatchObject({ needsLogin: true, failedAt: later.toISOString(), lastTriedAt: later.toISOString() });
      }
    });

    it('renews once: a new session Mashov refuses too is an outage, not another try', async () => {
      const { kv } = await readOnce();
      const refused = fakeApi({ timetable: refusal });
      let tries = 0;
      const out = await syncMashov({
        kv, api: async () => refused.api, zone: ZONE, now: () => later, renew: async () => { tries += 1; return true; },
      });
      expect(tries).toBe(1);
      expect(out.kind).toBe('needs-login');
      expect(localStatus(kv)).toMatchObject({ needsLogin: true, failedAt: later.toISOString() });
    });

    it('never tries on a read that failed for another reason', async () => {
      const { kv } = await readOnce();
      const down = fakeApi({ timetable: async () => { throw new Error('Mashov returned 503'); } });
      let tries = 0;
      const out = await syncMashov({
        kv, api: async () => down.api, zone: ZONE, now: () => later, renew: async () => { tries += 1; return true; },
      });
      expect(tries).toBe(0);
      expect(out.kind).toBe('failed');
      expect(localStatus(kv)).toMatchObject({ needsLogin: false, lastError: 'Mashov returned 503' });
    });
  });

  it('never fails a read over attendance or bagrut', async () => {
    const kv = memoryKv();
    const { api } = fakeApi({
      behave: async () => ({ not: 'a list' }),
      bagrutGrades: async () => { throw new Error('bagrut down'); },
    });
    const out = await syncMashov({ kv, api: async () => api, zone: ZONE, now: () => NOW });
    expect(out.kind).toBe('ok');
    expect(localBagrut(kv)).toMatchObject({ readAt: null, failedAt: NOW.toISOString() });
    expect(kv.map.has(KEYS.read)).toBe(true);
  });
});
