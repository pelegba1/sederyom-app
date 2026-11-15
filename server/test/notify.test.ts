import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type CalendarEvent, type HomeworkItem, type Lesson, type Task, type UserSettings } from '@sederyom/shared';
import { type DayLesson, type PendingChange, isSuppressedByQuietHours, planNotifications, shortDateHe } from '../src/notify/engine.js';
import { composeMorningSummary } from '@sederyom/shared/logic/summaries';
import { buildDayView } from '@sederyom/shared/logic/build';
import type { TimetableLine } from '@sederyom/shared/logic/filters';

const TODAY = '2026-09-01';
const TOMORROW = '2026-09-02';

function ctx(over: Partial<{ settings: UserSettings; nowTime: string; lines: TimetableLine[]; todayLessons: DayLesson[] }> = {}) {
  return { settings: over.settings ?? DEFAULT_SETTINGS, today: TODAY, tomorrow: TOMORROW, nowTime: over.nowTime ?? '19:00', lines: over.lines, todayLessons: over.todayLessons };
}

let nextId = 1;
function change(over: Partial<PendingChange> & { after?: unknown; partition?: string | null }): PendingChange {
  const { after, partition, ...rest } = over;
  return {
    id: nextId++,
    source: 'shahaf',
    kind: 'lesson',
    naturalKey: 'k',
    change: 'updated',
    payload: { before: null, after: after ?? {}, partition: partition ?? null },
    ...rest,
  };
}

function settingsWith(over: Partial<UserSettings>): UserSettings {
  return { ...DEFAULT_SETTINGS, ...over, notifications: { ...DEFAULT_SETTINGS.notifications, ...(over.notifications ?? {}) } };
}

describe('what is not news', () => {
  it('ignores a change to a lesson the owner does not attend', () => {
    const settings = settingsWith({ lessons: { hiddenSubjects: ['כימיה'] } });
    const { planned, discardedIds } = planNotifications(
      [change({ partition: TOMORROW, after: { hourIndex: 3, subject: 'כימיה', teacher: 'לוי', status: 'cancelled' } })],
      ctx({ settings }),
    );
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(1);
  });

  it('still announces the lessons that are mine', () => {
    const settings = settingsWith({ lessons: { hiddenSubjects: ['כימיה'] } });
    const { planned } = planNotifications(
      [change({ partition: TOMORROW, after: { hourIndex: 3, subject: 'פיזיקה', teacher: 'לוי', status: 'cancelled' } })],
      ctx({ settings }),
    );
    expect(planned).toHaveLength(1);
  });

  /**
   * The first poll of a source brings the whole semester at once. Announcing
   * each row would turn a Mashov login into forty pushes.
   */
  it('does not announce a backlog: the first poll of homework is a publication', () => {
    const { planned, discardedIds } = planNotifications(
      [
        change({ kind: 'homework', change: 'created', naturalKey: 'hw1', payload: { before: null, after: { subject: 'אנגלית', text: 'תרגיל 4' }, partition: null, initial: true } }),
        change({ kind: 'exam', change: 'created', naturalKey: 'x1', payload: { before: null, after: { subject: 'מתמטיקה', date: TOMORROW }, partition: null, initial: true } }),
      ],
      ctx(),
    );
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(2);
  });

  it('a lesson that arrives already cancelled on a first poll is still news', () => {
    const { planned } = planNotifications(
      [change({ change: 'created', payload: { before: null, after: { hourIndex: 1, subject: 'אנגלית', status: 'cancelled' }, partition: TOMORROW, initial: true } })],
      ctx(),
    );
    expect(planned[0]!.push.body).toBe('שיעור 1 אנגלית מבוטל');
  });
});

