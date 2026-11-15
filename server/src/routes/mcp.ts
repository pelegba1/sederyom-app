/**
 * `/mcp`, where a chat reads (chat connection spec 4.3): MCP over Streamable
 * HTTP, stateless, as the SDK's own example does it, answering with plain JSON
 * (`enableJsonResponse`; the SDK still answers 406 to a client whose `Accept`
 * does not name both `application/json` and `text/event-stream`). Each POST gets a new
 * `McpServer` and transport, and both are closed when the answer is out, so no
 * request shares anything with another.
 *
 * The chat's access token names the grant and carries K (`bearerGrant`). While
 * the request is in hand the server opens the student's copy with K and answers
 * from it (`chat/answers.ts`); K is not kept, and the copy is opened at most once
 * a request. A demo grant reads the made-up student, built here, with no copy.
 *
 * `get_day` names the day card (`chat/card/`), a page served as a resource of the same server; a chat
 * that cannot show it still has the text. Nothing else has a card.
 *
 * Nothing here logs a body, a tool's input or output, the copy, a key or the
 * `Authorization` header: a failure is logged by its name alone.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ChatGrant } from '@prisma/client';
import { DEFAULT_SETTINGS, openChat, type ChatShares, type ChatSnapshot } from '@sederyom/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { buildChatSnapshot, readChatSnapshot } from '../../../app/src/chat/snapshot';
import { DEMO_CLASS, demoData, demoSettings } from '../../../app/src/demo/data';
import { demoSourcesFrom } from '../../../app/src/demo/sources';
import type { AppDeps } from '../app.js';
import {
  type Answer, CANNOT_OPEN, NOT_APPROVED, NO_COPY, absencesAnswer, bagrutAnswer, dayAnswer, examsAnswer, gradesAnswer, homeworkAnswer, messagesAnswer,
  statusAnswer, weekAnswer,
} from '../chat/answers.js';
import { DAY_CARD_HTML } from '../chat/card/dayCard.generated.js';
import { isDayCardData } from '../chat/card/markup.js';
import { bearerGrant } from '../chat/tokens.js';
import { chatUrls } from '../chat/urls.js';

/** A JSON-RPC request or a batch of them: a few hundred bytes, never near this. */
const BODY_LIMIT = 64 * 1024;

const INSTRUCTIONS =
  'Answer in the language the student writes in, usually Hebrew. Use only lessons, exams and other items that the tools returned; never invent one. When a tool says the data is old, tell the student.';

/** The day card, a page a chat shows in a frame (`chat/card/`): `get_day` names it, and a chat reads it as a resource. */
const DAY_CARD_URI = 'ui://sederyom/day.html';
const DAY_CARD_MIME = 'text/html;profile=mcp-app';

/** Every tool only reads, and only what the student's copy holds. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** The demo shares everything: a reviewer sees each tool answer. */
const DEMO_SHARES: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };
const DEMO_SCHOOL = { name: 'בית ספר להדגמה', className: DEMO_CLASS.name };

/** Something went wrong on our side; no detail, which could say what the copy holds. */
const FAILED = 'משהו השתבש בקריאת המידע. אפשר לנסות שוב.';

// A new schema each time: one used twice is written as a `$ref` to the first, which some chats do not follow.
const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const words = (max: number) => z.string().max(max);

type Copy = { snapshot: ChatSnapshot } | { fixed: Answer };
const fixed = (text: string, status: string): Copy => ({ fixed: { text, structured: { status } } });

/** The made-up student's snapshot, as of `now`. */
function demoSnapshot(now: Date, zone: string): ChatSnapshot {
  return buildChatSnapshot(
    demoSourcesFrom(demoData(now, zone), demoSettings(DEFAULT_SETTINGS), now, zone),
    DEMO_SHARES,
    DEMO_SCHOOL,
    now.toISOString(),
  );
}

const jsonRpcError = (code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });

