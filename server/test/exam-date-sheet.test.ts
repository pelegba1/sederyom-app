/**
 * "לשנות תאריך" in the sheet that shows one exam (app/src/lib/examDate.ts): who gets the button, which lines and
 * buttons a moved exam shows (and the one that would make it vanish), the exam handed to the store as its source gave
 * it, whether the school's day is asked about it, a study plan found by either date, and what is told to the class.
 */
import { describe, expect, it } from 'vitest';
import type { Exam } from '@sederyom/shared';
import { bagrutKey } from '@sederyom/shared/logic/mashov/bagrut';
import { addDays } from '@sederyom/shared/logic/time';
import {
  asksSchoolDay, canMoveExam, chooseExamDate, EXAM_DATE_COPY, examDateArea, examsToShare, examShownTime, isPlannedStudyTitle, isMovedExam,
  movedMark, movedToastText, moveExamOnPhone, sourceExamOf, studyTitlesFor,
} from '../../app/src/lib/examDate';
import { examsShareText } from '../../app/src/lib/share';
import { studyPlan, studyTask, studyTaskDue } from '../../app/src/lib/school';
import { FEED_EXAM_PAST_DAYS, keptExams, ownExam, readExamPrefs, setExamName } from '../../app/src/local/examPrefs';
import { addManualExam, readManualExams } from '../../app/src/local/manualExams';

// Wednesday 11.11.2026.
const TODAY = '2026-11-11';
const KEY = 'site-exam|english';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

/** The exam as the school's list gives it. */
const SCHOOL: Exam = { naturalKey: KEY, date: '2026-11-16', subject: 'מבחן באנגלית', details: 'פרקים 3 עד 5, 08:00', source: 'school_site' };

/** The exam as the sheet holds it after the student moved it to 19.11. */
const MOVED: Exam = { ...SCHOOL, date: '2026-11-19', originalDate: '2026-11-16' };

describe('who gets the button', () => {
  it('is every exam but one from Mashov\'s own bagrut list', () => {
    expect(canMoveExam(SCHOOL)).toBe(true);
    expect(canMoveExam({ ...SCHOOL, kind: 'manual' })).toBe(true);
    const fromMashov: Exam = { ...SCHOOL, source: 'mashov' };
    expect(canMoveExam(fromMashov)).toBe(true);
    expect(canMoveExam({ ...SCHOOL, kind: 'bagrut' })).toBe(false);
  });

  it('is not offered for a key the store would refuse, whatever kind the exam says', () => {
    expect(canMoveExam({ ...SCHOOL, naturalKey: bagrutKey(1042, 'A') })).toBe(false);
  });
});

describe('a moved exam', () => {
  it('is one from a source with a date of the source\'s own kept beside the student\'s', () => {
    expect(isMovedExam(SCHOOL)).toBe(false);
    expect(isMovedExam(MOVED)).toBe(true);
    // An exam added by hand has its stored date changed, with no layer over it.
    expect(isMovedExam({ ...MOVED, kind: 'manual' })).toBe(false);
  });

  it('says "הוזז אצלך" outside its sheet (the School list, Today and Week) by the same rule, and nothing for any other exam (V-6)', () => {
    expect(EXAM_DATE_COPY.moved).toBe('הוזז אצלך');
    expect(movedMark(MOVED)).toBe('הוזז אצלך');
    expect(movedMark(SCHOOL)).toBeNull();
    expect(movedMark({ ...MOVED, kind: 'manual' })).toBeNull();
    // the same answer as the sheet's own (`examDateArea`), for every exam above
    for (const exam of [MOVED, SCHOOL, { ...MOVED, kind: 'manual' as const }]) {
      expect(movedMark(exam) !== null).toBe(examDateArea(exam, TODAY).schoolDate !== null);
    }
  });
});

