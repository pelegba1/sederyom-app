/**
 * Pairing friends by a link and keeping their boxes in step
 * (app/src/buddies/protocol.ts), and what a box may hold before any of it is
 * used (app/src/buddies/validate.ts). Phones are Maps; the server is kept in
 * memory and answers as `/v2/buddies` does: the first phone to write an id owns
 * it, only its writer replaces or deletes it, and an unknown id reads as `null`.
 */
import { describe, expect, it } from 'vitest';
import type { BuddyBoxContent, BuddyGradesContent, BuddyLesson, BuddyShares } from '@sederyom/shared';
import {
  BUDDY_BOX_ID, BUDDY_BOXES_PER_DEVICE, BUDDY_INVITE_TTL_DAYS, BUDDY_LINK_SLOTS, BUDDY_PAIR_CIPHERTEXT_MAX, BUDDY_PUT_MAX, BUDDY_READ_MAX, MAX_BUDDIES, buddyCiphertextMax,
} from '@sederyom/shared';
import type { BuddyServer, MyGrades } from '../../app/src/buddies/protocol';
import type { Buddy, PendingAnswer } from '../../app/src/buddies/store';

const {
  BUDDY_NOTES, acceptInvite, cancelInvites, createInvite, dropAllBoxes, isAnsweredHere, isOwnInvite, readInvite, removalClosesLink, removeBuddy, stopGrades, syncBuddies,
} = await import('../../app/src/buddies/protocol');
const { readBuddies, saveBuddies, theirSharesOf } = await import('../../app/src/buddies/store');
const { myBoxContent } = await import('../../app/src/buddies/content');
const { b64u, boxIdOf, keyOf, newKeyPair, newSecret, openSealed, replyLabel, seal, sealTo } = await import('../../app/src/buddies/crypto');
const { cleanBuddyName, isBuddyName, readBoxContent, readGradesContent, readInviteContent, readReplyContent } = await import('../../app/src/buddies/validate');

/** A name as the notes set it: in a first-strong isolate (U+2068 … U+2069). */
const iso = (name: string) => `${String.fromCharCode(0x2068)}${name}${String.fromCharCode(0x2069)}`;

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

interface Stored {
  writer: string;
  kind: string;
  ciphertext: string;
}

interface Call {
  phone: string;
  op: 'put' | 'read' | 'remove';
  ids: string[];
}

/**
 * `/v2/buddies` in memory. `as(phone)` is that phone's device; `seen` is every
 * id and ciphertext any phone sent, and `calls` every request. A request with
 * nothing in it, or more than the route takes, fails as a bug.
 *
 * `boxes` are the live ones. An invite or a reply its writer deleted is a
 * mark (`marks`), as the route empties it: it reads as no box, and every
 * device's write of its id is `taken` (R22).
 */
function fakeServer() {
  const boxes = new Map<string, Stored>();
  const marks = new Map<string, { writer: string; kind: string }>();
  const seen: string[] = [];
  const calls: Call[] = [];
  const check = (op: string, n: number, max: number) => {
    if (n === 0 || n > max) throw new Error(`${op} of ${n}`);
  };
  function as(phone: string): BuddyServer {
    return {
      async put(list) {
        check('put', list.length, BUDDY_PUT_MAX);
        calls.push({ phone, op: 'put', ids: list.map((b) => b.id) });
        const results = list.map((box) => {
          seen.push(box.id, box.ciphertext);
          if (!BUDDY_BOX_ID.test(box.id) || !/^[A-Za-z0-9_-]+$/.test(box.ciphertext)) throw new Error('not a box');
          // The route answers a box over its kind's cap with a 400 for the whole request.
          if (box.ciphertext.length > buddyCiphertextMax(box.kind)) throw new Error(`a ${box.kind} box of ${box.ciphertext.length}`);
          const was = boxes.get(box.id);
          if (marks.has(box.id) || (was && was.writer !== phone)) return { id: box.id, ok: false, error: 'taken' as const };
          if (!was && [...boxes.values()].filter((b) => b.writer === phone).length >= BUDDY_BOXES_PER_DEVICE) {
            return { id: box.id, ok: false, error: 'too_many' as const };
          }
          boxes.set(box.id, { writer: phone, kind: was?.kind ?? box.kind, ciphertext: box.ciphertext });
          return { id: box.id, ok: true };
        });
        return { results };
      },
      async read(ids) {
        check('read', ids.length, BUDDY_READ_MAX);
        calls.push({ phone, op: 'read', ids: [...ids] });
        seen.push(...ids);
        return { boxes: ids.map((id) => ({ id, ciphertext: boxes.get(id)?.ciphertext ?? null, updatedAt: boxes.has(id) ? '2026-09-01T07:00:00.000Z' : null })) };
      },
      async remove(ids) {
        check('remove', ids.length, BUDDY_READ_MAX);
        calls.push({ phone, op: 'remove', ids: [...ids] });
        seen.push(...ids);
        for (const id of ids) {
          const was = boxes.get(id);
          if (was?.writer !== phone) continue;
          boxes.delete(id);
          if (was.kind !== 'pair') marks.set(id, { writer: phone, kind: was.kind });
        }
      },
    };
  }
  const puts = (phone: string) => calls.filter((c) => c.phone === phone && c.op === 'put').length;
  /**
   * The sweep's turn on an invite or a reply nobody answered in a week (R28): emptied into a mark, not
   * deleted, so its link stays used. A pair box is left, as the sweep leaves it at that age.
   */
  const expire = (id: string) => {
    const was = boxes.get(id);
    if (!was || was.kind === 'pair') return;
    boxes.delete(id);
    marks.set(id, { writer: was.writer, kind: was.kind });
  };
  return { boxes, marks, seen, calls, as, puts, expire };
}

type Server = ReturnType<typeof fakeServer>;

/** A phone with a name chosen, and nobody yet. */
function phone(server: Server, device: string, name: string) {
  const kv = memoryKv();
  saveBuddies(kv, { myName: name, buddies: [], invites: [], answers: [], unseen: false, notes: [] });
  return { kv, server: server.as(device), name };
}

// Tuesday 1.9.2026, 10:00 in Jerusalem.
const NOW = new Date('2026-09-01T10:00:00+03:00');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const PELEG: BuddyShares = { timetable: true, absences: false };
const NOA: BuddyShares = { timetable: true, absences: true };

/** My box as the stub builds it: no lessons, so only the name and the shares can change it. */
const mine = (name: string, at: Date) => (shares: BuddyShares): BuddyBoxContent => ({ v: 1, at: at.toISOString(), name, shares });

/**
 * An invite as an app from before links took several answers made it, on the server and on the phone: nothing says how
 * many may answer, so it ends with its first. Also for tests about the friendship that follows, which have no use for a
 * link left open.
 */
async function oneAnswerInvite(a: ReturnType<typeof phone>, shares: BuddyShares = PELEG, at: Date = NOW): Promise<string> {
  const secret = newSecret();
  const keys = newKeyPair();
  const ciphertext = seal({ v: 1, name: a.name, shares, inviterKey: keys.publicKey }, keyOf(secret));
  expect((await a.server.put([{ id: boxIdOf(secret, 'invite'), kind: 'invite', ciphertext }])).results[0]).toMatchObject({ ok: true });
  const state = readBuddies(a.kv);
  saveBuddies(a.kv, { ...state, invites: [...state.invites, { secret, secretKey: keys.secretKey, shares, createdAt: at.toISOString() }] });
  return secret;
}

/** A link as this app makes it. */
async function openLink(a: ReturnType<typeof phone>, at: Date = NOW): Promise<string> {
  const secret = await createInvite(a.kv, a.server, PELEG, at);
  if (secret === 'full') throw new Error('full');
  return secret;
}

/** פלג (A) invites נועה (B), and נועה accepts; neither phone has synced since. */
async function paired(link: (a: ReturnType<typeof phone>) => Promise<string> = openLink) {
  const server = fakeServer();
  const a = phone(server, 'A', 'פלג');
  const b = phone(server, 'B', 'נועה');
  const secret = await link(a);
  expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('ok');
  const pair = readBuddies(b.kv).buddies[0]!.secret;
  return { server, a, b, secret, pair };
}

const sync = (p: ReturnType<typeof phone>, at: Date) => syncBuddies(p.kv, p.server, mine(p.name, at), at);

describe('pairing by one link', () => {
  it('pairs two phones through one link', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');

    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (secret === 'full') return;
    expect(readBuddies(a.kv).invites).toEqual([expect.objectContaining({ secret, shares: PELEG, createdAt: NOW.toISOString() })]);
    expect(server.boxes.get(boxIdOf(secret, 'invite'))?.kind).toBe('invite');

    expect(await readInvite(b.server, secret)).toEqual({ name: 'פלג', shares: PELEG });
    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('ok');
    const [ofB] = readBuddies(b.kv).buddies;
    expect(ofB).toMatchObject({ role: 'invitee', name: 'פלג', label: '', shares: NOA, theirs: null, everRead: false, addedAt: NOW.toISOString() });
    const pair = ofB!.secret;
    expect(pair).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair).not.toBe(secret);
    expect(server.boxes.get(boxIdOf(secret, 'reply'))?.kind).toBe('reply');
    expect(server.boxes.get(boxIdOf(pair, 'b2a'))?.kind).toBe('pair');

    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
    const stateA = readBuddies(a.kv);
    // The link stays open for whoever answers next.
    expect(stateA.invites).toEqual([expect.objectContaining({ secret, repliesRead: [boxIdOf(secret, 'reply')] })]);
    expect(stateA.buddies).toHaveLength(1);
    expect(stateA.buddies[0]).toMatchObject({
      role: 'inviter', secret: pair, name: 'נועה', label: '', shares: PELEG, everRead: true,
      theirs: { v: 1, at: NOW.toISOString(), name: 'נועה', shares: NOA }, readAt: NOW.toISOString(), addedAt: later(5).toISOString(),
    });
    expect(stateA.unseen).toBe(true);
    expect(stateA.notes).toEqual([`${iso('נועה')} עכשיו ברשימת החברים שלך`]);
    // Both phones know the friendship by one handle: the first 8 characters of the a2b box's id.
    expect(stateA.buddies[0]!.id).toBe(boxIdOf(pair, 'a2b').slice(0, 8));
    expect(ofB!.id).toBe(stateA.buddies[0]!.id);
    expect(server.boxes.has(boxIdOf(secret, 'invite'))).toBe(true);
    expect(server.boxes.get(boxIdOf(pair, 'a2b'))?.kind).toBe('pair');

    expect(await sync(b, later(10))).toEqual({ accepted: [], ended: [] });
    const [after] = readBuddies(b.kv).buddies;
    expect(after).toMatchObject({ everRead: true, theirs: { v: 1, at: later(5).toISOString(), name: 'פלג', shares: PELEG }, readAt: later(5).toISOString() });
    expect(after!.replyId).toBeUndefined();
    // What is left on the server: one box each way, and the link, open; B's answer has done its work.
    expect(server.boxes.has(boxIdOf(secret, 'reply'))).toBe(false);
    expect([...server.boxes.keys()].sort()).toEqual([boxIdOf(secret, 'invite'), boxIdOf(pair, 'a2b'), boxIdOf(pair, 'b2a')].sort());
  });

  it('sends no secret to the server', async () => {
    const { server, a, b, secret, pair } = await paired();
    const { secretKey } = readBuddies(a.kv).invites[0]!;
    await sync(a, later(5));
    await sync(b, later(10));
    await sync(a, later(70));
    await sync(b, later(70));
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    await sync(b, later(80));
    // Every id went as 22 base64url characters and every request within the route's limits: the fake throws otherwise.
    expect(server.seen.length).toBeGreaterThan(10);
    for (const sent of server.seen) {
      for (const hidden of [secret, pair, secretKey, 'פלג', 'נועה']) expect(sent).not.toContain(hidden);
    }
  });

  it('refuses a forwarded link after it was used, when an older app made it', async () => {
    const { server, a, secret } = await paired(oneAnswerInvite);
    const c = phone(server, 'C', 'שירה');
    const before = readBuddies(c.kv);

    expect(await readInvite(c.server, secret)).toBe('used');
    expect(await acceptInvite(c.kv, c.server, secret, NOA, mine('שירה', NOW), NOW)).toBe('used');
    expect(readBuddies(c.kv)).toEqual(before);
    expect(server.puts('C')).toBe(0);

    // Once A has the answer, the invite box is gone, and so is the link.
    await sync(a, later(5));
    expect(await readInvite(c.server, secret)).toBe('gone');
    expect(await acceptInvite(c.kv, c.server, secret, NOA, mine('שירה', NOW), NOW)).toBe('gone');
    expect(readBuddies(c.kv)).toEqual(before);
    expect(readBuddies(a.kv).buddies.map((x) => x.name)).toEqual(['נועה']);
  });

  it('leaves a used link to nobody: a third phone cannot arm it again, before or after B has read A', async () => {
    const { server, a, b, secret } = await paired(oneAnswerInvite);
    const c = phone(server, 'C', 'שירה');
    // Whoever holds the link can seal a new invite under it, with any name and a key of their own.
    const forged = () => seal({ v: 1, name: 'פלג', shares: PELEG, inviterKey: newKeyPair().publicKey }, keyOf(secret));
    const rearm = async () => (await c.server.put([{ id: boxIdOf(secret, 'invite'), kind: 'invite', ciphertext: forged() }])).results[0];

    await sync(a, later(5));
    // A deleted the invite on pairing: it is a mark, so it reads gone and stays A's.
    expect(server.marks.get(boxIdOf(secret, 'invite'))).toEqual({ writer: 'A', kind: 'invite' });
    expect(await rearm()).toEqual({ id: boxIdOf(secret, 'invite'), ok: false, error: 'taken' });
    expect(await readInvite(c.server, secret)).toBe('gone');

    // B reads A and deletes its reply: a mark too; the link's answer cannot be written again either.
    await sync(b, later(10));
    expect(server.marks.get(boxIdOf(secret, 'reply'))).toEqual({ writer: 'B', kind: 'reply' });
    expect(await rearm()).toEqual({ id: boxIdOf(secret, 'invite'), ok: false, error: 'taken' });
    const answer = (await c.server.put([{ id: boxIdOf(secret, 'reply'), kind: 'reply', ciphertext: 'AAAA' }])).results[0];
    expect(answer).toEqual({ id: boxIdOf(secret, 'reply'), ok: false, error: 'taken' });
    expect(await readInvite(c.server, secret)).toBe('gone');
    expect(await acceptInvite(c.kv, c.server, secret, NOA, mine('שירה', NOW), NOW)).toBe('gone');

    // And after A ends the friendship, the link is still nobody's.
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    expect(await rearm()).toEqual({ id: boxIdOf(secret, 'invite'), ok: false, error: 'taken' });
    expect(await readInvite(c.server, secret)).toBe('gone');
    expect([...server.boxes.values()].some((x) => x.writer === 'C')).toBe(false);
  });

  it('answers used when another phone answers first on an older app\'s link, and keeps nothing', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const c = phone(server, 'C', 'שירה');
    const secret = await oneAnswerInvite(a);
    const before = readBuddies(c.kv);
    // C reads the invite while it is free; B answers before C writes.
    const racing: BuddyServer = {
      ...c.server,
      read: async (ids) => {
        const found = await c.server.read(ids);
        expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('ok');
        return found;
      },
    };
    expect(await acceptInvite(c.kv, racing, secret, NOA, mine('שירה', NOW), NOW)).toBe('used');
    expect(readBuddies(c.kv)).toEqual(before);
    // C wrote only the answer it lost: no box of its own for a friend it never got.
    expect(server.calls.filter((x) => x.phone === 'C' && x.op === 'put').map((x) => x.ids)).toEqual([[boxIdOf(secret, 'reply')]]);
    expect([...server.boxes.values()].some((x) => x.writer === 'C')).toBe(false);
    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
  });

  it('says an expired link is gone', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const old = await createInvite(a.kv, a.server, PELEG, daysAgo(8));
    const fresh = await createInvite(a.kv, a.server, PELEG, daysAgo(6));
    if (old === 'full' || fresh === 'full') throw new Error('full');

    expect(await sync(a, NOW)).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).invites.map((i) => i.secret)).toEqual([fresh]);
    expect(server.boxes.has(boxIdOf(old, 'invite'))).toBe(false);
    expect(server.boxes.has(boxIdOf(fresh, 'invite'))).toBe(true);

    expect(await readInvite(b.server, old)).toBe('gone');
    expect(await acceptInvite(b.kv, b.server, old, NOA, mine('נועה', NOW), NOW)).toBe('gone');
    expect(readBuddies(b.kv).buddies).toEqual([]);
  });

  it('still pairs on an answer that came before the link ran out', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, daysAgo(7.5));
    if (secret === 'full') throw new Error('full');
    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', daysAgo(1)), daysAgo(1))).toBe('ok');
    expect(await sync(a, NOW)).toEqual({ accepted: ['נועה'], ended: [] });
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(server.boxes.has(boxIdOf(secret, 'invite'))).toBe(false);
  });

  it('says a link that is not a secret is gone, without asking the server', async () => {
    const server = fakeServer();
    const b = phone(server, 'B', 'נועה');
    for (const secret of ['', 'abc', 'A'.repeat(27)]) {
      expect(await readInvite(b.server, secret)).toBe('gone');
      expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('gone');
    }
    expect(server.calls).toEqual([]);
  });

  it('stops at twenty', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const c = phone(server, 'C', 'שירה');
    const invite = await createInvite(c.kv, c.server, NOA, NOW);
    if (invite === 'full') throw new Error('full');
    const before = server.calls.length;

    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies: Array.from({ length: MAX_BUDDIES }, (_, i) => buddy(`b${i}`)) });
    expect(await createInvite(a.kv, a.server, PELEG, NOW)).toBe('full');
    expect(await acceptInvite(a.kv, a.server, invite, PELEG, mine('פלג', NOW), NOW)).toBe('full');

    // Pending invites count too.
    const state = readBuddies(a.kv);
    saveBuddies(a.kv, { ...state, buddies: state.buddies.slice(1), invites: [{ secret: newSecret(), secretKey: newKeyPair().secretKey, shares: PELEG, createdAt: NOW.toISOString() }] });
    expect(await createInvite(a.kv, a.server, PELEG, NOW)).toBe('full');
    expect(await acceptInvite(a.kv, a.server, invite, PELEG, mine('פלג', NOW), NOW)).toBe('full');
    expect(server.calls.length).toBe(before);
    expect(readBuddies(a.kv).buddies).toHaveLength(MAX_BUDDIES - 1);
  });

  it('asks for a name before a link is made or answered', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', '');
    const b = phone(server, 'B', 'נועה');
    await expect(createInvite(a.kv, a.server, PELEG, NOW)).rejects.toThrow();
    const secret = await createInvite(b.kv, b.server, NOA, NOW);
    if (secret === 'full') throw new Error('full');
    const before = server.calls.length;
    await expect(acceptInvite(a.kv, a.server, secret, PELEG, mine('', NOW), NOW)).rejects.toThrow();
    expect(server.calls.length).toBe(before);
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [] });
  });
});

