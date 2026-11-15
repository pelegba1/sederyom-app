/**
 * An exam renamed, or kept out of the Google calendar, on the phone
 * (app/src/local/examPrefs.ts): the store, the exams the phone builds under
 * the student's names (days, "המבחנים שלי", the summaries), matching still
 * by the source's name, and the phone's "בית ספר" calendar leaving out the
 * exams the student keeps out of it.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ClassFeed, Exam } from '@sederyom/shared';
import { DEFAULT_CHAT_SHARES, DEFAULT_SETTINGS } from '@sederyom/shared';
import { buildWidgetFeed } from '@sederyom/shared/logic/build';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { filterExams } from '@sederyom/shared/logic/filters';
import { bagrutKey } from '@sederyom/shared/logic/mashov/bagrut';
import { examOptions } from '@sederyom/shared/logic/options';
import { addDays } from '@sederyom/shared/logic/time';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { planMorningSummary } from '@sederyom/shared/logic/summaries';
import { withSchoolDates } from '../../app/src/buddies/days';
import { buildChatSnapshot } from '../../app/src/chat/snapshot';
import { markMirrorDue, mirrorState, runPhoneMirror } from '../../app/src/google/mirror';
import { examNaming } from '../../app/src/lib/bagrut';
import { CATALOG } from '../../app/src/lib/bagrutCatalog';
import { examGroupKey, studyTask } from '../../app/src/lib/school';
import { examStrip } from '../../app/src/lib/today';
import { buildLocalDays, examOptionsAsPublished, listedExamKeys, localExamsFrom, type LocalSources } from '../../app/src/local/days';
import {
  EXAM_NAME_MAX, EXAM_PREFS_KEY, FEED_EXAM_PAST_DAYS, NO_EXAM_PREFS, dropKeptCopies, examSourcesRead, forgetAbsentCopies, isDeadExamDate, isExamInCalendar, isFeedObserved,
  keptExams, movedExam, nameToKeep, ownBoardObserved, ownExam, ownExams, pruneExamDates, readExamPrefs, renamedExam, setExamDate, setExamInCalendar, setExamName,
  type ExamPrefs, type ExamSourcesRead,
} from '../../app/src/local/examPrefs';
import { withOwnBoard, type OwnBoard } from '../../app/src/local/ownBoard';
import { addManualExam, readManualExams } from '../../app/src/local/manualExams';
import { examWithNames } from '../../app/src/local/subjectNames';
import { examRow, nextExamLine, OWN_EXAM_NAME_MAX } from '../../app/src/widget/model';

const ZONE = 'Asia/Jerusalem';
// Wednesday 21.10.2026.
const NOW = new Date('2026-10-21T08:00:00Z');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });
afterAll(() => {
  vi.useRealTimers();
});

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const FEED: ClassFeed = {
  class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יב2' },
  lastOkAt: NOW.toISOString(),
  freshness: null,
  lessons: [],
  changes: [],
  exams: [
    { naturalKey: 'site-exam|english', date: '2026-10-21', subject: 'מבחן באנגלית', details: null, source: 'school_site' },
    { naturalKey: 'site-exam|mock', date: '2026-11-01', subject: 'מתכונת בהיסטוריה', details: null, source: 'school_site' },
    { naturalKey: 'site-exam|physics', date: '2026-11-03', subject: 'מבחן בפיזיקה', details: null, source: 'school_site' },
  ],
  events: [{ naturalKey: 'shahaf-event|trip', date: '2026-10-30', title: 'טיול שנתי', details: null }],
  messages: [],
};

const RENAMED: ExamPrefs = { renames: { 'site-exam|english': 'בוחן פתע, יחידה 3' }, calendarSkip: [], dates: {} };

/** Prefs holding the student's dates: `[key, the student's date, the source's date when they chose it]`. */
const dated = (...entries: [key: string, date: string, sourceDate: string][]): ExamPrefs => ({
  ...NO_EXAM_PREFS, dates: Object.fromEntries(entries.map(([key, date, sourceDate]) => [key, { date, sourceDate }])),
});

function sources(over: Partial<LocalSources> = {}): LocalSources {
  return {
    feed: FEED, mashov: [], bagrut: [], google: [], settings: { ...DEFAULT_SETTINGS, examsToCalendar: true }, zone: ZONE, now: NOW, ...over,
  };
}

describe('the store', () => {
  it('keeps a name, trimmed and on one line, and an empty one (or the source\'s own) clears it', () => {
    const kv = memoryKv();
    expect(readExamPrefs(kv)).toEqual({ renames: {}, calendarSkip: [], dates: {} });

    setExamName(kv, 'site-exam|english', '  בוחן   פתע\n יחידה 3 ', 'מבחן באנגלית');
    expect(readExamPrefs(kv).renames).toEqual({ 'site-exam|english': 'בוחן פתע יחידה 3' });

    setExamName(kv, 'site-exam|physics', 'חזרה לפיזיקה');
    expect(Object.keys(readExamPrefs(kv).renames).sort()).toEqual(['site-exam|english', 'site-exam|physics']);

    // Empty, blank or null: the source's name again.
    setExamName(kv, 'site-exam|english', '   ', 'מבחן באנגלית');
    setExamName(kv, 'site-exam|physics', null);
    expect(readExamPrefs(kv).renames).toEqual({});

    // The source's own name, typed back: nothing to keep.
    setExamName(kv, 'site-exam|english', ' מבחן באנגלית ', 'מבחן באנגלית');
    expect(readExamPrefs(kv).renames).toEqual({});

    // A title line, not a note.
    setExamName(kv, 'site-exam|english', 'א'.repeat(200));
    expect(readExamPrefs(kv).renames['site-exam|english']).toHaveLength(EXAM_NAME_MAX);
  });

  it('toggles an exam out of the Google calendar and back, once each', () => {
    const kv = memoryKv();
    expect(isExamInCalendar(readExamPrefs(kv), 'site-exam|mock')).toBe(true);
    setExamInCalendar(kv, 'site-exam|mock', false);
    setExamInCalendar(kv, 'site-exam|mock', false);
    expect(readExamPrefs(kv).calendarSkip).toEqual(['site-exam|mock']);
    expect(isExamInCalendar(readExamPrefs(kv), 'site-exam|mock')).toBe(false);
    expect(isExamInCalendar(readExamPrefs(kv), 'site-exam|physics')).toBe(true);
    setExamInCalendar(kv, 'site-exam|mock', true);
    expect(readExamPrefs(kv).calendarSkip).toEqual([]);
    // The names and the calendar choices live side by side.
    setExamName(kv, 'site-exam|mock', 'מתכונת');
    setExamInCalendar(kv, 'site-exam|mock', false);
    expect(readExamPrefs(kv)).toEqual({ renames: { 'site-exam|mock': 'מתכונת' }, calendarSkip: ['site-exam|mock'], dates: {} });
  });

  it('reads a damaged store as empty, and skips what is not a name', () => {
    const kv = memoryKv();
    kv.set(EXAM_PREFS_KEY, '{not json');
    expect(readExamPrefs(kv)).toEqual({ renames: {}, calendarSkip: [], dates: {} });
    kv.set(EXAM_PREFS_KEY, JSON.stringify({ renames: { a: 'שם', b: 7, c: '  ' }, calendarSkip: ['x', 3] }));
    expect(readExamPrefs(kv)).toEqual({ renames: { a: 'שם' }, calendarSkip: ['x'], dates: {} });
  });

  it('keeps from the sheet only a name of the student\'s own: not the original under either spelling', () => {
    // A bagrut exam the table names: Mashov's "אנגלית", titled "בגרות באנגלית, מודול G".
    const originals = ['אנגלית', 'בגרות באנגלית, מודול G'];
    expect(nameToKeep('  מודול G   שלי ', originals)).toBe('מודול G שלי');
    // Saved as prefilled, or typed back: the source's name, not a rename.
    expect(nameToKeep('בגרות באנגלית, מודול G', originals)).toBeNull();
    expect(nameToKeep(' אנגלית', originals)).toBeNull();
    expect(nameToKeep('   ', originals)).toBeNull();
    // A block exam: the site's "גוש ב'", titled "מבחן גוש ב׳".
    expect(nameToKeep('מבחן גוש ב׳', ["גוש ב'", 'מבחן גוש ב׳'])).toBeNull();
  });

  it('renames an exam, keeps the source\'s name, and gives it back when the name is gone', () => {
    const exam: Exam = { naturalKey: 'site-exam|english', date: '2026-10-21', subject: 'מבחן באנגלית', details: null, source: 'school_site' };
    const renamed = renamedExam(exam, RENAMED);
    expect(renamed).toEqual({ ...exam, subject: 'בוחן פתע, יחידה 3', originalSubject: 'מבחן באנגלית' });
    // Twice is once; another exam is left as it is.
    expect(renamedExam(renamed, RENAMED)).toEqual(renamed);
    expect(renamedExam({ ...exam, naturalKey: 'other' }, RENAMED)).toEqual({ ...exam, naturalKey: 'other' });
    // The name cleared: the source's name back, and no trace of the rename.
    const back = renamedExam(renamed, { renames: {}, calendarSkip: [], dates: {} });
    expect(back).toEqual(exam);
    expect('originalSubject' in back).toBe(false);
  });
});

