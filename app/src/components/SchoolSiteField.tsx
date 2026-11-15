/**
 * The school's timetable site, pasted by the student when Mashov names none
 * (plan Phase 3): a line saying what to paste, the field, and "לחפש את
 * הכיתות". Any form the browser shows works, with or without `https://` and
 * with the page after it (`shahafSiteOf`); the phone keeps the address only
 * once the site answered with its classes, which then show where the field
 * was. The class step and Settings' class picker both draw it; it brings no
 * side padding.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError } from '../api/client';
import { useLookUpSchoolSite } from '../api/hooks';
import { SCHOOL_SITE_COPY } from '../lib/onboarding';
import { font, space, type } from '../theme';
import { fieldLook } from './fieldLook';
import { Button, Ltr, Text, TextInput, usePalette } from './ui';

export function SchoolSiteField(): React.JSX.Element {
  const p = usePalette();
  const lookUp = useLookUpSchoolSite();
  const [address, setAddress] = useState('');
  const [focused, setFocused] = useState(false);
  const busy = lookUp.isPending;
  const problem = lookUp.error ? (lookUp.error instanceof ApiError ? lookUp.error.message : SCHOOL_SITE_COPY.noAnswer) : null;
  const ready = !busy && address.trim().length > 0;
  const submit = (): void => {
    if (ready) lookUp.mutate(address.trim());
  };

  return (
    <View style={styles.block}>
      <Text style={[styles.line, { color: p.textMuted }]}>
        {SCHOOL_SITE_COPY.pasteBefore}
        <Ltr style={[styles.line, { color: p.text }]}>shahaf.site</Ltr>
        {SCHOOL_SITE_COPY.pasteAfter}
      </Text>
      <TextInput
        accessibilityLabel={SCHOOL_SITE_COPY.fieldLabel}
        value={address}
        onChangeText={(text) => {
          setAddress(text);
          if (lookUp.error) lookUp.reset();
        }}
        placeholder={SCHOOL_SITE_COPY.placeholder}
        placeholderTextColor={p.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="search"
        onSubmitEditing={submit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, { color: p.text, outlineColor: 'transparent', outlineWidth: 0 }, fieldLook(p, { focused })]}
      />
      {problem ? <Text accessibilityRole="alert" style={[styles.line, { color: p.cancel }]}>{problem}</Text> : null}
      <View style={styles.actions}>
        <Button title={busy ? SCHOOL_SITE_COPY.lookingUp : SCHOOL_SITE_COPY.lookUp} disabled={!ready} onPress={submit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  line: { fontFamily: font.body, fontSize: type.small, lineHeight: 21 },
  // An address reads left to right, so the field is written that way, whatever the page's direction.
  input: {
    paddingVertical: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, textAlign: 'left', writingDirection: 'ltr',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
});
