/**
 * Parallel groups: one period, several `.TTLesson` blocks in the same cell.
 * The live grid does this for two history teachers, two maths groups and two
 * PE groups; for this student it is chemistry beside physics and two
 * network-services groups. Each block is a lesson, and a change under them
 * belongs to the group it names.
 */
import { describe, expect, it } from 'vitest';
import { ShahafAdapter, lessonNaturalKey } from '../src/adapters/shahaf/index.js';
import { parseTimetable } from '../src/adapters/shahaf/parser.js';
import { MemorySnapshotStore, applyDelta } from '../src/sync/delta.js';
import { filterLessons } from '@sederyom/shared/logic/filters';

const cell = (body: string) => `<table class="TTTable"><tr><td class="CTitle" data-day="4">10.09</td></tr><tr><td class="CName">1<span class="hour-time">08:00</span><span class="hour-time">08:45</span></td><td class="TTCell" data-day="4">${body}</td></tr></table>`;
const lesson = (subject: string, teacher: string) => `<div class="TTLesson"><b>${subject}</b><br>${teacher}</div>`;

describe('parallel Shahaf groups', () => {
  it('keeps physics when chemistry appears first and is hidden', () => {
    const parsed = parseTimetable(cell(lesson('כימיה מורחב', 'מורה לכימיה') + lesson('פיזיקה מורחב', 'מורה לפיזיקה')), '2026-09-06');
    expect(parsed.lessons).toHaveLength(2);
    expect(filterLessons(parsed.lessons, { lessons: { hiddenSubjects: ['כימיה מורחב'] } }).map(l => l.subject)).toEqual(['פיזיקה מורחב']);
  });

  it('keeps both network groups and applies a named cancellation only to its group', () => {
    const parsed = parseTimetable(cell(lesson('שרותי רשת', 'מורה א') + lesson('שרותי רשת', 'מורה ב') + '<div class="TTChange TableFreeChange">ביטול שרותי רשת, מורה ב</div>'), '2026-09-06');
    expect(parsed.lessons.map(l => [l.teacher, l.status])).toEqual([['מורה א', 'regular'], ['מורה ב', 'cancelled']]);
  });

  it('attaches a change by subject when the teacher is not named', () => {
    const parsed = parseTimetable(cell(lesson('כימיה מורחב', 'מורה לכימיה') + lesson('פיזיקה מורחב', 'מורה לפיזיקה') + '<div class="TTChange TableRemoteChange">פיזיקה מרחוק</div>'), '2026-09-06');
    expect(parsed.lessons.map(l => [l.subject, l.status])).toEqual([['כימיה מורחב', 'regular'], ['פיזיקה מורחב', 'remote']]);
  });

  it('still folds a bare change onto the only lesson in the cell', () => {
    const parsed = parseTimetable(cell(lesson('היסטוריה', 'שגיא') + '<div class="TTChange TableFillChange">מ״מ: כהן</div>'), '2026-09-06');
    expect(parsed.lessons).toHaveLength(1);
    expect(parsed.lessons[0]).toMatchObject({ subject: 'היסטוריה', status: 'substitution', substitute: 'כהן' });
  });

  it('a change naming no group in a stacked cell becomes its own lesson', () => {
    const parsed = parseTimetable(cell(lesson('שרותי רשת', 'מורה א') + lesson('שרותי רשת', 'מורה ב') + '<div class="TTChange TableFillChange">הזזת כישורי חיים, שחם בועז</div>'), '2026-09-06');
    expect(parsed.lessons.map(l => [l.subject, l.status])).toEqual([
      ['שרותי רשת', 'regular'], ['שרותי רשת', 'regular'], ['כישורי חיים', 'moved'],
    ]);
  });
});

describe('lesson identity in the snapshot', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const adapter = (body: string) =>
    new ShahafAdapter({
      baseUrl: 'https://example.invalid',
      zone: 'Asia/Jerusalem',
      weeksAhead: 0,
      fetcher: async ({ tab }) => (tab === 'changestable' ? cell(body) : '<div class="EmptyList"></div>'),
    });
  const ctx = { now: new Date('2026-09-06T05:00:00.000Z'), classId: '36', logger };

  it('tells two groups of one subject apart by teacher', async () => {
    const result = await adapter(lesson('שרותי רשת', 'מורה א') + lesson('שרותי רשת', 'מורה ב')).poll(ctx);
    const keys = result.entities.filter((e) => e.kind === 'lesson').map((e) => e.naturalKey);
    expect(keys).toEqual(['2026-09-10|1|שרותי רשת|מורה א', '2026-09-10|1|שרותי רשת|מורה ב']);
  });

  it('stores both groups and re-polls them silently', async () => {
    const store = new MemorySnapshotStore();
    const poll = () => adapter(lesson('שרותי רשת', 'מורה א') + lesson('שרותי רשת', 'מורה ב')).poll(ctx);

    const first = await poll();
    expect(await applyDelta(store, 'shahaf', first.entities, first.completeScopes, ctx.now)).toMatchObject({ created: 2, updated: 0, deleted: 0 });

    const second = await poll();
    expect(await applyDelta(store, 'shahaf', second.entities, second.completeScopes, ctx.now)).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('fails the poll on a page without the grid, rather than dropping every lesson', async () => {
    const store = new MemorySnapshotStore();
    const first = await adapter(lesson('היסטוריה', 'שגיא')).poll(ctx);
    await applyDelta(store, 'shahaf', first.entities, first.completeScopes, ctx.now);

    // A maintenance page, a redesign, an empty answer: a 200 all the same.
    for (const page of ['<html><body><p>האתר בתחזוקה</p></body></html>', '', '<table class="TTTable"><tr><td>?</td></tr></table>']) {
      const down = new ShahafAdapter({
        baseUrl: 'https://example.invalid', zone: 'Asia/Jerusalem', weeksAhead: 0,
        fetcher: async ({ tab }) => (tab === 'changestable' ? page : '<div class="EmptyList"></div>'),
      });
      await expect(down.poll(ctx), JSON.stringify(page)).rejects.toThrow(/no timetable/);
    }
    // The stored lesson is still there for the next good poll to compare against.
    const again = await adapter(lesson('היסטוריה', 'שגיא')).poll(ctx);
    expect(await applyDelta(store, 'shahaf', again.entities, again.completeScopes, ctx.now)).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('matches what the re-keying migration writes for existing rows', () => {
    // migrations/20260905120000_lesson_key_teacher appends `|` + teacher (or
    // `|` alone) to the old `date|hour|subject` key; the code must agree.
    expect(lessonNaturalKey({ date: '2026-09-10', hourIndex: 3, subject: 'פיזיקה', teacher: 'לוי' })).toBe('2026-09-10|3|פיזיקה|לוי');
    expect(lessonNaturalKey({ date: '2026-09-10', hourIndex: 3, subject: 'פיזיקה', teacher: null })).toBe('2026-09-10|3|פיזיקה|');
  });
});
