/**
 * "להתחבר ל-Google": the native sign-in on the phone, then a first read, so
 * the screens have the calendars and tasks at once.
 */
import { signInToGoogle } from './phone';
import { syncGoogleNow } from './run';

/**
 * `false` when the person backed out of Google's screen. `signedIn` runs
 * between the two: the first read takes seconds, and until the screens hear of
 * the sign-in they still say "לא מחובר" with its button. `onMoved` runs after
 * the read, with how many of the phone's own tasks went into Google, and only
 * when it was at least one; a later read that moves some says nothing.
 */
export async function connectGoogle(
  signedIn: () => void = () => {},
  onMoved: (count: number) => void = () => {},
): Promise<boolean> {
  const res = await signInToGoogle();
  if (res.kind !== 'ok') return false;
  signedIn();
  const outcome = await syncGoogleNow({ force: true });
  if (outcome?.kind === 'ok' && outcome.moved) onMoved(outcome.moved);
  return true;
}
