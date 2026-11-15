const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a TypeScript module from src, and its relative imports the same way (as widget-model.test.cjs does). */
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

const p = load(path.join(__dirname, '../src/widget/ios/props.ts'));

const { feed, sunday, at } = require('./fixtures/widget-ios-feed.cjs');

const input = (now, extra = {}) => ({ feed, now, slots: {}, updated: 'עודכן 09:12', staleAt: at('2026-11-01', '12:12').getTime(), ...extra });

test('schedule: the lesson on now sits second, under the one before it', () => {
  const props = p.buildSchedule(input(at('2026-11-01', '09:00')));
  assert.equal(props.kind, 'schedule');
  assert.equal(props.offset, 0);
  const today = props.days[props.today];
  assert.equal(today.title, 'יום ראשון 1.11');
  assert.equal(today.exam, 'מבחן פיזיקה');
  assert.equal(today.change, '2 שינויים');
  assert.match(today.line.replace(/[⁠⁦-⁩]/g, ''), /08:00–13:55/);
  assert.match(today.line, /אחד בוטל/);
  assert.equal(today.rows.length, p.IOS_ROWS.schedule);
  assert.deepEqual(today.rows.map((r) => [r.time, r.subject, r.state]), [
    ['08:00', 'מתמטיקה', 'past'],
    ['08:50', 'אנגלית', 'now'],
    ['09:45', 'היסטוריה', 'cancelled'],
  ]);
  assert.equal(today.rows[1].until, 'עד 09:35');
  assert.equal(today.more, 'ועוד 4 שיעורים');
  // The day before is a letter in the margin; there is a day after.
  assert.equal(today.prev, 'ש׳');
  assert.equal(today.hasNext, true);
  assert.equal(props.days[0].prev, undefined);
  assert.equal(props.days.at(-1).hasNext, false);
});

test('schedule: a substitute is named once, with מ״מ on the highlighter; an exam is marked', () => {
  const props = p.buildSchedule(input(at('2026-11-01', '11:00')));
  const rows = props.days[props.today].rows;
  const lit = rows.find((r) => r.subject === 'ספרות');
  assert.equal(lit.state, 'now');
  assert.equal(lit.change, 'מ״מ');
  const later = p.buildSchedule(input(at('2026-11-01', '07:00'))).days[props.today];
  assert.equal(later.rows[0].state, 'plain');
  const physics = p.buildSchedule(input(at('2026-11-01', '12:00'))).days[props.today].rows.find((r) => r.subject === 'פיזיקה');
  assert.equal(physics.exam, true);
  const sub = p.buildSchedule(input(at('2026-11-01', '09:50'))).days[props.today].rows.find((r) => r.subject === 'ספרות');
  assert.equal(sub.detail, 'מר כהן');
});

test("schedule: a day's exam by its subject's name is \"מבחן\" and that name; one of its own, as typed", () => {
  const mark = (exam) => {
    const withExam = { ...feed, days: feed.days.map((d) => (d.date === '2026-11-01' ? { ...d, exams: [exam] } : d)) };
    const props = p.buildSchedule(input(at('2026-11-01', '09:00'), { feed: withExam }));
    return props.days[props.today].exam;
  };
  const day = { date: '2026-11-01', daysAway: 0 };
  assert.equal(mark({ ...day, subject: 'בגרות English ז - G (הערכה חלופית)', subjectName: 'English' }), 'מבחן English');
  assert.equal(mark({ ...day, subject: 'בוחן פתע', named: true }), 'בוחן פתע');
  assert.equal(mark({ ...day, subject: 'פיזיקה' }), 'מבחן פיזיקה');
});

test('a lesson reads as in the app on both pages: the school\'s name without its level and group, the student\'s as typed', () => {
  const lessons = [
    { hourIndex: 1, subject: 'פיזיקה מורחב (מעבדת פיסיקה)', startTime: '08:00', endTime: '08:45', status: 'regular', detail: null },
    { hourIndex: 2, subject: 'פיזיקה מורחב (שלי)', originalSubject: 'גוש ב׳', startTime: '08:50', endTime: '09:35', status: 'regular', detail: null },
  ];
  const named = { ...feed, lessons, days: feed.days.map((d) => (d.date === '2026-11-01' ? { ...d, lessons } : d)) };
  const shown = ['פיזיקה', 'פיזיקה מורחב (שלי)'];
  const schedule = p.buildSchedule(input(at('2026-11-01', '07:00'), { feed: named }));
  assert.deepEqual(schedule.days[schedule.today].rows.map((r) => r.subject), shown);
  const overview = p.buildOverview(input(at('2026-11-01', '07:00'), { feed: named }));
  assert.deepEqual(overview.rows.slice(0, 2).map((r) => r.lesson?.subject), shown);
});

