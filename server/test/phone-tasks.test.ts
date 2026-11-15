/**
 * Google Tasks written by the phone (app/src/google/tasks.ts, plan Phase 2e):
 * the write reaches Google, what the phone keeps changes at once, and a task
 * made from homework is linked on the phone.
 */
import { describe, expect, it } from 'vitest';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { createTaskOnPhone, deleteTaskOnPhone, phoneTaskList, updateTaskOnPhone } from '../../app/src/google/tasks';
import { GOOGLE_KEYS } from '../../app/src/google/sync';
import { readHomeworkStates } from '../../app/src/local/homeworkState';

const ZONE = 'Asia/Jerusalem';

function memoryKv(kept: unknown[] = []) {
  const map = new Map<string, string>([[GOOGLE_KEYS.kept, JSON.stringify(kept)]]);
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const LIST = { kind: 'task_list', naturalKey: 'l1', partition: null, payload: { id: 'l1', title: 'משימות' } };
const TASK = (id: string, title: string, due: string | null, extra: object = {}) => ({
  kind: 'task', naturalKey: `l1|${id}`, partition: 'l1',
  payload: { googleId: id, listId: 'l1', listTitle: 'משימות', title, notes: null, due, completed: false, deleted: false, updated: null, ...extra },
});

/** A Google that remembers what it was asked and answers like the Tasks API. */
function fakeGoogle() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const requester: GoogleRequester = {
    async request<T>(url: string, init: RequestInit = {}): Promise<T> {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init.method ?? 'GET', body });
      if (init.method === 'POST') return { id: 'new-1', title: body.title, notes: body.notes, due: body.due, status: 'needsAction', updated: '2026-10-21T10:00:00.000Z' } as T;
      if (init.method === 'PATCH') return { id: url.split('/').pop(), title: 'לקנות מחברת', status: body.status ?? 'needsAction', due: '2026-10-22T00:00:00.000Z', updated: '2026-10-21T11:00:00.000Z' } as T;
      return undefined as T;
    },
  };
  return { requester, calls };
}

describe("the phone's tasks", () => {
  it('lists what the phone keeps, by due date, with the lists', () => {
    const kv = memoryKv([LIST, TASK('b', 'בלי תאריך', null), TASK('a', 'מחר', '2026-10-22'), TASK('c', 'נמחקה', '2026-10-21', { deleted: true })]);
    const list = phoneTaskList(kv);
    expect(list.items.map((t) => t.title)).toEqual(['מחר', 'בלי תאריך']);
    expect(list.lists).toEqual([{ id: 'l1', title: 'משימות' }]);
  });

  it('makes a task from homework in Google, keeps it, and links it on the phone', async () => {
    const kv = memoryKv([LIST]);
    const g = fakeGoogle();
    const task = await createTaskOnPhone(
      { kv, requester: g.requester, zone: ZONE },
      { title: 'שיעורי בית באנגלית', due: '2026-10-22', fromHomeworkKey: 'hw-1' },
    );
    expect(g.calls[0]).toMatchObject({ method: 'POST', url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks', body: { title: 'שיעורי בית באנגלית', due: '2026-10-22T00:00:00.000Z' } });
    expect(task).toMatchObject({ id: 'new-1', listId: 'l1', due: '2026-10-22', linkedHomeworkKey: 'hw-1' });
    expect(phoneTaskList(kv).items.map((t) => t.id)).toEqual(['new-1']);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ done: false, linkedTaskId: 'new-1' });
  });

  it('ticks a task done in Google and here', async () => {
    const kv = memoryKv([LIST, TASK('t1', 'לקנות מחברת', '2026-10-22')]);
    const g = fakeGoogle();
    const task = await updateTaskOnPhone({ kv, requester: g.requester, zone: ZONE }, 't1', { completed: true });
    expect(g.calls[0]).toMatchObject({ method: 'PATCH', body: { status: 'completed' } });
    expect(task.completed).toBe(true);
    expect(phoneTaskList(kv).items[0]!.completed).toBe(true);
  });

  it('deletes a task, and opens the homework it was made from again', async () => {
    const kv = memoryKv([LIST, TASK('t1', 'שיעורי בית', '2026-10-22')]);
    kv.set('local.homeworkState', JSON.stringify({ 'hw-1': { done: false, linkedTaskId: 't1' } }));
    const g = fakeGoogle();
    await deleteTaskOnPhone({ kv, requester: g.requester, zone: ZONE }, 't1');
    expect(g.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://tasks.googleapis.com/tasks/v1/lists/l1/tasks/t1' });
    expect(phoneTaskList(kv).items).toEqual([]);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ done: false, linkedTaskId: null });
  });
});
