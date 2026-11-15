/**
 * Mashov's answers, normalized: groups, bells, the weekly grid, homework and
 * grades. Pure, and shared: the server reads them today, the phone will
 * (plan Phase 2c).
 */
import type { DateStr } from '../../index';
import { DateTime } from 'luxon';
import { clockTime } from './fields';

export function isPresent<T>(v: T | null): v is T {
  return v !== null;
}

export interface Row {
  [key: string]: unknown;
}

export function pick(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== '') return direct;
    // Mashov nests the interesting fields one level down more often than not.
    for (const value of Object.values(row)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = (value as Row)[key];
        if (nested !== undefined && nested !== null && nested !== '') return nested;
      }
    }
  }
  return undefined;
}

export function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function dateOf(v: unknown, zone: string): DateStr | null {
  const s = str(v);
  if (!s) return null;
  const dt = DateTime.fromISO(s, { zone });
  return dt.isValid ? dt.toISODate() : null;
}

/**
 * The first of `keys` that holds a date. Unlike `dateOf(pick(...))`, a key
 * that is present but holds something else (a name, a number) does not end
 * the search — it falls through to the next key.
 */
function firstDate(row: Row, zone: string, ...keys: string[]): DateStr | null {
  for (const key of keys) {
    const date = dateOf(pick(row, key), zone);
    if (date) return date;
  }
  return null;
}

export interface MashovSlot {
  /** 1 = Sunday in Mashov's numbering; normalized here to 0 = Sunday. */
  dayOfWeek: number;
  hourIndex: number;
  subject: string;
  teacher: string | null;
  room: string | null;
  groupName: string | null;
  /** Filled from /api/bells; null when the school publishes no bell schedule. */
  startTime: string | null;
  endTime: string | null;
  /** Mashov's group: what its timetable changes name the lesson by (`timetableChanges.ts`). */
  groupId?: string | null;
}

export interface MashovGroup {
  groupId: string;
  subject: string | null;
  teacher: string | null;
  groupName: string | null;
}

export interface BellTime {
  hourIndex: number;
  startTime: string | null;
  endTime: string | null;
}

export function buildGroupIndex(rows: unknown[]): Map<string, MashovGroup> {
  const index = new Map<string, MashovGroup>();
  for (const group of rows.map(normalizeGroup).filter(isPresent)) index.set(group.groupId, group);
  return index;
}

export function buildBellIndex(rows: unknown[]): Map<number, BellTime> {
  const index = new Map<number, BellTime>();
  for (const bell of rows.map(normalizeBell).filter(isPresent)) index.set(bell.hourIndex, bell);
  return index;
}

export function normalizeGroup(raw: unknown): MashovGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const id = str(pick(row, 'groupId', 'id'));
  if (!id) return null;
  return {
    groupId: id,
    subject: str(pick(row, 'subjectName', 'subject')),
    teacher: teacherOf(row),
    groupName: str(pick(row, 'groupName')),
  };
}

export function normalizeBell(raw: unknown): BellTime | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  // `lessonNumber` is the real field, confirmed against a live /api/bells body.
  // The rest are kept as fallbacks in case the shape drifts.
  const index = num(pick(row, 'lessonNumber', 'bell', 'bellId', 'lesson', 'hour'));
  if (index === null) return null;
  return {
    hourIndex: index,
    startTime: clockTime(pick(row, 'startTime', 'start', 'from')),
    endTime: clockTime(pick(row, 'endTime', 'end', 'to')),
  };
}

function teacherOf(row: Row): string | null {
  const teachers = pick(row, 'groupTeachers');
  if (Array.isArray(teachers)) {
    const names = teachers
      .map((t) => str((t as Row | undefined)?.teacherName))
      .filter((n): n is string => n !== null);
    return names.length > 0 ? names.join(', ') : null;
  }
  return str(pick(row, 'teacherName'));
}

