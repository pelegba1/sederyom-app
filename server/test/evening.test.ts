/**
 * The evening reminder (plan R12): "מחר להגיש: …" plus tomorrow's exam, and
 * nothing at all when nothing is due. Before a break it is about the day
 * school resumes ("ביום ראשון להגיש: …"), and on Friday evening it is silent
 * (W4-1). What is still open on the evening's own day closes the body: "עוד
 * לא סימנת: פיזיקה (להיום)" (W5-1). An exam two to four days off gets a line
 * before it: "בעוד 3 ימים: מבחן באנגלית" (W6-10).
 *
 * The phone composes and schedules it (`local-summaries.test.ts` runs it as
 * the phone does); these are the shared rules it composes it by.
 */
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { DayView, Exam, HomeworkItem, Task } from '@sederyom/shared';
import { composeEveningReminder, eveningTarget, type ExamsSoon } from '@sederyom/shared/logic/summaries';
import { buildDayView } from '@sederyom/shared/logic/build';

const ZONE = 'Asia/Jerusalem';
// Wednesday evening; Thursday 8.10 is the next school day.
const TODAY = '2026-10-07';
const TOMORROW = '2026-10-08';
const AT_20 = new Date('2026-10-07T17:00:00Z'); // 20:00 in Jerusalem

const exam = (subject: string, over: Partial<Exam> = {}): Exam => ({
  naturalKey: `site-exam|${subject}`, date: TOMORROW, subject, details: null, source: 'school_site', ...over,
});

const homework = (subject: string, text: string, done = false): HomeworkItem => ({
  naturalKey: `hw|${subject}|${text}`, dueDate: TOMORROW, subject, text, linkedTaskId: null, done,
});

const task = (id: string, title: string, over: Partial<Task> = {}): Task => ({
  id, listId: 'list-1', listTitle: 'בית ספר', title, notes: null, due: TOMORROW, completed: false, updated: null,
  linkedHomeworkKey: null, ...over,
});

function dayWith(date: string, exams: Exam[], items: HomeworkItem[], tasks: Task[] = []): DayView {
  const day = buildDayView({
    date, zone: ZONE, now: AT_20, lessons: [], events: [], tasks, exams, schoolEvents: [], vacationMode: false,
  });
  return { ...day, homework: items };
}

const tomorrowWith = (exams: Exam[], items: HomeworkItem[], tasks: Task[] = []) => dayWith(TOMORROW, exams, items, tasks);

/** This evening's own day, with what is due on it. */
const todayWith = (items: HomeworkItem[], tasks: Task[] = []) =>
  dayWith(TODAY, [], items.map((h) => ({ ...h, dueDate: TODAY })), tasks.map((t) => ({ ...t, due: TODAY })));

describe('what the reminder says', () => {
  it('lists the subjects due tomorrow, a line each, then the exam', () => {
    const push = composeEveningReminder(tomorrowWith(
      [exam('מבחן באנגלית')],
      [
        homework('היסטוריה (יב2)', 'לקרוא   פרק 3'),
        homework('מתמטיקה 3 יח"ל', 'תרגילים 1–5'),
        homework('ספרות', 'שיר', true),
      ],
    ))!;
    expect(push.title).toBe('מחר להגיש: היסטוריה, מתמטיקה');
    expect(push.body.split('\n')).toEqual(['היסטוריה: לקרוא פרק 3', 'מתמטיקה: תרגילים 1–5', 'מחר מבחן באנגלית']);
    expect(push.payload).toEqual({ type: 'evening_homework', deepLink: 'today', date: TOMORROW, refreshWidget: true });
  });

  it('caps the list and counts the rest', () => {
    const push = composeEveningReminder(tomorrowWith([], ['א', 'ב', 'ג', 'ד', 'ה'].map((t) => homework('אנגלית', t))))!;
    expect(push.title).toBe('מחר להגיש: אנגלית');
    expect(push.body.split('\n')).toEqual(['אנגלית: א', 'אנגלית: ב', 'אנגלית: ג', 'ועוד 2']);
  });

  it('with only an exam, the exam is the headline', () => {
    const push = composeEveningReminder(tomorrowWith([exam('מתכונת באנגלית', { details: 'שאלון 016582\nחדר 12' })], []))!;
    expect(push.title).toBe('מחר מבחן באנגלית');
    expect(push.body).toBe('מתכונת באנגלית · שאלון 016582 חדר 12');
    expect(composeEveningReminder(tomorrowWith([exam('מבחן גוש א')], []))!.title).toBe('מחר: מבחן גוש א');
    expect(composeEveningReminder(tomorrowWith([exam('מבחן באנגלית'), exam('מבחן באזרחות')], []))!.title).toBe('מחר 2 מבחנים: אנגלית, אזרחות');
  });

  it('nothing open and no exam means no reminder', () => {
    expect(composeEveningReminder(tomorrowWith([], []))).toBeNull();
    expect(composeEveningReminder(tomorrowWith([], [homework('היסטוריה', 'פרק 3', true)]))).toBeNull();
  });
});

