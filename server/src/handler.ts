/**
 * Serverless entry point. Vercel invokes this per request; the Fastify instance
 * is built once at module scope and reused across warm invocations, so route
 * registration and the Prisma client are not rebuilt on every call.
 *
 * The long-lived entry point is `index.ts`, which additionally starts the
 * in-process scheduler. Here there is no scheduler: `POST /cron/tick` is the
 * trigger, driven from outside.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { db } from './lib/db.js';
import { buildServices } from './services.js';

let ready: Promise<FastifyInstance> | null = null;

async function bootstrap(): Promise<FastifyInstance> {
  const env = loadEnv();
  process.env.TZ = env.TIMEZONE;
  const app = buildApp({ services: buildServices(env, db(), console) });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ready ??= bootstrap();
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (err) {
    // A misconfigured environment throws before Fastify exists, so there is no
    // error handler to catch it and the platform reports only
    // FUNCTION_INVOCATION_FAILED — which says nothing about which variable is
    // missing. Answer with the actual reason instead; zod's message names the
    // offending keys and never their values.
    //
    // The rejected promise is cleared so a later invocation can retry rather
    // than serving a cached failure for the life of the instance.
    ready = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error({ err: message }, 'bootstrap failed');
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'bootstrap_failed', message }));
  }
}
