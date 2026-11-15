const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * Loads a TypeScript module from src, with a `require` that loads its relative
 * imports the same way (today.ts imports format.ts at runtime).
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

const t = load(path.join(__dirname, '../src/lib/today.ts'));
/** The line as plain text, with its non-breaking spaces read as spaces. */
const plain = (s) => s.replace(/\u00A0/g, ' ');
const text = (parts) => (parts ? plain(t.partsText(parts)) : null);

const DATE = '2026-10-08';
/** Device-local, like the app: Thursday 8.10.2026 at `hh:mm`. */
const at = (hhmm) => new Date(`${DATE}T${hhmm}:00`);

function lesson(hourIndex, subject, startTime, endTime, status = 'regular', extra = {}) {
  return {
    kind: 'lesson',
    sortKey: `${startTime}|1|${String(hourIndex).padStart(2, '0')}`,
    lesson: {
      date: DATE, hourIndex, startTime, endTime, subject, teacher: 'כהן', room: null, status,
      substitute: null, note: null, source: 'shahaf', changeSeenAt: null, ...extra,
    },
  };
}
function event(summary, start, end, allDay = false) {
  return {
    kind: 'event', sortKey: `${start}|2|`,
    event: { id: summary, calendarId: 'c', calendarName: null, seriesId: null, summary, location: null,
      start: `${DATE}T${start}:00`, end: `${DATE}T${end}:00`, allDay },
  };
}
function task(title, completed = false) {
  return { kind: 'task', sortKey: '23:59|3|', task: { id: title, listId: 'l', listTitle: null, title, notes: null, due: DATE, completed, updated: null, linkedHomeworkKey: null } };
}
function homework(subject, done = false) {
  return { naturalKey: `${subject}-${done}`, dueDate: DATE, subject, text: 'עמ׳ 12', linkedTaskId: null, done };
}

/** Seven periods; 4–7 cancelled — the persona's day. */
const day = [
  lesson(1, 'פיזיקה מורחב (יב2)', '08:00', '08:45'),
  lesson(2, 'פיזיקה מורחב (יב2)', '08:45', '09:30'),
  lesson(3, 'אנגלית 5 יח״ל (יב3)', '09:45', '10:30'),
  lesson(4, 'היסטוריה', '10:45', '11:30', 'cancelled'),
  lesson(5, 'ספרות', '11:30', '12:15', 'cancelled'),
  lesson(6, 'מתמטיקה', '12:30', '13:15', 'cancelled'),
  lesson(7, 'חינוך', '13:15', '14:00', 'cancelled'),
];

test('nowNext: in a lesson, says what it is, until when, and what follows', () => {
  const n = t.nowNext(day, DATE, at('09:10'));
  assert.equal(n.tone, 'now');
  assert.equal(text(n.primary), 'פיזיקה עד 09:30');
  assert.equal(text(n.secondary), 'ב־09:45 אנגלית');
  // Times are separate LTR runs, so the screen can isolate them.
  assert.deepEqual(n.primary.filter((p) => p.ltr).map((p) => p.text), ['09:30']);
});

test('nowNext: a lesson starting this minute is now; one ending this minute is not', () => {
  assert.equal(text(t.nowNext(day, DATE, at('08:45')).primary), 'פיזיקה עד 09:30');
  assert.equal(text(t.nowNext(day, DATE, at('08:00')).primary), 'פיזיקה עד 08:45');
});

test('nowNext: between lessons it is a break until the next one', () => {
  const n = t.nowNext(day, DATE, at('09:35'));
  assert.equal(n.tone, 'break');
  assert.equal(text(n.primary), 'הפסקה');
  assert.equal(text(n.secondary), 'ב־09:45 אנגלית');
});

test('nowNext: a long gap left by a cancellation reads "זמן פנוי"', () => {
  const gappy = [lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'ספרות', '08:45', '09:30', 'cancelled'), lesson(3, 'אנגלית', '09:45', '10:30')];
  assert.equal(text(t.nowNext(gappy, DATE, at('08:50')).primary), 'זמן פנוי');
});

test('nowNext: before school, when the day starts and with what', () => {
  const n = t.nowNext(day, DATE, at('07:10'));
  assert.equal(n.tone, 'before');
  assert.equal(text(n.primary), 'מתחילים ב־08:00');
  assert.equal(text(n.secondary), 'השיעור הראשון: פיזיקה');
});

test('nowNext: a cancelled first lesson moves the start', () => {
  const late = [lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), lesson(2, 'אנגלית', '08:45', '09:30')];
  assert.equal(text(t.nowNext(late, DATE, at('08:10')).primary), 'מתחילים ב־08:45');
});

test('nowNext: after the last lesson that takes place, school is done — and the next day when known', () => {
  // 4–7 are cancelled, so the day is over at 10:30, not 14:00.
  const n = t.nowNext(day, DATE, at('11:00'), '08:00');
  assert.equal(n.tone, 'done');
  assert.equal(text(n.primary), 'סיימת להיום.');
  assert.equal(text(n.secondary), 'מחר מתחילים ב־08:00');
  assert.equal(t.nowNext(day, DATE, at('14:00')).secondary, null);
  // Thursday: the next school day is Sunday (W4-1).
  assert.equal(text(t.nowNext(day, DATE, at('11:00'), '08:15', 'ביום ראשון').secondary), 'ביום ראשון מתחילים ב־08:15');
});

test('nowNext: a day of events only, all over, says so — not "done for the day"', () => {
  const n = t.nowNext([event('תור לעיניים', '06:00', '07:30')], DATE, at('12:00'), '08:00');
  assert.equal(text(n.primary), 'אין עוד אירועים היום');
  assert.equal(text(n.secondary), 'מחר מתחילים ב־08:00');
  assert.ok(!text(n.primary).includes('סיימת'));
});

test('nowNext: the last lesson says so', () => {
  assert.equal(text(t.nowNext(day, DATE, at('10:00')).secondary), 'זה השיעור האחרון להיום');
});

test('nowNext: cancelled lessons are never now or next', () => {
  const n = t.nowNext(day, DATE, at('10:50'));
  assert.notEqual(n.tone, 'now');
  assert.ok(!text(n.primary).includes('היסטוריה'));
});

test('nowNext: school over with an event to come says school is done, then what is next (W4-8)', () => {
  const evening = [...day, event('חוג כדורסל', '17:00', '18:30')];
  const n = t.nowNext(evening, DATE, at('14:00'));
  assert.equal(n.tone, 'done');
  assert.equal(text(n.primary), 'סיימת להיום.');
  assert.equal(text(n.secondary), 'ב־17:00 חוג כדורסל');
  assert.equal(text(t.nowNext(evening, DATE, at('17:30')).primary), 'חוג כדורסל עד 18:30');
});

test('nowNext: a lesson wins over an event that overlaps it; all-day events are ignored', () => {
  const mixed = [event('כל היום', '00:00', '23:59', true), lesson(1, 'פיזיקה', '08:00', '08:45'), event('תור לעיניים', '08:00', '09:00')];
  assert.equal(text(t.nowNext(mixed, DATE, at('08:10')).primary), 'פיזיקה עד 08:45');
});

test('nowNext: a day with nothing timed shows tomorrow, or nothing at all', () => {
  assert.equal(t.nowNext([], DATE, at('12:00')), null);
  assert.equal(text(t.nowNext([task('לקנות מחברת')], DATE, at('12:00'), '08:15').primary), 'מחר מתחילים ב־08:15');
  const allCancelled = [lesson(1, 'ספרות', '08:00', '08:45', 'cancelled')];
  assert.equal(t.nowNext(allCancelled, DATE, at('08:10')), null);
});

test('firstLessonStart: the first lesson that takes place', () => {
  assert.equal(t.firstLessonStart(day), '08:00');
  assert.equal(t.firstLessonStart([lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), lesson(2, 'אנגלית', '08:45', '09:30')]), '08:45');
  assert.equal(t.firstLessonStart([task('x')]), null);
});

test('daySummary: the real span once cancellations are out', () => {
  const s = t.daySummary(day);
  assert.deepEqual(s, { total: 7, active: 3, cancelled: 4, start: '08:00', end: '10:30' });
});

/** `dayLine` as plain text: its lessons line and its span. */
const dl = (timeline, hidden) => {
  const line = t.dayLine(t.daySummary(timeline), hidden);
  return line ? { lessons: plain(line.lessons), span: line.span } : null;
};

test('dayLine: the lessons and what was cancelled as one plain line, no "·" (plan §16.2)', () => {
  assert.deepEqual(dl(day), { lessons: '3 שיעורים, 4 בוטלו', span: '08:00–10:30' });
  assert.deepEqual(dl(day.slice(0, 3)), { lessons: '3 שיעורים', span: '08:00–10:30' });
  const one = [lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'ספרות', '08:45', '09:30', 'cancelled')];
  assert.deepEqual(dl(one), { lessons: 'שיעור אחד, אחד בוטל', span: '08:00–08:45' });
  // Never a chain of dots, never a zero.
  for (const timeline of [day, day.slice(0, 3), one, day.slice(3)]) {
    assert.ok(!dl(timeline).lessons.includes('·'), dl(timeline).lessons);
    assert.doesNotMatch(dl(timeline).lessons, /(^|\s)0\s/);
  }
  // A number never parts from its word.
  assert.ok(t.dayLine(t.daySummary(day)).lessons.includes(`3${t.NBSP}שיעורים`));
  assert.ok(t.dayLine(t.daySummary(day)).lessons.includes(`4${t.NBSP}בוטלו`));
});

test('dayLine: all cancelled, untimed and empty days', () => {
  assert.deepEqual(dl(day.slice(3)), { lessons: 'כל השיעורים בוטלו', span: null });
  assert.deepEqual(dl(day.slice(3, 4)), { lessons: 'השיעור היחיד בוטל', span: null });
  assert.deepEqual(dl([lesson(1, 'פיזיקה', null, null)]), { lessons: 'שיעור אחד', span: null });
  assert.equal(dl([]), null);
  // Events are not counted.
  assert.equal(dl([event('חוג', '17:00', '18:00')]), null);
  assert.deepEqual(dl([...day.slice(0, 3), event('חוג', '17:00', '18:00')]), { lessons: '3 שיעורים', span: '08:00–10:30' });
});

test('dayLine: with lessons hidden, never "כל השיעורים בוטלו" — the count instead (V2, Maya, run 5)', () => {
  // Maya hid physics: what is left of Thursday is the four cancelled periods.
  assert.deepEqual(dl(day.slice(3), true), { lessons: '4 שיעורים בוטלו', span: null });
  assert.deepEqual(dl(day.slice(3, 4), true), { lessons: 'שיעור אחד בוטל', span: null });
  // A day with lessons that take place reads the same either way.
  assert.deepEqual(dl(day, true), dl(day, false));
});

