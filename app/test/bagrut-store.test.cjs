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

const s = load(path.join(__dirname, '../src/lib/bagrutStore.ts'));
const b = load(path.join(__dirname, '../src/lib/bagrut.ts'));
const { CATALOG } = load(path.join(__dirname, '../src/lib/bagrutCatalog.ts'));
const { EMPTY_PREFS } = b;

test('parseBagrutPrefs: nothing or garbage is a fresh start', () => {
  assert.deepEqual(s.parseBagrutPrefs(undefined), EMPTY_PREFS);
  assert.deepEqual(s.parseBagrutPrefs(''), EMPTY_PREFS);
  assert.deepEqual(s.parseBagrutPrefs('{nope'), EMPTY_PREFS);
  assert.deepEqual(s.parseBagrutPrefs('[1,2]'), EMPTY_PREFS);
});

test('parseBagrutPrefs: keeps what makes sense and drops the rest', () => {
  const raw = JSON.stringify({
    version: 2,
    subjects: {
      math: { units: 5, weights: { 35571: 60, 35572: 140 }, shares: { 35571: 50, 35572: -1 }, excluded: 'no' },
      bible: { units: 0 },
      cs: 'nope',
    },
    grades: { 16582: { exam: 90, school: 101 }, 16586: { school: 'x' }, 1: 7 },
    added: { 'own:תיאטרון': { name: ' תיאטרון ' }, chemistry: { name: '' }, x: 3 },
    rows: { 'own:תיאטרון': [{ id: 'x1', name: 'עבודה' }, { id: 'x1', name: 'again' }, { id: 'x2', name: '' }, { id: 'bad', name: 'a' }, { id: '37283' }], y: 'no' },
    institution: 'oxford',
  });
  assert.deepEqual(s.parseBagrutPrefs(raw), {
    subjects: { math: { units: 5, weights: { 35571: 60 }, shares: { 35571: 50 } } },
    grades: { 16582: { exam: 90 } },
    added: { 'own:תיאטרון': { name: 'תיאטרון' } },
    rows: { 'own:תיאטרון': [{ id: 'x1', name: 'עבודה' }, { id: '37283', name: '' }] },
    institution: null,
  });
  assert.equal(s.parseBagrutPrefs(JSON.stringify({ version: 2, institution: 'technion' })).institution, 'technion');
});

test('parseBagrutPrefs: 1.6.0\'s data reads into the new shape — estimates are grades, "does not count" a weight of 0', () => {
  // Exactly as 1.6.0 wrote it (no version).
  const v1 = JSON.stringify({
    subjects: {
      math: { units: 4, weights: { 35571: 65 }, counts: { 35472: false } },
      traffic: { excluded: false, units: 1, weights: { 700181: 100 }, counts: { 700181: true } },
    },
    estimates: { 16582: 90, 22222: 85, 35572: 85.5 },
    institution: 'huji',
  });
  const p = s.parseBagrutPrefs(v1);
  assert.deepEqual(p, {
    subjects: {
      math: { units: 4, weights: { 35571: 65, 35472: 0 } },
      traffic: { units: 1, excluded: false, weights: { 700181: 100 } },
    },
    // 22222 is school-assessed: its estimate was its only grade, the school's.
    grades: { 16582: { exam: 90 }, 22222: { school: 85 }, 35572: { exam: 85.5 } },
    added: {},
    rows: {},
    institution: 'huji',
  });
  // Written back, it is version 2, and reads the same.
  memory.clear();
  s.writeBagrutPrefs(p);
  assert.equal(JSON.parse(memory.get('bagrut.prefs')).version, 2);
  assert.deepEqual(s.readBagrutPrefs(), p);
  // A version 2 blob's "counts" and "estimates" are not read again.
  assert.deepEqual(s.parseBagrutPrefs(JSON.stringify({ version: 2, estimates: { 1: 50 }, subjects: { a: { counts: { 1: false } } } })), EMPTY_PREFS);
});

