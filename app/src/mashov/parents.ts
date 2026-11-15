/**
 * Mashov for parents (parents mode, stage 3; docs/parents-plan.md §7): a
 * parent logs in to Mashov with the parent's own details, on the same login
 * page, and each child is read by the id Mashov gives it.
 *
 * Mashov's login answers (`/api/login`, `/api/login/mfa/verify`,
 * `/api/loginDevice`, `/api/changeSchool/…`) carry `accessToken.children[]`:
 * for each child a `childGuid`, names and a class (`classCode`, `classNum`).
 * The login page's script (`loginPagePatch` in `device.ts`) and the phone's
 * own `loginDevice` hand the answer here, and only the guid, the first name
 * and the class are kept, on the phone. The token's `UserId` is the parent's
 * own, so a parent's reads go by the guid of the child on screen: its link
 * when it has one, read in its school (`parentReadApi` in `parentSchools.ts`),
 * and before a scan matched by its class (`parentRead`). A student's reads
 * are as they were.
 *
 * All of it follows Mashov's public web client: nothing here was seen with a
 * real parent's account yet. The check (`parentCheck.ts`) is how a parent's
 * phone reports back.
 *
 * Pure: the storage is passed in.
 */
import type { UserSettings } from '@sederyom/shared';
import { AuthError } from '@sederyom/shared/logic/entities';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';
import { parseClassName } from '../lib/className';
import { PARENT_SCHOOLS_COPY } from '../lib/connections';
import { DISMISSED_KEY, ONLY_CHILD_LINK_KEY, shownMashovLink } from '../local/children';
import type { KeyValue } from './sync';

export const PARENT_KEYS = {
  /** The children the last login answer listed (`MashovChildren`). */
  children: 'mashov.parentChildren',
  /** The login page's answers, newest last (`LoginAnswer[]`), for the check. */
  answers: 'mashov.parentAnswers',
  /** Sessions that ended, and when they began (`SessionEnd[]`), for the check. */
  sessions: 'mashov.parentSessions',
  /** The check's last report (`ParentCheck`). */
  check: 'mashov.parentCheck',
  /** The scan of the schools a parent's Mashov lists (`ParentSchools`). */
  schools: 'mashov.parentSchools',
} as const;

/** A child as the phone keeps it: the id to read by, the first name and the class. */
export interface MashovChild {
  guid: string;
  firstName: string;
  classCode: string;
  classNum: string;
}

/** A child at another school (`externChildren`): the guid, first name, school and whether the parent's login is bound to the child. */
export interface ExternChild {
  childGuid: string;
  privateName: string;
  schoolName: string;
  /** The child's school, as text. */
  semel: string;
  bound: boolean;
}

/**
 * A login answer's `accessToken`, as the login page hands it over: the
 * children's guids, first names and classes, the children at other schools
 * with their schools, and otherwise only field names, counts, the two user
 * types and the school's switches for parents. Never the national ID number,
 * a family name, or any other value.
 */
export interface AccessTokenView {
  tokenFields: string[];
  children: { childGuid: string; privateName: string; classCode: string; classNum: string }[];
  childFields: string[];
  inactive: number;
  /** Children at another school (`externChildren`). */
  extern: number;
  externFields: string[];
  externs: ExternChild[];
  /** The session's school (`credential.semel`), as text. */
  semel: string | null;
  credentialFields: string[];
  userType: number | null;
  schoolUserType: number | null;
  /** The login's own user is one of the children: a student logged in. `null`: the answer did not say who. */
  userIsChild: boolean | null;
  /** The school's `hasParents…` switches. */
  parentOptions: Record<string, boolean>;
}

export interface MashovChildren {
  at: string;
  /** The answer that brought the list: `login`, `loginDevice`, `login/mfa/verify`, `changeSchool`, `idm/login`, or `page`, the page's own storage. */
  from: string;
  list: MashovChild[];
  /** The rest of the view, for the check. */
  shape: Omit<AccessTokenView, 'children'>;
}

/** One login answer the page saw: its kind, its status, Mashov's `Reason` header, and whether it carried a pass. */
export interface LoginAnswer {
  at: string;
  kind: string;
  status: number;
  reason: string | null;
  gotPass: boolean;
}

export interface SessionEnd {
  loginAt: string;
  /** When a read first found the session gone. */
  endedAt: string;
}

const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : [];

