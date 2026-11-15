/**
 * Google expands a recurring event into instances whose ids are the series id
 * plus `_<start>`: `abc123_20260901` for an all-day series and
 * `abc123_20260901T150000Z` for a timed one. That suffix is what makes "hide
 * this occurrence" and "hide the whole series" two different requests, and
 * reading it off the id means neither side has to store a second identifier.
 */
export function seriesIdOf(eventId: string): string | null {
  const m = /^(.+)_(\d{8})(T\d{6}Z)?$/.exec(eventId);
  return m ? m[1]! : null;
}
