const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a TypeScript module from src, with its relative imports loaded the same way. */
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

const n = load(path.join(__dirname, '../src/lib/notifications.ts'));
const { NOTIFICATION_TYPES } = load(path.join(__dirname, '../../shared/src/settings.ts'));

/** Device-local instant, as the log's `sentAt` would be for that wall-clock time. */
const sentAt = (local) => new Date(local).toISOString();

const tab = (screen, params) => ({ name: 'Tabs', params: params ? { screen, params } : { screen } });
/** A timetable change: its day on "היום שלי", with the change open (Wave 7). */
const change = (date) => ({ ...tab('Today', { date }), focus: 'changes' });

// ── Every deep link ─────────────────────────────────────────────────────────

test('routeForPayload: each deepLink opens its screen, with date or tab when given', () => {
  const cases = [
    [{ deepLink: 'today', date: '2026-10-09' }, tab('Today', { date: '2026-10-09' })],
    [{ deepLink: 'week', date: '2026-10-09' }, tab('Week', { date: '2026-10-09' })],
    [{ deepLink: 'planning', date: '2026-10-20' }, tab('Calendar', { date: '2026-10-20' })],
    [{ deepLink: 'school', tab: 'grades' }, tab('School', { tab: 'grades' })],
    [{ deepLink: 'tasks' }, tab('Tasks')],
    [{ deepLink: 'notifications' }, { name: 'Notifications' }],
    [{ deepLink: 'mashov-login' }, { name: 'MashovLogin' }],
    [{ deepLink: 'settings' }, { name: 'SettingsNotifications' }],
  ];
  for (const [payload, route] of cases) {
    assert.deepEqual(n.routeForPayload({ refreshWidget: true, ...payload }), route, JSON.stringify(payload));
  }
});

test('routeForPayload: a day link without a date opens the tab as it is', () => {
  assert.deepEqual(n.routeForPayload({ deepLink: 'today' }), tab('Today'));
  assert.deepEqual(n.routeForPayload({ deepLink: 'week' }), tab('Week'));
  assert.deepEqual(n.routeForPayload({ deepLink: 'planning' }), tab('Calendar'));
});

test('routeForPayload: "planning" is the תכנון tab (route Calendar), not Today', () => {
  const route = n.routeForPayload({ type: 'new_exam', deepLink: 'planning', date: '2026-10-20' });
  assert.deepEqual(route, tab('Calendar', { date: '2026-10-20' }));
});

test('routeForPayload: a malformed date or tab is dropped, never passed on', () => {
  assert.deepEqual(n.routeForPayload({ deepLink: 'today', date: 'tomorrow' }), tab('Today'));
  assert.deepEqual(n.routeForPayload({ deepLink: 'week', date: '2026-1-9' }), tab('Week'));
  assert.deepEqual(n.routeForPayload({ deepLink: 'today', date: 20261009 }), tab('Today'));
  assert.deepEqual(n.routeForPayload({ deepLink: 'school', tab: 'timetable' }), tab('School'));
  // …and a bad tab still lands on the type's own sub-tab.
  assert.deepEqual(n.routeForPayload({ type: 'new_grade', deepLink: 'school', tab: 'timetable' }), tab('School', { tab: 'grades' }));
});

test('routeForPayload: a school link from before tabs were sent takes the tab from its type', () => {
  assert.deepEqual(n.routeForPayload({ type: 'new_exam', deepLink: 'school' }), tab('School', { tab: 'exams' }));
  assert.deepEqual(n.routeForPayload({ type: 'new_homework', deepLink: 'school' }), tab('School', { tab: 'homework' }));
  assert.deepEqual(n.routeForPayload({ type: 'new_grade', deepLink: 'school' }), tab('School', { tab: 'grades' }));
  assert.deepEqual(n.routeForPayload({ type: 'teacher_message', deepLink: 'school' }), tab('School', { tab: 'messages' }));
  // The log entry's type counts when the payload has none.
  assert.deepEqual(n.routeForPayload({ deepLink: 'school' }, { type: 'new_exam' }), tab('School', { tab: 'exams' }));
  assert.deepEqual(n.routeForPayload({ deepLink: 'school' }), tab('School'));
});

