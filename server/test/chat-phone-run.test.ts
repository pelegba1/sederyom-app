/**
 * What the chat page asks the phone for (app/src/chat/run.ts): the page's model
 * (`chatScreen`), a code for a new chat (`makeChatCode`), what is shared
 * (`setChatShares`), and the approvals and cuts. All of them one at a time with
 * the refresh's write; nothing at all in the demo or for a parent; K made only
 * when the phone has none, saved before the code is asked for, and forgotten
 * when no chat is left; and no failure ever says anything but a line of
 * `CHAT_COPY` or `DEMO_COPY`.
 *
 * The phone's natives are fakes, as in chat-phone-refresh.test.ts; the storage
 * is a Map, and `/v2` a stub that notes every call and keeps the chats the
 * device has.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SHARES, fromB64u, openChat, toB64u, type ChatLinkView, type ChatShares, type ChatSnapshot, type ChatStatusResponse, type CreateChatCodeResponse } from '@sederyom/shared';
import type { ChatState } from '../../app/src/chat/store';
import type { ChatScreenView } from '../../app/src/chat/view';

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
// The friends' step is not what is tried here (buddies-run.test.ts does that).
vi.mock('../../app/src/buddies/run', () => ({ refreshBuddies: () => Promise.resolve() }));

interface Call {
  method: string;
  path: string;
  token: string | null;
  body: Record<string, unknown> | null;
}

/** `/v2` as the phone sees it: the device's registration, its chats, their codes and the copy. */
const server = {
  calls: [] as Call[],
  /** The chats the device has; `status` shows them, a cut takes one away. */
  chats: [] as ChatLinkView[],
  snapshotAt: null as string | null,
  /** The status says the device is not known (a 401). */
  forgot: false,
  /** The status fails to arrive. */
  statusFails: false,
  /** What `POST /v2/chat/codes` says: a code, or a refusal as `{ status, error, message }`. */
  codes: 'ok' as 'ok' | { status: number; error: string; message: string },
  /** The expiry the next codes carry; `null`: `CODE_EXPIRES_AT`. */
  expiresAt: null as string | null,
  /** What a cut says. */
  cut: 'ok' as 'ok' | { status: number; error: string; message: string },
  /** Cutting all fails to arrive. */
  cutAllFails: false,
  /** What `chat.state` held, as saved, when each code was asked for. */
  keyAtCode: [] as Array<string | null>,
  /** Held until released, to see what waits for a write. */
  hold: null as Promise<void> | null,
  /** The put fails to arrive. */
  fail: false,
  /** The put is refused as `{ status, error, message }`; `null`: it is taken. */
  refuse: null as { status: number; error: string; message: string } | null,
};

vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  const path = url.replace(/^.*?(\/v2)/, '$1');
  const method = init.method ?? 'GET';
  const headers = (init.headers ?? {}) as Record<string, string>;
  const auth = headers.authorization ?? null;
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  server.calls.push({ method, path, token: auth ? auth.slice('Bearer '.length) : null, body });
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
  const unauthorized = () => json(401, { error: 'unauthorized', message: 'missing or invalid device token' });
  const refusal = (r: { status: number; error: string; message: string }) => json(r.status, { error: r.error, message: r.message });
  const known = auth === 'Bearer t1' || auth === 'Bearer t2';

  if (method === 'POST' && path === '/v2/devices') return json(201, { deviceId: 'd2', token: 't2' });
  if (!known) return unauthorized();
  if (method === 'POST' && path === '/v2/chat/codes') {
    const kept = h.map.get('chat.state');
    const state = typeof kept === 'string' ? (JSON.parse(kept) as { key?: string | null }) : null;
    server.keyAtCode.push(state?.key ?? null);
    if (server.codes !== 'ok') return refusal(server.codes);
    return json(200, { code: 'K7QM-2XPA', expiresAt: server.expiresAt ?? CODE_EXPIRES_AT } satisfies CreateChatCodeResponse);
  }
  if (method === 'GET' && path === '/v2/chat/status') {
    if (server.statusFails) throw new TypeError('Network request failed');
    if (server.forgot) return unauthorized();
    return json(200, { chats: server.chats, snapshotAt: server.snapshotAt } satisfies ChatStatusResponse);
  }
  if (method === 'PUT' && path === '/v2/chat/snapshot') {
    if (server.hold) await server.hold;
    if (server.fail) throw new TypeError('Network request failed');
    if (server.refuse) return refusal(server.refuse);
    return json(200, { ok: true });
  }
  const client = /^\/v2\/chat\/clients\/([^/]+)(\/approve)?$/.exec(path);
  if (client && method === 'DELETE') {
    if (server.cut !== 'ok') return refusal(server.cut);
    server.chats = server.chats.filter((c) => c.id !== client[1]);
    return json(200, { ok: true });
  }
  if (client && method === 'POST' && client[2]) {
    server.chats = server.chats.map((c) => (c.id === client[1] ? { ...c, approved: true } : c));
    return json(200, { ok: true });
  }
  if (method === 'DELETE' && path === '/v2/chat') {
    if (server.cutAllFails) throw new TypeError('Network request failed');
    server.chats = [];
    return json(200, { ok: true });
  }
  return json(404, { error: 'not_found', message: path });
});
afterAll(() => vi.unstubAllGlobals());

