/**
 * From a link a student pasted to what is behind it: a public Google calendar, or the bytes of an xlsx
 * (design doc, "איך קוראים קישור"). `resolveLink` is called with a string typed on an anonymous device, so it
 * makes this server fetch an address chosen by a stranger. The rules that keep that safe are all in
 * `safeGet`, and nothing else in this file makes a request:
 *
 * - https only, no user name or password in the address, no port but 443;
 * - the host is resolved first (`deps.lookup`, every address it has) and the request is made only if every
 *   one of them is public (`isPublicAddress`); a host written as an IP is checked as it is too. The check
 *   is made again for every redirect, which `safeGet` follows by hand (at most 3);
 * - 10 seconds for the whole get, 2MB of body (read as a stream, and cancelled when it passes), and no
 *   cookies or headers of our own;
 * - what was fetched is never logged and never put in an error: a refusal is a `BoardError` and only its
 *   code leaves.
 *
 * Known gap: the address is checked here and then resolved again by `fetch` when it connects, so a DNS
 * server that answers differently the second time (rebinding) can still get a request to a private address
 * through. Closing it means connecting to the address that was checked, with an agent of our own; that is
 * left out on purpose. The check also covers every redirect, so what remains is a hostile name server, not
 * a hostile page.
 */
import { isIP } from 'node:net';
import { normalizeCalendarId } from '@sederyom/shared/logic/exam-board/calendar';
import { withoutMarks } from '@sederyom/shared/logic/exam-board/text';
import { Parser } from 'htmlparser2';
import { BoardError } from './errors';

export interface LinkDeps {
  fetch: typeof fetch;
  /** Every address the host resolves to (`dns.lookup(host, { all: true })`). */
  lookup(host: string): Promise<string[]>;
}

export interface Fetched {
  /** The address the bytes came from, after the redirects. */
  url: string;
  /** The media type only (`text/html`), lower case, without its parameters; empty when the server said none. */
  contentType: string;
  bytes: Uint8Array;
}

export type ResolvedLink = { kind: 'calendar'; calendarIds: string[] } | { kind: 'xlsx'; bytes: Uint8Array };

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** A pasted link is a few hundred characters; a longer text is not one, and is not worth scanning. */
const MAX_LINK_CHARS = 4096;
/** Calendars one page may offer for the student to choose from. */
const MAX_CALENDARS = 10;
/** How deep a page's tags may nest (a real page is under 100) and how many of its links are looked at. */
const MAX_PAGE_DEPTH = 256;
const MAX_PAGE_REFS = 20_000;

const unreachable = () => new BoardError('unreachable');

// ---- the first address in a text ----------------------------------------------------------------------

/**
 * Either something with a scheme (`https://…`, kept as typed, so that `safeGet` is the one to refuse an
 * `http://` or an `ftp://`), or a bare host with a dot and a top-level domain of letters (`site.co.il/path`),
 * which gets `https://`. The path runs to the next space and keeps its Hebrew. The look-behind keeps the host
 * of an e-mail address (`dana@school.co.il`) and the tail of a longer name from starting a match, and bounds
 * the work: a match can only start where a run of address characters starts. A date (`22.11.26`) or a version
 * (`2.0.1`) has no letters in its last label.
 */
const ADDRESS =
  /(?<![A-Za-z0-9@._+-])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"“”]+|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9_-])(?::\d{1,5})?(?:[/?#][^\s<>"“”]*)?)/;
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '’', '”', '»', '…', '>']);

export function firstUrl(pasted: string): string | null {
  // A link copied from a Hebrew chat may carry a bidi mark or a zero-width character, before it, after it, or in it.
  const text = withoutMarks(pasted);
  const found = ADDRESS.exec(text);
  if (!found) return null;
  const match = found[0];
  // A closing bracket belongs to the address only when it closes one inside it: "(see https://a.org/x)" and
  // "https://a.org/A_(b)" both come out right.
  let open = 0;
  let close = 0;
  for (const ch of match) {
    if (ch === '(') open++;
    else if (ch === ')') close++;
  }
  let end = match.length;
  while (end > 0) {
    const last = match[end - 1]!;
    if (TRAILING_PUNCTUATION.has(last)) end--;
    else if (last === ')' && close > open) {
      close--;
      end--;
    } else break;
  }
  const url = match.slice(0, end);
  if (!url) return null;
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
}

