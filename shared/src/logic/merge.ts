/**
 * The merged timetable (design-doc §9), as rows: the class's site where it has
 * published, the student's own weekly grid from Mashov where it has not.
 * Pure, and shared: the server projects with it today, the phone will build
 * its own day with it (plan Phase 2).
 */
import type { ClassLesson, DateStr } from '../index';
import { schoolDayInfo, sundayIndex, weekStart } from './time';

/**
 * The days the lessons are built for, around today: a week back, three ahead.
 * The phone builds its days over it, and Mashov's timetable changes are read
 * for the same days.
 */
export const LESSON_HORIZON = { back: 7, ahead: 21 } as const;

/** One slot of the student's recurring week, as Mashov's timetable gives it. */
export interface TimetableSlot {
  /** 0 = Sunday. */
  dayOfWeek: number;
  hourIndex: number;
  subject: string;
  teacher: string | null;
  room: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Mashov's group, which its timetable changes are matched by. Absent in reads kept before it was. */
  groupId?: string | null;
}

/**
 * One of Mashov's own timetable changes, on one date and period, for one
 * group (`mashov/timetableChanges.ts`). The lesson's details are filled in
 * when it is read, so a moved-in or extra lesson can be shown without the grid.
 */
export interface TimetableChange {
  date: DateStr;
  hourIndex: number;
  groupId: string;
  kind: 'substitute' | 'cancelled' | 'online' | 'moved' | 'extra';
  subject: string | null;
  /** The substitute, for `substitute`; otherwise the lesson's teacher when Mashov names one. */
  teacher: string | null;
  room: string | null;
  startTime: string | null;
  endTime: string | null;
}

/** One Shahaf lesson snapshot in the horizon: its day, and the lesson unless it was withdrawn. */
export interface ShahafSighting {
  date: DateStr;
  lesson: ClassLesson | null;
}

/**
 * The lesson rows for each date of the horizon. Pure, so the projection rules
 * are tested without a database:
 *
 * - A date with live Shahaf lessons gets exactly those.
 * - Shahaf publishes by the week, and a published week is the site's to
 *   describe in full: an empty day inside it is a holiday or a strike, not a
 *   gap, and stays empty. A week counts as published when Shahaf has, or had,
 *   any lesson in it — or in any later week of the horizon, since the site
 *   publishes from the current week forward and an empty week before a
 *   published one was published empty (a vacation).
 * - The weeks after the last published one are projected from Mashov's
 *   recurring grid, on school days only (no Shabbat, no chag, no summer). With
 *   no Shahaf data at all, that is every week of the horizon — the old
 *   all-or-nothing fallback, now holiday-aware.
 * - Never past the horizon, and never a slot the grid does not have, except
 *   a lesson Mashov's own changes move in or add.
 * - Mashov's timetable changes apply to the projected dates only
 *   (`applyMashovChanges`): a date the site describes is the site's.
 */
export function planLessonRows(
  dates: DateStr[],
  shahaf: ShahafSighting[],
  slots: TimetableSlot[],
  zone: string,
  changes: readonly TimetableChange[] = [],
): LessonRow[] {
  const lastPublished = lastPublishedWeek(shahaf, zone);

  const byDate = new Map<DateStr, ClassLesson[]>();
  for (const { lesson } of shahaf) {
    if (!lesson) continue;
    const list = byDate.get(lesson.date) ?? [];
    list.push(lesson);
    byDate.set(lesson.date, list);
  }

  return dates.flatMap((date): LessonRow[] => {
    const fromShahaf = byDate.get(date);
    if (fromShahaf && fromShahaf.length > 0) {
      return fromShahaf.map((l) => ({ ...toRow(l), source: 'shahaf' }));
    }
    if (!isProjectable(date, lastPublished, zone)) return [];
    const dow = sundayIndex(date, zone);
    const cells = slots
      .filter((s) => s.dayOfWeek === dow)
      .map((s): GridCell => ({
        groupId: s.groupId ?? null,
        row: {
          date,
          hourIndex: s.hourIndex,
          // Resolved from Mashov's /api/bells when the school publishes one.
          startTime: s.startTime,
          endTime: s.endTime,
          subject: s.subject,
          teacher: s.teacher,
          room: s.room,
          status: 'regular',
          substitute: null,
          note: null,
          source: 'mashov',
        },
      }));
    return applyMashovChanges(date, cells, changes);
  });
}

/** A lesson of the grid on a projected date, with the group Mashov's changes are matched by. */
interface GridCell {
  groupId: string | null;
  row: LessonRow;
}

/** What a moved or added lesson says about itself, in the lesson's details. */
const MOVED_NOTE = 'השיעור הועבר לשעה הזאת';
const EXTRA_NOTE = 'שיעור שנוסף למערכת';

