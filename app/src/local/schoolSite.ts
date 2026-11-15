/**
 * The school's Shahaf site, for a school whose Mashov does not name one
 * (plan Phase 3), kept on the phone with the student's other choice: to go on
 * without a site.
 *
 * Many schools use Mashov without Shahaf. Their days already come from
 * Mashov's fixed timetable and the changes the school enters there; only the
 * class needs a site (its list, the class's feed and pushes). So a student
 * may paste the site's address, and the phone keeps it (`SCHOOL_SITE_KEYS.pasted`),
 * or say there is none (`SCHOOL_SITE_KEYS.withoutSite`): then the phone
 * follows no class and says nothing about a missing site.
 *
 * Wherever the app needs the site (the class list, following a class), it
 * takes the followed class's site, else the pasted one, else Mashov's
 * (`chooseSchoolSite`).
 *
 * Pure: the storage and Mashov are passed in, so the tests drive it with a map.
 */
import type { SchoolSiteState } from '@sederyom/shared';
import { normalizeShahafUrl, shahafSiteOf } from '@sederyom/shared/logic/shahaf-site';

export const SCHOOL_SITE_KEYS = {
  /** `https://<school>.shahaf.site`, as the student pasted it and its classes were found. */
  pasted: 'school.siteUrl',
  /** `'1'` once the student chose to go on without a site. */
  withoutSite: 'school.withoutSite',
} as const;

export interface SiteKV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** The address the student pasted, or `null`; anything that no longer reads as one is none. */
export function pastedSite(kv: SiteKV): string | null {
  const raw = kv.getString(SCHOOL_SITE_KEYS.pasted);
  return raw ? normalizeShahafUrl(raw) : null;
}

/** Keeps a pasted address (already normalized); a student who has a site is no longer "without" one. */
export function savePastedSite(kv: SiteKV, siteUrl: string): void {
  kv.set(SCHOOL_SITE_KEYS.pasted, siteUrl);
  kv.remove(SCHOOL_SITE_KEYS.withoutSite);
}

export function isWithoutSite(kv: SiteKV): boolean {
  return kv.getString(SCHOOL_SITE_KEYS.withoutSite) === '1';
}

export function setWithoutSite(kv: SiteKV, on: boolean): void {
  if (on) kv.set(SCHOOL_SITE_KEYS.withoutSite, '1');
  else kv.remove(SCHOOL_SITE_KEYS.withoutSite);
}

/** What the phone knows of the site without asking anyone. */
export interface KnownSites {
  /** The site of the class the phone follows (its stored feed's). */
  feed?: string | null;
  /** The address the student pasted. */
  pasted?: string | null;
}

/**
 * The school's site: the followed class's, else the pasted one, else the one
 * Mashov names. Mashov is asked only when neither is known, and only when
 * `mashov` is given; it throws without a login, or with an error (a school
 * without Shahaf may get a 404 or a 500), which is "unknown", not "none". An
 * answer that is not a Shahaf address is none.
 */
export async function chooseSchoolSite(
  known: KnownSites,
  mashov?: () => Promise<string | null>,
): Promise<Pick<SchoolSiteState, 'url' | 'from'>> {
  if (known.feed) return { url: known.feed, from: 'class' };
  if (known.pasted) return { url: known.pasted, from: 'pasted' };
  if (!mashov) return { url: null, from: 'unknown' };
  let named: string | null;
  try {
    named = await mashov();
  } catch {
    return { url: null, from: 'unknown' };
  }
  const url = named ? shahafSiteOf(named) : null;
  return url ? { url, from: 'mashov' } : { url: null, from: 'none' };
}

/**
 * What a refresh reads of the class (`refreshLocalSources`): it follows the
 * picked class on `/v2`, and reads the class's feed. "Without a site" it does
 * neither, so it never reports a site nobody has, or a class nobody picked.
 */
export function classReads(classId: string, withoutSite: boolean): { follow: boolean; feed: boolean } {
  if (withoutSite) return { follow: false, feed: false };
  return { follow: classId !== '', feed: true };
}

/**
 * Whether the phone keeps the "בית ספר" calendar: once a class is picked, or
 * once the student chose to go on without a site, whose exams (Mashov's and
 * their own) belong in Google all the same. Not before either, mid-setup.
 */
export function keepsExamCalendar(classId: string | null, withoutSite: boolean): boolean {
  return Boolean(classId) || withoutSite;
}
