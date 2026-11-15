/**
 * The grades tab's two sheets for weights (plan §15, W8):
 * - `SubjectWeightsSheet`, from a subject's "משקלים": each type's percent,
 *   the sum in one line, a type of the owner's own, and "לחזור לברירת המחדל";
 * - `GradeSheet`, from a grade row: its type (filter chips) and, optionally,
 *   a weight of its own.
 *
 * Every change is kept as it is made (`update`), and the subject's average
 * over the sheet follows it, so there is no "save".
 *
 * Wave 9 (plan §16): ruled rows on the sheet, each with a field that looks
 * like the bagrut table's (`fieldLook`); the type is chosen from filter
 * chips.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Grade } from '@sederyom/shared';
import { EMPTY_MARK } from '../lib/bagrut';
import { formatShortDate, plural } from '../lib/format';
import {
  DEFAULT_TYPES, isBuiltinType, parsePercent, percentSum, resolveGrade, subjectKey, subjectTypes,
  type GradeWeightsPrefs, type SubjectAverage,
} from '../lib/gradeWeights';
import {
  addType, removeType, resetGrade, resetSubject, setGradeType, setGradeWeight, setTypePercent, TYPE_LABEL_MAX,
} from '../lib/gradeWeightsStore';
import { assessmentName, cleanText, formatAverage, percentSumParts } from '../lib/school';
import { font, space, type } from '../theme';
import { AppIcon } from './AppIcon';
import { fieldLook } from './fieldLook';
import { FilterChip, ROW_MIN_HEIGHT } from './notebook';
import { Sheet } from './Sheet';
import { Button, Ltr, MIN_TOUCH, Text, TextInput, touchSlop, usePalette } from './ui';

/** A change to the owner's weights, kept on the phone at once. */
export type WeightsUpdate = (change: (prefs: GradeWeightsPrefs) => GradeWeightsPrefs) => void;

/**
 * A percent field. Each number typed counts at once, so the average moves
 * with it; an emptied field counts as "none" but stays empty until the field
 * is left, so a new number can be typed in its place.
 */
function PercentField({
  value, onChange, label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  /** What a screen reader says: the type or the grade by name. */
  label: string;
}): React.JSX.Element {
  const p = usePalette();
  const shown = value === null ? '' : formatAverage(value);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  return (
    <View style={styles.fieldRow}>
      <TextInput
        accessibilityLabel={label}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(next) => {
          setText(next);
          const n = parsePercent(next);
          if (n !== undefined && n !== value) onChange(n);
        }}
        keyboardType="decimal-pad"
        returnKeyType="done"
        placeholder={EMPTY_MARK}
        placeholderTextColor={p.textFaint}
        maxLength={5}
        maxScale={1.15}
        style={[styles.field, { color: p.text }, fieldLook(p, { focused })]}
      />
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>%</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// A subject's types

export function SubjectWeightsSheet({
  subject, name = null, grades, average, prefs, update, onClose,
}: {
  /** The subject its setup is kept under (Mashov's name, without its group); `null` while closed. */
  subject: string | null;
  /** The subject as the tab names it, a name the student gave as typed; `subject` when not given. */
  name?: string | null;
  /** The subject's Mashov grades: how many each type has. */
  grades: readonly Grade[];
  average: SubjectAverage | null;
  prefs: GradeWeightsPrefs;
  update: WeightsUpdate;
  onClose: () => void;
}): React.JSX.Element {
  const p = usePalette();
  // Kept while the sheet slides away.
  const last = useRef<string | null>(subject);
  if (subject) last.current = subject;
  const shown = subject ?? last.current;
  const lastName = useRef<string | null>(name);
  if (subject) lastName.current = name;
  const title = (subject ? name : lastName.current) ?? shown;
  const [newType, setNewType] = useState('');
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    if (subject) setNewType('');
  }, [subject]);

  const types = shown ? subjectTypes(prefs, shown) : DEFAULT_TYPES;
  const counts = new Map<string, number>();
  for (const g of grades) {
    if (typeof g.value !== 'number') continue;
    const r = resolveGrade(g, types, prefs.grades[g.naturalKey]);
    if (r.weight === null) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }
  const sum = percentSumParts(percentSum(types));
  const changed = shown !== null && subjectKey(shown) in prefs.subjects;
  const add = (): void => {
    const label = newType.trim();
    if (!shown || !label) return;
    update((prev) => addType(prev, shown, label).prefs);
    setNewType('');
  };

  return (
    <Sheet
      visible={subject !== null}
      onClose={onClose}
      title={title ? `משקלים ב${title}` : ''}
      footer={changed && shown ? (
        <Button title="לחזור לברירת המחדל" variant="ghost" onPress={() => update((prev) => resetSubject(prev, shown))} />
      ) : undefined}
    >
      {shown ? (
        <View>
          {types.map((t) => {
            const count = counts.get(t.id) ?? 0;
            return (
              <View key={t.id} style={[styles.typeRow, { borderBottomColor: p.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.bodySemi, fontSize: type.title, color: p.text }}>{t.label}</Text>
                  {count > 0 ? (
                    <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{plural(count, 'ציון אחד', 'ציונים')}</Text>
                  ) : null}
                </View>
                {!isBuiltinType(t.id) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`להסיר את ${t.label}`}
                    hitSlop={touchSlop(32)}
                    onPress={() => update((prev) => removeType(prev, shown, t.id))}
                    style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <AppIcon name="close" color={p.textMuted} size={16} />
                  </Pressable>
                ) : null}
                <PercentField
                  value={t.percent}
                  label={`${t.label}, אחוזים`}
                  onChange={(value) => update((prev) => setTypePercent(prev, shown, t.id, value))}
                />
              </View>
            );
          })}

          <View style={styles.sumRow}>
            <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.small, color: sum.note ? p.text : p.textMuted }}>
              {sum.lead}
              <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: sum.note ? p.text : p.textMuted }}>{sum.value}</Ltr>
              {sum.note ? `, ${sum.note}` : ''}
            </Text>
            {average ? (
              <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>
                {'ממוצע '}
                <Ltr style={{ fontFamily: font.headingSemi, fontSize: type.title, color: p.text }}>{formatAverage(average.value)}</Ltr>
              </Text>
            ) : null}
          </View>

          <View style={styles.addRow}>
            <TextInput
              accessibilityLabel="סוג חדש"
              value={newType}
              onChangeText={setNewType}
              onFocus={() => setNaming(true)}
              onBlur={() => setNaming(false)}
              onSubmitEditing={add}
              returnKeyType="done"
              placeholder="סוג חדש"
              placeholderTextColor={p.textFaint}
              maxLength={TYPE_LABEL_MAX}
              maxScale={1.15}
              style={[styles.nameField, { color: p.text }, fieldLook(p, { focused: naming })]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="להוסיף סוג"
              accessibilityState={{ disabled: !newType.trim() }}
              disabled={!newType.trim()}
              onPress={add}
              style={({ pressed }) => [styles.addButton, { opacity: !newType.trim() ? 0.45 : pressed ? 0.7 : 1 }]}
            >
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.accent }}>להוסיף</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// One grade

