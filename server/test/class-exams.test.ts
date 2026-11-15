/**
 * The grade's exam calendar per followed class (plan Phase 2e), and the
 * phone's side of it: the calendar's exams in the class feed, and changes the
 * phone marks as new by when it first saw them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClassExam, ClassFeed, ClassLesson } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { SchoolSiteAdapter } from '../src/adapters/school-site/index.js';
import { announceBoard, announceCalendarBoard, announceUploadedBoard, boardInfo, boardInfoFor, hasBoard, storeBoardExams } from '../src/exam-board/store.js';
import { pollDueClasses, pollDueExamCalendars } from '../src/sync/classes.js';
import { buildLocalDays } from '../../app/src/local/days';
import { changeKey, recordChanges } from '../../app/src/local/changes';

const ZONE = 'Asia/Jerusalem';
const NOW = new Date('2026-09-17T19:00:00+03:00');
const AFTER_NOW = new Date(NOW.getTime() + 3600_000);
const ICS = readFileSync(join(__dirname, '..', 'fixtures', 'school-site', 'exams-yb.ics'), 'utf8');
const silent = { info: () => {}, warn: () => {}, error: () => {} };

type PolledRow = {
  id: string;
  examCalendarId: string | null;
  examsPolledAt: Date | null;
  examBoardKind?: string | null;
  examBoardAnnouncedAt?: Date | null;
  examCalendarSetBy?: string | null;
};

/** What the stand-in keeps of a `class_change_event` row. */
type EventRow = { classId: string; kind: string; naturalKey: string; change: string; payload: unknown };

/**
 * Just the class rows the poller touches. The stand-in does what the `where` it is given says and no more: the
 * calendar query filters on `examBoardKind` only if the poller asks it to. An `update` whose `where` names more
 * than the id is P2025 when the row no longer matches (Prisma 5), and `updateMany` answers with the rows it changed.
 * The event that tells a class of its board (`announceBoard`) is kept in `events`; `createEvent` can refuse it, or
 * change the class before it is made.
 */
function fakeClasses(rows: PolledRow[], opts: { createEvent?: () => void } = {}) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const events: EventRow[] = [];
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  const prisma = {
    schoolClass: {
      findMany: async ({ where }: { where: { examBoardKind?: null; OR: { examsPolledAt: null | { lt: Date } }[] } }) => {
        const before = (where.OR[1]!.examsPolledAt as { lt: Date }).lt;
        // copies, as a database gives them: what the poller holds does not change with the row
        return rows
          .filter((r) => r.examCalendarId && (where.examBoardKind === null ? !r.examBoardKind : true) && (!r.examsPolledAt || r.examsPolledAt < before))
          .map((r) => ({ ...r }));
      },
      update: async ({ where, data }: { where: { id: string; examCalendarId?: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id && (where.examCalendarId === undefined || r.examCalendarId === where.examCalendarId));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        updates.push({ id: where.id, data });
        Object.assign(row, data);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => Object.entries(where).every(([key, want]) => same((r as Record<string, unknown>)[key] ?? null, want)));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? { examCalendarSetBy: row.examCalendarSetBy ?? null } : null;
      },
    },
    classChangeEvent: {
      create: async ({ data }: { data: EventRow }) => {
        opts.createEvent?.();
        events.push(data);
        return data;
      },
    },
  };
  return { prisma, updates, events };
}