// Loaded by paths TypeScript does not follow, as chat-phone-refresh.test.ts does: the run reaches the native sign-in.
const APP = '../../app/src';
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ `${APP}/${path}`)) as T;

/** A plain school Thursday, 5.11.2026, 10:00 in Jerusalem. */
const NOW = new Date('2026-11-05T10:00:00+02:00');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const run = await load<{
  chatScreen: (now: Date) => Promise<ChatScreenView>;
  makeChatCode: () => Promise<CreateChatCodeResponse | 'full'>;
  setChatShares: (shares: ChatShares) => Promise<void>;
  approveChat: (id: string) => Promise<void>;
  cutChat: (id: string) => Promise<void>;
  cutAllChats: () => Promise<void>;
  refreshChat: () => Promise<void>;
}>('chat/run');
const { CHAT_COPY } = await load<typeof import('../../app/src/chat/copy')>('chat/copy');
const { CHAT_CODE_GRACE_MS, CHAT_KEYS, readChatState, saveChatState } = await load<typeof import('../../app/src/chat/store')>('chat/store');
const { DEMO_KEY, DEMO_COPY } = await load<typeof import('../../app/src/demo/mode')>('demo/mode');

const ME = { deviceId: 'd1', token: 't1' };
/** When the code the fake server makes expires: well after `NOW`. */
const CODE_EXPIRES_AT = '2026-11-05T15:40:00.000Z';
/** Two codes made a few minutes apart, both still good at `NOW` (08:00 UTC): the older one expires first. */
const OLDER_CODE_EXPIRES_AT = '2026-11-05T08:05:00.000Z';
const NEWER_CODE_EXPIRES_AT = '2026-11-05T08:09:00.000Z';
const KEY =toB64u(Uint8Array.from({ length: 32 }, (_v, i) => 100 + i));
const READ_AT = '2026-11-05T06:30:00.000Z';

const of = (method: string, path: string) => server.calls.filter((c) => c.method === method && c.path === path);
const puts = () => of('PUT', '/v2/chat/snapshot');
const stateText = (): string | undefined => h.storage.getString(CHAT_KEYS.state);
const chatLink = (id: string, over: Partial<ChatLinkView> = {}): ChatLinkView => ({
  id, name: 'ChatGPT', host: 'chatgpt.com', known: true, approved: true, createdAt: '2026-11-05T07:00:00.000Z', lastUsedAt: null, ...over,
});

interface Phone {
  linked?: boolean;
  device?: boolean;
  settings?: Record<string, unknown>;
  entities?: unknown[];
  state?: Partial<ChatState>;
}

/** A phone as a chat's student has it: a device, a class, a Mashov read, and (unless told otherwise) a chat linked with K. */
function phone(opts: Phone = {}) {
  const { linked = true, device = true, settings = { className: 'יא2' }, entities = [], state = {} } = opts;
  if (device) h.storage.set('device.identity', JSON.stringify(ME));
  h.storage.set('settings.user', JSON.stringify(settings));
  h.storage.set('mashov.read', JSON.stringify({ at: READ_AT, entities, counts: {} }));
  saveChatState(h.storage, { key: KEY, shares: DEFAULT_CHAT_SHARES, linked, lastHash: null, lastWrittenAt: null, codeExpiresAt: null, ...state });
}