export function GradeSheet({
  grade, prefs, update, onClose,
}: {
  /** `null` while closed. */
  grade: Grade | null;
  prefs: GradeWeightsPrefs;
  update: WeightsUpdate;
  onClose: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const last = useRef<Grade | null>(grade);
  if (grade) last.current = grade;
  const shown = grade ?? last.current;
  // Kept under Mashov's name, whatever name the student gave the subject.
  const types = shown ? subjectTypes(prefs, shown.originalSubject ?? shown.subject) : DEFAULT_TYPES;
  const resolved = shown ? resolveGrade(shown, types, prefs.grades[shown.naturalKey]) : null;
  const words = shown && shown.value === null ? cleanText(shown.valueText) || EMPTY_MARK : null;

  return (
    <Sheet
      visible={grade !== null}
      onClose={onClose}
      title={shown ? (assessmentName(shown) ?? 'ציון') : ''}
      footer={shown && resolved?.changed ? (
        <Button title="לחזור לברירת המחדל" variant="ghost" onPress={() => update((prev) => resetGrade(prev, shown.naturalKey))} />
      ) : undefined}
    >
      {shown && resolved ? (
        <View style={{ gap: space.lg }}>
          <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>
            <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>{formatShortDate(shown.date)}</Ltr>
            {', '}
            {words ?? <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>{String(shown.value)}</Ltr>}
          </Text>

          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>סוג</Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {types.map((t) => (
                <FilterChip
                  key={t.id}
                  role="radio"
                  label={t.label}
                  selected={t.id === resolved.type}
                  accessibilityLabel={t.label}
                  onPress={() => update((prev) => setGradeType(prev, shown, t.id))}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>משקל משלו (לא חובה)</Text>
            <View style={[styles.weightRow, { borderBottomColor: p.border }]}>
              <PercentField
                value={resolved.weight}
                label="משקל משלו, אחוזים מהציון במקצוע"
                onChange={(value) => update((prev) => setGradeWeight(prev, shown, value))}
              />
              <Text style={{ flexShrink: 1, fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>
                {resolved.weight !== null && resolved.weight === resolved.mashovWeight ? 'מהציון במקצוע, ממשוב' : 'מהציון במקצוע'}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: ROW_MIN_HEIGHT, paddingVertical: space.sm, borderBottomWidth: 1 },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  field: {
    minWidth: 64, minHeight: MIN_TOUCH, paddingHorizontal: space.sm,
    fontFamily: font.bodySemi, fontSize: type.body, textAlign: 'center',
  },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH, marginTop: space.xs },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, marginBottom: space.sm },
  nameField: {
    flex: 1, minHeight: MIN_TOUCH, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, textAlign: 'right',
  },
  // A text button (plan §16.1): the accent word, no frame.
  addButton: { minHeight: MIN_TOUCH, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.sm, borderBottomWidth: 1 },
});
