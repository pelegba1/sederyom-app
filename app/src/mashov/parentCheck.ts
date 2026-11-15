/**
 * The check a parent's phone runs on Mashov (parents mode, stage 3;
 * docs/parents-plan.md §7, "רשימת בדיקה להורה הבודק"): the checklist's ten
 * items, as far as the phone can tell them by itself, in one short report
 * the parent sends.
 *
 * The report holds no names, grades, ID numbers or ids: field names, status
 * codes, Mashov's `Reason` codes, how many items each answer brought, how
 * classes are written (each letter as א, each digit as 9), times, and the
 * school's switches for parents. Schools are told by their order (`school 2`),
 * never by `semel` or name. The guids it reads by stay on the phone.
 *
 * It reads each child's paths once, the GETs Mashov's own site makes for a
 * parent, and nothing else is written to Mashov. The lines are English,
 * apart from the two at the top that tell the parent what is in it: the
 * report goes to the developer, and Hebrew and English mixed in one line come
 * out scrambled in a chat.
 */
import { MASHOV_PATHS } from '@sederyom/shared/logic/mashov/api';
import { AUTH_COOKIE, CSRF_COOKIE, base64UrlToUtf8, parseMashovToken } from '@sederyom/shared/logic/mashov/session';
import { addDays, todayStr } from '@sederyom/shared/logic/time';
import { MASHOV_ORIGIN } from '../config';
import { PARENT_SCHOOLS_COPY } from '../lib/connections';
import { dismissedGuids } from '../local/children';
import { deviceLoginMode, deviceLoginState, hasDevicePass } from './device';
import {
  PARENT_KEYS, isFieldName, isParentReadError, isParentSchoolError, loginAnswers, mashovChildren, mashovClassName, sessionEnds,
} from './parents';
import type { ChangeSchoolAnswer, ParentSchools, SchoolScan } from './parentSchools';
import { localRead, localStatus, type KeyValue } from './sync';

export interface ParentCheck {
  at: string;
  text: string;
}

export interface ParentCheckDeps {
  kv: KeyValue;
  fetchImpl: typeof fetch;
  jar: () => Promise<Record<string, string>>;
  /** The phone's children, the one on screen first; one on a phone with no list. `link`: its Mashov link, counted per school and never written. */
  phoneChildren: readonly { className: string; link: { guid: string; semel: string } | null; withoutSite: boolean }[];
  /** The last scan of the parent's schools, or `null` before one. */
  schools: () => ParentSchools | null;
  /** Moves the session to a school (`ensureSchool`): `null` when it is there already. Runs under the caller's session lock. */
  ensureSchool: (semel: string) => Promise<ChangeSchoolAnswer | null>;
  audience: string;
  appVersion: string;
  zone: string;
  now?: () => Date;
}

const TIMEOUT_MS = 20_000;

/** What the parent reads before sending. */
export const REPORT_HEAD = [
  'סדר יום: בדיקת משוב להורים',
  'אין בדוח שמות, ציונים, מספרי זהות או מזהים. יש בו שמות של שדות, קודים של תשובות, וכמה פריטים הגיעו.',
] as const;

/** How a class is written, without which class it is: each Hebrew letter as א, each digit as 9. */
export function classShape(name: string): string {
  return name.replace(/[א-ת]/g, 'א').replace(/\d/g, '9').trim().slice(0, 24);
}

/** The field names of a few items of a list, or of an object. */
function fieldsOf(items: readonly unknown[]): string {
  const names = [...new Set(items.flatMap((x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : [])))]
    .filter(isFieldName)
    .sort()
    .slice(0, 30);
  return names.length > 0 ? ` [${names.join(',')}]` : '';
}

/** An answer's body, said without any of its values. */
export function describeBody(text: string): string {
  const t = text.trimStart();
  if (!t) return 'empty';
  if (t.startsWith('<')) return 'html';
  try {
    const v: unknown = JSON.parse(t);
    if (Array.isArray(v)) return `list ${v.length}${fieldsOf(v.slice(0, 3))}`;
    if (v && typeof v === 'object') return `object${fieldsOf([v])}`;
    return typeof v;
  } catch {
    return 'text';
  }
}

