import { I18nManager } from 'react-native';

/**
 * The app is Hebrew and RTL-native; there is no LTR mode (design-doc §3).
 * `forceRTL` only takes effect after a reload, so this runs before React does
 * and the very first render is already right-to-left.
 */
export function forceRtl(): void {
  I18nManager.allowRTL(true);
  if (!I18nManager.isRTL) {
    I18nManager.forceRTL(true);
    I18nManager.swapLeftAndRightInRTL(true);
  }
}
