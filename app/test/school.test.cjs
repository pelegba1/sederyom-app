const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Compiles one app module to CommonJS; `deps` resolves its relative imports. */
function load(file, deps = {}) {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  const localRequire = (id) => (id in deps ? deps[id] : require(id));
  new Function('module', 'exports', 'require', code)(module, module.exports, localRequire);
  return module.exports;
}

const format = load('format.ts');
const gradeWeights = load('gradeWeights.ts', { './format': format });
const s = load('school.ts', { './format': format, './gradeWeights': gradeWeights });

function exam(key, date, subject, extra = {}) {
  return { naturalKey: key, date, subject, details: null, source: 'school_site', hidden: false, subjectKey: '', match: { mine: null, reason: null }, ...extra };
}

// --- exams ------------------------------------------------------------------

test('subjectFromTitle: the subject in full, from real exam titles; block exams by block; nothing → ""', () => {
  assert.equal(s.subjectFromTitle('י"ב- מתכונת באנגלית'), 'אנגלית');
  assert.equal(s.subjectFromTitle('בגרות באנגלית - G'), 'אנגלית');
  assert.equal(s.subjectFromTitle('י"ב- מבחן במתמטיקה'), 'מתמטיקה');
  assert.equal(s.subjectFromTitle('י"ב 2 - מתכונת בשירותי רשת'), 'שירותי רשת');
  assert.equal(s.subjectFromTitle('י"ב- מתכונת מדמ"ח 271'), 'מדעי המחשב');
  assert.equal(s.subjectFromTitle('י"ב גוש - בגרות במדעי המחשב 899271'), 'מדעי המחשב');
  assert.equal(s.subjectFromTitle('י"ב מתכונת במוזיקה ובאמנות'), 'מוזיקה');
  assert.equal(s.subjectFromTitle('ריצה בחנ"ג'), 'חינוך גופני');
  assert.equal(s.subjectFromTitle('י"ב- מבחן בגוש ב - פיזיקה, אמנות ומוזיקה'), 'גוש ב׳');
  assert.equal(s.subjectFromTitle("י\"ב מבחן גוש א'"), 'גוש א׳');
  assert.equal(s.subjectFromTitle('י"ב- בע"פ ערבית'), 'ערבית');
  assert.equal(s.subjectFromTitle('י"ב- מבחן בעברית'), 'עברית');
  assert.equal(s.subjectFromTitle('י"ב-מועד ב'), '');
  assert.equal(s.subjectFromTitle('י"ב טורניר כספות'), '');
});

test('groupExamsBySubject: server subjectKey first, title fallback, "אחר" last, groups by nearest exam', () => {
  const exams = [
    exam('a1', '2026-10-20', 'י"ב-מבחן באנגלית'),
    exam('m1', '2026-10-12', 'י"ב- מבחן במתמטיקה'),
    exam('o1', '2026-10-10', 'י"ב-מועד ב'),
    exam('a2', '2026-10-14', 'בגרות באנגלית - G', { match: { mine: true, reason: null } }),
    // The server's key wins over the title.
    exam('x1', '2026-10-30', 'י"ב 3 אקדמיזציה', { subjectKey: 'אקדמיזציה' }),
  ];
  const groups = s.groupExamsBySubject(exams);
  assert.deepEqual(groups.map((g) => g.key), ['מתמטיקה', 'אנגלית', 'אקדמיזציה', 'אחר']);
  const english = groups[1];
  assert.deepEqual(english.exams.map((e) => e.naturalKey), ['a2', 'a1'], 'date order inside a group');
  assert.equal(english.firstDate, '2026-10-14');
  assert.equal(english.recommended, true);
  assert.equal(groups[0].recommended, false);
});

test('groupExamsBySubject: tolerates an older server with no subjectKey or match', () => {
  const groups = s.groupExamsBySubject([{ naturalKey: 'k', date: '2026-10-20', subject: 'מבחן בהיסטוריה' }]);
  assert.equal(groups[0].key, 'היסטוריה');
  assert.equal(groups[0].recommended, false);
});

test('switching a subject edits the hide-list without losing keys it does not show', () => {
  const groups = s.groupExamsBySubject([
    exam('a1', '2026-10-20', 'מבחן באנגלית'),
    exam('a2', '2026-11-20', 'מתכונת באנגלית'),
    exam('m1', '2026-10-21', 'מבחן במתמטיקה'),
  ]);
  const english = groups.find((g) => g.key === 'אנגלית');
  const keys = english.exams.map((e) => e.naturalKey);
  // "past" is a past exam's key the picker no longer lists.
  const off = s.setExamsShown(['past', 'm1'], keys, false);
  assert.deepEqual(off, ['past', 'm1', 'a1', 'a2']);
  assert.deepEqual(s.groupShown(english, new Set(off)), { shown: 0, total: 2 });
  const on = s.setExamsShown(off, keys, true);
  assert.deepEqual(on, ['past', 'm1']);
  assert.deepEqual(s.groupShown(english, new Set(on)), { shown: 2, total: 2 });
  // Mixed: one of two shown.
  assert.deepEqual(s.groupShown(english, new Set(['a2'])), { shown: 1, total: 2 });
  // Hiding what is already hidden adds no duplicate.
  assert.deepEqual(s.setExamsShown(['a1'], keys, false), ['a1', 'a2']);
});

test('groupReason: one reason for the whole subject only when every exam gives it', () => {
  const english = exam('mine', '2026-10-20', 'מבחן באנגלית', { match: { mine: true, reason: null } });
  const improvers = (key, date, title) => exam(key, date, title, { match: { mine: false, reason: 'רק למשפרים' } });
  const [, tanakh] = s.groupExamsBySubject([english, improvers('not', '2026-10-21', 'בגרות בתנ"ך - רק למשפרים'), improvers('not2', '2026-11-01', 'מתכונת בתנ"ך')]);
  assert.equal(tanakh.key, 'תנ״ך');
  assert.equal(s.groupReason(tanakh), 'רק למשפרים');
  const mixed = s.groupExamsBySubject([improvers('x', '2026-10-20', 'מבחן בתנ"ך'), exam('y', '2026-10-21', 'מבחן בתנ"ך')])[0];
  assert.equal(s.groupReason(mixed), null);
});

test('examCounts: one count of marked exams, the unsure among them, and recommended exams left off (R-16)', () => {
  const m = (mine, reason = null) => ({ match: { mine, reason } });
  const exams = [
    exam('mine-on', '2026-10-20', 'מבחן באנגלית', m(true)),
    exam('mine-off', '2026-10-20', 'מבחן במתמטיקה', m(true)),
    exam('mine-off2', '2026-10-22', 'מבחן בהיסטוריה', m(true)),
    exam('unsure-on', '2026-10-21', 'מבחן גוש א', m(null)),
    exam('unsure-off', '2026-10-21', 'מבחן גוש ב', m(null)),
    exam('not-on', '2026-10-23', 'בגרות בתנ"ך - רק למשפרים', m(false, 'רק למשפרים')),
    exam('not-off', '2026-10-24', 'מבחן בכימיה', m(false, 'לא במערכת שלך')),
    // An older server: no match at all reads as unsure.
    { naturalKey: 'old', date: '2026-10-25', subject: 'מבחן בספרות' },
  ];
  const hidden = new Set(['mine-off', 'mine-off2', 'unsure-off', 'not-off', 'past']);
  const counts = s.examCounts(exams, hidden);
  assert.equal(counts.chosen, 4, 'mine-on, unsure-on, not-on, old');
  assert.equal(counts.unsure, 2, 'unsure-on and old');
  assert.deepEqual(counts.recommendedOff, ['mine-off', 'mine-off2']);
  // Marking them is what "לסמן את המומלצים (2)" does — nothing else moves.
  const after = s.setExamsShown([...hidden], counts.recommendedOff, true);
  assert.deepEqual(after, ['unsure-off', 'not-off', 'past']);
  assert.deepEqual(s.examCounts(exams, new Set(after)).recommendedOff, []);
  assert.equal(s.examCounts(exams, new Set(after)).chosen, 6);

  assert.equal(s.examsChosenLabel(12), '12 מבחנים מסומנים כשלך');
  assert.equal(s.examsChosenLabel(1), 'מבחן אחד מסומן כשלך');
  assert.equal(s.examsChosenLabel(0), '0 מבחנים מסומנים כשלך');
});

test('examsCountLabel: one number, the unsure ones inside it (W4-4), in onboarding\'s word "לבדוק" (run 7)', () => {
  assert.equal(s.examsCountLabel(15, 4), '15 מבחנים מסומנים כשלך (מתוכם 4 לבדוק)');
  assert.equal(s.examsCountLabel(15, 1), '15 מבחנים מסומנים כשלך (מתוכם אחד לבדוק)');
  assert.equal(s.examsCountLabel(15, 0), '15 מבחנים מסומנים כשלך');
  assert.equal(s.examsCountLabel(4, 4), '4 מבחנים מסומנים כשלך (כולם לבדוק)');
  assert.equal(s.examsCountLabel(1, 1), 'מבחן אחד מסומן כשלך (לבדוק)');
  assert.equal(s.examsCountLabel(0, 0), '0 מבחנים מסומנים כשלך');
  // The persona run: 11 recommended + 4 unsure left marked after "נראה נכון ✓" — one number, 15.
  const m = (mine) => ({ match: { mine, reason: mine === false ? 'לא במערכת שלך' : null } });
  const exams = [
    ...Array.from({ length: 11 }, (_, i) => exam(`mine${i}`, '2026-10-20', 'מבחן באנגלית', m(true))),
    ...Array.from({ length: 4 }, (_, i) => exam(`unsure${i}`, '2026-11-01', 'מתכונת באנגלית וויקה', m(null))),
    ...Array.from({ length: 15 }, (_, i) => exam(`not${i}`, '2026-10-25', 'מבחן בכימיה', m(false))),
  ];
  const hidden = new Set(Array.from({ length: 15 }, (_, i) => `not${i}`));
  const counts = s.examCounts(exams, hidden);
  assert.equal(s.examsCountLabel(counts.chosen, counts.unsure), '15 מבחנים מסומנים כשלך (מתוכם 4 לבדוק)');
  assert.equal(s.examsMineLabel(counts.chosen, counts.unsure), '15 מבחנים שלך, 4 לבדוק');
});

test('examsMineLabel: the same count, short, on School\'s "המבחנים שלי" row (plan §16)', () => {
  assert.equal(s.examsMineLabel(19, 4), '19 מבחנים שלך, 4 לבדוק');
  assert.equal(s.examsMineLabel(19, 1), '19 מבחנים שלך, אחד לבדוק');
  assert.equal(s.examsMineLabel(19, 0), '19 מבחנים שלך');
  assert.equal(s.examsMineLabel(4, 4), '4 מבחנים שלך, כולם לבדוק');
  assert.equal(s.examsMineLabel(1, 1), 'מבחן אחד שלך, לבדוק');
  assert.equal(s.examsMineLabel(1, 0), 'מבחן אחד שלך');
  assert.equal(s.examsMineLabel(0, 0), '0 מבחנים שלך');
  // One comma, no "·" and no brackets: a line under a row's title (plan §16.2).
  for (const [c, u] of [[19, 4], [4, 4], [1, 1]]) assert.doesNotMatch(s.examsMineLabel(c, u), /[·()]/);
});

test('daysLeft: the next exam\'s hero number and the list\'s end word, without "עוד"', () => {
  assert.deepEqual(s.daysLeft(0), { value: 'היום', unit: null });
  assert.deepEqual(s.daysLeft(1), { value: 'מחר', unit: null });
  assert.deepEqual(s.daysLeft(2), { value: 'יומיים', unit: null });
  assert.deepEqual(s.daysLeft(3), { value: '3', unit: 'ימים' });
  assert.deepEqual(s.daysLeft(24), { value: '24', unit: 'ימים' });
  // A day gone by reads as the countdown says it.
  assert.deepEqual(s.daysLeft(-1), { value: 'אתמול', unit: null });
  assert.equal(s.daysLeftLabel(24), '24 ימים');
  assert.equal(s.daysLeftLabel(2), 'יומיים');
  assert.equal(s.daysLeftLabel(0), 'היום');
});

test('groupSwitch: a subject with only some exams marked is partial, "2 מתוך 3", not on', () => {
  const [english] = s.groupExamsBySubject([
    exam('a1', '2026-10-20', 'מבחן באנגלית'),
    exam('a2', '2026-11-20', 'מתכונת באנגלית'),
    exam('a3', '2026-12-20', 'בגרות באנגלית'),
  ]);
  assert.deepEqual(s.groupSwitch(english, new Set()), { state: 'on', shown: 3, total: 3, label: null });
  assert.deepEqual(s.groupSwitch(english, new Set(['a1', 'a2', 'a3'])), { state: 'off', shown: 0, total: 3, label: null });
  assert.deepEqual(s.groupSwitch(english, new Set(['a2'])), { state: 'partial', shown: 2, total: 3, label: '2 מתוך 3' });
});

test('block exams: one group per block, its subjects on each exam, no repeated reason (R1 labels)', () => {
  const exams = [
    exam('b1', '2026-10-20', 'י"ב- מבחן בגוש ב', { subjectKey: 'גוש ב׳: פיזיקה, ביולוגיה', match: { mine: true, reason: null } }),
    exam('b2', '2026-11-20', 'י"ב- מבחן בגוש ב', { subjectKey: 'גוש ב׳: אמנות, מוזיקה', match: { mine: false, reason: 'גוש ב׳: אמנות, מוזיקה' } }),
    // An older server, or details that list nothing: the title names the block.
    exam('b3', '2026-12-01', "י\"ב מבחן גוש ב'"),
    exam('a1', '2026-10-25', 'י"ב- מבחן בגוש א', { subjectKey: 'גוש א׳: כימיה, היסטוריה, ספרות, …', match: { mine: null, reason: null } }),
    exam('r1', '2026-10-26', 'י"ב-מועד ב באנגלית', { subjectKey: 'אנגלית', match: { mine: false, reason: 'מועד ב׳ — רק למי שניגש' } }),
  ];
  const groups = s.groupExamsBySubject(exams);
  assert.deepEqual(groups.map((g) => g.key), ['גוש ב׳', 'גוש א׳', 'אנגלית']);
  assert.deepEqual(groups[0].exams.map((e) => e.naturalKey), ['b1', 'b2', 'b3']);
  assert.equal(s.isBlockGroup('גוש ב׳'), true);
  assert.equal(s.isBlockGroup('אנגלית'), false);
  assert.equal(s.blockSubjects(exams[0]), 'פיזיקה, ביולוגיה');
  assert.equal(s.blockSubjects(exams[1]), 'אמנות, מוזיקה');
  assert.equal(s.blockSubjects(exams[2]), null);
  assert.equal(s.blockSubjects(exams[3]), 'כימיה, היסטוריה, ספרות, …');
  // From the reason alone, when the key does not carry it.
  assert.equal(s.blockSubjects({ ...exams[1], subjectKey: '' }), 'אמנות, מוזיקה');
  // The block label is not repeated as a reason tag; real reasons are.
  assert.equal(s.examReason(exams[1]), null);
  assert.equal(s.examReason(exams[4]), 'מועד ב׳ — רק למי שניגש');
  assert.equal(s.examReason(exams[0]), null);
  assert.equal(s.groupReason(groups[0]), null);
  assert.deepEqual(s.parseBlockLabel('גוש: פיזיקה'), { block: 'גוש', subjects: 'פיזיקה' });
  assert.equal(s.parseBlockLabel('גוש א׳ — מקצוע אחר'), null);
});

