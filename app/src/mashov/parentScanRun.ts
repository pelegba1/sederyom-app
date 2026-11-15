/**
 * The scan of a parent's schools (`parentSchools.ts`) wired to the app, and its
 * plan put on the phone (`childrenFromMashov.ts`): after a login, every child
 * Mashov lists is linked or added (docs/superpowers/specs/2026-11-02-parents-other-schools-design.md §4.2, §4.3א).
 *
 * The scan moves the session from school to school, so it runs under the
 * session lock (`withMashovSession`): `runParentScanNow` takes it, and
 * `syncMashovNow`, which holds it already, calls `scanAndApply`.
 *
 * The plan is put on the phone at once, not after a refresh (`betweenRefreshes`):
 * a refresh waits for the Mashov read, which may be the one running this scan,
 * so waiting for the refresh here would wait forever. Nothing here switches the
 * child on screen, which is what a refresh in the middle must not see.
 */
import type { ClassOption, UserSettings } from '@sederyom/shared';
import { listClasses, storedFeed } from '../device/v2';
import { childrenNow, dismissedGuids, readChildren, shownMashovLink } from '../local/children';
import { applyChildrenPlan, planChildren, type ChildrenPlan, type PhoneChild } from '../local/childrenFromMashov';
import { isWithoutSite, pastedSite } from '../local/schoolSite';
import { saveUserSettings, userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { withMashovSession } from './lock';
import { scanParentSchools, type ParentSchools } from './parentSchools';
import { mashovCoolSite, readMashovJar } from './phone';

export interface ParentScanResult {
  schools: ParentSchools;
  plan: ChildrenPlan;
  /** The children added to the phone. */
  added: number;
}

/** The site of the class on screen: its feed's, else the pasted one. */
const siteNow = (): string | null => storedFeed(storage)?.class.siteUrl ?? pastedSite(storage);

const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The phone's children as the plan reads them: the list, or without one the
 * class on screen, when it has a class or is "without a site". A phone with
 * no class has none.
 */
function phoneChildren(settings: UserSettings): PhoneChild[] {
  const children = readChildren(storage);
  if (children) {
    return childrenNow(children, settings, siteNow(), isWithoutSite(storage)).map((c) => ({
      id: c.id, siteUrl: c.siteUrl, className: c.className, ...(c.mashov ? { mashov: c.mashov } : {}),
    }));
  }
  if (!settings.className && !isWithoutSite(storage)) return [];
  const link = shownMashovLink(storage);
  return [{ id: 'shown', siteUrl: siteNow() ?? '', className: settings.className, ...(link ? { mashov: link } : {}) }];
}

/** Each school site's class list; `null` for a site that did not answer. */
async function classesOfSites(schools: ParentSchools): Promise<Record<string, ClassOption[] | null>> {
  const sites = [...new Set(schools.schools.flatMap((s) => (s.site ? [s.site] : [])))];
  const lists = await Promise.all(sites.map((site) => listClasses(storage, site).then((r) => r.classes, () => null)));
  return Object.fromEntries(sites.map((site, i) => [site, lists[i]!]));
}

/**
 * Scans the parent's schools and puts the plan on the phone. Does not take the
 * session lock: the caller holds it. `null` without a login or a list of children.
 *
 * Not after a refresh (`betweenRefreshes`): a refresh waits for the Mashov read,
 * and the read may be the one running this, so it would wait for itself. The
 * plan is read and put on the phone in one go after the last await, and it never
 * switches the child on screen, which is what a refresh running must not see.
 */
export async function scanAndApply(): Promise<ParentScanResult | null> {
  const schools = await scanParentSchools({ kv: storage, fetchImpl: fetch, jar: readMashovJar, coolSite: () => mashovCoolSite() });
  if (!schools) return null;
  const classesBySite = await classesOfSites(schools);
  const settings = userSettings();
  const phone = phoneChildren(settings);
  const plan = planChildren({ scan: schools, phone, dismissed: dismissedGuids(storage), classesBySite });
  const saved = applyChildrenPlan(storage, settings, siteNow(), plan, newId, classesBySite, schools);
  if (saved) saveUserSettings(saved);
  return { schools, plan, added: phoneChildren(userSettings()).length - phone.length };
}

/** `scanAndApply` under the session lock, for code that does not hold it. */
export function runParentScanNow(): Promise<ParentScanResult | null> {
  return withMashovSession(scanAndApply);
}
