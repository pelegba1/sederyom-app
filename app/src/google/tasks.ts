/**
 * Google Tasks written by the phone itself (plan Phase 2e, step 1).
 *
 * The same writes the server makes for `POST/PATCH/DELETE /tasks`, through the
 * shared adapter and the phone's own sign-in, and what the phone keeps is
 * updated at once, so the task is on every screen before the next read of
 * Google. A task made from a homework item is linked to it on the phone
 * (`homeworkState.ts`), which the evening reminder reads to leave it out.
 *
 * Without a Google account the writes stay on the phone (`local/phoneTasks.ts`):
 * the `...Routed` functions at the end choose where each one goes.
 */
import type { Audience, CreateTaskBody, Task, TaskListOption, TasksResponse, UpdateTaskBody } from '@sederyom/shared';
import type { CursorStore } from '@sederyom/shared/logic/google/calendar';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { GoogleTasksAdapter, normalizeTask, type NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { toTask } from '../local/days';
import { homeworkLinkedTo, linkHomeworkTask } from '../local/homeworkState';
import {
  PHONE_LIST, PHONE_TASKS_COPY, addPhoneTask, changePhoneTask, isPhoneTaskId, readPhoneTasks, removePhoneTask, withPhoneTasks,
} from '../local/phoneTasks';
import { GOOGLE_KEYS, googleKept, type KeyValue } from './sync';

export interface PhoneTasksDeps {
  kv: KeyValue;
  requester: GoogleRequester;
  zone: string;
}

/** Writes never touch the adapter's read cursors. */
const NO_CURSORS: CursorStore = { get: async () => null, set: async () => {}, delete: async () => {} };

const adapter = (deps: PhoneTasksDeps) => new GoogleTasksAdapter(deps.requester, NO_CURSORS, { zone: deps.zone });

function lists(kept: readonly KeptEntity[]): TaskListOption[] {
  return kept.filter((e) => e.kind === 'task_list').map((e) => e.payload as TaskListOption);
}

/** `GET /tasks?includeCompleted=true`, from what the phone keeps. */
export function phoneTaskList(kv: KeyValue): TasksResponse {
  return taskListOf(googleKept(kv));
}

/** The task list of a set of kept entities: the phone's, or the demo's (`demo/api.ts`). */
export function taskListOf(kept: readonly KeptEntity[]): TasksResponse {
  const items = kept
    .filter((e) => e.kind === 'task')
    .map((e) => e.payload as NormalizedTask)
    .filter((t) => !t.deleted)
    .map(toTask)
    .sort((a, b) => ((a.due ?? '￿') < (b.due ?? '￿') ? -1 : (a.due ?? '￿') > (b.due ?? '￿') ? 1 : a.title.localeCompare(b.title, 'he')));
  return { items, lists: lists(kept) };
}

/** Replaces (or adds) one task in what the phone keeps. */
function keep(kv: KeyValue, task: NormalizedTask): void {
  const key = `${task.listId}|${task.googleId}`;
  const others = googleKept(kv).filter((e) => !(e.kind === 'task' && e.naturalKey === key));
  kv.set(GOOGLE_KEYS.kept, JSON.stringify([...others, { kind: 'task', naturalKey: key, partition: task.listId, payload: task }]));
}

function keptTask(kv: KeyValue, id: string): NormalizedTask | null {
  const e = googleKept(kv).find((k) => k.kind === 'task' && (k.payload as NormalizedTask).googleId === id);
  return e ? (e.payload as NormalizedTask) : null;
}

export async function createTaskOnPhone(deps: PhoneTasksDeps, body: CreateTaskBody): Promise<Task> {
  const known = lists(googleKept(deps.kv));
  const listId = body.listId ?? known[0]?.id ?? (await adapter(deps).defaultListId());
  const list = { id: listId, title: known.find((l) => l.id === listId)?.title };
  const created = await adapter(deps).createTask(listId, { title: body.title, notes: body.notes, due: body.due });
  const task = normalizeTask(list, created, deps.zone);
  keep(deps.kv, task);
  if (body.fromHomeworkKey) linkHomeworkTask(deps.kv, body.fromHomeworkKey, task.googleId);
  return { ...toTask(task), linkedHomeworkKey: body.fromHomeworkKey ?? null };
}

export async function updateTaskOnPhone(deps: PhoneTasksDeps, id: string, body: UpdateTaskBody): Promise<Task> {
  const existing = keptTask(deps.kv, id);
  if (!existing) throw new Error('task not found');
  const updated = await adapter(deps).patchTask(existing.listId, id, body);
  const task = normalizeTask({ id: existing.listId, title: existing.listTitle ?? undefined }, updated, deps.zone);
  keep(deps.kv, task);
  return toTask(task);
}

export async function deleteTaskOnPhone(deps: PhoneTasksDeps, id: string): Promise<void> {
  const existing = keptTask(deps.kv, id);
  if (!existing) return;
  await adapter(deps).deleteTask(existing.listId, id);
  keep(deps.kv, { ...existing, deleted: true });
  // A homework item made into this task is open again, so it can be re-added.
  const homework = homeworkLinkedTo(deps.kv, id);
  if (homework) linkHomeworkTask(deps.kv, homework, null);
}

/**
 * What the tasks screen reads (`GET /tasks`). Without Google: the phone's list
 * and its tasks alone, whatever Google kept before. With Google: Google's lists,
 * and its tasks with the phone's that have not moved over yet, so a task is
 * on the screen while it moves.
 */
export function tasksOnThisPhone(kv: KeyValue, connected: boolean): TasksResponse {
  const phone = readPhoneTasks(kv);
  if (!connected) return { items: taskListOf(withPhoneTasks([], phone)).items, lists: [PHONE_LIST] };
  return taskListOf(withPhoneTasks(googleKept(kv), phone));
}

/**
 * Where a write goes. `google` builds Google's side only when a write goes
 * there: it touches the phone's native sign-in. `account` is the signed-in
 * Google account; a connection that needs signing in again is still one.
 */
export interface TaskRoute {
  kv: KeyValue;
  account: string | null;
  audience: Audience;
  google: () => PhoneTasksDeps;
}

/**
 * "+ משימה": with a Google account in Google, as before; without one on the
 * phone, except for a parent, whose tasks tab opens only with Google and who
 * would not see it there. The errors are plain, for the screens to show.
 */
export async function createTaskRouted(route: TaskRoute, body: CreateTaskBody): Promise<Task> {
  if (route.account) {
    // The phone's list is not one of Google's.
    return createTaskOnPhone(route.google(), body.listId === PHONE_LIST.id ? { ...body, listId: undefined } : body);
  }
  if (route.audience === 'parent') throw new Error(PHONE_TASKS_COPY.needGoogle);
  const task = addPhoneTask(route.kv, body);
  return { ...toTask(task), linkedHomeworkKey: body.fromHomeworkKey ?? null };
}

/**
 * A tick or an edit, by the id: `phone-` to the phone, anything else to Google.
 * A phone id the phone no longer has was moved to Google while the screen was open.
 */
export async function updateTaskRouted(route: TaskRoute, id: string, body: UpdateTaskBody): Promise<Task> {
  if (!isPhoneTaskId(id)) return updateTaskOnPhone(route.google(), id, body);
  const task = changePhoneTask(route.kv, id, body);
  if (!task) throw new Error(PHONE_TASKS_COPY.moved);
  return toTask(task);
}

/** A delete, by the id, as `updateTaskRouted`. */
export async function deleteTaskRouted(route: TaskRoute, id: string): Promise<void> {
  if (!isPhoneTaskId(id)) return deleteTaskOnPhone(route.google(), id);
  if (!removePhoneTask(route.kv, id)) throw new Error(PHONE_TASKS_COPY.moved);
}
