/**
 * The chat connection's refresh step on the phone (app/src/chat/run.ts,
 * `refreshChat`) and its place in `refreshLocalSources`: nothing at all in
 * the demo, for a parent, or while no chat is linked; otherwise the phone's
 * copy built from what it holds, sealed and put; one at a time; and no
 * failure ever says anything but the two Hebrew lines of `CHAT_COPY`.
 *
 * The phone's natives are fakes, as in buddies-run.test.ts; the storage is a
 * Map, and `/v2` a stub that notes every call.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_SNAPSHOT_JSON_MAX, DEFAULT_CHAT_SHARES, fromB64u, openChat, toB64u, type ChatShares, type ChatSnapshot } from '@sederyom/shared';
import type { ChatState } from '../../app/src/chat/store';

const h = vi.hoisted(() => {
  const map = new Map<string, string | boolean>();
  const storage = {
    getString: (k: string) => {
      const v = map.get(k);
      return typeof v === 'string' ? v : undefined;
    },
    getBoolean: (k: string) => {
      const v = map.get(k);
      return typeof v === 'boolean' ? v : undefined;
    },
    set: (k: string, v: string | boolean) => void map.set(k, v),
    remove: (k: string) => void map.delete(k),
    clearAll: () => map.clear(),
  };
  const nothing = () => Promise.resolve(null);
  return { map, storage, nothing };
});

vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }));
vi.mock('react-native-mmkv', () => ({ createMMKV: () => h.storage }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { EXPO_PUBLIC_SEDERYOM_API_URL: 'https://api.test' } } } }));
vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}), set: h.nothing, clearAll: h.nothing } }));
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: () => {}, hasPreviousSignIn: () => false, getCurrentUser: () => null, signIn: h.nothing, signInSilently: h.nothing,
    hasPlayServices: h.nothing, getTokens: h.nothing, clearCachedAccessToken: h.nothing, revokeAccess: h.nothing, signOut: h.nothing,
  },
  isCancelledResponse: () => false,
  isSuccessResponse: () => true,
}));
vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' }, scheduleNotificationAsync: h.nothing, cancelScheduledNotificationAsync: h.nothing,
  dismissNotificationAsync: h.nothing, getAllScheduledNotificationsAsync: async () => [], getPresentedNotificationsAsync: async () => [],
  cancelAllScheduledNotificationsAsync: h.nothing, dismissAllNotificationsAsync: h.nothing,
}));
vi.mock('expo-background-task', () => ({ BackgroundTaskStatus: { Available: 2 }, BackgroundTaskResult: { Success: 1 }, getStatusAsync: h.nothing, registerTaskAsync: h.nothing }));
vi.mock('expo-task-manager', () => ({ defineTask: () => {}, isTaskRegisteredAsync: h.nothing }));
vi.mock('../../app/src/widget/update', () => ({ requestWidgetUpdate: () => undefined }));
vi.mock('../../app/src/api/hooks', () => ({ refreshWidgetFeed: h.nothing }));
// The friends' step is not what is tried here (buddies-run.test.ts does that): it is the step before the chat's.
vi.mock('../../app/src/buddies/run', () => ({ refreshBuddies: () => Promise.resolve() }));
// The same function, watched: a phone with no chat linked builds nothing.
vi.mock('../../app/src/local/source', async (importOriginal) => {
  // Typed loosely, as `load` below: TypeScript is not to follow the run into the native sign-in.
  const real = await importOriginal<{ loadLocalSources: (...args: unknown[]) => unknown }>();
  return { ...real, loadLocalSources: vi.fn(real.loadLocalSources) };
});

interface Call {
  method: string;
  path: string;
  token: string | null;
  body: unknown;
}

/** `/v2` as the phone sees it: the chat copy's route, and whatever else answers "not found". */
const server = {
  calls: [] as Call[],
  /** Held until released, to see what waits for a write. */
  hold: null as Promise<void> | null,
  /** The put fails to arrive. */
  fail: false,
  /** The put is refused as `{ status, error, message }`; `null`: it is taken. */
  refuse: null as { status: number; error: string; message: string } | null,
  /** The chats the device has, for `GET /v2/chat/status`. */
  chats: [] as Array<{ id: string; name: string; host: string; known: boolean; approved: boolean; createdAt: string; lastUsedAt: string | null }>,
  /** The status says the server does not know the device (a 401). */
  forgot: false,
  /** The status fails to arrive. */
  statusFails: false,
};

vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  const path = url.replace(/^.*?(\/v2)/, '$1');
  const method = init.method ?? 'GET';
  const headers = (init.headers ?? {}) as Record<string, string>;
  const auth = headers.authorization ?? null;
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  server.calls.push({ method, path, token: auth ? auth.slice('Bearer '.length) : null, body });
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
  if (method === 'POST' && path === '/v2/devices') return json(201, { deviceId: 'd2', token: 't2' });
  if (method === 'GET' && path === '/v2/chat/status') {
    if (server.statusFails) throw new TypeError('Network request failed');
    if (server.forgot || auth !== 'Bearer t1') return json(401, { error: 'unauthorized', message: 'missing or invalid device token' });
    return json(200, { chats: server.chats, snapshotAt: null });
  }
  if (method === 'PUT' && path === '/v2/chat/snapshot') {
    if (server.hold) await server.hold;
    if (server.fail) throw new TypeError('Network request failed');
    if (auth !== 'Bearer t1') return json(401, { error: 'unauthorized', message: 'missing or invalid device token' });
    if (server.refuse) return json(server.refuse.status, { error: server.refuse.error, message: server.refuse.message });
    return json(200, { ok: true });
  }
  return json(404, { error: 'not_found', message: path });
});
afterAll(() => vi.unstubAllGlobals());

// Loaded by paths TypeScript does not follow, as buddies-run.test.ts does: the run reaches the native sign-in.
const APP = '../../app/src';
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ `${APP}/${path}`)) as T;

/** A plain school Wednesday, 4.11.2026, 10:00 in Jerusalem. */
const NOW = new Date('2026-11-04T10:00:00+02:00');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const run = await load<{ refreshChat: () => Promise<void> }>('chat/run');
const { CHAT_COPY } = await load<typeof import('../../app/src/chat/copy')>('chat/copy');
const { CHAT_KEYS, readChatState, saveChatState } = await load<typeof import('../../app/src/chat/store')>('chat/store');
const { DEMO_KEY } = await load<{ DEMO_KEY: string }>('demo/mode');
const { loadLocalSources } = await load<{ loadLocalSources: ReturnType<typeof vi.fn> }>('local/source');

const ME = { deviceId: 'd1', token: 't1' };
const KEY = toB64u(Uint8Array.from({ length: 32 }, (_v, i) => 100 + i));
const READ_AT = '2026-11-04T06:30:00.000Z';
const ALL: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };

const of = (method: string, path: string) => server.calls.filter((c) => c.method === method && c.path.startsWith(path));
const stateText = (): string | undefined => h.storage.getString(CHAT_KEYS.state);

interface Phone {
  linked?: boolean;
  device?: boolean;
  settings?: Record<string, unknown>;
  shares?: ChatShares;
  /** Mashov's read, as the phone keeps it. */
  entities?: unknown[];
  state?: Partial<ChatState>;
}

/** A phone as a chat's student has it: a device, a class, a Mashov read, and a chat linked with K. */
function phone(opts: Phone = {}) {
  const { linked = true, device = true, settings = { className: 'יא2' }, shares = DEFAULT_CHAT_SHARES, entities = [], state = {} } = opts;
  if (device) h.storage.set('device.identity', JSON.stringify(ME));
  h.storage.set('settings.user', JSON.stringify(settings));
  h.storage.set('mashov.read', JSON.stringify({ at: READ_AT, entities, counts: {} }));
  saveChatState(h.storage, { key: KEY, shares, linked, lastHash: null, lastWrittenAt: null, codeExpiresAt: null, ...state });
}

/** A chat the device has, as the status lists it. */
const chatLink = (id: string) => ({
  id, name: 'ChatGPT', host: 'chatgpt.com', known: true, approved: true, createdAt: '2026-11-04T07:00:00.000Z', lastUsedAt: null,
});

const message = (n: number) => ({
  source: 'mashov', kind: 'message', naturalKey: `msg|${n}`, payload: { naturalKey: `msg|${n}`, date: null, title: `הודעה ${n}`, body: 'בלי תאריך', from: 'המחנכת', bodyFor: 'x' },
});
const grade = (key: string) => ({
  source: 'mashov', kind: 'grade', naturalKey: `mashov-grade|${key}`,
  payload: { naturalKey: `mashov-grade|${key}`, date: '2026-10-20', subject: 'מתמטיקה', value: 90, valueText: null, weight: null, notes: 'מבחן', isExam: false },
});
const homework = (key: string, text: string) => ({
  source: 'mashov', kind: 'homework', naturalKey: key, payload: { naturalKey: key, dueDate: '2026-11-05', dueExplicit: true, subject: 'מתמטיקה', text },
});

