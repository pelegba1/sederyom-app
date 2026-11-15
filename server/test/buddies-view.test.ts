/**
 * A friend's day and what the friends screens show (app/src/buddies/days.ts,
 * app/src/buddies/view.ts): a friend's lessons rebuilt from their class feed
 * and their picks, or taken from their box; the list's one line, the friend's
 * page, and the lines on Today; all of it empty for a parent.
 */
import { describe, expect, it } from 'vitest';
import type {
  BuddyAbsence, BuddyBagrutRow, BuddyBoxContent, BuddyGradesContent, BuddyGradeSubject, BuddyLesson, BuddyShares, BuddyTimetable, ClassFeed, ClassLesson, DateStr, UserSettings,
} from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { lessonHideKey } from '@sederyom/shared/logic/filters';
import type { MashovGrade } from '@sederyom/shared/logic/mashov/normalize';
import { addDays } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { buildLocalDays, type LocalSources } from '../../app/src/local/days';
import { buddyLessons } from '../../app/src/buddies/days';
import { BUDDY_COPY } from '../../app/src/buddies/copy';
import { myGradesContent } from '../../app/src/buddies/grades';
import { buddyFeedKey, type BuddiesState, type Buddy } from '../../app/src/buddies/store';
import { readGradesContent } from '../../app/src/buddies/validate';
import { buddiesModel, buddyPageModel, tableLines, todayLinesModel, type BuddiesInput } from '../../app/src/buddies/view';
import { demoBuddies } from '../../app/src/demo/buddies';
import { DEMO_CLASS, DEMO_SITE, demoData } from '../../app/src/demo/data';
import { isolateRanges } from '../../app/src/lib/format';
import { EMPTY_WEIGHTS } from '../../app/src/lib/gradeWeights';

const ZONE = 'Asia/Jerusalem';
const SITE = 'https://school-a.shahaf.site';
const at = (when: string) => DateTime.fromISO(when, { zone: ZONE }).toJSDate();
/** A name as the copy sets it: in a first-strong isolate (U+2068 … U+2069). */
const iso = (name: string) => `${String.fromCharCode(0x2068)}${name}${String.fromCharCode(0x2069)}`;
// Tuesday 3.11.2026, 09:00: this week runs from Sunday 1.11 to Saturday 7.11.
const NOW = at('2026-11-03T09:00');
const TUESDAY = '2026-11-03';

const BELLS: Record<number, [string, string]> = {
  1: ['08:00', '08:45'], 2: ['08:45', '09:30'], 3: ['09:45', '10:30'], 4: ['10:30', '11:15'],
  5: ['11:35', '12:20'], 6: ['12:20', '13:05'], 7: ['13:15', '14:00'],
};
const SUBJECTS: Record<number, string> = { 1: 'מתמטיקה', 2: 'מתמטיקה', 3: 'אנגלית', 4: 'היסטוריה', 5: 'ספרות', 6: 'פיזיקה', 7: 'תנ״ך' };

function lesson(date: DateStr, hour: number, over: Partial<ClassLesson> = {}): ClassLesson {
  const [startTime, endTime] = BELLS[hour]!;
  return { date, hourIndex: hour, startTime, endTime, subject: SUBJECTS[hour]!, teacher: `מורה ${hour}`, room: null, status: 'regular', substitute: null, note: null, ...over };
}

/** The same lesson as a friend's box carries it, for a school without a site. */
const boxed = (l: ClassLesson): BuddyLesson =>
  ({ date: l.date, hourIndex: l.hourIndex, start: l.startTime, end: l.endTime, subject: l.subject, teacher: l.teacher, status: l.status });

function feedOf(classId: string, className: string, lessons: ClassLesson[]): ClassFeed {
  return { class: { siteUrl: SITE, classId, className, examCalendarId: null }, lastOkAt: '2026-11-03T06:00:00.000Z', freshness: null, lessons, changes: [], exams: [], events: [], messages: [] };
}

/** Sunday to Thursday of the week of 1.11 and of the week after: periods 1 to 4, then 6 and 7; 5 is free. */
function schoolWeeks(hours: readonly number[] = [1, 2, 3, 4, 6, 7]): ClassLesson[] {
  const out: ClassLesson[] = [];
  for (const sunday of ['2026-11-01', '2026-11-08']) {
    for (let i = 0; i < 5; i++) for (const h of hours) out.push(lesson(addDays(sunday, i, ZONE), h));
  }
  return out;
}

const MY_FEED = feedOf('1', 'יא2', schoolWeeks());

function sources(feed: ClassFeed | null, settings: Partial<UserSettings> = {}, now = NOW): LocalSources {
  return { feed, mashov: [], bagrut: [], google: [], settings: { ...DEFAULT_SETTINGS, classId: '1', className: 'יא2', ...settings }, zone: ZONE, now };
}

function datesFrom(from: DateStr, count: number): DateStr[] {
  return Array.from({ length: count }, (_v, i) => addDays(from, i, ZONE));
}

function box(name: string, timetable: Partial<BuddyTimetable> | null, absences?: BuddyAbsence[]): BuddyBoxContent {
  const content: BuddyBoxContent = { v: 1, at: '2026-11-03T06:40:00.000Z', name, shares: { timetable: timetable !== null, absences: absences !== undefined } };
  if (timetable) content.timetable = { siteUrl: null, classId: 'x', className: 'יא3', hiddenSubjects: [], exams: [], ...timetable };
  if (absences) content.absences = { semesterStart: '2026-09-01', semesterEnd: '2027-01-31', subjects: absences };
  return content;
}

function buddy(id: string, name: string, theirs: BuddyBoxContent | null, over: Partial<Buddy> = {}): Buddy {
  return {
    id, role: 'inviter', secret: 'A'.repeat(43), name, label: '', shares: { timetable: true, absences: true },
    theirs, readAt: theirs?.at ?? null, everRead: theirs !== null, written: null, theirGrades: null, gradesWritten: null, gradesDot: false,
    addedAt: '2026-10-01T00:00:00.000Z', ...over,
  };
}

