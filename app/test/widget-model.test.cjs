const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * Loads a TypeScript module from src, with a `require` that loads its relative
 * imports the same way (model.ts imports lib/format.ts at runtime).
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

const m = load(path.join(__dirname, '../src/widget/model.ts'));

function day(date, weekdayName, lessons = [], extra = {}) {
  return {
    date, weekdayName, hebrewDate: 'י״א באלול', isSchoolDay: true, holidayName: null,
    lessons, events: [], tasksDue: [], exams: [], changeCount: 0, ...extra,
  };
}
function lesson(hourIndex, subject, startTime, endTime, status = 'regular') {
  return { hourIndex, subject, startTime, endTime, status, detail: null };
}

const feed = {
  date: '2026-09-08',
  weekdayName: 'יום שלישי',
  hebrewDate: 'כ״ו באלול',
  lessons: [],
  nextEvent: null,
  tasksDueToday: [],
  openTasks: [],
  openTaskCount: 0,
  nextExam: null,
  upcomingExams: [],
  changeCount: 0,
  days: [
    day('2026-09-06', 'יום ראשון', [lesson(1, 'תנ״ך', '08:00', '08:45')]),
    day('2026-09-07', 'יום שני'),
    day('2026-09-08', 'יום שלישי', [lesson(1, 'אנגלית', '08:00', '08:45'), lesson(2, 'פיזיקה', '08:50', '09:35')]),
    day('2026-09-09', 'יום רביעי', [lesson(3, 'היסטוריה', '09:45', '10:30', 'cancelled')], { changeCount: 1 }),
    day('2026-09-12', 'שבת', [], { isSchoolDay: false, holidayName: 'שבת' }),
  ],
  generatedAt: '2026-09-08T07:00:00+03:00',
};

test('no cursor shows today', () => {
  const r = m.resolveDay(feed, null);
  assert.equal(r.day.date, '2026-09-08');
  assert.equal(r.offset, 0);
  assert.equal(r.hasPrev, true);
  assert.equal(r.hasNext, true);
});

test('stepping pages through the window and clamps at both ends', () => {
  let cursor = m.stepCursor(feed, null, 1);
  assert.deepEqual(cursor, { date: '2026-09-08', offset: 1 });
  cursor = m.stepCursor(feed, cursor, 1);
  assert.deepEqual(cursor, { date: '2026-09-08', offset: 2 });
  cursor = m.stepCursor(feed, cursor, 1);
  assert.deepEqual(cursor, { date: '2026-09-08', offset: 2 }, 'cannot page past the last day');
  assert.equal(m.resolveDay(feed, cursor).hasNext, false);

  cursor = m.stepCursor(feed, null, -1);
  cursor = m.stepCursor(feed, cursor, -1);
  cursor = m.stepCursor(feed, cursor, -1);
  assert.deepEqual(cursor, { date: '2026-09-08', offset: -2 }, 'cannot page before the first day');
  assert.equal(m.resolveDay(feed, cursor).hasPrev, false);
});

test('"today" resets the cursor', () => {
  const cursor = m.stepCursor(feed, { date: '2026-09-08', offset: 2 }, 0);
  assert.deepEqual(cursor, { date: '2026-09-08', offset: 0 });
});

test('a cursor from an older feed date reads as today again', () => {
  // Left on "מחר" yesterday evening; the feed rolled over overnight.
  const r = m.resolveDay(feed, { date: '2026-09-07', offset: 1 });
  assert.equal(r.day.date, '2026-09-08');
  assert.equal(r.offset, 0);
});

test('a cached feed without a window still renders today', () => {
  const legacy = { ...feed, days: undefined, lessons: [lesson(1, 'אנגלית', '08:00', '08:45')], tasksDueToday: [{ id: 't', title: 'x' }] };
  const r = m.resolveDay(legacy, { date: '2026-09-08', offset: 3 });
  assert.equal(r.day.date, '2026-09-08');
  assert.equal(r.offset, 0);
  assert.deepEqual(r.day.lessons.map((l) => l.subject), ['אנגלית']);
  assert.equal(r.day.tasksDue[0].due, '2026-09-08');
  assert.equal(r.hasPrev, false);
  assert.equal(r.hasNext, false);
});

