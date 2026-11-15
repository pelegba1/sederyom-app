/**
 * The phone's storage keys of earlier versions moved under their names now
 * (app/src/local/keyMigrations.ts, plan 2f Stage C): copied when the new key
 * is absent, the old keys gone, what nothing reads any more gone, and a
 * second run changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { MIRROR_KEY } from '../../app/src/google/mirror';
import { GONE_KEYS, OLD_SETTINGS_KEYS, SETTINGS_KEYS, TASK_TIMES_MIGRATED_KEY, runKeyMigrations } from '../../app/src/local/keyMigrations';

function memoryKv(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    map,
    getString: (k: string) => map.get(k),
    set: (k: string, v: string) => void map.set(k, v),
    remove: (k: string) => void map.delete(k),
  };
}

const MINE = JSON.stringify({ ...DEFAULT_SETTINGS, classId: '7', className: 'יב2' });
const CLASSES = JSON.stringify([{ id: '7', name: 'יב2' }]);
const OWNERS_COPY = JSON.stringify({ settings: { ...DEFAULT_SETTINGS, classId: '9', className: 'יא1' }, calendars: [], classes: [] });
const RECORD = JSON.stringify({ doneAt: '2026-10-22T07:00:00.000Z' });

describe('the settings and the class list', () => {
  it('move to their new keys, and the old keys go', () => {
    const kv = memoryKv({ [OLD_SETTINGS_KEYS.user]: MINE, [OLD_SETTINGS_KEYS.classes]: CLASSES });
    runKeyMigrations(kv);
    expect(kv.getString(SETTINGS_KEYS.user)).toBe(MINE);
    expect(kv.getString(SETTINGS_KEYS.classes)).toBe(CLASSES);
    expect(kv.map.has(OLD_SETTINGS_KEYS.user)).toBe(false);
    expect(kv.map.has(OLD_SETTINGS_KEYS.classes)).toBe(false);
  });

  it('keep a new key already there: it was written since', () => {
    const newer = JSON.stringify({ ...DEFAULT_SETTINGS, classId: '8', className: 'יב3' });
    const kv = memoryKv({ [OLD_SETTINGS_KEYS.user]: MINE, [SETTINGS_KEYS.user]: newer });
    runKeyMigrations(kv);
    expect(kv.getString(SETTINGS_KEYS.user)).toBe(newer);
    expect(kv.map.has(OLD_SETTINGS_KEYS.user)).toBe(false);
  });

  it('leave a phone that never had them as it is', () => {
    const kv = memoryKv({ unrelated: 'x' });
    runKeyMigrations(kv);
    // Besides the mark that Google's task cursors were cleared once (completion-times.test.ts).
    expect([...kv.map.entries()]).toEqual([['unrelated', 'x'], [TASK_TIMES_MIGRATED_KEY, '1']]);
  });
});

describe('what nothing reads any more', () => {
  it('goes: the switch for the phone\'s days, the owner\'s copy, the trial\'s runs, the push note, the owner\'s key and its record', () => {
    const kv = memoryKv(Object.fromEntries(GONE_KEYS.map((k) => [k, 'true'])));
    expect(GONE_KEYS).toEqual(expect.arrayContaining([
      'localDays', 'local.settings', 'spike.mashov.runs', 'owner.pushesStay', 'owner.token', 'retire.owner',
    ]));
    runKeyMigrations(kv);
    for (const key of GONE_KEYS) expect(kv.map.has(key)).toBe(false);
  });

  it('takes nothing from the owner\'s copy, settings or none', () => {
    const kv = memoryKv({ 'owner.token': 'owner-key', 'local.settings': OWNERS_COPY, [OLD_SETTINGS_KEYS.user]: MINE });
    runKeyMigrations(kv);
    expect(kv.getString(SETTINGS_KEYS.user)).toBe(MINE);
    expect([...kv.map.keys()]).toEqual([SETTINGS_KEYS.user, TASK_TIMES_MIGRATED_KEY]);
  });
});

describe('the exam calendar\'s state', () => {
  it('loses `handedOver`, and keeps everything else', () => {
    const state = { calendarId: 'phone-cal', handedOver: true, lastRunAt: '2026-10-22T07:00:00.000Z', lastResult: null, lastError: null, dueSeq: 2 };
    const kv = memoryKv({ [MIRROR_KEY]: JSON.stringify(state) });
    runKeyMigrations(kv);
    expect(JSON.parse(kv.getString(MIRROR_KEY)!)).toEqual({
      calendarId: 'phone-cal', lastRunAt: '2026-10-22T07:00:00.000Z', lastResult: null, lastError: null, dueSeq: 2,
    });
  });

  it('stays as it is without `handedOver`, or when it cannot be read', () => {
    for (const raw of [JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }), 'not json', '[]', 'null']) {
      const kv = memoryKv({ [MIRROR_KEY]: raw });
      runKeyMigrations(kv);
      expect(kv.getString(MIRROR_KEY)).toBe(raw);
    }
  });
});

describe('a second run', () => {
  it('changes nothing', () => {
    const kv = memoryKv({
      [OLD_SETTINGS_KEYS.user]: MINE,
      [OLD_SETTINGS_KEYS.classes]: CLASSES,
      'owner.token': 'owner-key',
      'retire.owner': RECORD,
      'local.settings': OWNERS_COPY,
      localDays: 'true',
      'spike.mashov.runs': '[]',
      'owner.pushesStay': 'true',
      [MIRROR_KEY]: JSON.stringify({ calendarId: 'phone-cal', handedOver: false, lastRunAt: null }),
      'device.identity': '{"deviceId":"d-1","token":"t"}',
    });
    runKeyMigrations(kv);
    const once = new Map(kv.map);
    runKeyMigrations(kv);
    expect(kv.map).toEqual(once);
    expect([...once.keys()].sort()).toEqual(['device.identity', MIRROR_KEY, SETTINGS_KEYS.classes, SETTINGS_KEYS.user, TASK_TIMES_MIGRATED_KEY].sort());
    expect(JSON.parse(once.get(MIRROR_KEY)!)).toEqual({ calendarId: 'phone-cal', lastRunAt: null });
  });
});
