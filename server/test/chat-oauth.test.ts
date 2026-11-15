/**
 * The chat's side of a link (chat connection spec 4.1): OAuth 2.1 with PKCE, as
 * the MCP authorization spec asks of a server. A chat registers itself (RFC 7591),
 * sends the student to the authorize page, where the student types the code from
 * the app, and trades the code it gets back for a pair of tokens that carry K.
 * What these tests pin: the wire shapes the chats read, that a code works once
 * and briefly, that nothing redirects to an address the chat did not register,
 * that one address cannot guess codes for long, and that a refresh token used
 * again cuts the chat, unless it is within a minute of its use (the chat's own
 * requests refreshing at once).
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateChatCodeResponse } from '@sederyom/shared';
import {
  CHAT_ACCESS_TTL_MS, CHAT_AUTH_CODE_TTL_MS, CHAT_CODE_LOCK_MS, CHAT_GRANTS_PER_DEVICE, CHAT_REFRESH_REUSE_GRACE_MS, formatChatCode, parseChatToken,
} from '@sederyom/shared';
import { PAGE_COPY, escapeHtml } from '../src/chat/page.js';
import { bearerGrant } from '../src/chat/tokens.js';
import { type App, CHATGPT, EVIL, KEY, KEY_TEXT, auth, link, register, sha256, world } from './helpers/chatDb.js';

const BASE = 'https://api.example.test';
/** With a trailing slash, which every address the server gives must drop. */
const ENV = { PUBLIC_URL: `${BASE}/` };
const DEMO = 'DEMA2345';
const LOCAL = 'http://localhost:6274/oauth/callback';

const WRONG = 'הקוד לא נכון או שפג תוקפו. אפשר ליצור קוד חדש באפליקציה.';
const LOCKED = 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 10 דקות.';
/** As it is in the markup: the apostrophe of צ'אט is escaped with the rest. */
const WARNING = escapeHtml("זה לא ChatGPT, Claude או Gemini. מתחברים רק אם הוספת את סדר יום לצ'אט הזה בעצמך.");
const TOO_MANY = escapeHtml("כבר מחוברים 5 צ'אטים. אפשר לנתק אחד באפליקציה.");
const UNKNOWN_CLIENT = escapeHtml("הצ'אט הזה כבר לא רשום אצלנו. מסירים את סדר יום מהצ'אט ומוסיפים אותו שוב.");

afterEach(() => vi.useRealTimers());

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

/** PKCE: a verifier, and its S256 challenge. */
function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function registerClient(app: App, body: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'ChatGPT', redirect_uris: [CHATGPT], ...body } });
  return res;
}
async function clientId(app: App, redirectUris = [CHATGPT], name = 'ChatGPT'): Promise<string> {
  const res = await registerClient(app, { client_name: name, redirect_uris: redirectUris });
  expect(res.statusCode).toBe(201);
  return (res.json() as { client_id: string }).client_id;
}

/** What a chat puts on the authorize link. */
function params(client: string, challenge: string, over: Record<string, string> = {}): Record<string, string> {
  return {
    response_type: 'code', client_id: client, redirect_uri: CHATGPT, code_challenge: challenge,
    code_challenge_method: 'S256', state: 'st-123', resource: `${BASE}/mcp`, ...over,
  };
}
const getAuthorize = (app: App, query: Record<string, string>) =>
  app.inject({ method: 'GET', url: `/oauth/authorize?${form(query)}` });
const postAuthorize = (app: App, fields: Record<string, string>, ip = '203.0.113.7') =>
  app.inject({ method: 'POST', url: '/oauth/authorize', headers: { ...FORM, 'x-forwarded-for': ip }, payload: form({ age13: 'yes', ...fields }) });
const token = (app: App, fields: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/oauth/token', headers: FORM, payload: form(fields) });

/** A device, and the code its app shows for a new chat (as XXXX-XXXX). */
async function deviceCode(app: App): Promise<{ device: string; code: string }> {
  const device = await register(app);
  const res = await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(device), payload: { key: KEY_TEXT } });
  expect(res.statusCode).toBe(200);
  return { device, code: (res.json() as CreateChatCodeResponse).code };
}

/** The whole way from registering to the redirect: the authorization code and the verifier. */
async function authorized(app: App, opts: { redirectUris?: string[]; redirectUri?: string; code?: string } = {}) {
  const uris = opts.redirectUris ?? [CHATGPT];
  const client = await clientId(app, uris);
  const { verifier, challenge } = pkce();
  const code = opts.code ?? (await deviceCode(app)).code;
  const p = params(client, challenge, { redirect_uri: opts.redirectUri ?? uris[0]! });
  const res = await postAuthorize(app, { ...p, code });
  expect(res.statusCode, res.body).toBe(302);
  const location = new URL(res.headers.location as string);
  return { client, verifier, location, authCode: location.searchParams.get('code')!, redirectUri: p.redirect_uri! };
}

