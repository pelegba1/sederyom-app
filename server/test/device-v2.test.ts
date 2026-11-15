/**
 * The phone as a device on `/v2` (app/src/device/v2.ts, plan Phase 3): it has
 * a device on the server only while it follows a class. Following is the one
 * call that registers; the prefs, the push address, the device and its feed
 * are sent or read only for a device the phone already has, and a class list
 * is asked for without one.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@sederyom/shared';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  DEVICE_KEYS, devicePrefsFrom, followClass, keepPushAddress, listClasses, readDevice, refreshFeed, sendDeviceDetails, sendPushToken, setExamCalendar,
  storedIdentity, syncDevicePrefs, V2Error,
} = await import('../../app/src/device/v2');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

interface Call {
  method: string;
  path: string;
  token: string | null;
  body: unknown;
}

/** A `/v2` that registers devices, follows classes and answers the rest; `forget` makes it lose the device's row. */
function fakeServer() {
  const calls: Call[] = [];
  let registered = 0;
  const known = new Set<string>();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const device = (classId: string | null) => ({
    deviceId: `d${registered}`, platform: 'android', hasPushToken: false, prefs: {},
    class: classId ? { classId, className: 'יב2', siteUrl: 'https://school-g.shahaf.site', examCalendarId: null } : null,
  });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace(/^.*?(\/v2)/, '$1');
    const auth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
    const token = auth ? auth.slice('Bearer '.length) : null;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method: init.method ?? 'GET', path, token, body });
    if (init.method === 'POST' && path === '/v2/devices') {
      registered += 1;
      known.add(`t${registered}`);
      return json(201, { deviceId: `d${registered}`, token: `t${registered}` });
    }
    if (path.startsWith('/v2/classes')) return json(200, { siteUrl: 'https://school-g.shahaf.site', classes: [{ id: '7', name: 'יב2' }] });
    if (!token || !known.has(token)) return json(401, { error: 'unauthorized', message: 'missing or invalid device token' });
    if (path === '/v2/class/feed') return json(200, { class: device('7').class, lastOkAt: null, freshness: null, lessons: [], changes: [], exams: [], events: [], messages: [] });
    return json(200, device(body?.class?.classId ?? '7'));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, forget: () => known.clear(), registrations: () => calls.filter((c) => c.method === 'POST').length };
}

const settings = DEFAULT_SETTINGS;

describe('a phone that follows no class', () => {
  it('sends no prefs and no push address, and registers nothing', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    keepPushAddress(kv, 'ExponentPushToken[abc]');
    expect(await syncDevicePrefs(kv, settings, [], server.fetchImpl)).toBe(false);
    expect(await sendPushToken(kv, 'ExponentPushToken[abc]', server.fetchImpl)).toBe(false);
    await sendDeviceDetails(kv, settings, [], server.fetchImpl);
    expect(server.calls).toEqual([]);
    expect(storedIdentity(kv)).toBeNull();
    // Nothing marked as sent, so the follow sends them.
    expect(kv.getString(DEVICE_KEYS.prefsSent)).toBeUndefined();
    expect(kv.getString(DEVICE_KEYS.pushTokenSent)).toBeUndefined();
  });

  it('reads no device and no feed, and registers nothing', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    expect(await readDevice(kv, server.fetchImpl)).toBeNull();
    expect(await refreshFeed(kv, server.fetchImpl)).toBeNull();
    expect(kv.getString(DEVICE_KEYS.feed)).toBeUndefined();
    expect(server.calls).toEqual([]);
  });

  it('puts no exam calendar on a class it does not follow, in the words the link reads as "no class"', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    const err = await setExamCalendar(kv, 'school@group.calendar.google.com', server.fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect((err as Error).message).toMatch(/no class/i);
    expect(server.calls).toEqual([]);
  });

  it('lists a site\'s classes without registering', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    expect((await listClasses(kv, 'https://school-g.shahaf.site', server.fetchImpl)).classes).toHaveLength(1);
    expect(server.calls.map((c) => [c.method, c.path, c.token])).toEqual([['GET', '/v2/classes?site=https%3A%2F%2Fschool-g.shahaf.site', null]]);
    expect(storedIdentity(kv)).toBeNull();
  });
});

