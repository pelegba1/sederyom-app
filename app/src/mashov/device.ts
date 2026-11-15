/**
 * Mashov's "מכשיר אישי" login (plan Phase 2, step 4; a trial).
 *
 * Mashov's own app has a "personal device" box at login: ticked, the login
 * answer carries a `devicePass` header, and later `POST /api/loginDevice`
 * with that header starts a new session with nobody typing anything. Mashov's
 * help says such a login lasts "until you log out". Its website runs the same
 * code (web.mashov.info/students, `execLogin` / `createSessionFromResposne`)
 * but hides the box, so the login page here ticks it: `loginPagePatch`
 * adds `isPrivateDevice: true` to the login request and reports the answer's
 * `devicePass`. The phone keeps it, and once Mashov's 8 hours are up it logs
 * in again by itself (`run.ts`), from the background too: it is one request,
 * no page. On a parent's phone the same script also hands each login answer's
 * list of children to `parents.ts`.
 *
 * Whether Mashov issues the pass to its website's identity and after the
 * Ministry's identification is what this trial finds out (`deviceLoginState`).
 * The password never leaves the page: the reported request drops it.
 */
import { MASHOV_ORIGIN } from '../config';
import { ACCESS_TOKEN_VIEW_JS } from './parents';
import type { KeyValue } from './sync';

export const DEVICE_KEYS = {
  pass: 'mashov.devicePass',
  fields: 'mashov.deviceFields',
  state: 'mashov.deviceLogin',
  /** `'1'` while the switch in מצב חיבורים says not to tick the box. */
  off: 'mashov.deviceLoginOff',
  /** `'1'` after Mashov refused a ticked login, until a login works. */
  paused: 'mashov.deviceLoginPaused',
  /** Ticked logins Mashov refused in a row. */
  strikes: 'mashov.deviceLoginStrikes',
} as const;

/** Ticked logins refused in a row that stop the ticking until the switch turns it on again. */
export const DEVICE_LOGIN_STRIKES = 3;

/**
 * Whether the login page ticks "personal device", and if not, why:
 *
 *  - `on`: it does.
 *  - `paused`: Mashov refused the last ticked login. That may have been for
 *    the tick, or for a mistyped password: the next login goes out as the
 *    site sends it, and once a login works the box is ticked again.
 *  - `stopped`: refused `DEVICE_LOGIN_STRIKES` times in a row; ticked again
 *    only from the switch.
 *  - `off`: the switch.
 *
 * A single refusal used to turn the box off for good, and only a switch deep
 * in מצב חיבורים turned it back on: a student who mistyped once would log in
 * every 8 hours from then on, without knowing why (ideas ל3).
 */
export type DeviceLoginMode = 'on' | 'paused' | 'stopped' | 'off';

const strikesOf = (kv: KeyValue): number => Number(kv.getString(DEVICE_KEYS.strikes) || 0) || 0;

/**
 * Before the pause there was only the switch, and a refused ticked login set
 * it. Such an "off" (the last login was refused) is a pause with one strike;
 * any other is the student's own.
 */
function takeOldOff(kv: KeyValue): void {
  if (kv.getString(DEVICE_KEYS.off) !== '1' || kv.getString(DEVICE_KEYS.paused) !== undefined) return;
  if ((deviceLoginState(kv).lastLogin?.status ?? 0) < 400) return;
  kv.set(DEVICE_KEYS.off, '');
  kv.set(DEVICE_KEYS.paused, '1');
  kv.set(DEVICE_KEYS.strikes, '1');
}

export function deviceLoginMode(kv: KeyValue): DeviceLoginMode {
  takeOldOff(kv);
  if (kv.getString(DEVICE_KEYS.off) === '1') return 'off';
  if (kv.getString(DEVICE_KEYS.paused) === '1') return strikesOf(kv) >= DEVICE_LOGIN_STRIKES ? 'stopped' : 'paused';
  return 'on';
}

/** Whether the next login goes out with the box ticked. */
export function deviceLoginOn(kv: KeyValue): boolean {
  return deviceLoginMode(kv) === 'on';
}

