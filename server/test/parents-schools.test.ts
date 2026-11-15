/**
 * Parents at other schools (docs/superpowers/specs/2026-11-02-parents-other-schools-design.md §2, §4.1):
 * a parent's login answer lists the children at other schools (`externChildren`);
 * the phone keeps each one's guid, first name, school name, `semel` and whether
 * it is `bound`, and never a family name.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClassOption, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import type { ParentSchools, ScannedChild, SchoolScan } from '../../app/src/mashov/parentSchools';
import type { PhoneChild } from '../../app/src/local/childrenFromMashov';

vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  ACCESS_TOKEN_VIEW_JS, PARENT_KEYS, PARENT_READ_COPY, ParentReadError, ParentSchoolError, accessTokenView, isParentReadError, keepChildren, mashovChildren,
  parentRead, readView,
} = await import('../../app/src/mashov/parents');
const { DEVICE_KEYS, deviceLoginFields } = await import('../../app/src/mashov/device');
const { mashovSessionIdle, withMashovSession } = await import('../../app/src/mashov/lock');
const {
  changeSchool, ensureSchool, parentReadApi, parentSchools, scanNeeded, scanParentSchools, schoolSwitchError, sessionSemel,
} = await import('../../app/src/mashov/parentSchools');
const { KEYS, localRead, localStatus, syncMashov } = await import('../../app/src/mashov/sync');
const { PARENT_SCHOOLS_COPY } = await import('../../app/src/lib/connections');
const { applyChildrenPlan, askOptionLabel, dropLinkOffClass, planChildren, readErrorNow, scanSummary, unboundLines } = await import('../../app/src/local/childrenFromMashov');
const { CHILDREN_KEY, DISMISSED_KEY, ONLY_CHILD_LINK_KEY, linkChild, readChildren, renameChild, shownMashovLink, stashKey } = await import('../../app/src/local/children');
const { SETTINGS_KEYS } = await import('../../app/src/local/keyMigrations');
const { SCHOOL_SITE_KEYS, isWithoutSite, pastedSite } = await import('../../app/src/local/schoolSite');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}

/** A login answer of a parent whose second child is at another school. */
function answer(extern: unknown[], semel: unknown = 111222) {
  return {
    credential: { userId: 'parent-guid', userType: 4, semel },
    accessToken: {
      children: [{ childGuid: 'g1', privateName: 'יואב', familyName: 'כהן', classCode: 'ח', classNum: 1, schoolName: 'תיכון א' }],
      externChildren: extern,
    },
  };
}

const NOA = { childGuid: 'g2', privateName: 'נועה', familyName: 'X', schoolName: 'תיכון ב', semel: 440123, bound: true };

describe('the children at other schools in a login answer', () => {
  it('keeps the children at other schools, each with its school and whether it is bound', () => {
    const view = accessTokenView(answer([NOA]))!;
    expect(view.externs).toEqual([{ childGuid: 'g2', privateName: 'נועה', schoolName: 'תיכון ב', semel: '440123', bound: true }]);
    expect(view.semel).toBe('111222');
    expect(view.extern).toBe(1);
    expect(JSON.stringify(view)).not.toContain('X');
  });

  it('writes a semel as text', () => {
    const view = accessTokenView(answer([{ ...NOA, semel: 440123 }, { ...NOA, childGuid: 'g3', semel: '440123' }], '111222'))!;
    expect(view.externs.map((e) => e.semel)).toEqual(['440123', '440123']);
    expect(view.semel).toBe('111222');
  });

  it('drops a child without a guid or without a semel, and says nothing about the session when it has no semel', () => {
    const view = accessTokenView(answer([{ ...NOA, childGuid: '' }, { ...NOA, childGuid: 'g4', semel: undefined }, { ...NOA, childGuid: 'g5', semel: '' }, { ...NOA, childGuid: 'g6', bound: 'yes' }], null))!;
    expect(view.externs).toEqual([{ childGuid: 'g6', privateName: 'נועה', schoolName: 'תיכון ב', semel: '440123', bound: false }]);
    expect(view.semel).toBeNull();
  });

  it('is the same in the login page as on the phone', () => {
    const pageView = new Function(`${ACCESS_TOKEN_VIEW_JS}; return sederyomView;`)() as (b: unknown) => unknown;
    const bodies = [
      answer([NOA]),
      answer([NOA, { ...NOA, childGuid: 'g3', semel: '440123', bound: false }, { ...NOA, childGuid: '' }, { childGuid: 'g7', semel: 7 }], '111222'),
      answer([NOA], null),
      answer([]),
    ];
    for (const body of bodies) expect(pageView(body)).toEqual(accessTokenView(body));
  });

  it('checks posted externs field by field', () => {
    const base = accessTokenView(answer([]))!;
    const long = 'ש'.repeat(100);
    const posted = {
      ...base,
      semel: '111222',
      externs: [
        { childGuid: 'g2', privateName: 'נועה', schoolName: long, semel: '440123', bound: true, familyName: 'X' },
        { privateName: 'no guid', schoolName: 'a', semel: '1', bound: true },
        { childGuid: 'g3', privateName: 'עדי', schoolName: 'b', semel: '5', bound: 'true' },
        { childGuid: 'g4', privateName: 'דן', schoolName: 'c', semel: '', bound: true },
      ],
    };
    const view = readView(posted)!;
    expect(view.externs).toEqual([
      { childGuid: 'g2', privateName: 'נועה', schoolName: 'ש'.repeat(60), semel: '440123', bound: true },
      { childGuid: 'g3', privateName: 'עדי', schoolName: 'b', semel: '5', bound: false },
    ]);
    expect(view.semel).toBe('111222');
    expect(JSON.stringify(view)).not.toContain('X');

    const many = Array.from({ length: 20 }, (_, i) => ({ childGuid: `g${i}`, privateName: 'ילד', schoolName: 's', semel: '1', bound: true }));
    expect(readView({ ...base, externs: many })!.externs).toHaveLength(12);
  });

  it('reads a view posted without externs as having none', () => {
    const { externs: _externs, semel: _semel, ...old } = accessTokenView(answer([NOA]))!;
    const view = readView(old)!;
    expect(view.externs).toEqual([]);
    expect(view.semel).toBeNull();
  });
});

describe('switching the session to another school', () => {
  const jwt = (semel: string) => `h.${Buffer.from(JSON.stringify({ UserId: 'parent-guid', Semel: semel })).toString('base64url')}.s`;
  const jar = async () => ({ MashovAuthToken: jwt('111222'), 'Csrf-Token': 'csrf-1' });

  /** What Mashov's changeSchool answers with the child of the new school in `ט 2`. */
  const switched = {
    credential: { userId: 'parent-guid', userType: 4, semel: 440123 },
    accessToken: { children: [{ childGuid: 'g2', privateName: 'נועה', familyName: 'X', classCode: 'ט', classNum: 2, schoolName: 'תיכון ב' }], externChildren: [] },
  };

  /** A fetch that records its requests and answers each with `status`, `headers` and `body`. */
  function fakeFetch(status: number, headers: Record<string, string>, body: unknown) {
    const calls: Array<{ url: string; init: RequestInit & { headers: Record<string, string> } }> = [];
    const impl = (async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
      calls.push({ url, init });
      const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => lower[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) };
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  /** A phone holding a parent's pass and the list its last login brought. */
  function parentKv() {
    const kv = memoryKv();
    kv.set(DEVICE_KEYS.pass, 'p1');
    keepChildren(kv, accessTokenView(answer([]))!, 'login');
    return kv;
  }

  it('asks Mashov to change school the way its site does', async () => {
    const kv = parentKv();
    kv.set(DEVICE_KEYS.fields, JSON.stringify({ deviceUuid: 'uuid-1', deviceModel: 'Pixel' }));
    const { calls, impl } = fakeFetch(200, {}, switched);
    await changeSchool(kv, '440123', impl, jar);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://web.mashov.info/api/changeSchool/440123');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('include');
    expect(calls[0]!.init.headers).toMatchObject({ 'content-type': 'application/json', 'x-csrf-token': 'csrf-1', devicePass: 'p1' });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(deviceLoginFields(kv));
    expect(deviceLoginFields(kv)).toMatchObject({ appName: 'info.mashov.students', deviceUuid: 'uuid-1', deviceModel: 'Pixel' });

    // Without a pass there is no header; without a CSRF cookie, none either.
    const bare = memoryKv();
    const second = fakeFetch(200, {}, switched);
    await changeSchool(bare, '440123', second.impl, async () => ({ MashovAuthToken: jwt('111222') }));
    expect(Object.keys(second.calls[0]!.init.headers)).not.toContain('devicePass');
    expect(Object.keys(second.calls[0]!.init.headers)).not.toContain('x-csrf-token');
  });

  it('keeps a fresh device pass and the new school\'s children', async () => {
    const kv = parentKv();
    const { impl } = fakeFetch(200, { devicePass: 'p2' }, switched);
    const answered = await changeSchool(kv, '440123', impl, jar);
    expect(answered.status).toBe(200);
    expect(answered.reason).toBeNull();
    expect(answered.view!.children).toHaveLength(1);
    expect(kv.getString(DEVICE_KEYS.pass)).toBe('p2');
    expect(mashovChildren(kv)!.from).toBe('changeSchool');
    expect(mashovChildren(kv)!.list).toEqual([{ guid: 'g2', firstName: 'נועה', classCode: 'ט', classNum: '2' }]);
  });

  it('reports a refusal with its reason and changes nothing', async () => {
    const kv = parentKv();
    const listBefore = kv.getString('mashov.parentChildren');
    const { impl } = fakeFetch(403, { Reason: 'BindNotFound', devicePass: 'p9' }, { message: 'no' });
    expect(await changeSchool(kv, '440123', impl, jar)).toEqual({ status: 403, reason: 'BindNotFound', view: null });
    expect(kv.getString(DEVICE_KEYS.pass)).toBe('p1');
    expect(kv.getString('mashov.parentChildren')).toBe(listBefore);
    expect(mashovChildren(kv)!.from).toBe('login');
  });

  it('answers status 0 when the request fails, and keeps what it had', async () => {
    const kv = parentKv();
    const impl = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await changeSchool(kv, '440123', impl, jar)).toEqual({ status: 0, reason: 'network', view: null });
    expect(kv.getString(DEVICE_KEYS.pass)).toBe('p1');
    expect(mashovChildren(kv)!.from).toBe('login');
  });

  it('does not switch to the school the session is in', async () => {
    const kv = parentKv();
    const { calls, impl } = fakeFetch(200, {}, switched);
    const here = async () => ({ MashovAuthToken: jwt('440123'), 'Csrf-Token': 'c' });
    expect(await sessionSemel(here)).toBe('440123');
    expect(await ensureSchool(kv, '440123', impl, here)).toBeNull();
    expect(calls).toHaveLength(0);
    // Another school is switched to; a jar without a login is not "the same school".
    expect(await ensureSchool(kv, '999', impl, here)).toMatchObject({ status: 200 });
    expect(calls).toHaveLength(1);
    expect(await sessionSemel(async () => ({}))).toBeNull();
  });
});