/** An error without the ids in it: a read's error may name the path it read. */
export function withoutIds(text: string): string {
  return text
    .replace(/\/students\/[^/\s]+/g, '/students/<id>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .slice(0, 160);
}

/** The names of the auth token's claims, never their values. */
export function claimNames(jwt: string): string[] {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return [];
    const json: unknown = JSON.parse(base64UrlToUtf8(payload));
    return json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).filter(isFieldName).sort() : [];
  } catch {
    return [];
  }
}

const list = (names: readonly string[]): string => (names.length > 0 ? `[${names.join(',')}]` : '[]');
const yes = (b: boolean | null | undefined): string => (b === null || b === undefined ? '?' : b ? 'yes' : 'no');

/** A school switch's answer as a status and, when Mashov gave one, its `Reason`. */
const switchText = (a: { status: number; reason: string | null }): string => `${a.status}${a.reason ? ` ${a.reason}` : ''}`;

/** What the phone line says of a read's error: which kind, never a name. */
function readErrorKind(error: string): string {
  if (error === PARENT_SCHOOLS_COPY.notFound) return 'not linked';
  if (isParentSchoolError(error)) return 'school refused';
  return isParentReadError(error) ? 'no single child in the class on screen' : withoutIds(error);
}

/** The phone's links and the children taken off its list, for the count per school. */
interface PhoneLinks {
  links: readonly { guid: string; semel: string }[];
  dismissed: ReadonlySet<string>;
}

/**
 * One school of the scan, said by its position and counts: no `semel`, no
 * name. `added`: the phone's children linked to the school; `later`: the
 * school's children the login can read that no phone child is linked to,
 * the ones taken off the list aside.
 */
function schoolLine(school: SchoolScan, n: number, phone: PhoneLinks): string {
  const linked = new Set(phone.links.map((l) => l.guid));
  const parts = [
    ...(school.switched ? [`changeSchool ${switchText(school.switched)}`] : []),
    `children ${school.children.length}`,
    `bound ${school.children.filter((c) => c.bound).length}`,
    `added ${phone.links.filter((l) => l.semel === school.semel).length}`,
    `later ${school.children.filter((c) => c.bound && !linked.has(c.guid) && !phone.dismissed.has(c.guid)).length}`,
    ...(school.externGuidsSeen === null ? [] : [`guids seen ${yes(school.externGuidsSeen)}`]),
    ...(school.siteKnown ? [`site ${yes(school.site !== null)}`] : []),
  ];
  return `school ${n}${school.home ? ' home' : ''}: ${parts.join(', ')}`;
}

function hours(from: string | null | undefined, to: Date): string {
  const h = from ? (to.getTime() - Date.parse(from)) / 3_600_000 : NaN;
  return Number.isFinite(h) ? `${h.toFixed(1)}h` : '?';
}

