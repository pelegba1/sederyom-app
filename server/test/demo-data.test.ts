/**
 * The demo's made-up student (app/src/demo/data.ts): a full week for whatever
 * day it is built on, Friday and Saturday included, placed around that day,
 * with a change and an exam where the first screens look, through the
 * phone's own days, and with no name or id from the real data the tests keep.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DayView } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { buildAttendance } from '@sederyom/shared/logic/attendance';
import type { MashovGrade } from '@sederyom/shared/logic/mashov/normalize';
import { mergeSettings } from '@sederyom/shared/logic/options';
import { addDays, sundayIndex, weekStart } from '@sederyom/shared/logic/time';
import { DEMO_CLASS, DEMO_PEOPLE, DEMO_SITE, demoData, demoSettings, demoStatus } from '../../app/src/demo/data';
import { byRisk, standing } from '../../app/src/lib/attendance';
import { EMPTY_PREFS, buildSubjects, plainAverage } from '../../app/src/lib/bagrut';
import { CATALOG } from '../../app/src/lib/bagrutCatalog';
import { groupGradesBySubject, messageSummary } from '../../app/src/lib/school';
import { buildLocalDays, type LocalSources } from '../../app/src/local/days';
import { localAgenda, localWeek, localWidgetFeed } from '../../app/src/local/views';

const ZONE = 'Asia/Jerusalem';

/** A plain school week, no holiday in it: Sunday 1.11.2026 to Saturday 7.11.2026. */
const WEEK = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const at = (date: string, time = '10:00') => new Date(`${date}T${time}:00+02:00`);

/** The demo's sources as the phone builds from them (`demo/phone.ts`), without the phone's stores. */
function sources(now: Date): LocalSources {
  const demo = demoData(now, ZONE);
  const today = now.toISOString().slice(0, 10);
  return {
    feed: demo.feed, mashov: demo.mashov, bagrut: demo.bagrut, google: demo.google,
    settings: demoSettings(mergeSettings(null, today)), calendars: { school: null, exam: null },
    changeSeen: demo.changeSeen, homeworkState: demo.homeworkState, zone: ZONE, now,
  };
}

const lessonsOf = (day: DayView) => day.timeline.flatMap((i) => (i.kind === 'lesson' ? [i.lesson] : []));
const range = (from: string, count: number) => Array.from({ length: count }, (_v, i) => addDays(from, i, ZONE));

