/**
 * Own names for subjects on the phone (design 2026-11-05, "איפה מחליפים"):
 * the days it builds, its exam lists, Mashov's grades, homework and absences,
 * and its own notes of them carry the student's name, once, with the source's
 * kept in `originalSubject`. Hiding and matching still go by the source's
 * name, an exam's own name still beats its subject's, and a friend's days are
 * never in my names.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { BuddyBoxContent, ClassFeed, ClassLesson, DayView, Exam, Lesson, SubjectOption, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { buildWidgetFeed } from '@sederyom/shared/logic/build';
import { examSubjectKey } from '@sederyom/shared/logic/exam-match';
import { blockNameKey, nameContext, subjectNameKey, withSubjectName } from '@sederyom/shared/logic/ownNames';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { composeEveningReminder, composeMorningSummary, packItems, packKey } from '@sederyom/shared/logic/summaries';
import { markSettingsDue, settingsChangeOf } from '../../app/src/api/settingsChange';
import { myBoxContent } from '../../app/src/buddies/content';
import { buddyLessons, lessonsOfDay } from '../../app/src/buddies/days';
import { myGradesContent } from '../../app/src/buddies/grades';
import { mirrorState, runPhoneMirror } from '../../app/src/google/mirror';
import { EMPTY_WEIGHTS } from '../../app/src/lib/gradeWeights';
import { lessonTaskTitle } from '../../app/src/lib/planner';
import { examSlot, groupGradesBySubject, groupLessonOptions, homeworkTaskTitle, withClassroomGrades } from '../../app/src/lib/school';
import { changesShareText, examsShareText } from '../../app/src/lib/share';
import { dueNames, examStrip, lessonHideKeys, nextLessonDate, timedSlots } from '../../app/src/lib/today';
import { buildLocalDays, examOptionsAsPublished, localExamsFrom, type LocalSources } from '../../app/src/local/days';
import { NO_EXAM_PREFS, ownExams, readExamPrefs, renamedExam, setExamName } from '../../app/src/local/examPrefs';
import { addManualExam, readManualExams } from '../../app/src/local/manualExams';
import { attendanceFrom, gradesOf, homeworkOf } from '../../app/src/local/schoolFeeds';
import {
  examNameOriginals, examNameTarget, examTitleIsSubject, examWithNames, groupNameTarget, groupOwnName, lessonNameTarget, lessonWithName,
  namedDays, namedExam, namesOfSources, nameOfDraft,
} from '../../app/src/local/subjectNames';
import { planMashovNotes } from '../../app/src/notify/mashovNotes';
import { nextLessonNote } from '../../app/src/notify/nextLesson';
import { linkedHomework } from '../../app/src/notify/summaries';
import { examRow, homeworkFocus, homeworkLine, lessonColorKey, lessonTitle, nextExamLine, OWN_EXAM_NAME_MAX, widgetSubjectColor } from '../../app/src/widget/model';

const ZONE = 'Asia/Jerusalem';
// Wednesday 21.10.2026.
const NOW = new Date('2026-10-21T08:00:00Z');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });
afterAll(() => {
  vi.useRealTimers();
});

const DAY = '2026-10-21';
/** The block as the class's site writes its line. */
const BLOCK = 'גוש ב׳ (יב)';
/** The student's name for it, under the line's key in "השיעורים שלי". */
const NAMES = { "גוש ב' (יב)": 'פיזיקה' };
const BLOCK_EXAM = 'site-exam|block';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}

function lesson(hourIndex: number, subject: string, teacher: string, date = DAY): ClassLesson {
  const start = `0${7 + hourIndex}:00`.slice(-5);
  return { date, hourIndex, startTime: start, endTime: `${start.slice(0, 3)}45`, subject, teacher, room: null, status: 'regular', substitute: null, note: null };
}

const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: NOW.toISOString(),
  freshness: null,
  lessons: [lesson(1, BLOCK, 'כהן דנה'), lesson(2, 'אנגלית', 'שרון')],
  changes: [],
  exams: [
    { naturalKey: BLOCK_EXAM, date: DAY, subject: "מבחן גוש ב'", details: null, source: 'school_site' },
    { naturalKey: 'site-exam|english', date: '2026-10-28', subject: 'מבחן באנגלית', details: null, source: 'school_site' },
  ],
  events: [],
  messages: [],
};

const entity = (kind: string, naturalKey: string, payload: object): NormalizedEntity =>
  ({ source: 'mashov', kind, naturalKey, payload }) as unknown as NormalizedEntity;

/** Mashov's items of the block, under the name Mashov gives its group. */
const MASHOV = [
  entity('homework', 'hw-block', { dueDate: DAY, dueExplicit: true, subject: "גוש ב'", text: 'תרגיל 3' }),
  entity('homework', 'hw-english', { dueDate: DAY, dueExplicit: true, subject: 'אנגלית', text: 'חיבור' }),
  entity('grade', 'g-block', { naturalKey: 'g-block', date: '2026-10-19', subject: "גוש ב'", value: 90, valueText: null, weight: null, notes: null, isExam: true }),
  entity('lesson_count', 'lc-block', { groupId: 'g1', subject: "גוש ב'", held: 20, weeklyHours: 4 }),
];

function settings(lessons: Partial<UserSettings['lessons']> = {}): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    examsToCalendar: true,
    lessons: { ...DEFAULT_SETTINGS.lessons, ...lessons },
    attendance: { ...DEFAULT_SETTINGS.attendance, semesterStart: '2026-09-01', semesterEnd: '2027-01-31' },
  };
}

function sources(over: Partial<LocalSources> = {}): LocalSources {
  return { feed: FEED, mashov: MASHOV, bagrut: [], google: [], settings: settings({ subjectNames: NAMES }), zone: ZONE, now: NOW, ...over };
}

const lessonsOf = (day: { timeline: { kind: string; lesson?: unknown }[] }) =>
  day.timeline.filter((i) => i.kind === 'lesson').map((i) => i.lesson as { subject: string; originalSubject?: string });

