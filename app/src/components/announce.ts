/**
 * What a screen reader is told of a line that appears where the person is, on both phones. Android says a line marked
 * `accessibilityLiveRegion` as it appears; iOS has no live regions, so VoiceOver is told the same words here
 * (`AccessibilityInfo.announceForAccessibility`). The line keeps its live region for Android; this adds iOS.
 *
 *   useAnnounceOnIos(asking ? asking.text : null);
 */
import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Tells VoiceOver `text` each time it appears or changes, on iOS only; nothing for `null`, `false` or `''`. */
export function useAnnounceOnIos(text: string | null | false | undefined): void {
  useEffect(() => {
    if (Platform.OS === 'ios' && text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}
