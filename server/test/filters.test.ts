/**
 * Read-time filters: which of the class's lessons are mine, and which calendar
 * content stays off the timeline (design-doc §7).
 */
import { describe, expect, it } from 'vitest';
import { seriesIdOf } from '@sederyom/shared';
import {
  filterEvents, filterExams, filterHomework, filterLessons, isHiddenEvent, isHiddenExam, isHiddenLesson, isShownHomework,
  lessonHideKey,
} from '@sederyom/shared/logic/filters';

describe('my lessons', () => {
  const settings = (hidden: string[]) => ({ lessons: { hiddenSubjects: hidden } });

  it('hides by the exact published subject', () => {
    const lessons = [
      { subject: 'כימיה', teacher: 'לוי' },
      { subject: 'אנגלית 5 יח"ל', teacher: 'נקש ירדנה' },
    ];
    expect(filterLessons(lessons, settings(['כימיה'])).map((l) => l.subject)).toEqual(['אנגלית 5 יח"ל']);
    expect(filterLessons(lessons, settings([]))).toHaveLength(2);
  });

  it('treats a bracketed variant as a different line', () => {
    expect(isHiddenLesson(['היסטוריה'], { subject: 'היסטוריה (יא1)', teacher: 'x' })).toBe(false);
    expect(isHiddenLesson(['היסטוריה (יא1)'], { subject: 'היסטוריה (יא1)', teacher: 'x' })).toBe(true);
  });

  it('can hide one group of a subject and keep the other', () => {
    const key = lessonHideKey({ subject: 'מתמטיקה 3 יח"ל', teacher: 'אשל גאולה' }, true);
    expect(key).toBe('מתמטיקה 3 יח"ל @ אשל גאולה');
    expect(isHiddenLesson([key], { subject: 'מתמטיקה 3 יח"ל', teacher: 'אשל גאולה' })).toBe(true);
    expect(isHiddenLesson([key], { subject: 'מתמטיקה 3 יח"ל', teacher: 'קשת גאיה' })).toBe(false);
    // A plain subject key still hides every group of that subject.
    expect(isHiddenLesson(['מתמטיקה 3 יח"ל'], { subject: 'מתמטיקה 3 יח"ל', teacher: 'קשת גאיה' })).toBe(true);
  });

  it('tolerates the two spellings of the quote mark', () => {
    expect(isHiddenLesson(['אנגלית 5 יח״ל'], { subject: 'אנגלית 5 יח"ל', teacher: null })).toBe(true);
  });
});

describe('my homework (R-4, R-5)', () => {
  const item = (subject: string, linkedTaskId: string | null = null) => ({ subject, linkedTaskId });
  const grid = [
    { subject: 'פיזיקה מורחב (יב3)', teacher: 'טלי רוזן' },
    { subject: 'מתמטיקה 3 יח"ל (יא1)', teacher: 'אשל גאולה' },
    { subject: 'מתמטיקה 3 יח"ל', teacher: 'קשת גאיה' },
  ];

  it('drops what became a task, hide list or not', () => {
    expect(isShownHomework([], item('פיזיקה', 'task-1'))).toBe(false);
    expect(isShownHomework([], item('פיזיקה'))).toBe(true);
  });

  it('hides a Mashov subject whose only site line is hidden', () => {
    expect(isShownHomework(['פיזיקה מורחב (יב3)'], item('פיזיקה'), grid)).toBe(false);
    // One maths line kept: maths homework stays.
    expect(isShownHomework(['מתמטיקה 3 יח"ל (יא1)'], item('מתמטיקה'), grid)).toBe(true);
    // Both maths lines hidden: nothing of the subject is kept.
    expect(isShownHomework(['מתמטיקה 3 יח"ל', 'מתמטיקה 3 יח"ל (יא1)'], item('מתמטיקה'), grid)).toBe(false);
  });

  it('reads the subject out of a "subject @ teacher" key', () => {
    const keys = ['מתמטיקה 3 יח"ל @ אשל גאולה', 'מתמטיקה 3 יח"ל (יא1) @ אשל גאולה'];
    expect(isShownHomework(keys.slice(0, 1), item('מתמטיקה'), grid)).toBe(true);
    expect(isShownHomework([...keys, 'מתמטיקה 3 יח"ל @ קשת גאיה'], item('מתמטיקה'), grid)).toBe(false);
  });

  it('without a timetable, only an exact key hides', () => {
    expect(isShownHomework(['פיזיקה מורחב (יב3)'], item('פיזיקה'))).toBe(true);
    expect(isShownHomework(['פיזיקה מורחב (יב3)'], item('פיזיקה מורחב (יב3)'))).toBe(false);
  });

  it('filters a list the same way', () => {
    const items = [item('פיזיקה'), item('מתמטיקה'), item('אנגלית', 'task-2')];
    expect(filterHomework(items, { lessons: { hiddenSubjects: ['פיזיקה מורחב (יב3)'] } }, grid).map((h) => h.subject)).toEqual(['מתמטיקה']);
  });
});

