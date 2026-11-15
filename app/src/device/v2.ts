/**
 * This phone as a device on `/v2` (plan Phase 2e).
 *
 * The phone has a device on the server while it follows a class (plan Phase 3)
 * or has a friend or a pending invite (friends, spec 3.2): following one
 * (`followClass`) or making the first friend's box (`asBuddyDevice`) is what
 * registers, and so does the first code for a chat (`chatServer.createCode`,
 * chat connection spec 9); the phone keeps its own token from then on. It reads the
 * class's feed for the phone to assemble its own days from, and gets the
 * class's pushes at the push address it sends (`sendPushToken`), filtered by
 * the switches it sends (`syncDevicePrefs`). A device without a class has no
 * feed and gets no class's pushes. When nothing needs the device any more (no
 * class, no friend, no pending invite, no linked chat or code waiting for one)
 * the phone drops it (`dropIdleDevice`).
 * With none, and after "מחק את הנתונים שלי", every other call does nothing:
 * a phone without a site or a friend, or one just wiped, gets no row that
 * could never receive a push.
 */
import type {
  ChatStatusResponse, ClassFeed, ClassHistory, ClassListResponse, CreateChatCodeResponse, DeviceResponse, ExamBoardPreview, ExamBoardPreviewBody,
  PutBuddyBoxesResponse, ReadBuddyBoxesResponse, RegisterDeviceResponse, SaveExamBoardBody, TeachersResponse, UpdateDeviceBody,
  UpdateDeviceClassesBody, UserSettings,
} from '@sederyom/shared';
import { intersectNames, type SubjectNames } from '@sederyom/shared/logic/ownNames';
import type { BuddyServer } from '../buddies/protocol';
import { API_BASE_URL } from '../config';
import type { KeyValue } from '../mashov/sync';

/** What the phone registers as; the app's own is `DEVICE_PLATFORM` (`platform.ts`). */
export type DevicePlatform = 'android' | 'ios';

export const DEVICE_KEYS = {
  identity: 'device.identity',
  feed: 'device.feed',
  prefsSent: 'device.prefsSent',
  pushTokenSent: 'device.pushTokenSent',
  /** The phone's Expo push address, kept from `usePushRegistration` until there is a device to send it to. */
  pushAddress: 'device.pushAddress',
  /** A parent's other children's classes, as last sent (`syncOtherClasses`). */
  classesSent: 'device.classesSent',
  /** When the server last said it has no `/v2/device/classes`: one from before parents mode's stage 2. */
  classesUnsupported: 'device.classesUnsupported',
} as const;

export interface DeviceIdentity {
  deviceId: string;
  token: string;
}

export class V2Error extends Error {
  /** `code`: the server's `error` field (`no_class`, `not_followed`…), when it sent one. */
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'V2Error';
  }
}

