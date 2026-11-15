/**
 * The dates a student set for exams, kept up at each refresh of the sources (app/src/local/source.ts,
 * `refreshLocalSources`): an entry the school's list has contradicted, or whose own date is long past, is
 * taken away; one whose exam the list does not carry is left alone; a parent's other children are not touched.
 * The rules themselves are exam-prefs.test.ts's (`pruneExamDates`); this is that the refresh makes them.
 *
 * The phone's natives are fakes, as in chat-phone-refresh.test.ts; the storage is a Map, and `/v2` answers "not found".
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassFeed } from '@sederyom/shared';

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
  /**
   * What this refresh's reads come to: Mashov's outcome, and the class feed (`ok`, `empty`: a site nothing was read from, or
   * `fail`); `classBoard`: the class the feed is of has an exam board (a calendar).
   */
  const reads = { mashov: 'failed' as 'ok' | 'failed' | 'skipped', feed: 'ok' as 'ok' | 'empty' | 'fail', classBoard: false };
  return { map, storage, nothing, reads };
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
// The friends' step is not what is tried here.
vi.mock('../../app/src/buddies/run', () => ({ refreshBuddies: () => Promise.resolve() }));
// Mashov's read is what the test says it was: `kind: 'ok'` is a read of this refresh, anything else is not.
vi.mock('../../app/src/mashov/run', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, syncMashovNow: async () => (h.reads.mashov === 'ok' ? { kind: 'ok', read: {} } : h.reads.mashov === 'skipped' ? { kind: 'skipped', reason: 'recent' } : { kind: 'failed', error: 'x' }) };
});

/** `/v2` as the phone sees it: the class feed (what `h.reads.feed` says), and "not found" for the rest. */
vi.stubGlobal('fetch', async (url: string) => {
  const path = url.replace(/^.*?(\/v2)/, '$1');
  if (path.startsWith('/v2/class/feed')) {
    if (h.reads.feed === 'fail') return new Response(JSON.stringify({ error: 'internal', message: 'boom' }), { status: 500 });
    const feed = h.reads.classBoard ? { ...FEED, class: { ...FEED.class, examCalendarId: 'board@group.calendar.google.com' } } : FEED;
    return new Response(JSON.stringify(h.reads.feed === 'empty' ? { ...feed, exams: [], lessons: [], events: [] } : feed), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'not_found', message: url }), { status: 404 });
});
afterAll(() => vi.unstubAllGlobals());

// Loaded by paths TypeScript does not follow, as chat-phone-refresh.test.ts does: the refresh reaches the native sign-in.
const APP = '../../app/src';
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ `${APP}/${path}`)) as T;

/** Tuesday 17.11.2026: the 9th has left the feed's window (seven days back) by a day. */
const NOW = new Date('2026-11-17T08:00:00Z');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const source = await load<{ refreshLocalSources: () => Promise<{ problems: string[] }> }>('local/source');
const { EXAM_PREFS_KEY, readExamPrefs } = await load<typeof import('../../app/src/local/examPrefs')>('local/examPrefs');
const { stashKey } = await load<typeof import('../../app/src/local/children')>('local/children');
const { keepOwnRows, keepWithoutClassBoard, readOwnBoard } = await load<typeof import('../../app/src/local/ownBoard')>('local/ownBoard');

const school = (key: string, date: string, subject: string): ClassFeed['exams'][number] => ({ naturalKey: key, date, subject, details: null, source: 'school_site' });
const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: NOW.toISOString(),
  freshness: null,
  lessons: [],
  changes: [],
  // As the server sends it on the 17th: nothing before the 10th.
  exams: [school('site-exam|moved', '2026-11-20', 'מבחן במתמטיקה'), school('site-exam|same', '2026-11-25', 'מבחן באנגלית')],
  events: [],
  messages: [],
};
const COPY = { subject: 'מבחן בהיסטוריה', details: null, source: 'school_site' };

