/**
 * The grades box a student shares with a friend, built on their own phone
 * (app/src/buddies/grades.ts): the newest 200 grades grouped by subject with
 * the sharer's own averages, the bagrut part, and the trim of a box too big;
 * how a friend's phone reads such a box (app/src/buddies/validate.ts), and
 * how it sets the friend's box beside mine (`compareGrades`).
 */
import { describe, expect, it } from 'vitest';
import type { BagrutExam, BuddyBagrutRow, BuddyGrade, BuddyGradesContent, BuddyGradeSubject } from '@sederyom/shared';
import { BUDDY_GRADE_NAME_MAX, BUDDY_GRADE_SUBJECT_MAX, BUDDY_GRADES_MAX, BUDDY_PAIR_CIPHERTEXT_MAX } from '@sederyom/shared';
import { addDays } from '@sederyom/shared/logic/time';
import { compareGrades, fitGrades, gradesHash, myGradesContent, type GradeRow, type MyGradesInput } from '../../app/src/buddies/grades';
import { sealedLength } from '../../app/src/buddies/crypto';
import { readGradesContent } from '../../app/src/buddies/validate';
import { EMPTY_WEIGHTS, type GradeWeightsPrefs } from '../../app/src/lib/gradeWeights';
import { groupGradesBySubject } from '../../app/src/lib/school';

type GradeIn = MyGradesInput['grades'][number];

const READ_AT = '2026-09-01T06:30:00.000Z';
const START = '2026-01-01';

let serial = 0;

function grade(date: string, subject: string, over: Partial<GradeIn> = {}): GradeIn {
  serial += 1;
  return { naturalKey: `grade|${serial}`, date, subject, value: 90, valueText: null, weight: null, notes: null, ...over };
}

function sitting(semel: number, moed: string, over: Partial<BagrutExam> = {}): BagrutExam {
  return {
    naturalKey: `bagrut|${semel}|${moed}`, semel, name: 'מתמטיקה - תכנית חדשה (הערכה חיצונית)', moed, method: 'external',
    schoolGrade: null, examGrade: null, finalGrade: null, acceptedGrade: null, registered: true, examDate: null, startTime: null, endTime: null, ...over,
  };
}

function input(over: Partial<MyGradesInput> = {}): MyGradesInput {
  return { grades: [], weights: EMPTY_WEIGHTS, bagrut: [], withBagrut: false, readAt: READ_AT, ...over };
}

/** An assessment name of exactly 40 characters, different for each `i`. */
const longName = (i: number) => `מטלה ${i} `.padEnd(BUDDY_GRADE_NAME_MAX, 'א');

/** Every grade of the box, whatever its subject. */
const allGrades = (content: BuddyGradesContent) => content.subjects.flatMap((s) => s.grades);

const SUBJECTS = ['מתמטיקה', 'אנגלית', 'היסטוריה', 'ספרות', 'פיזיקה', 'כימיה', 'ביולוגיה', 'תנ״ך'];

