/**
 * Formatting for Hebrew UI strings. Everything numeric that lands inside a
 * Hebrew line is wrapped in <Ltr> by the caller (UI kit §09); these only make
 * the strings. Dates are `YYYY-MM-DD` in the device's local day, which on this
 * phone is Asia/Jerusalem — the same day the server reasons about.
 */
import type { DateStr } from '@sederyom/shared';

/** `YYYY-MM-DD` → `D.M.YYYY`, the form the UI kit uses. */
export function formatDate(date: DateStr): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

/** `YYYY-MM-DD` → `D.M`. */
export function formatShortDate(date: DateStr): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(now: Date = new Date()): DateStr {
  return toDateStr(now);
}

export function addDays(date: DateStr, days: number): DateStr {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/** Whole days from today to `date`; negative when it has passed. */
export function daysUntil(date: DateStr, now: Date = new Date()): number {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** "היום" / "מחר" / "אתמול" / "D.M". */
export function dayLabel(date: DateStr, now: Date = new Date()): string {
  const days = daysUntil(date, now);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === -1) return 'אתמול';
  return formatShortDate(date);
}

/**
 * Due-date wording for a task: overdue tasks say so, in so many words. A
 * completed task is never "באיחור" — it was done, whenever it was due (B2).
 */
export function dueLabel(
  date: DateStr,
  opts: { completed?: boolean; now?: Date } = {},
): { text: string; overdue: boolean } {
  const now = opts.now ?? new Date();
  const days = daysUntil(date, now);
  if (days < 0 && !opts.completed) return { text: `${dayLabel(date, now)}, באיחור`, overdue: true };
  return { text: dayLabel(date, now), overdue: false };
}

/**
 * A count with its noun, in the Hebrew form that reads naturally:
 * `plural(1, 'משימה אחת', 'משימות')` → "משימה אחת", `plural(2, …)` → "2 משימות",
 * `plural(0, …)` → "0 משימות". `one` is the whole phrase for exactly one.
 */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** Sunday-first, as the server names them (lib/time.ts) — Saturday is plain "שבת". */
const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'] as const;

/** "יום שלישי" for a `YYYY-MM-DD`. */
export function weekdayName(date: DateStr): string {
  return WEEKDAYS[new Date(`${date}T12:00:00`).getDay()] ?? '';
}

/**
 * "יום שלישי 20.10" ("שבת 17.10"): one day named in a line, the one form an
 * exam's date is written in everywhere — Today, School, the exam sheet (the
 * Wave 9 re-rate found three). A list's margin keeps its own two-line form.
 */
export function dayDateLabel(date: DateStr): string {
  const { weekday, date: short } = dayDateParts(date);
  return `${weekday} ${short}`;
}

/** `dayDateLabel` in its two parts, for a line that draws the date through `Ltr`: "יום שלישי" and "20.10". */
export function dayDateParts(date: DateStr): { weekday: string; date: string } {
  return { weekday: weekdayName(date), date: formatShortDate(date) };
}

/** "יום שלישי, 20.10.2026" — the title of one day (B4); a comma, no "·" (Wave 9 re-rate). */
export function dayTitle(date: DateStr): string {
  return `${weekdayName(date)}, ${formatDate(date)}`;
}

/**
 * "18–23.10" for a week inside one month, "28.10–2.11" across two. The dash
 * separates two numbers, so the bidi algorithm would swap them inside a
 * Hebrew line: render it through `Ltr`.
 */
export function weekRangeLabel(start: DateStr, end: DateStr): string {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  if (sm === em) return `${sd}–${ed}.${em}`;
  return `${sd}.${sm}–${ed}.${em}`;
}

/** "היום" / "מחר" / "עוד יומיים" / "עוד 12 ימים"; past days read "אתמול" / "לפני 3 ימים". */
export function countdownLabel(days: number): string {
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === 2) return 'עוד יומיים';
  if (days > 2) return `עוד ${days} ימים`;
  if (days === -1) return 'אתמול';
  if (days === -2) return 'לפני יומיים';
  return `לפני ${-days} ימים`;
}