describe('notification planning', () => {
  it('aggregates every change for one day into a single push', () => {
    const { planned } = planNotifications(
      [
        change({ naturalKey: 'a', partition: TOMORROW, after: { hourIndex: 3, subject: 'פיזיקה', status: 'cancelled' } }),
        change({ naturalKey: 'b', partition: TOMORROW, after: { hourIndex: 5, subject: 'היסטוריה', status: 'substitution', substitute: 'כהן' } }),
      ],
      ctx(),
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.type).toBe('schedule_change_tomorrow');
    expect(planned[0]!.push.title).toBe('2 שינויים במערכת של מחר');
    expect(planned[0]!.push.body).toBe('שיעור 3 פיזיקה מבוטל · שיעור 5 היסטוריה · מ״מ: כהן');
    expect(planned[0]!.eventIds).toHaveLength(2);
  });

  it('does not announce a plain lesson appearing for the first time', () => {
    const { planned, discardedIds } = planNotifications(
      [change({ change: 'created', partition: TOMORROW, after: { hourIndex: 1, subject: 'אנגלית', status: 'regular' } })],
      ctx(),
    );
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(1);
  });

  it('does announce a lesson that is published already cancelled', () => {
    const { planned } = planNotifications(
      [change({ change: 'created', partition: TOMORROW, after: { hourIndex: 1, subject: 'אנגלית', status: 'cancelled' } })],
      ctx(),
    );
    expect(planned[0]!.push.body).toBe('שיעור 1 אנגלית מבוטל');
  });

  it('keeps today and tomorrow in separate pushes', () => {
    const { planned } = planNotifications(
      [
        change({ naturalKey: 'a', partition: TODAY, after: { hourIndex: 1, subject: 'אנגלית', status: 'cancelled' } }),
        change({ naturalKey: 'b', partition: TOMORROW, after: { hourIndex: 2, subject: 'פיזיקה', status: 'cancelled' } }),
      ],
      ctx(),
    );
    expect(planned.map((p) => p.type).sort()).toEqual(['schedule_change_today', 'schedule_change_tomorrow']);
  });

  it('holds a change to today until after 06:00', () => {
    const nightly = planNotifications(
      [change({ partition: TODAY, after: { hourIndex: 1, subject: 'אנגלית', status: 'cancelled' } })],
      ctx({ nowTime: '03:20' }),
    );
    expect(nightly.planned).toEqual([]);
    // ...and it is not discarded either — it must still fire later in the morning.
    expect(nightly.discardedIds).toEqual([]);
  });

  it('ignores a change to a day that is neither today nor tomorrow', () => {
    const { planned, discardedIds } = planNotifications(
      [change({ partition: '2026-09-10', after: { subject: 'אנגלית' } })],
      ctx(),
    );
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(1);
  });

  it('respects a disabled toggle', () => {
    const { planned, discardedIds } = planNotifications(
      [change({ kind: 'grade', change: 'created', after: { subject: 'מתמטיקה', value: 94 } })],
      ctx(),
    );
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(1);
  });

  it('sends a grade once the toggle is on', () => {
    const { planned } = planNotifications(
      [change({ kind: 'grade', change: 'created', naturalKey: 'g1', after: { subject: 'מתמטיקה', value: 94, notes: 'מבחן' } })],
      ctx({ settings: settingsWith({ notifications: { ...DEFAULT_SETTINGS.notifications, new_grade: true } }) }),
    );
    expect(planned[0]!.push).toMatchObject({ title: 'ציון חדש · מתמטיקה', body: '94 · מבחן' });
    expect(planned[0]!.dedupeKey).toBe('new_grade|g1');
  });

  it('notifies only on newly created exams, not on edits', () => {
    const { planned } = planNotifications(
      [
        change({ kind: 'exam', change: 'created', naturalKey: 'x1', after: { subject: 'מתמטיקה', date: '2026-09-04', details: 'פרק 3' } }),
        change({ kind: 'exam', change: 'updated', naturalKey: 'x2', after: { subject: 'אנגלית', date: '2026-09-05' } }),
      ],
      ctx(),
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.push.title).toBe('מבחן חדש');
    expect(planned[0]!.push.body).toBe('מתמטיקה · יום ו׳ 4.9 · פרק 3');
  });

  it('dates a new exam the way the app does, not as an ISO date (R-2)', () => {
    const { planned } = planNotifications(
      [change({ kind: 'exam', change: 'created', naturalKey: 'x9', after: { subject: 'מתכונת באנגלית וויקה', date: '2026-11-01', details: null } })],
      ctx(),
    );
    expect(planned[0]!.push.body).toBe('מתכונת באנגלית וויקה · יום א׳ 1.11');
    // The deep link keeps the date it navigates by.
    expect(planned[0]!.push.payload).toMatchObject({ examKey: 'x9', date: '2026-11-01' });
  });

  it('abbreviates every weekday, and leaves what is not a date alone', () => {
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-10-31'].map(shortDateHe)).toEqual([
      'יום א׳ 1.11', 'יום ב׳ 2.11', 'יום ג׳ 3.11', 'יום ד׳ 4.11', 'יום ה׳ 5.11', 'יום ו׳ 6.11', 'שבת 31.10',
    ]);
    expect(shortDateHe('')).toBe('');
    expect(shortDateHe('בקרוב')).toBe('בקרוב');
    expect(shortDateHe('2026-02-30')).toBe('2026-02-30');
  });

  it('pauses school sources in vacation mode but not Google', () => {
    const settings = settingsWith({ vacationMode: true });
    const { planned, discardedIds } = planNotifications(
      [
        change({ source: 'shahaf', partition: TOMORROW, after: { subject: 'אנגלית', status: 'cancelled' } }),
        change({ source: 'mashov', kind: 'homework', change: 'created', naturalKey: 'h1', after: { subject: 'אנגלית', text: 'תרגיל 4' } }),
      ],
      ctx({ settings }),
    );
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(2);
  });

  it('dedupe key changes when a different change lands on the same day', () => {
    const first = planNotifications([change({ naturalKey: 'a', partition: TOMORROW, after: { subject: 'א', status: 'cancelled' } })], ctx());
    const second = planNotifications([change({ naturalKey: 'b', partition: TOMORROW, after: { subject: 'ב', status: 'cancelled' } })], ctx());
    expect(first.planned[0]!.dedupeKey).not.toBe(second.planned[0]!.dedupeKey);
  });

  it('dedupe key changes when the same lesson changes again on the same day', () => {
    // 10:00 a substitute, 12:00 the lesson is cancelled: each its own batch, each its own push.
    const substitute = change({ naturalKey: 'k', change: 'updated', partition: TOMORROW, after: { subject: 'א', status: 'substitution' } });
    const cancelled = change({ naturalKey: 'k', change: 'updated', partition: TOMORROW, after: { subject: 'א', status: 'cancelled' } });
    const first = planNotifications([substitute], ctx()).planned[0]!.dedupeKey;
    expect(planNotifications([cancelled], ctx()).planned[0]!.dedupeKey).not.toBe(first);
    // The same event planned again (a device still waiting, a send retried) keeps its key.
    expect(planNotifications([substitute], ctx()).planned[0]!.dedupeKey).toBe(first);
  });

  it('dedupe key is stable for the same batch regardless of order', () => {
    const a = change({ naturalKey: 'a', partition: TOMORROW, after: { subject: 'א', status: 'cancelled' } });
    const b = change({ naturalKey: 'b', partition: TOMORROW, after: { subject: 'ב', status: 'cancelled' } });
    const forward = planNotifications([a, b], ctx()).planned[0]!.dedupeKey;
    const backward = planNotifications([b, a], ctx()).planned[0]!.dedupeKey;
    expect(forward).toBe(backward);
  });

  it('describes a lesson that dropped off the timetable', () => {
    const { planned } = planNotifications(
      [
        {
          id: 99, source: 'shahaf', kind: 'lesson', naturalKey: 'z', change: 'deleted',
          payload: { before: { hourIndex: 7, subject: 'ספורט' }, after: null, partition: TOMORROW },
        },
      ],
      ctx(),
    );
    expect(planned[0]!.push.body).toBe('שיעור 7 ספורט ירד מהמערכת');
  });

  describe('a lesson whose key changed between two reads (its teacher or room re-written)', () => {
    const at3 = (teacher: string | null, status: string, subject = 'מפגש לקראת מסיבת הסיום') => ({ date: TOMORROW, hourIndex: 3, subject, teacher, status });
    const gone = (lesson: ReturnType<typeof at3>) =>
      change({ change: 'deleted', naturalKey: `${TOMORROW}|3|${lesson.subject}|${lesson.teacher ?? ''}`, partition: TOMORROW, payload: { before: lesson, after: null, partition: TOMORROW } });
    const added = (lesson: ReturnType<typeof at3>) =>
      change({ change: 'created', naturalKey: `${TOMORROW}|3|${lesson.subject}|${lesson.teacher ?? ''}`, partition: TOMORROW, after: lesson });

    it('is not news when nothing a student reads changed', () => {
      // Live 2.11.2026: "מפגש לקראת מסיבת הסיום" gained ", ספריה", which the parser reads as the teacher.
      const events = [added(at3('ספריה', 'event')), gone(at3(null, 'event'))];
      const { planned, discardedIds } = planNotifications(events, ctx());
      expect(planned).toEqual([]);
      expect(discardedIds.sort()).toEqual(events.map((e) => e.id).sort());
    });

    it('never says a regular lesson dropped off when only its teacher was re-spelled', () => {
      const events = [gone(at3('כהן רינה', 'regular', 'מתמטיקה')), added(at3('כהן רינה ד״ר', 'regular', 'מתמטיקה'))];
      const { planned } = planNotifications(events, ctx());
      expect(planned).toEqual([]);
    });

    it('tells what did change, once', () => {
      const events = [gone(at3('כהן', 'regular', 'מתמטיקה')), added(at3('כהן רינה', 'cancelled', 'מתמטיקה'))];
      const { planned } = planNotifications(events, ctx());
      expect(planned).toHaveLength(1);
      expect(planned[0]!.push.title).toBe('שינוי במערכת של מחר');
      expect(planned[0]!.push.body).toBe('שיעור 3 מתמטיקה מבוטל');
      expect(planned[0]!.eventIds.sort()).toEqual(events.map((e) => e.id).sort());
    });

    it('is not news when the site glued the teacher onto the subject, or split it off again', () => {
      // Live 4.11.2026: the grid dropped the <br/> before the teacher, and every lesson read as
      // "היסטוריה (יב2)אוחנה אביגיל" with no teacher; the parser fix reads them apart again.
      const glued = at3(null, 'regular', 'היסטוריה (יב2)אוחנה אביגיל');
      const split = at3('אוחנה אביגיל', 'regular', 'היסטוריה (יב2)');
      for (const events of [[gone(split), added(glued)], [gone(glued), added(split)]]) {
        const { planned, discardedIds } = planNotifications(events, ctx());
        expect(planned).toEqual([]);
        expect(discardedIds.sort()).toEqual(events.map((e) => e.id).sort());
      }
    });

    it('is not news when an arrow change misread as a lesson name is read right', () => {
      // Live 5.11.2026: "נקש מלכה <- פרנקו יונתן חדר אמנות מלכה" was a lesson of that name.
      const misread = at3(null, 'substitution', 'נקש מלכה <- פרנקו יונתן חדר אמנות מלכה');
      const right = { ...at3('נקש מלכה', 'substitution', 'אמנות (חדר אמנות מלכה)'), substitute: 'פרנקו יונתן' };
      const room = at3(null, 'substitution', 'אשכול יהודית -> חדר: מעבדת מחשבים 4');
      const roomRight = { ...at3('אשכול יהודית', 'regular', 'מבוא לאינטרנט (מעבדת מחשבים 1)'), room: 'מעבדת מחשבים 4' };
      for (const events of [[gone(misread), added(right)], [gone(room), added(roomRight)]]) {
        const { planned, discardedIds } = planNotifications(events, ctx());
        expect(planned).toEqual([]);
        expect(discardedIds.sort()).toEqual(events.map((e) => e.id).sort());
      }
    });
  });

  it('says that a school event was added, not only its name', () => {
    const { planned } = planNotifications(
      [change({ change: 'created', partition: TOMORROW, after: { hourIndex: 3, subject: 'מפגש לקראת מסיבת הסיום', status: 'event' } })],
      ctx(),
    );
    expect(planned[0]!.push.body).toBe('שיעור 3 מפגש לקראת מסיבת הסיום נוסף למערכת');
  });
});