describe('the grades box a student shares', () => {
  it('takes the newest 200 grades, as the grades tab does', () => {
    // Oldest first, so the newest 200 are the last ones.
    const grades = Array.from({ length: 230 }, (_, i) => grade(addDays(START, i), SUBJECTS[i % SUBJECTS.length]!));
    const content = myGradesContent(input({ grades }));
    const dates = allGrades(content).map((g) => g.date).sort();
    expect(dates).toHaveLength(BUDDY_GRADES_MAX);
    expect(dates[0]).toBe(addDays(START, 30));
    expect(dates[dates.length - 1]).toBe(addDays(START, 229));
    // The cap left grades out, so the box says where it starts: a friend's older grade is not "only theirs" against it.
    expect(content.from).toBe(addDays(START, 30));
  });

  it('keeps whole days under the cap: a day the cap would cut in two goes, and from is the oldest day kept', () => {
    // Newest first, the 200th and the 201st grade are both of day 30; days 31 to 229 have one grade each, days 1 to 29 are older.
    const grades = Array.from({ length: 230 }, (_, k) => grade(addDays(START, k <= 199 ? 229 - k : 230 - k), SUBJECTS[k % SUBJECTS.length]!));
    const content = myGradesContent(input({ grades }));
    const dates = allGrades(content).map((g) => g.date);
    expect(dates).toHaveLength(199);
    expect(dates).not.toContain(addDays(START, 30));
    expect(content.from).toBe(addDays(START, 31));
    expect(dates.every((d) => d >= content.from!)).toBe(true);
    expect([...dates].sort()[0]).toBe(content.from);
    // The input is the same in any order: the same day goes whichever of its grades came first.
    expect(myGradesContent(input({ grades: [...grades].reverse() }))).toEqual(content);
  });

  it('says from only when the cap left something out', () => {
    const days = (count: number) => Array.from({ length: count }, (_, i) => grade(addDays(START, i), SUBJECTS[i % SUBJECTS.length]!));
    expect(myGradesContent(input({ grades: days(200) }))).not.toHaveProperty('from');
    expect(myGradesContent(input({ grades: days(150) }))).not.toHaveProperty('from');
    // One more, and the oldest day goes: from is the day after it.
    expect(myGradesContent(input({ grades: days(201) })).from).toBe(addDays(START, 1));
    // Days of many grades are whole too: the 100 of the newest and the 100 before it are both whole; the 101st grade of the oldest day makes it go.
    const crowded = [
      ...Array.from({ length: 100 }, () => grade('2026-03-02', 'מתמטיקה')),
      ...Array.from({ length: 100 }, () => grade('2026-03-01', 'אנגלית')),
      grade('2026-03-01', 'ספרות'),
    ];
    const kept = myGradesContent(input({ grades: crowded }));
    expect(allGrades(kept)).toHaveLength(100);
    expect(kept.from).toBe('2026-03-02');
    // Nothing is left when the newest day alone is over the cap: from is the day after it.
    const one = myGradesContent(input({ grades: Array.from({ length: 201 }, () => grade('2026-03-02', 'מתמטיקה')) }));
    expect(one.subjects).toEqual([]);
    expect(one.from).toBe('2026-03-03');
    expect(readGradesContent(JSON.parse(JSON.stringify(one)))).toEqual(one);
  });

  it('groups by subject and averages by the sharer\'s weights', () => {
    const exam = grade('2026-02-01', 'מתמטיקה (יב3)', { value: 91, notes: 'מבחן פרק 3' });
    const quiz = grade('2026-02-10', 'מתמטיקה', { value: 78, notes: 'בוחן' });
    const grades = [exam, quiz];

    const plain = myGradesContent(input({ grades }));
    expect(plain.subjects.map((s) => s.subject)).toEqual(['מתמטיקה']);
    expect(plain.subjects[0]!.grades).toHaveLength(2);
    const byDefault = groupGradesBySubject(grades.map((g) => ({ ...g, firstSeen: null })), EMPTY_WEIGHTS)[0]!.average!.value;
    expect(plain.subjects[0]!.average).toBe(Math.round(byDefault * 10) / 10);

    const examOnly: GradeWeightsPrefs = {
      subjects: { מתמטיקה: { types: [{ id: 'exam', label: 'מבחן', percent: 100 }, { id: 'quiz', label: 'בוחן', percent: 0 }] } },
      grades: {},
    };
    const weighted = myGradesContent(input({ grades, weights: examOnly }));
    expect(weighted.subjects[0]!.average).toBe(91);
    expect(weighted.subjects[0]!.average).not.toBe(plain.subjects[0]!.average);
  });

  it('says how many grades the average leaves out, so a friend can see why it is not the mean of the grades shown', () => {
    // The six of the report: by default a type at 0% (אחר) holds three of them, and the average is the three works'.
    const physics = (name: string, value: number) => grade('2026-10-01', 'פיזיקה', { value, notes: name });
    const grades = [
      physics('אנרגיה פוטנציאלית חשמלית', 100), physics('ת.ה.פ 30%', 80), physics('שאלות הבנה באלקטרוסטטיקה. פורום', 100),
      physics('ניסוי חקר מטוטלת קונית', 95), physics('חקר עוצמת ההארה כתלות במרחק', 100), physics('חוק קולון', 70),
    ];
    const content = myGradesContent(input({ grades }));
    expect(content.subjects[0]).toMatchObject({ subject: 'פיזיקה', average: 98.3, uncounted: 3 });
    // None left out: no field, so the box stays as small as it was.
    const counted = myGradesContent(input({ grades: [physics('ניסוי חקר', 90), physics('מבחן', 80)] }));
    expect(counted.subjects[0]).not.toHaveProperty('uncounted');
  });

  it('averages over all 200 even when trimmed', () => {
    // Long subjects, long names and fractions, so 200 grades do not fit a box once sealed.
    const subjects = Array.from({ length: 14 }, (_, s) => `מקצוע ${s} `.padEnd(30, 'ב'));
    const grades = Array.from({ length: 230 }, (_, i) => grade(addDays(START, i), subjects[i % subjects.length]!, { value: 60.25 + (i % 40), notes: longName(i) }));
    const content = myGradesContent(input({ grades }));
    expect(sealedLength(content)).toBeGreaterThan(BUDDY_PAIR_CIPHERTEXT_MAX);
    const fitted = fitGrades(content)!;
    expect(fitted.from).toBeDefined();
    expect(allGrades(fitted).length).toBeLessThan(BUDDY_GRADES_MAX);
    // The trim goes on from where the cap left off: `from` only moves later.
    expect(content.from).toBe(addDays(START, 30));
    expect(fitted.from! > content.from!).toBe(true);
    expect(fitted.subjects.map((s) => [s.subject, s.average])).toEqual(content.subjects.map((s) => [s.subject, s.average]));
  });

  it('leaves out fields with no value', () => {
    const content = myGradesContent(input({
      grades: [
        grade('2026-02-03', 'מתמטיקה', { value: 94 }),
        grade('2026-02-02', 'מתמטיקה', { value: null, valueText: 'עבר', notes: 'הגשה' }),
        grade('2026-02-01', 'מתמטיקה', { value: 80, notes: '  מבחן\n פרק 2 ' }),
      ],
    }));
    expect(content.subjects[0]!.grades).toEqual([
      { date: '2026-02-03', value: 94 },
      { date: '2026-02-02', name: 'הגשה', text: 'עבר' },
      { date: '2026-02-01', name: 'מבחן פרק 2', value: 80 },
    ]);
    const [numeric, words] = content.subjects[0]!.grades;
    expect(numeric).not.toHaveProperty('text');
    expect(numeric).not.toHaveProperty('name');
    expect(words).not.toHaveProperty('value');
  });

  it('cuts a name over 40 characters', () => {
    const name = 'ש'.repeat(50);
    const [cut, whole] = myGradesContent(input({
      grades: [grade('2026-02-02', 'מתמטיקה', { notes: name }), grade('2026-02-01', 'מתמטיקה', { notes: 'ש'.repeat(BUDDY_GRADE_NAME_MAX) })],
    })).subjects[0]!.grades;
    expect(cut!.name).toBe(`${name.slice(0, BUDDY_GRADE_NAME_MAX - 1)}…`);
    expect(cut!.name).toHaveLength(BUDDY_GRADE_NAME_MAX);
    expect(whole!.name).toBe('ש'.repeat(BUDDY_GRADE_NAME_MAX));
  });

  it('does not cut a name in the middle of a character', () => {
    const name = '😀'.repeat(45);
    const [cut] = myGradesContent(input({ grades: [grade('2026-02-02', 'מתמטיקה', { notes: name })] })).subjects[0]!.grades;
    expect(cut!.name).toBe(`${'😀'.repeat(BUDDY_GRADE_NAME_MAX - 1)}…`);
  });

  it('cuts a subject name and a bagrut name over 60 characters, so the friend\'s phone still reads them', () => {
    const cutOf = (name: string) => `${Array.from(name).slice(0, BUDDY_GRADE_SUBJECT_MAX - 1).join('')}…`;
    // 70 code points each: the subject in emoji (140 UTF-16 units), the questionnaire in letters.
    const subject = '😀'.repeat(70);
    const questionnaire = 'ש'.repeat(70);
    const exact = 'מ'.repeat(BUDDY_GRADE_SUBJECT_MAX);
    const content = myGradesContent(input({
      grades: [grade('2026-02-02', subject, { value: 90 }), grade('2026-02-01', exact, { value: 80 })],
      withBagrut: true,
      bagrut: [sitting(35571, '2026-01', { name: questionnaire, finalGrade: 88 }), sitting(16471, '2026-01', { name: exact, finalGrade: 70 })],
    }));
    const [cutSubject, wholeSubject] = content.subjects.map((s) => s.subject);
    expect(cutSubject).toBe(cutOf(subject));
    expect(Array.from(cutSubject!)).toHaveLength(BUDDY_GRADE_SUBJECT_MAX);
    expect(cutSubject!.endsWith('…')).toBe(true);
    // A name of exactly the cap is whole.
    expect(wholeSubject).toBe(exact);
    const names = content.bagrut!.map((r) => r.name);
    expect(names).toEqual([exact, cutOf(questionnaire)]);
    expect(Array.from(names[1]!)).toHaveLength(BUDDY_GRADE_SUBJECT_MAX);
    // The cut changes no average, and the box reads back whole through JSON.
    expect(content.subjects.map((s) => s.average)).toEqual([90, 80]);
    expect(readGradesContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });

  it('writes no text its reader would refuse: marks go, line breaks become spaces, words are cut', () => {
    // Text a teacher typed into Mashov may hold direction marks and line breaks (RLM, RLO), which the reader drops a grade, a subject or a row over.
    const rlm = String.fromCharCode(0x200f);
    const rlo = String.fromCharCode(0x202e);
    const lri = String.fromCharCode(0x2066);
    const content = myGradesContent(input({
      grades: [
        grade('2026-02-05', `מתמ${rlm}טיקה${rlo}\nב`, { value: 90, notes: `מבחן${rlm}\n${rlo}פרק 3` }),
        grade('2026-02-04', `מתמ${rlm}טיקה${rlo}\nב`, { value: null, valueText: `עב${rlm}ר${rlo}\nשוב`, notes: 'הגשה' }),
        // Words that are nothing but marks and a line break are no words: the grade has nothing to show and is left out, with its subject.
        grade('2026-02-03', 'ספרות', { value: null, valueText: `${rlm}${rlo}\n`, notes: 'חיבור' }),
        grade('2026-02-02', 'אנגלית', { value: null, valueText: 'ש'.repeat(80) }),
      ],
      withBagrut: true,
      bagrut: [sitting(35571, '2026-01', { name: `מתמטיקה${rlm} - תכנית${rlo}\nחדשה`, finalGrade: 88 })],
    }));
    expect(content.subjects.map((s) => s.subject)).toEqual(['מתמטיקה ב', 'אנגלית']);
    expect(content.subjects[0]!.grades).toEqual([{ date: '2026-02-05', name: 'מבחן פרק 3', value: 90 }, { date: '2026-02-04', name: 'הגשה', text: 'עבר שוב' }]);
    // 80 characters of words come out at the reader's cap, the last an ellipsis.
    expect(content.subjects[1]!.grades).toEqual([{ date: '2026-02-02', text: `${'ש'.repeat(BUDDY_GRADE_SUBJECT_MAX - 1)}…` }]);
    expect(content.bagrut!.map((r) => r.name)).toEqual(['מתמטיקה - תכנית חדשה']);
    // Nothing the reader refuses is left in any of it (a backslash here would be a line break, as JSON writes it), so nothing is dropped on the way.
    expect(JSON.stringify(content)).not.toMatch(new RegExp(`[${rlm}${rlo}${lri}\\\\]`));
    const read = readGradesContent(JSON.parse(JSON.stringify(content)))!;
    expect(read).toEqual(content);
    expect(read.subjects.map((s) => s.grades.length)).toEqual([2, 1]);
    expect(read.bagrut).toHaveLength(1);
  });

  it('a subject with only grades in words has average null', () => {
    const content = myGradesContent(input({
      grades: [grade('2026-02-01', 'ספרות', { value: null, valueText: 'הוגש' }), grade('2026-02-02', 'ספרות', { value: null, valueText: 'עבר' })],
    }));
    expect(content.subjects).toHaveLength(1);
    expect(content.subjects[0]!.average).toBeNull();
    expect(content.subjects[0]!.grades.map((g) => g.text)).toEqual(['עבר', 'הוגש']);
  });

  it('says when the box was read, and nothing when no grades were read yet', () => {
    const content = myGradesContent(input());
    expect(content).toEqual({ v: 1, at: READ_AT, subjects: [] });
  });

  it('skips a grade with neither a number nor words: nothing to show a friend', () => {
    const content = myGradesContent(input({
      grades: [
        grade('2026-02-03', 'מתמטיקה', { value: 94 }),
        grade('2026-02-02', 'מתמטיקה', { value: null, valueText: null, notes: 'מטלה ריקה' }),
        grade('2026-02-01', 'אנגלית', { value: null, valueText: '' }),
      ],
    }));
    // A subject with nothing else to show is not in the box at all.
    expect(content.subjects.map((s) => s.subject)).toEqual(['מתמטיקה']);
    expect(content.subjects[0]!.grades).toEqual([{ date: '2026-02-03', value: 94 }]);
  });

  it('does not touch what it was given', () => {
    const grades = [grade('2026-02-01', 'מתמטיקה'), grade('2026-03-01', 'מתמטיקה')];
    myGradesContent(input({ grades }));
    expect(grades.map((g) => g.date)).toEqual(['2026-02-01', '2026-03-01']);
    expect(Object.keys(grades[0]!).sort()).toEqual(['date', 'naturalKey', 'notes', 'subject', 'value', 'valueText', 'weight']);
  });
});

describe('the bagrut part of the grades box', () => {
  it('has the latest graded sitting of each questionnaire', () => {
    const content = myGradesContent(input({
      withBagrut: true,
      bagrut: [
        sitting(35571, '2026-06'),
        sitting(35571, '2026-01', { schoolGrade: 80, examGrade: 90, finalGrade: 88 }),
        sitting(16471, '2026-06', { finalGrade: 95 }),
        sitting(16471, '2025-06', { finalGrade: 70 }),
      ],
    }));
    expect(content.bagrut).toEqual([
      { semel: 16471, name: 'מתמטיקה - תכנית חדשה', moed: '2026-06', final: 95 },
      { semel: 35571, name: 'מתמטיקה - תכנית חדשה', moed: '2026-01', school: 80, exam: 90, final: 88 },
    ]);
  });

  it('never has a status code, or a grade the Ministry only accepted', () => {
    const content = myGradesContent(input({
      withBagrut: true,
      bagrut: [
        sitting(1, '2026-06', { finalGrade: 999, schoolGrade: 85 }),
        sitting(2, '2026-06', { finalGrade: 999, examGrade: 777 }),
        sitting(3, '2026-06', { acceptedGrade: 90 }),
        sitting(4, '2026-06', { finalGrade: 999 }),
        sitting(4, '2026-01', { finalGrade: 70 }),
        sitting(5, '2026-06', { schoolGrade: 0 }),
      ],
    }));
    expect(content.bagrut!.map((r) => r.semel)).toEqual([1, 4, 5]);
    expect(content.bagrut![0]).toEqual({ semel: 1, name: 'מתמטיקה - תכנית חדשה', moed: '2026-06', school: 85 });
    expect(content.bagrut![0]).not.toHaveProperty('final');
    expect(content.bagrut![1]).toMatchObject({ moed: '2026-01', final: 70 });
    // A grade of 0 is a grade.
    expect(content.bagrut![2]).toMatchObject({ school: 0 });
    expect(JSON.stringify(content)).not.toMatch(/999|777|"accepted/);
  });

  it('is in the box only when it is shared', () => {
    const bagrut = [sitting(35571, '2026-01', { finalGrade: 88 })];
    expect(myGradesContent(input({ bagrut, withBagrut: false }))).not.toHaveProperty('bagrut');
    expect(myGradesContent(input({ bagrut, withBagrut: true })).bagrut).toHaveLength(1);
    expect(myGradesContent(input({ withBagrut: true })).bagrut).toEqual([]);
  });

  it('lists questionnaires in the same order whatever order Mashov sent them in', () => {
    const a = [sitting(2, '2026-01', { finalGrade: 80 }), sitting(1, '2026-01', { finalGrade: 90 })];
    const hashed = (exams: BagrutExam[]) => gradesHash(myGradesContent(input({ bagrut: exams, withBagrut: true })));
    expect(hashed(a)).toBe(hashed([...a].reverse()));
  });
});

describe('a grades box that does not fit', () => {
  /** 300 grades with 40-character names over 150 days, two a day: far more than a box holds once sealed. */
  function bulky(): BuddyGradesContent {
    const subjects = SUBJECTS.map((subject, s) => ({
      subject,
      average: 80 + s,
      grades: [] as BuddyGradesContent['subjects'][number]['grades'],
    }));
    for (let i = 0; i < 300; i += 1) {
      subjects[i % subjects.length]!.grades.push({ date: addDays(START, Math.floor(i / 2)), name: longName(i), value: 60 + (i % 40) });
    }
    // The newest first inside a subject, as `groupGradesBySubject` has them.
    for (const s of subjects) s.grades.reverse();
    return {
      v: 1, at: READ_AT, subjects,
      bagrut: [{ semel: 35571, name: 'מתמטיקה - תכנית חדשה', moed: '2026-01', school: 80, exam: 90, final: 88 }],
    };
  }

  it('fitGrades keeps a box that fits as it is', () => {
    const content = myGradesContent(input({ grades: [grade('2026-02-01', 'מתמטיקה'), grade('2026-02-02', 'אנגלית')], withBagrut: true, bagrut: [sitting(1, '2026-01', { finalGrade: 80 })] }));
    expect(sealedLength(content)).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);
    const fitted = fitGrades(content);
    expect(fitted).toEqual(content);
    expect(fitted).not.toHaveProperty('from');
  });

  it('fitGrades drops whole days, oldest first, and says from when', () => {
    const content = bulky();
    expect(sealedLength(content)).toBeGreaterThan(BUDDY_PAIR_CIPHERTEXT_MAX);
    const fitted = fitGrades(content)!;
    expect(fitted).not.toBeNull();
    expect(sealedLength(fitted)).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);

    const kept = allGrades(fitted);
    const from = fitted.from!;
    expect(from).toBeDefined();
    expect(from).toBe(kept.map((g) => g.date).sort()[0]);
    expect(kept.every((g) => g.date >= from)).toBe(true);
    // Whole days: every grade of every day from `from` on is still there.
    expect(kept).toHaveLength(allGrades(content).filter((g) => g.date >= from).length);
    expect(kept.length).toBeLessThan(allGrades(content).length);

    // And no more than needed: with one more day back, it would not fit.
    const days = [...new Set(allGrades(content).map((g) => g.date))].sort();
    const before = days[days.indexOf(from) - 1]!;
    const oneMore = { ...content, subjects: content.subjects.map((s) => ({ ...s, grades: s.grades.filter((g) => g.date >= before) })) };
    expect(sealedLength(oneMore)).toBeGreaterThan(BUDDY_PAIR_CIPHERTEXT_MAX);

    // The averages and the bagrut stay as they were; a subject that lost all its grades stays too.
    expect(fitted.subjects.map((s) => [s.subject, s.average])).toEqual(content.subjects.map((s) => [s.subject, s.average]));
    expect(fitted.bagrut).toEqual(content.bagrut);
    expect(fitted.v).toBe(1);
    expect(fitted.at).toBe(READ_AT);
  });

  it('fitGrades says from even when every grade had to go', () => {
    // A subject name that leaves room for no grade at all: the longest with which a box with none, and its `from`, still fits.
    const named = (length: number, grades: BuddyGradesContent['subjects'][number]['grades'], from?: string): BuddyGradesContent => ({
      v: 1, at: READ_AT, subjects: [{ subject: 'א'.repeat(length), average: 80, grades }], ...(from ? { from } : {}),
    });
    let length = 10_000;
    while (sealedLength(named(length + 1, [], '2026-03-04')) <= BUDDY_PAIR_CIPHERTEXT_MAX) length += 1;
    const content = named(length, [
      { date: '2026-03-03', name: longName(3), value: 70 }, { date: '2026-03-02', name: longName(2), value: 90 }, { date: '2026-03-01', value: 80 },
    ]);
    expect(sealedLength(content)).toBeGreaterThan(BUDDY_PAIR_CIPHERTEXT_MAX);

    const fitted = fitGrades(content)!;
    expect(fitted.subjects).toEqual([{ subject: 'א'.repeat(length), average: 80, grades: [] }]);
    // Nothing before the day after the newest grade is in it.
    expect(fitted.from).toBe('2026-03-04');
    expect(sealedLength(fitted)).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);
  });

  it('fitGrades gives none when not even a box with no grades fits', () => {
    const content = bulky();
    content.subjects[0]!.subject = 'א'.repeat(40_000);
    expect(fitGrades(content)).toBeNull();
    expect(fitGrades({ v: 1, at: READ_AT, subjects: [{ subject: 'א'.repeat(40_000), average: null, grades: [] }] })).toBeNull();
  });

  it('gradesHash ignores at', () => {
    const grades = [grade('2026-02-01', 'מתמטיקה'), grade('2026-02-02', 'אנגלית', { value: 71 })];
    const a = myGradesContent(input({ grades }));
    const b = myGradesContent(input({ grades, readAt: '2026-09-01T09:45:00.000Z' }));
    expect(a.at).not.toBe(b.at);
    expect(gradesHash(a)).toBe(gradesHash(b));
    expect(gradesHash(a)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(gradesHash(a)).not.toBe(gradesHash(myGradesContent(input({ grades: [grades[0]!] }))));
  });
});

