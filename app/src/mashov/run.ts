/**
 * `syncMashov` wired to the app: MMKV, the phone's jar, Jerusalem time. One
 * read at a time: a second call while one runs gets the same promise.
 *
 * When Mashov refuses the session (its 8 hours are up) and the phone holds a
 * "personal device" pass (`device.ts`), it logs in again with the pass and
 * reads once more, with nobody typing anything. Nothing says the session
 * ended until that was tried (`SyncDeps.renew`).
 *
 * A read that brings new grades, homework or messages notifies the student
 * (`notify/mashovNotes.ts`), the background reads included; so does a read
 * that still needs a login after the pass was tried, once per outage ("משוב
 * התנתק").
 *
 * On a parent's phone (parents mode, stage 3) the read is the child on
 * screen's, by its link to Mashov and in its own school, or before a scan by
 * the class (`parents.ts`, `parentSchools.ts`); when there is no such child,
 * or its school refuses, nothing is read. A parent gets no notes of new
 * grades, homework or messages: their switches are a student's. The
 * `loginDevice` answer brings the list again, and a session that ends is
 * noted, for the check. When the list names a child the last scan of the
 * parent's schools did not see, the schools are scanned again, under the same
 * lock, and the child is added (`parentScanRun.ts`).
 */
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';
import { TIMEZONE } from '../config';
import { storedFeed } from '../device/v2';
import { userSettings } from '../local/userSettings';
import { showLocalNotes, withdrawLocalNote } from '../notify/local';
import { addedItems, deliverAt, noteRelogin, planMashovNotes } from '../notify/mashovNotes';
import { storage } from '../widget/feedCache';
import { hasDevicePass, loginWithDevicePass, type DeviceLoginAnswer } from './device';
import { withMashovSession } from './lock';
import { noteAnswer, noteSessionEnd, takeLoginBody } from './parents';
import { scanAndApply } from './parentScanRun';
import { parentReadApi, scanNeeded } from './parentSchools';
import { phoneLoginAt, phoneMashovApi, readMashovJar } from './phone';
import { localRead, localStatus, syncMashov, type LocalMashovStatus, type SyncOutcome } from './sync';

let running: Promise<SyncOutcome> | null = null;

/** The read running now, or `null`: what "מחק את הנתונים שלי" waits for before it wipes. */
export function runningMashovRead(): Promise<SyncOutcome> | null {
  return running;
}

/**
 * Tells the student what this read brought that the last one did not, each
 * subject under their name for it, against the lines of the class feed they
 * have, as the days are.
 */
async function notifyNew(before: Parameters<typeof addedItems>[0], outcome: SyncOutcome): Promise<void> {
  if (outcome.kind !== 'ok') return;
  const added = addedItems(before, outcome.read.entities);
  if (added.length === 0) return;
  const settings = userSettings();
  const notes = planMashovNotes(added, settings, storedFeed(storage));
  if (notes.length > 0) await showLocalNotes(notes, deliverAt(settings, new Date(), TIMEZONE)).catch(() => undefined);
}

/**
 * "משוב התנתק", once per outage of a session that once worked, when the read
 * still needs a login after the pass was tried; taken back by a read that
 * works (`noteRelogin`).
 */
function notifyRelogin(outcome: SyncOutcome): Promise<void> {
  return noteRelogin(outcome.kind, {
    kv: storage,
    status: () => localStatus(storage),
    show: (note, at) => showLocalNotes([note], at),
    withdraw: withdrawLocalNote,
    settings: userSettings,
    now: new Date(),
    zone: TIMEZONE,
  }).catch(() => undefined);
}

/**
 * The API a parent's read goes through (`parentReadApi`): the child on
 * screen's, in its own school, or the login's own user's when Mashov gave no
 * list. Asked again for the read after a `loginDevice`, which brings the list
 * again and may have put the session back in another school.
 */
function parentApi(): Promise<MashovApi> {
  return parentReadApi({ kv: storage, settings: userSettings(), fetchImpl: fetch, jar: readMashovJar });
}

/** A parent's `loginDevice` answer: how it went, and its list of children. */
function keepDeviceAnswer(answer: DeviceLoginAnswer): void {
  noteAnswer(storage, { at: new Date().toISOString(), kind: 'loginDevice', status: answer.status, reason: answer.reason, gotPass: answer.gotPass });
  takeLoginBody(storage, answer.body, 'loginDevice');
}

export function syncMashovNow(opts: { force?: boolean; bagrut?: boolean } = {}): Promise<SyncOutcome> {
  running ??= withMashovSession(async () => {
    const parent = userSettings().audience === 'parent';
    const renew = async (refused: LocalMashovStatus): Promise<boolean> => {
      if (parent) noteSessionEnd(storage, refused);
      if (!hasDevicePass(storage) || !(await loginWithDevicePass(storage, fetch, new Date(), parent ? keepDeviceAnswer : undefined))) return false;
      // The answer's list may name a child the last scan did not see: scan and add it before the read.
      if (parent && scanNeeded(storage)) await scanAndApply().catch(() => undefined);
      return true;
    };
    const deps = { kv: storage, api: () => (parent ? parentApi() : phoneMashovApi()), zone: TIMEZONE, loginAt: phoneLoginAt, renew };
    const before = localRead(storage)?.entities ?? null;
    const outcome = await syncMashov(deps, opts);
    if (!parent) await notifyNew(before, outcome);
    await notifyRelogin(outcome);
    return outcome;
  }).finally(() => {
    running = null;
  });
  return running;
}
