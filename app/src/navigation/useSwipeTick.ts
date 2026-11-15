import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SWIPE_IDLE, swipeStep, type SwipeEvent, type SwipeTrack } from '../lib/tabSwipe';

/** The lightest tick each phone has: Android's own clock tick (it follows the phone's touch-feedback setting), iOS's selection. */
export function tick(): void {
  const done = Platform.OS === 'android'
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick)
    : Haptics.selectionAsync();
  void done.catch(() => undefined);
}

/**
 * The main tabs' `screenListeners`: a light tick when a swipe lands on
 * another page (`swipeStep`, lib/tabSwipe.ts), never for a tap or a push.
 * The pager's swipe events reach the open tab; a tap reaches the tab tapped,
 * before the bar moves to it (`TabBar`).
 */
export function useSwipeTick(): (props: { navigation: { getState(): { index: number } } }) => {
  swipeStart: () => void;
  swipeEnd: () => void;
  tabPress: () => void;
  focus: () => void;
} {
  const track = useRef<SwipeTrack>(SWIPE_IDLE);
  const feed = useCallback((event: SwipeEvent) => {
    const step = swipeStep(track.current, event);
    track.current = step.track;
    if (step.tick) tick();
  }, []);
  return useCallback(({ navigation }) => ({
    swipeStart: () => feed({ type: 'start', index: navigation.getState().index, at: Date.now() }),
    swipeEnd: () => feed({ type: 'end', at: Date.now() }),
    tabPress: () => feed({ type: 'tap', at: Date.now() }),
    focus: () => feed({ type: 'index', index: navigation.getState().index, at: Date.now() }),
  }), [feed]);
}
