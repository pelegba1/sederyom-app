/**
 * What "שליחה לקבוצה" sends (ideas ה1): a day's changes, or the exams ahead,
 * as text for the class's group, through the phone's share sheet (WhatsApp,
 * or any other app), with a line and a link at the end. In many classes
 * someone already sends a screenshot of the timetable; this way the text
 * comes from the app, and its link brings whoever taps it into the same
 * class (`lib/invite.ts`), or to the store when there is no class to invite to.
 *
 * Ranges are pinned left to right (`isolateRanges`), as in the notifications:
 * the group lays the lines out right to left, and "09:40–10:25" would turn
 * around.
 *
 * A name the student gave a subject stays on their phone: the group reads the
 * school's name for its lessons, and the source's title for an exam named by
 * it (`sentExamTitle`). A name they gave one exam goes as they gave it.
 *
 * Pure, so the tests run it as is.
 */
import type { DateStr, Exam, Lesson, LessonStatus } from '@sederyom/shared';
import { addDays, weekdayNameHe } from '@sederyom/shared/logic/time';
import { formatShortDate, isolateRanges, sentExamTitle, stripGroup } from './format';

/** The store's page: the link when the phone follows no class. */
export const STORE_URL = 'https://play.google.com/store/apps/details?id=site.sederyom.app';

/** How far ahead the exams go: two weeks, or the next few when none is that close. */
export const SHARE_EXAM_DAYS = 14;
const SHARE_EXAMS_FALLBACK = 3;

/** What a change is called in the group, said in full where the app's mark is short ("מ״מ"). */
const CHANGE_WORDS: Partial<Record<LessonStatus, string>> = {
  cancelled: 'בוטל',
  substitution: 'מילוי מקום',
  moved: 'הוזז',
  remote: 'מרחוק',
  exam: 'מבחן',
  event: 'פעילות',
};

/** Whom and where the text is about. */
export interface ShareContext {
  /** The class as the app shows it ("י״א 2"); empty when not known. */
  className: string;
  /** The class's invite link, or the store's page. */
  link: string;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** "יום שני 2.11". */
function dayLabel(date: DateStr): string {
  return `${weekdayNameHe(date)} ${formatShortDate(date)}`;
}

function signature(link: string): string {
  return `נשלח מסדר יום: ${link}`;
}

/**
 * A day's changes, one lesson to a line in the day's order:
 *
 *   שינויים במערכת של י״א 2, יום שני 2.11:
 *   שיעור 3 (09:40–10:25) מתמטיקה: בוטל
 *   שיעור 5 אנגלית: מילוי מקום, דנה כהן
 *
 *   נשלח מסדר יום: https://…/join?s=…&c=…
 */
export function changesShareText(lessons: readonly Lesson[], date: DateStr, ctx: ShareContext): string {
  const head = ctx.className ? `שינויים במערכת של ${ctx.className}, ${dayLabel(date)}:` : `שינויים במערכת, ${dayLabel(date)}:`;
  const lines = [...lessons]
    .sort((a, b) => a.hourIndex - b.hourIndex)
    .map((lesson) => {
      const time = lesson.startTime && lesson.endTime ? ` (${lesson.startTime}–${lesson.endTime})` : '';
      const word = CHANGE_WORDS[lesson.status] ?? 'שינוי';
      const who = lesson.status === 'substitution' && lesson.substitute ? `, ${oneLine(lesson.substitute, 40)}` : '';
      const note = lesson.note ? `. ${oneLine(lesson.note, 80)}` : '';
      return `שיעור ${lesson.hourIndex}${time} ${stripGroup(lesson.originalSubject ?? lesson.subject)}: ${word}${who}${note}`;
    });
  return isolateRanges([head, ...lines, '', signature(ctx.link)].join('\n'));
}

/**
 * The exams of the next `SHARE_EXAM_DAYS` days, or the next few when none is
 * that close; `null` with none ahead at all. Each by its title as the school
 * published it, on the date the school gave it, and its details when it has any:
 *
 *   המבחנים בשבועיים הקרובים, י״א 2:
 *   יום שני 2.11: מבחן במתמטיקה
 *   יום רביעי 4.11: מתכונת באנגלית (שאלון 016582)
 */
export function examsShareText(exams: readonly Exam[], today: DateStr, ctx: ShareContext): string | null {
  // The school's dates: a date the student set for an exam is theirs alone (`originalDate`, `examPrefs.ts`), and the group is told the school's.
  const asSchool = exams.map((e) => ({ ...e, date: e.originalDate ?? e.date }));
  const ahead = asSchool.filter((e) => e.date >= today).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  if (ahead.length === 0) return null;
  const until = addDays(today, SHARE_EXAM_DAYS);
  const near = ahead.filter((e) => e.date < until);
  const shown = near.length > 0 ? near : ahead.slice(0, SHARE_EXAMS_FALLBACK);
  const title = near.length > 0 ? 'המבחנים בשבועיים הקרובים' : 'המבחנים הקרובים';
  const head = ctx.className ? `${title}, ${ctx.className}:` : `${title}:`;
  const lines = shown.map((exam) => {
    const details = exam.details ? ` (${oneLine(exam.details, 60)})` : '';
    return `${dayLabel(exam.date)}: ${oneLine(sentExamTitle(exam), 60)}${details}`;
  });
  return isolateRanges([head, ...lines, '', signature(ctx.link)].join('\n'));
}