/** `device`, whose next `n` writes reach the server and then lose their answer, as a timeout on a phone does. */
function losing(device: BuddyServer, n = 1): BuddyServer {
  let left = n;
  return {
    ...device,
    put: async (boxes) => {
      const answer = await device.put(boxes);
      if (left > 0) {
        left -= 1;
        throw new Error('timed out');
      }
      return answer;
    },
  };
}

/** `device`, whose next write never reaches the server. */
function failing(device: BuddyServer): BuddyServer {
  let failed = false;
  return {
    ...device,
    put: async (boxes) => {
      if (failed) return device.put(boxes);
      failed = true;
      throw new Error('offline');
    },
  };
}

/** The ids of the boxes `writer` holds on the server. */
const heldBy = (server: Server, writer: string) => [...server.boxes].filter(([, box]) => box.writer === writer).map(([id]) => id).sort();

describe('one link, several friends', () => {
  const NAMES = ['נועה', 'שירה', 'יואב'];
  const reply = (secret: string, slot: number) => boxIdOf(secret, replyLabel(slot));
  const putsOf = (server: Server, who: string) => server.calls.filter((c) => c.phone === who && c.op === 'put').flatMap((c) => c.ids);
  const answer = (p: ReturnType<typeof phone>, secret: string, device = p.server) => acceptInvite(p.kv, device, secret, NOA, mine(p.name, NOW), NOW);

  async function link() {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const [b, c, d] = NAMES.map((name, i) => phone(server, `P${i}`, name)) as [ReturnType<typeof phone>, ReturnType<typeof phone>, ReturnType<typeof phone>];
    return { server, a, b, c, d, secret: await openLink(a) };
  }

  it('makes a friend of each person who answers it, each with a secret of their own', async () => {
    const { server, a, b, c, d, secret } = await link();
    for (const p of [b, c, d]) {
      expect(await readInvite(p.server, secret)).toEqual({ name: 'פלג', shares: PELEG });
      expect(await answer(p, secret)).toBe('ok');
    }
    expect(await sync(a, later(5))).toEqual({ accepted: NAMES, ended: [] });
    for (const p of [b, c, d]) await sync(p, later(10));

    const friends = readBuddies(a.kv).buddies;
    expect(friends.map((x) => x.name)).toEqual(NAMES);
    expect(new Set(friends.map((x) => x.secret)).size).toBe(3);
    for (const p of [b, c, d]) expect(readBuddies(p.kv).buddies[0]).toMatchObject({ name: 'פלג', everRead: true, theirs: { name: 'פלג' } });
    // Each one's first-read reply is gone, and the link is still there for the next.
    for (const slot of [0, 1, 2]) expect(server.marks.has(reply(secret, slot))).toBe(true);
    expect(server.boxes.has(boxIdOf(secret, 'invite'))).toBe(true);
    // A later sync makes nobody a friend twice.
    expect(await sync(a, later(70))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).buddies).toHaveLength(3);
  });

  it('goes past the boxes used before, marks that read as free', async () => {
    const { server, a, b, c, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    await sync(a, later(5));
    await sync(b, later(10));
    expect(server.marks.has(reply(secret, 0))).toBe(true);

    expect(await answer(c, secret)).toBe('ok');
    expect(putsOf(server, 'P1').slice(0, 2)).toEqual([reply(secret, 0), reply(secret, 1)]);
    expect(await sync(a, later(15))).toEqual({ accepted: ['שירה'], ended: [] });
  });

  it('goes on to the next box when another phone answers first', async () => {
    const { server, a, b, c, secret } = await link();
    // C reads the link while the first box is free; B answers before C writes.
    const racing: BuddyServer = {
      ...c.server,
      read: async (ids) => {
        const found = await c.server.read(ids);
        expect(await answer(b, secret)).toBe('ok');
        return found;
      },
    };
    expect(await answer(c, secret, racing)).toBe('ok');
    expect(putsOf(server, 'P1').slice(0, 2)).toEqual([reply(secret, 0), reply(secret, 1)]);
    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה', 'שירה'], ended: [] });
  });

  it('writes a lost answer again to the box it went to, not to another', async () => {
    const { server, a, b, c, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    await expect(answer(c, secret, losing(c.server))).rejects.toThrow('timed out');
    expect(readBuddies(c.kv).answers[0]).toMatchObject({ replyId: reply(secret, 1) });

    expect(isAnsweredHere(c.kv, secret)).toBe(true);
    expect(await answer(c, secret)).toBe('ok');
    expect(server.boxes.has(reply(secret, 2))).toBe(false);
    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה', 'שירה'], ended: [] });
  });

  it('a person who answered and opens it again stays one friend, also after the first update', async () => {
    const { server, a, b, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    await sync(a, later(5));
    await sync(b, later(10));
    expect(readBuddies(b.kv).buddies[0]!.replyId).toBeUndefined();
    const puts = server.puts('P0');

    expect(isAnsweredHere(b.kv, secret)).toBe(true);
    expect(await answer(b, secret)).toBe('ok');
    expect(server.puts('P0')).toBe(puts);
    expect(readBuddies(b.kv).buddies).toHaveLength(1);
    expect(await sync(a, later(70))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).buddies).toHaveLength(1);
  });

  it('removing a friend who came by it closes it, or they could answer it again', async () => {
    const { server, a, b, c, d, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    expect(await answer(c, secret)).toBe('ok');
    await sync(a, later(5));
    await sync(b, later(10));

    const noa = readBuddies(a.kv).buddies.find((x) => x.name === 'נועה')!;
    // The sheet that asks says so; B's own phone has no link to close.
    expect(removalClosesLink(readBuddies(a.kv), noa)).toBe(true);
    expect(removalClosesLink(readBuddies(b.kv), readBuddies(b.kv).buddies[0]!)).toBe(false);
    await removeBuddy(a.kv, a.server, noa.id);
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(server.marks.has(boxIdOf(secret, 'invite'))).toBe(true);
    await sync(b, later(15));
    expect(readBuddies(b.kv).buddies).toEqual([]);
    expect(await readInvite(b.server, secret)).toBe('gone');
    expect(await answer(b, secret)).toBe('gone');
    expect(await answer(d, secret)).toBe('gone');
    // The other friend stays.
    expect(await sync(a, later(20))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).buddies.map((x) => x.name)).toEqual(['שירה']);
  });

  it('leaves another open link alone when a friend who came by a different one is removed', async () => {
    const { a, b, secret } = await link();
    const other = await openLink(a);
    expect(await answer(b, secret)).toBe('ok');
    await sync(a, later(5));
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    expect(readBuddies(a.kv).invites.map((i) => i.secret)).toEqual([other]);
  });

  it('closing it keeps the friends who answered', async () => {
    const { a, b, c, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    await sync(a, later(5));
    await cancelInvites(a.kv, a.server);
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(readBuddies(a.kv).buddies.map((x) => x.name)).toEqual(['נועה']);
    expect(await readInvite(c.server, secret)).toBe('gone');
    // Nothing is left for a removal to close.
    expect(removalClosesLink(readBuddies(a.kv), readBuddies(a.kv).buddies[0]!)).toBe(false);
  });

  it('my own link, closed and opened again, is gone: I never answered it', async () => {
    const { server, a, b, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    await sync(a, later(5));
    await cancelInvites(a.kv, a.server);
    const puts = server.puts('A');

    expect(isOwnInvite(a.kv, secret)).toBe(false);
    expect(isAnsweredHere(a.kv, secret)).toBe(false);
    expect(await answer(a, secret)).toBe('gone');
    expect(server.puts('A')).toBe(puts);
    expect(readBuddies(a.kv).buddies).toHaveLength(1);
  });

  it('runs out after its days, taking in the answers that came in time', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const [b, c] = NAMES.map((name, i) => phone(server, `P${i}`, name)) as [ReturnType<typeof phone>, ReturnType<typeof phone>];
    const secret = await openLink(a, daysAgo(BUDDY_INVITE_TTL_DAYS + 0.5));
    expect(await answer(b, secret)).toBe('ok');
    expect(await answer(c, secret)).toBe('ok');
    expect(await sync(a, NOW)).toEqual({ accepted: ['נועה', 'שירה'], ended: [] });
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(server.marks.has(boxIdOf(secret, 'invite'))).toBe(true);
  });

  it('takes only as many as there is room for: the link says so, and is full after them', async () => {
    const { server, a, b, c, d, secret: first } = await link();
    await cancelInvites(a.kv, a.server);
    expect(server.marks.has(boxIdOf(first, 'invite'))).toBe(true);
    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies: Array.from({ length: MAX_BUDDIES - 2 }, (_, i) => buddy(`b${i}`, { everRead: false, addedAt: NOW.toISOString() })) });

    const secret = await openLink(a);
    expect(readBuddies(a.kv).invites[0]).toMatchObject({ slots: 2 });
    expect(await answer(b, secret)).toBe('ok');
    expect(await answer(c, secret)).toBe('ok');
    expect(await readInvite(d.server, secret)).toBe('used');
    expect(await answer(d, secret)).toBe('used');
    expect(readBuddies(d.kv)).toMatchObject({ buddies: [], answers: [] });

    expect((await sync(a, later(5))).accepted).toEqual(['נועה', 'שירה']);
    expect(readBuddies(a.kv).buddies).toHaveLength(MAX_BUDDIES);
    // Every box taken in: the link is closed, and its place is free again.
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(await readInvite(d.server, secret)).toBe('gone');
  });

  it('closes when the friends fill up by another way, leaving an answer past the room unread', async () => {
    const { a, b, c, d, secret } = await link();
    for (const p of [b, c]) expect(await answer(p, secret)).toBe('ok');
    // Meanwhile the list came to one short of full.
    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies: Array.from({ length: MAX_BUDDIES - 1 }, (_, i) => buddy(`b${i}`, { everRead: false, addedAt: NOW.toISOString() })) });

    expect((await sync(a, later(5))).accepted).toEqual(['נועה']);
    expect(readBuddies(a.kv).buddies).toHaveLength(MAX_BUDDIES);
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(await readInvite(d.server, secret)).toBe('gone');
  });

  it('counts other open links toward the room', async () => {
    const { a, b, secret } = await link();
    const other = await openLink(a);
    expect(await answer(b, secret)).toBe('ok');
    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies: Array.from({ length: MAX_BUDDIES - 1 }, (_, i) => buddy(`b${i}`, { everRead: false, addedAt: NOW.toISOString() })) });
    // 19 friends and the other link's place: no room for the answer to this one.
    expect((await sync(a, later(5))).accepted).toEqual([]);
    expect(readBuddies(a.kv).invites.map((i) => i.secret)).toEqual([other]);
  });

  it('keeps what it needs across being saved: how many, the boxes taken in, the spare boxes', async () => {
    const { a, b, c, secret } = await link();
    expect(await answer(b, secret)).toBe('ok');
    await sync(a, later(5));
    expect(readBuddies(a.kv).invites[0]).toMatchObject({ slots: BUDDY_LINK_SLOTS, repliesRead: [reply(secret, 0)] });
    await expect(answer(c, secret, failing(c.server))).rejects.toThrow('offline');
    const [kept] = readBuddies(c.kv).answers;
    expect(kept).toMatchObject({ replyId: reply(secret, 1) });
    expect(kept!.spare).toHaveLength(BUDDY_LINK_SLOTS - 2);
    expect(kept!.spare![0]).toBe(reply(secret, 2));
  });

  it('an older app can still answer it, in the one box it knows', async () => {
    const { a, secret, server } = await link();
    const old = server.as('OLD');
    const invite = readInviteContent(openSealed<unknown>(server.boxes.get(boxIdOf(secret, 'invite'))!.ciphertext, keyOf(secret)))!;
    const sealed = sealTo({ v: 1, name: 'ותיק', shares: NOA, secret: newSecret() }, invite.inviterKey);
    expect((await old.put([{ id: boxIdOf(secret, 'reply'), kind: 'reply', ciphertext: sealed }])).results[0]).toMatchObject({ ok: true });
    expect(await sync(a, later(5))).toEqual({ accepted: ['ותיק'], ended: [] });
  });

  it('reads how many from an invite with care', () => {
    const base = { v: 1, name: 'פלג', shares: PELEG, inviterKey: newKeyPair().publicKey };
    expect(readInviteContent(base)).not.toHaveProperty('slots');
    expect(readInviteContent({ ...base, slots: 5 })).toMatchObject({ slots: 5 });
    expect(readInviteContent({ ...base, slots: 1_000_000 })).toMatchObject({ slots: BUDDY_LINK_SLOTS });
    for (const slots of [0, -1, 1.5, '3', null]) expect(readInviteContent({ ...base, slots })).not.toHaveProperty('slots');
  });
});

