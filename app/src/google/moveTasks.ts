/**
 * The tasks kept on the phone (`local/phoneTasks.ts`) move into Google once a
 * read of Google went well: whoever connects asked for their tasks to be there.
 * Behind a read, not in `connectGoogle`, so a move that was cut short goes on
 * with the next read. A file of its own: `tasks.ts` imports `sync.ts`, which
 * therefore cannot import it.
 */
import type { Task } from '@sederyom/shared';
import { homeworkLinkedTo } from '../local/homeworkState';
import { readPhoneTasks, removePhoneTask } from '../local/phoneTasks';
import { syncGoogleBehindSignIn, type GoogleSignInState, type GoogleSyncDeps, type GoogleSyncOutcome } from './sync';
import { createTaskOnPhone, deleteTaskOnPhone, updateTaskOnPhone, type PhoneTasksDeps } from './tasks';

/**
 * A refusal of this one task: Google answered 4xx, and not the kind that says
 * something about the whole account (401 sign-in, 403 no right, 429 too many).
 * A title or notes over Google's limits is refused every time, so such a task
 * is skipped, not waited on. No status (the network, or a sign-in that failed
 * twice) and 5xx are not a verdict on the task.
 */
function refusedForThisTaskAlone(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
}

/**
 * Task by task, in the order they were added, into Google's first list. The
 * ids are taken once; each task is read again from the phone just before it is
 * sent, so a task deleted, ticked or edited since the move began goes up as it
 * is now, or not at all. The homework link follows the task (`createTaskOnPhone`
 * re-points it), and the phone lets go of a task only after Google has it. After
 * Google answered the task is read once more: gone (deleted while its request
 * was out) it is deleted from Google again, best-effort, and not counted;
 * still there it is removed from the phone, counted, and marked done if it is
 * done now. The first failure stops the loop: what did not move goes at the
 * next read, and what did is not sent again. The exception is a task Google
 * refuses with a 4xx that is no verdict on the account (`refusedForThisTaskAlone`):
 * it stays on the phone, tried again at each read, and the rest go on. A task
 * Google took whose answer was lost is sent again, and shows up twice: a rare
 * double is better than a loss. Returns how many moved.
 */
export async function movePhoneTasks(deps: PhoneTasksDeps): Promise<number> {
  let moved = 0;
  const stillOnPhone = (id: string) => readPhoneTasks(deps.kv).find((t) => t.googleId === id);
  for (const id of readPhoneTasks(deps.kv).map((t) => t.googleId)) {
    const task = stillOnPhone(id);
    if (!task) continue; // deleted since the move began: nothing to send
    const homework = homeworkLinkedTo(deps.kv, id);
    let created: Task;
    try {
      created = await createTaskOnPhone(deps, {
        title: task.title,
        notes: task.notes,
        due: task.due,
        ...(homework ? { fromHomeworkKey: homework } : {}),
      });
    } catch (err) {
      if (refusedForThisTaskAlone(err)) continue; // stays on the phone; the rest go on
      break; // the rest go at the next read
    }
    const now = stillOnPhone(id);
    if (!now) {
      // Deleted while its request was out: take it out of Google again, so it does not reappear.
      await deleteTaskOnPhone(deps, created.id).catch(() => undefined);
      continue;
    }
    removePhoneTask(deps.kv, id);
    moved += 1;
    // One try: a mark that fails leaves the task in Google, not done.
    if (now.completed) await updateTaskOnPhone(deps, created.id, { completed: true }).catch(() => undefined);
  }
  return moved;
}

/**
 * `syncGoogleBehindSignIn`, and after a read that went well the move. Any other
 * outcome, and a phone that never signed in (`null`), moves nothing.
 */
export async function syncGoogleAndMoveTasks(
  deps: GoogleSyncDeps,
  signIn: GoogleSignInState,
  opts: { force?: boolean } = {},
): Promise<GoogleSyncOutcome | null> {
  const outcome = await syncGoogleBehindSignIn(deps, signIn, opts);
  if (outcome?.kind !== 'ok') return outcome;
  return { ...outcome, moved: await movePhoneTasks(deps) };
}
