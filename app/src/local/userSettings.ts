/**
 * The student's settings and the school's class list, kept on the phone.
 *
 * Loading this module moves the keys of earlier versions first
 * (`keyMigrations.ts`): everything that reads the settings comes through
 * here, the headless widget and background tasks included, so none of it can
 * read before the move.
 */
import type { ClassOption, UserSettings } from '@sederyom/shared';
import { mergeSettings } from '@sederyom/shared/logic/options';
import { todayStr } from '@sederyom/shared/logic/time';
import { TIMEZONE } from '../config';
import { storage } from '../widget/feedCache';
import { runKeyMigrations, SETTINGS_KEYS } from './keyMigrations';

runKeyMigrations(storage);

function load<T>(key: string): T | null {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** The student's own settings, over the defaults. */
export function userSettings(): UserSettings {
  return mergeSettings(load<UserSettings>(SETTINGS_KEYS.user), todayStr(TIMEZONE));
}

export function saveUserSettings(settings: UserSettings): void {
  storage.set(SETTINGS_KEYS.user, JSON.stringify(settings));
}

/** The class list of the student's school, as last read from its Shahaf site. */
export function schoolClasses(): ClassOption[] {
  return load<ClassOption[]>(SETTINGS_KEYS.classes) ?? [];
}

export function saveSchoolClasses(classes: readonly ClassOption[]): void {
  storage.set(SETTINGS_KEYS.classes, JSON.stringify(classes));
}