function input(buddies: Buddy[], over: Partial<BuddiesInput> & { myFeed?: ClassFeed | null } = {}): BuddiesInput {
  const { myFeed = MY_FEED, ...rest } = over;
  const now = rest.now ?? NOW;
  const base = rest.base ?? sources(myFeed, {}, now);
  const state: BuddiesState = { myName: 'פלג', buddies, invites: [], answers: [], unseen: false, notes: [] };
  return {
    state,
    feeds: new Map(),
    base,
    mine: buildLocalDays(base, datesFrom('2026-11-01', 20)),
    audience: 'student',
    now,
    zone: ZONE,
    mySchool: { siteUrl: myFeed ? SITE : null, mashovSchool: null },
    myGrades: null,
    myHasBagrut: false,
    ...rest,
  };
}

/**
 * A friend's page at one school without a site (one Mashov school, both timed):
 * my `mine` periods and their `theirs` on each school day, and `extra` lessons of mine (and `theirsExtra` of theirs).
 */
function atOneSchool(mine: readonly number[], theirs: readonly number[], extra: ClassLesson[] = [], theirsExtra: ClassLesson[] = []) {
  const mate = buddy('n', 'נועה', box('נועה', { lessons: [...schoolWeeks(theirs), ...theirsExtra].map(boxed), mashovSchool: '123' }));
  const myFeed = feedOf('1', 'יא2', [...schoolWeeks(mine), ...extra]);
  return buddyPageModel(input([mate], { myFeed, mySchool: { siteUrl: null, mashovSchool: '123' } }), 'n', TUESDAY)!;
}

/** A friend at a school without a site, whose box carries `hours` on each school day of the two weeks. */
const noSiteMate = (id: string, name: string, hours: readonly number[], over: Partial<BuddyTimetable> = {}) =>
  buddy(id, name, box(name, { lessons: schoolWeeks(hours).map(boxed), ...over }));

describe("a friend's lessons", () => {
  it("rebuilds a friend's day from their class and their picks", () => {
    // Class 2 has two groups of מתמטיקה in period 1; the friend's picks hide the one with כהן.
    const lessons = [lesson(TUESDAY, 1, { teacher: 'כהן' }), lesson(TUESDAY, 1, { teacher: 'לוי' }), lesson(TUESDAY, 2)];
    const feed = feedOf('2', 'יא3', lessons);
    const hidden = lessonHideKey({ subject: 'מתמטיקה', teacher: 'כהן' }, true);
    const content = box('נועה', { siteUrl: SITE, classId: '2', hiddenSubjects: [hidden] });
    const days = buddyLessons(content, feed, sources(MY_FEED), [TUESDAY]);
    expect(days?.get(TUESDAY)?.map((l) => [l.hourIndex, l.subject, l.teacher])).toEqual([
      [1, 'מתמטיקה', 'לוי'],
      [2, 'מתמטיקה', 'מורה 2'],
    ]);

    // And the page reads the feed kept for that class.
    const page = buddyPageModel(input([buddy('n', 'נועה', content)], { feeds: new Map([[buddyFeedKey(SITE, '2'), feed]]) }), 'n', TUESDAY);
    expect(page?.table.filter((r) => r.theirs).map((r) => r.theirs?.teacher)).toEqual(['לוי', 'מורה 2']);
    expect(page?.className).toBe('יא3');
  });

  it("uses the box's lessons without a site", () => {
    const content = box('נועה', { lessons: [boxed(lesson(TUESDAY, 2)), boxed(lesson(TUESDAY, 3))] });
    const days = buddyLessons(content, null, sources(MY_FEED), [TUESDAY, '2026-11-04']);
    expect(days?.get(TUESDAY)?.map((l) => [l.hourIndex, l.start, l.end])).toEqual([[2, '08:45', '09:30'], [3, '09:45', '10:30']]);
    // A day of the two weeks the box covers, with nothing on it: a day without lessons.
    expect(days?.get('2026-11-04')).toEqual([]);
    // Nothing shared, nothing to rebuild.
    expect(buddyLessons(box('נועה', null), null, sources(MY_FEED), [TUESDAY])).toBeNull();
  });

  it('knows only the weeks a trimmed box carries, and none in a box with no lessons left', () => {
    // Two weeks would not fit: the box carries this week, so the next one is not known, not a week off.
    const trimmed = box('נועה', { lessons: [boxed(lesson(TUESDAY, 2))], lessonsTrimmed: true });
    const days = buddyLessons(trimmed, null, sources(MY_FEED), [TUESDAY, '2026-11-04', '2026-11-10']);
    expect(days?.get(TUESDAY)?.map((l) => l.hourIndex)).toEqual([2]);
    expect(days?.get('2026-11-04')).toEqual([]);
    expect(days?.has('2026-11-10')).toBe(false);
    // Not even one week fit: nothing of their days is known.
    const bare = box('נועה', { mashovSchool: '123' });
    expect(buddyLessons(bare, null, sources(MY_FEED), [TUESDAY, '2026-11-10'])?.size).toBe(0);
    expect(buddyPageModel(input([buddy('n', 'נועה', bare)]), 'n', TUESDAY)).toMatchObject({ unpublished: true, table: [] });
  });

  it('marks a week the site has not published', () => {
    const feed = feedOf('2', 'יא3', [lesson(TUESDAY, 1)]);
    const content = box('נועה', { siteUrl: SITE, classId: '2' });
    const days = buddyLessons(content, feed, sources(MY_FEED), [TUESDAY, '2026-11-10']);
    expect(days?.has(TUESDAY)).toBe(true);
    expect(days?.has('2026-11-10')).toBe(false);

    const page = buddyPageModel(input([buddy('n', 'נועה', content)], { feeds: new Map([[buddyFeedKey(SITE, '2'), feed]]) }), 'n', '2026-11-10');
    expect(page).toMatchObject({ unpublished: true, table: [], compare: null });
  });
});

