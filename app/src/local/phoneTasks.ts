/**
 * The tasks of someone who has not connected Google: kept on the phone alone,
 * in a store of their own (`local.tasks`), as the same `NormalizedTask` Google's
 * come as, in one list, "המשימות שלי", under ids that start with `phone-`.
 *
 * Not in `google.kept`: the first read from Google would clear the list there
 * (its scope is complete), and disconnecting would take the tasks with it. When
 * Google is connected the tasks move over and leave this store (`withPhoneTasks`
 * lays them over what Google kept until then).
 *
 * Pure, with no React Native: a key-value store in, plain data out, so tests can
 * load it. The pattern is `demo/mode.ts`, and the homework link is the one
 * `google/tasks.ts` keeps for a task made in Google.
 */
import type { CreateTaskBody, TaskListOption, UpdateTaskBody } from '@sederyom/shared';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { homeworkLinkedTo, linkHomeworkTask, type KV } from './homeworkState';

export const PHONE_TASKS_KEY = 'local.tasks';

/** The one list without Google. */
export const PHONE_LIST: TaskListOption = { id: 'phone', title: 'המשימות שלי' };

export const PHONE_TASKS_COPY = {
  /** Adding where there is nowhere to keep it: a parent, whose tasks tab opens only with Google. */
  needGoogle: 'כדי להוסיף משימות צריך להתחבר ל-Google.',
  /** A task the phone no longer has because it was moved to Google while the screen was open. */
  moved: 'המשימה הזו כבר עברה ל־Google. אפשר לנסות שוב.',
} as const;

const PREFIX = 'phone-';

/** A task the phone keeps itself, by its id. */
export function isPhoneTaskId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** What the phone keeps, in the order it was added. A damaged store is no tasks. */
export function readPhoneTasks(kv: KV): NormalizedTask[] {
  try {
    const raw = JSON.parse(kv.getString(PHONE_TASKS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is NormalizedTask => !!t && typeof t === 'object' && typeof (t as NormalizedTask).googleId === 'string');
  } catch {
    return [];
  }
}

function save(kv: KV, tasks: readonly NormalizedTask[]): void {
  kv.set(PHONE_TASKS_KEY, JSON.stringify(tasks));
}

const cleanNotes = (notes: string | null): string | null => notes?.trim() || null;

/** "+ משימה" without Google: always in the phone's list, whatever list was asked for. */
export function addPhoneTask(kv: KV, body: CreateTaskBody, now: Date = new Date()): NormalizedTask {
  const task: NormalizedTask = {
    googleId: `${PREFIX}${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    listId: PHONE_LIST.id,
    listTitle: PHONE_LIST.title,
    title: body.title.trim(),
    notes: cleanNotes(body.notes ?? null),
    due: body.due ?? null,
    completed: false,
    completedAt: null,
    deleted: false,
    updated: now.toISOString(),
  };
  save(kv, [...readPhoneTasks(kv), task]);
  if (body.fromHomeworkKey) linkHomeworkTask(kv, body.fromHomeworkKey, task.googleId);
  return task;
}

/** A tick, a new title, notes or due date: `null` when the phone has no such task. */
export function changePhoneTask(kv: KV, id: string, body: UpdateTaskBody, now: Date = new Date()): NormalizedTask | null {
  const tasks = readPhoneTasks(kv);
  const at = tasks.findIndex((t) => t.googleId === id);
  if (at < 0) return null;
  const before = tasks[at]!;
  // The first tick's moment stays through later edits; reopening the task takes it away.
  const completedAt = body.completed === undefined ? before.completedAt ?? null
    : !body.completed ? null
    : before.completed ? before.completedAt ?? null : now.toISOString();
  const changed: NormalizedTask = {
    ...before,
    ...(body.title !== undefined ? { title: body.title.trim() } : {}),
    ...(body.notes !== undefined ? { notes: cleanNotes(body.notes) } : {}),
    ...(body.due !== undefined ? { due: body.due } : {}),
    ...(body.completed !== undefined ? { completed: body.completed } : {}),
    completedAt,
    updated: now.toISOString(),
  };
  save(kv, tasks.map((t, i) => (i === at ? changed : t)));
  return changed;
}

/**
 * Gone from the phone, not marked deleted: no read of Google would bring it back.
 * The homework it was made from is open again, so it can be added again.
 */
export function removePhoneTask(kv: KV, id: string): boolean {
  const tasks = readPhoneTasks(kv);
  if (!tasks.some((t) => t.googleId === id)) return false;
  save(kv, tasks.filter((t) => t.googleId !== id));
  const homework = homeworkLinkedTo(kv, id);
  if (homework) linkHomeworkTask(kv, homework, null);
  return true;
}

const asEntity = (t: NormalizedTask): KeptEntity => ({ kind: 'task', naturalKey: `${t.listId}|${t.googleId}`, partition: t.listId, payload: t });

/** What Google kept, with the phone's tasks after it, as `task` entities the screens already read. */
export function withPhoneTasks(google: readonly KeptEntity[], tasks: readonly NormalizedTask[]): KeptEntity[] {
  return [...google, ...tasks.map(asEntity)];
}
