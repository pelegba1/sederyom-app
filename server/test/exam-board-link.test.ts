/**
 * The exam board's link reader (plan: exam-board-sources, task 4). It makes the server fetch an address a
 * stranger typed, so most of this file is about where it refuses to go. `fetch` and `lookup` are fakes: no
 * test touches a network, and a "no fetch" test asserts the fake was never called.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardError } from '../src/exam-board/errors';
import { firstUrl, isPublicAddress, resolveLink, safeGet, safeGetWith, type LinkDeps } from '../src/exam-board/link';

const fixtureBytes = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'exam-board', name)));
const fixtureText = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'exam-board', name), 'utf8');

const MB = 1024 * 1024;
const PUBLIC_IP = '93.184.216.34';

const HADARIM_URL =
  'https://hadarimschool.co.il/%D7%A9%D7%9B%D7%91%D7%AA-%D7%99%D7%91-%D7%AA%D7%A9%D7%A2%D7%95/%D7%9C%D7%95%D7%97-%D7%94%D7%9E%D7%91%D7%97%D7%A0%D7%99%D7%9D-%D7%99%D7%91/';
const HADARIM_ID = '8auulv95lhqscbron8a6gucrtc@group.calendar.google.com';

// ---- fakes -----------------------------------------------------------------------------------------

type Reply = Response | ((url: string, init: RequestInit | undefined) => Response | Promise<Response>);

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=UTF-8' } });
const file = (body: Uint8Array | string, type = 'application/octet-stream') =>
  new Response(body, { status: 200, headers: { 'content-type': type } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

/** A route may be asked twice and a body can be read once: each ask gets a new Response with the same status, headers and bytes. */
async function fresh(reply: Response): Promise<Response> {
  const bytes = new Uint8Array(await reply.clone().arrayBuffer());
  return new Response(bytes.length === 0 ? null : bytes, { status: reply.status, headers: reply.headers });
}

/**
 * A fake network: `routes` maps the exact URL `fetch` is called with to a reply, and any other URL fails the
 * way a dead host does. `calls` is every URL asked for, `looked` every host resolved.
 */
function setup(routes: Record<string, Reply>, lookup: (host: string) => string[] | Promise<string[]> = () => [PUBLIC_IP]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const looked: string[] = [];
  const deps: LinkDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const reply = routes[url];
      if (!reply) throw new TypeError(`fetch failed: no route for ${url}`);
      return typeof reply === 'function' ? reply(url, init) : fresh(reply);
    }) as typeof fetch,
    lookup: async (host) => {
      looked.push(host);
      return lookup(host);
    },
  };
  return { deps, calls, urls: () => calls.map((c) => c.url), looked };
}

