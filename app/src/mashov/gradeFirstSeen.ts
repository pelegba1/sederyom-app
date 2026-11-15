/**
 * When the phone first saw each Mashov grade, for the "חדש" marker on the
 * grades tab (`SchoolScreen`: a grade first seen after the tab was last left
 * is new, and the tab's count says how many). The server used to say it
 * (`Grade.firstSeen`); the phone reads Mashov itself now, so it keeps its own
 * map, `naturalKey → ISO instant`, brought up to date by every read that
 * worked (`syncMashov`).
 *
 * The first read is not "everything is new":
 * - While there is no map, every grade the phone already had is stamped
 *   `KNOWN_BEFORE` (the epoch), earlier than any visit, so none of them is
 *   marked. "Already had" is the read kept from before when there is one (a
 *   phone updating from a version without the map, whose grades tab was last
 *   left when the server still said what was new), and otherwise, on the
 *   phone's very first read, everything that read brought.
 * - From then on a grade that is not in the map is stamped with the time of
 *   the read that brought it. On an update that is just what the read before
 *   did not have: the grades the student was told of (`addedItems`).
 *
 * `KNOWN_BEFORE` reaches the screens as `null`: when such a grade was first
 * seen is not known, only that it was not lately.
 *
 * A grade missing from a read keeps its stamp: a read with part of the list
 * would otherwise mark the rest new when they come back. Past `MAX_KEYS` the
 * oldest stamps go, never one the last read had.
 *
 * Known limit: another Mashov account on the same phone has other keys, so
 * the first read after the switch marks all of its grades new, as the notes
 * call them new.
 *
 * Pure: the storage is passed in (MMKV in the app, a Map in tests).
 */
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';

export const FIRST_SEEN_KEY = 'mashov.gradeFirstSeen';
/** The stamp of a grade the phone had before it kept count: never "new". */
export const KNOWN_BEFORE = new Date(0).toISOString();
export const MAX_KEYS = 2000;

/** `naturalKey → when the phone first saw the grade` (ISO). */
export type FirstSeen = Record<string, string>;

interface Kv {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

const has = (map: FirstSeen, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

function gradeKeys(entities: readonly NormalizedEntity[]): string[] {
  return entities.filter((e) => e.kind === 'grade').map((e) => e.naturalKey);
}

/** The map as kept, or `null` before the first read made one (or when it does not parse). */
export function readFirstSeen(kv: Kv): FirstSeen | null {
  try {
    const raw = kv.getString(FIRST_SEEN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map: FirstSeen = {};
    for (const [key, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'string') map[key] = at;
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * The map after a read that brought `current`, read at `at` (ISO); `map` is
 * the one kept (`null`: none yet) and `previous` the read kept before this one.
 * Pure.
 */
export function stampFirstSeen(
  map: FirstSeen | null,
  previous: readonly NormalizedEntity[] | null,
  current: readonly NormalizedEntity[],
  at: string,
): FirstSeen {
  const next: FirstSeen = { ...(map ?? {}) };
  if (map === null) {
    for (const key of gradeKeys(previous ?? current)) next[key] = KNOWN_BEFORE;
  }
  const now = gradeKeys(current);
  for (const key of now) {
    if (!has(next, key)) next[key] = at;
  }
  const keys = Object.keys(next);
  if (keys.length <= MAX_KEYS) return next;
  // Too many: every grade of this read stays, then the newest of the rest.
  const inRead = new Set(now);
  const rest = keys.filter((k) => !inRead.has(k)).sort((a, b) => (next[b]! < next[a]! ? -1 : next[b]! > next[a]! ? 1 : 0));
  const keep = [...inRead, ...rest.slice(0, Math.max(0, MAX_KEYS - inRead.size))];
  return Object.fromEntries(keep.map((k) => [k, next[k]!]));
}

/** After a read that worked: the map brought up to date and kept (written only when it changed). */
export function recordFirstSeen(kv: Kv, previous: readonly NormalizedEntity[] | null, current: readonly NormalizedEntity[], at: string): void {
  const map = readFirstSeen(kv);
  const next = stampFirstSeen(map, previous, current, at);
  const before = map ? Object.keys(map).length : -1;
  const changed = before !== Object.keys(next).length || Object.keys(next).some((k) => map?.[k] !== next[k]);
  if (changed) kv.set(FIRST_SEEN_KEY, JSON.stringify(next));
}

/** A grade's `firstSeen` for the screens: the stamp, or `null` when unknown or from before the count (`KNOWN_BEFORE`). */
export function firstSeenOf(map: FirstSeen | null, naturalKey: string): string | null {
  const at = map && has(map, naturalKey) ? map[naturalKey]! : null;
  return at === null || at === KNOWN_BEFORE ? null : at;
}

/** Grades with their `firstSeen` filled from the map, as `phoneApi` hands them to the screens. */
export function withFirstSeen<T extends { naturalKey: string }>(grades: readonly T[], map: FirstSeen | null): (T & { firstSeen: string | null })[] {
  return grades.map((g) => ({ ...g, firstSeen: firstSeenOf(map, g.naturalKey) }));
}
