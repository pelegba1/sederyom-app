/**
 * The exam board, as the screens decide by it (design doc, "לוח משלי, כשלכיתה כבר יש לוח" and "באפליקציה"):
 * whose board a phone is looking at, where a new one is saved, the line that says so, what is selected in a
 * preview, and what to tell the student when the server or the network says no.
 *
 * Also what the confirm screen decides ("מסך האישור"): the preview's next step, the selection on the screen and its
 * transitions, what is saved, and whether the save button is on. All of it is pure, so a test runs it without a screen.
 *
 * Pure: type-only imports from the app, and from outside it only `./format` and the shared calendar logic (both run on
 * a phone and on the server), so `server/test` and `app/test` can load it without React Native (and the server's
 * typecheck, which reads the tests, does not reach into the app's components through it). The calls themselves
 * are in `device/v2.ts`, the screens in `components/ExamBoard.tsx` and `components/ExamBoardConfirm.tsx`.
 */
import type {
  BoardRow, BoardSkipped, CalendarPreview, DateStr, DeviceClass, ExamBoardError, ExamBoardInfo, ExamBoardPreview, SaveExamBoardBody,
} from '@sederyom/shared';
import { schoolYearOf } from '@sederyom/shared/logic/exam-board/calendar';
import { BOARD_ROWS_MAX, BOARD_TITLE_MAX } from '@sederyom/shared/logic/exam-board/rows';
import type { V2Error } from '../device/v2';
import type { OwnBoard, OwnCalendarBoard, OwnNoBoard, OwnRowsBoard } from '../local/ownBoard';
import { formatShortDate, isolateName, plural, toDateStr } from './format';

/**
 * Whose board the phone shows:
 * - `none`: the class has no board, and the phone has not chosen one of its own;
 * - `class-mine`: the class's board, which this device brought;
 * - `class-open`: the class's board, which another device brought and which this one may replace now (the one
 *   that brought it no longer follows the class);
 * - `class-other`: the class's board, which another device brought and this one may not replace;
 * - `own`: a board of the phone's own, kept only on it;
 * - `own-none`: the person turned the class's board off for themselves.
 */
export type BoardOwner = 'none' | 'class-mine' | 'class-open' | 'class-other' | 'own' | 'own-none';

/**
 * The phone's own board, as far as whose board it is shown goes (`local/ownBoard.ts` keeps it): `rows` and `calendar`
 * are a board of the person's own, `none` is the class's board turned off.
 */
export type OwnBoardLike = Pick<OwnBoard, 'kind'>;

/**
 * The phone's own board, as far as the line that says what it is needs to know it: what it holds, for rows when they
 * were kept, and for a calendar whether it was ever read.
 */
export type OwnBoardFacts = Pick<OwnRowsBoard, 'kind' | 'exams' | 'savedAt'> | Pick<OwnCalendarBoard, 'kind' | 'exams' | 'readAt'> | Pick<OwnNoBoard, 'kind'>;

/**
 * The phone's own board as the block takes it: "בלי הלוח של הכיתה" (`none`) over a class that has no board (or a class
 * the phone has not read) hides nothing, and is no board of the phone's own: the block shows what a class with no board
 * shows (A-M5). The next refresh that sees the class with no board removes it (`dropNoneOverNoBoard`).
 */
export function shownOwnBoard<B extends OwnBoardLike>(cls: DeviceClass | null | undefined, own: B | null): B | null {
  return own?.kind === 'none' && !classHasBoard(cls) ? null : own;
}

/**
 * The board the phone shows. The phone's own choice comes first, whatever the class has (but `shownOwnBoard`). A class with a calendar
 * and no `examBoard` is one an older server described: its calendar is somebody else's as far as this phone knows.
 * `mine` and `mayChange` are two facts, not one: a classmate may replace a board whose setter has left, though it
 * is not theirs, and the one that brought it may be unable to replace it (it follows another class now).
 */
export function boardOwner(cls: DeviceClass | null | undefined, own: OwnBoardLike | null): BoardOwner {
  const shown = shownOwnBoard(cls, own);
  if (shown) return shown.kind === 'none' ? 'own-none' : 'own';
  const info = cls?.examBoard;
  if (info) {
    if (info.mine) return 'class-mine';
    return info.mayChange ? 'class-open' : 'class-other';
  }
  return cls?.examCalendarId ? 'class-other' : 'none';
}

/**
 * Where a board that is about to be saved goes by default, and whether the person may choose the other place:
 * for the class, for everyone in it, or for themselves only.
 */
export function saveTarget(owner: BoardOwner, info: ExamBoardInfo | null): { target: 'class' | 'own'; choice: boolean } {
  switch (owner) {
    case 'none':
      return { target: 'class', choice: false };
    case 'class-mine':
      // The board is theirs, but a save for the class is let through only when `mayChange` says so.
      return info?.mayChange ? { target: 'class', choice: true } : { target: 'own', choice: false };
    case 'class-open':
      return { target: 'own', choice: true };
    case 'class-other':
    case 'own':
    case 'own-none':
      return { target: 'own', choice: false };
  }
}

/** Whether the class has a board, its own or the calendar an older server described, whatever the phone shows over it. */
export function classHasBoard(cls: DeviceClass | null | undefined): boolean {
  return Boolean(cls?.examBoard) || Boolean(cls?.examCalendarId);
}

/**
 * Where a board that is brought now goes, by the phone's own board and the class underneath it (`saveTarget` for the
 * class as it would be without the phone's board, so that someone who brought the class's board, or may replace it,
 * can still choose to update it for everyone). With no board of its own the phone is the class's: `saveTarget`.
 * Someone who holds one comes to change what they have, so it is theirs by default, with the choice wherever the class
 * may be changed: the board of the class that this device brought or may replace, and a class with no board (its board
 * was removed while they held their own; a phone with no class read has none to give). A save for the class then ends
 * their own board (`replacesOwnBoard`), or they would go on looking at it. With the class's board turned off the board
 * is for the person alone, with nothing to choose.
 */
export function bringTarget(cls: DeviceClass | null | undefined, ownBoard: OwnBoardLike | null): { target: 'class' | 'own'; choice: boolean } {
  const own = shownOwnBoard(cls, ownBoard);
  const owner = boardOwner(cls, null);
  const underneath = saveTarget(owner, cls?.examBoard ?? null);
  if (own === null) return underneath;
  if (own.kind === 'none') return { target: 'own', choice: false };
  return { target: 'own', choice: underneath.choice || (owner === 'none' && Boolean(cls)) };
}

/** Whether the phone holds a board of its own (a file's rows or a calendar), not the class's board turned off. */
export function holdsOwnBoard(own: OwnBoardLike | null): boolean {
  return own !== null && own.kind !== 'none';
}

