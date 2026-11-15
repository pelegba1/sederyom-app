/**
 * הגדרות (design panel 05, plan F14/F18/F19, R-24–R-26; the layout is in
 * `docs/superpowers/specs/2026-11-01-settings-reorg-design.md`). A short list
 * and no setting of its own: connection health, then a row for each page of
 * settings (notifications and times, who I am and my school, Google, what is
 * shown, appearance) with a line under its title saying how that group stands
 * now, then help; "הנתונים שלך" is the way to delete everything the phone
 * holds, and the version is the last line. Every setting is on a page of its
 * own under `settings/`.
 *
 * The notebook page (plan §16.1): ruled rows on the page, edge to edge — a
 * chevron row opens a screen. No cards and no boxes. The line under a group
 * is red only when the phone refuses notifications.
 *
 * In the demo (`demo/mode.ts`) a quiet line at the top says so, the
 * connections read "הדגמה", and "לצאת מההדגמה" stands where "מחק את הנתונים
 * שלי" is: there is nothing of anyone's to delete.
 *
 * The pieces it shares with the pages (the switch row, the section) are in `settings/`.
 */
import Constants from 'expo-constants';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { SettingsResponse } from '@sederyom/shared';
import { useChildren, useOnlyChildName, useStatus } from '../api/hooks';
import { Row, ROW_GUTTER } from '../components/notebook';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { Button, Text, usePalette, useTextScalePreference, useThemePreference } from '../components/ui';
import { connectionCards, connectionSummary, isConnected } from '../lib/connections';
import { SETTINGS_PAGE_TITLES, THEME_LABELS, mePageTitle, settingsCounts } from '../lib/onboarding';
import {
  appearanceSummary, googleSummary, meSummary, notificationsSummary, shownChildName, shownSummary, type SummaryLine,
} from '../lib/settingsSummary';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { deletableSchoolCalendar, deleteMyDataNow, leaveDemoNow } from '../local/deleteMyDataRun';
import { TEXT_SCALE_LABELS, font, space, type } from '../theme';
import { WRAPPED_COPY } from '../wrapped/copy';
import type { RootNavigation } from '../navigation/types';
import { useNotificationPermission } from './settings/permission';
import { Section, SettingsPage, SwitchRow, shownToggles } from './settings/parts';

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function SettingsScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  return <SettingsPage>{(data) => <SettingsRows data={data} navigation={navigation} />}</SettingsPage>;
}

