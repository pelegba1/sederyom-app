/**
 * Source-agnostic delta engine (design-doc §5.1).
 *
 * Every normalized entity has a stable (source, kind, naturalKey) and a
 * content hash. Each poll is diffed against the stored snapshot and produces
 * created / updated / deleted change events.
 *
 * Two properties this must hold, both covered by tests:
 *   - re-polling identical source data emits zero events;
 *   - a single changed field emits exactly one `updated`.
 *
 * Deletion is only ever emitted inside a *complete scope* — a (kind, partition)
 * pair the adapter enumerated exhaustively. An incremental poll declares no
 * complete scope and therefore can never prune.
 */
import type { Source } from '@sederyom/shared';
import type { EntityKind, NormalizedEntity, Scope } from '../adapters/types.js';
import { contentHash } from '../lib/hash.js';

export type ChangeKind = 'created' | 'updated' | 'deleted';

export interface StoredSnapshot {
  source: Source;
  kind: EntityKind;
  naturalKey: string;
  contentHash: string;
  partition: string | null;
  payload: unknown;
  deletedAt: Date | null;
}

export interface SnapshotUpsert {
  source: Source;
  kind: EntityKind;
  naturalKey: string;
  contentHash: string;
  partition: string | null;
  payload: unknown;
  lastSeen: Date;
  /** Set to null on resurrect, to `now` on prune. */
  deletedAt: Date | null;
}

export interface ChangeEventDraft {
  source: Source;
  kind: EntityKind;
  naturalKey: string;
  change: ChangeKind;
  payload: {
    before: unknown;
    after: unknown;
    partition: string | null;
    /**
     * Set on every creation of a source's first successful poll — the one that
     * publishes a whole backlog of homework, grades and exams at once. The
     * notification engine treats that as a backfill, not as news; without the
     * flag a first Mashov login fires one push per row. It is per *poll*, not
     * per kind: the first homework item of the year, arriving a week after a
     * login that found none, is news and must not be swallowed.
     */
    initial?: true;
  };
}

export interface SnapshotStore {
  /** All live and tombstoned rows for the given source and kinds. */
  load(source: Source, kinds: EntityKind[]): Promise<StoredSnapshot[]>;
  apply(upserts: SnapshotUpsert[], touched: { source: Source; kind: EntityKind; naturalKey: string }[], now: Date): Promise<void>;
  recordEvents(events: ChangeEventDraft[]): Promise<void>;
}

export interface DeltaSummary {
  created: number;
  updated: number;
  deleted: number;
  events: ChangeEventDraft[];
}

function keyOf(kind: EntityKind, naturalKey: string): string {
  return `${kind}\u0000${naturalKey}`;
}

function scopeKey(kind: EntityKind, partition: string | null | undefined): string {
  return `${kind}\u0000${partition ?? ''}`;
}

export interface DeltaOptions {
  /** True while this is the source's first successful poll; see `ChangeEventDraft.payload.initial`. */
  initial?: boolean;
  /**
   * Kinds whose first rows are a backlog, not news: while the snapshot has no
   * row of one of them at all (not even a deleted one), what it creates is
   * marked `initial` like a first poll's. The Shahaf list parser read every
   * site's exams as empty until 2026-10-28 (ideas ל2): without this, the
   * first poll after the fix would announce a whole grade's exam schedule,
   * one push per exam.
   */
  backlogKinds?: readonly EntityKind[];
}

