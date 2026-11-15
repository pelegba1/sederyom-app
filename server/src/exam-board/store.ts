/**
 * A class's exam board on the server: what the class has (`hasBoard`, `boardInfo`), who may replace it
 * (`mayChangeBoard`), how it is replaced without two devices both thinking they may (`changeBoard`), and how
 * the exams a calendar was read for are kept (`storeBoardExams`).
 *
 * A board has two forms, a Google calendar (`examCalendarId`) or the rows a student brought from a file or a
 * page (`examBoardKind` 'upload', no calendar id). Both are the class's: every device that follows it sees them,
 * and the phones mirror them into the students' Google calendars. So the lock is on the board, not on the
 * calendar id: a board from a file has no id, and a lock that read "no id" as "no board" let anyone replace it.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ClassExam, ExamBoardInfo } from '@sederyom/shared';
import type { Logger } from '../lib/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How often a class is told it has a board, at most: once in this many days. A board removed and brought again
 * within them tells no one (a device that brought one could otherwise push the whole class at will, a clear and a
 * save at a time); one brought where there was none and the class was last told longer ago tells it again.
 */
export const ANNOUNCE_EVERY_DAYS = 30;

/**
 * How long the device that brought a board holds its lock without being seen (`lastSeenAt`, which the feed route
 * keeps up once a day): a phone that was reinstalled or replaced leaves its old row behind, and the class's board
 * would otherwise be frozen for the year.
 */
export const SETTER_GONE_AFTER_DAYS = 30;

/**
 * What a change that brings a board to a class with none writes besides the board: the mark of the class's last
 * announcement taken away when it is older than `ANNOUNCE_EVERY_DAYS` (or was never set), so that the board's first
 * exams tell the class (`storeBoardExams`, `announceUploadedBoard`, which tell only a class with no mark). Within
 * them, and for a board that only replaces another, the mark stays and nobody is told.
 */
export function announceAgain(current: { examCalendarId: string | null; examBoardKind: string | null; examBoardAnnouncedAt: Date | null }, now: Date): { examBoardAnnouncedAt?: null } {
  if (hasBoard(current) || current.examBoardAnnouncedAt === null) return {};
  return current.examBoardAnnouncedAt.getTime() < now.getTime() - ANNOUNCE_EVERY_DAYS * DAY_MS ? { examBoardAnnouncedAt: null } : {};
}

/** The refusal of a device that is not the one that brought the board (403). */
export const BOARD_LOCKED = {
  error: 'calendar_locked',
  message: 'ללוח המבחנים של הכיתה כבר יש קישור, ורק מי שהוסיף אותו יכול להחליף או להסיר אותו.',
};

/** Whether the class has an exam board, in either form. */
export function hasBoard(cls: { examCalendarId: string | null; examBoardKind: string | null }): boolean {
  return cls.examCalendarId !== null || cls.examBoardKind !== null;
}

/** What `boardInfo` reads of a class. */
type BoardSource = {
  examCalendarId: string | null;
  examBoardKind: string | null;
  examBoardSetAt: Date | null;
  examCalendarSetBy: string | null;
  exams: unknown;
};

/**
 * The class's board as `deviceId` sees it, or `null` when there is none. `count` is the exams kept, so a
 * calendar that was set a moment ago and not read yet counts none; `setAt` is `null` for a calendar set before
 * the board had a time of its own. `mayChange` is given: whether the lock lets this device's save through
 * (`boardInfoFor` asks it).
 */
export function boardInfo(cls: BoardSource, deviceId: string, mayChange: boolean): ExamBoardInfo | null {
  if (!hasBoard(cls)) return null;
  return {
    kind: cls.examBoardKind === 'upload' ? 'upload' : 'calendar',
    setAt: cls.examBoardSetAt?.toISOString() ?? null,
    count: Array.isArray(cls.exams) ? cls.exams.length : 0,
    mine: cls.examCalendarSetBy === deviceId,
    mayChange,
  };
}

/**
 * `boardInfo` with `mayChange` asked of the lock itself (`mayChangeBoard`), so the two cannot disagree, and only
 * for the class that is the device's `own`: a board is set on a device's own class only, so for a class it follows
 * the answer is `false` without asking. The device that brought the board, a class with no setter on record, and a
 * class with no board are answered without a query; a classmate costs one (the setter is still in the class) or
 * two (it left, and the follows are looked at).
 */
export async function boardInfoFor(
  prisma: PrismaClient,
  cls: BoardSource,
  deviceId: string,
  classId: string,
  own: boolean,
): Promise<ExamBoardInfo | null> {
  if (!hasBoard(cls)) return null;
  return boardInfo(cls, deviceId, own && (await mayChangeBoard(prisma, cls, deviceId, classId)));
}

