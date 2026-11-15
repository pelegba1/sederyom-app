/**
 * The class's invite link (ideas ה2):
 *
 *   https://<server>/join?s=<school>&c=<class>
 *
 * `s` is the school's Shahaf subdomain and `c` the site's `cls` value. The
 * server's page (`public/join.html`) opens the app on `sederyom://join?s=…&c=…`,
 * or, when the app is not installed, the store, which hands the same
 * `s=…&c=…` to the app after the install as its install referrer. Either way
 * the app follows the class (`JoinBridge` in `navigation/Root.tsx`): its
 * timetable, its changes and the exam calendar a classmate already linked,
 * with nothing to look for and no address to paste.
 *
 *   inviteUrl('https://api.example', 'https://school-a.shahaf.site', '36')
 *     → 'https://api.example/join?s=school-a&c=36'
 *   joinOf('sederyom://join?s=school-a&c=36')
 *     → { siteUrl: 'https://school-a.shahaf.site', classId: '36' }
 *
 * A student's invite to a parent adds `p=1`, and `h=`: the lines of the class
 * the student hid in "השיעורים שלי", each as a short code (`lessonToken`), so
 * the parent's phone shows the child's lessons and the link names no subject
 * or teacher.
 *
 * Pure, so the tests run it as is.
 */

/** A Shahaf subdomain, as `normalizeShahafUrl` takes one. */
const SCHOOL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A site's `cls` value: digits on every site seen, kept to what a link carries plainly. */
const CLASS = /^[A-Za-z0-9_-]{1,40}$/;

/** At most this many lines' codes in one link; a class has fewer to hide. */
const MAX_LESSONS = 40;
/** A line's code, as `lessonToken` makes it. */
const TOKEN = /^[0-9a-z]{1,7}$/;

/** The class a link names. */
export interface JoinTarget {
  /** `https://<school>.shahaf.site`. */
  siteUrl: string;
  classId: string;
  /** `p=1`: a student's invite to a parent (docs/parents-plan.md); the app opens as a parent's. */
  parent?: boolean;
  /** `h=`, on a parent's link only: the codes of the lines the child hid (`lessonToken`). */
  lessons?: string[];
}

/**
 * A line's hide key as an invite carries it: a 32-bit FNV-1a hash in base
 * 36, so no subject or teacher name travels in the link or in the server's
 * logs of /join. Both phones make the same code from the same line.
 */
export function lessonToken(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The hide keys that a link's codes name among the class's lines on this phone, each once. */
export function linkLessons(codes: readonly string[], keys: readonly string[]): string[] {
  const wanted = new Set(codes);
  return [...new Set(keys)].filter((k) => wanted.has(lessonToken(k)));
}

/** A link's `h=`, read leniently: a bad or cut code is dropped, never the link. */
function lessonCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split('.').filter((t) => TOKEN.test(t)))].slice(0, MAX_LESSONS);
}

/** `school-a` for `https://school-a.shahaf.site`; `null` for any other address. */
export function schoolOfSite(siteUrl: string): string | null {
  const m = /^https:\/\/([^./]+)\.shahaf\.site\/?$/i.exec(siteUrl.trim());
  const school = m?.[1]?.toLowerCase() ?? null;
  return school && school !== 'www' && SCHOOL.test(school) ? school : null;
}

/**
 * The invite link to the class, or `null` when the app has no server or the
 * class is not one a link can carry. `parent`: for a student's parent (`p=1`),
 * with `hidden`, the hide keys of "השיעורים שלי", as codes (`h=`); a
 * classmate's invite never carries them, since a classmate's groups differ.
 */
export function inviteUrl(base: string, siteUrl: string, classId: string, parent = false, hidden: readonly string[] = []): string | null {
  const school = schoolOfSite(siteUrl);
  if (!base || !school || !CLASS.test(classId)) return null;
  const codes = parent ? [...new Set(hidden.map(lessonToken))].slice(0, MAX_LESSONS) : [];
  return `${base.replace(/\/+$/, '')}/join?s=${school}&c=${classId}${parent ? '&p=1' : ''}${codes.length > 0 ? `&h=${codes.join('.')}` : ''}`;
}

/** What a student's invite to classmates says before its link, in the share sheet: theirs, not a class's. */
export function inviteMessage(url: string): string {
  return `ככה מקבלים בטלפון את המערכת, השינויים והמבחנים שלנו, עם סדר יום:\n${url}`;
}

/**
 * What an invite to a parent says: what the parent gets. A student's is about
 * their own timetable; on a parent's phone, `childClass` names the class it
 * shows. No word about Mashov: a parent may connect the parent's own (stage 3).
 */
export function parentInviteMessage(url: string, childClass?: string): string {
  const whose = childClass ? `המערכת של הכיתה ${childClass}` : 'המערכת שלי';
  return `ככה רואים בטלפון את ${whose}, את השינויים בה ואת המבחנים. להתקנה:\n${url}`;
}

function queryParams(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    try {
      out.set(decodeURIComponent(part.slice(0, eq)), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' ')));
    } catch {
      // A malformed escape: that pair is skipped.
    }
  }
  return out;
}

/**
 * The class an invite names, from the app's own link (`sederyom://join?…`),
 * the page's (`https://…/join?…`), or the store's install referrer, which is
 * the query alone (`s=…&c=…`); `null` for anything else, such as the store's
 * own referrer for an install that came from no invite.
 */
export function joinOf(link: string | null | undefined): JoinTarget | null {
  if (!link) return null;
  const q = link.indexOf('?');
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) {
    const head = (q >= 0 ? link.slice(0, q) : link).replace(/\/+$/, '');
    if (!/^sederyom:\/\/join$/i.test(head) && !/^https:\/\/[^/?#]+\/join$/i.test(head)) return null;
  }
  const params = queryParams((q >= 0 ? link.slice(q + 1) : link).split('#')[0]!);
  const school = params.get('s')?.toLowerCase() ?? '';
  const classId = params.get('c') ?? '';
  if (!SCHOOL.test(school) || school === 'www' || !CLASS.test(classId)) return null;
  const parent = params.get('p') === '1';
  const lessons = parent ? lessonCodes(params.get('h')) : [];
  return {
    siteUrl: `https://${school}.shahaf.site`, classId, ...(parent ? { parent: true } : {}), ...(lessons.length > 0 ? { lessons } : {}),
  };
}
