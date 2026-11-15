/**
 * An in-memory stand-in for the chat connection's tables, with Prisma's call
 * shapes, for the suites of the phone's routes (`/v2/chat`) and of the chat's
 * side (`/oauth`). There is no cascade: a foreign key that would clear a child
 * does not, so that only what a route deletes is deleted, and a route that
 * forgets a table fails its suite. A query of a shape it does not model throws.
 */
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { RegisterDeviceResponse } from '@sederyom/shared';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildServices } from '../../src/services.js';
import { RecordingPusher } from '../../src/notify/push.js';
import { mintTokenPair } from '../../src/chat/tokens.js';

export const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  SCHEDULER_ENABLED: 'false',
  LOG_LEVEL: 'silent',
};
const silent = { info: () => {}, warn: () => {}, error: () => {} };

type Row = Record<string, unknown> & { id: string };
export type ClientRow = { id: string; name: string; redirectUris: string[]; createdAt: Date; linkedAt: Date | null };
export type GrantRow = { id: string; deviceId: string | null; clientId: string; demo: boolean; approvedAt: Date | null; createdAt: Date; lastUsedAt: Date | null };
export type CodeRow = { id: string; codeHash: string; deviceId: string; key: string | null; expiresAt: Date };
export type AuthCodeRow = { codeHash: string; grantId: string; key: string; codeChallenge: string; redirectUri: string; expiresAt: Date };
export type TokenRow = { tokenHash: string; grantId: string; kind: string; expiresAt: Date; usedAt: Date | null };
export type SnapshotRow = { deviceId: string; ciphertext: string; writtenAt: Date; updatedAt: Date };
export type AttemptRow = { id: number; ip: string; at: Date };

/** The keys of a `where` the stand-in reads; any other is a query it does not model. */
function guard(table: string, where: Record<string, unknown>, known: string[]) {
  for (const key of Object.keys(where)) if (!known.includes(key)) throw new Error(`the stand-in does not read ${key} in a ${table} query`);
}
/** `value` as Prisma filters it by equality: no filter matches all, `null` is `IS NULL`. */
const is = (value: unknown, filter: unknown) => filter === undefined || value === filter;
/** `value` against a `{ lt }` filter (strictly before); no filter matches all. */
const before = (table: string, value: Date, filter: { lt: Date } | undefined) => {
  if (filter === undefined) return true;
  guard(`${table} date filter`, filter, ['lt']);
  return value.getTime() < filter.lt.getTime();
};
/** A relation filter `{ none: {} }`, the one shape the stand-in reads; anything else throws. */
const noneFilter = (table: string, filter: { none: object }) => {
  if (JSON.stringify(filter) !== '{"none":{}}') throw new Error(`the stand-in reads only { none: {} } for a relation of ${table}`);
};