describe('an answer whose fate is not known, a double tap, my own link', () => {
  for (const aFirst of [true, false]) {
    it(`finishes an answer that reached the server, when the link is opened again (${aFirst ? 'after' : 'before'} A has seen it)`, async () => {
      const server = fakeServer();
      const a = phone(server, 'A', 'פלג');
      const b = phone(server, 'B', 'נועה');
      const secret = await createInvite(a.kv, a.server, PELEG, NOW);
      if (secret === 'full') throw new Error('full');

      await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('timed out');
      expect(readBuddies(b.kv).buddies).toEqual([]);
      expect(isAnsweredHere(b.kv, secret)).toBe(true);
      if (aFirst) expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });

      expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', later(6)), later(6))).toBe('ok');
      if (!aFirst) expect(await sync(a, later(7))).toEqual({ accepted: ['נועה'], ended: [] });
      await sync(b, later(8));
      await sync(a, later(9));

      const [ofA] = readBuddies(a.kv).buddies;
      const stateB = readBuddies(b.kv);
      expect(stateB.answers).toEqual([]);
      expect(stateB.buddies).toHaveLength(1);
      expect(stateB.buddies[0]).toMatchObject({ id: ofA!.id, secret: ofA!.secret, role: 'invitee', everRead: true, theirs: { name: 'פלג' } });
      expect(ofA).toMatchObject({ everRead: true, theirs: { name: 'נועה' } });
      // One box each way and the open link: no reply left behind, no box for a pairing nobody holds.
      expect([...server.boxes.keys()].sort()).toEqual([boxIdOf(secret, 'invite'), boxIdOf(ofA!.secret, 'a2b'), boxIdOf(ofA!.secret, 'b2a')].sort());
    });
  }

  it('finishes such an answer on the next sync, without the link', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow();

    expect(await sync(b, later(1))).toEqual({ accepted: ['פלג'], ended: [] });
    expect(readBuddies(b.kv)).toMatchObject({ answers: [], unseen: true, notes: [BUDDY_NOTES.accepted('פלג')] });
    expect(await sync(a, later(2))).toEqual({ accepted: ['נועה'], ended: [] });
    await sync(b, later(3));
    expect(readBuddies(b.kv).buddies[0]).toMatchObject({ everRead: true });
    expect(readBuddies(a.kv).buddies[0]).toMatchObject({ everRead: true });
    expect([...server.boxes.keys()]).toContain(boxIdOf(secret, 'invite'));
    expect(server.boxes.size).toBe(3);
  });

  it('drops an answer that never reached the server once its link is gone', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, daysAgo(8));
    if (secret === 'full') throw new Error('full');
    await expect(acceptInvite(b.kv, failing(b.server), secret, NOA, mine('נועה', daysAgo(1)), daysAgo(1))).rejects.toThrow('offline');
    expect(server.puts('B')).toBe(0);
    await sync(a, NOW);

    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('gone');
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], answers: [], notes: [] });
    expect(server.boxes.size).toBe(0);
  });

  it('keeps an answer that never reached the server, and sends it while the link is good', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    await expect(acceptInvite(b.kv, failing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('offline');
    expect(await sync(b, later(1))).toEqual({ accepted: ['פלג'], ended: [] });
    expect(await sync(a, later(2))).toEqual({ accepted: ['נועה'], ended: [] });
  });

  for (const refusal of ['a 500', 'an answer that leaves it out'] as const) it(`goes on with the rest of the sync past an answer the server keeps refusing (${refusal}), and drops that answer once its link is gone`, async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const c = phone(server, 'C', 'שירה');
    const b = phone(server, 'B', 'נועה');
    const fromA = await createInvite(a.kv, a.server, PELEG, NOW);
    const fromC = await createInvite(c.kv, c.server, PELEG, NOW);
    if (fromA === 'full' || fromC === 'full') throw new Error('full');
    await expect(acceptInvite(b.kv, failing(b.server), fromA, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('offline');
    await expect(acceptInvite(b.kv, failing(b.server), fromC, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('offline');
    // The server refuses the answer to פלג's link every time; the one to שירה's goes through.
    const replyToA = boxIdOf(fromA, 'reply');
    const stuck: BuddyServer = {
      ...b.server,
      put: async (boxes) => {
        if (!boxes.some((box) => box.id === replyToA)) return b.server.put(boxes);
        if (refusal === 'a 500') throw Object.assign(new Error('refused'), { status: 500 });
        return { results: [] };
      },
    };

    expect(await syncBuddies(b.kv, stuck, mine('נועה', later(1)), later(1))).toEqual({ accepted: ['שירה'], ended: [] });
    const state = readBuddies(b.kv);
    expect(state.answers.map((answer) => answer.replyId)).toEqual([replyToA]);
    expect(state.buddies.map((buddy) => buddy.name)).toEqual(['שירה']);
    expect(server.boxes.has(boxIdOf(state.buddies[0]!.secret, 'b2a'))).toBe(true);

    // A week on, the sweep has made פלג's invite a mark: the answer is gone too, and its place with it.
    server.expire(boxIdOf(fromA, 'invite'));
    await syncBuddies(b.kv, stuck, mine('נועה', later(2)), later(2));
    expect(readBuddies(b.kv).answers).toEqual([]);
    expect(readBuddies(b.kv).buddies.map((buddy) => buddy.name)).toEqual(['שירה']);
  });

  it('still fails the sync when the server cannot be reached, though an answer is all there is to send', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    await expect(acceptInvite(b.kv, failing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('offline');
    const offline: BuddyServer = {
      put: async () => { throw new Error('offline'); },
      read: async () => { throw new Error('offline'); },
      remove: async () => { throw new Error('offline'); },
    };
    await expect(syncBuddies(b.kv, offline, mine('נועה', later(1)), later(1))).rejects.toThrow('offline');
    expect(readBuddies(b.kv).answers).toHaveLength(1);
  });

  it('drops an answer when another phone answered meanwhile, on an older app\'s link', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const c = phone(server, 'C', 'שירה');
    const secret = await oneAnswerInvite(a);
    await expect(acceptInvite(b.kv, failing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('offline');
    expect(await acceptInvite(c.kv, c.server, secret, NOA, mine('שירה', NOW), NOW)).toBe('ok');

    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('used');
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], answers: [] });
    expect(heldBy(server, 'B')).toEqual([]);
    expect(await sync(a, later(5))).toEqual({ accepted: ['שירה'], ended: [] });
  });

  it('makes one friend of a double tap', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');

    const twice = await Promise.all([
      acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW),
      acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW),
    ]);
    expect(twice).toEqual(['ok', 'ok']);
    // And a third tap, once it is done.
    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('ok');
    const stateB = readBuddies(b.kv);
    expect(stateB.buddies).toHaveLength(1);
    expect(stateB.answers).toEqual([]);
    const pair = stateB.buddies[0]!.secret;
    expect(heldBy(server, 'B')).toEqual([boxIdOf(secret, 'reply'), boxIdOf(pair, 'b2a')].sort());

    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
    expect(readBuddies(a.kv).buddies[0]!.secret).toBe(pair);
  });

  it('refuses my own link, and leaves it for the friend it was sent to', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    expect(isOwnInvite(a.kv, secret)).toBe(true);
    expect(isOwnInvite(b.kv, secret)).toBe(false);
    expect(isOwnInvite(a.kv, newSecret())).toBe(false);

    const before = readBuddies(a.kv);
    const calls = server.calls.length;
    expect(await acceptInvite(a.kv, a.server, secret, PELEG, mine('פלג', NOW), NOW)).toBe('own');
    // Even with every place taken, it is mine before it is too many.
    saveBuddies(a.kv, { ...before, buddies: Array.from({ length: MAX_BUDDIES - 1 }, (_, i) => buddy(`b${i}`)) });
    expect(await acceptInvite(a.kv, a.server, secret, PELEG, mine('פלג', NOW), NOW)).toBe('own');
    saveBuddies(a.kv, before);
    expect(readBuddies(a.kv)).toEqual(before);
    expect(server.calls.length).toBe(calls);

    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('ok');
    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
    expect(readBuddies(a.kv).buddies.map((x) => x.name)).toEqual(['נועה']);
  });

  it('counts an answer not yet confirmed among the twenty', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const first = await createInvite(a.kv, a.server, PELEG, NOW);
    const second = await createInvite(a.kv, a.server, PELEG, NOW);
    if (first === 'full' || second === 'full') throw new Error('full');
    saveBuddies(b.kv, { ...readBuddies(b.kv), buddies: Array.from({ length: MAX_BUDDIES - 1 }, (_, i) => buddy(`b${i}`)) });
    await expect(acceptInvite(b.kv, failing(b.server), first, NOA, mine('נועה', NOW), NOW)).rejects.toThrow();
    expect(await acceptInvite(b.kv, b.server, second, NOA, mine('נועה', NOW), NOW)).toBe('full');
    // The held one still finishes: it has its place.
    expect(await acceptInvite(b.kv, b.server, first, NOA, mine('נועה', NOW), NOW)).toBe('ok');
  });

  it('takes back an invite whose write lost its answer, once no write can still be on its way', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    await expect(createInvite(a.kv, losing(a.server), PELEG, NOW)).rejects.toThrow('timed out');
    expect(server.boxes.size).toBe(1);

    await sync(a, later(1));
    expect(readBuddies(a.kv).invites).toHaveLength(1);
    await sync(a, later(11));
    expect(readBuddies(a.kv).invites).toEqual([]);
    expect(server.boxes.size).toBe(0);
  });

  it('keeps nothing of an invite the server refused', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const before = readBuddies(a.kv);
    const refusing: BuddyServer = { ...a.server, put: async (boxes) => ({ results: boxes.map((box) => ({ id: box.id, ok: false, error: 'too_many' as const })) }) };
    await expect(createInvite(a.kv, refusing, PELEG, NOW)).rejects.toThrow('too_many');
    expect(readBuddies(a.kv)).toEqual(before);
  });

  it('drops the boxes of answers not yet confirmed with my data', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow();
    expect(heldBy(server, 'B')).toEqual([boxIdOf(secret, 'reply')]);
    await dropAllBoxes(b.kv, b.server);
    expect(heldBy(server, 'B')).toEqual([]);
  });
});

/** A friend made by hand, with a box of mine never written and theirs never read. */
function buddy(id: string, over: Partial<Buddy> = {}): Buddy {
  return {
    id, role: 'inviter', secret: newSecret(), name: `חבר ${id}`, label: '', shares: PELEG, theirs: null, readAt: null, everRead: false,
    written: null, theirGrades: null, gradesWritten: null, gradesDot: false, addedAt: NOW.toISOString(), ...over,
  };
}

describe('keeping the boxes in step', () => {
  it('does not end a friendship over a box not yet written', async () => {
    const { server, b, secret } = await paired();
    // B syncs before A has seen the answer: A's box does not exist yet.
    expect(await sync(b, later(1))).toEqual({ accepted: [], ended: [] });
    const state = readBuddies(b.kv);
    expect(state.buddies).toHaveLength(1);
    expect(state.buddies[0]).toMatchObject({ everRead: false, theirs: null });
    expect(state.notes).toEqual([]);
    // Its answer stays for A to find.
    expect(server.boxes.has(boxIdOf(secret, 'reply'))).toBe(true);
  });

  it('ends the friendship on both phones', async () => {
    const { server, a, b, pair } = await paired();
    await sync(a, later(5));
    await sync(b, later(10));

    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    expect(readBuddies(a.kv).buddies).toEqual([]);
    expect(server.boxes.has(boxIdOf(pair, 'a2b'))).toBe(false);

    expect(await sync(b, later(15))).toEqual({ accepted: [], ended: ['פלג'] });
    const state = readBuddies(b.kv);
    expect(state.buddies).toEqual([]);
    expect(state.notes).toEqual([`${iso('פלג')}: כבר לא חברים`]);
    expect(server.boxes.has(boxIdOf(pair, 'b2a'))).toBe(false);
    expect(server.boxes.size).toBe(0);
    expect(await sync(b, later(20))).toEqual({ accepted: [], ended: [] });
  });

  it("keeps a friend's own name as their box says it now, and names them by it", async () => {
    const { a, b } = await paired();
    await sync(a, later(5));
    await sync(b, later(10));
    // A gives friends a new name: it reaches B with A's next box.
    await syncBuddies(a.kv, a.server, mine('פלג בר', later(20)), later(20));
    await sync(b, later(25));
    expect(readBuddies(b.kv).buddies[0]).toMatchObject({ name: 'פלג בר', theirs: { name: 'פלג בר' } });
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    expect(await sync(b, later(30))).toEqual({ accepted: [], ended: ['פלג בר'] });
    expect(readBuddies(b.kv).notes).toEqual([BUDDY_NOTES.ended('פלג בר')]);
  });

  it('names an ended friend as I named them', async () => {
    const { a, b } = await paired();
    await sync(a, later(5));
    await sync(b, later(10));
    const state = readBuddies(b.kv);
    saveBuddies(b.kv, { ...state, buddies: state.buddies.map((x) => ({ ...x, label: 'פלגי' })) });
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    expect(await sync(b, later(15))).toEqual({ accepted: [], ended: ['פלגי'] });
    expect(readBuddies(b.kv).notes).toEqual([BUDDY_NOTES.ended('פלגי')]);
  });

  it('keeps what changed on the phone while the server answered', async () => {
    const { a, b } = await paired();
    await sync(a, later(5));
    // While A's sync waits for B's box, A gives B a name of its own.
    const naming: BuddyServer = {
      ...a.server,
      read: async (ids) => {
        const found = await a.server.read(ids);
        const state = readBuddies(a.kv);
        saveBuddies(a.kv, { ...state, buddies: state.buddies.map((x) => ({ ...x, label: 'נועי' })) });
        return found;
      },
    };
    await syncBuddies(a.kv, naming, mine('פלג', later(70)), later(70));
    expect(readBuddies(a.kv).buddies[0]).toMatchObject({ label: 'נועי', everRead: true, written: { at: later(70).toISOString() } });

    // And B, who stops being friends while its sync is finding A's box gone, gets no note about it.
    await sync(b, later(75));
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);
    const id = readBuddies(b.kv).buddies[0]!.id;
    const leaving: BuddyServer = {
      ...b.server,
      read: async (ids) => {
        const found = await b.server.read(ids);
        await removeBuddy(b.kv, b.server, id);
        return found;
      },
    };
    expect(await syncBuddies(b.kv, leaving, mine('נועה', later(80)), later(80))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], notes: [] });
  });

  it('rewrites an unchanged box once an hour', async () => {
    const { server, a, b } = await paired();
    await sync(a, NOW);
    const putsA = server.puts('A');
    const putsB = server.puts('B');

    await sync(a, later(30));
    await sync(b, later(30));
    expect(server.puts('A')).toBe(putsA);
    expect(server.puts('B')).toBe(putsB);

    await sync(a, later(61));
    await sync(b, later(61));
    expect(server.puts('A')).toBe(putsA + 1);
    expect(server.puts('B')).toBe(putsB + 1);

    // A change goes at once.
    await syncBuddies(a.kv, a.server, mine('פלג בר', later(62)), later(62));
    expect(server.puts('A')).toBe(putsA + 2);
    await sync(b, later(63));
    expect(readBuddies(b.kv).buddies[0]!.theirs?.name).toBe('פלג בר');
  });

  it("never sends a box over the server's cap: it trims the lessons first", async () => {
    const { server, a, b, pair } = await paired();
    // Ten periods a day, twelve school days, each with a long teacher's name: two weeks do not fit a box, one does.
    const lessons: BuddyLesson[] = [];
    for (let d = 0; d < 14; d += 1) {
      const date = new Date(Date.UTC(2026, 7, 30 + d)).toISOString().slice(0, 10);
      if (d % 7 === 6) continue;
      for (let h = 1; h <= 10; h += 1) lessons.push({ date, hourIndex: h, start: '08:00', end: '08:45', subject: 'מתמטיקה', teacher: 'x'.repeat(200), status: 'regular' as const });
    }
    const big = (at: Date) => (shares: BuddyShares): BuddyBoxContent => ({
      v: 1, at: at.toISOString(), name: 'פלג', shares,
      timetable: { siteUrl: null, classId: '1', className: 'יב1', hiddenSubjects: [], exams: [], lessons, mashovSchool: '1' },
    });
    // The fake server throws on a box over the cap, as the route answers 400.
    await syncBuddies(a.kv, a.server, big(later(5)), later(5));
    const written = server.boxes.get(boxIdOf(pair, 'a2b'))!;
    expect(written.ciphertext.length).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);
    await sync(b, later(10));
    const theirs = readBuddies(b.kv).buddies[0]!.theirs!;
    expect(theirs.timetable?.lessonsTrimmed).toBe(true);
    expect(new Set(theirs.timetable?.lessons?.map((l) => l.date < '2026-09-06'))).toEqual(new Set([true]));

    // A box nothing can make fit is not sent, and stays due; the sync goes on.
    const absurd = (shares: BuddyShares): BuddyBoxContent => ({ ...big(later(70))(shares), name: 'פלג', timetable: { ...big(later(70))(shares).timetable!, hiddenSubjects: ['x'.repeat(40_000)] } });
    const putsBefore = server.puts('A');
    await expect(syncBuddies(a.kv, a.server, absurd, later(70))).resolves.toEqual({ accepted: [], ended: [] });
    expect(server.puts('A')).toBe(putsBefore);
  });

  it('writes and reads twenty friends in one request each', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies: Array.from({ length: MAX_BUDDIES }, (_, i) => buddy(`b${i}`, { role: i % 2 ? 'inviter' : 'invitee' })) });
    expect(await sync(a, NOW)).toEqual({ accepted: [], ended: [] });
    expect(server.calls.map((x) => [x.op, x.ids.length])).toEqual([['put', MAX_BUDDIES], ['read', MAX_BUDDIES]]);
    expect(readBuddies(a.kv).buddies.every((x) => x.written?.at === NOW.toISOString())).toBe(true);
  });

  it('does not write over a box another phone holds', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const taken = buddy('b1');
    const free = buddy('b2');
    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies: [taken, free] });
    await server.as('X').put([{ id: boxIdOf(taken.secret, 'a2b'), kind: 'pair', ciphertext: 'AAAA' }]);
    expect(await sync(a, NOW)).toEqual({ accepted: [], ended: [] });
    const [first, second] = readBuddies(a.kv).buddies;
    // Left to try again, and not taken for an ended friendship.
    expect(first!.written).toBeNull();
    expect(second!.written?.at).toBe(NOW.toISOString());
    expect(server.boxes.get(boxIdOf(taken.secret, 'a2b'))?.writer).toBe('X');
  });

  it('skips a record whose secret is not one, and keeps the rest', async () => {
    const { server, a, b, secret } = await paired();
    const state = readBuddies(a.kv);
    const broken = buddy('bad', { secret: 'not a secret', everRead: true });
    saveBuddies(a.kv, {
      ...state,
      buddies: [broken],
      invites: [...state.invites, { secret: 'nope', secretKey: 'nope', shares: PELEG, createdAt: NOW.toISOString() }],
    });
    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
    const after = readBuddies(a.kv);
    expect(after.buddies.map((x) => x.id)).toEqual(['bad', readBuddies(b.kv).buddies[0]!.id]);
    expect(after.invites.map((i) => i.secret)).toEqual([secret, 'nope']);
    expect(server.boxes.has(boxIdOf(secret, 'invite'))).toBe(true);

    await expect(dropAllBoxes(a.kv, a.server)).resolves.toBeUndefined();
    await removeBuddy(a.kv, a.server, 'bad');
    expect(readBuddies(a.kv).buddies.map((x) => x.id)).not.toContain('bad');
  });

  it('drops a pending invite whose time does not read', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    saveBuddies(a.kv, { ...readBuddies(a.kv), invites: [{ secret: newSecret(), secretKey: newKeyPair().secretKey, shares: PELEG, createdAt: '' }] });
    expect(await sync(a, NOW)).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).invites).toEqual([]);
  });
});

