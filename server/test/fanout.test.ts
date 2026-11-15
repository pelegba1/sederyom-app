/**
 * The owner's engine, deciding for a device (plan Phase 2): the device's
 * preferences fill the settings it reads, and only the school site's pushes
 * are ever on. And a parent's phone (parents mode, stage 2), which follows
 * more than one class, each with its own hidden lines.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PREFS, mergeDevicePrefs } from '@sederyom/shared';
import { blockNameKey } from '@sederyom/shared/logic/ownNames';
import { dispatchClassChanges, settingsForDevice } from '../src/notify/fanout.js';
import { planNotifications, type PendingChange } from '../src/notify/engine.js';
import { RecordingPusher } from '../src/notify/push.js';

const CTX = { today: '2026-09-01', tomorrow: '2026-09-02', nowTime: '19:30' };

function cancelled(id: number, subject: string): PendingChange {
  const lesson = { date: '2026-09-02', hourIndex: 3, subject, teacher: 'לוי', status: 'cancelled' };
  return {
    id, source: 'shahaf', kind: 'lesson', naturalKey: `2026-09-02|3|${subject}|לוי`, change: 'updated',
    payload: { before: { ...lesson, status: 'regular' }, after: lesson, partition: '2026-09-02' },
  };
}

describe('settingsForDevice', () => {
  it('turns on only what the device asked for, and nothing the phone does itself', () => {
    const s = settingsForDevice(DEFAULT_DEVICE_PREFS);
    expect(s.notifications.schedule_change_tomorrow).toBe(true);
    expect(s.notifications.new_exam).toBe(true);
    for (const t of ['new_homework', 'new_grade', 'teacher_message', 'morning_summary', 'evening_homework'] as const) {
      expect(s.notifications[t], t).toBe(false);
    }
  });

  it('lets each device skip the lines that are not its student\'s', () => {
    const events = [cancelled(1, 'פיזיקה')];
    const everyone = planNotifications(events, { settings: settingsForDevice(DEFAULT_DEVICE_PREFS), ...CTX });
    expect(everyone.planned).toHaveLength(1);
    expect(everyone.planned[0]!.type).toBe('schedule_change_tomorrow');

    const notPhysics = settingsForDevice(mergeDevicePrefs({}, { hiddenSubjects: ['פיזיקה'] }));
    const filtered = planNotifications(events, { settings: notPhysics, ...CTX });
    expect(filtered.planned).toEqual([]);
    expect(filtered.discardedIds).toEqual([1]);
  });

  it("carries the device's own names for subjects", () => {
    const prefs = mergeDevicePrefs({}, { hiddenSubjects: ['כימיה'], subjectNames: { 'פיזיקה': 'פיז' } });
    expect(settingsForDevice(prefs).lessons).toEqual({ hiddenSubjects: ['כימיה'], subjectNames: { 'פיזיקה': 'פיז' } });
    expect(settingsForDevice(DEFAULT_DEVICE_PREFS).lessons.subjectNames).toEqual({});
  });

  it('respects a switched-off push and "חופש"', () => {
    const events = [cancelled(1, 'פיזיקה')];
    const off = settingsForDevice(mergeDevicePrefs({}, { notifications: { schedule_change_tomorrow: false } }));
    expect(planNotifications(events, { settings: off, ...CTX }).planned).toEqual([]);
    const vacation = settingsForDevice(mergeDevicePrefs({}, { vacationMode: true }));
    expect(planNotifications(events, { settings: vacation, ...CTX }).planned).toEqual([]);
  });
});

describe("the class's exam board, in the engine", () => {
  const board = (over: Partial<PendingChange> = {}): PendingChange => ({
    id: 9, source: 'shahaf', kind: 'exam_board', naturalKey: 'exam-board', change: 'created',
    payload: { before: null, after: { setBy: 'd1' }, partition: null }, ...over,
  });
  const plan = (events: PendingChange[], prefs: Parameters<typeof mergeDevicePrefs>[1] = {}, settings: Partial<ReturnType<typeof settingsForDevice>> = {}) =>
    planNotifications(events, { settings: { ...settingsForDevice(mergeDevicePrefs({}, prefs)), ...settings }, ...CTX, classId: 'class-x' });

  it('is a new-exam push of its own, keyed by the class and the event, and opens the exams', () => {
    const { planned, discardedIds } = plan([board()]);
    expect(discardedIds).toEqual([]);
    expect(planned).toEqual([
      {
        type: 'new_exam',
        dedupeKey: 'exam-board|class-x|9',
        eventIds: [9],
        push: {
          title: 'לוח מבחנים חדש',
          body: 'מישהו מהכיתה הוסיף לוח מבחנים. כדאי לבדוק אילו מבחנים שלך.',
          payload: { type: 'new_exam', deepLink: 'school', tab: 'exams', refreshWidget: true },
        },
      },
    ]);
    // the next board of the class is another event, so another key
    expect(plan([board({ id: 31 })]).planned[0]!.dedupeKey).toBe('exam-board|class-x|31');
  });

  it('is not one of the schedule\'s exams: a student\'s hidden exam keys do not hide it', () => {
    const settings = { ...settingsForDevice(mergeDevicePrefs({}, {})), exams: { hiddenKeys: ['exam-board'] } };
    expect(planNotifications([board()], { settings, ...CTX, classId: 'class-x' }).planned).toHaveLength(1);
  });

  it('is only ever a creation, and obeys the new-exam switch and "חופש"', () => {
    expect(plan([board({ change: 'updated' }), board({ id: 10, change: 'deleted' })])).toEqual({ planned: [], discardedIds: [9, 10] });
    expect(plan([board()], { notifications: { new_exam: false } })).toEqual({ planned: [], discardedIds: [9] });
    expect(plan([board()], { vacationMode: true })).toEqual({ planned: [], discardedIds: [9] });
  });
});

describe('a change some other phone still waits for', () => {
  // 20:45 and 21:15 on Tuesday 1.9.2026: both changes are tomorrow's.
  const FIRST = new Date('2026-09-01T20:45:00+03:00');
  const SECOND = new Date('2026-09-01T21:15:00+03:00');
  const lesson = { date: '2026-09-02', hourIndex: 3, subject: 'מפגש לקראת מסיבת הסיום', teacher: null, status: 'event' };
  const naturalKey = '2026-09-02|3|מפגש לקראת מסיבת הסיום|';

  it('is not pushed again inside the next batch', async () => {
    type Row = { id: number; classId: string; kind: string; naturalKey: string; change: string; payload: PendingChange['payload']; createdAt: Date; notifiedAt: Date | null };
    const events: Row[] = [
      { id: 1, classId: 'class-x', kind: 'lesson', naturalKey, change: 'created', payload: { before: null, after: lesson, partition: '2026-09-02' }, createdAt: new Date('2026-09-01T20:40:00+03:00'), notifiedAt: null },
    ];
    const notifications: { deviceId: string; dedupeKey: string; eventIds?: number[] }[] = [];
    const device = (id: string, prefs: object) => ({
      id, classId: 'class-x', pushToken: `ExponentPushToken[${id}]`, prefs: mergeDevicePrefs({}, prefs), createdAt: new Date('2026-09-01T10:00:00+03:00'), _count: { follows: 0 },
    });
    // The other phone sleeps from 20:00: the first change stays open for it all evening.
    const devices = [device('student', {}), device('asleep', { quietHours: { enabled: true, from: '20:00', to: '07:00' } })];
    const prisma = {
      classChangeEvent: {
        findMany: async () => events.filter((e) => e.notifiedAt === null),
        updateMany: async ({ where, data }: { where: { id: { in: number[] } }; data: { notifiedAt: Date } }) => {
          for (const e of events) if (where.id.in.includes(e.id)) e.notifiedAt = data.notifiedAt;
          return { count: where.id.in.length };
        },
      },
      device: { findMany: async () => devices },
      classFollow: { findMany: async () => [] },
      schoolClass: { findUnique: async () => null },
      deviceNotification: {
        findUnique: async ({ where }: { where: { deviceId_dedupeKey: { deviceId: string; dedupeKey: string } } }) =>
          notifications.find((n) => n.deviceId === where.deviceId_dedupeKey.deviceId && n.dedupeKey === where.deviceId_dedupeKey.dedupeKey) ?? null,
        findMany: async ({ where }: { where: { deviceId: string; eventIds: { hasSome: number[] } } }) =>
          notifications.filter((n) => n.deviceId === where.deviceId && (n.eventIds ?? []).some((id) => where.eventIds.hasSome.includes(id))),
        create: async ({ data }: { data: { deviceId: string; dedupeKey: string; eventIds?: number[] } }) => {
          notifications.push(data);
          return data;
        },
      },
    };
    const pusher = new RecordingPusher();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const dispatch = (now: Date) => dispatchClassChanges({ prisma: prisma as never, pusher, logger, zone: 'Asia/Jerusalem' }, now);

    await dispatch(FIRST);
    expect(pusher.sent.map((s) => s.push.title)).toEqual(['שינוי במערכת של מחר']);
    expect(events[0]!.notifiedAt).toBeNull();

    events.push({ id: 2, classId: 'class-x', kind: 'lesson', naturalKey, change: 'deleted', payload: { before: lesson, after: null, partition: '2026-09-02' }, createdAt: new Date('2026-09-01T21:10:00+03:00'), notifiedAt: null });
    await dispatch(SECOND);
    const second = pusher.sent[1]!.push;
    expect(second.title).toBe('שינוי במערכת של מחר');
    expect(second.body).toBe('שיעור 3 מפגש לקראת מסיבת הסיום ירד מהמערכת');
  });
});

describe("a parent's phone", () => {
  const SITE = 'https://school-c.shahaf.site';
  // 19:30 on Tuesday 1.9.2026: the cancellation is tomorrow's.
  const NOW = new Date('2026-09-01T19:30:00+03:00');
  const BEFORE = new Date('2026-09-01T10:00:00+03:00');
  const EVENT_AT = new Date('2026-09-01T19:15:00+03:00');
  const CLASSES: Record<string, { name: string; shahafClassId: string }> = {
    'class-x': { name: "ז' 2", shahafClassId: '13900' },
    'class-y': { name: "יא' 4", shahafClassId: '12144' },
    'class-z': { name: "ט' 1", shahafClassId: '13899' },
  };

  type DeviceRow = { id: string; classId: string | null; pushToken: string | null; prefs: object; createdAt: Date };
  type FollowRow = { deviceId: string; classId: string; prefs: object; createdAt: Date };

  type EventRow = { id: number; classId: string; kind: string; naturalKey: string; change: string; payload: PendingChange['payload']; createdAt: Date; notifiedAt: Date | null };
  type SnapshotRow = { classId: string; kind: string; partition?: string; deletedAt: Date | null; payload: object };
  const eventOf = (id: number, classId: string, e: PendingChange): EventRow => ({ id, classId, kind: e.kind, naturalKey: e.naturalKey, change: e.change, payload: e.payload, createdAt: EVENT_AT, notifiedAt: null });

  /**
   * `extra.events` replaces the one cancelled "פיזיקה" of class-x; `extra.snapshot` is what `classSnapshot` holds,
   * and reading it for `extra.brokenSnapshot` throws.
   */
  function world(devices: DeviceRow[], follows: FollowRow[], extra: { events?: EventRow[]; snapshot?: SnapshotRow[]; brokenSnapshot?: string } = {}) {
    const events = extra.events ?? [eventOf(1, 'class-x', cancelled(1, 'פיזיקה'))];
    const snapshotReads: { classId: string; kind: string; partition?: string; deletedAt: null }[] = [];
    const warnings: { o: unknown; m?: string }[] = [];
    const notifications: { deviceId: string; dedupeKey: string; title: string }[] = [];
    const counted = (d: DeviceRow) => ({ ...d, _count: { follows: follows.filter((f) => f.deviceId === d.id).length } });
    const prisma = {
      classChangeEvent: {
        findMany: async () => events.filter((e) => e.notifiedAt === null),
        updateMany: async ({ where, data }: { where: { id: { in: number[] } }; data: { notifiedAt: Date } }) => {
          for (const e of events) if (where.id.in.includes(e.id)) e.notifiedAt = data.notifiedAt;
          return { count: where.id.in.length };
        },
      },
      device: {
        findMany: async ({ where }: { where: { classId: string } }) =>
          devices.filter((d) => d.classId === where.classId && d.pushToken !== null).map(counted),
      },
      classFollow: {
        findMany: async ({ where }: { where: { classId: string } }) =>
          follows
            .filter((f) => f.classId === where.classId)
            .map((f) => ({ ...f, device: counted(devices.find((d) => d.id === f.deviceId)!) }))
            .filter((f) => f.device.pushToken !== null),
      },
      schoolClass: {
        findUnique: async ({ where }: { where: { id: string } }) => ({ ...CLASSES[where.id]!, school: { shahafUrl: SITE } }),
      },
      classSnapshot: {
        findMany: async ({ where }: { where: { classId: string; kind: string; partition?: string; deletedAt: null } }) => {
          snapshotReads.push(where);
          if (where.classId === extra.brokenSnapshot) throw new Error('connection reset');
          return (extra.snapshot ?? [])
            .filter((r) => r.classId === where.classId && r.kind === where.kind && r.deletedAt === where.deletedAt && (where.partition === undefined || r.partition === where.partition))
            .map((r) => ({ payload: r.payload }));
        },
      },
      deviceNotification: {
        findUnique: async ({ where }: { where: { deviceId_dedupeKey: { deviceId: string; dedupeKey: string } } }) =>
          notifications.find((n) => n.deviceId === where.deviceId_dedupeKey.deviceId && n.dedupeKey === where.deviceId_dedupeKey.dedupeKey) ?? null,
        findMany: async () => [],
        create: async ({ data }: { data: { deviceId: string; dedupeKey: string; title: string } }) => {
          notifications.push(data);
          return data;
        },
      },
    };
    const pusher = new RecordingPusher();
    const logger = { info: () => {}, warn: (o: unknown, m?: string) => void warnings.push({ o, m }), error: () => {} };
    const dispatch = (at: Date = NOW) => dispatchClassChanges({ prisma: prisma as never, pusher, logger, zone: 'Asia/Jerusalem' }, at);
    return { dispatch, pusher, notifications, events, snapshotReads, warnings };
  }

  const device = (id: string, classId: string | null, prefs: object = {}): DeviceRow => ({
    id, classId, pushToken: `ExponentPushToken[${id}]`, prefs: mergeDevicePrefs({}, prefs), createdAt: BEFORE,
  });
  const followOf = (deviceId: string, classId: string, hiddenSubjects: string[] = [], createdAt = BEFORE, subjectNames?: Record<string, string>): FollowRow => ({
    deviceId, classId, prefs: subjectNames ? { hiddenSubjects, subjectNames } : { hiddenSubjects }, createdAt,
  });

  it("tells each child's class apart in the title and for the tap, and only to a phone with more than one", async () => {
    const { dispatch, pusher, notifications, events } = world(
      [device('student', 'class-x'), device('parent', 'class-y'), device('own-and-more', 'class-x')],
      [followOf('parent', 'class-x'), followOf('own-and-more', 'class-z')],
    );
    expect((await dispatch()).sent).toBe(3);
    const to = (id: string) => pusher.sent.find((s) => s.tokens[0] === `ExponentPushToken[${id}]`)!.push;

    const plain = to('student');
    expect(plain.title).not.toContain("ז' 2");
    expect(plain.payload.class).toBeUndefined();
    for (const id of ['parent', 'own-and-more']) {
      expect(to(id).title, id).toBe(`ז' 2: ${plain.title}`);
      expect(to(id).payload.class, id).toEqual({ siteUrl: SITE, classId: '13900' });
      expect(to(id).body, id).toBe(plain.body);
    }
    // One of a parent's other classes keys its pushes by the class: another child's exam can share a key.
    const keyOf = (id: string) => notifications.find((n) => n.deviceId === id)!.dedupeKey;
    expect(keyOf('parent')).toBe(`class-x|${keyOf('student')}`);
    expect(keyOf('own-and-more')).toBe(keyOf('student'));
    expect(events[0]!.notifiedAt).toEqual(NOW);
  });

  it("skips a child's hidden lines, and what changed before the child was added", async () => {
    const { dispatch, pusher, events } = world(
      [device('physics-hidden', 'class-y', { hiddenSubjects: [] }), device('late', 'class-y')],
      [followOf('physics-hidden', 'class-x', ['פיזיקה']), followOf('late', 'class-x', [], new Date('2026-09-01T19:20:00+03:00'))],
    );
    expect((await dispatch()).sent).toBe(0);
    expect(pusher.sent).toEqual([]);
    expect(events[0]!.notifiedAt).toEqual(NOW);
  });

  it("filters the device's own class by the device's hidden lines, not a follow's", async () => {
    const { dispatch, pusher } = world(
      [device('own-hidden', 'class-x', { hiddenSubjects: ['פיזיקה'] })],
      [followOf('own-hidden', 'class-z', [])],
    );
    await dispatch();
    expect(pusher.sent).toEqual([]);
  });

  describe('a change to today, late in the day', () => {
    const TODAY = '2026-09-01';
    const removedToday = (id: number): EventRow =>
      eventOf(id, 'class-x', {
        id, source: 'shahaf', kind: 'lesson', naturalKey: `${TODAY}|6|ספורט|`, change: 'deleted',
        payload: { before: { date: TODAY, hourIndex: 6, subject: 'ספורט', teacher: null, status: 'substitution', endTime: '13:00' }, after: null, partition: TODAY },
      });
    const lessonUntil = (endTime: string, partition = TODAY): SnapshotRow => ({
      classId: 'class-x', kind: 'lesson', partition, deletedAt: null,
      payload: { date: partition, hourIndex: 7, startTime: null, endTime, subject: 'אנגלית', teacher: 'לוי', room: null, status: 'regular', substitute: null, note: null },
    });

    it('is not pushed once the last lesson has ended, and is closed', async () => {
      const { dispatch, pusher, events, snapshotReads } = world([device('student', 'class-x')], [], {
        events: [removedToday(1)],
        // A long day tomorrow says nothing about today.
        snapshot: [lessonUntil('14:00'), lessonUntil('21:00', '2026-09-02')],
      });
      expect((await dispatch()).sent).toBe(0);
      expect(pusher.sent).toEqual([]);
      expect(events[0]!.notifiedAt).toEqual(NOW);
      expect(snapshotReads).toEqual([{ classId: 'class-x', kind: 'lesson', partition: TODAY, deletedAt: null }]);
    });

    it('is pushed while a lesson of the evening is still ahead', async () => {
      const { dispatch, pusher } = world([device('student', 'class-x')], [], { events: [removedToday(1)], snapshot: [lessonUntil('20:15')] });
      expect((await dispatch()).sent).toBe(1);
      expect(pusher.sent[0]!.push.body).toBe('שיעור 6 ספורט ירד מהמערכת');
    });

    it('is pushed when the day cannot be read: a needless push beats a lost one', async () => {
      const { dispatch, warnings } = world([device('student', 'class-x')], [], { events: [removedToday(1)], brokenSnapshot: 'class-x' });
      expect((await dispatch()).sent).toBe(1);
      expect(warnings).toHaveLength(1);
    });
  });

  describe("the student's own names for subjects", () => {
    const PHYSICS = { 'פיזיקה': 'פיז' };
    const bodyOf = (pusher: RecordingPusher, id: string, titleStart = '') =>
      pusher.sent.filter((s) => s.tokens[0] === `ExponentPushToken[${id}]` && s.push.title.startsWith(titleStart)).map((s) => s.push.body);
    const lessonOn = (date: string, subject: string) =>
      ({ date, hourIndex: 3, startTime: null, endTime: null, subject, teacher: 'לוי', room: null, status: 'regular', substitute: null, note: null });
    const examEvent = (id: number, classId: string, subject: string) =>
      eventOf(id, classId, { id, source: 'shahaf', kind: 'exam', naturalKey: `x${id}`, change: 'created', payload: { before: null, after: { subject, date: '2026-09-04', details: null }, partition: null } });
    const BLOCK_EXAM = "מבחן גוש ב'";

    it('gives each phone of one class its own text, named or not', async () => {
      const { dispatch, pusher } = world([device('named', 'class-x', { subjectNames: PHYSICS }), device('plain', 'class-x')], []);
      expect((await dispatch()).sent).toBe(2);
      expect(bodyOf(pusher, 'named')).toEqual(['שיעור 3 פיז מבוטל']);
      expect(bodyOf(pusher, 'plain')).toEqual(['שיעור 3 פיזיקה מבוטל']);
    });

    it("names a parent's child's subject from the follow's own names, not the phone's", async () => {
      const { dispatch, pusher } = world(
        [device('parent', 'class-y', { subjectNames: { 'פיזיקה': 'פיז-אב' } })],
        [followOf('parent', 'class-x', [], BEFORE, { 'פיזיקה': 'פיז-ילד' })],
        { events: [eventOf(1, 'class-x', cancelled(1, 'פיזיקה')), eventOf(2, 'class-y', cancelled(2, 'פיזיקה'))] },
      );
      await dispatch();
      // The follow's name wins for the follow's class; the phone's own for the phone's own class.
      expect(bodyOf(pusher, 'parent', "ז' 2:")).toEqual(['שיעור 3 פיז-ילד מבוטל']);
      expect(bodyOf(pusher, 'parent', "יא' 4:")).toEqual(['שיעור 3 פיז-אב מבוטל']);
    });

    it("never gives a parent's other child the names of the child on show", async () => {
      const { dispatch, pusher } = world(
        [device('parent', 'class-y', { subjectNames: PHYSICS })],
        [followOf('parent', 'class-x')],
        { events: [eventOf(1, 'class-x', cancelled(1, 'פיזיקה'))] },
      );
      await dispatch();
      expect(bodyOf(pusher, 'parent')).toEqual(['שיעור 3 פיזיקה מבוטל']);
    });

    it("reads the class's lines once, from the live lessons of the last week", async () => {
      const snapshot: SnapshotRow[] = [
        { classId: 'class-x', kind: 'lesson', deletedAt: null, payload: lessonOn('2026-09-01', 'גוש ב׳ (יב)') },
        // Dated before today - 7: the feed does not carry it, and neither does a name.
        { classId: 'class-x', kind: 'lesson', deletedAt: null, payload: lessonOn('2026-08-20', 'גוש ב׳ (יא)') },
        { classId: 'class-x', kind: 'lesson', deletedAt: new Date('2026-08-30T00:00:00+03:00'), payload: lessonOn('2026-09-01', 'גוש ב׳ (י)') },
        { classId: 'class-y', kind: 'lesson', deletedAt: null, payload: lessonOn('2026-09-01', 'גוש ב׳ (יג)') },
      ];
      const { dispatch, pusher, snapshotReads } = world(
        [
          device('live', 'class-x', { subjectNames: { "גוש ב' (יב)": 'פיזיקה' } }),
          device('second', 'class-x', { subjectNames: { "גוש ב' (יב)": 'פיז' } }),
          device('old', 'class-x', { subjectNames: { "גוש ב' (יא)": 'כימיה' } }),
          device('deleted', 'class-x', { subjectNames: { "גוש ב' (י)": 'ביולוגיה' } }),
          device('other-class', 'class-x', { subjectNames: { "גוש ב' (יג)": 'היסטוריה' } }),
          device('plain', 'class-x'),
        ],
        [],
        { events: [examEvent(1, 'class-x', BLOCK_EXAM)], snapshot },
      );
      await dispatch();
      expect(snapshotReads).toEqual([{ classId: 'class-x', kind: 'lesson', deletedAt: null }]);
      expect(bodyOf(pusher, 'live')).toEqual(['מבחן פיזיקה · יום ו׳ 4.9']);
      expect(bodyOf(pusher, 'second')).toEqual(['מבחן פיז · יום ו׳ 4.9']);
      for (const id of ['old', 'deleted', 'other-class', 'plain']) expect(bodyOf(pusher, id), id).toEqual(["מבחן גוש ב' · יום ו׳ 4.9"]);
    });

    it('does not read the lines when no phone of the class has a name', async () => {
      const { dispatch, snapshotReads, pusher } = world(
        [device('a', 'class-x'), device('b', 'class-x', { subjectNames: {} })],
        [followOf('a', 'class-z')],
        { events: [examEvent(1, 'class-x', BLOCK_EXAM)] },
      );
      await dispatch();
      expect(snapshotReads).toEqual([]);
      expect(bodyOf(pusher, 'a')).toEqual(["מבחן גוש ב' · יום ו׳ 4.9"]);
    });

    it("reads the lines for a class when only a parent's follow of it has names", async () => {
      const snapshot: SnapshotRow[] = [{ classId: 'class-x', kind: 'lesson', deletedAt: null, payload: lessonOn('2026-09-01', 'גוש ב׳ (יב)') }];
      const { dispatch, snapshotReads, pusher } = world(
        [device('parent', 'class-y')],
        [followOf('parent', 'class-x', [], BEFORE, { "גוש ב' (יב)": 'פיזיקה' })],
        { events: [examEvent(1, 'class-x', BLOCK_EXAM)], snapshot },
      );
      await dispatch();
      expect(snapshotReads).toEqual([{ classId: 'class-x', kind: 'lesson', deletedAt: null }]);
      expect(bodyOf(pusher, 'parent')).toEqual(['מבחן פיזיקה · יום ו׳ 4.9']);
    });

    it("a failed read of one class's lines stops no push, of that class or of the next", async () => {
      const snapshot: SnapshotRow[] = [{ classId: 'class-y', kind: 'lesson', deletedAt: null, payload: lessonOn('2026-09-01', 'גוש ב׳ (יב)') }];
      const { dispatch, pusher, warnings, events } = world(
        [device('broken', 'class-x', { subjectNames: { [blockNameKey('ב')]: 'פיזיקה' } }), device('next', 'class-y', { subjectNames: { "גוש ב' (יב)": 'פיזיקה' } })],
        [],
        { events: [examEvent(1, 'class-x', BLOCK_EXAM), examEvent(2, 'class-y', BLOCK_EXAM)], snapshot, brokenSnapshot: 'class-x' },
      );
      expect((await dispatch()).sent).toBe(2);
      // Without the lines, the block's own key still names the block's exam.
      expect(bodyOf(pusher, 'broken')).toEqual(['מבחן פיזיקה · יום ו׳ 4.9']);
      expect(bodyOf(pusher, 'next')).toEqual(['מבחן פיזיקה · יום ו׳ 4.9']);
      expect(warnings).toEqual([{ o: expect.objectContaining({ classId: 'class-x' }), m: expect.any(String) }]);
      expect(events.map((e) => e.notifiedAt)).toEqual([NOW, NOW]);
    });

    it("reads no lines for a batch with no exam: a lesson is named by its line's key alone", async () => {
      const { dispatch, pusher, snapshotReads } = world([device('named', 'class-x', { subjectNames: PHYSICS })], []);
      await dispatch();
      expect(snapshotReads).toEqual([]);
      expect(bodyOf(pusher, 'named')).toEqual(['שיעור 3 פיז מבוטל']);
    });
  });

  describe('a class that got an exam board (design: ההתראה לכיתה)', () => {
    const boardEvent = (id: number, classId: string, setBy: string | null, createdAt = EVENT_AT): EventRow => ({
      id, classId, kind: 'exam_board', naturalKey: 'exam-board', change: 'created', payload: { before: null, after: { setBy }, partition: null }, createdAt, notifiedAt: null,
    });
    const TITLE = 'לוח מבחנים חדש';
    const BODY = 'מישהו מהכיתה הוסיף לוח מבחנים. כדאי לבדוק אילו מבחנים שלך.';
    const tokenOf = (id: string) => `ExponentPushToken[${id}]`;
    const sentTo = (pusher: RecordingPusher) => pusher.sent.map((s) => s.tokens[0]).sort();
    /** 07:30 the next morning: the quiet hours of 19:00 to 07:00 are over. */
    const MORNING = new Date('2026-09-02T07:30:00+03:00');
    const NIGHT_AFTER = new Date('2026-09-02T23:00:00+03:00');
    const EVENING_LATER = new Date('2026-09-03T19:30:00+03:00');
    const QUIET = { quietHours: { enabled: true, from: '19:00', to: '07:00' } };

    it('goes to every follower of the class but the device that brought the board, and says it plainly', async () => {
      const { dispatch, pusher, notifications, events } = world(
        [device('setter', 'class-x'), device('mate', 'class-x'), device('other-mate', 'class-x'), device('elsewhere', 'class-y')],
        [],
        { events: [boardEvent(7, 'class-x', 'setter')] },
      );
      expect((await dispatch()).sent).toBe(2);
      expect(sentTo(pusher)).toEqual([tokenOf('mate'), tokenOf('other-mate')]);
      for (const { push } of pusher.sent) {
        expect(push.title).toBe(TITLE);
        expect(push.body).toBe(BODY);
        expect(push.payload).toEqual({ type: 'new_exam', deepLink: 'school', tab: 'exams', refreshWidget: true });
      }
      // the event's id is in the key: the class's next board is another push, not a duplicate of this one
      expect(notifications.map((n) => n.dedupeKey)).toEqual(['exam-board|class-x|7', 'exam-board|class-x|7']);
      expect(events[0]!.notifiedAt).toEqual(NOW);
    });

    it('does not name any student, and carries only who brought the board', async () => {
      const row = boardEvent(7, 'class-x', 'setter');
      expect(row.payload).toEqual({ before: null, after: { setBy: 'setter' }, partition: null });
      const { dispatch, pusher } = world([device('mate', 'class-x')], [], { events: [row] });
      await dispatch();
      expect(JSON.stringify(pusher.sent)).not.toContain('setter');
    });

    it('is told to a parent for a class it follows besides its own, with the class named, and not to the device that brought it there', async () => {
      const { dispatch, pusher, notifications } = world(
        [device('mate', 'class-x'), device('parent', 'class-y'), device('parent-setter', 'class-y')],
        [followOf('parent', 'class-x'), followOf('parent-setter', 'class-x')],
        { events: [boardEvent(7, 'class-x', 'parent-setter')] },
      );
      expect((await dispatch()).sent).toBe(2);
      const to = (id: string) => pusher.sent.find((s) => s.tokens[0] === tokenOf(id))!.push;
      expect(to('mate').title).toBe(TITLE);
      expect(to('parent').title).toBe(`ז' 2: ${TITLE}`);
      expect(to('parent').body).toBe(BODY);
      expect(to('parent').payload).toMatchObject({ type: 'new_exam', deepLink: 'school', tab: 'exams', class: { siteUrl: SITE, classId: '13900' } });
      expect(notifications.find((n) => n.deviceId === 'parent')!.dedupeKey).toBe('class-x|exam-board|class-x|7');
    });

    it('is not sent to a device that switched off the new-exam push, and is closed', async () => {
      const { dispatch, pusher, events } = world(
        [device('quiet-about-exams', 'class-x', { notifications: { new_exam: false } }), device('mate', 'class-x')],
        [],
        { events: [boardEvent(7, 'class-x', 'setter')] },
      );
      expect((await dispatch()).sent).toBe(1);
      expect(sentTo(pusher)).toEqual([tokenOf('mate')]);
      expect(events[0]!.notifiedAt).toEqual(NOW);
    });

    it('is not sent in "חופש" mode', async () => {
      const { dispatch, pusher, events } = world([device('holiday', 'class-x', { vacationMode: true })], [], { events: [boardEvent(7, 'class-x', 'setter')] });
      expect((await dispatch()).sent).toBe(0);
      expect(pusher.sent).toEqual([]);
      expect(events[0]!.notifiedAt).toEqual(NOW);
    });

    it('waits out the quiet hours and is sent after them, once', async () => {
      const { dispatch, pusher, events } = world(
        [device('asleep', 'class-x', QUIET), device('awake', 'class-x')],
        [],
        { events: [boardEvent(7, 'class-x', 'setter')] },
      );
      expect(await dispatch()).toMatchObject({ sent: 1, deferred: 1 });
      expect(sentTo(pusher)).toEqual([tokenOf('awake')]);
      expect(events[0]!.notifiedAt).toBeNull();

      expect(await dispatch(MORNING)).toMatchObject({ sent: 1 });
      expect(sentTo(pusher)).toEqual([tokenOf('asleep'), tokenOf('awake')]);
      expect(events[0]!.notifiedAt).toEqual(MORNING);
      // and nothing more on the run after
      expect((await dispatch(EVENING_LATER)).sent).toBe(0);
      expect(pusher.sent).toHaveLength(2);
    });

    it('is closed unsent when it is still pending after 24 hours', async () => {
      const { dispatch, pusher, events } = world([device('asleep', 'class-x', QUIET)], [], { events: [boardEvent(7, 'class-x', 'setter')] });
      expect((await dispatch()).deferred).toBe(1);
      // 27 hours on, in the quiet hours again: not news any more
      expect(await dispatch(NIGHT_AFTER)).toMatchObject({ sent: 0, closed: 1 });
      expect(pusher.sent).toEqual([]);
      expect(events[0]!.notifiedAt).toEqual(NIGHT_AFTER);
    });

    it('is not sent to a device that began following the class after the board was added', async () => {
      const after = new Date('2026-09-01T19:20:00+03:00');
      const { dispatch, pusher, events } = world(
        [{ ...device('new-phone', 'class-x'), createdAt: after }, device('new-parent', 'class-y'), device('old', 'class-x')],
        [followOf('new-parent', 'class-x', [], after)],
        { events: [boardEvent(7, 'class-x', 'setter')] },
      );
      expect((await dispatch()).sent).toBe(1);
      expect(sentTo(pusher)).toEqual([tokenOf('old')]);
      expect(events[0]!.notifiedAt).toEqual(NOW);
    });

    it('is closed when the device that brought the board is the only follower, and tells no one', async () => {
      const { dispatch, pusher, events } = world([device('setter', 'class-x')], [], { events: [boardEvent(7, 'class-x', 'setter')] });
      expect(await dispatch()).toMatchObject({ sent: 0, closed: 1 });
      expect(pusher.sent).toEqual([]);
      expect(events[0]!.notifiedAt).toEqual(NOW);
    });

    it('is told to everyone when a calendar the tick read had no setter on record', async () => {
      const { dispatch, pusher } = world([device('a', 'class-x'), device('b', 'class-x')], [], { events: [boardEvent(7, 'class-x', null)] });
      expect((await dispatch()).sent).toBe(2);
      expect(pusher.sent).toHaveLength(2);
    });

    it("leaves the class's other events as they were: lessons bundled, a new exam on its own, a first poll's backlog silent", async () => {
      const examEvent = (id: number, payload: Partial<PendingChange['payload']> = {}) =>
        eventOf(id, 'class-x', {
          id, source: 'shahaf', kind: 'exam', naturalKey: `x${id}`, change: 'created',
          payload: { before: null, after: { subject: 'מתמטיקה', date: '2026-09-04', details: null }, partition: null, ...payload },
        });
      const { dispatch, pusher, events } = world([device('mate', 'class-x')], [], {
        events: [
          eventOf(1, 'class-x', cancelled(1, 'פיזיקה')),
          eventOf(2, 'class-x', cancelled(2, 'כימיה')),
          examEvent(3),
          examEvent(4, { initial: true }),
          boardEvent(5, 'class-x', 'setter'),
        ],
      });
      expect((await dispatch()).sent).toBe(3);
      const titles = pusher.sent.map((s) => s.push.title).sort();
      expect(titles).toEqual([TITLE, '2 שינויים במערכת של מחר', 'מבחן חדש'].sort());
      // the lessons' push carries the two lessons and nothing of the board; the exam's push is the exam's
      expect(pusher.sent.find((s) => s.push.title.startsWith('2 שינויים'))!.push.body).toBe('שיעור 3 פיזיקה מבוטל · שיעור 3 כימיה מבוטל');
      expect(pusher.sent.find((s) => s.push.title === 'מבחן חדש')!.push.body).toBe('מתמטיקה · יום ו׳ 4.9');
      expect(events.every((e) => e.notifiedAt !== null)).toBe(true);
    });

    it('is another push when the class has another board later, whatever the first one said', async () => {
      const { dispatch, pusher, events } = world([device('mate', 'class-x')], [], { events: [boardEvent(7, 'class-x', 'setter')] });
      await dispatch();
      events.push(boardEvent(12, 'class-x', 'setter', new Date('2026-09-01T19:25:00+03:00')));
      await dispatch();
      expect(pusher.sent.map((s) => s.push.title)).toEqual([TITLE, TITLE]);
    });
  });
});