describe('the friends list', () => {
  it('writes the list line as the sketch does', () => {
    const view = buddiesModel(input([
      noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7]),
      noSiteMate('s', 'שירה', [1, 2, 3, 4, 5]),
      // יואב's box has lessons only on Wednesdays.
      buddy('y', 'יואב', box('יואב', { lessons: [boxed(lesson('2026-11-04', 1))] })),
    ]));
    expect(view.rows.map((r) => [r.name, r.line])).toEqual([
      ['נועה', 'מסיימים יחד ב־14:00, חלון משותף 11:15'],
      ['שירה', `סוף היום: ${iso('שירה')} 12:20, שלך 14:00`],
      ['יואב', 'היום בלי לימודים'],
    ]);
    expect(view.rows[0]).toMatchObject({ id: 'n', initial: 'נ', className: 'יא3', waiting: false });
  });

  it('greys a friend whose box has not come yet, counts only sent invites, and says when the list is full', () => {
    // Both phones of a pairing, before the other's first box: an approved friend, waiting for a first update.
    for (const role of ['inviter', 'invitee'] as const) {
      const view = buddiesModel(input([buddy('w', 'עומר', null, { role }), noSiteMate('n', 'נועה', [1, 2])]));
      expect(view.rows[0]).toMatchObject({ name: 'עומר', line: 'מחכים לעדכון ראשון', waiting: true, className: null });
    }
    // A link stays open after its first answers: the row beside its count says so, and not that anyone is waited for.
    expect(BUDDY_COPY.waiting(1)).toBe('הקישור עדיין פתוח');
    const state = (n: number, unsent: number): BuddiesState => ({
      myName: 'פלג', buddies: [], answers: [], unseen: true, notes: ['הערה'],
      invites: Array.from({ length: n }, (_v, i) => ({ secret: `s${i}`, secretKey: 'k', shares: { timetable: true, absences: true }, createdAt: NOW.toISOString(), ...(i < unsent ? { unsent: true as const } : {}) })),
    });
    expect(buddiesModel(input([], { state: state(3, 1) }))).toMatchObject({ invites: 2, full: false, unseen: true, notes: ['הערה'], myName: 'פלג' });
    expect(buddiesModel(input([], { state: state(20, 0) })).full).toBe(true);
  });

  it("lists my exams a friend shares, by the friend's own exams", () => {
    const myExams = [{ naturalKey: 'e1', date: '2026-11-05', subject: 'מבחן במתמטיקה', details: null, source: 'shahaf' as const }];
    const myFeed = { ...MY_FEED, exams: myExams };
    const mate = buddy('n', 'נועה', box('נועה', { exams: [{ date: '2026-11-05', subject: 'מתמטיקה', title: 'מתמטיקה' }] }));
    expect(buddiesModel(input([mate], { myFeed })).exams).toEqual([{ date: '2026-11-05', title: 'מבחן במתמטיקה', together: ['נועה'], sameSubject: [] }]);
  });

  it('names a friend by my name for them, else by the name their latest box gives', () => {
    // They renamed themselves after we paired: the box says so before the record does.
    const renamed = buddy('n', 'נועה', box('נועה כהן', { lessons: schoolWeeks([1, 2]).map(boxed) }));
    expect(buddiesModel(input([renamed])).rows[0]).toMatchObject({ name: 'נועה כהן', initial: 'נ' });
    expect(buddyPageModel(input([renamed]), 'n', TUESDAY)?.name).toBe('נועה כהן');
    const labelled = { ...renamed, label: 'נועי' };
    expect(buddiesModel(input([labelled])).rows[0]?.name).toBe('נועי');
    // Before their first box, the name their answer gave.
    expect(buddiesModel(input([buddy('w', 'עומר', null)])).rows[0]?.name).toBe('עומר');
  });

  it('shows nothing to a parent', () => {
    const parent = input([noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7])], { audience: 'parent' });
    expect(buddiesModel(parent)).toMatchObject({ rows: [], invites: 0, exams: [], unseen: false, notes: [], full: false });
    expect(buddyPageModel(parent, 'n', TUESDAY)).toBeNull();
    expect(todayLinesModel(parent, TUESDAY)).toEqual([]);
  });
});

