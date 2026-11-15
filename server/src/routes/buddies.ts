/**
 * `/v2/buddies`: the friends feature's boxes (spec §5). A box is ciphertext
 * under an id that both friends derive from a secret the server never sees,
 * so the server cannot tell what a box holds or whose it is. What it does
 * know is which device wrote each box, and that is the whole of the access
 * rule: the first device to write an id owns it, anyone who knows the id can
 * read it, and only its writer can change or delete it. The table has no
 * column for a reader, and no route asks who is reading.
 *
 * A box answers once. A link's `invite` and `reply` boxes (one `reply` for each
 * person who answers it) are deleted by their writers once their work is done,
 * and an id that was free again could be written by anyone who still holds
 * the link, under the inviter's name. So the
 * delete of an `invite` or a `reply` empties it instead (`ciphertext` `''`,
 * which no `PUT` can write): the row stays, reads as no box, and is `taken` to
 * every device, its writer too, until the stale sweep takes it
 * (`BUDDY_BOX_STALE_DAYS`, `sync/tick.ts`). A `pair` box is deleted outright.
 *
 * That mark outlives the device and the week. A link nobody answered is emptied
 * by the sweep after `BUDDY_INVITE_TTL_DAYS`, as its writer's delete would have
 * emptied it, and a device's delete (`DELETE /v2/device`, `routes/devices.ts`)
 * empties its live `invite` and `reply` rows and deletes its `pair` rows before
 * the device goes (`settleBoxes`). The foreign key then only clears the writer
 * (`SetNull`), and what that leaves live with no writer (a box the device wrote
 * in the instant between its own settle and its delete) is settled by the same
 * delete, in the same transaction, once the row is gone. So a row with no
 * writer is always a mark: nothing in it, and `taken` to everyone.
 * A mark lives `BUDDY_BOX_STALE_DAYS` from when it was made, however it was made.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  BuddyBoxKind, DeleteBuddyBoxesBody, PutBuddyBoxesBody, PutBuddyBoxesResponse, ReadBuddyBoxesBody, ReadBuddyBoxesResponse,
} from '@sederyom/shared';
import { BUDDY_BOX_ID, BUDDY_BOXES_PER_DEVICE, BUDDY_PAIR_CIPHERTEXT_MAX, BUDDY_PUT_MAX, BUDDY_READ_MAX, buddyCiphertextMax } from '@sederyom/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

const boxId = z.string().regex(BUDDY_BOX_ID, 'expected 22 characters of base64url');
const kinds: [BuddyBoxKind, ...BuddyBoxKind[]] = ['invite', 'reply', 'pair'];

/**
 * What an emptied `invite` or `reply` holds: never a `PUT`'s, whose ciphertext is at least one character.
 * The mark is defined here, once: `USED` and `KEPT_WHEN_DELETED` for the sweep (`sync/tick.ts`), which
 * empties an expired box by its own predicate, and `settleBoxes` for the deletes of a box's writer and of a device.
 */
export const USED = '';

/** Kinds whose delete leaves an emptied row (`USED`) rather than none. */
export const KEPT_WHEN_DELETED: BuddyBoxKind[] = ['invite', 'reply'];

/**
 * The two writes that settle the live boxes `where` picks, for a delete: each `invite` or `reply`
 * among them still holding ciphertext is emptied into a mark and dated now, and each `pair` box is
 * deleted. Lazy Prisma promises, in that order: to run one after the other, or in a `$transaction`.
 */
export function settleBoxes(prisma: PrismaClient, where: Prisma.BuddyBoxWhereInput) {
  return [
    prisma.buddyBox.updateMany({
      where: { ...where, kind: { in: KEPT_WHEN_DELETED }, ciphertext: { not: USED } },
      data: { ciphertext: USED, updatedAt: new Date() },
    }),
    prisma.buddyBox.deleteMany({ where: { ...where, kind: 'pair' } }),
  ] as const;
}