/**
 * Whether an exam the phone shows is one of its own board's, for the sheet that says where an exam came from (V-2): an
 * exam of the exam schedule (`school_site`) whose key the own board holds. The own board lays its exams in place of the
 * class's (`withOwnBoard`), so this one is not the class's, even where the class's board gives the same key. Every other
 * `school_site` exam is the class's board's: the server fills that source from the class's board alone.
 */
export function isOwnBoardExam(exam: { naturalKey: string; source?: string }, own: OwnBoard | null): boolean {
  if (exam.source !== 'school_site' || own === null || own.kind === 'none') return false;
  return own.exams.some((e) => e.naturalKey === exam.naturalKey);
}

/**
 * Whether a board that was just saved takes the person's own board with it: one saved for the class, by someone who holds
 * a board of their own. The own board hides the class's board on their phone, so it ends once the class save went
 * through (and not if it failed), or they would look at the same list and not see what they saved.
 */
export function replacesOwnBoard(saved: 'class' | 'own', own: OwnBoardLike | null): boolean {
  return saved === 'class' && holdsOwnBoard(own);
}

/** Whoever brought the class's board: a student or a parent, so neither is named; true on a parent's phone too. */
const SHARED_BY_A_CLASSMATE = 'מישהו מהכיתה הוסיף את הלוח הזה, והוא משותף לכל הכיתה';

/**
 * The line that says whose the board is, or `null` when there is none. Never a name, never "a student". `hasBoard`:
 * the class has a board (`classHasBoard`), which a board of the person's own is shown in place of.
 */
export function sourceLine(owner: BoardOwner, hasBoard: boolean): string | null {
  switch (owner) {
    case 'none':
      return null;
    case 'class-other':
    case 'class-open':
      return SHARED_BY_A_CLASSMATE;
    case 'class-mine':
      return 'הוספת את הלוח הזה, והוא משותף לכל הכיתה';
    case 'own':
      return hasBoard ? 'הלוח הזה שלך בלבד, ומוצג אצלך במקום הלוח של הכיתה' : 'הלוח הזה שלך בלבד';
    case 'own-none':
      return 'הלוח של הכיתה מוסתר אצלך';
  }
}

/**
 * The line at the top of the School screen's exams tab, where the class's push about a new board lands: whose the board
 * is, when the class has one or the phone has one of its own; `null` otherwise. `cls`: the class as the phone last read
 * it; `own`: the phone's own board. Not `sourceLine`'s words: the tab shows no board, only a list, which may hold the
 * site's own exams too, so nothing there is "הלוח הזה" (V-5).
 */
export function examsTabSourceLine(cls: DeviceClass | null | undefined, own: OwnBoardLike | null): string | null {
  switch (boardOwner(cls, own)) {
    case 'none':
      return null;
    case 'class-mine':
      return 'לוח המבחנים שהוספת משותף לכל הכיתה';
    case 'class-other':
    case 'class-open':
      return 'מישהו מהכיתה הוסיף לוח מבחנים, והוא משותף לכל הכיתה';
    case 'own':
      return classHasBoard(cls) ? 'מוצג כאן לוח מבחנים שלך בלבד, במקום הלוח של הכיתה' : 'מוצג כאן לוח מבחנים שלך בלבד';
    case 'own-none':
      return 'הלוח של הכיתה מוסתר אצלך';
  }
}

/**
 * Whether onboarding's exams step offers to bring a board: the class has no exam to show (`published`, the step's own
 * count) and nobody has brought it a board. A class that has a board with no upcoming exam in it is not offered one:
 * the step says whose the board is instead, and a new one is brought from "המבחנים שלי".
 */
export function examStepOffersBoard(published: number, owner: BoardOwner): boolean {
  return published === 0 && owner === 'none';
}

/**
 * What a preview starts with selected: the rows that look like exams, from `today` on. An exam whose day is gone is not
 * ticked (V-11: a board read in November held as many past exams as ahead); the person may tick it.
 */
export function previewSelection(rows: readonly BoardRow[], today: DateStr): boolean[] {
  return rows.map((row) => row.isExam && row.date >= today);
}

/** The words for each reason a preview or a save is refused (`ExamBoardError`), to the student. */
const REFUSALS: Record<Exclude<ExamBoardError, 'no_class'>, string> = {
  unreachable: 'לא הצלחנו לפתוח את הקישור, כדאי לבדוק שהוא נכון ולנסות שוב בעוד רגע.',
  // In the words of the button beside the link, "לבחור קובץ אקסל".
  no_board: 'לא מצאנו לוח מבחנים בדף הזה, אפשר לנסות קישור אחר או לבחור קובץ אקסל.',
  private_sheet: 'הגיליון הזה לא משותף לכולם, אפשר להוריד אותו כקובץ אקסל ולבחור את הקובץ.',
  // A file that was picked; a link that leads to such a file has its own sentence (`previewProblem`).
  unsupported_file: 'אפשר לבחור רק קובץ אקסל מסוג xlsx.',
  // One code for a linked page, a file over its size, too many rows and too many cells: no figure, and no noun for what was big.
  too_big: 'הלוח גדול מדי ולא הצלחנו לקרוא אותו. אפשר לנסות קובץ קטן יותר.',
  unknown_layout:
    'לא זיהינו בקובץ לוח מבחנים. אנחנו קוראים שני מבנים: שורה לכל מבחן עם עמודה של תאריך, או טבלה עם שורה לכל תאריך ועמודה לכל כיתה.',
  rate_limited: 'ניסית יותר מדי פעמים בשעה האחרונה, אפשר לנסות שוב בעוד קצת.',
  bad_rows: 'חלק מהשורות לא תקינות, כדאי לבדוק את התאריכים והשמות ולנסות שוב.',
};

/**
 * Said when the exam board or the exam calendar link needs a class and the phone follows none. `mePage`: the
 * title of the settings page where a class is picked (`mePageTitle` in `lib/onboarding`, which is the screen's
 * to pass: it depends on whose phone this is); without it the sentence stops at "בהגדרות".
 */
export function pickClassFirst(mePage?: string): string {
  return mePage ? `קודם צריך לבחור כיתה בהגדרות, ב״${mePage}״.` : 'קודם צריך לבחור כיתה בהגדרות.';
}

/** A class save the lock refused (403): the class has a board already, and the sheet saves this one for the person alone (`saveFailed`). */
const LOCKED = 'לכיתה כבר יש לוח, אז הלוח הזה יישמר רק אצלך.';
const NOT_YET = 'זה עוד לא זמין, כדאי לנסות שוב בעוד כמה ימים.';
const WENT_WRONG = 'משהו השתבש, כדאי לנסות שוב בעוד רגע.';
const NO_CONNECTION = 'לא הצלחנו להתחבר, כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.';
const NO_ANSWER = 'השרת לא ענה בזמן, כדאי לנסות שוב בעוד רגע.';
/** A calendar kept "רק אצלי" whose first read, from the phone, failed: it was not kept (`OwnCalendarUnreadError`). */
const CALENDAR_UNREAD = 'לא הצלחנו לקרוא את היומן מהטלפון. אפשר לנסות שוב בעוד רגע.';

