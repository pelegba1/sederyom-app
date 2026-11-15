/**
 * Shared primitives. Everything visual in the app is built from these so the
 * UI kit's tokens are applied in exactly one place.
 */
import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Appearance, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput as RNTextInput,
  useColorScheme, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTextScale, getThemePreference, setTextScale as saveTextScale, setThemePreference } from '../lib/prefs';
import { textBase, withTextBase } from '../lib/textBase';
import {
  dark, font, paletteFor, radius, resolveScheme, scaledSize, space, TEXT_SCALES, type,
  type ColorScheme, type Palette, type TextScale, type ThemePreference,
} from '../theme';
import { AppIcon, type IconName } from './AppIcon';

interface Theme {
  palette: Palette;
  scheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  textScale: TextScale;
  setTextScale: (scale: TextScale) => void;
}

// Outside a provider (never in the app): dark, as the UI kit's default.
const ThemeContext = createContext<Theme | null>(null);

/**
 * Lets the platform's own surfaces — alerts, pickers, the modal sheets — match
 * the app rather than the phone. Android drives this through AppCompat's night
 * mode; the activity declares `uiMode` in its configChanges, so it is not
 * recreated. A platform without the call (the web build) keeps its own scheme.
 */
function applyNativeScheme(preference: ThemePreference): void {
  if (typeof Appearance.setColorScheme !== 'function') return;
  try {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  } catch {
    // Cosmetic only: the app's own palette already follows the preference.
  }
}

/**
 * The palette for the whole app: light or dark as chosen in settings
 * (`useThemePreference`), and the phone's own setting until anything is.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const device = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(getThemePreference);
  const scheme = resolveScheme(preference, device);

  useEffect(() => applyNativeScheme(preference), [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setThemePreference(next);
    setPreferenceState(next);
  }, []);

  const [textScale, setTextScaleState] = useState<TextScale>(getTextScale);
  const setTextScale = useCallback((next: TextScale) => {
    saveTextScale(next);
    setTextScaleState(next);
  }, []);

  const theme = useMemo<Theme>(
    () => ({ palette: paletteFor(scheme), scheme, preference, setPreference, textScale, setTextScale }),
    [scheme, preference, setPreference, textScale, setTextScale],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function usePalette(): Palette {
  return useContext(ThemeContext)?.palette ?? dark;
}

/** The scheme the app is drawn in right now, after the preference is applied. */
export function useScheme(): ColorScheme {
  return useContext(ThemeContext)?.scheme ?? 'dark';
}

const noPreference = { preference: 'system' as ThemePreference, setPreference: (): void => undefined };

/**
 * The appearance setting (plan R-26 / R-32): `'light' | 'dark' | 'system'`,
 * saved on the phone. Changing it redraws the app at once.
 *
 *   const { preference, setPreference } = useThemePreference();
 *   setPreference('light');
 */
export function useThemePreference(): { preference: ThemePreference; setPreference: (preference: ThemePreference) => void } {
  const theme = useContext(ThemeContext);
  if (!theme) {
    if (__DEV__) console.warn('useThemePreference() outside <ThemeProvider>: the setting is ignored');
    return noPreference;
  }
  return { preference: theme.preference, setPreference: theme.setPreference };
}

/** The factor every `Text` and `TextInput` below applies right now: 1, 1.15 or 1.3. */
export function useTextScale(): number {
  const theme = useContext(ThemeContext);
  return theme ? TEXT_SCALES[theme.textScale] : 1;
}

const noTextScale = { scale: 'normal' as TextScale, setScale: (): void => undefined };

/**
 * The text-size setting (plan W4-2): `'normal' | 'large' | 'xlarge'`, saved on
 * the phone. Changing it redraws every scaled `Text` at once.
 *
 *   const { scale, setScale } = useTextScalePreference();
 *   setScale('large');
 */
