/**
 * The demo keeps away from the network (app/src/demo/mode.ts): with its
 * switch on, a refresh, the summaries, the background refresh and its
 * registration, and every call the screens make go nowhere: no fetch, no
 * Google, no Mashov cookie, no notification scheduled. What the visitor does
 * still works on the phone, and leaving wipes the phone and tells no one.
 *
 * The phone's natives are fakes that note every call; the storage is a Map.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

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
  // Asking the native module who is signed in stays on the phone; everything else would not.
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

vi.stubGlobal('fetch', (url: unknown) => {
  h.calls.push(`fetch ${String(url)}`);
  return Promise.reject(new Error('offline'));
});
// The demo is built around today, and a Shabbat or a holiday has no lessons: a plain school
// Wednesday, from demo-data.test.ts's week without a holiday, set before the modules load.
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00+02:00') });
afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Loaded by paths TypeScript does not follow: these modules import the native
// sign-in, whose React Native types clash with Node's in the server's typecheck.
const APP = '../../app/src';
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ `${APP}/${path}`)) as T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...args: any[]) => Promise<any>>;
const { enterDemo, isDemo } = await load<{ enterDemo: () => void; isDemo: () => boolean }>('demo/phone');
const { DEMO_COPY } = await load<{ DEMO_COPY: { notSaved: string } }>('demo/mode');
const { DEMO_CLASS } = await load<{ DEMO_CLASS: { id: string; name: string } }>('demo/data');
const { appApi } = await load<{ appApi: Api }>('demo/api');
const source = await load<{
  refreshLocalSources: (opts?: { force?: boolean }) => Promise<{ problems: string[]; device: { deviceId: string | null } }>;
  rescheduleSummaries: () => Promise<void>;
  loadLocalSources: () => { feed: { class: { className: string } } | null };
}>('local/source');
const background = await load<{ backgroundRefresh: (by: 'task' | 'widget') => Promise<void>; registerBackgroundRefresh: () => Promise<void> }>('background/refresh');
const { leaveDemoNow } = await load<{ leaveDemoNow: () => Promise<void> }>('local/deleteMyDataRun');

describe('the demo, kept away from the network', () => {
  it('is entered on the phone alone, with its class', () => {
    h.map.set('onboarded', true);
    enterDemo();
    expect(isDemo()).toBe(true);
    expect(JSON.parse(h.storage.getString('settings.user') ?? '{}')).toMatchObject({ classId: DEMO_CLASS.id });
    expect(source.loadLocalSources().feed?.class.className).toBe(DEMO_CLASS.name);
    expect(h.calls).toEqual([]);
  });

  it('refreshes nothing and schedules nothing', async () => {
    await expect(source.refreshLocalSources({ force: true })).resolves.toEqual({ problems: [], device: { deviceId: null, className: null, siteUrl: null } });
    await source.rescheduleSummaries();
    expect(h.calls).toEqual([]);
  });

  it('never runs, or registers, the refresh with the app closed', async () => {
    await background.backgroundRefresh('task');
    await background.backgroundRefresh('widget');
    await background.registerBackgroundRefresh();
    expect(h.calls).toEqual([]);
    expect(h.map.has('background.lastRun')).toBe(false);
  });

  it('answers every call the screens make on the phone, and the visitor\'s changes stay', async () => {
    const day = await appApi.day!();
    expect(day.timeline.length).toBeGreaterThan(0);
    await appApi.week!(0);
    await appApi.agenda!(14);
    await appApi.widgetFeed!();
    const status = await appApi.status!();
    expect(status.sources.every((s: { configured: boolean; message: string | null }) => s.configured && s.message === null)).toBe(true);

    const settings = await appApi.settings!();
    expect(settings.classes).toEqual([DEMO_CLASS]);
    expect(settings.schoolSiteUrl).toBeNull();
    const saved = await appApi.saveSettings!({ vacationMode: true, classId: DEMO_CLASS.id });
    expect(saved.settings.vacationMode).toBe(true);
    await appApi.saveSettings!({ vacationMode: false });

    const school = await appApi.school!();
    expect(school.grades.length).toBeGreaterThan(0);
    expect(school.messages.length).toBeGreaterThan(0);
    const open = school.homework.find((hw: { done: boolean }) => !hw.done);
    await expect(appApi.setHomeworkDone!(open.naturalKey, true)).resolves.toMatchObject({ done: true });
    expect((await appApi.bagrut!()).exams.length).toBeGreaterThan(0);
    expect((await appApi.attendance!()).subjects.length).toBeGreaterThan(0);
    expect((await appApi.notifications!()).items.length).toBeGreaterThan(0);

    const before = (await appApi.tasks!()).items.length;
    const made = await appApi.createTask!({ title: 'לקנות סוללות', due: null, fromHomeworkKey: open.naturalKey });
    expect(made.linkedHomeworkKey).toBe(open.naturalKey);
    await appApi.updateTask!(made.id, { completed: true });
    const after = await appApi.tasks!();
    expect(after.items).toHaveLength(before + 1);
    expect(after.items.find((t: { id: string }) => t.id === made.id)?.completed).toBe(true);
    await appApi.deleteTask!(made.id);
    expect((await appApi.tasks!()).items).toHaveLength(before);

    await expect(appApi.lookUpSchoolSite!('https://example.shahaf.site')).rejects.toThrow(DEMO_COPY.notSaved);
    await appApi.goWithoutSite!();
    await appApi.sync!();
    await appApi.disconnectMashov!();
    await appApi.disconnectGoogle!();
    expect(h.calls).toEqual([]);
  });

  it('is left with the phone wiped, and nothing sent', async () => {
    await leaveDemoNow();
    expect(h.calls).toEqual(['Notifications.cancelAll', 'Notifications.dismissAll', 'widget']);
    expect(h.map.size).toBe(0);
    expect(isDemo()).toBe(false);
  });

  it('answers as the phone again once it is left', async () => {
    const status = await appApi.status!();
    expect(status.sources.find((s: { source: string }) => s.source === 'mashov')?.configured).toBe(false);
  });
});