test('nowNext: the time is in the margin, so no line says "עכשיו", and none chains "·" (plan §16.2)', () => {
  const evening = [...day, event('חוג כדורסל', '17:00', '18:30')];
  for (const [timeline, time] of [[day, '07:10'], [day, '09:10'], [day, '09:35'], [day, '10:00'], [evening, '14:00'], [evening, '17:30'], [day, '11:00']]) {
    const n = t.nowNext(timeline, DATE, at(time), '08:00');
    for (const line of [n.primary, n.secondary].filter(Boolean)) {
      assert.ok(!text(line).includes('עכשיו'), text(line));
      assert.ok(!text(line).includes('·'), text(line));
    }
  }
  // What follows reads time first, the time an LTR run of its own.
  const next = t.nowNext(evening, DATE, at('14:00')).secondary;
  assert.deepEqual(next.filter((p) => p.ltr).map((p) => p.text), ['17:00']);
});

test('nowCardAction: "קפיצה לעכשיו" while the day is under way, the next school day once it is over (W5-6)', () => {
  const sunday = '2026-10-11';
  // Before the first lesson: the page opens at the top anyway — no action.
  assert.equal(t.nowCardAction(day, DATE, at('07:30'), sunday), null);
  // In a lesson, in a break: to "now".
  for (const time of ['08:10', '09:35']) {
    assert.deepEqual(t.nowCardAction(day, DATE, at(time), sunday), { kind: 'now', label: 'קפיצה לעכשיו' }, time);
  }
  // Periods 4–7 cancelled: after 10:30 the day is over, and the card offers Sunday.
  assert.deepEqual(t.nowCardAction(day, DATE, at('10:40'), sunday), { kind: 'day', date: sunday, label: 'ליום ראשון' });
  // School over, an event still to come: "now" sits right above it.
  const evening = [...day.slice(0, 3), event('חוג', '17:00', '18:00')];
  assert.deepEqual(t.nowCardAction(evening, DATE, at('15:00'), sunday), { kind: 'now', label: 'קפיצה לעכשיו' });
  // Everything over: Thursday evening leads to Sunday, another evening to tomorrow.
  assert.deepEqual(t.nowCardAction(evening, DATE, at('21:00'), sunday), { kind: 'day', date: sunday, label: 'ליום ראשון' });
  assert.deepEqual(t.nowCardAction(evening, DATE, at('21:00'), '2026-10-09'), { kind: 'day', date: '2026-10-09', label: 'למחר' });
  // Over, and the next school day unknown: nothing to offer.
  assert.equal(t.nowCardAction(evening, DATE, at('21:00'), null), null);
  // Nothing timed at all (every lesson cancelled): straight to the next school day.
  assert.deepEqual(t.nowCardAction(day.slice(3), DATE, at('09:00'), sunday), { kind: 'day', date: sunday, label: 'ליום ראשון' });
});

test('dueCounts: open tasks and open homework, nothing done', () => {
  const timeline = [...day, task('דוח מעבדה'), task('ישן', true)];
  const hw = [homework('היסטוריה'), homework('מתמטיקה', true), homework('ספרות')];
  assert.deepEqual(t.dueCounts(timeline, hw), { tasks: 1, homework: 2, study: 0, total: 3 });
  // An older server sends no homework at all.
  assert.deepEqual(t.dueCounts(timeline, undefined), { tasks: 1, homework: 0, study: 0, total: 1 });
});

// ---- W6-6: studying is not handed in (Noa, run 5) ------------------------------

test('isStudyTask: the exam sheet\'s study tasks and any task titled "ללמוד…"; nothing else', () => {
  for (const title of ['ללמוד למבחן באנגלית · 20.10', 'ללמוד למבחן באנגלית · 20.10 (1/3)', 'ללמוד למבחן: מועד ב', 'ללמוד פרק 3', ' ללמוד']) {
    assert.equal(t.isStudyTask(title), true, title);
  }
  for (const title of ['דוח מעבדה', 'להגיש עבודה בהיסטוריה', 'ללמודים', 'לחזור על ללמוד']) {
    assert.equal(t.isStudyTask(title), false, title);
  }
});

test('dueCounts: study tasks are counted apart, never as something to hand in (W6-6)', () => {
  const timeline = [task('דוח מעבדה'), task('ללמוד למבחן באנגלית · 20.10 (1/3)'), task('ללמוד פרק 3', true)];
  assert.deepEqual(t.dueCounts(timeline, [homework('היסטוריה')]), { tasks: 1, homework: 1, study: 1, total: 2 });
  // Only a study session: nothing to hand in, so "הכול סומן כבוצע" can still say so.
  assert.deepEqual(t.dueCounts([task('ללמוד למבחן בכימיה · 12.10')], []), { tasks: 0, homework: 0, study: 1, total: 0 });
});

test('dayMarks: a study session alone is not "להגשה" — no dot, and the day button does not say so (W6-6)', () => {
  const studyDay = { examsToday: [], changeCount: 0, timeline: [task('ללמוד למבחן באנגלית · 20.10 (2/3)')], homework: [] };
  assert.equal(t.dayMarks(studyDay).due, false);
  assert.equal(t.marksLabel(t.dayMarks(studyDay)), '');
  // Beside something to hand in, the dot is there for that.
  assert.equal(t.dayMarks({ ...studyDay, timeline: [...studyDay.timeline, task('דוח מעבדה')] }).due, true);
});

test('dueNames and studyNames: the next day\'s hand-ins and its study sessions, apart (W6-6)', () => {
  const timeline = [task('דוח מעבדה'), task('ללמוד למבחן באנגלית · 20.10 (1/3)'), task('ללמוד פרק 3 בהיסטוריה'), task('ללמוד למבחן בכימיה', true)];
  assert.deepEqual(t.dueNames(timeline, [homework('אנגלית (יב3)')]), ['אנגלית', 'דוח מעבדה']);
  // The line says "ללמוד" once; each name drops its own.
  assert.deepEqual(t.studyNames(timeline), ['מבחן באנגלית · 20.10 (1/3)', 'פרק 3 בהיסטוריה']);
  assert.deepEqual(t.studyNames([task('ללמוד')]), ['ללמוד']);
});

test('studySectionTitle: the study sessions\' own heading, apart from "להגשה" (W6-6)', () => {
  assert.equal(t.studySectionTitle(DATE, DATE), 'ללמוד היום');
  assert.equal(t.studySectionTitle('2026-10-09', DATE), 'ללמוד מחר');
  assert.equal(t.studySectionTitle('2026-10-12', DATE), 'ללמוד ביום הזה');
});

test('calendarFoldLabel: "רק בית ספר" folds the calendar into one row (W6-6, Itai)', () => {
  assert.equal(t.calendarFoldLabel(3), '3 אירועים ביומן');
  assert.equal(t.calendarFoldLabel(1), 'אירוע אחד ביומן');
});

test('legendKinds: the legend names only the dots on screen, in the order they are drawn (W6-6, Daniel)', () => {
  const marks = {
    '2026-10-04': { exam: false, change: false, due: true },
    '2026-10-08': { exam: false, change: true, due: true },
    '2026-10-20': { exam: true, change: false, due: false },
  };
  const week = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  assert.deepEqual(t.legendKinds(marks, week), ['change', 'due']);
  assert.deepEqual(t.legendKinds(marks, [...week, '2026-10-20']), ['exam', 'change', 'due']);
  assert.deepEqual(t.legendKinds(undefined, week), []);
  assert.deepEqual(t.legendKinds({}, week), []);
  assert.deepEqual(t.legendKinds(marks, week).map((k) => t.MARK_WORDS[k]), ['שינוי במערכת', 'להגשה']);
});

// ---- R-7: "באיחור" -----------------------------------------------------------

function hw(key, dueDate, extra = {}) {
  return { naturalKey: key, dueDate, subject: 'מתמטיקה (יב2)', text: 'תרגילים 1–5', linkedTaskId: null, done: false, ...extra };
}
function openTask(id, due, extra = {}) {
  return { id, listId: 'l', listTitle: null, title: id, notes: null, due, completed: false, updated: null, linkedHomeworkKey: null, ...extra };
}

test('overdueItems: the last 14 days before today — today − 14 in, today − 15 and today out', () => {
  const items = t.overdueItems(
    [hw('d14', '2026-09-24'), hw('d15', '2026-09-23'), hw('today', DATE), hw('d1', '2026-10-07'), hw('none', null), hw('ahead', '2026-10-09')],
    [openTask('t14', '2026-09-24'), openTask('t15', '2026-09-23'), openTask('tToday', DATE), openTask('tNone', null)],
    DATE,
  );
  assert.deepEqual(items.map((i) => (i.kind === 'homework' ? i.homework.naturalKey : i.task.id)), ['d14', 't14', 'd1']);
  assert.deepEqual(items.map((i) => i.due), ['2026-09-24', '2026-09-24', '2026-10-07']);
});

test('overdueItems: done homework and completed tasks are out', () => {
  const items = t.overdueItems([hw('done', '2026-10-06', { done: true })], [openTask('done', '2026-10-06', { completed: true })], DATE);
  assert.deepEqual(items, []);
});

test('overdueItems: homework that lives on as a task is out — unless that task is gone', () => {
  const tasks = [openTask('kept', '2026-10-06')];
  const items = t.overdueItems(
    [hw('linked', '2026-10-06', { linkedTaskId: 'kept' }), hw('orphan', '2026-10-06', { linkedTaskId: 'deleted' })],
    tasks,
    DATE,
  );
  // The task stands for "linked"; "orphan"'s task was deleted, so it is back.
  assert.deepEqual(items.map((i) => (i.kind === 'homework' ? `hw:${i.homework.naturalKey}` : `task:${i.task.id}`)), ['hw:orphan', 'task:kept']);
  // Tasks not loaded (yet, or Google not connected): the link is trusted.
  assert.deepEqual(t.overdueItems([hw('linked', '2026-10-06', { linkedTaskId: 'x' })], undefined, DATE), []);
  assert.deepEqual(t.overdueItems(undefined, undefined, DATE), []);
});

test('homeworkDueParts: today, tomorrow, a weekday ahead, overdue while open', () => {
  assert.equal(text(t.homeworkDueParts(hw('a', DATE), DATE)), 'להגשה היום');
  assert.equal(text(t.homeworkDueParts(hw('a', '2026-10-09'), DATE)), 'להגשה מחר');
  assert.equal(text(t.homeworkDueParts(hw('a', '2026-10-15'), DATE)), 'להגשה עד יום חמישי 15.10');
  const late = t.homeworkDueParts(hw('a', '2026-10-06'), DATE);
  assert.equal(text(late), 'להגשה ב־6.10, באיחור');
  assert.deepEqual(late.filter((p) => p.ltr).map((p) => p.text), ['6.10']);
  assert.equal(text(t.homeworkDueParts(hw('a', '2026-10-06', { done: true }), DATE)), 'להגשה ב־6.10');
  assert.equal(text(t.homeworkDueParts(hw('a', null), DATE)), 'בלי תאריך הגשה');
});

