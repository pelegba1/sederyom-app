/**
 * The phone's `/v2/chat` calls (app/src/device/v2.ts, `chatServer`): only
 * `createCode` registers a device. Every other call uses the device the phone
 * has, or reports that there is none; and a 401 means the server forgot the
 * device, along with its chats, so the phone forgets the identity and does not
 * register a fresh device that has none (plan 2, Review Focus 4).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { chatServer, DEVICE_KEYS, storedIdentity, V2Error } = await import('../../app/src/device/v2');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

interface Call {
  method: string;
  path: string;
  token: string | null;
  body: unknown;
  hasContentType: boolean;
}

interface Refusal {
  status: number;
  error: string;
}

/**
 * A `/v2` that registers devices and answers the `/v2/chat` routes. `refuse`
 * makes one route answer with the server's refusal; `forget` loses every row.
 */
function fakeServer(refuse: Partial<Record<'codes' | 'snapshot' | 'cut', Refusal>> = {}) {
  const calls: Call[] = [];
  let registered = 0;
  const known = new Set<string>();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const failure = (r: Refusal) => json(r.status, { error: r.error, message: `${r.error} (english)` });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace(/^.*?(\/v2)/, '$1');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const auth = headers.authorization ?? null;
    const token = auth ? auth.slice('Bearer '.length) : null;
    calls.push({
      method: init.method ?? 'GET', path, token, body: typeof init.body === 'string' ? JSON.parse(init.body) : null, hasContentType: 'content-type' in headers,
    });
    if (init.method === 'POST' && path === '/v2/devices') {
      registered += 1;
      known.add(`t${registered}`);
      return json(201, { deviceId: `d${registered}`, token: `t${registered}` });
    }
    if (!token || !known.has(token)) return json(401, { error: 'unauthorized', message: 'missing or invalid device token' });
    if (path === '/v2/chat/codes') return refuse.codes ? failure(refuse.codes) : json(200, { code: 'K7QM-2XPA', expiresAt: '2026-11-05T08:10:00.000Z' });
    if (path === '/v2/chat/snapshot') return refuse.snapshot ? failure(refuse.snapshot) : json(200, { ok: true });
    if (path === '/v2/chat/status') return json(200, { chats: [], snapshotAt: null });
    if (path.startsWith('/v2/chat/clients/') && init.method === 'DELETE' && refuse.cut) return failure(refuse.cut);
    return json(200, { ok: true });
  }) as unknown as typeof fetch;
  return {
    calls,
    fetchImpl,
    forget: () => known.clear(),
    /** How many devices were registered in all, whatever has been cleared from `calls` since. */
    registrations: () => registered,
  };
}

const KEY = 'A'.repeat(43);

/** A phone that already has a device, which the server knows as `t1`. */
async function registeredPhone(server: ReturnType<typeof fakeServer>) {
  const kv = memoryKv();
  const chat = chatServer(kv, 'android', server.fetchImpl);
  await chat.createCode(KEY);
  server.calls.length = 0;
  return { kv, chat };
}

describe('createCode', () => {
  it('registers a device first on a phone without one, then asks for the code with K and the new token', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    const got = await chatServer(kv, 'android', server.fetchImpl).createCode(KEY);
    expect(got).toEqual({ code: 'K7QM-2XPA', expiresAt: '2026-11-05T08:10:00.000Z' });
    expect(server.calls.map((c) => [c.method, c.path, c.token, c.body])).toEqual([
      ['POST', '/v2/devices', null, { platform: 'android' }],
      ['POST', '/v2/chat/codes', 't1', { key: KEY }],
    ]);
    expect(storedIdentity(kv)).toEqual({ deviceId: 'd1', token: 't1' });
  });

  it('registers as the platform it is given', async () => {
    const server = fakeServer();
    await chatServer(memoryKv(), 'ios', server.fetchImpl).createCode(KEY);
    expect(server.calls[0]!.body).toEqual({ platform: 'ios' });
  });

  it('uses the device the phone has, without registering another', async () => {
    const server = fakeServer();
    const { chat } = await registeredPhone(server);
    await chat.createCode(KEY);
    expect(server.registrations()).toBe(1);
    expect(server.calls.map((c) => [c.method, c.path, c.token])).toEqual([['POST', '/v2/chat/codes', 't1']]);
  });

  it('throws the server\'s refusal with its code, for the phone to go by', async () => {
    const server = fakeServer({ codes: { status: 409, error: 'too_many' } });
    const err = await chatServer(memoryKv(), 'android', server.fetchImpl).createCode(KEY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect((err as InstanceType<typeof V2Error>).status).toBe(409);
    expect((err as InstanceType<typeof V2Error>).code).toBe('too_many');
  });

  it('registers again and retries once when the server forgot the device it had', async () => {
    const server = fakeServer();
    const { kv, chat } = await registeredPhone(server);
    server.forget();
    const got = await chat.createCode(KEY);
    expect(got.code).toBe('K7QM-2XPA');
    expect(server.registrations()).toBe(2);
    expect(storedIdentity(kv)?.token).toBe('t2');
    expect(server.calls.at(-1)).toMatchObject({ method: 'POST', path: '/v2/chat/codes', token: 't2', body: { key: KEY } });
  });
});

