/**
 * The notebook's pieces (plan §16.1): content sits on the page, in ruled
 * rows, not in cards. A list of times and dates has a red margin line at its
 * start edge with the time written in the margin; a mark is a highlighter
 * behind the words, not a pill around them; the chosen day is circled in
 * pen. Screens build their lists from these, and the chrome (`AppBar`, the
 * School tabs, the "+") comes from here too.
 *
 * Everything one-sided is written with logical props (`insetInlineStart`,
 * `paddingEnd`, …), never `left`/`right`: the phone mirrors physical sides
 * and the browser preview does not.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Animated, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions,
  type PressableProps, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { SCHOOL_TAB_ROW, tabRowAtEnd, tabScrollOffset } from '../lib/school';
import { FAB, font, space, TOAST_CLEARANCE, TOAST_MIN_HEIGHT, type, type Palette } from '../theme';
import { AppIcon } from './AppIcon';
import { Ltr, MIN_TOUCH, SectionTitle, Text, touchSlop, usePalette, useTextScale } from './ui';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The margin column's width, from the list's start edge to its red line. */
export const MARGIN_WIDTH = 56;
/** The red margin line's thickness. */
export const MARGIN_LINE = 1.5;
/** A ruled row: at least this tall, `ROW_PADDING` above and below its text, a 1-point rule under it. */
export const ROW_MIN_HEIGHT = 52;
export const ROW_PADDING = space.md;
/** A row's side padding: the page's gutter at the start (without a margin), a little less at the end. */
export const ROW_GUTTER = space.xl;
export const ROW_END = space.lg;
/** Between a row's `lead` (its checkbox) and its body. */
export const LEAD_GAP = space.md;
/** The checkbox's drawn square (`Checkbox`); a control around it is larger. */
export const CHECKBOX_SIZE = 20;
/**
 * One line of a row's title, in ems: Assistant's ascent and descent (1021 +
 * 287 over 1000, its `hhea` table), the height a line takes with no
 * `lineHeight` of its own.
 */
export const TITLE_LINE = 1.308;

// ---------------------------------------------------------------------------
// Pure helpers (tested in app/test/notebook.test.cjs)
// ---------------------------------------------------------------------------

/** What a highlighter marks: an exam, a change, something done, or "this one" (the chosen tab, a selection). */
export type MarkKind = 'exam' | 'change' | 'ok' | 'mark';

/** The highlighter's colour for `kind`. A fill, never text. */
export function markFill(kind: MarkKind, p: Palette): string {
  switch (kind) {
    // An exam is the yellow highlighter itself, as the sketch draws it: the translucent
    // examSoft read as olive on the ink page (re-rate, 50-school-dark).
    case 'exam': return p.mark;
    case 'change': return p.changeSoft;
    case 'ok': return p.okSoft;
    default: return p.mark;
  }
}

/**
 * The ink on a highlighter of `kind`, unless the caller gives its own:
 * `onMark` on the "this one" yellow (in the dark scheme a near-opaque yellow,
 * where light ink would vanish), `text` on the translucent status marks.
 */
export function markInk(kind: MarkKind, p: Palette): string {
  return onYellow(kind) ? p.onMark : p.text;
}

/** The kinds drawn on the yellow highlighter, which always take `onMark`. */
function onYellow(kind: MarkKind): boolean {
  return kind === 'mark' || kind === 'exam';
}

/**
 * A row's state: `late` writes the margin in the red pen; `cancelled` strikes
 * the title through in red; `now` dashes the row's rule in blue and writes
 * the margin in it.
 */
export type RowTone = 'normal' | 'late' | 'cancelled' | 'now';

export interface ToneStyle {
  /** The margin's text colour. */
  margin: string;
  /** The title's colour. */
  title: string;
  /** Whether the title is struck through. */
  strike: boolean;
  /** The rule under the row: its colour, and whether it is dashed. */
  rule: string;
  dashed: boolean;
}

/**
 * How a tone draws. A cancelled title is written in `cancel`, not only struck
 * in it: Android ignores `textDecorationColor` (it is iOS-only), so a muted
 * title would get a muted strike there. In `cancel`, the strike is the red pen
 * on both platforms.
 */
export function toneStyle(tone: RowTone, p: Palette): ToneStyle {
  return {
    margin: tone === 'late' ? p.cancel : tone === 'now' ? p.accent : p.textMuted,
    title: tone === 'cancelled' ? p.cancel : p.text,
    strike: tone === 'cancelled',
    rule: tone === 'now' ? p.accent : p.border,
    dashed: tone === 'now',
  };
}