test('migrated estimates count as they did: the exam next to Mashov\'s school grade, "משוער"', () => {
  const p = s.parseBagrutPrefs(JSON.stringify({ estimates: { 16582: 90 } }));
  const exam = {
    naturalKey: 'bagrut|16582|2027-01', semel: 16582, name: 'אנגלית ז - G (הערכה חיצונית)', moed: '2027-01', method: 'external',
    schoolGrade: 80, examGrade: null, finalGrade: null, acceptedGrade: null, registered: true, examDate: '2027-01-21', startTime: '14:00', endTime: null,
  };
  const g = b.buildSubjects([exam], p, CATALOG, '2026-10-09')[0].questionnaires.find((x) => x.id === '16582');
  assert.deepEqual(g.exam, { value: 90, origin: 'estimate' });
  assert.deepEqual(g.final, { value: 87, estimated: true }); // 0.3 × 80 + 0.7 × 90
});

test('read and write go through the phone store, under one key', () => {
  memory.clear();
  assert.deepEqual(s.readBagrutPrefs(), EMPTY_PREFS);
  const prefs = s.setInstitution(s.setGrade(EMPTY_PREFS, '16582', 'exam', 92), 'huji');
  s.writeBagrutPrefs(prefs);
  assert.deepEqual([...memory.keys()], ['bagrut.prefs']);
  assert.deepEqual(s.readBagrutPrefs(), prefs);
});

test('grades: הגשה and בגרות for any questionnaire; null gives the field back to Mashov', () => {
  let p = s.setGrade(EMPTY_PREFS, '35571', 'school', 100);
  p = s.setGrade(p, '35571', 'exam', 95);
  p = s.setGrade(p, 'x1', 'exam', 70);
  assert.deepEqual(p.grades, { 35571: { school: 100, exam: 95 }, x1: { exam: 70 } });
  p = s.setGrade(p, '35571', 'school', null);
  assert.deepEqual(p.grades['35571'], { exam: 95 });
  // Nonsense clears; the last field gone drops the questionnaire.
  p = s.setGrade(p, '35571', 'exam', 101);
  assert.equal('35571' in p.grades, false);
  // "לחזור למשוב": the overridden fields go, the rest stay.
  p = s.setGrade(s.setGrade(p, '1261', 'school', 90), '1261', 'exam', 80);
  p = s.clearGrades(p, [{ id: '1261', field: 'exam' }, { id: 'x1', field: 'exam' }]);
  assert.deepEqual(p.grades, { 1261: { school: 90 } });
  assert.equal(s.clearGrades(p, []), p);
  assert.deepEqual(EMPTY_PREFS.grades, {});
});

test('subject updates: units, weights, splits, excluded; null goes back to the table', () => {
  let p = s.setSubjectUnits(EMPTY_PREFS, 'math', 5);
  p = s.setQuestionnaireWeight(p, 'math', '35571', 60);
  p = s.setQuestionnaireWeight(p, 'math', '35572', 0);
  p = s.setQuestionnaireShare(p, 'math', '35571', 30);
  p = s.setSubjectExcluded(p, 'traffic', false);
  assert.deepEqual(p.subjects, {
    math: { units: 5, weights: { 35571: 60, 35572: 0 }, shares: { 35571: 30 } },
    traffic: { excluded: false },
  });
  p = s.setSubjectUnits(p, 'math', null);
  p = s.setQuestionnaireWeight(p, 'math', '35571', null);
  p = s.setQuestionnaireShare(p, 'math', '35571', null);
  assert.deepEqual(p.subjects.math, { weights: { 35572: 0 } });
  p = s.setQuestionnaireWeight(p, 'math', '35572', null);
  assert.equal('math' in p.subjects, false);
  p = s.setSubjectUnits(p, 'x', 0);
  assert.equal('x' in p.subjects, false);
  p = s.setQuestionnaireWeight(p, 'x', '1', 101);
  assert.equal('x' in p.subjects, false);
  assert.deepEqual(EMPTY_PREFS, { subjects: {}, grades: {}, added: {}, rows: {}, institution: null });
});

