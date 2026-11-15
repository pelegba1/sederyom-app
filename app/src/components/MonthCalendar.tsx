/**
 * A month grid, Sunday first (on the right). Used as the date field of the
 * compose sheet, and as the one date navigator of the "תכנון" tab, which
 * also passes `marks` — a small shape under each day that has something
 * planned — and `onToday`, a "היום" shortcut in the month's header.
 *
 * The month shown and the day chosen are kept apart (W4-12c): the arrows page
 * the month and choose nothing; `onChange` fires only when a day is tapped.
 * Paging used to move the chosen day to the same date in the next month, and
 * a task saved then got a date nobody picked (Noa, run 3). With no day chosen
 * yet (`date` null) the grid opens on `initialMonth`.
 *
 * Wave 9 (plan §16.1): the month is written on the page, with no card and no
 * tiles. The chosen day is circled in pen (`PenCircle`); today is bold and
 * underlined. What a student plans around stands out (W4-10), and the marks
 * differ by shape as well as colour, so colour is never the only signal: an
 * exam day's number sits on the exam's yellow highlighter (`markFill`, the
 * one every exam mark is drawn on), homework due is a filled square under
 * the number, a task a ring.
 * Calendar events have no mark (W5-16): on nearly every day, their line read
 * as the grid's underline (Daniel, run 4). `MarkLegend` draws the key with
 * the same shapes at the same sizes, and `Legend` is the one key the week
 * draws too, so a shape means one thing on every screen.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { markFill, markInk, PenCircle } from './notebook';
import { MIN_TOUCH, Text, usePalette } from './ui';
import { formatDate, todayStr } from '../lib/format';
import { MARK_GAP, MARK_KINDS, MARK_LABELS, markBox, markLayout, type MarkKind } from '../lib/planning';
import { monthDates, monthOf, shiftMonth } from '../lib/planner';
import { font, space, type } from '../theme';
import type { Palette } from '../theme';

const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/**
 * A task's ring: its line. Run 8: at 2 points the 9-point ring all but vanished on the dark
 * page; a bolder line on a slightly larger ring (`MARK_SIZE`) reads as a ring on both pages.
 */
const TASK_RING_WIDTH = 2.5;

/** The grid's cells are a fixed seventh of the width: their text grows with the app's text size only this far. */
const CELL_MAX_SCALE = 1.15;

/**
 * The box a day's number sits in: what the pen circles and what an exam
 * highlights. The same for every day, so the ring is the same round shape on
 * "1" and on "28" (`PenCircle` stretches to its child).
 */
const NUMBER_BOX = { width: 28, height: 26 } as const;

export interface MonthCalendarProps {
  /** The chosen day; `null` while none is (a fresh "תאריך אחר"). */
  date: string | null;
  /** A day was tapped. Only then: paging the month never chooses a day. */
  onChange: (date: string) => void;
  /** The month to open on while no day is chosen; today's by default. */
  initialMonth?: string;
  /** The month shown (its first day), whenever it changes. */
  onMonthChange?: (month: string) => void;
  /** What to mark under each day, by date. Days without an entry get no marks. */
  marks?: Readonly<Record<string, readonly MarkKind[]>>;
  /** Shows a "היום" shortcut next to the month's name while another day, or another month, is shown. */
  onToday?: () => void;
}

