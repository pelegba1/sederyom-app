/**
 * Design tokens: the "notebook" language of plan §16 (Wave 9). This is the
 * single source of colour and type for the app and the widgets; no screen
 * defines its own palette.
 *
 * The page is a school notebook. Light is a white ruled page, dark is a page
 * of dark ink; the same marks work on both:
 * - `border` is the ruled line, `margin` the red margin line at the start edge.
 * - `accent` is the blue ballpoint: links, text buttons, the chosen day. A
 *   control filled with it (the primary button, the "+", a ticked box) takes
 *   `accentFill` with `onAccentFill` on it: on the ink page the lavender
 *   `accent` read as a pastel fill, so the fill there is a saturated blue.
 * - `cancel` is the teacher's red pen: cancelled lessons, late work.
 * - `exam` is ink, `examSoft` the yellow highlighter behind it; `mark` is a
 *   highlighter for the active tab and other "this one" marks, with `onMark`
 *   on it. On the ink page `mark` is near-opaque, so it stays yellow.
 * - `change` is magenta ink on a pink highlighter: a changed lesson.
 *
 * Kept in place by app/test/theme.test.cjs (plan R-31):
 * - every text token is AA (4.5:1) on bg, surface and surfaceAlt;
 * - `textFaint` is at least 5.5:1 on bg and surface, one step quieter than muted;
 * - struck text on a cancelled lesson and the "בוטל" label meet AA on `cancelSoft`;
 * - every status colour is AA as text on the page and on its own highlighter;
 * - `onMark` on `mark` and `onAccentFill` on `accentFill` are AA, and dark
 *   `mark` is light enough to read as yellow.
 */

export const dark = {
  bg: '#141829',
  bgDeep: '#0E1120',
  surface: '#1A1F33',
  surfaceAlt: '#171B2E',
  border: '#2B3253',
  borderSoft: '#232A45',
  text: '#E8EBF4',
  textStrong: '#F4F6FB',
  textMuted: '#AAB1C8',
  textFaint: '#99A1BA',
  accent: '#93A8FF',
  onAccent: '#0E1430',
  /** A control filled with the pen (primary button, "+", a ticked box): ballpoint blue, not the lavender `accent`. */
  accentFill: '#4060E4',
  /** Text and ticks on `accentFill`. */
  onAccentFill: '#FFFFFF',
  accentSoft: 'rgba(147,168,255,.13)',
  /** Keyboard / accessibility focus ring. */
  focus: '#93A8FF',
  change: '#FF8CC6',
  changeSoft: 'rgba(255,120,190,.13)',
  /** Homework as a filled mark (the planning grid): a shape, not text. */
  homeworkMark: '#F0A53A',
  changeBorder: 'rgba(255,140,198,.32)',
  cancel: '#FF8C80',
  cancelSoft: 'rgba(255,110,100,.12)',
  cancelBorder: 'rgba(255,140,128,.32)',
  exam: '#FFD84D',
  examSoft: 'rgba(255,216,77,.14)',
  examBorder: 'rgba(255,216,77,.38)',
  ok: '#74D6A0',
  okSoft: 'rgba(116,214,160,.12)',
  okBorder: 'rgba(116,214,160,.30)',
  /** The red margin line at the start edge of a ruled page. A line, never text. */
  margin: 'rgba(240,96,108,.55)',
  /**
   * The yellow highlighter: the active tab, a chosen chip, "this one". A fill,
   * never text. Near-opaque on the ink page: a translucent yellow over it read
   * as olive (the Wave 9 re-rate).
   */
  mark: '#E8C547',
  /** The ink on `mark`: dark on the yellow, in both schemes. */
  onMark: '#141829',
} as const;

export const light = {
  bg: '#FFFFFF',
  bgDeep: '#F1F3F8',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F8FC',
  border: '#D6E0EE',
  borderSoft: '#E5EBF4',
  text: '#1A2347',
  textStrong: '#0F1636',
  textMuted: '#4A5472',
  textFaint: '#5A6482',
  accent: '#2347C5',
  onAccent: '#FFFFFF',
  /** A control filled with the pen; on the white page the pen itself. */
  accentFill: '#2347C5',
  onAccentFill: '#FFFFFF',
  accentSoft: 'rgba(35,71,197,.08)',
  /** Keyboard / accessibility focus ring. */
  focus: '#2347C5',
  // Status colours double as text, so each clears AA on the page and on its
  // own highlighter.
  change: '#A3216A',
  changeSoft: 'rgba(240,80,160,.13)',
  /**
   * Homework as a filled mark. A shape needs 3:1: this amber has 3.4:1 or
   * more on the page, an exam day's highlighter and the chosen day's tint.
   */
  homeworkMark: '#C46A00',
  changeBorder: 'rgba(163,33,106,.30)',
  cancel: '#B3261A',
  cancelSoft: 'rgba(232,80,91,.10)',
  cancelBorder: 'rgba(179,38,26,.30)',
  exam: '#5E4A00',
  examSoft: 'rgba(255,210,0,.38)',
  examBorder: 'rgba(200,160,0,.55)',
  ok: '#1E7346',
  okSoft: 'rgba(60,190,110,.14)',
  okBorder: 'rgba(30,115,70,.28)',
  /** The red margin line at the start edge of a ruled page. A line, never text. */
  margin: 'rgba(232,80,91,.55)',
  /** The yellow highlighter: the active tab, a chosen chip, "this one". A fill, never text. */
  mark: 'rgba(255,214,0,.45)',
  /** The ink on `mark`. */
  onMark: '#1A2347',
} as const;

export type Palette = typeof dark;

