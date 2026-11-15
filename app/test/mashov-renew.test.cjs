const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const m = load(path.join(__dirname, '../src/lib/mashovRenew.ts'));

const FAILED_AT = '2026-10-08T22:15:00.000Z';

const mashov = (over = {}) => ({
  source: 'mashov', state: 'broken', lastOkAt: '2026-10-08T19:00:00Z', consecutiveFailures: 1,
  degradedSince: FAILED_AT, lastError: 'Mashov returned 401', message: 'משוב ניתק את החיבור', account: null,
  session: { capturedAt: '2026-10-08T18:40:00Z', lastOkAt: '2026-10-08T21:30:00Z', failedAt: FAILED_AT },
  sourceFreshness: null, needsReauth: true, configured: true, ...over,
});

// ── Whether to try by itself ────────────────────────────────────────────────

test('shouldAutoRenew: once per outage, keyed on failedAt', () => {
  assert.deepEqual(m.shouldAutoRenew(mashov(), null), { attempt: true, key: FAILED_AT });
  // The same outage, on the next return to the app: already tried.
  assert.deepEqual(m.shouldAutoRenew(mashov(), FAILED_AT), { attempt: false, key: FAILED_AT });
  // A new outage after a renewal: a new key, a new try.
  const next = '2026-10-09T23:05:00.000Z';
  assert.deepEqual(
    m.shouldAutoRenew(mashov({ degradedSince: next, session: { capturedAt: null, lastOkAt: null, failedAt: next } }), FAILED_AT),
    { attempt: true, key: next },
  );
});

test('shouldAutoRenew: a renewal Mashov rejected keeps its key, so no second try', () => {
  // POST /sessions/mashov clears needsReauth but not degradedSince, and the
  // failed verify-poll keeps it: /status comes back with the same failedAt.
  const afterRejected = mashov({ session: { capturedAt: '2026-10-09T05:10:00Z', lastOkAt: null, failedAt: FAILED_AT } });
  assert.equal(m.shouldAutoRenew(afterRejected, FAILED_AT).attempt, false);
});

test('shouldAutoRenew: never when there is nothing a new login fixes', () => {
  assert.equal(m.shouldAutoRenew(undefined, null).attempt, false);
  assert.equal(m.shouldAutoRenew(null, null).attempt, false);
  // Never connected: onboarding's job.
  assert.equal(m.shouldAutoRenew(mashov({ configured: false }), null).attempt, false);
  // Connected and fine.
  const fine = mashov({ needsReauth: false, state: 'ok', degradedSince: null, session: { capturedAt: null, lastOkAt: null, failedAt: null } });
  assert.deepEqual(m.shouldAutoRenew(fine, null), { attempt: false, key: null });
  // A network failure without a rejection is not a login problem.
  assert.equal(m.shouldAutoRenew(mashov({ needsReauth: false, session: { capturedAt: null, lastOkAt: null, failedAt: null } }), null).attempt, false);
  // Rejected, but no time to count the try against: no automatic try.
  assert.deepEqual(m.shouldAutoRenew(mashov({ degradedSince: null, session: { capturedAt: null, lastOkAt: null, failedAt: null } }), null), { attempt: false, key: null });
});

test('renewGate: waits for the read, then trusts the phone over the status snapshot', () => {
  // iPhone, 2026-11-04: back in the app after the session ended. The first read
  // failed and saved needsLogin; a status fetched then said needsReauth; a second
  // later the "מכשיר אישי" pass logged in again (HTTP 200) and the read worked,
  // but the sheet had already opened on the snapshot: "נדרשה לחיצה".
  // (a) The read is still running: it may yet log in with the pass. Wait.
  assert.equal(m.renewGate({ reading: true, needsLogin: true }), 'wait');
  assert.equal(m.renewGate({ reading: true, needsLogin: false }), 'wait');
  // (b) The read is done and the phone is logged in again: the snapshot's
  // needsReauth is stale, nothing to renew.
  assert.equal(m.renewGate({ reading: false, needsLogin: false }), 'fine');
  // (c) The read is done and still needs a login: today's decision.
  assert.equal(m.renewGate({ reading: false, needsLogin: true }), 'decide');
});

