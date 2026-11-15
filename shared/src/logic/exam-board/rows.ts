/**
 * What a row of a board is held to, one copy for the server and the phone: the lengths of its title and details, how
 * many rows a board keeps, and what a day is. The server refuses a save that breaks them (`bad_rows`); the phone, which
 * keeps a board of a student's own, cuts to them. Each keeps its own way of holding to them; the numbers are these.
 *
 * Pure, with no dependency, so the phone runs it too.
 */
import type { DateStr } from '../../index';

/** A title is 1 to this many characters. */
export const BOARD_TITLE_MAX = 200;
/** Details are at most this many characters. */
export const BOARD_DETAILS_MAX = 500;
/** The most rows one board keeps. */
export const BOARD_ROWS_MAX = 400;

/** `YYYY-MM-DD` that is a day of the calendar: 2026-02-30 is not, though it has the shape. */
export function isBoardDay(date: string): date is DateStr {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}
