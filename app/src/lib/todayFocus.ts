/**
 * What "היום שלי" opens once it shows the day a notification led to (Wave 7;
 * Noa and Maya, run 6: "שינוי במערכת של היום · שיעור 7 היסטוריה מבוטל"
 * opened the screen at its top, and the lesson had to be found by hand).
 *
 * The tap navigates to Today with the day as its `date` param, as before;
 * what to open there rides beside it here, like the Mashov renewal's request
 * (lib/mashovRenew.ts), so the tab's route params keep their shape. Today
 * takes the request when it consumes that `date`, once:
 *
 *   requestTodayFocus('2026-10-08', 'changes');    // push/handlers.ts
 *   takeTodayFocus(paramDate);                     // TodayScreen, on the visit
 *
 * Pure apart from that one pending request — no React — so app/test can load it.
 */
import type { DateStr, Lesson } from '@sederyom/shared';
import type { TodayFocus } from './notifications';

export type { TodayFocus } from './notifications';

/** A request not taken by then is stale: the visit it was for never came. */
export const TODAY_FOCUS_TTL_MS = 60_000;

let pending: { date: DateStr; focus: TodayFocus; at: number } | null = null;

/** Asks Today to open `focus` when it next shows `date` from a link. Replaces any request before it. */
export function requestTodayFocus(date: DateStr, focus: TodayFocus, now: number = Date.now()): void {
  pending = { date, focus, at: now };
}

/**
 * The request for `date`, taken: it is gone after this, whatever the answer.
 * `null` when there is none, it was for another day, or it went stale.
 */
export function takeTodayFocus(date: DateStr, now: number = Date.now()): TodayFocus | null {
  const request = pending;
  pending = null;
  if (!request || request.date !== date || now - request.at > TODAY_FOCUS_TTL_MS) return null;
  return request.focus;
}

/**
 * What "the change itself" is on the day: one changed lesson opens its own
 * sheet; several open the list of the day's changes ("4 שינויים ביום הזה");
 * none — the change went back, or the lesson left the timetable altogether —
 * opens nothing, and the day is there as it is.
 */
export function changesTarget(changed: readonly Lesson[]): { kind: 'lesson'; lesson: Lesson } | { kind: 'list' } | null {
  if (changed.length === 0) return null;
  if (changed.length === 1) return { kind: 'lesson', lesson: changed[0]! };
  return { kind: 'list' };
}