test('renewKey: failedAt, else degradedSince', () => {
  assert.equal(m.renewKey(mashov()), FAILED_AT);
  assert.equal(m.renewKey(mashov({ session: undefined })), FAILED_AT);
  assert.equal(m.renewKey(mashov({ session: undefined, degradedSince: '2026-10-08T20:00:00Z' })), '2026-10-08T20:00:00Z');
  assert.equal(m.renewKey(undefined), null);
  // configured with a failure, needsReauth not (yet) set: still a renewal case.
  assert.equal(m.needsRenewal(mashov({ needsReauth: false })), true);
});

// ── The login page ──────────────────────────────────────────────────────────

test('captureVia: auto only when nobody touched anything', () => {
  assert.equal(m.captureVia(false), 'auto');
  assert.equal(m.captureVia(true), 'manual');
});

test('isNewAuthCookie: the cookie from before the night is not a new login', () => {
  assert.equal(m.isNewAuthCookie(undefined, null), false);
  assert.equal(m.isNewAuthCookie('', null), false);
  assert.equal(m.isNewAuthCookie('jwt-old', 'jwt-old'), false);
  assert.equal(m.isNewAuthCookie('jwt-new', 'jwt-old'), true);
  assert.equal(m.isNewAuthCookie('jwt-new', null), true);
});

test('pageKind: Mashov, the Ministry, or neither', () => {
  assert.equal(m.pageKind('https://web.mashov.info/students/login'), 'mashov');
  assert.equal(m.pageKind('https://web.mashov.info/api/idm/callback?code=x'), 'mashov');
  assert.equal(m.pageKind('https://lgn.edu.gov.il/nidp/oauth/nam/authz?response_type=code'), 'idp');
  assert.equal(m.pageKind('HTTPS://LGN.EDU.GOV.IL/nidp/app/login'), 'idp');
  assert.equal(m.pageKind('https://evil.example/web.mashov.info'), 'other');
  assert.equal(m.pageKind('https://notgov.il.example.com/'), 'other');
  assert.equal(m.pageKind('about:blank'), 'other');
  assert.equal(m.pageKind(null), 'other');
  assert.equal(m.pageKind(undefined), 'other');
});

test('touchedPage: reads only the touch report', () => {
  const report = (href) => JSON.stringify({ type: m.TOUCH_MESSAGE, href });
  assert.equal(m.touchedPage(report('https://lgn.edu.gov.il/nidp/app/login')), 'idp');
  assert.equal(m.touchedPage(report('https://web.mashov.info/students/login')), 'mashov');
  assert.equal(m.touchedPage(JSON.stringify({ type: 'something-else', href: 'https://web.mashov.info/' })), null);
  assert.equal(m.touchedPage('not json'), null);
  assert.equal(m.touchedPage('null'), null);
});

test('TOUCH_REPORTER: valid script; reports the first touch once per page, and only once installed', () => {
  const listeners = {};
  const posted = [];
  const window = { ReactNativeWebView: { postMessage: (s) => posted.push(s) } };
  const document = { addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); } };
  const location = { href: 'https://lgn.edu.gov.il/nidp/app/login?sid=0' };
  const run = () => new Function('window', 'document', 'location', m.TOUCH_REPORTER)(window, document, location);
  // Ends in a value, as react-native-webview asks of injected scripts.
  assert.match(m.TOUCH_REPORTER, /true;\s*$/);
  run();
  run(); // injected again into the same page: no second set of listeners
  assert.deepEqual(Object.keys(listeners).sort(), ['input', 'keydown', 'pointerdown', 'touchstart']);
  assert.equal(listeners.touchstart.length, 1);
  listeners.touchstart[0]();
  listeners.keydown[0]();
  assert.equal(posted.length, 1);
  assert.equal(m.touchedPage(posted[0]), 'idp');
});

test('cookiesToExpire: Mashov cookies only, never the device cookie', () => {
  assert.deepEqual(
    m.cookiesToExpire(['MashovAuthToken', 'Csrf-Token', 'MashovIdmTokenID', 'uniquId', 'IdmAppName', 'MashovAuthToken', '']),
    ['MashovAuthToken', 'Csrf-Token', 'MashovIdmTokenID', 'IdmAppName'],
  );
  assert.deepEqual(m.cookiesToExpire([]), []);
});

