const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * The questionnaire table (plan §14.9): every code in the Mashov capture is
 * in it, every value has a source with a year, and a level's weights add up.
 *
 * `node test/bagrut-catalog.test.cjs --list` prints the table with its
 * sources, for the owner's approval before a release.
 */
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

const { CATALOG } = load(path.join(__dirname, '../src/lib/bagrutCatalog.ts'));
const b = load(path.join(__dirname, '../src/lib/bagrut.ts'));
const grades = require(path.join(__dirname, '../../server/test/fixtures/mashov-w7/bagrut-grades.json'));

const show = (v) => (v === null || v === undefined ? '—' : String(v));

function listing() {
  const rows = Object.values(CATALOG.entries).sort((a, b2) => a.subject.localeCompare(b2.subject) || a.semel - b2.semel);
  const lines = ['| code | subject | % of the subject, by units | counts | school share % | source | year | kind | note |', '|---|---|---|---|---|---|---|---|---|'];
  for (const e of rows) {
    const subject = CATALOG.subjects[e.subject]?.name ?? e.subject;
    const weights = Object.entries(e.weights).map(([u, w]) => `${u} u: ${show(w)}`).join(', ') || '—';
    const share = e.schoolShare === null ? '—' : `${e.schoolShare} (${e.shareSource.url}, ${e.shareSource.year})`;
    lines.push(`| ${e.semel} | ${subject} | ${weights} | ${e.counts ? 'yes' : 'no'} | ${share} | ${e.source?.url ?? 'NOT FOUND'} | ${e.source?.year ?? '—'} | ${e.source?.kind ?? '—'} | ${e.note ?? ''} |`);
  }
  lines.push('', '| subject | sets of codes, by units |', '|---|---|');
  for (const s of Object.values(CATALOG.subjects)) {
    const levels = Object.entries(s.levels).map(([u, sets]) => `${u}: ${sets.map((set) => set.join(' + ')).join(' / ')}`).join('; ');
    lines.push(`| ${s.name} | ${levels || '—'} |`);
  }
  return lines.join('\n');
}

if (process.argv.includes('--list')) {
  console.log(listing());
}

test('every code in the Mashov capture is in the table', () => {
  const codes = [...new Set(grades.map((g) => g.semel))].sort((x, y) => x - y);
  assert.ok(codes.length >= 25);
  assert.deepEqual(codes.filter((c) => !CATALOG.entries[c]), []);
});

