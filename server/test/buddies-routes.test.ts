/**
 * `/v2/buddies` (friends spec §5): boxes of ciphertext under ids the server
 * cannot derive. The first device to write an id owns it; anyone who knows the
 * id can read it; only its writer can change or delete it. The server never
 * sees what a box holds, so what these tests pin is who may touch which id,
 * and the limits that keep one device from filling the table.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PutBuddyBoxesResponse, ReadBuddyBoxesResponse, RegisterDeviceResponse } from '@sederyom/shared';
import { BUDDY_BOXES_PER_DEVICE, BUDDY_INVITE_CIPHERTEXT_MAX, BUDDY_PAIR_CIPHERTEXT_MAX, BUDDY_PUT_MAX, BUDDY_READ_MAX } from '@sederyom/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildServices } from '../src/services.js';
import { RecordingPusher } from '../src/notify/push.js';

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  SCHEDULER_ENABLED: 'false',
  LOG_LEVEL: 'silent',
};
const silent = { info: () => {}, warn: () => {}, error: () => {} };

type Row = Record<string, unknown> & { id: string };
/** `writerDeviceId` is `null` once the writer's device is gone: the foreign key's `SetNull`. */
type BoxRow = { id: string; writerDeviceId: string | null; kind: string; ciphertext: string; createdAt: Date; updatedAt: Date };
type BoxWhere = {
  id?: string | { in: string[] };
  /** `null` is Prisma's `IS NULL`: a box whose device is gone. */
  writerDeviceId?: string | null;
  kind?: string | { in: string[] };
  ciphertext?: string | { not: string };
};

/**
 * `field` as Prisma filters it: equal to a value, `in` a list, or `not` a value, or `null` for
 * `IS NULL`. A `null` field matches only the `null` filter: it is no string, so SQL's
 * `NULL = 'x'` is not true, and Prisma's `not` is `<>`, which is not true of `NULL` either.
 */
function fieldMatches(value: string | null, filter: string | null | { in: string[] } | { not: string } | undefined): boolean {
  if (filter === undefined) return true;
  if (filter === null) return value === null;
  if (value === null) return false;
  if (typeof filter === 'string') return value === filter;
  if ('in' in filter) return filter.in.includes(value);
  return value !== filter.not;
}

/** Just the tables these routes touch, with Prisma's call shapes. */
function memoryDb() {
  let n = 0;
  const devices: Row[] = [];
  const boxes: BoxRow[] = [];
  const notifications: { deviceId: string }[] = [];
  const boxMatches = (box: BoxRow, where: BoxWhere) => {
    const known = new Set(['id', 'writerDeviceId', 'kind', 'ciphertext']);
    for (const key of Object.keys(where)) if (!known.has(key)) throw new Error(`the stand-in does not read ${key} in a buddy_box query`);
    return fieldMatches(box.id, where.id) && fieldMatches(box.writerDeviceId, where.writerDeviceId) &&
      fieldMatches(box.kind, where.kind) && fieldMatches(box.ciphertext, where.ciphertext);
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
      delete: async ({ where }: { where: { id: string } }) => {
        // `buddy_box.writerDeviceId` is `ON DELETE SET NULL`: its boxes stay, with no writer.
        for (const row of boxes) if (row.writerDeviceId === where.id) row.writerDeviceId = null;
        return devices.splice(devices.findIndex((d) => d.id === where.id), 1)[0];
      },
    },
    deviceNotification: {
      deleteMany: async ({ where }: { where: { deviceId: string } }) => {
        const before = notifications.length;
        for (let i = notifications.length - 1; i >= 0; i--) if (notifications[i]!.deviceId === where.deviceId) notifications.splice(i, 1);
        return { count: before - notifications.length };
      },
    },
    buddyBox: {
      findMany: async ({ where }: { where: BoxWhere }) => boxes.filter((b) => boxMatches(b, where)),
      findUnique: async ({ where }: { where: { id: string } }) => {
        for (const key of Object.keys(where)) if (key !== 'id') throw new Error(`findUnique by ${key}`);
        return boxes.find((b) => b.id === where.id) ?? null;
      },
      count: async ({ where }: { where: BoxWhere }) => boxes.filter((b) => boxMatches(b, where)).length,
      create: async ({ data }: { data: { id: string; writerDeviceId: string; kind: string; ciphertext: string } }) => {
        // The primary key: a second row under one id is refused, as Postgres refuses it.
        if (boxes.some((b) => b.id === data.id)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', { code: 'P2002', clientVersion: 'test' });
        }
        const now = new Date();
        const row = { ...data, createdAt: now, updatedAt: now };
        boxes.push(row);
        return row;
      },
      // `updateMany` and not `update`: it filters on the writer too, and a row that is not there is a count of 0, not an error.
      // Only what `data` says changes: `updatedAt` too only when the route sets it, so a route that leaves it to Prisma fails here.
      updateMany: async ({ where, data }: { where: BoxWhere; data: { ciphertext: string; updatedAt?: Date } }) => {
        const hit = boxes.filter((b) => boxMatches(b, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: BoxWhere }) => {
        const before = boxes.length;
        for (let i = boxes.length - 1; i >= 0; i--) if (boxMatches(boxes[i]!, where)) boxes.splice(i, 1);
        return { count: before - boxes.length };
      },
    },
    // A device's delete also clears its chat connection (`chatRowsOf`); this suite has none (chat-device-routes.test.ts does).
    chatAuthCode: { deleteMany: async () => ({ count: 0 }) },
    chatToken: { deleteMany: async () => ({ count: 0 }) },
    chatGrant: { deleteMany: async () => ({ count: 0 }) },
    chatCode: { deleteMany: async () => ({ count: 0 }) },
    chatSnapshot: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { prisma, devices, boxes, notifications };
}

function world() {
  const db = memoryDb();
  const env = loadEnv(ENV as unknown as NodeJS.ProcessEnv);
  const services = buildServices(env, db.prisma as never, silent, new RecordingPusher());
  return { app: buildApp({ services }), db };
}
type App = ReturnType<typeof world>['app'];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: App): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/v2/devices', payload: { platform: 'android' } });
  expect(res.statusCode).toBe(201);
  return (res.json() as RegisterDeviceResponse).token;
}

