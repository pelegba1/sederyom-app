/**
 * What the student did with each homework item (plan Phase 2e): ticked it
 * off ("עשיתי"), or turned it into a task, kept on the phone for the days it
 * builds.
 */
export const HOMEWORK_STATE_KEY = 'local.homeworkState';

export interface HomeworkState {
  done: boolean;
  linkedTaskId: string | null;
  /** When it was ticked (ISO); null when not done, absent for a tick made before this was kept. */
  doneAt?: string | null;
}

/** Homework natural key → its state. */
export type HomeworkStates = Record<string, HomeworkState>;

export interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function readHomeworkStates(kv: KV): HomeworkStates {
  try {
    return JSON.parse(kv.getString(HOMEWORK_STATE_KEY) ?? '{}') as HomeworkStates;
  } catch {
    return {};
  }
}

/** One tick, or its undoing. */
export function markHomeworkDone(kv: KV, key: string, done: boolean, now: Date = new Date()): void {
  const states = readHomeworkStates(kv);
  const before = states[key];
  // A second tick of a done item keeps the first one's moment.
  const doneAt = !done ? null : before?.done ? before.doneAt ?? null : now.toISOString();
  states[key] = { done, linkedTaskId: before?.linkedTaskId ?? null, doneAt };
  kv.set(HOMEWORK_STATE_KEY, JSON.stringify(states));
}

/** Links an item to a task the phone made from it, or unlinks it (`null`). */
export function linkHomeworkTask(kv: KV, key: string, taskId: string | null): void {
  const states = readHomeworkStates(kv);
  states[key] = { ...states[key], done: states[key]?.done ?? false, linkedTaskId: taskId };
  kv.set(HOMEWORK_STATE_KEY, JSON.stringify(states));
}

/** The item a task was made from, if any. */
export function homeworkLinkedTo(kv: KV, taskId: string): string | null {
  const states = readHomeworkStates(kv);
  return Object.keys(states).find((key) => states[key]!.linkedTaskId === taskId) ?? null;
}
