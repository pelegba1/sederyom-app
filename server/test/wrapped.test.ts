/**
 * The year in review's numbers (year wrapped, part 2, design §8–§9): one pure
 * function over what the phone holds, each card with the records it counted.
 *
 * The fixture is a class from 1 September 2026 to 10 November, read on the
 * 11th: the site's regular grid up to 19 October (`backfill`), the server's own
 * record from the 20th (`observed`), with the cases the real log showed.
 */
import { describe, expect, it } from 'vitest';
import type { ClassExam, ClassHistoryLesson } from '@sederyom/shared';
import { addDays, sundayIndex } from '@sederyom/shared/logic/time';
import { buildWrapped, type WrappedCard, type WrappedCardId, type WrappedInput } from '@sederyom/shared/logic/wrapped/index';

const ZONE = 'Asia/Jerusalem';
const TODAY = '2026-11-11';
const OBSERVED_FROM = '2026-10-20';

const PERIODS: Record<number, [string, string]> = {
  1: ['08:00', '08:45'], 2: ['08:50', '09:35'], 3: ['09:50', '10:35'], 4: ['10:40', '11:25'],
};
const LINES: Record<number, [string, string]> = {
  1: ['מתמטיקה 5 יח"ל (יב2)', 'כהן רות'], 2: ['אנגלית', 'לוי דנה'], 3: ['היסטוריה', 'שחר גיל'], 4: ['אזרחות', 'מור עדי'],
};

function row(date: string, hourIndex: number, over: Partial<ClassHistoryLesson> = {}): ClassHistoryLesson {
  const [startTime, endTime] = PERIODS[hourIndex]!;
  const [subject, teacher] = LINES[hourIndex]!;
  return {
    date, hourIndex, startTime, endTime, subject, teacher, room: '108', status: 'regular', substitute: null, note: null,
    source: date < OBSERVED_FROM ? 'backfill' : 'observed', changeSeenAt: null, ...over,
  };
}

/**
 * Sunday to Thursday, holidays included (the site fills a vacation week with the regular grid):
 * three lessons a day, four on Wednesday, two on Thursday, and a literature line the student hid.
 */
function grid(from: string, to: string): ClassHistoryLesson[] {
  const rows: ClassHistoryLesson[] = [];
  for (let date = from; date <= to; date = addDays(date, 1, ZONE)) {
    const dow = sundayIndex(date, ZONE);
    if (dow > 4) continue;
    const hours = dow === 3 ? [1, 2, 3, 4] : dow === 4 ? [1, 2] : [1, 2, 3];
    for (const h of hours) rows.push(row(date, h));
    rows.push(row(date, 1, { subject: 'ספרות', teacher: 'זיו טל' }));
  }
  return rows;
}

function change(rows: ClassHistoryLesson[], date: string, hourIndex: number, over: Partial<ClassHistoryLesson>): void {
  const target = rows.find((r) => r.date === date && r.hourIndex === hourIndex && r.subject !== 'ספרות');
  if (!target) throw new Error(`no lesson on ${date} at ${hourIndex}`);
  Object.assign(target, over);
}

function lessons(): ClassHistoryLesson[] {
  const rows = grid('2026-09-01', '2026-11-10');
  // Three Sunday mornings, a Tuesday and a Wednesday.
  change(rows, '2026-10-25', 1, { status: 'cancelled' });
  change(rows, '2026-11-01', 1, { status: 'cancelled' });
  change(rows, '2026-11-08', 1, { status: 'cancelled' });
  change(rows, '2026-11-03', 3, { status: 'cancelled' });
  change(rows, '2026-11-04', 2, { status: 'cancelled' });
  // A change the site left on a week it was read back from: not a change.
  change(rows, '2026-09-08', 1, { status: 'cancelled' });
  change(rows, '2026-10-21', 2, { status: 'substitution', substitute: 'ברק נועה' });
  change(rows, '2026-10-22', 2, { status: 'substitution', substitute: 'ברק נועה' });
  change(rows, '2026-11-05', 1, { status: 'moved', note: 'הועבר משיעור 7' });
  // The phone read the same days twice.
  rows.push({ ...rows.find((r) => r.date === '2026-11-01' && r.hourIndex === 1 && r.subject !== 'ספרות')! });
  rows.push(row('2026-11-02', 2));
  return rows;
}

