import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Exam, HomeworkItem, Lesson, SchoolEvent, Task } from '@sederyom/shared';
import { NEXT_EXAM_WINDOW_DAYS } from '@sederyom/shared';
import { buildAgendaView, buildDayView, buildWidgetFeed, holdsSchool, nextSchoolDay } from '@sederyom/shared/logic/build';
import { parseTimetable } from '../src/adapters/shahaf/parser.js';
import { addDays } from '../src/lib/time.js';

const ZONE = 'Asia/Jerusalem';
const DATE = '2026-09-01'; // Tuesday
const NOW = new Date('2026-09-01T07:12:00+03:00');

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    date: DATE, hourIndex: 1, startTime: '08:00', endTime: '08:45',
    subject: 'אנגלית', teacher: 'שרון', room: 'חדר 108',
    status: 'regular', substitute: null, note: null, source: 'shahaf', changeSeenAt: null, ...over,
  };
}

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', calendarId: 'primary', calendarName: 'אישי', seriesId: null, summary: 'אימון ג׳ודו', location: null,
    start: '2026-09-01T18:00:00+03:00', end: '2026-09-01T19:30:00+03:00', allDay: false, ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', listId: 'l1', listTitle: 'משימות', title: 'להגיש עבודה בהיסטוריה',
    notes: null, due: DATE, completed: false, updated: null, linkedHomeworkKey: null, ...over,
  };
}

function exam(over: Partial<Exam> = {}): Exam {
  return { naturalKey: 'x1', date: DATE, subject: 'מתמטיקה', details: 'פרק 3', source: 'shahaf', ...over };
}

function homework(over: Partial<HomeworkItem> = {}): HomeworkItem {
  return {
    naturalKey: 'mashov-hw|1', dueDate: DATE, subject: 'היסטוריה', text: 'לקרוא פרק 2', linkedTaskId: null, done: false, ...over,
  };
}

function schoolEvent(over: Partial<SchoolEvent> = {}): SchoolEvent {
  return { naturalKey: 'shahaf-event|1', date: DATE, title: 'טקס פתיחת שנה', details: null, source: 'shahaf', ...over };
}

function day(over: Partial<Parameters<typeof buildDayView>[0]> = {}) {
  return buildDayView({
    date: DATE, zone: ZONE, now: NOW, vacationMode: false,
    lessons: [], events: [], tasks: [], exams: [], schoolEvents: [], ...over,
  });
}

describe('day view', () => {
  it('labels the day in Hebrew with its Hebrew date', () => {
    const view = day();
    expect(view.weekdayName).toBe('יום שלישי');
    expect(view.hebrewDate).toMatch(/אלול/);
  });

  it('orders lessons, then evening events, then tasks', () => {
    const view = day({
      lessons: [lesson({ hourIndex: 3, startTime: '09:45', endTime: '10:30', subject: 'פיזיקה' }), lesson()],
      events: [event()],
      tasks: [task()],
    });
    expect(view.timeline.map(describe_)).toEqual([
      'lesson:אנגלית', 'lesson:פיזיקה', 'event:אימון ג׳ודו', 'task:להגיש עבודה בהיסטוריה',
    ]);
  });

  it('puts an all-day calendar event at the top of the day', () => {
    const view = day({
      lessons: [lesson()],
      events: [event({ id: 'e2', summary: 'יום ספורט', allDay: true, start: '2026-09-01T00:00:00+03:00', end: '2026-09-02T00:00:00+03:00' })],
    });
    expect(view.timeline[0]).toMatchObject({ kind: 'event' });
  });

  it('counts only non-regular lessons as changes', () => {
    const view = day({
      lessons: [lesson(), lesson({ hourIndex: 2, status: 'cancelled' }), lesson({ hourIndex: 3, status: 'substitution', substitute: 'כהן' })],
    });
    expect(view.changeCount).toBe(2);
  });

  it('separates today and tomorrow exams', () => {
    const view = day({ exams: [exam(), exam({ naturalKey: 'x2', date: '2026-09-02', subject: 'אנגלית' })] });
    expect(view.examsToday.map((e) => e.subject)).toEqual(['מתמטיקה']);
    expect(view.examsTomorrow.map((e) => e.subject)).toEqual(['אנגלית']);
  });

  it('treats Saturday as a non-school day', () => {
    expect(buildDayView({
      date: '2026-09-05', zone: ZONE, now: NOW, vacationMode: false,
      lessons: [], events: [], tasks: [], exams: [], schoolEvents: [],
    })).toMatchObject({ isSchoolDay: false, holidayName: 'שבת' });
  });

  it('honours vacation mode over the calendar', () => {
    expect(day({ vacationMode: true }).isSchoolDay).toBe(false);
  });
});

