/**
 * "לשנות תאריך" in the sheet that shows one exam: the student moves the exam to another day for themselves alone, and
 * puts it back. The storage is `local/examPrefs.ts` (an exam from a source) and `local/manualExams.ts` (one the student
 * added); this file holds what the sheet decides by, in plain functions, so tests can load it:
 *
 * - who gets the button (`canMoveExam`), and which lines and buttons a moved exam shows (`examDateArea`), among them
 *   the one that would make an exam vanish when the school's date is long past (`EXAM_DATE_COPY.remove`);
 * - what a chosen day does (`chooseExamDate`) and what is written for it (`moveExamOnPhone`), the exam handed to the
 *   store as its source gave it (`sourceExamOf`);
 * - the school's day, which belongs to the school's date, so a moved exam is not asked about it (`asksSchoolDay`);
 * - a study plan made before the move is still this exam's (`studyTitlesFor`, `isPlannedStudyTitle`);
 * - what is told to the class, which is the school's date (`examsToShare`).
 *
 * The student's date lives on the phone only; nothing here is sent to the server.
 */
import type { DateStr, Exam } from '@sederyom/shared';
import { isBagrutKey } from '@sederyom/shared/logic/mashov/bagrut';
import { addDays } from '@sederyom/shared/logic/time';
import { FEED_EXAM_PAST_DAYS, isDeadExamDate, setExamDate } from '../local/examPrefs';
import { setManualExamDate, type KV } from '../local/manualExams';
import { formatShortDate, weekdayName } from './format';
import { validDate } from './planner';
import { isStudyTaskTitle, studyTask } from './school';

/** Every word "לשנות תאריך" adds to the sheet. */
export const EXAM_DATE_COPY = {
  move: 'לשנות תאריך',
  putBack: 'להחזיר את התאריך המקורי',
  /** In the place of `putBack` when the school's date is gone from its list: putting the exam back would take it away. */
  remove: 'להסיר את המבחן מהתאריך הזה',
  removeAsk: 'המבחן כבר לא בלוח של בית הספר, אז הוא ייעלם.',
  removeYes: 'להסיר',
  /** Asked before a move to a day that the next refresh would undo (`isDeadExamDate`). */
  staleAsk: 'התאריך הזה כבר עבר מזמן, אז המבחן לא יישאר בו.',
  moveAnyway: 'להזיז בכל זאת',
  cancel: 'ביטול',
  /** The muted line under a moved exam's date, before the school's date. */
  schoolLead: 'בלוח של בית הספר: ',
  /** Beside a moved exam's date or title outside its sheet: the School list, Today's next exam, Week's day (`movedMark`). */
  moved: 'הוזז אצלך',
} as const;

/** The isolate pair `Ltr` puts around a date, for a plain string (a toast) that has no component to wrap it. */
const LTR_START = '⁦';
const LTR_END = '⁩';

type Kinded = Pick<Exam, 'kind'> & Partial<Pick<Exam, 'naturalKey'>>;

/**
 * Whether the sheet offers "לשנות תאריך": every exam but one from Mashov's own bagrut list (the Ministry's sitting).
 * A hidden one ("לא המבחן שלי") can still be moved: the hide-list is no part of the exam.
 */
export function canMoveExam(exam: Kinded): boolean {
  return exam.kind !== 'bagrut' && !(exam.naturalKey !== undefined && isBagrutKey(exam.naturalKey));
}

/**
 * An exam from a source that the student moved: it holds the source's date in `originalDate`. One added by hand has its
 * stored date changed, with no layer over it, and is never a moved exam.
 */
export function isMovedExam<E extends Pick<Exam, 'kind' | 'originalDate'>>(exam: E): exam is E & { originalDate: DateStr } {
  return exam.kind !== 'manual' && exam.originalDate !== undefined;
}

/**
 * "הוזז אצלך" beside a moved exam where it is listed outside its own sheet (the School list, Today's next exam, Week's
 * day), or `null`: by the rule the sheet knows a moved exam by (`isMovedExam`), so the two never disagree (V-6).
 */
export function movedMark(exam: Pick<Exam, 'kind' | 'originalDate'>): string | null {
  return isMovedExam(exam) ? EXAM_DATE_COPY.moved : null;
}

/** Whether putting a moved exam back would make it vanish: the school's date is past the feed's week back, and its list has let the exam go. */
function wouldVanish(schoolDate: DateStr, today: DateStr): boolean {
  return schoolDate < addDays(today, -FEED_EXAM_PAST_DAYS);
}

/** What the sheet's date area shows besides the date itself. */
export interface ExamDateArea {
  /** "לשנות תאריך" is offered. */
  canMove: boolean;
  /** The muted line "בלוח של בית הספר: …" under the date, with the school's date; `null` when the exam is not moved. */
  schoolDate: DateStr | null;
  /** The button that takes the student's date away, and the question it asks first (`null`: none); `null` when the exam is not moved. */
  putBack: { label: string; ask: string | null } | null;
}

export function examDateArea(exam: Pick<Exam, 'kind' | 'naturalKey' | 'originalDate'>, today: DateStr): ExamDateArea {
  if (!canMoveExam(exam)) return { canMove: false, schoolDate: null, putBack: null };
  if (!isMovedExam(exam)) return { canMove: true, schoolDate: null, putBack: null };
  const putBack = wouldVanish(exam.originalDate, today)
    ? { label: EXAM_DATE_COPY.remove, ask: EXAM_DATE_COPY.removeAsk }
    : { label: EXAM_DATE_COPY.putBack, ask: null };
  return { canMove: true, schoolDate: exam.originalDate, putBack };
}

