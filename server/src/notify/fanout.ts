/**
 * A class's changes, pushed to each device that follows it (plan Phase 2).
 *
 * The decisions are the engine's (`planNotifications`), made once per
 * device with that device's preferences: which lines are not its student's,
 * which pushes it wants, its quiet hours, "חופש". The sending is per device,
 * and so is the dedupe: `DeviceNotification` is unique per (device, key), so
 * reconsidering an event can never push it twice.
 *
 * An event is done once no device is still waiting for it (quiet hours, or
 * "today's changes" before 06:00). Whatever is still pending a day later is
 * closed anyway: by then it is not news.
 *
 * A parent's phone follows its own class and up to five more (`ClassFollow`),
 * each with that child's hidden lines. Its pushes then say which class they
 * are about: the class's name before the title, and the class in the payload
 * for the tap.
 */
import type { Device, PrismaClient } from '@prisma/client';
import type { ClassLesson, DevicePrefs, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS, NOTIFICATION_TYPES, mergeDevicePrefs } from '@sederyom/shared';
import type { TimetableLine } from '@sederyom/shared/logic/filters';
import { siteLines } from '@sederyom/shared/logic/ownNames';
import { DateTime } from 'luxon';
import { hiddenSubjectsOf, namesOf } from '../lib/devices.js';
import { addDays, timeStrOf, toDateStr } from '../lib/time.js';
import { type PendingChange, isSuppressedByQuietHours, planNotifications } from './engine.js';
import type { OutgoingPush, Pusher } from './push.js';
import { isolatePush } from './text.js';
import type { Logger } from '../lib/logger.js';

const MAX_EVENTS_PER_RUN = 1000;
const STALE_AFTER_MS = 24 * 3600_000;

export interface FanoutDeps {
  prisma: PrismaClient;
  pusher: Pusher;
  logger: Logger;
  zone: string;
}

export interface FanoutResult {
  sent: number;
  deferred: number;
  closed: number;
}

/** The engine's settings shape, as one device's preferences fill it. */
export function settingsForDevice(prefs: DevicePrefs): UserSettings {
  const off = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, false])) as UserSettings['notifications'];
  return {
    ...DEFAULT_SETTINGS,
    // Only the school site's pushes come from the server; the rest are the phone's own.
    notifications: { ...off, ...prefs.notifications },
    quietHours: prefs.quietHours,
    vacationMode: prefs.vacationMode,
    lessons: { hiddenSubjects: prefs.hiddenSubjects, subjectNames: prefs.subjectNames },
  };
}

/** A device that hears of one class's changes. */
interface Follower {
  device: Device;
  /** When it began following the class: it hears of what changed after, not the class's history. */
  since: Date;
  /** The class's lines that are not this device's student, or this child. */
  hiddenSubjects: string[];
  /** The student's, or this child's, own names for the class's subjects (`subjectNames` of the prefs that hold them). */
  subjectNames: Record<string, string>;
  /** One of a parent's other classes (`ClassFollow`), not the device's own. */
  other: boolean;
  /** How many classes the device follows. */
  follows: number;
}

/** The devices with a push address that follow the class: as their own, or as one of their other classes. */
async function followersOf(prisma: PrismaClient, classId: string): Promise<Follower[]> {
  const counted = { _count: { select: { follows: true } } } as const;
  const own = await prisma.device.findMany({ where: { classId, pushToken: { not: null } }, include: counted });
  const others = await prisma.classFollow.findMany({
    where: { classId, device: { pushToken: { not: null } } },
    include: { device: { include: counted } },
  });
  const ownIds = new Set(own.map((d) => d.id));
  return [
    ...own.map((d) => {
      const prefs = mergeDevicePrefs(d.prefs);
      return { device: d, since: d.createdAt, hiddenSubjects: prefs.hiddenSubjects, subjectNames: prefs.subjectNames, other: false, follows: 1 + d._count.follows };
    }),
    // A class that is a device's own and one of its others too is one follow (the routes keep it from happening).
    ...others
      .filter((f) => !ownIds.has(f.deviceId))
      .map((f) => ({
        device: f.device, since: f.createdAt, hiddenSubjects: hiddenSubjectsOf(f.prefs), subjectNames: namesOf(f.prefs), other: true,
        follows: (f.device.classId ? 1 : 0) + f.device._count.follows,
      })),
  ];
}

