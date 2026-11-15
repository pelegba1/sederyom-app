/**
 * Reading Mashov on the phone and keeping the result (plan Phase 2c).
 *
 * The rules are the server's (`readMashov`, shared); what is the phone's is
 * when it reads and where it keeps the answer:
 * - On every return to the app, at most every `MIN_INTERVAL_MIN`: the read is
 *   also what keeps the session alive, since Mashov renews it on any request
 *   past half its hour.
 * - The last good read stays until a newer one replaces it. A refused session
 *   marks "needs login" and keeps the data: an old timetable beats an empty one.
 * - Message bodies already read, and bagrut's once-a-day rhythm, carry over
 *   between reads, as the server's store does for it. So do the timetable
 *   changes when their call fails, with the failure on their record, and the
 *   older messages when a later inbox page fails.
 * - Each read that works stamps the grades it saw first (`gradeFirstSeen.ts`),
 *   for the grades tab's "חדש".
 *
 * Pure apart from what it is given: storage, the API and the clock.
 */
import type { BagrutExam } from '@sederyom/shared';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';
import { isBagrutDue } from '@sederyom/shared/logic/mashov/bagrut';
import type { StoredMessage } from '@sederyom/shared/logic/mashov/messages';
import { readMashov, type MashovRead } from '@sederyom/shared/logic/mashov/read';
import { TIMETABLE_CHANGE_READ_KIND, carriedTimetableChanges, type MashovTimetableChangeRead } from '@sederyom/shared/logic/mashov/timetableChanges';
import { recordFirstSeen } from './gradeFirstSeen';

export const MIN_INTERVAL_MIN = 10;
export const KEYS = { read: 'mashov.read', status: 'mashov.status', bagrut: 'mashov.bagrut' } as const;

/** The last good read: every entity, as the server would have stored it. */
export interface LocalMashovRead {
  at: string;
  entities: NormalizedEntity[];
  counts: MashovRead['counts'];
}

export interface LocalMashovStatus {
  lastTriedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Mashov refused the session, or there is none: the person has to log in. */
  needsLogin: boolean;
  /** When `needsLogin` first came on for this outage; `null` while the session works. */
  failedAt?: string | null;
  /** When the person logged in to the session now held (the token's `LoginTime`); the 8-hour cap counts from it. */
  loginAt?: string | null;
}

export interface LocalBagrut {
  readAt: string | null;
  failedAt: string | null;
  exams: BagrutExam[];
}