/** How a `FilterChip` speaks: a filter or toggle (`button`), or one choice of a group (`radio`). */
export type FilterChipRole = 'button' | 'radio';

/** A `FilterChip`'s accessibility state: a radio is `checked`, a button `selected`. */
export function filterChipState(
  role: FilterChipRole, selected: boolean, disabled: boolean,
): { checked: boolean; disabled: boolean } | { selected: boolean; disabled: boolean } {
  return role === 'radio' ? { checked: selected, disabled } : { selected, disabled };
}

/** A checkbox's value: on, off, or some of a group on. */
export type CheckValue = boolean | 'mixed';

/** What pressing a checkbox makes it: off goes on, on goes off, and mixed goes on (like `Switch`). */
export function checkboxNext(value: CheckValue): boolean {
  return value !== true;
}

/**
 * The pen ring (`PenCircle`), drawn once by hand on a 58 × 52 box around a
 * 40-wide day (the "ב׳ מחברת" sketch): it starts at the top, goes round
 * against the clock, and overshoots its start a little, as a pen does.
 */
const PEN_BOX = { width: 58, height: 52 } as const;
const PEN_PATH: readonly (readonly [string, readonly number[]])[] = [
  ['M', [33, 4]],
  ['C', [17, 2, 4, 11, 5, 25]],
  ['c', [1, 15, 18, 23, 33, 21]],
  ['c', [13, -2, 19, -11, 16, -23]],
  ['C', [51, 11, 41, 4, 27, 5]],
];

/** The pen ring's path, stretched to a `width` × `height` box; the stroke keeps its width. */
export function penCirclePath(width: number, height: number): string {
  const sx = width / PEN_BOX.width;
  const sy = height / PEN_BOX.height;
  const round = (n: number): string => String(Math.round(n * 10) / 10);
  return PEN_PATH.map(([cmd, nums]) => `${cmd}${nums.map((n, i) => round(n * (i % 2 === 0 ? sx : sy))).join(' ')}`).join('');
}

/** How far the pen ring reaches past the circled child, to each side and above and below. */
export const PEN_OUTSET = { x: 9, y: 6 } as const;

/**
 * The room a list needs under its last row on a screen with the "+" (`Fab`):
 * a toast floats `TOAST_CLEARANCE` above the tab bar, over the "+", and grows
 * with the text size, so the last row ends above the toast's top and a gap.
 * 148 at the usual size, 164 at 1.3. Every screen with the "+" takes it from
 * here (`useFabListClearance`).
 */
export function fabListClearance(textScale: number): number {
  return TOAST_CLEARANCE + Math.ceil(TOAST_MIN_HEIGHT * Math.max(1, textScale)) + space.sm;
}

/**
 * How tall a row's `lead` slot is: its first line with `ROW_PADDING` above and
 * below. The slot hangs from the row's top and centres what it holds, so a
 * checkbox lines up with the title's first line, however many lines follow.
 * `scale` is the text's whole scale, the app's setting times the phone's.
 * 48 at the usual size, a 48-point checkbox control exactly; 55 at 1.3.
 */
export function leadSlotHeight(scale: number): number {
  return 2 * ROW_PADDING + Math.round(type.title * scale * TITLE_LINE);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A list on the ruled page with the red margin line: a 1.5-point line in
 * `margin`, `MARGIN_WIDTH` from the start edge, for the list's full height.
 * Its children are `MarginRow`s. It brings no side padding: put it straight
 * in the scroll view, edge to edge, and the rows bring their own.
 *
 *   <MarginList>
 *     <MarginRow margin="08:00" title="פיזיקה" subtitle="מעבדה" />
 *     <MarginRow margin="10:30" title="מתמטיקה" tone="cancelled" end={<Text>בוטל</Text>} />
 *   </MarginList>
 *
 * `opaque` fills it with the page (`bg`), for a list that stays put while the
 * page scrolls under it (Today's "now", stuck under the stepper): what passes
 * under it is hidden, never seen through it. `raised` adds a soft shadow under
 * it while it is stuck, so the rows read as going under it and not as cut by
 * its dashed rule (run 8, Itai and Daniel).
 */
export function MarginList({ children, style, opaque = false, raised = false }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  opaque?: boolean;
  raised?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[opaque || raised ? { backgroundColor: p.bg } : null, raised ? styles.raised : null, style]}>
      {children}
      <View pointerEvents="none" style={[styles.marginLine, { backgroundColor: p.margin }]} />
    </View>
  );
}

