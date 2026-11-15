const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a module of app/src/lib through Babel; its type-only imports vanish on the way. */
function load(file) {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
  return module.exports;
}

const c = load('classroom.ts');

const TODAY = '2026-10-08'; // a Thursday
const LRI = String.fromCharCode(0x2066);

const work = (naturalKey, dueDate, over = {}) => ({
  naturalKey, courseId: 'c1', courseName: 'יב3 - היסטוריה', subject: 'היסטוריה', title: `מטלה ${naturalKey}`, description: null,
  dueDate, dueTime: dueDate ? '23:59' : null, link: `https://classroom.google.com/${naturalKey}`, state: 'CREATED', late: false,
  grade: null, maxPoints: null, updatedAt: '2026-10-01T08:00:00.000Z', ...over,
});
const keys = (list) => list.map((w) => w.naturalKey);
const none = new Set();

test('where work stands: "הוגש" is Classroom\'s and wins, "עשיתי" is the phone\'s', () => {
  assert.equal(c.classroomStatus(work('a', null, { state: 'TURNED_IN' }), none), 'handedIn');
  assert.equal(c.classroomStatus(work('a', null, { state: 'RETURNED' }), new Set(['a'])), 'handedIn');
  assert.equal(c.classroomStatus(work('a', null, { state: 'RECLAIMED_BY_STUDENT' }), new Set(['a'])), 'doneHere');
  assert.equal(c.classroomStatus(work('a', null, { state: null }), none), 'open');
  assert.equal(c.statusWord('handedIn'), 'הוגש');
  assert.equal(c.statusWord('doneHere'), 'עשיתי');
  assert.equal(c.statusWord('open'), 'עשיתי');
  assert.equal(c.isClassroomDone(work('a', null), new Set(['a'])), true);
  assert.equal(c.isClassroomDone(work('a', null), none), false);
});

test('the status filters, search and order, as for the tasks and the homework', () => {
  const list = [
    work('undated', null),
    work('next-week', '2026-10-15'),
    work('tomorrow', '2026-10-09'),
    work('late', '2026-10-05'),
    work('today-late-hour', TODAY, { dueTime: '23:59' }),
    work('today-early-hour', TODAY, { dueTime: '08:00' }),
    work('handed-in', '2026-10-09', { state: 'TURNED_IN' }),
    work('marked', '2026-10-09'),
  ];
  const done = new Set(['marked']);
  const pick = (filter, more = {}) => keys(c.selectClassroom(list, { today: TODAY, filter, search: '', done, ...more }));

  assert.deepEqual(pick('open'), ['late', 'today-early-hour', 'today-late-hour', 'tomorrow', 'next-week', 'undated']);
  assert.deepEqual(pick('today'), ['today-early-hour', 'today-late-hour']);
  assert.deepEqual(pick('tomorrow'), ['tomorrow']);
  assert.deepEqual(pick('overdue'), ['late']);
  assert.deepEqual(pick('completed'), ['handed-in', 'marked']);
  // Marked a moment ago: it stays where it was, under its own filter.
  assert.deepEqual(pick('tomorrow', { keep: new Set(['marked']) }), ['marked', 'tomorrow']);
  // Search reads the title, the course, the subject and the description.
  assert.deepEqual(pick('open', { search: 'next-week' }), ['next-week']);
  assert.deepEqual(keys(c.selectClassroom([work('x', null, { courseName: 'Physics 12', subject: null })], { today: TODAY, filter: 'open', search: 'physics', done: none })), ['x']);
  assert.deepEqual(keys(c.selectClassroom([work('x', null, { description: 'פרק שלישי' })], { today: TODAY, filter: 'open', search: 'שלישי', done: none })), ['x']);
});

test('the year\'s old work stays in Classroom: late by more than two weeks, or undated and untouched for a month', () => {
  assert.equal(c.LATE_WINDOW_DAYS, 14);
  assert.equal(c.UNDATED_WINDOW_DAYS, 30);
  assert.equal(c.isRecent(work('a', '2026-09-24'), TODAY), true);
  assert.equal(c.isRecent(work('a', '2026-09-23'), TODAY), false);
  assert.equal(c.isRecent(work('a', null, { updatedAt: '2026-09-08T10:00:00Z' }), TODAY), true);
  assert.equal(c.isRecent(work('a', null, { updatedAt: '2026-09-07T10:00:00Z' }), TODAY), false);
  const list = [work('old', '2026-09-01'), work('old-undated', null, { updatedAt: '2026-06-01T00:00:00Z' }), work('fresh', '2026-10-01')];
  assert.deepEqual(keys(c.selectClassroom(list, { today: TODAY, filter: 'overdue', search: '', done: none })), ['fresh']);
  assert.deepEqual(keys(c.selectClassroom(list, { today: TODAY, filter: 'open', search: '', done: none })), ['fresh']);
});

const task = (id, due) => ({ kind: 'task', task: { id, due } });
const hw = (naturalKey, dueDate) => ({ kind: 'homework', homework: { naturalKey, dueDate } });
const ids = (entries) => entries.map((e) => (e.kind === 'task' ? `t:${e.task.id}` : e.kind === 'homework' ? `h:${e.homework.naturalKey}` : `c:${e.work.naturalKey}`));