describe('pollDueExamCalendars', () => {
  it('reads each due class\'s calendar with the owner\'s adapter, and keeps its exams whole', async () => {
    const asked: string[] = [];
    const { prisma, updates } = fakeClasses([
      { id: 'c1', examCalendarId: 'grade12@group.calendar.google.com', examsPolledAt: null },
      { id: 'c2', examCalendarId: 'grade12@group.calendar.google.com', examsPolledAt: new Date(NOW.getTime() - 10 * 60_000) },
      { id: 'c3', examCalendarId: null, examsPolledAt: null },
    ]);
    const result = await pollDueExamCalendars(
      {
        prisma: prisma as never,
        logger: silent,
        schoolSiteFor: (id) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async (url) => (asked.push(url), ICS) }),
      },
      { now: NOW, everyMinutes: 60, limit: 8 },
    );
    expect(result).toEqual({ polled: 1, failed: 0 });
    expect(asked).toEqual(['https://calendar.google.com/calendar/ical/grade12%40group.calendar.google.com/public/basic.ics']);
    const exams = updates[0]!.data.exams as { naturalKey: string; date: string; subject: string }[];
    expect(updates[0]!.id).toBe('c1');
    expect(exams.length).toBeGreaterThan(10);
    expect(exams.every((e) => e.naturalKey.startsWith('site-exam|') && /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
  });

  const deps = (prisma: unknown, onRead: () => void = () => {}) => ({
    prisma: prisma as never,
    logger: silent,
    schoolSiteFor: (id: string) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async () => (onRead(), ICS) }),
  });

  it('does not touch a class whose board was uploaded, whatever the rest of its row says', async () => {
    const { prisma, updates } = fakeClasses([
      { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardKind: 'upload' },
      { id: 'c2', examCalendarId: null, examsPolledAt: null, examBoardKind: 'upload' },
      { id: 'c3', examCalendarId: 'y@group.calendar.google.com', examsPolledAt: null, examBoardKind: null },
    ]);
    const result = await pollDueExamCalendars(deps(prisma), { now: NOW, everyMinutes: 60, limit: 8 });
    expect(result).toEqual({ polled: 1, failed: 0 });
    expect(updates.map((u) => u.id)).toEqual(['c3']);
  });

  it('keeps the exams through storeBoardExams: whole, and the class told of its board the first time only', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null };
    const { prisma, updates } = fakeClasses([row]);
    await pollDueExamCalendars(deps(prisma), { now: NOW, everyMinutes: 60, limit: 8 });
    expect(updates[0]!.data).toMatchObject({ examsPolledAt: NOW, examsOkAt: NOW, examsError: null });
    expect((updates[0]!.data.exams as unknown[]).length).toBeGreaterThan(10);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);

    const later = new Date(NOW.getTime() + 2 * 3600_000);
    await pollDueExamCalendars(deps(prisma), { now: later, everyMinutes: 60, limit: 8 });
    expect(updates).toHaveLength(2);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);
  });

  it('keeps nothing of what it read for a calendar the class has not got any more, and leaves it due', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null };
    const { prisma, updates } = fakeClasses([row]);
    // while the feed is being read, the device that set the calendar brings a file instead
    const result = await pollDueExamCalendars(deps(prisma, () => Object.assign(row, { examCalendarId: null, examBoardKind: 'upload' })), { now: NOW, everyMinutes: 60, limit: 8 });
    expect(result).toEqual({ polled: 1, failed: 0 });
    expect(updates).toEqual([]);
    expect(row).toMatchObject({ examBoardAnnouncedAt: null, examsPolledAt: null });
  });

  it('keeps nothing of a calendar that gives more exams than a board holds, and notes it as a failed read (S-C1)', async () => {
    const big = [
      'BEGIN:VCALENDAR',
      ...Array.from({ length: 2001 }, (_, i) => {
        const day = new Date(Date.UTC(2026, 8, 1 + (i % 360))).toISOString().slice(0, 10).replace(/-/g, '');
        return `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART;VALUE=DATE:${day}\r\nSUMMARY:מבחן ${i}\r\nEND:VEVENT`;
      }),
      'END:VCALENDAR',
    ].join('\r\n');
    const before = [{ naturalKey: 'site-exam|old', date: '2026-10-01', subject: 'מבחן', details: null }];
    const row = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null, exams: before } as PolledRow & { exams: unknown };
    const { prisma, updates, events } = fakeClasses([row]);
    const result = await pollDueExamCalendars(
      { prisma: prisma as never, logger: silent, schoolSiteFor: (id) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async () => big }) },
      { now: NOW, everyMinutes: 60, limit: 8 },
    );
    expect(result).toEqual({ polled: 0, failed: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toEqual({ examsPolledAt: NOW, examsError: expect.stringMatching(/CalendarTooBigError/) });
    expect(row.exams).toBe(before);
    expect(events).toEqual([]);
  });

  it('counts a tick a little early as on time', async () => {
    // Read 59 minutes ago, hourly: due with the tick's slack, not without it.
    const rows = [{ id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: new Date(NOW.getTime() - 59 * 60_000) }];
    const deps = (prisma: unknown) => ({
      prisma: prisma as never,
      logger: silent,
      schoolSiteFor: (id: string) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async () => ICS }),
    });
    expect(await pollDueExamCalendars(deps(fakeClasses(rows).prisma), { now: NOW, everyMinutes: 60, limit: 8 })).toEqual({ polled: 0, failed: 0 });
    expect(await pollDueExamCalendars(deps(fakeClasses(rows).prisma), { now: NOW, everyMinutes: 60, limit: 8, slackMinutes: 2 })).toEqual({ polled: 1, failed: 0 });
  });

  describe('telling the class of its board', () => {
    const CAL = 'x@group.calendar.google.com';
    const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nEND:VCALENDAR\r\n';
    const told = (setBy: string | null): EventRow => ({
      classId: 'c1', kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy }, partition: null },
    });
    const AFTER = (hours: number) => new Date(NOW.getTime() + hours * 3600_000);

    it('is one event the first time a calendar has an exam, naming the device that set the calendar, and not again', async () => {
      const row: PolledRow = { id: 'c1', examCalendarId: CAL, examCalendarSetBy: 'dev1', examsPolledAt: null, examBoardAnnouncedAt: null };
      const { prisma, events } = fakeClasses([row]);
      await pollDueExamCalendars(deps(prisma), { now: NOW, everyMinutes: 60, limit: 8 });
      expect(events).toEqual([told('dev1')]);
      expect(row.examBoardAnnouncedAt).toEqual(NOW);
      await pollDueExamCalendars(deps(prisma), { now: AFTER(2), everyMinutes: 60, limit: 8 });
      expect(events).toHaveLength(1);
    });

    it('names nobody for a calendar from before the setter was kept: every follower is told', async () => {
      const { prisma, events } = fakeClasses([{ id: 'c1', examCalendarId: CAL, examsPolledAt: null, examBoardAnnouncedAt: null }]);
      await pollDueExamCalendars(deps(prisma), { now: NOW, everyMinutes: 60, limit: 8 });
      expect(events).toEqual([told(null)]);
    });

    it('is none for a read with no exam in it, and one for the read that finds the first', async () => {
      let feed = EMPTY_ICS;
      const row: PolledRow = { id: 'c1', examCalendarId: CAL, examCalendarSetBy: 'dev1', examsPolledAt: null, examBoardAnnouncedAt: null };
      const { prisma, events } = fakeClasses([row]);
      const read = () => ({ prisma: prisma as never, logger: silent, schoolSiteFor: (id: string) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async () => feed }) });
      expect(await pollDueExamCalendars(read(), { now: NOW, everyMinutes: 60, limit: 8 })).toEqual({ polled: 1, failed: 0 });
      expect(events).toEqual([]);
      expect(row.examBoardAnnouncedAt).toBeNull();
      feed = ICS;
      await pollDueExamCalendars(read(), { now: AFTER(2), everyMinutes: 60, limit: 8 });
      expect(events).toEqual([told('dev1')]);
      expect(row.examBoardAnnouncedAt).toEqual(AFTER(2));
    });

    it('is not a failed read when the event cannot be made: the exams are kept, the mark is taken back, the next read tells the class', async () => {
      let broken = true;
      const warned: unknown[] = [];
      const row: PolledRow = { id: 'c1', examCalendarId: CAL, examCalendarSetBy: 'dev1', examsPolledAt: null, examBoardAnnouncedAt: null };
      const { prisma, updates, events } = fakeClasses([row], { createEvent: () => { if (broken) throw new RangeError('LEAKMARK the database said this'); } });
      const logger = { info: () => {}, warn: (o: unknown) => void warned.push(o), error: (o: unknown) => void warned.push(o) };
      const read = () => ({ prisma: prisma as never, logger, schoolSiteFor: (id: string) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async () => ICS }) });

      expect(await pollDueExamCalendars(read(), { now: NOW, everyMinutes: 60, limit: 8 })).toEqual({ polled: 1, failed: 0 });
      expect(updates).toHaveLength(1);
      expect(updates[0]!.data).toMatchObject({ examsOkAt: NOW, examsError: null });
      expect(row.examBoardAnnouncedAt).toBeNull();
      expect(events).toEqual([]);
      // the error's name, and nothing it said
      expect(JSON.stringify(warned)).toContain('RangeError');
      expect(JSON.stringify(warned)).not.toContain('LEAKMARK');

      broken = false;
      await pollDueExamCalendars(read(), { now: AFTER(2), everyMinutes: 60, limit: 8 });
      expect(events).toEqual([told('dev1')]);
      expect(row.examBoardAnnouncedAt).toEqual(AFTER(2));
    });
  });

  it('records a failed read and tries again later', async () => {
    const { prisma, updates } = fakeClasses([{ id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null }]);
    const result = await pollDueExamCalendars(
      { prisma: prisma as never, logger: silent, schoolSiteFor: (id) => new SchoolSiteAdapter({ calendarId: id, zone: ZONE, fetcher: async () => { throw new Error('404'); } }) },
      { now: NOW, everyMinutes: 60, limit: 8 },
    );
    expect(result).toEqual({ polled: 0, failed: 1 });
    expect(updates[0]!.data).toMatchObject({ examsPolledAt: NOW, examsError: 'Error: 404' });
  });
});