/**
 * The composed assertion the plan asks for: a cancelled lesson published by the
 * Shahaf site must arrive at the day view cancelled — not merely be correct in
 * the adapter's own output.
 */
describe('composed result: Shahaf HTML → day view', () => {
  const html = `
  <table class="TTTable" dir="rtl">
    <tr><td class="CName"></td><td class="CTitle" data-day="2">יום שלישי 01.09</td></tr>
    <tr>
      <td class="CName"><b>5<br/><span class="hour-time">11:30</span><br/><span class="hour-time">12:15</span></b></td>
      <td class="TTCell" data-day="2"><div class="TTLesson">היסטוריה<br/>שגיא<br/>חדר 211</div><div class="TTChange TableFreeChange">השיעור מבוטל</div></td>
    </tr>
    <tr>
      <td class="CName"><b>3<br/><span class="hour-time">09:45</span><br/><span class="hour-time">10:30</span></b></td>
      <td class="TTCell" data-day="2"><div class="TTLesson">פיזיקה<br/>לוי<br/>מעבדה 2</div><div class="TTChange TableFillChange">מ״מ: כהן</div></td>
    </tr>
  </table>`;

  it('carries cancellation and substitution all the way through', () => {
    const parsed = parseTimetable(html, '2026-08-30', { zone: ZONE });
    const view = day({ lessons: parsed.lessons.map((l) => ({ ...l, source: 'shahaf' as const, changeSeenAt: null })) });

    const byStatus = Object.fromEntries(
      view.timeline
        .filter((i) => i.kind === 'lesson')
        .map((i) => [(i as Extract<typeof i, { kind: 'lesson' }>).lesson.subject, (i as Extract<typeof i, { kind: 'lesson' }>).lesson]),
    );
    expect(byStatus['היסטוריה']!.status).toBe('cancelled');
    expect(byStatus['פיזיקה']!.status).toBe('substitution');
    expect(byStatus['פיזיקה']!.substitute).toBe('כהן');
    expect(view.changeCount).toBe(2);
    // ...and in the right order: 09:45 before 11:30, despite the HTML row order.
    expect(view.timeline.map(describe_)).toEqual(['lesson:פיזיקה', 'lesson:היסטוריה']);
  });
});