interface RowContentProps {
  /** The row's title: `title` size in `bodySemi`. A string, or a line with `Ltr` or `Mark` in it. */
  title?: React.ReactNode;
  /** The line under the title: `small`, `textMuted`. */
  subtitle?: React.ReactNode;
  /** Anything else in the body, under the title and subtitle (or instead of them). */
  children?: React.ReactNode;
  /**
   * Before the body, at its start: the checkbox of a to-do row, where every
   * to-do list draws it and where the "+" (`Fab`, at the end) never covers
   * it. `MARGIN_LINE + LEAD_GAP` past the margin line (in a `Row`, at the
   * gutter), `LEAD_GAP` before the body, and centred on the title's first
   * line (`leadSlotHeight`). The slot is layout only: a control larger than
   * what it draws (a 48-point target round a 20-point box, `CheckTarget`)
   * reaches into the gaps with negative margins and stays inside the row.
   */
  lead?: React.ReactNode;
  /** At the row's end: a value, a status word, a switch. */
  end?: React.ReactNode;
  /** A chevron at the end: the row opens something. */
  chevron?: boolean;
  tone?: RowTone;
  /**
   * The chosen row, under the highlighter: filled with `mark`, and its title,
   * line, margin and chevron in `onMark` (on the ink page the yellow is
   * near-opaque, and light ink vanishes on it). A node passed as the margin
   * or the line brings its own colour.
   */
  marked?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Extra style for the title (a colour of its own, say). */
  titleStyle?: StyleProp<TextStyle>;
  /** Cuts the title to this many lines. */
  titleLines?: number;
}

export interface MarginRowProps extends RowContentProps, Omit<PressableProps, 'children' | 'style'> {
  /**
   * What the margin says: a time, a period or a date. A string or number is
   * written in `bodySemi` with tabular numerals, through `Ltr`; any other node
   * is drawn as given. Empty for a row that continues the one above.
   */
  margin?: React.ReactNode;
}

/**
 * One ruled row of a `MarginList`: the margin cell (`MARGIN_WIDTH` wide), an
 * optional `lead` (a to-do's checkbox), the body, and an optional `end`. At
 * least `ROW_MIN_HEIGHT` tall, `ROW_PADDING` above and below, a 1-point
 * `border` rule under it; no frame, no fill. With `onPress` it is a
 * `Pressable`, and every accessibility prop passes through.
 *
 * A to-do: the row opens the item, and the box at its start ticks it
 * (`CheckTarget` in components/TaskRow, a `Checkbox` in a 48-point control).
 *
 *   <MarginRow margin="6.10" tone="late" title="מתמטיקה" subtitle="דף עבודה"
 *     lead={<CheckTarget checked={done} label="סימון כבוצע: מתמטיקה" onPress={tick} />}
 *     onPress={open} accessibilityLabel="מתמטיקה, דף עבודה" />
 */
export function MarginRow({ margin, ...rest }: MarginRowProps): React.JSX.Element {
  const p = usePalette();
  const tone = toneStyle(rest.tone ?? 'normal', p);
  const cell = (
    <View style={styles.marginCell}>
      {typeof margin === 'string' || typeof margin === 'number' ? (
        <Ltr style={[styles.marginText, { color: rest.marked ? p.onMark : tone.margin }]}>{margin}</Ltr>
      ) : margin}
    </View>
  );
  return <RowFrame {...rest} cell={cell} />;
}

export type RowProps = RowContentProps & Omit<PressableProps, 'children' | 'style'>;

/**
 * A ruled row without a margin, for settings-like lists: the page's gutter at
 * the start, then an optional `lead`, the body and an optional `end`. Same
 * rule, height and padding as `MarginRow`.
 *
 *   <Row title="מצב חיבורים" subtitle="הכול מחובר" chevron onPress={open} />
 *   <Row title="התראות" end={<Switch value={on} onValueChange={setOn} accessibilityLabel="התראות" />} />
 *   <Row title="לקנות מחברת" lead={<Checkbox value={done} onValueChange={setDone} accessibilityLabel="לקנות מחברת" />} />
 */
export function Row(props: RowProps): React.JSX.Element {
  return <RowFrame {...props} cell={null} />;
}

