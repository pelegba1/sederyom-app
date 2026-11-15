/**
 * When the phone first saw each grade (app/src/mashov/gradeFirstSeen.ts), for
 * the grades tab's "חדש": a first read does not make every grade new, later
 * reads stamp only what they brought, and the screens get `firstSeen` from it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';

vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  FIRST_SEEN_KEY, KNOWN_BEFORE, MAX_KEYS, firstSeenOf, readFirstSeen, recordFirstSeen, stampFirstSeen, withFirstSeen,
} = await import('../../app/src/mashov/gradeFirstSeen');
const { syncMashov, KEYS } = await import('../../app/src/mashov/sync');

const ZONE = 'Asia/Jerusalem';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const entity = (kind: string, naturalKey: string): NormalizedEntity =>
  ({ source: 'mashov', kind, naturalKey, payload: {} }) as unknown as NormalizedEntity;
const g = (key: string) => entity('grade', key);

/** `isNew` in SchoolScreen.tsx, as it reads a grade. */
const isNew = (firstSeen: string | null, seenAt: string | null) => Boolean(firstSeen && seenAt && firstSeen > seenAt);

const READ_1 = '2026-10-20T08:00:00.000Z';
const READ_2 = '2026-10-21T08:00:00.000Z';
// The grades tab was last left between the reads (or, on an update, long before them).
const LEFT_TAB = '2026-10-20T12:00:00.000Z';

describe('the first read', () => {
  it('on a new phone: every grade it brings is from before the count, none of them new', () => {
    const map = stampFirstSeen(null, null, [g('a'), g('b'), entity('homework', 'h')], READ_1);
    expect(map).toEqual({ a: KNOWN_BEFORE, b: KNOWN_BEFORE });
    expect(['a', 'b'].map((k) => isNew(firstSeenOf(map, k), '2020-01-01T00:00:00.000Z'))).toEqual([false, false]);
  });

  it('on an updated phone: what the kept read had is from before; what this read adds is new, as its note says', () => {
    const map = stampFirstSeen(null, [g('a'), g('b')], [g('a'), g('b'), g('c')], READ_2);
    expect(map).toEqual({ a: KNOWN_BEFORE, b: KNOWN_BEFORE, c: READ_2 });
    expect(isNew(firstSeenOf(map, 'a'), LEFT_TAB)).toBe(false);
    expect(isNew(firstSeenOf(map, 'c'), LEFT_TAB)).toBe(true);
  });
});

describe('later reads', () => {
  it('stamp only the grades they bring first, with their own time', () => {
    const first = stampFirstSeen(null, null, [g('a')], READ_1);
    const second = stampFirstSeen(first, [g('a')], [g('a'), g('b')], READ_2);
    expect(second).toEqual({ a: KNOWN_BEFORE, b: READ_2 });
    // A third read leaves both as they were.
    expect(stampFirstSeen(second, [g('a'), g('b')], [g('a'), g('b')], '2026-10-22T08:00:00.000Z')).toEqual(second);
  });

  it('a first read with no grades leaves an empty map, and the grades that come later are new', () => {
    const first = stampFirstSeen(null, null, [entity('homework', 'h')], READ_1);
    expect(first).toEqual({});
    expect(stampFirstSeen(first, [], [g('a')], READ_2)).toEqual({ a: READ_2 });
  });

  it('a grade missing from one read keeps its stamp when it comes back', () => {
    const map = { a: KNOWN_BEFORE, b: READ_1 };
    const partial = stampFirstSeen(map, [g('a'), g('b')], [g('a')], READ_2);
    expect(partial).toEqual(map);
    expect(stampFirstSeen(partial, [g('a')], [g('a'), g('b')], '2026-10-22T08:00:00.000Z')).toEqual(map);
  });

  it(`past ${MAX_KEYS} keys the oldest go, never one of this read`, () => {
    const map: Record<string, string> = { kept: KNOWN_BEFORE };
    for (let i = 0; i < MAX_KEYS; i++) map[`old-${i}`] = new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString();
    const next = stampFirstSeen(map, null, [g('kept'), g('fresh')], READ_2);
    expect(Object.keys(next)).toHaveLength(MAX_KEYS);
    expect(next.kept).toBe(KNOWN_BEFORE);
    expect(next.fresh).toBe(READ_2);
    expect(next['old-0']).toBeUndefined();
    expect(next['old-1']).toBeUndefined();
    expect(next[`old-${MAX_KEYS - 1}`]).toBeDefined();
  });
});

