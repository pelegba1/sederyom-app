/**
 * What the Mashov renewal keeps on the phone (W6-1), in the app's MMKV store:
 * - which outage already had its automatic try (`renewKey`), so the sheet
 *   opens once per outage and not on every return to the app, and that
 *   survives Android closing the app in between;
 * - the last attempt's result, for "פרטים טכניים", so the person can read it
 *   and report it.
 */
import { storage } from '../widget/feedCache';
import { parseRenewRecord, type RenewRecord } from './mashovRenew';

const ATTEMPTED_KEY = 'mashovRenew.attemptedFor';
const LAST_KEY = 'mashovRenew.last';

/** The outage key of the last automatic try, or `null` if there never was one. */
export function readAttemptedKey(): string | null {
  return storage.getString(ATTEMPTED_KEY) ?? null;
}

export function writeAttemptedKey(key: string): void {
  storage.set(ATTEMPTED_KEY, key);
}

/** The last attempt, or `null` before the first one (or if it cannot be read). */
export function readRenewRecord(): RenewRecord | null {
  return parseRenewRecord(storage.getString(LAST_KEY));
}

export function writeRenewRecord(record: RenewRecord): void {
  storage.set(LAST_KEY, JSON.stringify(record));
}