describe('the days the phone builds', () => {
  it('name the block\'s lesson, its exam and its homework, and keep the source\'s names', () => {
    const [day] = buildLocalDays(sources(), [DAY]);
    const lessons = lessonsOf(day!);
    expect(lessons[0]).toMatchObject({ subject: 'פיזיקה', originalSubject: BLOCK });
    // Another subject keeps its name, with nothing added.
    expect(lessons[1]!.subject).toBe('אנגלית');
    expect('originalSubject' in lessons[1]!).toBe(false);

    expect(day!.examsToday).toEqual([
      { naturalKey: BLOCK_EXAM, date: DAY, subject: 'מבחן פיזיקה', details: null, source: 'school_site', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה' },
    ]);
    expect(day!.nextExam?.exam).toMatchObject({ subject: 'מבחן פיזיקה', subjectName: 'פיזיקה' });

    const homework = day!.homework.find((h) => h.naturalKey === 'hw-block')!;
    expect(homework).toMatchObject({ subject: 'פיזיקה', originalSubject: "גוש ב'" });
    expect(day!.homework.find((h) => h.naturalKey === 'hw-english')!.subject).toBe('אנגלית');
  });

  it('hide a hidden line by the source\'s name, its name kept and in no one\'s way', () => {
    const hidden = sources({ settings: settings({ subjectNames: NAMES, hiddenSubjects: ["גוש ב' (יב)"] }) });
    const [day] = buildLocalDays(hidden, [DAY]);
    expect(lessonsOf(day!).map((l) => l.subject)).toEqual(['אנגלית']);
    // No kept line of the block, and no name of the block's own: the exam keeps the school's title.
    expect(day!.examsToday.map((e) => e.subject)).toEqual(["מבחן גוש ב'"]);
  });

  it('give an exam its own name over its subject\'s', () => {
    const kv = memoryKv();
    setExamName(kv, BLOCK_EXAM, 'בוחן פתע', "מבחן גוש ב'");
    const [day] = buildLocalDays(sources({ examPrefs: readExamPrefs(kv) }), [DAY]);
    const [exam] = day!.examsToday;
    expect(exam).toMatchObject({ subject: 'בוחן פתע', originalSubject: "מבחן גוש ב'" });
    expect('subjectName' in exam!).toBe(false);
  });

  it('are the same days as ever without names, and cost nothing', () => {
    const plain = buildLocalDays(sources({ settings: settings() }), [DAY, '2026-10-22']);
    // Settings from before the feature have no map at all.
    const before = settings();
    delete (before.lessons as { subjectNames?: unknown }).subjectNames;
    expect(buildLocalDays(sources({ settings: before }), [DAY, '2026-10-22'])).toEqual(plain);
    // A name of a line the class does not have names nothing.
    const elsewhere = sources({ settings: settings({ subjectNames: { 'ביולוגיה': 'ביו' } }) });
    expect(buildLocalDays(elsewhere, [DAY, '2026-10-22'])).toEqual(plain);
    expect(JSON.stringify(plain)).not.toMatch(/originalSubject|subjectName/);
    // No names: the very days given back.
    expect(namesOfSources(sources({ settings: settings() }))).toBeNull();
    expect(namedDays(plain, null)).toBe(plain);
    const ctx = namesOfSources(elsewhere);
    expect(namedDays(plain, ctx)[0]).toBe(plain[0]);
  });
});

describe('the exams the phone lists', () => {
  it('carry the name: the widget\'s upcoming list and the Google calendar', async () => {
    const exams = localExamsFrom(sources(), DAY, DAY);
    expect(exams.find((e) => e.naturalKey === BLOCK_EXAM)).toMatchObject({ subject: 'מבחן פיזיקה', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה' });
    expect(exams.find((e) => e.naturalKey === 'site-exam|english')!.subject).toBe('מבחן באנגלית');

    const kv = memoryKv();
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }));
    const posted: string[] = [];
    const requester: GoogleRequester = {
      async request<T>(url: string, init: RequestInit = {}): Promise<T> {
        const method = init.method ?? 'GET';
        if (method === 'GET' && url.endsWith('/calendars/phone-cal')) return { id: 'phone-cal' } as T;
        if (method === 'GET' && url.includes('/events?')) return { items: [] } as T;
        if (method === 'POST') posted.push(String((JSON.parse(String(init.body)) as { summary: string }).summary));
        return {} as T;
      },
    };
    await runPhoneMirror({ kv, requester, src: sources(), now: NOW });
    expect(posted.sort()).toEqual(['מבחן · מבחן באנגלית', 'מבחן · מבחן פיזיקה']);
  });

  it('are not undone by the exams\' own names: a subject\'s name passes, an exam\'s own one wins over it (Review Focus 1)', () => {
    const named: Exam = {
      naturalKey: BLOCK_EXAM, date: DAY, subject: 'מבחן פיזיקה', details: null, source: 'school_site', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה',
    };
    expect(localExamsFrom(sources(), DAY, DAY).find((e) => e.naturalKey === BLOCK_EXAM)).toEqual(named);
    expect(renamedExam(named, NO_EXAM_PREFS)).toBe(named);
    expect(ownExams([named], undefined)).toEqual([named]);
    // A name of its own equal to the school's title is no name of its own.
    expect(renamedExam(named, { renames: { [BLOCK_EXAM]: "מבחן גוש ב'" }, calendarSkip: [], dates: {} })).toBe(named);

    const own = renamedExam(named, { renames: { [BLOCK_EXAM]: 'בוחן פתע' }, calendarSkip: [], dates: {} });
    expect(own).toEqual({ naturalKey: BLOCK_EXAM, date: DAY, subject: 'בוחן פתע', details: null, source: 'school_site', originalSubject: "מבחן גוש ב'" });
    // Its own name cleared, the source's title back, as before: the list is built again for the subject's.
    expect(renamedExam(own, NO_EXAM_PREFS)).toEqual({ naturalKey: BLOCK_EXAM, date: DAY, subject: "מבחן גוש ב'", details: null, source: 'school_site' });
    // And naming again never names over an exam's own name.
    expect(namedExam(own, namesOfSources(sources()))).toBe(own);
  });

  it('name an exam from Mashov as Mashov\'s other items, and keep the title rule for bagrut and those added by hand', () => {
    const kv = memoryKv();
    addManualExam(kv, { date: '2026-10-27', subject: 'אנגלית 5 יח"ל' }, NOW);
    const src = sources({
      mashov: [...MASHOV, entity('exam', 'mashov-exam|english', { date: '2026-10-26', subject: 'אנגלית 5 יח"ל', details: null })],
      manualExams: readManualExams(kv),
      settings: settings({ subjectNames: { ...NAMES, 'אנגלית': 'English' } }),
    });
    const exams = localExamsFrom(src, DAY, DAY);
    // Mashov names the subject, so the exam is named as its grade and homework are: the name, as typed.
    expect(exams.find((e) => e.naturalKey === 'mashov-exam|english')).toEqual({
      naturalKey: 'mashov-exam|english', date: '2026-10-26', subject: 'English', details: null, source: 'mashov',
      originalSubject: 'אנגלית 5 יח"ל', subjectName: 'English',
    });
    // The same subject added by hand is a title: only the words that read the subject change.
    expect(exams.find((e) => e.kind === 'manual')).toMatchObject({ subject: 'English 5 יח"ל', originalSubject: 'אנגלית 5 יח"ל', subjectName: 'English' });
    // And the same on the day it is due.
    const [day] = buildLocalDays(src, ['2026-10-26']);
    expect(day!.examsToday.map((e) => e.subject)).toEqual(['English']);
  });

  it('in "המבחנים שלי": the source\'s subject group and the same match, under the name', () => {
    const owner = { kept: [{ subject: BLOCK, teacher: 'כהן דנה' }, { subject: 'אנגלית', teacher: 'שרון' }], hidden: [] };
    const plain = examOptionsAsPublished(localExamsFrom(sources({ settings: settings() }), DAY, DAY), owner, DEFAULT_SETTINGS);
    const named = examOptionsAsPublished(localExamsFrom(sources(), DAY, DAY), owner, DEFAULT_SETTINGS);
    const before = plain.find((o) => o.naturalKey === BLOCK_EXAM)!;
    const after = named.find((o) => o.naturalKey === BLOCK_EXAM)!;
    expect(after).toMatchObject({ subject: 'מבחן פיזיקה', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה' });
    expect(after.subjectKey).toBe(before.subjectKey);
    expect(after.match).toEqual(before.match);
    expect(after.hidden).toBe(before.hidden);
  });
});

describe('a saved name', () => {
  it('leaves the "בית ספר" calendar due, so its exams take the name at the next refresh', () => {
    const kv = memoryKv();
    const ran = { calendarId: 'phone-cal', lastRunAt: NOW.toISOString() };
    kv.set('google.mirror', JSON.stringify(ran));
    const named = settingsChangeOf({ lessons: { subjectNames: NAMES } });
    expect(named).toMatchObject({ lessons: true, subjectNames: true });
    markSettingsDue(kv, named);
    expect(mirrorState(kv)).toMatchObject({ calendarId: 'phone-cal', lastRunAt: null });

    // Another setting, or the hide list alone, leaves it be.
    const other = memoryKv();
    other.set('google.mirror', JSON.stringify(ran));
    markSettingsDue(other, settingsChangeOf({ vacationMode: true }));
    markSettingsDue(other, settingsChangeOf({ lessons: { hiddenSubjects: ['אנגלית'] } }));
    expect(mirrorState(other).lastRunAt).toBe(NOW.toISOString());
  });
});

describe("Mashov's lists", () => {
  it('give grades, homework and absences the name, and keep Mashov\'s', () => {
    const src = sources();
    expect(gradesOf(src)[0]).toMatchObject({ subject: 'פיזיקה', originalSubject: "גוש ב'" });
    expect(homeworkOf(src).find((h) => h.naturalKey === 'hw-block')).toMatchObject({ subject: 'פיזיקה', originalSubject: "גוש ב'" });
    expect(attendanceFrom(src, null).subjects[0]).toMatchObject({ groupId: 'g1', subject: 'פיזיקה', originalSubject: "גוש ב'" });
    // Without names, as always.
    const plain = sources({ settings: settings() });
    expect(gradesOf(plain)[0]!.subject).toBe("גוש ב'");
    expect('originalSubject' in gradesOf(plain)[0]!).toBe(false);
  });

  it('hide the homework of a hidden line by Mashov\'s name, before naming', () => {
    const hidden = sources({ settings: settings({ subjectNames: NAMES, hiddenSubjects: ["גוש ב' (יב)"] }) });
    expect(homeworkOf(hidden).map((h) => h.subject)).toEqual(['אנגלית']);
  });

  it('name the subject in the phone\'s own notes of new grades and homework', () => {
    const on = { ...settings({ subjectNames: NAMES }), notifications: { ...DEFAULT_SETTINGS.notifications, new_grade: true } };
    const added = MASHOV.filter((e) => e.kind === 'grade' || e.naturalKey === 'hw-block');
    expect(planMashovNotes(added, on, FEED).map((n) => n.title)).toEqual(['שיעורי בית בפיזיקה', 'ציון חדש בפיזיקה']);
    // Without the names, Mashov's subject as the app writes it.
    const off = { ...on, lessons: { hiddenSubjects: [], subjectNames: {} } };
    expect(planMashovNotes(added, off, FEED).map((n) => n.title)).toEqual(['שיעורי בית בגוש ב׳', 'ציון חדש בגוש ב׳']);
  });
});

describe("a friend's days on my phone (Review Focus 4)", () => {
  it('are in the school\'s names, never mine', () => {
    // My friend's class at my school: their block ב is biology, my name for mine is "פיזיקה".
    const theirs: ClassFeed = { ...FEED, class: { ...FEED.class, classId: '8', className: 'יב3' }, exams: [] };
    const content: BuddyBoxContent = {
      v: 1, at: NOW.toISOString(), name: 'נועה', shares: { timetable: true, absences: false },
      timetable: { siteUrl: FEED.class.siteUrl, classId: '8', className: 'יב3', hiddenSubjects: [], exams: [] },
    };
    const days = buddyLessons(content, theirs, sources(), [DAY]);
    expect(days?.get(DAY)?.map((l) => l.subject)).toEqual([BLOCK, 'אנגלית']);
  });
});

/** The class's lines as settings lists them (`SubjectOption`, in the server's `subjectKey` form: one kind of quote mark). */
const SUBJECTS: SubjectOption[] = [
  { key: "גוש ב' (יב)", name: "גוש ב' (יב)", teacher: 'כהן דנה', inMashov: false, count: 4 },
  { key: 'אנגלית', name: 'אנגלית', teacher: 'שרון', inMashov: false, count: 4 },
];

/** The day after, with the same lessons: "the next lesson", and the widget's window. */
const NEXT = '2026-10-22';
const WEEK: ClassFeed = { ...FEED, lessons: [...FEED.lessons, lesson(1, BLOCK, 'כהן דנה', NEXT), lesson(2, 'אנגלית', 'שרון', NEXT)] };

/** A name with what the school's names lose (brackets): it is shown as typed. */
const BRACKETED = { "גוש ב' (יב)": 'פיזיקה (מעבדה)' };

const dayLessons = (day: DayView): Lesson[] => day.timeline.flatMap((i) => (i.kind === 'lesson' ? [i.lesson] : []));

describe("what matches or keys by subject keeps the source's name (Review Focus 2, 3)", () => {
  it('the pack list: what was written under the school\'s name is still in "מחר לתיק"', () => {
    const pack = { [packKey(BLOCK)]: 'מחשבון' };
    const [named] = buildLocalDays(sources(), [DAY]);
    const [plain] = buildLocalDays(sources({ settings: settings() }), [DAY]);
    expect(dayLessons(named!)[0]!.subject).toBe('פיזיקה');
    expect(packItems(named!, pack)).toEqual(['מחשבון']);
    expect(packItems(named!, pack)).toEqual(packItems(plain!, pack));
    const evening = composeEveningReminder(named!, { pack })!;
    expect(`${evening.title}\n${evening.body}`).toContain('מחר לתיק: מחשבון');
  });

  it('"זה לא השיעור שלי" hides the same row of "השיעורים שלי" (Review Focus 3)', () => {
    const [named] = buildLocalDays(sources(), [DAY]);
    const [plain] = buildLocalDays(sources({ settings: settings() }), [DAY]);
    const renamed = dayLessons(named!)[0]!;
    expect(renamed).toMatchObject({ subject: 'פיזיקה', originalSubject: BLOCK });
    expect(lessonHideKeys(renamed, SUBJECTS)).toEqual(["גוש ב' (יב)"]);
    expect(lessonHideKeys(renamed, SUBJECTS)).toEqual(lessonHideKeys(dayLessons(plain!)[0]!, SUBJECTS));
  });

  it('the widget gives a renamed lesson the colour it had', () => {
    const feedOf = (src: LocalSources) => {
      const days = buildLocalDays(src, [DAY, NEXT]);
      return buildWidgetFeed({ day: days[0]!, days, zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    };
    const named = feedOf(sources({ feed: WEEK }));
    const plain = feedOf(sources({ feed: WEEK, settings: settings() }));
    expect(named.lessons[0]).toMatchObject({ subject: 'פיזיקה', originalSubject: BLOCK });
    expect('originalSubject' in plain.lessons[0]!).toBe(false);
    for (const scheme of ['light', 'dark'] as const) {
      const before = widgetSubjectColor(plain, scheme);
      const after = widgetSubjectColor(named, scheme);
      expect(named.lessons.map((l) => after(lessonColorKey(l)))).toEqual(plain.lessons.map((l) => before(lessonColorKey(l))));
    }
  });

  it('"משימה לשיעור הבא" finds the renamed subject\'s next lesson', () => {
    const days = buildLocalDays(sources({ feed: WEEK }), [DAY, NEXT]);
    const renamed = dayLessons(days[0]!)[0]!;
    expect(renamed.subject).toBe('פיזיקה');
    expect(nextLessonDate(renamed, DAY, days)).toBe(NEXT);
  });

  it("an exam's periods are found among the day's lessons by the source's names", () => {
    const feed: ClassFeed = {
      ...FEED,
      // English sits its exam in its own period today, and is taught tomorrow.
      lessons: [lesson(1, BLOCK, 'כהן דנה'), { ...lesson(2, 'אנגלית', 'שרון'), status: 'exam' }, lesson(2, 'אנגלית', 'שרון', NEXT)],
      exams: [{ naturalKey: 'site-exam|english-today', date: DAY, subject: 'מבחן באנגלית', details: null, source: 'school_site' }],
    };
    const [day] = buildLocalDays(sources({ feed, settings: settings({ subjectNames: { 'אנגלית': 'English' } }) }), [DAY]);
    const exam = day!.examsToday[0]!;
    expect(exam).toMatchObject({ subject: 'מבחן בEnglish', originalSubject: 'מבחן באנגלית' });
    expect(dayLessons(day!)[1]).toMatchObject({ subject: 'English', status: 'exam' });
    expect(examSlot({ ...exam }, day)).toMatchObject({ lead: 'שיעור', periods: '2' });
  });

  it("a renamed subject's grades keep the weights and the Classroom work kept under the school's name", () => {
    const grade = (naturalKey: string, value: number, notes: string, subject: string, originalSubject?: string) => ({
      naturalKey, date: '2026-10-19', subject, value, valueText: null, weight: null, notes, firstSeen: null,
      ...(originalSubject === undefined ? {} : { originalSubject }),
    });
    const plain = [grade('a', 100, 'מבחן', "גוש ב'"), grade('b', 50, 'עבודה', "גוש ב'")];
    const named = [grade('a', 100, 'מבחן', 'פיזיקה', "גוש ב'"), grade('b', 50, 'עבודה', 'פיזיקה', "גוש ב'")];
    // Only tests count in the school's name's setup.
    const weights = {
      subjects: { "גוש ב'": { types: [{ id: 'exam', label: 'מבחן', percent: 100 }, { id: 'quiz', label: 'בוחן', percent: 0 }, { id: 'work', label: 'עבודה', percent: 0 }, { id: 'other', label: 'אחר', percent: 0 }] } },
      grades: {},
    };
    const [before] = groupGradesBySubject(plain, weights);
    const [after] = groupGradesBySubject(named, weights);
    expect(after).toMatchObject({ subject: 'פיזיקה', originalSubject: "גוש ב'" });
    expect(after!.average).toEqual(before!.average);
    expect(after!.average?.value).toBe(100);
    // Classroom's work of the subject joins it, as it did under the school's name.
    const work = { naturalKey: 'cw-1', courseName: 'פיזיקה יב', subject: "גוש ב'", title: 'מעבדה 2', link: 'https://classroom', grade: 9, maxPoints: 10, updatedAt: '2026-10-20T10:00:00Z' };
    const groups = withClassroomGrades([after!], [work]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.classroom.map((c) => c.naturalKey)).toEqual(['cw-1']);
  });
});

describe("what a friend gets, and what is set beside theirs, is in the school's names (Review Focus 4)", () => {
  it('my box: the exams\' titles, the lessons of a school without a site, and the absences', () => {
    const src = sources();
    const days = buildLocalDays(src, [DAY]);
    expect(days[0]!.examsToday[0]!.subject).toBe('מבחן פיזיקה');
    const box = myBoxContent({
      name: 'דנה', shares: { timetable: true, absences: true }, days, attendance: attendanceFrom(src, null),
      siteUrl: null, classId: '7', className: 'יב2', hiddenSubjects: [], mashovSchool: null, readAt: null, now: NOW,
    });
    expect(box.timetable?.exams.map((e) => e.title)).toEqual(["מבחן גוש ב'"]);
    expect(box.timetable?.lessons?.map((l) => l.subject)).toEqual([BLOCK, 'אנגלית']);
    expect(box.absences?.subjects.map((s) => s.subject)).toEqual(["גוש ב'"]);
    expect(JSON.stringify(box)).not.toContain('פיזיקה');
  });

  it("an exam's own name still goes to friends and to the class's group; a name from its subject never does", () => {
    const kv = memoryKv();
    setExamName(kv, BLOCK_EXAM, 'בוחן פתע', "מבחן גוש ב'");
    const src = sources({ examPrefs: readExamPrefs(kv), settings: settings({ subjectNames: { ...NAMES, 'אנגלית': 'English' } }) });
    const days = buildLocalDays(src, [DAY, '2026-10-28']);
    const exams = days.flatMap((d) => d.examsToday);
    // On my phone: the block's exam by its own name, English's by the subject's.
    expect(exams.map((e) => e.subject)).toEqual(['בוחן פתע', 'מבחן בEnglish']);
    expect(exams[1]).toMatchObject({ originalSubject: 'מבחן באנגלית', subjectName: 'English' });
    const box = myBoxContent({
      name: 'דנה', shares: { timetable: true, absences: false }, days, attendance: null,
      siteUrl: FEED.class.siteUrl, classId: '7', className: 'יב2', hiddenSubjects: [], mashovSchool: null, readAt: null, now: NOW,
    });
    expect(box.timetable?.exams).toEqual([
      { date: DAY, subject: examSubjectKey("מבחן גוש ב'"), title: 'בוחן פתע' },
      { date: '2026-10-28', subject: examSubjectKey('מבחן באנגלית'), title: 'מבחן באנגלית' },
    ]);
    const share = examsShareText(exams, DAY, { className: 'יב2', link: 'https://sederyom.site/join' })!;
    expect(share).toContain('בוחן פתע');
    expect(share).toContain('מבחן באנגלית');
    expect(share).not.toContain('English');
  });

  it("my side of a friend's page: my lessons set beside theirs by the school's names", () => {
    const [day] = buildLocalDays(sources(), [DAY]);
    expect(lessonsOfDay(day!).map((l) => l.subject)).toEqual([BLOCK, 'אנגלית']);
  });

  it("my grades box: grouped and named by Mashov's subject, whatever the phone shows", () => {
    const named = gradesOf(sources());
    expect(named[0]).toMatchObject({ subject: 'פיזיקה', originalSubject: "גוש ב'" });
    const box = myGradesContent({ grades: named, weights: EMPTY_WEIGHTS, bagrut: [], withBagrut: false, readAt: NOW.toISOString() });
    expect(box.subjects.map((s) => s.subject)).toEqual(["גוש ב'"]);
  });
});

describe("a name of the student's own is shown as typed", () => {
  const src = sources({ feed: WEEK, settings: settings({ subjectNames: BRACKETED }) });

  it('on the day, in its lists and in the titles made from it', () => {
    const days = buildLocalDays(src, [DAY, NEXT]);
    const day = days[0]!;
    const lesson = dayLessons(day)[0]!;
    expect(lesson).toMatchObject({ subject: 'פיזיקה (מעבדה)', originalSubject: BLOCK });
    expect(timedSlots(day.timeline, DAY)[0]!.title).toBe('פיזיקה (מעבדה)');
    expect(dueNames([], day.homework)).toContain('פיזיקה (מעבדה)');
    expect(examStrip(day.nextExam!, DAY).subject).toBe('מבחן פיזיקה (מעבדה)');
    expect(lessonTaskTitle(lesson)).toBe('שיעורי בית בפיזיקה (מעבדה)');
    const homework = day.homework.find((h) => h.naturalKey === 'hw-block')!;
    expect(homework).toMatchObject({ subject: 'פיזיקה (מעבדה)', originalSubject: "גוש ב'" });
    expect(homeworkTaskTitle(homework).title).toBe('פיזיקה (מעבדה): תרגיל 3');
    expect(nextLessonNote({ start: '08:00', end: '08:45', lessons: [lesson] }, DAY).title).toBe('הבא: פיזיקה (מעבדה)');
    expect(groupGradesBySubject(gradesOf(src))[0]).toMatchObject({ subject: 'פיזיקה (מעבדה)', originalSubject: "גוש ב'" });
  });

  it('in the morning summary and the evening reminder', () => {
    const [day] = buildLocalDays(src, [DAY]);
    expect(composeMorningSummary(day!).body.split('\n')).toEqual([
      'פיזיקה (מעבדה), אנגלית',
      'להגשה היום: אנגלית, פיזיקה (מעבדה)',
      // The exam by the subject's name, as "מבחן היום: אנגלית" is.
      'מבחן היום: פיזיקה (מעבדה)',
    ]);
    const evening = composeEveningReminder(day!)!;
    expect(evening.title).toBe('מחר להגיש: אנגלית, פיזיקה (מעבדה)');
    expect(evening.body).toContain('פיזיקה (מעבדה): תרגיל 3');
    expect(evening.body).toContain('מחר מבחן בפיזיקה (מעבדה)');
    // The homework behind a task, as the evening names it.
    expect(linkedHomework(src).get('hw-block')).toMatchObject({ subject: 'פיזיקה (מעבדה)', originalSubject: "גוש ב'", text: 'תרגיל 3' });
  });

  it("an exam's own name is still said whole in the summaries", () => {
    const kv = memoryKv();
    setExamName(kv, BLOCK_EXAM, 'בוחן פתע', "מבחן גוש ב'");
    const [day] = buildLocalDays(sources({ examPrefs: readExamPrefs(kv) }), [DAY]);
    expect(composeMorningSummary(day!).body).toContain('מבחן היום: בוחן פתע');
    expect(composeEveningReminder(day!)!.body).toContain('מחר: בוחן פתע');
  });

  it('on the widget', () => {
    const days = buildLocalDays(src, [DAY, NEXT]);
    const feed = buildWidgetFeed({ day: days[0]!, days, zone: ZONE, now: NOW, openTasks: [], upcomingExams: [] });
    expect(lessonTitle(feed.lessons[0]!)).toBe('פיזיקה (מעבדה)');
    const homework = feed.homeworkDue.find((h) => h.key === 'hw-block')!;
    expect(homework).toMatchObject({ subject: 'פיזיקה (מעבדה)', originalSubject: "גוש ב'" });
    expect(homeworkLine(homework)).toBe('פיזיקה (מעבדה): תרגיל 3');
    expect(homeworkFocus(feed, '07:00')?.subjects).toContain('פיזיקה (מעבדה)');
  });

  describe("the widget's exam line, for an exam named by its subject's name", () => {
    // A bagrut exam from Mashov: a long title, of which the name replaces the subject's word.
    const bagrut: Exam = { naturalKey: 'bagrut|english', date: NEXT, subject: 'בגרות אנגלית ז - G (הערכה חלופית)', details: null, source: 'mashov', kind: 'bagrut' };
    const feedOf = (exams: Exam[]) => {
      const days = buildLocalDays(sources({ feed: WEEK, settings: settings() }), [DAY, NEXT]);
      return buildWidgetFeed({ day: days[0]!, days, zone: ZONE, now: NOW, openTasks: [], upcomingExams: exams });
    };
    const named = (name: string) => namedExam(bagrut, nameContext({ [subjectNameKey('אנגלית')]: name }, [], []));

    it('says "מבחן" and the subject\'s name, as the week grid does', () => {
      const exam = named('English');
      expect(exam).toMatchObject({ subject: 'בגרות English ז - G (הערכה חלופית)', subjectName: 'English' });
      const feed = feedOf([exam]);
      expect(feed.nextExam).toEqual({ subject: exam.subject, date: NEXT, daysAway: 1, subjectName: 'English' });
      expect(nextExamLine(feed.nextExam!)).toBe('מבחן English, מחר');
      expect(examRow(feed.nextExam!)).toBe('English, מבחן מחר');
      expect(nextExamLine({ ...feed.nextExam!, subjectName: 'פיזיקה (מעבדה)', daysAway: 3 })).toBe('מבחן פיזיקה (מעבדה), עוד 3 ימים');
    });

    it('cuts a long name only where a name of the student\'s own is cut', () => {
      const long = 'אנגלית לבגרות של חמש יחידות';
      const line = nextExamLine(feedOf([named(long)]).nextExam!);
      expect(line).toBe(`מבחן ${long.slice(0, OWN_EXAM_NAME_MAX - 1).trimEnd()}…, מחר`);
    });

    it("an exam's own name keeps the line it had, and without names nothing changes", () => {
      const own = renamedExam(named('English'), { renames: { [bagrut.naturalKey]: 'בוחן פתע' }, calendarSkip: [], dates: {} });
      const ownFeed = feedOf([own]);
      expect(ownFeed.nextExam).toEqual({ subject: 'בוחן פתע', date: NEXT, daysAway: 1, named: true });
      expect(nextExamLine(ownFeed.nextExam!)).toBe('בוחן פתע, מחר');
      const plain = feedOf([bagrut]).nextExam!;
      expect(plain).toEqual({ subject: bagrut.subject, date: NEXT, daysAway: 1 });
      expect(nextExamLine(plain)).toBe('מבחן אנג׳, מחר');
    });
  });

  it("but what goes to the class's group is in the school's names", () => {
    const [day] = buildLocalDays(src, [DAY]);
    const ctx = { className: 'יב2', link: 'https://sederyom.site/join' };
    const changes = changesShareText([{ ...dayLessons(day!)[0]!, status: 'cancelled' }], DAY, ctx);
    expect(changes).toContain('גוש ב׳: בוטל');
    expect(changes).not.toContain('פיזיקה');
    const exams = examsShareText(day!.examsToday, DAY, ctx)!;
    expect(exams).toContain("מבחן גוש ב'");
    expect(exams).not.toContain('פיזיקה');
  });
});

/** The class's lines as a student with a merged row and two teachers of one block has them. */
const ROWS: SubjectOption[] = [
  ...SUBJECTS,
  { key: 'אזרחות', name: 'אזרחות', teacher: 'לוי רחל', inMashov: true, count: 3 },
  { key: 'אזרחות (יב2)', name: 'אזרחות (יב2)', teacher: 'לוי רחל', inMashov: false, count: 1 },
  { key: "גוש ב' (יב) @ אלון דני", name: "גוש ב' (יב)", teacher: 'אלון דני', inMashov: false, count: 2 },
];

const siteLesson = (subject: string, teacher: string | null, extra: Partial<Lesson> = {}) => ({ subject, teacher, ...extra });

describe('a lesson\'s name is saved under the row of "השיעורים שלי" it is in (Task 8)', () => {
  it('a site lesson in a merged row: all the row\'s keys, and the places a name could also come from', () => {
    const target = lessonNameTarget(siteLesson('אזרחות', 'לוי רחל'), ROWS);
    expect(target.keys).toEqual(['אזרחות', 'אזרחות (יב2)']);
    expect(target.clear).toEqual(['אזרחות', 'אזרחות (יב2)', 'subject:אזרחות']);
  });

  it('is found by the source\'s name, not the name the student gave it', () => {
    const named = siteLesson('חשבון אזרחי', 'לוי רחל', { originalSubject: 'אזרחות (יב2)' });
    expect(lessonNameTarget(named, ROWS).keys).toEqual(['אזרחות', 'אזרחות (יב2)']);
  });

  it('a block\'s lesson also clears the block\'s name', () => {
    const target = lessonNameTarget(siteLesson("גוש ב' (יב)", 'כהן דנה'), SUBJECTS);
    expect(target.keys).toEqual(["גוש ב' (יב)"]);
    expect(target.clear).toEqual(["גוש ב' (יב)", 'block:ב', subjectNameKey("גוש ב' (יב)")]);
  });

  it('a lesson of Mashov\'s grid, which no line of the site holds: the subject\'s key', () => {
    const target = lessonNameTarget(siteLesson('היסטוריה', 'כהן יעל', { source: 'mashov' }), SUBJECTS);
    expect(target.keys).toEqual(['subject:היסטוריה']);
    expect(target.keys[0]).toMatch(/^subject:/);
    expect(target.clear).toEqual(target.keys);
  });

  it('a Mashov lesson renamed: the subject\'s key of the source\'s name', () => {
    const named = siteLesson('Hist', 'כהן יעל', { source: 'mashov', originalSubject: 'היסטוריה' });
    expect(lessonNameTarget(named, SUBJECTS).keys).toEqual(['subject:היסטוריה']);
  });
});

describe('an exam\'s name is saved under the rows its title reads (Task 8)', () => {
  it('a block exam with a kept line of that block: that row\'s keys, and the block\'s label', () => {
    const target = examNameTarget("מבחן גוש ב'", SUBJECTS, []);
    expect(target).toEqual({
      label: 'לשנות את השם של גוש ב׳',
      keys: ["גוש ב' (יב)"],
      clear: ["גוש ב' (יב)", 'block:ב'],
    });
  });

  it('reads a block written with the geresh, and the site\'s line "גוש ב׳ (יב)"', () => {
    const lines: SubjectOption[] = [{ key: 'גוש ב׳ (יב)', name: 'גוש ב׳ (יב)', teacher: 'כהן דנה', inMashov: false, count: 4 }];
    expect(examNameTarget('מבחן גוש ב׳', lines, [])).toMatchObject({ label: 'לשנות את השם של גוש ב׳', keys: ['גוש ב׳ (יב)'] });
  });

  it('every row of the block gives its keys', () => {
    // The rows come in the order "השיעורים שלי" lists them (by teacher): the keys are the same set.
    const keys = examNameTarget("מבחן גוש ב'", ROWS, [])?.keys;
    expect(keys).toHaveLength(2);
    expect(keys).toEqual(expect.arrayContaining(["גוש ב' (יב)", "גוש ב' (יב) @ אלון דני"]));
  });

  it('a block with no kept line: the block\'s key alone, also when its line is hidden', () => {
    expect(examNameTarget('מבחן גוש א', SUBJECTS, [])).toEqual({
      label: 'לשנות את השם של גוש א׳',
      keys: ['block:א'],
      clear: ['block:א'],
    });
    expect(examNameTarget("מבחן גוש ב'", SUBJECTS, ["גוש ב' (יב)"])).toMatchObject({ keys: ['block:ב'] });
  });

  it('a subject: the rows of the kept lines it matches', () => {
    const target = examNameTarget('מבחן באנגלית', SUBJECTS, []);
    expect(target).toEqual({ label: 'לשנות את שם המקצוע', keys: ['אנגלית'], clear: ['אנגלית', 'subject:אנגלית'] });
  });

  it('a subject in a merged row gives all the row\'s keys', () => {
    expect(examNameTarget('מבחן באזרחות', ROWS, [])?.keys).toEqual(['אזרחות', 'אזרחות (יב2)']);
  });

  it('a subject with no kept line: the subject\'s key alone', () => {
    const target = examNameTarget('מבחן באנגלית', SUBJECTS, ['אנגלית']);
    expect(target).toEqual({ label: 'לשנות את שם המקצוע', keys: ['subject:אנגלית'], clear: ['subject:אנגלית'] });
    expect(examNameTarget('מבחן בהיסטוריה', SUBJECTS, [])?.keys).toEqual(['subject:היסטוריה']);
  });

  it('a title that reads neither a block nor a subject has no target', () => {
    expect(examNameTarget('תאריך הגשה', SUBJECTS, [])).toBeNull();
  });

  describe('a title that reads a subject and a block: by its subject, as the lists name it', () => {
    const option = (name: string, teacher: string): SubjectOption => ({ key: name, name, teacher, inMashov: false, count: 2 });
    const BLOCK_ROWS = [option('כימיה- גוש ב', 'לוי'), option('פיזיקה- גוש ב', 'כהן'), option('ביולוגיה- גוש ב', 'בר')];
    const HIDDEN = ['כימיה- גוש ב', 'ביולוגיה- גוש ב'];

    it('the subject\'s target, never the rows of the block\'s other line', () => {
      expect(examNameTarget('כימיה- גוש ב', BLOCK_ROWS, HIDDEN)).toEqual({
        label: 'לשנות את שם המקצוע', keys: ['subject:כימיה'], clear: ['subject:כימיה'],
      });
      expect(examNameTarget('מבחן גוש ב׳ - ביולוגיה', BLOCK_ROWS, HIDDEN)).toMatchObject({ label: 'לשנות את שם המקצוע', keys: ['subject:ביולוגיה'] });
      // With its line kept, that line's row.
      expect(examNameTarget('כימיה- גוש ב', BLOCK_ROWS, ['ביולוגיה- גוש ב'])).toMatchObject({ keys: ['כימיה- גוש ב'] });
      // A title that reads no subject is still the block's.
      expect(examNameTarget('מבחן גוש ב', BLOCK_ROWS, HIDDEN)).toMatchObject({ label: 'לשנות את השם של גוש ב׳', keys: ['פיזיקה- גוש ב'] });
    });

    it('the words a name replaces are the subject\'s', () => {
      expect(examNameOriginals('כימיה- גוש ב', BLOCK_ROWS, HIDDEN)).toEqual(['כימיה']);
      expect(examNameOriginals('מבחן בכימיה גוש ב', BLOCK_ROWS, HIDDEN)).toEqual(['כימיה']);
    });

    it('a name saved from the target is the name the exam shows', () => {
      const exam: Exam = { naturalKey: 'site-exam|chem', date: DAY, subject: 'כימיה- גוש ב', details: null, source: 'school_site' };
      const kept = ['ביולוגיה- גוש ב'];
      const target = examNameTarget(exam.subject, BLOCK_ROWS, kept)!;
      const originals = examNameOriginals(exam.subject, BLOCK_ROWS, kept);
      const names = withSubjectName({ 'פיזיקה- גוש ב': 'פיזיקה שלי' }, target.keys, nameOfDraft('כימיה שלי', originals), originals);
      expect(examWithNames(exam, names, BLOCK_ROWS, kept)).toMatchObject({ subject: 'כימיה שלי- גוש ב', subjectName: 'כימיה שלי' });
      // The physics row is left alone.
      expect(names['פיזיקה- גוש ב']).toBe('פיזיקה שלי');
    });
  });
});

describe('a row of "השיעורים שלי" is named, and a sheet shows the name at once (Task 9)', () => {
  const rows = groupLessonOptions(ROWS);
  const civics = rows.find((row) => row.keys.includes('אזרחות'))!;
  // The block of one teacher; the other teacher's is a row of its own.
  const block = rows.find((row) => row.keys.includes("גוש ב' (יב)"))!;
  const otherBlock = rows.find((row) => row.keys.includes("גוש ב' (יב) @ אלון דני"))!;
  const english = rows.find((row) => row.keys.includes('אנגלית'))!;

  it('a row is saved under all its lines, and its original names mean no name', () => {
    const target = groupNameTarget(civics);
    expect(target.keys).toEqual(['אזרחות', 'אזרחות (יב2)']);
    expect(target.originals).toEqual(['אזרחות', 'אזרחות (יב2)']);
    expect(target.clear.slice(0, 2)).toEqual(target.keys);
    expect(target.clear).toContain(subjectNameKey('אזרחות'));
  });

  it('a block\'s row also clears the block\'s name', () => {
    const target = groupNameTarget(block);
    expect(target.keys).toEqual(["גוש ב' (יב)"]);
    expect(target.clear).toEqual(["גוש ב' (יב)", blockNameKey('ב'), subjectNameKey("גוש ב' (יב)")]);
  });

  it('a row has no name until a line of it, its block or its subject is named', () => {
    expect(groupOwnName(civics, undefined)).toBeNull();
    expect(groupOwnName(civics, {})).toBeNull();
    expect(groupOwnName(english, { אזרחות: 'חשבון אזרחי' })).toBeNull();
  });

  it('is found under any line of the row, the first one winning', () => {
    expect(groupOwnName(civics, { אזרחות: 'חשבון אזרחי' })).toBe('חשבון אזרחי');
    expect(groupOwnName(civics, { 'אזרחות (יב2)': 'אזרחות לבגרות' })).toBe('אזרחות לבגרות');
    expect(groupOwnName(civics, { אזרחות: 'א', 'אזרחות (יב2)': 'ב' })).toBe('א');
  });

  it('a block\'s name from an exam names the rows of that block, as the days show it', () => {
    const names = { [blockNameKey('ב')]: 'פיזיקה' };
    expect(groupOwnName(block, names)).toBe('פיזיקה');
    expect(groupOwnName(otherBlock, names)).toBe('פיזיקה');
    // And a line's own name beats it. A plain key (no teacher) is read by every teacher's line of the
    // subject, which is how the days read it too; a key with a teacher names that teacher's line alone.
    expect(groupOwnName(block, { ...names, "גוש ב' (יב)": 'מכניקה' })).toBe('מכניקה');
    expect(groupOwnName(otherBlock, { ...names, "גוש ב' (יב)": 'מכניקה' })).toBe('מכניקה');
    expect(groupOwnName(block, { ...names, "גוש ב' (יב) @ אלון דני": 'מכניקה' })).toBe('פיזיקה');
    expect(groupOwnName(otherBlock, { ...names, "גוש ב' (יב) @ אלון דני": 'מכניקה' })).toBe('מכניקה');
  });

  it('naming a row and emptying it round-trip through the saved map', () => {
    const target = groupNameTarget(civics);
    const named = withSubjectName({}, target.keys, nameOfDraft(' חשבון   אזרחי ', target.originals), target.originals);
    expect(named).toEqual({ אזרחות: 'חשבון אזרחי', 'אזרחות (יב2)': 'חשבון אזרחי' });
    expect(groupOwnName(civics, named)).toBe('חשבון אזרחי');
    expect(withSubjectName(named, target.clear, nameOfDraft('', target.originals), target.originals)).toEqual({});
  });

  it('emptying a block row also removes the block\'s name that was naming it', () => {
    const target = groupNameTarget(block);
    const names = { [blockNameKey('ב')]: 'פיזיקה', "גוש ב' (יב)": 'מכניקה' };
    expect(withSubjectName(names, target.clear, null, target.originals)).toEqual({});
  });

  describe('what a typed name stands for', () => {
    const originals = ["גוש ב' (יב)", 'גוש ב׳'];

    it('is cleaned the way it is saved', () => {
      expect(nameOfDraft('  פיזיקה   מכניקה ', originals)).toBe('פיזיקה מכניקה');
      expect(nameOfDraft('x'.repeat(60), originals)).toBe('x'.repeat(40));
    });

    it('is no name when empty, or the school\'s own, under either spelling', () => {
      expect(nameOfDraft('', originals)).toBeNull();
      expect(nameOfDraft('   ', originals)).toBeNull();
      expect(nameOfDraft(' גוש ב׳ ', originals)).toBeNull();
      expect(nameOfDraft("גוש ב' (יב)", originals)).toBeNull();
    });
  });

  describe('a lesson under a name just given', () => {
    const base = {
      date: DAY, hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: BLOCK, teacher: 'כהן דנה',
      room: null, status: 'regular', substitute: null, note: null, source: 'shahaf',
    } as unknown as Lesson;

    it('keeps the site\'s name and shows the new one', () => {
      expect(lessonWithName(base, 'פיזיקה')).toEqual({ ...base, subject: 'פיזיקה', originalSubject: BLOCK });
    });

    it('a second name still keeps the site\'s name, not the first name', () => {
      const first = lessonWithName(base, 'פיזיקה');
      expect(lessonWithName(first, 'מכניקה')).toEqual({ ...base, subject: 'מכניקה', originalSubject: BLOCK });
    });

    it('no name gives the site\'s back and leaves no original behind', () => {
      const back = lessonWithName(lessonWithName(base, 'פיזיקה'), null);
      expect(back).toEqual(base);
      expect('originalSubject' in back).toBe(false);
    });

    it('leaves the lesson it was given alone', () => {
      lessonWithName(base, 'פיזיקה');
      expect(base.subject).toBe(BLOCK);
      expect(base.originalSubject).toBeUndefined();
    });
  });
});

describe('an open exam sheet shows the exam as the lists do (Task 10)', () => {
  const plain: Exam = { naturalKey: BLOCK_EXAM, date: DAY, subject: "מבחן גוש ב'", details: null, source: 'school_site' };
  const named: Exam = { ...plain, subject: 'מבחן פיזיקה', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה' };

  it('is the exam the lists build, under the same names', () => {
    const listed = localExamsFrom(sources(), DAY, DAY).find((e) => e.naturalKey === BLOCK_EXAM);
    expect(examWithNames(plain, NAMES, SUBJECTS, [])).toEqual(listed);
    expect(examWithNames(plain, NAMES, SUBJECTS, [])).toEqual(named);
  });

  it('leaves the exam it was given alone', () => {
    examWithNames(plain, NAMES, SUBJECTS, []);
    expect(plain).toEqual({ naturalKey: BLOCK_EXAM, date: DAY, subject: "מבחן גוש ב'", details: null, source: 'school_site' });
  });

  it('takes a name off: the school\'s title is back, with no original left behind', () => {
    const back = examWithNames(named, {}, SUBJECTS, []);
    expect(back).toEqual(plain);
    expect('originalSubject' in back).toBe(false);
    expect('subjectName' in back).toBe(false);
  });

  it('a second name goes onto the school\'s title, not onto the first name', () => {
    expect(examWithNames(named, { "גוש ב' (יב)": 'מכניקה' }, SUBJECTS, [])).toEqual({
      ...plain, subject: 'מבחן מכניקה', originalSubject: "מבחן גוש ב'", subjectName: 'מכניקה',
    });
  });

  it('a name no kept line holds does not apply: a hidden line is not read, as in the lists', () => {
    expect(examWithNames(plain, NAMES, SUBJECTS, ["גוש ב' (יב)"])).toEqual(plain);
    expect(examWithNames(plain, { [blockNameKey('ב')]: 'פיזיקה' }, SUBJECTS, ["גוש ב' (יב)"])).toEqual(named);
  });

  it('an exam with a name of its own: the subject\'s name is found beneath it, and comes back when the exam\'s own goes', () => {
    const prefs = { renames: { [BLOCK_EXAM]: 'בוחן פתע' }, calendarSkip: [], dates: {} };
    const own = renamedExam(named, prefs);
    expect(own.subjectName).toBeUndefined();
    const under = examWithNames(own, NAMES, SUBJECTS, []);
    expect(under).toEqual(named);
    // What the sheet shows: the exam's own name over it and then, with that name cleared, the subject's.
    expect(renamedExam(under, prefs)).toEqual(own);
    expect(renamedExam(under, NO_EXAM_PREFS)).toBe(under);
  });

  it('an exam from Mashov is named whole, as its grades are', () => {
    const mashov: Exam = { naturalKey: 'mashov-exam|english', date: DAY, subject: 'אנגלית 5 יח"ל', details: null, source: 'mashov' };
    expect(examWithNames(mashov, { אנגלית: 'English' }, SUBJECTS, [])).toEqual({
      ...mashov, subject: 'English', originalSubject: 'אנגלית 5 יח"ל', subjectName: 'English',
    });
  });

  it('keeps what else an exam of the list carries', () => {
    const option = { ...plain, hidden: false, subjectKey: 'גוש ב', match: { mine: true, reason: null } };
    expect(examWithNames(option, NAMES, SUBJECTS, [])).toEqual({ ...option, subject: 'מבחן פיזיקה', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה' });
  });
});

describe('the words of an exam\'s title a name for its subject replaces (Task 10)', () => {
  it('a block: spelled the way the label does, and the way the title writes it', () => {
    expect(examNameOriginals("מבחן גוש ב'", SUBJECTS, [])).toEqual(['גוש ב׳', "גוש ב'"]);
    // Tokens read the geresh as the apostrophe: the same two spellings.
    expect(examNameOriginals('מבחן בגוש ב׳', SUBJECTS, [])).toEqual(['גוש ב׳', "בגוש ב'"]);
    // A block with no letter has no name to give.
    expect(examNameOriginals('מבחן גוש', SUBJECTS, [])).toEqual([]);
  });

  it('a subject: as the title reads it', () => {
    expect(examNameOriginals('מבחן באנגלית', SUBJECTS, [])).toEqual(['אנגלית']);
  });

  it('a title that reads neither has none', () => {
    expect(examNameOriginals('תאריך הגשה', SUBJECTS, [])).toEqual([]);
  });

  it('an exam from Mashov\'s own list is a subject, not a title: its whole name is what a name replaces', () => {
    const mashov: Exam = { naturalKey: 'mashov-exam|english', date: DAY, subject: 'אנגלית 5 יח"ל', details: null, source: 'mashov' };
    expect(examTitleIsSubject(mashov)).toBe(true);
    // Bagrut and exams added by hand are titles, whatever their source says.
    expect(examTitleIsSubject({ ...mashov, kind: 'bagrut' })).toBe(false);
    expect(examTitleIsSubject({ ...mashov, kind: 'manual' })).toBe(false);
    expect(examTitleIsSubject({ ...mashov, source: 'school_site' })).toBe(false);

    const originals = examNameOriginals(mashov.subject, SUBJECTS, [], true);
    expect(originals).toEqual(['אנגלית 5 יח"ל', 'אנגלית']);
    // Typed back whole, or as the subject, it is no name; the exam is named whole, as it is listed.
    expect(nameOfDraft(' אנגלית 5 יח"ל ', originals)).toBeNull();
    expect(nameOfDraft('אנגלית', originals)).toBeNull();
    expect(examWithNames(mashov, { אנגלית: 'English' }, SUBJECTS, [])).toMatchObject({ subject: 'English', subjectName: 'English' });
  });

  describe('an exam from Mashov\'s own list is renamed under the key the lists name it by: its whole subject', () => {
    // A school without a Shahaf site: no lines, and Mashov's subject carries its level and group.
    const SUBJECT = 'מתמטיקה 5 יח"ל - הקבצה א';
    const exam: Exam = { naturalKey: 'mashov-exam|math', date: DAY, subject: SUBJECT, details: null, source: 'mashov' };
    const whole = examTitleIsSubject(exam);

    it('saved from the exam sheet, the lists and the sheet show it; restored, it is gone', () => {
      const target = examNameTarget(SUBJECT, [], [], whole)!;
      expect(target).toEqual({
        label: 'לשנות את שם המקצוע',
        keys: [subjectNameKey(SUBJECT)],
        clear: [subjectNameKey(SUBJECT), subjectNameKey('מתמטיקה')],
      });
      const originals = examNameOriginals(SUBJECT, [], [], whole);
      const names = withSubjectName({}, target.keys, nameOfDraft('מתמטיקה שלי', originals), originals);
      expect(namedExam(exam, nameContext(names, [], []))).toEqual({ ...exam, subject: 'מתמטיקה שלי', originalSubject: SUBJECT, subjectName: 'מתמטיקה שלי' });
      expect(examWithNames(exam, names, [], [])).toMatchObject({ subject: 'מתמטיקה שלי', subjectName: 'מתמטיקה שלי' });
      const restored = withSubjectName(names, target.clear, null, originals);
      expect(restored).toEqual({});
      expect(examWithNames(exam, restored, [], [])).toEqual(exam);
    });

    it('a name given from a lesson of Mashov\'s grid shows on the exam, and the exam sheet takes it away', () => {
      const fromLesson = lessonNameTarget(siteLesson(SUBJECT, 'כהן יעל', { source: 'mashov' }), []);
      const names = withSubjectName({}, fromLesson.keys, 'מתמטיקה שלי', [SUBJECT]);
      expect(examWithNames(exam, names, [], [])).toMatchObject({ subject: 'מתמטיקה שלי', subjectName: 'מתמטיקה שלי' });
      const target = examNameTarget(SUBJECT, [], [], whole)!;
      expect(withSubjectName(names, target.clear, null, [])).toEqual({});
      // And one saved under the subject the title reads, the key the sheet wrote before.
      expect(withSubjectName({ [subjectNameKey('מתמטיקה')]: 'מתמטיקה שלי' }, target.clear, null, [])).toEqual({});
    });

    it('a kept line that matches the whole subject gives its row, as the lists read it', () => {
      const lines: SubjectOption[] = [{ key: 'מתמטיקה 5 יח"ל (יב2)', name: 'מתמטיקה 5 יח"ל (יב2)', teacher: 'לוי', inMashov: true, count: 5 }];
      const target = examNameTarget(SUBJECT, lines, [], whole)!;
      expect(target.keys).toEqual(['מתמטיקה 5 יח"ל (יב2)']);
      const names = withSubjectName({}, target.keys, 'מתמטיקה שלי', []);
      expect(examWithNames(exam, names, lines, [])).toMatchObject({ subject: 'מתמטיקה שלי' });
    });

    it('a subject from Mashov that reads as a block is still named the way Mashov\'s items are', () => {
      const block: Exam = { ...exam, naturalKey: 'mashov-exam|block', subject: "גוש ב'" };
      // Its line hidden: Mashov's rule reads the subject's key, never the block's.
      const target = examNameTarget(block.subject, SUBJECTS, ["גוש ב' (יב)"], true)!;
      expect(target).toMatchObject({ label: 'לשנות את שם המקצוע', keys: [subjectNameKey("גוש ב'")] });
      const names = withSubjectName({}, target.keys, 'פיזיקה', []);
      expect(examWithNames(block, names, SUBJECTS, ["גוש ב' (יב)"])).toMatchObject({ subject: 'פיזיקה', subjectName: 'פיזיקה' });
    });
  });

  it('typing them back is no name: the keys are cleared, not written', () => {
    const originals = examNameOriginals('מבחן באנגלית', SUBJECTS, []);
    const target = examNameTarget('מבחן באנגלית', SUBJECTS, [])!;
    const saved = withSubjectName({}, target.keys, nameOfDraft('English', originals), originals);
    expect(saved).toEqual({ אנגלית: 'English' });
    expect(withSubjectName(saved, target.clear, nameOfDraft(' אנגלית ', originals), originals)).toEqual({});
    const blockTarget = examNameTarget("מבחן גוש ב'", SUBJECTS, [])!;
    const blockOriginals = examNameOriginals("מבחן גוש ב'", SUBJECTS, []);
    const blockSaved = withSubjectName({}, blockTarget.keys, nameOfDraft('פיזיקה', blockOriginals), blockOriginals);
    expect(withSubjectName(blockSaved, blockTarget.clear, nameOfDraft('גוש ב׳', blockOriginals), blockOriginals)).toEqual({});
  });
});
