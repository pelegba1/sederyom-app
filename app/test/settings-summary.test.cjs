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
const school = load('school.ts', { './format': format, './gradeWeights': gradeWeights });
const o = load('onboarding.ts', { './format': format, './school': school, './className': load('className.ts') });
const s = load('settingsSummary.ts', { './onboarding': o, './format': format });

test('notificationsSummary: the phone forbids them, in red, before anything else', () => {
  const base = { permission: 'off', vacation: true, shown: ['changes'], on: { changes: true }, quiet: { enabled: false, from: '22:00', to: '07:00' } };
  assert.deepEqual(s.notificationsSummary(base), { text: 'ההתראות כבויות בטלפון', tone: 'attention' });
});
test('notificationsSummary: vacation mode says so', () => {
  assert.deepEqual(s.notificationsSummary({ permission: 'granted', vacation: true, shown: ['changes'], on: { changes: true }, quiet: { enabled: false, from: '22:00', to: '07:00' } }),
    { text: 'מצב חופש פעיל', tone: 'muted' });
});
test('notificationsSummary: counts only the switches shown, and names quiet hours', () => {
  const r = s.notificationsSummary({ permission: 'granted', vacation: false, shown: ['changes', 'new_exam'], on: { changes: true, new_exam: true, new_grade: true }, quiet: { enabled: true, from: '22:00', to: '07:00' } });
  assert.equal(r.text, '2 סוגים פעילים, שעות שקטות מ־22:00 עד 07:00');
});
test('notificationsSummary: one, none, and quiet hours that start when they end', () => {
  const q = { enabled: true, from: '22:00', to: '22:00' };
  assert.equal(s.notificationsSummary({ permission: 'granted', vacation: false, shown: ['changes'], on: { changes: true }, quiet: q }).text, 'סוג אחד פעיל');
  assert.equal(s.notificationsSummary({ permission: 'granted', vacation: false, shown: ['changes'], on: {}, quiet: q }).text, 'כל הסוגים כבויים');
});
test('notificationsSummary: while the phone is still answering, no red', () => {
  assert.equal(s.notificationsSummary({ permission: 'checking', vacation: false, shown: ['changes'], on: { changes: true }, quiet: { enabled: false, from: '22:00', to: '07:00' } }).tone, 'muted');
});
test('meSummary: the class for a student, the child shown for a parent', () => {
  assert.equal(s.meSummary({ parent: false, className: 'יא3', shownChild: null }), 'י״א 3');
  assert.equal(s.meSummary({ parent: false, className: '', shownChild: null }), 'עוד לא נבחרה כיתה');
  assert.equal(s.meSummary({ parent: true, className: 'יא3', shownChild: 'נועה' }), 'נועה');
  assert.equal(s.meSummary({ parent: true, className: 'יא3', shownChild: null }), 'י״א 3');
});
test('shownChildName: a parent with a list says the shown child, with one child the name kept for it', () => {
  // With a list, the list's name for the shown child (the class's, until the child is named).
  assert.equal(s.shownChildName({ parent: true, listName: 'נועה', onlyName: '' }), 'נועה');
  assert.equal(s.shownChildName({ parent: true, listName: 'י״א 3', onlyName: '' }), 'י״א 3');
  // The list wins over a name left on the phone's lone key.
  assert.equal(s.shownChildName({ parent: true, listName: 'נועה', onlyName: 'יואב' }), 'נועה');
  // No list: the only child's name, trimmed.
  assert.equal(s.shownChildName({ parent: true, listName: null, onlyName: 'נועה' }), 'נועה');
  assert.equal(s.shownChildName({ parent: true, listName: null, onlyName: '  נועה ' }), 'נועה');
});
test('shownChildName: nothing to say when the child has no name, and a student has no children', () => {
  assert.equal(s.shownChildName({ parent: true, listName: null, onlyName: '' }), null);
  assert.equal(s.shownChildName({ parent: true, listName: null, onlyName: '   ' }), null);
  assert.equal(s.shownChildName({ parent: false, listName: null, onlyName: 'נועה' }), null);
  assert.equal(s.shownChildName({ parent: false, listName: 'נועה', onlyName: 'נועה' }), null);
});
test('shownChildName in meSummary: a parent of one child sees the name, else the class, as today', () => {
  const shown = (input) => s.meSummary({ parent: input.parent, className: 'יא3', shownChild: s.shownChildName(input) });
  assert.equal(shown({ parent: true, listName: null, onlyName: 'נועה' }), 'נועה');
  assert.equal(shown({ parent: true, listName: null, onlyName: '' }), 'י״א 3');
  assert.equal(shown({ parent: true, listName: 'יואב', onlyName: '' }), 'יואב');
  assert.equal(shown({ parent: false, listName: null, onlyName: 'נועה' }), 'י״א 3');
  // No class and no name: the page's own words.
  assert.equal(s.meSummary({ parent: true, className: '', shownChild: s.shownChildName({ parent: true, listName: null, onlyName: '' }) }), 'עוד לא נבחרה כיתה');
});
test('googleSummary', () => {
  assert.equal(s.googleSummary({ connected: false, examsToCalendar: true, calendarsShown: 3, hasCalendars: true }), 'לא מחובר');
  assert.equal(s.googleSummary({ connected: true, examsToCalendar: true, calendarsShown: 3, hasCalendars: true }), 'המבחנים ביומן, 3 יומנים מוצגים');
  assert.equal(s.googleSummary({ connected: true, examsToCalendar: false, calendarsShown: 1, hasCalendars: true }), 'המבחנים לא ביומן, יומן אחד מוצג');
  // Calendars not read yet: the same words as the Google page's row, not "אף יומן לא מוצג".
  assert.equal(s.googleSummary({ connected: true, examsToCalendar: true, calendarsShown: 0, hasCalendars: false }), 'המבחנים ביומן, עוד אין יומנים');
});
test('shownSummary: the same words as the rows behind it', () => {
  assert.equal(s.shownSummary({ subjects: 8, hasSubjects: true, exams: 2, hasExams: true }), '8 מקצועות שלך מוצגים, 2 מבחנים מסומנים כשלך');
  assert.equal(s.shownSummary({ subjects: 0, hasSubjects: false, exams: 0, hasExams: false }), 'עוד אין מבחנים');
});
test('appearanceSummary', () => {
  assert.equal(s.appearanceSummary('לפי הטלפון', 'רגיל'), 'לפי הטלפון, טקסט רגיל');
});
test('no summary line breaks a copy rule', () => {
  for (const t of Object.values(o.SETTINGS_PAGE_TITLES)) assert.doesNotMatch(t, /·|לכיתה|הכיתה/);
  assert.equal(o.mePageTitle(true), 'אני והילדים');
  assert.equal(o.mePageTitle(false), 'אני ובית הספר');
});