const fieldNames = (items: readonly Record<string, unknown>[]): string[] => [...new Set(items.flatMap((x) => Object.keys(x)))].sort();

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** A semel as text: a number or a non-empty string, else `''`. */
const semelText = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : '');

/**
 * The view of a login answer's body (`{ credential, accessToken }`), or `null`
 * when it has no `accessToken`. `ACCESS_TOKEN_VIEW_JS` is the same function
 * for the login page; the tests hold the two to one answer.
 */
export function accessTokenView(body: unknown): AccessTokenView | null {
  const b = body && typeof body === 'object' ? (body as { accessToken?: unknown; credential?: unknown }) : null;
  const t = b?.accessToken;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const token = t as Record<string, unknown>;
  const c = (b!.credential && typeof b!.credential === 'object' ? b!.credential : {}) as Record<string, unknown>;
  const kids = objects(token.children);
  const extern = objects(token.externChildren);
  const so = (token.schoolOptions && typeof token.schoolOptions === 'object' ? token.schoolOptions : {}) as Record<string, unknown>;
  const parentOptions: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(so)) if (/^hasParents/.test(k) && typeof v === 'boolean') parentOptions[k] = v;
  return {
    tokenFields: Object.keys(token).sort(),
    children: kids
      .filter((k) => typeof k.childGuid === 'string' && k.childGuid)
      .map((k) => ({ childGuid: k.childGuid as string, privateName: text(k.privateName), classCode: text(k.classCode), classNum: text(k.classNum) })),
    childFields: fieldNames(kids),
    inactive: objects(token.inactiveChildren).length,
    extern: extern.length,
    externFields: fieldNames(extern),
    externs: extern
      .filter((k) => typeof k.childGuid === 'string' && k.childGuid && semelText(k.semel))
      .map((k) => ({ childGuid: k.childGuid as string, privateName: text(k.privateName), schoolName: text(k.schoolName), semel: semelText(k.semel), bound: k.bound === true })),
    semel: semelText(c.semel) || null,
    credentialFields: Object.keys(c).sort(),
    userType: typeof c.userType === 'number' ? c.userType : null,
    schoolUserType: typeof c.schoolUserType === 'number' ? c.schoolUserType : null,
    userIsChild: typeof c.userId === 'string' ? kids.some((k) => k.childGuid === c.userId) : null,
    parentOptions,
  };
}

/** `accessTokenView` for the login page: plain ES5, defined as `sederyomView`. */
export const ACCESS_TOKEN_VIEW_JS = `function sederyomView(body) {
    var t = body && typeof body === 'object' ? body.accessToken : null;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    var c = body.credential && typeof body.credential === 'object' ? body.credential : {};
    var list = function (v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; };
    var names = function (items) {
      var seen = {};
      items.forEach(function (x) { Object.keys(x).forEach(function (k) { seen[k] = 1; }); });
      return Object.keys(seen).sort();
    };
    var text = function (v) { return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''; };
    var semelText = function (v) { return typeof v === 'number' && isFinite(v) ? String(v) : typeof v === 'string' ? v : ''; };
    var kids = list(t.children), extern = list(t.externChildren);
    var so = t.schoolOptions && typeof t.schoolOptions === 'object' ? t.schoolOptions : {}, options = {};
    Object.keys(so).forEach(function (k) { if (/^hasParents/.test(k) && typeof so[k] === 'boolean') options[k] = so[k]; });
    return {
      tokenFields: Object.keys(t).sort(),
      children: kids.filter(function (k) { return typeof k.childGuid === 'string' && k.childGuid; }).map(function (k) {
        return { childGuid: k.childGuid, privateName: text(k.privateName), classCode: text(k.classCode), classNum: text(k.classNum) };
      }),
      childFields: names(kids),
      inactive: list(t.inactiveChildren).length,
      extern: extern.length,
      externFields: names(extern),
      externs: extern.filter(function (k) { return typeof k.childGuid === 'string' && k.childGuid && semelText(k.semel); }).map(function (k) {
        return { childGuid: k.childGuid, privateName: text(k.privateName), schoolName: text(k.schoolName), semel: semelText(k.semel), bound: k.bound === true };
      }),
      semel: semelText(c.semel) || null,
      credentialFields: Object.keys(c).sort(),
      userType: typeof c.userType === 'number' ? c.userType : null,
      schoolUserType: typeof c.schoolUserType === 'number' ? c.schoolUserType : null,
      userIsChild: typeof c.userId === 'string' ? kids.some(function (k) { return k.childGuid === c.userId; }) : null,
      parentOptions: options
    };
  }`;