describe("scanning every school a parent's Mashov lists", () => {
  const jwt = (semel: string) => `h.${Buffer.from(JSON.stringify({ UserId: 'parent-guid', Semel: semel })).toString('base64url')}.s`;

  const extern = (childGuid: string, semel: number, bound = true, schoolName = `בית ספר ${semel}`) => ({ childGuid, privateName: `ילד ${childGuid}`, familyName: 'X', schoolName, semel, bound });

  /** What Mashov answers once the session is at `semel`, with these children in `ט 2`. */
  const schoolBody = (semel: number, guids: string[], externs: unknown[] = []) => ({
    credential: { userId: 'parent-guid', userType: 4, semel },
    accessToken: { children: guids.map((g) => ({ childGuid: g, privateName: `ילד ${g}`, familyName: 'X', classCode: 'ט', classNum: 2 })), externChildren: externs },
  });

  /** A phone whose last login listed child `g1` at school 1 and these children at others. */
  function parentKv(externs: unknown[]) {
    const kv = memoryKv();
    kv.set(DEVICE_KEYS.pass, 'p1');
    keepChildren(kv, accessTokenView(answer(externs, 1))!, 'login');
    return kv;
  }

  /** `stay`: Mashov answers 2xx and the session does not move there. */
  type Routes = Record<string, { status: number; headers?: Record<string, string>; body?: unknown; stay?: boolean }>;

  const NOW = new Date('2026-11-02T08:00:00Z');
  const coolSites: Record<string, string> = { '1': 'https://home.shahaf.site/?tab=1', '2': 'two.shahaf.site', '3': 'not a site' };

  /**
   * The scan's dependencies over a fake Mashov: each `changeSchool/<semel>` is answered from `routes`
   * (a 200 with an empty body when it has no route), `asked` records the semels in order, the
   * default `coolSite` records the school the session was in when it was asked, and the jar's
   * token names that school.
   */
  function deps(kv: ReturnType<typeof memoryKv>, routes: Routes, coolSite?: () => Promise<string | null>) {
    const asked: string[] = [];
    const visited: string[] = [];
    let inSchool = '1';
    const jar = async () => ({ MashovAuthToken: jwt(inSchool), 'Csrf-Token': 'csrf-1' });
    const fetchImpl = (async (url: string) => {
      const semel = decodeURIComponent(url.split('/').pop()!);
      asked.push(semel);
      const { status, headers = {}, body = {}, stay = false } = routes[semel] ?? { status: 200 };
      if (status >= 200 && status < 300 && !stay) inSchool = semel;
      const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => lower[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) };
    }) as unknown as typeof fetch;
    const cool = coolSite ?? (async () => { visited.push(inSchool); return coolSites[inSchool] ?? null; });
    return { asked, visited, deps: { kv, fetchImpl, jar, coolSite: cool, now: () => NOW } };
  }

  const home = (externs: unknown[]) => ({ status: 200, body: schoolBody(1, ['g1'], externs) });

  it('makes no requests for a parent with one school', async () => {
    const kv = parentKv([]);
    const { asked, visited, deps: d } = deps(kv, {});
    const scan = (await scanParentSchools(d))!;
    expect(asked).toEqual([]);
    expect(visited).toEqual(['1']);
    expect(scan.schools).toHaveLength(1);
    expect(scan.home).toBe('1');
    expect(scan.back).toBeNull();
    expect(scan.at).toBe(NOW.toISOString());
    expect(scan.schools[0]).toEqual({
      semel: '1', name: '', home: true, site: 'https://home.shahaf.site', siteKnown: true, switched: null,
      children: [{ guid: 'g1', firstName: 'יואב', classCode: 'ח', classNum: '1', semel: '1', bound: true }], externGuidsSeen: null,
    });
    expect(parentSchools(kv)).toEqual(scan);
  });

  it("visits each other school once, in Mashov's order, and goes back home", async () => {
    const externs = [extern('g2', 2), extern('g3', 2), extern('g4', 3), extern('g5', 4, false)];
    const kv = parentKv(externs);
    const { asked, visited, deps: d } = deps(kv, {
      '2': { status: 200, headers: { devicePass: 'p2' }, body: schoolBody(2, ['g2', 'g3']) },
      '3': { status: 200, body: schoolBody(3, ['g4']) },
      '1': home(externs),
    });
    const scan = (await scanParentSchools(d))!;
    expect(asked).toEqual(['2', '3', '1']);
    expect(visited).toEqual(['1', '2', '3']);
    expect(scan.back).toEqual({ status: 200, reason: null });
    expect(scan.schools.map((s) => s.semel)).toEqual(['1', '2', '3', '4']);
    expect(scan.schools.map((s) => s.home)).toEqual([true, false, false, false]);
    expect(scan.schools.map((s) => s.name)).toEqual(['', 'בית ספר 2', 'בית ספר 3', 'בית ספר 4']);

    const [, two, three, four] = scan.schools;
    expect(two!.switched).toEqual({ status: 200, reason: null });
    expect(two!.children).toEqual([
      { guid: 'g2', firstName: 'ילד g2', classCode: 'ט', classNum: '2', semel: '2', bound: true },
      { guid: 'g3', firstName: 'ילד g3', classCode: 'ט', classNum: '2', semel: '2', bound: true },
    ]);
    expect(two!.externGuidsSeen).toBe(true);
    expect(two!.site).toBe('https://two.shahaf.site');
    expect(three!.site).toBeNull();
    expect(three!.siteKnown).toBe(true);
    // A school the parent's login is not bound to is listed, never visited.
    expect(four).toEqual({
      semel: '4', name: 'בית ספר 4', home: false, site: null, siteKnown: false, switched: null,
      children: [{ guid: 'g5', firstName: 'ילד g5', classCode: '', classNum: '', semel: '4', bound: false }], externGuidsSeen: null,
    });
    // The trip home brought the home list back, and the scan is kept.
    expect(mashovChildren(kv)!.list.map((c) => c.guid)).toEqual(['g1']);
    expect(parentSchools(kv)).toEqual(scan);
    // The saved scan holds no family name, neither its key nor the fixture's value.
    const saved = kv.getString('mashov.parentSchools')!;
    expect(saved).not.toContain('familyName');
    expect(saved).not.toContain('"X"');
    expect(saved).not.toContain('כהן');
  });

  it('goes on after a school refuses, and keeps why', async () => {
    const externs = [extern('g2', 2), extern('g3', 3)];
    const kv = parentKv(externs);
    const { asked, deps: d } = deps(kv, {
      '2': { status: 403, headers: { Reason: 'ChangePass' }, body: { message: 'no' } },
      '3': { status: 200, body: schoolBody(3, ['g3']) },
      '1': home(externs),
    });
    const scan = (await scanParentSchools(d))!;
    expect(asked).toEqual(['2', '3', '1']);
    expect(scan.schools[1]!.switched).toEqual({ status: 403, reason: 'ChangePass' });
    expect(scan.schools[1]!.children).toEqual([]);
    expect(scan.schools[1]!.externGuidsSeen).toBeNull();
    expect(scan.schools[2]!.children.map((c) => c.guid)).toEqual(['g3']);
  });

  it('keeps a failed trip home', async () => {
    const externs = [extern('g2', 2)];
    const kv = parentKv(externs);
    const { deps: d } = deps(kv, { '2': { status: 200, body: schoolBody(2, ['g2']) }, '1': { status: 500, headers: { Reason: 'Oops' } } });
    const scan = (await scanParentSchools(d))!;
    expect(scan.back).toEqual({ status: 500, reason: 'Oops' });
    expect(parentSchools(kv)!.back!.status).toBe(500);
  });

  it("takes a school whose answer has no list as unknown, not empty and not the last school's", async () => {
    const externs = [extern('g2', 2), extern('g3', 3)];
    const kv = parentKv(externs);
    const { deps: d } = deps(kv, { '2': { status: 200, body: schoolBody(2, ['g2']) }, '3': { status: 200, body: { nothing: true } }, '1': home(externs) });
    const [, two, three] = (await scanParentSchools(d))!.schools;
    expect(two!.children.map((c) => c.guid)).toEqual(['g2']);
    expect(three).toMatchObject({ switched: { status: 200, reason: null }, children: [], externGuidsSeen: null, siteKnown: true });
  });

  it('says when the extern guids are missing from the school Mashov switched to', async () => {
    const externs = [extern('g2', 2), extern('g3', 2)];
    const kv = parentKv(externs);
    const { deps: d } = deps(kv, { '2': { status: 200, body: schoolBody(2, ['g2']) }, '1': home(externs) });
    expect((await scanParentSchools(d))!.schools[1]!.externGuidsSeen).toBe(false);
  });

  it('takes a school as not read when Mashov says yes and the session stays where it was', async () => {
    const externs = [extern('g2', 2), extern('g3', 3)];
    const kv = parentKv(externs);
    const { asked, visited, deps: d } = deps(kv, {
      '2': { status: 200, body: schoolBody(2, ['g2']), stay: true },
      '3': { status: 200, body: schoolBody(3, ['g3']) },
      '1': home(externs),
    });
    const scan = (await scanParentSchools(d))!;
    expect(asked).toEqual(['2', '3', '1']);
    // No site was asked for in a school the session never got into.
    expect(visited).toEqual(['1', '3']);
    expect(scan.schools[1]).toEqual({
      semel: '2', name: 'בית ספר 2', home: false, site: null, siteKnown: false, switched: { status: 200, reason: null }, children: [], externGuidsSeen: null,
    });
    expect(scan.schools[2]!.children.map((c) => c.guid)).toEqual(['g3']);
  });

  it("scans nothing when the kept list is another school's than the session's", async () => {
    const kv = parentKv([extern('g2', 2)]);
    const { asked, visited, deps: d } = deps(kv, {});
    const kept = JSON.parse(kv.getString('mashov.parentChildren')!);
    kept.shape.semel = '2';
    kv.set('mashov.parentChildren', JSON.stringify(kept));
    expect(await scanParentSchools(d)).toBeNull();
    expect(asked).toEqual([]);
    expect(visited).toEqual([]);
    expect(parentSchools(kv)).toBeNull();
  });

  it('marks the site unknown when asking for it fails, and still scans', async () => {
    const externs = [extern('g2', 2)];
    const kv = parentKv(externs);
    const { deps: d } = deps(kv, { '2': { status: 200, body: schoolBody(2, ['g2']) }, '1': home(externs) }, async () => { throw new Error('offline'); });
    const scan = (await scanParentSchools(d))!;
    expect(scan.schools.map((s) => [s.site, s.siteKnown])).toEqual([[null, false], [null, false]]);
    expect(scan.schools[1]!.children).toHaveLength(1);
  });

  it('returns nothing without a login or without a list', async () => {
    const { deps: d } = deps(parentKv([]), {});
    expect(await scanParentSchools({ ...d, jar: async () => ({}) })).toBeNull();
    expect(await scanParentSchools({ ...d, kv: memoryKv() })).toBeNull();
    expect(parentSchools(memoryKv())).toBeNull();
  });

  /** The phone's two children, linked to `g1` at school 1 and `g2` at school 2. */
  const linkBoth = (kv: ReturnType<typeof memoryKv>) => kv.set(CHILDREN_KEY, JSON.stringify({
    activeId: 'a',
    list: [
      { id: 'a', label: '', siteUrl: '', classId: '', className: 'ח 1', hiddenSubjects: [], mashov: { guid: 'g1', semel: '1' } },
      { id: 'b', label: '', siteUrl: '', classId: '', className: 'ט 2', hiddenSubjects: [], mashov: { guid: 'g2', semel: '2' } },
    ],
  }));

  it('asks for the scan again only when Mashov lists someone new', async () => {
    const externs = [extern('g2', 2)];
    const kv = parentKv(externs);
    expect(scanNeeded(kv)).toBe(true);
    const { deps: d } = deps(kv, { '2': { status: 200, body: schoolBody(2, ['g2']) }, '1': home(externs) });
    await scanParentSchools(d);
    linkBoth(kv);
    expect(scanNeeded(kv)).toBe(false);
    keepChildren(kv, accessTokenView(answer([...externs, extern('g9', 5)], 1))!, 'login');
    expect(scanNeeded(kv)).toBe(true);
    // A list kept before the children at other schools were read has no externs: only its own children count.
    const old = memoryKv();
    keepChildren(old, accessTokenView(answer([], 1))!, 'login');
    const kept = JSON.parse(old.getString('mashov.parentChildren')!);
    delete kept.shape.externs;
    delete kept.shape.semel;
    old.set('mashov.parentChildren', JSON.stringify(kept));
    expect(scanNeeded(old)).toBe(true);
    await scanParentSchools(deps(old, {}).deps);
    linkChild(old, 'shown', { guid: 'g1', semel: '1' });
    expect(scanNeeded(old)).toBe(false);
  });

  it('asks for the scan again while a child the last scan found is on no phone child, until six are', async () => {
    const externs = [extern('g2', 2)];
    const kv = parentKv(externs);
    await scanParentSchools(deps(kv, { '2': { status: 200, body: schoolBody(2, ['g2']) }, '1': home(externs) }).deps);
    // The lone child is g1: g2 waits (a twin asked about, or a class list that did not come).
    linkChild(kv, 'shown', { guid: 'g1', semel: '1' });
    expect(scanNeeded(kv)).toBe(true);
    // Taken off the list by the parent: not looked for again.
    kv.set(DISMISSED_KEY, JSON.stringify(['g2']));
    expect(scanNeeded(kv)).toBe(false);
    kv.remove(DISMISSED_KEY);

    // A child the login cannot read is not waiting for a scan.
    const unbound = parentKv([extern('g5', 5, false)]);
    await scanParentSchools(deps(unbound, {}).deps);
    linkChild(unbound, 'shown', { guid: 'g1', semel: '1' });
    expect(scanNeeded(unbound)).toBe(false);

    // Six children on the phone: there is no room for g2, so no scan for it.
    const full = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, label: '', siteUrl: '', classId: '', className: `ז ${i + 1}`, hiddenSubjects: [], ...(i === 0 ? { mashov: { guid: 'g1', semel: '1' } } : {}),
    }));
    kv.set(CHILDREN_KEY, JSON.stringify({ activeId: 'c0', list: full }));
    expect(scanNeeded(kv)).toBe(false);
    kv.set(CHILDREN_KEY, JSON.stringify({ activeId: 'c0', list: full.slice(0, 5) }));
    expect(scanNeeded(kv)).toBe(true);
  });
});