function RowFrame({
  title, subtitle, children, lead, end, chevron, tone = 'normal', marked = false, style, titleStyle, titleLines, cell, onPress, ...pressable
}: RowProps & { cell: React.ReactNode }): React.JSX.Element {
  const p = usePalette();
  const t = toneStyle(tone, p);
  const leadHeight = leadSlotHeight(useTextScale() * useWindowDimensions().fontScale);
  const hasLead = lead !== undefined && lead !== null && lead !== false;
  const body = (
    <>
      {cell}
      {hasLead ? (
        <View style={[styles.lead, cell ? styles.leadAfterMargin : null, { minHeight: leadHeight }]}>{lead}</View>
      ) : null}
      <View style={[styles.body, hasLead ? styles.bodyAfterLead : cell ? styles.bodyAfterMargin : styles.bodyAlone]}>
        {title !== undefined && title !== null ? (
          <Text
            numberOfLines={titleLines}
            style={[
              styles.title,
              { color: marked ? p.onMark : t.title },
              t.strike ? { textDecorationLine: 'line-through', textDecorationColor: p.cancel } : null,
              titleStyle,
            ]}
          >
            {title}
          </Text>
        ) : null}
        {subtitle !== undefined && subtitle !== null ? (
          typeof subtitle === 'string'
            ? <Text style={[styles.subtitle, { color: marked ? p.onMark : p.textMuted }]}>{subtitle}</Text>
            : <View style={styles.subtitleRow}>{subtitle}</View>
        ) : null}
        {children}
      </View>
      {end !== undefined && end !== null ? <View style={styles.end}>{end}</View> : null}
      {chevron ? <View style={styles.end}><AppIcon name="chevronLeft" color={marked ? p.onMark : p.textFaint} size={20} /></View> : null}
      {t.dashed ? (
        <View pointerEvents="none" style={styles.dashedRule}>
          <Svg width="100%" height={2}>
            <Line x1="0" y1="1" x2="100%" y2="1" stroke={t.rule} strokeWidth={2} strokeDasharray="6 4" />
          </Svg>
        </View>
      ) : null}
    </>
  );
  const frame: StyleProp<ViewStyle> = [
    styles.row,
    { borderBottomColor: t.rule, borderBottomWidth: t.dashed ? 0 : 1 },
    cell ? null : styles.rowAlone,
    marked ? { backgroundColor: p.mark } : null,
    style,
  ];
  if (!onPress) {
    // Not a control, but still a labelled item a test or the screen reader can find.
    const {
      accessible, accessibilityLabel, accessibilityRole, accessibilityState, accessibilityHint, accessibilityValue,
      accessibilityElementsHidden, importantForAccessibility, testID, nativeID,
    } = pressable;
    return (
      <View
        style={frame}
        {...{
          accessible, accessibilityLabel, accessibilityRole, accessibilityState, accessibilityHint, accessibilityValue,
          accessibilityElementsHidden, importantForAccessibility, testID, nativeID,
        }}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      {...pressable}
      onPress={onPress}
      style={({ pressed }) => [frame, pressed ? { backgroundColor: p.accentSoft } : null]}
    >
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/**
 * A highlighter behind words (plan §16.1), in place of a tag: `examSoft` for
 * an exam, `changeSoft` for a change, `okSoft` for something done, `mark` for
 * "this one". No border. The text is `text` (on `mark`, `onMark`: see
 * `markInk`), or takes `color` (the status's own).
 *
 * On its own it is a block with radius 3 and 1/4 padding, as wide as its
 * words (`alignSelf: 'flex-start'`; in a row centred on its cross axis, pass
 * `containerStyle={{ alignSelf: 'center' }}`):
 *
 *   <Mark kind="exam">מבחן באנגלית</Mark>
 *
 * Inside a line of text, pass `inline`: it becomes a span of that line, and
 * a thin space at each end stands in for the padding. (Android draws a
 * span's background but not its radius or padding.)
 *
 *   <Text>חופשי עד 15:15, ואז <Mark kind="ok" inline>שיעור פרטי</Mark></Text>
 */
export function Mark({
  children, kind = 'mark', inline = false, color, style, containerStyle,
}: {
  children: React.ReactNode;
  kind?: MarkKind;
  inline?: boolean;
  /** The text's colour; by default the line's (`inline`) or `text`. Ignored on `mark`, which is always `onMark`. */
  color?: string;
  /** Text style: on its own, the label's font and size (`bodySemi` at `small` by default). */
  style?: StyleProp<TextStyle>;
  /** The block's style, on its own only (its alignment in a row, a margin). */
  containerStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const p = usePalette();
  const fill = markFill(kind, p);
  // On the "this one" yellow, `onMark` whatever the caller or the line says: a light ink, or the
  // lavender pen of the dark page, vanishes on it.
  const ink = onYellow(kind) ? p.onMark : color ?? (inline ? undefined : markInk(kind, p));
  if (inline) {
    return (
      <Text style={[{ backgroundColor: fill }, ink ? { color: ink } : null, style]}>
        {THIN_SPACE}{children}{THIN_SPACE}
      </Text>
    );
  }
  return (
    <View style={[styles.mark, { backgroundColor: fill }, containerStyle]}>
      <Text style={[styles.markText, { color: ink }, style]}>{children}</Text>
    </View>
  );
}

/** U+2009: a quarter of the letters' width or so, the inline mark's padding. */
const THIN_SPACE = ' ';

/**
 * The chosen day, circled in pen (plan §16.1): an imperfect ring in `accent`,
 * 2 points wide, `PEN_OUTSET` past the child on each side. It takes no room:
 * a day with and without it is the same size, so the strip never shifts.
 *
 *   <PenCircle active={date === selected}>
 *     <Text>ה׳</Text><Text>8</Text>
 *   </PenCircle>
 */
export function PenCircle({
  children, active = true, color, style,
}: {
  children: React.ReactNode;
  active?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const p = usePalette();
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const width = box ? box.width + 2 * PEN_OUTSET.x : 0;
  const height = box ? box.height + 2 * PEN_OUTSET.y : 0;
  return (
    <View style={style} onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {children}
      {active && box ? (
        <View pointerEvents="none" style={styles.pen}>
          <Svg width={width} height={height}>
            <Path d={penCirclePath(width, height)} stroke={color ?? p.accent} strokeWidth={2} strokeLinecap="round" fill="none" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * A filter, the one place a pill-like shape stays (plan §16.1): radius 8, a
 * 1-point `border`. Chosen, it is filled with the highlighter and carries a
 * drawn tick, both words and tick in `onMark`. 44 points to tap.
 *
 * By default a `button` with `selected` state: a filter or a toggle. One
 * choice of several (a date, a type, how many sessions) is `role="radio"`,
 * with `checked` state, inside a `View` with `accessibilityRole="radiogroup"`,
 * so a screen reader says "1 of 3" and which one is on.
 *
 *   <FilterChip label="פתוחות" selected={filter === 'open'} onPress={() => setFilter('open')} />
 *   <View accessibilityRole="radiogroup" accessibilityLabel="סוג">
 *     {types.map((t) => (
 *       <FilterChip key={t.id} role="radio" label={t.label} selected={t.id === type} onPress={() => setType(t.id)} />
 *     ))}
 *   </View>
 */
export function FilterChip({
  label, selected, onPress, accessibilityLabel, disabled, role = 'button',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** `radio` for one choice of a group (checked); `button` for a filter or a toggle (selected). */
  role?: FilterChipRole;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={filterChipState(role, selected, Boolean(disabled))}
      disabled={disabled}
      hitSlop={{ top: (MIN_TOUCH - CHIP_HEIGHT) / 2, bottom: (MIN_TOUCH - CHIP_HEIGHT) / 2 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? p.mark : 'transparent',
          borderColor: selected ? 'transparent' : p.border,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {selected ? <AppIcon name="check" color={p.onMark} size={16} /> : null}
      <Text style={[styles.chipText, { fontFamily: selected ? font.bodySemi : font.bodyMedium, color: selected ? p.onMark : p.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const CHIP_HEIGHT = 36;

/**
 * A checkbox (plan §16.1): a 20-point square, a 2-point `text` border, radius
 * 3. Checked, it is filled with `accentFill` and ticked in `onAccentFill`,
 * white on a ballpoint blue in both schemes. `'mixed'` (some of a group) is a
 * bar. It replaces the three-state switch in "המבחנים שלי"; a `Switch` stays
 * for settings only.
 *
 * With `onValueChange` it is its own control: role `checkbox`, its state,
 * a 44-point hit area. Without one it only draws, and the row around it is
 * the control and carries the label and the state:
 *
 *   <Checkbox value={chosen} onValueChange={setChosen} accessibilityLabel="מבחן באנגלית" />
 *   <Row title="אנגלית" end={<Checkbox value={some ? 'mixed' : all} />} onPress={toggle}
 *     accessibilityRole="checkbox" accessibilityState={{ checked: some ? 'mixed' : all }} />
 */
export function Checkbox({
  value, onValueChange, disabled, accessibilityLabel,
}: {
  value: CheckValue;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const p = usePalette();
  const filled = value !== false;
  const box = (
    <View
      style={[
        styles.checkbox,
        { borderColor: filled ? p.accentFill : p.text, backgroundColor: filled ? p.accentFill : 'transparent', opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {filled ? (
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke={p.onAccentFill} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          {value === 'mixed' ? <Path d="M3 7h8" /> : <Path d="m2.5 7.2 3 3 6-6.4" />}
        </Svg>
      ) : null}
    </View>
  );
  if (!onValueChange) {
    return <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{box}</View>;
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={touchSlop(CHECKBOX_SIZE)}
      onPress={() => onValueChange(checkboxNext(value))}
    >
      {box}
    </Pressable>
  );
}

/**
 * The add button: Android's round "+", `FAB.size` (56) across, the icon alone
 * in `onAccentFill` on `accentFill`, `FAB.inset` from the end edge (the left,
 * on the phone) and `FAB.margin` above the tab bar. Its name is spoken only:
 * "משימה חדשה" unless the screen says more ("משימה חדשה להיום"). Narrower
 * than the extended "+ משימה" it was, it covers less of the rows under it (the
 * Wave 9 re-rate). A list under it still ends `fabListClearance` (or
 * `useFabListClearance()`) above the bottom, so its last row is never hidden
 * behind the button or a toast.
 *
 * `shown` false fades it out and takes it out of reach and of the screen
 * reader, for a list that hides it while reading down (Today, W5-6).
 *
 *   <Fab accessibilityLabel="משימה חדשה להיום" onPress={compose} shown={fabShown} />
 */
export function Fab({
  onPress, accessibilityLabel = FAB_LABEL, shown = true,
}: {
  onPress: () => void;
  accessibilityLabel?: string;
  shown?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const anim = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    // The web preview draws no animation (a hidden pane pauses its frames; see Sheet).
    if (Platform.OS === 'web') {
      anim.setValue(shown ? 1 : 0);
      return;
    }
    Animated.timing(anim, { toValue: shown ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [anim, shown]);
  return (
    <Animated.View
      pointerEvents={shown ? 'box-none' : 'none'}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!shown}
      style={[styles.fab, { opacity: anim, transform: [{ scale: anim }] }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [styles.fabButton, { backgroundColor: p.accentFill, opacity: pressed ? 0.85 : 1 }]}
      >
        <AppIcon name="plus" color={p.onAccentFill} size={28} />
      </Pressable>
    </Animated.View>
  );
}

/** The "+"'s spoken name when the screen gives none. */
export const FAB_LABEL = 'משימה חדשה';

/** `fabListClearance` at the app's text size right now. */
export function useFabListClearance(): number {
  return fabListClearance(useTextScale());
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/**
 * The top bar of a tab (plan §16.1): the screen's title in the display face
 * (`font.display` at `type.display`), shrunk to fit one line when it is long;
 * an optional subtitle under it (`small`, `textMuted`; a string, or a row with
 * `Ltr` dates in it); and actions at the end. `TabHeader` puts the bell and
 * the gear there. It sits first in `Screen`, outside the scroll.
 *
 *   <AppBar title="משימות" subtitle="3 פתוחות" end={<IconButton … />} />
 */
export function AppBar({
  title, subtitle, end, style,
}: {
  title: string;
  subtitle?: React.ReactNode;
  end?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[styles.appBar, style]}>
      <View style={styles.appBarTitles}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[styles.appBarTitle, { color: p.text }]}
        >
          {title}
        </Text>
        {subtitle !== undefined && subtitle !== null ? (
          typeof subtitle === 'string'
            ? <Text numberOfLines={1} style={[styles.appBarSubtitle, { color: p.textMuted }]}>{subtitle}</Text>
            : <View style={styles.subtitleRow}>{subtitle}</View>
        ) : null}
      </View>
      {end ? <View style={styles.appBarEnd}>{end}</View> : null}
    </View>
  );
}

/** One tab of an `UnderlineTabs` row. */
export interface UnderlineTab<K extends string = string> {
  key: K;
  label: string;
  /** A count after the label (new grades); none at 0. */
  badge?: number;
  /** The tab's spoken name, when it says more than the label (the count, say). */
  accessibilityLabel?: string;
}

/**
 * Sub-tabs (plan §16.1): labels in `bodySemi` on a ruled line, the chosen one
 * in `text` with a 3-point `accent` underline, the others `textMuted`. Each is
 * a `tab` with `selected` state. Laid out by `SCHOOL_TAB_ROW` (so the School
 * test measures what is drawn): all five fit a 360-point phone at the usual
 * size. When they do not (a larger size, a badge), the row scrolls, keeps the
 * chosen tab in view, and fades at its end with a chevron until scrolled there.
 *
 *   <UnderlineTabs tabs={SCHOOL_TABS} selected={tab} onSelect={setTab} />
 */
export function UnderlineTabs<K extends string>({
  tabs, selected, onSelect, style,
}: {
  tabs: readonly UnderlineTab<K>[];
  selected: K;
  onSelect: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const p = usePalette();
  const gradient = `tabFade${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const row = useRef<ScrollView>(null);
  const boxes = useRef<Partial<Record<K, { x: number; width: number }>>>({});
  const size = useRef({ viewport: 0, content: 0 });
  const [fit, setFit] = useState({ viewport: 0, content: 0 });
  const [atEnd, setAtEnd] = useState(false);
  const overflow = fit.viewport > 0 && fit.content > fit.viewport + 1;
  const current = useRef(selected);
  current.current = selected;

  // The chosen tab to the middle, or as near as the row's ends allow (W5-8:
  // "הוד" of "הודעות" was cut at a large size). A browser in right-to-left
  // counts its scroll from the right edge; Android from the left.
  const reveal = useCallback(() => {
    const box = boxes.current[current.current];
    const { viewport, content } = size.current;
    if (!box || viewport <= 0 || content <= viewport) return;
    row.current?.scrollTo({ x: tabScrollOffset(box, viewport, content, Platform.OS === 'web'), animated: true });
  }, []);
  useEffect(() => {
    reveal();
  }, [selected, reveal]);

  return (
    <View style={[styles.tabsRow, { borderBottomColor: p.border }, style]}>
      <ScrollView
        ref={row}
        horizontal
        // While a search or a bagrut field has the keyboard, a tap on a tab is the tab's.
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={[styles.tabsContent, { paddingEnd: overflow ? SCHOOL_TAB_ROW.fade : SCHOOL_TAB_ROW.paddingEnd }]}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const { viewport, content } = size.current;
          setAtEnd(tabRowAtEnd(e.nativeEvent.contentOffset.x, viewport, content, Platform.OS === 'web'));
        }}
        onLayout={(e) => {
          size.current.viewport = e.nativeEvent.layout.width;
          setFit({ ...size.current });
          reveal();
        }}
        onContentSizeChange={(width) => {
          size.current.content = width;
          setFit({ ...size.current });
          reveal();
        }}
      >
        {tabs.map((t) => {
          const active = t.key === selected;
          const badge = t.badge ?? 0;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.accessibilityLabel ?? t.label}
              onPress={() => onSelect(t.key)}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                boxes.current[t.key] = { x, width };
                if (t.key === current.current) reveal();
              }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View>
                <View style={styles.tabLabelRow}>
                  <Text style={[styles.tabLabel, { color: active ? p.text : p.textMuted }]}>{t.label}</Text>
                  {badge > 0 ? (
                    <View style={[styles.tabBadge, { backgroundColor: p.accent }]}>
                      <Text maxScale={1.15} style={[styles.tabBadgeText, { color: p.onAccent }]}>{String(badge)}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.underline, { backgroundColor: active ? p.accent : 'transparent' }]} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {overflow && !atEnd ? (
        <View pointerEvents="none" style={styles.tabsFade}>
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={p.bg} stopOpacity={1} />
                <Stop offset="0.45" stopColor={p.bg} stopOpacity={0.9} />
                <Stop offset="1" stopColor={p.bg} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradient})`} />
          </Svg>
          <View style={styles.tabsFadeArrow}>
            <AppIcon name="chevronLeft" color={p.textMuted} size={20} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A section's title on the page (plan §16.1): `headingSemi` at `title` size
 * in `text`, no letter-spacing, with an optional `end` (a count, a link).
 * The same look as `SectionTitle` in ui.tsx, which older screens still use.
 *
 *   <SectionHeading end={<Text>2</Text>}>באיחור</SectionHeading>
 *
 * With `onPress` (an `end` that is an action, "להציג"), the whole row is the
 * control to a finger: a tap on the title does what the end does, so the
 * action is never reachable only under the round "+" at the end side (run
 * 8). To a screen reader nothing changes: the title stays a header, and the
 * end its own button with its own label.
 *
 *   <SectionHeading end={showButton} onPress={show}>ליום ראשון להגשה</SectionHeading>
 */
export function SectionHeading({ children, end, onPress }: {
  children: React.ReactNode;
  end?: React.ReactNode;
  /** What a tap anywhere on the row does: the same as the `end` action. */
  onPress?: () => void;
}): React.JSX.Element {
  if (!onPress) return <SectionTitle action={end}>{children}</SectionTitle>;
  return (
    <Pressable accessible={false} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <SectionTitle action={end}>{children}</SectionTitle>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  marginLine: {
    position: 'absolute', top: 0, bottom: 0, insetInlineStart: MARGIN_WIDTH, width: MARGIN_LINE,
  },
  // A list stuck over the scrolling page: a shadow under its bottom edge only, softer than the "+".
  raised: {
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: ROW_MIN_HEIGHT,
    paddingEnd: ROW_END,
  },
  rowAlone: { paddingStart: ROW_GUTTER },
  marginCell: {
    width: MARGIN_WIDTH,
    paddingVertical: ROW_PADDING,
    alignItems: 'center',
  },
  marginText: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  body: { flex: 1, paddingVertical: ROW_PADDING, gap: 2 },
  bodyAfterMargin: { paddingStart: MARGIN_LINE + space.md },
  bodyAfterLead: { paddingStart: LEAD_GAP },
  bodyAlone: {},
  // Hangs from the row's top, `leadSlotHeight` tall: what it centres sits on the title's first line.
  lead: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  leadAfterMargin: { marginStart: MARGIN_LINE + LEAD_GAP },
  title: { fontFamily: font.bodySemi, fontSize: type.title },
  subtitle: { fontFamily: font.body, fontSize: type.small },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  end: { alignSelf: 'center', paddingStart: space.md },
  dashedRule: { position: 'absolute', bottom: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 2 },
  mark: { alignSelf: 'flex-start', borderRadius: 3, paddingVertical: 1, paddingHorizontal: 4 },
  markText: { fontFamily: font.bodySemi, fontSize: type.small },
  pen: {
    position: 'absolute', top: -PEN_OUTSET.y, insetInlineStart: -PEN_OUTSET.x,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: { fontSize: type.label },
  checkbox: {
    width: CHECKBOX_SIZE, height: CHECKBOX_SIZE, borderRadius: 3, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  fab: { position: 'absolute', insetInlineEnd: FAB.inset, bottom: FAB.margin },
  fabButton: {
    width: FAB.size,
    height: FAB.size,
    borderRadius: FAB.size / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingStart: space.xl,
    paddingEnd: space.xs,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  appBarTitles: { flex: 1 },
  appBarTitle: { fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.3) },
  appBarSubtitle: { fontFamily: font.body, fontSize: type.small },
  appBarEnd: { flexDirection: 'row', alignItems: 'center' },
  tabsRow: { borderBottomWidth: 1 },
  // A ScrollView grows by default; next to the content list it took half the screen (memory: RTL facts).
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabsContent: { flexDirection: 'row', gap: SCHOOL_TAB_ROW.gap, paddingStart: SCHOOL_TAB_ROW.paddingStart },
  tab: {
    minWidth: MIN_TOUCH,
    minHeight: 48,
    justifyContent: 'flex-end',
    paddingHorizontal: SCHOOL_TAB_ROW.chipPadding,
    paddingTop: space.md,
  },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabLabel: { fontFamily: font.bodySemi, fontSize: type.label },
  tabBadge: { minWidth: 20, minHeight: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontFamily: font.bodySemi, fontSize: 12, lineHeight: 16 },
  underline: { height: 3, borderRadius: 1.5, marginTop: space.sm },
  tabsFade: { position: 'absolute', top: 0, bottom: 0, insetInlineEnd: 0, width: SCHOOL_TAB_ROW.fade },
  tabsFadeArrow: { position: 'absolute', top: 0, bottom: 0, insetInlineEnd: 4, justifyContent: 'center' },
});
