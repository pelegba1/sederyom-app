/**
 * What the tick forgets of the chat connection (server/src/sync/tick.ts): codes
 * and tokens past their expiry, a chat that never finished linking, a chat
 * client nobody linked, a copy nobody can read any more, and the wrong tries
 * of the authorize page. Rows sit on each side of each boundary, and only the
 * ones inside remain. The step is isolated like the tick's others: its failure
 * is reported and stops nothing, and nothing else's stops it.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_CODE_LOCK_MS, CHAT_SNAPSHOT_STALE_DAYS } from '@sederyom/shared';
import type { Services } from '../src/services.js';
import { buildServices } from '../src/services.js';
import { loadEnv } from '../src/env.js';
import { RecordingPusher } from '../src/notify/push.js';
import { runTick } from '../src/sync/tick.js';
import {
  type AttemptRow, type AuthCodeRow, type ClientRow, type CodeRow, type Db, type GrantRow, type SnapshotRow, type TokenRow,
  CHATGPT, ENV, memoryDb,
} from './helpers/chatDb.js';

// Thursday 5.11.2026, 12:00 in Jerusalem.
const NOW = new Date('2026-11-05T10:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

/** A client; `linkedAt` is when a grant was first made for it (POST /oauth/authorize), `null` for one never linked. */
const client = (id: string, createdAt: Date, linkedAt: Date | null = null): ClientRow => ({ id, name: id, redirectUris: [CHATGPT], createdAt, linkedAt });
const grant = (id: string, clientId: string, deviceId: string | null, createdAt: Date): GrantRow =>
  ({ id, deviceId, clientId, demo: deviceId === null, approvedAt: null, createdAt, lastUsedAt: null });
const token = (hash: string, grantId: string, expiresAt: Date, kind = 'access'): TokenRow => ({ tokenHash: hash, grantId, kind, expiresAt, usedAt: null });
const code = (hash: string, expiresAt: Date): CodeRow => ({ id: `code-${hash}`, codeHash: hash, deviceId: 'dev', key: null, expiresAt });
const authCode = (hash: string, grantId: string, expiresAt: Date): AuthCodeRow =>
  ({ codeHash: hash, grantId, key: 'k', codeChallenge: 'c', redirectUri: CHATGPT, expiresAt });
const snapshot = (deviceId: string, writtenAt: Date): SnapshotRow => ({ deviceId, ciphertext: 'abc', writtenAt, updatedAt: writtenAt });
const attempt = (id: number, at: Date): AttemptRow => ({ id, ip: '203.0.113.7', at });

/**
 * `runTick` over the chat stand-in. The tick's class steps find nothing to do;
 * `db.prisma` is the same object the services hold, so a test can break one of
 * its calls and `calls` lists the buddy boxes' (the step before the chat's).
 */
