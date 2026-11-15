/**
 * One full read of Mashov, as entities (design-doc §6.3; plan Phase 2c).
 *
 * Moved out of the server's adapter so the phone reads Mashov with exactly
 * the same rules: which endpoints, how a timetable row becomes a lesson (its
 * group and the bell schedule), that a grade is never an exam too, which message
 * bodies are read, and that attendance, bagrut and the timetable changes
 * never fail the read.
 * Transport, storage and logging stay with the caller.
 */
import { DateTime } from 'luxon';
import type { BagrutExam } from '../../index';
import type { NormalizedEntity, Scope } from '../entities';
import { LESSON_HORIZON } from '../merge';
import { addDays } from '../time';
import type { MashovApi } from './api';
import { ATTENDANCE_SCOPES, attendanceEntities } from './attendance';
import { normalizeBagrut } from './bagrut';
import { readInbox, readMessages, type StoredMessage } from './messages';
import { buildBellIndex, buildGroupIndex, isPresent, normalizeGrade, normalizeHomework, normalizeSlot } from './normalize';
import { TIMETABLE_CHANGE_SCOPES, normalizeTimetableChanges, timetableChangeEntities } from './timetableChanges';

export interface MashovReadOptions {
  zone: string;
  /**
   * Message bodies already read, by natural key. Null: read no bodies at all
   * (without the store every read would fetch the same few again).
   */
  storedMessages: ReadonlyMap<string, StoredMessage> | null;
  /** Read bagrut this time (at most daily: `isBagrutDue`). */
  readBagrut: boolean;
  /** A part that failed without failing the read: attendance, bagrut, the timetable changes, one message body, a later page of the inbox. */
  onWarning?: (part: string, error: Error) => void;
  /** The read's moment: which days the timetable changes are asked for, and when they were read. */
  now?: Date;
}

export interface MashovRead {
  entities: NormalizedEntity[];
  /** What this read covered in full, for the delta engine's pruning. */
  scopes: Scope[];
  /** The bagrut exams, when read; `null` when not due or when the read failed (`bagrutFailed`). */
  bagrut: BagrutExam[] | null;
  bagrutFailed: boolean;
  /** False when a later inbox page failed: the messages are cut short, so older ones that are stored are not gone. */
  mailComplete: boolean;
  counts: {
    slots: number; homework: number; grades: number; mail: number; mailPages: number; mailBodies: number; groups: number; bells: number;
    attendance: number | null; timetableChanges: number | null;
  };
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

export async function readMashov(api: MashovApi, opts: MashovReadOptions): Promise<MashovRead> {
  const [timetable, homework, grades, mail, groups, bells] = await Promise.all([
    api.timetable(),
    api.homework(),
    api.grades(),
    api.mail(),
    api.groups(),
    api.bells(),
  ]);

  // Mashov timetable rows carry a period number and a group, not a subject and
  // not a clock time. These two lookups are what turn a row into a lesson.
  const groupIndex = buildGroupIndex(groups);
  const bellIndex = buildBellIndex(bells);

  const entities: NormalizedEntity[] = [];
  const scopes: Scope[] = [{ kind: 'timetable_slot' }, { kind: 'homework' }, { kind: 'grade' }, { kind: 'message' }];

  for (const slot of timetable.map((r) => normalizeSlot(r, groupIndex, bellIndex)).filter(isPresent)) {
    entities.push({
      source: 'mashov',
      kind: 'timetable_slot',
      naturalKey: `mashov-slot|${slot.dayOfWeek}|${slot.hourIndex}|${slot.subject}`,
      partition: `dow:${slot.dayOfWeek}`,
      payload: slot,
    });
  }

  for (const hw of homework.map((r) => normalizeHomework(r, opts.zone)).filter(isPresent)) {
    entities.push({ source: 'mashov', kind: 'homework', naturalKey: hw.naturalKey, payload: hw });
  }

  // A grade is a grade, never an exam as well: an exam's grade comes after the exam, and the date a graded row carries
  // can be the day the grade came out. Read as an exam, a grade given on a Saturday evening was "an exam today"
  // (14.11.2026). Mashov's exams are bagrut's alone (`bagrut.ts`).
  for (const grade of grades.map((r) => normalizeGrade(r, opts.zone)).filter(isPresent)) {
    entities.push({ source: 'mashov', kind: 'grade', naturalKey: grade.naturalKey, payload: grade });
  }

  // The first page is already here; older conversations come in further pages.
  const inbox = await readInbox(mail, (skip) => api.mail(skip), opts.zone, (skip, err) => opts.onWarning?.(`mail page ${skip}`, err));
  const { messages, reads } = await readMessages(inbox.rows, {
    zone: opts.zone,
    stored: opts.storedMessages,
    detail: (id) => api.conversation(id),
    onError: (conversationId, err) => opts.onWarning?.(`message ${conversationId}`, err),
  });
  for (const msg of messages) {
    entities.push({ source: 'mashov', kind: 'message', naturalKey: msg.naturalKey, payload: msg });
  }

  // Attendance never fails Mashov: without it the read claims neither scope,
  // so what was stored stays.
  let attendance: NormalizedEntity[] | null = null;
  try {
    const [behave, counts] = await Promise.all([api.behave(), api.lessonsCount()]);
    attendance = attendanceEntities(behave, counts, groupIndex);
    entities.push(...attendance);
    scopes.push(...ATTENDANCE_SCOPES);
  } catch (err) {
    opts.onWarning?.('attendance', asError(err));
  }

  // Nor does bagrut. Its entities are not returned with the read: the caller
  // stores them as their own delta, whose first read must be quiet.
  let bagrut: BagrutExam[] | null = null;
  let bagrutFailed = false;
  if (opts.readBagrut) {
    try {
      const [bagrutGrades, sheelonim] = await Promise.all([api.bagrutGrades(), api.bagrutSheelonim()]);
      bagrut = normalizeBagrut(bagrutGrades, sheelonim, opts.zone);
    } catch (err) {
      bagrutFailed = true;
      opts.onWarning?.('bagrut', asError(err));
    }
  }

  // The timetable changes never fail the read either. They are asked for the
  // days the lessons are built for, and one past them, in case Mashov's `end`
  // is exclusive.
  let timetableChanges: number | null = null;
  try {
    const now = opts.now ?? new Date();
    const today = DateTime.fromJSDate(now).setZone(opts.zone).toISODate()!;
    const start = addDays(today, -LESSON_HORIZON.back, opts.zone);
    const end = addDays(today, LESSON_HORIZON.ahead + 1, opts.zone);
    const answer = normalizeTimetableChanges(await api.timetableChanges(start, end), groupIndex, bellIndex, opts.zone);
    entities.push(...timetableChangeEntities(answer, now.toISOString()));
    scopes.push(...TIMETABLE_CHANGE_SCOPES);
    timetableChanges = answer.changes.length;
  } catch (err) {
    opts.onWarning?.('timetable changes', asError(err));
  }

  return {
    entities,
    scopes,
    bagrut,
    bagrutFailed,
    mailComplete: inbox.complete,
    counts: {
      slots: timetable.length,
      homework: homework.length,
      grades: grades.length,
      mail: inbox.rows.length,
      mailPages: inbox.pages,
      mailBodies: reads,
      groups: groupIndex.size,
      bells: bellIndex.size,
      attendance: attendance?.length ?? null,
      timetableChanges,
    },
  };
}