function load<T>(kv: KeyValue, key: string): T | null {
  try {
    const raw = kv.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const storedIdentity = (kv: KeyValue): DeviceIdentity | null => load<DeviceIdentity>(kv, DEVICE_KEYS.identity);
export const storedFeed = (kv: KeyValue): ClassFeed | null => load<ClassFeed>(kv, DEVICE_KEYS.feed);

/** The push address `usePushRegistration` last got from the phone, or `null`. */
export function storedPushAddress(kv: KeyValue): string | null {
  return kv.getString(DEVICE_KEYS.pushAddress) || null;
}

/** Keeps the phone's push address, for the device the phone has or the one it registers when it follows a class. */
export function keepPushAddress(kv: KeyValue, address: string): void {
  kv.set(DEVICE_KEYS.pushAddress, address);
}

/**
 * How long a call is waited for. Past it the call fails, as with no network:
 * one that hangs never holds the calls queued behind it (the friends' calls go
 * one at a time, `buddies/run.ts`). A write given up on may still have reached
 * the server, as after a lost connection: the friends' boxes allow for it
 * (`buddies/protocol.ts`), the device's own writes are the same when sent
 * again, and a registration whose answer is lost leaves a device this phone
 * never learns of.
 */
const TIMEOUT_MS = 20_000;
/** For the calls that have the server read the school's Shahaf site while the phone waits: a slow site is slow, not down. */
const SITE_TIMEOUT_MS = 120_000;
/** The exam board's preview: the server gives itself 25 seconds to read a link or a file (`PREVIEW_DEADLINE_MS`), and the phone waits a little longer than that for its answer. */
const PREVIEW_TIMEOUT_MS = 30_000;

async function v2<T>(path: string, init: RequestInit, token: string | null, fetchImpl: typeof fetch, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text: string;
  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const failure = body as { error?: unknown; message?: string } | null;
    throw new V2Error(res.status, failure?.message ?? `HTTP ${res.status}`, typeof failure?.error === 'string' ? failure.error : undefined);
  }
  return body as T;
}

/** The registration on its way for each store, so that two callers at once make one device. */
const registering = new WeakMap<KeyValue, Promise<DeviceIdentity>>();

/**
 * The stored identity, or a new registration: `followClass`'s and
 * `asBuddyDevice`'s alone. One at a time: a friend's call racing the class's
 * follow (or two 401 retries) wait for the one registration on its way rather
 * than make a second device. A failed one is not kept: the next call tries again.
 */
function ensureDevice(kv: KeyValue, platform: DevicePlatform, fetchImpl: typeof fetch): Promise<DeviceIdentity> {
  const known = storedIdentity(kv);
  if (known) return Promise.resolve(known);
  const pending = registering.get(kv);
  if (pending) return pending;
  const run = (async () => {
    const reg = await v2<RegisterDeviceResponse>('/v2/devices', { method: 'POST', body: JSON.stringify({ platform }) }, null, fetchImpl);
    const identity = { deviceId: reg.deviceId, token: reg.token };
    kv.set(DEVICE_KEYS.identity, JSON.stringify(identity));
    return identity;
  })().finally(() => registering.delete(kv));
  registering.set(kv, run);
  return run;
}

/** The server no longer knows this device: the phone forgets it, and what it sent it. */
function forgetDevice(kv: KeyValue): void {
  kv.set(DEVICE_KEYS.identity, '');
  // A new registration starts empty on the server: what was sent before goes again.
  kv.set(DEVICE_KEYS.prefsSent, '');
  kv.set(DEVICE_KEYS.pushTokenSent, '');
  kv.set(DEVICE_KEYS.classesSent, '');
}

/**
 * Runs `call` with the device's token (following a class, or a friend's box),
 * registering first when the phone has none. A 401 means the server no longer
 * knows this device (its row was deleted): forget it, register again, retry
 * once.
 */
async function asFollowingDevice<T>(kv: KeyValue, platform: DevicePlatform, fetchImpl: typeof fetch, call: (token: string) => Promise<T>): Promise<T> {
  const { token } = await ensureDevice(kv, platform, fetchImpl);
  try {
    return await call(token);
  } catch (err) {
    if (!(err instanceof V2Error) || err.status !== 401) throw err;
    forgetDevice(kv);
    const fresh = await ensureDevice(kv, platform, fetchImpl);
    return call(fresh.token);
  }
}

/**
 * `call` with the device's token, registering a device without a class first
 * when the phone has none: the one call besides `followClass` that registers.
 * For a friend's box, which needs a device and no class. Retries once on a 401
 * as `followClass` does.
 */
export function asBuddyDevice<T>(kv: KeyValue, platform: DevicePlatform, fetchImpl: typeof fetch, call: (token: string) => Promise<T>): Promise<T> {
  return asFollowingDevice(kv, platform, fetchImpl, call);
}

/**
 * The device's `/v2/buddies` calls (friends, spec 5), for `buddies/protocol.ts`.
 * Each goes through `asBuddyDevice`: the first registers a phone without a
 * device, and a 401 registers again and retries once. With `register` false
 * (deleting my data), only through the device the phone has: a phone without
 * one has no boxes on the server, so `remove` does nothing and the others throw.
 */
export function buddyServer(kv: KeyValue, platform: DevicePlatform, fetchImpl: typeof fetch = fetch, register = true): BuddyServer {
  const call = <T>(path: string, method: string, body: unknown): Promise<T | null> => {
    const send = (token: string) => v2<T>(path, { method, body: JSON.stringify(body) }, token, fetchImpl);
    return register ? asBuddyDevice(kv, platform, fetchImpl, send) : asKnownDevice(kv, send);
  };
  const answered = <T>(got: T | null): T => {
    if (got === null) throw new V2Error(401, 'the phone has no device');
    return got;
  };
  return {
    put: async (boxes) => answered(await call<PutBuddyBoxesResponse>('/v2/buddies/boxes', 'PUT', { boxes })),
    read: async (ids) => answered(await call<ReadBuddyBoxesResponse>('/v2/buddies/read', 'POST', { ids })),
    remove: async (ids) => {
      await call<unknown>('/v2/buddies/boxes', 'DELETE', { ids });
    },
  };
}

/**
 * Runs `call` with the device's token, or returns `null` when the phone has no
 * device: it follows no class and has no friend. Never registers. A 401 says
 * the server forgot the row; the phone forgets it too, and has none until it
 * follows a class or makes a friend again.
 */
async function asKnownDevice<T>(kv: KeyValue, call: (token: string) => Promise<T>): Promise<T | null> {
  const known = storedIdentity(kv);
  if (!known) return null;
  try {
    return await call(known.token);
  } catch (err) {
    if (!(err instanceof V2Error) || err.status !== 401) throw err;
    forgetDevice(kv);
    return null;
  }
}

/** The device's `/v2/chat` calls (chat connection, spec 4), for the chat page and the write step (`chat/`). */
export interface ChatServer {
  /** A new code for K; registers a device when the phone has none (spec 9: a device without a class), and again once on a 401. */
  createCode(key: string): Promise<CreateChatCodeResponse>;
  /** The chats linked and when the copy was written; `null`: the phone has no device, or the server forgot it (a 401). */
  status(): Promise<ChatStatusResponse | null>;
  /** The sealed copy, written whole; `'no_device'`: there is no device to write it for. Throws `no_chat` (409) while no chat is linked. */
  putSnapshot(ciphertext: string): Promise<'ok' | 'no_device'>;
  /** Confirms a chat the app does not know. */
  approve(id: string): Promise<void>;
  /** Cuts one chat. Throws `not_found` (404) for an id the device does not have: the caller decides what that means. */
  cut(id: string): Promise<void>;
  /** Cuts every chat, with the codes and the copy. A phone without a device has nothing to cut. */
  cutAll(): Promise<void>;
}

/**
 * The `/v2/chat` calls (spec 4.1, 4.2 and 4.5). Only `createCode` may register
 * a device (through `asBuddyDevice`). Every other call goes through
 * `asKnownDevice`: with no device it makes no request, and a 401 (the server
 * forgot the device, and its chats with it) forgets the identity and registers
 * nothing, because a fresh device would have no chats and the phone would then
 * write a copy for none. The caller goes by the `error` code a refusal carries
 * (`V2Error.code`), never by its message.
 */
export function chatServer(kv: KeyValue, platform: DevicePlatform, fetchImpl: typeof fetch = fetch): ChatServer {
  /** `null`: no device. Wrapped, so that an answer with no body is not taken for that. */
  const known = (path: string, method: string, body?: unknown) =>
    asKnownDevice(kv, async (token) => ({
      answer: await v2<unknown>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, token, fetchImpl),
    }));
  const client = (id: string) => `/v2/chat/clients/${encodeURIComponent(id)}`;
  return {
    createCode: (key) =>
      asBuddyDevice(kv, platform, fetchImpl, (token) =>
        v2<CreateChatCodeResponse>('/v2/chat/codes', { method: 'POST', body: JSON.stringify({ key }) }, token, fetchImpl)),
    status: async () => {
      const got = await known('/v2/chat/status', 'GET');
      return got ? (got.answer as ChatStatusResponse | null) : null;
    },
    putSnapshot: async (ciphertext) => ((await known('/v2/chat/snapshot', 'PUT', { ciphertext })) ? 'ok' : 'no_device'),
    approve: async (id) => {
      await known(`${client(id)}/approve`, 'POST');
    },
    cut: async (id) => {
      await known(client(id), 'DELETE');
    },
    cutAll: async () => {
      await known('/v2/chat', 'DELETE');
    },
  };
}

