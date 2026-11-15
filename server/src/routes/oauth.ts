/**
 * The chat's side of a link (chat connection spec 4.1): OAuth 2.1 for public
 * clients with PKCE, the subset the MCP authorization spec asks of a server.
 *
 * - Discovery: protected resource metadata (RFC 9728) for `/mcp`, and the
 *   authorization server's metadata (RFC 8414).
 * - `POST /oauth/register`: a chat registers itself (RFC 7591). Client ID
 *   Metadata Documents, which the MCP spec now prefers, are not offered: ChatGPT
 *   and the others fall back to registration when the metadata does not say
 *   `client_id_metadata_document_supported`.
 * - `/oauth/authorize`: the page where the student types the code from the app.
 *   The code names the device and carries K (`ChatCode.key`); a right one makes
 *   the grant and an authorization code that holds K for sixty seconds.
 * - `POST /oauth/token`: the authorization code for a pair of tokens that carry
 *   K, and a refresh token for a new pair, once. A refresh token used again within
 *   `CHAT_REFRESH_REUSE_GRACE_MS` is the chat's own requests refreshing at once,
 *   and is only refused; used again later it was copied, and the chat is cut
 *   (OAuth 2.1 4.3.1).
 * - `POST /oauth/revoke` (RFC 7009).
 *
 * Nothing here ever redirects to an address the chat did not register: a request
 * that is wrong before the student has said anything gets a page, not a redirect.
 * The server keeps no code and no token, only their hashes, and K only on its way
 * to the chat: in the link code's row until the code is used or expires (at most
 * ten minutes), then in the authorization code's until it is traded or expires
 * (sixty seconds). An expired code is refused here but its row is deleted only by
 * the next `/cron/tick`. Nothing in this file logs a body, a code, a token or a
 * key.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ChatClient } from '@prisma/client';
import {
  CHAT_ACCESS_TTL_MS, CHAT_AUTH_CODE_TTL_MS, CHAT_CODE_LOCK_MS, CHAT_CODE_TRIES, CHAT_GRANTS_PER_DEVICE, CHAT_REFRESH_REUSE_GRACE_MS, isKnownChatHost,
  normalizeChatCode, parseChatToken,
} from '@sederyom/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDeps } from '../app.js';
import { PAGE_COPY, renderAuthorizePage, renderErrorPage } from '../chat/page.js';
import { decodeChatKey, hashSecret, mintTokenPair, revokeGrant } from '../chat/tokens.js';
import { chatUrls } from '../chat/urls.js';

/** What an OAuth request may carry: a form or JSON of a few short fields. */
const BODY_LIMIT = 16 * 1024;
const NAME_MAX = 100;
/** Gemini registers six addresses, on Google's redirect hosts. */
const REDIRECT_URIS_MAX = 10;
const URI_MAX = 2000;
const STATE_MAX = 2000;
/** An S256 challenge is the base64url of a SHA-256: 43 characters. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 4.1: 43 to 128 unreserved characters. */
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** The key of a demo grant: 32 zero bytes, which open nothing (ruling B). */
const DEMO_KEY = Buffer.alloc(32).toString('base64url');

type Fields = Record<string, unknown>;

/**
 * One parameter, as text. A parameter given twice comes as an array (from the
 * query string and from `parseForm` alike), and OAuth says a parameter is sent
 * once (RFC 6749 3.1), so that is no parameter.
 */
function field(source: unknown, name: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Fields)[name];
  return typeof value === 'string' ? value : undefined;
}

/** A form body as an object; a name given twice keeps all its values, as an array. */
function parseForm(body: string): Fields {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(body)) {
    const seen = out[name];
    out[name] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value];
  }
  return out;
}

/**
 * Whether a chat may register this address: https, or http on `localhost` or
 * `127.0.0.1` (any port) for the testing tools. No fragment (RFC 6749 3.1.2), no
 * user or password in it.
 */
function redirectAllowed(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > URI_MAX || uri.includes('#')) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || !url.hostname) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** An RFC 6749 5.2 error, and nothing else said. */
function oauthError(reply: FastifyReply, error: string, status = 400): { error: string } {
  void reply.code(status);
  return { error };
}

/** A page of the server's: HTML that no other site may frame, kept by nobody. */
function sendPage(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-frame-options', 'DENY')
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'no-referrer')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
    .send(html);
}

/** The S256 of a verifier is its challenge (RFC 7636 4.6), compared in constant time. */
function verifierMatches(verifier: string, challenge: string): boolean {
  const made = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const kept = Buffer.from(challenge);
  return made.length === kept.length && timingSafeEqual(made, kept);
}

/** An authorize request that checked out: the chat, where it goes back to, and the form's fields. */
interface AuthorizeRequest {
  client: ChatClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | undefined;
  /** The host the page names, and whether it is a known chat's (https, one of the known hosts). */
  host: string;
  known: boolean;
  /** The parameters to carry in the page's form, as they came. */
  fields: Record<string, string>;
}

