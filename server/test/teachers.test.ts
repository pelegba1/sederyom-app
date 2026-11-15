/**
 * "איפה המורה?" (docs/superpowers/specs/2026-11-04-teacher-search-design.md):
 * every class timetable turned into each teacher's day, the search, where a
 * teacher is at a time, and `GET /v2/teachers`.
 *
 * The fixture is dugma.shahaf.site's week of 2026-11-01, read 2026-11-04: the
 * classes that had the two shapes the parser reads with the teacher in the
 * wrong place (a fill-in, a group's exam), and יב2.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeacherDay, TeacherPeriod, TeachersResponse } from '@sederyom/shared';
import { buildTeacherDays, matchTeachers, teacherIsThere, teacherNow } from '@sederyom/shared/logic/teachers';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildServices } from '../src/services.js';
import { RecordingPusher } from '../src/notify/push.js';
import { hashDeviceToken } from '../src/lib/devices.js';
import { parseTimetable } from '../src/adapters/shahaf/parser.js';
import { readTeacherDay } from '../src/teachers/day.js';
import type { ShahafFetcher } from '../src/adapters/shahaf/index.js';
import { nowLines, periodPlace, periodStatus, periodWhere, teachingToday } from '../../app/src/lib/teacherSearch';

const DIR = join(__dirname, '..', 'fixtures', 'shahaf', 'teachers-2026-11-04');
const CLASSES = [
  { id: '2', name: 'י2 הנדסת תוכנה' },
  { id: '37', name: 'יא2' },
  { id: '40', name: 'יא3 מוזיקה' },
  { id: '46', name: 'יא6' },
  { id: '47', name: 'יא7' },
  { id: '53', name: 'יב2' },
];
const SITE = 'https://dugma.shahaf.site';
const ZONE = 'Asia/Jerusalem';
const page = (id: string) => readFileSync(join(DIR, `cls-${id}.html`), 'utf8');
/** `tab=timetable`, saved for the one class whose changes need it. */
const regularPage = (id: string) => (id === '2' ? readFileSync(join(DIR, 'timetable-cls-2.html'), 'utf8') : page(id));
const ROOT = `<select name="cls">${CLASSES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>`;

const fixtureClasses = () =>
  CLASSES.map((c) => ({
    className: c.name,
    lessons: parseTimetable(page(c.id), '2026-11-01', {
      zone: ZONE,
      regular: parseTimetable(regularPage(c.id), '2026-11-01', { zone: ZONE }).lessons,
    }).lessons,
  }));
const dayOf = (days: TeacherDay[], name: string) => days.find((d) => d.name === name);
const at = (day: TeacherDay | undefined, hour: number) => day?.periods.filter((p) => p.hourIndex === hour) ?? [];

describe('buildTeacherDays: the site turned inside out', () => {
  const days = buildTeacherDays(fixtureClasses(), '2026-11-05');

  it('puts every name where a name goes: no room, arrow or "לקבוצה של" left in one', () => {
    expect(days.length).toBeGreaterThan(20);
    for (const d of days) expect(d.name).not.toMatch(/->|לקבוצה של|·|מעבדת|^\S+$/);
  });

  it('reads "אשכול יהודית -> חדר: …" as her own lesson in a new room (the changes tab: "החלפת חדר")', () => {
    const moved = at(dayOf(days, 'אשכול יהודית'), 7);
    expect(moved).toEqual([expect.objectContaining({
      subject: 'מבוא לאינטרנט', room: 'מעבדת מחשבים 4', classes: ['י2 הנדסת תוכנה'], status: 'regular', covering: null, coveredBy: null,
    })]);
    expect(teacherIsThere(moved[0]!)).toBe(true);
  });

  it('gives a group\'s exam to the group\'s teacher, with its room', () => {
    const exam = at(dayOf(days, 'עזרא עמית'), 8);
    expect(exam).toEqual([expect.objectContaining({ subject: 'מבחן תולדות המוזיקה', room: 'מעבדת מחשבים 1', status: 'exam' })]);
  });

  it('makes one period of a group printed in several classes', () => {
    const cs = at(dayOf(days, 'פלדמן תמר'), 4).filter((p) => p.subject === 'מבחן מדעי המחשב');
    expect(cs).toHaveLength(1);
    expect(cs[0]!.classes.sort()).toEqual(['יא2', 'יא6']);
    expect(cs[0]!.room).toBe('יא2');
  });

  it("takes the group's place out of the subject: \"מדעי המחשב (מעבדת מחשבים 1)\"", () => {
    const periods = days.flatMap((d) => d.periods);
    expect(periods.filter((p) => /\)\s*$/.test(p.subject))).toEqual([]);
    expect(periods.some((p) => p.status === 'regular' && p.room !== null)).toBe(true);
  });

  it('keeps only the day asked for, by period', () => {
    for (const d of days) {
      const hours = d.periods.map((p) => p.hourIndex);
      expect(hours).toEqual([...hours].sort((a, b) => a - b));
    }
    const sunday = buildTeacherDays(fixtureClasses(), '2026-11-01');
    expect(sunday).not.toEqual(days);
    expect(buildTeacherDays(fixtureClasses(), '2026-11-07')).toEqual([]);
  });
});

