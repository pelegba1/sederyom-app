/**
 * What to bring to each subject (ideas פ2): "מחשבון", "בגדי ספורט", "הספר
 * בספרות", written once on a lesson's sheet and kept on the phone. The
 * evening reminder lists what goes in the bag for the next school day's
 * lessons as they are after the changes (`packItems` in the shared
 * summaries): a cancelled PE lesson takes its sports clothes out.
 *
 * Kept by `packKey`, the subject as the app names it, so "אנגלית 5 יח״ל
 * (יא2)" on the site and "אנגלית" in Mashov are one subject.
 *
 * Pure: the storage is passed in, so the tests drive it with a map.
 */
import { packKey } from '@sederyom/shared/logic/summaries';
import type { KeyValue } from '../mashov/sync';

export const PACK_LIST_KEY = 'pack.items';

/** Longest text a subject keeps: a line, not a list to manage. */
export const PACK_TEXT_MAX = 80;

/** Subject key → what to bring. */
export type PackList = Record<string, string>;

export function readPackList(kv: KeyValue): PackList {
  try {
    const parsed = JSON.parse(kv.getString(PACK_LIST_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  } catch {
    return {};
  }
}

/** What the student brings to `subject`; `''` when nothing was written. */
export function packTextFor(kv: KeyValue, subject: string): string {
  return readPackList(kv)[packKey(subject)] ?? '';
}

/** Keeps what to bring to `subject`; an empty text forgets it. Returns the list as kept. */
export function setPackText(kv: KeyValue, subject: string, text: string): PackList {
  const list = readPackList(kv);
  const key = packKey(subject);
  const line = text.replace(/\s+/g, ' ').trim().slice(0, PACK_TEXT_MAX);
  if (!key) return list;
  if (line) list[key] = line;
  else delete list[key];
  kv.set(PACK_LIST_KEY, JSON.stringify(list));
  return list;
}
