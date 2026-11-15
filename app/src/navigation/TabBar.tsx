import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { PlatformPressable } from '@react-navigation/elements';
import { useLocale } from '@react-navigation/native';
import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, usePalette } from '../components/ui';
import { AppIcon, type IconName } from '../components/AppIcon';
import { bottomBarLayout, TAB_BAR, tabAtPoint, tabPillShift } from '../lib/layout';
import { font } from '../theme';
import { tick } from './useSwipeTick';

/** As the pager: the native driver everywhere but the web. */
const useNativeDriver = Platform.OS !== 'web';
/** If the pages never report reaching the tab a drag let go on, the bar goes back to following them after this long. */
const ARRIVE_MS = 1500;

/** A tab's icon in its 56 × 30 slot, the highlighter's size. The bar draws it twice, on the highlighter and off it. */
export function TabIcon({ glyph, color }: { glyph: IconName; color: string }): React.JSX.Element {
  return (
    <View style={styles.iconSlot}>
      <AppIcon name={glyph} color={color} />
    </View>
  );
}

/** A tab's label: the chosen one in `bodySemi` and `text`, the others `bodyMedium` and `textMuted`. */
function TabLabel({ focused, children }: { focused: boolean; children: string }): React.JSX.Element {
  const p = usePalette();
  return (
    <Text
      numberOfLines={1}
      maxScale={TAB_BAR.maxAppScale}
      style={[styles.tabLabel, { fontFamily: focused ? font.bodySemi : font.bodyMedium, color: focused ? p.text : p.textMuted }]}
    >
      {children}
    </Text>
  );
}

/** Whether the keyboard is up: the bar steps aside for it, as bottom-tabs' `tabBarHideOnKeyboard` did. */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

