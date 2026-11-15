/**
 * A parent's children on this phone (`children.ts`), as the screens, the
 * invite link and a tapped push use them. Each change is saved at once; the
 * caller refreshes after (`useShowChild` and the rest), so the server follows
 * the classes as they are now and the summaries speak of every child.
 *
 * Nothing here in the demo: its made-up student has one class.
 */
import type { ClassOption } from '@sederyom/shared';
import { shahafSiteOf } from '@sederyom/shared/logic/shahaf-site';
import { ApiError } from '../api/client';
import { isDemo } from '../demo/phone';
import { listClasses, otherClassesUnsupported, storedFeed } from '../device/v2';
import type { JoinTarget } from '../lib/invite';
import { parentSchools } from '../mashov/parentSchools';
import { readMashovSoon } from '../mashov/sync';
import { childName, displayClassName, INVITE_COPY, SCHOOL_SITE_COPY } from '../lib/onboarding';
import { storage } from '../widget/feedCache';
import {
  addChild, childOfClass, childrenNow, keepLinkLessons, readChildren, readOnlyChildName, removeChild, renameChild, setOnlyChildName, shownMashovLink,
  switchChild, type AddChildResult,
} from './children';
import { unboundLines } from './childrenFromMashov';
import { isWithoutSite, pastedSite } from './schoolSite';
import { betweenRefreshes, parentsChildren, saveChildSettings } from './source';
import { schoolClasses, userSettings } from './userSettings';

export interface ChildRow {
  id: string;
  /** The parent's name for the child, else the class's. */
  name: string;
  /** The parent's name alone; `''` when none was given. */
  label: string;
  className: string;
  /** The child's school has no timetable site (`Child.withoutSite`). */
  withoutSite: boolean;
  /** On screen now. */
  shown: boolean;
}

export interface ChildrenView {
  list: ChildRow[];
  /** The server cannot follow more than one class yet: only the one on screen gets pushes. */
  unsupported: boolean;
}

/** The site of the class on screen: its feed's, else the pasted one. */
const siteNow = (): string | null => storedFeed(storage)?.class.siteUrl ?? pastedSite(storage);

const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The children, for the switcher and Settings; `null` with fewer than two, and in the demo. */
export function childrenView(): ChildrenView | null {
  if (isDemo()) return null;
  const children = parentsChildren();
  if (!children) return null;
  const list = childrenNow(children, userSettings(), siteNow()).map((c) => ({
    id: c.id, name: childName(c), label: c.label, className: displayClassName(c.className), withoutSite: c.withoutSite === true, shown: c.id === children.activeId,
  }));
  return { list, unsupported: otherClassesUnsupported(storage) };
}

/**
 * How many of the phone's children have a Mashov link: with a list, the linked
 * ones; without one, the lone child when it is linked. Zero in the demo.
 */
export function mashovChildrenCount(): number {
  if (isDemo()) return 0;
  const children = readChildren(storage);
  if (children) return children.list.filter((c) => c.mashov).length;
  return shownMashovLink(storage) ? 1 : 0;
}

/** A child on the setup's class step: what the parent calls it, and its class. */
export interface SetupChild {
  /** `''` for the lone child when the saved scan cannot name it. */
  name: string;
  className: string;
  withoutSite: boolean;
}

/**
 * The children the class step shows a parent whose Mashov brought some: the
 * list, or, when the scan wrote only one child into the settings, that child.
 * The list names each child as Mashov's first name (`addChild`'s `label`); the
 * lone child has no label, so its name is read from the saved scan by the guid
 * of its link, and is `''` when the scan does not hold it.
 */
function setupChildren(): SetupChild[] {
  const list = childrenView()?.list;
  if (list) return list.map((c) => ({ name: c.label, className: c.className, withoutSite: c.withoutSite }));
  const settings = userSettings();
  if (isDemo() || (!settings.className && !isWithoutSite(storage))) return [];
  const guid = shownMashovLink(storage)?.guid;
  const name = guid
    ? parentSchools(storage)?.schools.flatMap((s) => s.children).find((c) => c.guid === guid)?.firstName ?? ''
    : '';
  return [{ name, className: displayClassName(settings.className), withoutSite: isWithoutSite(storage) }];
}

