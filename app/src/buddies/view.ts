/**
 * What the friends screens show (docs/superpowers/specs/2026-10-29-friends-design.md,
 * 2.2 to 2.4), from what the phone keeps:
 *
 * | Model             | Screen                                                              |
 * |-------------------|---------------------------------------------------------------------|
 * | `buddiesModel`    | the list: one line each about today, my exams friends share         |
 * | `buddyPageModel`  | a friend's page: the day's summary, table, exams, absences, grades  |
 * | `todayLinesModel` | the lines under Today's "now" card, each opening its first friend   |
 *
 * Every comparison is `compareDays` over my lessons and the friend's
 * (`days.ts`). A friend at my school (one Shahaf site, or, without one, one
 * Mashov school) is set against me period by period; another school's by the
 * clock, a row at each lesson's start. Nothing of this is a parent's: every
 * model is empty when `audience` is `'parent'` (1.2).
 *
 * The grades tab (docs/superpowers/specs/2026-10-30-buddies-grades-design.md,
 * 2.2 to 2.4) is `compareGrades` over my box and theirs, and only while both of
 * us share grades: the page never shows what that rule does not allow.
 *
 * Pure: everything it reads comes in `BuddiesInput`.
 */
import type { Audience, BuddyAbsence, BuddyGradesContent, BuddyShares, BuddyTimetable, ClassFeed, DateStr, DayView, Instant, TimeStr } from '@sederyom/shared';
import { MAX_BUDDIES, TOGETHER_MINUTES } from '@sederyom/shared';
import {
  compareDays, compareExams, examsWithBuddies, todayBuddyLines,
  type CompareLesson, type DayCompare, type ExamCompareRow, type ExamWithBuddies, type SideDay, type Span, type TodayBuddyLine,
} from '@sederyom/shared/logic/buddies-compare';
import { holdsSchool, nextSchoolDay } from '@sederyom/shared/logic/build';
import { subjectsMatch, teachersMatch } from '@sederyom/shared/logic/subjects';
import { addDays, sundayIndex, weekStart } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import type { LocalSources } from '../local/days';
import { absencesOf, examsOf } from './content';
import { BUDDY_COPY, buddyNames, edgeNames } from './copy';
import { attendanceOf, buddyLessons, lessonsOfDay } from './days';
import { compareGrades, type GradesCompare } from './grades';
import { removalClosesLink } from './protocol';
import { buddyFeedKey, theirSharesOf, type Buddy, type BuddiesState } from './store';

export interface BuddiesInput {
  state: BuddiesState;
  /** The friends' class feeds, by `buddyFeedKey`; a friend in my own class reads `base.feed`. */
  feeds: ReadonlyMap<string, ClassFeed>;
  /** My sources, which a friend's days are built over (`buddyLessons`). */
  base: LocalSources;
  /** My days: today to `BUDDY_EXAM_DAYS` ahead, and the week of a page's date. */
  mine: readonly DayView[];
  audience: Audience;
  now: Date;
  zone: string;
  /** My school, to tell a friend at the same one: its Shahaf site, else Mashov's school id. */
  mySchool: { siteUrl: string | null; mashovSchool: string | null };
  /**
   * My grades as a box, with the bagrut part (`myGradesContent`, `withBagrut`), set beside a friend's when both share them;
   * it never leaves the phone. `null` when Mashov was never read here.
   */
  myGrades: BuddyGradesContent | null;
  /** Whether the phone has a bagrut questionnaire with a grade of Mashov's own (`myHasBagrut`): a phone without one is not asked for it. */
  myHasBagrut: boolean;
}

export interface BuddyRow {
  id: string;
  /** My name for them, else theirs. */
  name: string;
  initial: string;
  className: string | null;
  /** One line about today; `''` when they share no timetable. */
  line: string;
  /** Their first box has not come yet: the row is grey, and `line` says ״מחכים לעדכון ראשון״. */
  waiting: boolean;
}

export interface BuddiesView {
  myName: string;
  rows: BuddyRow[];
  /** My invites whose link was given (sent ones only). */
  invites: number;
  exams: ExamWithBuddies[];
  unseen: boolean;
  notes: string[];
  /** Friends, invites and answers are at `MAX_BUDDIES`. */
  full: boolean;
}