/** Hidden from the screen reader: the copy of an icon or label drawn only for the crossfade. */
const DECOR = { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const;

/**
 * The tab bar (plan §16.1), under the pages that slide between the tabs: on
 * the page (`bg`) under a ruled line, the chosen tab's icon on the highlighter
 * and its label in ink, the others muted. No tinted rectangle behind the
 * chosen tab. Each tab is the button bottom-tabs drew, with its padding
 * (`TAB_BAR.itemPadding`); the bar's height is `bottomBarLayout` at `scale`.
 * Root.tsx hands each tab its glyph through `tabBarIcon`.
 *
 * The highlighter follows the finger (docs/superpowers/specs/2026-11-03-tab-swipe-design.md):
 * one pill, moved by the pager's `position` as the pages slide (`tabPillShift`),
 * and each tab's icon and label fade from muted to chosen as it arrives. At
 * rest that is the bar as it was.
 *
 * A finger can also drag along the bar itself: the highlighter follows the
 * finger (`tabAtPoint`), with a light tick as it enters each tab, and when the
 * finger lifts the page slides to the tab it is over, as a tap on that tab
 * would. While the finger holds the bar, and until the page arrives, the bar
 * follows the finger (`scrub`) instead of the pages (`held`).
 */
export function TabBar({ state, descriptors, navigation, jumpTo, position, scale }: MaterialTopTabBarProps & { scale: number }): React.JSX.Element | null {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { direction } = useLocale();
  const [width, setWidth] = useState(0);
  const keyboard = useKeyboardShown();
  // The tab under the finger, in fractions between tabs, and how far the bar follows it rather than the pages (0 or 1).
  const scrub = useRef(new Animated.Value(state.index)).current;
  const held = useRef(new Animated.Value(0)).current;
  // The drag under way: the whole tab the highlighter is over, for the tick.
  const drag = useRef<{ whole: number } | null>(null);
  // After a drag lets go on another tab: stops waiting for the page to arrive there.
  const arriving = useRef<{ to: number; stop: () => void } | null>(null);
  const count = state.routes.length;

  const stopArriving = (): void => {
    arriving.current?.stop();
    arriving.current = null;
  };
  const follow = (x: number): void => {
    const at = tabAtPoint(x, width, count, direction);
    scrub.setValue(at);
    const whole = Math.round(at);
    if (drag.current && whole !== drag.current.whole) {
      drag.current.whole = whole;
      tick();
    }
  };
  const begin = (x: number): void => {
    if (width <= 0 || count <= 1) return;
    stopArriving();
    drag.current = { whole: state.index };
    held.setValue(1);
    follow(x);
  };
  const end = (): void => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    let to = current.whole;
    if (to !== state.index) {
      const route = state.routes[to];
      const event = route ? navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }) : null;
      if (route && event && !event.defaultPrevented) {
        // The page slides to the tab; the bar waits there until it arrives, then follows the pages again.
        const listener = position.addListener(({ value }: { value: number }) => {
          if (Math.abs(value - to) < 0.01) stopArriving();
        });
        const timer = setTimeout(stopArriving, ARRIVE_MS);
        arriving.current = {
          to,
          stop: () => {
            position.removeListener(listener);
            clearTimeout(timer);
            held.setValue(0);
          },
        };
        Animated.spring(scrub, { toValue: to, useNativeDriver, speed: 24, bounciness: 0 }).start();
        jumpTo(route.key);
        return;
      }
      to = state.index;
    }
    // Let go on the open tab: the highlighter settles home, and the bar follows the pages again.
    Animated.spring(scrub, { toValue: to, useNativeDriver, speed: 24, bounciness: 0 }).start(({ finished }) => {
      if (finished && !drag.current) held.setValue(0);
    });
  };
  // The latest of these for the gesture, which is made once.
  const handlers = useRef({ begin, follow, end });
  handlers.current = { begin, follow, end };
  const pan = useMemo(
    () => Gesture.Pan()
      .runOnJS(true)
      // Sideways only, and past a tap's wobble: a tap is still the tab's own press.
      .activeOffsetX([-8, 8])
      .failOffsetY([-24, 24])
      .onStart((e) => handlers.current.begin(e.x))
      .onUpdate((e) => handlers.current.follow(e.x))
      .onFinalize(() => handlers.current.end()),
    [],
  );
  // A push or a link that opens another tab while the bar waits for the page: the bar follows the pages.
  useEffect(() => {
    if (arriving.current && arriving.current.to !== state.index) stopArriving();
  });
  useEffect(() => stopArriving, []);

  if (keyboard) return null;
  const layout = bottomBarLayout(insets.bottom, scale);
  // Where the bar is, in tabs: the pages' position, or the finger's while it holds the bar.
  const at = Animated.add(Animated.multiply(position, Animated.subtract(1, held)), Animated.multiply(scrub, held));
  const shift = count > 1
    ? at.interpolate({
      inputRange: state.routes.map((_, i) => i),
      outputRange: state.routes.map((_, i) => tabPillShift(i, width, count, direction)),
      extrapolate: 'clamp',
    })
    : tabPillShift(0, width, count, direction);
  return (
    <GestureDetector gesture={pan}>
      <View
        role="tablist"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.bar, { backgroundColor: p.bg, borderTopColor: p.border }, layout]}
      >
        {width > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { backgroundColor: p.mark, top: layout.paddingTop + TAB_BAR.itemPadding, transform: [{ translateX: shift }] }]}
          />
        ) : null}
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          const focused = state.index === index;
          const title = options?.title ?? route.name;
          // How chosen this tab looks, 0 to 1, as the pages slide or the finger drags.
          const on = at.interpolate({ inputRange: [index - 1, index, index + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' });
          const off = Animated.subtract(1, on);
          const onPress = (): void => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) jumpTo(route.key);
          };
          return (
            <PlatformPressable
              key={route.key}
              onPress={onPress}
              aria-label={title}
              // As bottom-tabs: a tab is a "tab" except on iOS, where VoiceOver reads it better as a button.
              role={Platform.select({ ios: 'button', default: 'tab' })}
              aria-selected={focused}
              android_ripple={{ borderless: true }}
              pressOpacity={1}
              style={styles.tab}
            >
              <View style={styles.iconSlot}>
                <Animated.View {...DECOR} style={[StyleSheet.absoluteFill, { opacity: off }]}>
                  {options?.tabBarIcon?.({ focused: false, color: p.textMuted })}
                </Animated.View>
                <Animated.View {...DECOR} style={[StyleSheet.absoluteFill, { opacity: on }]}>
                  {options?.tabBarIcon?.({ focused: true, color: p.onMark })}
                </Animated.View>
              </View>
              <View style={styles.labels}>
                <Animated.View {...(focused ? {} : DECOR)} style={{ opacity: on }}>
                  <TabLabel focused>{title}</TabLabel>
                </Animated.View>
                <Animated.View {...(focused ? DECOR : {})} style={[styles.labelOver, { opacity: off }]}>
                  <TabLabel focused={false}>{title}</TabLabel>
                </Animated.View>
              </View>
            </PlatformPressable>
          );
        })}
      </View>
    </GestureDetector>
  );
}

// The tab bar's pieces, from `TAB_BAR` (lib/layout.ts), which sizes the bar around them.
const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', padding: TAB_BAR.itemPadding },
  // The highlighter, anchored at the row's start edge and moved by `tabPillShift`.
  pill: {
    position: 'absolute', insetInlineStart: 0,
    width: TAB_BAR.pill.width, height: TAB_BAR.pill.height, borderRadius: TAB_BAR.pill.height / 2,
  },
  iconSlot: { width: TAB_BAR.pill.width, height: TAB_BAR.pill.height, alignItems: 'center', justifyContent: 'center' },
  // The chosen label sets the line; the muted one lies over it, centred the same.
  labels: { alignSelf: 'stretch', alignItems: 'center', marginTop: TAB_BAR.gap },
  labelOver: { position: 'absolute', top: 0, insetInline: 0, alignItems: 'center' },
  tabLabel: { fontSize: TAB_BAR.labelSize, lineHeight: TAB_BAR.labelLine },
});
