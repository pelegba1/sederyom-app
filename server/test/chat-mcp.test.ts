/**
 * `/mcp` (server/src/routes/mcp.ts): the chat's reads, over MCP's Streamable
 * HTTP, stateless. A chat holds an access token that carries K; the server
 * opens the student's copy with it while it answers, and with nothing else.
 * What these tests pin: the 401 a chat discovers the OAuth server from, the
 * nine read tools, the paths that open nothing (unapproved, no copy, another
 * key), the demo that needs no copy, the day card `get_day` points at, and CORS for the browser clients.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sealChat, type ChatShares } from '@sederyom/shared';
import { DateTime } from 'luxon';
import { CANNOT_OPEN, NOT_APPROVED, NO_COPY, dayAnswer } from '../src/chat/answers.js';
import { DAY_CARD_HTML } from '../src/chat/card/dayCard.generated.js';
import { isDayCardData } from '../src/chat/card/markup.js';
import { type App, type Db, KEY, auth, link, register, world } from './helpers/chatDb.js';
import { buildChatSnapshot } from '../../app/src/chat/snapshot';
import { demoData, demoSettings } from '../../app/src/demo/data';
import { demoSourcesFrom } from '../../app/src/demo/sources';

const BASE = 'https://api.example.test';
const ENV = { PUBLIC_URL: `${BASE}/` };
const ZONE = 'Asia/Jerusalem';
const ALL: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };
const TOOLS = ['get_day', 'get_week', 'get_exams', 'get_homework', 'get_grades', 'get_bagrut', 'get_absences', 'get_messages', 'get_status'];
const today = () => DateTime.now().setZone(ZONE).toISODate()!;
/** The day card's address and type, written out: they are the wire value a chat reads, so a test pins them. */
const CARD_URI = 'ui://sederyom/day.html';
const CARD_MIME = 'text/html;profile=mcp-app';

afterEach(() => vi.useRealTimers());

/** One JSON-RPC call, as a chat makes it: the answer is plain JSON (ruling M), never an SSE stream. */
async function rpc(app: App, token: string | null, method: string, params: Record<string, unknown> = {}, accept = 'application/json, text/event-stream') {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      accept,
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
      ...(token ? auth(token) : {}),
    },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
  const message = res.statusCode === 200 ? (JSON.parse(res.body) as { result?: any; error?: any }) : null;
  return { res, message };
}
const call = (app: App, token: string, name: string, args: Record<string, unknown> = {}) => rpc(app, token, 'tools/call', { name, arguments: args });
const textOf = (message: { result?: any } | null): string => message?.result?.content?.[0]?.text;

const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } };

function demoSnapshot(shares: ChatShares = ALL) {
  const now = new Date();
  return buildChatSnapshot(demoSourcesFrom(demoData(now, ZONE), demoSettings(DEFAULT_SETTINGS), now, ZONE), shares, { name: 'x', className: 'יא2' }, now.toISOString());
}

/** A device whose chat is linked and approved, and its copy sealed under `key`. */
async function linked(app: App, db: Db, opts: { key?: Uint8Array; snapshot?: boolean; approvedAt?: Date | null } = {}) {
  const deviceToken = await register(app);
  const deviceId = db.devices.at(-1)!.id as string;
  const chat = link(db, deviceId, { approvedAt: opts.approvedAt === undefined ? new Date() : opts.approvedAt });
  if (opts.snapshot !== false) {
    const now = new Date();
    db.snapshots.push({ deviceId, ciphertext: sealChat(demoSnapshot(), opts.key ?? KEY), writtenAt: now, updatedAt: now });
  }
  return { deviceToken, deviceId, ...chat };
}

