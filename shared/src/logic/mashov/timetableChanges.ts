/**
 * Mashov's own timetable changes: a substitute, a cancelled lesson, an online
 * lesson, a lesson moved or added. Read from the student's
 * `timetable/changes` (what web.mashov.info/students shows over the weekly
 * grid) for the days the app builds, and applied only where the grid stands in
 * for a week the school's site has not published (`merge.ts`).
 *
 * The answer's shape is known from the site's code only, never from a real
 * answer:
 *
 *   { isEnabled, changes: [{ action, groupId, lessonDate, lesson, teacherName?, groupName? }],
 *     cancellations: [{ groupId, lessonDate, lesson }] }
 *
 * So it is read as defensively as the rest: a row that cannot be placed on a
 * date, a period and a group is dropped, and so is an action this does not
 * know. `isEnabled` says whether the school uses the feature at all.
 */
import type { DateStr, Instant } from '../../index';
import type { EntityKind, NormalizedEntity, Scope } from '../entities';
import type { TimetableChange } from '../merge';
import { dateOf, isPresent, num, pick, str, type BellTime, type MashovGroup, type Row } from './normalize';

export const TIMETABLE_CHANGE_KIND: EntityKind = 'timetable_change';
/** One per read: whether the school uses timetable changes, and when that was read. */
export const TIMETABLE_CHANGE_READ_KIND: EntityKind = 'timetable_change_read';
export const TIMETABLE_CHANGE_SCOPES: Scope[] = [{ kind: TIMETABLE_CHANGE_KIND }, { kind: TIMETABLE_CHANGE_READ_KIND }];
const READ_KEY = 'mashov-timetable-changes';

/** Mashov's action numbers, from the site's enum. Any other number is dropped. */
const ACTIONS: Record<number, TimetableChange['kind']> = {
  0: 'substitute', // MiluyMakom: `teacherName` is the substitute.
  1: 'substitute', // Pinuy: the site shows it as a substitute too.
  2: 'cancelled', // Cancelation.
  3: 'moved', // Move: the lesson is now in this period.
  4: 'extra', // Addition.
  5: 'extra', // Extra.
  8: 'online', // OnlineLesson.
};
const CANCELATION = 2;

export interface MashovTimetableChange extends TimetableChange {
  naturalKey: string;
  /** Mashov's action as sent; a row of `cancellations` counts as a cancellation (2). */
  action: number;
}

export interface MashovTimetableChangeRead {
  /** `null` when the answer did not say. */
  isEnabled: boolean | null;
  /** The last read that got an answer; `null` when none has yet. */
  readAt: Instant | null;
  /** The last read that failed to get one, after `readAt` (`carriedTimetableChanges`); a read that works clears it. */
  failedAt?: Instant | null;
  /** Why it failed, in short. */
  lastError?: string | null;
}

export interface TimetableChangesAnswer {
  isEnabled: boolean | null;
  changes: MashovTimetableChange[];
}

/**
 * The answer, normalized. Not an object: nothing said and nothing changed. A
 * school that says it does not use the feature (`isEnabled: false`) changes
 * nothing, whatever its lists hold.
 */
export function normalizeTimetableChanges(
  raw: unknown,
  groups: Map<string, MashovGroup>,
  bells: Map<number, BellTime>,
  zone: string,
): TimetableChangesAnswer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { isEnabled: null, changes: [] };
  const body = raw as Row;
  const isEnabled = typeof body.isEnabled === 'boolean' ? body.isEnabled : null;
  if (isEnabled === false) return { isEnabled, changes: [] };

  const rows = [
    ...listOf(body.changes).map((r) => normalizeChange(r, null, groups, bells, zone)),
    ...listOf(body.cancellations).map((r) => normalizeChange(r, CANCELATION, groups, bells, zone)),
  ].filter(isPresent);
  // An explicit cancellation and a row of `cancellations` for the same lesson are one change.
  const byKey = new Map(rows.map((c) => [c.naturalKey, c]));
  return { isEnabled, changes: [...byKey.values()] };
}

function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** One row of `changes`, or of `cancellations` when `action` is given. */
function normalizeChange(
  raw: unknown,
  action: number | null,
  groups: Map<string, MashovGroup>,
  bells: Map<number, BellTime>,
  zone: string,
): MashovTimetableChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const code = action ?? num(pick(row, 'action'));
  const kind = code === null ? undefined : ACTIONS[code];
  const date: DateStr | null = dateOf(pick(row, 'lessonDate', 'date'), zone);
  const hour = num(pick(row, 'lesson', 'hour'));
  const groupId = str(pick(row, 'groupId'));
  if (code === null || !kind || !date || hour === null || !groupId) return null;

  const group = groups.get(groupId);
  const bell = bells.get(hour);
  return {
    naturalKey: `mashov-ttchange|${date}|${hour}|${groupId}|${code}`,
    date,
    hourIndex: hour,
    groupId,
    kind,
    action: code,
    // As the grid names its lessons (`normalizeSlot`), so a moved-in lesson reads like the rest.
    subject: str(pick(row, 'subjectName', 'subject')) ?? group?.subject ?? str(pick(row, 'groupName')) ?? group?.groupName ?? null,
    teacher: str(pick(row, 'teacherName')) ?? (kind === 'substitute' ? null : group?.teacher ?? null),
    room: str(pick(row, 'roomNum', 'room')),
    startTime: bell?.startTime ?? null,
    endTime: bell?.endTime ?? null,
  };
}

/** The read as entities: one per change, and the record of what the school said. */
export function timetableChangeEntities(answer: TimetableChangesAnswer, readAt: Instant): NormalizedEntity[] {
  const record: MashovTimetableChangeRead = { isEnabled: answer.isEnabled, readAt };
  return [
    ...answer.changes.map((c): NormalizedEntity => ({ source: 'mashov', kind: TIMETABLE_CHANGE_KIND, naturalKey: c.naturalKey, partition: c.date, payload: c })),
    { source: 'mashov', kind: TIMETABLE_CHANGE_READ_KIND, naturalKey: READ_KEY, payload: record },
  ];
}

/** How much of the error the record keeps. */
const ERROR_LENGTH = 120;

/**
 * For a read whose changes call failed: the changes `previous` (the last
 * read kept) had, and its record, now saying when this read failed and why.
 * A store that keeps each read whole (the phone's) would otherwise lose them,
 * and a cancelled lesson would show as regular until a read works again.
 * With no record before, the record says only the failure.
 */
export function carriedTimetableChanges(previous: readonly NormalizedEntity[], failedAt: Instant, error: string): NormalizedEntity[] {
  const before = previous.find((e) => e.kind === TIMETABLE_CHANGE_READ_KIND)?.payload as MashovTimetableChangeRead | undefined;
  const record: MashovTimetableChangeRead = {
    isEnabled: before?.isEnabled ?? null,
    readAt: before?.readAt ?? null,
    failedAt,
    lastError: error.slice(0, ERROR_LENGTH),
  };
  return [
    ...previous.filter((e) => e.kind === TIMETABLE_CHANGE_KIND),
    { source: 'mashov', kind: TIMETABLE_CHANGE_READ_KIND, naturalKey: READ_KEY, payload: record },
  ];
}
