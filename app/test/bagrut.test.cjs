const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a TypeScript module from src, with its relative imports loaded the same way. */
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(file, module.exports);
  const req = (spec) => (spec.startsWith('.') ? load(`${path.resolve(path.dirname(file), spec)}.ts`) : require(spec));
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}

const b = load(path.join(__dirname, '../src/lib/bagrut.ts'));
const { CATALOG: REAL } = load(path.join(__dirname, '../src/lib/bagrutCatalog.ts'));

// ── The de-identified Mashov capture (plan §14.9), as the server hands it over ──
// The grades in it are fake (they do not add up); the codes, names and sittings are real.

const FIXTURES = path.join(__dirname, '../../server/test/fixtures/mashov-w7');
const grades = require(path.join(FIXTURES, 'bagrut-grades.json'));
const sheelonim = require(path.join(FIXTURES, 'bagrut-sheelonim.json'));

/** One `bagrut/grades` row joined with its `bagrut/sheelonim` row, as `BagrutExam` describes. */
function toExam(row) {
  const raw = String(row.moed);
  const moed = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const sh = sheelonim.find((s) => s.semel === row.semel && s.moed === row.moed);
  const method = row.testMethodName === 'היבחנות חיצונית' ? 'external' : row.testMethodName === 'ציון בית ספרי' ? 'school' : null;
  return {
    naturalKey: `bagrut|${row.semel}|${moed}`,
    semel: row.semel,
    name: row.name,
    moed,
    method,
    schoolGrade: row.shnaty ?? null,
    examGrade: row.test ?? null,
    finalGrade: row.final ?? null,
    acceptedGrade: row.moeLastAcceptedGrade ?? null,
    registered: row.going === true,
    examDate: sh && sh.examDate ? sh.examDate.slice(0, 10) : null,
    startTime: (sh && sh.examStartTime) || null,
    endTime: (sh && sh.examEndTime) || null,
  };
}

const EXAMS = grades.map(toExam);
const TODAY = '2026-10-09';

/**
 * A made-up table for the arithmetic: these values are test data, not the
 * Ministry's (the real table is tested in bagrut-catalog.test.cjs).
 */
const SRC = { url: 'https://example.test/table', year: '2026', kind: 'official' };
const entry = (semel, subject, weights, extra = {}) => ({ semel, subject, weights, counts: true, schoolShare: null, source: SRC, ...extra });
const CATALOG = {
  subjects: {
    bible: { id: 'bible', name: 'תנ״ך', aliases: [], levels: { 2: [[1261, 1263]] } },
    // 5 units only, until the math test below opens 3 and 4.
    math: { id: 'math', name: 'מתמטיקה', aliases: [], levels: { 5: [[35571, 35572]] } },
    english: { id: 'english', name: 'אנגלית', aliases: [], levels: { 5: [[16471, 16582, 16586]] } },
    history: { id: 'history', name: 'היסטוריה', aliases: [], levels: {} },
    traffic: { id: 'traffic', name: 'חינוך תעבורתי', aliases: [], levels: {} },
    physics: {
      id: 'physics', name: 'פיזיקה', aliases: [],
      levels: { 5: [[36361, 36371, 36386, 36283], [36361, 36351, 36356, 36283], [36361, 36371, 36286, 36288]] },
    },
  },
  entries: {
    1261: entry(1261, 'bible', { 2: 70 }, { schoolShare: 50 }),
    1263: entry(1263, 'bible', { 2: 30 }),
    35571: entry(35571, 'math', { 5: 60 }, { schoolShare: 50 }),
    35572: entry(35572, 'math', { 5: 40 }, { schoolShare: 50 }),
    // English with no split known: 50/50, and Mashov's own final while nothing is changed.
    16471: entry(16471, 'english', { 5: 30 }),
    16582: entry(16582, 'english', { 5: 50 }),
    16586: entry(16586, 'english', { 5: 20 }),
    700181: entry(700181, 'traffic', {}, { counts: false }),
    36361: entry(36361, 'physics', { 5: 30 }),
    36371: entry(36371, 'physics', { 5: 25 }),
    36386: entry(36386, 'physics', { 5: 15 }),
    36283: entry(36283, 'physics', { 5: 30 }),
    36351: entry(36351, 'physics', { 5: 30 }),
    36356: entry(36356, 'physics', { 5: 10 }),
    36286: entry(36286, 'physics', { 5: 15 }),
    36288: entry(36288, 'physics', { 5: 30 }),
  },
  schoolAssessed: new Set([1263, 36283, 36288]),
};

/** An institution's rules, made up for the arithmetic. */
const RULES = {
  minGrade: 60,
  bonuses: [
    { subjects: ['math'], units: 5, bonus: 30 },
    { subjects: 'any', units: 5, bonus: 20 },
    { subjects: 'any', units: 4, bonus: 10 },
  ],
  averageCap: null,
  compulsory: null,
  minUnits: 20,
};

const prefsOf = (extra = {}) => ({ ...b.EMPTY_PREFS, ...extra });
const subjects = (prefs = b.EMPTY_PREFS, exams = EXAMS, today = TODAY) => b.buildSubjects(exams, prefs, CATALOG, today);
const subject = (list, key) => list.find((s) => s.key === key);
const q = (s, semel) => s.questionnaires.find((x) => x.id === String(semel));

/** One sitting of a questionnaire, past by default; `fields` replace what it has. */
const sitting = (semel, fields = {}) => ({
  naturalKey: `bagrut|${semel}|2026-06`, semel, name: 'שאלון (הערכה חיצונית)', moed: '2026-06', method: 'external',
  schoolGrade: null, examGrade: null, finalGrade: null, acceptedGrade: null, registered: true,
  examDate: '2026-06-01', startTime: null, endTime: null, ...fields,
});
/** The questionnaire one sitting makes, with the owner's grades and subject entries. */
const one = (exam, grades = {}, subjectsPrefs = {}, today = TODAY) => {
  const list = b.buildSubjects([exam], prefsOf({ grades, subjects: subjectsPrefs }), CATALOG, today);
  return list[0].questionnaires.find((x) => x.semel === exam.semel);
};

// ── Grades ──────────────────────────────────────────────────────────────────

test('roundGrade: half up, and float noise does not tip it', () => {
  assert.equal(b.roundGrade(84.5), 85);
  assert.equal(b.roundGrade(84.49), 84);
  assert.equal(b.roundGrade(0.7 * 85 + 0.3 * 95), 88);
  assert.equal(b.questionnaireGrade(88, 74, 50), 81);
  assert.equal(b.questionnaireGrade(90, 75, 30), 80); // 27 + 52.5 = 79.5 → 80
});