test('tagExplainer: one sentence for "גוש" and "רק למשפרים", nothing for the rest', () => {
  assert.equal(s.tagExplainer('גוש ב׳'), 'בגוש נבחנים בכמה מקצועות באותה שעה. אם אחד מהם הוא שלך, המבחן נוגע לך');
  assert.equal(s.tagExplainer('גוש א׳ — מקצוע אחר'), s.BLOCK_EXPLAINER);
  assert.equal(s.tagExplainer('רק למשפרים'), s.IMPROVERS_EXPLAINER);
  // The sentence explains "משפרים" without the word's own root (W5-9: Maya still did not know who they are).
  assert.doesNotMatch(s.IMPROVERS_EXPLAINER, /משפר|לשפר/);
  assert.equal(s.tagExplainer('לא במערכת שלך'), null);
  assert.equal(s.tagExplainer('גושים'), null);
});

test('splitExamDetails: double spaces cleaned, a lone leading time goes next to the date', () => {
  assert.deepEqual(s.splitExamDetails('13:00'), { time: '13:00', text: null });
  assert.deepEqual(s.splitExamDetails('9:00'), { time: '09:00', text: null });
  assert.deepEqual(s.splitExamDetails('13:00:   שאלון 571- 5 יח"ל'), { time: '13:00', text: 'שאלון 571- 5 יח"ל' });
  // Two sittings: both times stay where they are, whitespace cleaned.
  assert.deepEqual(
    s.splitExamDetails('09:00:   שאלון 471 - 4 יח"ל \n                שאלון 572- 5 יח"ל\n\n 13:30:    שאלון 371 - 3 יח"ל'),
    { time: null, text: '09:00: שאלון 471 - 4 יח"ל\nשאלון 572- 5 יח"ל\n13:30: שאלון 371 - 3 יח"ל' },
  );
  assert.deepEqual(s.splitExamDetails('שעות: 16:00-8:00'), { time: null, text: 'שעות: 16:00-8:00' });
  assert.deepEqual(s.splitExamDetails('16:00-17:30'), { time: null, text: '16:00-17:30' });
  assert.deepEqual(s.splitExamDetails('3-2'), { time: null, text: '3-2' });
  assert.deepEqual(s.splitExamDetails('פיסיקה-גליה,סיון\n כימיה-דינה\n ביולוגיה-כוכבה '), { time: null, text: 'פיסיקה-גליה,סיון\nכימיה-דינה\nביולוגיה-כוכבה' });
  assert.deepEqual(s.splitExamDetails('   '), { time: null, text: null });
  assert.deepEqual(s.splitExamDetails(null), { time: null, text: null });
});

test('examEmptyState: nothing chosen vs nothing published', () => {
  assert.equal(s.examEmptyState(32), 'none_chosen');
  assert.equal(s.examEmptyState(null), 'none_chosen');
  assert.equal(s.examEmptyState(0), 'none_published');
});

// --- grades -----------------------------------------------------------------

test('formatAverage and weightLabel', () => {
  assert.equal(s.formatAverage(79), '79');
  assert.equal(s.formatAverage(86.46), '86.5');
  assert.equal(s.formatAverage(86.04), '86');
  assert.equal(s.weightLabel(10), '10% מהציון במקצוע');
  assert.equal(s.weightLabel(null), null);
  assert.equal(s.weightLabel(0), null);
});

test('gradeHighlight: only a high grade gets a word, "מצוין"; nothing judges a lower one (R-19)', () => {
  assert.equal(s.gradeHighlight(95), 'מצוין');
  assert.equal(s.gradeHighlight(90), 'מצוין');
  assert.equal(s.gradeHighlight(89.9), null);
  assert.equal(s.gradeHighlight(40), null);
  assert.equal(s.gradeHighlight(null), null);
  for (let v = 0; v <= 100; v += 1) assert.ok([null, 'מצוין'].includes(s.gradeHighlight(v)), `grade ${v}`);
  // The judging words are gone from the module altogether.
  const source = require('node:fs').readFileSync(path.join(__dirname, '../src/lib/school.ts'), 'utf8');
  for (const word of ['נמוך', 'לא עובר', 'נכשל']) assert.ok(!source.includes(`'${word}'`), word);
});

test('averageLabel: a subject with one grade says "ציון", with more "ממוצע" — a grade in words counts (R-19, Daniel)', () => {
  assert.equal(s.averageLabel(1), 'ציון');
  assert.equal(s.averageLabel(2), 'ממוצע');
  assert.equal(s.averageLabel(5), 'ממוצע');
  // English in the persona run: 78 and "הוגש". The line under it says "2 ציונים",
  // so the number over it is the average of the numeric ones, called "ממוצע".
  const g = (key, date, value, valueText = null, weight = null) => (
    { naturalKey: key, date, subject: 'אנגלית 5 יח"ל (יב2)', value, valueText, weight, notes: null, firstSeen: null });
  const [english] = s.groupGradesBySubject([g('1', '2026-09-25', 78, null, 20), g('2', '2026-09-09', null, 'הוגש')]);
  assert.equal(english.grades.length, 2);
  assert.equal(s.averageLabel(english.grades.length), 'ממוצע');
  assert.equal(english.average.value, 78);
  assert.equal(english.average.count, 1);
});

test('averageNote: one short line under an average that is not a plain mean, none under one that is (plan §15)', () => {
  const g = (key, value, notes, weight = 0) => ({ naturalKey: key, date: '2026-10-01', subject: 'פיזיקה', value, valueText: null, weight, notes, firstSeen: null });
  const [byType] = s.groupGradesBySubject([g('1', 80, 'מבחן'), g('2', 100, 'עבודה')]);
  assert.equal(s.averageNote(byType.average), 'ממוצע משוקלל לפי סוג');
  // Only Mashov's own weights (Noa's subject, W6-8): weighted, but not by type.
  const [own] = s.groupGradesBySubject([g('1', 90, 'מבחן', 10), g('2', 84, 'מבחן', 25)]);
  assert.equal(s.averageNote(own.average), 'ממוצע משוקלל');
  // Equal Mashov weights that are only part of the grade: a plain mean, but the line stays, so its "?" can say how much.
  const [equal] = s.groupGradesBySubject([g('1', 90, 'מבחן', 20), g('2', 80, 'מבחן', 20)]);
  assert.equal(equal.average.weighted, false);
  assert.equal(s.averageNote(equal.average), 'ממוצע משוקלל');
  assert.equal(s.averageSharesText(equal.average), '2 ציונים בודדים 40%');
  // Equal weights that make the whole grade, and thirds that add up to 100 only nearly: no line.
  assert.equal(s.averageNote(s.groupGradesBySubject([g('1', 90, 'מבחן', 50), g('2', 80, 'מבחן', 50)])[0].average), null);
  const thirds = { subjects: { 'פיזיקה': { types: [
    { id: 'exam', label: 'מבחן', percent: 10 }, { id: 'quiz', label: 'בוחן', percent: 10 },
    { id: 'work', label: 'עבודה', percent: 10 }, { id: 'other', label: 'אחר', percent: 0 },
  ] } }, grades: {} };
  assert.equal(s.averageNote(s.groupGradesBySubject([g('1', 80, 'מבחן'), g('2', 100, 'בוחן'), g('3', 90, 'עבודה')], thirds)[0].average), null);
  // A plain mean — one type, or all "אחר" — and no average: no line.
  assert.equal(s.averageNote(s.groupGradesBySubject([g('1', 80, 'מבחן'), g('2', 90, 'מבחן')])[0].average), null);
  assert.equal(s.averageNote(s.groupGradesBySubject([g('1', 80, null), g('2', 90, null)])[0].average), null);
  assert.equal(s.averageNote(null), null);
  // The sentence it replaces is gone (three run-7 testers could not read it).
  const source = require('node:fs').readFileSync(path.join(__dirname, '../src/lib/school.ts'), 'utf8');
  assert.ok(!source.includes('ששווים ${'));
  assert.equal(s.gradedShareLabel, undefined);
});

test('averageSharesText: an open subject\'s parts, each as a percent of the grade, with commas (plan §16.2)', () => {
  const g = (key, value, notes, weight = 0) => ({ naturalKey: key, date: '2026-10-01', subject: 'פיזיקה', value, valueText: null, weight, notes, firstSeen: null });
  // Exams and works with grades (quizzes have none): 75% and 25%; "אחר" at 0% says so.
  const [a] = s.groupGradesBySubject([g('1', 80, 'מבחן'), g('2', 100, 'ניסוי חקר'), g('3', 40, 'חוק קולון')]);
  assert.equal(s.averageSharesText(a.average), 'מבחן 75%, עבודה 25%, אחר 0%');
  // A grade with its own weight comes last, and the types share the rest.
  const [b] = s.groupGradesBySubject([g('1', 80, 'מבחן'), g('2', 100, 'עבודה', 10)]);
  assert.equal(s.averageSharesText(b.average), 'מבחן 90%, ציון בודד 10%');
  // Mashov's weights only: how much of the grade they are.
  const [c] = s.groupGradesBySubject([g('1', 90, 'מבחן', 10), g('2', 84, 'מבחן', 25)]);
  assert.equal(s.averageSharesText(c.average), '2 ציונים בודדים 35%');
  // Thirds round to one decimal.
  const thirds = s.groupGradesBySubject([g('1', 80, 'מבחן'), g('2', 100, 'בוחן'), g('3', 90, 'עבודה')],
    { subjects: { 'פיזיקה': { types: [
      { id: 'exam', label: 'מבחן', percent: 10 }, { id: 'quiz', label: 'בוחן', percent: 10 },
      { id: 'work', label: 'עבודה', percent: 10 }, { id: 'other', label: 'אחר', percent: 0 },
    ] } }, grades: {} })[0];
  assert.equal(s.averageSharesText(thirds.average), 'מבחן 33.3%, בוחן 33.3%, עבודה 33.3%');
  assert.equal(thirds.average.value, 90);
});

test('WEIGHTED_AVERAGE_EXPLAINER: the grades tab explains its averages once, behind one question (plan §16.2)', () => {
  assert.match(s.WEIGHTED_AVERAGE_EXPLAINER, /משקלים/);
  assert.doesNotMatch(s.WEIGHTED_AVERAGE_EXPLAINER, /[✓·—]/);
  // Help reads as a question in a text button, not as a heading with a "?" (Wave 9 re-rate).
  assert.equal(s.AVERAGE_HELP, 'איך מחשבים את הממוצע?');
});

test('percentSumParts: the sum of the percents, and a word when it is not 100', () => {
  assert.deepEqual(s.percentSumParts(100), { lead: 'סה״כ ', value: '100%', note: null });
  assert.deepEqual(s.percentSumParts(90), { lead: 'סה״כ ', value: '90%', note: 'הממוצע לפי היחס ביניהם' });
  assert.deepEqual(s.percentSumParts(112.5), { lead: 'סה״כ ', value: '112.5%', note: 'הממוצע לפי היחס ביניהם' });
  assert.equal(s.percentSumParts(99.99).note, null);
  assert.equal(s.CHANGED_WORD, 'שינית');
});

test('assessmentName: the assessment Mashov names, cleaned, on one line (W4-7)', () => {
  assert.equal(s.assessmentName({ notes: '  מבחן   פרק 3 ' }), 'מבחן פרק 3');
  assert.equal(s.assessmentName({ notes: 'עבודה ביחידה 2\nהגשה שנייה' }), 'עבודה ביחידה 2 הגשה שנייה');
  assert.equal(s.assessmentName({ notes: 'מבחן לוגריתמים' }), 'מבחן לוגריתמים');
  assert.equal(s.assessmentName({ notes: null }), null);
  assert.equal(s.assessmentName({ notes: '   ' }), null);
});

test('groupGradesBySubject: by subject without the group, newest first, with an average', () => {
  const g = (key, date, subject, value, weight = null) => ({ naturalKey: key, date, subject, value, valueText: null, weight, notes: null, firstSeen: null });
  const groups = s.groupGradesBySubject([
    g('1', '2026-09-10', 'אנגלית 5 יח"ל (יב2)', 80),
    g('2', '2026-10-01', 'מתמטיקה (יב2)', 90),
    g('3', '2026-10-05', 'אנגלית 5 יח"ל (יב2)', 100),
  ]);
  assert.deepEqual(groups.map((x) => x.subject), ['אנגלית', 'מתמטיקה']);
  assert.deepEqual(groups[0].grades.map((x) => x.naturalKey), ['3', '1']);
  assert.equal(groups[0].average.value, 90);
  // With the owner's weights: an English test at 40%, and the rest to its other grade's type.
  const weighted = s.groupGradesBySubject([
    g('1', '2026-09-10', 'אנגלית 5 יח"ל (יב2)', 80),
    g('3', '2026-10-05', 'אנגלית 5 יח"ל (יב2)', 100),
  ], { subjects: {}, grades: { 3: { weight: 40 } } });
  assert.equal(weighted[0].average.value, 0.4 * 100 + 0.6 * 80);
});

// --- homework ---------------------------------------------------------------

const TODAY = '2026-10-08';

test('isOverdue: open and past due; done or undated never', () => {
  assert.equal(s.isOverdue({ dueDate: '2026-10-07', done: false }, TODAY), true);
  assert.equal(s.isOverdue({ dueDate: '2026-10-07', done: true }, TODAY), false);
  assert.equal(s.isOverdue({ dueDate: TODAY, done: false }, TODAY), false);
  assert.equal(s.isOverdue({ dueDate: '2026-10-09', done: false }, TODAY), false);
  assert.equal(s.isOverdue({ dueDate: null, done: false }, TODAY), false);
});

test('homeworkSections: open by due date (overdue first, undated last), done apart, old ones folded', () => {
  const hw = (key, dueDate, done = false) => ({ naturalKey: key, dueDate, subject: 'היסטוריה', text: 't', linkedTaskId: null, done });
  const { open, done, older } = s.homeworkSections([
    hw('undated', null),
    hw('tomorrow', '2026-10-09'),
    hw('late', '2026-10-06'),
    hw('done', '2026-10-05', true),
    hw('ancient', '2026-08-01'),
    hw('today', TODAY),
  ], TODAY);
  assert.deepEqual(open.map((h) => h.naturalKey), ['late', 'today', 'tomorrow', 'undated']);
  assert.deepEqual(done.map((h) => h.naturalKey), ['done']);
  assert.deepEqual(older.map((h) => h.naturalKey), ['ancient']);
});

test('dueParts and shortWeekday: "להגשה עד יום ו׳" + "9.10"', () => {
  assert.deepEqual(s.dueParts('2026-10-09'), { prefix: 'להגשה עד יום ו׳', date: '9.10' });
  assert.equal(s.shortWeekday('2026-10-10'), 'שבת');
  assert.equal(s.shortWeekday('2026-10-11'), 'יום א׳');
});

