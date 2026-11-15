/**
 * The phone's device for friends (app/src/device/v2.ts): a device exists while
 * the phone follows a class or has a friend or a pending invite, so one can be
 * registered without a class (`asBuddyDevice`), dropped when nothing needs it
 * (`dropIdleDevice`), and a device without a class reads no feed rather than
 * failing (`refreshFeed`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  asBuddyDevice, buddyServer, DEVICE_KEYS, dropIdleDevice, followClass, keepPushAddress, listClasses, readFeedOf, refreshFeed, sendDeviceDetails, storedIdentity, V2Error,
} = await import('../../app/src/device/v2');
const { DEFAULT_SETTINGS } = await import('@sederyom/shared');

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

/**
 * A `/v2` for a device without a class: it registers, answers a feed with the
 * `409 no_class` the server gives (or `not_followed` for a class asked for that
 * nobody follows), and deletes the device on request; `forget` loses its row.
 */
function fakeServer(options: { feed?: { status: number; error: string } } = {}) {
  const calls: Call[] = [];
  let registered = 0;
  const known = new Set<string>();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace(/^.*?(\/v2)/, '$1');
    const auth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
    const token = auth ? auth.slice('Bearer '.length) : null;
    calls.push({ method: init.method ?? 'GET', path, token, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (init.method === 'POST' && path === '/v2/devices') {
      registered += 1;
      known.add(`t${registered}`);
      return json(201, { deviceId: `d${registered}`, token: `t${registered}` });
    }
    if (!token || !known.has(token)) return json(401, { error: 'unauthorized', message: 'missing or invalid device token' });
    if (init.method === 'DELETE' && path === '/v2/device') {
      known.delete(token);
      return json(200, { ok: true });
    }
    if (path.startsWith('/v2/class/feed')) {
      const refusal = options.feed ?? { status: 409, error: 'no_class' };
      return json(refusal.status, { error: refusal.error, message: 'עוד לא נבחרה כיתה.' });
    }
    return json(200, { deviceId: `d${registered}`, platform: 'android', hasPushToken: false, prefs: {}, class: null });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, forget: () => known.clear(), registrations: () => calls.filter((c) => c.method === 'POST').length };
}

describe('a device without a class', () => {
  it('reads no class as no feed', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => undefined);
    expect(await refreshFeed(kv, server.fetchImpl)).toBeNull();
    expect(server.calls.at(-1)).toMatchObject({ method: 'GET', path: '/v2/class/feed', token: 't1' });
    // Nothing kept: there is no feed.
    expect(kv.getString(DEVICE_KEYS.feed)).toBeUndefined();
    // And the device stays.
    expect(storedIdentity(kv)).toEqual({ deviceId: 'd1', token: 't1' });
  });

  it('still fails on any other refusal of the feed', async () => {
    for (const refusal of [{ status: 409, error: 'not_followed' }, { status: 500, error: 'internal' }]) {
      const kv = memoryKv();
      const server = fakeServer({ feed: refusal });
      await asBuddyDevice(kv, 'android', server.fetchImpl, async () => undefined);
      const err = await refreshFeed(kv, server.fetchImpl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(V2Error);
      expect((err as InstanceType<typeof V2Error>).status).toBe(refusal.status);
      expect((err as InstanceType<typeof V2Error>).code).toBe(refusal.error);
    }
  });

  it('leaves the feed of another class (readFeedOf) as it was: a refusal still throws', async () => {
    const kv = memoryKv();
    const server = fakeServer({ feed: { status: 409, error: 'not_followed' } });
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => undefined);
    const err = await readFeedOf(kv, 'https://school-g.shahaf.site', '7', server.fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect((err as InstanceType<typeof V2Error>).status).toBe(409);
  });

  it('registers without a class for buddies, and drops the device when idle', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    const seen: string[] = [];
    const got = await asBuddyDevice(kv, 'android', server.fetchImpl, async (token) => {
      seen.push(token);
      return 'done';
    });
    expect(got).toBe('done');
    expect(seen).toEqual(['t1']);
    expect(server.calls.map((c) => [c.method, c.path, c.token])).toEqual([['POST', '/v2/devices', null]]);
    expect(server.calls[0]!.body).toEqual({ platform: 'android' });
    expect(storedIdentity(kv)).toEqual({ deviceId: 'd1', token: 't1' });
    expect(kv.getString(DEVICE_KEYS.identity)).toBe(JSON.stringify({ deviceId: 'd1', token: 't1' }));

    // Not idle (a friend, a pending invite or a class): nothing is sent, the device stays.
    expect(await dropIdleDevice(kv, false, server.fetchImpl)).toBe(false);
    expect(server.calls).toHaveLength(1);
    expect(storedIdentity(kv)).not.toBeNull();

    // Idle: the row is deleted on the server and the identity forgotten.
    expect(await dropIdleDevice(kv, true, server.fetchImpl)).toBe(true);
    expect(server.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v2/device', token: 't1' });
    expect(server.calls).toHaveLength(2);
    expect(kv.getString(DEVICE_KEYS.identity)).toBe('');
    expect(storedIdentity(kv)).toBeNull();

    // Nothing left to drop: no call, and no registration just to delete.
    expect(await dropIdleDevice(kv, true, server.fetchImpl)).toBe(false);
    expect(server.calls).toHaveLength(2);
  });

  it('registers once for several calls, and again after the server forgot the device', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => 1);
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => 2);
    expect(server.registrations()).toBe(1);

    server.forget();
    // A 401 from the call: the identity is forgotten, a new device registers, the call runs once more.
    const tokens: string[] = [];
    const out = await asBuddyDevice(kv, 'android', server.fetchImpl, async (token) => {
      tokens.push(token);
      if (token === 't1') throw new V2Error(401, 'missing or invalid device token');
      return 'again';
    });
    expect(out).toBe('again');
    expect(tokens).toEqual(['t1', 't2']);
    expect(server.registrations()).toBe(2);
    expect(storedIdentity(kv)?.token).toBe('t2');
  });

  it('drops a device the server no longer knows without failing, and forgets what was sent to it', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    keepPushAddress(kv, 'ExponentPushToken[abc]');
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => undefined);
    await sendDeviceDetails(kv, DEFAULT_SETTINGS, [], server.fetchImpl);
    expect(kv.getString(DEVICE_KEYS.prefsSent)).toBeTruthy();
    expect(kv.getString(DEVICE_KEYS.pushTokenSent)).toBeTruthy();

    server.forget();
    expect(await dropIdleDevice(kv, true, server.fetchImpl)).toBe(true);
    expect(storedIdentity(kv)).toBeNull();
    expect(kv.getString(DEVICE_KEYS.prefsSent)).toBe('');
    expect(kv.getString(DEVICE_KEYS.pushTokenSent)).toBe('');
    // The push address the phone keeps stays, for the next device.
    expect(kv.getString(DEVICE_KEYS.pushAddress)).toBe('ExponentPushToken[abc]');
  });

  it('keeps the device when the server cannot be reached, to try again later', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => undefined);
    const down = (async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })) as unknown as typeof fetch;
    await expect(dropIdleDevice(kv, true, down)).rejects.toBeInstanceOf(V2Error);
    expect(storedIdentity(kv)).toEqual({ deviceId: 'd1', token: 't1' });
  });

  it('registers one device when a friend\'s call and following a class race on a phone that has none', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    // Both start before either registration answers.
    const [box, follow] = await Promise.all([
      asBuddyDevice(kv, 'android', server.fetchImpl, async (token) => token),
      followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl),
    ]);
    expect(server.registrations()).toBe(1);
    expect(box).toBe('t1');
    expect(follow).toMatchObject({ deviceId: 'd1' });
    expect(storedIdentity(kv)).toEqual({ deviceId: 'd1', token: 't1' });

    // Once that registration is done, another phone's store is a phone of its own.
    const other = memoryKv();
    await asBuddyDevice(other, 'android', server.fetchImpl, async () => undefined);
    expect(server.registrations()).toBe(2);
    expect(storedIdentity(other)?.token).toBe('t2');
  });

  it('lets a later call register again when a registration failed', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    let down = true;
    const flaky = (async (url: string, init: RequestInit) => {
      if (down) throw new TypeError('Network request failed');
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    await expect(Promise.all([
      asBuddyDevice(kv, 'android', flaky, async () => undefined),
      asBuddyDevice(kv, 'android', flaky, async () => undefined),
    ])).rejects.toThrow('Network request failed');
    down = false;
    await asBuddyDevice(kv, 'android', flaky, async () => undefined);
    expect(server.registrations()).toBe(1);
    expect(storedIdentity(kv)?.token).toBe('t1');
  });

  it('still follows a class on the same device a friend registered', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    await asBuddyDevice(kv, 'android', server.fetchImpl, async () => undefined);
    await followClass(kv, 'android', 'https://school-g.shahaf.site', '7', server.fetchImpl);
    expect(server.registrations()).toBe(1);
    expect(server.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/v2/device', token: 't1' });
  });
});