/**
 * A friend whose box was never read here is waited for (4.5), but not for
 * good: a week and a day after they were added, longer than any link lives,
 * the pairing did not complete, and it ends with a note of its own (R25).
 */
describe('a pairing that never completes', () => {
  const days = (n: number) => later(n * 24 * 60);
  const WAIT = BUDDY_INVITE_TTL_DAYS + 1;

  it('ends when the inviter removed me before my first read', async () => {
    const { server, a, b, secret, pair } = await paired();
    await sync(a, later(5));
    await removeBuddy(a.kv, a.server, readBuddies(a.kv).buddies[0]!.id);

    // Still waited for inside the week and a day.
    expect(await sync(b, days(WAIT - 0.1))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(b.kv).buddies).toHaveLength(1);
    expect(server.boxes.has(boxIdOf(pair, 'b2a'))).toBe(true);

    expect(await sync(b, days(WAIT + 0.01))).toEqual({ accepted: [], ended: ['פלג'] });
    const state = readBuddies(b.kv);
    expect(state.buddies).toEqual([]);
    expect(state.notes).toEqual([BUDDY_NOTES.incomplete('פלג')]);
    // My box for them goes, and my reply to their link (a mark: the link stays used).
    expect(server.boxes.has(boxIdOf(pair, 'b2a'))).toBe(false);
    expect(server.boxes.has(boxIdOf(secret, 'reply'))).toBe(false);
    expect(server.marks.has(boxIdOf(secret, 'reply'))).toBe(true);
    expect(server.boxes.size).toBe(0);
  });

  it('ends when the inviter never came back within the week', async () => {
    const { server, a, b, secret } = await paired();
    expect(await sync(b, days(WAIT + 0.01))).toEqual({ accepted: [], ended: ['פלג'] });
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], notes: [BUDDY_NOTES.incomplete('פלג')] });
    expect([...server.boxes.values()].some((x) => x.writer === 'B')).toBe(false);
    // When A does come back, the answer is gone and the invite has run out: no friend for someone who left.
    expect(await sync(a, days(WAIT + 1))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [] });
    expect(server.marks.has(boxIdOf(secret, 'invite'))).toBe(true);
  });

  it('ends on the inviter\'s side when my answer was lost and then dropped as gone', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await oneAnswerInvite(a);
    // B's answer reaches the server and its confirmation is lost; B is away from then on.
    await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('timed out');
    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
    // A week on, the server's sweep empties B's answer into a mark; the invite is already one.
    server.expire(boxIdOf(secret, 'reply'));
    expect(await sync(b, days(8))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], answers: [] });

    // A waited for B's first box, which never comes.
    const pair = readBuddies(a.kv).buddies[0]!.secret;
    expect(await sync(a, days(4))).toEqual({ accepted: [], ended: [] });
    expect(await sync(a, days(WAIT + 0.01))).toEqual({ accepted: [], ended: ['נועה'] });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], notes: [BUDDY_NOTES.accepted('נועה'), BUDDY_NOTES.incomplete('נועה')] });
    expect(server.boxes.has(boxIdOf(pair, 'a2b'))).toBe(false);
  });

  it('does not end a friend whose box was read, however long ago they were added', async () => {
    const { a, b } = await paired();
    await sync(a, later(5));
    await sync(b, later(10));
    expect(await sync(b, days(30))).toEqual({ accepted: [], ended: [] });
    expect(await sync(a, days(30))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(b.kv).buddies).toHaveLength(1);
    expect(readBuddies(a.kv).buddies).toHaveLength(1);
  });
});

/**
 * R28: the server's sweep empties an invite or a reply nobody answered in a week into a mark; it no
 * longer deletes it. Before, an invitee's pending answer, written again at every sync until confirmed,
 * found the id free and made the box anew. Now the id is `taken`, so what these pin is that the
 * protocol ends there, in `finishAnswer`'s read of both boxes or in its `taken`, and that nothing is
 * written again: not the reply, and not the inviter's own invite, which only `createInvite` writes.
 */
describe('a link the sweep emptied', () => {
  const days = (n: number) => later(n * 24 * 60);
  const WAIT = BUDDY_INVITE_TTL_DAYS + 1;
  /** Every id `who` has put on the server, in order. */
  const putIds = (server: Server, who: string) => server.calls.filter((c) => c.phone === who && c.op === 'put').flatMap((c) => c.ids);

  it('ends a pending answer without writing it again when both boxes of its link are marks', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const c = phone(server, 'C', 'שירה');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    const invite = boxIdOf(secret, 'invite');
    const reply = boxIdOf(secret, 'reply');
    // B's answer reaches the server and its confirmation is lost; neither phone syncs for a week and a day.
    await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('timed out');
    expect(readBuddies(b.kv).answers).toHaveLength(1);
    server.expire(invite);
    server.expire(reply);
    expect(server.boxes.size).toBe(0);
    expect(server.marks.size).toBe(2);
    expect(putIds(server, 'B')).toEqual([reply]);

    // Syncs after syncs: nothing is retried.
    for (const day of [WAIT, WAIT + 1, WAIT + 20]) {
      expect(await sync(b, days(day))).toEqual({ accepted: [], ended: [] });
      expect(await sync(a, days(day))).toEqual({ accepted: [], ended: [] });
    }
    // B's answer is dropped with no friend and no note (it read both boxes as gone, so it never wrote again); A's invite with it.
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], answers: [], notes: [], unseen: false });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [], notes: [], unseen: false });
    expect(putIds(server, 'B')).toEqual([reply]);
    expect(putIds(server, 'A')).toEqual([invite]);
    expect(server.boxes.size).toBe(0);
    // The link is used for good: gone to a third phone, which writes nothing.
    expect(await readInvite(c.server, secret)).toBe('gone');
    expect(await acceptInvite(c.kv, c.server, secret, NOA, mine('שירה', days(WAIT + 20)), days(WAIT + 20))).toBe('gone');
    expect(server.puts('C')).toBe(0);
  });

  it('ends a pending answer on taken when only its reply is a mark, and writes it no more than the once', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const c = phone(server, 'C', 'שירה');
    const secret = await oneAnswerInvite(a);
    const reply = boxIdOf(secret, 'reply');
    await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('timed out');
    // The invite is still live, so B's read finds a link to answer and writes its reply again; the id is taken.
    server.expire(reply);
    expect(await sync(b, days(1))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], answers: [], notes: [], unseen: false });
    expect(putIds(server, 'B')).toEqual([reply, reply]);

    // The answer is dropped, not kept for another try: the syncs that follow send nothing.
    for (const day of [2, 3, WAIT + 1, WAIT + 20]) {
      expect(await sync(b, days(day))).toEqual({ accepted: [], ended: [] });
    }
    expect(putIds(server, 'B')).toEqual([reply, reply]);
    // Opening the link by hand, which anyone may, is `used` and writes the reply once more, no more: it is no loop.
    expect(await acceptInvite(c.kv, c.server, secret, NOA, mine('שירה', days(2)), days(2))).toBe('used');
    expect(readBuddies(c.kv)).toMatchObject({ buddies: [], answers: [] });
    expect(putIds(server, 'C')).toEqual([reply]);
    expect(await sync(c, days(3))).toEqual({ accepted: [], ended: [] });
    expect(putIds(server, 'C')).toEqual([reply]);
    // A's invite ran out in the end and was dropped as an invite with no answer; it never wrote it again.
    expect(await sync(a, days(WAIT + 1))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [] });
    expect(putIds(server, 'A')).toEqual([boxIdOf(secret, 'invite')]);
  });

  it('lets a friend made from a confirmed answer end as incomplete when its reply was emptied, with the reply never written again', async () => {
    const { server, a, b, secret } = await paired();
    const reply = boxIdOf(secret, 'reply');
    expect(putIds(server, 'B').filter((id) => id === reply)).toEqual([reply]);
    // A is away for the week: the sweep empties its invite and B's reply.
    server.expire(boxIdOf(secret, 'invite'));
    server.expire(reply);

    expect(await sync(b, days(WAIT + 0.01))).toEqual({ accepted: [], ended: ['פלג'] });
    expect(readBuddies(b.kv)).toMatchObject({ buddies: [], notes: [BUDDY_NOTES.incomplete('פלג')] });
    expect(await sync(a, days(WAIT + 1))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [] });
    expect(putIds(server, 'B').filter((id) => id === reply)).toEqual([reply]);
    expect(putIds(server, 'A')).toEqual([boxIdOf(secret, 'invite')]);
    expect(server.boxes.size).toBe(0);
  });
});

describe('removing', () => {
  it('withdraws my invites nobody answered: their links read gone, and nobody can arm them again', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const c = phone(server, 'C', 'שירה');
    const one = await createInvite(a.kv, a.server, PELEG, NOW);
    const two = await createInvite(a.kv, a.server, NOA, NOW);
    if (one === 'full' || two === 'full') throw new Error('full');
    // One whose write lost its answer: never given out, so the sync takes it back, not this.
    await expect(createInvite(a.kv, losing(a.server), PELEG, NOW)).rejects.toThrow('timed out');
    const unsent = readBuddies(a.kv).invites.find((i) => i.unsent)!.secret;

    await cancelInvites(a.kv, a.server);
    expect(readBuddies(a.kv).invites.map((i) => i.secret)).toEqual([unsent]);
    for (const secret of [one, two]) {
      expect(server.boxes.has(boxIdOf(secret, 'invite'))).toBe(false);
      expect(server.marks.get(boxIdOf(secret, 'invite'))).toEqual({ writer: 'A', kind: 'invite' });
      expect(await readInvite(b.server, secret)).toBe('gone');
    }
    expect(await acceptInvite(b.kv, b.server, two, NOA, mine('נועה', NOW), NOW)).toBe('gone');
    const forged = seal({ v: 1, name: 'פלג', shares: PELEG, inviterKey: newKeyPair().publicKey }, keyOf(one));
    expect((await c.server.put([{ id: boxIdOf(one, 'invite'), kind: 'invite', ciphertext: forged }])).results[0]).toMatchObject({ ok: false, error: 'taken' });
    expect(await sync(a, later(20))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [] });
  });

  it('withdraws nothing, and asks the server nothing, with no invite out', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    await cancelInvites(a.kv, a.server);
    expect(server.calls).toEqual([]);
  });

  it('drops every box this phone wrote', async () => {
    const { server, a, b, secret, pair } = await paired();
    await sync(a, later(5));
    const another = await createInvite(a.kv, a.server, PELEG, later(6));
    if (another === 'full') throw new Error('full');
    expect(server.boxes.has(boxIdOf(secret, 'reply'))).toBe(true);

    await dropAllBoxes(a.kv, a.server);
    expect(server.boxes.has(boxIdOf(pair, 'a2b'))).toBe(false);
    expect(server.boxes.has(boxIdOf(another, 'invite'))).toBe(false);
    // B's boxes are B's: A cannot drop them.
    expect(server.boxes.has(boxIdOf(pair, 'b2a'))).toBe(true);

    await dropAllBoxes(b.kv, b.server);
    expect(server.boxes.size).toBe(0);
  });

  it('takes back an answer not yet seen when the invitee stops at once', async () => {
    const { server, a, b, secret, pair } = await paired();
    await removeBuddy(b.kv, b.server, readBuddies(b.kv).buddies[0]!.id);
    expect(readBuddies(b.kv).buddies).toEqual([]);
    expect(server.boxes.has(boxIdOf(secret, 'reply'))).toBe(false);
    expect(server.boxes.has(boxIdOf(pair, 'b2a'))).toBe(false);
    // So A never pairs with a friend who left; the invite waits for its week.
    expect(await sync(a, later(5))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).buddies).toEqual([]);
    expect(readBuddies(a.kv).invites).toHaveLength(1);
  });

  it('removes nothing for a friend it does not know', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    await removeBuddy(a.kv, a.server, 'nobody');
    await dropAllBoxes(a.kv, a.server);
    expect(server.calls).toEqual([]);
  });
});