test('marginWeekday: the weekday under a date in a list\'s 56-point margin, as narrow as it goes', () => {
  assert.equal(s.marginWeekday('2026-10-09'), 'ו׳');
  assert.equal(s.marginWeekday('2026-10-11'), 'א׳');
  assert.equal(s.marginWeekday('2026-10-10'), 'שבת');
});

test('homeworkTaskTitle: subject without its group, first line, cut at a word; full text as notes', () => {
  assert.deepEqual(s.homeworkTaskTitle({ subject: 'היסטוריה (יב2)', text: 'לקרוא  פרק 3' }), { title: 'היסטוריה: לקרוא פרק 3', notes: null });
  const long = s.homeworkTaskTitle({ subject: 'אנגלית 5 יח"ל (יב2)', text: 'לכתוב חיבור של 250 מילים על הנושא שנבחר בכיתה ולהגיש אותו במודל עד יום שישי' });
  assert.ok(long.title.startsWith('אנגלית: לכתוב חיבור'));
  assert.ok(long.title.endsWith('…'));
  assert.ok(long.title.length <= s.TASK_TITLE_MAX);
  assert.ok(!long.title.slice(0, -1).endsWith(' '));
  assert.equal(long.notes, 'לכתוב חיבור של 250 מילים על הנושא שנבחר בכיתה ולהגיש אותו במודל עד יום שישי');
  const twoLines = s.homeworkTaskTitle({ subject: 'מתמטיקה', text: 'תרגילים 1-5\nעמוד 30' });
  assert.deepEqual(twoLines, { title: 'מתמטיקה: תרגילים 1-5', notes: 'תרגילים 1-5\nעמוד 30' });
});

test('findSchoolList: the "בית ספר" list when there is one', () => {
  assert.deepEqual(s.findSchoolList([{ id: '1', title: 'My Tasks' }, { id: '2', title: 'בית ספר' }]), { id: '2', title: 'בית ספר' });
  assert.equal(s.findSchoolList([{ id: '3', title: 'בית־הספר' }]).id, '3');
  assert.equal(s.findSchoolList([{ id: '4', title: 'בית הספר' }]).id, '4');
  assert.equal(s.findSchoolList([{ id: '1', title: 'My Tasks' }]), null);
  assert.equal(s.findSchoolList(undefined), null);
});

// --- Mashov not connected (F8) ----------------------------------------------

function source(extra) {
  return {
    source: 'mashov', state: 'ok', lastOkAt: null, consecutiveFailures: 0, degradedSince: null, lastError: null,
    message: null, account: null, sourceFreshness: null, needsReauth: false, configured: true, ...extra,
  };
}

test('mashovLink: not configured, needs reauth, connected, and unknown counts as connected', () => {
  assert.deepEqual(s.mashovLink([source({ configured: false })]), { connected: false, reason: 'not_configured', lastOkAt: null });
  assert.deepEqual(
    s.mashovLink([source({ needsReauth: true, lastOkAt: '2026-10-05T09:00:00+03:00' })]),
    { connected: false, reason: 'needs_reauth', lastOkAt: '2026-10-05T09:00:00+03:00' },
  );
  assert.deepEqual(s.mashovLink([source({})]), { connected: true });
  assert.deepEqual(s.mashovLink(undefined), { connected: true });
  assert.deepEqual(s.mashovLink([source({ source: 'shahaf' })]), { connected: true });
});

test('feedState: the empty state says why when Mashov is not connected, never a bare "אין"', () => {
  const off = s.mashovLink([source({ configured: false })]);
  const on = s.mashovLink([source({})]);
  assert.equal(s.feedState(0, off), 'disconnected');
  assert.equal(s.feedState(3, off), 'stale');
  assert.equal(s.feedState(0, on), 'empty');
  assert.equal(s.feedState(3, on), 'list');
  assert.equal(s.disconnectedText('grades', off), 'משוב לא מחובר, לכן אין כאן ציונים להצגה');
  const reauth = s.mashovLink([source({ needsReauth: true })]);
  assert.equal(s.disconnectedText('homework', reauth), 'משוב ניתק את החיבור, לכן אין כאן שיעורי בית להצגה');
  assert.equal(s.connectLabel(off), 'התחברות למשוב');
  assert.equal(s.connectLabel(reauth), 'להתחבר שוב למשוב');
});

test('staleBanner: "המידע מ־5.10, משוב לא מחובר", and no date when Mashov never answered', () => {
  const link = s.mashovLink([source({ needsReauth: false, configured: false, lastOkAt: '2026-10-05T09:00:00' })]);
  assert.deepEqual(s.staleBanner('grades', link), { lead: 'המידע מ־', date: '5.10', tail: ', משוב לא מחובר' });
  assert.deepEqual(s.staleBanner('messages', link), { lead: 'הודעות ממשוב עד ', date: '5.10', tail: ', משוב לא מחובר' });
  const never = s.mashovLink([source({ configured: false })]);
  assert.deepEqual(s.staleBanner('homework', never), { lead: 'המידע לא מתעדכן, משוב לא מחובר', date: null, tail: '' });
});

test('counts lead with what is shown: "10 מקצועות שלך מוצגים"', () => {
  assert.equal(s.lessonsShownLabel(10), '10 מקצועות שלך מוצגים');
  assert.equal(s.lessonsShownLabel(1), 'מקצוע אחד שלך מוצג');
});

// --- tasks from the School screen (R-20, R-21) ------------------------------

test('studyTaskDue: two days before the exam, or today when that has passed', () => {
  assert.equal(s.studyTaskDue('2026-10-20', TODAY), '2026-10-18');
  assert.equal(s.studyTaskDue('2026-10-10', TODAY), TODAY, 'exactly two days ahead');
  assert.equal(s.studyTaskDue('2026-10-09', TODAY), TODAY, 'tomorrow: today, not yesterday');
  assert.equal(s.studyTaskDue(TODAY, TODAY), TODAY);
  assert.equal(s.studyTaskDue('2026-11-01', TODAY), '2026-10-30', 'across a month');
});

test('studyTask: "ללמוד למבחן ב<מקצוע>" from the subject key, the title, or the owner\'s subject in a block', () => {
  const t = s.studyTask({ date: '2026-10-20', subject: 'י"ב- מבחן  במתמטיקה', subjectKey: 'מתמטיקה' }, TODAY);
  // The notes name the exam's day in the one form an exam's date is written in (Wave 9 re-rate).
  // The date after a comma, no "·" (Wave 9 re-rate).
  assert.deepEqual(t, { title: 'ללמוד למבחן במתמטיקה, 20.10', notes: 'י"ב- מבחן במתמטיקה\nיום שלישי 20.10', due: '2026-10-18' });
  assert.equal(s.studyTask({ date: '2026-10-20', subject: 'בגרות באנגלית - G' }, TODAY).title, 'ללמוד למבחן באנגלית, 20.10');
  const block = { date: '2026-10-20', subject: 'י"ב- מבחן בגוש ב', subjectKey: 'גוש ב׳: פיזיקה, ביולוגיה, …' };
  assert.equal(s.studyTask({ ...block, match: { mine: true, reason: null } }, TODAY).title, 'ללמוד למבחן בפיזיקה, 20.10');
  assert.equal(s.studyTask({ ...block, match: { mine: null, reason: null } }, TODAY).title, 'ללמוד למבחן בגוש ב׳, 20.10');
  assert.equal(s.studyTask({ date: '2026-10-20', subject: "י\"ב מבחן גוש א'" }, TODAY).title, 'ללמוד למבחן בגוש א׳, 20.10');
  assert.equal(s.studyTask({ date: '2026-10-20', subject: 'י"ב טורניר כספות' }, TODAY).title, 'ללמוד למבחן: י"ב טורניר כספות, 20.10');
  assert.equal(s.studyTask({ date: '2026-10-09', subject: 'מבחן בכימיה' }, TODAY).due, TODAY);
});