describe('/mcp', () => {
  it('answers a chat with no token 401, naming where to find the OAuth server', async () => {
    const { app } = world(ENV);
    const { res } = await rpc(app, null, 'initialize', INIT);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
    const bad = await rpc(app, 'sya_nonsense', 'initialize', INIT);
    expect(bad.res.statusCode).toBe(401);
    // A token that is none says so (RFC 6750 3.1), and still names the metadata.
    expect(bad.res.headers['www-authenticate']).toBe(`Bearer error="invalid_token", resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
    // A header that is not a bearer token is no token.
    const basic = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Basic eDp5', 'content-type': 'application/json' }, payload: {} });
    expect(basic.statusCode).toBe(401);
    expect(basic.headers['www-authenticate']).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
  });

  it('lists the nine read tools, each read-only, after initialize', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const init = await rpc(app, access, 'initialize', INIT);
    expect(init.res.statusCode).toBe(200);
    expect(init.message!.result.instructions).toContain('usually Hebrew');
    const { message } = await rpc(app, access, 'tools/list');
    const tools = message!.result.tools as { name: string; title?: string; annotations: Record<string, unknown> }[];
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    // Each input schema stands alone: some chats do not follow a `$ref`.
    expect(JSON.stringify(tools)).not.toContain('$ref');
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
      expect(tool.title).toMatch(/[֐-׿]/);
    }
  });

  it("reads today from the copy sealed under the grant's key, and notes when the chat last read", async () => {
    const { app, db } = world(ENV);
    const { access, grant } = await linked(app, db);
    expect(grant.lastUsedAt).toBeNull();
    const { res, message } = await call(app, access, 'get_day');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(message!.result.structuredContent.date).toBe(today());
    expect(textOf(message)).toContain('עודכן');
    expect(db.grants.find((g) => g.id === grant.id)!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('answers every tool', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    for (const name of TOOLS) {
      const { message } = await call(app, access, name);
      expect(message!.result.isError ?? false).toBe(false);
      expect(typeof textOf(message)).toBe('string');
    }
    const week = await call(app, access, 'get_week', { offset: 1 });
    expect(week.message!.result.structuredContent.offset).toBe(1);
    const wrong = await call(app, access, 'get_week', { offset: 5 });
    expect(wrong.message!.result?.isError ?? !!wrong.message!.error).toBe(true);
  });

  it('cuts a chat the student disconnected (Review Focus 4)', async () => {
    const { app, db } = world(ENV);
    const { access, grant, deviceToken } = await linked(app, db);
    expect((await call(app, access, 'get_day')).res.statusCode).toBe(200);
    const cut = await app.inject({ method: 'DELETE', url: `/v2/chat/clients/${grant.id}`, headers: auth(deviceToken) });
    expect(cut.statusCode).toBe(200);
    const after = await call(app, access, 'get_day');
    expect(after.res.statusCode).toBe(401);
    expect(after.res.headers['www-authenticate']).toBe(`Bearer error="invalid_token", resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
  });

  it('tells an unapproved chat to be approved in the app, and reads nothing', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db, { approvedAt: null });
    expect(textOf((await call(app, access, 'get_day')).message)).toBe(NOT_APPROVED);
    expect(textOf((await call(app, access, 'get_status')).message)).toBe(NOT_APPROVED);
  });

  it('says there is no copy yet', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db, { snapshot: false });
    expect(textOf((await call(app, access, 'get_day')).message)).toBe(NO_COPY);
  });

  it('says the copy cannot be opened when it was sealed under another key', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db, { key: new Uint8Array(32).fill(9) });
    expect(textOf((await call(app, access, 'get_day')).message)).toBe(CANNOT_OPEN);
  });

  it('reads the demo with no copy at all, every part shared', async () => {
    const { app, db } = world(ENV);
    const { access } = link(db, null, { demo: true, approvedAt: new Date() });
    expect(db.snapshots).toHaveLength(0);
    const { message } = await call(app, access, 'get_grades');
    expect((message!.result.structuredContent.grades as unknown[]).length).toBeGreaterThan(0);
    expect(textOf(message)).not.toContain('לא שיתף');
  });

  it('gives the demo nothing from Google: no calendar event, no task, no word of it among what is shared', async () => {
    const { app, db } = world(ENV);
    const { access } = link(db, null, { demo: true, approvedAt: new Date() });
    // The made-up student does keep Google events and tasks on the phone side; the demo's copy leaves them out.
    const googleTexts = ['אימון כדורסל', 'שיעור גיטרה', 'יום הולדת לסבתא', 'תור לרופאת שיניים', 'מרכז הספורט', 'לקנות מחברת משבצות', 'להחזיר את הספר לספרייה', 'לבדוק את מועדי הבגרות בחורף'];
    const answers = [
      ...(await Promise.all(TOOLS.map((name) => call(app, access, name)))),
      await call(app, access, 'get_week', { offset: 1 }),
    ];
    expect(answers).toHaveLength(TOOLS.length + 1);
    for (const { message } of answers) {
      expect(message!.result.isError ?? false).toBe(false);
      const all = textOf(message) + JSON.stringify(message!.result.structuredContent);
      for (const text of googleTexts) expect(all).not.toContain(text);
      expect(all).not.toContain('ביומן');
      expect(all).not.toMatch(/"calendar"|"tasks"|google/i);
      expect(all).not.toContain('linkedTaskId');
    }
    const status = answers[TOOLS.indexOf('get_status')]!.message!;
    expect(Object.keys(status.result.structuredContent.shares)).toEqual(['homework', 'grades', 'bagrut', 'absences', 'messages']);
    expect(textOf(status)).not.toContain('לא משותף');
  });

  it('still answers when the note of the chat\'s last read cannot be written', async () => {
    const { app, db } = world(ENV);
    const { access, grant } = await linked(app, db);
    db.prisma.chatGrant.updateMany = async () => {
      throw new Error('db hiccup');
    };
    const { res, message } = await call(app, access, 'get_day');
    expect(res.statusCode).toBe(200);
    expect(message!.result.isError ?? false).toBe(false);
    expect(message!.result.structuredContent.date).toBe(today());
    expect(textOf(message)).toContain('עודכן');
    expect(db.grants.find((g) => g.id === grant.id)!.lastUsedAt).toBeNull();
  });

  it('says it went wrong, and writes no note, when the copy cannot be read', async () => {
    const { app, db } = world(ENV);
    const { access, grant } = await linked(app, db);
    db.prisma.chatSnapshot.findUnique = async () => {
      throw new Error('db down');
    };
    const { message } = await call(app, access, 'get_day');
    expect(message!.result.isError).toBe(true);
    expect(textOf(message)).toBe('משהו השתבש בקריאת המידע. אפשר לנסות שוב.');
    expect(db.grants.find((g) => g.id === grant.id)!.lastUsedAt).toBeNull();
  });

  it('does not leave a rejection unhandled when closing the server fails', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    // Not a spy: a spy keeps a handler on the promise it sees, and the rejection would look handled.
    const original = McpServer.prototype.close;
    let closed = 0;
    McpServer.prototype.close = async () => {
      closed += 1;
      throw new Error('close failed');
    };
    try {
      expect((await call(app, access, 'get_day')).res.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.off('unhandledRejection', onUnhandled);
      McpServer.prototype.close = original;
    }
    expect(closed).toBe(1);
    expect(unhandled).toEqual([]);
  });

  it('closes the transport once the request is over, and only once: closing the server closes it', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const transportClose = vi.spyOn(StreamableHTTPServerTransport.prototype, 'close');
    let closed = 0;
    try {
      expect((await call(app, access, 'get_day')).res.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 25));
      closed = transportClose.mock.calls.length;
    } finally {
      transportClose.mockRestore();
    }
    expect(closed).toBe(1);
  });

  it('answers "this week" on a Saturday with the week that starts tomorrow (ruling N), and says so in the tool', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-07T10:00:00.000Z') });
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const { message } = await call(app, access, 'get_week');
    expect(message!.result.structuredContent.weekStart).toBe('2026-11-08');
    expect(message!.result.structuredContent.offset).toBe(0);
    expect((await call(app, access, 'get_week', { offset: 1 })).message!.result.structuredContent.weekStart).toBe('2026-11-15');

    const { message: listed } = await rpc(app, access, 'tools/list');
    const week = (listed!.result.tools as { name: string; description: string; inputSchema: { properties: { offset: { description: string } } } }[]).find((t) => t.name === 'get_week')!;
    expect(week.description).toContain('On Saturday');
    expect(week.inputSchema.properties.offset.description).toContain('Saturday');
  });

  it("keeps the SDK's 406 for a client that does not accept both JSON and an event stream", async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    for (const accept of ['text/html', 'application/json', 'text/event-stream']) {
      expect((await rpc(app, access, 'tools/list', {}, accept)).res.statusCode, accept).toBe(406);
    }
  });

  it('answers GET and DELETE 405', async () => {
    const { app } = world(ENV);
    expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'DELETE', url: '/mcp' })).statusCode).toBe(405);
  });
});