test('realGrade: the Ministry\'s status codes (666 blocked, 999 disqualified…) are not grades', () => {
  assert.equal(b.realGrade(87), 87);
  assert.equal(b.realGrade(0), 0);
  assert.equal(b.realGrade(null), null);
  for (const code of [333, 666, 777, 888, 999]) assert.equal(b.realGrade(code), null);
  assert.equal(b.sittingFinal(sitting(16471, { finalGrade: 888 }), null), null);
  assert.equal(one(sitting(16471, { schoolGrade: 999, examGrade: 80 })).school.value, null);
});

test('combineGrades: by the split; school-assessed is the school grade, 0 the exam; a lone exam stands for the whole', () => {
  assert.equal(b.combineGrades(90, 80, 30), 83);
  assert.equal(b.combineGrades(90, 80, 100), 90);
  assert.equal(b.combineGrades(null, 80, 100), null);
  assert.equal(b.combineGrades(90, 80, 0), 80);
  // The owner's example: "16582 (G) 27% [ ] [90] 90".
  assert.equal(b.combineGrades(null, 90, 30), 90);
  // A school grade alone is not a grade until the exam.
  assert.equal(b.combineGrades(90, null, 30), null);
});

// ── A questionnaire's grade: every combination ─────────────────────────────

test('final, untouched: Mashov\'s own whenever it has one; else worked out by the split where known, 50/50 where not', () => {
  // Known split (50), and Mashov has a final (95, fake): Mashov's, not the 81 that 88 and 74 make.
  const known = one(sitting(1261, { schoolGrade: 88, examGrade: 74, finalGrade: 95 }));
  assert.deepEqual([known.share, known.shareOrigin, known.status], [50, 'table', 'graded']);
  assert.deepEqual([known.school, known.exam], [{ value: 88, origin: 'mashov' }, { value: 74, origin: 'mashov' }]);
  assert.deepEqual(known.final, { value: 95, estimated: false });
  // Known split and no final from Mashov: 88 and 74 make 81.
  assert.deepEqual(one(sitting(1261, { schoolGrade: 88, examGrade: 74 })).final, { value: 81, estimated: false });
  // Unknown split: Mashov's final.
  const unknown = one(sitting(16471, { schoolGrade: 90, examGrade: 79, finalGrade: 88 }));
  assert.equal(unknown.share, null);
  assert.deepEqual(unknown.final, { value: 88, estimated: false });
  // Unknown split and no final from Mashov: 50/50.
  assert.deepEqual(one(sitting(16471, { schoolGrade: 90, examGrade: 80 })).final, { value: 85, estimated: false });
  // Known split but the exam is missing: Mashov's final.
  assert.deepEqual(one(sitting(1261, { schoolGrade: 90, finalGrade: 77 })).final, { value: 77, estimated: false });
  // Mashov has only the final (the traffic test): that.
  assert.deepEqual(one(sitting(16471, { finalGrade: 8 })).final, { value: 8, estimated: false });
});

test('final, untouched: Mashov\'s final is the official grade, with the Ministry\'s moderation the parts cannot show', () => {
  // 1261 at the real table's 30/70: 30 + 64.4 = 94.4 → 94 from the parts; the certificate says 95.
  const exam = sitting(1261, { schoolGrade: 100, examGrade: 92, finalGrade: 95 });
  assert.equal(b.sittingFinal(exam, 30), 95);
  const bible = subject(b.buildSubjects([exam], b.EMPTY_PREFS, REAL, TODAY), 'bible');
  assert.deepEqual([q(bible, 1261).share, q(bible, 1261).shareOrigin], [30, 'table']);
  assert.deepEqual(q(bible, 1261).final, { value: 95, estimated: false });
  // With no final from Mashov, the parts at the split: 94.
  assert.equal(b.sittingFinal({ ...exam, finalGrade: null }, 30), 94);
});

test('final, overridden: what the owner enters wins over Mashov, says "שינית", and Mashov\'s final is not used', () => {
  const known = one(sitting(1261, { schoolGrade: 88, examGrade: 74, finalGrade: 95 }), { 1261: { school: 100 } });
  assert.deepEqual(known.school, { value: 100, origin: 'override' });
  assert.deepEqual(known.final, { value: 87, estimated: false }); // (100 + 74) / 2
  assert.equal(b.gradeWord(known.school.origin), 'שינית');
  assert.equal(b.gradeWord(known.exam.origin), null);
  // Unknown split: 50/50 of what the fields hold, not Mashov's 88.
  const unknown = one(sitting(16471, { schoolGrade: 90, examGrade: 79, finalGrade: 88 }), { 16471: { exam: 89 } });
  assert.deepEqual(unknown.final, { value: 90, estimated: false }); // 89.5 → 90
  // Entering Mashov's own value changes nothing.
  assert.equal(one(sitting(1261, { schoolGrade: 88, examGrade: 74 }), { 1261: { school: 88 } }).school.origin, 'mashov');
  // Overriding the school grade where Mashov has no exam: no grade until the exam is in.
  assert.deepEqual(one(sitting(1261, { schoolGrade: 88, finalGrade: 95 }), { 1261: { school: 90 } }).final, { value: null, estimated: false });
});

test('final, school-assessed: the school grade alone — by Mashov\'s method, or by the table', () => {
  const byMashov = one(sitting(1263, { method: 'school', schoolGrade: 100 }));
  assert.deepEqual([byMashov.share, byMashov.shareOrigin], [100, 'mashov']);
  assert.deepEqual(byMashov.final, { value: 100, estimated: false });
  assert.deepEqual(one(sitting(1263, { method: 'school', schoolGrade: 100 }), { 1263: { school: 90 } }).final, { value: 90, estimated: false });
  // An exam entered on it does not count.
  assert.deepEqual(one(sitting(1263, { method: 'school', schoolGrade: 100 }), { 1263: { exam: 50 } }).final, { value: 100, estimated: false });
  // Mashov's method beats the table's split (16471 here has none; 1261 has 50): 70, not the 80 that 50/50 makes.
  assert.equal(one(sitting(1261, { method: 'school', schoolGrade: 70, examGrade: 90 })).final.value, 70);
  // The table says school-assessed, Mashov says nothing.
  const byTable = one(sitting(1263, { schoolGrade: 92 }));
  assert.deepEqual([byTable.share, byTable.shareOrigin, byTable.final.value], [100, 'table', 92]);
});