function tickWorld() {
  const db: Db = memoryDb();
  const calls: string[] = [];
  const prisma = db.prisma as Record<string, any>;
  prisma.schoolClass = { findMany: async () => [] };
  prisma.classSnapshot = { findMany: async () => [] };
  prisma.classChangeEvent = { findMany: async () => [] };
  const buddy = prisma.buddyBox;
  prisma.buddyBox = {
    updateMany: async (args: unknown) => (calls.push('buddy updateMany'), buddy.updateMany(args)),
    deleteMany: async (args: unknown) => (calls.push('buddy deleteMany'), buddy.deleteMany(args)),
  };
  const logged: string[] = [];
  const services = buildServices(
    loadEnv(ENV as unknown as NodeJS.ProcessEnv),
    prisma as never,
    { info: () => {}, warn: () => {}, error: (_obj: unknown, msg?: string) => void logged.push(msg ?? '') },
    new RecordingPusher(),
  ) as Services;
  return { db, services, calls, logged, prisma };
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe('the chat step of a tick', () => {
  it('forgets link codes and authorization codes past their expiry, and only those', async () => {
    const { db, services } = tickWorld();
    db.codes.push(code('code-gone', ago(1)), code('code-now', NOW), code('code-live', ahead(MIN)));
    db.authCodes.push(authCode('auth-gone', 'g', ago(1)), authCode('auth-now', 'g', NOW), authCode('auth-live', 'g', ahead(MIN)));
    const result = await runTick(services, NOW);
    expect(result.errors).toEqual([]);
    expect(db.codes.map((c) => c.codeHash)).toEqual(['code-now', 'code-live']);
    expect(db.authCodes.map((a) => a.codeHash)).toEqual(['auth-now', 'auth-live']);
  });

  it('forgets tokens past their expiry, and a grant that still holds one keeps its row', async () => {
    const { db, services } = tickWorld();
    db.clients.push(client('c', ago(30 * DAY)));
    db.grants.push(grant('g-live', 'c', 'dev', ago(5 * DAY)));
    db.tokens.push(
      token('access-gone', 'g-live', ago(1)),
      token('access-now', 'g-live', NOW),
      token('refresh-live', 'g-live', ahead(DAY), 'refresh'),
    );
    await runTick(services, NOW);
    expect(db.tokens.map((t) => t.tokenHash)).toEqual(['access-now', 'refresh-live']);
    expect(ids(db.grants)).toEqual(['g-live']);
  });

  it('forgets a grant with no token once it is an hour old, and not before', async () => {
    const { db, services } = tickWorld();
    db.clients.push(client('c', NOW));
    db.grants.push(
      grant('g-61m', 'c', 'dev', ago(61 * MIN)),
      grant('g-1h', 'c', 'dev', ago(HOUR)),
      grant('g-59m', 'c', 'dev', ago(59 * MIN)),
      // Old, but it has a token: a chat that is linked.
      grant('g-old-linked', 'c', 'dev', ago(40 * DAY)),
      // A demo grant that never got its tokens goes like any other.
      grant('g-demo-tokenless', 'c', null, ago(2 * HOUR)),
    );
    db.tokens.push(token('t', 'g-old-linked', ahead(HOUR)));
    await runTick(services, NOW);
    expect(ids(db.grants)).toEqual(['g-1h', 'g-59m', 'g-old-linked']);
  });

  it('forgets a grant that this very tick leaves with no token', async () => {
    const { db, services } = tickWorld();
    db.clients.push(client('c', ago(30 * DAY)));
    // Its access token ran out an hour ago, and its refresh token with it.
    db.grants.push(grant('g-lapsed', 'c', 'dev', ago(100 * DAY)));
    db.tokens.push(token('a', 'g-lapsed', ago(HOUR)), token('r', 'g-lapsed', ago(DAY), 'refresh'));
    await runTick(services, NOW);
    expect(db.tokens).toEqual([]);
    expect(db.grants).toEqual([]);
  });

  it('forgets a client no chat linked a week after it registered (ruling H), and not one with a grant', async () => {
    const { db, services } = tickWorld();
    db.clients.push(
      client('c-8d', ago(8 * DAY)),
      client('c-7d', ago(7 * DAY)),
      client('c-6d', ago(6 * DAY)),
      client('c-8d-linked', ago(8 * DAY), ago(8 * DAY)),
      // A grant with no linkedAt cannot come from the page; a client in that state still keeps it while the grant lives.
      client('c-8d-granted-unmarked', ago(8 * DAY)),
    );
    db.grants.push(grant('g-linked', 'c-8d-linked', 'dev', ago(8 * DAY)), grant('g-unmarked', 'c-8d-granted-unmarked', 'dev', ago(DAY)));
    db.tokens.push(token('t', 'g-linked', ahead(HOUR)), token('t2', 'g-unmarked', ahead(HOUR)));
    await runTick(services, NOW);
    expect(ids(db.clients)).toEqual(['c-6d', 'c-7d', 'c-8d-granted-unmarked', 'c-8d-linked']);
    expect(ids(db.grants)).toEqual(['g-linked', 'g-unmarked']);
  });

  it('keeps a client that was ever linked, grants or none, so a chat that was disconnected can link again with its client_id', async () => {
    const { db, services } = tickWorld();
    db.clients.push(
      // Disconnected eight days ago: its grant and tokens are gone, its client_id is still in the chat.
      client('c-8d-was-linked', ago(30 * DAY), ago(20 * DAY)),
      // Its only grant never got tokens: the grant goes, and the client, linked once, stays.
      client('c-8d-abandoned', ago(8 * DAY), ago(2 * HOUR)),
      client('c-8d-never', ago(8 * DAY)),
    );
    db.grants.push(grant('g-abandoned', 'c-8d-abandoned', 'dev', ago(2 * HOUR)));
    await runTick(services, NOW);
    expect(ids(db.grants)).toEqual([]);
    expect(ids(db.clients)).toEqual(['c-8d-abandoned', 'c-8d-was-linked']);
  });

  it(`forgets a copy not written in ${CHAT_SNAPSHOT_STALE_DAYS} days, and only those`, async () => {
    const { db, services } = tickWorld();
    db.clients.push(client('c', ago(60 * DAY)));
    for (const device of ['d-31', 'd-30', 'd-29']) {
      db.grants.push(grant(`g-${device}`, 'c', device, ago(90 * DAY)));
      db.tokens.push(token(`t-${device}`, `g-${device}`, ahead(HOUR)));
    }
    db.snapshots.push(snapshot('d-31', ago(31 * DAY)), snapshot('d-30', ago(30 * DAY)), snapshot('d-29', ago(29 * DAY)));
    await runTick(services, NOW);
    expect(db.snapshots.map((s) => s.deviceId)).toEqual(['d-30', 'd-29']);
  });

  it('forgets the copy of a device that has no chat left (ruling J), also when this tick took the last one', async () => {
    const { db, services } = tickWorld();
    db.clients.push(client('c', ago(60 * DAY)));
    // d-orphan: a PUT that raced the last revoke wrote it after the grant went.
    // d-linked: has a chat. d-lapsing: its only grant is an abandoned one the tick forgets.
    db.grants.push(grant('g-linked', 'c', 'd-linked', ago(DAY)), grant('g-lapsing', 'c', 'd-lapsing', ago(2 * HOUR)));
    db.tokens.push(token('t', 'g-linked', ahead(HOUR)));
    db.snapshots.push(snapshot('d-orphan', ago(MIN)), snapshot('d-linked', ago(MIN)), snapshot('d-lapsing', ago(MIN)));
    await runTick(services, NOW);
    expect(db.snapshots.map((s) => s.deviceId)).toEqual(['d-linked']);
  });

  it(`forgets wrong tries older than ${CHAT_CODE_LOCK_MS / MIN} minutes, and only those`, async () => {
    const { db, services } = tickWorld();
    db.attempts.push(attempt(1, ago(10 * MIN + 1)), attempt(2, ago(10 * MIN)), attempt(3, ago(9 * MIN)), attempt(4, NOW));
    await runTick(services, NOW);
    expect(db.attempts.map((a) => a.id)).toEqual([2, 3, 4]);
  });

  it('leaves a tick on empty tables alone, and a second tick the same', async () => {
    const { db, services } = tickWorld();
    db.clients.push(client('c', ago(DAY)));
    db.grants.push(grant('g', 'c', 'dev', ago(DAY)));
    db.tokens.push(token('t', 'g', ahead(HOUR)));
    db.snapshots.push(snapshot('dev', ago(DAY)));
    expect((await runTick(services, NOW)).errors).toEqual([]);
    expect((await runTick(services, NOW)).errors).toEqual([]);
    expect([db.clients.length, db.grants.length, db.tokens.length, db.snapshots.length]).toEqual([1, 1, 1, 1]);
  });
});

describe('the chat step is isolated', () => {
  it('reports its own failure under "chat", logs the phrase the runbook looks for, and stops nothing else', async () => {
    const { db, services, calls, logged, prisma } = tickWorld();
    db.attempts.push(attempt(1, ago(HOUR)));
    prisma.chatToken.deleteMany = async () => {
      throw new Error('tokens down');
    };
    const result = await runTick(services, NOW);
    expect(result.errors).toEqual([expect.stringMatching(/^chat: .*tokens down/)]);
    expect(logged).toEqual(['forgetting stale chat rows threw']);
    // The class step and the buddy boxes, which come first, ran and answered.
    expect(result.classes).toMatchObject({ polled: 0, failed: 0 });
    expect(calls).toEqual(['buddy updateMany', 'buddy deleteMany']);
  });

  it('is not stopped by a failure in the friends\' boxes before it', async () => {
    const { db, services, prisma } = tickWorld();
    db.attempts.push(attempt(1, ago(HOUR)));
    db.codes.push(code('code-gone', ago(1)));
    prisma.buddyBox = {
      updateMany: async () => {
        throw new Error('boxes down');
      },
      deleteMany: async () => ({ count: 0 }),
    };
    const result = await runTick(services, NOW);
    expect(result.errors).toEqual([expect.stringMatching(/^buddy boxes: .*boxes down/)]);
    expect(db.attempts).toEqual([]);
    expect(db.codes).toEqual([]);
  });
});
