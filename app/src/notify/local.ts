/**
 * Shows the phone's own notifications through the system, on the same
 * channel the pushes use: the Mashov notes (`mashovNotes.ts`) now or when the
 * quiet hours end, and the morning summary and evening reminder
 * (`summaries.ts`) at their times. A tap opens what a push would
 * (`push/handlers.ts` reads the same payload).
 *
 * And the log's side on the phone (`log.ts`): a note shown at once is logged
 * as it is shown; one held for later is logged when it arrives, by the
 * listener in `push/handlers.ts` or from the tray (`reconcileNotificationLog`).
 */
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import type { LocalSources } from '../local/days';
import { storage } from '../widget/feedCache';
import { appendDeliveries, type Delivery } from './log';
import type { LocalNote } from './mashovNotes';
import { NEXT_LESSON_CHANNEL, planNextLessons, staleNextLessonIds, type NextLessonAction } from './nextLesson';
import { planLocalSummaries, SETTLE_MS, type SummaryAction, type SummaryChild } from './summaries';

/** The channel `usePushRegistration` creates for every notification. */
const CHANNEL = 'default';

function contentOf(note: LocalNote): Notifications.NotificationContentInput {
  return { title: note.title, body: note.body, data: note.data as unknown as Record<string, unknown>, sound: 'default' };
}

/**
 * A notification as the log takes it. `at` when the moment it reached the
 * phone is known better than its own date (for a push, the time it was sent).
 */
export function deliveryOf(notification: Notifications.Notification, at?: number): Delivery {
  const { identifier, content } = notification.request;
  // Milliseconds on Android; seconds would be a date in 1970.
  const date = notification.date > 0 && notification.date < 1e11 ? notification.date * 1000 : notification.date;
  return { identifier, at: at ?? date, title: content.title, body: content.body, data: content.data };
}

/** Logs what was seen (`log.ts`); true when something was added. Never throws. */
export function logDeliveries(seen: readonly Delivery[]): boolean {
  try {
    return appendDeliveries(storage, seen).length > 0;
  } catch {
    return false;
  }
}

/**
 * Logs what is in the tray and is not logged yet: what came while the app was
 * closed. On start, on every return to the app and in the background refresh.
 * True when something was added. Never throws.
 */
export async function reconcileNotificationLog(): Promise<boolean> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return logDeliveries(presented.map((n) => deliveryOf(n)));
  } catch {
    return false;
  }
}

export async function showLocalNotes(notes: readonly LocalNote[], at: Date | null): Promise<void> {
  for (const note of notes) {
    const identifier = await Notifications.scheduleNotificationAsync({
      // A named note replaces the one shown or waiting under its name.
      ...(note.identifier ? { identifier: note.identifier } : {}),
      content: contentOf(note),
      trigger: at ? { type: SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL } : { channelId: CHANNEL },
    });
    // Shown now: logged now, so a note from a read with the app closed is there even if swiped away unseen.
    if (!at) logDeliveries([{ identifier, at: Date.now(), title: note.title, body: note.body, data: note.data }]);
  }
}

/** Takes back the note shown under `identifier`: still waiting for the end of the quiet hours, or in the tray. */
export async function withdrawLocalNote(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
  await Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
}

/** The identifiers pending now, or null when the system cannot say (then every cancel is sent). */
async function pendingIds(): Promise<Set<string> | null> {
  try {
    return new Set((await Notifications.getAllScheduledNotificationsAsync()).map((r) => r.identifier));
  } catch {
    return null;
  }
}

/**
 * Carries out `planLocalSummaries`: each `schedule` in place of the one
 * pending under its identifier, each `cancel` only when one is pending, and
 * nothing for `keep`. The clock is read again before each schedule: building
 * the days takes a moment, and a time that came meanwhile is left alone like
 * any other (a trigger already past would make the system remove the one
 * pending under it).
 */
export async function applySummaryActions(actions: readonly SummaryAction[]): Promise<void> {
  const pending = await pendingIds();
  for (const a of actions) {
    if (a.action === 'cancel') {
      if (!pending || pending.has(a.identifier)) await Notifications.cancelScheduledNotificationAsync(a.identifier);
    } else if (a.action === 'schedule' && a.note && a.at && a.at.getTime() > Date.now() + SETTLE_MS) {
      await Notifications.scheduleNotificationAsync({
        identifier: a.identifier,
        content: contentOf(a.note),
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: a.at, channelId: CHANNEL },
      });
    }
  }
}

/** The next lesson's channel (ideas פ1): silent, and the whole note on the lock screen. Asking again changes nothing. */
async function ensureNextLessonChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(NEXT_LESSON_CHANNEL, {
    name: 'השיעור הבא',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Carries out `planNextLessons` as `applySummaryActions` carries out the
 * summaries' plan. Each note carries when it goes (`timeoutAfterMs`, for the
 * patched notification builder, and `until`), and the notes shown past their
 * lesson's start are taken back here too.
 */
export async function applyNextLessonActions(actions: readonly NextLessonAction[]): Promise<void> {
  const pending = await pendingIds();
  if (actions.some((a) => a.action === 'schedule')) await ensureNextLessonChannel().catch(() => undefined);
  for (const a of actions) {
    if (a.action === 'cancel') {
      if (!pending || pending.has(a.identifier)) await Notifications.cancelScheduledNotificationAsync(a.identifier);
    } else if (a.action === 'schedule' && a.note && a.at && a.at.getTime() > Date.now() + SETTLE_MS) {
      await Notifications.scheduleNotificationAsync({
        identifier: a.identifier,
        content: {
          title: a.note.title,
          body: a.note.body,
          data: { ...(a.note.data as unknown as Record<string, unknown>), timeoutAfterMs: a.until - a.at.getTime(), until: a.until },
        },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: a.at, channelId: NEXT_LESSON_CHANNEL },
      });
    }
  }
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const stale = staleNextLessonIds(shown.map((n) => ({ identifier: n.request.identifier, data: n.request.content.data })), Date.now());
    for (const id of stale) await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  } catch {
    // The tray could not be read: the next refresh tries again.
  }
}

/**
 * The morning summaries and evening reminders of the days ahead, and the
 * next lesson's notes (ideas פ1), from the phone's own days as they are now.
 * Callers go through `rescheduleSummaries` (`local/source.ts`), which runs
 * one at a time with what is stored then. A parent's children (`children`)
 * all go into the summaries; the next lesson is the child's on screen.
 */
export async function syncSummaries(src: LocalSources | null, zone: string, children: readonly SummaryChild[] = []): Promise<void> {
  await applySummaryActions(planLocalSummaries(src, new Date(), zone, children));
  await applyNextLessonActions(planNextLessons(src, new Date(), zone));
}
