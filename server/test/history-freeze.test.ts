/**
 * A lesson's state at its start, from the change events (year wrapped, part 1).
 *
 * The cases are the ones the production log showed on 2026-11-10: a
 * cancellation, a week's lessons deleted on the Friday after them, the markup
 * bug of 2026-11-04 that deleted every lesson and created it under another key.
 */
import { describe, expect, it } from 'vitest';
import type { ClassLesson } from '@sederyom/shared';
import { freezeDay, type LessonEvent } from '../src/history/freeze.js';
import { IGNORED_WINDOWS } from '../src/history/run.js';

const ZONE = 'Asia/Jerusalem';
const MONDAY = '2026-10-26';
const OPTS = { zone: ZONE, ignore: [] };

function lesson(over: Partial<ClassLesson> = {}): ClassLesson {
  return {
    date: MONDAY, hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'אנגלית', teacher: 'שרון',
    room: '108', status: 'regular', substitute: null, note: null, ...over,
  };
}
const keyOf = (l: ClassLesson) => `${l.date}|${l.hourIndex}|${l.subject}|${l.teacher ?? ''}`;
function ev(l: ClassLesson, change: LessonEvent['change'], at: string): LessonEvent {
  return { naturalKey: keyOf(l), change, after: change === 'deleted' ? null : l, createdAt: new Date(at) };
}

const CREATED = ev(lesson(), 'created', '2026-10-19T19:01:00+03:00');
const CANCELLED = ev(lesson({ status: 'cancelled' }), 'updated', '2026-10-25T17:00:00+02:00');