describe('widget feed', () => {
  const base = day({
    lessons: [lesson(), lesson({ hourIndex: 2, subject: 'פיזיקה', status: 'substitution', substitute: 'כהן', startTime: '08:45', endTime: '09:30' })],
    events: [event()],
    tasks: [task()],
    exams: [exam({ date: '2026-09-04' })],
  });

  const feed = buildWidgetFeed({
    day: base,
    zone: ZONE,
    now: NOW,
    openTasks: [task(), task({ id: 't2', title: 'תרגיל בפיזיקה', due: '2026-09-03' }), task({ id: 't3', title: 'ללא תאריך', due: null })],
    upcomingExams: [exam({ naturalKey: 'x9', date: '2026-09-04', subject: 'מתמטיקה' })],
  });

  it('renders the substitution detail the widget shows', () => {
    expect(feed.lessons[1]).toMatchObject({ subject: 'פיזיקה', status: 'substitution', detail: 'מ״מ: כהן' });
  });

  it('counts down to the next exam in whole days', () => {
    expect(feed.nextExam).toEqual({ subject: 'מתמטיקה', date: '2026-09-04', daysAway: 3 });
  });

  it('shows the next event still ahead of now', () => {
    expect(feed.nextEvent?.summary).toBe('אימון ג׳ודו');
  });

  it('orders open tasks due-soonest first and puts undated ones last', () => {
    expect(feed.openTasks.map((t) => t.title)).toEqual(['להגיש עבודה בהיסטוריה', 'תרגיל בפיזיקה', 'ללא תאריך']);
    expect(feed.openTaskCount).toBe(3);
    expect(feed.openTasks[0]).toMatchObject({ due: DATE, listTitle: 'משימות' });
  });

  it('lists the next exams for the main widget', () => {
    expect(feed.upcomingExams).toEqual([{ subject: 'מתמטיקה', date: '2026-09-04', daysAway: 3 }]);
  });

  it('carries today alone as the window when no other days are given', () => {
    expect(feed.days.map((d) => d.date)).toEqual([DATE]);
    expect(feed.days[0]!.lessons).toEqual(feed.lessons);
    expect(feed.days[0]!.tasksDue.map((t) => t.title)).toEqual(['להגיש עבודה בהיסטוריה']);
    expect(feed.days[0]!.events.map((e) => e.summary)).toEqual(['אימון ג׳ודו']);
    // The only exam is on the 4th, so today's own list is empty.
    expect(feed.days[0]!.exams).toEqual([]);
  });

  it('separates tasks due today', () => {
    expect(feed.tasksDueToday.map((t) => t.title)).toEqual(['להגיש עבודה בהיסטוריה']);
  });

  it('stamps generatedAt so the widget can show staleness', () => {
    expect(feed.generatedAt).toMatch(/^2026-09-01T07:12/);
  });
});

