/**
 * The tasks kept on the phone move into Google once a read of Google went well
 * (app/src/google/moveTasks.ts): the order of the steps, what a failure leaves
 * behind, and that the move runs only behind a good read.
 */
import { describe, expect, it } from 'vitest';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { GOOGLE_KEYS, type GoogleSignInState } from '../../app/src/google/sync';
import { phoneTaskList } from '../../app/src/google/tasks';
import { movePhoneTasks, syncGoogleAndMoveTasks } from '../../app/src/google/moveTasks';
import { readHomeworkStates } from '../../app/src/local/homeworkState';
import { addPhoneTask, changePhoneTask, readPhoneTasks, removePhoneTask } from '../../app/src/local/phoneTasks';

const ZONE = 'Asia/Jerusalem';
const NOW = new Date('2026-11-09T10:00:00Z');
const LISTS = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/**
 * A Google with one task list, `l1`, and nothing in it. A task it is sent is
 * `g-1`, `g-2`… and starts undone. A write can be made to fail: the n-th `POST`,
 * every `PATCH`, every `GET`. A request that fails is still a call. A failure
 * can carry a `status`, as the requester's do (`failStatus`). `onPost` runs
 * while the n-th `POST` is being answered, so a test can change the phone's
 * store while that request is out. `DELETE` is a call and answers nothing.
 */
function fakeGoogle(
  opts: {
    failPost?: number | 'all';
    failStatus?: number;
    failPatch?: boolean;
    failGet?: boolean;
    onPost?: (n: number) => void;
  } = {},
) {
  const calls: Call[] = [];
  const made = new Map<string, Record<string, unknown>>();
  let posted = 0;
  const requester: GoogleRequester = {
    async request<T>(url: string, init: RequestInit = {}): Promise<T> {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      if (method === 'POST') {
        posted += 1;
        if (opts.failPost === 'all' || opts.failPost === posted) {
          throw Object.assign(new Error('Google refused'), opts.failStatus === undefined ? {} : { status: opts.failStatus });
        }
        opts.onPost?.(posted);
        const task = { id: `g-${posted}`, ...body, status: 'needsAction', updated: '2026-11-09T10:00:00.000Z' };
        made.set(task.id, task);
        return task as T;
      }
      if (method === 'DELETE') {
        made.delete(url.split('/').pop()!);
        return undefined as T;
      }
      if (method === 'PATCH') {
        if (opts.failPatch) throw new Error('Google 500');
        const id = url.split('/').pop()!;
        const task = { ...made.get(id), ...body };
        made.set(id, task);
        return task as T;
      }
      if (opts.failGet) throw new Error('Google 500');
      return (url === LISTS ? { items: [{ id: 'l1', title: 'משימות' }] } : { items: [] }) as T;
    },
  };
  const posts = () => calls.filter((c) => c.method === 'POST');
  const patches = () => calls.filter((c) => c.method === 'PATCH');
  return { requester, calls, posts, patches };
}

function setup(opts: Parameters<typeof fakeGoogle>[0] = {}) {
  const kv = memoryKv();
  const g = fakeGoogle(opts);
  return { kv, g, deps: { kv, requester: g.requester, zone: ZONE, now: () => NOW } };
}