/** A field name worth reporting: an identifier, and not an id written as one (a long run of hex). */
export const isFieldName = (k: string): boolean => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k) && !/^[0-9a-f]{16,}$/i.test(k);

const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isFieldName(x)) : []);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const userType = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** A view as the page posted it, checked field by field; `null` when it is not one. */
export function readView(value: unknown): AccessTokenView | null {
  const v = value && typeof value === 'object' ? (value as Partial<Record<keyof AccessTokenView, unknown>>) : null;
  if (!v || !Array.isArray(v.children)) return null;
  const children = objects(v.children)
    .filter((c) => typeof c.childGuid === 'string' && c.childGuid)
    .map((c) => ({
      childGuid: (c.childGuid as string).slice(0, 80),
      privateName: text(c.privateName).slice(0, 40),
      classCode: text(c.classCode).slice(0, 12),
      classNum: text(c.classNum).slice(0, 6),
    }))
    .slice(0, 12);
  const externs = objects(v.externs)
    .filter((e) => typeof e.childGuid === 'string' && e.childGuid && semelText(e.semel))
    .map((e) => ({
      childGuid: (e.childGuid as string).slice(0, 80),
      privateName: text(e.privateName).slice(0, 40),
      schoolName: text(e.schoolName).slice(0, 60),
      semel: semelText(e.semel).slice(0, 20),
      bound: e.bound === true,
    }))
    .slice(0, 12);
  const parentOptions: Record<string, boolean> = {};
  if (v.parentOptions && typeof v.parentOptions === 'object') {
    for (const [k, b] of Object.entries(v.parentOptions as Record<string, unknown>)) {
      if (/^hasParents[A-Za-z]{0,40}$/.test(k) && typeof b === 'boolean') parentOptions[k] = b;
    }
  }
  return {
    tokenFields: names(v.tokenFields),
    children,
    childFields: names(v.childFields),
    inactive: count(v.inactive),
    extern: count(v.extern),
    externFields: names(v.externFields),
    externs,
    semel: semelText(v.semel).slice(0, 20) || null,
    credentialFields: names(v.credentialFields),
    userType: userType(v.userType),
    schoolUserType: userType(v.schoolUserType),
    userIsChild: typeof v.userIsChild === 'boolean' ? v.userIsChild : null,
    parentOptions,
  };
}

function load<T>(kv: Pick<KeyValue, 'getString'>, key: string): T | null {
  try {
    const raw = kv.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** The children Mashov's last login answer listed, or `null` before one did. */
export function mashovChildren(kv: Pick<KeyValue, 'getString'>): MashovChildren | null {
  const kept = load<MashovChildren>(kv, PARENT_KEYS.children);
  return kept && Array.isArray(kept.list) && typeof kept.at === 'string' ? kept : null;
}

/**
 * Keeps a login answer's list in place of the one before. The page's own
 * storage may still hold a token from before the login, so a view from it
 * never empties a list an answer brought.
 */
export function keepChildren(kv: KeyValue, view: AccessTokenView, from: string, now: Date = new Date()): void {
  if (from === 'page' && view.children.length === 0) return;
  const { children, ...shape } = view;
  const kept: MashovChildren = {
    at: now.toISOString(),
    from,
    list: children.map((c) => ({ guid: c.childGuid, firstName: c.privateName, classCode: c.classCode, classNum: c.classNum })),
    shape,
  };
  kv.set(PARENT_KEYS.children, JSON.stringify(kept));
}

/** A login answer's body the phone read itself (`loginWithDevicePass`); `false` when it held no `accessToken`. */
export function takeLoginBody(kv: KeyValue, body: unknown, from: string, now: Date = new Date()): boolean {
  const view = readView(accessTokenView(body));
  if (!view) return false;
  keepChildren(kv, view, from, now);
  return true;
}

const MAX_ANSWERS = 15;

export function loginAnswers(kv: Pick<KeyValue, 'getString'>): LoginAnswer[] {
  const kept = load<LoginAnswer[]>(kv, PARENT_KEYS.answers);
  return Array.isArray(kept) ? kept : [];
}

/** Mashov's `Reason` header, cut to what such a code can hold. */
export function reasonOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, 60).replace(/[^A-Za-z0-9_.-]/g, '?');
}

export function noteAnswer(kv: KeyValue, answer: LoginAnswer): void {
  kv.set(PARENT_KEYS.answers, JSON.stringify([...loginAnswers(kv), answer].slice(-MAX_ANSWERS)));
}

