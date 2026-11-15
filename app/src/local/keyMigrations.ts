/**
 * The phone's storage keys of earlier versions, moved under their names now
 * (plan 2f, Stage C). Run once at every start, before anything reads the
 * settings (`local/userSettings.ts` runs it as it loads), so the headless
 * widget and background tasks get it too. Each step is a no-op once done.
 *
 * - The student's settings and the school's class list move from the keys of
 *   earlier versions (`OLD_SETTINGS_KEYS`) to `settings.*`: copied when the
 *   new key is absent, then the old key goes. A new key already there wins:
 *   it is the one written since.
 * - What only the owner's mode and the trial screens read goes: the switch
 *   for the phone's own days, the owner's copy of the server's settings, the
 *   Mashov trial's runs, the push note of a key forgotten on the trial
 *   screen, and the owner's key (`owner.token`) with the record kept beside
 *   it (`retire.owner`).
 * - The exam calendar's state (`google.mirror`) loses `handedOver`: every
 *   phone keeps its own calendar.
 * - Google's task cursors (`gtasks:updatedMin:*` in `google.cursors`) are
 *   cleared, once (`TASK_TIMES_MIGRATED_KEY`): the next read then lists every
 *   task, and so fills `completedAt` for the ones completed before the phone
 *   kept it (year wrapped, design §7). The calendar's cursors stay.
 *
 * Pure: the storage is passed in, so the tests drive it with a map.
 */

/** Where the student's settings and the school's class list are kept. */
export const SETTINGS_KEYS = {
  user: 'settings.user',
  classes: 'settings.classes',
} as const;

/** The keys earlier versions kept them under. */
export const OLD_SETTINGS_KEYS = {
  user: 'friend.settings',
  classes: 'friend.classes',
} as const;

/** Keys nothing reads any more. */
export const GONE_KEYS = [
  'localDays', 'local.settings', 'spike.mashov.runs', 'owner.pushesStay', 'owner.token', 'retire.owner',
] as const;

/** Set once Google's task cursors were cleared for `completedAt`. */
export const TASK_TIMES_MIGRATED_KEY = 'migrated.taskTimes';
/** `google/sync.ts`'s `GOOGLE_KEYS.cursors`, named here for the same reason as `MIRROR_KEY`. */
const GOOGLE_CURSORS_KEY = 'google.cursors';
const TASK_CURSOR_PREFIX = 'gtasks:updatedMin:';

/** The task cursors out of the stored cursors, once; cursors it cannot read stay as they are. */
function clearTaskCursorsOnce(kv: MigrationKV): void {
  if (kv.getString(TASK_TIMES_MIGRATED_KEY) !== undefined) return;
  kv.set(TASK_TIMES_MIGRATED_KEY, '1');
  const raw = kv.getString(GOOGLE_CURSORS_KEY);
  if (!raw) return;
  try {
    const cursors = JSON.parse(raw) as unknown;
    if (!cursors || typeof cursors !== 'object' || Array.isArray(cursors)) return;
    const rest = Object.fromEntries(Object.entries(cursors).filter(([key]) => !key.startsWith(TASK_CURSOR_PREFIX)));
    kv.set(GOOGLE_CURSORS_KEY, JSON.stringify(rest));
  } catch {
    // Not JSON: `syncGoogle` reads it as no cursors, which is a full read anyway.
  }
}

/** `google/mirror.ts`'s `MIRROR_KEY`, named here so the migrations load nothing else. */
const MIRROR_KEY = 'google.mirror';

export interface MigrationKV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** `handedOver` out of the stored mirror state; anything it cannot read stays as it is. */
function dropHandedOver(kv: MigrationKV): void {
  const raw = kv.getString(MIRROR_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw) as unknown;
    if (!state || typeof state !== 'object' || Array.isArray(state) || !('handedOver' in state)) return;
    const rest: Record<string, unknown> = { ...state };
    delete rest.handedOver;
    kv.set(MIRROR_KEY, JSON.stringify(rest));
  } catch {
    // Not JSON: `mirrorState` reads it as empty, as before.
  }
}

export function runKeyMigrations(kv: MigrationKV): void {
  for (const name of ['user', 'classes'] as const) {
    const old = kv.getString(OLD_SETTINGS_KEYS[name]);
    if (old === undefined) continue;
    if (kv.getString(SETTINGS_KEYS[name]) === undefined) kv.set(SETTINGS_KEYS[name], old);
    kv.remove(OLD_SETTINGS_KEYS[name]);
  }
  for (const key of GONE_KEYS) kv.remove(key);
  dropHandedOver(kv);
  clearTaskCursorsOnce(kv);
}
