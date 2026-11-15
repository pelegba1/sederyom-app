const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

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
const c = load('subjectColors.ts', { './format': format, '../theme': {} });
const subjects = ['מתמטיקה 5 יח"ל (יב2)', 'אזרחות', 'אזרחות (יב2)', 'פיזיקה מורחב (מעבדת פיסיקה)', 'אנגלית 5 יח"ל (יב3)', 'היסטוריה'];

/** Settings' lines (`SubjectOption`): a key, a name and a lesson count. */
const line = (name, count, key = name) => ({ key, name, count });

test('subject colours: one key per subject, the same colour on every screen (W6-F)', () => {
  assert.equal(c.subjectColorKey('אזרחות (יב2)'), c.subjectColorKey('אזרחות'));
  const civics = c.subjectColor('אזרחות (יב2)', subjects, 'light');
  assert.equal(c.subjectColor('אזרחות', subjects, 'light'), civics, 'both published names share a colour');
  assert.equal(c.subjectColor('אזרחות', [...subjects].reverse(), 'light'), civics, 'the list order does not matter');
  assert.ok(c.SUBJECT_COLORS.light.includes(civics));
  assert.ok(c.SUBJECT_COLORS.dark.includes(c.subjectColor('אזרחות', subjects, 'dark')));
  // With counts too: the order of the lines does not matter.
  const lines = [line('מתמטיקה', 6), line('אנגלית', 5), line('היסטוריה', 2), line('אזרחות', 2)];
  for (const name of ['מתמטיקה', 'אנגלית', 'היסטוריה', 'אזרחות']) {
    assert.equal(c.subjectColor(name, lines, 'light'), c.subjectColor(name, [...lines].reverse(), 'light'), name);
  }
});