/**
 * A message from the login page: `true` when it was one of this module's
 * (`sederyom-mashov-children`, `sederyom-parent-answer`), kept on the phone.
 */
export function takeParentMessage(kv: KeyValue, data: string, now: Date = new Date()): boolean {
  if (!data.startsWith('{')) return false;
  let msg: { type?: unknown; from?: unknown; view?: unknown; kind?: unknown; status?: unknown; reason?: unknown; gotPass?: unknown };
  try {
    msg = JSON.parse(data) as typeof msg;
  } catch {
    return false;
  }
  if (msg.type === 'sederyom-mashov-children') {
    const view = readView(msg.view);
    const from = typeof msg.from === 'string' && /^[A-Za-z/]{1,40}$/.test(msg.from) ? msg.from : 'page';
    if (view) keepChildren(kv, view, from, now);
    return true;
  }
  if (msg.type === 'sederyom-parent-answer') {
    if (typeof msg.kind === 'string' && /^[A-Za-z/]{1,40}$/.test(msg.kind) && typeof msg.status === 'number') {
      noteAnswer(kv, { at: now.toISOString(), kind: msg.kind, status: msg.status, reason: reasonOf(msg.reason), gotPass: msg.gotPass === true });
    }
    return true;
  }
  return false;
}

/** A class as one key, grade and number, from a site's class name or Mashov's code and number; `null` without both. */
export function classKeyOf(name: string): string | null {
  const { grade, number } = parseClassName(name);
  return grade && number !== null ? `${grade}|${number}` : null;
}

/** Mashov's class for a child, as one name: "יא" and "2" are "יא 2". */
export const mashovClassName = (child: Pick<MashovChild, 'classCode' | 'classNum'>): string => `${child.classCode} ${child.classNum}`.trim();

/**
 * Who among Mashov's children a class on the phone is, and how that was
 * decided; or why no one is. `link`: the child on screen's own link, read in
 * its school (`semel`).
 */
export type ChildPick =
  | { guid: string; by: 'class' | 'only' }
  | { guid: string; by: 'link'; semel: string }
  | { missing: 'none' | 'several' | 'notFound' };

/**
 * The Mashov child in the class on screen. On a phone with one child,
 * Mashov's only child is that child even when its class reads otherwise.
 * Never a guess between two: twins in one class are `several`.
 */
export function childFor(list: readonly MashovChild[], className: string, onlyChild: boolean): ChildPick {
  const key = classKeyOf(className);
  const same = key ? list.filter((c) => classKeyOf(mashovClassName(c)) === key) : [];
  if (same.length === 1) return { guid: same[0]!.guid, by: 'class' };
  if (same.length > 1) return { missing: 'several' };
  if (onlyChild && list.length === 1) return { guid: list[0]!.guid, by: 'only' };
  return { missing: 'none' };
}

/** Whether the schools a parent's Mashov lists were scanned (`parentSchools.ts`, which imports this module). */
function scanned(kv: Pick<KeyValue, 'getString'>): boolean {
  const kept = load<{ home?: unknown; schools?: unknown }>(kv, PARENT_KEYS.schools);
  return Boolean(kept) && Array.isArray(kept!.schools) && typeof kept!.home === 'string';
}

/**
 * Whom a read is for: on a parent's phone, the child on screen; `null` to
 * read as the login's own user, on a student's phone or when Mashov gave no
 * list (a parent who logged in with the child's details). `onlyChild`: the
 * phone has no list of children (`children.ts`).
 *
 * A child linked to Mashov is read by its own guid, in its own school, and
 * never by its class. Once a scan exists, a child with no link is read as
 * nobody: the class on screen could be another school's child in the same
 * class, and "the only child" too may be another school's. That is
 * `notFound`, which says it of the child; `none` is the class with no child.
 */
export function parentRead(kv: Pick<KeyValue, 'getString'>, settings: Pick<UserSettings, 'audience' | 'className'>, onlyChild: boolean): ChildPick | null {
  if (settings.audience !== 'parent') return null;
  const link = shownMashovLink(kv);
  if (link) return { guid: link.guid, by: 'link', semel: link.semel };
  if (scanned(kv)) return { missing: 'notFound' };
  const children = mashovChildren(kv);
  if (!children || children.list.length === 0) return null;
  return childFor(children.list, settings.className, onlyChild);
}