/**
 * The phone could not write the board it keeps (its storage threw). Nothing was sent anywhere, so `boardProblem` does not
 * speak of a connection. Told by its name, as a `V2Error` is.
 */
export class OwnBoardError extends Error {
  constructor() {
    super('the phone could not keep the exam board');
    this.name = 'OwnBoardError';
  }
}

/** `err` as a `V2Error`: by its name and its status, so that this file loads without the device module (and React Native with it). */
function asV2Error(err: unknown): Pick<V2Error, 'status' | 'code'> | null {
  if (!(err instanceof Error) || err.name !== 'V2Error') return null;
  const { status, code } = err as V2Error;
  return typeof status === 'number' ? { status, code } : null;
}

/** The call was given up on (`TIMEOUT_MS` aborts it): `fetch` rejects with an `AbortError`, a `DOMException` on some runtimes. */
function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** The lock's refusal: a 403, or its code (`calendar_locked`) whatever the status. */
function isLocked(failure: Pick<V2Error, 'status' | 'code'>): boolean {
  return failure.status === 403 || failure.code === 'calendar_locked';
}

function isRefusal(code: string | undefined): code is Exclude<ExamBoardError, 'no_class'> {
  return code !== undefined && Object.prototype.hasOwnProperty.call(REFUSALS, code);
}

/**
 * One short sentence for what went wrong with a preview or a save, to the student: the server's refusal by its
 * `code` (never by the server's own sentence, which is only a fallback for other clients), a route an older
 * server does not have (404), and a call that did not reach the server at all (no network, or no answer in
 * time), a board the phone could not keep (`OwnBoardError`), and a calendar kept for the phone alone that the
 * phone could not read (`OwnCalendarUnreadError`). `mePage`: see `pickClassFirst`, for `no_class`.
 */
export function boardProblem(err: unknown, mePage?: string): string {
  if (err instanceof Error && err.name === 'OwnBoardError') return WENT_WRONG;
  if (err instanceof Error && err.name === 'OwnCalendarUnreadError') return CALENDAR_UNREAD;
  const failure = asV2Error(err);
  if (!failure) return isAbort(err) ? NO_ANSWER : NO_CONNECTION;
  const { status, code } = failure;
  if (status === 404) return NOT_YET;
  if (isLocked(failure)) return LOCKED;
  if (status === 429) return REFUSALS.rate_limited;
  if (code === 'no_class') return pickClassFirst(mePage);
  if (isRefusal(code)) return REFUSALS[code];
  return WENT_WRONG;
}

/** A pasted link the server followed to a file it does not read (a PDF, a picture): not the picked file's sentence (V-12). */
const LINK_UNSUPPORTED = 'הקישור מוביל לקובץ שאי אפשר לקרוא. אפשר לבחור קובץ אקסל מסוג xlsx.';

/**
 * What went wrong with a preview, by what was read (`source`, the same for a column picked after it): a link that leads
 * to a file that cannot be read says so of the link; everything else is `boardProblem`'s.
 */
export function previewProblem(err: unknown, source: BoardSource, mePage?: string): string {
  const failure = asV2Error(err);
  if ('link' in source && failure?.code === 'unsupported_file') return LINK_UNSUPPORTED;
  return boardProblem(err, mePage);
}

// ---------------------------------------------------------------------------------------------------------------------
// A file, before it is read

/** The most a file may weigh, as the server takes it (1 MB): a bigger one is not read, nor sent. */
export const BOARD_FILE_MAX_BYTES = 1_048_576;

/**
 * Whether a picked file can be sent at all, from its name and its size alone (nothing of its content is read yet):
 * `unsupported` for anything that does not end in `.xlsx` (any case), else `too_big` over 1 MB. The kind of file
 * comes first: a scan of 5 MB is not a file that is too big, it is not a board.
 */
export function boardFileProblem(name: string, size: number): 'unsupported' | 'too_big' | null {
  if (!name.toLowerCase().endsWith('.xlsx')) return 'unsupported';
  return size > BOARD_FILE_MAX_BYTES ? 'too_big' : null;
}

/** The sentence for a file that `boardFileProblem` refused: the server's own, since it would refuse it in the same words. */
export function fileProblemSentence(problem: 'unsupported' | 'too_big'): string {
  return problem === 'unsupported' ? REFUSALS.unsupported_file : REFUSALS.too_big;
}

/** Said when a file was picked and could not be opened or read: nothing was sent, so not a word about the connection. */
export const FILE_UNREADABLE = 'לא הצלחנו לקרוא את הקובץ, אפשר לנסות קובץ אחר.';

// ---------------------------------------------------------------------------------------------------------------------
// After a preview: what the student does next

/** What is read: the link as typed, or the Excel file as the picker gave it. A column pick reads it again, so it is kept. */
export type BoardSource = { link: string } | { file: { name: string; base64: string } };

/** The name of the file that was picked, to show what is being checked (V-18); `null` for a link, which the field still shows. */
export function boardSourceName(source: BoardSource): string | null {
  return 'file' in source ? source.file.name : null;
}

/**
 * "הקובץ: grade9-list.xlsx", the line that shows a picked file's name: the Hebrew word first, so that the line is a
 * Hebrew one on every platform (a line of a Latin name alone sat on the left on the web), and the name in a first-strong
 * isolate, so that a Latin name keeps its order and pulls nothing around it (V-18).
 */
export function fileNameLine(name: string): string {
  return `הקובץ: ${isolateName(name)}`;
}

/** What the confirm screen shows: one Google calendar (the one picked, when there were several), or the rows of a file or a sheet. */
export type BoardChoice =
  | { kind: 'calendar'; calendar: CalendarPreview }
  | { kind: 'rows'; layout: 'list' | 'grid'; rows: BoardRow[]; skipped: BoardSkipped[] };

/** The next step after a preview: nothing found, a choice to make, or the screen that confirms. */
export type PreviewStep =
  | { step: 'problem'; problem: string }
  | { step: 'pick-calendar'; calendars: CalendarPreview[] }
  | { step: 'pick-column'; columns: string[] }
  | { step: 'confirm'; choice: BoardChoice };

/** How many exams a calendar of the choice has: "12 מבחנים", and one with none yet in words, as the confirm step says it (V-14). */
export function calendarExamCount(count: number): string {
  return count > 0 ? plural(count, 'מבחן אחד', 'מבחנים') : 'עוד אין בו מבחנים';
}

/** A step of the flow that has the student's say: a choice to make, or the screen that confirms. */
export type BoardStep = Exclude<PreviewStep, { step: 'problem' }>;

/**
 * The words of the way back from the check step to the choice the person came through ("איזה יומן?", "איזו עמודה?"),
 * or `null` when they came through none: a link or a file that led straight to the check step (V-13).
 */
