import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { db, disconnectDb } from './lib/db.js';
import { buildServices } from './services.js';
import { startScheduler, type Scheduler } from './sync/scheduler.js';

async function main(): Promise<void> {
  const env = loadEnv();
  // Every cron expression and every date computation is Asia/Jerusalem; pin the
  // process default too so nothing accidentally reads the host clock's zone.
  process.env.TZ = env.TIMEZONE;

  const prisma = db();
  const services = buildServices(env, prisma, console);
  const scheduler: Scheduler | null = env.SCHEDULER_ENABLED ? startScheduler(services) : null;
  const app = buildApp({ services });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    scheduler?.stop();
    await app.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info({ tz: env.TIMEZONE, scheduler: env.SCHEDULER_ENABLED }, 'sederyom server up');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
