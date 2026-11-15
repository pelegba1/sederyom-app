const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

/**
 * app/scripts/copy-tells.cjs (plan §16.2) on fixture sources: each rule
 * fires on the habit it names and stays quiet on its look-alikes. The run
 * over the whole app is copy-tells.test.cjs.
 */
const tells = require('../scripts/copy-tells.cjs');

/** The rules `scan` finds in a one-file source, as `line rule` pairs. */
const found = (code, file = 'fixture.tsx') => tells.scan(code, file).map((f) => `${f.line} ${f.rule}`);

test('tick: a tick character in any string, quoted, templated or JSX text', () => {
  assert.deepEqual(found("const a = 'סודר ✓';"), ['1 tick']);
  assert.deepEqual(found('const a = `נוסף ${n} ✔`;'), ['1 tick']);
  assert.deepEqual(found('const a = <Text>התחברנו מחדש ✓</Text>;'), ['1 tick']);
  assert.deepEqual(found("const a = 'סודר';"), []);
});

test('dash: a long dash between words of a Hebrew sentence, not elsewhere', () => {
  assert.deepEqual(found("const a = 'סומן כבוצע — רק אצלך';"), ['1 dash']);
  assert.deepEqual(found('const a = `${n} יישארו — אפשר לבדוק`;'), ['1 dash']);
  // No Hebrew in the string: not a Hebrew sentence.
  assert.deepEqual(found("const a = 'Mashov — Google';"), []);
  // A range's dash, and a dash glued to a word, are not the sentence dash.
  assert.deepEqual(found("const a = 'שיעורים 1–3';"), []);
  assert.deepEqual(found("const a = 'מבחן—אנגלית';"), []);
});

test('dots: any middle dot in a string, a template counted whole (Wave 9 re-rate: not even one)', () => {
  assert.deepEqual(found("const a = '2 ציונים · האחרון: מבחן · Classroom';"), ['1 dots']);
  assert.deepEqual(found('const a = `${x} · ${y} · ${z}`;'), ['1 dots']);
  assert.deepEqual(found("const a = 'הושלמה · לבטל';"), ['1 dots']);
  assert.deepEqual(found("const a = parts.join(' · ');"), ['1 dots']);
  assert.deepEqual(found('const a = <Text>פיזיקה · Classroom</Text>;'), ['1 dots']);
  // A comma is the way: no finding.
  assert.deepEqual(found("const a = 'פיזיקה, Classroom';"), []);
});

test('an object\'s key is a name, not copy: a width table may hold "·"', () => {
  assert.deepEqual(found("const widths = { '·': 253, 'א': 573 };"), []);
  assert.deepEqual(found("const widths = { ['·']: 253 };"), []);
  // Its value is still a string like any other.
  assert.deepEqual(found("const labels = { dot: 'א · ב' };"), ['1 dots']);
});

test('quotes: geresh or ASCII quotes around Hebrew words; abbreviations and gershayim pass', () => {
  assert.deepEqual(found("const a = 'הכפתור ׳עשיתי׳ מסמן';"), ['1 quotes']);
  assert.deepEqual(found('const a = \'לוחצים על "לבטל" כדי\';'), ['1 quotes']);
  assert.deepEqual(found("const a = 'לוחצים על “לבטל” כדי';"), ['1 quotes']);
  // The right marks, and the same characters inside words.
  assert.deepEqual(found("const a = 'הכפתור ״עשיתי״ מסמן';"), []);
  assert.deepEqual(found("const a = 'מתמ׳, אנג׳, פיז׳';"), []);
  assert.deepEqual(found("const a = 'יום ג׳, 20.10';"), []);
  assert.deepEqual(found('const a = \'מתמטיקה 5 יח"ל ותנ"ך\';'), []);
});

test('comments and regular expressions are not strings', () => {
  const code = [
    '// סודר ✓ — בדיקה · א · ב',
    '/* "שלום" */',
    "const re = /[׳'\"״]+$/;",
    "const ok = 'בסדר';",
  ].join('\n');
  assert.deepEqual(found(code), []);
  assert.deepEqual(found(code, 'fixture.ts'), []);
});

test('a .ts file parses without JSX (a cast is not a tag), and lines are reported', () => {
  const code = "const a = <string>b;\nconst c = 'סודר ✓';\n";
  assert.deepEqual(found(code, 'fixture.ts'), ['2 tick']);
});

test('the script prints file:line, the rule and the text, and exits 1 on a finding, 0 on none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-tells-'));
  const bad = path.join(dir, 'bad.tsx');
  const good = path.join(dir, 'good.tsx');
  fs.writeFileSync(bad, "export const a = 'נוסף למשימות ✓';\n");
  fs.writeFileSync(good, "export const a = 'נוסף למשימות';\n");
  const script = path.join(__dirname, '../scripts/copy-tells.cjs');
  try {
    assert.equal(execFileSync(process.execPath, [script, good], { encoding: 'utf8' }), '');
    let out = '';
    let status = 0;
    try {
      execFileSync(process.execPath, [script, good, bad], { encoding: 'utf8' });
    } catch (e) {
      out = e.stdout;
      status = e.status;
    }
    assert.equal(status, 1);
    assert.equal(out.trim(), `${bad}:1  tick  נוסף למשימות ✓`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