/**
 * "מחק את הנתונים שלי": the device's row on the server, and every push sent
 * to it. A phone that never registered has nothing there, and a 401 says the
 * row is already gone; neither registers just to delete.
 */
export async function deleteDevice(kv: KeyValue, fetchImpl: typeof fetch = fetch): Promise<void> {
  const known = storedIdentity(kv);
  if (!known) return;
  try {
    await v2<{ ok: boolean }>('/v2/device', { method: 'DELETE' }, known.token, fetchImpl);
  } catch (err) {
    if (!(err instanceof V2Error) || err.status !== 401) throw err;
  }
}

/**
 * Drops the phone's device when nothing needs it: `idle` is the caller's word
 * that the phone follows no class, has no friend and no pending invite, and no
 * chat linked or code waiting for one (the row's deletion deletes every chat of
 * it, with its codes, tokens and copy, so a linked chat, or a code made and not
 * yet used, is never idle). The row on the server is
 * deleted, with every push sent to it, and the phone forgets the identity and
 * what it sent. Returns whether the phone had one to drop; a 401 says the row
 * is already gone, and the identity goes all the same. Any other failure
 * throws, and the device stays for the next try.
 */
export async function dropIdleDevice(kv: KeyValue, idle: boolean, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!idle || !storedIdentity(kv)) return false;
  await deleteDevice(kv, fetchImpl);
  forgetDevice(kv);
  return true;
}

