/**
 * Reading Google Calendar and Tasks on the phone (plan Phase 2d), with the
 * server's adapters (shared) and the phone's sign-in.
 *
 * Both adapters read incrementally (a calendar's syncToken, a list's
 * updatedMin), so the phone keeps what it has and applies each read to it
 * (`applyRead`). The cursors move forward during a read; they are held in
 * memory and saved together with the data, so a read that fails halfway
 * leaves both as they were and the next read starts from the same place.
 * Kept data without cursors, or cursors without data, start over from a
 * full read.
 */
import type { NormalizedEntity, Scope } from '@sederyom/shared/logic/entities';
import { GoogleCalendarAdapter, type CursorStore } from '@sederyom/shared/logic/google/calendar';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { GoogleTasksAdapter } from '@sederyom/shared/logic/google/tasks';
import { applyRead, type KeptEntity } from '@sederyom/shared/logic/snapshot';

export const GOOGLE_MIN_INTERVAL_MIN = 10;
export const GOOGLE_KEYS = { kept: 'google.kept', cursors: 'google.cursors', status: 'google.status' } as const;
/** The server's calendar window: a week back, half a year ahead. */
const WINDOW = { windowDaysBack: 7, windowDaysAhead: 180 };

export interface KeyValue {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface GoogleLocalStatus {
  lastTriedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  needsLogin: boolean;
}

export interface GoogleSyncDeps {
  kv: KeyValue;
  requester: GoogleRequester;
  zone: string;
  now?: () => Date;
  logger?: { warn: (o: unknown, m?: string) => void };
}

export type GoogleSyncOutcome =
  | { kind: 'skipped' }
  // `moved`: how many of the phone's own tasks went into Google right after this read (`moveTasks.ts`).
  | { kind: 'ok'; counts: Record<string, number>; moved?: number }
  | { kind: 'needs-login'; error: string }
  | { kind: 'failed'; error: string };

/**
 * What the quiet sign-in said (`googleSignInState`). The email on the phone
 * proves nothing: it is what the phone remembers, and it stays there after
 * Google stops giving the app access.
 */
export type GoogleSignInState =
  | { kind: 'out' }
  | { kind: 'in' }
  | { kind: 'needs-login'; error: string }
  | { kind: 'failed'; error: string };

const EMPTY: GoogleLocalStatus = { lastTriedAt: null, lastOkAt: null, lastError: null, needsLogin: false };

function load<T>(kv: KeyValue, key: string, fallback: T): T {
  try {
    const raw = kv.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const googleStatus = (kv: KeyValue): GoogleLocalStatus => load(kv, GOOGLE_KEYS.status, EMPTY);
export const googleKept = (kv: KeyValue): KeptEntity[] => load(kv, GOOGLE_KEYS.kept, [] as KeptEntity[]);

/** A cursor store in memory, saved by the caller only when the read succeeds. */
class StagedCursors implements CursorStore {
  constructor(readonly values: Record<string, string>) {}
  async get(key: string) {
    return this.values[key] ?? null;
  }
  async set(key: string, value: string) {
    this.values[key] = value;
  }
  async delete(key: string) {
    delete this.values[key];
  }
}

export function countKinds(kept: readonly KeptEntity[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of kept) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
}

/**
 * `null` for a phone that never signed in. A sign-in that stopped working is
 * written down like a read that failed, or the screens go on saying "מחובר"
 * over data that stopped changing, with nothing to tell why.
 */
export async function syncGoogleBehindSignIn(
  deps: GoogleSyncDeps,
  signIn: GoogleSignInState,
  opts: { force?: boolean } = {},
): Promise<GoogleSyncOutcome | null> {
  if (signIn.kind === 'out') return null;
  if (signIn.kind === 'in') return syncGoogle(deps, opts);
  const needsLogin = signIn.kind === 'needs-login';
  const tried = (deps.now?.() ?? new Date()).toISOString();
  deps.kv.set(GOOGLE_KEYS.status, JSON.stringify({ ...googleStatus(deps.kv), lastTriedAt: tried, lastError: signIn.error, needsLogin }));
  return { kind: signIn.kind, error: signIn.error };
}

export async function syncGoogle(deps: GoogleSyncDeps, opts: { force?: boolean } = {}): Promise<GoogleSyncOutcome> {
  const now = deps.now?.() ?? new Date();
  const status = googleStatus(deps.kv);
  if (!opts.force && status.lastTriedAt && now.getTime() - Date.parse(status.lastTriedAt) < GOOGLE_MIN_INTERVAL_MIN * 60_000) {
    return { kind: 'skipped' };
  }
  const tried = now.toISOString();
  const kept = googleKept(deps.kv);
  // Cursors only make sense next to the data they were read into.
  const cursors = new StagedCursors(kept.length > 0 ? load<Record<string, string>>(deps.kv, GOOGLE_KEYS.cursors, {}) : {});
  const ctx = { now, classId: '', logger: { info: () => {}, warn: deps.logger?.warn ?? (() => {}), error: deps.logger?.warn ?? (() => {}) } };

  try {
    const entities: NormalizedEntity[] = [];
    const scopes: Scope[] = [];
    for (const adapter of [
      new GoogleCalendarAdapter(deps.requester, cursors, { zone: deps.zone, ...WINDOW }),
      new GoogleTasksAdapter(deps.requester, cursors, { zone: deps.zone }),
    ]) {
      const read = await adapter.poll(ctx);
      entities.push(...read.entities);
      scopes.push(...read.completeScopes);
    }
    const next = applyRead(kept, entities, scopes);
    deps.kv.set(GOOGLE_KEYS.kept, JSON.stringify(next));
    deps.kv.set(GOOGLE_KEYS.cursors, JSON.stringify(cursors.values));
    deps.kv.set(GOOGLE_KEYS.status, JSON.stringify({ lastTriedAt: tried, lastOkAt: tried, lastError: null, needsLogin: false }));
    return { kind: 'ok', counts: countKinds(next) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const needsLogin = (err as { needsReauth?: boolean } | null)?.needsReauth === true;
    deps.kv.set(GOOGLE_KEYS.status, JSON.stringify({ ...status, lastTriedAt: tried, lastError: error, needsLogin }));
    return needsLogin ? { kind: 'needs-login', error } : { kind: 'failed', error };
  }
}
