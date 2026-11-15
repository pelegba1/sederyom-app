/**
 * The morning summary and the evening reminder on the phone
 * (app/src/notify/summaries.ts, plan Phase 2): the shared rules
 * (`@sederyom/shared/logic/summaries`, which the server's own tests in
 * morning.test.ts and evening.test.ts cover word for word), when the next
 * one is due, and what the phone schedules from the days it builds itself.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ClassFeed, ClassLesson, DayView, Exam, HomeworkItem, Task, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { buildDayView } from '@sederyom/shared/logic/build';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import {
  eveningReminderOff, isSuppressedByQuietHours, planEveningReminder, planMorningSummary,
} from '@sederyom/shared/logic/summaries';
import { DateTime } from 'luxon';
import { buildLocalDays, type LocalSources } from '../../app/src/local/days';
import type { HomeworkStates } from '../../app/src/local/homeworkState';
import {
  planLocalSummaries, SETTLE_MS, SUMMARY_DAYS, summaryId, type SummaryAction, type SummaryKind,
} from '../../app/src/notify/summaries';

const ZONE = 'Asia/Jerusalem';

/** `HH:mm` on `date`, Jerusalem time, as an instant. */
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toJSDate();

/** The isolates and word joiners the phone adds (`isolateRanges`), out of the way of the words. */
const plain = (text: string) => text.replace(/[⁠⁦-⁩]/g, '');

// ---- the shared rules ----

const settings = (over: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, ...over });
const switches = (over: Partial<UserSettings['notifications']>) => ({ notifications: { ...DEFAULT_SETTINGS.notifications, ...over } });

describe('quiet hours', () => {
  it('never hold back the morning summary, and silence the evening reminder inside them', () => {
    const s = settings();
    expect(isSuppressedByQuietHours('morning_summary', s, '05:00')).toBe(false);
    expect(isSuppressedByQuietHours('evening_homework', s, '23:30')).toBe(true);
    expect(isSuppressedByQuietHours('evening_homework', s, '05:00')).toBe(true);
    // From the start, up to the end.
    expect(isSuppressedByQuietHours('evening_homework', s, '23:00')).toBe(true);
    expect(isSuppressedByQuietHours('evening_homework', s, '06:30')).toBe(false);
    expect(isSuppressedByQuietHours('evening_homework', s, '22:59')).toBe(false);
    expect(isSuppressedByQuietHours('evening_homework', settings({ quietHours: { enabled: false, from: '23:00', to: '06:30' } }), '23:30')).toBe(false);
    // A window that does not cross midnight.
    expect(isSuppressedByQuietHours('evening_homework', settings({ quietHours: { enabled: true, from: '19:00', to: '21:00' } }), '20:00')).toBe(true);
  });
});

describe('an evening that gets no reminder, whatever is due', () => {
  it('by the switch, "חופש", quiet hours at its time, and Friday', () => {
    const wednesday = '2026-10-07';
    expect(eveningReminderOff(settings(), wednesday, '20:00', ZONE)).toBe(false);
    expect(eveningReminderOff(settings(switches({ evening_homework: false })), wednesday, '20:00', ZONE)).toBe(true);
    expect(eveningReminderOff(settings({ vacationMode: true }), wednesday, '20:00', ZONE)).toBe(true);
    expect(eveningReminderOff(settings(), wednesday, '23:30', ZONE)).toBe(true);
    expect(eveningReminderOff(settings(), '2026-10-09', '20:00', ZONE)).toBe(true);
  });
});

function viewOf(date: string, opts: { lessons?: number; homework?: HomeworkItem[]; exams?: Exam[]; tasks?: Task[]; vacationMode?: boolean } = {}): DayView {
  const day = buildDayView({
    date, zone: ZONE, now: at(date, '06:00'), events: [], tasks: opts.tasks ?? [], exams: opts.exams ?? [], schoolEvents: [],
    vacationMode: opts.vacationMode ?? false,
    lessons: Array.from({ length: opts.lessons ?? 0 }, (_v, i) => ({
      date, hourIndex: i + 1, startTime: `0${8 + i}:00`, endTime: `0${8 + i}:45`, subject: 'אנגלית', teacher: null, room: null,
      status: 'regular' as const, substitute: null, note: null, source: 'shahaf' as const, changeSeenAt: null,
    })),
  });
  return { ...day, homework: opts.homework ?? [] };
}

