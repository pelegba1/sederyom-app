/**
 * Which of the children a parent's Mashov lists the phone has already, and
 * which to add (docs/superpowers/specs/2026-11-02-parents-other-schools-design.md §4.2).
 *
 * A phone child linked to a guid is that child, whatever its class. One without
 * a link is the Mashov child in its class, when only one is, or only one of
 * several is at its school's site; while a school was not read, only its site
 * confirms the one. Anything less sure is asked or waits, and nobody is
 * added in the place of the children asked about: one child's data is never
 * shown under another's. The others are added, the home school's first, in
 * their class when their site lists it and without a site otherwise, up to
 * `MAX_FOLLOWED_CLASSES` on the phone.
 *
 * The plan is pure: the scan, the phone's children and the sites' class lists
 * are passed in. `applyChildrenPlan` writes it through the storage it is given.
 */
import type { ClassOption, UserSettings } from '@sederyom/shared';
import { MAX_FOLLOWED_CLASSES } from '@sederyom/shared';
import { shahafSiteOf } from '@sederyom/shared/logic/shahaf-site';
import type { ParentSchools, ScannedChild, SchoolScan } from '../mashov/parentSchools';
import { PARENT_SCHOOLS_COPY } from '../lib/connections';
import { classKeyOf, mashovClassName } from '../mashov/parents';
import { addChild, linkChild, readChildren, renameChild, shownMashovLink, unlinkChild, type MashovLink } from './children';
import { SETTINGS_KEYS } from './keyMigrations';
import { SCHOOL_SITE_KEYS, isWithoutSite, savePastedSite, setWithoutSite, type SiteKV } from './schoolSite';

/** A child on the phone as the plan reads it. `'shown'` is the lone child, when there is no list. */
export interface PhoneChild {
  id: string | 'shown';
  siteUrl: string;
  className: string;
  mashov?: MashovLink;
}

/** A child to add, as `addChild` takes it. */
export interface NewChild {
  link: MashovLink;
  /** The first name Mashov gave. */
  label: string;
  /** `''` without a site. */
  siteUrl: string;
  classId: string;
  className: string;
  withoutSite: boolean;
  schoolName: string;
}

export interface ChildrenPlan {
  /** Phone children Mashov lists, the link to keep on each: the unlinked ones found, and the linked ones at another school now. */
  link: { childId: string | 'shown'; link: MashovLink }[];
  add: NewChild[];
  /** Phone children Mashov may list as more than one child: the parent picks, and until then none of those is read or added. */
  ask: { childId: string | 'shown'; className: string; options: (ScannedChild & { schoolName: string })[] }[];
  /** Children Mashov lists whom the parent's login cannot read. */
  unbound: (ScannedChild & { schoolName: string })[];
  /** Children past the cap. */
  full: ScannedChild[];
  /** Children whose class or site's class list is not known yet, or the phone's own site (`applyChildrenPlan`): the next scan places them. */
  later: ScannedChild[];
}

interface Candidate {
  child: ScannedChild;
  school: SchoolScan;
  key: string | null;
}

const withSchool = ({ child, school }: Candidate) => ({ ...child, schoolName: school.name });

const linkOf = ({ child }: Candidate): MashovLink => ({ guid: child.guid, semel: child.semel });

/**
 * The candidates an unlinked phone child may be: the ones in its class, or of
 * several, the ones at its site when any is. One is the child; more are asked.
 */
function matchesOf(phone: PhoneChild, free: readonly Candidate[]): Candidate[] {
  const key = classKeyOf(phone.className);
  const same = key ? free.filter((c) => c.key === key) : [];
  if (same.length <= 1) return same;
  const atSite = same.filter((c) => atSiteOf(phone, c));
  return atSite.length > 0 ? atSite : same;
}

/** Whether the candidate's school site is the phone child's. */
function atSiteOf(phone: PhoneChild, { school }: Candidate): boolean {
  const site = phone.siteUrl ? shahafSiteOf(phone.siteUrl) : null;
  return site !== null && school.site === site;
}

/**
 * Whether the scan read every school a bound child is at: each school it
 * switched to answered with a list holding every child Mashov listed there.
 * A school it did not try has only children the login cannot read.
 */
function scanComplete(scan: ParentSchools): boolean {
  return scan.schools.every((s) => s.home || s.switched === null
    || (s.switched.status >= 200 && s.switched.status < 300 && s.externGuidsSeen === true));
}

