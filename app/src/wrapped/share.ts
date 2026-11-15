/**
 * Sharing one card of the year in review as an image, through the phone's
 * share sheet.
 *
 * The rule is here and not in the screen: a card with grades or attendance
 * (`shareable: false`) is refused before any image is made, whoever asks. The
 * image itself (`components/WrappedFace`'s `ShareImage`) has the card's words,
 * the logo and the app's name; no student's name, no class, no teacher.
 *
 * The native parts come in as arguments, so this file runs anywhere.
 */
import type { WrappedCard } from '@sederyom/shared/logic/wrapped/types';
import { WRAPPED_COPY } from './copy';

/** A story's size in pixels, and the size in points the image is laid out at (three pixels to a point). */
export const SHARE_IMAGE = { width: 1080, height: 1920, points: { width: 360, height: 640 } } as const;

/**
 * The size to ask the capture for, so the file is `SHARE_IMAGE` pixels on both platforms: Android reads
 * pixels, iOS reads points and draws at the screen's scale.
 */
export function captureSize(os: string, pixelRatio: number): { width: number; height: number } {
  const scale = os === 'ios' && pixelRatio > 0 ? pixelRatio : 1;
  return { width: SHARE_IMAGE.width / scale, height: SHARE_IMAGE.height / scale };
}

/** Whether the card has a share button: not grades, not attendance, and not the closing, which says nothing. */
export function canShare(card: WrappedCard): boolean {
  return card.shareable && card.id !== 'outro';
}

export interface ShareSheet {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (url: string, options?: { mimeType?: string; UTI?: string; dialogTitle?: string }) => Promise<void>;
}

/**
 * `capture` draws the card's image and gives its file. `refused`: the card is
 * private. `unavailable`: this phone has no share sheet. A failure of the
 * capture or of the sheet throws. `release` lets the image's file go, whether
 * the sheet shared it or failed.
 */
export async function shareCard(
  card: WrappedCard, capture: () => Promise<string>, sheet: ShareSheet, release: (file: string) => void = () => undefined,
): Promise<'shared' | 'refused' | 'unavailable'> {
  if (!canShare(card)) return 'refused';
  if (!(await sheet.isAvailableAsync())) return 'unavailable';
  const file = await capture();
  try {
    await sheet.shareAsync(file.includes('://') ? file : `file://${file}`, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: WRAPPED_COPY.share });
  } finally {
    release(file);
  }
  return 'shared';
}