describe('teacherOf: substitutions', () => {
  const base = {
    date: '2026-11-05', hourIndex: 3, startTime: '10:00', endTime: '10:45', subject: 'ספרות', room: null, note: null,
  };
  it('a named substitute: the teacher is away, the substitute is there', () => {
    const days = buildTeacherDays([{
      className: 'יא1',
      lessons: [{ ...base, teacher: 'כהן דנה', status: 'substitution', substitute: 'לוי משה' }],
    }], '2026-11-05');
    const away = dayOf(days, 'כהן דנה')!.periods[0]!;
    const comes = dayOf(days, 'לוי משה')!.periods[0]!;
    expect(away).toMatchObject({ coveredBy: 'לוי משה', covering: null });
    expect(comes).toMatchObject({ coveredBy: null, covering: 'כהן דנה', classes: ['יא1'] });
    expect(teacherIsThere(away)).toBe(false);
    expect(teacherIsThere(comes)).toBe(true);
  });

  it('a substitute the site does not name: the teacher is away', () => {
    const [d] = buildTeacherDays([{ className: 'יא1', lessons: [{ ...base, teacher: 'כהן דנה', status: 'substitution', substitute: null }] }], '2026-11-05');
    expect(d!.periods[0]).toMatchObject({ coveredBy: '' });
    expect(teacherIsThere(d!.periods[0]!)).toBe(false);
  });

  it('a lesson moved away from this hour: not there', () => {
    const [d] = buildTeacherDays([{ className: 'יא1', lessons: [{ ...base, teacher: 'כהן דנה', status: 'moved', substitute: null, note: 'הועבר לשעה 6' }] }], '2026-11-05');
    expect(teacherIsThere(d!.periods[0]!)).toBe(false);
  });

  it('one class\'s cancellation is the group\'s', () => {
    const [d] = buildTeacherDays([
      { className: 'יא1', lessons: [{ ...base, teacher: 'כהן דנה', status: 'regular', substitute: null }] },
      { className: 'יא2', lessons: [{ ...base, teacher: 'כהן דנה', status: 'cancelled', substitute: null }] },
    ], '2026-11-05');
    expect(d!.periods).toHaveLength(1);
    expect(d!.periods[0]).toMatchObject({ status: 'cancelled', classes: ['יא1', 'יא2'] });
  });
});

