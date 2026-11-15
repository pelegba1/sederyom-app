/**
 * The header every tab opens with, the app bar of plan §16.1 (`AppBar`): the
 * title in the display face, an optional subtitle line, and the bell
 * (notification log) and gear (settings) at the end, so settings are one tap
 * away from any tab (F19), not only from "היום שלי". The two are plain
 * 24-point icons, no tile and no border, each with a 48-point target.
 *
 *   <Screen>
 *     <TabHeader title="משימות" subtitle="3 פתוחות" />
 *     <ScrollView>…</ScrollView>
 *   </Screen>
 *
 * It sits as the first child of `Screen`, outside the scroll, and brings its
 * own padding. The bell carries a count of the notifications that arrived
 * since the log was last opened (W5-F, Itai: "אין שום נקודה על הפעמון"). The
 * dot that says a connected source needs attention moved to the gear, where
 * "מצב חיבורים" lives, unless `dot` says otherwise.
 *
 * The log is the phone's own (`notify/log.ts`, plan 2f): what this phone
 * showed, its own notes and the class's pushes alike.
 *
 * `buddies` (״היום״ and ״שבוע״ only, friends spec 2.1) puts the friends
 * button before the bell: two heads, opening the friends screen, with the
 * gear's dot on it while a friend arrived since that screen was last open.
 * Never on a parent's phone.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBuddies, useSettings, useStatus, useUnreadNotifications } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import { bellLabel, unreadBadge } from '../lib/unread';
import type { RootNavigation } from '../navigation/types';
import { font } from '../theme';
import { AppIcon } from './AppIcon';
import { AppBar } from './notebook';
import { Text, usePalette } from './ui';

export interface TabHeaderProps {
  title: string;
  /** A line under the title — a string, or a row with `Ltr` dates in it. */
  subtitle?: React.ReactNode;
  /** Forces the gear's dot on or off; by default it shows when a connection is not ok. */
  dot?: boolean;
  /** The friends button before the bell (״היום״ and ״שבוע״); never drawn for a parent. */
  buddies?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function TabHeader({ title, subtitle, dot, buddies = false, style }: TabHeaderProps): React.JSX.Element {
  const p = usePalette();
  const navigation = useNavigation<RootNavigation>();
  const status = useStatus();
  const needsAttention = (status.data?.sources ?? []).some((s) => s.configured && s.message !== null);
  const showDot = dot ?? needsAttention;
  const gearLabel = showDot ? 'הגדרות, יש חיבור שצריך לבדוק' : 'הגדרות';
  const unread = useUnreadNotifications();
  const badge = unreadBadge(unread);
  // Not before the settings say whose phone it is: a parent's never shows it, not even for a moment.
  const audience = useSettings().data?.settings.audience;
  const showBuddies = buddies && audience !== undefined && audience !== 'parent';

  const actions = (
    <>
      {showBuddies ? <BuddiesButton onPress={() => navigation.navigate('Buddies')} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bellLabel(unread)}
        onPress={() => navigation.navigate('Notifications')}
        style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppIcon name="bell" color={p.text} size={ICON} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: p.accent, borderColor: p.bg }]}>
            <Text maxScale={1} style={[styles.badgeText, { color: p.onAccent }]}>{badge}</Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gearLabel}
        onPress={() => navigation.navigate('Settings')}
        style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppIcon name="settings" color={p.text} size={ICON} />
        {showDot ? <View style={[styles.badgeDot, { backgroundColor: p.change, borderColor: p.bg }]} /> : null}
      </Pressable>
    </>
  );

  return <AppBar title={title} subtitle={subtitle} end={actions} style={style} />;
}

/** The friends button: its own component, so only the headers that draw it read the friends' model. */
function BuddiesButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const unseen = useBuddies().data?.unseen === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unseen ? BUDDY_COPY.titleUnseen : BUDDY_COPY.title}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppIcon name="people" color={p.text} size={ICON} />
      {unseen ? <View style={[styles.badgeDot, { backgroundColor: p.change, borderColor: p.bg }]} /> : null}
    </Pressable>
  );
}

/** The icons' size, and the square each one's target fills. */
const ICON = 24;
const TARGET = 48;

const styles = StyleSheet.create({
  iconButton: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  // On the icon's top end corner: the icon spans 12–36 of the 48-point target.
  badgeDot: { position: 'absolute', top: 10, insetInlineEnd: 10, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  badge: {
    position: 'absolute', top: 5, insetInlineEnd: 4, minWidth: 18, minHeight: 18, borderRadius: 9, borderWidth: 2,
    paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bodySemi, fontSize: 12, lineHeight: 14 },
});