describe('my exams', () => {
  const exams = [
    { naturalKey: 'site-exam|a', subject: 'מבחן גוש א' },
    { naturalKey: 'site-exam|b', subject: 'מבחן במתמטיקה' },
    { naturalKey: 'mashov-exam|2026-11-01|כימיה', subject: 'כימיה' },
  ];

  it('hides by natural key, whatever the source', () => {
    const settings = { exams: { hiddenKeys: ['site-exam|a', 'mashov-exam|2026-11-01|כימיה'] } };
    expect(filterExams(exams, settings).map((e) => e.subject)).toEqual(['מבחן במתמטיקה']);
    expect(isHiddenExam(settings.exams.hiddenKeys, exams[0]!)).toBe(true);
    expect(isHiddenExam(settings.exams.hiddenKeys, exams[1]!)).toBe(false);
  });

  it('shows everything while nothing is hidden', () => {
    expect(filterExams(exams, { exams: { hiddenKeys: [] } })).toBe(exams);
  });

  it('keeps the grade exam calendar off the timeline: its events arrive as exams', () => {
    const filter = { hiddenCalendarIds: [], hiddenEventIds: [], schoolCalendarId: null, examCalendarId: 'exams@group' };
    expect(isHiddenEvent({ id: 'e', calendarId: 'exams@group' }, filter)).toBe(true);
    expect(isHiddenEvent({ id: 'e', calendarId: 'personal' }, filter)).toBe(false);
    expect(isHiddenEvent({ id: 'e', calendarId: 'exams@group' }, { ...filter, examCalendarId: null })).toBe(false);
  });

  it('keeps every exam calendar off the timeline when there are several (a phone\'s own board reads one of its own)', () => {
    const filter = { hiddenCalendarIds: [], hiddenEventIds: [], schoolCalendarId: null, examCalendarId: 'exams@group', examCalendarIds: ['exams@group', 'mine@group'] };
    for (const calendarId of ['exams@group', 'mine@group']) expect(isHiddenEvent({ id: 'e', calendarId }, filter), calendarId).toBe(true);
    expect(isHiddenEvent({ id: 'e', calendarId: 'personal' }, filter)).toBe(false);
    // Either field on its own works, and an empty list hides nothing.
    expect(isHiddenEvent({ id: 'e', calendarId: 'mine@group' }, { ...filter, examCalendarId: null })).toBe(true);
    expect(isHiddenEvent({ id: 'e', calendarId: 'exams@group' }, { ...filter, examCalendarIds: [] })).toBe(true);
    expect(isHiddenEvent({ id: 'e', calendarId: 'mine@group' }, { ...filter, examCalendarIds: [] })).toBe(false);
  });
});

describe('calendar filter', () => {
  const base = { hiddenCalendarIds: [], hiddenEventIds: [], schoolCalendarId: null };

  it('reads a series id off an instance id, for both id shapes Google uses', () => {
    expect(seriesIdOf('abc123_20260901')).toBe('abc123');
    expect(seriesIdOf('abc123_20260901T150000Z')).toBe('abc123');
    expect(seriesIdOf('a_b_20260901')).toBe('a_b');
    expect(seriesIdOf('abc123')).toBeNull();
    expect(seriesIdOf('abc_2026')).toBeNull();
  });

  it('hides a whole calendar', () => {
    const events = [{ id: 'a', calendarId: 'family' }, { id: 'b', calendarId: 'personal' }];
    expect(filterEvents(events, { ...base, hiddenCalendarIds: ['family'] })).toEqual([{ id: 'b', calendarId: 'personal' }]);
  });

  it('hides one occurrence, or the whole series', () => {
    const first = { id: 'ser_20260901T150000Z', calendarId: 'c' };
    const second = { id: 'ser_20260908T150000Z', calendarId: 'c' };
    expect(filterEvents([first, second], { ...base, hiddenEventIds: [first.id] })).toEqual([second]);
    expect(filterEvents([first, second], { ...base, hiddenEventIds: ['ser'] })).toEqual([]);
  });

  it('never shows the school mirror calendar, whose exams are already chips', () => {
    expect(isHiddenEvent({ id: 'e', calendarId: 'school' }, { ...base, schoolCalendarId: 'school' })).toBe(true);
    expect(isHiddenEvent({ id: 'e', calendarId: 'other' }, { ...base, schoolCalendarId: 'school' })).toBe(false);
  });
});