test('schedule: other days have no lesson on now, and an empty day says why', () => {
  const props = p.buildSchedule(input(at('2026-11-01', '09:00')));
  const monday = props.days[props.today + 1];
  assert.equal(monday.title, 'מחר, שני 2.11');
  assert.ok(monday.rows.every((r) => r.state === 'plain'));
  const saturday = props.days[props.today - 1];
  assert.equal(saturday.empty, 'אין לימודים');
  assert.deepEqual(saturday.rows, []);
});

test('after midnight the feed reads as the next day of its window', () => {
  const props = p.buildSchedule(input(at('2026-11-02', '00:00')));
  assert.equal(props.days[props.today].title, 'יום שני 2.11');
  const shifted = p.feedOn(feed, '2026-11-02');
  assert.equal(shifted.date, '2026-11-02');
  assert.deepEqual(shifted.upcomingExams.map((e) => [e.subject, e.daysAway]), [['אנגלית', 2]]);
  assert.equal(p.feedOn(feed, '2026-11-20'), null);
  assert.equal(p.buildSchedule(input(at('2026-11-20', '08:00'))).kind, 'empty');
});

test('tasks: the margin says when, homework says ש״ב, late first', () => {
  const props = p.buildTasks(input(at('2026-11-01', '09:00')));
  assert.equal(props.kind, 'tasks');
  assert.equal(props.summary, '1 באיחור');
  assert.equal(props.summaryTone, 'cancel');
  assert.equal(props.rows.length, p.IOS_ROWS.tasks);
  assert.deepEqual(props.rows.map((r) => [r.when, r.homework]), [['מחר', true], ['מחר', true], ['איחור', false]]);
  assert.match(props.rows[0].text, /^מתמטיקה: תרגילים/);
  assert.equal(props.rows[2].box, 'cancel');
  assert.equal(props.more, 'ועוד 2 משימות');
});

test('tasks: the margin words', () => {
  assert.deepEqual(p.marginDue({ due: '2026-10-30' }, '2026-11-01', null), { text: 'איחור', tone: 'cancel', bold: true });
  assert.deepEqual(p.marginDue({ due: '2026-11-01' }, '2026-11-01', null), { text: 'היום', tone: 'change', bold: true });
  assert.deepEqual(p.marginDue({ due: '2026-11-02' }, '2026-11-01', null), { text: 'מחר', tone: 'accent', bold: true });
  assert.deepEqual(p.marginDue({ due: '2026-11-05' }, '2026-11-01', null), { text: 'חמישי', tone: 'muted', bold: false });
  assert.deepEqual(p.marginDue({ due: '2026-11-20' }, '2026-11-01', null), { text: '20.11', tone: 'muted', bold: false });
  assert.deepEqual(p.marginDue({ due: null }, '2026-11-01', null), { text: '', tone: 'muted', bold: false });
});

test('overview: lessons on the left of each line, what surrounds them at its end', () => {
  const props = p.buildOverview(input(at('2026-11-01', '09:00')));
  assert.equal(props.kind, 'overview');
  assert.equal(props.title, 'יום ראשון 1.11');
  assert.equal(props.rows.length, p.IOS_ROWS.overview);
  assert.deepEqual(props.rows.slice(0, 7).map((r) => r.lesson?.subject), sunday.map((l) => l.subject));
  const side = props.rows.map((r) => r.side).filter(Boolean);
  assert.deepEqual(side[0], { kind: 'head', text: 'שיעורי בית למחר' });
  assert.deepEqual(side[1], { kind: 'text', text: 'מתמטיקה, אנגלית' });
  assert.ok(side.some((l) => l.kind === 'exam' && /^מבחן פיז.*, היום$/.test(l.text)), JSON.stringify(side));
  assert.ok(side.some((l) => l.kind === 'head' && l.text.startsWith('משימות')));
  assert.ok(side.some((l) => l.kind === 'task' && l.when === 'איחור'));
  assert.ok(side.length <= p.IOS_ROWS.overview);
});

