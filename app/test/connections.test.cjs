const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

function load(file) {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const c = load('connections.ts');

const source = (name, over = {}) => ({
  source: name, state: 'ok', lastOkAt: '2026-10-08T07:00:00Z', consecutiveFailures: 0, degradedSince: null,
  lastError: null, message: null, account: null, sourceFreshness: null, needsReauth: false, configured: true, ...over,
});

test('sourceKind: driven by configured, needsReauth and message — not by state', () => {
  assert.equal(c.sourceKind(source('mashov', { configured: false, message: 'משוב לא מחובר' })), 'off');
  assert.equal(c.sourceKind(source('mashov', { needsReauth: true, state: 'broken', message: 'משוב ניתק את החיבור' })), 'reauth');
  // One failed poll the server does not mention: still fine.
  assert.equal(c.sourceKind(source('shahaf', { state: 'degraded', message: null })), 'ok');
  assert.equal(c.sourceKind(source('google_calendar', { lastOkAt: null, message: 'עוד לא בדקנו. זה יקרה בדקות הקרובות' })), 'pending');
  assert.equal(c.sourceKind(source('shahaf', { state: 'broken', consecutiveFailures: 4, message: 'אתר בית הספר לא עונה כרגע' })), 'trouble');
  assert.equal(c.sourceKind(source('google_tasks', { lastOkAt: null, consecutiveFailures: 2, message: 'Google לא עונה כרגע' })), 'trouble');
});

test('sourceMessage: the server words, and a Hebrew line for a server that sends none', () => {
  assert.equal(c.sourceMessage(source('mashov', { message: 'משוב ניתק את החיבור' })), 'משוב ניתק את החיבור');
  const legacy = source('mashov', { state: 'broken', lastError: 'Mashov returned 401 — the captured session expired' });
  delete legacy.message;
  assert.equal(c.sourceMessage(legacy), c.FALLBACK_MESSAGE);
  assert.doesNotMatch(c.FALLBACK_MESSAGE, /[A-Za-z]/);
});

test('isConnected: credentials held and not rejected, checked or not', () => {
  assert.equal(c.isConnected(source('google_calendar', { lastOkAt: null, message: 'עוד לא בדקנו' })), true);
  assert.equal(c.isConnected(source('mashov', { needsReauth: true })), false);
  assert.equal(c.isConnected(source('mashov', { configured: false })), false);
  assert.equal(c.isConnected(undefined), false);
});

test('mergeGoogle: one card for calendar and tasks — worst state, older check, first message and account', () => {
  const merged = c.mergeGoogle(
    source('google_calendar', { lastOkAt: '2026-10-08T07:00:00Z', account: 'student@example.com' }),
    source('google_tasks', { lastOkAt: '2026-10-08T06:00:00Z', state: 'degraded', message: 'Google לא עונה כרגע' }),
  );
  assert.equal(merged.state, 'degraded');
  assert.equal(merged.lastOkAt, '2026-10-08T06:00:00Z');
  assert.equal(merged.message, 'Google לא עונה כרגע');
  assert.equal(merged.account, 'student@example.com');
  assert.equal(c.mergeGoogle(undefined, undefined), null);
});

test('connectionSummary: one line for Settings', () => {
  assert.deepEqual(c.connectionSummary([]), { text: 'בודקים…', tone: 'neutral' });
  const all = [source('google_calendar'), source('google_tasks'), source('mashov'), source('shahaf'), source('school_site')];
  assert.deepEqual(c.connectionSummary(all), { text: 'הכול מחובר', tone: 'ok' });
  // Waiting for a first check is not a problem.
  const waiting = all.map((s) => (s.source === 'mashov' ? { ...s, lastOkAt: null, message: 'עוד לא בדקנו' } : s));
  assert.equal(c.connectionSummary(waiting).tone, 'ok');
  const reauth = all.map((s) => (s.source === 'mashov' ? { ...s, needsReauth: true, message: 'משוב ניתק את החיבור' } : s));
  assert.deepEqual(c.connectionSummary(reauth), { text: 'משוב: צריך להתחבר שוב', tone: 'attention' });
  // Calendar and Tasks count once, as Google.
  const two = reauth.map((s) => (s.source.startsWith('google') ? { ...s, configured: false, message: 'חשבון Google לא מחובר' } : s));
  assert.deepEqual(c.connectionSummary(two), { text: '2 חיבורים צריכים תשומת לב', tone: 'attention' });
});

test('the cards: Google, Mashov, the school site and the exam board, and no Classroom (plan 2f)', () => {
  const all = [source('google_calendar'), source('google_tasks'), source('mashov'), source('shahaf'), source('school_site')];
  assert.deepEqual(c.connectionCards(all).map((card) => card.id), ['google', 'mashov', 'shahaf', 'school_site']);
  // The phone reads no Classroom: a source with no card is left out, connected or not.
  const withClassroom = [...all, source('google_classroom', { account: 'student@school.example' })];
  assert.deepEqual(c.connectionCards(withClassroom).map((card) => card.id), ['google', 'mashov', 'shahaf', 'school_site']);
  assert.equal(c.CARD_NAMES.classroom, undefined);
  assert.deepEqual(c.connectionCards([]), []);
  for (const key of Object.keys(c.CONNECTION_COPY)) assert.doesNotMatch(key, /classroom/i, key);
});

test('connectionSummary: "הכול מחובר" only when every card is connected (run 7)', () => {
  const all = [source('google_calendar'), source('google_tasks'), source('mashov'), source('shahaf'), source('school_site')];
  // Mashov waiting for its first check still counts as connected.
  const mashovWaiting = all.map((s) => (s.source === 'mashov' ? { ...s, lastOkAt: null, message: 'עוד לא בדקנו' } : s));
  assert.deepEqual(c.connectionSummary(mashovWaiting), { text: 'הכול מחובר', tone: 'ok' });
  // Google not connected: that is what the line says, not "הכול".
  const noGoogle = all.map((s) => (s.source.startsWith('google') ? { ...s, configured: false, message: null } : s));
  assert.deepEqual(c.connectionSummary(noGoogle), { text: 'Google: לא מחובר', tone: 'attention' });
  // A Classroom the status still lists changes nothing.
  const reauth = [...all, source('google_classroom', { needsReauth: true, message: 'צריך לאשר מחדש את החיבור ל־Google Classroom' })];
  assert.deepEqual(c.connectionSummary(reauth), { text: 'הכול מחובר', tone: 'ok' });
  // Something else wrong: that is what the line says, as before.
  const cut = all.map((s) => (s.source === 'mashov' ? { ...s, needsReauth: true, message: 'משוב ניתק את החיבור' } : s));
  assert.deepEqual(c.connectionSummary(cut), { text: 'משוב: צריך להתחבר שוב', tone: 'attention' });
});

test('checkedAgo: whole words, never "דק׳" or "שע׳" (Daniel)', () => {
  const now = new Date('2026-10-08T18:00:00Z');
  const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  assert.equal(c.checkedAgo(ago(0), now), 'בדקנו עכשיו');
  assert.equal(c.checkedAgo(ago(1), now), 'בדקנו לפני דקה');
  assert.equal(c.checkedAgo(ago(8), now), 'בדקנו לפני 8 דקות');
  assert.equal(c.checkedAgo(ago(59), now), 'בדקנו לפני 59 דקות');
  assert.equal(c.checkedAgo(ago(60), now), 'בדקנו לפני שעה');
  assert.equal(c.checkedAgo(ago(120), now), 'בדקנו לפני שעתיים');
  assert.equal(c.checkedAgo(ago(8 * 60), now), 'בדקנו לפני 8 שעות');
  assert.equal(c.checkedAgo(ago(26 * 60), now), 'בדקנו אתמול');
  assert.equal(c.checkedAgo(ago(48 * 60), now), 'בדקנו לפני יומיים');
  assert.equal(c.checkedAgo(ago(5 * 24 * 60), now), 'בדקנו לפני 5 ימים');
  assert.equal(c.checkedAgo('not a time', now), '');
  for (const minutes of [0, 1, 5, 61, 300, 2000, 9000]) assert.doesNotMatch(c.checkedAgo(ago(minutes), now), /׳/);
});

test('mailReadLine: how many messages the last read brought, and from how many pages', () => {
  assert.equal(c.mailReadLine({ mail: 87, mailPages: 5 }), 'הודעות בקריאה האחרונה: 87, מ־5 עמודים');
  assert.equal(c.mailReadLine({ mail: 12, mailPages: 1 }), 'הודעות בקריאה האחרונה: 12, מעמוד אחד');
  // A read kept from before the pages were counted says nothing.
  assert.equal(c.mailReadLine({ mail: 20 }), null);
  assert.equal(c.mailReadLine(null), null);
  assert.equal(c.mailReadLine(undefined), null);
});

test('CONNECTION_COPY: a ninth grader\'s words — no "יפוג", no "נקרא", nothing about how it is built', () => {
  for (const [key, line] of Object.entries(c.CONNECTION_COPY)) {
    assert.doesNotMatch(line, /יפוג|נקרא|סשן|שרת|סנכרון/, key);
  }
  assert.match(c.CONNECTION_COPY.mashovDrops, /^אם משוב ינתק את החיבור, נשלח התראה/);
  assert.match(c.CONNECTION_COPY.mashovDisconnected, /מה שכבר הגיע נשאר/);
  // Disconnecting Google deletes what came from it on the phone (`disconnectGoogle`): the words say so.
  assert.match(c.CONNECTION_COPY.googleDisconnect, /יימחק מהטלפון/);
  assert.match(c.CONNECTION_COPY.googleDisconnected, /נמחק מהטלפון/);
  for (const line of [c.CONNECTION_COPY.googleDisconnect, c.CONNECTION_COPY.googleDisconnected]) assert.doesNotMatch(line, /נשאר|יישאר/, line);
});

test('plan §16: each account\'s line under its name is one short line, with no tick, dash or dot chain', () => {
  const { googleUse, googleUseNoExams, mashovUse, mashovDrops } = c.CONNECTION_COPY;
  for (const line of [googleUse, googleUseNoExams, mashovUse, mashovDrops]) {
    assert.ok(line.length <= 60, `${line}: ${line.length} characters`);
    assert.doesNotMatch(line, /[✓✔]|\s—\s|·/, line);
  }
  // The exams go to their own calendar, said once; with the setting off, it says so.
  assert.match(googleUse, /״בית ספר״/);
  assert.match(googleUseNoExams, /כבויה/);
  assert.match(googleUseNoExams, /בהגדרות, ב״Google״/);
  for (const text of Object.values(c.KIND_LABELS)) assert.doesNotMatch(text, /[✓✔]/, text);
});

test('googleReadMessage: a read that keeps failing is said, one that just failed is not', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
  const status = (over) => ({ lastOkAt: hoursAgo(1), lastError: null, needsLogin: false, ...over });
  assert.equal(c.googleReadMessage(status({}), now), null);
  // A stale read with no error is a phone that did not try: nothing wrong to say.
  assert.equal(c.googleReadMessage(status({ lastOkAt: hoursAgo(144) }), now), null);
  assert.equal(c.googleReadMessage(status({ lastError: 'Google 500', lastOkAt: hoursAgo(c.GOOGLE_QUIET_HOURS - 1) }), now), null);
  const late = c.googleReadMessage(status({ lastError: 'Google 500', lastOkAt: hoursAgo(c.GOOGLE_QUIET_HOURS + 1) }), now);
  assert.equal(late, c.CONNECTION_COPY.googleNotRead);
  assert.equal(c.googleReadMessage(status({ lastError: 'Google 500', lastOkAt: null }), now), c.CONNECTION_COPY.googleNotRead);
  assert.equal(c.googleReadMessage(status({ lastError: 'no sign-in', needsLogin: true }), now), c.CONNECTION_COPY.googleNeedsLogin);
});

