/**
 * Push text that reads right in a right-to-left notification.
 *
 * Android lays a notification out by the bidi algorithm, and a dash between
 * two numbers inside a Hebrew line turns the run around: "08:00–10:30"
 * shows as "10:30–08:00", "שאלות 1–5" as "5–1". The isolate pair (U+2066
 * LEFT-TO-RIGHT ISOLATE … U+2069 POP DIRECTIONAL ISOLATE) keeps the run in
 * order, in the drawer and in the bell alike. The app's `isolateRanges`
 * (app/src/lib/format.ts) does the same for its own text, with the same
 * pattern, and leaves text that already carries an isolate alone.
 */
import type { OutgoingPush } from './push.js';

const LRI = '⁦';
const PDI = '⁩';

/** A numeric or clock range: "1–5", "08:00–10:30", "18–23.10", "3-4". */
const RANGE = /\d+(?:[:./]\d+)*(?:\s?[–—-]\s?\d+(?:[:./]\d+)*)+/g;

/** A run already inside an isolate (LRI, RLI or FSI … PDI), captured so `split` keeps it. */
const ISOLATED = /([⁦-⁨][^⁩]*⁩)/;

/**
 * Every numeric range in `text` wrapped in LRI … PDI. Runs that are already
 * isolated are left as they are, so wrapping twice changes nothing.
 */
export function isolateRanges(text: string): string {
  return text
    .split(ISOLATED)
    // `split` with a capturing group puts the isolated runs at the odd indices.
    .map((part, i) => (i % 2 === 1 ? part : part.replace(RANGE, (run) => `${LRI}${run}${PDI}`)))
    .join('');
}

/** A push with its title and body made safe for a right-to-left notification. */
export function isolatePush(push: OutgoingPush): OutgoingPush {
  return { ...push, title: isolateRanges(push.title), body: isolateRanges(push.body) };
}
