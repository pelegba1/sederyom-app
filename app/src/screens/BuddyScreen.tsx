/**
 * A friend's page (friends spec 2.4; sketch 1-layout.html, option 1, and
 * 2-details.html, cards 2 and 3), opened from a row of the friends screen, or
 * from a line on Today with that line's date.
 *
 * - The header: the friend's name as the screen's title; under it, at the
 *   start, the day shown and their class (״יום שני 2.11, י״א 3״), or what the
 *   tab covers; at the end the ״שיתוף״ chip, which opens their settings
 *   (`BuddySettingsSheet`). Ending the friendship there comes back to the
 *   friends screen.
 * - Four tabs at the bottom, as the sketch has them: ״מערכת״ (the day side
 *   by side, `BuddyDayTab`), ״מבחנים״ (`BuddyExamsTab`), ״חיסורים״
 *   (`BuddyAbsencesTab`), and ״ציונים״ (`BuddyGradesTab`, grades spec 2.2).
 *   A tab whose part they do not share says ״זה לא משותף איתך.״ and stays,
 *   so it is clear the part exists; the grades tab says instead what has to
 *   happen for grades to be there. It carries a dot while they asked to
 *   compare grades and I have not opened it since (grades spec 2.4), the dot
 *   ״חברים״ and the gear carry in the tabs' header.
 *
 * The date shown is the page's own state, not the route's: it starts from the
 * route's (a line on Today), or, without one, from the day the page opens on
 * (`buddyPageDate`: today, or the next school day), and the day strip and the
 * week arrows change it. A friend no longer on this phone (they ended it)
 * goes back to where the page was opened; so does a parent, who has none.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DateStr } from '@sederyom/shared';
import { useBuddyPage } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import type { BuddyPage } from '../buddies/view';
import { BuddyAbsencesTab } from '../components/BuddyAbsencesTab';
import { BuddyDayTab } from '../components/BuddyDayTab';
import { BuddyExamsTab } from '../components/BuddyExamsTab';
import { BuddyGradesTab } from '../components/BuddyGradesTab';
import { BuddySettingsSheet } from '../components/BuddySettingsSheet';
import { ROW_GUTTER } from '../components/notebook';
import { ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { dayDateParts } from '../lib/format';
import { displayClassName } from '../lib/onboarding';
import type { RootParamList } from '../navigation/types';
import { font, radius, space, type } from '../theme';
import { LOAD_ERROR_TEXT } from './ConnectionsScreen';

type Tab = keyof typeof BUDDY_COPY.tabs;
const TABS: readonly Tab[] = ['timetable', 'exams', 'absences', 'grades'];

export function BuddyScreen({ navigation, route }: NativeStackScreenProps<RootParamList, 'Buddy'>): React.JSX.Element {
  const { id, date: linked } = route.params;
  // `null`: the day the page opens on.
  const [chosen, setChosen] = useState<DateStr | null>(linked ?? null);
  const [tab, setTab] = useState<Tab>('timetable');
  const [settings, setSettings] = useState(false);
  const query = useBuddyPage(id, chosen ?? undefined);
  const page = query.data ?? null;
  // Set once the page is on its way out, so it goes back only once.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // Opened again with another date (a line on Today): that date.
  useEffect(() => {
    setChosen(linked ?? null);
  }, [id, linked]);

  // The friend is not on this phone any more (they ended it, and a refresh
  // took them off), or never was: nothing to show, so back to where it was opened.
  const gone = query.isSuccess && query.data === null;
  useEffect(() => {
    if (gone) leave();
  }, [gone, leave]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: page?.name ?? '' });
  }, [navigation, page?.name]);

  if (query.isLoading) return <Screen><Loading /></Screen>;
  if (query.isError) {
    return (
      <Screen>
        <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  // Not on this phone (removed, here or by them) or a parent's: empty while it goes back.
  if (!page) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Head page={page} tab={tab} onShare={() => setSettings(true)} />
      <View style={styles.body}>
        {tab === 'timetable' ? <BuddyDayTab page={page} onPick={setChosen} /> : null}
        {tab === 'exams' ? <BuddyExamsTab page={page} /> : null}
        {tab === 'absences' ? <BuddyAbsencesTab page={page} now={new Date()} /> : null}
        {/* Opened, it answers its dot (`useSeen` in the tab). */}
        {tab === 'grades' ? <BuddyGradesTab page={page} now={new Date()} /> : null}
      </View>
      <BottomTabs tab={tab} onSelect={setTab} page={page} />
      <BuddySettingsSheet visible={settings} page={page} onClose={() => setSettings(false)} onRemoved={leave} />
    </Screen>
  );
}

