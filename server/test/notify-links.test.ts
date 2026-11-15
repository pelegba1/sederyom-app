/**
 * Where a tap on each push lands (plan F12), and the exam pushes the owner's
 * "my exams" choices must silence.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type PushPayload, type UserSettings } from '@sederyom/shared';
import { type PendingChange, planNotifications } from '../src/notify/engine.js';

const TODAY = '2026-10-08';
const TOMORROW = '2026-10-09';

const allOn: UserSettings = {
  ...DEFAULT_SETTINGS,
  notifications: { ...DEFAULT_SETTINGS.notifications, new_grade: true, teacher_message: true },
};

let nextId = 1;
function created(kind: string, naturalKey: string, after: Record<string, unknown>, partition: string | null = null): PendingChange {
  return { id: nextId++, source: kind === 'lesson' ? 'shahaf' : 'mashov', kind, naturalKey, change: 'created', payload: { before: null, after, partition } };
}

function payloadOf(event: PendingChange, settings: UserSettings = allOn): PushPayload {
  const { planned } = planNotifications([event], { settings, today: TODAY, tomorrow: TOMORROW, nowTime: '16:00' });
  expect(planned).toHaveLength(1);
  return planned[0]!.push.payload;
}

describe('deep links per notification type', () => {
  it('a new exam opens the exams tab on that exam', () => {
    const key = 'site-exam|5ig82r3v9jh8dkh282i0f4qrg7@google.com';
    expect(payloadOf({ ...created('exam', key, { subject: 'מבחן באנגלית', date: '2026-10-20', details: null }), source: 'school_site' })).toEqual({
      type: 'new_exam', deepLink: 'school', tab: 'exams', examKey: key, date: '2026-10-20', refreshWidget: true,
    });
  });

  it('new homework opens the homework tab, without the snapshot date (the lesson it was given in)', () => {
    expect(payloadOf(created('homework', 'hw-1', { subject: 'היסטוריה', text: 'לקרוא פרק 3', dueDate: TODAY }))).toEqual({
      type: 'new_homework', deepLink: 'school', tab: 'homework', refreshWidget: true,
    });
  });

  it('a new grade opens the grades tab', () => {
    expect(payloadOf(created('grade', 'g-1', { subject: 'מתמטיקה', value: 92 }))).toEqual({
      type: 'new_grade', deepLink: 'school', tab: 'grades', refreshWidget: true,
    });
  });

  it('a teacher message opens the messages tab', () => {
    expect(payloadOf(created('message', 'm-1', { from: 'ירדנה', title: 'שינוי בחדר' }))).toEqual({
      type: 'teacher_message', deepLink: 'school', tab: 'messages', refreshWidget: true,
    });
  });

  it('a schedule change opens the day it is on', () => {
    const lesson = (partition: string) => ({
      ...created('lesson', `${partition}|3|פיזיקה|לוי`, { hourIndex: 3, subject: 'פיזיקה', teacher: 'לוי', status: 'cancelled' }, partition),
      change: 'updated' as const,
    });
    expect(payloadOf(lesson(TODAY))).toMatchObject({ type: 'schedule_change_today', deepLink: 'today', date: TODAY });
    expect(payloadOf(lesson(TOMORROW))).toMatchObject({ type: 'schedule_change_tomorrow', deepLink: 'week', date: TOMORROW });
  });
});

describe('new exams the owner switched off', () => {
  const exam = (key: string) => ({ ...created('exam', key, { subject: 'מבחן גוש א', date: '2026-11-15' }), source: 'school_site' });

  it('do not notify', () => {
    const settings: UserSettings = { ...allOn, exams: { hiddenKeys: ['site-exam|hidden'] } };
    const { planned, discardedIds } = planNotifications([exam('site-exam|hidden'), exam('site-exam|shown')], {
      settings, today: TODAY, tomorrow: TOMORROW, nowTime: '16:00',
    });
    expect(planned.map((p) => p.push.payload.examKey)).toEqual(['site-exam|shown']);
    expect(discardedIds).toHaveLength(1);
  });
});
