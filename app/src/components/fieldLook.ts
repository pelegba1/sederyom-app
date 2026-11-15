/**
 * How a number field looks on the notebook page (plan §16): the bagrut
 * table's cells, the weights sheets' percents, and the fields beside them.
 * A cell one types into must read as a field, and a value worked out beside
 * it as plain text (the review: "an editable cell and a computed one look
 * alike").
 *
 *   <TextInput style={[styles.cell, fieldLook(p, { focused, dashed: mine })]} />
 */
import type { TextStyle } from 'react-native';
import type { Palette } from '../theme';

/** A field's corners. */
export const FIELD_RADIUS = 6;

/**
 * A field: filled `surfaceAlt`, radius 6, a 1-point rule under it (`accent`
 * while it has the focus). `dashed` is the owner's own value over Mashov's or
 * the table's — "שינית", "משוער", "שלך" — drawn dashed all round, never by
 * colour alone (plan §14.4). All round, because Android draws a dashed border
 * only when its four sides are alike.
 */
export function fieldLook(p: Palette, { focused = false, dashed = false }: { focused?: boolean; dashed?: boolean } = {}): TextStyle {
  if (dashed) {
    return {
      backgroundColor: p.surfaceAlt,
      borderRadius: FIELD_RADIUS,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: focused ? p.accent : p.textMuted,
    };
  }
  return {
    backgroundColor: p.surfaceAlt,
    borderRadius: FIELD_RADIUS,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderStyle: 'solid',
    borderColor: focused ? p.accent : p.border,
  };
}