test('overview: once school is out it leads with the next school day', () => {
  const props = p.buildOverview(input(at('2026-11-01', '15:00')));
  assert.equal(props.title, 'מחר, שני 2.11');
  assert.equal(props.rows[0].lesson.subject, 'כימיה');
  assert.equal(props.rows[0].lesson.state, 'plain');
});

test('the homework heading reads as the page says it', () => {
  const side = p.overviewSide(p.feedOn(feed, '2026-11-01'), '09:00', 9);
  assert.equal(side[0].text, 'שיעורי בית למחר');
});

test('stale: the footer says so once the feed is old', () => {
  assert.equal(p.buildTasks(input(at('2026-11-01', '09:00'))).updated, 'עודכן 09:12');
  const old = p.buildTasks(input(at('2026-11-01', '13:00')));
  assert.equal(old.stale, true);
  assert.equal(old.updated, 'עודכן 09:12, לא עדכני');
});

test('no feed: every widget asks for the app once', () => {
  for (const build of [p.buildSchedule, p.buildTasks, p.buildOverview]) {
    const props = build(input(at('2026-11-01', '09:00'), { feed: null }));
    assert.equal(props.kind, 'empty');
    assert.match(props.line, /לפתוח את האפליקציה/);
  }
});

test('the timeline: now, every lesson boundary today and tomorrow, both midnights, the stale moment', () => {
  const now = at('2026-11-01', '09:00');
  const times = p.entryTimes(feed, now, at('2026-11-01', '12:12').getTime()).map((d) => d.getTime());
  assert.equal(times[0], now.getTime());
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  for (const hhmm of ['09:35', '09:45', '13:55']) assert.ok(times.includes(at('2026-11-01', hhmm).getTime()), hhmm);
  assert.ok(!times.includes(at('2026-11-01', '08:00').getTime()), 'nothing before now');
  for (const hhmm of ['08:00', '09:35']) assert.ok(times.includes(at('2026-11-02', hhmm).getTime()), `tomorrow ${hhmm}`);
  assert.ok(times.includes(at('2026-11-02', '00:00').getTime() + 1000));
  assert.ok(times.includes(at('2026-11-03', '00:00').getTime() + 1000));
  assert.ok(times.includes(at('2026-11-01', '12:12').getTime() + 1));
  assert.ok(times.length <= p.MAX_ENTRIES);
});

test('the timeline keeps both midnights however many lessons there are', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    hourIndex: i + 1, subject: `s${i}`, status: 'regular', detail: null,
    startTime: `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
    endTime: `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '55' : '25'}`,
  }));
  const busy = { ...feed, days: feed.days.map((d) => (d.date >= '2026-11-01' ? { ...d, lessons: many } : d)) };
  const times = p.entryTimes(busy, at('2026-11-01', '05:00')).map((d) => d.getTime());
  assert.equal(times.length, p.MAX_ENTRIES);
  assert.ok(times.includes(at('2026-11-02', '00:00').getTime() + 1000));
  assert.ok(times.includes(at('2026-11-03', '00:00').getTime() + 1000));
  assert.deepEqual([...times].sort((a, b) => a - b), times);
});

test('a whole timeline stays small enough for the App Group', () => {
  const now = at('2026-11-01', '07:00');
  const times = p.entryTimes(feed, now, at('2026-11-01', '10:12').getTime());
  for (const build of [p.buildSchedule, p.buildTasks, p.buildOverview]) {
    const size = JSON.stringify(times.map((date) => ({ timestamp: date.getTime(), props: build(input(date)) }))).length;
    assert.ok(size < 400_000, `${build.name}: ${size} bytes`);
  }
});

test('colours reach the native side as #RRGGBBAA', () => {
  assert.equal(p.hex8('rgba(232,80,91,.55)'), '#E8505B8C');
  assert.equal(p.hex8('#2347c5'), '#2347C5');
  for (const scheme of ['light', 'dark']) {
    for (const [key, value] of Object.entries(p.INK[scheme])) assert.match(value, /^#[0-9A-F]{6}([0-9A-F]{2})?$/, `${scheme}.${key}`);
  }
  const dot = p.buildSchedule(input(at('2026-11-01', '09:00'))).days[2].rows[0].dot;
  assert.match(dot.light, /^#[0-9A-F]{6}/);
  assert.match(dot.dark, /^#[0-9A-F]{6}/);
});