export function memoryDb() {
  let n = 0;
  const devices: Row[] = [];
  const notifications: { deviceId: string }[] = [];
  const clients: ClientRow[] = [];
  const grants: GrantRow[] = [];
  const codes: CodeRow[] = [];
  const authCodes: AuthCodeRow[] = [];
  const tokens: TokenRow[] = [];
  const snapshots: SnapshotRow[] = [];
  const attempts: AttemptRow[] = [];

  const removeWhere = <T>(rows: T[], matches: (row: T) => boolean) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i]!)) rows.splice(i, 1);
    return { count: before - rows.length };
  };

  type GrantWhere = { id?: string; deviceId?: string | null; approvedAt?: null; createdAt?: { lt: Date }; tokens?: { none: object } };
  const grantMatches = (g: GrantRow, where: GrantWhere) => {
    guard('chat_grant', where, ['id', 'deviceId', 'approvedAt', 'createdAt', 'tokens']);
    if (where.tokens) {
      noneFilter('chat_grant.tokens', where.tokens);
      if (tokens.some((t) => t.grantId === g.id)) return false;
    }
    return is(g.id, where.id) && is(g.deviceId, where.deviceId) && is(g.approvedAt, where.approvedAt) && before('chat_grant', g.createdAt, where.createdAt);
  };
  /** Rows of a table that hangs off a grant: by `grantId`, or by the grant's device. */
  type OfGrantWhere = { grantId?: string; grant?: { deviceId: string } };
  const ofGrantMatches = (table: string, row: { grantId: string }, where: OfGrantWhere, extra: string[] = []) => {
    guard(table, where, ['grantId', 'grant', ...extra]);
    if (where.grant) {
      guard(`${table}.grant`, where.grant, ['deviceId']);
      if (grants.find((g) => g.id === row.grantId)?.deviceId !== where.grant.deviceId) return false;
    }
    return is(row.grantId, where.grantId);
  };
  type TokenWhere = OfGrantWhere & { tokenHash?: string; kind?: string; usedAt?: null; expiresAt?: { lt: Date } };
  const tokenMatches = (t: TokenRow, where: TokenWhere) =>
    ofGrantMatches('chat_token', t, where, ['tokenHash', 'kind', 'usedAt', 'expiresAt']) &&
    is(t.tokenHash, where.tokenHash) && is(t.kind, where.kind) && is(t.usedAt, where.usedAt) && before('chat_token', t.expiresAt, where.expiresAt);
  type AuthCodeWhere = OfGrantWhere & { codeHash?: string; expiresAt?: { lt: Date } };
  const authCodeMatches = (a: AuthCodeRow, where: AuthCodeWhere) =>
    ofGrantMatches('chat_auth_code', a, where, ['codeHash', 'expiresAt']) &&
    is(a.codeHash, where.codeHash) && before('chat_auth_code', a.expiresAt, where.expiresAt);
  const onlyInclude = (include: Record<string, unknown> | undefined, name: string) => {
    if (include && (Object.keys(include).join() !== name || include[name] !== true)) throw new Error(`the stand-in includes only { ${name}: true }`);
  };

  const prisma = {
    device: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        devices.find((d) => Object.entries(where).every(([k, v]) => d[k] === v)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `device${++n}`, pushToken: null, classId: null, ...data };
        devices.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => devices.splice(devices.findIndex((d) => d.id === where.id), 1)[0],
    },
    deviceNotification: {
      deleteMany: async ({ where }: { where: { deviceId: string } }) => removeWhere(notifications, (r) => r.deviceId === where.deviceId),
    },
    // `DELETE /v2/device` settles the device's friends' boxes in its transaction; these suites have none.
    buddyBox: {
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    chatClient: {
      create: async ({ data }: { data: { name: string; redirectUris: string[] } }) => {
        const row: ClientRow = { id: `registered${++n}`, createdAt: new Date(), linkedAt: null, ...data };
        clients.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        guard('chat_client', where, ['id']);
        return clients.find((c) => c.id === where.id) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { linkedAt: Date } }) => {
        guard('chat_client', where, ['id']);
        guard('chat_client update', data, ['linkedAt']);
        const row = clients.find((c) => c.id === where.id);
        if (!row) throw new Error('Record to update not found.');
        return Object.assign(row, data);
      },
      deleteMany: async ({ where }: { where: { grants?: { none: object }; createdAt?: { lt: Date }; linkedAt?: null } }) => {
        guard('chat_client', where, ['grants', 'createdAt', 'linkedAt']);
        if (where.grants) noneFilter('chat_client.grants', where.grants);
        if (where.linkedAt !== undefined && where.linkedAt !== null) throw new Error('the stand-in reads only linkedAt: null');
        return removeWhere(
          clients,
          (c) => (!where.grants || !grants.some((g) => g.clientId === c.id)) && is(c.linkedAt, where.linkedAt) && before('chat_client', c.createdAt, where.createdAt),
        );
      },
    },
    chatGrant: {
      count: async ({ where }: { where: GrantWhere }) => grants.filter((g) => grantMatches(g, where)).length,
      create: async ({ data }: { data: { deviceId: string | null; clientId: string; demo?: boolean; approvedAt?: Date | null } }) => {
        const row: GrantRow = { id: `granted${++n}`, demo: false, approvedAt: null, createdAt: new Date(), lastUsedAt: null, ...data };
        grants.push(row);
        return row;
      },
      findMany: async ({ where, include, orderBy }: { where: GrantWhere; include?: { client: true }; orderBy?: { createdAt: 'asc' } }) => {
        onlyInclude(include, 'client');
        if (orderBy && JSON.stringify(orderBy) !== '{"createdAt":"asc"}') throw new Error('the stand-in orders only by createdAt asc');
        const hit = grants.filter((g) => grantMatches(g, where));
        if (orderBy) hit.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return include ? hit.map((g) => ({ ...g, client: clients.find((c) => c.id === g.clientId) })) : hit;
      },
      findFirst: async ({ where }: { where: GrantWhere }) => grants.find((g) => grantMatches(g, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => {
        guard('chat_grant', where, ['id']);
        return grants.find((g) => g.id === where.id) ?? null;
      },
      updateMany: async ({ where, data }: { where: GrantWhere; data: Partial<GrantRow> }) => {
        const hit = grants.filter((g) => grantMatches(g, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: GrantWhere }) => removeWhere(grants, (g) => grantMatches(g, where)),
    },
    chatToken: {
      findUnique: async ({ where, include }: { where: { tokenHash: string }; include?: { grant: true } }) => {
        guard('chat_token', where, ['tokenHash']);
        onlyInclude(include, 'grant');
        const row = tokens.find((t) => t.tokenHash === where.tokenHash);
        if (!row) return null;
        return include ? { ...row, grant: grants.find((g) => g.id === row.grantId) ?? null } : row;
      },
      createMany: async ({ data }: { data: Omit<TokenRow, 'usedAt'>[] }) => {
        for (const row of data) {
          if (tokens.some((t) => t.tokenHash === row.tokenHash)) throw new Error('Unique constraint failed on the fields: (`tokenHash`)');
        }
        for (const row of data) tokens.push({ usedAt: null, ...row });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where: TokenWhere; data: Partial<TokenRow> }) => {
        const hit = tokens.filter((t) => tokenMatches(t, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: TokenWhere }) => removeWhere(tokens, (t) => tokenMatches(t, where)),
    },
    chatAuthCode: {
      create: async ({ data }: { data: AuthCodeRow }) => {
        if (authCodes.some((a) => a.codeHash === data.codeHash)) throw new Error('Unique constraint failed on the fields: (`codeHash`)');
        const row = { ...data };
        authCodes.push(row);
        return row;
      },
      findUnique: async ({ where, include }: { where: { codeHash: string }; include?: { grant: true } }) => {
        guard('chat_auth_code', where, ['codeHash']);
        onlyInclude(include, 'grant');
        const row = authCodes.find((a) => a.codeHash === where.codeHash);
        if (!row) return null;
        return include ? { ...row, grant: grants.find((g) => g.id === row.grantId) ?? null } : row;
      },
      deleteMany: async ({ where }: { where: AuthCodeWhere }) => removeWhere(authCodes, (a) => authCodeMatches(a, where)),
    },
    chatCode: {
      create: async ({ data }: { data: Omit<CodeRow, 'id'> }) => {
        // The unique index on the hash, as Postgres keeps it.
        if (codes.some((c) => c.codeHash === data.codeHash)) throw new Error('Unique constraint failed on the fields: (`codeHash`)');
        const row = { id: `code${++n}`, ...data };
        codes.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { codeHash: string } }) => {
        guard('chat_code', where, ['codeHash']);
        return codes.find((c) => c.codeHash === where.codeHash) ?? null;
      },
      deleteMany: async ({ where }: { where: { deviceId?: string; codeHash?: string; expiresAt?: { lt: Date } } }) => {
        guard('chat_code', where, ['deviceId', 'codeHash', 'expiresAt']);
        if (where.deviceId === undefined && where.codeHash === undefined && where.expiresAt === undefined) {
          throw new Error('the stand-in deletes chat codes by device, hash or expiry');
        }
        return removeWhere(codes, (c) => is(c.deviceId, where.deviceId) && is(c.codeHash, where.codeHash) && before('chat_code', c.expiresAt, where.expiresAt));
      },
    },
    chatSnapshot: {
      findUnique: async ({ where }: { where: { deviceId: string } }) => {
        guard('chat_snapshot', where, ['deviceId']);
        return snapshots.find((s) => s.deviceId === where.deviceId) ?? null;
      },
      // Like Prisma: `update` changes only what it names (and `updatedAt`), `create` fills `writtenAt` by its default.
      upsert: async ({ where, create, update }: { where: { deviceId: string }; create: Partial<SnapshotRow> & { deviceId: string; ciphertext: string }; update: Partial<SnapshotRow> }) => {
        guard('chat_snapshot', where, ['deviceId']);
        const now = new Date();
        const row = snapshots.find((s) => s.deviceId === where.deviceId);
        if (row) return Object.assign(row, update, { updatedAt: now });
        const made = { writtenAt: now, ...create, updatedAt: now };
        snapshots.push(made);
        return made;
      },
      deleteMany: async ({ where }: { where: { deviceId?: string; writtenAt?: { lt: Date }; device?: { chatGrants: { none: object } } } }) => {
        guard('chat_snapshot', where, ['deviceId', 'writtenAt', 'device']);
        if (where.device && JSON.stringify(where.device) !== '{"chatGrants":{"none":{}}}') throw new Error('the stand-in reads only device: { chatGrants: { none: {} } }');
        return removeWhere(
          snapshots,
          (s) => is(s.deviceId, where.deviceId) && before('chat_snapshot', s.writtenAt, where.writtenAt) && (!where.device || !grants.some((g) => g.deviceId === s.deviceId)),
        );
      },
    },
    chatAttempt: {
      count: async ({ where }: { where: { ip: string; at: { gte: Date } } }) => {
        guard('chat_attempt', where, ['ip', 'at']);
        guard('chat_attempt.at', where.at, ['gte']);
        return attempts.filter((a) => a.ip === where.ip && a.at.getTime() >= where.at.gte.getTime()).length;
      },
      create: async ({ data }: { data: { ip: string; at?: Date } }) => {
        const row: AttemptRow = { id: ++n, at: new Date(), ...data };
        attempts.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { ip?: string; at: { lt: Date } } }) => {
        guard('chat_attempt', where, ['ip', 'at']);
        return removeWhere(attempts, (a) => is(a.ip, where.ip) && before('chat_attempt', a.at, where.at));
      },
    },
    // The statements are built in order and each runs to its end at once, so the array is the order they ran in.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, devices, notifications, clients, grants, codes, authCodes, tokens, snapshots, attempts };
}
export type Db = ReturnType<typeof memoryDb>;

