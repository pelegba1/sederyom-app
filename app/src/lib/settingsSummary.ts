/**
 * The one line under each group on Settings' main screen: what the page behind
 * it holds, in the words of the rows on that page. Parts are joined with ", ".
 *
 * Pure: type-only imports plus `./onboarding` and `./format`, so app/test can
 * load it without React Native.
 */
import type { NotificationType } from '@sederyom/shared';
import { plural } from './format';
import { calendarsShownLabel, displayClassName, examsMarkedLabel, subjectsShownLabel } from './onboarding';

/** Said under "התראות" while the phone does not allow them; the switches below are drawn disabled. */
export const PERMISSION_OFF_LINE = 'ההתראות כבויות בטלפון';

/** A line and how loud to draw it: `attention` is the red one. */
export type SummaryLine = { text: string; tone: 'muted' | 'attention' };

/**
 * Under "התראות וזמנים": the phone's refusal first (red), then vacation mode,
 * else how many of the switches shown are on, and the quiet hours when they span time.
 */
export function notificationsSummary(input: {
  permission: 'checking' | 'granted' | 'off';
  vacation: boolean;
  shown: readonly NotificationType[];
  on: Partial<Record<NotificationType, boolean>>;
  quiet: { enabled: boolean; from: string; to: string };
}): SummaryLine {
  if (input.permission === 'off') return { text: PERMISSION_OFF_LINE, tone: 'attention' };
  if (input.vacation) return { text: 'מצב חופש פעיל', tone: 'muted' };
  const count = input.shown.filter((type) => input.on[type]).length;
  if (count === 0) return { text: 'כל הסוגים כבויים', tone: 'muted' };
  const parts = [plural(count, 'סוג אחד פעיל', 'סוגים פעילים')];
  const { enabled, from, to } = input.quiet;
  if (enabled && from !== to) parts.push(`שעות שקטות מ־${from} עד ${to}`);
  return { text: parts.join(', '), tone: 'muted' };
}

/**
 * Under "אני ובית הספר" / "אני והילדים": the class, or for a parent the child
 * shown now. The title already says whose phone it is, so no audience here.
 */
export function meSummary(input: { parent: boolean; className: string; shownChild: string | null }): string {
  if (input.parent && input.shownChild) return input.shownChild;
  return displayClassName(input.className) || 'עוד לא נבחרה כיתה';
}

/**
 * What a parent's phone calls the child shown now, where a student's phone
 * says the class: with a list, the list's name for it (`childName`: the
 * parent's, else the class's); with one child, the name kept for it
 * (`readOnlyChildName`). `null` when there is none to say, and for a student,
 * who has no children: the caller says the class then.
 */
export function shownChildName(input: { parent: boolean; listName: string | null; onlyName: string }): string | null {
  if (!input.parent) return null;
  return input.listName?.trim() || input.onlyName.trim() || null;
}

/** Under "Google": whether it is connected, and what it does for the person ("עוד אין יומנים" before the calendars are read, as on the Google page). */
export function googleSummary(input: { connected: boolean; examsToCalendar: boolean; calendarsShown: number; hasCalendars: boolean }): string {
  if (!input.connected) return 'לא מחובר';
  return [
    input.examsToCalendar ? 'המבחנים ביומן' : 'המבחנים לא ביומן',
    input.hasCalendars ? calendarsShownLabel(input.calendarsShown) : 'עוד אין יומנים',
  ].join(', ');
}

/** Under "מה מוצג": the same counts the rows behind it say, and "עוד אין מבחנים" when there are none. */
export function shownSummary(input: { subjects: number; hasSubjects: boolean; exams: number; hasExams: boolean }): string {
  const parts: string[] = [];
  if (input.hasSubjects) parts.push(subjectsShownLabel(input.subjects));
  parts.push(input.hasExams ? examsMarkedLabel(input.exams) : 'עוד אין מבחנים');
  return parts.join(', ');
}

/** Under "מראה": the theme and the text size, as the pickers name them. */
export function appearanceSummary(themeLabel: string, scaleLabel: string): string {
  return [themeLabel, `טקסט ${scaleLabel}`].join(', ');
}