describe('the day card', () => {
  type Listed = { name: string; description: string; _meta?: Record<string, any> };
  const toolsOf = async (app: App, access: string) => (await rpc(app, access, 'tools/list')).message!.result.tools as Listed[];
  const demoAccess = (db: Db) => link(db, null, { demo: true, approvedAt: new Date() }).access;

  it('tools/list: get_day names the card, under the three keys a chat may look for', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const day = (await toolsOf(app, access)).find((t) => t.name === 'get_day')!;
    expect(day._meta!.ui.resourceUri).toBe(CARD_URI);
    expect(day._meta!['ui/resourceUri']).toBe(CARD_URI);
    expect(day._meta!['openai/outputTemplate']).toBe(CARD_URI);
    const card = (await rpc(app, access, 'resources/read', { uri: CARD_URI })).message!.result.contents[0];
    expect(card._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    expect(day.description).toContain('A chat that shows the card should add a short note in its own words, not repeat every lesson.');
  });

  it('tools/list: no other tool has a card', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const others = (await toolsOf(app, access)).filter((t) => t.name !== 'get_day');
    expect(others).toHaveLength(8);
    for (const tool of others) {
      expect(tool._meta?.ui, tool.name).toBeUndefined();
      expect(JSON.stringify(tool._meta ?? {}), tool.name).not.toContain(CARD_URI);
    }
  });

  it('resources/list holds the card', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const { message } = await rpc(app, access, 'resources/list');
    const resources = message!.result.resources as { uri: string; name: string; mimeType: string }[];
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ uri: CARD_URI, mimeType: CARD_MIME });
  });

  it('resources/read gives the page, with no border of its own', async () => {
    const { app, db } = world(ENV);
    const { access } = await linked(app, db);
    const { message } = await rpc(app, access, 'resources/read', { uri: CARD_URI });
    const contents = message!.result.contents as { uri: string; mimeType: string; text: string; _meta: Record<string, any> }[];
    expect(contents).toHaveLength(1);
    expect(contents[0]!.uri).toBe(CARD_URI);
    expect(contents[0]!.mimeType).toBe(CARD_MIME);
    expect(contents[0]!.text).toBe(DAY_CARD_HTML);
    expect(contents[0]!._meta.ui.prefersBorder).toBe(false);
  });

  it('resources/read needs a token', async () => {
    const { app } = world(ENV);
    const { res } = await rpc(app, null, 'resources/read', { uri: CARD_URI });
    expect(res.statusCode).toBe(401);
    expect((await rpc(app, null, 'resources/list')).res.statusCode).toBe(401);
  });

  it('get_day still answers in text, and a real day has the same structured content as ever', async () => {
    // A frozen clock: the server and this test read the same instant, so the demo's copy is the same copy.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T08:00:00.000Z') });
    const { app, db } = world(ENV);
    const expected = dayAnswer(demoSnapshot(), undefined, new Date(), ZONE);
    const demo = link(db, null, { demo: true, approvedAt: new Date() }).access;
    // A device's own copy is sealed from the same demo snapshot, so under the same clock it answers the same.
    const device = (await linked(app, db)).access;
    for (const access of [demo, device]) {
      const { message } = await call(app, access, 'get_day');
      expect(message!.result.isError ?? false).toBe(false);
      expect(message!.result.content).toEqual([{ type: 'text', text: expected.text }]);
      expect(message!.result.structuredContent).toEqual(expected.structured);
      expect(message!.result.structuredContent.found).toBe(true);
      expect('text' in message!.result.structuredContent).toBe(false);
    }
  });

  it("get_day's structured content passes isDayCardData for every day of the copy, so the answer and the card cannot drift apart", async () => {
    // A frozen clock, so the demo's days are the same days on every run, whatever the weekday.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T08:00:00.000Z') });
    const { app, db } = world(ENV);
    const access = demoAccess(db);
    const dates = demoSnapshot().days.map((d) => d.date);
    // Weekends and a week of lessons are among them; an empty loop would prove nothing.
    expect(dates.length).toBeGreaterThanOrEqual(7);
    for (const date of dates) {
      const { message } = await call(app, access, 'get_day', { date });
      const structured = message!.result.structuredContent;
      expect(structured.found, date).toBe(true);
      expect(isDayCardData(structured), date).toBe(true);
      expect('text' in structured, date).toBe(false);
    }
  });

  it('a day outside the copy carries its text in the structured content too, the same text as content', async () => {
    const { app, db } = world(ENV);
    const access = demoAccess(db);
    const { message } = await call(app, access, 'get_day', { date: '2000-01-03' });
    const result = message!.result;
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent.found).toBe(false);
    expect(result.structuredContent.date).toBe('2000-01-03');
    expect(isDayCardData(result.structuredContent)).toBe(false);
    expect(typeof result.structuredContent.text).toBe('string');
    expect(result.structuredContent.text).not.toBe('');
    expect(result.structuredContent.text).toBe(result.content[0].text);
    expect(result.content).toHaveLength(1);
  });

  it('an unapproved chat, no copy and a copy that cannot be opened carry their text in the structured content too', async () => {
    const { app, db } = world(ENV);
    const cases: [string, { approvedAt?: null; snapshot?: boolean; key?: Uint8Array }, string][] = [
      ['not_approved', { approvedAt: null }, NOT_APPROVED],
      ['no_copy', { snapshot: false }, NO_COPY],
      ['cannot_open', { key: new Uint8Array(32).fill(9) }, CANNOT_OPEN],
    ];
    for (const [status, opts, line] of cases) {
      const { access } = await linked(app, db, opts);
      const { message } = await call(app, access, 'get_day');
      expect(message!.result.content).toEqual([{ type: 'text', text: line }]);
      expect(message!.result.structuredContent, status).toEqual({ status, text: line });
    }
  });

  it('only get_day carries the text: another tool, and a failed read, keep their structured content as it was', async () => {
    const { app, db } = world(ENV);
    const unapproved = (await linked(app, db, { approvedAt: null })).access;
    for (const name of TOOLS.filter((n) => n !== 'get_day')) {
      expect((await call(app, unapproved, name)).message!.result.structuredContent, name).toEqual({ status: 'not_approved' });
    }
    const demo = demoAccess(db);
    expect('text' in (await call(app, demo, 'get_week')).message!.result.structuredContent).toBe(false);
    expect('text' in (await call(app, demo, 'get_day', { date: '2000-01-03' })).message!.result.structuredContent).toBe(true);

    const { access } = await linked(app, db);
    db.prisma.chatSnapshot.findUnique = async () => {
      throw new Error('db down');
    };
    const { message } = await call(app, access, 'get_day');
    expect(message!.result.isError).toBe(true);
    expect(message!.result.structuredContent).toBeUndefined();
    expect(message!.result.content).toEqual([{ type: 'text', text: 'משהו השתבש בקריאת המידע. אפשר לנסות שוב.' }]);
  });
});

