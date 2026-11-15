/**
 * "What now?" at the top of today (F3), as the first row of the ruled page
 * (plan §16.1): no card and no bar along its side. The time is in the margin
 * in blue ink over a dashed rule (`tone="now"`), and the line says where the
 * day is in at most two short lines (`nowNext`, lib/today.ts; plan §16.2):
 * "פיזיקה עד 09:30" over "ב־09:45 אנגלית", or "סיימת להיום." over "ב־15:15
 * שיעור פרטי במתמטיקה". Under them, muted, the day's lessons in one line,
 * "3 שיעורים, 4 בוטלו" (`dayLine`).
 *
 * A tap does what the words at the row's end say (`nowCardAction`): "קפיצה
 * לעכשיו" brings the timeline's "now" line into view while the day is under
 * way; "ליום ראשון" shows the next school day once it is over. The words sit
 * at the end of the muted line, so they never take the width the next
 * thing's time needs (Daniel, run 6); at a larger size they wrap under it.
 * Without an action the row is a plain summary.
 *
 * `DayLineRow` is the same day line on a day without a "now": another day,
 * or today with nothing timed on it.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { partsText, type DayLine, type NowNext } from '../lib/today';
import { font, space, type } from '../theme';
import { MarginRow } from './notebook';
import { PartsText } from './timeline';
import { Ltr, Text, usePalette } from './ui';

export interface NowNextCardAction {
  /** The words at the row's end: "קפיצה לעכשיו", "ליום ראשון". */
  label: string;
  /** What a screen reader adds: where the tap goes. */
  hint: string;
  onPress: () => void;
}

/** `HH:mm` of `now`. */
function clock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function NowRow({
  model, now, lessons = null, action = null, style,
}: {
  model: NowNext;
  /** The screen's minute tick: the time in the margin. */
  now: Date;
  /** The day's lessons in one muted line (`dayLine`): "3 שיעורים, 4 בוטלו". */
  lessons?: string | null;
  action?: NowNextCardAction | null;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const p = usePalette();
  const label = [partsText(model.primary), model.secondary ? partsText(model.secondary) : null, lessons].filter(Boolean).join('. ');
  return (
    <MarginRow
      margin={clock(now)}
      tone="now"
      title={<PartsText parts={model.primary} />}
      accessible={action ? undefined : true}
      accessibilityRole={action ? 'button' : 'summary'}
      accessibilityLabel={action ? `${label}. ${action.label}` : label}
      accessibilityHint={action?.hint}
      onPress={action?.onPress}
      style={style}
    >
      {model.secondary ? <PartsText parts={model.secondary} style={[styles.secondary, { color: p.text }]} /> : null}
      {lessons || action ? (
        <View style={styles.foot}>
          {lessons ? <Text style={[styles.lessons, { color: p.textMuted }]}>{lessons}</Text> : <View />}
          {action ? <Text style={[styles.action, { color: p.accent }]}>{action.label}</Text> : null}
        </View>
      ) : null}
    </MarginRow>
  );
}

/** The day's lessons on a day without a "now": "7 שיעורים, אחד בוטל", and the span under it. */
export function DayLineRow({ line, style }: { line: DayLine; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const p = usePalette();
  return (
    <MarginRow
      accessible
      accessibilityRole="summary"
      accessibilityLabel={[line.lessons, line.span].filter(Boolean).join(', ')}
      title={line.lessons}
      subtitle={line.span ? <Text style={[styles.lessons, { color: p.textMuted }]}><Ltr>{line.span}</Ltr></Text> : undefined}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  secondary: { fontFamily: font.body, fontSize: type.body },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: space.md, marginTop: 2 },
  lessons: { flexShrink: 1, fontFamily: font.body, fontSize: type.small },
  action: { fontFamily: font.bodySemi, fontSize: type.small },
});