describe('a date of the student\'s own', () => {
  const KEY = 'site-exam|english';
  const english: Exam = { naturalKey: KEY, date: '2026-11-09', subject: 'מבחן באנגלית', details: null, source: 'school_site' };
  const MOVED: ExamPrefs = { ...NO_EXAM_PREFS, dates: { [KEY]: { date: '2026-11-12', sourceDate: '2026-11-09' } } };

  it('is kept with the source\'s date of that moment, and the source\'s own date (or null) clears it', () => {
    const kv = memoryKv();
    const stored = setExamDate(kv, KEY, '2026-11-12', '2026-11-09');
    expect(stored.dates).toEqual({ [KEY]: { date: '2026-11-12', sourceDate: '2026-11-09' } });
    expect(readExamPrefs(kv)).toEqual(stored);

    // Side by side with a name and a calendar choice, and another exam's date.
    setExamName(kv, KEY, 'בוחן פתע');
    setExamInCalendar(kv, 'site-exam|mock', false);
    setExamDate(kv, 'site-exam|physics', '2026-11-20', '2026-11-03');
    expect(readExamPrefs(kv)).toEqual({
      renames: { [KEY]: 'בוחן פתע' },
      calendarSkip: ['site-exam|mock'],
      dates: { [KEY]: { date: '2026-11-12', sourceDate: '2026-11-09' }, 'site-exam|physics': { date: '2026-11-20', sourceDate: '2026-11-03' } },
    });

    // Moved again: the new date, still against the source's.
    setExamDate(kv, KEY, '2026-11-13', '2026-11-09');
    expect(readExamPrefs(kv).dates[KEY]).toEqual({ date: '2026-11-13', sourceDate: '2026-11-09' });

    // Back on the source's own date, or null: nothing to keep.
    setExamDate(kv, KEY, '2026-11-09', '2026-11-09');
    expect(Object.keys(readExamPrefs(kv).dates)).toEqual(['site-exam|physics']);
    setExamDate(kv, KEY, '2026-11-12', '2026-11-09');
    setExamDate(kv, KEY, null, '2026-11-09');
    setExamDate(kv, 'site-exam|physics', null, '2026-11-03');
    expect(readExamPrefs(kv).dates).toEqual({});
  });

  it('is kept only for a real day, and never for an exam added by hand or a bagrut exam: the prefs come back as they were', () => {
    const kv = memoryKv();
    const before = setExamDate(kv, KEY, '2026-11-12', '2026-11-09');
    const writes = new Map(kv.map);
    for (const bad of ['', '12.11', '2026-11-31', '2026-13-01', '2026-02-29', '2026-1-5', ' 2026-11-12', 'זבל']) {
      expect(setExamDate(kv, KEY, bad, '2026-11-09')).toEqual(before);
      expect(setExamDate(kv, 'site-exam|other', bad, '2026-11-09')).toEqual(before);
    }
    // The source's date has to be a real day too: the change would never be known to hold.
    expect(setExamDate(kv, 'site-exam|other', '2026-11-12', '2026-02-30')).toEqual(before);
    // An exam added by hand changes its stored date instead (`setManualExamDate`).
    expect(setExamDate(kv, 'manual|abc123', '2026-11-12', '2026-11-09')).toEqual(before);
    expect(setExamDate(kv, 'manual|abc123', null, '2026-11-09')).toEqual(before);
    // A bagrut exam from Mashov's own list is the Ministry's sitting, and is not moved.
    expect(setExamDate(kv, bagrutKey(16582, '2027-01'), '2027-01-24', '2027-01-21')).toEqual(before);
    expect(setExamDate(kv, bagrutKey(16582, '2027-01'), null, '2027-01-21')).toEqual(before);
    expect(kv.map).toEqual(writes);
    // A leap day is a real one.
    expect(setExamDate(kv, 'site-exam|leap', '2028-02-29', '2028-02-27').dates['site-exam|leap']).toEqual({ date: '2028-02-29', sourceDate: '2028-02-27' });
  });

  it('reads a store without dates as none, and drops entry by entry what is not two real days', () => {
    const kv = memoryKv();
    kv.set(EXAM_PREFS_KEY, JSON.stringify({ renames: { a: 'שם' }, calendarSkip: ['x'] }));
    expect(readExamPrefs(kv)).toEqual({ renames: { a: 'שם' }, calendarSkip: ['x'], dates: {} });

    kv.set(EXAM_PREFS_KEY, JSON.stringify({ dates: { k: 'זבל' } }));
    expect(readExamPrefs(kv).dates).toEqual({});
    for (const dates of ['זבל', 7, null, ['2026-11-12'], true]) {
      kv.set(EXAM_PREFS_KEY, JSON.stringify({ renames: { a: 'שם' }, dates }));
      expect(readExamPrefs(kv)).toEqual({ renames: { a: 'שם' }, calendarSkip: [], dates: {} });
    }

    kv.set(EXAM_PREFS_KEY, JSON.stringify({
      dates: {
        good: { date: '2026-11-12', sourceDate: '2026-11-09' },
        missing: { date: '2026-11-12' },
        notDays: { date: '2026-11-31', sourceDate: '2026-11-09' },
        wrongKind: { date: 20261112, sourceDate: '2026-11-09' },
        array: ['2026-11-12', '2026-11-09'],
        nothing: null,
        text: '2026-11-12',
        extra: { date: '2026-11-13', sourceDate: '2026-11-09', note: 'x' },
      },
    }));
    expect(readExamPrefs(kv).dates).toEqual({
      good: { date: '2026-11-12', sourceDate: '2026-11-09' },
      extra: { date: '2026-11-13', sourceDate: '2026-11-09' },
    });

    kv.set(EXAM_PREFS_KEY, '{not json');
    expect(readExamPrefs(kv)).toEqual(NO_EXAM_PREFS);
  });

  it('puts the exam on the student\'s date and keeps the school\'s in originalDate', () => {
    const moved = movedExam(english, MOVED);
    expect(moved).toEqual({ ...english, date: '2026-11-12', originalDate: '2026-11-09' });
    // Another exam, or no prefs at all, is left as it is (the very object).
    expect(movedExam({ ...english, naturalKey: 'other' }, MOVED)).toEqual({ ...english, naturalKey: 'other' });
    expect(movedExam(english, undefined)).toBe(english);
    expect(movedExam(english, NO_EXAM_PREFS)).toBe(english);
  });

  it('falls when the source moves the exam: the source\'s date, no originalDate, whatever the student set', () => {
    const sourceMoved = { ...english, date: '2026-11-10' };
    const shown = movedExam(sourceMoved, MOVED);
    expect(shown).toBe(sourceMoved);
    expect('originalDate' in shown).toBe(false);
    // Moved earlier or later, or back to the student's own date: the source's word is the source's.
    expect(movedExam({ ...english, date: '2026-11-12' }, MOVED)).toEqual({ ...english, date: '2026-11-12' });
    expect('originalDate' in movedExam({ ...english, date: '2026-11-12' }, MOVED)).toBe(false);
    // And the same on a list that was moved before the source did: the old school date goes, the school's new one stays.
    const stale = movedExam(english, MOVED);
    expect(movedExam(stale, { ...MOVED, dates: { [KEY]: { date: '2026-11-12', sourceDate: '2026-11-10' } } })).toEqual(english);
  });

  it('is safe to apply twice, and gives the school\'s date back to an exam moved earlier when the student\'s is gone', () => {
    const moved = movedExam(english, MOVED);
    expect(movedExam(moved, MOVED)).toEqual(moved);
    const back = movedExam(moved, NO_EXAM_PREFS);
    expect(back).toEqual(english);
    expect('originalDate' in back).toBe(false);
    // Moved to another day later: from the school's date, not from the first move.
    const again = movedExam(moved, { ...MOVED, dates: { [KEY]: { date: '2026-11-15', sourceDate: '2026-11-09' } } });
    expect(again).toEqual({ ...english, date: '2026-11-15', originalDate: '2026-11-09' });
    // An entry on the school's own date moves nothing.
    expect(movedExam(english, { ...MOVED, dates: { [KEY]: { date: '2026-11-09', sourceDate: '2026-11-09' } } })).toBe(english);
  });

  it('never moves an exam added by hand, whatever the prefs say', () => {
    const manual: Exam = { naturalKey: 'manual|abc123', date: '2026-11-09', subject: 'ספרות', details: null, source: 'mashov', kind: 'manual' };
    const prefs: ExamPrefs = { ...NO_EXAM_PREFS, dates: { [manual.naturalKey]: { date: '2026-11-12', sourceDate: '2026-11-09' } } };
    expect(movedExam(manual, prefs)).toBe(manual);
    expect(ownExam(manual, prefs)).toBe(manual);
    // By its key, not by its kind: a bare row has none yet.
    const row = { naturalKey: manual.naturalKey, date: '2026-11-09', subject: 'ספרות', details: null, source: 'mashov' as const };
    expect(movedExam(row, prefs)).toBe(row);
  });

  it('puts a bagrut exam on the date an entry gives it, with no special case (`setExamDate` writes none for it)', () => {
    const bagrut: Exam = { naturalKey: 'bagrut|16582|2027-01', date: '2027-01-21', subject: 'אנגלית', details: null, source: 'mashov', kind: 'bagrut', startTime: '14:00', endTime: '15:45' };
    const moved = movedExam(bagrut, { ...NO_EXAM_PREFS, dates: { [bagrut.naturalKey]: { date: '2027-01-24', sourceDate: '2027-01-21' } } });
    expect(moved).toMatchObject({ date: '2027-01-24', originalDate: '2027-01-21', kind: 'bagrut', startTime: '14:00' });
  });

  it('is applied together with the name by ownExam and ownExams, the one call for both', () => {
    const prefs: ExamPrefs = { ...MOVED, renames: { [KEY]: 'בוחן פתע, יחידה 3' } };
    const own = ownExam(english, prefs);
    expect(own).toEqual({ ...english, subject: 'בוחן פתע, יחידה 3', originalSubject: 'מבחן באנגלית', date: '2026-11-12', originalDate: '2026-11-09' });
    expect(ownExam(own, prefs)).toEqual(own);
    // Only the date, only the name, neither.
    expect(ownExam(english, MOVED)).toEqual({ ...english, date: '2026-11-12', originalDate: '2026-11-09' });
    expect(ownExam(english, RENAMED)).toEqual({ ...english, subject: 'בוחן פתע, יחידה 3', originalSubject: 'מבחן באנגלית' });
    expect(ownExam(english, NO_EXAM_PREFS)).toBe(english);
    // A list already under the old prefs is taken to the new ones: the date and the name both come back.
    const cleared = ownExam(own, NO_EXAM_PREFS);
    expect(cleared).toEqual(english);
    expect('originalDate' in cleared || 'originalSubject' in cleared).toBe(false);
    const other: Exam = { ...english, naturalKey: 'site-exam|mock', date: '2026-11-01', subject: 'מתכונת בהיסטוריה' };
    expect(ownExams([english, other], prefs)).toEqual([own, other]);
    expect(ownExams([], prefs)).toEqual([]);
  });

  it('is dropped, from the store, once an exam read again says another date: and only then', () => {
    const kv = memoryKv();
    setExamDate(kv, 'k|kept', '2026-11-12', '2026-11-09');
    setExamDate(kv, 'k|moved', '2026-11-20', '2026-11-10');
    setExamDate(kv, 'k|absent', '2026-11-22', '2026-11-11');
    setExamDate(kv, 'k|moved-list', '2026-11-25', '2026-11-12');
    setExamName(kv, 'k|moved', 'שם');
    const read = (key: string, date: string, over: Partial<Exam> = {}): Exam => ({ naturalKey: key, date, subject: 'x', details: null, source: 'school_site', ...over });
    const exams = [
      read('k|kept', '2026-11-09'),
      // The source says another day: the student's is dropped for good.
      read('k|moved', '2026-11-14'),
      // A list that was already under the student's date reads by the school's (`originalDate`).
      read('k|moved-list', '2026-11-25', { originalDate: '2026-11-12' }),
      read('k|other', '2026-11-30'),
    ];
    const pruned = pruneExamDates(kv, exams, '2026-11-10');
    expect(Object.keys(pruned.dates).sort()).toEqual(['k|absent', 'k|kept', 'k|moved-list']);
    expect(readExamPrefs(kv)).toEqual(pruned);
    // The rest of the prefs are as they were.
    expect(pruned.renames).toEqual({ 'k|moved': 'שם' });
  });

  it('is not dropped for an exam a read does not list, nor from an empty list, and writes nothing when nothing goes', () => {
    const kv = memoryKv();
    setExamDate(kv, 'k|a', '2026-11-12', '2026-11-09');
    setExamDate(kv, 'k|b', '2026-11-13', '2026-11-10');
    const stored = kv.map.get(EXAM_PREFS_KEY);
    let writes = 0;
    const counting = { getString: kv.getString, set: (k: string, v: string) => { writes += 1; kv.set(k, v); } };
    expect(pruneExamDates(counting, [], '2026-11-10').dates).toEqual(readExamPrefs(kv).dates);
    expect(Object.keys(pruneExamDates(counting, [{ naturalKey: 'k|unrelated', date: '2026-11-30', subject: 'x', details: null, source: 'shahaf' }], '2026-11-10').dates)).toEqual(['k|a', 'k|b']);
    expect(pruneExamDates(counting, [{ naturalKey: 'k|a', date: '2026-11-09', subject: 'x', details: null, source: 'shahaf' }], '2026-11-10').dates['k|a']).toBeDefined();
    expect(writes).toBe(0);
    expect(kv.map.get(EXAM_PREFS_KEY)).toBe(stored);
  });

  describe('with a copy of the exam, for when the school\'s list lets it go', () => {
    const asListed: Exam = {
      naturalKey: 'site-exam|makeup', date: '2026-11-09', subject: 'מבחן בהיסטוריה', details: 'פרקים 1 עד 3', source: 'school_site',
    };
    const COPY = { subject: 'מבחן בהיסטוריה', details: 'פרקים 1 עד 3', source: 'school_site' };
    const key = asListed.naturalKey;

    it('is kept with the exam as its source gave it: its name, never the student\'s, and nothing of the date or the key', () => {
      const kv = memoryKv();
      // The exam as the sheet holds it: under the student's name and subject name, on the student's date.
      const shown: Exam = { ...asListed, subject: 'ההיסטוריה שלי', originalSubject: 'מבחן בהיסטוריה', subjectName: 'היסטוריה', date: '2026-11-30', originalDate: '2026-11-09' };
      const stored = setExamDate(kv, key, '2026-11-30', '2026-11-09', shown);
      expect(stored.dates[key]).toEqual({ date: '2026-11-30', sourceDate: '2026-11-09', kept: COPY });
      expect(readExamPrefs(kv)).toEqual(stored);
    });

    it('is kept as it was when the same move is saved without the exam, and given up with another source date or none', () => {
      const kv = memoryKv();
      setExamDate(kv, key, '2026-11-30', '2026-11-09', asListed);
      expect(setExamDate(kv, key, '2026-12-02', '2026-11-09').dates[key]).toEqual({ date: '2026-12-02', sourceDate: '2026-11-09', kept: COPY });
      // Another source date is another exam to the copy: it is not the one that was kept.
      expect(setExamDate(kv, key, '2026-12-02', '2026-11-10').dates[key]).toEqual({ date: '2026-12-02', sourceDate: '2026-11-10' });
      // And the exam again makes a new copy (`details` as the source says them now).
      const refreshed: Exam = { ...asListed, date: '2026-11-10', details: 'פרק 4' };
      expect(setExamDate(kv, key, '2026-12-02', '2026-11-10', refreshed).dates[key]!.kept).toEqual({ ...COPY, details: 'פרק 4' });
    });

    it('is read tolerantly: a copy that is not one is dropped and the date still works, as an entry from before', () => {
      const kv = memoryKv();
      const entry = { date: '2026-11-30', sourceDate: '2026-11-09' };
      const withKept = (kept: unknown) => {
        kv.set(EXAM_PREFS_KEY, JSON.stringify({ dates: { good: { ...entry, kept }, other: entry } }));
        return readExamPrefs(kv).dates;
      };
      expect(withKept(COPY).good).toEqual({ ...entry, kept: COPY });
      expect(withKept({ ...COPY, details: null }).good!.kept).toEqual({ ...COPY, details: null });
      // What a copy is not made of (hours, a kind) is not kept: it holds a name, details and a source, no more.
      expect(withKept({ ...COPY, kind: 'bagrut', startTime: '14:00', endTime: '15:45' }).good!.kept).toEqual(COPY);
      expect(withKept({ subject: 'x', source: 'shahaf' }).good!.kept).toEqual({ subject: 'x', details: null, source: 'shahaf' });
      for (const bad of [null, 'זבל', 7, [], {}, { ...COPY, subject: '' }, { ...COPY, subject: 5 }, { ...COPY, source: 'elsewhere' }, { ...COPY, source: 7 },
        { ...COPY, details: 5 }]) {
        const read = withKept(bad);
        expect(read.good).toEqual(entry);
        expect('kept' in read.good!).toBe(false);
      }
      // An entry from before the copies is as it was.
      expect(withKept(undefined).other).toEqual(entry);
    });

    it('is shown on the student\'s date only once the school\'s date has left the feed\'s window by age, and while the date is not long past', () => {
      const prefs = readExamPrefs((() => {
        const kv = memoryKv();
        setExamDate(kv, key, '2026-11-30', '2026-11-09', asListed);
        return kv;
      })());
      const none = new Set<string>();
      const shownOn = (today: string, listed: ReadonlySet<string> = none) => keptExams(prefs, listed, today).map((e) => e.naturalKey);
      // The feed holds the exams from seven days back on: the 9th is listed through the 16th, and gone on the 17th.
      expect(FEED_EXAM_PAST_DAYS).toBe(7);
      expect(shownOn('2026-11-12')).toEqual([]);
      expect(shownOn('2026-11-16')).toEqual([]);
      expect(shownOn('2026-11-17')).toEqual([key]);
      expect(shownOn('2026-11-29')).toEqual([key]);
      expect(shownOn('2026-12-07')).toEqual([key]);
      // The student's date is long past: the entry is dead.
      expect(shownOn('2026-12-08')).toEqual([]);
      // The source lists it: the listed exam is the one.
      expect(shownOn('2026-11-17', new Set([key]))).toEqual([]);
      // On the school's date, as the school has it: movedExam puts it on the student's.
      expect(keptExams(prefs, none, '2026-11-17')[0]).toEqual(asListed);
      expect(movedExam(keptExams(prefs, none, '2026-11-17')[0]!, prefs)).toEqual({ ...asListed, date: '2026-11-30', originalDate: '2026-11-09' });
      // No copy, no exam; and an exam added by hand has no date entry to keep.
      expect(keptExams({ ...NO_EXAM_PREFS, dates: { [key]: { date: '2026-11-30', sourceDate: '2026-11-09' } } }, none, '2026-11-17')).toEqual([]);
      expect(keptExams(undefined, none, '2026-11-17')).toEqual([]);
      const manual = { ...prefs, dates: { 'manual|abc': { ...prefs.dates[key]! } } };
      expect(keptExams(manual, none, '2026-11-17')).toEqual([]);
    });

    it('has one rule for a date that will not hold, which the pruning goes by and the sheet asks', () => {
      const today = '2026-11-17';
      // [the student's date, the school's date, whether the entry is dead]
      const cases: [string, string, boolean][] = [
        ['2026-11-01', '2026-10-20', true],
        ['2026-11-09', '2026-11-16', true],
        // The edge: seven days back exactly is not more than seven.
        ['2026-11-10', '2026-10-30', false],
        // The school's date is ahead, or today: the student moved an upcoming exam into the past, and it stays there.
        ['2026-11-01', '2026-12-20', false],
        ['2026-11-01', '2026-11-17', false],
        ['2026-11-01', '2026-11-16', true],
        // The student's date holds: ahead.
        ['2026-12-01', '2026-10-20', false],
      ];
      for (const [date, sourceDate, dead] of cases) {
        expect(isDeadExamDate(date, sourceDate, today), `${date} / ${sourceDate}`).toBe(dead);
        // The same answer from the pruning, with the exam listed or not.
        const kv = memoryKv();
        setExamDate(kv, 'k|a', date, sourceDate);
        expect(Object.keys(pruneExamDates(kv, [], today).dates), `${date} / ${sourceDate}`).toEqual(dead ? [] : ['k|a']);
      }
    });

    it('drops an entry whose own date is long past, and never one only because its exam is not listed', () => {
      const kv = memoryKv();
      // Dates more than seven days past: the entry is dead, whether the exam is listed (the school's date past too) or not.
      setExamDate(kv, 'k|dead-absent', '2026-11-01', '2026-10-20');
      setExamDate(kv, 'k|dead-listed', '2026-11-02', '2026-10-25');
      // The edge: seven days back exactly is not more than seven.
      setExamDate(kv, 'k|edge', '2026-11-10', '2026-10-30');
      // The student's date is past and the school's is ahead: the student moved an upcoming exam into the past, and it stays there.
      setExamDate(kv, 'k|moved-back', '2026-11-01', '2026-12-20');
      // Absent, with every date ahead: a read without it says nothing.
      setExamDate(kv, 'k|absent-ahead', '2026-12-01', '2026-11-20');
      const listed = (k: string, date: string): Exam => ({ naturalKey: k, date, subject: 'x', details: null, source: 'school_site' });
      const pruned = pruneExamDates(kv, [listed('k|dead-listed', '2026-10-25'), listed('k|edge', '2026-10-30'), listed('k|moved-back', '2026-12-20')], '2026-11-17');
      expect(Object.keys(pruned.dates).sort()).toEqual(['k|absent-ahead', 'k|edge', 'k|moved-back']);
      expect(readExamPrefs(kv)).toEqual(pruned);
      // An empty read removes the long past one that is not listed, which is by its date, and nothing else.
      expect(Object.keys(pruneExamDates(kv, [], '2026-11-18').dates).sort()).toEqual(['k|absent-ahead', 'k|moved-back']);
    });
  });
});