test('names the day relative to today', () => {
  const [sun, mon, tue, wed] = feed.days;
  assert.equal(m.relativeDayName(tue, 0), 'היום');
  assert.equal(m.relativeDayName(wed, 1), 'מחר');
  assert.equal(m.relativeDayName(mon, -1), 'אתמול');
  assert.equal(m.relativeDayName(sun, -2), 'יום ראשון');
  assert.equal(m.weekdayShort('יום ראשון'), 'ראשון');
  assert.equal(m.shortDate('2026-09-08'), '8.9');
});

test('titles a day without repeating its name', () => {
  const [sun, mon, tue, wed, sat] = feed.days;
  assert.equal(m.dayTitle(tue, 0), 'יום שלישי');
  assert.equal(m.dayTitle(wed, 1), 'מחר, רביעי');
  assert.equal(m.dayTitle(mon, -1), 'אתמול, שני');
  assert.equal(m.dayTitle(sun, -2), 'יום ראשון');
  assert.equal(m.dayTitle(sat, 4), 'שבת');
});

/** Lines a side layout spends: a heading per headed section, a line per row, the exam line, the "none" line. */
function sideLines(s) {
  const headed = (rows) => (rows > 0 ? rows + 1 : 0);
  return headed(s.homework) + headed(s.exams) + headed(s.tasks) + headed(s.events) + (s.examLine ? 1 : 0) + (s.noTasksLine ? 1 : 0);
}
const side = (over) => ({ homework: 0, examLine: false, exams: 0, tasks: 0, events: 0, noTasksLine: false, ...over });

test('the overview side column: homework, then the next exam, then tasks, then the calendar', () => {
  // A 4x3 widget at its minimum height has five lines: every section gets its
  // smallest form in priority order, and the calendar is the one left out.
  assert.deepEqual(
    m.overviewSideLayout(5, { homework: 2, events: 1, exams: 2, tasks: 3 }),
    side({ homework: 1, examLine: true, tasks: 1 }),
  );
  // A line more: homework grows to its second subject before anything else.
  assert.deepEqual(
    m.overviewSideLayout(6, { homework: 2, events: 1, exams: 2, tasks: 3 }),
    side({ homework: 2, examLine: true, tasks: 1 }),
  );
  // Seven: the calendar's first row beats homework's second subject.
  assert.deepEqual(
    m.overviewSideLayout(7, { homework: 2, events: 1, exams: 2, tasks: 3 }),
    side({ homework: 1, examLine: true, tasks: 1, events: 1 }),
  );
  // Tall (a 4x4, ten lines): a second and third urgent task before a second exam.
  assert.deepEqual(
    m.overviewSideLayout(10, { homework: 3, events: 1, exams: 3, tasks: 3 }),
    side({ homework: 2, examLine: true, tasks: 3, events: 1 }),
  );
  // Taller: two exams become a "מבחנים" list, tasks take the rest.
  assert.deepEqual(
    m.overviewSideLayout(12, { homework: 3, events: 1, exams: 3, tasks: 5 }),
    side({ homework: 2, exams: 2, tasks: 3, events: 1 }),
  );
  assert.deepEqual(
    m.overviewSideLayout(14, { homework: 3, events: 1, exams: 3, tasks: 5 }),
    side({ homework: 2, exams: 2, tasks: 5, events: 1 }),
  );
  // Without homework, as before A7 plus the exam line.
  assert.deepEqual(m.overviewSideLayout(12, { events: 1, exams: 2, tasks: 5 }), side({ exams: 2, tasks: 5, events: 1 }));
  assert.deepEqual(m.overviewSideLayout(5, { events: 1, exams: 2, tasks: 3 }), side({ examLine: true, tasks: 1, events: 1 }));
  // One exam stays a line however tall: a heading would add nothing.
  assert.deepEqual(m.overviewSideLayout(12, { homework: 1, events: 0, exams: 1, tasks: 0 }), side({ homework: 1, examLine: true, noTasksLine: true }));
  // Only tasks.
  assert.deepEqual(m.overviewSideLayout(4, { events: 0, exams: 0, tasks: 9 }), side({ tasks: 3 }));
  // The narrowest column still names the next exam beside the homework.
  assert.deepEqual(m.overviewSideLayout(4, { homework: 2, events: 2, exams: 1, tasks: 4 }), side({ homework: 2, examLine: true }));
  assert.equal(m.overviewSideLines(180), 5);
  assert.equal(m.overviewSideLines(270), 10);
  assert.equal(m.overviewSideLines(NaN), 4);
});