test('movedToGoogleLabel: one task or several, and never the name of Google\'s task app', () => {
  assert.equal(c.movedToGoogleLabel(1), 'משימה אחת עברה ל־Google');
  assert.equal(c.movedToGoogleLabel(3), '3 משימות עברו ל־Google');
  assert.equal(c.movedToGoogleLabel(12), '12 משימות עברו ל־Google');
  for (const n of [1, 2, 20]) assert.doesNotMatch(c.movedToGoogleLabel(n), /Tasks/);
});

test('googleReadMessage: the card stops saying "מחובר" for a read that keeps failing', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const lastOkAt = '2026-10-31T12:00:00Z';
  const message = c.googleReadMessage({ lastOkAt, lastError: 'Google 500', needsLogin: false }, now);
  const card = source('google_calendar', { lastOkAt, lastError: 'Google 500', state: 'degraded', message });
  assert.equal(c.sourceKind(card), 'trouble');
  assert.equal(c.sourceKind(c.mergeGoogle(card, { ...card, source: 'google_tasks' })), 'trouble');
});

test('tasksHome: where the tasks live, from the tasks source alone', () => {
  assert.equal(c.tasksHome(undefined), 'unknown');
  assert.equal(c.tasksHome({ ...c.notConnected('google_tasks') }), 'phone');
  assert.equal(c.tasksHome({ ...c.notConnected('google_tasks'), configured: true }), 'google');
  assert.equal(c.tasksHome({ ...c.notConnected('google_tasks'), configured: true, needsReauth: true }), 'reauth');
});

test('CONNECTION_COPY: the tasks screen says they stay on the phone, and what Google adds, without the name of its task app', () => {
  assert.equal(c.CONNECTION_COPY.tasksOnPhone, 'המשימות נשמרות רק בטלפון הזה. אפשר לחבר Google כדי לשמור אותן גם שם');
  assert.equal(c.CONNECTION_COPY.tasksConnect, 'לחבר Google');
  for (const line of [c.CONNECTION_COPY.tasksOnPhone, c.CONNECTION_COPY.tasksConnect]) assert.doesNotMatch(line, /Tasks/, line);
});