/**
 * The child to add: in the one class of its site with its class, else without
 * a site; `null` while that is not known (no class from Mashov, a site not
 * asked for, or a class list not read). A class that reads as no grade and
 * number is placed by no site's list: without a site.
 */
function newChild({ child, school, key }: Candidate, classesBySite: Readonly<Record<string, ClassOption[] | null>>): NewChild | null {
  const base = { link: { guid: child.guid, semel: child.semel }, label: child.firstName, schoolName: school.name };
  const withoutSite = { ...base, siteUrl: '', classId: '', className: mashovClassName(child), withoutSite: true };
  if (!key) return withoutSite.className ? withoutSite : null;
  if (school.site === null && !school.siteKnown) return null;
  if (school.site !== null) {
    const classes = classesBySite[school.site];
    if (!classes) return null;
    const same = classes.filter((o) => classKeyOf(o.name) === key);
    if (same.length === 1) return { ...base, siteUrl: school.site, classId: same[0]!.id, className: same[0]!.name, withoutSite: false };
  }
  return withoutSite;
}

/**
 * The lines about the children Mashov lists and the parent's login cannot read
 * (`bound === false`), one each, in scan order: the setup's class step and the
 * login's result say what to do. A child once, at the first school listing it,
 * and none bound at another school (the plan reads it the same way). Only the
 * first name and the school's name, never a guid.
 */
export function unboundLines(schools: ParentSchools): string[] {
  const bound = new Set(schools.schools.flatMap((s) => s.children.filter((c) => c.bound).map((c) => c.guid)));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const school of schools.schools) {
    for (const child of school.children) {
      if (child.bound || bound.has(child.guid) || seen.has(child.guid)) continue;
      seen.add(child.guid);
      lines.push(PARENT_SCHOOLS_COPY.unbound(child.firstName, school.name));
    }
  }
  return lines;
}

/**
 * What the login screen says after a scan: how many children were added, and
 * a line for each reason a child is not here: one the login cannot read, the
 * cap, children left for the next scan, and a school Mashov would not move the
 * session to. `result` is a `ParentScanResult` (`parentScanRun.ts`, which
 * imports this module).
 */
export function scanSummary(result: { schools: ParentSchools; plan: ChildrenPlan; added: number }): { added: string | null; lines: string[] } {
  const { schools, plan, added } = result;
  const lines = unboundLines(schools);
  if (plan.full.length > 0) lines.push(PARENT_SCHOOLS_COPY.full);
  if (plan.later.length > 0) lines.push(PARENT_SCHOOLS_COPY.later(plan.later.length));
  for (const school of schools.schools) {
    const { switched } = school;
    if (switched && !(switched.status >= 200 && switched.status < 300)) lines.push(PARENT_SCHOOLS_COPY.refused(school.name));
  }
  return { added: added > 0 ? PARENT_SCHOOLS_COPY.added(added) : null, lines };
}

/**
 * The read's error as the login screen should draw it now. "Mashov did not
 * find the child on screen" ends once that child is linked (an answer to a
 * question links it, and the read runs again): the error the login brought is
 * stale then, and `null` is returned for it. Any other error stands.
 */
export function readErrorNow(error: string | null, shownLinked: boolean): string | null {
  return error === PARENT_SCHOOLS_COPY.notFound && shownLinked ? null : error;
}

/**
 * After the class of the child on screen was picked again (Settings, or an
 * invite): its link goes when the new class is not its Mashov child's, by
 * the class's key, so that one child's data is never read under another's
 * class. The next scan links it again, or links the child of that class.
 * Kept when either class has no key, or the last scan does not hold the
 * linked child: nothing says it is another. `true` when the link went.
 */
export function dropLinkOffClass(kv: SiteKV, className: string, scan: ParentSchools | null): boolean {
  const link = shownMashovLink(kv);
  if (!link || !scan) return false;
  const was = scan.schools.flatMap((s) => s.children).filter((c) => c.guid === link.guid).map((c) => classKeyOf(mashovClassName(c))).find(Boolean) ?? null;
  const now = classKeyOf(className);
  if (!was || !now || was === now) return false;
  unlinkChild(kv, 'shown');
  return true;
}

/** A choice in the question of who is who: the child's first name and its school. Never a guid. */
export function askOptionLabel(option: Pick<ScannedChild, 'firstName'> & { schoolName: string }): string {
  return [option.firstName || 'ילד או ילדה', option.schoolName].filter(Boolean).join(', ');
}