test('expiringCookieLines: expired, for the domain cookie and the host-only one', () => {
  const lines = m.expiringCookieLines('MashovAuthToken', 'https://web.mashov.info');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /^MashovAuthToken=; /);
    assert.match(line, /Max-Age=0/);
    assert.match(line, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(line, /Path=\//);
  }
  assert.match(lines[0], /Domain=\.web\.mashov\.info$/);
  assert.doesNotMatch(lines[1], /Domain=/);
  // Never anything for the Ministry's host.
  assert.doesNotMatch(lines.join('\n'), /gov\.il/);
  assert.deepEqual(m.expiringCookieLines('x', 'not a url'), [lines[1].replace('MashovAuthToken', 'x')]);
});

// ── What happened, for "פרטים טכניים" ───────────────────────────────────────

const AT = '2026-10-09T04:42:00.000Z';
const record = (over = {}) => ({ at: AT, trigger: 'auto', end: 'verified', via: 'auto', touched: [], visitedIdp: true, ...over });

test('renewDetail: "הצליח ב־" only when it went through by itself', () => {
  assert.deepEqual(m.renewDetail(record()), { label: 'חידוש אוטומטי אחרון', verdict: 'הצליח ב־', at: AT, reason: null });
  assert.equal(m.renewDetail(null), null);
  // Verified, but the person logged in: the automatic renewal did not work.
  assert.equal(m.renewDetail(record({ via: 'manual', touched: ['mashov'] })).verdict, 'לא הצליח ב־');
});

test('renewReason: where the person had to act, the Ministry first', () => {
  assert.equal(m.renewReason(record({ via: 'manual', touched: ['mashov', 'idp'] })), 'נדרשה כניסה בהזדהות אחידה');
  assert.equal(m.renewReason(record({ end: 'closed', via: null, touched: ['idp'] })), 'נדרשה כניסה בהזדהות אחידה');
  // Only Mashov asked, and the identification then went through untouched: the layer-2 signal.
  assert.equal(m.renewReason(record({ via: 'manual', touched: ['mashov'] })), 'נדרשה לחיצה במשוב, והזדהות אחידה עברה לבד');
  assert.equal(m.renewReason(record({ via: 'manual', touched: ['mashov'], visitedIdp: false })), 'נדרשה כניסה במשוב');
  assert.equal(m.renewReason(record({ end: 'closed', via: null, touched: ['mashov'] })), 'נדרשה כניסה במשוב');
  assert.equal(m.renewReason(record({ via: 'manual', touched: ['other'] })), 'נדרשה לחיצה');
  assert.equal(m.renewReason(record({ end: 'rejected' })), 'משוב לא אישר את הכניסה');
  assert.equal(m.renewReason(record({ end: 'error' })), 'לא הצלחנו לבדוק מול משוב');
  assert.equal(m.renewReason(record({ end: 'closed', via: null })), 'נסגר לפני שהסתיים');
  assert.equal(m.renewReason(record()), null);
});

test('parseRenewRecord: round trip, and nothing unreadable gets through', () => {
  const r = record({ trigger: 'push', via: 'manual', touched: ['mashov', 'idp'] });
  assert.deepEqual(m.parseRenewRecord(JSON.stringify(r)), r);
  assert.equal(m.parseRenewRecord(undefined), null);
  assert.equal(m.parseRenewRecord(''), null);
  assert.equal(m.parseRenewRecord('{'), null);
  assert.equal(m.parseRenewRecord('null'), null);
  assert.equal(m.parseRenewRecord(JSON.stringify({ ...r, end: 'maybe' })), null);
  assert.equal(m.parseRenewRecord(JSON.stringify({ ...r, at: 'yesterday' })), null);
  assert.deepEqual(
    m.parseRenewRecord(JSON.stringify({ at: AT, end: 'closed', touched: ['idp', 'elsewhere', 3], via: 'sideways' })),
    { at: AT, trigger: 'auto', end: 'closed', via: null, touched: ['idp'], visitedIdp: false },
  );
});

test('copy: the given words, neutral, nothing about how the app is built', () => {
  assert.equal(m.RENEW_COPY.title, 'מתחברים מחדש למשוב…');
  assert.equal(m.RENEW_COPY.renewed, 'התחברנו מחדש למשוב');
  assert.equal(m.RENEW_COPY.notNow, 'לא עכשיו');
  const banned = /סשן|שרת|סנכרון/;
  for (const text of Object.values(m.RENEW_COPY)) assert.doesNotMatch(text, banned);
  for (const file of ['components/MashovRenewSheet.tsx', 'components/useMashovCapture.ts', 'screens/MashovLoginScreen.tsx']) {
    const hebrew = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').match(/[֐-׿][^'"`{}<>\n]*/g) ?? [];
    for (const text of hebrew) assert.doesNotMatch(text, banned, `${file}: ${text}`);
  }
});

