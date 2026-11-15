/**
 * The Friday burst (docs/superpowers/plans/2026-11-10-year-wrapped-history.md, Task 4).
 *
 * Right after the school day on Friday the site moves its window on: `week=0`
 * shows the coming week and `week=1` the one after. In production, every
 * Friday at about 14:00, each class got as many "deleted" events as its week
 * had lessons, and as many "created" (יב2 on 13.11 at 14:02: 52 and 52). The
 * poll claimed the days from this Sunday on as the pages' days, so the week
 * that had just ended was emptied.
 *
 * The pages were read on Saturday 2026-11-14 (week=0: 15–20.11, week=1:
 * 22–27.11); the names in them are made up. Thursday's `week=0` is the same
 * grid with the dates of the week before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ShahafAdapter } from '../src/adapters/shahaf/index.js';
import { MemorySnapshotStore, applyDelta } from '../src/sync/delta.js';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'shahaf', 'weekend-2026-11-14');
const NEXT = readFileSync(join(DIR, 'changestable-w0.html'), 'utf8');
const AFTER = readFileSync(join(DIR, 'changestable-w1.html'), 'utf8');
/** The page of 8–13.11: the next week's grid under the week before's dates. */
const THIS = NEXT.replace(/\b(1[5-9]|20)\.11</g, (_m, d: string) => `${String(Number(d) - 7).padStart(2, '0')}.11<`);

const logger = { info: () => {}, warn: () => {}, error: () => {} };
const adapter = (pages: string[]) =>
  new ShahafAdapter({
    baseUrl: 'https://dugma.shahaf.site',
    zone: 'Asia/Jerusalem',
    weeksAhead: 1,
    fetcher: async ({ tab, week }) => (tab === 'changestable' ? pages[week ?? 0]! : '<div class="EmptyList"></div>'),
  });
const THURSDAY = new Date('2026-11-12T08:00:00Z');
const FRIDAY = new Date('2026-11-13T12:30:00Z'); // 14:30 in Israel, after the window moved

async function thursdayStore() {
  const store = new MemorySnapshotStore();
  const poll = await adapter([THIS, NEXT]).poll({ now: THURSDAY, classId: '53', logger });
  await applyDelta(store, 'shahaf', poll.entities, poll.completeScopes, THURSDAY);
  return store;
}

describe('a poll after the site moved its window on Friday', () => {
  it('the fixture pages are the weeks they say', async () => {
    const thursday = await adapter([THIS, NEXT]).poll({ now: THURSDAY, classId: '53', logger });
    const dates = new Set(thursday.entities.filter((e) => e.kind === 'lesson').map((e) => e.partition));
    expect([...dates].sort()).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
      '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  });

  it('deletes no lesson of the week that just ended', async () => {
    const store = await thursdayStore();
    const friday = await adapter([NEXT, AFTER]).poll({ now: FRIDAY, classId: '53', logger });
    const result = await applyDelta(store, 'shahaf', friday.entities, friday.completeScopes, FRIDAY);
    expect(result.deleted).toBe(0);
    expect(result.events.filter((e) => e.change === 'deleted')).toEqual([]);
  });

  it('creates only the week the window opened on, once', async () => {
    const store = await thursdayStore();
    const friday = await adapter([NEXT, AFTER]).poll({ now: FRIDAY, classId: '53', logger });
    const result = await applyDelta(store, 'shahaf', friday.entities, friday.completeScopes, FRIDAY);
    const created = result.events.filter((e) => e.change === 'created').map((e) => e.naturalKey);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((key) => key >= '2026-11-22' && key < '2026-11-28')).toBe(true);
    expect(new Set(created).size).toBe(created.length);
    expect(result.updated).toBe(0);
  });

  it('claims as complete only the days the pages show', async () => {
    const friday = await adapter([NEXT, AFTER]).poll({ now: FRIDAY, classId: '53', logger });
    const days = friday.completeScopes.filter((s) => s.kind === 'lesson').map((s) => s.partition);
    expect(days).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
      '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  });

  it('a page that repeats a week already read adds nothing twice', async () => {
    const twice = await adapter([NEXT, NEXT]).poll({ now: FRIDAY, classId: '53', logger });
    const keys = twice.entities.filter((e) => e.kind === 'lesson').map((e) => e.naturalKey);
    expect(new Set(keys).size).toBe(keys.length);
    const days = twice.completeScopes.filter((s) => s.kind === 'lesson').map((s) => s.partition);
    expect(new Set(days).size).toBe(days.length);
  });
});
