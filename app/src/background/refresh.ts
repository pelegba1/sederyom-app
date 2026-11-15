/**
 * Refreshing with the app closed (plan Phase 2, step 4).
 *
 * The phone reads Mashov and Google itself, and Mashov's token lasts an hour
 * unless a read renews it, so with nobody opening the app the session would
 * lapse long before Mashov's own 8-hour end. Android's WorkManager runs
 * this task now and then (15 minutes at the soonest, much later in Doze;
 * Android decides), and so does the widget's own periodic update, for anyone
 * who placed one. Both run the same refresh as opening the app does, then
 * redraw the widgets.
 *
 * Headless: no screen, no WebView. So a session Mashov already ended stays
 * ended until the app is opened; this only keeps a live one alive. What the
 * last run did is kept, and shown under משוב's "פרטים טכניים" in מצב חיבורים.
 *
 * Each run also logs what the tray holds (`reconcileNotificationLog`): a
 * summary that arrived with the app closed is in the log even if it is
 * swiped away before the app is next opened, as long as a run came between.
 *
 * Never in the demo (`demo/mode.ts`): it has nothing to read, and is never
 * registered from it.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { refreshWidgetFeed } from '../api/hooks';
import { isDemo } from '../demo/phone';
import { hasOnboarded } from '../lib/prefs';
import { lastLocalRefresh, refreshLocalSources } from '../local/source';
import { reconcileNotificationLog } from '../notify/local';
import { storage } from '../widget/feedCache';
import { requestWidgetUpdate } from '../widget/update';

export const BACKGROUND_REFRESH_TASK = 'sederyom-background-refresh';
const LAST_RUN_KEY = 'background.lastRun';
/** Mashov's and Google's own gate: no point reading again sooner. */
const RECENT_MS = 10 * 60_000;

export interface BackgroundRun {
  at: string;
  /** What woke it: Android's scheduler, or the widget's periodic update. */
  by: 'task' | 'widget';
  /** Each step that failed, in Hebrew (`refreshLocalSources`). */
  problems: string[];
}

export function lastBackgroundRun(): BackgroundRun | null {
  try {
    const raw = storage.getString(LAST_RUN_KEY);
    return raw ? (JSON.parse(raw) as BackgroundRun) : null;
  } catch {
    return null;
  }
}

/** One refresh with the app closed. Never throws: a failed step is recorded, the rest go on. */
export async function backgroundRefresh(by: BackgroundRun['by']): Promise<void> {
  // Not before setup is done: there is nothing to read yet. Nor in the demo, which reads nothing.
  if (!hasOnboarded() || isDemo()) return;
  await reconcileNotificationLog();
  // Just refreshed (the app is open, or the other way in ran): the widget's own update needs no second one.
  const last = lastLocalRefresh();
  if (by === 'widget' && last && Date.now() - last.getTime() < RECENT_MS) return;
  let problems: string[] = [];
  try {
    problems = (await refreshLocalSources()).problems;
  } catch (err) {
    problems = [err instanceof Error ? err.message : String(err)];
  }
  // The widget's own update draws itself; asking it to update again would loop.
  if (by === 'task') await refreshWidgetFeed().then(requestWidgetUpdate).catch(() => undefined);
  storage.set(LAST_RUN_KEY, JSON.stringify({ at: new Date().toISOString(), by, problems } satisfies BackgroundRun));
}

// Defined at load, in the global scope: Android may start the JS just to run it.
TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
  await backgroundRefresh('task');
  return BackgroundTask.BackgroundTaskResult.Success;
});

/** Asks Android to run the refresh now and then; once is enough, it survives restarts. */
export async function registerBackgroundRefresh(): Promise<void> {
  // The demo's way in finishes the welcome step as setup does: no refresh with the app closed for it.
  if (isDemo()) return;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK)) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, { minimumInterval: 15 });
  } catch {
    // Without it the app still refreshes on open and through the widget.
  }
}
