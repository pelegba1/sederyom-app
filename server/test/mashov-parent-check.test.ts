/**
 * The parents' check (app/src/mashov/parentCheck.ts; docs/parents-plan.md §7):
 * the checklist's ten items in one report a parent sends, with field names,
 * status codes and counts, and never a name, a grade, an ID number or an id.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ParentSchools } from '../../app/src/mashov/parentSchools';

vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { REPORT_HEAD, classShape, claimNames, describeBody, runParentCheck, storedCheck, withoutIds } = await import('../../app/src/mashov/parentCheck');
const { PARENT_READ_COPY, accessTokenView, keepChildren, noteAnswer, noteSessionEnd } = await import('../../app/src/mashov/parents');
const { PARENT_SCHOOLS_COPY } = await import('../../app/src/lib/connections');
const { DEVICE_KEYS } = await import('../../app/src/mashov/device');
const { KEYS } = await import('../../app/src/mashov/sync');
const { DISMISSED_KEY } = await import('../../app/src/local/children');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const NOW = new Date('2026-10-30T10:00:00.000Z');
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const LOGIN_TIME = Math.floor(Date.parse('2026-10-30T08:00:00.000Z') / 1000);
const JAR = {
  MashovAuthToken: jwt({ UserId: 'parent-guid', Semel: '123456', Year: '2027', LoginTime: String(LOGIN_TIME), IdNumber: '012345678', exp: LOGIN_TIME + 3600 }),
  'Csrf-Token': 'csrf-1',
};

const ANSWER = {
  credential: { userId: 'parent-guid', idNumber: '012345678', userType: 4, schoolUserType: 2 },
  accessToken: {
    children: [
      { childGuid: 'guid-noa', privateName: 'נועה', familyName: 'כהן', classCode: 'יא', classNum: 2 },
      { childGuid: 'guid-yoav', privateName: 'יואב', familyName: 'כהן', classCode: 'ח', classNum: 1 },
    ],
    schoolOptions: { hasParentsBehave: true, hasParentsRegularGrades: false },
  },
};

/** Mashov as the check meets it: a child's paths answer, the parent's own id is refused, the inbox has a page. */
function fakeMashov() {
  const asked: string[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
    const path = new URL(url).pathname;
    asked.push(`${path} ${init.headers['x-csrf-token'] ?? ''}`);
    const answer = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (path.includes('/students/parent-guid/')) return answer(403, '');
    if (path.endsWith('/grades')) return answer(200, [{ grade: 95, subjectName: 'מתמטיקה', teacherName: 'שרון' }]);
    if (path.endsWith('/changes')) return answer(200, { isEnabled: true, changes: [], cancellations: [] });
    if (path.includes('/mail/')) return answer(200, [{ conversationId: 'c-1', subject: 'טיול' }]);
    return answer(200, []);
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

function parentPhone() {
  const kv = memoryKv();
  keepChildren(kv, accessTokenView(ANSWER)!, 'login', new Date('2026-10-30T08:00:05.000Z'));
  noteAnswer(kv, { at: '2026-10-30T08:00:04.000Z', kind: 'login', status: 200, reason: null, gotPass: true });
  noteAnswer(kv, { at: '2026-10-30T07:59:00.000Z', kind: 'login', status: 401, reason: 'MfaRequired', gotPass: false });
  noteSessionEnd(kv, { needsLogin: true, loginAt: '2026-10-29T08:00:00.000Z', failedAt: '2026-10-29T16:06:00.000Z' });
  kv.set(DEVICE_KEYS.pass, '{"id":"p-1"}');
  kv.set(KEYS.status, JSON.stringify({ lastTriedAt: '2026-10-30T09:50:00.000Z', lastOkAt: '2026-10-30T09:50:00.000Z', lastError: null, needsLogin: false }));
  return kv;
}

/** No scan, one child on the phone: the check as it was before the schools. */
const NO_SCHOOLS = { schools: () => null, ensureSchool: async () => null };
const ONE_CHILD = [{ className: 'י״א 2', link: null, withoutSite: false }];

/** A scan of three schools, with names, semels and guids that must stay out of the report. */
const SCAN: ParentSchools = {
  at: '2026-10-30T08:00:10.000Z',
  home: '123456',
  schools: [
    {
      semel: '123456', name: '', home: true, site: 'https://secret-home.shahaf.site', siteKnown: true, switched: null, externGuidsSeen: null,
      children: [{ guid: 'guid-noa', firstName: 'נועה', classCode: 'יא', classNum: '2', semel: '123456', bound: true }],
    },
    {
      semel: '654321', name: 'תיכון אלון', home: false, site: null, siteKnown: true, switched: { status: 200, reason: null }, externGuidsSeen: true,
      children: [{ guid: 'guid-yoav', firstName: 'יואב', classCode: 'ח', classNum: '1', semel: '654321', bound: true }],
    },
    {
      semel: '777888', name: 'חטיבת הדר', home: false, site: null, siteKnown: false, switched: { status: 403, reason: 'ChangePass' }, externGuidsSeen: null,
      children: [{ guid: 'guid-tamar', firstName: 'תמר', classCode: '', classNum: '', semel: '777888', bound: true }],
    },
  ],
  back: { status: 200, reason: null },
};
const SCAN_SECRETS = ['123456', 'guid-tamar', 'תמר', '654321', '777888', 'תיכון אלון', 'חטיבת הדר', 'secret-home', 'shahaf.site'];

describe('the parents\' check', () => {
  it('goes through the ten items and tells which child on the phone is whom', async () => {
    const kv = parentPhone();
    const { fetchImpl, asked } = fakeMashov();
    const check = await runParentCheck({
      kv, fetchImpl, jar: async () => JAR, ...NO_SCHOOLS,
      phoneChildren: [{ className: 'י״א 2', link: { guid: 'guid-noa', semel: '123456' }, withoutSite: false }, { className: 'ז 3', link: null, withoutSite: true }], audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    const text = check.text;
    expect(text.startsWith(`${REPORT_HEAD[0]}\n${REPORT_HEAD[1]}\nSederYom 1.9.18 parent check ${NOW.toISOString()}`)).toBe(true);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(text).toMatch(new RegExp(`^${n}\\. `, 'm'));
    expect(text).toContain('login 200 pass 2.0h ago; login 401 MfaRequired 2.0h ago');
    expect(text).toContain('UserId is a child: no');
    expect(text).toContain('claims [IdNumber,LoginTime,Semel,UserId,Year,exp]');
    expect(text).toContain('children 2, inactive 0, extern 0');
    expect(text).toContain('classes: אא 9 | א 9');
    expect(text).toMatch(/child 1: timetable 200 list 0; changes 200 object \[cancellations,changes,isEnabled\]; homework 200 list 0; grades 200 list 1 \[grade,subjectName,teacherName\]/);
    expect(text).toContain('own id: timetable 403 empty');
    expect(text).toContain('hasParents: hasParentsBehave=true, hasParentsRegularGrades=false');
    expect(text).toContain('pass kept yes');
    expect(text).toContain('one session for every child: yes (2 of 2 timetables 200)');
    expect(text).toContain('mail: 200 list 1 [conversationId,subject]');
    expect(text).toContain('reasons: MfaRequired; sessions ended after: 8.1h');
    expect(text).toContain('1 (on screen) א״א 9 -> by link, site; 2 א 9 -> not linked, no site');
    expect(text).toContain('11. schools: none scanned');
    // Every read went with the CSRF token, and none wrote anything.
    expect(asked.every((a) => a.endsWith(' csrf-1'))).toBe(true);
    // Nothing that names or identifies anyone.
    for (const value of ['guid-noa', 'guid-yoav', 'parent-guid', 'נועה', 'יואב', 'כהן', '012345678', '123456', 'מתמטיקה', 'שרון', 'טיול', '95', 'csrf-1', 'p-1']) {
      expect(text).not.toContain(value);
    }
    expect(storedCheck(kv)).toEqual(check);
  });

  it('holds no identifying value of a scan either', async () => {
    const kv = parentPhone();
    const { fetchImpl } = fakeMashov();
    const { text } = await runParentCheck({
      kv, fetchImpl, jar: async () => JAR, schools: () => SCAN, ensureSchool: async () => null, phoneChildren: ONE_CHILD,
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    for (const value of [...SCAN_SECRETS, 'guid-noa', 'guid-yoav', 'נועה', 'יואב']) expect(text).not.toContain(value);
  });

  it('holds no identifying value when a school refuses and the trip home is told', async () => {
    const { fetchImpl } = fakeMashov();
    const { text } = await runParentCheck({
      kv: parentPhone(), fetchImpl, jar: async () => JAR, schools: () => SCAN, phoneChildren: ONE_CHILD,
      ensureSchool: async (semel) => ({ status: 403, reason: semel === SCAN.home ? 'Locked' : 'ChangePass', view: null }),
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    expect(text).toContain('child 2 (school 2): not read, changeSchool 403 ChangePass');
    expect(text).toContain('back home: changeSchool 403 Locked');
    for (const value of [...SCAN_SECRETS, 'guid-noa', 'guid-yoav', 'נועה', 'יואב']) expect(text).not.toContain(value);
  });

  it('goes back home even when a switch throws, and says so', async () => {
    const events: string[] = [];
    const fetchImpl = (async (url: string) => {
      const read = /\/students\/([^/]+)\/timetable$/.exec(new URL(url).pathname);
      if (read) events.push(`read ${read[1]}`);
      return { status: 200, text: async () => '[]' };
    }) as unknown as typeof fetch;
    const { text } = await runParentCheck({
      kv: parentPhone(), fetchImpl, jar: async () => JAR, schools: () => SCAN, phoneChildren: ONE_CHILD,
      ensureSchool: async (semel) => {
        events.push(`school ${semel}`);
        if (semel === '654321') throw new Error('storage failed');
        return events.length > 1 ? { status: 200, reason: null, view: null } : null;
      },
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    expect(events).toEqual(['school 123456', 'read guid-noa', 'school 654321', 'school 123456', 'read parent-guid']);
    expect(text).toContain('4. error storage failed');
    expect(text).toMatch(/^9\. /m);
  });

  it('says a failed trip home without hiding the rest', async () => {
    let visited = false;
    const { fetchImpl } = fakeMashov();
    const { text } = await runParentCheck({
      kv: parentPhone(), fetchImpl, jar: async () => JAR, schools: () => SCAN, phoneChildren: ONE_CHILD,
      ensureSchool: async (semel) => {
        // The session starts at home (no request); only the trip back fails.
        if (semel === SCAN.home) {
          if (visited) throw new Error('jar failed');
          return null;
        }
        visited = true;
        return { status: 200, reason: null, view: null };
      },
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    expect(text).toContain('back home: changeSchool 0 error');
  });

  it('reports each school without naming it', async () => {
    const { fetchImpl } = fakeMashov();
    const { text } = await runParentCheck({
      kv: parentPhone(), fetchImpl, jar: async () => JAR, schools: () => SCAN, ensureSchool: async () => null, phoneChildren: ONE_CHILD,
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    expect(text.split('\n').filter((l) => l.startsWith('11. '))).toEqual([
      '11. schools 3; school 1 home: children 1, bound 1, added 0, later 1, site yes; school 2: changeSchool 200, children 1, bound 1, added 0, later 1, guids seen yes, site no; school 3: changeSchool 403 ChangePass, children 1, bound 1, added 0, later 1; back home 200',
    ]);
  });

  it("counts each school's children on the phone and the ones still to come, by number only", async () => {
    const { fetchImpl } = fakeMashov();
    const kv = parentPhone();
    // Taken off the list by the parent: not a child to come.
    kv.set(DISMISSED_KEY, JSON.stringify(['guid-tamar']));
    const { text } = await runParentCheck({
      kv, fetchImpl, jar: async () => JAR, schools: () => SCAN, ensureSchool: async () => null,
      phoneChildren: [
        { className: 'י״א 2', link: { guid: 'guid-noa', semel: '123456' }, withoutSite: false },
        { className: 'ח 1', link: { guid: 'guid-yoav', semel: '654321' }, withoutSite: false },
      ],
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    const line = text.split('\n').find((l) => l.startsWith('11. '))!;
    expect(line).toContain('school 1 home: children 1, bound 1, added 1, later 0,');
    expect(line).toContain('school 2: changeSchool 200, children 1, bound 1, added 1, later 0,');
    expect(line).toContain('school 3: changeSchool 403 ChangePass, children 1, bound 1, added 0, later 0;');
    for (const secret of SCAN_SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain('guid-noa');
    expect(text).not.toContain('guid-yoav');
  });

  it('reads each child in its own school, then goes back', async () => {
    const events: string[] = [];
    const fetchImpl = (async (url: string) => {
      const read = /\/students\/([^/]+)\/timetable$/.exec(new URL(url).pathname);
      if (read) events.push(`read ${read[1]}`);
      return { status: 200, text: async () => '[]' };
    }) as unknown as typeof fetch;
    const { text } = await runParentCheck({
      kv: parentPhone(), fetchImpl, jar: async () => JAR, schools: () => SCAN, phoneChildren: ONE_CHILD,
      ensureSchool: async (semel) => {
        events.push(`school ${semel}`);
        if (semel === '654321') return { status: 200, reason: null, view: null };
        if (semel === '777888') return { status: 403, reason: 'ChangePass', view: null };
        // The session starts at home (no request); at the end it has to come back.
        return events.length > 1 ? { status: 200, reason: null, view: null } : null;
      },
      audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    // Each school is entered before its children are read, the refused one is not read, and the home school comes before item 5 reads the parent's own id.
    expect(events).toEqual(['school 123456', 'read guid-noa', 'school 654321', 'read guid-yoav', 'school 777888', 'school 123456', 'read parent-guid']);
    expect(text).toMatch(/child 2 \(school 2\): timetable 200 list 0;/);
    expect(text).toContain('child 3 (school 3): not read, changeSchool 403 ChangePass');
    expect(text).toContain('back home: changeSchool 200');
    expect(text).toContain('one session for every child: no (2 of 3 timetables 200)');
  });

  it('says which kind of error stopped the read, without a name', async () => {
    const kinds: [string, string][] = [
      [PARENT_SCHOOLS_COPY.notFound, 'not linked'],
      [PARENT_SCHOOLS_COPY.bindGone('נועה'), 'school refused'],
      [PARENT_SCHOOLS_COPY.changePass('תיכון אלון'), 'school refused'],
      [PARENT_SCHOOLS_COPY.refused('תיכון אלון', 'Locked'), 'school refused'],
      [PARENT_READ_COPY.none, 'no single child in the class on screen'],
      [PARENT_READ_COPY.several, 'no single child in the class on screen'],
      ['Mashov /api/students/guid-noa/grades returned HTTP 500', 'Mashov /api/students/<id>/grades returned HTTP 500'],
    ];
    for (const [lastError, said] of kinds) {
      const kv = parentPhone();
      kv.set(KEYS.status, JSON.stringify({ lastTriedAt: '2026-10-30T09:50:00.000Z', lastOkAt: null, lastError, needsLogin: false }));
      const { fetchImpl } = fakeMashov();
      const { text } = await runParentCheck({
        kv, fetchImpl, jar: async () => JAR, ...NO_SCHOOLS, phoneChildren: ONE_CHILD, audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
      });
      expect(text).toContain(`error: ${said}\n`);
      expect(text).not.toContain('נועה');
      expect(text).not.toContain('תיכון אלון');
    }
  });

  it('reports what the page saw even when no login came of it', async () => {
    const kv = memoryKv();
    noteAnswer(kv, { at: '2026-10-30T09:59:00.000Z', kind: 'login', status: 401, reason: 'NoParentsAccess', gotPass: false });
    const { fetchImpl } = fakeMashov();
    const { text } = await runParentCheck({
      kv, fetchImpl, jar: async () => ({ 'Some.Cookie': 'x' }), ...NO_SCHOOLS, phoneChildren: ONE_CHILD, audience: 'parent', appVersion: '1.9.18', zone: 'Asia/Jerusalem', now: () => NOW,
    });
    expect(text).toContain('login 401 NoParentsAccess');
    expect(text).toContain('token: cookie no');
    expect(text).toContain('cookies [Some.Cookie]');
    expect(text).toContain('3. no accessToken seen');
    expect(text).toContain('4. no children to read');
    expect(text).toContain('own id: no token');
    expect(text).toContain('read: none kept');
  });

  it('says each answer without its values', () => {
    expect(describeBody('')).toBe('empty');
    expect(describeBody('<!doctype html>')).toBe('html');
    expect(describeBody('[{"a":1,"b":2},{"c":3}]')).toBe('list 2 [a,b,c]');
    expect(describeBody('{"isEnabled":true,"a1b2c3d4e5f6a7b8c9":1}')).toBe('object [isEnabled]');
    expect(describeBody('"https://x.shahaf.site"')).toBe('string');
    expect(describeBody('not json')).toBe('text');
    expect(withoutIds('Mashov /api/students/2f1c9a7e-1b2c-4d5e-8f90-123456789abc/grades returned HTTP 500')).toBe('Mashov /api/students/<id>/grades returned HTTP 500');
    expect(classShape('י״א 2 מדעים')).toBe('א״א 9 אאאאא');
    expect(claimNames(jwt({ UserId: 'x', Name: 'נועה' }))).toEqual(['Name', 'UserId']);
    expect(claimNames('not-a-jwt')).toEqual([]);
  });
});