const exam = (n: number, over: Partial<ClassExam> = {}): ClassExam => ({ naturalKey: `site-exam|${n}`, date: '2026-10-05', subject: `מבחן ${n}`, details: null, ...over });

describe('storeBoardExams', () => {
  it('keeps the exams as the class has them, and says so the first time the class has a board with an exam', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null };
    const { prisma, updates } = fakeClasses([row]);
    expect(await storeBoardExams(prisma as never, 'c1', [exam(1), exam(2)], NOW)).toBe(true);
    expect(updates).toEqual([{ id: 'c1', data: { exams: [exam(1), exam(2)], examsPolledAt: NOW, examsOkAt: NOW, examsError: null } }]);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);
    // and not again, whatever it keeps after that
    const later = new Date(NOW.getTime() + 3600_000);
    expect(await storeBoardExams(prisma as never, 'c1', [exam(1)], later)).toBe(false);
    expect(updates).toHaveLength(2);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);
  });

  it('does not say so for a read with no exam, and says so the first time there is one', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null };
    const { prisma, updates } = fakeClasses([row]);
    expect(await storeBoardExams(prisma as never, 'c1', [], NOW)).toBe(false);
    expect(row.examBoardAnnouncedAt).toBeNull();
    expect(updates[0]!.data).toMatchObject({ exams: [], examsPolledAt: NOW });
    expect(await storeBoardExams(prisma as never, 'c1', [exam(1)], NOW)).toBe(true);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);
  });

  it('keeps an exam without the mark of where it came from: the feed puts it on', async () => {
    const { prisma, updates } = fakeClasses([{ id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null }]);
    await storeBoardExams(prisma as never, 'c1', [exam(1, { source: 'school_site' })], NOW);
    expect(updates[0]!.data.exams).toEqual([exam(1)]);
  });

  it('keeps nothing, and says nothing, when the class has another calendar than the one the exams were read from', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null };
    const { prisma, updates } = fakeClasses([row]);
    expect(await storeBoardExams(prisma as never, 'c1', [exam(1)], NOW, 'other@group.calendar.google.com')).toBe(false);
    expect(updates).toEqual([]);
    expect(row.examBoardAnnouncedAt).toBeNull();
    expect(await storeBoardExams(prisma as never, 'c1', [exam(1)], NOW, 'x@group.calendar.google.com')).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it('lets only one of two reads at the same moment say so', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: null };
    const { prisma } = fakeClasses([row]);
    const said = await Promise.all([storeBoardExams(prisma as never, 'c1', [exam(1)], NOW), storeBoardExams(prisma as never, 'c1', [exam(1)], NOW)]);
    expect(said.filter(Boolean)).toHaveLength(1);
  });
});

