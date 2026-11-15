/**
 * When a swipe between the main tabs earns its tick (docs/superpowers/specs/
 * 2026-11-03-tab-swipe-design.md): only when a swipe lands on another page,
 * never for a tap on the bar or a push that opens a tab.
 *
 * The pager reports a swipe's start and end, and the navigator reports the
 * tab that became focused. Android chooses the page before the swipe ends;
 * iOS may end first and choose a moment later, so a choice that comes
 * shortly after the end (`SWIPE_GRACE_MS`) still counts. A swipe that springs
 * back leaves nothing behind: a tap on the bar right after it, or a push a
 * second later, does not tick.
 */

/** How long after a swipe ends the page it chose may still arrive. */
export const SWIPE_GRACE_MS = 600;

export interface SwipeTrack {
  /** The tab the swipe started on, or `null` with no swipe under way. */
  from: number | null;
  /** When the swipe ended, or `null` while the finger is still on the page. */
  endedAt: number | null;
}

export const SWIPE_IDLE: SwipeTrack = { from: null, endedAt: null };

export type SwipeEvent =
  | { type: 'start'; index: number; at: number }
  | { type: 'end'; at: number }
  /** A tap on the bar: whatever comes next is the tap's, not a swipe's. */
  | { type: 'tap'; at: number }
  | { type: 'index'; index: number; at: number };

/** One event in. A second start or end, without a choice between them, changes nothing. */
export function swipeStep(track: SwipeTrack, event: SwipeEvent): { track: SwipeTrack; tick: boolean } {
  switch (event.type) {
    case 'start':
      return { track: { from: track.from ?? event.index, endedAt: null }, tick: false };
    case 'end':
      if (track.from === null) return { track, tick: false };
      return { track: { from: track.from, endedAt: track.endedAt ?? event.at }, tick: false };
    case 'tap':
      return { track: SWIPE_IDLE, tick: false };
    case 'index': {
      if (track.from === null) return { track: SWIPE_IDLE, tick: false };
      if (event.index === track.from) return { track, tick: false };
      const live = track.endedAt === null || event.at - track.endedAt <= SWIPE_GRACE_MS;
      return { track: SWIPE_IDLE, tick: live };
    }
  }
}