describe('one session job at a time', () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('runs one session job at a time', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`${name}-start`);
      await pause(ms);
      log.push(`${name}-end`);
      return name;
    };
    // The first job is the slower one: only the lock keeps the second from starting before it ends.
    const results = await Promise.all([withMashovSession(job('a', 20)), withMashovSession(job('b', 1))]);
    expect(log).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    expect(results).toEqual(['a', 'b']);
  });

  it('runs the next job after one that throws, and hands each caller its own outcome', async () => {
    const ran: string[] = [];
    const failing = withMashovSession(async () => {
      ran.push('failing');
      throw new Error('boom');
    });
    const next = withMashovSession(async () => {
      ran.push('next');
      return 7;
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await next).toBe(7);
    expect(await withMashovSession(async () => 'later')).toBe('later');
    expect(ran).toEqual(['failing', 'next']);
  });

  it('settles once every job asked for so far has finished, a throwing one too', async () => {
    const log: string[] = [];
    const slow = withMashovSession(async () => {
      await pause(15);
      log.push('slow');
    });
    const failing = withMashovSession(async () => {
      await pause(5);
      log.push('failing');
      throw new Error('boom');
    });
    failing.catch(() => undefined);
    const idle = mashovSessionIdle().then(() => log.push('idle'));
    await idle;
    expect(log).toEqual(['slow', 'failing', 'idle']);
    await expect(slow).resolves.toBeUndefined();
    await expect(failing).rejects.toThrow('boom');
    // With nothing queued it settles at once.
    await expect(mashovSessionIdle()).resolves.toBeUndefined();
  });
});

