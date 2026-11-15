/**
 * The demo (Google Play's "App access"): its switch, its words, and the tasks
 * the visitor changed in it. `demo/data.ts` makes up everything else, for the
 * day it is shown, and `demo/phone.ts` keeps the switch in MMKV.
 *
 * It is offered only on the welcome step, before anything is connected, so it
 * never mixes with a student's own data, and leaving it wipes the phone's
 * storage as "מחק את הנתונים שלי" does, with nothing to tell the server or
 * Google (`leaveDemoNow`).
 *
 * While it is on, nothing reaches the network. Each way out of the phone asks
 * once, where it starts:
 * - `refreshLocalSources` (`local/source.ts`): no Mashov or Google read, no
 *   device call, no class feed, no exam calendar in Google;
 * - `rescheduleSummaries` (the same file): no notification scheduled from
 *   made-up days;
 * - `backgroundRefresh` and `registerBackgroundRefresh` (`background/refresh.ts`);
 * - the push address (`push/usePushRegistration.ts`);
 * - the Mashov renewal sheet (`MashovRenewHost`), so no login ever pops up;
 * - every call the screens make (`api/hooks.ts` through `demo/api.ts`), and
 *   the class's exam board, a link or a file (`ExamBoard`).
 *
 * What the visitor does keeps working on the phone where it is the phone's
 * anyway: a homework tick, an exam added or renamed, the settings. A task is
 * Google's, so the demo keeps its own copy of the ones changed (`DEMO_TASKS_KEY`).
 * What only the school's site or the server could keep says so (`DEMO_COPY.notSaved`).
 *
 * Pure: a key-value store in, plain data out, so tests can load it.
 */
import type { CreateTaskBody, TaskListOption, UpdateTaskBody } from '@sederyom/shared';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';

export const DEMO_KEY = 'demo.on';
/** Task id → the task as the visitor left it: added, ticked, edited or deleted. */
export const DEMO_TASKS_KEY = 'demo.tasks';

export interface DemoKV {
  getBoolean(key: string): boolean | undefined;
  getString(key: string): string | undefined;
  set(key: string, value: string | boolean): void;
}

export function demoOn(kv: Pick<DemoKV, 'getBoolean'>): boolean {
  return kv.getBoolean(DEMO_KEY) === true;
}

/** Every word the demo adds to the app. */
export const DEMO_COPY = {
  /** The welcome step's second button, and the line under it. */
  enter: 'להסתכל בהדגמה',
  enterLine: 'כל האפליקציה עם נתונים מומצאים, בלי להתחבר לשום חשבון.',
  /** The quiet line at the top of Settings, and what it means. */
  marker: 'הדגמה עם נתונים לדוגמה',
  markerLine: 'השמות, המערכת והציונים כאן מומצאים. כדי להתחיל עם הנתונים שלך, יוצאים מההדגמה.',
  /** Settings' way out, where "מחק את הנתונים שלי" is otherwise. */
  leave: 'לצאת מההדגמה',
  leaveLine: 'הנתונים לדוגמה יימחקו מהטלפון, ונחזור למסך הפתיחה',
  leaveDone: 'יצאנו מההדגמה',
  /** A source's status on "מצב חיבורים", where it would say "מחובר". */
  status: 'הדגמה',
  /** "מצב חיבורים"' line under them, and Settings' summary of them. */
  connections: 'בהדגמה אין חיבור למשוב או ל־Google. כל מה שמופיע באפליקציה מומצא.',
  connectionsRow: 'הדגמה, בלי חשבונות',
  /** A change only the school's site or the server could keep. */
  notSaved: 'בהדגמה זה לא נשמר',
  /** Under a setting that would write to Google ("המבחנים שלך ביומן Google"), off and locked in the demo. */
  noGoogle: 'בהדגמה שום דבר לא נכתב ל־Google',
  /**
   * A homework sheet's line in the demo, without "להעתיק ל־Google Tasks": the
   * demo has no Google Tasks to copy to (`HOMEWORK_IN_TASKS`, less its second sentence).
   */
  homeworkInTasks: 'שיעורי הבית כבר מופיעים במשימות.',
} as const;

/** Task id → the task as the visitor left it. */
export type DemoTaskEdits = Record<string, NormalizedTask>;

export function readDemoTaskEdits(kv: Pick<DemoKV, 'getString'>): DemoTaskEdits {
  try {
    const raw = JSON.parse(kv.getString(DEMO_TASKS_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as DemoTaskEdits) : {};
  } catch {
    return {};
  }
}

function keep(kv: DemoKV, task: NormalizedTask): NormalizedTask {
  kv.set(DEMO_TASKS_KEY, JSON.stringify({ ...readDemoTaskEdits(kv), [task.googleId]: task }));
  return task;
}

const asEntity = (t: NormalizedTask): KeptEntity => ({ kind: 'task', naturalKey: `${t.listId}|${t.googleId}`, partition: t.listId, payload: t });

/** The made-up Google with the visitor's tasks on it: each changed one in place of its made-up self, the added ones after. */
export function withDemoTaskEdits(google: readonly KeptEntity[], edits: DemoTaskEdits): KeptEntity[] {
  const changed = new Set(Object.keys(edits));
  const rest = google.filter((e) => !(e.kind === 'task' && changed.has((e.payload as NormalizedTask).googleId)));
  return [...rest, ...Object.values(edits).map(asEntity)];
}

function findTask(google: readonly KeptEntity[], id: string): NormalizedTask | null {
  const found = google.find((e) => e.kind === 'task' && (e.payload as NormalizedTask).googleId === id);
  return found ? (found.payload as NormalizedTask) : null;
}

/** "+ משימה" in the demo: kept with the demo, in the list asked for or the first. */
export function addDemoTask(kv: DemoKV, google: readonly KeptEntity[], body: CreateTaskBody, now: Date = new Date()): NormalizedTask {
  const lists = google.filter((e) => e.kind === 'task_list').map((e) => e.payload as TaskListOption);
  const list = lists.find((l) => l.id === body.listId) ?? lists[0] ?? { id: 'demo-tasks', title: 'המשימות שלי' };
  return keep(kv, {
    googleId: `demo-task-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    listId: list.id,
    listTitle: list.title,
    title: body.title.trim(),
    notes: body.notes?.trim() || null,
    due: body.due ?? null,
    completed: false,
    completedAt: null,
    deleted: false,
    updated: now.toISOString(),
  });
}

/** A tick, a new title, notes or due date: `null` when the demo has no such task. */
export function changeDemoTask(kv: DemoKV, google: readonly KeptEntity[], id: string, body: UpdateTaskBody, now: Date = new Date()): NormalizedTask | null {
  const task = findTask(google, id);
  if (!task || task.deleted) return null;
  return keep(kv, {
    ...task,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.due !== undefined ? { due: body.due } : {}),
    ...(body.completed !== undefined ? { completed: body.completed } : {}),
    updated: now.toISOString(),
  });
}

/** Deleted as Google keeps a deleted task: marked, so the made-up one does not come back. */
export function dropDemoTask(kv: DemoKV, google: readonly KeptEntity[], id: string, now: Date = new Date()): NormalizedTask | null {
  const task = findTask(google, id);
  return task ? keep(kv, { ...task, deleted: true, updated: now.toISOString() }) : null;
}