/**
 * Mashov's timetable changes on one projected date, applied to the grid the
 * way Mashov's own student site applies them, in two passes:
 *
 * 1. A moved, added or extra lesson is a lesson of its own in that period,
 *    unless the grid already has that group there: then that lesson takes the
 *    change. An added or extra lesson shows as `moved`, the status the site's
 *    own catch-all change already uses: it happens, but not where the grid
 *    says, and `regular` would hide it while `event` is not a lesson. A move
 *    marks only where the lesson went, as the site does: Mashov is expected to
 *    send a cancellation for the period it left, and none is made up here.
 * 2. Then a substitute, a cancellation or an online lesson changes the lesson
 *    of that group in that period, the grid's or one the first pass moved in
 *    or added, and nothing else: a change whose group is not there is
 *    dropped. A cancellation wins over everything, as the site shows an
 *    online lesson that is also cancelled as cancelled, and an added lesson
 *    that is also cancelled as cancelled.
 */
function applyMashovChanges(date: DateStr, cells: GridCell[], changes: readonly TimetableChange[]): LessonRow[] {
  const onDate = changes.filter((c) => c.date === date);
  if (onDate.length === 0) return cells.map((c) => c.row);

  const cellOf = (c: TimetableChange) => cells.find((cell) => cell.groupId === c.groupId && cell.row.hourIndex === c.hourIndex);
  const gridSize = cells.length;

  for (const change of onDate) {
    if (change.kind !== 'moved' && change.kind !== 'extra') continue;
    const note = change.kind === 'moved' ? MOVED_NOTE : EXTRA_NOTE;
    const cell = cellOf(change);
    if (cell) {
      // A lesson the grid already has there is not a second lesson.
      if (cell.row.status === 'regular') cell.row = { ...cell.row, status: 'moved', note };
      continue;
    }
    if (!change.subject) continue;
    // Kept among the cells, so a second change of the same lesson marks it rather than adding it again.
    cells.push({
      groupId: change.groupId,
      row: {
        date,
        hourIndex: change.hourIndex,
        startTime: change.startTime,
        endTime: change.endTime,
        subject: change.subject,
        teacher: change.teacher,
        room: change.room,
        status: 'moved',
        substitute: null,
        note,
        source: 'mashov',
      },
    });
  }

  for (const change of onDate) {
    if (change.kind === 'moved' || change.kind === 'extra') continue;
    const cell = cellOf(change);
    if (!cell || cell.row.status === 'cancelled') continue;
    // A moved-in or added lesson keeps its note: it says why the lesson is in this period at all.
    if (change.kind === 'cancelled') cell.row = { ...cell.row, status: 'cancelled', substitute: null };
    else if (change.kind === 'online') cell.row = { ...cell.row, status: 'remote', substitute: null };
    else cell.row = { ...cell.row, status: 'substitution', substitute: change.teacher };
  }

  const rows = cells.map((c) => c.row);
  // An added lesson takes its period's place among the grid's.
  return cells.length === gridSize ? rows : rows.sort((a, b) => a.hourIndex - b.hourIndex);
}

/** Sunday of the latest week Shahaf has published into, or null when it has published nothing. */
function lastPublishedWeek(shahaf: ShahafSighting[], zone: string): DateStr | null {
  let last: DateStr | null = null;
  for (const { date } of shahaf) {
    const week = weekStart(date, 0, zone);
    if (last === null || week > last) last = week;
  }
  return last;
}

function isProjectable(date: DateStr, lastPublished: DateStr | null, zone: string): boolean {
  if (lastPublished !== null && weekStart(date, 0, zone) <= lastPublished) return false;
  return schoolDayInfo(date, zone).isSchoolDay;
}

/** Whether any date would take grid lessons — saves loading the grid when none would. */
export function needsGrid(dates: DateStr[], shahaf: ShahafSighting[], zone: string): boolean {
  const lastPublished = lastPublishedWeek(shahaf, zone);
  return dates.some((d) => isProjectable(d, lastPublished, zone));
}

export interface LessonRow {
  date: string;
  hourIndex: number;
  startTime: string | null;
  endTime: string | null;
  subject: string;
  teacher: string | null;
  room: string | null;
  status: string;
  substitute: string | null;
  note: string | null;
  source: string;
}

function toRow(l: ClassLesson) {
  return {
    date: l.date,
    hourIndex: l.hourIndex,
    startTime: l.startTime,
    endTime: l.endTime,
    subject: l.subject,
    teacher: l.teacher,
    room: l.room,
    status: l.status,
    substitute: l.substitute,
    note: l.note,
  };
}