/** Each box's ciphertext within what its kind may hold (`buddyCiphertextMax`); one over makes the whole request a 400. */
const putBody = z.object({
  boxes: z
    .array(
      z
        .object({
          id: boxId,
          kind: z.enum(kinds),
          ciphertext: z.string().min(1).max(BUDDY_PAIR_CIPHERTEXT_MAX).regex(/^[A-Za-z0-9_-]+$/, 'expected base64url'),
        })
        .superRefine((box, ctx) => {
          const max = buddyCiphertextMax(box.kind);
          if (box.ciphertext.length > max) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ciphertext'], message: `at most ${max} characters for a box of kind ${box.kind}` });
          }
        }),
    )
    .max(BUDDY_PUT_MAX),
});

/** Reading and deleting take the same list of ids. */
const idsBody = z.object({ ids: z.array(boxId).max(BUDDY_READ_MAX) });

/**
 * What a `PUT` may carry: `BUDDY_PUT_MAX` boxes of the longest ciphertext (a
 * pair box's), and a little for the JSON around each; about 0.8 MB, under
 * Fastify's default 1 MiB, and set here so that the number follows the caps.
 */
const PUT_BODY_LIMIT = BUDDY_PUT_MAX * (BUDDY_PAIR_CIPHERTEXT_MAX + 256);

