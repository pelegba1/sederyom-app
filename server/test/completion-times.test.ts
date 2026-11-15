/**
 * When things were done (year wrapped, part 1, design §7): a task keeps the
 * moment it was completed, a homework tick the moment it was made, and one
 * full read of Google's tasks fills the moments Google already holds.
 */
import { describe, expect, it } from 'vitest';
import { normalizeTask } from '@sederyom/shared/logic/google/tasks';
import { GOOGLE_KEYS } from '../../app/src/google/sync';
import { HOMEWORK_STATE_KEY, linkHomeworkTask, markHomeworkDone, readHomeworkStates } from '../../app/src/local/homeworkState';
import { TASK_TIMES_MIGRATED_KEY, runKeyMigrations } from '../../app/src/local/keyMigrations';
import { PHONE_TASKS_KEY, addPhoneTask, changePhoneTask, readPhoneTasks } from '../../app/src/local/phoneTasks';

const ZONE = 'Asia/Jerusalem';
const LIST = { id: 'l1', title: 'משימות' };
const MORNING = new Date('2026-11-10T07:00:00Z');
const EVENING = new Date('2026-11-10T17:30:00Z');

function memoryKv(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}

describe('a Google task', () => {
  it('carries the time Google says it was completed', () => {
    const task = normalizeTask(LIST, { id: 'a', title: 'לקרוא פרק 3', status: 'completed', completed: '2026-11-09T18:20:05.000Z' }, ZONE);
    expect(task).toMatchObject({ completed: true, completedAt: '2026-11-09T18:20:05.000Z' });
  });

  it('has none while it is open, whatever Google left in the field', () => {
    expect(normalizeTask(LIST, { id: 'a', status: 'needsAction' }, ZONE).completedAt).toBeNull();
    expect(normalizeTask(LIST, { id: 'a', status: 'needsAction', completed: '2026-11-09T18:20:05.000Z' }, ZONE).completedAt).toBeNull();
  });

  it('completed with no time from Google has none: it is not made up', () => {
    expect(normalizeTask(LIST, { id: 'a', status: 'completed' }, ZONE)).toMatchObject({ completed: true, completedAt: null });
  });
});

describe('a task kept on the phone', () => {
  it('is added with no completion time', () => {
    const kv = memoryKv();
    expect(addPhoneTask(kv, { title: 'להדפיס עבודה' }, MORNING).completedAt).toBeNull();
  });

  it('is stamped when ticked, and loses the stamp when reopened', () => {
    const kv = memoryKv();
    const { googleId } = addPhoneTask(kv, { title: 'להדפיס עבודה' }, MORNING);
    expect(changePhoneTask(kv, googleId, { completed: true }, EVENING)).toMatchObject({ completed: true, completedAt: EVENING.toISOString() });
    expect(readPhoneTasks(kv)[0]!.completedAt).toBe(EVENING.toISOString());
    expect(changePhoneTask(kv, googleId, { completed: false }, EVENING)).toMatchObject({ completed: false, completedAt: null });
  });

  it('keeps its first stamp through a later edit, and through a second tick of a done task', () => {
    const kv = memoryKv();
    const { googleId } = addPhoneTask(kv, { title: 'להדפיס עבודה' }, MORNING);
    changePhoneTask(kv, googleId, { completed: true }, MORNING);
    expect(changePhoneTask(kv, googleId, { title: 'להדפיס את העבודה' }, EVENING)!.completedAt).toBe(MORNING.toISOString());
    expect(changePhoneTask(kv, googleId, { completed: true }, EVENING)!.completedAt).toBe(MORNING.toISOString());
  });

  it('stored before the field existed reads with no time, done or not', () => {
    const old = { googleId: 'phone-x', listId: 'phone', listTitle: 'המשימות שלי', title: 'ישנה', notes: null, due: null, completed: true, deleted: false, updated: null };
    const kv = memoryKv({ [PHONE_TASKS_KEY]: JSON.stringify([old]) });
    expect(readPhoneTasks(kv)[0]!.completedAt ?? null).toBeNull();
    // An edit that is not a tick does not invent one.
    expect(changePhoneTask(kv, 'phone-x', { title: 'ישנה מאוד' }, EVENING)!.completedAt ?? null).toBeNull();
  });
});

describe('a homework tick', () => {
  it('is stamped when made and cleared when undone', () => {
    const kv = memoryKv();
    markHomeworkDone(kv, 'hw-1', true, EVENING);
    expect(readHomeworkStates(kv)['hw-1']).toEqual({ done: true, linkedTaskId: null, doneAt: EVENING.toISOString() });
    markHomeworkDone(kv, 'hw-1', false, EVENING);
    expect(readHomeworkStates(kv)['hw-1']).toEqual({ done: false, linkedTaskId: null, doneAt: null });
  });

  it('keeps its first stamp when ticked again, and through a task being linked', () => {
    const kv = memoryKv();
    markHomeworkDone(kv, 'hw-1', true, MORNING);
    markHomeworkDone(kv, 'hw-1', true, EVENING);
    linkHomeworkTask(kv, 'hw-1', 'phone-1');
    expect(readHomeworkStates(kv)['hw-1']).toEqual({ done: true, linkedTaskId: 'phone-1', doneAt: MORNING.toISOString() });
  });

  it('made before the field existed still reads, with no time', () => {
    const kv = memoryKv({ [HOMEWORK_STATE_KEY]: JSON.stringify({ 'hw-1': { done: true, linkedTaskId: null } }) });
    expect(readHomeworkStates(kv)['hw-1']!.done).toBe(true);
    expect(readHomeworkStates(kv)['hw-1']!.doneAt ?? null).toBeNull();
  });
});

describe('the one full read of Google\'s tasks', () => {
  const CURSORS = { 'gtasks:updatedMin:l1': '2026-11-10T06:00:00.000Z', 'gtasks:updatedMin:l2': '2026-11-10T06:00:00.000Z', 'gcal:syncToken:primary': 'tok' };

  it('clears the task cursors and leaves the calendar\'s', () => {
    const kv = memoryKv({ [GOOGLE_KEYS.cursors]: JSON.stringify(CURSORS) });
    runKeyMigrations(kv);
    expect(JSON.parse(kv.getString(GOOGLE_KEYS.cursors)!)).toEqual({ 'gcal:syncToken:primary': 'tok' });
  });

  it('happens once: cursors written after it stay', () => {
    const kv = memoryKv({ [GOOGLE_KEYS.cursors]: JSON.stringify(CURSORS) });
    runKeyMigrations(kv);
    expect(kv.getString(TASK_TIMES_MIGRATED_KEY)).toBeDefined();
    kv.set(GOOGLE_KEYS.cursors, JSON.stringify(CURSORS));
    runKeyMigrations(kv);
    expect(JSON.parse(kv.getString(GOOGLE_KEYS.cursors)!)).toEqual(CURSORS);
  });

  it('a phone with no Google, or cursors it cannot read, is marked done and left as it is', () => {
    const none = memoryKv();
    runKeyMigrations(none);
    expect(none.map.has(GOOGLE_KEYS.cursors)).toBe(false);
    expect(none.getString(TASK_TIMES_MIGRATED_KEY)).toBeDefined();
    const broken = memoryKv({ [GOOGLE_KEYS.cursors]: 'not json' });
    runKeyMigrations(broken);
    expect(broken.getString(GOOGLE_KEYS.cursors)).toBe('not json');
  });
});
