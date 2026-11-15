/**
 * The parents' check (`parentCheck.ts`) wired to the app: MMKV, the phone's
 * Mashov jar, the phone's children (the one on screen first, each with its
 * Mashov link and whether it has a site), and the schools the parent's Mashov
 * lists. One check at a time: a second call while one runs gets the same
 * promise.
 */
import Constants from 'expo-constants';
import { TIMEZONE } from '../config';
import { readChildren, shownMashovLink } from '../local/children';
import { isWithoutSite } from '../local/schoolSite';
import { userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { withMashovSession } from './lock';
import { runParentCheck, type ParentCheck } from './parentCheck';
import { ensureSchool, parentSchools } from './parentSchools';
import { readMashovJar } from './phone';

let running: Promise<ParentCheck> | null = null;

export function runParentCheckNow(): Promise<ParentCheck> {
  running ??= withMashovSession(async () => {
    const settings = userSettings();
    const children = readChildren(storage);
    const others = children
      ? children.list.filter((c) => c.id !== children.activeId).map((c) => ({ className: c.className, link: c.mashov ?? null, withoutSite: c.withoutSite === true }))
      : [];
    return runParentCheck({
      kv: storage,
      fetchImpl: fetch,
      jar: readMashovJar,
      phoneChildren: [{ className: settings.className, link: shownMashovLink(storage), withoutSite: isWithoutSite(storage) }, ...others],
      schools: () => parentSchools(storage),
      ensureSchool: (semel) => ensureSchool(storage, semel, fetch, readMashovJar),
      audience: settings.audience,
      appVersion: Constants.expoConfig?.version ?? '',
      zone: TIMEZONE,
    });
  }).finally(() => {
    running = null;
  });
  return running;
}
