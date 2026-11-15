/**
 * CORS for a chat's side of the chat connection (ruling K): the discovery
 * documents, the OAuth endpoints a client calls from code, and `/mcp`. Browser
 * clients (the MCP Inspector, web chats) call them across origins. They take a
 * bearer token or nothing, never a cookie, so any origin may call them.
 *
 * Not on `/oauth/authorize`, a page the student's own browser opens, and not on
 * `/v2`, which only the phone calls.
 */
import type { FastifyInstance } from 'fastify';

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
  'access-control-max-age': '86400',
} as const;

const PATHS = new Set(['/mcp', '/oauth/register', '/oauth/token', '/oauth/revoke']);
const corsPath = (path: string): boolean => PATHS.has(path) || path.startsWith('/.well-known/');

export function registerChatCors(app: FastifyInstance): void {
  // On every answer of those paths, the 401s and 405s too. `/mcp` hands its answer
  // to the MCP transport, which writes the head itself: it copies these first.
  app.addHook('onRequest', async (request, reply) => {
    if (corsPath(request.url.split('?')[0]!)) void reply.headers(CORS_HEADERS);
  });
  // The preflight: only the headers above, and no body.
  for (const path of [...PATHS, '/.well-known/*']) {
    app.options(path, async (_request, reply) => reply.code(204).send());
  }
}