describe("planning the phone's children from Mashov's schools", () => {
  const siteOf = (semel: string) => `https://s${semel}.shahaf.site`;

  /** A child Mashov lists at school `semel`, in `ט 2` unless told otherwise. */
  const kid = (guid: string, semel: string, classCode = 'ט', classNum = '2', bound = true): ScannedChild =>
    ({ guid, firstName: `ילד ${guid}`, classCode, classNum, semel, bound });

  /** A school the scan got into and read whole, with its site; school `1` is the home school, whose name is `''`. */
  const school = (semel: string, children: ScannedChild[], site: string | null = siteOf(semel), siteKnown = true): SchoolScan => ({
    semel, name: semel === '1' ? '' : `בית ספר ${semel}`, home: semel === '1', site, siteKnown,
    switched: semel === '1' ? null : { status: 200, reason: null }, children, externGuidsSeen: semel === '1' ? null : true,
  });

  /** A school whose switch Mashov refused: none of its bound children were read. */
  const refused = (semel: string): SchoolScan =>
    ({ ...school(semel, [], null, false), switched: { status: 403, reason: 'BindNotFound' }, externGuidsSeen: null });

  const scanOf = (...schools: SchoolScan[]): ParentSchools => ({ at: '2026-11-02T08:00:00.000Z', home: '1', schools, back: null });

  const plan = (scan: ParentSchools, phone: PhoneChild[], classesBySite: Record<string, ClassOption[] | null> = {}, dismissed: string[] = []) =>
    planChildren({ scan, phone, dismissed, classesBySite });

  const nothing = { link: [], add: [], ask: [], unbound: [], full: [], later: [] };
  const named = (child: ScannedChild, schoolName: string) => ({ ...child, schoolName });

  it("links the phone's child and adds nobody when Mashov has one child", () => {
    const scan = scanOf(school('1', [kid('g1', '1')]));
    const classes = { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }] };
    expect(plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: "ט' 2" }], classes))
      .toEqual({ ...nothing, link: [{ childId: 'shown', link: { guid: 'g1', semel: '1' } }] });
    // The only child in its class is the phone's, even when the phone's site is another or none.
    expect(plan(scan, [{ id: 'shown', siteUrl: '', className: 'ט2' }], classes).link).toEqual([{ childId: 'shown', link: { guid: 'g1', semel: '1' } }]);
    // A child linked already is that child, and is not linked again.
    expect(plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ז 4', mashov: { guid: 'g1', semel: '1' } }], classes)).toEqual(nothing);
  });

  it('adds the children at other schools, in their class when the site lists it', () => {
    const scan = scanOf(
      school('1', [kid('g1', '1'), kid('g4', '1', 'ח', '1')]),
      school('2', [kid('g2', '2', 'ח', '1')]),
      school('3', [kid('g3', '3', 'יא', '3')]),
    );
    const classes = {
      [siteOf('1')]: [{ id: 'h1', name: 'ח1' }, { id: 't2', name: 'ט 2' }],
      [siteOf('2')]: [{ id: 'a', name: 'ח1' }, { id: 'b', name: 'ח 2' }],
      [siteOf('3')]: [{ id: 'x', name: "י״א 3 מדעים" }, { id: 'y', name: 'יב 3' }],
    };
    const result = plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ט 2' }], classes);
    expect(result.link).toEqual([{ childId: 'shown', link: { guid: 'g1', semel: '1' } }]);
    // The home school's first, then the others in the scan's order.
    expect(result.add).toEqual([
      { link: { guid: 'g4', semel: '1' }, label: 'ילד g4', siteUrl: siteOf('1'), classId: 'h1', className: 'ח1', withoutSite: false, schoolName: '' },
      { link: { guid: 'g2', semel: '2' }, label: 'ילד g2', siteUrl: siteOf('2'), classId: 'a', className: 'ח1', withoutSite: false, schoolName: 'בית ספר 2' },
      { link: { guid: 'g3', semel: '3' }, label: 'ילד g3', siteUrl: siteOf('3'), classId: 'x', className: 'י״א 3 מדעים', withoutSite: false, schoolName: 'בית ספר 3' },
    ]);
    expect(result).toMatchObject({ ask: [], unbound: [], full: [], later: [] });
  });

  it('adds a child without a site when its school has none, or its class is not on the site', () => {
    const scan = scanOf(
      school('1', [kid('g1', '1', 'ח', '1')]),
      school('2', [kid('g2', '2')], null),
      school('3', [kid('g3', '3')]),
      school('4', [kid('g4', '4')]),
    );
    const classes = {
      [siteOf('3')]: [{ id: 'z', name: 'ט 1' }],
      // Two classes read as ט 2: neither is taken for it.
      [siteOf('4')]: [{ id: 'p', name: 'ט 2' }, { id: 'q', name: 'ט2 מחוננים' }],
    };
    const result = plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ח 1', mashov: { guid: 'g1', semel: '1' } }], classes);
    const without = (guid: string, semel: string) =>
      ({ link: { guid, semel }, label: `ילד ${guid}`, siteUrl: '', classId: '', className: 'ט 2', withoutSite: true, schoolName: `בית ספר ${semel}` });
    expect(result).toEqual({ ...nothing, add: [without('g2', '2'), without('g3', '3'), without('g4', '4')] });
  });

  it("leaves a child for later when its school's class list did not come", () => {
    const scan = scanOf(
      // Bound at home but not in the home list: Mashov gave no class to place it by.
      school('1', [kid('g1', '1'), kid('g5', '1', '', '')]),
      school('2', [kid('g2', '2')]),
      school('3', [kid('g3', '3')]),
      // The school's site could not be asked for: not known is not none.
      school('4', [kid('g4', '4')], null, false),
    );
    const result = plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ט 2', mashov: { guid: 'g1', semel: '1' } }], { [siteOf('2')]: null });
    expect(result).toEqual({ ...nothing, later: [kid('g5', '1', '', ''), kid('g2', '2'), kid('g3', '3'), kid('g4', '4')] });
  });

  it("asks who the phone's child is when two schools have its class", () => {
    const scan = scanOf(school('1', [kid('g1', '1')]), school('2', [kid('g2', '2')]));
    const classes = { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }], [siteOf('2')]: [{ id: 'c2', name: 'ט 2' }] };
    // The phone's site is neither school's: neither child is linked, and neither is added in its place.
    expect(plan(scan, [{ id: 'shown', siteUrl: 'https://old.shahaf.site', className: 'ט 2' }], classes)).toEqual({
      ...nothing,
      ask: [{ childId: 'shown', className: 'ט 2', options: [named(kid('g1', '1'), ''), named(kid('g2', '2'), 'בית ספר 2')] }],
    });
    // The phone's site is one school's: that school's child is the phone's, and the other is added.
    const atTwo = plan(scan, [{ id: 'shown', siteUrl: siteOf('2'), className: 'ט 2' }], classes);
    expect(atTwo.link).toEqual([{ childId: 'shown', link: { guid: 'g2', semel: '2' } }]);
    expect(atTwo.add.map((c) => [c.link.guid, c.classId])).toEqual([['g1', 'c1']]);
    expect(atTwo.ask).toEqual([]);
  });

  it("asks rather than link one Mashov child to two of the phone's children", () => {
    const scan = scanOf(school('1', [kid('g1', '1')]));
    const result = plan(scan, [
      { id: 'a', siteUrl: siteOf('1'), className: 'ט 2' },
      { id: 'b', siteUrl: '', className: 'ט 2' },
    ], { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }] });
    expect(result).toEqual({
      ...nothing,
      ask: [
        { childId: 'a', className: 'ט 2', options: [named(kid('g1', '1'), '')] },
        { childId: 'b', className: 'ט 2', options: [named(kid('g1', '1'), '')] },
      ],
    });
  });

  it('never offers a child another of the phone\'s children is linked to', () => {
    const scan = scanOf(school('1', [kid('g1', '1')]), school('2', [kid('g2', '2')]));
    const classes = { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }], [siteOf('2')]: [{ id: 'c2', name: 'ט 2' }] };
    const result = plan(scan, [
      // The site as it was pasted reads as school 1's.
      { id: 'a', siteUrl: `${siteOf('1')}/?tab=2`, className: 'ט 2' },
      { id: 'b', siteUrl: '', className: 'ט 2' },
    ], classes);
    // One option left is still asked, not linked by elimination; and g2 is not added while it is.
    expect(result).toEqual({
      ...nothing,
      link: [{ childId: 'a', link: { guid: 'g1', semel: '1' } }],
      ask: [{ childId: 'b', className: 'ט 2', options: [named(kid('g2', '2'), 'בית ספר 2')] }],
    });
  });

  it('moves a linked child to the school Mashov lists it in now', () => {
    const scan = scanOf(school('1', [kid('g1', '1', 'ח', '1')]), school('2', [kid('g2', '2')]));
    const phone: PhoneChild[] = [
      { id: 'shown', siteUrl: siteOf('1'), className: 'ח 1', mashov: { guid: 'g1', semel: '1' } },
      { id: 'c1', siteUrl: siteOf('3'), className: 'ט 2', mashov: { guid: 'g2', semel: '3' } },
      // Mashov lists this one nowhere: it is left as it is.
      { id: 'c2', siteUrl: siteOf('3'), className: 'ט 2', mashov: { guid: 'g9', semel: '3' } },
    ];
    expect(plan(scan, phone, { [siteOf('2')]: [{ id: 'x', name: 'ט 2' }] }))
      .toEqual({ ...nothing, link: [{ childId: 'c1', link: { guid: 'g2', semel: '2' } }] });
  });

  it('links the one child of a class elsewhere only by its site when a school was not read', () => {
    const phone = (siteUrl: string): PhoneChild[] => [
      { id: 'shown', siteUrl: siteOf('1'), className: 'ח 1', mashov: { guid: 'g1', semel: '1' } },
      { id: 'x', siteUrl, className: 'ט 2' },
    ];
    const home = school('1', [kid('g1', '1', 'ח', '1')]);
    const classes = { [siteOf('2')]: [{ id: 'c2', name: 'ט 2' }] };
    // School 3 refused: the phone's child may be there, so school 2's ט 2 is not taken for it, and waits.
    expect(plan(scanOf(home, school('2', [kid('g2', '2')]), refused('3')), phone(siteOf('3')), classes))
      .toEqual({ ...nothing, later: [kid('g2', '2')] });
    // A list that left out a child Mashov listed there is not read whole either.
    const partial = { ...school('4', []), externGuidsSeen: false };
    expect(plan(scanOf(home, school('2', [kid('g2', '2')]), partial), phone(siteOf('3')), classes))
      .toEqual({ ...nothing, later: [kid('g2', '2')] });
    // Its site is the phone child's: linked.
    expect(plan(scanOf(home, school('2', [kid('g2', '2')]), refused('3')), phone(siteOf('2')), classes))
      .toEqual({ ...nothing, link: [{ childId: 'x', link: { guid: 'g2', semel: '2' } }] });
    // Every school read: the one child of its class is the phone's, wherever it is.
    expect(plan(scanOf(home, school('2', [kid('g2', '2')])), phone(siteOf('3')), classes))
      .toEqual({ ...nothing, link: [{ childId: 'x', link: { guid: 'g2', semel: '2' } }] });
  });

  it("takes Mashov's only child as the lone child's, whatever its class, when every school was read", () => {
    const shown: PhoneChild[] = [{ id: 'shown', siteUrl: siteOf('1'), className: 'ז 4' }];
    const classes = { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }] };
    expect(plan(scanOf(school('1', [kid('g1', '1')])), shown, classes))
      .toEqual({ ...nothing, link: [{ childId: 'shown', link: { guid: 'g1', semel: '1' } }] });
    // A school refused: Mashov's only child read is not known to be the only one; it is neither linked nor added.
    expect(plan(scanOf(school('1', [kid('g1', '1')]), refused('2')), shown, classes))
      .toEqual({ ...nothing, later: [kid('g1', '1')] });
    // With a list on the phone, a child of another class is a child of its own.
    const two: PhoneChild[] = [{ id: 'a', siteUrl: siteOf('1'), className: 'ז 4' }, { id: 'b', siteUrl: siteOf('1'), className: 'ז 5' }];
    expect(plan(scanOf(school('1', [kid('g1', '1')])), two, classes).add.map((c) => c.link.guid)).toEqual(['g1']);
  });

  it('counts a yes without a list as a school not read, and a school with only unbound children as nothing missed', () => {
    const shown: PhoneChild[] = [{ id: 'shown', siteUrl: siteOf('1'), className: 'ז 4' }];
    const home = school('1', [kid('g1', '1')]);
    const classes = { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }] };
    // Mashov said yes and sent no list (or the session stayed elsewhere): its children are not known.
    const noList = { ...school('2', [], null, false), externGuidsSeen: null };
    expect(plan(scanOf(home, noList), shown, classes)).toEqual({ ...nothing, later: [kid('g1', '1')] });
    // Not tried, since the login can read none of its children: every bound child was read.
    const untried = { ...school('3', [kid('g3', '3', '', '', false)], null, false), switched: null, externGuidsSeen: null };
    expect(plan(scanOf(home, untried), shown, classes)).toEqual({
      ...nothing, link: [{ childId: 'shown', link: { guid: 'g1', semel: '1' } }], unbound: [named(kid('g3', '3', '', '', false), 'בית ספר 3')],
    });
  });

  it('adds a child whose Mashov class reads as no grade without a site', () => {
    const scan = scanOf(school('1', [kid('g1', '1', 'ח', '1'), kid('g2', '1', 'מרחב', '')]));
    expect(plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ח 1', mashov: { guid: 'g1', semel: '1' } }], { [siteOf('1')]: [{ id: 'm', name: 'מרחב' }] })).toEqual({
      ...nothing,
      add: [{ link: { guid: 'g2', semel: '1' }, label: 'ילד g2', siteUrl: '', classId: '', className: 'מרחב', withoutSite: true, schoolName: '' }],
    });
  });

  it('keeps twins as two children', () => {
    const scan = scanOf(school('1', [kid('g1', '1'), kid('g2', '1')]));
    const classes = { [siteOf('1')]: [{ id: 'c1', name: 'ט 2' }] };
    expect(plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ט 2' }], classes)).toEqual({
      ...nothing,
      ask: [{ childId: 'shown', className: 'ט 2', options: [named(kid('g1', '1'), ''), named(kid('g2', '1'), '')] }],
    });
    // Once the phone's child is linked, the other twin is a child of its own, in the same class.
    expect(plan(scan, [{ id: 'shown', siteUrl: siteOf('1'), className: 'ט 2', mashov: { guid: 'g1', semel: '1' } }], classes)).toEqual({
      ...nothing,
      add: [{ link: { guid: 'g2', semel: '1' }, label: 'ילד g2', siteUrl: siteOf('1'), classId: 'c1', className: 'ט 2', withoutSite: false, schoolName: '' }],
    });
  });

  it('skips a removed child, an unbound child, and anyone past six', () => {
    const phone: PhoneChild[] = ['h1', 'h2', 'h3', 'h4'].map((guid, i) =>
      ({ id: i === 0 ? 'shown' : `c${i}`, siteUrl: siteOf('1'), className: `ז ${i + 1}`, mashov: { guid, semel: '1' } }));
    const scan = scanOf(
      school('1', [...['h1', 'h2', 'h3', 'h4'].map((g, i) => kid(g, '1', 'ז', String(i + 1))), kid('g5', '1')]),
      school('2', [kid('g6', '2'), kid('g7', '2', 'ט', '3'), kid('g8', '2', 'ט', '4'), kid('g9', '2', '', '', false)]),
      // Past six, a child whose class list did not come is full, not later.
      school('3', [kid('g10', '3')]),
    );
    const classes = { [siteOf('2')]: [{ id: 'a', name: 'ט 2' }, { id: 'b', name: 'ט 3' }, { id: 'c', name: 'ט 4' }], [siteOf('3')]: null };
    const result = plan(scan, phone, classes, ['g5']);
    expect(result.add.map((c) => c.link.guid)).toEqual(['g6', 'g7']);
    expect(result.full).toEqual([kid('g8', '2', 'ט', '4'), kid('g10', '3')]);
    expect(result.unbound).toEqual([named(kid('g9', '2', '', '', false), 'בית ספר 2')]);
    expect(result).toMatchObject({ link: [], ask: [], later: [] });
  });
});

