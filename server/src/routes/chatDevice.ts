/**
 * `/v2/chat` (chat connection spec 4.1, 4.2 and 4.5): the phone's side of a
 * chat's link, with the device's own token. It makes the one-time code a student
 * types into the chat's page, keeps the sealed copy of their school day, lists
 * the chats, approves one the app does not know, and cuts one or all of them.
 *
 * The server keeps a code only as a hash, and the copy only as ciphertext: K,
 * which opens it, waits in `chat_code.key` until the code is used or expires (at
 * most ten minutes) and in `chat_auth_code.key` until it is traded or expires
 * (sixty seconds), and once the tokens are issued it is in the chats' tokens and
 * nowhere here (`chat/tokens.ts`). Those are the codes' lifetimes: an expired
 * code is refused, but its row is deleted only by the next `/cron/tick`. A
 * grant belongs to the device named in its row, and every route that takes a
 * grant's id looks for it among that device's own, so another device's id and an
 * id that is none answer alike, 404. Nothing in this file logs a body, a code or
 * a key.
 */
import type { ChatLinkView, ChatStatusResponse, CreateChatCodeResponse, PutChatSnapshotBody } from '@sederyom/shared';
import { CHAT_CODE_TTL_MS, CHAT_GRANTS_PER_DEVICE, CHAT_SNAPSHOT_CIPHERTEXT_MAX, formatChatCode, isKnownChatHost } from '@sederyom/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { chatRowsOf, decodeChatKey, hashSecret, mintChatCode, revokeGrant } from '../chat/tokens.js';

/**
 * What a `PUT` of the copy may carry: 800 KB, a little over the largest ciphertext
 * (`CHAT_SNAPSHOT_CIPHERTEXT_MAX`, 700 KB) and the JSON around it. A body that is
 * over this never gets read; one that is over the cap but under this is answered by
 * the route (413 `too_large`), as the phone expects.
 */
const SNAPSHOT_BODY_LIMIT = 800 * 1024;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const keyBody = z.object({ key: z.string() });
const snapshotBody = z.object({ ciphertext: z.string() });

type Failure = { error: string; message: string };

function fail(reply: FastifyReply, status: number, error: string, message: string): Failure {
  void reply.code(status);
  return { error, message };
}

const notFound = (reply: FastifyReply) => fail(reply, 404, 'not_found', 'no such chat on this device');