const grade = (key: string) => ({
  source: 'mashov', kind: 'grade', naturalKey: `mashov-grade|${key}`,
  payload: { naturalKey: `mashov-grade|${key}`, date: '2026-10-20', subject: 'מתמטיקה', value: 90, valueText: null, weight: null, notes: 'מבחן', isExam: false },
});

/** The copy the phone put, opened with K. */
const sent = (n = 0): ChatSnapshot => openChat<ChatSnapshot>((puts()[n]!.body as { ciphertext: string }).ciphertext, fromB64u(KEY)!)!;

/** The error a call ends in, whatever it is. */
const errorOf = (call: Promise<unknown>): Promise<Error> =>
  call.then(
    () => {
      throw new Error('it was meant to fail');
    },
    (err: unknown) => err as Error,
  );

beforeEach(() => {
  h.map.clear();
  h.map.set('onboarded', true);
  server.calls = [];
  server.chats = [];
  server.snapshotAt = null;
  server.forgot = false;
  server.statusFails = false;
  server.codes = 'ok';
  server.expiresAt = null;
  server.cut = 'ok';
  server.cutAllFails = false;
  server.keyAtCode = [];
  server.hold = null;
  server.fail = false;
  server.refuse = null;
});

describe('a code for a new chat', () => {
  it('makes K when the phone has none, saves it before asking, and sends that same K', async () => {
    phone({ linked: false, device: false, state: { key: null } });
    const made = await run.makeChatCode();
    expect(made).toEqual({ code: 'K7QM-2XPA', expiresAt: CODE_EXPIRES_AT });
    // The first code is what registers the device.
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v2/devices', 'POST /v2/chat/codes']);
    const kept = readChatState(h.storage).key;
    expect(kept).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fromB64u(kept!)).toHaveLength(32);
    expect(server.keyAtCode).toEqual([kept]);
    expect(of('POST', '/v2/chat/codes')[0]!.body).toEqual({ key: kept });
    expect(of('POST', '/v2/chat/codes')[0]!.token).toBe('t2');
    // No chat has used it yet: nothing is written for it.
    expect(readChatState(h.storage).linked).toBe(false);
  });

  it('keeps when the code expires, once the server has made it (K was kept before)', async () => {
    phone({ linked: false, state: { key: null } });
    await run.makeChatCode();
    expect(readChatState(h.storage)).toMatchObject({ linked: false, codeExpiresAt: CODE_EXPIRES_AT });
    expect(readChatState(h.storage).key).not.toBeNull();
  });

  it('keeps no expiry for a code the server refused', async () => {
    phone({ linked: false, state: { key: null } });
    server.codes = { status: 500, error: 'internal', message: 'boom' };
    await errorOf(run.makeChatCode());
    expect(readChatState(h.storage).codeExpiresAt).toBeNull();
    server.chats = [chatLink('c1')];
    server.codes = { status: 409, error: 'too_many', message: 'full' };
    expect(await run.makeChatCode()).toBe('full');
    expect(readChatState(h.storage).codeExpiresAt).toBeNull();
  });

  it('uses the same K for the next code', async () => {
    phone({ linked: false, state: { key: null } });
    await run.makeChatCode();
    const first = readChatState(h.storage).key;
    await run.makeChatCode();
    expect(readChatState(h.storage).key).toBe(first);
    expect(of('POST', '/v2/chat/codes').map((c) => (c.body as { key: string }).key)).toEqual([first, first]);
  });

  it('keeps the K it has, whether or not it is linked, while a chat is left', async () => {
    phone({ linked: true });
    server.chats = [chatLink('c1')];
    await run.makeChatCode();
    expect(of('GET', '/v2/chat/status')).toHaveLength(1);
    expect(of('POST', '/v2/chat/codes')[0]!.body).toEqual({ key: KEY });
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });
  });

  it('starts over with a new K when the chats it was linked with are gone (spec 4.1)', async () => {
    phone({ linked: true, state: { lastHash: 'h', lastWrittenAt: NOW.toISOString() } });
    server.chats = [];
    await run.makeChatCode();
    const kept = readChatState(h.storage);
    expect(kept.key).not.toBeNull();
    expect(kept.key).not.toBe(KEY);
    expect(kept).toMatchObject({ linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: CODE_EXPIRES_AT });
    // The new one was saved before it was asked with.
    expect(server.keyAtCode).toEqual([kept.key]);
    expect(of('POST', '/v2/chat/codes')[0]!.body).toEqual({ key: kept.key });
  });

  it('starts over too when the server does not know the device any more', async () => {
    phone({ linked: true });
    server.forgot = true;
    await run.makeChatCode();
    const kept = readChatState(h.storage);
    expect(kept.key).not.toBe(KEY);
    expect(kept.linked).toBe(false);
    // The 401 made the phone forget its identity; the code registered a new device.
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/chat/status', 'POST /v2/devices', 'POST /v2/chat/codes']);
  });

  it('says "full" for a device that has all the chats it can', async () => {
    phone({ linked: true });
    server.chats = [chatLink('c1')];
    server.codes = { status: 409, error: 'too_many', message: 'the device has 5 chats' };
    expect(await run.makeChatCode()).toBe('full');
  });

  it('says one line for any other failure, never the server\'s words nor K', async () => {
    phone({ linked: false, state: { key: null } });
    server.codes = { status: 500, error: 'internal', message: 'boom with the key inside' };
    const err = await errorOf(run.makeChatCode());
    expect(err.message).toBe(CHAT_COPY.failed);
    const kept = readChatState(h.storage).key!;
    expect(`${err.message}${err.stack ?? ''}${JSON.stringify(err)}`).not.toContain(kept);
    // A refusal with another code is no "full" either.
    server.codes = { status: 400, error: 'invalid_key', message: 'key is not 32 bytes' };
    expect((await errorOf(run.makeChatCode())).message).toBe(CHAT_COPY.failed);
    // And the queue is not stuck on it.
    server.codes = 'ok';
    expect(await run.makeChatCode()).toMatchObject({ code: 'K7QM-2XPA' });
  });
});