describe('the exams the phone builds', () => {
  it('carry the student\'s name and keep the source\'s', () => {
    const exams = localExamsFrom(sources({ examPrefs: RENAMED }), '2026-10-21', '2026-10-21');
    expect(exams.find((e) => e.naturalKey === 'site-exam|english')).toMatchObject({ subject: 'בוחן פתע, יחידה 3', originalSubject: 'מבחן באנגלית' });
    const mock = exams.find((e) => e.naturalKey === 'site-exam|mock')!;
    expect(mock.subject).toBe('מתכונת בהיסטוריה');
    expect('originalSubject' in mock).toBe(false);
    // Without the prefs, the sources' names.
    expect(localExamsFrom(sources(), '2026-10-21', '2026-10-21').map((e) => e.subject)).toContain('מבחן באנגלית');
  });

  it('show it on the day, and a hidden exam stays hidden by its key', () => {
    const [day] = buildLocalDays(sources({ examPrefs: RENAMED }), ['2026-10-21']);
    expect(day!.examsToday.map((e) => e.subject)).toEqual(['בוחן פתע, יחידה 3']);
    const hidden = { ...DEFAULT_SETTINGS, exams: { ...DEFAULT_SETTINGS.exams, hiddenKeys: ['site-exam|english'] } };
    expect(buildLocalDays(sources({ examPrefs: RENAMED, settings: hidden }), ['2026-10-21'])[0]!.examsToday).toEqual([]);
  });

  it('rename an exam added by hand the same way, still the student\'s own', () => {
    const kv = memoryKv();
    const added = addManualExam(kv, { date: '2026-11-04', subject: 'ספרות' }, NOW);
    const prefs: ExamPrefs = { renames: { [added.naturalKey]: 'ספרות, השירה של רחל' }, calendarSkip: [], dates: {} };
    const [exam] = localExamsFrom({ feed: null, mashov: [], bagrut: [], manualExams: readManualExams(kv), examPrefs: prefs, settings: DEFAULT_SETTINGS }, '2026-10-21', '2026-10-21');
    expect(exam).toMatchObject({ naturalKey: added.naturalKey, kind: 'manual', subject: 'ספרות, השירה של רחל', originalSubject: 'ספרות' });
    const [option] = examOptionsAsPublished([exam!], { kept: [], hidden: [] }, DEFAULT_SETTINGS);
    expect(option).toMatchObject({ subject: 'ספרות, השירה של רחל', subjectKey: 'ספרות', match: { mine: true } });
  });

  it('say the name in full in the morning summary', () => {
    const [day] = buildLocalDays(sources({ examPrefs: RENAMED }), ['2026-10-21']);
    expect(planMorningSummary(day!, DEFAULT_SETTINGS, ZONE)!.body).toContain('מבחן היום: בוחן פתע, יחידה 3');
    // Not renamed: by its subject, as always.
    const [plain] = buildLocalDays(sources(), ['2026-10-21']);
    expect(planMorningSummary(plain!, DEFAULT_SETTINGS, ZONE)!.body).toContain('מבחן היום: אנגלית');
  });
});

