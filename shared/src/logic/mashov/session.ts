/**
 * A Mashov session as cookies: reading one cookie, merging what Mashov rotates,
 * and what the auth token says about itself. Pure and portable (no Node
 * Buffer), so the phone can use it on its own cookie jar (plan Phase 2c).
 */

export interface MashovSessionBlob {
  cookieHeader: string;
  csrfToken: string | null;
  userId: string | null;
  capturedAt: string;
}

/**
 * What the `MashovAuthToken` cookie tells us about itself.
 *
 * The cookie is an unsigned-to-us JWT whose payload also carries the student's
 * national ID number and display name. Those are deliberately **not** read,
 * stored or logged here — the app needs the user id, the school and the expiry,
 * and nothing else. Reading less is the whole point.
 */
export interface MashovTokenInfo {
  userId: string;
  /** סמל מוסד — the school id, `Semel` in the payload. */
  schoolId: string | null;
  /** School year, named by the Gregorian year it ends in (תשפ"ז → "2027"). */
  year: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  /**
   * When the person logged in (`LoginTime`, epoch seconds as text). Mashov
   * renews the token hourly but keeps this, and ends the session about 8
   * hours after it (measured 2026-10-21).
   */
  loginAt: Date | null;
}

export const AUTH_COOKIE = 'MashovAuthToken';
export const CSRF_COOKIE = 'Csrf-Token';

/** Pulls one cookie's value out of a `Cookie` header. */
export function cookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export interface CookieMerge {
  /** The jar after the merge; byte-identical to the input when nothing changed. */
  cookieHeader: string;
  /** Names of cookies that were updated, added or removed. Names only — never values. */
  changed: string[];
}

interface JarEntry {
  name: string;
  /** null for a bare token with no `=`, kept verbatim so the jar round-trips. */
  value: string | null;
}

function parseJar(cookieHeader: string): JarEntry[] {
  const entries: JarEntry[] = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    entries.push(eq < 0 ? { name: trimmed, value: null } : { name: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() });
  }
  return entries;
}

function serializeJar(entries: JarEntry[]): string {
  return entries.map((e) => (e.value === null ? e.name : `${e.name}=${e.value}`)).join('; ');
}

interface SetCookie {
  name: string;
  value: string;
  /** Max-Age ≤ 0, an Expires in the past, or an empty value: the server is clearing it. */
  remove: boolean;
}

function parseSetCookie(line: string, now: Date): SetCookie | null {
  const [pair = '', ...attributes] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  let maxAge: number | null = null;
  let expires: number | null = null;
  for (const attribute of attributes) {
    const at = attribute.indexOf('=');
    const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
    const raw = at < 0 ? '' : attribute.slice(at + 1).trim();
    if (key === 'max-age' && /^-?\d+$/.test(raw)) maxAge = Number(raw);
    if (key === 'expires') {
      const t = Date.parse(raw);
      if (Number.isFinite(t)) expires = t;
    }
  }
  // Max-Age wins over Expires when both are present (RFC 6265 §5.3).
  const lapsed = maxAge !== null ? maxAge <= 0 : expires !== null && expires <= now.getTime();
  return { name, value, remove: lapsed || value === '' };
}

/**
 * Applies a response's `Set-Cookie` lines to a flat `Cookie` header — what a
 * browser does for this one host, and what the server never used to do: it
 * replayed the jar captured at login forever, so a token Mashov rotated on a
 * data call was thrown away and the stale one kept being sent.
 *
 * Keyed by name only. Every Mashov cookie lives on `.web.mashov.info` and the
 * captured jar is already flat, so domains and paths add nothing here. Order is
 * preserved; a new cookie is appended; a cleared or expired one is removed.
 */
export function mergeSetCookies(cookieHeader: string, setCookies: readonly string[], now: Date = new Date()): CookieMerge {
  const jar = parseJar(cookieHeader);
  const changed = new Set<string>();

  for (const line of setCookies) {
    const cookie = parseSetCookie(line, now);
    if (!cookie) continue;
    const first = jar.findIndex((e) => e.name === cookie.name);

    if (cookie.remove) {
      if (first < 0) continue;
      for (let i = jar.length - 1; i >= 0; i -= 1) if (jar[i]!.name === cookie.name) jar.splice(i, 1);
      changed.add(cookie.name);
      continue;
    }

    if (first < 0) {
      jar.push({ name: cookie.name, value: cookie.value });
      changed.add(cookie.name);
      continue;
    }
    // One authoritative value per name: update the first, drop any duplicates.
    let dirty = jar[first]!.value !== cookie.value;
    jar[first]!.value = cookie.value;
    for (let i = jar.length - 1; i > first; i -= 1) {
      if (jar[i]!.name === cookie.name) {
        jar.splice(i, 1);
        dirty = true;
      }
    }
    if (dirty) changed.add(cookie.name);
  }

  return { cookieHeader: changed.size > 0 ? serializeJar(jar) : cookieHeader, changed: [...changed] };
}

/**
 * Reads the session's own metadata straight out of the auth cookie. This is why
 * the app does not have to scrape the student GUID out of the page: the token
 * already carries it.
 */
export function parseMashovToken(cookieHeader: string): MashovTokenInfo | null {
  const jwt = cookieValue(cookieHeader, AUTH_COOKIE);
  if (!jwt) return null;
  const payload = jwt.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(base64UrlToUtf8(payload)) as Record<string, unknown>;
    const userId = typeof json.UserId === 'string' ? json.UserId : null;
    if (!userId) return null;
    return {
      userId,
      schoolId: typeof json.Semel === 'string' ? json.Semel : null,
      year: typeof json.Year === 'string' ? json.Year : null,
      issuedAt: typeof json.iat === 'number' ? new Date(json.iat * 1000) : null,
      expiresAt: typeof json.exp === 'number' ? new Date(json.exp * 1000) : null,
      loginAt: epochSeconds(json.LoginTime),
    };
  } catch {
    return null;
  }
}

/** A claim of epoch seconds, as a number or as digits in a string. */
function epochSeconds(value: unknown): Date | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/** base64url → UTF-8 text, with no Node `Buffer` and no `atob`. */
export function base64UrlToUtf8(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const clean = input.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error('invalid base64url');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

/** UTF-8 bytes → text, by hand: Hermes has not always shipped `TextDecoder`. */
function utf8Decode(bytes: readonly number[]): string {
  const codePoints: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i]!;
    const extra = b0 < 0x80 ? 0 : b0 >= 0xf0 ? 3 : b0 >= 0xe0 ? 2 : b0 >= 0xc0 ? 1 : -1;
    if (extra < 0 || i + extra >= bytes.length + (extra === 0 ? 1 : 0)) throw new Error('invalid utf-8');
    let cp = extra === 0 ? b0 : b0 & (0x3f >> extra);
    for (let k = 1; k <= extra; k += 1) {
      const b = bytes[i + k]!;
      if ((b & 0xc0) !== 0x80) throw new Error('invalid utf-8');
      cp = (cp << 6) | (b & 0x3f);
    }
    codePoints.push(cp);
    i += extra + 1;
  }
  let out = '';
  for (let i = 0; i < codePoints.length; i += 4096) out += String.fromCodePoint(...codePoints.slice(i, i + 4096));
  return out;
}