export function backLabel(choice: Exclude<BoardStep, { step: 'confirm' }> | null): string | null {
  if (choice === null) return null;
  return choice.step === 'pick-calendar' ? 'לבחור יומן אחר' : 'לבחור עמודה אחרת';
}

/**
 * Where a check step starts the board: where the sheet was opened for (`bringTarget`), but for the person alone once the
 * lock refused a class save in this sheet (`refused`). The class has a board then, and the footer no longer offers it
 * (`confirmFooter`), so another calendar or column picked after the way back must not start on the class (V-13).
 */
export function startTarget(target: 'class' | 'own', refused: boolean): 'class' | 'own' {
  return refused ? 'own' : target;
}

/**
 * Where a preview leads. One calendar, or rows (even a board of which every line was skipped: the student may
 * give those a date), go to the confirm screen. Several calendars and a file with several class columns ask the
 * student to pick one. A preview with nothing in it is the same as a page with no board.
 */
export function previewStep(preview: ExamBoardPreview): PreviewStep {
  const none: PreviewStep = { step: 'problem', problem: REFUSALS.no_board };
  switch (preview.kind) {
    case 'calendar': {
      const [only, ...others] = preview.calendars;
      if (!only) return none;
      return others.length === 0 ? { step: 'confirm', choice: { kind: 'calendar', calendar: only } } : { step: 'pick-calendar', calendars: preview.calendars };
    }
    case 'columns':
      return preview.columns.length === 0 ? none : { step: 'pick-column', columns: preview.columns };
    case 'rows':
      if (preview.rows.length === 0 && preview.skipped.length === 0) return none;
      return { step: 'confirm', choice: { kind: 'rows', layout: preview.layout, rows: preview.rows, skipped: preview.skipped } };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The confirm screen's selection

/** Rows to a save at most (the server's limit, `exam-board/rows`): more than this ticked, and the button is off. */
export const SAVE_ROWS_MAX = BOARD_ROWS_MAX;

/** A title the server keeps is 1 to this many characters (`exam-board/rows`); a longer one refuses the whole save. */
const TITLE_MAX = BOARD_TITLE_MAX;

/**
 * What is ticked and corrected on the confirm screen, and where the board goes. One object that is replaced, never
 * changed: a transition that changes nothing hands back the very object it was given, so a screen that holds it
 * does not draw again, and a test can say "this did nothing" with `toBe`.
 * - `picked[i]`: row `i` of the preview is ticked;
 * - `dates[i]`: the date the student gave row `i` in place of the one that was read, or `null`;
 * - `skippedDates[i]`: the date the student gave a skipped line; with one, the line is chosen, without it, left out.
 */
export interface ConfirmSelection {
  readonly picked: readonly boolean[];
  readonly dates: readonly (DateStr | null)[];
  readonly skippedDates: readonly (DateStr | null)[];
  readonly target: 'class' | 'own';
}

/**
 * The rows that look like exams ticked, but those before `today` (`previewSelection`), nothing corrected, no skipped
 * line taken in. A date corrected later does not change a tick.
 */
export function initialSelection(rows: readonly BoardRow[], skipped: readonly BoardSkipped[], target: 'class' | 'own', today: DateStr): ConfirmSelection {
  return {
    picked: previewSelection(rows, today),
    dates: rows.map(() => null),
    skippedDates: skipped.map(() => null),
    target,
  };
}

const outside = (index: number, list: readonly unknown[]): boolean => !Number.isInteger(index) || index < 0 || index >= list.length;

/** Ticks row `index`, or unticks it. */
export function toggleRow(sel: ConfirmSelection, index: number): ConfirmSelection {
  if (outside(index, sel.picked)) return sel;
  return { ...sel, picked: sel.picked.map((on, i) => (i === index ? !on : on)) };
}

/**
 * Gives row `index` a corrected date, or takes the correction back with `null`. `original`: the date that was read; a
 * correction to the very same day is none.
 */
export function setRowDate(sel: ConfirmSelection, index: number, date: DateStr | null, original: DateStr | null = null): ConfirmSelection {
  if (outside(index, sel.dates)) return sel;
  const next = date === original ? null : date;
  if (sel.dates[index] === next) return sel;
  return { ...sel, dates: sel.dates.map((d, i) => (i === index ? next : d)) };
}

/** Gives skipped line `index` a date, which takes it in; `null` takes it out again. */
export function setSkippedDate(sel: ConfirmSelection, index: number, date: DateStr | null): ConfirmSelection {
  if (outside(index, sel.skippedDates)) return sel;
  if (sel.skippedDates[index] === date) return sel;
  return { ...sel, skippedDates: sel.skippedDates.map((d, i) => (i === index ? date : d)) };
}

/** Where the board goes: the class, or the phone alone. */
export function chooseTarget(sel: ConfirmSelection, target: 'class' | 'own'): ConfirmSelection {
  return sel.target === target ? sel : { ...sel, target };
}

/**
 * Takes every tick away: the rows, and the skipped lines that were given a date (a line with no date is not in the
 * board). The dates the student corrected stay: they are corrections, not ticks. For a board that opens with more
 * rows ticked than a save takes.
 */
export function clearMarks(sel: ConfirmSelection): ConfirmSelection {
  if (!sel.picked.some(Boolean) && sel.skippedDates.every((d) => d === null)) return sel;
  return { ...sel, picked: sel.picked.map(() => false), skippedDates: sel.skippedDates.map(() => null) };
}

/**
 * A row's date as a save carries it (`confirmedRows`): the day the person corrected it to, else the one that was read.
 * What the bulk tick and its words go by too, so that an exam moved ahead counts as ahead.
 */
const dateOf = (row: BoardRow, corrected: DateStr | null | undefined): DateStr => corrected ?? row.date;

/**
 * Ticks the rows that look like exams and nothing else, from `today` on, each by its date as the save would carry it
 * (`dateOf`): an exam corrected from a past day to one ahead is ticked, one corrected into the past is not. With no
 * date corrected that is the selection the screen opened with (`previewSelection`).
 */
export function markExams(sel: ConfirmSelection, rows: readonly BoardRow[], today: DateStr): ConfirmSelection {
  const exams = rows.map((row, i) => row.isExam && dateOf(row, sel.dates[i]) >= today);
  return exams.length === sel.picked.length && exams.every((on, i) => on === sel.picked[i]) ? sel : { ...sel, picked: exams };
}

/** A row that looks like an exam, on a day before `today` by its date as the save would carry it: `markExams` leaves it unticked. */
const pastExam = (row: BoardRow, corrected: DateStr | null | undefined, today: DateStr): boolean => row.isExam && dateOf(row, corrected) < today;

/**
 * The words of the action that ticks the exams (`markExams`): "all" only while it ticks them all. A list that holds an
 * exam before today is not ticked whole, and the action says so. `dates`: the selection's corrected dates.
 */
export function markExamsLabel(rows: readonly BoardRow[], dates: readonly (DateStr | null)[], today: DateStr): string {
  return rows.some((row, i) => pastExam(row, dates[i], today)) ? 'לסמן את המבחנים שעוד לא עברו' : 'לסמן את כל המבחנים';
}

/**
 * The line above the list when every exam in it is before today (by the corrected dates, `dates`), so the screen opens
 * with nothing ticked; `null` otherwise. A list with no exam at all has none to be past: it opens on its "אירועים
 * אחרים" (`foldsAtStart`).
 */
export function pastExamsLine(rows: readonly BoardRow[], dates: readonly (DateStr | null)[], today: DateStr): string | null {
  const exams = rows.flatMap((row, i) => (row.isExam ? [{ row, corrected: dates[i] }] : []));
  return exams.length > 0 && exams.every(({ row, corrected }) => pastExam(row, corrected, today))
    ? 'כל המבחנים בלוח כבר עברו, אז הם לא סומנו מראש. אפשר לסמן אותם ביד.'
    : null;
}

const sameList = <T,>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Whether the student has changed anything from the selection the screen opened with: a tick, a corrected date, a date
 * given to a skipped line, or where the board goes. By content, not by object: ticking a row and unticking it again
 * is no change.
 */
export function selectionChanged(opened: ConfirmSelection, now: ConfirmSelection): boolean {
  if (opened === now) return false;
  return !(opened.target === now.target && sameList(opened.picked, now.picked) && sameList(opened.dates, now.dates) && sameList(opened.skippedDates, now.skippedDates));
}

/**
 * What a request to leave the check step does: to close the sheet (the close button, Android's back, "ביטול"), or to go
 * back to the choice ("לבחור יומן אחר", "לבחור עמודה אחרת"), which drops this step's selection as closing does. Nothing
 * while a save or a read is under way; asks first (`leaveQuestion`) when the person changed something; else leaves.
 */
export function closeAction(changed: boolean, busy: boolean): 'ignore' | 'ask' | 'close' {
  if (busy) return 'ignore';
  return changed ? 'ask' : 'close';
}

/**
 * What leaving the check step with changes asks, in the sheet, and the button that leaves (beside "להמשיך לערוך"):
 * closing the sheet, or going back to the choice.
 */
export function leaveQuestion(leave: 'close' | 'back'): { line: string; confirm: string } {
  return leave === 'close'
    ? { line: 'לסגור בלי לשמור?', confirm: 'לסגור' }
    : { line: 'לחזור בלי לשמור את השינויים?', confirm: 'לחזור' };
}

/** Whether a tap on the dimmed backdrop closes the sheet: only when there is nothing to lose, since it is the tap that is made by mistake. */
export function backdropCloses(changed: boolean, busy: boolean): boolean {
  return !changed && !busy;
}

/** How many rows a save would carry: the ticked rows, and the skipped lines that were given a date. */
export function chosenCount(sel: ConfirmSelection): number {
  return sel.picked.filter(Boolean).length + sel.skippedDates.filter((d) => d !== null).length;
}

/**
 * The ticked rows as a save takes them: a date (the corrected one, else the one that was read), a title and details.
 * Never `isExam`, which is only the preview's guess for the screen.
 */
export function confirmedRows(rows: readonly BoardRow[], picked: readonly boolean[], dates: readonly (DateStr | null)[]): SaveExamBoardBody['rows'] {
  return rows.flatMap((row, i) => (picked[i] ? [{ date: dateOf(row, dates[i]), title: row.title, details: row.details }] : []));
}

/** The date characters, and a dash between two of them. */
const DATE_TOKEN = /^[\d./\\\-–—]+$/;
const DASH_TOKEN = /^[-–—]+$/;

/**
 * A skipped line as the server reports it is the date as it was written, a space, and what the line said, with
 * nothing between to tell them apart. The date is told by its look: a first word made of digits and `. / -`, and
 * after it any more of the same that have a separator in them (`1.12.26 - 5.12.26`), but not a plain number
 * (`3.12.26 11 מתמטיקה`: the 11 is the title's). A date written in words ("בקרוב") cannot be told from the title,
 * and stays in it: a title with a word too many is better than one with a word taken out. The line with nothing
 * left after its date is its own title.
 */
export function skippedParts(text: string): { when: string | null; title: string } {
  const whole = text.replace(/\s+/g, ' ').trim();
  const words = whole.split(' ');
  let end = 0;
  while (end < words.length) {
    const word = words[end]!;
    const date = DATE_TOKEN.test(word) && /\d/.test(word);
    const more = (date && /[./\\]/.test(word)) || DASH_TOKEN.test(word);
    if (end === 0 ? !date : !more) break;
    end += 1;
  }
  if (end === 0 || end >= words.length) return { when: null, title: whole };
  return { when: words.slice(0, end).join(' '), title: words.slice(end).join(' ') };
}

/** `text` cut to `max` characters, never between the two halves of a character, with no space left at its end. */
function cutTitle(text: string, max: number): string {
  if (text.length <= max) return text;
  const high = text.charCodeAt(max - 1);
  return text.slice(0, high >= 0xd800 && high <= 0xdbff ? max - 1 : max).trimEnd();
}

/**
 * The skipped lines that were given a date, as rows to save: the title is what the line said without its date, cut to
 * what a save takes, and no details. A line with no date is left out; so is one with no title, which would refuse the
 * whole save.
 */
export function fixedSkipped(skipped: readonly BoardSkipped[], dates: readonly (DateStr | null)[]): SaveExamBoardBody['rows'] {
  return skipped.flatMap((line, i) => {
    const date = dates[i] ?? null;
    const title = cutTitle(skippedParts(line.text).title, TITLE_MAX);
    return date !== null && title !== '' ? [{ date, title, details: null }] : [];
  });
}

/** Everything a save carries: the ticked rows, then the skipped lines that were given a date. */
export function rowsToSave(rows: readonly BoardRow[], skipped: readonly BoardSkipped[], sel: ConfirmSelection): SaveExamBoardBody['rows'] {
  return [...confirmedRows(rows, sel.picked, sel.dates), ...fixedSkipped(skipped, sel.skippedDates)];
}

/** Whether a day the student picked is in the school year `today` belongs to; a row outside it refuses the whole save. */
export function inSchoolYear(date: DateStr, today: DateStr): boolean {
  const year = schoolYearOf(today);
  return date >= year.start && date <= year.end;
}

/** Said under the calendar when the student picks a day outside the school year. */
export const OUT_OF_YEAR_PICK = 'אפשר לבחור רק יום בשנת הלימודים הנוכחית.';

/** What a skipped line's reason says, for its row. */
export function skippedReason(reason: BoardSkipped['reason']): string {
  return reason === 'date' ? 'לא הצלחנו לקרוא את התאריך' : 'התאריך לא בשנת הלימודים הנוכחית';
}

/**
 * One line of the confirm list: a row of the preview (`r<index>`), a fold's heading, or a skipped line (`s<index>`).
 * The list is flat, and the rows carry only an index: what is ticked and corrected lives in the selection, so the
 * list's data does not change when a row is ticked.
 */
export type ConfirmItem =
  | { key: string; type: 'row'; index: number }
  | { key: string; type: 'fold'; fold: 'others' | 'skipped'; count: number; open: boolean }
  | { key: string; type: 'skipped'; index: number };

/**
 * The confirm list, top to bottom: the rows that look like exams, then "אירועים אחרים" (the rows that do not, folded),
 * then the skipped lines (folded). A fold that has nothing in it is not there.
 */
export function confirmItems(
  rows: readonly BoardRow[], skipped: readonly BoardSkipped[], open: { others: boolean; skipped: boolean },
): ConfirmItem[] {
  const items: ConfirmItem[] = [];
  const others: ConfirmItem[] = [];
  rows.forEach((row, index) => {
    (row.isExam ? items : others).push({ key: `r${index}`, type: 'row', index });
  });
  if (others.length > 0) {
    items.push({ key: 'fold-others', type: 'fold', fold: 'others', count: others.length, open: open.others });
    if (open.others) items.push(...others);
  }
  if (skipped.length > 0) {
    items.push({ key: 'fold-skipped', type: 'fold', fold: 'skipped', count: skipped.length, open: open.skipped });
    if (open.skipped) skipped.forEach((_, index) => items.push({ key: `s${index}`, type: 'skipped', index }));
  }
  return items;
}

/** A stretch of the screen from top to bottom, in the window's pixels. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * Where the confirm list scrolls to so that `item` (the calendar just opened under its row) is all in view above the
 * sheet's footer (V-3): `view` is the list's own frame and `offset` how far it is scrolled now, both measured in the
 * window. `null` when the calendar is in view already, or nearly (less than a pixel). One that runs under the footer is
 * brought up until its bottom shows, `margin` above the edge; one above the view, down until its top does. A calendar
 * taller than the view (the largest text on a small phone) is shown from its top, where its month and its days begin.
 */
export function revealOffset(item: Span, view: Span, offset: number, margin = 0): number | null {
  const tall = item.bottom - item.top > view.bottom - view.top - 2 * margin;
  let by: number;
  if (tall || item.top < view.top) by = item.top - (view.top + margin);
  else if (item.bottom > view.bottom) by = item.bottom - (view.bottom - margin);
  else return null;
  return Math.abs(by) < 1 ? null : Math.max(0, offset + by);
}

/**
 * Where the confirm list goes back to when the calendar it scrolled to (`revealOffset`) closes, or `null` to leave it be
 * (V-17): `before` is where it was when the calendar opened, `revealedTo` where it scrolled to show it (`null`: it did
 * not scroll), `now` where it is. Back only while the person has not scrolled it since (to within a pixel): the row
 * they tapped is where it was, and the rows under it do not jump into the calendar's place under their finger.
 */
export function closeOffset(before: number | null, revealedTo: number | null, now: number): number | null {
  if (before === null || revealedTo === null) return null;
  return Math.abs(now - revealedTo) < 1 ? before : null;
}

/** Which folds start open: the one that holds all there is to see (no row looks like an exam; no row was read at all). */
export function foldsAtStart(rows: readonly BoardRow[], skipped: readonly BoardSkipped[]): { others: boolean; skipped: boolean } {
  return {
    others: rows.length > 0 && rows.every((row) => !row.isExam),
    skipped: rows.length === 0 && skipped.length > 0,
  };
}

/**
 * Whether the save button is on, and the line that says why when it is not. `count`: the rows a save would carry, or
 * `null` for a calendar, which has none to count. A save is limited to `SAVE_ROWS_MAX` rows. No rows is off with
 * nothing to say: the button reads (0).
 */
export function saveVerdict(count: number | null): { enabled: boolean; line: string | null } {
  if (count === null) return { enabled: true, line: null };
  if (count > SAVE_ROWS_MAX) return { enabled: false, line: `אפשר לשמור עד ${SAVE_ROWS_MAX} שורות בבת אחת.` };
  return { enabled: count > 0, line: null };
}

/**
 * A save that did not go through. The screen stays open, and every tick and every corrected date is still there for
 * the next try; the sentence is what `boardProblem` says of it. A save for the class the lock refused (the class has a
 * board now that the phone did not know of, a 403) turns into one for the person alone: the selection is the same with
 * the target `own`, and the sentence says so, so that the ticks can be kept somewhere with the next tap; `refused` says it
 * was that (the sheet then knows the class has a board: `confirmFooter`). Any other failure leaves the very selection it
 * was.
 */
export function saveFailed(sel: ConfirmSelection, err: unknown, mePage?: string): { selection: ConfirmSelection; problem: string; refused: boolean } {
  const failure = asV2Error(err);
  if (sel.target === 'class' && failure && isLocked(failure)) return { selection: chooseTarget(sel, 'own'), problem: LOCKED, refused: true };
  return { selection: sel, problem: boardProblem(err, mePage), refused: false };
}

/** What the confirm sheet's footer is told besides its buttons (`confirmFooter`). */
export interface FooterFacts {
  /** Where the board goes now (`ConfirmSelection.target`). */
  target: 'class' | 'own';
  /** The sheet was opened with the two places to choose from (`bringTarget`'s `choice`). */
  choice: boolean;
  /** The class has a board, as the phone read it when the sheet opened (`classHasBoard`). */
  classHasBoard: boolean;
  /** The person holds a board of their own (`holdsOwnBoard`). */
  holdsOwn: boolean;
  /** A save for the class was refused by the lock since the sheet opened (`saveFailed`'s `refused`): the class has a board. */
  refused: boolean;
  /** What went wrong, shown until the person changes something; `refusal`: it is that refusal's sentence. */
  problem: { text: string; refusal: boolean } | null;
}

/**
 * The footer of the confirm sheet: whether the two places ("לכל הכיתה", "רק אצלי") are offered, the grey line that says
 * where the board goes, and the sentence of what went wrong. After a class save the lock refused, the sheet knows the
 * class has a board: "לכל הכיתה" is no longer offered, and while the refusal shows it is the one sentence (it says where
 * the board goes now); once the person changes anything the line is the ordinary one for a board kept by them over a
 * class that has one (V-8).
 */
export function confirmFooter(facts: FooterFacts): { chips: boolean; targetLine: string | null; problem: string | null } {
  const hasBoard = facts.classHasBoard || facts.refused;
  return {
    chips: facts.choice && !facts.refused,
    targetLine: facts.problem?.refusal ? null : targetLine(facts.target, hasBoard, facts.holdsOwn),
    problem: facts.problem?.text ?? null,
  };
}

/**
 * The line the footer would say for the other place, while the two places are offered (`confirmFooter`'s `chips`) and the
 * line is shown; `null` otherwise. The footer keeps room for the longer of the two, so that it does not grow or shrink
 * under the chips as the person goes from one to the other (V-17).
 */
export function spareTargetLine(facts: FooterFacts): string | null {
  const shown = confirmFooter(facts);
  if (!shown.chips || shown.targetLine === null) return null;
  return targetLine(facts.target === 'class' ? 'own' : 'class', facts.classHasBoard || facts.refused, facts.holdsOwn);
}

/** A removal of the class's board the lock refused: the phone took it for its own, and someone has replaced it since (R2). */
const REPLACED = 'הלוח של הכיתה הוחלף בינתיים, אז אי אפשר להסיר אותו.';

/**
 * A removal of the class's board that did not go through: the sentence, and whether the class is to be read again. The
 * removal is offered only where the phone believes it brought the board, so a refusal by the lock (a 403, or its code)
 * means the block is behind: someone else holds the board now. It says so, and the class is read again so that the
 * block shows what is true (R2). Anything else is what `boardProblem` says of it, with nothing read again.
 */
export function removalFailed(err: unknown, mePage?: string): { problem: string; readAgain: boolean } {
  const failure = asV2Error(err);
  if (failure && isLocked(failure)) return { problem: REPLACED, readAgain: true };
  return { problem: boardProblem(err, mePage), readAgain: false };
}

/**
 * What follows a save for the class, once the sheet is closed; `own` is the phone's own board as it was. With a board of
 * the person's own over the class's (`replacesOwnBoard`): the class's feed is read again first, and only once that read
 * is in does the own board go, so the lists are never built from the feed as it was before the save with no board over
 * it; a read that fails (or throws) leaves the own board, and the toast is the plain one, as it is when the own board
 * could not be removed. Without one, the toast is shown at once and the feed is read behind it. "בלי הלוח של הכיתה"
 * (`none`), left from a class that had no board, would hide the board just saved: it goes too once that read is in,
 * quietly, and the toast is the plain one, since the person held no board of their own (R1). Never throws.
 */
export async function afterClassSave(
  own: OwnBoardLike | null,
  io: { readFeed(): Promise<boolean>; removeOwn(): void; toast(text: string): void },
): Promise<void> {
  const read = async (): Promise<boolean> => {
    try {
      return await io.readFeed();
    } catch {
      return false;
    }
  };
  if (!replacesOwnBoard('class', own)) {
    io.toast(classSavedToast(false));
    if ((await read()) && own?.kind === 'none') {
      try {
        io.removeOwn();
      } catch {
        // the class has the board; the next refresh that sees it there leaves "בלי הלוח של הכיתה" as a choice to undo
      }
    }
    return;
  }
  let ownGone = false;
  if (await read()) {
    try {
      io.removeOwn();
      ownGone = true;
    } catch {
      // the class has the board; the person's own stays as it was, and the toast is the usual one
    }
  }
  io.toast(classSavedToast(ownGone));
}

/**
 * The line above the save button: where the board goes. `hasBoard`: the class has one already (`classHasBoard`).
 * `holdsOwn`: the person holds a board of their own, which a save for the class ends (`replacesOwnBoard`): the class's
 * line says so after it. Never "הכיתה שלך": on a parent's phone the class is the child's (V-1).
 */
export function targetLine(target: 'class' | 'own', hasBoard: boolean, holdsOwn = false): string {
  if (target === 'class') {
    // A first board may be told to the class (once in 30 days, under each person's switches): "may", not "will".
    const forClass = hasBoard ? 'הלוח יתעדכן אצל כל מי שבכיתה.' : 'כל מי שבכיתה יראה את הלוח הזה, ועשויה להישלח להם התראה שנוסף לוח מבחנים.';
    return holdsOwn ? `${forClass} הלוח שלך יוסר.` : forClass;
  }
  return hasBoard ? 'לכיתה כבר יש לוח. הלוח הזה יחליף אותו רק אצלך, ואפשר לחזור ללוח של הכיתה בכל רגע.' : 'הלוח הזה יישמר רק אצלך.';
}

// ---------------------------------------------------------------------------------------------------------------------
// The block on "המבחנים שלי" when there is a board

/** The instant a board was set, as the local day it falls on; `null` for none or a broken one. */
function setDay(setAt: string | null): DateStr | null {
  if (!setAt) return null;
  const at = new Date(setAt);
  return Number.isNaN(at.getTime()) ? null : toDateStr(at);
}

/**
 * "הלוח נוסף ב־10.11", for a board of rows: when it was brought, and never "from a file", since a Google sheet's link
 * and a page of the site are kept as rows too (V-10). `null` when the time is none or does not read.
 */
function addedOn(at: string | null): string | null {
  const day = setDay(at);
  return day ? `הלוח נוסף ב־${formatShortDate(day)}` : null;
}

/** Parts of a line joined with a comma; `null` when none is left. */
const joined = (parts: readonly (string | null)[]): string | null => parts.filter(Boolean).join(', ') || null;

function infoLine(info: ExamBoardInfo): string | null {
  const exams = info.count > 0 ? plural(info.count, 'מבחן אחד', 'מבחנים') : null;
  if (info.kind === 'calendar') return joined(['מיומן Google', exams]);
  return joined([addedOn(info.setAt), exams]);
}

/** Said of a calendar of the phone's own that was never read: its exams are none, which is not the same as a calendar with none. */
const NOT_READ_YET = 'עוד לא נקרא';

/**
 * What the phone's own board is: "הלוח נוסף ב־10.11, 23 מבחנים" (rows, by when they were kept) or "מיומן Google, 12
 * מבחנים", the exams it holds (the count is left out when it is 0). A calendar that was never read says so after it. A
 * read that failed after a good one is not said: the phone keeps the exams of the read before and no record of the
 * failure, and the line does no date arithmetic.
 */
function ownStatusLine(own: OwnBoardFacts): string | null {
  if (own.kind === 'none') return null;
  const exams = own.exams.length > 0 ? plural(own.exams.length, 'מבחן אחד', 'מבחנים') : null;
  if (own.kind === 'rows') return joined([addedOn(own.savedAt), exams]);
  return joined(['מיומן Google', exams, own.readAt === null ? NOT_READ_YET : null]);
}

/**
 * What the board is, in one line under the line that says whose it is: "הלוח נוסף ב־10.11, 23 מבחנים" or "מיומן
 * Google, 23 מבחנים" (the date is left out when the board has none, the count when it is 0: a calendar just set and
 * not read yet has no exams, which is not the same as none; `null` when nothing is left). A class an older server
 * described has a calendar and nothing more. The phone's own board says what it is and the exams it holds
 * (`ownStatusLine`), never the class's count.
 */
export function boardStatusLine(owner: BoardOwner, cls: DeviceClass | null | undefined, own: OwnBoardFacts | null): string | null {
  switch (owner) {
    case 'none':
    case 'own-none':
      return null;
    case 'own':
      return own ? ownStatusLine(own) : null;
    case 'class-mine':
    case 'class-open':
    case 'class-other':
      if (cls?.examBoard) return infoLine(cls.examBoard);
      return cls?.examCalendarId ? 'יש לכיתה לוח מבחנים.' : null;
  }
}

/**
 * What the person may do with the board they see: `add` is the button that opens the form to bring one -
 * `update`: a newer board for the class, by the one that brought it; `replace`: a new board where the one who brought
 * the class's has gone, for the class or for themselves (the sheet offers both, `saveTarget`); `other`: a board of their
 * own beside a class's board they may not replace; `again`: another board for a phone that has one of its own or turned
 * the class's off - and `remove` the class's board for everyone. With no board the form is open already, so there is no `add`.
 */
export function boardActions(owner: BoardOwner, info: ExamBoardInfo | null): { add: 'update' | 'replace' | 'other' | 'again' | null; remove: boolean } {
  switch (owner) {
    case 'none':
      return { add: null, remove: false };
    case 'class-mine':
      // The lock lets only a device that still follows the class change the class's board.
      return info?.mayChange ? { add: 'update', remove: true } : { add: 'other', remove: false };
    case 'class-open':
      // Not locked: whoever brought it has gone, and a new board may be the class's (V-7).
      return { add: 'replace', remove: false };
    case 'class-other':
      return { add: 'other', remove: false };
    case 'own':
    case 'own-none':
      return { add: 'again', remove: false };
  }
}

/**
 * The controls under the block:
 * - `add`: opens the form to bring a board (`boardActions`' `add`; its words are the state's);
 * - `remove-class`: the class's board goes for everyone (asks), by the one who brought it;
 * - `hide-class`: "בלי הלוח של הכיתה", the class's board is off on this phone alone (asks); quiet, beside the rest;
 * - `remove-own`: the phone's own board goes and the class's comes back (asks);
 * - `restore-class`: the class's board is turned back on (`own-none`; nothing to ask, it only restores).
 */
export type BlockActionId = 'add' | 'remove-class' | 'hide-class' | 'remove-own' | 'restore-class';

export interface BlockAction {
  id: BlockActionId;
  label: string;
  /** A secondary action, drawn quieter than the others. */
  quiet: boolean;
  /** A muted line said before the action ("לא מתאים?"), when it has one. */
  lead?: string;
}

const ADD_LABELS = {
  update: 'להעלות לוח מעודכן',
  replace: 'להביא לוח חדש',
  other: 'להביא לוח רק לעצמי',
  again: 'להביא לוח אחר',
} as const;

/** What is said before "להביא לוח רק לעצמי" beside a class's board the person may not replace: a question, not a sentence on a button. */
const NOT_RIGHT = 'לא מתאים?';

/** The owners whose class's board is what the phone shows, and which can turn it off for themselves. */
const SHOWS_CLASS_BOARD: readonly BoardOwner[] = ['class-mine', 'class-open', 'class-other'];

/**
 * Everything the person may do with the board they see, in the order it shows: `boardActions`' two, and the ones that
 * are about the phone's own board and the class's board on this phone. "בלי הלוח של הכיתה" is where the class's board
 * is shown; not where there is none, and not where the phone's own board stands in for it. A phone with the class's
 * board turned off is offered a board for itself alone, and the way back first.
 */
export function blockActions(owner: BoardOwner, info: ExamBoardInfo | null): BlockAction[] {
  const base = boardActions(owner, info);
  const actions: BlockAction[] = [];
  const add = (id: BlockActionId, label: string, quiet = false, lead?: string): void =>
    void actions.push(lead === undefined ? { id, label, quiet } : { id, label, quiet, lead });
  // A phone with a board of its own, or the class's turned off, is shown the way back first, then a board to bring.
  if (owner === 'own-none') add('restore-class', 'להחזיר את הלוח של הכיתה');
  if (owner === 'own') add('remove-own', 'להסיר את הלוח שלי');
  if (base.add === 'other') add('add', ADD_LABELS.other, false, NOT_RIGHT);
  else if (base.add) add('add', owner === 'own-none' ? 'להביא לוח רק לעצמי' : ADD_LABELS[base.add]);
  if (base.remove) add('remove-class', 'להסיר את הלוח');
  if (SHOWS_CLASS_BOARD.includes(owner)) add('hide-class', 'בלי הלוח של הכיתה', true);
  return actions;
}

/** The one word that closes a question the block asks. */
export const CANCEL_LABEL = 'ביטול';

/** The questions the block asks once before it does what cannot be undone at a tap, or changes what the class sees. */
export type BlockQuestion = 'remove-class' | 'hide-class' | 'remove-own';

/**
 * The question and the button that says yes. `hasBoard`: the class has a board to come back, when the phone's own is removed.
 * Removing the phone's own board that turned the class's off (`own-none`) asks nothing: it only restores.
 */
export function blockQuestion(ask: BlockQuestion, hasBoard: boolean): { line: string; confirm: string } {
  switch (ask) {
    case 'remove-class':
      return { line: 'הלוח יוסר לכל הכיתה.', confirm: 'להסיר' };
    case 'hide-class':
      return { line: 'המבחנים מהלוח של הכיתה לא יוצגו אצלך. אפשר להחזיר בכל רגע.', confirm: 'להסתיר אצלי' };
    case 'remove-own':
      return { line: hasBoard ? 'הלוח שלך יוסר, והלוח של הכיתה יחזור.' : 'הלוח שלך יוסר.', confirm: 'להסיר' };
  }
}

/** The toast after a board was kept on the phone alone (a calendar is kept only once it was read). */
export function ownSavedToast(): string {
  return 'הלוח נשמר אצלך';
}

/** The toast after the phone's own board, or the class's board turned off, was taken away (`kind` is the one removed). */
export function ownRemovedToast(kind: OwnBoard['kind'], hasBoard: boolean): string {
  if (kind === 'none') return hasBoard ? 'הלוח של הכיתה חזר' : 'לכיתה אין עכשיו לוח מבחנים';
  return hasBoard ? 'הלוח שלך הוסר, והלוח של הכיתה חזר' : 'הלוח שלך הוסר';
}

/** The toast after a board was saved for the class; `ownRemoved`: the person's own board went with it (`afterClassSave`). */
export function classSavedToast(ownRemoved: boolean): string {
  return ownRemoved ? 'הלוח נשמר לכיתה, והלוח שלך הוסר' : 'הלוח נשמר לכל הכיתה';
}

/** The toast after the class's board was turned off on this phone. */
export const OWN_HIDDEN_TOAST = 'הלוח של הכיתה הוסתר אצלך';
