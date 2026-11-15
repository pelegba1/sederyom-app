/**
 * A parent's children (parents mode, stage 2; docs/parents-plan.md): up to
 * six classes on one phone, each child's name kept on the phone only.
 *
 * The child on screen is the phone's class, as a student's is: its class in
 * the settings (`classId`, `className`, "השיעורים שלי", and the parent's own
 * names for its subjects, `Child.subjectNames`), and its feed, added
 * exams, exam choices, exam board of its own (`ownBoard.ts`), pack list,
 * sightings and class list under the phone's own keys (`CHILD_KEYS`), and
 * with Mashov (stage 3) its read, bagrut, the grades' first sightings, its
 * homework ticks, and whether its lessons were filled, from its invite or from Mashov; the Mashov login and its
 * status are the parent's, one for every child. So everything else the app
 * does, the screens, the widget, the next lesson and the device's own class
 * on the server, works on that child unchanged. The other children's are kept aside under their own
 * keys (`stashKey`), and switching swaps them (`switchChild`). The server
 * follows the other children's classes too (`otherFollows`), and the refresh
 * keeps their feeds aside, for the morning summary and the evening reminder,
 * which speak of every child.
 *
 * With one child there is no list: the phone is a parent's as in stage 1. The
 * list begins with the second child, and its first is the class the phone had.
 *
 * Pure: the storage is passed in, so the tests drive it with a map.
 */
import type { ClassFeed, ClassOption, UpdateDeviceClassesBody, UserSettings } from '@sederyom/shared';
import { MAX_FOLLOWED_CLASSES } from '@sederyom/shared';
import { intersectNames, type SubjectNames } from '@sederyom/shared/logic/ownNames';
import { DEVICE_KEYS } from '../device/v2';
import { FIRST_SEEN_KEY } from '../mashov/gradeFirstSeen';
import { KEYS as MASHOV_KEYS, localBagrut, localRead, type LocalBagrut, type LocalMashovRead } from '../mashov/sync';
import { CHANGE_SIGHTINGS_KEY, type ChangeSightings } from './changes';
import { EXAM_PREFS_KEY, readExamPrefs, type ExamPrefs } from './examPrefs';
import { HOMEWORK_STATE_KEY } from './homeworkState';
import { SETTINGS_KEYS } from './keyMigrations';
import { MANUAL_EXAMS_KEY, readManualExams, type ManualExam } from './manualExams';
import { OWN_BOARD_KEY, readOwnBoard, withOwnBoard, type OwnBoard } from './ownBoard';
import { PACK_LIST_KEY, readPackList, type PackList } from './packList';
import { SCHOOL_SITE_KEYS, isWithoutSite, savePastedSite, setWithoutSite, type SiteKV } from './schoolSite';

export const CHILDREN_KEY = 'parent.children';

/**
 * The lone child's Mashov link (`MashovLink` as JSON), kept while there is no
 * list: the first child is the phone's own class, so its link has no `Child`
 * to live in. Once a list exists the link is the child's (`Child.mashov`) and
 * this key is empty.
 */
export const ONLY_CHILD_LINK_KEY = 'parent.mashovLink';

/**
 * What the parent calls the lone child (`Child.label`'s text), kept while there
 * is no list, for the same reason as the link: the first child is the phone's
 * own class, so there is no `Child` yet to hold the name. Empty: the class's
 * name stands for the child. The list's first record takes it (`addChild`),
 * and a list down to one child gives its last child's name back (`removeChild`).
 * Never leaves the phone.
 */
export const ONLY_CHILD_NAME_KEY = 'parent.onlyChildName';

/** The lone child's name; `''` when it has none. */
export function readOnlyChildName(kv: Pick<SiteKV, 'getString'>): string {
  return kv.getString(ONLY_CHILD_NAME_KEY) ?? '';
}

/**
 * Names the lone child, as `renameChild` names one of a list: trimmed, at most
 * 40; an empty name takes the key away. With a list the children carry their
 * names and the key stays empty, so a name that comes late (a field closed
 * after the second child was added) is dropped.
 */