/**
 * The switch. Turning it on also starts the count of refusals afresh. The
 * pause is written either way: an "off" beside a pause that was never written
 * would read as the old automatic one (`takeOldOff`) and turn itself on again.
 */
export function setDeviceLoginOn(kv: KeyValue, on: boolean): void {
  kv.set(DEVICE_KEYS.off, on ? '' : '1');
  if (on) {
    kv.set(DEVICE_KEYS.paused, '');
    kv.set(DEVICE_KEYS.strikes, '');
  } else if (kv.getString(DEVICE_KEYS.paused) === undefined) {
    kv.set(DEVICE_KEYS.paused, '');
  }
}

/** A login that worked: a pause ends, and the next login is ticked again, unless the strikes stopped it. */
export function noteMashovLoginWorked(kv: KeyValue): void {
  takeOldOff(kv);
  if (kv.getString(DEVICE_KEYS.paused) === '1' && strikesOf(kv) < DEVICE_LOGIN_STRIKES) kv.set(DEVICE_KEYS.paused, '');
}

/** What a Mashov login sends about the app and the device; `loginDevice` sends the same. */
const FIELD_NAMES = ['appName', 'apiVersion', 'appVersion', 'appBuild', 'deviceUuid', 'devicePlatform', 'deviceManufacturer', 'deviceModel', 'deviceVersion', 'registrationId'] as const;
export type DeviceFields = Partial<Record<(typeof FIELD_NAMES)[number], string | null>>;

/** Mashov's website, as its own login would describe it when nothing was reported yet. */
const WEB_FIELDS: DeviceFields = { appName: 'info.mashov.students', apiVersion: '3.20210425', appVersion: '3.20210425', appBuild: '3.20210425' };

/** What `loginDevice` and `changeSchool` send about the device: the website's own, over what the login page reported. */
export function deviceLoginFields(kv: KeyValue): DeviceFields {
  return { ...WEB_FIELDS, ...(load<DeviceFields>(kv, DEVICE_KEYS.fields) ?? {}) };
}

export interface DeviceLoginState {
  /** The last login on the page: when, and whether its answer carried a pass. */
  lastLogin: { at: string; status: number; gotPass: boolean } | null;
  /** The last `loginDevice` try: when, and how it went. */
  lastTry: { at: string; ok: boolean; detail: string } | null;
}

const EMPTY: DeviceLoginState = { lastLogin: null, lastTry: null };

