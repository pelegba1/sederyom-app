/**
 * Exams added by hand (app/src/local/manualExams.ts): kept on the phone, and
 * shown with the rest of the exams, always as the student's own.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { examOptions } from '@sederyom/shared/logic/options';
import { addManualExam, isManualKey, manualAsExam, readManualExams, removeManualExam, restoreManualExam, setManualExamDate } from '../../app/src/local/manualExams';
import { localExamsFrom } from '../../app/src/local/days';

function memoryKv() {
  const map = new Map<string, string>();
  return { getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const NOW = new Date('2026-10-22T10:00:00Z');

describe('exams added by hand', () => {
  it('adds, removes and puts one back', () => {
    const kv = memoryKv();
    const exam = addManualExam(kv, { date: '2026-11-03', subject: '  ספרות ', details: ' פרקים 1–3 ' }, NOW);
    expect(exam).toMatchObject({ date: '2026-11-03', subject: 'ספרות', details: 'פרקים 1–3' });
    expect(isManualKey(exam.naturalKey)).toBe(true);
    expect(readManualExams(kv)).toHaveLength(1);

    expect(removeManualExam(kv, exam.naturalKey)).toEqual(exam);
    expect(readManualExams(kv)).toEqual([]);
    restoreManualExam(kv, exam);
    expect(readManualExams(kv)).toEqual([exam]);
  });

  it('refuses an empty subject or a date that is not a day', () => {
    const kv = memoryKv();
    expect(() => addManualExam(kv, { date: '2026-11-03', subject: '   ' })).toThrow();
    expect(() => addManualExam(kv, { date: '3.11', subject: 'ספרות' })).toThrow();
    expect(readManualExams(kv)).toEqual([]);
  });

  it('refuses a date that has the form of one and is no day', () => {
    const kv = memoryKv();
    for (const date of ['2026-02-30', '2026-13-01', '2026-11-31', '2027-02-29']) {
      expect(() => addManualExam(kv, { date, subject: 'ספרות' })).toThrow();
    }
    expect(readManualExams(kv)).toEqual([]);
    expect(addManualExam(kv, { date: '2028-02-29', subject: 'ספרות' }, NOW).date).toBe('2028-02-29');
  });

  it('changes the stored date of one, and only of that one, keeping its place in the list', () => {
    const kv = memoryKv();
    const first = addManualExam(kv, { date: '2026-11-03', subject: 'ספרות', details: 'פרקים 1–3' }, NOW);
    const second = addManualExam(kv, { date: '2026-11-05', subject: 'היסטוריה' }, new Date(NOW.getTime() + 1000));

    const moved = setManualExamDate(kv, first.naturalKey, '2026-11-12');
    expect(moved).toEqual({ ...first, date: '2026-11-12' });
    // Kept: the name, the details, the key and when it was added are the exam's own; the list is in the order it was.
    expect(readManualExams(kv)).toEqual([{ ...first, date: '2026-11-12' }, second]);
    // Shown on the new date by everything that reads the exams.
    const exams = localExamsFrom({ feed: null, mashov: [], bagrut: [], manualExams: readManualExams(kv), settings: DEFAULT_SETTINGS }, '2026-10-22', '2026-10-22');
    expect(exams.map((e) => [e.naturalKey, e.date])).toEqual([[second.naturalKey, '2026-11-05'], [first.naturalKey, '2026-11-12']]);
    expect(exams.every((e) => !('originalDate' in e))).toBe(true);

    // The same date again changes nothing; another day moves it again.
    expect(setManualExamDate(kv, first.naturalKey, '2026-11-12')).toEqual({ ...first, date: '2026-11-12' });
    expect(setManualExamDate(kv, first.naturalKey, '2026-10-30')?.date).toBe('2026-10-30');
  });

  it('is null for a key that is not an exam the student added, and for a date that is not a day: nothing is written', () => {
    const kv = memoryKv();
    const exam = addManualExam(kv, { date: '2026-11-03', subject: 'ספרות' }, NOW);
    const stored = JSON.stringify(readManualExams(kv));
    expect(setManualExamDate(kv, 'manual|nothing', '2026-11-12')).toBeNull();
    // A key from a source is not a manual exam's, even where the exam is in the list under it.
    expect(setManualExamDate(kv, 'site-exam|english', '2026-11-12')).toBeNull();
    for (const date of ['', '12.11', '2026-02-30', '2026-13-01', '2026-1-5', ' 2026-11-12', 'זבל']) {
      expect(setManualExamDate(kv, exam.naturalKey, date)).toBeNull();
    }
    expect(JSON.stringify(readManualExams(kv))).toBe(stored);
    expect(setManualExamDate(memoryKv(), exam.naturalKey, '2026-11-12')).toBeNull();
  });

  it('is always the student\'s own in "המבחנים שלי", whatever its subject', () => {
    const kv = memoryKv();
    const exam = manualAsExam(addManualExam(kv, { date: '2026-11-03', subject: 'מקצוע שאין במערכת' }, NOW));
    const [option] = examOptions([exam], { kept: [], hidden: [] }, DEFAULT_SETTINGS);
    expect(option).toMatchObject({ subjectKey: 'מקצוע שאין במערכת', match: { mine: true }, hidden: false });
  });

  it('joins the exams the phone shows, marked as added by hand', () => {
    const kv = memoryKv();
    const exam = addManualExam(kv, { date: '2026-11-03', subject: 'ספרות' }, NOW);
    expect(manualAsExam(exam)).toMatchObject({ kind: 'manual', subject: 'ספרות' });
    const exams = localExamsFrom({ feed: null, mashov: [], bagrut: [], manualExams: readManualExams(kv), settings: DEFAULT_SETTINGS }, '2026-10-22', '2026-10-22');
    expect(exams).toEqual([expect.objectContaining({ naturalKey: exam.naturalKey, date: '2026-11-03', kind: 'manual' })]);
  });
});
