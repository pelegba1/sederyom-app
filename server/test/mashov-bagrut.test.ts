/**
 * Bagrut from Mashov (plan §14.2, §14.9), against the de-identified capture
 * in `fixtures/mashov-w7/`: the join of grades and sheelonim, and the
 * upcoming sittings joining the exam list once. The phone reads them with
 * this shared code (`@sederyom/shared/logic/mashov/bagrut`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BagrutExam } from '@sederyom/shared';
import { describe, expect, it } from 'vitest';
import {
  BAGRUT_KIND, BAGRUT_PARTITION, bagrutEntities, bagrutMethod,
  bagrutMoed, bagrutSubject, isBagrutDue, normalizeBagrut, withoutBagrutDuplicates,
} from '@sederyom/shared/logic/mashov/bagrut';

const ZONE = 'Asia/Jerusalem';
const TODAY = '2026-10-09';
const NOW = new Date('2026-10-09T07:00:00Z'); // 10:00 in Israel

type Row = Record<string, unknown>;

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'mashov-w7', name), 'utf8')) as T;
}

const grades = () => fixture<Row[]>('bagrut-grades.json');
const sheelonim = () => fixture<Row[]>('bagrut-sheelonim.json');
const all = () => normalizeBagrut(grades(), sheelonim(), ZONE);
const byKey = (exams: BagrutExam[], key: string) => exams.find((e) => e.naturalKey === key);

describe('bagrut fields', () => {
  it('reads moed 202606 as 2026-06', () => {
    expect(bagrutMoed(202606)).toBe('2026-06');
    expect(bagrutMoed('202701')).toBe('2027-01');
    expect(bagrutMoed(202613)).toBeNull();
    expect(bagrutMoed(null)).toBeNull();
    expect(bagrutMoed('June')).toBeNull();
  });

  it('maps the test method by its name, and anything else to null', () => {
    expect(bagrutMethod('היבחנות חיצונית')).toBe('external');
    expect(bagrutMethod('ציון בית ספרי')).toBe('school');
    expect(bagrutMethod('משהו אחר')).toBeNull();
    expect(bagrutMethod(undefined)).toBeNull();
  });

  it('names the subject from the questionnaire', () => {
    expect(bagrutSubject('אנגלית ז - G (הערכה חיצונית)')).toBe('אנגלית');
    expect(bagrutSubject("אנגלית-דבו' והב' הנש (הערכה חיצונית)")).toBe('אנגלית');
    expect(bagrutSubject('תנ"ך - כללי (הערכה חיצונית)')).toBe('תנ״ך');
    expect(bagrutSubject("מדעי המחשב-חלופת הע' (הערכה חלופית)")).toBe('מדעי המחשב');
    expect(bagrutSubject('פיזיקה מכניקה (הערכה חיצונית)')).toBe('פיזיקה');
    expect(bagrutSubject('היסטוריה - סוגיות- משימה 2 (הערכה חיצונית)')).toBe('היסטוריה');
    expect(bagrutSubject('מתמטיקה - תכנית חדשה (הערכה חיצונית)')).toBe('מתמטיקה');
    expect(bagrutSubject('עברית - אקדמיה (הערכה חיצונית)')).toBe('עברית');
    expect(bagrutSubject('ספרות - כללי (הערכה חיצונית)')).toBe('ספרות');
    expect(bagrutSubject('אזרחות (הערכה חיצונית)')).toBe('אזרחות');
  });
});

describe('normalizing bagrut', () => {
  it('joins grades and sheelonim on semel and moed: one row per questionnaire and sitting', () => {
    const exams = all();
    expect(exams).toHaveLength(27);
    expect(new Set(exams.map((e) => e.naturalKey)).size).toBe(27);
    // The same questionnaire in two sittings stays two rows.
    expect(exams.filter((e) => e.semel === 22225).map((e) => e.moed)).toEqual(['2026-01', '2026-06']);
  });

  it('maps a full row', () => {
    expect(byKey(all(), 'bagrut|1261|2026-06')).toEqual({
      naturalKey: 'bagrut|1261|2026-06',
      semel: 1261,
      name: 'תנ"ך - כללי (הערכה חיצונית)',
      moed: '2026-06',
      method: 'external',
      schoolGrade: 88,
      examGrade: 74,
      finalGrade: 95,
      acceptedGrade: 81,
      registered: true,
      examDate: '2026-05-28',
      startTime: '12:00',
      endTime: '14:50',
    });
  });

  it('keeps a row with only some fields, and invents none', () => {
    const exams = all();
    expect(byKey(exams, 'bagrut|16582|2027-01')).toMatchObject({
      method: 'external', schoolGrade: null, examGrade: null, finalGrade: null, acceptedGrade: null,
      registered: true, examDate: '2027-01-21', startTime: '14:00', endTime: '15:45',
    });
    expect(byKey(exams, 'bagrut|1263|2026-06')).toMatchObject({
      method: 'school', schoolGrade: 100, examGrade: null, finalGrade: null, examDate: '2026-07-15', startTime: null, endTime: null,
    });
    // No testMethodName at all.
    expect(byKey(exams, 'bagrut|11251|2026-06')).toMatchObject({ method: null, schoolGrade: null, examGrade: 81, finalGrade: 100 });
  });

  it('keeps the questionnaire with no exam date', () => {
    expect(byKey(all(), 'bagrut|700181|2025-05')).toMatchObject({ finalGrade: 8, examDate: null, startTime: null, endTime: null, method: null });
  });

  it('keeps a questionnaire that only one list has', () => {
    const onlySheet = { id: 1, name: 'שאלון בלי ציון', moed: 202701, semel: 99999, examDate: '2027-01-05T00:00:00', examStartTime: '09:00', examEndTime: '11:00' };
    const onlyGrade = { moed: 202701, semel: 88888, name: 'שאלון בלי מועד', going: false, testMethodName: 'היבחנות חיצונית' };
    const exams = normalizeBagrut([...grades(), onlyGrade], [...sheelonim(), onlySheet], ZONE);
    expect(byKey(exams, 'bagrut|99999|2027-01')).toMatchObject({ name: 'שאלון בלי ציון', registered: true, examDate: '2027-01-05', finalGrade: null });
    expect(byKey(exams, 'bagrut|88888|2027-01')).toMatchObject({ registered: false, examDate: null });
  });

  it('drops a row it cannot key, and never throws', () => {
    expect(normalizeBagrut([null, 42, 'x', {}, { semel: 1, moed: 'later' }], [[], { moed: 202606 }], ZONE)).toEqual([]);
  });
});

describe('bagrut exams on the calendar', () => {
  const exams = (today = TODAY) => bagrutEntities(all(), today).filter((e) => e.kind === 'exam');

  it('are the registered sittings from today on', () => {
    expect(exams().map((e) => [e.naturalKey, e.partition, e.payload])).toEqual([
      ['bagrut|16582|2027-01', BAGRUT_PARTITION, {
        date: '2027-01-21', subject: 'אנגלית', details: 'אנגלית ז - G (הערכה חיצונית)', kind: 'bagrut', startTime: '14:00', endTime: '15:45',
      }],
      ['bagrut|16586|2027-01', BAGRUT_PARTITION, {
        date: '2027-02-15', subject: 'אנגלית', details: "אנגלית-דבו' והב' הנש (הערכה חיצונית)", kind: 'bagrut', startTime: null, endTime: null,
      }],
    ]);
  });

  /** "היסטוריה - סוגיות- משימה 2" is graded by the school; 15.2 is when its grade is due, not an exam. */
  it('leave out what the school grades itself', () => {
    expect(byKey(all(), 'bagrut|22222|2027-01')).toMatchObject({ method: 'school', registered: true, examDate: '2027-02-15' });
    expect(exams().map((e) => e.naturalKey)).not.toContain('bagrut|22222|2027-01');
  });

  it('include today’s, and drop a sitting once it is past', () => {
    expect(exams('2027-01-21').map((e) => e.naturalKey)).toEqual(['bagrut|16582|2027-01', 'bagrut|16586|2027-01']);
    expect(exams('2027-01-22').map((e) => e.naturalKey)).toEqual(['bagrut|16586|2027-01']);
  });

  it('leave out an unregistered sitting', () => {
    const g = grades().map((r) => (r.semel === 16582 ? { ...r, going: false } : r));
    expect(bagrutEntities(normalizeBagrut(g, sheelonim(), ZONE), TODAY).filter((e) => e.kind === 'exam').map((e) => e.naturalKey))
      .toEqual(['bagrut|16586|2027-01']);
  });

  it('store every questionnaire as a bagrut snapshot as well', () => {
    const stored = bagrutEntities(all(), TODAY).filter((e) => e.kind === BAGRUT_KIND);
    expect(stored).toHaveLength(27);
    expect(stored[0]!.payload).toEqual(all()[0]);
  });
});