/**
 * The plan for the phone's children after a scan. Every bound child Mashov
 * lists, the removed ones aside, ends in one place: linked, asked about,
 * added, `full`, or `later`. A child two phone children would both be linked
 * to is asked about for each of them, and a child one is linked to is offered
 * to no other.
 */
export function planChildren(input: {
  scan: ParentSchools;
  phone: PhoneChild[];
  dismissed: readonly string[];
  classesBySite: Readonly<Record<string, ClassOption[] | null>>;
}): ChildrenPlan {
  const { scan, phone, classesBySite } = input;
  const dismissed = new Set(input.dismissed);
  const pool: Candidate[] = [];
  const unbound: ChildrenPlan['unbound'] = [];
  // Each child once, at the first school listing it; one bound anywhere is not unbound.
  const bound = new Set(scan.schools.flatMap((s) => s.children.filter((c) => c.bound).map((c) => c.guid)));
  const seen = new Set<string>();
  for (const school of scan.schools) {
    for (const child of school.children) {
      if (dismissed.has(child.guid) || seen.has(child.guid) || (!child.bound && bound.has(child.guid))) continue;
      seen.add(child.guid);
      if (child.bound) pool.push({ child, school, key: classKeyOf(mashovClassName(child)) });
      else unbound.push({ ...child, schoolName: school.name });
    }
  }

  // Linked already: that child. Every unlinked one is matched against the same pool, so the phone's order decides nothing.
  const taken = new Set(phone.flatMap((p) => (p.mashov ? [p.mashov.guid] : [])));
  const free = pool.filter((c) => !taken.has(c.child.guid));
  const complete = scanComplete(scan);
  const lone = phone.length === 1 && phone[0]!.id === 'shown';
  // `hold`: a match not sure enough to link, while a school was not read; it waits for the next scan (`later`).
  const matched = phone.filter((p) => !p.mashov).map((p): { p: PhoneChild; remaining: Candidate[]; hold: Candidate | null } => {
    const remaining = matchesOf(p, free);
    // Decision 24: Mashov's only child is the lone child's, even when its class reads otherwise.
    if (remaining.length === 0 && lone && pool.length === 1) return complete ? { p, remaining: [pool[0]!], hold: null } : { p, remaining: [], hold: pool[0]! };
    // Over a scan that missed a school, the one child of a class elsewhere may not be the phone's: only its site confirms it.
    if (!complete && remaining.length === 1 && !atSiteOf(p, remaining[0]!)) return { p, remaining: [], hold: remaining[0]! };
    return { p, remaining, hold: null };
  });
  const held = new Set(matched.flatMap(({ hold }) => (hold ? [hold.child.guid] : [])));
  const claims = new Map<string, number>();
  for (const { remaining } of matched) if (remaining.length === 1) claims.set(remaining[0]!.child.guid, (claims.get(remaining[0]!.child.guid) ?? 0) + 1);

  const sure = (remaining: Candidate[]) => remaining.length === 1 && claims.get(remaining[0]!.child.guid) === 1;
  const link: ChildrenPlan['link'] = [];
  for (const p of phone) {
    if (p.mashov) {
      // A linked child Mashov lists at another school now: reads go to the link's school.
      const now = pool.find((c) => c.child.guid === p.mashov!.guid);
      if (now && now.child.semel !== p.mashov.semel) link.push({ childId: p.id, link: linkOf(now) });
      continue;
    }
    const remaining = matched.find((m) => m.p === p)!.remaining;
    if (sure(remaining)) link.push({ childId: p.id, link: linkOf(remaining[0]!) });
  }
  const linked = new Set(link.map((l) => l.link.guid));
  // A child another phone child is linked to is no option; one option left is still asked, never linked by elimination.
  const ask = matched
    .filter(({ remaining }) => remaining.length > 0 && !sure(remaining))
    .map(({ p, remaining }) => ({ childId: p.id, className: p.className, options: remaining.filter((c) => !linked.has(c.child.guid)).map(withSchool) }))
    // Every option linked to another phone child: nothing is left to ask.
    .filter((a) => a.options.length > 0);
  for (const { remaining } of matched) for (const c of remaining) taken.add(c.child.guid);

  const add: NewChild[] = [];
  const full: ScannedChild[] = [];
  const later: ScannedChild[] = [];
  for (const c of pool) {
    if (taken.has(c.child.guid)) continue;
    if (held.has(c.child.guid)) {
      later.push(c.child);
      continue;
    }
    if (phone.length + add.length >= MAX_FOLLOWED_CLASSES) {
      full.push(c.child);
      continue;
    }
    const next = newChild(c, classesBySite);
    if (next) add.push(next);
    else later.push(c.child);
  }
  return { link, add, ask, unbound, full, later };
}

