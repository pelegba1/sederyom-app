/**
 * The Mashov login, shared by the full screen (MashovLoginScreen) and the
 * renewal sheet (MashovRenewSheet, W6-1). Design-doc §6.3 and the spike:
 *
 * - The person logs in inside a WebView on Mashov's own login page, through
 *   הזדהות אחידה or a Mashov password; the password is typed there only.
 * - The session exists only once `MashovAuthToken` is in the jar (the last
 *   login step is an XHR, invisible to navigation), so a probe polls the jar.
 *   The auth cookies are HttpOnly, hence CookieManager and not the page.
 * - The phone keeps its login to itself: it reads Mashov with the jar the
 *   WebView just filled, and that read is the verification.
 * - Each capture is told as `auto` or `manual` (`via`): `auto` only when
 *   nobody touched the login page or pressed anything on the way. That is
 *   the measurement layer 1 exists for (plan §13.3), kept with the renewal's
 *   record (`MashovRenewSheet`).
 *
 * Two things the jar may still hold from before the night:
 * - the old `MashovAuthToken`: expired before the WebView opens, and the
 *   value it had (if expiring did not take) never counts as a new login;
 * - the Ministry's identification cookies (`lgn.edu.gov.il`): never touched.
 *   They are what lets the next login go through by itself. A fresh start
 *   after a rejection expires Mashov's cookies only, and keeps Mashov's
 *   device cookie too.
 *
 * On a parent's phone (parents mode, stage 3) the page's script also hands
 * over each login answer's list of children (`mashov/parents.ts`), and the
 * capture waits a moment for it: the cookie can land before the answer's
 * body is read, and the first read goes by the child's id from that list.
 * Then, before that read, the parent's schools are scanned and every child
 * Mashov lists is linked or added (`mashov/parentScanRun.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { WebViewMessageEvent, WebViewNavigation, WebViewProps } from 'react-native-webview';
import CookieManager, { type Cookies } from '@react-native-cookies/cookies';
import type { MashovSessionResponse } from '@sederyom/shared';
import { useAfterMashovLogin } from '../api/hooks';
import { MASHOV_LOGIN_URL, MASHOV_ORIGIN } from '../config';
import { userSettings } from '../local/userSettings';
import { expireCookies, fetchStoreNames, syncWebViewCookiesToShared } from '../mashov/cookieJar';
import { DEVICE_LOGIN_PATCH, deviceLoginOn, loginPagePatch, noteMashovLoginWorked, takeDeviceMessage } from '../mashov/device';
import { isParentReadError, mashovChildren, takeParentMessage } from '../mashov/parents';
import { runParentScanNow, type ParentScanResult } from '../mashov/parentScanRun';
import { syncMashovNow } from '../mashov/run';
import { storage } from '../widget/feedCache';
import {
  AUTH_COOKIE, TOUCH_REPORTER, captureVia, cookiesToExpire, isNewAuthCookie, pageKind, safariAgentSuffix, touchedPage,
  type CaptureVia, type PageKind, type RenewEnd,
} from '../lib/mashovRenew';

export type CapturePhase = 'preparing' | 'loading' | 'login' | 'capturing' | 'verified' | 'rejected' | 'failed';

/** Thrown when "סיימתי להתחבר" is tapped before Mashov has let the person in. */
export const NOT_YET = 'not-logged-in-yet';

/** How often to re-check whether the SPA has finished authenticating. */
const PROBE_INTERVAL_MS = 1500;

/** How long a parent's capture waits for the login answer's list of children. */
const CHILDREN_WAIT_MS = 4000;

const isParentPhone = (): boolean => userSettings().audience === 'parent';

