/**
 * A parent's session at another school (docs/superpowers/specs/2026-11-02-parents-other-schools-design.md §4.4).
 *
 * A parent's Mashov login is bound to one school at a time; the children Mashov
 * lists at other schools (`externChildren`) are read after `changeSchool`, which
 * is what Mashov's own site sends when the parent picks another school: the
 * login's device fields, with the kept `devicePass` as its header. The answer is
 * a login's, `{ credential, accessToken }`: the phone's jar gets the new session
 * cookies itself, and the answer's list of children is the new school's.
 *
 * A child's read happens in the child's own school (`parentReadApi`): the
 * session moves there first when it is elsewhere.
 */
import type { UserSettings } from '@sederyom/shared';
import { MAX_FOLLOWED_CLASSES } from '@sederyom/shared';
import { AuthError } from '@sederyom/shared/logic/entities';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';
import { CSRF_COOKIE, AUTH_COOKIE, parseMashovToken } from '@sederyom/shared/logic/mashov/session';
import { shahafSiteOf } from '@sederyom/shared/logic/shahaf-site';
import { MASHOV_ORIGIN } from '../config';
import { PARENT_SCHOOLS_COPY } from '../lib/connections';
import { dismissedGuids, readChildren, shownMashovLink } from '../local/children';
import { DEVICE_KEYS, deviceLoginFields } from './device';
import {
  PARENT_KEYS, ParentReadError, ParentSchoolError, accessTokenView, forParent, mashovChildren, parentRead, readView, reasonOf, takeLoginBody,
  type AccessTokenView, type ExternChild,
} from './parents';
import { phoneMashovApi } from './phone';
import type { KeyValue } from './sync';

const TIMEOUT_MS = 20_000;

/** How Mashov answered a `changeSchool`: `status` 0 and reason `'network'` when no answer came. */
export interface ChangeSchoolAnswer {
  status: number;
  /** Mashov's `Reason` header, cut to a code; `null` when it sent none. */
  reason: string | null;
  /** The new school's children, as the answer listed them; `null` unless the change worked and said so. */
  view: AccessTokenView | null;
}

/** The school (`semel`) the session in the jar belongs to, or `null` when there is no login. */
export async function sessionSemel(jar: () => Promise<Record<string, string>>): Promise<string | null> {
  const value = (await jar())[AUTH_COOKIE];
  return (value ? parseMashovToken(`${AUTH_COOKIE}=${value}`) : null)?.schoolId ?? null;
}

/**
 * Moves the session to the school `semel`. On a 2xx the kept list of children
 * becomes that school's (`mashov.parentChildren` is always the session's school)
 * and a fresh `devicePass` replaces the old one; a refusal changes nothing.
 */