describe("a friend's page", () => {
  it('sums the day up and sets the two days hour by hour', () => {
    const page = buddyPageModel(input([noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7])]), 'n', TUESDAY)!;
    expect(page.summary).toEqual(['מסיימים יחד ב־14:00', isolateRanges('חלון משותף 11:15–12:20'), 'מתחילים יחד ב־08:00']);
    expect(page.table.map((r) => [r.start, r.kind])).toEqual([
      ['08:00', 'together'], ['08:45', 'together'], ['09:45', 'together'], ['10:30', 'together'],
      ['11:15', 'window'], ['12:20', 'together'], ['13:15', 'together'],
    ]);
    expect(page).toMatchObject({ id: 'n', name: 'נועה', date: TUESDAY, noTimes: null, unpublished: false, updatedAt: '2026-11-03T06:40:00.000Z' });
  });

  it('says the two ends apart, and whose timetable has no times', () => {
    const page = buddyPageModel(input([noSiteMate('s', 'שירה', [2, 3, 4, 5])]), 's', TUESDAY)!;
    expect(page.summary).toEqual([`סוף היום: ${iso('שירה')} 12:20, שלך 14:00`, `התחלה: שלך 08:00, ${iso('שירה')} 08:45`]);

    // Their box from Mashov without times, at another school: nothing to compare by.
    const untimed = (hours: number[]) => schoolWeeks(hours).map((l) => ({ ...boxed(l), start: null, end: null }));
    const theirs = buddy('t', 'תמר', box('תמר', { lessons: untimed([1, 2]), mashovSchool: '999' }));
    // Nothing set against anything: no summary, no table, only the line that says why.
    expect(buddyPageModel(input([theirs]), 't', TUESDAY)).toMatchObject({ noTimes: 'theirs', summary: [], table: [] });
    expect(buddiesModel(input([theirs])).rows[0]?.line).toBe('אי אפשר להשוות שעות');
    // Mine without times: the fault is mine.
    const myUntimed = feedOf('1', 'יא2', schoolWeeks().map((l) => ({ ...l, startTime: null, endTime: null })));
    const timedMate = noSiteMate('n', 'נועה', [1, 2]);
    expect(buddyPageModel(input([timedMate], { myFeed: myUntimed }), 'n', TUESDAY)).toMatchObject({ noTimes: 'mine', summary: [], table: [] });
    expect(buddiesModel(input([timedMate], { myFeed: myUntimed })).rows[0]?.line).toBe('אי אפשר להשוות שעות');
    expect(todayLinesModel(input([theirs], { now: at('2026-11-03T07:00') }), TUESDAY)).toEqual([]);
  });

  it('compares by period at one school without times', () => {
    const untimed = (hours: number[]) => schoolWeeks(hours).map((l) => ({ ...boxed(l), start: null, end: null }));
    const mine = feedOf('1', 'יא2', schoolWeeks().map((l) => ({ ...l, startTime: null, endTime: null })));
    const mate = buddy('n', 'נועה', box('נועה', { lessons: untimed([1, 2, 3, 4, 6, 7]), mashovSchool: '123' }));
    const page = buddyPageModel(input([mate], { myFeed: mine, mySchool: { siteUrl: null, mashovSchool: '123' } }), 'n', TUESDAY)!;
    expect(page.compare?.by).toBe('period');
    expect(page.summary).toEqual(['מסיימים יחד אחרי שיעור 7', 'חלון משותף בשיעור 5', 'מתחילים יחד בשיעור 1']);
    expect(page.noTimes).toBeNull();
  });

  it('puts the subjects learnt together first in the absences, and their exams beside mine', () => {
    const absences: BuddyAbsence[] = [
      { subject: 'כימיה', counted: 1, allowed: 5, level: 'ok' },
      { subject: 'מתמטיקה', counted: 2, allowed: 6, level: 'ok' },
    ];
    const mate = buddy('n', 'נועה', box('נועה', { lessons: schoolWeeks([1, 2]).map(boxed), exams: [{ date: '2026-11-09', subject: 'כימיה', title: 'כימיה' }] }, absences));
    const page = buddyPageModel(input([mate]), 'n', TUESDAY)!;
    expect(page.absences).toEqual({ shared: [{ subject: 'מתמטיקה', mine: null, theirs: absences[1] }], others: [absences[0]] });
    expect(page.exams).toEqual([{ date: '2026-11-09', title: 'כימיה', who: 'theirs', otherDate: null, owner: 'theirs' }]);
    expect(page.theirShares).toEqual({ timetable: true, absences: true });

    const timetableOnly = buddy('m', 'מאיה', box('מאיה', { lessons: [] }));
    expect(buddyPageModel(input([timetableOnly]), 'm', TUESDAY)?.absences).toBeNull();
    const absencesOnly = buddy('o', 'אור', box('אור', null, absences));
    expect(buddyPageModel(input([absencesOnly]), 'o', TUESDAY)).toMatchObject({ exams: null, compare: null, table: [] });
  });

  it('sets a subject we both learn beside mine in the absences, with another teacher at another hour', () => {
    // Their חינוך is with another teacher, on Friday, which neither of my weeks holds: never a lesson together.
    const absences: BuddyAbsence[] = [{ subject: 'חינוך', counted: 1, allowed: 3, level: 'ok' }];
    const theirs = [...schoolWeeks([1, 2]), lesson('2026-11-06', 1, { subject: 'חינוך', teacher: 'רון לוי' })];
    const mate = buddy('n', 'נועה', box('נועה', { lessons: theirs.map(boxed) }, absences));
    const count = (groupId: string, subject: string) => ({ kind: 'lesson_count', payload: { groupId, subject, held: 10, weeklyHours: 1 } });
    const base = { ...sources(MY_FEED), mashov: [count('g1', 'חינוך (יא2)'), count('g2', 'מתמטיקה')] } as unknown as LocalSources;
    const page = buddyPageModel(input([mate], { base }), 'n', TUESDAY)!;
    expect(page.absences?.shared.map((s) => [s.subject, s.mine?.subject])).toEqual([['חינוך', 'חינוך (יא2)']]);
    expect(page.absences?.others).toEqual([]);
  });

  it('opens on the next school day on Friday', () => {
    const friday = at('2026-11-06T10:00');
    const mate = noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7]);
    expect(buddyPageModel(input([mate], { now: friday }), 'n')?.date).toBe('2026-11-08');
    // On a school day: today, until my last lesson is over; then the next school day.
    expect(buddyPageModel(input([mate], { now: at('2026-11-03T13:59') }), 'n')?.date).toBe(TUESDAY);
    expect(buddyPageModel(input([mate], { now: at('2026-11-03T14:00') }), 'n')?.date).toBe('2026-11-04');
  });
});

