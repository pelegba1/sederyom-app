/**
 * Bagrut from Mashov (plan §14.2, §14.9). Shapes confirmed against real
 * answers, de-identified in `server/test/fixtures/mashov-w7/`:
 *
 * - `bagrut/grades`: one row per questionnaire (`semel`) and sitting (`moed`,
 *   e.g. 202606) — `shnaty` (the school's grade, מגן), `test`, `final`,
 *   `moeLastAcceptedGrade`, `going` (registered), `testMethodName`.
 * - `bagrut/sheelonim`: the same questionnaires with `examDate`,
 *   `examStartTime` and `examEndTime` — the student's bagrut timetable.
 *
 * Rows come with only some fields, and one has no exam date. Nothing here
 * guesses a missing value.
 */
import type { BagrutExam, DateStr, Exam, TimeStr } from '../../index';
import { DateTime } from 'luxon';
import type { EntityKind, NormalizedEntity, Scope } from '../entities';
import { examSubjectKey } from '../exam-match';
import { plainSubject, subjectsMatch } from '../subjects';
import { clockTime } from './fields';

/**
 * The snapshot kind of one questionnaire in one sitting. `ENTITY_KINDS`
 * (`adapters/types.ts`) does not list it yet; the delta engine and the store
 * treat a kind as an opaque string, so the cast only quiets the type.
 */
export const BAGRUT_KIND: EntityKind = 'bagrut';

/** Bagrut exams' partition among the `exam` snapshots, so a bagrut read prunes only its own. */
export const BAGRUT_PARTITION = 'bagrut';

/** Both kinds a bagrut read describes in full. */
export const BAGRUT_SCOPES: Scope[] = [{ kind: BAGRUT_KIND }, { kind: 'exam', partition: BAGRUT_PARTITION }];

/** SyncCursor key: when bagrut was last read from Mashov (ISO). Absent before the first read. */
export const BAGRUT_READ_CURSOR = 'mashov:bagrut:readAt';
/** SyncCursor key: when a bagrut read last failed (ISO). */
export const BAGRUT_FAILED_CURSOR = 'mashov:bagrut:failedAt';

/** After a failed read, the next try waits this long — not every poll. */
export const BAGRUT_RETRY_MINUTES = 60;

const KEY_PREFIX = 'bagrut|';

/** `bagrut|{semel}|{moed}`: a bagrut questionnaire's key, as a `BagrutExam` and as an `Exam`. */
export function bagrutKey(semel: number, moed: string): string {
  return `${KEY_PREFIX}${semel}|${moed}`;
}

export function isBagrutKey(naturalKey: string): boolean {
  return naturalKey.startsWith(KEY_PREFIX);
}

interface Row {
  [key: string]: unknown;
}