describe('the page', () => {
  it('links the chat the first time the status shows one, and writes the copy once', async () => {
    phone({ linked: false });
    server.chats = [chatLink('c1', { lastUsedAt: '2026-11-05T09:50:00+02:00' })];
    server.snapshotAt = null;
    const view = await run.chatScreen(NOW);
    expect(view.chats.map((c) => [c.id, c.line])).toEqual([['c1', 'מחובר, השתמש לאחרונה היום 09:50']]);
    expect(view.canAdd).toBe(true);
    expect(readChatState(h.storage)).toMatchObject({ linked: true, key: KEY, lastWrittenAt: NOW.toISOString() });
    expect(puts()).toHaveLength(1);
    expect(sent().shares).toEqual(DEFAULT_CHAT_SHARES);
    // The same status again: nothing to link, nothing to write.
    await run.chatScreen(NOW);
    await run.chatScreen(NOW);
    expect(puts()).toHaveLength(1);
    expect(of('GET', '/v2/chat/status')).toHaveLength(3);
  });

  it('writes at once for a chat that came, though the copy had not changed', async () => {
    phone();
    await run.refreshChat();
    expect(puts()).toHaveLength(1);
    // Every chat was cut, and a new one came: the copy on the server went with the last chat.
    saveChatState(h.storage, { ...readChatState(h.storage), linked: false });
    server.chats = [chatLink('c1')];
    await run.chatScreen(NOW);
    expect(puts()).toHaveLength(2);
    expect(readChatState(h.storage).linked).toBe(true);
  });

  it('shows what the server says: the chats, when the copy was written, the shares', async () => {
    phone({ linked: true, state: { shares: { ...DEFAULT_CHAT_SHARES, grades: true } } });
    server.chats = [chatLink('c1'), chatLink('c2', { name: 'Mystery', host: 'example.dev', known: false, approved: false })];
    server.snapshotAt = '2026-11-05T09:40:00+02:00';
    const view = await run.chatScreen(NOW);
    expect(view.shares).toEqual({ ...DEFAULT_CHAT_SHARES, grades: true });
    expect(view.chats.map((c) => [c.id, c.needsApproval])).toEqual([['c1', false], ['c2', true]]);
    expect(view.updatedLine).toBe('המידע נשלח לאחרונה היום 09:40');
    // Already linked: nothing is written for looking.
    expect(puts()).toHaveLength(0);
  });

  it('forgets the link and K when no chat is left (Review Focus 3)', async () => {
    phone({ linked: true, state: { lastHash: 'h', lastWrittenAt: NOW.toISOString(), shares: { ...DEFAULT_CHAT_SHARES, grades: true } } });
    server.chats = [];
    const view = await run.chatScreen(NOW);
    expect(view.chats).toEqual([]);
    expect(readChatState(h.storage)).toEqual({ key: null, shares: { ...DEFAULT_CHAT_SHARES, grades: true }, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null });
    expect(puts()).toHaveLength(0);
    // The device is the phone's still.
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
  });

  it('forgets the link and K too when the server does not know the device', async () => {
    phone({ linked: true });
    server.forgot = true;
    const view = await run.chatScreen(NOW);
    expect(view).toEqual({ shares: DEFAULT_CHAT_SHARES, chats: [], canAdd: true, updatedLine: null });
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
    expect(of('POST', '/v2/devices')).toEqual([]);
  });

  it('has no chats for a phone with no device, and calls nothing', async () => {
    phone({ linked: true, device: false });
    const view = await run.chatScreen(NOW);
    expect(view.chats).toEqual([]);
    expect(server.calls).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
  });

  it('does not touch a K that has no chat yet, while the code is waiting for one', async () => {
    phone({ linked: false, state: { codeExpiresAt: CODE_EXPIRES_AT } });
    server.chats = [];
    const view = await run.chatScreen(NOW);
    expect(view.chats).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: false, codeExpiresAt: CODE_EXPIRES_AT });
    expect(server.calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('forgets a K whose code expired with no chat, so that the device is no longer held for it', async () => {
    phone({ linked: false, state: { codeExpiresAt: '2026-11-05T07:50:00.000Z' } });
    server.chats = [];
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
    // A code with no expiry kept, or the server not knowing the device, is no code waiting either.
    phone({ linked: false, state: { codeExpiresAt: null } });
    await run.chatScreen(NOW);
    expect(readChatState(h.storage).key).toBeNull();
    phone({ linked: false, state: { codeExpiresAt: CODE_EXPIRES_AT } });
    server.forgot = true;
    await run.chatScreen(NOW);
    expect(readChatState(h.storage).key).toBeNull();
  });

  it('keeps K and the code when the last chat is gone while a code made for another is still out', async () => {
    phone({ linked: true, state: { codeExpiresAt: CODE_EXPIRES_AT, lastHash: 'h', lastWrittenAt: NOW.toISOString() } });
    server.chats = [];
    await run.chatScreen(NOW);
    // Back to a code waiting: no link, nothing written, but the K the code carries is the phone's still.
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: false, codeExpiresAt: CODE_EXPIRES_AT, lastHash: null, lastWrittenAt: null });
    expect(puts()).toHaveLength(0);
    // The chat that code was for comes: linked, and exactly one copy, sealed with that same K.
    server.chats = [chatLink('c2')];
    await run.chatScreen(NOW);
    expect(puts()).toHaveLength(1);
    expect(sent().v).toBe(1);
    // The code that brought it is spent, but its expiry stays: it ages out on its own (`chatCodeLive`).
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true, codeExpiresAt: CODE_EXPIRES_AT });
  });

  it('forgets K when the last chat is gone and the code made after it has expired, or the device is gone', async () => {
    phone({ linked: true, state: { codeExpiresAt: '2026-11-05T07:50:00.000Z' } });
    server.chats = [];
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
    // The device took its codes with it: a live one is gone too.
    phone({ linked: true, state: { codeExpiresAt: CODE_EXPIRES_AT } });
    server.forgot = true;
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
  });

  it('keeps the code\'s expiry when its chat comes: it may be another code\'s, and it ages out on its own', async () => {
    phone({ linked: false, state: { codeExpiresAt: OLDER_CODE_EXPIRES_AT } });
    server.chats = [chatLink('c1')];
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true, codeExpiresAt: OLDER_CODE_EXPIRES_AT });
    // A chat cut right after its link keeps K while that code could still have been used ...
    await run.cutChat('c1');
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: false, codeExpiresAt: OLDER_CODE_EXPIRES_AT });
    // ... and K goes with the next look once the expiry and the grace past it are behind.
    await run.chatScreen(new Date(Date.parse(OLDER_CODE_EXPIRES_AT) + CHAT_CODE_GRACE_MS + 1));
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
  });

  it('does not link a chat the phone has no K for: it could never read the copy', async () => {
    phone({ linked: false, state: { key: null } });
    server.chats = [chatLink('c1'), chatLink('c2')];
    // A cut reads the status; the chat that is left is not linked, for there is no K to seal its copy with.
    await run.cutChat('c1');
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
    expect(puts()).toHaveLength(0);
  });

  it('asks nothing of the server when no code was ever made and no chat is linked (or K was forgotten)', async () => {
    phone({ linked: false, state: { key: null, shares: { ...DEFAULT_CHAT_SHARES, grades: true } } });
    const view = await run.chatScreen(NOW);
    expect(view).toEqual({ shares: { ...DEFAULT_CHAT_SHARES, grades: true }, chats: [], canAdd: true, updatedLine: null });
    expect(server.calls).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
  });

  it('says one line when the status does not arrive', async () => {
    phone({ linked: true });
    server.statusFails = true;
    expect((await errorOf(run.chatScreen(NOW))).message).toBe(CHAT_COPY.failed);
    // And nothing is forgotten for it.
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });
  });

  it('still shows the chats when the first write fails, and leaves the write to the next refresh', async () => {
    phone({ linked: false });
    server.chats = [chatLink('c1')];
    server.refuse = { status: 500, error: 'internal', message: `boom ${KEY}` };
    const view = await run.chatScreen(NOW);
    expect(view.chats).toHaveLength(1);
    expect(readChatState(h.storage)).toMatchObject({ linked: true, lastHash: null });
    server.refuse = null;
    await run.refreshChat();
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });
});