/**
 * Follows a class: the site from Mashov, the class id the student picked. The
 * one call that registers the phone, as `platform`. Never a push token here:
 * the caller sends it and the prefs after (`sendDeviceDetails`).
 */
export function followClass(
  kv: KeyValue, platform: DevicePlatform, siteUrl: string, classId: string, fetchImpl: typeof fetch = fetch,
): Promise<DeviceResponse> {
  return asFollowingDevice(kv, platform, fetchImpl, (token) =>
    v2<DeviceResponse>('/v2/device', { method: 'PUT', body: JSON.stringify({ class: { siteUrl, classId } }) }, token, fetchImpl, SITE_TIMEOUT_MS));
}

/** The grade's exam calendar for the device's class (a calendar id or its embed URL); `null` clears it. */
export async function setExamCalendar(kv: KeyValue, calendar: string | null, fetchImpl: typeof fetch = fetch): Promise<DeviceResponse> {
  const device = await asKnownDevice(kv, (token) =>
    v2<DeviceResponse>('/v2/device', { method: 'PUT', body: JSON.stringify({ examCalendar: calendar }) }, token, fetchImpl));
  // As the server says it of a device without a class, and with its code, which `boardProblem` goes by (`ExamBoard` removes a board with this).
  if (!device) throw new V2Error(409, 'examCalendar: the phone follows no class', 'no_class');
  return device;
}

/**
 * Step 1 of bringing an exam board: what the server finds at a link or in an
 * Excel file (exactly one of `link` and `file`; `column` answers a `columns`
 * preview). Nothing is saved. Slow on purpose: the server reads the page or the
 * file while the phone waits (`PREVIEW_TIMEOUT_MS`).
 *
 * `file.base64` goes to the server as it is given, so it must have no line
 * breaks in it: the server's decoder is strict. A refusal is a `V2Error` whose
 * `code` is the server's `error` (`private_sheet`, `unknown_layout`,
 * `rate_limited`… see `boardProblem`); a phone with no device follows no class,
 * which is a 409 `no_class` with no request made. The app's demo is the
 * caller's to handle.
 */
export async function previewExamBoard(kv: KeyValue, body: ExamBoardPreviewBody, fetchImpl: typeof fetch = fetch): Promise<ExamBoardPreview> {
  const preview = await asKnownDevice(kv, (token) =>
    v2<ExamBoardPreview>('/v2/device/exam-board/preview', { method: 'POST', body: JSON.stringify(body) }, token, fetchImpl, PREVIEW_TIMEOUT_MS));
  if (!preview) throw new V2Error(409, 'examBoard: the phone follows no class', 'no_class');
  return preview;
}

/**
 * Step 2: the rows the student confirmed become the class's board. Answers the
 * device, with the class's `examBoard` as it is now. 403 `calendar_locked`: the
 * class has a board that another device brought; 422 `bad_rows` / `too_big`.
 */
export async function saveExamBoard(kv: KeyValue, rows: SaveExamBoardBody['rows'], fetchImpl: typeof fetch = fetch): Promise<DeviceResponse> {
  const device = await asKnownDevice(kv, (token) =>
    v2<DeviceResponse>('/v2/device/exam-board', { method: 'PUT', body: JSON.stringify({ rows }) }, token, fetchImpl));
  if (!device) throw new V2Error(409, 'examBoard: the phone follows no class', 'no_class');
  return device;
}

/**
 * What the server filters this device's pushes by: its notification switches,
 * quiet hours, "חופש", hidden lessons and the student's own names for subjects.
 *
 * `siblings`: the names of the parent's other children in the class on screen
 * (`sameClassNames`). The server follows that class once, for all of them, so
 * it gets only the names every one of them gave alike. It is passed in, not
 * read here, because `local/children.ts` imports this file.
 */
