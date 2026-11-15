const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

const ORIGIN = 'https://web.mashov.info';

/**
 * The cookie module as two stores: `true` is WebKit's, `false` the one
 * `fetch` uses. Every call is recorded, so Android's can be compared exactly.
 */
const cookies = {
  calls: [],
  stores: { web: {}, shared: {} },
  reset(web = {}, shared = {}) {
    this.calls = [];
    this.stores = { web, shared };
  },
  store(useWebKit) {
    return useWebKit ? this.stores.web : this.stores.shared;
  },
  async get(url, useWebKit) {
    this.calls.push(['get', url, useWebKit]);
    return { ...this.store(useWebKit) };
  },
  async set(url, cookie, useWebKit) {
    this.calls.push(['set', url, cookie, useWebKit]);
    this.store(useWebKit)[cookie.name] = cookie;
    return true;
  },
  async clearByName(url, name, useWebKit) {
    this.calls.push(['clearByName', url, name, useWebKit]);
    const found = name in this.store(useWebKit);
    delete this.store(useWebKit)[name];
    return found;
  },
  async clearAll(useWebKit) {
    this.calls.push(['clearAll', useWebKit]);
    return true;
  },
  async setFromResponse(url, line) {
    this.calls.push(['setFromResponse', url, line]);
    return true;
  },
  async flush() {
    this.calls.push(['flush']);
  },
};

const SRC = path.join(__dirname, '../src');
const SHARED = path.join(__dirname, '../../shared/src');

/**
 * Loads a TypeScript module from src the way the bundler does for `platform`
 * (`x.ios.ts` before `x.ts`), with the native module stubbed and
 * `@sederyom/shared` from its sources.
 */