describe('moving the phone\'s tasks to Google', () => {
  it('moves every task to the first list and leaves none on the phone', async () => {
    const { kv, g, deps } = setup();
    addPhoneTask(kv, { title: 'א', notes: 'פרטים', due: '2026-11-10' }, NOW);
    addPhoneTask(kv, { title: 'ב' }, NOW);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(readPhoneTasks(kv)).toEqual([]);
    expect(g.posts()[0]).toMatchObject({
      url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks',
      body: { title: 'א', notes: 'פרטים', due: '2026-11-10T00:00:00.000Z' },
    });
    expect(g.posts()[1]).toMatchObject({ body: { title: 'ב' } });
    expect(phoneTaskList(kv).items.map((t) => t.id).sort()).toEqual(['g-1', 'g-2']);
  });

  it('a completed task is completed in Google too', async () => {
    const { kv, g, deps } = setup();
    const task = addPhoneTask(kv, { title: 'סיימתי' }, NOW);
    addPhoneTask(kv, { title: 'עוד לא' }, NOW);
    changePhoneTask(kv, task.googleId, { completed: true }, NOW);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(g.patches()).toHaveLength(1);
    expect(g.patches()[0]).toMatchObject({ url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks/g-1', body: { status: 'completed' } });
    const kept = phoneTaskList(kv).items;
    expect(kept.find((t) => t.id === 'g-1')!.completed).toBe(true);
    expect(kept.find((t) => t.id === 'g-2')!.completed).toBe(false);
  });

  it('a mark that fails leaves the task moved', async () => {
    const { kv, g, deps } = setup({ failPatch: true });
    const task = addPhoneTask(kv, { title: 'סיימתי' }, NOW);
    changePhoneTask(kv, task.googleId, { completed: true }, NOW);
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(readPhoneTasks(kv)).toEqual([]);
    expect(g.patches()).toHaveLength(1);
    expect(g.posts()).toHaveLength(1);
    expect(phoneTaskList(kv).items.map((t) => t.id)).toEqual(['g-1']);
  });

  it('the homework link follows the task', async () => {
    const { kv, deps } = setup();
    const task = addPhoneTask(kv, { title: 'שיעורי בית', fromHomeworkKey: 'hw-1' }, NOW);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ linkedTaskId: task.googleId });
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ done: false, linkedTaskId: 'g-1' });
  });

  it('stops at the first failure and goes on from there, sending nothing twice', async () => {
    const { kv, g, deps } = setup({ failPost: 2 });
    for (const title of ['א', 'ב', 'ג']) addPhoneTask(kv, { title }, NOW);
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(readPhoneTasks(kv).map((t) => t.title)).toEqual(['ב', 'ג']);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(readPhoneTasks(kv)).toEqual([]);
    // The second 'ב' is the one that failed, sent again; 'א' went once.
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א', 'ב', 'ב', 'ג']);
  });

  it('with no tasks on the phone it writes nothing', async () => {
    const { g, deps } = setup();
    expect(await movePhoneTasks(deps)).toBe(0);
    expect(g.calls).toEqual([]);
  });
});