test('the side column never overspends its lines and never leaves a bare heading', () => {
  for (let lines = 4; lines <= 14; lines += 1) {
    for (const homework of [0, 1, 3]) {
      for (const exams of [0, 1, 3]) {
        for (const tasks of [0, 1, 6]) {
          for (const events of [0, 1, 3]) {
            const counts = { homework, exams, tasks, events };
            const s = m.overviewSideLayout(lines, counts);
            const label = JSON.stringify({ lines, ...counts });
            assert.ok(sideLines(s) <= lines, `fits: ${label}`);
            assert.ok(s.homework <= Math.min(homework, m.SIDE_HOMEWORK_MAX), `homework rows: ${label}`);
            assert.ok(s.tasks <= tasks && s.events <= events && s.exams <= exams, `rows exist: ${label}`);
            assert.ok(!(s.examLine && s.exams > 0), `the next exam once: ${label}`);
            if (exams > 0) assert.ok(s.examLine || s.exams > 0, `the next exam always shows: ${label}`);
            if (homework > 0) assert.ok(s.homework > 0, `homework always shows: ${label}`);
            assert.ok(!(s.noTasksLine && tasks > 0), `"אין משימות דחופות" only when true: ${label}`);
          }
        }
      }
    }
  }
});

test('a side heading carries the total only when rows hide some of it', () => {
  assert.equal(m.sectionHeading('משימות', 5, 2), 'משימות (5)');
  assert.equal(m.sectionHeading('משימות', 2, 2), 'משימות');
  assert.equal(m.sectionHeading('להגשה מחר', 3, 2), 'להגשה מחר (3)');
});

test('the next exam line names the subject short and counts the days', () => {
  assert.equal(m.nextExamLine({ subject: 'מתכונת באנגלית וויקה', date: '2026-09-11', daysAway: 3 }), 'מבחן אנג׳, עוד 3 ימים');
  assert.equal(m.nextExamLine({ subject: 'היסטוריה', date: '2026-09-09', daysAway: 1 }), 'מבחן היסט׳, מחר');
  assert.equal(m.nextExamLine({ subject: "מבחן גוש ב'", date: '2026-09-08', daysAway: 0 }), 'מבחן גוש ב׳, היום');
  assert.equal(m.examRow({ subject: 'מתכונת באנגלית וויקה', date: '2026-09-09', daysAway: 1 }), 'אנג׳, מבחן מחר');
  assert.equal(m.examRow({ subject: 'היסטוריה', date: '2026-09-11', daysAway: 3 }), 'היסט׳, עוד 3 ימים');
});

// ---- homework ----

/** Tuesday 8.9: two lessons ending 09:35. */
const hwFeed = (homeworkDue, extra = {}) => ({ ...feed, homeworkDue, ...extra });
const hw = (key, subject, due, text = 'עמ׳ 34') => ({ key, subject, text, due });
const HOMEWORK = [
  hw('a', 'אנגלית 5 יח״ל (יב2)', '2026-09-08', 'לקרוא פרק 3'),
  hw('b', 'אנגלית 5 יח״ל (יב2)', '2026-09-08', 'תרגילים 1-5'),
  hw('c', 'היסטוריה (יב2)', '2026-09-09'),
  hw('d', 'שרותי רשת (מעבדת מחשבים 1)', '2026-09-09'),
  hw('e', 'תנ״ך', '2026-09-09'),
];

test('a feed without homeworkDue (an older server) reads as nothing due', () => {
  const legacy = { ...feed };
  delete legacy.homeworkDue;
  assert.deepEqual(m.feedHomework(legacy), []);
  assert.deepEqual(m.homeworkInView(legacy, '08:30'), []);
  assert.equal(m.homeworkFocus(legacy, '08:30'), null);
  assert.deepEqual(m.feedHomework(hwFeed(null)), []);
  assert.deepEqual(m.feedHomework(hwFeed({ not: 'a list' })), []);
});