/** A push to a phone that follows more than one class: which class it is about, in the title and for the tap. */
export function namedForClass(push: OutgoingPush, cls: { name: string; shahafClassId: string; school: { shahafUrl: string } }): OutgoingPush {
  return {
    ...push,
    title: `${cls.name}: ${push.title}`,
    payload: { ...push.payload, class: { siteUrl: cls.school.shahafUrl, classId: cls.shahafClassId } },
  };
}

/**
 * The class site's lines, as the feed carries them to a phone: the snapshot's
 * live lessons dated from a week back, each line once. The student's names are
 * decided against them (`nameContext`), the phone's and the server's alike.
 */
async function classLines(prisma: PrismaClient, classId: string, today: string, zone: string): Promise<TimetableLine[]> {
  const from = addDays(today, -7, zone);
  const rows = await prisma.classSnapshot.findMany({ where: { classId, kind: 'lesson', deletedAt: null }, select: { payload: true } });
  return siteLines(rows.map((r) => r.payload as unknown as ClassLesson).filter((lesson) => lesson.date >= from));
}

/** The class's lessons of one day, as its site has them now. */
async function lessonsOn(prisma: PrismaClient, classId: string, date: string): Promise<ClassLesson[]> {
  const rows = await prisma.classSnapshot.findMany({ where: { classId, kind: 'lesson', partition: date, deletedAt: null }, select: { payload: true } });
  return rows.map((r) => r.payload as unknown as ClassLesson);
}

export async function dispatchClassChanges(deps: FanoutDeps, now: Date): Promise<FanoutResult> {
  const rows = await deps.prisma.classChangeEvent.findMany({
    where: { notifiedAt: null },
    orderBy: { id: 'asc' },
    take: MAX_EVENTS_PER_RUN,
  });
  const result: FanoutResult = { sent: 0, deferred: 0, closed: 0 };
  if (rows.length === 0) return result;

  const nowDt = DateTime.fromJSDate(now).setZone(deps.zone);
  const today = toDateStr(nowDt);
  const nowTime = timeStrOf(nowDt);
  const planCtx = { today, tomorrow: addDays(today, 1, deps.zone), nowTime };

  const byClass = new Map<string, typeof rows>();
  for (const row of rows) byClass.set(row.classId, [...(byClass.get(row.classId) ?? []), row]);

  for (const [classId, classRows] of byClass) {
    const followers = await followersOf(deps.prisma, classId);
    // The class's name, for a device that follows more than one.
    const named = followers.some((f) => f.follows > 1)
      ? await deps.prisma.schoolClass.findUnique({
          where: { id: classId },
          select: { name: true, shahafClassId: true, school: { select: { shahafUrl: true } } },
        })
      : null;
    // The class's lines, read once, and only for a class some follower has names for and an exam to name by
    // them: a lesson is named by its line's key alone (`lessonName`).
    let lines: TimetableLine[] | undefined;
    if (classRows.some((r) => r.kind === 'exam') && followers.some((f) => Object.keys(f.subjectNames).length > 0)) {
      try {
        lines = await classLines(deps.prisma, classId, today, deps.zone);
      } catch (err) {
        // Names are cosmetic: without the lines, a line's and a block's own keys still name, and every push still goes.
        deps.logger.warn({ classId, err: String(err) }, 'class lines read failed');
      }
    }
    // Today's lessons, read once, and only for a class with a change to today: after the last one it is not news.
    let todayLessons: ClassLesson[] | undefined;
    if (classRows.some((r) => r.kind === 'lesson' && (r.payload as unknown as PendingChange['payload']).partition === today)) {
      try {
        todayLessons = await lessonsOn(deps.prisma, classId, today);
      } catch (err) {
        // Without them the day is not known to be over, and the push still goes.
        deps.logger.warn({ classId, err: String(err) }, 'today lessons read failed');
      }
    }
    // Ids some device still waits for; everything else in this class is done.
    const waiting = new Set<number>();

    for (const { device, since, hiddenSubjects, subjectNames, other, follows } of followers) {
      // What changed after the device began to follow the class; and the class's new exam board is news to every
      // follower but the device that brought it (nothing is waiting for it there: it is not this device's event).
      const after = classRows.filter((r) => r.createdAt >= since && !broughtBy(r, device.id));
      if (after.length === 0) continue;
      // An event another device still waits for is read again on every run; what
      // this device was already told must not ride along in its next day's batch.
      const told = await toldOf(deps.prisma, device.id, after.map((r) => r.id));
      const fresh = after.filter((r) => !told.has(r.id));
      if (fresh.length === 0) continue;
      // This class's lines and names, not the device's own: a parent's other child has its own.
      const settings = settingsForDevice({ ...mergeDevicePrefs(device.prefs), hiddenSubjects, subjectNames });
      const events: PendingChange[] = fresh.map((r) => ({
        id: r.id,
        source: 'shahaf',
        kind: r.kind,
        naturalKey: r.naturalKey,
        change: r.change as PendingChange['change'],
        payload: r.payload as unknown as PendingChange['payload'],
      }));
      const { planned, discardedIds } = planNotifications(events, { settings, ...planCtx, classId, lines, todayLessons });
      const handled = new Set(discardedIds);
      for (const item of planned) item.eventIds.forEach((id) => handled.add(id));
      // Planned neither way: deferred by the engine itself ("today" before 06:00).
      for (const e of events) if (!handled.has(e.id)) waiting.add(e.id);

      for (const item of planned) {
        if (isSuppressedByQuietHours(item.type, settings, nowTime)) {
          item.eventIds.forEach((id) => waiting.add(id));
          result.deferred += 1;
          continue;
        }
        const push = follows > 1 && named ? namedForClass(item.push, named) : item.push;
        // Two classes can share an exam's or a lesson's key: an other class's say which class.
        const dedupeKey = other ? `${classId}|${item.dedupeKey}` : item.dedupeKey;
        const delivered = await sendToDevice(deps, device.id, device.pushToken!, item.type, push, dedupeKey, item.eventIds, now);
        if (delivered === 'failed') item.eventIds.forEach((id) => waiting.add(id));
        if (delivered === 'sent') result.sent += 1;
      }
    }

    const done = classRows.filter((r) => !waiting.has(r.id) || now.getTime() - r.createdAt.getTime() > STALE_AFTER_MS).map((r) => r.id);
    if (done.length > 0) {
      await deps.prisma.classChangeEvent.updateMany({ where: { id: { in: done } }, data: { notifiedAt: now } });
      result.closed += done.length;
    }
  }
  return result;
}

