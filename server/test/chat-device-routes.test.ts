/**
 * `/v2/chat` (chat connection spec 4.1, 4.2 and 4.5): the phone's side of a
 * chat's link. It asks for a one-time code, keeps the sealed copy up to date,
 * lists the chats, approves one from an unknown host, and cuts a chat or all of
 * them. The server holds a code only as a hash, a chat's token only as the hash
 * of its id, and the copy only as ciphertext it cannot open. What these tests
 * pin is who may touch which row, what is gone after a disconnect, and the
 * limits. `chat/tokens.ts` (mint, bearer, revoke) is tested here too, against
 * the same stand-in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatStatusResponse, CreateChatCodeResponse } from '@sederyom/shared';
import {
  CHAT_ACCESS_TTL_MS, CHAT_CODE_ALPHABET, CHAT_CODE_TTL_MS, CHAT_GRANTS_PER_DEVICE, CHAT_REFRESH_TTL_MS,
  CHAT_SNAPSHOT_CIPHERTEXT_MAX, formatChatCode, normalizeChatCode, parseChatToken,
} from '@sederyom/shared';
import { bearerGrant, hashSecret, mintChatCode, mintTokenPair, revokeGrant } from '../src/chat/tokens.js';
import { type App, CHATGPT, EVIL, KEY, KEY_TEXT, auth, link, register, sha256, world } from './helpers/chatDb.js';

const postCode = (app: App, token: string, payload: unknown = { key: KEY_TEXT }) =>
  app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(token), payload: payload as object });
const putSnapshot = (app: App, token: string, ciphertext: unknown) =>
  app.inject({ method: 'PUT', url: '/v2/chat/snapshot', headers: auth(token), payload: { ciphertext } });
const status = (app: App, token: string) => app.inject({ method: 'GET', url: '/v2/chat/status', headers: auth(token) });
const approve = (app: App, token: string, id: string) =>
  app.inject({ method: 'POST', url: `/v2/chat/clients/${id}/approve`, headers: auth(token) });
const disconnect = (app: App, token: string, id: string) =>
  app.inject({ method: 'DELETE', url: `/v2/chat/clients/${id}`, headers: auth(token) });

afterEach(() => vi.useRealTimers());

describe('the chat routes', () => {
  it('need a device token', async () => {
    const { app } = world();
    const routes = [
      ['POST', '/v2/chat/codes'], ['PUT', '/v2/chat/snapshot'], ['GET', '/v2/chat/status'],
      ['POST', '/v2/chat/clients/x/approve'], ['DELETE', '/v2/chat/clients/x'], ['DELETE', '/v2/chat'],
    ] as const;
    for (const [method, url] of routes) {
      expect((await app.inject({ method, url, payload: { key: KEY_TEXT, ciphertext: 'abc' } })).statusCode, `${method} ${url}`).toBe(401);
      expect((await app.inject({ method, url, headers: auth('made-up-token') })).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('POST /v2/chat/codes', () => {
  it('answers a code of 9 characters with a hyphen at index 4, valid for 10 minutes, and keeps only its hash', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world();
    const token = await register(app);
    const res = await postCode(app, token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as CreateChatCodeResponse;
    expect(body.code).toHaveLength(9);
    expect(body.code[4]).toBe('-');
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(body.expiresAt).toBe(new Date(Date.now() + CHAT_CODE_TTL_MS).toISOString());

    const bare = normalizeChatCode(body.code)!;
    expect(bare).toHaveLength(8);
    expect(db.codes).toEqual([
      { id: expect.any(String), codeHash: sha256(bare), deviceId: db.devices[0]!.id, key: KEY_TEXT, expiresAt: new Date(body.expiresAt) },
    ]);
    // The code itself is nowhere in what is kept, in either spelling.
    const kept = JSON.stringify(db.codes);
    expect(kept).not.toContain(bare);
    expect(kept).not.toContain(body.code);
  });

  it('replaces the code the device made before, and leaves another device\'s alone', async () => {
    const { app, db } = world();
    const first = await register(app);
    const other = await register(app);
    const one = ((await postCode(app, first)).json() as CreateChatCodeResponse).code;
    await postCode(app, other);
    const two = ((await postCode(app, first)).json() as CreateChatCodeResponse).code;

    expect(db.codes.map((c) => c.deviceId).sort()).toEqual(['device1', 'device2']);
    const mine = db.codes.find((c) => c.deviceId === 'device1')!;
    expect(mine.codeHash).toBe(sha256(normalizeChatCode(two)!));
    expect(mine.codeHash).not.toBe(sha256(normalizeChatCode(one)!));
  });

  it('refuses a key that is not 32 bytes of base64url, and makes no code', async () => {
    const { app, db } = world();
    const token = await register(app);
    const bad: unknown[] = [
      {}, { key: 42 }, { key: null }, { key: '' },
      Buffer.alloc(31).toString('base64url'), Buffer.alloc(33).toString('base64url'), Buffer.alloc(64).toString('base64url'),
      `${KEY_TEXT}=`, KEY_TEXT.slice(0, 42), `${KEY_TEXT.slice(0, 42)}!`, `+${KEY_TEXT.slice(1)}`,
      // 43 characters whose spare bits are not zero: not what a base64url encoder writes.
      `${'A'.repeat(42)}B`,
    ].map((key) => (typeof key === 'object' && key !== null ? key : { key }));
    for (const payload of bad) {
      const res = await postCode(app, token, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect((res.json() as { error: string }).error).toBe('invalid_key');
    }
    expect((await app.inject({ method: 'POST', url: '/v2/chat/codes', headers: auth(token) })).statusCode).toBe(400);
    expect(db.codes).toEqual([]);
  });

  it('refuses the sixth chat of a device with 409 too_many, and counts only its own', async () => {
    const { app, db } = world();
    const token = await register(app);
    const other = await register(app);
    for (let i = 0; i < CHAT_GRANTS_PER_DEVICE - 1; i++) link(db, 'device1');
    for (let i = 0; i < CHAT_GRANTS_PER_DEVICE; i++) link(db, 'device2');
    link(db, null, { demo: true });

    // Four chats: one more fits.
    expect((await postCode(app, token)).statusCode).toBe(200);
    link(db, 'device1');
    const res = await postCode(app, token);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('too_many');
    // The refusal leaves the code the device had before.
    expect(db.codes.filter((c) => c.deviceId === 'device1')).toHaveLength(1);
    expect((await postCode(app, other)).statusCode).toBe(409);
  });
});

describe('PUT /v2/chat/snapshot', () => {
  it('refuses a copy while no chat is linked: 409 no_chat, and nothing is kept', async () => {
    const { app, db } = world();
    const token = await register(app);
    link(db, null, { demo: true });
    const res = await putSnapshot(app, token, 'abc');
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('no_chat');
    expect(db.snapshots).toEqual([]);
  });

  it('keeps the ciphertext of a device with a chat, and a second one replaces it and moves writtenAt forward', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world();
    const token = await register(app);
    link(db, 'device1');

    const first = await putSnapshot(app, token, 'first_copy-1');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    expect(db.snapshots).toEqual([
      { deviceId: 'device1', ciphertext: 'first_copy-1', writtenAt: new Date('2026-11-05T10:00:00.000Z'), updatedAt: expect.any(Date) },
    ]);

    vi.setSystemTime(new Date('2026-11-05T12:30:00.000Z'));
    expect((await putSnapshot(app, token, 'second_copy-2')).statusCode).toBe(200);
    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0]!.ciphertext).toBe('second_copy-2');
    // Prisma's `@default(now())` applies on create only: the update must say it.
    expect(db.snapshots[0]!.writtenAt).toEqual(new Date('2026-11-05T12:30:00.000Z'));
  });

  it('writes only the calling device\'s copy', async () => {
    const { app, db } = world();
    const token = await register(app);
    await register(app);
    link(db, 'device1');
    link(db, 'device2');
    db.snapshots.push({ deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(0), updatedAt: new Date(0) });
    expect((await putSnapshot(app, token, 'mine')).statusCode).toBe(200);
    expect(db.snapshots.map((s) => [s.deviceId, s.ciphertext])).toEqual([['device2', 'theirs'], ['device1', 'mine']]);
  });

  it('takes a copy of exactly the largest size and refuses one a kilobyte over with 413 too_large', async () => {
    const { app, db } = world();
    const token = await register(app);
    link(db, 'device1');
    expect((await putSnapshot(app, token, 'A'.repeat(CHAT_SNAPSHOT_CIPHERTEXT_MAX))).statusCode).toBe(200);

    db.snapshots[0]!.ciphertext = 'kept';
    const res = await putSnapshot(app, token, 'A'.repeat(701 * 1024));
    expect(res.statusCode).toBe(413);
    expect((res.json() as { error: string }).error).toBe('too_large');
    expect(db.snapshots[0]!.ciphertext).toBe('kept');
  });

  it('refuses a body past the route\'s own limit before reading it', async () => {
    const { app, db } = world();
    const token = await register(app);
    link(db, 'device1');
    const res = await putSnapshot(app, token, 'A'.repeat(900 * 1024));
    expect(res.statusCode).toBe(413);
    expect(db.snapshots).toEqual([]);
  });

  it('refuses what is not base64url text with 400', async () => {
    const { app, db } = world();
    const token = await register(app);
    link(db, 'device1');
    for (const ciphertext of [undefined, null, 42, '', 'has space', 'padded==', '{"json":1}']) {
      const res = await putSnapshot(app, token, ciphertext);
      expect(res.statusCode, String(ciphertext)).toBe(400);
      expect((res.json() as { error: string }).error).toBe('invalid_snapshot');
    }
    expect(db.snapshots).toEqual([]);
  });
});

describe('GET /v2/chat/status', () => {
  it('lists nothing for a device with no chat and no copy', async () => {
    const { app, db } = world();
    const token = await register(app);
    link(db, null, { demo: true });
    const res = await status(app, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chats: [], snapshotAt: null });
  });

  it('lists a chat of a known host as known and approved, and any other host as neither until approved', async () => {
    const { app, db } = world();
    const token = await register(app);
    const known = link(db, 'device1', { name: 'ChatGPT', redirectUris: [CHATGPT], createdAt: new Date('2026-11-01T08:00:00.000Z'), lastUsedAt: new Date('2026-11-04T09:00:00.000Z') });
    const unknown = link(db, 'device1', { name: 'Mystery', redirectUris: [EVIL], createdAt: new Date('2026-11-02T08:00:00.000Z') });
    db.snapshots.push({ deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date('2026-11-04T20:00:00.000Z'), updatedAt: new Date() });

    const before = (await status(app, token)).json() as ChatStatusResponse;
    expect(before).toEqual({
      chats: [
        { id: known.grant.id, name: 'ChatGPT', host: 'chatgpt.com', known: true, approved: true, createdAt: '2026-11-01T08:00:00.000Z', lastUsedAt: '2026-11-04T09:00:00.000Z' },
        { id: unknown.grant.id, name: 'Mystery', host: 'evil.example', known: false, approved: false, createdAt: '2026-11-02T08:00:00.000Z', lastUsedAt: null },
      ],
      snapshotAt: '2026-11-04T20:00:00.000Z',
    });

    expect((await approve(app, token, unknown.grant.id)).statusCode).toBe(200);
    const after = (await status(app, token)).json() as ChatStatusResponse;
    expect(after.chats.map((c) => [c.host, c.known, c.approved])).toEqual([['chatgpt.com', true, true], ['evil.example', false, true]]);
  });

  it('knows the other hosts of the list, and nothing near them', async () => {
    const { app, db } = world();
    const token = await register(app);
    const uris = [
      'https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback', 'https://chat.openai.com/aip/x',
      'https://gemini.google.com/oauth', 'https://chatgpt.com.evil.example/cb', 'https://evilchatgpt.com/cb', 'https://sub.claude.ai/cb',
      'http://localhost:8080/cb',
    ];
    for (const uri of uris) link(db, 'device1', { redirectUris: [uri] });
    const chats = ((await status(app, token)).json() as ChatStatusResponse).chats;
    expect(chats.map((c) => [c.host, c.known])).toEqual([
      ['claude.ai', true], ['claude.com', true], ['chat.openai.com', true], ['gemini.google.com', true],
      ['chatgpt.com.evil.example', false], ['evilchatgpt.com', false], ['sub.claude.ai', false], ['localhost', false],
    ]);
  });

  it('does not call a chat known when only its first address is: the others could lead anywhere', async () => {
    const { app, db } = world();
    const token = await register(app);
    link(db, 'device1', { redirectUris: [CHATGPT, EVIL] });
    const [chat] = ((await status(app, token)).json() as ChatStatusResponse).chats;
    expect(chat).toMatchObject({ host: 'chatgpt.com', known: false, approved: false });
  });

  it('shows only the calling device\'s chats and copy', async () => {
    const { app, db } = world();
    const token = await register(app);
    await register(app);
    const mine = link(db, 'device1');
    link(db, 'device2');
    db.snapshots.push({ deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(), updatedAt: new Date() });
    const res = (await status(app, token)).json() as ChatStatusResponse;
    expect(res.chats.map((c) => c.id)).toEqual([mine.grant.id]);
    expect(res.snapshotAt).toBeNull();
  });
});

describe('POST /v2/chat/clients/:id/approve', () => {
  it('approves the device\'s own chat, and keeps the first approval\'s date', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00.000Z') });
    const { app, db } = world();
    const token = await register(app);
    const mine = link(db, 'device1', { redirectUris: [EVIL] });
    const res = await approve(app, token, mine.grant.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.grants[0]!.approvedAt).toEqual(new Date('2026-11-05T10:00:00.000Z'));

    vi.setSystemTime(new Date('2026-11-06T10:00:00.000Z'));
    expect((await approve(app, token, mine.grant.id)).statusCode).toBe(200);
    expect(db.grants[0]!.approvedAt).toEqual(new Date('2026-11-05T10:00:00.000Z'));
  });

  it('answers 404 for another device\'s chat, a demo chat, and an id that is none, and approves nothing', async () => {
    const { app, db } = world();
    const token = await register(app);
    await register(app);
    const theirs = link(db, 'device2', { redirectUris: [EVIL] });
    const demo = link(db, null, { demo: true });
    for (const id of [theirs.grant.id, demo.grant.id, 'nonsense']) {
      const res = await approve(app, token, id);
      expect(res.statusCode, id).toBe(404);
      expect((res.json() as { error: string }).error).toBe('not_found');
    }
    expect(db.grants.find((g) => g.id === theirs.grant.id)!.approvedAt).toBeNull();
  });
});

describe('DELETE /v2/chat/clients/:id', () => {
  it('answers 404 for another device\'s chat and leaves everything of it', async () => {
    const { app, db } = world();
    const token = await register(app);
    await register(app);
    const theirs = link(db, 'device2');
    db.snapshots.push({ deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(), updatedAt: new Date() });
    for (const id of [theirs.grant.id, 'nonsense']) {
      const res = await disconnect(app, token, id);
      expect(res.statusCode, id).toBe(404);
      expect((res.json() as { error: string }).error).toBe('not_found');
    }
    expect(db.grants).toHaveLength(1);
    expect(db.tokens).toHaveLength(2);
    expect(db.snapshots).toHaveLength(1);
    expect(await bearerGrant(db.prisma as never, `Bearer ${theirs.access}`, new Date())).not.toBeNull();
  });

  it('cuts one chat and keeps the copy while another is still linked', async () => {
    const { app, db } = world();
    const token = await register(app);
    const one = link(db, 'device1');
    const two = link(db, 'device1');
    db.snapshots.push({ deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() });

    const res = await disconnect(app, token, one.grant.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.grants.map((g) => g.id)).toEqual([two.grant.id]);
    expect(db.tokens.map((t) => t.grantId)).toEqual([two.grant.id, two.grant.id]);
    expect(db.snapshots).toHaveLength(1);
    expect(await bearerGrant(db.prisma as never, `Bearer ${one.access}`, new Date())).toBeNull();
    expect(await bearerGrant(db.prisma as never, `Bearer ${two.access}`, new Date())).not.toBeNull();
  });

  it('deletes the copy with the last chat, and that chat\'s access token then opens nothing', async () => {
    const { app, db } = world();
    const token = await register(app);
    await register(app);
    const only = link(db, 'device1');
    const theirs = link(db, 'device2');
    db.snapshots.push(
      { deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() },
      { deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(), updatedAt: new Date() },
    );
    expect(await bearerGrant(db.prisma as never, `Bearer ${only.access}`, new Date())).not.toBeNull();

    expect((await disconnect(app, token, only.grant.id)).statusCode).toBe(200);
    expect(db.snapshots.map((s) => s.deviceId)).toEqual(['device2']);
    expect(db.grants.map((g) => g.id)).toEqual([theirs.grant.id]);
    expect(db.tokens.every((t) => t.grantId === theirs.grant.id)).toBe(true);
    expect(await bearerGrant(db.prisma as never, `Bearer ${only.access}`, new Date())).toBeNull();
    // The refresh token goes with it.
    expect(db.tokens.find((t) => t.tokenHash === hashSecret(parseChatToken(only.refresh)!.id))).toBeUndefined();
  });
});

describe('DELETE /v2/chat', () => {
  it('cuts every chat of the device with its tokens, codes and copy, and touches nobody else\'s', async () => {
    const { app, db } = world();
    const token = await register(app);
    await register(app);
    link(db, 'device1');
    link(db, 'device1');
    const theirs = link(db, 'device2');
    const demo = link(db, null, { demo: true });
    await postCode(app, token);
    db.authCodes.push({ codeHash: 'a1', grantId: db.grants[0]!.id, key: KEY_TEXT, codeChallenge: 'c', redirectUri: CHATGPT, expiresAt: new Date() });
    db.authCodes.push({ codeHash: 'a2', grantId: theirs.grant.id, key: KEY_TEXT, codeChallenge: 'c', redirectUri: CHATGPT, expiresAt: new Date() });
    db.codes.push({ id: 'other', codeHash: 'h', deviceId: 'device2', key: KEY_TEXT, expiresAt: new Date() });
    db.snapshots.push(
      { deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() },
      { deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(), updatedAt: new Date() },
    );

    const res = await app.inject({ method: 'DELETE', url: '/v2/chat', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.grants.map((g) => g.id)).toEqual([theirs.grant.id, demo.grant.id]);
    expect(db.tokens.map((t) => t.grantId)).toEqual([theirs.grant.id, theirs.grant.id, demo.grant.id, demo.grant.id]);
    expect(db.authCodes.map((a) => a.codeHash)).toEqual(['a2']);
    expect(db.codes.map((c) => c.deviceId)).toEqual(['device2']);
    expect(db.snapshots.map((s) => s.deviceId)).toEqual(['device2']);
    expect(db.devices).toHaveLength(2);
  });

  it('is fine with nothing to cut', async () => {
    const { app } = world();
    const token = await register(app);
    expect((await app.inject({ method: 'DELETE', url: '/v2/chat', headers: auth(token) })).statusCode).toBe(200);
  });
});

describe('DELETE /v2/device', () => {
  it('leaves no chat code, grant, token or copy of the device, and none of another\'s goes', async () => {
    const { app, db } = world();
    const leaving = await register(app);
    await register(app);
    link(db, 'device1');
    link(db, 'device1');
    const theirs = link(db, 'device2');
    await postCode(app, leaving);
    db.authCodes.push({ codeHash: 'a1', grantId: db.grants[0]!.id, key: KEY_TEXT, codeChallenge: 'c', redirectUri: CHATGPT, expiresAt: new Date() });
    db.codes.push({ id: 'other', codeHash: 'h', deviceId: 'device2', key: KEY_TEXT, expiresAt: new Date() });
    db.snapshots.push(
      { deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() },
      { deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(), updatedAt: new Date() },
    );

    const res = await app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(leaving) });
    expect(res.statusCode).toBe(200);
    expect(db.devices.map((d) => d.id)).toEqual(['device2']);
    expect(db.grants.map((g) => g.id)).toEqual([theirs.grant.id]);
    expect(db.tokens.map((t) => t.grantId)).toEqual([theirs.grant.id, theirs.grant.id]);
    expect(db.authCodes).toEqual([]);
    expect(db.codes.map((c) => c.deviceId)).toEqual(['device2']);
    expect(db.snapshots.map((s) => s.deviceId)).toEqual(['device2']);
  });
});

describe('chat codes and tokens', () => {
  it('mintChatCode writes 8 characters of the alphabet, which normalize and format back', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = mintChatCode();
      expect(code).toHaveLength(8);
      for (const c of code) expect(CHAT_CODE_ALPHABET).toContain(c);
      expect(normalizeChatCode(formatChatCode(code))).toBe(code);
      seen.add(code);
    }
    // 32^8 codes: 300 draws that repeat a lot are not random.
    expect(seen.size).toBeGreaterThan(295);
  });

  it('hashSecret is the sha256 hex of its text', () => {
    expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('mintTokenPair makes two tokens that carry K, and rows that hold only the hash of each id', () => {
    const now = new Date('2026-11-05T10:00:00.000Z');
    const pair = mintTokenPair('grant9', KEY, now);
    const access = parseChatToken(pair.access)!;
    const refresh = parseChatToken(pair.refresh)!;
    expect(access.kind).toBe('access');
    expect(refresh.kind).toBe('refresh');
    expect(access.id).not.toBe(refresh.id);
    expect(Array.from(access.key)).toEqual(Array.from(KEY));
    expect(Array.from(refresh.key)).toEqual(Array.from(KEY));
    expect(pair.rows).toEqual([
      { tokenHash: sha256(access.id), grantId: 'grant9', kind: 'access', expiresAt: new Date(now.getTime() + CHAT_ACCESS_TTL_MS) },
      { tokenHash: sha256(refresh.id), grantId: 'grant9', kind: 'refresh', expiresAt: new Date(now.getTime() + CHAT_REFRESH_TTL_MS) },
    ]);
    // Neither a token nor K is in a row.
    const kept = JSON.stringify(pair.rows);
    expect(kept).not.toContain(KEY_TEXT);
    expect(kept).not.toContain(access.id);
    // A new pair is new ids.
    expect(parseChatToken(mintTokenPair('grant9', KEY, now).access)!.id).not.toBe(access.id);
  });

  it('mintTokenPair refuses a key that is not 32 bytes, which no token could carry', () => {
    expect(() => mintTokenPair('g', new Uint8Array(31), new Date())).toThrow();
    expect(() => mintTokenPair('g', new Uint8Array(33), new Date())).toThrow();
  });

  describe('bearerGrant', () => {
    it('finds the grant of a live access token, with the K it carries', async () => {
      const { db } = world();
      const mine = link(db, 'device1', { approvedAt: new Date() });
      const found = await bearerGrant(db.prisma as never, `Bearer ${mine.access}`, new Date());
      expect(found?.grant.id).toBe(mine.grant.id);
      expect(Array.from(found!.key!)).toEqual(Array.from(KEY));
    });

    it('gives no K for a demo grant, whose tokens carry zeros', async () => {
      const { db } = world();
      const demo = link(db, null, { demo: true });
      const found = await bearerGrant(db.prisma as never, `Bearer ${demo.access}`, new Date());
      expect(found?.grant.demo).toBe(true);
      expect(found?.key).toBeNull();
    });

    it('finds nothing for a refresh token, an expired one, a made-up one, or no header', async () => {
      const { db } = world();
      const mine = link(db, 'device1');
      const now = new Date();
      const bearer = (token: string) => bearerGrant(db.prisma as never, `Bearer ${token}`, now);
      expect(await bearer(mine.refresh)).toBeNull();
      // The refresh token's id dressed as an access token: the row says what it is.
      expect(await bearer(mine.refresh.replace('syr_', 'sya_'))).toBeNull();
      // Good until the moment its row says, and not at that moment.
      const expiresAt = db.tokens.find((t) => t.kind === 'access')!.expiresAt;
      expect(await bearerGrant(db.prisma as never, `Bearer ${mine.access}`, new Date(expiresAt.getTime() - 1))).not.toBeNull();
      expect(await bearerGrant(db.prisma as never, `Bearer ${mine.access}`, expiresAt)).toBeNull();
      expect(await bearerGrant(db.prisma as never, `Bearer ${mine.access}`, new Date(now.getTime() + CHAT_ACCESS_TTL_MS + 1000))).toBeNull();
      expect(await bearer(mintTokenPair('x', KEY, now).access)).toBeNull();
      expect(await bearer('nonsense')).toBeNull();
      expect(await bearerGrant(db.prisma as never, undefined, now)).toBeNull();
      expect(await bearerGrant(db.prisma as never, '', now)).toBeNull();
      expect(await bearerGrant(db.prisma as never, mine.access, now)).toBeNull();
      expect(await bearerGrant(db.prisma as never, `Basic ${mine.access}`, now)).toBeNull();
    });

    it('finds nothing once the grant is gone, even if a token row is left', async () => {
      const { db } = world();
      const mine = link(db, 'device1');
      db.grants.length = 0;
      expect(await bearerGrant(db.prisma as never, `Bearer ${mine.access}`, new Date())).toBeNull();
    });
  });

  describe('revokeGrant', () => {
    it('deletes the grant, its tokens and its authorization codes, and the copy when it was the device\'s last', async () => {
      const { db } = world();
      const mine = link(db, 'device1');
      const other = link(db, 'device2');
      db.authCodes.push({ codeHash: 'a1', grantId: mine.grant.id, key: KEY_TEXT, codeChallenge: 'c', redirectUri: CHATGPT, expiresAt: new Date() });
      db.snapshots.push(
        { deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() },
        { deviceId: 'device2', ciphertext: 'theirs', writtenAt: new Date(), updatedAt: new Date() },
      );
      await revokeGrant(db.prisma as never, mine.grant.id);
      expect(db.grants.map((g) => g.id)).toEqual([other.grant.id]);
      expect(db.tokens.every((t) => t.grantId === other.grant.id)).toBe(true);
      expect(db.authCodes).toEqual([]);
      expect(db.snapshots.map((s) => s.deviceId)).toEqual(['device2']);
    });

    it('does nothing for a grant that is already gone, and leaves a demo grant\'s neighbours alone', async () => {
      const { db } = world();
      const mine = link(db, 'device1');
      const demo = link(db, null, { demo: true });
      db.snapshots.push({ deviceId: 'device1', ciphertext: 'abc', writtenAt: new Date(), updatedAt: new Date() });
      await revokeGrant(db.prisma as never, 'gone');
      await revokeGrant(db.prisma as never, demo.grant.id);
      expect(db.grants.map((g) => g.id)).toEqual([mine.grant.id]);
      expect(db.snapshots).toHaveLength(1);
      await revokeGrant(db.prisma as never, demo.grant.id);
      expect(db.grants).toHaveLength(1);
    });
  });
});
