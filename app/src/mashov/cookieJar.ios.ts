/**
 * Mashov's cookies on iOS (`cookieJar.ts` is Android's, with the same exports).
 *
 * iOS has two stores. The login WebView (WKWebView) keeps its cookies in
 * WebKit's (`useWebKit` true), while `fetch` (NSURLSession) sends from and
 * saves to `NSHTTPCookieStorage.sharedHTTPCookieStorage` (false): the token
 * Mashov rotates on a read, the CSRF token with it, and a `loginDevice`
 * session land there only. So the shared store is the jar, and a WebView
 * login is copied into it.
 *
 * `sharedCookiesEnabled` copies shared → WebKit when a WebView loads, and
 * mirrors WebKit → shared while one is open, but as an observer, a beat late,
 * and never a deletion: a cookie expired in one store comes back from the
 * other, hence both.
 */
import CookieManager, { type Cookie, type Cookies } from '@react-native-cookies/cookies';
import { MASHOV_ORIGIN } from '../config';

/** The jar `fetch` sends from, for Mashov's origin; empty when it cannot be read. */
export async function readJar(): Promise<Cookies> {
  try {
    return await CookieManager.get(MASHOV_ORIGIN, false);
  } catch {
    return {};
  }
}

/** The names in `fetch`'s store, which the login WebView copies into its own when it loads. */
export async function fetchStoreNames(): Promise<string[]> {
  return Object.keys(await readJar());
}

/**
 * `expires` as `set` parses it (en_US_POSIX, UTC). `get` formats it in the
 * device's locale, which a 12-hour clock or another calendar can make
 * unreadable, and an unreadable one would turn the cookie into a session one.
 */
function normalizedExpires(expires: string | undefined): string | undefined {
  if (!expires) return undefined;
  const at = Date.parse(expires);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

/**
 * Copies the WebView's Mashov cookies into the store `fetch` uses, right
 * after a login and before the first read with it. A cookie the observer
 * already copied (same value) is left alone.
 */
export async function syncWebViewCookiesToShared(): Promise<void> {
  let web: Cookies;
  let shared: Cookies;
  try {
    [web, shared] = await Promise.all([CookieManager.get(MASHOV_ORIGIN, true), CookieManager.get(MASHOV_ORIGIN, false)]);
  } catch {
    return;
  }
  for (const cookie of Object.values(web)) {
    if (shared[cookie.name]?.value === cookie.value) continue;
    const expires = normalizedExpires(cookie.expires);
    const copy: Cookie = {
      name: cookie.name,
      value: cookie.value,
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      ...(cookie.path ? { path: cookie.path } : {}),
      ...(expires ? { expires } : {}),
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
    };
    try {
      // Another spelling of it (domain, path) would go out next to the new one.
      await CookieManager.clearByName(MASHOV_ORIGIN, cookie.name, false);
      await CookieManager.set(MASHOV_ORIGIN, copy, false);
    } catch {
      // Best effort: the WebView's own observer may still copy it.
    }
  }
}

/**
 * Expires some of Mashov's cookies by name, in both stores, WebKit's first
 * so the WebView's observer cannot copy one back into the shared store.
 */
export async function expireCookies(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await CookieManager.clearByName(MASHOV_ORIGIN, name, true).catch(() => undefined);
    await CookieManager.clearByName(MASHOV_ORIGIN, name, false).catch(() => undefined);
  }
}

/** "ניתוק": every cookie goes, from both stores. */
export async function clearJar(): Promise<void> {
  await CookieManager.clearAll(true).catch(() => undefined);
  await CookieManager.clearAll(false).catch(() => undefined);
}