test('malformed or past homework entries are skipped', () => {
  const list = m.feedHomework(hwFeed([
    null,
    { key: 'x', subject: 'אנגלית' },
    hw('old', 'אנגלית', '2026-09-07'),
    { key: 'y', subject: 'תנ״ך', due: '2026-09-09' },
  ]));
  assert.deepEqual(list, [{ key: 'y', subject: 'תנ״ך', text: '', due: '2026-09-09' }]);
});

test('homework due today shows during the school day, tomorrow\'s always', () => {
  const f = hwFeed(HOMEWORK);
  assert.deepEqual(m.homeworkInView(f, '07:10').map((h) => h.key), ['a', 'b', 'c', 'd', 'e'], 'before school');
  assert.deepEqual(m.homeworkInView(f, '09:00').map((h) => h.key), ['a', 'b', 'c', 'd', 'e'], 'in a lesson');
  assert.deepEqual(m.homeworkInView(f, '09:35').map((h) => h.key), ['c', 'd', 'e'], 'once the last lesson ends');
  assert.deepEqual(m.homeworkInView(f, '21:00').map((h) => h.key), ['c', 'd', 'e']);
});

test('a day without lessons keeps today\'s homework all day', () => {
  // Monday 7.9 has no lessons in the feed: no end of school to wait for.
  const monday = hwFeed([hw('m', 'אנגלית', '2026-09-07'), hw('n', 'תנ״ך', '2026-09-08')], { date: '2026-09-07' });
  assert.equal(m.todayHomeworkOpen(monday, '20:00'), true);
  assert.deepEqual(m.homeworkInView(monday, '20:00').map((h) => h.key), ['m', 'n']);
});

test('the overview focuses on today\'s homework in school, tomorrow\'s after', () => {
  const f = hwFeed(HOMEWORK);
  assert.deepEqual(m.homeworkFocus(f, '08:30'), { due: '2026-09-08', label: 'להגשה היום', subjects: ['אנגלית'], count: 2 });
  assert.deepEqual(
    m.homeworkFocus(f, '17:00'),
    { due: '2026-09-09', label: 'להגשה מחר', subjects: ['היסטוריה', 'שרותי רשת', 'תנ״ך'], count: 3 },
  );
  // Nothing left for today: tomorrow's, even mid-morning.
  const onlyTomorrow = hwFeed(HOMEWORK.slice(2, 3));
  assert.deepEqual(m.homeworkFocus(onlyTomorrow, '08:30'), { due: '2026-09-09', label: 'להגשה מחר', subjects: ['היסטוריה'], count: 1 });
  assert.equal(m.homeworkFocus(hwFeed([]), '08:30'), null);
});

test('homework headings name the day against the feed date', () => {
  const f = hwFeed([]);
  assert.equal(m.homeworkHeading('2026-09-08', f), 'להגשה היום');
  assert.equal(m.homeworkHeading('2026-09-09', f), 'להגשה מחר');
  assert.equal(m.homeworkHeading('2026-09-12', f), 'להגשה בשבת');
  assert.equal(m.homeworkHeading('2026-09-20', f), 'להגשה ב־20.9');
});

test('a homework row reads subject first, then the first line of the assignment', () => {
  assert.equal(m.homeworkLine(hw('a', 'אנגלית 5 יח״ל (יב2)', '2026-09-08', '\n  לקרוא   פרק 3\nולסכם')), 'אנגלית: לקרוא פרק 3');
  assert.equal(m.homeworkLine(hw('a', 'היסטוריה (יב2)', '2026-09-08', '   ')), 'היסטוריה');
});

test('the tasks widget gives homework the top rows and keeps one for tasks', () => {
  assert.deepEqual(m.tasksWidgetRows(2, 2, 5), { homework: 1, tasks: 1 });
  assert.deepEqual(m.tasksWidgetRows(5, 2, 5), { homework: 2, tasks: 3 });
  assert.deepEqual(m.tasksWidgetRows(4, 6, 5), { homework: 3, tasks: 1 });
  assert.deepEqual(m.tasksWidgetRows(2, 3, 0), { homework: 2, tasks: 0 });
  assert.deepEqual(m.tasksWidgetRows(3, 0, 9), { homework: 0, tasks: 3 });
  assert.deepEqual(m.tasksWidgetRows(3, 0, 0), { homework: 0, tasks: 0 });
});