describe('the morning summary, decided', () => {
  it('goes out on a school day, opening that day', () => {
    const push = planMorningSummary(viewOf('2026-10-07', { lessons: 2 }), settings(), ZONE)!;
    expect(push.title).toBe('08:00–09:45 · 2 שיעורים');
    expect(push.payload).toEqual({ type: 'morning_summary', deepLink: 'today', date: '2026-10-07', refreshWidget: true });
  });

  it('stays quiet on Saturday, a holiday, "חופש", a Friday without lessons, and with the switch off', () => {
    expect(planMorningSummary(viewOf('2026-10-10', { lessons: 2 }), settings(), ZONE)).toBeNull();
    // Monday 21.9.2026 is Yom Kippur.
    expect(planMorningSummary(viewOf('2026-09-21', { lessons: 2 }), settings(), ZONE)).toBeNull();
    expect(planMorningSummary(viewOf('2026-10-07', { lessons: 2, vacationMode: true }), settings({ vacationMode: true }), ZONE)).toBeNull();
    expect(planMorningSummary(viewOf('2026-10-09'), settings(), ZONE)).toBeNull();
    expect(planMorningSummary(viewOf('2026-10-07', { lessons: 2 }), settings(switches({ morning_summary: false })), ZONE)).toBeNull();
  });

  it('goes out on a Friday that has lessons', () => {
    expect(planMorningSummary(viewOf('2026-10-09', { lessons: 1 }), settings(), ZONE)?.payload.date).toBe('2026-10-09');
  });
});

const hw = (date: string, subject: string, text: string, done = false): HomeworkItem => ({
  naturalKey: `hw|${subject}|${date}`, dueDate: date, subject, text, linkedTaskId: null, done,
});

/** `from` and the seven days after it; `extra` adds to a day by date. */
function weekFrom(from: string, extra: Record<string, Parameters<typeof viewOf>[1]> = {}): [DayView, DayView[]] {
  const days = Array.from({ length: 8 }, (_v, i) => {
    const date = DateTime.fromISO(from, { zone: ZONE }).plus({ days: i }).toISODate()!;
    return viewOf(date, extra[date] ?? {});
  });
  return [days[0]!, days.slice(1)];
}