/** The copy the phone put, opened with K. */
const sent = (n = 0): ChatSnapshot => openChat<ChatSnapshot>((of('PUT', '/v2/chat/snapshot')[n]!.body as { ciphertext: string }).ciphertext, fromB64u(KEY)!)!;

beforeEach(() => {
  h.map.clear();
  h.map.set('onboarded', true);
  server.calls = [];
  server.hold = null;
  server.fail = false;
  server.refuse = null;
  server.chats = [];
  server.forgot = false;
  server.statusFails = false;
  loadLocalSources.mockClear();
});

describe('the chat step of a refresh', () => {
  it('does nothing in the demo', async () => {
    phone();
    h.map.set(DEMO_KEY, true);
    const before = stateText();
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    expect(loadLocalSources).not.toHaveBeenCalled();
    expect(stateText()).toBe(before);
  });

  it('does nothing for a parent', async () => {
    phone({ settings: { audience: 'parent', className: 'יא2' } });
    const before = stateText();
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    expect(loadLocalSources).not.toHaveBeenCalled();
    expect(stateText()).toBe(before);
  });

  it('does nothing while no chat is linked and no code is waiting for one, and builds nothing', async () => {
    phone({ linked: false, state: { key: null } });
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    expect(loadLocalSources).not.toHaveBeenCalled();
    // No state at all, either.
    h.map.delete(CHAT_KEYS.state);
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    expect(loadLocalSources).not.toHaveBeenCalled();
  });

  it('puts the phone\'s copy, sealed with K, with what the student shares and the read it is of', async () => {
    phone({ shares: ALL, entities: [message(1), grade('g1')] });
    await run.refreshChat();
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
    // The phone's own device, and no registration: only the first code may make one.
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /v2/chat/snapshot']);
    expect(server.calls[0]!.token).toBe('t1');

    const snapshot = sent();
    expect(snapshot.v).toBe(1);
    expect(snapshot.shares).toEqual(ALL);
    // Of the last Mashov read, not of the clock; the class as the phone shows it; no school name kept on the phone.
    expect(snapshot.at).toBe(READ_AT);
    expect(snapshot.school).toEqual({ name: null, className: 'י״א 2' });
    expect(snapshot.days).toHaveLength(15);
    expect(snapshot.grades).toHaveLength(1);
    expect(snapshot.averages).toEqual([{ subject: 'מתמטיקה', average: 90 }]);
    // A message Mashov gave no date is dated by the read.
    expect(snapshot.messages!.map((m) => [m.title, m.date])).toEqual([['הודעה 1', READ_AT]]);
    expect(readChatState(h.storage)).toMatchObject({ linked: true, key: KEY, lastWrittenAt: NOW.toISOString() });
    expect(readChatState(h.storage).lastHash).toMatch(/^[0-9a-f]{128}$/);
  });

  it('writes only what is shared', async () => {
    phone({ entities: [message(1), grade('g1')] });
    await run.refreshChat();
    const snapshot = sent();
    expect(snapshot.shares).toEqual(DEFAULT_CHAT_SHARES);
    expect(snapshot.grades).toBeUndefined();
    expect(snapshot.averages).toBeUndefined();
    expect(snapshot.messages).toBeUndefined();
  });

  it('does not put an unchanged copy again', async () => {
    phone({ shares: ALL, entities: [message(1)] });
    await run.refreshChat();
    await run.refreshChat();
    // Another read of the same content: a later time, the same hash.
    h.map.set('mashov.read', JSON.stringify({ at: '2026-11-04T07:00:00.000Z', entities: [message(1)], counts: {} }));
    await run.refreshChat();
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
  });

  it('writes again when the copy changed', async () => {
    phone({ shares: ALL, entities: [message(1)] });
    await run.refreshChat();
    h.map.set('mashov.read', JSON.stringify({ at: '2026-11-04T07:00:00.000Z', entities: [message(1), grade('g1')], counts: {} }));
    await run.refreshChat();
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(2);
    expect(sent(1).grades).toHaveLength(1);
  });

  it('writes one at a time', async () => {
    phone();
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    const first = run.refreshChat();
    const second = run.refreshChat();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The first is in the server's hands; the second has not begun, so it has not built or put anything.
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
    expect(readChatState(h.storage).lastHash).toBeNull();
    release();
    await Promise.all([first, second]);
    // And it saw the first's write: nothing changed, so nothing was put again.
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });

  it('says a failure in Hebrew, never the server\'s words nor anything it was sent', async () => {
    phone({ shares: ALL, entities: [message(1)] });
    const before = stateText();
    server.refuse = { status: 500, error: 'internal', message: `boom ${KEY}` };
    const refused = await run.refreshChat().catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toBe(CHAT_COPY.failed);
    expect(JSON.stringify(refused)).not.toContain(KEY);
    expect((refused as Error).stack ?? '').not.toContain(KEY);

    server.refuse = null;
    server.fail = true;
    await expect(run.refreshChat()).rejects.toThrow(new Error(CHAT_COPY.failed));
    // Nothing was kept of the writes that failed.
    expect(stateText()).toBe(before);
    // And the queue is not stuck: the next one goes through.
    server.fail = false;
    await run.refreshChat();
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });

  it('puts nothing, and says so, when the copy is too big even cut down (Review Focus 5)', async () => {
    // Homework is not something the fit cuts, and a Hebrew letter is two bytes: 300,000 of them are 600,000.
    phone({ entities: [homework('h1', 'א'.repeat(300_000))] });
    const before = stateText();
    await expect(run.refreshChat()).rejects.toThrow(new Error(CHAT_COPY.tooLarge));
    expect(CHAT_SNAPSHOT_JSON_MAX).toBeLessThan(600_000);
    expect(server.calls).toEqual([]);
    expect(stateText()).toBe(before);
    // The step is not stuck on it: with the item gone, the next one writes.
    h.map.set('mashov.read', JSON.stringify({ at: READ_AT, entities: [], counts: {} }));
    await run.refreshChat();
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
  });

  it('forgets the link and K when the chat is gone, and writes nothing more (Review Focus 3)', async () => {
    phone({ shares: { ...DEFAULT_CHAT_SHARES, grades: true } });
    server.refuse = { status: 409, error: 'no_chat', message: 'no chat is linked' };
    await run.refreshChat();
    expect(readChatState(h.storage)).toEqual({ key: null, shares: { ...DEFAULT_CHAT_SHARES, grades: true }, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null });
    // The device is the phone's still: only the chat is gone.
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
    server.calls = [];
    await run.refreshChat();
    expect(server.calls).toEqual([]);
  });

  it('forgets the link when the server forgot the device, without registering a new one (Review Focus 4)', async () => {
    phone();
    h.map.set('device.identity', JSON.stringify({ deviceId: 'd9', token: 'stale' }));
    await run.refreshChat();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /v2/chat/snapshot']);
    expect(of('POST', '/v2/devices')).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ linked: false, key: null });
    expect(h.storage.getString('device.identity')).toBe('');
  });

  it('forgets the link of a phone that has no device, and calls nothing', async () => {
    phone({ device: false });
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ linked: false, key: null });
  });
});