/** The storage this needs: MMKV in the app, a Map in tests. */
export interface KeyValue {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface SyncDeps {
  kv: KeyValue;
  /** Throws `AuthError` when there is no login to read with. */
  api: () => Promise<MashovApi>;
  zone: string;
  now?: () => Date;
  /** The held session's login time, read from the phone's cookie (`MashovTokenInfo.loginAt`). */
  loginAt?: () => Promise<string | null>;
  /**
   * Tried once when Mashov refuses the session, before anything is saved:
   * `true` when a new session is in the jar and the read can run again. It is
   * told the status that is kept if it does not bring one.
   */
  renew?: (refused: LocalMashovStatus) => Promise<boolean>;
}

export type SyncOutcome =
  | { kind: 'skipped'; reason: 'recent' }
  | { kind: 'ok'; read: LocalMashovRead }
  | { kind: 'needs-login'; error: string }
  | { kind: 'failed'; error: string };

const EMPTY_STATUS: LocalMashovStatus = { lastTriedAt: null, lastOkAt: null, lastError: null, needsLogin: false };

function load<T>(kv: KeyValue, key: string): T | null {
  try {
    const raw = kv.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function localStatus(kv: KeyValue): LocalMashovStatus {
  return load<LocalMashovStatus>(kv, KEYS.status) ?? EMPTY_STATUS;
}

export function localRead(kv: KeyValue): LocalMashovRead | null {
  return load<LocalMashovRead>(kv, KEYS.read);
}

export function localBagrut(kv: KeyValue): LocalBagrut | null {
  return load<LocalBagrut>(kv, KEYS.bagrut);
}

/**
 * The next read runs even within `MIN_INTERVAL_MIN` of the last: another of a
 * parent's children just went on screen, and its read is not the last one's.
 */
export function readMashovSoon(kv: KeyValue): void {
  const status = load<LocalMashovStatus>(kv, KEYS.status);
  if (status?.lastTriedAt) kv.set(KEYS.status, JSON.stringify({ ...status, lastTriedAt: null }));
}

/**
 * Whether the school uses Mashov's timetable changes, as the last read heard
 * it; `null` before a read has asked, or when Mashov did not say.
 */
export function timetableChangesEnabled(entities: readonly NormalizedEntity[] | undefined): boolean | null {
  const record = changeReadRecord(entities);
  return typeof record?.isEnabled === 'boolean' ? record.isEnabled : null;
}

/** Whether the last read's timetable changes call failed (its changes are the read before's). */
export function timetableChangesFailed(entities: readonly NormalizedEntity[] | undefined): boolean {
  return Boolean(changeReadRecord(entities)?.failedAt);
}

function changeReadRecord(entities: readonly NormalizedEntity[] | undefined): MashovTimetableChangeRead | undefined {
  return entities?.find((e) => e.kind === TIMETABLE_CHANGE_READ_KIND)?.payload as MashovTimetableChangeRead | undefined;
}

/** The message bodies the last read had, so this one fetches only what is new. */
function storedMessages(read: LocalMashovRead | null): Map<string, StoredMessage> {
  const stored = new Map<string, StoredMessage>();
  for (const e of read?.entities ?? []) {
    if (e.kind === 'message') stored.set(e.naturalKey, e.payload as StoredMessage);
  }
  return stored;
}

/** When a message was sent, as a timestamp; null when Mashov gave it no date (or none that parses). */
export function messageTime(e: NormalizedEntity): number | null {
  const date = (e.payload as { date?: unknown } | null)?.date;
  const time = typeof date === 'string' ? Date.parse(date) : NaN;
  return Number.isNaN(time) ? null : time;
}

/**
 * For a read whose inbox ended early (a later page failed): the stored messages
 * older than every one this read got, which its pages never reached. The read
 * is kept whole, so they would vanish until a read gets that far again. An
 * undated one is not carried: only a date shows it lay past the pages read.
 */
export function carriedMessages(previous: readonly NormalizedEntity[], current: readonly NormalizedEntity[]): NormalizedEntity[] {
  const messages = current.filter((e) => e.kind === 'message');
  const times = messages.map(messageTime).filter((t): t is number => t !== null);
  if (times.length === 0) return [];
  const oldest = Math.min(...times);
  const seen = new Set(messages.map((e) => e.naturalKey));
  return previous.filter((e) => {
    if (e.kind !== 'message' || seen.has(e.naturalKey)) return false;
    const time = messageTime(e);
    return time !== null && time < oldest;
  });
}

/** `bagrut: false` skips the daily bagrut read (a middle-school class). */
export async function syncMashov(deps: SyncDeps, opts: { force?: boolean; bagrut?: boolean } = {}): Promise<SyncOutcome> {
  const now = deps.now?.() ?? new Date();
  const status = localStatus(deps.kv);
  if (!opts.force && status.lastTriedAt && now.getTime() - Date.parse(status.lastTriedAt) < MIN_INTERVAL_MIN * 60_000) {
    return { kind: 'skipped', reason: 'recent' };
  }
  const save = (next: LocalMashovStatus) => deps.kv.set(KEYS.status, JSON.stringify(next));
  const tried = now.toISOString();

  const previous = localRead(deps.kv);
  const bagrut = localBagrut(deps.kv);
  // Middle school sits no bagrut: no point asking Mashov for it every day.
  const readBagrut = opts.bagrut !== false && isBagrutDue(
    bagrut?.readAt ? new Date(bagrut.readAt) : null,
    bagrut?.failedAt ? new Date(bagrut.failedAt) : null,
    now,
    deps.zone,
  );

  try {
    const api = await deps.api();
    let changesError = 'unknown error';
    const result = await readMashov(api, {
      zone: deps.zone, storedMessages: storedMessages(previous), readBagrut, now,
      onWarning: (part, err) => {
        if (part === 'timetable changes') changesError = err.message;
      },
    });
    // The changes call failed: the ones the last read had stay, since the read is kept whole and a
    // lost cancellation would show the lesson as regular, and their record says this read failed.
    const withChanges = result.counts.timetableChanges === null
      ? [...result.entities, ...carriedTimetableChanges(previous?.entities ?? [], tried, changesError)]
      : result.entities;
    // An inbox page failed: the older messages the last read had stay, as Mashov did not say they went.
    const entities = result.mailComplete
      ? withChanges
      : [...withChanges, ...carriedMessages(previous?.entities ?? [], result.entities)];
    const read: LocalMashovRead = { at: tried, entities, counts: result.counts };
    deps.kv.set(KEYS.read, JSON.stringify(read));
    recordFirstSeen(deps.kv, previous?.entities ?? null, result.entities, tried);
    if (result.bagrut) deps.kv.set(KEYS.bagrut, JSON.stringify({ readAt: tried, failedAt: null, exams: result.bagrut } satisfies LocalBagrut));
    else if (result.bagrutFailed) deps.kv.set(KEYS.bagrut, JSON.stringify({ readAt: bagrut?.readAt ?? null, failedAt: tried, exams: bagrut?.exams ?? [] } satisfies LocalBagrut));
    const loginAt = await deps.loginAt?.().catch(() => null) ?? null;
    save({ lastTriedAt: tried, lastOkAt: tried, lastError: null, needsLogin: false, failedAt: null, loginAt: loginAt ?? status.loginAt ?? null });
    return { kind: 'ok', read };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const needsLogin = (err as { needsReauth?: boolean } | null)?.needsReauth === true;
    const failed: LocalMashovStatus = { ...status, lastTriedAt: tried, lastError: error, needsLogin, failedAt: needsLogin ? (status.failedAt ?? tried) : (status.failedAt ?? null) };
    // Every screen reads this status as it stands, so "needs a login" waits for the renewal's
    // answer: saved first, it showed "משוב ניתק את החיבור" for the seconds the pass took
    // (iPhone, 2026-11-07), and an app closed in between kept it until the next read.
    if (needsLogin && deps.renew && (await deps.renew(failed).catch(() => false))) {
      return syncMashov({ ...deps, renew: undefined }, { ...opts, force: true });
    }
    save(failed);
    return needsLogin ? { kind: 'needs-login', error } : { kind: 'failed', error };
  }
}