describe('announcing a board', () => {
  it('is told with an event that carries no exam and no name, only who brought the board', async () => {
    const { prisma, events } = fakeClasses([]);
    await announceBoard(prisma as never, 'c1', 'dev1');
    await announceBoard(prisma as never, 'c1', null);
    expect(events).toEqual([
      { classId: 'c1', kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy: 'dev1' }, partition: null } },
      { classId: 'c1', kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy: null }, partition: null } },
    ]);
  });

  it('takes the mark back only if it is still the one it set: a board removed and told again in the meantime keeps its own', async () => {
    const row: PolledRow = { id: 'c1', examCalendarId: 'x@group.calendar.google.com', examsPolledAt: null, examBoardAnnouncedAt: NOW, examCalendarSetBy: 'dev1' };
    const newer = new Date(NOW.getTime() + 60_000);
    const { prisma, events } = fakeClasses([row], {
      createEvent: () => {
        row.examBoardAnnouncedAt = newer;
        throw new RangeError('the database said this');
      },
    });
    await announceCalendarBoard(prisma as never, 'c1', NOW, silent);
    expect(events).toEqual([]);
    expect(row.examBoardAnnouncedAt).toEqual(newer);
  });

  it('is told for a board from a file only by the device that saved it, once, and only while the board is that one', async () => {
    const upload = (over: Partial<PolledRow> = {}): PolledRow => ({
      id: 'c1', examCalendarId: null, examsPolledAt: null, examBoardKind: 'upload', examCalendarSetBy: 'dev1', examBoardAnnouncedAt: null, ...over,
    });
    const told = (setBy: string) => ({ classId: 'c1', kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy }, partition: null } });

    const row = upload();
    const { prisma, events } = fakeClasses([row]);
    await announceUploadedBoard(prisma as never, 'c1', 'dev1', NOW, silent);
    expect(events).toEqual([told('dev1')]);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);
    // a board that is only replaced finds the class told
    await announceUploadedBoard(prisma as never, 'c1', 'dev1', AFTER_NOW, silent);
    expect(events).toHaveLength(1);
    expect(row.examBoardAnnouncedAt).toEqual(NOW);

    // the board was removed, or taken over, between the save and this: nothing is marked, nothing is told
    for (const over of [{ examBoardKind: null, examCalendarSetBy: null }, { examCalendarSetBy: 'dev2' }, { examCalendarId: 'x@group.calendar.google.com', examBoardKind: null }]) {
      const gone = upload(over);
      const world = fakeClasses([gone]);
      await announceUploadedBoard(world.prisma as never, 'c1', 'dev1', NOW, silent);
      expect([over, world.events, gone.examBoardAnnouncedAt]).toEqual([over, [], null]);
    }
  });

  it("is not a failure of the save when the mark cannot be set: it is logged by the error's name, and the class is not told", async () => {
    const warned: unknown[] = [];
    const logger = { info: () => {}, warn: (o: unknown) => void warned.push(o), error: () => {} };
    const prisma = { schoolClass: { updateMany: async () => { throw new RangeError('LEAKMARK the database said this'); } } };
    await announceUploadedBoard(prisma as never, 'c1', 'dev1', NOW, logger);
    expect(JSON.stringify(warned)).toContain('RangeError');
    expect(JSON.stringify(warned)).not.toContain('LEAKMARK');
  });
});