export function storedCheck(kv: Pick<KeyValue, 'getString'>): ParentCheck | null {
  try {
    const raw = kv.getString(PARENT_KEYS.check);
    const v = raw ? (JSON.parse(raw) as ParentCheck) : null;
    return v && typeof v.text === 'string' && typeof v.at === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Runs the check, keeps its report, and gives it back. Never throws for one item that failed: the line says so. */
export async function runParentCheck(deps: ParentCheckDeps): Promise<ParentCheck> {
  const now = deps.now?.() ?? new Date();
  const jar = await deps.jar().catch(() => ({} as Record<string, string>));
  const csrf = jar[CSRF_COOKIE] ?? null;

  const get = async (path: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(`${MASHOV_ORIGIN}${path}`, {
        credentials: 'include',
        signal: controller.signal,
        headers: { accept: 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      });
      return `${res.status} ${describeBody(await res.text().catch(() => ''))}`;
    } catch (err) {
      return `error ${err instanceof Error ? err.name : 'unknown'}`;
    } finally {
      clearTimeout(timer);
    }
  };
  const lines: string[] = [];
  const item = async (n: number | string, f: () => string | string[] | Promise<string | string[]>): Promise<void> => {
    try {
      const out = await f();
      for (const [i, text] of (Array.isArray(out) ? out : [out]).entries()) lines.push(i === 0 ? `${n}. ${text}` : `   ${text}`);
    } catch (err) {
      lines.push(`${n}. error ${withoutIds(err instanceof Error ? err.message : String(err))}`);
    }
  };

  const token = jar[AUTH_COOKIE] ? parseMashovToken(`${AUTH_COOKIE}=${jar[AUTH_COOKIE]}`) : null;
  const kids = mashovChildren(deps.kv);
  const children = kids?.list ?? [];
  const answers = loginAnswers(deps.kv);
  const userIsChild = token ? children.some((c) => c.guid === token.userId) : null;
  const timetables: string[] = [];

  await item(1, () => [
    `login answers: ${answers.length === 0 ? 'none seen' : answers.slice(-8).map((a) => `${a.kind} ${a.status}${a.gotPass ? ' pass' : ''}${a.reason ? ` ${a.reason}` : ''} ${hours(a.at, now)} ago`).join('; ')}`,
  ]);
  await item(2, () => [
    `token: cookie ${yes(Boolean(token))}; claims ${list(jar[AUTH_COOKIE] ? claimNames(jar[AUTH_COOKIE]) : [])}; UserId is a child: ${kids ? yes(userIsChild) : 'no list'}`,
    `Semel ${yes(token ? token.schoolId !== null : null)}, Year ${yes(token ? token.year !== null : null)}, LoginTime ${yes(token ? token.loginAt !== null : null)}; logged in ${hours(token?.loginAt?.toISOString(), now)} ago; expires in ${token?.expiresAt ? `${((token.expiresAt.getTime() - now.getTime()) / 3_600_000).toFixed(1)}h` : '?'}`,
    `cookies ${list(Object.keys(jar).filter((k) => /^[A-Za-z0-9_.-]{1,40}$/.test(k)).sort())}`,
  ]);
  await item(3, () => {
    if (!kids) return 'no accessToken seen';
    const s = kids.shape;
    return [
      `accessToken from ${kids.from}, ${hours(kids.at, now)} ago: fields ${list(s.tokenFields)}`,
      `children ${children.length}, inactive ${s.inactive}, extern ${s.extern}; child fields ${list(s.childFields)}; extern fields ${list(s.externFields)}`,
      `credential ${list(s.credentialFields)}; userType ${s.userType ?? '?'}; schoolUserType ${s.schoolUserType ?? '?'}; user is a child: ${yes(s.userIsChild)}`,
      `classes: ${children.map((c) => classShape(mashovClassName(c)) || '?').join(' | ') || '-'}`,
    ];
  });
  await item(4, async () => {
    // With a scan, each child is read in its own school; without one, the home list as before.
    const scan = deps.schools();
    const plan = scan
      ? scan.schools.map((school, i) => ({ school, n: i + 1, guids: school.children.filter((c) => c.bound).map((c) => c.guid) }))
      : [{ school: null, n: 0, guids: children.map((c) => c.guid) }];
    if (plan.every((p) => p.guids.length === 0)) return 'no children to read';
    const today = todayStr(deps.zone);
    const out: string[] = [];
    let count = 0;
    let back: ChangeSchoolAnswer | null = null;
    try {
      for (const { school, n, guids } of plan) {
        const answer = school && guids.length > 0 ? await deps.ensureSchool(school.semel) : null;
        const refused = answer && (answer.status < 200 || answer.status >= 300) ? answer : null;
        for (const g of guids) {
          count += 1;
          const label = `child ${count}${school ? ` (school ${n})` : ''}`;
          if (refused) {
            timetables.push('-');
            out.push(`${label}: not read, changeSchool ${switchText(refused)}`);
            continue;
          }
          const paths: [string, string][] = [
            ['timetable', MASHOV_PATHS.timetable(g)],
            ['changes', MASHOV_PATHS.timetableChanges(g, today, addDays(today, 7, deps.zone))],
            ['homework', MASHOV_PATHS.homework(g)],
            ['grades', MASHOV_PATHS.grades(g)],
            ['behave', MASHOV_PATHS.behave(g)],
            ['lessonsCount', MASHOV_PATHS.lessonsCount(g)],
            ['groups', MASHOV_PATHS.groups(g)],
            ['bagrut', MASHOV_PATHS.bagrutGrades(g)],
          ];
          const answered = await Promise.all(paths.map(async ([name, path]) => `${name} ${await get(path)}`));
          timetables.push(answered[0]!.split(' ')[1] ?? '?');
          out.push(`${label}: ${answered.join('; ')}`);
        }
      }
    } finally {
      // The trip home always happens: items 5 and 9 and the phone's next read go by the home school's session.
      // A failure of the trip itself never hides the error that cut the reading short.
      if (scan) back = await deps.ensureSchool(scan.home).catch(() => ({ status: 0, reason: 'error', view: null }));
    }
    if (back) out.push(`back home: changeSchool ${switchText(back)}`);
    return out;
  });
  await item(5, async () => {
    if (!token) return 'own id: no token';
    if (userIsChild) return 'own id: skipped, UserId is a child';
    return `own id: timetable ${await get(MASHOV_PATHS.timetable(token.userId))}`;
  });
  await item(6, () => {
    const options = Object.entries(kids?.shape.parentOptions ?? {}).map(([k, v]) => `${k}=${v}`);
    return `hasParents: ${options.length > 0 ? options.join(', ') : 'none in the answer'}`;
  });
  await item(7, () => {
    const { lastLogin, lastTry } = deviceLoginState(deps.kv);
    return [
      `device: mode ${deviceLoginMode(deps.kv)}; pass kept ${yes(hasDevicePass(deps.kv))}`,
      `last ticked login: ${lastLogin ? `${lastLogin.status} pass ${yes(lastLogin.gotPass)} ${hours(lastLogin.at, now)} ago` : 'none'}; last loginDevice: ${lastTry ? `${lastTry.ok ? 'ok' : 'refused'} ${lastTry.detail.split(' ').slice(0, 2).join(' ')} ${hours(lastTry.at, now)} ago` : 'none'}`,
    ];
  });
  await item(8, () => {
    const ok = timetables.filter((s) => s === '200').length;
    return `one session for every child: ${timetables.length === 0 ? '-' : `${yes(ok === timetables.length)} (${ok} of ${timetables.length} timetables 200)`}; other schools ${kids?.shape.extern ?? '?'}`;
  });
  await item(9, async () => `mail: ${await get(MASHOV_PATHS.mail(0))}`);
  await item(10, () => {
    const reasons = [...new Set(answers.map((a) => a.reason).filter((r): r is string => Boolean(r)))];
    const ends = sessionEnds(deps.kv).map((e) => hours(e.loginAt, new Date(e.endedAt)));
    return `reasons: ${reasons.length > 0 ? reasons.join(', ') : 'none'}; sessions ended after: ${ends.length > 0 ? ends.join(', ') : 'none yet'}`;
  });
  await item('phone', () => {
    const status = localStatus(deps.kv);
    const read = localRead(deps.kv);
    const picks = deps.phoneChildren.map((child, i) =>
      `${i + 1}${i === 0 ? ' (on screen)' : ''} ${classShape(child.className) || '?'} -> ${child.link ? 'by link' : 'not linked'}, ${child.withoutSite ? 'no site' : 'site'}`);
    const error = status.lastError ? readErrorKind(status.lastError) : 'none';
    const c = read?.counts;
    return [
      `${deps.audience}; children on the phone: ${picks.join('; ')}`,
      `last read ok ${status.lastOkAt ? `${hours(status.lastOkAt, now)} ago` : 'never'}; needs login ${yes(status.needsLogin)}; error: ${error}`,
      c ? `read: slots ${c.slots}, homework ${c.homework}, grades ${c.grades}, mail ${c.mail}, attendance ${c.attendance ?? '-'}, changes ${c.timetableChanges ?? '-'}` : 'read: none kept',
    ];
  });

  await item(11, () => {
    const scan = deps.schools();
    if (!scan) return 'schools: none scanned';
    const phone: PhoneLinks = { links: deps.phoneChildren.flatMap((c) => (c.link ? [c.link] : [])), dismissed: new Set(dismissedGuids(deps.kv)) };
    return `schools ${scan.schools.length}; ${[...scan.schools.map((school, i) => schoolLine(school, i + 1, phone)), ...(scan.back ? [`back home ${switchText(scan.back)}`] : [])].join('; ')}`;
  });

  const check: ParentCheck = {
    at: now.toISOString(),
    text: [...REPORT_HEAD, `SederYom ${deps.appVersion} parent check ${now.toISOString()}`, '', ...lines].join('\n'),
  };
  deps.kv.set(PARENT_KEYS.check, JSON.stringify(check));
  return check;
}