export function registerMcpRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma, env } = deps.services;
  const zone = env.TIMEZONE;
  // RFC 9728 5.1: where a chat with no token, or a dead one, finds the OAuth server.
  const challenge = `Bearer resource_metadata="${chatUrls(env).resourceMetadata}"`;
  // RFC 6750 3.1: a bearer token that was sent but is no good (unknown, expired, cut) says so.
  const deadChallenge = `Bearer error="invalid_token", resource_metadata="${chatUrls(env).resourceMetadata}"`;

  /** What the grant may read: the student's copy opened with K, the demo's, or a fixed line saying why not. */
  async function copyOf(grant: ChatGrant, key: Uint8Array | null, now: Date): Promise<Copy> {
    if (grant.approvedAt === null) return fixed(NOT_APPROVED, 'not_approved');
    if (grant.demo) return { snapshot: demoSnapshot(now, zone) };
    if (!grant.deviceId) return fixed(NO_COPY, 'no_copy');
    const row = await prisma.chatSnapshot.findUnique({ where: { deviceId: grant.deviceId } });
    if (!row) return fixed(NO_COPY, 'no_copy');
    const snapshot = key ? readChatSnapshot(openChat<unknown>(row.ciphertext, key)) : null;
    return snapshot ? { snapshot } : fixed(CANNOT_OPEN, 'cannot_open');
  }

  /** A server for one request, its tools reading `copy` (opened on the first call). */
  function serverFor(
    grant: ChatGrant,
    key: Uint8Array | null,
    now: Date,
    log: { error: (o: object, m: string) => void; warn: (o: object, m: string) => void },
  ): McpServer {
    const server = new McpServer({ name: 'sederyom', version: '1.0.0' }, { instructions: INSTRUCTIONS });
    let copy: Promise<Copy> | null = null;

    const run = async (answer: (s: ChatSnapshot) => Answer) => {
      let result: Answer;
      try {
        copy ??= copyOf(grant, key, now);
        const read = await copy;
        result = 'snapshot' in read ? answer(read.snapshot) : read.fixed;
      } catch (err) {
        log.error({ err: err instanceof Error ? err.name : 'error' }, 'mcp tool failed');
        return { content: [{ type: 'text' as const, text: FAILED }], isError: true };
      }
      // Best effort, and only once the answer is made: the note of when the chat last read is for the
      // app's list, and a database hiccup there must not turn a right answer into an error.
      try {
        await prisma.chatGrant.updateMany({ where: { id: grant.id }, data: { lastUsedAt: now } });
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.name : 'error' }, 'mcp last use not noted');
      }
      return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.structured };
    };

    // The card's page, for a chat to fetch when `get_day` names it. It reaches nothing outside itself, and says so.
    server.registerResource('day-card', DAY_CARD_URI, { title: 'כרטיס היום', mimeType: DAY_CARD_MIME }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: DAY_CARD_MIME, text: DAY_CARD_HTML, _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } } } }],
    }));

    server.registerTool('get_day', {
      title: 'המערכת של יום',
      description: "One school day of the student's timetable: lessons with teacher, room and changes (cancelled, substitute, moved), the day's exams and school events. Defaults to today in Israel. A chat that shows the card should add a short note in its own words, not repeat every lesson.",
      inputSchema: { date: date().optional().describe('The day, YYYY-MM-DD. Omit for today.') },
      annotations: READ_ONLY,
      // Only the day has a card. `ui.resourceUri` is the MCP Apps key; `ui/resourceUri` is its deprecated flat
      // form, kept for chats on older drafts, and `openai/outputTemplate` is ChatGPT's own name for it.
      _meta: { ui: { resourceUri: DAY_CARD_URI }, 'ui/resourceUri': DAY_CARD_URI, 'openai/outputTemplate': DAY_CARD_URI },
    }, async ({ date: day }) => {
      const result = await run((s) => dayAnswer(s, day, now, zone));
      // An answer that is not a day (outside the copy, no copy, not approved, cannot open) is text for the card to
      // show, and a chat that hands the card only `structuredContent` would show nothing: it carries the text too.
      // A day is left as it is, and a failed read has no `structuredContent` and keeps none.
      if (!('structuredContent' in result) || isDayCardData(result.structuredContent)) return result;
      return { ...result, structuredContent: { ...result.structuredContent, text: result.content[0]!.text } };
    });

    server.registerTool('get_week', {
      title: 'המערכת של השבוע',
      description: "The student's school week, Sunday to Friday: every day's lessons, changes and exams. offset 0 is this week, 1 is next week. On Saturday this week is over, so 0 is the week that starts tomorrow and 1 the one after it.",
      inputSchema: {
        offset: z.union([z.literal(0), z.literal(1)]).optional().describe('0 for this week (default), 1 for next week. On Saturday, 0 is the coming week (from Sunday) and 1 the one after it.'),
      },
      annotations: READ_ONLY,
    }, async ({ offset }) => run((s) => weekAnswer(s, offset ?? 0, now, zone)));

    server.registerTool('get_exams', {
      title: 'מבחנים',
      description: "The student's upcoming exams, from today to the end of the semester, optionally within dates or for one subject (Hebrew subject name).",
      inputSchema: {
        from: date().optional().describe('First day, YYYY-MM-DD. Defaults to today.'),
        to: date().optional().describe('Last day, YYYY-MM-DD.'),
        subject: words(100).optional().describe('Part of the subject name, in Hebrew.'),
      },
      annotations: READ_ONLY,
    }, async ({ from, to, subject }) => run((s) => examsAnswer(s, { from, to, subject }, now, zone)));

    server.registerTool('get_homework', {
      title: 'שיעורי בית',
      description: "The student's open homework with due dates, optionally for one subject; includeDone adds what was done in the last week.",
      inputSchema: {
        subject: words(100).optional().describe('Part of the subject name, in Hebrew.'),
        includeDone: z.boolean().optional().describe('Also list homework already done (default false).'),
      },
      annotations: READ_ONLY,
    }, async ({ subject, includeDone }) => run((s) => homeworkAnswer(s, { subject, includeDone }, now, zone)));

    server.registerTool('get_grades', {
      title: 'ציונים',
      description: "The student's grades this school year, newest first, optionally for one subject, with each subject's average (as the student's own weights compute it). Only if the student shares grades.",
      inputSchema: { subject: words(100).optional().describe('Part of the subject name, in Hebrew.') },
      annotations: READ_ONLY,
    }, async ({ subject }) => run((s) => gradesAnswer(s, { subject }, now, zone)));

    server.registerTool('get_bagrut', {
      title: 'בגרויות',
      description: "The student's bagrut (matriculation) exams: sittings, dates and grades. Only if the student shares them.",
      inputSchema: {},
      annotations: READ_ONLY,
    }, async () => run((s) => bagrutAnswer(s, now, zone)));

    server.registerTool('get_absences', {
      title: 'חיסורים',
      description: "The student's absences per subject: how many count and how many are allowed. Only if the student shares them.",
      inputSchema: {},
      annotations: READ_ONLY,
    }, async () => run((s) => absencesAnswer(s, now, zone)));

    server.registerTool('get_messages', {
      title: 'הודעות',
      description: "Messages from the student's teachers and school (the latest 50), optionally only those containing a word. Only if the student shares them.",
      inputSchema: { query: words(200).optional().describe('A word to look for in the title, the text or the sender, in Hebrew.') },
      annotations: READ_ONLY,
    }, async ({ query }) => run((s) => messagesAnswer(s, { query }, now, zone)));

    server.registerTool('get_status', {
      title: 'מצב החיבור',
      description: 'What this connection can read: the school, the days the copy covers, what the student shares, and when the copy was last updated.',
      inputSchema: {},
      annotations: READ_ONLY,
    }, async () => run((s) => statusAnswer(s, now, zone)));

    return server;
  }

  app.post('/mcp', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const now = new Date();
    const bearer = await bearerGrant(prisma, request.headers.authorization, now);
    if (!bearer) {
      const sent = /^Bearer +\S+$/i.test(request.headers.authorization ?? '');
      return reply.code(401).header('www-authenticate', sent ? deadChallenge : challenge).send({ error: 'invalid_token', message: 'a chat token is needed' });
    }
    // An empty body is no body (`app.ts`), and its stream is read already: no request for the transport.
    if (request.body === undefined) {
      return reply.code(400).type('application/json').send(jsonRpcError(-32700, 'Parse error: no body'));
    }

    const server = serverFor(bearer.grant, bearer.key, now, request.log);
    // Plain JSON, not an SSE stream (ruling M): every request is one call on a serverless function, with nothing to stream.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    // The transport writes the head itself: what was set on the reply (CORS) goes on the raw response first.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value as string | number | string[]);
    }
    reply.hijack();
    // Closing the server closes the transport it is connected to, and once is enough. A close that fails
    // has nobody to tell: the answer is out, and the next request has a server and a transport of its own.
    reply.raw.on('close', () => {
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err: err instanceof Error ? err.name : 'error' }, 'mcp request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(jsonRpcError(-32603, 'Internal server error'));
      }
    }
  });

  // Stateless: no stream to open with GET, no session to end with DELETE.
  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply.code(405).header('allow', 'POST').type('application/json').send(jsonRpcError(-32000, 'Method not allowed.'));
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
