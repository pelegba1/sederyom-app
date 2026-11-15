/**
 * A source's first successful poll is a backfill, not a stream of news. The
 * runner tells the delta engine when that is the case, and the engine marks
 * the creations so the notification engine can stay quiet about them.
 */
import { describe, expect, it } from 'vitest';
import { MemorySnapshotStore, applyDelta } from '../src/sync/delta.js';

describe('first-poll creations', () => {
  const hw = (id: string) => ({ source: 'mashov' as const, kind: 'homework' as const, naturalKey: id, payload: { text: id } });

  it('are flagged on the first poll, and never after', async () => {
    const store = new MemorySnapshotStore();
    const first = await applyDelta(store, 'mashov', [hw('a'), hw('b')], [{ kind: 'homework' }], new Date(), { initial: true });
    expect(first.events.map((e) => e.payload.initial)).toEqual([true, true]);

    const second = await applyDelta(store, 'mashov', [hw('a'), hw('b'), hw('c')], [{ kind: 'homework' }], new Date());
    expect(second.events.map((e) => [e.naturalKey, e.payload.initial])).toEqual([['c', undefined]]);
  });

  /**
   * The flag follows the poll, not the kind. A login in September finds no
   * homework yet; the first item a week later is news, and must not be taken
   * for a backfill just because no homework was stored before.
   */
  it('do not swallow the first item of a kind that arrives after the first poll', async () => {
    const store = new MemorySnapshotStore();
    await applyDelta(store, 'mashov', [{ source: 'mashov', kind: 'timetable_slot', naturalKey: 's', payload: {} }], [], new Date(), { initial: true });
    const later = await applyDelta(store, 'mashov', [hw('first-ever')], [{ kind: 'homework' }], new Date());
    expect(later.events[0]!.payload.initial).toBeUndefined();
  });
});