async function tokens(app: App, a: Awaited<ReturnType<typeof authorized>>) {
  const res = await token(app, {
    grant_type: 'authorization_code', code: a.authCode, code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client, resource: `${BASE}/mcp`,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
}

describe('discovery', () => {
  it('names the resource and its authorization server, from PUBLIC_URL without its trailing slash', async () => {
    const { app } = world(ENV);
    for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.json(), url).toEqual({ resource: `${BASE}/mcp`, authorization_servers: [BASE], bearer_methods_supported: ['header'] });
    }
  });

  it('describes the authorization server (RFC 8414): code with S256 only, public clients, no metadata documents', async () => {
    const { app } = world(ENV);
    const res = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(res.statusCode).toBe(200);
    const meta = res.json() as Record<string, unknown>;
    expect(meta).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      revocation_endpoint: `${BASE}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
    // Registration is by RFC 7591; a URL client_id would find no client here.
    expect(meta).not.toHaveProperty('client_id_metadata_document_supported');
  });

  it("serves OpenAI's domain token alone, as plain text, and nothing when none is set", async () => {
    const url = '/.well-known/openai-apps-challenge';
    const set = await world({ ...ENV, OPENAI_APPS_CHALLENGE: ' token-from-the-portal ' }).app.inject({ method: 'GET', url });
    expect(set.statusCode).toBe(200);
    expect(set.headers['content-type']).toMatch(/^text\/plain/);
    expect(set.body).toBe('token-from-the-portal');
    expect((await world(ENV).app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('needs no device token for any of it', async () => {
    const { app } = world(ENV);
    expect((await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).statusCode).toBe(200);
    expect((await registerClient(app)).statusCode).toBe(201);
  });
});

describe('POST /oauth/register', () => {
  it('answers 201 with a client_id, the name and the addresses, and keeps them', async () => {
    const { app, db } = world(ENV);
    // ChatGPT sends more than this; what the server does not use, it ignores.
    const res = await registerClient(app, { grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ client_name: 'ChatGPT', redirect_uris: [CHATGPT], token_endpoint_auth_method: 'none' });
    expect(typeof body.client_id).toBe('string');
    expect(db.clients).toEqual([{ id: body.client_id, name: 'ChatGPT', redirectUris: [CHATGPT], createdAt: expect.any(Date), linkedAt: null }]);
  });

  it('drops control and format characters from the name, so it cannot reorder the host beside it on the page', async () => {
    const { app, db } = world(ENV);
    const res = await registerClient(app, { client_name: 'Chat‮elpmaxe.live⁦\u0007 GPT' });
    expect(res.statusCode).toBe(201);
    expect(db.clients[0]!.name).toBe('Chatelpmaxe.live GPT');
    // Nothing left of it: named by its host.
    await registerClient(app, { client_name: '‮‏ ' });
    expect(db.clients[1]!.name).toBe('chatgpt.com');
  });

  it('takes https addresses, and http only on localhost or 127.0.0.1 for testing tools', async () => {
    const { app } = world(ENV);
    expect((await registerClient(app, { redirect_uris: [LOCAL, 'http://127.0.0.1:33418/cb', 'https://x.example/cb?a=1'] })).statusCode).toBe(201);
  });

  it('takes the six addresses Gemini registers, on the redirect hosts of Google', async () => {
    const { app, db } = world(ENV);
    const hosts = ['oauth-redirect', 'oauth-redirect-sandbox', 'oauth-redirect-test'];
    const uris = ['r', 'a'].flatMap((path) => hosts.map((host) => `https://${host}.googleusercontent.com/${path}/custom-mcp-sederyom_app`));
    const res = await registerClient(app, { client_name: 'Gemini', redirect_uris: uris });
    expect(res.statusCode).toBe(201);
    expect(db.clients[0]!.redirectUris).toEqual(uris);
  });

  it('refuses a bad name or bad addresses with 400, and keeps nothing', async () => {
    const { app, db } = world(ENV);
    const bad: Record<string, unknown>[] = [
      { client_name: 'x'.repeat(101) },
      { client_name: 42 },
      { redirect_uris: [] },
      { redirect_uris: undefined },
      { redirect_uris: 'https://x.example/cb' },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://x.example/cb${i}`) },
      { redirect_uris: ['http://x.example/cb'] },
      { redirect_uris: ['http://localhost.evil.example/cb'] },
      { redirect_uris: ['not a url'] },
      { redirect_uris: ['javascript:alert(1)'] },
      { redirect_uris: ['https://x.example/cb#frag'] },
      { redirect_uris: [42] },
    ];
    for (const body of bad) {
      const res = await registerClient(app, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect((res.json() as { error: string }).error, JSON.stringify(body)).toMatch(/^invalid_(redirect_uri|client_metadata)$/);
    }
    expect(db.clients).toEqual([]);
  });
});

describe('GET /oauth/authorize', () => {
  it('shows the page, with the chat\'s name, the host it goes back to, and the parameters in the form', async () => {
    const { app } = world(ENV);
    const client = await clientId(app);
    const res = await getAuthorize(app, params(client, pkce().challenge));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html; charset=utf-8/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('‏ChatGPT (chatgpt.com)');
    expect(res.body).toContain('✓ ChatGPT');
    expect(res.body).toContain('name="state" value="st-123"');
    expect(res.body).toContain(`action="${BASE}/oauth/authorize"`);
  });

  it('warns about a host it does not know, and escapes what the chat wrote', async () => {
    const { app } = world(ENV);
    const client = await clientId(app, [EVIL], '<img src=x onerror=alert(1)>');
    const res = await getAuthorize(app, params(client, pkce().challenge, { redirect_uri: EVIL, state: '"><b>' }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(WARNING);
    expect(res.body).toContain('(evil.example)');
    expect(res.body).not.toContain('<img');
    expect(res.body).not.toContain('"><b>');
  });

  it('answers a bad request with a 400 page and never a redirect', async () => {
    const { app } = world(ENV);
    const client = await clientId(app, [CHATGPT, EVIL]);
    const { challenge } = pkce();
    const bad: Record<string, string>[] = [
      params(client, challenge, { redirect_uri: 'https://chatgpt.com/other' }),
      params(client, challenge, { redirect_uri: `${CHATGPT}/` }),
      params('no-such-client', challenge),
      params(client, challenge, { response_type: 'token' }),
      params(client, challenge, { code_challenge_method: 'plain' }),
      params(client, challenge, { code_challenge: 'short' }),
      params(client, challenge, { resource: 'https://elsewhere.example/mcp' }),
    ];
    const missing = params(client, challenge);
    delete missing.code_challenge_method;
    bad.push(missing);
    for (const query of bad) {
      const res = await getAuthorize(app, query);
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
      expect(res.headers.location, JSON.stringify(query)).toBeUndefined();
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.body).not.toContain('<form');
    }
    // A parameter given twice is no parameter.
    const twice = await app.inject({ method: 'GET', url: `/oauth/authorize?${form(params(client, challenge))}&redirect_uri=${encodeURIComponent(EVIL)}` });
    expect(twice.statusCode).toBe(400);
  });

  it('takes the resource with one trailing slash, and not with two', async () => {
    const { app } = world(ENV);
    const client = await clientId(app);
    const { challenge } = pkce();
    expect((await getAuthorize(app, params(client, challenge, { resource: `${BASE}/mcp/` }))).statusCode).toBe(200);
    expect((await getAuthorize(app, params(client, challenge, { resource: `${BASE}/mcp//` }))).statusCode).toBe(400);
    expect((await getAuthorize(app, params(client, challenge, { resource: `${BASE}/mcp/x` }))).statusCode).toBe(400);
  });

  it('takes a request without resource or state', async () => {
    const { app } = world(ENV);
    const client = await clientId(app);
    const query = params(client, pkce().challenge);
    delete query.resource;
    delete query.state;
    expect((await getAuthorize(app, query)).statusCode).toBe(200);
  });
});

describe('the whole link', () => {
  it('register, page, code, redirect with state, tokens with the right verifier, and the K the phone sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const { verifier, challenge } = pkce();
    const p = params(client, challenge);
    expect((await getAuthorize(app, p)).statusCode).toBe(200);
    const { code } = await deviceCode(app);

    // As the student types it: lower case, with a space.
    const res = await postAuthorize(app, { ...p, code: ` ${code.toLowerCase().replace('-', ' ')} ` });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(`${location.origin}${location.pathname}`).toBe(CHATGPT);
    expect(location.searchParams.get('state')).toBe('st-123');
    expect(location.searchParams.get('iss')).toBe(BASE);
    const authCode = location.searchParams.get('code')!;
    expect(authCode.length).toBeGreaterThanOrEqual(43);

    // The code is spent; the grant is the device's, approved for a known host.
    expect(db.codes).toEqual([]);
    expect(db.grants).toEqual([expect.objectContaining({ deviceId: db.devices[0]!.id, clientId: client, demo: false, approvedAt: new Date() })]);
    expect(db.authCodes).toEqual([{
      codeHash: sha256(authCode), grantId: db.grants[0]!.id, key: KEY_TEXT, codeChallenge: challenge, redirectUri: CHATGPT,
      expiresAt: new Date(Date.now() + CHAT_AUTH_CODE_TTL_MS),
    }]);
    expect(db.attempts).toEqual([]);

    const tok = await token(app, {
      grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: CHATGPT, client_id: client, resource: `${BASE}/mcp`,
    });
    expect(tok.statusCode, tok.body).toBe(200);
    expect(tok.headers['cache-control']).toBe('no-store');
    const body = tok.json() as Record<string, unknown>;
    expect(body).toEqual({ access_token: expect.any(String), token_type: 'Bearer', expires_in: CHAT_ACCESS_TTL_MS / 1000, refresh_token: expect.any(String) });
    expect(db.authCodes).toEqual([]);
    // What the answer says is what the row holds: one number, not two.
    const accessRow = db.tokens.find((t) => t.kind === 'access')!;
    expect(accessRow.expiresAt.getTime() - Date.now()).toBe((body.expires_in as number) * 1000);

    const found = await bearerGrant(db.prisma as never, `Bearer ${body.access_token as string}`, new Date());
    expect(found?.grant.id).toBe(db.grants[0]!.id);
    expect(Array.from(found!.key!)).toEqual(Array.from(KEY));
    expect(Array.from(parseChatToken(body.refresh_token as string)!.key)).toEqual(Array.from(KEY));

    // The code works once.
    const again = await token(app, { grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: CHATGPT, client_id: client });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid_grant' });
  });

  it('takes the token request as JSON as well', async () => {
    const { app } = world(ENV);
    const a = await authorized(app);
    const res = await app.inject({
      method: 'POST', url: '/oauth/token',
      payload: { grant_type: 'authorization_code', code: a.authCode, code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('leaves a chat on a host it does not know unapproved, for the app to confirm', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app, { redirectUris: [EVIL] });
    expect(a.location.host).toBe('evil.example');
    expect(db.grants[0]!.approvedAt).toBeNull();
  });

  it('decides approval by the address this request goes back to, not by the others the chat registered', async () => {
    const { app, db } = world(ENV);
    await authorized(app, { redirectUris: [CHATGPT, EVIL], redirectUri: EVIL });
    await authorized(app, { redirectUris: [EVIL, CHATGPT], redirectUri: CHATGPT });
    expect(db.grants.map((g) => g.approvedAt === null)).toEqual([true, false]);
    // A testing tool on localhost is no chat we know.
    await authorized(app, { redirectUris: [LOCAL] });
    expect(db.grants[2]!.approvedAt).toBeNull();
  });
});

describe('POST /oauth/token', () => {
  it('refuses a wrong verifier with invalid_grant, and the code is spent all the same', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const wrong = await token(app, { grant_type: 'authorization_code', code: a.authCode, code_verifier: pkce().verifier, redirect_uri: a.redirectUri, client_id: a.client });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ error: 'invalid_grant' });
    const right = await token(app, { grant_type: 'authorization_code', code: a.authCode, code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client });
    expect(right.json()).toEqual({ error: 'invalid_grant' });
    // And the grant the page made for it is cut: nothing was ever issued on it (ruling L).
    expect(db.grants).toEqual([]);
    expect(db.tokens).toEqual([]);
  });

  it('leaves no grant behind when the exchange fails after the code is spent, so a device still has its places (ruling L)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const device = await register(app);
    const code = async () => {
      const res = await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(device), payload: { key: KEY_TEXT } });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as CreateChatCodeResponse).code;
    };
    // The ways an exchange fails once the code has been looked up and spent.
    const failures: ((a: Awaited<ReturnType<typeof authorized>>) => Promise<Record<string, string>>)[] = [
      async (a) => ({ code_verifier: pkce().verifier, redirect_uri: a.redirectUri, client_id: a.client }),
      async (a) => ({ code_verifier: a.verifier, redirect_uri: `${CHATGPT}/y`, client_id: a.client }),
      async (a) => ({ code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: await clientId(app) }),
      async (a) => ({ code_verifier: 'short', redirect_uri: a.redirectUri, client_id: a.client }),
      async (a) => {
        vi.setSystemTime(new Date(Date.now() + CHAT_AUTH_CODE_TTL_MS + 1));
        return { code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client };
      },
    ];
    expect(failures.length).toBeGreaterThanOrEqual(CHAT_GRANTS_PER_DEVICE);
    for (const make of failures) {
      const a = await authorized(app, { code: await code() });
      expect(db.grants, 'the page made a grant').toHaveLength(1);
      const res = await token(app, { grant_type: 'authorization_code', code: a.authCode, ...(await make(a)) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_grant' });
      expect(db.grants).toEqual([]);
      expect(db.authCodes).toEqual([]);
    }
    // All of the device's places are free: a right exchange now links the chat.
    const a = await authorized(app, { code: await code() });
    await tokens(app, a);
    expect(db.grants).toHaveLength(1);
    expect(db.tokens).toHaveLength(2);
  });

  it('cuts only the grant of the failed exchange, not another chat of the same device', async () => {
    const { app, db } = world(ENV);
    const device = await register(app);
    const code = async () => {
      const res = await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(device), payload: { key: KEY_TEXT } });
      return (res.json() as CreateChatCodeResponse).code;
    };
    const first = await authorized(app, { code: await code() });
    await tokens(app, first);
    db.snapshots.push({ deviceId: db.devices[0]!.id as string, ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() });
    const second = await authorized(app, { code: await code() });
    const res = await token(app, { grant_type: 'authorization_code', code: second.authCode, code_verifier: pkce().verifier, redirect_uri: second.redirectUri, client_id: second.client });
    expect(res.statusCode).toBe(400);
    expect(db.grants.map((g) => g.clientId)).toEqual([first.client]);
    expect(db.tokens).toHaveLength(2);
    // The first chat is still linked, so the device keeps its copy.
    expect(db.snapshots).toHaveLength(1);
  });

  it('does not touch a grant for a request that fails before the code is spent', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app);
    // A resource that is not ours, and a request missing its verifier, are refused before the code is looked at.
    const cases: Record<string, string>[] = [
      { code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client, resource: 'https://elsewhere.example/mcp' },
      { redirect_uri: a.redirectUri, client_id: a.client },
    ];
    for (const fields of cases) {
      const res = await token(app, { grant_type: 'authorization_code', code: a.authCode, ...fields });
      expect(res.statusCode).toBe(400);
      expect(db.grants).toHaveLength(1);
      expect(db.authCodes).toHaveLength(1);
    }
    // The code is still good.
    await tokens(app, a);
    expect(db.tokens).toHaveLength(2);
  });

  it('refuses another redirect_uri, another client, another resource, and no verifier', async () => {
    const { app } = world(ENV);
    const other = await clientId(app);
    const cases: ((a: Awaited<ReturnType<typeof authorized>>) => Record<string, string>)[] = [
      (a) => ({ code_verifier: a.verifier, redirect_uri: `${CHATGPT}/y`, client_id: a.client }),
      (a) => ({ code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: other }),
      (a) => ({ code_verifier: a.verifier, redirect_uri: a.redirectUri }),
      (a) => ({ code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client, resource: 'https://elsewhere.example/mcp' }),
      (a) => ({ redirect_uri: a.redirectUri, client_id: a.client }),
    ];
    for (const make of cases) {
      const a = await authorized(app);
      const res = await token(app, { grant_type: 'authorization_code', code: a.authCode, ...make(a) });
      expect(res.statusCode, JSON.stringify(make(a))).toBe(400);
      expect((res.json() as { error: string }).error).toMatch(/^invalid_(grant|request|target)$/);
    }
  });

  it('takes the resource with one trailing slash on the token request, on the whole way through', async () => {
    const { app } = world(ENV);
    const client = await clientId(app);
    const { verifier, challenge } = pkce();
    const { code } = await deviceCode(app);
    const p = params(client, challenge, { resource: `${BASE}/mcp/` });
    const res = await postAuthorize(app, { ...p, code });
    expect(res.statusCode, res.body).toBe(302);
    const authCode = new URL(res.headers.location as string).searchParams.get('code')!;
    const exchange = { grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: CHATGPT, client_id: client };
    const issued = await token(app, { ...exchange, resource: `${BASE}/mcp/` });
    expect(issued.statusCode, issued.body).toBe(200);
    const { refresh_token } = issued.json() as { refresh_token: string };
    expect((await token(app, { grant_type: 'refresh_token', refresh_token, client_id: client, resource: `${BASE}/mcp/` })).statusCode).toBe(200);
    const twice = await token(app, { grant_type: 'refresh_token', refresh_token, client_id: client, resource: `${BASE}/mcp//` });
    expect(twice.statusCode).toBe(400);
    expect(twice.json()).toEqual({ error: 'invalid_target' });
  });

  it('refuses an authorization code older than 60 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app } = world(ENV);
    const a = await authorized(app);
    vi.setSystemTime(new Date(Date.now() + CHAT_AUTH_CODE_TTL_MS + 1));
    const res = await token(app, { grant_type: 'authorization_code', code: a.authCode, code_verifier: a.verifier, redirect_uri: a.redirectUri, client_id: a.client });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rotates the pair on a refresh, carrying K; the old refresh token used again past the grace window cuts the chat', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const first = await tokens(app, a);

    const res = await token(app, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: a.client });
    expect(res.statusCode, res.body).toBe(200);
    const second = res.json() as { access_token: string; refresh_token: string; expires_in: number; token_type: string };
    expect(second.token_type).toBe('Bearer');
    expect(second.expires_in).toBe(CHAT_ACCESS_TTL_MS / 1000);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.access_token).not.toBe(first.access_token);
    const found = await bearerGrant(db.prisma as never, `Bearer ${second.access_token}`, new Date());
    expect(Array.from(found!.key!)).toEqual(Array.from(KEY));
    expect(db.tokens.find((t) => t.tokenHash === sha256(parseChatToken(first.refresh_token)!.id))!.usedAt).toBeInstanceOf(Date);

    vi.setSystemTime(new Date(Date.now() + CHAT_REFRESH_REUSE_GRACE_MS + 1_000));
    const reused = await token(app, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: a.client });
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toEqual({ error: 'invalid_grant' });
    expect(db.grants).toEqual([]);
    expect(db.tokens).toEqual([]);
    expect(await bearerGrant(db.prisma as never, `Bearer ${second.access_token}`, new Date())).toBeNull();
  });

  it('answers a refresh token used again within the grace window with invalid_grant, and the chat stays linked', async () => {
    // Two requests of one chat that refreshed at once: the second must not cut the student off.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const first = await tokens(app, a);
    const rotated = await token(app, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: a.client });
    expect(rotated.statusCode).toBe(200);
    const second = rotated.json() as { access_token: string; refresh_token: string };

    vi.setSystemTime(new Date(Date.now() + 30_000));
    const again = await token(app, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: a.client });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid_grant' });
    expect(db.grants).toHaveLength(1);
    // The pair the first request got still works: its access token reads, its refresh token rotates.
    expect(await bearerGrant(db.prisma as never, `Bearer ${second.access_token}`, new Date())).not.toBeNull();
    const next = await token(app, { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: a.client });
    expect(next.statusCode, next.body).toBe(200);
  });

  it('answers the loser of two refreshes with one token at the same moment with invalid_grant, and cuts nothing', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const first = await tokens(app, a);
    // This request read the row unused, and the other one claims it between that read and this claim.
    const claim = db.prisma.chatToken.updateMany;
    let won: { access_token: string } | null = null;
    db.prisma.chatToken.updateMany = async (args) => {
      db.prisma.chatToken.updateMany = claim;
      const other = await token(app, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: a.client });
      expect(other.statusCode).toBe(200);
      won = other.json() as { access_token: string };
      return claim(args);
    };
    const lost = await token(app, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: a.client });
    expect(lost.statusCode).toBe(400);
    expect(lost.json()).toEqual({ error: 'invalid_grant' });
    expect(db.grants).toHaveLength(1);
    expect(await bearerGrant(db.prisma as never, `Bearer ${won!.access_token}`, new Date())).not.toBeNull();
  });

  it('refuses an access token as a refresh token, a made-up one and another client\'s, and leaves the grant', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const pair = await tokens(app, a);
    const other = await clientId(app);
    for (const fields of [
      { refresh_token: pair.access_token, client_id: a.client },
      { refresh_token: 'syr_nonsense', client_id: a.client },
      { refresh_token: pair.refresh_token, client_id: other },
    ]) {
      const res = await token(app, { grant_type: 'refresh_token', ...fields });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_grant' });
    }
    expect(db.grants).toHaveLength(1);
    expect((await token(app, { grant_type: 'refresh_token', refresh_token: pair.refresh_token, client_id: a.client })).statusCode).toBe(200);
  });

  it('answers a body that is not JSON with 400, and its error does not quote the body', async () => {
    const { app } = world(ENV);
    const res = await app.inject({
      method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/json' }, payload: '{"refresh_token":"syr_secret',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('syr_secret');
  });

  it('answers an unknown grant type and a missing one in RFC 6749\'s words', async () => {
    const { app } = world(ENV);
    const unknown = await token(app, { grant_type: 'password', username: 'a', password: 'b' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: 'unsupported_grant_type' });
    const none = await token(app, {});
    expect(none.statusCode).toBe(400);
    expect(none.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('POST /oauth/authorize', () => {
  it('asks for the age box first: an empty one is no try, spends no code and links nothing', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const { code } = await deviceCode(app);
    const fields = { ...params(client, pkce().challenge), code };
    const empty = await postAuthorize(app, { ...fields, age13: '' });
    expect(empty.statusCode).toBe(400);
    expect(empty.body).toContain(escapeHtml(PAGE_COPY.ageNeeded));
    expect(empty.body).toContain('<form');
    expect(db.attempts).toEqual([]);
    expect(db.grants).toEqual([]);
    // The same code still works once the box is ticked, and what was ticked is kept nowhere.
    const ticked = await postAuthorize(app, fields);
    expect(ticked.statusCode).toBe(302);
    expect(JSON.stringify(db.grants)).not.toContain('age13');
  });

  it('shows the error for a wrong code, and counts the try against the address', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    for (const code of ['ABCD-EFGH', 'nonsense', '']) {
      const res = await postAuthorize(app, { ...params(client, pkce().challenge), code });
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.body).toContain(WRONG);
      expect(res.body).toContain('<form');
    }
    expect(db.attempts.map((x) => x.ip)).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7']);
    expect(db.grants).toEqual([]);
  });

  it('refuses an expired code', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const { code } = await deviceCode(app);
    vi.setSystemTime(new Date(Date.now() + 10 * 60_000 + 1));
    const res = await postAuthorize(app, { ...params(client, pkce().challenge), code });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(WRONG);
    expect(db.grants).toEqual([]);
  });

  it('locks an address after five wrong codes: the sixth is 429 even with the right code, and not another address', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const { code } = await deviceCode(app);
    const p = params(client, pkce().challenge);
    for (let i = 0; i < 5; i++) expect((await postAuthorize(app, { ...p, code: 'ABCD-EFGH' })).statusCode).toBe(400);

    const locked = await postAuthorize(app, { ...p, code });
    expect(locked.statusCode).toBe(429);
    expect(locked.body).toContain(LOCKED);
    expect(locked.headers.location).toBeUndefined();
    // The code was not spent, and the lock is not made longer by trying.
    expect(db.codes).toHaveLength(1);
    expect(db.attempts).toHaveLength(5);

    expect((await postAuthorize(app, { ...p, code }, '198.51.100.1')).statusCode).toBe(302);
  });

  it('opens the address again ten minutes on', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app } = world(ENV);
    const client = await clientId(app);
    const p = params(client, pkce().challenge);
    for (let i = 0; i < 5; i++) await postAuthorize(app, { ...p, code: 'ABCD-EFGH' });
    expect((await postAuthorize(app, { ...p, code: 'ABCD-EFGH' })).statusCode).toBe(429);
    vi.setSystemTime(new Date(Date.now() + CHAT_CODE_LOCK_MS + 1));
    const { code } = await deviceCode(app);
    expect((await postAuthorize(app, { ...p, code })).statusCode).toBe(302);
  });

  it('checks the form\'s parameters again: a redirect_uri not registered is a 400 page, the code untouched', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const { code } = await deviceCode(app);
    const res = await postAuthorize(app, { ...params(client, pkce().challenge, { redirect_uri: EVIL }), code });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(db.codes).toHaveLength(1);
    expect(db.grants).toEqual([]);
  });

  it('makes no grant past the device\'s limit, even with a code made under it', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const { code } = await deviceCode(app);
    for (let i = 0; i < CHAT_GRANTS_PER_DEVICE; i++) link(db, db.devices[0]!.id);
    const res = await postAuthorize(app, { ...params(client, pkce().challenge), code });
    expect(res.statusCode).toBe(409);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain(TOO_MANY);
    expect(db.grants).toHaveLength(CHAT_GRANTS_PER_DEVICE);
    expect(db.authCodes).toEqual([]);
  });

  it('answers a post with no form at all with the 400 page', async () => {
    const { app } = world(ENV);
    const res = await app.inject({ method: 'POST', url: '/oauth/authorize' });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers.location).toBeUndefined();
  });

  it('marks the client linked when its grant is made, so the sweep keeps it once the chat is disconnected', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    expect(db.clients.find((c) => c.id === client)!.linkedAt).toBeNull();
    const { code } = await deviceCode(app);
    expect((await postAuthorize(app, { ...params(client, pkce().challenge), code })).statusCode).toBe(302);
    expect(db.clients.find((c) => c.id === client)!.linkedAt).toBeInstanceOf(Date);
  });

  it('does not mark a client linked for a wrong code', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    expect((await postAuthorize(app, { ...params(client, pkce().challenge), code: 'ABCD-EFGH' })).statusCode).toBe(400);
    expect(db.clients.find((c) => c.id === client)!.linkedAt).toBeNull();
  });

  it('tells the student to add the chat again when its client_id is no longer registered, on the link and on the form', async () => {
    const { app, db } = world(ENV);
    const { code } = await deviceCode(app);
    const p = params('gone-client', pkce().challenge);
    for (const res of [await getAuthorize(app, p), await postAuthorize(app, { ...p, code })]) {
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.body).toContain(UNKNOWN_CLIENT);
      expect(res.body).not.toContain('<form');
    }
    // Nothing was tried: no code spent, no try counted.
    expect(db.codes).toHaveLength(1);
    expect(db.attempts).toEqual([]);
    // Any other bad request keeps the general page.
    const client = await clientId(app);
    const bad = await getAuthorize(app, params(client, pkce().challenge, { redirect_uri: EVIL }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain(UNKNOWN_CLIENT);
  });

  it('keeps the chat\'s own query on its redirect_uri', async () => {
    const { app } = world(ENV);
    const a = await authorized(app, { redirectUris: ['https://x.example/cb?tenant=7'] });
    expect(a.location.searchParams.get('tenant')).toBe('7');
    expect(a.location.searchParams.get('state')).toBe('st-123');
  });
});