describe('after the last lesson of the day', () => {
  const until = (endTime: string | null, subject = 'אנגלית', status: DayLesson['status'] = 'regular'): DayLesson => ({ subject, teacher: 'לוי', status, endTime });
  const DAY = [until('10:00'), until('13:00', 'פיזיקה')];
  /** The site taking a lesson off the grid. */
  const removed = (before: object = {}, partition: string = TODAY) =>
    change({ change: 'deleted', naturalKey: 'gone', payload: { before: { hourIndex: 3, subject: 'ספורט', teacher: null, status: 'substitution', endTime: '10:00', ...before }, after: null, partition } });

  it('drops a change to today for good once the last lesson has ended', () => {
    const event = removed();
    const { planned, discardedIds } = planNotifications([event], ctx({ nowTime: '14:00', todayLessons: DAY }));
    expect(planned).toEqual([]);
    // Dropped, not held for later like a change before 06:00: it will never become news.
    expect(discardedIds).toEqual([event.id]);
  });

  it('still tells of a change while a lesson is left', () => {
    const { planned } = planNotifications([removed()], ctx({ nowTime: '12:30', todayLessons: DAY }));
    expect(planned.map((p) => p.type)).toEqual(['schedule_change_today']);
  });

  it('counts the minute the last lesson ends as over', () => {
    expect(planNotifications([removed()], ctx({ nowTime: '12:59', todayLessons: DAY })).planned).toHaveLength(1);
    expect(planNotifications([removed()], ctx({ nowTime: '13:00', todayLessons: DAY })).planned).toEqual([]);
  });

  it('compares a site time written without its leading zero as a time', () => {
    expect(planNotifications([removed({ endTime: '9:00' })], ctx({ nowTime: '10:00', todayLessons: [until('9:30')] })).planned).toEqual([]);
  });

  it("leaves tomorrow's changes alone", () => {
    const { planned } = planNotifications([removed({}, TOMORROW)], ctx({ nowTime: '14:00', todayLessons: DAY }));
    expect(planned.map((p) => p.type)).toEqual(['schedule_change_tomorrow']);
  });

  it('still tells when nothing says when the day ends', () => {
    expect(planNotifications([removed()], ctx({ nowTime: '14:00' })).planned).toHaveLength(1);
    expect(planNotifications([removed({ endTime: null })], ctx({ nowTime: '14:00', todayLessons: [] })).planned).toHaveLength(1);
  });

  it('still tells when one of the lessons has no end time', () => {
    expect(planNotifications([removed()], ctx({ nowTime: '14:00', todayLessons: [...DAY, until(null)] })).planned).toHaveLength(1);
  });

  it('does not let a cancelled lesson keep the day open', () => {
    expect(planNotifications([removed()], ctx({ nowTime: '14:00', todayLessons: [...DAY, until('14:30', 'היסטוריה', 'cancelled')] })).planned).toEqual([]);
  });

  it('tells of a lesson taken off before it began, though it was the last one left', () => {
    const { planned } = planNotifications([removed({ status: 'regular', endTime: '13:45' })], ctx({ nowTime: '13:10', todayLessons: DAY }));
    expect(planned).toHaveLength(1);
  });

  it('tells of a lesson cancelled before it began', () => {
    const lesson = { hourIndex: 7, subject: 'היסטוריה', teacher: 'לוי', endTime: '13:45' };
    const event = change({ naturalKey: 'last', payload: { before: { ...lesson, status: 'regular' }, after: { ...lesson, status: 'cancelled' }, partition: TODAY } });
    const { planned } = planNotifications([event], ctx({ nowTime: '13:10', todayLessons: [...DAY, until('13:45', 'היסטוריה', 'cancelled')] }));
    expect(planned.map((p) => p.push.body)).toEqual(['שיעור 7 היסטוריה מבוטל']);
  });

  it('drops a whole day cleared off the site at once, with no lesson left to read', () => {
    const events = [removed({ endTime: '10:00' }), removed({ endTime: '13:00', hourIndex: 6 })];
    const { planned, discardedIds } = planNotifications(events, ctx({ nowTime: '14:00', todayLessons: [] }));
    expect(planned).toEqual([]);
    expect(discardedIds).toHaveLength(2);
  });

  it('drops a cancellation cleared off the site after the last lesson that took place', () => {
    const { planned } = planNotifications([removed({ status: 'cancelled', endTime: '14:30' })], ctx({ nowTime: '13:50', todayLessons: DAY }));
    expect(planned).toEqual([]);
  });

  it("goes by the student's own day: a line they do not attend does not keep it open", () => {
    const settings = settingsWith({ lessons: { hiddenSubjects: ['כימיה'] } });
    const todayLessons = [...DAY, until('15:00', 'כימיה')];
    expect(planNotifications([removed()], ctx({ settings, nowTime: '14:00', todayLessons })).planned).toEqual([]);
    expect(planNotifications([removed()], ctx({ nowTime: '14:00', todayLessons })).planned).toHaveLength(1);
  });
});

