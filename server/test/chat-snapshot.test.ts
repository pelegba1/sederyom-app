/**
 * The chat connection's snapshot (app/src/chat/snapshot.ts): what the phone
 * seals after a read, built over the made-up student, trimmed to its size cap,
 * and read back as tolerantly as a friend's box.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_DAYS_AHEAD,
  CHAT_DAYS_BACK,
  CHAT_MESSAGES_MAX,
  CHAT_MESSAGE_BODY_MAX,
  CHAT_SNAPSHOT_JSON_MAX,
  DEFAULT_CHAT_SHARES,
  DEFAULT_SETTINGS,
  chatHash,
  type ChatMessage,
  type ChatShares,
  type ChatSnapshot,
  type Grade,
} from '@sederyom/shared';
import type { GradeWeightsPrefs } from '../../app/src/lib/gradeWeights';

const ZONE = 'Asia/Jerusalem';
/** A plain school Wednesday, 4.11.2026, 10:00 in Jerusalem. */
const NOW = new Date('2026-11-04T10:00:00+02:00');
const TODAY = '2026-11-04';
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const { demoData, demoSettings, DEMO_SUBSTITUTE } = await import('../../app/src/demo/data');
const { demoSourcesFrom } = await import('../../app/src/demo/sources');
const { buildChatSnapshot, fitChatSnapshot, readChatSnapshot } = await import('../../app/src/chat/snapshot');
const { DEFAULT_TYPES, guessType } = await import('../../app/src/lib/gradeWeights');
const { homeworkOf } = await import('../../app/src/local/schoolFeeds');

type Kept = NonNullable<Parameters<typeof demoSourcesFrom>[4]>;
type Sources = ReturnType<typeof demoSourcesFrom>;

const ALL: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };
const SCHOOL = { name: 'תיכון הדגמה', className: 'יא2' };
const AT = NOW.toISOString();

const sources = (kept?: Kept): Sources => demoSourcesFrom(demoData(NOW, ZONE), demoSettings(DEFAULT_SETTINGS), NOW, ZONE, kept);
const build = (shares: ChatShares = DEFAULT_CHAT_SHARES, src: Sources = sources()): ChatSnapshot => buildChatSnapshot(src, shares, SCHOOL, AT);
/** The snapshot as the server's reader gets it: through JSON, the way it travels. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
/** A Mashov entity the demo's read does not have, added to the sources. */
const withMashov = (src: Sources, ...extra: { kind: string; naturalKey: string; payload: unknown }[]): Sources => ({
  ...src,
  mashov: [...src.mashov, ...extra.map((e) => ({ source: 'mashov', ...e }) as unknown as Sources['mashov'][number])],
});

/** A Mashov grade the demo's read does not have (a number, a name, a date). */
const mashovGrade = (key: string, date: string, value: number, notes: string, subject = 'מתמטיקה') => ({
  kind: 'grade',
  naturalKey: `mashov-grade|${key}`,
  payload: { naturalKey: `mashov-grade|${key}`, date, subject, value, valueText: null, weight: null, notes, isExam: false },
});

