/**
 * The face of a year-in-review card, drawn the same on the screen
 * (`WrappedScreen`) and in the image that is shared (`ShareImage`): the ruled
 * page with its red margin line, and the card's words — the number on the
 * highlighter (or in the red pen), its unit, its line and the quiet last line.
 *
 * The shared image is the card with no bar and no buttons, the logo and the
 * app's name at the bottom. It never has a student's name or a class's: it is
 * given only the card's words. Which cards may be shared at all is
 * `wrapped/share.ts`'s to say.
 */
import React, { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { font, space, type } from '../theme';
import { SHARE_IMAGE } from '../wrapped/share';
import type { CardCopy } from '../wrapped/copy';
import { LogoMark } from './Logo';
import { PenCircle } from './notebook';
import { Text, usePalette, useScheme } from './ui';

/** The pitch of the ruled lines; the texts' line heights are multiples of it, so words sit between the lines. */
export const RULE = 36;
/** The margin line's distance from the start edge. */
export const MARGIN = 44;
/** Where the words start, past the margin line. */
export const WORDS_START = MARGIN + space.lg;
/** The cards' texts grow one step with the in-app text size, not more: a card is one screen. */
export const TEXT_MAX = 1.15;

/** The ruled lines and the margin line of a page `height` points tall. Fills its parent. */
export function Page({ height }: { height: number }): React.JSX.Element {
  const p = usePalette();
  const lines = Math.ceil(height / RULE);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.rule, { top: (i + 1) * RULE, backgroundColor: p.borderSoft }]} />
      ))}
      <View style={[styles.marginLine, { backgroundColor: p.margin }]} />
    </View>
  );
}

/**
 * The card's words, top to bottom. `fixed` is for the shared image: its sizes
 * follow neither the phone's text size nor the app's.
 */
export function CardWords({ copy, fixed = false, children }: { copy: CardCopy; fixed?: boolean; children?: React.ReactNode }): React.JSX.Element {
  const p = usePalette();
  const max = fixed ? 1 : TEXT_MAX;
  const scaling = !fixed;
  return (
    <>
      <Hero copy={copy} fixed={fixed} />
      {copy.unit ? <Text allowFontScaling={scaling} maxScale={max} style={[styles.unit, { color: p.textStrong }]}>{copy.unit}</Text> : null}
      {copy.line ? (
        <Text allowFontScaling={scaling} maxScale={max} style={[styles.line, { color: p.text }]}>
          {copy.line.map((s, i) => (s.bold ? <Text key={i} allowFontScaling={scaling} maxScale={max} style={styles.bold}>{s.text}</Text> : s.text))}
        </Text>
      ) : null}
      {copy.since ? <Text allowFontScaling={scaling} maxScale={max} style={[styles.since, { color: p.textFaint }]}>{copy.since}</Text> : null}
      {children}
    </>
  );
}

/** The card's one number (or word): on the highlighter, or circled in the red pen. */
function Hero({ copy, fixed }: { copy: CardCopy; fixed: boolean }): React.JSX.Element {
  const p = usePalette();
  const dark = useScheme() === 'dark';
  const word = copy.heroKind === 'word';
  const marked = copy.pen === 'mark';
  // The ink page's highlighter is near-opaque, so there it is the whole block with dark ink on it;
  // on the white page it is a band behind the lower half of the number, as a marker leaves it.
  const ink = copy.pen === 'red' ? p.cancel : marked && dark ? p.onMark : p.textStrong;
  const text = (
    <Text
      allowFontScaling={!fixed}
      maxScale={1}
      adjustsFontSizeToFit
      minimumFontScale={0.5}
      // A subject's name stays on one line and shrinks to fit it; only the closing is written in two.
      numberOfLines={copy.hero.includes('\n') ? 2 : 1}
      style={[word ? styles.heroWord : styles.heroNumber, { color: ink }]}
    >
      {copy.hero}
    </Text>
  );
  return (
    <View style={styles.hero}>
      {marked ? <View style={[styles.highlight, dark ? styles.highlightFull : null, { backgroundColor: p.mark }]} /> : null}
      {copy.pen === 'red' ? <PenCircle color={p.cancel}>{text}</PenCircle> : text}
    </View>
  );
}

/**
 * The image that is shared, laid out at `SHARE_IMAGE.points` and captured at
 * three pixels to the point. The caller keeps it off the screen and captures
 * it through the ref.
 */
export const ShareImage = forwardRef<View, { copy: CardCopy }>(function ShareImage({ copy }, ref) {
  const p = usePalette();
  return (
    <View ref={ref} collapsable={false} style={[styles.image, { backgroundColor: p.bg }]}>
      <Page height={SHARE_IMAGE.points.height} />
      <Text allowFontScaling={false} maxScale={1} numberOfLines={1} style={[styles.imageKicker, { color: p.textMuted }]}>{copy.kicker}</Text>
      <View style={styles.imageWords}>
        <CardWords copy={copy} fixed />
      </View>
      <View style={styles.brand}>
        <LogoMark size={32} />
        <Text allowFontScaling={false} maxScale={1} style={[styles.brandName, { color: p.textStrong }]}>סדר יום</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  rule: { position: 'absolute', insetInline: 0, height: StyleSheet.hairlineWidth * 2 },
  marginLine: { position: 'absolute', top: 0, bottom: 0, insetInlineStart: MARGIN, width: 1.5 },
  hero: { alignSelf: 'flex-start', paddingHorizontal: space.sm, maxWidth: '100%' },
  heroNumber: { fontFamily: font.display, fontSize: 124, lineHeight: 4 * RULE },
  heroWord: { fontFamily: font.display, fontSize: 60, lineHeight: 2 * RULE },
  highlight: {
    position: 'absolute', insetInline: 0, bottom: '14%', height: '36%', borderRadius: 3, transform: [{ rotate: '-1.2deg' }],
  },
  highlightFull: { bottom: '6%', height: '88%' },
  unit: { fontFamily: font.heading, fontSize: 26, lineHeight: RULE },
  line: { fontFamily: font.body, fontSize: 20, lineHeight: RULE, marginTop: RULE },
  bold: { fontFamily: font.headingSemi },
  since: { fontFamily: font.body, fontSize: type.body, lineHeight: RULE },
  image: { width: SHARE_IMAGE.points.width, height: SHARE_IMAGE.points.height, direction: 'rtl', overflow: 'hidden' },
  imageKicker: {
    position: 'absolute', top: RULE, insetInlineStart: WORDS_START, insetInlineEnd: space.xl,
    fontFamily: font.bodySemi, fontSize: type.body, lineHeight: RULE,
  },
  imageWords: { position: 'absolute', top: 4 * RULE, insetInlineStart: WORDS_START, insetInlineEnd: space.xl, alignItems: 'flex-start' },
  brand: {
    position: 'absolute', bottom: RULE, insetInlineStart: WORDS_START, insetInlineEnd: space.xl,
    flexDirection: 'row', alignItems: 'center', gap: space.md,
  },
  brandName: { fontFamily: font.display, fontSize: 22, lineHeight: RULE },
});
