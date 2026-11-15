const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** In place of the app's MMKV store. */
const memory = new Map();
const storage = {
  getString: (k) => memory.get(k),
  set: (k, v) => memory.set(k, v),
  remove: (k) => memory.delete(k),
};
const STUBS = { '../widget/feedCache': { storage } };

/** Loads a TypeScript module from src; relative imports load the same way, except the stubbed ones. */
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(file, module.exports);
  const req = (spec) => {
    if (spec in STUBS) return STUBS[spec];
    return spec.startsWith('.') ? load(`${path.resolve(path.dirname(file), spec)}.ts`) : require(spec);
  };
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}

const w = load(path.join(__dirname, '../src/lib/gradeWeights.ts'));
const st = load(path.join(__dirname, '../src/lib/gradeWeightsStore.ts'));

/** A Mashov grade as the server sends it: the assessment's name in `notes`, and (at this school) no weight. */
let next = 0;
function g(value, notes = null, weight = 0, key = `k${++next}`) {
  return { naturalKey: key, date: '2026-10-01', subject: 'פיזיקה (יב3)', value, valueText: null, weight, notes, firstSeen: null };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

// --- the guess ---------------------------------------------------------------

test('guessType: the real names, and every keyword of each type', () => {
  // Names from the production grades (plan §15).
  assert.equal(w.guessType('ניסוי חקר מטוטלת קונית'), 'work');
  assert.equal(w.guessType('שאלות הבנה באלקטרוסטטיקה'), 'work');
  assert.equal(w.guessType('חוק קולון'), 'other');
  // מבחן: מבחן, בחינה, מתכונת — with their forms.
  for (const name of ['מבחן פרק 3', 'המבחנים במחצית', 'בחינה מסכמת', 'בחינת בית', 'מתכונת', 'במבחן']) assert.equal(w.guessType(name), 'exam', name);
  // בוחן.
  for (const name of ['בוחן פתע', 'בוחנים', 'הבוחן בטריגו']) assert.equal(w.guessType(name), 'quiz', name);
  // עבודה: עבודה, פרויקט, מטלה, חקר, ניסוי, דו״ח, מעבדה, שאלות.
  for (const name of [
    'עבודה ביחידה 2', 'עבודת חקר', 'פרויקט גמר', 'פרוייקט', 'מטלה 3', 'מטלת סיכום', 'עבודת מחקר', 'ניסוי במעבדה',
    'דו״ח מעבדה', 'דו"ח', 'דוח קריאה', 'מעבדה 4', 'שאלות חזרה',
  ]) assert.equal(w.guessType(name), 'work', name);
  // Nothing to go on.
  assert.equal(w.guessType(null), 'other');
  assert.equal(w.guessType(''), 'other');
  assert.equal(w.guessType('ציון מחצית'), 'other');
});

test('guessType: with words of two types, the first one wins', () => {
  assert.equal(w.guessType('מבחן מעבדה'), 'exam');
  assert.equal(w.guessType('עבודה לקראת המבחן'), 'work');
  assert.equal(w.guessType('בוחן על הניסוי'), 'quiz');
  // "מבחנים" is an exam, not "בחנים".
  assert.equal(w.guessType('ממוצע מבחנים'), 'exam');
});

// --- one grade ----------------------------------------------------------------

test('resolveGrade: the guess, the owner\'s type, Mashov\'s weight and the owner\'s, and "שינית"', () => {
  const types = w.DEFAULT_TYPES;
  // As Mashov sent it: the guess, no weight, nothing changed.
  assert.deepEqual(w.resolveGrade({ notes: 'בוחן 1', weight: 0 }, types, undefined),
    { type: 'quiz', guess: 'quiz', weight: null, mashovWeight: null, changed: false });
  // Mashov's positive weight is the grade's own, and not a change.
  assert.deepEqual(w.resolveGrade({ notes: 'בוחן 1', weight: 15 }, types, undefined),
    { type: 'quiz', guess: 'quiz', weight: 15, mashovWeight: 15, changed: false });
  // The owner's type and weight.
  assert.deepEqual(w.resolveGrade({ notes: 'חוק קולון', weight: 0 }, types, { type: 'exam', weight: 10 }),
    { type: 'exam', guess: 'other', weight: 10, mashovWeight: null, changed: true });
  // 0 from the owner takes Mashov's weight away: the grade counts in its type.
  assert.deepEqual(w.resolveGrade({ notes: 'בוחן 1', weight: 15 }, types, { weight: 0 }),
    { type: 'quiz', guess: 'quiz', weight: null, mashovWeight: 15, changed: true });
  // A type the subject no longer has (a removed custom one): back to the guess.
  assert.equal(w.resolveGrade({ notes: 'בוחן 1', weight: 0 }, types, { type: 'c3' }).type, 'quiz');
  assert.equal(w.resolveGrade({ notes: 'בוחן 1', weight: 0 }, types, { type: 'c3' }).changed, false);
});

// --- the average --------------------------------------------------------------

test('subjectAverage: by types — the plain mean of each, weighted by the percents', () => {
  // Exams 80 and 90 (mean 85), a quiz 70, a work 100: 0.6·85 + 0.2·70 + 0.2·100 = 85.
  const avg = w.subjectAverage([g(80, 'מבחן 1'), g(90, 'מבחן 2'), g(70, 'בוחן'), g(100, 'עבודה')], 'פיזיקה');
  close(avg.value, 85);
  assert.equal(avg.count, 4);
  assert.equal(avg.uncounted, 0);
  assert.equal(avg.weighted, true);
  assert.equal(avg.byType, true);
  assert.deepEqual(avg.parts.map((p) => [p.id, p.label, p.count, p.mean, p.share]),
    [['exam', 'מבחן', 2, 85, 60], ['quiz', 'בוחן', 1, 70, 20], ['work', 'עבודה', 1, 100, 20]]);
});

test('subjectAverage: types with no grades are left out, and the rest normalised over them', () => {
  // Only exams and works: 60 and 20 of 80 → 75% and 25%.
  const avg = w.subjectAverage([g(80, 'מבחן'), g(100, 'ניסוי חקר')], 'פיזיקה');
  close(avg.value, 0.75 * 80 + 0.25 * 100);
  assert.deepEqual(avg.parts.map((p) => [p.id, p.share]), [['exam', 75], ['work', 25]]);
  // One type only: its plain mean, and nothing weighted about it.
  const one = w.subjectAverage([g(80, 'מבחן'), g(90, 'מבחן')], 'פיזיקה');
  close(one.value, 85);
  assert.equal(one.weighted, false);
  assert.deepEqual(one.parts.map((p) => [p.id, p.share]), [['exam', 100]]);
});

test('subjectAverage: a set that does not add up to 100 is normalised', () => {
  const prefs = st.setTypePercent(st.setTypePercent(w.EMPTY_WEIGHTS, 'פיזיקה', 'exam', 50), 'פיזיקה', 'work', 25);
  assert.equal(w.percentSum(w.subjectTypes(prefs, 'פיזיקה')), 95);
  // Exams 90, a quiz 60, a work 80: 50, 20, 25 of 95.
  const avg = w.subjectAverage([g(90, 'מבחן'), g(60, 'בוחן'), g(80, 'עבודה')], 'פיזיקה', prefs);
  close(avg.value, (50 * 90 + 20 * 60 + 25 * 80) / 95);
  close(avg.parts.reduce((s, p) => s + p.share, 0), 100);
});

test('subjectAverage: a type at 0% does not count — "אחר" by default — unless nothing else has grades', () => {
  // "חוק קולון" is אחר: at 0% it is left out.
  const avg = w.subjectAverage([g(100, 'ניסוי חקר מטוטלת קונית'), g(80, 'שאלות הבנה'), g(40, 'חוק קולון')], 'פיזיקה');
  close(avg.value, 90);
  assert.equal(avg.count, 2);
  assert.equal(avg.uncounted, 1);
  assert.equal(avg.weighted, true);
  assert.deepEqual(avg.parts.map((p) => [p.id, p.share]), [['work', 100], ['other', 0]]);
  // Only "אחר" (names that say nothing): every grade equally, never no average.
  const others = w.subjectAverage([g(100, 'ריצה'), g(70, 'כדורעף'), g(70, null)], 'חינוך גופני');
  close(others.value, 80);
  assert.equal(others.count, 3);
  assert.equal(others.weighted, false);
  // Two types both at 0%: they share it equally, each by its mean.
  const zero = st.setTypePercent(w.EMPTY_WEIGHTS, 'ספרות', 'quiz', 0);
  const both = w.subjectAverage([g(100, 'בוחן'), g(60, 'משהו'), g(80, 'משהו אחר')], 'ספרות', zero);
  close(both.value, (100 + 70) / 2);
  assert.equal(both.weighted, true);
});

test('subjectAverage: a grade with its own weight counts with exactly it; the types share what is left', () => {
  // A test the owner gave 40%: the types share 60 — exams 60 of 100 → 36, quizzes 12, works 12.
  const exam = g(50, 'מבחן גדול');
  const prefs = st.setGradeWeight(w.EMPTY_WEIGHTS, exam, 40);
  const grades = [exam, g(90, 'מבחן'), g(80, 'בוחן'), g(100, 'עבודה')];
  const avg = w.subjectAverage(grades, 'פיזיקה', prefs);
  close(avg.value, (40 * 50 + 36 * 90 + 12 * 80 + 12 * 100) / 100);
  assert.deepEqual(avg.parts.map((p) => [p.id, p.count]), [['own', 1], ['exam', 1], ['quiz', 1], ['work', 1]]);
  close(avg.parts[0].share, 40);
  close(avg.parts[1].share, 36);
  // Taken out of its type: the exams' mean is the other exam alone.
  assert.equal(avg.parts[1].mean, 90);
});

test('subjectAverage: Mashov\'s positive weights count like the owner\'s; a weight of 0 is none', () => {
  // Noa's subject (W6-8): Mashov weighted every grade, 10% and 25% so far — a mean over the 35%.
  const noa = w.subjectAverage([g(90, 'מבחן', 10), g(84, 'מבחן', 25)], 'מתמטיקה');
  close(noa.value, (90 * 10 + 84 * 25) / 35);
  assert.equal(noa.byType, false);
  assert.equal(noa.weighted, true);
  assert.deepEqual(noa.parts.map((p) => [p.id, p.share]), [['own', 35]]);
  // A weighted grade beside an unweighted one: 30% at 100, the rest (70%) to the other's type.
  const mixed = w.subjectAverage([g(100, 'בוחן', 30), g(70, 'מבחן', null)], 'מתמטיקה');
  close(mixed.value, 0.3 * 100 + 0.7 * 70);
  assert.equal(mixed.byType, true);
  // Weights of 0 (this school's Mashov): by type, as if there were none.
  const zero = w.subjectAverage([g(100, 'מבחן', 0), g(50, 'מבחן', 0)], 'מתמטיקה');
  close(zero.value, 75);
  assert.equal(zero.weighted, false);
  // Equal own weights: a plain mean, not "weighted".
  assert.equal(w.subjectAverage([g(100, 'מבחן', 20), g(50, 'מבחן', 20)], 'מתמטיקה').weighted, false);
});

test('subjectAverage: own weights of 100% and more leave the types nothing, and are scaled to 100', () => {
  // 70 and 60: more than the whole grade — scaled, a mean by them.
  const over = w.subjectAverage([g(90, 'מבחן', 70), g(80, 'מבחן', 60), g(40, 'בוחן')], 'מתמטיקה');
  close(over.value, (90 * 70 + 80 * 60) / 130);
  assert.equal(over.count, 2);
  assert.equal(over.uncounted, 1);
  assert.deepEqual(over.parts.map((p) => [p.id, p.share]), [['own', 100], ['quiz', 0]]);
  assert.equal(over.byType, false);
});

test('subjectAverage: grades in words and nothing at all', () => {
  const words = { ...g(null, 'עבודה'), valueText: 'הוגש' };
  assert.equal(w.subjectAverage([], 'פיזיקה'), null);
  assert.equal(w.subjectAverage([words], 'פיזיקה'), null);
  const avg = w.subjectAverage([words, g(88, 'מבחן')], 'פיזיקה');
  close(avg.value, 88);
  assert.equal(avg.count, 1);
  assert.equal(avg.weighted, false);
});

test('subjectAverage: a subject\'s setup is shared by its group names, and a custom type counts', () => {
  let prefs = st.setTypePercent(w.EMPTY_WEIGHTS, 'פיזיקה (יב3)', 'exam', 40);
  const added = st.addType(prefs, 'פיזיקה', 'הגשות');
  prefs = st.setTypePercent(added.prefs, 'פיזיקה', added.id, 20);
  assert.equal(w.subjectKey('פיזיקה מורחב (יב3)'), 'פיזיקה');
  assert.deepEqual(Object.keys(prefs.subjects), ['פיזיקה']);
  const hw = g(100, 'משהו');
  prefs = st.setGradeType(prefs, hw, added.id);
  // Exams 40, the owner's type 20 — of 60.
  const avg = w.subjectAverage([g(70, 'מבחן'), hw], 'פיזיקה (יב3)', prefs);
  close(avg.value, (40 * 70 + 20 * 100) / 60);
  assert.deepEqual(avg.parts.map((p) => [p.label, p.count]), [['מבחן', 1], ['הגשות', 1]]);
});

test('parsePercent: what a percent field accepts', () => {
  assert.equal(w.parsePercent('60'), 60);
  assert.equal(w.parsePercent(' 12.5 '), 12.5);
  assert.equal(w.parsePercent('12,5'), 12.5);
  assert.equal(w.parsePercent('60%'), 60);
  assert.equal(w.parsePercent('0'), 0);
  assert.equal(w.parsePercent('100'), 100);
  assert.equal(w.parsePercent(''), null);
  assert.equal(w.parsePercent('  '), null);
  assert.equal(w.parsePercent('101'), undefined);
  assert.equal(w.parsePercent('-5'), undefined);
  assert.equal(w.parsePercent('abc'), undefined);
  assert.equal(w.parsePercent('1.2.3'), undefined);
});

// --- the store ----------------------------------------------------------------

test('parseGradeWeights: nothing or garbage is a fresh start', () => {
  for (const raw of [undefined, null, '', '{nope', '[1,2]', '"x"', '42']) assert.deepEqual(st.parseGradeWeights(raw), w.EMPTY_WEIGHTS, String(raw));
});

test('parseGradeWeights: keeps what makes sense and drops the rest', () => {
  const raw = JSON.stringify({
    subjects: {
      'פיזיקה': { types: [
        { id: 'exam', label: 'שונה', percent: 50 }, { id: 'quiz', percent: 150 }, { id: 'c1', label: '  הגשות  ', percent: 30 },
        { id: 'c2', label: '', percent: 5 }, { id: 'evil', label: 'x', percent: 5 }, { id: 'c1', label: 'שוב', percent: 1 },
      ] },
      'מתמטיקה': { types: [{ id: 'exam', percent: 60 }] },
      'כימיה': 'nope',
    },
    grades: { a: { type: 'exam', weight: 10 }, b: { type: 'nonsense', weight: -1 }, c: { weight: 0 }, d: 'x' },
  });
  const prefs = st.parseGradeWeights(raw);
  // Built-in names are the app's; a missing built-in type comes back at its default; a type set equal to the default is no entry.
  assert.deepEqual(prefs.subjects, {
    'פיזיקה': { types: [
      { id: 'exam', label: 'מבחן', percent: 50 }, { id: 'c1', label: 'הגשות', percent: 30 },
      { id: 'quiz', label: 'בוחן', percent: 20 }, { id: 'work', label: 'עבודה', percent: 20 }, { id: 'other', label: 'אחר', percent: 0 },
    ] },
  });
  assert.deepEqual(prefs.grades, { a: { type: 'exam', weight: 10 }, c: { weight: 0 } });
});

test('read and write go through the phone store, under one key, and round-trip', () => {
  memory.clear();
  assert.deepEqual(st.readGradeWeights(), w.EMPTY_WEIGHTS);
  let prefs = st.setTypePercent(w.EMPTY_WEIGHTS, 'פיזיקה (יב3)', 'exam', 70);
  prefs = st.addType(prefs, 'פיזיקה', 'הגשות').prefs;
  prefs = st.setGradeType(prefs, g(90, 'חוק קולון', 0, 'mashov-grade|1'), 'quiz');
  prefs = st.setGradeWeight(prefs, g(90, 'מבחן', 0, 'mashov-grade|2'), 15);
  st.writeGradeWeights(prefs);
  assert.deepEqual([...memory.keys()], ['grades.weights']);
  assert.deepEqual(st.readGradeWeights(), prefs);
  assert.deepEqual(prefs.grades, { 'mashov-grade|1': { type: 'quiz' }, 'mashov-grade|2': { weight: 15 } });
});

test('subject updates: percents, custom types, and back to the default', () => {
  let p = st.setTypePercent(w.EMPTY_WEIGHTS, 'פיזיקה', 'quiz', 30);
  assert.deepEqual(w.subjectTypes(p, 'פיזיקה').map((t) => t.percent), [60, 30, 20, 0]);
  // An emptied field is 0; nonsense changes nothing.
  p = st.setTypePercent(p, 'פיזיקה', 'work', null);
  assert.equal(w.subjectTypes(p, 'פיזיקה').find((t) => t.id === 'work').percent, 0);
  assert.equal(st.setTypePercent(p, 'פיזיקה', 'work', 120), p);
  // Back to the default numbers by hand: the entry is gone.
  p = st.setTypePercent(st.setTypePercent(p, 'פיזיקה', 'quiz', 20), 'פיזיקה', 'work', 20);
  assert.deepEqual(p.subjects, {});
  // Custom types: numbered, the same name twice is one type, a name is needed; the built-in ones cannot be removed.
  const a = st.addType(w.EMPTY_WEIGHTS, 'פיזיקה', 'הגשות');
  assert.equal(a.id, 'c1');
  const b = st.addType(a.prefs, 'פיזיקה', 'מצגת');
  assert.equal(b.id, 'c2');
  assert.equal(st.addType(b.prefs, 'פיזיקה', ' הגשות ').id, 'c1');
  assert.deepEqual(st.addType(b.prefs, 'פיזיקה', '   '), { prefs: b.prefs, id: null });
  assert.equal(st.removeType(b.prefs, 'פיזיקה', 'exam'), b.prefs);
  const removed = st.removeType(b.prefs, 'פיזיקה', 'c1');
  assert.deepEqual(w.subjectTypes(removed, 'פיזיקה').map((t) => t.id), ['exam', 'quiz', 'work', 'other', 'c2']);
  // A removed type's grades go back to their guess.
  const hw = g(100, 'בוחן', 0, 'x');
  const typed = st.setGradeType(removed, hw, 'c2');
  assert.equal(w.resolveGrade(hw, w.subjectTypes(st.removeType(typed, 'פיזיקה', 'c2'), 'פיזיקה'), typed.grades.x).type, 'quiz');
  // "לחזור לברירת המחדל": the subject's set goes; what was set on its grades stays.
  const reset = st.resetSubject(typed, 'פיזיקה (יב3)');
  assert.deepEqual(reset.subjects, {});
  assert.deepEqual(reset.grades, { x: { type: 'c2' } });
  assert.deepEqual(w.subjectTypes(reset, 'פיזיקה'), w.DEFAULT_TYPES);
  assert.equal(st.resetSubject(reset, 'פיזיקה'), reset);
});

test('grade updates: the guess and Mashov\'s weight are no entry; 0 over a Mashov weight is', () => {
  const quiz = g(80, 'בוחן', 0, 'q');
  // Its own guess is no change.
  assert.deepEqual(st.setGradeType(w.EMPTY_WEIGHTS, quiz, 'quiz').grades, {});
  let p = st.setGradeType(w.EMPTY_WEIGHTS, quiz, 'exam');
  assert.deepEqual(p.grades, { q: { type: 'exam' } });
  p = st.setGradeWeight(p, quiz, 12.5);
  assert.deepEqual(p.grades, { q: { type: 'exam', weight: 12.5 } });
  // Emptying the weight where Mashov has none, and the guess again: no entry left.
  p = st.setGradeWeight(p, quiz, null);
  p = st.setGradeType(p, quiz, null);
  assert.deepEqual(p.grades, {});
  // Over a Mashov weight: emptying it is a change (0, count in the type); typing Mashov's own back is none.
  const weighted = g(80, 'בוחן', 15, 'm');
  p = st.setGradeWeight(w.EMPTY_WEIGHTS, weighted, null);
  assert.deepEqual(p.grades, { m: { weight: 0 } });
  assert.equal(w.resolveGrade(weighted, w.DEFAULT_TYPES, p.grades.m).weight, null);
  assert.deepEqual(st.setGradeWeight(p, weighted, 15).grades, {});
  assert.equal(st.setGradeWeight(p, weighted, 101), p);
  // resetGrade takes it all away.
  p = st.setGradeType(st.setGradeWeight(w.EMPTY_WEIGHTS, quiz, 10), quiz, 'work');
  assert.deepEqual(st.resetGrade(p, 'q').grades, {});
  assert.equal(st.resetGrade(w.EMPTY_WEIGHTS, 'q'), w.EMPTY_WEIGHTS);
});