describe('adding the children a scan found to the phone', () => {
  const SITE_A = 'https://school-a.shahaf.site';
  const SITE_B = 'https://school-b.shahaf.site';
  const parent = (over: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, audience: 'parent', ...over });
  const nothing = { link: [], add: [], ask: [], unbound: [], full: [], later: [] };
  const ids = () => {
    let n = 0;
    return () => `c${++n}`;
  };

  const NOA = { link: { guid: 'g1', semel: '1' }, label: 'נועה', siteUrl: SITE_A, classId: 'a8', className: 'ח 1', withoutSite: false, schoolName: '' };
  const YOAV = { link: { guid: 'g2', semel: '2' }, label: 'יואב', siteUrl: SITE_B, classId: 'b5', className: 'ה 3', withoutSite: false, schoolName: 'בית ספר ב' };
  const DANA = { link: { guid: 'g3', semel: '3' }, label: 'דנה', siteUrl: '', classId: '', className: 'ט 2', withoutSite: true, schoolName: 'בית ספר ג' };
  const classes = { [SITE_A]: [{ id: 'a8', name: 'ח 1' }], [SITE_B]: [{ id: 'b5', name: 'ה 3' }] };

  it("makes Mashov's first child the phone's class when the phone has none", () => {
    const kv = memoryKv();
    const saved = applyChildrenPlan(kv, parent(), null, { ...nothing, add: [NOA] }, ids(), classes)!;
    expect(saved).toMatchObject({ classId: 'a8', className: 'ח 1', lessons: { hiddenSubjects: [] } });
    expect(shownMashovLink(kv)).toEqual({ guid: 'g1', semel: '1' });
    expect(pastedSite(kv)).toBe(SITE_A);
    expect(isWithoutSite(kv)).toBe(false);
    expect(JSON.parse(kv.getString(SETTINGS_KEYS.classes)!)).toEqual(classes[SITE_A]);
    // One child is no list.
    expect(readChildren(kv)).toBeNull();

    // A phone that has a class keeps it: Mashov's child is linked to it, and there is nothing to save.
    const linked = memoryKv();
    const shown = parent({ classId: 'a8', className: 'ח 1' });
    expect(applyChildrenPlan(linked, shown, SITE_A, { ...nothing, link: [{ childId: 'shown', link: NOA.link }] }, ids(), classes)).toBeNull();
    expect(shownMashovLink(linked)).toEqual({ guid: 'g1', semel: '1' });
  });

  it('starts the list when Mashov brings a second child', () => {
    const kv = memoryKv();
    const saved = applyChildrenPlan(kv, parent(), null, { ...nothing, add: [NOA, YOAV] }, ids(), classes)!;
    expect(saved).toMatchObject({ classId: 'a8', className: 'ח 1' });
    const children = readChildren(kv)!;
    expect(children.list.length).toBe(2);
    // The first is on screen, with Mashov's first name and its link.
    expect(children.activeId).toBe(children.list[0]!.id);
    expect(children.list[0]).toMatchObject({ label: 'נועה', siteUrl: SITE_A, classId: 'a8', className: 'ח 1', mashov: { guid: 'g1', semel: '1' } });
    expect(children.list[0]!.withoutSite).toBeUndefined();
    expect(children.list[1]).toMatchObject({ label: 'יואב', siteUrl: SITE_B, classId: 'b5', className: 'ה 3', mashov: { guid: 'g2', semel: '2' } });
    // The second's school's class list goes aside with it.
    expect(JSON.parse(kv.getString(stashKey(children.list[1]!.id, SETTINGS_KEYS.classes))!)).toEqual(classes[SITE_B]);
    expect(shownMashovLink(kv)).toEqual({ guid: 'g1', semel: '1' });

    // On a phone with a list, the plan's links go to their children and the rest are added after them.
    const more = applyChildrenPlan(kv, saved, SITE_A, { ...nothing, link: [{ childId: children.list[1]!.id, link: { guid: 'g2', semel: '4' } }], add: [DANA] }, ids(), classes);
    expect(more).toBeNull();
    const after = readChildren(kv)!;
    expect(after.list.map((c) => c.mashov?.semel)).toEqual(['1', '4', '3']);
    expect(after.list[2]).toMatchObject({ label: 'דנה', siteUrl: '', classId: '', className: 'ט 2', withoutSite: true });
  });

  it("puts the phone's class, with no site known, at the home school's site before adding", () => {
    const scanned = (homeSite: string | null): ParentSchools => ({
      at: '2026-11-02T08:00:00.000Z', home: '1', back: null,
      schools: [
        { semel: '1', name: '', home: true, site: homeSite, siteKnown: true, switched: null, children: [{ guid: 'g1', firstName: 'נועה', classCode: 'ח', classNum: '1', semel: '1', bound: true }], externGuidsSeen: null },
        { semel: '2', name: 'בית ספר ב', home: false, site: SITE_B, siteKnown: true, switched: { status: 200, reason: null }, children: [{ guid: 'g2', firstName: 'יואב', classCode: 'ה', classNum: '3', semel: '2', bound: true }], externGuidsSeen: true },
      ],
    });
    const shown = parent({ classId: 'a8', className: 'ח 1' });
    const kv = memoryKv();
    const plan = { ...nothing, link: [{ childId: 'shown' as const, link: NOA.link }], add: [YOAV], later: [] };
    expect(applyChildrenPlan(kv, shown, null, plan, ids(), classes, scanned(SITE_A))).toBeNull();
    const list = readChildren(kv)!.list;
    expect(list[0]).toMatchObject({ siteUrl: SITE_A, classId: 'a8', mashov: { guid: 'g1', semel: '1' } });
    expect(list[1]).toMatchObject({ siteUrl: SITE_B, classId: 'b5', mashov: { guid: 'g2', semel: '2' } });
    expect(plan.later).toEqual([]);

    // No site known for the home school either: the links go on, and the children wait for the next scan.
    const unknown = memoryKv();
    const waits = { ...nothing, link: [{ childId: 'shown' as const, link: NOA.link }], add: [YOAV], later: [] };
    expect(applyChildrenPlan(unknown, shown, '', waits, ids(), classes, scanned(null))).toBeNull();
    expect(readChildren(unknown)).toBeNull();
    expect(shownMashovLink(unknown)).toEqual({ guid: 'g1', semel: '1' });
    expect(waits.later).toEqual([{ guid: 'g2', firstName: 'יואב', classCode: 'ה', classNum: '3', semel: '2', bound: true }]);
    expect(scanSummary({ schools: scanned(null), plan: waits, added: 0 }).lines).toEqual([PARENT_SCHOOLS_COPY.later(1)]);

    // "Without a site" is a place of its own: the children are added beside it.
    const without = memoryKv();
    without.set(SCHOOL_SITE_KEYS.withoutSite, '1');
    expect(isWithoutSite(without)).toBe(true);
    applyChildrenPlan(without, shown, null, { ...nothing, add: [YOAV] }, ids(), classes, scanned(null));
    expect(readChildren(without)!.list.map((c) => c.siteUrl)).toEqual(['', SITE_B]);
  });

  it('puts a first child without a site on screen without one', () => {
    const kv = memoryKv();
    // A site pasted once, with no class picked: the child without a site has none.
    kv.set(SCHOOL_SITE_KEYS.pasted, SITE_B);
    const saved = applyChildrenPlan(kv, parent(), null, { ...nothing, add: [DANA, NOA] }, ids(), classes)!;
    expect(saved).toMatchObject({ classId: '', className: 'ט 2' });
    expect(isWithoutSite(kv)).toBe(true);
    expect(pastedSite(kv)).toBeNull();
    const children = readChildren(kv)!;
    expect(children.list[0]).toMatchObject({ label: 'דנה', siteUrl: '', classId: '', className: 'ט 2', withoutSite: true, mashov: { guid: 'g3', semel: '3' } });
    expect(children.list[1]).toMatchObject({ label: 'נועה', siteUrl: SITE_A, classId: 'a8', mashov: { guid: 'g1', semel: '1' } });
  });
});