describe('the date area of the sheet', () => {
  it('offers only "לשנות תאריך" on an exam that was not moved', () => {
    expect(examDateArea(SCHOOL, TODAY)).toEqual({ canMove: true, schoolDate: null, putBack: null });
  });

  it('says the school\'s date under a moved exam and offers the way back', () => {
    expect(examDateArea(MOVED, TODAY)).toEqual({
      canMove: true,
      schoolDate: '2026-11-16',
      putBack: { label: 'להחזיר את התאריך המקורי', ask: null },
    });
  });

  it('keeps "להחזיר" while the school\'s date is inside the feed\'s week back, and changes it past that', () => {
    const edge = addDays(TODAY, -FEED_EXAM_PAST_DAYS);
    const atEdge = examDateArea({ ...MOVED, originalDate: edge }, TODAY);
    expect(atEdge.putBack).toEqual({ label: EXAM_DATE_COPY.putBack, ask: null });

    const past = examDateArea({ ...MOVED, originalDate: addDays(edge, -1) }, TODAY);
    expect(past.schoolDate).toBe(addDays(edge, -1));
    expect(past.putBack).toEqual({
      label: 'להסיר את המבחן מהתאריך הזה',
      ask: 'המבחן כבר לא בלוח של בית הספר, אז הוא ייעלם.',
    });
  });

  it('has no school\'s line and no way back for an exam added by hand', () => {
    expect(examDateArea({ ...SCHOOL, kind: 'manual' }, TODAY)).toEqual({ canMove: true, schoolDate: null, putBack: null });
  });

  it('has nothing at all for a bagrut exam from Mashov\'s own list', () => {
    expect(examDateArea({ ...SCHOOL, kind: 'bagrut' }, TODAY)).toEqual({ canMove: false, schoolDate: null, putBack: null });
  });
});

describe('what a chosen day does', () => {
  it('does nothing for the date the exam already has', () => {
    expect(chooseExamDate(SCHOOL, SCHOOL.date, TODAY)).toEqual({ do: 'nothing' });
    expect(chooseExamDate(MOVED, MOVED.date, TODAY)).toEqual({ do: 'nothing' });
    expect(chooseExamDate({ ...SCHOOL, kind: 'manual' }, SCHOOL.date, TODAY)).toEqual({ do: 'nothing' });
  });

  it('moves the exam to any other real day, with no limit to the school year', () => {
    expect(chooseExamDate(SCHOOL, '2026-11-19', TODAY)).toEqual({ do: 'move', date: '2026-11-19', ask: null });
    expect(chooseExamDate(MOVED, '2026-11-25', TODAY)).toEqual({ do: 'move', date: '2026-11-25', ask: null });
    expect(chooseExamDate(SCHOOL, '2027-03-02', TODAY)).toEqual({ do: 'move', date: '2027-03-02', ask: null });
    // A day long past is allowed while the school's date is still ahead: the student moved an upcoming exam into the past, and it stays there.
    expect(chooseExamDate(SCHOOL, '2026-01-05', TODAY)).toEqual({ do: 'move', date: '2026-01-05', ask: null });
    expect(chooseExamDate({ ...SCHOOL, kind: 'manual' }, '2026-11-19', TODAY)).toEqual({ do: 'move', date: '2026-11-19', ask: null });
  });

  describe('a day that will not hold', () => {
    // The school's date is past (6 days back); the feed reaches 7 days back, so 4.11 is the first day that holds.
    const PAST: Exam = { ...SCHOOL, date: '2026-11-05' };
    const first = addDays(TODAY, -FEED_EXAM_PAST_DAYS);

    it('asks once for a day more than a week past when the school\'s date is past too: the next refresh would undo the move', () => {
      expect(first).toBe('2026-11-04');
      expect(EXAM_DATE_COPY.staleAsk).toBe('התאריך הזה כבר עבר מזמן, אז המבחן לא יישאר בו.');
      expect(EXAM_DATE_COPY.moveAnyway).toBe('להזיז בכל זאת');
      expect(chooseExamDate(PAST, '2026-11-03', TODAY)).toEqual({ do: 'move', date: '2026-11-03', ask: EXAM_DATE_COPY.staleAsk });
      expect(chooseExamDate(PAST, '2026-01-05', TODAY)).toEqual({ do: 'move', date: '2026-01-05', ask: EXAM_DATE_COPY.staleAsk });
    });

    it('does not ask for the first day that holds, nor for a day ahead', () => {
      expect(chooseExamDate(PAST, first, TODAY)).toEqual({ do: 'move', date: first, ask: null });
      expect(chooseExamDate(PAST, '2026-11-20', TODAY)).toEqual({ do: 'move', date: '2026-11-20', ask: null });
    });

    it('does not ask for a past day while the school\'s date is still ahead, nor on the day itself', () => {
      expect(chooseExamDate(SCHOOL, '2026-10-01', TODAY)).toEqual({ do: 'move', date: '2026-10-01', ask: null });
      const today: Exam = { ...SCHOOL, date: TODAY };
      expect(chooseExamDate(today, '2026-10-01', TODAY)).toEqual({ do: 'move', date: '2026-10-01', ask: null });
    });

    it('goes by the school\'s date of a moved exam, not by the date it was moved to', () => {
      const movedFromPast: Exam = { ...SCHOOL, date: '2026-11-12', originalDate: '2026-11-02' };
      expect(chooseExamDate(movedFromPast, '2026-10-20', TODAY)).toEqual({ do: 'move', date: '2026-10-20', ask: EXAM_DATE_COPY.staleAsk });
      expect(chooseExamDate(MOVED, '2026-10-20', TODAY)).toEqual({ do: 'move', date: '2026-10-20', ask: null });
    });

    it('is not asked of an exam added by hand: its stored date is nobody\'s to undo', () => {
      expect(chooseExamDate({ ...PAST, kind: 'manual' }, '2026-10-20', TODAY)).toEqual({ do: 'move', date: '2026-10-20', ask: null });
    });
  });

  it('is the way back when a moved exam is put on the school\'s own date, asking when it would make the exam vanish', () => {
    expect(chooseExamDate(MOVED, '2026-11-16', TODAY)).toEqual({ do: 'putBack', ask: null });
    const old = { ...MOVED, originalDate: addDays(TODAY, -FEED_EXAM_PAST_DAYS - 1) };
    expect(chooseExamDate(old, old.originalDate, TODAY)).toEqual({ do: 'putBack', ask: EXAM_DATE_COPY.removeAsk });
  });

  it('does nothing for a bagrut exam', () => {
    expect(chooseExamDate({ ...SCHOOL, kind: 'bagrut' }, '2026-11-19', TODAY)).toEqual({ do: 'nothing' });
  });
});

