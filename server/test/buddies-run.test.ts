/**
 * Friends on the phone (app/src/buddies/run.ts): the refresh step that keeps
 * the boxes in step and reads each friend's class once, the device dropped
 * when nothing needs it, one operation at a time, nothing for a parent or in
 * the demo, and no protocol message ever reaching a screen. Grades: my box
 * built from what the phone holds, the switches (off deletes the box at once,
 * the button turns it on and refreshes), and the dot.
 *
 * The phone's natives are fakes, as in demo-guards.test.ts; the storage is a
 * Map, and `/v2` a stub that notes every call.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuddyBoxContent, BuddyGradesContent } from '@sederyom/shared';
import { fromB64u, openChat } from '@sederyom/shared';
import { addDays, todayStr } from '@sederyom/shared/logic/time';
import type { Buddy } from '../../app/src/buddies/store';
import type { BuddyGrades } from '../../app/src/buddies/view';

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
// The same functions, watched: a phone with no friend builds no days for the friends' models.
vi.mock('../../app/src/local/source', async (importOriginal) => {
  // Typed loosely, as `load` below: TypeScript is not to follow the run into the native sign-in.
  const real = await importOriginal<{ loadLocalSources: (...args: unknown[]) => unknown }>();
  return { ...real, loadLocalSources: vi.fn(real.loadLocalSources) };
});
vi.mock('../../app/src/local/days', async (importOriginal) => {
  const real = await importOriginal<{ buildLocalDays: (...args: unknown[]) => unknown }>();
  return { ...real, buildLocalDays: vi.fn(real.buildLocalDays) };
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** `/v2` as the phone sees it: registration, the boxes (none of the friends' has come), each class's feed, the chat's copy, and the device's deletion. */
const server = {
  calls: [] as Call[],
  /** Held until released, to see what waits for a write. */
  hold: null as Promise<void> | null,
  fail: false,
  /** Boxes the server holds before the run starts (an invite another phone wrote), by id; every other box reads as not there. */
  boxes: new Map<string, string>(),
  /** The chats the device has, for `GET /v2/chat/status`. */
  chats: [] as Array<{ id: string; name: string; host: string; known: boolean; approved: boolean; createdAt: string; lastUsedAt: string | null }>,
};

vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  const path = url.replace(/^.*?(\/v2)/, '$1');
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  server.calls.push({ method, path, body });
  if (server.fail) throw new TypeError('Network request failed');
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
  if (method === 'POST' && path === '/v2/devices') return json(201, { deviceId: 'd1', token: 't1' });
  if (method === 'PUT' && path === '/v2/buddies/boxes') {
    if (server.hold) await server.hold;
    return json(200, { results: (body!.boxes as { id: string }[]).map((b) => ({ id: b.id, ok: true })) });
  }
  if (method === 'POST' && path === '/v2/buddies/read') {
    return json(200, { boxes: (body!.ids as string[]).map((id) => ({ id, ciphertext: server.boxes.get(id) ?? null, updatedAt: null })) });
  }
  if (method === 'GET' && path === '/v2/chat/status') return json(200, { chats: server.chats, snapshotAt: null });
  if (method === 'PUT' && path === '/v2/chat/snapshot') return json(200, { ok: true });
  if (method === 'DELETE') return json(200, { ok: true });
  if (method === 'GET' && path.startsWith('/v2/class/feed')) {
    const q = new URL(`https://x${path}`).searchParams;
    return json(200, {
      class: { siteUrl: q.get('site'), classId: q.get('cls'), className: 'יא3', examCalendarId: null },
      lastOkAt: '2026-11-03T06:00:00.000Z', freshness: null, lessons: [], changes: [], exams: [], events: [], messages: [],
    });
  }
  return json(404, { error: 'not_found', message: path });
});
afterAll(() => vi.unstubAllGlobals());

// Loaded by paths TypeScript does not follow, as demo-guards.test.ts does: the run reaches the native sign-in.
const APP = '../../app/src';
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ `${APP}/${path}`)) as T;

type Shares = { timetable: boolean; absences: boolean; grades?: boolean; bagrut?: boolean };
const run = await load<{
  refreshBuddies: () => Promise<void>;
  removeBuddyNow: (id: string) => Promise<void>;
  checkBuddyInvite: (secret: string) => Promise<unknown>;
  createBuddyInvite: (shares: Shares) => Promise<string | 'full'>;
  acceptBuddyInvite: (secret: string, shares: Shares) => Promise<string>;
  cancelBuddyInvites: () => Promise<void>;
  setBuddyShares: (id: string, shares: Shares) => Promise<void>;
  turnOnBuddyGrades: (id: string, which: 'grades' | 'bagrut') => Promise<void>;
  markBuddyGradesSeen: (id: string) => Promise<void>;
  myHasBagrut: () => boolean;
  setMyBuddyName: (name: string) => Promise<boolean>;
  renameBuddy: (id: string, label: string) => Promise<boolean>;
  buddiesView: (now: Date) => { rows: { name: string; line: string }[] };
  buddyTodayLines: (date: string, now: Date) => { text: string; buddyId: string }[];
  buddyPage: (id: string, date: string | undefined, now: Date) => { grades: BuddyGrades } | null;
}>('buddies/run');
const { BUDDY_COPY, buddyNames } = await load<typeof import('../../app/src/buddies/copy')>('buddies/copy');
const { DEMO_COPY } = await load<{ DEMO_COPY: { notSaved: string } }>('demo/mode');
const { buddyFeedKey, readBuddies, saveBuddies } = await load<typeof import('../../app/src/buddies/store')>('buddies/store');
const { forgetChatLink, newChatKey, readChatState, saveChatState } = await load<typeof import('../../app/src/chat/store')>('chat/store');
const { boxIdOf, keyOf, newKeyPair, newSecret, openSealed, seal } = await load<typeof import('../../app/src/buddies/crypto')>('buddies/crypto');
const { loadLocalSources } = await load<{ loadLocalSources: ReturnType<typeof vi.fn> }>('local/source');
const { buildLocalDays } = await load<{ buildLocalDays: ReturnType<typeof vi.fn> }>('local/days');