export function normalizeSlot(
  raw: unknown,
  groups: Map<string, MashovGroup> = new Map(),
  bells: Map<number, BellTime> = new Map(),
): MashovSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const day = num(pick(row, 'day'));
  const hour = num(pick(row, 'lesson', 'hour'));
  if (day === null || hour === null) return null;

  const groupId = str(pick(row, 'groupId'));
  const group = groupId ? groups.get(groupId) : undefined;
  // The row's own fields win; the group is the fallback, not the other way round.
  const subject = str(pick(row, 'subjectName', 'subject')) ?? group?.subject ?? str(pick(row, 'groupName')) ?? group?.groupName;
  if (!subject) return null;

  const bell = bells.get(hour);
  return {
    dayOfWeek: (day - 1 + 7) % 7,
    hourIndex: hour,
    subject,
    teacher: teacherOf(row) ?? group?.teacher ?? null,
    room: str(pick(row, 'roomNum', 'room')),
    groupName: str(pick(row, 'groupName')) ?? group?.groupName ?? null,
    startTime: bell?.startTime ?? null,
    endTime: bell?.endTime ?? null,
    groupId: groupId ?? null,
  };
}

export interface MashovHomework {
  naturalKey: string;
  dueDate: DateStr | null;
  /**
   * True only when Mashov sent an explicit due/submission date. False when
   * `dueDate` is the lesson date (or null): the projection then derives the
   * due date from the next lesson of the same subject.
   */
  dueExplicit: boolean;
  subject: string;
  text: string;
}

export function normalizeHomework(raw: unknown, zone: string): MashovHomework | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  const text = str(pick(row, 'homework', 'homeWork', 'remark', 'text'));
  const subject = str(pick(row, 'subjectName', 'subject', 'groupName')) ?? 'כללי';
  if (!text) return null;
  // `lessonDate` is the lesson the homework was entered on — when it was
  // *given*. "Due today" needs the submission date, so any explicit due field
  // wins and the lesson date is only the fallback. No captured /homework body
  // has shown a due field yet (only /api/bells is a fixture); until one does,
  // a Mashov row's `dueDate` may still be its lesson date — `dueExplicit` says
  // which, so the projection knows when to derive one.
  const explicitDue = dateOf(pick(row, 'dueDate', 'submissionDate', 'submitDate'), zone);
  const dueDate = explicitDue ?? dateOf(pick(row, 'lessonDate', 'date'), zone);
  const id = str(pick(row, 'homeworkId', 'id'));
  // The identity keeps its old date, so this change does not re-key (and
  // re-announce) homework already stored.
  const keyDate = dateOf(pick(row, 'lessonDate', 'dueDate', 'date'), zone);
  return {
    naturalKey: id ? `mashov-hw|${id}` : `mashov-hw|${keyDate ?? ''}|${subject}|${text.slice(0, 120)}`,
    dueDate,
    dueExplicit: explicitDue !== null,
    subject,
    text,
  };
}

export interface MashovGrade {
  naturalKey: string;
  date: DateStr;
  subject: string;
  value: number | null;
  valueText: string | null;
  weight: number | null;
  notes: string | null;
  isExam: boolean;
}

export function normalizeGrade(raw: unknown, zone: string): MashovGrade | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Row;
  // `gradingEvent` is the assessment's name ("מבחן יחידה 3"), not a date. It
  // used to sit among these keys: with no `gradingEventDate`, the name was
  // picked, failed to parse, and the whole grade was dropped.
  const date = firstDate(row, zone, 'gradingEventDate', 'eventDate', 'date', 'timestamp');
  const subject = str(pick(row, 'subjectName', 'subject', 'groupName'));
  if (!date || !subject) return null;
  const value = num(pick(row, 'grade', 'gradeValue'));
  const eventType = str(pick(row, 'gradingEvent', 'gradeTypeDesc', 'eventType'));
  const id = str(pick(row, 'gradeId', 'id'));
  return {
    naturalKey: id ? `mashov-grade|${id}` : `mashov-grade|${date}|${subject}|${value ?? ''}`,
    date,
    subject,
    value,
    valueText: value === null ? str(pick(row, 'grade', 'gradeText')) : null,
    weight: num(pick(row, 'rate', 'weight')),
    notes: eventType,
    isExam: eventType !== null && /מבחן|בחינה/.test(eventType),
  };
}