test('studyPlanLine: the exam sheet says the plan in one plain sentence from the data (Wave 9 re-rate)', () => {
  const english = { date: '2026-10-20', subject: 'מבחן באנגלית', subjectKey: 'אנגלית' };
  // One session: the whole sentence, its day through Ltr.
  assert.deepEqual(s.studyPlanLine(english, 1, '2026-10-18', TODAY), { text: 'נוסיף משימה ללמוד לאנגלית ביום ראשון ', date: '18.10' });
  assert.deepEqual(s.studyPlanLine(english, 1, TODAY, TODAY), { text: 'נוסיף משימה ללמוד לאנגלית היום', date: null });
  assert.deepEqual(s.studyPlanLine(english, 1, '2026-10-17', TODAY), { text: 'נוסיף משימה ללמוד לאנגלית בשבת ', date: '17.10' });
  // Several: how many; each row says its own day.
  assert.deepEqual(s.studyPlanLine(english, 3, '2026-10-11', TODAY), { text: 'נוסיף 3 משימות ללמוד לאנגלית', date: null });
  // What it is for, as the task's title names it.
  const block = { date: '2026-10-20', subject: 'י"ב- מבחן בגוש ב', subjectKey: 'גוש ב׳: פיזיקה, ביולוגיה, …' };
  assert.equal(s.studyWhat({ ...block, match: { mine: true, reason: null } }), 'לפיזיקה');
  assert.equal(s.studyWhat({ ...block, match: { mine: null, reason: null } }), 'לגוש ב׳');
  assert.equal(s.studyWhat({ date: '2026-10-20', subject: 'בגרות באנגלית - G' }), 'לאנגלית');
  assert.equal(s.studyWhat({ date: '2027-01-21', subject: 'אנגלית', subjectKey: 'אנגלית', kind: 'bagrut' }), 'לבגרות באנגלית');
  assert.equal(s.studyWhat({ date: '2026-10-20', subject: 'י"ב טורניר כספות' }), 'למבחן');
  assert.equal(s.studySubject({ date: '2026-10-20', subject: 'י"ב טורניר כספות' }), null);
  // No quotes, no "·", no colon: one sentence.
  for (const count of [1, 2]) assert.doesNotMatch(s.studyPlanLine(english, count, '2026-10-18', TODAY).text, /[״"·:]/);
});

test('messageTaskTitle: the message title as the task; body and sender as notes', () => {
  assert.deepEqual(
    s.messageTaskTitle({ title: 'להביא  אישור טיול', body: 'עד יום ה׳ למזכירות', from: 'דנה כהן' }),
    { title: 'להביא אישור טיול', notes: 'עד יום ה׳ למזכירות\n\nמאת דנה כהן' },
  );
  assert.deepEqual(s.messageTaskTitle({ title: 'תזכורת', body: 'תזכורת', from: null }), { title: 'תזכורת', notes: null });
  const long = s.messageTaskTitle({ title: 'הודעה ארוכה מאוד על טיול השנתי שיתקיים בשבוע הבא בצפון הארץ עם כל השכבה', body: '', from: null });
  assert.ok(long.title.endsWith('…'));
  assert.ok(long.title.length <= s.TASK_TITLE_MAX);
  assert.equal(long.notes, 'הודעה ארוכה מאוד על טיול השנתי שיתקיים בשבוע הבא בצפון הארץ עם כל השכבה');
  assert.equal(s.messageTaskTitle({ title: '', body: 'שורה ראשונה\nשורה שנייה', from: null }).title, 'שורה ראשונה');
});

// --- a date in a message (W4-6) ----------------------------------------------
// TODAY, 8.10.2026, is a Thursday.

test('dateInText: weekdays, "מחר", "מחרתיים" and written dates, from the persona messages', () => {
  // Itai's "ציוד למעבדת פיזיקה": the coming Wednesday.
  assert.equal(s.dateInText('ציוד למעבדת פיזיקה\nביום רביעי מביאים חלוק. בלי חלוק לא נכנסים', TODAY), '2026-10-14');
  // Noa's "תגבור במתמטיקה": the written date wins, and "15:15" is a time, not a date.
  assert.equal(s.dateInText('תגבור במתמטיקה לקראת המבחן\nביום רביעי, 14.10, בשעה 15:15 בחדר 12', TODAY), '2026-10-14');
  assert.equal(s.dateInText('להביא אישור לטיול עד 11.10', TODAY), '2026-10-11');
  assert.equal(s.dateInText('את העבודה מגישים עד ה־12.10', TODAY), '2026-10-12');
  assert.equal(s.dateInText('את העבודה מגישים עד ה-12/10', TODAY), '2026-10-12');
  assert.equal(s.dateInText('הגשה 12/10', TODAY), '2026-10-12');
  assert.equal(s.dateInText('הגשה 12.10.26', TODAY), '2026-10-12');
  assert.equal(s.dateInText('הגשה 12/10/2026', TODAY), '2026-10-12');
  // A deadline beats the event's own date.
  assert.equal(s.dateInText('הטיול ב־20.10. אישורים חתומים עד ה־14.10', TODAY), '2026-10-14');
  assert.equal(s.dateInText('עד יום ה׳ למזכירות', TODAY), '2026-10-15', 'on a Thursday, "יום ה׳" is next week');
  assert.equal(s.dateInText("ביום א' אין לימודים", TODAY), '2026-10-11');
  assert.equal(s.dateInText('ליום שני להביא מחשבון', TODAY), '2026-10-12');
  assert.equal(s.dateInText('מחר מבחן פתע', TODAY), '2026-10-09');
  assert.equal(s.dateInText('לסיים למחר את התרגילים', TODAY), '2026-10-09');
  assert.equal(s.dateInText('מחרתיים יש חזרה', TODAY), '2026-10-10');
  assert.equal(s.dateInText('ביום רביעי', '2026-10-14'), '2026-10-21', 'on a Wednesday, the next one');
  // "15.1" written in December is January.
  assert.equal(s.dateInText('הבגרות ב־15.1', '2026-12-20'), '2027-01-15');
});

test('dateInText: numbers that are not dates, and words that are not days', () => {
  for (const text of [
    'שאלון 571- 5 יח"ל', 'פרק 3.2 בספר', 'ממוצע 86.5', 'בשעה 12.10 בחדר', 'שאלות 1–5 בעמוד 30', '3.5 יח״ל', 'נפגשים ב־13:00',
    'תרגילים 1-5', '31.2', 'היום יש חזרה', 'למחרת הטיול', 'התגבור בוטל', '', 'עמ׳ 12.10',
  ]) assert.equal(s.dateInText(text, TODAY), null, text);
  // Far ahead without a year: a reference, not a deadline.
  assert.equal(s.dateInText('ראו סעיף 3 בחוזר 2.7', TODAY), null);
});

test('messageTaskDue: read from the day the message was sent; a passed day gives no date, a weekday the coming one', () => {
  const msg = (date, title, body = '') => ({ title, body, date, from: null });
  // Sent Monday 5.10: "מחר" was Tuesday, already gone.
  assert.equal(s.messageTaskDue(msg('2026-10-05T09:00:00+03:00', 'מחר מביאים מחשבון'), TODAY), null);
  // …but a weekday is read as the coming one.
  assert.equal(s.messageTaskDue(msg('2026-10-05T09:00:00+03:00', 'ציוד למעבדת פיזיקה', 'ביום רביעי מביאים חלוק'), TODAY), '2026-10-14');
  // Sent Wednesday 7.10, "ביום רביעי" is next week's.
  assert.equal(s.messageTaskDue(msg('2026-10-07T18:00:00+03:00', 'ציוד למעבדת פיזיקה', 'ביום רביעי מביאים חלוק'), TODAY), '2026-10-14');
  assert.equal(s.messageTaskDue(msg('2026-10-07T18:00:00+03:00', 'תגבור במתמטיקה לקראת המבחן', 'ביום רביעי, 14.10, בשעה 15:15'), TODAY), '2026-10-14');
  assert.equal(s.messageTaskDue(msg('2026-10-05T09:00:00+03:00', 'אישור לטיול', 'להחזיר עד 11.10'), TODAY), '2026-10-11');
  assert.equal(s.messageTaskDue(msg('2026-10-01T09:00:00+03:00', 'אישור לטיול', 'להחזיר עד 6.10'), TODAY), null);
  // Sent today: "מחר" is tomorrow.
  assert.equal(s.messageTaskDue(msg('2026-10-08T07:30:00+03:00', 'מחר מבחן פתע'), TODAY), '2026-10-09');
  assert.equal(s.messageTaskDue(msg('2026-10-08T07:30:00+03:00', 'תזכורת', 'להביא ספר'), TODAY), null);
});

test('run 8 (Noa): a message\'s passed weekday goes to the next one, and the button says "הבא"', () => {
  const msg = (date, title, body = '') => ({ title, body, date, from: null });
  // Sent Monday 5.10 about Wednesday: its card says 7.10, which has passed; the task goes to 14.10.
  const rolled = s.messageTaskDay(msg('2026-10-05T09:00:00+03:00', 'ציוד למעבדת פיזיקה', 'ביום רביעי מביאים חלוק'), TODAY);
  assert.deepEqual(rolled, { date: '2026-10-14', next: true });
  assert.equal(`ל${s.messageTaskDayLead(rolled)}14.10`, 'ליום רביעי הבא, 14.10');
  // Sent Wednesday 7.10, "ביום רביעי" was next week's all along: no "הבא".
  const coming = s.messageTaskDay(msg('2026-10-07T18:00:00+03:00', 'ציוד למעבדת פיזיקה', 'ביום רביעי מביאים חלוק'), TODAY);
  assert.deepEqual(coming, { date: '2026-10-14', next: false });
  assert.equal(`ל${s.messageTaskDayLead(coming)}14.10`, 'ליום ד׳ 14.10');
  // A date, or a day that is still ahead: as it is.
  assert.deepEqual(s.messageTaskDay(msg('2026-10-05T09:00:00+03:00', 'אישור לטיול', 'להחזיר עד 11.10'), TODAY), { date: '2026-10-11', next: false });
  assert.equal(s.messageTaskDay(msg('2026-10-05T09:00:00+03:00', 'מחר מביאים מחשבון'), TODAY), null);
  // The toast says it the same way.
  assert.equal(s.addedToTasksLabel('2026-10-14', true), 'נוסף למשימות, ליום רביעי הבא, ⁦14.10⁩');
});

test('addedToTasksLabel: "נוסף למשימות, ליום רביעי 14.10", the date pinned left-to-right', () => {
  assert.equal(s.addedToTasksLabel('2026-10-14'), 'נוסף למשימות, ליום רביעי ⁦14.10⁩');
  assert.equal(s.addedToTasksLabel('2026-10-17'), 'נוסף למשימות, לשבת ⁦17.10⁩');
  // Plan §16.2: it says what happened, without a tick.
  assert.equal(s.addedToTasksLabel(null), 'נוסף למשימות');
  assert.equal(s.addedToTasksLabel(undefined), 'נוסף למשימות');
});

// --- W6-8: a teacher's message in one bold line ----------------------------------

test('messageSummary: the day, the time and what to bring, from the review\'s messages (Daniel)', () => {
  const msg = (date, title, body) => ({ date, title, body });
  const summary = (m) => {
    const out = s.messageSummary(m, '2026-10-08');
    return out && s.messageSummaryText(out);
  };
  assert.equal(
    summary(msg('2026-10-05T06:55:00.000Z', 'הטיול השנתי ב־16.10',
      'הטיול השנתי של השכבה יתקיים ביום שישי, 16.10. יוצאים ב־07:30 מהשער הראשי וחוזרים בסביבות 16:00. להביא 3 ליטר מים, כובע, נעלי הליכה וארוחת צהריים.')),
    'יום ו׳ 16.10, 07:30, להביא: 3 ליטר מים, כובע, נעלי הליכה וארוחת צהריים',
  );
  assert.equal(
    summary(msg('2026-10-04T15:20:00.000Z', 'תגבור במתמטיקה לקראת המבחן',
      'ביום רביעי, 14.10, יתקיים תגבור לקראת המבחן ב־9.11, בשעה 15:15 בכיתה 214. כדאי להגיע עם דף הנוסחאות ועם שאלות מהתרגילים.')),
    'יום ד׳ 14.10, 15:15, להביא: דף הנוסחאות ועם שאלות מהתרגילים',
  );
  // A weekday, read from the day it was sent (Sunday 4.10 → Wednesday 7.10).
  assert.equal(
    summary(msg('2026-10-04T09:10:00.000Z', 'ציוד למעבדת פיזיקה', 'ביום רביעי אנחנו במעבדה. חובה להגיע עם חלוק, משקפי מגן ומחשבון. בלי חלוק לא נכנסים לניסוי.')),
    'יום ד׳ 7.10, להביא: חלוק, משקפי מגן ומחשבון',
  );
  // A range of hours.
  assert.equal(
    summary(msg('2026-10-01T10:05:00.000Z', 'אסיפת הורים ב־13.10', 'אסיפת ההורים של שכבת י״ב תתקיים ביום שלישי, 13.10, בין 17:00 ל־20:00. את המפגש עם המורים מתאמים דרך המזכירות.')),
    'יום ג׳ 13.10, 17:00–20:00',
  );
  // A deadline is not given the hour of something else in the message.
  assert.equal(
    summary(msg('2026-09-03T13:15:00.000Z', 'הרשמה לחוג רובוטיקה', 'ההרשמה לחוג הרובוטיקה של אחר הצהריים פתוחה עד 15.10. המפגשים בימי שני ב־15:30 במעבדת המחשבים.')),
    'יום ה׳ 15.10',
  );
  assert.equal(
    summary(msg('2026-09-16T07:50:00.000Z', 'הרשמה למועד ב׳', 'מי שלא נבחן במועד א׳ מסיבה מוצדקת נרשם למועד ב׳ (3.12) במזכירות, עד 25.11. צריך להביא אישור.')),
    'יום ד׳ 25.11, להביא: אישור',
  );
});

test('messageSummary: nothing to sum up is null; a long list is cut at a word', () => {
  assert.equal(s.messageSummary({ date: '2026-09-24T08:30:00.000Z', title: 'החזרת ספרים לספרייה', body: 'מי שעדיין מחזיק ספרים מהשנה שעברה מתבקש להחזיר אותם לספרייה עד סוף אוקטובר.' }, '2026-10-08'), null);
  assert.equal(s.messageSummary({ date: '2026-09-15T12:20:00.000Z', title: 'שעת חינוך עם היועצת', body: 'בשעת החינוך הקרובה תצטרף אלינו היועצת לשיחה על ניהול זמן.' }, '2026-10-08'), null);
  const long = s.messageSummary({
    date: '2026-10-05T06:55:00.000Z', title: 'ציוד', body: 'להביא מחברת, ספר, מחשבון, סרגל, מחוגה, מד זווית, עפרונות צבעוניים ודבק.',
  }, '2026-10-08');
  assert.equal(long.date, null);
  assert.ok(long.bring.length <= 50 && long.bring.endsWith('…'), long.bring);
});

// --- W6-4: one homework model ---------------------------------------------------

test('W6-4: homework is copied to Google Tasks from its sheet, in words that say so', () => {
  assert.equal(s.COPY_TO_GOOGLE_TASKS, 'להעתיק ל־Google Tasks');
  assert.equal(s.copiedToTasksLabel('2026-10-14'), 'הועתק ל־Google Tasks, ליום רביעי ⁦14.10⁩');
  assert.equal(s.copiedToTasksLabel(null), 'הועתק ל־Google Tasks');
  assert.equal(s.HOMEWORK_COPIED, 'הועתק ל־Google Tasks');
  assert.match(s.HOMEWORK_IN_TASKS, /כבר מופיעים במשימות/);
});

test('canCopyToGoogle: only homework with no copy yet, outside the demo, with Google to copy to', () => {
  assert.equal(s.canCopyToGoogle({ linkedTaskId: null }, false, true), true);
  assert.equal(s.canCopyToGoogle({}, false, true), true);
  assert.equal(s.canCopyToGoogle({ linkedTaskId: null }, false, false), false);
  assert.equal(s.canCopyToGoogle({ linkedTaskId: null }, true, true), false);
  assert.equal(s.canCopyToGoogle({ linkedTaskId: 't' }, false, true), false);
});

/** A screen's source without its comments, which may quote old words to say they are gone. */
function uiSource(file) {
  const code = require('node:fs').readFileSync(path.join(__dirname, '../src', file), 'utf8');
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

test('W6-4: School says "להוסיף למשימות שלי" — a verb, not the masculine "הוסף" — and homework rows add nothing', () => {
  const school = uiSource('screens/SchoolScreen.tsx');
  assert.doesNotMatch(school, /(?<!ל)הוסף למשימות/);
  assert.match(school, /להוסיף למשימות שלי/);
  // The homework row (a card until plan §16) holds no task action; the sheet holds the copy.
  assert.ok(school.indexOf('function HomeworkRow') > 0 && school.indexOf('function HomeworkRow') < school.indexOf('function HomeworkSheet'));
  const card = school.slice(school.indexOf('function HomeworkRow'), school.indexOf('function HomeworkSheet'));
  assert.doesNotMatch(card, /tasks\.add|onAdd|COPY_TO_GOOGLE_TASKS/);
  assert.match(school.slice(school.indexOf('function HomeworkSheet')), /COPY_TO_GOOGLE_TASKS/);
  for (const file of ['screens/SchoolScreen.tsx', 'screens/MyExamsScreen.tsx', 'screens/MyLessonsScreen.tsx', 'components/ExamSheet.tsx', 'lib/school.ts']) {
    assert.doesNotMatch(uiSource(file), /סשן|שרת|סנכרון/, file);
  }
});

// --- unsure exams, titles and sources (W4-4) ---------------------------------

test('unsureReason: a few words beside the "?" — only for exams the server could not place', () => {
  const unsure = { mine: null, reason: null };
  assert.equal(s.unsureReason(exam('d', '2026-11-01', 'מתכונת באנגלית וויקה', { subjectKey: 'אנגלית', match: unsure })), 'לא ברור אם זו הקבוצה שלך');
  assert.equal(s.unsureReason(exam('g', '2026-11-04', "מבחן גוש ב'", { match: unsure })), 'לא כתוב אילו מקצועות בגוש');
  assert.equal(
    s.unsureReason(exam('g2', '2026-11-04', 'מבחן בגוש א', { subjectKey: 'גוש א׳: כימיה, היסטוריה', match: unsure })),
    'לא ברור אם המקצוע שלך בגוש',
  );
  assert.equal(s.unsureReason(exam('t', '2026-11-05', 'טורניר כספות', { match: unsure })), 'לא כתוב באיזה מקצוע');
  // An older server with no match at all is unsure too — as `examCounts` counts it.
  assert.equal(s.unsureReason({ naturalKey: 'old', date: '2026-10-25', subject: 'מבחן בספרות' }), 'לא ברור אם זו הקבוצה שלך');
  assert.equal(s.unsureReason(exam('m', '2026-10-20', 'מבחן באנגלית', { match: { mine: true, reason: null } })), null);
  assert.equal(s.unsureReason(exam('n', '2026-10-20', 'בגרות בתנ"ך - רק למשפרים', { match: { mine: false, reason: 'רק למשפרים' } })), null);
  assert.equal(s.isUnsure({ match: { mine: null, reason: null } }), true);
  assert.equal(s.isUnsure({}), true);
  assert.equal(s.isUnsure({ match: { mine: false, reason: null } }), false);
});

test('tagExplainer: "מועד ב׳" gets a sentence too (Maya)', () => {
  assert.equal(s.tagExplainer('מועד ב׳ — רק למי שניגש'), s.RESIT_EXPLAINER);
  assert.equal(s.tagExplainer("מועד ב'"), s.RESIT_EXPLAINER);
  assert.equal(s.tagExplainer('מועד ב'), s.RESIT_EXPLAINER);
  assert.equal(s.tagExplainer('מועד בגרות'), null);
});

test('examDisplayTitle: one name for a block exam however the site spelled it (Noa); other titles cleaned only', () => {
  assert.equal(s.examDisplayTitle("מבחן גוש ב'"), 'מבחן גוש ב׳');
  assert.equal(s.examDisplayTitle("גוש ב'"), 'מבחן גוש ב׳');
  assert.equal(s.examDisplayTitle('מבחן בגוש ב'), 'מבחן גוש ב׳');
  assert.equal(s.examDisplayTitle('מבחן גוש א׳'), 'מבחן גוש א׳');
  assert.equal(s.examDisplayTitle('מבחן בגוש ב - פיזיקה, אמנות ומוזיקה'), 'מבחן בגוש ב - פיזיקה, אמנות ומוזיקה');
  assert.equal(s.examDisplayTitle('מבחן   באנגלית'), 'מבחן באנגלית');
  assert.equal(s.examDisplayTitle('2+ גוש- מתכונת במעבדה בפיזיקה'), '2+ גוש- מתכונת במעבדה בפיזיקה');
});

test('blockSubjectsParts: each subject once, the owner\'s own first when the server matched it (Daniel, Noa)', () => {
  const block = (mine, subjectKey) => exam('b', '2026-11-04', "מבחן גוש ב'", { subjectKey, match: { mine, reason: null } });
  assert.deepEqual(s.blockSubjectsParts(block(true, 'גוש ב׳: פיזיקה, ביולוגיה')), { own: 'פיזיקה', others: 'ביולוגיה' });
  assert.deepEqual(s.blockSubjectsParts(block(true, 'גוש ב׳: פיזיקה')), { own: 'פיזיקה', others: null });
  assert.deepEqual(s.blockSubjectsParts(block(true, 'גוש א׳: כימיה, היסטוריה, ספרות, …')), { own: 'כימיה', others: 'היסטוריה, ספרות, …' });
  assert.deepEqual(s.blockSubjectsParts(block(null, 'גוש ב׳: פיזיקה, ביולוגיה')), { own: null, others: 'פיזיקה, ביולוגיה' });
  assert.equal(s.blockSubjectsParts(block(null, '')), null);
  assert.equal(s.blockSubjectsParts(exam('e', '2026-10-20', 'מבחן באנגלית', { subjectKey: 'אנגלית' })), null);
});

test('examSource: a tag for a row, a full name for the details, words for a meta line', () => {
  assert.deepEqual(s.examSource('school_site'), { tag: 'לוח מבחנים', full: 'לוח המבחנים של הכיתה', meta: 'מתוך לוח המבחנים' });
  assert.equal(s.examSource('mashov').full, 'משוב');
  assert.equal(s.examSource('shahaf').tag, 'אתר בית הספר');
});

test('examSource (V-2): an exam of a board names whose board it is, never the school\'s site, which a board cannot be told from', () => {
  // The class's board: a file, a sheet link, a calendar someone brought, a page of the site read into rows.
  assert.equal(s.examSource('school_site').full, 'לוח המבחנים של הכיתה');
  assert.equal(s.examSource('school_site', false).full, 'לוח המבחנים של הכיתה');
  // The person's own board, kept on the phone.
  assert.deepEqual(s.examSource('school_site', true), { tag: 'לוח מבחנים', full: 'לוח המבחנים שלך', meta: 'מתוך לוח המבחנים' });
  for (const own of [true, false]) assert.doesNotMatch(s.examSource('school_site', own).full, /באתר בית הספר/);
  // only a board's exam is ever said to be the person's own
  assert.equal(s.examSource('shahaf', true).full, 'אתר בית הספר');
  assert.equal(s.examSource('mashov', true).full, 'משוב');
});

// --- material for an exam (W4-5) ---------------------------------------------

const message = (key, date, title, body = '', from = null) => ({ naturalKey: key, source: 'mashov', date, title, body, from });

test('examMaterial: the teacher\'s messages about the exam — same subject, an exam word, up to 21 days before', () => {
  const messages = [
    message('material', '2026-10-06T14:00:00+03:00', 'החומר למבחן באנגלית', 'יחידות 3–5 בספר ואוצר המילים של יחידה 4', 'וויקה לוי'),
    message('tutoring', '2026-10-07T12:00:00+03:00', 'תגבור במתמטיקה לקראת המבחן', 'ביום רביעי, 14.10, בשעה 15:15'),
    message('lab', '2026-10-07T12:00:00+03:00', 'ציוד למעבדת פיזיקה', 'ביום רביעי מביאים חלוק. בלי חלוק לא נכנסים'),
    message('trip', '2026-10-05T09:00:00+03:00', 'אישור לטיול', 'להחזיר עד 11.10'),
    message('old', '2026-09-01T09:00:00+03:00', 'לוח המבחנים באנגלית למחצית', 'מבחן ב־20.10'),
    message('after', '2026-10-21T09:00:00+03:00', 'ציוני המבחן באנגלית', 'הציונים במשוב'),
    message('quiz', '2026-10-15T09:00:00+03:00', 'בוחן קצר באנגלית', 'על אוצר המילים'),
  ];
  const english = exam('en', '2026-10-20', 'מבחן באנגלית', { subjectKey: 'אנגלית', match: { mine: true, reason: null } });
  assert.deepEqual(s.examMaterial(english, messages).map((m) => m.naturalKey), ['quiz', 'material'], 'newest first');
  const math = exam('ma', '2026-10-27', 'מבחן במתמטיקה', { subjectKey: 'מתמטיקה', match: { mine: true, reason: null } });
  assert.deepEqual(s.examMaterial(math, messages).map((m) => m.naturalKey), ['tutoring']);
  // 9.11 is more than 21 days after the tutoring message.
  assert.deepEqual(s.examMaterial({ ...math, date: '2026-11-09' }, messages), []);
  // The lab message names no exam.
  const physics = exam('ph', '2026-10-21', 'מתכונת במעבדה בפיזיקה', { subjectKey: 'פיזיקה' });
  assert.deepEqual(s.examMaterial(physics, messages), []);
  // Another spelling of the subject still matches.
  const fisika = message('fis', '2026-10-10T09:00:00+03:00', 'מתכונת בפיסיקה', 'פרקים 1–4');
  assert.deepEqual(s.examMaterial(physics, [fisika]).map((m) => m.naturalKey), ['fis']);
  // Nothing to match on: no subject.
  assert.deepEqual(s.examMaterial(exam('x', '2026-10-20', 'מועד ב'), messages), []);
});

test('examMaterial: a block exam the owner sits matches their own subject only', () => {
  const block = exam('b', '2026-10-25', "מבחן גוש ב'", { subjectKey: 'גוש ב׳: פיזיקה, ביולוגיה', match: { mine: true, reason: null } });
  const messages = [
    message('ph', '2026-10-15T09:00:00+03:00', 'החומר לבוחן בפיזיקה', 'קינמטיקה'),
    message('bio', '2026-10-15T09:00:00+03:00', 'החומר למבחן בביולוגיה', 'תא'),
  ];
  assert.deepEqual(s.examMaterial(block, messages).map((m) => m.naturalKey), ['ph']);
  assert.deepEqual(s.examSubjects(block), ['פיזיקה']);
  const notSure = { ...block, match: { mine: null, reason: null } };
  assert.deepEqual(s.examSubjects(notSure), ['פיזיקה', 'ביולוגיה']);
  assert.deepEqual(s.examMaterial(notSure, messages).map((m) => m.naturalKey).sort(), ['bio', 'ph']);
  assert.deepEqual(s.examSubjects(exam('g', '2026-10-25', "מבחן גוש א'")), []);
  assert.equal(s.mentionsSubject('מבחן במדמ"ח', 'מדעי המחשב'), true);
  assert.equal(s.mentionsSubject('מבחן באקדמיזציה', 'אקדמיזציה'), true);
  assert.equal(s.mentionsSubject('מבחן בכימיה', 'פיזיקה'), false);
});

// --- a study plan (W4-5) -----------------------------------------------------

test('isSchoolWeekday, instantDate and fitTitle\'s room: the helpers the plan and the message dates stand on', () => {
  assert.equal(s.isSchoolWeekday('2026-10-08'), true, 'Thursday');
  assert.equal(s.isSchoolWeekday('2026-10-09'), false, 'Friday');
  assert.equal(s.isSchoolWeekday('2026-10-10'), false, 'Saturday');
  assert.equal(s.isSchoolWeekday('2026-10-11'), true, 'Sunday');
  assert.equal(s.instantDate('2026-10-05T23:30:00+03:00'), '2026-10-05');
  assert.equal(s.instantDate('not a date'), null);
  assert.equal(s.instantDate(null), null);
  const cut = s.fitTitle('ללמוד למבחן בשירותי רשת ובמערכות רפואיות ובעוד הרבה דברים שאין להם סוף', 0, 30);
  assert.ok(cut.length <= 30, cut);
  assert.ok(cut.endsWith('…'));
  assert.equal(s.fitTitle('קצר', 0, 30), 'קצר');
});

test('studyDays: school days from today, or two weeks before, to the single task\'s day', () => {
  // English, Tuesday 20.10: Thursday 8.10, then Sunday to Thursday, then Sunday 18.10.
  assert.deepEqual(s.studyDays('2026-10-20', TODAY), ['2026-10-08', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-18']);
  // Math, Monday 9.11: two weeks back, and two days before is a Saturday — Thursday instead.
  assert.deepEqual(s.studyDays('2026-11-09', TODAY), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
  ]);
  assert.deepEqual(s.studyDays('2026-10-09', TODAY), [TODAY], 'tomorrow: today only');
  assert.deepEqual(s.studyDays('2026-10-07', TODAY), [], 'passed');
  assert.equal(s.studySessionsMax('2026-10-20', TODAY), 4);
  assert.equal(s.studySessionsMax('2026-10-09', TODAY), 1);
  assert.equal(s.studySessionsMax(TODAY, TODAY), 1);
  assert.equal(s.studySessionsMax('2026-10-07', TODAY), 0);
});

test('studyPlan: one session is the single study task (R-20); more spread over school days, the last two days before', () => {
  const english = { date: '2026-10-20', subject: 'מבחן באנגלית', subjectKey: 'אנגלית' };
  assert.deepEqual(s.studyPlan(english, TODAY, 1), [s.studyTask(english, TODAY)]);
  const three = s.studyPlan(english, TODAY, 3);
  assert.deepEqual(three.map((t) => t.title), ['ללמוד למבחן באנגלית, 20.10 (1/3)', 'ללמוד למבחן באנגלית, 20.10 (2/3)', 'ללמוד למבחן באנגלית, 20.10 (3/3)']);
  assert.deepEqual(three.map((t) => t.due), ['2026-10-11', '2026-10-14', '2026-10-18']);
  assert.equal(three[0].notes, 'מבחן באנגלית\nיום שלישי 20.10\nמפגש 1 מתוך 3');
  assert.deepEqual(s.studyPlan(english, TODAY, 2).map((t) => t.due), ['2026-10-13', '2026-10-18']);
  assert.deepEqual(s.studyPlan(english, TODAY, 4).map((t) => t.due), ['2026-10-11', '2026-10-13', '2026-10-14', '2026-10-18']);
  // More than offered is capped; every day is a school day before the exam, none twice.
  for (const exam of [english, { date: '2026-11-09', subject: 'בגרות במתמטיקה', subjectKey: 'מתמטיקה' }]) {
    for (let n = 1; n <= 6; n += 1) {
      const plan = s.studyPlan(exam, TODAY, n);
      assert.equal(plan.length, Math.min(n, 4));
      assert.equal(new Set(plan.map((t) => t.due)).size, plan.length);
      for (const t of plan) assert.ok(t.due >= TODAY && t.due < exam.date, t.due);
      if (n > 1) for (const t of plan) assert.ok(s.isSchoolWeekday(t.due), t.due);
    }
  }
  assert.deepEqual(s.studyPlan({ date: '2026-11-09', subject: 'בגרות במתמטיקה', subjectKey: 'מתמטיקה' }, TODAY, 3).map((t) => t.due), ['2026-10-28', '2026-11-02', '2026-11-05']);
  // Tomorrow's exam has room for one; a passed one for none.
  assert.equal(s.studyPlan({ date: '2026-10-09', subject: 'מבחן בכימיה' }, TODAY, 3).length, 1);
  assert.deepEqual(s.studyPlan({ date: '2026-10-07', subject: 'מבחן בכימיה' }, TODAY, 3), []);
  // A long title is cut so "(2/3)" survives.
  const long = s.studyPlan({ date: '2026-10-20', subject: 'טורניר כספות ארצי של כל שכבות התיכון כולל שלב הגמר וההכרזה על הזוכים בטקס' }, TODAY, 3);
  for (const t of long) {
    assert.ok(t.title.length <= s.TASK_TITLE_MAX, t.title);
    assert.match(t.title, / \(\d\/3\)$/);
  }
});

test('isStudyTaskTitle: the single task and every session of its plan', () => {
  const english = { date: '2026-10-20', subject: 'מבחן באנגלית', subjectKey: 'אנגלית' };
  const single = s.studyTask(english, TODAY).title;
  assert.equal(single, 'ללמוד למבחן באנגלית, 20.10');
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית, 20.10', single), true);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית, 20.10 (2/3)', single), true);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן במתמטיקה, 20.10 (2/3)', single), false);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית, 20.10 מחר', single), false);
  // A task made before the Wave 9 re-rate, with " · " before the date, is still this plan's.
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית · 20.10', single), true);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית · 20.10 (2/3)', single), true);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן במתמטיקה · 20.10 (2/3)', single), false);
  // Another English exam's plan is not this one's (Daniel, run 5: planning the
  // 1.11 mock exam showed "כבר במשימות שלך" on 20.10).
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית, 1.11 (1/3)', single), false);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית · 1.11 (1/3)', single), false);
  assert.equal(s.isStudyTaskTitle('ללמוד למבחן באנגלית', single), false);
  const longExam = { date: '2026-10-20', subject: 'טורניר כספות ארצי של כל שכבות התיכון כולל שלב הגמר וההכרזה על הזוכים בטקס' };
  const longSingle = s.studyTask(longExam, TODAY).title;
  for (const t of s.studyPlan(longExam, TODAY, 3)) assert.equal(s.isStudyTaskTitle(t.title, longSingle), true, t.title);
});

