/**
 * Backend pairing (design-doc §3.2 step 1, §8): the app ships with the backend
 * URL, injected at build time through EAS. `EXPO_PUBLIC_*` variables are
 * inlined by Metro, so they must never hold a secret: no token is read here
 * at all (an unreferenced variable is never inlined). The phone registers as
 * a device on `/v2` and holds its own credential (`device/v2.ts`).
 */
import Constants from 'expo-constants';

function read(key: string, fromEnv: string | undefined, fallback = ''): string {
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const fromExtra = extra[key];
  return typeof fromExtra === 'string' && fromExtra.length > 0 ? fromExtra : fallback;
}

// Expo only embeds statically referenced EXPO_PUBLIC variables. Dynamic
// process.env[key] reads are empty in an installed production app.
export const API_BASE_URL = read('EXPO_PUBLIC_SEDERYOM_API_URL', process.env.EXPO_PUBLIC_SEDERYOM_API_URL).replace(/\/$/, '');

/** Mashov's web login; it redirects through הזדהות אחידה on its own. */
export const MASHOV_LOGIN_URL = read('EXPO_PUBLIC_MASHOV_LOGIN_URL', process.env.EXPO_PUBLIC_MASHOV_LOGIN_URL, 'https://web.mashov.info/students/login');
export const MASHOV_ORIGIN = read('EXPO_PUBLIC_MASHOV_ORIGIN', process.env.EXPO_PUBLIC_MASHOV_ORIGIN, 'https://web.mashov.info');

/** The build knows where the service is. */
export const isConfigured = API_BASE_URL.length > 0;

/**
 * Google sign-in on the phone (plan Phase 2d), from `app.json` `extra`. Client
 * IDs are not secrets: they name the app to Google, and Android is matched
 * by package and signing certificate besides.
 */
export const GOOGLE_WEB_CLIENT_ID = read('googleWebClientId', undefined);
export const GOOGLE_IOS_CLIENT_ID = read('googleIosClientId', undefined);

export const TIMEZONE = 'Asia/Jerusalem';
