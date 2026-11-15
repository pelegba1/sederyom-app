/**
 * Mashov's own timetable changes (shared/src/logic/mashov/timetableChanges.ts):
 * how an answer becomes changes, how they change the weeks the grid fills and
 * never a week the site published, and that a failed read of them leaves the
 * rest of the Mashov read as it was, and on the phone keeps the changes the
 * read before had. No real answer has been captured yet, so the rows here
 * follow the student site's code.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DateStr } from '@sederyom/shared';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import { mashovApi, type MashovApi } from '@sederyom/shared/logic/mashov/api';
import { buildBellIndex, buildGroupIndex } from '@sederyom/shared/logic/mashov/normalize';
import { readMashov } from '@sederyom/shared/logic/mashov/read';
import { normalizeTimetableChanges, timetableChangeEntities } from '@sederyom/shared/logic/mashov/timetableChanges';
import { planLessonRows, type LessonRow, type ShahafSighting, type TimetableSlot } from '@sederyom/shared/logic/merge';
import { addDays } from '@sederyom/shared/logic/time';
import { recordChanges } from '../../app/src/local/changes';
import { buildLocalDays, localLessonRows, type LocalSources } from '../../app/src/local/days';
import { localRead, syncMashov, timetableChangesEnabled, timetableChangesFailed } from '../../app/src/mashov/sync';

const ZONE = 'Asia/Jerusalem';
// Tuesday 1.9.2026. With no class feed every school day from today is projected from the grid.
const NOW = new Date('2026-09-01T10:00:00+03:00');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const GROUPS = buildGroupIndex([
  { groupId: 'g0', subjectName: 'מתמטיקה', groupTeachers: [{ teacherName: 'שגיא' }] },
  { groupId: 'g1', subjectName: 'אנגלית', groupTeachers: [{ teacherName: 'שרון' }] },
  { groupId: 'g2', subjectName: 'היסטוריה' },
  { groupId: 'g3', subjectName: 'פיזיקה' },
  { groupId: 'g4', subjectName: 'אזרחות' },
  { groupId: 'lit', subjectName: 'ספרות', groupTeachers: [{ teacherName: 'לוי' }] },
  // Not in the student's grid: only ever moved in or added.
  { groupId: 'chem', subjectName: 'כימיה', groupTeachers: [{ teacherName: 'כהן' }] },
]);
const BELLS = buildBellIndex([
  { lessonNumber: 1, startTime: '08:00', endTime: '08:45' },
  { lessonNumber: 2, startTime: '08:50', endTime: '09:35' },
  { lessonNumber: 3, startTime: '09:50', endTime: '10:35' },
  { lessonNumber: 4, startTime: '10:40', endTime: '11:25' },
]);

/** Mashov writes Israel local time with no offset. */
const day = (date: DateStr) => `${date}T00:00:00`;
const normalize = (raw: unknown) => normalizeTimetableChanges(raw, GROUPS, BELLS, ZONE);