describe('what a class has for a board', () => {
  const none = { examCalendarId: null, examBoardKind: null };

  it('is a calendar, or a file, or nothing', () => {
    expect(hasBoard(none)).toBe(false);
    expect(hasBoard({ examCalendarId: 'x@group.calendar.google.com', examBoardKind: null })).toBe(true);
    expect(hasBoard({ examCalendarId: null, examBoardKind: 'upload' })).toBe(true);
  });

  it('is told to a device as its kind, when it was set, how many exams it holds, whether the device brought it, and whether it may replace it', () => {
    const at = new Date('2026-11-10T09:00:00Z');
    const exams = [exam(1), exam(2), exam(3)];
    expect(boardInfo({ ...none, examCalendarSetBy: 'd1', examBoardSetAt: null, exams }, 'd1', true)).toBeNull();
    const upload = { examCalendarId: null, examBoardKind: 'upload', examCalendarSetBy: 'd1', examBoardSetAt: at, exams };
    expect(boardInfo(upload, 'd1', true)).toEqual({ kind: 'upload', setAt: at.toISOString(), count: 3, mine: true, mayChange: true });
    expect(boardInfo(upload, 'd2', false)).toEqual({ kind: 'upload', setAt: at.toISOString(), count: 3, mine: false, mayChange: false });
    // a calendar set before the board had a time of its own has none, and none of its exams are read yet
    const old = { examCalendarId: 'x@group.calendar.google.com', examBoardKind: null, examCalendarSetBy: null, examBoardSetAt: null, exams: null };
    expect(boardInfo(old, 'd1', true)).toEqual({ kind: 'calendar', setAt: null, count: 0, mine: false, mayChange: true });
    expect(boardInfo({ ...old, exams: 'not a list' }, 'd1', false)?.count).toBe(0);
  });
});

