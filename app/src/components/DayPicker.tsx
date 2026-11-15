/**
 * Picking a day: `DayStepper` (previous · היום · the next school day · next) and `WeekStrip`
 * (the seven days of the shown week). `DayPicker` stacks the two, as the
 * planning tab shows them; "היום שלי" keeps only the slim stepper fixed above
 * its scroll and lets the week strip scroll away with the content, so the
 * part that stays on screen is one row high.
 *
 * On the notebook page (plan §16.1) neither has tiles or pills: the stepper is
 * two chevrons and two words, the chosen one on the highlighter; the strip is
 * letters and numbers written on the page, the chosen day circled in pen.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppIcon } from './AppIcon';
import { Mark, PenCircle } from './notebook';
import { MIN_TOUCH, Text, usePalette } from './ui';
import { addDays, dayLabel, formatShortDate, todayStr, weekdayName } from '../lib/format';
import { marksLabel, type DayMarks } from '../lib/today';
import { font, space, type, type Palette } from '../theme';

const weekdays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

interface PickerProps {
  date: string;
  onChange: (date: string) => void;
  style?: StyleProp<ViewStyle>;
}

/** The stepper's second button when the screen knows better than "tomorrow" (`nextShortcut`, lib/today.ts). */
export interface StepperNext {
  date: string;
  /** "מחר", "ראשון 11.10". */
  label: string;
  /** "יום הלימודים הבא, יום ראשון 11.10". */
  a11y: string;
}

/**
 * One row: the previous day, "היום", the next school day, the next day. The
 * second button is tomorrow unless `next` says otherwise — "היום שלי" passes
 * the next school day, so on a Thursday it reads "ראשון 11.10" (W5-2, W6-7).
 * The arrows always step one day. Plain text buttons: the shown one on the
 * highlighter (`Mark`), the other in blue ink.
 */
