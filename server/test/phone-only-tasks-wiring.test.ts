/**
 * Tasks kept on the phone alone, wired in (app/src/local/phoneApi.ts and
 * app/src/local/source.ts): the app's api adds, reads, ticks and deletes them
 * without Google, the sources every screen reads follow a change, and
 * disconnecting Google leaves them.
 *
 * The phone's natives are fakes and the storage is a Map. The signed-in Google
 * account is none, as for someone who has not connected it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { PHONE_TASKS_COPY, addPhoneTask, changePhoneTask, isPhoneTaskId, readPhoneTasks } from '../../app/src/local/phoneTasks';

const h = vi.hoisted(() => {
  const map = new Map<string, string | boolean>();
  /** Every call that would leave the phone, or touch what the system shows. */
  const calls: string[] = [];
  const noted = (name: string) => (..._args: unknown[]) => {
    calls.push(name);
    return Promise.resolve(null);
  };
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
  return { map, calls, noted, storage };
});

vi.mock('react-native-mmkv', () => ({ createMMKV: () => h.storage }));
// The friends' random source (app/src/buddies/random.ts), reached through the refresh.
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('@react-native-cookies/cookies', () => ({
  default: { get: h.noted('Cookies.get'), set: h.noted('Cookies.set'), clearAll: h.noted('Cookies.clearAll') },
}));
vi.mock('@react-native-google-signin/google-signin', () => ({
  // Nobody is signed in to Google.
  GoogleSignin: {
    configure: () => {},
    hasPreviousSignIn: () => false,
    getCurrentUser: () => null,
    signIn: h.noted('Google.signIn'),
    signInSilently: h.noted('Google.signInSilently'),
    hasPlayServices: h.noted('Google.hasPlayServices'),
    getTokens: h.noted('Google.getTokens'),
    clearCachedAccessToken: h.noted('Google.clearCachedAccessToken'),
    revokeAccess: h.noted('Google.revokeAccess'),
    signOut: h.noted('Google.signOut'),
  },
  isCancelledResponse: () => false,
  isSuccessResponse: () => true,
}));
vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: h.noted('Notifications.schedule'),
  cancelScheduledNotificationAsync: h.noted('Notifications.cancel'),
  dismissNotificationAsync: h.noted('Notifications.dismiss'),
  getAllScheduledNotificationsAsync: h.noted('Notifications.getAllScheduled'),
  getPresentedNotificationsAsync: h.noted('Notifications.getPresented'),
  cancelAllScheduledNotificationsAsync: h.noted('Notifications.cancelAll'),
  dismissAllNotificationsAsync: h.noted('Notifications.dismissAll'),
}));
vi.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Available: 2 },
  BackgroundTaskResult: { Success: 1 },
  getStatusAsync: h.noted('BackgroundTask.getStatus'),
  registerTaskAsync: h.noted('BackgroundTask.register'),
}));
vi.mock('expo-task-manager', () => ({ defineTask: () => {}, isTaskRegisteredAsync: h.noted('TaskManager.isRegistered') }));
// The widget's own modules: drawing it again is the phone's, and noted apart.
vi.mock('../../app/src/widget/update', () => ({ requestWidgetUpdate: () => void h.calls.push('widget') }));
vi.mock('../../app/src/api/hooks', () => ({ refreshWidgetFeed: h.noted('refreshWidgetFeed') }));

// Loaded by paths TypeScript does not follow: these modules import the native
// sign-in, whose React Native types clash with Node's in the server's typecheck.
const APP = '../../app/src';
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ `${APP}/${path}`)) as T;

interface TaskRow { id: string; title: string; completed: boolean; listId: string }
const { phoneApi } = await load<{
  phoneApi: {
    tasks: () => Promise<{ items: TaskRow[]; lists: { id: string; title: string }[] }>;
    createTask: (body: { title: string }) => Promise<TaskRow>;
    updateTask: (id: string, body: { completed?: boolean }) => Promise<TaskRow>;
    deleteTask: (id: string) => Promise<{ ok: boolean }>;
    disconnectGoogle: () => Promise<{ ok: boolean }>;
  };
}>('local/phoneApi');
const { loadLocalSources } = await load<{ loadLocalSources: () => { google: KeptEntity[] } }>('local/source');

const titlesOf = (google: readonly KeptEntity[]) => google.filter((e) => e.kind === 'task').map((e) => (e.payload as { title: string }).title);

describe('tasks on the phone alone, wired in', () => {
  beforeEach(() => {
    h.map.clear();
    h.calls.length = 0;
  });

  it("adds through the app's api without Google", async () => {
    const t = await phoneApi.createTask({ title: 'א' });
    expect(isPhoneTaskId(t.id)).toBe(true);
    const read = await phoneApi.tasks();
    expect(read.items.map((x) => x.title)).toEqual(['א']);
    expect(read.lists).toEqual([{ id: 'phone', title: 'המשימות שלי' }]);
    expect(h.calls).toEqual([]);
  });

  it('ticks and deletes through the api, by the id', async () => {
    const t = await phoneApi.createTask({ title: 'א' });
    await phoneApi.updateTask(t.id, { completed: true });
    expect((await phoneApi.tasks()).items).toMatchObject([{ id: t.id, completed: true }]);
    await expect(phoneApi.deleteTask(t.id)).resolves.toEqual({ ok: true });
    expect((await phoneApi.tasks()).items).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('says so when the task is not on the phone any more', async () => {
    await expect(phoneApi.updateTask('phone-gone', { completed: true })).rejects.toThrow(PHONE_TASKS_COPY.moved);
    await expect(phoneApi.deleteTask('phone-gone')).rejects.toThrow(PHONE_TASKS_COPY.moved);
  });

  it("a parent's phone, without Google, is told to connect and keeps nothing", async () => {
    h.map.set('settings.user', JSON.stringify({ audience: 'parent' }));
    await expect(phoneApi.createTask({ title: 'א' })).rejects.toThrow(PHONE_TASKS_COPY.needGoogle);
    expect(readPhoneTasks(h.storage)).toEqual([]);
  });

  it('the sources follow a change on the phone', () => {
    // Read once first, so a stale read would be the one answered.
    expect(titlesOf(loadLocalSources().google)).toEqual([]);
    const t = addPhoneTask(h.storage, { title: 'א' });
    expect(titlesOf(loadLocalSources().google)).toEqual(['א']);
    changePhoneTask(h.storage, t.googleId, { title: 'ב' });
    expect(titlesOf(loadLocalSources().google)).toEqual(['ב']);
  });

  it('disconnecting leaves the phone tasks', async () => {
    h.map.set('google.kept', JSON.stringify([{ kind: 'task_list', naturalKey: 'l1', partition: null, payload: { id: 'l1', title: 'משימות' } }]));
    const t = addPhoneTask(h.storage, { title: 'א' });
    await phoneApi.disconnectGoogle();
    expect(h.map.has('google.kept')).toBe(false);
    expect(readPhoneTasks(h.storage).map((x) => x.googleId)).toEqual([t.googleId]);
  });
});