export function useTextScalePreference(): { scale: TextScale; setScale: (scale: TextScale) => void } {
  const theme = useContext(ThemeContext);
  if (!theme) {
    if (__DEV__) console.warn('useTextScalePreference() outside <ThemeProvider>: the setting is ignored');
    return noTextScale;
  }
  return { scale: theme.textScale, setScale: theme.setTextScale };
}

/**
 * `style` with its `fontSize` and `lineHeight` multiplied by `factor` (capped
 * at `maxScale`). Untouched at 1, and when the style sets neither — a nested
 * `Text` without a size inherits its parent's, which is already scaled.
 */
export function scaleTextStyle(style: StyleProp<TextStyle>, factor: number, maxScale?: number): StyleProp<TextStyle> {
  if (factor === 1) return style;
  const flat = StyleSheet.flatten(style);
  if (!flat) return style;
  const extra: TextStyle = {};
  if (typeof flat.fontSize === 'number') extra.fontSize = scaledSize(flat.fontSize, factor, maxScale);
  if (typeof flat.lineHeight === 'number') extra.lineHeight = scaledSize(flat.lineHeight, factor, maxScale);
  return extra.fontSize === undefined && extra.lineHeight === undefined ? style : [style, extra];
}

export interface ScaledTextProps extends TextProps {
  /**
   * Caps the in-app text size for this text — a cell of fixed size that would
   * overflow at 1.3 takes `maxScale={1.15}`. The phone's own scale still applies.
   */
  maxScale?: number;
}

/** iOS only: right-to-left paragraphs, under the caller's style (`lib/textBase.ts`). */
const TEXT_BASE = textBase(Platform.OS, 'text');
const INPUT_BASE = textBase(Platform.OS, 'input');

/**
 * The app's `Text`: React Native's, sized by the in-app text setting, and on
 * the iPhone right-to-left whatever the phone's language. Import it from
 * here, never from 'react-native' (`app/test/text-imports.test.cjs`).
 */
export const Text = forwardRef<React.ComponentRef<typeof RNText>, ScaledTextProps>(function Text({ style, maxScale, ...rest }, ref) {
  const factor = useTextScale();
  return <RNText ref={ref} {...rest} style={withTextBase(TEXT_BASE, scaleTextStyle(style, factor, maxScale))} />;
});

export interface ScaledTextInputProps extends TextInputProps {
  maxScale?: number;
}

/** The app's `TextInput`, sized by the in-app text setting like `Text`. Keeps `ref` (focus). */
export const TextInput = forwardRef<React.ComponentRef<typeof RNTextInput>, ScaledTextInputProps>(function TextInput({ style, maxScale, ...rest }, ref) {
  const factor = useTextScale();
  return <RNTextInput ref={ref} {...rest} style={withTextBase(INPUT_BASE, scaleTextStyle(style, factor, maxScale))} />;
});

/**
 * The app's one switch (plan W4-3), drawn in place of the native one — which
 * mirrors badly under RTL and looked different on every screen. Off rests at
 * the start (right), on travels to the end (left), `'mixed'` (some of a group
 * on) sits in the middle.
 *
 * With `onValueChange` it is its own control: role `switch`, a 44-point hit
 * area, and pressing a mixed switch turns it on. Without one it only draws —
 * the row around it is the control and carries the label and the state:
 *
 *   <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={toggle}>
 *     <Text>…</Text>
 *     <Switch value={on} />
 *   </Pressable>
 */