/** Under the title: the day shown and their class, or what the tab covers; the ״שיתוף״ chip at the end. */
function Head({ page, tab, onShare }: { page: BuddyPage; tab: Tab; onShare: () => void }): React.JSX.Element {
  const p = usePalette();
  const day = dayDateParts(page.date);
  const className = page.className ? displayClassName(page.className) : '';
  return (
    <View style={styles.head}>
      <Text numberOfLines={1} style={[styles.subtitle, { color: p.textMuted }]}>
        {tab === 'timetable' ? (
          <>
            {`${day.weekday} `}
            <Ltr>{day.date}</Ltr>
            {className ? `, ${className}` : ''}
          </>
        ) : tab === 'exams' ? BUDDY_COPY.examsSpan : tab === 'absences' ? BUDDY_COPY.absencesSpan : BUDDY_COPY.gradesSpan}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={BUDDY_COPY.shareWith(page.name)}
        hitSlop={{ top: (MIN_TOUCH - CHIP_HEIGHT) / 2, bottom: (MIN_TOUCH - CHIP_HEIGHT) / 2 }}
        onPress={onShare}
        style={({ pressed }) => [styles.chip, { borderColor: p.border, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text maxScale={1.15} style={[styles.chipText, { color: p.textMuted }]}>{BUDDY_COPY.share}</Text>
      </Pressable>
    </View>
  );
}

/**
 * What the grades tab's dot says aloud: what they asked for, the grades or
 * the bagrut along with them (the dot is only for one of the two, 2.4).
 */
function gradesDotSaid(page: BuddyPage): string {
  const asked = page.grades.state === 'theirs' ? BUDDY_COPY.gradesTheirs(page.name) : BUDDY_COPY.bagrutTheirs(page.name);
  return `${BUDDY_COPY.tabs.grades}, ${asked}`;
}

/**
 * The page's four tabs at its foot: the chosen one on the highlighter, as the
 * sketch draws them; on ״ציונים״, while they asked and it was not opened since,
 * the dot of the header's buttons (`TabHeader`).
 */
function BottomTabs({ tab, onSelect, page }: { tab: Tab; onSelect: (tab: Tab) => void; page: BuddyPage }): React.JSX.Element {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { borderTopColor: p.border, backgroundColor: p.bg, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {TABS.map((key) => {
        const active = key === tab;
        const dot = key === 'grades' && page.grades.dot;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={dot ? gradesDotSaid(page) : undefined}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.tabFace, active ? { backgroundColor: p.mark } : null]}>
              <Text maxScale={1.3} style={[styles.tabText, { color: active ? p.onMark : p.textMuted, fontFamily: active ? font.headingSemi : font.bodyMedium }]}>
                {BUDDY_COPY.tabs[key]}
              </Text>
              {dot ? <View style={[styles.tabDot, { backgroundColor: p.change, borderColor: p.bg }]} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The chip's own height; its touch area reaches `MIN_TOUCH`. */
const CHIP_HEIGHT = 32;

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: ROW_GUTTER, paddingTop: space.sm, paddingBottom: space.sm,
  },
  subtitle: { flex: 1, fontFamily: font.body, fontSize: type.small },
  chip: {
    minHeight: CHIP_HEIGHT, paddingHorizontal: space.md, borderWidth: 1, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontFamily: font.bodySemi, fontSize: type.caption },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, paddingTop: space.sm },
  tab: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  tabFace: { borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 2 },
  tabText: { fontSize: type.label },
  // `TabHeader`'s dot, on the label's top end corner.
  tabDot: { position: 'absolute', top: -4, insetInlineEnd: 2, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