// ---- which addresses are public -----------------------------------------------------------------------

/** IPv4 ranges that are not the public internet: private, loopback, link-local, shared, reserved, multicast, broadcast. */
const V4_REFUSED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4], // also 255.255.255.255
];

/** IPv6 ranges inside 2000::/3 that are still not the public internet. */
const V6_REFUSED: readonly (readonly [string, number])[] = [
  ['2001::', 23], // protocol assignments, Teredo among them
  ['2001:db8::', 32], // documentation
  ['3fff::', 20], // documentation
  ['2002::', 16], // 6to4: an IPv4 address in IPv6 clothes
];

const v4Number = (ip: string): number => ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);

function isPublicV4(n: number): boolean {
  return !V4_REFUSED.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(n / size) === Math.floor(v4Number(base) / size);
  });
}

/** An IPv6 literal that `net.isIP` has accepted (so: no zone), as a 128-bit number. */
function v6Number(ip: string): bigint {
  let text = ip;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const halves = text.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length > 1 ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail] : head;
  return groups.reduce((n, group) => (n << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function isPublicV6(n: bigint): boolean {
  // Only global unicast (2000::/3), and none of its special ranges, is public. Every IPv6 spelling of an
  // IPv4 address is therefore refused, whatever the address inside it is (no school site is reached that
  // way, and an address that hides its kind is not one to open a connection to):
  // - IPv4-mapped ::ffff:0:0/96 (a URL writes ::ffff:10.0.0.1 as ::ffff:a00:1) and IPv4-compatible ::/96
  //   are outside 2000::/3, with :: and ::1, unique local fc00::/7, link-local fe80::/10, site-local
  //   fec0::/10, multicast ff00::/8, and 100::/64;
  // - NAT64 64:ff9b::/96 and 64:ff9b:1::/48 are outside it too (they start 0064::);
  // - 6to4 2002::/16 is inside it, so it is in V6_REFUSED.
  if (n >> 125n !== 1n) return false;
  return !V6_REFUSED.some(([base, bits]) => n >> BigInt(128 - bits) === v6Number(base) >> BigInt(128 - bits));
}

/**
 * Whether a connection to this address would reach the public internet. Anything that is not exactly an IP
 * literal (a name, a number written as one integer, an address with a zone or a prefix length, spaces) is
 * `false`: this is a gate, and what it cannot read it does not let through.
 */
export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== 'string' || ip.includes('%')) return false;
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(v4Number(ip));
  if (kind === 6) return isPublicV6(v6Number(ip));
  return false;
}

// ---- the one place that makes a request ---------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Lets a caller end the get with its own refusal when a redirect points somewhere; see `resolveLink`'s sheet step. */
export type RedirectGuard = (next: URL) => BoardError | null;

/** The bytes at an https address that is public, after at most 3 redirects, or a `BoardError`. */
export function safeGet(url: string, deps: LinkDeps): Promise<Fetched> {
  return safeGetWith(url, deps);
}

export async function safeGetWith(url: string, deps: LinkDeps, guard?: RedirectGuard): Promise<Fetched> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  // fetch gives up on its own when the signal fires; the lookup and the body read are held to it here.
  const expired = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(unreachable());
    else signal.addEventListener('abort', () => reject(unreachable()), { once: true });
  });
  expired.catch(() => {});
  const within = <T>(p: Promise<T>): Promise<T> => Promise.race([p, expired]);

  try {
    let current = parseUrl(url);
    for (let redirects = 0; ; redirects++) {
      await checkTarget(current, deps, within);
      // Nothing but the address: no cookies, no credentials, no referrer, no headers of ours.
      const res = await within(deps.fetch(current.href, { redirect: 'manual', credentials: 'omit', signal }));

      if (REDIRECT_STATUSES.has(res.status)) {
        discard(res);
        const location = res.headers.get('location');
        if (redirects >= MAX_REDIRECTS || !location) throw unreachable();
        const next = parseUrl(location, current);
        const refusal = guard?.(next);
        if (refusal) throw refusal;
        current = next;
        continue;
      }
      if (res.status < 200 || res.status > 299) {
        discard(res);
        throw unreachable();
      }
      const bytes = await readCapped(res, within);
      return { url: current.href, contentType: mediaType(res.headers.get('content-type')), bytes };
    }
  } catch (e) {
    // Only our own refusals keep their code (too_big, private_sheet); a network error, an abort or a bug
    // is "the link did not open", and says nothing about what was in it.
    throw e instanceof BoardError ? e : unreachable();
  }
}

