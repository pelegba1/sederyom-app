/**
 * `syncGoogle` wired to the app: MMKV and the phone's sign-in. Nothing is read
 * until the person has signed in to Google on the phone; one read at a time.
 * A read that went well also moves the tasks the phone kept for itself into Google.
 */
import { TIMEZONE } from '../config';
import { storage } from '../widget/feedCache';
import { syncGoogleAndMoveTasks } from './moveTasks';
import { googleSignInState, phoneGoogleRequester } from './phone';
import type { GoogleSyncOutcome } from './sync';

let running: Promise<GoogleSyncOutcome | null> | null = null;

/** The read running now, or `null`: what "מחק את הנתונים שלי" waits for before it wipes. */
export function runningGoogleRead(): Promise<GoogleSyncOutcome | null> | null {
  return running;
}

/** `null` when the phone never signed in to Google. */
export function syncGoogleNow(opts: { force?: boolean } = {}): Promise<GoogleSyncOutcome | null> {
  running ??= (async () => {
    const signIn = await googleSignInState();
    return syncGoogleAndMoveTasks({ kv: storage, requester: phoneGoogleRequester(), zone: TIMEZONE }, signIn, opts);
  })().finally(() => {
    running = null;
  });
  return running;
}