describe('reading a grades box another phone wrote', () => {
  const mark = (code: number) => String.fromCharCode(code);
  const box = (over: Record<string, unknown> = {}) => ({ v: 1, at: READ_AT, subjects: [], ...over });
  const math = { subject: 'מתמטיקה', average: 88.5, grades: [{ date: '2026-02-02', name: 'מבחן', value: 91 }, { date: '2026-02-01', text: 'עבר' }] };
  const english = { subject: 'אנגלית', average: null, grades: [{ date: '2026-02-03', text: 'הוגש' }] };
  const row = { semel: 35571, name: 'מתמטיקה - תכנית חדשה', moed: '2026-01', school: 80, exam: 90, final: 88 };

  it('reads a box built by myGradesContent back the same', () => {
    const grades = [
      grade('2026-02-03', 'מתמטיקה', { value: 94, notes: 'בוחן' }),
      grade('2026-02-02', 'מתמטיקה', { value: null, valueText: 'עבר' }),
      grade('2026-02-01', 'אנגלית', { value: 71.5 }),
      grade('2026-01-20', 'ספרות', { value: null, valueText: 'הוגש' }),
    ];
    const bagrut = [sitting(35571, '2026-01', { schoolGrade: 80, examGrade: 90, finalGrade: 88 }), sitting(16471, '2026-06', { finalGrade: 95 })];
    const whole = myGradesContent(input({ grades, bagrut, withBagrut: true }));
    expect(whole.bagrut).toHaveLength(2);
    expect(readGradesContent(JSON.parse(JSON.stringify(whole)))).toEqual(whole);

    // The other shapes a builder gives: no bagrut part, no grades at all, a bagrut part chosen but empty, a trimmed box.
    const noBagrut = myGradesContent(input({ grades }));
    expect(readGradesContent(JSON.parse(JSON.stringify(noBagrut)))).toEqual(noBagrut);
    expect(readGradesContent(noBagrut)).not.toHaveProperty('bagrut');
    expect(readGradesContent(myGradesContent(input()))).toEqual({ v: 1, at: READ_AT, subjects: [] });
    expect(readGradesContent(myGradesContent(input({ withBagrut: true })))).toEqual({ v: 1, at: READ_AT, subjects: [], bagrut: [] });
    const trimmed = { ...whole, subjects: whole.subjects.map((s) => ({ ...s, grades: [] })), from: '2026-02-04' };
    expect(readGradesContent(JSON.parse(JSON.stringify(trimmed)))).toEqual(trimmed);
  });

  it('v and at are all or nothing', () => {
    expect(readGradesContent(box({ at: undefined }))).toBeNull();
    expect(readGradesContent(box({ at: 'x' }))).toBeNull();
    expect(readGradesContent(box({ at: 7 }))).toBeNull();
    expect(readGradesContent(box({ v: 0 }))).toBeNull();
    expect(readGradesContent(box({ v: '1' }))).toBeNull();
    expect(readGradesContent(null)).toBeNull();
    expect(readGradesContent([box()])).toBeNull();
    // Below them, a box with no list of subjects has nothing to show: it is one that could not be read.
    expect(readGradesContent(box({ subjects: undefined }))).toBeNull();
    expect(readGradesContent(box({ subjects: { מתמטיקה: [] } }))).toBeNull();
    // A later version's box is read as this one's: what this version does not know is left out.
    expect(readGradesContent({ ...box({ subjects: [math] }), v: 2, stickers: ['x'] })).toEqual(box({ subjects: [math] }));
    const extra = { ...math, trend: 'up', grades: [{ ...math.grades[0], rank: 1 }] };
    expect(readGradesContent(box({ subjects: [extra] }))).toEqual(box({ subjects: [{ ...math, grades: [math.grades[0]] }] }));
  });

  it('drops only what does not read', () => {
    const [newest, oldest] = math.grades;
    // A grade whose date is no date or whose value is no number goes; its neighbours stay.
    const brokenGrades: unknown[] = [{ date: '5.11', value: 80 }, { date: '2026-02-05', value: 'x' }, { date: '2026-02-05', value: Number.NaN }, { date: null, value: 80 }, 'a grade', { date: '2026-02-05', text: 7 }];
    for (const broken of brokenGrades) {
      expect(readGradesContent(box({ subjects: [{ ...math, grades: [newest, broken, oldest] }] })), JSON.stringify(broken)).toEqual(box({ subjects: [math] }));
    }
    // A subject with no list of grades goes; the others stay.
    const brokenSubjects: unknown[] = [{ subject: 'ספרות', average: 70 }, { subject: 'ספרות', average: 70, grades: 'none' }, { subject: 7, average: 70, grades: [] }, { subject: 'ספרות', average: 70, grades: null }, 'ספרות'];
    for (const broken of brokenSubjects) {
      expect(readGradesContent(box({ subjects: [math, broken, english] })), JSON.stringify(broken)).toEqual(box({ subjects: [math, english] }));
    }
    // A subject the trim left with no grades reads: its average is what the box says.
    const emptied = { subject: 'כימיה', average: 75, grades: [] };
    expect(readGradesContent(box({ subjects: [emptied, math] }))).toEqual(box({ subjects: [emptied, math] }));
    // A bagrut row whose code is no number, or whose grade is none, goes; its neighbours stay, and an empty list stays.
    const other = { semel: 16471, name: row.name, moed: '2026-06', final: 95 };
    const brokenRows: unknown[] = [{ ...row, semel: '35571' }, 'row', { ...row, final: 'x' }, { ...row, moed: '1/2026' }, { ...row, name: 7 }];
    expect(readGradesContent(box({ bagrut: [row, ...brokenRows, other] }))).toEqual(box({ bagrut: [row, other] }));
    expect(readGradesContent(box({ bagrut: [] }))).toEqual(box({ bagrut: [] }));
  });

  it('reads a field with no value as absent, whether it is missing or null', () => {
    const bare = { date: '2026-02-01', value: 80 };
    const nulls = { date: '2026-02-01', name: null, value: 80, text: null };
    const bareWords = { date: '2026-02-01', text: 'עבר' };
    const nullWords = { date: '2026-02-01', name: null, value: null, text: 'עבר' };
    expect(readGradesContent(box({ subjects: [{ subject: 'מתמטיקה', average: 80, grades: [nulls, bare, nullWords, bareWords] }] })))
      .toEqual(box({ subjects: [{ subject: 'מתמטיקה', average: 80, grades: [bare, bare, bareWords, bareWords] }] }));
    const [number, words] = readGradesContent(box({ subjects: [{ subject: 'מתמטיקה', average: 80, grades: [nulls, nullWords] }] }))!.subjects[0]!.grades;
    for (const key of ['name', 'text']) expect(number).not.toHaveProperty(key);
    for (const key of ['name', 'value']) expect(words).not.toHaveProperty(key);
    const noGrades = readGradesContent(box({ bagrut: [{ ...row, school: null, exam: null, final: null }] }))!.bagrut![0]!;
    expect(noGrades).toEqual({ semel: 35571, name: row.name, moed: '2026-01' });
    for (const key of ['school', 'exam', 'final']) expect(noGrades).not.toHaveProperty(key);
    // A grade of 0 is a grade.
    const zero = { subject: 'מתמטיקה', average: 0, grades: [{ date: '2026-02-01', value: 0 }] };
    expect(readGradesContent(box({ subjects: [zero] }))).toEqual(box({ subjects: [zero] }));
  });

  it('drops a grade with neither a number nor words: the builder never writes one, and there is nothing to show', () => {
    const [newest, oldest] = math.grades;
    const empties: unknown[] = [
      { date: '2026-02-05' }, { date: '2026-02-05', name: 'מבחן' }, { date: '2026-02-05', name: 'מבחן', value: null, text: null },
    ];
    for (const empty of empties) {
      expect(readGradesContent(box({ subjects: [{ ...math, grades: [newest, empty, oldest] }] })), JSON.stringify(empty)).toEqual(box({ subjects: [math] }));
    }
    // Only the grade goes: its subject reads, as one the trim emptied does, with its average.
    expect(readGradesContent(box({ subjects: [{ ...english, grades: [{ date: '2026-02-03', name: 'עבודה' }] }] })))
      .toEqual(box({ subjects: [{ ...english, grades: [] }] }));
  });

  it('text from another phone may not turn a sentence around it, or break its line', () => {
    const marks = [mark(0x202e), mark(0x2066), '\n', mark(0x200f), mark(0x07), mark(0x2028)];
    for (const m of marks) {
      const shown = JSON.stringify(m);
      expect(readGradesContent(box({ subjects: [math, { ...english, subject: `אנגלית${m}` }] })), shown).toEqual(box({ subjects: [math] }));
      const named = { date: '2026-02-05', name: `מבחן${m}`, value: 70 };
      expect(readGradesContent(box({ subjects: [{ ...math, grades: [math.grades[0], named, math.grades[1]] }] })), shown).toEqual(box({ subjects: [math] }));
      expect(readGradesContent(box({ bagrut: [row, { ...row, semel: 1, name: `${m}מתמטיקה` }] })), shown).toEqual(box({ bagrut: [row] }));
      const worded = { date: '2026-02-05', text: `עבר${m}` };
      expect(readGradesContent(box({ subjects: [{ ...math, grades: [worded, math.grades[0]] }] })), shown).toEqual(box({ subjects: [{ ...math, grades: [math.grades[0]] }] }));
    }
    // Nothing but blanks is no name.
    expect(readGradesContent(box({ subjects: [{ ...english, subject: '   ' }, math] }))).toEqual(box({ subjects: [math] }));
    // A joined emoji keeps its joiner.
    const emoji = { ...english, subject: 'אנגלית 👩‍💻' };
    expect(readGradesContent(box({ subjects: [emoji] }))).toEqual(box({ subjects: [emoji] }));
  });

  it('caps text by characters: 40 for a grade\'s name, 60 for a subject and a questionnaire', () => {
    const named = (name: string) => ({ date: '2026-02-05', name, value: 70 });
    const withGrade = (g: object) => box({ subjects: [{ ...math, grades: [g] }] });
    const noGrade = box({ subjects: [{ ...math, grades: [] }] });
    expect(readGradesContent(withGrade(named('ש'.repeat(BUDDY_GRADE_NAME_MAX))))).toEqual(withGrade(named('ש'.repeat(BUDDY_GRADE_NAME_MAX))));
    expect(readGradesContent(withGrade(named('ש'.repeat(BUDDY_GRADE_NAME_MAX + 1))))).toEqual(noGrade);
    // By code points, as the builder cuts: forty emoji are forty characters, though 80 UTF-16 units.
    expect(readGradesContent(withGrade(named('😀'.repeat(BUDDY_GRADE_NAME_MAX))))).toEqual(withGrade(named('😀'.repeat(BUDDY_GRADE_NAME_MAX))));
    expect(readGradesContent(withGrade(named('😀'.repeat(BUDDY_GRADE_NAME_MAX + 1))))).toEqual(noGrade);
    // A name the builder cut ends in an ellipsis and is exactly the cap: it reads.
    const cut = myGradesContent(input({ grades: [grade('2026-02-02', 'מתמטיקה', { notes: 'ש'.repeat(50) })] }));
    expect(readGradesContent(cut)).toEqual(cut);

    const cap = BUDDY_GRADE_SUBJECT_MAX;
    expect(readGradesContent(box({ subjects: [{ ...math, subject: 'מ'.repeat(cap) }] }))!.subjects).toHaveLength(1);
    expect(readGradesContent(box({ subjects: [{ ...math, subject: 'מ'.repeat(cap + 1) }, english] }))).toEqual(box({ subjects: [english] }));
    expect(readGradesContent(box({ bagrut: [{ ...row, name: 'מ'.repeat(cap) }] }))!.bagrut).toHaveLength(1);
    expect(readGradesContent(box({ bagrut: [{ ...row, name: 'מ'.repeat(cap + 1) }] }))).toEqual(box({ bagrut: [] }));
  });

  it('a from that is no date is left out, and an average is a number or null', () => {
    expect(readGradesContent(box({ from: '2026-02-04' }))).toEqual(box({ from: '2026-02-04' }));
    for (const from of ['4.2.2026', 7, 'x', null]) expect(readGradesContent(box({ from })), JSON.stringify(from)).toEqual(box());
    expect(readGradesContent(box({ subjects: [{ ...math, average: null }] }))!.subjects[0]!.average).toBeNull();
    for (const average of ['x', '88', Number.NaN, undefined, {}]) {
      expect(readGradesContent(box({ subjects: [{ ...math, average }, english] })), JSON.stringify(average)).toEqual(box({ subjects: [english] }));
    }
    // A part that is no list is left out, the rest of the box kept.
    expect(readGradesContent(box({ subjects: [math], bagrut: 'all' }))).toEqual(box({ subjects: [math] }));
  });

  it('reads how many grades an average leaves out, and drops only a count that does not read', () => {
    expect(readGradesContent(box({ subjects: [{ ...math, uncounted: 3 }] }))!.subjects[0]!.uncounted).toBe(3);
    // A count that does not read only explains the average: it goes, the subject stays, as in a box from an older app.
    for (const uncounted of [0, -1, 1.5, '3', null, BUDDY_GRADES_MAX + 1]) {
      expect(readGradesContent(box({ subjects: [{ ...math, uncounted }] })), JSON.stringify(uncounted)).toEqual(box({ subjects: [math] }));
    }
  });
});