describe('the evening reminder, decided', () => {
  const plan = (from: string, extra: Record<string, Parameters<typeof viewOf>[1]>, s = settings(), time = '20:00') => {
    const [today, ahead] = weekFrom(from, extra);
    return planEveningReminder(today, ahead, s, { zone: ZONE, time });
  };

  it('on an ordinary evening is about tomorrow', () => {
    const push = plan('2026-10-07', { '2026-10-07': { lessons: 1 }, '2026-10-08': { lessons: 1, homework: [hw('2026-10-08', 'היסטוריה', 'פרק 3')] } })!;
    expect(push.title).toBe('מחר להגיש: היסטוריה');
    expect(push.payload).toEqual({ type: 'evening_homework', deepLink: 'today', date: '2026-10-08', refreshWidget: true });
  });

  it('on a Thursday is about Sunday when Friday has no lessons, and about Friday when it has', () => {
    const sunday = { lessons: 1, homework: [hw('2026-10-11', 'אנגלית', 'unit 4')] };
    expect(plan('2026-10-08', { '2026-10-08': { lessons: 1 }, '2026-10-11': sunday })?.title).toBe('ביום ראשון להגיש: אנגלית');
    const friday = { lessons: 1, homework: [hw('2026-10-09', 'פיזיקה', 'שאלות')] };
    expect(plan('2026-10-08', { '2026-10-08': { lessons: 1 }, '2026-10-09': friday, '2026-10-11': sunday })?.title).toBe('מחר להגיש: פיזיקה');
  });

  it('on Saturday evening is about Sunday, as "מחר"', () => {
    expect(plan('2026-10-10', { '2026-10-11': { homework: [hw('2026-10-11', 'אנגלית', 'unit 4')] } })?.title).toBe('מחר להגיש: אנגלית');
  });

  it('stays quiet on Friday evening, inside quiet hours, on "חופש", with the switch off, and with nothing due', () => {
    const due = { '2026-10-11': { homework: [hw('2026-10-11', 'אנגלית', 'unit 4')] } };
    expect(plan('2026-10-09', due)).toBeNull();
    const thursday = { '2026-10-08': { lessons: 1, homework: [hw('2026-10-08', 'היסטוריה', 'פרק 3')] } };
    expect(plan('2026-10-07', thursday, settings(), '23:30')).toBeNull();
    // The same evening with the quiet hours off goes out.
    expect(plan('2026-10-07', thursday, settings({ quietHours: { enabled: false, from: '23:00', to: '06:30' } }), '23:30')).not.toBeNull();
    expect(plan('2026-10-07', thursday, settings({ vacationMode: true }))).toBeNull();
    expect(plan('2026-10-07', thursday, settings(switches({ evening_homework: false })))).toBeNull();
    expect(plan('2026-10-07', { '2026-10-08': { lessons: 1 } })).toBeNull();
  });

  it('names a task made from homework by its homework, and by its own title when the homework is gone', () => {
    const task = (id: string, title: string, key: string): Task => ({
      id, listId: 'l', listTitle: null, title, notes: null, due: '2026-10-08', completed: false, updated: null, linkedHomeworkKey: key,
    });
    const [today, ahead] = weekFrom('2026-10-07', {
      '2026-10-07': { lessons: 1 },
      '2026-10-08': { lessons: 1, tasks: [task('t1', 'לעשות את זה', 'hw-en'), task('t2', 'מתמטיקה: דף עבודה', 'hw-gone')] },
    });
    const linked = new Map([['hw-en', { subject: 'אנגלית 5 יח"ל (יב2)', text: 'unit 4', done: false }]]);
    const push = planEveningReminder(today, ahead, settings(), { zone: ZONE, time: '20:00', linked })!;
    expect(push.title).toBe('מחר להגיש: אנגלית, מתמטיקה: דף עבודה');
    expect(push.body.split('\n')).toEqual(['אנגלית: unit 4', 'מתמטיקה: דף עבודה']);
  });
});

// ---- on the phone, from the days it builds ----

// Wednesday 7.10.2026, mid-morning: the next summary is Thursday's, the next reminder this evening's.
const NOW = at('2026-10-07', '10:00');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });
afterAll(() => vi.useRealTimers());

const lesson = (date: string, hourIndex: number, startTime: string, endTime: string, subject: string, status: ClassLesson['status'] = 'regular'): ClassLesson => ({
  date, hourIndex, startTime, endTime, subject, teacher: null, room: null, status, substitute: null, note: null,
});

const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: NOW.toISOString(),
  freshness: null,
  lessons: [
    lesson('2026-10-07', 1, '08:00', '08:45', 'אנגלית'),
    lesson('2026-10-08', 1, '08:00', '08:45', 'אנגלית'),
    lesson('2026-10-08', 2, '08:45', '09:30', 'פיזיקה'),
    lesson('2026-10-08', 3, '09:45', '10:30', 'היסטוריה', 'cancelled'),
    lesson('2026-10-11', 1, '08:00', '08:45', 'מתמטיקה'),
    // Monday: every lesson cancelled. Nothing after it.
    lesson('2026-10-12', 1, '08:00', '08:45', 'אנגלית', 'cancelled'),
    lesson('2026-10-12', 2, '08:45', '09:30', 'פיזיקה', 'cancelled'),
  ],
  changes: [],
  exams: [],
  events: [],
  messages: [],
};