describe('buildChatSnapshot', () => {
  it('writes only the timetable, the exams and homework when nothing but the default is shared', () => {
    const snapshot = build();
    // Absent, not empty: a part whose share is off is not a key at all.
    expect(Object.keys(snapshot)).toEqual(['v', 'at', 'shares', 'school', 'days', 'exams', 'trimmed', 'homework']);
    expect(snapshot.grades).toBeUndefined();
    expect(snapshot.bagrut).toBeUndefined();
    expect(snapshot.absences).toBeUndefined();
    expect(snapshot.messages).toBeUndefined();
    expect(snapshot.homework).toBeDefined();
    expect(snapshot.homework!.length).toBeGreaterThan(0);
    expect(snapshot.days.every((d) => !('calendar' in d))).toBe(true);
    expect(snapshot.trimmed).toEqual([]);
  });

  it('writes every part when every share is on, in one fixed order', () => {
    const snapshot = build(ALL);
    expect(Object.keys(snapshot)).toEqual([
      'v', 'at', 'shares', 'school', 'days', 'exams', 'trimmed', 'homework', 'grades', 'averages', 'bagrut', 'absences', 'messages',
    ]);
    for (const part of [snapshot.homework, snapshot.grades, snapshot.bagrut, snapshot.absences, snapshot.messages]) {
      expect(part).toBeDefined();
      expect(part!.length).toBeGreaterThan(0);
    }
    expect(snapshot.v).toBe(1);
    expect(snapshot.at).toBe(AT);
    expect(snapshot.school).toEqual(SCHOOL);
  });

  it('keeps its own copy of the shares and the school', () => {
    const shares = { ...ALL };
    const school = { ...SCHOOL };
    const snapshot = buildChatSnapshot(sources(), shares, school, AT);
    expect(snapshot.shares).toEqual(ALL);
    expect(Object.keys(snapshot.shares)).toEqual(['homework', 'grades', 'bagrut', 'absences', 'messages']);
    shares.grades = false;
    school.name = 'אחר';
    expect(snapshot.shares.grades).toBe(true);
    expect(snapshot.school.name).toBe(SCHOOL.name);
  });

  it('hashes the same for the same content, whenever and however often it is built', () => {
    const first = build(ALL);
    // Another time of writing, another build, and the trip through JSON: the same hash.
    expect(chatHash(buildChatSnapshot(sources(), ALL, SCHOOL, '2026-11-04T11:30:00.000Z'))).toBe(chatHash(first));
    expect(chatHash(wire(first))).toBe(chatHash(first));
    // Something a chat would see changing does change it.
    const hidden = { ...demoSettings(DEFAULT_SETTINGS), exams: { hiddenKeys: [first.exams[0]!.naturalKey] } };
    const changed = buildChatSnapshot(demoSourcesFrom(demoData(NOW, ZONE), hidden, NOW, ZONE), ALL, SCHOOL, AT);
    expect(chatHash(changed)).not.toBe(chatHash(first));
  });

  it('covers yesterday through thirteen days ahead, one day each', () => {
    const { days } = build();
    expect(CHAT_DAYS_BACK).toBe(1);
    expect(CHAT_DAYS_AHEAD).toBe(13);
    expect(days).toHaveLength(15);
    expect(days[0]!.date).toBe('2026-11-03');
    expect(days[1]!.date).toBe(TODAY);
    expect(days[14]!.date).toBe('2026-11-17');
    expect(days.map((d) => d.date)).toEqual([...new Set(days.map((d) => d.date))].sort());
    expect(days[1]!.weekdayName).toBe('יום רביעי');
  });

  it('gives each day only what a chat reads of it, with the lessons of its timeline', () => {
    const { days } = build();
    const today = days[1]!;
    expect(Object.keys(today)).toEqual(['date', 'weekdayName', 'isSchoolDay', 'holidayName', 'projected', 'lessons', 'examsToday', 'events']);
    expect(today.isSchoolDay).toBe(true);
    expect(today.lessons.length).toBeGreaterThan(0);
    expect(today.lessons.every((l) => l.date === TODAY)).toBe(true);
    expect(today.lessons.map((l) => l.hourIndex)).toEqual([...today.lessons.map((l) => l.hourIndex)].sort((a, b) => a - b));
    // The school's events are kept on the day they are on.
    expect(days.flatMap((d) => d.events).map((e) => e.title)).toContain('יום ספורט שכבתי');
    // And no day carries what only the timeline's other kinds hold.
    expect(JSON.stringify(days)).not.toContain('"timeline"');
  });

  it('keeps a cancelled lesson cancelled and a substitute\'s name', () => {
    const lessons = build().days.flatMap((d) => d.lessons);
    expect(lessons.filter((l) => l.status === 'cancelled').length).toBeGreaterThan(0);
    const substituted = lessons.find((l) => l.status === 'substitution');
    expect(substituted).toBeDefined();
    expect(substituted!.substitute).toBe(DEMO_SUBSTITUTE);
  });

  describe('Google stays on the phone (Google\'s Workspace data policy: no Google user data to an AI model)', () => {
    /** What the made-up student keeps from Google that a chat could repeat: every event's title and place, every task's title and notes. */
    const fromGoogle = (src: Sources): string[] =>
      src.google
        .flatMap((e) => {
          const p = e.payload as { summary?: string; location?: string | null; title?: string; notes?: string | null };
          return e.kind === 'calendar_event' ? [p.summary, p.location] : e.kind === 'task' ? [p.title, p.notes] : [];
        })
        .filter((text): text is string => typeof text === 'string' && text !== '');

    it('puts no event and no task in the copy, whatever the caller still passes for the old switch', () => {
      const src = sources();
      const texts = fromGoogle(src);
      // The sources do hold them, so the copy being clean is the build's doing.
      expect(src.google.some((e) => e.kind === 'calendar_event')).toBe(true);
      expect(src.google.some((e) => e.kind === 'task')).toBe(true);
      expect(texts).toEqual(expect.arrayContaining(['אימון כדורסל', 'לקנות מחברת משבצות', 'מרכז הספורט']));

      const stale = { ...ALL, google: true } as ChatShares;
      for (const shares of [DEFAULT_CHAT_SHARES, ALL, stale]) {
        const snapshot = build(shares, src);
        expect(snapshot.days.every((d) => !('calendar' in d))).toBe(true);
        expect('tasks' in snapshot).toBe(false);
        const json = JSON.stringify(snapshot);
        for (const text of texts) expect(json).not.toContain(text);
      }
      // And the copy never says it has a Google switch: the shares it carries are the five that are left.
      for (const shares of [DEFAULT_CHAT_SHARES, ALL, stale]) expect(Object.keys(build(shares, src).shares)).toEqual(['homework', 'grades', 'bagrut', 'absences', 'messages']);
    });
  });

  describe('exams', () => {
    const manual = (naturalKey: string, date: string, subject: string) => ({ naturalKey, date, subject, details: null, createdAt: '2026-11-01T07:00:00.000Z' });

    it('lists the exams from today to the semester\'s end, under the student\'s names, less what they hid, with what they added', () => {
      const base = build().exams;
      expect(base.length).toBeGreaterThan(0);
      expect(base.every((e) => e.date >= TODAY && e.date <= '2027-01-31')).toBe(true);
      expect(base.map((e) => e.date)).toEqual([...base.map((e) => e.date)].sort());

      const math = base.find((e) => e.naturalKey === 'demo-exam|math')!;
      const english = base.find((e) => e.naturalKey === 'demo-exam|english')!;
      const src: Sources = {
        ...sources({
          manualExams: [manual('manual|mine', '2026-11-30', 'הצגה בתיאטרון')],
          examPrefs: { renames: { [math.naturalKey]: 'המבחן הגדול' }, calendarSkip: [], dates: {} },
        }),
        settings: { ...demoSettings(DEFAULT_SETTINGS), exams: { hiddenKeys: [english.naturalKey] } },
      };
      const exams = build(DEFAULT_CHAT_SHARES, src).exams;
      expect(exams.find((e) => e.naturalKey === math.naturalKey)).toMatchObject({ subject: 'המבחן הגדול', originalSubject: math.subject });
      expect(exams.some((e) => e.naturalKey === english.naturalKey)).toBe(false);
      expect(exams.find((e) => e.naturalKey === 'manual|mine')).toMatchObject({ subject: 'הצגה בתיאטרון', kind: 'manual' });
    });

    it('carries an exam on the date the student gave it, in the list and on its day', () => {
      const base = build();
      const math = base.exams.find((e) => e.naturalKey === 'demo-exam|math')!;
      // A day the copy covers (yesterday through 17.11), other than the school's.
      const mine = math.date === '2026-11-16' ? '2026-11-17' : '2026-11-16';
      const examPrefs = { renames: {}, calendarSkip: [], dates: { [math.naturalKey]: { date: mine, sourceDate: math.date } } };
      const snapshot = build(DEFAULT_CHAT_SHARES, sources({ examPrefs }));

      expect(snapshot.exams.find((e) => e.naturalKey === math.naturalKey)).toMatchObject({ date: mine, originalDate: math.date });
      expect(snapshot.exams.map((e) => e.date)).toEqual([...snapshot.exams.map((e) => e.date)].sort());
      const onDay = (date: string) => snapshot.days.find((d) => d.date === date)!.examsToday.map((e) => e.naturalKey);
      expect(onDay(mine)).toContain(math.naturalKey);
      expect(onDay(math.date)).not.toContain(math.naturalKey);
      // The others are where they were, and the copy reads back with the student's date.
      expect(snapshot.exams.filter((e) => e.naturalKey !== math.naturalKey)).toEqual(base.exams.filter((e) => e.naturalKey !== math.naturalKey));
      const read = readChatSnapshot(wire(snapshot))!;
      expect(read.exams.find((e) => e.naturalKey === math.naturalKey)?.date).toBe(mine);
      expect(read.days.find((d) => d.date === mine)!.examsToday.map((e) => e.naturalKey)).toContain(math.naturalKey);
    });

    it('leaves out an exam the student moved past the semester\'s end or to a day gone by', () => {
      const dateOf = (key: string) => build().exams.find((e) => e.naturalKey === key)!.date;
      const examPrefs = {
        renames: {}, calendarSkip: [],
        dates: {
          'demo-exam|math': { date: '2027-02-01', sourceDate: dateOf('demo-exam|math') },
          'demo-exam|english': { date: '2026-11-03', sourceDate: dateOf('demo-exam|english') },
        },
      };
      const keys = build(DEFAULT_CHAT_SHARES, sources({ examPrefs })).exams.map((e) => e.naturalKey);
      expect(keys).not.toContain('demo-exam|math');
      expect(keys).not.toContain('demo-exam|english');
      expect(keys).toContain('demo-exam|history');
    });

    it('stops at the semester\'s last day, inclusive, and does not look back', () => {
      const src = sources({
        manualExams: [
          manual('manual|yesterday', '2026-11-03', 'אתמול'),
          manual('manual|today', TODAY, 'היום'),
          manual('manual|last', '2027-01-31', 'היום האחרון'),
          manual('manual|next', '2027-02-01', 'המחצית הבאה'),
        ],
      });
      const keys = build(DEFAULT_CHAT_SHARES, src).exams.map((e) => e.naturalKey);
      expect(keys).toContain('manual|today');
      expect(keys).toContain('manual|last');
      expect(keys).not.toContain('manual|yesterday');
      expect(keys).not.toContain('manual|next');
    });

    it('keeps the second semester to the school year\'s end', () => {
      const later = new Date('2027-03-10T10:00:00+02:00');
      vi.setSystemTime(later);
      try {
        const src = demoSourcesFrom(demoData(later, ZONE), demoSettings(DEFAULT_SETTINGS), later, ZONE, {
          manualExams: [manual('manual|june', '2027-06-20', 'סוף השנה'), manual('manual|july', '2027-06-21', 'אחרי')],
        });
        const keys = buildChatSnapshot(src, DEFAULT_CHAT_SHARES, SCHOOL, later.toISOString()).exams.map((e) => e.naturalKey);
        expect(keys).toContain('manual|june');
        expect(keys).not.toContain('manual|july');
      } finally {
        vi.setSystemTime(NOW);
      }
    });
  });

  describe('homework', () => {
    const hw = (key: string, dueDate: string | null, subject: string) => ({
      kind: 'homework', naturalKey: key, payload: { naturalKey: key, dueDate, dueExplicit: true, subject, text: `ש"ב ${key}` },
    });

    it('keeps the open items and, done or not, those due in the last 7 days', () => {
      const done = { done: true, linkedTaskId: null };
      const src = withMashov(
        sources({
          homeworkState: {
            'hw|done-old': done, 'hw|done-edge': done, 'hw|done-new': done, 'hw|done-today': done, 'hw|done-tomorrow': done, 'hw|done-future': done,
          },
        }),
        hw('hw|open-old', '2026-10-01', 'מתמטיקה'),
        hw('hw|open-undated', null, 'מתמטיקה'),
        hw('hw|open-future', '2026-11-20', 'מתמטיקה'),
        hw('hw|done-old', '2026-10-27', 'מתמטיקה'),
        hw('hw|done-edge', '2026-10-28', 'מתמטיקה'),
        hw('hw|done-new', '2026-11-02', 'מתמטיקה'),
        hw('hw|done-today', TODAY, 'מתמטיקה'),
        hw('hw|done-tomorrow', '2026-11-05', 'מתמטיקה'),
        hw('hw|done-future', '2026-11-20', 'מתמטיקה'),
      );
      const items = build(DEFAULT_CHAT_SHARES, src).homework!;
      const keys = items.map((h) => h.naturalKey);
      // Open ones stay however old or far ahead.
      expect(keys).toContain('hw|open-old');
      expect(keys).toContain('hw|open-undated');
      expect(keys).toContain('hw|open-future');
      // Done ones only from a week ago (inclusive) through today (inclusive).
      expect(keys).not.toContain('hw|done-old');
      expect(keys).toContain('hw|done-edge');
      expect(keys).toContain('hw|done-new');
      expect(keys).toContain('hw|done-today');
      expect(keys).not.toContain('hw|done-tomorrow');
      expect(keys).not.toContain('hw|done-future');
      // Each with whether it is done.
      expect(items.find((h) => h.naturalKey === 'hw|done-new')!.done).toBe(true);
      expect(items.find((h) => h.naturalKey === 'hw|open-old')!.done).toBe(false);
      // The demo's own homework is all ahead: its open items are there, the one it ticked off is not.
      expect(items.find((h) => h.naturalKey === 'demo-hw|math')!.done).toBe(false);
      expect(keys).not.toContain('demo-hw|literature');
    });

    it('carries no Google Task id: an item a Google task was made from reads like any other', () => {
      const ids = ['google-task-id-AAAA', 'google-task-id-BBBB'];
      const src = sources({
        homeworkState: {
          'demo-hw|math': { done: false, linkedTaskId: ids[0]! },
          'demo-hw|literature': { done: true, linkedTaskId: ids[1]! },
        },
      });
      // The sources do link them, so the copy being clean is the build's doing.
      const linked = homeworkOf(src);
      expect(linked.find((h) => h.naturalKey === 'demo-hw|math')!.linkedTaskId).toBe(ids[0]);
      expect(linked.find((h) => h.naturalKey === 'demo-hw|literature')!.linkedTaskId).toBe(ids[1]);
      for (const shares of [DEFAULT_CHAT_SHARES, ALL]) {
        const snapshot = build(shares, src);
        const math = snapshot.homework!.find((h) => h.naturalKey === 'demo-hw|math')!;
        // The rest of the item is as it was; only the Google link is gone.
        expect(math.done).toBe(false);
        expect(math.subject).toBeTruthy();
        expect(snapshot.homework!.every((h) => !('linkedTaskId' in h))).toBe(true);
        const json = JSON.stringify(snapshot);
        for (const id of ids) expect(json).not.toContain(id);
        expect(json).not.toContain('linkedTaskId');
      }
    });

    it('leaves out the homework of a subject the student hides', () => {
      const src = sources();
      const subject = build(DEFAULT_CHAT_SHARES, src).homework![0]!.subject;
      const hiddenSettings = { ...src.settings, lessons: { ...src.settings.lessons, hiddenSubjects: [subject] } };
      const items = build(DEFAULT_CHAT_SHARES, { ...src, settings: hiddenSettings }).homework!;
      expect(items.some((h) => h.subject === subject)).toBe(false);
    });
  });

  describe('grades', () => {
    const grade = (key: string, date: string) => ({
      kind: 'grade', naturalKey: `mashov-grade|${key}`,
      payload: { naturalKey: `mashov-grade|${key}`, date, subject: 'מתמטיקה', value: 77, valueText: null, weight: null, notes: key, isExam: false },
    });

    it('keeps the grades of this school year, which began on 1 September', () => {
      const src = withMashov(sources(), grade('last-year', '2026-08-31'), grade('first-day', '2026-09-01'));
      const grades = build(ALL, src).grades!;
      const keys = grades.map((g) => g.notes);
      expect(keys).toContain('first-day');
      expect(keys).not.toContain('last-year');
      expect(grades.every((g) => g.date >= '2026-09-01')).toBe(true);
      // Newest first, as the grades tab has them.
      const dates = grades.map((g) => g.date);
      expect(dates).toEqual([...dates].sort().reverse());
      // And not what Mashov keeps on the side.
      expect(grades.some((g) => 'isExam' in g)).toBe(false);
    });

    it('counts January to August in the school year that began the September before', () => {
      const later = new Date('2027-02-10T10:00:00+02:00');
      vi.setSystemTime(later);
      try {
        const src = withMashov(
          demoSourcesFrom(demoData(later, ZONE), demoSettings(DEFAULT_SETTINGS), later, ZONE),
          grade('two-years', '2026-08-31'),
          grade('this-year', '2026-09-01'),
        );
        const keys = buildChatSnapshot(src, ALL, SCHOOL, later.toISOString()).grades!.map((g) => g.notes);
        expect(keys).toContain('this-year');
        expect(keys).not.toContain('two-years');
      } finally {
        vi.setSystemTime(NOW);
      }
    });

    it('marks a grade new by the phone\'s map when it is given one, else not at all', () => {
      const src = sources();
      const plain = build(ALL, src).grades!;
      expect(plain.every((g) => g.firstSeen === null)).toBe(true);
      const key = plain[0]!.naturalKey;
      const stamped = buildChatSnapshot(src, ALL, SCHOOL, AT, { firstSeen: { [key]: '2026-11-03T07:00:00.000Z' } }).grades!;
      expect(stamped.find((g) => g.naturalKey === key)!.firstSeen).toBe('2026-11-03T07:00:00.000Z');
      expect(stamped.filter((g) => g.firstSeen !== null)).toHaveLength(1);
      // `null` is the same as no map.
      expect(buildChatSnapshot(src, ALL, SCHOOL, AT, { firstSeen: null }).grades).toEqual(plain);
    });
  });

  describe('averages', () => {
    /** One subject's exam type counts for all of its grade and every other type for none. */
    const examsOnly = (subject: string): GradeWeightsPrefs => ({
      subjects: { [subject]: { types: DEFAULT_TYPES.map((t) => ({ ...t, percent: t.id === 'exam' ? 100 : 0 })) } },
      grades: {},
    });

    it('follow the student\'s weights', () => {
      // The demo's math has an exam (92), a quiz (85) and a work (88); two more exams make the mean 83.666…
      const src = withMashov(sources(), mashovGrade('exam-a', '2026-10-20', 77, 'מבחן באלגברה'), mashovGrade('exam-b', '2026-10-22', 82, 'מבחן בגאומטריה'));
      const exams = build(ALL, src).grades!.filter((g) => g.subject === 'מתמטיקה' && guessType(g.notes) === 'exam');
      expect(exams.map((g) => g.value).sort()).toEqual([77, 82, 92]);
      const mean = exams.reduce((sum, g) => sum + g.value!, 0) / exams.length;

      const weighted = buildChatSnapshot(src, ALL, SCHOOL, AT, { weights: examsOnly('מתמטיקה') });
      const math = weighted.averages!.find((a) => a.subject === 'מתמטיקה')!;
      expect(math.average).toBe(Math.round(mean * 10) / 10);
      expect(math.average).toBe(83.7);
      // The quiz and the work are at 0%: two grades that do not count.
      expect(math.uncounted).toBe(2);
      expect(weighted.averages!.length).toBeGreaterThan(1);
      for (const a of weighted.averages!) {
        expect(a.subject).not.toBe('');
        expect(Number.isFinite(a.average)).toBe(true);
      }

      // Without the weights the same grades have another average, and the copy another hash.
      const plain = build(ALL, src);
      expect(plain.averages!.find((a) => a.subject === 'מתמטיקה')!.average).not.toBe(83.7);
      expect(chatHash(plain)).not.toBe(chatHash(weighted));
      // No weights and `null` are the same thing; the default type set is the screens' own.
      expect(buildChatSnapshot(src, ALL, SCHOOL, AT, { weights: null }).averages).toEqual(plain.averages);
    });

    it('have a subject once, rounded to one decimal, with `uncounted` only when some grade does not count', () => {
      const { averages } = build(ALL);
      expect(averages!.length).toBeGreaterThan(0);
      expect(new Set(averages!.map((a) => a.subject)).size).toBe(averages!.length);
      for (const a of averages!) {
        expect(a.average).toBe(Math.round(a.average * 10) / 10);
        expect(Object.keys(a)).toEqual(a.uncounted === undefined ? ['subject', 'average'] : ['subject', 'average', 'uncounted']);
        if (a.uncounted !== undefined) expect(a.uncounted).toBeGreaterThan(0);
      }
      // The demo's default types count every grade of math: 60% exam, 20% quiz, 20% work.
      expect(averages!.find((a) => a.subject === 'מתמטיקה')).toEqual({ subject: 'מתמטיקה', average: 89.8 });
    });

    it('are not a key without the grades share', () => {
      const off = build({ ...ALL, grades: false });
      expect('averages' in off).toBe(false);
      expect('grades' in off).toBe(false);
      expect('averages' in build()).toBe(false);
    });

    it('are over the whole year, before any trim', () => {
      const later = new Date('2027-02-10T10:00:00+02:00');
      vi.setSystemTime(later);
      try {
        const demo = demoSourcesFrom(demoData(later, ZONE), demoSettings(DEFAULT_SETTINGS), later, ZONE);
        // 184 grades from September, each with a 4 KB name (the phone keeps 200 grades): past the cap, and older than 90 days.
        const old = Array.from({ length: 300 }, (_v, n) => mashovGrade(`old-${n}`, '2026-09-15', 50, `מבחן ${'x'.repeat(4000)}`));
        const heavy = buildChatSnapshot(withMashov(demo, ...old), ALL, SCHOOL, later.toISOString());
        expect(bytes(heavy)).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
        const fit = fitChatSnapshot(heavy);
        expect(fit.trimmed).toContain('oldGrades');
        expect(fit.grades!.some((g) => g.date < '2026-11-12')).toBe(false);
        expect(fit.averages).toEqual(heavy.averages);
        expect(Object.keys(fit)).toEqual(Object.keys(heavy));
        // The old grades are in the averages: the recent grades alone give other ones.
        const recent = buildChatSnapshot(demo, ALL, SCHOOL, later.toISOString());
        expect(heavy.averages!.find((a) => a.subject === 'מתמטיקה')!.average).toBeLessThan(recent.averages!.find((a) => a.subject === 'מתמטיקה')!.average);
      } finally {
        vi.setSystemTime(NOW);
      }
    });
  });

  it('shares the bagrut exactly as the phone keeps it', () => {
    const src = sources();
    expect(src.bagrut.length).toBeGreaterThan(0);
    expect(build(ALL, src).bagrut).toEqual(src.bagrut);
    expect(build({ ...ALL, bagrut: false }, src).bagrut).toBeUndefined();
  });

  it('gives each subject\'s absences by the tracker\'s standing, with no dates', () => {
    const absences = build(ALL).absences!;
    expect(absences.length).toBeGreaterThan(0);
    for (const a of absences) {
      expect(Object.keys(a)).toEqual(['subject', 'counted', 'allowed', 'level']);
      expect(['ok', 'close', 'over']).toContain(a.level);
      expect(Number.isInteger(a.counted)).toBe(true);
      expect(a.allowed).toBeGreaterThan(0);
    }
    // The demo has an absence in homeroom and in physics; two in math, one of them justified (it does not count);
    // and two lates in English (3 lates make one absence, so none yet).
    const counted = Object.fromEntries(absences.map((a) => [a.subject, a.counted]));
    expect(counted).toMatchObject({ חינוך: 1, פיזיקה: 1, מתמטיקה: 1, אנגלית: 0 });
    // The demo's settings have no semester set: the one today is in is counted, as the phone's settings have it.
    expect(sources().settings.attendance.semesterStart).toBe('');
    // 15% of the semester's lessons: math has 135 of them.
    expect(absences.find((a) => a.subject === 'מתמטיקה')).toEqual({ subject: 'מתמטיקה', counted: 1, allowed: 20, level: 'ok' });
  });

  it('counts the absences by the student\'s own limit and semester', () => {
    const src = sources();
    const withAttendance = (attendance: Partial<Sources['settings']['attendance']>): Sources => ({
      ...src,
      settings: { ...src.settings, attendance: { ...src.settings.attendance, ...attendance } },
    });
    const math = (s: ChatSnapshot) => s.absences!.find((a) => a.subject === 'מתמטיקה');
    // No absence allowed, one counted: over the limit.
    expect(math(build(ALL, withAttendance({ limitPercent: 0 })))).toEqual({ subject: 'מתמטיקה', counted: 1, allowed: 0, level: 'over' });
    // A semester that began today has none of the earlier absences in it.
    expect(math(build(ALL, withAttendance({ semesterStart: TODAY, semesterEnd: '2027-01-31' })))!.counted).toBe(0);
  });

  describe('messages', () => {
    const message = (n: number, body: string, date: string | null = new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString()) => ({
      kind: 'message', naturalKey: `msg|${n}`, payload: { naturalKey: `msg|${n}`, date, title: `הודעה ${n}`, body, from: 'המחנכת', bodyFor: date ?? 'x' },
    });

    it('gives the newest 50, newest first, each as date, sender, title and body', () => {
      const many = Array.from({ length: 70 }, (_v, n) => message(n, `גוף ${n}`));
      const messages = build(ALL, withMashov(sources(), ...many)).messages!;
      expect(CHAT_MESSAGES_MAX).toBe(50);
      expect(messages).toHaveLength(50);
      const dates = messages.map((m) => m.date);
      expect(dates).toEqual([...dates].sort().reverse());
      // The demo's own are from the last days, so they are among the newest; the oldest of the 70 are the ones cut.
      expect(messages.some((m) => m.title === 'הודעה 0')).toBe(false);
      expect(messages.some((m) => m.title === 'יום ספורט שכבתי')).toBe(true);
      expect(Object.keys(messages[0]!)).toEqual(['date', 'from', 'title', 'body']);
      expect(messages.find((m) => m.title === 'הודעה 69')).toEqual({ date: '2026-10-01T01:09:00.000Z', from: 'המחנכת', title: 'הודעה 69', body: 'גוף 69' });
    });

    it('cuts a body to 2,000 characters without splitting one, and leaves a shorter one whole', () => {
      const src = withMashov(
        sources(),
        message(1, 'א'.repeat(2500)),
        message(2, '😀'.repeat(2500)),
        message(3, 'ב'.repeat(CHAT_MESSAGE_BODY_MAX)),
        message(4, 'קצר'),
      );
      const bodies = new Map(build(ALL, src).messages!.map((m) => [m.title, m.body]));
      expect(bodies.get('הודעה 1')).toBe('א'.repeat(2000));
      // 2,000 emoji, not 2,000 halves of one: nothing is left lone.
      expect([...bodies.get('הודעה 2')!]).toHaveLength(2000);
      expect(bodies.get('הודעה 2')).toBe('😀'.repeat(2000));
      expect(bodies.get('הודעה 2')).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(bodies.get('הודעה 3')).toBe('ב'.repeat(2000));
      expect(bodies.get('הודעה 4')).toBe('קצר');
    });

    it('dates a message Mashov gave no date to by the read it is given, else by the moment of the sources', () => {
      const src = withMashov(sources(), message(5, 'בלי תאריך', null));
      const byDefault = build(ALL, src).messages!.find((m) => m.title === 'הודעה 5')!;
      expect(byDefault.date).toBe(AT);
      const read = buildChatSnapshot(src, ALL, SCHOOL, AT, { readAt: '2026-11-02T06:00:00.000Z' }).messages!.find((m) => m.title === 'הודעה 5')!;
      expect(read.date).toBe('2026-11-02T06:00:00.000Z');
    });
  });
});

