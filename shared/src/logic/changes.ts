/**
 * When the server first saw the change behind a non-regular lesson — what
 * "השינוי פורסם ב־…" shows (`Lesson.changeSeenAt`).
 *
 * Two records can date it, both written by the Shahaf poll:
 *   1. the lesson's own change events. The lesson key carries no status, so a
 *      lesson published regular and cancelled later keeps its key; the
 *      `updated` event that moved it into its current status is the sighting.
 *      A lesson published already changed has a `created` event instead.
 *   2. the row of the site's changes tab for the same day and period, whose
 *      snapshot `firstSeen` is when that row first appeared.
 *
 * The lesson's events are exact (same lesson, same status), so they win; the
 * changes-tab row is the fallback for a lesson whose history does not explain
 * its status. Pure, so it is tested without a database.
 */
import type { DateStr, LessonStatus } from '../index';

/** One `change_event` row of kind `lesson`, oldest first. */
export interface LessonChangeEvent {
  change: string;
  payload: unknown;
  createdAt: Date;
}

/** One `snapshot` row of kind `change` (a line of the site's changes tab). */
export interface ChangeRowSighting {
  payload: unknown;
  firstSeen: Date;
}

interface LessonRef {
  date: DateStr;
  hourIndex: number;
  status: LessonStatus | string;
  source: string;
}

export function resolveChangeSeenAt(
  lesson: LessonRef,
  events: readonly LessonChangeEvent[],
  changeRows: readonly ChangeRowSighting[],
): Date | null {
  if (lesson.status === 'regular' || lesson.source !== 'shahaf') return null;
  return seenInEvents(lesson.status, events) ?? seenInChangeRows(lesson, changeRows);
}

/** The last time the lesson moved into `status` and stayed there. */
function seenInEvents(status: string, events: readonly LessonChangeEvent[]): Date | null {
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let previous: string | null = null;
  let since: Date | null = null;
  for (const event of ordered) {
    const current = event.change === 'deleted' ? null : statusOf(afterOf(event.payload));
    if (current === status && previous !== status) since = event.createdAt;
    if (current !== status) since = null;
    previous = current;
  }
  return since;
}

function seenInChangeRows(lesson: LessonRef, rows: readonly ChangeRowSighting[]): Date | null {
  const sameSlot = rows.filter((r) => {
    const p = r.payload as { date?: unknown; hourIndex?: unknown } | null;
    return p?.date === lesson.date && p.hourIndex === lesson.hourIndex;
  });
  // A row of the same kind is the one about this change; another kind in the
  // same slot (a group sharing the period) is a weaker match.
  const sameKind = sameSlot.filter((r) => (r.payload as { kind?: unknown }).kind === lesson.status);
  const pool = sameKind.length > 0 ? sameKind : sameSlot;
  if (pool.length === 0) return null;
  return pool.reduce((min, r) => (r.firstSeen < min ? r.firstSeen : min), pool[0]!.firstSeen);
}

function afterOf(payload: unknown): unknown {
  return payload && typeof payload === 'object' ? (payload as { after?: unknown }).after : null;
}

function statusOf(lesson: unknown): string | null {
  if (!lesson || typeof lesson !== 'object') return null;
  const status = (lesson as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}
