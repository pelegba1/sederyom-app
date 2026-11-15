/**
 * The class's past days, kept on the phone for the year in review.
 *
 * Read whole, at most once a day, and only when the year in review asks: the
 * server still adds rows to days already read (the weeks it fills in from the
 * site, an exam the grade's calendar lists late), so asking only for the days
 * after the last one kept would miss them. A school year of a class is a few
 * hundred kilobytes.
 *
 * It goes with everything else on "מחיקת הנתונים שלי", which empties the store.
 */
import type { ClassHistory, DateStr } from '@sederyom/shared';
import { readHistory, storedFeed } from '../device/v2';
import type { KeyValue } from '../mashov/sync';

export const WRAPPED_HISTORY_KEY = 'wrapped.history';

export interface KeptHistory {
  /** The day (in Israel) it was read. */
  readOn: DateStr;
  history: ClassHistory;
}

/** What the phone keeps, when it is the history of the class it follows now. */
export function storedHistory(kv: KeyValue): KeptHistory | null {
  let kept: KeptHistory | null = null;
  try {
    const raw = kv.getString(WRAPPED_HISTORY_KEY);
    kept = raw ? (JSON.parse(raw) as KeptHistory) : null;
  } catch {
    return null;
  }
  if (!kept?.history?.class || !kept.readOn) return null;
  // The feed names the class the phone follows; a history read for another one is not this student's year.
  const now = storedFeed(kv)?.class;
  if (now && (now.siteUrl !== kept.history.class.siteUrl || now.classId !== kept.history.class.classId)) return null;
  return kept;
}

/**
 * The history as of `today`: what was kept when it was read today, a new read
 * otherwise. `null` without a device or a class (and nothing stays kept);
 * `'unsupported'` from a server without the route. A failed read throws, and
 * what was kept stays for the caller to show.
 */
export async function refreshHistory(kv: KeyValue, today: DateStr, fetchImpl: typeof fetch = fetch): Promise<KeptHistory | null | 'unsupported'> {
  const kept = storedHistory(kv);
  if (kept && kept.readOn === today) return kept;
  const history = await readHistory(kv, fetchImpl);
  if (history === 'unsupported') return 'unsupported';
  if (history === null) {
    kv.set(WRAPPED_HISTORY_KEY, '');
    return null;
  }
  const fresh: KeptHistory = { readOn: today, history };
  kv.set(WRAPPED_HISTORY_KEY, JSON.stringify(fresh));
  return fresh;
}
