/**
 * What every adapter produces, on the server or the phone: normalized
 * entities with a stable identity, and the scopes a read covered in full.
 */
import type { Source } from '../index';

export const ENTITY_KINDS = [
  'lesson', 'timetable_slot', 'change', 'exam', 'school_event', 'message', 'homework', 'grade',
  'task', 'calendar_event', 'task_list', 'calendar',
  // Wave 7 (plan §14.2, §14.5).
  'bagrut', 'classroom_work', 'classroom_material',
  // The absence tracker: Mashov's absences and lates, and its lessons-held count per group.
  'attendance', 'lesson_count',
  // Mashov's own timetable changes, and whether the school uses them (`mashov/timetableChanges.ts`).
  'timetable_change', 'timetable_change_read',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface NormalizedEntity<T = unknown> {
  source: Source;
  kind: EntityKind;
  /** Stable identity of the thing across polls. */
  naturalKey: string;
  payload: T;
  /** Sub-scope this entity belongs to, e.g. a week or a date. */
  partition?: string;
}

/**
 * A (kind, partition) pair the poll enumerated *exhaustively*. The delta engine
 * may only emit `deleted` for stored keys inside a complete scope — incremental
 * syncs (Google syncToken) return no complete scope and therefore never prune.
 */
export interface Scope {
  kind: EntityKind;
  partition?: string;
}

/** Thrown when a source rejects our credentials; triggers the relogin push path. */
export class AuthError extends Error {
  readonly needsReauth = true;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface PollResult {
  entities: NormalizedEntity[];
  completeScopes: Scope[];
  /** Freshness the source reports about itself, e.g. Shahaf's "מעודכן ל". */
  sourceFreshness?: Date | null;
}

export interface AdapterContext {
  now: Date;
  /** Shahaf `cls` value for the configured class; unused by the other sources. */
  classId: string;
  logger: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
}

export interface Adapter {
  source: Source;
  poll(ctx: AdapterContext): Promise<PollResult>;
}