const phone = (prefs: unknown) => {
  // The class on screen is the feed's: a fresh feed of another class is no read of this one's exams (ledger L234).
  h.storage.set('settings.user', JSON.stringify({ className: 'יב2', classId: '7' }));
  h.storage.set('device.feed', JSON.stringify(FEED));
  h.storage.set(EXAM_PREFS_KEY, JSON.stringify(prefs));
};

beforeEach(() => {
  h.map.clear();
  h.map.set('onboarded', true);
  h.reads.mashov = 'failed';
  h.reads.feed = 'ok';
  h.reads.classBoard = false;
});

describe('the refresh of the sources, with dates the student set for exams', () => {
  it('takes away the date the school contradicted and the one long past, and leaves the rest of the prefs and the others as they are', async () => {
    phone({
      renames: { 'site-exam|moved': 'המתמטיקה שלי' },
      calendarSkip: ['site-exam|same'],
      dates: {
        // The school moved it from the 18th to the 20th since.
        'site-exam|moved': { date: '2026-12-01', sourceDate: '2026-11-18' },
        'site-exam|same': { date: '2026-12-02', sourceDate: '2026-11-25' },
        // The student's own date is more than seven days past, and so is the school's.
        'k|dead': { date: '2026-11-01', sourceDate: '2026-10-20' },
        // The feed does not carry them, and nothing says the school took them away.
        'k|absent': { date: '2026-12-05', sourceDate: '2026-11-30' },
        'k|shown-copy': { date: '2026-11-30', sourceDate: '2026-11-09', kept: COPY },
      },
    });
    await source.refreshLocalSources();

    const prefs = readExamPrefs(h.storage);
    expect(Object.keys(prefs.dates).sort()).toEqual(['k|absent', 'k|shown-copy', 'site-exam|same']);
    expect(prefs.dates['k|shown-copy']).toEqual({ date: '2026-11-30', sourceDate: '2026-11-09', kept: COPY });
    expect(prefs.renames).toEqual({ 'site-exam|moved': 'המתמטיקה שלי' });
    expect(prefs.calendarSkip).toEqual(['site-exam|same']);
  });

  it('writes nothing when nothing goes, and does not touch the dates kept for a parent\'s other children', async () => {
    const mine = { renames: {}, calendarSkip: [], dates: { 'site-exam|same': { date: '2026-12-02', sourceDate: '2026-11-25' } } };
    phone(mine);
    const before = h.storage.getString(EXAM_PREFS_KEY);
    // Another child's, aside: an entry that would go if it were this child's.
    const aside = JSON.stringify({ renames: {}, calendarSkip: [], dates: { 'site-exam|moved': { date: '2026-12-01', sourceDate: '2026-11-18' }, 'k|dead': { date: '2026-11-01', sourceDate: '2026-10-20' } } });
    h.storage.set(stashKey('c2', EXAM_PREFS_KEY), aside);
    await source.refreshLocalSources();
    expect(h.storage.getString(EXAM_PREFS_KEY)).toBe(before);
    expect(h.storage.getString(stashKey('c2', EXAM_PREFS_KEY))).toBe(aside);
  });
});

/**
 * What a refresh may conclude from an exam that is not on any list: only when the read of the source its copy came from
 * worked in that very refresh (`examSourcesRead`), and while the school's date is still inside the feed's window.
 */