describe('the demo code', () => {
  it('with CHAT_DEMO_CODE set, links a demo grant: no device, approved, and a key of zeros that opens nothing', async () => {
    const { app, db } = world({ ...ENV, CHAT_DEMO_CODE: DEMO });
    const a = await authorized(app, { code: formatChatCode(DEMO).toLowerCase(), redirectUris: [EVIL] });
    expect(db.grants).toEqual([expect.objectContaining({ demo: true, deviceId: null, clientId: a.client, approvedAt: expect.any(Date) })]);
    expect(db.authCodes[0]!.key).toBe(Buffer.alloc(32).toString('base64url'));
    expect(db.clients.find((c) => c.id === a.client)!.linkedAt).toBeInstanceOf(Date);
    const pair = await tokens(app, a);
    expect(Array.from(parseChatToken(pair.access_token)!.key)).toEqual(Array.from(new Uint8Array(32)));
    const found = await bearerGrant(db.prisma as never, `Bearer ${pair.access_token}`, new Date());
    expect(found?.grant.demo).toBe(true);
    expect(found?.key).toBeNull();
    // It can be used again, by anyone: it is the demo.
    await authorized(app, { code: DEMO });
    expect(db.grants).toHaveLength(2);
  });

  it('without it, the same code is just wrong', async () => {
    const { app, db } = world(ENV);
    const client = await clientId(app);
    const res = await postAuthorize(app, { ...params(client, pkce().challenge), code: DEMO });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(WRONG);
    expect(db.grants).toEqual([]);
    expect(db.attempts).toHaveLength(1);
  });
});

