/**
 * The logo the owner chose (plan §16.3, option א, "דף עם שוליים"): a notebook
 * page with its red margin line, a ruled line, and a blue ballpoint tick —
 * "the day is in order".
 *
 * `Logo` is the wordmark for the app's own screens (onboarding's first step):
 * the name in the display face, the margin line at its start side, the ruled
 * line under it and the tick after it. Its colours follow the palette, so it
 * sits on the white page and on the dark one alike.
 *
 * `LogoMark` is the square mark, the same drawing as the launcher icon
 * (`assets/icon-*.png`), in its fixed brand colours: it is a picture of a
 * white page, whatever the theme.
 *
 *   <Logo size={46} />
 *   <LogoMark size={72} />
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { font } from '../theme';
import { Text, usePalette } from './ui';

/** The tick, drawn in a 24×18 box and scaled with the name. */
const TICK_PATH = 'M3 9.5 9 15.5 21 3';

export function Logo({ size = 46 }: { size?: number }): React.JSX.Element {
  const p = usePalette();
  const tick = size * 0.5;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="סדר יום"
      style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'stretch' }}
    >
      {/* The margin line, at the start side like a Hebrew notebook's. */}
      <View style={{ width: Math.max(2, size * 0.05), borderRadius: 2, backgroundColor: p.margin }} />
      <View style={{ paddingStart: size * 0.3, paddingVertical: size * 0.12 }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: size * 0.22,
            borderBottomWidth: Math.max(1.5, size * 0.04), borderBottomColor: p.border, paddingBottom: size * 0.08,
          }}
        >
          <Text maxScale={1} style={{ fontFamily: font.display, fontSize: size, lineHeight: size * 1.25, color: p.text }}>
            סדר יום
          </Text>
          <Svg width={tick} height={tick * 0.75} viewBox="0 0 24 18">
            <Path d={TICK_PATH} fill="none" stroke={p.accent} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </View>
    </View>
  );
}

/** The brand colours of the mark: a white ruled page, a red margin, a blue tick. */
export const LOGO_COLORS = {
  page: '#FFFFFF',
  rule: '#C5D3EA',
  margin: '#E8505B',
  tick: '#2347C5',
} as const;

/**
 * The square mark, as on the launcher icon: the adaptive icon's 108-unit
 * artwork cropped to the 72 units a mask shows.
 */
export function LogoMark({ size = 72, rounded = true }: { size?: number; rounded?: boolean }): React.JSX.Element {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="סדר יום"
      style={{ width: size, height: size, borderRadius: rounded ? size * 0.26 : 0, overflow: 'hidden' }}
    >
      <Svg width={size} height={size} viewBox="18 18 72 72">
        <Rect x={0} y={0} width={108} height={108} fill={LOGO_COLORS.page} />
        <Path d="M24 39h60M24 51h60M24 63h60M24 75h60" stroke={LOGO_COLORS.rule} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M73 20v68" stroke={LOGO_COLORS.margin} strokeWidth={3.2} strokeLinecap="round" />
        <Path d="M33.5 52.5 43 62.5 62.5 38.5" fill="none" stroke={LOGO_COLORS.tick} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
