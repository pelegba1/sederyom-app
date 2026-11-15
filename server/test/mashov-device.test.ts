/**
 * Mashov's "personal device" login (app/src/mashov/device.ts, plan Phase 2
 * step 4): the login page ticks the box and reports the pass, never the
 * password, and the phone logs in again with the pass once Mashov's 8 hours
 * are up.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  DEVICE_KEYS, DEVICE_LOGIN_PATCH, DEVICE_LOGIN_STRIKES, deviceLoginMode, deviceLoginOn, deviceLoginState, hasDevicePass,
  loginWithDevicePass, noteMashovLoginWorked, setDeviceLoginOn, takeDeviceMessage,
} = await import('../../app/src/mashov/device');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

/** Runs the patch against a stand-in page: an XHR that answers with a pass, and a bridge that collects messages. */
function runPatch(answerPass: string | null) {
  const posted: Record<string, unknown>[] = [];
  const sent: { url: string; body: unknown }[] = [];
  class FakeXhr {
    status = 200;
    private listeners: (() => void)[] = [];
    private url = '';
    open(_method: string, url: string) { this.url = url; }
    send(body: unknown) { sent.push({ url: this.url, body }); this.listeners.forEach((l) => l()); }
    addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
    getResponseHeader(name: string) { return name === 'devicePass' ? answerPass : null; }
  }
  const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) } };
  new Function('window', 'XMLHttpRequest', DEVICE_LOGIN_PATCH)(window, FakeXhr);
  return { FakeXhr, posted, sent };
}

describe('the login page patch', () => {
  it('ticks "personal device" on the Ministry login and reports the pass, not the password', () => {
    const { FakeXhr, posted, sent } = runPatch('{"id":"p-1"}');
    const xhr = new FakeXhr();
    xhr.open('POST', 'https://web.mashov.info/api/idm/login/123456/2027');
    xhr.send(JSON.stringify({ semel: 123456, year: 2027, appName: 'info.mashov.students', deviceUuid: 'chrome', password: 'secret' }));
    expect(JSON.parse(sent[0]!.body as string)).toMatchObject({ isPrivateDevice: true, semel: 123456 });
    expect(JSON.stringify(posted)).not.toContain('secret');
    expect(posted).toEqual([
      { type: 'sederyom-device-fields', fields: { appName: 'info.mashov.students', deviceUuid: 'chrome' } },
      { type: 'sederyom-device-pass', status: 200, pass: '{"id":"p-1"}' },
    ]);
  });

  it('leaves every other request alone, loginDevice included', () => {
    const { FakeXhr, posted, sent } = runPatch(null);
    for (const url of ['https://web.mashov.info/api/loginDevice', 'https://web.mashov.info/api/students/x/grades']) {
      const xhr = new FakeXhr();
      xhr.open('POST', url);
      xhr.send('{"a":1}');
    }
    expect(sent.map((s) => s.body)).toEqual(['{"a":1}', '{"a":1}']);
    expect(posted).toEqual([]);
  });
});

