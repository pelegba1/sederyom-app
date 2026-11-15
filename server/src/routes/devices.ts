/**
 * `/v2`: the many-students API (plan Phase 2). Every route but registration
 * runs as the calling device (`request.device`, set by the auth hook in
 * app.ts). What a device can reach is its own row and the public feeds of the
 * classes it follows, nothing else: its own class, and on a parent's phone up
 * to five more (`ClassFollow`, parents mode stage 2).
 */
import { Prisma, type Device, type PrismaClient } from '@prisma/client';
import type {
  ClassEvent, ClassExam, ClassFeed, ClassHistory, ClassHistoryLesson, ClassLesson, ClassListResponse, ClassMessage, ClassOption, DeviceClass,
  DeviceResponse, FollowedClass, LessonStatus, RegisterDeviceResponse, ScheduleChange, SchoolCalendarResponse,
} from '@sederyom/shared';
import { DateTime } from 'luxon';
import { schoolYearStart } from '../history/backfill.js';
import { CLASS_FEED_PAST_DAYS, DEVICE_NOTIFICATION_TYPES, MAX_FOLLOWED_CLASSES, mergeDevicePrefs } from '@sederyom/shared';
import { calendarExams, isCalendarTooBig } from '@sederyom/shared/logic/exam-board/calendar';
import { splitSiteTwins, withoutSiteTwins } from '@sederyom/shared/logic/exam-match';
import { SUBJECT_NAME_KEY_MAX, SUBJECT_NAME_MAX, SUBJECT_NAMES_MAX, subjectNamesOf } from '@sederyom/shared/logic/ownNames';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { chatRowsOf } from '../chat/tokens.js';
import { BoardError } from '../exam-board/errors.js';
import { BOARD_LOCKED, announceAgain, announceCalendarBoard, boardInfoFor, changeBoard, hasBoard, storeBoardExams } from '../exam-board/store.js';
import { hashDeviceToken, hiddenSubjectsOf, mintDeviceToken, normalizeCalendarId, normalizeShahafUrl } from '../lib/devices.js';
import { addDays, SCHOOL_CALENDAR_REVISION, SCHOOL_DAYS_OFF, todayStr } from '../lib/time.js';
import { FOLLOWED } from '../sync/classes.js';
import { settleBoxes } from './buddies.js';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected a time of day as HH:mm');

const registerBody = z.object({ platform: z.enum(['android', 'ios']) });

/**
 * The student's own names for subjects: key → name, at most `SUBJECT_NAMES_MAX` of them, a key of
 * 1 to `SUBJECT_NAME_KEY_MAX` characters and a name of 1 to `SUBJECT_NAME_MAX` on one line. The
 * phone cleans a name before it sends it; this is the bound for a client that does not.
 */
const subjectNamesBody = z
  .record(
    z.string().min(1).max(SUBJECT_NAME_KEY_MAX),
    z.string().min(1).max(SUBJECT_NAME_MAX).regex(/^[^\r\n]*$/, 'expected a name on one line'),
  )
  .refine((names) => Object.keys(names).length <= SUBJECT_NAMES_MAX, `expected at most ${SUBJECT_NAMES_MAX} names`);

const updateBody = z.object({
  pushToken: z.string().min(10).max(500).nullable().optional(),
  class: z
    .object({
      siteUrl: z.string().min(1).max(200),
      classId: z.string().min(1).max(40),
      className: z.string().max(100).optional(),
    })
    .nullable()
    .optional(),
  prefs: z
    .object({
      notifications: z.record(z.enum(DEVICE_NOTIFICATION_TYPES), z.boolean()),
      quietHours: z.object({ enabled: z.boolean(), from: timeOfDay, to: timeOfDay }).partial(),
      vacationMode: z.boolean(),
      hiddenSubjects: z.array(z.string().min(1).max(200)).max(200),
      subjectNames: subjectNamesBody,
    })
    .partial()
    .optional(),
  semel: z.number().int().positive().optional(),
  examCalendar: z.string().min(1).max(500).nullable().optional(),
});

/** The classes the device follows besides its own: a parent's other children. */
const classesBody = z.object({
  classes: z
    .array(
      z.object({
        siteUrl: z.string().min(1).max(200),
        classId: z.string().min(1).max(40),
        hiddenSubjects: z.array(z.string().min(1).max(200)).max(200).optional(),
        subjectNames: subjectNamesBody.optional(),
      }),
    )
    // Its own class may be listed too, and is skipped; what is left is checked after.
    .max(MAX_FOLLOWED_CLASSES),
});