describe('CORS (ruling K)', () => {
  const preflight = (app: App, url: string) =>
    app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
    });

  it('lets a browser client call /mcp and the OAuth endpoints', async () => {
    const { app } = world(ENV);
    for (const url of ['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      const res = await preflight(app, url);
      expect(res.statusCode, url).toBe(204);
      expect(res.headers['access-control-allow-origin'], url).toBe('*');
      expect(String(res.headers['access-control-allow-methods']), url).toContain('POST');
      expect(String(res.headers['access-control-allow-headers']), url).toContain('authorization');
      expect(String(res.headers['access-control-allow-headers']), url).toContain('mcp-protocol-version');
    }
    const meta = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource', headers: { origin: 'http://localhost:6274' } });
    expect(meta.headers['access-control-allow-origin']).toBe('*');
  });

  it('shows a browser the 401 of /mcp, and the answers', async () => {
    const { app, db } = world(ENV);
    const denied = await rpc(app, null, 'initialize', INIT);
    expect(denied.res.headers['access-control-allow-origin']).toBe('*');
    expect(String(denied.res.headers['access-control-expose-headers'])).toContain('www-authenticate');
    const { access } = await linked(app, db);
    const ok = await call(app, access, 'get_day');
    expect(ok.res.headers['access-control-allow-origin']).toBe('*');
    expect(String(ok.res.headers['access-control-expose-headers'])).toContain('mcp-session-id');
  });

  it('is not on the phone routes or the authorize page', async () => {
    const { app } = world(ENV);
    const device = await app.inject({ method: 'GET', url: '/v2/device', headers: { origin: 'http://localhost:6274' } });
    expect(device.headers['access-control-allow-origin']).toBeUndefined();
    const page = await app.inject({ method: 'GET', url: '/oauth/authorize', headers: { origin: 'http://localhost:6274' } });
    expect(page.headers['access-control-allow-origin']).toBeUndefined();
  });
});