export async function applyDelta(
  store: SnapshotStore,
  source: Source,
  entities: NormalizedEntity[],
  completeScopes: Scope[],
  now: Date,
  opts: DeltaOptions = {},
): Promise<DeltaSummary> {
  const kinds = uniqueKinds(entities, completeScopes);
  const stored = await store.load(source, kinds);
  const storedByKey = new Map(stored.map((s) => [keyOf(s.kind, s.naturalKey), s]));
  const backlog = new Set((opts.backlogKinds ?? []).filter((kind) => !stored.some((s) => s.kind === kind)));

  const events: ChangeEventDraft[] = [];
  const upserts: SnapshotUpsert[] = [];
  const touched: { source: Source; kind: EntityKind; naturalKey: string }[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const key = keyOf(entity.kind, entity.naturalKey);
    if (seen.has(key)) continue; // duplicate natural key inside one poll — first wins
    seen.add(key);

    const hash = contentHash(entity.payload);
    const partition = entity.partition ?? null;
    const previous = storedByKey.get(key);

    if (!previous) {
      events.push(draft(source, entity, 'created', null, partition, opts.initial === true || backlog.has(entity.kind)));
      upserts.push({ source, kind: entity.kind, naturalKey: entity.naturalKey, contentHash: hash, partition, payload: entity.payload, lastSeen: now, deletedAt: null });
      continue;
    }
    if (previous.deletedAt !== null) {
      // Came back after having been pruned — that is a creation again.
      events.push(draft(source, entity, 'created', previous.payload, partition));
      upserts.push({ source, kind: entity.kind, naturalKey: entity.naturalKey, contentHash: hash, partition, payload: entity.payload, lastSeen: now, deletedAt: null });
      continue;
    }
    if (previous.contentHash !== hash) {
      events.push(draft(source, entity, 'updated', previous.payload, partition));
      upserts.push({ source, kind: entity.kind, naturalKey: entity.naturalKey, contentHash: hash, partition, payload: entity.payload, lastSeen: now, deletedAt: null });
      continue;
    }
    // Identical: bump freshness only, emit nothing.
    touched.push({ source, kind: entity.kind, naturalKey: entity.naturalKey });
  }

  const scopes = new Set(completeScopes.map((s) => scopeKey(s.kind, s.partition)));
  // A scope declared with no partition covers every partition of that kind.
  const wholeKinds = new Set(completeScopes.filter((s) => s.partition === undefined).map((s) => s.kind));

  for (const row of stored) {
    if (row.deletedAt !== null) continue;
    const key = keyOf(row.kind, row.naturalKey);
    if (seen.has(key)) continue;
    const inScope = wholeKinds.has(row.kind) || scopes.has(scopeKey(row.kind, row.partition));
    if (!inScope) continue;
    events.push({
      source,
      kind: row.kind,
      naturalKey: row.naturalKey,
      change: 'deleted',
      payload: { before: row.payload, after: null, partition: row.partition },
    });
    upserts.push({
      source,
      kind: row.kind,
      naturalKey: row.naturalKey,
      contentHash: row.contentHash,
      partition: row.partition,
      payload: row.payload,
      lastSeen: row.deletedAt ?? now,
      deletedAt: now,
    });
  }

  await store.apply(upserts, touched, now);
  if (events.length > 0) await store.recordEvents(events);

  return {
    created: events.filter((e) => e.change === 'created').length,
    updated: events.filter((e) => e.change === 'updated').length,
    deleted: events.filter((e) => e.change === 'deleted').length,
    events,
  };
}

function draft(
  source: Source,
  entity: NormalizedEntity,
  change: ChangeKind,
  before: unknown,
  partition: string | null,
  initial = false,
): ChangeEventDraft {
  return {
    source,
    kind: entity.kind,
    naturalKey: entity.naturalKey,
    change,
    payload: { before, after: entity.payload, partition, ...(initial ? { initial: true as const } : {}) },
  };
}

function uniqueKinds(entities: NormalizedEntity[], scopes: Scope[]): EntityKind[] {
  const set = new Set<EntityKind>();
  for (const e of entities) set.add(e.kind);
  for (const s of scopes) set.add(s.kind);
  return [...set];
}

/** In-memory store — used by tests and by the fixture-driven dry runs. */
export class MemorySnapshotStore implements SnapshotStore {
  readonly rows = new Map<string, StoredSnapshot>();
  readonly events: ChangeEventDraft[] = [];

  async load(source: Source, kinds: EntityKind[]): Promise<StoredSnapshot[]> {
    const wanted = new Set(kinds);
    return [...this.rows.values()].filter((r) => r.source === source && wanted.has(r.kind));
  }

  async apply(upserts: SnapshotUpsert[]): Promise<void> {
    for (const u of upserts) {
      this.rows.set(`${u.source}\u0000${u.kind}\u0000${u.naturalKey}`, {
        source: u.source,
        kind: u.kind,
        naturalKey: u.naturalKey,
        contentHash: u.contentHash,
        partition: u.partition,
        payload: u.payload,
        deletedAt: u.deletedAt,
      });
    }
  }

  async recordEvents(events: ChangeEventDraft[]): Promise<void> {
    this.events.push(...events);
  }
}