describe('the exams the phone builds, on the date the student gave them', () => {
  const withExams = (...extra: ClassFeed['exams']): ClassFeed => ({ ...FEED, exams: [...FEED.exams, ...extra] });
  const site = (key: string, date: string, subject: string): ClassFeed['exams'][number] => ({ naturalKey: key, date, subject, details: null, source: 'school_site' });
  const keysAndDates = (exams: Exam[]) => exams.map((e) => [e.naturalKey, e.date]);

  it('list an exam on the student\'s date, in the order of the dates they show, the school\'s date kept', () => {
    const prefs = dated(['site-exam|mock', '2026-11-12', '2026-11-01']);
    const exams = localExamsFrom(sources({ examPrefs: prefs }), '2026-10-21', '2026-10-21');
    expect(keysAndDates(exams)).toEqual([['site-exam|english', '2026-10-21'], ['site-exam|physics', '2026-11-03'], ['site-exam|mock', '2026-11-12']]);
    expect(exams.find((e) => e.naturalKey === 'site-exam|mock')).toMatchObject({ date: '2026-11-12', originalDate: '2026-11-01' });
    const plain = exams.find((e) => e.naturalKey === 'site-exam|physics')!;
    expect('originalDate' in plain).toBe(false);

    // The school moves it on: its date wins, and the student's has fallen.
    const movedBySchool = { ...FEED, exams: FEED.exams.map((e) => (e.naturalKey === 'site-exam|mock' ? { ...e, date: '2026-11-02' } : e)) };
    const after = localExamsFrom(sources({ feed: movedBySchool, examPrefs: prefs }), '2026-10-21', '2026-10-21');
    const mock = after.find((e) => e.naturalKey === 'site-exam|mock')!;
    expect(mock.date).toBe('2026-11-02');
    expect('originalDate' in mock).toBe(false);
  });

  it('reach into a list by the student\'s date, not the school\'s: one moved in from the past is ahead, one moved to the past is not', () => {
    // Five days past on the 21st: the feed as the server sends it still lists it (seven days back); a longer-gone exam is `kept`'s.
    const feed = withExams(site('site-exam|gone', '2026-10-16', 'מבחן שעבר'));
    // Not ahead on the school's date; ahead on the student's.
    expect(localExamsFrom(sources({ feed }), '2026-10-21', '2026-10-21').map((e) => e.naturalKey)).not.toContain('site-exam|gone');
    const moved = localExamsFrom(sources({ feed, examPrefs: dated(['site-exam|gone', '2026-11-20', '2026-10-16']) }), '2026-10-21', '2026-10-21');
    expect(keysAndDates(moved)).toContainEqual(['site-exam|gone', '2026-11-20']);
    // Ahead on the school's date; behind on the student's.
    const early = localExamsFrom(sources({ examPrefs: dated(['site-exam|physics', '2026-10-10', '2026-11-03']) }), '2026-10-21', '2026-10-21');
    expect(early.map((e) => e.naturalKey)).not.toContain('site-exam|physics');
    // And the whole list, from no date, has it where the student put it.
    expect(keysAndDates(localExamsFrom(sources({ examPrefs: dated(['site-exam|physics', '2026-10-10', '2026-11-03']) }), '0000-00-00', '2026-10-21'))[0]).toEqual(['site-exam|physics', '2026-10-10']);
  });

  it('still drop the site\'s twin of an exam the calendar lists, once, whichever of the two the student moved', () => {
    const exam = (source: 'shahaf' | 'school_site', date: string, subject: string): ClassFeed['exams'][number] => ({
      naturalKey: `${source}|${date}|${subject}`, date, subject, details: null, source,
    });
    const feed: ClassFeed = {
      ...FEED,
      class: { ...FEED.class, examCalendarId: 'cal' },
      exams: [exam('shahaf', '2026-11-04', 'מבחן בתנ"ך שכבה י"א'), exam('school_site', '2026-11-04', 'מבחן בתנ"ך'), exam('shahaf', '2026-11-08', 'מבחן במתמטיקה שכבה יא')],
    };
    const calendarKey = 'school_site|2026-11-04|מבחן בתנ"ך';
    const siteKey = 'shahaf|2026-11-04|מבחן בתנ"ך שכבה י"א';
    // The calendar's one moved: the twin is matched on the school's dates, so it is gone, and the exam is where the student put it.
    const moved = localExamsFrom(sources({ feed, examPrefs: dated([calendarKey, '2026-11-10', '2026-11-04']) }), '2026-10-21', '2026-10-21');
    expect(keysAndDates(moved)).toEqual([['shahaf|2026-11-08|מבחן במתמטיקה שכבה יא', '2026-11-08'], [calendarKey, '2026-11-10']]);
    expect(moved[1]).toMatchObject({ originalDate: '2026-11-04' });
    // The site's one moved, which the phone does not show: the calendar's is the exam, on its own date.
    const siteMoved = localExamsFrom(sources({ feed, examPrefs: dated([siteKey, '2026-11-10', '2026-11-04']) }), '2026-10-21', '2026-10-21');
    expect(keysAndDates(siteMoved)).toEqual([[calendarKey, '2026-11-04'], ['shahaf|2026-11-08|מבחן במתמטיקה שכבה יא', '2026-11-08']]);
    // And on a day: once, on the student's.
    const [fourth, tenth] = buildLocalDays(sources({ feed, examPrefs: dated([calendarKey, '2026-11-10', '2026-11-04']) }), ['2026-11-04', '2026-11-10']);
    expect(fourth!.examsToday).toEqual([]);
    expect(tenth!.examsToday.map((e) => e.naturalKey)).toEqual([calendarKey]);
  });

  it('put an exam on the day the student gave it, even when the school\'s date is out of the days built', () => {
    const far = site('site-exam|far', '2027-03-01', 'מבחן בספרות');
    const feed = withExams(far);
    const prefs = dated(['site-exam|far', '2026-10-22', '2027-03-01'], ['site-exam|physics', '2027-03-02', '2026-11-03']);
    const [today, tomorrow] = buildLocalDays(sources({ feed, examPrefs: prefs }), ['2026-10-21', '2026-10-22']);
    expect(today!.examsToday.map((e) => e.naturalKey)).toEqual(['site-exam|english']);
    expect(tomorrow!.examsToday).toEqual([expect.objectContaining({ naturalKey: 'site-exam|far', date: '2026-10-22', originalDate: '2027-03-01' })]);
    expect(today!.examsTomorrow.map((e) => e.naturalKey)).toEqual(['site-exam|far']);
    // Without the student's date it is not on these days at all.
    expect(buildLocalDays(sources({ feed }), ['2026-10-22'])[0]!.examsToday).toEqual([]);

    // One moved out of the days is not on its school's day, and is on the day it was moved to.
    const [third, later] = [
      buildLocalDays(sources({ feed, examPrefs: prefs }), ['2026-11-03'])[0]!,
      buildLocalDays(sources({ feed, examPrefs: prefs }), ['2027-03-02'])[0]!,
    ];
    expect(third.examsToday).toEqual([]);
    expect(later.examsToday.map((e) => [e.naturalKey, e.date, e.originalDate])).toEqual([['site-exam|physics', '2027-03-02', '2026-11-03']]);
    // The next exam of a day goes by the student's dates too.
    expect(today!.nextExam?.exam.naturalKey).toBe('site-exam|english');
    expect(buildLocalDays(sources({ feed, examPrefs: dated(['site-exam|english', '2026-12-30', '2026-10-21']) }), ['2026-10-21'])[0]!.nextExam)
      .toMatchObject({ exam: { naturalKey: 'site-exam|mock' } });
  });

  it('reach the morning summary, the widget and its days on the student\'s date', () => {
    // English, today, moved to the 25th; physics, the 3rd of November, moved onto today.
    const src = sources({ examPrefs: dated(['site-exam|english', '2026-10-25', '2026-10-21'], ['site-exam|physics', '2026-10-21', '2026-11-03']) });
    const [today, , , , fifth] = buildLocalDays(src, ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(today!.examsToday.map((e) => e.naturalKey)).toEqual(['site-exam|physics']);
    expect(planMorningSummary(today!, DEFAULT_SETTINGS, ZONE)!.body).toContain('מבחן היום: פיזיקה');
    expect(planMorningSummary(today!, DEFAULT_SETTINGS, ZONE)!.body).not.toContain('אנגלית');
    expect(fifth!.examsToday.map((e) => e.naturalKey)).toEqual(['site-exam|english']);

    const feed = buildWidgetFeed({ day: today!, zone: ZONE, now: NOW, openTasks: [], upcomingExams: localExamsFrom(src, '2026-10-21', '2026-10-21') });
    expect(feed.nextExam).toMatchObject({ date: '2026-10-21', daysAway: 0 });
    expect(feed.upcomingExams!.map((e) => [e.date, e.daysAway])).toEqual([['2026-10-21', 0], ['2026-10-25', 4], ['2026-11-01', 11]]);
  });

  it('keep a hidden exam hidden, wherever the student put it', () => {
    const hidden = { ...DEFAULT_SETTINGS, exams: { ...DEFAULT_SETTINGS.exams, hiddenKeys: ['site-exam|english'] } };
    const prefs = dated(['site-exam|english', '2026-10-22', '2026-10-21']);
    expect(buildLocalDays(sources({ examPrefs: prefs, settings: hidden }), ['2026-10-21', '2026-10-22']).flatMap((d) => d.examsToday)).toEqual([]);
    expect(buildLocalDays(sources({ examPrefs: prefs }), ['2026-10-22'])[0]!.examsToday.map((e) => e.naturalKey)).toEqual(['site-exam|english']);
  });

  it('keep a manual exam where its stored date is, whatever the prefs hold for its key', () => {
    const kv = memoryKv();
    const added = addManualExam(kv, { date: '2026-11-04', subject: 'ספרות' }, NOW);
    const prefs = dated([added.naturalKey, '2026-11-20', '2026-11-04']);
    const [exam] = localExamsFrom({ feed: null, mashov: [], bagrut: [], manualExams: readManualExams(kv), examPrefs: prefs, settings: DEFAULT_SETTINGS }, '2026-10-21', '2026-10-21');
    expect(exam).toMatchObject({ naturalKey: added.naturalKey, date: '2026-11-04', kind: 'manual' });
    expect('originalDate' in exam!).toBe(false);
  });

  it('are listed in "המבחנים שלי" on the student\'s date, matched as the school gave them', () => {
    const owner = { kept: [{ subject: 'אנגלית', teacher: 'שרון' }], hidden: [] };
    const asPublished = examOptions(localExamsFrom(sources(), '2026-10-21', '2026-10-21'), owner, DEFAULT_SETTINGS);
    const english = asPublished.find((o) => o.naturalKey === 'site-exam|english')!;
    const dateOnly = dated(['site-exam|english', '2026-11-12', '2026-10-21']);
    const both: ExamPrefs = { ...dateOnly, renames: { 'site-exam|english': 'בוחן פתע' } };

    for (const prefs of [dateOnly, both]) {
      const exams = localExamsFrom(sources({ examPrefs: prefs }), '2026-10-21', '2026-10-21');
      const options = examOptionsAsPublished(exams, owner, DEFAULT_SETTINGS);
      const option = options.find((o) => o.naturalKey === 'site-exam|english')!;
      // The date is the student's, the school's is kept, and the match is the same as the school's own.
      expect(option).toMatchObject({ date: '2026-11-12', originalDate: '2026-10-21', subjectKey: english.subjectKey, match: english.match, hidden: false });
      // The others are as published.
      expect(options.find((o) => o.naturalKey === 'site-exam|mock')).toEqual(asPublished.find((o) => o.naturalKey === 'site-exam|mock'));
    }
    const named = examOptionsAsPublished(localExamsFrom(sources({ examPrefs: both }), '2026-10-21', '2026-10-21'), owner, DEFAULT_SETTINGS)
      .find((o) => o.naturalKey === 'site-exam|english');
    expect(named).toMatchObject({ subject: 'בוחן פתע', originalSubject: 'מבחן באנגלית' });
    // An exam not moved has no originalDate on its option.
    expect('originalDate' in asPublished[0]!).toBe(false);
  });
});

describe('matching goes by the source\'s name', () => {
  const owner = { kept: [{ subject: 'אנגלית', teacher: 'שרון' }], hidden: [] };

  it('in "המבחנים שלי": the same subject group and the same answer, under the new name', () => {
    const exams = localExamsFrom(sources({ examPrefs: { renames: { 'site-exam|english': 'בוחן פתע' }, calendarSkip: [], dates: {} } }), '2026-10-21', '2026-10-21');
    const english = exams.find((e) => e.naturalKey === 'site-exam|english')!;
    const asPublished = examOptions(localExamsFrom(sources(), '2026-10-21', '2026-10-21'), owner, DEFAULT_SETTINGS)
      .find((o) => o.naturalKey === 'site-exam|english')!;
    const [option] = examOptionsAsPublished([english], owner, DEFAULT_SETTINGS);
    expect(option).toMatchObject({ subject: 'בוחן פתע', originalSubject: 'מבחן באנגלית', subjectKey: asPublished.subjectKey, match: asPublished.match });
    expect(asPublished).toMatchObject({ subjectKey: 'אנגלית', match: { mine: true } });
    // Matched by the new name instead, the exam would lose its subject.
    expect(examOptions([english], owner, DEFAULT_SETTINGS)[0]!.subjectKey).not.toBe('אנגלית');
  });

  it('on the screens: the subject group, the study task, and a bagrut exam\'s name', () => {
    const renamed = { naturalKey: 'site-exam|english', date: '2026-11-03', subject: 'בוחן פתע', originalSubject: 'מבחן באנגלית' };
    expect(examGroupKey(renamed)).toBe('אנגלית');
    expect(studyTask(renamed, '2026-10-21').title).toBe(studyTask({ ...renamed, subject: 'מבחן באנגלית', originalSubject: undefined }, '2026-10-21').title);
    // A bagrut exam the table knows is named their way once renamed, its hours on the kind line.
    const g = { naturalKey: 'bagrut|16582|2027-01', subject: 'אנגלית', kind: 'bagrut' as const, startTime: '14:00', endTime: '15:45' };
    expect(examNaming(g, CATALOG).title).toBe('בגרות באנגלית, מודול G');
    expect(examNaming({ ...g, subject: 'מודול G שלי', originalSubject: 'אנגלית' }, CATALOG)).toEqual({
      title: 'מודול G שלי', kind: { label: 'בחינת בגרות', time: '14:00–15:45' }, hours: null,
    });
  });

  it('a bagrut exam named by its subject keeps the table\'s title, with the subject\'s name for the subject', () => {
    const g = { naturalKey: 'bagrut|16582|2027-01', subject: 'אנגלית', kind: 'bagrut' as const, startTime: '14:00', endTime: '15:45' };
    const named = { ...g, subject: 'English', originalSubject: 'אנגלית', subjectName: 'English' };
    // The part's title ("מודול G") is the table's and stays; its hours go on the date's line.
    expect(examNaming(named, CATALOG)).toEqual({ title: 'בגרות בEnglish, מודול G', kind: null, hours: '14:00–15:45' });
    // Without a name for the subject, the table's own.
    expect(examNaming(g, CATALOG).title).toBe('בגרות באנגלית, מודול G');
  });

  it('a name the student gave the exam itself still wins over its subject\'s name', () => {
    const exam: Exam = {
      naturalKey: 'bagrut|16582|2027-01', date: '2027-01-21', subject: 'English', details: null, source: 'mashov', kind: 'bagrut',
      startTime: '14:00', endTime: '15:45', originalSubject: 'אנגלית', subjectName: 'English',
    };
    const own = renamedExam(exam, { renames: { [exam.naturalKey]: 'מודול G שלי' }, calendarSkip: [], dates: {} });
    // `renamedExam` takes the subject's name off: the exam's own name is not "a name given to the subject".
    expect(own).toMatchObject({ subject: 'מודול G שלי', originalSubject: 'אנגלית' });
    expect(own.subjectName).toBeUndefined();
    expect(examNaming(own, CATALOG)).toEqual({
      title: 'מודול G שלי', kind: { label: 'בחינת בגרות', time: '14:00–15:45' }, hours: null,
    });
  });

  it('as the exam sheet works it out: the subject\'s name, then the exam\'s own over it, then the subject\'s again', () => {
    const lines = [{ key: 'אנגלית', name: 'אנגלית', teacher: 'שרון', inMashov: true, count: 4 }];
    const opened: Exam = {
      naturalKey: 'bagrut|16582|2027-01', date: '2027-01-21', subject: 'אנגלית', details: null, source: 'mashov', kind: 'bagrut',
      startTime: '14:00', endTime: '15:45',
    };
    const sheet = (names: Record<string, string>, prefs: ExamPrefs) => renamedExam(examWithNames(opened, names, lines, []), prefs);
    const none: ExamPrefs = { renames: {}, calendarSkip: [], dates: {} };
    const own: ExamPrefs = { renames: { [opened.naturalKey]: 'מודול G שלי' }, calendarSkip: [], dates: {} };

    expect(examNaming(sheet({}, none), CATALOG).title).toBe('בגרות באנגלית, מודול G');
    expect(examNaming(sheet({ אנגלית: 'English' }, none), CATALOG).title).toBe('בגרות בEnglish, מודול G');
    // The exam's own name over it; the subject's name is still there beneath it.
    expect(examNaming(sheet({ אנגלית: 'English' }, own), CATALOG).title).toBe('מודול G שלי');
    expect(examWithNames(sheet({ אנגלית: 'English' }, own), { אנגלית: 'English' }, lines, []).subjectName).toBe('English');
    // The exam's own name cleared in the open sheet: its subject's name comes back, not the school's title.
    expect(examNaming(sheet({ אנגלית: 'English' }, none), CATALOG).title).toBe('בגרות בEnglish, מודול G');
    // And the "שם מקורי" row: the title before any name, whichever kind of name it wears.
    const original = (e: Exam) => examNaming({ ...e, subject: e.originalSubject ?? e.subject, originalSubject: undefined, subjectName: undefined }, CATALOG).title;
    expect(original(sheet({ אנגלית: 'English' }, none))).toBe('בגרות באנגלית, מודול G');
    expect(original(sheet({ אנגלית: 'English' }, own))).toBe('בגרות באנגלית, מודול G');
  });

  it('a subject named exam outside the table is named as it is, whole', () => {
    const site = { naturalKey: 'site-exam|block', subject: 'מבחן פיזיקה', originalSubject: "מבחן גוש ב'", subjectName: 'פיזיקה' };
    expect(examNaming(site, CATALOG)).toEqual({ title: 'מבחן פיזיקה', kind: null, hours: null });
  });
});

describe('the widget and Today show the student\'s name whole', () => {
  it('in the feed, the next exam\'s line and the exams list', () => {
    const prefs: ExamPrefs = { renames: { 'site-exam|english': 'בוחן פתע, יחידה 3', 'site-exam|physics': 'חזרה לפיזיקה' }, calendarSkip: [], dates: {} };
    const src = sources({ examPrefs: prefs });
    const [day] = buildLocalDays(src, ['2026-10-21']);
    const feed = buildWidgetFeed({ day: day!, zone: ZONE, now: NOW, openTasks: [], upcomingExams: localExamsFrom(src, '2026-10-21', '2026-10-21') });
    expect(feed.nextExam).toEqual({ subject: 'בוחן פתע, יחידה 3', date: '2026-10-21', daysAway: 0, named: true });
    expect(feed.days![0]!.exams).toEqual([{ subject: 'בוחן פתע, יחידה 3', date: '2026-10-21', daysAway: 0, named: true }]);
    // The others as they always were: no `named` at all.
    const mock = feed.upcomingExams!.find((e) => e.subject === 'מתכונת בהיסטוריה')!;
    expect('named' in mock).toBe(false);

    // A name that says it is an exam needs no "מבחן" before it; the rest keeps the line's own words.
    expect(nextExamLine(feed.nextExam!)).toBe('בוחן פתע, יחידה 3, היום');
    expect(examRow(feed.nextExam!)).toBe('בוחן פתע, יחידה 3, היום');
    const physics = feed.upcomingExams!.find((e) => e.subject === 'חזרה לפיזיקה')!;
    expect(physics).toMatchObject({ named: true, daysAway: 13 });
    expect(nextExamLine(physics)).toBe('מבחן חזרה לפיזיקה, עוד 13 ימים');
    expect(examRow({ ...physics, daysAway: 1 })).toBe('חזרה לפיזיקה, מבחן מחר');
    expect(nextExamLine({ subject: 'הבוחן של רותי', date: '2026-10-22', daysAway: 1, named: true })).toBe('הבוחן של רותי, מחר');
    expect(nextExamLine({ subject: 'מודול G שלי', date: '2026-10-22', daysAway: 1, named: true })).toBe('מבחן מודול G שלי, מחר');

    // A long one is cut, so the count of days still shows.
    const long = nextExamLine({ subject: 'חזרה לפני המבחן הגדול בפיזיקה', date: '2026-10-23', daysAway: 2, named: true });
    expect(long).toBe(`מבחן ${'חזרה לפני המבחן הגדול בפיזיקה'.slice(0, OWN_EXAM_NAME_MAX - 1).trimEnd()}…, עוד 2 ימים`);

    // Not renamed: the subject's short form, as before.
    expect(nextExamLine({ subject: 'מבחן באנגלית', date: '2026-10-22', daysAway: 1 })).toBe('מבחן אנג׳, מחר');
  });

  it('on Today\'s next-exam row: the name as written, brackets and all', () => {
    const exam = { naturalKey: 'site-exam|english', date: '2026-10-22', subject: 'בוחן (פרק 3)', details: null, source: 'school_site' as const };
    expect(examStrip({ exam: { ...exam, originalSubject: 'מבחן באנגלית' }, daysAway: 1 }, '2026-10-21').subject).toBe('בוחן (פרק 3)');
    expect(examStrip({ exam, daysAway: 1 }, '2026-10-21').subject).toBe('בוחן');
  });
});

function fakeGoogle(
  existing: { id: string; key: string; summary: string; date: string }[] = [],
  onRequest?: (method: string, url: string) => void,
) {
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  const requester: GoogleRequester = {
    async request<T>(url: string, init: RequestInit = {}): Promise<T> {
      const method = init.method ?? 'GET';
      calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
      onRequest?.(method, url);
      if (method === 'POST' && url.endsWith('/calendars')) return { id: 'phone-cal' } as T;
      if (method === 'GET' && url.endsWith('/calendars/phone-cal')) return { id: 'phone-cal' } as T;
      if (method === 'GET' && url.includes('/events?')) {
        return {
          items: existing.map((e) => ({
            id: e.id, summary: e.summary, start: { date: e.date },
            extendedProperties: { private: { sederyomKey: e.key, sederyomOwner: 'sederyom' } },
          })),
        } as T;
      }
      return {} as T;
    },
  };
  return { requester, calls };
}

describe("the phone's Google calendar", () => {
  it('names a renamed exam its way, and leaves out an exam kept out of it, which stays in the app', async () => {
    const kv = memoryKv();
    // Run ten minutes ago: not due for another fifty.
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() }));
    const prefs: ExamPrefs = { renames: { 'site-exam|physics': 'חזרה לפיזיקה' }, calendarSkip: ['site-exam|mock'], dates: {} };
    // The mock exam is in Google from before it was kept out.
    const g = fakeGoogle([{ id: 'ev-mock', key: 'site-exam|mock', summary: 'מבחן · מתכונת בהיסטוריה', date: '2026-11-01' }]);
    const src = sources({ examPrefs: prefs });

    await runPhoneMirror({ kv, requester: g.requester, src, now: NOW });
    expect(g.calls).toEqual([]);

    // The change on the phone makes the next refresh mirror again, and nothing else.
    markMirrorDue(kv);
    expect(mirrorState(kv)).toMatchObject({ calendarId: 'phone-cal', lastRunAt: null });

    const state = await runPhoneMirror({ kv, requester: g.requester, src, now: NOW });
    expect(state.lastError).toBeNull();
    const posted = g.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/calendars/phone-cal/events'));
    expect(posted.map((c) => c.body!.summary).sort()).toEqual(['טיול שנתי', 'מבחן · חזרה לפיזיקה', 'מבחן · מבחן באנגלית'].sort());
    expect(posted.some((c) => (c.body!.extendedProperties as { private: { sederyomKey: string } }).private.sederyomKey === 'site-exam|mock')).toBe(false);
    const deleted = g.calls.filter((c) => c.method === 'DELETE');
    expect(deleted.map((c) => c.url)).toEqual(['https://www.googleapis.com/calendar/v3/calendars/phone-cal/events/ev-mock']);
    expect(state.lastResult).toEqual({ created: 3, updated: 0, removed: 1 });

    // Out of Google only: the app still has it.
    expect(localExamsFrom(src, '2026-10-21', '2026-10-21').map((e) => e.naturalKey)).toContain('site-exam|mock');
  });

  it('puts an exam back once the student shows it in Google again', async () => {
    const kv = memoryKv();
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }));
    setExamInCalendar(kv, 'site-exam|mock', false);
    const skip = fakeGoogle([{ id: 'ev-mock', key: 'site-exam|mock', summary: 'מבחן · מתכונת בהיסטוריה', date: '2026-11-01' }]);
    await runPhoneMirror({ kv, requester: skip.requester, src: sources({ examPrefs: readExamPrefs(kv) }), now: NOW });
    expect(skip.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      'https://www.googleapis.com/calendar/v3/calendars/phone-cal/events/ev-mock',
    ]);

    // Shown again ten minutes later: due at once, not in fifty minutes.
    setExamInCalendar(kv, 'site-exam|mock', true);
    markMirrorDue(kv);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    // Google as the skip run left it: the other exams and the trip, no mock exam.
    const back = fakeGoogle([
      { id: 'ev-1', key: 'site-exam|english', summary: 'מבחן · מבחן באנגלית', date: '2026-10-21' },
      { id: 'ev-2', key: 'site-exam|physics', summary: 'מבחן · מבחן בפיזיקה', date: '2026-11-03' },
      { id: 'ev-3', key: 'shahaf-event|trip', summary: 'טיול שנתי', date: '2026-10-30' },
    ]);
    const state = await runPhoneMirror({ kv, requester: back.requester, src: sources({ examPrefs: readExamPrefs(kv) }), now: later });
    const posted = back.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/calendars/phone-cal/events'));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toMatchObject({
      summary: 'מבחן · מתכונת בהיסטוריה',
      start: { date: '2026-11-01' },
      extendedProperties: { private: { sederyomKey: 'site-exam|mock' } },
    });
    expect(back.calls.some((c) => c.method === 'DELETE' || c.method === 'PATCH')).toBe(false);
    expect(state.lastResult).toEqual({ created: 1, updated: 0, removed: 0 });
  });

  it('leaves the next refresh due when the student changes an exam while a run is under way', async () => {
    const kv = memoryKv();
    // Due already (an earlier change), so the change made during the run finds nothing to clear.
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }));
    let changed = false;
    const g = fakeGoogle([], (method) => {
      // The student turns "להציג ביומן Google" off while the run is sending.
      if (method === 'POST' && !changed) {
        changed = true;
        setExamInCalendar(kv, 'site-exam|mock', false);
        markMirrorDue(kv);
      }
    });
    const state = await runPhoneMirror({ kv, requester: g.requester, src: sources({ examPrefs: readExamPrefs(kv) }), now: NOW });
    expect(changed).toBe(true);
    // The run sent the mock exam, as it read the prefs before the change, and must not stamp over it.
    expect(state).toMatchObject({ lastRunAt: null, lastError: null, calendarId: 'phone-cal', dueSeq: 1 });
    expect(mirrorState(kv).lastRunAt).toBeNull();

    // So the next refresh runs at once, and takes the mock exam out.
    const next = fakeGoogle([{ id: 'ev-mock', key: 'site-exam|mock', summary: 'מבחן · מתכונת בהיסטוריה', date: '2026-11-01' }]);
    const after = await runPhoneMirror({ kv, requester: next.requester, src: sources({ examPrefs: readExamPrefs(kv) }), now: NOW });
    expect(next.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    // Nothing changed during this one: stamped as usual.
    expect(after.lastRunAt).toBe(NOW.toISOString());
  });

  it('leaves the next refresh due when a failing run had a change made during it', async () => {
    const kv = memoryKv();
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString() }));
    const requester: GoogleRequester = {
      async request<T>(): Promise<T> {
        markMirrorDue(kv);
        throw Object.assign(new Error('Service unavailable'), { status: 503 });
      },
    };
    const state = await runPhoneMirror({ kv, requester, src: sources(), now: NOW });
    expect(state).toMatchObject({ lastRunAt: null, lastError: 'Service unavailable', calendarId: 'phone-cal' });
  });

  it('renames an event already in Google', async () => {
    const kv = memoryKv();
    kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }));
    const g = fakeGoogle([{ id: 'ev-physics', key: 'site-exam|physics', summary: 'מבחן · מבחן בפיזיקה', date: '2026-11-03' }]);
    await runPhoneMirror({ kv, requester: g.requester, src: sources({ examPrefs: { renames: { 'site-exam|physics': 'חזרה לפיזיקה' }, calendarSkip: [], dates: {} } }), now: NOW });
    const patched = g.calls.filter((c) => c.method === 'PATCH');
    expect(patched).toHaveLength(1);
    expect(patched[0]).toMatchObject({ url: 'https://www.googleapis.com/calendar/v3/calendars/phone-cal/events/ev-physics', body: { summary: 'מבחן · חזרה לפיזיקה' } });
  });

  describe('an exam the student moved', () => {
    const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/phone-cal/events';
    /** The calendar as an earlier run left it, with each exam on the school's date. */
    const MADE = [
      { id: 'ev-english', key: 'site-exam|english', summary: 'מבחן · מבחן באנגלית', date: '2026-10-21' },
      { id: 'ev-mock', key: 'site-exam|mock', summary: 'מבחן · מתכונת בהיסטוריה', date: '2026-11-01' },
      { id: 'ev-physics', key: 'site-exam|physics', summary: 'מבחן · מבחן בפיזיקה', date: '2026-11-03' },
      { id: 'ev-trip', key: 'shahaf-event|trip', summary: 'טיול שנתי', date: '2026-10-30' },
    ];
    const due = () => {
      const kv = memoryKv();
      kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }));
      return kv;
    };
    const created = (calls: ReturnType<typeof fakeGoogle>['calls']) => calls.filter((c) => c.method === 'POST' && c.url === EVENTS);
    const patchedTo = (calls: ReturnType<typeof fakeGoogle>['calls']) =>
      calls.filter((c) => c.method === 'PATCH').map((c) => [c.url, (c.body!.start as { date: string }).date]);

    it('is made on the student\'s date, once, under its own key', async () => {
      const g = fakeGoogle();
      const src = sources({ examPrefs: dated(['site-exam|mock', '2026-11-12', '2026-11-01']) });
      const state = await runPhoneMirror({ kv: due(), requester: g.requester, src, now: NOW });
      const mock = created(g.calls).filter((c) => (c.body!.extendedProperties as { private: { sederyomKey: string } }).private.sederyomKey === 'site-exam|mock');
      expect(mock).toHaveLength(1);
      expect(mock[0]!.body).toMatchObject({ summary: 'מבחן · מתכונת בהיסטוריה', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } });
      // Nothing is made on the school's day for it.
      expect(created(g.calls).some((c) => (c.body!.start as { date: string }).date === '2026-11-01')).toBe(false);
      expect(state.lastResult).toEqual({ created: 4, updated: 0, removed: 0 });
    });

    it('moves the event it made before to the student\'s date: updated in place, not made again nor removed', async () => {
      const g = fakeGoogle(MADE);
      const src = sources({ examPrefs: dated(['site-exam|mock', '2026-11-12', '2026-11-01']) });
      const state = await runPhoneMirror({ kv: due(), requester: g.requester, src, now: NOW });
      expect(state.lastError).toBeNull();
      expect(g.calls.filter((c) => c.method === 'PATCH')).toEqual([
        expect.objectContaining({
          url: `${EVENTS}/ev-mock`,
          body: expect.objectContaining({ summary: 'מבחן · מתכונת בהיסטוריה', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } }),
        }),
      ]);
      expect(created(g.calls)).toEqual([]);
      expect(g.calls.some((c) => c.method === 'DELETE')).toBe(false);
      expect(state.lastResult).toEqual({ created: 0, updated: 1, removed: 0 });
    });

    it('goes back to the school\'s date when the student gives theirs up, and follows the school when it moves the exam', async () => {
      // Gives theirs up: Google has the student's date, the app none.
      const moved = MADE.map((e) => (e.key === 'site-exam|mock' ? { ...e, date: '2026-11-12' } : e));
      const back = fakeGoogle(moved);
      await runPhoneMirror({ kv: due(), requester: back.requester, src: sources(), now: NOW });
      expect(patchedTo(back.calls)).toEqual([[`${EVENTS}/ev-mock`, '2026-11-01']]);

      // The school moves it to the 5th: its date wins over the student's, and the event goes there.
      const feed = { ...FEED, exams: FEED.exams.map((e) => (e.naturalKey === 'site-exam|mock' ? { ...e, date: '2026-11-05' } : e)) };
      const follows = fakeGoogle(moved);
      const state = await runPhoneMirror({ kv: due(), requester: follows.requester, src: sources({ feed, examPrefs: dated(['site-exam|mock', '2026-11-12', '2026-11-01']) }), now: NOW });
      expect(patchedTo(follows.calls)).toEqual([[`${EVENTS}/ev-mock`, '2026-11-05']]);
      expect(state.lastResult).toEqual({ created: 0, updated: 1, removed: 0 });
    });

    it('is moved forward when the school\'s date has gone by, not left behind', async () => {
      // Five days past on the 21st, which the feed as the server sends it still lists; a longer-gone one is in the tests of the copy below.
      const feed = { ...FEED, exams: [...FEED.exams, { naturalKey: 'site-exam|gone', date: '2026-10-16', subject: 'מבחן שעבר', details: null, source: 'school_site' as const }] };
      const made = [...MADE, { id: 'ev-gone', key: 'site-exam|gone', summary: 'מבחן · מבחן שעבר', date: '2026-10-16' }];
      // As it is: a day gone by stays in the calendar.
      const stays = fakeGoogle(made);
      await runPhoneMirror({ kv: due(), requester: stays.requester, src: sources({ feed }), now: NOW });
      expect(stays.calls.filter((c) => c.method === 'PATCH' || c.method === 'DELETE')).toEqual([]);
      // Moved to the future by the student: one event, on the new date.
      const g = fakeGoogle(made);
      const state = await runPhoneMirror({ kv: due(), requester: g.requester, src: sources({ feed, examPrefs: dated(['site-exam|gone', '2026-11-20', '2026-10-16']) }), now: NOW });
      expect(patchedTo(g.calls)).toEqual([[`${EVENTS}/ev-gone`, '2026-11-20']]);
      expect(created(g.calls)).toEqual([]);
      expect(g.calls.some((c) => c.method === 'DELETE')).toBe(false);
      expect(state.lastResult).toEqual({ created: 0, updated: 1, removed: 0 });
    });

    it('stays out of the calendar when the student keeps it out, wherever it was moved', async () => {
      const g = fakeGoogle(MADE);
      const prefs: ExamPrefs = { ...dated(['site-exam|mock', '2026-11-12', '2026-11-01']), calendarSkip: ['site-exam|mock'] };
      await runPhoneMirror({ kv: due(), requester: g.requester, src: sources({ examPrefs: prefs }), now: NOW });
      expect(g.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`${EVENTS}/ev-mock`]);
      expect(created(g.calls)).toEqual([]);
    });
  });
});