export function Switch({
  value, onValueChange, disabled, accessibilityLabel,
}: {
  value: boolean | 'mixed';
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const p = usePalette();
  const track = (
    <View
      style={[
        styles.track,
        // Off is an outline with a muted thumb: a filled grey track all but
        // vanished on the dark surface (Daniel, run 3). Mixed is an accent
        // outline with the thumb in the middle: a filled track read as plain
        // "on" (Daniel, run 4: 6 of 7 exams looked all on).
        value === false
          ? { backgroundColor: 'transparent', borderWidth: 2, borderColor: p.textMuted, padding: 1 }
          : value === 'mixed'
            ? { backgroundColor: p.accentSoft, borderWidth: 2, borderColor: p.accent, padding: 1 }
            : { backgroundColor: p.accent },
        { opacity: disabled ? 0.45 : 1 },
      ]}
    >
      <View
        style={[
          styles.thumb,
          {
            // On: a white thumb in both themes; the surface colour is near-black
            // in dark and read as "off" (Itai, run 5).
            backgroundColor: value === false ? p.textMuted : value === 'mixed' ? p.accent : '#FFFFFF',
            alignSelf: value === 'mixed' ? 'center' : value ? 'flex-end' : 'flex-start',
          },
        ]}
      />
    </View>
  );
  if (!onValueChange) {
    return <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{track}</View>;
  }
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={{ top: touchSlop(SWITCH_HEIGHT), bottom: touchSlop(SWITCH_HEIGHT), left: touchSlop(SWITCH_WIDTH), right: touchSlop(SWITCH_WIDTH) }}
      onPress={() => onValueChange(value !== true)}
    >
      {track}
    </Pressable>
  );
}

const SWITCH_WIDTH = 40;
const SWITCH_HEIGHT = 22;

/**
 * Numbers, clock times and dates must not be reordered by the RTL algorithm
 * when they sit inside a Hebrew line — "08:00–08:45" would flip. Every numeric
 * run in the app goes through here (UI kit, section 09).
 *
 * The Unicode isolate pair (U+2066 … U+2069) is what pins the run to
 * left-to-right on both platforms: zero-width, and the bidi algorithm treats
 * everything between them as one left-to-right block. `Ltr` sets no
 * `writingDirection` of its own: Android ignores it, and on iOS it is a
 * paragraph attribute, so `'ltr'` here would turn a Hebrew line starting with
 * an `Ltr` run into an LTR paragraph. (On iOS every `Text` is `'rtl'` by its
 * base, `lib/textBase.ts`; the isolates keep this run in order inside it.)
 */
export function Ltr({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }): React.JSX.Element {
  return (
    <Text style={[styles.ltr, style]}>
      {'⁦'}
      {children}
      {'⁩'}
    </Text>
  );
}

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const p = usePalette();
  return (
    <SafeAreaView edges={['top']} style={[{ flex: 1, direction: 'rtl', backgroundColor: p.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

/**
 * The one raised surface a screen may have, for its main content (plan
 * §16.1): filled `surfaceAlt`, radius 12, no border. Everything else sits on
 * the page in ruled rows (`Row`, `MarginRow` in components/notebook). Never
 * a card inside a card.
 */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[{ backgroundColor: p.surfaceAlt, borderRadius: radius.md, padding: space.lg }, style]}>
      {children}
    </View>
  );
}

/**
 * A section's title on the page: `headingSemi` at `title` size in `text`, no
 * letter-spacing, with an optional `action` at its end. The look of
 * `SectionHeading` (components/notebook), which new code uses.
 */
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.sectionRow}>
      <Text accessibilityRole="header" style={{ flexShrink: 1, fontFamily: font.headingSemi, fontSize: type.title, color: p.text }}>{children}</Text>
      {action}
    </View>
  );
}

export interface ChipProps {
  label: React.ReactNode;
  /** The text (and dot) colour: a status's own. */
  color?: string;
  /** The highlighter behind it: a status's soft tint. None by default. */
  soft?: string;
  /** Not drawn since plan §16 (a mark has no border); kept so callers compile. */
  border?: string;
  dot?: boolean;
}

/**
 * A short status label, drawn as a mark (plan §16.1): the words on a
 * highlighter (`soft`), radius 3, no border and no pill; the optional dot
 * in front in the text's colour. Without `soft` it is coloured text alone.
 * New code reaches for `Mark` in components/notebook.
 */
