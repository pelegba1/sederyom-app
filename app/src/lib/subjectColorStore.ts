/**
 * Each subject's colour slot, kept on the phone in the app's MMKV store, like
 * the Mashov renewal's marks (lib/mashovRenewStore.ts), so a subject keeps its colour
 * when another one is hidden, comes back or is added (run 8, Noa). The app
 * hands the slots out and saves them (`useSubjectColor`); the widget reads
 * them, so it draws the same colours.
 *
 *   const slots = keepSubjectSlots(subjectOrder(lines, hidden), classId);
 *   subjectColorOf(order, scheme, slots)(lesson.originalSubject ?? lesson.subject);
 */
import { storage } from '../widget/feedCache';
import { assignSubjectSlots, parseSubjectSlots, slotsForClass, type SubjectSlots } from './subjectColors';

const SLOTS_KEY = 'subjectColors.slots';

/** The stored slots for `classId` (every stored slot while the class is not known). */
export function readSubjectSlots(classId: string | null = null): SubjectSlots {
  return slotsForClass(parseSubjectSlots(storage.getString(SLOTS_KEY)), classId);
}

/**
 * The slots for the student's subjects, `order` (`subjectOrder`): the stored
 * ones, and a slot for each subject that has none yet, which is saved. With
 * no order yet (settings still loading) nothing is handed out or saved.
 */
export function keepSubjectSlots(order: readonly string[], classId: string | null): SubjectSlots {
  const stored = readSubjectSlots(classId);
  if (order.length === 0) return stored;
  const next = assignSubjectSlots(order, stored);
  const known = parseSubjectSlots(storage.getString(SLOTS_KEY));
  // Saved when a subject was given a slot, or the class changed and its subjects started afresh.
  if (next !== stored || (classId !== null && known.classId !== classId)) {
    storage.set(SLOTS_KEY, JSON.stringify({ classId, slots: next }));
  }
  return next;
}
