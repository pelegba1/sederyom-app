/**
 * The daily freeze: every day that has passed is written into
 * `class_lesson_history`, once, from the class's change events (`freeze.ts`),
 * and every exam whose day has passed into `class_exam_history`.
 *
 * Rows are only ever inserted (`skipDuplicates`): a second run, or two ticks at
 * once, write nothing new and change nothing. `SchoolClass.historyFrozenTo` is
 * where the next run starts.
 *
 * The first observed day of a class is the day after its first lesson event:
 * on the day it was first read the server saw only the lessons that had not
 * begun yet, and the weeks before are the site's to fill (`backfill.ts`).
 */
import type { PrismaClient } from '@prisma/client';
import type { ClassExam, ClassLesson, DateStr } from '@sederyom/shared';
import { DateTime } from 'luxon';
import type { Logger } from '../lib/logger.js';
import { addDays, toDateStr } from '../lib/time.js';
import { freezeDay, type LessonEvent, type TimeWindow } from './freeze.js';

/**
 * Events inside these are not history.
 *
 * 2026-11-04, the markup bug (`shahaf-markup-2026-11.test.ts`): the site stopped
 * printing a line break before the teacher, every lesson was read without one,
 * and so every lesson of every class was deleted and created under another key;
 * the fix turned them back. Production recorded the first burst between 13:46
 * and 14:01 UTC and the way back between 15:31 and 15:47 UTC, class by class
 * (read from `class_change_event` on 2026-11-10). The whole stretch is out, the
 * way back included: with both halves gone a real lesson simply stays as it was
 * before, and the keys without a teacher never were. The cost is a real change
 * the site published in those two hours, which no later event repeats; יב2 had
 * none (its lesson events of the day are exactly the two bursts).
 *
 * The Friday bursts (a week's lessons deleted at about 14:00 on its Friday) need
 * no window: they come after every lesson of that week began.
 */
export const IGNORED_WINDOWS: readonly TimeWindow[] = [
  { from: new Date('2026-11-04T13:45:00Z'), to: new Date('2026-11-04T15:48:59Z') },
];

export interface FreezeDeps {
  prisma: PrismaClient;
  logger: Logger;
  zone: string;
  /** Tests pass their own; production uses `IGNORED_WINDOWS`. */
  ignore?: readonly TimeWindow[];
}

export interface FreezeResult {
  days: number;
  lessons: number;
  exams: number;
}

/** The first day a class is frozen from: the day after its first lesson event; null with no event yet. */
export async function firstObservedDay(prisma: PrismaClient, classId: string, zone: string): Promise<DateStr | null> {
  const first = await prisma.classChangeEvent.findFirst({ where: { classId, kind: 'lesson' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  if (!first) return null;
  return addDays(toDateStr(DateTime.fromJSDate(first.createdAt).setZone(zone)), 1, zone);
}

export async function freezeDueDays(deps: FreezeDeps, opts: { now: Date; daysPerTick: number }): Promise<FreezeResult> {
  const { prisma, zone } = deps;
  const yesterday = addDays(toDateStr(DateTime.fromJSDate(opts.now).setZone(zone)), -1, zone);
  const result: FreezeResult = { days: 0, lessons: 0, exams: 0 };
  const classes = await prisma.schoolClass.findMany({
    where: { lastOkAt: { not: null }, OR: [{ historyFrozenTo: null }, { historyFrozenTo: { lt: yesterday } }] },
    select: { id: true, historyFrozenTo: true, exams: true },
  });

  for (const cls of classes) {
    try {
      const from = cls.historyFrozenTo ? addDays(cls.historyFrozenTo, 1, zone) : await firstObservedDay(prisma, cls.id, zone);
      if (!from || from > yesterday) continue;
      const last = addDays(from, opts.daysPerTick - 1, zone);
      const to = last < yesterday ? last : yesterday;

      const rows = await prisma.classChangeEvent.findMany({
        where: { classId: cls.id, kind: 'lesson', naturalKey: { gte: `${from}|`, lt: `${addDays(to, 1, zone)}|` } },
        select: { naturalKey: true, change: true, payload: true, createdAt: true },
      });
      const events: LessonEvent[] = rows.map((r) => ({
        naturalKey: r.naturalKey,
        change: r.change as LessonEvent['change'],
        after: ((r.payload as { after?: ClassLesson | null } | null)?.after ?? null) as ClassLesson | null,
        createdAt: r.createdAt,
      }));

      let lessons = 0;
      for (let date = from; date <= to; date = addDays(date, 1, zone)) {
        const day = freezeDay(date, events, { zone, ignore: deps.ignore ?? IGNORED_WINDOWS });
        if (day.length === 0) continue;
        const written = await prisma.classLessonHistory.createMany({
          data: day.map((l) => ({
            classId: cls.id, date: l.date, hourIndex: l.hourIndex, subject: l.subject, teacher: l.teacher ?? '', room: l.room,
            startTime: l.startTime, endTime: l.endTime, status: l.status, substitute: l.substitute, note: l.note,
            source: 'observed', changeSeenAt: l.changeSeenAt ? new Date(l.changeSeenAt) : null,
          })),
          skipDuplicates: true,
        });
        lessons += written.count;
      }
      const exams = await freezeExams(prisma, cls.id, (cls.exams as ClassExam[] | null) ?? [], to, zone);

      await prisma.schoolClass.update({ where: { id: cls.id }, data: { historyFrozenTo: to } });
      result.days += DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days + 1;
      result.lessons += lessons;
      result.exams += exams;
    } catch (err) {
      deps.logger.warn({ classId: cls.id, err: String(err) }, 'freezing a class\'s past days failed');
    }
  }
  return result;
}

/**
 * The exams whose day is `to` or earlier: the site's (live in the snapshot, or
 * taken off the list on or after their day, which is the list letting go of a
 * past exam and not a cancellation) and the grade calendar's as last read.
 */
async function freezeExams(prisma: PrismaClient, classId: string, calendar: readonly ClassExam[], to: DateStr, zone: string): Promise<number> {
  const site = await prisma.classSnapshot.findMany({ where: { classId, kind: 'exam' }, select: { naturalKey: true, payload: true, deletedAt: true } });
  const data: { classId: string; naturalKey: string; date: string; subject: string; details: string | null; source: string }[] = [];
  for (const row of site) {
    const p = row.payload as { date?: string | null; subject?: string; details?: string | null } | null;
    if (!p?.date || !p.subject || p.date > to) continue;
    if (row.deletedAt && toDateStr(DateTime.fromJSDate(row.deletedAt).setZone(zone)) < p.date) continue;
    data.push({ classId, naturalKey: row.naturalKey, date: p.date, subject: p.subject, details: p.details ?? null, source: 'shahaf' });
  }
  for (const exam of calendar) {
    if (!exam?.date || !exam.subject || !exam.naturalKey || exam.date > to) continue;
    data.push({ classId, naturalKey: exam.naturalKey, date: exam.date, subject: exam.subject, details: exam.details ?? null, source: 'school_site' });
  }
  if (data.length === 0) return 0;
  return (await prisma.classExamHistory.createMany({ data, skipDuplicates: true })).count;
}
