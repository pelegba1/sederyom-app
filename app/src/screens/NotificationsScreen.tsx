/**
 * יומן התראות (design panel 05): every notification this phone showed, its
 * own notes and the class's pushes, grouped by day, newest first. Answers
 * "did I miss something?" from the log the phone keeps (`notify/log.ts`, plan
 * 2f), which starts empty on the version that brought it.
 * A row opens the same screen its push opened (plan A6, F12).
 *
 * A list of times, so it is a page with the red margin (plan §16.1): each day
 * under its heading, and each push a ruled row with its time and its kind's
 * icon in the margin. No cards.
 *
 * Opening it marks everything seen (W5-13), so the number on every bell
 * clears at once; what was new when it opened stays marked "חדש" here until
 * it is left.
 *
 * A connection problem that is over by now (run 7, Maya: an old "צריך
 * להתחבר שוב" opened Mashov's login while Mashov was connected) says "סודר",
 * with a drawn tick, and opens מצב חיבורים (`isSettled`).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NotificationLogEntry } from '@sederyom/shared';
import { useMarkNotificationsSeen, useNotificationLog, useStatus } from '../api/hooks';
import { AppIcon } from '../components/AppIcon';
import { MarginList, MarginRow, Mark, ROW_GUTTER, SectionHeading } from '../components/notebook';
import { EmptyState, ErrorState, Loading, Ltr, Screen, Text, usePalette } from '../components/ui';
import { formatShortDate, timeOf } from '../lib/format';
import { SETTLED_WORD, groupLogByDay, isNewSince, isSettled, logRowText, notificationLook, routeForLogEntry, type Tone } from '../lib/notifications';
import { getNotificationsSeenAt } from '../lib/prefs';
import { navigateToRoute } from '../push/handlers';
import type { RootNavigation } from '../navigation/types';
import { font, space, type, type Palette } from '../theme';
import { LOAD_ERROR_TEXT } from './ConnectionsScreen';

export function NotificationsScreen(): React.JSX.Element {
  const p = usePalette();
  const navigation = useNavigation<RootNavigation>();
  const log = useNotificationLog();
  const markSeen = useMarkNotificationsSeen();
  // What is connected now: a connection problem that is over says so, and opens מצב חיבורים.
  const sources = useStatus().data?.sources ?? null;
  // When the log was last seen before this visit: rows sent after it are "חדש".
  const [newSince, setNewSince] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setNewSince(getNotificationsSeenAt());
      markSeen();
      // Whatever arrived while the log was open was seen as well.
      return () => markSeen();
    }, [markSeen]),
  );

  const groups = useMemo(() => groupLogByDay(log.data?.items ?? []), [log.data]);

  if (log.isLoading) return <Screen><Loading /></Screen>;
  if (log.isError || !log.data) {
    return (
      <Screen>
        <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void log.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={log.isFetching} onRefresh={() => void log.refetch()} tintColor={p.accent} />}
      >
        {groups.length === 0 ? (
          <EmptyState
            icon="bell"
            text="עדיין לא הגיעו התראות. כל התראה שתגיע תופיע כאן."
            action={{ label: 'לבחור אילו התראות לקבל', onPress: () => navigation.navigate('SettingsNotifications') }}
          />
        ) : (
          groups.map((group) => (
            <View key={group.date} style={styles.group}>
              <View style={styles.gutter}>
                <SectionHeading
                  end={<Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted, fontVariant: ['tabular-nums'] }}>{formatShortDate(group.date)}</Ltr>}
                >
                  {group.label}
                </SectionHeading>
              </View>
              <MarginList style={[styles.list, { borderTopColor: p.border }]}>
                {group.items.map((item) => (
                  <LogRow
                    key={item.id}
                    item={item}
                    fresh={isNewSince(item, newSince)}
                    settled={isSettled(item, sources)}
                    onPress={() => navigateToRoute(navigation, routeForLogEntry(item, sources))}
                  />
                ))}
              </MarginList>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/** A kind's ink: the colour of its icon, and of its label when the title does not say it. */
function toneColor(tone: Tone, p: Palette): string {
  switch (tone) {
    case 'change':
      return p.change;
    case 'cancel':
      return p.cancel;
    case 'exam':
      return p.exam;
    case 'ok':
      return p.ok;
    case 'accent':
      return p.accent;
    default:
      return p.textMuted;
  }
}

function LogRow({
  item, fresh, settled, onPress,
}: { item: NotificationLogEntry; fresh: boolean; settled: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const look = notificationLook(item);
  // Settled: the red of a problem goes, and one word says it is over.
  const tone = toneColor(settled ? 'neutral' : look.tone, p);
  const label = settled ? null : look.label;
  const time = timeOf(item.sentAt);
  const text = logRowText(item);

  return (
    <MarginRow
      // The time in the margin, and the kind's icon under it (Daniel: the kind leads the row).
      margin={(
        <View style={styles.margin}>
          <Ltr style={[styles.time, { color: p.textMuted }]}>{time}</Ltr>
          <AppIcon name={look.icon} color={tone} size={18} />
        </View>
      )}
      title={fresh ? <><Mark kind="mark" inline>חדש</Mark>{' '}{text.title}</> : text.title}
      titleLines={2}
      chevron
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[fresh ? 'חדש' : null, item.title, settled ? 'סודר' : null, item.body, label, time].filter(Boolean).join(', ')}
      accessibilityHint="פותח את המסך המתאים"
    >
      {text.body ? (
        <Text style={[styles.body, { color: p.textMuted }]} numberOfLines={5}>{text.body}</Text>
      ) : null}
      {settled ? (
        <View style={styles.settled}>
          <AppIcon name="check" color={p.ok} size={16} />
          <Text style={[styles.label, { color: p.ok }]}>{SETTLED_WORD}</Text>
        </View>
      ) : null}
      {label ? <Text style={[styles.label, { color: tone }]}>{label}</Text> : null}
    </MarginRow>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.lg, paddingBottom: 60 },
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  group: { marginBottom: space.xl },
  list: { borderTopWidth: 1 },
  margin: { alignItems: 'center', gap: space.xs },
  time: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  body: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  settled: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontFamily: font.bodySemi, fontSize: type.small },
});