export function registerOAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma, env } = deps.services;
  const urls = chatUrls(env);
  /** RFC 8707's `resource`: the one this server is, as given or with a single trailing slash. */
  const ourResource = (resource: string | undefined) => resource === urls.resource || resource === `${urls.resource}/`;

  /**
   * The parameters of `/oauth/authorize`, the same from the link (GET) and from the
   * page's form (POST): the form's hidden fields are the browser's to change, so
   * the POST checks them all again. `null` for anything wrong; that is a page.
   * `'unknown_client'` when all else is well-formed but the `client_id` is not ours
   * (any more): a page of its own, which tells the student to add the chat again.
   */
  async function authorizeRequest(source: unknown): Promise<AuthorizeRequest | 'unknown_client' | null> {
    const clientId = field(source, 'client_id');
    const redirectUri = field(source, 'redirect_uri');
    const codeChallenge = field(source, 'code_challenge');
    const state = field(source, 'state');
    const resource = field(source, 'resource');
    if (field(source, 'response_type') !== 'code') return null;
    if (field(source, 'code_challenge_method') !== 'S256') return null;
    if (!clientId || clientId.length > 100 || !redirectUri || !codeChallenge || !S256_CHALLENGE.test(codeChallenge)) return null;
    // Given twice is an array, and `field` has said no to it; given once it must be ours.
    const raw = (source && typeof source === 'object' ? source : {}) as Fields;
    if (raw.state !== undefined && (state === undefined || state.length > STATE_MAX)) return null;
    if (raw.resource !== undefined && !ourResource(resource)) return null;
    const client = await prisma.chatClient.findUnique({ where: { id: clientId } });
    if (!client) return 'unknown_client';
    // Exact match against what the chat registered (OAuth 2.1 2.3.1): no prefix, no normalizing.
    if (!client.redirectUris.includes(redirectUri)) return null;
    const url = new URL(redirectUri);
    const fields: Record<string, string> = {
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: 'S256',
    };
    if (state !== undefined) fields.state = state;
    if (resource !== undefined) fields.resource = resource;
    return {
      client, redirectUri, codeChallenge, state, fields,
      host: url.hostname,
      known: url.protocol === 'https:' && isKnownChatHost(url.hostname),
    };
  }

  const page = (reply: FastifyReply, status: number, req: AuthorizeRequest, error?: string) =>
    sendPage(reply, status, renderAuthorizePage({ action: urls.authorize, name: req.client.name, host: req.host, known: req.known, fields: req.fields, error }));
  const badRequest = (reply: FastifyReply, why: 'unknown_client' | null) =>
    sendPage(reply, 400, renderErrorPage(why === 'unknown_client' ? PAGE_COPY.unknownClient : PAGE_COPY.badRequest));

  /**
   * The authorization code, and the 302 back to the chat with it (and `iss`, RFC 9207). The client
   * is marked linked here, where every grant (the demo's too) passes: the sweep keeps it from now on.
   */
  async function grantAndRedirect(reply: FastifyReply, req: AuthorizeRequest, grantId: string, key: string, now: Date) {
    const code = randomBytes(32).toString('base64url');
    await prisma.$transaction([
      prisma.chatAuthCode.create({
        data: {
          codeHash: hashSecret(code), grantId, key, codeChallenge: req.codeChallenge, redirectUri: req.redirectUri,
          expiresAt: new Date(now.getTime() + CHAT_AUTH_CODE_TTL_MS),
        },
      }),
      prisma.chatClient.update({ where: { id: req.client.id }, data: { linkedAt: now } }),
    ]);
    const to = new URL(req.redirectUri);
    to.searchParams.set('code', code);
    if (req.state !== undefined) to.searchParams.set('state', req.state);
    to.searchParams.set('iss', urls.issuer);
    return reply.code(302).header('cache-control', 'no-store').header('location', to.toString()).send();
  }

  app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_request, body, done) => {
      done(null, parseForm(typeof body === 'string' ? body : body.toString('utf8')));
    });

    const resourceMetadata = async () => ({
      resource: urls.resource,
      authorization_servers: [urls.issuer],
      bearer_methods_supported: ['header'],
    });
    scope.get('/.well-known/oauth-protected-resource', resourceMetadata);
    scope.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);

    // OpenAI's check that this domain is ours: the token alone, as plain text, and nothing else.
    scope.get('/.well-known/openai-apps-challenge', async (_request, reply) => {
      if (!env.OPENAI_APPS_CHALLENGE) return reply.code(404).send({ error: 'not_found' });
      return reply.type('text/plain; charset=utf-8').send(env.OPENAI_APPS_CHALLENGE);
    });

    scope.get('/.well-known/oauth-authorization-server', async () => ({
      issuer: urls.issuer,
      authorization_endpoint: urls.authorize,
      token_endpoint: urls.token,
      registration_endpoint: urls.register,
      revocation_endpoint: urls.revoke,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      // Every redirect from the page carries `iss`; no error is ever redirected.
      authorization_response_iss_parameter_supported: true,
    }));

    /**
     * RFC 7591. The chat names itself and the addresses it may be sent back to; it
     * gets a `client_id` and no secret (a public client). What else it sends
     * (grant types, an auth method it would like) is not ours to keep: the answer
     * says what this server does.
     */
    scope.post('/oauth/register', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
      const body = (request.body ?? {}) as Fields;
      const uris = body.redirect_uris;
      if (!Array.isArray(uris) || uris.length < 1 || uris.length > REDIRECT_URIS_MAX || !uris.every(redirectAllowed)) {
        return oauthError(reply, 'invalid_redirect_uri');
      }
      const given = body.client_name;
      if (given !== undefined && typeof given !== 'string') return oauthError(reply, 'invalid_client_metadata');
      // The page puts the host right after the name: a control or format character
      // (a bidi override, say) could make the name reorder the host it stands beside.
      const clean = (given ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
      if (clean.length > NAME_MAX) return oauthError(reply, 'invalid_client_metadata');
      // A chat that gives no name is shown by the host it goes back to.
      const name = clean || new URL(uris[0]!).hostname;
      const client = await prisma.chatClient.create({ data: { name, redirectUris: uris } });
      void reply.code(201).header('cache-control', 'no-store');
      return {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };
    });

    scope.get('/oauth/authorize', async (request, reply) => {
      const req = await authorizeRequest(request.query);
      if (!req || req === 'unknown_client') return badRequest(reply, req);
      return page(reply, 200, req);
    });

    /**
     * The student's code. In this order: the request itself (a wrong one is a page,
     * never a redirect); the address's lock, before the code is looked at, so that
     * a locked address learns nothing, not even with the right code; the age box,
     * which is nobody's secret, so an empty one is no try and spends no code; then
     * the code. A wrong or spent code is one more try against the address. The box
     * is only asked: what was ticked is not kept.
     */
    scope.post('/oauth/authorize', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
      const req = await authorizeRequest(request.body);
      if (!req || req === 'unknown_client') return badRequest(reply, req);
      const now = new Date();
      const ip = request.ip;
      const since = new Date(now.getTime() - CHAT_CODE_LOCK_MS);
      if ((await prisma.chatAttempt.count({ where: { ip, at: { gte: since } } })) >= CHAT_CODE_TRIES) {
        return page(reply, 429, req, PAGE_COPY.locked);
      }
      if (field(request.body, 'age13') !== 'yes') return page(reply, 400, req, PAGE_COPY.ageNeeded);
      const wrong = async () => {
        await prisma.$transaction([
          prisma.chatAttempt.deleteMany({ where: { ip, at: { lt: since } } }),
          prisma.chatAttempt.create({ data: { ip, at: now } }),
        ]);
        return page(reply, 400, req, PAGE_COPY.wrongCode);
      };

      const code = normalizeChatCode(field(request.body, 'code') ?? '');
      if (!code) return wrong();

      // The fixed demo code, when the server has one: built-in data, no device, nothing to approve.
      if (env.CHAT_DEMO_CODE && code === env.CHAT_DEMO_CODE) {
        const grant = await prisma.chatGrant.create({ data: { clientId: req.client.id, deviceId: null, demo: true, approvedAt: now } });
        return grantAndRedirect(reply, req, grant.id, DEMO_KEY, now);
      }

      const codeHash = hashSecret(code);
      const row = await prisma.chatCode.findUnique({ where: { codeHash } });
      if (!row || row.expiresAt.getTime() <= now.getTime() || !row.key) return wrong();
      // Spent here, once: of two requests with one code, only the one that deletes the row goes on.
      if ((await prisma.chatCode.deleteMany({ where: { codeHash } })).count !== 1) return wrong();
      // The code was made under the limit; the device may have reached it since.
      if ((await prisma.chatGrant.count({ where: { deviceId: row.deviceId } })) >= CHAT_GRANTS_PER_DEVICE) {
        return page(reply, 409, req, PAGE_COPY.tooMany);
      }
      const grant = await prisma.chatGrant.create({
        data: { clientId: req.client.id, deviceId: row.deviceId, approvedAt: req.known ? now : null },
      });
      return grantAndRedirect(reply, req, grant.id, row.key, now);
    });

    /** RFC 6749 4.1.3 and 6, with PKCE (RFC 7636). Every answer here is kept by nobody (5.1). */
    scope.post('/oauth/token', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
      void reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      const body = request.body;
      const now = new Date();
      const grantType = field(body, 'grant_type');
      const resource = field(body, 'resource');
      if (!grantType) return oauthError(reply, 'invalid_request');
      if (grantType !== 'authorization_code' && grantType !== 'refresh_token') return oauthError(reply, 'unsupported_grant_type');
      // RFC 8707: the one resource these tokens are for.
      if (!ourResource(resource) && body && typeof body === 'object' && (body as Fields).resource !== undefined) {
        return oauthError(reply, 'invalid_target');
      }

      const issue = async (grantId: string, key: Uint8Array) => {
        const pair = mintTokenPair(grantId, key, now);
        await prisma.chatToken.createMany({ data: pair.rows });
        return { access_token: pair.access, token_type: 'Bearer', expires_in: Math.floor(CHAT_ACCESS_TTL_MS / 1000), refresh_token: pair.refresh };
      };

      if (grantType === 'authorization_code') {
        const code = field(body, 'code');
        const verifier = field(body, 'code_verifier');
        const redirectUri = field(body, 'redirect_uri');
        const clientId = field(body, 'client_id');
        if (!code || !verifier || !redirectUri || !clientId) return oauthError(reply, 'invalid_request');
        const codeHash = hashSecret(code);
        const row = await prisma.chatAuthCode.findUnique({ where: { codeHash }, include: { grant: true } });
        if (!row) return oauthError(reply, 'invalid_grant');
        // Spent by the first request that names it, right or wrong: a code is tried once.
        if ((await prisma.chatAuthCode.deleteMany({ where: { codeHash } })).count !== 1) return oauthError(reply, 'invalid_grant');
        const key = decodeChatKey(row.key);
        if (
          !row.grant || !key ||
          row.expiresAt.getTime() <= now.getTime() ||
          row.grant.clientId !== clientId ||
          row.redirectUri !== redirectUri ||
          !CODE_VERIFIER.test(verifier) || !verifierMatches(verifier, row.codeChallenge)
        ) {
          // The page made this grant when the code was typed, and no token was ever issued on it: with the
          // code spent it can never be exchanged, and it would count toward the device's chats until the
          // sweep found it. Cut here, by the id the code named. A request that lost the claim above has returned already.
          await revokeGrant(prisma, row.grantId);
          return oauthError(reply, 'invalid_grant');
        }
        return issue(row.grant.id, key);
      }

      // refresh_token: once each. The pair it gives carries the K it carries.
      const refresh = field(body, 'refresh_token');
      const clientId = field(body, 'client_id');
      if (!refresh) return oauthError(reply, 'invalid_request');
      const parsed = parseChatToken(refresh);
      if (!parsed || parsed.kind !== 'refresh') return oauthError(reply, 'invalid_grant');
      const tokenHash = hashSecret(parsed.id);
      const row = await prisma.chatToken.findUnique({ where: { tokenHash }, include: { grant: true } });
      if (!row || row.kind !== 'refresh' || !row.grant) return oauthError(reply, 'invalid_grant');
      if (clientId !== undefined && clientId !== row.grant.clientId) return oauthError(reply, 'invalid_grant');
      if (row.usedAt !== null) {
        // Used a moment ago: the chat's own requests refreshed at once, and the first one's pair is
        // good. Refused, and nothing cut. Used longer ago: someone else has it too. The chat is
        // cut, its tokens with it.
        if (now.getTime() - row.usedAt.getTime() > CHAT_REFRESH_REUSE_GRACE_MS) await revokeGrant(prisma, row.grantId);
        return oauthError(reply, 'invalid_grant');
      }
      if (row.expiresAt.getTime() <= now.getTime()) return oauthError(reply, 'invalid_grant');
      const claimed = await prisma.chatToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: now } });
      // Another request used it in the same moment: the chat's own, as above. Refused, nothing cut.
      if (claimed.count !== 1) return oauthError(reply, 'invalid_grant');
      return issue(row.grant.id, parsed.key);
    });

    /**
     * RFC 7009: 200 whatever the token was. A refresh token takes the grant's access
     * tokens with it (2.1). The grant, left with no token, is not cut here: the tick's
     * sweep of tokenless grants removes it (`sync/tick.ts`).
     */
    scope.post('/oauth/revoke', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
      const parsed = parseChatToken(field(request.body, 'token') ?? '');
      if (parsed) {
        const tokenHash = hashSecret(parsed.id);
        const row = await prisma.chatToken.findUnique({ where: { tokenHash } });
        if (row) {
          await prisma.$transaction([
            prisma.chatToken.deleteMany({ where: { tokenHash } }),
            ...(row.kind === 'refresh' ? [prisma.chatToken.deleteMany({ where: { grantId: row.grantId, kind: 'access' } })] : []),
          ]);
        }
      }
      return reply.code(200).header('cache-control', 'no-store').send();
    });
  });
}