/** Why a parent's read did not run: kept as the read's error, and shown in מצב חיבורים. */
export const PARENT_READ_COPY = {
  none: 'במשוב אין ילד או ילדה בכיתה שמופיעה עכשיו',
  several: 'במשוב רשומים כמה ילדים בכיתה שמופיעה עכשיו, ועוד לא ברור מי מהם',
} as const;

export class ParentReadError extends Error {
  constructor(missing: keyof typeof PARENT_READ_COPY | 'notFound') {
    super(missing === 'notFound' ? PARENT_SCHOOLS_COPY.notFound : PARENT_READ_COPY[missing]);
    this.name = 'ParentReadError';
  }
}

/**
 * Mashov would not move the session to the child's school (`changeSchool`
 * refused): nothing is read, and the last read stays. The session itself is
 * alive, so it is not "Mashov disconnected". The message is one of
 * `PARENT_SCHOOLS_COPY`'s `bindGone`, `changePass` or `refused`.
 */
export class ParentSchoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParentSchoolError';
  }
}

/**
 * The messages a `ParentSchoolError` can carry, as patterns: each copy with
 * its names left open, since the read's error comes back from storage as
 * text. Only these three (and `notFound`, which has no names, in
 * `isParentReadError`): the same copy object holds lines that are not a
 * read's error.
 */
const SCHOOL_ERROR_SHAPES: readonly RegExp[] = (() => {
  const slot = '\u0000';
  const shape = (text: string) => new RegExp(`^${text.split(slot).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`);
  return [
    PARENT_SCHOOLS_COPY.bindGone(slot),
    PARENT_SCHOOLS_COPY.changePass(slot),
    PARENT_SCHOOLS_COPY.refused(slot),
    PARENT_SCHOOLS_COPY.refused(slot, slot),
  ].map(shape);
})();

/** Whether a read's error is a school's refusal to move the session (`ParentSchoolError`'s messages). */
export function isParentSchoolError(message: string | null | undefined): boolean {
  return Boolean(message) && SCHOOL_ERROR_SHAPES.some((s) => s.test(message!));
}

/** A read's error that is a parent's, not Mashov's: no child to read, or a school that refused. */
export function isParentReadError(message: string | null | undefined): boolean {
  if (!message) return false;
  return Object.values(PARENT_READ_COPY).some((m) => m === message) || message === PARENT_SCHOOLS_COPY.notFound
    || isParentSchoolError(message);
}

/**
 * A child's read for a parent. A school can close a part of Mashov to
 * parents (`hasParents…`): a 403 on one of the child's own paths then empties
 * that part, instead of reading as a login Mashov refused. The session's own
 * end still fails the read, since the parent's inbox and the bells fail with
 * it. The check reports which path said 403.
 */
export function forParent(api: MashovApi): MashovApi {
  const soft = (read: () => Promise<unknown[]>) => async (): Promise<unknown[]> => {
    try {
      return await read();
    } catch (err) {
      if (err instanceof AuthError && /\b403\b/.test(err.message)) return [];
      throw err;
    }
  };
  return { ...api, timetable: soft(api.timetable), homework: soft(api.homework), grades: soft(api.grades), groups: soft(api.groups) };
}

export function sessionEnds(kv: Pick<KeyValue, 'getString'>): SessionEnd[] {
  const kept = load<SessionEnd[]>(kv, PARENT_KEYS.sessions);
  return Array.isArray(kept) ? kept : [];
}

/** How long a parent's session lasted: noted once, when a read first finds it gone. */
export function noteSessionEnd(kv: KeyValue, status: { needsLogin: boolean; failedAt?: string | null; loginAt?: string | null }): void {
  if (!status.needsLogin || !status.failedAt || !status.loginAt) return;
  const ends = sessionEnds(kv);
  if (ends.some((e) => e.endedAt === status.failedAt)) return;
  kv.set(PARENT_KEYS.sessions, JSON.stringify([...ends, { loginAt: status.loginAt, endedAt: status.failedAt }].slice(-6)));
}

/**
 * "ניתוק": the list goes with the login, and with it the scan of the schools,
 * the children the parent took off the list and the lone child's link. The
 * answers and the check stay, for the next report.
 */
export function forgetParentLogin(kv: KeyValue): void {
  kv.set(PARENT_KEYS.children, '');
  kv.set(PARENT_KEYS.schools, '');
  kv.set(DISMISSED_KEY, '');
  kv.set(ONLY_CHILD_LINK_KEY, '');
}
