/**
 * Tasks kept on the phone alone (app/src/local/phoneTasks.ts), for someone who
 * has not connected Google: added, changed, ticked and deleted in the phone's
 * own store, linked to the homework they were made from, and laid over what
 * Google kept so every screen reads them as it reads Google's.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { GOOGLE_KEYS } from '../../app/src/google/sync';
import { createTaskRouted, deleteTaskRouted, tasksOnThisPhone, updateTaskRouted, type TaskRoute } from '../../app/src/google/tasks';
import { readHomeworkStates } from '../../app/src/local/homeworkState';
import {
  PHONE_LIST,
  PHONE_TASKS_COPY,
  PHONE_TASKS_KEY,
  addPhoneTask,
  changePhoneTask,
  isPhoneTaskId,
  readPhoneTasks,
  removePhoneTask,
  withPhoneTasks,
} from '../../app/src/local/phoneTasks';

const NOW = new Date('2026-11-09T10:00:00Z');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const LIST: KeptEntity = { kind: 'task_list', naturalKey: 'l1', partition: null, payload: { id: 'l1', title: 'משימות' } };

describe('tasks kept on the phone alone', () => {
  let kv: ReturnType<typeof memoryKv>;
  beforeEach(() => {
    kv = memoryKv();
  });

  it('names its list and its two sentences', () => {
    expect(PHONE_LIST).toEqual({ id: 'phone', title: 'המשימות שלי' });
    expect(PHONE_TASKS_KEY).toBe('local.tasks');
    expect(PHONE_TASKS_COPY.needGoogle).toBe('כדי להוסיף משימות צריך להתחבר ל-Google.');
    expect(PHONE_TASKS_COPY.moved).toBe('המשימה הזו כבר עברה ל־Google. אפשר לנסות שוב.');
    // Nobody is told about "Google Tasks": it read as a second app.
    expect(JSON.stringify(PHONE_TASKS_COPY)).not.toContain('Tasks');
  });

  it('knows a phone id from a Google one', () => {
    expect(isPhoneTaskId('phone-abc')).toBe(true);
    expect(isPhoneTaskId('MTIzNDU2')).toBe(false);
    expect(isPhoneTaskId('demo-task-1')).toBe(false);
    expect(isPhoneTaskId('')).toBe(false);
  });

  it('adds a task with a phone id, in the phone list', () => {
    const t = addPhoneTask(kv, { title: '  לקנות מחברת ', notes: ' ', due: '2026-11-10' }, NOW);
    expect(isPhoneTaskId(t.googleId)).toBe(true);
    expect(t).toMatchObject({ listId: 'phone', listTitle: 'המשימות שלי', title: 'לקנות מחברת', notes: null, due: '2026-11-10', completed: false, deleted: false, updated: NOW.toISOString() });
    expect(readPhoneTasks(kv)).toEqual([t]);
  });

  it('keeps notes that say something, and no due date when none is given', () => {
    const t = addPhoneTask(kv, { title: 'א', notes: ' עמודים 4 עד 6 ' }, NOW);
    expect(t).toMatchObject({ notes: 'עמודים 4 עד 6', due: null });
  });

  it('puts every task in the one phone list, whatever list was asked for', () => {
    const t = addPhoneTask(kv, { title: 'א', listId: 'l1' }, NOW);
    expect(t).toMatchObject({ listId: 'phone', listTitle: 'המשימות שלי' });
  });

  it('gives two tasks of the same instant different ids', () => {
    const a = addPhoneTask(kv, { title: 'א' }, NOW);
    const b = addPhoneTask(kv, { title: 'ב' }, NOW);
    expect(a.googleId).not.toBe(b.googleId);
    expect(readPhoneTasks(kv).map((t) => t.title)).toEqual(['א', 'ב']);
  });

  it('changes only what was asked', () => {
    const t = addPhoneTask(kv, { title: 'א', due: '2026-11-10' }, NOW);
    expect(changePhoneTask(kv, t.googleId, { completed: true }, NOW)).toMatchObject({ title: 'א', due: '2026-11-10', completed: true });
    expect(changePhoneTask(kv, 'phone-none', { title: 'ב' })).toBeNull();
  });

  it('keeps what a change returned, and stamps it', () => {
    const t = addPhoneTask(kv, { title: 'א', notes: 'ישן', due: '2026-11-10' }, NOW);
    const later = new Date('2026-11-09T12:30:00Z');
    const changed = changePhoneTask(kv, t.googleId, { title: ' ב ', notes: null, due: null }, later);
    expect(changed).toMatchObject({ googleId: t.googleId, title: 'ב', notes: null, due: null, completed: false, updated: later.toISOString() });
    expect(readPhoneTasks(kv)).toEqual([changed]);
  });

  it('ticks a task back open', () => {
    const t = addPhoneTask(kv, { title: 'א' }, NOW);
    changePhoneTask(kv, t.googleId, { completed: true }, NOW);
    expect(changePhoneTask(kv, t.googleId, { completed: false }, NOW)).toMatchObject({ completed: false });
  });

  it('links the homework a task was made from, and frees it on delete', () => {
    const t = addPhoneTask(kv, { title: 'א', fromHomeworkKey: 'hw-1' }, NOW);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ linkedTaskId: t.googleId });
    expect(removePhoneTask(kv, t.googleId)).toBe(true);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ linkedTaskId: null });
    expect(removePhoneTask(kv, t.googleId)).toBe(false);
  });

  it('removes the task from the store, leaving the others and no deleted mark', () => {
    const a = addPhoneTask(kv, { title: 'א' }, NOW);
    const b = addPhoneTask(kv, { title: 'ב' }, NOW);
    expect(removePhoneTask(kv, a.googleId)).toBe(true);
    expect(readPhoneTasks(kv)).toEqual([b]);
    expect(kv.map.get(PHONE_TASKS_KEY)).not.toContain('"deleted":true');
  });

  it('writes nothing about homework for a task made without it', () => {
    const t = addPhoneTask(kv, { title: 'א' }, NOW);
    removePhoneTask(kv, t.googleId);
    expect(readHomeworkStates(kv)).toEqual({});
  });

  it('reads a damaged store as no tasks', () => {
    kv.set(PHONE_TASKS_KEY, '{not json');
    expect(readPhoneTasks(kv)).toEqual([]);
    kv.set(PHONE_TASKS_KEY, '{}');
    expect(readPhoneTasks(kv)).toEqual([]);
  });

  it('skips what is not a task in a half-damaged store', () => {
    const t = addPhoneTask(kv, { title: 'א' }, NOW);
    kv.set(PHONE_TASKS_KEY, JSON.stringify([null, 7, 'x', {}, t]));
    expect(readPhoneTasks(kv)).toEqual([t]);
  });

  it('lays the phone tasks over what Google kept', () => {
    const t = addPhoneTask(kv, { title: 'א' }, NOW);
    expect(withPhoneTasks([LIST], [t])).toEqual([LIST, { kind: 'task', naturalKey: `phone|${t.googleId}`, partition: 'phone', payload: t }]);
  });

  it('leaves what Google kept as it was when there are no phone tasks', () => {
    expect(withPhoneTasks([LIST], [])).toEqual([LIST]);
  });
});

const ZONE = 'Asia/Jerusalem';
const GOOGLE_TASK: KeptEntity = {
  kind: 'task', naturalKey: 'l1|a', partition: 'l1',
  payload: { googleId: 'a', listId: 'l1', listTitle: 'משימות', title: 'מ־Google', notes: null, due: null, completed: false, deleted: false, updated: null },
};

/** A Google that remembers what it was asked and answers like the Tasks API (as in phone-tasks.test.ts). */
function fakeGoogle() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const requester: GoogleRequester = {
    async request<T>(url: string, init: RequestInit = {}): Promise<T> {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init.method ?? 'GET', body });
      if (init.method === 'POST') return { id: 'new-1', title: body.title, notes: body.notes, due: body.due, status: 'needsAction', updated: '2026-11-09T10:00:00.000Z' } as T;
      if (init.method === 'PATCH') return { id: url.split('/').pop(), title: 'מ־Google', status: body.status ?? 'needsAction', updated: '2026-11-09T11:00:00.000Z' } as T;
      return undefined as T;
    },
  };
  return { requester, calls, built: 0 };
}