/** What the class step of a parent's setup shows from the saved scan (`parentSchools`). */
export interface SetupView {
  children: SetupChild[];
  /** A scan was saved: Mashov was asked, whatever it listed. */
  scanned: boolean;
  /** One line for each child Mashov lists and the login cannot read (`unboundLines`). */
  unbound: string[];
}

/** The setup's class step for a parent: the children on the phone, and what the scan said about the ones it could not add. */
export function setupView(): SetupView {
  const scan = parentSchools(storage);
  return { children: setupChildren(), scanned: scan !== null, unbound: scan ? unboundLines(scan) : [] };
}

/**
 * Puts another child on screen; true when it changed anything. The refresh
 * after it reads that child's Mashov, however recent the last read was.
 */
export function showChild(id: string): Promise<boolean> {
  if (isDemo()) return Promise.resolve(false);
  return betweenRefreshes(() => {
    const changed = saveChildSettings(switchChild(storage, userSettings(), id, siteNow()));
    if (changed) readMashovSoon(storage);
    return changed;
  });
}

/** A push about a child not on screen (`PushPayload.class`): that child goes on screen. */
export function showChildOfClass(cls: { siteUrl: string; classId: string }): Promise<boolean> {
  const child = isDemo() ? null : childOfClass(storage, cls);
  return child ? showChild(child.id) : Promise.resolve(false);
}

/** Adds a child in a class of the school on screen, from Settings' list. */
export function addChildHere(option: ClassOption): AddChildResult | 'no_site' {
  const site = siteNow();
  if (isDemo() || !site || !userSettings().classId) return 'no_site';
  return addChild(storage, userSettings(), site, { siteUrl: site, classId: option.id, className: option.name, classes: schoolClasses() }, newId);
}

/**
 * Adds a child in an invite link's class, at the link's school (`JoinBridge`,
 * on a parent's phone that has a class). A class already on the list is put
 * on screen instead. Throws in Hebrew when the site did not answer, or no
 * longer lists the class.
 */
export async function addChildFromInvite(target: JoinTarget): Promise<{ result: AddChildResult | 'shown' | 'no_site'; className: string }> {
  const site = shahafSiteOf(target.siteUrl);
  if (!site) throw new ApiError(400, SCHOOL_SITE_COPY.notShahaf);
  let classes: ClassOption[];
  try {
    ({ classes } = await listClasses(storage, site));
  } catch {
    throw new ApiError(502, SCHOOL_SITE_COPY.noAnswer);
  }
  const option = classes.find((c) => c.id === target.classId);
  if (!option) throw new ApiError(404, INVITE_COPY.classGone(userSettings().audience === 'parent'));
  // The class on screen becomes the first child: without its site the phone could not follow it again.
  const here = siteNow();
  if (!here) return { result: 'no_site', className: option.name };
  // The link's codes for the child's lessons go with the child (`LessonsBridge` reads them on screen).
  const result = addChild(storage, userSettings(), here, { siteUrl: site, classId: option.id, className: option.name, classes, lessons: target.lessons }, newId);
  if (result === 'already' && (await showChildOfClass({ siteUrl: site, classId: option.id }))) {
    if (target.lessons?.length) keepLinkLessons(storage, target.lessons);
    return { result: 'shown', className: option.name };
  }
  return { result, className: option.name };
}

export function renameChildNow(id: string, label: string): void {
  if (!isDemo()) renameChild(storage, id, label);
}

/** What the parent calls the only child (no list yet); `''` in the demo, which has no parent. */
export function onlyChildNameNow(): string {
  return isDemo() ? '' : readOnlyChildName(storage);
}

/** Names the only child; the list's first record takes the name once a second child comes (`addChild`). */
export function setOnlyChildNameNow(name: string): void {
  if (!isDemo()) setOnlyChildName(storage, name);
}

/** Takes a child off the list; the one on screen goes after another is put there. */
export function removeChildNow(id: string): Promise<boolean> {
  if (isDemo()) return Promise.resolve(false);
  return betweenRefreshes(() => {
    if (saveChildSettings(removeChild(storage, userSettings(), id, siteNow()))) readMashovSoon(storage);
    return true;
  });
}
