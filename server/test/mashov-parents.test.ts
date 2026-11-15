/**
 * Parents mode, stage 3 (docs/parents-plan.md §7): a parent's Mashov login
 * (app/src/mashov/parents.ts). The login page hands over each answer's
 * children, cut down to their guids, first names and classes; the read goes
 * by the guid of the child on screen, matched by class; and each child's
 * Mashov read is kept with the child.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@sederyom/shared';

vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}) } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  ACCESS_TOKEN_VIEW_JS, PARENT_KEYS, PARENT_READ_COPY, accessTokenView, childFor, classKeyOf, forParent, isParentReadError, keepChildren, loginAnswers,
  mashovChildren, noteSessionEnd, parentRead, readView, sessionEnds, takeLoginBody, takeParentMessage,
} = await import('../../app/src/mashov/parents');
const { DEVICE_KEYS, DEVICE_LOGIN_PATCH, loginPagePatch, loginWithDevicePass } = await import('../../app/src/mashov/device');
const { phoneMashovApi } = await import('../../app/src/mashov/phone');
const { KEYS, readMashovSoon } = await import('../../app/src/mashov/sync');
const {
  CHILD_KEYS, LESSONS_FILLED_KEY, LINK_LESSONS_KEY, addChild, dropLinkLessons, keepLinkLessons, lessonsFilled, linkLessonCodes, markLessonsFilled,
  readChildren, stashKey, stashedChild, switchChild,
} = await import('../../app/src/local/children');
const { PARENT_GOOGLE_COPY, PARENT_MASHOV_COPY, mashovWasRead } = await import('../../app/src/lib/connections');
const { LESSONS_COPY, lessonsFromMashov, schoolTabsFor } = await import('../../app/src/lib/school');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}

/** A parent's login answer, the way Mashov's client reads it: names and an ID number it must never pass on. */
const ANSWER = {
  credential: { userId: 'parent-guid', idNumber: '012345678', userType: 4, schoolUserType: 2, semel: 123456, year: 2027 },
  accessToken: {
    children: [
      { childGuid: 'guid-noa', privateName: 'נועה', familyName: 'כהן', classCode: 'יא', classNum: 2, schoolName: 'תיכון' },
      { childGuid: 'guid-yoav', privateName: 'יואב', familyName: 'כהן', classCode: 'ח', classNum: '1', schoolName: 'תיכון' },
    ],
    inactiveChildren: [],
    externChildren: [{ childGuid: 'guid-far', privateName: 'עדי', familyName: 'כהן', semel: 654321, bound: true }],
    schoolOptions: { hasParentsBehave: true, hasParentsRegularGrades: false, hasStudentsMoodle: true },
    displayName: 'הורה כהן',
  },
};