function load<T>(kv: KeyValue, key: string): T | null {
  try {
    const raw = kv.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function deviceLoginState(kv: KeyValue): DeviceLoginState {
  return { ...EMPTY, ...(load<DeviceLoginState>(kv, DEVICE_KEYS.state) ?? {}) };
}

export function hasDevicePass(kv: KeyValue): boolean {
  return Boolean(kv.getString(DEVICE_KEYS.pass));
}

/** "ניתוק": the pass goes with the login. */
export function forgetDevicePass(kv: KeyValue): void {
  kv.set(DEVICE_KEYS.pass, '');
}

function saveState(kv: KeyValue, patch: Partial<DeviceLoginState>): void {
  kv.set(DEVICE_KEYS.state, JSON.stringify({ ...deviceLoginState(kv), ...patch }));
}

/**
 * Runs in the login page before Mashov's own code.
 *
 * - `tick`: every login request (`/api/login`, `/api/idm/login/{school}/{year}`)
 *   goes out with the box ticked; its device fields (never the password) and
 *   its answer's `devicePass` header are posted to the app.
 * - `observe`, on a parent's phone (`parents.ts`): every login answer is
 *   posted too, its kind, status, `Reason` header and whether it carried a
 *   pass, and its `accessToken` as `ACCESS_TOKEN_VIEW_JS` cuts it down: the
 *   children's guids, first names and classes, and otherwise field names and
 *   counts. So is the token the page keeps in its own storage, as it changes.
 *   The answers to an MFA code and to a change of school bring the trial a
 *   pass too, when they carry one.
 *
 * Angular asks for JSON as text, so the body is `responseText`; a page that
 * set `responseType` to JSON has it in `response`, and a `fetch` answer is
 * read from a clone, leaving the page its own.
 */
export function loginPagePatch(opts: { tick: boolean; observe: boolean }): string {
  return `(function () {
  if (window.__sederyomDeviceLogin) return;
  window.__sederyomDeviceLogin = true;
  var TICK = ${opts.tick}, OBSERVE = ${opts.observe};
  var LOGIN = /\\/api\\/(idm\\/login\\/[^?]+|login)(\\?|$)/;
  var ANSWER = /\\/api\\/(login\\/mfa\\/(?:verify|send)|login|loginDevice|changeSchool(?:\\/[^?]*)?|idm\\/login\\/[^?]+|user\\/otp\\/request)(\\?|$)/;
  function post(o) { try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }
  function tick(body) {
    var b = JSON.parse(body);
    b.isPrivateDevice = true;
    var fields = {};
    ${JSON.stringify(FIELD_NAMES)}.forEach(function (k) { if (k in b) fields[k] = b[k]; });
    post({ type: 'sederyom-device-fields', fields: fields });
    return JSON.stringify(b);
  }
  ${ACCESS_TOKEN_VIEW_JS}
  function kindOf(url) { var m = ANSWER.exec(url); return m ? m[1].replace(/\\/\\d[^/]*/g, '') : null; }
  function answered(kind, status, header, body) {
    var pass = header('devicePass');
    post({ type: 'sederyom-parent-answer', kind: kind, status: status, reason: header('Reason'), gotPass: !!pass });
    var view = null;
    try { view = sederyomView(body); } catch (e) {}
    if (view) post({ type: 'sederyom-mashov-children', from: kind, view: view });
    if (TICK && pass && (kind === 'login/mfa/verify' || kind === 'changeSchool')) post({ type: 'sederyom-device-pass', status: status, pass: pass });
  }
  function xhrBody(xhr) {
    try {
      if (xhr.responseType === 'json') return xhr.response;
      if (!xhr.responseType || xhr.responseType === 'text') return xhr.responseText ? JSON.parse(xhr.responseText) : null;
    } catch (e) {}
    return null;
  }
  var open = XMLHttpRequest.prototype.open;
  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__sederyom = { method: String(method).toUpperCase(), url: String(url) };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this, info = xhr.__sederyom || {};
    if (TICK && info.method === 'POST' && LOGIN.test(info.url) && typeof body === 'string') {
      try { body = tick(body); } catch (e) {}
      xhr.addEventListener('load', function () {
        post({ type: 'sederyom-device-pass', status: xhr.status, pass: xhr.getResponseHeader('devicePass') });
      });
    }
    var kind = OBSERVE && info.method === 'POST' ? kindOf(info.url) : null;
    if (kind) {
      xhr.addEventListener('load', function () {
        try { answered(kind, xhr.status, function (n) { return xhr.getResponseHeader(n); }, xhrBody(xhr)); } catch (e) {}
      });
    }
    return send.call(this, body);
  };
  if (window.fetch) {
    var original = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || 'GET').toUpperCase();
      var ticked = TICK && method === 'POST' && LOGIN.test(url) && init && typeof init.body === 'string';
      var kind = OBSERVE && method === 'POST' ? kindOf(url) : null;
      if (!ticked && !kind) return original.apply(this, arguments);
      if (ticked) {
        try { init = Object.assign({}, init, { body: tick(init.body) }); } catch (e) {}
      }
      return original.call(this, input, init).then(function (res) {
        if (ticked) post({ type: 'sederyom-device-pass', status: res.status, pass: res.headers.get('devicePass') });
        if (kind) {
          var header = function (n) { return res.headers.get(n); };
          try {
            res.clone().json().then(function (b) { answered(kind, res.status, header, b); }, function () { answered(kind, res.status, header, null); });
          } catch (e) {}
        }
        return res;
      });
    };
  }
  if (OBSERVE && window.setInterval) {
    var lastToken = null;
    window.setInterval(function () {
      try {
        var store = window.sessionStorage;
        var token = store && store.getItem('students-accessToken');
        if (!token || token === lastToken) return;
        lastToken = token;
        var credential = store.getItem('students-credential');
        var view = sederyomView({ accessToken: JSON.parse(token), credential: credential ? JSON.parse(credential) : null });
        if (view) post({ type: 'sederyom-mashov-children', from: 'page', view: view });
      } catch (e) {}
    }, 2000);
  }
})(); true;`;
}

/** A student's login page with the box ticked: what the trial injected before parents mode. */
export const DEVICE_LOGIN_PATCH = loginPagePatch({ tick: true, observe: false });

/**
 * A message from the login page. `true` when it was one of this trial's,
 * kept on the phone; `false` for anything else (the page's touch reports).
 */
export function takeDeviceMessage(kv: KeyValue, data: string, now: Date = new Date()): boolean {
  if (!data.startsWith('{')) return false;
  let msg: { type?: string; fields?: Record<string, unknown>; status?: number; pass?: string | null };
  try {
    msg = JSON.parse(data) as typeof msg;
  } catch {
    return false;
  }
  if (msg.type === 'sederyom-device-fields' && msg.fields) {
    const fields: DeviceFields = {};
    for (const k of FIELD_NAMES) {
      const v = msg.fields[k];
      if (typeof v === 'string' || v === null) fields[k] = v;
    }
    kv.set(DEVICE_KEYS.fields, JSON.stringify(fields));
    return true;
  }
  if (msg.type === 'sederyom-device-pass') {
    const pass = typeof msg.pass === 'string' && msg.pass.length > 0 ? msg.pass : null;
    if (pass) kv.set(DEVICE_KEYS.pass, pass);
    const status = msg.status ?? 0;
    // A ticked login Mashov refused may be refused for the tick: the next one goes out as the site
    // sends it (`paused`). One it took starts the count of refusals over.
    if (status >= 400) {
      kv.set(DEVICE_KEYS.paused, '1');
      kv.set(DEVICE_KEYS.strikes, String(strikesOf(kv) + 1));
    } else if (status >= 200) {
      kv.set(DEVICE_KEYS.strikes, '');
    }
    saveState(kv, { lastLogin: { at: now.toISOString(), status, gotPass: pass !== null } });
    return true;
  }
  return false;
}

/** The answer to a `loginDevice`, for a parent's phone: its body carries the children (`parents.ts`). */
export interface DeviceLoginAnswer {
  status: number;
  reason: string | null;
  gotPass: boolean;
  body: unknown;
}

/**
 * A new session from the kept pass (`POST /api/loginDevice`), into the
 * phone's cookie jar the way the login page's would be. `false` when there is
 * no pass or Mashov refused it; the reason is kept, and shown under משוב's
 * "פרטים טכניים" in מצב חיבורים. `onAnswer` gets the answer, its body read.
 */
export async function loginWithDevicePass(
  kv: KeyValue,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
  onAnswer?: (answer: DeviceLoginAnswer) => void,
): Promise<boolean> {
  const pass = kv.getString(DEVICE_KEYS.pass);
  if (!pass) return false;
  const fields = deviceLoginFields(kv);
  let ok = false;
  let detail: string;
  try {
    const res = await fetchImpl(`${MASHOV_ORIGIN}/api/loginDevice`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json', devicePass: pass },
      body: JSON.stringify(fields),
    });
    ok = res.ok;
    detail = `HTTP ${res.status}`;
    // Mashov may hand a fresh pass back; the next login needs that one.
    const next = res.headers.get('devicePass');
    if (ok && next) kv.set(DEVICE_KEYS.pass, next);
    const text = !ok || onAnswer ? await res.text().catch(() => '') : '';
    if (!ok) detail += ` ${text.slice(0, 120)}`;
    if (onAnswer) {
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON: the answer is still told, without a body.
      }
      try {
        onAnswer({ status: res.status, reason: res.headers.get('Reason'), gotPass: Boolean(next), body });
      } catch {
        // What the caller keeps of it never fails the login.
      }
    }
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }
  saveState(kv, { lastTry: { at: now.toISOString(), ok, detail } });
  return ok;
}