describe('POST /oauth/revoke', () => {
  it('deletes the token\'s row, and answers 200 for anything', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const pair = await tokens(app, a);
    const access = await app.inject({ method: 'POST', url: '/oauth/revoke', headers: FORM, payload: form({ token: pair.access_token }) });
    expect(access.statusCode).toBe(200);
    expect(await bearerGrant(db.prisma as never, `Bearer ${pair.access_token}`, new Date())).toBeNull();
    expect(db.tokens.map((t) => t.kind)).toEqual(['refresh']);
    for (const payload of [form({ token: 'nonsense' }), form({}), form({ token: pair.access_token })]) {
      expect((await app.inject({ method: 'POST', url: '/oauth/revoke', headers: FORM, payload })).statusCode).toBe(200);
    }
  });

  it('a refresh token revoked takes the grant\'s access tokens with it (RFC 7009 2.1)', async () => {
    const { app, db } = world(ENV);
    const a = await authorized(app);
    const pair = await tokens(app, a);
    expect((await app.inject({ method: 'POST', url: '/oauth/revoke', headers: FORM, payload: form({ token: pair.refresh_token }) })).statusCode).toBe(200);
    expect(db.tokens).toEqual([]);
    expect(await bearerGrant(db.prisma as never, `Bearer ${pair.access_token}`, new Date())).toBeNull();
  });
});