describe('matchTeachers', () => {
  const days = ['פינטו ציפי', 'כרמי שמעון', 'כרמי אביגיל', 'דקל"ש אהוד', 'בן שושן אלדד', 'ציפורי בועז'].map((name) => ({ name, periods: [] }));
  const names = (q: string) => matchTeachers(days, q).map((d) => d.name);

  it('finds by either name, in either order, by the start of a word', () => {
    expect(names('ציפי')).toEqual(['פינטו ציפי']);
    expect(names('ציפי פינטו')).toEqual(['פינטו ציפי']);
    expect(names('פינ')).toEqual(['פינטו ציפי']);
    expect(names('אלדד')).toEqual(['בן שושן אלדד']);
    expect(names('שושן')).toEqual(['בן שושן אלדד']);
  });

  it('lists every teacher a word fits, the ones it starts first', () => {
    expect(names('כרמי')).toEqual(['כרמי אביגיל', 'כרמי שמעון']);
    expect(names('ציפ')).toEqual(['ציפורי בועז', 'פינטו ציפי']);
  });

  it('ignores gershayim and quotes, and finds no one for nothing typed', () => {
    expect(names('דקלש')).toEqual(['דקל"ש אהוד']);
    expect(names('דקל״ש')).toEqual(['דקל"ש אהוד']);
    expect(names('  ')).toEqual([]);
    expect(names('זזז')).toEqual([]);
  });
});

describe('teacherNow', () => {
  const p = (hourIndex: number, startTime: string, endTime: string, extra: Partial<TeacherPeriod> = {}): TeacherPeriod => ({
    hourIndex, startTime, endTime, subject: 'ספרות', classes: ['יא1'], room: null, status: 'regular', coveredBy: null, covering: null, note: null, ...extra,
  });
  const day: TeacherDay = {
    name: 'כהן דנה',
    periods: [p(2, '08:45', '09:30'), p(3, '09:45', '10:30', { status: 'cancelled' }), p(4, '10:30', '11:15'), p(6, '12:30', '13:15')],
  };

  it('in a period, and where next', () => {
    expect(teacherNow(day, '09:00')).toMatchObject({ kind: 'in', period: { hourIndex: 2 }, next: { hourIndex: 4 } });
    expect(teacherNow(day, '12:30')).toMatchObject({ kind: 'in', period: { hourIndex: 6 }, next: null });
  });

  it('before the first, between two (a cancelled one is free), after the last', () => {
    expect(teacherNow(day, '07:30')).toMatchObject({ kind: 'free', first: true, next: { hourIndex: 2 } });
    expect(teacherNow(day, '10:00')).toMatchObject({ kind: 'free', first: false, next: { hourIndex: 4 } });
    expect(teacherNow(day, '11:15')).toMatchObject({ kind: 'free', next: { hourIndex: 6 } });
    expect(teacherNow(day, '13:15')).toEqual({ kind: 'done' });
  });

  it('away when every period is one they are not in; none with no periods', () => {
    expect(teacherNow({ name: 'x', periods: [p(1, '08:00', '08:45', { status: 'cancelled' })] }, '08:10')).toEqual({ kind: 'away' });
    expect(teacherNow({ name: 'x', periods: [] }, '08:10')).toEqual({ kind: 'none' });
  });
});

