/**
 * "Is this exam mine?" (plan F5), read off the grade's real exam calendar and
 * the class's real timetable: the ICS captured 2026-09-17 and the two live
 * Shahaf weeks captured 2026-09-01.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/adapters/school-site/ics.js';
import { examsFromCalendar } from '../src/adapters/school-site/index.js';
import { parseTimetable } from '../src/adapters/shahaf/parser.js';
import {
  REASON_IMPROVERS, REASON_NOT_IN_TIMETABLE, REASON_RESIT, blockLabel, blockReason, examSubjectKey, matchExam, parseExamTitle,
  readableSubject, uniqueSubjects, type LessonLine, type OwnerLessons,
} from '@sederyom/shared/logic/exam-match';
import { filterLessons } from '@sederyom/shared/logic/filters';

const ZONE = 'Asia/Jerusalem';
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function fixtureExams() {
  const ics = readFileSync(join(FIXTURES, 'school-site', 'exams-yb.ics'), 'utf8');
  return examsFromCalendar(parseIcs(ics, { zone: ZONE }).events, '2026-09-17', ZONE).map((e) => ({
    key: e.naturalKey,
    subject: e.payload.subject,
    details: e.payload.details,
  }));
}

/** Every distinct subject/teacher line of the live class grid. */
function fixtureLines(): LessonLine[] {
  const lines = new Map<string, LessonLine>();
  for (const [file, sunday] of [['changestable-w0.html', '2026-08-30'], ['changestable-w1.html', '2026-09-06']] as const) {
    const html = readFileSync(join(FIXTURES, 'shahaf', 'live-2026-09-01', file), 'utf8');
    for (const l of parseTimetable(html, sunday, { zone: ZONE }).lessons) {
      if (l.status === 'exam') continue;
      lines.set(`${l.subject}|${l.teacher ?? ''}`, { subject: l.subject, teacher: l.teacher });
    }
  }
  return [...lines.values()];
}

function owner(lines: LessonLine[], hiddenSubjects: string[] = []): OwnerLessons {
  const kept = filterLessons(lines, { lessons: { hiddenSubjects } });
  return { kept, hidden: lines.filter((l) => !kept.includes(l)) };
}