export function DayStepper({ date, onChange, style, next }: PickerProps & { next?: StepperNext }): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const shortcuts = [
    { date: today, label: dayLabel(today), a11y: `${dayLabel(today)}, ${weekdayName(today)} ${formatShortDate(today)}` },
    next ?? { date: tomorrow, label: dayLabel(tomorrow), a11y: `${dayLabel(tomorrow)}, ${weekdayName(tomorrow)} ${formatShortDate(tomorrow)}` },
  ];
  return (
    <View style={[styles.row, style]}>
      {/* First in the row, so at the right edge: "previous" points right, the way time runs here. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="היום הקודם"
        onPress={() => onChange(addDays(date, -1))}
        style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppIcon name="chevronRight" color={p.accent} size={24} />
      </Pressable>
      {shortcuts.map((s) => {
        const active = s.date === date;
        return (
          <Pressable
            key={s.date}
            accessibilityRole="button"
            accessibilityLabel={s.a11y}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(s.date)}
            style={({ pressed }) => [styles.shortcut, { opacity: pressed ? 0.6 : 1 }]}
          >
            {active ? (
              // Centred like the plain word beside it: a mark is drawn at the line's start otherwise.
              <Mark style={styles.shortcutText} containerStyle={styles.shortcutMark}>{s.label}</Mark>
            ) : (
              <Text numberOfLines={1} maxScale={1.15} style={[styles.shortcutText, { color: p.accent }]}>{s.label}</Text>
            )}
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="היום הבא"
        onPress={() => onChange(addDays(date, 1))}
        style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppIcon name="chevronLeft" color={p.accent} size={24} />
      </Pressable>
    </View>
  );
}

/**
 * The marks of a day, each its own shape so none relies on colour alone, in
 * the planning screens' shapes (plan §16.1; stream S3's legend): an exam puts
 * the day's number on the exam's highlighter, as an exam's name is on the
 * page; under the number a change is a dot in magenta, and something to hand
 * in an amber square, the homework mark of the planning grid.
 */
function UnderMark({ kind, p }: { kind: 'change' | 'due'; p: Palette }): React.JSX.Element {
  if (kind === 'change') return <View style={[styles.markDot, { backgroundColor: p.change }]} />;
  return <View style={[styles.markSquare, { backgroundColor: p.homeworkMark }]} />;
}

/**
 * The seven days, Sunday first, of the week `date` falls in, written on the
 * page: the letter over the number, the shown day circled in pen
 * (`PenCircle`), today's number in blue ink. With `marks`, a day carries its
 * marks — an exam, a change, something to hand in (`dayMarks`, W5-6) — and
 * says them in words to a screen reader ("מבחן, שינויים במערכת, יש להגשה").
 * Every day keeps the marks' row, so the numbers line up with or without
 * them. The legend that stood under the strip is gone: the marks are the
 * page's own (the highlighter is an exam everywhere), and each day says its
 * marks aloud (W6-6, Daniel).
 */
export function WeekStrip({ date, onChange, style, marks }: PickerProps & { marks?: Readonly<Record<string, DayMarks>> }): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const start = addDays(date, -new Date(`${date}T12:00:00`).getDay());
  const days = weekdays.map((_, index) => addDays(start, index));
  return (
    <View style={[styles.strip, style]}>
      {weekdays.map((label, index) => {
        const d = days[index]!;
        const active = d === date;
        const isToday = d === today;
        const m = marks?.[d];
        const said = m ? marksLabel(m) : '';
        const number = String(Number(d.slice(-2)));
        const ink = isToday ? p.accent : p.text;
        return (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityLabel={`${weekdayName(d)} ${formatShortDate(d)}${isToday ? ', היום' : ''}${said ? `, ${said}` : ''}`}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(d)}
            style={({ pressed }) => [styles.day, { opacity: pressed ? 0.6 : 1 }]}
          >
            <PenCircle active={active}>
              <View style={styles.dayFace}>
                <Text maxScale={1.15} style={[styles.dayLetter, { color: isToday ? p.accent : p.textMuted }]}>{label}</Text>
                {m?.exam ? (
                  <Mark kind="exam" color={ink} style={styles.dayNumber} containerStyle={styles.dayNumberMark}>{number}</Mark>
                ) : (
                  <Text maxScale={1.15} style={[styles.dayNumber, { color: ink }]}>{number}</Text>
                )}
              </View>
            </PenCircle>
            {marks ? (
              <View style={styles.marks}>
                {m?.change ? <UnderMark kind="change" p={p} /> : null}
                {m?.due ? <UnderMark kind="due" p={p} /> : null}
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function DayPicker({ date, onChange, style }: PickerProps): React.JSX.Element {
  return (
    <View style={[{ gap: space.sm, marginVertical: space.lg }, style]}>
      <DayStepper date={date} onChange={onChange} />
      <WeekStrip date={date} onChange={onChange} />
    </View>
  );
}

/** A mark's size under a day: a dot or a square of 5. */
const MARK = 5;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  arrow: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  shortcut: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  shortcutText: { fontFamily: font.bodySemi, fontSize: type.body },
  shortcutMark: { alignSelf: 'center' },
  strip: { flexDirection: 'row', alignItems: 'flex-start' },
  // Each day a column of the same width, so the pen ring is the same round every day.
  day: { flex: 1, minHeight: 66, alignItems: 'center', paddingTop: space.sm, gap: space.xs },
  dayFace: { width: 40, alignItems: 'center' },
  dayLetter: { fontFamily: font.body, fontSize: type.caption, lineHeight: 18 },
  dayNumber: { fontFamily: font.bodySemi, fontSize: type.title, lineHeight: 24, fontVariant: ['tabular-nums'] },
  // Clear of the pen ring, which reaches 6 points under the number.
  marks: { flexDirection: 'row', alignItems: 'center', gap: 3, height: MARK, marginTop: 4 },
  markDot: { width: MARK, height: MARK, borderRadius: MARK / 2 },
  markSquare: { width: MARK, height: MARK, borderRadius: 1 },
  // The highlighter behind an exam day's number, the number where it would be without it.
  dayNumberMark: { alignSelf: 'center', paddingVertical: 0 },
});