test('routeForPayload: a "settings" link about a broken connection opens מצב חיבורים', () => {
  assert.deepEqual(n.routeForPayload({ type: 'sync_broken', deepLink: 'settings' }), { name: 'Connections' });
  assert.deepEqual(n.routeForPayload({ type: 'relogin_needed', deepLink: 'settings' }), { name: 'Connections' });
  assert.deepEqual(n.routeForPayload({ deepLink: 'settings' }, { type: 'sync_broken' }), { name: 'Connections' });
  assert.deepEqual(n.routeForPayload({ type: 'morning_summary', deepLink: 'settings' }), { name: 'SettingsNotifications' });
});

// ── What the server sends (server/src/notify, sync/runner.ts) ───────────────

test('routeForPayload: the payloads the server sends land where the plan says', () => {
  const cases = [
    // "מבחן חדש" → בית ספר ← מבחנים (plan §5 A6 acceptance).
    [{ type: 'new_exam', deepLink: 'school', tab: 'exams', examKey: 'shahaf:2026-10-20:אנגלית', date: '2026-10-20' }, tab('School', { tab: 'exams' })],
    [{ type: 'new_homework', deepLink: 'school', tab: 'homework' }, tab('School', { tab: 'homework' })],
    [{ type: 'new_grade', deepLink: 'school', tab: 'grades' }, tab('School', { tab: 'grades' })],
    [{ type: 'teacher_message', deepLink: 'school', tab: 'messages' }, tab('School', { tab: 'messages' })],
    // A timetable change opens the change itself, on its day (Wave 7).
    [{ type: 'schedule_change_today', deepLink: 'today', date: '2026-10-08' }, change('2026-10-08')],
    // "שינוי במערכת של מחר" → tomorrow's day (acceptance), on "היום שלי" with the change open.
    [{ type: 'schedule_change_tomorrow', deepLink: 'week', date: '2026-10-09' }, change('2026-10-09')],
    [{ type: 'morning_summary', deepLink: 'today', date: '2026-10-08' }, tab('Today', { date: '2026-10-08' })],
    [{ type: 'evening_homework', deepLink: 'today', date: '2026-10-09' }, tab('Today', { date: '2026-10-09' })],
    [{ type: 'relogin_needed', deepLink: 'mashov-login' }, { name: 'MashovLogin' }],
    [{ type: 'relogin_needed', deepLink: 'settings' }, { name: 'Connections' }],
    [{ type: 'sync_broken', deepLink: 'settings' }, { name: 'Connections' }],
  ];
  for (const [payload, route] of cases) {
    assert.deepEqual(n.routeForPayload({ ...payload, refreshWidget: true }), route, payload.type);
  }
});

// ── No deep link: by type ───────────────────────────────────────────────────

test('routeForPayload: without a deep link, each type goes where its push would', () => {
  const cases = [
    ['schedule_change_today', tab('Today')],
    ['schedule_change_tomorrow', tab('Week')],
    ['new_exam', tab('School', { tab: 'exams' })],
    ['new_homework', tab('School', { tab: 'homework' })],
    ['new_grade', tab('School', { tab: 'grades' })],
    ['teacher_message', tab('School', { tab: 'messages' })],
    ['morning_summary', tab('Today')],
    ['evening_homework', tab('Today')],
    ['sync_broken', { name: 'Connections' }],
    ['relogin_needed', { name: 'Connections' }],
  ];
  for (const [type, route] of cases) {
    assert.deepEqual(n.routeForPayload(null, { type }), route, `${type}, null payload`);
    assert.deepEqual(n.routeForPayload({ type, refreshWidget: true }), route, `${type}, payload without deepLink`);
  }
  assert.deepEqual(n.routeForPayload(null), tab('Today'));
  assert.deepEqual(n.routeForPayload('garbage'), tab('Today'));
  assert.deepEqual(n.routeForPayload({ deepLink: 'somewhere-new', type: 'new_grade' }), tab('School', { tab: 'grades' }));
});