const A = 'A'.repeat(22);
const B = 'B'.repeat(22);
/** The n-th of as many distinct ids as a test needs. */
const boxId = (n: number) => `box${n}`.padEnd(22, '_');
const box = (id: string, ciphertext = 'abc', kind = 'pair') => ({ id, kind, ciphertext });

const put = (app: App, token: string, boxes: unknown) =>
  app.inject({ method: 'PUT', url: '/v2/buddies/boxes', headers: auth(token), payload: { boxes } });
const read = (app: App, token: string, ids: unknown) =>
  app.inject({ method: 'POST', url: '/v2/buddies/read', headers: auth(token), payload: { ids } });
const del = (app: App, token: string, ids: unknown) =>
  app.inject({ method: 'DELETE', url: '/v2/buddies/boxes', headers: auth(token), payload: { ids } });

/**
 * Runs `between` once, just ahead of the next call of `method` on the box
 * table: the gap in which another request, a cascade or the sweep can change a
 * row after a route has read it and before it writes.
 */
function inTheGap(db: ReturnType<typeof memoryDb>, method: string, between: () => void) {
  const table = db.prisma.buddyBox as unknown as Record<string, (args: unknown) => Promise<unknown>>;
  const real = table[method]!;
  table[method] = async (args) => {
    table[method] = real;
    between();
    return real(args);
  };
}
/** The call that replaces a box's ciphertext. */
const WRITE = 'updateMany';
const rowOf = (id: string, writerDeviceId: string, ciphertext: string): BoxRow =>
  ({ id, writerDeviceId, kind: 'pair', ciphertext, createdAt: new Date(), updatedAt: new Date() });