describe('a call that never answers', () => {
  it("fails after 20 seconds, so a friend's call does not hold every call behind it", async () => {
    vi.useFakeTimers();
    try {
      const kv = memoryKv();
      kv.set(DEVICE_KEYS.identity, JSON.stringify({ deviceId: 'd1', token: 't1' }));
      // A line that takes the request and never answers, until the phone gives up on it.
      const hung = ((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        })) as unknown as typeof fetch;
      let failed = false;
      buddyServer(kv, 'android', hung).read(['x'.repeat(43)]).catch(() => {
        failed = true;
      });
      await vi.advanceTimersByTimeAsync(19_999);
      expect(failed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(failed).toBe(true);
      // Nothing about the device is lost: the next call goes through the same one.
      expect(storedIdentity(kv)).toEqual({ deviceId: 'd1', token: 't1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits up to two minutes for the calls that make the server read the school's site", async () => {
    vi.useFakeTimers();
    try {
      const kv = memoryKv();
      // The site answers the server after a minute; the server then answers the phone.
      const slow = ((_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response(JSON.stringify({ siteUrl: 'https://school-g.shahaf.site', classes: [] }), { status: 200 })), 60_000);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })) as unknown as typeof fetch;
      let listed: unknown = null;
      void listClasses(kv, 'https://school-g.shahaf.site', slow).then((list) => {
        listed = list;
      }, () => {
        listed = 'failed';
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(listed).toEqual({ siteUrl: 'https://school-g.shahaf.site', classes: [] });

      const hung = ((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        })) as unknown as typeof fetch;
      let failed = false;
      listClasses(kv, 'https://school-g.shahaf.site', hung).catch(() => {
        failed = true;
      });
      await vi.advanceTimersByTimeAsync(119_999);
      expect(failed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(failed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