test('routeForPayload: without a deep link, the day comes from the payload or from when it was sent', () => {
  // A date in the old payload wins.
  assert.deepEqual(n.routeForPayload({ type: 'schedule_change_tomorrow', date: '2026-10-11' }, { sentAt: sentAt('2026-10-08T21:00:00') }), change('2026-10-11'));
  // Otherwise: the day it was sent for "today" kinds, the next one for "tomorrow" kinds.
  const evening = sentAt('2026-10-08T20:00:00');
  assert.deepEqual(n.routeForPayload(null, { type: 'schedule_change_today', sentAt: evening }), change('2026-10-08'));
  assert.deepEqual(n.routeForPayload(null, { type: 'morning_summary', sentAt: sentAt('2026-10-08T07:00:00') }), tab('Today', { date: '2026-10-08' }));
  assert.deepEqual(n.routeForPayload(null, { type: 'schedule_change_tomorrow', sentAt: evening }), change('2026-10-09'));
  assert.deepEqual(n.routeForPayload(null, { type: 'evening_homework', sentAt: evening }), tab('Today', { date: '2026-10-09' }));
  // Across a month end.
  assert.deepEqual(n.routeForPayload(null, { type: 'evening_homework', sentAt: sentAt('2026-10-31T20:00:00') }), tab('Today', { date: '2026-11-01' }));
  // Types that aren't about a day ignore it; a bad time is ignored.
  assert.deepEqual(n.routeForPayload(null, { type: 'new_exam', sentAt: evening }), tab('School', { tab: 'exams' }));
  assert.deepEqual(n.routeForPayload(null, { type: 'schedule_change_today', sentAt: 'not a time' }), tab('Today'));
  // A deep link that names no date is taken as it is, not dated from sentAt.
  assert.deepEqual(n.routeForPayload({ deepLink: 'today' }, { type: 'evening_homework', sentAt: evening }), tab('Today'));
});

test('routeForLogEntry: a log row uses its payload, then its own type and time', () => {
  const entry = (type, payload, local = '2026-10-08T20:00:00') => ({ id: 1, type, title: '', body: '', payload, sentAt: sentAt(local) });
  assert.deepEqual(n.routeForLogEntry(entry('new_exam', { type: 'new_exam', deepLink: 'school', tab: 'exams', refreshWidget: true })), tab('School', { tab: 'exams' }));
  assert.deepEqual(n.routeForLogEntry(entry('schedule_change_tomorrow', null)), change('2026-10-09'));
  assert.deepEqual(n.routeForLogEntry(entry('relogin_needed', { deepLink: 'settings' })), { name: 'Connections' });
});

// ── A connection problem that is over (run 7, Maya) ─────────────────────────

const status = (name, over = {}) => ({
  source: name, state: 'ok', lastOkAt: '2026-10-08T07:00:00Z', consecutiveFailures: 0, degradedSince: null,
  lastError: null, message: null, account: null, sourceFreshness: null, needsReauth: false, configured: true, ...over,
});
const allOk = ['google_calendar', 'google_tasks', 'mashov', 'shahaf', 'school_site'].map((s) => status(s));
const withSource = (name, over) => allOk.map((s) => (s.source === name ? { ...s, ...over } : s));
/** The titles and payloads the server sends (sync/runner.ts), and the old one Maya saw in the bell. */
const logRow = (type, title, payload, body = '') => ({ id: 9, type, title, body, payload: { type, ...payload, refreshWidget: true }, sentAt: sentAt('2026-10-05T09:00:00') });
const mashovRelogin = logRow('relogin_needed', 'צריך להתחבר שוב למשוב', { deepLink: 'mashov-login' }, 'משוב ניתק את החיבור');
const oldMashovRelogin = logRow('relogin_needed', 'נדרשת התחברות מחדש · משוב', { deepLink: 'mashov-login' });
const googleRelogin = logRow('relogin_needed', 'נדרשת התחברות מחדש · Google', { deepLink: 'settings' }, 'צריך לאשר מחדש את החיבור ל־Google');
const classroomRelogin = logRow('relogin_needed', 'נדרשת התחברות מחדש · Google Classroom', { deepLink: 'settings' });
const siteBroken = logRow('sync_broken', 'אין עדכונים מאתר בית הספר', { deepLink: 'settings' });

