/**
 * The notebook page the three iPhone widgets are drawn on (plan §16, the
 * "דף מחברת" artboards): the page's colour, the red margin line down the
 * start edge with the times written inside it, a ruled line under every row,
 * the highlighters, the footer.
 *
 * Read this before touching any `'widget'` function here:
 * - Babel (babel-preset-expo's widgets plugin) turns each one into a string of
 *   its own source, which `expo-widgets` evaluates inside the widget
 *   extension. Nothing outside the function's body exists there — no import,
 *   no constant of this file — only the `@expo/ui` components and modifiers,
 *   which the extension's runtime installs as globals. The imports at the top
 *   are for TypeScript alone.
 * - So this kit is itself a `'widget'` function, returning the shared pieces;
 *   `composeLayout` glues it in front of each widget's own function, which
 *   receives it as its third argument.
 * - Every word and every decision comes in `props`, from `props.ts`.
 *
 * Fonts are the extension's own copies (`plugins/withWidgetFonts.js`), named
 * by their PostScript names. Direction: the extension is a Hebrew-only
 * bundle (same plugin), so SwiftUI lays it out right to left — a row's first
 * child sits at the right edge, "leading" is the right.
 */
import type React from 'react';
import { Button, HStack, Image, Rectangle, RoundedRectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  background, buttonStyle, containerBackground, fixedSize, font, foregroundStyle, frame, lineLimit, monospacedDigit, opacity, padding,
  shapes, strikethrough, truncationMode, clipped,
} from '@expo/ui/swift-ui/modifiers';
import type { Ink, LessonRow, Tone } from './props';

/** What the kit hands a widget. */
export interface Kit {
  /** The page's ink, by the phone's scheme. */
  c: Ink;
  dark: boolean;
  /** The margin's width: the time column. */
  M: number;
  tone: (t: Tone | undefined) => string;
  T: (p: TextProps) => React.JSX.Element;
  Mark: (p: { text: string; fg: string; bg: string; size?: number }) => React.JSX.Element;
  Page: (p: { margin: number; top?: number; bottom?: number; children: React.ReactNode }) => React.JSX.Element;
  Rule: () => React.JSX.Element;
  Ruled: (p: { dashed?: boolean; min: number; max: number; children: React.ReactNode }) => React.JSX.Element;
  LessonCells: (p: { row: LessonRow; size: number; width?: number }) => React.JSX.Element;
  Time: (p: { text: string; color: string; bold?: boolean; size?: number }) => React.JSX.Element;
  Footer: (p: { left?: string; updated: string; stale: boolean; inset: number }) => React.JSX.Element;
  Chevron: (p: { dir: 'right' | 'left' }) => React.JSX.Element;
  PlainButton: (p: { onPress: () => object; width: number; children: React.ReactNode }) => React.JSX.Element;
}

export interface TextProps {
  children: string;
  size?: number;
  /** r 400, s 600, b 700, x 800, title: Secular One. */
  w?: 'r' | 's' | 'b' | 'x' | 'title';
  color: string;
  strike?: string;
  /** Digits of one width, for the time column. */
  digits?: boolean;
  /** Never shortened: a label a row cannot do without ("ש״ב", "בוטל", a time); the name beside it gives way. */
  fixed?: boolean;
}