describe('a box that is not what it should be', () => {
  it('says a garbled or forged invite is gone', async () => {
    const server = fakeServer();
    const a = server.as('A');
    const b = phone(server, 'B', 'נועה');
    const forged = async (content: unknown | string) => {
      const secret = newSecret();
      const ciphertext = typeof content === 'string' ? content : seal(content, keyOf(secret));
      await a.put([{ id: boxIdOf(secret, 'invite'), kind: 'invite', ciphertext }]);
      return secret;
    };
    const good = { v: 1, name: 'פלג', shares: PELEG, inviterKey: newKeyPair().publicKey };
    const cases = [
      'A'.repeat(80),
      seal(good, keyOf(newSecret())),
      { ...good, inviterKey: b64u(new Uint8Array(16)) },
      { ...good, inviterKey: 'not a key' },
      { ...good, v: 0 },
      { ...good, v: '1' },
      { ...good, name: '' },
      { ...good, name: 'א'.repeat(21) },
      { ...good, shares: { timetable: 'yes', absences: false } },
      [good],
    ];
    for (const content of cases) {
      const secret = await forged(content);
      expect(await readInvite(b.server, secret)).toBe('gone');
      expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('gone');
    }
    expect(readBuddies(b.kv).buddies).toEqual([]);
    expect(server.puts('B')).toBe(0);
    expect(await readInvite(b.server, await forged(good))).toEqual({ name: 'פלג', shares: PELEG });
    // A later version's invite only adds fields: it is read as this version's.
    expect(await readInvite(b.server, await forged({ ...good, v: 2, sticker: '🎉' }))).toEqual({ name: 'פלג', shares: PELEG });
  });

  it('ignores an answer that carries no real secret, and waits for one', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const c = server.as('C');
    const secret = await createInvite(a.kv, a.server, PELEG, NOW);
    if (secret === 'full') throw new Error('full');
    // Whoever has the link can read the invite's key and answer to it.
    const { boxes } = await c.read([boxIdOf(secret, 'invite')]);
    const invite = openSealed<{ inviterKey: string }>(boxes[0]!.ciphertext!, keyOf(secret))!;
    await c.put([{ id: boxIdOf(secret, 'reply'), kind: 'reply', ciphertext: sealTo({ v: 1, name: 'שירה', shares: NOA, secret: 'A'.repeat(27) }, invite.inviterKey) }]);

    expect(await sync(a, later(5))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv)).toMatchObject({ buddies: [], invites: [{ secret }], notes: [] });
    expect(server.boxes.has(boxIdOf(secret, 'invite'))).toBe(true);
  });

  it('keeps the last good box of a friend when theirs is not one', async () => {
    const { server, a, b, pair } = await paired();
    await sync(a, later(5));
    await sync(b, later(10));
    const good = readBuddies(b.kv).buddies[0]!;
    expect(good.theirs?.name).toBe('פלג');

    const id = boxIdOf(pair, 'a2b');
    const bad = [
      // Its own fields wrong: no part of it can be trusted.
      seal({ v: 0, at: later(20).toISOString(), name: 'פלג', shares: PELEG }, keyOf(pair)),
      seal({ v: 1, at: 'yesterday', name: 'פלג', shares: PELEG }, keyOf(pair)),
      seal({ v: 1, at: later(20).toISOString(), name: `פלג${String.fromCharCode(0x202e)}גלפ`, shares: PELEG }, keyOf(pair)),
      seal({ v: 1, at: later(20).toISOString(), name: 'פלג', shares: { timetable: 'yes', absences: false } }, keyOf(pair)),
      seal({ v: 1, at: later(20).toISOString(), name: 'פלג', shares: PELEG }, keyOf(newSecret())),
      'A'.repeat(120),
    ];
    for (const ciphertext of bad) {
      expect((await server.as('A').put([{ id, kind: 'pair', ciphertext }])).results[0]!.ok).toBe(true);
      expect(await sync(b, later(30))).toEqual({ accepted: [], ended: [] });
      const [now] = readBuddies(b.kv).buddies;
      expect(now).toMatchObject({ everRead: true, theirs: good.theirs, readAt: good.readAt });
    }
  });
});

describe('the guards over a box\'s content', () => {
  const key = newKeyPair().publicKey;

  it('reads a name as one a friend may have', () => {
    expect(isBuddyName('נועה')).toBe(true);
    expect(isBuddyName('א'.repeat(20))).toBe(true);
    expect(isBuddyName('א'.repeat(21))).toBe(false);
    for (const name of ['', '   ', 7, null]) expect(isBuddyName(name)).toBe(false);
  });

  it('refuses a name that could turn a sentence around it, or break its line', () => {
    // Text another phone wrote: a direction mark or override would reorder the Hebrew line it is put in.
    const marks = [
      0x00, 0x07, 0x0a, 0x0d, 0x09, 0x1f, 0x7f, 0x85, 0x9f, 0x200e, 0x200f, 0x061c,
      0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x2028, 0x2029,
    ].map((code) => String.fromCharCode(code));
    for (const mark of marks) {
      expect(isBuddyName(`נועה${mark}`), JSON.stringify(mark)).toBe(false);
      expect(isBuddyName(`${mark}Noa`), JSON.stringify(mark)).toBe(false);
    }
    // A joined emoji keeps its joiner, and Latin or mixed names are names.
    expect(isBuddyName('נועה 👩‍💻')).toBe(true);
    expect(isBuddyName('Noa')).toBe(true);
    expect(isBuddyName('נועה B.')).toBe(true);
  });

  it('takes out of a name typed on this phone the marks nobody sees, and keeps all that shows', () => {
    const rlm = String.fromCharCode(0x200f);
    const lrm = String.fromCharCode(0x200e);
    // A name pasted from a chat brings its direction marks along.
    expect(cleanBuddyName(`${rlm}נועה${lrm}`)).toBe('נועה');
    expect(cleanBuddyName(`Noa${String.fromCharCode(0x202e)} B.`)).toBe('Noa B.');
    // A line break or a tab parts words: it becomes one space.
    expect(cleanBuddyName('נועה\nכהן')).toBe('נועה כהן');
    expect(cleanBuddyName(' נועה \t כהן ')).toBe('נועה כהן');
    expect(cleanBuddyName('נועה 👩‍💻')).toBe('נועה 👩‍💻');
    // Whatever the rule refuses is gone, so what is left is a name.
    for (const code of [0x00, 0x0a, 0x0d, 0x85, 0x200e, 0x200f, 0x061c, 0x202a, 0x202e, 0x2066, 0x2069, 0x2028, 0x2029]) {
      expect(isBuddyName(cleanBuddyName(`נועה${String.fromCharCode(code)}כהן`)), code.toString(16)).toBe(true);
    }
    // Nothing but marks and spaces is no name at all.
    expect(cleanBuddyName(`${rlm} ${lrm}`)).toBe('');
  });

  it('takes an invite with a name, two shares and a 32-byte key, and nothing more', () => {
    expect(readInviteContent({ v: 1, name: 'פלג', shares: PELEG, inviterKey: key, extra: 'x'.repeat(1000) })).toEqual({ v: 1, name: 'פלג', shares: PELEG, inviterKey: key });
    expect(readInviteContent({ v: 1, name: 'פלג', shares: PELEG, inviterKey: b64u(new Uint8Array(31)) })).toBeNull();
    expect(readInviteContent({ v: 1, name: 'פלג', shares: { timetable: true }, inviterKey: key })).toBeNull();
    expect(readInviteContent(null)).toBeNull();
    expect(readInviteContent('invite')).toBeNull();
  });

  it('takes an answer only with a whole pairing secret', () => {
    const secret = newSecret();
    expect(readReplyContent({ v: 1, name: 'נועה', shares: NOA, secret })).toEqual({ v: 1, name: 'נועה', shares: NOA, secret });
    expect(readReplyContent({ v: 1, name: 'נועה', shares: NOA, secret: 'A'.repeat(27) })).toBeNull();
    expect(readReplyContent({ v: 1, name: 'נועה', shares: NOA, secret: `${secret}A` })).toBeNull();
    expect(readReplyContent({ v: 1, name: 'נועה', shares: NOA })).toBeNull();
  });

  const timetable = {
    siteUrl: 'https://school-g.shahaf.site', classId: '36', className: 'יב2', hiddenSubjects: ['ספרות'],
    exams: [{ date: '2026-09-03', subject: 'מתמטיקה', title: 'מבחן במתמטיקה' }],
  };
  const lesson = { date: '2026-09-01', hourIndex: 1, start: '08:00', end: '08:45', subject: 'מתמטיקה', teacher: 'לוי', status: 'regular' };
  const absences = { semesterStart: '2026-09-01', semesterEnd: '2027-01-31', subjects: [{ subject: 'מתמטיקה', counted: 2, allowed: 6, level: 'ok' }] };
  const box = (over: Record<string, unknown> = {}) => ({ v: 1, at: NOW.toISOString(), name: 'נועה', shares: NOA, ...over });

  it('takes a friend\'s box as the content module writes it', () => {
    expect(readBoxContent(box())).toEqual(box());
    expect(readBoxContent(box({ timetable, absences }))).toEqual(box({ timetable, absences }));
    const noSite = { ...timetable, siteUrl: null, lessons: [lesson, { ...lesson, hourIndex: 2, start: null, end: null, teacher: null, status: 'cancelled' }], mashovSchool: '540211' };
    expect(readBoxContent(box({ timetable: noSite }))).toEqual(box({ timetable: noSite }));
    const trimmed = { ...noSite, lessonsTrimmed: true };
    expect(readBoxContent(box({ timetable: trimmed }))).toEqual(box({ timetable: trimmed }));
    // What this version does not know is left out, not kept.
    expect(readBoxContent(box({ grades: [100], timetable: { ...timetable, secretNote: 'x' } }))).toEqual(box({ timetable }));
  });

  /**
   * `grades` and `bagrut` came after the first version, so a friend's phone
   * may never write them: missing reads as off. They are kept when booleans,
   * and `bagrut` counts only along with `grades` (grades spec 4.1).
   */
  it('keeps the grades switches of a box when they are booleans, and leaves them out otherwise', () => {
    const sharesOf = (shares: unknown) => readBoxContent(box({ shares }))!.shares;
    const all = { ...NOA, grades: true, bagrut: true };
    expect(sharesOf(all)).toEqual(all);
    expect(sharesOf({ ...NOA, grades: true })).toEqual({ ...NOA, grades: true });
    expect(sharesOf({ ...NOA, grades: true, bagrut: false })).toEqual({ ...NOA, grades: true, bagrut: false });
    expect(sharesOf({ ...NOA, grades: false })).toEqual({ ...NOA, grades: false });
    // An older phone writes neither: the box reads as it always did, with no switch in it.
    expect(sharesOf(NOA)).toEqual(NOA);
    expect(sharesOf(NOA)).not.toHaveProperty('grades');
    expect(sharesOf(NOA)).not.toHaveProperty('bagrut');
    // Not a boolean: left out, and the box (and its other switches) kept.
    for (const odd of ['yes', 1, null, [true]]) {
      expect(sharesOf({ ...NOA, grades: odd, bagrut: odd }), JSON.stringify(odd)).toEqual(NOA);
      expect(sharesOf({ ...NOA, grades: odd })).not.toHaveProperty('grades');
    }
    // `bagrut` without `grades` is off, whatever it says.
    expect(sharesOf({ ...NOA, bagrut: true })).toEqual({ ...NOA, bagrut: false });
    expect(sharesOf({ ...NOA, grades: false, bagrut: true })).toEqual({ ...NOA, grades: false, bagrut: false });
    expect(sharesOf({ ...NOA, grades: 'yes', bagrut: true })).toEqual({ ...NOA, bagrut: false });
    // The first two switches are still all or nothing.
    expect(readBoxContent(box({ shares: { grades: true, bagrut: true } }))).toBeNull();
  });

  it('keeps the grades switches in an invite and an answer too', () => {
    const shares = { ...PELEG, grades: true, bagrut: false };
    expect(readInviteContent({ v: 1, name: 'פלג', shares, inviterKey: key })).toEqual({ v: 1, name: 'פלג', shares, inviterKey: key });
    expect(readInviteContent({ v: 1, name: 'פלג', shares: { ...PELEG, bagrut: true }, inviterKey: key })!.shares).toEqual({ ...PELEG, bagrut: false });
    const secret = newSecret();
    expect(readReplyContent({ v: 1, name: 'נועה', shares, secret })).toEqual({ v: 1, name: 'נועה', shares, secret });
    expect(readReplyContent({ v: 1, name: 'נועה', shares: { ...PELEG, grades: 'on' }, secret })!.shares).toEqual(PELEG);
  });

  it('keeps the grades switches of a friend, an invite and an answer on the phone, as `=== true`', () => {
    const kv = memoryKv();
    const on = { ...NOA, grades: true, bagrut: true };
    const state = {
      myName: 'פלג', unseen: false, notes: [],
      buddies: [buddy('on', { shares: on }), buddy('plain', { shares: PELEG }), buddy('grades', { shares: { ...NOA, grades: true } })],
      invites: [{ secret: newSecret(), secretKey: newKeyPair().secretKey, shares: on, createdAt: NOW.toISOString() }],
      answers: [{ replyId: 'r', inviteId: 'i', secret: newSecret(), name: 'נועה', shares: on, offered: on, ciphertext: 'c' }],
    };
    saveBuddies(kv, state);
    const read = readBuddies(kv);
    expect(read.buddies.map((b) => b.shares)).toEqual([on, PELEG, { ...NOA, grades: true }]);
    expect(read.invites[0]!.shares).toEqual(on);
    expect(read.answers[0]!.shares).toEqual(on);
    // A switch that was never on is not there: a stored `false` or a stray value is as good as none.
    expect(read.buddies[1]!.shares).not.toHaveProperty('grades');
    expect(read.buddies[1]!.shares).not.toHaveProperty('bagrut');
    expect(read.buddies[2]!.shares).not.toHaveProperty('bagrut');

    const stored = (shares: unknown) => {
      const other = memoryKv();
      saveBuddies(other, { ...state, buddies: [{ ...buddy('x'), shares } as Buddy], invites: [], answers: [] });
      return readBuddies(other).buddies[0]!.shares;
    };
    expect(stored({ ...NOA, grades: false, bagrut: false })).toEqual(NOA);
    expect(stored({ ...NOA, grades: false, bagrut: false })).not.toHaveProperty('grades');
    expect(stored({ ...NOA, grades: 'true', bagrut: 1 })).toEqual(NOA);
    // `bagrut` with no `grades` reads as off, and is not kept as if it were on.
    expect(stored({ ...NOA, bagrut: true })).toEqual(NOA);
    expect(stored({ ...NOA, bagrut: true })).not.toHaveProperty('bagrut');
    expect(stored({ ...NOA, grades: false, bagrut: true })).not.toHaveProperty('bagrut');
  });

  it('reads a friend\'s box kept on the phone with its grades switches', () => {
    const kv = memoryKv();
    const theirs = box({ shares: { ...NOA, grades: true, bagrut: true } });
    saveBuddies(kv, { myName: 'פלג', unseen: false, notes: [], buddies: [buddy('a', { theirs: theirs as BuddyBoxContent })], invites: [], answers: [] });
    expect(readBuddies(kv).buddies[0]!.theirs).toEqual(theirs);
  });

  it('refuses a box whose own fields are wrong: nothing of it can be trusted', () => {
    const bad: Record<string, unknown>[] = [
      { v: 0 },
      { v: '1' },
      { v: undefined },
      { at: 7 },
      { at: 'yesterday' },
      { name: '' },
      { name: 'נועה\n' },
      { name: `${String.fromCharCode(0x202e)}העונ` },
      { shares: { timetable: true, absences: 'no' } },
      { shares: null },
    ];
    for (const over of bad) expect(readBoxContent(box(over)), JSON.stringify(over)).toBeNull();
    expect(readBoxContent(null)).toBeNull();
    expect(readBoxContent([box()])).toBeNull();
  });

  /**
   * One part another phone got wrong costs that part, not the friend (R26).
   * Later versions only add optional fields and never change what one means,
   * so a newer box is read as this version's, and a value this version does
   * not know is taken as its plainest kind.
   */
  it('reads a box part by part: a bad item goes, a bad part goes, the rest stays', () => {
    const other = { date: '2026-09-04', subject: 'אנגלית', title: 'מבחן באנגלית' };
    const read = (over: Record<string, unknown>) => readBoxContent(box({ timetable, absences, ...over }));

    // A later version's box, with fields this one does not know.
    expect(readBoxContent({ ...box({ timetable, absences }), v: 3, stickers: ['x'] })).toEqual(box({ timetable, absences }));

    // A bad exam, lesson or subject is dropped; its neighbours stay.
    expect(read({ timetable: { ...timetable, exams: [{ date: '1/9/2026', subject: 'x', title: 'x' }, other, { date: '2026-09-05', title: 3 }] } }))
      .toEqual(box({ timetable: { ...timetable, exams: [other] }, absences }));
    const noSite = { ...timetable, siteUrl: null, mashovSchool: '540211' };
    const lessons = [
      { ...lesson, start: '8' }, { ...lesson, end: 845 }, { ...lesson, hourIndex: '1' }, { ...lesson, teacher: 3 }, { ...lesson, date: null },
      lesson, 'not a lesson',
    ];
    expect(read({ timetable: { ...noSite, lessons } })).toEqual(box({ timetable: { ...noSite, lessons: [lesson] }, absences }));
    expect(read({ timetable: { ...timetable, hiddenSubjects: [7, 'ספרות', null] } })).toEqual(box({ timetable, absences }));
    // A count JSON could not write (NaN and Infinity arrive as null) drops its subject.
    const subjects = [
      { subject: 'x', counted: null, allowed: 6, level: 'ok' },
      { subject: 'y', counted: 2, allowed: Number.POSITIVE_INFINITY, level: 'ok' },
      { subject: 'z', counted: Number.NaN, allowed: 6, level: 'ok' },
      { subject: 7, counted: 1, allowed: 6, level: 'ok' },
      ...absences.subjects,
    ];
    expect(read({ absences: { ...absences, subjects } })).toEqual(box({ timetable, absences }));

    // A status or a level this version does not know is its plainest.
    expect(read({ timetable: { ...noSite, lessons: [{ ...lesson, status: 'teleported' }] } }))
      .toEqual(box({ timetable: { ...noSite, lessons: [lesson] }, absences }));
    expect(read({ absences: { ...absences, subjects: [{ ...absences.subjects[0], level: 'red' }] } })).toEqual(box({ timetable, absences }));

    // A part whose own fields are wrong goes whole; the other part, the name and the shares stay.
    const brokenTimetables: unknown[] = [
      'all of it', { ...timetable, exams: 'none' }, { ...timetable, siteUrl: 7 }, { ...timetable, className: null },
      { ...timetable, hiddenSubjects: 'ספרות' }, { ...timetable, lessons: {} },
    ];
    for (const broken of brokenTimetables) expect(read({ timetable: broken }), JSON.stringify(broken)).toEqual(box({ absences }));
    for (const broken of [{ ...absences, semesterStart: '1.9.2026' }, { ...absences, subjects: null }, 'some']) {
      expect(read({ absences: broken }), JSON.stringify(broken)).toEqual(box({ timetable }));
    }
    // An optional field of the wrong kind is left out, the part kept.
    expect(read({ timetable: { ...timetable, mashovSchool: 540211 } })).toEqual(box({ timetable, absences }));
    expect(read({ timetable: { ...timetable, lessonsTrimmed: 'yes' } })).toEqual(box({ timetable, absences }));
  });
});

