/**
 * "איפה המורה?" (docs/superpowers/specs/2026-11-04-teacher-search-design.md):
 * the screen's words, kept apart from it so they can be tested. No verb says
 * he or she: the site gives a name, not who it is.
 */
import type { TeacherDay, TeacherPeriod } from '@sederyom/shared';
import { teacherIsThere, teacherNow } from '@sederyom/shared/logic/teachers';

export const TEACHER_SEARCH_COPY = {
  title: 'איפה המורה?',
  entry: 'איפה המורה?',
  entryHint: 'חיפוש לפי שם: באיזו כיתה המורה עכשיו, ומה בהמשך היום',
  fieldLabel: 'שם המורה',
  placeholder: 'שם פרטי או שם משפחה',
  loading: 'קוראים את המערכות של כל הכיתות…',
  unsupported: 'החיפוש עוד לא זמין. הוא יגיע בעדכון הקרוב של השרת.',
  noClass: 'כדי לחפש מורים צריך לבחור כיתה באתר המערכת של בית הספר.',
  noLessonsToday: 'אין היום שיעורים במערכת של בית הספר.',
  noMatch: 'לא מצאנו מורה בשם הזה במערכת של היום.',
  /** The site holds the high school's classes only: a teacher there today only in junior high is not in it. */
  noMatchWhy: 'מופיעים רק מורים שמלמדים היום בכיתות שבאתר המערכת.',
  source: (time: string) => `לפי המערכות של הכיתות באתר בית הספר, נכון ל־${time}`,
  hint: (count: number) => `${count} מורים במערכת של היום`,
  todayHeading: 'היום',
} as const;

/** Where a period is, in full, for the day's list: its place when the site gives one, and its classes. */
export function periodWhere(period: TeacherPeriod): string {
  const classes = period.classes.filter((c) => c !== period.room);
  return [period.room, classes.join(', ')].filter(Boolean).join(', ');
}

/** Where a period is, short, for the sentence: the place, else its class (or how many). */
export function periodPlace(period: TeacherPeriod): string {
  if (period.room) return period.room;
  return period.classes.length <= 2 ? period.classes.join(', ') : `${period.classes.length} כיתות`;
}

/** What a period's status says, when it says something: "בוטל", "מוחלף: …", "במקום …". */
export function periodStatus(period: TeacherPeriod): string | null {
  if (period.status === 'cancelled') return period.note && /^הועבר/.test(period.note) ? period.note : 'בוטל';
  if (period.status === 'substitution') {
    if (period.coveredBy !== null) return period.coveredBy ? `מוחלף: ${period.coveredBy}` : 'מוחלף';
    if (period.covering) return `במקום ${period.covering}`;
    if (period.covering === '') return 'מילוי מקום';
  }
  if (period.status === 'exam') return 'מבחן';
  if (period.status === 'moved') return 'שינוי';
  return null;
}

/** "שעה 4, ספרות, יא3": a period in one line. */
export function periodLine(period: TeacherPeriod): string {
  return [`שעה ${period.hourIndex}`, period.subject, periodPlace(period)].filter(Boolean).join(', ');
}

/** How many teachers teach today: in at least one period (the rest are in the list only to be found). */
export function teachingToday(days: TeacherDay[]): number {
  return days.filter((d) => d.periods.some(teacherIsThere)).length;
}

/** The answer, in a sentence and a line under it: where the teacher is at `time`. */
export function nowLines(day: TeacherDay, time: string): { now: string; next: string | null } {
  const at = teacherNow(day, time);
  switch (at.kind) {
    case 'in':
      return {
        now: `עכשיו: ${periodLine(at.period)}`,
        next: at.next ? `אחר כך: ${periodLine(at.next)}${at.next.startTime ? `, ב־${at.next.startTime}` : ''}` : 'זה השיעור האחרון להיום',
      };
    case 'free':
      return {
        now: at.first ? 'השיעור הראשון עוד לא התחיל' : 'עכשיו לא בשיעור',
        next: `השיעור הבא: ${periodLine(at.next)}${at.next.startTime ? `, ב־${at.next.startTime}` : ''}`,
      };
    case 'done':
      return { now: 'השיעורים להיום נגמרו', next: null };
    case 'away':
      return { now: 'השיעורים של היום בוטלו או מוחלפים', next: null };
    case 'none':
      return { now: 'אין היום שיעורים במערכת', next: null };
  }
}

/** Whether the period is the one at `time`: the row the screen marks. */
export function isNowPeriod(day: TeacherDay, period: TeacherPeriod, time: string): boolean {
  const at = teacherNow(day, time);
  return at.kind === 'in' && at.period === period && teacherIsThere(period);
}
