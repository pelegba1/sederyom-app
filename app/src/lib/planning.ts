/**
 * Pure logic behind the week screen and the "תכנון" tab (plan A5, R6): week
 * titles, the exam tag in the week grid and how wide its labels are, the day
 * detail's order, and the month grid's marks and lists, all read off the
 * server's views.
 *
 * Only `import type` from `@sederyom/shared`: the tests load this file through
 * Babel, and a value import of the workspace package would not resolve there.
 *
 * Classroom work (plan 14.5, run 7) joins what is due wherever these show it:
 * the planning tab's day and 14-day lists and its month marks
 * (`agendaWithClassroom`, `dayAgendaItems`), and the week's "להגשה" chip, its
 * square and the strip of a Friday left out (`homeworkDueNames`). The shared
 * `AgendaItem` has no kind for it, so the planning tab's rows are `PlanItem`.
 */
import type { AgendaItem, AgendaView, ClassroomWork, DateStr, DayView, Exam, ExamOption, SchoolEvent, TimelineItem } from '@sederyom/shared';
import { MIN_FONT_SIZE } from '../theme';
import type { ColorScheme } from '../theme';
import { isClassroomDone, selectClassroom, workSubject } from './classroom';
import { addDays, dayTitle, formatShortDate, plural, shortShownSubject, shortSubject, shownSubject, stripGroup, weekdayName, weekRangeLabel } from './format';

/**
 * A week the school site has not published yet is filled in from the fixed
 * Mashov timetable (`DayView.projected`). Say that, rather than "צפוי": a
 * 14-year-old read "צפוי" as a forecast, "maybe it happens, maybe not" (R-29).
 */
export const PROJECTED_LABEL = 'לפי המערכת הקבועה';
/**
 * The note under the week grid when the week is projected: two facts, not the
 * screen explaining itself ("אז מוצגת…", plan §16.2).
 */
export const PROJECTED_NOTE = 'האתר עוד לא פרסם את השבוע הזה. השיעורים לפי המערכת הקבועה.';
/**
 * The same for a student who went on without a site (plan Phase 3): every
 * week is projected, and no site is waited for, so none is mentioned.
 */
export const PROJECTED_NOTE_WITHOUT_SITE = 'השיעורים לפי המערכת הקבועה ממשוב.';

