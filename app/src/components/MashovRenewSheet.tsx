/**
 * Mashov renewal, layer 1 (plan §13.3, W6-1). The session does not survive a
 * night, so when the app comes back to the foreground with Mashov
 * disconnected, this sheet opens by itself: "מתחברים מחדש למשוב…". It runs
 * the same login page as the full screen (`useMashovCapture`):
 * - a new auth cookie with nobody touching anything: captured with
 *   `via=auto`, the sheet closes, "התחברנו מחדש למשוב";
 * - Mashov or the Ministry shows a login form: the sheet *is* the login
 *   screen, and a login there is `via=manual`;
 * - "לא עכשיו", the close button, the backdrop or back: closes it. The strip
 *   on "היום שלי" and the push stay the way in.
 *
 * By itself at most once per outage (`shouldAutoRenew`, keyed on the
 * outage's `failedAt`, kept in MMKV so it holds when Android closes the app
 * in between). A tap on the relogin push opens it every time.
 *
 * Each attempt's result is kept on the phone, and `MashovRenewDetail` shows
 * it under "פרטים טכניים", so the person can read it and report it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { useStatus } from '../api/hooks';
import { isConfigured } from '../config';
import { shortDateTime } from '../lib/format';
import {
  RENEW_COPY, loginScreenOpen, needsRenewal, onMashovRenewRequest, renewDetail, renewGate, renewKey, shouldAutoRenew, type RenewTrigger,
} from '../lib/mashovRenew';
import { runningMashovRead } from '../mashov/run';
import { readAttemptedKey, readRenewRecord, writeAttemptedKey, writeRenewRecord } from '../lib/mashovRenewStore';
import { isDemo } from '../demo/phone';
import { hasOnboarded } from '../lib/prefs';
import { MIN_INTERVAL_MIN, localStatus } from '../mashov/sync';
import { storage } from '../widget/feedCache';
import { font, space, type } from '../theme';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Ltr, Text, usePalette } from './ui';
import { NOT_YET, useMashovCapture, type CaptureEnd } from './useMashovCapture';

/**
 * Mounted once, at the app level (navigation/Root.tsx). Opens the sheet:
 * - by itself, after the app comes to the foreground (or starts), once a
 *   fresh `/status` says Mashov needs a new login and this outage has not
 *   had its try. The foreground refresh already refetches `/status`; this
 *   waits for that answer instead of asking again.
 * - when asked (`requestMashovRenew`): the relogin push, or its log row.
 */
export function MashovRenewHost(): React.JSX.Element | null {
  const status = useStatus();
  const [trigger, setTrigger] = useState<RenewTrigger | null>(null);
  /** Set on each return to the foreground: the next fresh `/status` decides. 0: the app just started. */
  const armedAt = useRef<number | null>(0);

  useEffect(() => onMashovRenewRequest((requested) => setTrigger((current) => current ?? requested)), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') armedAt.current = Date.now();
    });
    return () => sub.remove();
  }, []);

  const { data, dataUpdatedAt } = status;
  useEffect(() => {
    if (!data) return;
    const mashov = data.sources.find((s) => s.source === 'mashov');
    if (trigger !== null) {
      // An open sheet is this outage's try, whatever opened it: closing it
      // must not earn a second one on the next return to the app.
      const key = renewKey(mashov);
      if (key !== null && needsRenewal(mashov)) writeAttemptedKey(key);
      armedAt.current = null;
      return;
    }
    const armed = armedAt.current;
    if (armed === null || dataUpdatedAt < armed) return;
    // The status is the phone's own Mashov read: decide on one at most a
    // read's interval older than the return, not on the one the return outran.
    const tried = localStatus(storage).lastTriedAt;
    if (!tried || Date.parse(tried) < armed - MIN_INTERVAL_MIN * 60_000) return;
    // Not on a status fetched mid-read: the read may yet log in with the
    // "מכשיר אישי" pass. Stay armed; the refresh refetches the status after it.
    const gate = renewGate({ reading: runningMashovRead() !== null, needsLogin: localStatus(storage).needsLogin });
    // A snapshot from before the read saved its answer: wait for the one after.
    if (gate === 'wait' || (gate === 'decide' && !needsRenewal(mashov))) return;
    armedAt.current = null;
    if (gate === 'fine') return;
    // Not before setup is done, and not over the full login screen.
    if (!isConfigured || !hasOnboarded() || loginScreenOpen()) return;
    const decision = shouldAutoRenew(mashov, readAttemptedKey());
    if (!decision.attempt || decision.key === null) return;
    writeAttemptedKey(decision.key);
    setTrigger('auto');
  }, [data, dataUpdatedAt, trigger]);

  // The demo has no Mashov login to renew, so it never asks for one.
  if (trigger === null || isDemo()) return null;
  return <RenewSheet trigger={trigger} onClose={() => setTrigger(null)} />;
}

