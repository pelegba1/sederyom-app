const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * The universities' bonus tables (plan §14.3): all six, each with its source
 * and year, each checked against the examples its own pages work out.
 *
 * `node test/bagrut-bonus.test.cjs --list` prints them with their sources,
 * for the owner's approval before a release.
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

const bonus = load(path.join(__dirname, '../src/lib/bagrutBonus.ts'));
const b = load(path.join(__dirname, '../src/lib/bagrut.ts'));
const { CATALOG } = load(path.join(__dirname, '../src/lib/bagrutCatalog.ts'));

const rulesOf = (id) => bonus.institution(id).rules;
const name = (s) => CATALOG.subjects[s]?.name ?? s;

function listing() {
  const lines = [];
  for (const inst of bonus.INSTITUTIONS) {
    const r = inst.rules;
    lines.push(`### ${inst.name} (${inst.short}) — ${inst.source.year}`, `source: ${inst.source.url}`);
    lines.push(`- bonus from grade ${r.minGradeExclusive ? '>' : '≥'} ${r.minGrade}; cap on the average: ${r.averageCap ?? 'none'}`);
    for (const rule of r.bonuses) {
      const who = rule.subjects === 'any' ? 'any subject' : rule.subjects.map(name).join(', ');
      lines.push(`- ${who}, ${rule.units}+ units: ${rule.bonus === null ? 'NOT FOUND' : `+${rule.bonus}`}`);
    }
    if (r.combo) {
      lines.push(`- combination: math ${r.combo.mathUnits}+ units and two of ${[...r.combo.sciences, ...r.combo.technology].map(name).join(', ')} at ${r.combo.units}+ (one a science): +${r.combo.bonus} each`);
    }
    if (r.unitFactor) lines.push(`- units counted: ${Object.entries(r.unitFactor).map(([s, f]) => `${name(s)} ×${f}`).join(', ')}`);
    lines.push(r.compulsory
      ? `- always in: ${r.compulsory.map(name).join(', ')}; the rest only when they raise it, at least ${r.minUnits} units`
      : '- every subject is in');
    for (const note of inst.notes) lines.push(`- note: ${note}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv.includes('--list')) {
  console.log(listing());
}

/** A subject as `buildSubjects` makes it, for the averages alone. */
function made(key, units, value) {
  return {
    key, name: key, units, unitsOrigin: 'table', excluded: false, excludedOrigin: null, questionnaires: [],
    final: { kind: 'ok', value, estimated: false }, overridden: false, known: true,
  };
}

test('all six institutions, in the order the plan lists them, each with a source and a year', () => {
  assert.deepEqual(bonus.INSTITUTIONS.map((i) => i.id), ['tau', 'huji', 'technion', 'bgu', 'biu', 'haifa']);
  for (const id of bonus.INSTITUTION_IDS) assert.equal(bonus.institution(id).id, id);
  assert.equal(bonus.institution(null), null);
  for (const inst of bonus.INSTITUTIONS) {
    assert.match(inst.source.url, /^https:\/\//, `${inst.id}: url`);
    assert.ok(inst.source.year.length > 0, `${inst.id}: year`);
  }
});

test('the bonuses name subjects the table knows', () => {
  for (const inst of bonus.INSTITUTIONS) {
    const r = inst.rules;
    const named = [...r.bonuses.flatMap((x) => (x.subjects === 'any' ? [] : x.subjects)), ...(r.compulsory ?? []), ...Object.keys(r.unitFactor ?? {})];
    if (r.combo) named.push(...r.combo.sciences, ...r.combo.technology);
    for (const s of named) assert.ok(CATALOG.subjects[s], `${inst.id}: unknown subject ${s}`);
  }
});

test('the rules are ordered so the first match is the right one: no rule hides a later one', () => {
  for (const inst of bonus.INSTITUTIONS) {
    const rules = inst.rules.bonuses;
    rules.forEach((r, i) => {
      for (const later of rules.slice(i + 1)) {
        const covers = r.subjects === 'any' || (later.subjects !== 'any' && later.subjects.every((s) => r.subjects.includes(s)));
        if (covers && later.units >= r.units) assert.fail(`${inst.id}: rule ${i} hides a later one`);
      }
    });
  }
});

// ── Each institution against its own pages ──────────────────────────────────

test('Technion: its worked example — 3657 / 34 = 107.6', () => {
  // admissions.technion.ac.il/summary-score-calculation-table/, every track but architecture.
  const certificate = [
    made('bible', 2, 76), made('hebrew', 2, 82), made('history', 2, 83), made('civics', 1, 75), made('literature', 2, 90),
    made('math', 5, 92), made('english', 5, 86),
    made('physics', 5, 84), // +30: the combination, with math and a technology subject
    made('cs', 5, 85), // the technology subject, +30
    made('chemistry', 3, 100), // left out: it lowers the average
    made('geography', 5, 78), // +20, left out
  ];
  const avg = b.weightedAverage(certificate, rulesOf('technion'));
  assert.equal(avg.value, 3657 / 34);
  assert.equal(b.formatAverage(avg.value), '107.56');
  assert.equal(avg.units, 29);
  // Without the technology subject there is no combination: physics is back to +25.
  assert.equal(b.bonusFor('physics', 5, 84, rulesOf('technion'), false), 25);
  // The cap.
  assert.equal(b.weightedAverage([made('math', 5, 100), made('english', 5, 100)], rulesOf('technion')).value, 119);
});

test('Tel Aviv: its worked example — all subjects 97.81, the best average 108.39', () => {
  // go.tau.ac.il/he/ba/how-to-calculate, "דוגמה לחישוב ממוצע אופטימאלי". The example is an
  // Arabic-sector certificate: Arabic at 5 units earns 25 and is compulsory, Hebrew is not.
  const tau = rulesOf('tau');
  const arabicSector = {
    ...tau,
    bonuses: [{ subjects: ['arabic'], units: 5, bonus: 25 }, ...tau.bonuses],
    compulsory: ['english', 'math', 'history', 'civics', 'arabic'],
  };
  const certificate = [
    made('english', 4, 93), // +12.5
    made('hebrew_ar', 3, 82), // left out
    made('arabic', 5, 91), // +25
    made('math', 5, 74), // +35
    made('biology', 5, 59), // under 60: no bonus, left out
    made('history', 2, 97),
    made('civics', 2, 86),
    made('arab_history', 1, 96), // left out
    made('chemistry', 5, 91), // +25
  ];
  assert.equal(b.formatAverage(b.weightedAverage(certificate, { ...arabicSector, compulsory: null }).value), '97.81');
  const best = b.weightedAverage(certificate, arabicSector);
  assert.equal(best.value, 2493 / 23);
  assert.equal(b.formatAverage(best.value), '108.39');
  assert.equal(best.units, 23);
});

test('Hebrew University: its example — English at 5 units, 85 + 25 = 110', () => {
  const huji = rulesOf('huji');
  assert.equal(85 + b.bonusFor('english', 5, 85, huji), 110);
  assert.equal(b.bonusFor('math', 5, 85, huji), 35);
  assert.equal(b.bonusFor('math', 4, 85, huji), 15);
  assert.equal(b.bonusFor('geography', 5, 85, huji), 20);
  assert.equal(b.bonusFor('geography', 3, 85, huji), 0);
  assert.equal(b.bonusFor('english', 5, 59, huji), 0);
});

test('Ben-Gurion: above 60, not at it; any subject at 4–5 units; a cap of 120', () => {
  const bgu = rulesOf('bgu');
  assert.equal(b.bonusFor('math', 5, 60, bgu), 0);
  assert.equal(b.bonusFor('math', 5, 61, bgu), 35);
  assert.equal(b.bonusFor('math', 4, 80, bgu), 20);
  assert.equal(b.bonusFor('english', 4, 80, bgu), 15);
  assert.equal(b.bonusFor('physics', 5, 80, bgu), 25);
  assert.equal(b.bonusFor('code:12345', 5, 80, bgu), 20);
  assert.equal(b.bonusFor('code:12345', 4, 80, bgu), 10);
  assert.equal(b.weightedAverage([made('math', 5, 100), made('english', 5, 100)], bgu).value, 120);
});

test("Bar-Ilan: the ידיעון's examples, from its 10-point scale", () => {
  const biu = rulesOf('biu');
  // "8 → 9", "9 → 11", "8 → 9.25", "9 → 11.50", "10 → 11.50", "10 → 13.50"
  assert.equal(80 + b.bonusFor('geography', 4, 80, biu), 90);
  assert.equal(90 + b.bonusFor('geography', 5, 90, biu), 110);
  assert.equal(80 + b.bonusFor('history', 4, 80, biu), 92.5);
  assert.equal(90 + b.bonusFor('history', 5, 90, biu), 115);
  assert.equal(100 + b.bonusFor('math', 4, 100, biu), 115);
  assert.equal(100 + b.bonusFor('math', 5, 100, biu), 135);
});

test("Haifa: the page's examples", () => {
  const haifa = rulesOf('haifa');
  assert.equal(80 + b.bonusFor('math', 4, 80, haifa), 100);
  assert.equal(80 + b.bonusFor('math', 5, 80, haifa), 115);
  assert.equal(80 + b.bonusFor('english', 4, 80, haifa), 100);
  assert.equal(80 + b.bonusFor('english', 5, 80, haifa), 105);
  assert.equal(70 + b.bonusFor('geography', 4, 70, haifa), 80);
  assert.equal(90 + b.bonusFor('geography', 5, 90, haifa), 110);
});

test('Tel Aviv: the table, and its minimum', () => {
  const tau = rulesOf('tau');
  assert.equal(b.bonusFor('math', 5, 80, tau), 35);
  assert.equal(b.bonusFor('math', 4, 80, tau), 12.5);
  assert.equal(b.bonusFor('english', 5, 80, tau), 25);
  assert.equal(b.bonusFor('english', 4, 80, tau), 12.5);
  assert.equal(b.bonusFor('cs', 5, 80, tau), 20);
  assert.equal(b.bonusFor('physics', 4, 80, tau), 10);
  assert.equal(b.bonusFor('math', 5, 60, tau), 35);
  assert.equal(b.bonusFor('math', 5, 59, tau), 0);
  // A subject on no list: no bonus.
  assert.equal(b.bonusFor('code:12345', 5, 80, tau), 0);
});