test('final, the owner\'s where Mashov has none: "משוער" for a sitting ahead, "שלך" for one behind', () => {
  const g = EXAMS.find((e) => e.semel === 16582); // 21.1.2027, nothing in yet
  const ahead = one(g, { 16582: { exam: 90 } });
  assert.equal(ahead.future, true);
  assert.deepEqual(ahead.exam, { value: 90, origin: 'estimate' });
  // The owner's example: no הגשה, בגרות 90 → 90, "משוער".
  assert.deepEqual(ahead.final, { value: 90, estimated: true });
  assert.equal(b.gradeWord(ahead.exam.origin), 'משוער');
  // With a school grade typed too: by the split (50/50 here, not known).
  assert.deepEqual(one(g, { 16582: { school: 80, exam: 90 } }).final, { value: 85, estimated: true });
  // A school grade alone: nothing yet.
  assert.deepEqual(one(g, { 16582: { school: 80 } }).final, { value: null, estimated: false });
  // After the sitting, with still no grade in Mashov: the owner's, not an estimate.
  const behind = one(g, { 16582: { exam: 90 } }, {}, '2027-02-01');
  assert.equal(behind.future, false);
  assert.deepEqual(behind.exam, { value: 90, origin: 'own' });
  assert.deepEqual(behind.final, { value: 90, estimated: false });
  assert.equal(b.gradeWord('own'), 'שלך');
});

test('final, the split: the owner sets it once — over the table, or where it is not known', () => {
  // No final from Mashov, so the split decides.
  const own = one(sitting(16471, { schoolGrade: 90, examGrade: 79 }), {}, { english: { shares: { 16471: 30 } } });
  assert.deepEqual([own.share, own.shareOrigin], [30, 'own']);
  assert.deepEqual(own.final, { value: 82, estimated: false }); // 27 + 55.3
  const over = one(sitting(1261, { schoolGrade: 88, examGrade: 74 }), {}, { bible: { shares: { 1261: 30 } } });
  assert.deepEqual([over.share, over.shareOrigin, over.final.value], [30, 'override', 78]);
  // 0: the exam alone.
  assert.equal(one(sitting(1261, { schoolGrade: 88, examGrade: 74 }), {}, { bible: { shares: { 1261: 0 } } }).final.value, 74);
});

// ── From Mashov to subjects ─────────────────────────────────────────────────

test('cleanName and matchSubject: the method dropped, gershayim, the longest table name that leads', () => {
  assert.equal(b.cleanName('תנ"ך - כללי (הערכה חיצונית)'), 'תנ״ך - כללי');
  assert.equal(b.cleanName("מדעי המחשב-חלופת הע' (הערכה חלופית)"), 'מדעי המחשב-חלופת הע׳');
  assert.equal(b.matchSubject('מתמטיקה - שאלון אחר (הערכה חיצונית)', CATALOG), 'math');
  assert.equal(b.matchSubject('תנ"ך כללי (הערכה חלופית)', CATALOG), 'bible');
  assert.equal(b.matchSubject('ערבית (הערכה חיצונית)', CATALOG), null);
});

test('buildSubjects: two sittings are one questionnaire, with the better one\'s grades in its fields', () => {
  const list = subjects();
  const hebrew = list.find((s) => s.questionnaires.some((x) => x.semel === 11261));
  const h = q(hebrew, 11261);
  assert.deepEqual(h.sittings.map((s) => s.moed), ['2026-06', '2026-08']);
  assert.equal(h.sitting.moed, '2026-08');
  assert.deepEqual([h.school.value, h.exam.value, h.final.value], [74, 95, 81]);
  assert.equal(q(subject(list, 'history'), 22225).final.value, 79);
});

test('buildSubjects: a sitting to come shows its date under the code; the subject waits for it', () => {
  const english = subject(subjects(), 'english');
  const g = q(english, 16582);
  assert.equal(g.status, 'open');
  assert.equal(g.next.examDate, '2027-01-21');
  assert.equal(b.upcomingDate(g, TODAY), '21.1.2027');
  assert.equal(b.sittingWhen(g.next), '21.1.2027 14:00');
  assert.equal(b.upcomingDate(q(english, 16471), TODAY), null);
  assert.deepEqual(english.final, { kind: 'open', ids: ['16582', '16586'] });
  assert.equal(b.subjectGap(english), null);
});

test('buildSubjects: "subject incomplete" (a level code nobody lists) apart from a code the table does not know', () => {
  const list = subjects();
  const math = subject(list, 'math');
  assert.equal(math.units, 5);
  assert.equal(math.unitsOrigin, 'table');
  assert.deepEqual(math.questionnaires.map((x) => [x.id, x.status, x.future]), [['35571', 'graded', false], ['35572', 'missing', true]]);
  assert.equal(math.final.kind, 'open');

  // A code the table does not know: its own subject, no units, no weight.
  const cs = list.find((s) => s.questionnaires.some((x) => x.semel === 899271));
  assert.equal(cs.key, 'code:899271');
  assert.equal(cs.known, false);
  assert.equal(cs.units, null);
  assert.equal(q(cs, 899271).weight, null);
  assert.equal(cs.final.kind, 'unknown');
  assert.equal(b.partsText(b.subjectGap(cs)), 'חסר יח״ל');
});

test('buildSubjects: one code in several levels waits for the units; tracks that share nothing else leave nothing missing', () => {
  const levels = { 3: [[35571]], 4: [[35571, 35472]], 5: [[35571, 35572]] };
  const catalog = {
    subjects: { ...CATALOG.subjects, math: { ...CATALOG.subjects.math, levels } },
    entries: { ...CATALOG.entries, 35571: entry(35571, 'math', { 3: 100, 4: 65, 5: 60 }, { schoolShare: 50 }), 35472: entry(35472, 'math', { 4: 35 }) },
  };
  const build = (prefs) => b.buildSubjects(EXAMS, prefs, catalog, TODAY);
  const math = subject(build(b.EMPTY_PREFS), 'math');
  assert.equal(math.units, null);
  assert.equal(q(math, 35571).weight, null);
  assert.equal(b.partsText(b.subjectGap(math)), 'חסר יח״ל');
  // The owner says 4: the 4-unit weight, and the 4-unit partner is missing. The table could not say, so it is the owner's.
  const four = subject(build(prefsOf({ subjects: { math: { units: 4 } } })), 'math');
  assert.equal(four.unitsOrigin, 'own');
  assert.deepEqual(four.questionnaires.map((x) => [x.id, x.weight, x.status]), [['35472', 35, 'missing'], ['35571', 65, 'graded']]);
  // 3: 35571 is the whole subject (Mashov's final, 100).
  const three = subject(build(prefsOf({ subjects: { math: { units: 3 } } })), 'math');
  assert.deepEqual(three.final, { kind: 'ok', value: 100, estimated: false });

  // Physics with only mechanics: three tracks, nothing all of them need besides it.
  assert.deepEqual(b.missingCodes([36361], 5, CATALOG, 'physics'), []);
  assert.deepEqual(b.missingCodes([36361, 36371], 5, CATALOG, 'physics'), []);
  assert.deepEqual(b.missingCodes([36361, 36371, 36386], 5, CATALOG, 'physics'), [36283]);
  assert.deepEqual(b.missingCodes([36361, 36351], 5, CATALOG, 'physics'), [36356, 36283]);
  const physics = subject(b.buildSubjects(EXAMS.filter((e) => e.semel === 36361), b.EMPTY_PREFS, CATALOG, TODAY), 'physics');
  assert.equal(physics.units, 5);
  assert.deepEqual(physics.final, { kind: 'weights', total: 30 });
});

