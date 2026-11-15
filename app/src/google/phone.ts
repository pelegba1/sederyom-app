/**
 * Google on the phone (plan Phase 2d): the native sign-in holds the account
 * and renews its access token itself, so no refresh token ever leaves the
 * phone. Google no longer lets new Android clients sign in through a browser
 * and a custom scheme, which is why this is the native module and not a
 * redirect.
 *
 * Android finds the OAuth client by the app's package and signing
 * certificate; the web client id is what the sign-in is issued for.
 */
import { GoogleSignin, isCancelledResponse, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { AuthError } from '@sederyom/shared/logic/entities';
import { PHONE_GOOGLE_SCOPES, type GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config';
import type { GoogleSignInState } from './sync';

let configured = false;

function configure(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    scopes: [...PHONE_GOOGLE_SCOPES],
  });
  configured = true;
}

/** The consent screen. `cancelled` when the person backed out. */
export async function signInToGoogle(): Promise<{ kind: 'ok'; email: string } | { kind: 'cancelled' }> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (isCancelledResponse(res) || !isSuccessResponse(res)) return { kind: 'cancelled' };
  return { kind: 'ok', email: res.data.user.email };
}

/** Whether the phone holds a Google sign-in that still works, restoring it quietly if it does. */
export async function googleSignInState(): Promise<GoogleSignInState> {
  configure();
  if (!GoogleSignin.hasPreviousSignIn()) return { kind: 'out' };
  try {
    const res = await GoogleSignin.signInSilently();
    return res.type === 'success' ? { kind: 'in' } : { kind: 'needs-login', error: 'Google kept no sign-in for this account' };
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    const text = err instanceof Error ? err.message : String(err);
    return { kind: 'failed', error: `Google sign-in${code === undefined ? '' : ` ${String(code)}`}: ${text}` };
  }
}

export function googleAccount(): string | null {
  configure();
  return GoogleSignin.getCurrentUser()?.user.email ?? null;
}

export async function signOutOfGoogle(): Promise<void> {
  configure();
  await GoogleSignin.revokeAccess().catch(() => null);
  await GoogleSignin.signOut();
}

/**
 * Authorized requests with the sign-in's token. A 401 drops the cached token
 * and tries once more with a fresh one; a second 401 means the grant is gone.
 */
export function phoneGoogleRequester(fetchImpl: typeof fetch = fetch): GoogleRequester {
  configure();
  return {
    async request<T>(url: string, init: RequestInit = {}): Promise<T> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { accessToken } = await GoogleSignin.getTokens();
        const res = await fetchImpl(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json',
            // Google reads a write's body only when it says it is JSON.
            ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
        });
        if (res.status === 401 && attempt === 0) {
          await GoogleSignin.clearCachedAccessToken(accessToken);
          continue;
        }
        if (res.status === 401) throw new AuthError('Google refused the sign-in');
        const text = await res.text();
        if (!res.ok) throw Object.assign(new Error(`Google ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
        return (text ? JSON.parse(text) : null) as T;
      }
      throw new AuthError('Google refused the sign-in');
    },
  };
}