describe('writes routed to the phone or to Google', () => {
  let kv: ReturnType<typeof memoryKv>;
  let g: ReturnType<typeof fakeGoogle>;
  /** Signed out and a student, unless `over` says otherwise; building Google's side is counted. */
  const route = (k: ReturnType<typeof memoryKv>, over: Partial<TaskRoute> = {}): TaskRoute => ({
    kv: k,
    account: null,
    audience: 'student',
    google: () => {
      g.built += 1;
      return { kv: k, requester: g.requester, zone: ZONE };
    },
    ...over,
  });
  const SIGNED_IN = { account: 'a@b.c' };

  beforeEach(() => {
    kv = memoryKv();
    kv.set(GOOGLE_KEYS.kept, JSON.stringify([LIST, GOOGLE_TASK]));
    g = fakeGoogle();
  });

  it('without Google a new task stays on the phone and Google hears nothing', async () => {
    const t = await createTaskRouted(route(kv), { title: 'א', listId: 'phone' });
    expect(isPhoneTaskId(t.id)).toBe(true);
    expect(t).toMatchObject({ title: 'א', listId: 'phone', listTitle: 'המשימות שלי', completed: false, linkedHomeworkKey: null });
    expect(readPhoneTasks(kv).map((x) => x.googleId)).toEqual([t.id]);
    expect(g.calls).toEqual([]);
    expect(g.built).toBe(0);
  });

  it('with Google a new task goes to Google, and nothing is kept on the phone', async () => {
    const t = await createTaskRouted(route(kv, SIGNED_IN), { title: 'א' });
    expect(g.calls[0]).toMatchObject({ method: 'POST', url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks', body: { title: 'א' } });
    expect(t.id).toBe('new-1');
    expect(readPhoneTasks(kv)).toEqual([]);
  });

  it('a list id of the phone never reaches Google', async () => {
    await createTaskRouted(route(kv, SIGNED_IN), { title: 'א', listId: 'phone' });
    expect(g.calls[0]!.url).toBe('https://tasks.googleapis.com/tasks/v1/lists/l1/tasks');
  });

  it('a list of Google is still used when one is asked for', async () => {
    await createTaskRouted(route(kv, SIGNED_IN), { title: 'א', listId: 'l2' });
    expect(g.calls[0]!.url).toBe('https://tasks.googleapis.com/tasks/v1/lists/l2/tasks');
  });

  it('a parent without Google gets the error of today, and nothing is kept', async () => {
    await expect(createTaskRouted(route(kv, { audience: 'parent' }), { title: 'א' })).rejects.toThrow('כדי להוסיף משימות צריך להתחבר ל-Google.');
    expect(readPhoneTasks(kv)).toEqual([]);
    expect(g.calls).toEqual([]);
  });

  it('a parent with Google adds to Google', async () => {
    await createTaskRouted(route(kv, { audience: 'parent', ...SIGNED_IN }), { title: 'א' });
    expect(g.calls[0]).toMatchObject({ method: 'POST' });
  });

  it('links the homework a phone task was made from, and frees it on delete', async () => {
    const t = await createTaskRouted(route(kv), { title: 'א', fromHomeworkKey: 'hw-1' });
    expect(t.linkedHomeworkKey).toBe('hw-1');
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ linkedTaskId: t.id });
    await deleteTaskRouted(route(kv), t.id);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ linkedTaskId: null });
  });

  it('edits and deletes a phone task by its id, without Google, signed in or not', async () => {
    const t = await createTaskRouted(route(kv), { title: 'א' });
    for (const over of [{}, SIGNED_IN]) {
      const ticked = await updateTaskRouted(route(kv, over), t.id, { completed: true });
      expect(ticked).toMatchObject({ id: t.id, completed: true });
      expect(readPhoneTasks(kv)[0]).toMatchObject({ completed: true });
      const open = await updateTaskRouted(route(kv, over), t.id, { completed: false, title: 'ב' });
      expect(open).toMatchObject({ completed: false, title: 'ב' });
    }
    await deleteTaskRouted(route(kv, SIGNED_IN), t.id);
    expect(readPhoneTasks(kv)).toEqual([]);
    expect(g.calls).toEqual([]);
    expect(g.built).toBe(0);
  });

  it('edits and deletes any other id in Google', async () => {
    const ticked = await updateTaskRouted(route(kv, SIGNED_IN), 'a', { completed: true });
    expect(g.calls[0]).toMatchObject({ method: 'PATCH', url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks/a', body: { status: 'completed' } });
    expect(ticked).toMatchObject({ id: 'a', completed: true });
    await deleteTaskRouted(route(kv, SIGNED_IN), 'a');
    expect(g.calls[1]).toMatchObject({ method: 'DELETE', url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks/a' });
  });

  it('a phone task that already moved says so', async () => {
    await expect(updateTaskRouted(route(kv), 'phone-gone', { completed: true })).rejects.toThrow(PHONE_TASKS_COPY.moved);
    await expect(deleteTaskRouted(route(kv), 'phone-gone')).rejects.toThrow(PHONE_TASKS_COPY.moved);
    await expect(updateTaskRouted(route(kv, SIGNED_IN), 'phone-gone', { completed: true })).rejects.toThrow(PHONE_TASKS_COPY.moved);
    expect(g.calls).toEqual([]);
  });
});

describe('the tasks the screens read', () => {
  const kvWithBoth = () => {
    const kv = memoryKv();
    kv.set(GOOGLE_KEYS.kept, JSON.stringify([LIST, GOOGLE_TASK]));
    addPhoneTask(kv, { title: 'בטלפון' });
    return kv;
  };

  it('without Google: the phone list and its tasks alone', () => {
    // The Google task is left from before, and is not shown.
    const read = tasksOnThisPhone(kvWithBoth(), false);
    expect(read.lists).toEqual([PHONE_LIST]);
    expect(read.items.map((t) => t.title)).toEqual(['בטלפון']);
  });

  it("with Google: both, under Google's lists alone", () => {
    const read = tasksOnThisPhone(kvWithBoth(), true);
    expect(read.lists).toEqual([{ id: 'l1', title: 'משימות' }]);
    expect(read.items.map((t) => t.title).sort()).toEqual(['בטלפון', 'מ־Google'].sort());
  });

  it('without Google and without tasks: the phone list, empty', () => {
    expect(tasksOnThisPhone(memoryKv(), false)).toEqual({ items: [], lists: [PHONE_LIST] });
  });
});