describe('what is still open today (W5-1)', () => {
  const physics = homework('פיזיקה מורחב (מעבדת פיסיקה)', 'שאלות 1–5');

  it('closes the body with what today still has open', () => {
    const push = composeEveningReminder(
      tomorrowWith([exam('מבחן באנגלית')], [homework('היסטוריה (יב2)', 'לקרוא פרק 3')]),
      { today: todayWith([physics]) },
    )!;
    expect(push.title).toBe('מחר להגיש: היסטוריה');
    expect(push.body.split('\n')).toEqual(['היסטוריה: לקרוא פרק 3', 'מחר מבחן באנגלית', 'עוד לא סימנת: פיזיקה (להיום)']);
  });

  it('adds no line when nothing is open today', () => {
    const tomorrow = tomorrowWith([], [homework('היסטוריה', 'לקרוא פרק 3')]);
    const lines = (today: DayView | null) => composeEveningReminder(tomorrow, { today })!.body.split('\n');
    expect(lines(null)).toEqual(['היסטוריה: לקרוא פרק 3']);
    expect(lines(todayWith([]))).toEqual(['היסטוריה: לקרוא פרק 3']);
    expect(lines(todayWith([{ ...physics, done: true }]))).toEqual(['היסטוריה: לקרוא פרק 3']);
  });

  it('leaves out what was ticked off, and names a task made from homework by its subject', () => {
    const today = todayWith(
      [{ ...physics, done: true }, homework('ספרות', 'שיר')],
      [
        task('task-en', 'אנגלית: unit 4', { linkedHomeworkKey: 'hw-en' }),
        task('task-civ', 'אזרחות: ב', { linkedHomeworkKey: 'hw-civ' }),
        task('task-done', 'לקנות מחברת', { completed: true }),
      ],
    );
    const linked = new Map([
      ['hw-en', { subject: 'אנגלית 5 יח"ל (יב2)', text: 'unit 4', done: false }],
      ['hw-civ', { subject: 'אזרחות', text: 'ב', done: true }],
    ]);
    const push = composeEveningReminder(tomorrowWith([], [homework('היסטוריה', 'פרק 3')]), { linked, today })!;
    expect(push.body.split('\n')).toEqual(['היסטוריה: פרק 3', 'עוד לא סימנת: ספרות, אנגלית (להיום)']);
  });

  it('names other tasks by title after the homework, three names at most', () => {
    const today = todayWith([physics], [task('t1', 'לקנות מחברת'), task('t2', 'להחזיר ספר'), task('t3', 'לחתום על אישור')]);
    const push = composeEveningReminder(tomorrowWith([], [homework('היסטוריה', 'פרק 3')]), { today })!;
    expect(push.body.split('\n').at(-1)).toBe('עוד לא סימנת: פיזיקה, להחזיר ספר, לחתום על אישור ועוד 1 (להיום)');
  });

  it('keeps to three lines: the homework due first, then today, then other tasks', () => {
    const today = todayWith([physics]);
    // Three homework items fill the lines; today's line takes the last of them.
    const full = composeEveningReminder(tomorrowWith([exam('מבחן באנגלית')], ['א', 'ב', 'ג'].map((t) => homework('אנגלית', t))), { today })!;
    expect(full.body.split('\n')).toEqual(['אנגלית: א', 'אנגלית: ב', 'ועוד 1', 'מחר מבחן באנגלית', 'עוד לא סימנת: פיזיקה (להיום)']);

    // Other tasks get what is left.
    const tasks = [task('t1', 'לקנות מחברת'), task('t2', 'להחזיר ספר לספרייה')];
    const roomy = tomorrowWith([], [homework('היסטוריה', 'פרק 3')], tasks);
    expect(composeEveningReminder(roomy)!.body.split('\n')).toEqual([
      'היסטוריה: פרק 3', 'משימה: להחזיר ספר לספרייה', 'משימה: לקנות מחברת',
    ]);
    expect(composeEveningReminder(roomy, { today })!.body.split('\n')).toEqual([
      'היסטוריה: פרק 3', 'משימה: להחזיר ספר לספרייה', 'עוד לא סימנת: פיזיקה (להיום)',
    ]);
  });

  it('follows an exam that is the headline', () => {
    const push = composeEveningReminder(tomorrowWith([exam('מבחן באנגלית')], []), { today: todayWith([physics]) })!;
    expect(push.title).toBe('מחר מבחן באנגלית');
    expect(push.body.split('\n')).toEqual(['מבחן באנגלית', 'עוד לא סימנת: פיזיקה (להיום)']);
  });

  it('reads the same before a break', () => {
    const push = composeEveningReminder(tomorrowWith([], [homework('אנגלית', 'unit 4')]), { when: 'ביום ראשון', today: todayWith([physics]) })!;
    expect(push.title).toBe('ביום ראשון להגיש: אנגלית');
    expect(push.body.split('\n')).toEqual(['אנגלית: unit 4', 'עוד לא סימנת: פיזיקה (להיום)']);
  });

  it('is not a reason to send a reminder on its own', () => {
    expect(composeEveningReminder(tomorrowWith([], []), { today: todayWith([physics]) })).toBeNull();
  });
});