describe('normalizing the answer', () => {
  it('turns each action into its change, the lesson filled in from the group and the bells', () => {
    const { isEnabled, changes } = normalize({
      isEnabled: true,
      changes: [
        { action: 0, groupId: 'g1', lessonDate: day('2026-09-14'), lesson: 1, teacherName: 'רז' },
        { action: 1, groupId: 'g1', lessonDate: day('2026-09-15'), lesson: 1, teacherName: 'אבי' },
        { action: 2, groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 },
        { action: 3, groupId: 'chem', lessonDate: day('2026-09-16'), lesson: 4 },
        { action: 4, groupId: 'chem', lessonDate: day('2026-09-17'), lesson: 3 },
        { action: 5, groupId: 'chem', lessonDate: day('2026-09-17'), lesson: 4, groupName: 'כימיה מוגבר' },
        { action: 8, groupId: 'lit', lessonDate: day('2026-09-14'), lesson: 2 },
      ],
      cancellations: [{ groupId: 'g2', lessonDate: day('2026-09-14'), lesson: 3 }],
    });
    expect(isEnabled).toBe(true);
    expect(changes.map((c) => [c.date, c.hourIndex, c.groupId, c.kind, c.subject, c.teacher])).toEqual([
      ['2026-09-14', 1, 'g1', 'substitute', 'אנגלית', 'רז'],
      ['2026-09-15', 1, 'g1', 'substitute', 'אנגלית', 'אבי'],
      ['2026-09-16', 1, 'g1', 'cancelled', 'אנגלית', 'שרון'],
      ['2026-09-16', 4, 'chem', 'moved', 'כימיה', 'כהן'],
      ['2026-09-17', 3, 'chem', 'extra', 'כימיה', 'כהן'],
      // The group's subject wins over the row's group name, as in the grid.
      ['2026-09-17', 4, 'chem', 'extra', 'כימיה', 'כהן'],
      ['2026-09-14', 2, 'lit', 'online', 'ספרות', 'לוי'],
      ['2026-09-14', 3, 'g2', 'cancelled', 'היסטוריה', null],
    ]);
    expect(changes[3]).toMatchObject({ naturalKey: 'mashov-ttchange|2026-09-16|4|chem|3', action: 3, startTime: '10:40', endTime: '11:25' });
  });

  it('keeps one change for a lesson both cancelled and listed among the cancellations', () => {
    const { changes } = normalize({
      isEnabled: true,
      changes: [{ action: 2, groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 }],
      cancellations: [{ groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 }],
    });
    expect(changes.map((c) => c.naturalKey)).toEqual(['mashov-ttchange|2026-09-16|1|g1|2']);
  });

  it('drops a row it cannot place, and an action it does not know', () => {
    const { changes } = normalize({
      isEnabled: true,
      changes: [
        { action: 2, lessonDate: day('2026-09-16'), lesson: 1 },
        { action: 2, groupId: 'g1', lesson: 1 },
        { action: 2, groupId: 'g1', lessonDate: 'not a date', lesson: 1 },
        { action: 2, groupId: 'g1', lessonDate: day('2026-09-16') },
        { groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 },
        { action: 6, groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 },
        { action: 'בוטל', groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 },
        null,
        'x',
        // Numbers as strings are still read.
        { action: '8', groupId: 7, lessonDate: day('2026-09-16'), lesson: '2' },
      ],
      cancellations: [{ groupId: 'g1', lesson: 1 }, 42],
    });
    expect(changes.map((c) => [c.groupId, c.hourIndex, c.kind])).toEqual([['7', 2, 'online']]);
    // A group Mashov did not list: no subject to show it by.
    expect(changes[0]!.subject).toBeNull();
  });

  it('reads anything that is not an object as nothing said and nothing changed', () => {
    for (const junk of [null, undefined, 'x', 5, [], [{ action: 2 }]]) {
      expect(normalize(junk)).toEqual({ isEnabled: null, changes: [] });
    }
    // Lists that are not lists, and a flag that is not a flag.
    expect(normalize({ isEnabled: 'yes', changes: {}, cancellations: 'none' })).toEqual({ isEnabled: null, changes: [] });
  });

  it('changes nothing for a school that does not use them', () => {
    expect(normalize({ isEnabled: false })).toEqual({ isEnabled: false, changes: [] });
    const listed = normalize({ isEnabled: false, changes: [{ action: 2, groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 }], cancellations: [] });
    expect(listed).toEqual({ isEnabled: false, changes: [] });
  });

  it('becomes one entity per change and one record of what the school said', () => {
    const answer = normalize({ isEnabled: true, changes: [{ action: 2, groupId: 'g1', lessonDate: day('2026-09-16'), lesson: 1 }], cancellations: [] });
    const entities = timetableChangeEntities(answer, '2026-09-01T07:00:00.000Z');
    expect(entities.map((e) => [e.kind, e.naturalKey])).toEqual([
      ['timetable_change', 'mashov-ttchange|2026-09-16|1|g1|2'],
      ['timetable_change_read', 'mashov-timetable-changes'],
    ]);
    expect(entities[1]!.payload).toEqual({ isEnabled: true, readAt: '2026-09-01T07:00:00.000Z' });
    expect(timetableChangesEnabled(entities)).toBe(true);
    expect(timetableChangesEnabled(timetableChangeEntities({ isEnabled: false, changes: [] }, 'x'))).toBe(false);
    expect(timetableChangesEnabled(timetableChangeEntities({ isEnabled: null, changes: [] }, 'x'))).toBeNull();
    // Before the first read.
    expect(timetableChangesEnabled(undefined)).toBeNull();
    expect(timetableChangesEnabled([])).toBeNull();
  });
});