describe('the line after a move', () => {
  it('says where the exam went, and that it is only the student\'s', () => {
    // Thursday 12.11.2026; the date pinned left to right inside the Hebrew line, as a plain string can.
    expect(movedToastText('2026-11-12')).toBe('המבחן עבר ליום חמישי ⁦12.11⁩, רק אצלך');
    expect(movedToastText('2026-11-14')).toBe('המבחן עבר לשבת ⁦14.11⁩, רק אצלך');
  });
});

describe('the exam handed to the store', () => {
  it('is the exam as its source gave it: the source\'s name and date, nothing of the student\'s', () => {
    const own = ownExam({ ...SCHOOL }, {
      renames: { [KEY]: 'בוחן באנגלית' }, calendarSkip: [], dates: { [KEY]: { date: '2026-11-19', sourceDate: '2026-11-16' } },
    });
    expect(own).toMatchObject({ subject: 'בוחן באנגלית', originalSubject: 'מבחן באנגלית', date: '2026-11-19', originalDate: '2026-11-16' });
    expect(sourceExamOf({ ...own, subjectName: 'אנגלית' })).toEqual(SCHOOL);
  });

  it('is the exam itself when it was not moved or renamed', () => {
    expect(sourceExamOf(SCHOOL)).toEqual(SCHOOL);
  });
});

