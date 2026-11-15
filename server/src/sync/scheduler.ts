/**
 * In-process scheduler for a long-lived deployment (the VM). It owns no
 * scheduling policy of its own — it ticks once a minute and `runTick` decides
 * what is due, so the VM and the serverless cron behave identically.
 *
 * Everything is pinned to Asia/Jerusalem, the cron expression included.
 */
import cron, { type ScheduledTask } from 'node-cron';
import type { Services } from '../services.js';
import { runTick } from './tick.js';

export interface Scheduler {
  stop(): void;
}

export function startScheduler(services: Services): Scheduler {
  const { env, logger } = services;
  let running = false;

  const tick = async (): Promise<void> => {
    // Ticks must not overlap: a slow poll would otherwise stack invocations.
    if (running) return;
    running = true;
    try {
      await runTick(services, new Date());
    } catch (err) {
      logger.error({ err: String(err) }, 'tick threw');
    } finally {
      running = false;
    }
  };

  const task: ScheduledTask = cron.schedule('* * * * *', () => void tick(), { timezone: env.TIMEZONE });

  logger.info(
    {
      shahafActiveMin: env.POLL_SHAHAF_ACTIVE_MIN,
      shahafIdleMin: env.POLL_SHAHAF_IDLE_MIN,
      examCalendarMin: env.POLL_SCHOOL_SITE_MIN,
      tz: env.TIMEZONE,
    },
    'scheduler started',
  );

  return {
    stop() {
      task.stop();
    },
  };
}