describe('a login answer, cut down', () => {
  it('keeps the children\'s guids, first names and classes, and only the names of everything else', () => {
    const view = accessTokenView(ANSWER)!;
    expect(view.children).toEqual([
      { childGuid: 'guid-noa', privateName: 'נועה', classCode: 'יא', classNum: '2' },
      { childGuid: 'guid-yoav', privateName: 'יואב', classCode: 'ח', classNum: '1' },
    ]);
    expect(view).toMatchObject({
      tokenFields: ['children', 'displayName', 'externChildren', 'inactiveChildren', 'schoolOptions'],
      childFields: ['childGuid', 'classCode', 'classNum', 'familyName', 'privateName', 'schoolName'],
      inactive: 0,
      extern: 1,
      externFields: ['bound', 'childGuid', 'familyName', 'privateName', 'semel'],
      userType: 4,
      schoolUserType: 2,
      userIsChild: false,
      parentOptions: { hasParentsBehave: true, hasParentsRegularGrades: false },
    });
    const text = JSON.stringify(view);
    expect(view.externs).toEqual([{ childGuid: 'guid-far', privateName: 'עדי', schoolName: '', semel: '654321', bound: true }]);
    expect(view.semel).toBe('123456');
    for (const value of ['012345678', 'כהן', 'הורה', 'parent-guid']) expect(text).not.toContain(value);
  });

  it('is the same in the login page as on the phone', () => {
    const pageView = new Function(`${ACCESS_TOKEN_VIEW_JS}; return sederyomView;`)() as (b: unknown) => unknown;
    expect(pageView(ANSWER)).toEqual(accessTokenView(ANSWER));
    const student = { credential: { userId: 'guid-noa' }, accessToken: { children: [ANSWER.accessToken.children[0]] } };
    expect(pageView(student)).toEqual(accessTokenView(student));
    expect(accessTokenView(student)!.userIsChild).toBe(true);
    for (const body of [null, {}, { accessToken: [] }, 'x']) {
      expect(pageView(body)).toBeNull();
      expect(accessTokenView(body)).toBeNull();
    }
  });

  it('checks a posted view field by field', () => {
    expect(readView({ children: 'x' })).toBeNull();
    const view = readView({
      children: [{ childGuid: 'g', privateName: 'נועה', classCode: 'יא', classNum: 2, idNumber: '1' }, { privateName: 'no guid' }],
      tokenFields: ['children', 'a1b2c3d4e5f6a7b8c9d0', '0bad', 'with-dash'],
      parentOptions: { hasParentsBehave: true, other: true, hasParentsGrades: 'yes' },
      inactive: -3,
    })!;
    expect(view.children).toEqual([{ childGuid: 'g', privateName: 'נועה', classCode: 'יא', classNum: '2' }]);
    expect(view.tokenFields).toEqual(['children']);
    expect(view.parentOptions).toEqual({ hasParentsBehave: true });
    expect(view.inactive).toBe(0);
  });
});

/** Runs a patch against a stand-in page: an XHR that answers `answer`, and a bridge that collects messages. */
function runPatch(patch: string, answer: { status?: number; body?: unknown; headers?: Record<string, string>; json?: boolean } = {}) {
  const posted: Record<string, unknown>[] = [];
  const sent: { url: string; body: unknown }[] = [];
  class FakeXhr {
    status = answer.status ?? 200;
    responseType = answer.json ? 'json' : '';
    private listeners: (() => void)[] = [];
    private url = '';
    get responseText() {
      if (this.responseType === 'json') throw new Error('InvalidStateError');
      return answer.body === undefined ? '' : JSON.stringify(answer.body);
    }
    get response() { return answer.json ? answer.body : this.responseText; }
    open(_method: string, url: string) { this.url = url; }
    send(body: unknown) { sent.push({ url: this.url, body }); this.listeners.forEach((l) => l()); }
    addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
    getResponseHeader(name: string) { return answer.headers?.[name] ?? null; }
  }
  const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) } };
  new Function('window', 'XMLHttpRequest', patch)(window, FakeXhr);
  const post = (url: string, body: string) => {
    const xhr = new FakeXhr();
    xhr.open('POST', url);
    xhr.send(body);
  };
  return { posted, sent, post };
}

const LOGIN_BODY = JSON.stringify({ semel: 123456, year: 2027, username: 'parent', password: 'secret', appName: 'info.mashov.students' });