test('homeworkDueParts under the "באיחור" heading: how long ago, not "באיחור" again (run 5, Daniel)', () => {
  assert.equal(text(t.homeworkDueParts(hw('a', '2026-10-07'), DATE, true)), 'להגשה אתמול');
  const twoDays = t.homeworkDueParts(hw('a', '2026-10-06'), DATE, true);
  assert.equal(text(twoDays), 'להגשה ב־6.10, לפני יומיים');
  assert.deepEqual(twoDays.filter((p) => p.ltr).map((p) => p.text), ['6.10']);
  assert.equal(twoDays[twoDays.length - 1].tone, 'alert');
  assert.equal(text(t.homeworkDueParts(hw('a', '2026-09-28'), DATE, true)), 'להגשה ב־28.9, לפני 10 ימים');
  for (const due of ['2026-10-07', '2026-10-06', '2026-09-28']) {
    assert.doesNotMatch(text(t.homeworkDueParts(hw('a', due), DATE, true)), /באיחור/);
  }
  // Not late, the same words as anywhere else.
  assert.equal(text(t.homeworkDueParts(hw('a', DATE), DATE, true)), 'להגשה היום');
});

// ---- R-9, W4-12b: the timeline's entries -------------------------------------

const shape = (entries) => entries.map((e) => {
  if (e.kind === 'item') return e.item.kind === 'lesson' ? `L${e.item.lesson.hourIndex}` : `${e.item.kind}${e.slim ? '~' : ''}`;
  const hours = e.lessons.map((l) => l.hourIndex).join(',');
  return e.kind === 'cancelledRun' ? `run(${hours})` : `block(${hours})`;
});

test('dayEntries: cancelled lessons in a row fold into one entry, free from the last lesson', () => {
  const entries = t.dayEntries(day, DATE);
  assert.deepEqual(shape(entries), ['block(1,2)', 'L3', 'run(4,5,6,7)']);
  const run = entries[2];
  assert.equal(text(run.label), 'שיעורים 4–7 בוטלו, חופשי מ־10:30');
  assert.deepEqual(run.label.filter((p) => p.ltr).map((p) => p.text), ['4–7', '10:30']);
  assert.equal(run.key, 'run-4-7');
});

test('dayEntries: a lone cancelled lesson stays a card', () => {
  const lone = [lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'ספרות', '08:45', '09:30', 'cancelled'), lesson(3, 'אנגלית', '09:45', '10:30')];
  assert.deepEqual(shape(t.dayEntries(lone, DATE)), ['L1', 'L2', 'L3']);
});

test('dayEntries: an event between cancelled lessons no longer splits the run (W4-12b)', () => {
  // Daniel's day: 4–6 cancelled, a calendar event at 13:00, 7 cancelled — one run, 4–7, and the event after it.
  const split = [
    ...day.slice(0, 3),
    lesson(4, 'היסטוריה', '10:45', '11:30', 'cancelled'), lesson(5, 'ספרות', '11:30', '12:15', 'cancelled'),
    lesson(6, 'מתמטיקה', '12:30', '13:15', 'cancelled'), event('ארוחת צהריים', '13:00', '13:30'),
    lesson(7, 'חינוך', '13:15', '14:00', 'cancelled'),
  ];
  const entries = t.dayEntries(split, DATE);
  assert.deepEqual(shape(entries), ['block(1,2)', 'L3', 'run(4,5,6,7)', 'event']);
  assert.equal(text(entries[2].label), 'שיעורים 4–7 בוטלו, חופשי מ־10:30');
  // Two cancelled around an event: still a run.
  const pair = [lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), event('אסיפה', '08:30', '09:00'), lesson(2, 'היסטוריה', '08:45', '09:30', 'cancelled')];
  assert.deepEqual(shape(t.dayEntries(pair, DATE)), ['run(1,2)', 'event']);
  // One cancelled and an event: nothing folds, the order stays.
  const one = [lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), event('אסיפה', '08:30', '09:00'), lesson(2, 'היסטוריה', '08:45', '09:30')];
  assert.deepEqual(shape(t.dayEntries(one, DATE)), ['L1', 'event~', 'L2']);
  // A lesson that takes place does split it.
  const broken = [
    lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), lesson(2, 'פיזיקה', '08:45', '09:30'), lesson(3, 'היסטוריה', '09:45', '10:30', 'cancelled'),
  ];
  assert.deepEqual(shape(t.dayEntries(broken, DATE)), ['L1', 'L2', 'L3']);
});

test('run 8: a cancelled run opened lists its lessons and the events between them by the clock', () => {
  // Today, 8.10: "שיעורים 4–7 בוטלו" opened listed 10:30, 11:30, 12:15, 13:25 and only then the 13:00 meeting.
  const council = [
    lesson(3, 'אנגלית', '09:45', '10:30'),
    lesson(4, 'היסטוריה', '10:30', '11:15', 'cancelled'), lesson(5, 'ספרות', '11:30', '12:15', 'cancelled'),
    lesson(6, 'מתמטיקה', '12:15', '13:00', 'cancelled'), event('ישיבת מועצת תלמידים', '13:00', '13:45'),
    lesson(7, 'חינוך', '13:25', '14:10', 'cancelled'), lesson(8, 'פיזיקה', '14:10', '14:55'),
  ];
  const closed = t.dayEntries(council, DATE);
  // Folded: the run's row, the meeting after it, marked as the run's.
  assert.deepEqual(shape(closed), ['L3', 'run(4,5,6,7)', 'event~', 'L8']);
  assert.equal(closed[2].run, 'run-4-7');
  assert.deepEqual(closed[1].items.map((i) => i.lesson.hourIndex), [4, 5, 6, 7]);
  // Nothing open: as it was.
  assert.deepEqual(shape(t.expandRuns(closed, new Set())), shape(closed));
  // Opened: the row stays, then the lessons and the meeting in the order of the clock.
  const opened = t.expandRuns(closed, new Set(['run-4-7']));
  assert.deepEqual(shape(opened), ['L3', 'run(4,5,6,7)', 'L4', 'L5', 'L6', 'event~', 'L7', 'L8']);
  assert.ok(opened.slice(2, 7).every((e) => e.run === 'run-4-7'));
  // The "now" line falls between them too: at 12:40, after the 12:15 lesson, before the meeting.
  assert.equal(t.nowEntryIndex(opened, at('12:40')), 5);
  // Two runs, one open: the other stays folded with its event after it.
  const two = [
    lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), event('אסיפה', '08:30', '09:00'), lesson(2, 'היסטוריה', '08:45', '09:30', 'cancelled'),
    ...council.slice(0, 6),
  ];
  assert.deepEqual(
    shape(t.expandRuns(t.dayEntries(two, DATE), new Set(['run-4-7']))),
    ['run(1,2)', 'event', 'L3', 'run(4,5,6,7)', 'L4', 'L5', 'L6', 'event', 'L7'],
  );
  assert.deepEqual(
    shape(t.expandRuns(t.dayEntries(two, DATE), new Set(['run-1-2']))),
    ['run(1,2)', 'L1', 'event', 'L2', 'L3', 'run(4,5,6,7)', 'event'],
  );
});

test('dayEntries: lessons in a row with the same subject and status are one card, "1–3 פיזיקה"', () => {
  // Itai's morning: three physics periods with calendar events between them.
  const itai = [
    event('תור לעיניים', '06:00', '07:30'),
    lesson(1, 'פיזיקה (מעבדת פיזיקה)', '08:00', '08:45'),
    lesson(2, 'פיזיקה (מעבדת פיזיקה)', '08:45', '09:30'), event('חוג גיטרה', '09:00', '09:45'),
    lesson(3, 'פיזיקה (מעבדת פיזיקה)', '09:45', '10:30'),
    lesson(4, 'אנגלית', '10:45', '11:30'),
  ];
  const entries = t.dayEntries(itai, DATE);
  // The early event came before the block began; the one inside it follows it.
  assert.deepEqual(shape(entries), ['event', 'block(1,2,3)', 'event~', 'L4']);
  const block = entries[1];
  assert.equal(block.key, 'block-1-3');
  assert.equal(t.periodsLabel(block.lessons), '1–3');
  // The card says what the numbers are (W6-7, Maya: "1–3" read as a grade or a date).
  assert.equal(text(t.periodsParts(block.lessons)), 'שיעורים 1–3');
  assert.deepEqual(t.periodsParts(block.lessons).filter((p) => p.ltr).map((p) => p.text), ['1–3']);
  assert.equal(text(t.periodsParts([block.lessons[0]])), 'שיעור 1');
  assert.equal(t.blockTimeLabel(block.lessons), '08:00–10:30');
  assert.equal(text(t.blockTimeParts(block.lessons)), 'שיעורים 1–3, 08:00–10:30');
  assert.deepEqual(t.blockTimeParts(block.lessons).filter((p) => p.ltr).map((p) => p.text), ['1–3', '08:00–10:30']);
  assert.equal(text(t.blockTimeParts([day[2].lesson])), 'שיעור 3, 09:45–10:30');
  assert.equal(t.periodsLabel([day[2].lesson]), '3');
});

test('dayEntries: a block needs the same status, teacher and substitute, and periods that follow', () => {
  const sub = (h, who) => lesson(h, 'מתמטיקה', null, null, 'substitution', { substitute: who });
  assert.deepEqual(shape(t.dayEntries([sub(1, 'רונית'), sub(2, 'רונית')], DATE)), ['block(1,2)']);
  assert.deepEqual(shape(t.dayEntries([sub(1, 'רונית'), sub(2, 'דנה')], DATE)), ['L1', 'L2']);
  assert.deepEqual(shape(t.dayEntries([lesson(1, 'מתמטיקה', null, null), sub(2, 'רונית')], DATE)), ['L1', 'L2']);
  // Period 2 is free: 1 and 3 are not one card.
  assert.deepEqual(shape(t.dayEntries([lesson(1, 'מתמטיקה', null, null), lesson(3, 'מתמטיקה', null, null)], DATE)), ['L1', 'L3']);
  // Another teacher's group of the same subject is not the same lesson.
  assert.deepEqual(shape(t.dayEntries([lesson(1, 'מתמטיקה', null, null), lesson(2, 'מתמטיקה', null, null, 'regular', { teacher: 'לוי' })], DATE)), ['L1', 'L2']);
  // Cancelled ones of one subject are a run, not a block.
  assert.deepEqual(shape(t.dayEntries([lesson(1, 'ספרות', null, null, 'cancelled'), lesson(2, 'ספרות', null, null, 'cancelled')], DATE)), ['run(1,2)']);
});

test('dayEntries: lessons apart, each period is a row of its own, and only a block changes', () => {
  const apart = { lessonsApart: true };
  const physics = [
    lesson(1, 'פיזיקה', '08:00', '08:45'),
    lesson(2, 'פיזיקה', '08:45', '09:30'), event('חוג גיטרה', '09:00', '09:45'),
    lesson(3, 'פיזיקה', '09:45', '10:30'),
  ];
  // The event stays where the clock puts it, between the rows it fell between.
  assert.deepEqual(shape(t.dayEntries(physics, DATE, apart)), ['L1', 'L2', 'event~', 'L3']);
  assert.deepEqual(shape(t.dayEntries(physics, DATE)), ['block(1,2,3)', 'event~']);
  // Cancelled ones stay one line, which opens by itself.
  const cancelled = [lesson(1, 'ספרות', null, null, 'cancelled'), lesson(2, 'ספרות', null, null, 'cancelled'), lesson(3, 'אנגלית', null, null)];
  assert.deepEqual(shape(t.dayEntries(cancelled, DATE, apart)), ['run(1,2)', 'L3']);
});