test('subject colours: seven hues, slots 1–7 of the categorical palette, red left out (plan §16.1)', () => {
  for (const scheme of ['light', 'dark']) {
    assert.equal(c.SUBJECT_COLORS[scheme].length, 7, scheme);
    assert.equal(new Set(c.SUBJECT_COLORS[scheme]).size, 7, scheme);
  }
  assert.deepEqual(c.SUBJECT_COLORS.light, ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']);
  assert.deepEqual(c.SUBJECT_COLORS.dark, ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']);
  // No red: it means "בוטל" here.
  for (const hex of [...c.SUBJECT_COLORS.light, ...c.SUBJECT_COLORS.dark]) assert.ok(!['#e34948', '#e66767'].includes(hex), hex);
});

test('subject colours: seven subjects, seven colours; the most taught come first', () => {
  const lines = [
    line('מתמטיקה 5 יח"ל (יב2)', 6), line('אנגלית 5 יח"ל (יב3)', 5), line('פיזיקה מורחב (מעבדת פיסיקה)', 5),
    line('היסטוריה', 3), line('אזרחות', 2), line('אזרחות (יב2)', 1), line('ספרות', 2), line('חינוך גופני', 2), line('תנ"ך', 1),
  ];
  const order = c.subjectOrder(lines);
  // A subject's lines add up: אזרחות has 3, as many as היסטוריה and ahead of those with 2. Ties go by name.
  assert.deepEqual(order, ['מתמטיקה', 'אנגלית', 'פיזיקה', 'אזרחות', 'היסטוריה', 'חינוך גופני', 'ספרות', 'תנ"ך']);
  const colours = order.slice(0, 7).map((s) => c.subjectColor(s, lines, 'light'));
  assert.equal(new Set(colours).size, 7, 'the seven most taught never share');
  assert.deepEqual(colours, c.SUBJECT_COLORS.light);
  // The eighth wraps to the first colour; an unknown subject still gets one.
  assert.equal(c.subjectColor('תנ"ך', lines, 'light'), c.SUBJECT_COLORS.light[0]);
  assert.ok(c.SUBJECT_COLORS.light.includes(c.subjectColor('ביולוגיה', lines, 'light')));
});

test('subject colours: a hidden subject takes no colour; a subject with one line hidden keeps its colour', () => {
  const lines = [
    line('מתמטיקה', 6), line('אנגלית', 5), line('פיזיקה', 5), line('היסטוריה', 3), line('אזרחות', 3),
    line('ספרות', 2), line('לשון', 2), line('מוזיקה', 9, 'מוזיקה @ מורה'),
    line('ערבית', 4, 'ערבית @ א'), line('ערבית', 1, 'ערבית @ ב'),
  ];
  const hidden = ['מוזיקה @ מורה', 'ערבית @ א'];
  const order = c.subjectOrder(lines, hidden);
  assert.ok(!order.includes('מוזיקה'), 'hidden: not in the order');
  // ערבית keeps its other line, with that line's count only.
  assert.deepEqual(order, ['מתמטיקה', 'אנגלית', 'פיזיקה', 'אזרחות', 'היסטוריה', 'לשון', 'ספרות', 'ערבית']);
  // Without the hidden one, which had the most lessons, the seven shown subjects take all seven colours.
  const shown = order.slice(0, 7).map((s) => c.subjectColor(s, lines, 'light', hidden));
  assert.equal(new Set(shown).size, 7);
  // Nothing hidden: מוזיקה would have taken the first colour.
  assert.equal(c.subjectOrder(lines)[0], 'מוזיקה');
});

test('subject colours: a subject the list lacks takes a colour the list left free', () => {
  const lines = [line('מתמטיקה', 6), line('אנגלית', 5), line('פיזיקה', 4)];
  const used = ['מתמטיקה', 'אנגלית', 'פיזיקה'].map((s) => c.subjectColor(s, lines, 'dark'));
  for (const stranger of ['ביולוגיה', 'כימיה', 'גיאוגרפיה', 'אמנות']) {
    const colour = c.subjectColor(stranger, lines, 'dark');
    assert.ok(c.SUBJECT_COLORS.dark.includes(colour), stranger);
    assert.ok(!used.includes(colour), `${stranger} shares ${colour}`);
    assert.equal(c.subjectColor(stranger, [...lines].reverse(), 'dark'), colour, 'the same on every screen');
  }
  // No list yet (settings still loading): every subject still gets a palette colour.
  assert.ok(c.SUBJECT_COLORS.light.includes(c.subjectColor('מתמטיקה', [], 'light')));
});

// ---------------------------------------------------------------------------
// Run 8 (Noa: hiding "שרותי רשת" recoloured the week): a subject keeps its colour
// ---------------------------------------------------------------------------

test('run 8: hiding a subject leaves every other subject its colour, and its own waits for it', () => {
  const lines = [
    line('שרותי רשת (מעבדת מחשבים 1)', 8), line('מתמטיקה', 6), line('אנגלית', 5), line('פיזיקה', 5),
    line('היסטוריה', 3), line('אזרחות', 3), line('חינוך', 1),
  ];
  const hidden = ['שרותי רשת (מעבדת מחשבים 1)'];
  // The first time: handed out by the order, seven subjects and seven colours, as before.
  const stored = c.assignSubjectSlots(c.subjectOrder(lines), {});
  const names = ['שרותי רשת', 'מתמטיקה', 'אנגלית', 'פיזיקה', 'אזרחות', 'היסטוריה', 'חינוך'];
  const before = names.map((s) => c.subjectColor(s, lines, 'light', [], stored));
  assert.deepEqual(before, c.SUBJECT_COLORS.light);
  // Hidden: nothing new to save, and every other subject keeps its colour, in both schemes.
  assert.equal(c.assignSubjectSlots(c.subjectOrder(lines, hidden), stored), stored);
  for (const [i, s] of names.entries()) {
    if (i === 0) continue;
    assert.equal(c.subjectColor(s, lines, 'light', hidden, stored), before[i], s);
    assert.equal(c.subjectColor(s, lines, 'dark', hidden, stored), c.SUBJECT_COLORS.dark[i], s);
  }
  // The order alone moved them all (the bug): מתמטיקה took the first colour.
  assert.equal(c.subjectColor('מתמטיקה', lines, 'light', hidden), c.SUBJECT_COLORS.light[0]);
  // Shown again, it has its own colour back.
  assert.equal(c.subjectColor('שרותי רשת', lines, 'light', [], stored), before[0]);
});

test('run 8: a hidden subject keeps its slot reserved; a new subject takes the first free one', () => {
  const lines = [line('מתמטיקה', 6), line('אנגלית', 5), line('פיזיקה', 4)];
  const stored = c.assignSubjectSlots(c.subjectOrder(lines), {});
  assert.deepEqual(stored, { 'מתמטיקה': 0, 'אנגלית': 1, 'פיזיקה': 2 });
  // אנגלית hidden, and two new subjects arrive, the more taught first: they skip אנגלית's slot.
  const more = [...lines, line('כימיה', 2), line('ביולוגיה', 3)];
  const next = c.assignSubjectSlots(c.subjectOrder(more, ['אנגלית']), stored);
  assert.notEqual(next, stored);
  assert.deepEqual(next, { 'מתמטיקה': 0, 'אנגלית': 1, 'פיזיקה': 2, 'ביולוגיה': 3, 'כימיה': 4 });
  // Stored slots are never moved or dropped.
  assert.equal(c.assignSubjectSlots(c.subjectOrder(more), next), next);
});

test('run 8: a stored mapping wins over a fresh order', () => {
  const lines = [line('מתמטיקה', 6), line('אזרחות', 1)];
  // Fresh, מתמטיקה would take the first colour; אזרחות has had it.
  assert.equal(c.subjectColor('מתמטיקה', lines, 'light'), c.SUBJECT_COLORS.light[0]);
  const stored = { 'אזרחות': 0 };
  assert.equal(c.subjectColor('אזרחות', lines, 'light', [], stored), c.SUBJECT_COLORS.light[0]);
  assert.equal(c.subjectColor('אזרחות (יב2)', lines, 'light', [], stored), c.SUBJECT_COLORS.light[0], 'by its key');
  assert.equal(c.subjectColor('מתמטיקה', lines, 'light', [], stored), c.SUBJECT_COLORS.light[1]);
  // Seven held: an eighth subject shares, the next one round, and keeps that too.
  const seven = Object.fromEntries(['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז'].map((k, i) => [k, i]));
  assert.equal(c.assignSubjectSlots(['ח'], seven)['ח'], 0);
  // A subject no list names takes a colour no stored subject holds.
  assert.equal(c.subjectColor('ביולוגיה', [], 'light', [], { 'מתמטיקה': 0, 'אנגלית': 1 }) === c.SUBJECT_COLORS.light[0], false);
});

test('run 8: the stored mapping reads back safely, and a new class starts afresh', () => {
  assert.deepEqual(c.parseSubjectSlots(JSON.stringify({ classId: 'c1', slots: { 'מתמטיקה': 0, 'אנגלית': 6 } })),
    { classId: 'c1', slots: { 'מתמטיקה': 0, 'אנגלית': 6 } });
  // Broken or out of range: left out, never a crash.
  assert.deepEqual(c.parseSubjectSlots(JSON.stringify({ classId: 3, slots: { 'א': 7, 'ב': -1, 'ג': 1.5, 'ד': '2', 'ה': 2 } })),
    { classId: null, slots: { 'ה': 2 } });
  for (const raw of [undefined, null, '', 'not json', '[]', '{"slots":[1]}']) {
    assert.deepEqual(c.parseSubjectSlots(raw), { classId: null, slots: {} }, String(raw));
  }
  const stored = { classId: 'c1', slots: { 'מתמטיקה': 0 } };
  assert.deepEqual(c.slotsForClass(stored, 'c1'), { 'מתמטיקה': 0 });
  assert.deepEqual(c.slotsForClass(stored, null), { 'מתמטיקה': 0 }, 'the class not known yet');
  assert.deepEqual(c.slotsForClass({ classId: null, slots: { 'מתמטיקה': 0 } }, 'c1'), { 'מתמטיקה': 0 });
  assert.deepEqual(c.slotsForClass(stored, 'c2'), {});
});
