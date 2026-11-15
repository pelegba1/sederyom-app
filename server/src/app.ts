import Fastify, { type FastifyInstance } from 'fastify';
import type { Device } from '@prisma/client';
import type { Services } from './services.js';
import { registerCronRoutes } from './routes/cron.js';
import { registerBuddyRoutes } from './routes/buddies.js';
import { registerChatDeviceRoutes } from './routes/chatDevice.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerExamBoardRoutes } from './routes/examBoard.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerChatCors } from './chat/cors.js';
import { publicUrlConfigured } from './env.js';
import { registerTeacherRoutes } from './routes/teachers.js';
import { hashDeviceToken } from './lib/devices.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The calling device, on `/v2` routes; `null` everywhere else. */
    device: Device | null;
  }
}

export interface AppDeps {
  services: Services;
  /** Test seam: where the request log goes, instead of stdout. */
  logStream?: { write(line: string): void };
}

/**
 * Paths no log line may carry, whatever a serializer puts there. Fastify's own `req` serializer has
 * neither (a log line holds the method and the url), so this is for the day someone widens it: a
 * chat's token, a snapshot, a code or a key all travel in these two places.
 */
export const LOG_REDACT = ['req.headers.authorization', 'req.body'];

/** The chat connection's paths: a chat's side (`/mcp`, `/oauth`) and the phone's (`/v2/chat`). */
const CHAT_PATH = /^\/(mcp|oauth|v2\/chat)(\/|$)/;

export function buildApp(deps: AppDeps): FastifyInstance {
  const { services } = deps;
  const app = Fastify({
    logger: { level: services.env.LOG_LEVEL, redact: LOG_REDACT, ...(deps.logStream ? { stream: deps.logStream } : {}) },
    trustProxy: true,
  });

  // The app's client sends `content-type: application/json` with every request,
  // including the ones that have nothing to say. Fastify's stock parser answers
  // an empty JSON body with 400. An empty body is no body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (typeof body !== 'string' || body.trim() === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch {
      // Not `JSON.parse`'s own message: it quotes the body, and the error handler logs
      // the error. A body may be a token request or a sealed copy.
      const error = new Error('the body is not valid JSON') as Error & { statusCode?: number };
      error.name = 'invalid_json';
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  // Every caller is a device, with its own token, on `/v2`; the server holds
  // nothing personal (the single-owner routes are gone). Outside `/v2` there
  // are only:
  // - `/health`, the uptime probe;
  // - `/cron/tick`, which checks its own secret because a cron pinger cannot
  //   always set a header;
  // - `/.well-known/*` and `/oauth/*`, a chat's side of the chat connection
  //   (`routes/oauth.ts`): a chat has no device, and those routes need none;
  // - `/mcp`, which takes a chat's own bearer token and checks it itself.
  // Any other path is not a route, and answers 404 whatever it carries.
  app.decorateRequest('device', null);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path !== '/v2' && !path.startsWith('/v2/')) return;
    // Registering is how a device gets its token in the first place. A site's
    // class list comes before it: the phone registers only when it follows a
    // class (plan Phase 3), and the list is the site's public page. So is the
    // Ministry's vacation calendar, which every phone reads, device or not.
    if (request.method === 'POST' && path === '/v2/devices') return;
    if (request.method === 'GET' && (path === '/v2/classes' || path === '/v2/calendar')) return;

    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    const device = provided
      ? await services.prisma.device.findUnique({ where: { tokenHash: hashDeviceToken(provided) } })
      : null;
    if (!device) {
      await reply.code(401).send({ error: 'unauthorized', message: 'missing or invalid device token' });
      return;
    }
    request.device = device;
  });

  app.setErrorHandler((err, request, reply) => {
    // The chat connection's routes handle codes, keys, tokens and sealed copies, and a database error
    // can quote the call that failed (a Prisma validation error prints its arguments). There the log
    // gets the error's name and code, which say what broke, and so does the caller: the message
    // stays out of both.
    const chat = CHAT_PATH.test(request.url.split('?')[0]!);
    if (chat) {
      request.log.error({ err: { name: err.name, code: err.code, statusCode: err.statusCode } }, 'request failed');
    } else {
      request.log.error({ err }, 'request failed');
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    void reply.code(status).send({ error: err.name || 'error', message: chat ? 'request failed' : err.message });
  });

  // A chat's side (`/.well-known`, the OAuth endpoints it calls from code, `/mcp`) answers browsers too.
  registerChatCors(app);

  // A production server without its https address (`PUBLIC_URL`) would name localhost in every
  // address a chat is given. Its side says so instead (the preflight still answers, so a browser
  // client can read the 503); `loadEnv` has warned at startup.
  if (!publicUrlConfigured(services.env)) {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0]!;
      if (request.method === 'OPTIONS' || !(path === '/mcp' || path.startsWith('/oauth/') || path.startsWith('/.well-known/'))) return;
      await reply.code(503).send({ error: 'not_configured' });
    });
  }

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));
  registerCronRoutes(app, deps);
  registerDeviceRoutes(app, deps);
  registerExamBoardRoutes(app, deps);
  registerBuddyRoutes(app, deps);
  registerChatDeviceRoutes(app, deps);
  registerOAuthRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerTeacherRoutes(app, deps);

  return app;
}
