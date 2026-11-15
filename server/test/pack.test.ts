/**
 * What goes in the bag (ideas פ2): what the student wrote for each subject,
 * kept on the phone (app/src/local/packList.ts), and the evening reminder's
 * line over the next school day as it is after the changes.
 */
import { describe, expect, it } from 'vitest';
import type { DayView, HomeworkItem, Lesson } from '@sederyom/shared';
import { buildDayView } from '@sederyom/shared/logic/build';
import { composeEveningReminder, packItems, packKey } from '@sederyom/shared/logic/summaries';
import { PACK_LIST_KEY, packTextFor, readPackList, setPackText } from '../../app/src/local/packList';

const ZONE = 'Asia/Jerusalem';
const TOMORROW = '2026-10-08';
const AT_20 = new Date('2026-10-07T17:00:00Z');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const lesson = (hourIndex: number, subject: string, status: Lesson['status'] = 'regular'): Lesson => ({
  date: TOMORROW, hourIndex, startTime: null, endTime: null, subject, teacher: null, room: null, status,
  substitute: null, note: null, source: 'shahaf', changeSeenAt: null,
});

function tomorrow(lessons: Lesson[], homework: HomeworkItem[] = []): DayView {
  const day = buildDayView({
    date: TOMORROW, zone: ZONE, now: AT_20, lessons, events: [], tasks: [], exams: [], schoolEvents: [], vacationMode: false,
  });
  return { ...day, homework };
}

const DAY = [
  lesson(1, 'אנגלית 5 יח"ל (יא2)', 'substitution'),
  lesson(2, 'חינוך גופני', 'cancelled'),
  lesson(3, 'מתמטיקה'),
  lesson(4, 'אנגלית'),
];
const PACK = { [packKey('מתמטיקה')]: 'מחשבון', [packKey('חינוך גופני')]: 'בגדי ספורט', [packKey('אנגלית')]: 'מילון' };

describe('the bag for a day', () => {
  it('is what the day\'s subjects take, in its order, each once, without a cancelled lesson\'s', () => {
    expect(packItems(tomorrow(DAY), PACK)).toEqual(['מילון', 'מחשבון']);
  });

  it('is a reminder of its own when nothing else is due', () => {
    const push = composeEveningReminder(tomorrow(DAY), { pack: PACK })!;
    expect(push.title).toBe('מחר לתיק: מילון, מחשבון');
    expect(push.body).toBe('');
    expect(composeEveningReminder(tomorrow(DAY), { pack: PACK, when: 'ביום ראשון' })!.title).toBe('ביום ראשון לתיק: מילון, מחשבון');
  });

  it('takes a line after the homework due', () => {
    const homework: HomeworkItem = { naturalKey: 'hw|1', dueDate: TOMORROW, subject: 'היסטוריה', text: 'לקרוא פרק 3', linkedTaskId: null, done: false };
    const push = composeEveningReminder(tomorrow(DAY, [homework]), { pack: PACK })!;
    expect(push.title).toBe('מחר להגיש: היסטוריה');
    expect(push.body.split('\n')).toEqual(['היסטוריה: לקרוא פרק 3', 'מחר לתיק: מילון, מחשבון']);
  });

  it('says nothing when the day asks for nothing', () => {
    expect(composeEveningReminder(tomorrow([lesson(2, 'חינוך גופני', 'cancelled')]), { pack: PACK })).toBeNull();
    expect(composeEveningReminder(tomorrow(DAY), {})).toBeNull();
  });
});

describe('on the phone', () => {
  it('keeps a subject\'s text under the key the reminder reads it by', () => {
    const kv = memoryKv();
    setPackText(kv, 'אנגלית 5 יח"ל (יא2)', '  מילון   וספר  ');
    expect(packKey('אנגלית 5 יח"ל (יא2)')).toBe(packKey('אנגלית'));
    expect(packTextFor(kv, 'אנגלית')).toBe('מילון וספר');
    expect(packItems(tomorrow([lesson(1, 'אנגלית')]), readPackList(kv))).toEqual(['מילון וספר']);
  });

  it('forgets a subject whose text is cleared, and reads a broken store as empty', () => {
    const kv = memoryKv();
    setPackText(kv, 'מתמטיקה', 'מחשבון');
    setPackText(kv, 'מתמטיקה', '   ');
    expect(readPackList(kv)).toEqual({});
    kv.set(PACK_LIST_KEY, '[1,2');
    expect(readPackList(kv)).toEqual({});
  });
});