describe('the projection', () => {
  const TODAY = '2026-09-01';
  /**
   * The projection horizon: 7 days back, 35 ahead (Tue 25.08 to Tue 06.10). Past the usual 21:
   * 20.09–03.10 is Yom Kippur and Sukkot, without a school day, and Sunday 04.10 is the first one after.
   */
  const DATES: DateStr[] = Array.from({ length: 43 }, (_v, i) => addDays(TODAY, i - 7, ZONE));
  /** Days the site published lessons on: this week to Tuesday, and all of next week. Projected: 14.09 on. */
  const PUBLISHED = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
  const shahaf: ShahafSighting[] = PUBLISHED.map((date) => ({
    date,
    lesson: { date, hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'ספרות', teacher: 'לוי', room: '12', status: 'regular', substitute: null, note: null },
  }));

  /** Sunday to Thursday: the day's subject in period 1, literature in period 2. */
  const SUBJECTS = ['מתמטיקה', 'אנגלית', 'היסטוריה', 'פיזיקה', 'אזרחות'];
  const SLOTS: TimetableSlot[] = SUBJECTS.flatMap((subject, dayOfWeek) => [
    { dayOfWeek, hourIndex: 1, subject, teacher: 'מורה', room: null, startTime: '08:00', endTime: '08:45', groupId: `g${dayOfWeek}` },
    { dayOfWeek, hourIndex: 2, subject: 'ספרות', teacher: 'לוי', room: null, startTime: '08:50', endTime: '09:35', groupId: 'lit' },
  ]);

  const { changes } = normalize({
    isEnabled: true,
    changes: [
      // Monday 14.09: English cancelled, literature with a substitute.
      { action: 2, groupId: 'g1', lessonDate: day('2026-09-14'), lesson: 1 },
      { action: 0, groupId: 'lit', lessonDate: day('2026-09-14'), lesson: 2, teacherName: 'רז' },
      // Tuesday 15.09: history online; literature online but also cancelled.
      { action: 8, groupId: 'g2', lessonDate: day('2026-09-15'), lesson: 1 },
      { action: 8, groupId: 'lit', lessonDate: day('2026-09-15'), lesson: 2 },
      // Wednesday 16.09: chemistry moved into period 4; physics "added" where it already is.
      { action: 3, groupId: 'chem', lessonDate: day('2026-09-16'), lesson: 4 },
      { action: 4, groupId: 'g3', lessonDate: day('2026-09-16'), lesson: 1 },
      // Thursday 17.09: an extra chemistry lesson in period 3, listed twice; civics vacated for a substitute.
      { action: 5, groupId: 'chem', lessonDate: day('2026-09-17'), lesson: 3 },
      { action: 4, groupId: 'chem', lessonDate: day('2026-09-17'), lesson: 3 },
      { action: 1, groupId: 'g4', lessonDate: day('2026-09-17'), lesson: 1, teacherName: 'אבי' },
      // Sunday 04.10: a cancellation of a group the grid does not have there changes nothing.
      { action: 2, groupId: 'chem', lessonDate: day('2026-10-04'), lesson: 1 },
      // Monday 07.09 and Tuesday 08.09 are the site's: neither applies.
      { action: 2, groupId: 'lit', lessonDate: day('2026-09-07'), lesson: 1 },
      { action: 5, groupId: 'chem', lessonDate: day('2026-09-08'), lesson: 3 },
    ],
    cancellations: [{ groupId: 'lit', lessonDate: day('2026-09-15'), lesson: 2 }],
  });

  const show = (r: LessonRow) => [r.hourIndex, r.subject, r.status, r.substitute, r.note, r.source].filter((v) => v !== null).join(' ');
  const on = (rows: LessonRow[], date: DateStr) => rows.filter((r) => r.date === date).map(show);
  const rows = planLessonRows(DATES, shahaf, SLOTS, ZONE, changes);

  it('cancels, gives a substitute and moves online on a projected date', () => {
    expect(on(rows, '2026-09-14')).toEqual(['1 אנגלית cancelled mashov', '2 ספרות substitution רז mashov']);
    // An online lesson that is also cancelled is cancelled.
    expect(on(rows, '2026-09-15')).toEqual(['1 היסטוריה remote mashov', '2 ספרות cancelled mashov']);
    expect(on(rows, '2026-09-17')).toEqual([
      '1 אזרחות substitution אבי mashov',
      '2 ספרות regular mashov',
      '3 כימיה moved שיעור שנוסף למערכת mashov',
    ]);
  });

  it('adds a lesson moved in, and marks one added where its group already is', () => {
    expect(on(rows, '2026-09-16')).toEqual([
      '1 פיזיקה moved שיעור שנוסף למערכת mashov',
      '2 ספרות regular mashov',
      '4 כימיה moved השיעור הועבר לשעה הזאת mashov',
    ]);
    expect(rows.find((r) => r.date === '2026-09-16' && r.hourIndex === 4)).toMatchObject({ teacher: 'כהן', startTime: '10:40', endTime: '11:25' });
  });

  it('cancels a lesson Mashov added, whichever change it listed first', () => {
    for (const order of ['cancel first', 'add first']) {
      const cancel = { action: 2, groupId: 'chem', lessonDate: day('2026-09-14'), lesson: 3 };
      const add = { action: 5, groupId: 'chem', lessonDate: day('2026-09-14'), lesson: 3 };
      const { changes: listed } = normalize({ isEnabled: true, changes: order === 'cancel first' ? [cancel, add] : [add, cancel], cancellations: [] });
      expect(on(planLessonRows(DATES, shahaf, SLOTS, ZONE, listed), '2026-09-14'), order).toEqual([
        '1 אנגלית regular mashov',
        '2 ספרות regular mashov',
        '3 כימיה cancelled שיעור שנוסף למערכת mashov',
      ]);
    }
  });

  it('gives a substitute to a lesson Mashov moved in', () => {
    const { changes: listed } = normalize({
      isEnabled: true,
      changes: [
        { action: 0, groupId: 'chem', lessonDate: day('2026-09-14'), lesson: 4, teacherName: 'רז' },
        { action: 3, groupId: 'chem', lessonDate: day('2026-09-14'), lesson: 4 },
      ],
      cancellations: [],
    });
    expect(on(planLessonRows(DATES, shahaf, SLOTS, ZONE, listed), '2026-09-14')).toEqual([
      '1 אנגלית regular mashov',
      '2 ספרות regular mashov',
      '4 כימיה substitution רז השיעור הועבר לשעה הזאת mashov',
    ]);
  });

  it('marks only where a moved lesson went', () => {
    // History moves from period 1 to period 3 on Tuesday 15.09. Mashov's own site marks only the
    // period it moved to, and Mashov is expected to send a cancellation for the period it left;
    // the phone makes none up, so without one the grid's lesson stays where it was.
    const move = { action: 3, groupId: 'g2', lessonDate: day('2026-09-15'), lesson: 3 };
    const moved = normalize({ isEnabled: true, changes: [move], cancellations: [] }).changes;
    expect(on(planLessonRows(DATES, shahaf, SLOTS, ZONE, moved), '2026-09-15')).toEqual([
      '1 היסטוריה regular mashov',
      '2 ספרות regular mashov',
      '3 היסטוריה moved השיעור הועבר לשעה הזאת mashov',
    ]);
    // With the cancellation Mashov sends for it, the period it left is cancelled.
    const withCancel = normalize({ isEnabled: true, changes: [move], cancellations: [{ groupId: 'g2', lessonDate: day('2026-09-15'), lesson: 1 }] }).changes;
    expect(on(planLessonRows(DATES, shahaf, SLOTS, ZONE, withCancel), '2026-09-15')).toEqual([
      '1 היסטוריה cancelled mashov',
      '2 ספרות regular mashov',
      '3 היסטוריה moved השיעור הועבר לשעה הזאת mashov',
    ]);
  });

  it('leaves the rest of the grid alone', () => {
    expect(on(rows, '2026-10-04')).toEqual(['1 מתמטיקה regular mashov', '2 ספרות regular mashov']);
    expect(on(rows, '2026-10-06')).toEqual(on(planLessonRows(DATES, shahaf, SLOTS, ZONE), '2026-10-06'));
    expect(on(rows, '2026-10-06')).toEqual(['1 היסטוריה regular mashov', '2 ספרות regular mashov']);
  });

  it('never changes a date the site describes', () => {
    expect(on(rows, '2026-09-07')).toEqual(['1 ספרות regular shahaf']);
    expect(on(rows, '2026-09-08')).toEqual(['1 ספרות regular shahaf']);
    expect(rows.filter((r) => r.date < '2026-09-14')).toEqual(planLessonRows(DATES, shahaf, SLOTS, ZONE).filter((r) => r.date < '2026-09-14'));
  });

  it('matches nothing in a grid read before slots kept their group', () => {
    const old = SLOTS.map(({ groupId: _g, ...slot }) => slot);
    const plain = planLessonRows(DATES, shahaf, old, ZONE, changes).filter((r) => r.date === '2026-09-14');
    expect(plain.map(show)).toEqual(['1 אנגלית regular mashov', '2 ספרות regular mashov']);
  });
});