export function Chip({ label, color, soft, dot = true }: ChipProps): React.JSX.Element {
  const p = usePalette();
  const fg = color ?? p.textMuted;
  return (
    <View style={[styles.chip, { backgroundColor: soft ?? 'transparent' }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: fg }]} /> : null}
      <Text style={{ fontFamily: font.bodySemi, fontSize: type.caption, color: fg }}>{label}</Text>
    </View>
  );
}

/**
 * A button (plan §16.1). `primary`: filled `accentFill`, radius 12, at least
 * 48 tall, `onAccentFill` text (a saturated blue with white on it in both
 * schemes). `ghost`: `accent` text alone, no border. `danger`: `cancel` text
 * alone. Both text buttons keep a 44-point target.
 */
export function Button({
  title, onPress, variant = 'primary', disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const primary = variant === 'primary';
  const fg = primary ? p.onAccentFill : variant === 'danger' ? p.cancel : p.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        primary ? styles.button : styles.textButton,
        { backgroundColor: primary ? p.accentFill : 'transparent', opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: fg, textAlign: 'center' }}>{title}</Text>
    </Pressable>
  );
}

export function Loading({ label = 'טוען…' }: { label?: string }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={p.accent} />
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, marginTop: space.md }}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.center}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.cancel, textAlign: 'center' }}>לא הצלחנו לטעון</Text>
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, textAlign: 'center', marginTop: space.sm }}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: space.lg }}>
          <Button title="לנסות שוב" onPress={onRetry} variant="ghost" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * What a list shows when it has nothing. Say what is missing and, when there
 * is something to do about it, offer it: "לא בחרת עדיין מבחנים" + "לבחירה".
 * On the page: a bare line icon (no tile behind it), the text, and the way
 * forward as a text button.
 */
export function EmptyState({
  text, icon, action,
}: {
  text: string;
  /** A line icon above the text. */
  icon?: IconName;
  /** One way forward, drawn as a text button under the text. */
  action?: { label: string; onPress: () => void };
}): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
      {icon ? <View style={{ marginBottom: space.md }}><AppIcon name={icon} color={p.textFaint} size={28} /></View> : null}
      <Text style={[{ fontFamily: font.body, fontSize: type.body, color: p.textMuted }, icon || action ? { textAlign: 'center' } : null]}>{text}</Text>
      {action ? (
        <View style={{ marginTop: space.sm }}>
          <Button title={action.label} onPress={action.onPress} variant="ghost" />
        </View>
      ) : null}
    </View>
  );
}

/** The smallest touch target (plan §1.8): 44×44 points. */
export const MIN_TOUCH = 44;

/**
 * The `hitSlop` that grows a `size`-point control to `MIN_TOUCH` on every
 * side — a 22-point checkbox gets 11. Zero for anything already large enough.
 */
export function touchSlop(size: number): number {
  return Math.max(0, Math.ceil((MIN_TOUCH - size) / 2));
}

/** A ruled line across the page, in `border` (the notebook's line). */
export function Divider(): React.JSX.Element {
  const p = usePalette();
  return <View style={{ height: 1, backgroundColor: p.border, marginVertical: space.md }} />;
}

export { ScrollView };

const styles = StyleSheet.create({
  // No `writingDirection: 'ltr'`: it is a paragraph attribute on iOS, so an `Ltr` run at the start of a Hebrew line would flip the whole paragraph to LTR. The isolates do the job; on iOS the paragraph stays 'rtl' from `Text`'s base.
  ltr: {},
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.md,
  },
  // A mark: the highlighter's radius and padding, no border (plan §16.1).
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  track: { width: SWITCH_WIDTH, height: SWITCH_HEIGHT, borderRadius: SWITCH_HEIGHT / 2, padding: 3, justifyContent: 'center' },
  thumb: { width: 16, height: 16, borderRadius: 8 },
  button: {
    minHeight: 48,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
});