/**
 * Puts the plan on the phone: each link on its child, and each child to add
 * after the others. A phone with no class yet (none picked, and not "without a
 * site") takes the first child to add as its own: its class goes into the
 * settings, which come back to save, with its site or "without a site", and
 * its link in the lone key; the list begins with the second, and the first
 * keeps Mashov's first name then. `null` when the settings did not change.
 * `siteUrl`: the site of the class on screen. Each new child's school's class
 * list, from `classesBySite`, goes with it. A list that begins here, from a
 * phone's one linked child, names that child as Mashov does: its first name
 * in `scan`, by the link's guid.
 *
 * A phone with a class and no site known (not "without a site") would put its
 * child in the list with none: that child takes the home school's site from
 * `scan`, and while that is not known either, nobody is added and the children
 * to add wait for the next scan. They go into `plan.later`, which the login
 * screen reads (`scanSummary`).
 */
export function applyChildrenPlan(
  kv: SiteKV,
  settings: UserSettings,
  siteUrl: string | null,
  plan: ChildrenPlan,
  newId: () => string,
  classesBySite: Readonly<Record<string, ClassOption[] | null>> = {},
  scan?: ParentSchools,
): UserSettings | null {
  const classesOf = (site: string) => (site ? classesBySite[site] ?? undefined : undefined);
  const hadList = readChildren(kv) !== null;
  for (const { childId, link } of plan.link) linkChild(kv, childId, link);
  let rest = plan.add;
  let shown = settings;
  let site = siteUrl ?? '';
  let saved: UserSettings | null = null;
  const first = plan.add[0];
  if (first && !readChildren(kv) && !settings.className && !isWithoutSite(kv)) {
    saved = { ...settings, classId: first.classId, className: first.className, lessons: { ...settings.lessons, hiddenSubjects: [], subjectNames: {} } };
    if (first.siteUrl) {
      savePastedSite(kv, first.siteUrl);
    } else {
      // A site pasted before is not this child's, as on a switch to a child without one (`switchChild`).
      kv.remove(SCHOOL_SITE_KEYS.pasted);
      setWithoutSite(kv, true);
    }
    const classes = classesOf(first.siteUrl);
    if (classes) kv.set(SETTINGS_KEYS.classes, JSON.stringify(classes));
    linkChild(kv, 'shown', first.link);
    rest = plan.add.slice(1);
    shown = saved;
    site = first.siteUrl;
  } else if (rest.length > 0 && !site && settings.className && !isWithoutSite(kv)) {
    const children = readChildren(kv);
    site = children?.list.find((c) => c.id === children.activeId)?.siteUrl || scan?.schools.find((s) => s.home)?.site || '';
    if (!site) {
      const scanned = scan?.schools.flatMap((s) => s.children) ?? [];
      plan.later.push(...rest.map((c): ScannedChild => scanned.find((k) => k.guid === c.link.guid && k.bound)
        ?? { guid: c.link.guid, firstName: c.label, classCode: '', classNum: '', semel: c.link.semel, bound: true }));
      rest = [];
    }
  }
  for (const c of rest) {
    const classes = classesOf(c.siteUrl);
    addChild(kv, shown, site, {
      siteUrl: c.siteUrl, classId: c.classId, className: c.className, mashov: c.link, withoutSite: c.withoutSite, label: c.label,
      ...(classes ? { classes } : {}),
    }, newId);
  }
  // The list began with the second child: the first, on screen, is named as Mashov names it,
  // unless the parent named it already (`ONLY_CHILD_NAME_KEY`).
  const children = readChildren(kv);
  if (saved) {
    const shownChild = children?.list.find((c) => c.id === children.activeId);
    if (first && shownChild && !shownChild.label) renameChild(kv, shownChild.id, first.label);
  } else if (children && !hadList) {
    // The list began with a sibling of the phone's one linked child, which `addChild` made the first and left unnamed.
    const lone = children.list[0]!;
    const name = lone.mashov && scan?.schools.flatMap((s) => s.children).find((c) => c.guid === lone.mashov!.guid)?.firstName;
    if (!lone.label && name) renameChild(kv, lone.id, name);
  }
  return saved;
}