describe('what is shared', () => {
  it('is kept, and written at once when a chat is linked, with the new choice in the copy', async () => {
    phone({ entities: [grade('g1')] });
    await run.refreshChat();
    expect(puts()).toHaveLength(1);
    expect(sent(0).grades).toBeUndefined();

    const grades: ChatShares = { ...DEFAULT_CHAT_SHARES, grades: true };
    await run.setChatShares(grades);
    expect(readChatState(h.storage).shares).toEqual(grades);
    expect(puts()).toHaveLength(2);
    expect(sent(1).shares.grades).toBe(true);
    expect(sent(1).grades).toHaveLength(1);

    // Forced: the same choice again is written again.
    await run.setChatShares(grades);
    expect(puts()).toHaveLength(3);
  });

  it('is kept and not written while no chat is linked', async () => {
    phone({ linked: false });
    await run.setChatShares({ ...DEFAULT_CHAT_SHARES, messages: true });
    expect(readChatState(h.storage).shares).toEqual({ ...DEFAULT_CHAT_SHARES, messages: true });
    expect(server.calls).toEqual([]);
  });

  it('keeps only choices that are choices', async () => {
    phone({ linked: false });
    await run.setChatShares({ ...DEFAULT_CHAT_SHARES, grades: 'yes' as unknown as boolean, absences: true });
    expect(readChatState(h.storage).shares).toEqual({ ...DEFAULT_CHAT_SHARES, absences: true });
  });

  it('keeps the choice and says one line when the write fails', async () => {
    phone();
    server.refuse = { status: 500, error: 'internal', message: `boom ${KEY}` };
    const err = await errorOf(run.setChatShares({ ...DEFAULT_CHAT_SHARES, grades: true }));
    expect(err.message).toBe(CHAT_COPY.failed);
    expect(`${err.message}${err.stack ?? ''}`).not.toContain(KEY);
    expect(readChatState(h.storage).shares.grades).toBe(true);
    // The next refresh brings the copy up to date: the choice is part of what changed.
    server.refuse = null;
    await run.refreshChat();
    expect(puts()).toHaveLength(2);
    expect(sent(1).shares.grades).toBe(true);
  });

  it('says so when the copy with the new choice is too big', async () => {
    const homework = (text: string) => ({
      source: 'mashov', kind: 'homework', naturalKey: 'h1', payload: { naturalKey: 'h1', dueDate: '2026-11-06', dueExplicit: true, subject: 'מתמטיקה', text },
    });
    phone({ entities: [homework('א'.repeat(300_000))] });
    expect((await errorOf(run.setChatShares({ ...DEFAULT_CHAT_SHARES, grades: true }))).message).toBe(CHAT_COPY.tooLarge);
    expect(puts()).toHaveLength(0);
    expect(readChatState(h.storage).shares.grades).toBe(true);
  });
});

