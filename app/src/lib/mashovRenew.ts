/**
 * Mashov renewal, layer 1 (plan §13.3, W6-1): the pure part.
 *
 * The session does not survive a night. When the app comes back to the
 * foreground with Mashov disconnected, a sheet runs the same login page as
 * the full screen ("מתחברים מחדש למשוב…"). Whether that page signs in again
 * with nobody touching it depends on the Ministry's identification
 * (`lgn.edu.gov.il`) still remembering the phone, and nobody knows yet. So
 * this layer is useful either way, and it measures the answer:
 * - the capture says `via=auto` (nobody touched the login page) or `manual`;
 * - the sheet keeps its last result on the phone, for "פרטים טכניים", with
 *   where the person had to touch: Mashov's page, or the Ministry's.
 *
 * Pure on purpose, so `node --test` can load it: type imports only. The
 * stored copy lives in `mashovRenewStore.ts`, the WebView in
 * `components/useMashovCapture.ts`.
 */
import type { SourceStatus } from '@sederyom/shared';

/** How a session reached the server: by itself, or because the person logged in. */
export type CaptureVia = 'auto' | 'manual';

/**
 * Why the sheet opened: the app came to the foreground with Mashov
 * disconnected (`auto`, at most once per outage), or the person tapped the
 * "צריך להתחבר שוב למשוב" push or its row in the log (`push`, every time).
 */
export type RenewTrigger = 'auto' | 'push';

/** The cookie that exists only once Mashov's login has finished. */
export const AUTH_COOKIE = 'MashovAuthToken';

/**
 * Mashov's device cookie (spike-findings, round 3: `uniquId`, ~13 months).
 * Likely what Mashov's device trust keys off, so a fresh start keeps it.
 */
export const DEVICE_COOKIE = 'uniquId';

/**
 * What the login WebView adds to its user agent on the iPhone, so Mashov's
 * page reads it as Safari: "Version/18.1 Safari/604.1".
 *
 * WKWebView's own agent ends "AppleWebKit/605.1.15 (KHTML, like Gecko)
 * Mobile/15E148", without Safari's last two words. Mashov's page sniffs the
 * agent jQuery-style (web.mashov.info/students, 2026-11-01), and a bare
 * WebKit is "webkit 605.1.15", a browser it does not know: it puts up a red
 * "הדפדפן שלך אינו נתמך" over the login (TestFlight, 2026-11-01), and it
 * describes the phone to Mashov by the same sniff — the login's `deviceUuid`
 * and `devicePlatform` say "webkit", where Android's, whose "מכשיר אישי"
 * works, say "chrome". With these words it is "safari 18", the iPhone's own
 * browser, which Mashov supports from version 12. WebKit appends them after
 * its "Mobile/15E148" (`applicationNameForUserAgent`).
 *
 * `iosVersion` is `Platform.Version` ("18.1"); Safari's version is the
 * system's, major and minor.
 */
export function safariAgentSuffix(iosVersion: string | number): string {
  const [major, minor] = String(iosVersion).split('.');
  const version = /^\d+$/.test(major ?? '') ? `${major}.${/^\d+$/.test(minor ?? '') ? minor : '0'}` : '18.0';
  return `Version/${version} Safari/604.1`;
}

// ── Whether to try by itself ───────────────────────────────────────────────

/**
 * Mashov is disconnected in a way a new login fixes: the server holds a
 * session and Mashov rejected it. Never for "not connected at all": that is
 * onboarding's job, and nobody asked for Mashov yet.
 */
export function needsRenewal(mashov: SourceStatus | null | undefined): boolean {
  if (!mashov || !mashov.configured) return false;
  return mashov.needsReauth || Boolean(mashov.session?.failedAt);
}

/**
 * Which outage this is: `session.failedAt` (the first rejection), or the
 * row's `degradedSince`, which the server sets at the same moment. `null`
 * when neither is known, and then there is no automatic attempt, since
 * there is nothing to count it against.
 *
 * A renewal Mashov rejects keeps the same key: the capture clears
 * `needsReauth` but not `degradedSince`, and the failed verify-poll keeps
 * it. Only a success clears it, so the next outage has a new key.
 */
export function renewKey(mashov: SourceStatus | null | undefined): string | null {
  if (!mashov) return null;
  return mashov.session?.failedAt ?? mashov.degradedSince ?? null;
}

/**
 * Whether to open the sheet by itself: Mashov needs a new login, and this
 * outage has not had its one try yet. Opening it, not finishing it, is the
 * try: "לא עכשיו" or the app being closed mid-way does not earn another one.
 * After that, the strip on "היום שלי" and the push stay the way in.
 */
export function shouldAutoRenew(
  mashov: SourceStatus | null | undefined,
  lastAttemptedKey: string | null,
): { attempt: boolean; key: string | null } {
  const key = renewKey(mashov);
  if (!needsRenewal(mashov) || key === null) return { attempt: false, key };
  return { attempt: key !== lastAttemptedKey, key };
}