describe('the login page on a parent\'s phone', () => {
  it('hands over the login answer\'s children and how it went, leaving the login as the site sent it', () => {
    const { posted, sent, post } = runPatch(loginPagePatch({ tick: false, observe: true }), { body: ANSWER, headers: { Reason: 'NoParentsAccess' } });
    post('https://web.mashov.info/api/login', LOGIN_BODY);
    expect(sent[0]!.body).toBe(LOGIN_BODY);
    expect(posted).toEqual([
      { type: 'sederyom-parent-answer', kind: 'login', status: 200, reason: 'NoParentsAccess', gotPass: false },
      { type: 'sederyom-mashov-children', from: 'login', view: accessTokenView(ANSWER) },
    ]);
    const text = JSON.stringify(posted);
    for (const value of ['secret', '012345678', 'כהן', 'parent-guid']) expect(text).not.toContain(value);
  });

  it('reads a body the page asked for as JSON, and names a change of school without its school', () => {
    const { posted, post } = runPatch(loginPagePatch({ tick: false, observe: true }), { body: ANSWER, json: true });
    post('https://web.mashov.info/api/changeSchool/654321/2027', '{}');
    expect(posted.map((m) => [m.type, m.kind ?? m.from])).toEqual([['sederyom-parent-answer', 'changeSchool'], ['sederyom-mashov-children', 'changeSchool']]);
  });

  it('tells a one-time code\'s request and an MFA code\'s answer apart, and gives the trial a pass the MFA answer carries', () => {
    const { posted, post } = runPatch(loginPagePatch({ tick: true, observe: true }), { headers: { devicePass: '{"id":"p-2"}' } });
    post('https://web.mashov.info/api/user/otp/request', '{}');
    post('https://web.mashov.info/api/login/mfa/verify', '{}');
    expect(posted).toEqual([
      { type: 'sederyom-parent-answer', kind: 'user/otp/request', status: 200, reason: null, gotPass: true },
      { type: 'sederyom-parent-answer', kind: 'login/mfa/verify', status: 200, reason: null, gotPass: true },
      { type: 'sederyom-device-pass', status: 200, pass: '{"id":"p-2"}' },
    ]);
  });

  it('still ticks "personal device" when the trial is on', () => {
    const { posted, sent, post } = runPatch(loginPagePatch({ tick: true, observe: true }), { body: ANSWER, headers: { devicePass: '{"id":"p-1"}' } });
    post('https://web.mashov.info/api/login', LOGIN_BODY);
    expect(JSON.parse(sent[0]!.body as string)).toMatchObject({ isPrivateDevice: true });
    expect(posted.map((m) => m.type)).toEqual(['sederyom-device-fields', 'sederyom-device-pass', 'sederyom-parent-answer', 'sederyom-mashov-children']);
    expect(JSON.stringify(posted)).not.toContain('secret');
  });

  it('is not on a student\'s login page', () => {
    const { posted, post } = runPatch(DEVICE_LOGIN_PATCH, { body: ANSWER });
    post('https://web.mashov.info/api/loginDevice', '{}');
    post('https://web.mashov.info/api/login', LOGIN_BODY);
    expect(posted.map((m) => m.type)).toEqual(['sederyom-device-fields', 'sederyom-device-pass']);
  });
});