describe('reading an exam title', () => {
  it('names the subject the way the school writes it', () => {
    expect(examSubjectKey('מבחן באנגלית')).toBe('אנגלית');
    expect(examSubjectKey('בגרות באנגלית - G')).toBe('אנגלית');
    expect(examSubjectKey('מתכונת באנגלית וויקה')).toBe('אנגלית');
    // The alias table files עברית under לשון; the picker still says עברית.
    expect(examSubjectKey('מבחן בעברית')).toBe('עברית');
    expect(examSubjectKey('בגרות בתנ"ך - רק למשפרים')).toBe('תנ״ך');
    expect(examSubjectKey('מבחן מוזיקה')).toBe('מוזיקה');
    // An abbreviation reads as the full name.
    expect(examSubjectKey('תאריך הגשת ביו חקר')).toBe('ביולוגיה');
  });

  it('drops the ב of "מבחן ב…" only when it is a preposition', () => {
    expect(examSubjectKey('מבחן ביולוגיה')).toBe('ביולוגיה');
    expect(examSubjectKey('מבחן בביולוגיה')).toBe('ביולוגיה');
    expect(examSubjectKey('מבחן בעברית')).toBe('עברית');
    // Unknown to the alias table and to the timetable: still a subject after "מבחן ב".
    expect(examSubjectKey('מבחן בכימיה')).toBe('כימיה');
    expect(examSubjectKey('מבחן באזרחות', [{ subject: 'אזרחות (יא1)', teacher: null }])).toBe('אזרחות');
  });

  it('finds the subject after a class name, a block and a qualifier', () => {
    const title = parseExamTitle('י"ב2+ גוש- מתכונת במעבדה בפיזיקה');
    expect(title).toMatchObject({ subject: 'פיזיקה', block: '', known: true });
    expect(parseExamTitle('מבדק במדעי המחשב גוש').subject).toBe('מדעי המחשב');
  });

  it('names no subject for a block exam or a resit round', () => {
    for (const t of ['מבחן גוש א', "מבחן גוש א'", "גוש ב'", "מועד ב'", "מבחן מועד ב'", 'מועד תיקון']) {
      expect(examSubjectKey(t), t).toBe('');
    }
    expect(parseExamTitle("מבחן גוש א'").block).toBe('א');
    expect(parseExamTitle("מועד ב'").block).toBeNull();
  });

  it('reads "מבחן בגוש א" as a block exam, not a subject called "גוש"', () => {
    expect(parseExamTitle('י"ב- מבחן בגוש ב')).toMatchObject({ subject: '', block: 'ב' });
    expect(parseExamTitle('מבחן בגוש א')).toMatchObject({ subject: '', block: 'א' });
  });

  it('knows a later round from a new date (R-3)', () => {
    for (const t of ["מועד ב'", 'מועד ב׳', 'י"ב מועד ב', "מבחן מועד ב'", 'יב מועד תיקון', 'מועד מיוחד', "י\"ב-מועד ב' בגרות באנגלית(מועד חדש)"]) {
      expect(parseExamTitle(t).resit, t).toBe(true);
    }
    for (const t of ['י"ב בגרות במוזיקה (מועד חדש)', 'מבחן באנגלית', 'מועד בגרות בעברית', "מבחן גוש ב'"]) {
      expect(parseExamTitle(t).resit, t).toBe(false);
    }
    // "מיוחד" is no subject.
    expect(examSubjectKey('מועד מיוחד')).toBe('');
    expect(examSubjectKey("מועד ב' בגרות באנגלית")).toBe('אנגלית');
  });

  it('says a lesson or homework subject the way a student does', () => {
    expect(readableSubject('פיזיקה מורחב (מעבדת פיסיקה)')).toBe('פיזיקה');
    expect(readableSubject('אנגלית 5 יח"ל (יב2)')).toBe('אנגלית');
    expect(readableSubject('תנ"ך (יא1)')).toBe('תנ״ך');
    expect(readableSubject('חנ"ג')).toBe('חינוך גופני');
    expect(readableSubject('שרותי רשת (מעבדת מחשבים 1)')).toBe('שרותי רשת');
    expect(uniqueSubjects(['פיזיקה מורחב (יב3)', 'פיזיקה מורחב (מעבדת פיסיקה)', 'אזרחות', 'אזרחות (יב2)'])).toEqual(['פיזיקה', 'אזרחות']);
  });

  it('reads a bare subject, as the timetable site lists its exams', () => {
    expect(examSubjectKey('מתמטיקה')).toBe('מתמטיקה');
  });

  it('keeps an unplaced word after the subject as a possible teacher', () => {
    expect(parseExamTitle('מתכונת באנגלית וויקה').rest).toEqual(['וויקה']);
    expect(parseExamTitle('בגרות באנגלית - E - רק למשפרים')).toMatchObject({ subject: 'אנגלית', rest: [], improversOnly: true });
  });
});