/** The class's exams the columns that go with them: kept as the feed sends them, minus the mark of where they came from. */
export function examsColumns(exams: ClassExam[], now: Date) {
  return {
    exams: exams.map((e): ClassExam => ({ naturalKey: e.naturalKey, date: e.date, subject: e.subject, details: e.details })) as object[],
    examsPolledAt: now,
    examsOkAt: now,
    examsError: null,
  };
}

/**
 * Keeps the exams a calendar was read for (`exams`, `examsPolledAt`, `examsOkAt`), and says whether this is the
 * time the class got a board with an exam in it: `examBoardAnnouncedAt` was empty and there is an exam, so it is
 * set, once, by a conditional update that changes one row for one caller however many read at the same moment.
 * It tells no one: whoever wants the class told does it on `true` (`announceCalendarBoard`, with this call's `now`).
 *
 * With `calendarId`, the exams are kept only if the class still has that calendar. A read takes seconds, and in
 * them the device that set the calendar may have replaced it with a file or another calendar, whose exams these
 * are not; then nothing is kept and the answer is `false`.
 */
export async function storeBoardExams(
  prisma: PrismaClient,
  classId: string,
  exams: ClassExam[],
  now: Date,
  calendarId?: string,
): Promise<boolean> {
  const stillThat = calendarId === undefined ? {} : { examCalendarId: calendarId };
  try {
    await prisma.schoolClass.update({ where: { id: classId, ...stillThat }, data: examsColumns(exams, now) });
  } catch (err) {
    // Prisma's "no row for this where": the class changed its calendar while the feed was being read.
    if (calendarId !== undefined && (err as { code?: unknown } | null)?.code === 'P2025') return false;
    throw err;
  }
  if (exams.length === 0) return false;
  const { count } = await prisma.schoolClass.updateMany({
    where: { id: classId, examBoardAnnouncedAt: null, ...stillThat },
    data: { examBoardAnnouncedAt: now },
  });
  return count === 1;
}

/**
 * Tells the class's followers that it has an exam board: one `exam_board` event, which `dispatchClassChanges`
 * pushes to each of them under their own switches, quiet hours and "חופש". `setBy` is the device that brought the
 * board, which is not told of its own, or `null` when the board's setter is not on record (every follower is
 * told). The event carries nothing else: no exam, and no name, which the server does not know.
 *
 * This is the event alone. Whoever calls it has just set the class's `examBoardAnnouncedAt` (`storeBoardExams`
 * said so, or `announceUploadedBoard` did), and goes through `announceCalendarBoard` or `announceUploadedBoard`,
 * which keep that mark and this event from drifting apart.
 */
export async function announceBoard(prisma: PrismaClient, classId: string, setBy: string | null): Promise<void> {
  await prisma.classChangeEvent.create({
    data: { classId, kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy }, partition: null } },
  });
}

/**
 * `announceBoard` for a class whose `examBoardAnnouncedAt` was just set to `markedAt` by the caller, and which
 * never fails the caller: a read or a save is not to be lost for an announcement. If the event cannot be made the
 * mark is taken back, only if it is still `markedAt` (a board removed and told again in the meantime keeps its
 * own), so that a class that was not told is not left looking told: the next calendar read or the next save of
 * the board tells it. The log gets the names of the errors and nothing they said.
 */
async function announceMarked(
  prisma: PrismaClient,
  classId: string,
  markedAt: Date,
  setBy: () => Promise<string | null>,
  log: Logger,
): Promise<void> {
  const nameOf = (err: unknown) => (err instanceof Error ? err.name : typeof err);
  try {
    await announceBoard(prisma, classId, await setBy());
  } catch (err) {
    log.warn({ classId, err: { name: nameOf(err) } }, 'exam board announcement failed');
    try {
      await prisma.schoolClass.updateMany({ where: { id: classId, examBoardAnnouncedAt: markedAt }, data: { examBoardAnnouncedAt: null } });
    } catch (undo) {
      log.error({ classId, err: { name: nameOf(undo) } }, 'exam board announcement mark not taken back');
    }
  }
}

/**
 * Tells the class of a calendar whose first exams `storeBoardExams` just kept (it answered `true`, having set
 * `examBoardAnnouncedAt` to `markedAt`). The device that set the calendar is the class's `examCalendarSetBy` now,
 * which a tick, that read the calendar long after it was set, does not otherwise know; `null` when the class has
 * none on record.
 */
export async function announceCalendarBoard(prisma: PrismaClient, classId: string, markedAt: Date, log: Logger): Promise<void> {
  await announceMarked(prisma, classId, markedAt, async () => {
    const cls = await prisma.schoolClass.findUnique({ where: { id: classId }, select: { examCalendarSetBy: true } });
    return cls?.examCalendarSetBy ?? null;
  }, log);
}