const SITE = 'https://school-g.shahaf.site';
const ME = { deviceId: 'd1', token: 't1' };

function mate(id: string, classId: string | null, everRead = false): Buddy {
  const theirs = {
    v: 1 as const, at: '2026-11-03T06:00:00.000Z', name: id, shares: { timetable: classId !== null, absences: false },
    ...(classId ? { timetable: { siteUrl: SITE, classId, className: 'יא3', hiddenSubjects: [], exams: [] } } : {}),
  };
  return {
    id, role: 'inviter' as const, secret: newSecret(), name: id, label: '', shares: { timetable: true, absences: true },
    // Added just now: one whose box was never read is waited for a week and a day, then ends (R25).
    theirs, readAt: theirs.at, everRead, written: null, theirGrades: null, gradesWritten: null, gradesDot: false, addedAt: new Date().toISOString(),
  };
}

function phone(buddies: Buddy[], opts: { device?: boolean; settings?: Record<string, unknown> } = {}) {
  saveBuddies(h.storage, { myName: 'פלג', buddies, invites: [], answers: [], unseen: false, notes: [] });
  if (opts.device !== false) h.storage.set('device.identity', JSON.stringify(ME));
  if (opts.settings) h.storage.set('settings.user', JSON.stringify(opts.settings));
}

/** A chat linked on the phone: K made and the link on, as the first code leaves them. */
function linkChat(): void {
  saveChatState(h.storage, { ...readChatState(h.storage), key: newChatKey(), linked: true });
}

/** A code made and no chat yet: K is kept and the link is off, the code good until `expiresAt` (as `makeChatCode` leaves them). */
function pendingCode(expiresAt: string | null = new Date(Date.now() + 600_000).toISOString()): void {
  saveChatState(h.storage, { ...readChatState(h.storage), key: newChatKey(), linked: false, codeExpiresAt: expiresAt });
}

const of = (method: string, path: string) => server.calls.filter((c) => c.method === method && c.path.startsWith(path));

beforeEach(() => {
  h.map.clear();
  h.map.set('onboarded', true);
  server.calls = [];
  server.chats = [];
  server.hold = null;
  server.fail = false;
  server.boxes.clear();
});

describe('the refresh step', () => {
  it('reads each friend class once', async () => {
    phone([mate('a', 'c1'), mate('b', 'c1'), mate('c', 'c2'), mate('d', null)]);
    await run.refreshBuddies();
    const reads = of('GET', '/v2/class/feed').map((c) => new URL(`https://x${c.path}`).searchParams.get('cls'));
    expect(reads).toEqual(['c1', 'c2']);
    expect(JSON.parse(h.storage.getString(buddyFeedKey(SITE, 'c2'))!).class.classId).toBe('c2');
    // My boxes for the four of them in one write, their four boxes in one read.
    expect(of('PUT', '/v2/buddies/boxes').map((c) => (c.body as { boxes: unknown[] }).boxes.length)).toEqual([4]);
    expect(of('POST', '/v2/buddies/read').map((c) => (c.body as { ids: unknown[] }).ids.length)).toEqual([4]);
  });

  it('drops the device when the last friend goes and there is no class', async () => {
    // The friend's box was read before and is gone now: they ended it.
    phone([mate('a', 'c1', true)]);
    await run.refreshBuddies();
    expect(readBuddies(h.storage).buddies).toEqual([]);
    expect(of('DELETE', '/v2/device')).toHaveLength(1);
    expect(h.storage.getString('device.identity')).toBe('');

    // And when I end it with the last one.
    server.calls = [];
    phone([mate('a', 'c1', true)]);
    await run.removeBuddyNow('a');
    expect(of('DELETE', '/v2/buddies/boxes')).toHaveLength(1);
    expect(of('DELETE', '/v2/device')).toHaveLength(1);
  });

  it('keeps the device while the phone follows a class, or a friend is left', async () => {
    phone([mate('a', 'c1', true)], { settings: { classId: '12' } });
    await run.refreshBuddies();
    expect(of('DELETE', '/v2/device')).toEqual([]);

    phone([mate('a', 'c1'), mate('b', 'c1')], { settings: {} });
    await run.removeBuddyNow('a');
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(readBuddies(h.storage).buddies.map((b) => b.id)).toEqual(['b']);
  });

  it('keeps the device while a chat is linked: its deletion would delete the chat with it', async () => {
    // No class, no friend, no invite: only the chat needs the device.
    phone([], { settings: {} });
    linkChat();
    await run.refreshBuddies();
    expect(server.calls).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
    expect(readChatState(h.storage).linked).toBe(true);

    // The same phone once the chat is cut (the link and K forgotten) is idle again, and drops the device as before.
    saveChatState(h.storage, forgetChatLink(readChatState(h.storage)));
    await run.refreshBuddies();
    expect(of('DELETE', '/v2/device')).toHaveLength(1);
    expect(h.storage.getString('device.identity')).toBe('');
  });

  it('keeps the device while a code waits for its chat, and lets it go with K once nothing waits', async () => {
    // No class, no friend, no invite; a code made (K kept) and the link not on yet.
    phone([], { settings: {} });
    pendingCode();
    await run.refreshBuddies();
    expect(server.calls).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));

    // The same phone with no K (no code was made, or it was forgotten) is idle, and drops the device as before.
    saveChatState(h.storage, forgetChatLink(readChatState(h.storage)));
    await run.refreshBuddies();
    expect(of('DELETE', '/v2/device')).toHaveLength(1);
    expect(h.storage.getString('device.identity')).toBe('');
  });

  it('keeps the device when the last friend goes while a code waits for its chat', async () => {
    phone([mate('a', 'c1', true)], { settings: {} });
    pendingCode();
    await run.refreshBuddies();
    expect(readBuddies(h.storage).buddies).toEqual([]);
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
  });

  it('keeps the device when the last friend goes, or the last invite is withdrawn, while a chat is linked', async () => {
    // The friend's box was read before and is gone now: they ended it.
    phone([mate('a', 'c1', true)], { settings: {} });
    linkChat();
    await run.refreshBuddies();
    expect(readBuddies(h.storage).buddies).toEqual([]);
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));

    // And when I end it with the last one.
    server.calls = [];
    phone([mate('b', 'c1', true)], { settings: {} });
    linkChat();
    await run.removeBuddyNow('b');
    expect(of('DELETE', '/v2/buddies/boxes')).toHaveLength(1);
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));

    // And when I withdraw the last invite.
    server.calls = [];
    phone([], { settings: {} });
    linkChat();
    await run.createBuddyInvite({ timetable: true, absences: true });
    await run.cancelBuddyInvites();
    expect(readBuddies(h.storage).invites).toEqual([]);
    expect(of('DELETE', '/v2/buddies/boxes')).toHaveLength(1);
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
  });

  it('does nothing for a parent, and nothing with no friend but drops an idle device', async () => {
    phone([mate('a', 'c1')], { settings: { audience: 'parent' } });
    await run.refreshBuddies();
    expect(server.calls).toEqual([]);

    phone([], { settings: {} });
    await run.refreshBuddies();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /v2/device']);
  });

  it('says a failure in Hebrew, never the protocol\'s words', async () => {
    phone([mate('a', 'c1')]);
    server.fail = true;
    await expect(run.refreshBuddies()).rejects.toThrow(BUDDY_COPY.failed);
    await expect(run.createBuddyInvite({ timetable: true, absences: true })).rejects.toThrow(BUDDY_COPY.failed);
  });
});

