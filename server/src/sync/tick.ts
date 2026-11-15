/**
 * One scheduling policy, two triggers.
 *
 * On a long-lived process (the VM) node-cron calls `runTick` every minute. On
 * serverless (Vercel) an external pinger calls `POST /cron/tick`. Both land
 * here, so "what is due right now" is decided in exactly one place.
 *
 * A serverless invocation keeps no memory between runs, so what is due is read
 * from the database: each followed class carries when it was last polled, and
 * so does its exam calendar. The policy is identical under both triggers and
 * survives a restart on either.
 */
import { BUDDY_BOX_STALE_DAYS, BUDDY_INVITE_TTL_DAYS, CHAT_CODE_LOCK_MS, CHAT_SNAPSHOT_STALE_DAYS } from '@sederyom/shared';
import { DateTime } from 'luxon';
import type { Services } from '../services.js';
import { inActiveWindow } from '../lib/time.js';
import { KEPT_WHEN_DELETED, USED } from '../routes/buddies.js';
import { pollDueClasses, pollDueExamCalendars, type ClassPollResult } from './classes.js';
import { dispatchClassChanges, type FanoutResult } from '../notify/fanout.js';
import { backfillDueClasses } from '../history/backfill.js';
import { freezeDueDays } from '../history/run.js';

/**
 * Tolerance for an early tick, in minutes.
 *
 * Load-bearing when the pinger's interval equals a cadence. A pinger set to
 * 15 minutes does not fire at exactly 900.000s; arriving 20 seconds early
 * makes the class 14.7 minutes old, it is judged not due, and the next chance
 * is 15 minutes later: a 15-minute cadence silently becomes 30. The slack
 * absorbs that jitter without letting a class be polled meaningfully more
 * often than asked.
 */
export const DEFAULT_SLACK_MINUTES = 2;

/**
 * How long the record of a push sent to a device is kept. It only stops one
 * change going out twice, and changes are about today and tomorrow; past that
 * it is a copy of old pushes (the privacy page promises it goes).
 */
export const SENT_PUSH_KEEP_DAYS = 30;

/**
 * How long a chat grant may sit with no token: it is made when the student types the code, and
 * its tokens when the chat trades its authorization code (a minute), so one older than this
 * never finished linking. It counts toward the device's chats until it goes.
 */
export const CHAT_TOKENLESS_GRANT_MS = 3600_000;

/** How long a chat client that nobody linked stays: registration is open, so these only pile up. */
export const CHAT_UNLINKED_CLIENT_DAYS = 7;

export interface TickResult {
  /** The followed classes' polls and pushes; `null` when that step threw. */
  classes: (ClassPollResult & FanoutResult & { examCalendars: number }) | null;
  errors: string[];
}