// ── Opening the sheet from outside it ───────────────────────────────────────

test('requestMashovRenew: a cold-start tap waits for the sheet, then arrives once', () => {
  m.requestMashovRenew('push');
  const got = [];
  const off = m.onMashovRenewRequest((t) => got.push(t));
  assert.deepEqual(got, ['push']);
  m.requestMashovRenew();
  assert.deepEqual(got, ['push', 'push']);
  off();
  // Unsubscribed: kept for the next listener, not delivered to the old one.
  m.requestMashovRenew('push');
  assert.deepEqual(got, ['push', 'push']);
  const later = [];
  const off2 = m.onMashovRenewRequest((t) => later.push(t));
  assert.deepEqual(later, ['push']);
  off2();
});

test('requestMashovRenew: ignored while the full login screen is open', () => {
  const got = [];
  const off = m.onMashovRenewRequest((t) => got.push(t));
  const release = m.holdLoginScreen();
  assert.equal(m.loginScreenOpen(), true);
  m.requestMashovRenew('push');
  assert.deepEqual(got, []);
  release();
  release(); // twice is harmless
  assert.equal(m.loginScreenOpen(), false);
  m.requestMashovRenew('push');
  assert.deepEqual(got, ['push']);
  off();
});

// ── The login WebView's user agent on the iPhone ─────────────────────────────

/**
 * Mashov's own browser sniff (web.mashov.info/students, chunk-Y3CPZQLD.js,
 * 2026-11-01), cut to the branches an iPhone or an Android WebView reaches,
 * and what its login page then calls the device (`mashovSession.device`).
 */
function mashovSniff(agent) {
  const e = agent.toLowerCase();
  const n = /(edg)\/([\w.]+)/.exec(e) || /(opr)[/]([\w.]+)/.exec(e) || /(chrome)[ /]([\w.]+)/.exec(e)
    || /(crios)[ /]([\w.]+)/.exec(e) || /(version)(applewebkit)[ /]([\w.]+).*(safari)[ /]([\w.]+)/.exec(e)
    || /(webkit)[ /]([\w.]+).*(version)[ /]([\w.]+).*(safari)[ /]([\w.]+)/.exec(e) || /(webkit)[ /]([\w.]+)/.exec(e) || [];
  const name = n[5] || n[3] || n[1] || '';
  return { name, versionNumber: parseInt(n[4] || n[2] || '0', 10), deviceUuid: name, devicePlatform: name };
}
/** Its supported browsers and their lowest versions, from the same page. */
const MASHOV_SUPPORTED = { chrome: 82, mozilla: 78, msedge: 17, opera: 68, safari: 12 };
const supported = (b) => b.name in MASHOV_SUPPORTED && b.versionNumber >= MASHOV_SUPPORTED[b.name];

const WKWEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

test('a bare WKWebView is a browser Mashov does not know: the red banner, and a "webkit" device', () => {
  const b = mashovSniff(WKWEBVIEW);
  assert.equal(b.name, 'webkit');
  assert.equal(supported(b), false);
  assert.equal(b.devicePlatform, 'webkit');
});

test('with Safari\'s last words the iPhone WebView reads as Safari, as Android\'s reads as Chrome', () => {
  // WebKit appends `applicationNameForUserAgent` after its own "Mobile/15E148".
  const b = mashovSniff(`${WKWEBVIEW} ${m.safariAgentSuffix('18.1')}`);
  assert.deepEqual([b.name, b.versionNumber, supported(b)], ['safari', 18, true]);
  const android = mashovSniff('Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36');
  assert.deepEqual([android.name, supported(android)], ['chrome', true]);
});

test('Safari\'s version is the system\'s, major and minor', () => {
  assert.equal(m.safariAgentSuffix('18.1'), 'Version/18.1 Safari/604.1');
  assert.equal(m.safariAgentSuffix('17'), 'Version/17.0 Safari/604.1');
  assert.equal(m.safariAgentSuffix('26.0.1'), 'Version/26.0 Safari/604.1');
  assert.equal(m.safariAgentSuffix(''), 'Version/18.0 Safari/604.1');
});