describe('the refresh of the sources, with copies of exams the student moved', () => {
  const copy = (source: string, subject: string) => ({ subject, details: null, source });
  /** Four exams no source lists: three from the 12th (inside the window), by where they came from; one from the 9th (out of it). */
  const withCopies = () => {
    phone({
      renames: {}, calendarSkip: [],
      dates: {
        'k|site': { date: '2026-12-01', sourceDate: '2026-11-12', kept: copy('school_site', 'מבחן בהיסטוריה') },
        'k|shahaf': { date: '2026-12-01', sourceDate: '2026-11-12', kept: copy('shahaf', 'מבחן בכימיה') },
        'k|mashov': { date: '2026-12-01', sourceDate: '2026-11-12', kept: copy('mashov', 'מבחן בגיאוגרפיה') },
        'k|aged': { date: '2026-12-02', sourceDate: '2026-11-09', kept: copy('school_site', 'מבחן בספרות') },
      },
    });
    // A device, so that the class feed is read at all.
    h.storage.set('device.identity', JSON.stringify({ deviceId: 'd1', token: 't1' }));
  };
  const withCopy = (): string[] => Object.entries(readExamPrefs(h.storage).dates).filter(([, d]) => d.kept).map(([k]) => k).sort();
  const entries = (): string[] => Object.keys(readExamPrefs(h.storage).dates).sort();
  const ALL = ['k|aged', 'k|mashov', 'k|shahaf', 'k|site'];

  it('forgets the copies of the site exams and the class exams once the feed was read and does not list them, and keeps their dates', async () => {
    withCopies();
    await source.refreshLocalSources();
    // The 9th is outside the window: its copy is the one that stands in. Mashov was not read.
    expect(withCopy()).toEqual(['k|aged', 'k|mashov']);
    expect(entries()).toEqual(ALL);
    expect(readExamPrefs(h.storage).dates['k|site']).toEqual({ date: '2026-12-01', sourceDate: '2026-11-12' });
  });

  it('forgets nothing when the feed read failed, or was a site nothing has been read from', async () => {
    for (const feed of ['fail', 'empty'] as const) {
      withCopies();
      h.reads.feed = feed;
      await source.refreshLocalSources();
      expect(withCopy(), feed).toEqual(ALL);
    }
  });

  it('forgets the copy from Mashov by a Mashov read of this refresh alone, and the copy from the feed by the feed read', async () => {
    withCopies();
    h.reads.feed = 'fail';
    h.reads.mashov = 'ok';
    await source.refreshLocalSources();
    expect(withCopy()).toEqual(['k|aged', 'k|shahaf', 'k|site']);

    // Mashov not read this time (a read a few minutes ago, a failure): its copy stays.
    for (const mashov of ['skipped', 'failed'] as const) {
      withCopies();
      h.reads.feed = 'ok';
      h.reads.mashov = mashov;
      await source.refreshLocalSources();
      expect(withCopy(), mashov).toEqual(['k|aged', 'k|mashov']);
    }
  });

  it('takes the school_site exams from a board of the student own as it is stored, whether or not the feed was read', async () => {
    withCopies();
    keepOwnRows(h.storage, [{ date: '2026-11-20', title: 'ספרות', details: null }], NOW);
    h.reads.feed = 'fail';
    await source.refreshLocalSources();
    // The board does not list it, and the board is on the phone: the class board's copy goes. The site's exams are still the feed's, not read.
    expect(withCopy()).toEqual(['k|aged', 'k|mashov', 'k|shahaf']);
  });

  it('forgets nothing by a fresh feed of another class than the one on screen (ledger L234)', async () => {
    withCopies();
    // the child (or class) on screen is 8; the device still follows 7, whose feed came back
    h.storage.set('settings.user', JSON.stringify({ className: 'יב3', classId: '8' }));
    await source.refreshLocalSources();
    expect(withCopy()).toEqual(ALL);
  });

  it('with the class board turned off, forgets the site\'s copies by the feed and none of the class board\'s (A-I5, A-M1)', async () => {
    withCopies();
    h.reads.classBoard = true;
    keepWithoutClassBoard(h.storage, NOW);
    await source.refreshLocalSources();
    expect(withCopy()).toEqual(['k|aged', 'k|mashov', 'k|site']);
    expect(readOwnBoard(h.storage)?.kind).toBe('none');
  });

  it('takes away the class board turned off once a refresh sees the class has no board (A-M5)', async () => {
    withCopies();
    keepWithoutClassBoard(h.storage, NOW);
    await source.refreshLocalSources();
    expect(readOwnBoard(h.storage)).toBeNull();
    // and a feed that could not be read sees nothing of it
    withCopies();
    keepWithoutClassBoard(h.storage, NOW);
    h.reads.feed = 'fail';
    await source.refreshLocalSources();
    expect(readOwnBoard(h.storage)?.kind).toBe('none');
  });
});