describe('whether a device may replace the board, as the lock says it', () => {
  const upload = { examCalendarId: null, examBoardKind: 'upload', examBoardSetAt: NOW, examCalendarSetBy: 'setter', exams: [exam(1)] };
  /** Counts the questions asked of the database, and answers for a setter that is in the class `setterIn` and, if not, may follow it (`follows`). */
  function asked(opts: { setterIn?: string | null; follows?: boolean } = {}) {
    let queries = 0;
    const prisma = {
      device: { findUnique: async () => (queries++, opts.setterIn === undefined ? null : { classId: opts.setterIn }) },
      classFollow: { findUnique: async () => (queries++, opts.follows ? { deviceId: 'setter', classId: 'c1' } : null) },
    };
    return { prisma: prisma as never, queries: () => queries };
  }
  const info = (db: ReturnType<typeof asked>, deviceId: string, own = true) => boardInfoFor(db.prisma, upload, deviceId, 'c1', own);

  it('asks nothing of the database for the device that brought it, for a class that has no board, or for a class that is not its own', async () => {
    const db = asked({ setterIn: 'c1' });
    expect(await info(db, 'setter')).toMatchObject({ mine: true, mayChange: true });
    expect(await boardInfoFor(db.prisma, { ...upload, examCalendarId: null, examBoardKind: null }, 'd2', 'c1', true)).toBeNull();
    expect(await boardInfoFor(db.prisma, { ...upload, examCalendarSetBy: null }, 'd2', 'c1', true)).toMatchObject({ mayChange: true });
    expect(await info(db, 'd2', false)).toMatchObject({ mine: false, mayChange: false });
    expect(await info(db, 'setter', false)).toMatchObject({ mine: true, mayChange: false });
    expect(db.queries()).toBe(0);
  });

  it('asks the lock for a classmate: one question while the setter is in the class, two when it is not', async () => {
    const stays = asked({ setterIn: 'c1' });
    expect(await info(stays, 'd2')).toMatchObject({ mine: false, mayChange: false });
    expect(stays.queries()).toBe(1);

    const follows = asked({ setterIn: 'c9', follows: true });
    expect(await info(follows, 'd2')).toMatchObject({ mayChange: false });
    expect(follows.queries()).toBe(2);

    const left = asked({ setterIn: 'c9', follows: false });
    expect(await info(left, 'd2')).toMatchObject({ mayChange: true });
    const gone = asked({});
    expect(await info(gone, 'd2')).toMatchObject({ mayChange: true });
  });
});

