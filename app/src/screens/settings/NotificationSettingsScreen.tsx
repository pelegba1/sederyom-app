/**
 * התראות וזמנים: what the phone may tell the student and when. The switches
 * for each kind of notification (under the one notice about the phone's own
 * permission), the morning summary and evening reminder times with the quiet
 * hours, and vacation mode, which stops the school's notifications until it is
 * turned off. They were three groups on the one long Settings screen; they
 * are the same decision ("when do I get bothered"), so they share a page.
 *
 * While the phone does not allow notifications, the switches are drawn
 * disabled and a press on one asks the phone, as "להדליק" does (see
 * `settings/permission.tsx`).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { NotificationType, SettingsResponse } from '@sederyom/shared';
import { NOTIFICATION_LABELS } from '@sederyom/shared';
import { Row, ROW_GUTTER } from '../../components/notebook';
import { Text, usePalette } from '../../components/ui';
import { NOTIFICATION_SWITCH_LABELS, QUIET_HOURS_HINT } from '../../lib/onboarding';
import { isWithinQuietHours } from '../../lib/timeOfDay';
import { font, space, type } from '../../theme';
import type { RootNavigation } from '../../navigation/types';
import { NotificationPermissionNotice, PERMISSION_SWITCH_HINT, useNotificationPermission } from './permission';
import { Section, SettingsPage, shownToggles, SwitchRow, usePatch } from './parts';
import { TimeField } from './time';

export function NotificationSettingsScreen(_props: { navigation: RootNavigation }): React.JSX.Element {
  return <SettingsPage>{(data) => <NotificationRows data={data} />}</SettingsPage>;
}

function NotificationRows({ data }: { data: SettingsResponse }): React.JSX.Element {
  const p = usePalette();
  const permission = useNotificationPermission();
  const { patch, busy } = usePatch();
  const s = data.settings;
  const quiet = s.quietHours;
  const eveningMuted = quiet.enabled && isWithinQuietHours(s.eveningReminderTime, quiet.from, quiet.to);
  // A parent's phone has none of what only the student's Mashov brings (docs/parents-plan.md).
  const parent = s.audience === 'parent';

  return (
    <>
      <Section title="התראות">
        {permission.state === 'checking' ? null : (
          <View style={[styles.gutter, styles.notice]}>
            <NotificationPermissionNotice permission={permission} />
          </View>
        )}
        {shownToggles(parent).map((t: NotificationType) => (
          <SwitchRow
            key={t}
            label={NOTIFICATION_SWITCH_LABELS[t] ?? NOTIFICATION_LABELS[t]}
            value={Boolean(s.notifications[t])}
            busy={busy}
            disabled={permission.state === 'off'}
            disabledHint={PERMISSION_SWITCH_HINT}
            onDisabledPress={permission.busy ? undefined : permission.enable}
            onChange={(value) => patch({ notifications: { [t]: value } })}
          />
        ))}
        <Text style={[styles.note, styles.gutter, { color: p.textMuted }]}>על תקלות בחיבור תמיד נודיע לך.</Text>
      </Section>

      <Section title="זמנים">
        <Row
          title="סיכום בוקר"
          subtitle="בימי לימודים"
          end={<TimeField label="שעת סיכום הבוקר" value={s.morningSummaryTime} onChange={(v) => patch({ morningSummaryTime: v })} />}
        />
        <Row
          title="תזכורת ערב"
          subtitle={eveningMuted
            ? <Text style={[styles.hint, styles.shrink, { color: p.cancel }]}>השעה הזאת בתוך השעות השקטות, אז התזכורת לא תישלח</Text>
            : 'מה להגיש ביום הלימודים הבא, רק כשיש מה להגיש'}
          end={<TimeField label="שעת תזכורת הערב" value={s.eveningReminderTime} onChange={(v) => patch({ eveningReminderTime: v })} />}
        />
        {/* One line for what used to be two paragraphs (Itai: "לא קראתי"). */}
        <SwitchRow
          label="שעות שקטות"
          hint={QUIET_HOURS_HINT}
          value={quiet.enabled}
          busy={busy}
          onChange={(value) => patch({ quietHours: { enabled: value } })}
        />
        <Row>
          <View style={[styles.rangeRow, { opacity: quiet.enabled ? 1 : 0.45 }]}>
            <Text style={[styles.rangeLabel, { color: p.textMuted }]}>משעה</Text>
            <TimeField label="תחילת השעות השקטות" value={quiet.from} disabled={!quiet.enabled} onChange={(v) => patch({ quietHours: { from: v } })} />
            <Text style={[styles.rangeLabel, { color: p.textMuted }]}>עד</Text>
            <TimeField label="סוף השעות השקטות" value={quiet.to} disabled={!quiet.enabled} onChange={(v) => patch({ quietHours: { to: v } })} />
          </View>
          {quiet.enabled && quiet.from === quiet.to ? (
            <Text style={[styles.hint, { color: p.cancel }]}>שעת ההתחלה ושעת הסיום זהות, אז אין שעות שקטות.</Text>
          ) : null}
        </Row>
      </Section>

      <Section title="חופש">
        <SwitchRow
          label="מצב חופש"
          hint="עוצר את ההתראות מבית הספר עד שמכבים אותו"
          value={s.vacationMode}
          busy={busy}
          onChange={(value) => patch({ vacationMode: value })}
        />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  notice: { paddingBottom: space.md },
  hint: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  shrink: { flexShrink: 1 },
  note: { fontFamily: font.body, fontSize: type.small, marginTop: space.md, lineHeight: 20 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.sm },
  rangeLabel: { fontFamily: font.body, fontSize: type.body },
});