describe('quiet hours', () => {
  const settings = DEFAULT_SETTINGS; // 23:00 → 06:30

  it('suppresses inside the wrapped window', () => {
    expect(isSuppressedByQuietHours('new_exam', settings, '23:30')).toBe(true);
    expect(isSuppressedByQuietHours('new_exam', settings, '02:00')).toBe(true);
    expect(isSuppressedByQuietHours('new_exam', settings, '06:29')).toBe(true);
  });

  it('allows outside it', () => {
    expect(isSuppressedByQuietHours('new_exam', settings, '06:30')).toBe(false);
    expect(isSuppressedByQuietHours('new_exam', settings, '22:59')).toBe(false);
  });

  it('exempts the morning summary', () => {
    expect(isSuppressedByQuietHours('morning_summary', settings, '02:00')).toBe(false);
  });

  it('does nothing when quiet hours are off', () => {
    expect(isSuppressedByQuietHours('new_exam', settingsWith({ quietHours: { enabled: false, from: '23:00', to: '06:30' } }), '02:00')).toBe(false);
  });
});

describe('subject names in pushes', () => {
  it('names a lesson change by the subject, without its group or level', () => {
    const { planned } = planNotifications(
      [
        change({ naturalKey: 'a', partition: TOMORROW, after: { hourIndex: 3, subject: 'פיזיקה מורחב (מעבדת פיסיקה)', status: 'cancelled' } }),
        change({ naturalKey: 'b', partition: TOMORROW, after: { hourIndex: 4, subject: 'מתמטיקה 5 יח"ל (יב2)', status: 'moved' } }),
        change({ naturalKey: 'c', partition: TOMORROW, after: { hourIndex: 5, subject: 'תנ"ך (יא1)', status: 'cancelled' } }),
      ],
      ctx(),
    );
    expect(planned[0]!.push.body).toBe('שיעור 3 פיזיקה מבוטל · שיעור 4 מתמטיקה הועבר · שיעור 5 תנ״ך מבוטל');
  });

  it('names new homework and a new grade by the subject (Itai: "מתמטיקה 5 יח״ל (יב2)")', () => {
    const { planned } = planNotifications(
      [
        change({ source: 'mashov', kind: 'homework', change: 'created', naturalKey: 'h1', after: { subject: 'מתמטיקה 5 יח״ל (יב2)', text: 'שאלות 1–5' } }),
        change({ source: 'mashov', kind: 'grade', change: 'created', naturalKey: 'g1', after: { subject: 'אנגלית 5 יח"ל (יב2)', value: 88 } }),
        change({ source: 'mashov', kind: 'grade', change: 'created', naturalKey: 'g2', after: { value: 70 } }),
      ],
      ctx({ settings: settingsWith({ notifications: { ...DEFAULT_SETTINGS.notifications, new_grade: true } }) }),
    );
    expect(planned.map((p) => p.push.title)).toEqual(['שיעורי בית · מתמטיקה', 'ציון חדש · אנגלית', 'ציון חדש']);
  });
});