export async function runTick(services: Services, now: Date): Promise<TickResult> {
  const { env, prisma, logger } = services;
  const nowDt = DateTime.fromJSDate(now).setZone(env.TIMEZONE);
  const errors: string[] = [];
  const inWindow = inActiveWindow(nowDt, env.ACTIVE_WINDOW_START, env.ACTIVE_WINDOW_END);

  // Every followed class (plan Phase 2): its timetable site, its exam calendar,
  // and the pushes its changes owe the devices that follow it.
  let classes: TickResult['classes'] = null;
  try {
    const polled = await pollDueClasses(
      { prisma, logger, shahafFor: (url) => services.shahafFor(url) },
      {
        now,
        everyMinutes: inWindow ? env.POLL_SHAHAF_ACTIVE_MIN : env.POLL_SHAHAF_IDLE_MIN,
        limit: env.CLASS_POLLS_PER_TICK,
        slackMinutes: DEFAULT_SLACK_MINUTES,
      },
    );
    const exams = await pollDueExamCalendars(
      { prisma, logger, schoolSiteFor: (id) => services.schoolSiteFor(id) },
      { now, everyMinutes: env.POLL_SCHOOL_SITE_MIN, limit: env.CLASS_POLLS_PER_TICK, slackMinutes: DEFAULT_SLACK_MINUTES },
    );
    const pushed = await dispatchClassChanges({ prisma, pusher: services.pusher, logger, zone: env.TIMEZONE }, now);
    classes = { ...polled, ...pushed, examCalendars: exams.polled };
  } catch (err) {
    errors.push(`classes: ${String(err)}`);
    logger.error({ err: String(err) }, 'class polling threw');
  }

  // The class history (year wrapped): each day that passed is written once, from the events the
  // polls above recorded, and the weeks before a class's log began are read from the site's past
  // weeks, a few pages a tick. Neither deletes or rewrites anything.
  try {
    await freezeDueDays({ prisma, logger, zone: env.TIMEZONE }, { now, daysPerTick: env.HISTORY_DAYS_PER_TICK });
    await backfillDueClasses(
      { prisma, logger, zone: env.TIMEZONE, shahafFor: (url) => services.shahafFor(url) },
      { now, weeksPerTick: env.HISTORY_BACKFILL_WEEKS_PER_TICK },
    );
  } catch (err) {
    errors.push(`history: ${String(err)}`);
    logger.error({ err: String(err) }, 'freezing past days threw');
  }

  try {
    const before = new Date(now.getTime() - SENT_PUSH_KEEP_DAYS * 24 * 3600_000);
    await prisma.deviceNotification.deleteMany({ where: { sentAt: { lt: before } } });
  } catch (err) {
    errors.push(`sent pushes: ${String(err)}`);
    logger.error({ err: String(err) }, 'forgetting old pushes threw');
  }

  // Friends' boxes (`buddy_box`), two rules, in this order. An invite or a reply that nobody answered
  // within its days is emptied, not deleted: it becomes the mark a used link leaves (`ciphertext` '',
  // `routes/buddies.ts`), dated now, so that the link cannot be armed again under the inviter's name
  // once its box is gone. Then any box not written for `BUDDY_BOX_STALE_DAYS` (a phone that lost the
  // app) is deleted, a mark too, of whatever kind, with or without a writer: a mark lives that long
  // from when it was made, however it was made (its writer's delete, the writer's device going, or
  // the first rule). Ciphertext otherwise.
  try {
    const inviteBefore = new Date(now.getTime() - BUDDY_INVITE_TTL_DAYS * 24 * 3600_000);
    const staleBefore = new Date(now.getTime() - BUDDY_BOX_STALE_DAYS * 24 * 3600_000);
    // Not `settleBoxes`: that is a delete's (and it deletes pair boxes). The mark is the same, and so are its constants.
    await prisma.buddyBox.updateMany({
      where: { kind: { in: KEPT_WHEN_DELETED }, ciphertext: { not: USED }, createdAt: { lt: inviteBefore } },
      data: { ciphertext: USED, updatedAt: now },
    });
    await prisma.buddyBox.deleteMany({ where: { updatedAt: { lt: staleBefore } } });
  } catch (err) {
    errors.push(`buddy boxes: ${String(err)}`);
    logger.error({ err: String(err) }, 'forgetting stale buddy boxes threw');
  }

  // The chat connection (`chat_*`), each rule after the one it depends on. Codes and tokens past their
  // expiry go; a grant left with no token goes, unless it is young enough to be mid-link; then the
  // client nobody ever linked (`linkedAt` null, and no grant), a week after it registered; and the
  // copy of a device that has no chat left to read it (this tick's, or a PUT that raced the last
  // revoke). A client once linked stays: a chat keeps its `client_id` after the student disconnects
  // it, and comes back with it to link again. Wrong tries are only counted for `CHAT_CODE_LOCK_MS`.
  try {
    const hour = new Date(now.getTime() - CHAT_TOKENLESS_GRANT_MS);
    const week = new Date(now.getTime() - CHAT_UNLINKED_CLIENT_DAYS * 24 * 3600_000);
    const stale = new Date(now.getTime() - CHAT_SNAPSHOT_STALE_DAYS * 24 * 3600_000);
    const tries = new Date(now.getTime() - CHAT_CODE_LOCK_MS);
    await prisma.chatCode.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.chatAuthCode.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.chatToken.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.chatGrant.deleteMany({ where: { tokens: { none: {} }, createdAt: { lt: hour } } });
    await prisma.chatClient.deleteMany({ where: { linkedAt: null, grants: { none: {} }, createdAt: { lt: week } } });
    await prisma.chatSnapshot.deleteMany({ where: { writtenAt: { lt: stale } } });
    await prisma.chatSnapshot.deleteMany({ where: { device: { chatGrants: { none: {} } } } });
    await prisma.chatAttempt.deleteMany({ where: { at: { lt: tries } } });
  } catch (err) {
    errors.push(`chat: ${String(err)}`);
    logger.error({ err: String(err) }, 'forgetting stale chat rows threw');
  }

  if (classes && (classes.polled > 0 || classes.failed > 0 || classes.examCalendars > 0 || classes.sent > 0)) {
    logger.info({ classes }, 'tick');
  }
  return { classes, errors };
}
