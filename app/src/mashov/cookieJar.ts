/**
 * Mashov's cookies on the phone: the jar the phone's own reads send.
 *
 * Android has one store: the WebView's CookieManager is also what `fetch`
 * sends from and saves to, so the WebView's jar is the jar. iOS has two, and
 * its own file (`cookieJar.ios.ts`, picked by the bundler) with the same
 * exports. The split is by file rather than `Platform.OS` so this side stays
 * free of `react-native`: the server's tests load `phone.ts`, which uses it.
 */
import CookieManager, { type Cookies } from '@react-native-cookies/cookies';
import { MASHOV_ORIGIN } from '../config';
import { expiringCookieLines } from '../lib/mashovRenew';

/** The jar `fetch` sends from, for Mashov's origin; empty when it cannot be read. */
export async function readJar(): Promise<Cookies> {
  try {
    return await CookieManager.get(MASHOV_ORIGIN, true);
  } catch {
    return {};
  }
}

/** The names in `fetch`'s store when it is not the WebView's: none here, the two are one. */
export async function fetchStoreNames(): Promise<string[]> {
  return [];
}

/** Nothing to copy: the WebView's login is already where `fetch` reads. */
export async function syncWebViewCookiesToShared(): Promise<void> {}

/**
 * Expires some of Mashov's cookies with `Set-Cookie` lines: Android's module
 * has no delete-by-name. Best effort: if a cookie will not go, the login
 * view's baseline still keeps it from counting as new.
 */
export async function expireCookies(names: readonly string[]): Promise<void> {
  for (const name of names) {
    for (const line of expiringCookieLines(name, MASHOV_ORIGIN)) {
      try {
        await CookieManager.setFromResponse(MASHOV_ORIGIN, line);
      } catch {
        // Nothing to do; see above.
      }
    }
  }
  try {
    await CookieManager.flush();
  } catch {
    // Android flushes on its own soon after.
  }
}

/** "ניתוק": every cookie goes. */
export async function clearJar(): Promise<void> {
  await CookieManager.clearAll(true).catch(() => undefined);
}