test('connectionOf: which connection a connection problem is about, from its link or its title', () => {
  assert.equal(n.connectionOf(mashovRelogin), 'mashov');
  assert.equal(n.connectionOf(oldMashovRelogin), 'mashov');
  assert.equal(n.connectionOf(googleRelogin), 'google');
  // "Google Classroom" has "Google" in it, but is not Google: it has no card (plan 2f).
  assert.equal(n.connectionOf(classroomRelogin), null);
  assert.equal(n.connectionOf(logRow('sync_broken', 'אין עדכונים', { source: 'google_classroom' })), null);
  assert.equal(n.connectionOf(siteBroken), 'shahaf');
  assert.equal(n.connectionOf(logRow('sync_broken', 'אין עדכונים מלוח המבחנים', { deepLink: 'settings' })), 'school_site');
  assert.equal(n.connectionOf(logRow('sync_broken', 'אין עדכונים מיומן Google', { deepLink: 'settings' })), 'google');
  // A source in the payload wins.
  assert.equal(n.connectionOf(logRow('sync_broken', 'אין עדכונים', { source: 'google_tasks' })), 'google');
  // Not a connection problem, or one that does not say.
  assert.equal(n.connectionOf(logRow('new_grade', 'ציון חדש · משוב', { deepLink: 'school' })), null);
  assert.equal(n.connectionOf(logRow('sync_broken', 'אין עדכונים', { deepLink: 'settings' })), null);
});

test('routeForLogEntry: an old "צריך להתחבר שוב · משוב" opens מצב חיבורים once Mashov is connected again (run 7, Maya)', () => {
  // Connected now: settled, and no login.
  assert.equal(n.isSettled(oldMashovRelogin, allOk), true);
  assert.deepEqual(n.routeForLogEntry(oldMashovRelogin, allOk), { name: 'Connections' });
  assert.deepEqual(n.routeForLogEntry(mashovRelogin, allOk), { name: 'Connections' });
  // Still cut off: the login, as before.
  const cut = withSource('mashov', { needsReauth: true, state: 'broken', message: 'משוב ניתק את החיבור' });
  assert.equal(n.isSettled(mashovRelogin, cut), false);
  assert.deepEqual(n.routeForLogEntry(mashovRelogin, cut), { name: 'MashovLogin' });
  // Disconnected since: not settled either.
  assert.equal(n.isSettled(mashovRelogin, withSource('mashov', { configured: false, message: 'משוב לא מחובר' })), false);
  // Status unknown: never claimed settled.
  assert.equal(n.isSettled(mashovRelogin, null), false);
  assert.equal(n.isSettled(mashovRelogin, []), false);
  assert.deepEqual(n.routeForLogEntry(mashovRelogin), { name: 'MashovLogin' });
});

test('isSettled: "אין עדכונים מ…" once the source is fine, Google by its own card, Classroom never', () => {
  assert.equal(n.isSettled(siteBroken, allOk), true);
  assert.equal(n.isSettled(siteBroken, withSource('shahaf', { state: 'broken', consecutiveFailures: 4, message: 'אתר בית הספר לא עונה כרגע' })), false);
  assert.deepEqual(n.routeForLogEntry(siteBroken, allOk), { name: 'Connections' });
  assert.equal(n.isSettled(googleRelogin, allOk), true);
  assert.equal(n.isSettled(googleRelogin, withSource('google_tasks', { needsReauth: true })), false);
  // Classroom has no card (plan 2f): an old Classroom row is never settled, connected or not.
  assert.equal(n.isSettled(classroomRelogin, allOk), false);
  assert.equal(n.isSettled(classroomRelogin, [...allOk, status('google_classroom', { account: 'student@school.example' })]), false);
  // Anything else is never "settled".
  assert.equal(n.isSettled(logRow('new_grade', 'ציון חדש', { deepLink: 'school' }), allOk), false);
  assert.equal(n.SETTLED_WORD, 'סודר');
});