describe('the words a title reads', () => {
  it('reports the words it read as the block, as the title wrote them', () => {
    expect(parseExamTitle("מבחן גוש ב'")).toMatchObject({ block: 'ב', blockWords: "גוש ב'", subjectWords: null });
    expect(parseExamTitle('מבחן בגוש א')).toMatchObject({ block: 'א', blockWords: 'בגוש א' });
  });

  it('reports the words it read as the subject, with the ב of "מבחן ב…" dropped', () => {
    expect(parseExamTitle('מתכונת באנגלית וויקה')).toMatchObject({ subject: 'אנגלית', subjectWords: 'אנגלית' });
    expect(parseExamTitle('מבחן ביו')).toMatchObject({ subject: 'ביולוגיה', subjectWords: 'ביו' });
    expect(parseExamTitle('בגרות במדעי המחשב - רק למשפרים')).toMatchObject({ subjectWords: 'מדעי המחשב' });
  });

  it('reports the words of a subject this reader does not know, and of a block with no letter', () => {
    expect(parseExamTitle('מבחן בכימיה')).toMatchObject({ known: false, subject: 'כימיה', subjectWords: 'כימיה' });
    expect(parseExamTitle('כימיה')).toMatchObject({ known: false, subject: 'כימיה', subjectWords: 'כימיה' });
    expect(parseExamTitle('מבדק במדעי המחשב גוש')).toMatchObject({ block: '', blockWords: 'גוש', subjectWords: 'מדעי המחשב' });
    expect(parseExamTitle("מועד ב'")).toMatchObject({ block: null, blockWords: null });
  });

  it('reports nothing for a title that names no subject and no block', () => {
    expect(parseExamTitle('תאריך הגשה')).toMatchObject({ subject: '', subjectWords: null, blockWords: null });
  });
});