/** What the app is drawn in. */
export type ColorScheme = 'light' | 'dark';

/** The user's choice in settings (plan R-32); `system` follows the phone. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The choices in the order plan R-26 lists them: בהיר / כהה / לפי הטלפון. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The scheme to draw: the user's choice, or else the phone's. A phone that
 * reports nothing gets light, the white page (plan §16).
 */
export function resolveScheme(preference: ThemePreference, device: string | null | undefined): ColorScheme {
  if (preference !== 'system') return preference;
  return device === 'dark' ? 'dark' : 'light';
}

export function paletteFor(scheme: ColorScheme): Palette {
  return scheme === 'light' ? (light as unknown as Palette) : dark;
}

/**
 * Assistant for everything, numbers included, so a time looks the same in a
 * sentence and on its own (plan §16). Secular One (`display`, one weight) only
 * for a screen's title and a hero number: the days to an exam, an average, the
 * week's range. The `heading*` names stay so existing screens keep working;
 * they are Assistant's heavier weights now.
 */
export const font = {
  display: 'SecularOne_400Regular',
  heading: 'Assistant_800ExtraBold',
  headingMedium: 'Assistant_600SemiBold',
  headingSemi: 'Assistant_700Bold',
  body: 'Assistant_400Regular',
  bodyMedium: 'Assistant_500Medium',
  bodySemi: 'Assistant_600SemiBold',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/**
 * The round "+" on the list tabs (`Fab` in components/notebook): its size
 * across, its distance from the bottom of the screen (on a tab, from the top
 * of the tab bar), and from the end edge of the screen (plan §16.1).
 */
export const FAB = { size: 56, margin: space.xl, inset: space.lg } as const;

/**
 * How far above the tab bar a toast's bottom edge floats (plan R-33), so it
 * never covers the FAB or a bottom row of buttons (a 44-point button on a
 * 16-point margin): 20 + 56 + 12 = 88.
 */
export const TOAST_CLEARANCE = FAB.margin + FAB.size + space.md;

/** A toast's least height; its text, and so its height, grows with the text size. */
export const TOAST_MIN_HEIGHT = 52;

/**
 * The hard floor (plan §1.8): nothing in the app is set smaller than this,
 * hand-set sizes included. The scale itself starts one step above it.
 */
export const MIN_FONT_SIZE = 12;

/**
 * Font sizes. New and reworked UI takes its sizes from here. `caption` is the
 * smallest step (footnotes and tab labels included) and `small` the usual
 * size for secondary lines (plan R-31: 12 and 13 were the text testers
 * skipped). Assistant draws about one point smaller than Heebo did, so the
 * whole scale sits one step above Heebo's 13/14/14/15/17/20/25 (plan §16).
 * The week grid starts at `caption` and steps down to the floor only where a
 * column needs it (`GRID_FONT_SIZES` in planning.ts), measured with
 * Assistant's widths.
 *
 * A list row has three roles, and they must look different: its title is
 * `title` in `bodySemi`, its line under it `small` in `body` and `textMuted`,
 * and a value at its end (a grade, a date, a count) `title` or larger in
 * `headingSemi`. Not everything is `small`.
 */
export const type = {
  caption: 14,
  small: 15,
  label: 15,
  body: 16,
  title: 18,
  heading: 21,
  display: 30,
} as const;

/**
 * The in-app text size (plan W4-2), on top of the phone's own font scale:
 * every `Text` and `TextInput` from `components/ui` multiplies its `fontSize`
 * and `lineHeight` by the chosen factor.
 */
export type TextScale = 'normal' | 'large' | 'xlarge';

export const TEXT_SCALES: Readonly<Record<TextScale, number>> = { normal: 1, large: 1.15, xlarge: 1.3 };

/** The settings row's wording, in order. */
export const TEXT_SCALE_LABELS: Readonly<Record<TextScale, string>> = { normal: 'רגיל', large: 'גדול', xlarge: 'גדול מאוד' };

export function isTextScale(value: unknown): value is TextScale {
  return value === 'normal' || value === 'large' || value === 'xlarge';
}

/** `size` at `factor`, to the half point; `factor` is capped by `maxScale` when one is given. */
export function scaledSize(size: number, factor: number, maxScale?: number): number {
  const k = maxScale === undefined ? factor : Math.min(factor, maxScale);
  return Math.round(size * k * 2) / 2;
}

import type { LessonStatus } from '@sederyom/shared';

export interface StatusStyle {
  color: string;
  soft: string;
  border: string;
  label: string;
  strike: boolean;
}

/** One place decides what each lesson state looks and reads like. */
export function statusStyle(status: LessonStatus, p: Palette): StatusStyle {
  switch (status) {
    case 'cancelled':
      return { color: p.cancel, soft: p.cancelSoft, border: p.cancelBorder, label: 'בוטל', strike: true };
    case 'substitution':
      return { color: p.change, soft: p.changeSoft, border: p.changeBorder, label: 'מ״מ', strike: false };
    case 'moved':
      return { color: p.change, soft: p.changeSoft, border: p.changeBorder, label: 'הועבר', strike: false };
    case 'remote':
      return { color: p.change, soft: p.changeSoft, border: p.changeBorder, label: 'מרחוק', strike: false };
    case 'exam':
      return { color: p.exam, soft: p.examSoft, border: p.examBorder, label: 'מבחן', strike: false };
    case 'event':
      return { color: p.accent, soft: p.accentSoft, border: p.border, label: 'אירוע', strike: false };
    default:
      return { color: p.textMuted, soft: 'transparent', border: p.border, label: '', strike: false };
  }
}