function badRequest(reply: FastifyReply, error: string, message: string) {
  void reply.code(400);
  return { error, message };
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`;
}

/** A write that lost the race to create its id: Postgres refused a second row under it. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

type PutResult = PutBuddyBoxesResponse['results'][number];

export function registerBuddyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma } = deps.services;

  /**
   * One box: made when its id is new, replaced when this device wrote it, and
   * `taken` when another did, or when it is a used link's emptied box (`USED`),
   * whoever wrote it, or when it has no writer at all (its device is gone: such a
   * row is always an emptied box, so it is `taken` on both counts, and the answer
   * does not rest on one of them). A replacement keeps the box's `kind`: that is
   * fixed by what the box is for, and only the ciphertext is the writer's to change.
   * `writers` is who wrote each id the request names (`null` for a row whose
   * device is gone, no entry for no row), `used` the ids among them that are
   * emptied, and `held` how many live boxes this device writes; all follow the
   * request's own writes, so one id twice in a request is a write and then a
   * replacement.
   *
   * What was read about a box can be out of date by the time of the write: its
   * row deleted or emptied (by its writer, with its device, by the sweep) and
   * perhaps made again by another device. So no write rests on a read. A create
   * is the primary key's to refuse, and a replacement names this device as the
   * writer, and a box not emptied, in the write itself, so it changes nothing
   * that is not this device's live box. When either finds the read wrong, the
   * row is read again and the next pass acts on that; a box that keeps
   * changing hands answers `taken` after three passes instead of looping.
   */
  async function putBox(
    deviceId: string,
    box: PutBuddyBoxesBody['boxes'][number],
    state: { writers: Map<string, string | null>; used: Set<string>; held: number },
  ): Promise<PutResult> {
    const { id, ciphertext } = box;
    // `undefined`: no row. `null`: a row whose device is gone.
    let writer: string | null | undefined = state.writers.get(id);
    for (let pass = 0; pass < 3; pass++) {
      if (state.used.has(id)) {
        return { id, ok: false, error: 'taken' };
      } else if (writer === undefined) {
        if (state.held >= BUDDY_BOXES_PER_DEVICE) return { id, ok: false, error: 'too_many' };
        try {
          await prisma.buddyBox.create({ data: { id, writerDeviceId: deviceId, kind: box.kind, ciphertext } });
          state.writers.set(id, deviceId);
          state.held += 1;
          return { id, ok: true };
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      } else if (writer === null) {
        // No writer: a mark whose device is gone, nobody's to write.
        return { id, ok: false, error: 'taken' };
      } else if (writer === deviceId) {
        // `updatedAt` set here, not left to Prisma's `@updatedAt`: the sweep goes by it.
        const { count } = await prisma.buddyBox.updateMany({
          where: { id, writerDeviceId: deviceId, ciphertext: { not: USED } },
          data: { ciphertext, updatedAt: new Date() },
        });
        if (count > 0) return { id, ok: true };
      } else {
        return { id, ok: false, error: 'taken' };
      }
      // The read was wrong: the row is another's, or gone, or emptied, or this device's own request made it a moment ago.
      const row = await prisma.buddyBox.findUnique({ where: { id }, select: { writerDeviceId: true, ciphertext: true } });
      writer = row?.writerDeviceId;
      if (writer === undefined) state.writers.delete(id);
      else state.writers.set(id, writer);
      if (row?.ciphertext === USED) state.used.add(id);
    }
    return { id, ok: false, error: 'taken' };
  }

  app.put('/v2/buddies/boxes', { bodyLimit: PUT_BODY_LIMIT }, async (request, reply): Promise<PutBuddyBoxesResponse | { error: string; message: string }> => {
    const parsed = putBody.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'invalid_boxes', firstIssue(parsed.error));
    const body: PutBuddyBoxesBody = parsed.data;
    const deviceId = request.device!.id;
    const ids = body.boxes.map((b) => b.id);

    const [existing, used, held] = await Promise.all([
      prisma.buddyBox.findMany({ where: { id: { in: ids } }, select: { id: true, writerDeviceId: true } }),
      prisma.buddyBox.findMany({ where: { id: { in: ids }, ciphertext: USED }, select: { id: true } }),
      // A used link's emptied box holds no place: every invite a phone made would otherwise keep one for months.
      prisma.buddyBox.count({ where: { writerDeviceId: deviceId, ciphertext: { not: USED } } }),
    ]);
    const state = { writers: new Map(existing.map((b) => [b.id, b.writerDeviceId])), used: new Set(used.map((b) => b.id)), held };
    // One after the other, so that the cap counts the boxes this request has just made.
    const results: PutResult[] = [];
    for (const box of body.boxes) results.push(await putBox(deviceId, box, state));
    return { results };
  });

  /**
   * POST, so that the ids stay out of the URL and the logs that keep URLs. An
   * id that is no box, or a used link's emptied one, comes back as `null`.
   */
  app.post('/v2/buddies/read', async (request, reply): Promise<ReadBuddyBoxesResponse | { error: string; message: string }> => {
    const parsed = idsBody.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'invalid_ids', firstIssue(parsed.error));
    const body: ReadBuddyBoxesBody = parsed.data;
    const rows = await prisma.buddyBox.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, ciphertext: true, updatedAt: true },
    });
    const byId = new Map(rows.filter((r) => r.ciphertext !== USED).map((r) => [r.id, r]));
    return {
      boxes: body.ids.map((id) => {
        const row = byId.get(id);
        return { id, ciphertext: row?.ciphertext ?? null, updatedAt: row?.updatedAt.toISOString() ?? null };
      }),
    };
  });

  /**
   * Only what this device wrote goes. A `pair` box is deleted; an `invite` or
   * a `reply` is emptied (`USED`) and dated now, so its link cannot be used
   * again, and one already emptied is left as it is. An id that is another's,
   * or no box, is left alone and still answers `ok`: what is not there to
   * delete is as good as deleted.
   */
  app.delete('/v2/buddies/boxes', async (request, reply) => {
    const parsed = idsBody.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'invalid_ids', firstIssue(parsed.error));
    const body: DeleteBuddyBoxesBody = parsed.data;
    // One after the other, as they are written: the promises are lazy, so the second starts when the first is done.
    for (const write of settleBoxes(prisma, { id: { in: body.ids }, writerDeviceId: request.device!.id })) await write;
    return { ok: true };
  });
}