// The board's columns come with every class: `examBoard` says what the class has and whose it is, and `exams` is
// how many (one JSON value, so the count cannot be asked of the database).
const CLASS_SELECT = {
  shahafClassId: true, name: true, examCalendarId: true, examCalendarSetBy: true, examBoardKind: true, examBoardSetAt: true, exams: true,
  school: { select: { shahafUrl: true } },
} as const;
type ClassRef = {
  shahafClassId: string;
  name: string;
  examCalendarId: string | null;
  examCalendarSetBy: string | null;
  examBoardKind: string | null;
  examBoardSetAt: Date | null;
  exams: Prisma.JsonValue;
  school: { shahafUrl: string };
};
type DeviceWithClass = Device & {
  class: ClassRef | null;
  follows: { classId: string; prefs: Prisma.JsonValue; class: ClassRef }[];
};

export async function loadDevice(prisma: PrismaClient, id: string): Promise<DeviceWithClass | null> {
  return prisma.device.findUnique({
    where: { id },
    include: {
      class: { select: CLASS_SELECT },
      follows: { orderBy: [{ createdAt: 'asc' }, { classId: 'asc' }], select: { classId: true, prefs: true, class: { select: CLASS_SELECT } } },
    },
  });
}

/**
 * The class as the device sees it. `examBoard` is left out when the class has no board; whether the device may
 * replace it is asked of the lock, for the device's own class only (`boardInfoFor`).
 */
async function classOf(prisma: PrismaClient, cls: ClassRef, classId: string, device: { id: string; classId: string | null }): Promise<DeviceClass> {
  const examBoard = await boardInfoFor(prisma, cls, device.id, classId, classId === device.classId);
  return {
    siteUrl: cls.school.shahafUrl,
    classId: cls.shahafClassId,
    className: cls.name,
    examCalendarId: cls.examCalendarId,
    ...(examBoard ? { examBoard } : {}),
  };
}

async function deviceClassOf(prisma: PrismaClient, device: DeviceWithClass): Promise<DeviceClass | null> {
  return device.class && device.classId ? classOf(prisma, device.class, device.classId, device) : null;
}

async function otherClassesOf(prisma: PrismaClient, device: DeviceWithClass): Promise<FollowedClass[]> {
  return Promise.all(
    device.follows.map(async (f) => ({ ...(await classOf(prisma, f.class, f.classId, device)), hiddenSubjects: hiddenSubjectsOf(f.prefs) })),
  );
}

export async function toResponse(prisma: PrismaClient, device: DeviceWithClass): Promise<DeviceResponse> {
  return {
    deviceId: device.id,
    platform: device.platform as DeviceResponse['platform'],
    class: await deviceClassOf(prisma, device),
    prefs: mergeDevicePrefs(device.prefs),
    hasPushToken: device.pushToken !== null,
    otherClasses: await otherClassesOf(prisma, device),
  };
}

function badRequest(reply: FastifyReply, error: string, message: string) {
  void reply.code(400);
  return { error, message };
}

/** What a new calendar is read in: the request waits this long for it, and no more. */
const READ_NOW_MS = 10_000;

/** How often the feed route notes that a device was seen (`lastSeenAt`), at most: once a day. */
const SEEN_EVERY_MS = 24 * 60 * 60 * 1000;

/** The columns of a calendar's exams, emptied: a calendar that was just set is read afresh, a board that was cleared has none. */
const NO_EXAMS = { exams: Prisma.DbNull, examsPolledAt: null, examsOkAt: null, examsError: null } as const;

const SITE_UNREACHABLE = { error: 'site_unreachable', message: 'לא הצלחנו לקרוא את אתר המערכת של בית הספר. כדאי לנסות שוב בעוד רגע.' };