/**
 * The app over a fresh stand-in, with `env` laid over the test's environment. With a `logStream`
 * (and a `LOG_LEVEL` in `env`) the app's request log goes there instead of to stdout.
 */
export function world(env: Record<string, string> = {}, logStream?: { write(line: string): void }) {
  const db = memoryDb();
  const loaded = loadEnv({ ...ENV, ...env } as unknown as NodeJS.ProcessEnv, () => {});
  const services = buildServices(loaded, db.prisma as never, silent, new RecordingPusher());
  return { app: buildApp({ services, logStream }), db };
}
export type App = ReturnType<typeof world>['app'];

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** A new device, and its token. */
export async function register(app: App): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/v2/devices', payload: { platform: 'android' } });
  expect(res.statusCode).toBe(201);
  return (res.json() as RegisterDeviceResponse).token;
}

/** K: 32 bytes, and the base64url the phone sends. */
export const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
export const KEY_TEXT = Buffer.from(KEY).toString('base64url');
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export const CHATGPT = 'https://chatgpt.com/connector/oauth/x';
export const EVIL = 'https://evil.example/cb';

/**
 * A chat that is already linked, as the OAuth flow leaves it: a client, a grant
 * of `deviceId`, and a pair of tokens whose rows are written.
 */
export function link(db: Db, deviceId: string | null, opts: { redirectUris?: string[]; name?: string; approvedAt?: Date | null; demo?: boolean; createdAt?: Date; lastUsedAt?: Date | null } = {}) {
  const k = db.clients.length + 1;
  const client: ClientRow = { id: `client${k}`, name: opts.name ?? `Chat ${k}`, redirectUris: opts.redirectUris ?? [CHATGPT], createdAt: new Date(), linkedAt: new Date() };
  db.clients.push(client);
  const grant: GrantRow = {
    id: `grant${db.grants.length + 1}`, deviceId, clientId: client.id, demo: opts.demo ?? false,
    approvedAt: opts.approvedAt ?? null, createdAt: opts.createdAt ?? new Date(), lastUsedAt: opts.lastUsedAt ?? null,
  };
  db.grants.push(grant);
  const pair = mintTokenPair(grant.id, KEY, new Date());
  for (const row of pair.rows) db.tokens.push({ usedAt: null, ...row } as TokenRow);
  return { client, grant, ...pair };
}