describe('a friend\'s grades set beside mine', () => {
  const box = (subjects: BuddyGradeSubject[], over: Partial<BuddyGradesContent> = {}): BuddyGradesContent => ({ v: 1, at: READ_AT, subjects, ...over });
  const subjectOf = (subject: string, grades: BuddyGrade[], average: number | null = 80): BuddyGradeSubject => ({ subject, average, grades });
  /** One grade of a box: no name when `name` is null. */
  const entry = (date: string, name: string | null, value: number): BuddyGrade => (name ? { date, name, value } : { date, value });
  const bagrutRow = (semel: number, over: Partial<BuddyBagrutRow> = {}): BuddyBagrutRow => ({ semel, name: `שאלון ${semel}`, moed: '2026-01', final: 80, ...over });
  const noBagrut = { shared: [], others: [] };
  /** The rows of the one subject both boxes have, whatever else is in them. */
  const rowsOf = (mine: BuddyGrade[], theirs: BuddyGrade[], mineOver: Partial<BuddyGradesContent> = {}, theirsOver: Partial<BuddyGradesContent> = {}) =>
    compareGrades(box([subjectOf('מתמטיקה', mine)], mineOver), box([subjectOf('מתמטיקה', theirs)], theirsOver)).shared[0]!.rows;

  it('subjects match by subjectsMatch, and the shared one is named as theirs', () => {
    const mine = entry('2026-02-01', 'מבחן', 85);
    const theirs = entry('2026-02-01', 'מבחן', 90);
    expect(compareGrades(box([subjectOf('אנגלית 5 יח״ל', [mine], 85)]), box([subjectOf('אנגלית', [theirs], 90)]))).toEqual({
      shared: [{ subject: 'אנגלית', mine: 85, theirs: 90, mineCount: 1, theirsCount: 1, mineUncounted: 0, theirsUncounted: 0, rows: [{ date: '2026-02-01', name: 'מבחן', mine, theirs, onlyOne: null }] }],
      others: [],
      bagrut: noBagrut,
    });
    // The other way round it is still theirs that names it.
    const flipped = compareGrades(box([subjectOf('אנגלית', [mine])]), box([subjectOf('אנגלית 5 יח״ל', [theirs])]));
    expect(flipped.shared.map((s) => s.subject)).toEqual(['אנגלית 5 יח״ל']);
    // Subjects that do not match are not set beside each other: theirs is one of the rest.
    const apart = compareGrades(box([subjectOf('מתמטיקה', [mine])]), box([subjectOf('אנגלית', [theirs])]));
    expect(apart.shared).toEqual([]);
    expect(apart.others.map((s) => s.subject)).toEqual(['אנגלית']);
  });

  it('shared subjects first, by newest grade; then the rest of theirs; mine alone not at all', () => {
    const mine = box([
      subjectOf('מתמטיקה', [entry('2026-02-20', 'בוחן', 80)]),
      subjectOf('אנגלית', [entry('2026-02-10', 'בוחן', 80)]),
      subjectOf('ספרות', [entry('2026-03-01', 'חיבור', 80)]),
    ]);
    const theirs = box([
      subjectOf('מתמטיקה', [entry('2026-02-05', 'מבחן', 90)]),
      subjectOf('אנגלית', [entry('2026-02-15', 'מבחן', 90)]),
      subjectOf('פיזיקה', [entry('2026-03-02', 'מעבדה', 90)]),
      subjectOf('כימיה', [entry('2026-02-01', 'בוחן', 90)]),
    ]);
    const compared = compareGrades(mine, theirs);
    // Maths has the newest grade of either side (20.2), though English is first by name; the rest of theirs stay in the order of their box, not by name.
    expect(compared.shared.map((s) => s.subject)).toEqual(['מתמטיקה', 'אנגלית']);
    expect(compared.others.map((s) => s.subject)).toEqual(['פיזיקה', 'כימיה']);
    // A subject of theirs that is not mine has no number of mine and none of my grades.
    expect(compared.others[0]).toEqual({
      subject: 'פיזיקה', mine: null, theirs: 80, mineCount: 0, theirsCount: 1, mineUncounted: 0, theirsUncounted: 0,
      rows: [{ date: '2026-03-02', name: 'מעבדה', mine: null, theirs: entry('2026-03-02', 'מעבדה', 90), onlyOne: 'theirs' }],
    });
    // Literature is mine alone: it is nowhere.
    expect(JSON.stringify(compared)).not.toContain('ספרות');
  });

  it('carries how many grades each average leaves out, 0 for a box that does not say', () => {
    const day = [entry('2026-02-01', 'חוק קולון', 70)];
    const compared = compareGrades(box([{ ...subjectOf('פיזיקה', day), uncounted: 3 }, subjectOf('כימיה', day)]), box([{ ...subjectOf('פיזיקה', day), uncounted: 2 }, { ...subjectOf('ביולוגיה', day), uncounted: 1 }]));
    expect(compared.shared.map((s) => [s.subject, s.mineUncounted, s.theirsUncounted])).toEqual([['פיזיקה', 3, 2]]);
    expect(compared.others.map((s) => [s.subject, s.mineUncounted, s.theirsUncounted])).toEqual([['ביולוגיה', 0, 1]]);
  });

  it('subjects whose newest grade is the same day go by name', () => {
    const day = [entry('2026-02-01', 'בוחן', 80)];
    const compared = compareGrades(box([subjectOf('ספרות', day), subjectOf('ביולוגיה', day)]), box([subjectOf('ספרות', day), subjectOf('ביולוגיה', day)]));
    expect(compared.shared.map((s) => s.subject)).toEqual(['ביולוגיה', 'ספרות']);
  });

  it('a subject with every grade trimmed is still a subject that side has', () => {
    // Mine lost every grade to the trim (`from` is the day after the newest), but kept its averages.
    const mine = box([subjectOf('כימיה', [], 75), subjectOf('ספרות', [], 60)], { from: '2026-03-01' });
    const theirs = box([subjectOf('כימיה', [entry('2026-02-01', 'בוחן', 70)], 72), subjectOf('פיזיקה', [], 88)]);
    expect(compareGrades(mine, theirs)).toEqual({
      shared: [{
        subject: 'כימיה', mine: 75, theirs: 72, mineCount: 0, theirsCount: 1, mineUncounted: 0, theirsUncounted: 0,
        // My box does not reach back to 1.2, so there may have been a grade of mine on it.
        rows: [{ date: '2026-02-01', name: 'בוחן', mine: null, theirs: entry('2026-02-01', 'בוחן', 70), onlyOne: null }],
      }],
      others: [{ subject: 'פיזיקה', mine: null, theirs: 88, mineCount: 0, theirsCount: 0, mineUncounted: 0, theirsUncounted: 0, rows: [] }],
      bagrut: noBagrut,
    });
  });

  it('a subject of mine is set beside one of theirs only, never two', () => {
    // "אנגלית" is a whole word of "אנגלית דוברי", so both of theirs match it; my grades are shown once.
    const mine = box([subjectOf('אנגלית', [entry('2026-02-01', 'מבחן', 85)])]);
    const theirs = box([subjectOf('אנגלית', [entry('2026-02-02', 'בוחן', 90)]), subjectOf('אנגלית דוברי', [entry('2026-02-03', 'חיבור', 70)])]);
    const compared = compareGrades(mine, theirs);
    expect(compared.shared.map((s) => s.subject)).toEqual(['אנגלית']);
    expect(compared.others.map((s) => s.subject)).toEqual(['אנגלית דוברי']);
    expect([...compared.shared, ...compared.others].flatMap((s) => s.rows).filter((r) => r.mine !== null)).toHaveLength(1);
    expect(compared.others[0]!.mineCount).toBe(0);
  });

  it('sets a subject beside the one of the same name first, before one whose name only resembles it', () => {
    // ״אנגלית״ is a whole word of ״אנגלית דוברי״, so each matches the other by `subjectsMatch`: taken in the order of
    // the boxes alone, their ״אנגלית״ would take my ״אנגלית דוברי״, listed first, and the two would cross.
    const mine = box([subjectOf('אנגלית דוברי', [entry('2026-02-03', 'חיבור', 75)], 75), subjectOf('אנגלית', [entry('2026-02-01', 'מבחן', 85)], 85)]);
    const theirs = box([subjectOf('אנגלית', [entry('2026-02-02', 'בוחן', 90)], 90), subjectOf('אנגלית דוברי', [entry('2026-02-04', 'חיבור', 70)], 70)]);
    const compared = compareGrades(mine, theirs);
    expect(compared.others).toEqual([]);
    expect(compared.shared.map((s) => [s.subject, s.mine, s.theirs])).toEqual([['אנגלית דוברי', 75, 70], ['אנגלית', 85, 90]]);
    // Spaces do not make a name another.
    const spaced = box([subjectOf(' אנגלית  ', [entry('2026-02-02', 'בוחן', 90)], 90), subjectOf('אנגלית   דוברי', [entry('2026-02-04', 'חיבור', 70)], 70)]);
    expect(compareGrades(mine, spaced).shared.map((s) => [s.subject, s.mine, s.theirs])).toEqual([['אנגלית   דוברי', 75, 70], [' אנגלית  ', 85, 90]]);
    // A subject with none of the same name still goes by `subjectsMatch`.
    const resembling = compareGrades(
      box([subjectOf('מתמטיקה', [entry('2026-02-01', 'מבחן', 60)], 60), subjectOf('אנגלית', [entry('2026-02-01', 'מבחן', 85)], 85)]),
      box([subjectOf('אנגלית 5 יח״ל', [entry('2026-02-02', 'בוחן', 90)], 90)]),
    );
    expect(resembling.shared.map((s) => [s.subject, s.mine])).toEqual([['אנגלית 5 יח״ל', 85]]);
  });

  it('counts the grades of each side, for the label of the number', () => {
    const compared = compareGrades(
      box([subjectOf('מתמטיקה', [entry('2026-02-02', 'בוחן', 80), { date: '2026-02-01', text: 'עבר' }])]),
      box([subjectOf('מתמטיקה', [entry('2026-02-02', 'בוחן', 90)])]),
    );
    expect(compared.shared[0]).toMatchObject({ mineCount: 2, theirsCount: 1 });
  });

  it('same date and same name is one row', () => {
    const mine = entry('2026-02-05', 'מבחן פרק 3', 91);
    const theirs = entry('2026-02-05', 'מבחן פרק 3', 85);
    expect(rowsOf([mine], [theirs])).toEqual([{ date: '2026-02-05', name: 'מבחן פרק 3', mine, theirs, onlyOne: null }]);
  });

  it('spaces do not tell two names apart', () => {
    // Two and two, so only the names can say which goes with which.
    const [exam, quiz] = [entry('2026-02-05', 'מבחן פרק 3', 91), entry('2026-02-05', 'בוחן', 70)];
    const [theirQuiz, theirExam] = [entry('2026-02-05', 'בוחן ', 75), entry('2026-02-05', ' מבחן   פרק 3 ', 85)];
    expect(rowsOf([exam, quiz], [theirQuiz, theirExam])).toEqual([
      { date: '2026-02-05', name: 'מבחן פרק 3', mine: exam, theirs: theirExam, onlyOne: null },
      { date: '2026-02-05', name: 'בוחן', mine: quiz, theirs: theirQuiz, onlyOne: null },
    ]);
  });

  it('same date, different names, one each side is one row named as mine', () => {
    const rows = rowsOf(
      [entry('2026-02-05', 'מבחן שכבתי', 80), entry('2026-02-04', null, 70), entry('2026-02-03', null, 60)],
      [entry('2026-02-05', 'מבחן מסכם', 90), entry('2026-02-04', 'בוחן', 75), entry('2026-02-03', null, 65)],
    );
    expect(rows).toEqual([
      { date: '2026-02-05', name: 'מבחן שכבתי', mine: entry('2026-02-05', 'מבחן שכבתי', 80), theirs: entry('2026-02-05', 'מבחן מסכם', 90), onlyOne: null },
      // Mine has no name here, so theirs names it.
      { date: '2026-02-04', name: 'בוחן', mine: entry('2026-02-04', null, 70), theirs: entry('2026-02-04', 'בוחן', 75), onlyOne: null },
      { date: '2026-02-03', name: null, mine: entry('2026-02-03', null, 60), theirs: entry('2026-02-03', null, 65), onlyOne: null },
    ]);
  });

  it('two of mine and one of theirs on a date: the same-name pair is one row, the other mine alone', () => {
    const quiz = entry('2026-02-05', 'הגשה', 100);
    const mine = entry('2026-02-05', 'מבחן', 80);
    const theirs = entry('2026-02-05', 'מבחן', 90);
    expect(rowsOf([quiz, mine], [theirs])).toEqual([
      { date: '2026-02-05', name: 'מבחן', mine, theirs, onlyOne: null },
      { date: '2026-02-05', name: 'הגשה', mine: quiz, theirs: null, onlyOne: 'mine' },
    ]);
    // The pair is the same whichever of mine comes first.
    expect(rowsOf([mine, quiz], [theirs])).toEqual(rowsOf([quiz, mine], [theirs]));
  });

  it('two of each with different names on a date pair nothing: it cannot be told which is which', () => {
    const [a, b, c, d] = [entry('2026-02-05', 'א', 1), entry('2026-02-05', 'ב', 2), entry('2026-02-05', 'ג', 3), entry('2026-02-05', 'ד', 4)];
    expect(rowsOf([a, b], [c, d])).toEqual([
      { date: '2026-02-05', name: 'א', mine: a, theirs: null, onlyOne: 'mine' },
      { date: '2026-02-05', name: 'ב', mine: b, theirs: null, onlyOne: 'mine' },
      { date: '2026-02-05', name: 'ג', mine: null, theirs: c, onlyOne: 'theirs' },
      { date: '2026-02-05', name: 'ד', mine: null, theirs: d, onlyOne: 'theirs' },
    ]);
  });

  it('grades with no name are not told apart: more than one on a side on a date pair nothing', () => {
    const [a, b, c, d] = [entry('2026-02-05', null, 1), entry('2026-02-05', null, 2), entry('2026-02-05', null, 3), entry('2026-02-05', null, 4)];
    const alone = (side: 'mine' | 'theirs', grade: BuddyGrade): GradeRow => ({ date: '2026-02-05', name: null, mine: side === 'mine' ? grade : null, theirs: side === 'theirs' ? grade : null, onlyOne: side });
    // Two of each: which goes with which is only the order of the boxes.
    expect(rowsOf([a, b], [c, d])).toEqual([alone('mine', a), alone('mine', b), alone('theirs', c), alone('theirs', d)]);
    // Two of mine and one of theirs.
    expect(rowsOf([a, b], [c])).toEqual([alone('mine', a), alone('mine', b), alone('theirs', c)]);
    // One of mine and two of theirs.
    expect(rowsOf([a], [b, c])).toEqual([alone('mine', a), alone('theirs', b), alone('theirs', c)]);
    // A pair by name is still one row, and the one with no name on each side that is left is another.
    const named = entry('2026-02-05', 'מבחן', 80);
    expect(rowsOf([a, named], [entry('2026-02-05', 'מבחן', 90), c])).toEqual([
      { date: '2026-02-05', name: 'מבחן', mine: named, theirs: entry('2026-02-05', 'מבחן', 90), onlyOne: null },
      { date: '2026-02-05', name: null, mine: a, theirs: c, onlyOne: null },
    ]);
  });

  it('rows newest first', () => {
    const rows = rowsOf(
      [entry('2026-02-20', 'בוחן', 80), entry('2026-02-10', 'מבחן', 80), entry('2026-01-15', 'חיבור', 80)],
      // Not in order, as another phone's box may not be.
      [entry('2026-02-01', 'עבודה', 90), entry('2026-02-25', 'פרויקט', 90), entry('2026-02-10', 'מבחן', 90)],
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-02-25', '2026-02-20', '2026-02-10', '2026-02-01', '2026-01-15']);
  });

  it('one side only says onlyOne mine or theirs', () => {
    const rows = rowsOf(
      [entry('2026-02-20', 'בוחן', 80), entry('2026-02-10', 'מבחן', 80)],
      [entry('2026-02-25', 'פרויקט', 90), entry('2026-02-10', 'מבחן', 90)],
    );
    expect(rows.map((r) => [r.date, r.onlyOne, r.mine !== null, r.theirs !== null])).toEqual([
      ['2026-02-25', 'theirs', false, true],
      ['2026-02-20', 'mine', true, false],
      ['2026-02-10', null, true, true],
    ]);
  });

  it('their from: my grades older than it have onlyOne null', () => {
    // Their box reaches back to 10.2, and a grade of mine on that very day would have had its match in it.
    const rows = rowsOf(
      [entry('2026-02-20', 'בוחן', 80), entry('2026-02-10', 'מבחן', 80), entry('2026-02-09', 'חיבור', 80), entry('2026-01-15', 'עבודה', 80)],
      [entry('2026-02-25', 'פרויקט', 90)],
      {},
      { from: '2026-02-10' },
    );
    expect(rows.map((r) => [r.date, r.onlyOne])).toEqual([
      ['2026-02-25', 'theirs'],
      ['2026-02-20', 'mine'],
      ['2026-02-10', 'mine'],
      ['2026-02-09', null],
      ['2026-01-15', null],
    ]);
    // The grade is still in the row, only the "mine alone" is not claimed.
    expect(rows[4]).toEqual({ date: '2026-01-15', name: 'עבודה', mine: entry('2026-01-15', 'עבודה', 80), theirs: null, onlyOne: null });
  });

  it('my from: their grades older than it have onlyOne null', () => {
    const rows = rowsOf(
      [entry('2026-02-25', 'פרויקט', 80)],
      [entry('2026-02-20', 'בוחן', 90), entry('2026-02-10', 'מבחן', 90), entry('2026-02-09', 'חיבור', 90), entry('2026-01-15', 'עבודה', 90)],
      { from: '2026-02-10' },
    );
    expect(rows.map((r) => [r.date, r.onlyOne])).toEqual([
      ['2026-02-25', 'mine'],
      ['2026-02-20', 'theirs'],
      ['2026-02-10', 'theirs'],
      ['2026-02-09', null],
      ['2026-01-15', null],
    ]);
  });

  it('both froms: a grade older than where the other box starts is not claimed as one side\'s alone', () => {
    // My box reaches back to 10.2, theirs to 6.2: their grades of 8.2 and 6.2 may have had a match of mine that my box left out.
    const mineGrades = [entry('2026-02-20', 'בוחן', 80), entry('2026-02-15', 'מבחן', 80), entry('2026-02-10', 'עבודה', 80)];
    const theirGrades = [entry('2026-02-25', 'פרויקט', 90), entry('2026-02-15', 'מבחן', 90), entry('2026-02-08', 'מעבדה', 90), entry('2026-02-06', 'חיבור', 90)];
    const rows = rowsOf(mineGrades, theirGrades, { from: '2026-02-10' }, { from: '2026-02-06' });
    expect(rows.map((r) => [r.date, r.onlyOne, r.mine !== null, r.theirs !== null])).toEqual([
      ['2026-02-25', 'theirs', false, true],
      ['2026-02-20', 'mine', true, false],
      ['2026-02-15', null, true, true],
      // On my own start, and after theirs: mine alone.
      ['2026-02-10', 'mine', true, false],
      ['2026-02-08', null, false, true],
      ['2026-02-06', null, false, true],
    ]);
    // The other way round, the same: it is the box that starts later that cannot say.
    const flipped = rowsOf(theirGrades, mineGrades, { from: '2026-02-06' }, { from: '2026-02-10' });
    expect(flipped.map((r) => [r.date, r.onlyOne])).toEqual([
      ['2026-02-25', 'mine'], ['2026-02-20', 'theirs'], ['2026-02-15', null], ['2026-02-10', 'theirs'], ['2026-02-08', null], ['2026-02-06', null],
    ]);
  });

  it('bagrut matches by semel, named as theirs: the shared questionnaires, then the rest of theirs', () => {
    const mineRows = [bagrutRow(16471), bagrutRow(35571, { name: 'מתמטיקה (שם שלי)', final: 70 }), bagrutRow(11111)];
    const theirRows = [bagrutRow(22222), bagrutRow(35571, { name: 'מתמטיקה', final: 88 }), bagrutRow(11111, { final: 95 })];
    const compared = compareGrades(box([], { bagrut: mineRows }), box([], { bagrut: theirRows }));
    // 16471 is mine alone: it is nowhere. Each list is in the order of their box.
    expect(compared.bagrut).toEqual({
      shared: [
        { semel: 35571, name: 'מתמטיקה', mine: mineRows[1], theirs: theirRows[1] },
        { semel: 11111, name: 'שאלון 11111', mine: mineRows[2], theirs: theirRows[2] },
      ],
      others: [{ semel: 22222, name: 'שאלון 22222', mine: null, theirs: theirRows[0] }],
    });
  });

  it('a box with no bagrut part has no questionnaires to set beside', () => {
    const rows = [bagrutRow(35571)];
    // Mine did not share it: all of theirs are the rest of theirs.
    expect(compareGrades(box([]), box([], { bagrut: rows })).bagrut).toEqual({ shared: [], others: [{ semel: 35571, name: 'שאלון 35571', mine: null, theirs: rows[0] }] });
    // Theirs did not: nothing, however much mine has.
    expect(compareGrades(box([], { bagrut: rows }), box([])).bagrut).toEqual(noBagrut);
    expect(compareGrades(box([], { bagrut: [] }), box([], { bagrut: [] })).bagrut).toEqual(noBagrut);
  });

  it('sets two boxes built by myGradesContent beside each other, as they are', () => {
    const mine = myGradesContent(input({
      grades: [
        grade('2026-02-10', 'אנגלית 5 יח״ל (יב2)', { value: 92, notes: 'בוחן' }),
        grade('2026-02-01', 'אנגלית 5 יח״ל (יב2)', { value: 80, notes: 'מבחן' }),
        grade('2026-02-02', 'ספרות', { value: 70 }),
      ],
    }));
    const theirs = myGradesContent(input({
      grades: [grade('2026-02-10', 'אנגלית 4 יח״ל', { value: 88, notes: 'בוחן' }), grade('2026-01-05', 'פיזיקה', { value: 75 })],
    }));
    const compared = compareGrades(mine, theirs);
    expect(compared.shared).toEqual([{
      subject: 'אנגלית', mine: mine.subjects[0]!.average, theirs: theirs.subjects[0]!.average, mineCount: 2, theirsCount: 1, mineUncounted: 0, theirsUncounted: 0,
      rows: [
        { date: '2026-02-10', name: 'בוחן', mine: { date: '2026-02-10', name: 'בוחן', value: 92 }, theirs: { date: '2026-02-10', name: 'בוחן', value: 88 }, onlyOne: null },
        { date: '2026-02-01', name: 'מבחן', mine: { date: '2026-02-01', name: 'מבחן', value: 80 }, theirs: null, onlyOne: 'mine' },
      ],
    }]);
    expect(compared.others.map((s) => s.subject)).toEqual(['פיזיקה']);
  });

  it('does not touch the boxes it is given', () => {
    const mine = box([subjectOf('מתמטיקה', [entry('2026-02-01', 'מבחן', 85)]), subjectOf('אנגלית', [entry('2026-03-01', 'בוחן', 85)])], { bagrut: [bagrutRow(1)] });
    const theirs = box([subjectOf('אנגלית', [entry('2026-02-05', 'בוחן', 90)]), subjectOf('מתמטיקה', [entry('2026-02-01', 'מבחן', 90)])], { bagrut: [bagrutRow(1), bagrutRow(2)] });
    const before = JSON.stringify([mine, theirs]);
    compareGrades(mine, theirs);
    expect(JSON.stringify([mine, theirs])).toBe(before);
  });
});