/** Bracketed remarks: the class group "(יב2)", or the lab "(מעבדת מחשבים 1)". */
const BRACKETS = /\([^)]*\)/g;
/** Study units — "5 יח״ל", "3 יח"ל", "5 יחידות" — and level words; they describe the course, not the subject. */
const LEVEL = /(?:^|\s)(?:(?:\d+\s*)?יח(?:["״׳']?ל|ידות)|מורחב|מוגבר|מואץ|מצומצם)(?![א-ת])/g;

/** U+2060 WORD JOINER: draws nothing, and no line may break on either side of it. */
export const WORD_JOINER = '⁠';

/** A numeric range: "1–5", "08:00–10:30", "9 - 11". */
const NUMERIC_RANGE = /\d+(?:[:./]\d+)*(?:\s?[–—-]\s?\d+(?:[:./]\d+)*)+/g;
/** A dash with a letter or digit (not a joiner) on each side, inside one word. */
const INNER_DASH = /([^⁠])([–—-])(?=[^⁠])/g;
/** A link or an address, which keeps its characters exactly (it may be copied). */
const LINKISH = /^(?:\S*:\/\/|www\.)|@/;

/**
 * Text from a source made safe to set in a Hebrew line:
 * - Every numeric range is pinned left to right ("שאלות 1–5", "היום
 *   08:00–10:30"). Inside a Hebrew line the bidi algorithm turns a dash
 *   between two numbers around ("5–1", "10:30–08:00"); the isolate pair
 *   (U+2066 … U+2069, as in `Ltr`) keeps the run in order. Text that already
 *   carries an isolate keeps its isolates as they are.
 * - A dash between two characters that are not spaces (– — -) gets a word
 *   joiner on each side, so the line never breaks there: "1–" at the end of
 *   one line and "6" on the next, "מהירות–" over "זמן" (the Wave 9 re-rate).
 *   A dash with a space beside it is a sentence's, and may break; a link or
 *   an e-mail address is left alone.
 * For strings that cannot go through `Ltr`: homework and message text,
 * notification lines. Running it twice changes nothing.
 */
export function isolateRanges(text: string): string {
  const isolated = text.includes('⁦') ? text : text.replace(NUMERIC_RANGE, (run) => `⁦${run}⁩`);
  return isolated.replace(/\S+/g, (word) => (LINKISH.test(word) ? word : word.replace(INNER_DASH, `$1${WORD_JOINER}$2${WORD_JOINER}`)));
}

/** The first-strong isolate (FSI, U+2068) and its end (PDI, U+2069). */
const FIRST_STRONG_ISOLATE = String.fromCharCode(0x2068);
const POP_ISOLATE = String.fromCharCode(0x2069);

/**
 * A name whose script is not known (one a person chose: a friend's, in Hebrew,
 * Latin or both) made safe to set in a Hebrew line: in a first-strong isolate,
 * it takes its own direction from its first letter and is one unit in the
 * line's order, so "Noa" never pulls the words beside it around. Invisible.
 */
export function isolateName(name: string): string {
  return `${FIRST_STRONG_ISOLATE}${name}${POP_ISOLATE}`;
}

/**
 * The subject alone, as a person would say it: "אנגלית 5 יח״ל (יב2)" →
 * "אנגלית", "פיזיקה מורחב (מעבדת פיסיקה)" → "פיזיקה". Drops the bracketed
 * group and the level (units, "מורחב"); falls back to the input when nothing
 * would be left.
 */
export function stripGroup(name: string): string {
  const out = name
    .replace(BRACKETS, ' ')
    .replace(LEVEL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–·,]+|[\s\-–·,]+$/g, '')
    .trim();
  return out || name.trim();
}

/** What `stripGroup` drops from the brackets: "(יב2)" → "יב2"; `null` when there are none. */
export function groupOf(name: string): string | null {
  const inner = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  return inner.length > 0 ? inner.join(', ') : null;
}

/**
 * Short forms, taken from the real names in the school's grid and its exam
 * calendar (server/fixtures, and the production capture of 8.10.2026). The
 * patterns are unanchored so they also find the subject inside an exam title
 * ("בגרות באנגלית - G").
 */
const SHORT_SUBJECTS: readonly [RegExp, string][] = [
  [/חינוך גופני|חנ["״]ג/, 'חנ״ג'],
  [/תנ["״]ך/, 'תנ״ך'],
  [/מדעי ה?מחשב|מדמ["״]ח/, 'מדמ״ח'],
  [/שי?רותי רשת/, 'רשתות'],
  [/מערכות רפואיות/, 'רפואה'],
  [/עולם הערבים/, 'ערבים'],
  [/כישורי חיים/, 'כישורים'],
  [/מחשבת ישראל/, 'מחשבת'],
  [/מתמטיקה|מתימטיקה/, 'מתמ׳'],
  [/אנגלית/, 'אנג׳'],
  [/היסטוריה/, 'היסט׳'],
  [/פיזיקה|פיסיקה/, 'פיז׳'],
  [/ביולוגיה|(?:^|\s)ב?ביו(?![א-ת])/, 'ביו׳'],
  [/גיאוגרפיה|גאוגרפיה/, 'גיאו׳'],
  [/כימיה/, 'כימיה'],
  [/אזרחות/, 'אזרחות'],
  [/ספרות/, 'ספרות'],
  [/מוזיקה|מוסיקה/, 'מוזיקה'],
  [/אמנות|אומנות/, 'אמנות'],
  [/ערבית/, 'ערבית'],
  [/עברית/, 'עברית'],
  [/לשון/, 'לשון'],
  [/חינוך/, 'חינוך'],
];
/** A block exam: one sitting, a different subject per student ("מבחן גוש א'"). */
const BLOCK = /גוש\s*([אב])(?:['׳]|(?![א-ת]))/;
/** A class number an exam title may open with ("3 אקדמיזציה", "2 - בגרות …"). */
const LEADING_NUMBER = /^[\d\s\-–+]+/;
/** What an exam title opens with before the subject. */
const EXAM_KIND = /^(?:מבחן|בגרות|מתכונת|מבדק|הגשת|הגשה|שכבתי)\s+/;

/**
 * One short word per subject for tight places — the week grid's cells, an
 * exam tag. Readable and never misleading: a known subject gets the short
 * form students use ("שרותי רשת (מעבדת מחשבים 1)" → "רשתות", not "שרותי"),
 * anything else its first whole word, never cut mid-word. Works on exam
 * titles too: "מתכונת באנגלית וויקה" → "אנג׳", "מבחן גוש ב'" → "גוש ב׳".
 */
export function shortSubject(name: string): string {
  const block = BLOCK.exec(name);
  // The subject that appears first wins ("מתכונת במוזיקה ובאמנות" → מוזיקה);
  // on a tie the earlier rule does, so "חינוך גופני" beats "חינוך".
  let best: { at: number; short: string } | null = block ? { at: block.index, short: `גוש ${block[1]}׳` } : null;
  for (const [re, short] of SHORT_SUBJECTS) {
    const m = re.exec(name);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, short };
  }
  if (best) return best.short;
  const clean = stripGroup(name).replace(LEADING_NUMBER, '').replace(EXAM_KIND, '').trim();
  return clean.split(' ')[0] || stripGroup(name);
}

/**
 * A lesson, an exam, homework, a grade or an absence's subject: `subject` is
 * what is shown, and `originalSubject` is set only when that is a name the
 * student gave it (shared/logic/ownNames.ts, local/examPrefs.ts), the
 * source's name kept there.
 */
export interface SubjectItem {
  subject: string;
  originalSubject?: string;
}

/**
 * The subject as a line shows it: a name the student gave, as they typed it
 * (brackets and all: they may be the student's own); any other through
 * `stripGroup`, as before.
 */
export function shownSubject(item: SubjectItem): string {
  return item.originalSubject !== undefined ? item.subject : stripGroup(item.subject);
}

/**
 * An exam's title as it leaves the phone, to a friend or to the class's
 * group: a name the student gave this exam goes as they gave it; a name that
 * came from the subject's (`subjectName`) stays on the phone, and the
 * source's title goes in its place.
 */
export function sentExamTitle(exam: SubjectItem & { subjectName?: string }): string {
  return exam.subjectName !== undefined ? (exam.originalSubject ?? exam.subject) : exam.subject;
}

/** `shownSubject` for tight places: a name the student gave, as typed; any other through `shortSubject`. */
export function shortShownSubject(item: SubjectItem): string {
  return item.originalSubject !== undefined ? item.subject : shortSubject(item.subject);
}

export function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "לפני 12 דקות" / "לפני שעתיים" / "אתמול" / "לפני 4 ימים" / "עכשיו". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'עכשיו';
  // Whole words, not "דק׳" / "שע׳" (Daniel, run 4: abbreviations are hard to read).
  if (minutes === 1) return 'לפני דקה';
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'לפני שעה';
  if (hours === 2) return 'לפני שעתיים';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'אתמול';
  if (days === 2) return 'לפני יומיים';
  return `לפני ${days} ימים`;
}

/** "3.9, 07:40" — how the site's own "מעודכן ל" is echoed. */
export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}.${d.getMonth() + 1}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