/** The rows, in a component of their own: `SettingsPage` calls its children as a function, where hooks cannot live. */
function SettingsRows({ data, navigation }: { data: SettingsResponse; navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const demo = isDemo();
  const s = data.settings;
  const parent = s.audience === 'parent';
  const status = useStatus();
  const permission = useNotificationPermission();
  const listName = useChildren().data?.list.find((c) => c.shown)?.name ?? null;
  const [onlyChildName] = useOnlyChildName();
  // A parent's phone calls the child by the parent's name (the list's, or the only child's), not by the class's.
  const shownChild = shownChildName({ parent, listName, onlyName: onlyChildName });
  const theme = useThemePreference();
  const textSize = useTextScalePreference();
  const counts = settingsCounts(data);

  const notifications = notificationsSummary({
    permission: permission.state,
    vacation: s.vacationMode,
    shown: shownToggles(parent),
    on: s.notifications,
    quiet: s.quietHours,
  });
  const me = meSummary({ parent, className: s.className, shownChild });
  const google = googleSummary({
    // Calendar and Tasks are one account: the same merged card as on מצב חיבורים.
    connected: isConnected(connectionCards(status.data?.sources ?? []).find((c) => c.id === 'google')?.source),
    // The demo writes nothing to Google.
    examsToCalendar: demo ? false : s.examsToCalendar,
    calendarsShown: counts.calendars,
    hasCalendars: data.calendars.length > 0,
  });
  const shown = shownSummary({
    subjects: counts.subjects,
    hasSubjects: data.subjects.length > 0,
    exams: counts.exams,
    hasExams: data.exams.length > 0,
  });
  const appearance = appearanceSummary(THEME_LABELS[theme.preference], TEXT_SCALE_LABELS[textSize.scale]);

  return (
    <>
      {/* Quiet, at the top: what the demo is, and the way out at the end (`LeaveDemoRow`). */}
      {demo ? (
        <View style={[styles.gutter, styles.demo]}>
          <Text style={[styles.demoTitle, { color: p.text }]}>{DEMO_COPY.marker}</Text>
          <Text style={[styles.hint, { color: p.textMuted }]}>{DEMO_COPY.markerLine}</Text>
        </View>
      ) : null}
      <ConnectionsRow demo={demo} onPress={() => navigation.navigate('Connections')} />
      <PageRow title={SETTINGS_PAGE_TITLES.notifications} line={notifications} onPress={() => navigation.navigate('SettingsNotifications')} />
      <PageRow title={mePageTitle(parent)} line={{ text: me, tone: 'muted' }} onPress={() => navigation.navigate('SettingsMe')} />
      <PageRow title={SETTINGS_PAGE_TITLES.google} line={status.data ? { text: google, tone: 'muted' } : null} onPress={() => navigation.navigate('SettingsGoogle')} />
      <PageRow title={SETTINGS_PAGE_TITLES.shown} line={{ text: shown, tone: 'muted' }} onPress={() => navigation.navigate('SettingsShown')} />
      <PageRow title={SETTINGS_PAGE_TITLES.appearance} line={{ text: appearance, tone: 'muted' }} onPress={() => navigation.navigate('SettingsAppearance')} />
      {/* The year so far (סיכום שנה): the student's own, so not on a parent's phone; the demo has no year behind it. */}
      {parent || demo ? null : (
        <Row
          title={WRAPPED_COPY.settingsRow}
          subtitle={WRAPPED_COPY.settingsLine}
          chevron
          accessibilityLabel={WRAPPED_COPY.settingsRow}
          accessibilityHint={WRAPPED_COPY.settingsLine}
          onPress={() => navigation.navigate('Wrapped')}
        />
      )}
      <Row
        title="עזרה ופרטיות"
        subtitle="מה יש בכל מסך, מה נשמר ואיך מנתקים"
        chevron
        accessibilityLabel="עזרה ופרטיות"
        accessibilityHint="מה יש בכל מסך, מה נשמר ואיך מנתקים"
        onPress={() => navigation.navigate('Help')}
      />

      <Section title="הנתונים שלך">
        {demo ? <LeaveDemoRow navigation={navigation} /> : <DeleteDataRow navigation={navigation} />}
      </Section>

      <Text style={[styles.hint, styles.gutter, { color: p.textMuted, textAlign: 'center' }]}>
        {`סדר יום ${Constants.expoConfig?.version ?? ''}`}
      </Text>
    </>
  );
}

/** A group of settings: its title, the one line saying how it stands now (red when `attention`; none while it is not known yet), and the page behind it. */
function PageRow({ title, line, onPress }: { title: string; line: SummaryLine | null; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Row
      title={title}
      subtitle={line === null
        ? undefined
        : line.tone === 'attention'
          ? <Text style={[styles.hint, styles.shrink, { color: p.cancel }]}>{line.text}</Text>
          : line.text}
      chevron
      accessibilityLabel={line === null ? title : `${title}: ${line.text}`}
      onPress={onPress}
    />
  );
}

/**
 * "מחק את הנתונים שלי" (plan Phase 3): a row, and a sheet that says what goes
 * before anything does (`local/deleteMyData.ts`). The "בית ספר" calendar is
 * the student's choice, on by default, and offered only when there is one
 * this phone made and can still reach. Done, the app starts over at the
 * welcome screen, as if just installed.
 */
function DeleteDataRow({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const schoolCalendar = open ? deletableSchoolCalendar() : null;

  const close = (): void => {
    if (busy) return;
    setOpen(false);
    setFailed(false);
  };

  const confirm = (): void => {
    setBusy(true);
    setFailed(false);
    deleteMyDataNow({ calendar: calendar && schoolCalendar !== null })
      .then((outcome) => {
        qc.clear();
        setOpen(false);
        navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
        // Said on the welcome screen: this one is gone, and a toast tied to it would be dropped.
        toast.show(
          outcome.calendarKept ? DELETE_COPY.doneCalendarKept : DELETE_COPY.done,
          { outlivesScreen: true, ...(outcome.calendarKept ? { durationMs: 6000 } : {}) },
        );
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Row
        title="מחק את הנתונים שלי"
        titleStyle={{ color: p.cancel }}
        subtitle="הכול מהטלפון, והרישום שלו אצל סדר יום"
        accessibilityLabel="מחק את הנתונים שלי"
        onPress={() => setOpen(true)}
      />
      <Sheet
        visible={open}
        onClose={close}
        dismissable={!busy}
        title="למחוק את הנתונים שלך?"
        footer={(
          <View style={styles.sheetActions}>
            <Button title={busy ? 'מוחקים…' : 'למחוק הכול'} variant="danger" disabled={busy} onPress={confirm} />
            <Button title="ביטול" variant="ghost" disabled={busy} onPress={close} />
          </View>
        )}
      >
        <Text style={[styles.sheetText, { color: p.text }]}>{DELETE_COPY.what}</Text>
        <Text style={[styles.sheetText, { color: p.textMuted, marginTop: space.md }]}>{DELETE_COPY.after}</Text>
        {schoolCalendar ? (
          <View style={{ marginTop: space.md }}>
            <SwitchRow
              label="למחוק גם את יומן ״בית ספר״ מ־Google"
              hint="המשימות שלך ב־Google נשארות"
              value={calendar}
              disabled={busy}
              onChange={setCalendar}
            />
          </View>
        ) : null}
        {failed ? (
          <Text accessibilityLiveRegion="polite" style={[styles.sheetText, { color: p.cancel, marginTop: space.md }]}>{DELETE_COPY.failed}</Text>
        ) : null}
      </Sheet>
    </>
  );
}

/**
 * "לצאת מההדגמה": everything the demo kept goes from the phone, and the app
 * starts over at the welcome screen, as after "מחק את הנתונים שלי". Nothing to
 * confirm: all of it was made up.
 */
function LeaveDemoRow({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const leave = (): void => {
    setBusy(true);
    leaveDemoNow()
      .then(() => {
        qc.clear();
        navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
        // Said on the welcome screen, as after "מחק את הנתונים שלי".
        toast.show(DEMO_COPY.leaveDone, { outlivesScreen: true });
      })
      .catch(() => setBusy(false));
  };
  return (
    <Row
      title={DEMO_COPY.leave}
      subtitle={DEMO_COPY.leaveLine}
      accessibilityRole="button"
      accessibilityLabel={DEMO_COPY.leave}
      accessibilityHint={DEMO_COPY.leaveLine}
      disabled={busy}
      onPress={leave}
    />
  );
}

const DELETE_COPY = {
  what: 'יימחקו מהטלפון ההגדרות, מה שהגיע ממשוב ומ־Google, סימוני ״עשיתי״, המבחנים שהוספת וההתראות, וגם הרישום של הטלפון אצל סדר יום.',
  after: 'האפליקציה תתנתק ממשוב ומ־Google ותחזור למסך הפתיחה. אי אפשר לבטל את זה.',
  failed: 'לא הצלחנו למחוק. צריך חיבור לאינטרנט, ואפשר לנסות שוב.',
  done: 'הנתונים נמחקו',
  doneCalendarKept: 'הנתונים נמחקו. את יומן ״בית ספר״ לא הצלחנו למחוק, ואפשר למחוק אותו ב־Google',
} as const;

/** One line about all connections, and the way into the full screen: a dot in the status's colour, the words beside it. */
function ConnectionsRow({ demo, onPress }: { demo: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const status = useStatus();
  // The demo's connections are all there and none is real: neither "הכול מחובר" nor a warning.
  const summary = demo ? { text: DEMO_COPY.connectionsRow, tone: 'neutral' as const } : connectionSummary(status.data?.sources ?? []);
  const tone = summary.tone === 'ok' ? p.ok : summary.tone === 'attention' ? p.cancel : p.textMuted;
  return (
    <Row
      title="מצב חיבורים"
      subtitle={(
        <>
          <View style={[styles.statusDot, { backgroundColor: tone }]} />
          <Text style={[styles.hint, styles.shrink, { color: summary.tone === 'attention' ? p.cancel : p.textMuted }]}>{summary.text}</Text>
        </>
      )}
      chevron
      accessibilityLabel={`מצב חיבורים: ${summary.text}`}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  hint: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  sheetText: { fontFamily: font.body, fontSize: type.body, lineHeight: 24 },
  sheetActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  shrink: { flexShrink: 1 },
  demo: { paddingTop: space.lg, paddingBottom: space.md, gap: 2 },
  demoTitle: { fontFamily: font.bodySemi, fontSize: type.body, lineHeight: 22 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
});