/** Whether the event says that this device brought the class's exam board (`announceBoard`): it is not told of its own. */
function broughtBy(event: { kind: string; payload: unknown }, deviceId: string): boolean {
  if (event.kind !== 'exam_board') return false;
  const after = (event.payload as { after?: { setBy?: unknown } | null } | null)?.after;
  return after?.setBy === deviceId;
}

/** Which of these events a push to the device already carried. */
async function toldOf(prisma: PrismaClient, deviceId: string, ids: number[]): Promise<Set<number>> {
  const rows = await prisma.deviceNotification.findMany({ where: { deviceId, eventIds: { hasSome: ids } }, select: { eventIds: true } });
  return new Set(rows.flatMap((r) => r.eventIds));
}

async function sendToDevice(
  deps: FanoutDeps,
  deviceId: string,
  pushToken: string,
  type: string,
  outgoing: Parameters<Pusher['send']>[1],
  dedupeKey: string,
  eventIds: number[],
  now: Date,
): Promise<'sent' | 'duplicate' | 'failed'> {
  const existing = await deps.prisma.deviceNotification.findUnique({ where: { deviceId_dedupeKey: { deviceId, dedupeKey } } });
  if (existing) return 'duplicate';
  const push = isolatePush(outgoing);
  const res = await deps.pusher.send([pushToken], push);
  if (res.invalidTokens.includes(pushToken)) {
    // Uninstalled, or the token rotated: stop pushing to it until the app reports a new one.
    await deps.prisma.device.update({ where: { id: deviceId }, data: { pushToken: null } });
    return 'duplicate';
  }
  if (!res.ok) {
    deps.logger.error({ deviceId, type, error: res.error }, 'device push failed');
    return 'failed';
  }
  await deps.prisma.deviceNotification.create({ data: { deviceId, type, title: push.title, body: push.body, dedupeKey, eventIds, sentAt: now } });
  return 'sent';
}