describe('the phone\'s days', () => {
  const entity = (kind: string, naturalKey: string, payload: unknown): NormalizedEntity =>
    ({ source: 'mashov', kind, naturalKey, payload }) as NormalizedEntity;
  const slot = (dayOfWeek: number, groupId: string, subject: string) =>
    entity('timetable_slot', `mashov-slot|${dayOfWeek}|1|${subject}`, {
      dayOfWeek, hourIndex: 1, subject, teacher: 'שרון', room: null, groupName: null, startTime: '08:00', endTime: '08:45', groupId,
    });
  const answer = normalize({ isEnabled: true, changes: [{ action: 2, groupId: 'g1', lessonDate: day('2026-09-02'), lesson: 1 }], cancellations: [] });
  // Wednesday's English is cancelled; Thursday's is as the grid says.
  const mashov = [slot(3, 'g1', 'אנגלית'), slot(4, 'g1', 'אנגלית'), ...timetableChangeEntities(answer, NOW.toISOString())];
  const src = (over: Partial<LocalSources> = {}): LocalSources => ({
    feed: null, mashov, bagrut: [], google: [], settings: { ...DEFAULT_SETTINGS, classId: '7' }, zone: ZONE, now: NOW, ...over,
  });

  it('show Mashov\'s change on the day the grid fills, counted and dated like the site\'s', () => {
    const seen = recordChanges(localLessonRows(src()).filter((r) => r.source === 'mashov'), {}, NOW, ZONE, '2026-09-01');
    const [wednesday, thursday] = buildLocalDays(src({ changeSeen: seen }), ['2026-09-02', '2026-09-03']);
    const lesson = wednesday!.timeline.find((i) => i.kind === 'lesson');
    expect(lesson?.kind === 'lesson' && lesson.lesson).toMatchObject({ status: 'cancelled', source: 'mashov', changeSeenAt: '2026-09-01T10:00:00.000+03:00' });
    expect(wednesday!.changeCount).toBe(1);
    expect(thursday!.changeCount).toBe(0);
  });
});