describe('the choices from the pairing on', () => {
  const ON: BuddyShares = { ...NOA, grades: true, bagrut: true };
  /** What פלג offers in these tests: his timetable and his grades, not the bagrut. */
  const OFFER: BuddyShares = { ...PELEG, grades: true };
  /** B's box is held back: only a `pair` write fails, so the reply and the friend are made, and A's first read of B finds no box. */
  const withoutBox = (device: BuddyServer): BuddyServer => ({
    ...device,
    put: async (boxes) => {
      if (boxes.some((b) => b.kind === 'pair')) throw new Error('offline');
      return device.put(boxes);
    },
  });

  async function invited(offer: BuddyShares) {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, offer, NOW);
    if (secret === 'full') throw new Error('full');
    return { server, a, b, secret };
  }

  it('an invite carries the grades switches', async () => {
    const { a, b, secret } = await invited(ON);
    expect(await readInvite(b.server, secret)).toEqual({ name: 'פלג', shares: ON });
    expect(readBuddies(a.kv).invites[0]!.shares).toEqual(ON);

    // Grades with no bagrut, and no grades at all: each reads as it was chosen.
    const grades = await createInvite(a.kv, a.server, { ...PELEG, grades: true }, NOW);
    const plain = await createInvite(a.kv, a.server, PELEG, NOW);
    if (grades === 'full' || plain === 'full') throw new Error('full');
    expect(await readInvite(b.server, grades)).toEqual({ name: 'פלג', shares: { ...PELEG, grades: true } });
    expect(await readInvite(b.server, grades)).not.toHaveProperty('shares.bagrut');
    expect(await readInvite(b.server, plain)).toEqual({ name: 'פלג', shares: PELEG });
    expect(await readInvite(b.server, plain)).not.toHaveProperty('shares.grades');
  });

  it('an invite never carries bagrut without grades', async () => {
    const { a, b } = await invited(PELEG);
    for (const shares of [{ ...PELEG, bagrut: true }, { ...PELEG, grades: false, bagrut: true }]) {
      const secret = await createInvite(a.kv, a.server, shares, NOW);
      if (secret === 'full') throw new Error('full');
      const read = await readInvite(b.server, secret);
      expect(read).toEqual({ name: 'פלג', shares: PELEG });
      expect(read).not.toHaveProperty('shares.bagrut');
      expect(readBuddies(a.kv).invites.find((i) => i.secret === secret)!.shares).not.toHaveProperty('bagrut');
    }
  });

  it('the invitee keeps what the invite offered', async () => {
    const { b, secret } = await invited(OFFER);
    expect(await acceptInvite(b.kv, b.server, secret, NOA, mine('נועה', NOW), NOW)).toBe('ok');
    const [ofA] = readBuddies(b.kv).buddies;
    expect(ofA).toMatchObject({ offered: OFFER, shares: NOA });
    expect(ofA!.offered).not.toHaveProperty('bagrut');
    // What I answered with is mine alone: the offer does not get into my shares.
    expect(ofA!.shares).not.toHaveProperty('grades');
  });

  it('the invitee keeps what the invite offered in an answer a later sync finishes', async () => {
    const { b, secret } = await invited(OFFER);
    await expect(acceptInvite(b.kv, losing(b.server), secret, NOA, mine('נועה', NOW), NOW)).rejects.toThrow('timed out');
    expect(readBuddies(b.kv).buddies).toEqual([]);
    expect(readBuddies(b.kv).answers[0]).toMatchObject({ offered: OFFER, shares: NOA });

    expect(await sync(b, later(1))).toEqual({ accepted: ['פלג'], ended: [] });
    expect(readBuddies(b.kv).answers).toEqual([]);
    expect(readBuddies(b.kv).buddies[0]).toMatchObject({ offered: OFFER, shares: NOA });
    // `toMatchObject` takes a part: what the invite offered must not have got into my own choices.
    expect(readBuddies(b.kv).buddies[0]!.shares).not.toHaveProperty('grades');
    expect(readBuddies(b.kv).buddies[0]!.shares).not.toHaveProperty('bagrut');
  });

  it('copies grades into an answer, and bagrut only along with them', async () => {
    const { a, b, secret } = await invited(PELEG);
    expect(await acceptInvite(b.kv, b.server, secret, ON, mine('נועה', NOW), NOW)).toBe('ok');
    expect(readBuddies(b.kv).buddies[0]!.shares).toEqual(ON);
    await sync(a, later(5));
    expect(readBuddies(a.kv).buddies[0]).toMatchObject({ offered: ON, shares: PELEG });
    // What the reply said is theirs: none of it gets into what I share.
    expect(readBuddies(a.kv).buddies[0]!.shares).not.toHaveProperty('grades');
    expect(readBuddies(a.kv).buddies[0]!.shares).not.toHaveProperty('bagrut');

    const other = await invited(PELEG);
    const stray = { ...NOA, bagrut: true };
    expect(await acceptInvite(other.b.kv, other.b.server, other.secret, stray, mine('נועה', NOW), NOW)).toBe('ok');
    expect(readBuddies(other.b.kv).buddies[0]!.shares).toEqual(NOA);
    expect(readBuddies(other.b.kv).buddies[0]!.shares).not.toHaveProperty('bagrut');
    await sync(other.a, later(5));
    expect(readBuddies(other.a.kv).buddies[0]!.offered).toEqual(NOA);
    expect(readBuddies(other.a.kv).buddies[0]!.offered).not.toHaveProperty('bagrut');
  });

  it('the inviter keeps what the reply said, before the invitee\'s box is read', async () => {
    const { a, b, secret } = await invited(PELEG);
    expect(await acceptInvite(b.kv, withoutBox(b.server), secret, ON, mine('נועה', NOW), NOW)).toBe('ok');
    expect(readBuddies(b.kv).buddies[0]!.written).toBeNull();

    expect(await sync(a, later(5))).toEqual({ accepted: ['נועה'], ended: [] });
    const [ofB] = readBuddies(a.kv).buddies;
    expect(ofB).toMatchObject({ offered: ON, shares: PELEG, theirs: null, everRead: false });
    expect(ofB!.shares).not.toHaveProperty('grades');
    expect(ofB!.shares).not.toHaveProperty('bagrut');
    expect(theirSharesOf(ofB!)).toEqual(ON);

    // Once B's box is there and read, it says the same, and the box is what is asked.
    await sync(b, later(10));
    await sync(a, later(15));
    const [read] = readBuddies(a.kv).buddies;
    expect(read).toMatchObject({ everRead: true, theirs: { shares: ON } });
    expect(theirSharesOf(read!)).toEqual(ON);
  });

  it('theirSharesOf prefers the box once read', () => {
    const theirs = { v: 1, at: NOW.toISOString(), name: 'נועה', shares: PELEG } as const;
    // The box says they turned grades off since the reply: that is what counts.
    expect(theirSharesOf(buddy('read', { offered: ON, theirs }))).toEqual(PELEG);
    expect(theirSharesOf(buddy('unread', { offered: ON }))).toEqual(ON);
    // Neither: nothing is shared that nobody said was.
    expect(theirSharesOf(buddy('none'))).toEqual({ timetable: false, absences: false });
  });

  it('keeps theirGrades, gradesWritten, gradesDot and offered on the phone', () => {
    const kv = memoryKv();
    const theirGrades: BuddyGradesContent = {
      v: 1, at: NOW.toISOString(), subjects: [{ subject: 'מתמטיקה', average: 90, grades: [{ date: '2026-08-30', name: 'בוחן', value: 90 }] }], bagrut: [],
    };
    const gradesWritten = { hash: 'h1', at: later(3).toISOString() };
    const answer = { replyId: 'r', inviteId: 'i', secret: newSecret(), name: 'נועה', shares: PELEG, offered: ON, ciphertext: 'c' };
    saveBuddies(kv, {
      myName: 'פלג', unseen: false, notes: [], invites: [], answers: [answer],
      buddies: [buddy('kept', { offered: ON, theirGrades, gradesWritten, gradesDot: true }), buddy('plain')],
    });
    const state = readBuddies(kv);
    expect(state.buddies[0]).toMatchObject({ offered: ON, theirGrades, gradesWritten, gradesDot: true });
    expect(state.answers[0]).toMatchObject({ offered: ON });
    expect(state.buddies[1]).toMatchObject({ theirGrades: null, gradesWritten: null, gradesDot: false });
    expect(state.buddies[1]).not.toHaveProperty('offered');
  });

  it('reads a damaged theirGrades as none, and what is stored only as is', () => {
    const kv = memoryKv();
    const damaged = [{ v: 1, at: 'yesterday', subjects: [] }, { v: 1, at: NOW.toISOString(), subjects: 'math' }, 'grades', 7, [], {}];
    const stored = [
      ...damaged.map((theirGrades, i) => buddy(`d${i}`, { theirGrades: theirGrades as unknown as BuddyGradesContent })),
      buddy('written', { gradesWritten: { hash: 7, at: 'x' } as unknown as Buddy['gradesWritten'], gradesDot: 'yes' as unknown as boolean }),
    ];
    saveBuddies(kv, { myName: 'פלג', unseen: false, notes: [], invites: [], answers: [], buddies: stored });
    const read = readBuddies(kv).buddies;
    expect(read).toHaveLength(stored.length);
    for (const b of read.slice(0, damaged.length)) expect(b.theirGrades, b.id).toBeNull();
    expect(readGradesContent(damaged[0])).toBeNull();
    // A record that is not what it says: no write is known, and no dot.
    expect(read[damaged.length]).toMatchObject({ gradesWritten: null, gradesDot: false });
  });

  it('reads a friend and an answer saved before these fields existed with their defaults', () => {
    const kv = memoryKv();
    const old: Partial<Buddy> = buddy('old');
    delete old.theirGrades;
    delete old.gradesWritten;
    delete old.gradesDot;
    const answer = { replyId: 'r', inviteId: 'i', secret: newSecret(), name: 'נועה', shares: NOA, ciphertext: 'c' };
    saveBuddies(kv, {
      myName: 'פלג', unseen: false, notes: [], invites: [], buddies: [old as Buddy], answers: [answer as unknown as PendingAnswer],
    });
    const state = readBuddies(kv);
    expect(state.buddies[0]).toMatchObject({ theirGrades: null, gradesWritten: null, gradesDot: false });
    expect(state.buddies[0]).not.toHaveProperty('offered');
    expect(theirSharesOf(state.buddies[0]!)).toEqual({ timetable: false, absences: false });
    // An old answer offered nothing that was ever read: all off, and the answer itself stays.
    expect(state.answers[0]).toMatchObject({ replyId: 'r', shares: NOA, offered: { timetable: false, absences: false } });
    expect(state.answers[0]!.offered).not.toHaveProperty('grades');
  });
});

/**
 * Grades go in a second box each way, written only while both friends share
 * them, by the phone that writes it (grades spec 4.2, 4.4). What a phone keeps
 * of a friend's grades goes as soon as the rule stops holding, and a grades box
 * that is not there never ends a friendship: only the main box does.
 */