export function setOnlyChildName(kv: SiteKV, name: string): void {
  if (readChildren(kv)) return;
  const clean = name.trim().slice(0, 40);
  if (clean) kv.set(ONLY_CHILD_NAME_KEY, clean);
  else kv.remove(ONLY_CHILD_NAME_KEY);
}

/**
 * The guids of the children the parent took off the list, as a JSON array:
 * Mashov still lists them, and they are not added again until the parent's
 * Mashov is disconnected (`forgetParentLogin`).
 */
export const DISMISSED_KEY = 'parent.dismissedMashov';

/**
 * The child's lessons were filled once on their own, from the child's invite
 * link or from the parent's Mashov (`LessonsBridge`): never again for
 * that child, even after "להציג הכול". Kept with the child. A student's
 * phone, which has no children, keeps its own once under the same key.
 */
export const LESSONS_FILLED_KEY = 'parent.lessonsFilled';

/**
 * The codes of the lines the child hid, from the child's invite link
 * (`lib/invite.ts`), until the class's lines are on the phone to read them by.
 * Kept with the child.
 */
export const LINK_LESSONS_KEY = 'parent.linkLessons';

/** The phone's keys that belong to the class on screen: swapped with the child. */
export const CHILD_KEYS = [
  DEVICE_KEYS.feed, MANUAL_EXAMS_KEY, EXAM_PREFS_KEY, OWN_BOARD_KEY, PACK_LIST_KEY, CHANGE_SIGHTINGS_KEY, SETTINGS_KEYS.classes,
  MASHOV_KEYS.read, MASHOV_KEYS.bagrut, FIRST_SEEN_KEY, HOMEWORK_STATE_KEY, LESSONS_FILLED_KEY, LINK_LESSONS_KEY,
] as const;

/** Whether the child on screen had its lessons filled already. */
export function lessonsFilled(kv: Pick<SiteKV, 'getString'>): boolean {
  return Boolean(kv.getString(LESSONS_FILLED_KEY));
}

export function markLessonsFilled(kv: Pick<SiteKV, 'set'>, now: Date = new Date()): void {
  kv.set(LESSONS_FILLED_KEY, now.toISOString());
}

/** An invite's codes for the child on screen, kept until its lines are known. */
export function keepLinkLessons(kv: Pick<SiteKV, 'set'>, codes: readonly string[]): void {
  kv.set(LINK_LESSONS_KEY, JSON.stringify([...codes]));
}

