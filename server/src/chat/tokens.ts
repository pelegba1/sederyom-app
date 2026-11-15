/**
 * The secrets of the chat connection (spec 4.1): the one-time code, a chat's
 * tokens, and the rows that hold them. None of them is kept as it is given out.
 * A code is kept as the hash of its 8 characters, a token as the hash of its
 * id (`sya_<id>.<K>`). K, which the token carries, is kept only on its way to
 * the chat: in `chat_code.key` until the code is used or expires (at most ten
 * minutes), then in `chat_auth_code.key` until it is traded or expires (sixty
 * seconds), and nowhere once the tokens are issued: the server can open a
 * snapshot only while a chat's request is in hand. Those are the codes'
 * lifetimes: an expired code is refused, but its row is deleted only by the next
 * `/cron/tick`. Nothing here logs.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { ChatGrant, Prisma, PrismaClient } from '@prisma/client';
import {
  CHAT_ACCESS_TTL_MS, CHAT_CODE_ALPHABET, CHAT_CODE_LENGTH, CHAT_REFRESH_TTL_MS, fromB64u, formatChatToken, parseChatToken,
} from '@sederyom/shared';

/** K is 32 bytes (XSalsa20-Poly1305). */
const KEY_BYTES = 32;

/**
 * A new link code: `CHAT_CODE_LENGTH` characters of `CHAT_CODE_ALPHABET`, as the server keeps
 * them (no hyphen; `formatChatCode` shows it). Drawn with `randomInt`, which is unbiased.
 * 32^8 codes: a draw that meets a live one is for the unique index on the hash to refuse.
 */
export function mintChatCode(): string {
  let code = '';
  for (let i = 0; i < CHAT_CODE_LENGTH; i++) code += CHAT_CODE_ALPHABET[randomInt(CHAT_CODE_ALPHABET.length)]!;
  return code;
}

/** SHA-256 as hex: what is kept of a code and of a token's id (the same as `hashDeviceToken`). */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * K as the phone sends it, base64url: the 32 bytes, or `null` for anything else
 * (the same rule as the key in a token, so a key that passes here makes a token that parses).
 */
export function decodeChatKey(text: unknown): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const bytes = fromB64u(text);
  return bytes && bytes.length === KEY_BYTES ? bytes : null;
}

/** A token's random id: 24 bytes, 32 characters of base64url. */
const tokenId = () => randomBytes(24).toString('base64url');

/**
 * A new pair of tokens for a grant, both carrying `key`, and the two rows that
 * hold them, to be written with `chatToken.createMany`. A row has the hash of
 * the token's id and when it expires, and not the token.
 */
export function mintTokenPair(
  grantId: string,
  key: Uint8Array,
  now: Date,
): { access: string; refresh: string; rows: Prisma.ChatTokenCreateManyInput[] } {
  // A token whose key is another size would never parse; better to stop here than to hand one out.
  if (key.length !== KEY_BYTES) throw new Error(`a chat token carries a key of ${KEY_BYTES} bytes, not ${key.length}`);
  const accessId = tokenId();
  const refreshId = tokenId();
  return {
    access: formatChatToken('access', accessId, key),
    refresh: formatChatToken('refresh', refreshId, key),
    rows: [
      { tokenHash: hashSecret(accessId), grantId, kind: 'access', expiresAt: new Date(now.getTime() + CHAT_ACCESS_TTL_MS) },
      { tokenHash: hashSecret(refreshId), grantId, kind: 'refresh', expiresAt: new Date(now.getTime() + CHAT_REFRESH_TTL_MS) },
    ],
  };
}

/**
 * The grant a request's `Authorization` header names, and the K its token
 * carries: for a live access token only (a refresh token, an expired one or one
 * of a grant that is gone gives `null`). A demo grant reads built-in data, so
 * its key is `null`. This does not look at `approvedAt`; what an unapproved
 * chat is told is the caller's.
 */
export async function bearerGrant(
  prisma: PrismaClient,
  header: string | undefined,
  now: Date,
): Promise<{ grant: ChatGrant; key: Uint8Array | null } | null> {
  const match = /^Bearer +(\S+)$/i.exec(header ?? '');
  const token = match ? parseChatToken(match[1]!) : null;
  if (!token || token.kind !== 'access') return null;
  const row = await prisma.chatToken.findUnique({ where: { tokenHash: hashSecret(token.id) }, include: { grant: true } });
  // The row says what it is, whatever the prefix of the token said.
  if (!row || row.kind !== 'access' || row.expiresAt.getTime() <= now.getTime() || !row.grant) return null;
  return { grant: row.grant, key: row.grant.demo ? null : token.key };
}

/**
 * Cuts one chat: its tokens, its authorization codes and the grant, and the
 * device's copy as well when this was its last chat (a copy with no chat to read
 * it is not kept). One transaction, and the copy goes by a filter that looks at
 * the grants left once this one is deleted, in the same transaction. A grant that
 * is not there is nothing to do. The foreign keys would clear the children too;
 * they are named so that the order is read here.
 */
export async function revokeGrant(prisma: PrismaClient, grantId: string): Promise<void> {
  const grant = await prisma.chatGrant.findUnique({ where: { id: grantId }, select: { deviceId: true } });
  if (!grant) return;
  await prisma.$transaction([
    prisma.chatAuthCode.deleteMany({ where: { grantId } }),
    prisma.chatToken.deleteMany({ where: { grantId } }),
    prisma.chatGrant.deleteMany({ where: { id: grantId } }),
    // A demo grant has no device, and no copy.
    ...(grant.deviceId
      ? [prisma.chatSnapshot.deleteMany({ where: { deviceId: grant.deviceId, device: { chatGrants: { none: {} } } } })]
      : []),
  ]);
}

/**
 * Everything of a device's chat connection, as lazy statements for a `$transaction`:
 * the authorization codes and tokens of its grants, the grants, its link codes and its
 * copy. In this order, for the tokens are found through their grants. For "disconnect
 * everything" (`DELETE /v2/chat`) and for the device's own delete (`DELETE /v2/device`).
 */
export function chatRowsOf(prisma: PrismaClient, deviceId: string) {
  return [
    prisma.chatAuthCode.deleteMany({ where: { grant: { deviceId } } }),
    prisma.chatToken.deleteMany({ where: { grant: { deviceId } } }),
    prisma.chatGrant.deleteMany({ where: { deviceId } }),
    prisma.chatCode.deleteMany({ where: { deviceId } }),
    prisma.chatSnapshot.deleteMany({ where: { deviceId } }),
  ] as const;
}