test('buildSubjects: what the table says does not count goes last, out of the average', () => {
  const list = subjects();
  const traffic = subject(list, 'traffic');
  assert.equal(traffic.excluded, true);
  assert.equal(traffic.excludedOrigin, 'table');
  assert.equal(list[list.length - 1].key, 'traffic');
  assert.equal(b.partsText(b.subjectGap(traffic)), 'לא נספר בממוצע');
});

test('buildSubjects: the bible pair — 70% the exam (Mashov\'s final), 30% school-assessed', () => {
  const bible = subject(subjects(), 'bible');
  assert.equal(bible.units, 2);
  assert.deepEqual(
    bible.questionnaires.map((x) => [x.id, x.final.value, x.weight, x.weightOrigin, x.share]),
    [['1261', 95, 70, 'table', 50], ['1263', 100, 30, 'table', 100]],
  );
  // 0.7 × 95 + 0.3 × 100 = 96.5 → 97
  assert.deepEqual(bible.final, { kind: 'ok', value: 97, estimated: false });
  assert.equal(b.subjectGap(bible), null);
  assert.equal(b.tableChanges(bible), null);
  assert.deepEqual(b.changedGrades(bible), []);
});

// ── The owner's entries ─────────────────────────────────────────────────────

test('overrides: units, weights (0 takes one out), the whole subject — each wins over the table', () => {
  const prefs = prefsOf({
    subjects: {
      'code:899271': { units: 5, weights: { 899271: 100 } },
      bible: { weights: { 1261: 60, 1263: 40 } },
      history: { units: 2, weights: { 22221: 20, 22225: 80, 22222: 0 } },
      traffic: { excluded: false, units: 1, weights: { 700181: 100 } },
    },
  });
  const list = subjects(prefs);
  const cs = subject(list, 'code:899271');
  assert.equal(cs.units, 5);
  assert.equal(cs.unitsOrigin, 'own');
  assert.deepEqual(cs.final, { kind: 'ok', value: 67, estimated: false }); // Mashov's final: no split known

  const bible = subject(list, 'bible');
  assert.equal(q(bible, 1261).weightOrigin, 'override');
  assert.deepEqual(bible.final, { kind: 'ok', value: 97, estimated: false }); // 57 + 40
  assert.deepEqual(b.tableChanges(bible), { units: false, excluded: false, weights: ['1261', '1263'], shares: [] });

  const history = subject(list, 'history');
  assert.equal(q(history, 22222).counts, false);
  // 0.2 × 81 (school-assessed by Mashov, and Mashov's final) + 0.8 × 79 = 79.4
  assert.deepEqual(history.final, { kind: 'ok', value: 79, estimated: false });

  const traffic = subject(list, 'traffic');
  assert.equal(traffic.excluded, false);
  assert.equal(traffic.excludedOrigin, 'override');
  assert.deepEqual(traffic.final, { kind: 'ok', value: 8, estimated: false });
  assert.equal(b.tableChanges(traffic).excluded, true);
});

test('subjectFinal: weights that do not add up say by how much; a missing one says so in two words', () => {
  const bible = subject(subjects(prefsOf({ subjects: { bible: { weights: { 1261: 70, 1263: 20 } } } })), 'bible');
  assert.deepEqual(bible.final, { kind: 'weights', total: 90 });
  assert.equal(b.partsText(b.subjectGap(bible)), 'המשקלים: 90% מ־100%');
  const withUnits = subject(subjects(prefsOf({ subjects: { history: { units: 2 } } })), 'history');
  assert.deepEqual(withUnits.final, { kind: 'unknown', ids: ['22221', '22222', '22225'] });
  assert.equal(b.partsText(b.subjectGap(withUnits)), 'חסר משקל');
});

test('estimates: open questionnaires take them, and the grade they make says so; a graded one is overridden', () => {
  const prefs = prefsOf({ grades: { 16582: { exam: 90 }, 16586: { exam: 80 }, 1261: { exam: 50 } } });
  const list = subjects(prefs);
  const english = subject(list, 'english');
  // 0.3 × 88 + 0.5 × 90 + 0.2 × 80 = 87.4
  assert.deepEqual(english.final, { kind: 'ok', value: 87, estimated: true });
  const bible = subject(list, 'bible');
  assert.deepEqual(q(bible, 1261).exam, { value: 50, origin: 'override' });
  assert.equal(q(bible, 1261).final.value, 69); // (88 + 50) / 2
  assert.deepEqual(b.changedGrades(bible), [{ id: '1261', field: 'exam' }]);
  assert.deepEqual(b.estimatedGrades(list), [{ id: '16582', field: 'exam' }, { id: '16586', field: 'exam' }]);
});

test('estimates: with a school grade in and a known split, the estimate is the exam; without one it stands alone', () => {
  const exams = [
    ...EXAMS.filter((e) => e.semel !== 35571),
    { ...EXAMS.find((e) => e.semel === 35571), examGrade: null, finalGrade: null, schoolGrade: 90, examDate: '2027-01-10' },
  ];
  const math = subject(subjects(prefsOf({ grades: { 35571: { exam: 70 }, 35572: { exam: 80 } } }), exams), 'math');
  const m = q(math, 35571);
  assert.equal(m.status, 'open');
  assert.deepEqual(m.school, { value: 90, origin: 'mashov' });
  assert.deepEqual(m.final, { value: 80, estimated: true }); // 0.5 × 90 + 0.5 × 70
  assert.deepEqual(q(math, 35572).final, { value: 80, estimated: true });
  assert.deepEqual(math.final, { kind: 'ok', value: 80, estimated: true });
});

// ── Subjects and questionnaires the owner adds ──────────────────────────────