describe("a friend's page, its table as drawn", () => {
  it('makes a lesson sat together for two periods one line, and goes by the clock across schools', () => {
    const page = buddyPageModel(input([noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7])]), 'n', TUESDAY)!;
    expect(page.byHour).toBe(false);
    expect(tableLines(page).map((l) => [l.start, l.kind, l.mine?.subject ?? null])).toEqual([
      ['08:00', 'together', 'מתמטיקה'], ['09:45', 'together', 'אנגלית'], ['10:30', 'together', 'היסטוריה'],
      ['11:15', 'window', null], ['12:20', 'together', 'פיזיקה'], ['13:15', 'together', 'תנ״ך'],
    ]);
  });

  it('spans a window over the periods nobody has a lesson in, at one school', () => {
    const page = atOneSchool([1, 2, 3, 6, 7], [1, 2, 3, 6, 7]);
    expect(page.byHour).toBe(true);
    expect(tableLines(page).map((l) => [l.from, l.to, l.kind])).toEqual([
      [1, 2, 'together'], [3, 3, 'together'], [4, 5, 'window'], [6, 6, 'together'], [7, 7, 'together'],
    ]);
  });

  it('draws two windows of one day as two lines, each at its own period', () => {
    // A lesson only they have, in period 4, splits the free stretch in two: 09:30–10:30 and 11:15–12:20.
    const page = atOneSchool([1, 2, 6, 7], [1, 2, 4, 6, 7]);
    expect(page.compare?.windows).toHaveLength(2);
    expect(tableLines(page).map((l) => [l.from, l.to, l.start, l.kind])).toEqual([
      [1, 2, '08:00', 'together'], [3, 3, '09:30', 'window'], [4, 4, '10:30', 'apart'],
      [5, 5, '11:15', 'window'], [6, 6, '12:20', 'together'], [7, 7, '13:15', 'together'],
    ]);
  });

  it('places a window after the last lesson either of the two has before it', () => {
    // Their period 4 is the last lesson before the window, not my period 3.
    const theirsLater = atOneSchool([1, 2, 3, 6, 7], [1, 2, 3, 4, 6, 7]);
    expect(tableLines(theirsLater).map((l) => [l.from, l.to, l.start, l.kind])).toEqual([
      [1, 2, '08:00', 'together'], [3, 3, '09:45', 'together'], [4, 4, '10:30', 'apart'],
      [5, 5, '11:15', 'window'], [6, 6, '12:20', 'together'], [7, 7, '13:15', 'together'],
    ]);
    const mineLater = atOneSchool([1, 2, 3, 4, 6, 7], [1, 2, 3, 6, 7]);
    expect(tableLines(mineLater).filter((l) => l.kind === 'window').map((l) => [l.from, l.to, l.start])).toEqual([[5, 5, '11:15']]);
  });

  it('keeps a window whole over a cancelled lesson in it, and marks the lesson', () => {
    // Both have 1–3 and 6–7; my period 5 is cancelled: the window is 10:30–12:20, periods 4 and 5.
    const page = atOneSchool([1, 2, 3, 6, 7], [1, 2, 3, 6, 7], [lesson(TUESDAY, 5, { status: 'cancelled' })]);
    expect(page.summary).toContain(isolateRanges('חלון משותף 10:30–12:20'));
    expect(tableLines(page).map((l) => [l.from, l.to, l.start, l.kind, l.cancelled.map((c) => c.subject)])).toEqual([
      [1, 2, '08:00', 'together', []], [3, 3, '09:45', 'together', []], [4, 5, '10:30', 'window', ['ספרות']],
      [6, 6, '12:20', 'together', []], [7, 7, '13:15', 'together', []],
    ]);

    // In one class, a lesson cancelled for both is named once: ״היסטוריה בוטל״, not twice.
    const both = [lesson(TUESDAY, 4, { status: 'cancelled' })];
    const shared = atOneSchool([1, 2, 3, 5, 6, 7], [1, 2, 3, 5, 6, 7], both, both);
    const window = tableLines(shared).filter((l) => l.kind === 'window');
    expect(window.map((l) => [l.from, l.to, l.start, l.cancelled.map((c) => c.subject)])).toEqual([[4, 4, '10:30', ['היסטוריה']]]);
    expect(BUDDY_COPY.cancelledWord(window[0]!.cancelled.length)).toBe('בוטל');

    // By the clock (two schools), two cancelled lessons in one window are two rows, and still one line.
    const cancelled = [lesson(TUESDAY, 4, { status: 'cancelled' }), lesson(TUESDAY, 5, { status: 'cancelled' })];
    const clock = buddyPageModel(
      input([noSiteMate('n', 'נועה', [1, 2, 3, 6, 7])], { myFeed: feedOf('1', 'יא2', [...schoolWeeks([1, 2, 3, 6, 7]), ...cancelled]) }), 'n', TUESDAY,
    )!;
    expect(clock.byHour).toBe(false);
    expect(clock.table.filter((r) => r.kind === 'window')).toHaveLength(2);
    expect(tableLines(clock).filter((l) => l.kind === 'window').map((l) => [l.start, l.cancelled.map((c) => c.subject)])).toEqual([
      ['10:30', ['היסטוריה', 'ספרות']],
    ]);
  });

  it('says whose day has not started or is over, and nothing between two lessons', () => {
    const page = buddyPageModel(input([noSiteMate('s', 'שירה', [2, 3, 4, 5])]), 's', TUESDAY)!;
    expect(tableLines(page).map((l) => [l.start, l.kind, l.mineEmpty, l.theirsEmpty])).toEqual([
      ['08:00', 'apart', null, 'notYet'], ['08:45', 'together', null, null], ['09:45', 'together', null, null],
      ['10:30', 'together', null, null], ['11:35', 'apart', null, null], ['12:20', 'apart', null, 'done'], ['13:15', 'apart', null, 'done'],
    ]);
  });
});

