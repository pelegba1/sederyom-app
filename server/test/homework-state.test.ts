/**
 * What the student did with each homework item, kept on the phone
 * (app/src/local/homeworkState.ts): a tick keeps the item's task, a task
 * keeps its tick, and a task finds the item it was made from.
 */
import { describe, expect, it } from 'vitest';
import {
  HOMEWORK_STATE_KEY, homeworkLinkedTo, linkHomeworkTask, markHomeworkDone, readHomeworkStates,
} from '../../app/src/local/homeworkState';

function memoryKv(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

describe('homework state on the phone', () => {
  it('reads nothing as no state, and unreadable state as none', () => {
    expect(readHomeworkStates(memoryKv())).toEqual({});
    expect(readHomeworkStates(memoryKv({ [HOMEWORK_STATE_KEY]: 'not json' }))).toEqual({});
  });

  it('ticks an item, and undoes the tick', () => {
    const kv = memoryKv();
    markHomeworkDone(kv, 'hw-1', true);
    expect(readHomeworkStates(kv)).toMatchObject({ 'hw-1': { done: true, linkedTaskId: null } });
    markHomeworkDone(kv, 'hw-1', false);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ done: false, linkedTaskId: null });
  });

  it('keeps the task through a tick, and the tick through a task', () => {
    const kv = memoryKv();
    linkHomeworkTask(kv, 'hw-1', 'task-a');
    markHomeworkDone(kv, 'hw-1', true);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ done: true, linkedTaskId: 'task-a' });
    linkHomeworkTask(kv, 'hw-1', null);
    expect(readHomeworkStates(kv)['hw-1']).toMatchObject({ done: true, linkedTaskId: null });
  });

  it('finds the item a task was made from, and nothing for another task', () => {
    const kv = memoryKv();
    markHomeworkDone(kv, 'hw-1', true);
    linkHomeworkTask(kv, 'hw-2', 'task-b');
    expect(homeworkLinkedTo(kv, 'task-b')).toBe('hw-2');
    expect(homeworkLinkedTo(kv, 'task-z')).toBeNull();
  });

  it('reads state an earlier version wrote with a change time', () => {
    const kv = memoryKv({ [HOMEWORK_STATE_KEY]: JSON.stringify({ 'hw-1': { done: true, linkedTaskId: null, changedAt: '2026-10-20T08:00:00.000Z' } }) });
    markHomeworkDone(kv, 'hw-2', true);
    expect(readHomeworkStates(kv)['hw-1']?.done).toBe(true);
    expect(readHomeworkStates(kv)['hw-2']).toMatchObject({ done: true, linkedTaskId: null });
  });
});