describe('the demo, on every day of the week', () => {
  for (const today of WEEK) {
    it(`builds a full week around ${today}`, () => {
      vi.useFakeTimers({ toFake: ['Date'], now: at(today) });
      try {
        const now = at(today);
        const src = sources(now);
        const week = localWeek(src, 0);

        // Every school day of the week holds lessons, seven to nine of them, and Friday four.
        expect(week.days).toHaveLength(6);
        for (const day of week.days) {
          const count = lessonsOf(day).length;
          if (sundayIndex(day.date, ZONE) === 5) expect(count).toBe(4);
          else expect(count).toBeGreaterThanOrEqual(7);
          expect(count).toBeLessThanOrEqual(9);
        }
        // The week after is the site's too, and the one after that Mashov's grid.
        expect(localWeek(src, 1).days.every((d) => lessonsOf(d).length >= 4)).toBe(true);
        expect(localWeek(src, 2).days.flatMap(lessonsOf).every((l) => l.source === 'mashov')).toBe(true);

        // The next seven days: the substitute on the first school day from today, the cancellation on the next.
        const days = buildLocalDays(src, range(today, 8));
        const statuses = days.flatMap(lessonsOf).map((l) => l.status);
        expect(statuses).toContain('substitution');
        expect(statuses).toContain('cancelled');
        const changed = days.find((d) => d.changeCount > 0)!;
        expect(changed.date).toBe(sundayIndex(today, ZONE) === 6 ? addDays(today, 1, ZONE) : today);
        // Marked new, as a change the phone just saw.
        expect(lessonsOf(changed).find((l) => l.status !== 'regular')?.changeSeenAt).not.toBeNull();

        // An exam within two weeks, said on the day it is next.
        const exams = buildLocalDays(src, range(today, 15)).flatMap((d) => d.examsToday);
        expect(exams.length).toBeGreaterThanOrEqual(2);
        expect(days[0]!.nextExam).not.toBeNull();

        // A school event, homework due on the next school days, one of it ticked.
        expect(buildLocalDays(src, range(today, 15)).some((d) => d.events.length > 0)).toBe(true);
        const homework = days.flatMap((d) => d.homework);
        expect(homework.length).toBeGreaterThanOrEqual(4);
        expect(homework.filter((h) => h.done)).toHaveLength(1);

        // The agenda and the widget have something on them too.
        expect(localAgenda(src).days.some((d) => d.items.length > 0)).toBe(true);
        const widget = localWidgetFeed(src);
        expect(widget.openTasks.length).toBeGreaterThan(0);
        expect(widget.upcomingExams.length).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });
  }
});

describe('the demo\'s dates', () => {
  it('move with today: a week later, everything is a week later', () => {
    // Two weeks with no day off anywhere near them (27.10 and Hanukkah are outside both).
    const a = demoData(at('2026-11-09'), ZONE);
    const b = demoData(at('2026-11-16'), ZONE);
    const dates = (d: ReturnType<typeof demoData>) => [
      ...d.feed.lessons.map((l) => `${l.date}|${l.hourIndex}|${l.status}`),
      ...d.feed.exams.map((e) => e.date ?? ''),
      ...d.feed.events.map((e) => e.date ?? ''),
      ...d.mashov.filter((e) => e.kind === 'homework').map((e) => (e.payload as { dueDate: string }).dueDate),
    ];
    expect(dates(b)).toEqual(dates(a).map((s) => s.replace(/^\d{4}-\d{2}-\d{2}/, (d) => addDays(d, 7, ZONE))));
  });

  it('keep the past behind today and the plans ahead of it', () => {
    const now = at('2026-11-03');
    const today = '2026-11-03';
    const demo = demoData(now, ZONE);
    const ofKind = <T>(kind: string) => demo.mashov.filter((e) => e.kind === kind).map((e) => e.payload as T);
    expect(ofKind<{ date: string }>('grade').every((g) => g.date < today)).toBe(true);
    expect(ofKind<{ date: string }>('attendance').every((a) => a.date < today)).toBe(true);
    expect(ofKind<{ date: string }>('message').every((m) => Date.parse(m.date) < now.getTime())).toBe(true);
    expect(ofKind<{ dueDate: string }>('homework').every((h) => h.dueDate >= today)).toBe(true);
    expect(demo.feed.exams.every((e) => e.date! > today && e.date! <= addDays(today, 21, ZONE))).toBe(true);
    expect(demo.notifications.every((n) => Date.parse(n.sentAt) < now.getTime())).toBe(true);
    // The site's lessons: last week, this week and next.
    const lessonDates = demo.feed.lessons.map((l) => l.date).sort();
    expect(lessonDates[0]).toBe(weekStart(today, -1, ZONE));
    expect(lessonDates.at(-1)).toBe(addDays(weekStart(today, 1, ZONE), 5, ZONE));
  });

  it('leave a day without school empty, and put the changes on the school days around it', () => {
    // Tuesday 27.10.2026 is election day.
    const demo = demoData(at('2026-10-25', '07:30'), ZONE);
    expect(demo.feed.lessons.some((l) => l.date === '2026-10-27')).toBe(false);
    expect(demo.feed.lessons.find((l) => l.status === 'substitution')?.date).toBe('2026-10-25');
    expect(demo.feed.lessons.find((l) => l.status === 'cancelled')?.date).toBe('2026-10-26');
    expect(demo.feed.exams.every((e) => e.date !== '2026-10-27')).toBe(true);
  });
});

describe('the demo\'s school', () => {
  const now = at('2026-11-03');
  const demo = demoData(now, ZONE);

  it('has grades, messages, bagrut with and without grades, and absences the tracker counts', () => {
    expect(demo.mashov.filter((e) => e.kind === 'grade').length).toBeGreaterThanOrEqual(3);
    expect(demo.mashov.filter((e) => e.kind === 'message').length).toBeGreaterThanOrEqual(2);
    expect(demo.bagrut.some((b) => b.finalGrade !== null)).toBe(true);
    expect(demo.bagrut.some((b) => b.finalGrade === null && b.registered)).toBe(true);
    const ofKind = <T>(kind: string) => demo.mashov.filter((e) => e.kind === kind).map((e) => e.payload as T);
    const attendance = buildAttendance({
      counts: ofKind('lesson_count'), events: ofKind('attendance'), slots: ofKind('timetable_slot'),
      settings: mergeSettings(null, '2026-11-03').attendance, today: '2026-11-03', zone: ZONE, fetchedAt: null,
    });
    expect(attendance.subjects.reduce((n, s) => n + s.absences + s.justifiedAbsences + s.lates, 0)).toBeGreaterThanOrEqual(4);
    expect(attendance.subjects.every((s) => s.held > 0 && s.remaining > 0)).toBe(true);
  });

  it('has a calendar and a task list of its own, one task done', () => {
    const tasks = demo.google.filter((e) => e.kind === 'task').map((e) => e.payload as { completed: boolean });
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    expect(tasks.filter((t) => t.completed)).toHaveLength(1);
    expect(demo.google.filter((e) => e.kind === 'calendar_event').length).toBeGreaterThan(5);
  });

  it('has two to four grades in each graded subject, so each shows an average, and two exam grades', () => {
    // As the phone shows them: Mashov's grades, each with when it was first seen.
    const grades = demo.mashov.filter((e) => e.kind === 'grade').map((e) => ({ ...(e.payload as MashovGrade), firstSeen: null }));
    const groups = groupGradesBySubject(grades);
    expect(groups.length).toBeGreaterThanOrEqual(6);
    for (const group of groups) {
      expect(group.grades.length, group.subject).toBeGreaterThanOrEqual(2);
      expect(group.grades.length, group.subject).toBeLessThanOrEqual(4);
      expect(group.average?.value ?? null, group.subject).not.toBeNull();
    }
    expect(grades.filter((g) => g.isExam)).toHaveLength(2);
    // Over the past weeks, not one day.
    expect(new Set(grades.map((g) => g.date)).size).toBeGreaterThanOrEqual(10);
  });

  it('has a complete bagrut subject, so the average card has an average and its units', () => {
    const subjects = buildSubjects(demo.bagrut, EMPTY_PREFS, CATALOG, '2026-11-03');
    const average = plainAverage(subjects);
    expect(average.value).not.toBeNull();
    expect(average.units).toBeGreaterThanOrEqual(2);
    expect(average.units).toBeLessThan(average.totalUnits);
  });

  it('puts an absence or a late on the subject the tracker lists first', () => {
    const ofKind = <T>(kind: string) => demo.mashov.filter((e) => e.kind === kind).map((e) => e.payload as T);
    const settings = mergeSettings(null, '2026-11-03').attendance;
    const attendance = buildAttendance({
      counts: ofKind('lesson_count'), events: ofKind('attendance'), slots: ofKind('timetable_slot'),
      settings, today: '2026-11-03', zone: ZONE, fetchedAt: null,
    });
    const rows = attendance.subjects.map((s) => ({ subject: s, standing: standing(s, attendance.limit, attendance.latesPerAbsence) })).sort(byRisk);
    const first = rows[0]!.subject;
    expect(first.absences + first.justifiedAbsences + first.lates).toBeGreaterThan(0);
  });

  it('has messages whose summary line reads what is meant: the start of the day and what to take, no stray "להביא"', () => {
    const messages = demo.mashov.filter((e) => e.kind === 'message').map((e) => e.payload as { naturalKey: string; title: string; body: string; date: string });
    const summary = (key: string) => messageSummary(messages.find((m) => m.naturalKey === key)!, '2026-11-03');
    expect(summary('demo-msg|sports')).toMatchObject({ time: '08:00', bring: 'כובע ובקבוק מים' });
    expect(summary('demo-msg|math')?.bring).toBe('מחשבון');
    expect(messages.every((m) => !/להביא שאלות/.test(m.body))).toBe(true);
  });

  it('is connected everywhere, with nothing to say, and sets its class', () => {
    expect(demoStatus(now).sources.every((s) => s.configured && s.message === null && !s.needsReauth)).toBe(true);
    const settings = demoSettings(DEFAULT_SETTINGS);
    expect([settings.classId, settings.className]).toEqual([DEMO_CLASS.id, DEMO_CLASS.name]);
  });

  it('writes nothing to Google: no exams in a Google calendar, though a new student has them on', () => {
    expect(DEFAULT_SETTINGS.examsToCalendar).toBe(true);
    expect(demoSettings(DEFAULT_SETTINGS).examsToCalendar).toBe(false);
  });
});

/** Every Hebrew word in the files of `dir`, at any depth. */
function words(dir: string, into = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) words(full, into);
    else for (const w of readFileSync(full, 'utf8').match(/[א-ת]{2,}/g) ?? []) into.add(w);
  }
  return into;
}