test('the tasks pill counts homework with the tasks, most urgent first', () => {
  const items = [
    hw('a', 'אנגלית', '2026-09-08'), hw('c', 'היסטוריה', '2026-09-09'),
    { id: 't1', title: 'late', due: '2026-09-01', listTitle: null },
    { id: 't2', title: 'tomorrow', due: '2026-09-09', listTitle: null },
    { id: 't3', title: 'later', due: '2026-09-12', listTitle: null },
    { id: 't4', title: 'undated', due: null, listTitle: null },
  ];
  assert.deepEqual(m.dueCounts(items, '2026-09-08'), { late: 1, today: 1, tomorrow: 2 });
  assert.deepEqual(m.dueCounts([], '2026-09-08'), { late: 0, today: 0, tomorrow: 0 });
  assert.deepEqual(m.tasksSummary({ late: 2, today: 3, tomorrow: 1, open: 9 }), { text: '2 באיחור', tone: 'overdue' });
  assert.deepEqual(m.tasksSummary({ late: 0, today: 3, tomorrow: 1, open: 9 }), { text: '3 להיום', tone: 'today' });
  assert.deepEqual(m.tasksSummary({ late: 0, today: 0, tomorrow: 2, open: 9 }), { text: '2 למחר', tone: 'soon' });
  assert.deepEqual(m.tasksSummary({ late: 0, today: 0, tomorrow: 0, open: 1 }), { text: 'אחת פתוחה', tone: 'open' });
  assert.deepEqual(m.tasksSummary({ late: 0, today: 0, tomorrow: 0, open: 4 }), { text: '4 פתוחות', tone: 'open' });
  assert.deepEqual(m.tasksSummary({ late: 0, today: 0, tomorrow: 0, open: 0 }), { text: 'הכול סגור', tone: 'clear' });
  assert.equal(m.moreLine(0, 0), null);
  assert.equal(m.moreLine(0, 1), 'ועוד משימה אחת');
  assert.equal(m.moreLine(0, 3), 'ועוד 3 משימות');
  assert.equal(m.moreLine(1, 0), 'ועוד פריט אחד');
  assert.equal(m.moreLine(2, 3), 'ועוד 5 פריטים');
});

test('due labels and tones', () => {
  const today = '2026-09-08';
  assert.deepEqual(m.dueLabel({ due: '2026-09-06' }, today), { text: 'באיחור 2 ימים', tone: 'overdue' });
  assert.deepEqual(m.dueLabel({ due: '2026-09-07' }, today), { text: 'אתמול', tone: 'overdue' });
  assert.deepEqual(m.dueLabel({ due: '2026-09-08' }, today), { text: 'היום', tone: 'today' });
  assert.deepEqual(m.dueLabel({ due: '2026-09-09' }, today), { text: 'מחר', tone: 'soon' });
  assert.deepEqual(m.dueLabel({ due: '2026-09-12' }, today), { text: 'עוד 4 ימים', tone: 'soon' });
  assert.deepEqual(m.dueLabel({ due: '2026-09-30' }, today), { text: '30.9', tone: 'later' });
  assert.deepEqual(m.dueLabel({ due: null }, today), { text: '', tone: 'none' });
});

test('orders tasks late, today, soon, later, undated — then by date', () => {
  const tasks = [
    { id: 'a', title: 'undated', due: null, listTitle: null },
    { id: 'b', title: 'later', due: '2026-10-01', listTitle: null },
    { id: 'c', title: 'tomorrow', due: '2026-09-09', listTitle: null },
    { id: 'd', title: 'today', due: '2026-09-08', listTitle: null },
    { id: 'e', title: 'late', due: '2026-09-01', listTitle: null },
    { id: 'f', title: 'later too', due: '2026-09-20', listTitle: null },
  ];
  assert.deepEqual(m.orderTasks(tasks, '2026-09-08').map((t) => t.id), ['e', 'd', 'c', 'f', 'b', 'a']);
});

test('rows follow the widget height within bounds', () => {
  assert.equal(m.visibleRows(110, m.SCHEDULE_ROWS), 2, 'a 2-cell widget keeps the minimum');
  assert.equal(m.visibleRows(84 + 22 * 5, m.SCHEDULE_ROWS), 5);
  assert.equal(m.visibleRows(2000, m.SCHEDULE_ROWS), m.SCHEDULE_ROWS.max);
  assert.equal(m.visibleRows(NaN, m.TASK_ROWS), m.TASK_ROWS.min);
});