const homework = (naturalKey: string, dueDate: string, subject: string, text: string) =>
  ({ source: 'mashov', kind: 'homework', naturalKey, payload: { dueDate, subject, text, dueExplicit: true } }) as unknown as NormalizedEntity;

const MASHOV = [
  homework('hw-hist', '2026-10-08', 'היסטוריה', 'לקרוא פרק 3'),
  // Made into the task below on the phone: the task stands for it.
  homework('hw-en', '2026-10-08', 'אנגלית 5 יח"ל (יב2)', 'unit 4'),
  homework('hw-sun', '2026-10-11', 'מתמטיקה', 'תרגילים 1–5'),
];

const taskEntity = (googleId: string, title: string, due: string): KeptEntity => ({
  kind: 'task', naturalKey: `l|${googleId}`, partition: 'l',
  payload: { googleId, listId: 'l', listTitle: 'משימות', title, notes: null, due, completed: false, deleted: false, updated: null },
});

const GOOGLE = [taskEntity('t-en', 'לסיים את unit 4', '2026-10-08')];

const STATES: HomeworkStates = { 'hw-en': { done: false, linkedTaskId: 't-en' } };

function sources(over: {
  settings?: Partial<UserSettings>; homeworkState?: HomeworkStates; now?: Date; feed?: ClassFeed | null; mashov?: NormalizedEntity[];
} = {}): LocalSources {
  return {
    feed: over.feed === undefined ? FEED : over.feed, mashov: over.mashov ?? MASHOV, bagrut: [], google: GOOGLE,
    settings: settings({ classId: '7', className: 'יב2', ...over.settings }),
    homeworkState: over.homeworkState ?? STATES, zone: ZONE, now: over.now ?? NOW,
  };
}

describe('the phone\'s days know which task was made from which homework', () => {
  it('reads the link back off the homework', () => {
    const [thursday] = buildLocalDays(sources(), ['2026-10-08']);
    const tasks = thursday!.timeline.flatMap((i) => (i.kind === 'task' ? [i.task] : []));
    expect(tasks.map((t) => [t.id, t.linkedHomeworkKey])).toEqual([['t-en', 'hw-en']]);
    // The homework itself left the day: the task stands for it.
    expect(thursday!.homework.map((h) => h.naturalKey)).toEqual(['hw-hist']);
    expect(buildLocalDays(sources({ homeworkState: {} }), ['2026-10-08'])[0]!.timeline.find((i) => i.kind === 'task')).toMatchObject({ task: { linkedHomeworkKey: null } });
  });
});

/** One day's action, by kind and date. */
const find = (plan: SummaryAction[], kind: SummaryKind, date: string): SummaryAction => {
  const action = plan.find((a) => a.identifier === summaryId(kind, date));
  if (!action) throw new Error(`no action for ${kind} ${date}`);
  return action;
};

/** Each day's action of one kind, in date order: `[date, action]`. */
const actionsOf = (plan: SummaryAction[], kind: SummaryKind) => plan.filter((a) => a.kind === kind).map((a) => [a.date, a.action]);

/** The plan at `now`, with the clock there too (the days know today by it). */
function planAt(now: Date, over: Parameters<typeof sources>[0] = {}): SummaryAction[] {
  vi.setSystemTime(now);
  try {
    return planLocalSummaries(sources({ ...over, now }), now, ZONE);
  } finally {
    vi.setSystemTime(NOW);
  }
}