describe('the grades boxes', () => {
  const A_GRADES: BuddyShares = { ...PELEG, grades: true };
  const A_BAGRUT: BuddyShares = { ...PELEG, grades: true, bagrut: true };
  const B_GRADES: BuddyShares = { ...NOA, grades: true };
  const B_BAGRUT: BuddyShares = { ...NOA, grades: true, bagrut: true };
  const DAY = 24 * 60;

  type Phone = ReturnType<typeof phone>;

  /** A phone's grades as its builder makes them: one subject, and the bagrut part only when asked for. */
  const gradesOf = (value: number, at: Date): MyGrades => (withBagrut) => {
    const content: BuddyGradesContent = {
      v: 1, at: at.toISOString(), subjects: [{ subject: 'מתמטיקה', average: value, grades: [{ date: '2026-08-30', name: 'בוחן', value }] }],
    };
    if (withBagrut) content.bagrut = [{ semel: 35581, name: 'מתמטיקה', moed: '2026-06', final: value }];
    return content;
  };
  /** Each phone's own grades: פלג has 90, נועה 85. */
  const own = (p: Phone, at: Date) => gradesOf(p.name === 'פלג' ? 90 : 85, at);
  /** The bagrut part of a phone's own grades, which is the same whenever it is read. */
  const bagrutOf = (p: Phone) => own(p, NOW)(true)!.bagrut!;

  /** A sync with my grades as Mashov last gave them (`grades`, else the phone's own). */
  const gsync = (p: Phone, at: Date, grades: MyGrades = own(p, at)) => syncBuddies(p.kv, p.server, mine(p.name, at), at, grades);

  /** My only friend, as kept. */
  const only = (p: Phone) => readBuddies(p.kv).buddies[0]!;

  /** My choices for my only friend, as the share sheet sets them. */
  function choose(p: Phone, shares: BuddyShares) {
    const state = readBuddies(p.kv);
    saveBuddies(p.kv, { ...state, buddies: state.buddies.map((x) => ({ ...x, shares })) });
  }

  /** פלג (A) invites with `aShares`; נועה (B) has not answered yet. */
  async function invitedWith(aShares: BuddyShares) {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    // A link that ends with its answer: what these tests count is the friendship's boxes and calls.
    const secret = await oneAnswerInvite(a, aShares);
    return { server, a, b, secret };
  }

  /** B answers with `bShares` and her grades, through `device`. */
  const answer = (b: Phone, secret: string, bShares: BuddyShares, device = b.server) =>
    acceptInvite(b.kv, device, secret, bShares, mine('נועה', NOW), NOW, own(b, NOW));

  /** `invitedWith`, and B's answer; neither has synced since. With the pair secret and each side's grades box id. */
  async function pairedWith(aShares: BuddyShares, bShares: BuddyShares) {
    const made = await invitedWith(aShares);
    expect(await answer(made.b, made.secret, bShares)).toBe('ok');
    const pair = only(made.b).secret;
    return { ...made, pair, ids: { a: boxIdOf(pair, 'a2b-grades'), b: boxIdOf(pair, 'b2a-grades') } };
  }

  /** The grades box `id` on the server, opened and read; `undefined` when there is none. */
  const held = (server: Server, id: string, pair: string) => {
    const box = server.boxes.get(id);
    return box ? readGradesContent(openSealed<unknown>(box.ciphertext, keyOf(pair))) : undefined;
  };
  /** How many of `device`'s writes carried `id`. */
  const writesOf = (server: Server, device: string, id: string) =>
    server.calls.filter((c) => c.phone === device && c.op === 'put' && c.ids.includes(id)).length;
  /** The calls made from `since` on, of one kind. */
  const callsFrom = (server: Server, since: number, op: Call['op']) => server.calls.slice(since).filter((c) => c.op === op);

  it('only one side on: no grades box is written by either', async () => {
    const { server, a, b, ids } = await pairedWith(A_GRADES, NOA);
    await gsync(a, later(5));
    await gsync(b, later(10));
    await gsync(a, later(15));
    await gsync(b, later(20));
    expect(server.boxes.has(ids.a)).toBe(false);
    expect(server.boxes.has(ids.b)).toBe(false);
    expect(server.calls.some((c) => c.op === 'put' && (c.ids.includes(ids.a) || c.ids.includes(ids.b)))).toBe(false);
    // B knows A wants to: A's box says so, and the tab has its dot.
    expect(theirSharesOf(only(b)).grades).toBe(true);
    expect(only(b)).toMatchObject({ gradesDot: true, theirGrades: null, gradesWritten: null });
    expect(only(a)).toMatchObject({ gradesDot: false, theirGrades: null, gradesWritten: null });
    // B, whose own choice is off, never even asks for A's grades box.
    expect(server.calls.some((c) => c.phone === 'B' && c.op === 'read' && c.ids.includes(ids.a))).toBe(false);
  });

  it('both on: each writes its grades box in the same sync that sees the other on', async () => {
    const { server, a, b, pair, ids } = await pairedWith(PELEG, NOA);
    await gsync(a, later(5));
    await gsync(b, later(10));

    choose(a, A_GRADES);
    await gsync(a, later(20));
    expect(server.boxes.has(ids.a)).toBe(false);

    choose(b, B_GRADES);
    let since = server.calls.length;
    await gsync(b, later(30));
    // B reads A's box saying grades, and writes its own grades box in that very sync.
    expect(callsFrom(server, since, 'put').flatMap((c) => c.ids)).toContain(ids.b);
    expect(held(server, ids.b, pair)).toEqual(own(b, later(30))(false));
    expect(only(b).gradesWritten).toMatchObject({ at: later(30).toISOString() });

    since = server.calls.length;
    await gsync(a, later(40));
    // One read for both of B's boxes; then A has B's grades, and writes its own.
    expect(callsFrom(server, since, 'read')).toEqual([{ phone: 'A', op: 'read', ids: [boxIdOf(pair, 'b2a'), ids.b] }]);
    expect(only(a).theirGrades).toEqual(own(b, later(30))(false));
    expect(callsFrom(server, since, 'put').flatMap((c) => c.ids)).toContain(ids.a);

    await gsync(b, later(50));
    expect(only(b).theirGrades).toEqual(own(a, later(40))(false));
  });

  it('pairing with both on passes grades right away', async () => {
    const { server, a, b, pair, ids } = await pairedWith(A_GRADES, B_GRADES);
    // B's grades box went with B's first box, by what the invite offered: a pair box, as the main one.
    expect(held(server, ids.b, pair)).toEqual(own(b, NOW)(false));
    expect(server.boxes.get(ids.b)?.kind).toBe('pair');
    expect(only(b).gradesWritten).toMatchObject({ at: NOW.toISOString() });

    await gsync(a, later(5));
    expect(only(a).theirGrades).toEqual(own(b, NOW)(false));
    await gsync(b, later(10));
    expect(only(b).theirGrades).toEqual(own(a, later(5))(false));
    expect(only(a).gradesDot).toBe(false);
    expect(only(b).gradesDot).toBe(false);
  });

  it('pairing with both on passes grades right away, also when a later sync finishes the answer', async () => {
    const { server, a, b, secret } = await invitedWith(A_GRADES);
    await expect(answer(b, secret, B_GRADES, losing(b.server))).rejects.toThrow('timed out');
    expect(readBuddies(b.kv).buddies).toEqual([]);

    expect(await gsync(b, later(1))).toEqual({ accepted: ['פלג'], ended: [] });
    const pair = only(b).secret;
    expect(held(server, boxIdOf(pair, 'b2a-grades'), pair)).toEqual(own(b, later(1))(false));

    await gsync(a, later(5));
    expect(only(a).theirGrades).toEqual(own(b, later(1))(false));
    await gsync(b, later(10));
    expect(only(b).theirGrades).toEqual(own(a, later(5))(false));
  });

  it('bagrut only when both chose it', async () => {
    const { server, a, b, pair, ids } = await pairedWith(A_BAGRUT, B_GRADES);
    await gsync(a, later(5));
    await gsync(b, later(10));
    for (const id of [ids.a, ids.b]) {
      expect(held(server, id, pair)).toBeTruthy();
      expect(held(server, id, pair)).not.toHaveProperty('bagrut');
    }
    expect(only(a).theirGrades).not.toHaveProperty('bagrut');
    expect(only(b).theirGrades).not.toHaveProperty('bagrut');

    // B chooses it too: each box gets it in the sync that sees it.
    choose(b, B_BAGRUT);
    await gsync(b, later(20));
    expect(held(server, ids.b, pair)?.bagrut).toEqual(bagrutOf(b));
    await gsync(a, later(30));
    expect(held(server, ids.a, pair)?.bagrut).toEqual(bagrutOf(a));
    expect(only(a).theirGrades?.bagrut).toEqual(bagrutOf(b));
    await gsync(b, later(40));
    expect(only(b).theirGrades?.bagrut).toEqual(bagrutOf(a));

    // A turns it off: A's box loses it, and A keeps none of B's, though B's box has it until B syncs.
    choose(a, A_GRADES);
    await gsync(a, later(50));
    expect(held(server, ids.a, pair)).not.toHaveProperty('bagrut');
    expect(held(server, ids.b, pair)).toHaveProperty('bagrut');
    expect(only(a).theirGrades).toBeTruthy();
    expect(only(a).theirGrades).not.toHaveProperty('bagrut');
    await gsync(b, later(60));
    expect(held(server, ids.b, pair)).not.toHaveProperty('bagrut');
    expect(only(b).theirGrades).not.toHaveProperty('bagrut');
  });

  it('switching off: my grades box goes at once, and theirs leaves their phone', async () => {
    const { server, a, b, pair, ids } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    await gsync(b, later(10));
    expect(only(a).theirGrades).toBeTruthy();
    expect(only(b).theirGrades).toBeTruthy();

    choose(a, PELEG);
    await stopGrades(a.kv, a.server, only(a).id);
    expect(server.boxes.has(ids.a)).toBe(false);
    expect(only(a)).toMatchObject({ theirGrades: null, gradesWritten: null });

    // B finds A's grades box gone before A's main box says why: B keeps none of A's grades, and the friend.
    expect(await gsync(b, later(20))).toEqual({ accepted: [], ended: [] });
    expect(only(b)).toMatchObject({ theirGrades: null, everRead: true });
    expect(readBuddies(b.kv).notes).toEqual([]);

    // Once A's box says it, B's grades box goes too; and A, whose choice is off, asks for B's no more.
    const since = server.calls.length;
    await gsync(a, later(30));
    expect(callsFrom(server, since, 'read')).toEqual([{ phone: 'A', op: 'read', ids: [boxIdOf(pair, 'b2a')] }]);
    expect(only(a).theirGrades).toBeNull();
    expect(await gsync(b, later(40))).toEqual({ accepted: [], ended: [] });
    expect(server.boxes.has(ids.b)).toBe(false);
    expect(only(b)).toMatchObject({ theirGrades: null, gradesWritten: null });
    expect(readBuddies(b.kv).buddies).toHaveLength(1);
  });

  it('stopGrades with the server failing: their grades go at once, my box is left for the next sync to remove', async () => {
    const { server, a, b, ids } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    expect(only(a).theirGrades).toBeTruthy();
    choose(a, PELEG);
    const down: BuddyServer = { ...a.server, remove: async () => { throw new Error('offline'); } };
    await expect(stopGrades(a.kv, down, only(a).id)).rejects.toThrow('offline');
    // Their grades leave the phone before the server is asked anything (spec 2.5); what was written stays known, to be removed.
    expect(only(a).theirGrades).toBeNull();
    expect(server.boxes.has(ids.a)).toBe(true);
    expect(only(a).gradesWritten).not.toBeNull();

    // A sync given no grades at all still deletes a box the rule no longer allows.
    await syncBuddies(a.kv, a.server, mine('פלג', later(10)), later(10));
    expect(server.boxes.has(ids.a)).toBe(false);
    expect(only(a)).toMatchObject({ theirGrades: null, gradesWritten: null });
    // And B's own box is B's: A cannot take it.
    expect(server.boxes.has(ids.b)).toBe(true);
    await expect(stopGrades(b.kv, b.server, 'nobody')).resolves.toBeUndefined();
  });

  /** `device`, whose writes of `id` reach the server and then lose their answer, as a timeout does. */
  const losingWritesOf = (device: BuddyServer, id: string): BuddyServer => ({
    ...device,
    put: async (boxes) => {
      const answer = await device.put(boxes);
      if (boxes.some((box) => box.id === id)) throw new Error('timed out');
      return answer;
    },
  });
  /** A's first sync, whose grades write reaches the server and loses its answer. */
  async function lostFirstWrite(made: Awaited<ReturnType<typeof pairedWith>>) {
    const { server, a, ids } = made;
    await expect(syncBuddies(a.kv, losingWritesOf(a.server, ids.a), mine('פלג', later(5)), later(5), own(a, later(5)))).rejects.toThrow('timed out');
    expect(server.boxes.has(ids.a)).toBe(true);
    expect(writesOf(server, 'A', ids.a)).toBe(1);
  }

  it('a grades write whose answer was lost is still taken back: I switch off and the server fails the removal', async () => {
    const made = await pairedWith(A_GRADES, B_GRADES);
    const { server, a, ids } = made;
    await lostFirstWrite(made);
    // Not known to be there, and not taken for absent either.
    expect(only(a).gradesWritten).not.toBeNull();

    choose(a, PELEG);
    const down: BuddyServer = { ...a.server, remove: async () => { throw new Error('offline'); } };
    await expect(stopGrades(a.kv, down, only(a).id)).rejects.toThrow('offline');
    expect(server.boxes.has(ids.a)).toBe(true);

    await syncBuddies(a.kv, a.server, mine('פלג', later(10)), later(10));
    expect(server.boxes.has(ids.a)).toBe(false);
    expect(only(a).gradesWritten).toBeNull();
  });

  it('a grades write whose answer was lost is taken back when the friend switches off', async () => {
    const made = await pairedWith(A_GRADES, B_GRADES);
    const { server, a, b, ids } = made;
    await lostFirstWrite(made);

    choose(b, NOA);
    await gsync(b, later(10));
    expect(server.boxes.has(ids.b)).toBe(false);
    await gsync(a, later(20));
    expect(server.boxes.has(ids.a)).toBe(false);
    expect(only(a)).toMatchObject({ theirGrades: null, gradesWritten: null });
  });

  it('a grades write whose answer was lost is written again while both stay on', async () => {
    const made = await pairedWith(A_GRADES, B_GRADES);
    const { server, a, b, ids } = made;
    await lostFirstWrite(made);

    await gsync(a, later(10));
    expect(writesOf(server, 'A', ids.a)).toBe(2);
    expect(only(a).gradesWritten).toMatchObject({ hash: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), at: later(10).toISOString() });
    // From there on, as any box written: not again before its time.
    await gsync(a, later(20));
    expect(writesOf(server, 'A', ids.a)).toBe(2);
    await gsync(b, later(30));
    expect(only(b).theirGrades).toEqual(own(a, later(10))(false));
  });

  it('the writing phone leaves bagrut out when either side has it off, whatever its grades come with', async () => {
    /** Grades that come with the bagrut part whatever they are asked for. */
    const always = (p: Phone, at: Date): MyGrades => () => own(p, at)(true);
    /** The grades box `id` as it went, before any reader: its JSON as sealed. */
    const sealed = (made: Awaited<ReturnType<typeof pairedWith>>, id: string) =>
      openSealed<Record<string, unknown>>(made.server.boxes.get(id)!.ciphertext, keyOf(made.pair));

    for (const [mineShares, theirShares] of [[A_BAGRUT, B_GRADES], [A_GRADES, B_BAGRUT]] as const) {
      const made = await pairedWith(mineShares, theirShares);
      await gsync(made.a, later(5), always(made.a, later(5)));
      expect(sealed(made, made.ids.a)).toMatchObject({ v: 1, subjects: own(made.a, later(5))(false)!.subjects });
      expect(sealed(made, made.ids.a), JSON.stringify(mineShares)).not.toHaveProperty('bagrut');
    }

    // Both chose it: it goes.
    const both = await pairedWith(A_BAGRUT, B_BAGRUT);
    await gsync(both.a, later(5), always(both.a, later(5)));
    expect(sealed(both, both.ids.a)?.bagrut).toEqual(bagrutOf(both.a));
  });

  it('their main box says off while I still hold their grades: they go, and so does my box, in that sync', async () => {
    const { server, a, b, pair, ids } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    await gsync(b, later(10));
    expect(only(a).theirGrades).toBeTruthy();

    // B turns grades off, and B's grades box stays on the server: its removal never went through.
    choose(b, { ...NOA, grades: false });
    const stuck: BuddyServer = { ...b.server, remove: async () => undefined };
    await syncBuddies(b.kv, stuck, mine('נועה', later(20)), later(20), own(b, later(20)));
    expect(held(server, ids.b, pair)).toBeTruthy();
    expect(readBoxContent(openSealed<unknown>(server.boxes.get(boxIdOf(pair, 'b2a'))!.ciphertext, keyOf(pair)))!.shares.grades).toBeFalsy();

    expect(await gsync(a, later(30))).toEqual({ accepted: [], ended: [] });
    expect(only(a)).toMatchObject({ theirGrades: null, gradesWritten: null });
    expect(server.boxes.has(ids.a)).toBe(false);
  });

  it('a choice turned off while the server answered keeps none of their grades, and takes my box back', async () => {
    const { server, a, ids } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    expect(only(a).theirGrades).toBeTruthy();
    expect(server.boxes.has(ids.a)).toBe(true);
    // A's grades box is asked for, and while the server answers, A turns grades off.
    const turningOff: BuddyServer = {
      ...a.server,
      read: async (asked) => {
        const found = await a.server.read(asked);
        choose(a, PELEG);
        return found;
      },
    };
    await syncBuddies(a.kv, turningOff, mine('פלג', later(10)), later(10), own(a, later(10)));
    expect(only(a)).toMatchObject({ shares: PELEG, theirGrades: null, gradesWritten: null });
    expect(server.boxes.has(ids.a)).toBe(false);
  });

  it('a grades box gone, or one that does not read, never ends a friendship', async () => {
    const { server, a, b, ids } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    await gsync(b, later(10));
    await gsync(a, later(15));
    expect(only(a).theirGrades).toBeTruthy();

    server.boxes.delete(ids.b);
    expect(await gsync(a, later(20))).toEqual({ accepted: [], ended: [] });
    expect(readBuddies(a.kv).buddies).toHaveLength(1);
    expect(only(a)).toMatchObject({ everRead: true, theirGrades: null });
    expect(readBuddies(a.kv).notes).toEqual([BUDDY_NOTES.accepted('נועה')]);
    // The rule still holds: my own grades box stays.
    expect(server.boxes.has(ids.a)).toBe(true);

    await b.server.put([{ id: ids.b, kind: 'pair', ciphertext: 'AAAA' }]);
    expect(await gsync(a, later(25))).toEqual({ accepted: [], ended: [] });
    expect(only(a)).toMatchObject({ everRead: true, theirGrades: null });
    expect(readBuddies(a.kv).notes).toEqual([BUDDY_NOTES.accepted('נועה')]);
  });

  it("an older app's box, with no grades in it: nothing is written to it", async () => {
    // An older app answers and writes as it always did: two switches, and no grades box.
    const older = (at: Date) => (shares: BuddyShares): BuddyBoxContent => ({
      v: 1, at: at.toISOString(), name: 'נועה', shares: { timetable: shares.timetable, absences: shares.absences },
    });
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const b = phone(server, 'B', 'נועה');
    const secret = await createInvite(a.kv, a.server, A_GRADES, NOW);
    if (secret === 'full') throw new Error('full');
    expect(await acceptInvite(b.kv, b.server, secret, NOA, older(NOW), NOW)).toBe('ok');
    await gsync(a, later(5));
    await syncBuddies(b.kv, b.server, older(later(10)), later(10));
    await gsync(a, later(70));

    const pair = only(b).secret;
    expect(only(a).everRead).toBe(true);
    expect(theirSharesOf(only(a)).grades).toBeFalsy();
    expect(server.boxes.has(boxIdOf(pair, 'a2b-grades'))).toBe(false);
    expect(writesOf(server, 'A', boxIdOf(pair, 'a2b-grades'))).toBe(0);
    expect(only(a)).toMatchObject({ theirGrades: null, gradesWritten: null, gradesDot: false });
  });

  it('unchanged grades are not written again before 30 days, and are at 30 days', async () => {
    const { server, a, ids } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    expect(writesOf(server, 'A', ids.a)).toBe(1);
    // Mashov read again, the same grades: only `at` changed.
    await gsync(a, later(5 + 29 * DAY));
    expect(writesOf(server, 'A', ids.a)).toBe(1);
    await gsync(a, later(5 + 30 * DAY));
    expect(writesOf(server, 'A', ids.a)).toBe(2);
    expect(only(a).gradesWritten).toMatchObject({ at: later(5 + 30 * DAY).toISOString() });
    // A change goes at once.
    await gsync(a, later(6 + 30 * DAY), gradesOf(95, later(6 + 30 * DAY)));
    expect(writesOf(server, 'A', ids.a)).toBe(3);
  });

  it('no Mashov read (myGrades returns null): nothing written, the friend keeps waiting', async () => {
    const { server, a, b, ids } = await pairedWith(A_GRADES, B_GRADES);
    const none: MyGrades = () => null;
    await gsync(a, later(5), none);
    await gsync(b, later(10));
    await gsync(a, later(15), none);
    expect(server.boxes.has(ids.a)).toBe(false);
    expect(only(a).gradesWritten).toBeNull();
    // A still gets B's; B waits for A's, a friend all the same.
    expect(only(a).theirGrades).toBeTruthy();
    expect(only(b)).toMatchObject({ everRead: true, theirGrades: null });

    // Once A's phone has read Mashov, A's box goes; a sync given no grades at all neither writes nor removes it.
    await gsync(a, later(20));
    expect(server.boxes.has(ids.a)).toBe(true);
    await syncBuddies(a.kv, a.server, mine('פלג', later(25)), later(25));
    expect(server.boxes.has(ids.a)).toBe(true);
    expect(only(a).gradesWritten).not.toBeNull();
  });

  it('removeBuddy and dropAllBoxes remove the grades box too', async () => {
    const one = await pairedWith(A_GRADES, B_GRADES);
    await gsync(one.a, later(5));
    expect(heldBy(one.server, 'A')).toEqual([boxIdOf(one.pair, 'a2b'), one.ids.a].sort());
    await removeBuddy(one.a.kv, one.a.server, only(one.a).id);
    expect(heldBy(one.server, 'A')).toEqual([]);

    const two = await pairedWith(A_GRADES, B_GRADES);
    await gsync(two.a, later(5));
    await gsync(two.b, later(10));
    expect(heldBy(two.server, 'B')).toEqual([boxIdOf(two.pair, 'b2a'), two.ids.b].sort());
    await dropAllBoxes(two.b.kv, two.b.server);
    expect(heldBy(two.server, 'B')).toEqual([]);
    await dropAllBoxes(two.a.kv, two.a.server);
    expect(two.server.boxes.size).toBe(0);
  });

  it('a friend who ended it: my grades box goes with my main box', async () => {
    const { server, a, b } = await pairedWith(A_GRADES, B_GRADES);
    await gsync(a, later(5));
    await gsync(b, later(10));
    await removeBuddy(a.kv, a.server, only(a).id);
    expect(await gsync(b, later(20))).toEqual({ accepted: [], ended: ['פלג'] });
    expect(heldBy(server, 'B')).toEqual([]);
    expect(server.boxes.size).toBe(0);

    // And a pairing that never completed: the grades box written with the answer goes with the rest.
    const never = await pairedWith(A_GRADES, B_GRADES);
    expect(heldBy(never.server, 'B')).toHaveLength(3);
    expect(await gsync(never.b, later((BUDDY_INVITE_TTL_DAYS + 1) * DAY))).toEqual({ accepted: [], ended: ['פלג'] });
    expect(heldBy(never.server, 'B')).toEqual([]);
  });

  it('box counts: twenty friends with grades are forty boxes, read in one request', async () => {
    const server = fakeServer();
    const a = phone(server, 'A', 'פלג');
    const buddies = Array.from({ length: MAX_BUDDIES }, (_, i) => buddy(`g${i}`, { role: i % 2 ? 'inviter' : 'invitee', shares: A_GRADES, offered: B_GRADES }));
    saveBuddies(a.kv, { ...readBuddies(a.kv), buddies });
    expect(await gsync(a, NOW)).toEqual({ accepted: [], ended: [] });
    expect(server.calls.map((x) => [x.op, x.ids.length])).toEqual([['put', MAX_BUDDIES], ['read', 2 * MAX_BUDDIES], ['put', MAX_BUDDIES]]);
    expect(heldBy(server, 'A')).toHaveLength(2 * MAX_BUDDIES);
    expect(2 * MAX_BUDDIES).toBeLessThanOrEqual(BUDDY_BOXES_PER_DEVICE);
    expect(readBuddies(a.kv).buddies.every((x) => x.gradesWritten?.at === NOW.toISOString())).toBe(true);
  });

  it('the dot: on when they turn grades on and I have not, off when they turn them off', async () => {
    // The inviter learns it from the answer, before their box is read.
    const one = await pairedWith(PELEG, B_GRADES);
    expect(only(one.b).gradesDot).toBe(false);
    await gsync(one.a, later(5));
    expect(only(one.a).gradesDot).toBe(true);

    // Later, from their box.
    const { a, b } = await pairedWith(PELEG, NOA);
    await gsync(a, later(5));
    await gsync(b, later(10));
    expect(only(a).gradesDot).toBe(false);
    choose(b, B_GRADES);
    await gsync(b, later(20));
    await gsync(a, later(30));
    expect(only(a).gradesDot).toBe(true);

    // They turn it off: the dot goes, the tab not opened.
    choose(b, NOA);
    await gsync(b, later(40));
    await gsync(a, later(50));
    expect(only(a).gradesDot).toBe(false);

    // On again: it comes back. Once it is cleared, the same box does not bring it back.
    choose(b, B_GRADES);
    await gsync(b, later(60));
    await gsync(a, later(70));
    expect(only(a).gradesDot).toBe(true);
    const state = readBuddies(a.kv);
    saveBuddies(a.kv, { ...state, buddies: state.buddies.map((x) => ({ ...x, gradesDot: false })) });
    await gsync(b, later(130));
    await gsync(a, later(140));
    expect(only(a).gradesDot).toBe(false);
  });

  it('the dot for bagrut: they share it and I do not; none when we share the same', async () => {
    const { server, a, b, pair, ids } = await pairedWith(A_GRADES, B_BAGRUT);
    await gsync(a, later(5));
    expect(only(a).gradesDot).toBe(true);
    expect(only(b).gradesDot).toBe(false);
    expect(held(server, ids.b, pair)).not.toHaveProperty('bagrut');

    const same = await pairedWith(A_GRADES, B_GRADES);
    await gsync(same.a, later(5));
    await gsync(same.b, later(10));
    expect(only(same.a).gradesDot).toBe(false);
    expect(only(same.b).gradesDot).toBe(false);
  });

  /**
   * The tests above build the main box with the stub `mine`, which passes the switches through. These build it as the
   * app does (`myBoxContent`): once a friend's main box has been read, it is what `theirSharesOf` goes by, so the
   * grades flow only if the box the app writes says they are on.
   */
  describe('with the main box the app builds', () => {
    /** My main box as `myBoxContent` makes it: a timetable with nothing in it, so only the name and the switches count. */
    const built = (name: string, at: Date) => (shares: BuddyShares): BuddyBoxContent => myBoxContent({
      name, shares, days: [], attendance: null, siteUrl: null, classId: '7', className: 'יב2', hiddenSubjects: [], mashovSchool: null,
      readAt: null, now: at,
    });
    /** A sync with the main box the app builds and the phone's own grades. */
    const bsync = (p: Phone, at: Date) => syncBuddies(p.kv, p.server, built(p.name, at), at, own(p, at));

    /** `pairedWith`, B answering with the main box the app builds. */
    async function builtPair(aShares: BuddyShares, bShares: BuddyShares) {
      const made = await invitedWith(aShares);
      expect(await acceptInvite(made.b.kv, made.b.server, made.secret, bShares, built('נועה', NOW), NOW, own(made.b, NOW))).toBe('ok');
      const pair = only(made.b).secret;
      return { ...made, pair, ids: { a: boxIdOf(pair, 'a2b-grades'), b: boxIdOf(pair, 'b2a-grades') } };
    }
    /** What the main box `label` on the server says its writer shares. */
    const said = (server: Server, pair: string, label: 'a2b' | 'b2a') =>
      readBoxContent(openSealed<unknown>(server.boxes.get(boxIdOf(pair, label))!.ciphertext, keyOf(pair)))!.shares;

    it('both on: the grades go both ways; one turns them off: they go from both phones and from the server', async () => {
      const { server, a, b, pair, ids } = await builtPair(A_GRADES, B_GRADES);
      await bsync(a, later(5));
      await bsync(b, later(10));
      // Each phone, going by the other's main box now and no longer by the invite or the reply, holds the other's grades.
      expect(only(a).theirGrades).toEqual(own(b, NOW)(false));
      expect(only(b).theirGrades).toEqual(own(a, later(5))(false));
      expect(only(a)).toMatchObject({ everRead: true, theirs: { shares: B_GRADES } });
      expect(only(b)).toMatchObject({ everRead: true, theirs: { shares: A_GRADES } });
      expect(said(server, pair, 'a2b')).toEqual(A_GRADES);
      expect(said(server, pair, 'b2a')).toEqual(B_GRADES);

      // B turns grades off, as the share sheet does: the choice, then the box at once; then B's phone syncs, then A's.
      choose(b, NOA);
      await stopGrades(b.kv, b.server, only(b).id);
      await bsync(b, later(20));
      expect(said(server, pair, 'b2a')).not.toHaveProperty('grades');
      await bsync(a, later(30));
      expect(only(a)).toMatchObject({ theirGrades: null, gradesWritten: null });
      expect(only(b)).toMatchObject({ theirGrades: null, gradesWritten: null });
      // No grades box is left on the server: only the two main boxes.
      expect([...server.boxes.keys()].sort()).toEqual([boxIdOf(pair, 'a2b'), boxIdOf(pair, 'b2a')].sort());
      expect(server.boxes.has(ids.a) || server.boxes.has(ids.b)).toBe(false);
      expect(readBuddies(a.kv).buddies).toHaveLength(1);
      expect(readBuddies(b.kv).buddies).toHaveLength(1);
    });

    it('a friend who turns grades on later is seen, with the dot, and the grades flow once both are on', async () => {
      const { server, a, b, ids } = await builtPair(PELEG, NOA);
      await bsync(a, later(5));
      await bsync(b, later(10));
      expect(theirSharesOf(only(b)).grades).toBeFalsy();
      expect(only(b).gradesDot).toBe(false);

      choose(a, A_GRADES);
      await bsync(a, later(20));
      await bsync(b, later(30));
      // B sees it from A's main box: the grades tab asks, and nothing of A's grades has left A's phone.
      expect(theirSharesOf(only(b)).grades).toBe(true);
      expect(only(b).gradesDot).toBe(true);
      expect(server.boxes.has(ids.a)).toBe(false);

      // B turns them on too: B's grades go in that sync, A's in A's next, and each phone holds the other's.
      choose(b, B_GRADES);
      await bsync(b, later(40));
      expect(server.boxes.has(ids.b)).toBe(true);
      await bsync(a, later(50));
      expect(theirSharesOf(only(a)).grades).toBe(true);
      expect(only(a).theirGrades).toEqual(own(b, later(40))(false));
      await bsync(b, later(60));
      expect(only(b).theirGrades).toEqual(own(a, later(50))(false));
    });
  });
});

describe('the notes', () => {
  it('says who arrived, who left, and whose pairing did not complete, each name in an isolate', () => {
    expect(BUDDY_NOTES.accepted('נועה')).toBe(`${iso('נועה')} עכשיו ברשימת החברים שלך`);
    expect(BUDDY_NOTES.ended('נועה')).toBe(`${iso('נועה')}: כבר לא חברים`);
    expect(BUDDY_NOTES.incomplete('נועה')).toBe(`${iso('נועה')}: החיבור לא הושלם`);
  });
});