function RenewSheet({ trigger, onClose }: { trigger: RenewTrigger; onClose: () => void }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const { height } = useWindowDimensions();
  /** Whether a capture already wrote this attempt's result; closing then adds nothing. */
  const recorded = useRef(false);

  const login = useMashovCapture({
    onEnd: (end: CaptureEnd) => {
      recorded.current = true;
      writeRenewRecord({
        at: new Date().toISOString(), trigger, end: end.end, via: end.via, touched: end.touched, visitedIdp: end.visitedIdp,
      });
      if (end.end === 'verified') {
        onClose();
        toast.show(RENEW_COPY.renewed);
      }
    },
  });
  const { phase, error } = login;

  const close = (): void => {
    if (!recorded.current) {
      writeRenewRecord({ at: new Date().toISOString(), trigger, end: 'closed', via: null, ...login.interaction() });
    }
    onClose();
  };

  const notYet = phase === 'failed' && error === NOT_YET;
  const failed = phase === 'failed' && !notYet;
  const showWebView = phase === 'loading' || phase === 'login' || phase === 'capturing' || phase === 'failed';
  // Room for a login form (and its one-time code) without the sheet growing past the screen.
  const webHeight = Math.max(MIN_WEB_HEIGHT, Math.round(height * WEB_SHARE));

  // One primary button, the way on from where the sheet is: a fresh start once
  // Mashov said no, else "סיימתי להתחבר" (or "לנסות שוב") under the login page.
  const footer = (
    <View style={styles.actions}>
      {phase === 'rejected' ? <Button title="להתחבר מחדש" onPress={() => void login.startOver()} /> : null}
      {showWebView && phase !== 'capturing' ? (
        <Button title={failed ? 'לנסות שוב' : 'סיימתי להתחבר'} onPress={login.captureNow} />
      ) : null}
      <Button title={RENEW_COPY.notNow} variant="ghost" onPress={close} />
    </View>
  );

  return (
    <Sheet visible onClose={close} title={RENEW_COPY.title} footer={footer}>
      <Text style={[styles.note, { color: p.textMuted }]}>
        אם משוב מבקש להתחבר, אפשר להתחבר כאן, עם אותם פרטים כמו באתר של משוב. הסיסמה לא נשמרת אצלנו.
      </Text>

      {phase === 'rejected' ? (
        <Text style={[styles.note, { color: p.cancel, marginTop: space.md }]}>
          משוב לא אישר את הכניסה. בדרך כלל זה קורה כשנשארה כניסה ישנה, והתחברות מחדש מתחילה מההתחלה.
        </Text>
      ) : null}
      {notYet ? (
        <Text style={[styles.note, { color: p.textMuted, marginTop: space.md }]}>
          עוד לא רואים כניסה למשוב. צריך לסיים להתחבר באתר, ואז ללחוץ שוב.
        </Text>
      ) : null}
      {failed ? (
        <Text style={[styles.note, { color: p.cancel, marginTop: space.md }]}>לא הצלחנו לבדוק את החיבור מול משוב. אפשר לנסות שוב.</Text>
      ) : null}

      {phase === 'preparing' ? (
        <View style={[styles.web, styles.center, { height: webHeight, borderColor: p.border }]}>
          <ActivityIndicator color={p.accent} />
        </View>
      ) : null}

      {showWebView ? (
        <View style={[styles.web, { height: webHeight, borderColor: p.border }]} onTouchStart={login.onTouchStart}>
          {/* The sheet's body scrolls; the login page inside it must scroll too. */}
          <WebView key={login.webViewKey} {...login.webViewProps} nestedScrollEnabled style={{ flex: 1, backgroundColor: p.bg }} />
          {phase === 'capturing' ? (
            <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: p.bg, opacity: 0.96 }]}>
              <ActivityIndicator color={p.accent} />
              <Text style={[styles.note, { color: p.textMuted, marginTop: space.md }]}>בודקים את החיבור מול משוב…</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * The line for מצב חיבורים → משוב → "פרטים טכניים": "חידוש אוטומטי אחרון:
 * הצליח ב־9.10, 07:42", or "…: לא הצליח ב־9.10, 07:42", and why on a line
 * of its own ("נדרשה כניסה בהזדהות אחידה"). Nothing before the first attempt.
 * Pass the detail lines' style.
 */
export function MashovRenewDetail({ style }: { style?: StyleProp<TextStyle> }): React.JSX.Element | null {
  const detail = renewDetail(readRenewRecord());
  if (!detail) return null;
  return (
    <>
      <Text selectable style={style}>
        {`${detail.label}: ${detail.verdict}`}
        <Ltr style={style}>{shortDateTime(detail.at)}</Ltr>
      </Text>
      {detail.reason ? <Text selectable style={style}>{detail.reason}</Text> : null}
    </>
  );
}

/** Of the window's height, what the login page gets inside the sheet. */
const WEB_SHARE = 0.55;
const MIN_WEB_HEIGHT = 320;

const styles = StyleSheet.create({
  note: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  // The login page between two ruled lines, not in a box (plan §16.1).
  web: { marginTop: space.md, borderTopWidth: 1, borderBottomWidth: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