describe('what the phone schedules', () => {
  it('a notification per day for each, from today on, under an identifier with its date', () => {
    const plan = planLocalSummaries(sources(), NOW, ZONE);
    expect(plan).toHaveLength(2 * SUMMARY_DAYS);
    expect(new Set(plan.map((a) => a.identifier)).size).toBe(plan.length);
    expect(plan.filter((a) => a.kind === 'morning').map((a) => a.date)).toEqual([
      '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
    ]);
    expect(find(plan, 'morning', '2026-10-08').identifier).toBe('sederyom-morning-summary|2026-10-08');
    expect(find(plan, 'evening', '2026-10-07').identifier).toBe('sederyom-evening-reminder|2026-10-07');
  });

  it('Thursday morning at 07:00 and this evening at 20:00, in the server words', () => {
    const plan = planLocalSummaries(sources(), NOW, ZONE);

    const morning = find(plan, 'morning', '2026-10-08');
    expect(morning.action).toBe('schedule');
    expect(morning.at).toEqual(at('2026-10-08', '07:00'));
    expect(plain(morning.note!.title)).toBe('הלימודים נגמרים ב־09:30 · שיעור אחד בוטל');
    expect(plain(morning.note!.body).split('\n')).toEqual(['08:00–09:30 · אנגלית, פיזיקה', 'להגשה היום: היסטוריה', 'משימה אחת להיום']);
    expect(morning.note!.data).toEqual({ type: 'morning_summary', deepLink: 'today', date: '2026-10-08', refreshWidget: true });

    const evening = find(plan, 'evening', '2026-10-07');
    expect(evening.action).toBe('schedule');
    expect(evening.at).toEqual(at('2026-10-07', '20:00'));
    // The task made from the English homework is named by that homework, as the server names it.
    expect(plain(evening.note!.title)).toBe('מחר להגיש: היסטוריה, אנגלית');
    expect(plain(evening.note!.body).split('\n')).toEqual(['היסטוריה: לקרוא פרק 3', 'אנגלית: unit 4']);
    expect(evening.note!.data).toEqual({ type: 'evening_homework', deepLink: 'today', date: '2026-10-08', refreshWidget: true });
  });

  it('every day of the week ahead: the ones that get none are cancelled, the school days after them stay scheduled', () => {
    const plan = planLocalSummaries(sources(), NOW, ZONE);
    expect(actionsOf(plan, 'morning')).toEqual([
      // This morning's time passed: left alone, it may still be on its way.
      ['2026-10-07', 'keep'],
      ['2026-10-08', 'schedule'],
      // Friday without lessons, Shabbat.
      ['2026-10-09', 'cancel'],
      ['2026-10-10', 'cancel'],
      ['2026-10-11', 'schedule'],
      // Every lesson cancelled is still news.
      ['2026-10-12', 'schedule'],
      // The feed has no lessons for these days, and there is no Mashov grid: nothing to say.
      ['2026-10-13', 'cancel'],
      ['2026-10-14', 'cancel'],
    ]);
    expect(actionsOf(plan, 'evening')).toEqual([
      ['2026-10-07', 'schedule'],
      // Thursday: about Sunday. Friday evening says nothing, Saturday evening is about Sunday again.
      ['2026-10-08', 'schedule'],
      ['2026-10-09', 'cancel'],
      ['2026-10-10', 'schedule'],
      // Nothing due on the days after.
      ['2026-10-11', 'cancel'],
      ['2026-10-12', 'cancel'],
      ['2026-10-13', 'cancel'],
      ['2026-10-14', 'cancel'],
    ]);
    expect(plain(find(plan, 'evening', '2026-10-08').note!.title)).toBe('ביום ראשון להגיש: מתמטיקה');
    expect(find(plan, 'evening', '2026-10-08').note!.data.date).toBe('2026-10-11');
    expect(plain(find(plan, 'evening', '2026-10-10').note!.title)).toBe('מחר להגיש: מתמטיקה');
    expect(plain(find(plan, 'morning', '2026-10-11').note!.title)).toBe('08:00–08:45 · שיעור אחד');
    expect(plain(find(plan, 'morning', '2026-10-12').note!.title)).toBe('אין שיעורים היום · 2 בוטלו');
  });

  it('pins a range left to right, as the server does before sending, and plans the same twice', () => {
    const plan = planLocalSummaries(sources(), NOW, ZONE);
    expect(find(plan, 'morning', '2026-10-08').note!.body.startsWith('⁦08:00')).toBe(true);
    expect(planLocalSummaries(sources(), NOW, ZONE)).toEqual(plan);
  });

  it('leaves out homework ticked off, on the phone', () => {
    const plan = planLocalSummaries(sources({ homeworkState: { ...STATES, 'hw-hist': { done: true, linkedTaskId: null } } }), NOW, ZONE);
    expect(plain(find(plan, 'evening', '2026-10-07').note!.title)).toBe('מחר להגיש: אנגלית');
    expect(plain(find(plan, 'morning', '2026-10-08').note!.body)).not.toContain('להגשה היום');
  });

  it('a refresh just after the time leaves that one alone, scheduled or late, and plans the days after', () => {
    // 20:05: tonight's reminder may not have been shown yet (Android delivers it late). Neither
    // replaced with tomorrow's nor cancelled: it is not in the plan to do anything with.
    const late = planAt(at('2026-10-07', '20:05'));
    expect(find(late, 'evening', '2026-10-07').action).toBe('keep');
    expect(find(late, 'evening', '2026-10-07').note).toBeNull();
    expect(find(late, 'evening', '2026-10-08').action).toBe('schedule');

    // Inside the last minute before it, too: the trigger would reach the system already past.
    expect(find(planAt(new Date(at('2026-10-07', '20:00').getTime() - SETTLE_MS + 1_000)), 'evening', '2026-10-07').action).toBe('keep');
    expect(find(planAt(at('2026-10-07', '19:58')), 'evening', '2026-10-07').action).toBe('schedule');
  });

  it('Thursday 21:00: Friday and Shabbat get none, and Saturday night and Sunday morning are pending already', () => {
    const plan = planAt(at('2026-10-08', '21:00'));
    expect(find(plan, 'evening', '2026-10-08').action).toBe('keep');
    expect(find(plan, 'morning', '2026-10-09').action).toBe('cancel');
    expect(find(plan, 'evening', '2026-10-09').action).toBe('cancel');
    expect(find(plan, 'morning', '2026-10-10').action).toBe('cancel');

    const saturday = find(plan, 'evening', '2026-10-10');
    expect([saturday.action, saturday.at]).toEqual(['schedule', at('2026-10-10', '20:00')]);
    expect(plain(saturday.note!.title)).toBe('מחר להגיש: מתמטיקה');
    const sunday = find(plan, 'morning', '2026-10-11');
    expect([sunday.action, sunday.at]).toEqual(['schedule', at('2026-10-11', '07:00')]);
  });

  it('on Saturday: no summary that morning, and ״מחר״ for Sunday that evening', () => {
    const plan = planAt(at('2026-10-10', '05:00'));
    expect(find(plan, 'morning', '2026-10-10')).toMatchObject({ action: 'cancel', at: at('2026-10-10', '07:00') });
    expect(plain(find(plan, 'evening', '2026-10-10').note!.title)).toBe('מחר להגיש: מתמטיקה');
  });

  it('by the switches, ״חופש״ and the quiet hours', () => {
    const scheduled = (plan: SummaryAction[], kind: SummaryKind) => plan.filter((a) => a.kind === kind && a.action === 'schedule');

    const off = planLocalSummaries(sources({ settings: switches({ morning_summary: false, evening_homework: false }) }), NOW, ZONE);
    expect(off.filter((a) => a.action === 'schedule')).toEqual([]);

    const vacation = planLocalSummaries(sources({ settings: { vacationMode: true } }), NOW, ZONE);
    expect(vacation.filter((a) => a.action === 'schedule')).toEqual([]);

    // An evening time inside the quiet hours sends nothing (as Settings warns); a morning one still goes out.
    const quiet = planLocalSummaries(sources({ settings: { eveningReminderTime: '23:30', morningSummaryTime: '06:00' } }), NOW, ZONE);
    expect(scheduled(quiet, 'evening')).toEqual([]);
    expect(find(quiet, 'evening', '2026-10-07')).toMatchObject({ action: 'cancel', at: at('2026-10-07', '23:30') });
    expect(find(quiet, 'morning', '2026-10-08')).toMatchObject({ action: 'schedule', at: at('2026-10-08', '06:00') });
  });

  it('nothing before a class is picked: no timetable to summarize', () => {
    const plan = planLocalSummaries(sources({ settings: { classId: '', className: '' } }), NOW, ZONE);
    expect(plan.filter((a) => a.action === 'schedule')).toEqual([]);
  });

  it('nothing while the phone has no timetable from anywhere: no ״אין שיעורים היום״ on a school day', () => {
    // The class feed not read yet (the first read comes within a quarter hour), and no Mashov grid.
    for (const feed of [null, { ...FEED, lastOkAt: null, lessons: [] }]) {
      const plan = planLocalSummaries(sources({ feed }), NOW, ZONE);
      // Not even the evening, though history is due tomorrow: which day is next is not known.
      expect(plan.filter((a) => a.action === 'schedule')).toEqual([]);
    }
  });

  it('with Mashov grid, a week the site has not published yet still gets its mornings', () => {
    const slot = {
      source: 'mashov', kind: 'timetable_slot', naturalKey: 'slot|0|1',
      payload: { dayOfWeek: 0, hourIndex: 1, subject: 'ספרות', teacher: null, room: null, startTime: '08:00', endTime: '08:45' },
    } as unknown as NormalizedEntity;
    // Thursday 15.10: the feed ends in this week; Sunday 18.10 starts one it has nothing for.
    const thursday = at('2026-10-15', '10:00');
    expect(find(planAt(thursday), 'morning', '2026-10-18').action).toBe('cancel');
    const sunday = find(planAt(thursday, { mashov: [...MASHOV, slot] }), 'morning', '2026-10-18');
    expect(sunday.action).toBe('schedule');
    expect(plain(sunday.note!.body)).toContain('ספרות');
  });

  it('follows the times in the settings, and never schedules in the past or inside the last minute', () => {
    const plan = planLocalSummaries(sources({ settings: { morningSummaryTime: '06:45', eveningReminderTime: '09:00' } }), NOW, ZONE);
    expect(find(plan, 'morning', '2026-10-08').at).toEqual(at('2026-10-08', '06:45'));
    // 09:00 passed this morning: today's is left alone, tomorrow's is planned.
    expect(find(plan, 'evening', '2026-10-07').action).toBe('keep');
    expect(find(plan, 'evening', '2026-10-08').at).toEqual(at('2026-10-08', '09:00'));

    for (const now of [at('2026-10-07', '00:00'), at('2026-10-07', '06:59'), at('2026-10-07', '07:00'), at('2026-10-07', '20:00'), at('2026-10-07', '23:59')]) {
      for (const a of planAt(now)) {
        if (a.action === 'schedule') expect(a.at!.getTime()).toBeGreaterThan(now.getTime() + SETTLE_MS);
        if (a.at && a.at.getTime() <= now.getTime() + SETTLE_MS) expect(a.action).toBe('keep');
      }
    }
  });

  it('keeps the wall time across the end of summer time', () => {
    // Sunday 25.10.2026 is on winter time: 07:00 there is 05:00 UTC, not 04:00.
    expect(find(planAt(at('2026-10-24', '20:00')), 'morning', '2026-10-25').at!.toISOString()).toBe('2026-10-25T05:00:00.000Z');
  });

  it('without sources, cancels every one, today too', () => {
    const plan = planLocalSummaries(null, NOW, ZONE);
    expect(plan).toHaveLength(2 * SUMMARY_DAYS);
    expect(plan.every((a) => a.action === 'cancel' && a.note === null)).toBe(true);
    // Today's included, though with sources it is left alone.
    expect(find(plan, 'morning', '2026-10-07').action).toBe('cancel');
    expect(find(planLocalSummaries(sources(), NOW, ZONE), 'morning', '2026-10-07').action).toBe('keep');
  });
});