describe('a phone without a device', () => {
  it('makes no request at all, and says there is nothing', async () => {
    const kv = memoryKv();
    const server = fakeServer();
    const chat = chatServer(kv, 'android', server.fetchImpl);
    expect(await chat.status()).toBeNull();
    expect(await chat.putSnapshot('abc')).toBe('no_device');
    await expect(chat.approve('g1')).resolves.toBeUndefined();
    await expect(chat.cut('g1')).resolves.toBeUndefined();
    await expect(chat.cutAll()).resolves.toBeUndefined();
    expect(server.calls).toEqual([]);
    expect(storedIdentity(kv)).toBeNull();
  });
});

describe('a server that forgot the device (401)', () => {
  it('putSnapshot says no_device, forgets the identity, and registers nothing', async () => {
    const server = fakeServer();
    const { kv, chat } = await registeredPhone(server);
    server.forget();
    expect(await chat.putSnapshot('abc')).toBe('no_device');
    expect(server.calls.map((c) => [c.method, c.path])).toEqual([['PUT', '/v2/chat/snapshot']]);
    expect(server.registrations()).toBe(1);
    expect(storedIdentity(kv)).toBeNull();
    expect(kv.getString(DEVICE_KEYS.identity)).toBe('');
  });

  it('is the same for every other call: nothing registered, the identity forgotten', async () => {
    const calls: Array<[string, (chat: ReturnType<typeof chatServer>) => Promise<unknown>, unknown]> = [
      ['status', (chat) => chat.status(), null],
      ['approve', (chat) => chat.approve('g1'), undefined],
      ['cut', (chat) => chat.cut('g1'), undefined],
      ['cutAll', (chat) => chat.cutAll(), undefined],
    ];
    for (const [name, run, expected] of calls) {
      const server = fakeServer();
      const { kv, chat } = await registeredPhone(server);
      server.forget();
      expect(await run(chat), name).toBe(expected);
      expect(server.calls, name).toHaveLength(1);
      expect(server.registrations(), name).toBe(1);
      expect(storedIdentity(kv), name).toBeNull();
    }
  });
});

describe('the server\'s refusals', () => {
  it('throws no_chat from a snapshot put while no chat is linked', async () => {
    const server = fakeServer({ snapshot: { status: 409, error: 'no_chat' } });
    const { chat } = await registeredPhone(server);
    const err = await chat.putSnapshot('abc').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect((err as InstanceType<typeof V2Error>).status).toBe(409);
    expect((err as InstanceType<typeof V2Error>).code).toBe('no_chat');
  });

  it('throws too_large and invalid_snapshot as they come', async () => {
    for (const refusal of [{ status: 413, error: 'too_large' }, { status: 400, error: 'invalid_snapshot' }]) {
      const server = fakeServer({ snapshot: refusal });
      const { chat } = await registeredPhone(server);
      const err = await chat.putSnapshot('abc').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(V2Error);
      expect((err as InstanceType<typeof V2Error>).code).toBe(refusal.error);
    }
  });

  it('lets a cut that finds no such chat throw, for the caller to decide', async () => {
    const server = fakeServer({ cut: { status: 404, error: 'not_found' } });
    const { kv, chat } = await registeredPhone(server);
    const err = await chat.cut('g1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect((err as InstanceType<typeof V2Error>).status).toBe(404);
    expect((err as InstanceType<typeof V2Error>).code).toBe('not_found');
    // The device is still the phone's.
    expect(storedIdentity(kv)).not.toBeNull();
  });
});

describe('the routes', () => {
  it('uses these paths and methods, with the device\'s token', async () => {
    const server = fakeServer();
    const { chat } = await registeredPhone(server);

    expect(await chat.putSnapshot('cipher-text_1')).toBe('ok');
    expect(await chat.status()).toEqual({ chats: [], snapshotAt: null });
    await chat.approve('grant1');
    await chat.cut('grant1');
    await chat.cutAll();

    expect(server.calls.map((c) => [c.method, c.path, c.token, c.body])).toEqual([
      ['PUT', '/v2/chat/snapshot', 't1', { ciphertext: 'cipher-text_1' }],
      ['GET', '/v2/chat/status', 't1', null],
      ['POST', '/v2/chat/clients/grant1/approve', 't1', null],
      ['DELETE', '/v2/chat/clients/grant1', 't1', null],
      ['DELETE', '/v2/chat', 't1', null],
    ]);
  });

  it('sends a body (and its content type) only where there is one', async () => {
    const server = fakeServer();
    const { chat } = await registeredPhone(server);
    await chat.putSnapshot('x');
    await chat.status();
    await chat.approve('g');
    await chat.cut('g');
    await chat.cutAll();
    expect(server.calls.map((c) => c.hasContentType)).toEqual([true, false, false, false, false]);
  });

  it('passes a chat\'s id through encodeURIComponent', async () => {
    const server = fakeServer();
    const { chat } = await registeredPhone(server);
    await chat.approve('a/b c?d');
    await chat.cut('a/b c?d');
    expect(server.calls.map((c) => c.path)).toEqual([
      `/v2/chat/clients/${encodeURIComponent('a/b c?d')}/approve`,
      `/v2/chat/clients/${encodeURIComponent('a/b c?d')}`,
    ]);
  });
});