/** One hour of a friend's page: mine and theirs side by side, a lesson the two sit in together, or a shared window. */
export interface BuddyTableRow {
  hourIndex: number;
  start: TimeStr | null;
  mine: CompareLesson | null;
  theirs: CompareLesson | null;
  kind: 'together' | 'window' | 'apart';
  /** For a `window` row, the window it lies in; `null` on any other row. */
  window: TableWindow | null;
}

/** A shared window as the table draws it: which of `compare.windows` it is, the periods it spans, and where its line starts. */
export interface TableWindow {
  index: number;
  /**
   * By period, the window's own periods. By the clock, from the period after
   * the last lesson either of the two has before it to the one before the
   * first after it: the same hour for both only at one school (`byHour`).
   * `to` is less than `from` for a window that is only a break.
   */
  from: number;
  to: number;
  /** By the clock, the window's own start; by period, `null`. */
  start: TimeStr | null;
}

/** What an empty cell of the table says: that side has not started yet, is done for the day, or neither (a gap between two lessons). */
export type EmptyCell = 'notYet' | 'done' | null;

/**
 * A line of the page's table as it is drawn (2.4, `tableLines`): a row, or
 * rows in a row merged into one, a shared window or one lesson sat together.
 */
export interface BuddyTableLine {
  kind: BuddyTableRow['kind'];
  /**
   * The first and the last period it spans, equal for one row (a window's are
   * its own, `TableWindow`); the same hour for both only by period
   * (`BuddyPage.byHour`). `to` is less than `from` for a window that is only a break.
   */
  from: number;
  to: number;
  /** Its first row's start; a window's own start by the clock. */
  start: TimeStr | null;
  /** Its first row's lessons. */
  mine: CompareLesson | null;
  theirs: CompareLesson | null;
  /** For a side with no lesson on the line: whether that side has not started yet or is done. */
  mineEmpty: EmptyCell;
  theirsEmpty: EmptyCell;
  /**
   * On a window line, the lessons cancelled in it, in the table's order and
   * each once (a lesson of both of us is one): what made the window; empty on any other line.
   */
  cancelled: CompareLesson[];
}

/**
 * What the grades tab says (grades spec 2.2): who turned grades on, and when both did, whether their box is here, has no
 * subject in it, or is the list.
 */
export type GradesState = 'neither' | 'mine' | 'theirs' | 'waiting' | 'empty' | 'list';

/**
 * The tab's bagrut part (2.3): the states of `GradesState` that it has, and
 * `none` when there is no part to draw: nobody chose it, or this phone has no
 * bagrut (2.1), or their box has not brought it.
 */
export type BagrutState = 'mine' | 'theirs' | 'list' | 'none';

export interface BuddyGrades {
  state: GradesState;
  /**
   * My box beside theirs: in `list`, and in `empty` when the bagrut is `list`
   * (no subject, only the questionnaires); else `null`. Their bagrut part is
   * in it only when the bagrut is `list`.
   */
  compare: GradesCompare | null;
  bagrut: BagrutState;
  /** Where their box starts, when it leaves older grades out (a box that is shown only); else `null`. */
  from: DateStr | null;
  /** They turned on what I have not, and I have not opened the tab since (2.4). */
  dot: boolean;
}

export interface BuddyPage {
  id: string;
  name: string;
  className: string | null;
  date: DateStr;
  /** They came by a link of mine that is still open: ending the friendship closes it too. */
  closesLink: boolean;
  /** `null` when they share no timetable, or their week is not out yet. */
  compare: DayCompare | null;
  /** The end, the window, the start (2.4); empty when either side has no day, or the two cannot be compared (`noTimes`). */
  summary: string[];
  /** Empty too when the two cannot be compared: two schools' periods are not one hour. */
  table: BuddyTableRow[];
  /**
   * Whether the table goes period by period (one school, or no times), so a
   * row's `hourIndex` is the same hour for both; by the clock (two schools) it
   * is only one side's period, and the rows go by their starts.
   */
  byHour: boolean;
  /** `null` when they share no timetable. */
  exams: ExamCompareRow[] | null;
  absences: { shared: { subject: string; mine: BuddyAbsence | null; theirs: BuddyAbsence }[]; others: BuddyAbsence[] } | null;
  /** When their phone last read Mashov. */
  updatedAt: Instant | null;
  theirShares: BuddyShares;
  myShares: BuddyShares;
  /** Whose timetable has no times, when that is why the two days cannot be compared (`noTimesMine` / `noTimes`). */
  noTimes: 'mine' | 'theirs' | null;
  /** Their class's site has not published the week of `date`. */
  unpublished: boolean;
  /** The grades tab. */
  grades: BuddyGrades;
}