describe('reading each child in its own school', () => {
  const jwt = (semel: string) => `h.${Buffer.from(JSON.stringify({ UserId: 'parent-guid', Semel: semel })).toString('base64url')}.s`;
  const jarAt = (semel: string) => async () => ({ MashovAuthToken: jwt(semel), 'Csrf-Token': 'csrf-1' });
  const parent = { ...DEFAULT_SETTINGS, audience: 'parent' as const, className: 'ח 1' };

  /** School 2's answer to a switch: its child `g2`, in `ט 2`. */
  const schoolTwo = {
    credential: { userId: 'parent-guid', userType: 4, semel: 2 },
    accessToken: { children: [{ childGuid: 'g2', privateName: 'נועה', familyName: 'X', classCode: 'ט', classNum: 2 }], externChildren: [] },
  };

  /**
   * A phone whose last login, at school 1, listed `g1` in `ח 1` and `g2` at school 2, with Mashov's
   * semel the number 2; the child on screen is linked to `g2`, as the plan links it from that answer.
   */
  function linkedKv() {
    const kv = memoryKv();
    kv.set(DEVICE_KEYS.pass, 'p1');
    const view = accessTokenView(answer([{ ...NOA, semel: 2 }], 1))!;
    keepChildren(kv, view, 'login');
    const far = view.externs[0]!;
    linkChild(kv, 'shown', { guid: far.childGuid, semel: far.semel });
    return kv;
  }

  /** A saved scan that names school 2. */
  const scan = (): ParentSchools => ({
    at: '2026-11-02T08:00:00.000Z',
    home: '1',
    back: null,
    schools: [
      { semel: '1', name: '', home: true, site: null, siteKnown: true, switched: null, children: [], externGuidsSeen: null },
      { semel: '2', name: 'תיכון ב', home: false, site: null, siteKnown: true, switched: { status: 200, reason: null }, children: [], externGuidsSeen: true },
    ],
  });

  /**
   * A fake Mashov: `changeSchool` answers with `change`, every read with an empty list. `asked` is each path, in order.
   * `jar` holds a session at `start`, moved by a 2xx switch unless `change.stay`.
   */
  function mashov(change: { status: number; headers?: Record<string, string>; body?: unknown; stay?: boolean }, start = '1') {
    const asked: string[] = [];
    let at = start;
    const jar = async () => ({ MashovAuthToken: jwt(at), 'Csrf-Token': 'csrf-1' });
    const fetchImpl = (async (url: string) => {
      const path = new URL(url).pathname;
      asked.push(path);
      const switching = path.startsWith('/api/changeSchool/');
      const { status, headers = {}, body = [] } = switching ? change : { status: 200 };
      if (switching && status >= 200 && status < 300 && !change.stay) at = decodeURIComponent(path.split('/').pop()!);
      const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => lower[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) };
    }) as unknown as typeof fetch;
    return { asked, fetchImpl, jar };
  }

  it('reads a linked child by its guid, never by the class', () => {
    const kv = linkedKv();
    // The class on screen is g1's: the link still wins.
    expect(kv.getString(ONLY_CHILD_LINK_KEY)).toBe(JSON.stringify({ guid: 'g2', semel: '2' }));
    expect(parentRead(kv, parent, true)).toEqual({ guid: 'g2', by: 'link', semel: '2' });

    // The same with a list, by the child on screen's own link.
    const list = memoryKv();
    keepChildren(list, accessTokenView(answer([NOA], 1))!, 'login');
    list.set(CHILDREN_KEY, JSON.stringify({
      activeId: 'b',
      list: [
        { id: 'a', label: 'יואב', siteUrl: 'https://a.shahaf.site', classId: 'a8', className: 'ח 1', hiddenSubjects: [], mashov: { guid: 'g1', semel: '1' } },
        { id: 'b', label: 'נועה', siteUrl: 'https://a.shahaf.site', classId: 'a8', className: 'ח 1', hiddenSubjects: [], mashov: { guid: 'g2', semel: '2' } },
      ],
    }));
    expect(parentRead(list, parent, false)).toEqual({ guid: 'g2', by: 'link', semel: '2' });
    expect(parentRead(list, { ...parent, audience: 'student' }, false)).toBeNull();
  });

  it('reads nobody unlinked once a scan exists', () => {
    const kv = memoryKv();
    keepChildren(kv, accessTokenView(answer([NOA], 1))!, 'login');
    // Before a scan, the class on screen still finds g1.
    expect(parentRead(kv, parent, true)).toEqual({ guid: 'g1', by: 'class' });
    kv.set(PARENT_KEYS.schools, JSON.stringify(scan()));
    expect(parentRead(kv, parent, true)).toEqual({ missing: 'notFound' });
    expect(parentRead(kv, { ...parent, className: 'יב 3' }, true)).toEqual({ missing: 'notFound' });
  });

  it("switches back to the child's school when the session is elsewhere", async () => {
    const kv = linkedKv();
    const { asked, fetchImpl, jar } = mashov({ status: 200, body: schoolTwo });
    const api = await parentReadApi({ kv, settings: parent, fetchImpl, jar });
    await api.grades();
    expect(asked).toEqual(['/api/changeSchool/2', '/api/students/g2/grades']);
    // The kept list is school 2's now.
    expect(mashovChildren(kv)!.list.map((c) => c.guid)).toEqual(['g2']);

    // Already there: no switch.
    const there = mashov({ status: 200, body: schoolTwo });
    await (await parentReadApi({ kv: linkedKv(), settings: parent, fetchImpl: there.fetchImpl, jar: jarAt('2') })).grades();
    expect(there.asked).toEqual(['/api/students/g2/grades']);

    // No login at all: no switch, and the read needs a login as before.
    const none = mashov({ status: 200, body: schoolTwo });
    await expect(parentReadApi({ kv: linkedKv(), settings: parent, fetchImpl: none.fetchImpl, jar: async () => ({}) })).rejects.toMatchObject({ needsReauth: true });
    expect(none.asked).toEqual([]);
  });

  it('reads nothing and keeps the last read when the switch is refused', async () => {
    const kv = linkedKv();
    kv.set(PARENT_KEYS.schools, JSON.stringify(scan()));
    const last = { at: '2026-11-01T08:00:00.000Z', entities: [{ kind: 'grade', naturalKey: 'k1', payload: { grade: 90 } }], counts: {} };
    kv.set(KEYS.read, JSON.stringify(last));
    const { asked, fetchImpl } = mashov({ status: 403, headers: { Reason: 'ChangePass' } });
    const outcome = await syncMashov({ kv, api: () => parentReadApi({ kv, settings: parent, fetchImpl, jar: jarAt('1') }), zone: 'Asia/Jerusalem' }, { force: true });
    expect(outcome).toEqual({ kind: 'failed', error: PARENT_SCHOOLS_COPY.changePass('תיכון ב') });
    expect(asked).toEqual(['/api/changeSchool/2']);
    expect(localRead(kv)).toEqual(last);
    expect(localStatus(kv)).toMatchObject({ needsLogin: false, lastError: PARENT_SCHOOLS_COPY.changePass('תיכון ב') });
    expect(localStatus(kv).lastError).not.toContain('g2');
  });

  it('reads nothing when Mashov says yes to the switch and the session stays where it was', async () => {
    const kv = linkedKv();
    kv.set(PARENT_KEYS.schools, JSON.stringify(scan()));
    const last = { at: '2026-11-01T08:00:00.000Z', entities: [{ kind: 'grade', naturalKey: 'k1', payload: { grade: 90 } }], counts: {} };
    kv.set(KEYS.read, JSON.stringify(last));
    const { asked, fetchImpl, jar } = mashov({ status: 200, body: schoolTwo, stay: true });
    await expect(parentReadApi({ kv, settings: parent, fetchImpl, jar })).rejects.toBeInstanceOf(ParentSchoolError);
    const outcome = await syncMashov({ kv, api: () => parentReadApi({ kv, settings: parent, fetchImpl, jar }), zone: 'Asia/Jerusalem' }, { force: true });
    expect(outcome).toEqual({ kind: 'failed', error: PARENT_SCHOOLS_COPY.refused('תיכון ב') });
    // Only the switches: no read of school 1's session under the child's guid.
    expect(asked).toEqual(['/api/changeSchool/2', '/api/changeSchool/2']);
    expect(localRead(kv)).toEqual(last);
    expect(localStatus(kv).needsLogin).toBe(false);

    // A token that names no school cannot be checked: the read goes on, as before the switch.
    const bare = mashov({ status: 200, body: schoolTwo });
    const noSemel = `h.${Buffer.from(JSON.stringify({ UserId: 'parent-guid' })).toString('base64url')}.s`;
    await (await parentReadApi({ kv: linkedKv(), settings: parent, fetchImpl: bare.fetchImpl, jar: async () => ({ MashovAuthToken: noSemel }) })).grades();
    expect(bare.asked).toEqual(['/api/changeSchool/2', '/api/students/g2/grades']);
  });

  it('needs a login when the switch answers 401', async () => {
    const kv = linkedKv();
    const { asked, fetchImpl, jar } = mashov({ status: 401 });
    const outcome = await syncMashov({ kv, api: () => parentReadApi({ kv, settings: parent, fetchImpl, jar }), zone: 'Asia/Jerusalem' }, { force: true });
    expect(outcome.kind).toBe('needs-login');
    expect(asked).toEqual(['/api/changeSchool/2']);
    expect(localStatus(kv).needsLogin).toBe(true);
  });

  it('words each refusal, and leaves a dead session or no answer to the usual paths', () => {
    const names = { child: 'נועה', school: 'תיכון ב' };
    const refusal = (status: number, reason: string | null) => schoolSwitchError({ status, reason, view: null }, names);
    expect(refusal(200, null)).toBeNull();
    expect(refusal(403, 'BindNotFound')!.message).toBe(PARENT_SCHOOLS_COPY.bindGone('נועה'));
    expect(refusal(403, 'ChangePass')!.message).toBe(PARENT_SCHOOLS_COPY.changePass('תיכון ב'));
    expect(refusal(403, 'SchoolClosed')!.message).toBe(PARENT_SCHOOLS_COPY.refused('תיכון ב', 'SchoolClosed'));
    expect(refusal(500, null)!.message).toBe(PARENT_SCHOOLS_COPY.refused('תיכון ב', '500'));
    for (const r of [refusal(403, 'BindNotFound'), refusal(403, 'ChangePass'), refusal(403, 'SchoolClosed'), refusal(500, null)]) {
      expect(r).toBeInstanceOf(ParentSchoolError);
      expect(r).not.toHaveProperty('needsReauth');
    }
    // A session Mashov no longer knows needs a login, so the device pass can renew it.
    expect(refusal(401, null)).toMatchObject({ needsReauth: true });
    expect(refusal(403, null)).toMatchObject({ needsReauth: true });
    // No answer: a plain failure, tried again on the next read.
    const network = refusal(0, 'network')!;
    expect(network).not.toBeInstanceOf(ParentSchoolError);
    expect(network).not.toHaveProperty('needsReauth');
    expect(isParentReadError(network.message)).toBe(false);
  });

  it('is not "Mashov disconnected" when a school refused', () => {
    const messages = [
      PARENT_SCHOOLS_COPY.bindGone('נועה'), PARENT_SCHOOLS_COPY.bindGone(''),
      PARENT_SCHOOLS_COPY.changePass('תיכון ב'), PARENT_SCHOOLS_COPY.changePass(''),
      PARENT_SCHOOLS_COPY.refused('תיכון ב', 'SchoolClosed'), PARENT_SCHOOLS_COPY.refused(''), PARENT_SCHOOLS_COPY.refused('תיכון (ב)', '403'),
    ];
    for (const m of messages) {
      // As the read's error is kept: a string, read back from storage.
      const kept = JSON.parse(JSON.stringify({ lastError: new ParentSchoolError(m).message })) as { lastError: string };
      expect(isParentReadError(kept.lastError)).toBe(true);
    }
    expect(PARENT_SCHOOLS_COPY.changePass('תיכון ב')).toBe('משוב מבקש להחליף סיסמה בתיכון ב. אפשר להיכנס לאתר של משוב ולהחליף שם.');
    expect(PARENT_SCHOOLS_COPY.changePass('')).not.toMatch(/ב\./);
    expect(isParentReadError('Mashov returned 401')).toBe(false);
    expect(isParentReadError(null)).toBe(false);
  });
});