describe("the screen's words", () => {
  const p = (hourIndex: number, startTime: string, endTime: string, extra: Partial<TeacherPeriod> = {}): TeacherPeriod => ({
    hourIndex, startTime, endTime, subject: 'ספרות', classes: ['יא3'], room: null, status: 'regular', coveredBy: null, covering: null, note: null, ...extra,
  });
  const day: TeacherDay = { name: 'כהן דנה', periods: [p(2, '08:45', '09:30'), p(4, '10:30', '11:15', { classes: ['יא1', 'יא2'], room: 'מעבדה' })] };

  it('says where now and where next, in a line each', () => {
    expect(nowLines(day, '09:00')).toEqual({ now: 'עכשיו: שעה 2, ספרות, יא3', next: 'אחר כך: שעה 4, ספרות, מעבדה, ב־10:30' });
    expect(nowLines(day, '10:00')).toEqual({ now: 'עכשיו לא בשיעור', next: 'השיעור הבא: שעה 4, ספרות, מעבדה, ב־10:30' });
    expect(nowLines(day, '07:50').now).toBe('השיעור הראשון עוד לא התחיל');
    expect(nowLines(day, '14:00')).toEqual({ now: 'השיעורים להיום נגמרו', next: null });
    expect(nowLines({ name: 'כהן דנה', periods: [] }, '09:00')).toEqual({ now: 'אין היום שיעורים במערכת', next: null });
  });

  it("a period's place: the site's place first, then the classes; short in the sentence", () => {
    const many = p(1, '08:00', '08:45', { classes: ['י2', 'י3', 'י4'] });
    expect(periodPlace(many)).toBe('3 כיתות');
    expect(periodPlace({ ...many, room: 'י4' })).toBe('י4');
    expect(periodWhere({ ...many, room: 'י4' })).toBe('י4, י2, י3');
    expect(teachingToday([day, { name: 'x', periods: [] }, { name: 'y', periods: [p(1, '08:00', '08:45', { status: 'substitution', coveredBy: 'z' })] }])).toBe(1);
    expect(nowLines({ name: 'y', periods: [p(1, '08:00', '08:45', { status: 'cancelled' })] }, '08:10').now).toBe('השיעורים של היום בוטלו או מוחלפים');
  });

  it('names each status', () => {
    expect(periodStatus(p(1, '08:00', '08:45'))).toBeNull();
    expect(periodStatus(p(1, '08:00', '08:45', { status: 'cancelled' }))).toBe('בוטל');
    expect(periodStatus(p(1, '08:00', '08:45', { status: 'cancelled', note: 'הועבר לשעה 6' }))).toBe('הועבר לשעה 6');
    expect(periodStatus(p(1, '08:00', '08:45', { status: 'substitution', coveredBy: 'לוי משה' }))).toBe('מוחלף: לוי משה');
    expect(periodStatus(p(1, '08:00', '08:45', { status: 'substitution', coveredBy: '' }))).toBe('מוחלף');
    expect(periodStatus(p(1, '08:00', '08:45', { status: 'substitution', covering: 'כהן דנה' }))).toBe('במקום כהן דנה');
    expect(periodStatus(p(1, '08:00', '08:45', { status: 'substitution', covering: '' }))).toBe('מילוי מקום');
  });
});

describe('readTeacherDay', () => {
  it('reads every class and fails whole when one cannot be read', async () => {
    const reader = {
      fetchClasses: async () => CLASSES,
      fetchClassWeek: async (id: string) => parseTimetable(page(id), '2026-11-01', { zone: ZONE }).lessons,
    };
    const day = await readTeacherDay(reader, '2026-11-05', new Date());
    expect(day.date).toBe('2026-11-05');
    expect(dayOf(day.teachers, 'אשכול יהודית')).toBeDefined();
    // The week's other teachers are there to be found, with no periods today.
    const away = day.teachers.filter((t) => t.periods.length === 0);
    expect(away.length).toBeGreaterThan(0);
    expect(away.length).toBeLessThan(day.teachers.length);
    const empty = await readTeacherDay(reader, '2026-11-07', new Date());
    expect(empty).toEqual({ forDate: '2026-11-07', date: null, teachers: [] });
    await expect(readTeacherDay({ ...reader, fetchClassWeek: async (id) => {
      if (id === '47') throw new Error('down');
      return reader.fetchClassWeek(id);
    } }, '2026-11-05', new Date())).rejects.toThrow('down');
  });
});

