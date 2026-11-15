/**
 * The daily freeze on Postgres (year wrapped, part 1): past days become
 * `class_lesson_history` rows once, and stay as written.
 * Runs with `RUN_DB_TESTS=1` against the dev database (never production: it empties the class tables).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClassLesson } from '@sederyom/shared';
import { freezeDueDays } from '../src/history/run.js';

const enabled = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_TESTS === '1';
const suite = enabled ? describe : describe.skip;

const ZONE = 'Asia/Jerusalem';
const logger = { info: () => {}, warn: () => {}, error: () => {} };
/** The class was first read on Monday 19.10 in the evening. */
const FIRST_READ = new Date('2026-10-19T19:01:00+03:00');

function lesson(date: string, over: Partial<ClassLesson> = {}): ClassLesson {
  return { date, hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'אנגלית', teacher: 'שרון', room: '108', status: 'regular', substitute: null, note: null, ...over };
}
const keyOf = (l: ClassLesson) => `${l.date}|${l.hourIndex}|${l.subject}|${l.teacher ?? ''}`;

suite('the daily freeze (Postgres)', () => {
  let prisma: PrismaClient;
  let classId: string;

  const event = (l: ClassLesson, change: string, at: Date) =>
    prisma.classChangeEvent.create({
      data: { classId, kind: 'lesson', naturalKey: keyOf(l), change, payload: { before: null, after: change === 'deleted' ? null : l, partition: l.date } as object, createdAt: at },
    });
  const freeze = (now: string, daysPerTick = 14) => freezeDueDays({ prisma, logger, zone: ZONE, ignore: [] }, { now: new Date(now), daysPerTick });
  const rows = () => prisma.classLessonHistory.findMany({ where: { classId }, orderBy: [{ date: 'asc' }, { hourIndex: 'asc' }] });

  beforeAll(() => {
    prisma = new PrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
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
    // The first read brought the day itself and the three after it.
    for (const date of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']) await event(lesson(date), 'created', FIRST_READ);
  });

  it('freezes the days that passed and not today', async () => {
    await event(lesson('2026-10-21', { status: 'cancelled' }), 'updated', new Date('2026-10-20T17:00:00+03:00'));
    const out = await freeze('2026-10-22T10:00:00+03:00');
    expect(out).toMatchObject({ days: 2, lessons: 2 });
    expect((await rows()).map((r) => [r.date, r.status, r.source, r.changeSeenAt?.toISOString() ?? null])).toEqual([
      ['2026-10-20', 'regular', 'observed', null],
      ['2026-10-21', 'cancelled', 'observed', '2026-10-20T14:00:00.000Z'],
    ]);
    expect((await prisma.schoolClass.findUniqueOrThrow({ where: { id: classId } })).historyFrozenTo).toBe('2026-10-21');
  });

  it('the day the class was first read is not frozen as observed', async () => {
    await freeze('2026-10-22T10:00:00+03:00');
    expect((await rows()).some((r) => r.date === '2026-10-19')).toBe(false);
  });

  it('a second run writes nothing, and what came later does not change a row', async () => {
    await freeze('2026-10-22T10:00:00+03:00');
    const before = await rows();
    // The site drops the lesson on Friday; the day is already frozen.
    await event(lesson('2026-10-20'), 'deleted', new Date('2026-10-23T14:00:00+03:00'));
    await prisma.schoolClass.update({ where: { id: classId }, data: { historyFrozenTo: null } });
    expect((await freeze('2026-10-22T10:05:00+03:00')).lessons).toBe(0);
    expect(await rows()).toEqual(before);
  });

  it('two runs at once write each row once and neither fails', async () => {
    const [a, b] = await Promise.all([freeze('2026-10-22T10:00:00+03:00'), freeze('2026-10-22T10:00:00+03:00')]);
    expect(a.lessons + b.lessons).toBe(2);
    expect(await rows()).toHaveLength(2);
  });

  it('writes at most daysPerTick days a run, oldest first, and goes on from there', async () => {
    expect((await freeze('2026-10-23T10:00:00+03:00', 1)).days).toBe(1);
    expect((await rows()).map((r) => r.date)).toEqual(['2026-10-20']);
    await freeze('2026-10-23T10:20:00+03:00', 1);
    expect((await rows()).map((r) => r.date)).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('a class never read, or with no lesson event, is left alone', async () => {
    await prisma.classChangeEvent.deleteMany();
    expect(await freeze('2026-10-22T10:00:00+03:00')).toEqual({ days: 0, lessons: 0, exams: 0 });
    expect((await prisma.schoolClass.findUniqueOrThrow({ where: { id: classId } })).historyFrozenTo).toBeNull();
  });

  it('an exam whose day passed is recorded once; one taken off before its day is not', async () => {
    const snap = (naturalKey: string, date: string, deletedAt: Date | null) =>
      prisma.classSnapshot.create({
        data: { classId, kind: 'exam', naturalKey, contentHash: 'h', payload: { date, subject: 'מבחן במתמטיקה', details: null }, lastSeen: FIRST_READ, deletedAt },
      });
    await snap('shahaf-exam|held', '2026-10-20', new Date('2026-10-21T06:00:00+03:00'));
    await snap('shahaf-exam|called-off', '2026-10-21', new Date('2026-10-20T12:00:00+03:00'));
    await snap('shahaf-exam|ahead', '2026-10-28', null);
    await prisma.schoolClass.update({
      where: { id: classId },
      data: { exams: [{ naturalKey: 'ics|1', date: '2026-10-20', subject: 'מתמטיקה', details: 'שעה 3' }, { naturalKey: 'ics|2', date: '2026-11-02', subject: 'אנגלית', details: null }] },
    });
    expect((await freeze('2026-10-22T10:00:00+03:00')).exams).toBe(2);
    await prisma.schoolClass.update({ where: { id: classId }, data: { historyFrozenTo: '2026-10-20' } });
    await freeze('2026-10-22T10:20:00+03:00');
    const exams = await prisma.classExamHistory.findMany({ where: { classId }, orderBy: { naturalKey: 'asc' } });
    expect(exams.map((e) => [e.naturalKey, e.date, e.source])).toEqual([
      ['ics|1', '2026-10-20', 'school_site'],
      ['shahaf-exam|held', '2026-10-20', 'shahaf'],
    ]);
  });
});
