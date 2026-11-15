/**
 * A short confirmation near the bottom of the screen ("הושלמה · לבטל"). One
 * at a time: a new one replaces the one showing. With an action it stays 5
 * seconds, long enough to reach it; without one, 3.
 *
 *   const toast = useToast();
 *   toast.show('הושלמה', { onAction: () => undo() });   // the action reads "לבטל"
 *
 * It floats `TOAST_CLEARANCE` above the tab bar, clear of the FAB and of a
 * bottom row of buttons, so it never hides the control it confirms (R-33).
 * It is an ink rectangle (plan §16.1): `text` behind, `bg` words, the action
 * underlined. The text says what happened, with no tick after it (§16.2).
 *
 * `ToastProvider` wraps the whole app (App.tsx), above the navigator. A toast
 * belongs to the screen that raised it (Wave 7): it goes when that screen
 * does — another tab, a screen opened over it, "back" — and one raised while
 * its screen is not in front is not shown at all. Itai's "נוספו 2 משימות
 * לימוד" with its undo followed him from תכנון into הגדרות, where it read as
 * one more settings row (run 6). Within its own screen it stays, sheets
 * included, so "לבטל" still works there. A toast raised outside any screen
 * (the Mashov renewal sheet, over everything) belongs to none and stays, and
 * so does one that `outlivesScreen`: the word after an action that took its
 * own screen away ("יצאנו מההדגמה", "הנתונים נמחקו").
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
// From core, which native re-exports: it loads without React Native, so the node tests can load this file.
import { NavigationContext } from '@react-navigation/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomBarLayout, tabBarScale } from '../lib/layout';
import { font, radius, space, TOAST_CLEARANCE, TOAST_MIN_HEIGHT, type } from '../theme';
import { MIN_TOUCH, Text, usePalette, useTextScale } from './ui';

/**
 * The label of a toast's undo action: the verb, beside the sentence that says
 * what was just done ("סומן כבוצע · לבטל"). The noun "ביטול" already names a
 * cancelled lesson, and "החזרה" read as "go back to the last screen" (Maya,
 * run 3).
 */
export const UNDO_LABEL = 'לבטל';

export interface ToastOptions {
  /** The action's label; defaults to `UNDO_LABEL` when there is an `onAction`. */
  actionLabel?: string;
  onAction?: () => void;
  /** Overrides the default: 7000 ms with an action (time to reach "לבטל"), 3000 ms without. */
  durationMs?: number;
  /**
   * For an action that takes its own screen away: "לצאת מההדגמה" and "מחק את
   * הנתונים שלי" start the app over at the welcome screen, and the toast says
   * there what happened. It belongs to no screen (`tieToast`); without this,
   * raised once its screen is gone, it would not be shown at all.
   */
  outlivesScreen?: boolean;
}

export interface ToastApi {
  show: (text: string, options?: ToastOptions) => void;
  hide: () => void;
}

/** How long a toast stays when it offers an action (plan §3.2: undo gets 5 s). */
export const TOAST_ACTION_MS = 7000;
export const TOAST_PLAIN_MS = 3000;

/**
 * The action a toast offers and how long it stays: an `onAction` without a
 * label is an undo, "לבטל".
 */
export function toastSpec(options: ToastOptions = {}): { actionLabel: string | undefined; durationMs: number } {
  const actionLabel = options.actionLabel ?? (options.onAction ? UNDO_LABEL : undefined);
  return { actionLabel, durationMs: options.durationMs ?? (actionLabel ? TOAST_ACTION_MS : TOAST_PLAIN_MS) };
}

/**
 * The toast's distance from the bottom of the window: the tab bar (with the
 * phone's navigation buttons under it), then `TOAST_CLEARANCE` for the FAB.
 * The bar is measured as Root.tsx draws it, at the phone's and the app's
 * text size (`tabBarScale`), so a taller bar lifts the toast with it. On a
 * stack screen, with no tab bar, that is a little high — never covering.
 */
export function toastBottom(bottomInset: number, fontScale: number, appScale = 1): number {
  return bottomBarLayout(bottomInset, tabBarScale(fontScale, appScale)).height + TOAST_CLEARANCE;
}