/** A subject the owner named, as the store keeps it. */
const theatre = (units = 2, grades = { x1: { school: 90, exam: 80 } }) => prefsOf({
  added: { 'own:תיאטרון': { name: 'תיאטרון' } },
  rows: { 'own:תיאטרון': [{ id: 'x1', name: 'עבודה' }] },
  subjects: { 'own:תיאטרון': { units, weights: { x1: 100 }, shares: { x1: 30 } } },
  grades,
});

test('an added subject: shown like the others, "הוספת", its rows the owner\'s and its grades "משוער"', () => {
  const list = subjects(theatre());
  const t = subject(list, 'own:תיאטרון');
  assert.equal(t.name, 'תיאטרון');
  assert.equal(t.added, true);
  assert.equal(b.ORIGIN_WORD.added, 'הוספת');
  assert.deepEqual([t.units, t.unitsOrigin], [2, 'own']);
  const row = q(t, 'x1');
  assert.deepEqual([row.label, row.semel, row.status, row.future, row.added], ['עבודה', null, 'added', true, true]);
  assert.deepEqual([row.weight, row.weightOrigin, row.share, row.shareOrigin], [100, 'own', 30, 'own']);
  assert.equal(row.exam.origin, 'estimate');
  assert.deepEqual(t.final, { kind: 'ok', value: 83, estimated: true }); // 27 + 56
  // Shown after Mashov's subjects, before the ones out of the average.
  assert.equal(list.findIndex((s) => s.key === 'own:תיאטרון'), list.findIndex((s) => s.excluded) - 1);
  // Nothing typed yet: no grade, and the subject waits.
  assert.equal(subject(subjects(theatre(2, {})), 'own:תיאטרון').final.kind, 'open');
});

test('averages with an added subject: plain, out of how many units, "משוער", and an institution\'s', () => {
  const list = subjects(theatre(5));
  const plain = b.plainAverage(list);
  // bible 97 × 2 + theatre 83 × 5; math and english are still open.
  assert.equal(plain.value, (97 * 2 + 83 * 5) / 7);
  assert.equal(plain.estimated, true);
  assert.equal(b.partsText(b.averageUnitsParts(plain)), '7 מתוך 22 יח״ל');
  const weighted = b.weightedAverage(list, RULES);
  assert.equal(weighted.value, (97 * 2 + 103 * 5) / 7); // 5 units of anything: +20
  // An override is the owner's grade, not a guess: the average is not "משוער" for it.
  const overridden = b.plainAverage(subjects(prefsOf({ grades: { 1261: { exam: 50 } } })));
  assert.equal(overridden.estimated, false);
});

test('merge: a table subject the owner added, which Mashov lists later, is one subject with one row per code', () => {
  const prefs = prefsOf({
    added: { english: { name: 'אנגלית' } },
    rows: { english: [{ id: '16471', name: '' }, { id: '16582', name: '' }, { id: '16586', name: '' }] },
    subjects: { english: { units: 5 } },
    grades: { 16582: { exam: 90 } },
  });
  // Before Mashov lists it.
  const before = subject(subjects(prefs, EXAMS.filter((e) => !String(e.semel).startsWith('165') && e.semel !== 16471)), 'english');
  assert.equal(before.added, true);
  assert.deepEqual(before.questionnaires.map((x) => [x.id, x.status]), [['16471', 'added'], ['16582', 'added'], ['16586', 'added']]);
  assert.deepEqual(before.questionnaires.map((x) => x.weight), [30, 50, 20]);
  // After: Mashov's rows, the owner's grade on top, nothing twice.
  const list = subjects(prefs);
  assert.equal(list.filter((s) => s.key === 'english').length, 1);
  const after = subject(list, 'english');
  assert.equal(after.added, false);
  assert.deepEqual(after.questionnaires.map((x) => [x.id, x.status, x.added]), [['16471', 'graded', false], ['16582', 'open', false], ['16586', 'open', false]]);
  assert.deepEqual(q(after, 16582).exam, { value: 90, origin: 'estimate' });
});

test('merge: a subject the owner named joins Mashov\'s when it appears, keeping the owner\'s entries', () => {
  const prefs = prefsOf({
    added: { 'own:ערבית': { name: 'ערבית' } },
    rows: { 'own:ערבית': [{ id: 'x1', name: 'בחינה' }] },
    subjects: { 'own:ערבית': { units: 3, weights: { x1: 100 } } },
    grades: { x1: { exam: 88 } },
  });
  assert.equal(subject(subjects(prefs), 'own:ערבית').added, true);
  const arabic = { ...sitting(12345), name: 'ערבית (הערכה חיצונית)', schoolGrade: 90, examGrade: 80 };
  const list = subjects(prefs, [...EXAMS, arabic]);
  assert.equal(list.some((s) => s.key === 'code:12345'), false);
  const merged = subject(list, 'own:ערבית');
  assert.equal(merged.added, false);
  assert.equal(merged.units, 3);
  assert.deepEqual(merged.questionnaires.map((x) => x.id), ['12345', 'x1']);
  assert.deepEqual(q(merged, 'x1').exam.value, 88);
  // A name that only begins the same is another subject.
  const other = { ...arabic, semel: 12346, naturalKey: 'bagrut|12346|2026-06', name: 'ערביתית (הערכה חיצונית)' };
  assert.equal(subjects(prefs, [...EXAMS, other]).some((s) => s.key === 'code:12346'), true);
});

test('merge: a code the owner added with "+ שאלון" that Mashov lists later is Mashov\'s row', () => {
  const prefs = prefsOf({ rows: { english: [{ id: '16583', name: '' }, { id: 'x1', name: 'עבודה' }] } });
  const english = subject(subjects(prefs), 'english');
  assert.deepEqual(english.questionnaires.map((x) => [x.id, x.added]), [['16471', false], ['16582', false], ['16583', true], ['16586', false], ['x1', true]]);
  const listed = [...EXAMS, { ...sitting(16583), name: 'אנגלית - F (הערכה חיצונית)', examDate: '2027-02-15', moed: '2027-01', naturalKey: 'bagrut|16583|2027-01' }];
  const later = subject(subjects(prefs, listed), 'english');
  assert.deepEqual(later.questionnaires.map((x) => [x.id, x.added]), [['16471', false], ['16582', false], ['16583', false], ['16586', false], ['x1', true]]);
  // A row of the owner's in a subject that is gone is not shown.
  assert.equal(subjects(prefsOf({ rows: { nothing: [{ id: 'x1', name: 'a' }] } })).some((s) => s.key === 'nothing'), false);
});