// --- my lessons (W5-7) --------------------------------------------------------

function line(key, name, teacher, extra = {}) {
  return { key, name, teacher, inMashov: false, count: 2, ...extra };
}

/** The real grid publishes one subject under two names, with the same teacher. */
const GRID = [
  line('אזרחות', 'אזרחות', 'רונית לוי', { inMashov: true, count: 3 }),
  line('אזרחות (יב2)', 'אזרחות (יב2)', 'רונית לוי', { count: 1 }),
  line('היסטוריה', 'היסטוריה', 'דן כהן', { inMashov: true }),
  line('היסטוריה (יב2)', 'היסטוריה (יב2)', 'דן כהן', { inMashov: true }),
  line('חינוך גופני @ דנה אלון', 'חינוך גופני', 'דנה אלון', { inMashov: true }),
  line('חינוך גופני @ יוסי בר', 'חינוך גופני', 'יוסי בר'),
  line('אנגלית 5 יח"ל (יב2)', 'אנגלית 5 יח"ל (יב2)', 'מיכל ברק', { inMashov: true }),
  line('פיזיקה מורחב (יב3)', 'פיזיקה מורחב (יב3)', 'טלי רוזן'),
  line('פיזיקה מורחב (מעבדת פיסיקה)', 'פיזיקה מורחב (מעבדת פיסיקה)', 'טלי רוזן'),
];

test('groupLessonOptions: one subject and teacher under two names is one row, holding both keys (W5-7)', () => {
  const groups = s.groupLessonOptions(GRID);
  assert.deepEqual(groups.map((g) => [g.name, g.teacher]), [
    ['אזרחות', 'רונית לוי'],
    ['אנגלית 5 יח"ל (יב2)', 'מיכל ברק'],
    ['היסטוריה', 'דן כהן'],
    ['חינוך גופני', 'דנה אלון'],
    ['חינוך גופני', 'יוסי בר'],
    ['פיזיקה מורחב', 'טלי רוזן'],
  ]);
  const civics = groups[0];
  assert.deepEqual(civics.keys, ['אזרחות', 'אזרחות (יב2)']);
  assert.deepEqual(civics.names, ['אזרחות', 'אזרחות (יב2)']);
  assert.equal(civics.count, 4);
  assert.equal(civics.inMashov, true, 'Mashov lists one of its names: the student has it');
  assert.equal(civics.parallel, 0);
  // A row of one line keeps the site's name as it is.
  assert.deepEqual(groups[1].keys, ['אנגלית 5 יח"ל (יב2)']);
  // Two teachers are two groups of the class: two rows, each knowing of the other.
  assert.deepEqual(groups.slice(3, 5).map((g) => g.parallel), [1, 1]);
  assert.equal(groups[5].parallel, 0);
  // Every key is in exactly one row.
  assert.deepEqual(groups.flatMap((g) => g.keys).sort(), GRID.map((l) => l.key).sort());
});