function isRow(v: unknown): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Mashov's `moed` 202606 → "2026-06". Anything that is not a year and a month → null. */
export function bagrutMoed(raw: unknown): string | null {
  const s = typeof raw === 'number' ? String(raw) : text(raw);
  const m = s ? /^(\d{4})-?(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** "היבחנות חיצונית" → external, "ציון בית ספרי" → school, anything else → null. */
export function bagrutMethod(name: unknown): BagrutExam['method'] {
  const s = text(name);
  if (s === 'היבחנות חיצונית') return 'external';
  if (s === 'ציון בית ספרי') return 'school';
  return null;
}

function dateOf(v: unknown, zone: string): DateStr | null {
  const s = text(v);
  if (!s) return null;
  const dt = DateTime.fromISO(s, { zone });
  return dt.isValid ? dt.toISODate() : null;
}

function timeOf(v: unknown): TimeStr | null {
  return clockTime(v);
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * Joins `grades` and `sheelonim` on `semel` + `moed`. A questionnaire in
 * either list is kept; one in neither shape (no `semel`, no readable `moed`)
 * is dropped. `registered` is `going` when Mashov says it; without it, a
 * questionnaire on the student's own timetable (`sheelonim`) counts as registered.
 */
export function normalizeBagrut(grades: readonly unknown[], sheelonim: readonly unknown[], zone: string): BagrutExam[] {
  const keyOf = (row: Row): { semel: number; moed: string } | null => {
    const semel = num(row.semel);
    const moed = bagrutMoed(row.moed);
    return semel !== null && moed !== null ? { semel, moed } : null;
  };

  const sheets = new Map<string, Row>();
  for (const row of sheelonim) {
    if (!isRow(row)) continue;
    const key = keyOf(row);
    if (key) sheets.set(bagrutKey(key.semel, key.moed), row);
  }

  const out = new Map<string, BagrutExam>();
  const add = (key: { semel: number; moed: string }, grade: Row | null) => {
    const naturalKey = bagrutKey(key.semel, key.moed);
    if (out.has(naturalKey)) return;
    const sheet = sheets.get(naturalKey) ?? null;
    out.set(naturalKey, {
      naturalKey,
      semel: key.semel,
      name: text(grade?.name) ?? text(sheet?.name) ?? String(key.semel),
      moed: key.moed,
      method: bagrutMethod(grade?.testMethodName),
      schoolGrade: num(grade?.shnaty),
      examGrade: num(grade?.test),
      finalGrade: num(grade?.final),
      acceptedGrade: num(grade?.moeLastAcceptedGrade),
      registered: bool(grade?.going) ?? sheet !== null,
      examDate: dateOf(sheet?.examDate, zone),
      startTime: timeOf(sheet?.examStartTime),
      endTime: timeOf(sheet?.examEndTime),
    });
  };

  for (const row of grades) {
    if (!isRow(row)) continue;
    const key = keyOf(row);
    if (key) add(key, row);
  }
  for (const [naturalKey, sheet] of sheets) {
    if (out.has(naturalKey)) continue;
    add(keyOf(sheet)!, null);
  }
  return [...out.values()].sort(byMoedThenSemel);
}

export function byMoedThenSemel(a: Pick<BagrutExam, 'moed' | 'semel'>, b: Pick<BagrutExam, 'moed' | 'semel'>): number {
  return a.moed < b.moed ? -1 : a.moed > b.moed ? 1 : a.semel - b.semel;
}

/**
 * The subject a questionnaire is in, from its name: "אנגלית ז - G (הערכה
 * חיצונית)" → "אנגלית", "תנ"ך - כללי" → "תנ״ך", "מדעי המחשב-חלופת הע'" →
 * "מדעי המחשב". The bracketed assessment kind and everything after the first
 * dash go; what is left is read the way an exam title is.
 */
export function bagrutSubject(name: string): string {
  const head = name.replace(/\([^)]*\)/g, ' ').split(/\s*[-–—]\s*/)[0]!.replace(/\s+/g, ' ').trim();
  if (!head) return plainSubject(name);
  return examSubjectKey(head) || plainSubject(head);
}

/** An `exam` snapshot's payload for a bagrut questionnaire. */
export interface BagrutExamPayload {
  date: DateStr;
  subject: string;
  /** The questionnaire as Mashov names it. */
  details: string;
  kind: 'bagrut';
  startTime: TimeStr | null;
  endTime: TimeStr | null;
}

/**
 * Which questionnaires are exams on the student's calendar: registered, with
 * an exam date from `today` on, and sat as an exam. A questionnaire the
 * school grades itself ("ציון בית ספרי") is not sat on a date: the date Mashov
 * gives it is the deadline for the school's grade (it equals `endEditTime` in
 * every such row of the capture), and "מבחן" on that day would be wrong.
 */
export function isBagrutSitting(exam: BagrutExam, today: DateStr): exam is BagrutExam & { examDate: DateStr } {
  return exam.registered && exam.examDate !== null && exam.examDate >= today && exam.method !== 'school';
}

/** Everything one bagrut read stores: each questionnaire, and an exam for each upcoming sitting. */
export function bagrutEntities(exams: readonly BagrutExam[], today: DateStr): NormalizedEntity[] {
  const entities: NormalizedEntity[] = exams.map((exam) => ({
    source: 'mashov',
    kind: BAGRUT_KIND,
    naturalKey: exam.naturalKey,
    payload: exam,
  }));
  for (const exam of exams) {
    if (!isBagrutSitting(exam, today)) continue;
    const payload: BagrutExamPayload = {
      date: exam.examDate,
      subject: bagrutSubject(exam.name),
      details: exam.name,
      kind: 'bagrut',
      startTime: exam.startTime,
      endTime: exam.endTime,
    };
    entities.push({ source: 'mashov', kind: 'exam', naturalKey: exam.naturalKey, partition: BAGRUT_PARTITION, payload });
  }
  return entities;
}

/**
 * Whether this poll reads bagrut: not if it was read earlier today (in the
 * zone), and not within `BAGRUT_RETRY_MINUTES` of a failed read.
 */
export function isBagrutDue(readAt: Date | null, failedAt: Date | null, now: Date, zone: string): boolean {
  const day = (d: Date) => DateTime.fromJSDate(d).setZone(zone).toISODate();
  if (readAt && day(readAt) === day(now)) return false;
  if (failedAt && now.getTime() - failedAt.getTime() < BAGRUT_RETRY_MINUTES * 60_000) return false;
  return true;
}

type ExamLike = Pick<Exam, 'naturalKey' | 'date' | 'subject'>;

/**
 * One entry per bagrut exam. The grade's schedule (the school site) often
 * lists the same sitting — "בגרות באנגלית" on the same day. The Mashov one
 * stays: it is the student's own registration, so it is never a "?", and it
 * has the hours. The schedule's entry goes when its date is the same, its
 * title mentions בגרות and its subject matches.
 */
export function withoutBagrutDuplicates<T extends ExamLike>(exams: readonly T[]): T[] {
  const bagrut = exams.filter((e) => isBagrutKey(e.naturalKey));
  if (bagrut.length === 0) return [...exams];
  return exams.filter((exam) => {
    if (isBagrutKey(exam.naturalKey) || !/בגרו(?:ת|יות)/.test(exam.subject)) return true;
    const subject = examSubjectKey(exam.subject);
    return !(subject && bagrut.some((b) => b.date === exam.date && subjectsMatch(b.subject, subject)));
  });
}