describe('approving and cutting', () => {
  it('approves a chat, and nothing else', async () => {
    phone();
    server.chats = [chatLink('c1', { known: false, approved: false, host: 'example.dev' })];
    await run.approveChat('c1');
    expect(of('POST', '/v2/chat/clients/c1/approve')).toHaveLength(1);
    expect(server.chats[0]!.approved).toBe(true);
    expect(puts()).toHaveLength(0);
  });

  it('cuts one chat and reads the status; the link goes with the last one (spec 4.1)', async () => {
    phone();
    server.chats = [chatLink('c1'), chatLink('c2')];
    await run.cutChat('c1');
    expect(of('DELETE', '/v2/chat/clients/c1')).toHaveLength(1);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /v2/chat/clients/c1', 'GET /v2/chat/status']);
    // One is left: still linked, same K.
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });

    await run.cutChat('c2');
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null });
  });

  it('keeps K for a second code when the old chat is cut before the code is used (Important 1)', async () => {
    phone();
    server.chats = [chatLink('c1')];
    // A second chat is added: K is reused, the code's expiry is kept, and the phone stays linked.
    await run.makeChatCode();
    expect(of('POST', '/v2/chat/codes')[0]!.body).toEqual({ key: KEY });
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true, codeExpiresAt: CODE_EXPIRES_AT });

    // The student cuts the old chat before typing the code.
    await run.cutChat('c1');
    expect(server.chats).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: false, codeExpiresAt: CODE_EXPIRES_AT, lastHash: null, lastWrittenAt: null });
    expect(puts()).toHaveLength(0);

    // Then the new chat connects with that code: its copy is sealed with the K the code carries.
    server.chats = [chatLink('c2')];
    await run.chatScreen(NOW);
    expect(puts()).toHaveLength(1);
    expect(sent().v).toBe(1);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });
  });

  it('keeps K for the newer code when the older code\'s chat is linked after it and then cut (final review)', async () => {
    // Code A was made and its chat has connected, unseen: K is kept, the link is off.
    phone({ linked: false, state: { codeExpiresAt: OLDER_CODE_EXPIRES_AT } });
    server.chats = [chatLink('cA')];
    // Code B is made: A's chat is linked first (and its copy written once), then B's expiry is kept.
    server.expiresAt = NEWER_CODE_EXPIRES_AT;
    await run.makeChatCode();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/chat/status', 'PUT /v2/chat/snapshot', 'POST /v2/chat/codes']);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true, codeExpiresAt: NEWER_CODE_EXPIRES_AT });
    // The page looks again, as it does after a code: it must not take B's expiry away.
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true, codeExpiresAt: NEWER_CODE_EXPIRES_AT });

    // The student cuts A before using B: K stays, for the chat that B's code will bring.
    await run.cutChat('cA');
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: false, codeExpiresAt: NEWER_CODE_EXPIRES_AT });

    // Chat B connects with B's code: linked with the same K, and its copy opens with it.
    server.chats = [chatLink('cB')];
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });
    expect(puts()).toHaveLength(2);
    expect(sent(1).v).toBe(1);
  });

  it('takes a chat that is already gone for cut, and reads the status all the same', async () => {
    phone();
    server.chats = [];
    server.cut = { status: 404, error: 'not_found', message: 'no such chat' };
    await run.cutChat('c1');
    expect(of('GET', '/v2/chat/status')).toHaveLength(1);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
  });

  it('says one line when a cut fails, and reads nothing after it', async () => {
    phone();
    server.chats = [chatLink('c1')];
    server.cut = { status: 500, error: 'internal', message: 'boom' };
    expect((await errorOf(run.cutChat('c1'))).message).toBe(CHAT_COPY.failed);
    expect(of('GET', '/v2/chat/status')).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });
  });

  it('is cut all the same when the status after it does not arrive; the next look settles the link', async () => {
    phone();
    server.chats = [chatLink('c1')];
    server.statusFails = true;
    await run.cutChat('c1');
    expect(server.chats).toEqual([]);
    expect(readChatState(h.storage).linked).toBe(true);
    server.statusFails = false;
    await run.chatScreen(NOW);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
  });

  it('cuts every chat in one call, and forgets the link', async () => {
    phone({ state: { lastHash: 'h', lastWrittenAt: NOW.toISOString(), shares: { ...DEFAULT_CHAT_SHARES, grades: true } } });
    server.chats = [chatLink('c1'), chatLink('c2')];
    await run.cutAllChats();
    expect(of('DELETE', '/v2/chat')).toHaveLength(1);
    expect(server.chats).toEqual([]);
    expect(readChatState(h.storage)).toEqual({ key: null, shares: { ...DEFAULT_CHAT_SHARES, grades: true }, linked: false, lastHash: null, lastWrittenAt: null, codeExpiresAt: null });
  });

  it('forgets a K that had no chat yet when everything is cut, and calls nothing for a phone with no device', async () => {
    phone({ linked: false, device: false });
    await run.cutAllChats();
    expect(server.calls).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
  });

  it('says one line when cutting all fails, and keeps the link', async () => {
    phone();
    server.chats = [chatLink('c1')];
    server.cutAllFails = true;
    expect((await errorOf(run.cutAllChats())).message).toBe(CHAT_COPY.failed);
    expect(readChatState(h.storage)).toMatchObject({ key: KEY, linked: true });
  });
});