describe('one operation at a time', () => {
  it('lets a remove wait for the write before it', async () => {
    phone([mate('a', 'c1'), mate('b', 'c1')]);
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    const refreshing = run.refreshBuddies();
    const removing = run.removeBuddyNow('a');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(of('DELETE', '/v2/buddies/boxes')).toEqual([]);
    release();
    await Promise.all([refreshing, removing]);
    const order = server.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('DELETE /v2/buddies/boxes')).toBeGreaterThan(order.indexOf('PUT /v2/buddies/boxes'));
  });

  it('withdraws the invites nobody answered, and lets the device go when nothing else needs it', async () => {
    phone([], { device: false, settings: {} });
    await run.createBuddyInvite({ timetable: true, absences: true });
    await run.createBuddyInvite({ timetable: true, absences: false });
    server.calls = [];
    await run.cancelBuddyInvites();
    expect(of('DELETE', '/v2/buddies/boxes').map((c) => (c.body as { ids: unknown[] }).ids.length)).toEqual([2]);
    expect(readBuddies(h.storage).invites).toEqual([]);
    expect(of('DELETE', '/v2/device')).toHaveLength(1);
  });

  it('knows my own link without asking the server', async () => {
    phone([]);
    const secret = await run.createBuddyInvite({ timetable: true, absences: false });
    server.calls = [];
    expect(await run.checkBuddyInvite(secret)).toBe('own');
    expect(server.calls).toEqual([]);
  });
});

describe('a name typed on this phone', () => {
  const rlm = String.fromCharCode(0x200f);

  it('is saved without the marks a paste brought along, rather than refused', async () => {
    phone([mate('a', 'c1')]);
    expect(await run.setMyBuddyName(`${rlm}נועה\nכהן${rlm}`)).toBe(true);
    expect(readBuddies(h.storage).myName).toBe('נועה כהן');
    expect(await run.renameBuddy('a', `${rlm}שירה`)).toBe(true);
    expect(readBuddies(h.storage).buddies[0]!.label).toBe('שירה');
  });

  it('goes back to theirs when only marks were typed for a friend, and is refused as my own', async () => {
    phone([mate('a', 'c1')]);
    await run.renameBuddy('a', 'שירה');
    expect(await run.renameBuddy('a', ` ${rlm} `)).toBe(true);
    expect(readBuddies(h.storage).buddies[0]!.label).toBe('');
    expect(await run.setMyBuddyName(`${rlm} `)).toBe(false);
    expect(readBuddies(h.storage).myName).toBe('פלג');
  });
});