// ── A timetable change lands on the change itself (Wave 7) ──────────────────

test('routeForPayload: a timetable change opens its day on Today with the change open — the push and the bell alike (Noa, Maya, run 6)', () => {
  const push = { type: 'schedule_change_today', deepLink: 'today', date: '2026-10-08', refreshWidget: true };
  assert.deepEqual(n.routeForPayload(push), change('2026-10-08'));
  // The bell's row for the same push: the same place.
  const row = { id: 7, type: 'schedule_change_today', title: 'שינוי במערכת של היום', body: 'שיעור 7 היסטוריה מבוטל', payload: push, sentAt: sentAt('2026-10-08T07:10:00') };
  assert.deepEqual(n.routeForLogEntry(row), change('2026-10-08'));
  // Its day unknown: where it went before, with nothing to open.
  assert.deepEqual(n.routeForPayload({ type: 'schedule_change_today', deepLink: 'today' }), tab('Today'));
  assert.deepEqual(n.routeForPayload({ type: 'schedule_change_tomorrow', deepLink: 'week' }), tab('Week'));
  // Only timetable changes open anything: the morning summary and the evening reminder show the day.
  assert.equal(n.routeForPayload({ type: 'morning_summary', deepLink: 'today', date: '2026-10-08' }).focus, undefined);
  assert.equal(n.routeForPayload({ type: 'evening_homework', deepLink: 'today', date: '2026-10-09' }).focus, undefined);
});

const f = load(path.join(__dirname, '../src/lib/todayFocus.ts'));

test('todayFocus: a request is taken once, for its own day, while fresh', () => {
  const t0 = 1_000_000;
  f.requestTodayFocus('2026-10-08', 'changes', t0);
  assert.equal(f.takeTodayFocus('2026-10-08', t0 + 500), 'changes');
  // Taken: gone.
  assert.equal(f.takeTodayFocus('2026-10-08', t0 + 600), null);
  // Another day's visit takes it and gets nothing, so a later visit to its day is not surprised by it.
  f.requestTodayFocus('2026-10-08', 'changes', t0);
  assert.equal(f.takeTodayFocus('2026-10-09', t0 + 100), null);
  assert.equal(f.takeTodayFocus('2026-10-08', t0 + 200), null);
  // Stale: the visit it was for never came.
  f.requestTodayFocus('2026-10-08', 'changes', t0);
  assert.equal(f.takeTodayFocus('2026-10-08', t0 + f.TODAY_FOCUS_TTL_MS + 1), null);
  // A newer request replaces the one before it.
  f.requestTodayFocus('2026-10-08', 'changes', t0);
  f.requestTodayFocus('2026-10-09', 'changes', t0 + 10);
  assert.equal(f.takeTodayFocus('2026-10-09', t0 + 20), 'changes');
});

test('changesTarget: one changed lesson opens its sheet, several the list, none nothing', () => {
  const lesson = (hourIndex, status) => ({ date: '2026-10-08', hourIndex, startTime: null, endTime: null, subject: 'היסטוריה', teacher: null, room: null, status, substitute: null, note: null, source: 'shahaf', changeSeenAt: null });
  const seventh = lesson(7, 'cancelled');
  assert.deepEqual(f.changesTarget([seventh]), { kind: 'lesson', lesson: seventh });
  assert.deepEqual(f.changesTarget([seventh, lesson(3, 'substitution')]), { kind: 'list' });
  assert.equal(f.changesTarget([]), null);
});

// ── Icon and label per type ─────────────────────────────────────────────────