interface Current {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The screen a toast belongs to — React Navigation's `navigation` for it,
 * narrowed to what the toast needs. `null` outside any screen.
 */
export interface ToastOwner {
  isFocused: () => boolean;
  addListener: (type: 'blur' | 'beforeRemove', callback: () => void) => () => void;
}

/**
 * Ties a toast to its screen: `gone` runs once the screen leaves the front
 * — another tab, a screen pushed over it (a tab's screen hears that too:
 * the navigator passes its own blur down), or the screen going away. The
 * answer unties it; `null` means the screen is not in front, and the toast
 * is not shown. Without an owner there is nothing to tie to.
 */
export function bindToOwner(owner: ToastOwner | null | undefined, gone: () => void): (() => void) | null {
  if (!owner) return () => undefined;
  if (!owner.isFocused()) return null;
  const offBlur = owner.addListener('blur', gone);
  const offRemove = owner.addListener('beforeRemove', gone);
  return () => {
    offBlur();
    offRemove();
  };
}

/**
 * A toast's tie as its options ask: one that `outlivesScreen` belongs to no
 * screen, as one raised outside any screen, and stays over the next; any
 * other goes with the screen that raised it (`bindToOwner`).
 */
export function tieToast(owner: ToastOwner | null | undefined, options: ToastOptions, gone: () => void): (() => void) | null {
  return bindToOwner(options.outlivesScreen ? null : owner, gone);
}

/** What the provider offers: `show` names the screen it is for. */
interface ToastHost {
  show: (text: string, options: ToastOptions | undefined, owner: ToastOwner | null) => void;
  hide: () => void;
}

const noop: ToastApi = { show: () => undefined, hide: () => undefined };
const ToastContext = createContext<ToastHost | null>(null);

/** The toast API, for the screen this is called in: its toasts go when it does. */
export function useToast(): ToastApi {
  const host = useContext(ToastContext);
  // Undefined outside a screen — the renewal sheet over the navigator.
  const navigation = useContext(NavigationContext);
  const owner = useMemo<ToastOwner | null>(() => (navigation
    ? {
      isFocused: () => navigation.isFocused(),
      addListener: (type, callback) => navigation.addListener(type, () => callback()),
    }
    : null), [navigation]);
  const api = useMemo<ToastApi | null>(() => (host
    ? { show: (text, options) => host.show(text, options, owner), hide: host.hide }
    : null), [host, owner]);
  if (!api && __DEV__) console.warn('useToast() outside <ToastProvider>: toasts are dropped');
  return api ?? noop;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [current, setCurrent] = useState<Current | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Unties the toast showing from its screen.
  const untie = useRef<(() => void) | null>(null);
  const nextId = useRef(1);

  const release = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    untie.current?.();
    untie.current = null;
  };

  const hide = useCallback(() => {
    release();
    setCurrent(null);
  }, []);

  const show = useCallback((text: string, options: ToastOptions = {}, owner: ToastOwner | null = null) => {
    const id = nextId.current;
    const gone = (): void => {
      release();
      setCurrent((c) => (c?.id === id ? null : c));
    };
    // Raised for a screen no longer in front (a late answer after leaving it): not shown,
    // unless it is meant to outlive that screen.
    const tie = tieToast(owner, options, gone);
    if (!tie) return;
    release();
    nextId.current += 1;
    untie.current = tie;
    const { actionLabel, durationMs } = toastSpec(options);
    setCurrent({ id, text, actionLabel, onAction: options.onAction });
    timer.current = setTimeout(gone, durationMs);
  }, []);

  useEffect(() => release, []);

  const host = useMemo<ToastHost>(() => ({ show, hide }), [show, hide]);

  return (
    <ToastContext.Provider value={host}>
      {children}
      {current ? <ToastView key={current.id} toast={current} onDone={hide} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: Current; onDone: () => void }): React.JSX.Element {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const appScale = useTextScale();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [opacity]);

  const bottom = toastBottom(insets.bottom, fontScale, appScale);

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          styles.toast,
          { bottom, opacity, backgroundColor: p.text },
        ]}
      >
        <Text style={[styles.text, { color: p.bg }]}>{toast.text}</Text>
        {toast.actionLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${toast.actionLabel}: ${toast.text}`}
            onPress={() => {
              onDone();
              toast.onAction?.();
            }}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.actionText, { color: p.bg }]}>{toast.actionLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

// An ink rectangle on the page (plan §16.1): the `text` colour as its fill, the page's colour as its words.
const styles = StyleSheet.create({
  layer: { justifyContent: 'flex-end', direction: 'rtl' },
  toast: {
    position: 'absolute',
    insetInlineStart: space.lg,
    insetInlineEnd: space.lg,
    minHeight: TOAST_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  text: { flex: 1, fontFamily: font.bodyMedium, fontSize: type.label, paddingVertical: space.md },
  action: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: font.bodySemi, fontSize: type.label, textDecorationLine: 'underline' },
});