test('Classroom work sits among the tasks and the homework by due date; undated, it comes last', () => {
  const entries = [hw('late', '2026-10-06'), task('a', '2026-10-09'), hw('fri', '2026-10-09'), task('d', '2026-10-12'), hw('none', null), task('b', null)];
  const classroom = [work('early', '2026-10-05'), work('fri', '2026-10-09'), work('sun', '2026-10-11'), work('undated', null)];
  assert.deepEqual(ids(c.withClassroom(entries, classroom, 'open')), [
    'c:early', 'h:late', 'c:fri', 't:a', 'h:fri', 'c:sun', 't:d', 'h:none', 't:b', 'c:undated',
  ]);
  assert.deepEqual(ids(c.withClassroom([], classroom, 'open')), ['c:early', 'c:fri', 'c:sun', 'c:undated']);
  assert.deepEqual(ids(c.withClassroom(entries, [], 'open')), ids(entries));
  // "הושלמו": after everything else, as the homework is.
  assert.deepEqual(ids(c.withClassroom([task('x', '2026-10-01')], [work('y', '2026-09-30')], 'completed')), ['t:x', 'c:y']);
});

test('"בלי תאריך" separates the undated rows from the dated ones, and only then', () => {
  const dated = { kind: 'classroom', work: work('a', TODAY) };
  const undated = { kind: 'classroom', work: work('b', null) };
  assert.equal(c.undatedHeadingAt([dated, task('t', null), undated], 'open'), 1);
  assert.equal(c.undatedHeadingAt([dated, hw('h', '2026-10-09')], 'open'), -1);
  // Undated rows alone: a heading would say nothing.
  assert.equal(c.undatedHeadingAt([undated, task('t', null)], 'open'), -1);
  assert.equal(c.undatedHeadingAt([dated, undated], 'completed'), -1);
  assert.equal(c.UNDATED_HEADING, 'בלי תאריך');
  assert.equal(c.CLASSROOM_TAG, 'Classroom');
});

test('the due line: homework\'s words, with the hour on the day and the next when it is not the end of the day', () => {
  const line = (dueDate, dueTime, done) => c.dueText(c.classroomDueParts({ dueDate, dueTime }, TODAY, done));
  assert.equal(line(TODAY, '14:00'), 'להגשה היום עד 14:00');
  assert.equal(line(TODAY, '23:59'), 'להגשה היום');
  assert.equal(line(TODAY, null), 'להגשה היום');
  assert.equal(line('2026-10-09', '08:30'), 'להגשה מחר עד 08:30');
  assert.equal(line('2026-10-15', '08:30'), 'להגשה עד יום חמישי 15.10');
  assert.equal(line('2026-10-06', '23:59'), 'להגשה ב־6.10, באיחור');
  assert.equal(line('2026-10-06', '23:59', true), 'להגשה ב־6.10');
  assert.equal(line(null, null), 'בלי תאריך הגשה');
  // Times and dates are the `ltr` runs; "באיחור" is in the warning tone.
  const late = c.classroomDueParts({ dueDate: '2026-10-06', dueTime: null }, TODAY);
  assert.deepEqual(late.filter((p) => p.ltr).map((p) => p.text), ['6.10']);
  assert.equal(late.at(-1).tone, 'alert');
  assert.deepEqual(c.classroomDueParts({ dueDate: TODAY, dueTime: '14:00' }, TODAY).filter((p) => p.ltr).map((p) => p.text), ['14:00']);
  // Across a month boundary.
  assert.equal(c.dueText(c.classroomDueParts({ dueDate: '2026-11-01', dueTime: '10:00' }, '2026-10-31')), 'להגשה מחר עד 10:00');
  assert.ok(!line(TODAY, '14:00').includes(LRI), 'the screen wraps the ltr runs itself');
});

test('the header counts open Classroom work, and what of it is late', () => {
  const list = [work('late', '2026-10-06'), work('today', TODAY), work('in', TODAY, { state: 'TURNED_IN' }), work('marked', '2026-10-05'), work('old', '2026-08-01')];
  assert.deepEqual(c.classroomCounts(list, TODAY, new Set(['marked'])), { open: 2, overdue: 1 });
  assert.deepEqual(c.classroomCounts([], TODAY, none), { open: 0, overdue: 0 });
});

test('the subject a row names: the timetable\'s, or the course\'s own', () => {
  assert.equal(c.workSubject({ subject: 'היסטוריה', courseName: 'יב3 - היסטוריה' }), 'היסטוריה');
  assert.equal(c.workSubject({ subject: null, courseName: 'Physics 12' }), 'Physics 12');
});

test('the marks on the phone: read safely, newest last, never more than the cap', () => {
  assert.deepEqual(c.parseDoneKeys(null), []);
  assert.deepEqual(c.parseDoneKeys('not json'), []);
  assert.deepEqual(c.parseDoneKeys('{"a":1}'), []);
  assert.deepEqual(c.parseDoneKeys('["a", 2, "b"]'), ['a', 'b']);
  assert.deepEqual(c.toggleDoneKey(['a', 'b'], 'a', true), ['b', 'a']);
  assert.deepEqual(c.toggleDoneKey(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(c.toggleDoneKey(['a'], 'z', false), ['a']);
  const many = Array.from({ length: c.MAX_DONE_KEYS }, (_v, i) => `k${i}`);
  const next = c.toggleDoneKey(many, 'new', true);
  assert.equal(next.length, c.MAX_DONE_KEYS);
  assert.equal(next[0], 'k1');
  assert.equal(next.at(-1), 'new');
});