test('notificationLook: icon, colour and label for each type, against the titles the server sends', () => {
  const cases = [
    ['schedule_change_tomorrow', 'שינוי במערכת של מחר', 'שיעור 3 מתמטיקה · מ״מ: כהן', 'change', 'change', null],
    ['schedule_change_today', '2 שינויים במערכת של היום', 'שיעור 2 אנגלית הועבר · שיעור 5 היסטוריה מבוטל', 'change', 'change', null],
    ['new_exam', 'מבחן חדש', 'אנגלית · 2026-10-20', 'exam', 'exam', null],
    ['new_homework', 'שיעורי בית · היסטוריה', 'לקרוא פרק 3', 'homework', 'accent', null],
    ['evening_homework', 'מחר להגיש: היסטוריה, מתמטיקה', 'היסטוריה: לקרוא פרק 3', 'homework', 'accent', null],
    ['evening_homework', 'מחר מבחן באנגלית', 'אנגלית', 'homework', 'accent', null],
    ['new_grade', 'ציון חדש · מתמטיקה', '92', 'grade', 'ok', null],
    ['teacher_message', 'הודעה מכהן רונית', 'שיעור תגבור ביום חמישי', 'message', 'neutral', null],
    ['teacher_message', 'הודעה חדשה', '', 'message', 'neutral', null],
    // The morning summary's title is the date, so it keeps its label.
    ['morning_summary', 'יום חמישי · כ״ו בתשרי', 'אין שינויים', 'summary', 'accent', 'סיכום בוקר'],
    ['sync_broken', 'אין עדכונים משחף', 'כבר 6 שעות לא מגיע מידע חדש', 'link', 'cancel', null],
    ['relogin_needed', 'צריך להתחבר שוב למשוב', 'משוב ניתק את החיבור', 'link', 'cancel', null],
    ['relogin_needed', 'נדרשת התחברות מחדש · Google', 'צריך לאשר מחדש את החיבור ל־Google', 'link', 'cancel', null],
  ];
  for (const [type, title, body, icon, tone, label] of cases) {
    assert.deepEqual(n.notificationLook({ type, title, body }), { icon, tone, label }, `${type}: ${title}`);
  }
});

test('notificationLook: the label shows only when the title does not already say it', () => {
  // A title that names no kind (an older server's wording) gets the label.
  assert.equal(n.notificationLook({ type: 'new_exam', title: 'אנגלית', body: '' }).label, 'מבחן חדש');
  assert.equal(n.notificationLook({ type: 'new_grade', title: 'מתמטיקה', body: '92' }).label, 'ציון חדש');
  assert.equal(n.notificationLook({ type: 'evening_homework', title: 'היסטוריה, מתמטיקה', body: '' }).label, 'תזכורת ערב');
  assert.equal(n.notificationLook({ type: 'sync_broken', title: 'שחף', body: '' }).label, 'בעיה בחיבור');
  assert.equal(n.notificationLook({ type: 'morning_summary', title: 'סיכום בוקר', body: '' }).label, null);
});

test('notificationLook: a schedule change that only cancels lessons gets the cancel icon', () => {
  const look = (body) => n.notificationLook({ type: 'schedule_change_today', title: 'שינוי במערכת של היום', body });
  assert.deepEqual(look('שיעור 3 מתמטיקה מבוטל'), { icon: 'cancel', tone: 'cancel', label: null });
  assert.deepEqual(look('שיעור 3 מתמטיקה מבוטל · שיעור 4 אנגלית ירד מהמערכת'), { icon: 'cancel', tone: 'cancel', label: null });
  // Anything else among the changes, or changes not listed, keeps the general icon.
  assert.equal(look('שיעור 3 מתמטיקה מבוטל · שיעור 5 היסטוריה · מ״מ: כהן').icon, 'change');
  assert.equal(look('שיעור 1 מבוטל · שיעור 2 מבוטל · שיעור 3 מבוטל · שיעור 4 מבוטל · ועוד 1').icon, 'change');
  assert.equal(look('המערכת של היום עודכנה').icon, 'change');
  assert.equal(look('').icon, 'change');
});

test('notificationLook: every notification type has its own icon and a plain-Hebrew label', () => {
  for (const type of NOTIFICATION_TYPES) {
    const look = n.notificationLook({ type, title: '', body: '' });
    assert.notEqual(look.icon, 'bell', type);
    assert.ok(n.TYPE_LABELS[type], type);
    assert.equal(look.label, n.TYPE_LABELS[type], type);
    assert.doesNotMatch(n.TYPE_LABELS[type], /סנכרון|שרת|סשן/, type);
  }
  // An unknown type from a newer server still draws.
  assert.deepEqual(n.notificationLook({ type: 'something_new', title: 'משהו', body: '' }), { icon: 'bell', tone: 'neutral', label: null });
});