/** The code a refusal carries; anything that is not a BoardError shows up as `other: ...`, which fails the test. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof BoardError ? e.code : `other: ${String(e)}`;
  }
  return 'resolved';
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `cal${i}@group.calendar.google.com`);
const iframeOf = (id: string) => `<iframe src="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}"></iframe>`;

afterEach(() => vi.restoreAllMocks());

// ---- firstUrl ---------------------------------------------------------------------------------------

describe('firstUrl', () => {
  it('finds a bare address in a sentence, adds https, keeps Hebrew in the path and stops at the space', () => {
    expect(firstUrl('תראו את הלוח hadarimschool.co.il/לוח שלום')).toBe('https://hadarimschool.co.il/לוח');
    expect(firstUrl('אין כאן כלום')).toBeNull();
    expect(firstUrl('')).toBeNull();
  });

  it('keeps the scheme it was given, even http, so that safeGet is the one that refuses it', () => {
    expect(firstUrl('https://a.example.org/x')).toBe('https://a.example.org/x');
    expect(firstUrl('http://a.example.org/x')).toBe('http://a.example.org/x');
    expect(firstUrl('ftp://files.example.org/a.xlsx')).toBe('ftp://files.example.org/a.xlsx');
    expect(firstUrl('www.example.org')).toBe('https://www.example.org');
  });

  it('keeps a percent-encoded path as it is, and a decoded one as it is', () => {
    expect(firstUrl(`הנה ${HADARIM_URL}`)).toBe(HADARIM_URL);
    const decoded = decodeURIComponent(HADARIM_URL);
    expect(firstUrl(`הנה ${decoded} תודה`)).toBe(decoded);
  });

  it('drops the punctuation that follows a link in a sentence', () => {
    expect(firstUrl('הנה: https://a.example.org/p?q=1&r=2.')).toBe('https://a.example.org/p?q=1&r=2');
    expect(firstUrl('(ראו https://a.example.org/p)')).toBe('https://a.example.org/p');
    expect(firstUrl('https://a.example.org/p, ואז עוד')).toBe('https://a.example.org/p');
    expect(firstUrl('"https://a.example.org/p"!')).toBe('https://a.example.org/p');
    expect(firstUrl('https://a.example.org/שכבת-יב/לוח,')).toBe('https://a.example.org/שכבת-יב/לוח');
    expect(firstUrl('hadarimschool.co.il.')).toBe('https://hadarimschool.co.il');
  });

  it('keeps a closing parenthesis that closes one inside the address', () => {
    expect(firstUrl('https://en.example.org/wiki/A_(b)')).toBe('https://en.example.org/wiki/A_(b)');
    expect(firstUrl('(https://en.example.org/wiki/A_(b))')).toBe('https://en.example.org/wiki/A_(b)');
  });

  it('takes the first of several', () => {
    expect(firstUrl('https://a.example.org/p, https://b.example.org/q')).toBe('https://a.example.org/p');
    expect(firstUrl('b.example.org ואחר כך https://a.example.org/p')).toBe('https://b.example.org');
  });

  it('is not fooled by a date, a version or an e-mail address', () => {
    expect(firstUrl('מתאריך 22.11.26 עד 3.12.26')).toBeNull();
    expect(firstUrl('גרסה 2.0.1')).toBeNull();
    expect(firstUrl('כתבו ל־dana@school.co.il')).toBeNull();
    expect(firstUrl('e.g. כך')).toBeNull();
  });

  it('reads past the bidi marks and zero-width characters a link copied from a Hebrew chat may carry (ledger L80)', () => {
    expect(firstUrl('‏https://a.example.org/x‎')).toBe('https://a.example.org/x');
    expect(firstUrl('הנה‏ ‫hadarimschool.co.il/לוח‬')).toBe('https://hadarimschool.co.il/לוח');
    expect(firstUrl('https://a.example.org/​x﻿')).toBe('https://a.example.org/x');
  });

  it('is linear on a long run of address characters', () => {
    const started = Date.now();
    expect(firstUrl('a'.repeat(200_000))).toBeNull();
    expect(firstUrl('a.'.repeat(100_000))).toBeNull();
    expect(firstUrl('a+'.repeat(100_000))).toBeNull();
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

// ---- isPublicAddress --------------------------------------------------------------------------------

describe('isPublicAddress', () => {
  const refused = [
    // IPv4: private, loopback, link-local, shared, reserved, multicast, broadcast
    '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '127.255.255.254',
    '169.254.169.254', '0.0.0.0', '0.1.2.3', '100.64.0.1', '100.127.255.255', '224.0.0.1', '239.255.255.255',
    '240.0.0.1', '255.255.255.255', '192.0.0.8', '198.18.0.1', '198.19.255.255', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    // IPv6: unspecified, loopback, unique local, link-local, site-local, multicast, discard, documentation, Teredo
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1', '100::1', '2001:db8::1', '2001::1',
    // IPv6 spellings of an IPv4 address (mapped, compatible, NAT64, local-use NAT64, 6to4; in dotted and in hex
    // form) are refused whatever the address inside them is, a public one included: no school site is reached so.
    '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:7f00:1', '::ffff:192.168.0.1', '::ffff:169.254.169.254', '::10.0.0.1',
    '64:ff9b::a00:1', '64:ff9b::10.0.0.1', '2002:a00:1::',
    '::ffff:8.8.8.8', '::ffff:808:808', '::ffff:93.184.216.34', '::8.8.8.8', '::808:808', '64:ff9b::808:808', '64:ff9b::8.8.8.8',
    '64:ff9b:1::808:808', '64:ff9b:1::1', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', '2002:808:808::', '2002:5db8:d822::1',
    // not an IP literal, or not only one
    '', 'not-an-ip', '1.2.3', '1.2.3.4.5', '256.1.1.1', '010.0.0.1', '8.8.8.8/8', ' 8.8.8.8', '8.8.8.8 ', '[::1]', '0x7f.1',
    '2130706433', '::ffff:999.1.1.1', 'fe80::1%eth0', '2606:4700:4700::1111%eth0', '2606:4700:4700::1111%25eth0',
  ];
  const allowed = [
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1',
    '192.169.0.1', '11.0.0.1', '223.255.255.255', '198.17.255.255', '198.20.0.1',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::', '2003::1', '2001:200::1', '3ffe::1',
  ];

  it.each(refused)('refuses %j', (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(allowed)('accepts %j', (ip) => expect(isPublicAddress(ip)).toBe(true));
});

// ---- safeGet ----------------------------------------------------------------------------------------

describe('safeGet', () => {
  it('returns the final address, the media type without its parameters, and the bytes', async () => {
    const { deps, calls } = setup({ 'https://a.example.org/x': html('<p>שלום</p>') });
    const got = await safeGet('https://a.example.org/x', deps);
    expect(got.url).toBe('https://a.example.org/x');
    expect(got.contentType).toBe('text/html');
    expect(new TextDecoder().decode(got.bytes)).toBe('<p>שלום</p>');
    expect(calls).toHaveLength(1);
  });

  it('asks without cookies or identifying headers, without following redirects itself, with a deadline', async () => {
    const { deps, calls } = setup({ 'https://a.example.org/x': html('ok') });
    await safeGet('https://a.example.org/x', deps);
    const init = calls[0]!.init!;
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body ?? null).toBeNull();
    const headers = new Headers(init.headers);
    for (const name of ['cookie', 'authorization', 'referer', 'origin', 'x-forwarded-for', 'from']) expect(headers.has(name)).toBe(false);
    expect(headers.has('user-agent')).toBe(false);
  });

  it('puts one deadline on the whole get, not one on each hop', async () => {
    const signals: AbortSignal[] = [];
    const { deps } = setup({
      'https://a.example.org/1': (_u, init) => (signals.push(init!.signal!), redirect('https://a.example.org/2')),
      'https://a.example.org/2': (_u, init) => (signals.push(init!.signal!), html('ok')),
    });
    await safeGet('https://a.example.org/1', deps);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
  });

  it('turns a failed network, a timeout and a non-2xx into unreachable', async () => {
    const dead = setup({});
    expect(await codeOf(safeGet('https://a.example.org/x', dead.deps))).toBe('unreachable');
    expect(dead.calls).toHaveLength(1);

    const slow = setup({
      'https://a.example.org/x': () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    });
    expect(await codeOf(safeGet('https://a.example.org/x', slow.deps))).toBe('unreachable');

    for (const status of [300, 304, 400, 401, 403, 404, 500, 503]) {
      const { deps } = setup({ 'https://a.example.org/x': new Response(status === 304 ? null : 'nope', { status }) });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
    }
  });

  it('turns a body that breaks half way into unreachable', async () => {
    const { deps } = setup({
      'https://a.example.org/x': () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              c.error(new Error('connection reset'));
            },
          }),
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    });
    expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
  });

  describe('where it will not go', () => {
    it.each([
      ['http', 'http://a.example.org/x'],
      ['ftp', 'ftp://a.example.org/x'],
      ['file', 'file:///etc/passwd'],
      ['javascript', 'javascript:alert(1)'],
      ['a user name', 'https://user@a.example.org/x'],
      ['a password', 'https://user:secret@a.example.org/x'],
      ['a port', 'https://a.example.org:8443/x'],
      ['port 80', 'https://a.example.org:80/x'],
      ['something that is not an address', 'not a url'],
      ['an empty string', ''],
    ])('refuses %s without a lookup or a fetch', async (_name, url) => {
      const { deps, calls, looked } = setup({});
      expect(await codeOf(safeGet(url, deps))).toBe('unreachable');
      expect(calls).toHaveLength(0);
      expect(looked).toHaveLength(0);
    });

    it('takes port 443 written out, which is no port at all', async () => {
      const { deps, urls } = setup({ 'https://a.example.org/x': html('ok') });
      await safeGet('https://a.example.org:443/x', deps);
      expect(urls()).toEqual(['https://a.example.org/x']);
    });

    it.each([
      ['10.0.0.5', '10.0.0.5'],
      ['loopback', '127.0.0.1'],
      ['the cloud metadata address', '169.254.169.254'],
      ['an IPv6 loopback', '::1'],
      ['an IPv4-mapped IPv6', '::ffff:10.0.0.1'],
      ['an IPv4-mapped IPv6 of a public address', '::ffff:8.8.8.8'],
      ['a NAT64 IPv6 of a public address', '64:ff9b::808:808'],
      ['a 6to4 IPv6 of a public address', '2002:808:808::'],
      ['a unique local IPv6', 'fd00::1'],
    ])('refuses a name that resolves to %s, without a fetch', async (_name, ip) => {
      const { deps, calls, looked } = setup({ 'https://a.example.org/x': html('secret') }, () => [ip]);
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
      expect(looked).toEqual(['a.example.org']);
      expect(calls).toHaveLength(0);
    });

    it('refuses a name when any one of its addresses is private', async () => {
      const { deps, calls } = setup({ 'https://a.example.org/x': html('secret') }, () => [PUBLIC_IP, '10.0.0.5']);
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
      expect(calls).toHaveLength(0);
    });

    it('refuses a name that resolves to nothing, to garbage, or that the resolver fails on', async () => {
      for (const lookup of [() => [], () => ['not-an-ip'], () => [''], () => Promise.reject(new Error('ENOTFOUND'))]) {
        const { deps, calls } = setup({ 'https://a.example.org/x': html('secret') }, lookup);
        expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
        expect(calls).toHaveLength(0);
      }
    });

    it.each([
      'https://127.0.0.1/x',
      'https://10.1.2.3/x',
      'https://[::1]/x',
      'https://[::ffff:10.0.0.1]/x',
      'https://[fe80::1]/x',
      'https://2130706433/x', // 127.0.0.1 written as one number
      'https://0x7f.1/x', // 127.0.0.1 written in hex
      'https://127.1/x',
      'https://0/x',
    ])('checks an address written as the host itself: %s', async (url) => {
      // The fake resolver says every name is public, so only the direct check can stop these.
      const { deps, calls } = setup({}, () => [PUBLIC_IP]);
      expect(await codeOf(safeGet(url, deps))).toBe('unreachable');
      expect(calls).toHaveLength(0);
    });

    it('takes a public address written as the host, and resolves it too', async () => {
      const { deps, looked, urls } = setup({ 'https://93.184.216.34/x': html('ok'), 'https://[2606:4700:4700::1111]/x': html('ok') });
      await safeGet('https://93.184.216.34/x', deps);
      await safeGet('https://[2606:4700:4700::1111]/x', deps);
      expect(urls()).toHaveLength(2);
      expect(looked).toEqual(['93.184.216.34', '2606:4700:4700::1111']);
    });
  });

  describe('redirects', () => {
    it('follows three by hand, resolving a relative Location against the address it came from, and checks every hop', async () => {
      const { deps, urls, looked } = setup({
        'https://a.example.org/1': redirect('/2'),
        'https://a.example.org/2': redirect('3', 301),
        'https://a.example.org/3': redirect('https://b.example.org/4', 307),
        'https://b.example.org/4': html('arrived'),
      });
      const got = await safeGet('https://a.example.org/1', deps);
      expect(urls()).toEqual(['https://a.example.org/1', 'https://a.example.org/2', 'https://a.example.org/3', 'https://b.example.org/4']);
      expect(got.url).toBe('https://b.example.org/4');
      expect(new TextDecoder().decode(got.bytes)).toBe('arrived');
      expect(looked).toEqual(['a.example.org', 'a.example.org', 'a.example.org', 'b.example.org']);
    });

    it('does not follow a fourth', async () => {
      const { deps, urls } = setup({
        'https://a.example.org/1': redirect('/2'),
        'https://a.example.org/2': redirect('/3'),
        'https://a.example.org/3': redirect('/4'),
        'https://a.example.org/4': redirect('/5'),
        'https://a.example.org/5': html('too far'),
      });
      expect(await codeOf(safeGet('https://a.example.org/1', deps))).toBe('unreachable');
      expect(urls()).toEqual(['https://a.example.org/1', 'https://a.example.org/2', 'https://a.example.org/3', 'https://a.example.org/4']);
    });

    it('does not loop for ever', async () => {
      const { deps, calls } = setup({ 'https://a.example.org/x': redirect('/x') });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
      expect(calls.length).toBeLessThanOrEqual(4);
    });

    it('refuses a redirect to a name that resolves to a private address, and never asks it', async () => {
      const { deps, urls } = setup(
        { 'https://a.example.org/x': redirect('https://internal.example.org/admin'), 'https://internal.example.org/admin': html('secret') },
        (host) => (host === 'internal.example.org' ? ['192.168.0.10'] : [PUBLIC_IP]),
      );
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
      expect(urls()).toEqual(['https://a.example.org/x']);
    });

    it.each([
      'http://a.example.org/y',
      'https://127.0.0.1/y',
      'https://10.0.0.5/y',
      'https://[::1]/y',
      'https://user:pw@a.example.org/y',
      'https://a.example.org:8443/y',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ])('refuses a redirect to %s', async (to) => {
      const { deps, urls } = setup({ 'https://a.example.org/x': redirect(to) });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('unreachable');
      expect(urls()).toEqual(['https://a.example.org/x']);
    });

    it('refuses a redirect with no Location or one that is not an address', async () => {
      const bare = setup({ 'https://a.example.org/x': new Response(null, { status: 302 }) });
      expect(await codeOf(safeGet('https://a.example.org/x', bare.deps))).toBe('unreachable');
      const broken = setup({ 'https://a.example.org/x': redirect('https://') });
      expect(await codeOf(safeGet('https://a.example.org/x', broken.deps))).toBe('unreachable');
    });

    it('does not read the body of a redirect', async () => {
      let cancelled = false;
      const { deps } = setup({
        'https://a.example.org/x': () =>
          new Response(new ReadableStream<Uint8Array>({ cancel: () => void (cancelled = true) }), { status: 302, headers: { location: '/y' } }),
        'https://a.example.org/y': html('ok'),
      });
      await safeGet('https://a.example.org/x', deps);
      expect(cancelled).toBe(true);
    });

    it('lets the caller stop a redirect before it is followed', async () => {
      // Used by resolveLink for a Google sign-in page; see the sheet tests below.
      const { deps, urls } = setup({ 'https://a.example.org/x': redirect('https://login.example.org/in') });
      const stop = vi.fn((next: URL) => (next.hostname === 'login.example.org' ? new BoardError('private_sheet') : null));
      expect(await codeOf(safeGetWith('https://a.example.org/x', deps, stop))).toBe('private_sheet');
      expect(urls()).toEqual(['https://a.example.org/x']);
    });
  });

  describe('size', () => {
    const body = (n: number) => new Uint8Array(n).fill(7);

    it('takes 2MB exactly', async () => {
      const { deps } = setup({ 'https://a.example.org/x': file(body(2 * MB)) });
      expect((await safeGet('https://a.example.org/x', deps)).bytes).toHaveLength(2 * MB);
    });

    it('refuses 2MB and a byte', async () => {
      const { deps } = setup({ 'https://a.example.org/x': file(body(2 * MB + 1)) });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('too_big');
    });

    it('stops reading and cancels a stream that never ends, instead of reading it all and then counting', async () => {
      const chunk = 64 * 1024;
      const seen = { pulled: 0, cancelled: false };
      const { deps } = setup({
        'https://a.example.org/x': () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(c) {
                seen.pulled += chunk;
                c.enqueue(new Uint8Array(chunk));
              },
              cancel() {
                seen.cancelled = true;
              },
            }),
            { status: 200, headers: { 'content-type': 'application/octet-stream' } },
          ),
      });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('too_big');
      expect(seen.cancelled).toBe(true);
      expect(seen.pulled).toBeGreaterThan(2 * MB);
      expect(seen.pulled).toBeLessThanOrEqual(2 * MB + 4 * chunk);
    });

    it('refuses on the declared length alone, without reading', async () => {
      const seen = { pulled: 0, cancelled: false };
      const { deps } = setup({
        'https://a.example.org/x': () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(c) {
                seen.pulled++;
                c.enqueue(new Uint8Array(10));
              },
              cancel() {
                seen.cancelled = true;
              },
            }),
            { status: 200, headers: { 'content-length': String(2 * MB + 1) } },
          ),
      });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('too_big');
      expect(seen.cancelled).toBe(true);
    });

    it('does not trust a declared length that is smaller than the body', async () => {
      const { deps } = setup({ 'https://a.example.org/x': () => new Response(body(2 * MB + 1), { status: 200, headers: { 'content-length': '10' } }) });
      expect(await codeOf(safeGet('https://a.example.org/x', deps))).toBe('too_big');
    });
  });
});

// ---- resolveLink ------------------------------------------------------------------------------------

describe('resolveLink', () => {
  describe('1. the link is a Google calendar', () => {
    it('reads an embed link without any request', async () => {
      const { deps, calls, looked } = setup({});
      const link = 'https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com&ctz=Asia%2FJerusalem';
      expect(await resolveLink(link, deps)).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      expect(calls).toHaveLength(0);
      expect(looked).toHaveLength(0);
    });

    it('reads a bare calendar id, with spaces around it, without any request', async () => {
      const { deps, calls } = setup({});
      expect(await resolveLink('  abc@group.calendar.google.com\n', deps)).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      expect(calls).toHaveLength(0);
    });

    it('reads a calendar link with bidi marks and zero-width characters around it and in it (ledger L80)', async () => {
      const { deps, calls } = setup({});
      const link = '‏‫https://calendar.google.com/calendar/embed?src=abc%40group.​calendar.google.com‬‎';
      expect(await resolveLink(link, deps)).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      expect(await resolveLink('‏abc@group.calendar.google.com‏', deps)).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      expect(calls).toHaveLength(0);
    });

    it('reads a cid link and a public iCal address without any request', async () => {
      const { deps, calls } = setup({});
      const cid = Buffer.from('abc@group.calendar.google.com').toString('base64url');
      expect(await resolveLink(`https://calendar.google.com/calendar/u/0?cid=${cid}`, deps)).toEqual({
        kind: 'calendar',
        calendarIds: ['abc@group.calendar.google.com'],
      });
      expect(
        await resolveLink('https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics', deps),
      ).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      expect(calls).toHaveLength(0);
    });

    it('reads every calendar of an embed that shows several', async () => {
      const { deps, calls } = setup({});
      const link = 'https://www.google.com/calendar/embed?src=a%40group.calendar.google.com&src=b%40group.calendar.google.com&src=a%40group.calendar.google.com';
      expect(await resolveLink(link, deps)).toEqual({
        kind: 'calendar',
        calendarIds: ['a@group.calendar.google.com', 'b@group.calendar.google.com'],
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe('what is not a link', () => {
    it('is unreachable when there is no address in the text', async () => {
      const { deps, calls } = setup({});
      for (const text of ['אין כאן כלום', '', '   ', 'מתאריך 22.11.26']) expect(await codeOf(resolveLink(text, deps))).toBe('unreachable');
      expect(calls).toHaveLength(0);
    });

    it('is unreachable on http and on any other scheme, without a lookup or a fetch', async () => {
      const { deps, calls, looked } = setup({ 'http://hadarimschool.co.il/x': html('x') });
      for (const text of ['http://hadarimschool.co.il/x', 'ftp://hadarimschool.co.il/x', 'file:///etc/passwd']) {
        expect(await codeOf(resolveLink(text, deps))).toBe('unreachable');
      }
      expect(calls).toHaveLength(0);
      expect(looked).toHaveLength(0);
    });

    it('is unreachable when the name resolves to a private address, without a fetch', async () => {
      const { deps, calls } = setup({ 'https://school.example.org/x': html('secret') }, () => ['10.0.0.5']);
      expect(await codeOf(resolveLink('https://school.example.org/x', deps))).toBe('unreachable');
      expect(calls).toHaveLength(0);
    });

    it('is unreachable on an address written as a private IP', async () => {
      const { deps, calls } = setup({});
      for (const text of ['https://127.0.0.1/board', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]:443/']) {
        expect(await codeOf(resolveLink(text, deps))).toBe('unreachable');
      }
      expect(calls).toHaveLength(0);
    });

    it('is unreachable on a text so long that no one typed it', async () => {
      const { deps, calls } = setup({});
      expect(await codeOf(resolveLink(`https://a.example.org/${'x'.repeat(5000)}`, deps))).toBe('unreachable');
      expect(calls).toHaveLength(0);
    });

    it('finds the address in a sentence', async () => {
      const { deps, urls } = setup({ [HADARIM_URL]: html(fixtureText('hadarim-page.html')) });
      const text = `היי, הלוח של י״ב נמצא פה: ${HADARIM_URL}. תודה!`;
      expect(await resolveLink(text, deps)).toEqual({ kind: 'calendar', calendarIds: [HADARIM_ID] });
      expect(urls()).toEqual([HADARIM_URL]);
    });
  });

  describe('2. a Google sheet', () => {
    const SHEET = 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit?usp=sharing#gid=0';
    const EXPORT = 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=xlsx';

    it('downloads the sheet as xlsx, through the redirect Google answers with', async () => {
      const xlsx = fixtureBytes('grade9-list.xlsx');
      const { deps, urls, looked } = setup({
        [EXPORT]: redirect('https://doc-0c-8k-sheets.googleusercontent.com/export/abc?format=xlsx', 307),
        'https://doc-0c-8k-sheets.googleusercontent.com/export/abc?format=xlsx': file(
          xlsx,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      });
      const got = await resolveLink(SHEET, deps);
      expect(got.kind).toBe('xlsx');
      expect(got.kind === 'xlsx' && Buffer.from(got.bytes).equals(Buffer.from(xlsx))).toBe(true);
      expect(urls()).toEqual([EXPORT, 'https://doc-0c-8k-sheets.googleusercontent.com/export/abc?format=xlsx']);
      expect(looked).toEqual(['docs.google.com', 'doc-0c-8k-sheets.googleusercontent.com']);
    });

    it.each([
      ['a sheet link with nothing after the id', 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123'],
      ['a sheet link written without https', 'docs.google.com/spreadsheets/d/1AbC_dEf-123/edit'],
      ['a sheet link in a sentence', 'הנה הגיליון: https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=5, תודה'],
      ['a sheet link with a user index', 'https://docs.google.com/spreadsheets/u/1/d/1AbC_dEf-123/edit'],
      ['an export link', 'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export?format=csv&gid=0'],
    ])('asks for the xlsx export from %s', async (_name, link) => {
      const { deps, urls } = setup({ [EXPORT]: file(fixtureBytes('grade9-list.xlsx')) });
      expect((await resolveLink(link, deps)).kind).toBe('xlsx');
      expect(urls()).toEqual([EXPORT]);
    });

    it('asks a sheet published to the web for its xlsx', async () => {
      const PUB = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQabc_def/pub?output=xlsx';
      const { deps, urls } = setup({ [PUB]: file(fixtureBytes('grade9-list.xlsx')) });
      expect((await resolveLink('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabc_def/pubhtml?widget=true', deps)).kind).toBe('xlsx');
      expect(urls()).toEqual([PUB]);
    });

    it('says the sheet is not shared when Google answers with a redirect to its sign-in page, and does not go there', async () => {
      const { deps, urls } = setup({
        [EXPORT]: redirect('https://accounts.google.com/ServiceLogin?service=wise&continue=https%3A%2F%2Fdocs.google.com%2Fspreadsheets'),
        'https://accounts.google.com/ServiceLogin?service=wise&continue=https%3A%2F%2Fdocs.google.com%2Fspreadsheets': html('<form>sign in</form>'),
      });
      expect(await codeOf(resolveLink(SHEET, deps))).toBe('private_sheet');
      expect(urls()).toEqual([EXPORT]);
    });

    it('says the sheet is not shared when the answer is a redirect chain that ends at the sign-in page', async () => {
      const { deps } = setup({
        [EXPORT]: redirect('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export/again'),
        'https://docs.google.com/spreadsheets/d/1AbC_dEf-123/export/again': redirect('https://accounts.google.com/v3/signin/identifier'),
      });
      expect(await codeOf(resolveLink(SHEET, deps))).toBe('private_sheet');
    });

    it('says the sheet is not shared when the answer is a page', async () => {
      const { deps } = setup({ [EXPORT]: html('<html>Sign in</html>') });
      expect(await codeOf(resolveLink(SHEET, deps))).toBe('private_sheet');
    });

    it('is unreachable when Google does not answer, and unsupported when it answers with something else', async () => {
      expect(await codeOf(resolveLink(SHEET, setup({ [EXPORT]: new Response('gone', { status: 404 }) }).deps))).toBe('unreachable');
      expect(await codeOf(resolveLink(SHEET, setup({ [EXPORT]: file('%PDF-1.7', 'application/pdf') }).deps))).toBe('unsupported_file');
    });
  });

  describe('3. a link that gives a file', () => {
    it('takes a zip as an xlsx, whatever the server calls it', async () => {
      const xlsx = fixtureBytes('grade9-list.xlsx');
      for (const type of [
        'application/octet-stream',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip',
        'text/plain',
        'text/html',
      ]) {
        const { deps } = setup({ 'https://school.example.org/board.xlsx': file(xlsx, type) });
        const got = await resolveLink('https://school.example.org/board.xlsx', deps);
        expect(got.kind).toBe('xlsx');
        expect(got.kind === 'xlsx' && Buffer.from(got.bytes).equals(Buffer.from(xlsx))).toBe(true);
      }
    });

    it.each([
      ['a PDF', file('%PDF-1.7 ...', 'application/pdf')],
      ['a csv', file('a,b\n1,2\n', 'text/csv')],
      ['an image', file(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')],
      ['json', file('{"a":1}', 'application/json')],
      ['plain text', file('hello', 'text/plain')],
      ['an old xls', file(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'application/vnd.ms-excel')],
      ['a file with no type', new Response(new Uint8Array([1, 2, 3]), { status: 200 })],
      ['an empty answer', new Response(null, { status: 200 })],
    ])('says %s is not a supported file', async (_name, reply) => {
      const { deps } = setup({ 'https://school.example.org/board': reply });
      expect(await codeOf(resolveLink('https://school.example.org/board', deps))).toBe('unsupported_file');
    });

    it('says a file over 2MB is too big', async () => {
      const { deps } = setup({ 'https://school.example.org/board.xlsx': file(new Uint8Array(2 * MB + 1)) });
      expect(await codeOf(resolveLink('https://school.example.org/board.xlsx', deps))).toBe('too_big');
    });
  });

  describe('4. a page', () => {
    it('finds the calendar the Hadarim page embeds, as served', async () => {
      const { deps, urls } = setup({ [HADARIM_URL]: html(fixtureText('hadarim-page.html')) });
      expect(await resolveLink(HADARIM_URL, deps)).toEqual({ kind: 'calendar', calendarIds: [HADARIM_ID] });
      expect(urls()).toEqual([HADARIM_URL]);
    });

    it('finds it from the address as people paste it, with the Hebrew written out, and with no scheme', async () => {
      const decoded = decodeURIComponent(HADARIM_URL);
      for (const text of [decoded, decoded.replace('https://', '')]) {
        const { deps, urls } = setup({ [HADARIM_URL]: html(fixtureText('hadarim-page.html')) });
        expect(await resolveLink(text, deps)).toEqual({ kind: 'calendar', calendarIds: [HADARIM_ID] });
        expect(urls()).toEqual([HADARIM_URL]);
      }
    });

    it('finds the calendar in iframes and links, once each, at most ten', async () => {
      const many = ids(12);
      const page = `<html><body>
        ${iframeOf(many[0]!)}
        <a href="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(many[1]!)}">יומן</a>
        <a href="https://calendar.google.com/calendar/ical/${encodeURIComponent(many[2]!)}/public/basic.ics">ics</a>
        ${iframeOf(many[0]!)}
        ${many.slice(3).map(iframeOf).join('\n')}
        <a href="mailto:office@school.example.org">office</a><a href="info@school.example.org">no scheme</a>
        <a href="/relative/page">p</a><a>no href</a><iframe></iframe><iframe src=""></iframe>
        <iframe src="https://www.youtube.com/embed/xyz"></iframe>
      </body></html>`;
      const { deps } = setup({ 'https://school.example.org/exams': html(page) });
      const got = await resolveLink('https://school.example.org/exams', deps);
      expect(got).toEqual({ kind: 'calendar', calendarIds: many.slice(0, 10) });
    });

    it('reads every calendar of a multi-calendar iframe', async () => {
      const page = '<iframe src="https://www.google.com/calendar/embed?src=a%40group.calendar.google.com&amp;src=b%40group.calendar.google.com"></iframe>';
      const { deps } = setup({ 'https://school.example.org/exams': html(page) });
      expect(await resolveLink('https://school.example.org/exams', deps)).toEqual({
        kind: 'calendar',
        calendarIds: ['a@group.calendar.google.com', 'b@group.calendar.google.com'],
      });
    });

    it('prefers a calendar to a file link', async () => {
      const page = `${iframeOf('abc@group.calendar.google.com')}<a href="/files/board.xlsx">file</a>`;
      const { deps, urls } = setup({ 'https://school.example.org/exams': html(page) });
      expect(await resolveLink('https://school.example.org/exams', deps)).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      expect(urls()).toEqual(['https://school.example.org/exams']);
    });

    describe('with no calendar, exactly one file link, followed once', () => {
      const xlsx = fixtureBytes('grade9-list.xlsx');

      it('reads one link to an xlsx, resolved against the page where redirects ended', async () => {
        const { deps, urls } = setup({
          'https://school.example.org/go': redirect('https://school.example.org/a/b/'),
          'https://school.example.org/a/b/': html('<p>הלוח: <a href="../files/board.xlsx">להורדה</a></p>'),
          'https://school.example.org/a/files/board.xlsx': file(xlsx),
        });
        const got = await resolveLink('https://school.example.org/go', deps);
        expect(got.kind).toBe('xlsx');
        expect(got.kind === 'xlsx' && Buffer.from(got.bytes).equals(Buffer.from(xlsx))).toBe(true);
        expect(urls()).toEqual(['https://school.example.org/go', 'https://school.example.org/a/b/', 'https://school.example.org/a/files/board.xlsx']);
      });

      it('reads a link to /files/board.xlsx', async () => {
        const { deps, urls } = setup({
          'https://school.example.org/exams': html('<a href="/files/board.xlsx">x</a>'),
          'https://school.example.org/files/board.xlsx': file(xlsx),
        });
        expect((await resolveLink('https://school.example.org/exams', deps)).kind).toBe('xlsx');
        expect(urls()).toEqual(['https://school.example.org/exams', 'https://school.example.org/files/board.xlsx']);
      });

      it('counts the same link twice as one, even written differently, and takes .XLSX and a query', async () => {
        const page = '<nav><a href="/files/Board.XLSX?dl=1">הורדה</a></nav><main><a href="https://school.example.org/files/Board.XLSX?dl=1#top">שוב</a></main>';
        const { deps, urls } = setup({
          'https://school.example.org/exams': html(page),
          'https://school.example.org/files/Board.XLSX?dl=1': file(xlsx),
        });
        expect((await resolveLink('https://school.example.org/exams', deps)).kind).toBe('xlsx');
        expect(urls()).toHaveLength(2);
      });

      it('is no_board with two different links, and asks neither', async () => {
        const page = '<a href="/files/a.xlsx">a</a><a href="/files/b.xlsx">b</a>';
        const { deps, urls } = setup({ 'https://school.example.org/exams': html(page) });
        expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('no_board');
        expect(urls()).toEqual(['https://school.example.org/exams']);
      });

      it('is no_board with a file link and a sheet link', async () => {
        const page = '<a href="/files/a.xlsx">a</a><a href="https://docs.google.com/spreadsheets/d/AAA/edit">b</a>';
        const { deps, urls } = setup({ 'https://school.example.org/exams': html(page) });
        expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('no_board');
        expect(urls()).toHaveLength(1);
      });

      it('is no_board with nothing on the page', async () => {
        const page = '<html><body><p>אין כאן לוח</p><a href="/about">אודות</a><a href="/files/board.pdf">pdf</a><a href="/files/board.xlsx.html">x</a></body></html>';
        const { deps, urls } = setup({ 'https://school.example.org/exams': html(page) });
        expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('no_board');
        expect(urls()).toHaveLength(1);
      });

      it('is no_board with an empty page and with a page that is not well formed', async () => {
        for (const page of ['', '<<<>>>', '<a href="/x.xlsx', '\u0000\u0001<html']) {
          const { deps } = setup({ 'https://school.example.org/exams': html(page) });
          expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('no_board');
        }
      });

      it('reads one link to a Google sheet, through its export, and says so when the sheet is private', async () => {
        const page = '<a href="https://docs.google.com/spreadsheets/d/SHEET1/edit?usp=sharing">הגיליון</a><iframe src="https://docs.google.com/spreadsheets/d/SHEET1/htmlview"></iframe>';
        const EXPORT = 'https://docs.google.com/spreadsheets/d/SHEET1/export?format=xlsx';
        const open = setup({ 'https://school.example.org/exams': html(page), [EXPORT]: file(xlsx) });
        expect((await resolveLink('https://school.example.org/exams', open.deps)).kind).toBe('xlsx');
        expect(open.urls()).toEqual(['https://school.example.org/exams', EXPORT]);

        const closed = setup({ 'https://school.example.org/exams': html(page), [EXPORT]: redirect('https://accounts.google.com/ServiceLogin') });
        expect(await codeOf(resolveLink('https://school.example.org/exams', closed.deps))).toBe('private_sheet');
        expect(closed.urls()).toEqual(['https://school.example.org/exams', EXPORT]);
      });

      it('goes one hop and no further', async () => {
        const hop = '<a href="/files/other.xlsx">another</a><iframe src="https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com"></iframe>';
        const { deps, urls } = setup({
          'https://school.example.org/exams': html('<a href="/files/board.xlsx">x</a>'),
          'https://school.example.org/files/board.xlsx': html(hop),
        });
        expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('unsupported_file');
        expect(urls()).toEqual(['https://school.example.org/exams', 'https://school.example.org/files/board.xlsx']);
      });

      it('does not go to a link on a private address, or on http, or in another scheme', async () => {
        for (const href of ['http://school.example.org/board.xlsx', 'https://10.0.0.5/board.xlsx', 'https://127.0.0.1/board.xlsx', 'ftp://school.example.org/board.xlsx']) {
          const { deps, urls } = setup({ 'https://school.example.org/exams': html(`<a href="${href}">x</a>`) });
          expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('unreachable');
          expect(urls()).toEqual(['https://school.example.org/exams']);
        }
      });

      it('does not go to a link whose name resolves to a private address', async () => {
        const { deps, urls } = setup(
          { 'https://school.example.org/exams': html('<a href="https://files.example.org/board.xlsx">x</a>') },
          (host) => (host === 'files.example.org' ? ['172.16.5.5'] : [PUBLIC_IP]),
        );
        expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('unreachable');
        expect(urls()).toEqual(['https://school.example.org/exams']);
      });

      it('passes on what the hop says: too big, unreachable', async () => {
        const page = '<a href="/files/board.xlsx">x</a>';
        const big = setup({ 'https://school.example.org/exams': html(page), 'https://school.example.org/files/board.xlsx': file(new Uint8Array(2 * MB + 1)) });
        expect(await codeOf(resolveLink('https://school.example.org/exams', big.deps))).toBe('too_big');
        const dead = setup({ 'https://school.example.org/exams': html(page) });
        expect(await codeOf(resolveLink('https://school.example.org/exams', dead.deps))).toBe('unreachable');
      });
    });

    describe('a page built to be slow to read', () => {
      it('reads a page nested as deep as a real one is, and more', async () => {
        const page = `${'<div>'.repeat(200)}${iframeOf('abc@group.calendar.google.com')}${'</div>'.repeat(200)}`;
        const { deps } = setup({ 'https://school.example.org/exams': html(page) });
        expect(await resolveLink('https://school.example.org/exams', deps)).toEqual({ kind: 'calendar', calendarIds: ['abc@group.calendar.google.com'] });
      });

      it.each([
        ['tags nested a hundred thousand deep', '<div>'.repeat(100_000)],
        ['anchors that are never closed', '<a href="/files/board.xlsx">'.repeat(60_000)],
        ['a few hundred open tags and then as many stray closing ones as fit', `${'<div>'.repeat(250)}${'</x></y>'.repeat(250_000)}`],
      ])('gives up on %s, without taking long over it', async (_name, page) => {
        const { deps } = setup({ 'https://school.example.org/exams': html(page) });
        const started = Date.now();
        const code = await codeOf(resolveLink('https://school.example.org/exams', deps));
        expect(Date.now() - started).toBeLessThan(4000);
        expect(code).toBe('no_board');
      });

      it('looks at 1.7MB of links without taking long over it', async () => {
        const page = Array.from({ length: 60_000 }, (_, i) => `<a href="/f/${i}.xlsx">x</a>`).join('');
        const { deps } = setup({ 'https://school.example.org/exams': html(page) });
        const started = Date.now();
        expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('no_board');
        expect(Date.now() - started).toBeLessThan(4000);
      });

      // What is done with a page after it is fetched is outside the 10 seconds and blocks the process, so
      // it must be cheap however the 2MB are spent. These are the shapes that were not (fix round 1).
      const distinct = (bytes: number, one: (i: number) => string) => {
        let out = '';
        for (let i = 0; out.length < bytes; i++) out += one(i);
        return out;
      };
      const firstTen = Array.from({ length: 10 }, (_, i) => `c${i}@g.co`);

      it('reads one iframe that names a hundred thousand different calendars, and gives the first ten', async () => {
        const srcs = distinct(1_900_000, (i) => `&src=c${i}%40g.co`);
        const page = `<iframe src="https://calendar.google.com/calendar/embed?showTz=0${srcs}"></iframe>`;
        expect(page.length).toBeLessThan(2 * MB);
        const { deps } = setup({ 'https://school.example.org/exams': html(page) });
        const started = Date.now();
        expect(await resolveLink('https://school.example.org/exams', deps)).toEqual({ kind: 'calendar', calendarIds: firstTen });
        expect(Date.now() - started).toBeLessThan(4000);
      });

      it('reads a link typed in with that many calendars as quickly', async () => {
        const { deps } = setup({});
        const started = Date.now();
        const link = `https://calendar.google.com/calendar/embed?showTz=0${distinct(3900, (i) => `&src=c${i}%40g.co`)}`;
        expect(await resolveLink(link, deps)).toEqual({ kind: 'calendar', calendarIds: firstTen });
        expect(Date.now() - started).toBeLessThan(4000);
      });

      it('reads one iframe that names the same calendar a hundred thousand times', async () => {
        const page = `<iframe src="https://calendar.google.com/calendar/embed?${distinct(1_900_000, () => '&src=c0%40g.co')}"></iframe>`;
        const { deps } = setup({ 'https://school.example.org/exams': html(page) });
        const started = Date.now();
        expect(await resolveLink('https://school.example.org/exams', deps)).toEqual({ kind: 'calendar', calendarIds: ['c0@g.co'] });
        expect(Date.now() - started).toBeLessThan(4000);
      });

      it('stops at ten calendars across thousands of iframes', async () => {
        const page = distinct(1_900_000, (i) => `<iframe src="https://calendar.google.com/calendar/embed?src=c${i}%40g.co"></iframe>`);
        const { deps } = setup({ 'https://school.example.org/exams': html(page) });
        const started = Date.now();
        expect(await resolveLink('https://school.example.org/exams', deps)).toEqual({ kind: 'calendar', calendarIds: firstTen });
        expect(Date.now() - started).toBeLessThan(4000);
      });

      it.each([
        ['an iframe with a hundred thousand src parameters that are not calendars', () => `<iframe src="https://x.example.org/?${distinct(1_900_000, () => '&src=x')}"></iframe>`],
        ['one link whose address is 1.9MB of path', () => `<a href="https://x.example.org/${'a/'.repeat(950_000)}">x</a>`],
        ['one link with a 1.9MB calendar address that has no calendar in it', () => `<a href="https://x.example.org/calendar/ical/${'a'.repeat(1_900_000)}">x</a>`],
        ['one link with 1.9MB of repeated calendar paths', () => `<a href="https://x.example.org/${'/calendar/ical/a'.repeat(110_000)}">x</a>`],
        ['one link with a cid parameter of 1.9MB', () => `<a href="https://x.example.org/?cid=${'QUJD'.repeat(475_000)}">x</a>`],
        ['one link of 1.9MB of entities', () => `<a href="/f?${'&amp;a=1'.repeat(240_000)}">x</a>`],
        ['one link of 1.9MB of dots and an .xlsx at its end', () => `<a href="https://x.example.org/${'.'.repeat(1_900_000)}.xlsx">x</a>`],
      ])('gives up on %s, without taking long over it', async (_name, build) => {
        const page = build();
        expect(page.length).toBeLessThan(2 * MB);
        const { deps, urls } = setup({ 'https://school.example.org/exams': html(page) });
        const started = Date.now();
        const code = await codeOf(resolveLink('https://school.example.org/exams', deps));
        expect(Date.now() - started).toBeLessThan(4000);
        // Never a calendar; for the last shape it is the one file link, which is asked for and is not there.
        expect(['no_board', 'unreachable']).toContain(code);
        expect(urls().length).toBeLessThanOrEqual(2);
      });
    });

    it('treats a page that is not HTML as a file', async () => {
      const { deps } = setup({ 'https://school.example.org/exams': file('<a href="/files/board.xlsx">x</a>', 'text/plain') });
      expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('unsupported_file');
    });
  });

  describe('the limits, from the top', () => {
    it('is unreachable after four redirects, and takes three', async () => {
      const chain = (n: number) => {
        const routes: Record<string, Reply> = {};
        for (let i = 1; i <= n; i++) routes[`https://school.example.org/${i}`] = redirect(`/${i + 1}`);
        routes[`https://school.example.org/${n + 1}`] = html(fixtureText('hadarim-page.html'));
        return setup(routes);
      };
      expect(await resolveLink('https://school.example.org/1', chain(3).deps)).toEqual({ kind: 'calendar', calendarIds: [HADARIM_ID] });
      expect(await codeOf(resolveLink('https://school.example.org/1', chain(4).deps))).toBe('unreachable');
    });

    it('is too_big with a body of 2MB and a byte', async () => {
      const { deps } = setup({ 'https://school.example.org/exams': html('x'.repeat(2 * MB + 1)) });
      expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('too_big');
    });

    it('is unreachable when the page is down', async () => {
      const { deps } = setup({ 'https://school.example.org/exams': new Response('busy', { status: 503 }) });
      expect(await codeOf(resolveLink('https://school.example.org/exams', deps))).toBe('unreachable');
    });
  });

  describe('what it keeps to itself', () => {
    it('carries only the code, never the page, in what it throws, and logs nothing', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
      const secret = 'SECRET-MARKER-4f1c';
      const { deps } = setup({
        'https://school.example.org/exams': html(`<p>${secret}</p>`),
        'https://school.example.org/bad.pdf': file(`${secret}`, 'application/pdf'),
      });
      for (const link of ['https://school.example.org/exams', 'https://school.example.org/bad.pdf']) {
        try {
          await resolveLink(link, deps);
          expect.unreachable();
        } catch (e) {
          expect(e).toBeInstanceOf(BoardError);
          expect(JSON.stringify(e)).not.toContain(secret);
          expect(String(e)).not.toContain(secret);
          expect((e as Error).message).toBe((e as BoardError).code);
          expect((e as Error).cause).toBeUndefined();
        }
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
  });
});