test('groupLessonOptions: names that differ beyond a bracket fall back to the bare subject; no teacher groups too', () => {
  const groups = s.groupLessonOptions([
    line('מתמטיקה 5 יח"ל', 'מתמטיקה 5 יח"ל', 'אבי'),
    line('מתמטיקה', 'מתמטיקה', 'אבי'),
    line('ספרות', 'ספרות', null),
    line('ספרות (יב2)', 'ספרות (יב2)', null),
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['מתמטיקה', 'ספרות']);
  assert.deepEqual(groups[1].keys, ['ספרות', 'ספרות (יב2)']);
  assert.equal(groups[1].teacher, null);
  assert.deepEqual(s.groupLessonOptions([]), []);
});

test('lessonGroupState and setKeysShown: a row\'s switch moves every key in it; keys that disagree are "mixed"', () => {
  const [civics] = s.groupLessonOptions(GRID);
  assert.equal(s.lessonGroupState(civics, new Set()), true);
  // Hiding one of the two names hid half the lessons; the row says so.
  assert.equal(s.lessonGroupState(civics, new Set(['אזרחות (יב2)'])), 'mixed');
  assert.equal(s.lessonGroupState(civics, new Set(civics.keys)), false);
  // Off hides both names, and a key of a line the site no longer publishes survives.
  assert.deepEqual(s.setKeysShown(['ישן'], civics.keys, false), ['ישן', 'אזרחות', 'אזרחות (יב2)']);
  assert.deepEqual(s.setKeysShown(['אזרחות', 'ישן'], civics.keys, false), ['אזרחות', 'ישן', 'אזרחות (יב2)']);
  // A tap on a mixed row shows it all, as the ui Switch reads it (`value !== true`).
  assert.deepEqual(s.setKeysShown(['ישן', 'אזרחות (יב2)'], civics.keys, true), ['ישן']);
  assert.equal(s.setExamsShown, s.setKeysShown);
});

test('mashovOnlyHidden and isMashovOnly: "להשאיר רק מה שבמשוב" acts on whole rows', () => {
  const groups = s.groupLessonOptions(GRID);
  const hidden = s.mashovOnlyHidden(groups);
  // Civics stays whole: one of its names is in Mashov.
  assert.deepEqual(hidden.sort(), ['חינוך גופני @ יוסי בר', 'פיזיקה מורחב (יב3)', 'פיזיקה מורחב (מעבדת פיסיקה)'].sort());
  assert.equal(s.isMashovOnly(groups, new Set(hidden)), true);
  for (const g of groups) assert.notEqual(s.lessonGroupState(g, new Set(hidden)), 'mixed', g.name);
  assert.equal(s.isMashovOnly(groups, new Set()), false);
  assert.equal(s.isMashovOnly(groups, new Set([...hidden, 'אזרחות'])), false);
});

test('lessonsFromMashov: a new phone shows only what Mashov lists, once Mashov is read and nothing is hidden yet', () => {
  const groups = s.groupLessonOptions(GRID);
  // What "להשאיר רק מה שבמשוב" would do, without anyone pressing it.
  assert.deepEqual(s.lessonsFromMashov({ mashovKnown: true, subjects: GRID, hidden: [] }).sort(), s.mashovOnlyHidden(groups).sort());
  // Nothing to go on yet: Mashov not read (an iPhone whose login was never captured), or no class lines.
  assert.equal(s.lessonsFromMashov({ mashovKnown: false, subjects: GRID, hidden: [] }), null);
  assert.equal(s.lessonsFromMashov({ mashovKnown: true, subjects: [], hidden: [] }), null);
  // A list the person changed is theirs.
  assert.equal(s.lessonsFromMashov({ mashovKnown: true, subjects: GRID, hidden: ['אזרחות'] }), null);
  // Fewer than half the rows in Mashov reads as names that did not match: hold back.
  const few = GRID.map((l) => ({ ...l, inMashov: l.key === 'אזרחות' }));
  assert.equal(s.lessonsFromMashov({ mashovKnown: true, subjects: few, hidden: [] }), null);
  // Every row in Mashov: nothing to hide.
  const all = GRID.map((l) => ({ ...l, inMashov: true }));
  assert.deepEqual(s.lessonsFromMashov({ mashovKnown: true, subjects: all, hidden: [] }), []);
  assert.equal(typeof s.LESSONS_COPY.student.fromMashov, 'string');
});

test('termExplainer: "יח״ל" and "מגמה" get a sentence; exam tags as tagExplainer; plain names none', () => {
  assert.equal(s.termExplainer('אנגלית 5 יח״ל (יב2)'), s.UNITS_EXPLAINER);
  assert.equal(s.termExplainer('אנגלית 5 יח"ל'), s.UNITS_EXPLAINER);
  assert.equal(s.termExplainer('מתמטיקה 4 יחידות'), s.UNITS_EXPLAINER);
  assert.equal(s.termExplainer('וכיתה עם מגמה (כמו ״8 ערבית״) היא מערכת נפרדת'), s.MAJOR_EXPLAINER);
  assert.equal(s.termExplainer('מגמת ביולוגיה'), s.MAJOR_EXPLAINER);
  assert.equal(s.termExplainer('רק למשפרים'), s.IMPROVERS_EXPLAINER);
  assert.equal(s.termExplainer('גוש ב׳'), s.BLOCK_EXPLAINER);
  assert.equal(s.termExplainer('אזרחות'), null);
  assert.equal(s.termExplainer('יחסים'), null);
  assert.equal(s.termExplainer('תכנון מגמתי'), null);
});

// --- my exams: one status per row (W5-9) ----------------------------------------

test('examStatus: one of recommended / unsure / not mine, by match.mine; the source is words for the meta line', () => {
  assert.equal(s.examStatus(exam('a', '2026-10-20', 'מבחן באנגלית', { match: { mine: true, reason: null } })), 'recommended');
  assert.equal(s.examStatus(exam('b', '2026-10-20', 'מתכונת באנגלית וויקה')), 'unsure');
  assert.equal(s.examStatus({ naturalKey: 'old', date: '2026-10-20', subject: 'מבחן בספרות' }), 'unsure');
  assert.equal(s.examStatus(exam('c', '2026-10-20', 'בגרות בתנ"ך - רק למשפרים', { match: { mine: false, reason: 'רק למשפרים' } })), 'not_mine');
  // Not mine with no reason, or only a block's subjects: nothing to say on the row.
  assert.equal(s.examStatus(exam('d', '2026-10-20', 'מבחן בכימיה', { match: { mine: false, reason: null } })), null);
  assert.equal(s.examStatus(exam('e', '2026-11-04', 'מבחן בגוש ב', { match: { mine: false, reason: 'גוש ב׳: פיזיקה, אמנות' } })), null);
  assert.equal(s.examSource('school_site').meta, 'מתוך לוח המבחנים');
  assert.equal(s.examSource('google_calendar').meta, 'מיומן Google');
});

test('UNSURE_ADVICE says what to do in neutral words', () => {
  assert.match(s.UNSURE_ADVICE, /אפשר להסתיר/);
  assert.match(s.UNSURE_ADVICE, /אפשר לאשר/);
});

// --- W6-3: the exam's periods and time, from its day ----------------------------

function lessonItem(hourIndex, subject, status = 'regular', extra = {}) {
  const startTime = ['07:15', '08:00', '08:50', '09:45', '10:35', '11:35', '12:25', '13:20'][hourIndex] ?? null;
  return {
    kind: 'lesson', sortKey: String(hourIndex),
    lesson: { date: '2026-10-20', hourIndex, startTime, endTime: null, subject, teacher: null, room: null, status, substitute: null, note: null, source: 'shahaf', changeSeenAt: null, ...extra },
  };
}

function examDay(timeline, extra = {}) {
  return { date: '2026-10-20', projected: false, timeline, ...extra };
}

test('examSlot: the periods the school marked as this subject\'s exam, from the first one\'s start (Noa)', () => {
  const english = exam('e', '2026-10-20', 'מבחן באנגלית', { subjectKey: 'אנגלית', match: { mine: true, reason: null } });
  const day = examDay([
    lessonItem(1, 'אנגלית 5 יח״ל (יב2)', 'exam'),
    lessonItem(2, 'אנגלית 5 יח״ל (יב2)', 'exam'),
    lessonItem(3, 'מתמטיקה'),
    lessonItem(4, 'מבחן בהיסטוריה', 'exam'),
    { kind: 'event', sortKey: '5', event: { id: 'x', summary: 'מבחן באנגלית' } },
  ]);
  const slot = s.examSlot(english, day);
  assert.deepEqual(slot, { lead: 'שיעורים', periods: '1–2', time: '08:00' });
  assert.equal(s.examSlotText(slot), 'שיעורים 1–2, 08:00');
  // One period; the subject named only in the title the site printed into the grid.
  const history = exam('h', '2026-10-20', 'מבחן בהיסטוריה');
  assert.equal(s.examSlotText(s.examSlot(history, day)), 'שיעור 4, 10:35');
  // …or only in the change's note.
  const math = exam('m', '2026-10-20', 'מבחן במתמטיקה', { subjectKey: 'מתמטיקה' });
  const noted = examDay([lessonItem(3, 'מבחן', 'exam', { note: 'מבחן במתמטיקה' })]);
  assert.equal(s.examSlotText(s.examSlot(math, noted)), 'שיעור 3, 09:45');
  // A regular lesson in the subject is not the exam.
  assert.equal(s.examSlot(math, day), null);
});

test('examSlot: a block exam by its subjects; no time when the site gave none; periods apart are listed', () => {
  const block = exam('b', '2026-10-20', 'י"ב- מבחן בגוש ב', { subjectKey: 'גוש ב׳: פיזיקה, ביולוגיה', match: { mine: true, reason: null } });
  const day = examDay([lessonItem(5, 'פיזיקה מורחב (מעבדת פיסיקה)', 'exam'), lessonItem(6, 'פיזיקה מורחב', 'exam')]);
  assert.equal(s.examSlotText(s.examSlot(block, day)), 'שיעורים 5–6, 11:35');
  const noTime = examDay([lessonItem(9, 'אנגלית', 'exam')]);
  const english = exam('e', '2026-10-20', 'מבחן באנגלית', { subjectKey: 'אנגלית' });
  assert.deepEqual(s.examSlot(english, noTime), { lead: 'שיעור', periods: '9', time: null });
  assert.equal(s.examSlotText(s.examSlot(english, noTime)), 'שיעור 9');
  const apart = examDay([lessonItem(4, 'אנגלית', 'exam'), lessonItem(1, 'אנגלית', 'exam')]);
  assert.deepEqual(s.examSlot(english, apart), { lead: 'שיעורים', periods: '1, 4', time: '08:00' });
});

test('examSlot: nothing to go on is null — no day, another day, a projected day, no subject, no exam lesson', () => {
  const english = exam('e', '2026-10-20', 'מבחן באנגלית', { subjectKey: 'אנגלית' });
  const marked = [lessonItem(1, 'אנגלית', 'exam')];
  assert.notEqual(s.examSlot(english, examDay(marked)), null);
  assert.equal(s.examSlot(english, undefined), null);
  assert.equal(s.examSlot(english, null), null);
  assert.equal(s.examSlot(english, examDay(marked, { date: '2026-10-21' })), null);
  // Projected from the fixed timetable: the school has not published the day.
  assert.equal(s.examSlot(english, examDay(marked, { projected: true })), null);
  // "מועד ב׳", or a block that lists no subjects: no subject to match a lesson by.
  assert.equal(s.examSlot(exam('r', '2026-10-20', 'י"ב-מועד ב'), examDay(marked)), null);
  assert.equal(s.examSlot(exam('g', '2026-10-20', "מבחן גוש א'"), examDay(marked)), null);
  assert.equal(s.examSlot(english, examDay([])), null);
  assert.equal(s.EXAM_TIME_PENDING, 'השעה עוד לא פורסמה');
});

// --- W6-2: "שלי" clears the "?" -------------------------------------------------

/** The review's case, small: one matched exam, three the server could not place, one not the owner's. */
function confirmableExams() {
  const m = (mine, reason = null) => ({ match: { mine, reason } });
  return [
    exam('mine', '2026-10-20', 'מבחן באנגלית', { subjectKey: 'אנגלית', ...m(true) }),
    exam('u1', '2026-11-01', 'מתכונת באנגלית וויקה', { subjectKey: 'אנגלית', ...m(null) }),
    exam('u2', '2026-11-02', 'י"ב- מבחן בגוש א', { subjectKey: 'גוש א׳: כימיה, היסטוריה', ...m(null) }),
    exam('u3', '2026-11-03', 'טורניר כספות', m(null)),
    exam('not', '2026-10-24', 'מבחן בכימיה', { subjectKey: 'כימיה', ...m(false, 'לא במערכת שלך') }),
  ];
}

test('W6-2 examCounts: a confirmed unsure exam counts as the owner\'s — the "?" count drops, the total does not', () => {
  const exams = confirmableExams();
  const hidden = new Set(['not']);
  const none = new Set();
  const before = s.examCounts(exams, hidden, none);
  assert.deepEqual([before.chosen, before.unsure], [4, 3]);
  assert.equal(s.examsCountLabel(before.chosen, before.unsure), '4 מבחנים מסומנים כשלך (מתוכם 3 לבדוק)');

  // "שלי" on u1. Keys for an exam the server did place (mine, not), or one no longer listed, change nothing.
  const confirmed = new Set(['u1', 'mine', 'not', 'past']);
  const after = s.examCounts(exams, hidden, confirmed);
  assert.deepEqual([after.chosen, after.unsure], [4, 2]);
  assert.deepEqual(after.recommendedOff, []);
  assert.equal(s.examsCountLabel(after.chosen, after.unsure), '4 מבחנים מסומנים כשלך (מתוכם 2 לבדוק)');
  // Hidden, a confirmed exam is one "לסמן את המומלצים" brings back, as a recommended one is.
  // An unanswered one stays off; so does a "not" one, confirmed key or not.
  const hideAll = new Set(exams.map((e) => e.naturalKey));
  assert.deepEqual(s.examCounts(exams, hideAll, confirmed).recommendedOff, ['mine', 'u1']);
  // Confirmed and every exam: the count says none is unsure.
  const all = s.examCounts(exams, hidden, new Set(['u1', 'u2', 'u3']));
  assert.equal(s.examsCountLabel(all.chosen, all.unsure), '4 מבחנים מסומנים כשלך');
  // A hidden exam is not counted, confirmed or not.
  assert.deepEqual(s.examCounts(exams, new Set(['not', 'u1']), confirmed).unsure, 2);
});

test('W6-2 withConfirmed: the same count from resolved exams; the row loses its "?", the server\'s match stays', () => {
  const exams = confirmableExams();
  const hidden = new Set(['not']);
  const confirmed = new Set(['u1', 'u2', 'not']);
  const resolved = s.withConfirmed(exams, confirmed);
  // School passes the resolved list and the set; a caller with either alone gets the same number.
  const counts = [
    s.examCounts(resolved, hidden, confirmed),
    s.examCounts(resolved, hidden, new Set()),
    s.examCounts(exams, hidden, confirmed),
  ];
  for (const c of counts) assert.deepEqual([c.chosen, c.unsure], [4, 1]);

  const [mine, u1, u2, u3, not] = resolved;
  // Untouched objects for everything the answers do not change.
  assert.equal(mine, exams[0]);
  assert.equal(u3, exams[3]);
  assert.equal(not, exams[4]);
  assert.equal(not.confirmed, undefined);
  // u1: no "?", no reason, no status chip — and still `mine: null` underneath.
  assert.equal(u1.confirmed, true);
  assert.equal(s.isUnsure(u1), false);
  assert.equal(s.unsureReason(u1), null);
  assert.equal(s.examStatus(u1), null);
  assert.equal(u1.match.mine, null);
  // A confirmed block exam is not read as matched to its first listed subject.
  assert.equal(s.isUnsure(u2), false);
  assert.deepEqual(s.blockSubjectsParts(u2), { own: null, others: 'כימיה, היסטוריה' });
  assert.equal(s.studyTask(u2, TODAY).title, 'ללמוד למבחן בגוש א׳, 2.11');
  assert.deepEqual(s.examSubjects(u2), ['כימיה', 'היסטוריה']);
  // The subject's status in "המבחנים שלי": recommended by its matched exam, the confirmed one no longer "?".
  const [english] = s.groupExamsBySubject(resolved.filter((e) => e.subjectKey === 'אנגלית'));
  assert.equal(english.recommended, true);
  assert.deepEqual(english.exams.filter(s.isUnsure), []);
});

test('W6-2: unconfirming brings the "?" back, from a raw or an already resolved list', () => {
  const exams = confirmableExams();
  const hidden = new Set(['not']);
  const confirmed = new Set(['u1']);
  const resolved = s.withConfirmed(exams, confirmed);
  assert.equal(s.examCounts(resolved, hidden, confirmed).unsure, 2);
  const none = new Set();
  const back = s.withConfirmed(resolved, none);
  assert.equal(back[1].confirmed, false);
  assert.equal(s.isUnsure(back[1]), true);
  assert.equal(s.unsureReason(back[1]), 'לא ברור אם זו הקבוצה שלך');
  assert.equal(s.examStatus(back[1]), 'unsure');
  assert.equal(s.examCounts(back, hidden, none).unsure, 3);
  assert.equal(s.examCounts(exams, hidden, none).unsure, 3);
  // Resolving with the same answers twice changes nothing.
  assert.equal(s.resolveConfirmed(resolved[1], confirmed), resolved[1]);
});

// --- sub-tabs (W5-8) ------------------------------------------------------------

test('tabScrollOffset: the selected tab to the middle, clamped to the row; a browser in RTL counts from the right', () => {
  // A 520-wide row in a 360-wide view; in RTL the first tab is on the right.
  const first = { x: 410, width: 90 };
  const middle = { x: 200, width: 100 };
  const last = { x: 20, width: 100 };
  assert.equal(s.tabScrollOffset(first, 360, 520), 160, 'the right end');
  assert.equal(s.tabScrollOffset(middle, 360, 520), 70);
  assert.equal(s.tabScrollOffset(last, 360, 520), 0, 'the left end');
  assert.equal(s.tabScrollOffset(first, 360, 520, true), 0);
  assert.equal(s.tabScrollOffset(middle, 360, 520, true), -90);
  assert.equal(s.tabScrollOffset(last, 360, 520, true), -160);
  // Everything fits: nowhere to go.
  assert.equal(s.tabScrollOffset(last, 400, 380), 0);
  assert.equal(s.tabScrollOffset(last, 400, 380, true), 0);
});

// --- study plan on chosen days (W5-10) ------------------------------------------

test('studyPlanOn and moveStudySession: a session moves to another day, numbers follow the dates', () => {
  const english = { date: '2026-10-20', subject: 'מבחן באנגלית', subjectKey: 'אנגלית' };
  const plan = s.studyPlan(english, TODAY, 3);
  const days = plan.map((t) => t.due);
  assert.deepEqual(s.studyPlanOn(english, TODAY, days), plan, 'the default days are the default plan');
  // Noa is out all day on Sunday 11.10: the first session moves to Thursday 15.10, and becomes the second.
  const moved = s.moveStudySession(days, 0, '2026-10-15');
  assert.deepEqual(moved, ['2026-10-14', '2026-10-15', '2026-10-18']);
  const again = s.studyPlanOn(english, TODAY, moved);
  assert.deepEqual(again.map((t) => [t.title, t.due]), [
    ['ללמוד למבחן באנגלית, 20.10 (1/3)', '2026-10-14'],
    ['ללמוד למבחן באנגלית, 20.10 (2/3)', '2026-10-15'],
    ['ללמוד למבחן באנגלית, 20.10 (3/3)', '2026-10-18'],
  ]);
  assert.equal(again[1].notes, 'מבחן באנגלית\nיום שלישי 20.10\nמפגש 2 מתוך 3');
  // Another session's day, or no such session: nothing moves.
  assert.deepEqual(s.moveStudySession(days, 0, '2026-10-14'), days);
  assert.deepEqual(s.moveStudySession(days, 5, '2026-10-12'), days);
  // One session is the single study task, on the day picked.
  assert.deepEqual(s.studyPlanOn(english, TODAY, ['2026-10-13']), [{ ...s.studyTask(english, TODAY), due: '2026-10-13' }]);
  assert.deepEqual(s.studyPlanOn({ date: '2026-10-07', subject: 'מבחן בכימיה' }, TODAY, ['2026-10-06']), []);
});

// --- bagrut exams in the exam list (plan §14.9) ------------------------------------

/** A bagrut exam as Mashov's own list gives it: its name, and its hours. */
function bagrutExam(extra = {}) {
  return exam('bagrut|16471|202701', '2027-01-21', 'אנגלית ז׳ - G', {
    source: 'mashov', kind: 'bagrut', startTime: '14:00', endTime: '15:45', ...extra,
  });
}

test('§14.9 a bagrut exam is always the owner\'s: no "?", no "not mine", whatever the server\'s matcher read', () => {
  // The title's trailing "G" may read as a teacher (null) or the subject as missing (false).
  for (const match of [{ mine: null, reason: null }, { mine: false, reason: 'לא במערכת שלך' }, { mine: true, reason: null }, undefined]) {
    const e = bagrutExam({ match });
    const label = JSON.stringify(match);
    assert.equal(s.examMine(e), true, label);
    assert.equal(s.isUnsure(e), false, label);
    assert.equal(s.unsureReason(e), null, label);
    assert.equal(s.examReason(e), null, label);
    assert.equal(s.examStatus(e), 'recommended', label);
    assert.equal(s.unsureNote(e, [], []), null, label);
  }
  // Counted as marked and never as unsure; switched off, "לסמן את המומלצים" brings it back.
  const unsureMatch = bagrutExam();
  const shown = s.examCounts([unsureMatch], new Set(), new Set());
  assert.deepEqual([shown.chosen, shown.unsure, shown.recommendedOff], [1, 0, []]);
  assert.deepEqual(s.examCounts([unsureMatch], new Set([unsureMatch.naturalKey]), new Set()).recommendedOff, [unsureMatch.naturalKey]);
  // Its subject group is recommended; a "שלי" key for it changes nothing.
  const [group] = s.groupExamsBySubject([bagrutExam({ match: { mine: false, reason: 'לא במערכת שלך' } })]);
  assert.equal(group.key, 'אנגלית');
  assert.equal(group.recommended, true);
  assert.equal(s.resolveConfirmed(unsureMatch, new Set([unsureMatch.naturalKey])), unsureMatch);
  // Every other exam reads the server's match as before.
  assert.equal(s.examMine(exam('x', '2026-10-20', 'מבחן באנגלית')), null);
  assert.equal(s.examMine(exam('y', '2026-10-20', 'מבחן באנגלית', { match: { mine: false, reason: null } })), false);
});

test('§14.9 a bagrut exam reads "בחינת בגרות, 14:00–15:45"; the study plan still works for it', () => {
  const kind = s.examKind(bagrutExam());
  assert.deepEqual(kind, { label: 'בחינת בגרות', time: '14:00–15:45' });
  assert.equal(s.examKindText(kind), 'בחינת בגרות, 14:00–15:45');
  // No end, or an end equal to the start: the start alone. No start: no hours.
  assert.deepEqual(s.examKind(bagrutExam({ endTime: null })), { label: 'בחינת בגרות', time: '14:00' });
  assert.equal(s.examKindText(s.examKind(bagrutExam({ startTime: null }))), 'בחינת בגרות');
  assert.equal(s.examHours({ startTime: '9:00', endTime: '9:00' }), '09:00');
  assert.equal(s.examHours({ startTime: '12:30:00', endTime: '15:20:00' }), '12:30–15:20');
  assert.equal(s.examHours({ startTime: 'בבוקר', endTime: '15:20' }), null);
  assert.equal(s.examHours({}), null);
  // An exam from the grade's schedule is no kind worth a line.
  assert.equal(s.examKind(exam('x', '2026-10-20', 'מבחן באנגלית', { startTime: '08:00' })), null);
  // The study task names the bagrut, and finds its plan's sessions as any exam's.
  const task = s.studyTask(bagrutExam(), '2027-01-01');
  assert.equal(task.title, 'ללמוד לבגרות באנגלית, 21.1');
  assert.equal(task.due, '2027-01-19');
  assert.equal(s.studyTask(bagrutExam({ subject: 'מתמטיקה - תכנית חדשה (הערכה חיצונית)' }), '2027-01-01').title, 'ללמוד לבגרות במתמטיקה, 21.1');
  const plan = s.studyPlan(bagrutExam(), '2027-01-01', 3);
  assert.equal(plan.length, 3);
  assert.ok(plan.every((t) => s.isStudyTaskTitle(t.title, task.title)));
});

// --- the deciding fact beside a "?" (plan §14.7) ---------------------------------

/** Noa's timetable as /settings lists it: one English teacher, kept and in Mashov. */
const NOA_LESSONS = [
  { key: 'אנגלית 5 יח"ל (יב2)', name: 'אנגלית 5 יח"ל (יב2)', teacher: 'יוסי שגיא', inMashov: true, count: 8 },
  { key: 'מתמטיקה 5 יח"ל (יב2)', name: 'מתמטיקה 5 יח"ל (יב2)', teacher: 'מיכל ברק', inMashov: true, count: 14 },
  { key: 'שרותי רשת (מעבדת מחשבים 1)', name: 'שרותי רשת (מעבדת מחשבים 1)', teacher: 'עומר פרץ', inMashov: true, count: 16 },
  { key: 'שרותי רשת (מעבדת מחשבים 2)', name: 'שרותי רשת (מעבדת מחשבים 2)', teacher: 'שירה גל', inMashov: false, count: 16 },
];
const UNSURE = { mine: null, reason: null };

test('§14.7 teacherFact: "המורה שלך באנגלית: יוסי שגיא. המבחן הזה: וויקה", and the recommendation (Noa)', () => {
  const mock = exam('d1', '2026-11-01', 'מתכונת באנגלית וויקה', { subjectKey: 'אנגלית', match: UNSURE });
  const fact = s.teacherFact(mock, NOA_LESSONS, []);
  assert.deepEqual(fact, { subject: 'אנגלית', own: 'יוסי שגיא', exam: 'וויקה' });
  assert.equal(s.teacherFactText(fact), 'המורה שלך באנגלית: יוסי שגיא. המבחן הזה: וויקה');
  assert.equal(s.unsureNote(mock, NOA_LESSONS, []), s.FACT_ADVICE);
  assert.equal(s.FACT_ADVICE, 'כנראה לא שלך');
  // The bagrut of the same teacher, and a title with level words and a class in it.
  assert.equal(s.teacherFact(exam('d2', '2026-12-01', 'בגרות באנגלית וויקה', { subjectKey: 'אנגלית', match: UNSURE }), NOA_LESSONS, [])?.exam, 'וויקה');
  assert.equal(s.teacherFact(exam('d3', '2026-12-01', 'י"ב2 - מתכונת באנגלית 5 יח"ל - וויקה כהן', { match: UNSURE }), NOA_LESSONS, [])?.exam, 'וויקה כהן');
  // Read from the title when an older server sends no subject key.
  assert.equal(s.teacherFact(exam('d4', '2026-11-01', 'מתכונת באנגלית וויקה', { match: UNSURE }), NOA_LESSONS, [])?.own, 'יוסי שגיא');
});

test('§14.7 teacherFact: nothing is said when anything is unclear', () => {
  const unsure = (subject, extra = {}) => exam('u', '2026-11-01', subject, { match: UNSURE, ...extra });
  // Not unsure: matched, not mine, confirmed, a bagrut exam.
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית וויקה', { match: { mine: true, reason: null } }), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית וויקה', { match: { mine: false, reason: 'לא במערכת שלך' } }), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית וויקה', { confirmed: true }), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית וויקה', { kind: 'bagrut' }), NOA_LESSONS, []), null);
  // The title names the owner's own teacher, or nobody, or more words than a name.
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית יוסי'), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית'), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('בגרות באנגלית - G'), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית - שאלון 016582'), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('מבחן באנגלית על הספר שקראנו בכיתה'), NOA_LESSONS, []), null);
  // Two own teachers of the subject, neither in Mashov: which is the owner's is not known.
  const twoGroups = NOA_LESSONS.map((l) => ({ ...l, inMashov: false }));
  assert.equal(s.teacherFact(unsure('מבחן בשירותי רשת וויקה', { subjectKey: 'שירותי רשת' }), twoGroups, []), null);
  // …unless the owner hid one, or Mashov lists one: then that is the owner's.
  assert.equal(s.teacherFact(unsure('מבחן בשירותי רשת וויקה', { subjectKey: 'שירותי רשת' }), twoGroups, ['שרותי רשת (מעבדת מחשבים 2)'])?.own, 'עומר פרץ');
  assert.equal(s.teacherFact(unsure('מבחן בשירותי רשת וויקה', { subjectKey: 'שירותי רשת' }), NOA_LESSONS, [])?.own, 'עומר פרץ');
  // The subject is hidden altogether, or not in the timetable: no own teacher.
  assert.equal(s.teacherFact(unsure('מתכונת באנגלית וויקה'), NOA_LESSONS, ['אנגלית 5 יח"ל (יב2)']), null);
  assert.equal(s.teacherFact(unsure('מבחן בכימיה וויקה'), NOA_LESSONS, []), null);
  // A block exam or a title with no subject is decided by subjects, not teachers.
  assert.equal(s.teacherFact(unsure('מבחן גוש ב׳ וויקה'), NOA_LESSONS, []), null);
  assert.equal(s.teacherFact(unsure('טורניר כספות'), NOA_LESSONS, []), null);
  // Without a fact, the card's few words are the reason, as before.
  assert.equal(s.unsureNote(unsure('מתכונת באנגלית'), NOA_LESSONS, []), 'לא ברור אם זו הקבוצה שלך');
});