describe('keeping what the page handed over', () => {
  it('keeps the children and each answer', () => {
    const kv = memoryKv();
    const at = new Date('2026-10-30T08:00:00Z');
    expect(takeParentMessage(kv, JSON.stringify({ type: 'sederyom-mashov-children', from: 'login', view: accessTokenView(ANSWER) }), at)).toBe(true);
    expect(mashovChildren(kv)).toMatchObject({
      at: at.toISOString(),
      from: 'login',
      list: [
        { guid: 'guid-noa', firstName: 'נועה', classCode: 'יא', classNum: '2' },
        { guid: 'guid-yoav', firstName: 'יואב', classCode: 'ח', classNum: '1' },
      ],
      shape: { extern: 1, userIsChild: false },
    });
    takeParentMessage(kv, JSON.stringify({ type: 'sederyom-parent-answer', kind: 'login', status: 401, reason: 'Mfa Required!', gotPass: false }), at);
    expect(loginAnswers(kv)).toEqual([{ at: at.toISOString(), kind: 'login', status: 401, reason: 'Mfa?Required?', gotPass: false }]);
    for (let i = 0; i < 20; i += 1) takeParentMessage(kv, JSON.stringify({ type: 'sederyom-parent-answer', kind: 'login', status: 200 }), at);
    expect(loginAnswers(kv)).toHaveLength(15);
    // Anything else is somebody else's message.
    expect(takeParentMessage(kv, JSON.stringify({ type: 'sederyom-device-pass', status: 200 }))).toBe(false);
    expect(takeParentMessage(kv, 'sederyom-touch:x')).toBe(false);
  });

  it('never empties a list from the page\'s own storage', () => {
    const kv = memoryKv();
    keepChildren(kv, accessTokenView(ANSWER)!, 'login');
    keepChildren(kv, { ...accessTokenView(ANSWER)!, children: [] }, 'page');
    expect(mashovChildren(kv)!.list).toHaveLength(2);
    keepChildren(kv, { ...accessTokenView(ANSWER)!, children: [] }, 'login');
    expect(mashovChildren(kv)!.list).toHaveLength(0);
  });

  it('reads the list again from the phone\'s own loginDevice answer', async () => {
    const kv = memoryKv();
    kv.set(DEVICE_KEYS.pass, '{"id":"p-1"}');
    const answers: unknown[] = [];
    const fetchImpl = (async () => ({
      ok: true, status: 200, headers: { get: (n: string) => (n === 'devicePass' ? '{"id":"p-3"}' : null) }, text: async () => JSON.stringify(ANSWER),
    })) as unknown as typeof fetch;
    expect(await loginWithDevicePass(kv, fetchImpl, new Date(), (a) => {
      answers.push(a);
      takeLoginBody(kv, a.body, 'loginDevice');
    })).toBe(true);
    expect(answers).toEqual([expect.objectContaining({ status: 200, gotPass: true, reason: null })]);
    expect(mashovChildren(kv)).toMatchObject({ from: 'loginDevice', list: [{ guid: 'guid-noa' }, { guid: 'guid-yoav' }] });
    // A student's re-login reads no body.
    const student = memoryKv();
    student.set(DEVICE_KEYS.pass, '{"id":"p-1"}');
    const noBody = (async () => ({ ok: true, status: 200, headers: { get: () => null } })) as unknown as typeof fetch;
    expect(await loginWithDevicePass(student, noBody)).toBe(true);
    expect(mashovChildren(student)).toBeNull();
  });

  it('notes once how long a session lasted', () => {
    const kv = memoryKv();
    const ended = { needsLogin: true, loginAt: '2026-10-30T06:00:00.000Z', failedAt: '2026-10-30T14:05:00.000Z' };
    noteSessionEnd(kv, ended);
    noteSessionEnd(kv, ended);
    noteSessionEnd(kv, { ...ended, needsLogin: false, failedAt: '2026-10-31T14:05:00.000Z' });
    noteSessionEnd(kv, { needsLogin: true, loginAt: null, failedAt: '2026-10-31T14:05:00.000Z' });
    expect(sessionEnds(kv)).toEqual([{ loginAt: ended.loginAt, endedAt: ended.failedAt }]);
  });
});