describe('one at a time', () => {
  it('lets every change wait for the write on its way, and the write for the change', async () => {
    phone();
    server.chats = [chatLink('c1')];
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    const writing = run.refreshChat();
    const cutting = run.cutAllChats();
    const sharing = run.setChatShares({ ...DEFAULT_CHAT_SHARES, grades: true });
    const looking = run.chatScreen(NOW);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The first write is in the server's hands; nothing else has begun.
    expect(puts()).toHaveLength(1);
    expect(of('DELETE', '/v2/chat')).toEqual([]);
    expect(of('GET', '/v2/chat/status')).toEqual([]);
    server.hold = null;
    release();
    await Promise.all([writing, cutting, sharing, looking]);
    // In the order asked: the cut saw the write, the share that came after the cut found no chat linked, and the page found none.
    expect(of('DELETE', '/v2/chat')).toHaveLength(1);
    expect(puts()).toHaveLength(1);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false });
    expect(readChatState(h.storage).shares.grades).toBe(true);
  });
});

describe('in the demo', () => {
  beforeEach(() => {
    phone();
    h.map.set(DEMO_KEY, true);
  });

  it('shows an empty page and reaches nothing', async () => {
    const view = await run.chatScreen(NOW);
    expect(view).toEqual({ shares: DEFAULT_CHAT_SHARES, chats: [], canAdd: true, updatedLine: null });
    expect(server.calls).toEqual([]);
  });

  it('refuses every change with the demo\'s line, and reaches nothing', async () => {
    const before = stateText();
    const changes: Array<() => Promise<unknown>> = [
      () => run.makeChatCode(),
      () => run.setChatShares({ ...DEFAULT_CHAT_SHARES, grades: true }),
      () => run.approveChat('c1'),
      () => run.cutChat('c1'),
      () => run.cutAllChats(),
    ];
    for (const change of changes) expect((await errorOf(change())).message).toBe(DEMO_COPY.notSaved);
    expect(server.calls).toEqual([]);
    expect(stateText()).toBe(before);
  });
});

describe('for a parent (spec 1.2)', () => {
  beforeEach(() => {
    phone({ settings: { audience: 'parent', className: 'יא2' } });
    server.chats = [chatLink('c1')];
  });

  it('shows an empty page and reaches nothing', async () => {
    const before = stateText();
    expect(await run.chatScreen(NOW)).toEqual({ shares: DEFAULT_CHAT_SHARES, chats: [], canAdd: true, updatedLine: null });
    expect(server.calls).toEqual([]);
    expect(stateText()).toBe(before);
  });

  it('makes no refresh request', async () => {
    await run.refreshChat();
    expect(server.calls).toEqual([]);
  });

  it('asks for nothing and changes nothing', async () => {
    const before = stateText();
    expect((await errorOf(run.makeChatCode())).message).toBe(CHAT_COPY.failed);
    await run.setChatShares({ ...DEFAULT_CHAT_SHARES, grades: true });
    await run.approveChat('c1');
    await run.cutChat('c1');
    await run.cutAllChats();
    expect(server.calls).toEqual([]);
    expect(stateText()).toBe(before);
  });
});