describe('matching an exam to the owner', () => {
  const lines: LessonLine[] = [
    { subject: 'אנגלית 5 יח"ל', teacher: 'נקש ירדנה' },
    { subject: 'פיזיקה מורחב', teacher: 'לוי' },
    { subject: 'כימיה מורחב', teacher: 'כהן' },
  ];
  const mine = owner(lines, ['כימיה מורחב']);

  it('recommends an exam in a subject the owner keeps', () => {
    expect(matchExam({ subject: 'מבחן באנגלית', details: null }, mine).match).toEqual({ mine: true, reason: null });
  });

  it('says why an exam is not theirs', () => {
    expect(matchExam({ subject: 'בגרות באנגלית - רק למשפרים', details: null }, mine).match).toEqual({ mine: false, reason: REASON_IMPROVERS });
    // Hidden by the owner, and absent from the timetable: both "not in your timetable".
    expect(matchExam({ subject: 'מבחן בכימיה', details: null }, mine).match).toEqual({ mine: false, reason: REASON_NOT_IN_TIMETABLE });
    expect(matchExam({ subject: 'מבחן בהיסטוריה', details: null }, mine).match).toEqual({ mine: false, reason: REASON_NOT_IN_TIMETABLE });
  });

  it('names the block when a block exam is in another subject', () => {
    expect(blockReason('א')).toBe('גוש א׳ — מקצוע אחר');
    expect(matchExam({ subject: "מבחן גוש א' בביולוגיה", details: null }, mine).match).toEqual({ mine: false, reason: 'גוש א׳ — מקצוע אחר' });
    expect(matchExam({ subject: "מבחן גוש א' בפיזיקה", details: null }, mine).match).toEqual({ mine: true, reason: null });
  });

  it('reads the subjects a block exam lists in its details, and only known ones', () => {
    const block = (details: string | null) => matchExam({ subject: 'מבחן גוש ב', details }, mine).match;
    expect(block('פיזיקה, ביולוגיה')).toEqual({ mine: true, reason: null });
    expect(block('ביולוגיה\nמדעי המחשב')).toEqual({ mine: false, reason: 'גוש ב׳: ביולוגיה, מדעי המחשב' });
    expect(block(null)).toEqual({ mine: null, reason: null });
    expect(block('בחדר 12')).toEqual({ mine: null, reason: null });
  });

  it('names a block exam by the subjects in it (R-3)', () => {
    const block = (subject: string, details: string | null, who: OwnerLessons = mine) => matchExam({ subject, details }, who);
    // Mine: the owner's subject leads, whatever order the school typed.
    expect(block("מבחן גוש ב'", 'ביולוגיה\nפיזיקה')).toEqual({
      subjectKey: 'גוש ב׳: פיזיקה, ביולוגיה', match: { mine: true, reason: null },
    });
    // Not mine: the label is the reason too. A line it cannot place ("כלכלה-כפיר") is "…".
    expect(block('י"ב- מבחן בגוש א', 'ביולוגיה-כוכבה\nכלכלה-כפיר\nמדעי המחשב')).toEqual({
      subjectKey: 'גוש א׳: ביולוגיה, מדעי המחשב, …', match: { mine: false, reason: 'גוש א׳: ביולוגיה, מדעי המחשב, …' },
    });
    // One subject twice, spelled two ways, is one subject.
    expect(block('מבחן גוש א', 'פיסיקה-גליה\nפיזיקה-סיון').subjectKey).toBe('גוש א׳: פיסיקה');
    // A subject only the timetable knows still counts when it is the owner's.
    expect(block('מבחן גוש א', 'פיזיקה\nכימיה', owner(lines)).subjectKey).toBe('גוש א׳: פיזיקה, כימיה');
    // No timetable yet: named, but no verdict.
    expect(block('מבחן גוש א', 'פיזיקה, ביולוגיה', { kept: [], hidden: [] })).toEqual({
      subjectKey: 'גוש א׳: פיזיקה, ביולוגיה', match: { mine: null, reason: null },
    });
    // No list: no name, as before.
    expect(block('מבחן גוש א', null).subjectKey).toBe('');
  });

  it('keeps the block label short', () => {
    expect(blockLabel('ב', ['פיזיקה', 'ביולוגיה'])).toBe('גוש ב׳: פיזיקה, ביולוגיה');
    expect(blockLabel('', ['פיזיקה'])).toBe('גוש: פיזיקה');
    expect(blockLabel('א', ['פיזיקה', 'ביולוגיה', 'אמנות', 'מוזיקה'])).toBe('גוש א׳: פיזיקה, ביולוגיה, אמנות, …');
    expect(blockLabel('א', ['פיזיקה'], true)).toBe('גוש א׳: פיזיקה, …');
  });

  it('a later round is for those who sit it, timetable or not (R-3)', () => {
    for (const subject of ["מועד ב'", 'יב מועד תיקון', 'מועד מיוחד', "מועד ב' בגרות באנגלית"]) {
      expect(matchExam({ subject, details: null }, mine).match, subject).toEqual({ mine: false, reason: REASON_RESIT });
      expect(matchExam({ subject, details: null }, { kept: [], hidden: [] }).match.mine, subject).toBe(false);
    }
    // A rescheduled exam is still the subject's exam.
    expect(matchExam({ subject: 'בגרות באנגלית (מועד חדש)', details: null }, mine).match).toEqual({ mine: true, reason: null });
  });

  it('a teacher named in the title decides between parallel groups', () => {
    const two = owner([...lines, { subject: 'אנגלית 5 יח"ל', teacher: 'מזרחי וויקה' }], ['אנגלית 5 יח"ל @ מזרחי וויקה']);
    expect(matchExam({ subject: 'מתכונת באנגלית ירדנה', details: null }, two).match).toEqual({ mine: true, reason: null });
    expect(matchExam({ subject: 'מתכונת באנגלית וויקה', details: null }, two).match).toEqual({ mine: false, reason: REASON_NOT_IN_TIMETABLE });
    // Someone the timetable does not know: too little to tell.
    expect(matchExam({ subject: 'מתכונת באנגלית רחל', details: null }, two).match).toEqual({ mine: null, reason: null });
  });

  it('says nothing before any timetable has been read', () => {
    expect(matchExam({ subject: 'מבחן באנגלית', details: null }, { kept: [], hidden: [] }).match).toEqual({ mine: null, reason: null });
    // …except what the title itself says.
    expect(matchExam({ subject: 'בגרות באנגלית - רק למשפרים', details: null }, { kept: [], hidden: [] }).match.mine).toBe(false);
  });
});