describe('whose Mashov a read is', () => {
  const list = [
    { guid: 'guid-noa', firstName: 'נועה', classCode: 'יא', classNum: '2' },
    { guid: 'guid-yoav', firstName: 'יואב', classCode: 'ח', classNum: '1' },
  ];

  it('matches the class on screen however the site and Mashov write it', () => {
    expect(classKeyOf('י״א 2')).toBe(classKeyOf('יא 2'));
    expect(classKeyOf("יא' 2 מדעים")).toBe('יא|2');
    expect(classKeyOf('מרחב למידה')).toBeNull();
    expect(childFor(list, 'י״א 2', false)).toEqual({ guid: 'guid-noa', by: 'class' });
    expect(childFor(list, 'ח-1', false)).toEqual({ guid: 'guid-yoav', by: 'class' });
  });

  it('takes Mashov\'s only child for a phone\'s only child, and never guesses between two', () => {
    expect(childFor([list[0]!], 'י״א 3', true)).toEqual({ guid: 'guid-noa', by: 'only' });
    expect(childFor([list[0]!], 'י״א 3', false)).toEqual({ missing: 'none' });
    expect(childFor(list, 'י״א 3', true)).toEqual({ missing: 'none' });
    const twins = [list[0]!, { ...list[0]!, guid: 'guid-twin', firstName: 'תמר' }];
    expect(childFor(twins, 'י״א 2', true)).toEqual({ missing: 'several' });
  });

  it('reads a student\'s phone, or a parent\'s with no list, as the login\'s own user', () => {
    const kv = memoryKv();
    const parent = { ...DEFAULT_SETTINGS, audience: 'parent' as const, className: 'י״א 2' };
    expect(parentRead(kv, parent, true)).toBeNull();
    keepChildren(kv, accessTokenView(ANSWER)!, 'login');
    expect(parentRead(kv, { ...parent, audience: 'student' }, true)).toBeNull();
    expect(parentRead(kv, parent, true)).toEqual({ guid: 'guid-noa', by: 'class' });
    expect(PARENT_READ_COPY.none).toMatch(/ילד או ילדה/);
    expect(isParentReadError(PARENT_READ_COPY.several)).toBe(true);
    expect(isParentReadError('Mashov returned 401')).toBe(false);
  });

  it('reads the child by its guid, and the parent\'s own login otherwise', async () => {
    const jwt = `h.${Buffer.from(JSON.stringify({ UserId: 'parent-guid', Semel: '123456' })).toString('base64url')}.s`;
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return { status: 200, text: async () => '[]' };
    }) as unknown as typeof fetch;
    const jar = async () => ({ MashovAuthToken: jwt, 'Csrf-Token': 'c' });
    await (await phoneMashovApi(fetchImpl, jar, 'guid-noa')).grades();
    await (await phoneMashovApi(fetchImpl, jar)).grades();
    expect(asked.map((u) => new URL(u).pathname)).toEqual(['/api/students/guid-noa/grades', '/api/students/parent-guid/grades']);
  });

  it('empties a part the school closed to parents, and still fails a read whose session is gone', async () => {
    const { AuthError } = await import('@sederyom/shared/logic/entities');
    const refuse = (message: string) => async () => { throw new AuthError(message); };
    const api = forParent({
      timetable: async () => [{ day: 1 }],
      grades: refuse('Mashov returned 403'),
      homework: refuse('Mashov /api/students/x/homework returned HTML: not logged in'),
      groups: async () => [],
      mail: refuse('Mashov returned 401'),
    } as never);
    expect(await api.timetable()).toEqual([{ day: 1 }]);
    expect(await api.grades()).toEqual([]);
    await expect(api.homework()).rejects.toMatchObject({ needsReauth: true });
    await expect(api.mail()).rejects.toMatchObject({ needsReauth: true });
  });
});