/** The student's own names (design 2026-11-05): a push says "פיזיקה" where the school wrote "גוש ב׳". */
describe("own names in pushes", () => {
  const BLOCK = 'גוש ב׳ (יב)';
  const BLOCK_KEY = "גוש ב' (יב)";
  const named = (subjectNames: Record<string, string>, hiddenSubjects: string[] = []) =>
    settingsWith({ lessons: { hiddenSubjects, subjectNames } });
  const cancelledBlock = (hourIndex = 3) =>
    change({ naturalKey: `b${hourIndex}`, partition: TOMORROW, after: { hourIndex, subject: BLOCK, teacher: 'לוי', status: 'cancelled' } });
  const examOf = (subject: string) =>
    change({ kind: 'exam', change: 'created', naturalKey: 'x1', after: { subject, date: '2026-09-04', details: 'פרק 3' } });

  it('names a cancelled lesson the way the student named its line', () => {
    const { planned } = planNotifications([cancelledBlock()], ctx({ settings: named({ [BLOCK_KEY]: 'פיזיקה' }) }));
    expect(planned[0]!.push.body).toBe('שיעור 3 פיזיקה מבוטל');
  });

  it('names a lesson that left the timetable, a substitute, a move and an event too', () => {
    const settings = named({ [BLOCK_KEY]: 'פיזיקה' });
    const lesson = { subject: BLOCK, teacher: 'לוי' };
    const body = (event: PendingChange) => planNotifications([event], ctx({ settings })).planned[0]!.push.body;
    expect(body(change({ change: 'deleted', partition: TOMORROW, payload: { before: { hourIndex: 3, ...lesson, status: 'regular' }, after: null, partition: TOMORROW } }))).toBe('שיעור 3 פיזיקה ירד מהמערכת');
    expect(body(change({ partition: TOMORROW, after: { hourIndex: 3, ...lesson, status: 'substitution', substitute: 'כהן' } }))).toBe('שיעור 3 פיזיקה · מ״מ: כהן');
    expect(body(change({ partition: TOMORROW, after: { hourIndex: 3, ...lesson, status: 'moved' } }))).toBe('שיעור 3 פיזיקה הועבר');
    expect(body(change({ change: 'created', partition: TOMORROW, after: { hourIndex: 3, ...lesson, status: 'event' } }))).toBe('שיעור 3 פיזיקה נוסף למערכת');
  });

  it("prints an own name as typed: nothing is stripped from it", () => {
    const settings = named({ [BLOCK_KEY]: 'פיזיקה (מורחב) 5 יח״ל' });
    const { planned } = planNotifications([cancelledBlock()], ctx({ settings }));
    expect(planned[0]!.push.body).toBe('שיעור 3 פיזיקה (מורחב) 5 יח״ל מבוטל');
  });

  it('names a block exam by its block, from the class lines', () => {
    const settings = named({ [BLOCK_KEY]: 'פיזיקה' });
    const { planned } = planNotifications([examOf("מבחן גוש ב'")], ctx({ settings, lines: [{ subject: BLOCK, teacher: 'לוי' }] }));
    expect(planned[0]!.push.title).toBe('מבחן חדש');
    expect(planned[0]!.push.body).toBe('מבחן פיזיקה · יום ו׳ 4.9 · פרק 3');
    // The tap still finds the exam by the school's key.
    expect(planned[0]!.push.payload).toMatchObject({ examKey: 'x1', date: '2026-09-04' });
  });

  it("reads the lines the student keeps: a hidden line's name is not an exam's", () => {
    const lines: TimetableLine[] = [{ subject: BLOCK, teacher: 'לוי' }, { subject: 'גוש ב׳ (יא)', teacher: 'כהן' }];
    const both = { [BLOCK_KEY]: 'פיזיקה', "גוש ב' (יא)": 'כימיה' };
    // Two kept lines of the block, two names: no name.
    expect(planNotifications([examOf("מבחן גוש ב'")], ctx({ settings: named(both), lines })).planned[0]!.push.body).toBe("מבחן גוש ב' · יום ו׳ 4.9 · פרק 3");
    // One of them hidden: the other's name.
    expect(planNotifications([examOf("מבחן גוש ב'")], ctx({ settings: named(both, ['גוש ב׳ (יא)']), lines })).planned[0]!.push.body).toBe('מבחן פיזיקה · יום ו׳ 4.9 · פרק 3');
  });

  it('names new homework and a new grade by the subject name, as Mashov items', () => {
    const settings = settingsWith({
      lessons: { hiddenSubjects: [], subjectNames: { 'subject:מתמטיקה': 'חשבון (5)' } },
      notifications: { ...DEFAULT_SETTINGS.notifications, new_grade: true },
    });
    const { planned } = planNotifications(
      [
        change({ source: 'mashov', kind: 'homework', change: 'created', naturalKey: 'h1', after: { subject: 'מתמטיקה 5 יח״ל (יב2)', text: 'שאלות 1–5' } }),
        change({ source: 'mashov', kind: 'grade', change: 'created', naturalKey: 'g1', after: { subject: 'מתמטיקה 5 יח״ל (יב2)', value: 88 } }),
        change({ source: 'mashov', kind: 'grade', change: 'created', naturalKey: 'g2', after: { subject: 'אנגלית', value: 70 } }),
      ],
      ctx({ settings }),
    );
    // Verbatim: "(5)" is not a remark to strip. A subject with no name keeps today's text.
    expect(planned.map((p) => p.push.title)).toEqual(['שיעורי בית · חשבון (5)', 'ציון חדש · חשבון (5)', 'ציון חדש · אנגלית']);
  });

  it('leaves everything as it is today when there are no names, or none that apply', () => {
    const events = [
      cancelledBlock(),
      change({ naturalKey: 'p', partition: TOMORROW, after: { hourIndex: 4, subject: 'פיזיקה מורחב (מעבדת פיסיקה)', status: 'cancelled' } }),
      examOf("מבחן גוש ב'"),
      change({ source: 'mashov', kind: 'homework', change: 'created', naturalKey: 'h1', after: { subject: 'מתמטיקה 5 יח״ל (יב2)', text: 'שאלות 1–5' } }),
    ];
    const lines = [{ subject: BLOCK, teacher: 'לוי' }];
    const today = planNotifications(events, ctx({ lines }));
    // Items come in the order they were read, the day's lesson changes last, as one push.
    expect(today.planned.map((p) => p.push.body)).toEqual([
      "מבחן גוש ב' · יום ו׳ 4.9 · פרק 3",
      'שאלות 1–5',
      'שיעור 3 גוש ב׳ מבוטל · שיעור 4 פיזיקה מבוטל',
    ]);
    expect(today.planned[1]!.push.title).toBe('שיעורי בית · מתמטיקה');
    expect(today.planned[2]!.push.title).toBe('2 שינויים במערכת של מחר');
    const bodies = (settings: UserSettings) => planNotifications(events, ctx({ settings, lines }));
    // The same settings with an empty map, with the map missing, and with a name for a line that is not here.
    expect(bodies(named({}))).toEqual(today);
    expect(bodies({ ...DEFAULT_SETTINGS, lessons: { hiddenSubjects: [] } })).toEqual(today);
    expect(bodies(named({ 'אזרחות': 'זכויות' }))).toEqual(today);
  });

  it('keeps the dedupe keys and the events a push accounts for on the school\'s names', () => {
    const plain = planNotifications([cancelledBlock()], ctx());
    const withName = planNotifications([cancelledBlock()], ctx({ settings: named({ [BLOCK_KEY]: 'פיזיקה' }) }));
    expect(withName.planned[0]!.dedupeKey.replace(/:\d+/g, ':#')).toBe(plain.planned[0]!.dedupeKey.replace(/:\d+/g, ':#'));
    expect(withName.planned[0]!.eventIds).toHaveLength(1);
  });
});