export function registerDeviceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { services } = deps;
  const { prisma } = services;

  /**
   * The `SchoolClass` row of a class the site lists, made when it is new and
   * named as the site names it; `null` when the site does not list it. The
   * class has to be on the site: nothing gets polled on a device's word alone.
   * Throws when the site cannot be read. `lists` keeps each site's list for
   * one request: a parent's children are often at one school.
   */
  async function classOnSite(
    siteUrl: string,
    shahafClassId: string,
    opts: { semel?: number; lists?: Map<string, Promise<ClassOption[]>> } = {},
  ): Promise<{ id: string } | null> {
    let listed = opts.lists?.get(siteUrl);
    if (!listed) {
      listed = services.shahafFor(siteUrl).fetchClasses();
      opts.lists?.set(siteUrl, listed);
    }
    const option = (await listed).find((c) => c.id === shahafClassId);
    if (!option) return null;
    const school = await prisma.school.upsert({
      where: { shahafUrl: siteUrl },
      create: { shahafUrl: siteUrl, semel: opts.semel ?? null },
      update: opts.semel ? { semel: opts.semel } : {},
    });
    const cls = await prisma.schoolClass.upsert({
      where: { schoolId_shahafClassId: { schoolId: school.id, shahafClassId: option.id } },
      create: { schoolId: school.id, shahafClassId: option.id, name: option.name },
      update: { name: option.name },
    });
    return { id: cls.id };
  }

  /**
   * Notes that `device` was seen now (`lastSeenAt`), when it was last noted more than `SEEN_EVERY_MS` ago: a device
   * seen within that is not written to, nor even asked of the database again. The write is held to a `lastSeenAt` that
   * is still that old, so reads at the same moment write it once.
   */
  async function markSeen(device: Pick<Device, 'id' | 'lastSeenAt'>): Promise<void> {
    const now = new Date();
    const since = new Date(now.getTime() - SEEN_EVERY_MS);
    if (device.lastSeenAt && device.lastSeenAt.getTime() >= since.getTime()) return;
    await prisma.device.updateMany({ where: { id: device.id, lastSeenAt: { lt: since } }, data: { lastSeenAt: now } });
  }

  /**
   * Reads a calendar that was just set and keeps its exams, so that the class does not wait for the next tick
   * (an onboarding step would stay empty until a quarter of an hour after the link). Whatever goes wrong, the
   * calendar's id stays and the read is left to the tick: the request is not failed by it, and waits at most
   * `READ_NOW_MS`. A calendar of more exams than a board holds is noted as the tick notes it (`examsError`). The log
   * gets the name of what went wrong and nothing it said.
   */
  async function readCalendarNow(request: FastifyRequest, classId: string, calendarId: string): Promise<void> {
    const zone = services.env.TIMEZONE;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BoardError('unreachable')), READ_NOW_MS);
    });
    try {
      const ics = await Promise.race([services.fetchIcs(calendarId), late]);
      const { exams } = calendarExams(ics, todayStr(zone), zone);
      const now = new Date();
      // The class's first exams: its followers are told, but for this device, which set the calendar. Never a failed read.
      if (await storeBoardExams(prisma, classId, exams, now, calendarId)) await announceCalendarBoard(prisma, classId, now, request.log);
    } catch (err) {
      request.log.warn({ err: { name: err instanceof Error ? err.name : typeof err } }, 'exam calendar not read at once');
      // A calendar of more exams than a board holds is read as the hourly read would: nothing of it is kept, and the error
      // is noted, held to the calendar that was read. Any other failure is the tick's to try again.
      if (isCalendarTooBig(err)) {
        await prisma.schoolClass
          .updateMany({ where: { id: classId, examCalendarId: calendarId }, data: { examsPolledAt: new Date(), examsError: String(err).slice(0, 500) } })
          .catch(() => undefined);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  app.post('/v2/devices', async (request, reply): Promise<RegisterDeviceResponse | { error: string; message: string }> => {
    const parsed = registerBody.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'invalid_device', 'platform: expected android or ios');
    const token = mintDeviceToken();
    const device = await prisma.device.create({
      data: { tokenHash: hashDeviceToken(token), platform: parsed.data.platform, prefs: mergeDevicePrefs({}) as object },
    });
    void reply.code(201);
    return { deviceId: device.id, token };
  });

  app.get('/v2/device', async (request): Promise<DeviceResponse> => {
    const device = (await loadDevice(prisma, request.device!.id))!;
    return toResponse(prisma, device);
  });

  app.put('/v2/device', async (request, reply) => {
    const parsed = updateBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return badRequest(reply, 'invalid_device', `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`);
    }
    const body = parsed.data;
    const id = request.device!.id;

    let classId: string | null | undefined;
    if (body.class === null) classId = null;
    else if (body.class) {
      const siteUrl = normalizeShahafUrl(body.class.siteUrl);
      if (!siteUrl) return badRequest(reply, 'invalid_site', 'siteUrl: expected https://<school>.shahaf.site');
      let cls;
      try {
        cls = await classOnSite(siteUrl, body.class.classId, { semel: body.semel });
      } catch (err) {
        request.log.warn({ siteUrl, err: String(err) }, 'could not read a school site\'s class list');
        void reply.code(502);
        return SITE_UNREACHABLE;
      }
      if (!cls) return badRequest(reply, 'unknown_class', 'classId: the school site does not list this class');
      classId = cls.id;
      // One of its other classes becomes its own (a parent's phone now shows that child): one follow, not two.
      if (classId !== request.device!.classId) await prisma.classFollow.deleteMany({ where: { deviceId: id, classId } });
    }

    // The grade's exam calendar belongs to the class: every device following it sees its exams.
    let examCalendarId: string | null | undefined;
    if (body.examCalendar === null) examCalendarId = null;
    else if (body.examCalendar !== undefined) {
      examCalendarId = normalizeCalendarId(body.examCalendar);
      if (!examCalendarId) return badRequest(reply, 'invalid_calendar', 'examCalendar: expected a Google calendar id or its embed URL');
    }
    const classForCalendar = classId !== undefined ? classId : request.device!.classId;
    if (examCalendarId !== undefined) {
      if (!classForCalendar) return badRequest(reply, 'no_class', 'examCalendar: the device follows no class');
      const now = new Date();
      const newId = examCalendarId;
      const changed = await changeBoard(prisma, classForCalendar, id, (current) => {
        // Clearing where there is no board, or the calendar it already has: nothing to change, and its exams stay as read.
        if (newId === null ? !hasBoard(current) : current.examCalendarId === newId) return null;
        // Cleared, the mark of the class's last announcement stays (`examBoardAnnouncedAt`): a board brought again within
        // 30 days of it tells no one (`announceAgain`).
        if (newId === null) {
          return { examCalendarId: null, examCalendarSetBy: null, examBoardKind: null, examBoardSetAt: null, ...NO_EXAMS };
        }
        // A calendar replaces a board from a file as it replaces another calendar; where there was none, its first exams
        // tell the class, unless it was told within the last 30 days.
        return { examCalendarId: newId, examCalendarSetBy: id, examBoardKind: null, examBoardSetAt: now, ...NO_EXAMS, ...announceAgain(current, now) };
      });
      if (changed === 'no_class') return badRequest(reply, 'no_class', 'examCalendar: the device follows no class');
      if (changed === 'locked') {
        void reply.code(403);
        return BOARD_LOCKED;
      }
      // A new calendar is read now, so that the class has its exams in this very answer.
      if (changed === 'changed' && newId !== null) await readCalendarNow(request, classForCalendar, newId);
    }

    // A push token belongs to one install; a reinstall that registered anew takes it over.
    if (body.pushToken) {
      await prisma.device.updateMany({ where: { pushToken: body.pushToken, NOT: { id } }, data: { pushToken: null } });
    }

    await prisma.device.update({
      where: { id },
      data: {
        ...(body.pushToken !== undefined ? { pushToken: body.pushToken } : {}),
        ...(classId !== undefined ? { classId } : {}),
        ...(body.prefs
          ? {
              prefs: mergeDevicePrefs(
                request.device!.prefs,
                // Stored clean: whitespace collapsed, a name that cleans to nothing left out.
                body.prefs.subjectNames === undefined ? body.prefs : { ...body.prefs, subjectNames: subjectNamesOf(body.prefs.subjectNames) },
              ) as object,
            }
          : {}),
        lastSeenAt: new Date(),
      },
    });
    return toResponse(prisma, (await loadDevice(prisma, id))!);
  });

  /**
   * The classes a parent's phone follows besides its own, each with the lines
   * there that are not that child's: they replace the ones before. Each is
   * checked against its site, as the device's own class is. Its own class, or
   * one listed twice, is one follow.
   */
  app.put('/v2/device/classes', async (request, reply) => {
    const parsed = classesBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return badRequest(reply, 'invalid_classes', `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`);
    }
    const id = request.device!.id;
    const device = (await loadDevice(prisma, id))!;
    const keyOf = (siteUrl: string, classId: string) => `${siteUrl}|${classId}`;
    const own = device.class ? keyOf(device.class.school.shahafUrl, device.class.shahafClassId) : null;
    // Counted before anything is read or made: a refused list leaves no rows behind.
    const entries = new Map<string, { siteUrl: string; classId: string; hiddenSubjects: string[]; subjectNames: Record<string, string> }>();
    for (const [i, entry] of parsed.data.classes.entries()) {
      const siteUrl = normalizeShahafUrl(entry.siteUrl);
      if (!siteUrl) return badRequest(reply, 'invalid_site', `classes.${i}.siteUrl: expected https://<school>.shahaf.site`);
      const key = keyOf(siteUrl, entry.classId);
      if (key !== own && !entries.has(key)) {
        // The names are stored clean, as a device's own are.
        entries.set(key, { siteUrl, classId: entry.classId, hiddenSubjects: entry.hiddenSubjects ?? [], subjectNames: subjectNamesOf(entry.subjectNames) });
      }
    }
    if (entries.size > MAX_FOLLOWED_CLASSES - 1) {
      return badRequest(reply, 'too_many_classes', `classes: at most ${MAX_FOLLOWED_CLASSES - 1} besides the device's own`);
    }
    const lists = new Map<string, Promise<ClassOption[]>>();
    const wanted = new Map<string, { hiddenSubjects: string[]; subjectNames: Record<string, string> }>();
    for (const entry of entries.values()) {
      let cls;
      try {
        cls = await classOnSite(entry.siteUrl, entry.classId, { lists });
      } catch (err) {
        request.log.warn({ siteUrl: entry.siteUrl, err: String(err) }, 'could not read a school site\'s class list');
        void reply.code(502);
        return SITE_UNREACHABLE;
      }
      if (!cls) return badRequest(reply, 'unknown_class', `classes: the school site does not list class ${entry.classId}`);
      wanted.set(cls.id, { hiddenSubjects: entry.hiddenSubjects, subjectNames: entry.subjectNames });
    }
    await prisma.$transaction([
      prisma.classFollow.deleteMany({ where: { deviceId: id, classId: { notIn: [...wanted.keys()] } } }),
      ...[...wanted].map(([classId, prefs]) =>
        prisma.classFollow.upsert({
          where: { deviceId_classId: { deviceId: id, classId } },
          // `createdAt` stays the first follow's: the device hears of what changed after it.
          create: { deviceId: id, classId, prefs },
          update: { prefs },
        }),
      ),
    ]);
    await prisma.device.update({ where: { id }, data: { lastSeenAt: new Date() } });
    return toResponse(prisma, (await loadDevice(prisma, id))!);
  });

  /**
   * "מחיקת הנתונים שלי": the device's row and every push sent to it. Its other classes go with the row.
   *
   * Its friends' boxes (`buddy_box`, `routes/buddies.ts`) are settled in the same transaction, in
   * this order: (1) the device's own: a live `invite` or `reply` is emptied into the mark a used
   * link leaves, and a `pair` box is deleted (`settleBoxes`); (2) the row goes, and the foreign key
   * only clears each remaining box's writer; (3) the boxes with no writer are settled the same way.
   * Step 3 is for a box the device wrote between 1 and 2 (its own concurrent `PUT`): the delete
   * leaves it live with no writer, and each statement of a read committed transaction sees what the
   * one before it did, so the next one finds it. So a box with no writer is always a mark (`''`),
   * and a link this device wrote cannot be armed again under another's name by deleting the device.
   * Normally step 3 finds nothing: a row with no writer was a mark already.
   *
   * Its chat connection (`routes/chatDevice.ts`) goes in the same transaction, before the row: the
   * authorization codes and tokens of its grants, the grants, its link codes and its sealed copy
   * (`chatRowsOf`). The foreign keys would clear them too; naming them keeps them in the order read here.
   */
  app.delete('/v2/device', async (request) => {
    const id = request.device!.id;
    await prisma.$transaction([
      prisma.deviceNotification.deleteMany({ where: { deviceId: id } }),
      ...chatRowsOf(prisma, id),
      ...settleBoxes(prisma, { writerDeviceId: id }),
      prisma.device.delete({ where: { id } }),
      ...settleBoxes(prisma, { writerDeviceId: null }),
    ]);
    return { ok: true };
  });

  /**
   * The Ministry's vacations as this build has them. A phone takes them when
   * its own copy is older (`takeSchoolDaysOff`): a fixed date goes out with a
   * deploy, without waiting for an app release.
   */
  app.get('/v2/calendar', async (_request, reply): Promise<SchoolCalendarResponse> => {
    void reply.header('cache-control', 'public, max-age=3600');
    return { revision: SCHOOL_CALENDAR_REVISION, daysOff: [...SCHOOL_DAYS_OFF] };
  });

  app.get('/v2/classes', async (request, reply): Promise<ClassListResponse | { error: string; message: string }> => {
    const site = (request.query as { site?: string }).site ?? '';
    const siteUrl = normalizeShahafUrl(site);
    if (!siteUrl) return badRequest(reply, 'invalid_site', 'site: expected https://<school>.shahaf.site');
    try {
      return { siteUrl, classes: await services.shahafFor(siteUrl).fetchClasses() };
    } catch (err) {
      request.log.warn({ siteUrl, err: String(err) }, 'could not read a school site\'s class list');
      void reply.code(502);
      return { error: 'site_unreachable', message: 'לא הצלחנו לקרוא את אתר המערכת של בית הספר. כדאי לנסות שוב בעוד רגע.' };
    }
  });

  /**
   * A followed class's feed: the device's own, or with `?site=&cls=` another one
   * that some device follows, a parent's other child's or a friend's (the feed
   * is the class's public timetable). Never a class nobody follows.
   */
  app.get('/v2/class/feed', async (request, reply): Promise<ClassFeed | { error: string; message: string }> => {
    // The read every phone makes at every refresh is how the server knows a device is still around (the lock on a
    // class's board passes on from one not seen for 30 days): written once a day at most, and a failure to write it
    // fails nothing.
    await markSeen(request.device!).catch((err: unknown) =>
      request.log.warn({ err: { name: err instanceof Error ? err.name : typeof err } }, 'device last seen not written'),
    );
    const device = (await loadDevice(prisma, request.device!.id))!;
    // A key given twice (`?cls=a&cls=b`) comes as a list: one of each, or a bad request.
    const query = request.query as { site?: unknown; cls?: unknown };
    let target = device.class && device.classId ? { id: device.classId, deviceClass: await classOf(prisma, device.class, device.classId, device) } : null;
    if (query.site !== undefined || query.cls !== undefined) {
      const siteUrl = typeof query.site === 'string' ? normalizeShahafUrl(query.site) : null;
      const cls = typeof query.cls === 'string' ? query.cls : '';
      if (!siteUrl || !cls) return badRequest(reply, 'invalid_class', 'site, cls: expected a Shahaf site and one of its classes');
      const isOwn = target?.deviceClass.siteUrl === siteUrl && target.deviceClass.classId === cls;
      if (!isOwn) {
        const follow = device.follows.find((f) => f.class.school.shahafUrl === siteUrl && f.class.shahafClassId === cls);
        if (follow) target = { id: follow.classId, deviceClass: await classOf(prisma, follow.class, follow.classId, device) };
        else {
          // Neither its own nor one it follows: still open when another device follows it (a friend's class).
          const followed = await prisma.schoolClass.findFirst({
            where: { shahafClassId: cls, school: { shahafUrl: siteUrl }, ...FOLLOWED },
            select: { id: true, ...CLASS_SELECT },
          });
          if (!followed) {
            void reply.code(409);
            return { error: 'not_followed', message: 'אף מכשיר לא עוקב אחרי הכיתה הזאת.' };
          }
          target = { id: followed.id, deviceClass: await classOf(prisma, followed, followed.id, device) };
        }
      }
    }
    if (!target) {
      void reply.code(409);
      return { error: 'no_class', message: 'עוד לא נבחרה כיתה.' };
    }
    const { id: classId, deviceClass } = target;
    const cls = await prisma.schoolClass.findUnique({ where: { id: classId } });
    const from = addDays(todayStr(services.env.TIMEZONE), -CLASS_FEED_PAST_DAYS, services.env.TIMEZONE);
    const rows = await prisma.classSnapshot.findMany({
      where: { classId, deletedAt: null },
      select: { kind: true, naturalKey: true, payload: true },
    });
    const of = <T>(kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ naturalKey: r.naturalKey, ...(r.payload as object) }) as T);
    const dated = <T extends { date: string | null }>(items: T[]) => items.filter((i) => i.date === null || i.date >= from);
    // The class's site and the grade's exam calendar, each marked by where it came from. An exam
    // both list goes out once, as the calendar's (`splitSiteTwins`): the site's exams were read
    // as empty until 2026-10-28, and phones from before 1.9.16 would keep, and mirror, both. The
    // site's that went are in `siteTwins`, for a phone whose student brought a board of their own:
    // it shows that board in place of the calendar's, and the site's exams are then its to show.
    const { kept: exams, twins } = splitSiteTwins([
      ...of<ClassExam>('exam').map((e) => ({ ...e, source: 'shahaf' as const })),
      ...((cls?.exams as ClassExam[] | null) ?? []).map((e) => ({ ...e, source: 'school_site' as const })),
    ]);
    const siteTwins = dated(twins);
    return {
      class: deviceClass,
      lastOkAt: cls?.lastOkAt?.toISOString() ?? null,
      freshness: cls?.freshness?.toISOString() ?? null,
      lessons: dated(rows.filter((r) => r.kind === 'lesson').map((r) => r.payload as unknown as ClassLesson))
        .sort((a, b) => (a.date === b.date ? a.hourIndex - b.hourIndex : a.date < b.date ? -1 : 1)),
      changes: dated(of<ScheduleChange>('change')),
      exams: dated(exams),
      ...(siteTwins.length > 0 ? { siteTwins } : {}),
      events: dated(of<ClassEvent>('school_event')),
      messages: of<ClassMessage>('message'),
    };
  });

  /**
   * The device's own class through the school year so far: what each lesson was
   * when it began, and the exams whose day has passed (`history/run.ts`,
   * `history/backfill.ts`). Public class data, like the feed, and only the
   * device's own class: a year of someone else's timetable is nobody's to read.
   * `?from=YYYY-MM-DD` narrows the rows (a phone that has the rest), never
   * `coverage`, and never reaches before 1 September of the school year.
   */
  app.get('/v2/class/history', async (request, reply): Promise<ClassHistory | { error: string; message: string }> => {
    const device = (await loadDevice(prisma, request.device!.id))!;
    if (!device.class || !device.classId) {
      void reply.code(409);
      return { error: 'no_class', message: 'עוד לא נבחרה כיתה.' };
    }
    const zone = services.env.TIMEZONE;
    const yearStart = schoolYearStart(todayStr(zone));
    const asked = (request.query as { from?: unknown }).from;
    let from = yearStart;
    if (asked !== undefined) {
      if (typeof asked !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asked) || !DateTime.fromISO(asked, { zone }).isValid) {
        return badRequest(reply, 'invalid_from', 'from: expected a day as YYYY-MM-DD');
      }
      if (asked > yearStart) from = asked;
    }
    const classId = device.classId;
    const [lessons, exams] = await Promise.all([
      prisma.classLessonHistory.findMany({ where: { classId, date: { gte: yearStart } }, orderBy: [{ date: 'asc' }, { hourIndex: 'asc' }, { subject: 'asc' }] }),
      prisma.classExamHistory.findMany({ where: { classId, date: { gte: yearStart } }, orderBy: [{ date: 'asc' }] }),
    ]);
    void reply.header('cache-control', 'private, max-age=3600');
    return {
      class: await classOf(prisma, device.class, classId, device),
      coverage: {
        observedFrom: lessons.find((l) => l.source === 'observed')?.date ?? null,
        from: lessons[0]?.date ?? null,
        to: lessons[lessons.length - 1]?.date ?? null,
      },
      lessons: lessons.filter((l) => l.date >= from).map((l): ClassHistoryLesson => ({
        date: l.date, hourIndex: l.hourIndex, startTime: l.startTime, endTime: l.endTime, subject: l.subject, teacher: l.teacher || null,
        room: l.room, status: l.status as LessonStatus | null, substitute: l.substitute, note: l.note,
        source: l.source === 'observed' ? 'observed' : 'backfill', changeSeenAt: l.changeSeenAt?.toISOString() ?? null,
      })),
      exams: withoutSiteTwins(
        exams.filter((e) => e.date >= from).map((e): ClassExam => ({
          naturalKey: e.naturalKey, date: e.date, subject: e.subject, details: e.details, source: e.source === 'school_site' ? 'school_site' : 'shahaf',
        })),
      ),
    };
  });
}