describe('writing the date', () => {
  it('keeps a copy of the exam as the school gave it, so that a moved exam outlives the school\'s date', () => {
    const kv = memoryKv();
    expect(moveExamOnPhone(kv, SCHOOL, '2026-11-25')).toBe(true);
    expect(readExamPrefs(kv).dates[KEY]).toEqual({
      date: '2026-11-25',
      sourceDate: '2026-11-16',
      kept: { subject: 'מבחן באנגלית', details: 'פרקים 3 עד 5, 08:00', source: 'school_site' },
    });
    // A week and a day after the school's date, the feed lets the exam go; the phone's copy still shows it, on the school's date to be moved.
    const later = addDays('2026-11-16', FEED_EXAM_PAST_DAYS + 1);
    expect(keptExams(readExamPrefs(kv), new Set(), later)).toEqual([SCHOOL]);
  });

  it('moves it again against the school\'s date, not against the date it had been moved to', () => {
    const kv = memoryKv();
    moveExamOnPhone(kv, SCHOOL, '2026-11-19');
    // The sheet holds the exam as the student sees it now, on 19.11, the school's date in `originalDate`.
    const shown = ownExam(SCHOOL, readExamPrefs(kv));
    expect(shown.date).toBe('2026-11-19');
    moveExamOnPhone(kv, shown, '2026-11-25');
    expect(readExamPrefs(kv).dates[KEY]).toMatchObject({ date: '2026-11-25', sourceDate: '2026-11-16', kept: { subject: 'מבחן באנגלית' } });
  });

  it('keeps the source\'s name for an exam the student named, never their own', () => {
    const kv = memoryKv();
    setExamName(kv, KEY, 'בוחן באנגלית', SCHOOL.subject);
    const shown = ownExam(SCHOOL, readExamPrefs(kv));
    expect(shown.subject).toBe('בוחן באנגלית');
    moveExamOnPhone(kv, shown, '2026-11-19');
    expect(readExamPrefs(kv).dates[KEY]?.kept?.subject).toBe('מבחן באנגלית');
  });

  it('puts the exam back with null, and with the school\'s own date', () => {
    const kv = memoryKv();
    moveExamOnPhone(kv, SCHOOL, '2026-11-19');
    const shown = ownExam(SCHOOL, readExamPrefs(kv));
    expect(moveExamOnPhone(kv, shown, null)).toBe(true);
    expect(readExamPrefs(kv).dates).toEqual({});

    moveExamOnPhone(kv, SCHOOL, '2026-11-19');
    moveExamOnPhone(kv, ownExam(SCHOOL, readExamPrefs(kv)), '2026-11-16');
    expect(readExamPrefs(kv).dates).toEqual({});
  });

  it('changes the stored date of an exam added by hand, and puts nothing on top of it', () => {
    const kv = memoryKv();
    const added = addManualExam(kv, { date: '2026-11-16', subject: 'מבחן בהיסטוריה' });
    const exam: Exam = { naturalKey: added.naturalKey, date: added.date, subject: added.subject, details: null, source: 'mashov', kind: 'manual' };
    expect(moveExamOnPhone(kv, exam, '2026-11-20')).toBe(true);
    expect(readManualExams(kv)[0]?.date).toBe('2026-11-20');
    expect(readExamPrefs(kv).dates).toEqual({});
    // There is no way back for it: null changes nothing.
    expect(moveExamOnPhone(kv, { ...exam, date: '2026-11-20' }, null)).toBe(false);
    expect(readManualExams(kv)[0]?.date).toBe('2026-11-20');
  });

  it('moves no bagrut exam, and writes nothing for a day that is not a real one', () => {
    const kv = memoryKv();
    const bagrut: Exam = { naturalKey: bagrutKey(1042, 'A'), date: '2026-12-02', subject: 'אנגלית', details: null, source: 'mashov', kind: 'bagrut' };
    expect(moveExamOnPhone(kv, bagrut, '2026-12-09')).toBe(false);
    expect(moveExamOnPhone(kv, SCHOOL, '2026-02-30')).toBe(false);
    expect(moveExamOnPhone(kv, SCHOOL, 'next week')).toBe(false);
    expect(kv.map.size).toBe(0);
  });

  it('writes nothing for the date the exam already has', () => {
    const kv = memoryKv();
    expect(moveExamOnPhone(kv, SCHOOL, SCHOOL.date)).toBe(false);
    expect(kv.map.size).toBe(0);
  });
});

describe('the school\'s day', () => {
  it('is asked about an exam on the school\'s date, and not about a moved one: the school\'s slot belongs to the school\'s date', () => {
    expect(asksSchoolDay(SCHOOL)).toBe(true);
    expect(asksSchoolDay(MOVED)).toBe(false);
  });

  it('is asked about an exam added by hand, and about a bagrut exam, as before', () => {
    expect(asksSchoolDay({ ...SCHOOL, kind: 'manual' })).toBe(true);
    expect(asksSchoolDay({ ...SCHOOL, kind: 'bagrut' })).toBe(true);
  });
});

describe('the time of day', () => {
  const times = { bagrut: '14:00–15:45', slot: '08:00', details: '10:00' };

  it('is the school\'s slot, else the time in the details, for an exam on the school\'s date', () => {
    expect(examShownTime(SCHOOL, times)).toBe('08:00');
    expect(examShownTime(SCHOOL, { ...times, slot: null })).toBe('10:00');
    expect(examShownTime(SCHOOL, { ...times, slot: null, details: null })).toBeNull();
  });

  it('is none at all for a moved exam: a time the school gave belongs to the school\'s date', () => {
    expect(examShownTime(MOVED, times)).toBeNull();
    expect(examShownTime(MOVED, { ...times, slot: null })).toBeNull();
    expect(examShownTime(MOVED, { bagrut: null, slot: null, details: '10:00' })).toBeNull();
  });

  it('is the same as before for an exam added by hand, and the bagrut exam\'s own hours', () => {
    expect(examShownTime({ ...SCHOOL, kind: 'manual' }, times)).toBe('08:00');
    expect(examShownTime({ ...SCHOOL, kind: 'manual' }, { ...times, slot: null })).toBe('10:00');
    expect(examShownTime({ ...SCHOOL, kind: 'bagrut' }, times)).toBe('14:00–15:45');
    expect(examShownTime({ ...SCHOOL, kind: 'bagrut' }, { ...times, bagrut: null })).toBeNull();
  });
});