/** Until the list a login after `since` brought is kept, or `CHILDREN_WAIT_MS` passed: without one the read goes as the login's own user. */
async function waitForChildren(since: string): Promise<void> {
  const until = Date.now() + CHILDREN_WAIT_MS;
  while (Date.now() < until) {
    const kept = mashovChildren(storage);
    if (kept && kept.at >= since) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** How one capture ended, and what the person did on the way. */
export interface CaptureEnd {
  end: Exclude<RenewEnd, 'closed'>;
  via: CaptureVia;
  response: MashovSessionResponse | null;
  touched: PageKind[];
  visitedIdp: boolean;
}

type LoginWebViewProps = Pick<
  WebViewProps,
  | 'source' | 'onNavigationStateChange' | 'onMessage' | 'injectedJavaScript' | 'injectedJavaScriptBeforeContentLoaded' | 'sharedCookiesEnabled'
  | 'thirdPartyCookiesEnabled' | 'javaScriptEnabled' | 'domStorageEnabled' | 'applicationNameForUserAgent'
>;

export interface MashovCapture {
  phase: CapturePhase;
  /** `NOT_YET`, a Hebrew message, or the verify-poll's raw reason after a rejection. */
  error: string | null;
  result: MashovSessionResponse | null;
  /** On a parent's phone, what the scan after this login found and added; `null` before one, or when it failed. */
  scan: ParentScanResult | null;
  /** The WebView's `key`: a fresh start mounts a new one on the login page. */
  webViewKey: number;
  /** Spread onto the WebView. */
  webViewProps: LoginWebViewProps;
  /** On the view around the WebView: a touch anywhere on it counts as the person acting. */
  onTouchStart: () => void;
  /** "סיימתי להתחבר" / "לנסות שוב": capture whatever the jar holds now. */
  captureNow: () => void;
  /** After a rejection: expire Mashov's cookies (never the Ministry's) and load the login page again. */
  startOver: () => Promise<void>;
  /** Where the person touched or pressed so far, and whether the Ministry's page came up. */
  interaction: () => { touched: PageKind[]; visitedIdp: boolean };
}

/**
 * The phone reads Mashov with the jar the WebView just filled: that read is the verification.
 * A parent whose child on screen is not in Mashov's list is logged in all the same.
 */
async function verifyOnPhone(): Promise<MashovSessionResponse> {
  const outcome = await syncMashovNow({ force: true });
  const verified = outcome.kind === 'ok' || outcome.kind === 'skipped' || (outcome.kind === 'failed' && isParentReadError(outcome.error));
  const error = outcome.kind === 'needs-login' || outcome.kind === 'failed' ? outcome.error : null;
  return { ok: true, verified, error, userId: null, expiresAt: null, counts: null };
}

async function readJar(): Promise<Cookies> {
  try {
    return await CookieManager.get(MASHOV_ORIGIN, true);
  } catch {
    return {};
  }
}

export function useMashovCapture(options: { onEnd?: (end: CaptureEnd) => void } = {}): MashovCapture {
  const [phase, setPhase] = useState<CapturePhase>('preparing');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MashovSessionResponse | null>(null);
  const [scan, setScan] = useState<ParentScanResult | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const afterLogin = useAfterMashovLogin();

  const captured = useRef(false);
  /** The auth cookie's value when the login view opened: not a new login. */
  const baseline = useRef<string | null>(null);
  /** When the login page last opened: a list of children kept since is this login's. */
  const openedAt = useRef(new Date().toISOString());
  const currentUrl = useRef<string | null>(null);
  const touched = useRef<PageKind[]>([]);
  const visitedIdp = useRef(false);
  const onEnd = useRef(options.onEnd);
  onEnd.current = options.onEnd;

  const touch = useCallback((kind: PageKind) => {
    if (!touched.current.includes(kind)) touched.current.push(kind);
  }, []);
  const interaction = useCallback(() => ({ touched: [...touched.current], visitedIdp: visitedIdp.current }), []);

  /** Expires what has to go, notes what the jar still holds, then opens the login page. */
  const prepare = useCallback(async (expire: 'auth' | 'mashov') => {
    setPhase('preparing');
    setResult(null);
    setScan(null);
    setError(null);
    captured.current = false;
    // On iOS also what `fetch`'s store holds: the WebView copies it in when it loads.
    const held = [...Object.keys(await readJar()), ...(await fetchStoreNames())];
    const names = expire === 'mashov' ? cookiesToExpire(held) : held.includes(AUTH_COOKIE) ? [AUTH_COOKIE] : [];
    if (names.length > 0) await expireCookies(names);
    baseline.current = (await readJar())[AUTH_COOKIE]?.value ?? null;
    currentUrl.current = null;
    openedAt.current = new Date().toISOString();
    setWebViewKey((k) => k + 1);
    setPhase('loading');
  }, []);

  useEffect(() => {
    void prepare('auth');
  }, [prepare]);

  const capture = useCallback(async (pressed: boolean) => {
    if (captured.current) return;
    captured.current = true;
    if (pressed) touch('other');
    setPhase('capturing');
    const via = captureVia(touched.current.length > 0);
    try {
      const jar = await readJar();
      if (!jar[AUTH_COOKIE]) throw new Error(NOT_YET);
      if (isParentPhone()) await waitForChildren(openedAt.current);
      // iOS: the phone's reads (the verify, and every later one) send `fetch`'s store, not the WebView's.
      await syncWebViewCookiesToShared();
      // Every child Mashov lists, at every school, linked or added before the first read.
      if (isParentPhone()) setScan(await runParentScanNow().catch(() => null));
      const response = await verifyOnPhone();
      setResult(response);
      // The phone just read Mashov with the new session: status, school feeds,
      // today and the widget are all stale until they refetch.
      await afterLogin();
      if (response.verified) {
        // After a refused "מכשיר אישי" login, the next one is ticked again.
        noteMashovLoginWorked(storage);
        setPhase('verified');
      } else {
        setError(response.error);
        setPhase('rejected');
      }
      onEnd.current?.({ end: response.verified ? 'verified' : 'rejected', via, response, ...interaction() });
    } catch (err) {
      captured.current = false;
      const message = (err as Error).message;
      setError(message);
      setPhase('failed');
      if (message !== NOT_YET) onEnd.current?.({ end: 'error', via, response: null, ...interaction() });
    }
  }, [afterLogin, interaction, touch]);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    const url = nav.url ?? '';
    currentUrl.current = url;
    if (pageKind(url) === 'idp') visitedIdp.current = true;
    if (nav.loading) return;
    // Landing back on web.mashov.info means the SSO hop is done, not that the
    // session exists — `/api/idm/login/{school}/{year}` still has to run. The
    // probe below is what decides.
    if (url.startsWith(MASHOV_ORIGIN)) setPhase((current) => (current === 'loading' ? 'login' : current));
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    // The "personal device" trial's reports: the login's device fields and its pass.
    if (takeDeviceMessage(storage, event.nativeEvent.data)) return;
    // A parent's login answers: the children, and how each answer went.
    if (takeParentMessage(storage, event.nativeEvent.data)) return;
    const kind = touchedPage(event.nativeEvent.data);
    if (kind) touch(kind);
  }, [touch]);

  // Poll the jar until a new auth cookie appears, then capture once. Not after
  // a failure: every capture is a Mashov read, and retrying one
  // every 1.5 s would stack them — the button is the retry. "Not logged in
  // yet" is not a failure, so the watch goes on after it.
  const watching = phase === 'loading' || phase === 'login' || (phase === 'failed' && error === NOT_YET);
  useEffect(() => {
    if (!watching) return undefined;
    const timer = setInterval(() => {
      void readJar().then((jar) => {
        if (!captured.current && isNewAuthCookie(jar[AUTH_COOKIE]?.value, baseline.current)) void capture(false);
      });
    }, PROBE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [watching, capture]);

  const captureNow = useCallback(() => {
    captured.current = false;
    void capture(true);
  }, [capture]);

  /**
   * A rejected session is usually a stale one. Re-capturing the same jar would
   * only be rejected again, so this expires Mashov's cookies and starts the
   * login from scratch. It used to clear every cookie in the WebView, the
   * Ministry's identification included: exactly what a login that goes
   * through by itself needs.
   */
  const startOver = useCallback(async () => {
    touch('other');
    await prepare('mashov');
  }, [prepare, touch]);

  const webViewProps = useMemo<LoginWebViewProps>(() => ({
    source: { uri: MASHOV_LOGIN_URL },
    onNavigationStateChange,
    onMessage,
    injectedJavaScript: TOUCH_REPORTER,
    // Before Mashov's own code: its login request goes out with "מכשיר אישי" ticked. On a parent's
    // phone the script is always there, ticked or not, for the login answers' children.
    ...(isParentPhone()
      ? { injectedJavaScriptBeforeContentLoaded: loginPagePatch({ tick: deviceLoginOn(storage), observe: true }) }
      : deviceLoginOn(storage) ? { injectedJavaScriptBeforeContentLoaded: DEVICE_LOGIN_PATCH } : {}),
    sharedCookiesEnabled: true,
    thirdPartyCookiesEnabled: true,
    javaScriptEnabled: true,
    domStorageEnabled: true,
    // iPhone: Safari's last words in the agent, or Mashov's page takes WKWebView for an unknown
    // browser (`safariAgentSuffix`). Android's WebView already reads as Chrome.
    ...(Platform.OS === 'ios' ? { applicationNameForUserAgent: safariAgentSuffix(Platform.Version) } : {}),
  }), [onNavigationStateChange, onMessage]);

  const onTouchStart = useCallback(() => touch(pageKind(currentUrl.current)), [touch]);

  return { phase, error, result, scan, webViewKey, webViewProps, onTouchStart, captureNow, startOver, interaction };
}