describe('the refresh, when the friends step never answers', () => {
  it('goes on without it after 45 seconds and says so, and the step itself may still finish', async () => {
    const source = await load<{ refreshLocalSources: () => Promise<{ problems: string[] }> }>('local/source');
    phone([mate('a', 'c1')]);
    // The write of my boxes reaches a server that never answers.
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const refreshing = source.refreshLocalSources();
      let done = false;
      void refreshing.then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(44_000);
      expect(done).toBe(false);
      expect(of('PUT', '/v2/buddies/boxes')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_000);
      const { problems } = await refreshing;
      expect(problems.filter((p) => p.startsWith('חברים'))).toEqual([`חברים: ${BUDDY_COPY.failed}`]);
      expect(problems.find((p) => p.startsWith('חברים'))).toMatch(/^חברים: לא הצלחנו להתחבר/);
      expect(h.storage.getString('local.refreshedAt')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
    // The step was not stopped: once the server answers, it ends as it would have, and the queue moves on.
    release();
    await run.refreshBuddies();
    expect(readBuddies(h.storage).buddies[0]!.written).not.toBeNull();
  });
});

describe('the refresh, on a phone with a chat linked and nothing else', () => {
  it('leaves the device, and the chat step puts its copy after the friends\' step', async () => {
    const source = await load<{ refreshLocalSources: () => Promise<{ problems: string[] }> }>('local/source');
    // No class, no friend, no invite; a chat linked, and Mashov read.
    phone([], { settings: { className: 'יא2' } });
    h.storage.set('mashov.read', JSON.stringify({ at: '2026-11-03T06:00:00.000Z', entities: [], counts: {} }));
    linkChat();
    const { problems } = await source.refreshLocalSources();
    expect(problems.filter((p) => p.startsWith('חברים') || p.startsWith('צ׳אט'))).toEqual([]);
    // The friends' step left the device; the chat step then put its copy with it, and registered nothing.
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(of('POST', '/v2/devices')).toEqual([]);
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
    expect(readChatState(h.storage)).toMatchObject({ linked: true });
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });
});

describe('the refresh, on a phone whose code is waiting for a chat and nothing else', () => {
  const source = () => load<{ refreshLocalSources: () => Promise<{ problems: string[] }> }>('local/source');
  const READ = JSON.stringify({ at: '2026-11-03T06:00:00.000Z', entities: [], counts: {} });
  const chatLink = (id: string) => ({
    id, name: 'ChatGPT', host: 'chatgpt.com', known: true, approved: true, createdAt: '2026-11-03T06:00:00.000Z', lastUsedAt: null,
  });

  it('keeps the device when the chat came, links it, and puts its copy once', async () => {
    const { refreshLocalSources } = await source();
    // No class, no friend, no invite; a code made, and the chat has come while the app was away.
    phone([], { settings: { className: 'יא2' } });
    h.storage.set('mashov.read', READ);
    pendingCode();
    server.chats = [chatLink('c1')];
    const { problems } = await refreshLocalSources();
    expect(problems.filter((p) => p.startsWith('חברים') || p.startsWith('צ׳אט'))).toEqual([]);
    // The friends' step left the device, because the code was waiting; the chat step then found the chat and wrote its copy.
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(of('POST', '/v2/devices')).toEqual([]);
    expect(of('GET', '/v2/chat/status')).toHaveLength(1);
    expect(of('PUT', '/v2/chat/snapshot')).toHaveLength(1);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
    expect(readChatState(h.storage)).toMatchObject({ linked: true });
    // The spent code's expiry stays: it may be another code's, and it ages out on its own (`chatCodeLive`).
    expect(readChatState(h.storage).codeExpiresAt).not.toBeNull();
    expect(readChatState(h.storage).key).not.toBeNull();
    expect(readChatState(h.storage).lastHash).not.toBeNull();
  });

  it('keeps the device and K when the last chat is cut while a second code is out, and seals the new chat\'s copy with that K', async () => {
    const { refreshLocalSources } = await source();
    const chat = await load<{ cutChat: (id: string) => Promise<void> }>('chat/run');
    phone([], { settings: { className: 'יא2' } });
    h.storage.set('mashov.read', READ);
    // Linked with one chat, and a second code made for another: K reused, the code's expiry kept, the link still on.
    const key = newChatKey();
    saveChatState(h.storage, { ...readChatState(h.storage), key, linked: true, codeExpiresAt: new Date(Date.now() + 600_000).toISOString() });
    // The old chat is cut before the new one is connected.
    server.chats = [];
    await chat.cutChat('c1');
    expect(readChatState(h.storage)).toMatchObject({ key, linked: false, lastHash: null });
    expect(readChatState(h.storage).codeExpiresAt).not.toBeNull();
    // A friends refresh leaves the device: the code is out, and the chat that comes with it would go with the device.
    await run.refreshBuddies();
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(h.storage.getString('device.identity')).toBe(JSON.stringify(ME));
    expect(readChatState(h.storage).key).toBe(key);

    // The chat comes: linked, and exactly one copy, sealed with the K the code carried.
    server.chats = [chatLink('c2')];
    const { problems } = await refreshLocalSources();
    expect(problems.filter((p) => p.startsWith('חברים') || p.startsWith('צ׳אט'))).toEqual([]);
    expect(of('DELETE', '/v2/device')).toEqual([]);
    const puts = of('PUT', '/v2/chat/snapshot');
    expect(puts).toHaveLength(1);
    expect(openChat<{ v: number }>((puts[0]!.body as { ciphertext: string }).ciphertext, fromB64u(key)!)).toMatchObject({ v: 1 });
    expect(readChatState(h.storage)).toMatchObject({ key, linked: true });
  });

  it('forgets K when the code expired with no chat, and the next refresh drops the device', async () => {
    const { refreshLocalSources } = await source();
    phone([], { settings: { className: 'יא2' } });
    h.storage.set('mashov.read', READ);
    pendingCode(new Date(Date.now() - 600_000).toISOString());
    await refreshLocalSources();
    // Held through this refresh (the friends' step runs first); the chat step let K go.
    expect(of('DELETE', '/v2/device')).toEqual([]);
    expect(of('PUT', '/v2/chat/snapshot')).toEqual([]);
    expect(readChatState(h.storage)).toMatchObject({ key: null, linked: false, codeExpiresAt: null });
    await refreshLocalSources();
    expect(of('DELETE', '/v2/device')).toHaveLength(1);
    expect(h.storage.getString('device.identity')).toBe('');
  });
});

describe('the models, on a phone with no friend', () => {
  it('answer from the state alone, building no days and reading no sources', async () => {
    phone([]);
    // An invite out and a note left by the last friend, who ended it.
    const state = readBuddies(h.storage);
    saveBuddies(h.storage, {
      ...state, unseen: true, notes: ['נועה: כבר לא חברים'],
      invites: [{ secret: newSecret(), secretKey: 'k', shares: { timetable: true, absences: true }, createdAt: new Date().toISOString() }],
    });
    loadLocalSources.mockClear();
    buildLocalDays.mockClear();
    const now = new Date();
    expect(run.buddiesView(now)).toEqual({ myName: 'פלג', rows: [], invites: 1, exams: [], unseen: true, notes: ['נועה: כבר לא חברים'], full: false });
    expect(run.buddyTodayLines(now.toISOString().slice(0, 10), now)).toEqual([]);
    expect(run.buddyPage('a', undefined, now)).toBeNull();
    expect(loadLocalSources).not.toHaveBeenCalled();
    expect(buildLocalDays).not.toHaveBeenCalled();
  });

  it('build them once a friend is there', async () => {
    phone([mate('a', 'c1', true)]);
    loadLocalSources.mockClear();
    buildLocalDays.mockClear();
    expect(run.buddiesView(new Date()).rows.map((r) => r.name)).toEqual(['a']);
    expect(loadLocalSources).toHaveBeenCalled();
    expect(buildLocalDays).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Grades (docs/superpowers/specs/2026-10-30-buddies-grades-design.md)
// ---------------------------------------------------------------------------

const READ_AT = '2026-11-03T05:30:00.000Z';
const NO_GRADES: Shares = { timetable: true, absences: true };
const GRADES: Shares = { timetable: true, absences: true, grades: true };
const BOTH: Shares = { timetable: true, absences: true, grades: true, bagrut: true };

/** A friend whose box was read: `mine` is what I share, `theirs` what their box says they do. */
function gradesMate(id: string, mine: Shares, theirs: Shares, over: Partial<Buddy> = {}): Buddy {
  const base = mate(id, 'c1');
  return { ...base, shares: mine, theirs: { ...base.theirs!, shares: theirs }, ...over };
}

/** A grade as Mashov's read keeps it, among the phone's entities. */
const gradeEntity = (key: string, subject: string, date: string, value: number, kind = 'grade') => ({
  source: 'mashov', kind, naturalKey: key,
  payload: { naturalKey: key, date, subject, value, valueText: null, weight: null, notes: null, isExam: false },
});

const mashovRead = (entities: unknown[]) => h.storage.set('mashov.read', JSON.stringify({ at: READ_AT, entities, counts: {} }));

function sitting(semel: number, over: Record<string, unknown> = {}) {
  return {
    naturalKey: `bagrut|${semel}|202606`, semel, name: `שאלון ${semel}`, moed: '202606', method: 'external', schoolGrade: null, examGrade: null,
    finalGrade: null, acceptedGrade: null, registered: true, examDate: null, startTime: null, endTime: null, ...over,
  };
}

const bagrutRead = (exams: unknown[]) => h.storage.set('mashov.bagrut', JSON.stringify({ readAt: READ_AT, failedAt: null, exams }));

type Sent = BuddyGradesContent | undefined;

/** The box with id `label` of the pair that `secret` is, as the last write of it carried it, opened. */
function sent(secret: string, label: 'a2b-grades' | 'b2a-grades'): Sent {
  const boxes = of('PUT', '/v2/buddies/boxes').flatMap((c) => (c.body as { boxes: { id: string; ciphertext: string }[] }).boxes);
  const box = boxes.filter((b) => b.id === boxIdOf(secret, label)).pop();
  return box ? (openSealed<BuddyGradesContent>(box.ciphertext, keyOf(secret)) ?? undefined) : undefined;
}

const A_GRADES = [gradeEntity('g1', 'מתמטיקה', '2026-10-20', 90), gradeEntity('g2', 'מתמטיקה', '2026-10-27', 70)];

describe('my grades box, in the refresh', () => {
  it('is built from the grades of Mashov that the phone holds, as of the last read', async () => {
    const buddy = gradesMate('a', BOTH, BOTH);
    phone([buddy]);
    // A row of another kind that looks like a grade is not one; a bagrut row's status code is no grade, a questionnaire with only such codes is none.
    mashovRead([...A_GRADES, gradeEntity('h1', 'פיזיקה', '2026-10-21', 100, 'homework')]);
    bagrutRead([sitting(1, { schoolGrade: 90, examGrade: 333, finalGrade: 85 }), sitting(2, { finalGrade: 777 })]);
    await run.refreshBuddies();
    const box = sent(buddy.secret, 'a2b-grades')!;
    expect(box.at).toBe(READ_AT);
    expect(box.subjects.map((s) => [s.subject, s.average, s.grades.length])).toEqual([['מתמטיקה', 80, 2]]);
    expect(box.bagrut!.map(({ semel, school, exam, final }) => ({ semel, school, exam, final }))).toEqual([{ semel: 1, school: 90, exam: undefined, final: 85 }]);
  });

  it('has no bagrut part unless they chose it too', async () => {
    const buddy = gradesMate('a', BOTH, GRADES);
    phone([buddy]);
    mashovRead(A_GRADES);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    await run.refreshBuddies();
    const box = sent(buddy.secret, 'a2b-grades')!;
    expect(box.subjects).toHaveLength(1);
    expect(box.bagrut).toBeUndefined();
  });

  it('averages by my own weights', async () => {
    const buddy = gradesMate('a', GRADES, GRADES);
    phone([buddy]);
    mashovRead(A_GRADES);
    // The first grade alone counts for everything.
    h.storage.set('grades.weights', JSON.stringify({ subjects: {}, grades: { g1: { weight: 100 } } }));
    await run.refreshBuddies();
    expect(sent(buddy.secret, 'a2b-grades')!.subjects[0]!.average).toBe(90);
  });

  it('is not written while Mashov was never read here', async () => {
    const buddy = gradesMate('a', BOTH, BOTH);
    phone([buddy]);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    await run.refreshBuddies();
    expect(sent(buddy.secret, 'a2b-grades')).toBeUndefined();
    expect(readBuddies(h.storage).buddies[0]!.gradesWritten).toBeNull();
    // The main box went all the same.
    expect(of('PUT', '/v2/buddies/boxes')).toHaveLength(1);
  });

  it('is written at once for a link that offers grades when I accept it with mine on', async () => {
    const secret = newSecret();
    server.boxes.set(boxIdOf(secret, 'invite'), seal({ v: 1, name: 'נועה', shares: GRADES, inviterKey: newKeyPair().publicKey }, keyOf(secret)));
    phone([]);
    mashovRead(A_GRADES);
    expect(await run.acceptBuddyInvite(secret, GRADES)).toBe('ok');
    const buddy = readBuddies(h.storage).buddies[0]!;
    expect(sent(buddy.secret, 'b2a-grades')!.subjects.map((s) => s.subject)).toEqual(['מתמטיקה']);
  });
});

describe('the grades switches', () => {
  it('setBuddyShares turning grades off deletes the grades box at once, and my main box says so in the same action', async () => {
    const buddy = gradesMate('a', BOTH, BOTH, {
      theirGrades: { v: 1, at: READ_AT, subjects: [] }, gradesWritten: { hash: 'h', at: READ_AT },
    });
    phone([buddy]);
    mashovRead(A_GRADES);
    await run.setBuddyShares('a', NO_GRADES);
    expect(of('DELETE', '/v2/buddies/boxes').map((c) => c.body)).toEqual([{ ids: [boxIdOf(buddy.secret, 'a2b-grades')] }]);
    // The grades box first, before anything else reaches the server.
    expect(server.calls[0]).toMatchObject({ method: 'DELETE', path: '/v2/buddies/boxes' });
    // Then the friends' refresh: my main box goes saying grades are off, so the friend stops writing theirs to me now,
    // not at my next refresh; and no grades box of mine is written.
    const main = of('PUT', '/v2/buddies/boxes')
      .flatMap((c) => (c.body as { boxes: { id: string; ciphertext: string }[] }).boxes)
      .filter((b) => b.id === boxIdOf(buddy.secret, 'a2b'));
    expect(main).toHaveLength(1);
    const said = openSealed<BuddyBoxContent>(main[0]!.ciphertext, keyOf(buddy.secret))!;
    expect(said.shares).toEqual(NO_GRADES);
    expect(said.shares).not.toHaveProperty('grades');
    expect(sent(buddy.secret, 'a2b-grades')).toBeUndefined();
    const kept = readBuddies(h.storage).buddies[0]!;
    expect(kept.shares).toEqual(NO_GRADES);
    expect(kept.theirGrades).toBeNull();
    expect(kept.gradesWritten).toBeNull();
  });

  it('setBuddyShares turning grades off keeps the choice when the server cannot be reached, and their grades are gone', async () => {
    phone([gradesMate('a', BOTH, BOTH, { theirGrades: { v: 1, at: READ_AT, subjects: [] }, gradesWritten: { hash: 'h', at: READ_AT } })]);
    server.fail = true;
    // The failure is the next sync's to put right: the rule no longer holds, so it deletes the box.
    await run.setBuddyShares('a', NO_GRADES);
    const kept = readBuddies(h.storage).buddies[0]!;
    expect(kept.shares).toEqual(NO_GRADES);
    expect(kept.theirGrades).toBeNull();
    expect(kept.gradesWritten).not.toBeNull();
    server.fail = false;
    await run.refreshBuddies();
    expect(of('DELETE', '/v2/buddies/boxes')).toHaveLength(2);
    expect(readBuddies(h.storage).buddies[0]!.gradesWritten).toBeNull();
  });

  it('setBuddyShares turning the bagrut off alone takes their bagrut from the phone, and my box is rewritten without it now', async () => {
    const buddy = gradesMate('a', BOTH, BOTH, { gradesWritten: { hash: 'old', at: new Date().toISOString() } });
    phone([buddy]);
    mashovRead(A_GRADES);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    await run.setBuddyShares('a', GRADES);
    expect(of('DELETE', '/v2/buddies/boxes')).toEqual([]);
    const box = sent(buddy.secret, 'a2b-grades')!;
    expect(box.subjects).toHaveLength(1);
    expect(box.bagrut).toBeUndefined();
    expect(readBuddies(h.storage).buddies[0]!.shares).toEqual(GRADES);
  });

  it('setBuddyShares turning the bagrut off alone drops their bagrut first, and a refresh that fails is let go', async () => {
    const theirGrades = { v: 1 as const, at: READ_AT, subjects: [], bagrut: [{ semel: 1, name: 'שאלון', moed: '202606', final: 85 }] };
    phone([gradesMate('a', BOTH, BOTH, { theirGrades })]);
    server.fail = true;
    await run.setBuddyShares('a', GRADES);
    const kept = readBuddies(h.storage).buddies[0]!;
    expect(kept.shares).toEqual(GRADES);
    expect(kept.theirGrades).toEqual({ v: 1, at: READ_AT, subjects: [] });
  });

  it('setBuddyShares leaves the grades alone when it changes only what else is shared', async () => {
    const theirGrades = { v: 1 as const, at: READ_AT, subjects: [] };
    phone([gradesMate('a', BOTH, BOTH, { theirGrades, gradesWritten: { hash: 'h', at: READ_AT } })]);
    await run.setBuddyShares('a', { ...BOTH, absences: false });
    expect(server.calls).toEqual([]);
    const kept = readBuddies(h.storage).buddies[0]!;
    expect(kept.shares).toEqual({ timetable: true, absences: false, grades: true, bagrut: true });
    expect(kept.theirGrades).toEqual(theirGrades);
    expect(kept.gradesWritten).not.toBeNull();
  });

  it('setBuddyShares keeps the bagrut only with the grades', async () => {
    phone([gradesMate('a', NO_GRADES, NO_GRADES)]);
    await run.setBuddyShares('a', { timetable: true, absences: true, bagrut: true });
    expect(readBuddies(h.storage).buddies[0]!.shares).toEqual(NO_GRADES);
  });

  it('turnOnBuddyGrades(\'bagrut\') turns grades on too, answers the dot, and refreshes', async () => {
    const buddy = gradesMate('a', NO_GRADES, BOTH, { gradesDot: true });
    phone([buddy]);
    mashovRead(A_GRADES);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    await run.turnOnBuddyGrades('a', 'bagrut');
    const kept = readBuddies(h.storage).buddies[0]!;
    expect(kept.shares).toEqual(BOTH);
    expect(kept.gradesDot).toBe(false);
    // The refresh: both of us chose them, so the box went with the bagrut in it.
    const box = sent(buddy.secret, 'a2b-grades')!;
    expect(box.subjects).toHaveLength(1);
    expect(box.bagrut!.map((r) => r.semel)).toEqual([1]);
    expect(of('POST', '/v2/buddies/read')).toHaveLength(1);
  });

  it('turnOnBuddyGrades(\'grades\') turns on the grades alone', async () => {
    const buddy = gradesMate('a', NO_GRADES, BOTH, { gradesDot: true });
    phone([buddy]);
    mashovRead(A_GRADES);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    await run.turnOnBuddyGrades('a', 'grades');
    expect(readBuddies(h.storage).buddies[0]!.shares).toEqual(GRADES);
    expect(readBuddies(h.storage).buddies[0]!.gradesDot).toBe(false);
    expect(sent(buddy.secret, 'a2b-grades')!.bagrut).toBeUndefined();
  });

  it('turnOnBuddyGrades says a failure in Hebrew, and what it turned on stays on', async () => {
    phone([gradesMate('a', NO_GRADES, GRADES, { gradesDot: true })]);
    server.fail = true;
    await expect(run.turnOnBuddyGrades('a', 'grades')).rejects.toThrow(BUDDY_COPY.failed);
    const kept = readBuddies(h.storage).buddies[0]!;
    expect(kept.shares).toEqual(GRADES);
    expect(kept.gradesDot).toBe(false);
  });

  it('turnOnBuddyGrades waits for the write before it', async () => {
    phone([gradesMate('a', NO_GRADES, GRADES, { gradesDot: true })]);
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    const refreshing = run.refreshBuddies();
    const turning = run.turnOnBuddyGrades('a', 'grades');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readBuddies(h.storage).buddies[0]!.shares).toEqual(NO_GRADES);
    release();
    await Promise.all([refreshing, turning]);
    expect(readBuddies(h.storage).buddies[0]!.shares).toEqual(GRADES);
  });

  it('markBuddyGradesSeen clears the dot, of that friend only', async () => {
    phone([gradesMate('a', NO_GRADES, GRADES, { gradesDot: true }), gradesMate('b', NO_GRADES, GRADES, { gradesDot: true })]);
    await run.markBuddyGradesSeen('a');
    expect(readBuddies(h.storage).buddies.map((b) => b.gradesDot)).toEqual([false, true]);
    expect(server.calls).toEqual([]);
  });

  it('a parent: none of it runs', async () => {
    const mine = gradesMate('a', NO_GRADES, GRADES, { gradesDot: true });
    const kept = gradesMate('b', BOTH, BOTH, { theirGrades: { v: 1, at: READ_AT, subjects: [] }, gradesWritten: { hash: 'h', at: READ_AT } });
    phone([mine, kept], { settings: { audience: 'parent' } });
    const before = readBuddies(h.storage);
    await run.turnOnBuddyGrades('a', 'bagrut');
    await run.markBuddyGradesSeen('a');
    await run.setBuddyShares('b', NO_GRADES);
    expect(server.calls).toEqual([]);
    const after = readBuddies(h.storage);
    expect(after).toEqual(before);
    expect(after.buddies[1]!.shares).toEqual(BOTH);
    expect(after.buddies[1]!.theirGrades).not.toBeNull();
    expect(after.buddies[1]!.gradesWritten).not.toBeNull();
  });
});

describe('whether the phone has a bagrut to share', () => {
  it('is so with one questionnaire that has a grade of Mashov\'s own', () => {
    expect(run.myHasBagrut()).toBe(false);
    bagrutRead([]);
    expect(run.myHasBagrut()).toBe(false);
    // The Ministry's status codes (blocked, withheld) are no grades.
    bagrutRead([sitting(1, { finalGrade: 777 }), sitting(2, { examGrade: 888, schoolGrade: 333 }), sitting(3)]);
    expect(run.myHasBagrut()).toBe(false);
    bagrutRead([sitting(1, { finalGrade: 777 }), sitting(2, { schoolGrade: 92 })]);
    expect(run.myHasBagrut()).toBe(true);
  });
});

describe("a friend's page, with my grades", () => {
  const THEIRS: BuddyGradesContent = {
    v: 1, at: READ_AT, subjects: [{ subject: 'מתמטיקה', average: 60, grades: [{ date: '2026-10-27', name: 'מבחן', value: 60 }] }],
    bagrut: [{ semel: 1, name: 'שאלון 1', moed: '2026-06', final: 80 }],
  };
  const pageOf = (id: string) => run.buddyPage(id, undefined, new Date())!.grades;

  it('sets what the phone holds beside theirs, the bagrut too, and my average by my weights', () => {
    phone([gradesMate('a', BOTH, BOTH, { theirGrades: THEIRS })]);
    mashovRead(A_GRADES);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    const grades = pageOf('a');
    expect(grades.state).toBe('list');
    expect(grades.compare?.shared.map((s) => [s.subject, s.mine, s.theirs])).toEqual([['מתמטיקה', 80, 60]]);
    expect(grades.compare?.bagrut.shared.map((r) => [r.semel, r.mine?.final, r.theirs.final])).toEqual([[1, 85, 80]]);
  });

  it('puts all of theirs among the others while Mashov was never read here', () => {
    phone([gradesMate('a', GRADES, GRADES, { theirGrades: THEIRS })]);
    const grades = pageOf('a');
    expect(grades.compare?.shared).toEqual([]);
    expect(grades.compare?.others.map((s) => s.subject)).toEqual(['מתמטיקה']);
  });

  it('asks for the bagrut with the dot only of a phone that has one to share', () => {
    phone([gradesMate('a', GRADES, BOTH, { gradesDot: true })]);
    expect(pageOf('a').dot).toBe(false);
    bagrutRead([sitting(1, { finalGrade: 777 })]);
    expect(pageOf('a').dot).toBe(false);
    bagrutRead([sitting(1, { finalGrade: 85 })]);
    expect(pageOf('a').dot).toBe(true);
  });
});

describe('the demo', () => {
  it('turnOnBuddyGrades refuses with DEMO_COPY.notSaved, and no grades change reaches a server', async () => {
    h.map.set('demo.on', true);
    await expect(run.turnOnBuddyGrades('demo-noa', 'grades')).rejects.toThrow(DEMO_COPY.notSaved);
    await expect(run.turnOnBuddyGrades('demo-noa', 'bagrut')).rejects.toThrow(DEMO_COPY.notSaved);
    await expect(run.setBuddyShares('demo-noa', NO_GRADES)).rejects.toThrow(DEMO_COPY.notSaved);
    // The made-up friend is made up anew each time: nothing to mark.
    await run.markBuddyGradesSeen('demo-noa');
    expect(server.calls).toEqual([]);
  });

  it('shows its made-up friend, and reaches no server', async () => {
    h.map.set('demo.on', true);
    const now = new Date();
    expect(run.buddiesView(now).rows.map((r) => r.name)).toEqual(['נועה']);
    run.buddyTodayLines(new Date().toISOString().slice(0, 10), now);
    await run.refreshBuddies();
    await expect(run.createBuddyInvite({ timetable: true, absences: true })).rejects.toThrow(DEMO_COPY.notSaved);
    await expect(run.cancelBuddyInvites()).rejects.toThrow(DEMO_COPY.notSaved);
    expect(server.calls).toEqual([]);
  });

  it('has a bagrut of its own to share, and its friend\'s grades to compare, from the demo and not from storage', () => {
    h.map.set('demo.on', true);
    // The demo's bagrut and grades are made up, not kept: nothing of Mashov is in the storage.
    expect(h.storage.getString('mashov.read')).toBeUndefined();
    expect(h.storage.getString('mashov.bagrut')).toBeUndefined();
    expect(run.myHasBagrut()).toBe(true);
    const grades = run.buddyPage('demo-noa', undefined, new Date())!.grades;
    expect(grades).toMatchObject({ state: 'list', bagrut: 'list', dot: false });
    // Her grades are beside the student's own: a row with a grade of each, and the questionnaires both sat.
    expect(grades.compare?.shared.flatMap((s) => s.rows).some((r) => r.mine && r.theirs)).toBe(true);
    expect(grades.compare?.shared.every((s) => s.mine !== null)).toBe(true);
    expect(grades.compare?.others.length).toBeGreaterThan(0);
    expect(grades.compare?.bagrut.shared.length).toBeGreaterThan(0);
    expect(server.calls).toEqual([]);
  });

  it('has a window in common with its friend on two school days, and Today says so on a Monday morning', () => {
    h.map.set('demo.on', true);
    // Monday 2.11.2026 at 09:20 in Jerusalem, in a plain school week.
    const monday = new Date('2026-11-02T09:20:00+02:00');
    const window = run.buddyTodayLines('2026-11-02', monday).find((l) => (l as { kind?: string }).kind === 'window');
    expect(window?.text).toBe(BUDDY_COPY.todayWindow(buddyNames(['נועה']), '10:30–11:35'));
    expect(window?.buddyId).toBe('demo-noa');
    // The week: a window on two school days, each also on the friend's page.
    const week = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const withWindow = week.filter((date) => {
      const page = run.buddyPage('demo-noa', date, monday) as { compare: { windows: unknown[] } | null } | null;
      return (page?.compare?.windows.length ?? 0) > 0;
    });
    expect(withWindow).toEqual(['2026-11-02', '2026-11-04']);
    expect(server.calls).toEqual([]);
  });
});

describe('my box and my side of the friends screens, when I moved an exam for myself', () => {
  const ZONE = 'Asia/Jerusalem';
  const exam = (name: string, date: string, subject: string) => ({ naturalKey: `site-exam|${name}`, date, subject, details: null, source: 'school_site' as const });

  /** A phone that follows class 7 with two exams on its feed, and the dates I set for both: one out of the two weeks, one into them. */
  function movedPhone(buddyOf: (school: { soon: string; later: string }) => Buddy) {
    const today = todayStr(ZONE);
    const school = { soon: addDays(today, 3), later: addDays(today, 40) };
    const mine = { soon: addDays(today, 30), later: addDays(today, 5) };
    const buddy = buddyOf(school);
    phone([buddy], { settings: { classId: '7', className: 'יא3' } });
    h.storage.set('device.feed', JSON.stringify({
      class: { siteUrl: SITE, classId: '7', className: 'יא3' }, lastOkAt: new Date().toISOString(), freshness: null, lessons: [], changes: [],
      exams: [exam('soon', school.soon, 'מבחן באנגלית'), exam('later', school.later, 'מבחן בפיזיקה')], events: [], messages: [],
    }));
    h.storage.set('exams.prefs', JSON.stringify({
      renames: {}, calendarSkip: [],
      dates: {
        'site-exam|soon': { date: mine.soon, sourceDate: school.soon },
        'site-exam|later': { date: mine.later, sourceDate: school.later },
      },
    }));
    return { school, mine, buddy };
  }

  it('sends the friend the school\'s dates: the exam I moved out of the two weeks is in the box, the one I moved into them is not', async () => {
    const { school, buddy } = movedPhone(() => mate('a', 'c1'));
    await run.refreshBuddies();
    const main = of('PUT', '/v2/buddies/boxes')
      .flatMap((c) => (c.body as { boxes: { id: string; ciphertext: string }[] }).boxes)
      .filter((b) => b.id === boxIdOf(buddy.secret, 'a2b'));
    expect(main).toHaveLength(1);
    const said = openSealed<BuddyBoxContent>(main[0]!.ciphertext, keyOf(buddy.secret))!;
    expect(said.timetable!.exams).toEqual([{ date: school.soon, subject: 'אנגלית', title: 'מבחן באנגלית' }]);
  });

  it('sets my exam beside a friend\'s on the school\'s date, though I moved it: the friend has it the same day', () => {
    // The friend's box says the school's date for the same exam.
    const withFriendsExam = (school: { soon: string }) => {
      const base = mate('a', 'c1', true);
      const theirExam = { date: school.soon, subject: 'אנגלית', title: 'מבחן באנגלית' };
      return { ...base, theirs: { ...base.theirs!, timetable: { ...base.theirs!.timetable!, exams: [theirExam] } } };
    };
    const { school } = movedPhone(withFriendsExam);
    const exams = (run.buddiesView(new Date()) as unknown as { exams: { date: string; title: string; together: string[] }[] }).exams;
    expect(exams).toEqual([expect.objectContaining({ date: school.soon, title: 'מבחן באנגלית', together: ['a'] })]);
  });
});
