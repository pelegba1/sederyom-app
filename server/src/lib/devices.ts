/**
 * Devices (plan Phase 2): every installed app has its own token, and the
 * server keeps only the token's hash, so a database dump hands out no way in.
 */
import { createHash, randomBytes } from 'node:crypto';
import { subjectNamesOf } from '@sederyom/shared/logic/ownNames';

export function mintDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A Shahaf site's address, normalized to `https://<school>.shahaf.site`, or
 * `null` for anything else: a Shahaf subdomain or nothing, since the server
 * fetches it. One rule with the phone's, which checks what a student pastes
 * by it (`@sederyom/shared/logic/shahaf-site`).
 */
export { normalizeShahafUrl } from '@sederyom/shared/logic/shahaf-site';

/**
 * A public Google calendar's id, or `null`, from the id itself or any of the
 * addresses a student finds it in. One rule with the phone's, which reads a
 * calendar by it (`@sederyom/shared/logic/exam-board/calendar`); the server
 * fetches only Google's fixed ICS address for it (`examCalendarIcsUrl`), so
 * the id is all that is taken from the device.
 */
export { normalizeCalendarId } from '@sederyom/shared/logic/exam-board/calendar';

/** `ClassFollow.prefs` (a parent's other child's class): the lines there that are not that child's. */
export function hiddenSubjectsOf(prefs: unknown): string[] {
  const hidden = (prefs as { hiddenSubjects?: unknown } | null)?.hiddenSubjects;
  return Array.isArray(hidden) ? hidden.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * The student's own names for subjects in a `Device.prefs` or a `ClassFollow.prefs`:
 * key → name, as the tolerant reader keeps them. `{}` when there are none, or
 * when what is stored is not a map of names.
 */
export function namesOf(prefs: unknown): Record<string, string> {
  return subjectNamesOf((prefs as { subjectNames?: unknown } | null)?.subjectNames);
}