describe('the lines about children the login cannot read', () => {
  const kid = (guid: string, firstName: string, semel: string, bound: boolean): ScannedChild =>
    ({ guid, firstName, classCode: bound ? 'ט' : '', classNum: bound ? '2' : '', semel, bound });
  const school = (semel: string, name: string, children: ScannedChild[]): SchoolScan =>
    ({ semel, name, home: semel === '1', site: null, siteKnown: true, switched: semel === '1' ? null : { status: 200, reason: null }, children, externGuidsSeen: null });
  const scanOf = (...schools: SchoolScan[]): ParentSchools => ({ at: '2026-11-02T08:00:00.000Z', home: '1', schools, back: null });

  it('says one line for each unbound child, in scan order, each child once', () => {
    const scan = scanOf(
      school('1', '', [kid('g1', 'נועה', '1', true), kid('g2', 'דן', '1', false)]),
      school('2', 'תיכון ב', [kid('g3', 'מיה', '2', false), kid('g2', 'דן', '2', false)]),
    );
    expect(unboundLines(scan)).toEqual([
      PARENT_SCHOOLS_COPY.unbound('דן', ''),
      PARENT_SCHOOLS_COPY.unbound('מיה', 'תיכון ב'),
    ]);
    expect(unboundLines(scan)[1]).toBe('מיה בתיכון ב: צריך לקשר במשוב, ואז להתחבר שוב');
  });

  it('says nothing for bound children, a child bound at another school, or a scan with nobody', () => {
    expect(unboundLines(scanOf(school('1', '', [kid('g1', 'נועה', '1', true)])))).toEqual([]);
    expect(unboundLines(scanOf(school('1', '', [])))).toEqual([]);
    // Bound where the login can read it: not a child to bind.
    expect(unboundLines(scanOf(school('1', '', [kid('g2', 'דן', '1', false)]), school('2', 'תיכון ב', [kid('g2', 'דן', '2', true)])))).toEqual([]);
  });

  it('reads without a dangling "ב" when a name is empty, and keeps no guid or family name', () => {
    expect(PARENT_SCHOOLS_COPY.unbound('דן', '')).toBe('דן בבית הספר: צריך לקשר במשוב, ואז להתחבר שוב');
    expect(PARENT_SCHOOLS_COPY.unbound('', 'תיכון ב')).toBe('ילד או ילדה בתיכון ב: צריך לקשר במשוב, ואז להתחבר שוב');
    const lines = unboundLines(scanOf(school('1', '', [kid('guid-secret', 'דן', '1', false)])));
    expect(lines.join('')).not.toContain('guid-secret');
  });
});

