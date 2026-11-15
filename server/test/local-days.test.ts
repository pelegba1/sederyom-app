/**
 * The phone's days (app/src/local, plan Phase 2e): built from the class feed,
 * Mashov's grid and Google's kept entities with the shared rules.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClassFeed, DayView, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { parseTimetable } from '../src/adapters/shahaf/parser.js';
import { buildLocalDays, deviceCalendars } from '../../app/src/local/days';
import { localWeek, localWidgetFeed } from '../../app/src/local/views';

const ZONE = 'Asia/Jerusalem';
// Tuesday 1.9.2026, inside the fixture week (30.08 – 04.09).
const NOW = new Date('2026-09-01T10:00:00+03:00');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

function weekHtml(rows: string): string {
  const days = ['ראשון 30.08', 'שני 31.08', 'שלישי 01.09', 'רביעי 02.09', 'חמישי 03.09', 'שישי 04.09'];
  return `<html><body><div class="tt-module"><table class="TTTable" dir="rtl"><tr><td class="CName"></td>${days
    .map((d, i) => `<td class="CTitle" data-day="${i}">יום ${d}</td>`)
    .join('')}</tr>${rows}</table><div class="UpdateDate">מעודכן ל: 01.09.2026, שעה: 18:40</div></div></body></html>`;
}
function row(hour: number, cells: Record<number, string>): string {
  const tds = Array.from({ length: 6 }, (_v, day) => `<td class="TTCell" data-day="${day}">${cells[day] ?? ''}</td>`).join('');
  return `<tr><td class="CName"><b>${hour}<br/><span class="hour-time">08:00</span><br/><span class="hour-time">08:45</span></b></td>${tds}</tr>`;
}
const ENGLISH = '<div class="TTLesson">אנגלית<br/>שרון<br/>חדר 108</div>';
const PHYSICS = '<div class="TTLesson">פיזיקה<br/>לוי<br/>מעבדה 2</div>';
const CANCELLED = '<div class="TTChange TableFreeChange">השיעור מבוטל</div>';

const week = parseTimetable(weekHtml(row(1, { 2: ENGLISH, 3: ENGLISH }) + row(3, { 2: PHYSICS, 3: `${PHYSICS}${CANCELLED}` })), '2026-08-30', { zone: ZONE });

const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: '2026-09-01T07:00:00.000Z',
  freshness: null,
  lessons: week.lessons,
  changes: [],
  exams: [{ naturalKey: 'shahaf-exam|1', date: '2026-09-03', subject: 'מבחן באנגלית', details: null }],
  events: [{ naturalKey: 'shahaf-event|1', date: '2026-09-02', title: 'טקס', details: null }],
  messages: [],
};

// The student's weekly grid from Mashov: English on Sunday (0) period 1, Monday (1) period 1.
const slot = (dayOfWeek: number) => ({
  source: 'mashov' as const, kind: 'timetable_slot' as const, naturalKey: `mashov-slot|${dayOfWeek}|1|אנגלית`,
  payload: { dayOfWeek, hourIndex: 1, subject: 'אנגלית', teacher: 'שרון', room: null, groupName: null, startTime: '08:00', endTime: '08:45' },
});
const MASHOV = [
  slot(0), slot(1),
  // Given on Tuesday's English lesson: due at the next one, Wednesday.
  { source: 'mashov' as const, kind: 'homework' as const, naturalKey: 'hw-1', payload: { dueDate: '2026-09-01', subject: 'אנגלית', text: 'עמוד 12', teacher: 'שרון' } },
];

const GOOGLE = [
  { kind: 'calendar' as const, naturalKey: 'me', partition: null, payload: { id: 'me', summary: 'אישי', primary: true, color: null } },
  { kind: 'calendar' as const, naturalKey: 'school', partition: null, payload: { id: 'school', summary: 'בית ספר', primary: false, color: null } },
  { kind: 'calendar_event' as const, naturalKey: 'me|e1', partition: 'me', payload: { googleId: 'e1', calendarId: 'me', calendarSummary: 'אישי', summary: 'חוג', location: null, start: '2026-09-01T17:00:00+03:00', end: '2026-09-01T18:00:00+03:00', allDay: false, cancelled: false } },
  { kind: 'calendar_event' as const, naturalKey: 'me|e2', partition: 'me', payload: { googleId: 'e2', calendarId: 'me', calendarSummary: 'אישי', summary: 'בוטל', location: null, start: '2026-09-01T19:00:00+03:00', end: '2026-09-01T20:00:00+03:00', allDay: false, cancelled: true } },
  { kind: 'calendar_event' as const, naturalKey: 'school|x', partition: 'school', payload: { googleId: 'x', calendarId: 'school', calendarSummary: 'בית ספר', summary: 'מבחן (מראה)', location: null, start: '2026-09-01T08:00:00+03:00', end: '2026-09-01T09:00:00+03:00', allDay: false, cancelled: false } },
  { kind: 'task' as const, naturalKey: 'l|t1', partition: 'l', payload: { googleId: 't1', listId: 'l', listTitle: 'משימות', title: 'לקנות מחברת', notes: null, due: '2026-09-01', completed: false, deleted: false, updated: null } },
  { kind: 'task' as const, naturalKey: 'l|t2', partition: 'l', payload: { googleId: 't2', listId: 'l', listTitle: 'משימות', title: 'כבר נעשה', notes: null, due: '2026-09-01', completed: true, deleted: false, updated: null } },
];

const settings = (over: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, ...over });

function build(dates: string[], s: UserSettings = settings()): DayView[] {
  return buildLocalDays({ feed: FEED, mashov: MASHOV, bagrut: [], google: GOOGLE, settings: s, zone: ZONE, now: NOW }, dates);
}

const lessons = (day: DayView) => day.timeline.flatMap((i) => (i.kind === 'lesson' ? [`${i.lesson.hourIndex} ${i.lesson.subject} ${i.lesson.status} ${i.lesson.source}`] : []));

describe('the phone\'s days', () => {
  it('takes the site\'s week where it published, and the Mashov grid only after it', () => {
    const [tuesday, wednesday, nextSunday] = build(['2026-09-01', '2026-09-02', '2026-09-06']);
    expect(lessons(tuesday!)).toEqual(['1 אנגלית regular shahaf', '3 פיזיקה regular shahaf']);
    expect(lessons(wednesday!)).toEqual(['1 אנגלית regular shahaf', '3 פיזיקה cancelled shahaf']);
    expect(wednesday!.changeCount).toBe(1);
    // The next week is not published: projected from Mashov, and said so.
    expect(lessons(nextSunday!)).toEqual(['1 אנגלית regular mashov']);
    expect(nextSunday!.projected).toBe(true);
  });

  it('drops a hidden subject, like the server', () => {
    const [wednesday] = build(['2026-09-02'], settings({ lessons: { hiddenSubjects: ['פיזיקה'] } }));
    expect(lessons(wednesday!)).toEqual(['1 אנגלית regular shahaf']);
    expect(wednesday!.changeCount).toBe(0);
  });

  it('shows the calendar without cancelled events or the "בית ספר" mirror, and only open tasks', () => {
    const [tuesday] = build(['2026-09-01']);
    const events = tuesday!.timeline.flatMap((i) => (i.kind === 'event' ? [i.event.summary] : []));
    const tasks = tuesday!.timeline.flatMap((i) => (i.kind === 'task' ? [i.task.title] : []));
    expect(events).toEqual(['חוג']);
    expect(tasks).toEqual(['לקנות מחברת']);
  });

  it('keeps the grade\'s exam calendar off the timeline when the server names it', () => {
    const withExamCalendar = [
      ...GOOGLE,
      { kind: 'calendar' as const, naturalKey: 'exams', partition: null, payload: { id: 'exams', summary: 'לוח מבחנים י״ב', primary: false, color: null } },
      { kind: 'calendar_event' as const, naturalKey: 'exams|m', partition: 'exams', payload: { googleId: 'm', calendarId: 'exams', calendarSummary: 'לוח מבחנים י״ב', summary: 'יב מבחן באנגלית', location: null, start: '2026-09-01', end: '2026-09-02', allDay: true, cancelled: false } },
    ];
    const summaries = (calendars?: { school: string | null; exam: string | null }) =>
      buildLocalDays({ feed: FEED, mashov: MASHOV, bagrut: [], google: withExamCalendar, settings: settings(), calendars, zone: ZONE, now: NOW }, ['2026-09-01'])[0]!
        .timeline.flatMap((i) => (i.kind === 'event' ? [i.event.summary] : []));
    expect(summaries()).toContain('יב מבחן באנגלית');
    expect(summaries({ school: 'school', exam: 'exams' })).toEqual(['חוג']);
  });

  it('keeps a device\'s own "בית ספר" calendar and its class\'s exam calendar off the timeline', () => {
    const withCalendars = [
      // The phone's own mirror in place of the server's.
      ...GOOGLE.filter((e) => e.naturalKey !== 'school' && e.partition !== 'school'),
      { kind: 'calendar' as const, naturalKey: 'phone-cal', partition: null, payload: { id: 'phone-cal', summary: 'בית ספר', primary: false, color: null } },
      { kind: 'calendar_event' as const, naturalKey: 'phone-cal|p', partition: 'phone-cal', payload: { googleId: 'p', calendarId: 'phone-cal', calendarSummary: 'בית ספר', summary: 'מבחן (מהטלפון)', location: null, start: '2026-09-01T08:00:00+03:00', end: '2026-09-01T09:00:00+03:00', allDay: false, cancelled: false } },
      { kind: 'calendar' as const, naturalKey: 'exams', partition: null, payload: { id: 'exams', summary: 'לוח מבחנים י״ב', primary: false, color: null } },
      { kind: 'calendar_event' as const, naturalKey: 'exams|m', partition: 'exams', payload: { googleId: 'm', calendarId: 'exams', calendarSummary: 'לוח מבחנים י״ב', summary: 'יב מבחן באנגלית', location: null, start: '2026-09-01', end: '2026-09-02', allDay: true, cancelled: false } },
    ];
    const events = (calendars: ReturnType<typeof deviceCalendars>) =>
      buildLocalDays({ feed: FEED, mashov: MASHOV, bagrut: [], google: withCalendars, settings: settings(), calendars, zone: ZONE, now: NOW }, ['2026-09-01'])[0]!
        .timeline.flatMap((i) => (i.kind === 'event' ? [i.event.summary] : []));

    // What a device had before: nothing named, so the exam calendar's exams showed twice.
    expect(events({ school: null, exam: null })).toContain('יב מבחן באנגלית');

    // The class follows the exam calendar, and the phone made its "בית ספר" calendar.
    const following: ClassFeed = { ...FEED, class: { ...FEED.class, examCalendarId: 'exams' } };
    const calendars = deviceCalendars('phone-cal', following);
    expect(calendars).toEqual({ school: 'phone-cal', exam: 'exams' });
    expect(events(calendars)).toEqual(['חוג']);

    // Without its id, the phone's calendar is still kept off by its name.
    expect(deviceCalendars(null, following)).toEqual({ school: null, exam: 'exams' });
    expect(events(deviceCalendars(null, following))).toEqual(['חוג']);
    expect(deviceCalendars(null, null)).toEqual({ school: null, exam: null });
  });

  it('dates homework by the next lesson, and carries the feed\'s exams and events', () => {
    const [tuesday, wednesday, thursday] = build(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(wednesday!.homework.map((h) => h.naturalKey)).toEqual(['hw-1']);
    expect(tuesday!.homework).toEqual([]);
    expect(thursday!.examsToday.map((e) => e.subject)).toEqual(['מבחן באנגלית']);
    expect(wednesday!.events.map((e) => e.title)).toEqual(['טקס']);
  });
});

describe("the phone's week, widget feed and homework state", () => {
  const src = (over: Partial<Parameters<typeof buildLocalDays>[0]> = {}) =>
    ({ feed: FEED, mashov: MASHOV, bagrut: [], google: GOOGLE, settings: settings(), zone: ZONE, now: NOW, ...over });

  it('builds the week from Sunday, with its exams read off the days', () => {
    const week = localWeek(src(), 0);
    expect(week.days.map((d) => d.date)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(week.exams.map((e) => e.subject)).toEqual(['מבחן באנגלית']);
  });

  it('builds the widget feed around today, with every open task', () => {
    const feed = localWidgetFeed(src());
    expect(feed.days.map((d) => d.date)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
    expect(JSON.stringify(feed)).toContain('לקנות מחברת');
    expect(JSON.stringify(feed)).not.toContain('כבר נעשה');
  });

  it("shows homework the owner ticked off as done, as the server would", () => {
    const [wednesday] = buildLocalDays(src({ homeworkState: { 'hw-1': { done: true, linkedTaskId: null } } }), ['2026-09-02']);
    expect(wednesday!.homework[0]).toMatchObject({ naturalKey: 'hw-1', done: true });
    // Homework made into a task gives way to the task, as on the server.
    const [linked] = buildLocalDays(src({ homeworkState: { 'hw-1': { done: false, linkedTaskId: 't1' } } }), ['2026-09-02']);
    expect(linked!.homework).toEqual([]);
  });
});