/** Inside the code's ten minutes, and past them, against the clock of this file (`NOW`, 10:00 in Jerusalem). */
const LIVE = '2026-11-04T08:05:00.000Z';
const LAPSED = '2026-11-04T07:50:00.000Z';

describe('the chat step, while a code waits for its chat', () => {
  /** A phone that made a code (K saved, the code's expiry kept) and has no chat linked yet. */
  const pending = (codeExpiresAt: string | null = LIVE, over: Phone = {}) => phone({ linked: false, state: { codeExpiresAt }, ...over });

  it('links the chat that came and puts the copy once, whatever the hash', async () => {
    pending();
    server.chats = [chatLink('c1')];
    await run.refreshChat();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/chat/status', 'PUT /v2/chat/snapshot']);
    // The spent code's expiry stays: it may be another code's, and it ages out on its own (`chatCodeLive`).
    expect(readChatState(h.storage)).toMatchObject({ linked: true, key: KEY, codeExpiresAt: LIVE, lastWrittenAt: NOW.toISOString() });
    expect(sent().shares).toEqual(DEFAULT_CHAT_SHARES);
    // From here on it is a linked chat like any other: no more status calls, and an unchanged copy is not put again.
    await run.refreshChat();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/chat/status', 'PUT /v2/chat/snapshot']);
  });

  it('leaves the state as it is while the code can still be used and no chat has come', async () => {
    pending(LIVE);
    const before = stateText();
    await run.refreshChat();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/chat/status']);
    expect(stateText()).toBe(before);
    expect(loadLocalSources).not.toHaveBeenCalled();
  });

  it('forgets K when the code has expired and no chat came, so that the device may go', async () => {
    pending(LAPSED, { state: { codeExpiresAt: LAPSED, shares: { ...DEFAULT_CHAT_SHARES, grades: true } } });
    await run.refreshChat();
    expect(of('PUT', '/v2/chat/snapshot')).toEqual([]);
    expect(readChatState(h.storage)).toEqual({ key: null, shares: { ...DEFAULT_CHAT_SHARES, grades: true }, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null });
    // The device is the phone's still: it is the friends' step that lets an idle one go.
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
  });

  it('takes a code with no expiry, or one that does not read, for expired', async () => {
    for (const codeExpiresAt of [null, 'לא תאריך']) {
      pending(codeExpiresAt);
      await run.refreshChat();
      expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
    }
  });

  it('forgets K when the server does not know the device, whatever the code says', async () => {
    pending(LIVE);
    server.forgot = true;
    await run.refreshChat();
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
    expect(of('POST', '/v2/devices')).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe('');
  });

  it('forgets K when the phone has no device', async () => {
    pending(LIVE, { device: false });
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
  });

  it('lets a status that does not arrive go: nothing changes, nothing is said, and the next refresh asks again', async () => {
    pending(LIVE);
    const before = stateText();
    server.statusFails = true;
    await run.refreshChat();
    expect(stateText()).toBe(before);
    server.statusFails = false;
    server.chats = [chatLink('c1')];
    await run.refreshChat();
    expect(readChatState(h.storage).linked).toBe(true);
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
  });

  it('lets a first copy that does not arrive go: the phone is linked, and the next refresh puts it', async () => {
    pending(LIVE);
    server.chats = [chatLink('c1')];
    server.refuse = { status: 500, error: 'internal', message: `boom ${KEY}` };
    await run.refreshChat();
    expect(readChatState(h.storage)).toMatchObject({ linked: true, lastHash: null });
    server.refuse = null;
    await run.refreshChat();
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });

  it('asks nothing in the demo or for a parent', async () => {
    pending(LIVE, { settings: { audience: 'parent', className: 'יא2' } });
    server.chats = [chatLink('c1')];
    await run.refreshChat();
    expect(server.calls).toEqual([]);
    pending(LIVE);
    h.map.set(DEMO_KEY, true);
    await run.refreshChat();
    expect(server.calls).toEqual([]);
  });
});