describe('fitChatSnapshot', () => {
  const messageOf = (n: number, body: string): ChatMessage => ({ date: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(), from: 'המחנכת', title: `הודעה ${n}`, body });
  const withMessages = (snapshot: ChatSnapshot, count: number, size: number): ChatSnapshot => ({
    ...snapshot,
    messages: Array.from({ length: count }, (_v, n) => messageOf(n, 'x'.repeat(size))),
  });

  it('leaves a snapshot that fits as it is', () => {
    const snapshot = build(ALL);
    expect(bytes(snapshot)).toBeLessThanOrEqual(CHAT_SNAPSHOT_JSON_MAX);
    expect(fitChatSnapshot(snapshot)).toBe(snapshot);
    expect(snapshot.trimmed).toEqual([]);
  });

  it('empties the message bodies first, and stops there when that is enough', () => {
    const big = withMessages(build(ALL), 2000, 1000);
    expect(bytes(big)).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
    const fit = fitChatSnapshot(big);
    expect(bytes(fit)).toBeLessThanOrEqual(CHAT_SNAPSHOT_JSON_MAX);
    expect(fit.trimmed).toEqual(['messageBodies']);
    expect(fit.trimmed[0]).toBe('messageBodies');
    expect(fit.days).toHaveLength(15);
    expect(fit.messages).toHaveLength(2000);
    expect(fit.messages!.every((m) => m.body === '')).toBe(true);
    // The rest of each message, and every other part, as it was.
    expect(fit.messages![7]).toEqual({ ...big.messages![7]!, body: '' });
    expect(fit.grades).toEqual(big.grades);
    expect(fit.days).toEqual(big.days);
  });

  it('measures the JSON in bytes, which Hebrew doubles', () => {
    // 300,000 Hebrew letters are 300,000 characters of JSON and 600,000 bytes.
    const hebrew = { ...build(ALL), messages: [messageOf(1, 'א'.repeat(300_000))] };
    expect(JSON.stringify(hebrew).length).toBeLessThan(CHAT_SNAPSHOT_JSON_MAX);
    expect(bytes(hebrew)).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
    expect(fitChatSnapshot(hebrew).trimmed).toEqual(['messageBodies']);
  });

  it('drops the days after today + 7 next, when the bodies were not enough', () => {
    const snapshot = build();
    // A 40 KB note on every lesson-day: 15 of them are over the cap, the first 9 are not.
    const heavy: ChatSnapshot = {
      ...snapshot,
      days: snapshot.days.map((d) => ({ ...d, events: [{ naturalKey: `e|${d.date}`, date: d.date, title: 'ארוע', details: 'x'.repeat(40_000), source: 'shahaf' as const }] })),
    };
    expect(bytes(heavy)).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
    const fit = fitChatSnapshot(heavy);
    expect(bytes(fit)).toBeLessThanOrEqual(CHAT_SNAPSHOT_JSON_MAX);
    // No messages in it, so no claim that their bodies were cut.
    expect(fit.trimmed).toEqual(['laterDays']);
    expect(fit.days.map((d) => d.date)).toEqual(snapshot.days.slice(0, 9).map((d) => d.date));
    expect(fit.days.at(-1)!.date).toBe('2026-11-11');
  });

  it('drops the grades older than 90 days last, in the order the spec gives', () => {
    const snapshot = build();
    const grade = (n: number, date: string): Grade => ({
      naturalKey: `g|${n}`, date, subject: 'מתמטיקה', value: 80, valueText: null, weight: null, notes: 'x'.repeat(3000), firstSeen: null,
    });
    // 300 old grades (a year ago) and 100 recent ones (30 days ago): 1.2 MB, and 300 KB without the old.
    const grades = [
      ...Array.from({ length: 300 }, (_v, n) => grade(n, '2026-01-10')),
      ...Array.from({ length: 100 }, (_v, n) => grade(1000 + n, '2026-10-05')),
      grade(5000, '2026-08-06'),
      grade(5001, '2026-08-05'),
    ];
    const heavy: ChatSnapshot = { ...snapshot, grades, messages: [messageOf(1, 'שלום')] };
    expect(bytes(heavy)).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
    const fit = fitChatSnapshot(heavy);
    expect(bytes(fit)).toBeLessThanOrEqual(CHAT_SNAPSHOT_JSON_MAX);
    expect(fit.trimmed).toEqual(['messageBodies', 'laterDays', 'oldGrades']);
    expect(fit.messages![0]!.body).toBe('');
    expect(fit.days).toHaveLength(9);
    // 90 days before 4.11.2026 is 6.8.2026: that day stays, the one before goes.
    expect(fit.grades).toHaveLength(101);
    expect(fit.grades!.every((g) => g.date >= '2026-08-06')).toBe(true);
    expect(fit.grades!.some((g) => g.naturalKey === 'g|5000')).toBe(true);
  });

  it('keeps the order of the keys, and does not touch what it was given', () => {
    const big = withMessages(build(ALL), 2000, 1000);
    const before = JSON.stringify(big);
    const fit = fitChatSnapshot(big);
    expect(Object.keys(fit)).toEqual(Object.keys(big));
    expect(JSON.stringify(big)).toBe(before);
    expect(big.trimmed).toEqual([]);
    // The hash of what was cut is the hash of the same cut built again.
    expect(chatHash(fitChatSnapshot(withMessages(build(ALL), 2000, 1000)))).toBe(chatHash(fit));
  });

  it('does not say it cut what it did not', () => {
    const big = withMessages(build(ALL), 2000, 1000);
    // Cut once already, then written again with the same list: nothing to add to it.
    const again = fitChatSnapshot({ ...fitChatSnapshot(big), messages: big.messages });
    expect(again.trimmed).toEqual(['messageBodies']);
  });

  it('cuts what it can and returns that when even all three are not enough', () => {
    const snapshot = build(ALL);
    const impossible: ChatSnapshot = { ...snapshot, exams: Array.from({ length: 4000 }, (_v, n) => ({ naturalKey: `e|${n}`, date: '2026-12-01', subject: 'x'.repeat(200), details: null, source: 'shahaf' as const })) };
    const fit = fitChatSnapshot(impossible);
    expect(bytes(fit)).toBeGreaterThan(CHAT_SNAPSHOT_JSON_MAX);
    // Only what there was to cut is marked cut: the demo's messages have bodies, its grades are all recent.
    expect(fit.trimmed).toEqual(['messageBodies', 'laterDays']);
  });
});