function parseUrl(text: string, base?: URL): URL {
  try {
    return new URL(text, base);
  } catch {
    throw unreachable();
  }
}

/** The rules for where a request may go. `new URL` has already turned 2130706433 and 0x7f.1 into 127.0.0.1. */
async function checkTarget(url: URL, deps: LinkDeps, within: <T>(p: Promise<T>) => Promise<T>): Promise<void> {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw unreachable();
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (!host) throw unreachable();
  // A host that is an IP is checked as written, whatever the resolver says about it.
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw unreachable();
  let addresses: string[];
  try {
    addresses = await within(deps.lookup(host));
  } catch {
    throw unreachable();
  }
  if (!Array.isArray(addresses) || addresses.length === 0 || !addresses.every(isPublicAddress)) throw unreachable();
}

/**
 * Lets go of a body that will not be read, so the connection is not held open. Not awaited: a cancel that
 * waits for the other end must not be able to hold the deadline.
 */
function discard(res: Response): void {
  res.body?.cancel().catch(() => {});
}

/** The body, or `too_big` the moment it passes 2MB: a declared length is believed only as a reason to stop early. */
async function readCapped(res: Response, within: <T>(p: Promise<T>) => Promise<T>): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    discard(res);
    throw new BoardError('too_big');
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await within(reader.read());
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new BoardError('too_big');
      chunks.push(value);
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

const mediaType = (header: string | null): string => (header ?? '').split(';')[0]!.trim().toLowerCase();

// ---- what is behind a link ----------------------------------------------------------------------------

/** An xlsx is a zip, and a zip starts with its first local file header. Servers call it anything, so the bytes decide. */
const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isHtml = (contentType: string): boolean => contentType === 'text/html' || contentType === 'application/xhtml+xml';

/**
 * Every calendar `value` names: the one `normalizeCalendarId` reads, and, when `value` is an address, each
 * `src=` of an embed that shows several calendars (`?src=a…&src=b…`), which `normalizeCalendarId` stops
 * at the first of.
 */
function calendarIdsIn(value: string): string[] {
  // A Set, and no more than MAX_CALENDARS of them: `value` can be 2MB of `&src=` parameters, and nobody is
  // offered more than ten calendars, so there is no reason to read the rest of them.
  const found = new Set<string>();
  const first = normalizeCalendarId(value);
  if (first) found.add(first);
  try {
    for (const src of new URL(value, 'https://placeholder.invalid').searchParams.getAll('src')) {
      if (found.size >= MAX_CALENDARS) break;
      const id = normalizeCalendarId(src);
      if (id) found.add(id);
    }
  } catch {
    // Not an address: the first one is all there is.
  }
  return [...found];
}

/**
 * A Google sheet's xlsx download address, or `null` when `url` is not a sheet. A sheet published to the web
 * (`/d/e/<id>/pubhtml`) has its own address for it.
 */
function sheetExportUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const m = /^\/spreadsheets\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]+)(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  return m[1]
    ? `https://docs.google.com/spreadsheets/d/e/${m[2]}/pub?output=xlsx`
    : `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=xlsx`;
}

/** A sheet that is not shared with everyone answers with a redirect to Google's sign-in page, which is not followed. */
const signInGuard: RedirectGuard = (next) => (next.hostname === 'accounts.google.com' ? new BoardError('private_sheet') : null);

async function fromSheet(exportUrl: string, deps: LinkDeps): Promise<ResolvedLink> {
  const got = await safeGetWith(exportUrl, deps, signInGuard);
  if (isZip(got.bytes)) return { kind: 'xlsx', bytes: got.bytes };
  // A page where a file should be is the sign-in page, or Google's "you need access".
  throw new BoardError(isHtml(got.contentType) ? 'private_sheet' : 'unsupported_file');
}

async function fromFile(url: string, deps: LinkDeps): Promise<ResolvedLink> {
  const got = await safeGet(url, deps);
  if (isZip(got.bytes)) return { kind: 'xlsx', bytes: got.bytes };
  throw new BoardError('unsupported_file');
}

