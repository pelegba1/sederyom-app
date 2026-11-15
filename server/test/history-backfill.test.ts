/**
 * The weeks before a class's log began, read from the site's past weeks (year
 * wrapped, part 1). Checked live on 2026-11-10: `week=-N` answers back to the
 * year's first week with the regular grid and almost none of its changes, so
 * these rows are `backfill` and never stand in for an observed day.
 * Runs with `RUN_DB_TESTS=1` against the dev database (never production: it empties the class tables).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ShahafAdapter, type ShahafFetcher } from '../src/adapters/shahaf/index.js';
import { backfillDueClasses } from '../src/history/backfill.js';
import { addDays, weekStart } from '../src/lib/time.js';

const enabled = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_TESTS === '1';
const suite = enabled ? describe : describe.skip;

const ZONE = 'Asia/Jerusalem';
const logger = { info: () => {}, warn: () => {}, error: () => {} };
/** Thursday 22.10.2026; the class was first read on Monday 19.10, so it is observed from Tuesday 20.10. */
const NOW = new Date('2026-10-22T10:00:00+03:00');
const FIRST_READ = new Date('2026-10-19T19:01:00+03:00');
const THIS_SUNDAY = '2026-10-18';

/** A week's page as the site prints it: English in period 1 on Sunday to Thursday. */
function weekHtml(sunday: string, cell = '<div class="TTLesson"><b>אנגלית</b><br/>שרון</div>'): string {
  const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
  const head = names.map((n, i) => `<td class="CTitle" data-day="${i}">יום ${n} ${dm(addDays(sunday, i, ZONE))}</td>`).join('');
  const cells = names.map((_n, i) => `<td class="TTCell" data-day="${i}">${i < 5 ? cell : ''}</td>`).join('');
  return `<html><body><div class="tt-module"><table class="TTTable" dir="rtl"><tr><td class="CName"></td>${head}</tr>` +
    `<tr><td class="CName"><b>1<br/><span class="hour-time">08:00</span><br/><span class="hour-time">08:45</span></b></td>${cells}</tr></table></div></body></html>`;
}

