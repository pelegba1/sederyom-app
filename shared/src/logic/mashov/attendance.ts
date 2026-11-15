/**
 * Attendance from Mashov, for the absence tracker (חיסורים). Shapes confirmed
 * against real answers, de-identified in `server/test/fixtures/mashov-attendance/`:
 *
 * - `/behave`: every behaviour event of the year, one row per event and
 *   lesson — `achvaCode` (61 חיסור, 62 איחור; the rest are homework, dress,
 *   praise…), `lessonDate`, `lesson` (the period), `groupId`, `lessonId`, and
 *   the justification: `justificationId` -1 ("ללא הערות", none yet), 0 ("לא
 *   מוצדק") or a positive id once one was approved ("פעילות בית ספרית", "אישור
 *   רפואי"…), with its name in `justification`.
 * - `/lessonsCount`: one row per group — `lessonsCount` (the lessons held so
 *   far, the school's own denominator) and `weeklyHours`.
 *
 * Both are read with every Mashov poll and stored as complete scopes. They
 * carry no notifications: `notify/engine.ts` ignores both kinds.
 */
import type { AttendanceEvent, DateStr } from '../../index';
import type { EntityKind, NormalizedEntity, Scope } from '../entities';
import type { MashovGroup } from './normalize';

export const ATTENDANCE_KIND: EntityKind = 'attendance';
export const LESSON_COUNT_KIND: EntityKind = 'lesson_count';
export const ATTENDANCE_SCOPES: Scope[] = [{ kind: ATTENDANCE_KIND }, { kind: LESSON_COUNT_KIND }];

/** Mashov's codes, from `/api/achvas`. */
const ABSENCE_CODE = 61;
const LATE_CODE = 62;

export interface AttendancePayload extends AttendanceEvent {
  groupId: string | null;
  subject: string | null;
}

export interface LessonCountPayload {
  groupId: string;
  subject: string;
  held: number;
  weeklyHours: number | null;
}

type Row = Record<string, unknown>;

function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

/** `2026-09-07T00:00:00` → `2026-09-07`. Mashov writes Israel local time with no offset. */
function dayOf(v: unknown): DateStr | null {
  const s = text(v);
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m ? m[1]! : null;
}

/** One absence or late; null for every other kind of event, and for a row without a date. */
export function normalizeAttendance(raw: unknown, groups: Map<string, MashovGroup>): (AttendancePayload & { naturalKey: string }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const code = int(row.achvaCode ?? row.eventCode);
  const kind = code === ABSENCE_CODE ? 'absence' : code === LATE_CODE ? 'late' : null;
  if (!kind) return null;
  const date = dayOf(row.lessonDate);
  if (!date) return null;

  const groupId = text(row.groupId);
  const justificationId = int(row.justificationId) ?? -1;
  const justified = justificationId > 0;
  const lessonId = text(row.lessonId);
  const hour = int(row.lesson);
  return {
    naturalKey: `mashov-att|${lessonId ?? `${date}|${hour ?? ''}|${groupId ?? ''}`}|${code}`,
    date,
    hour,
    kind,
    justified,
    justification: justified ? text(row.justification) : null,
    groupId,
    subject: text(row.subject) ?? (groupId ? groups.get(groupId)?.subject ?? null : null),
  };
}

/** One group's lessons-held count; null for a row with no group or no subject to name it by. */
export function normalizeLessonCount(raw: unknown, groups: Map<string, MashovGroup>): LessonCountPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const groupId = text(row.groupId);
  const held = int(row.lessonsCount);
  if (!groupId || held === null) return null;
  const group = groups.get(groupId);
  const subject = group?.subject ?? group?.groupName;
  if (!subject) return null;
  return { groupId, subject, held, weeklyHours: int(row.weeklyHours) };
}

/** Both reads as snapshot entities, for one poll. */
export function attendanceEntities(behave: unknown[], counts: unknown[], groups: Map<string, MashovGroup>): NormalizedEntity[] {
  const out: NormalizedEntity[] = [];
  // A key twice in one poll would trip the delta engine; the later row wins.
  const events = new Map<string, NormalizedEntity>();
  for (const raw of behave) {
    const event = normalizeAttendance(raw, groups);
    if (!event) continue;
    const { naturalKey, ...payload } = event;
    events.set(naturalKey, { source: 'mashov', kind: ATTENDANCE_KIND, naturalKey, payload });
  }
  out.push(...events.values());
  for (const raw of counts) {
    const count = normalizeLessonCount(raw, groups);
    if (count) out.push({ source: 'mashov', kind: LESSON_COUNT_KIND, naturalKey: `mashov-count|${count.groupId}`, payload: count });
  }
  return out;
}
