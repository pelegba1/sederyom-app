/**
 * The child on screen, on a parent's phone with more than one (parents mode,
 * stage 2; `local/children.ts`): a chip per child above the days, the one on
 * screen marked. Nothing on any other phone.
 *
 * Under the tab's header on היום בכיתה and שבוע, the two tabs whose days are
 * one child's; בית ספר follows the same child.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useChildren, useShowChild } from '../api/hooks';
import { CHILDREN_COPY } from '../lib/onboarding';
import { space } from '../theme';
import { FilterChip } from './notebook';

export function ChildSwitcher({ style }: { style?: StyleProp<ViewStyle> }): React.JSX.Element | null {
  const children = useChildren();
  const show = useShowChild();
  const list = children.data?.list;
  if (!list || list.length < 2) return null;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={CHILDREN_COPY.switcher} style={[styles.row, style]}>
      {list.map((child) => (
        <FilterChip
          key={child.id}
          role="radio"
          label={child.name}
          selected={child.shown}
          disabled={show.isPending}
          onPress={() => {
            if (!child.shown) show.mutate(child.id);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.xl, paddingBottom: space.sm },
});
