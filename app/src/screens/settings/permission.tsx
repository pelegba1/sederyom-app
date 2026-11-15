/**
 * The phone's notification permission (F14): the hook that reads it, and the
 * one notice that says it. Used by Settings and by the onboarding screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Button, Text, usePalette } from '../../components/ui';
import { PERMISSION_OFF_LINE } from '../../lib/settingsSummary';
import { usePushRegistration } from '../../push/usePushRegistration';
import { font, space, type } from '../../theme';

export { PERMISSION_OFF_LINE } from '../../lib/settingsSummary';

// ---------------------------------------------------------------------------
// Notification permission (F14)
// ---------------------------------------------------------------------------

/** `checking` until the phone answers; then allowed, or not. */
export type PermissionState = 'checking' | 'granted' | 'off';

export interface NotificationPermission {
  state: PermissionState;
  /** Asks with the system dialog when the phone still lets us; otherwise opens the phone's settings. */
  enable: () => void;
  busy: boolean;
}

/**
 * The phone's notification permission, re-read whenever the app comes back to
 * the front (the way back from the phone's settings) and whenever its screen
 * regains focus (the way back from the page where it was turned on, to the
 * screen that only says how it stands). Used by stack screens inside the
 * navigator, since the focus read needs one. When it has just been turned on
 * in the phone's settings, this phone is registered for pushes right away.
 */
export function useNotificationPermission(): NotificationPermission {
  // Mounting it registers the push token when the permission is already there.
  const push = usePushRegistration();
  const request = useRef(push.request);
  request.current = push.request;
  const [perm, setPerm] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const lastGranted = useRef<boolean | null>(null);

  const check = useCallback(async (): Promise<{ granted: boolean; canAskAgain: boolean }> => {
    let next = { granted: false, canAskAgain: false };
    try {
      const response = await Notifications.getPermissionsAsync();
      next = { granted: response.granted || response.status === 'granted', canAskAgain: response.canAskAgain };
    } catch {
      // No notifications here at all: off, and the phone's settings are the way.
    }
    lastGranted.current = next.granted;
    setPerm(next);
    return next;
  }, []);

  // On mount, and again each time this screen is the one in front.
  useFocusEffect(useCallback(() => { void check(); }, [check]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const before = lastGranted.current;
      void check().then((now) => {
        if (now.granted && before === false) void request.current();
      });
    });
    return () => sub.remove();
  }, [check]);

  const enable = useCallback(() => {
    void (async () => {
      setBusy(true);
      try {
        const current = perm ?? (await check());
        if (current.granted) return;
        if (current.canAskAgain) {
          // The system dialog; on "allow" it also registers this phone.
          await request.current();
          await check();
          return;
        }
        await Linking.openSettings();
      } catch {
        // Nothing to open (a browser): the notice stays, which is the truth.
      } finally {
        setBusy(false);
      }
    })();
  }, [perm, check]);

  return { state: perm === null ? 'checking' : perm.granted ? 'granted' : 'off', enable, busy };
}

/** The one button that asks the phone for them, beside `PERMISSION_OFF_LINE`. */
export const PERMISSION_ON_BUTTON = 'להדליק';

/**
 * Under them, over the disabled switches: why the switches do nothing (run 8:
 * three testers did not see why they were grey). A press on one of them does
 * what "להדליק" does.
 */
export const PERMISSION_SWITCHES_LINE = 'אפשר לבחור אחרי שמדליקים התראות בטלפון';

/** A disabled notification switch, to the screen reader: why, and what a press does. */
export const PERMISSION_SWITCH_HINT = 'ההתראות כבויות בטלפון. לחיצה מבקשת להדליק אותן';

/**
 * The permission, said once: on, or one line in the red pen with the one
 * button that fixes it — on the page, no tinted box around them (the 1.7
 * review). While it is off, the switches under it are drawn disabled
 * (`SwitchRow`'s `disabled`). `primary` false draws the button as text, for a
 * screen whose one filled button is another (onboarding's "סיימנו"). It
 * brings no side padding: the caller puts it in the page's gutter.
 */
export function NotificationPermissionNotice({
  permission, primary = true,
}: { permission: NotificationPermission; primary?: boolean }): React.JSX.Element | null {
  const p = usePalette();
  if (permission.state === 'checking') return null;
  if (permission.state === 'granted') {
    return (
      <View style={styles.grantedRow}>
        <View style={[styles.statusDot, { backgroundColor: p.ok }]} />
        <Text style={{ fontFamily: font.bodyMedium, fontSize: type.small, color: p.ok }}>ההתראות פעילות בטלפון</Text>
      </View>
    );
  }
  return (
    <View>
      <View style={styles.permission}>
        <Text style={{ flexShrink: 1, fontFamily: font.bodySemi, fontSize: type.body, color: p.cancel, lineHeight: 22 }}>{PERMISSION_OFF_LINE}</Text>
        <Button
          title={PERMISSION_ON_BUTTON}
          variant={primary ? 'primary' : 'ghost'}
          disabled={permission.busy}
          onPress={permission.enable}
        />
      </View>
      {/* Why the switches under it are grey, in one line over them (run 8). */}
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, marginTop: space.xs }}>{PERMISSION_SWITCHES_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grantedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  // The line at the start, its one button at the end; a long line at a large size pushes the button under it.
  permission: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: space.md, rowGap: space.sm,
  },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
});