test('resetToTable ("לחזור לטבלה"): only what changed the table goes', () => {
  let p = s.setSubjectUnits(EMPTY_PREFS, 'own:x', 2);
  p = s.setQuestionnaireWeight(p, 'own:x', 'x1', 100);
  p = s.setSubjectUnits(p, 'bible', 3);
  p = s.setQuestionnaireWeight(p, 'bible', '1261', 60);
  p = s.setQuestionnaireWeight(p, 'bible', 'x2', 10);
  p = s.setQuestionnaireShare(p, 'bible', '1261', 40);
  p = s.setSubjectExcluded(p, 'bible', true);
  p = s.resetToTable(p, 'bible', { units: true, excluded: true, weights: ['1261'], shares: ['1261'] });
  // The owner's own row's weight is not the table's to take back.
  assert.deepEqual(p.subjects, { 'own:x': { units: 2, weights: { x1: 100 } }, bible: { weights: { x2: 10 } } });
});

test('a subject the owner adds: a name, units and rows; removing it takes everything entered for it, and "לבטל" brings it back', () => {
  const key = b.subjectKeyFor('תיאטרון', CATALOG);
  assert.equal(key, 'own:תיאטרון');
  let p = s.addSubject(EMPTY_PREFS, key, 'תיאטרון', 2, [
    { name: 'עבודה', weight: 60, share: 30 },
    { name: 'בחינה', weight: 40, share: 0 },
    { name: ' ', weight: 10, share: null },
  ]);
  assert.deepEqual(p.added, { 'own:תיאטרון': { name: 'תיאטרון' } });
  assert.deepEqual(p.rows[key], [{ id: 'x1', name: 'עבודה' }, { id: 'x2', name: 'בחינה' }]);
  assert.deepEqual(p.subjects[key], { units: 2, weights: { x1: 60, x2: 40 }, shares: { x1: 30, x2: 0 } });
  // Added twice: nothing changes.
  assert.equal(s.addSubject(p, key, 'תיאטרון', 3, []), p);
  // A table subject at its level: its codes, the weights and splits left to the table.
  p = s.addSubject(p, 'chemistry', 'כימיה', 5, [37381, 37388, 37283].map((c) => ({ name: String(c), weight: null, share: null })));
  assert.deepEqual(p.rows.chemistry, [{ id: '37381', name: '' }, { id: '37388', name: '' }, { id: '37283', name: '' }]);
  assert.deepEqual(p.subjects.chemistry, { units: 5 });

  const withGrade = s.setGrade(p, 'x1', 'school', 95);
  const removed = s.removeSubject(withGrade, key);
  assert.equal(key in removed.added, false);
  assert.equal(key in removed.rows, false);
  assert.equal(key in removed.subjects, false);
  assert.equal('x1' in removed.grades, false);
  assert.deepEqual(removed.rows.chemistry, p.rows.chemistry);
  // "לבטל": the tab keeps the prefs from before and puts them back; nothing was changed in place.
  assert.deepEqual(withGrade.grades, { x1: { school: 95 } });
  assert.equal(s.removeSubject(removed, key), removed);
  // A new row after the removal does not reuse an id still in use elsewhere.
  assert.equal(s.nextRowId(removed), 'x1');
  assert.equal(s.nextRowId(withGrade), 'x3');
});