describe('keeping and using the pass', () => {
  it('keeps the pass and the device fields the login reported', () => {
    const kv = memoryKv();
    expect(takeDeviceMessage(kv, JSON.stringify({ type: 'sederyom-device-fields', fields: { appName: 'info.mashov.students', password: 'x' } }))).toBe(true);
    expect(takeDeviceMessage(kv, JSON.stringify({ type: 'sederyom-device-pass', status: 200, pass: '{"id":"p-1"}' }))).toBe(true);
    expect(JSON.parse(kv.getString(DEVICE_KEYS.fields)!)).toEqual({ appName: 'info.mashov.students' });
    expect(hasDevicePass(kv)).toBe(true);
    expect(deviceLoginState(kv).lastLogin).toMatchObject({ status: 200, gotPass: true });
    // The page's own touch reports are not this trial's.
    expect(takeDeviceMessage(kv, JSON.stringify({ type: 'sederyom-touch', href: 'x' }))).toBe(false);
  });

  const refused = (kv: ReturnType<typeof memoryKv>) =>
    takeDeviceMessage(kv, JSON.stringify({ type: 'sederyom-device-pass', status: 400, pass: null }));

  it('sends the login after a refused ticked one unticked, and ticks again once a login worked', () => {
    const kv = memoryKv();
    expect(deviceLoginMode(kv)).toBe('on');
    refused(kv);
    expect(deviceLoginMode(kv)).toBe('paused');
    expect(deviceLoginOn(kv)).toBe(false);
    noteMashovLoginWorked(kv);
    expect(deviceLoginOn(kv)).toBe(true);
  });

  it('stops ticking after three refusals in a row, until the switch turns it on', () => {
    const kv = memoryKv();
    for (let i = 0; i < DEVICE_LOGIN_STRIKES; i += 1) {
      refused(kv);
      noteMashovLoginWorked(kv);
    }
    expect(deviceLoginMode(kv)).toBe('stopped');
    noteMashovLoginWorked(kv);
    expect(deviceLoginOn(kv)).toBe(false);
    setDeviceLoginOn(kv, true);
    expect(deviceLoginMode(kv)).toBe('on');
    // The switch starts the count afresh: one more refusal is a pause again.
    refused(kv);
    expect(deviceLoginMode(kv)).toBe('paused');
  });

  it('starts the count over after a ticked login Mashov took', () => {
    const kv = memoryKv();
    refused(kv);
    refused(kv);
    noteMashovLoginWorked(kv);
    takeDeviceMessage(kv, JSON.stringify({ type: 'sederyom-device-pass', status: 200, pass: '{"id":"p-1"}' }));
    refused(kv);
    refused(kv);
    expect(deviceLoginMode(kv)).toBe('paused');
  });

  it('leaves the switch off whatever the logins do', () => {
    const kv = memoryKv();
    setDeviceLoginOn(kv, false);
    noteMashovLoginWorked(kv);
    expect(deviceLoginMode(kv)).toBe('off');
    // Turned off after a refused login of the old kind: still the student's own "off".
    const after = memoryKv();
    after.set(DEVICE_KEYS.state, JSON.stringify({ lastLogin: { at: '2026-10-20T07:00:00.000Z', status: 401, gotPass: false }, lastTry: null }));
    setDeviceLoginOn(after, false);
    noteMashovLoginWorked(after);
    expect(deviceLoginMode(after)).toBe('off');
  });

  it('reads an old "off" set by a refused login as a pause, and any other as the switch', () => {
    const auto = memoryKv();
    auto.set(DEVICE_KEYS.off, '1');
    auto.set(DEVICE_KEYS.state, JSON.stringify({ lastLogin: { at: '2026-10-20T07:00:00.000Z', status: 401, gotPass: false }, lastTry: null }));
    expect(deviceLoginMode(auto)).toBe('paused');
    noteMashovLoginWorked(auto);
    expect(deviceLoginOn(auto)).toBe(true);

    const own = memoryKv();
    own.set(DEVICE_KEYS.off, '1');
    own.set(DEVICE_KEYS.state, JSON.stringify({ lastLogin: { at: '2026-10-20T07:00:00.000Z', status: 200, gotPass: true }, lastTry: null }));
    noteMashovLoginWorked(own);
    expect(deviceLoginMode(own)).toBe('off');
  });

  it('records a login whose answer carried no pass', () => {
    const kv = memoryKv();
    takeDeviceMessage(kv, JSON.stringify({ type: 'sederyom-device-pass', status: 200, pass: null }));
    expect(hasDevicePass(kv)).toBe(false);
    expect(deviceLoginState(kv).lastLogin).toMatchObject({ gotPass: false });
  });

  it('logs in with the pass and the reported fields, and keeps a fresh pass Mashov hands back', async () => {
    const kv = memoryKv();
    kv.set(DEVICE_KEYS.pass, '{"id":"p-1"}');
    kv.set(DEVICE_KEYS.fields, JSON.stringify({ appName: 'info.mashov.students', deviceUuid: 'chrome' }));
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { devicePass: '{"id":"p-2"}' } });
    }) as unknown as typeof fetch;
    expect(await loginWithDevicePass(kv, fetchImpl)).toBe(true);
    expect(calls[0]!.url).toBe('https://web.mashov.info/api/loginDevice');
    expect((calls[0]!.init.headers as Record<string, string>).devicePass).toBe('{"id":"p-1"}');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ appName: 'info.mashov.students', deviceUuid: 'chrome', apiVersion: '3.20210425' });
    expect(kv.getString(DEVICE_KEYS.pass)).toBe('{"id":"p-2"}');
    expect(deviceLoginState(kv).lastTry).toMatchObject({ ok: true, detail: 'HTTP 200' });
  });

  it('says why when Mashov refuses the pass', async () => {
    const kv = memoryKv();
    kv.set(DEVICE_KEYS.pass, '{"id":"p-1"}');
    const fetchImpl = (async () => new Response('device not allowed', { status: 401 })) as unknown as typeof fetch;
    expect(await loginWithDevicePass(kv, fetchImpl)).toBe(false);
    expect(deviceLoginState(kv).lastTry).toMatchObject({ ok: false, detail: 'HTTP 401 device not allowed' });
  });

  it('does nothing without a pass', async () => {
    const kv = memoryKv();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await loginWithDevicePass(kv, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
