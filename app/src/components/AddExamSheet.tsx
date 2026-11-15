/**
 * "+ מבחן": an exam the student adds by hand, because not every school
 * publishes its exams where the app can read them. A subject (one of the
 * student's lessons, or typed), a day on the month calendar, and a note.
 * Kept on the phone (`local/manualExams.ts`) and shown with every other exam.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DateStr } from '@sederyom/shared';
import { useAddManualExam } from '../api/hooks';
import { formatShortDate, todayStr, weekdayName } from '../lib/format';
import { font, radius, space, type } from '../theme';
import { MonthCalendar } from './MonthCalendar';
import { FilterChip } from './notebook';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Ltr, Text, TextInput, usePalette } from './ui';

export interface AddExamSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The student's own subjects, offered as chips; any other can be typed. */
  subjects: readonly string[];
}

export function AddExamSheet({ visible, onClose, subjects }: AddExamSheetProps): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const add = useAddManualExam();
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState<DateStr | null>(null);
  const [details, setDetails] = useState('');
  const [focused, setFocused] = useState<'subject' | 'details' | null>(null);

  // A fresh sheet every time it opens.
  useEffect(() => {
    if (!visible) return;
    setSubject('');
    setDate(null);
    setDetails('');
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canSave = subject.trim().length > 0 && date !== null && !add.isPending;
  const save = (): void => {
    if (!canSave || !date) return;
    add.mutate(
      { date, subject, details },
      {
        onSuccess: () => {
          toast.show(`המבחן נוסף ל${weekdayName(date)} ${formatShortDate(date)}`);
          onClose();
        },
      },
    );
  };

  const field = (name: 'subject' | 'details') => {
    const on = focused === name;
    return [styles.input, { color: p.text, backgroundColor: p.surfaceAlt, borderBottomColor: on ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 }, on ? styles.inputFocused : null];
  };
  const label = { fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted, marginBottom: 6 } as const;

  const footer = (
    <View style={styles.footer}>
      <View style={{ flex: 1 }}>
        <Button title={add.isPending ? 'שומר…' : 'להוסיף מבחן'} disabled={!canSave} onPress={save} />
      </View>
      <Button title="ביטול" variant="ghost" disabled={add.isPending} onPress={onClose} />
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} dismissable={!add.isPending && subject.trim().length === 0} title="מבחן חדש" footer={footer}>
      <Text style={label}>מקצוע</Text>
      {subjects.length > 0 ? (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="מקצוע">
          {subjects.map((name) => (
            <FilterChip key={name} role="radio" label={name} selected={subject.trim() === name} onPress={() => setSubject(name)} />
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="מקצוע המבחן"
        value={subject}
        onChangeText={setSubject}
        placeholder="או לכתוב מקצוע"
        placeholderTextColor={p.textFaint}
        onFocus={() => setFocused('subject')}
        onBlur={() => setFocused((f) => (f === 'subject' ? null : f))}
        style={field('subject')}
      />

      <Text style={label}>תאריך</Text>
      <MonthCalendar date={date} initialMonth={date ?? todayStr()} onChange={setDate} />
      <Text style={[styles.picked, { color: date ? p.text : p.textMuted }]}>
        {date ? <>{`ב${weekdayName(date)} `}<Ltr>{formatShortDate(date)}</Ltr></> : 'צריך לבחור יום בלוח'}
      </Text>

      <Text style={label}>הערות</Text>
      <TextInput
        accessibilityLabel="הערות למבחן"
        value={details}
        onChangeText={setDetails}
        multiline
        placeholder="למשל: פרקים 3 עד 5"
        placeholderTextColor={p.textFaint}
        onFocus={() => setFocused('details')}
        onBlur={() => setFocused((f) => (f === 'details' ? null : f))}
        style={[field('details'), { minHeight: 75, textAlignVertical: 'top' }]}
      />

      {add.isError ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.body, fontSize: type.small, color: p.cancel }}>
          לא הצלחנו להוסיף את המבחן. כדאי לנסות שוב.
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The underlined field of the task sheet (plan §16.1).
  input: {
    borderBottomWidth: 1, borderTopStartRadius: radius.sm, borderTopEndRadius: radius.sm,
    paddingTop: 12, paddingBottom: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, marginBottom: space.md, textAlign: 'right', writingDirection: 'rtl',
  },
  inputFocused: { borderBottomWidth: 2, paddingBottom: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm, rowGap: space.sm, marginBottom: space.sm },
  picked: { fontFamily: font.bodySemi, fontSize: type.small, textAlign: 'center', marginTop: space.sm, marginBottom: space.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