describe('freezeDay', () => {
  it('a regular lesson is one regular row', () => {
    expect(freezeDay(MONDAY, [CREATED], OPTS)).toEqual([
      {
        date: MONDAY, hourIndex: 1, subject: 'אנגלית', teacher: 'שרון', room: '108', startTime: '08:00', endTime: '08:45',
        status: 'regular', substitute: null, note: null, changeSeenAt: null,
      },
    ]);
  });

  it('a cancellation seen before the lesson is kept, with when it was first seen', () => {
    const rows = freezeDay(MONDAY, [CREATED, CANCELLED], OPTS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'cancelled', changeSeenAt: '2026-10-25T15:00:00.000Z' });
  });

  it('the first sighting stays when the same change is written again', () => {
    const again = ev(lesson({ status: 'cancelled', note: 'בוטל' }), 'updated', '2026-10-25T20:00:00+02:00');
    expect(freezeDay(MONDAY, [CREATED, CANCELLED, again], OPTS)[0]).toMatchObject({
      status: 'cancelled', note: 'בוטל', changeSeenAt: '2026-10-25T15:00:00.000Z',
    });
  });

  it('cancelled and restored before it began is regular', () => {
    const restored = ev(lesson(), 'updated', '2026-10-26T07:30:00+02:00');
    expect(freezeDay(MONDAY, [CREATED, CANCELLED, restored], OPTS)[0]).toMatchObject({ status: 'regular', changeSeenAt: null });
  });

  it('a restore after the lesson began changes nothing', () => {
    const late = ev(lesson(), 'updated', '2026-10-26T09:00:00+02:00');
    expect(freezeDay(MONDAY, [CREATED, CANCELLED, late], OPTS)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('a delete after the lesson took place changes nothing', () => {
    const friday = ev(lesson(), 'deleted', '2026-10-30T14:00:00+02:00');
    expect(freezeDay(MONDAY, [CREATED, CANCELLED, friday], OPTS)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('a lesson deleted before it began has no row', () => {
    const gone = ev(lesson(), 'deleted', '2026-10-25T12:00:00+02:00');
    expect(freezeDay(MONDAY, [CREATED, gone], OPTS)).toEqual([]);
  });

  it('the same event twice is one row', () => {
    expect(freezeDay(MONDAY, [CREATED, CANCELLED, CANCELLED, CREATED], OPTS)).toHaveLength(1);
  });

  it('events given out of order are read in the order they happened', () => {
    expect(freezeDay(MONDAY, [CANCELLED, CREATED], OPTS)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('events inside an ignored window are skipped', () => {
    // The markup bug: the real key deleted and a garbage key created, then the real one back.
    const garbage = lesson({ subject: 'אנגלית (יב2)שרון', teacher: null });
    const events = [
      CREATED,
      ev(lesson(), 'deleted', '2026-10-26T07:40:00+02:00'),
      ev(garbage, 'created', '2026-10-26T07:40:00+02:00'),
      ev(lesson(), 'created', '2026-10-26T08:20:00+02:00'),
      ev(garbage, 'deleted', '2026-10-26T08:20:00+02:00'),
    ];
    const ignore = [{ from: new Date('2026-10-26T07:39:00+02:00'), to: new Date('2026-10-26T08:19:00+02:00') }];
    const rows = freezeDay(MONDAY, events, { zone: ZONE, ignore });
    expect(rows.map((r) => [r.subject, r.teacher, r.status])).toEqual([['אנגלית', 'שרון', 'regular']]);
  });

  it('a lesson first seen after it began has no row', () => {
    const late = ev(lesson(), 'created', '2026-10-26T08:01:00+02:00');
    expect(freezeDay(MONDAY, [late], OPTS)).toEqual([]);
  });

  it('a lesson with no start time takes the time of its period from the day\'s other lessons', () => {
    const timeless = lesson({ subject: 'פיזיקה', teacher: 'לוי', startTime: null, endTime: null, status: 'cancelled' });
    const rows = freezeDay(MONDAY, [CREATED, ev(timeless, 'created', '2026-10-25T17:00:00+02:00')], OPTS);
    expect(rows.find((r) => r.subject === 'פיזיקה')).toMatchObject({ status: 'cancelled', startTime: null });
    // Seen only after the period began: not a row.
    const late = freezeDay(MONDAY, [CREATED, ev(timeless, 'created', '2026-10-26T08:30:00+02:00')], OPTS);
    expect(late.map((r) => r.subject)).toEqual(['אנגלית']);
  });

  it('with no time to take, the lesson is kept and its status is null', () => {
    const timeless = lesson({ hourIndex: 9, startTime: null, endTime: null, status: 'cancelled' });
    const rows = freezeDay(MONDAY, [ev(timeless, 'created', '2026-10-25T17:00:00+02:00')], OPTS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hourIndex: 9, status: null, changeSeenAt: null });
  });

  it('two groups in one period are two rows, in the order of the day', () => {
    const physics = lesson({ subject: 'פיזיקה', teacher: 'לוי' });
    const third = lesson({ hourIndex: 3, startTime: '09:45', endTime: '10:30' });
    const rows = freezeDay(MONDAY, [ev(third, 'created', '2026-10-19T19:01:00+03:00'), ev(physics, 'created', '2026-10-19T19:01:00+03:00'), CREATED], OPTS);
    expect(rows.map((r) => [r.hourIndex, r.subject])).toEqual([[1, 'אנגלית'], [1, 'פיזיקה'], [3, 'אנגלית']]);
  });

  it('another day\'s events are not this day\'s', () => {
    const tuesday = lesson({ date: '2026-10-27' });
    expect(freezeDay(MONDAY, [ev(tuesday, 'created', '2026-10-19T19:01:00+03:00')], OPTS)).toEqual([]);
  });
});

/**
 * The markup bug of 2026-11-04, at the minutes production recorded it (UTC): every class's
 * lessons deleted and created without their teacher between 13:46 and 14:01, and back between
 * 15:31 and 15:47.
 */
describe('the windows pinned from production', () => {
  const WEDNESDAY = '2026-11-04';
  const real = (date: string, over: Partial<ClassLesson> = {}) => lesson({ date, subject: 'אזרחות', teacher: 'נחמיאס משה', ...over });
  const garbage = (date: string, over: Partial<ClassLesson> = {}) => lesson({ date, subject: 'אזרחות (יב2)נחמיאס משה', teacher: null, ...over });
  const bug = (date: string, over: Partial<ClassLesson> = {}): LessonEvent[] => [
    ev(real(date, over), 'created', '2026-10-19T16:01:00Z'),
    ev(real(date, over), 'deleted', '2026-11-04T14:01:20Z'),
    ev(garbage(date, over), 'created', '2026-11-04T14:01:20Z'),
    ev(real(date, over), 'created', '2026-11-04T15:47:10Z'),
    ev(garbage(date, over), 'deleted', '2026-11-04T15:47:10Z'),
  ];
  const frozen = (date: string, events: LessonEvent[]) =>
    freezeDay(date, events, { zone: ZONE, ignore: IGNORED_WINDOWS }).map((r) => [r.subject, r.teacher, r.status]);

  it('a lesson that began while the bug was live is the real lesson', () => {
    // 16:15 in Israel is 14:15 UTC: after the lessons were rewritten, before they came back.
    expect(frozen(WEDNESDAY, bug(WEDNESDAY, { hourIndex: 9, startTime: '16:15', endTime: '17:00' }))).toEqual([['אזרחות', 'נחמיאס משה', 'regular']]);
  });

  it('the next day\'s lessons are the real ones, once each', () => {
    expect(frozen('2026-11-05', bug('2026-11-05'))).toEqual([['אזרחות', 'נחמיאס משה', 'regular']]);
  });

  it('covers every class\'s burst, the earliest and the latest', () => {
    const inside = (iso: string) => IGNORED_WINDOWS.some((w) => new Date(iso) >= w.from && new Date(iso) <= w.to);
    expect(inside('2026-11-04T13:46:00Z')).toBe(true);
    expect(inside('2026-11-04T15:47:59Z')).toBe(true);
    // The morning's real changes, and the evening's, are history.
    expect(inside('2026-11-04T13:30:00Z')).toBe(false);
    expect(inside('2026-11-04T16:00:00Z')).toBe(false);
  });
});