/**
 * An exam the school's list has let go of: the device feed holds the class's exams from seven days back on
 * (`dated` in server/src/routes/devices.ts), so an exam on the 9th is in it through the 16th and not on the 17th. The
 * student moved it to a make-up date, the 30th, and the phone keeps a copy for the days between.
 */
describe('an exam the school\'s list has let go of, which the student moved forward', () => {
  const MAKEUP = 'site-exam|makeup';
  const school = (key: string, date: string, subject: string): ClassFeed['exams'][number] => ({ naturalKey: key, date, subject, details: null, source: 'school_site' });
  /** An exam of the feed as the phone holds it (`Exam`): the sheet passes that to `setExamDate`. */
  const asExam = (e: ClassFeed['exams'][number]): Exam => ({ naturalKey: e.naturalKey, date: e.date!, subject: e.subject, details: e.details ?? null, source: e.source ?? 'shahaf' });
  const ALL = [school(MAKEUP, '2026-11-09', 'מבחן בהיסטוריה'), school('site-exam|later', '2026-12-15', 'מבחן בפיזיקה')];
  /** The feed as the server sends it on `today`: nothing dated before seven days back. */
  const feedOn = (today: string, exams: ClassFeed['exams'] = ALL): ClassFeed => ({
    ...FEED, exams: exams.filter((e) => e.date === null || e.date >= addDays(today, -7)),
  });
  const COPY = { subject: 'מבחן בהיסטוריה', details: null, source: 'school_site' as const };
  const MOVED: ExamPrefs = { ...NO_EXAM_PREFS, dates: { [MAKEUP]: { date: '2026-11-30', sourceDate: '2026-11-09', kept: COPY } } };
  const clock = (today: string) => new Date(`${today}T08:00:00Z`);
  /** `run` with the clock on `today`, as the phone reads it. */
  async function on<T>(today: string, run: (now: Date) => T | Promise<T>): Promise<T> {
    vi.setSystemTime(clock(today));
    try {
      return await run(clock(today));
    } finally {
      vi.setSystemTime(NOW);
    }
  }
  const at = (today: string, over: Partial<LocalSources> = {}): LocalSources => sources({ feed: feedOn(today), examPrefs: MOVED, now: clock(today), ...over });
  const makeup = (today: string, over: Partial<LocalSources> = {}) => localExamsFrom(at(today, over), '0000-00-00', today).find((e) => e.naturalKey === MAKEUP);
  const keysAndDatesOf = (exams: Exam[]) => exams.map((e) => [e.naturalKey, e.date]);

  it('is on the student\'s date through the feed\'s window and past it, in the lists, the days, the widget and the summaries', async () => {
    for (const today of ['2026-11-12', '2026-11-17', '2026-11-29']) {
      await on(today, (now) => {
        const src = at(today);
        // Listed through the 16th; from the 17th the feed no longer has it, and the copy stands in.
        expect(src.feed!.exams.some((e) => e.naturalKey === MAKEUP)).toBe(today === '2026-11-12');
        const ahead = localExamsFrom(src, today, today);
        expect(keysAndDatesOf(ahead)).toContainEqual([MAKEUP, '2026-11-30']);
        expect(ahead.find((e) => e.naturalKey === MAKEUP)).toMatchObject({ date: '2026-11-30', originalDate: '2026-11-09', subject: 'מבחן בהיסטוריה', details: null, source: 'school_site' });
        const [thirtieth] = buildLocalDays(src, ['2026-11-30']);
        expect(thirtieth!.examsToday.map((e) => e.naturalKey)).toEqual([MAKEUP]);
        expect(planMorningSummary(thirtieth!, DEFAULT_SETTINGS, ZONE)!.body).toContain('מבחן היום: היסטוריה');
        const [day] = buildLocalDays(src, [today]);
        const feed = buildWidgetFeed({ day: day!, zone: ZONE, now, openTasks: [], upcomingExams: ahead });
        expect(feed.upcomingExams!.map((e) => [e.date, e.daysAway])).toContainEqual(['2026-11-30', 30 - Number(today.slice(8))]);
        // The school's own exam that is still listed is where it was.
        expect(keysAndDatesOf(ahead)).toContainEqual(['site-exam|later', '2026-12-15']);
      });
    }
  });

  it('is gone once the student\'s own date is more than a week past', async () => {
    await on('2026-12-07', () => expect(makeup('2026-12-07')).toMatchObject({ date: '2026-11-30', originalDate: '2026-11-09' }));
    await on('2026-12-08', () => expect(makeup('2026-12-08')).toBeUndefined());
    await on('2026-12-08', () => expect(buildLocalDays(at('2026-12-08'), ['2026-11-30'])[0]!.examsToday).toEqual([]));
  });

  /** The exams the school lists once it has taken the make-up off its list. */
  const REMOVED = ALL.filter((e) => e.naturalKey !== MAKEUP);
  /** A phone whose student moved the exam on the 9th-listed day, with the copy: the prefs as stored. */
  const withCopy = () => {
    const kv = memoryKv();
    setExamDate(kv, MAKEUP, '2026-11-30', '2026-11-09', asExam(ALL[0]!));
    return kv;
  };
  /**
   * A refresh on `today` that read `read` and was given `exams` by the school: the sources as they are, then the copies
   * of what a successful read saw absent, forgotten (`forgetAbsentCopies`, as `refreshOnce` does).
   */
  const refresh = (kv: ReturnType<typeof memoryKv>, today: string, exams: ClassFeed['exams'], read: ExamSourcesRead = { school_site: true, shahaf: true }) => {
    const src = at(today, { feed: feedOn(today, exams), examPrefs: readExamPrefs(kv) });
    return forgetAbsentCopies(kv, listedExamKeys(src, today), today, read);
  };
  /** What the phone shows on `today` for `key`, from the prefs stored and the exams the school lists. */
  const shown = (kv: ReturnType<typeof memoryKv>, today: string, exams: ClassFeed['exams'], key = MAKEUP) =>
    localExamsFrom(at(today, { feed: feedOn(today, exams), examPrefs: readExamPrefs(kv) }), '0000-00-00', today).filter((e) => e.naturalKey === key);

  it('is not shown while the school\'s date is inside the window and the exam is not on its list, and not afterwards once that was seen', async () => {
    // Inside the window, with no refresh to have seen it: absent means taken off, whatever copy there is.
    const unseen = withCopy();
    expect(shown(unseen, '2026-11-12', REMOVED)).toEqual([]);
    expect(shown(unseen, '2026-11-16', REMOVED)).toEqual([]);

    // The school took it off on the 12th (day 3), and that day's refresh read the feed and saw it absent: the copy is gone for good.
    const kv = withCopy();
    const stored = refresh(kv, '2026-11-12', REMOVED);
    expect(stored.dates[MAKEUP]).toEqual({ date: '2026-11-30', sourceDate: '2026-11-09' });
    expect(readExamPrefs(kv)).toEqual(stored);
    for (const today of ['2026-11-12', '2026-11-16', '2026-11-17', '2026-11-29', '2026-12-07']) expect(shown(kv, today, REMOVED), today).toEqual([]);
    // Nor in the days, the widget's list or the mirror: it is not among the exams at all.
    await on('2026-11-17', () => {
      const src = at('2026-11-17', { feed: feedOn('2026-11-17', REMOVED), examPrefs: readExamPrefs(kv) });
      expect(buildLocalDays(src, ['2026-11-30'])[0]!.examsToday).toEqual([]);
    });
  });

  it('is shown when no refresh saw the school take it off: the removal was never observed (the limit)', () => {
    // No refresh at all between the removal and the day the school's date ages out.
    expect(shown(withCopy(), '2026-11-17', REMOVED)).toEqual([expect.objectContaining({ date: '2026-11-30', originalDate: '2026-11-09' })]);
    // A refresh that read nothing: the feed read failed, so a stored feed that lacks the exam is not an observation.
    const failed = withCopy();
    refresh(failed, '2026-11-12', REMOVED, { school_site: false, shahaf: false });
    refresh(failed, '2026-11-14', REMOVED, {});
    expect(readExamPrefs(failed).dates[MAKEUP]!.kept).toBeDefined();
    expect(shown(failed, '2026-11-17', REMOVED)).toHaveLength(1);
    // A refresh after the school's date aged out has nothing to learn from the absence: the copy's turn.
    const late = withCopy();
    refresh(late, '2026-11-17', REMOVED);
    expect(readExamPrefs(late).dates[MAKEUP]!.kept).toBeDefined();
  });

  it('is forgotten by the read of its own source alone: a Mashov read does not strip a feed copy, nor a feed read a Mashov one', () => {
    const MASHOV = 'mashov-exam|1';
    const fromMashov: Exam = { naturalKey: MASHOV, date: '2026-11-09', subject: 'מבחן בגיאוגרפיה', details: null, source: 'mashov' };
    const both = () => {
      const kv = withCopy();
      setExamDate(kv, MASHOV, '2026-11-30', '2026-11-09', fromMashov);
      return kv;
    };
    const kept = (kv: ReturnType<typeof memoryKv>) => Object.entries(readExamPrefs(kv).dates).filter(([, d]) => d.kept).map(([k]) => k);

    // Neither is listed by anyone now. Mashov alone read: its copy goes, the feed's stays.
    const byMashov = both();
    refresh(byMashov, '2026-11-12', REMOVED, { mashov: true });
    expect(kept(byMashov)).toEqual([MAKEUP]);
    // The feed alone read: the feed's copy goes, Mashov's stays.
    const byFeed = both();
    refresh(byFeed, '2026-11-12', REMOVED, { school_site: true, shahaf: true });
    expect(kept(byFeed)).toEqual([MASHOV]);
    // Both read: both go. Neither: both stay.
    const byBoth = both();
    refresh(byBoth, '2026-11-12', REMOVED, { school_site: true, shahaf: true, mashov: true });
    expect(kept(byBoth)).toEqual([]);
    const byNone = both();
    refresh(byNone, '2026-11-12', REMOVED, {});
    expect(kept(byNone)).toEqual([MAKEUP, MASHOV]);
  });

  it('shows an exam the school re-dated once: the old key\'s copy is forgotten when the new key is seen listed', () => {
    // An uploaded board's keys embed the date: re-dated on the 12th, the exam is a new key and the old one is absent.
    const title = 'מבחן בספרות';
    const OLD = uploadedExamKey('2026-11-09', title);
    const NEW = uploadedExamKey('2026-11-12', title);
    const before = [school(OLD, '2026-11-09', title)];
    const after = [school(NEW, '2026-11-12', title)];
    const studentMoved = () => {
      const kv = memoryKv();
      setExamDate(kv, OLD, '2026-11-30', '2026-11-09', asExam(before[0]!));
      return kv;
    };
    const everything = (kv: ReturnType<typeof memoryKv>, today: string) => [...shown(kv, today, after, OLD), ...shown(kv, today, after, NEW)].map((e) => [e.naturalKey, e.date]);

    // Seen on the 12th by a refresh that read the feed: the exam is on its new date, once, from then on.
    const seen = studentMoved();
    refresh(seen, '2026-11-12', after);
    expect(everything(seen, '2026-11-12')).toEqual([[NEW, '2026-11-12']]);
    expect(everything(seen, '2026-11-17')).toEqual([[NEW, '2026-11-12']]);
    // And later none: the school's own exam has aged out of the feed as every exam does, and the old key leaves nothing behind.
    expect(everything(seen, '2026-12-01')).toEqual([]);
    // Not seen: from the 17th the old key's copy would stand on the student's date beside the school's new one (the limit).
    expect(everything(studentMoved(), '2026-11-17')).toEqual([[OLD, '2026-11-30'], [NEW, '2026-11-12']]);
  });

  it('is forgotten for the own board as the phone has it, which is always known: a board that does not list the exam', () => {
    // With a board of the student's own, the school_site exams are the board's, kept on the phone: read, in a sense, at every refresh.
    const kv = withCopy();
    refresh(kv, '2026-11-12', ALL, { shahaf: false, school_site: true });
    expect(readExamPrefs(kv).dates[MAKEUP]!.kept).toBeDefined();
    refresh(kv, '2026-11-13', REMOVED, { shahaf: false, school_site: true });
    expect(readExamPrefs(kv).dates[MAKEUP]!.kept).toBeUndefined();
  });

  it('is forgotten by every entry when the class changes: none stands in from the old class', async () => {
    const kv = withCopy();
    setExamDate(kv, 'site-exam|other', '2026-12-10', '2026-11-08', asExam(school('site-exam|other', '2026-11-08', 'מבחן אחר')));
    const stored = dropKeptCopies(kv);
    // The entries and their dates stay; only the copies go.
    expect(Object.keys(stored.dates).sort()).toEqual([MAKEUP, 'site-exam|other']);
    expect(stored.dates[MAKEUP]).toEqual({ date: '2026-11-30', sourceDate: '2026-11-09' });
    expect(stored.dates['site-exam|other']).toEqual({ date: '2026-12-10', sourceDate: '2026-11-08' });
    expect(readExamPrefs(kv)).toEqual(stored);
    // A class of another school lists none of them: on the 17th nothing stands in.
    const newClass = { ...FEED, class: { ...FEED.class, classId: '8' }, exams: [school('site-exam|new', '2026-11-20', 'מבחן בכיתה החדשה')] };
    await on('2026-11-17', () => {
      const src = sources({ feed: newClass, examPrefs: readExamPrefs(kv), now: clock('2026-11-17') });
      expect(localExamsFrom(src, '0000-00-00', '2026-11-17').map((e) => e.naturalKey)).toEqual(['site-exam|new']);
    });
    // Before it, the copies would have stood in.
    expect(keptExams(readExamPrefs(withCopy()), new Set(), '2026-11-17').map((e) => e.naturalKey)).toEqual([MAKEUP]);
    // Writes nothing when no entry has a copy.
    let writes = 0;
    dropKeptCopies({ getString: kv.getString, set: (k, v) => { writes += 1; kv.set(k, v); } });
    expect(writes).toBe(0);
  });

  it('says which sources a refresh read, and whether the feed it was given counts as a read', () => {
    // The feed read stands for the site's exams and the class's board; with a board of the student's own (`ownBoard` not
    // null: whether it was observed, `ownBoardObserved`), the board stands for the latter.
    expect(examSourcesRead({ feed: true, mashov: false, ownBoard: null })).toEqual({ shahaf: true, school_site: true, mashov: false });
    expect(examSourcesRead({ feed: false, mashov: false, ownBoard: null })).toEqual({ shahaf: false, school_site: false, mashov: false });
    expect(examSourcesRead({ feed: false, mashov: true, ownBoard: true })).toEqual({ shahaf: false, school_site: true, mashov: true });

    const lesson = { date: '2026-11-17', hourIndex: 1, subject: 'מתמטיקה', teacher: null, room: null, status: 'regular' as const, startTime: null, endTime: null, substitute: null, note: null };
    const read: ClassFeed = { ...FEED, lastOkAt: '2026-11-17T08:00:00.000Z', lessons: [lesson as unknown as ClassFeed['lessons'][number]], exams: [], events: [] };
    const shownClass = { classId: FEED.class.classId };
    expect(isFeedObserved(read, shownClass)).toBe(true);
    expect(isFeedObserved({ ...read, lessons: [], exams: ALL }, shownClass)).toBe(true);
    // Nothing read: no feed, a site the server has not read yet, a feed with nothing in it.
    expect(isFeedObserved(null, shownClass)).toBe(false);
    expect(isFeedObserved({ ...read, lastOkAt: null }, shownClass)).toBe(false);
    expect(isFeedObserved({ ...read, lessons: [], exams: [], events: [] }, shownClass)).toBe(false);
  });

  it('goes through what a listed exam goes through: the student\'s name, hiding by key, and the date range on the student\'s date', async () => {
    await on('2026-11-17', () => {
      // Under the student's name, the school's kept as it was.
      const named = makeup('2026-11-17', { examPrefs: { ...MOVED, renames: { [MAKEUP]: 'ההיסטוריה שלי' } } });
      expect(named).toMatchObject({ subject: 'ההיסטוריה שלי', originalSubject: 'מבחן בהיסטוריה', date: '2026-11-30', originalDate: '2026-11-09' });
      // "לא המבחן שלי": hidden by key, on the day and in the lists.
      const hidden = { ...DEFAULT_SETTINGS, exams: { ...DEFAULT_SETTINGS.exams, hiddenKeys: [MAKEUP] } };
      expect(buildLocalDays(at('2026-11-17', { settings: hidden }), ['2026-11-30'])[0]!.examsToday).toEqual([]);
      expect(filterExams(localExamsFrom(at('2026-11-17', { settings: hidden }), '2026-11-17', '2026-11-17'), hidden).map((e) => e.naturalKey)).not.toContain(MAKEUP);
      // From a date: the student's, not the school's, which is past.
      expect(localExamsFrom(at('2026-11-17'), '2026-11-17', '2026-11-17').map((e) => e.naturalKey)).toContain(MAKEUP);
      expect(localExamsFrom(at('2026-11-17'), '2026-12-01', '2026-11-17').map((e) => e.naturalKey)).not.toContain(MAKEUP);
      // Not on the day it was moved from, nor on a day between.
      const [ninth, between] = buildLocalDays(at('2026-11-17'), ['2026-11-09', '2026-11-20']);
      expect(ninth!.examsToday.concat(between!.examsToday).map((e) => e.naturalKey)).not.toContain(MAKEUP);
      // As "המבחנים שלי" lists it: on the student's date.
      const option = examOptionsAsPublished(localExamsFrom(at('2026-11-17'), '2026-11-17', '2026-11-17'), { kept: [], hidden: [] }, DEFAULT_SETTINGS)
        .find((o) => o.naturalKey === MAKEUP);
      expect(option).toMatchObject({ date: '2026-11-30', originalDate: '2026-11-09' });
    });
  });

  it('is as it was for an entry without a copy: the exam is not shown, and nothing breaks', async () => {
    const old: ExamPrefs = { ...NO_EXAM_PREFS, dates: { [MAKEUP]: { date: '2026-11-30', sourceDate: '2026-11-09' } } };
    await on('2026-11-17', () => {
      expect(makeup('2026-11-17', { examPrefs: old })).toBeUndefined();
      expect(buildLocalDays(at('2026-11-17', { examPrefs: old }), ['2026-11-17', '2026-11-30']).flatMap((d) => d.examsToday).map((e) => e.naturalKey)).toEqual([]);
    });
    // And while the school still lists it, the entry works as ever.
    await on('2026-11-12', () => expect(makeup('2026-11-12', { examPrefs: old })).toMatchObject({ date: '2026-11-30', originalDate: '2026-11-09' }));
  });

  it('gives way to the school when it lists the exam again: its exam if the date is the same, its date if not', async () => {
    await on('2026-11-17', () => {
      // The same date, listed by a feed that still holds it (the phone's last read was before the window moved): the listed exam is the exam.
      const listed = { ...FEED, exams: [school(MAKEUP, '2026-11-09', 'מבחן בהיסטוריה, כפי שהתעדכן')] };
      expect(makeup('2026-11-17', { feed: listed })).toMatchObject({ subject: 'מבחן בהיסטוריה, כפי שהתעדכן', date: '2026-11-30', originalDate: '2026-11-09' });
      // Another date: the school's wins, and the student's has fallen.
      const moved = { ...FEED, exams: [school(MAKEUP, '2026-11-20', 'מבחן בהיסטוריה')] };
      const later = makeup('2026-11-17', { feed: moved })!;
      expect(later.date).toBe('2026-11-20');
      expect('originalDate' in later).toBe(false);
    });
  });

  it('is an exam on the school\'s date for a friend: past, as the school has it, so not among the exams a friend is told', async () => {
    await on('2026-11-17', () => {
      const forFriend = withSchoolDates(at('2026-11-17'));
      expect(localExamsFrom(forFriend, '0000-00-00', '2026-11-17').map((e) => e.naturalKey)).not.toContain(MAKEUP);
      expect(buildLocalDays(forFriend, ['2026-11-30', '2026-11-09']).flatMap((d) => d.examsToday)).toEqual([]);
    });
  });

  it('is in the chat copy on the student\'s date, in the list and on its day', async () => {
    await on('2026-11-17', (now) => {
      const snapshot = buildChatSnapshot(at('2026-11-17'), DEFAULT_CHAT_SHARES, { name: 'בית ספר', className: 'יב2' }, now.toISOString());
      expect(snapshot.exams.find((e) => e.naturalKey === MAKEUP)).toMatchObject({ date: '2026-11-30', originalDate: '2026-11-09' });
      expect(snapshot.days.find((d) => d.date === '2026-11-30')!.examsToday.map((e) => e.naturalKey)).toEqual([MAKEUP]);
    });
  });

  describe('in the phone\'s Google calendar', () => {
    const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/phone-cal/events';
    /** What an earlier run, while the school still listed it, made: the make-up on the 30th, and the later exam. */
    const MADE = [
      { id: 'ev-makeup', key: MAKEUP, summary: 'מבחן · מבחן בהיסטוריה', date: '2026-11-30' },
      { id: 'ev-later', key: 'site-exam|later', summary: 'מבחן · מבחן בפיזיקה', date: '2026-12-15' },
    ];
    const due = () => {
      const kv = memoryKv();
      kv.set('google.mirror', JSON.stringify({ calendarId: 'phone-cal', lastRunAt: null }));
      return kv;
    };
    const changes = (calls: ReturnType<typeof fakeGoogle>['calls']) => calls.filter((c) => ['POST', 'PATCH', 'DELETE'].includes(c.method) && c.url.startsWith(EVENTS));

    it('keeps its event, on the student\'s date, for as long as the exam is wanted: not removed, not made again', async () => {
      for (const today of ['2026-11-12', '2026-11-17', '2026-11-29']) {
        await on(today, async (now) => {
          const g = fakeGoogle(MADE);
          const state = await runPhoneMirror({ kv: due(), requester: g.requester, src: at(today), now });
          expect(state.lastError).toBeNull();
          expect(changes(g.calls)).toEqual([]);
          expect(state.lastResult).toEqual({ created: 0, updated: 0, removed: 0 });
        });
      }
    });

    it('makes the event on the student\'s date when there is none, from a feed that no longer has the exam', async () => {
      await on('2026-11-17', async (now) => {
        const g = fakeGoogle([MADE[1]!]);
        await runPhoneMirror({ kv: due(), requester: g.requester, src: at('2026-11-17'), now });
        const made = g.calls.filter((c) => c.method === 'POST' && c.url === EVENTS);
        expect(made.map((c) => [c.body!.summary, (c.body!.start as { date: string }).date])).toEqual([['מבחן · מבחן בהיסטוריה', '2026-11-30']]);
      });
    });

    it('leaves the event be after the date has gone by, even once the copy is dead; it goes only if the student keeps the exam out of Google', async () => {
      await on('2026-12-08', async (now) => {
        const g = fakeGoogle(MADE);
        await runPhoneMirror({ kv: due(), requester: g.requester, src: at('2026-12-08'), now });
        expect(g.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
      });
      await on('2026-11-17', async (now) => {
        const g = fakeGoogle(MADE);
        await runPhoneMirror({ kv: due(), requester: g.requester, src: at('2026-11-17', { examPrefs: { ...MOVED, calendarSkip: [MAKEUP] } }), now });
        expect(g.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`${EVENTS}/ev-makeup`]);
      });
    });
  });
});

