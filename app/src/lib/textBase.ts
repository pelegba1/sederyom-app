/**
 * The iPhone's right-to-left text: a base style that `components/ui`'s `Text`
 * and `TextInput` put first, under every style of the caller's.
 *
 * Why only iOS: React Native leaves a paragraph with no `writingDirection` as
 * "natural", and iOS resolves natural from the phone's language, not from the
 * app's forced RTL. On a phone in English every line wider than its words (a
 * card's title, "אין שינויים היום", a teacher line) sat on the left, and mixed
 * Hebrew and numbers were ordered as an English paragraph. Android reads a
 * paragraph by its first strong letter and right-aligns it under RTL already
 * (memory: rn-android-rtl-facts), so it gets nothing.
 *
 * - Text: `writingDirection: 'rtl'` makes the paragraph right-to-left, and so
 *   its natural alignment right. `textAlign: 'left'` makes the alignment
 *   certain: React Native's iOS text swaps left and right when the text's
 *   layout is RTL (`RCTAttributedTextUtils.mm`), so 'left' lands on the RIGHT.
 *   A caller's `textAlign: 'center'` still wins. An `Ltr` run keeps its order
 *   inside the paragraph by its isolates.
 * - TextInput: an input's text gets no layout direction, so nothing is
 *   swapped there: 'right' is the right. The inputs that hold an address or a
 *   calendar id set 'left' and 'ltr' themselves, and keep them.
 */
import type { StyleProp, TextStyle } from 'react-native';

export type TextKind = 'text' | 'input';

export function textBase(os: string, kind: TextKind): TextStyle | null {
  if (os !== 'ios') return null;
  return kind === 'text' ? { writingDirection: 'rtl', textAlign: 'left' } : { writingDirection: 'rtl', textAlign: 'right' };
}

/** The caller's style over the base: later entries win in a React Native style array. */
export function withTextBase(base: TextStyle | null, style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  if (!base) return style;
  return style === undefined || style === null ? base : [base, style];
}
