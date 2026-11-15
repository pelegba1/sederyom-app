/**
 * What a saved settings patch changes besides the settings themselves, for
 * `useSaveSettings` (`hooks.ts`): which of the screens' lists to read again,
 * and what is left due on the phone. Pure, apart from the store it is given,
 * so the tests can run what the hook does.
 */
import type { SettingsPatch } from '@sederyom/shared';
import { markMirrorDue } from '../google/mirror';
import type { KeyValue } from '../google/sync';

export interface SettingsChange {
  /** The hidden events, whose titles the full settings answer resolves. */
  resolveHiddenEvents?: boolean;
  exams?: boolean;
  lessons?: boolean;
  attendance?: boolean;
  /** The student's names for subjects: every list that names a subject takes them. */
  subjectNames?: boolean;
}

export function settingsChangeOf(patch: SettingsPatch): SettingsChange {
  return {
    resolveHiddenEvents: patch.calendars?.hiddenEventIds !== undefined,
    exams: patch.exams !== undefined || patch.examsToCalendar !== undefined,
    lessons: patch.lessons !== undefined,
    attendance: patch.attendance !== undefined,
    subjectNames: patch.lessons?.subjectNames !== undefined,
  };
}

/**
 * What a saved change leaves due on the phone itself: new names for subjects
 * retitle the exams in the "בית ספר" calendar, so the next refresh mirrors
 * again (`markMirrorDue`), as an exam's own new name does.
 */
export function markSettingsDue(kv: KeyValue, changed: SettingsChange): void {
  if (changed.subjectNames) markMirrorDue(kv);
}
