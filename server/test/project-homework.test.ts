import { describe, expect, it } from 'vitest';
import { deriveDueDate, type DueLesson, type HomeworkPayload } from '@sederyom/shared/logic/homework';

const ZONE = 'Asia/Jerusalem';
const GIVEN = '2026-09-01'; // Tuesday

function item(over: Partial<HomeworkPayload> = {}): HomeworkPayload {
  return { dueDate: GIVEN, subject: 'אנגלית', text: 'תרגיל 4', ...over };
}

function lesson(date: string, over: Partial<DueLesson> = {}): DueLesson {
  return { date, hourIndex: 2, subject: 'אנגלית 5 יח״ל', teacher: 'נקש ירדנה', status: 'regular', source: 'shahaf', ...over };
}

describe('homework due date', () => {
  it('is the next lesson of the subject after the day it was given', () => {
    const lessons = [
      lesson(GIVEN), // the lesson it was given in
      lesson('2026-09-02', { subject: 'מתמטיקה' }),
      lesson('2026-09-06', { hourIndex: 4 }),
      lesson('2026-09-03', { hourIndex: 6 }),
      lesson('2026-09-03', { hourIndex: 1 }),
    ];
    expect(deriveDueDate(item(), lessons, ZONE)).toBe('2026-09-03');
  });

  it('skips a cancelled lesson', () => {
    const lessons = [lesson('2026-09-03', { status: 'cancelled' }), lesson('2026-09-06')];
    expect(deriveDueDate(item(), lessons, ZONE)).toBe('2026-09-06');
  });

  it('keeps the assignment date when no lesson of the subject follows', () => {
    expect(deriveDueDate(item(), [lesson('2026-09-03', { subject: 'היסטוריה' })], ZONE)).toBe(GIVEN);
    expect(deriveDueDate(item(), [], ZONE)).toBe(GIVEN);
  });

  it('looks 14 days ahead and no further', () => {
    expect(deriveDueDate(item(), [lesson('2026-09-15')], ZONE)).toBe('2026-09-15');
    expect(deriveDueDate(item(), [lesson('2026-09-16')], ZONE)).toBe(GIVEN);
  });

  it('keeps an explicit due date as it is', () => {
    expect(deriveDueDate(item({ dueDate: '2026-09-10', dueExplicit: true }), [lesson('2026-09-03')], ZONE)).toBe('2026-09-10');
    expect(deriveDueDate(item({ dueDate: null }), [lesson('2026-09-03')], ZONE)).toBeNull();
  });

  it("prefers the owner's group: the matching teacher wins over an earlier parallel group", () => {
    const lessons = [
      lesson('2026-09-02', { teacher: 'דנה כהן' }),
      lesson('2026-09-03', { teacher: 'נקש ירדנה' }),
    ];
    expect(deriveDueDate(item({ teacher: 'ירדנה נקש' }), lessons, ZONE)).toBe('2026-09-03');
    // Without a teacher on the item, any group of the subject will do.
    expect(deriveDueDate(item(), lessons, ZONE)).toBe('2026-09-02');
  });

  it("prefers the owner's group: the exact published line wins over another group's", () => {
    const lessons = [
      lesson('2026-09-02', { subject: 'מתמטיקה 3 יח״ל (יא2)', teacher: null }),
      lesson('2026-09-03', { subject: 'מתמטיקה 3 יח״ל (יא1)', teacher: null }),
    ];
    expect(deriveDueDate(item({ subject: 'מתמטיקה', groupName: 'מתמטיקה 3 יח"ל (יא1)' }), lessons, ZONE)).toBe('2026-09-03');
  });

  it('never counts a line the owner hid', () => {
    const lessons = [lesson('2026-09-02', { teacher: 'דנה כהן' }), lesson('2026-09-03')];
    expect(deriveDueDate(item(), lessons, ZONE, ['אנגלית 5 יח"ל @ דנה כהן'])).toBe('2026-09-03');
  });

  it('reads Shahaf lessons first and Mashov projected lessons only without them', () => {
    const projected = lesson('2026-09-02', { source: 'mashov', subject: 'אנגלית' });
    expect(deriveDueDate(item(), [projected, lesson('2026-09-06')], ZONE)).toBe('2026-09-06');
    expect(deriveDueDate(item(), [projected], ZONE)).toBe('2026-09-02');
  });
});
