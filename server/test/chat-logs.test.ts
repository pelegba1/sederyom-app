/**
 * What the server writes to its log while a chat is linked and reads (chat
 * connection constraints: never an `Authorization` header, an `/mcp` body, a
 * snapshot, a code or a key). The app runs at the most talkative level over a
 * stand-in, every route of the feature is called with secrets in its headers,
 * bodies and queries, and nothing the log holds may contain one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHAT_SNAPSHOT_CIPHERTEXT_MAX } from '@sederyom/shared';
import { CHATGPT, KEY_TEXT, auth, link, register, world } from './helpers/chatDb.js';

const BASE = 'http://localhost:3000';
/** Text no log line has a reason to hold. */
const MARK = 'LEAKMARK';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function loggedWorld() {
  const lines: string[] = [];
  const made = world({ LOG_LEVEL: 'trace', PUBLIC_URL: BASE }, { write: (line) => void lines.push(line) });
  return { ...made, lines };
}

describe('the log', () => {
  it('holds none of the secrets a chat and a phone send to the chat connection', async () => {
    const { app, db, lines } = loggedWorld();
    const deviceToken = await register(app);
    const deviceId = db.devices.at(-1)!.id as string;
    const chat = link(db, deviceId, { approvedAt: new Date() });
    const secrets: string[] = [deviceToken, chat.access, chat.refresh, KEY_TEXT, MARK];

    // The phone: a code (with K), the sealed copy (accepted, then too big), the list.
    const sealed = `${MARK}copy${'A'.repeat(64)}`;
    secrets.push(sealed);
    const codes = await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(deviceToken), payload: { key: KEY_TEXT } });
    expect(codes.statusCode).toBe(200);
    const typed = (codes.json() as { code: string }).code;
    secrets.push(typed, typed.replace('-', ''));
    expect((await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(deviceToken), payload: { key: `${MARK}key` } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/v2/chat/snapshot', headers: auth(deviceToken), payload: { ciphertext: sealed } })).statusCode).toBe(200);
    const tooBig = `${MARK}big${'A'.repeat(CHAT_SNAPSHOT_CIPHERTEXT_MAX)}`;
    expect((await app.inject({ method: 'PUT', url: '/v2/chat/snapshot', headers: auth(deviceToken), payload: { ciphertext: tooBig } })).statusCode).toBe(413);
    expect((await app.inject({ method: 'GET', url: '/v2/chat/status', headers: auth(deviceToken) })).statusCode).toBe(200);

    // The chat: register, the page, a wrong code and a right one, the tokens, a refresh, a revoke.
    const registered = await app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: `${MARK}name`, redirect_uris: [CHATGPT] } });
    expect(registered.statusCode).toBe(201);
    const client = (registered.json() as { client_id: string }).client_id;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = {
      response_type: 'code', client_id: client, redirect_uri: CHATGPT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1',
      resource: `${BASE}/mcp`,
    };
    expect((await app.inject({ method: 'GET', url: `/oauth/authorize?${new URLSearchParams(params)}` })).statusCode).toBe(200);
    const wrong = 'ZZZZ2222';
    secrets.push(wrong);
    expect((await app.inject({ method: 'POST', url: '/oauth/authorize', headers: FORM, payload: new URLSearchParams({ ...params, age13: 'yes', code: wrong }).toString() })).statusCode).toBe(400);
    const right = await app.inject({ method: 'POST', url: '/oauth/authorize', headers: FORM, payload: new URLSearchParams({ ...params, age13: 'yes', code: typed }).toString() });
    expect(right.statusCode).toBe(302);
    const authCode = new URL(right.headers.location as string).searchParams.get('code')!;
    secrets.push(authCode, verifier);
    const exchanged = await app.inject({
      method: 'POST', url: '/oauth/token', headers: FORM,
      payload: new URLSearchParams({ grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: CHATGPT, client_id: client }).toString(),
    });
    expect(exchanged.statusCode).toBe(200);
    const issued = exchanged.json() as { access_token: string; refresh_token: string };
    secrets.push(issued.access_token, issued.refresh_token);
    const refreshed = await app.inject({
      method: 'POST', url: '/oauth/token', headers: FORM,
      payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client }).toString(),
    });
    expect(refreshed.statusCode).toBe(200);
    secrets.push((refreshed.json() as { access_token: string; refresh_token: string }).refresh_token);
    expect((await app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/json' }, payload: `{"refresh_token":"${MARK}json` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/oauth/revoke', headers: FORM, payload: `token=${chat.refresh}` })).statusCode).toBe(200);

    // /mcp: a call with a word in its arguments, one with a token that is none, one with no token, and a broken body.
    const rpc = (token: string | null, body: string, type = 'application/json') =>
      app.inject({
        method: 'POST', url: '/mcp',
        headers: { accept: 'application/json, text/event-stream', 'content-type': type, ...(token ? auth(token) : {}) },
        payload: body,
      });
    const asked = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_messages', arguments: { query: `${MARK}word` } } });
    expect((await rpc(issued.access_token, asked)).statusCode).toBe(200);
    expect((await rpc(`sya_${MARK}token.${KEY_TEXT}`, asked)).statusCode).toBe(401);
    expect((await rpc(null, asked)).statusCode).toBe(401);
    expect((await rpc(issued.access_token, `{"jsonrpc":"2.0","method":"${MARK}`)).statusCode).toBeGreaterThanOrEqual(400);

    const log = lines.join('');
    // The test is not vacuous: the app did log, requests and all.
    expect(lines.length).toBeGreaterThan(20);
    expect(log).toContain('incoming request');
    expect(log).toContain('request completed');
    for (const secret of secrets) expect(log, secret.slice(0, 12)).not.toContain(secret);
    expect(log.toLowerCase()).not.toContain('bearer');
  });

  it('logs a failure on a chat route by its name, not its message, for a database error can quote what was sent', async () => {
    const { app, db, lines } = loggedWorld();
    const deviceToken = await register(app);
    db.prisma.chatCode.create = async () => {
      throw Object.assign(new Error(`Invalid \`prisma.chatCode.create()\` invocation: key: "${MARK}key"`), { name: 'PrismaClientValidationError' });
    };
    const res = await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(deviceToken), payload: { key: KEY_TEXT } });
    expect(res.statusCode).toBe(500);
    const failed = lines.filter((l) => l.includes('request failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain('PrismaClientValidationError');
    expect(failed[0]).not.toContain(MARK);
    expect(failed[0]).not.toContain(KEY_TEXT);
    // Nor does the answer: on a chat route it names the error and no more.
    expect(res.body).not.toContain(MARK);
    expect(res.json()).toEqual({ error: 'PrismaClientValidationError', message: 'request failed' });
    // Elsewhere the log keeps what it always had, the message for whoever looks into it.
    db.prisma.deviceNotification.deleteMany = async () => {
      throw new Error('somewhere else');
    };
    const other = await app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(deviceToken) });
    expect(other.statusCode).toBe(500);
    expect(lines.filter((l) => l.includes('request failed')).at(-1)).toContain('somewhere else');
    expect(other.json()).toEqual({ error: 'Error', message: 'somewhere else' });
  });

  it('answers a failure on the chat\'s side, /oauth and /mcp, without its message, and keeps the status', async () => {
    const { app, db } = loggedWorld();
    db.prisma.chatClient.create = async () => {
      throw Object.assign(new Error(`Invalid \`prisma.chatClient.create()\` invocation: name: "${MARK}name"`), { name: 'PrismaClientValidationError' });
    };
    const res = await app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: `${MARK}name`, redirect_uris: [CHATGPT] } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(MARK);
    expect(res.json()).toEqual({ error: 'PrismaClientValidationError', message: 'request failed' });
    // A 4xx Fastify raises itself keeps its status: a body too large for /oauth/token.
    const big = await app.inject({ method: 'POST', url: '/oauth/token', headers: FORM, payload: `refresh_token=${MARK}${'A'.repeat(20 * 1024)}` });
    expect(big.statusCode).toBe(413);
    expect(big.body).not.toContain(MARK);
    expect((big.json() as { message: string }).message).toBe('request failed');
    // /mcp, failing before it hands the request to the MCP transport: looking up the token.
    db.prisma.chatToken.findUnique = async () => {
      throw Object.assign(new Error(`Invalid \`prisma.chatToken.findUnique()\` invocation: tokenHash: "${MARK}hash"`), { name: 'PrismaClientValidationError' });
    };
    const mcp = await app.inject({
      method: 'POST', url: '/mcp', headers: { ...auth(`sya_${MARK}id.${KEY_TEXT}`), accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.statusCode).toBe(500);
    expect(mcp.body).not.toContain(MARK);
    expect(mcp.json()).toEqual({ error: 'PrismaClientValidationError', message: 'request failed' });
  });

  it('censors the authorization header and the body when a log line is given them, whatever serializer carries them', () => {
    const { app, lines } = loggedWorld();
    // A serializer that keeps everything, as a careless one added later might.
    const verbose = app.log.child({}, { serializers: { req: (req: unknown) => req } });
    verbose.info({ req: { method: 'POST', headers: { authorization: `Bearer sya_${MARK}.k`, accept: 'x' }, body: { ciphertext: `${MARK}copy` } } }, 'carried');
    const line = lines.find((l) => l.includes('carried'))!;
    expect(line).toBeDefined();
    expect(line).not.toContain(MARK);
    expect(line).toContain('[Redacted]');
    expect(line).toContain('"method":"POST"');
  });
});
