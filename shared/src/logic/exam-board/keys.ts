/**
 * The identity of an exam that came from a file or a page rather than from
 * the grade's calendar, which has UIDs. A row has none of its own, so its key
 * is made of what it says: the day and the title. The same board uploaded
 * again gives the same keys, and what a student keeps against a key on the
 * phone (hidden, renamed, mirrored to Google) stays with it. An exam that
 * moves to another day is a new key, as it is in the calendar.
 */
import type { DateStr } from '../../index';
import { cleanText } from './text';

/** 32-bit FNV-1a of the string's UTF-16 code units, as 8 hex digits. */
function fnv1a32hex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A title as two uploads of the same board may spell it: cleaned (`cleanText`: no control, no bidi mark, no
 * zero-width character), with or without the quote marks Hebrew abbreviations carry (`"`, `״`, `'`, `׳`) and with
 * any run of spaces. Two titles that are the same here are one exam of a day: the extractor and a save tell rows
 * apart by it.
 */
export function normTitle(title: string): string {
  return cleanText(title).replace(/["״'׳]/g, '').replace(/\s+/g, ' ').trim();
}

/** `site-exam|up|<hash>`, beside the calendar's `site-exam|<uid>`. */
export function uploadedExamKey(date: DateStr, title: string): string {
  return `site-exam|up|${fnv1a32hex(`${date}|${normTitle(title)}`)}`;
}