test('marks the lesson in progress and knows when the day is over', () => {
  const tue = feed.days[2];
  assert.equal(m.currentLessonIndex(tue, '07:30'), -1);
  assert.equal(m.currentLessonIndex(tue, '08:10'), 0);
  assert.equal(m.currentLessonIndex(tue, '09:00'), 1);
  assert.equal(m.dayIsOver(tue, '09:00'), false);
  assert.equal(m.dayIsOver(tue, '09:35'), true);
  assert.equal(m.dayIsOver(feed.days[1], '00:00'), true, 'a day with no lessons is over');
});

test('the overview leads with today until school is out, then with the next school day', () => {
  assert.deepEqual([m.overviewDay(feed, '08:30').day.date, m.overviewDay(feed, '08:30').label], ['2026-09-08', 'היום']);
  const evening = m.overviewDay(feed, '17:00');
  assert.equal(evening.day.date, '2026-09-09');
  assert.equal(evening.label, 'מחר');
  assert.equal(evening.offset, 1);
});

test('the overview skips an empty day to the next one with lessons', () => {
  const monday = { ...feed, date: '2026-09-07' };
  const r = m.overviewDay(monday, '12:00');
  assert.equal(r.day.date, '2026-09-08');
  assert.equal(r.label, 'מחר');
});

test('describes a day: span, changes, emptiness', () => {
  const [sun, mon, tue, wed, sat] = feed.days;
  assert.equal(plain(m.daySpan(tue)), '08:00–09:35, 2 שיעורים');
  assert.equal(m.daySpan(mon), null);
  assert.deepEqual(m.changeBadge(tue), { text: 'ללא שינויים', changed: false });
  assert.deepEqual(m.changeBadge(wed), { text: 'שינוי אחד', changed: true });
  assert.deepEqual(m.changeBadge({ ...wed, changeCount: 3 }), { text: '3 שינויים', changed: true });
  assert.equal(m.emptyDayText(sat), 'שבת');
  assert.equal(m.emptyDayText(mon), 'אין שיעורים');
  assert.equal(m.emptyDayText({ ...mon, isSchoolDay: false }), 'אין לימודים');
  // A cancelled lesson is its name in the red pen, and "בוטל" at the row's end (plan §16.1).
  assert.equal(m.lessonTitle(wed.lessons[0]), 'היסטוריה');
  assert.equal(m.lessonStatusWord(wed.lessons[0]), 'בוטל');
  assert.equal(m.lessonTitle(sun.lessons[0]), 'תנ״ך');
  assert.equal(m.lessonStatusWord(sun.lessons[0]), null);
  assert.equal(m.countdown(0), 'המבחן היום');
  assert.equal(m.countdown(1), 'מבחן מחר');
  assert.equal(m.countdown(4), 'עוד 4 ימים');
});

test('a lesson reads as in the app: the school\'s name without its level and group, the student\'s as typed', () => {
  const row = (subject, extra = {}) => m.lessonTitle({ ...lesson(1, subject, '08:00', '08:45'), ...extra });
  assert.equal(row('פיזיקה מורחב'), 'פיזיקה');
  assert.equal(row('פיזיקה מורחב (מעבדת פיסיקה)'), 'פיזיקה');
  assert.equal(row('אנגלית 5 יח״ל (יב2)'), 'אנגלית');
  assert.equal(row('פיזיקה מורחב (שלי)', { originalSubject: 'גוש ב׳' }), 'פיזיקה מורחב (שלי)');
});

// ---- W4-1: the next school day; Itai's header line --------------------------

/** Isolate marks (U+2066…U+2069) dropped, to compare the words. */
/** The text without its invisible marks: the isolates and the word joiners `isolateRanges` puts in. */
function plain(s) {
  return s.replace(/[⁠⁦-⁩]/g, '');
}