/** A line under Today's "now" card, and the friend a tap on it opens. */
export interface TodayLine {
  text: string;
  /** Which line it is: the window is drawn on the highlighter, the end and the start plain. */
  kind: TodayBuddyLine['kind'];
  /** The first friend it names, whom a tap opens. */
  buddyId: string;
  /** Every friend it names, in the text's order; Today draws their initials. */
  buddyIds: string[];
}

const NOTHING: BuddyShares = { timetable: false, absences: false };
/** My name for them, else theirs as their latest box gives it (they may have renamed themselves), else as their answer gave it. */
const shownName = (buddy: Buddy): string => buddy.label || buddy.theirs?.name || buddy.name;
const localNow = (input: BuddiesInput) => DateTime.fromJSDate(input.now).setZone(input.zone);
const todayOf = (input: BuddiesInput): DateStr => localNow(input).toISODate()!;
const held = (lesson: CompareLesson | null): lesson is CompareLesson => lesson !== null && lesson.status !== 'cancelled';

function minutes(time: TimeStr | null): number | null {
  const m = time === null ? null : /^(\d{1,2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function myLessons(input: BuddiesInput, date: DateStr): CompareLesson[] {
  const day = input.mine.find((d) => d.date === date);
  return day ? lessonsOfDay(day) : [];
}

function feedFor(input: BuddiesInput, timetable: BuddyTimetable): ClassFeed | null {
  if (timetable.siteUrl === null) return null;
  const own = input.base.feed;
  if (own && own.class.siteUrl === timetable.siteUrl && own.class.classId === timetable.classId) return own;
  return input.feeds.get(buddyFeedKey(timetable.siteUrl, timetable.classId)) ?? null;
}

/** One school, so one period is one hour for both: one site, or, with no site on either side, one Mashov school. */
function samePeriods(input: BuddiesInput, timetable: BuddyTimetable): boolean {
  const mine = input.mySchool;
  if (timetable.siteUrl !== null || mine.siteUrl !== null) return timetable.siteUrl === mine.siteUrl;
  return Boolean(timetable.mashovSchool) && timetable.mashovSchool === mine.mashovSchool;
}

function theirDays(input: BuddiesInput, buddy: Buddy, dates: readonly DateStr[]): Map<DateStr, CompareLesson[]> | null {
  const content = buddy.theirs;
  return content?.timetable ? buddyLessons(content, feedFor(input, content.timetable), input.base, dates) : null;
}

/** One date, the two of us: the lessons, how they compare, and whether the table goes by period. */
interface SideBySide {
  compare: DayCompare;
  mine: CompareLesson[];
  theirs: CompareLesson[];
  byHour: boolean;
}

function sideBySide(input: BuddiesInput, buddy: Buddy, days: Map<DateStr, CompareLesson[]> | null, date: DateStr): SideBySide | null {
  const theirs = days?.get(date);
  const timetable = buddy.theirs?.timetable;
  if (!theirs || !timetable) return null;
  const same = samePeriods(input, timetable);
  const mine = myLessons(input, date);
  const compare = compareDays(mine, theirs, { samePeriods: same });
  return { compare, mine, theirs, byHour: same || compare.by !== 'clock' };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const endOf = (side: SideDay): string => side.end ?? BUDDY_COPY.afterPeriod(side.lastHour);
const startOf = (side: SideDay): string => side.start ?? BUDDY_COPY.atPeriod(side.firstHour);
const spanText = (span: Span): string => (span.by === 'clock' ? `${span.from}–${span.to}` : BUDDY_COPY.periods(span.from, span.to));

/** The end of the day: together, at my end, or each one's. Both sides have a day. */
function endLine(name: string, c: DayCompare, mine: SideDay, theirs: SideDay): string {
  if (c.endTogether) return c.by === 'clock' && mine.end ? BUDDY_COPY.endTogether(mine.end) : BUDDY_COPY.endAfter(mine.lastHour);
  return BUDDY_COPY.ends(name, endOf(theirs), endOf(mine));
}

function startLine(name: string, c: DayCompare, mine: SideDay, theirs: SideDay): string {
  if (c.startTogether) return c.by === 'clock' && mine.start ? BUDDY_COPY.startTogether(mine.start) : BUDDY_COPY.startAt(mine.firstHour);
  return BUDDY_COPY.starts(name, startOf(theirs), startOf(mine));
}

/** The list's line about today, as the sketch has it: ״מסיימים יחד ב־14:00, חלון משותף 11:15״. */
function rowLine(input: BuddiesInput, buddy: Buddy, name: string): string {
  if (!buddy.theirs) return BUDDY_COPY.waitingFirst;
  if (!buddy.theirs.timetable) return '';
  const today = todayOf(input);
  const day = sideBySide(input, buddy, theirDays(input, buddy, [today]), today);
  if (!day) return BUDDY_COPY.notPublished;
  const { compare: c } = day;
  // Their day off, or mine: no school today to compare.
  if (!c.mine || !c.theirs) return BUDDY_COPY.noSchool;
  // No times on one side, and two schools: a period is not set against a time.
  if (c.by === 'none') return BUDDY_COPY.cannotCompare;
  const window = c.windows[0];
  const parts = [endLine(name, c, c.mine, c.theirs)];
  if (window) parts.push(BUDDY_COPY.windowAt(window.by === 'clock' ? window.from : spanText(window)));
  return parts.join(', ');
}

function todayText(line: TodayBuddyLine): string {
  if (line.kind === 'window') {
    const names = buddyNames(line.names);
    const { span } = line;
    return span.by === 'clock' ? BUDDY_COPY.todayWindow(names, `${span.from}–${span.to}`) : BUDDY_COPY.todayWindowPeriods(names, span.from, span.to);
  }
  const names = edgeNames(line.names);
  if (line.kind === 'end') return typeof line.at === 'string' ? BUDDY_COPY.todayEnd(line.at, names) : BUDDY_COPY.todayEndAfter(line.at, names);
  return typeof line.at === 'string' ? BUDDY_COPY.todayStart(line.at, names) : BUDDY_COPY.todayStartAt(line.at, names);
}

// ---------------------------------------------------------------------------
// The models
// ---------------------------------------------------------------------------

/**
 * The list with no friend in it: no line and no shared exam to work out, so
 * nothing of the days is read (`run.ts` builds none for it); the invites, the
 * notes and the name are the state's. What `buddiesModel` gives a parent, too.
 */
export function emptyBuddiesView(state: BuddiesState, audience: Audience): BuddiesView {
  if (audience === 'parent') return { myName: '', rows: [], invites: 0, exams: [], unseen: false, notes: [], full: false };
  return {
    myName: state.myName,
    rows: [],
    invites: state.invites.filter((invite) => !invite.unsent).length,
    exams: [],
    unseen: state.unseen,
    notes: state.notes,
    full: state.buddies.length + state.invites.length + state.answers.length >= MAX_BUDDIES,
  };
}

export function buddiesModel(input: BuddiesInput): BuddiesView {
  const { state } = input;
  if (input.audience === 'parent' || state.buddies.length === 0) return emptyBuddiesView(state, input.audience);
  const today = todayOf(input);
  const rows = state.buddies.map((buddy): BuddyRow => {
    const name = shownName(buddy);
    return {
      id: buddy.id,
      name,
      initial: [...name.trim()][0] ?? '',
      className: buddy.theirs?.timetable?.className ?? null,
      line: rowLine(input, buddy, name),
      waiting: buddy.theirs === null,
    };
  });
  const sharing = state.buddies.flatMap((b) => (b.theirs?.timetable ? [{ name: shownName(b), exams: b.theirs.timetable.exams }] : []));
  return {
    ...emptyBuddiesView(state, input.audience),
    rows,
    exams: examsWithBuddies(examsOf(input.mine, today), sharing, today, input.zone),
  };
}

/** Whether my lessons of `day` are over at `now`: it is at or past the end of the last one held. */
function dayOver(day: DayView, now: TimeStr): boolean {
  const ends = lessonsOfDay(day).filter(held).map((l) => minutes(l.end)).filter((m): m is number => m !== null);
  return ends.length > 0 && (minutes(now) ?? 0) >= Math.max(...ends);
}

/**
 * The date a friend's page opens on: today, or the next day I have school
 * when today is a Friday, a Saturday, a day without school, or my last lesson
 * is over (2.4).
 */
export function buddyPageDate(input: BuddiesInput): DateStr {
  const today = todayOf(input);
  const day = input.mine.find((d) => d.date === today);
  if (sundayIndex(today, input.zone) < 5 && day && holdsSchool(day, input.zone) && !dayOver(day, localNow(input).toFormat('HH:mm'))) return today;
  return nextSchoolDay(today, input.mine, input.zone)?.date ?? today;
}

/** Whether every lesson held has its times. */
const timed = (lessons: readonly CompareLesson[]): boolean => lessons.filter(held).every((l) => minutes(l.start) !== null && minutes(l.end) !== null);

/** Whether a row lies inside a window: by its period, or by its start. */
function within(row: BuddyTableRow, span: Span): boolean {
  if (span.by === 'period') return row.hourIndex >= span.from && row.hourIndex <= span.to;
  const at = minutes(row.start);
  return at !== null && at >= (minutes(span.from) ?? Infinity) && at < (minutes(span.to) ?? -Infinity);
}

/**
 * A window as the table draws it (`TableWindow`). By the clock its periods
 * come from both sides' lessons held around it: at one school a lesson only
 * one of the two has just before the window still takes its period.
 */
function tableWindow(span: Span, index: number, lessons: readonly CompareLesson[]): TableWindow {
  if (span.by === 'period') return { index, from: span.from, to: span.to, start: null };
  const from = minutes(span.from) ?? 0;
  const to = minutes(span.to) ?? 0;
  const before = lessons.filter((l) => (minutes(l.end) ?? Infinity) <= from).map((l) => l.hourIndex);
  const after = lessons.filter((l) => (minutes(l.start) ?? -Infinity) >= to).map((l) => l.hourIndex);
  const first = before.length > 0 ? Math.max(...before) + 1 : after.length > 0 ? Math.min(...after) : 0;
  return { index, from: first, to: after.length > 0 ? Math.min(...after) - 1 : first, start: span.from };
}

/**
 * The page's table: a row for each period (one school), or for each
 * lesson's start (two schools, by the clock: starts less than
 * `TOGETHER_MINUTES` apart share a row). Cancelled lessons keep their rows,
 * marked as the timeline marks them. Each window has its rows: those inside
 * it with no lesson held (a cancelled one), or else one of its own at its
 * first period (or its start), each carrying the window (`TableWindow`).
 */
function tableOf({ compare, mine, theirs, byHour }: SideBySide): BuddyTableRow[] {
  const windows = compare.windows.map((span, i) => tableWindow(span, i, [...mine, ...theirs].filter(held)));
  const slots: { at: number; mine: CompareLesson | null; theirs: CompareLesson | null }[] = [];
  const place = (lesson: CompareLesson, side: 'mine' | 'theirs') => {
    const at = byHour ? lesson.hourIndex : minutes(lesson.start);
    if (at === null) return;
    let slot = slots.find((s) => (byHour ? s.at === at : Math.abs(s.at - at) < TOGETHER_MINUTES));
    if (!slot) slots.push((slot = { at, mine: null, theirs: null }));
    const was = slot[side];
    if (!was || (!held(was) && held(lesson))) slot[side] = lesson;
  };
  for (const lesson of mine) place(lesson, 'mine');
  for (const lesson of theirs) place(lesson, 'theirs');

  const rows = slots.map((slot): BuddyTableRow => {
    const row: BuddyTableRow = {
      hourIndex: (slot.mine ?? slot.theirs)!.hourIndex,
      start: slot.mine?.start ?? slot.theirs?.start ?? null,
      mine: slot.mine,
      theirs: slot.theirs,
      kind: 'apart',
      window: null,
    };
    const mineHeld = held(slot.mine) ? slot.mine : null;
    if (mineHeld && held(slot.theirs) && compare.together.some((t) => t.hourIndex === mineHeld.hourIndex && t.start === mineHeld.start)) {
      row.kind = 'together';
    } else if (!mineHeld && !held(slot.theirs)) {
      const inside = compare.windows.findIndex((span) => within(row, span));
      if (inside >= 0) {
        row.kind = 'window';
        row.window = windows[inside] ?? null;
      }
    }
    return row;
  });
  for (const window of windows) {
    if (rows.some((row) => row.window?.index === window.index)) continue;
    rows.push({ hourIndex: window.from, start: window.start, mine: null, theirs: null, kind: 'window', window });
  }
  const byStart = (a: BuddyTableRow, b: BuddyTableRow) => (minutes(a.start) ?? 0) - (minutes(b.start) ?? 0);
  return rows.sort((a, b) => (byHour ? a.hourIndex - b.hourIndex || byStart(a, b) : byStart(a, b) || a.hourIndex - b.hourIndex));
}

/** Whether a lesson on the next row is the same lesson going on: one subject, one status. */
function goesOn(a: CompareLesson | null, b: CompareLesson | null): boolean {
  return a !== null && b !== null && a.status === b.status && subjectsMatch(a.subject, b.subject);
}

/**
 * What each empty cell of one side says. By period, before the side's first
 * row with a lesson held, or after its last. By the clock, before its first
 * start, or at or after its last end, so a row that starts while their last
 * lesson is still on is not ״סיימו״. A side with no lesson held says nothing.
 */
function emptyCells(table: readonly BuddyTableRow[], byHour: boolean, side: 'mine' | 'theirs'): EmptyCell[] {
  const isHeld = table.map((row) => held(row[side]));
  const first = isHeld.indexOf(true);
  const last = isHeld.lastIndexOf(true);
  const lessons = table.map((row) => row[side]).filter(held);
  const from = Math.min(...lessons.map((l) => minutes(l.start) ?? Infinity));
  const to = Math.max(...lessons.map((l) => minutes(l.end) ?? -Infinity));
  const byClock = !byHour && Number.isFinite(from) && Number.isFinite(to);
  return table.map((row, i): EmptyCell => {
    if (row[side] !== null || first < 0) return null;
    const at = minutes(row.start);
    if (byClock && at !== null) return at < from ? 'notYet' : at >= to ? 'done' : null;
    return i < first ? 'notYet' : i > last ? 'done' : null;
  });
}

/** A window row's lessons that were cancelled (what made the window); none on any other row. */
const cancelledIn = (row: BuddyTableRow): CompareLesson[] =>
  (row.kind === 'window' ? [row.mine, row.theirs].filter((l): l is CompareLesson => l !== null && l.status === 'cancelled') : []);

/** Whether two cancelled lessons are one lesson: one subject, and not two teachers (the rule `compareDays` sits two lessons together by). */
const oneLesson = (a: CompareLesson, b: CompareLesson): boolean => subjectsMatch(a.subject, b.subject) && teachersMatch(a.teacher, b.teacher) !== false;

/**
 * `list` with a window row's cancelled lessons added, each once: a lesson of
 * our class cancelled for both of us, or one over two periods, is named once.
 */
function withCancelled(list: CompareLesson[], row: BuddyTableRow): CompareLesson[] {
  for (const lesson of cancelledIn(row)) if (!list.some((had) => oneLesson(had, lesson))) list.push(lesson);
  return list;
}

/**
 * The page's table as it is drawn (2.4): the rows of one shared window are
 * one line, with the window's own periods and start, and the lessons
 * cancelled in it; the rows of one lesson sat together (a double period) are
 * one line too. Two windows of a day stay two lines, even with no row between.
 */
export function tableLines(page: Pick<BuddyPage, 'table' | 'byHour'>): BuddyTableLine[] {
  const { table, byHour } = page;
  const mineEmpty = emptyCells(table, byHour, 'mine');
  const theirsEmpty = emptyCells(table, byHour, 'theirs');
  const lines: BuddyTableLine[] = [];
  table.forEach((row, i) => {
    const line = lines[lines.length - 1];
    const before = table[i - 1];
    const sameWindow = row.kind === 'window' && before?.kind === 'window' && before.window !== null && before.window.index === row.window?.index;
    const goesOnTogether = row.kind === 'together' && before?.kind === 'together' && goesOn(before.mine, row.mine) && goesOn(before.theirs, row.theirs);
    if (line && (sameWindow || goesOnTogether)) {
      if (sameWindow) {
        withCancelled(line.cancelled, row);
      } else {
        line.from = Math.min(line.from, row.hourIndex);
        line.to = Math.max(line.to, row.hourIndex);
      }
      return;
    }
    const window = row.kind === 'window' ? row.window : null;
    lines.push({
      kind: row.kind,
      from: window?.from ?? row.hourIndex,
      to: window?.to ?? row.hourIndex,
      start: window?.start ?? row.start,
      mine: row.mine,
      theirs: row.theirs,
      mineEmpty: mineEmpty[i] ?? null,
      theirsEmpty: theirsEmpty[i] ?? null,
      cancelled: withCancelled([], row),
    });
  });
  return lines;
}

function summaryOf(name: string, c: DayCompare, isToday: boolean): string[] {
  if (!c.mine || !c.theirs) return isToday && !c.theirs ? [BUDDY_COPY.noSchool] : [];
  const lines = [endLine(name, c, c.mine, c.theirs)];
  if (c.windows.length > 0) lines.push(BUDDY_COPY.windowAt(c.windows.map(spanText).join(', ')));
  lines.push(startLine(name, c, c.mine, c.theirs));
  return lines;
}

/**
 * Their absences: first the subjects we both learn, beside mine; then the rest
 * of theirs (2.4). Both learn it when we sit in it together somewhere in the
 * week, or when it is one of my subjects too: the limit is the subject's, so
 * another group of it, with another teacher at another hour, compares as well.
 */
function absencesFor(input: BuddiesInput, buddy: Buddy, subjects: readonly BuddyAbsence[], days: Map<DateStr, CompareLesson[]> | null, week: readonly DateStr[]): BuddyPage['absences'] {
  const together = week.flatMap((date) => sideBySide(input, buddy, days, date)?.compare.together.map((t) => t.subject) ?? []);
  const mine = absencesOf(attendanceOf(input.base, null)).subjects;
  const isShared = (s: BuddyAbsence) =>
    together.some((subject) => subjectsMatch(subject, s.subject)) || mine.some((m) => subjectsMatch(m.subject, s.subject));
  return {
    shared: subjects.filter(isShared).map((s) => ({ subject: s.subject, mine: mine.find((m) => subjectsMatch(m.subject, s.subject)) ?? null, theirs: s })),
    others: subjects.filter((s) => !isShared(s)),
  };
}

/** Grades are shown only while both of us turned them on, as the protocol writes them (`theirSharesOf`: their box, else their invite). */
function gradesState(mine: BuddyShares, theirs: BuddyShares, box: BuddyGradesContent | null): GradesState {
  if (mine.grades !== true) return theirs.grades === true ? 'theirs' : 'neither';
  if (theirs.grades !== true) return 'mine';
  if (!box) return 'waiting';
  return box.subjects.length === 0 ? 'empty' : 'list';
}

/**
 * The bagrut part. None on a phone with no bagrut, whatever they chose (it is
 * neither asked for nor offered what it cannot share), and none when nobody
 * chose it. Both chose it: the list, once their box is here (`list`, or
 * `empty`, which has questionnaires and no subject) and has the part; none
 * while it has not come.
 */
function bagrutState(mine: BuddyShares, theirs: BuddyShares, state: GradesState, box: BuddyGradesContent | null, myHasBagrut: boolean): BagrutState {
  if (!myHasBagrut) return 'none';
  if (mine.bagrut !== true) return theirs.bagrut === true ? 'theirs' : 'none';
  if (theirs.bagrut !== true) return 'mine';
  return (state === 'list' || state === 'empty') && box?.bagrut ? 'list' : 'none';
}

/**
 * The grades tab (grades spec 2.2 to 2.4). What this phone still keeps of their
 * grades is shown only while the rule that writes them holds, so a box kept from
 * before one of us turned them off is not, nor their bagrut part unless both
 * chose it. My side is empty when Mashov was never read here: all of theirs then
 * are the rest of theirs (`compareGrades`).
 */
function gradesPage(input: BuddiesInput, buddy: Buddy): BuddyGrades {
  const mine = buddy.shares;
  const theirs = theirSharesOf(buddy);
  const box = buddy.theirGrades;
  const state = gradesState(mine, theirs, box);
  const bagrut = bagrutState(mine, theirs, state, box, input.myHasBagrut);
  const asked = (theirs.grades === true && mine.grades !== true) || (theirs.bagrut === true && mine.bagrut !== true && input.myHasBagrut);
  let compare: GradesCompare | null = null;
  // `empty` has no subject to list, but the bagrut part is a list of its own.
  if (box && (state === 'list' || bagrut === 'list')) {
    const { bagrut: _bagrut, ...withoutBagrut } = box;
    compare = compareGrades(input.myGrades ?? { v: 1, at: input.now.toISOString(), subjects: [] }, bagrut === 'list' ? box : withoutBagrut);
  }
  return { state, compare, bagrut, from: state === 'list' || state === 'empty' ? (box?.from ?? null) : null, dot: buddy.gradesDot && asked };
}

/** A friend's page on `date`, or the day it opens on (`buddyPageDate`); `null` for a friend not on this phone, or a parent. */
export function buddyPageModel(input: BuddiesInput, id: string, date?: DateStr): BuddyPage | null {
  if (input.audience === 'parent') return null;
  const buddy = input.state.buddies.find((b) => b.id === id);
  if (!buddy) return null;
  const on = date ?? buddyPageDate(input);
  const today = todayOf(input);
  const theirs = buddy.theirs;
  const timetable = theirs?.timetable;
  const sunday = weekStart(on, 0, input.zone);
  const week = Array.from({ length: 7 }, (_v, i) => addDays(sunday, i, input.zone));
  const days = theirDays(input, buddy, week);
  const day = sideBySide(input, buddy, days, on);
  const c = day?.compare ?? null;
  // Two schools and no times on one side: only `noTimes` is said, and no day is set against the other.
  const noTimes = day && c?.by === 'none' && c.mine && c.theirs ? (timed(day.mine) ? 'theirs' : 'mine') : null;
  const shown = noTimes ? null : day;
  return {
    id,
    name: shownName(buddy),
    className: timetable?.className ?? null,
    date: on,
    closesLink: removalClosesLink(input.state, buddy),
    compare: c,
    summary: shown ? summaryOf(shownName(buddy), shown.compare, on === today) : [],
    table: shown ? tableOf(shown) : [],
    byHour: shown?.byHour ?? true,
    exams: timetable ? compareExams(examsOf(input.mine, today), timetable.exams, today, input.zone) : null,
    absences: theirs?.absences ? absencesFor(input, buddy, theirs.absences.subjects, days, week) : null,
    updatedAt: theirs?.at ?? null,
    theirShares: theirs?.shares ?? NOTHING,
    myShares: buddy.shares,
    noTimes,
    unpublished: days !== null && !days.has(on),
    grades: gradesPage(input, buddy),
  };
}

/**
 * The lines under Today's "now" card for `date` (2.2): `todayBuddyLines` in
 * words, each opening the first friend it names. The end line goes once my
 * day is over. On another date than today, as if before its start (ahead) or
 * after its end (past).
 */
export function todayLinesModel(input: BuddiesInput, date: DateStr): TodayLine[] {
  if (input.audience === 'parent') return [];
  const today = todayOf(input);
  const now = date === today ? localNow(input).toFormat('HH:mm') : date < today ? '23:59' : '00:00';
  const days = input.state.buddies.flatMap((buddy) => {
    const day = sideBySide(input, buddy, theirDays(input, buddy, [date]), date);
    return day ? [{ id: buddy.id, name: shownName(buddy), compare: day.compare }] : [];
  });
  return todayBuddyLines(days, now)
    .filter((line) => !(line.kind === 'end' && typeof line.at === 'string' && (minutes(now) ?? 0) >= (minutes(line.at) ?? Infinity)))
    .map((line): TodayLine => ({ text: todayText(line), kind: line.kind, buddyId: line.ids[0] ?? '', buddyIds: line.ids }));
}