describe('pollDueClasses', () => {
  it('asks for the classes polled before the cadence, less the slack', async () => {
    const asked: Date[] = [];
    const prisma = {
      schoolClass: {
        findMany: async ({ where }: { where: { OR: { polledAt: null | { lt: Date } }[] } }) => {
          asked.push((where.OR[1]!.polledAt as { lt: Date }).lt);
          return [];
        },
      },
    };
    const deps = { prisma: prisma as never, logger: silent, shahafFor: () => { throw new Error('nothing is due'); } };
    await pollDueClasses(deps, { now: NOW, everyMinutes: 15, limit: 8 });
    await pollDueClasses(deps, { now: NOW, everyMinutes: 15, limit: 8, slackMinutes: 2 });
    expect(asked.map((d) => (NOW.getTime() - d.getTime()) / 60_000)).toEqual([15, 13]);
  });
});

const lesson = (over: Partial<ClassLesson>): ClassLesson => ({
  date: '2026-09-17', hourIndex: 3, startTime: '09:45', endTime: '10:30', subject: 'פיזיקה', teacher: 'לוי', room: null, status: 'regular', substitute: null, note: null, ...over,
});

describe("the phone's changes and the exam calendar", () => {
  it('notes a change the first time it is seen, and keeps that moment', () => {
    const first = recordChanges([lesson({}), lesson({ status: 'cancelled' })], {}, NOW, ZONE, '2026-09-17');
    expect(Object.keys(first)).toEqual([changeKey(lesson({ status: 'cancelled' }))]);
    const later = new Date(NOW.getTime() + 3600_000);
    const second = recordChanges([lesson({ status: 'cancelled' }), lesson({ hourIndex: 5, status: 'substitution' })], first, later, ZONE, '2026-09-17');
    expect(second[changeKey(lesson({ status: 'cancelled' }))]).toBe(first[changeKey(lesson({ status: 'cancelled' }))]);
    expect(Object.keys(second)).toHaveLength(2);
    // A fortnight on, the old day is forgotten.
    expect(recordChanges([], second, later, ZONE, '2026-10-05')).toEqual({});
  });

  it('marks the change on the day, and carries the calendar\'s exams as the server does', () => {
    const feed: ClassFeed = {
      class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
      lastOkAt: NOW.toISOString(),
      freshness: null,
      lessons: [lesson({ status: 'cancelled' })],
      changes: [],
      exams: [{ naturalKey: 'site-exam|abc', date: '2026-09-18', subject: 'מתכונת באנגלית', details: null, source: 'school_site' }],
      events: [],
      messages: [],
    };
    const seen = recordChanges(feed.lessons, {}, NOW, ZONE, '2026-09-17');
    const [day] = buildLocalDays({ feed, mashov: [], bagrut: [], google: [], settings: DEFAULT_SETTINGS, changeSeen: seen, zone: ZONE, now: NOW }, ['2026-09-17']);
    const cancelled = day!.timeline.find((i) => i.kind === 'lesson');
    expect(cancelled?.kind === 'lesson' && cancelled.lesson.changeSeenAt).toBe('2026-09-17T19:00:00.000+03:00');
    expect(day!.examsTomorrow.map((e) => `${e.source} ${e.subject}`)).toEqual(['school_site מתכונת באנגלית']);
  });
});