describe('what the login screen says about the scan', () => {
  const kid = (guid: string, firstName: string, semel: string, bound: boolean): ScannedChild =>
    ({ guid, firstName, classCode: bound ? 'ט' : '', classNum: bound ? '2' : '', semel, bound });
  const school = (semel: string, name: string, children: ScannedChild[], switched: SchoolScan['switched'] = semel === '1' ? null : { status: 200, reason: null }): SchoolScan =>
    ({ semel, name, home: semel === '1', site: null, siteKnown: true, switched, children, externGuidsSeen: null });
  const scanOf = (...schools: SchoolScan[]): ParentSchools => ({ at: '2026-11-02T08:00:00.000Z', home: '1', schools, back: null });
  const empty = { link: [], add: [], ask: [], unbound: [], full: [], later: [] };

  it('says how many children came, and why any did not', () => {
    const schools = scanOf(
      school('1', '', [kid('g1', 'נועה', '1', true)]),
      school('2', 'תיכון ב', [], { status: 403, reason: 'BindNotFound' }),
      school('3', 'תיכון ג', [kid('g3', 'דן', '3', false)]),
    );
    expect(scanSummary({ schools, plan: empty, added: 2 })).toEqual({
      added: 'נוספו 2 ילדים ממשוב',
      lines: ['דן בתיכון ג: צריך לקשר במשוב, ואז להתחבר שוב', 'משוב לא העביר את החיבור לתיכון ב.'],
    });
    expect(scanSummary({ schools, plan: empty, added: 1 }).added).toBe('נוסף ילד אחד ממשוב');
    expect(scanSummary({ schools, plan: empty, added: 0 }).added).toBeNull();
    // Children past the cap are said once, after the unbound ones.
    const full = scanSummary({ schools, plan: { ...empty, full: [kid('g9', 'מיה', '3', true)] }, added: 0 });
    expect(full.lines).toEqual([
      'דן בתיכון ג: צריך לקשר במשוב, ואז להתחבר שוב',
      PARENT_SCHOOLS_COPY.full,
      'משוב לא העביר את החיבור לתיכון ב.',
    ]);
  });

  it('says how many children wait for the next connection', () => {
    const schools = scanOf(school('1', '', [kid('g1', 'נועה', '1', true)]));
    const later = (n: number) => ({ ...empty, later: Array.from({ length: n }, (_, i) => kid(`g${i + 5}`, 'מיה', '1', true)) });
    expect(scanSummary({ schools, plan: later(1), added: 1 })).toEqual({ added: 'נוסף ילד אחד ממשוב', lines: ['עוד ילד אחד שמשוב רשם יתווסף בחיבור הבא למשוב'] });
    expect(scanSummary({ schools, plan: later(3), added: 0 }).lines).toEqual([PARENT_SCHOOLS_COPY.later(3)]);
    expect(PARENT_SCHOOLS_COPY.later(3)).toBe('עוד 3 ילדים שמשוב רשם יתווספו בחיבור הבא למשוב');
    // After the cap's line, before a school that refused.
    const refusedToo = scanOf(school('1', '', []), school('2', 'תיכון ב', [], { status: 403, reason: 'X' }));
    expect(scanSummary({ schools: refusedToo, plan: { ...later(2), full: [kid('g9', 'מיה', '3', true)] }, added: 0 }).lines)
      .toEqual([PARENT_SCHOOLS_COPY.full, PARENT_SCHOOLS_COPY.later(2), PARENT_SCHOOLS_COPY.refused('תיכון ב')]);
  });

  it('says nothing about a scan that brought everyone and was refused nowhere', () => {
    const schools = scanOf(school('1', '', [kid('g1', 'נועה', '1', true)]), school('2', 'תיכון ב', [kid('g2', 'יואב', '2', true)]));
    expect(scanSummary({ schools, plan: empty, added: 1 })).toEqual({ added: 'נוסף ילד אחד ממשוב', lines: [] });
    // A school the scan did not try (no switch) was not refused.
    expect(scanSummary({ schools: scanOf(school('1', '', []), school('2', 'תיכון ב', [], null)), plan: empty, added: 0 }).lines).toEqual([]);
  });

  it('words the children by the copy rules', () => {
    const lines = [
      PARENT_SCHOOLS_COPY.added(1), PARENT_SCHOOLS_COPY.added(2), PARENT_SCHOOLS_COPY.added(5), PARENT_SCHOOLS_COPY.full,
      PARENT_SCHOOLS_COPY.whoIs('ט 2'), PARENT_SCHOOLS_COPY.whoIs(''), PARENT_SCHOOLS_COPY.notFound,
      PARENT_SCHOOLS_COPY.unbound('דן', 'תיכון ג'), PARENT_SCHOOLS_COPY.refused('תיכון ב'), PARENT_SCHOOLS_COPY.later(1), PARENT_SCHOOLS_COPY.later(4),
    ];
    for (const line of lines) expect(line).not.toMatch(/להצטרף|·| — |"/);
    expect(PARENT_SCHOOLS_COPY.whoIs('ט 2')).toContain('ט 2');
  });

  it('labels a choice by the first name and the school, with no dangling comma', () => {
    const option = (firstName: string, schoolName: string) => ({ ...kid('g1', firstName, '1', true), schoolName });
    expect(askOptionLabel(option('נועה', 'תיכון ב'))).toBe('נועה, תיכון ב');
    expect(askOptionLabel(option('נועה', ''))).toBe('נועה');
    expect(askOptionLabel(option('', 'תיכון ב'))).toBe('ילד או ילדה, תיכון ב');
    expect(askOptionLabel(option('נועה', 'תיכון ב'))).not.toContain('g1');
  });
});

describe('the read error on the login screen after an answer', () => {
  it('drops "Mashov did not find the child" once the child on screen is linked, and keeps any other error', () => {
    expect(readErrorNow(PARENT_SCHOOLS_COPY.notFound, false)).toBe(PARENT_SCHOOLS_COPY.notFound);
    expect(readErrorNow(PARENT_SCHOOLS_COPY.notFound, true)).toBeNull();
    const refused = PARENT_SCHOOLS_COPY.changePass('תיכון ב');
    expect(readErrorNow(refused, true)).toBe(refused);
    expect(readErrorNow(null, true)).toBeNull();
  });
});

describe('the first child of a list that begins after a scan', () => {
  const SITE = 'https://school-a.shahaf.site';
  const parent: UserSettings = { ...DEFAULT_SETTINGS, audience: 'parent', classId: 'a8', className: 'ח 1' };
  const nothing = { link: [], add: [], ask: [], unbound: [], full: [], later: [] };
  const kid = (guid: string, firstName: string): ScannedChild => ({ guid, firstName, classCode: 'ח', classNum: '1', semel: '1', bound: true });
  const scan: ParentSchools = {
    at: '2026-11-02T08:00:00.000Z', home: '1', back: null,
    schools: [{ semel: '1', name: '', home: true, site: SITE, siteKnown: true, switched: null, children: [kid('g1', 'נועה'), kid('g2', 'יואב')], externGuidsSeen: null }],
  };
  const YOAV = { link: { guid: 'g2', semel: '1' }, label: 'יואב', siteUrl: SITE, classId: 'b5', className: 'ה 3', withoutSite: false, schoolName: '' };
  const ids = () => {
    let n = 0;
    return () => `c${++n}`;
  };

  it("gives the phone's linked child Mashov's first name when a sibling begins the list", () => {
    const kv = memoryKv();
    kv.set(SCHOOL_SITE_KEYS.pasted, SITE);
    linkChild(kv, 'shown', { guid: 'g1', semel: '1' });
    expect(applyChildrenPlan(kv, parent, SITE, { ...nothing, add: [YOAV] }, ids(), {}, scan)).toBeNull();
    const list = readChildren(kv)!.list;
    expect(list.map((c) => c.label)).toEqual(['נועה', 'יואב']);
    expect(list[0]!.mashov).toEqual({ guid: 'g1', semel: '1' });
  });

  it('leaves the name empty when Mashov gives none or does not list the child, and a list that was there alone', () => {
    const named = memoryKv();
    linkChild(named, 'shown', { guid: 'g1', semel: '1' });
    applyChildrenPlan(named, parent, SITE, { ...nothing, add: [YOAV] }, ids(), {}, { ...scan, schools: [{ ...scan.schools[0]!, children: [kid('g1', ''), kid('g2', 'יואב')] }] });
    expect(readChildren(named)!.list.map((c) => c.label)).toEqual(['', 'יואב']);

    const unlisted = memoryKv();
    linkChild(unlisted, 'shown', { guid: 'g7', semel: '1' });
    applyChildrenPlan(unlisted, parent, SITE, { ...nothing, add: [YOAV] }, ids(), {}, scan);
    expect(readChildren(unlisted)!.list.map((c) => c.label)).toEqual(['', 'יואב']);

    // A list the parent already has is the parent's: a child left unnamed stays so.
    let n = 0;
    const kept = memoryKv();
    linkChild(kept, 'shown', { guid: 'g1', semel: '1' });
    applyChildrenPlan(kept, parent, SITE, { ...nothing, add: [YOAV] }, () => `k${++n}`, {});
    renameChild(kept, 'k1', '');
    applyChildrenPlan(kept, parent, SITE, { ...nothing, add: [{ ...YOAV, link: { guid: 'g3', semel: '1' }, label: 'דנה', classId: 'z' }] }, () => `k${++n}`, {}, scan);
    expect(readChildren(kept)!.list.map((c) => c.label)).toEqual(['', 'יואב', 'דנה']);
  });
});

describe("a class picked again for the child on screen", () => {
  const kid = (guid: string, classCode: string, classNum: string, bound = true): ScannedChild => ({ guid, firstName: 'נועה', classCode, classNum, semel: '1', bound });
  const scanWith = (...children: ScannedChild[]): ParentSchools => ({
    at: '2026-11-02T08:00:00.000Z', home: '1', back: null,
    schools: [{ semel: '1', name: '', home: true, site: null, siteKnown: true, switched: null, children, externGuidsSeen: null }],
  });
  const scan = scanWith(kid('g1', 'ח', '1'), kid('g2', 'ט', '2'));

  it("drops the lone child's link when its new class is not its Mashov child's", () => {
    const kv = memoryKv();
    linkChild(kv, 'shown', { guid: 'g1', semel: '1' });
    // The same class written another way: the link stays.
    expect(dropLinkOffClass(kv, "ח' 1", scan)).toBe(false);
    expect(shownMashovLink(kv)).toEqual({ guid: 'g1', semel: '1' });
    expect(dropLinkOffClass(kv, 'ט 2', scan)).toBe(true);
    expect(shownMashovLink(kv)).toBeNull();
    expect(kv.getString(ONLY_CHILD_LINK_KEY)).toBeUndefined();
  });

  it("drops only the child on screen's link in a list", () => {
    const kv = memoryKv();
    kv.set(CHILDREN_KEY, JSON.stringify({
      activeId: 'b',
      list: [
        { id: 'a', label: '', siteUrl: '', classId: 'a8', className: 'ח 1', hiddenSubjects: [], mashov: { guid: 'g1', semel: '1' } },
        { id: 'b', label: '', siteUrl: '', classId: 'b5', className: 'ז 3', hiddenSubjects: [], mashov: { guid: 'g2', semel: '1' } },
      ],
    }));
    expect(dropLinkOffClass(kv, 'ז 3', scan)).toBe(true);
    const list = readChildren(kv)!.list;
    expect(list[0]!.mashov).toEqual({ guid: 'g1', semel: '1' });
    expect(list[1]).not.toHaveProperty('mashov');
  });

  it('keeps the link when either class cannot be compared, or there is no scan', () => {
    const kv = memoryKv();
    linkChild(kv, 'shown', { guid: 'g1', semel: '1' });
    // A class name that reads as no grade, a Mashov child with no class, one the scan does not hold, or no scan.
    expect(dropLinkOffClass(kv, 'מרחב', scan)).toBe(false);
    expect(dropLinkOffClass(kv, 'ט 2', scanWith(kid('g1', '', '')))).toBe(false);
    expect(dropLinkOffClass(kv, 'ט 2', scanWith(kid('g7', 'ח', '1')))).toBe(false);
    expect(dropLinkOffClass(kv, 'ט 2', null)).toBe(false);
    expect(shownMashovLink(kv)).toEqual({ guid: 'g1', semel: '1' });
    // Nothing linked: nothing to drop.
    expect(dropLinkOffClass(memoryKv(), 'ט 2', scan)).toBe(false);
  });
});

describe('a parent whose child Mashov did not find', () => {
  it('says Mashov did not find the child on screen, not the class, once a scan exists', () => {
    const kv = memoryKv();
    kv.set(PARENT_KEYS.schools, JSON.stringify({ at: '2026-11-02T08:00:00.000Z', home: '1', back: null, schools: [] }));
    const parent = { ...DEFAULT_SETTINGS, audience: 'parent' as const, className: 'ח 1' };
    expect(parentRead(kv, parent, true)).toEqual({ missing: 'notFound' });
    expect(new ParentReadError('notFound').message).toBe(PARENT_SCHOOLS_COPY.notFound);
    // It says the next step: a login, whose scan looks for the child again.
    expect(PARENT_SCHOOLS_COPY.notFound).toContain('להתחבר שוב למשוב');
    expect(PARENT_SCHOOLS_COPY.notFound).not.toBe(PARENT_READ_COPY.none);
    // Kept as the read's error, it is still a parent's and not "Mashov disconnected".
    expect(isParentReadError(PARENT_SCHOOLS_COPY.notFound)).toBe(true);
    // Before a scan the class is all there is to go by, and the class is what is said.
    expect(new ParentReadError('none').message).toBe(PARENT_READ_COPY.none);
  });
});