export function devicePrefsFrom(settings: UserSettings, siblings: readonly SubjectNames[] = []): NonNullable<UpdateDeviceBody['prefs']> {
  const n = settings.notifications;
  return {
    notifications: { schedule_change_tomorrow: n.schedule_change_tomorrow, schedule_change_today: n.schedule_change_today, new_exam: n.new_exam },
    quietHours: settings.quietHours,
    vacationMode: settings.vacationMode,
    hiddenSubjects: settings.lessons.hiddenSubjects,
    subjectNames: siblings.reduce<SubjectNames>(intersectNames, settings.lessons.subjectNames ?? {}),
  };
}

/** Sends `body` once to the device the phone has: a second call with the same value under `key`, or no device, sends nothing. */
async function sendOnce(kv: KeyValue, key: string, body: UpdateDeviceBody, fetchImpl: typeof fetch): Promise<boolean> {
  const value = JSON.stringify(body);
  if (kv.getString(key) === value) return false;
  const sent = await asKnownDevice(kv, (token) => v2<DeviceResponse>('/v2/device', { method: 'PUT', body: value }, token, fetchImpl));
  if (!sent) return false;
  kv.set(key, value);
  return true;
}

/**
 * The settings the server needs for this device's pushes, when they changed;
 * nothing without a device. `siblings`: `sameClassNames` of the parent's
 * children, `[]` for a phone with none. The caller says it, so that a name one
 * child gave is never sent for a sibling in the same class that did not.
 */
export function syncDevicePrefs(
  kv: KeyValue, settings: UserSettings, siblings: readonly SubjectNames[], fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return sendOnce(kv, DEVICE_KEYS.prefsSent, { prefs: devicePrefsFrom(settings, siblings) }, fetchImpl);
}

/** The phone's push address, for the class's timetable pushes; `null` stops them. Nothing without a device. */
export function sendPushToken(kv: KeyValue, pushToken: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return sendOnce(kv, DEVICE_KEYS.pushTokenSent, { pushToken }, fetchImpl);
}

/**
 * What the device's pushes need, after a class is followed and on every
 * refresh: the prefs and the push address the phone keeps, each when it
 * changed. Nothing without a device. `siblings`: see `syncDevicePrefs`.
 */
export async function sendDeviceDetails(
  kv: KeyValue, settings: UserSettings, siblings: readonly SubjectNames[], fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await syncDevicePrefs(kv, settings, siblings, fetchImpl);
  const address = storedPushAddress(kv);
  if (address) await sendPushToken(kv, address, fetchImpl);
}

/**
 * The classes the school's Shahaf site lists, for the student picking their
 * own. Picking comes before following, so this never registers: the server
 * answers it without a device, and the token goes along only when the phone
 * has one (a server from before Phase 3 still asked for it).
 */
export function listClasses(kv: KeyValue, siteUrl: string, fetchImpl: typeof fetch = fetch): Promise<ClassListResponse> {
  return v2<ClassListResponse>(`/v2/classes?site=${encodeURIComponent(siteUrl)}`, { method: 'GET' }, storedIdentity(kv)?.token ?? null, fetchImpl, SITE_TIMEOUT_MS);
}

/** The device as the server has it; `null` when the phone has none (it follows no class). */
export function readDevice(kv: KeyValue, fetchImpl: typeof fetch = fetch): Promise<DeviceResponse | null> {
  return asKnownDevice(kv, (token) => v2<DeviceResponse>('/v2/device', { method: 'GET' }, token, fetchImpl));
}

/** The feed kept goes with its class: an invite to a class at another school is being followed (`joinClass`). */
export function forgetFeed(kv: KeyValue): void {
  kv.set(DEVICE_KEYS.feed, '');
}

/**
 * The class's feed, kept for the local days; `null`, and nothing kept, when the
 * phone has no device, or a device without a class (the server's `409 no_class`:
 * a friend's, for a phone that follows none).
 */
