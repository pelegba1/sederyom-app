/**
 * Polling every followed class's Shahaf site (plan Phase 2).
 *
 * One read per class, however many devices follow it: the grid and its
 * changes are the class's, not any one student's. Each class keeps its own
 * snapshots and change events, through the delta engine (`delta.ts`), so a
 * re-poll of an unchanged site is still zero events.
 *
 * A tick polls only the classes that are due, least recently polled first,
 * and at most `limit` of them: a serverless tick has minutes, not hours, and
 * a cap is what keeps one tick inside them however many classes there are.
 */
import type { PrismaClient } from '@prisma/client';
import type { ClassExam, Source } from '@sederyom/shared';
import type { EntityKind } from '../adapters/types.js';
import type { ShahafAdapter } from '../adapters/shahaf/index.js';
import type { SchoolSiteAdapter } from '../adapters/school-site/index.js';
import { announceCalendarBoard, storeBoardExams } from '../exam-board/store.js';
import { applyDelta, type ChangeEventDraft, type SnapshotStore, type SnapshotUpsert, type StoredSnapshot } from './delta.js';
import type { Logger } from '../lib/logger.js';

/** `SnapshotStore` over one class's rows. Its source is always the class's Shahaf site. */
export class ClassSnapshotStore implements SnapshotStore {
  constructor(private readonly prisma: PrismaClient, private readonly classId: string) {}

  async load(_source: Source, kinds: EntityKind[]): Promise<StoredSnapshot[]> {
    const rows = await this.prisma.classSnapshot.findMany({ where: { classId: this.classId, kind: { in: kinds } } });
    return rows.map((r) => ({
      source: 'shahaf',
      kind: r.kind as EntityKind,
      naturalKey: r.naturalKey,
      contentHash: r.contentHash,
      partition: r.partition,
      payload: r.payload,
      deletedAt: r.deletedAt,
    }));
  }

  async apply(upserts: SnapshotUpsert[], touched: { kind: EntityKind; naturalKey: string }[], now: Date): Promise<void> {
    const classId = this.classId;
    const ops = [
      ...upserts.map((u) =>
        this.prisma.classSnapshot.upsert({
          where: { classId_kind_naturalKey: { classId, kind: u.kind, naturalKey: u.naturalKey } },
          create: {
            classId, kind: u.kind, naturalKey: u.naturalKey, contentHash: u.contentHash, partition: u.partition,
            payload: u.payload as object, lastSeen: u.lastSeen, deletedAt: u.deletedAt,
          },
          update: { contentHash: u.contentHash, partition: u.partition, payload: u.payload as object, lastSeen: u.lastSeen, deletedAt: u.deletedAt },
        }),
      ),
      ...(touched.length > 0
        ? [
            this.prisma.classSnapshot.updateMany({
              where: { classId, OR: touched.map((t) => ({ kind: t.kind, naturalKey: t.naturalKey })) },
              data: { lastSeen: now },
            }),
          ]
        : []),
    ];
    if (ops.length > 0) await this.prisma.$transaction(ops);
  }

  async recordEvents(events: ChangeEventDraft[]): Promise<void> {
    if (events.length === 0) return;
    await this.prisma.classChangeEvent.createMany({
      data: events.map((e) => ({ classId: this.classId, kind: e.kind, naturalKey: e.naturalKey, change: e.change, payload: e.payload as object })),
    });
  }
}

export interface ClassPollDeps {
  prisma: PrismaClient;
  logger: Logger;
  shahafFor(siteUrl: string): ShahafAdapter;
}

export interface ClassPollOptions {
  now: Date;
  /** Minutes between polls of one class: the active window's cadence or the idle one. */
  everyMinutes: number;
  /** Most classes one tick polls. */
  limit: number;
  /**
   * Tolerance for an early tick, in minutes (`DEFAULT_SLACK_MINUTES` in tick.ts).
   * Without it a 15-minute pinger arriving a few seconds early finds the class not due, and
   * the next chance is 15 minutes later: every other poll is skipped.
   */
  slackMinutes?: number;
}

/**
 * Followed by some device: as its own class, or as a parent's other child's
 * (`ClassFollow`). A class nobody follows any more is not polled; its rows stay
 * until it is followed again. The class feed answers for exactly these
 * (`routes/devices.ts`): what it holds is public, and a friend's class is one.
 */
export const FOLLOWED = { OR: [{ devices: { some: {} } }, { follows: { some: {} } }] };

/** Polled before this moment: due now. */
function dueBeforeOf(opts: ClassPollOptions): Date {
  return new Date(opts.now.getTime() - (opts.everyMinutes - (opts.slackMinutes ?? 0)) * 60_000);
}