describe('reading them', () => {
  /** A Mashov that answers one grid lesson, homework, a grade and a message; `changes` as given. */
  function fakeApi(changes: (start: string, end: string) => Promise<unknown>): MashovApi {
    const empty = async () => [];
    return {
      timetable: async () => [{ day: 4, lesson: 1, groupId: 'g1' }],
      timetableChanges: changes,
      homework: async () => [{ homeworkId: 1, lessonDate: day('2026-10-22'), subjectName: 'אנגלית', homework: 'עמוד 12' }],
      grades: async () => [{ gradeId: 1, eventDate: day('2026-10-20'), subjectName: 'אנגלית', grade: 90 }],
      behave: empty,
      lessonsCount: empty,
      groups: async () => [{ groupId: 'g1', subjectName: 'אנגלית' }],
      bells: empty,
      mail: async () => [{ conversationId: 'c1', subject: 'טיול', sendTime: '2026-10-21T08:00:00', senderName: 'המחנכת' }],
      conversation: async () => ({}),
      bagrutGrades: empty,
      bagrutSheelonim: empty,
    };
  }
  const BASE_SCOPES = ['timetable_slot', 'homework', 'grade', 'message', 'attendance', 'lesson_count'];
  const at = new Date('2026-10-23T10:00:00+03:00');

  it('asks for the days the lessons are built for, and keeps the changes and the record', async () => {
    const asked: string[] = [];
    const api = fakeApi(async (start, end) => {
      asked.push(start, end);
      return { isEnabled: true, changes: [{ action: 2, groupId: 'g1', lessonDate: day('2026-10-29'), lesson: 1 }], cancellations: [] };
    });
    const read = await readMashov(api, { zone: ZONE, storedMessages: null, readBagrut: false, now: at });
    // A week back, and one day past the three weeks ahead.
    expect(asked).toEqual(['2026-10-16', '2026-11-14']);
    expect(read.entities.filter((e) => e.kind.startsWith('timetable_change')).map((e) => e.kind)).toEqual(['timetable_change', 'timetable_change_read']);
    expect(read.scopes.map((s) => s.kind)).toEqual([...BASE_SCOPES, 'timetable_change', 'timetable_change_read']);
    expect(read.counts.timetableChanges).toBe(1);
    // The grid keeps the group the change names.
    expect(read.entities.find((e) => e.kind === 'timetable_slot')?.payload).toMatchObject({ groupId: 'g1' });
  });

  it('builds the path the student site uses', async () => {
    const paths: string[] = [];
    await mashovApi(async (path) => void paths.push(path), 'u-1').timetableChanges('2026-10-16', '2026-11-14');
    expect(paths).toEqual(['/api/students/u-1/timetable/changes?start=2026-10-16&end=2026-11-14']);
  });

  it('still reads everything else when the changes cannot be read', async () => {
    const good = await readMashov(fakeApi(async () => ({ isEnabled: true, changes: [], cancellations: [] })), { zone: ZONE, storedMessages: null, readBagrut: false, now: at });
    const warnings: string[] = [];
    const failing = fakeApi(async () => {
      throw new Error('Mashov returned HTTP 500');
    });
    const read = await readMashov(failing, { zone: ZONE, storedMessages: null, readBagrut: false, now: at, onWarning: (part) => warnings.push(part) });
    expect(warnings).toEqual(['timetable changes']);
    expect(read.entities.map((e) => e.kind)).toEqual(good.entities.map((e) => e.kind).filter((k) => !k.startsWith('timetable_change')));
    expect(read.entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['timetable_slot', 'homework', 'grade', 'message']));
    // Claims neither scope, so nothing stored of them is pruned.
    expect(read.scopes.map((s) => s.kind)).toEqual(BASE_SCOPES);
    expect(read.counts.timetableChanges).toBeNull();

    // A Mashov API without the call at all (an older fake, a transport that lacks it) is the same.
    const { timetableChanges: _missing, ...older } = failing;
    const olderRead = await readMashov(older as unknown as MashovApi, { zone: ZONE, storedMessages: null, readBagrut: false, now: at });
    expect(olderRead.scopes.map((s) => s.kind)).toEqual(BASE_SCOPES);
  });

  /** The phone's storage, and a Mashov whose changes call fails while `failing.now` is set. */
  function phone() {
    const map = new Map<string, string>();
    const kv = { getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
    const failing = { now: false };
    const api = fakeApi(async () => {
      if (failing.now) throw new Error('Mashov returned HTTP 500');
      return { isEnabled: true, changes: [{ action: 2, groupId: 'g1', lessonDate: day('2026-10-29'), lesson: 1 }], cancellations: [] };
    });
    const sync = (when: Date) => syncMashov({ kv, api: async () => api, zone: ZONE, now: () => when }, { force: true, bagrut: false });
    return { kv, failing, sync };
  }
  const later = new Date(at.getTime() + 60 * 60_000);
  const changesOf = (entities: NormalizedEntity[]) => entities.filter((e) => e.kind === 'timetable_change');

  it('keeps the changes the last read had when their call fails, and says on their record that it failed', async () => {
    const { kv, failing, sync } = phone();
    await sync(at);
    const before = localRead(kv)!.entities;
    expect(changesOf(before)).toHaveLength(1);
    expect(timetableChangesFailed(before)).toBe(false);

    failing.now = true;
    expect((await sync(later)).kind).toBe('ok');
    const kept = localRead(kv)!.entities;
    // The cancellation is still there, so the lesson still shows as cancelled.
    expect(changesOf(kept)).toEqual(changesOf(before));
    expect(kept.find((e) => e.kind === 'timetable_change_read')?.payload).toEqual({
      isEnabled: true, readAt: at.toISOString(), failedAt: later.toISOString(), lastError: 'Mashov returned HTTP 500',
    });
    expect(timetableChangesEnabled(kept)).toBe(true);
    expect(timetableChangesFailed(kept)).toBe(true);
    // Everything else is this read's.
    expect(localRead(kv)!.at).toBe(later.toISOString());

    // A read that works replaces them, and the failure is over.
    failing.now = false;
    await sync(new Date(later.getTime() + 60 * 60_000));
    const again = localRead(kv)!.entities;
    expect(changesOf(again)).toHaveLength(1);
    expect(timetableChangesFailed(again)).toBe(false);
  });

  it('records a first read of them that fails, with no changes to keep', async () => {
    const { kv, failing, sync } = phone();
    failing.now = true;
    await sync(at);
    const entities = localRead(kv)!.entities;
    expect(changesOf(entities)).toEqual([]);
    expect(entities.find((e) => e.kind === 'timetable_change_read')?.payload).toEqual({
      isEnabled: null, readAt: null, failedAt: at.toISOString(), lastError: 'Mashov returned HTTP 500',
    });
    expect(timetableChangesEnabled(entities)).toBeNull();
    expect(timetableChangesFailed(entities)).toBe(true);
  });
});