describe('the real exam calendar against the real class timetable', () => {
  const exams = fixtureExams();
  const lines = fixtureLines();

  it('reads the fixtures it is meant to', () => {
    expect(exams).toHaveLength(33);
    expect(lines.map((l) => l.subject)).toContain('אנגלית 5 יח"ל');
  });

  it('sorts every exam of the year into mine, not mine and unsure', () => {
    // The owner keeps one of the two parallel history and maths lines, as the
    // "my lessons" picker would leave it.
    const me = owner(lines, ['היסטוריה (יא1)', 'מתמטיקה 3 יח"ל (יא1)']);
    expect(me.hidden.map((l) => l.subject).sort()).toEqual(['היסטוריה (יא1)', 'מתמטיקה 3 יח"ל (יא1)'].sort());
    const results = exams.map((e) => ({ title: e.subject, ...matchExam(e, me) }));
    const by = (mine: boolean | null) => results.filter((r) => r.match.mine === mine).map((r) => r.title).sort();

    expect(by(true)).toEqual([
      'בגרות באנגלית - G',
      'מבחן באזרחות', 'מבחן באזרחות', 'מבחן באזרחות',
      'מבחן באנגלית', 'מבחן באנגלית',
      'מבחן במתמטיקה', 'מבחן במתמטיקה', 'מבחן במתמטיקה',
      'מתכונת באנגלית',
    ].sort());

    const notMine = results.filter((r) => r.match.mine === false);
    expect(notMine.filter((r) => r.match.reason === REASON_IMPROVERS).map((r) => r.subjectKey).sort()).toEqual(
      ['אנגלית', 'היסטוריה', 'מתמטיקה', 'מתמטיקה', 'ספרות', 'תנ״ך'].sort(),
    );
    expect(notMine.filter((r) => r.match.reason === REASON_NOT_IN_TIMETABLE).map((r) => r.subjectKey).sort()).toEqual(
      ['ביולוגיה', 'מוזיקה', 'עברית', 'עברית', 'עברית', 'עברית'].sort(),
    );
    // Resit rounds (R-3) — before, too little to tell.
    expect(notMine.filter((r) => r.match.reason === REASON_RESIT).map((r) => r.title).sort()).toEqual(
      ['מבחן מועד ב\'', 'מועד ב\'', 'מועד תיקון'].sort(),
    );
    expect(notMine).toHaveLength(15);

    // Block exams whose details list nothing; "וויקה" is no teacher of this class.
    expect(by(null)).toEqual([
      'בגרות באנגלית וויקה', 'גוש ב\'', 'מבחן גוש א', 'מבחן גוש א\'', 'מבחן גוש א\'', 'מבחן גוש ב\'', 'מבחן גוש ב\'',
      'מתכונת באנגלית וויקה',
    ].sort());
  });

  it('names the block exams of the year before by the subjects their details list (R-3)', () => {
    // The 2025–26 calendar in the same capture: its block exams list their subjects.
    const ics = readFileSync(join(FIXTURES, 'school-site', 'exams-yb.ics'), 'utf8');
    const lastYear = examsFromCalendar(parseIcs(ics, { zone: ZONE }).events, '2025-12-01', ZONE)
      .map((e) => ({ subject: e.payload.subject, details: e.payload.details }))
      .filter((e) => /גוש [אב]$/.test(e.subject) && e.details);
    expect(lastYear.length).toBeGreaterThan(0);
    const me = owner(lines, ['היסטוריה (יא1)', 'מתמטיקה 3 יח"ל (יא1)']);
    for (const exam of lastYear) {
      const { subjectKey, match } = matchExam(exam, me);
      expect(subjectKey, exam.subject).toMatch(/^גוש [אב]׳: /);
      // "ספרות מורחב" is in block א, and the class learns ספרות.
      if (/ספרות/.test(exam.details!)) expect(match.mine, exam.subject).toBe(true);
      else expect(match, exam.subject).toEqual({ mine: false, reason: subjectKey });
    }
  });

  it('groups the year by readable subject', () => {
    const keys = new Set(exams.map((e) => examSubjectKey(e.subject, lines)));
    expect([...keys].sort()).toEqual(['', 'אזרחות', 'אנגלית', 'ביולוגיה', 'היסטוריה', 'מוזיקה', 'מתמטיקה', 'ספרות', 'עברית', 'תנ״ך'].sort());
  });
});