export interface ClassPollResult {
  polled: number;
  failed: number;
  events: number;
}

/** Polls the classes that are due. Never throws for one class's failure: that class records it and waits its turn. */
export async function pollDueClasses(deps: ClassPollDeps, opts: ClassPollOptions): Promise<ClassPollResult> {
  const dueBefore = dueBeforeOf(opts);
  const due = await deps.prisma.schoolClass.findMany({
    where: {
      AND: [FOLLOWED],
      OR: [{ polledAt: null }, { polledAt: { lt: dueBefore } }],
    },
    orderBy: [{ polledAt: { sort: 'asc', nulls: 'first' } }],
    take: opts.limit,
    include: { school: { select: { shahafUrl: true } } },
  });

  const result: ClassPollResult = { polled: 0, failed: 0, events: 0 };
  for (const cls of due) {
    try {
      const adapter = deps.shahafFor(cls.school.shahafUrl);
      const poll = await adapter.poll({ now: opts.now, classId: cls.shahafClassId, logger: deps.logger });
      const delta = await applyDelta(new ClassSnapshotStore(deps.prisma, cls.id), 'shahaf', poll.entities, poll.completeScopes, opts.now, {
        initial: cls.lastOkAt === null,
        // The site's exams were read as empty until 2026-10-28: a class's first ones are its backlog.
        backlogKinds: ['exam'],
      });
      await deps.prisma.schoolClass.update({
        where: { id: cls.id },
        data: { polledAt: opts.now, lastOkAt: opts.now, lastError: null, freshness: poll.sourceFreshness ?? null },
      });
      result.polled += 1;
      result.events += delta.events.length;
    } catch (err) {
      result.failed += 1;
      deps.logger.warn({ classId: cls.id, site: cls.school.shahafUrl, err: String(err) }, 'class poll failed');
      await deps.prisma.schoolClass.update({ where: { id: cls.id }, data: { polledAt: opts.now, lastError: String(err).slice(0, 500) } });
    }
  }
  return result;
}

export interface ExamCalendarPollDeps {
  prisma: PrismaClient;
  logger: Logger;
  schoolSiteFor(calendarId: string): SchoolSiteAdapter;
}

/**
 * Reads the exam calendars of followed classes that are due (`everyMinutes`,
 * hourly), at most `limit` a tick. The calendar's exams are
 * kept whole on the class row: a calendar is one small ICS feed, read in
 * full every time, so there is nothing to diff it against.
 *
 * Only a class whose board is a calendar is read. A board brought from a file
 * (`examBoardKind` 'upload') is kept as it was confirmed, and what is stored
 * is held to the calendar that was read (`storeBoardExams`), so a file that
 * arrives while a feed is being read is not overwritten by it.
 */
export async function pollDueExamCalendars(deps: ExamCalendarPollDeps, opts: ClassPollOptions): Promise<{ polled: number; failed: number }> {
  const dueBefore = dueBeforeOf(opts);
  const due = await deps.prisma.schoolClass.findMany({
    where: {
      AND: [FOLLOWED],
      examCalendarId: { not: null },
      examBoardKind: null,
      OR: [{ examsPolledAt: null }, { examsPolledAt: { lt: dueBefore } }],
    },
    orderBy: [{ examsPolledAt: { sort: 'asc', nulls: 'first' } }],
    take: opts.limit,
    select: { id: true, examCalendarId: true },
  });
  const result = { polled: 0, failed: 0 };
  for (const cls of due) {
    try {
      const read = await deps.schoolSiteFor(cls.examCalendarId!).poll({ now: opts.now, classId: '', logger: deps.logger });
      const exams = read.entities
        .filter((e) => e.kind === 'exam')
        .map((e): ClassExam => ({ naturalKey: e.naturalKey, ...(e.payload as { date: string; subject: string; details: string | null }) }));
      const first = await storeBoardExams(deps.prisma, cls.id, exams, opts.now, cls.examCalendarId!);
      result.polled += 1;
      // The class's first exams: its followers are told, in this tick's push run. Never a failed read.
      if (first) await announceCalendarBoard(deps.prisma, cls.id, opts.now, deps.logger);
    } catch (err) {
      result.failed += 1;
      deps.logger.warn({ classId: cls.id, err: String(err) }, 'exam calendar read failed');
      await deps.prisma.schoolClass.update({ where: { id: cls.id }, data: { examsPolledAt: opts.now, examsError: String(err).slice(0, 500) } });
    }
  }
  return result;
}