export async function refreshFeed(kv: KeyValue, fetchImpl: typeof fetch = fetch): Promise<ClassFeed | null> {
  let feed: ClassFeed | null;
  try {
    feed = await asKnownDevice(kv, (token) => v2<ClassFeed>('/v2/class/feed', { method: 'GET' }, token, fetchImpl));
  } catch (err) {
    if (err instanceof V2Error && err.status === 409 && err.code === 'no_class') return null;
    throw err;
  }
  if (feed) kv.set(DEVICE_KEYS.feed, JSON.stringify(feed));
  return feed;
}

/**
 * "איפה המורה?": today's day of every teacher at the device's school, as the
 * server read the site's classes. `null` without a device or a class;
 * `'unsupported'` from a server from before the route (404).
 */
export async function readTeachers(kv: KeyValue, fetchImpl: typeof fetch = fetch): Promise<TeachersResponse | null | 'unsupported'> {
  try {
    // The server may read every class on the site while the phone waits.
    return await asKnownDevice(kv, (token) => v2<TeachersResponse>('/v2/teachers', { method: 'GET' }, token, fetchImpl, SITE_TIMEOUT_MS));
  } catch (err) {
    if (err instanceof V2Error && err.status === 409 && err.code === 'no_class') return null;
    if (err instanceof V2Error && err.status === 404) return 'unsupported';
    throw err;
  }
}

/**
 * The class's past days through this school year, for the year in review
 * (`wrapped/history.ts` keeps it). `null` without a device or a class;
 * `'unsupported'` from a server from before the route (404).
 */
export async function readHistory(kv: KeyValue, fetchImpl: typeof fetch = fetch): Promise<ClassHistory | null | 'unsupported'> {
  try {
    return await asKnownDevice(kv, (token) => v2<ClassHistory>('/v2/class/history', { method: 'GET' }, token, fetchImpl));
  } catch (err) {
    if (err instanceof V2Error && err.status === 409 && err.code === 'no_class') return null;
    if (err instanceof V2Error && err.status === 404) return 'unsupported';
    throw err;
  }
}

/** What `syncOtherClasses` did. */
export type OtherClassesSync = 'sent' | 'same' | 'none' | 'unsupported';

/**
 * A parent's other children's classes (parents mode, stage 2), for the
 * server to follow and push besides the device's own: sent when they changed,
 * and not at all by a phone that never had any (`none`), so a student's phone
 * never asks for the route. A server from before stage 2 has no such route
 * (`unsupported`): the phone notes when it said so, for Settings, and the
 * device's own class still gets its pushes.
 */
export async function syncOtherClasses(
  kv: KeyValue, classes: UpdateDeviceClassesBody['classes'], fetchImpl: typeof fetch = fetch,
): Promise<OtherClassesSync> {
  const value = JSON.stringify({ classes });
  const sent = kv.getString(DEVICE_KEYS.classesSent) ?? '';
  if (sent === value) return 'same';
  // None now, and none sent before: nothing to take back.
  if (classes.length === 0 && sent === '') return 'none';
  try {
    const device = await asKnownDevice(kv, (token) =>
      v2<DeviceResponse>('/v2/device/classes', { method: 'PUT', body: value }, token, fetchImpl, SITE_TIMEOUT_MS));
    if (!device) return 'none';
  } catch (err) {
    if (!(err instanceof V2Error) || err.status !== 404) throw err;
    kv.set(DEVICE_KEYS.classesUnsupported, new Date().toISOString());
    return 'unsupported';
  }
  kv.set(DEVICE_KEYS.classesSent, value);
  kv.set(DEVICE_KEYS.classesUnsupported, '');
  return 'sent';
}

/** Whether the server said it cannot follow a parent's other children (`syncOtherClasses`). */
export function otherClassesUnsupported(kv: KeyValue): boolean {
  return Boolean(kv.getString(DEVICE_KEYS.classesUnsupported));
}

/**
 * One of a parent's other children's class feed (`?site=&cls=`), or `null`
 * without a device. A server from before stage 2 ignores the class asked for
 * and answers with the device's own: that one is no answer either.
 */
export async function readFeedOf(kv: KeyValue, siteUrl: string, classId: string, fetchImpl: typeof fetch = fetch): Promise<ClassFeed | null> {
  const path = `/v2/class/feed?site=${encodeURIComponent(siteUrl)}&cls=${encodeURIComponent(classId)}`;
  const feed = await asKnownDevice(kv, (token) => v2<ClassFeed>(path, { method: 'GET' }, token, fetchImpl));
  return feed && feed.class.siteUrl === siteUrl && feed.class.classId === classId ? feed : null;
}