describe('following a class', () => {
  it('registers once, and then the prefs and the kept push address go to that device', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    keepPushAddress(kv, 'ExponentPushToken[abc]');
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    await sendDeviceDetails(kv, settings, [], server.fetchImpl);
    expect(server.calls.map((c) => [c.method, c.path, c.token])).toEqual([
      ['POST', '/v2/devices', null],
      ['PUT', '/v2/device', 't1'],
      ['PUT', '/v2/device', 't1'],
      ['PUT', '/v2/device', 't1'],
    ]);
    expect(server.calls[0]!.body).toEqual({ platform: 'android' });
    expect(server.calls[1]!.body).toEqual({ class: { siteUrl: 'https://school-g.shahaf.site', classId: '7' } });
    expect(server.calls[2]!.body).toMatchObject({ prefs: { vacationMode: settings.vacationMode } });
    expect(server.calls[3]!.body).toEqual({ pushToken: 'ExponentPushToken[abc]' });

    // Sent once: the next refresh sends nothing new.
    await sendDeviceDetails(kv, settings, [], server.fetchImpl);
    expect(server.calls).toHaveLength(4);
    // And the device now reads, with its token.
    expect((await readDevice(kv, server.fetchImpl))?.class?.classId).toBe('7');
    expect(server.registrations()).toBe(1);
  });

  it('sends the push address when it comes after the follow', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    await sendDeviceDetails(kv, settings, [], server.fetchImpl);
    expect(server.calls.some((c) => c.body && typeof c.body === 'object' && 'pushToken' in c.body)).toBe(false);
    expect(await sendPushToken(kv, 'ExponentPushToken[later]', server.fetchImpl)).toBe(true);
    expect(server.calls.at(-1)).toMatchObject({ token: 't1', body: { pushToken: 'ExponentPushToken[later]' } });
  });

  it('registers again when the server forgot the device, and sends what it had sent before', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    keepPushAddress(kv, 'ExponentPushToken[abc]');
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    await sendDeviceDetails(kv, settings, [], server.fetchImpl);
    server.forget();

    // Reading finds no device, forgets it, and registers nothing.
    expect(await readDevice(kv, server.fetchImpl)).toBeNull();
    expect(storedIdentity(kv)).toBeNull();
    expect(server.registrations()).toBe(1);
    // The refresh's follow registers again; the prefs and the address go to the new device.
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    await sendDeviceDetails(kv, settings, [], server.fetchImpl);
    expect(server.registrations()).toBe(2);
    expect(server.calls.slice(-2).map((c) => [c.token, Object.keys(c.body as object)[0]])).toEqual([['t2', 'prefs'], ['t2', 'pushToken']]);
  });

  it('a follow refused by a server that forgot the device registers anew and follows once more', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    server.forget();
    const device = await followClass(kv, 'android', 'https://school-g.shahaf.site', '8', server.fetchImpl);
    expect(device.class?.classId).toBe('8');
    expect(server.registrations()).toBe(2);
    expect(storedIdentity(kv)?.token).toBe('t2');
  });
});

describe("the names the phone sends for the device's pushes", () => {
  const MATH = 'subject:מתמטיקה';
  const LIT = 'subject:ספרות';
  const withNames = (subjectNames?: Record<string, string>) => ({ ...settings, lessons: { hiddenSubjects: [], ...(subjectNames ? { subjectNames } : {}) } });

  it("are the shown child's own when no other child shares its class", () => {
    expect(devicePrefsFrom(withNames({ [MATH]: 'חשבון', [LIT]: 'ספר' })).subjectNames).toEqual({ [MATH]: 'חשבון', [LIT]: 'ספר' });
    expect(devicePrefsFrom(withNames({ [MATH]: 'חשבון' }), []).subjectNames).toEqual({ [MATH]: 'חשבון' });
    // Settings from before names send none, and a map with none sends the empty one.
    expect(devicePrefsFrom(withNames()).subjectNames).toEqual({});
    expect(devicePrefsFrom(settings).subjectNames).toEqual({});
  });

  it('are only those a child in the same class gave alike', () => {
    const mine = withNames({ [MATH]: 'חשבון', [LIT]: 'ספר' });
    expect(devicePrefsFrom(mine, [{ [MATH]: 'חשבון', [LIT]: 'ספרות יפה' }]).subjectNames).toEqual({ [MATH]: 'חשבון' });
    // Two children in my class: what all of them gave alike.
    expect(devicePrefsFrom(mine, [{ [MATH]: 'חשבון', [LIT]: 'ספר' }, { [MATH]: 'חשבון' }]).subjectNames).toEqual({ [MATH]: 'חשבון' });
    expect(devicePrefsFrom(mine, [{ [MATH]: 'חשבון', [LIT]: 'ספר' }, {}]).subjectNames).toEqual({});
    // The shown child's own map is not changed by it.
    expect(mine.lessons.subjectNames).toEqual({ [MATH]: 'חשבון', [LIT]: 'ספר' });
  });

  it("go to the device with the prefs, and again when a sibling's name changed, never when nothing did", async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    const mine = withNames({ [MATH]: 'חשבון', [LIT]: 'ספר' });
    const sent = () => server.calls.filter((c) => c.method === 'PUT' && c.path === '/v2/device' && c.body && 'prefs' in (c.body as object));
    const names = () => sent().map((c) => (c.body as { prefs: { subjectNames: unknown } }).prefs.subjectNames);
    expect(await syncDevicePrefs(kv, mine, [{ [MATH]: 'חשבון' }], server.fetchImpl)).toBe(true);
    expect(names()).toEqual([{ [MATH]: 'חשבון' }]);
    expect(await syncDevicePrefs(kv, mine, [{ [MATH]: 'חשבון' }], server.fetchImpl)).toBe(false);
    // The sibling now names literature alike: the device gets it.
    expect(await syncDevicePrefs(kv, mine, [{ [MATH]: 'חשבון', [LIT]: 'ספר' }], server.fetchImpl)).toBe(true);
    expect(names()).toEqual([{ [MATH]: 'חשבון' }, { [MATH]: 'חשבון', [LIT]: 'ספר' }]);
    // Sibling-less, the shown child's names are the same as the last sent: nothing goes.
    expect(await syncDevicePrefs(kv, mine, [], server.fetchImpl)).toBe(false);
    expect(sent()).toHaveLength(2);
  });
});
