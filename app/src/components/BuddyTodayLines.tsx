/**
 * What friends share with me today, under Today's "now" row (friends spec 2.2,
 * sketch 1-layout.html, option א): up to two rows on the margin line, the
 * initials of the friends a line names in the margin, and the line in words
 * (`todayLinesModel`):
 *
 *   נ י   מסיימים איתך ב־14:00: נועה, יואב
 *   נ     חלון משותף עם נועה 11:15–12:20        (on the highlighter)
 *
 * The window is on the highlighter, the end and the start of the day plain. A
 * row is a button with its words for the label, and opens the first friend
 * it names on that date. Nothing when there is no line: no friend sharing a
 * timetable, no window, the day over, a parent, or a date that is not today
 * (the caller leaves it out then, and nothing is built).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { DateStr } from '@sederyom/shared';
import { useBuddies, useBuddyTodayLines } from '../api/hooks';
import type { TodayLine } from '../buddies/view';
import type { RootNavigation } from '../navigation/types';
import { font, type } from '../theme';
import { BuddyInitial } from './BuddyInitial';
import { MarginList, MarginRow } from './notebook';

/** The initials one row draws, at the most: three fit the margin column, overlapped. */
const MAX_INITIALS = 3;
/** One initial's circle, as the sketch's, and how far the next one slides under it. */
const SIZE = 22;
const OVERLAP = 8;

export function BuddyTodayLines({ date }: { date: DateStr }): React.JSX.Element | null {
  const navigation = useNavigation<RootNavigation>();
  const focused = useIsFocused();
  const rows = useBuddies().data?.rows;
  const lines = useBuddyTodayLines(date, focused && (rows?.length ?? 0) > 0).data;
  // No friends left (the last one just ended it): whatever was kept for the date is not shown.
  if (!rows || rows.length === 0 || !lines || lines.length === 0) return null;
  return (
    <MarginList>
      {lines.map((line) => (
        <MarginRow
          key={`${line.kind}|${line.buddyId}`}
          margin={<Initials letters={initialsOf(line, rows)} />}
          marked={line.kind === 'window'}
          title={line.text}
          titleStyle={styles.title}
          accessibilityLabel={line.text}
          onPress={() => navigation.navigate('Buddy', { id: line.buddyId, date })}
        />
      ))}
    </MarginList>
  );
}

/** The initials of the friends a line names, in its order; one whose row is not there (just removed) has none. */
function initialsOf(line: TodayLine, rows: readonly { id: string; initial: string }[]): string[] {
  return line.buddyIds.flatMap((id) => {
    const initial = rows.find((row) => row.id === id)?.initial;
    return initial ? [initial] : [];
  }).slice(0, MAX_INITIALS);
}

/** The circles in a row, each slid under the one before it. */
function Initials({ letters }: { letters: readonly string[] }): React.JSX.Element {
  return (
    <View style={styles.initials}>
      {letters.map((letter, i) => (
        <View key={i} style={i > 0 ? styles.under : null}>
          <BuddyInitial letter={letter} size={SIZE} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // A line of words, not a lesson's title: regular weight at the body size, so a line fits in one.
  title: { fontFamily: font.body, fontSize: type.body },
  initials: { flexDirection: 'row', alignItems: 'center' },
  under: { marginStart: -OVERLAP },
});
