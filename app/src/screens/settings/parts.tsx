/**
 * The pieces every page of Settings shares: a section under its heading, the
 * switch row, the row that opens a screen, the few-choice radio row, and
 * `SettingsPage`, which loads the settings once and draws the scrolling page
 * the rows sit on.
 *
 * The switch row is also used by the onboarding screen and the calendars one.
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NotificationType, SettingsPatch, SettingsResponse } from '@sederyom/shared';
import { NOTIFICATION_TYPES, UNDISABLEABLE } from '@sederyom/shared';
import { useSaveSettings, useSettings } from '../../api/hooks';
import { AppIcon } from '../../components/AppIcon';
import { Row, ROW_GUTTER, SectionHeading } from '../../components/notebook';
import { useToast } from '../../components/Toast';
import { ErrorState, Loading, MIN_TOUCH, Screen, Switch, Text, usePalette } from '../../components/ui';
import { font, space, type } from '../../theme';
import { LOAD_ERROR_TEXT } from '../ConnectionsScreen';

/** What only the student's Mashov brings: no switch for it on a parent's phone (docs/parents-plan.md). */
export const STUDENT_ONLY: readonly NotificationType[] = ['new_homework', 'new_grade', 'teacher_message'];

/** Types with a switch of their own; the two undisableable ones are stated, not switched. */
// The next lesson on the lock screen (ideas פ1) takes itself back only on Android (the
// notifications patch); on an iPhone it waits for a Live Activity.
export const TOGGLES = NOTIFICATION_TYPES.filter((t) => !UNDISABLEABLE.includes(t) && (t !== 'next_lesson' || Platform.OS === 'android'));

/** The notification types with a switch on this phone: a parent's has none of what only the student's Mashov brings. */
export function shownToggles(parent: boolean): readonly NotificationType[] {
  return TOGGLES.filter((t) => !parent || !STUDENT_ONLY.includes(t));
}

export const SAVE_ERROR = 'לא הצלחנו לשמור. אפשר לנסות שוב';

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * A page of Settings: the settings loaded once, a loading state while they
 * come and the retry when they do not, then the rows given by `children`
 * on the scrolling page.
 */
export function SettingsPage({ children }: { children: (data: SettingsResponse) => React.ReactNode }): React.JSX.Element {
  const settings = useSettings();
  if (settings.isLoading) return <Screen><Loading /></Screen>;
  if (settings.isError || !settings.data) {
    return (
      <Screen>
        <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void settings.refetch()} />
      </Screen>
    );
  }
  return (
    <Screen>
      {/* "handled": with the school address field open, the first tap on a button is the button's, not the keyboard's. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children(settings.data)}
      </ScrollView>
    </Screen>
  );
}

/**
 * Saves a change to the settings; when the save fails, says so in a toast.
 * `busy` is true while a save is in flight, for a `SwitchRow`'s `busy`. Both
 * come from ONE `useSaveSettings()` instance: a mutation's `isPending` is
 * per instance, so a `busy` read from another instance than the one that
 * saves would never turn on, and the row would take a second press mid-save
 * and keep its new place after a failed one.
 */
export function usePatch(): { patch: (body: SettingsPatch) => void; busy: boolean } {
  const save = useSaveSettings();
  const toast = useToast();
  return {
    patch: (body) => save.mutate(body, { onError: () => toast.show(SAVE_ERROR) }),
    busy: save.isPending,
  };
}

// ---------------------------------------------------------------------------
// Switch rows (plan W4-3)
// ---------------------------------------------------------------------------

/**
 * A setting with an on/off switch, the one way every setup screen draws one:
 * a ruled row of the page (`Row`, plan §16.1), edge to edge. The whole row is
 * the control — role `switch`, its state, the label as its name — and ui's
 * `Switch` is only drawn, at the row's end, beside text that takes the rest
 * of the row: a long description wraps before the switch and is never covered
 * by it (Daniel, Maya, Noa: "בשם ״בית ספר״").
 *
 * The switch moves at once and keeps its new place while the save is in
 * flight (`busy`); once the save settles it shows what was saved — its old
 * place again if the save failed.
 *
 * `disabled` (a notification while the phone allows none): muted, its switch
 * not to be moved, and still read out with its stored state, `disabledHint`
 * saying why. With `onDisabledPress` a press on it does that instead of
 * nothing: the notification rows ask the phone for notifications, as
 * "להדליק" does (run 8).
 */
export function SwitchRow({
  label, children, hint, hintColor, value, onChange, busy = false, disabled = false, disabledHint, onDisabledPress,
}: {
  /** The setting's name, read out with the switch's state; drawn unless `children` draws it. */
  label: string;
  /**
   * The label drawn another way, in the row's title line: text only (a time
   * through `Ltr`, a muted word after the name), since it is set inside a `Text`.
   */
  children?: React.ReactNode;
  hint?: string;
  hintColor?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** A save is in flight: the row takes no new press until it settles. */
  busy?: boolean;
  /** The setting cannot apply now: drawn muted and not pressable, its state still spoken. */
  disabled?: boolean;
  /** Why it is disabled, read after its name and state. */
  disabledHint?: string;
  /** What a press on the disabled row does (asks for the permission); without it, nothing. */
  onDisabledPress?: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (!busy) setPending(null);
  }, [busy, value]);
  const shown = pending ?? value;
  const off = busy || disabled;
  // A disabled row with somewhere to send the press stays pressable; its switch still never moves.
  const redirect = disabled && onDisabledPress !== undefined;
  return (
    <Row
      title={children ?? label}
      titleStyle={disabled ? { color: p.textMuted } : null}
      end={<Switch value={shown} disabled={disabled} />}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={disabled && disabledHint ? disabledHint : hint}
      accessibilityState={{ checked: shown, disabled: off }}
      disabled={busy || (disabled && !redirect)}
      onPress={() => {
        if (disabled) {
          onDisabledPress?.();
          return;
        }
        const next = !shown;
        setPending(next);
        onChange(next);
      }}
    >
      {hint ? <Text style={[styles.hint, { color: hintColor ?? p.textMuted }]}>{hint}</Text> : null}
    </Row>
  );
}

/** A section of the page: its heading in the gutter, then rows edge to edge. */
export function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.section}>
      <View style={styles.gutter}>
        <SectionHeading>{title}</SectionHeading>
      </View>
      {children}
    </View>
  );
}