/**
 * What a day tapped on the calendar does: nothing, move the exam there, or (the school's own date) put it back. The
 * move and the way back may ask first (`ask`, the question; `null`: none).
 */
export type DateChoice = { do: 'nothing' } | { do: 'move'; date: DateStr; ask: string | null } | { do: 'putBack'; ask: string | null };

/**
 * The date the exam has already does nothing. The school's own date, for a moved exam, is the way back (the same
 * question first as the button asks, when the exam would vanish); any other real day moves it, with no limit to the
 * school year, asking once when the next refresh would undo the move (`isDeadExamDate`: the day is more than a week
 * past and the school's date is past too). An exam added by hand has no refresh to undo it.
 */
export function chooseExamDate(
  exam: Pick<Exam, 'kind' | 'naturalKey' | 'date' | 'originalDate'>, picked: DateStr, today: DateStr,
): DateChoice {
  if (!canMoveExam(exam) || picked === exam.date) return { do: 'nothing' };
  if (isMovedExam(exam) && picked === exam.originalDate) {
    return { do: 'putBack', ask: wouldVanish(exam.originalDate, today) ? EXAM_DATE_COPY.removeAsk : null };
  }
  const wontHold = exam.kind !== 'manual' && isDeadExamDate(picked, exam.originalDate ?? exam.date, today);
  return { do: 'move', date: picked, ask: wontHold ? EXAM_DATE_COPY.staleAsk : null };
}

/** "המבחן עבר ליום רביעי 12.11, רק אצלך": the line in the sheet after a move, the date pinned left to right as `Ltr` pins it. */
export function movedToastText(date: DateStr): string {
  return `המבחן עבר ל${weekdayName(date)} ${LTR_START}${formatShortDate(date)}${LTR_END}, רק אצלך`;
}

/**
 * The exam as its source gave it: the sheet holds it under the student's name and on their date (`ownExam`), and the
 * copy the store keeps for the days the source's list no longer carries it (`setExamDate`) is of the source's.
 */
export function sourceExamOf(exam: Exam): Exam {
  const { originalSubject, originalDate, subjectName: _subjectName, ...rest } = exam;
  return { ...rest, subject: originalSubject ?? exam.subject, date: originalDate ?? exam.date };
}

/**
 * Moves the exam to `date` for the student alone, or (`null`) puts it back on its source's date; the phone's own word
 * on it, kept on the phone. An exam from a source gets an entry against its source's date, with a copy of the exam as
 * the source gave it, or a moved exam would vanish a week after the school's date; one added by hand has its stored
 * date changed. Whether anything was written: not for the date the exam already has, a day that is not a real one,
 * a bagrut exam, nor a way back for an exam that was not moved (or was added by hand).
 */
export function moveExamOnPhone(kv: KV, exam: Exam, date: DateStr | null): boolean {
  if (!canMoveExam(exam)) return false;
  if (date !== null && (!validDate(date) || date === exam.date)) return false;
  if (exam.kind === 'manual') return date !== null && setManualExamDate(kv, exam.naturalKey, date) !== null;
  if (date === null && !isMovedExam(exam)) return false;
  setExamDate(kv, exam.naturalKey, date, exam.originalDate ?? exam.date, sourceExamOf(exam));
  return true;
}

/**
 * Whether the school's day is asked about the exam, for the periods it takes and its time ("שיעורים 1–2, 08:00"), or
 * for "השעה עוד לא פורסמה": not for a moved exam, since what the school publishes is for the school's date, not the
 * student's. (And no time at all is shown for it: `examShownTime`.)
 */
export function asksSchoolDay(exam: Pick<Exam, 'kind' | 'originalDate'>): boolean {
  return !isMovedExam(exam);
}

/**
 * The time of day shown for an exam, from the places one may come from: a bagrut exam's own hours (`bagrut`); else the
 * school's slot for its day (`slot`), else the time in the exam's details (`details`). None at all for a moved exam:
 * what the school published, in its day or in its details, is for the school's date, and beside the student's date it
 * would read as the student's time. (The details text itself, with the time as words, is shown unchanged.)
 */
export function examShownTime(
  exam: Pick<Exam, 'kind' | 'originalDate'>, times: { bagrut: string | null; slot: string | null; details: string | null },
): string | null {
  if (exam.kind === 'bagrut') return times.bagrut;
  if (!asksSchoolDay(exam)) return null;
  return times.slot ?? times.details;
}

type StudyExam = Parameters<typeof studyTask>[0];

/**
 * The titles a study task of this exam may have: `exam` is on the student's date, and a moved exam's tasks made before
 * the move have the school's (`originalDate`) in their title. A new plan counts back from the student's date.
 */
export function studyTitlesFor(exam: StudyExam, originalDate: DateStr | undefined, today: DateStr): string[] {
  const own = studyTask(exam, today).title;
  if (originalDate === undefined || originalDate === exam.date) return [own];
  return [own, studyTask({ ...exam, date: originalDate }, today).title];
}

/** Whether a task is a study task of the exam (or one session of its plan) under any of its titles (`studyTitlesFor`). */
export function isPlannedStudyTitle(title: string, singles: readonly string[]): boolean {
  return singles.some((single) => isStudyTaskTitle(title, single));
}

/**
 * The exams offered for "send to the group": those still ahead by the school's date. The text tells the class the
 * school's date (`examsShareText`), whatever day the student moved the exam to.
 */
export function examsToShare<E extends Pick<Exam, 'date' | 'originalDate'>>(exams: readonly E[], today: DateStr): E[] {
  return exams.filter((e) => (e.originalDate ?? e.date) >= today);
}