/** The first problem a body has, by where it is (never by what it holds). */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`;
}

/** An address's host as `new URL` gives it, or `''` for text that is no address. */
function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return '';
  }
}

export function registerChatDeviceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma } = deps.services;

  /**
   * A new code for a chat to be linked, with K, which the phone made. The device's
   * earlier codes that nobody used go; the one now made is the only one that works.
   * A device links `CHAT_GRANTS_PER_DEVICE` chats at most: at that number it gets no code.
   */
  app.post('/v2/chat/codes', async (request, reply): Promise<CreateChatCodeResponse | Failure> => {
    const parsed = keyBody.safeParse(request.body ?? {});
    if (!parsed.success || !decodeChatKey(parsed.data.key)) {
      return fail(reply, 400, 'invalid_key', 'key: expected 32 bytes as base64url');
    }
    const deviceId = request.device!.id;
    const linked = await prisma.chatGrant.count({ where: { deviceId } });
    if (linked >= CHAT_GRANTS_PER_DEVICE) {
      return fail(reply, 409, 'too_many', `אפשר לחבר עד ${CHAT_GRANTS_PER_DEVICE} צ'אטים. כדאי לנתק אחד מהם קודם.`);
    }
    const code = mintChatCode();
    const expiresAt = new Date(Date.now() + CHAT_CODE_TTL_MS);
    await prisma.$transaction([
      prisma.chatCode.deleteMany({ where: { deviceId } }),
      prisma.chatCode.create({ data: { codeHash: hashSecret(code), deviceId, key: parsed.data.key, expiresAt } }),
    ]);
    return { code: formatChatCode(code), expiresAt: expiresAt.toISOString() };
  });

  /**
   * The sealed copy, written whole. Only while a chat is linked: a copy with no chat
   * to read it would sit there for nothing. `writtenAt` is set by both branches of the
   * upsert, for the column's default applies only when the row is made, and "updated at"
   * in a chat's answers goes by it.
   */
  app.put('/v2/chat/snapshot', { bodyLimit: SNAPSHOT_BODY_LIMIT }, async (request, reply): Promise<{ ok: true } | Failure> => {
    const parsed = snapshotBody.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, 400, 'invalid_snapshot', firstIssue(parsed.error));
    const body: PutChatSnapshotBody = parsed.data;
    // The length first: the size is the cheaper thing to say no to.
    if (body.ciphertext.length > CHAT_SNAPSHOT_CIPHERTEXT_MAX) {
      return fail(reply, 413, 'too_large', `ciphertext: at most ${CHAT_SNAPSHOT_CIPHERTEXT_MAX} characters`);
    }
    if (!BASE64URL.test(body.ciphertext)) return fail(reply, 400, 'invalid_snapshot', 'ciphertext: expected base64url');
    const deviceId = request.device!.id;
    if ((await prisma.chatGrant.count({ where: { deviceId } })) === 0) {
      return fail(reply, 409, 'no_chat', 'no chat is linked to this device');
    }
    const now = new Date();
    await prisma.chatSnapshot.upsert({
      where: { deviceId },
      create: { deviceId, ciphertext: body.ciphertext, writtenAt: now },
      update: { ciphertext: body.ciphertext, writtenAt: now },
    });
    return { ok: true };
  });

  /**
   * The chats linked to this device, oldest first, and when the copy was written.
   * `host` is the first address the chat registered; the chat is `known` only when
   * every address it registered is a known chat's, for one that is not could be where
   * the chat sends the student on. A chat is `approved` once the student said so in the
   * app, and a known one needs no saying.
   */
  app.get('/v2/chat/status', async (request): Promise<ChatStatusResponse> => {
    const deviceId = request.device!.id;
    const [grants, snapshot] = await Promise.all([
      prisma.chatGrant.findMany({ where: { deviceId }, include: { client: true }, orderBy: { createdAt: 'asc' } }),
      prisma.chatSnapshot.findUnique({ where: { deviceId }, select: { writtenAt: true } }),
    ]);
    const chats = grants.map((grant): ChatLinkView => {
      const hosts = grant.client.redirectUris.map(hostOf);
      const known = hosts.length > 0 && hosts.every(isKnownChatHost);
      return {
        id: grant.id,
        name: grant.client.name,
        host: hosts[0] ?? '',
        known,
        approved: grant.approvedAt !== null || known,
        createdAt: grant.createdAt.toISOString(),
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
      };
    });
    return { chats, snapshotAt: snapshot?.writtenAt.toISOString() ?? null };
  });

  /** The student confirms a chat in the app. The first approval's date stays. */
  app.post('/v2/chat/clients/:id/approve', async (request, reply): Promise<{ ok: true } | Failure> => {
    const { id } = request.params as { id: string };
    const deviceId = request.device!.id;
    const grant = await prisma.chatGrant.findFirst({ where: { id, deviceId } });
    if (!grant) return notFound(reply);
    if (grant.approvedAt === null) {
      await prisma.chatGrant.updateMany({ where: { id, deviceId, approvedAt: null }, data: { approvedAt: new Date() } });
    }
    return { ok: true };
  });

  /** One chat cut: its tokens go, and the copy with the last of them. */
  app.delete('/v2/chat/clients/:id', async (request, reply): Promise<{ ok: true } | Failure> => {
    const { id } = request.params as { id: string };
    const grant = await prisma.chatGrant.findFirst({ where: { id, deviceId: request.device!.id } });
    if (!grant) return notFound(reply);
    await revokeGrant(prisma, grant.id);
    return { ok: true };
  });

  /** Every chat cut, with the device's codes and its copy. The next link gets a new K from the phone. */
  app.delete('/v2/chat', async (request): Promise<{ ok: true }> => {
    await prisma.$transaction([...chatRowsOf(prisma, request.device!.id)]);
    return { ok: true };
  });
}