/**
 * Whether the sheet may decide yet, on the phone as it is now rather than on
 * a status snapshot. A read that finds the session gone logs in again with
 * the "מכשיר אישי" pass and reads once more, and saves "needs a login" only if
 * that did not help (`SyncDeps.renew`). Still, a snapshot can be older than the
 * read, and an outage kept from an earlier read may be ending right now
 * (iPhone, 2026-11-04: the pass worked at 19:55 and the sheet still opened at
 * 19:56). So:
 * - `wait` while a read runs: the refresh refetches the status when it ends;
 * - `fine` when the phone's latest read needs no login: the snapshot is stale;
 * - `decide` otherwise: `shouldAutoRenew` decides as before.
 */
export function renewGate(phone: { reading: boolean; needsLogin: boolean }): 'wait' | 'fine' | 'decide' {
  if (phone.reading) return 'wait';
  return phone.needsLogin ? 'decide' : 'fine';
}

// ── The login page ─────────────────────────────────────────────────────────

/** `auto` only when nobody touched the login page or pressed anything on the way. */
export function captureVia(interacted: boolean): CaptureVia {
  return interacted ? 'manual' : 'auto';
}

/**
 * Whether the auth cookie in the jar is a new one. The jar may still hold the
 * one from before the night: the same value as when the login view opened is
 * that stale cookie, and capturing it would only be rejected.
 */
export function isNewAuthCookie(value: string | null | undefined, baseline: string | null): boolean {
  return typeof value === 'string' && value.length > 0 && value !== baseline;
}

/** Whose page the login view is on: Mashov's, the Ministry's identification (`*.gov.il`), or another. */
export type PageKind = 'mashov' | 'idp' | 'other';

export function pageKind(url: string | null | undefined): PageKind {
  const host = /^https?:\/\/([^/?#:]+)/i.exec(url ?? '')?.[1]?.toLowerCase() ?? '';
  if (host === 'mashov.info' || host.endsWith('.mashov.info')) return 'mashov';
  if (host === 'gov.il' || host.endsWith('.gov.il')) return 'idp';
  return 'other';
}

/**
 * Runs in every page the login view loads, Mashov's and the Ministry's: the
 * first touch, key or input in that page is reported once. A wrapper's
 * `onTouchStart` sees touches too, but over a native WebView it is not
 * something to bet the measurement on.
 */
export const TOUCH_MESSAGE = 'sederyom-touch';
export const TOUCH_REPORTER = `(function () {
  if (window.__sederyomTouch) return;
  window.__sederyomTouch = true;
  var sent = false;
  function report() {
    if (sent || !window.ReactNativeWebView) return;
    sent = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${TOUCH_MESSAGE}', href: String(location.href) }));
  }
  ['pointerdown', 'touchstart', 'keydown', 'input'].forEach(function (name) {
    document.addEventListener(name, report, { capture: true, passive: true });
  });
})();
true;`;

/** The page a touch report came from, or `null` for any other message. */
export function touchedPage(data: string): PageKind | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; href?: unknown };
    if (parsed?.type !== TOUCH_MESSAGE) return null;
    return pageKind(typeof parsed.href === 'string' ? parsed.href : null);
  } catch {
    return null;
  }
}

/**
 * The Mashov cookies a fresh start expires: every one but the device cookie.
 * Only Mashov's: the Ministry's identification cookies are exactly what lets
 * the next login go through by itself, so nothing ever clears them.
 */
export function cookiesToExpire(names: readonly string[]): string[] {
  return [...new Set(names)].filter((name) => name !== DEVICE_COOKIE && name.length > 0);
}

/**
 * `Set-Cookie` lines that expire one cookie on Mashov's origin. Android's
 * cookie module has no delete-by-name (`clearByName` rejects there), and an
 * expired cookie replaces the stored one only if domain and path match: the
 * jar does not say whether it was set for `.web.mashov.info` or the host
 * alone, so both.
 */