describe('one entry per bagrut exam', () => {
  const bagrut = { naturalKey: 'bagrut|16582|2027-01', date: '2027-01-21', subject: 'אנגלית', details: 'אנגלית ז - G', source: 'mashov' };
  const site = (naturalKey: string, date: string, subject: string) => ({ naturalKey, date, subject, details: null, source: 'school_site' });

  it('drops the grade schedule’s entry for the same sitting, and keeps Mashov’s', () => {
    const exams = [
      site('site-1', '2027-01-21', 'בגרות באנגלית'),
      site('site-2', '2027-01-21', 'מבחן באנגלית'),
      site('site-3', '2027-01-22', 'בגרות באנגלית'),
      site('site-4', '2027-01-21', 'בגרות במתמטיקה'),
      site('site-5', '2027-01-21', 'בגרות'),
      bagrut,
    ];
    expect(withoutBagrutDuplicates(exams).map((e) => e.naturalKey)).toEqual(['site-2', 'site-3', 'site-4', 'site-5', bagrut.naturalKey]);
  });

  it('reads the subject however the schedule spells it', () => {
    const tanach = { ...bagrut, naturalKey: 'bagrut|1261|2027-06', date: '2027-06-01', subject: 'תנ״ך' };
    expect(withoutBagrutDuplicates([site('s', '2027-06-01', 'בגרות בתנ"ך - כללי'), tanach]).map((e) => e.naturalKey)).toEqual([tanach.naturalKey]);
  });

  it('leaves the list alone without a bagrut exam', () => {
    const exams = [site('site-1', '2027-01-21', 'בגרות באנגלית')];
    expect(withoutBagrutDuplicates(exams)).toEqual(exams);
  });
});

describe('when bagrut is read', () => {
  const at = (iso: string) => new Date(iso);

  it('reads before the first read, and once a day after it', () => {
    expect(isBagrutDue(null, null, NOW, ZONE)).toBe(true);
    expect(isBagrutDue(at('2026-10-09T04:00:00Z'), null, NOW, ZONE)).toBe(false);
    // 23:30 yesterday in Israel is 20:30Z; still yesterday there.
    expect(isBagrutDue(at('2026-10-08T20:30:00Z'), null, NOW, ZONE)).toBe(true);
    // 00:30 today in Israel is 21:30Z the day before: already today.
    expect(isBagrutDue(at('2026-10-08T21:30:00Z'), null, NOW, ZONE)).toBe(false);
  });

  it('waits an hour after a failed read', () => {
    expect(isBagrutDue(null, at('2026-10-09T06:30:00Z'), NOW, ZONE)).toBe(false);
    expect(isBagrutDue(null, at('2026-10-09T05:59:00Z'), NOW, ZONE)).toBe(true);
  });
});