export async function changeSchool(
  kv: KeyValue,
  semel: string,
  fetchImpl: typeof fetch,
  jar: () => Promise<Record<string, string>>,
): Promise<ChangeSchoolAnswer> {
  const pass = kv.getString(DEVICE_KEYS.pass);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Read the CSRF token per request: Mashov rotates it with the session.
    const csrf = (await jar())[CSRF_COOKIE] ?? null;
    const res = await fetchImpl(`${MASHOV_ORIGIN}/api/changeSchool/${encodeURIComponent(semel)}`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(pass ? { devicePass: pass } : {}),
      },
      body: JSON.stringify(deviceLoginFields(kv)),
    });
    const reason = reasonOf(res.headers.get('Reason'));
    if (res.status < 200 || res.status >= 300) return { status: res.status, reason, view: null };
    const next = res.headers.get('devicePass');
    if (next) kv.set(DEVICE_KEYS.pass, next);
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: the change worked, there is no list to keep.
    }
    const view = takeLoginBody(kv, body, 'changeSchool') ? readView(accessTokenView(body)) : null;
    return { status: res.status, reason, view };
  } catch {
    return { status: 0, reason: 'network', view: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Switches to `semel` unless the session is already there: `null` then, with no request made. */
export async function ensureSchool(
  kv: KeyValue,
  semel: string,
  fetchImpl: typeof fetch,
  jar: () => Promise<Record<string, string>>,
): Promise<ChangeSchoolAnswer | null> {
  if ((await sessionSemel(jar)) === semel) return null;
  return changeSchool(kv, semel, fetchImpl, jar);
}

/**
 * Whether a switch Mashov said yes to left the session in another school than
 * `semel`. A token that names no school cannot tell: `false` then.
 */
async function stayedElsewhere(semel: string, jar: () => Promise<Record<string, string>>): Promise<boolean> {
  const now = await sessionSemel(jar);
  return now !== null && now !== semel;
}

/**
 * Why a read cannot go on after its switch to the child's school, or `null`
 * when it can. `names`: the child as the parent calls it and the school as
 * Mashov does, either `''`.
 * - A refusal that names its reason is the school's (`ParentSchoolError`):
 *   the session is alive, so it is not "Mashov disconnected".
 * - A 401, or a 403 with no reason, is a session Mashov no longer knows: an
 *   `AuthError`, so the device pass can log in again.
 * - No answer is a plain failure, tried again on the next read.
 */
export function schoolSwitchError(answer: ChangeSchoolAnswer, names: { child: string; school: string }): Error | null {
  const { status, reason } = answer;
  if (status >= 200 && status < 300) return null;
  if (status === 0) return new Error('Mashov changeSchool: no answer');
  if (status === 401 || (status === 403 && !reason)) return new AuthError(`Mashov changeSchool returned ${status}`);
  if (reason === 'BindNotFound') return new ParentSchoolError(PARENT_SCHOOLS_COPY.bindGone(names.child));
  if (reason === 'ChangePass') return new ParentSchoolError(PARENT_SCHOOLS_COPY.changePass(names.school));
  return new ParentSchoolError(PARENT_SCHOOLS_COPY.refused(names.school, reason ?? String(status)));
}

export interface ParentReadDeps {
  kv: KeyValue;
  settings: Pick<UserSettings, 'audience' | 'className'>;
  fetchImpl: typeof fetch;
  jar: () => Promise<Record<string, string>>;
}

/**
 * The API a parent's read goes through (`run.ts`): the child on screen's
 * (`parentRead`), or the login's own user's when Mashov gave no list. A
 * linked child is read in its own school: when the session is in another,
 * it moves there first, and when Mashov refuses, nothing is read and the
 * last read stays (`schoolSwitchError`). A yes that left the session in
 * another school is a refusal too: the read would be that school's. With no
 * login in the jar there is no session to move, and the read finds no login,
 * as before.
 */
export async function parentReadApi(deps: ParentReadDeps): Promise<MashovApi> {
  const { kv, fetchImpl, jar } = deps;
  const children = readChildren(kv);
  const pick = parentRead(kv, deps.settings, children === null);
  if (pick && 'missing' in pick) throw new ParentReadError(pick.missing);
  if (pick?.by === 'link') {
    // Any login, even one whose token does not name its school: then it moves, the safe side.
    const token = (await jar())[AUTH_COOKIE];
    if (token && parseMashovToken(`${AUTH_COOKIE}=${token}`)) {
      const answer = await ensureSchool(kv, pick.semel, fetchImpl, jar);
      const school = parentSchools(kv)?.schools.find((s) => s.semel === pick.semel)?.name ?? '';
      const error = answer && schoolSwitchError(answer, { child: children?.list.find((c) => c.id === children.activeId)?.label ?? '', school });
      if (error) throw error;
      if (answer && (await stayedElsewhere(pick.semel, jar))) throw new ParentSchoolError(PARENT_SCHOOLS_COPY.refused(school));
    }
  }
  const api = await phoneMashovApi(fetchImpl, jar, pick?.guid);
  return pick ? forParent(api) : api;
}

/** A child as the scan keeps it: the guid, first name and class (empty for a child the parent cannot read), the school and whether the login is bound to it. */
export interface ScannedChild {
  guid: string;
  firstName: string;
  classCode: string;
  classNum: string;
  semel: string;
  bound: boolean;
}

/** One school the parent's Mashov lists, as the scan found it. */
export interface SchoolScan {
  semel: string;
  /** The school's name from the children listed there; `''` for the home school, whose name the token does not carry. */
  name: string;
  home: boolean;
  /** The school's Shahaf site, already through `shahafSiteOf`; `null` when it has none or it is not known. */
  site: string | null;
  /** `false` when the site could not be asked for: `coolSite` threw, or the session never got into the school. */
  siteKnown: boolean;
  /** How the switch to this school went; `null` for the home school and for a school the scan did not try. */
  switched: { status: number; reason: string | null } | null;
  /** The children there: the school's own list after a switch that worked, and the ones the parent cannot read. */
  children: ScannedChild[];
  /** Whether the guids of the children Mashov listed here appeared in `children` after the switch, for the check; `null` when there was no list to compare. */
  externGuidsSeen: boolean | null;
}

export interface ParentSchools {
  at: string;
  /** The school the login belongs to. */
  home: string;
  /** The home school first, then the others in the order Mashov listed them. */
  schools: SchoolScan[];
  /** How the trip back to the home school went; `null` when the scan never left it. */
  back: { status: number; reason: string | null } | null;
}

export interface ScanDeps {
  kv: KeyValue;
  fetchImpl: typeof fetch;
  jar: () => Promise<Record<string, string>>;
  /** Mashov's Shahaf site for the school the session is in now. */
  coolSite: () => Promise<string | null>;
  now?: () => Date;
}

const fromList = (c: { guid: string; firstName: string; classCode: string; classNum: string }, semel: string): ScannedChild => ({
  guid: c.guid, firstName: c.firstName, classCode: c.classCode, classNum: c.classNum, semel, bound: true,
});

const fromExtern = (e: ExternChild): ScannedChild => ({ guid: e.childGuid, firstName: e.privateName, classCode: '', classNum: '', semel: e.semel, bound: e.bound });

/** The site of the school the session is in. */
async function siteHere(coolSite: ScanDeps['coolSite']): Promise<{ site: string | null; siteKnown: boolean }> {
  try {
    const raw = await coolSite();
    return { site: raw ? shahafSiteOf(raw) : null, siteKnown: true };
  } catch {
    return { site: null, siteKnown: false };
  }
}

/**
 * Visits each school Mashov lists children at, once and in Mashov's order, and
 * goes back to the home school. A school the login is not bound to for any of
 * its children is listed and not visited, and a school that refuses is kept
 * with why; so is one Mashov said yes to while the session stayed elsewhere,
 * as not read. Saved under `PARENT_KEYS.schools`; `null` without a login or a
 * list, or with a list of another school than the session's.
 */
export async function scanParentSchools(deps: ScanDeps): Promise<ParentSchools | null> {
  const { kv, fetchImpl, jar, coolSite } = deps;
  const home = await sessionSemel(jar);
  const kept = mashovChildren(kv);
  if (!home || !kept) return null;
  // The list is the session's school's, or the home school would be read from another's. A list kept before semels were read has none.
  if (kept.shape.semel && kept.shape.semel !== home) return null;
  // Read before the first switch: each one replaces the kept list.
  const externs = kept.shape.externs ?? [];
  const homeList = kept.list;
  const others = new Map<string, ExternChild[]>();
  for (const e of externs) if (e.semel !== home) others.set(e.semel, [...(others.get(e.semel) ?? []), e]);

  const homeGuids = new Set(homeList.map((c) => c.guid));
  const schools: SchoolScan[] = [{
    semel: home,
    name: '',
    home: true,
    ...(await siteHere(coolSite)),
    switched: null,
    children: [...homeList.map((c) => fromList(c, home)), ...externs.filter((e) => e.semel === home && !homeGuids.has(e.childGuid)).map(fromExtern)],
    externGuidsSeen: null,
  }];

  let moved = false;
  for (const [semel, listed] of others) {
    const name = listed[0]!.schoolName;
    const unreadable = listed.filter((e) => !e.bound).map(fromExtern);
    if (unreadable.length === listed.length) {
      schools.push({ semel, name, home: false, site: null, siteKnown: false, switched: null, children: unreadable, externGuidsSeen: null });
      continue;
    }
    moved = true;
    const answer = await changeSchool(kv, semel, fetchImpl, jar);
    const switched = { status: answer.status, reason: answer.reason };
    // Refused, or a yes that left the session elsewhere: nothing of this school was read.
    if (answer.status < 200 || answer.status >= 300 || (await stayedElsewhere(semel, jar))) {
      schools.push({ semel, name, home: false, site: null, siteKnown: false, switched, children: unreadable, externGuidsSeen: null });
      continue;
    }
    const seen = answer.view ? new Set(answer.view.children.map((c) => c.childGuid)) : null;
    schools.push({
      semel,
      name,
      home: false,
      ...(await siteHere(coolSite)),
      switched,
      children: [
        ...(answer.view?.children ?? []).map((c) => fromList({ guid: c.childGuid, firstName: c.privateName, classCode: c.classCode, classNum: c.classNum }, semel)),
        ...unreadable,
      ],
      externGuidsSeen: seen ? listed.every((e) => !e.bound || seen.has(e.childGuid)) : null,
    });
  }

  let back: ParentSchools['back'] = null;
  if (moved) {
    const answer = await changeSchool(kv, home, fetchImpl, jar);
    back = { status: answer.status, reason: answer.reason };
  }
  const scan: ParentSchools = { at: (deps.now ?? (() => new Date()))().toISOString(), home, schools, back };
  kv.set(PARENT_KEYS.schools, JSON.stringify(scan));
  return scan;
}

/** The last scan, or `null` before one. */
export function parentSchools(kv: Pick<KeyValue, 'getString'>): ParentSchools | null {
  try {
    const raw = kv.getString(PARENT_KEYS.schools);
    const kept = raw ? (JSON.parse(raw) as ParentSchools) : null;
    return kept && Array.isArray(kept.schools) && typeof kept.home === 'string' ? kept : null;
  } catch {
    return null;
  }
}

/**
 * Whether to scan again after a `loginDevice` (`run.ts`, once per login, so
 * at most one scan each): Mashov lists a child, at home or at another school,
 * the last scan does not hold; or the last scan found a child the parent's
 * login can read, not taken off the list, that no phone child is linked to
 * while the phone has room for it. That one waited (a question not answered,
 * a class list that did not come), and the next scan places it.
 */
export function scanNeeded(kv: Pick<KeyValue, 'getString'>): boolean {
  const kept = mashovChildren(kv);
  if (!kept) return false;
  const scan = parentSchools(kv);
  const scanned = new Set((scan?.schools ?? []).flatMap((s) => s.children.map((c) => c.guid)));
  if ([...kept.list.map((c) => c.guid), ...(kept.shape.externs ?? []).map((e) => e.childGuid)].some((g) => !scanned.has(g))) return true;
  const children = readChildren(kv);
  if ((children?.list.length ?? 1) >= MAX_FOLLOWED_CLASSES) return false;
  const shown = shownMashovLink(kv);
  const linked = new Set(children ? children.list.flatMap((c) => (c.mashov ? [c.mashov.guid] : [])) : shown ? [shown.guid] : []);
  const dismissed = new Set(dismissedGuids(kv));
  return (scan?.schools ?? []).some((s) => s.children.some((c) => c.bound && !dismissed.has(c.guid) && !linked.has(c.guid)));
}