// ── Grouping ────────────────────────────────────────────────────────────────

test('groupLogByDay: newest day first, labelled היום / אתמול / weekday', () => {
  const now = new Date('2026-10-08T21:00:00'); // Thursday
  const row = (id, local) => ({ id, type: 'new_exam', title: '', body: '', payload: null, sentAt: sentAt(local) });
  const groups = n.groupLogByDay([
    row(1, '2026-10-08T20:00:00'),
    row(2, '2026-10-08T07:00:00'),
    row(3, '2026-10-07T22:00:00'),
    row(4, '2026-10-06T08:00:00'),
  ], now);
  assert.deepEqual(groups.map((g) => [g.date, g.label, g.items.map((i) => i.id)]), [
    ['2026-10-08', 'היום', [1, 2]],
    ['2026-10-07', 'אתמול', [3]],
    ['2026-10-06', 'יום שלישי', [4]],
  ]);
  assert.deepEqual(n.groupLogByDay([], now), []);
});

// ── Wave 4: the bell keeps ranges left to right ──────────────────────────────

test('logRowText: ranges in a title or body are pinned left to right, the rest untouched', () => {
  const LRI = String.fromCharCode(0x2066);
  const PDI = String.fromCharCode(0x2069);
  // And no line break at the dash: a word joiner on each side of it (lib/format `isolateRanges`).
  const J = String.fromCharCode(0x2060);
  const row = n.logRowText({
    title: 'היום 08:00–10:30 · 4 בוטלו',
    body: 'שאלות 1–5 בעמוד 12\nשיעור 3 מתמטיקה מבוטל',
  });
  assert.equal(row.title, `היום ${LRI}08:00${J}–${J}10:30${PDI} · 4 בוטלו`);
  assert.equal(row.body, `שאלות ${LRI}1${J}–${J}5${PDI} בעמוד 12\nשיעור 3 מתמטיקה מבוטל`);
  // No range: as it came. Already isolated (a server that wraps them itself): not wrapped twice.
  assert.deepEqual(n.logRowText({ title: 'ציון חדש · מתמטיקה', body: '' }), { title: 'ציון חדש · מתמטיקה', body: '' });
  const wrapped = `היום ${LRI}08:00–10:30${PDI}`;
  assert.equal(n.logRowText({ title: wrapped, body: '' }).title, `היום ${LRI}08:00${J}–${J}10:30${PDI}`);
});

// ── W5-13: what is new since the log was last opened ─────────────────────────

test('isNewSince: the rows the bell counted are the ones marked "חדש", by the same rule', () => {
  const u = load(path.join(__dirname, '../src/lib/unread.ts'));
  const log = [
    { sentAt: '2026-10-08T04:00:00.000Z' },
    { sentAt: '2026-10-08T13:06:00.000Z' },
    { sentAt: '2026-10-08T17:00:00.000Z' },
  ];
  for (const seenAt of ['2026-10-08T00:00:00.000Z', '2026-10-08T13:06:00.000Z', '2026-10-08T12:00:00.000Z', '2026-10-09T00:00:00.000Z']) {
    assert.equal(log.filter((e) => n.isNewSince(e, seenAt)).length, u.countUnread(log, seenAt), seenAt);
  }
  // Sent at the very moment the log was opened: already seen.
  assert.equal(n.isNewSince(log[1], '2026-10-08T13:06:00.000Z'), false);
  // Not read yet, or a time that does not parse: nothing is marked.
  assert.equal(n.isNewSince(log[2], null), false);
  assert.equal(n.isNewSince(log[2], 'yesterday'), false);
  assert.equal(n.isNewSince({ sentAt: 'nope' }, '2026-10-08T00:00:00.000Z'), false);
});