describe('kept on the phone', () => {
  it('written by each read that worked, and only when it changed', () => {
    const kv = memoryKv();
    recordFirstSeen(kv, null, [g('a')], READ_1);
    expect(readFirstSeen(kv)).toEqual({ a: KNOWN_BEFORE });
    const set = vi.spyOn(kv, 'set');
    recordFirstSeen(kv, [g('a')], [g('a')], READ_2);
    expect(set).not.toHaveBeenCalled();
    recordFirstSeen(kv, [g('a')], [g('a'), g('b')], READ_2);
    expect(set).toHaveBeenCalledOnce();
    expect(readFirstSeen(kv)).toEqual({ a: KNOWN_BEFORE, b: READ_2 });
  });

  it('a map that does not parse counts as none', () => {
    const kv = memoryKv();
    kv.set(FIRST_SEEN_KEY, '[1,2]');
    expect(readFirstSeen(kv)).toBeNull();
    kv.set(FIRST_SEEN_KEY, '{oops');
    expect(readFirstSeen(kv)).toBeNull();
  });

  it('through syncMashov: the first read marks nothing new, the next one marks the grade it brought', async () => {
    const kv = memoryKv();
    let grades = [{ gradeId: 1, subjectName: 'אנגלית', grade: 90, eventDate: '2026-10-01', gradingEvent: 'מבחן' }];
    const api = {
      timetable: async () => [], homework: async () => [], grades: async () => grades, behave: async () => [],
      lessonsCount: async () => [], groups: async () => [], bells: async () => [], mail: async () => [],
      conversation: async () => ({}), bagrutGrades: async () => [], bagrutSheelonim: async () => [],
    } as unknown as MashovApi;
    const read = (iso: string) => syncMashov({ kv, api: async () => api, zone: ZONE, now: () => new Date(iso) }, { force: true, bagrut: false });

    expect((await read(READ_1)).kind).toBe('ok');
    const keys = () => (JSON.parse(kv.map.get(KEYS.read)!).entities as NormalizedEntity[]).filter((e) => e.kind === 'grade').map((e) => e.naturalKey);
    const [firstKey] = keys();
    expect(firstKey).toBeDefined();
    expect(readFirstSeen(kv)).toEqual({ [firstKey!]: KNOWN_BEFORE });

    grades = [...grades, { gradeId: 2, subjectName: 'מתמטיקה', grade: 80, eventDate: '2026-10-20', gradingEvent: 'בוחן' }];
    expect((await read(READ_2)).kind).toBe('ok');
    const secondKey = keys().find((k) => k !== firstKey);
    expect(secondKey).toBeDefined();
    expect(readFirstSeen(kv)).toEqual({ [firstKey!]: KNOWN_BEFORE, [secondKey!]: READ_2 });
  });
});

describe('what the screens get (phoneApi grades())', () => {
  it('firstSeen from the map: the stamp, null for a grade from before the count or not in it', () => {
    const map = { a: KNOWN_BEFORE, b: READ_2 };
    const grades = [{ naturalKey: 'a', value: 90 }, { naturalKey: 'b', value: 80 }, { naturalKey: 'c', value: 70 }];
    expect(withFirstSeen(grades, map)).toEqual([
      { naturalKey: 'a', value: 90, firstSeen: null },
      { naturalKey: 'b', value: 80, firstSeen: READ_2 },
      { naturalKey: 'c', value: 70, firstSeen: null },
    ]);
    expect(withFirstSeen(grades, null).map((x) => x.firstSeen)).toEqual([null, null, null]);
    // Only the one stamped after the tab was left is "חדש".
    expect(withFirstSeen(grades, map).filter((x) => isNew(x.firstSeen, LEFT_TAB)).map((x) => x.naturalKey)).toEqual(['b']);
  });
});