test('"+ שאלון": a code or a name on any subject, removed again with what was entered for it', () => {
  let p = s.addRow(EMPTY_PREFS, 'english', { name: '16583', weight: null, share: null });
  p = s.addRow(p, 'english', { name: 'עבודת חקר', weight: 10, share: 30 });
  p = s.addRow(p, 'english', { name: '016583', weight: null, share: null }); // the same code
  assert.deepEqual(p.rows.english, [{ id: '16583', name: '' }, { id: 'x1', name: 'עבודת חקר' }]);
  assert.deepEqual(p.subjects.english, { weights: { x1: 10 }, shares: { x1: 30 } });
  p = s.setGrade(p, 'x1', 'exam', 80);
  p = s.removeRow(p, 'english', 'x1');
  assert.deepEqual(p.rows.english, [{ id: '16583', name: '' }]);
  assert.equal('english' in p.subjects, false);
  assert.equal('x1' in p.grades, false);
  p = s.removeRow(p, 'english', '16583');
  assert.equal('english' in p.rows, false);
  assert.equal(s.removeRow(p, 'english', 'nothing'), p);
});

test('"לבטל": a removed subject or row comes back as it was, and what changed since stays', () => {
  let before = s.addSubject(EMPTY_PREFS, 'own:a', 'א', 2, [{ name: 'עבודה', weight: 100, share: 30 }]);
  before = s.setGrade(before, 'x1', 'exam', 90);
  let p = s.removeSubject(before, 'own:a');
  p = s.setInstitution(p, 'tau');
  const back = s.restoreSubject(p, before, 'own:a');
  assert.deepEqual({ ...back, institution: null }, before);
  assert.equal(back.institution, 'tau');
  assert.equal(s.restoreSubject(p, EMPTY_PREFS, 'own:a'), p);

  let rows = s.addRow(EMPTY_PREFS, 'english', { name: '16583', weight: null, share: null });
  rows = s.addRow(rows, 'english', { name: 'עבודה', weight: 20, share: 40 });
  rows = s.addRow(rows, 'english', { name: 'בעל פה', weight: 10, share: null });
  rows = s.setGrade(rows, 'x1', 'school', 77);
  const without = s.removeRow(rows, 'english', 'x1');
  const again = s.restoreRow(without, rows, 'english', 'x1');
  assert.deepEqual(again.rows.english.map((r) => r.id), ['16583', 'x1', 'x2']);
  assert.deepEqual(again.subjects.english, rows.subjects.english);
  assert.deepEqual(again.grades, rows.grades);
});

test('the store and the model together: add, merge with Mashov later, remove', () => {
  let p = s.addSubject(EMPTY_PREFS, 'english', 'אנגלית', 5, [16471, 16583, 16582, 16586].map((c) => ({ name: String(c), weight: null, share: null })));
  p = s.setGrade(p, '16582', 'exam', 90);
  const today = '2026-10-09';
  const alone = b.buildSubjects([], p, CATALOG, today);
  assert.deepEqual(alone.map((x) => [x.key, x.added, x.questionnaires.length]), [['english', true, 4]]);
  const exam = {
    naturalKey: 'bagrut|16582|2027-01', semel: 16582, name: 'אנגלית ז - G (הערכה חיצונית)', moed: '2027-01', method: 'external',
    schoolGrade: null, examGrade: null, finalGrade: null, acceptedGrade: null, registered: true, examDate: '2027-01-21', startTime: '14:00', endTime: null,
  };
  const merged = b.buildSubjects([exam], p, CATALOG, today);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].questionnaires.map((x) => [x.id, x.status]), [['16471', 'added'], ['16582', 'open'], ['16583', 'added'], ['16586', 'added']]);
  assert.equal(merged[0].added, false);
  assert.equal(merged[0].questionnaires[1].exam.value, 90);
  assert.deepEqual(b.buildSubjects([], s.removeSubject(p, 'english'), CATALOG, today), []);
});

test('parseNumberInput: digits with a dot or a comma; anything else clears the field', () => {
  assert.equal(s.parseNumberInput('84'), 84);
  assert.equal(s.parseNumberInput(' 1.5 '), 1.5);
  assert.equal(s.parseNumberInput('2,5'), 2.5);
  assert.equal(s.parseNumberInput(''), null);
  assert.equal(s.parseNumberInput('-3'), null);
  assert.equal(s.parseNumberInput('8a'), null);
});
