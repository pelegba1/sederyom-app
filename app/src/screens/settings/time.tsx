/**
 * A time on a row (F19): the stored `HH:mm` at the row's end, and the sheet
 * that picks the hour and the minutes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppIcon } from '../../components/AppIcon';
import { Sheet } from '../../components/Sheet';
import { Button, Ltr, MIN_TOUCH, Text, usePalette } from '../../components/ui';
import { joinTime, minuteOptions, splitTime } from '../../lib/timeOfDay';
import { font, space, type } from '../../theme';

// ---------------------------------------------------------------------------
// Time picker (F19)
// ---------------------------------------------------------------------------

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A stored `HH:mm` at the end of its row, written in the blue pen with a
 * down arrow, as a value that opens a choice; tapping it opens a sheet to
 * pick the hour and the minutes. Only a valid time can be saved, so the
 * server's own check never has to refuse one.
 */
export function TimeField({
  label, value, disabled = false, onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const color = disabled ? p.textMuted : p.accent;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint="פותח בחירת שעה"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.timeButton, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ltr style={{ fontFamily: font.headingSemi, fontSize: type.title, color, fontVariant: ['tabular-nums'] }}>{value}</Ltr>
        <AppIcon name="chevronDown" color={color} size={16} />
      </Pressable>
      <TimeSheet
        visible={open}
        title={label}
        value={value}
        onClose={() => setOpen(false)}
        onSave={(next) => {
          setOpen(false);
          if (next !== value) onChange(next);
        }}
      />
    </>
  );
}

export function TimeSheet({
  visible, title, value, onClose, onSave,
}: {
  visible: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const stored = splitTime(value);
  const [hour, setHour] = useState(stored?.hour ?? 7);
  const [minute, setMinute] = useState(stored?.minute ?? 0);

  // Every opening starts from what is stored.
  useEffect(() => {
    if (!visible) return;
    const t = splitTime(value);
    setHour(t?.hour ?? 7);
    setMinute(t?.minute ?? 0);
  }, [visible, value]);

  const minutes = useMemo(() => minuteOptions(splitTime(value)?.minute ?? null), [value]);
  const result = joinTime(hour, minute);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={<Button title="שמירה" disabled={result === null} onPress={() => result && onSave(result)} />}
    >
      <View style={{ alignItems: 'center', marginBottom: space.md }}>
        <Ltr style={{ fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.3), color: p.text }}>{result ?? value}</Ltr>
      </View>
      <Text style={[styles.pickerLabel, { color: p.textMuted }]}>שעה</Text>
      <View style={styles.timeGrid}>
        {HOURS.map((h) => (
          <TimeCell key={h} text={two(h)} label={`השעה ${h}`} active={h === hour} onPress={() => setHour(h)} />
        ))}
      </View>
      <Text style={[styles.pickerLabel, { color: p.textMuted, marginTop: space.lg }]}>דקות</Text>
      <View style={styles.timeGrid}>
        {minutes.map((m) => (
          <TimeCell key={m} text={two(m)} label={`${m} דקות`} active={m === minute} onPress={() => setMinute(m)} />
        ))}
      </View>
    </Sheet>
  );
}

/** One hour or minute: a ruled square; the chosen one highlighted, like a chosen filter. */
export function TimeCell({ text, label, active, onPress }: { text: string; label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.timeCell,
        { borderColor: active ? 'transparent' : p.border, backgroundColor: active ? p.mark : 'transparent', opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text
        maxScale={1.15}
        style={{ fontFamily: active ? font.headingSemi : font.bodyMedium, fontSize: type.body, color: active ? p.onMark : p.text, fontVariant: ['tabular-nums'] }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  timeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, paddingHorizontal: space.xs, justifyContent: 'center',
  },
  pickerLabel: { fontFamily: font.bodySemi, fontSize: type.small, marginBottom: space.sm },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timeCell: { minWidth: 48, minHeight: MIN_TOUCH, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