describe('what a refresh observed of the class board, with a board of the student\'s own over it (A-I5, A-M1, L233, L234)', () => {
  const K = 'site-exam|k';
  const L = 'site-exam|l';
  const M = 'shahaf-exam|m';
  const school = (key: string, date: string, subject: string): ClassFeed['exams'][number] => ({ naturalKey: key, date, subject, details: null, source: 'school_site' });
  const TODAY = '2026-11-01';
  /** The class's feed on 1 November: from 25 October on (K's date, 20 October, has aged out of it), with L in it. */
  const FEED_NOW: ClassFeed = { ...FEED, exams: [school(L, '2026-10-28', 'מבחן בלשון'), school('site-exam|n', '2026-11-12', 'מבחן בתנ״ך')] };
  /** The student moved K (20.10 → 20.11), L (28.10 → 25.11) and the site's M (19.10 → 22.11), each with its copy. */
  const moved = () => {
    const kv = memoryKv();
    setExamDate(kv, K, '2026-11-20', '2026-10-20', { subject: 'מבחן בכימיה', details: null, source: 'school_site' });
    setExamDate(kv, L, '2026-11-25', '2026-10-28', { subject: 'מבחן בלשון', details: null, source: 'school_site' });
    setExamDate(kv, M, '2026-11-22', '2026-10-19', { subject: 'מבחן בספרות', details: null, source: 'shahaf' });
    return kv;
  };
  const shownOf = (feed: ClassFeed | null, prefs: ExamPrefs) =>
    localExamsFrom(sources({ feed, examPrefs: prefs, now: new Date(`${TODAY}T08:00:00Z`) }), '0000-00-00', TODAY).map((e) => [e.naturalKey, e.date]);

  it('counts the own board as a read of the class board only when it is rows, or a calendar read without failing, over a feed', () => {
    const rows = { kind: 'rows' as const, exams: [], savedAt: 'x' };
    const calendar = { kind: 'calendar' as const, calendarId: 'c', name: null, exams: [], readAt: '2026-11-01T07:00:00.000Z', savedAt: 'x' };
    expect(ownBoardObserved(null, true, false)).toBeNull();
    expect(ownBoardObserved({ kind: 'none', savedAt: 'x' }, true, false)).toBe(false);
    expect(ownBoardObserved(rows, true, false)).toBe(true);
    expect(ownBoardObserved(rows, false, false)).toBe(false);
    expect(ownBoardObserved(calendar, true, false)).toBe(true);
    expect(ownBoardObserved(calendar, true, true)).toBe(false);
    expect(ownBoardObserved({ ...calendar, readAt: null }, true, false)).toBe(false);
    expect(ownBoardObserved(calendar, false, false)).toBe(false);
  });

  it('says the class board was read through the own board only as the own board was observed, whatever the feed', () => {
    expect(examSourcesRead({ feed: true, mashov: false, ownBoard: null })).toEqual({ shahaf: true, school_site: true, mashov: false });
    expect(examSourcesRead({ feed: true, mashov: false, ownBoard: false })).toEqual({ shahaf: true, school_site: false, mashov: false });
    expect(examSourcesRead({ feed: false, mashov: false, ownBoard: true })).toEqual({ shahaf: false, school_site: true, mashov: false });
  });

  it('holds a fresh feed to the class on screen: another class, or the same number at another school, is no read of it', () => {
    const read: ClassFeed = { ...FEED, lastOkAt: NOW.toISOString(), exams: FEED_NOW.exams };
    expect(isFeedObserved(read, { classId: '7' })).toBe(true);
    expect(isFeedObserved(read, { classId: '7', siteUrl: null })).toBe(true);
    expect(isFeedObserved(read, { classId: '7', siteUrl: 'https://school.shahaf.site' })).toBe(true);
    expect(isFeedObserved(read, { classId: '8' })).toBe(false);
    expect(isFeedObserved(read, { classId: '7', siteUrl: 'https://other.shahaf.site' })).toBe(false);
  });

  it('the reviewer\'s probe: with the class board turned off, K (aged out, moved) is not shown, and is back on its date once the board is', () => {
    const kv = moved();
    const none = { kind: 'none' as const, savedAt: 'x' };
    const hidden = withOwnBoard(FEED_NOW, none);
    // a refresh that read the feed with the class board turned off has observed nothing of the class board
    const src = sources({ feed: hidden, examPrefs: readExamPrefs(kv), now: new Date(`${TODAY}T08:00:00Z`) });
    forgetAbsentCopies(kv, listedExamKeys(src, TODAY), TODAY, examSourcesRead({ feed: true, mashov: false, ownBoard: ownBoardObserved(none, hidden !== null, false) }));
    expect(Object.keys(readExamPrefs(kv).dates).filter((k) => readExamPrefs(kv).dates[k]!.kept).sort()).toEqual([K, L, M].sort());
    // K is not shown while the class board is off, and the site's M is, on the student's date
    expect(shownOf(hidden, readExamPrefs(kv))).toEqual([[M, '2026-11-22']]);
    // the class board back: K on the student's date again, L too (listed, and moved)
    expect(shownOf(FEED_NOW, readExamPrefs(kv))).toEqual([[M, '2026-11-22'], ['site-exam|n', '2026-11-12'], [K, '2026-11-20'], [L, '2026-11-25']].sort((a, b) => (a[1]! < b[1]! ? -1 : 1)));
  });

  it('does not show a kept copy of the class board\'s exam while a board of the student\'s own is laid, and does not delete it', () => {
    const kv = moved();
    const rows = { kind: 'rows' as const, exams: [{ naturalKey: 'site-exam|up|1', date: '2026-11-15', subject: 'מבחן שלי', details: null, source: 'school_site' as const }], savedAt: 'x' };
    const laid = withOwnBoard(FEED_NOW, rows);
    expect(shownOf(laid, readExamPrefs(kv))).toEqual([['site-exam|up|1', '2026-11-15'], [M, '2026-11-22']]);
    expect(keptExams(readExamPrefs(kv), new Set(), TODAY, { classBoardHidden: true }).map((e) => e.naturalKey)).toEqual([M]);
    expect(keptExams(readExamPrefs(kv), new Set(), TODAY).map((e) => e.naturalKey).sort()).toEqual([K, M].sort());
    expect(readExamPrefs(kv).dates[K]!.kept).toBeDefined();
  });

  it('forgets nothing of the class board through an own board over no feed, a calendar never read, or one whose read failed now', () => {
    const cases: [what: string, own: OwnBoard, feed: ClassFeed | null, failed: boolean][] = [
      ['rows over no feed', { kind: 'rows', exams: [], savedAt: 'x' }, null, false],
      ['a calendar never read', { kind: 'calendar', calendarId: 'c', name: null, exams: [], readAt: null, savedAt: 'x' }, FEED_NOW, false],
      ['a calendar whose read failed', { kind: 'calendar', calendarId: 'c', name: null, exams: [], readAt: '2026-10-01T00:00:00.000Z', savedAt: 'x' }, FEED_NOW, true],
    ];
    for (const [what, own, feed, failed] of cases) {
      const kv = moved();
      const laid = withOwnBoard(feed, own);
      const src = sources({ feed: laid, examPrefs: readExamPrefs(kv), now: new Date(`${TODAY}T08:00:00Z`) });
      forgetAbsentCopies(kv, listedExamKeys(src, TODAY), TODAY, examSourcesRead({ feed: feed !== null, mashov: false, ownBoard: ownBoardObserved(own, laid !== null, failed) }));
      expect([what, readExamPrefs(kv).dates[L]!.kept]).toEqual([what, expect.objectContaining({ subject: 'מבחן בלשון' })]);
    }
  });
});