describe('a write made while the move is running', () => {
  it('a task deleted during the move is not sent', async () => {
    const ids: string[] = [];
    const { kv, g, deps } = setup({ onPost: (n) => n === 1 && removePhoneTask(kv, ids[1]!) });
    for (const title of ['א', 'ב']) ids.push(addPhoneTask(kv, { title }, NOW).googleId);
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א']);
    expect(readPhoneTasks(kv)).toEqual([]);
  });

  it('a task ticked during the move goes up done', async () => {
    const ids: string[] = [];
    const { kv, g, deps } = setup({ onPost: (n) => n === 1 && changePhoneTask(kv, ids[1]!, { completed: true }, NOW) });
    for (const title of ['א', 'ב']) ids.push(addPhoneTask(kv, { title }, NOW).googleId);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(g.patches()).toHaveLength(1);
    expect(g.patches()[0]).toMatchObject({ url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks/g-2', body: { status: 'completed' } });
    expect(readPhoneTasks(kv)).toEqual([]);
  });

  it('a task edited during the move goes up with the edit', async () => {
    const ids: string[] = [];
    const { kv, g, deps } = setup({ onPost: (n) => n === 1 && changePhoneTask(kv, ids[1]!, { title: 'ג' }, NOW) });
    for (const title of ['א', 'ב']) ids.push(addPhoneTask(kv, { title }, NOW).googleId);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א', 'ג']);
  });

  it('a task deleted while its own request is out does not come back', async () => {
    const ids: string[] = [];
    const { kv, g, deps } = setup({ onPost: (n) => n === 1 && removePhoneTask(kv, ids[0]!) });
    ids.push(addPhoneTask(kv, { title: 'א' }, NOW).googleId);
    expect(await movePhoneTasks(deps)).toBe(0);
    const deletes = g.calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe('https://tasks.googleapis.com/tasks/v1/lists/l1/tasks/g-1');
    expect(phoneTaskList(kv).items.map((t) => t.id)).not.toContain('g-1');
    expect(readPhoneTasks(kv)).toEqual([]);
  });

  it('a task deleted while its own request is out leaves its homework open', async () => {
    const ids: string[] = [];
    const { kv, deps } = setup({ onPost: (n) => n === 1 && removePhoneTask(kv, ids[0]!) });
    ids.push(addPhoneTask(kv, { title: 'שיעורי בית', fromHomeworkKey: 'hw-1' }, NOW).googleId);
    await movePhoneTasks(deps);
    expect(readHomeworkStates(kv)['hw-1']?.linkedTaskId ?? null).toBeNull();
  });

  it('a delete that fails on top of that is not a failure of the move', async () => {
    const ids: string[] = [];
    const { kv, deps } = setup({ onPost: (n) => n === 1 && removePhoneTask(kv, ids[0]!) });
    ids.push(addPhoneTask(kv, { title: 'א' }, NOW).googleId);
    // Nothing the fake Google does throws on a DELETE, so break the requester's DELETE here.
    const inner = deps.requester;
    const requester: GoogleRequester = {
      request: async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
        if (init.method === 'DELETE') throw new Error('Google 500');
        return inner.request<T>(url, init);
      },
    };
    expect(await movePhoneTasks({ ...deps, requester })).toBe(0);
  });
});

describe('a task Google refuses', () => {
  const titlesOnPhone = (kv: ReturnType<typeof memoryKv>) => readPhoneTasks(kv).map((t) => t.title);

  it('a task Google refuses stays on the phone and the rest go on', async () => {
    const { kv, g, deps } = setup({ failPost: 2, failStatus: 400 });
    for (const title of ['א', 'ב', 'ג']) addPhoneTask(kv, { title }, NOW);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א', 'ב', 'ג']);
    expect(titlesOnPhone(kv)).toEqual(['ב']);
  });

  it('a refused task is tried again at the next read', async () => {
    const { kv, g, deps } = setup({ failPost: 2, failStatus: 400 });
    for (const title of ['א', 'ב', 'ג']) addPhoneTask(kv, { title }, NOW);
    await movePhoneTasks(deps);
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א', 'ב', 'ג', 'ב']);
    expect(titlesOnPhone(kv)).toEqual([]);
  });

  it.each([404, 413, 422])('a %i for one task is a refusal of that task', async (status) => {
    const { kv, g, deps } = setup({ failPost: 2, failStatus: status });
    for (const title of ['א', 'ב', 'ג']) addPhoneTask(kv, { title }, NOW);
    expect(await movePhoneTasks(deps)).toBe(2);
    expect(g.posts()).toHaveLength(3);
    expect(titlesOnPhone(kv)).toEqual(['ב']);
  });

  it.each([401, 403, 429, 500, 503, undefined])('a refusal with status %s stops the loop', async (status) => {
    const { kv, g, deps } = setup({ failPost: 2, ...(status === undefined ? {} : { failStatus: status }) });
    for (const title of ['א', 'ב', 'ג']) addPhoneTask(kv, { title }, NOW);
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א', 'ב']);
    expect(titlesOnPhone(kv)).toEqual(['ב', 'ג']);
  });

  it('a refusal for the whole account stops the loop', async () => {
    const { kv, g, deps } = setup({ failPost: 2, failStatus: 403 });
    for (const title of ['א', 'ב', 'ג']) addPhoneTask(kv, { title }, NOW);
    expect(await movePhoneTasks(deps)).toBe(1);
    expect(g.posts().map((c) => c.body!.title)).toEqual(['א', 'ב']);
    expect(titlesOnPhone(kv)).toEqual(['ב', 'ג']);
  });
});

describe('the move behind a read of Google', () => {
  const signedIn: GoogleSignInState = { kind: 'in' };

  it('after a good read the outcome says how many moved', async () => {
    const { kv, g, deps } = setup();
    addPhoneTask(kv, { title: 'א' }, NOW);
    const outcome = await syncGoogleAndMoveTasks(deps, signedIn, { force: true });
    expect(outcome).toMatchObject({ kind: 'ok', moved: 1 });
    expect(readPhoneTasks(kv)).toEqual([]);
    expect(g.posts()).toHaveLength(1);
    // The task went into the list the read just found, and is on the phone's side of Google.
    expect(phoneTaskList(kv).items.map((t) => t.id)).toEqual(['g-1']);
  });

  it('a good read with nothing to move says 0', async () => {
    const { g, deps } = setup();
    expect(await syncGoogleAndMoveTasks(deps, signedIn, { force: true })).toMatchObject({ kind: 'ok', moved: 0 });
    expect(g.posts()).toEqual([]);
  });

  it('a phone that is signed out moves nothing', async () => {
    const { kv, g, deps } = setup();
    addPhoneTask(kv, { title: 'א' }, NOW);
    expect(await syncGoogleAndMoveTasks(deps, { kind: 'out' }, { force: true })).toBeNull();
    expect(g.calls).toEqual([]);
    expect(readPhoneTasks(kv)).toHaveLength(1);
  });

  it('a sign-in that needs doing again moves nothing', async () => {
    const { kv, g, deps } = setup();
    addPhoneTask(kv, { title: 'א' }, NOW);
    const outcome = await syncGoogleAndMoveTasks(deps, { kind: 'needs-login', error: 'no saved sign-in' }, { force: true });
    expect(outcome).toEqual({ kind: 'needs-login', error: 'no saved sign-in' });
    expect(g.calls).toEqual([]);
    expect(readPhoneTasks(kv)).toHaveLength(1);
  });

  it('a failed read writes nothing and keeps the tasks', async () => {
    const { kv, g, deps } = setup({ failGet: true });
    addPhoneTask(kv, { title: 'א' }, NOW);
    const outcome = await syncGoogleAndMoveTasks(deps, signedIn, { force: true });
    expect(outcome?.kind).toBe('failed');
    expect(outcome).not.toHaveProperty('moved');
    expect(g.posts()).toEqual([]);
    expect(readPhoneTasks(kv)).toHaveLength(1);
  });

  it('a skipped read writes nothing', async () => {
    const { kv, g, deps } = setup();
    addPhoneTask(kv, { title: 'א' }, NOW);
    kv.set(GOOGLE_KEYS.status, JSON.stringify({ lastTriedAt: NOW.toISOString(), lastOkAt: NOW.toISOString(), lastError: null, needsLogin: false }));
    expect(await syncGoogleAndMoveTasks(deps, signedIn)).toEqual({ kind: 'skipped' });
    expect(g.calls).toEqual([]);
    expect(readPhoneTasks(kv)).toHaveLength(1);
  });

  it('a read keeps the tasks even when every write fails', async () => {
    const { kv, g, deps } = setup({ failPost: 'all' });
    addPhoneTask(kv, { title: 'א' }, NOW);
    addPhoneTask(kv, { title: 'ב' }, NOW);
    const outcome = await syncGoogleAndMoveTasks(deps, signedIn, { force: true });
    expect(outcome).toMatchObject({ kind: 'ok', moved: 0 });
    // The first failure stopped the loop: one try, the rest wait for the next read.
    expect(g.posts()).toHaveLength(1);
    expect(readPhoneTasks(kv).map((t) => t.title)).toEqual(['א', 'ב']);
  });
});