export function expiringCookieLines(name: string, origin: string): string[] {
  const gone = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly`;
  const host = /^https?:\/\/([^/?#:]+)/i.exec(origin)?.[1]?.toLowerCase();
  return host ? [`${gone}; Domain=.${host}`, gone] : [gone];
}

// ── What happened, for "פרטים טכניים" ──────────────────────────────────────

/** How a sheet's attempt ended. */
export type RenewEnd = 'verified' | 'rejected' | 'error' | 'closed';

/** The last attempt, kept on the phone so the person can read it and report it. */
export interface RenewRecord {
  /** When it ended (ISO). */
  at: string;
  trigger: RenewTrigger;
  end: RenewEnd;
  /** What the capture said; `null` when nothing was captured. */
  via: CaptureVia | null;
  /** Where the person touched or pressed, first touch first. */
  touched: PageKind[];
  /** Whether the login view went through the Ministry's identification at all. */
  visitedIdp: boolean;
}

/** It worked by itself: a new session, verified, and nobody touched anything. */
export function renewedByItself(record: RenewRecord): boolean {
  return record.end === 'verified' && record.touched.length === 0;
}

const ENDS: readonly RenewEnd[] = ['verified', 'rejected', 'error', 'closed'];
const KINDS: readonly PageKind[] = ['mashov', 'idp', 'other'];

/** A stored record, or `null` for anything missing or unreadable. */
export function parseRenewRecord(raw: string | null | undefined): RenewRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<RenewRecord>;
    if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
    if (!ENDS.includes(r.end as RenewEnd)) return null;
    return {
      at: r.at,
      trigger: r.trigger === 'push' ? 'push' : 'auto',
      end: r.end as RenewEnd,
      via: r.via === 'auto' || r.via === 'manual' ? r.via : null,
      touched: Array.isArray(r.touched) ? r.touched.filter((k): k is PageKind => KINDS.includes(k as PageKind)) : [],
      visitedIdp: r.visitedIdp === true,
    };
  } catch {
    return null;
  }
}

export const RENEW_COPY = {
  title: 'מתחברים מחדש למשוב…',
  renewed: 'התחברנו מחדש למשוב',
  notNow: 'לא עכשיו',
  detailLabel: 'חידוש אוטומטי אחרון',
  succeeded: 'הצליח ב־',
  failed: 'לא הצליח ב־',
  reasonIdp: 'נדרשה כניסה בהזדהות אחידה',
  reasonMashovIdpPassed: 'נדרשה לחיצה במשוב, והזדהות אחידה עברה לבד',
  reasonMashov: 'נדרשה כניסה במשוב',
  reasonTap: 'נדרשה לחיצה',
  reasonRejected: 'משוב לא אישר את הכניסה',
  reasonError: 'לא הצלחנו לבדוק מול משוב',
  reasonClosed: 'נסגר לפני שהסתיים',
} as const;

/**
 * Why it did not work by itself, in a few words; `null` when it did. A touch
 * on the Ministry's page wins: it means the identification forgot the phone,
 * which is the question layer 1 is here to answer. A touch on Mashov's page
 * alone, with the identification then passing without one, is the other
 * half: the Ministry remembered, and only Mashov asked.
 */
export function renewReason(record: RenewRecord): string | null {
  if (renewedByItself(record)) return null;
  const touched = new Set(record.touched);
  if (touched.has('idp')) return RENEW_COPY.reasonIdp;
  if (touched.has('mashov')) {
    return record.end === 'verified' && record.visitedIdp ? RENEW_COPY.reasonMashovIdpPassed : RENEW_COPY.reasonMashov;
  }
  if (touched.size > 0) return RENEW_COPY.reasonTap;
  switch (record.end) {
    case 'rejected':
      return RENEW_COPY.reasonRejected;
    case 'error':
      return RENEW_COPY.reasonError;
    default:
      return RENEW_COPY.reasonClosed;
  }
}

/**
 * The line in "פרטים טכניים": "חידוש אוטומטי אחרון: הצליח ב־9.10, 07:42", or
 * "…: לא הצליח ב־9.10, 07:42 · נדרשה כניסה בהזדהות אחידה". `at` stays ISO:
 * the screen formats it, inside `Ltr`.
 */
export function renewDetail(record: RenewRecord | null): { label: string; verdict: string; at: string; reason: string | null } | null {
  if (!record) return null;
  return {
    label: RENEW_COPY.detailLabel,
    verdict: renewedByItself(record) ? RENEW_COPY.succeeded : RENEW_COPY.failed,
    at: record.at,
    reason: renewReason(record),
  };
}

// ── Opening the sheet from outside it ──────────────────────────────────────

type RenewListener = (trigger: RenewTrigger) => void;
let listener: RenewListener | null = null;
let pending: RenewTrigger | null = null;
let captureViews = 0;

/**
 * Asks the app-level sheet to open: a tapped relogin push, or its row in the
 * log. A cold-start tap can arrive before the sheet is mounted; it waits,
 * and the sheet opens as soon as it is. Ignored while the full login screen
 * is open, since the person is already logging in there.
 */
export function requestMashovRenew(trigger: RenewTrigger = 'push'): void {
  if (captureViews > 0) return;
  if (listener) listener(trigger);
  else pending = trigger;
}

/** The sheet's side: one listener; a request that came early is delivered now. */
export function onMashovRenewRequest(fn: RenewListener): () => void {
  listener = fn;
  if (pending !== null) {
    const trigger = pending;
    pending = null;
    fn(trigger);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}

/** The full login screen holds this while open, so nothing opens a second login on top of it. */
export function holdLoginScreen(): () => void {
  captureViews += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    captureViews -= 1;
  };
}

/** Whether the full login screen is open right now. */
export function loginScreenOpen(): boolean {
  return captureViews > 0;
}