test('§14.7 titleNameWords: the words after the subject that may be a name', () => {
  assert.deepEqual(s.titleNameWords('מתכונת באנגלית וויקה', 'אנגלית'), ['וויקה']);
  assert.deepEqual(s.titleNameWords('י"ב- מתכונת באנגלית', 'אנגלית'), []);
  // "הקבוצה" is "קבוצה" with its article; "הדס" is a name, not "דס" with one.
  assert.deepEqual(s.titleNameWords('מבחן בפיסיקה - הקבוצה של דינה', 'פיזיקה'), ['דינה']);
  assert.deepEqual(s.titleNameWords('מבחן בפיזיקה הדס', 'פיזיקה'), ['הדס']);
  // "ברק" is a name, though "רק" is not one.
  assert.deepEqual(s.titleNameWords('מבחן בפיזיקה מיכל ברק', 'פיזיקה'), ['מיכל', 'ברק']);
  assert.deepEqual(s.titleNameWords('מבחן מסכם בהיסטוריה פרק 3 - נועם', 'היסטוריה'), ['נועם']);
  assert.deepEqual(s.titleNameWords('י"ב מתכונת במוזיקה ובאמנות', 'מוזיקה'), []);
  assert.deepEqual(s.titleNameWords('מבחן בכימיה יב3', 'כימיה'), []);
  assert.deepEqual(s.titleNameWords('מבחן בכימיה', 'אנגלית'), []);
});