const exam = (naturalKey: string, date: string, subject: string): ClassExam => ({ naturalKey, date, subject, details: null, source: 'shahaf' });

const task = (title: string, completedAt: string | null, due: string | null = null, over: Partial<{ completed: boolean; deleted: boolean }> = {}) => ({
  title, due, completed: true, completedAt, deleted: false, ...over,
});

function input(over: Partial<WrappedInput> = {}): WrappedInput {
  return {
    today: TODAY,
    zone: ZONE,
    history: {
      coverage: { observedFrom: OBSERVED_FROM, from: '2026-09-01', to: '2026-11-10' },
      lessons: lessons(),
      exams: [
        exam('e1', '2026-10-21', 'מתמטיקה'), exam('e2', '2026-10-25', 'אנגלית'), exam('e3', '2026-10-28', 'היסטוריה'),
        exam('e4', '2026-11-03', 'ספרות'),
      ],
    },
    hiddenSubjects: ['ספרות'],
    subjectNames: {},
    examNames: {},
    hiddenExamKeys: ['e4'],
    ownDaysOff: [],
    manualExams: [
      { naturalKey: 'm1', date: '2026-10-29', subject: 'אזרחות' },
      { naturalKey: 'm2', date: '2026-11-20', subject: 'תנ"ך' },
    ],
    mashov: {
      counts: [
        { groupId: 'g1', subject: 'מתמטיקה', held: 40, weeklyHours: 5 },
        { groupId: 'g2', subject: 'אנגלית', held: 30, weeklyHours: 4 },
        { groupId: 'g3', subject: 'היסטוריה', held: 12, weeklyHours: 2 },
        { groupId: 'g4', subject: 'ספורט', held: 0, weeklyHours: 2 },
      ],
      attendance: [
        { date: '2026-09-09', hour: 2, kind: 'absence', justified: false, justification: null, groupId: 'g2', subject: 'אנגלית' },
        { date: '2026-10-12', hour: 1, kind: 'absence', justified: true, justification: 'אישור רפואי', groupId: 'g1', subject: 'מתמטיקה' },
        { date: '2026-11-02', hour: 1, kind: 'late', justified: false, justification: null, groupId: 'g1', subject: 'מתמטיקה' },
        { date: '2026-06-01', hour: 1, kind: 'absence', justified: false, justification: null, groupId: 'g1', subject: 'מתמטיקה' },
      ],
      grades: [
        { date: '2026-09-10', subject: 'מתמטיקה', value: 80 }, { date: '2026-09-15', subject: 'אנגלית', value: 90 },
        { date: '2026-09-17', subject: 'היסטוריה', value: 70 }, { date: '2026-10-20', subject: 'מתמטיקה', value: 97 },
        { date: '2026-10-25', subject: 'אנגלית', value: 85 }, { date: '2026-11-02', subject: 'מתמטיקה', value: 88 },
        { date: '2026-11-03', subject: 'ספורט', value: null },
      ],
    },
    tasks: [
      task('t1', '2026-10-30T10:00:00Z', '2026-10-30'), task('t2', '2026-11-01T08:00:00Z', '2026-11-02'),
      task('t3', '2026-11-02T09:00:00Z', '2026-11-01'), task('t4', '2026-11-03T09:00:00Z'),
      // 23:30 in Israel on the day it was due, and half an hour past midnight.
      task('t5', '2026-11-04T21:30:00Z', '2026-11-04'), task('t6', '2026-11-04T22:30:00Z', '2026-11-04'),
      task('t7', '2026-11-07T10:00:00Z'), task('t8', '2026-11-07T11:00:00Z'), task('t9', '2026-11-09T10:00:00Z', '2026-11-10'),
      task('deleted', '2026-11-06T10:00:00Z', null, { deleted: true }),
      task('open', null, '2026-11-12', { completed: false }),
      task('done before times were kept', null),
      task('last year', '2026-08-20T10:00:00Z'),
    ],
    homework: [{ subject: 'מתמטיקה', doneAt: '2026-11-02T15:00:00Z' }, { subject: 'אנגלית', doneAt: '2026-11-10T15:00:00Z' }],
    ...over,
  };
}

