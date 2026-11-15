/**
 * The next lesson on the lock screen (ideas פ1, app/src/notify/nextLesson.ts):
 * which notes a day gets, when each goes out and until when it stays, what it
 * says, and which places are cancelled.
 */
import { describe, expect, it } from 'vitest';
import type { ClassFeed, ClassLesson, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { DateTime } from 'luxon';
import type { LocalSources } from '../../app/src/local/days';
import {
  NEXT_LESSON_DAYS, NEXT_LESSON_PLACES, nextLessonId, planNextLessons, staleNextLessonIds, type NextLessonAction,
} from '../../app/src/notify/nextLesson';

const ZONE = 'Asia/Jerusalem';
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toJSDate();
const plain = (text: string) => text.replace(/[⁠⁦-⁩]/g, '');
// Wednesday 7.10.2026, 07:40: Wednesday's first note is past, Thursday's are all ahead.
const NOW = at('2026-10-07', '07:40');

const lesson = (date: string, hourIndex: number, startTime: string, endTime: string, subject: string, over: Partial<ClassLesson> = {}): ClassLesson => ({
  date, hourIndex, startTime, endTime, subject, teacher: null, room: null, status: 'regular', substitute: null, note: null, ...over,
});

const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: NOW.toISOString(),
  freshness: null,
  lessons: [
    lesson('2026-10-07', 1, '08:00', '08:45', 'אנגלית'),
    lesson('2026-10-07', 2, '08:45', '09:30', 'פיזיקה'),
    lesson('2026-10-08', 1, '08:00', '08:45', 'אנגלית 5 יח"ל (יב2)'),
    lesson('2026-10-08', 2, '08:45', '09:30', 'פיזיקה', { status: 'substitution', substitute: 'דנה כהן' }),
    lesson('2026-10-08', 3, '09:45', '10:30', 'היסטוריה', { status: 'cancelled' }),
    lesson('2026-10-08', 4, '10:30', '11:15', 'מתמטיקה', { room: '214' }),
  ],
  changes: [],
  exams: [],
  events: [],
  messages: [],
};

function sources(over: Partial<UserSettings> = {}): LocalSources {
  return {
    feed: FEED, mashov: [], bagrut: [], google: [],
    settings: {
      ...DEFAULT_SETTINGS, classId: '7', className: 'יב2', ...over,
      notifications: { ...DEFAULT_SETTINGS.notifications, next_lesson: true, ...over.notifications },
    },
    zone: ZONE, now: NOW,
  };
}

const placeOf = (plan: NextLessonAction[], date: string, place: number) => plan.find((a) => a.identifier === nextLessonId(date, place))!;

describe('a day\'s notes', () => {
  const plan = planNextLessons(sources(), NOW, ZONE);

  it('cover every place of today and the next days', () => {
    expect(plan).toHaveLength(NEXT_LESSON_DAYS * NEXT_LESSON_PLACES);
  });

  it('go out half an hour before the first lesson, then as each lesson before starts, each until its own lesson starts', () => {
    const notes = [0, 1, 2].map((p) => placeOf(plan, '2026-10-08', p));
    expect(notes.map((n) => n.action)).toEqual(['schedule', 'schedule', 'schedule']);
    expect(notes.map((n) => n.at)).toEqual([at('2026-10-08', '07:30'), at('2026-10-08', '08:00'), at('2026-10-08', '08:45')]);
    expect(notes.map((n) => n.until)).toEqual([at('2026-10-08', '08:00'), at('2026-10-08', '08:45'), at('2026-10-08', '10:30')].map((d) => d.getTime()));
  });

  it('say where to go, with the room, the time and the substitute; a cancelled lesson is skipped', () => {
    const says = [0, 1, 2].map((p) => placeOf(plan, '2026-10-08', p).note!).map((n) => [plain(n.title), plain(n.body)]);
    expect(says).toEqual([
      ['הבא: אנגלית', '08:00–08:45'],
      ['הבא: פיזיקה', '08:45–09:30, מ״מ דנה כהן'],
      ['הבא: מתמטיקה, חדר 214', '10:30–11:15'],
    ]);
    expect(placeOf(plan, '2026-10-08', 0).note!.data).toEqual({ type: 'next_lesson', deepLink: 'today', date: '2026-10-08', refreshWidget: true });
  });

  it('cancel the places a day does not fill, and leave a note whose time came alone', () => {
    expect(placeOf(plan, '2026-10-08', 3).action).toBe('cancel');
    expect(placeOf(plan, '2026-10-07', 0).action).toBe('keep');
    expect(placeOf(plan, '2026-10-07', 1).action).toBe('schedule');
    expect(placeOf(plan, '2026-10-09', 0).action).toBe('cancel');
  });
});

describe('when there are none', () => {
  it('until the switch is on, and in "חופש"', () => {
    for (const src of [sources({ notifications: { ...DEFAULT_SETTINGS.notifications, next_lesson: false } }), sources({ vacationMode: true })]) {
      expect(planNextLessons(src, NOW, ZONE).every((a) => a.action === 'cancel')).toBe(true);
    }
    expect(planNextLessons(null, NOW, ZONE).every((a) => a.action === 'cancel')).toBe(true);
  });
});

describe('the ones that stayed', () => {
  it('are taken back once their lesson started', () => {
    const now = at('2026-10-08', '08:50').getTime();
    const shown = [
      { identifier: nextLessonId('2026-10-08', 1), data: { until: at('2026-10-08', '08:45').getTime() } },
      { identifier: nextLessonId('2026-10-08', 2), data: { until: at('2026-10-08', '10:30').getTime() } },
      { identifier: 'sederyom-morning-summary|2026-10-08', data: { until: 0 } },
    ];
    expect(staleNextLessonIds(shown, now)).toEqual([nextLessonId('2026-10-08', 1)]);
  });
});