test('dayEntries: events in school hours, and all-day ones, are slim; after school they stay cards', () => {
  const mixed = [
    event('יום הולדת', '00:00', '23:59', true),
    ...day.slice(0, 3),
    event('פגישה עם היועצת', '10:00', '10:20'),
    event('חוג כדורסל', '17:00', '18:30'),
  ];
  assert.deepEqual(shape(t.dayEntries(mixed, DATE)), ['event~', 'block(1,2)', 'L3', 'event~', 'event']);
  // A day without lessons: every event is a card.
  assert.deepEqual(shape(t.dayEntries([event('יום הולדת', '00:00', '23:59', true), event('חוג', '10:00', '11:00')], DATE)), ['event', 'event']);
  // Cancelled lessons are not school hours: the day ends at 10:30.
  assert.deepEqual(shape(t.dayEntries([...day, event('ספרייה', '12:00', '13:00')], DATE)), ['block(1,2)', 'L3', 'run(4,5,6,7)', 'event']);
});

test('dayEntries: cancelled-run labels at the start, in the middle, untimed, with a gap', () => {
  const late = [
    lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), lesson(2, 'היסטוריה', '08:45', '09:30', 'cancelled'),
    lesson(3, 'אנגלית', '09:45', '10:30'),
  ];
  assert.equal(text(t.dayEntries(late, DATE)[0].label), 'שיעורים 1–2 בוטלו, מתחילים ב־09:45');
  const middle = [
    lesson(1, 'פיזיקה', '08:00', '08:45'),
    lesson(2, 'ספרות', '08:45', '09:30', 'cancelled'), lesson(3, 'היסטוריה', '09:45', '10:30', 'cancelled'),
    lesson(4, 'אנגלית', '10:45', '11:30'),
  ];
  const entries = t.dayEntries(middle, DATE);
  assert.deepEqual(shape(entries), ['L1', 'run(2,3)', 'L4']);
  assert.equal(text(entries[1].label), 'שיעורים 2–3 בוטלו, חופשי 08:45–10:45');
  assert.equal(text(t.dayEntries(day.slice(3), DATE)[0].label), 'שיעורים 4–7 בוטלו');
  const untimed = [lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'ספרות', null, null, 'cancelled'), lesson(3, 'היסטוריה', null, null, 'cancelled')];
  assert.equal(text(t.dayEntries(untimed, DATE)[1].label), 'שיעורים 2–3 בוטלו');
  // Period 5 is not on the list (a free period, or another group's): the periods are named, not a range.
  const gap = [lesson(3, 'אנגלית', '09:45', '10:30'), lesson(4, 'היסטוריה', '10:45', '11:30', 'cancelled'), lesson(6, 'מתמטיקה', '12:30', '13:15', 'cancelled')];
  const label = t.dayEntries(gap, DATE)[1].label;
  assert.equal(text(label), 'שיעורים 4, 6 בוטלו, חופשי מ־10:30');
  assert.deepEqual(label.filter((p) => p.ltr).map((p) => p.text), ['4, 6', '10:30']);
});

test('a cancelled run draws apart: the periods struck, the gap under them (plan §16.1)', () => {
  const run = t.dayEntries(day, DATE)[2];
  // The row strikes the periods and writes "בוטלו" beside them; the gap is its own muted line.
  assert.equal(text(t.cancelledRunPeriods(run.lessons)), 'שיעורים 4–7');
  assert.equal(text(run.free), 'חופשי מ־10:30');
  assert.deepEqual(run.free.filter((p) => p.ltr).map((p) => p.text), ['10:30']);
  assert.equal(text(t.cancelledRunPeriods([run.lessons[0]])), 'שיעור 4');
  // Nothing that takes place around it, or no clock times: no gap to speak of.
  assert.equal(t.dayEntries(day.slice(3), DATE)[0].free, null);
  const untimed = [lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'ספרות', null, null, 'cancelled'), lesson(3, 'היסטוריה', null, null, 'cancelled')];
  assert.equal(t.dayEntries(untimed, DATE)[1].free, null);
  // No "·" anywhere (Wave 9 re-rate): the label for a screen reader joins the two with a comma.
  assert.ok(!text(run.free).includes('·'));
  assert.ok(!text(run.label).includes('·'));
  assert.equal(text(run.label), 'שיעורים 4–7 בוטלו, חופשי מ־10:30');
});

test('nowEntryIndex: before a folded row until it starts, after it from then on', () => {
  const entries = t.dayEntries(day, DATE); // block(1,2) 08:00, L3 09:45, run(4–7) 10:45
  assert.equal(t.nowEntryIndex(entries, at('10:35')), 2); // 4–7 start at 10:45: "now" goes before the run
  assert.equal(t.nowEntryIndex(entries, at('11:00')), 3); // inside 4–7: after the folded row, never inside it
  assert.equal(t.nowEntryIndex(entries, at('07:00')), 0);
  assert.equal(t.nowEntryIndex(entries, at('09:00')), 1); // inside 1–2: after the block
});

test('entryIsPast: over once the last lesson or the event has ended (W4-8)', () => {
  const entries = t.dayEntries([...day, event('חוג', '17:00', '18:30'), event('יום הולדת', '00:00', '23:59', true)], DATE);
  const past = (hhmm) => entries.map((e) => t.entryIsPast(e, DATE, at(hhmm)));
  // block(1,2) ends 09:30, L3 10:30, run 14:00, the event 18:30; an all-day event lasts the day.
  assert.deepEqual(past('09:29'), [false, false, false, false, false]);
  assert.deepEqual(past('09:30'), [true, false, false, false, false]);
  assert.deepEqual(past('14:00'), [true, true, true, false, false]);
  assert.deepEqual(past('23:00'), [true, true, true, true, false]);
  assert.equal(t.entryIsPast({ kind: 'item', item: task('x') }, DATE, at('23:00')), false);
  assert.equal(t.entryIsPast({ kind: 'item', item: lesson(1, 'x', null, null) }, DATE, at('23:00')), false);
});

// ---- R-10: days without school ------------------------------------------------

test('noSchoolDay: an empty Friday, Shabbat, a holiday by name; school days are null', () => {
  const FRIDAY = '2026-10-09';
  assert.deepEqual(t.noSchoolDay({ date: FRIDAY, isSchoolDay: true, holidayName: null }, 0), { title: 'אין לימודים ביום שישי', detail: null });
  assert.equal(t.noSchoolDay({ date: FRIDAY, isSchoolDay: true, holidayName: null }, 4), null);
  assert.deepEqual(t.noSchoolDay({ date: '2026-10-10', isSchoolDay: false, holidayName: 'שבת' }, 0), { title: 'אין לימודים בשבת', detail: null });
  assert.deepEqual(t.noSchoolDay({ date: '2026-09-21', isSchoolDay: false, holidayName: 'יום כיפור' }, 0), { title: 'יום כיפור', detail: 'אין לימודים' });
  // The "חופש" switch: the weekday, not the placeholder name.
  assert.deepEqual(t.noSchoolDay({ date: DATE, isSchoolDay: false, holidayName: 'חופש' }, 0), { title: 'אין לימודים ביום חמישי', detail: null });
  // A weekday with no lessons yet (not published) is still a school day.
  assert.equal(t.noSchoolDay({ date: DATE, isSchoolDay: true, holidayName: null }, 0), null);
});