// --- who sent a message, and when (plan §14.1) -------------------------------------

test('§14.1 senderName: Mashov\'s group before the "/" goes; a plain name stays', () => {
  assert.equal(s.senderName('מורים/דנה כהן'), 'דנה כהן');
  assert.equal(s.senderName('מורים / דנה כהן'), 'דנה כהן');
  assert.equal(s.senderName('  מורים/דנה   כהן '), 'דנה כהן');
  assert.equal(s.senderName('דנה כהן'), 'דנה כהן');
  assert.equal(s.senderName('מורה 1'), 'מורה 1');
  // A group of more than one word is not stripped, nor is a trailing "/".
  assert.equal(s.senderName('צוות חינוכי/דנה'), 'צוות חינוכי/דנה');
  assert.equal(s.senderName('מורים/'), 'מורים/');
  assert.equal(s.senderName(null), null);
  assert.equal(s.senderName('  '), null);
  // The task made from a message says who sent it, by name.
  assert.equal(s.messageTaskTitle({ title: 'טיול', body: 'פרטים', from: 'מורים/דנה כהן' }).notes, 'פרטים\n\nמאת דנה כהן');
});

test('§14.1 messageDateLabel: "נשלחה 8.10", "התקבלה" when Mashov gave no send time, "פורסמה" for the site', () => {
  assert.deepEqual(s.messageDateLabel({ date: '2026-10-08T12:27:32+03:00', source: 'mashov' }), { lead: 'נשלחה', date: '8.10' });
  assert.deepEqual(s.messageDateLabel({ date: '2026-10-08T12:27:32+03:00', source: 'mashov', dateIsFirstSeen: true }), { lead: 'התקבלה', date: '8.10' });
  assert.deepEqual(s.messageDateLabel({ date: '2026-10-08T00:00:00+03:00', source: 'shahaf' }), { lead: 'פורסמה', date: '8.10' });
  assert.deepEqual(s.messageDateLabel({ date: '2026-10-08T12:00:00+03:00' }), { lead: 'נשלחה', date: '8.10' });
  assert.equal(s.messageDateLabel({ date: 'not a date', source: 'mashov' }), null);
});

test('§14.1 messagesNewestFirst: by the instant, across offsets; a broken date last', () => {
  const m = (key, date) => ({ naturalKey: key, date });
  const sorted = s.messagesNewestFirst([
    m('old', '2026-09-17T14:21:14+03:00'),
    m('broken', 'x'),
    // 07:30Z and 07:00Z: as strings "09:30" sorts before "10:00", as instants after it.
    m('winter', '2026-10-26T09:30:00+02:00'),
    m('summer', '2026-10-26T10:00:00+03:00'),
    m('new', '2026-10-27T08:00:00+02:00'),
  ]);
  assert.deepEqual(sorted.map((x) => x.naturalKey), ['new', 'winter', 'summer', 'old', 'broken']);
});

// --- finding a message: words and teacher -------------------------------------------

/** A message as the search reads it: a title, a body and a sender. */
function found(title, body, from = null) {
  return { title, body, from };
}

test('a message search finds every word, in any order, in the title, the body or the sender', () => {
  const trip = found('יציאה לטיול השנתי', 'נוסעים לצפון');
  const history = found('מבחן בהיסטוריה', 'בשבוע הבא', 'מורים/דנה כהן');
  const all = [trip, history];
  assert.deepEqual(s.selectMessages(all, { search: 'טיול צפון', sender: null }), [trip]);
  assert.deepEqual(s.selectMessages(all, { search: 'צפון טיול', sender: null }), [trip]);
  assert.deepEqual(s.selectMessages(all, { search: 'דנה מבחן', sender: null }), [history]);
  // One word that is nowhere keeps nothing, even when the other is found. (Not "ים": a word is found inside another, so it is in "נוסעים".)
  assert.deepEqual(s.selectMessages(all, { search: 'טיול חוף', sender: null }), []);
  // A word is found inside another: "ים" is in the body's "נוסעים", and in nothing of the other message.
  assert.deepEqual(s.selectMessages(all, { search: 'ים', sender: null }), [trip]);
  // The sender is searched by the name without Mashov's group: "מורים" is only the group of "מורים/דנה כהן", so it finds nothing.
  assert.deepEqual(s.selectMessages(all, { search: 'מורים', sender: null }), []);
});

test('matches through Latin case, both ways to write gershayim and geresh, and Mashov\'s spaces', () => {
  const pick = (message, search) => s.selectMessages([message], { search, sender: null }).length === 1;
  assert.ok(pick(found('קישור ל־Zoom', ''), 'zoom'));
  assert.ok(pick(found('קישור ל־zoom', ''), 'ZOOM'));
  // The gershayim and the geresh, typed on a phone keyboard as " and ', against the Hebrew marks Mashov sends.
  assert.ok(pick(found('ש״ב', ''), 'ש"ב'));
  assert.ok(pick(found('ש"ב', ''), 'ש״ב'));
  assert.ok(pick(found('צ׳ק', ''), 'צ\'ק'));
  assert.ok(pick(found('צ\'ק', ''), 'צ׳ק'));
  // Double spaces, a no-break space and a line break in the text are single spaces to a search.
  assert.ok(pick(found('', 'יום  ספורט'), 'יום ספורט'));
  assert.ok(pick(found('', 'יום\u00a0ספורט'), 'יום ספורט'));
  assert.ok(pick(found('', 'יום\nספורט'), 'יום ספורט'));
  assert.ok(pick(found('', 'יום ספורט'), '  יום   ספורט  '));
  assert.equal(s.normalizeSearchText('  ש״ב\u00a0 ZOOM\r\nצ׳ק '), 'ש"ב zoom צ\'ק');
  assert.equal(s.normalizeSearchText(null), '');
});

test('an empty or blank search keeps every message, in the order given', () => {
  const a = found('ב', 'x');
  const b = found('א', 'y', 'מורים/דנה כהן');
  const c = found('ג', 'z');
  assert.deepEqual(s.selectMessages([a, b, c], { search: '   ', sender: null }), [a, b, c]);
  assert.deepEqual(s.selectMessages([a, b, c], { search: '', sender: null }), [a, b, c]);
  // The input is left as it was.
  const input = [c, a, b];
  s.selectMessages(input, { search: '', sender: null });
  assert.deepEqual(input, [c, a, b]);
});

test('the sender filter keeps one teacher, by the name without Mashov\'s group; an unknown one keeps none', () => {
  const dana = found('מבחן', 'x', 'מורים/דנה כהן');
  const yossi = found('מבחן', 'y', 'מורים/יוסי לוי');
  const none = found('מבחן', 'z');
  const all = [dana, yossi, none];
  assert.deepEqual(s.selectMessages(all, { search: '', sender: 'דנה כהן' }), [dana]);
  assert.deepEqual(s.selectMessages(all, { search: '', sender: 'אין כזה' }), []);
  // The sender and the words together.
  assert.deepEqual(s.selectMessages(all, { search: 'y', sender: 'דנה כהן' }), []);
  assert.deepEqual(s.selectMessages(all, { search: 'y', sender: 'יוסי לוי' }), [yossi]);
});

test('lists the teachers, the one who wrote last first, each with a count, and no one for a message without a sender', () => {
  const at = (from, date) => ({ from, date });
  assert.deepEqual(s.messageSenders([
    at('מורים/דנה', '2026-10-10T08:00:00+03:00'),
    at('מורים/דנה', '2026-10-20T08:00:00+03:00'),
    at(null, '2026-10-30T08:00:00+03:00'),
    at('מורים/יוסי', '2026-10-25T08:00:00+03:00'),
    at('מורים/דנה', '2026-10-15T08:00:00+03:00'),
  ]), [{ name: 'יוסי', count: 1 }, { name: 'דנה', count: 3 }]);
  assert.deepEqual(s.messageSenders([]), []);
  // Two offsets order by the instant itself (07:30Z is after 07:00Z), and a broken date comes last.
  assert.deepEqual(s.messageSenders([
    at('ד', 'x'),
    at('ב', '2026-10-26T09:30:00+02:00'),
    at('א', '2026-10-26T10:00:00+03:00'),
  ]).map((x) => x.name), ['ב', 'א', 'ד']);
});

test('counts what was found', () => {
  assert.equal(s.messageSearchCount(1), 'נמצאה הודעה אחת');
  assert.equal(s.messageSearchCount(3), 'נמצאו 3 הודעות');
  assert.equal(s.messageSearchCount(12), 'נמצאו 12 הודעות');
});

// --- Google Classroom in School (plan §14.5) ----------------------------------------

/** A Classroom assignment as `ClassroomWork` has it. */
function work(key, extra = {}) {
  return {
    naturalKey: `classroom|c1|${key}`, courseId: 'c1', courseName: 'אנגלית יב2', subject: 'אנגלית 5 יח"ל (יב2)', title: `מטלה ${key}`,
    description: null, dueDate: null, dueTime: null, link: `https://classroom.google.com/c/c1/a/${key}`, state: 'RETURNED', late: false,
    grade: 87, maxPoints: 100, updatedAt: '2026-10-05T10:00:00+03:00', ...extra,
  };
}

test('§14.5 Classroom grades join their subject, on their own scale and outside Mashov\'s average', () => {
  const g = (key, date, subject, value) => ({ naturalKey: key, date, subject, value, valueText: null, weight: null, notes: null, firstSeen: null });
  const mashov = s.groupGradesBySubject([
    g('1', '2026-09-20', 'אנגלית 5 יח"ל (יב2)', 80), g('2', '2026-09-10', 'אנגלית 5 יח"ל (יב2)', 90), g('3', '2026-10-01', 'מתמטיקה', 70),
  ]);
  const groups = s.withClassroomGrades(mashov, [
    work('a'),
    work('b', { grade: 9.5, maxPoints: 10, updatedAt: '2026-09-01T10:00:00+03:00' }),
    work('c', { grade: null, state: 'TURNED_IN' }), // handed in, not graded: not a grade
    work('d', { subject: null, courseName: 'מועדון רובוטיקה', grade: 18, maxPoints: null, updatedAt: '2026-09-25T10:00:00+03:00' }),
    work('e', { subject: 'פיזיקה מורחב (יב3)', courseName: 'פיזיקה', grade: 45, maxPoints: 50, updatedAt: '2026-09-02T09:00:00+03:00' }),
  ]);
  // English: Mashov's two grades and its average untouched; Classroom's two beside them, newest first.
  const english = groups.find((x) => x.subject === 'אנגלית');
  assert.deepEqual(english.grades.map((x) => x.naturalKey), ['1', '2']);
  assert.deepEqual([english.average.value, english.average.count, english.average.weighted], [85, 2, false]);
  assert.deepEqual(english.classroom.map((r) => [r.title, r.value, r.date]), [['מטלה a', '87/100', '2026-10-05'], ['מטלה b', '9.5/10', '2026-09-01']]);
  assert.equal(english.classroom[0].link, 'https://classroom.google.com/c/c1/a/a');
  // Its newest grade is now Classroom's, so it leads.
  assert.equal(english.latestDate, '2026-10-05');
  // Mathematics has none; a course with no subject and a subject Mashov has not graded get groups of their own.
  assert.deepEqual(groups.find((x) => x.subject === 'מתמטיקה').classroom, []);
  const club = groups.find((x) => x.subject === 'מועדון רובוטיקה');
  assert.deepEqual([club.grades, club.average, club.classroom.map((r) => r.value)], [[], null, ['18']]);
  const physics = groups.find((x) => x.subject === 'פיזיקה');
  assert.deepEqual(physics.classroom.map((r) => r.value), ['45/50']);
  // Newest first, as Mashov's groups were.
  assert.deepEqual(groups.map((x) => x.subject), ['אנגלית', 'מתמטיקה', 'מועדון רובוטיקה', 'פיזיקה']);
  // Without Classroom, the groups are Mashov's own.
  assert.deepEqual(s.withClassroomGrades(mashov, []).map((x) => [x.subject, x.classroom.length]), [['מתמטיקה', 0], ['אנגלית', 0]]);
});

test('§14.5 sameSubject and classroomGradeText', () => {
  assert.equal(s.sameSubject('אנגלית 5 יח"ל (יב2)', 'אנגלית'), true);
  assert.equal(s.sameSubject('פיזיקה מורחב (מעבדת פיסיקה)', 'פיסיקה'), true);
  assert.equal(s.sameSubject('מדעי המחשב', 'מדמ"ח'), true);
  assert.equal(s.sameSubject('אנגלית', 'ערבית'), false);
  assert.equal(s.sameSubject('', 'אנגלית'), false);
  assert.equal(s.classroomGradeText(87, 100), '87/100');
  assert.equal(s.classroomGradeText(9.25, 10), '9.3/10');
  assert.equal(s.classroomGradeText(18, null), '18');
  assert.equal(s.classroomGradeText(18, 0), '18');
});

test('§14.5 materialsBySubject: by subject, newest first; a course with no subject by its name', () => {
  const m = (key, subject, courseName, updatedAt) => ({ naturalKey: key, courseId: 'c', courseName, subject, title: key, link: `https://x/${key}`, updatedAt });
  const groups = s.materialsBySubject([
    m('old-en', 'אנגלית 5 יח"ל (יב2)', 'אנגלית יב2', '2026-09-01T10:00:00+03:00'),
    m('club', null, 'מועדון רובוטיקה', '2026-10-01T10:00:00+03:00'),
    m('new-en', 'אנגלית', 'אנגלית - קבוצה ב', '2026-10-06T10:00:00+03:00'),
    m('phys', 'פיסיקה', 'פיזיקה', '2026-09-15T10:00:00+03:00'),
    m('phys2', 'פיזיקה מורחב (יב3)', 'פיזיקה', '2026-09-20T10:00:00+03:00'),
  ]);
  assert.deepEqual(groups.map((g) => [g.subject, g.items.map((x) => x.naturalKey)]), [
    ['אנגלית', ['new-en', 'old-en']],
    ['מועדון רובוטיקה', ['club']],
    ['פיזיקה', ['phys2', 'phys']],
  ]);
  assert.deepEqual(s.materialsBySubject([]), []);
});
