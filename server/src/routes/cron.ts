/**
 * The serverless trigger. An external pinger (cron-job.org, an uptime monitor,
 * anything that can fetch a URL on a schedule) calls this every few minutes and
 * `runTick` decides what is actually due.
 *
 * `?wait=1` runs the tick synchronously and returns its result — use it when
 * debugging by hand, where the answer is the point.
 *
 * Why not Vercel's own cron: on the Hobby plan it is limited to **once per
 * day**, with ±59 minutes of jitter. A schedule like `*​/15 * * * *` fails at
 * deploy time. Polling a school timetable every 15 minutes is the entire point
 * of this service, so the trigger has to come from outside.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.js';
import { runTick } from '../sync/tick.js';

/** The pinger cannot send a bearer header everywhere, so a query secret is allowed too. */
function authorized(request: FastifyRequest, secret: string): boolean {
  const header = request.headers.authorization ?? '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : '';
  const fromQuery = (request.query as { secret?: string } | undefined)?.secret ?? '';
  return [fromHeader, fromQuery].some((candidate) => {
    if (candidate.length !== secret.length || candidate.length === 0) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
  });
}

export function registerCronRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { services } = deps;
  // Required by env.ts, so never empty; `authorized` refuses an empty candidate as well.
  const secret = services.env.CRON_SECRET;

  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (!authorized(request, secret)) {
      const err = new Error('bad cron secret') as Error & { statusCode?: number };
      err.statusCode = 401;
      throw err;
    }

    const started = Date.now();
    const wait = (request.query as { wait?: string } | undefined)?.wait === '1';

    // Free cron pingers cap their read timeout at around 30 seconds, while a
    // tick that polls several sources legitimately takes longer — and Vercel
    // allows 300. Waiting for it means the pinger reports a timeout for work
    // that in fact succeeded, then disables the job for "too many failures".
    //
    // So the request is acknowledged immediately and the tick runs on under
    // `waitUntil`, which keeps the invocation alive past the response. What the
    // pinger then monitors is reachability and authorisation; the health of the
    // sync itself lives on each class row (`lastOkAt`, `lastError`) and in the
    // log, which is where it belongs — a poll failing is not an HTTP failure.
    if (!wait && process.env.VERCEL) {
      const { waitUntil } = await import('@vercel/functions');
      waitUntil(
        runTick(services, new Date()).catch((err: unknown) => {
          services.logger.error({ err: String(err) }, 'background tick threw');
        }),
      );
      return reply.code(202).send({ accepted: true, mode: 'background' });
    }

    const result = await runTick(services, new Date());
    return { ok: result.errors.length === 0, ms: Date.now() - started, ...result };
  };

  // GET as well as POST: most free cron pingers only issue GETs.
  app.get('/cron/tick', handler);
  app.post('/cron/tick', handler);
}