describe('the lines on Today', () => {
  it('words the coming window and the shared end, says which is which, and opens the first friend in each', () => {
    const buddies = [noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7]), noSiteMate('y', 'יואב', [1, 2, 3, 4, 5, 6, 7])];
    expect(todayLinesModel(input(buddies), TUESDAY)).toEqual([
      { text: isolateRanges(`חלון משותף עם ${iso('נועה')} 11:15–12:20`), kind: 'window', buddyId: 'n', buddyIds: ['n'] },
      { text: `מסיימים איתך ב־14:00: ${iso('נועה')}, ${iso('יואב')}`, kind: 'end', buddyId: 'n', buddyIds: ['n', 'y'] },
    ]);
  });

  it('drops the end line once my day is over', () => {
    const buddies = [noSiteMate('n', 'נועה', [1, 2, 3, 4, 6, 7])];
    expect(todayLinesModel(input(buddies, { now: at('2026-11-03T13:30') }), TUESDAY)).toEqual([
      { text: `מסיימים איתך ב־14:00: ${iso('נועה')}`, kind: 'end', buddyId: 'n', buddyIds: ['n'] },
    ]);
    expect(todayLinesModel(input(buddies, { now: at('2026-11-03T14:00') }), TUESDAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The grades tab (docs/superpowers/specs/2026-10-30-buddies-grades-design.md, 2.2 to 2.4)
// ---------------------------------------------------------------------------

const OFF: BuddyShares = { timetable: true, absences: true };
const GRADES: BuddyShares = { ...OFF, grades: true };
const WITH_BAGRUT: BuddyShares = { ...GRADES, bagrut: true };

const subject = (name: string, average: number | null, grades: [DateStr, string, number][]): BuddyGradeSubject => ({
  subject: name, average, grades: grades.map(([date, title, value]) => ({ date, name: title, value })),
});
const bagrutRow = (semel: number, over: Partial<BuddyBagrutRow> = {}): BuddyBagrutRow => ({ semel, name: `שאלון ${semel}`, moed: '2026-06', final: 90, ...over });
const gradesBox = (over: Partial<BuddyGradesContent> = {}): BuddyGradesContent => ({
  v: 1, at: '2026-11-03T06:40:00.000Z', subjects: [subject('מתמטיקה', 80, [['2026-10-27', 'מבחן', 70], ['2026-10-20', 'בוחן', 90]])], ...over,
});
/** My side of it: a subject we both have, one only I have, and a questionnaire. */
const MY_BOX: BuddyGradesContent = gradesBox({
  subjects: [subject('מתמטיקה', 85, [['2026-10-27', 'מבחן', 85]]), subject('אזרחות', 95, [['2026-10-02', 'עבודה', 95]])],
  bagrut: [bagrutRow(1, { final: 88 })],
});

/** A friend I share `mine` with, whose box says they share `theirs`; `box` is the grades box this phone keeps of theirs. */
function gradesMate(mine: BuddyShares, theirs: BuddyShares, box: BuddyGradesContent | null = null, over: Partial<Buddy> = {}): Buddy {
  const content: BuddyBoxContent = { v: 1, at: '2026-11-03T06:40:00.000Z', name: 'נועה', shares: theirs };
  return buddy('n', 'נועה', content, { shares: mine, theirGrades: box, ...over });
}
const gradesOf = (b: Buddy, over: Partial<BuddiesInput> = {}) => buddyPageModel(input([b], over), 'n', TUESDAY)!.grades;

describe("a friend's grades tab", () => {
  it('says that nobody turned grades on, whatever a box this phone still keeps holds', () => {
    expect(gradesOf(gradesMate(OFF, OFF))).toEqual({ state: 'neither', compare: null, bagrut: 'none', from: null, dot: false });
    // A box kept from before one of us turned it off is never shown: the rule says it is not for me.
    expect(gradesOf(gradesMate(OFF, OFF, gradesBox({ from: '2026-09-01' })), { myGrades: MY_BOX })).toEqual({
      state: 'neither', compare: null, bagrut: 'none', from: null, dot: false,
    });
  });

  it('says that only I turned them on, and shows no box of theirs', () => {
    expect(gradesOf(gradesMate(GRADES, OFF))).toMatchObject({ state: 'mine', compare: null, dot: false });
    expect(gradesOf(gradesMate(GRADES, OFF, gradesBox({ from: '2026-09-01' })), { myGrades: MY_BOX })).toMatchObject({ state: 'mine', compare: null, from: null });
  });

  it('says that only they turned them on, with the dot while it has not been answered', () => {
    expect(gradesOf(gradesMate(OFF, GRADES, null, { gradesDot: true }))).toMatchObject({ state: 'theirs', compare: null, dot: true });
    expect(gradesOf(gradesMate(OFF, GRADES, null, { gradesDot: false }))).toMatchObject({ state: 'theirs', dot: false });
    // A box of theirs that a phone still keeps is not shown: I have not turned grades on.
    expect(gradesOf(gradesMate(OFF, GRADES, gradesBox({ from: '2026-09-01' }), { gradesDot: true }), { myGrades: MY_BOX })).toMatchObject({
      state: 'theirs', compare: null, from: null, dot: true,
    });
  });

  it('knows what they turned on from their invite, before their first box is read', () => {
    const invited: Buddy = { ...gradesMate(OFF, OFF, null, { gradesDot: true }), theirs: null, readAt: null, everRead: false, offered: GRADES };
    expect(gradesOf(invited)).toMatchObject({ state: 'theirs', dot: true });
    expect(gradesOf({ ...invited, shares: GRADES })).toMatchObject({ state: 'waiting' });
  });

  it('waits for their first box while both turned them on', () => {
    expect(gradesOf(gradesMate(GRADES, GRADES))).toEqual({ state: 'waiting', compare: null, bagrut: 'none', from: null, dot: false });
    // The dot is for a friend who asks, not for one I have answered.
    expect(gradesOf(gradesMate(GRADES, GRADES, null, { gradesDot: true })).dot).toBe(false);
  });

  it('says that they have no grades yet, from a box with no subject', () => {
    expect(gradesOf(gradesMate(GRADES, GRADES, gradesBox({ subjects: [] })), { myGrades: MY_BOX })).toEqual({
      state: 'empty', compare: null, bagrut: 'none', from: null, dot: false,
    });
  });

  it('lists the subjects, mine beside theirs and the rest of theirs apart, and says where their box starts', () => {
    const box = gradesBox({ subjects: [subject('מתמטיקה', 80, [['2026-10-27', 'מבחן', 70]]), subject('היסטוריה', 90, [['2026-10-15', 'עבודה', 90]])], from: '2026-09-01' });
    const grades = gradesOf(gradesMate(GRADES, GRADES, box), { myGrades: MY_BOX });
    expect(grades).toMatchObject({ state: 'list', bagrut: 'none', from: '2026-09-01', dot: false });
    expect(grades.compare?.shared.map((s) => [s.subject, s.mine, s.theirs, s.mineCount, s.theirsCount])).toEqual([['מתמטיקה', 85, 80, 1, 1]]);
    expect(grades.compare?.shared[0]?.rows.map((r) => [r.date, r.name, r.mine?.value, r.theirs?.value, r.onlyOne])).toEqual([['2026-10-27', 'מבחן', 85, 70, null]]);
    expect(grades.compare?.others.map((s) => [s.subject, s.theirs])).toEqual([['היסטוריה', 90]]);
    // A subject of mine alone is in neither list.
    expect([...grades.compare!.shared, ...grades.compare!.others].map((s) => s.subject)).not.toContain('אזרחות');
  });

  it('has no from when their box leaves nothing out', () => {
    expect(gradesOf(gradesMate(GRADES, GRADES, gradesBox()), { myGrades: MY_BOX }).from).toBeNull();
  });

  it('puts all of their subjects among the others when Mashov was never read here', () => {
    const grades = gradesOf(gradesMate(GRADES, GRADES, gradesBox()), { myGrades: null });
    expect(grades.state).toBe('list');
    expect(grades.compare?.shared).toEqual([]);
    expect(grades.compare?.others.map((s) => [s.subject, s.mine, s.theirs, s.mineCount])).toEqual([['מתמטיקה', null, 80, 0]]);
  });

  it('lights the dot for a friend who asks for what I could answer, until I open the tab', () => {
    const dot = (mine: BuddyShares, theirs: BuddyShares, myHasBagrut: boolean, gradesDot = true) =>
      gradesOf(gradesMate(mine, theirs, gradesBox(), { gradesDot }), { myGrades: MY_BOX, myHasBagrut }).dot;
    expect(dot(OFF, GRADES, false)).toBe(true);
    // Opened since (`gradesDot` is cleared): no dot, whatever they share.
    expect(dot(OFF, GRADES, false, false)).toBe(false);
    // The bagrut they turned on and I did not.
    expect(dot(GRADES, WITH_BAGRUT, true)).toBe(true);
    // A phone with no bagrut is never nagged about it, though it is still asked for grades.
    expect(dot(GRADES, WITH_BAGRUT, false)).toBe(false);
    expect(dot(OFF, WITH_BAGRUT, false)).toBe(true);
    // Nothing they ask that I have not already turned on.
    expect(dot(GRADES, GRADES, true)).toBe(false);
    expect(dot(WITH_BAGRUT, WITH_BAGRUT, true)).toBe(false);
    expect(dot(GRADES, OFF, true)).toBe(false);
  });

  describe('the bagrut part', () => {
    const bagrutOf = (mine: BuddyShares, theirs: BuddyShares, box: BuddyGradesContent | null, myHasBagrut: boolean) =>
      gradesOf(gradesMate(mine, theirs, box), { myGrades: MY_BOX, myHasBagrut }).bagrut;

    it('is no section when nobody chose it', () => {
      expect(bagrutOf(GRADES, GRADES, gradesBox(), true)).toBe('none');
      expect(bagrutOf(OFF, OFF, null, true)).toBe('none');
    });

    it('is no section on a phone with no bagrut, whatever they chose: no ask, no button', () => {
      expect(bagrutOf(WITH_BAGRUT, GRADES, gradesBox(), false)).toBe('none');
      expect(bagrutOf(GRADES, WITH_BAGRUT, gradesBox({ bagrut: [bagrutRow(1)] }), false)).toBe('none');
      expect(bagrutOf(WITH_BAGRUT, WITH_BAGRUT, gradesBox({ bagrut: [bagrutRow(1)] }), false)).toBe('none');
      const grades = gradesOf(gradesMate(GRADES, WITH_BAGRUT, gradesBox({ bagrut: [bagrutRow(1)] })), { myGrades: MY_BOX, myHasBagrut: false });
      expect(grades.compare?.bagrut).toEqual({ shared: [], others: [] });
    });

    it('says that only I chose it, and that only they did', () => {
      expect(bagrutOf(WITH_BAGRUT, GRADES, gradesBox(), true)).toBe('mine');
      expect(bagrutOf(GRADES, WITH_BAGRUT, gradesBox({ bagrut: [bagrutRow(1)] }), true)).toBe('theirs');
    });

    it('lists the questionnaires once both chose it and their box has the list, even an empty one', () => {
      const grades = gradesOf(gradesMate(WITH_BAGRUT, WITH_BAGRUT, gradesBox({ bagrut: [bagrutRow(1), bagrutRow(2)] })), { myGrades: MY_BOX, myHasBagrut: true });
      expect(grades.bagrut).toBe('list');
      expect(grades.compare?.bagrut.shared.map((r) => [r.semel, r.mine?.final, r.theirs.final])).toEqual([[1, 88, 90]]);
      expect(grades.compare?.bagrut.others.map((r) => r.semel)).toEqual([2]);
      expect(bagrutOf(WITH_BAGRUT, WITH_BAGRUT, gradesBox({ bagrut: [] }), true)).toBe('list');
    });

    it('lists the questionnaires of a friend with no grades yet: the bagrut is its own list, beside an empty state', () => {
      const grades = gradesOf(gradesMate(WITH_BAGRUT, WITH_BAGRUT, gradesBox({ subjects: [], bagrut: [bagrutRow(1), bagrutRow(2)] })), { myGrades: MY_BOX, myHasBagrut: true });
      expect(grades.state).toBe('empty');
      expect(grades.bagrut).toBe('list');
      expect(grades.compare?.shared).toEqual([]);
      expect(grades.compare?.others).toEqual([]);
      expect(grades.compare?.bagrut.shared.map((r) => [r.semel, r.mine?.final, r.theirs.final])).toEqual([[1, 88, 90]]);
      expect(grades.compare?.bagrut.others.map((r) => r.semel)).toEqual([2]);
      // With no bagrut part, or not chosen by both, an empty box is still only the empty state.
      expect(gradesOf(gradesMate(WITH_BAGRUT, WITH_BAGRUT, gradesBox({ subjects: [] })), { myGrades: MY_BOX, myHasBagrut: true })).toMatchObject({ state: 'empty', bagrut: 'none', compare: null });
      expect(gradesOf(gradesMate(GRADES, WITH_BAGRUT, gradesBox({ subjects: [], bagrut: [bagrutRow(1)] })), { myGrades: MY_BOX, myHasBagrut: true })).toMatchObject({
        state: 'empty', bagrut: 'theirs', compare: null,
      });
    });

    it('has nothing to list while both chose it but their box has no bagrut part yet', () => {
      expect(bagrutOf(WITH_BAGRUT, WITH_BAGRUT, gradesBox(), true)).toBe('none');
      expect(bagrutOf(WITH_BAGRUT, WITH_BAGRUT, null, true)).toBe('none');
    });

    it('shows none of their questionnaires unless both chose it, even from a box that holds them', () => {
      for (const [mine, theirs] of [[GRADES, WITH_BAGRUT], [WITH_BAGRUT, GRADES]] as const) {
        const grades = gradesOf(gradesMate(mine, theirs, gradesBox({ bagrut: [bagrutRow(1), bagrutRow(2)] })), { myGrades: MY_BOX, myHasBagrut: true });
        expect(grades.state).toBe('list');
        expect(grades.compare?.bagrut).toEqual({ shared: [], others: [] });
      }
    });
  });

  it('is empty for a parent, as is the rest of the page', () => {
    expect(buddyPageModel(input([gradesMate(GRADES, GRADES, gradesBox())], { audience: 'parent', myGrades: MY_BOX }), 'n', TUESDAY)).toBeNull();
  });
});

describe("the demo friend's grades", () => {
  /** The made-up friend's grades tab on `now`, over the demo's own grades and bagrut as the demo's phone sets them (run.ts `inputFor`). */
  function demoGrades(now: Date) {
    const demo = demoData(now, ZONE);
    const buddies = demoBuddies(now, ZONE);
    const today = DateTime.fromJSDate(now).setZone(ZONE).toISODate()!;
    const base: LocalSources = {
      feed: demo.feed, mashov: demo.mashov, bagrut: demo.bagrut, google: demo.google,
      settings: { ...DEFAULT_SETTINGS, classId: DEMO_CLASS.id, className: DEMO_CLASS.name }, zone: ZONE, now,
    };
    const grades = demo.mashov.filter((e) => e.kind === 'grade').map((e) => e.payload as MashovGrade);
    const myGrades = myGradesContent({ grades, weights: EMPTY_WEIGHTS, bagrut: demo.bagrut, withBagrut: true, readAt: now.toISOString() });
    const page = buddyPageModel(
      input(buddies.state.buddies, {
        base, now, mine: buildLocalDays(base, datesFrom(today, 7)), feeds: new Map(Object.entries(buddies.feeds)),
        mySchool: { siteUrl: DEMO_SITE, mashovSchool: null }, myGrades, myHasBagrut: true,
      }),
      'demo-noa',
    )!;
    return { buddies, demo, myGrades, grades: page.grades };
  }

  // A school day, one in the spring, a Saturday, and the summer break: the dates follow the day it is built for.
  const DAYS = ['2026-11-03T09:00', '2027-03-17T10:00', '2026-11-07T10:00', '2027-07-08T10:00'].map(at);

  it.each(DAYS.map((now) => [now.toISOString(), now] as const))('has grades to compare on %s', (_label, now) => {
    const { grades } = demoGrades(now);
    expect(grades).toMatchObject({ state: 'list', bagrut: 'list', from: null, dot: false });
    const { shared, others, bagrut } = grades.compare!;

    // A subject with an assessment both of us have: the same day and the same name, one grade each.
    const pair = shared.flatMap((s) => s.rows).find((r) => r.mine && r.theirs);
    expect(pair).toMatchObject({ onlyOne: null });
    expect(pair?.name).toBeTruthy();

    // A subject we both have grades in, with no assessment in common: every row is one side's alone.
    const apart = shared.find((s) => s.rows.length > 0 && s.rows.every((r) => !(r.mine && r.theirs)));
    expect(apart).toBeDefined();
    expect(apart!.rows.every((r) => r.onlyOne !== null)).toBe(true);
    expect(apart!.rows.some((r) => r.onlyOne === 'mine') && apart!.rows.some((r) => r.onlyOne === 'theirs')).toBe(true);

    // A subject only she has grades in.
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((s) => s.mine === null && s.mineCount === 0 && s.theirs !== null)).toBe(true);

    // A questionnaire both of us sat, and one only she did.
    expect(bagrut.shared.length).toBeGreaterThan(0);
    expect(bagrut.shared.every((r) => r.mine && r.mine.semel === r.theirs.semel)).toBe(true);
    expect(bagrut.others.length).toBeGreaterThan(0);
  });

  it.each(DAYS.map((now) => [now.toISOString(), now] as const))(
    'pairs exactly the three assessments the student sat too, and keeps every other row on one side, on %s',
    (_label, now) => {
      const { grades, demo } = demoGrades(now);
      const sat = (key: string): string => {
        const g = demo.mashov.map((e) => e.payload as MashovGrade).find((p) => p.naturalKey === `mashov-grade|${key}`)!;
        return `${g.subject}|${g.date}|${g.notes}`;
      };
      const rows = grades.compare!.shared.flatMap((s) => s.rows.map((r) => ({ subject: s.subject, ...r })));
      // Math: the exam on equations and the quiz on the quadratic function; physics: the quiz on kinematics.
      expect(rows.filter((r) => r.mine && r.theirs).map((r) => `${r.subject}|${r.date}|${r.name}`).sort()).toEqual([sat('demo-1'), sat('demo-7'), sat('demo-10')].sort());
      expect(rows.filter((r) => r.mine && r.theirs).every((r) => r.onlyOne === null)).toBe(true);
      // Every other row is one side's alone, and says so: none of hers fell on a day the student has a grade of the subject.
      const rest = rows.filter((r) => !(r.mine && r.theirs));
      expect(rest.every((r) => (r.mine === null) !== (r.theirs === null) && r.onlyOne === (r.mine ? 'mine' : 'theirs'))).toBe(true);
      expect(rest.filter((r) => r.theirs).map((r) => r.subject).sort()).toEqual(['אנגלית', 'אנגלית', 'מתמטיקה', 'פיזיקה']);
    },
  );

  it('is modest: one side is not always higher, in a row or in a subject, and not everything is a hundred', () => {
    const { grades } = demoGrades(DAYS[0]!);
    // The averages too: the student is ahead in some subjects and she is in others.
    const shared = grades.compare!.shared.filter((s) => s.mine !== null && s.theirs !== null);
    expect(shared.some((s) => s.mine! > s.theirs!)).toBe(true);
    expect(shared.some((s) => s.theirs! > s.mine!)).toBe(true);
    const rows = grades.compare!.shared.flatMap((s) => s.rows).filter((r) => r.mine?.value !== undefined && r.theirs?.value !== undefined);
    expect(rows.some((r) => r.mine!.value! > r.theirs!.value!)).toBe(true);
    expect(rows.some((r) => r.theirs!.value! > r.mine!.value!)).toBe(true);
    const all = [...grades.compare!.shared, ...grades.compare!.others].flatMap((s) => s.rows).flatMap((r) => [r.theirs?.value]).filter((v) => v !== undefined);
    expect(all.length).toBeGreaterThan(0);
    expect(Math.max(...all as number[])).toBeLessThan(100);
    const averages = [...grades.compare!.shared, ...grades.compare!.others].map((s) => s.theirs);
    expect(averages.every((a) => a !== null && a >= 70 && a < 98)).toBe(true);
  });

  it('is a grades box her phone could have written, and both chose grades and the bagrut', () => {
    for (const now of DAYS) {
      const { buddies } = demoGrades(now);
      const noa = buddies.state.buddies[0]!;
      expect(noa.shares).toEqual({ timetable: true, absences: true, grades: true, bagrut: true });
      expect(noa.theirs?.shares).toEqual({ timetable: true, absences: true, grades: true, bagrut: true });
      expect(noa.gradesDot).toBe(false);
      expect(noa.theirGrades).not.toBeNull();
      // The friend's phone reads it unchanged: nothing it drops, and nothing in it that is not JSON.
      expect(readGradesContent(JSON.parse(JSON.stringify(noa.theirGrades)))).toEqual(noa.theirGrades);
    }
  });

  it('takes its dates from the day it is built for, not from the clock', () => {
    const a = demoGrades(DAYS[0]!).buddies.state.buddies[0]!.theirGrades!;
    const b = demoGrades(DAYS[1]!).buddies.state.buddies[0]!.theirGrades!;
    const newest = (box: BuddyGradesContent) => box.subjects.flatMap((s) => s.grades.map((g) => g.date)).sort().at(-1)!;
    // Her newest grade is at most a school week behind the day, and moves with it.
    expect(newest(a) < '2026-11-03' && newest(a) >= '2026-10-23').toBe(true);
    expect(newest(b) < '2027-03-17' && newest(b) >= '2027-03-07').toBe(true);
    expect(a.at).toBe(demoBuddies(DAYS[0]!, ZONE).state.buddies[0]!.theirs!.at);
  });
});