test('adding: the key for a name, the table\'s subjects that can be added, and their levels', () => {
  assert.equal(b.subjectKeyFor('ערבית', REAL), 'arabic');
  assert.equal(b.subjectKeyFor(' תנך ', REAL), 'bible');
  assert.equal(b.subjectKeyFor('היסטוריה של האמנות', REAL), 'own:היסטוריה של האמנות');
  const addable = b.addableSubjects(REAL, new Set(['math', 'english']));
  const ids = addable.map((s) => s.id);
  for (const id of ['chemistry', 'physics', 'geography', 'arabic', 'cs']) assert.ok(ids.includes(id), id);
  for (const id of ['math', 'english', 'general', 'traffic', 'science_intro']) assert.ok(!ids.includes(id), id);
  assert.deepEqual(b.subjectLevels(REAL, 'math').map((l) => [l.units, l.sets]), [[3, [[35571]]], [4, [[35571, 35472]]], [5, [[35571, 35572]]]]);
  assert.equal(b.subjectLevels(REAL, 'chemistry')[0].sets.length, 4);
  assert.deepEqual(b.subjectLevels(REAL, 'arabic'), []);
});

// ── Averages ────────────────────────────────────────────────────────────────

/** A subject as `buildSubjects` makes it, for the averages alone. */
function made(key, units, value, extra = {}) {
  return {
    key, name: key, units, unitsOrigin: 'table', excluded: false, excludedOrigin: null, questionnaires: [],
    final: value === null ? { kind: 'open', ids: ['1'] } : { kind: 'ok', value, estimated: false }, known: true, added: false, ...extra,
  };
}

test('plainAverage: by units, over the subjects with both a grade and units, and says out of how many', () => {
  const avg = b.plainAverage([made('math', 5, 90), made('english', 5, 80), made('bible', 2, 100), made('history', 2, null), made('x', null, 70)]);
  assert.equal(avg.value, (450 + 400 + 200) / 12);
  assert.equal(avg.units, 12);
  assert.equal(avg.totalUnits, 14);
  assert.equal(avg.missing, 2);
  assert.equal(avg.estimated, false);
  assert.equal(b.partsText(b.averageUnitsParts(avg)), '12 מתוך 14 יח״ל');
  assert.equal(b.partsText(b.averageUnitsParts(b.plainAverage([made('math', 5, 90)]))), '5 יח״ל');
});

test('plainAverage: partial units weigh as they are; excluded and estimated subjects', () => {
  const avg = b.plainAverage([
    made('a', 1.5, 80), made('b', 0.5, 100),
    made('c', 2, 90, { final: { kind: 'ok', value: 90, estimated: true } }),
    made('d', 5, 10, { excluded: true }),
  ]);
  assert.equal(avg.value, (120 + 50 + 180) / 4);
  assert.equal(avg.units, 4);
  assert.equal(avg.totalUnits, 4);
  assert.equal(avg.estimated, true);
  assert.equal(b.plainAverage([]).value, null);
});

test('bonusFor and weightedAverage: the first matching rule, nothing under the minimum, the cap on the average', () => {
  assert.equal(b.bonusFor('math', 5, 90, RULES), 30);
  assert.equal(b.bonusFor('english', 5, 90, RULES), 20);
  assert.equal(b.bonusFor('math', 4, 90, RULES), 10);
  assert.equal(b.bonusFor('bible', 2, 90, RULES), 0);
  assert.equal(b.bonusFor('math', 5, 59, RULES), 0);
  assert.equal(b.bonusFor('math', 5, 60, RULES), 30);
  assert.equal(b.bonusFor('math', 5, 60, { ...RULES, minGradeExclusive: true }), 0);
  assert.equal(b.bonusFor('math', 5, 61, { ...RULES, minGradeExclusive: true }), 30);
  assert.equal(b.bonusFor('math', 4, 90, { ...RULES, bonuses: [{ subjects: ['math'], units: 4, bonus: null }] }), null);
  const avg = b.weightedAverage([made('math', 5, 90), made('english', 4, 55), made('bible', 2, 100)], RULES);
  assert.equal(avg.value, (120 * 5 + 55 * 4 + 100 * 2) / 11);
  assert.equal(b.weightedAverage([made('math', 5, 100)], { ...RULES, averageCap: 119 }).value, 119);
  // A bonus the institution does not state: the subject stays out, and says so.
  const unknown = b.weightedAverage([made('math', 4, 90), made('bible', 2, 100)], { ...RULES, bonuses: [{ subjects: ['math'], units: 4, bonus: null }] });
  assert.equal(unknown.value, 100);
  assert.equal(unknown.missing, 1);
});

test('weightedAverage: compulsory subjects always, electives only when they raise it, at least the minimum units', () => {
  const rules = { ...RULES, compulsory: ['math', 'english'], minUnits: 12 };
  const list = [made('math', 5, 90), made('english', 5, 80), made('bible', 2, 70), made('physics', 5, 95), made('art', 1, 100)];
  // math 120, english 100: 10 units, short of 12. Physics (115) raises it; art (100) and bible (70) would lower it.
  const avg = b.weightedAverage(list, rules);
  assert.equal(avg.value, (600 + 500 + 575) / 15);
  assert.equal(avg.units, 15);
  // Short of the minimum even with everything: everything is in.
  assert.equal(b.weightedAverage(list, { ...rules, minUnits: 40 }).units, 18);
  // A unit factor weighs a subject more (the Technion's math).
  const doubled = b.weightedAverage([made('math', 5, 90), made('english', 5, 80)], { ...RULES, unitFactor: { math: 2 } });
  assert.equal(doubled.value, (120 * 10 + 100 * 5) / 15);
  assert.equal(doubled.units, 10);
});

test('comboApplies: math, and two sciences or a science and a technology subject, all at their level', () => {
  const rules = { ...RULES, combo: { mathUnits: 5, sciences: ['physics', 'chemistry', 'biology'], technology: ['cs'], units: 5, bonus: 30 } };
  const s = (key, units) => ({ key, units });
  assert.equal(b.comboApplies([s('math', 5), s('physics', 5), s('cs', 5)], rules), true);
  assert.equal(b.comboApplies([s('math', 5), s('physics', 5), s('chemistry', 5)], rules), true);
  assert.equal(b.comboApplies([s('math', 5), s('cs', 5)], rules), false);
  assert.equal(b.comboApplies([s('math', 4), s('physics', 5), s('cs', 5)], rules), false);
  assert.equal(b.comboApplies([s('math', 5), s('physics', 5), s('cs', 3)], rules), false);
  assert.equal(b.comboApplies([s('math', 5), s('physics', 5), s('cs', 5)], RULES), false);
  assert.equal(b.bonusFor('physics', 5, 84, rules, true), 30);
  assert.equal(b.bonusFor('physics', 5, 84, rules, false), 20);
});

