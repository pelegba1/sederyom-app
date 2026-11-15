/**
 * The weeks before a class's log began, read from the site's past weeks
 * (docs/superpowers/specs/2026-11-10-year-wrapped-design.md §2).
 *
 * The site answers `week=-N` back to the school year's first week, but with
 * the regular grid: the changes a week had are almost all gone (the first week
 * of 2026 showed four on 1.9 and none on 10.11). So these rows are `backfill`:
 * good for what was scheduled, never for what was cancelled, even where the
 * site happens to still show a change. A vacation week comes back with a full
 * grid too; whoever counts takes days off away with the school calendar.
 *
 * One week at a time, newest first, from the week the log began in down to the
 * week of 1 September, a few pages a tick. Rows are only inserted, and only for
 * days before the class's first observed day. `historyBackfilledTo` is the
 * Sunday of the last week done; a page that cannot be read leaves it where it
 * was, and the same week is asked for on the next tick.
 */
import type { PrismaClient } from '@prisma/client';
import type { DateStr } from '@sederyom/shared';
import { DateTime } from 'luxon';
import type { ShahafAdapter } from '../adapters/shahaf/index.js';
import type { Logger } from '../lib/logger.js';
import { addDays, toDateStr, weekStart } from '../lib/time.js';
import { firstObservedDay } from './run.js';

export interface BackfillDeps {
  prisma: PrismaClient;
  logger: Logger;
  zone: string;
  shahafFor(siteUrl: string): Pick<ShahafAdapter, 'fetchPastWeek'>;
  /** Between two page reads; tests pass a no-op. */
  pause?: () => Promise<void>;
}

/** Between two reads of a site's past weeks: this is not news, and the site owes us nothing. */
const PAUSE_MS = 1000;

/** 1 September of the school year `today` is in. */
export function schoolYearStart(today: DateStr): DateStr {
  const year = Number(today.slice(0, 4));
  return `${Number(today.slice(5, 7)) >= 9 ? year : year - 1}-09-01`;
}

export async function backfillDueClasses(deps: BackfillDeps, opts: { now: Date; weeksPerTick: number }): Promise<{ weeks: number; lessons: number }> {
  const { prisma, zone } = deps;
  const pause = deps.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, PAUSE_MS)));
  const today = toDateStr(DateTime.fromJSDate(opts.now).setZone(zone));
  const thisSunday = weekStart(today, 0, zone);
  const yearStart = schoolYearStart(today);
  const firstWeek = weekStart(yearStart, 0, zone);
  const result = { weeks: 0, lessons: 0 };
  if (opts.weeksPerTick <= 0) return result;

  const classes = await prisma.schoolClass.findMany({
    where: { lastOkAt: { not: null }, historyBackfillDone: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, shahafClassId: true, historyBackfilledTo: true, school: { select: { shahafUrl: true } } },
  });

  for (const cls of classes) {
    if (result.weeks >= opts.weeksPerTick) break;
    try {
      const observedFrom = await firstObservedDay(prisma, cls.id, zone);
      if (!observedFrom) continue;
      const adapter = deps.shahafFor(cls.school.shahafUrl);
      // The week the last day before the log is in, then one week back at a time.
      let sunday = cls.historyBackfilledTo ? addDays(cls.historyBackfilledTo, -7, zone) : weekStart(addDays(observedFrom, -1, zone), 0, zone);

      while (result.weeks < opts.weeksPerTick) {
        if (sunday < firstWeek) {
          await prisma.schoolClass.update({ where: { id: cls.id }, data: { historyBackfillDone: true } });
          break;
        }
        const weeksBack = Math.round(DateTime.fromISO(thisSunday).diff(DateTime.fromISO(sunday), 'days').days / 7);
        if (result.weeks > 0) await pause();
        const week = await adapter.fetchPastWeek(cls.shahafClassId, weeksBack, opts.now);
        // No grid, or another week's: the site is down or answered something else. Not an empty week.
        if (week.days[0] !== sunday) throw new Error(`shahaf week ${sunday}: the page shows ${week.days[0] ?? 'no timetable'}`);

        const rows = week.lessons.filter((l) => l.date >= yearStart && l.date < observedFrom);
        const written = rows.length === 0 ? { count: 0 } : await prisma.classLessonHistory.createMany({
          data: rows.map((l) => ({
            classId: cls.id, date: l.date, hourIndex: l.hourIndex, subject: l.subject, teacher: l.teacher ?? '', room: l.room,
            startTime: l.startTime, endTime: l.endTime, status: l.status, substitute: l.substitute, note: l.note, source: 'backfill',
          })),
          skipDuplicates: true,
        });
        await prisma.schoolClass.update({ where: { id: cls.id }, data: { historyBackfilledTo: sunday, historyBackfillDone: sunday <= firstWeek } });
        result.weeks += 1;
        result.lessons += written.count;
        if (sunday <= firstWeek) break;
        sunday = addDays(sunday, -7, zone);
      }
    } catch (err) {
      deps.logger.warn({ classId: cls.id, site: cls.school.shahafUrl, err: String(err) }, 'filling a class\'s past weeks failed');
    }
  }
  return result;
}