test('nextSchoolDay: Friday and Shabbat lead to Sunday; a holiday Sunday to Monday', () => {
  // The week views: Sunday–Friday of this week and the next (no Saturday in them).
  const week = (dates, overrides = {}) => dates.map((date) => ({ date, isSchoolDay: true, lessons: 7, ...(overrides[date] ?? {}) }));
  const thisWeek = week(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'], { '2026-10-09': { lessons: 0 } });
  const nextWeek = week(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  const known = [...thisWeek, ...nextWeek];
  assert.equal(t.nextSchoolDay('2026-10-09', known), '2026-10-11'); // Friday → Sunday
  assert.equal(t.nextSchoolDay('2026-10-10', known), '2026-10-11'); // Shabbat → Sunday
  // Thursday, with an empty Friday and a holiday on Sunday → Monday.
  const holiday = [...thisWeek, ...week(['2026-10-11', '2026-10-12'], { '2026-10-11': { isSchoolDay: false, lessons: 0 } })];
  assert.equal(t.nextSchoolDay('2026-10-08', holiday), '2026-10-12');
  // A Friday with lessons is a school day.
  assert.equal(t.nextSchoolDay('2026-10-08', week(['2026-10-09'])), '2026-10-09');
  // Nothing known (still loading, or failed), or no school in what is known (the summer): no guess.
  assert.equal(t.nextSchoolDay('2026-10-09', []), null);
  assert.equal(t.nextSchoolDay('2026-07-10', week(['2026-07-12', '2026-07-13'], { '2026-07-12': { isSchoolDay: false }, '2026-07-13': { isSchoolDay: false } })), null);
});

test('dueNames: tomorrow\'s line names each subject once, then task titles', () => {
  const hw = [homework('היסטוריה (יב2)'), homework('היסטוריה'), homework('מתמטיקה', true), homework('אנגלית 5 יח״ל')];
  assert.deepEqual(t.dueNames([task('לחתום על טופס')], hw), ['היסטוריה', 'אנגלית', 'לחתום על טופס']);
  assert.deepEqual(t.dueNames([], []), []);
});

test('dueSectionTitle and changesLabel read naturally', () => {
  assert.equal(t.dueSectionTitle(DATE, DATE), 'להגשה היום');
  assert.equal(t.dueSectionTitle('2026-10-09', DATE), 'להגשה מחר');
  assert.equal(t.dueSectionTitle('2026-10-12', DATE), 'להגשה ביום הזה');
  // The changes name their day, not "ביום הזה" (Wave 9 re-rate): "4 שינויים היום".
  assert.equal(t.changesLabel(1, DATE, DATE), 'שינוי אחד היום');
  assert.equal(t.changesLabel(4, DATE, DATE), '4 שינויים היום');
  assert.equal(t.changesLabel(2, '2026-10-09', DATE), '2 שינויים מחר');
  assert.equal(t.changesLabel(3, '2026-10-07', DATE), '3 שינויים אתמול');
  assert.equal(t.changesLabel(4, '2026-10-11', DATE), '4 שינויים ביום ראשון');
  assert.equal(t.changesLabel(1, '2026-10-10', DATE), 'שינוי אחד בשבת');
  assert.equal(t.changesDayWord(DATE, DATE), 'היום');
});

test('changedLessons: everything not regular', () => {
  assert.deepEqual(t.changedLessons(day).map((l) => l.hourIndex), [4, 5, 6, 7]);
});

test('nowInsertionIndex: before the first item that has not started', () => {
  const timeline = [event('כל היום', '00:00', '23:59', true), ...day.slice(0, 3), task('x')];
  assert.equal(t.nowInsertionIndex(timeline, at('07:00')), 1);
  assert.equal(t.nowInsertionIndex(timeline, at('09:00')), 3);
  assert.equal(t.nowInsertionIndex(timeline, at('12:00')), timeline.length);
});

test('statusExplanation and sourceLabel are plain Hebrew', () => {
  assert.equal(t.statusExplanation('cancelled'), 'השיעור בוטל ולא יתקיים.');
  assert.equal(t.statusExplanation('regular'), 'שיעור רגיל, בלי שינויים.');
  for (const s of ['substitution', 'moved', 'remote', 'exam', 'event']) assert.match(t.statusExplanation(s), /[א-ת]/);
  assert.equal(t.sourceLabel('shahaf'), 'אתר בית הספר');
  assert.equal(t.sourceLabel('mashov'), 'משוב');
});

test('weekOffset: Sunday-first weeks, like the site\'s week parameter', () => {
  assert.equal(t.weekOffset('2026-10-08', '2026-10-08'), 0);
  assert.equal(t.weekOffset('2026-10-04', '2026-10-08'), 0); // Sunday of the same week
  assert.equal(t.weekOffset('2026-10-11', '2026-10-08'), 1);
  assert.equal(t.weekOffset('2026-10-03', '2026-10-08'), -1); // Saturday before
  assert.equal(t.weekOffset('2026-10-27', '2026-10-08'), 3); // across the DST change
});

test('lessonSiteUrl: the site\'s changes list for a change, the week otherwise; nothing off the site', () => {
  const changed = day[3].lesson;
  const site = 'https://school.shahaf.site/';
  assert.equal(t.lessonSiteUrl(changed, site, '7', DATE), 'https://school.shahaf.site/?cls=7&tab=changes');
  assert.equal(t.lessonSiteUrl(day[0].lesson, site, '7', DATE), 'https://school.shahaf.site/?cls=7&tab=changestable');
  assert.equal(t.lessonSiteUrl({ ...day[0].lesson, date: '2026-10-13' }, site, '7', DATE), 'https://school.shahaf.site/?cls=7&tab=changestable&week=1');
  assert.equal(t.lessonSiteUrl({ ...day[0].lesson, source: 'mashov' }, site, '7', DATE), null);
  assert.equal(t.lessonSiteUrl(day[0].lesson, site, '', DATE), null);
  assert.equal(t.lessonSiteUrl(day[0].lesson, null, '7', DATE), null);
});

test('lessonTimeParts and eventTimeLabel', () => {
  assert.equal(text(t.lessonTimeParts(day[2].lesson)), 'שיעור 3, 09:45–10:30');
  assert.equal(text(t.lessonTimeParts(lesson(2, 'x', null, null).lesson)), 'שיעור 2');
  assert.equal(t.eventTimeLabel(event('x', '16:00', '17:30').event), '16:00–17:30');
  assert.equal(t.eventTimeLabel(event('x', '00:00', '23:59', true).event), 'כל היום');
});

test('examStrip: on today, the countdown and nothing else, "עוד 12 ימים"', () => {
  const next = { exam: { naturalKey: 'e', date: '2026-10-20', subject: 'אנגלית (יב2)', details: null, source: 'school_site' }, daysAway: 12 };
  // Thursday 8.10: twelve days.
  const strip = t.examStrip(next, DATE);
  assert.equal(strip.subject, 'אנגלית');
  assert.equal(text(strip.when), 'עוד 12 ימים');
  assert.equal(strip.dated, false);
  // The row's end value (plan §16.1: a hero number).
  assert.equal(strip.days, 12);
  assert.equal(t.examStrip(next, '2026-10-20').days, 0);
  assert.deepEqual(t.examStrip(next, DATE, DATE), strip);
  assert.equal(text(t.examStrip(next, '2026-10-18').when), 'עוד יומיים');
  assert.equal(text(t.examStrip(next, '2026-10-19').when), 'מחר');
  assert.equal(text(t.examStrip(next, '2026-10-20').when), 'היום');
});

test('examStrip: on any other day, the date without a count — one number, never two (Wave 7; Itai, Maya, Daniel, run 6)', () => {
  const next = { exam: { naturalKey: 'e', date: '2026-10-20', subject: 'אנגלית (יב2)', details: null, source: 'school_site' }, daysAway: 9 };
  // Thursday 8.10 with Sunday 11.10 on screen: "יום שלישי 20.10", not "עוד 12 ימים (9 ימים מיום ראשון)".
  // The one form an exam's date is written in, on Today as on School and in the sheet (Wave 9 re-rate).
  const sunday = t.examStrip(next, DATE, '2026-10-11');
  assert.equal(text(sunday.when), 'יום שלישי 20.10');
  assert.equal(sunday.dated, true);
  assert.equal(sunday.days, null);
  // The date runs through Ltr; no count of days anywhere in the line.
  assert.deepEqual(sunday.when.filter((p) => p.ltr).map((p) => p.text), ['20.10']);
  assert.doesNotMatch(text(sunday.when), /עוד|ימים|\(/);
  // A day before today, the exam's own day, and a Shabbat exam ("שבת", as the server names it).
  assert.equal(text(t.examStrip(next, DATE, '2026-10-06').when), 'יום שלישי 20.10');
  assert.equal(text(t.examStrip(next, DATE, '2026-10-20').when), 'יום שלישי 20.10');
  const shabbat = { ...next, exam: { ...next.exam, date: '2026-10-17' } };
  assert.equal(text(t.examStrip(shabbat, DATE, '2026-10-11').when), 'שבת 17.10');
  // An exam already past (an old day's next exam): its date, even on today.
  assert.equal(text(t.examStrip(next, '2026-10-22').when), 'יום שלישי 20.10');
  assert.equal(t.examStrip(next, '2026-10-22').dated, true);
});

test('nextDayWord and nextDueTitle: "מחר", or the weekday when the next school day is further (W4-1)', () => {
  // Thursday 8.10 → Friday is tomorrow; Sunday 11.10 is the next school day.
  assert.equal(t.nextDayWord('2026-10-09', DATE), 'מחר');
  assert.equal(t.nextDayWord('2026-10-11', DATE), 'ביום ראשון');
  assert.equal(t.nextDueTitle('2026-10-09', DATE), 'מחר להגשה');
  assert.equal(t.nextDueTitle('2026-10-11', DATE), 'ליום ראשון להגשה');
  // After a holiday Sunday, Monday.
  assert.equal(t.nextDueTitle('2026-10-12', DATE), 'ליום שני להגשה');
  // Run 8 (Noa): Friday's work listed under Sunday's heading: "עד", as the day's own list says it.
  assert.equal(t.nextDueTitle('2026-10-11', DATE, true), 'להגשה עד יום ראשון');
  assert.equal(t.nextDueTitle('2026-10-09', DATE, true), 'להגשה עד מחר');
  assert.equal(t.nextDueTitle('2026-10-11', DATE, false), 'ליום ראשון להגשה');
  // The study sessions' own heading names the day as well (W6-6).
  assert.equal(t.nextStudyTitle('2026-10-09', DATE), 'מחר ללמוד');
  assert.equal(t.nextStudyTitle('2026-10-11', DATE), 'ביום ראשון ללמוד');
});

test('nextLessonDate: the next day the subject is taught, skipping cancellations (W4, Itai)', () => {
  const on = (date, ...items) => ({ date, timeline: items.map((i) => ({ ...i, lesson: { ...i.lesson, date } })) });
  const days = [
    on('2026-10-08', lesson(1, 'אנגלית 5 יח״ל (יב3)', '08:00', '08:45')),
    on('2026-10-11', lesson(1, 'אנגלית 5 יח״ל (יב3)', '08:00', '08:45', 'cancelled'), lesson(2, 'פיזיקה', '08:45', '09:30')),
    on('2026-10-12', lesson(3, 'אנגלית 5 יח״ל (יב3)', '09:45', '10:30')),
    on('2026-10-13', lesson(3, 'אנגלית (יב3)', '09:45', '10:30')),
  ];
  // Thursday's English: Sunday's is cancelled, so Monday.
  assert.equal(t.nextLessonDate({ subject: 'אנגלית 5 יח״ל (יב3)' }, '2026-10-08', days), '2026-10-12');
  // Named differently on the site later on: the plain subject still finds it.
  assert.equal(t.nextLessonDate({ subject: 'אנגלית 4 יח״ל' }, '2026-10-12', days), '2026-10-13');
  assert.equal(t.nextLessonDate({ subject: 'פיזיקה' }, '2026-10-11', days), null);
  assert.equal(t.nextLessonDate({ subject: 'פיזיקה' }, '2026-10-08', []), null);
});

test('subjectNotes: a lab or a room is a place; anything else in brackets is a group', () => {
  assert.deepEqual(t.subjectNotes('פיזיקה (מעבדת פיזיקה)'), { group: null, place: 'מעבדת פיזיקה' });
  assert.deepEqual(t.subjectNotes('אנגלית 5 יח״ל (יב3)'), { group: 'יב3', place: null });
  assert.deepEqual(t.subjectNotes('שרותי רשת (יב2) (מעבדת מחשבים 1)'), { group: 'יב2', place: 'מעבדת מחשבים 1' });
  assert.deepEqual(t.subjectNotes('ספרות'), { group: null, place: null });
});

/** Lines of "השיעורים שלי" as GET /settings lists them: names and teachers in the server's `subjectKey` form. */
const LINES = [
  { key: 'אזרחות', name: 'אזרחות', teacher: 'לוי' },
  { key: 'אזרחות (יב2)', name: 'אזרחות (יב2)', teacher: 'לוי' },
  { key: 'חינוך גופני @ דנה אלון', name: 'חינוך גופני', teacher: 'דנה אלון' },
  { key: 'חינוך גופני @ רון כץ', name: 'חינוך גופני', teacher: 'רון כץ' },
  { key: 'אנגלית 5 יח"ל (יב3)', name: 'אנגלית 5 יח"ל (יב3)', teacher: 'כהן' },
  { key: 'כימיה', name: 'כימיה', teacher: null },
].map((line) => ({ inMashov: false, count: 4, ...line }));
const L = (subject, teacher) => ({ subject, teacher });

test('lessonHideKeys: the key "השיעורים שלי" holds for the line — plain, or with the teacher (W5-5)', () => {
  assert.deepEqual(t.lessonHideKeys(L('כימיה', 'שרון'), LINES), ['כימיה']);
  // Two teachers share the subject: the key names the right one, never both — they are two rows.
  assert.deepEqual(t.lessonHideKeys(L('חינוך גופני', 'רון כץ'), LINES), ['חינוך גופני @ רון כץ']);
  assert.deepEqual(t.lessonHideKeys(L('חינוך גופני', 'דנה אלון'), LINES), ['חינוך גופני @ דנה אלון']);
  // The site's quote marks and spacing do not matter: matched the way the server keys them.
  assert.deepEqual(t.lessonHideKeys(L('אנגלית  5 יח״ל (יב3)', 'כהן'), LINES), ['אנגלית 5 יח"ל (יב3)']);
});

test('lessonHideKeys: the whole row of "השיעורים שלי" goes, so its switch turns off — never "mixed" (W5-7)', () => {
  const row = ['אזרחות', 'אזרחות (יב2)'];
  assert.deepEqual(t.lessonHideKeys(L('אזרחות (יב2)', 'לוי'), LINES).sort(), [...row].sort());
  assert.deepEqual(t.lessonHideKeys(L('אזרחות', 'לוי'), LINES).sort(), [...row].sort());
  // The same keys the row's switch moves.
  const school = load(path.join(__dirname, '../src/lib/school.ts'));
  const group = school.groupLessonOptions(LINES).find((g) => g.keys.includes('אזרחות (יב2)'));
  assert.deepEqual(t.lessonHideKeys(L('אזרחות (יב2)', 'לוי'), LINES).sort(), [...group.keys].sort());
  // Saved as the row's switch saves them; "לבטל" brings back only what was added.
  const hidden = school.setKeysShown(['כימיה'], t.lessonHideKeys(L('אזרחות', 'לוי'), LINES), false);
  assert.deepEqual(hidden.sort(), ['אזרחות', 'אזרחות (יב2)', 'כימיה'].sort());
  assert.deepEqual(school.setKeysShown(hidden, row, true), ['כימיה']);
});

test('lessonHideKeys: no line for the lesson, no key — and so no button', () => {
  assert.deepEqual(t.lessonHideKeys(L('פיזיקה', 'כהן'), LINES), []);
  assert.deepEqual(t.lessonHideKeys(L('חינוך גופני', 'מורה אחרת'), LINES), []);
  assert.deepEqual(t.lessonHideKeys(L('כימיה', null), []), []);
});

test('hideLessonQuestion: names the subject, every day, its homework, and the way back (V2, Maya, run 5)', () => {
  const q = t.hideLessonQuestion('פיזיקה');
  assert.equal(q.title, 'להסתיר את פיזיקה בכל הימים?');
  assert.equal(q.detail, 'גם שיעורי הבית בפיזיקה לא יופיעו. אפשר להחזיר בהגדרות, ב״מה מוצג״, תחת ״השיעורים שלי״.');
  // No arrow glyph (plan §1 rule 7), and nothing addressed to one gender.
  assert.doesNotMatch(`${q.title} ${q.detail}`, /[←→]|תוכל|תחזיר|בטוח /);
});

test('hideLessonQuestion: on a parent\'s phone the way back is the parent\'s row, "השיעורים שמוצגים"', () => {
  const q = t.hideLessonQuestion('פיזיקה', true);
  assert.equal(q.title, 'להסתיר את פיזיקה בכל הימים?');
  assert.equal(q.detail, 'גם שיעורי הבית בפיזיקה לא יופיעו. אפשר להחזיר בהגדרות, ב״מה מוצג״, תחת ״השיעורים שמוצגים״.');
});

test('hiddenFromSheetNotes: today\'s hides while still hidden; gone at midnight or once brought back (V2)', () => {
  const physics = { subject: 'פיזיקה', keys: ['פיזיקה מורחב (יב2)', 'פיזיקה מורחב'], date: DATE };
  const civics = { subject: 'אזרחות', keys: ['אזרחות'], date: DATE };
  const notes = [physics, civics];
  assert.deepEqual(t.hiddenFromSheetNotes(notes, ['כימיה', 'פיזיקה מורחב', 'אזרחות'], DATE), [physics, civics]);
  // Physics brought back in "השיעורים שלי": its line goes, the other stays.
  assert.deepEqual(t.hiddenFromSheetNotes(notes, ['כימיה', 'אזרחות'], DATE), [civics]);
  // The next day, nothing.
  assert.deepEqual(t.hiddenFromSheetNotes(notes, ['פיזיקה מורחב', 'אזרחות'], '2026-10-09'), []);
  assert.deepEqual(t.hiddenFromSheetNotes([], ['אזרחות'], DATE), []);
  // The line's words, beside "להחזיר".
  assert.equal(t.hiddenNoteText('חינוך גופני'), 'הסתרת את חינוך גופני');
});

test('addHiddenNote and forgetHiddenKeys: two rows of one name hidden the same day share a line (V2)', () => {
  // Two teachers' "חינוך גופני" are two rows; both hidden from the sheet on Thursday.
  const dana = { subject: 'חינוך גופני', keys: ['חינוך גופני @ דנה אלון'], date: DATE };
  const ron = { subject: 'חינוך גופני', keys: ['חינוך גופני @ רון כץ'], date: DATE };
  const both = t.addHiddenNote(t.addHiddenNote([], dana), ron);
  assert.deepEqual(both, [{ subject: 'חינוך גופני', keys: ['חינוך גופני @ דנה אלון', 'חינוך גופני @ רון כץ'], date: DATE }]);
  // "לבטל" on the second toast puts back Ron's row only: Dana's stays hidden, and so does the line.
  assert.deepEqual(t.forgetHiddenKeys(both, 'חינוך גופני', ron.keys), [{ ...dana }]);
  // "להחזיר" on the line puts back both: the line goes.
  assert.deepEqual(t.forgetHiddenKeys(both, 'חינוך גופני', both[0].keys), []);
  // A note left from another day is replaced, not joined; other subjects are left alone.
  const physics = { subject: 'פיזיקה', keys: ['פיזיקה'], date: DATE };
  const old = { ...dana, date: '2026-10-07' };
  assert.deepEqual(t.addHiddenNote([old, physics], ron), [physics, ron]);
  assert.deepEqual(t.forgetHiddenKeys([physics, ron], 'חינוך גופני', ron.keys), [physics]);
});

test('detailLabel: number ranges are isolated, so "שיעורים 1–2" never reads "2–1" (W5-5, Daniel)', () => {
  const LRI = String.fromCharCode(0x2066);
  const PDI = String.fromCharCode(0x2069);
  const block = [lesson(1, 'אנגלית', '08:00', '08:45').lesson, lesson(2, 'אנגלית', '08:45', '09:30').lesson];
  // The dash joined to its numbers (a word joiner each side), so the range never breaks across lines.
  const J = String.fromCharCode(0x2060);
  const label = t.detailLabel('שעה', t.blockTimeParts(block));
  assert.equal(label, `שעה: שיעורים ${LRI}1${J}–${J}2${PDI}, ${LRI}08:00${J}–${J}09:30${PDI}`);
  assert.equal(t.detailLabel('מורה', 'כהן'), 'מורה: כהן');
  // The drawn row isolates the same runs: both ranges are LTR parts.
  assert.deepEqual(t.blockTimeParts(block).filter((p) => p.ltr).map((p) => p.text), ['1–2', '08:00–09:30']);
});

function schoolEvent(title, details = null) {
  return { naturalKey: `ev-${title}`, date: DATE, title, details, source: 'shahaf' };
}

test('isFullDayEvent: a trip, a tour, a sports day, יום שיא, gadna, a journey — as words (W5-3)', () => {
  for (const title of [
    'טיול שנתי', 'הטיול השנתי לצפון', 'שכבת יב - טיול שנתי', 'סיור לימודי בירושלים', 'יום ספורט', 'יום הספורט השכבתי',
    'יום שיא', 'יום שיא שכבתי', 'גדנ״ע', 'שבוע גדנ"ע', 'גדנע', 'מסע לפולין', 'טיולים בשכבה',
  ]) {
    assert.equal(t.isFullDayEvent(schoolEvent(title)), true, title);
  }
  for (const title of ['מבחן במתמטיקה', 'ארוחה במסעדה', 'הרצאה', 'יום הורים', 'ספורטיבי']) {
    assert.equal(t.isFullDayEvent(schoolEvent(title)), false, title);
  }
});

test('isFullDayEvent: without the day\'s hours, any clock range means part of the day (the spec\'s rule)', () => {
  assert.equal(t.isFullDayEvent(schoolEvent('סיור לימודי', 'בשעות 08:00–12:00')), false);
  assert.equal(t.isFullDayEvent(schoolEvent('סיור לימודי', '8:30-11:45, יציאה מהשער')), false);
  assert.equal(t.isFullDayEvent(schoolEvent('יום ספורט 10:00 - 13:00')), false);
  // A range of periods is part of the day, whatever the hours.
  assert.equal(t.isFullDayEvent(schoolEvent('יום שיא', 'שיעורים 1–4')), false);
  assert.equal(t.isFullDayEvent(schoolEvent('יום שיא', 'שיעורים 1–4'), 14 * 60), false);
  // A departure time, an end time alone, or the dates of a trip of several days are not ranges within the day.
  assert.equal(t.isFullDayEvent(schoolEvent('טיול שנתי', 'יציאה ב־07:30 מהחניה')), true);
  assert.equal(t.isFullDayEvent(schoolEvent('טיול שנתי', 'חזרה עד 18:00')), true);
  assert.equal(t.isFullDayEvent(schoolEvent('טיול שנתי', '12.10–14.10')), true);
});

test('isFullDayEvent: with the day\'s hours, only a time that ends while school is on means part of it', () => {
  const end = 14 * 60; // the last lesson ends at 14:00
  // Over before school is: part of the day.
  assert.equal(t.isFullDayEvent(schoolEvent('סיור לימודי', '08:00–12:00'), end), false);
  assert.equal(t.isFullDayEvent(schoolEvent('יום ספורט', 'עד השעה 12:00'), end), false);
  // Until school ends, or later: the whole day — a real trip notice says when the bus is back.
  assert.equal(t.isFullDayEvent(schoolEvent('טיול שנתי', 'יציאה 07:30, חזרה עד 18:00'), end), true);
  assert.equal(t.isFullDayEvent(schoolEvent('טיול שנתי', '07:30–17:00'), end), true);
  assert.equal(t.isFullDayEvent(schoolEvent('יום ספורט', 'עד 13:45'), end), true); // within half an hour of the end
  assert.equal(t.isFullDayEvent(schoolEvent('יום ספורט', 'עד 13:15'), end), false);
});

test('fullDayEvent: reads the day\'s end from every lesson, the cancelled ones too', () => {
  // `day` runs to 14:00, periods 4–7 cancelled — as a trip day often is.
  const view = (details) => ({ isSchoolDay: true, timeline: day, events: [schoolEvent('טיול שנתי', details)] });
  assert.equal(t.fullDayEvent(view('יציאה 07:30, חזרה עד 18:00')).title, 'טיול שנתי');
  assert.equal(t.fullDayEvent(view('בשעות 08:00–10:30')), null);
});

test('isFullDayEvent: a title about the day, not the day itself, is not one', () => {
  assert.equal(t.isFullDayEvent(schoolEvent('אסיפת הורים לקראת הטיול')), false);
  assert.equal(t.isFullDayEvent(schoolEvent('תשלום עבור הטיול השנתי')), false);
  assert.equal(t.isFullDayEvent(schoolEvent('הרשמה למסע לפולין')), false);
});

test('fullDayEvent: only on a school day with lessons; the first such event wins', () => {
  const lessons = day.slice(0, 3);
  const trip = schoolEvent('טיול שנתי');
  const view = (over) => ({ isSchoolDay: true, timeline: lessons, events: [schoolEvent('יום הורים'), trip], ...over });
  assert.equal(t.fullDayEvent(view({})), trip);
  assert.equal(t.fullDayEvent(view({ events: [schoolEvent('יום הורים')] })), null);
  // A trip on a Friday without lessons, or in the holidays, changes nothing to fold.
  assert.equal(t.fullDayEvent(view({ timeline: [] })), null);
  assert.equal(t.fullDayEvent(view({ isSchoolDay: false })), null);
});

test('foldedLessonsLabel and fullDayNowNext', () => {
  assert.equal(t.foldedLessonsLabel(7), 'לפי המערכת: 7 שיעורים');
  assert.equal(t.foldedLessonsLabel(1), 'לפי המערכת: שיעור אחד');
  const n = t.fullDayNowNext(schoolEvent('טיול שנתי'));
  assert.equal(text(n.primary), 'טיול שנתי');
  assert.equal(n.secondary, null);
});

/** Known days as the screen builds them: Sunday–Friday week views (no Shabbat in them), plus today's own view. */
function knownWeeks(overrides = {}) {
  const dates = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  return dates.map((date) => ({ date, isSchoolDay: true, lessons: date === '2026-10-09' || date === '2026-10-16' ? 0 : 7, holidayName: null, ...(overrides[date] ?? {}) }));
}
const SHABBAT = { date: '2026-10-10', isSchoolDay: false, lessons: 0, holidayName: 'שבת' };

test('landingDate: a school day stays today, evening included — no jump (W5-2)', () => {
  // Thursday: a school day, whatever the hour — the landing never looks at the clock.
  assert.equal(t.landingDate('2026-10-08', knownWeeks(), true), '2026-10-08');
  // Decided from today's own view alone, without waiting for the weeks.
  assert.equal(t.landingDate('2026-10-08', [{ date: '2026-10-08', isSchoolDay: true, lessons: 7 }], false), '2026-10-08');
});

test('landingDate: Friday, Shabbat and a holiday land on the next school day', () => {
  assert.equal(t.landingDate('2026-10-09', knownWeeks(), true), '2026-10-11'); // an empty Friday → Sunday
  assert.equal(t.landingDate('2026-10-10', [SHABBAT, ...knownWeeks()], true), '2026-10-11'); // Shabbat → Sunday (tomorrow)
  const sukkot = knownWeeks({ '2026-10-11': { isSchoolDay: false, lessons: 0, holidayName: 'שמחת תורה' } });
  assert.equal(t.landingDate('2026-10-11', sukkot, true), '2026-10-12'); // a holiday Sunday → Monday
});

test('landingDate: waits while it cannot tell; settles on today when nothing more will come', () => {
  // Today unknown yet: wait. Today a Friday without school, the days after still loading: wait too.
  assert.equal(t.landingDate('2026-10-09', [], false), null);
  assert.equal(t.landingDate('2026-10-09', [{ date: '2026-10-09', isSchoolDay: true, lessons: 0 }], false), null);
  // Everything failed, or "חופש" makes no day a school day: stay on today.
  assert.equal(t.landingDate('2026-10-09', [], true), '2026-10-09');
  const vacation = knownWeeks(Object.fromEntries(knownWeeks().map((d) => [d.date, { isSchoolDay: false, holidayName: 'חופש' }])));
  assert.equal(t.landingDate('2026-10-07', vacation, true), '2026-10-07');
});

test('landingNote: why it is not today, in plain words', () => {
  assert.equal(t.landingNote('2026-10-09', '2026-10-11', null), 'היום אין לימודים, אז עברנו ליום ראשון');
  assert.equal(t.landingNote('2026-10-10', '2026-10-11', 'שבת'), 'היום אין לימודים, אז עברנו למחר');
  assert.equal(t.landingNote('2026-10-11', '2026-10-12', 'שמחת תורה'), 'היום שמחת תורה ואין לימודים, אז עברנו למחר');
});

test('nextShortcut: the stepper names the next school day with its date — "ראשון 11.10" on a Thursday (W5-2, W6-7)', () => {
  assert.deepEqual(t.nextShortcut('2026-10-08', knownWeeks()), { date: '2026-10-11', label: 'ראשון 11.10', a11y: 'יום הלימודים הבא, יום ראשון 11.10' });
  assert.deepEqual(t.nextShortcut('2026-10-07', knownWeeks()), { date: '2026-10-08', label: 'מחר', a11y: 'מחר, יום חמישי 8.10' });
  assert.equal(t.nextShortcut('2026-10-10', [SHABBAT, ...knownWeeks()]).label, 'מחר');
  // Unknown ahead: tomorrow, as it always was.
  assert.deepEqual(t.nextShortcut('2026-10-08', []), { date: '2026-10-09', label: 'מחר', a11y: 'מחר, יום שישי 9.10' });
  // More than a week off (after a holiday): the same form, the date tells the two Sundays apart.
  const holidays = knownWeeks(Object.fromEntries(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
    .map((d) => [d, { isSchoolDay: false, lessons: 0 }])));
  const later = [...holidays, { date: '2026-10-18', isSchoolDay: true, lessons: 7 }];
  assert.deepEqual(t.nextShortcut('2026-10-08', later), { date: '2026-10-18', label: 'ראשון 18.10', a11y: 'יום הלימודים הבא, יום ראשון 18.10' });
});

test('knownDay: a day view as the landing reads it', () => {
  const view = { date: DATE, isSchoolDay: true, holidayName: null, timeline: [...day, task('לקרוא')] };
  assert.deepEqual(t.knownDay(view), { date: DATE, isSchoolDay: true, lessons: 7, holidayName: null });
});

test('mashovStrip: says Mashov is not connected and offers to connect; nothing while connected (W5-4)', () => {
  assert.equal(t.mashovStrip({ connected: true }), null);
  // Never connected: the full login screen. Dropped: the reconnect sheet (W6-1).
  assert.deepEqual(t.mashovStrip({ connected: false, reason: 'not_configured', lastOkAt: null }), { text: 'משוב לא מחובר', action: 'להתחבר', renew: false });
  assert.deepEqual(
    t.mashovStrip({ connected: false, reason: 'needs_reauth', lastOkAt: '2026-10-08T07:00:00+03:00' }),
    { text: 'משוב ניתק את החיבור', action: 'להתחבר שוב', renew: true },
  );
  // The action in the infinitive, neutral ("להתחבר", never "התחבר"), and none of the words the app keeps out of sight.
  for (const s of [t.mashovStrip({ connected: false, reason: 'not_configured', lastOkAt: null }), t.mashovStrip({ connected: false, reason: 'needs_reauth', lastOkAt: null })]) {
    assert.match(s.action, /^להתחבר/);
    assert.doesNotMatch(`${s.text} ${s.action}`, /סשן|שרת|סנכרון/);
  }
});

test('fabAfterScroll: steps aside reading down, returns going up and at either end (W5-6)', () => {
  const page = (y) => ({ y, contentHeight: 3000, viewportHeight: 600 });
  const shown = (fromY) => ({ shown: true, fromY });
  const aside = (fromY) => ({ shown: false, fromY });
  // Reading down mid-page: aside. A move within the slop changes nothing.
  assert.deepEqual(t.fabAfterScroll(shown(400), page(460)), aside(460));
  assert.deepEqual(t.fabAfterScroll(shown(400), page(400 + t.FAB_SCROLL_SLOP)), shown(400));
  // Back up, by a row: shown again.
  assert.deepEqual(t.fabAfterScroll(aside(900), page(850)), shown(850));
  // At the top and at the end of the page it is always there.
  assert.equal(t.fabAfterScroll(aside(40), page(10)).shown, true);
  assert.equal(t.fabAfterScroll(aside(2300), page(2390)).shown, true);
  // A page too short to scroll keeps it.
  assert.equal(t.fabAfterScroll(shown(0), { y: 0, contentHeight: 500, viewportHeight: 600 }).shown, true);
});

test('fabAfterScroll: a nudge back up to settle a section leaves the "+" aside (Wave 7, Maya, run 6)', () => {
  const page = (y) => ({ y, contentHeight: 3000, viewportHeight: 600 });
  // Read down to a section, then pull back 20 to settle it: still aside.
  let s = t.fabAfterScroll({ shown: true, fromY: 300 }, page(700));
  assert.equal(s.shown, false);
  s = t.fabAfterScroll(s, page(680));
  assert.equal(s.shown, false);
  assert.ok(t.FAB_RETURN_SLOP > 20);
  // A slow drag up adds up from where the page turned, and brings it back past a row.
  for (let y = 675; y >= 700 - t.FAB_RETURN_SLOP - 5; y -= 5) s = t.fabAfterScroll(s, page(y));
  assert.equal(s.shown, true);
  // Down again while aside: the turn moves with the page, so up is measured from the lowest point.
  s = t.fabAfterScroll({ shown: false, fromY: 1000 }, page(1200));
  assert.deepEqual(s, { shown: false, fromY: 1200 });
  assert.equal(t.fabAfterScroll(s, page(1170)).shown, false);
  assert.equal(t.fabAfterScroll(s, page(1200 - t.FAB_RETURN_SLOP - 1)).shown, true);
  // Up while shown, then down past the slop: aside, measured from the highest point.
  s = t.fabAfterScroll({ shown: true, fromY: 1000 }, page(900));
  assert.deepEqual(s, { shown: true, fromY: 900 });
  assert.equal(t.fabAfterScroll(s, page(900 + t.FAB_SCROLL_SLOP + 1)).shown, false);
});

test('dayMarks and marksLabel: the week strip\'s dots — an exam, a change, something open to hand in (W5-6)', () => {
  const exam = { naturalKey: 'e', date: DATE, subject: 'אנגלית', details: null, source: 'school_site' };
  const plain = { examsToday: [], changeCount: 0, timeline: day.slice(0, 3), homework: [] };
  assert.deepEqual(t.dayMarks(plain), { exam: false, change: false, due: false });
  assert.equal(t.marksLabel(t.dayMarks(plain)), '');
  const busy = { examsToday: [exam], changeCount: 4, timeline: [...day, task('לקרוא')], homework: [homework('פיזיקה')] };
  assert.deepEqual(t.dayMarks(busy), { exam: true, change: true, due: true });
  assert.equal(t.marksLabel(t.dayMarks(busy)), 'מבחן, שינויים במערכת, יש להגשה');
  // What is ticked off or completed leaves nothing to hand in.
  const done = { ...plain, timeline: [task('לקרוא', true)], homework: [homework('פיזיקה', true)] };
  assert.equal(t.dayMarks(done).due, false);
});

// ── Wave 7: what waits for the next school day, and Classroom work ──────────

/** A Google task due on `due`, as the tasks feed lists it. */
function feedTask(title, due, completed = false) {
  return { id: `${title}@${due}`, listId: 'l', listTitle: null, title, notes: null, due, completed, updated: null, linkedHomeworkKey: null };
}
/** Mashov homework due on `due`, as the school feed lists it. */
function feedHomework(subject, due, extra = {}) {
  return { naturalKey: `${subject}@${due}`, dueDate: due, subject, text: 'עמ׳ 12', linkedTaskId: null, done: false, ...extra };
}
/** Classroom work due on `due` (or undated), with its submission state. */
function work(title, due, state = 'CREATED') {
  return {
    naturalKey: `classroom|c|${title}`, courseId: 'c', courseName: 'Biology 12', subject: 'ביולוגיה', title, description: null,
    dueDate: due, dueTime: null, link: `https://classroom.google.com/${encodeURIComponent(title)}`, state, late: false,
    grade: null, maxPoints: null, updatedAt: `${DATE}T08:00:00.000Z`,
  };
}
const FRI = '2026-10-09';
const SAT = '2026-10-10';
const SUN = '2026-10-11';
const none = new Set();

test('carryRange: on a Thursday, Friday and Saturday wait for Sunday (Wave 7, Itai, run 6)', () => {
  // On today the next-day line takes the days after today and before Sunday.
  assert.deepEqual(t.carryRange(DATE, DATE, SUN, true), { from: FRI, to: SUN });
  // On Sunday's own view, the same days; today is a school day, so its work stays on today.
  assert.deepEqual(t.carryRange(DATE, SUN, SUN, true), { from: FRI, to: SUN });
  // Next school day tomorrow: nothing in between.
  assert.equal(t.carryRange('2026-10-07', '2026-10-07', DATE, true), null);
  assert.equal(t.carryRange('2026-10-07', DATE, DATE, true), null);
  // Any other day, or the next school day unknown.
  assert.equal(t.carryRange(DATE, '2026-10-12', SUN, true), null);
  assert.equal(t.carryRange(DATE, FRI, SUN, true), null);
  assert.equal(t.carryRange(DATE, DATE, null, true), null);
});

test('carryRange: a Friday without school that opened on Sunday brings its own work along', () => {
  // Today Friday: Sunday's view takes Friday and Saturday.
  assert.deepEqual(t.carryRange(FRI, SUN, SUN, false), { from: FRI, to: SUN });
  // Friday's own view keeps Friday's under "להגשה היום"; Sunday's line takes Saturday.
  assert.deepEqual(t.carryRange(FRI, FRI, SUN, false), { from: SAT, to: SUN });
  // A long holiday: every day of it.
  assert.deepEqual(t.carryRange('2026-10-02', '2026-10-11', '2026-10-11', false), { from: '2026-10-02', to: '2026-10-11' });
});

test('todayHasSchool: by the known days; a Saturday the week views leave out has none', () => {
  const known = [
    { date: DATE, isSchoolDay: true, lessons: 7 },
    { date: FRI, isSchoolDay: true, lessons: 0 },
    { date: '2026-10-12', isSchoolDay: false, lessons: 0, holidayName: 'שמחת תורה' },
  ];
  assert.equal(t.todayHasSchool(DATE, known), true);
  // The server calls every Friday a school day; one without lessons is not.
  assert.equal(t.todayHasSchool(FRI, known), false);
  assert.equal(t.todayHasSchool('2026-10-12', known), false);
  // Not described: Shabbat has none, any other day counts as one until it is known.
  assert.equal(t.todayHasSchool(SAT, known), false);
  assert.equal(t.todayHasSchool('2026-10-13', known), true);
});

test('overdueItems: late Classroom work joins "באיחור" — the same work, and so the same number, as the task list (run 7)', () => {
  const c = load(path.join(__dirname, '../src/lib/classroom.ts'));
  const late = '2026-10-06';
  const classroom = [
    work('דו״ח מעבדה', late),
    work('לפני שבועיים', '2026-09-24'),
    work('לפני 15 ימים', '2026-09-23'),
    work('הוגש', late, 'TURNED_IN'),
    work('הוחזר', late, 'RETURNED'),
    work('עשיתי כאן', late),
    work('בלי תאריך', null),
    work('היום', DATE),
    work('מחר', FRI),
  ];
  const done = new Set([work('עשיתי כאן', late).naturalKey]);
  const items = t.overdueItems([], [], DATE, { work: classroom, done });
  // Not handed in, not marked here, due before today, and no older than the task list keeps (today − 14 in).
  assert.deepEqual(items.map((i) => [i.kind, i.work.title, i.due]), [
    ['classroom', 'לפני שבועיים', '2026-09-24'],
    ['classroom', 'דו״ח מעבדה', late],
  ]);
  // The task list's header counts the same work: "2 באיחור" there is 2 here.
  assert.equal(items.length, c.classroomCounts(classroom, DATE, done).overdue);
  assert.equal(c.classroomCounts(classroom, DATE, new Set()).overdue, t.overdueItems([], [], DATE, { work: classroom }).length);
  // Not connected: nothing, as before.
  assert.deepEqual(t.overdueItems([], [], DATE, { work: null }), []);
  assert.deepEqual(t.overdueItems([], [], DATE), []);
});

test('overdueItems: on one day homework, then Classroom, then tasks; "באיחור" lists them all', () => {
  const late = '2026-10-06';
  const items = t.overdueItems([hw('math', late)], [openTask('tTask', late)], DATE, { work: [work('דו״ח מעבדה', late)] });
  assert.deepEqual(items.map((i) => i.kind), ['homework', 'classroom', 'task']);
  // Each row's margin is its due date.
  assert.deepEqual(items.map((i) => i.due), [late, late, late]);
});

test('homeworkDueParts under "באיחור" reads for Classroom work too: how long ago, not "באיחור" again', () => {
  const w = work('דו״ח מעבדה', '2026-10-06');
  assert.equal(text(t.homeworkDueParts({ dueDate: w.dueDate, done: false }, DATE, true)), 'להגשה ב־6.10, לפני יומיים');
  assert.equal(text(t.homeworkDueParts({ dueDate: '2026-10-07', done: false }, DATE, true)), 'להגשה אתמול');
});

test('dueEntries: a Friday task joins Sunday’s list, oldest first, each with its own date', () => {
  const range = { from: FRI, to: SUN };
  const entries = t.dueEntries(SUN, { homework: [homework('אנגלית')], tasks: [] }, {
    range,
    homework: [feedHomework('היסטוריה', SAT), feedHomework('אנגלית', SUN), feedHomework('פיזיקה', DATE)],
    tasks: [feedTask('להגיש עבודה בהיסטוריה', FRI), feedTask('לקנות מחברת', SUN), feedTask('ישנה', FRI, true), feedTask('ללמוד פרק 3', SAT)],
  });
  assert.deepEqual(entries.map((e) => [e.kind, e.due]), [['task', FRI], ['homework', SAT], ['homework', SUN]]);
  // Sunday's own come from its day view, not again from the feeds; today's homework stays on today.
  assert.equal(entries[2].homework.naturalKey, homework('אנגלית').naturalKey);
});

test('dueEntries: homework that became a task is the task, as the day view leaves it out', () => {
  const entries = t.dueEntries(SUN, { homework: [], tasks: [] }, {
    range: { from: FRI, to: SUN },
    homework: [feedHomework('היסטוריה', SAT, { linkedTaskId: 'x' }), feedHomework('תנ״ך', SAT, { done: true })],
  });
  // Ticked homework stays, drawn ticked, like the day's own.
  assert.deepEqual(entries.map((e) => e.homework.subject), ['תנ״ך']);
});

test('dueEntries: Classroom work due that day joins the list like homework; undated work never does (plan 14.5)', () => {
  const classroom = [work('דוח מעבדה', DATE), work('סיכום', null), work('שאלות', FRI), work('מצגת', SAT, 'TURNED_IN')];
  // Today: only today's.
  const today = t.dueEntries(DATE, { homework: [homework('פיזיקה')], tasks: [task('להביא אישור').task] }, { classroom });
  assert.deepEqual(today.map((e) => e.kind), ['homework', 'classroom', 'task']);
  assert.equal(today[1].work.title, 'דוח מעבדה');
  // Sunday: Friday's and Saturday's wait for it.
  const sunday = t.dueEntries(SUN, { homework: [], tasks: [] }, { range: { from: FRI, to: SUN }, classroom });
  assert.deepEqual(sunday.map((e) => [e.work.title, e.due]), [['שאלות', FRI], ['מצגת', SAT]]);
  // Another day without a range: nothing.
  assert.deepEqual(t.dueEntries('2026-10-12', { homework: [], tasks: [] }, { classroom }), []);
});

test('dueEntries: study tasks are never on the "להגשה" list; studyEntries has them, carried first', () => {
  const own = [task('ללמוד למבחן באנגלית'), task('דוח מעבדה')];
  assert.deepEqual(t.dueEntries(DATE, { homework: [], tasks: own.map((i) => i.task) }).map((e) => e.task.title), ['דוח מעבדה']);
  const study = t.studyEntries([feedTask('ללמוד פרק 1', SUN), feedTask('דוח', SUN)], {
    range: { from: FRI, to: SUN },
    tasks: [feedTask('ללמוד פרק 3', SAT), feedTask('ללמוד פרק 2', FRI), feedTask('ללמוד ישן', FRI, true)],
  });
  assert.deepEqual(study.map((s) => s.title), ['ללמוד פרק 2', 'ללמוד פרק 3', 'ללמוד פרק 1']);
});

test('openDueCount: "הוגש" and "עשיתי" count as done, as ticked homework does', () => {
  const entries = t.dueEntries(DATE, { homework: [homework('פיזיקה'), homework('אנגלית', true)], tasks: [task('להביא אישור').task] }, {
    classroom: [work('הוגש', DATE, 'TURNED_IN'), work('הוחזר', DATE, 'RETURNED'), work('עשיתי כאן', DATE), work('פתוחה', DATE)],
  });
  const doneHere = new Set([work('עשיתי כאן', DATE).naturalKey]);
  // פיזיקה, פתוחה, להביא אישור.
  assert.equal(t.openDueCount(entries, doneHere), 3);
  assert.equal(t.openDueCount(entries, none), 4);
  assert.equal(t.openDueCount([], none), 0);
  assert.equal(t.isDueEntryDone(entries.find((e) => e.kind === 'classroom'), none), true);
});

test('carriedDueParts: a carried row on Sunday’s list says "להגשה ביום ו׳ 9.10", not "להגשה מחר" (run 7)', () => {
  assert.equal(text(t.carriedDueParts(FRI)), 'להגשה ביום ו׳ 9.10');
  assert.equal(text(t.carriedDueParts(SAT)), 'להגשה בשבת 10.10');
  // Classroom's hour, when it is not the end of the day.
  assert.equal(text(t.carriedDueParts(FRI, '14:00')), 'להגשה ביום ו׳ 9.10 עד 14:00');
  assert.equal(text(t.carriedDueParts(FRI, '23:59')), 'להגשה ביום ו׳ 9.10');
  assert.deepEqual(t.carriedDueParts(FRI, '14:00').filter((p) => p.ltr).map((p) => p.text), ['9.10', '14:00']);
});

test('dueSectionTitle and studySectionTitle with carried rows: "להגשה עד יום ראשון"', () => {
  assert.equal(t.dueSectionTitle(SUN, DATE, true), 'להגשה עד יום ראשון');
  assert.equal(t.studySectionTitle(SUN, DATE, true), 'ללמוד עד יום ראשון');
  // Today Saturday: Sunday is tomorrow.
  assert.equal(t.dueSectionTitle(SUN, SAT, true), 'להגשה עד מחר');
  // Without carried rows, as before.
  assert.equal(t.dueSectionTitle(SUN, DATE), 'להגשה ביום הזה');
  assert.equal(t.dueSectionTitle(FRI, DATE), 'להגשה מחר');
});