suite('filling past weeks from the site (Postgres)', () => {
  let prisma: PrismaClient;
  let classId: string;
  let asked: number[] = [];
  let page: (week: number) => string;

  const fetcher: ShahafFetcher = async ({ week }) => {
    asked.push(week ?? 0);
    return page(week ?? 0);
  };
  const run = (weeksPerTick = 2, now = NOW) =>
    backfillDueClasses(
      { prisma, logger, zone: ZONE, pause: async () => {}, shahafFor: (baseUrl) => new ShahafAdapter({ baseUrl, zone: ZONE, weeksAhead: 0, fetcher }) },
      { now, weeksPerTick },
    );
  const cls = () => prisma.schoolClass.findUniqueOrThrow({ where: { id: classId } });
  const dates = async () => (await prisma.classLessonHistory.findMany({ where: { classId }, orderBy: { date: 'asc' } })).map((r) => r.date);

  beforeAll(() => {
    prisma = new PrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    asked = [];
    page = (week) => weekHtml(addDays(THIS_SUNDAY, week * 7, ZONE));
    await prisma.$transaction([
      prisma.classLessonHistory.deleteMany(),
      prisma.classExamHistory.deleteMany(),
      prisma.deviceNotification.deleteMany(),
      prisma.classChangeEvent.deleteMany(),
      prisma.classSnapshot.deleteMany(),
      prisma.device.deleteMany(),
      prisma.schoolClass.deleteMany(),
      prisma.school.deleteMany(),
    ]);
    const school = await prisma.school.create({ data: { shahafUrl: 'https://dugma.shahaf.site' } });
    classId = (await prisma.schoolClass.create({ data: { schoolId: school.id, shahafClassId: '53', name: 'יב2', lastOkAt: FIRST_READ, polledAt: FIRST_READ } })).id;
    await prisma.classChangeEvent.create({
      data: { classId, kind: 'lesson', naturalKey: '2026-10-20|1|אנגלית|שרון', change: 'created', payload: {}, createdAt: FIRST_READ },
    });
  });

  it('starts with the days of the first week that came before the log, then walks back', async () => {
    expect(await run(2)).toEqual({ weeks: 2, lessons: 7 });
    expect(asked).toEqual([0, -1]);
    // Sunday and Monday of the week the log began in, then the whole week before.
    expect(await dates()).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-18', '2026-10-19']);
    const rows = await prisma.classLessonHistory.findMany({ where: { classId } });
    expect(new Set(rows.map((r) => `${r.source}|${r.status}|${r.changeSeenAt}`))).toEqual(new Set(['backfill|regular|null']));
    expect((await cls()).historyBackfilledTo).toBe('2026-10-11');
  });

  it('never writes a day the log covers, or over a row that is there', async () => {
    await prisma.classLessonHistory.create({
      data: { classId, date: '2026-10-19', hourIndex: 1, subject: 'אנגלית', teacher: 'שרון', status: 'cancelled', source: 'observed' },
    });
    await run(1);
    const rows = await prisma.classLessonHistory.findMany({ where: { classId }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => [r.date, r.source, r.status])).toEqual([
      ['2026-10-18', 'backfill', 'regular'],
      ['2026-10-19', 'observed', 'cancelled'],
    ]);
  });

  it('keeps a change the site still shows, as the site shows it, still as backfill', async () => {
    page = (week) => weekHtml(addDays(THIS_SUNDAY, week * 7, ZONE), '<div class="TTChange TableFreeChange">ביטול אנגלית, שרון</div>');
    await run(1);
    const rows = await prisma.classLessonHistory.findMany({ where: { classId } });
    expect(new Set(rows.map((r) => `${r.source}|${r.status}`))).toEqual(new Set(['backfill|cancelled']));
  });

  it('stops at the school year\'s first week and is done', async () => {
    // From 18.10 back to the week of 30.8.2026: eight weeks. Days before 1.9 are not the year's.
    expect((await run(20)).weeks).toBe(8);
    expect(asked[asked.length - 1]).toBe(-7);
    expect((await dates())[0]).toBe('2026-09-01');
    expect(await cls()).toMatchObject({ historyBackfilledTo: '2026-08-30', historyBackfillDone: true });
    asked = [];
    expect(await run(20)).toEqual({ weeks: 0, lessons: 0 });
    expect(asked).toEqual([]);
  });

  it('a page without a grid stops the class for this tick and keeps its place', async () => {
    page = (week) => (week === -1 ? '<html><body>שגיאה</body></html>' : weekHtml(addDays(THIS_SUNDAY, week * 7, ZONE)));
    expect((await run(5)).weeks).toBe(1);
    expect(await cls()).toMatchObject({ historyBackfilledTo: THIS_SUNDAY, historyBackfillDone: false });
    // The site is back: the same week is asked for again.
    page = (week) => weekHtml(addDays(THIS_SUNDAY, week * 7, ZONE));
    asked = [];
    await run(1);
    expect(asked).toEqual([-1]);
  });

  it('a page that answers another week than the one asked for is not written', async () => {
    page = () => weekHtml(THIS_SUNDAY);
    await run(3);
    expect(await cls()).toMatchObject({ historyBackfilledTo: THIS_SUNDAY });
    expect((await dates()).every((d) => d >= THIS_SUNDAY)).toBe(true);
  });

  it('a week with no lessons writes nothing and moves on', async () => {
    page = (week) => (week === -1 ? weekHtml(addDays(THIS_SUNDAY, -7, ZONE), '') : weekHtml(addDays(THIS_SUNDAY, week * 7, ZONE)));
    expect(await run(3)).toMatchObject({ weeks: 3 });
    expect((await cls()).historyBackfilledTo).toBe(weekStart('2026-10-04', 0, ZONE));
    expect((await dates()).some((d) => d >= '2026-10-11' && d < THIS_SUNDAY)).toBe(false);
  });

  it('asks for the week by how far back it is from the week of now', async () => {
    await run(1);
    asked = [];
    // Two weeks later the next week back is three weeks before the current one.
    await run(1, new Date('2026-11-05T10:00:00+02:00'));
    expect(asked).toEqual([-3]);
  });

  it('a class with no lesson event yet is not fetched', async () => {
    await prisma.classChangeEvent.deleteMany();
    expect(await run(5)).toEqual({ weeks: 0, lessons: 0 });
    expect(asked).toEqual([]);
  });
});