// ── How much do I need ──────────────────────────────────────────────────────

test('requiredExamGrade: one open questionnaire — the lowest grade that really reaches the subject target', () => {
  const math = subject(subjects(), 'math'); // 35571: 100 (Mashov's final) at 60%, 35572 missing at 40%
  const need = b.requiredExamGrade(90, { kind: 'subject', key: 'math' }, [math]);
  // 60 + 0.4x ≥ 89.5 (rounded) → x ≥ 73.75 → 74
  assert.deepEqual(need, { kind: 'need', grade: 74, labels: ['35572'], exam: false });
  assert.equal(b.partsText(b.needParts(need)), 'צריך לפחות 74 בשאלון 35572');
  assert.deepEqual(b.needParts(need), ['צריך לפחות ', { ltr: '74' }, ' בשאלון ', { ltr: '35572' }]);
  // 73 would round to 89.
  const check = (x) => b.subjectFinal(math.questionnaires, x);
  assert.deepEqual(check(73), { kind: 'ok', value: 89, estimated: true });
  assert.deepEqual(check(74), { kind: 'ok', value: 90, estimated: true });
});

test('requiredExamGrade: reached, impossible, and nothing to work from', () => {
  const list = subjects();
  const math = subject(list, 'math');
  assert.deepEqual(b.requiredExamGrade(53, { kind: 'subject', key: 'math' }, [math]), { kind: 'reached' });
  assert.deepEqual(b.requiredExamGrade(101, { kind: 'subject', key: 'math' }, [math]), { kind: 'impossible', best: 100 });
  // Out of reach: how high one can get, not "impossible" (run 7: Noa read it as harsh).
  assert.equal(b.partsText(b.needParts({ kind: 'impossible', best: 91 })), 'הכי גבוה שאפשר: 91');
  assert.equal(b.partsText(b.needParts({ kind: 'impossible', best: 88.1 })), 'הכי גבוה שאפשר: 88.1');
  assert.deepEqual(b.needParts({ kind: 'impossible', best: 88.1 }), ['הכי גבוה שאפשר: ', { ltr: '88.1' }]);
  // Everything graded: the grade as it is.
  const bible = subject(list, 'bible');
  assert.deepEqual(b.requiredExamGrade(80, { kind: 'subject', key: 'bible' }, [bible]), { kind: 'reached' });
  assert.deepEqual(b.requiredExamGrade(98, { kind: 'subject', key: 'bible' }, [bible]), { kind: 'impossible', best: 97 });
  // No units or weights: nothing to work from.
  assert.deepEqual(b.requiredExamGrade(90, { kind: 'subject', key: 'history' }, list), { kind: 'unknown' });
  assert.equal(b.partsText(b.needParts({ kind: 'unknown' })), 'חסרים יח״ל או משקל כדי לחשב');
});

test('requiredExamGrade: several open questionnaires get one grade alike; the average goal', () => {
  const list = subjects();
  const need = b.requiredExamGrade(95, { kind: 'subject', key: 'english' }, list);
  // 26.4 + 0.7x ≥ 94.5 → x ≥ 97.29 → 98
  assert.deepEqual(need, { kind: 'need', grade: 98, labels: ['16582', '16586'], exam: false });
  assert.equal(b.partsText(b.needParts(need)), 'צריך לפחות 98 בכל 2 השאלונים הפתוחים');

  // The average: bible 97 (2), math open (5), english open (5); history, the unknown codes and the excluded stay out.
  const avgNeed = b.requiredExamGrade(90, { kind: 'plain' }, list);
  assert.equal(avgNeed.kind, 'need');
  assert.deepEqual(avgNeed.labels, ['16582', '16586', '35572']);
  const at = (x) => b.plainAverage(list.map((s) => ({ ...s, final: b.subjectFinal(s.questionnaires, x) }))).value;
  assert.ok(at(avgNeed.grade) >= 90);
  assert.ok(at(avgNeed.grade - 1) < 90);
  // 100 everywhere: (97 × 2 + 100 × 5 + 96 × 5) / 12 ≈ 97.83.
  assert.deepEqual(b.requiredExamGrade(98, { kind: 'plain' }, list), { kind: 'impossible', best: (194 + 500 + 480) / 12 });

  // The institution's average, with its bonus.
  const wNeed = b.requiredExamGrade(110, { kind: 'weighted', rules: RULES }, list);
  assert.equal(wNeed.kind, 'need');
  const wAt = (x) => b.weightedAverage(list.map((s) => ({ ...s, final: b.subjectFinal(s.questionnaires, x) })), RULES).value;
  assert.ok(wAt(wNeed.grade) >= 110);
  assert.ok(wAt(wNeed.grade - 1) < 110);
});

test('requiredExamGrade: the answer shrinks to the rows still empty or "משוער" — not a grade the owner says they have', () => {
  const after = '2027-01-25'; // G is behind, COBE still ahead
  const estimate = subject(subjects(prefsOf({ grades: { 16582: { exam: 85 } } })), 'english');
  assert.deepEqual(b.requiredExamGrade(85, { kind: 'subject', key: 'english' }, [estimate]).labels, ['16582', '16586']);
  const own = subject(subjects(prefsOf({ grades: { 16582: { exam: 85 } } }), EXAMS, after), 'english');
  assert.equal(q(own, 16582).exam.origin, 'own');
  // 26.4 + 42.5 + 0.2x ≥ 84.5 → x ≥ 78
  assert.deepEqual(b.requiredExamGrade(85, { kind: 'subject', key: 'english' }, [own]), { kind: 'need', grade: 78, labels: ['16586'], exam: false });
  // An added row the owner named is asked for by its name.
  const t = subject(subjects(theatre(2, {})), 'own:תיאטרון');
  const named = b.requiredExamGrade(90, { kind: 'subject', key: 'own:תיאטרון' }, [t]);
  assert.deepEqual(named, { kind: 'need', grade: 90, labels: ['עבודה'], exam: false });
  assert.equal(b.partsText(b.needParts(named)), 'צריך לפחות 90 בשאלון עבודה');
});

test('requiredExamGrade: an exam after a school grade says "בבחינה"', () => {
  const exams = [
    ...EXAMS.filter((e) => e.semel !== 35571),
    { ...EXAMS.find((e) => e.semel === 35571), examGrade: null, finalGrade: null, schoolGrade: 90, examDate: '2027-01-10' },
  ];
  const prefs = prefsOf({ subjects: { math: { weights: { 35571: 100, 35572: 0 } } } });
  const math = subject(subjects(prefs, exams), 'math');
  const need = b.requiredExamGrade(85, { kind: 'subject', key: 'math' }, [math]);
  // 0.5 × 90 + 0.5x ≥ 84.5 → x ≥ 79
  assert.deepEqual(need, { kind: 'need', grade: 79, labels: ['35571'], exam: true });
  assert.equal(b.partsText(b.needParts(need)), 'צריך לפחות 79 בבחינה בשאלון 35571');
});