test('every entry: a known subject, and a source with a year for any value it states', () => {
  for (const e of Object.values(CATALOG.entries)) {
    assert.equal(e.semel, Number(Object.keys(CATALOG.entries).find((k) => CATALOG.entries[k] === e)), `key of ${e.semel}`);
    assert.ok(CATALOG.subjects[e.subject], `${e.semel}: subject ${e.subject}`);
    const sourced = (src, what) => {
      assert.ok(src, `${e.semel}: ${what} with no source`);
      assert.match(src.url, /^https:\/\//, `${e.semel}: ${what} url`);
      assert.ok(src.year.length > 0, `${e.semel}: ${what} year`);
      assert.ok(src.kind === 'official' || src.kind === 'secondary', `${e.semel}: ${what} kind`);
    };
    if (Object.keys(e.weights).length > 0 || e.counts === false) sourced(e.source, 'weights');
    if (e.schoolShare !== null) {
      sourced(e.shareSource, 'school share');
      assert.ok(e.schoolShare >= 0 && e.schoolShare <= 100, `${e.semel}: school share`);
    }
    for (const [units, weight] of Object.entries(e.weights)) {
      assert.ok(Number(units) > 0 && Number(units) <= 10, `${e.semel}: units ${units}`);
      if (weight !== null) assert.ok(weight > 0 && weight <= 100, `${e.semel}: weight`);
    }
  }
});

test('a level lists codes of its own subject and units, and their weights add up to 100 where all are known', () => {
  for (const s of Object.values(CATALOG.subjects)) {
    assert.equal(CATALOG.subjects[s.id], s);
    for (const [units, sets] of Object.entries(s.levels)) {
      for (const codes of sets) {
        const entries = codes.map((c) => CATALOG.entries[c]);
        entries.forEach((e, i) => {
          assert.ok(e, `${s.id} ${units}: ${codes[i]} has no entry`);
          assert.equal(e.subject, s.id, `${codes[i]} is not ${s.id}`);
          assert.ok(units in e.weights, `${codes[i]} is not at ${units} units`);
        });
        const weights = entries.filter((e) => e.counts).map((e) => e.weights[units]);
        if (weights.every((w) => w !== null)) {
          assert.equal(weights.reduce((x, y) => x + y, 0), 100, `${s.id} ${units} ${codes.join('+')}: weights`);
        }
      }
    }
  }
});

test('school-assessed codes: in the table, with no exam split of their own, and their notes say so', () => {
  const { isSchoolAssessed } = load(path.join(__dirname, '../src/lib/bagrutCatalog.ts'));
  const listed = Object.values(CATALOG.entries).filter((e) => isSchoolAssessed(e.semel));
  assert.ok(listed.length >= 10);
  assert.equal(CATALOG.schoolAssessed.size, listed.length);
  for (const e of listed) {
    assert.equal(e.schoolShare, null, `${e.semel}`);
    assert.match(e.note ?? '', /school|teacher|internal/, `${e.semel}: ${e.note}`);
  }
  assert.equal(isSchoolAssessed(35571), false);
  assert.equal(isSchoolAssessed(1263, { subjects: {}, entries: {} }), false);
});

test('the capture through the real table: what is known adds up, nothing is made up', () => {
  const exams = grades.map((row) => ({
    naturalKey: `bagrut|${row.semel}|${row.moed}`, semel: row.semel, name: row.name,
    moed: `${String(row.moed).slice(0, 4)}-${String(row.moed).slice(4)}`,
    method: row.testMethodName === 'היבחנות חיצונית' ? 'external' : row.testMethodName === 'ציון בית ספרי' ? 'school' : null,
    schoolGrade: row.shnaty ?? null, examGrade: row.test ?? null, finalGrade: row.final ?? null,
    acceptedGrade: row.moeLastAcceptedGrade ?? null, registered: row.going === true, examDate: null, startTime: null, endTime: null,
  }));
  const subjects = b.buildSubjects(exams, b.EMPTY_PREFS, CATALOG, '2026-10-09');
  for (const s of subjects) {
    // A subject whose grade is worked out rests on weights from the table, each with a source.
    if (s.final.kind === 'ok') {
      for (const q of s.questionnaires.filter((x) => x.counts)) assert.ok(q.source, `${s.name}: ${q.semel} has no source`);
    }
  }
  // What the table says does not count stays out of the average.
  for (const e of Object.values(CATALOG.entries).filter((x) => !x.counts)) {
    const s = subjects.find((x) => x.questionnaires.some((q) => q.semel === e.semel));
    if (s && s.questionnaires.every((q) => !q.counts)) assert.equal(s.excluded, true, `${e.semel}`);
  }

  // Subject by subject (the grades are fake; the codes are the owner's).
  const by = (key) => subjects.find((s) => s.key === key);
  const missing = (key) => by(key).questionnaires.filter((q) => q.status === 'missing').map((q) => q.semel);
  for (const key of ['bible', 'literature', 'hebrew', 'cs']) assert.equal(by(key).final.kind, 'ok', key);
  // Incomplete: a code of the level Mashov does not list yet.
  assert.deepEqual(missing('english'), [16583]);
  assert.deepEqual(missing('history'), [22283]);
  assert.deepEqual(missing('civics'), [34271]);
  // 35571 alone is 3, 4 or 5 units: the owner says which.
  assert.equal(by('math').units, null);
  assert.equal(b.partsText(b.subjectGap(by('math'))), 'חסר יח״ל');
  // Mechanics fits three tracks: nothing listed as missing, and the weights say how far it is.
  assert.deepEqual(by('physics').final, { kind: 'weights', total: 30 });
  for (const key of ['science_intro', 'general', 'traffic']) assert.equal(by(key).excluded, true, key);
  // Nothing in the capture is unknown to the table.
  assert.deepEqual(subjects.filter((s) => !s.known).map((s) => s.key), []);
  assert.deepEqual(b.partsText(b.averageUnitsParts(b.plainAverage(subjects))), '11 מתוך 25 יח״ל');
});