describe('the demo\'s people', () => {
  const demo = demoData(at('2026-11-03'), ZONE);

  it('are the demo\'s own: every teacher and sender is one of them', () => {
    const named = new Set([
      ...demo.feed.lessons.flatMap((l) => [l.teacher, l.substitute]),
      ...demo.mashov.filter((e) => e.kind === 'timetable_slot').map((e) => (e.payload as { teacher: string }).teacher),
      ...demo.mashov.filter((e) => e.kind === 'message').map((e) => (e.payload as { from: string }).from),
    ].filter((n): n is string => n !== null));
    expect([...named].every((n) => DEMO_PEOPLE.includes(n))).toBe(true);
    expect(named.size).toBe(DEMO_PEOPLE.length);
  });

  it('share no name with the real data the tests keep', () => {
    const fixtures = words(join(import.meta.dirname, 'fixtures'), words(join(import.meta.dirname, '..', 'fixtures')));
    expect(fixtures.size).toBeGreaterThan(500);
    const clashes = DEMO_PEOPLE.flatMap((person) => person.split(' ')).filter((w) => fixtures.has(w));
    expect(clashes).toEqual([]);
  });

  it('point at no real school, class or Mashov id', () => {
    expect(new URL(DEMO_SITE).hostname.endsWith('.invalid')).toBe(true);
    expect(demo.feed.class.siteUrl).toBe(DEMO_SITE);
    const keys = [
      DEMO_CLASS.id,
      ...demo.mashov.filter((e) => e.kind !== 'timetable_slot').map((e) => e.naturalKey.replace(/^mashov-(grade|exam|count)\|/, '')),
      ...demo.feed.exams.map((e) => e.naturalKey), ...demo.feed.events.map((e) => e.naturalKey),
      ...demo.google.map((e) => e.naturalKey),
    ];
    expect(keys.filter((k) => !/^demo/.test(k) && !/^\d{4}-\d{2}-\d{2}\|/.test(k))).toEqual([]);
  });
});