/** Thursday 8.10.2026: an empty Friday, Shabbat, then Sunday and Monday with lessons. */
const thursday = {
  ...feed,
  date: '2026-10-08',
  weekdayName: 'יום חמישי',
  days: [
    day('2026-10-07', 'יום רביעי', [lesson(1, 'אנגלית', '08:00', '08:45')]),
    day('2026-10-08', 'יום חמישי', [lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'היסטוריה', '08:45', '09:30', 'cancelled')]),
    day('2026-10-09', 'יום שישי'),
    day('2026-10-10', 'שבת', [], { isSchoolDay: false, holidayName: 'שבת' }),
    day('2026-10-11', 'יום ראשון', [lesson(1, 'תנ״ך', '08:00', '08:45')]),
    day('2026-10-12', 'יום שני', [lesson(1, 'אנגלית', '08:00', '08:45')]),
  ],
};

test('nextSchoolDate: Sunday on a Thursday; a Friday with lessons; a holiday Sunday; nothing guessed', () => {
  assert.equal(m.nextSchoolDate(thursday), '2026-10-11');
  const fridayLessons = { ...thursday, days: thursday.days.map((d) => (d.date === '2026-10-09' ? { ...d, lessons: [lesson(1, 'חינוך', '08:00', '08:45')] } : d)) };
  assert.equal(m.nextSchoolDate(fridayLessons), '2026-10-09');
  const holiday = { ...thursday, days: thursday.days.map((d) => (d.date === '2026-10-11' ? { ...d, isSchoolDay: false, holidayName: 'שמחת תורה' } : d)) };
  assert.equal(m.nextSchoolDate(holiday), '2026-10-12');
  assert.equal(m.nextSchoolDate({ ...thursday, days: thursday.days.slice(0, 4) }), null);
  // Tuesday 8.9: tomorrow.
  assert.equal(m.nextSchoolDate(feed), '2026-09-09');
});

test('dueLabel: due on the next school day says the day, not "עוד 3 ימים" (W4-1)', () => {
  const next = m.nextSchoolDate(thursday);
  assert.deepEqual(m.dueLabel({ due: '2026-10-11' }, thursday.date, next), { text: 'יום ראשון', tone: 'soon' });
  assert.deepEqual(m.dueLabel({ due: '2026-10-09' }, thursday.date, next), { text: 'מחר', tone: 'soon' });
  assert.deepEqual(m.dueLabel({ due: '2026-10-12' }, thursday.date, next), { text: 'עוד 4 ימים', tone: 'soon' });
  // Without the next school day it reads as before.
  assert.deepEqual(m.dueLabel({ due: '2026-10-11' }, thursday.date), { text: 'עוד 3 ימים', tone: 'soon' });
});

test('the tasks pill counts through the next school day and names it (W4-1)', () => {
  const next = m.nextSchoolDate(thursday);
  const items = [{ due: '2026-10-09' }, { due: '2026-10-11' }, { due: '2026-10-12' }, { due: null }];
  assert.deepEqual(m.dueCounts(items, thursday.date, next), { late: 0, today: 0, tomorrow: 2 });
  assert.equal(m.nextBucketLabel(thursday.date, next), 'עד יום ראשון');
  assert.equal(m.nextBucketLabel('2026-09-08', '2026-09-09'), 'למחר');
  assert.equal(m.nextBucketLabel('2026-09-08', null), 'למחר');
  assert.deepEqual(
    m.tasksSummary({ late: 0, today: 0, tomorrow: 2, open: 4 }, m.nextBucketLabel(thursday.date, next)),
    { text: '2 עד יום ראשון', tone: 'soon' },
  );
});

test('the overview\'s homework on a Thursday evening is Sunday\'s, by name', () => {
  const f = { ...thursday, homeworkDue: [hw('s', 'אנגלית (יב2)', '2026-10-11'), hw('t', 'תנ״ך', '2026-10-11')] };
  assert.deepEqual(m.homeworkFocus(f, '20:00'), { due: '2026-10-11', label: 'להגשה ביום ראשון', subjects: ['אנגלית', 'תנ״ך'], count: 2 });
  // A day the window does not carry, within the week, is still named.
  assert.equal(m.homeworkHeading('2026-10-13', { ...thursday, days: thursday.days.slice(0, 3) }), 'להגשה ביום שלישי');
});