function card(cards: WrappedCard[], id: WrappedCardId): WrappedCard {
  const found = cards.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id} card; got ${cards.map((c) => c.id).join(', ')}`);
  return found;
}
const ids = (cards: WrappedCard[]) => cards.map((c) => c.id);

describe('the lesson cards', () => {
  const cards = buildWrapped(input());

  it('opens with the school days it covers, and from when the changes are known', () => {
    // 39 school days from 1.9 to 10.11: Rosh Hashana, 20.9–3.10 and election day are out.
    expect(card(cards, 'intro')).toMatchObject({
      value: 39, from: '2026-09-01', to: '2026-11-10', shareable: true, params: { observedFrom: OBSERVED_FROM },
    });
  });

  it('counts the hours of the lessons that were scheduled', () => {
    // 23 days of three lessons, 8 Wednesdays of four, 8 Thursdays of two: 117 lessons of 45 minutes.
    expect(card(cards, 'hours')).toMatchObject({ value: 88, from: '2026-09-01', params: { lessons: 117, days: 39, untimed: 0 } });
    expect(card(cards, 'hours').records).toHaveLength(39);
  });

  it('counts the observed cancellations, and not the one the site left on an old week', () => {
    const c = card(cards, 'cancelled');
    expect(c).toMatchObject({ value: 5, from: OBSERVED_FROM, params: { minutes: 225, untimed: 0 } });
    expect(c.records.map((r) => `${r.date} ${r.hour}`)).toEqual([
      '2026-10-25 1', '2026-11-01 1', '2026-11-03 3', '2026-11-04 2', '2026-11-08 1',
    ]);
  });

  it('names the subject and the weekday that lead the cancellations', () => {
    expect(card(cards, 'cancelledTop')).toMatchObject({ value: 3, params: { subject: 'מתמטיקה', weekday: 'יום ראשון', weekdayCount: 3, total: 5 } });
  });

  it('counts the mornings whose first lesson was cancelled, up to the first lesson held', () => {
    const c = card(cards, 'sleep');
    expect(c).toMatchObject({ value: 3, params: { minutes: 150 } });
    expect(c.records.map((r) => [r.date, r.amount])).toEqual([['2026-10-25', 50], ['2026-11-01', 50], ['2026-11-08', 50]]);
  });

  it('counts substitutes and moved lessons, with no name', () => {
    const c = card(cards, 'substitutes');
    expect(c).toMatchObject({ value: 3, params: { substitutions: 2, moved: 1 } });
    expect(JSON.stringify(c)).not.toContain('ברק נועה');
  });

  it('finds the longest and the shortest day', () => {
    expect(card(cards, 'days')).toMatchObject({
      value: 4,
      params: { longestDate: '2026-09-02', longestDays: 8, longestStart: '08:00', longestEnd: '11:25', shortestLessons: 2, shortestDate: '2026-09-03' },
    });
  });

  it('counts none of the days the student took off', () => {
    const off = buildWrapped(input({ ownDaysOff: ['2026-11-09', '2026-11-10'] }));
    expect(card(off, 'intro')).toMatchObject({ value: 37, to: '2026-11-08' });
    expect(card(off, 'hours').params).toMatchObject({ lessons: 111 });
  });
});

describe('what is not there', () => {
  it('a class with no history yet shows the opening and the ending, and what the phone has', () => {
    const cards = buildWrapped(input({ history: null, mashov: null, tasks: null, homework: [], manualExams: [] }));
    expect(ids(cards)).toEqual(['intro', 'outro']);
    expect(card(cards, 'intro')).toMatchObject({ value: 0, from: null, to: null });
  });

  it('under four weeks there are no hours and no days card', () => {
    const short = input();
    short.history!.lessons = short.history!.lessons.filter((l) => l.date >= '2026-10-25');
    const cards = buildWrapped(short);
    expect(ids(cards)).not.toContain('hours');
    expect(ids(cards)).not.toContain('days');
    expect(ids(cards)).toContain('cancelled');
  });

  it('four cancellations are no card', () => {
    const few = input();
    few.history!.lessons.find((l) => l.date === '2026-11-04' && l.hourIndex === 2)!.status = 'regular';
    const cards = buildWrapped(few);
    expect(ids(cards)).not.toContain('cancelled');
    expect(ids(cards)).not.toContain('cancelledTop');
  });

  it('a tie at the top names no subject, so no leader card', () => {
    const tie = input();
    const at = (date: string, h: number) => tie.history!.lessons.find((l) => l.date === date && l.hourIndex === h && l.subject !== 'ספרות')!;
    at('2026-11-08', 1).status = 'regular';
    at('2026-11-09', 2).status = 'cancelled';
    at('2026-11-10', 2).status = 'cancelled';
    // Mathematics 2, English 3 → English leads; then make it 3 against 3.
    at('2026-11-02', 1).status = 'cancelled';
    const cards = buildWrapped(tie);
    expect(card(cards, 'cancelled').value).toBe(7);
    expect(ids(cards)).not.toContain('cancelledTop');
  });

  it('a lesson of a parallel group that ran is no free period', () => {
    // Literature, kept this time, shares the first period every day and was never cancelled.
    const both = input({ hiddenSubjects: [] });
    const at = (date: string, h: number) => both.history!.lessons.find((l) => l.date === date && l.hourIndex === h && l.subject !== 'ספרות')!;
    at('2026-11-05', 2).status = 'cancelled';
    at('2026-11-09', 2).status = 'cancelled';
    at('2026-11-10', 3).status = 'cancelled';
    const cards = buildWrapped(both);
    expect(card(cards, 'cancelled').value).toBe(5);
    expect(ids(cards)).not.toContain('sleep');
  });

  it('a day whose every lesson was cancelled is not a morning of sleep', () => {
    const day = input();
    for (const l of day.history!.lessons) if (l.date === '2026-11-08' && l.subject !== 'ספרות') l.status = 'cancelled';
    expect(card(buildWrapped(day), 'sleep').value).toBe(2);
  });

  it('a lesson with no state to judge is scheduled, and no change', () => {
    const none = input();
    const l = none.history!.lessons.find((x) => x.date === '2026-11-09' && x.hourIndex === 2)!;
    l.status = null;
    l.startTime = null;
    l.endTime = null;
    const cards = buildWrapped(none);
    expect(card(cards, 'cancelled').value).toBe(5);
    expect(card(cards, 'hours').params).toMatchObject({ lessons: 117, untimed: 1 });
  });
});

describe('exams, tasks and Mashov', () => {
  const cards = buildWrapped(input());

  it('counts the exams that took place, mine only, with the ones added by hand', () => {
    const c = card(cards, 'exams');
    expect(c).toMatchObject({ value: 4, params: { weekStart: '2026-10-25', weekCount: 3 } });
    expect(c.records.map((r) => r.date)).toEqual(['2026-10-21', '2026-10-25', '2026-10-28', '2026-10-29']);
  });

  it('two exams are no card', () => {
    const few = input({ manualExams: [] });
    few.history!.exams = few.history!.exams.slice(0, 2);
    expect(ids(buildWrapped(few))).not.toContain('exams');
  });

  it('counts what was done, how much of it on time, and the longest run of days', () => {
    expect(card(cards, 'tasks')).toMatchObject({
      value: 11, from: '2026-10-30', params: { tasks: 9, homework: 2, withDue: 6, beforeDue: 4, streak: 5 },
    });
  });

  it('nine done are no card', () => {
    expect(ids(buildWrapped(input({ homework: [] })))).not.toContain('tasks');
  });

  it('counts the lessons Mashov says were held', () => {
    const c = card(cards, 'held');
    expect(c).toMatchObject({ value: 82, shareable: true, params: { subjects: 3, top: 'מתמטיקה', topHeld: 40 } });
    expect(c.records).toHaveLength(3);
  });

  it('counts this year\'s absences and lates, and keeps them off the share sheet', () => {
    expect(card(cards, 'attendance')).toMatchObject({ value: 3, shareable: false, params: { absences: 2, lates: 1, justified: 1 } });
  });

  it('averages the numeric grades, names the best subject and the change between the halves', () => {
    expect(card(cards, 'grades')).toMatchObject({
      value: 85, shareable: false, params: { count: 6, best: 'מתמטיקה', bestAverage: 88.3, trend: 10 },
    });
  });

  it('four grades are no card', () => {
    const few = input();
    few.mashov!.grades = few.mashov!.grades.slice(0, 4);
    expect(ids(buildWrapped(few))).not.toContain('grades');
  });

  it('keeps the order of the story, and ends', () => {
    expect(ids(cards)).toEqual([
      'intro', 'hours', 'held', 'cancelled', 'cancelledTop', 'sleep', 'substitutes', 'days', 'exams', 'tasks', 'attendance', 'grades', 'outro',
    ]);
  });
});

describe('what a shared card can carry', () => {
  const cards = buildWrapped(input());

  it('only grades and attendance are kept off the share sheet', () => {
    expect(cards.filter((c) => !c.shareable).map((c) => c.id)).toEqual(['attendance', 'grades']);
  });

  it('no shareable card holds a teacher, a substitute or a grade', () => {
    const shareable = cards.filter((c) => c.shareable);
    const text = JSON.stringify(shareable);
    for (const name of ['כהן רות', 'לוי דנה', 'שחר גיל', 'מור עדי', 'זיו טל', 'ברק נועה']) expect(text).not.toContain(name);
    for (const c of shareable) {
      expect(c.records.some((r) => r.kind === 'grade' || r.kind === 'absence' || r.kind === 'late')).toBe(false);
      expect(Object.keys(c.params).some((k) => /teacher|substitute|grade/i.test(k))).toBe(false);
    }
  });
});

describe('the student\'s own names for subjects', () => {
  // The line's own key is the subject as the site prints it, as the hide list keeps it.
  const NAMES = { 'מתמטיקה 5 יח"ל (יב2)': 'חשבון', 'block:ב': 'פיזיקה' };
  const named = input({ subjectNames: NAMES });
  named.history!.exams = [...named.history!.exams, exam('e5', '2026-11-04', 'מבחן גוש ב\''), exam('e6', '2026-11-09', 'מבחן במתמטיקה')];
  const cards = buildWrapped(named);

  it('a lesson is counted under the name the student gave its line', () => {
    expect(card(cards, 'cancelledTop').params.subject).toBe('חשבון');
    expect(card(cards, 'cancelled').records.map((r) => r.subject)).toEqual(['חשבון', 'חשבון', 'היסטוריה', 'אנגלית', 'חשבון']);
    expect(card(cards, 'substitutes').records.map((r) => r.subject)).toEqual(['אנגלית', 'אנגלית', 'חשבון']);
  });

  it('an exam\'s title reads the name where it read the subject or the block', () => {
    const titles = card(cards, 'exams').records.map((r) => r.subject);
    expect(titles).toContain('מבחן פיזיקה');
    expect(titles).toContain('מבחן בחשבון');
    expect(titles).not.toContain('מבחן גוש ב׳');
  });

  it('what Mashov names takes the name of the one line of its subject', () => {
    expect(card(cards, 'held').params.top).toBe('חשבון');
    expect(card(cards, 'grades').params.best).toBe('חשבון');
    expect(card(cards, 'attendance').records.map((r) => r.subject)).toEqual(['אנגלית', 'חשבון', 'חשבון']);
    expect(card(cards, 'tasks').records.filter((r) => r.kind === 'homework').map((r) => r.subject)).toEqual(['חשבון', 'אנגלית']);
  });

  it('a name the student gave one exam wins over the name of its subject', () => {
    const own = buildWrapped({ ...named, examNames: { e5: 'מבחן במכניקה', e1: 'בוחן פתע' } });
    const titles = card(own, 'exams').records.map((r) => r.subject);
    expect(titles).toContain('מבחן במכניקה');
    expect(titles).toContain('בוחן פתע');
    expect(titles).not.toContain('מבחן פיזיקה');
  });

  it('the numbers are the same with names and without', () => {
    const plain = buildWrapped({ ...named, subjectNames: {} });
    expect(cards.map((c) => [c.id, c.value])).toEqual(plain.map((c) => [c.id, c.value]));
  });
});

describe('what the independent review found', () => {
  it('a subject that is a teacher by name reaches no shareable card, and leads nothing', () => {
    const rows = lessons();
    // The site wrote the lesson as its teacher: four cancellations, one more than mathematics has.
    for (const [date, hour] of [['2026-10-26', 3], ['2026-10-28', 3], ['2026-10-29', 2], ['2026-11-09', 3]] as const) {
      change(rows, date, hour, { subject: 'השיעור של לוי דנה', teacher: 'לוי דנה', status: 'cancelled' });
    }
    // And a substitute printed where the subject goes.
    change(rows, '2026-11-10', 2, { subject: 'נגר אורי', teacher: 'נגר אורי', status: 'substitution', substitute: 'נגר אורי' });
    const base = input();
    const cards = buildWrapped({ ...base, history: { ...base.history!, lessons: rows } });
    expect(card(cards, 'cancelled').value).toBe(9);
    expect(card(cards, 'cancelledTop').params.subject).toBe('מתמטיקה');
    const people = new Set(rows.flatMap((r) => [r.teacher, r.substitute]).filter((n): n is string => !!n));
    const text = JSON.stringify(cards.filter((c) => c.shareable));
    for (const name of people) expect(text, name).not.toContain(name);
  });

  it('a lesson moved to another hour is one lesson and one change', () => {
    const rows = lessons();
    // Monday 26.10: the third lesson went to the fourth hour. The site prints both ends.
    change(rows, '2026-10-26', 3, { status: 'moved', note: 'הועבר לשעה 4' });
    rows.push(row('2026-10-26', 4, { subject: 'היסטוריה', teacher: 'שחר גיל', status: 'moved' }));
    const base = input();
    const cards = buildWrapped({ ...base, history: { ...base.history!, lessons: rows } });
    expect(card(cards, 'substitutes')).toMatchObject({ value: 4, params: { substitutions: 2, moved: 2 } });
    expect(card(cards, 'hours').params.lessons).toBe(117);
  });

  it('a morning of sleep is measured to a lesson that took place, not to an hour the lesson left', () => {
    const rows = lessons();
    change(rows, '2026-11-08', 2, { status: 'moved', note: 'הועבר לשעה 5' });
    const base = input();
    const c = card(buildWrapped({ ...base, history: { ...base.history!, lessons: rows } }), 'sleep');
    // 08:00 to the third lesson at 09:50.
    expect(c.records.map((r) => [r.date, r.amount])).toEqual([['2026-10-25', 50], ['2026-11-01', 50], ['2026-11-08', 110]]);
  });
});