describe('readChatSnapshot', () => {
  it("keeps the source's name of a lesson the student renamed", () => {
    const wired = wire(build());
    const day = wired.days.find((d) => d.lessons.length > 1)!;
    day.lessons[0]!.originalSubject = 'גוש ב׳';
    const read = readChatSnapshot(wired)!;
    expect(read.days.find((d) => d.date === day.date)!.lessons[0]!.originalSubject).toBe('גוש ב׳');
    expect(read.days.find((d) => d.date === day.date)!.lessons[1]).not.toHaveProperty('originalSubject');
  });

  const good = (): ChatSnapshot => wire(build(ALL));

  it('reads a snapshot back as it was built, whole', () => {
    const snapshot = build(ALL);
    const read = readChatSnapshot(wire(snapshot));
    expect(read).toEqual(snapshot);
    expect(chatHash(read)).toBe(chatHash(snapshot));
    // A snapshot of the default shares reads without the parts it never had.
    const plain = build();
    expect(Object.keys(readChatSnapshot(wire(plain))!)).toEqual(Object.keys(plain));
  });

  it('reads a snapshot that was trimmed, with what was trimmed', () => {
    const fit = fitChatSnapshot({ ...build(ALL), messages: Array.from({ length: 2000 }, (_v, n) => ({ date: AT, from: null, title: `${n}`, body: 'x'.repeat(1000) })) });
    expect(readChatSnapshot(wire(fit))).toEqual(fit);
    expect(readChatSnapshot(wire(fit))!.trimmed).toEqual(['messageBodies']);
  });

  it('reads nothing from what is not a snapshot', () => {
    expect(readChatSnapshot({})).toBeNull();
    for (const value of [null, undefined, 'snapshot', 3, true, [], [good()]]) expect(readChatSnapshot(value)).toBeNull();
  });

  it('needs its version, its time and its shares: without one, nothing in it can be trusted', () => {
    const { v: _v, ...noVersion } = good();
    const { at: _at, ...noTime } = good();
    const { shares: _shares, ...noShares } = good();
    expect(readChatSnapshot(noVersion)).toBeNull();
    expect(readChatSnapshot(noTime)).toBeNull();
    expect(readChatSnapshot(noShares)).toBeNull();
    expect(readChatSnapshot({ ...good(), v: '1' })).toBeNull();
    expect(readChatSnapshot({ ...good(), v: 0 })).toBeNull();
    expect(readChatSnapshot({ ...good(), at: 'yesterday' })).toBeNull();
    expect(readChatSnapshot({ ...good(), at: 5 })).toBeNull();
    // Each of the five switches is a true or false, or the shares are no shares.
    expect(readChatSnapshot({ ...good(), shares: { ...ALL, grades: 'yes' } })).toBeNull();
    const { grades: _grades, ...fourShares } = ALL;
    expect(readChatSnapshot({ ...good(), shares: fourShares })).toBeNull();
    expect(readChatSnapshot({ ...good(), shares: null })).toBeNull();
    // The five are enough, and a sixth (Google's), true or false, from a development build from before 2026-11-05, is read past and not handed on.
    for (const google of [true, false]) expect(readChatSnapshot({ ...good(), shares: { ...ALL, google } })).toEqual(good());
  });

  it('reads a status it does not know as a plain lesson', () => {
    const snapshot = good();
    const day = snapshot.days.find((d) => d.lessons.length > 0)!;
    expect(day.lessons[0]!.status).toBe('regular');
    const altered = {
      ...snapshot,
      days: [{ ...day, lessons: [{ ...day.lessons[0]!, status: 'teleported' }, ...day.lessons.slice(1)] }],
    };
    const read = readChatSnapshot(altered)!;
    expect(read.days).toHaveLength(1);
    expect(read.days[0]!.lessons).toHaveLength(day.lessons.length);
    expect(read.days[0]!.lessons[0]!.status).toBe('regular');
    // A real status stays what it is.
    const cancelled = snapshot.days.flatMap((d) => d.lessons).find((l) => l.status === 'cancelled')!;
    const kept = readChatSnapshot({ ...snapshot, days: [{ ...day, lessons: [cancelled] }] })!;
    expect(kept.days[0]!.lessons[0]!.status).toBe('cancelled');
  });

  it('reads a level, a source and a kind it does not know as the plainest', () => {
    const snapshot = good();
    const exam = { ...snapshot.exams[0]!, source: 'carrier-pigeon', kind: 'oral' };
    const read = readChatSnapshot({
      ...snapshot,
      exams: [exam],
      absences: [{ ...snapshot.absences![0]!, level: 'catastrophe' }],
    })!;
    expect(read.absences![0]!.level).toBe('ok');
    expect(read.exams[0]!.source).toBe('mashov');
    expect('kind' in read.exams[0]!).toBe(false);
  });

  it('keeps the other grades when one is malformed', () => {
    const snapshot = good();
    const grades = snapshot.grades!;
    expect(grades.length).toBeGreaterThan(3);
    const broken = [
      { ...grades[0]!, date: 'last week' },
      grades[1]!,
      { ...grades[2]!, subject: 7 },
      { ...grades[3]!, value: '92' },
      'not a grade',
      null,
      ...grades.slice(4),
    ];
    const read = readChatSnapshot({ ...snapshot, grades: broken })!;
    expect(read.grades).toEqual(grades.slice(1, 2).concat(grades.slice(4)));
  });

  it('drops a lesson, a day, an exam or a message that does not read, and keeps its neighbours', () => {
    const snapshot = good();
    const day = snapshot.days.find((d) => d.lessons.length > 1)!;
    const { days } = snapshot;
    const withBad = {
      ...snapshot,
      days: [
        { ...days[0]!, date: 'soon' },
        { ...day, lessons: [{ ...day.lessons[0]!, hourIndex: 'first' }, ...day.lessons.slice(1)] },
        { ...days[2]!, lessons: 'none' },
        days[3]!,
      ],
      exams: [{ ...snapshot.exams[0]!, date: null }, ...snapshot.exams.slice(1)],
      messages: [{ ...snapshot.messages![0]!, body: 5 }, ...snapshot.messages!.slice(1)],
    };
    const read = readChatSnapshot(withBad)!;
    expect(read.days.map((d) => d.date)).toEqual([day.date, snapshot.days[3]!.date]);
    expect(read.days[0]!.lessons).toEqual(day.lessons.slice(1));
    expect(read.exams).toEqual(snapshot.exams.slice(1));
    expect(read.messages).toEqual(snapshot.messages!.slice(1));
  });

  it('reads averages back, dropping bad entries', () => {
    const snapshot = good();
    const read = readChatSnapshot({
      ...snapshot,
      averages: [
        { subject: 'מתמטיקה', average: 87.5 },
        { subject: '', average: 1 },
        { subject: 'x', average: '9' },
        { subject: 'y', average: 70, uncounted: -1 },
      ],
    })!;
    // A bad `uncounted` is dropped, not the entry.
    expect(read.averages).toEqual([{ subject: 'מתמטיקה', average: 87.5 }, { subject: 'y', average: 70 }]);

    const kinds = readChatSnapshot({
      ...snapshot,
      averages: [
        { subject: 'a', average: 80, uncounted: 2 },
        { subject: 'b', average: 81, uncounted: 1.5 },
        { subject: 'c', average: 82, uncounted: '3' },
        { subject: 'd', average: Number.POSITIVE_INFINITY },
        { subject: 'e', average: null },
        { subject: 4, average: 83 },
        'not an average',
        null,
        { subject: 'f', average: 84, uncounted: 0, extra: 1 },
      ],
    })!;
    expect(kinds.averages).toEqual([
      { subject: 'a', average: 80, uncounted: 2 },
      { subject: 'b', average: 81 },
      { subject: 'c', average: 82 },
      { subject: 'f', average: 84, uncounted: 0 },
    ]);
  });

  it('reads an older phone\'s copy, which has grades and no averages, without any', () => {
    const { averages: _averages, ...older } = good();
    const read = readChatSnapshot(older)!;
    expect(read.grades).toEqual(older.grades);
    expect('averages' in read).toBe(false);
    // And an empty list is not a missing one.
    expect(readChatSnapshot({ ...older, averages: [] })!.averages).toEqual([]);
  });

  it('keeps the averages right after the grades, so the hash is the one the phone wrote', () => {
    const snapshot = build(ALL);
    const read = readChatSnapshot(wire(snapshot))!;
    expect(Object.keys(read)).toEqual(Object.keys(snapshot));
    expect(chatHash(read)).toBe(chatHash(snapshot));
  });

  it('drops a part that is no list and the rest stays', () => {
    const snapshot = good();
    const read = readChatSnapshot({ ...snapshot, homework: 'many', grades: { 0: 1 }, averages: 'high', bagrut: null, absences: undefined })!;
    for (const part of ['homework', 'grades', 'averages', 'bagrut', 'absences'] as const) expect(part in read).toBe(false);
    expect(read.messages).toEqual(snapshot.messages);
    expect(read.days).toEqual(snapshot.days);
    // An empty list is not a missing one.
    expect(readChatSnapshot({ ...snapshot, grades: [] })!.grades).toEqual([]);
  });

  it('ignores Google in a copy that carries it: the switch, a day\'s calendar and the tasks', () => {
    const snapshot = build(DEFAULT_CHAT_SHARES);
    const event = {
      id: 'e1', calendarId: 'c1', calendarName: 'אישי', seriesId: null, summary: 'אימון כדורסל', location: 'מרכז הספורט',
      start: '2026-11-04T17:00:00+02:00', end: '2026-11-04T18:30:00+02:00', allDay: false,
    };
    const task = {
      id: 't1', listId: 'l1', listTitle: 'המשימות שלי', title: 'לקנות מחברת משבצות', notes: null, due: TODAY, completed: false, updated: null, linkedHomeworkKey: null,
    };
    // A copy a development build from before 2026-11-05 could write, with the Google switch on: the switch, events on a day, the open tasks.
    const withGoogle = wire({
      ...snapshot,
      shares: { ...snapshot.shares, google: true },
      days: snapshot.days.map((d, i) => (i === 1 ? { ...d, calendar: [event] } : d)),
      tasks: [task],
    });
    const read = readChatSnapshot(withGoogle)!;
    expect('google' in read.shares).toBe(false);
    expect(read.days.every((d) => !('calendar' in d))).toBe(true);
    expect('tasks' in read).toBe(false);
    expect(read).toEqual(snapshot);
    expect(JSON.stringify(read)).not.toContain('אימון כדורסל');
    expect(JSON.stringify(read)).not.toContain('לקנות מחברת משבצות');
    // A stray switch of any kind is just as ignored, and the copy without one reads the same.
    expect('google' in readChatSnapshot({ ...withGoogle, shares: { ...snapshot.shares, google: 'maybe' } })!.shares).toBe(false);
    expect(readChatSnapshot(wire(snapshot))).toEqual(snapshot);
  });

  it('ignores a Google Task id on a homework item of a copy that carries one', () => {
    const snapshot = build(DEFAULT_CHAT_SHARES);
    const withIds = wire({ ...snapshot, homework: snapshot.homework!.map((h, i) => ({ ...h, linkedTaskId: `google-task-id-${i}` })) });
    expect(JSON.stringify(withIds)).toContain('google-task-id-0');
    const read = readChatSnapshot(withIds)!;
    expect(read.homework!.length).toBe(snapshot.homework!.length);
    expect(read.homework!.every((h) => !('linkedTaskId' in h))).toBe(true);
    expect(JSON.stringify(read)).not.toContain('google-task-id');
    expect(read).toEqual(snapshot);
    // An item that had a non-text id (a corrupt one) is not dropped for it: the id is simply not read.
    const odd = readChatSnapshot({ ...withIds, homework: snapshot.homework!.map((h) => ({ ...h, linkedTaskId: 7 })) })!;
    expect(odd.homework).toEqual(snapshot.homework);
  });

  it('reads a later version as version 1 and leaves out what it does not know', () => {
    const snapshot = good();
    const read = readChatSnapshot({
      ...snapshot,
      v: 2,
      extra: 1,
      school: { ...snapshot.school, grade: 'יא' },
      shares: { ...snapshot.shares, newThing: true },
      days: snapshot.days.map((d) => ({ ...d, mood: 'sunny', lessons: d.lessons.map((l) => ({ ...l, floor: 2 })) })),
    })!;
    expect(read.v).toBe(1);
    expect('extra' in read).toBe(false);
    expect(read).toEqual(snapshot);
  });

  it('reads the school as far as it reads, and a missing one as nothing known', () => {
    const snapshot = good();
    expect(readChatSnapshot({ ...snapshot, school: { name: 'בית ספר', className: 3 } })!.school).toEqual({ name: 'בית ספר', className: null });
    expect(readChatSnapshot({ ...snapshot, school: 'here' })!.school).toEqual({ name: null, className: null });
    const { school: _school, ...noSchool } = snapshot;
    expect(readChatSnapshot(noSchool)!.school).toEqual({ name: null, className: null });
  });

  it('reads what is only trimmed as the values it knows', () => {
    const snapshot = good();
    expect(readChatSnapshot({ ...snapshot, trimmed: ['laterDays', 'shrunkenHeads', 4, 'messageBodies'] })!.trimmed).toEqual(['laterDays', 'messageBodies']);
    expect(readChatSnapshot({ ...snapshot, trimmed: 'laterDays' })!.trimmed).toEqual([]);
  });

  it('reads the timetable, the exams and the trims as empty when they are missing', () => {
    const { days: _days, exams: _exams, trimmed: _trimmed, ...bare } = good();
    const read = readChatSnapshot(bare)!;
    expect(read.days).toEqual([]);
    expect(read.exams).toEqual([]);
    expect(read.trimmed).toEqual([]);
    expect(read.shares).toEqual(ALL);
  });

  it('keeps a message\'s body as it is, line breaks included', () => {
    const snapshot = good();
    const body = 'שורה ראשונה\nשורה שנייה\t‫בלי סינון';
    const read = readChatSnapshot({ ...snapshot, messages: [{ ...snapshot.messages![0]!, body }] })!;
    expect(read.messages![0]!.body).toBe(body);
  });
});