test('daySpan: the lessons that take place, then what was cancelled (W4, Itai)', () => {
  const thu = thursday.days[1];
  const line = m.daySpan(thu);
  assert.equal(plain(line), '08:00–08:45, אחד בוטל');
  // The range is isolated, so a Hebrew line on the widget cannot turn it around.
  assert.ok(line.includes('⁦08:00⁠–⁠08:45⁩'));
  const cancelled = day('2026-10-08', 'יום חמישי', [
    lesson(1, 'פיזיקה', '08:00', '08:45'), lesson(2, 'פיזיקה', '08:45', '09:30'), lesson(3, 'אנגלית', '09:45', '10:30'),
    lesson(4, 'היסטוריה', '10:45', '11:30', 'cancelled'), lesson(5, 'ספרות', '11:30', '12:15', 'cancelled'),
    lesson(6, 'מתמטיקה', '12:30', '13:15', 'cancelled'), lesson(7, 'חינוך', '13:15', '14:00', 'cancelled'),
  ]);
  assert.equal(plain(m.daySpan(cancelled)), '08:00–10:30, 4 בוטלו');
  assert.equal(m.daySpan(day('x', 'x', [lesson(1, 'ספרות', '08:00', '08:45', 'cancelled'), lesson(2, 'ספרות', '08:45', '09:30', 'cancelled')])), '2 שיעורים בוטלו');
  assert.equal(m.daySpan(day('x', 'x', [lesson(1, 'ספרות', null, null), lesson(2, 'תנ״ך', null, null)])), '2 שיעורים');
  assert.equal(m.daySpan(day('x', 'x', [lesson(1, 'ספרות', null, null), lesson(2, 'תנ״ך', null, null, 'cancelled')])), 'שיעור אחד, אחד בוטל');
  // The header line: the day — or the Hebrew date on a day without lessons. The date is in the
  // title now, so no line has two "·" (plan §16.2).
  assert.equal(plain(m.dayHeaderLine(thu)), '08:00–08:45, אחד בוטל');
  assert.equal(m.dayHeaderLine(thursday.days[3]), 'י״א באלול');
  assert.equal(m.dayDateTitle(thu, 0), 'יום חמישי 8.10');
  assert.equal(m.dayDateTitle(thursday.days[2], 1), 'מחר, שישי 9.10');
  assert.equal(m.dayDateTitle(thursday.days[4], 3), 'יום ראשון 11.10');
  for (const d of thursday.days) {
    for (const offset of [-1, 0, 1, 3]) {
      for (const line of [m.dayHeaderLine(d), m.dayDateTitle(d, offset)]) assert.ok((line.match(/·/g) ?? []).length <= 1, line);
    }
  }
});

test('the subject dot: colours handed out over the feed\'s own subjects, most lessons first (plan §16.1)', () => {
  const lines = m.feedSubjectLines(thursday);
  // Every subject once, with its lessons in the window counted.
  assert.deepEqual(
    lines.map((l) => [l.name, l.count]).sort((a, b) => a[0].localeCompare(b[0])),
    [['אנגלית', 2], ['היסטוריה', 1], ['פיזיקה', 1], ['תנ״ך', 1]].sort((a, b) => a[0].localeCompare(b[0])),
  );
  const colorOf = m.widgetSubjectColor(thursday, 'light');
  // The same subject, the same colour; the two most frequent never share one.
  assert.equal(colorOf('אנגלית'), colorOf('אנגלית'));
  assert.notEqual(colorOf('אנגלית'), colorOf('פיזיקה'));
  assert.match(colorOf('אנגלית'), /^#[0-9a-f]{6}$/i);
  // The dark page has its own set.
  assert.notEqual(m.widgetSubjectColor(thursday, 'dark')('אנגלית'), colorOf('אנגלית'));
  // A feed without a window still gives a colour.
  assert.match(m.widgetSubjectColor({ ...feed, days: undefined, lessons: [] }, 'light')('ספרות'), /^#/);
});

test('free text on the widgets keeps its ranges left-to-right', () => {
  // The dash joined to its numbers (U+2060 each side): the range never breaks across lines.
  assert.equal(m.homeworkLine(hw('a', 'מתמטיקה (יב2)', '2026-09-08', 'תרגילים 1-5')), 'מתמטיקה: תרגילים ⁦1⁠-⁠5⁩');
  assert.equal(m.eventLine({ summary: 'חזרה 1–3', start: '2026-09-08T17:00:00', allDay: false }), '17:00 חזרה ⁦1⁠–⁠3⁩');
  assert.equal(m.eventLine({ summary: 'יום הולדת', start: '2026-09-08T00:00:00', allDay: true }), 'יום הולדת');
});
