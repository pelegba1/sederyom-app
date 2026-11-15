/**
 * A friend's initial in a circle of the pen (friends spec 2.3, 2.2): on the
 * friends list at the usual size, and small and overlapping on Today's lines.
 * Grey and dashed while the friend is waited for; a glyph in place of a letter
 * when there is no name (an invite nobody answered).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppIcon, type IconName } from './AppIcon';
import { Text, usePalette } from './ui';
import { font, type } from '../theme';

/** The circle's size on the friends list, as the sketch's. */
export const INITIAL_SIZE = 32;

export function BuddyInitial({ letter, icon, waiting = false, size = INITIAL_SIZE }: {
  letter?: string;
  icon?: IconName;
  waiting?: boolean;
  size?: number;
}): React.JSX.Element {
  const p = usePalette();
  const ink = waiting ? p.textFaint : p.accent;
  const small = size < INITIAL_SIZE;
  return (
    <View
      style={[
        styles.initial,
        { width: size, height: size, borderRadius: size / 2, borderColor: ink, borderStyle: waiting ? 'dashed' : 'solid', backgroundColor: p.bg },
      ]}
    >
      {icon ? <AppIcon name={icon} color={ink} size={small ? 12 : 16} /> : (
        <Text maxScale={1.15} style={[small ? styles.smallText : styles.initialText, { color: ink }]}>{letter}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontFamily: font.heading, fontSize: type.caption, lineHeight: 18 },
  // In the sketch's 22-point circle: a letter of 12 points, what the ring leaves room for.
  smallText: { fontFamily: font.heading, fontSize: 12, lineHeight: 16 },
});
