/**
 * Mashov, read by the phone itself (plan Phase 2c).
 *
 * The spike (2026-10-19) settled how: the phone's own `fetch`, with the
 * native cookie jar sending what the login WebView left there ("jar" mode).
 * The jar also keeps the token Mashov rotates once it is past half its hour,
 * so every read renews the session; a hand-built Cookie header would keep
 * sending the stale one.
 */
import { AuthError } from '@sederyom/shared/logic/entities';
import { MASHOV_PATHS, mashovApi, type MashovApi } from '@sederyom/shared/logic/mashov/api';
import { CSRF_COOKIE, AUTH_COOKIE, parseMashovToken } from '@sederyom/shared/logic/mashov/session';
import { MASHOV_ORIGIN } from '../config';
import { readJar } from './cookieJar';

const TIMEOUT_MS = 20_000;

/**
 * The jar for Mashov's origin as name → value; empty when it cannot be read.
 * The one `fetch` sends (`cookieJar.ts`), so the CSRF token and the rotated
 * token read here are the ones that go out.
 */
export async function readMashovJar(): Promise<Record<string, string>> {
  const cookies = await readJar();
  return Object.fromEntries(Object.values(cookies).map((c) => [c.name, c.value]));
}

/**
 * One answer, the way the server's client judges it: 401/403, or an HTML
 * page where JSON was asked for (the login portal, after a redirect `fetch`
 * followed), means the session is gone.
 */
export function judgeAnswer(path: string, status: number, text: string): unknown {
  if (status === 401 || status === 403) throw new AuthError(`Mashov returned ${status}`);
  if (status < 200 || status >= 300) throw new Error(`Mashov ${path} returned HTTP ${status}`);
  if (text.trimStart().startsWith('<')) throw new AuthError(`Mashov ${path} returned HTML: not logged in`);
  return text ? JSON.parse(text) : null;
}

/** The school's Shahaf site, as Mashov names it (`/api/shahaf/coolSite`), or null. */
export async function mashovCoolSite(
  fetchImpl: typeof fetch = fetch,
  jar: () => Promise<Record<string, string>> = readMashovJar,
): Promise<string | null> {
  const { get } = await phoneSession(fetchImpl, jar);
  const site = await get(MASHOV_PATHS.coolSite());
  return typeof site === 'string' && site.length > 0 ? site : null;
}

/** When the person logged in to the session in the jar (ISO), or `null` when there is none or it does not say. */
export async function phoneLoginAt(jar: () => Promise<Record<string, string>> = readMashovJar): Promise<string | null> {
  const cookies = await jar();
  const token = cookies[AUTH_COOKIE] ? parseMashovToken(`${AUTH_COOKIE}=${cookies[AUTH_COOKIE]}`) : null;
  return token?.loginAt?.toISOString() ?? null;
}

/**
 * The API over the phone's jar, or an `AuthError` when there is no login to
 * read with. `fetchImpl` and `jar` are seams for tests. `guid`: whose data to
 * read, when not the login's own user's (a parent's child, `parents.ts`).
 */
export async function phoneMashovApi(
  fetchImpl: typeof fetch = fetch,
  jar: () => Promise<Record<string, string>> = readMashovJar,
  guid?: string,
): Promise<MashovApi> {
  const { get, userId } = await phoneSession(fetchImpl, jar);
  return mashovApi(get, guid ?? userId);
}

async function phoneSession(
  fetchImpl: typeof fetch,
  jar: () => Promise<Record<string, string>>,
): Promise<{ get: (path: string) => Promise<unknown>; userId: string }> {
  const cookies = await jar();
  const token = cookies[AUTH_COOKIE] ? parseMashovToken(`${AUTH_COOKIE}=${cookies[AUTH_COOKIE]}`) : null;
  if (!token) throw new AuthError('no Mashov login on this phone');

  const get = async (path: string): Promise<unknown> => {
    // Read the CSRF token per request: Mashov rotates it with the session.
    const csrf = (await jar())[CSRF_COOKIE] ?? null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${MASHOV_ORIGIN}${path}`, {
        credentials: 'include',
        signal: controller.signal,
        headers: { accept: 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      });
      return judgeAnswer(path, res.status, await res.text());
    } finally {
      clearTimeout(timer);
    }
  };
  return { get, userId: token.userId };
}