/** The note for a projected week: `PROJECTED_NOTE`, or its words without a site. */
export function projectedNote(withoutSite: boolean): string {
  return withoutSite ? PROJECTED_NOTE_WITHOUT_SITE : PROJECTED_NOTE;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`): calendar arithmetic, no clock and no DST. */
export function daysBetween(from: DateStr, to: DateStr): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

/** The Sunday that starts the week containing `date`. */
export function sundayOf(date: DateStr): DateStr {
  return addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
}

/**
 * Weeks from the week containing `today` to the one containing `date` — the
 * server's `/week?offset=`. Measured Sunday to Sunday, so a Friday looking at
 * next Tuesday still says "next week".
 */
export function weekOffsetOf(date: DateStr, today: DateStr): number {
  return Math.round(daysBetween(sundayOf(today), sundayOf(date)) / 7);
}

/** "08:00" or "8:00:00" → minutes from midnight; `null` when it is no clock time. */
function clockMinutes(time: string | null | undefined): number | null {
  const m = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** When school counts as over on a day whose lessons carry no end time: 16:00. */
export const SCHOOL_OVER_FALLBACK = 16 * 60;

/**
 * Whether the week tab opens on next week (W5-17): once this week's school is
 * over — after the last lesson that takes place, on its day (Thursday, or a
 * Friday with lessons) — and all through Saturday. On Thursday at 21:00 the
 * tab showed 4–9.10, a week already done, and "שבוע הבא" was a small link
 * in the corner (Itai, run 4).
 *
 * `days` is this week's view (`/week?offset=0`), or `null` while it loads:
 * then only Friday and Saturday are sure. A week without a lesson that takes
 * place (a holiday week) is over from Thursday. `nowMinutes` is the local
 * time of day in minutes; a day whose lessons have no end time is over from
 * `SCHOOL_OVER_FALLBACK`. A link to a date, or a week the student paged to,
 * comes before this: the screen asks only while nothing was chosen.
 */
export function opensOnNextWeek(
  days: readonly Pick<DayView, 'date' | 'timeline'>[] | null,
  today: DateStr,
  nowMinutes: number,
): boolean {
  const weekday = weekdayIndex(today);
  if (weekday === 6) return true;
  if (!days) return weekday === 5;
  const held = (day: Pick<DayView, 'timeline'>) => day.timeline.flatMap((i) => (
    i.kind === 'lesson' && i.lesson.status !== 'cancelled' ? [i.lesson] : []
  ));
  const taught = days.filter((d) => held(d).length > 0).sort((a, b) => a.date.localeCompare(b.date));
  const last = taught[taught.length - 1];
  if (!last) return weekday >= 4;
  if (today < last.date) return false;
  if (today > last.date) return true;
  const ends = held(last).map((l) => clockMinutes(l.endTime)).filter((m): m is number => m !== null);
  return nowMinutes >= (ends.length > 0 ? Math.max(...ends) : SCHOOL_OVER_FALLBACK);
}

/**
 * The text size — the phone's times the app's — from which the week is a list
 * of days, not a grid (W5-17). Six columns hold one short word each: at
 * "גדול מאוד" the grid stayed at 1.15 while the rest of the app grew to 1.3
 * (Daniel, run 4: "דווקא זה המסך הכי צפוף"), and drawn at 1.3 and past it the
 * short forms are cut to two or three letters ("מח׳", "רש׳").
 */
export const WEEK_LIST_SCALE = 1.3;

/** Whether the week is drawn as a list of days at this text size (`WEEK_LIST_SCALE`). */
export function weekListMode(fontScale: number, appScale = 1): boolean {
  return Math.max(fontScale, 1) * Math.max(appScale, 1) >= WEEK_LIST_SCALE - 1e-9;
}

/** Sunday and Friday of the week `offset` weeks from the one containing `today`. */
export function weekBounds(offset: number, today: DateStr): { startDate: DateStr; endDate: DateStr } {
  const startDate = addDays(sundayOf(today), offset * 7);
  return { startDate, endDate: addDays(startDate, 5) };
}

/** Where a week stands from now: "השבוע", "שבוע הבא", "בעוד שבועיים" — never "שבוע +2". */
export function weekSubtitle(offset: number): string {
  if (offset === 0) return 'השבוע';
  if (offset === 1) return 'שבוע הבא';
  if (offset === 2) return 'בעוד שבועיים';
  if (offset === -1) return 'שבוע שעבר';
  if (offset === -2) return 'לפני שבועיים';
  return offset > 0 ? `בעוד ${offset} שבועות` : `לפני ${-offset} שבועות`;
}

/**
 * The week screen's header: the dates as the title ("18–23.10", render it
 * through `Ltr`), where the week stands as the subtitle, and its exams when
 * it has any ("בעוד שבועיים, 2 מבחנים").
 *
 * `autoNext`: the tab opened on next week by itself, because this week's
 * school is over (`opensOnNextWeek`). The subtitle then says why, in the same
 * line: "שבוע הבא. השבוע נגמר" (run 8: two testers thought a week had been
 * skipped once the sentence that said so was gone).
 */
export function weekHeading(
  offset: number,
  startDate: DateStr,
  endDate: DateStr,
  days: readonly Pick<DayView, 'examsToday'>[] = [],
  autoNext = false,
): { title: string; subtitle: string } {
  const exams = days.reduce((n, d) => n + d.examsToday.length, 0);
  const where = exams > 0 ? `${weekSubtitle(offset)}, ${plural(exams, 'מבחן אחד', 'מבחנים')}` : weekSubtitle(offset);
  const subtitle = autoNext && offset === 1 ? `${where}. ${WEEK_OVER}` : where;
  return { title: weekRangeLabel(startDate, endDate), subtitle };
}

/** Why the week tab shows next week by itself (`weekHeading`'s `autoNext`). */
export const WEEK_OVER = 'השבוע נגמר';

export interface ExamTag {
  /** "מבחן אנג׳" for the first exam — what the tag says. */
  text: string;
  /** The subject alone ("אנג׳"), for a tag drawn on two lines. */
  subject: string;
  /** How many more exams the day has beyond the first. */
  more: number;
  /** The full subjects, for the screen reader. */
  label: string;
}

/**
 * The exam tag in a week-grid day header (B10): "מבחן" and the subject in
 * its short form, never "מבחן מבחן" — `shortSubject` reads the subject out of
 * an exam title ("מתכונת באנגלית" → "אנג׳"). A name the student gave is
 * theirs, as typed: the subject's (`subjectName`), else the exam's own.
 * `null` on a day without exams.
 */
export function examTag(exams: readonly Pick<Exam, 'subject' | 'originalSubject' | 'subjectName'>[]): ExamTag | null {
  const first = exams[0];
  if (!first) return null;
  const subject = first.subjectName ?? shortShownSubject(first);
  const label = exams.length === 1
    ? `מבחן: ${first.subject}`
    : `${plural(exams.length, 'מבחן אחד', 'מבחנים')}: ${exams.map((e) => e.subject).join(', ')}`;
  return { text: `מבחן ${subject}`, subject, more: exams.length - 1, label };
}

/**
 * A day's rows in time order, lessons and events interleaved the way "היום
 * שלי" shows them (B12): all-day events first, then lessons and timed events
 * by start time, tasks last. The server sends them sorted already; this keeps
 * the order stable and correct whatever arrives.
 */
export function timelineInOrder(timeline: readonly TimelineItem[]): TimelineItem[] {
  return timeline
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.sortKey < b.item.sortKey ? -1 : a.item.sortKey > b.item.sortKey ? 1 : a.index - b.index))
    .map(({ item }) => item);
}

/** "יום שלישי, 20.10.2026" (`dayTitle`) cut in two, so the date can go through `Ltr`. */
export function dayTitleParts(date: DateStr): { name: string; date: string } {
  const title = dayTitle(date);
  const at = title.lastIndexOf(', ');
  return at < 0 ? { name: title, date: '' } : { name: title.slice(0, at), date: title.slice(at + 2) };
}

/** How long a task's own title may run as a name in "להגשה: …" when it carries no subject. */
const LINKED_NAME_MAX = 30;

/**
 * The subject a task made from homework names: "הוסף למשימות שלי" titles it
 * "אנגלית: לקרוא את הטקסט ביחידה 3", so the part before the first ": ". A
 * title without one (renamed since) is the name itself, cut to
 * `LINKED_NAME_MAX` with "…".
 */
export function linkedTaskSubject(title: string): string {
  const line = title.replace(/\s+/g, ' ').trim();
  const at = line.indexOf(': ');
  if (at > 0) return line.slice(0, at).trim();
  return line.length > LINKED_NAME_MAX ? `${line.slice(0, LINKED_NAME_MAX - 1).trimEnd()}…` : line;
}

/** A day as the week's due line reads it: its date, its homework and its tasks. */
type DueDay = Partial<Pick<DayView, 'date' | 'homework' | 'timeline'>>;

/**
 * What is due on a day and still open, by subject, each once: homework not
 * ticked off, then the day's open Classroom work, then every open task made
 * from homework (`linkedHomeworkKey`). The day view leaves out homework that
 * became a task — the task stands for it (R-5) — so the week's square and
 * "להגשה" went with it the moment it was added to the tasks, while "היום
 * שלי" still listed it (Noa, run 5).
 *
 * `classroom` is the open work (`classroomDueWork`); what is due on `day.date`
 * is named by its subject, as homework is: the chip has room for a word, and
 * "תרגיל בית 3 · וקטורים" is in planning, whole (run 7, Noa: the week said
 * only "להגשה: אנגלית").
 */
export function homeworkDueNames(day: DueDay, classroom: readonly ClassroomWork[] = []): string[] {
  // `?? []`: a server older than the contract sends no `homework`.
  const homework = (day.homework ?? []).filter((h) => !h.done).map((h) => shownSubject(h));
  const work = classroom.filter((w) => w.dueDate !== null && w.dueDate === day.date).map((w) => stripGroup(workSubject(w)));
  const linked = (day.timeline ?? []).flatMap((i) => (
    i.kind === 'task' && !i.task.completed && i.task.linkedHomeworkKey ? [linkedTaskSubject(i.task.title)] : []
  ));
  return [...new Set([...homework, ...work, ...linked].filter(Boolean))];
}

/** Whether a day has homework due and still open (`homeworkDueNames`): the square in its week-grid header. */
export function hasHomeworkDue(day: DueDay, classroom: readonly ClassroomWork[] = []): boolean {
  return homeworkDueNames(day, classroom).length > 0;
}

/**
 * "להגשה: פיזיקה, אנגלית" — the homework due on a day and still open
 * (`homeworkDueNames`), for the week's day detail: the grid's header has only
 * a square for it. `null` when there is none.
 */
export function homeworkDueLabel(day: DueDay, classroom: readonly ClassroomWork[] = []): string | null {
  const names = homeworkDueNames(day, classroom);
  return names.length > 0 ? `להגשה: ${names.join(', ')}` : null;
}

/**
 * A day's lessons in one muted line for the planning tab: "6 שיעורים, 2
 * שינויים, לפי המערכת הקבועה". Commas, not a chain of "·" (plan §16.2).
 */
export function lessonSummary(day: Pick<DayView, 'isSchoolDay' | 'holidayName' | 'timeline' | 'changeCount' | 'projected'>): string {
  if (!day.isSchoolDay) return day.holidayName ?? 'אין לימודים';
  const lessons = day.timeline.filter((i) => i.kind === 'lesson');
  if (lessons.length === 0) return 'אין עדיין מערכת ליום הזה';
  const held = lessons.filter((i) => i.kind === 'lesson' && i.lesson.status !== 'cancelled').length;
  const parts = [plural(held, 'שיעור אחד', 'שיעורים')];
  if (day.changeCount > 0) parts.push(plural(day.changeCount, 'שינוי אחד', 'שינויים'));
  if (day.projected) parts.push(PROJECTED_LABEL);
  return parts.join(', ');
}

/**
 * Where the planning tab's timetable row leads; the row says so (R-28). "ב"
 * and "היום שלי", the tab's name, make "ביום שלי": no quotation marks needed.
 */
export const OPEN_IN_TODAY = 'לפתוח ביום שלי';

/**
 * The planning tab's timetable row: "מערכת השעות" as its title, the summary
 * muted under it, and where tapping it leads at its end; all of it for the
 * screen reader. Testers tapped it expecting more of the planning tab and
 * landed on Today. `withoutSite`: the student went on without a site.
 */
export function lessonsRowCopy(
  day: Pick<DayView, 'isSchoolDay' | 'holidayName' | 'timeline' | 'changeCount' | 'projected'>,
  withoutSite = false,
): { title: string; summary: string; note: string | null; action: string; label: string } {
  const summary = lessonSummary(day);
  // "לפי המערכת הקבועה" alone left Maya unsure what it meant (run 3): say why.
  const note = day.projected && day.isSchoolDay && day.timeline.some((i) => i.kind === 'lesson') ? projectedNote(withoutSite) : null;
  const sentences = [`מערכת השעות: ${summary}`, note, OPEN_IN_TODAY].filter((s): s is string => Boolean(s));
  return {
    title: 'מערכת השעות',
    summary,
    note,
    action: OPEN_IN_TODAY,
    // Sentences, not a dash (plan §16.2): "מערכת השעות: 6 שיעורים. לפתוח ביום שלי".
    label: sentences.map((s) => s.replace(/\.$/, '')).join('. '),
  };
}

/**
 * The lesson sheet's button, "משימה לשיעור של רביעי": a task for the next
 * day the subject is taught (`nextLessonDate`), named by that day — "היום",
 * "מחר", or its weekday without "יום". One plain phrase, no "·" (Wave 9
 * re-rate). The week grid and "היום שלי" both take it from here.
 */
export function nextLessonTaskLabel(next: DateStr, today: DateStr): string {
  const day = next === today ? 'היום' : next === addDays(today, 1) ? 'מחר' : weekdayName(next).replace(/^יום /, '');
  return `משימה לשיעור של ${day}`;
}

// ---------------------------------------------------------------------------
// Week grid: labels that fit their cell
// ---------------------------------------------------------------------------

/**
 * Advance widths in thousandths of an em, read from the fonts the grid and
 * the tab rows draw with (`Assistant_500Medium.ttf` and
 * `Assistant_600SemiBold.ttf` in @expo-google-fonts/assistant): the Hebrew
 * letters, geresh and gershayim, the digits and the few marks a label can
 * hold. Width is linear in the font size, so this measures a label exactly
 * enough to choose its size before drawing it. `app/scripts/font-widths.cjs`
 * prints these tables from the font files; `planning.test.cjs` checks them.
 */
const ASSISTANT_MEDIUM: Readonly<Record<string, number>> = {
  'א': 573, 'ב': 530, 'ג': 384, 'ד': 537, 'ה': 552, 'ו': 232, 'ז': 364, 'ח': 570, 'ט': 562, 'י': 232,
  'ך': 505, 'כ': 474, 'ל': 481, 'ם': 582, 'מ': 613, 'ן': 232, 'נ': 371, 'ס': 574, 'ע': 541, 'ף': 551,
  'פ': 544, 'ץ': 481, 'צ': 526, 'ק': 558, 'ר': 476, 'ש': 641, 'ת': 611, '׳': 226, '״': 403, ' ': 200,
  '+': 499, "'": 253, '"': 434, '-': 312, '.': 253, ',': 253, '·': 253, '(': 306, ')': 306, ':': 253,
  '0': 499, '1': 457, '2': 499, '3': 499, '4': 499, '5': 499, '6': 499, '7': 499, '8': 499, '9': 499,
};
const ASSISTANT_SEMIBOLD: Readonly<Record<string, number>> = {
  'א': 586, 'ב': 534, 'ג': 395, 'ד': 539, 'ה': 558, 'ו': 240, 'ז': 367, 'ח': 578, 'ט': 570, 'י': 240,
  'ך': 507, 'כ': 478, 'ל': 486, 'ם': 585, 'מ': 621, 'ן': 240, 'נ': 374, 'ס': 583, 'ע': 551, 'ף': 555,
  'פ': 548, 'ץ': 496, 'צ': 536, 'ק': 567, 'ר': 480, 'ש': 652, 'ת': 618, '׳': 239, '״': 418, ' ': 200,
  '+': 506, "'": 264, '"': 458, '-': 317, '.': 264, ',': 264, '·': 264, '(': 315, ')': 315, ':': 264,
  '0': 506, '1': 463, '2': 506, '3': 506, '4': 506, '5': 506, '6': 506, '7': 506, '8': 506, '9': 506,
};
/** Anything outside the tables (a Latin letter, say) is measured as a wide letter, never too narrow. */
const UNKNOWN_ADVANCE = 700;
/** Isolate and mark characters draw nothing. */
const ZERO_WIDTH = /[‎‏⁦-⁩]/;

export type GridWeight = 'medium' | 'semi';

/** The drawn width of `text` in Assistant at `fontSize`, in points. */
export function textWidth(text: string, fontSize: number, weight: GridWeight = 'medium'): number {
  const table = weight === 'semi' ? ASSISTANT_SEMIBOLD : ASSISTANT_MEDIUM;
  let units = 0;
  for (const ch of text) if (!ZERO_WIDTH.test(ch)) units += table[ch] ?? UNKNOWN_ADVANCE;
  return (units / 1000) * fontSize;
}

/**
 * The week grid's geometry, in the order it eats a day column's width. The
 * screen's styles are built from these, so the measure and the drawing agree.
 */
export const WEEK_GRID = {
  /** The ScrollView's side padding (`space.md`). */
  sidePadding: 12,
  /** The grid's border, each side. */
  border: 1,
  /** The grid's inner padding, each side. */
  padding: 4,
  /** The period column at its narrowest, a number alone; with start times it grows to fit them (`hourColumnWidth`). */
  hourColumn: 24,
  /** Room on each side of a start time in the period column. */
  hourPadding: 3,
  /**
   * Taken from each side of a day column before the text: a lesson cell's
   * padding, border and inner padding, or a day header's margin, an exam
   * tag's border and its inner padding — 1 + 1 + 1 either way.
   */
  columnInset: 3,
  /** A rounding pixel, so a label measured to fit is never clipped by a fraction. */
  slack: 1,
  /**
   * The grid's text grows with the phone's text size up to this factor. Six
   * columns on a phone hold one short word each; the day detail under the
   * grid, and the lesson sheet a cell opens, carry the full names at any size.
   */
  maxFontScale: 1.3,
  /** The in-app text size (W4-2) reaches the grid up to this factor (`maxScale` on its text). */
  maxAppScale: 1.15,
} as const;

/**
 * The grid's usual size: the type scale's `caption` (plan §16). Run 8: at 13
 * the grid's names were the smallest text in the app, since Assistant at 13
 * draws like Heebo did at 12. Six columns on a phone hold one short word
 * each, so the grid steps down to 13 and then to the floor whenever that
 * writes more of its subjects whole (`gridLabels`, `gridFontSize`).
 */
export const GRID_FONT_SIZE = 14;

/** The sizes the grid tries, largest first: its usual size, one step down, then the hard floor. Never smaller. */
export const GRID_FONT_SIZES: readonly number[] = [GRID_FONT_SIZE, 13, MIN_FONT_SIZE];

/**
 * The width a label has inside one day column of the grid, on a window
 * `windowWidth` wide, with `dayCount` days and a period column `hourColumn` wide.
 */
export function gridTextWidth(windowWidth: number, dayCount = 6, hourColumn: number = WEEK_GRID.hourColumn): number {
  const g = WEEK_GRID;
  const column = (windowWidth - 2 * (g.sidePadding + g.border + g.padding) - hourColumn) / Math.max(1, dayCount);
  return column - 2 * g.columnInset - g.slack;
}

/**
 * The text-size factor the grid's own text is drawn at: the phone's, capped
 * at `WEEK_GRID.maxFontScale`, times the app's own setting, capped at
 * `WEEK_GRID.maxAppScale`.
 */
export function gridFontScale(fontScale: number, appScale = 1): number {
  return Math.min(Math.max(fontScale, 1), WEEK_GRID.maxFontScale) * Math.min(Math.max(appScale, 1), WEEK_GRID.maxAppScale);
}

// ---------------------------------------------------------------------------
// Week grid: the period column, the days shown, one label per subject (W4-9)
// ---------------------------------------------------------------------------

/**
 * The size of a start time under its period number: a step over the floor
 * (run 8: the times were the app's smallest text). The period column grows
 * to fit them (`hourColumnWidth`).
 */
export const HOUR_TIME_SIZE = 13;

/**
 * When each period starts this week, for the period column ("1" over
 * "08:00"): the start time most of its lessons have — Friday's shorter
 * periods do not move the rest — the earlier one on a tie. A period no
 * lesson gives a time for has none. Daniel planned his afternoons by the
 * clock, and period numbers alone did not tell him when (run 3).
 */
export function periodStartTimes(days: readonly Pick<DayView, 'timeline'>[]): Record<number, string> {
  const counts = new Map<number, Map<string, number>>();
  for (const day of days) {
    for (const item of day.timeline) {
      const clock = item.kind === 'lesson' && item.lesson.startTime ? /^(\d{1,2}):(\d{2})/.exec(item.lesson.startTime) : null;
      if (item.kind !== 'lesson' || !clock) continue;
      // The site writes "8:00" as often as "08:00"; the column shows one form.
      const time = `${clock[1]!.padStart(2, '0')}:${clock[2]}`;
      const byTime = counts.get(item.lesson.hourIndex) ?? new Map<string, number>();
      byTime.set(time, (byTime.get(time) ?? 0) + 1);
      counts.set(item.lesson.hourIndex, byTime);
    }
  }
  const out: Record<number, string> = {};
  for (const [hour, byTime] of counts) {
    const [best] = [...byTime].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (best) out[hour] = best[0];
  }
  return out;
}

/** The period column's width: the widest start time at the grid's scale and its padding, never under `WEEK_GRID.hourColumn`. */
export function hourColumnWidth(times: readonly string[], scale = 1): number {
  const widest = times.reduce((w, t) => Math.max(w, textWidth(t, HOUR_TIME_SIZE * scale)), 0);
  return Math.max(WEEK_GRID.hourColumn, Math.ceil(widest) + 2 * WEEK_GRID.hourPadding);
}

/** 0 for Sunday … 6 for Saturday, whatever the device's time zone. */
function weekdayIndex(date: DateStr): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

/** A day column's letter, "א׳" to "ו׳", read from its date — not its place, since Friday may be left out. */
export function dayLetter(date: DateStr): string {
  return DAY_LETTERS[weekdayIndex(date)] ?? '';
}

/**
 * The days the week grid draws: Sunday to Friday, without a Friday that has
 * no lessons and no exam — an empty column that took a sixth of the width
 * (Daniel, run 3). `keep` (a Friday opened by a link, or chosen) stays.
 */
export function weekGridDays<T extends Pick<DayView, 'date' | 'timeline' | 'examsToday'>>(days: readonly T[], keep: DateStr | null = null): T[] {
  return days.filter((d) => weekdayIndex(d.date) !== 5
    || d.date === keep
    || d.examsToday.length > 0
    || d.timeline.some((i) => i.kind === 'lesson'));
}

/**
 * The last day the week's title names: the last one the grid (or the list)
 * shows (`weekGridDays`). Over a grid that ended on Thursday the title read
 * "11–16.10" (Noa, run 5). `fallback` (the week's Friday) while nothing is
 * shown yet.
 */
export function shownWeekEnd(shown: readonly Pick<DayView, 'date'>[], fallback: DateStr): DateStr {
  let last: DateStr | null = null;
  for (const day of shown) if (last === null || day.date > last) last = day.date;
  return last ?? fallback;
}

/** A day of the week the grid leaves out, that has school events or work due: the strip under the grid. */
export interface HiddenDayStrip {
  date: DateStr;
  /** "שישי". */
  weekday: string;
  /** "16.10" — render it through `Ltr`. */
  shortDate: string;
  /** Its events' titles, in the week's order — render them through `isolateRanges`. */
  titles: string[];
  /** "להגשה: מתמטיקה" when work is due that day and still open (`homeworkDueLabel`), else `null`. */
  due: string | null;
  /**
   * "יום שישי 16.10: טיול שנתי — שכבת י״ב", for the screen reader. On screen
   * the row writes the day and date in its margin, the titles as its title
   * and `due` under them; the titles are the school's, punctuation and all.
   */
  label: string;
}

/**
 * The strips under the week grid (Noa, run 5): a day of the week left out of
 * the grid — a Friday without lessons — that has a school event, so the
 * class trip on Friday 16.10 is not missing from the week. `days` is the
 * week, `shown` what the grid draws, `events` the week's school events
 * (`WeekView.schoolEvents`). Tapping a strip opens its day.
 *
 * Work due that day and still open gets one too (run 7): "תרגיל בית 3 ·
 * וקטורים" was due on Friday 9.10, a Friday without lessons, and the week had
 * no place for it. `classroom` is the open Classroom work (`classroomDueWork`).
 */
export function hiddenDayStrips(
  days: readonly (DueDay & Pick<DayView, 'date'>)[],
  shown: readonly Pick<DayView, 'date'>[],
  events: readonly Pick<SchoolEvent, 'date' | 'title'>[],
  classroom: readonly ClassroomWork[] = [],
): HiddenDayStrip[] {
  const drawn = new Set(shown.map((d) => d.date));
  return days.flatMap((day) => {
    if (drawn.has(day.date)) return [];
    const titles = events.filter((e) => e.date === day.date).map((e) => e.title.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const due = homeworkDueLabel(day, classroom);
    if (titles.length === 0 && !due) return [];
    const weekday = weekdayName(day.date).replace(/^יום /, '');
    const shortDate = formatShortDate(day.date);
    const what = [titles.join(', '), due].filter(Boolean);
    return [{
      date: day.date,
      weekday,
      shortDate,
      titles,
      due,
      label: `${weekdayName(day.date)} ${shortDate}: ${what.join('. ')}`,
    }];
  });
}

/**
 * What the week draws (run 5): its days, in the grid or the list
 * (`weekGridDays`), and the strips for a Friday left out that has a school
 * event or work due (`hiddenDayStrips`). `selected` is the chosen day.
 *
 * A Friday opened from its strip stays a strip in the grid — chosen, its day
 * in full under the grid, and nothing above that moves, so the scroll to it
 * lands. In the list it takes the strip's place and is drawn in full like the
 * days before it. A Friday chosen another way (a link) joins the grid as before.
 */
export function weekShown<T extends Pick<DayView, 'date' | 'timeline' | 'examsToday'> & Pick<DueDay, 'homework'>>(
  days: readonly T[],
  selected: DateStr | null,
  events: readonly Pick<SchoolEvent, 'date' | 'title'>[],
  listMode: boolean,
  classroom: readonly ClassroomWork[] = [],
): { days: T[]; strips: HiddenDayStrip[] } {
  const strips = hiddenDayStrips(days, weekGridDays(days), events, classroom);
  const fromStrip = !listMode && strips.some((s) => s.date === selected);
  const shown = weekGridDays(days, fromStrip ? null : selected);
  return { days: shown, strips: hiddenDayStrips(days, shown, events, classroom) };
}

const NO_OWN_NAMES: ReadonlySet<string> = new Set();

export interface GridLabels {
  /** One size for the whole grid. */
  fontSize: number;
  /** Whether every subject is written whole ("מתמטיקה"); otherwise some take their short form. */
  full: boolean;
  /** The label for a lesson's subject or an exam's title: the same for the same subject, in cells and tags alike. */
  label: (name: string) => string;
}

/**
 * Every label in the week grid, chosen together (W4-9, W6-5): a subject reads
 * the same in every cell and in its exam tag, and each subject is written
 * whole ("מתמטיקה") when its whole name fits a column, else in its short form
 * ("רשתות", "חנ״ג"). Until W6 one long name sent every subject to its short
 * form, and Daniel had to decode "מתמ׳, אנג׳, פיז׳, היסט׳" (run 5: "I don't
 * need to solve a puzzle to know what I have third period").
 *
 * One size for the grid: the one that writes the most subjects whole, then
 * the one that cuts the fewest, then the larger — a whole word at 12 reads
 * better than a short form at 13. Measured in the tags' semibold, so a lesson
 * cell has a hair to spare. A short form too wide even then is cut with a
 * geresh (`fitGridLabel`); the subject's colour (W6-F) is a second cue beside
 * the name, never a reason to write less of it.
 *
 * `own` holds the names the student gave (own names, 2026-11-05): each is its
 * own key and its own whole form, as typed, never put to a short form; a cell
 * too narrow for it cuts it with a geresh, as any label too wide is cut.
 */
export function gridLabels(
  lessonSubjects: readonly string[],
  examTitles: readonly string[],
  width: number,
  scale = 1,
  own: ReadonlySet<string> = NO_OWN_NAMES,
): GridLabels {
  // Keyed by the short form, which an exam's title shares with its subject's lessons.
  const keyOf = (name: string): string => (own.has(name) ? name : shortSubject(name));
  const whole = new Map<string, string>();
  for (const subject of lessonSubjects) {
    const key = keyOf(subject);
    if (!whole.has(key)) whole.set(key, own.has(subject) ? subject : stripGroup(subject));
  }
  for (const name of examTitles) if (own.has(name) && !whole.has(name)) whole.set(name, name);
  const keys = [...new Set([...lessonSubjects, ...examTitles].map(keyOf))];
  const fits = (text: string, size: number): boolean => fitsWidth(text, size, width, scale, 'semi');
  const wholeOf = (key: string): string => whole.get(key) ?? key;
  const score = (size: number): [number, number] => [
    keys.filter((key) => fits(wholeOf(key), size)).length,
    keys.filter((key) => fits(wholeOf(key), size) || fits(key, size)).length,
  ];
  let fontSize = GRID_FONT_SIZES[0] ?? MIN_FONT_SIZE;
  let best = score(fontSize);
  for (const size of GRID_FONT_SIZES.slice(1)) {
    const s = score(size);
    if (s[0] > best[0] || (s[0] === best[0] && s[1] > best[1])) {
      fontSize = size;
      best = s;
    }
  }
  return {
    fontSize,
    full: best[0] === keys.length,
    label: (name) => {
      const key = keyOf(name);
      const full = wholeOf(key);
      return fits(full, fontSize) ? full : fitGridLabel(key, fontSize, width, scale, 'semi');
    },
  };
}

// ---------------------------------------------------------------------------
// Week grid: the subject's colour, and what a changed cell says (W6-5)
// ---------------------------------------------------------------------------

/**
 * How much of a subject's colour tints its cell (W6-F), over the page (`bg`;
 * the grid sits on the page, not in a card, plan §16): a soft wash, so the
 * text on it keeps its own colour and its contrast (tested for every hue in
 * both schemes). The dark page takes a little more to show at all.
 */
export const SUBJECT_TINT: Readonly<Record<ColorScheme, { fill: number; edge: number }>> = {
  light: { fill: 0.16, edge: 0.5 },
  dark: { fill: 0.22, edge: 0.55 },
};

/** "#rrggbb" (or "#rgb") → [r, g, b]; anything else is black. */
function rgbOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `over` laid on `base` at `alpha` (0–1), as one solid "#rrggbb". */
export function blendColor(base: string, over: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  const b = rgbOf(base);
  const o = rgbOf(over);
  return `#${b.map((c, i) => Math.round(c + (o[i]! - c) * a).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A lesson cell's colours for its subject on `page` (the palette's `bg`): the
 * soft fill, and a stronger edge for anything that needs the hue itself.
 */
export function subjectCellColors(color: string, page: string, scheme: ColorScheme): { fill: string; edge: string } {
  const t = SUBJECT_TINT[scheme];
  return { fill: blendColor(page, color, t.fill), edge: blendColor(page, color, t.edge) };
}

/** The ⊘ drawn on a cancelled cell (`AppIcon` "cancel"), and the room between it and its word. */
export const CELL_ICON = { size: 13, gap: 2 } as const;

/** The size of the status line under a changed cell's subject: the floor, in semibold. */
export const CELL_STATUS_SIZE = MIN_FONT_SIZE;

/**
 * The line under a changed lesson's subject in the week grid (W6-5, Daniel:
 * a cancelled cell was "a pink cell", with no tag, icon or clear strike, so
 * colour was the only sign): the status in a word — "מ״מ", "הועבר", "מבחן" —
 * and for a cancelled lesson the ⊘ as well, with "בוטל" when it fits beside
 * it. `label` is `statusStyle`'s; a regular lesson ("") has no line. A word
 * too wide is cut as a subject is (`fitGridLabel`); beside the ⊘ it goes.
 */
export function cellStatusLine(
  label: string,
  cancelled: boolean,
  width: number,
  scale = 1,
): { icon: boolean; text: string | null } | null {
  if (!label && !cancelled) return null;
  if (cancelled) {
    const room = width - (CELL_ICON.size + CELL_ICON.gap) * scale;
    return { icon: true, text: label && fitsWidth(label, CELL_STATUS_SIZE, room, scale, 'semi') ? label : null };
  }
  return { icon: false, text: fitGridLabel(label, CELL_STATUS_SIZE, width, scale, 'semi') };
}

// ---------------------------------------------------------------------------
// Week: a week without lessons, and the lines that explain the screen (W6-5)
// ---------------------------------------------------------------------------

/** Hebrew points and cantillation; the maqaf and the geresh stay. */
const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

/**
 * A holiday as a student names it, from the calendar's name for one of its
 * days: "סוּכּוֹת ב׳ (חוה״מ)" → "סוכות", "סוּכּוֹת ז׳ (הוֹשַׁעְנָא רַבָּה)" →
 * "סוכות", "רֹאשׁ הַשָּׁנָה 5787" → "ראש השנה". Without its points, its
 * bracket, and the day or year after it.
 */
export function holidayBaseName(name: string): string {
  return name
    .replace(NIQQUD, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+\d{4}$/, '')
    .replace(/\s+[א-ת]{1,2}['׳]$/, '')
    .trim();
}

/** What the week says in place of its grid when no day of it has a lesson. */
export interface EmptyWeek {
  kind: 'holiday' | 'noTimetable';
  /** "חופשת סוכות · אין לימודים השבוע". */
  text: string;
}

/** The empty week that is not a holiday: the site has nothing for it, and the fixed timetable did not fill it. */
export const NO_TIMETABLE_WEEK = 'אין עדיין מערכת לשבוע הזה';

/**
 * A week without a single lesson (W6-5, Daniel: Sukkot's week was an empty
 * grid "without hours and without a word", the holiday only in small print
 * under it). When none of Sunday to Thursday is a school day it is a
 * holiday: "חופשת סוכות · אין לימודים השבוע", named after the holiday most
 * of its days are (`holidayBaseName`), or "אין לימודים השבוע" when none is
 * named. Otherwise the timetable is not there yet. `null` when the week has
 * a lesson.
 */
export function emptyWeek(
  days: readonly Pick<DayView, 'date' | 'isSchoolDay' | 'holidayName' | 'timeline'>[],
): EmptyWeek | null {
  if (days.length === 0 || days.some((d) => d.timeline.some((i) => i.kind === 'lesson'))) return null;
  const weekdays = days.filter((d) => weekdayIndex(d.date) <= 4);
  if (weekdays.length === 0 || weekdays.some((d) => d.isSchoolDay)) return { kind: 'noTimetable', text: NO_TIMETABLE_WEEK };
  const counts = new Map<string, number>();
  for (const day of days) {
    if (day.isSchoolDay || !day.holidayName) continue;
    const base = holidayBaseName(day.holidayName);
    // Saturday, and the owner's own "חופש", say nothing about which holiday.
    if (!base || base === 'שבת' || base === 'חופש') continue;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  let name: string | null = null;
  let most = 0;
  for (const [base, n] of counts) {
    if (n > most) {
      name = base;
      most = n;
    }
  }
  if (!name) return { kind: 'holiday', text: 'אין לימודים השבוע' };
  return { kind: 'holiday', text: `${/^חופש/.test(name) ? name : `חופשת ${name}`}, אין לימודים השבוע` };
}

/**
 * The line over the week drawn as a list (W6-5, Daniel, run 5: after making
 * the text larger "the grid disappeared without a word, and I looked for it").
 */
export const WEEK_LIST_NOTE = 'בטקסט גדול השבוע מוצג כרשימה';

/** Whether `text` fits `width` at `fontSize`, after the phone's text-size factor. */
export function fitsWidth(text: string, fontSize: number, width: number, scale = 1, weight: GridWeight = 'medium'): boolean {
  return textWidth(text, fontSize * scale, weight) <= width;
}

/**
 * One size for the whole grid: the largest of `GRID_FONT_SIZES` at which every
 * label fits, or the floor when even that is too wide for one of them (that
 * label is then shortened by `fitGridLabel`). One size keeps the grid even.
 */
export function gridFontSize(
  labels: readonly { text: string; weight?: GridWeight }[],
  width: number,
  scale = 1,
): number {
  for (const size of GRID_FONT_SIZES) {
    if (labels.every((l) => fitsWidth(l.text, size, width, scale, l.weight))) return size;
  }
  return MIN_FONT_SIZE;
}

/**
 * `label` as it fits a grid cell at `fontSize`: whole when it fits, else cut
 * after as many letters as fit and marked with a geresh — the way students
 * shorten a word themselves ("אקדמיזציה" → "אקדמ׳"), and the form the known
 * short forms take ("מתמ׳", "היסט׳"). At least two letters stay. Never a
 * smaller font: the floor is `MIN_FONT_SIZE`, and the full name is one tap away.
 */
export function fitGridLabel(label: string, fontSize: number, width: number, scale = 1, weight: GridWeight = 'medium'): string {
  if (fitsWidth(label, fontSize, width, scale, weight)) return label;
  const chars = [...label.replace(/[׳'"״]+$/, '').trimEnd()];
  for (let keep = chars.length - 1; keep >= 2; keep -= 1) {
    const candidate = `${chars.slice(0, keep).join('').trimEnd()}׳`;
    if (fitsWidth(candidate, fontSize, width, scale, weight)) return candidate;
  }
  return `${chars.slice(0, 2).join('')}׳`;
}

/**
 * How a day header's exam tag shows the day's other exams: "+1" after "מבחן"
 * on the first line when "מבחן +1" fits the column, else on a third line of
 * its own, under the subject. `more` is `null` on a day with one exam.
 */
export function examTagMore(tag: Pick<ExamTag, 'more'>, fontSize: number, width: number, scale = 1): { more: string | null; inline: boolean } {
  if (tag.more <= 0) return { more: null, inline: true };
  const more = `+${tag.more}`;
  return { more, inline: fitsWidth(`מבחן ${more}`, fontSize, width, scale) };
}

// ---------------------------------------------------------------------------
// Planning tab
// ---------------------------------------------------------------------------

/**
 * The marks under a day in the month grid: what a student plans around.
 * Calendar events (school and Google) have none (W5-16): the gym, guitar and
 * scouts are on nearly every day, so their line read as the grid's underline
 * rather than as news (Daniel, run 4; a dot before it, Itai, run 3). They are
 * listed in the chosen day's detail under the grid.
 */
export type MarkKind = 'exam' | 'homework' | 'task';

/** In the order they are drawn and listed in the legend. */
export const MARK_KINDS: readonly MarkKind[] = ['exam', 'homework', 'task'];

export const MARK_LABELS: Readonly<Record<MarkKind, string>> = {
  exam: 'מבחן',
  homework: 'הגשה',
  task: 'משימה',
};

/**
 * The smallest mark (a task's ring) in the month grid and in its legend — the
 * key is drawn at the grid's sizes, so it looks like what it explains.
 * Testers could not make out the 4–6 point marks; 8 is the floor (R-28).
 * 10 since run 8: the 9-point ring all but vanished on the dark page.
 */
export const MARK_SIZE = 10;
/** The space between two marks under a day. */
export const MARK_GAP = 2;

/**
 * Each mark's box (W4-10). What a student plans around stands out: a filled
 * dot for an exam, the largest, and a filled square for homework due. A task
 * is a ring.
 */
export function markBox(kind: MarkKind): { width: number; height: number } {
  switch (kind) {
    case 'exam': return { width: 12, height: 12 };
    case 'homework': return { width: 11, height: 11 };
    default: return { width: MARK_SIZE, height: MARK_SIZE };
  }
}

/** A day's marks in the order they are drawn, side by side under its number. */
export function markLayout(kinds: readonly MarkKind[]): MarkKind[] {
  return MARK_KINDS.filter((k) => kinds.includes(k));
}

/** How wide a row of marks is. */
export function marksRowWidth(kinds: readonly MarkKind[], gap: number = MARK_GAP): number {
  if (kinds.length === 0) return 0;
  return kinds.reduce((w, k) => w + markBox(k).width, 0) + gap * (kinds.length - 1);
}

/**
 * The exam days to mark in a date picker (Noa, run 3: picking 5.11 she could
 * not see that 9.11 was an exam). The school feed's exams are the owner's own.
 */
export function examDayMarks(exams: readonly Pick<Exam, 'date'>[]): Record<DateStr, MarkKind[]> {
  const out: Record<DateStr, MarkKind[]> = {};
  for (const exam of exams) out[exam.date] = ['exam'];
  return out;
}

/**
 * Classroom work due on a day, as a row of the planning tab (plan 14.5, run
 * 7): drawn like homework, with a "Classroom" tag, and marked as homework is.
 * `done` is the phone's "עשיתי" (`isClassroomDone`).
 */
export interface ClassroomPlanItem {
  kind: 'classroom';
  work: ClassroomWork;
  done: boolean;
}

/** A row of the planning tab: the agenda's (`AgendaItem`), or Classroom work. */
export type PlanItem = AgendaItem | ClassroomPlanItem;

/** An agenda day with its Classroom work among its items (`agendaWithClassroom`). */
export interface PlanDay {
  date: DateStr;
  weekdayName: string;
  items: PlanItem[];
}

/**
 * The Classroom work planning and the week show as due (run 7, Noa and
 * Daniel: Tasks and Today listed "תרגיל בית 3 · וקטורים", planning did not):
 * dated, recent (`selectClassroom`), not handed in and not marked "עשיתי".
 * Undated work stays on the task list, under "בלי תאריך". `keep` is work
 * ticked a moment ago on this screen: it stays in place, ticked, as homework
 * does. Sorted by due date and hour. `null` work (Classroom not connected) is none.
 */
export function classroomDueWork(
  work: readonly ClassroomWork[] | null | undefined,
  today: DateStr,
  done: ReadonlySet<string>,
  keep?: ReadonlySet<string>,
): ClassroomWork[] {
  if (!work) return [];
  return selectClassroom(work, { today, filter: 'open', search: '', done, keep }).filter((w) => w.dueDate !== null);
}

/** The work of `work` due on `date`, as planning rows, in their order. */
export function classroomItemsOn(work: readonly ClassroomWork[], date: DateStr, done: ReadonlySet<string>): ClassroomPlanItem[] {
  return work.filter((w) => w.dueDate === date).map((w): ClassroomPlanItem => ({ kind: 'classroom', work: w, done: isClassroomDone(w, done) }));
}

/** `extra` after a day's exams and homework, before its tasks and events: Classroom work is read like homework. */
function withHomework(items: readonly PlanItem[], extra: readonly ClassroomPlanItem[]): PlanItem[] {
  if (extra.length === 0) return [...items];
  const at = items.findIndex((i) => i.kind !== 'exam' && i.kind !== 'homework');
  const cut = at < 0 ? items.length : at;
  return [...items.slice(0, cut), ...extra, ...items.slice(cut)];
}

/**
 * The agenda with Classroom work on its due days (`classroomDueWork`), so the
 * month's marks, the chosen day and "ב־14 הימים הקרובים" all read one list.
 * Work due outside the agenda's days is left out, as its homework is: the
 * grid marks only exams past `to` and says so (`marksEndNote`).
 */
export function agendaWithClassroom<A extends { days: readonly PlanDay[] }>(
  agenda: A,
  work: readonly ClassroomWork[],
  done: ReadonlySet<string>,
): Omit<A, 'days'> & { days: PlanDay[] } {
  return {
    ...agenda,
    days: agenda.days.map((day) => {
      const extra = classroomItemsOn(work, day.date, done);
      return extra.length > 0 ? { ...day, items: withHomework(day.items, extra) } : day;
    }),
  };
}

/**
 * The mark an item puts under its day; done homework, completed tasks and
 * Classroom work marked done put none, and neither do calendar events (W5-16:
 * they are in the day's detail). Classroom work is marked as homework is: it
 * is handed in.
 */
export function markOf(item: PlanItem): MarkKind | null {
  switch (item.kind) {
    case 'exam': return 'exam';
    case 'homework': return item.homework.done ? null : 'homework';
    case 'classroom': return item.done ? null : 'homework';
    case 'task': return item.task.completed ? null : 'task';
    default: return null;
  }
}

/** One day's marks, each kind once, in `MARK_KINDS` order. */
export function marksOf(items: readonly PlanItem[]): MarkKind[] {
  const found = new Set(items.map(markOf));
  return MARK_KINDS.filter((kind) => found.has(kind));
}

/** The month grid's marks: every agenda day that has any, by date. */
export function agendaMarks(agenda: { days: readonly PlanDay[] } | undefined): Record<DateStr, MarkKind[]> {
  const out: Record<DateStr, MarkKind[]> = {};
  for (const day of agenda?.days ?? []) {
    const marks = marksOf(day.items);
    if (marks.length > 0) out[day.date] = marks;
  }
  return out;
}

/**
 * The planning tab's month grid (W5-15): the agenda's marks, and every exam
 * of the owner's in any month the grid shows. The agenda reaches 31 days
 * (`AGENDA_MAX_DAYS`), so 9.11 had no mark although tapping it said "מבחן
 * במתמטיקה · עוד 32 ימים" (Noa, run 4: "בשביל לתכנן מבחנים צריך לראות
 * חודשיים קדימה").
 *
 * `exams` is `GET /settings`'s list, every upcoming exam with the hidden ones
 * in it. The owner's are those off the hide-list: `hiddenKeys` when given —
 * the live list, which a switch in "המבחנים שלי" updates in the cache at once
 * — else each exam's own `hidden`, as the list was read. Homework and tasks
 * still come from the agenda alone.
 */
export function monthMarks(
  agenda: { days: readonly PlanDay[] } | undefined,
  exams: readonly Pick<ExamOption, 'date' | 'naturalKey' | 'hidden'>[],
  hiddenKeys?: readonly string[],
): Record<DateStr, MarkKind[]> {
  const out = agendaMarks(agenda);
  const hidden = hiddenKeys ? new Set(hiddenKeys) : null;
  const mine = exams.filter((e) => (hidden ? !hidden.has(e.naturalKey) : !e.hidden));
  for (const date of Object.keys(examDayMarks(mine))) {
    const marks = out[date] ?? [];
    if (!marks.includes('exam')) out[date] = markLayout([...marks, 'exam']);
  }
  return out;
}

/**
 * The last day the grid's homework and task marks reach, when the month shown
 * runs past it (`dates` are the grid's days) — after it only exams are marked;
 * `null` while the grid ends inside the agenda. Days gone by are not counted:
 * nothing is planned for them.
 */
export function marksEndInView(span: Pick<AgendaView, 'to'> | null, dates: readonly DateStr[]): DateStr | null {
  return span && dates.some((d) => d > span.to) ? span.to : null;
}

/** The note under the grid when it shows days past `marksEndInView`: "אחרי 7.11 מסומנים רק מבחנים" (the date through `Ltr`). */
export function marksEndNote(end: DateStr): { lead: string; date: string; rest: string } {
  return { lead: 'אחרי ', date: formatShortDate(end), rest: ' מסומנים רק מבחנים' };
}

/**
 * The chosen day's items in the planning tab, cut around the timetable row
 * (W5-16): its exams go above that row, the rest under it. On 20.10 the row
 * came first, "לפי המערכת הקבועה" and all, and the English exam was pushed
 * under the edge of the screen (Itai, run 4).
 */
export function splitDayItems(items: readonly PlanItem[]): { exams: PlanItem[]; rest: PlanItem[] } {
  return { exams: items.filter((i) => i.kind === 'exam'), rest: items.filter((i) => i.kind !== 'exam') };
}

/** The agenda's day for `date`, or `null` when the date is outside what it covers. */
export function agendaDay(agenda: { days: readonly PlanDay[] } | undefined, date: DateStr): PlanDay | null {
  return agenda?.days.find((d) => d.date === date) ?? null;
}

/**
 * The title of the planning tab's list: "ב־14 הימים הקרובים" (render `days`
 * through `Ltr`). It was "הקרוב אליי — 14 יום", which Maya read as near her
 * place, "as if by location" (run 5).
 */
export const UPCOMING_TITLE = { lead: 'ב־', rest: ' הימים הקרובים' } as const;

/** "ב־14 הימים הקרובים": the first `days` days from `agenda.from`, only those with something planned. */
export function upcomingDays(agenda: Pick<AgendaView, 'from'> & { days: readonly PlanDay[] }, days: number): PlanDay[] {
  const last = addDays(agenda.from, days - 1);
  return agenda.days.filter((d) => d.date <= last && d.items.length > 0);
}

/**
 * The words of the switch over "ב־14 הימים הקרובים": the same as Today's,
 * which does the same — the person's own calendar steps aside (run 7, Daniel:
 * "רק בית ספר" there and "רק לימודים" here, drawn as a tick).
 */
export const SCHOOL_ONLY_LABEL = 'רק בית ספר';

/**
 * What "רק בית ספר" keeps: everything from school — exams, homework,
 * Classroom work, tasks, and the school's own events. Only the Google
 * Calendar events go — the gym, guitar and scouts testers saw drown the exams
 * (R-28). Until run 7 the school's events went too, and with them the class
 * trip and the parents' evening (Noa).
 */
export function isSchoolItem(item: PlanItem): boolean {
  return item.kind !== 'calendar';
}

export interface UpcomingGroup {
  date: DateStr;
  items: PlanItem[];
  /**
   * The day chosen in the month grid, whose items are already shown under the
   * grid: drawn as its heading and "מוצג למעלה", not a second copy. Only for a
   * day after today — today's group is left out entirely.
   */
  shownAbove: boolean;
}

export interface UpcomingList {
  groups: UpcomingGroup[];
  /** How many calendar events "רק בית ספר" took out of the groups shown. */
  hidden: number;
  /** Today is the chosen day and had items: they are above, and the list starts tomorrow. */
  todayAbove: boolean;
}

/**
 * "ב־14 הימים הקרובים" as drawn: the first `days` days from `agenda.from` (today),
 * with something planned. The window stays today + 13 whatever is chosen.
 *
 * The chosen day's items are already listed under the month grid, so they
 * are never repeated here (R-28): when the chosen day is today the list
 * starts tomorrow; a later chosen day keeps only its heading, marked as
 * shown above, so the 14 days still read in order.
 *
 * `schoolOnly` keeps what comes from school (`isSchoolItem`), and counts the
 * calendar events it hid. The chosen day's own items are above and not counted.
 */
export function upcomingList(
  agenda: Pick<AgendaView, 'from'> & { days: readonly PlanDay[] },
  opts: { days: number; selected?: DateStr | null; schoolOnly?: boolean },
): UpcomingList {
  const last = addDays(agenda.from, opts.days - 1);
  const groups: UpcomingGroup[] = [];
  let hidden = 0;
  let todayAbove = false;
  for (const day of agenda.days) {
    if (day.date < agenda.from || day.date > last) continue;
    const items = opts.schoolOnly ? day.items.filter(isSchoolItem) : day.items;
    if (day.date === opts.selected) {
      if (items.length === 0) continue;
      if (day.date === agenda.from) todayAbove = true;
      else groups.push({ date: day.date, items: [], shownAbove: true });
      continue;
    }
    hidden += day.items.length - items.length;
    if (items.length > 0) groups.push({ date: day.date, items, shownAbove: false });
  }
  return { groups, hidden, todayAbove };
}

/** What a `shownAbove` group says after its date. */
export const SHOWN_ABOVE = 'מוצג למעלה';

/** The line under the "רק בית ספר" switch: how many calendar events it hides. */
export function hiddenEventsNote(hidden: number): string | null {
  if (hidden <= 0) return null;
  return hidden === 1 ? 'אירוע אחד לא מוצג' : `${hidden} אירועים לא מוצגים`;
}

/** The upcoming list with nothing to list; "עוד" when today's items are right above it. */
export function upcomingEmptyText(todayAbove: boolean): string {
  return todayAbove
    ? 'אין עוד מבחנים, הגשות או משימות בשבועיים הקרובים'
    : 'אין מבחנים, הגשות או משימות בשבועיים הקרובים';
}

/**
 * The same list the agenda would hold for `day`, for a date it does not
 * cover (a past day, or a later month): exams, homework, tasks, school
 * events, then Google events — the server's order (views/build.ts) — with
 * its Classroom work after the homework, as `agendaWithClassroom` puts it.
 * `daysAway` counts from `today`; `classroom` is `classroomDueWork`'s list,
 * and `done` the phone's marks.
 */
export function dayAgendaItems(
  day: Pick<DayView, 'date' | 'examsToday' | 'homework' | 'timeline' | 'events'>,
  today: DateStr,
  classroom: readonly ClassroomWork[] = [],
  done: ReadonlySet<string> = new Set(),
): PlanItem[] {
  const exams = day.examsToday
    .slice()
    .sort((a, b) => a.subject.localeCompare(b.subject, 'he'))
    .map((exam): AgendaItem => ({ kind: 'exam', exam, daysAway: daysBetween(today, exam.date) }));
  // `?? []`: a server older than the contract sends no `homework`.
  const homework = (day.homework ?? []).map((homework): AgendaItem => ({ kind: 'homework', homework }));
  const work = classroomItemsOn(classroom, day.date, done);
  const tasks = day.timeline
    .flatMap((i) => (i.kind === 'task' ? [i.task] : []))
    .sort((a, b) => a.title.localeCompare(b.title, 'he'))
    .map((task): AgendaItem => ({ kind: 'task', task }));
  const schoolEvents = day.events.map((event): AgendaItem => ({ kind: 'event', event }));
  const calendar = timelineInOrder(day.timeline)
    .flatMap((i): AgendaItem[] => (i.kind === 'event' ? [{ kind: 'calendar', event: i.event }] : []));
  return [...exams, ...homework, ...work, ...tasks, ...schoolEvents, ...calendar];
}

/** A stable React key for an agenda row. */
export function agendaItemKey(item: PlanItem): string {
  switch (item.kind) {
    case 'exam': return `exam:${item.exam.naturalKey}`;
    case 'homework': return `homework:${item.homework.naturalKey}`;
    case 'classroom': return `classroom:${item.work.naturalKey}`;
    case 'task': return `task:${item.task.id}`;
    case 'event': return `event:${item.event.naturalKey}`;
    case 'calendar': return `calendar:${item.event.calendarId}:${item.event.id}`;
    default: return 'unknown';
  }
}

/** A day group's name in the upcoming list: "היום", "מחר", otherwise the weekday. */
export function relativeDayName(date: DateStr, today: DateStr): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  return weekdayName(date);
}