describe('a study plan', () => {
  const like = (exam: Exam) => ({ naturalKey: exam.naturalKey, date: exam.date, subject: exam.subject, originalSubject: exam.originalSubject });

  it('is looked for under the school\'s date as well as under the student\'s once the exam is moved', () => {
    expect(studyTitlesFor(like(SCHOOL), SCHOOL.originalDate, TODAY)).toEqual([studyTask(like(SCHOOL), TODAY).title]);
    const titles = studyTitlesFor(like(MOVED), MOVED.originalDate, TODAY);
    expect(titles).toEqual([studyTask(like(MOVED), TODAY).title, studyTask(like(SCHOOL), TODAY).title]);
    expect(titles[0]).not.toBe(titles[1]);
  });

  it('is found when it was made before the move, so that a second one is not offered', () => {
    const before = studyTask(like(SCHOOL), TODAY).title;
    const titles = studyTitlesFor(like(MOVED), MOVED.originalDate, TODAY);
    expect(isPlannedStudyTitle(before, titles)).toBe(true);
    expect(isPlannedStudyTitle(`${before.replace(/, \d+\.\d+$/, '')}, 16.11 (2/3)`, titles)).toBe(true);
    // Not offered for the unmoved exam either way, as before.
    expect(isPlannedStudyTitle(before, studyTitlesFor(like(SCHOOL), undefined, TODAY))).toBe(true);
  });

  it('is found when it was made after the move, on the student\'s date', () => {
    const after = studyTask(like(MOVED), TODAY).title;
    expect(isPlannedStudyTitle(after, studyTitlesFor(like(MOVED), MOVED.originalDate, TODAY))).toBe(true);
  });

  it('is not found for another exam\'s plan, nor for a title that is not a study task', () => {
    const titles = studyTitlesFor(like(MOVED), MOVED.originalDate, TODAY);
    const other = studyTask({ ...like(SCHOOL), subject: 'מבחן במתמטיקה' }, TODAY).title;
    expect(isPlannedStudyTitle(other, titles)).toBe(false);
    expect(isPlannedStudyTitle('להחזיר ספר לספרייה', titles)).toBe(false);
  });

  it('a plan made after the move counts back from the student\'s date', () => {
    const [session] = studyPlan(like(MOVED), TODAY, 1);
    expect(session?.due).toBe(studyTaskDue('2026-11-19', TODAY));
    expect(session?.due).toBe('2026-11-17');
    expect(session?.title).toContain('19.11');
  });
});

describe('what is told to the class', () => {
  const later: Exam = { naturalKey: 'site-exam|physics', date: '2026-11-18', subject: 'מבחן בפיזיקה', details: null, source: 'school_site' };

  it('is chosen by the school\'s dates: an exam moved into the past is still ahead for the class, one moved ahead from the past is not', () => {
    const movedEarlier: Exam = { ...SCHOOL, date: '2026-11-09', originalDate: '2026-11-16' };
    const movedAhead: Exam = { ...later, naturalKey: 'site-exam|history', date: '2026-11-20', originalDate: '2026-11-04' };
    const shared = examsToShare([movedEarlier, movedAhead, later], TODAY);
    expect(shared.map((e) => e.naturalKey)).toEqual([KEY, 'site-exam|physics']);
  });

  it('keeps an exam on the day it is, and drops one the day before', () => {
    const exams = [{ ...later, date: TODAY }, { ...later, naturalKey: 'x', date: addDays(TODAY, -1) }];
    expect(examsToShare(exams, TODAY).map((e) => e.naturalKey)).toEqual(['site-exam|physics']);
  });

  it('gives the text the school\'s date for a moved exam', () => {
    const text = examsShareText(examsToShare([MOVED], TODAY), TODAY, { className: 'יב2', link: 'https://example.test' });
    expect(text).toContain('16.11');
    expect(text).not.toContain('19.11');
  });
});