describe('morning summary', () => {
  type DayInput = Parameters<typeof buildDayView>[0];
  const lesson = (hourIndex: number, startTime: string | null, endTime: string | null, subject: string, status: Lesson['status'] = 'regular'): Lesson => ({
    date: TODAY, hourIndex, startTime, endTime, subject, teacher: null, room: null, status, substitute: null, note: null, source: 'shahaf', changeSeenAt: null,
  });
  const hw = (naturalKey: string, subject: string, done = false): HomeworkItem => ({
    naturalKey, dueDate: TODAY, subject, text: 'תרגיל', linkedTaskId: null, done,
  });
  const task: Task = { id: 't1', listId: 'l', listTitle: null, title: 'עבודה', notes: null, due: TODAY, completed: false, updated: null, linkedHomeworkKey: null };
  const calendarEvent = (id: string, summary: string, calendarId = 'c'): CalendarEvent => ({
    id, calendarId, calendarName: null, seriesId: null, summary, location: null,
    start: '2026-09-01T00:00:00.000+03:00', end: '2026-09-02T00:00:00.000+03:00', allDay: true,
  });
  const day = (over: Partial<DayInput>) => buildDayView({
    date: TODAY, zone: 'Asia/Jerusalem', now: new Date('2026-09-01T07:00:00+03:00'), vacationMode: false,
    lessons: [], events: [], tasks: [], exams: [], schoolEvents: [], ...over,
  });
  const summary = (over: Partial<DayInput>) => {
    const push = composeMorningSummary(day(over));
    return { title: push.title, lines: push.body === '' ? [] : push.body.split('\n') };
  };

  /** The persona day of 8.10: three physics lessons kept, four cancelled before 07:00. */
  const physicsMorning = [
    lesson(1, '08:00', '08:45', 'פיזיקה מורחב (מעבדת פיסיקה)'),
    lesson(2, '08:45', '09:30', 'פיזיקה מורחב (מעבדת פיסיקה)'),
    lesson(3, '09:45', '10:30', 'פיזיקה מורחב (מעבדת פיסיקה)'),
    lesson(4, '10:30', '11:15', 'אזרחות', 'cancelled'),
    lesson(5, '11:30', '12:15', 'אזרחות', 'cancelled'),
    lesson(6, '12:15', '13:00', 'היסטוריה', 'cancelled'),
    lesson(7, '13:25', '14:10', 'היסטוריה', 'cancelled'),
  ];

  it('puts the news in the title, not the Hebrew date (W4-11)', () => {
    const push = composeMorningSummary(day({
      lessons: physicsMorning,
      homework: [hw('h1', 'פיזיקה'), hw('h2', 'מתמטיקה', true)],
      events: [calendarEvent('e', 'משמרת בגלידריה')],
    }));
    expect(push.title).toBe('הלימודים נגמרים ב־10:30 · 4 בוטלו');
    expect(push.title).not.toContain(day({}).hebrewDate);
    // The span of what takes place (not 08:00–14:10), and physics once, without its group.
    expect(push.body.split('\n')).toEqual(['08:00–10:30 · פיזיקה', 'להגשה היום: פיזיקה', 'ביומן: משמרת בגלידריה']);
    expect(push.payload).toMatchObject({ type: 'morning_summary', deepLink: 'today', date: TODAY });
  });

  it('without cancellations, the title is the span and the count', () => {
    expect(summary({
      lessons: [lesson(1, '08:00', '08:45', 'אנגלית'), lesson(2, '08:45', '09:30', 'פיזיקה', 'substitution')],
      tasks: [task],
      exams: [{ naturalKey: 'x', date: TOMORROW, subject: 'מבחן במתמטיקה', details: null, source: 'school_site' }],
    })).toEqual({ title: '08:00–09:30 · 2 שיעורים', lines: ['אנגלית, פיזיקה (מ״מ)', 'מבחן מחר: מתמטיקה', 'משימה אחת להיום'] });
    expect(summary({ lessons: [lesson(1, '08:00', '08:45', 'אנגלית')] }).title).toBe('08:00–08:45 · שיעור אחד');
  });

  it('says when the day now starts late, or both ends move', () => {
    const late = summary({ lessons: [lesson(1, '08:00', '08:45', 'אזרחות', 'cancelled'), ...physicsMorning.slice(1, 3)] });
    expect(late).toEqual({ title: 'הלימודים מתחילים ב־08:45 · שיעור אחד בוטל', lines: ['08:45–10:30 · פיזיקה'] });
    const both = summary({ lessons: [lesson(1, '08:00', '08:45', 'אזרחות', 'cancelled'), ...physicsMorning.slice(1)] });
    expect(both).toEqual({ title: '08:45–10:30 · 5 בוטלו', lines: ['פיזיקה'] });
  });

  it('keeps the whole span when only a lesson in the middle is cancelled', () => {
    expect(summary({ lessons: [physicsMorning[0]!, lesson(2, '08:45', '09:30', 'אזרחות', 'cancelled'), physicsMorning[2]!] }))
      .toEqual({ title: '08:00–10:30 · שיעור אחד בוטל', lines: ['פיזיקה'] });
  });

  it('names each subject once, without level or group', () => {
    expect(summary({
      lessons: [
        lesson(1, '08:00', '08:45', 'פיזיקה מורחב (יב3)'),
        lesson(2, '08:45', '09:30', 'פיזיקה מורחב (מעבדת פיסיקה)'),
        lesson(3, '09:45', '10:30', 'אנגלית 5 יח"ל (יב2)'),
        lesson(4, '10:30', '11:15', 'אנגלית 5 יח"ל'),
        lesson(5, '11:30', '12:15', 'תנ"ך (יא1)'),
        lesson(6, '12:15', '13:00', 'ספורט'),
      ],
    })).toEqual({ title: '08:00–13:00 · 6 שיעורים', lines: ['פיזיקה, אנגלית, תנ״ך, ספורט'] });
  });

  describe('two subjects shown under one name', () => {
    /** The block, named "פיזיקה" by the student on the phone. */
    const named = (l: Lesson): Lesson => ({ ...l, subject: 'פיזיקה', originalSubject: 'גוש ב׳ (יב)' });
    const block = (hourIndex: number, start: string, end: string, status: Lesson['status'] = 'regular') =>
      lesson(hourIndex, start, end, 'גוש ב׳ (יב)', status);

    it('are named once', () => {
      expect(summary({
        lessons: [named(block(1, '08:00', '08:45')), lesson(2, '08:45', '09:30', 'פיזיקה מורחב (מעבדת פיסיקה)'), lesson(3, '09:45', '10:30', 'אנגלית')],
      }).lines).toEqual(['פיזיקה, אנגלית']);
    });

    it('with the change of the first of their lessons that changed, as one subject\'s lessons are', () => {
      const lessons = [
        named(block(1, '08:00', '08:45')),
        lesson(2, '08:45', '09:30', 'פיזיקה מורחב', 'substitution'),
        named(block(3, '09:45', '10:30', 'moved')),
      ];
      expect(summary({ lessons }).lines).toEqual(['פיזיקה (מ״מ)']);
      expect(summary({ lessons: [lessons[0]!, { ...lessons[1]!, status: 'regular' }, lessons[2]!] }).lines).toEqual(['פיזיקה (הועבר)']);
    });

    it('without names, the line is what it always was', () => {
      expect(summary({
        lessons: [block(1, '08:00', '08:45'), lesson(2, '08:45', '09:30', 'פיזיקה מורחב', 'substitution'), block(3, '09:45', '10:30', 'moved')],
      }).lines).toEqual(['גוש ב׳ (הועבר), פיזיקה (מ״מ)']);
    });
  });

  it('lists the open homework due today, each subject once', () => {
    expect(summary({
      lessons: [lesson(1, '08:00', '08:45', 'אנגלית')],
      homework: [hw('a', 'אנגלית 5 יח"ל (יב2)'), hw('b', 'אנגלית'), hw('c', 'מתמטיקה 5 יח״ל (יב2)'), hw('d', 'היסטוריה', true)],
    }).lines).toEqual(['אנגלית', 'להגשה היום: אנגלית, מתמטיקה']);
    expect(summary({
      homework: ['אנגלית', 'מתמטיקה', 'היסטוריה', 'אזרחות', 'ספרות'].map((s) => hw(s, s)),
      // In the day's order: by subject.
    })).toEqual({ title: 'אין שיעורים היום', lines: ['להגשה היום: אזרחות, אנגלית, היסטוריה ועוד 2'] });
  });

  it('names a calendar event once, with how many times it appears (W4-11)', () => {
    expect(summary({
      lessons: [lesson(1, '08:00', '08:45', 'אנגלית')],
      events: [calendarEvent('e1', 'משמרת בגלידריה'), calendarEvent('e2', 'משמרת  בגלידריה', 'other')],
    }).lines).toEqual(['אנגלית', 'ביומן: משמרת בגלידריה ×2']);
    expect(summary({
      lessons: [lesson(1, '08:00', '08:45', 'אנגלית')],
      events: [calendarEvent('e1', 'חוג גיטרה'), calendarEvent('e2', 'משמרת'), calendarEvent('e3', 'משמרת'), calendarEvent('e4', 'רופא')],
    }).lines).toEqual(['אנגלית', 'ביומן: חוג גיטרה, משמרת ×2 ועוד 1']);
  });

  it('never runs past three lines', () => {
    const { lines } = summary({
      lessons: physicsMorning,
      homework: [hw('h1', 'פיזיקה')],
      tasks: [task, { ...task, id: 't2' }],
      exams: [{ naturalKey: 'x', date: TODAY, subject: 'מבחן באנגלית', details: null, source: 'school_site' }],
    });
    expect(lines).toEqual(['08:00–10:30 · פיזיקה', 'להגשה היום: פיזיקה', 'מבחן היום: אנגלית']);
    expect(summary({ lessons: [lesson(1, '08:00', '08:45', 'אנגלית')], tasks: [task, { ...task, id: 't2' }] }).lines)
      .toEqual(['אנגלית', '2 משימות להיום']);
  });

  it('says so when every lesson was cancelled', () => {
    expect(summary({ lessons: physicsMorning.slice(3) })).toEqual({ title: 'אין שיעורים היום · 4 בוטלו', lines: [] });
    expect(summary({ lessons: [lesson(1, '08:00', '08:45', 'אנגלית'), lesson(2, '08:45', '09:30', 'פיזיקה', 'cancelled')] }))
      .toEqual({ title: 'הלימודים נגמרים ב־08:45 · שיעור אחד בוטל', lines: ['08:00–08:45 · אנגלית'] });
  });

  it('counts lessons when the timetable has no times', () => {
    expect(summary({ lessons: [lesson(1, null, null, 'אנגלית'), lesson(2, null, null, 'פיזיקה')] }))
      .toEqual({ title: '2 שיעורים', lines: ['אנגלית, פיזיקה'] });
    expect(summary({ lessons: [lesson(1, null, null, 'אנגלית'), lesson(2, null, null, 'פיזיקה'), lesson(3, null, null, 'היסטוריה', 'cancelled')] }))
      .toEqual({ title: '2 שיעורים · שיעור אחד בוטל', lines: ['אנגלית, פיזיקה'] });
  });

  it('says so plainly when there is nothing on', () => {
    expect(summary({})).toEqual({ title: 'אין שיעורים היום', lines: [] });
  });
});