describe('the line about an exam a few days off (W6-10)', () => {
  const physics = homework('פיזיקה', 'שאלות');
  const soonExam = (subject: string, daysAway: number, over: Partial<Exam> = {}) =>
    ({ exams: [exam(subject, { date: '2026-10-11', ...over })], daysAway });

  it('names the exam as the exam line does: by subject, a block exam by its title, several by count', () => {
    const due = tomorrowWith([], [homework('היסטוריה', 'פרק 3')]);
    const line = (soon: ExamsSoon) => composeEveningReminder(due, { soon })!.body.split('\n').at(-1);
    expect(line(soonExam('מתכונת באנגלית', 2))).toBe('בעוד יומיים: מבחן באנגלית');
    expect(line(soonExam('מבחן גוש א', 3))).toBe('בעוד 3 ימים: מבחן גוש א');
    expect(line({ exams: [exam('מבחן באנגלית'), exam('מבחן באזרחות')], daysAway: 4 })).toBe('בעוד 4 ימים: 2 מבחנים (אנגלית, אזרחות)');
  });

  it('keeps to the line budget: it takes one of the three lines, like the line about today', () => {
    // Three homework items, the exam line, the line about today: five lines, as without it.
    const full = composeEveningReminder(
      tomorrowWith([exam('מבחן באנגלית')], ['א', 'ב', 'ג'].map((t) => homework('אנגלית', t))),
      { today: todayWith([physics]), soon: soonExam('מבחן באזרחות', 3) },
    )!;
    expect(full.title).toBe('מחר להגיש: אנגלית');
    expect(full.body.split('\n')).toEqual([
      'אנגלית: א', 'ועוד 2', 'מחר מבחן באנגלית', 'בעוד 3 ימים: מבחן באזרחות', 'עוד לא סימנת: פיזיקה (להיום)',
    ]);

    // It comes ahead of other tasks.
    const tasks = [task('t1', 'לקנות מחברת'), task('t2', 'להחזיר ספר לספרייה')];
    const roomy = composeEveningReminder(tomorrowWith([], [homework('היסטוריה', 'פרק 3')], tasks), { soon: soonExam('מבחן באזרחות', 3) })!;
    expect(roomy.body.split('\n')).toEqual(['היסטוריה: פרק 3', 'משימה: להחזיר ספר לספרייה', 'בעוד 3 ימים: מבחן באזרחות']);
  });

  it('follows an exam that is the headline', () => {
    const push = composeEveningReminder(tomorrowWith([exam('מבחן באנגלית')], []), { soon: soonExam('מבחן באזרחות', 4) })!;
    expect(push.title).toBe('מחר מבחן באנגלית');
    expect(push.body.split('\n')).toEqual(['מבחן באנגלית', 'בעוד 4 ימים: מבחן באזרחות']);
  });

  it('two days off, it is the headline of an evening with nothing else; further off it is no reason to send', () => {
    const nothing = tomorrowWith([], []);
    const alone = composeEveningReminder(nothing, { soon: soonExam('מבחן באנגלית', 2, { details: 'חדר 12' }), today: todayWith([physics]) })!;
    expect(alone.title).toBe('בעוד יומיים: מבחן באנגלית');
    expect(alone.body.split('\n')).toEqual(['מבחן באנגלית · חדר 12', 'עוד לא סימנת: פיזיקה (להיום)']);
    // A tap opens on the exam's day, the one it is about.
    expect(alone.payload).toEqual({ type: 'evening_homework', deepLink: 'today', date: '2026-10-11', refreshWidget: true });

    expect(composeEveningReminder(nothing, { soon: soonExam('מבחן באנגלית', 3) })).toBeNull();
    expect(composeEveningReminder(nothing, { soon: soonExam('מבחן באנגלית', 4) })).toBeNull();
  });
});