describe('GET /v2/teachers', () => {
  const ENV = {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db', CRON_SECRET: 'test-cron-secret-0123456789abcdef',
    SCHEDULER_ENABLED: 'false', LOG_LEVEL: 'silent',
  };
  const silent = { info: () => {}, warn: () => {}, error: () => {} };

  beforeEach(() => {
    // Thursday of the fixture's week, mid-morning. Only the clock: Fastify's timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T09:10:00+02:00'));
  });
  afterEach(() => vi.useRealTimers());

  function setup(opts: { down?: () => boolean } = {}) {
    const schools = [
      { id: 's1', shahafUrl: SITE, teacherDay: null as unknown, teacherDayReadAt: null as Date | null, teacherDayError: null as string | null },
      { id: 's2', shahafUrl: 'https://other.shahaf.site', teacherDay: null, teacherDayReadAt: null, teacherDayError: null },
    ];
    const devices = [
      { id: 'd1', tokenHash: hashDeviceToken('tok-student'), classSite: SITE, followSites: [] as string[] },
      { id: 'd2', tokenHash: hashDeviceToken('tok-parent'), classSite: null, followSites: [SITE] },
      { id: 'd3', tokenHash: hashDeviceToken('tok-none'), classSite: null, followSites: [] },
    ];
    const school = (url: string) => ({ school: { shahafUrl: url } });
    const prisma = {
      device: {
        findUnique: async ({ where, include }: { where: { id?: string; tokenHash?: string }; include?: unknown }) => {
          const d = devices.find((x) => (where.id ? x.id === where.id : x.tokenHash === where.tokenHash));
          if (!d) return null;
          if (!include) return { id: d.id };
          return { id: d.id, class: d.classSite ? school(d.classSite) : null, follows: d.followSites.map((s) => ({ class: school(s) })) };
        },
      },
      school: {
        findUnique: async ({ where }: { where: { shahafUrl: string } }) => schools.find((s) => s.shahafUrl === where.shahafUrl) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = schools.find((s) => s.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      },
    };
    let reads = 0;
    const fetcher: ShahafFetcher = async ({ tab, cls }) => {
      if (opts.down?.()) throw new Error('site down');
      if (!tab) return ROOT;
      if (tab === 'timetable') return regularPage(cls!);
      reads += 1;
      return page(cls!);
    };
    const services = buildServices(loadEnv(ENV), prisma as never, silent, new RecordingPusher(), { shahafFetcherFor: () => fetcher });
    const app = buildApp({ services });
    const get = (token: string, query = '') =>
      app.inject({ method: 'GET', url: `/v2/teachers${query}`, headers: { authorization: `Bearer ${token}` } });
    return { app, get, schools, reads: () => reads };
  }

  it('answers today\'s teachers of the device\'s school, and keeps them half an hour', async () => {
    const { get, schools, reads } = setup();
    const res = await get('tok-student');
    expect(res.statusCode).toBe(200);
    const body = res.json() as TeachersResponse;
    expect(body).toMatchObject({ siteUrl: SITE, date: '2026-11-05' });
    expect(body.teachers.find((t) => t.name === 'אשכול יהודית')).toBeDefined();
    expect(reads()).toBe(CLASSES.length);
    expect(schools[0]!.teacherDayReadAt).not.toBeNull();

    vi.setSystemTime(new Date('2026-11-05T09:35:00+02:00'));
    expect((await get('tok-student')).statusCode).toBe(200);
    expect(reads()).toBe(CLASSES.length);

    vi.setSystemTime(new Date('2026-11-05T09:41:00+02:00'));
    expect((await get('tok-student')).statusCode).toBe(200);
    expect(reads()).toBe(CLASSES.length * 2);
  });

  it('a parent asks for a child\'s school; no one asks for a school they are not at', async () => {
    const { get } = setup();
    expect((await get('tok-parent')).json()).toMatchObject({ siteUrl: SITE });
    expect((await get('tok-parent', `?site=${encodeURIComponent(SITE)}`)).statusCode).toBe(200);
    expect((await get('tok-student', '?site=https%3A%2F%2Fother.shahaf.site')).statusCode).toBe(403);
    expect((await get('tok-student', '?site=nonsense')).statusCode).toBe(403);
    expect((await get('tok-none')).statusCode).toBe(409);
    expect((await get('made-up')).statusCode).toBe(401);
  });

  it('a failed read serves today\'s kept day; with none kept, says the site is down', async () => {
    let down = false;
    const { get, schools } = setup({ down: () => down });
    const first = (await get('tok-student')).json() as TeachersResponse;
    vi.setSystemTime(new Date('2026-11-05T10:30:00+02:00'));
    down = true;
    const stale = await get('tok-student');
    expect(stale.statusCode).toBe(200);
    expect((stale.json() as TeachersResponse).readAt).toBe(first.readAt);
    expect(schools[0]!.teacherDayError).toMatch(/site down/);

    // The next day, yesterday's is no answer.
    vi.setSystemTime(new Date('2026-11-06T09:00:00+02:00'));
    expect((await get('tok-student')).statusCode).toBe(502);
  });
});
