const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a module of app/src/lib through Babel; its relative imports (planner → format) load the same way. */
function loadLib(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const { code } = transformFileSync(path.join(__dirname, '../src/lib', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(file, module);
  const requireLib = (id) => (id.startsWith('./') ? loadLib(`${id.slice(2)}.ts`, cache) : require(id));
  new Function('module', 'exports', 'require', code)(module, module.exports, requireLib);
  return module.exports;
}

const loadPlanner = () => loadLib('planner.ts');

test('month grid includes Saturdays and crosses year boundaries in complete Sunday-first weeks', () => {
  const p = loadPlanner();
  const dates = p.monthDates('2026-12-15');
  assert.equal(dates[0], '2026-11-29');
  assert.equal(dates.at(-1), '2027-01-02');
  assert.equal(dates.length % 7, 0);
  assert.ok(dates.includes('2026-12-05'));
  assert.equal(p.shiftMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(p.shiftMonth('2024-01-31', 1), '2024-02-29');
});

test('invalid calendar dates cannot be submitted as task deadlines', () => {
  const p = loadPlanner();
  for (const date of ['2026-02-30', '2026-13-01', '2026-2-01', '']) assert.equal(p.validDate(date), false);
  assert.equal(p.validDate('2024-02-29'), true);
});

test('task filters combine list, search, status and due date and put overdue work first', () => {
  const p = loadPlanner();
  const tasks = [
    { id: 'none', title: 'Math', listId: 'school', due: null, completed: false },
    { id: 'done', title: 'Math finished', listId: 'school', due: '2026-09-01', completed: true },
    { id: 'tomorrow', title: 'Math prep', listId: 'school', due: '2026-09-06', completed: false },
    { id: 'late', title: 'Math homework', listId: 'school', due: '2026-09-03', completed: false },
    { id: 'other', title: 'Math', listId: 'personal', due: '2026-09-05', completed: false },
  ];
  const opts = { today: '2026-09-05', filter: 'open', listId: 'school', search: 'math' };
  assert.deepEqual(p.selectTasks(tasks, opts).map(t => t.id), ['late', 'tomorrow', 'none']);
  assert.deepEqual(p.selectTasks(tasks, { ...opts, filter: 'tomorrow' }).map(t => t.id), ['tomorrow']);
  assert.deepEqual(p.selectTasks(tasks, { ...opts, filter: 'completed' }).map(t => t.id), ['done']);
  assert.equal(tasks[0].id, 'none');
});

test('"הושלמו" lists the most recently completed first, whatever the due date (B3)', () => {
  const p = loadPlanner();
  const tasks = [
    { id: 'old', title: 'א', listId: 'l', due: '2026-10-20', completed: true, updated: '2026-10-01T08:00:00.000Z' },
    { id: 'unknown', title: 'ב', listId: 'l', due: null, completed: true, updated: null },
    { id: 'newest', title: 'ג', listId: 'l', due: '2026-09-01', completed: true, updated: '2026-10-08T09:30:00.000Z' },
    { id: 'middle', title: 'ד', listId: 'l', due: null, completed: true, updated: '2026-10-05T17:00:00.000Z' },
    { id: 'open', title: 'ה', listId: 'l', due: '2026-10-08', completed: false, updated: '2026-10-08T10:00:00.000Z' },
  ];
  const opts = { today: '2026-10-08', filter: 'completed', listId: null, search: '' };
  assert.deepEqual(p.selectTasks(tasks, opts).map(t => t.id), ['newest', 'middle', 'old', 'unknown']);
  // Open work keeps its due-date order.
  assert.deepEqual(p.selectTasks(tasks, { ...opts, filter: 'open' }).map(t => t.id), ['open']);
});

test('the status filter and search apply to Mashov homework by due date (B11)', () => {
  const p = loadPlanner();
  const hw = (naturalKey, dueDate, extra = {}) => ({ naturalKey, dueDate, subject: 'אנגלית 5 יח״ל (יב2)', text: 'לקרוא', linkedTaskId: null, done: false, ...extra });
  const items = [
    hw('tomorrow', '2026-10-09'),
    hw('late', '2026-10-06'),
    hw('today', '2026-10-08', { subject: 'מתמטיקה', text: 'עמוד 12' }),
    hw('undated', null),
    hw('done', '2026-10-08', { done: true }),
    hw('linked', '2026-10-08', { linkedTaskId: 't1' }),
    hw('orphan', '2026-10-10', { linkedTaskId: 'deleted-task' }),
  ];
  const taskIds = new Set(['t1']);
  const opts = { today: '2026-10-08', filter: 'open', search: '', taskIds };
  const ids = (filter, more = {}) => p.selectHomework(items, { ...opts, filter, ...more }).map(h => h.naturalKey);

  assert.deepEqual(ids('open'), ['late', 'today', 'tomorrow', 'orphan', 'undated']);
  assert.deepEqual(ids('today'), ['today']);
  assert.deepEqual(ids('tomorrow'), ['tomorrow']);
  assert.deepEqual(ids('overdue'), ['late']);
  assert.deepEqual(ids('completed'), ['done']);
  assert.deepEqual(ids('open', { search: 'עמוד' }), ['today']);
  assert.deepEqual(ids('open', { search: 'מתמטיקה' }), ['today']);
  // Without the task list to check against, every link is trusted.
  assert.deepEqual(ids('open', { taskIds: null }), ['late', 'today', 'tomorrow', 'undated']);
});

test('a link to a deleted task does not hide the homework', () => {
  const p = loadPlanner();
  assert.equal(p.isLinkedToTask({ linkedTaskId: null }, new Set(['a'])), false);
  assert.equal(p.isLinkedToTask({ linkedTaskId: 'a' }, new Set(['a'])), true);
  assert.equal(p.isLinkedToTask({ linkedTaskId: 'gone' }, new Set(['a'])), false);
  assert.equal(p.isLinkedToTask({ linkedTaskId: 'gone' }, null), true);
});

test('"הוסף למשימות שלי" makes a short title from the subject without its group, into the given list (F16)', () => {
  const p = loadPlanner();
  const item = { naturalKey: 'hw1', subject: 'אנגלית 5 יח״ל (יב2)', text: 'לקרוא את הפרק השלישי', dueDate: '2026-10-09' };
  assert.deepEqual(p.homeworkTaskBody(item, 'school-list'), {
    title: 'אנגלית: לקרוא את הפרק השלישי',
    notes: null,
    due: '2026-10-09',
    fromHomeworkKey: 'hw1',
    listId: 'school-list',
  });
  // No "בית ספר" list: no listId, so the server uses the default one.
  assert.equal('listId' in p.homeworkTaskBody(item, null), false);
  assert.equal(p.homeworkTaskBody({ ...item, dueDate: null }, null).due, null);
});

test('a long or multi-line assignment is cut at a word in the title and kept whole in the notes', () => {
  const p = loadPlanner();
  const long = 'לקרוא את הפרק השלישי בספר ולענות על כל השאלות בעמודים 40 עד 45 כולל שאלות האתגר בסוף הפרק';
  const body = p.homeworkTaskBody({ naturalKey: 'k', subject: 'ספרות (יב3)', text: long, dueDate: null }, null);
  assert.ok(body.title.startsWith('ספרות: לקרוא את הפרק'));
  assert.ok(body.title.endsWith('…'));
  assert.ok(body.title.length <= 'ספרות: '.length + p.HOMEWORK_TITLE_MAX + 1);
  assert.ok(!body.title.includes(' …'), 'cut at a word, no space before the ellipsis');
  assert.equal(body.notes, long);

  const lines = p.homeworkTaskBody({ naturalKey: 'k', subject: 'פיזיקה מורחב', text: 'תרגיל 3\nלהגיש מודפס', dueDate: null }, null);
  assert.equal(lines.title, 'פיזיקה: תרגיל 3');
  assert.equal(lines.notes, 'תרגיל 3\nלהגיש מודפס');

  assert.equal(p.homeworkTaskBody({ naturalKey: 'k', subject: 'היסטוריה', text: '  ', dueDate: null }, null).title, 'היסטוריה');
});

test('the "בית ספר" list is found by its title, with or without the article', () => {
  const p = loadPlanner();
  assert.equal(p.schoolListId([{ id: 'a', title: 'המשימות שלי' }, { id: 'b', title: 'בית ספר' }]), 'b');
  assert.equal(p.schoolListId([{ id: 'a', title: 'המשימות שלי' }, { id: 'c', title: ' בית הספר ' }]), 'c');
  assert.equal(p.schoolListId([{ id: 'a', title: 'המשימות שלי' }, { id: 'd', title: 'בית ספר לנהיגה' }]), null);
  assert.equal(p.schoolListId([]), null);
});

test('editing a task selects the chip its due date belongs to (B9)', () => {
  const p = loadPlanner();
  const today = '2026-10-08'; // a Thursday
  assert.equal(p.dueChoiceFor('2026-10-08', today), 'today');
  assert.equal(p.dueChoiceFor('2026-10-09', today), 'tomorrow');
  assert.equal(p.dueChoiceFor('2026-10-11', today), 'nextSchoolDay');
  assert.equal(p.dueChoiceFor('2026-10-15', today), 'nextWeek');
  assert.equal(p.dueChoiceFor(null, today), 'none');
  assert.equal(p.dueChoiceFor(undefined, today), 'none');
  assert.equal(p.dueChoiceFor('2026-10-18', today), 'custom');
  assert.equal(p.dueChoiceFor('2026-10-07', today), 'custom');
  // Across a month boundary.
  assert.equal(p.dueChoiceFor('2026-11-01', '2026-10-31'), 'tomorrow');
  // On a Monday, next Wednesday has no chip of its own.
  assert.equal(p.dueChoiceFor('2026-10-07', '2026-10-05'), 'custom');
  assert.equal(p.dueChoiceFor('2026-10-12', '2026-10-05'), 'nextWeek');
});

test('run 8 (Noa): a new task with a day picked under "תאריך אחר" saves like one with a preset date', () => {
  const p = loadPlanner();
  const today = '2026-10-08'; // a Thursday
  const base = { title: 'לפתור בגרות חורף 2024 במתמטיקה', pending: false, today };
  // The steps: "תאריך אחר", no day yet: nothing to save, and no date.
  assert.deepEqual(p.composeDue('custom', '', today), { due: null, ready: false });
  assert.equal(p.canSubmitTask({ ...base, choice: 'custom', custom: '' }), false);
  // 13 picked in the grid: the button and Enter both save, with that day.
  assert.deepEqual(p.composeDue('custom', '2026-10-13', today), { due: '2026-10-13', ready: true });
  assert.equal(p.canSubmitTask({ ...base, choice: 'custom', custom: '2026-10-13' }), true);
  // The same as "מחר", which saved at once.
  assert.deepEqual(p.composeDue('tomorrow', '', today), { due: '2026-10-09', ready: true });
  assert.equal(p.canSubmitTask({ ...base, choice: 'tomorrow', custom: '' }), true);
  // A day left over from the grid does not stick to a preset chosen after it.
  assert.deepEqual(p.composeDue('nextWeek', '2026-10-13', today), { due: '2026-10-15', ready: true });
  assert.deepEqual(p.composeDue('none', '2026-10-13', today), { due: null, ready: true });
  // A date that is not a calendar day never saves.
  assert.equal(p.canSubmitTask({ ...base, choice: 'custom', custom: '2026-02-30' }), false);
  // No title, or a save already on its way: nothing, whatever the date.
  assert.equal(p.canSubmitTask({ ...base, title: '   ', choice: 'custom', custom: '2026-10-13' }), false);
  assert.equal(p.canSubmitTask({ ...base, pending: true, choice: 'custom', custom: '2026-10-13' }), false);
});

test('the due-date chips follow the weekday: "יום הלימודים הבא" only when tomorrow is Friday or Saturday (R-13)', () => {
  const p = loadPlanner();
  const keys = (today) => p.dueOptions(today).map((o) => o.key);
  const plain = ['today', 'tomorrow', 'nextWeek', 'none'];
  const withSchoolDay = ['today', 'tomorrow', 'nextSchoolDay', 'nextWeek', 'none'];

  // Sunday 4.10 to Saturday 10.10.2026.
  assert.deepEqual(keys('2026-10-04'), plain); // Sunday → Monday
  assert.deepEqual(keys('2026-10-05'), plain);
  assert.deepEqual(keys('2026-10-06'), plain);
  assert.deepEqual(keys('2026-10-07'), plain); // Wednesday → Thursday
  assert.deepEqual(keys('2026-10-08'), withSchoolDay); // Thursday → Friday
  assert.deepEqual(keys('2026-10-09'), withSchoolDay); // Friday → Saturday
  assert.deepEqual(keys('2026-10-10'), plain); // Saturday → Sunday, already a school day

  // The dates behind them: Thursday's next school day is Sunday, three days on.
  assert.deepEqual(p.dueOptions('2026-10-08'), [
    { key: 'today', date: '2026-10-08' },
    { key: 'tomorrow', date: '2026-10-09' },
    { key: 'nextSchoolDay', date: '2026-10-11' },
    { key: 'nextWeek', date: '2026-10-15' },
    { key: 'none', date: null },
  ]);
  assert.equal(p.nextSchoolDay('2026-10-09'), '2026-10-11'); // Friday → Sunday
  assert.equal(p.nextSchoolDay('2026-10-10'), '2026-10-11'); // Saturday → Sunday
  assert.equal(p.nextSchoolDay('2026-10-05'), '2026-10-06'); // Monday → Tuesday
  // Across a month and a year boundary.
  assert.equal(p.nextSchoolDay('2026-10-29'), '2026-11-01');
  assert.equal(p.nextSchoolDay('2026-12-31'), '2027-01-03');
  assert.equal(p.dueOptions('2026-12-31').find((o) => o.key === 'nextWeek').date, '2027-01-07');
});

test('one empty state for tasks and homework together, never "אין משימות באיחור" above overdue homework (R-12)', () => {
  const p = loadPlanner();
  const state = (tasks, homework, more = {}) => p.tasksEmptyState({ filter: 'overdue', search: false, tasks, homework, ...more });

  // Overdue homework only: no message at all — the homework is the list.
  assert.deepEqual(state(0, 1), { text: null, homeworkNote: false });
  // Nothing of either: one message for both.
  assert.deepEqual(state(0, 0), { text: 'אין משימות או שיעורי בית באיחור', homeworkNote: false });
  // Tasks listed: no message; known homework is in the list, so no line about it (W5-18).
  assert.deepEqual(state(2, 0), { text: null, homeworkNote: false });
  assert.deepEqual(state(2, 3), { text: null, homeworkNote: false });
  // Homework not known (loading, failed, Mashov not connected): the message is about tasks alone, and a line says why.
  assert.deepEqual(state(0, null), { text: 'אין משימות באיחור', homeworkNote: true });
  assert.deepEqual(state(1, null), { text: null, homeworkNote: true });

  // Every filter has its own wording for both.
  assert.equal(state(0, 0, { filter: 'today' }).text, 'אין משימות או שיעורי בית להיום');
  assert.equal(state(0, 0, { filter: 'tomorrow' }).text, 'אין משימות או שיעורי בית למחר');
  assert.equal(state(0, 0, { filter: 'completed' }).text, 'עוד אין משימות או שיעורי בית שסומנו כבוצעו');
  assert.equal(state(0, 0, { filter: 'open' }).text, 'הכול פנוי כאן. אפשר לנשום או לתכנן קדימה.');
  assert.equal(state(0, null, { filter: 'open' }).text, 'הכול פנוי כאן. אפשר לנשום או לתכנן קדימה.');

  // A search that finds nothing says so, about both or about tasks.
  assert.equal(state(0, 0, { search: true }).text, 'לא נמצאו משימות או שיעורי בית שמתאימים לחיפוש');
  assert.equal(state(0, null, { search: true }).text, 'לא נמצאו משימות שמתאימות לחיפוש');
  assert.deepEqual(state(0, 2, { search: true }), { text: null, homeworkNote: false });
});

test('a completed task says when it was completed: "הושלמה ב־8.10" (R-15)', () => {
  const p = loadPlanner();
  const today = '2026-10-08';
  // Noon UTC is the same day in any time zone this runs in.
  assert.deepEqual(p.completedLabel('2026-10-05T12:00:00.000Z', today), { lead: 'הושלמה ב־', date: '5.10' });
  assert.deepEqual(p.completedLabel('2026-10-08T09:30:00.000Z', today), { lead: 'הושלמה היום', date: null });
  assert.deepEqual(p.completedLabel('2026-10-07T12:00:00.000Z', today), { lead: 'הושלמה אתמול', date: null });
  // Another year in full, so a chore done every year reads as two different days.
  assert.deepEqual(p.completedLabel('2023-12-02T12:00:00.000Z', today), { lead: 'הושלמה ב־', date: '2.12.2023' });
  // Unknown or unreadable: no label.
  assert.equal(p.completedLabel(null, today), null);
  assert.equal(p.completedLabel(undefined, today), null);
  assert.equal(p.completedLabel('not a date', today), null);

  assert.equal(p.completedText({ lead: 'הושלמה ב־', date: '5.10' }), 'הושלמה ב־5.10');
  assert.equal(p.completedText({ lead: 'הושלמה היום', date: null }), 'הושלמה היום');
});

// ---------------------------------------------------------------------------
// Wave 4
// ---------------------------------------------------------------------------

test('W4-12c: a month grid pages by the first of the month, never by the chosen day', () => {
  const p = loadPlanner();
  assert.equal(p.monthOf('2026-10-31'), '2026-10-01');
  assert.equal(p.shiftMonth(p.monthOf('2026-10-31'), 1), '2026-11-01');
  assert.equal(p.shiftMonth(p.monthOf('2026-01-15'), -1), '2025-12-01');
  // The grid of a month's first day is that month's grid.
  assert.deepEqual(p.monthDates(p.monthOf('2026-10-20')), p.monthDates('2026-10-20'));
});

test('W4 (Daniel): a right-to-left placeholder keeps its "?" and "…" at the end of the sentence', () => {
  const p = loadPlanner();
  const rlm = String.fromCharCode(0x200f);
  assert.equal(p.rtlPlaceholder('מה צריך לעשות?'), `מה צריך לעשות?${rlm}`);
  assert.equal(p.rtlPlaceholder('חיפוש…'), `חיפוש…${rlm}`);
  // Once is enough.
  assert.equal(p.rtlPlaceholder(p.rtlPlaceholder('חיפוש…')), `חיפוש…${rlm}`);
});

test('W4 (Maya): a press right after a sheet closes is ignored, later ones count', () => {
  const p = loadPlanner();
  const closed = 10_000;
  assert.equal(p.pressAllowed(closed + 100, null), true);
  assert.equal(p.pressAllowed(closed + 50, closed), false);
  assert.equal(p.pressAllowed(closed + p.SHEET_CLOSE_GUARD_MS - 1, closed), false);
  assert.equal(p.pressAllowed(closed + p.SHEET_CLOSE_GUARD_MS, closed), true);
  // A clock set back never blocks presses for good.
  assert.equal(p.pressAllowed(closed - 60_000, closed), true);
  assert.ok(p.SHEET_CLOSE_GUARD_MS >= 300 && p.SHEET_CLOSE_GUARD_MS <= 800);
});

test('W4 (Daniel): a toast names the task, cut at a word, ranges kept in order', () => {
  const p = loadPlanner();
  const task = (title, completed = false) => ({ title, completed });
  assert.equal(p.toggleToastText(task('לקרוא פרק 3')), 'הושלמה: לקרוא פרק 3');
  assert.equal(p.toggleToastText(task('לקרוא פרק 3', true)), 'הוחזרה לפתוחות: לקרוא פרק 3');
  const J = String.fromCharCode(0x2060);
  assert.equal(p.taskToastText('נמחקה', 'שאלות 1–5'), `נמחקה: שאלות ${String.fromCharCode(0x2066)}1${J}–${J}5${String.fromCharCode(0x2069)}`);
  const long = p.taskToastText('הושלמה', 'לסיים את העבודה בהיסטוריה על המהפכה הצרפתית ולהגיש אותה במודל');
  assert.ok(long.endsWith('…') && long.length <= 'הושלמה: '.length + p.TOAST_TITLE_MAX + 1, long);
  assert.ok(!long.includes('  '));
  assert.equal(p.taskToastText('נמחקה', '   '), 'נמחקה');
});

test('W4 (Daniel): "החזרה" after a delete creates the same task again, linked to its homework', () => {
  const p = loadPlanner();
  const base = { id: 't1', listId: 'school', listTitle: 'בית ספר', title: 'אנגלית: שאלות 1–5', notes: 'בעמוד 40', due: '2026-10-12', completed: false, updated: null };
  assert.deepEqual(p.restoreTaskBody({ ...base, linkedHomeworkKey: 'hw:1' }), {
    title: 'אנגלית: שאלות 1–5', notes: 'בעמוד 40', due: '2026-10-12', listId: 'school', fromHomeworkKey: 'hw:1',
  });
  assert.deepEqual(p.restoreTaskBody({ ...base, notes: null, due: null, linkedHomeworkKey: null }), {
    title: 'אנגלית: שאלות 1–5', notes: null, due: null, listId: 'school',
  });
});

test('W4: a task for the next lesson starts as "שיעורי בית ב…", the subject without its group', () => {
  const p = loadPlanner();
  assert.equal(p.lessonTaskTitle({ subject: 'פיזיקה מורחב (מעבדת פיסיקה)' }), 'שיעורי בית בפיזיקה');
  assert.equal(p.lessonTaskTitle({ subject: 'אנגלית 5 יח״ל (יב2)' }), 'שיעורי בית באנגלית');
  // A name the student gave the subject, as typed (own names).
  assert.equal(p.lessonTaskTitle({ subject: 'פיזיקה (מעבדה)', originalSubject: 'גוש ב׳ (יב)' }), 'שיעורי בית בפיזיקה (מעבדה)');
});

// ---------------------------------------------------------------------------
// Wave 5
// ---------------------------------------------------------------------------

const w5task = (id, due, extra = {}) => ({
  id, listId: 'mine', listTitle: 'המשימות שלי', title: `משימה ${id}`, notes: null, due, completed: false, updated: null, linkedHomeworkKey: null, ...extra,
});
const w5hw = (naturalKey, dueDate, extra = {}) => ({ naturalKey, dueDate, subject: 'פיזיקה', text: 'שאלות 10–14', linkedTaskId: null, done: false, ...extra });
const kinds = (entries) => entries.map((e) => (e.kind === 'task' ? `t:${e.task.id}` : `h:${e.homework.naturalKey}`));

test('W5-18 (Itai): open homework sits among the tasks by due date, homework first on the same day, undated last', () => {
  const p = loadPlanner();
  const today = '2026-10-08';
  const tasks = p.selectTasks([w5task('a', '2026-10-09'), w5task('b', null), w5task('c', '2026-10-06'), w5task('d', '2026-10-12')], {
    today, filter: 'open', listId: null, search: '',
  });
  const homework = p.selectHomework([w5hw('late', '2026-10-06'), w5hw('fri', '2026-10-09'), w5hw('sun', '2026-10-11'), w5hw('none', null)], {
    today, filter: 'open', search: '', taskIds: null,
  });
  assert.deepEqual(kinds(p.todoEntries(tasks, homework, 'open')), ['h:late', 't:c', 'h:fri', 't:a', 'h:sun', 't:d', 'h:none', 't:b']);
  assert.deepEqual(kinds(p.todoEntries([], homework, 'open')), ['h:late', 'h:fri', 'h:sun', 'h:none']);
  assert.deepEqual(kinds(p.todoEntries(tasks, [], 'open')), ['t:c', 't:a', 't:d', 't:b']);
  // "הושלמו": the tasks in their completion order, then the homework.
  assert.deepEqual(kinds(p.todoEntries([w5task('x', '2026-10-01'), w5task('y', '2026-10-20')], [w5hw('z', '2026-10-05')], 'completed')), ['t:x', 't:y', 'h:z']);
});

test('W5-18, run 8: the header counts tasks and homework as one number, and what is late of both', () => {
  const p = loadPlanner();
  // Run 8: "12 משימות, 12 שיעורי בית, 2 באיחור" read as 24 or 12. One count of what the list shows.
  assert.deepEqual(p.todoCounter({ tasks: 12, homework: 12, overdue: 2 }), { text: '24 פתוחות', overdue: '2 באיחור' });
  assert.deepEqual(p.todoCounter({ tasks: 1, homework: 1, overdue: 1 }), { text: '2 פתוחות', overdue: 'אחת באיחור' });
  assert.deepEqual(p.todoCounter({ tasks: 0, homework: 3, overdue: 0 }), { text: '3 פתוחות', overdue: null });
  assert.deepEqual(p.todoCounter({ tasks: 0, homework: 1, overdue: 0 }), { text: 'אחת פתוחה', overdue: null });
  // No homework to count: as before.
  assert.deepEqual(p.todoCounter({ tasks: 10, homework: 0, overdue: 0 }), { text: '10 פתוחות', overdue: null });
  assert.deepEqual(p.todoCounter({ tasks: 1, homework: null, overdue: 0 }), { text: 'משימה פתוחה אחת', overdue: null });
  assert.equal(p.todoCounter({ tasks: 0, homework: null, overdue: 0 }).text, 'אין משימות פתוחות');
  assert.equal(p.todoCounter({ tasks: 0, homework: 0, overdue: 0 }).text, 'אין משימות או שיעורי בית פתוחים');
});

test('W5-19 (Daniel): a row ticked a moment ago stays in place, under its filter, until it is let go', () => {
  const p = loadPlanner();
  const today = '2026-10-08';
  const tasks = [w5task('a', '2026-10-08', { completed: true }), w5task('b', '2026-10-09'), w5task('c', '2026-10-07', { completed: true })];
  const opts = { today, filter: 'open', listId: null, search: '' };
  assert.deepEqual(p.selectTasks(tasks, opts).map((t) => t.id), ['b']);
  assert.deepEqual(p.selectTasks(tasks, { ...opts, keep: new Set(['a']) }).map((t) => t.id), ['a', 'b']);
  // Its date still has to match the filter.
  assert.deepEqual(p.selectTasks(tasks, { ...opts, filter: 'tomorrow', keep: new Set(['a']) }).map((t) => t.id), ['b']);
  // Unticked under "הושלמו": it stays there a moment too.
  assert.deepEqual(p.selectTasks(tasks, { ...opts, filter: 'completed', keep: new Set(['b']) }).map((t) => t.id).sort(), ['a', 'b', 'c']);
  const hw = [w5hw('done', '2026-10-08', { done: true }), w5hw('open', '2026-10-09')];
  const hwOpts = { today, filter: 'open', search: '', taskIds: null };
  assert.deepEqual(p.selectHomework(hw, hwOpts).map((h) => h.naturalKey), ['open']);
  assert.deepEqual(p.selectHomework(hw, { ...hwOpts, keep: new Set(['done']) }).map((h) => h.naturalKey), ['done', 'open']);
  assert.ok(p.TICK_LINGER_MS >= 500 && p.TICK_LINGER_MS <= 1500);
});

test('W5-19 (Maya, Daniel): moving a task to another list creates it there, with the edits, linked to its homework', () => {
  const p = loadPlanner();
  const task = w5task('t1', '2026-10-12', { title: 'להביא אישור לטיול', notes: null, linkedHomeworkKey: 'hw:1' });
  assert.deepEqual(p.movedTaskBody(task, { title: 'להביא אישור חתום לטיול', notes: 'עד יום שני', due: '2026-10-11' }, 'school'), {
    title: 'להביא אישור חתום לטיול', notes: 'עד יום שני', due: '2026-10-11', listId: 'school', fromHomeworkKey: 'hw:1',
  });
  assert.deepEqual(p.movedTaskBody({ ...task, linkedHomeworkKey: null }, { title: 'א', notes: null, due: null }, 'school'), {
    title: 'א', notes: null, due: null, listId: 'school',
  });
  assert.equal(p.movesTask(task, 'school'), true);
  assert.equal(p.movesTask(task, 'mine'), false);
  assert.equal(p.movesTask(task, null), false);
});

// ---------------------------------------------------------------------------
// W6-9: the Tasks header and its chip row; a late task under "באיחור"
// ---------------------------------------------------------------------------

const NB = String.fromCharCode(0xa0);

test('W6-9 (Maya, Daniel): the header count wraps only after a comma, and "אחת באיחור" stays whole', () => {
  const p = loadPlanner();
  const line = p.counterLine(p.todoCounter({ tasks: 10, homework: 9, overdue: 1 }));
  // "19 פתוחות, אחת באיחור" (run 8: one count), the last in red; no "·" at all.
  assert.equal(`${line.text}${line.overdue}`.replace(new RegExp(NB, 'g'), ' '), '19 פתוחות, אחת באיחור');
  assert.ok(!`${line.text}${line.overdue}`.includes('·'));
  // The only places a line may break are the spaces after each comma: never inside a piece, never before a comma.
  const whole = `${line.text}${line.overdue}`;
  const breaks = [...whole].flatMap((ch, i) => (ch === ' ' ? [i] : []));
  assert.equal(breaks.length, 1);
  for (const i of breaks) assert.equal(whole[i - 1], ',');
  // The red span carries its own separator, so the comma never starts the second line.
  assert.ok(line.overdue.startsWith(p.COUNT_SEPARATOR));
  assert.ok(line.overdue.endsWith(`אחת${NB}באיחור`));
  // Nothing late and one piece: a sentence, free to wrap at any space.
  assert.deepEqual(p.counterLine({ text: 'אין משימות או שיעורי בית פתוחים', overdue: null }), { text: 'אין משימות או שיעורי בית פתוחים', overdue: null });
  // Nothing late, two pieces: they still break only after the comma.
  assert.equal(p.counterLine({ text: '3 משימות, 2 שיעורי בית', overdue: null }).text, `3${NB}משימות, 2${NB}שיעורי${NB}בית`);
  assert.equal(p.unbroken('שיעורי בית'), `שיעורי${NB}בית`);
});

test('Wave 9: a dated row\'s margin says "היום", "מחר" or the date, and a late row is late only while open', () => {
  const p = loadPlanner();
  const today = '2026-10-08';
  assert.equal(p.dueMarginText('2026-10-08', today), 'היום');
  assert.equal(p.dueMarginText('2026-10-09', today), 'מחר');
  assert.equal(p.dueMarginText('2026-10-06', today), '6.10');
  assert.equal(p.dueMarginText('2026-10-20', today), '20.10');
  // Across the turn of the year it is still the short date, as the due line always wrote it.
  assert.equal(p.dueMarginText('2027-01-03', '2026-12-31'), '3.1');
  assert.equal(p.dueMarginText('2027-01-01', '2026-12-31'), 'מחר');
  assert.equal(p.dueMarginText(null, today), null);
  assert.equal(p.dueMarginText(undefined, today), null);
  assert.equal(p.isLate('2026-10-06', today), true);
  assert.equal(p.isLate('2026-10-06', today, true), false, 'done work is never late (B2)');
  assert.equal(p.isLate('2026-10-08', today), false, 'due today is not late');
  assert.equal(p.isLate(null, today), false);
});

test('W6-9: a right-to-left chip row ends on the side away from where it started, on any platform', () => {
  const p = loadPlanner();
  // Starts at 0 and counts up (Android, a row laid out from the left edge's coordinates).
  assert.equal(p.scrollEndOffset(12, 200), 200);
  // Starts at the far end and counts down to 0.
  assert.equal(p.scrollEndOffset(188, 200), 0);
  // The web counts a right-to-left scroll below 0.
  assert.equal(p.scrollEndOffset(-12, 200), -200);
});

test('Today\'s late section: a late task says how late, not "באיחור" again; elsewhere as before', () => {
  const p = loadPlanner();
  const now = new Date('2026-10-08T14:00:00');
  assert.deepEqual(p.taskDueText('2026-10-05', { now }), { text: '5.10, באיחור', overdue: true });
  assert.deepEqual(p.taskDueText('2026-10-05', { now, underLate: true }), { text: '5.10, לפני 3 ימים', overdue: true });
  assert.deepEqual(p.taskDueText('2026-10-07', { now, underLate: true }), { text: 'אתמול', overdue: true });
  // Not late, or done: the plain date, wherever it sits.
  assert.deepEqual(p.taskDueText('2026-10-09', { now, underLate: true }), { text: 'מחר', overdue: false });
  assert.deepEqual(p.taskDueText('2026-10-05', { now, underLate: true, completed: true }), { text: '5.10', overdue: false });
});
