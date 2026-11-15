/**
 * The search field of a list (plan §16.1, the notebook): the page's light
 * fill with a rule under it, round at the top only, not a framed box. Tasks'
 * search and School's messages draw it; the row it sits in (and the picker
 * beside it) is the screen's own.
 */
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { font, radius, space, type } from '../theme';
import { MIN_TOUCH, TextInput, usePalette } from './ui';

export function SearchField({ label, placeholder, value, onChangeText }: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor={p.textFaint}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.search,
        focused ? styles.searchFocused : null,
        // No platform focus ring: around an underlined field it would be a frame again.
        { color: p.text, backgroundColor: p.surfaceAlt, borderBottomColor: focused ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // An underlined field (plan §16.1): the page's light fill, a rule under it, round at the top only.
  // Right to left, placeholder included: "חיפוש…" ends on the left (Daniel, run 3).
  search: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderBottomWidth: 1,
    borderTopStartRadius: radius.sm,
    borderTopEndRadius: radius.sm,
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: space.md,
    fontFamily: font.body,
    fontSize: type.body,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  // Typing: the rule turns blue and thickens, and the text does not move.
  searchFocused: { borderBottomWidth: 2, paddingBottom: 9 },
});
