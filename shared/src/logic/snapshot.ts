/**
 * Keeping the latest of each entity on the phone (plan Phase 2d).
 *
 * The server's delta engine keeps snapshots in Postgres and emits change
 * events. The phone needs the first half only: what is true now. Google's
 * incremental reads (a calendar's syncToken, Tasks' updatedMin) return just
 * what changed, so a read cannot simply replace what is kept. This applies a
 * read the way the delta engine does: every entity replaces its own (kind,
 * key), and inside a scope the read covered in full, whatever it did not
 * return is gone.
 */
import type { EntityKind, NormalizedEntity, Scope } from './entities';

export interface KeptEntity {
  kind: EntityKind;
  naturalKey: string;
  partition: string | null;
  payload: unknown;
}

const keyOf = (kind: string, naturalKey: string): string => `${kind}\u0000${naturalKey}`;

function inScope(e: KeptEntity, scope: Scope): boolean {
  return e.kind === scope.kind && (scope.partition === undefined || e.partition === scope.partition);
}

export function applyRead(kept: readonly KeptEntity[], entities: readonly NormalizedEntity[], completeScopes: readonly Scope[]): KeptEntity[] {
  const byKey = new Map<string, KeptEntity>();
  for (const e of kept) byKey.set(keyOf(e.kind, e.naturalKey), e);

  const seen = new Set<string>();
  for (const e of entities) {
    const key = keyOf(e.kind, e.naturalKey);
    seen.add(key);
    byKey.set(key, { kind: e.kind, naturalKey: e.naturalKey, partition: e.partition ?? null, payload: e.payload });
  }

  for (const [key, e] of byKey) {
    if (!seen.has(key) && completeScopes.some((scope) => inScope(e, scope))) byKey.delete(key);
  }
  return [...byKey.values()];
}