export const kit = (props: unknown, environment: { colorScheme?: string }): Kit => {
  'widget';
  const p = props as { ink?: { light: Ink; dark: Ink } };
  const dark = environment.colorScheme === 'dark';
  // WidgetKit's placeholder, and a widget placed before the app ever ran,
  // come with no props at all. The page then gets its two colours and one
  // ink here — the only colours written in the extension; every other draw
  // uses `INK` from props.ts (theme.ts).
  const bare = dark ? '#141829' : '#FFFFFF';
  const ink = dark ? '#AAB1C8' : '#4A5472';
  const c: Ink = p.ink ? (dark ? p.ink.dark : p.ink.light) : {
    bg: bare, rule: ink, margin: ink, text: ink, strong: ink, muted: ink, faint: ink, accent: ink,
    change: ink, changeSoft: bare, cancel: ink, mark: bare, onMark: ink, ok: ink,
  };
  const M = 58;
  const FACE = { r: 'Assistant-Regular', s: 'Assistant-SemiBold', b: 'Assistant-Bold', x: 'Assistant-ExtraBold', title: 'SecularOne-Regular' };

  const tone = (t: Tone | undefined): string => (t ? c[t] : c.text);

  const T = ({ children, size = 15, w = 'r', color, strike, digits, fixed }: TextProps) => {
    const mods = [font({ family: FACE[w], size }), foregroundStyle(color), lineLimit(1), truncationMode('tail')];
    if (strike) mods.push(strikethrough({ isActive: true, pattern: 'solid', color: strike }));
    if (digits) mods.push(monospacedDigit());
    if (fixed) mods.push(fixedSize({ horizontal: true, vertical: false }));
    return <Text modifiers={mods}>{children}</Text>;
  };

  /** Words on a highlighter: a fill of radius 3 behind them, no border. */
  const Mark = ({ text, fg, bg, size = 14 }: { text: string; fg: string; bg: string; size?: number }) => (
    <Text modifiers={[
      font({ family: FACE.b, size }), foregroundStyle(fg), lineLimit(1), fixedSize({ horizontal: true, vertical: false }),
      padding({ horizontal: 5 }), background(bg, shapes.roundedRectangle({ cornerRadius: 3 })),
    ]}>{text}</Text>
  );

  /**
   * The page: its colour edge to edge, and the red margin line `margin`
   * points from the right edge, top to bottom — or from `top` to `bottom`
   * points short of the edges, where a narrow widget writes its header and
   * footer across the whole page.
   */
  const Page = ({ margin, top = 0, bottom = 0, children }: { margin: number; top?: number; bottom?: number; children: React.ReactNode }) => (
    <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }), containerBackground(c.bg, 'widget')]}>
      <HStack spacing={0} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000 }), padding({ top, bottom })]}>
        <Spacer modifiers={[frame({ width: margin })]} />
        <Rectangle modifiers={[foregroundStyle(c.margin), frame({ width: 1.5 })]} />
        <Spacer />
      </HStack>
      {children}
    </ZStack>
  );

  /** A ruled line on its own: the one above the first row. */
  const Rule = () => <Rectangle modifiers={[foregroundStyle(c.rule), frame({ maxWidth: 10000, height: 1 })]} />;

  /** A row on a ruled line: the line under it solid, or dashed in blue ink under the lesson on now. */
  const Ruled = ({ dashed, min, max, children }: { dashed?: boolean; min: number; max: number; children: React.ReactNode }) => {
    const dashes = [];
    if (dashed) for (let i = 0; i < 64; i += 1) dashes.push(<Rectangle key={i} modifiers={[foregroundStyle(c.accent), frame({ width: 4, height: 1.5 })]} />);
    return (
      <VStack spacing={0} alignment="leading">
        <HStack spacing={0} modifiers={[frame({ maxWidth: 10000, minHeight: min, maxHeight: max, alignment: 'leading' })]}>{children}</HStack>
        {dashed ? (
          <HStack spacing={3} modifiers={[frame({ maxWidth: 10000, height: 1.5, alignment: 'leading' }), clipped()]}>{dashes}</HStack>
        ) : (
          <Rule />
        )}
      </VStack>
    );
  };

  /** The time, inside the margin: 14 from the page's edge. */
  const Time = ({ text, color, bold, size = 14 }: { text: string; color: string; bold?: boolean; size?: number }) => (
    <HStack spacing={0} modifiers={[frame({ width: M, alignment: 'leading' })]}>
      <Spacer modifiers={[frame({ width: 14 })]} />
      <T size={size} w={bold ? 'b' : 'r'} color={color} digits fixed>{text}</T>
    </HStack>
  );

  /**
   * A lesson after the margin: its dot, its name, and at the end what it is
   * now — "עד 09:35", "בוטל", the change on the pink highlighter, who or where.
   * `width` fixes the cell (the overview's lesson column); else it fills the row.
   */
  const LessonCells = ({ row, size, width }: { row: LessonRow; size: number; width?: number }) => {
    const past = row.state === 'past';
    const now = row.state === 'now';
    const cancelled = row.state === 'cancelled';
    const nameColor = cancelled ? c.cancel : past ? c.faint : now ? c.strong : c.text;
    const small = size - 2;
    const dot = dark ? row.dot.dark : row.dot.light;
    const end = [];
    if (now && row.until) end.push(<T key="until" size={small} w="s" color={c.accent} fixed>{row.until}</T>);
    if (cancelled) end.push(<T key="cancel" size={small} w="b" color={c.cancel} fixed>בוטל</T>);
    if (!cancelled && row.detail && !width) end.push(<T key="detail" size={small} color={c.muted}>{row.detail}</T>);
    if (!cancelled && row.change) end.push(<Mark key="change" text={row.change} fg={c.change} bg={c.changeSoft} size={small} />);
    return (
      <HStack spacing={7} modifiers={width ? [padding({ leading: 10 }), frame({ width, alignment: 'leading' })] : [padding({ leading: 10, trailing: 14 })]}>
        <Circle7 color={dot} faint={past} />
        {row.exam && !cancelled ? (
          <Mark text={`${row.subject}, מבחן`} fg={c.onMark} bg={c.mark} size={size} />
        ) : (
          <T size={size} w={now ? 'b' : 'r'} color={nameColor} strike={cancelled ? c.cancel : undefined}>{row.subject}</T>
        )}
        <Spacer minLength={4} />
        {end}
      </HStack>
    );
  };

  const Circle7 = ({ color, faint }: { color: string; faint: boolean }) => (
    <RoundedRectangle cornerRadius={3.5} modifiers={[foregroundStyle(color), frame({ width: 7, height: 7 }), opacity(faint ? 0.5 : 1)]} />
  );

  /** "ועוד 3 שיעורים" and "עודכן 09:12" — the update in the change ink once it is old. */
  const Footer = ({ left, updated, stale, inset }: { left?: string; updated: string; stale: boolean; inset: number }) => (
    <HStack spacing={0} modifiers={[padding({ leading: inset, trailing: 14 })]}>
      {left ? <T size={13} color={c.muted}>{left}</T> : null}
      <Spacer />
      <T size={13} color={stale ? c.change : c.muted} fixed>{updated}</T>
    </HStack>
  );

  /** A paging chevron. `chevron.right` and `.left` never mirror, so each points the way it reads here. */
  const Chevron = ({ dir }: { dir: 'right' | 'left' }) => (
    <Image systemName={dir === 'right' ? 'chevron.right' : 'chevron.left'} size={14} color={c.accent} />
  );

  /** A tap target that pages the widget: no button chrome, the page's ink only. */
  const PlainButton = ({ onPress, width, children }: { onPress: () => object; width: number; children: React.ReactNode }) => (
    <Button onPress={onPress as () => void} modifiers={[buttonStyle('plain'), frame({ width, height: 40 })]}>
      <HStack spacing={2} modifiers={[frame({ width, height: 40 })]}>{children as React.ReactElement}</HStack>
    </Button>
  );

  return { c, dark, M, tone, T, Mark, Page, Rule, Ruled, LessonCells, Time, Footer, Chevron, PlainButton };
};

/**
 * One layout string for `createWidget`: the kit, then the widget's function
 * called with it. Both arrive here as strings (the widgets plugin replaced
 * each function with its source); the native side evaluates the result as
 * `(function (props, environment) { … })`.
 */
export function composeLayout(kitSource: unknown, widgetSource: unknown): string {
  if (typeof kitSource !== 'string' || typeof widgetSource !== 'string') {
    throw new Error('iOS widget layouts must be compiled by the expo-widgets Babel plugin');
  }
  return `function(props,environment){var K=(${kitSource})(props,environment);return(${widgetSource})(props,environment,K);}`;
}