// ── Words ───────────────────────────────────────────────────────────────────

test('formatAverage and sittingWhen', () => {
  assert.equal(b.formatAverage(96.4), '96.4');
  assert.equal(b.formatAverage(112.3456), '112.35');
  assert.equal(b.formatAverage(90), '90');
  assert.equal(b.sittingWhen(EXAMS.find((e) => e.semel === 16582)), '21.1.2027 14:00');
  assert.equal(b.sittingWhen(EXAMS.find((e) => e.semel === 700181)), null);
});

test('the table\'s first column: the code, with the catalog\'s short name for the English modules', () => {
  const english = subject(b.buildSubjects(EXAMS, b.EMPTY_PREFS, REAL, TODAY), 'english');
  assert.deepEqual(english.questionnaires.map((x) => [x.label, x.part]), [['16471', 'E'], ['16582', 'G'], ['16583', 'F'], ['16586', 'COBE']]);
  // F is school-assessed by the table: הגשה alone.
  assert.equal(q(english, 16583).share, 100);
});

// ── Run 7: a bagrut exam named for what it is (Noa) ────────────────────────────

test('bagrutExamTitle: the table names the module, not Mashov\'s "אנגלית-דבו\' והב\' הנש (הערכה חיצונית)"', () => {
  const name = (semel, moed = '2027-01') => b.bagrutExamTitle({ naturalKey: `bagrut|${semel}|${moed}` }, REAL);
  // The module after a comma (Wave 9 re-rate: no "·" in the app's words).
  assert.equal(name(16582), 'בגרות באנגלית, מודול G');
  assert.equal(name(16586), 'בגרות באנגלית, בעל פה (COBE)');
  assert.equal(name(16471, '2026-06'), 'בגרות באנגלית, מודול E');
  // Any other code the table knows: by its number, as the exam paper is.
  assert.equal(name(35571, '2026-06'), 'בגרות במתמטיקה, שאלון 35571');
  assert.equal(name(1261, '2026-06'), 'בגרות בתנ״ך, שאלון 1261');
  // Not a bagrut exam at all (the traffic theory test), a code the table does not know, a site exam: no new name.
  assert.equal(name(700181, '2025-05'), null);
  assert.equal(name(99999), null);
  assert.equal(b.bagrutExamTitle({ naturalKey: 'site-exam|1b33pcz' }, REAL), null);
  // The student's name for the subject stands for the subject's own; the part's title stays the table's.
  assert.equal(b.bagrutExamTitle({ naturalKey: 'bagrut|16582|2027-01' }, REAL, 'English'), 'בגרות בEnglish, מודול G');
  assert.equal(b.bagrutExamTitle({ naturalKey: 'bagrut|35571|2026-06' }, REAL, 'מתמטיקה שלי'), 'בגרות במתמטיקה שלי, שאלון 35571');
  assert.equal(b.bagrutExamTitle({ naturalKey: 'bagrut|99999|2027-01' }, REAL, 'English'), null);
  assert.equal(b.bagrutSemel('bagrut|16586|2027-01'), 16586);
  assert.equal(b.bagrutSemel('site-exam|1b33pcz'), null);
  // Every upcoming sitting in the capture gets a name with no Mashov suffix left in it.
  for (const e of EXAMS.filter((x) => x.examDate && x.examDate >= TODAY && x.method !== 'school')) {
    const title = b.bagrutExamTitle(e, REAL);
    assert.ok(title, `${e.semel} is named`);
    assert.doesNotMatch(title, /הערכה|\(.*חיצונית/, title);
  }
});

test('examNaming: a named bagrut exam drops the "בחינת בגרות" line and puts its hours on the date\'s line', () => {
  const g = { naturalKey: 'bagrut|16582|2027-01', subject: 'אנגלית', kind: 'bagrut', startTime: '14:00', endTime: '15:45' };
  assert.deepEqual(b.examNaming(g, REAL), { title: 'בגרות באנגלית, מודול G', kind: null, hours: '14:00–15:45' });
  // A code the table does not know keeps the subject and the line, with its hours there.
  const unknown = { ...g, naturalKey: 'bagrut|99999|2027-01' };
  assert.deepEqual(b.examNaming(unknown, REAL), { title: 'אנגלית', kind: { label: 'בחינת בגרות', time: '14:00–15:45' }, hours: null });
  // An exam from the grade's schedule: its title as the site wrote it, cleaned.
  const site = { naturalKey: 'site-exam|x', subject: "מבחן בגוש ב'" };
  assert.deepEqual(b.examNaming(site, REAL), { title: 'מבחן גוש ב׳', kind: null, hours: null });
});

test('the tab\'s words: one each — "ממשוב", "שינית", "משוער", "שלך", "הוספת" — and one line for a student with no bagrut yet', () => {
  // Alone under a grade, "משוב" read as "feedback" (Daniel, run 7).
  assert.deepEqual(b.ORIGIN_WORD, { mashov: 'ממשוב', table: 'טבלה', override: 'שינית', estimate: 'משוער', own: 'שלך', added: 'הוספת' });
  for (const word of Object.values(b.ORIGIN_WORD)) assert.equal(word.split(' ').length, 1, word);
  // A ninth-grader did not know when a bagrut comes (Maya): one sentence that says.
  assert.equal(b.NO_BAGRUT_YET, 'ציוני בגרות יופיעו כאן אחרי הבחינה הראשונה, בדרך כלל מכיתה י׳');
  assert.equal(b.NO_BAGRUT_YET.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length, 1);
  for (const line of [b.NO_BAGRUT_YET, b.partsText(b.needParts({ kind: 'impossible', best: 88.1 }))]) {
    assert.doesNotMatch(line, /לא אפשרי|סשן|שרת|סנכרון/, line);
  }
  // One mark for "nothing here", everywhere in the tab (plan §16): not a thin dash, a heavy one and a blank.
  assert.equal(b.EMPTY_MARK, '–');
  // A subject's card says what is missing in one short line, never a paragraph.
  const lines = subjects(prefsOf({ subjects: { bible: { weights: { 1261: 70, 1263: 20 } } } })).map(b.subjectGap).filter(Boolean).map(b.partsText);
  for (const line of lines) assert.ok(line.split(' ').length <= 4, line);
});
