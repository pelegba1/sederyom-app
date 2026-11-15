/**
 * The one cleaner of a board's text, on the server and on the phone: what is kept of a title or of a line of details a
 * stranger brought (a save, the extractor, the phone's own board), and of a calendar's title. Such text may carry
 * characters a database refuses (NUL, half a surrogate pair), other controls, and marks that are never seen but reorder
 * a line or make two spellings of one title (bidi controls, zero-width characters).
 *
 * Pure, with no dependency, so the phone runs it too.
 */

/**
 * The marks that are not seen: the bidi controls (U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) and the
 * zero-width characters (U+200B to U+200D, U+FEFF).
 */
const MARKS = /[​-‏‪-‮⁦-⁩﻿]/g;

/** The controls that are a kind of space: a tab, a line break of any kind. Each becomes a space. */
const SPACE_CONTROLS = /[\t\n\v\f\r\u0085]/g;

/** Every other C0 and C1 control, NUL included. */
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

/** A whole surrogate pair (kept) or half of one (dropped): no look-behind, which not every engine of a phone has. */
const SURROGATES = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/** `text` without the bidi controls and zero-width characters, and nothing else changed: for a link pasted from a chat. */
export function withoutMarks(text: string): string {
  return text.replace(MARKS, '');
}

/**
 * `text` as a board keeps it, on one line: tabs and line breaks become a space; NUL, every other control, half of a
 * surrogate pair, the bidi controls and the zero-width characters go; runs of spaces become one, and the ends are
 * trimmed. Text made of nothing but such characters is `''`. Ordinary text comes out as it went in.
 */
export function cleanText(text: string): string {
  return text
    .replace(SPACE_CONTROLS, ' ')
    .replace(CONTROLS, '')
    .replace(SURROGATES, (s) => (s.length === 2 ? s : ''))
    .replace(MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `text` as a board keeps the details of a calendar's event, which are a list (one subject or part to a line): each line
 * cleaned as `cleanText` cleans a title, the lines left empty dropped, and the rest joined with a line break. Text made
 * of nothing but such characters is `''`.
 */
export function cleanLines(text: string): string {
  return text
    .split(/\r\n|[\r\n]/)
    .map(cleanText)
    .filter((line) => line !== '')
    .join('\n');
}
