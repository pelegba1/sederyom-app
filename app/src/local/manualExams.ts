/**
 * Exams the student added by hand ("+ מבחן" in "המבחנים שלי"): not every
 * school publishes its exams where the app can read them. Kept on the phone,
 * and shown wherever exams are: the days, the widget, the School screen,
 * "המבחנים שלי" and the "בית ספר" calendar in Google.
 *
 * Pure on purpose (a key-value store in, plain data out), so `node --test`
 * can load it.
 */
import type { DateStr, Exam } from '@sederyom/shared';
import { validDate } from '../lib/planner';

export const MANUAL_EXAMS_KEY = 'exams.manual';
/** Never the bagrut prefix: `isBagrutKey` would make it a bagrut exam. */
export const MANUAL_PREFIX = 'manual|';

export interface ManualExam {
  naturalKey: string;
  date: DateStr;
  subject: string;
  details: string | null;
  createdAt: string;
}

export interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function isManualKey(key: string): boolean {
  return key.startsWith(MANUAL_PREFIX);
}

export function readManualExams(kv: KV): ManualExam[] {
  try {
    const list = JSON.parse(kv.getString(MANUAL_EXAMS_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as ManualExam[]) : [];
  } catch {
    return [];
  }
}

function write(kv: KV, list: readonly ManualExam[]): void {
  kv.set(MANUAL_EXAMS_KEY, JSON.stringify(list));
}

/** One more, with a key no other exam has. Throws on an empty subject or a date that is not a real day. */
export function addManualExam(
  kv: KV,
  input: { date: DateStr; subject: string; details?: string | null },
  now: Date = new Date(),
): ManualExam {
  const subject = input.subject.trim();
  if (!subject) throw new Error('subject is empty');
  if (!validDate(input.date)) throw new Error('date is not a real day in YYYY-MM-DD');
  const exam: ManualExam = {
    naturalKey: `${MANUAL_PREFIX}${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: input.date,
    subject,
    details: input.details?.trim() || null,
    createdAt: now.toISOString(),
  };
  write(kv, [...readManualExams(kv), exam]);
  return exam;
}

export function removeManualExam(kv: KV, naturalKey: string): ManualExam | null {
  const list = readManualExams(kv);
  const gone = list.find((e) => e.naturalKey === naturalKey) ?? null;
  if (gone) write(kv, list.filter((e) => e.naturalKey !== naturalKey));
  return gone;
}

/**
 * Moves an exam the student added to another day: its stored date changes, with
 * no layer over it (an exam from a source has one, `examPrefs.ts`). The exam as
 * kept, or `null` when the key is not one of the student's own or `date` is not
 * a real day in `yyyy-mm-dd`; nothing is written then.
 */
export function setManualExamDate(kv: KV, naturalKey: string, date: DateStr): ManualExam | null {
  if (!validDate(date)) return null;
  const list = readManualExams(kv);
  const at = list.findIndex((e) => e.naturalKey === naturalKey);
  if (at < 0) return null;
  const moved = { ...list[at]!, date };
  write(kv, list.map((e, i) => (i === at ? moved : e)));
  return moved;
}

/** Puts one back (the undo after a delete). */
export function restoreManualExam(kv: KV, exam: ManualExam): void {
  const list = readManualExams(kv).filter((e) => e.naturalKey !== exam.naturalKey);
  write(kv, [...list, exam]);
}

/** As the app's exams: always the student's own, so never a "?". */
export function manualAsExam(exam: ManualExam): Exam {
  return { naturalKey: exam.naturalKey, date: exam.date, subject: exam.subject, details: exam.details, source: 'mashov', kind: 'manual' };
}