/**
 * One choice out of a few, as a row of radio buttons drawn like filters
 * (plan §16.1): radius 8 and a ruled border; the chosen one highlighted and
 * ticked, in the text's colour, so it reads on both pages.
 *
 * Each label stays on one line (W5-12: "לפי הטלפון" broke in two at "גדול
 * מאוד"). Choices share the row equally while their labels fit; when one
 * needs more room the row wraps, and the choices that moved down share the
 * next line.
 */
export function Segments<T extends string>({
  label, options, labels, value, onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <View>
      <Text style={[styles.choiceLabel, { color: p.text }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segments}>
        {options.map((option) => {
          const active = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={labels[option]}
              accessibilityState={{ checked: active }}
              hitSlop={{ top: SEGMENT_SLOP, bottom: SEGMENT_SLOP }}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.segment,
                { borderColor: active ? 'transparent' : p.border, backgroundColor: active ? p.mark : 'transparent', opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {active ? <AppIcon name="check" color={p.onMark} size={16} /> : null}
              <Text
                numberOfLines={1}
                style={{ fontFamily: active ? font.bodySemi : font.bodyMedium, fontSize: type.label, color: active ? p.onMark : p.textMuted }}
              >
                {labels[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const SEGMENT_HEIGHT = 36;
const SEGMENT_SLOP = (MIN_TOUCH - SEGMENT_HEIGHT) / 2;

/**
 * A row that opens a screen: its name, and under it what is there now (the
 * count, said the positive way), then a line of what it is, if it needs one.
 */
export function LinkRow({
  label, value, hint, onPress,
}: {
  label: string;
  value?: string;
  hint?: string;
  onPress: () => void;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <Row
      title={label}
      subtitle={value}
      chevron
      accessibilityLabel={value ? `${label}: ${value}` : label}
      onPress={onPress}
    >
      {hint ? <Text style={[styles.hint, { color: p.textMuted }]}>{hint}</Text> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 80 },
  section: { marginTop: space.xxl },
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  hint: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  choiceLabel: { fontFamily: font.bodySemi, fontSize: type.body, marginBottom: space.md },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Its label's width, but at least a third of the row (less the gaps): three
  // short labels share it equally, and a long one wraps instead of breaking.
  segment: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: '30%', minHeight: SEGMENT_HEIGHT, borderRadius: 8, borderWidth: 1,
    paddingHorizontal: space.md,
  },
});
