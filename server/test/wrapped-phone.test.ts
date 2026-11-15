/**
 * The year in review on the phone (year wrapped, part 3): the class history is
 * read at most once a day and kept, and what the phone already holds becomes
 * the calculation's input.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClassFeed, ClassHistory } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import type { LocalSources } from '../../app/src/local/days';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { DEVICE_KEYS } = await import('../../app/src/device/v2');
const { WRAPPED_HISTORY_KEY, refreshHistory, storedHistory } = await import('../../app/src/wrapped/history');
const { wrappedInput } = await import('../../app/src/wrapped/input');
const { loadWrapped, wrappedNow } = await import('../../app/src/wrapped/load');

const CLASS = { siteUrl: 'https://dugma.shahaf.site', classId: '53', className: 'יב2' };

function memoryKv(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const withDevice = (more: Record<string, string> = {}) =>
  memoryKv({ [DEVICE_KEYS.identity]: JSON.stringify({ deviceId: 'd1', token: 't1' }), ...more });

function history(over: Partial<ClassHistory> = {}): ClassHistory {
  return {
    class: CLASS,
    coverage: { observedFrom: '2026-10-20', from: '2026-09-01', to: '2026-11-10' },
    lessons: [{
      date: '2026-11-10', hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'אנגלית', teacher: 'לוי דנה', room: '108',
      status: 'cancelled', substitute: null, note: null, source: 'observed', changeSeenAt: '2026-11-09T15:00:00.000Z',
    }],
    exams: [],
    ...over,
  };
}

/** A server that answers the history route, and counts the calls. */
function server(answer: () => { status: number; body: unknown }) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const { status, body } = answer();
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('the class history on the phone', () => {
  it('asks nothing without a device', async () => {
    const { calls, fetchImpl } = server(() => ({ status: 200, body: history() }));
    expect(await refreshHistory(memoryKv(), '2026-11-11', fetchImpl)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reads the whole year, keeps it, and does not ask again that day', async () => {
    const kv = withDevice();
    const { calls, fetchImpl } = server(() => ({ status: 200, body: history() }));
    const first = await refreshHistory(kv, '2026-11-11', fetchImpl);
    expect(first).toMatchObject({ readOn: '2026-11-11', history: { coverage: { to: '2026-11-10' } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/v2\/class\/history$/);
    expect(storedHistory(kv)).toEqual(first);

    expect(await refreshHistory(kv, '2026-11-11', fetchImpl)).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it('asks again the next day', async () => {
    const kv = withDevice();
    let to = '2026-11-10';
    const { calls, fetchImpl } = server(() => ({ status: 200, body: history({ coverage: { observedFrom: '2026-10-20', from: '2026-09-01', to } }) }));
    await refreshHistory(kv, '2026-11-11', fetchImpl);
    to = '2026-11-11';
    expect(await refreshHistory(kv, '2026-11-12', fetchImpl)).toMatchObject({ readOn: '2026-11-12', history: { coverage: { to: '2026-11-11' } } });
    expect(calls).toHaveLength(2);
  });

  it('a server from before the route keeps what the phone had', async () => {
    const kv = withDevice({ [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-10', history: history() }) });
    const { fetchImpl } = server(() => ({ status: 404, body: { message: 'Route GET:/v2/class/history not found' } }));
    expect(await refreshHistory(kv, '2026-11-11', fetchImpl)).toBe('unsupported');
    expect(storedHistory(kv)).toMatchObject({ readOn: '2026-11-10' });
  });

  it('a device with no class has no history, and what was kept goes', async () => {
    const kv = withDevice({ [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-10', history: history() }) });
    const { fetchImpl } = server(() => ({ status: 409, body: { error: 'no_class', message: 'עוד לא נבחרה כיתה.' } }));
    expect(await refreshHistory(kv, '2026-11-11', fetchImpl)).toBeNull();
    expect(storedHistory(kv)).toBeNull();
  });

  it('a history kept for another class is not this class’s', async () => {
    const feed = { class: { ...CLASS, classId: '54', className: 'יב3' } } as ClassFeed;
    const kv = withDevice({
      [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-11', history: history() }),
      [DEVICE_KEYS.feed]: JSON.stringify(feed),
    });
    expect(storedHistory(kv)).toBeNull();
    const other = history({ class: feed.class });
    const { calls, fetchImpl } = server(() => ({ status: 200, body: other }));
    expect(await refreshHistory(kv, '2026-11-11', fetchImpl)).toMatchObject({ history: { class: { classId: '54' } } });
    expect(calls).toHaveLength(1);
  });

  it('a failed read throws, and what was kept stays', async () => {
    const kv = withDevice({ [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-10', history: history() }) });
    const { fetchImpl } = server(() => ({ status: 500, body: { message: 'boom' } }));
    await expect(refreshHistory(kv, '2026-11-11', fetchImpl)).rejects.toThrow();
    expect(storedHistory(kv)).toMatchObject({ readOn: '2026-11-10' });
  });
});

describe('the calculation’s input, from what the phone holds', () => {
  const task = (over: Partial<NormalizedTask>): NormalizedTask => ({
    googleId: 'a', listId: 'l1', listTitle: null, title: 'לקרוא', notes: null, due: null, completed: true,
    completedAt: '2026-11-09T18:20:05.000Z', deleted: false, updated: null, ...over,
  });
  const sources = (over: Partial<LocalSources> = {}): LocalSources => ({
    feed: null,
    mashov: [
      { source: 'mashov', kind: 'lesson_count', naturalKey: 'g1', payload: { groupId: 'g1', subject: 'אנגלית', held: 30, weeklyHours: 4 } },
      { source: 'mashov', kind: 'attendance', naturalKey: 'a1', payload: { date: '2026-11-02', hour: 1, kind: 'late', justified: false, justification: null, groupId: 'g1', subject: 'אנגלית' } },
      { source: 'mashov', kind: 'grade', naturalKey: 'gr1', payload: { naturalKey: 'gr1', date: '2026-10-20', subject: 'אנגלית', value: 97, valueText: null, weight: null, notes: null, isExam: true } },
      { source: 'mashov', kind: 'homework', naturalKey: 'hw1', payload: { naturalKey: 'hw1', date: '2026-11-02', subject: 'אנגלית', text: 'עמוד 12' } },
      { source: 'mashov', kind: 'timetable_slot', naturalKey: 's1', payload: {} },
    ],
    bagrut: [],
    manualExams: [{ naturalKey: 'manual|1', date: '2026-10-29', subject: 'אזרחות', details: null, createdAt: '2026-10-20T10:00:00.000Z' }],
    examPrefs: { renames: { e1: 'בוחן פתע' }, calendarSkip: [], dates: {} },
    google: [
      { kind: 'task', naturalKey: 'a', partition: null, payload: task({}) },
      { kind: 'calendar_event', naturalKey: 'e', partition: null, payload: {} },
    ],
    settings: {
      ...DEFAULT_SETTINGS,
      lessons: { ...DEFAULT_SETTINGS.lessons, hiddenSubjects: ['ספרות'], subjectNames: { 'block:ב': 'פיזיקה' } },
      exams: { hiddenKeys: ['e4'] },
      attendance: { ...DEFAULT_SETTINGS.attendance, daysOff: ['2026-11-09'] },
    },
    homeworkState: {
      hw1: { done: true, linkedTaskId: null, doneAt: '2026-11-02T15:00:00.000Z' },
      // Ticked before the moment was kept, not done, and one whose homework Mashov no longer lists.
      hw2: { done: true, linkedTaskId: null },
      hw3: { done: false, linkedTaskId: null, doneAt: null },
      gone: { done: true, linkedTaskId: null, doneAt: '2026-11-03T15:00:00.000Z' },
    },
    zone: 'Asia/Jerusalem',
    // Half past midnight in Israel on the 11th.
    now: new Date('2026-11-10T22:30:00Z'),
    ...over,
  });

  it('takes the day in Israel, the settings, and each kind from its store', () => {
    const got = wrappedInput(sources(), history());
    expect(got).toMatchObject({
      today: '2026-11-11', zone: 'Asia/Jerusalem', hiddenSubjects: ['ספרות'], subjectNames: { 'block:ב': 'פיזיקה' }, examNames: { e1: 'בוחן פתע' }, hiddenExamKeys: ['e4'], ownDaysOff: ['2026-11-09'],
      manualExams: [{ naturalKey: 'manual|1', date: '2026-10-29', subject: 'אזרחות' }],
      homework: [{ subject: 'אנגלית', doneAt: '2026-11-02T15:00:00.000Z' }, { subject: null, doneAt: '2026-11-03T15:00:00.000Z' }],
    });
    expect(got.history?.coverage.to).toBe('2026-11-10');
    expect(got.mashov?.counts).toEqual([{ groupId: 'g1', subject: 'אנגלית', held: 30, weeklyHours: 4 }]);
    expect(got.mashov?.attendance).toHaveLength(1);
    expect(got.mashov?.grades).toMatchObject([{ date: '2026-10-20', subject: 'אנגלית', value: 97 }]);
    expect(got.tasks).toMatchObject([{ title: 'לקרוא', completedAt: '2026-11-09T18:20:05.000Z' }]);
  });

  it('without Mashov there is no Mashov part', () => {
    expect(wrappedInput(sources({ mashov: [] }), null)).toMatchObject({ mashov: null, history: null });
  });
});

describe('the cards the screen opens with', () => {
  const src: LocalSources = {
    feed: null, mashov: [], bagrut: [], google: [], settings: DEFAULT_SETTINGS, zone: 'Asia/Jerusalem', now: new Date('2026-11-11T10:00:00Z'),
  };
  /** Two school days, each with one lesson of the student's. */
  const twoDays = (): ClassHistory => history({
    lessons: ['2026-11-09', '2026-11-10'].map((date) => ({
      date, hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'אנגלית', teacher: 'לוי דנה', room: '108',
      status: null, substitute: null, note: null, source: 'observed' as const, changeSeenAt: null,
    })),
  });
  const days = (cards: { id: string; value: number }[]) => cards.find((c) => c.id === 'intro')?.value;

  it('before any read: what the phone kept, with no network', () => {
    const kv = withDevice({ [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-10', history: twoDays() }) });
    expect(days(wrappedNow(kv, src))).toBe(2);
    expect(days(wrappedNow(withDevice(), src))).toBe(0);
  });

  it('a read that works gives the fresh history', async () => {
    const { fetchImpl } = server(() => ({ status: 200, body: twoDays() }));
    const got = await loadWrapped(withDevice(), src, fetchImpl);
    expect(got.state).toBe('fresh');
    expect(days(got.cards)).toBe(2);
  });

  it('a read that fails shows what was kept, and says so', async () => {
    const kv = withDevice({ [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-10', history: twoDays() }) });
    const { fetchImpl } = server(() => ({ status: 500, body: {} }));
    const got = await loadWrapped(kv, src, fetchImpl);
    expect(got.state).toBe('kept');
    expect(days(got.cards)).toBe(2);
  });

  it('a read that fails with nothing kept says the timetable cards are missing', async () => {
    const { fetchImpl } = server(() => ({ status: 500, body: {} }));
    const got = await loadWrapped(withDevice(), src, fetchImpl);
    expect(got.state).toBe('missing');
    expect(days(got.cards)).toBe(0);
  });

  it('with no device or class there is nothing to read, and nothing is missing', async () => {
    const { calls, fetchImpl } = server(() => ({ status: 200, body: twoDays() }));
    const got = await loadWrapped(memoryKv(), src, fetchImpl);
    expect(got.state).toBe('fresh');
    expect(calls).toEqual([]);
  });

  it('a server from before the route: what was kept, with nothing said', async () => {
    const kv = withDevice({ [WRAPPED_HISTORY_KEY]: JSON.stringify({ readOn: '2026-11-10', history: twoDays() }) });
    const { fetchImpl } = server(() => ({ status: 404, body: {} }));
    const got = await loadWrapped(kv, src, fetchImpl);
    expect(got.state).toBe('fresh');
    expect(days(got.cards)).toBe(2);
  });

  it('the demo reads nothing', async () => {
    const { calls, fetchImpl } = server(() => ({ status: 200, body: twoDays() }));
    const got = await loadWrapped(withDevice(), src, fetchImpl, true);
    expect(got.state).toBe('fresh');
    expect(calls).toEqual([]);
    expect(days(got.cards)).toBe(0);
  });
});