const cache = new Map();
function load(file, platform) {
  const key = `${platform}:${file}`;
  if (cache.has(key)) return cache.get(key);
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(key, module.exports);
  const stubs = {
    '@react-native-cookies/cookies': cookies,
    '../config': { MASHOV_ORIGIN: ORIGIN },
  };
  const ts = (base) => (fs.existsSync(`${base}.${platform}.ts`) ? `${base}.${platform}.ts` : `${base}.ts`);
  const req = (spec) => {
    if (spec in stubs) return stubs[spec];
    if (spec.startsWith('@sederyom/shared/')) return load(ts(path.join(SHARED, spec.slice('@sederyom/shared/'.length))), platform);
    if (spec.startsWith('.')) return load(ts(path.resolve(path.dirname(file), spec)), platform);
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}

const ios = { jar: load(path.join(SRC, 'mashov/cookieJar.ios.ts'), 'ios'), phone: load(path.join(SRC, 'mashov/phone.ts'), 'ios') };
const android = { jar: load(path.join(SRC, 'mashov/cookieJar.ts'), 'android'), phone: load(path.join(SRC, 'mashov/phone.ts'), 'android') };

test('both platforms export the same jar', () => {
  assert.deepEqual(Object.keys(ios.jar).sort(), Object.keys(android.jar).sort());
});

const cookie = (name, value, over = {}) => ({
  name, value, path: '/', domain: 'web.mashov.info', version: '0', secure: true, httpOnly: true, ...over,
});

// ── iOS: the shared store is the jar ───────────────────────────────────────

test('iOS: a WebView login is copied into the store fetch uses', async () => {
  cookies.reset(
    {
      MashovAuthToken: cookie('MashovAuthToken', 'new-token', { expires: '2026-10-22T13:00:00.000+03:00' }),
      'Csrf-Token': cookie('Csrf-Token', 'csrf-1', { httpOnly: false }),
      uniquId: cookie('uniquId', 'device', { domain: '.mashov.info', expires: 'not a date' }),
    },
    // The WebView's observer already copied the CSRF cookie; the auth token there is yesterday's.
    { 'Csrf-Token': cookie('Csrf-Token', 'csrf-1', { httpOnly: false }), MashovAuthToken: cookie('MashovAuthToken', 'old-token') },
  );
  await ios.jar.syncWebViewCookiesToShared();

  assert.deepEqual(cookies.calls.filter(([op]) => op === 'get'), [['get', ORIGIN, true], ['get', ORIGIN, false]]);
  const writes = cookies.calls.filter(([op]) => op !== 'get');
  // Same value already there: left alone. The others: any other spelling cleared, then set, all in the shared store.
  assert.deepEqual(writes, [
    ['clearByName', ORIGIN, 'MashovAuthToken', false],
    ['set', ORIGIN, {
      name: 'MashovAuthToken', value: 'new-token', domain: 'web.mashov.info', path: '/',
      expires: '2026-10-22T10:00:00.000Z', secure: true, httpOnly: true,
    }, false],
    ['clearByName', ORIGIN, 'uniquId', false],
    // An expiry `set` could not read is left out rather than sent broken.
    ['set', ORIGIN, { name: 'uniquId', value: 'device', domain: '.mashov.info', path: '/', secure: true, httpOnly: true }, false],
  ]);
  assert.equal(cookies.stores.shared.MashovAuthToken.value, 'new-token');
  // WebKit's store is only read.
  assert.deepEqual(Object.keys(cookies.stores.web).sort(), ['Csrf-Token', 'MashovAuthToken', 'uniquId']);
});

test('iOS: the phone reads the shared store, CSRF token and rotated token included', async () => {
  // A read rotated the session: the shared store has it, WebKit still has the login's.
  cookies.reset(
    { MashovAuthToken: cookie('MashovAuthToken', 'login-token'), 'Csrf-Token': cookie('Csrf-Token', 'csrf-login') },
    { MashovAuthToken: cookie('MashovAuthToken', 'rotated-token'), 'Csrf-Token': cookie('Csrf-Token', 'csrf-rotated') },
  );
  assert.deepEqual(await ios.phone.readMashovJar(), { MashovAuthToken: 'rotated-token', 'Csrf-Token': 'csrf-rotated' });
  assert.deepEqual(cookies.calls, [['get', ORIGIN, false]]);
  assert.deepEqual(await ios.jar.fetchStoreNames(), ['MashovAuthToken', 'Csrf-Token']);
});

test('iOS: expiring and disconnecting reach both stores, WebKit first', async () => {
  cookies.reset();
  await ios.jar.expireCookies(['MashovAuthToken', 'Csrf-Token']);
  assert.deepEqual(cookies.calls, [
    ['clearByName', ORIGIN, 'MashovAuthToken', true],
    ['clearByName', ORIGIN, 'MashovAuthToken', false],
    ['clearByName', ORIGIN, 'Csrf-Token', true],
    ['clearByName', ORIGIN, 'Csrf-Token', false],
  ]);
  cookies.reset();
  await ios.jar.clearJar();
  assert.deepEqual(cookies.calls, [['clearAll', true], ['clearAll', false]]);
});

// ── Android: exactly the calls it made before ─────────────────────────────

test('Android: one store, the calls unchanged', async () => {
  cookies.reset({ MashovAuthToken: cookie('MashovAuthToken', 'token'), 'Csrf-Token': cookie('Csrf-Token', 'csrf') });

  assert.deepEqual(await android.phone.readMashovJar(), { MashovAuthToken: 'token', 'Csrf-Token': 'csrf' });
  assert.deepEqual(cookies.calls, [['get', ORIGIN, true]]);

  cookies.calls = [];
  await android.jar.syncWebViewCookiesToShared();
  assert.deepEqual(await android.jar.fetchStoreNames(), []);
  assert.deepEqual(cookies.calls, [], 'no copy and no second read');

  await android.jar.expireCookies(['MashovAuthToken']);
  const gone = 'MashovAuthToken=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly';
  assert.deepEqual(cookies.calls, [
    ['setFromResponse', ORIGIN, `${gone}; Domain=.web.mashov.info`],
    ['setFromResponse', ORIGIN, gone],
    ['flush'],
  ]);

  cookies.calls = [];
  await android.jar.clearJar();
  assert.deepEqual(cookies.calls, [['clearAll', true]]);
});

test('either platform: a jar that cannot be read is empty', async () => {
  for (const { phone } of [ios, android]) {
    const get = cookies.get;
    cookies.get = async () => {
      throw new Error('no native module');
    };
    try {
      assert.deepEqual(await phone.readMashovJar(), {});
    } finally {
      cookies.get = get;
    }
  }
});