/**
 * The `src` of every `iframe` and the `href` of every `a` in a page, in document order. The page comes from
 * a stranger's choice of address, so it is read as a stream of tags and never built into a tree: the tree
 * parser under cheerio (parse5) takes time in the square of the depth, and 160KB of nested `<div>` cost it
 * half a minute. A page nested deeper than any real one is `no_board`.
 */
function pageReferences(html: string): string[] {
  const refs: string[] = [];
  let depth = 0;
  const parser = new Parser({
    onopentag(name, attribs) {
      if (++depth > MAX_PAGE_DEPTH) throw new BoardError('no_board');
      const value = (name === 'iframe' ? attribs.src : name === 'a' ? attribs.href : undefined)?.trim();
      if (value && refs.length < MAX_PAGE_REFS) refs.push(value);
    },
    onclosetag() {
      depth--;
    },
  });
  parser.write(html);
  parser.end();
  return refs;
}

/**
 * A page: its calendars (in `iframe[src]` and `a[href]`, once each, ten at most) if it has any; otherwise
 * exactly one link to an `.xlsx` or to a Google sheet, which is read, and that is the one hop there is;
 * otherwise `no_board`. A link counts once however often and however it is written (nav and body, with or
 * without a `#fragment`).
 */
async function fromPage(page: Fetched, deps: LinkDeps): Promise<ResolvedLink> {
  const refs = pageReferences(new TextDecoder('utf-8').decode(page.bytes));

  // Only what is shaped like an address: a bare "office@school.example.org" in an href is a mistake in the
  // page, not the calendar of a person called office.
  // The harvest stops at ten distinct calendars: the rest of the page is not read for them.
  const calendars = new Set<string>();
  harvest: for (const ref of refs) {
    if (!/[/?]/.test(ref)) continue;
    for (const id of calendarIdsIn(ref)) {
      calendars.add(id);
      if (calendars.size >= MAX_CALENDARS) break harvest;
    }
  }
  if (calendars.size > 0) return { kind: 'calendar', calendarIds: [...calendars].slice(0, MAX_CALENDARS) };

  const targets = new Map<string, 'sheet' | 'file'>();
  for (const ref of refs) {
    let url: URL;
    try {
      url = new URL(ref, page.url);
    } catch {
      continue;
    }
    url.hash = '';
    const sheet = sheetExportUrl(url.href);
    if (sheet) targets.set(sheet, 'sheet');
    else if (/\.xlsx$/i.test(url.pathname)) targets.set(url.href, 'file');
  }
  if (targets.size !== 1) throw new BoardError('no_board');
  const [[target, kind]] = [...targets] as [[string, 'sheet' | 'file']];
  return kind === 'sheet' ? fromSheet(target, deps) : fromFile(target, deps);
}

/**
 * The first rule that fits decides (design doc, "איך קוראים קישור"):
 * 1. the link is a Google calendar, in any form `normalizeCalendarId` reads: a calendar answer, no request;
 * 2. it is a Google sheet: its xlsx export, and a sign-in page for an answer is `private_sheet`;
 * 3. it gives a zip: an xlsx;
 * 4. it gives HTML: see `fromPage`;
 * anything else it gives is `unsupported_file`. A text with no address in it is `unreachable`.
 */
export async function resolveLink(link: string, deps: LinkDeps): Promise<ResolvedLink> {
  // Without the bidi marks and zero-width characters a link copied from a Hebrew chat may carry, before anything is scanned.
  const text = withoutMarks(link).trim();
  if (text.length > MAX_LINK_CHARS) throw unreachable();

  const calendarIds = calendarIdsIn(text);
  if (calendarIds.length > 0) return { kind: 'calendar', calendarIds: calendarIds.slice(0, MAX_CALENDARS) };

  const url = firstUrl(text);
  if (!url) throw unreachable();
  const sheet = sheetExportUrl(url);
  if (sheet) return fromSheet(sheet, deps);

  const got = await safeGet(url, deps);
  if (isZip(got.bytes)) return { kind: 'xlsx', bytes: got.bytes };
  if (!isHtml(got.contentType)) throw new BoardError('unsupported_file');
  return fromPage(got, deps);
}