export function MonthCalendar({ date, onChange, initialMonth, onMonthChange, marks, onToday }: MonthCalendarProps): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const [month, setMonth] = useState(() => monthOf(date ?? initialMonth ?? today));

  // A day chosen from outside — a link, "היום" — in another month brings that
  // month into view. Only when the chosen day changes: paging away stays put.
  useEffect(() => {
    if (date && monthOf(date) !== month) setMonth(monthOf(date));
  }, [date]);
  useEffect(() => {
    onMonthChange?.(month);
  }, [month]);

  const dates = monthDates(month);
  const title = new Date(`${month}T12:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  const showToday = onToday !== undefined && (date !== today || month !== monthOf(today));

  return <View>
    <View style={styles.header}>
      {/* Previous sits at the right edge and points right; next at the left, pointing left. */}
      <Pressable accessibilityRole="button" accessibilityLabel="החודש הקודם" onPress={() => setMonth(shiftMonth(month, -1))} style={styles.arrow}>
        <AppIcon name="chevronRight" color={p.accent} size={24} />
      </Pressable>
      <View style={styles.title}>
        <Text accessibilityRole="header" style={{ fontFamily: font.headingSemi, color: p.text, fontSize: type.heading }}>{title}</Text>
        {showToday ? (
          // A text button, not a pill (plan §16.1).
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="חזרה להיום"
            onPress={() => {
              setMonth(monthOf(today));
              onToday?.();
            }}
            style={({ pressed }) => [styles.todayButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>היום</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="החודש הבא" onPress={() => setMonth(shiftMonth(month, 1))} style={styles.arrow}>
        <AppIcon name="chevronLeft" color={p.accent} size={24} />
      </Pressable>
    </View>
    <View style={styles.week}>
      {WEEKDAYS.map(w => <Text key={w} maxScale={CELL_MAX_SCALE} style={[styles.label, { color: p.textMuted }]}>{w}</Text>)}
    </View>
    {Array.from({ length: dates.length / 7 }, (_, row) => <View key={row} style={styles.week}>
      {dates.slice(row * 7, row * 7 + 7).map(d => {
        const selected = d === date;
        const isToday = d === today;
        const inMonth = d.slice(0, 7) === month.slice(0, 7);
        const dayMarks = marks?.[d] ?? [];
        // The exam is the number's highlighter; the shapes under it are the rest.
        const exam = dayMarks.includes('exam');
        const shapes = markLayout(dayMarks).filter(k => k !== 'exam');
        const label = [formatDate(d), isToday ? 'היום' : null, ...dayMarks.map(k => MARK_LABELS[k])].filter(Boolean).join(', ');
        const number = (
          <View style={[styles.numberBox, exam ? { backgroundColor: markFill('exam', p) } : null]}>
            {/* One family for every day (Daniel, run 5: two families sat the chosen number higher than its row);
                today bolder and underlined, an exam day in the exam's ink. */}
            <Text
              maxScale={CELL_MAX_SCALE}
              style={{
                fontFamily: isToday || exam ? font.headingSemi : font.bodyMedium,
                fontSize: 16,
                lineHeight: 21,
                color: exam ? markInk('exam', p) : inMonth ? p.text : p.textFaint,
                textDecorationLine: isToday ? 'underline' : 'none',
                fontVariant: ['tabular-nums'],
              }}
            >
              {Number(d.slice(-2))}
            </Text>
          </View>
        );
        return <Pressable
          key={d}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected }}
          onPress={() => onChange(d)}
          style={({ pressed }) => [styles.cell, marks ? styles.cellMarked : null, { opacity: pressed ? 0.6 : 1 }]}
        >
          {selected ? <PenCircle>{number}</PenCircle> : number}
          {marks && shapes.length > 0 ? <View style={styles.markRow}>
            {shapes.map(k => <MarkShape key={k} kind={k} color={markColor(k, p)} />)}
          </View> : null}
        </Pressable>;
      })}
    </View>)}
  </View>;
}

/**
 * Each mark's colour: the exam's highlighter, homework's amber, a task's green — their colours
 * elsewhere in the app. The exam's is `markFill`'s, the yellow every exam mark is drawn on (run 8:
 * the dark key showed the old olive tint beside exams drawn in bright yellow).
 */
export function markColor(kind: MarkKind, p: Palette): string {
  switch (kind) {
    case 'exam': return markFill('exam', p);
    case 'homework': return p.homeworkMark;
    default: return p.ok;
  }
}

/**
 * A highlighter swatch for an exam, a filled square for homework, a ring for
 * a task; boxes from `markBox`. The exam's is what an exam day's number sits
 * on; homework's and the task's are drawn under the number.
 */
export function MarkShape({ kind, color }: { kind: MarkKind; color: string }): React.JSX.Element {
  const box = markBox(kind);
  switch (kind) {
    case 'exam': return <View style={[styles.swatch, { backgroundColor: color }]} />;
    case 'homework': return <View style={{ ...box, borderRadius: 2, backgroundColor: color }} />;
    default: return <View style={{ ...box, borderRadius: box.width / 2, borderWidth: TASK_RING_WIDTH, borderColor: color }} />;
  }
}

/**
 * Everything a key names, on Planning and on the week alike (the review: the
 * week's key changed shapes from Planning's): an exam and a change are their
 * highlighters, a cancelled lesson the red ⊘ on its tint, homework the amber
 * square, a task the ring, and "לפי המערכת הקבועה" a dashed outline.
 */
export type LegendKind = MarkKind | 'change' | 'cancelled' | 'projected';

/** The sample a key draws for `kind`, the size the grid draws it. */
export function LegendShape({ kind }: { kind: LegendKind }): React.JSX.Element {
  const p = usePalette();
  switch (kind) {
    case 'change': return <View style={[styles.swatch, { backgroundColor: markFill('change', p) }]} />;
    case 'cancelled': return (
      <View style={[styles.swatch, { backgroundColor: p.cancelSoft }]}>
        <AppIcon name="cancel" color={p.cancel} size={12} />
      </View>
    );
    case 'projected': return <View style={[styles.swatch, styles.dashed, { borderColor: p.textFaint }]} />;
    default: return <MarkShape kind={kind} color={markColor(kind, p)} />;
  }
}

/**
 * One quiet key: each sample beside its word, muted, in one wrapping line,
 * read out as one sentence ("סימונים בלוח: מבחן, הגשה, משימה").
 */
export function Legend({ items, style }: {
  items: readonly { kind: LegendKind; label: string }[];
  style?: React.ComponentProps<typeof View>['style'];
}): React.JSX.Element {
  const p = usePalette();
  return <View style={[styles.legend, style]} accessible accessibilityLabel={`סימונים בלוח: ${items.map(i => i.label).join(', ')}`}>
    {items.map(i => <View key={i.kind} style={styles.legendItem}>
      <View style={styles.legendSample}><LegendShape kind={i.kind} /></View>
      <Text style={{ fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted }}>{i.label}</Text>
    </View>)}
  </View>;
}

/** The month grid's key, in the order the marks are drawn, at the size they are drawn. */
export function MarkLegend({ kinds = MARK_KINDS }: { kinds?: readonly MarkKind[] }): React.JSX.Element {
  return <Legend items={kinds.map(k => ({ kind: k, label: MARK_LABELS[k] }))} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  todayButton: { minHeight: MIN_TOUCH, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  arrow: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  // Tighter than a row of days: the grid took the whole screen and pushed the chosen day under it (Itai, run 4).
  label: { flex: 1, textAlign: 'center', fontFamily: font.bodyMedium, fontSize: type.small, paddingVertical: 6 },
  cell: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  // One row of marks under the number (no event line any more): 48 holds both, past `MIN_TOUCH`.
  cellMarked: { minHeight: 52, justifyContent: 'flex-start', paddingTop: 6 },
  numberBox: { minWidth: NUMBER_BOX.width, minHeight: NUMBER_BOX.height, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  markRow: {
    alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: MARK_GAP, marginTop: 5,
  },
  // A highlighter's sample: about a short word's mark, radius as `Mark`'s, no border.
  swatch: { width: 22, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  dashed: { borderWidth: 1.5, borderStyle: 'dashed' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: space.lg, rowGap: space.xs, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  // Every sample in a box of one width, so the words line up whatever the shape.
  legendSample: { width: 22, alignItems: 'center' },
});