/**
 * After `setBy` saved a board from a file: tells the class if this is the first board it has had (or the first since
 * one was removed more than `ANNOUNCE_EVERY_DAYS` after the class was told, `announceAgain`), that is when
 * `examBoardAnnouncedAt` is empty. A save that only replaces a board finds it set, and tells no one. The mark is
 * taken by one conditional update, held to the board that was just saved (a file, by this device), and its count
 * decides, so two saves at the same moment cannot both tell the class, and a board that was removed in between
 * is not marked as told. A save always holds at least one exam.
 */
export async function announceUploadedBoard(prisma: PrismaClient, classId: string, setBy: string, now: Date, log: Logger): Promise<void> {
  let marked: boolean;
  try {
    const { count } = await prisma.schoolClass.updateMany({
      where: { id: classId, examBoardAnnouncedAt: null, examBoardKind: 'upload', examCalendarSetBy: setBy },
      data: { examBoardAnnouncedAt: now },
    });
    marked = count === 1;
  } catch (err) {
    log.warn({ classId, err: { name: err instanceof Error ? err.name : typeof err } }, 'exam board announcement failed');
    return;
  }
  if (marked) await announceMarked(prisma, classId, now, async () => setBy, log);
}

/**
 * Whether a device may replace or clear its class's board. Bringing one where there is none is any follower's:
 * that is how one student's link brings the exams to the whole class. Replacing or clearing it is only for the
 * device that brought it, while it still follows the class and has been seen in the last `SETTER_GONE_AFTER_DAYS`
 * days; one that left (a new class, or the app deleted) or that has not been seen since (a phone reinstalled or
 * replaced leaves its old row) hands it on. Registration is open, so without this anyone could swap a class's real
 * exams for their own, and the phones would mirror them into every student's Google Calendar.
 */
export async function mayChangeBoard(
  prisma: PrismaClient,
  cls: { examCalendarId: string | null; examBoardKind: string | null; examCalendarSetBy: string | null },
  deviceId: string,
  classId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!hasBoard(cls) || !cls.examCalendarSetBy || cls.examCalendarSetBy === deviceId) return true;
  const setter = await prisma.device.findUnique({ where: { id: cls.examCalendarSetBy }, select: { classId: true, lastSeenAt: true } });
  if (setter?.lastSeenAt && setter.lastSeenAt.getTime() < now.getTime() - SETTER_GONE_AFTER_DAYS * DAY_MS) return true;
  if (setter?.classId === classId) return false;
  // A parent whose other child is in the class still follows it.
  const follow = await prisma.classFollow.findUnique({ where: { deviceId_classId: { deviceId: cls.examCalendarSetBy, classId } } });
  return follow === null;
}

/** What a change of the board turned out to be. */
export type BoardChange = 'changed' | 'unchanged' | 'locked' | 'no_class';

/** What the lock looks at, and what a write is held to; and the mark of the class's last announcement, for `announceAgain`. */
const LOCK_FIELDS = { examCalendarId: true, examCalendarSetBy: true, examBoardKind: true, examBoardAnnouncedAt: true } as const;

/** The board as `changeBoard` reads it and hands it to `decide`. */
export type CurrentBoard = {
  examCalendarId: string | null;
  examCalendarSetBy: string | null;
  examBoardKind: string | null;
  examBoardAnnouncedAt: Date | null;
};
/** Tries a change makes when the board moves under it, before it gives up as refused. */
const ATTEMPTS = 3;

/**
 * Changes the class's board as `deviceId`, if it may. `decide` is given the board as it is and answers the
 * columns to write, or `null` when there is nothing to change.
 *
 * The decision and the write are not two steps that something can come between. The write is one
 * `UPDATE ... WHERE` that holds the board to what the decision was made on (its calendar, its setter, its kind),
 * so when two devices come at a class with no board at the same moment, both are told they may, the first write
 * changes the row, and the second changes none. That one reads the board again: now it is the other's, and it
 * is refused. A write that missed because the same device changed the board in the meantime just decides again.
 */
export async function changeBoard(
  prisma: PrismaClient,
  classId: string,
  deviceId: string,
  decide: (current: CurrentBoard) => Prisma.SchoolClassUpdateManyMutationInput | null,
): Promise<BoardChange> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const current = await prisma.schoolClass.findUnique({ where: { id: classId }, select: LOCK_FIELDS });
    if (!current) return 'no_class';
    const data = decide(current);
    if (data === null) return 'unchanged';
    if (!(await mayChangeBoard(prisma, current, deviceId, classId))) return 'locked';
    const { count } = await prisma.schoolClass.updateMany({
      where: { id: classId, examCalendarId: current.examCalendarId, examCalendarSetBy: current.examCalendarSetBy, examBoardKind: current.examBoardKind },
      data,
    });
    if (count === 1) return 'changed';
  }
  return 'locked';
}
