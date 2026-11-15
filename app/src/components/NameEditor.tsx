/**
 * The student's own name for a subject, typed in place: the field, the line
 * under it, "לשמור" and "ביטול". One component for every place a name is given
 * (the lesson sheet, a row of "השיעורים שלי", the exam sheet), in the look of
 * the exam's own rename (`ExamSheet`): the underlined field of the task sheet,
 * a muted line, ghost buttons.
 *
 * It saves nothing itself: `onSave` gets the draft as typed, and whoever
 * called it cleans it and decides where it goes (`useRenameSubject`, which
 * takes an empty name, or the original, to mean "no name"). The field starts
 * on `initial` and shows `original` where it is empty, so the way back is
 * in view. "done" on the keyboard saves.
 *
 * A sheet that holds it can ask whether a name is typed and not yet saved
 * (`onDirty`) and not let a tap on its backdrop throw the name away.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { cleanSubjectName } from '@sederyom/shared/logic/ownNames';
import { font, radius, space, type } from '../theme';
import { Button, Text, TextInput, usePalette } from './ui';

/** The line under every subject-name field. */
export const SUBJECT_NAME_NOTE = 'השם יופיע בכל מקום שהמקצוע מופיע, כולל ההתראות.';

export interface NameEditorProps {
  /** What the field is called for a screen reader: "שם המקצוע". */
  label: string;
  /** What the field starts with: the name now shown, or empty. */
  initial: string;
  /** The source's name, shown while the field is empty. */
  original: string;
  /** The line under the field. */
  note: string;
  maxLength: number;
  onSave: (draft: string) => void;
  onCancel: () => void;
  /**
   * Called when the draft starts or stops differing from `initial` (as it
   * would be saved: spaces collapsed), and with `false` when the field goes
   * away, saved or not.
   */
  onDirty?: (dirty: boolean) => void;
}

export function NameEditor({ label, initial, original, note, maxLength, onSave, onCancel, onDirty }: NameEditorProps): React.JSX.Element {
  const p = usePalette();
  const [draft, setDraft] = useState(initial);
  const [focused, setFocused] = useState(false);
  const save = () => onSave(draft);
  const dirty = cleanSubjectName(draft) !== cleanSubjectName(initial);
  const latest = useRef(onDirty);
  latest.current = onDirty;
  useEffect(() => {
    latest.current?.(dirty);
  }, [dirty]);
  // A field that is gone has nothing unsaved for a sheet to guard.
  useEffect(() => () => latest.current?.(false), []);
  return (
    <View style={styles.block}>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint="שם ריק מחזיר את השם המקורי"
        value={draft}
        onChangeText={setDraft}
        autoFocus
        maxLength={maxLength}
        returnKeyType="done"
        onSubmitEditing={save}
        placeholder={original}
        placeholderTextColor={p.textFaint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          { color: p.text, backgroundColor: p.surfaceAlt, borderBottomColor: focused ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 },
          focused ? styles.inputFocused : null,
        ]}
      />
      <Text style={[styles.paragraph, { color: p.textMuted }]}>{note}</Text>
      <View style={styles.buttons}>
        <Button title="לשמור" variant="ghost" onPress={save} />
        <Button title="ביטול" variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  paragraph: { fontFamily: font.body, fontSize: type.small, lineHeight: 21 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginStart: -space.md },
  // The underlined field of the task sheet (plan §16.1), as the exam's rename has it.
  input: {
    borderBottomWidth: 1, borderTopStartRadius: radius.sm, borderTopEndRadius: radius.sm,
    paddingTop: 12, paddingBottom: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, textAlign: 'right', writingDirection: 'rtl',
  },
  inputFocused: { borderBottomWidth: 2, paddingBottom: 11 },
});
