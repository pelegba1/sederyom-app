/**
 * Bottom sheet on a native Modal: a handle, a title with a close button, a
 * body that scrolls inside the sheet, and an optional footer that stays put
 * under it — where the primary action goes, so it is reachable however long
 * the body and however high the keyboard.
 *
 *   <Sheet visible={open} onClose={close} title="משימה חדשה"
 *     footer={<Button title="הוסף משימה" onPress={save} />}>
 *     …fields…
 *   </Sheet>
 *
 * Tapping the dimmed backdrop, the close button or Android's back closes it,
 * unless `dismissable` is false (e.g. while a save is in flight).
 *
 * `body="list"` is for a body that is a virtualised list (`FlatList`): the body
 * is no ScrollView, so the list is not nested in one and keeps its windowing,
 * and the sheet is its full height (90%) so that the list has a viewport of its
 * own size from the first frame. The list owns the scrolling. `body` may change while the sheet is open (a flow
 * whose steps differ): only the body under the header is swapped, the Modal stays.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, space } from '../theme';
import { AppIcon } from './AppIcon';
import { MIN_TOUCH, Text, usePalette } from './ui';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Pinned under the scrolling body: the sheet's main action(s). */
  footer?: React.ReactNode;
  /** Pinned under the title, above the body: what the sheet is about and a way back, in a flow of steps. */
  subheader?: React.ReactNode;
  /** While false, the backdrop, the close button and Android back do nothing. Default true. */
  dismissable?: boolean;
  /** `scroll` (default): the children scroll inside the sheet. `list`: the children are one list that scrolls itself (see above). */
  body?: 'scroll' | 'list';
  /**
   * `false`: a tap on the dimmed backdrop does nothing, while the close button and Android back still call `onClose`
   * (a tap beside a sheet is the one made by mistake). Default true.
   */
  backdropDismiss?: boolean;
}

export function Sheet({
  visible, onClose, title, children, footer, subheader, dismissable = true, body = 'scroll', backdropDismiss = true,
}: SheetProps): React.JSX.Element {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const close = (): void => {
    if (dismissable) onClose();
  };
  const bottomPad = Math.max(insets.bottom, space.lg);

  // The dim fades in over the whole screen at once (the Modal's own fade), and
  // the sheet rises over it — a sliding Modal carried the dim up with the sheet
  // and left the top of the screen bright for a moment (Daniel, run 3).
  const rise = useRef(new Animated.Value(SHEET_RISE)).current;
  useEffect(() => {
    if (!visible) return;
    // The web preview draws no animation: a hidden browser pane pauses
    // animation frames, and a sheet waiting on one stayed off-screen, or a
    // closed one stayed on top catching every tap (run 4, Noa's list menu).
    if (Platform.OS === 'web') {
      rise.setValue(0);
      return;
    }
    rise.setValue(SHEET_RISE);
    Animated.timing(rise, { toValue: 0, duration: 220, useNativeDriver: true }).start();
  }, [visible, rise]);

  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} statusBarTranslucent onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        {/* Still takes the tap when it does not close: it must not reach what is under the sheet. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={backdropDismiss ? close : undefined} accessible={false} />
        <Animated.View style={[styles.sheet, body === 'list' ? styles.sheetFull : null, { backgroundColor: p.surface, transform: [{ translateY: rise }] }]}>
          <View style={[styles.grabber, { backgroundColor: p.border }]} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>{title ?? ''}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="סגירה"
              disabled={!dismissable}
              onPress={close}
              style={({ pressed }) => [styles.close, { opacity: !dismissable ? 0.4 : pressed ? 0.6 : 1 }]}
            >
              <AppIcon name="close" color={p.textMuted} size={20} />
            </Pressable>
          </View>
          {subheader ? <View style={styles.subheader}>{subheader}</View> : null}
          {body === 'list' ? (
            <View style={[styles.listBody, { paddingBottom: footer ? 0 : bottomPad }]}>{children}</View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              style={styles.body}
              contentContainerStyle={[styles.bodyContent, { paddingBottom: footer ? space.lg : bottomPad }]}
            >
              {children}
            </ScrollView>
          )}
          {footer ? (
            <View style={[styles.footer, { paddingBottom: bottomPad, borderTopColor: p.border }]}>{footer}</View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** How far below its place the sheet starts rising from. */
const SHEET_RISE = 360;

/** The sheet's title: between the scale's `title` (18) and `heading` (21), plan §16.1. */
const SHEET_TITLE_SIZE = 20;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'flex-end' },
  // A sheet of the page lifted over the dimmed screen (plan §16.1): `surface`, radius 20 at the top, no border.
  sheet: {
    maxHeight: '90%',
    direction: 'rtl',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.md,
  },
  // A list body fills the sheet: a list has no height of its own to shrink to.
  sheetFull: { height: '90%' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    // Even on both sides, so the title lines up with the body's edge. Start/end
    // padding came out mirrored in the web preview (Daniel, run 3).
    paddingHorizontal: space.xl,
    marginTop: space.xs,
  },
  title: { flex: 1, fontFamily: font.headingSemi, fontSize: SHEET_TITLE_SIZE },
  subheader: { paddingHorizontal: space.xl },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  // Sized by its content and shrinking under the footer — never stretching
  // the sheet to its full height (a ScrollView grows by default).
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: space.xl, paddingTop: space.sm },
  // The list's own rows carry the sheet's side padding (`contentContainerStyle`), so the scrollbar sits at the sheet's edge.
  listBody: { flex: 1, paddingTop: space.sm },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: 1 },
});