// ---- the next school day (W4-1) ----

/** 20:00 in Jerusalem on `date` (summer time through 25.10.2026). */
const eveningOf = (date: string) => new Date(`${date}T17:00:00Z`);

function viewOf(date: string, lessons = 0): DayView {
  return buildDayView({
    date, zone: ZONE, now: eveningOf(date), events: [], tasks: [], exams: [], schoolEvents: [], vacationMode: false,
    lessons: Array.from({ length: lessons }, (_v, i) => ({
      date, hourIndex: i + 1, startTime: null, endTime: null, subject: 'אנגלית', teacher: null, room: null,
      status: 'regular' as const, substitute: null, note: null, source: 'shahaf' as const, changeSeenAt: null,
    })),
  });
}

/** `from` and the seven days after it, with lessons on the dates in `withLessons`. */
function weekFrom(from: string, withLessons: string[] = []): [DayView, DayView[]] {
  const days = Array.from({ length: 8 }, (_v, i) => {
    const date = DateTime.fromISO(from, { zone: ZONE }).plus({ days: i }).toISODate()!;
    return viewOf(date, withLessons.includes(date) ? 1 : 0);
  });
  return [days[0]!, days.slice(1)];
}

const target = (from: string, withLessons: string[] = []) => {
  const t = eveningTarget(...weekFrom(from, withLessons), ZONE);
  return t && { date: t.day.date, when: t.when };
};

describe('which evening is about which day (W4-1)', () => {
  it('on a Thursday looks at Sunday when Friday has no lessons', () => {
    expect(target('2026-10-08')).toEqual({ date: '2026-10-11', when: 'ביום ראשון' });
  });

  it('on a Thursday looks at Friday when Friday has lessons', () => {
    expect(target('2026-10-08', ['2026-10-09'])).toEqual({ date: '2026-10-09', when: 'מחר' });
  });

  it('says nothing on a Friday evening, lessons that day or not', () => {
    expect(target('2026-10-09')).toBeNull();
    expect(target('2026-10-09', ['2026-10-09'])).toBeNull();
  });

  it('on a Saturday evening says "מחר" for Sunday', () => {
    expect(target('2026-10-10')).toEqual({ date: '2026-10-11', when: 'מחר' });
  });

  it('on an ordinary evening is tomorrow', () => {
    expect(target('2026-10-07')).toEqual({ date: '2026-10-08', when: 'מחר' });
  });

  it('on the eve of a holiday looks past it', () => {
    // Wednesday 12.5.2027 is Yom HaAtzmaut; school resumes on Thursday. (Yom Kippur
    // was the example until the Ministry's days around it joined the calendar:
    // 22–25.9.2026 run into Sukkot.)
    expect(target('2027-05-11')).toEqual({ date: '2027-05-13', when: 'ביום חמישי' });
    // The night of Yom HaAtzmaut itself: school is tomorrow.
    expect(target('2027-05-12')).toEqual({ date: '2027-05-13', when: 'מחר' });
  });

  it('inside a break stays quiet until its last evening', () => {
    // Sukkot 2026: Chol HaMoed through Friday 2.10, school again on Sunday 4.10.
    expect(target('2026-09-30')).toBeNull();
    expect(target('2026-10-03')).toEqual({ date: '2026-10-04', when: 'מחר' });
  });

  it('says nothing when no school day is within a week', () => {
    // Thursday 18.6.2026; the summer break starts on the 21st.
    expect(target('2026-06-18')).toBeNull();
  });

  it('names a day a full week away as next week', () => {
    const [today, ahead] = weekFrom('2026-10-13', ['2026-10-13']);
    const offWeek = ahead.map((d) => (d.date < '2026-10-20' ? { ...d, isSchoolDay: false } : d));
    expect(eveningTarget(today, offWeek, ZONE)).toMatchObject({ day: { date: '2026-10-20' }, when: 'ביום שלישי הבא' });
  });
});
