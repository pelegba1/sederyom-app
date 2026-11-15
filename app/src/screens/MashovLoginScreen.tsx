/**
 * Mashov session capture (design-doc §6.3) — the app side of Spike 1.
 *
 * The human logs in through הזדהות אחידה inside this WebView, including OTP.
 * When the flow lands back inside Mashov we read the cookie jar (the auth
 * cookies are HttpOnly, so `document.cookie` is not enough — CookieManager is)
 * and POST the session to the backend, which replays it from the server.
 *
 * The login is four steps, not two: הזדהות אחידה → redirect back →
 * `GET /api/idm/token` → `GET /api/idm/login/{schoolId}/{year}`. Only after that
 * last call does `MashovAuthToken` exist, and it is an XHR — invisible to a
 * navigation listener. So capture waits for that cookie to actually appear in
 * the jar, never for "the URL looks like we are back in Mashov", and a manual
 * button is always on screen so a missed auto-detect costs one tap.
 *
 * The flow itself lives in `useMashovCapture`, shared with the renewal sheet
 * the app opens by itself when Mashov disconnects (W6-1). This screen stays
 * the way in from מצב חיבורים, onboarding and the strip on "היום שלי".
 *
 * The server does not just store what it is sent: it polls Mashov with the new
 * session before answering, and this screen shows *that* verdict. "ההתחברות
 * הושלמה" used to mean "the POST returned 200" — while the settings screen
 * kept saying "לא מחובר", because nothing had polled yet.
 *
 * The words (plan F2, F7): no expiry time on success — the cookie's own `exp`
 * made people think they would log in every hour — just "מחובר למשוב", with a
 * drawn tick, and the promise of a notification if Mashov disconnects. Raw
 * errors sit under "פרטים טכניים".
 *
 * On the page (plan §16.1): a heading with a ruled line under it, and the
 * "סיימתי להתחבר" line docked under the login page, not a box over it.
 *
 * On a parent's phone (parents mode, stage 3) the parent logs in with the
 * parent's own details, and the words say so. After the login: the children
 * Mashov listed, by first name, and the parents' check, which runs by itself.
 * A login that does not go through can be reported all the same: what the
 * page saw of Mashov's answers is in the check's report.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { AppIcon } from '../components/AppIcon';
import { ROW_GUTTER } from '../components/notebook';
import { ParentCheckPanel } from '../components/ParentCheckPanel';
import { Button, Ltr, Screen, Text, usePalette } from '../components/ui';
import { NOT_YET, useMashovCapture } from '../components/useMashovCapture';
import { CONNECTION_COPY, PARENT_MASHOV_COPY, PARENT_SCHOOLS_COPY } from '../lib/connections';
import { holdLoginScreen } from '../lib/mashovRenew';
import { linkChild, shownMashovLink } from '../local/children';
import { askOptionLabel, readErrorNow, scanSummary } from '../local/childrenFromMashov';
import { userSettings } from '../local/userSettings';
import { runParentCheckNow } from '../mashov/parentCheckRun';
import { runParentScanNow, type ParentScanResult } from '../mashov/parentScanRun';
import { mashovChildren } from '../mashov/parents';
import { readMashovSoon } from '../mashov/sync';
import { storage } from '../widget/feedCache';
import { font, space, type } from '../theme';
import type { RootNavigation } from '../navigation/types';
import { Disclosure } from './ConnectionsScreen';

export function MashovLoginScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const login = useMashovCapture();
  const { phase, error, result } = login;
  // Read once: who the phone is for does not change while this screen is open.
  const [parent] = useState(() => userSettings().audience === 'parent');
  const [reporting, setReporting] = useState(false);

  // While this screen is open, the renewal sheet does not open a second login on top of it.
  useEffect(() => holdLoginScreen(), []);

  const showWebView = phase === 'loading' || phase === 'login' || phase === 'capturing' || phase === 'failed';

  const notYet = phase === 'failed' && error === NOT_YET;

  /** A parent's login that did not go through: the check's report, of what the page saw, straight to the share sheet. */
  const sendReport = (): void => {
    setReporting(true);
    void runParentCheckNow()
      .then((check) => Share.share({ message: check.text }))
      .catch(() => undefined)
      .finally(() => setReporting(false));
  };
  const reportButton = parent ? (
    <Button title={reporting ? PARENT_MASHOV_COPY.checkRunning : PARENT_MASHOV_COPY.reportNow} variant="ghost" disabled={reporting} onPress={sendReport} />
  ) : null;

  return (
    <Screen>
      {/* On the page, with a ruled line under it: no strip of another colour. */}
      <View style={[styles.banner, { borderBottomColor: p.border }]}>
        <Text accessibilityRole="header" style={{ fontFamily: font.bodySemi, fontSize: type.title, color: p.text }}>
          {parent ? PARENT_MASHOV_COPY.loginTitle : 'התחברות למשוב'}
        </Text>
        <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, marginTop: 2, lineHeight: 20 }}>
          {parent ? PARENT_MASHOV_COPY.loginLead : 'מתחברים עם אותם פרטים כמו באתר של משוב. את הסיסמה מקלידים רק שם, והיא לא נשמרת אצלנו.'}
        </Text>
      </View>

      {phase === 'preparing' ? (
        <View style={styles.center}>
          <ActivityIndicator color={p.accent} />
        </View>
      ) : null}

      {phase === 'verified' && result && parent ? (
        <ScrollView contentContainerStyle={styles.parentDone}>
          <View accessible accessibilityRole="header" accessibilityLabel="מחובר למשוב" style={styles.verified}>
            <AppIcon name="check" color={p.ok} size={28} />
            <Text style={{ fontFamily: font.headingSemi, fontSize: type.heading, color: p.ok }}>מחובר למשוב</Text>
          </View>
          <Text style={[styles.centerText, { color: p.text, marginTop: space.sm }]}>{CONNECTION_COPY.mashovVerified}</Text>
          <ParentFound error={result.error} scan={login.scan} />
          <View style={{ marginTop: space.xl }}>
            <Button title="סיום" onPress={() => navigation.goBack()} />
          </View>
          <View style={{ alignSelf: 'stretch' }}>
            <ParentCheckPanel autoRun />
          </View>
        </ScrollView>
      ) : null}

      {phase === 'verified' && result && !parent ? (
        <View style={styles.center}>
          {/* The tick is drawn (plan §16.2), beside the words. */}
          <View accessible accessibilityRole="header" accessibilityLabel="מחובר למשוב" style={styles.verified}>
            <AppIcon name="check" color={p.ok} size={28} />
            <Text style={{ fontFamily: font.headingSemi, fontSize: type.heading, color: p.ok }}>מחובר למשוב</Text>
          </View>
          <Text style={[styles.centerText, { color: p.text, marginTop: space.sm }]}>{CONNECTION_COPY.mashovVerified}</Text>
          {/* No count of "items updated": Maya asked who read what, and why only 2. */}
          <Text style={[styles.centerText, { color: p.textMuted, marginTop: space.sm }]}>{CONNECTION_COPY.mashovArrived}</Text>
          <View style={{ marginTop: space.xl }}>
            <Button title="סיום" onPress={() => navigation.goBack()} />
          </View>
        </View>
      ) : null}

      {phase === 'rejected' ? (
        <View style={styles.center}>
          <Text accessibilityRole="header" style={{ fontFamily: font.headingSemi, fontSize: type.heading - 2, color: p.cancel, textAlign: 'center' }}>
            משוב לא אישר את הכניסה
          </Text>
          <Text style={[styles.centerText, { color: p.textMuted, marginTop: space.sm }]}>
            בדרך כלל זה קורה כשנשארה כניסה ישנה. התחברות מחדש מתחילה מההתחלה, וזה לוקח דקה.
          </Text>
          <View style={{ marginTop: space.xl, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md }}>
            <Button title="להתחבר מחדש" onPress={() => void login.startOver()} />
            <Button title="חזרה" variant="ghost" onPress={() => navigation.goBack()} />
            {reportButton}
          </View>
          {error ? (
            <Disclosure title="פרטים טכניים" style={{ marginTop: space.lg, alignSelf: 'stretch' }}>
              <Text selectable style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 20 }}>
                <Ltr>{error}</Ltr>
              </Text>
            </Disclosure>
          ) : null}
        </View>
      ) : null}

      {showWebView ? (
        <>
          <View style={{ flex: 1 }} onTouchStart={login.onTouchStart}>
            <WebView key={login.webViewKey} {...login.webViewProps} style={{ flex: 1, backgroundColor: p.bg }} />
          </View>
          {phase === 'capturing' ? (
            <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: p.bg }]}>
              <ActivityIndicator color={p.accent} />
              <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, marginTop: space.md }}>בודקים את החיבור מול משוב…</Text>
            </View>
          ) : null}
          {/* Always available: if the auto-detect misses, one tap still works. Docked under the
              login page on a ruled line, not a box floating over it. */}
          {phase !== 'capturing' ? (
            <View style={[styles.manualBar, { backgroundColor: p.bg, borderTopColor: p.border, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
              <Text style={{ fontFamily: font.body, fontSize: type.small, color: phase === 'failed' && !notYet ? p.cancel : p.textMuted, lineHeight: 20 }}>
                {notYet
                  ? 'עוד לא רואים כניסה למשוב. צריך לסיים להתחבר באתר, ואז ללחוץ שוב.'
                  : phase === 'failed'
                    ? 'לא הצלחנו לבדוק את החיבור מול משוב. אפשר לנסות שוב.'
                    : 'סיימת להתחבר והמסך לא ממשיך מעצמו? אפשר ללחוץ כאן.'}
              </Text>
              {phase === 'failed' && !notYet && error ? (
                <Disclosure title="פרטים טכניים">
                  <Text selectable style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 20 }}>
                    <Ltr>{error}</Ltr>
                  </Text>
                </Disclosure>
              ) : null}
              <Button
                title={phase === 'failed' && !notYet ? 'לנסות שוב' : 'סיימתי להתחבר'}
                variant="ghost"
                onPress={login.captureNow}
              />
              {reportButton}
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

/**
 * After a parent's login: the children Mashov listed, by first name, how many
 * of them the scan added and why any were not, a question for each phone
 * child Mashov may list as more than one, and what is read now. When the
 * child on screen is not in the list, the reason instead (`PARENT_READ_COPY`):
 * the login itself went through.
 *
 * Answering a question links the phone's child to the one picked and reads it
 * at once; the other questions drop that child from their choices, since one
 * Mashov child is one phone child. A scan follows, so a twin not picked is
 * added now and not at the next login.
 */
function ParentFound({ error: loginError, scan }: { error: string | null; scan: ParentScanResult | null }): React.JSX.Element {
  const p = usePalette();
  // Read on every draw: answering a question links the child on screen, which ends "Mashov did not find" at once.
  const error = readErrorNow(loginError, shownMashovLink(storage) !== null);
  const [answered, setAnswered] = useState<{ childIds: string[]; guids: string[] }>({ childIds: [], guids: [] });
  // Every child Mashov listed at the schools the scan read; without a scan, the last list the phone kept.
  const listed = scan ? scan.schools.schools.flatMap((s) => s.children) : mashovChildren(storage)?.list ?? [];
  const names = [...new Set(listed.map((c) => c.firstName).filter(Boolean))];
  const summary = scan ? scanSummary(scan) : null;
  const questions = (scan?.plan.ask ?? [])
    .filter((q) => !answered.childIds.includes(q.childId))
    .map((q) => ({ ...q, options: q.options.filter((o) => !answered.guids.includes(o.guid)) }))
    .filter((q) => q.options.length > 0);
  const choose = (childId: string | 'shown', option: { guid: string; semel: string }): void => {
    linkChild(storage, childId, { guid: option.guid, semel: option.semel });
    readMashovSoon(storage);
    // Not waited for: the screen has what it says already, and a scan that fails waits for the next login.
    void runParentScanNow().catch(() => undefined);
    setAnswered((now) => ({ childIds: [...now.childIds, childId], guids: [...now.guids, option.guid] }));
  };
  return (
    <>
      {names.length > 0 ? <Text style={[styles.centerText, { color: p.text, marginTop: space.sm }]}>{PARENT_MASHOV_COPY.found(names)}</Text> : null}
      {summary?.added ? <Text style={[styles.centerText, { color: p.ok, marginTop: space.sm }]}>{summary.added}</Text> : null}
      {summary?.lines.map((line, i) => (
        <Text key={`${i}|${line}`} style={[styles.centerText, { color: p.textMuted, marginTop: space.xs }]}>{line}</Text>
      ))}
      {questions.map((q) => (
        <View key={q.childId} style={styles.question}>
          <Text accessibilityRole="header" style={[styles.centerText, { color: p.text }]}>{PARENT_SCHOOLS_COPY.whoIs(q.className)}</Text>
          {q.options.map((o) => (
            <Button key={o.guid} title={askOptionLabel(o)} variant="ghost" onPress={() => choose(q.childId, o)} />
          ))}
        </View>
      ))}
      <Text style={[styles.centerText, { color: error ? p.cancel : p.textMuted, marginTop: space.sm }]}>{error ?? PARENT_MASHOV_COPY.arrived}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: ROW_GUTTER, paddingVertical: space.md, borderBottomWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  parentDone: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  centerText: { fontFamily: font.body, fontSize: type.small, textAlign: 'center', lineHeight: 21 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  question: { alignSelf: 'stretch', marginTop: space.lg, gap: space.sm },
  overlay: { alignItems: 'center', justifyContent: 'center', opacity: 0.96 },
  manualBar: {
    paddingHorizontal: ROW_GUTTER, paddingTop: space.md, paddingBottom: space.lg, gap: space.xs, borderTopWidth: 1,
  },
});