describe('each child\'s Mashov on a parent\'s phone', () => {
  it('goes aside with the child and comes back with it', () => {
    expect(CHILD_KEYS).toEqual(expect.arrayContaining([KEYS.read, KEYS.bagrut, 'mashov.gradeFirstSeen', 'local.homeworkState']));
    expect(CHILD_KEYS).not.toContain(KEYS.status);
    const kv = memoryKv();
    const site = 'https://school-c.shahaf.site';
    const shown = { ...DEFAULT_SETTINGS, audience: 'parent' as const, classId: '11', className: 'יא 2' };
    let n = 0;
    expect(addChild(kv, shown, site, { siteUrl: site, classId: '8', className: 'ח 1' }, () => `c${(n += 1)}`)).toBe('added');
    kv.set(KEYS.read, '{"at":"noa"}');
    kv.set(KEYS.status, '{"lastTriedAt":"2026-10-30T08:00:00.000Z","lastOkAt":"2026-10-30T08:00:00.000Z","lastError":null,"needsLogin":false}');
    const next = switchChild(kv, shown, readChildren(kv)!.list[1]!.id, site)!;
    expect(next.className).toBe('ח 1');
    expect(kv.getString(KEYS.read)).toBe('');
    expect(kv.getString(stashKey('c1', KEYS.read))).toBe('{"at":"noa"}');
    // The login is the parent's, and the next read is the new child's at once.
    readMashovSoon(kv);
    expect(JSON.parse(kv.getString(KEYS.status)!)).toMatchObject({ lastTriedAt: null, lastOkAt: '2026-10-30T08:00:00.000Z' });
  });

  it('brings School\'s Mashov tabs once a read worked, not when a read only found no login', () => {
    const mashov = (lastOkAt: string | null) => [{ source: 'mashov', lastOkAt, configured: true, needsReauth: lastOkAt === null }] as never;
    expect(mashovWasRead(mashov(null))).toBe(false);
    expect(mashovWasRead(mashov('2026-10-30T08:00:00.000Z'))).toBe(true);
    expect(mashovWasRead(undefined)).toBe(false);
    expect(schoolTabsFor({ bagrut: false, audience: 'parent', mashov: true }).map((t) => t.key)).toEqual(['exams', 'homework', 'grades', 'messages', 'attendance']);
    expect(schoolTabsFor({ bagrut: true, audience: 'parent', mashov: false }).map((t) => t.key)).toEqual(['exams', 'messages']);
  });

  it('words a parent\'s login by the copy rules', () => {
    const lines = Object.values(PARENT_MASHOV_COPY).map((v) => (typeof v === 'function' ? v(['נועה', 'יואב'] as never) : v));
    for (const line of [...lines, ...Object.values(PARENT_READ_COPY), ...Object.values(PARENT_GOOGLE_COPY)]) {
      expect(line).not.toMatch(/·| — |"/);
    }
    // Google on a parent's phone is the parent's own, and only if wanted.
    expect(PARENT_GOOGLE_COPY.use).toMatch(/^אם רוצים/);
    expect(PARENT_MASHOV_COPY.loginLead).toMatch(/רק לתלמידים/);
  });

  it('keeps its own records under five keys', () => {
    expect(Object.values(PARENT_KEYS)).toEqual(['mashov.parentChildren', 'mashov.parentAnswers', 'mashov.parentSessions', 'mashov.parentCheck', 'mashov.parentSchools']);
  });
});

describe('the child\'s lessons, from the parent\'s Mashov', () => {
  const line = (key: string, teacher: string | null, inMashov: boolean, name = key) => ({ key, name, teacher, inMashov, count: 4 });
  const CLASS = [
    line('מתמטיקה', 'כהן', true), line('היסטוריה', 'לוי', true), line('ספרות', 'גל', true),
    line('אנגלית@רון', 'רון', true, 'אנגלית'), line('אנגלית@דן', 'דן', false, 'אנגלית'),
  ];

  it('hides the class\'s rows the child\'s Mashov timetable does not list', () => {
    expect(lessonsFromMashov({ mashovKnown: true, subjects: CLASS, hidden: [] })).toEqual(['אנגלית@דן']);
  });

  it('leaves a list already changed, and waits for Mashov\'s timetable and for the class\'s rows', () => {
    expect(lessonsFromMashov({ mashovKnown: true, subjects: CLASS, hidden: ['ספרות'] })).toBeNull();
    expect(lessonsFromMashov({ mashovKnown: false, subjects: CLASS, hidden: [] })).toBeNull();
    expect(lessonsFromMashov({ mashovKnown: true, subjects: [], hidden: [] })).toBeNull();
  });

  it('hides nothing when fewer than half of the rows are in Mashov: the names did not match, they are not the child\'s', () => {
    const odd = [line('מתמטיקה', 'כהן', true), line('היסטוריה', 'לוי', false), line('ספרות', 'גל', false)];
    expect(lessonsFromMashov({ mashovKnown: true, subjects: odd, hidden: [] })).toBeNull();
  });

  it('has nothing to hide when every row is in Mashov', () => {
    expect(lessonsFromMashov({ mashovKnown: true, subjects: [line('מתמטיקה', 'כהן', true)], hidden: [] })).toEqual([]);
  });

  it('is done once for each child, and the mark goes aside with the child', () => {
    expect(CHILD_KEYS).toContain(LESSONS_FILLED_KEY);
    const kv = memoryKv();
    const site = 'https://school-c.shahaf.site';
    const shown = { ...DEFAULT_SETTINGS, audience: 'parent' as const, classId: '11', className: 'יא 2' };
    expect(lessonsFilled(kv)).toBe(false);
    markLessonsFilled(kv, new Date('2026-10-30T09:00:00.000Z'));
    expect(lessonsFilled(kv)).toBe(true);
    let n = 0;
    expect(addChild(kv, shown, site, { siteUrl: site, classId: '8', className: 'ח 1' }, () => `c${(n += 1)}`)).toBe('added');
    switchChild(kv, shown, readChildren(kv)!.list[1]!.id, site);
    // The second child's lessons were never filled: its own turn comes.
    expect(lessonsFilled(kv)).toBe(false);
  });

  it('keeps an invite\'s lesson codes with the child they are for, until its lines are known', () => {
    expect(CHILD_KEYS).toContain(LINK_LESSONS_KEY);
    const kv = memoryKv();
    keepLinkLessons(kv, ['abc', 'de']);
    expect(linkLessonCodes(kv)).toEqual(['abc', 'de']);
    dropLinkLessons(kv);
    expect(linkLessonCodes(kv)).toEqual([]);
    // A child added from an invite keeps them aside, and they come on screen with it.
    const site = 'https://school-c.shahaf.site';
    const shown = { ...DEFAULT_SETTINGS, audience: 'parent' as const, classId: '11', className: 'יא 2' };
    let n = 0;
    expect(addChild(kv, shown, site, { siteUrl: site, classId: '8', className: 'ח 1', lessons: ['xyz'] }, () => `c${(n += 1)}`)).toBe('added');
    expect(linkLessonCodes(kv)).toEqual([]);
    switchChild(kv, shown, readChildren(kv)!.list[1]!.id, site);
    expect(linkLessonCodes(kv)).toEqual(['xyz']);
  });

  it('hands the exam calendar the Mashov read kept with a child aside, so its exams stay in Google', () => {
    const kv = memoryKv();
    expect(stashedChild(kv, 'c9')).toMatchObject({ mashov: [], bagrut: [] });
    const exam = { kind: 'exam', naturalKey: 'mashov-exam|1', payload: { date: '2026-11-04', subject: 'היסטוריה' } };
    kv.set(stashKey('c9', KEYS.read), JSON.stringify({ at: '2026-10-30T08:00:00.000Z', entities: [exam], counts: {} }));
    kv.set(stashKey('c9', KEYS.bagrut), JSON.stringify({ readAt: null, failedAt: null, exams: [{ naturalKey: 'bagrut|1' }] }));
    expect(stashedChild(kv, 'c9').mashov).toEqual([exam]);
    expect(stashedChild(kv, 'c9').bagrut).toEqual([{ naturalKey: 'bagrut|1' }]);
  });

  it('words a parent\'s lessons by the copy rules, about the child and never "mine"', () => {
    for (const [who, copy] of Object.entries(LESSONS_COPY)) {
      const lines = Object.values(copy).map((v) => (typeof v === 'function' ? (v as (n: number) => string)(2) : v));
      for (const text of lines) expect(text).not.toMatch(/·| — |"/);
      if (who === 'parent') for (const text of lines) expect(text).not.toMatch(/שלי|שלך/);
    }
  });
});