export function linkLessonCodes(kv: Pick<SiteKV, 'getString'>): string[] {
  try {
    const codes = JSON.parse(kv.getString(LINK_LESSONS_KEY) || '[]') as unknown;
    return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

export function dropLinkLessons(kv: Pick<SiteKV, 'set'>): void {
  kv.set(LINK_LESSONS_KEY, '');
}

/** Where a child is in Mashov: the id its reads go by, and its school's `semel` (as text). */
export interface MashovLink {
  guid: string;
  semel: string;
}

export interface Child {
  /** The phone's own id for the child, never sent anywhere. */
  id: string;
  /** What the parent calls the child; `''` until named, and the class's name stands for it. */
  label: string;
  /** The school's Shahaf site, `https://<school>.shahaf.site`. */
  siteUrl: string;
  /** The site's `cls` value. */
  classId: string;
  className: string;
  /** The child's "השיעורים שלי": the class's lines that are not theirs. */
  hiddenSubjects: string[];
  /** The parent's names for the child's subjects (`UserSettings.lessons.subjectNames`); none when absent. */
  subjectNames?: Record<string, string>;
  /** The child as the parent's Mashov lists it, when it was added from there. */
  mashov?: MashovLink;
  /** The child's school has no Shahaf site: `siteUrl` and `classId` are `''`, and no class is followed. */
  withoutSite?: boolean;
}

export interface Children {
  list: Child[];
  /** The child on screen. */
  activeId: string;
}

/** Where a child kept aside keeps one of `CHILD_KEYS`. */
export function stashKey(childId: string, key: string): string {
  return `child|${childId}|${key}`;
}

function isChild(value: unknown): value is Child {
  const c = value as Partial<Child> | null;
  return Boolean(c) && typeof c!.id === 'string' && typeof c!.siteUrl === 'string' && typeof c!.classId === 'string'
    && typeof c!.className === 'string' && typeof c!.label === 'string' && Array.isArray(c!.hiddenSubjects);
}

/** The list, or `null` when there is none: fewer than two children, or nothing readable. */
export function readChildren(kv: Pick<SiteKV, 'getString'>): Children | null {
  try {
    const raw = JSON.parse(kv.getString(CHILDREN_KEY) ?? '') as Partial<Children> | null;
    const list = Array.isArray(raw?.list) ? raw!.list.filter(isChild) : [];
    if (list.length < 2 || !list.some((c) => c.id === raw!.activeId)) return null;
    return { list, activeId: raw!.activeId! };
  } catch {
    return null;
  }
}

function writeChildren(kv: SiteKV, children: Children | null): void {
  if (children && children.list.length >= 2) kv.set(CHILDREN_KEY, JSON.stringify(children));
  else kv.remove(CHILDREN_KEY);
}

/**
 * The child on screen as the phone has it now: its class may have been picked
 * again in Settings. `withoutSite`: the phone's own, when it is known.
 */
function liveChild(child: Child, settings: UserSettings, siteUrl: string | null, withoutSite?: boolean): Child {
  const { withoutSite: _kept, ...rest } = child;
  return {
    ...rest,
    siteUrl: siteUrl ?? child.siteUrl,
    classId: settings.classId,
    className: settings.className,
    hiddenSubjects: settings.lessons.hiddenSubjects,
    subjectNames: settings.lessons.subjectNames ?? {},
    ...((withoutSite ?? child.withoutSite) ? { withoutSite: true } : {}),
  };
}

/**
 * The list as it is now, the child on screen with the phone's own fields.
 * `siteUrl`: the site of the class on screen. `withoutSite`: whether the phone
 * is "without a site" now (`isWithoutSite`), read before a switch changes it;
 * left out, the list's own stands.
 */
export function childrenNow(children: Children, settings: UserSettings, siteUrl: string | null, withoutSite?: boolean): Child[] {
  return children.list.map((c) => (c.id === children.activeId ? liveChild(c, settings, siteUrl, withoutSite) : c));
}

/** One class: never for a child without a site or a class, which has none to share. */
const sameClass = (a: { siteUrl: string; classId: string }, b: { siteUrl: string; classId: string }) =>
  a.siteUrl !== '' && a.classId !== '' && a.siteUrl === b.siteUrl && a.classId === b.classId;

function parseLink(raw: string | undefined): MashovLink | null {
  try {
    const link = JSON.parse(raw || 'null') as Partial<MashovLink> | null;
    return link && typeof link.guid === 'string' && link.guid && typeof link.semel === 'string' ? { guid: link.guid, semel: link.semel } : null;
  } catch {
    return null;
  }
}

/** The Mashov link of the child on screen: the active child's when there is a list, else the lone child's. */
export function shownMashovLink(kv: Pick<SiteKV, 'getString'>): MashovLink | null {
  const children = readChildren(kv);
  if (children) return children.list.find((c) => c.id === children.activeId)?.mashov ?? null;
  return parseLink(kv.getString(ONLY_CHILD_LINK_KEY));
}

/** Links a child to Mashov. `'shown'` is the child on screen, which without a list is the lone key. */
export function linkChild(kv: SiteKV, childId: string | 'shown', link: MashovLink): void {
  const children = readChildren(kv);
  if (!children) {
    if (childId === 'shown') kv.set(ONLY_CHILD_LINK_KEY, JSON.stringify(link));
    return;
  }
  const id = childId === 'shown' ? children.activeId : childId;
  writeChildren(kv, { ...children, list: children.list.map((c) => (c.id === id ? { ...c, mashov: link } : c)) });
}

/** Takes a child's Mashov link off. `'shown'` is the child on screen, which without a list is the lone key. */
export function unlinkChild(kv: SiteKV, childId: string | 'shown'): void {
  const children = readChildren(kv);
  if (!children) {
    if (childId === 'shown') kv.remove(ONLY_CHILD_LINK_KEY);
    return;
  }
  const id = childId === 'shown' ? children.activeId : childId;
  const unlinked = (c: Child): Child => {
    const { mashov: _gone, ...rest } = c;
    return rest;
  };
  writeChildren(kv, { ...children, list: children.list.map((c) => (c.id === id ? unlinked(c) : c)) });
}

/** The guids of the children the parent took off the list, until Mashov is disconnected. */
export function dismissedGuids(kv: Pick<SiteKV, 'getString'>): string[] {
  try {
    const guids = JSON.parse(kv.getString(DISMISSED_KEY) || '[]') as unknown;
    return Array.isArray(guids) ? guids.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export type AddChildResult = 'added' | 'already' | 'full';

/**
 * Adds a child in `next`'s class, after the others; the child on screen stays.
 * The first time, the class the phone has becomes the first child, with the
 * Mashov link, the name (`ONLY_CHILD_NAME_KEY`) and the "without a site" the
 * phone had. A class already in the list is `already`, unless Mashov says the
 * child is another one (two guids that differ); a child without a site or a
 * class never shares one. A seventh child is `full`. The school's class list
 * goes aside with the new child, for Settings once it is on screen.
 */
export function addChild(
  kv: SiteKV,
  settings: UserSettings,
  siteUrl: string,
  next: {
    siteUrl: string; classId: string; className: string; classes?: readonly ClassOption[]; lessons?: readonly string[];
    mashov?: MashovLink; withoutSite?: boolean; label?: string;
  },
  newId: () => string,
): AddChildResult {
  const kept = readChildren(kv);
  const children: Children = kept ?? (() => {
    const link = shownMashovLink(kv);
    const first: Child = {
      id: newId(), label: readOnlyChildName(kv), siteUrl, classId: settings.classId, className: settings.className, hiddenSubjects: settings.lessons.hiddenSubjects,
      subjectNames: settings.lessons.subjectNames ?? {},
      ...(link ? { mashov: link } : {}), ...(isWithoutSite(kv) ? { withoutSite: true } : {}),
    };
    return { list: [first], activeId: first.id };
  })();
  const now = childrenNow(children, settings, siteUrl, isWithoutSite(kv));
  const anotherChild = (c: Child) => Boolean(c.mashov && next.mashov && c.mashov.guid !== next.mashov.guid);
  if (now.some((c) => sameClass(c, next) && !anotherChild(c))) return 'already';
  if (now.length >= MAX_FOLLOWED_CLASSES) return 'full';
  const child: Child = {
    id: newId(), label: next.label ?? '', siteUrl: next.siteUrl, classId: next.classId, className: next.className, hiddenSubjects: [], subjectNames: {},
    ...(next.mashov ? { mashov: next.mashov } : {}), ...(next.withoutSite ? { withoutSite: true } : {}),
  };
  if (next.classes) kv.set(stashKey(child.id, SETTINGS_KEYS.classes), JSON.stringify(next.classes));
  // An invite's codes for the child's lessons (`lib/invite.ts`), read once the child is on screen.
  if (next.lessons?.length) kv.set(stashKey(child.id, LINK_LESSONS_KEY), JSON.stringify([...next.lessons]));
  writeChildren(kv, { list: [...now, child], activeId: children.activeId });
  // The lone link and the lone name are the first child's now, in the list.
  kv.remove(ONLY_CHILD_LINK_KEY);
  kv.remove(ONLY_CHILD_NAME_KEY);
  return 'added';
}

/** The child in this class, if one is: a push about it, or an invite to it. */
export function childOfClass(kv: Pick<SiteKV, 'getString'>, cls: { siteUrl: string; classId: string }): Child | null {
  return readChildren(kv)?.list.find((c) => sameClass(c, cls)) ?? null;
}

/** What the parent calls the child; an empty name gives the class's name back. */
export function renameChild(kv: SiteKV, id: string, label: string): void {
  const children = readChildren(kv);
  if (!children) return;
  writeChildren(kv, { ...children, list: children.list.map((c) => (c.id === id ? { ...c, label: label.trim().slice(0, 40) } : c)) });
}

/**
 * Puts another child on screen: the one on screen goes aside as it is now,
 * the other's keys come back under the phone's own, and its class is the
 * phone's. Returns the settings to save, or `null` when nothing changed.
 * `siteUrl`: the site of the class on screen now.
 */
export function switchChild(kv: SiteKV, settings: UserSettings, id: string, siteUrl: string | null): UserSettings | null {
  const children = readChildren(kv);
  if (!children || children.activeId === id) return null;
  const next = children.list.find((c) => c.id === id);
  if (!next) return null;
  const shownId = children.activeId;
  // The shown child's "without a site" is the phone's, read before the next child's replaces it.
  const list = childrenNow(children, settings, siteUrl, isWithoutSite(kv));
  for (const key of CHILD_KEYS) {
    kv.set(stashKey(shownId, key), kv.getString(key) ?? '');
    kv.set(key, kv.getString(stashKey(id, key)) ?? '');
    kv.set(stashKey(id, key), '');
  }
  // The site the phone looks for first after the feed's: the new child's, even before its feed is read.
  // A child without a site has none, and is "without a site" on screen.
  if (next.siteUrl) savePastedSite(kv, next.siteUrl);
  else kv.remove(SCHOOL_SITE_KEYS.pasted);
  setWithoutSite(kv, Boolean(next.withoutSite));
  kv.remove(ONLY_CHILD_LINK_KEY);
  kv.remove(ONLY_CHILD_NAME_KEY);
  writeChildren(kv, { list, activeId: id });
  // The hide list and the names are the child's: the shown child's never carry to the next.
  return {
    ...settings,
    classId: next.classId,
    className: next.className,
    lessons: { ...settings.lessons, hiddenSubjects: next.hiddenSubjects, subjectNames: next.subjectNames ?? {} },
  };
}

/**
 * Takes a child off the list, and what was kept aside for it. The child on
 * screen goes after another is put on screen (`switchChild`'s settings come
 * back, to save). A list down to one child is no list: that child's Mashov
 * link and name go to the lone keys. The removed child's guid is kept as
 * dismissed, so that Mashov's list does not bring it back.
 */
export function removeChild(kv: SiteKV, settings: UserSettings, id: string, siteUrl: string | null): UserSettings | null {
  let children = readChildren(kv);
  const removed = children?.list.find((c) => c.id === id);
  if (!children || !removed) return null;
  let saved: UserSettings | null = null;
  if (children.activeId === id) {
    saved = switchChild(kv, settings, children.list.find((c) => c.id !== id)!.id, siteUrl);
    children = readChildren(kv)!;
  }
  for (const key of CHILD_KEYS) kv.set(stashKey(id, key), '');
  const list = children.list.filter((c) => c.id !== id);
  writeChildren(kv, { list, activeId: children.activeId });
  if (removed.mashov && !dismissedGuids(kv).includes(removed.mashov.guid)) {
    kv.set(DISMISSED_KEY, JSON.stringify([...dismissedGuids(kv), removed.mashov.guid]));
  }
  // The last child's link and name go back to the lone keys (a child never named leaves its key empty).
  const last = list.length === 1 ? list[0]! : undefined;
  if (last?.mashov) kv.set(ONLY_CHILD_LINK_KEY, JSON.stringify(last.mashov));
  if (last) setOnlyChildName(kv, last.label);
  return saved;
}

/**
 * The classes the server follows besides the device's own (the child on
 * screen's): the other children's, each class once. Two children in one class
 * are one follow, with only the lines neither has hidden and only the names
 * both gave alike. A child without a site follows no class.
 *
 * Every follow carries its names, `{}` for none: the server replaces a follow's
 * whole prefs, so one sent without them would lose the names it had.
 */
export function otherFollows(children: Children | null): UpdateDeviceClassesBody['classes'] {
  if (!children) return [];
  const shown = children.list.find((c) => c.id === children.activeId)!;
  const byClass = new Map<string, { siteUrl: string; classId: string; hiddenSubjects: string[]; subjectNames: Record<string, string> }>();
  for (const c of children.list) {
    if (c.id === children.activeId || c.withoutSite || sameClass(c, shown)) continue;
    const key = `${c.siteUrl}|${c.classId}`;
    const seen = byClass.get(key);
    byClass.set(key, seen
      ? {
        ...seen,
        hiddenSubjects: seen.hiddenSubjects.filter((s) => c.hiddenSubjects.includes(s)),
        subjectNames: intersectNames(seen.subjectNames, c.subjectNames ?? {}),
      }
      : { siteUrl: c.siteUrl, classId: c.classId, hiddenSubjects: c.hiddenSubjects, subjectNames: c.subjectNames ?? {} });
  }
  return [...byClass.values()];
}

/**
 * The names of the other children in the shown child's class, for the device's
 * own prefs (`devicePrefsFrom`): the server follows that class once, for both,
 * so it gets only the names the shown child and every one of them gave alike.
 * A child without a site or a class shares none.
 */
export function sameClassNames(children: Children | null): SubjectNames[] {
  if (!children) return [];
  const shown = children.list.find((c) => c.id === children.activeId);
  if (!shown) return [];
  return children.list
    .filter((c) => c.id !== shown.id && !c.withoutSite && sameClass(c, shown))
    .map((c) => c.subjectNames ?? {});
}

/** What is kept aside for a child not on screen, as the summaries and the exam calendar read it. */
export interface StashedChild {
  feed: ClassFeed | null;
  manualExams: ManualExam[];
  examPrefs: ExamPrefs;
  /** The exam board the parent brought for this child alone (`ownBoard.ts`); `null` when there is none. */
  ownBoard: OwnBoard | null;
  pack: PackList;
  changeSeen: ChangeSightings;
  /** The child's last Mashov read and bagrut, from the parent's login (stage 3); empty without one. */
  mashov: LocalMashovRead['entities'];
  bagrut: LocalBagrut['exams'];
}

export function stashedChild(kv: Pick<SiteKV, 'getString'>, childId: string): StashedChild {
  const view = { getString: (key: string) => kv.getString(stashKey(childId, key)), set: () => undefined };
  const json = <T>(key: string): T | null => {
    try {
      const raw = view.getString(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };
  return {
    feed: json<ClassFeed>(DEVICE_KEYS.feed),
    manualExams: readManualExams(view),
    examPrefs: readExamPrefs(view),
    ownBoard: readOwnBoard(view),
    pack: readPackList(view),
    changeSeen: json<ChangeSightings>(CHANGE_SIGHTINGS_KEY) ?? {},
    mashov: localRead(view)?.entities ?? [],
    bagrut: localBagrut(view)?.exams ?? [],
  };
}

/** A child's feed, read by the refresh, kept aside for it. */
export function keepChildFeed(kv: SiteKV, childId: string, feed: ClassFeed): void {
  kv.set(stashKey(childId, DEVICE_KEYS.feed), JSON.stringify(feed));
}

/** The child on screen's place in the list as the phone has it now: after its class was picked again, or replaced by an invite's. */
export function syncShownChild(kv: SiteKV, settings: UserSettings, siteUrl: string | null): void {
  const children = readChildren(kv);
  if (children) writeChildren(kv, { ...children, list: childrenNow(children, settings, siteUrl, isWithoutSite(kv)) });
}

/**
 * The feed a child not on screen is read by: the one kept aside for it, or for
 * a child in the class on screen (a twin) the feed on screen. The server
 * follows that class once, so the refresh keeps no feed aside for the twin.
 */
export function feedOfChild(
  child: Pick<Child, 'siteUrl' | 'classId'>,
  kept: ClassFeed | null,
  shown: { siteUrl: string | null; classId: string; feed: ClassFeed | null },
): ClassFeed | null {
  return shown.siteUrl !== null && sameClass(child, { siteUrl: shown.siteUrl, classId: shown.classId }) ? shown.feed : kept;
}

/**
 * The feed a child not on screen is read by with that child's own exam board over it (`ownBoard.ts`): the exams of
 * the class's schedule are the child's own board's, when it has one. `shown.feed` is the class on screen's feed as
 * the server sent it, never as the child on screen sees it: a twin of the child on screen must not read that
 * child's board.
 */
export function childFeed(
  child: Pick<Child, 'siteUrl' | 'classId'>,
  kept: Pick<StashedChild, 'feed' | 'ownBoard'>,
  shown: { siteUrl: string | null; classId: string; feed: ClassFeed | null },
): ClassFeed | null {
  return withOwnBoard(feedOfChild(child, kept.feed, shown), kept.ownBoard);
}