describe('the buddy boxes', () => {
  it('needs a device token', async () => {
    const { app } = world();
    const body = { boxes: [box(A)], ids: [A] };
    for (const [method, url] of [['PUT', '/v2/buddies/boxes'], ['POST', '/v2/buddies/read'], ['DELETE', '/v2/buddies/boxes']] as const) {
      expect((await app.inject({ method, url, payload: body })).statusCode, `${method} ${url}`).toBe(401);
      expect((await app.inject({ method, url, payload: body, headers: auth('made-up-token') })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('stores and reads back a box, and keeps only what was sent', async () => {
    const { app, db } = world();
    const token = await register(app);
    const written = await put(app, token, [box(A, 'abc')]);
    expect(written.statusCode).toBe(200);
    expect((written.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: true }]);
    // An id, who wrote it, what kind and the ciphertext: no reader, no name, nothing else.
    expect(db.boxes).toEqual([{ id: A, writerDeviceId: db.devices[0]!.id, kind: 'pair', ciphertext: 'abc', createdAt: expect.any(Date), updatedAt: expect.any(Date) }]);

    const res = await read(app, token, [A, B]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as ReadBuddyBoxesResponse).boxes).toEqual([
      { id: A, ciphertext: 'abc', updatedAt: db.boxes[0]!.updatedAt.toISOString() },
      { id: B, ciphertext: null, updatedAt: null },
    ]);
  });

  it('lets the writer replace its box, and answers a read in the order asked, repeats included', async () => {
    const { app, db } = world();
    const token = await register(app);
    await put(app, token, [box(A, 'one'), box(B, 'two')]);
    const again = await put(app, token, [box(B, 'three', 'invite'), box(A, 'four')]);
    expect((again.json() as PutBuddyBoxesResponse).results).toEqual([{ id: B, ok: true }, { id: A, ok: true }]);
    expect(db.boxes).toHaveLength(2);
    // The box keeps the kind it was made with: only the ciphertext is the writer's to replace.
    expect(db.boxes.find((b) => b.id === B)).toMatchObject({ ciphertext: 'three', kind: 'pair' });
    const res = await read(app, token, [B, A, B]);
    expect((res.json() as ReadBuddyBoxesResponse).boxes.map((b) => b.ciphertext)).toEqual(['three', 'four', 'three']);
  });

  it('takes one id twice in a request as a write and then a replacement', async () => {
    const { app, db } = world();
    const token = await register(app);
    const res = await put(app, token, [box(A, 'first'), box(A, 'second')]);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: true }, { id: A, ok: true }]);
    expect(db.boxes).toHaveLength(1);
    expect(db.boxes[0]).toMatchObject({ ciphertext: 'second' });
  });

  it('lets only the first writer write or delete a box', async () => {
    const { app, db } = world();
    const first = await register(app);
    const second = await register(app);
    await put(app, first, [box(A, 'mine')]);

    const taken = await put(app, second, [box(A, 'theirs'), box(B, 'free')]);
    expect(taken.statusCode).toBe(200);
    expect((taken.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }, { id: B, ok: true }]);
    expect(db.boxes.find((b) => b.id === A)).toMatchObject({ ciphertext: 'mine', writerDeviceId: db.devices[0]!.id });

    // Anyone who knows an id reads it: that is how a friend gets the box. Deleting is the writer's alone.
    expect(((await read(app, second, [A])).json() as ReadBuddyBoxesResponse).boxes[0]).toMatchObject({ ciphertext: 'mine' });
    const refused = await del(app, second, [A]);
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toEqual({ ok: true });
    expect(db.boxes.map((b) => b.id)).toEqual([A, B]);

    expect((await del(app, first, [A, B])).json()).toEqual({ ok: true });
    // B was the second device's, so only A is gone.
    expect(db.boxes.map((b) => b.id)).toEqual([B]);
    expect((await del(app, first, [A])).json()).toEqual({ ok: true });
    expect(((await read(app, second, [A])).json() as ReadBuddyBoxesResponse).boxes[0]).toEqual({ id: A, ciphertext: null, updatedAt: null });
  });

  it('refuses bad ids, kinds, sizes and counts', async () => {
    const { app, db } = world();
    const token = await register(app);
    const refused = async (res: Promise<{ statusCode: number; json(): { error?: string } }>, what: string) => {
      const r = await res;
      expect(r.statusCode, what).toBe(400);
      expect(r.json().error, what).toEqual(expect.any(String));
    };
    await refused(put(app, token, [box('x'.repeat(21))]), 'a 21-char id');
    await refused(put(app, token, [box('x'.repeat(23))]), 'a 23-char id');
    await refused(put(app, token, [box('x'.repeat(21) + '+')]), 'an id with a char outside base64url');
    await refused(put(app, token, [box(A, 'abc', 'other')]), 'a kind that is none of the three');
    await refused(put(app, token, [box(A, 'x'.repeat(BUDDY_PAIR_CIPHERTEXT_MAX + 1))]), 'a pair box one over');
    await refused(put(app, token, [box(A, 'x'.repeat(BUDDY_INVITE_CIPHERTEXT_MAX + 1), 'invite')]), 'an invite one over');
    await refused(put(app, token, [box(A, 'x'.repeat(BUDDY_INVITE_CIPHERTEXT_MAX + 1), 'reply')]), 'a reply one over');
    await refused(put(app, token, [box(A, '')]), 'an empty ciphertext');
    await refused(put(app, token, [box(A, 'ab+/=')]), 'a ciphertext that is not base64url');
    await refused(put(app, token, Array.from({ length: BUDDY_PUT_MAX + 1 }, (_, i) => box(boxId(i)))), 'one box over the put limit');
    await refused(put(app, token, 'not a list'), 'boxes that is no list');
    await refused(app.inject({ method: 'PUT', url: '/v2/buddies/boxes', headers: auth(token) }), 'no body');
    await refused(read(app, token, Array.from({ length: BUDDY_READ_MAX + 1 }, (_, i) => boxId(i))), 'one id over the read limit');
    await refused(read(app, token, ['x'.repeat(21)]), 'a 21-char id to read');
    await refused(del(app, token, Array.from({ length: BUDDY_READ_MAX + 1 }, (_, i) => boxId(i))), 'one id over the delete limit');
    await refused(del(app, token, ['x'.repeat(21)]), 'a 21-char id to delete');
    // A request with one bad box stores none of its good ones.
    await refused(put(app, token, [box(A), box(B, 'abc', 'other')]), 'a good box beside a bad one');
    expect(db.boxes).toEqual([]);
  });

  it('takes the most the limits allow', async () => {
    const { app, db } = world();
    const token = await register(app);
    // 25 pair boxes of the longest ciphertext, and an invite and a reply of theirs.
    const full = Array.from({ length: BUDDY_PUT_MAX }, (_, i) => box(boxId(i), 'x'.repeat(BUDDY_PAIR_CIPHERTEXT_MAX)));
    const res = await put(app, token, full);
    expect(res.statusCode).toBe(200);
    expect((res.json() as PutBuddyBoxesResponse).results.every((r) => r.ok)).toBe(true);
    expect(db.boxes).toHaveLength(BUDDY_PUT_MAX);
    const small = await put(app, token, [box(boxId(30), 'x'.repeat(BUDDY_INVITE_CIPHERTEXT_MAX), 'invite'), box(boxId(31), 'x'.repeat(BUDDY_INVITE_CIPHERTEXT_MAX), 'reply')]);
    expect((small.json() as PutBuddyBoxesResponse).results.every((r) => r.ok)).toBe(true);
    const all = await read(app, token, Array.from({ length: BUDDY_READ_MAX }, (_, i) => boxId(i)));
    expect(all.statusCode).toBe(200);
    expect((all.json() as ReadBuddyBoxesResponse).boxes).toHaveLength(BUDDY_READ_MAX);
  });

  it('refuses a body larger than the boxes it may carry', async () => {
    const { app, db } = world();
    const token = await register(app);
    // Twice what 25 of the largest boxes take: refused before it is read (413), not stored.
    const res = await put(app, token, [box(A, 'x'.repeat(2 * BUDDY_PUT_MAX * BUDDY_PAIR_CIPHERTEXT_MAX))]);
    expect(res.statusCode).toBe(413);
    expect(db.boxes).toEqual([]);
  });

  it('dates a replaced box itself, not by what the database might do', async () => {
    const { app, db } = world();
    const token = await register(app);
    await put(app, token, [box(A, 'one')]);
    const long = new Date('2026-01-01T00:00:00Z');
    db.boxes[0]!.updatedAt = long;
    await put(app, token, [box(A, 'two')]);
    // The stand-in sets only what the route asks: the sweep reads `updatedAt`, so the route must set it.
    expect(db.boxes[0]!.updatedAt.getTime()).toBeGreaterThan(long.getTime());
  });

  it('caps the boxes one device writes', async () => {
    const { app, db } = world();
    const token = await register(app);
    const other = await register(app);
    const ids = Array.from({ length: BUDDY_BOXES_PER_DEVICE + 1 }, (_, i) => boxId(i));
    for (let from = 0; from < BUDDY_BOXES_PER_DEVICE; from += BUDDY_PUT_MAX) {
      const res = await put(app, token, ids.slice(from, Math.min(from + BUDDY_PUT_MAX, BUDDY_BOXES_PER_DEVICE)).map((id) => box(id)));
      expect((res.json() as PutBuddyBoxesResponse).results.every((r) => r.ok)).toBe(true);
    }
    expect(db.boxes).toHaveLength(BUDDY_BOXES_PER_DEVICE);

    const last = ids[BUDDY_BOXES_PER_DEVICE]!;
    expect(((await put(app, token, [box(last)])).json() as PutBuddyBoxesResponse).results).toEqual([{ id: last, ok: false, error: 'too_many' }]);
    expect(db.boxes).toHaveLength(BUDDY_BOXES_PER_DEVICE);
    // A box it already has is no new one, so a full device can still keep its boxes fresh; and it is only this device that is full.
    expect(((await put(app, token, [box(ids[0]!, 'newer')])).json() as PutBuddyBoxesResponse).results[0]).toEqual({ id: ids[0], ok: true });
    expect(((await put(app, other, [box(last)])).json() as PutBuddyBoxesResponse).results[0]).toEqual({ id: last, ok: true });

    // Deleting makes room, and a request that straddles the cap gets what fits.
    await del(app, token, ids.slice(0, 2));
    const straddle = await put(app, token, [box(ids[0]!), box(ids[1]!), box(boxId(900))]);
    expect((straddle.json() as PutBuddyBoxesResponse).results.map((r) => r.error ?? 'ok')).toEqual(['ok', 'ok', 'too_many']);
  });

  it('reads again whose a box is when its creation loses a race', async () => {
    const { app, db } = world();
    const first = await register(app);
    const second = await register(app);
    await put(app, first, [box(A, 'mine')]);
    // From here the read finds no box (it was made after the read), so each write tries to create it and loses the race on the id.
    const realFindMany = db.prisma.buddyBox.findMany;
    db.prisma.buddyBox.findMany = async () => [];
    // The writer's own request, retried while the first still ran: it is its box, so it is replaced.
    const retried = await put(app, first, [box(A, 'retry')]);
    expect((retried.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: true }]);
    expect(db.boxes[0]).toMatchObject({ ciphertext: 'retry' });
    // Another device's: the first writer's.
    const lost = await put(app, second, [box(A, 'theirs')]);
    expect((lost.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }]);
    expect(db.boxes[0]).toMatchObject({ ciphertext: 'retry' });
    db.prisma.buddyBox.findMany = realFindMany;
  });

  /**
   * The replacement is the write's own check, not a read's: the row it read as
   * this device's can be gone, or another's, by the time it writes.
   */
  it('does not replace a box that changed hands after it was read as its own', async () => {
    const { app, db } = world();
    const first = await register(app);
    await register(app);
    const other = db.devices[1]!.id;
    await put(app, first, [box(A, 'mine')]);
    inTheGap(db, WRITE, () => {
      // Gone (its writer deleted it, its device went, the sweep took it) and made again by another device.
      db.boxes.splice(0, db.boxes.length, rowOf(A, other, 'theirs'));
    });
    const res = await put(app, first, [box(A, 'replacement'), box(B, 'next')]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }, { id: B, ok: true }]);
    expect(db.boxes.find((b) => b.id === A)).toMatchObject({ writerDeviceId: other, ciphertext: 'theirs' });
  });

  it('makes a box again when the row it meant to replace is gone, and writes the rest of the batch', async () => {
    const { app, db } = world();
    const token = await register(app);
    await put(app, token, [box(A, 'mine')]);
    inTheGap(db, WRITE, () => {
      db.boxes.splice(db.boxes.findIndex((b) => b.id === A), 1);
    });
    // B is made before A's turn, so it is what the failed replacement must not take down with it.
    const res = await put(app, token, [box(B, 'one'), box(A, 'two')]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: B, ok: true }, { id: A, ok: true }]);
    expect(db.boxes.map((b) => [b.id, b.writerDeviceId, b.ciphertext])).toEqual([[B, db.devices[0]!.id, 'one'], [A, db.devices[0]!.id, 'two']]);
  });

  it('makes a box that was taken in the gap and gone again, instead of calling it taken', async () => {
    const { app, db } = world();
    const first = await register(app);
    await register(app);
    const other = db.devices[1]!.id;
    // The row is another's when the create runs, so the create is refused; it is gone again when the owner is looked up.
    inTheGap(db, 'create', () => db.boxes.push(rowOf(A, other, 'theirs')));
    inTheGap(db, 'findUnique', () => db.boxes.splice(0, db.boxes.length));
    const res = await put(app, first, [box(A, 'mine')]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: true }]);
    expect(db.boxes).toEqual([expect.objectContaining({ id: A, writerDeviceId: db.devices[0]!.id, ciphertext: 'mine' })]);
  });

  it('answers taken when a box keeps changing hands under one write, rather than looping', async () => {
    const { app, db } = world();
    const first = await register(app);
    await register(app);
    const other = db.devices[1]!.id;
    // Every attempt to make it finds it already made, and every look at its owner finds it gone.
    const table = db.prisma.buddyBox as unknown as Record<string, (args: unknown) => Promise<unknown>>;
    const realCreate = table.create!;
    const realFindUnique = table.findUnique!;
    table.create = async (args) => {
      db.boxes.push(rowOf(A, other, 'theirs'));
      return realCreate(args);
    };
    table.findUnique = async () => {
      db.boxes.splice(0, db.boxes.length);
      return null;
    };
    const res = await put(app, first, [box(A, 'mine')]);
    table.create = realCreate;
    table.findUnique = realFindUnique;
    expect(res.statusCode).toBe(200);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }]);
  });

  /**
   * A link answers once (R22). Its invite and reply boxes are deleted by their
   * writers once the pairing is done, and an id that is free again could be
   * written by anyone holding the old link, under the inviter's name. So their
   * delete leaves the row, empty: it reads as no box, and nobody writes it again.
   */
  it('leaves an empty mark where an invite or a reply was, and deletes a pair box outright', async () => {
    const { app, db } = world();
    const first = await register(app);
    const second = await register(app);
    const C = 'C'.repeat(22);
    await put(app, first, [box(A, 'invite', 'invite'), box(B, 'reply', 'reply'), box(C, 'pair')]);
    const before = new Date('2026-01-01T00:00:00Z');
    for (const row of db.boxes) row.updatedAt = before;

    expect((await del(app, first, [A, B, C])).json()).toEqual({ ok: true });
    expect(db.boxes.map((b) => [b.id, b.kind, b.ciphertext])).toEqual([[A, 'invite', ''], [B, 'reply', '']]);
    // Dated now, so the sweep keeps it its whole 120 days.
    for (const row of db.boxes) expect(row.updatedAt.getTime()).toBeGreaterThan(before.getTime());

    // It reads as a box that is not there.
    expect(((await read(app, second, [A, B, C])).json() as ReadBuddyBoxesResponse).boxes).toEqual([
      { id: A, ciphertext: null, updatedAt: null },
      { id: B, ciphertext: null, updatedAt: null },
      { id: C, ciphertext: null, updatedAt: null },
    ]);
    // And nobody writes it again: not another phone with the old link, not its own writer.
    const again = await put(app, second, [box(A, 'forged', 'invite'), box(B, 'forged', 'reply')]);
    expect((again.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }, { id: B, ok: false, error: 'taken' }]);
    const own = await put(app, first, [box(A, 'again', 'invite'), box(C, 'newpair')]);
    expect((own.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }, { id: C, ok: true }]);
    expect(db.boxes.find((b) => b.id === A)?.ciphertext).toBe('');

    // A second delete leaves the mark as it was, and another device's delete touches nothing.
    const marked = db.boxes.find((b) => b.id === A)!.updatedAt;
    await del(app, first, [A]);
    await del(app, second, [B]);
    expect(db.boxes.find((b) => b.id === A)!.updatedAt).toBe(marked);
    expect(db.boxes.map((b) => b.id)).toEqual([A, B, C]);
  });

  it('takes an invite the sweep emptied for a used link: taken to its writer, which is still there, and to everyone else', async () => {
    const { app, db } = world();
    const first = await register(app);
    const second = await register(app);
    await put(app, first, [box(A, 'invite', 'invite'), box(B, 'reply', 'reply')]);
    // What `runTick` does to an invite or a reply nobody answered in a week (`sync/tick.ts`, its own test): empties it, dates it now.
    for (const row of db.boxes) Object.assign(row, { ciphertext: '', updatedAt: new Date() });

    expect(((await read(app, second, [A, B])).json() as ReadBuddyBoxesResponse).boxes.map((b) => b.ciphertext)).toEqual([null, null]);
    const results = (res: { json(): unknown }) => (res.json() as PutBuddyBoxesResponse).results;
    expect(results(await put(app, second, [box(A, 'forged', 'invite'), box(B, 'forged', 'reply')]))).toEqual([
      { id: A, ok: false, error: 'taken' },
      { id: B, ok: false, error: 'taken' },
    ]);
    // The writer's own write, as an invitee's retried answer would be, is refused too: it has to end, not loop.
    expect(results(await put(app, first, [box(A, 'again', 'invite'), box(B, 'again', 'reply')]))).toEqual([
      { id: A, ok: false, error: 'taken' },
      { id: B, ok: false, error: 'taken' },
    ]);
    expect(db.boxes.map((b) => b.ciphertext)).toEqual(['', '']);
  });

  it('does not count the marks toward the boxes a device may write', async () => {
    const { app, db } = world();
    const token = await register(app);
    const ids = Array.from({ length: BUDDY_BOXES_PER_DEVICE }, (_, i) => boxId(i));
    for (let from = 0; from < ids.length; from += BUDDY_PUT_MAX) {
      await put(app, token, ids.slice(from, from + BUDDY_PUT_MAX).map((id) => box(id, 'abc', 'invite')));
    }
    for (let from = 0; from < ids.length; from += BUDDY_READ_MAX) await del(app, token, ids.slice(from, from + BUDDY_READ_MAX));
    expect(db.boxes.every((b) => b.ciphertext === '')).toBe(true);
    // Every invite this phone made would otherwise hold a place for 120 days.
    const res = await put(app, token, [box(boxId(500), 'abc', 'invite')]);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: boxId(500), ok: true }]);
  });

  it('does not bring back a box its writer emptied while the write was on its way', async () => {
    const { app, db } = world();
    const token = await register(app);
    await put(app, token, [box(A, 'mine', 'invite')]);
    inTheGap(db, WRITE, () => {
      const row = db.boxes.find((b) => b.id === A)!;
      row.ciphertext = '';
    });
    const res = await put(app, token, [box(A, 'replacement', 'invite')]);
    expect((res.json() as PutBuddyBoxesResponse).results).toEqual([{ id: A, ok: false, error: 'taken' }]);
    expect(db.boxes.find((b) => b.id === A)?.ciphertext).toBe('');
  });

  it("deletes a device's pair boxes with the device, and leaves another device's alone", async () => {
    const { app, db } = world();
    const leaving = await register(app);
    const staying = await register(app);
    await put(app, leaving, [box(A, 'gone soon')]);
    await put(app, staying, [box(B, 'stays')]);

    expect((await app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(leaving) })).statusCode).toBe(200);
    expect(db.boxes.map((b) => b.id)).toEqual([B]);
    const res = await read(app, staying, [A, B]);
    expect((res.json() as ReadBuddyBoxesResponse).boxes.map((b) => b.ciphertext)).toEqual([null, 'stays']);
  });

  /**
   * R27: a link answers once, and a device going does not free it. What the
   * device wrote as an invite or a reply stays, emptied and with no writer;
   * what it wrote as a pair box goes, and its id is free like any pair id.
   */
  describe('when the device that wrote a used link goes', () => {
    const X = 'X'.repeat(22);
    const P = 'P'.repeat(22);
    const R = 'R'.repeat(22);
    const leave = (app: App, token: string) => app.inject({ method: 'DELETE', url: '/v2/device', headers: auth(token) });
    const reading = async (app: App, token: string, id: string) => ((await read(app, token, [id])).json() as ReadBuddyBoxesResponse).boxes[0];
    const putting = async (app: App, token: string, ...boxes: ReturnType<typeof box>[]) =>
      ((await put(app, token, boxes)).json() as PutBuddyBoxesResponse).results;

    it('keeps the mark of an invite its writer had already deleted, and nobody writes the link again', async () => {
      const { app, db } = world();
      const inviter = await register(app);
      const phone = await register(app);
      await put(app, inviter, [box(X, 'invite', 'invite')]);
      await del(app, inviter, [X]);
      expect(db.boxes).toEqual([expect.objectContaining({ id: X, kind: 'invite', ciphertext: '' })]);

      expect((await leave(app, inviter)).statusCode).toBe(200);
      expect(db.devices).toHaveLength(1);
      // The row is still there, with no writer.
      expect(db.boxes).toEqual([expect.objectContaining({ id: X, kind: 'invite', ciphertext: '', writerDeviceId: null })]);

      expect(await putting(app, phone, box(X, 'forged', 'invite'))).toEqual([{ id: X, ok: false, error: 'taken' }]);
      expect(await reading(app, phone, X)).toEqual({ id: X, ciphertext: null, updatedAt: null });
      expect(db.boxes).toEqual([expect.objectContaining({ id: X, ciphertext: '', writerDeviceId: null })]);
    });

    it('empties a live invite and a live reply, deletes a pair box, and then the link and the pair id differ', async () => {
      const { app, db } = world();
      const leaving = await register(app);
      const phone = await register(app);
      await put(app, leaving, [box(X, 'invite', 'invite'), box(R, 'reply', 'reply'), box(P, 'pair')]);
      const before = new Date('2026-01-01T00:00:00Z');
      for (const row of db.boxes) row.updatedAt = before;

      expect((await leave(app, leaving)).statusCode).toBe(200);
      // Marks, with no writer and a fresh date (the sweep keeps one 120 days from when it was made); the pair box is gone.
      expect(db.boxes.map((b) => [b.id, b.kind, b.ciphertext, b.writerDeviceId])).toEqual([[X, 'invite', '', null], [R, 'reply', '', null]]);
      for (const row of db.boxes) expect(row.updatedAt.getTime()).toBeGreaterThan(before.getTime());

      expect(await reading(app, phone, X)).toEqual({ id: X, ciphertext: null, updatedAt: null });
      expect(await reading(app, phone, R)).toEqual({ id: R, ciphertext: null, updatedAt: null });
      expect(await reading(app, phone, P)).toEqual({ id: P, ciphertext: null, updatedAt: null });
      // The links are used for good; a pair id is no link, and is free like any pair id (spec 4.3: only a link's boxes stay).
      expect(await putting(app, phone, box(X, 'forged', 'invite'), box(R, 'forged', 'reply'))).toEqual([
        { id: X, ok: false, error: 'taken' },
        { id: R, ok: false, error: 'taken' },
      ]);
      expect(await putting(app, phone, box(P, 'fresh'))).toEqual([{ id: P, ok: true }]);
      expect(db.boxes.map((b) => [b.id, b.writerDeviceId])).toEqual([[X, null], [R, null], [P, db.devices[0]!.id]]);
    });

    it('leaves the live boxes of another device, and its own marks, as they were', async () => {
      const { app, db } = world();
      const leaving = await register(app);
      const staying = await register(app);
      await put(app, staying, [box(X, 'invite', 'invite'), box(P, 'pair')]);
      await put(app, leaving, [box(R, 'reply', 'reply')]);

      await leave(app, leaving);
      expect(db.boxes.map((b) => [b.id, b.ciphertext, b.writerDeviceId])).toEqual([
        [X, 'invite', db.devices[0]!.id],
        [P, 'pair', db.devices[0]!.id],
        [R, '', null],
      ]);
    });

    /**
     * A row with no writer is a mark, but a device's delete does not rest on that: after its own
     * row goes it settles every live row with no writer, so that one which got there some other
     * way is a mark too, as the invariant says (and a `pair` box of nobody's is deleted).
     */
    it('settles the live boxes that have no writer when any device is deleted', async () => {
      const { app, db } = world();
      const leaving = await register(app);
      const staying = await register(app);
      const M = 'M'.repeat(22);
      const orphan = (id: string, kind: string, ciphertext = 'content'): BoxRow => ({ ...rowOf(id, 'x', ciphertext), writerDeviceId: null, kind });
      const before = new Date('2026-01-01T00:00:00Z');
      db.boxes.push(orphan(P, 'pair'), orphan(X, 'invite'), orphan(R, 'reply'), orphan(M, 'reply', ''));
      for (const row of db.boxes) row.updatedAt = before;
      await put(app, staying, [box(boxId(1), 'abc', 'invite'), box(boxId(2), 'abc')]);

      // The device that goes wrote none of them.
      expect((await leave(app, leaving)).statusCode).toBe(200);
      const left = db.boxes.map((b) => [b.id, b.kind, b.ciphertext, b.writerDeviceId]);
      const stayer = db.devices[0]!.id;
      expect(left).toEqual([[X, 'invite', '', null], [R, 'reply', '', null], [M, 'reply', '', null], [boxId(1), 'invite', 'abc', stayer], [boxId(2), 'pair', 'abc', stayer]]);
      // Emptied now, so a mark lives 120 days from here; the one that was a mark is left as it was dated.
      expect(db.boxes.find((b) => b.id === X)!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
      expect(db.boxes.find((b) => b.id === R)!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
      expect(db.boxes.find((b) => b.id === M)!.updatedAt).toBe(before);
      expect(await reading(app, staying, P)).toEqual({ id: P, ciphertext: null, updatedAt: null });
      expect(await putting(app, staying, box(X, 'forged', 'invite'))).toEqual([{ id: X, ok: false, error: 'taken' }]);
    });

    it('settles a box the device wrote while it was leaving, once its row is gone', async () => {
      const { app, db } = world();
      const leaving = await register(app);
      await register(app);
      const gone = db.devices[0]!.id;
      // Its own `PUT` commits after its boxes were settled and before its row goes: the delete clears
      // the writer, and leaves a live invite and a live pair box that nobody could change or delete.
      const device = db.prisma.device;
      const realDelete = device.delete;
      device.delete = async (args) => {
        device.delete = realDelete;
        db.boxes.push({ ...rowOf(P, gone, 'late'), kind: 'pair' }, { ...rowOf(X, gone, 'late'), kind: 'invite' });
        return realDelete(args);
      };
      expect((await leave(app, leaving)).statusCode).toBe(200);
      expect(db.boxes.map((b) => [b.id, b.kind, b.ciphertext, b.writerDeviceId])).toEqual([[X, 'invite', '', null]]);
    });

    it('does not let the same phone write its old link again after it registers anew', async () => {
      const { app, db } = world();
      const first = await register(app);
      await put(app, first, [box(X, 'invite', 'invite'), box(R, 'reply', 'reply')]);
      await del(app, first, [R]);
      await leave(app, first);

      // The app comes back with a new device (new token, new id) and the old state's link or reply.
      const again = await register(app);
      expect(db.devices).toHaveLength(1);
      expect(await putting(app, again, box(X, 'again', 'invite'), box(R, 'again', 'reply'))).toEqual([
        { id: X, ok: false, error: 'taken' },
        { id: R, ok: false, error: 'taken' },
      ]);
      expect(db.boxes.map((b) => [b.id, b.ciphertext, b.writerDeviceId])).toEqual([[X, '', null], [R, '', null]]);
      // And the marks do not count toward the new device's boxes.
      expect(await putting(app, again, box(boxId(1), 'abc', 'invite'))).toEqual([{ id: boxId(1), ok: true }]);
    });

    /**
     * The invariant is that a row with no writer is a mark, so `used` says `taken`
     * for it. But `putBox` does not rest on that: a row with no writer and
     * content (which the invariant rules out) is `taken` too, whether it was read
     * at the start of the request or found when a create lost the race on its id.
     */
    it('answers taken to a row with no writer even when it is not emptied', async () => {
      const { app, db } = world();
      const token = await register(app);
      const stray = (id: string): BoxRow => ({ ...rowOf(id, 'x', 'content'), writerDeviceId: null, kind: 'invite' });
      db.boxes.push(stray(X));
      expect(await putting(app, token, box(X, 'mine', 'invite'))).toEqual([{ id: X, ok: false, error: 'taken' }]);
      expect(db.boxes.find((b) => b.id === X)).toMatchObject({ ciphertext: 'content', writerDeviceId: null });

      // Read as no row, made by the time of the create, and found with no writer when the owner is looked up.
      inTheGap(db, 'create', () => db.boxes.push(stray(R)));
      expect(await putting(app, token, box(R, 'mine', 'invite'))).toEqual([{ id: R, ok: false, error: 'taken' }]);
      expect(db.boxes.find((b) => b.id === R)).toMatchObject({ ciphertext: 'content', writerDeviceId: null });
    });
  });
});