describe('the refresh of the sources, with a chat linked', () => {
  it('puts the copy after the rest, and a failure is one problem that does not hold the refresh', async () => {
    const source = await load<{ refreshLocalSources: () => Promise<{ problems: string[] }> }>('local/source');
    phone();
    const { problems } = await source.refreshLocalSources();
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
    expect(problems.filter((p) => p.startsWith('צ׳אט'))).toEqual([]);

    server.calls = [];
    server.refuse = { status: 500, error: 'internal', message: 'boom' };
    phone({ shares: { ...DEFAULT_CHAT_SHARES, grades: true } });
    const failed = await source.refreshLocalSources();
    expect(failed.problems.filter((p) => p.startsWith('צ׳אט'))).toEqual([`צ׳אט: ${CHAT_COPY.failed}`]);
    expect(h.storage.getString('local.refreshedAt')).toBeTruthy();
  });

  it('goes on without it after 30 seconds and says so, and the step itself may still finish', async () => {
    const source = await load<{ refreshLocalSources: () => Promise<{ problems: string[] }>; CHAT_STEP_MS: number }>('local/source');
    expect(source.CHAT_STEP_MS).toBe(30_000);
    phone();
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    // The file fakes `Date` alone; installing the timers on top of that would change nothing, so start over.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    try {
      const refreshing = source.refreshLocalSources();
      let done = false;
      void refreshing.then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(29_000);
      expect(done).toBe(false);
      expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_000);
      const { problems } = await refreshing;
      expect(problems.filter((p) => p.startsWith('צ׳אט'))).toEqual([`צ׳אט: ${CHAT_COPY.failed}`]);
      expect(h.storage.getString('local.refreshedAt')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    }
    // The step was not stopped: once the server answers, it ends as it would have.
    release();
    await run.refreshChat();
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });
});
