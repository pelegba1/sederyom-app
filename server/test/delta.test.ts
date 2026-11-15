import { describe, expect, it } from 'vitest';
import type { NormalizedEntity, Scope } from '../src/adapters/types.js';
import { MemorySnapshotStore, applyDelta } from '../src/sync/delta.js';

const NOW = new Date('2026-08-30T06:00:00.000Z');

function lesson(date: string, hour: number, subject: string, extra: Record<string, unknown> = {}): NormalizedEntity {
  return {
    source: 'shahaf',
    kind: 'lesson',
    naturalKey: `${date}|${hour}|${subject}`,
    partition: date,
    payload: { date, hourIndex: hour, subject, status: 'regular', teacher: 'לוי', ...extra },
  };
}

const DAY = '2026-09-01';
const OTHER_DAY = '2026-09-02';
const dayScopes: Scope[] = [{ kind: 'lesson', partition: DAY }];

describe('delta engine', () => {
  it('emits one created per new entity', async () => {
    const store = new MemorySnapshotStore();
    const result = await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית'), lesson(DAY, 2, 'פיזיקה')], dayScopes, NOW);
    expect(result).toMatchObject({ created: 2, updated: 0, deleted: 0 });
  });

  it('is idempotent: re-polling identical data emits zero events', async () => {
    const store = new MemorySnapshotStore();
    const entities = [lesson(DAY, 1, 'אנגלית'), lesson(DAY, 2, 'פיזיקה'), lesson(OTHER_DAY, 1, 'תנך')];
    const scopes: Scope[] = [{ kind: 'lesson', partition: DAY }, { kind: 'lesson', partition: OTHER_DAY }];
    await applyDelta(store, 'shahaf', entities, scopes, NOW);
    store.events.length = 0;

    for (let i = 0; i < 3; i += 1) {
      const again = await applyDelta(store, 'shahaf', entities, scopes, NOW);
      expect(again).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    }
    expect(store.events).toEqual([]);
  });

  it('key order in the payload does not count as a change', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'shahaf', [
      { source: 'shahaf', kind: 'lesson', naturalKey: 'k', partition: DAY, payload: { a: 1, b: 2 } },
    ], dayScopes, NOW);
    const again = await applyDelta(store, 'shahaf', [
      { source: 'shahaf', kind: 'lesson', naturalKey: 'k', partition: DAY, payload: { b: 2, a: 1 } },
    ], dayScopes, NOW);
    expect(again).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('a single changed field emits exactly one updated', async () => {
    const store = new MemorySnapshotStore();
    const before = [lesson(DAY, 1, 'אנגלית'), lesson(DAY, 2, 'פיזיקה')];
    await applyDelta(store, 'shahaf', before, dayScopes, NOW);

    const after = [lesson(DAY, 1, 'אנגלית'), lesson(DAY, 2, 'פיזיקה', { status: 'cancelled' })];
    const result = await applyDelta(store, 'shahaf', after, dayScopes, NOW);

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    const [event] = result.events;
    expect(event!.naturalKey).toBe(`${DAY}|2|פיזיקה`);
    expect((event!.payload.before as { status: string }).status).toBe('regular');
    expect((event!.payload.after as { status: string }).status).toBe('cancelled');
  });

  it('prunes inside a complete scope', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית'), lesson(DAY, 2, 'פיזיקה')], dayScopes, NOW);
    const result = await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 1 });
    expect(result.events[0]!.naturalKey).toBe(`${DAY}|2|פיזיקה`);
  });

  it('never prunes a partition the poll did not cover', async () => {
    const store = new MemorySnapshotStore();
    const scopes: Scope[] = [{ kind: 'lesson', partition: DAY }, { kind: 'lesson', partition: OTHER_DAY }];
    await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית'), lesson(OTHER_DAY, 1, 'תנך')], scopes, NOW);

    // Poll that only covered DAY must leave OTHER_DAY alone.
    const result = await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('an incremental poll with no complete scope never prunes', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'google_calendar', [
      { source: 'google_calendar', kind: 'calendar_event', naturalKey: 'a', payload: { s: 1 } },
      { source: 'google_calendar', kind: 'calendar_event', naturalKey: 'b', payload: { s: 1 } },
    ], [{ kind: 'calendar_event' }], NOW);

    const result = await applyDelta(store, 'google_calendar', [
      { source: 'google_calendar', kind: 'calendar_event', naturalKey: 'a', payload: { s: 2 } },
    ], [], NOW);
    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
  });

  it('a kind-wide scope prunes across every partition of that kind', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'א'), lesson(OTHER_DAY, 1, 'ב')], [{ kind: 'lesson' }], NOW);
    const result = await applyDelta(store, 'shahaf', [], [{ kind: 'lesson' }], NOW);
    expect(result.deleted).toBe(2);
  });

  it('a re-appearing entity is created again, not silently revived', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    await applyDelta(store, 'shahaf', [], dayScopes, NOW);
    const result = await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    expect(result).toMatchObject({ created: 1, updated: 0, deleted: 0 });
  });

  it('does not re-emit a deletion for something already pruned', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    await applyDelta(store, 'shahaf', [], dayScopes, NOW);
    const result = await applyDelta(store, 'shahaf', [], dayScopes, NOW);
    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('sources are isolated from one another', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    const result = await applyDelta(store, 'mashov', [], [{ kind: 'lesson', partition: DAY }], NOW);
    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('a duplicate natural key inside one poll is collapsed, not double-counted', async () => {
    const store = new MemorySnapshotStore();
    const result = await applyDelta(store, 'shahaf', [lesson(DAY, 1, 'אנגלית'), lesson(DAY, 1, 'אנגלית')], dayScopes, NOW);
    expect(result.created).toBe(1);
  });
});