describe('widget feed window', () => {
  const yesterday = day({
    date: '2026-08-31',
    lessons: [lesson({ date: '2026-08-31', subject: 'תנ״ך' })],
  });
  const tomorrow = day({
    date: '2026-09-02',
    lessons: [lesson({ date: '2026-09-02', subject: 'היסטוריה', status: 'cancelled' })],
    exams: [exam({ naturalKey: 'x2', date: '2026-09-02', subject: 'לשון' })],
  });
  const saturday = day({ date: '2026-09-05' });

  const feed = buildWidgetFeed({
    day: day({ lessons: [lesson()] }),
    // Deliberately out of order: the widget pages by index.
    days: [tomorrow, saturday, day({ lessons: [lesson()] }), yesterday],
    zone: ZONE,
    now: NOW,
    openTasks: [task({ id: 't2', title: 'לקרוא פרק', due: '2026-09-02' })],
    upcomingExams: [exam({ naturalKey: 'x2', date: '2026-09-02', subject: 'לשון' })],
  });

  it('sorts the window ascending with today inside it', () => {
    expect(feed.days.map((d) => d.date)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-05']);
    expect(feed.date).toBe(DATE);
  });

  it('gives every day its own lessons, changes, tasks and exams', () => {
    const [prev, today, next, sat] = feed.days;
    expect(prev!.lessons.map((l) => l.subject)).toEqual(['תנ״ך']);
    expect(today!.lessons.map((l) => l.subject)).toEqual(['אנגלית']);
    expect(next!.lessons[0]).toMatchObject({ subject: 'היסטוריה', status: 'cancelled', detail: 'מבוטל' });
    expect(next!.changeCount).toBe(1);
    expect(next!.tasksDue.map((t) => t.title)).toEqual(['לקרוא פרק']);
    expect(next!.exams).toEqual([{ subject: 'לשון', date: '2026-09-02', daysAway: 1 }]);
    expect(sat).toMatchObject({ isSchoolDay: false, holidayName: 'שבת', lessons: [] });
  });

  it('keeps the top-level fields describing today', () => {
    expect(feed.lessons.map((l) => l.subject)).toEqual(['אנגלית']);
    expect(feed.nextExam).toEqual({ subject: 'לשון', date: '2026-09-02', daysAway: 1 });
    expect(feed.tasksDueToday).toEqual([]);
  });
});

describe('day view: homework due (F1)', () => {
  it('lists the homework due that day, done and open alike, by subject', () => {
    const view = day({
      homework: [
        homework({ naturalKey: 'h2', subject: 'מתמטיקה', done: true }),
        homework({ naturalKey: 'h1', subject: 'אנגלית' }),
        homework({ naturalKey: 'h3', dueDate: '2026-09-02' }),
        homework({ naturalKey: 'h4', dueDate: null }),
      ],
    });
    expect(view.homework.map((h) => [h.naturalKey, h.done])).toEqual([['h1', false], ['h2', true]]);
  });

  it('is empty, not missing, on a day with nothing due', () => {
    expect(day().homework).toEqual([]);
  });
});

describe('day view: next exam (F5)', () => {
  it('counts an exam on the day itself as 0 days away', () => {
    expect(day({ exams: [exam()] }).nextExam).toEqual({ exam: exam(), daysAway: 0 });
  });

  it('picks the nearest exam and ignores the past', () => {
    const view = day({
      exams: [
        exam({ naturalKey: 'past', date: '2026-08-30' }),
        exam({ naturalKey: 'far', date: '2026-09-10', subject: 'פיזיקה' }),
        exam({ naturalKey: 'near', date: '2026-09-04', subject: 'אנגלית' }),
      ],
    });
    expect(view.nextExam).toMatchObject({ exam: { naturalKey: 'near' }, daysAway: 3 });
  });

  it(`looks ${NEXT_EXAM_WINDOW_DAYS} days ahead and no further`, () => {
    const edge = addDays(DATE, NEXT_EXAM_WINDOW_DAYS, ZONE);
    expect(day({ exams: [exam({ date: edge })] }).nextExam).toMatchObject({ daysAway: NEXT_EXAM_WINDOW_DAYS });
    expect(day({ exams: [exam({ date: addDays(edge, 1, ZONE) })] }).nextExam).toBeNull();
  });
});

describe('day view: projected lessons (F6)', () => {
  const projectedLesson = (over: Partial<Lesson> = {}) => lesson({ source: 'mashov', room: null, ...over });

  it('flags a day whose lessons come from the Mashov grid', () => {
    expect(day({ lessons: [projectedLesson(), projectedLesson({ hourIndex: 2 })] }).projected).toBe(true);
  });

  it('does not flag a day the school site published', () => {
    expect(day({ lessons: [lesson()] }).projected).toBe(false);
    expect(day().projected).toBe(false);
  });

  it('drops projected lessons on a day the owner declared "חופש"', () => {
    const view = day({ vacationMode: true, lessons: [projectedLesson()] });
    expect(view).toMatchObject({ isSchoolDay: false, projected: false, timeline: [] });
  });

  it('keeps published lessons in vacation mode, as before', () => {
    expect(day({ vacationMode: true, lessons: [lesson()] }).timeline).toHaveLength(1);
  });
});

describe('widget feed: homework due (R14)', () => {
  const today = day({
    homework: [
      homework({ naturalKey: 'today-open', subject: 'אנגלית' }),
      homework({ naturalKey: 'today-done', done: true }),
    ],
  });
  const tomorrow = day({
    date: '2026-09-02',
    homework: [homework({ naturalKey: 'tomorrow-open', dueDate: '2026-09-02', subject: 'אזרחות' })],
  });
  const later = day({
    date: '2026-09-03',
    homework: [homework({ naturalKey: 'later', dueDate: '2026-09-03' })],
  });

  it('lists open homework due today and tomorrow, today first', () => {
    const feed = buildWidgetFeed({ day: today, days: [later, tomorrow, today], zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    expect(feed.homeworkDue).toEqual([
      { key: 'today-open', subject: 'אנגלית', text: 'לקרוא פרק 2', due: DATE },
      { key: 'tomorrow-open', subject: 'אזרחות', text: 'לקרוא פרק 2', due: '2026-09-02' },
    ]);
  });

  it("falls back to today's alone when the window does not carry tomorrow", () => {
    const feed = buildWidgetFeed({ day: today, zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    expect(feed.homeworkDue.map((h) => h.key)).toEqual(['today-open']);
  });
});

// Thursday 8.10.2026; Friday 9.10 has no lessons, Sunday 11.10 is the next school day.
const THURSDAY = '2026-10-08';
const at = (date: string, over: Partial<Parameters<typeof buildDayView>[0]> = {}) =>
  day({ date, now: new Date(`${THURSDAY}T07:12:00+03:00`), ...over });
const due = (date: string, key: string, subject = 'אנגלית') => homework({ naturalKey: key, dueDate: date, subject });

describe('next school day (W4-1)', () => {
  const week = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map((d) => at(d));

  it('skips a Friday without lessons and the Saturday after it', () => {
    expect(nextSchoolDay(THURSDAY, week, ZONE)?.date).toBe('2026-10-11');
    expect(holdsSchool(week[0]!, ZONE)).toBe(false);
  });

  it('lands on a Friday that has lessons', () => {
    const friday = at('2026-10-09', { lessons: [lesson({ date: '2026-10-09' })] });
    expect(holdsSchool(friday, ZONE)).toBe(true);
    expect(nextSchoolDay(THURSDAY, [friday, ...week.slice(1)], ZONE)?.date).toBe('2026-10-09');
  });

  it('is tomorrow on an ordinary evening, and Sunday on a Saturday', () => {
    expect(nextSchoolDay('2026-10-11', week, ZONE)?.date).toBe('2026-10-12');
    expect(nextSchoolDay('2026-10-10', week, ZONE)?.date).toBe('2026-10-11');
  });

  it('steps over a holiday', () => {
    // Wednesday 12.5.2027 is Yom HaAtzmaut. (Yom Kippur was the example until the
    // Ministry's days around it joined the calendar: 22–25.9.2026 run into Sukkot.)
    const days = ['2027-05-12', '2027-05-13'].map((d) => at(d));
    expect(days[0]!.isSchoolDay).toBe(false);
    expect(nextSchoolDay('2027-05-11', days, ZONE)?.date).toBe('2027-05-13');
  });

  it('looks seven days ahead and no further, and never back', () => {
    const later = at('2026-10-16', { lessons: [lesson({ date: '2026-10-16' })] });
    expect(nextSchoolDay('2026-10-08', [later], ZONE)).toBeNull();
    expect(nextSchoolDay('2026-10-09', [later], ZONE)?.date).toBe('2026-10-16');
    expect(nextSchoolDay('2026-10-12', [at('2026-10-11')], ZONE)).toBeNull();
  });

  it('finds nothing in vacation mode', () => {
    expect(nextSchoolDay(THURSDAY, week.map((d) => at(d.date, { vacationMode: true })), ZONE)).toBeNull();
  });
});

describe('widget feed: homework due through the next school day (W4-1)', () => {
  it("on a Thursday lists Sunday's homework, not only Friday's", () => {
    const days = [
      at(THURSDAY, { homework: [due(THURSDAY, 'thu')] }),
      at('2026-10-09', { homework: [due('2026-10-09', 'fri')] }),
      at('2026-10-10'),
      at('2026-10-11', { homework: [due('2026-10-11', 'sun-en'), due('2026-10-11', 'sun-net', 'שרותי רשת')] }),
      at('2026-10-12', { homework: [due('2026-10-12', 'mon')] }),
    ];
    const feed = buildWidgetFeed({ day: days[0]!, days, zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    expect(feed.homeworkDue.map((h) => [h.key, h.due])).toEqual([
      ['thu', THURSDAY], ['fri', '2026-10-09'], ['sun-en', '2026-10-11'], ['sun-net', '2026-10-11'],
    ]);
  });

  it('on a Saturday lists Sunday, and on a Sunday only Monday', () => {
    const days = [
      at('2026-10-10'),
      at('2026-10-11', { homework: [due('2026-10-11', 'sun')] }),
      at('2026-10-12', { homework: [due('2026-10-12', 'mon')] }),
      at('2026-10-13', { homework: [due('2026-10-13', 'tue')] }),
    ];
    const saturday = buildWidgetFeed({ day: days[0]!, days, zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    expect(saturday.homeworkDue.map((h) => h.key)).toEqual(['sun']);
    const sunday = buildWidgetFeed({ day: days[1]!, days, zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    expect(sunday.homeworkDue.map((h) => h.key)).toEqual(['sun', 'mon']);
  });
});

describe('agenda (R4)', () => {
  const tomorrow = '2026-09-02';
  const days = [
    day({
      date: tomorrow,
      exams: [exam({ naturalKey: 'x2', date: tomorrow, subject: 'אנגלית' })],
      homework: [homework({ naturalKey: 'h2', dueDate: tomorrow, done: true })],
      tasks: [task({ id: 't2', due: tomorrow, title: 'ב משימה' }), task({ id: 't1', due: tomorrow, title: 'א משימה' })],
      schoolEvents: [schoolEvent({ date: tomorrow })],
      events: [
        event({ id: 'late', summary: 'חוג', start: '2026-09-02T18:00:00+03:00', end: '2026-09-02T19:00:00+03:00' }),
        event({ id: 'allday', summary: 'יום הולדת', allDay: true, start: '2026-09-02T00:00:00+03:00', end: '2026-09-03T00:00:00+03:00' }),
      ],
      lessons: [lesson({ date: tomorrow })],
    }),
    day(),
  ];
  const agenda = buildAgendaView({ from: DATE, days, zone: ZONE, now: NOW });

  it('lists every day ascending, empty ones included', () => {
    expect(agenda.from).toBe(DATE);
    expect(agenda.to).toBe(tomorrow);
    expect(agenda.days.map((d) => [d.date, d.weekdayName, d.items.length])).toEqual([
      [DATE, 'יום שלישי', 0],
      [tomorrow, 'יום רביעי', 7],
    ]);
  });

  it('orders a day exam, homework, task, event, calendar — and leaves lessons out', () => {
    const items = agenda.days[1]!.items;
    expect(items.map((i) => i.kind)).toEqual(['exam', 'homework', 'task', 'task', 'event', 'calendar', 'calendar']);
    expect(items[0]).toEqual({ kind: 'exam', exam: exam({ naturalKey: 'x2', date: tomorrow, subject: 'אנגלית' }), daysAway: 1 });
    expect(items[1]).toMatchObject({ kind: 'homework', homework: { naturalKey: 'h2', done: true } });
    expect(items.filter((i) => i.kind === 'task').map((i) => (i.kind === 'task' ? i.task.title : ''))).toEqual(['א משימה', 'ב משימה']);
    expect(items.filter((i) => i.kind === 'calendar').map((i) => (i.kind === 'calendar' ? i.event.id : ''))).toEqual(['allday', 'late']);
  });
});

function describe_(item: { kind: string; lesson?: { subject: string }; event?: { summary: string }; task?: { title: string } }): string {
  if (item.kind === 'lesson') return `lesson:${item.lesson!.subject}`;
  if (item.kind === 'event') return `event:${item.event!.summary}`;
  return `task:${item.task!.title}`;
}
