/**
 * Pure logic behind the School screens ("בית ספר", "המבחנים שלי") and the
 * exam sheet: grouping exams by subject and switching a whole subject at
 * once, unsure exams, the owner's "שלי" and the one exam count, an exam's
 * periods that day, its material and study
 * plan, the date a message names, grade averages, homework due lines and
 * overdue marks, and what a Mashov-fed list shows when Mashov is not
 * connected (F8). No React here — app/test/school.test.cjs runs it under
 * plain Node.
 */
import type {
  Audience, ClassroomMaterial, ClassroomWork, DateStr, DayView, ExamMatch, Grade, Homework, Instant, SchoolTab, Source, SourceStatus, TaskListOption,
} from '@sederyom/shared';
import { addDays, countdownLabel, dayDateLabel, formatShortDate, plural, shownSubject, stripGroup, toDateStr, weekdayName } from './format';
import { EMPTY_WEIGHTS, subjectAverage, type GradeWeightsPrefs, type SubjectAverage } from './gradeWeights';

// ---------------------------------------------------------------------------
// Text

/**
 * Collapses the whitespace the school site's calendar leaves in: runs of
 * spaces and tabs become one space, every line is trimmed, blank lines go.
 * Line breaks stay — a block exam's details are a list of subjects.
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** "13:00", "9:00" — a clock time and nothing else. */
const LEADING_TIME = /^([01]?\d|2[0-3]):([0-5]\d)(?![\d:]?\d)\s*(?::\s*)?/;

/**
 * An exam's details, cleaned, with a leading clock time peeled off so it can
 * sit next to the date: "13:00" → time 13:00, no text; "09:00:   שאלון 471"
 * → time 09:00, text "שאלון 471". A range ("שעות: 16:00-8:00"), a lesson
 * number ("3-2") or a second time later on ("…13:30: שאלון 371") stays in
 * the text, where it reads correctly.
 */
export function splitExamDetails(details: string | null | undefined): { time: string | null; text: string | null } {
  const clean = cleanText(details);
  if (!clean) return { time: null, text: null };
  const m = LEADING_TIME.exec(clean);
  // Only a lone time is "the" time: with two, the first is one of several sittings.
  const times = clean.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) ?? [];
  if (!m || times.length !== 1 || /^[-–]/.test(clean.slice(m[0].length))) return { time: null, text: clean };
  const time = `${m[1]!.padStart(2, '0')}:${m[2]}`;
  const rest = clean.slice(m[0].length).trim();
  return { time, text: rest || null };
}

// ---------------------------------------------------------------------------
// Dates

const SHORT_WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'] as const;

/** "יום ו׳" for a `YYYY-MM-DD`; Saturday is "שבת". */
export function shortWeekday(date: DateStr): string {
  return SHORT_WEEKDAYS[new Date(`${date}T12:00:00`).getDay()] ?? '';
}

/** The weekday under a date in a list's margin (plan §16.1), as narrow as it goes: "ו׳", "שבת". */
export function marginWeekday(date: DateStr): string {
  return shortWeekday(date).replace(/^יום /, '');
}

/** The local day an instant falls on, `YYYY-MM-DD`; `null` for a missing or broken one. */
export function instantDate(iso: Instant | null | undefined): DateStr | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return toDateStr(d);
}

/** The local day an instant falls on, as `D.M` — for "המידע מ־5.10". */
export function instantShortDate(iso: Instant | null): string | null {
  const date = instantDate(iso);
  return date ? formatShortDate(date) : null;
}

/** Sunday to Thursday: the days a study session or a school deadline falls on. */
export function isSchoolWeekday(date: DateStr): boolean {
  return new Date(`${date}T12:00:00`).getDay() <= 4;
}

// ---------------------------------------------------------------------------
// A date written in free text (W4-6)

/** "ראשון" … "שישי", "שבת"; and the letters "א׳" … "ו׳" after "יום". */
const WEEKDAY_NAMES: Record<string, number> = {
  'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6,
  'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5,
};

/** "ביום רביעי", "יום ד׳", "ליום שני" — never "היום", which is a different word. */
const WEEKDAY_IN_TEXT = /(?<![א-ת])(?:ו?[בל])?יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|[אבגדהו]['׳])(?![א-ת])/;

/** "מחר", "למחר", "ממחר", "מחרתיים" — not "למחרת". */
const TOMORROW_IN_TEXT = /(?<![א-ת])[ולמ]?(מחרתיים|מחר)(?![א-ת])/;

/** "12.10", "12/10", "12.10.26", "12/10/2026" — two numbers that may be a day and a month. */
const NUMERIC_DATE = /(?<![\d./:])(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d:%]|[./]\d)/g;

/** A number right after one of these words is a chapter, a page or a time, not a date ("פרק 3.2", "בשעה 12.10"). */
const NOT_A_DATE_BEFORE = /(?:פרק|פרקים|עמ(?:וד|ודים)?['׳]?|סעיף|סעיפים|שאלה|שאלות|תרגיל|תרגילים|שעה|בשעה|יחידה|גרסה|שאלון)\s*[:\-־]?\s*$/;
/** …or right before these ("3.5 יח״ל"). */
const NOT_A_DATE_AFTER = /^\s*(?:יח|%|נק)/;
/** "עד ה־12.10", "עד 11.10": a deadline, which wins over any other date in the text. */
const DEADLINE_BEFORE = /עד\s*(?:ה|ל)?[־\-]?\s*$/;

/** How far ahead a day and month without a year may be read: half a year. */
const NUMERIC_DATE_AHEAD_DAYS = 183;
/** …and how far back, so "15.1" written in December is next January. */
const NUMERIC_DATE_BEHIND_DAYS = 30;

export type DateMentionKind = 'date' | 'weekday' | 'relative';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): DateStr | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(y, m, 0).getDate();
  return d <= last ? `${y}-${pad2(m)}-${pad2(d)}` : null;
}

function numericDateIn(text: string, ref: DateStr): DateStr | null {
  const refYear = Number(ref.slice(0, 4));
  let first: DateStr | null = null;
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 14), at);
    if (NOT_A_DATE_BEFORE.test(before) || NOT_A_DATE_AFTER.test(text.slice(at + m[0].length))) continue;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let date: DateStr | null;
    if (m[3]) {
      date = validDate(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mo, d);
    } else {
      date = validDate(refYear, mo, d);
      if (date && date < addDays(ref, -NUMERIC_DATE_BEHIND_DAYS)) date = validDate(refYear + 1, mo, d);
      if (date && date > addDays(ref, NUMERIC_DATE_AHEAD_DAYS)) date = null;
    }
    if (!date) continue;
    if (DEADLINE_BEFORE.test(before)) return date;
    first ??= date;
  }
  return first;
}

/**
 * The day a text names, read from `ref` — the day it was written — and what
 * kind of mention it was. An explicit date wins ("ביום רביעי, 14.10" →
 * 14.10), a deadline ("עד ה־11.10") over any other date; then a weekday, the
 * next one after `ref` (on a Wednesday, "ביום רביעי" is next week's); then
 * "מחר" and "מחרתיים". `null` when it names no day.
 */
export function dateMentionIn(text: string, ref: DateStr): { date: DateStr; kind: DateMentionKind } | null {
  const clean = cleanText(text);
  if (!clean) return null;
  const numeric = numericDateIn(clean, ref);
  if (numeric) return { date: numeric, kind: 'date' };
  const weekday = WEEKDAY_IN_TEXT.exec(clean);
  if (weekday) {
    const target = WEEKDAY_NAMES[weekday[1]!.replace(/['׳]$/, '')];
    if (target !== undefined) {
      const from = new Date(`${ref}T12:00:00`).getDay();
      return { date: addDays(ref, (target - from + 7) % 7 || 7), kind: 'weekday' };
    }
  }
  const tomorrow = TOMORROW_IN_TEXT.exec(clean);
  if (tomorrow) return { date: addDays(ref, tomorrow[1] === 'מחרתיים' ? 2 : 1), kind: 'relative' };
  return null;
}

/**
 * The day a text names, as `dateMentionIn` reads it from `today`: "ביום
 * רביעי", "מחר", "מחרתיים", "12.10", "12/10", "עד ה־12.10". `null` when it
 * names none.
 */
export function dateInText(text: string, today: DateStr): DateStr | null {
  return dateMentionIn(text, today)?.date ?? null;
}

/**
 * The due date "להוסיף למשימות שלי" gives a message (W4-6): the day its text
 * names, read from the day it was sent — "מחר" in Monday's message is
 * Tuesday. A day that has already passed is no due date for a new task, so
 * it gets none, as before; except a weekday ("ביום רביעי"), which someone
 * adding the message now means as the coming one.
 */
export function messageTaskDue(msg: { title: string; body: string; date: Instant }, today: DateStr): DateStr | null {
  return messageTaskDay(msg, today)?.date ?? null;
}

/**
 * `messageTaskDue`, and whether it is the next such weekday because the one
 * the message meant has passed (`next`): a message sent Monday about "יום
 * רביעי" says Wednesday 7.10 on its card, and on Thursday its task goes to
 * Wednesday 14.10 (run 8, Noa: the card and the button named two dates).
 */
export function messageTaskDay(msg: { title: string; body: string; date: Instant }, today: DateStr): { date: DateStr; next: boolean } | null {
  const text = `${msg.title}\n${msg.body}`;
  const sent = instantDate(msg.date) ?? today;
  const mention = dateMentionIn(text, sent < today ? sent : today);
  if (!mention) return null;
  if (mention.date >= today) return { date: mention.date, next: false };
  if (mention.kind !== 'weekday') return null;
  const coming = dateInText(text, today);
  return coming ? { date: coming, next: true } : null;
}

/**
 * The day a message's task is due, as the button and its toast say it after
 * "ל": "יום ד׳ " before the date, or for the next such weekday "יום רביעי
 * הבא, " (run 8). The date itself is `formatShortDate`, drawn through `Ltr`.
 */
export function messageTaskDayLead(day: { date: DateStr; next: boolean }): string {
  return day.next ? `${weekdayName(day.date)} הבא, ` : `${shortWeekday(day.date)} `;
}

// ---------------------------------------------------------------------------
// Who sent a message, and when (plan §14.1)

/**
 * The sender as a person reads it: Mashov files a teacher under a group —
 * "מורים/דנה כהן" — and the name is what follows. A one-word group before a
 * "/" goes; anything else stays as it is. `null` when there is no sender.
 */
export function senderName(from: string | null | undefined): string | null {
  const clean = cleanText(from).replace(/\n/g, ' ');
  if (!clean) return null;
  return clean.replace(/^(?:[א-ת"״׳']+\s*\/\s*)+(?=\S)/, '').trim() || clean;
}

/**
 * "נשלחה" and the day a message was sent (plan §14.1). When Mashov gave no
 * send time, the date is when it first reached the app (`dateIsFirstSeen`),
 * and it says "התקבלה". The school site publishes its notices: "פורסמה". The
 * date is rendered in `Ltr`; `null` for a missing or broken one.
 */
export function messageDateLabel(
  msg: { date: Instant; dateIsFirstSeen?: boolean; source?: Source | string },
): { lead: string; date: string } | null {
  const date = instantShortDate(msg.date);
  if (!date) return null;
  if (msg.dateIsFirstSeen) return { lead: 'התקבלה', date };
  return { lead: msg.source && msg.source !== 'mashov' ? 'פורסמה' : 'נשלחה', date };
}

/** Newest first, by the instant itself — two offsets ("+02:00", "+03:00") do not sort as strings. */
export function messagesNewestFirst<M extends { date: Instant }>(messages: readonly M[]): M[] {
  const at = (m: M): number => {
    const t = Date.parse(m.date);
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...messages].sort((a, b) => at(b) - at(a));
}

// ---------------------------------------------------------------------------
// Finding a message: by words and by teacher

/** The label of the search box in the messages list. */
export const MESSAGE_SEARCH_LABEL = 'חיפוש בהודעות';

/** The sender menu's first row: no teacher picked, every message. */
export const ALL_SENDERS = 'כל המורים';

/** The title of the sender menu. */
export const SENDER_MENU_TITLE = 'ממי ההודעות';

/** In place of the list when the words or the teacher match nothing. */
export const MESSAGES_NO_MATCH = 'אין הודעות שמתאימות לחיפוש';

/** The button that empties the search box. */
export const CLEAR_MESSAGE_SEARCH = 'לנקות את החיפוש';

/** Under the search while some older messages have no body yet: why a word from a body may not be found. */
export const MESSAGE_BODIES_PENDING = 'התוכן של חלק מההודעות הישנות עוד נטען, ובינתיים מחפשים בהן רק בכותרת ובשם השולח';

/**
 * Text as a search compares it: one line, single spaces (Mashov's double
 * spaces and no-break spaces), Latin letters in lower case, and the gershayim
 * and geresh a phone keyboard types (" and ') for the Hebrew marks (״ and ׳)
 * a school writes with.
 */
export function normalizeSearchText(text: string | null | undefined): string {
  return cleanText(text)
    .replace(/\s+/g, ' ')
    .replace(/״/g, '"')
    .replace(/׳/g, "'")
    .toLocaleLowerCase();
}

/**
 * The messages that match a search and a sender, in the order given. Every
 * word of the search has to be somewhere in the title, the body or the
 * sender's name, in any order; a blank search keeps every message. The
 * sender is a name as `senderName` gives it, or `null` for any.
 */
export function selectMessages<M extends { title: string; body: string; from: string | null }>(
  messages: readonly M[],
  opts: { search: string; sender: string | null },
): M[] {
  const byTeacher = opts.sender === null ? messages : messages.filter((m) => senderName(m.from) === opts.sender);
  const words = normalizeSearchText(opts.search).split(' ').filter(Boolean);
  if (words.length === 0) return [...byTeacher];
  return byTeacher.filter((m) => {
    const text = normalizeSearchText(`${m.title} ${m.body} ${senderName(m.from) ?? ''}`);
    return words.every((word) => text.includes(word));
  });
}

/**
 * The teachers who wrote the messages, the one who wrote last first, each
 * with how many messages: the rows of the sender menu. A message with no
 * sender names no one; a broken date counts as the oldest.
 */
export function messageSenders(
  messages: readonly { from: string | null; date: Instant }[],
): { name: string; count: number }[] {
  const senders = new Map<string, { name: string; count: number; last: number }>();
  for (const m of messages) {
    const name = senderName(m.from);
    if (!name) continue;
    const parsed = Date.parse(m.date);
    const at = Number.isNaN(parsed) ? -Infinity : parsed;
    const sender = senders.get(name);
    if (sender) {
      sender.count += 1;
      if (at > sender.last) sender.last = at;
    } else {
      senders.set(name, { name, count: 1, last: at });
    }
  }
  return [...senders.values()]
    .sort((a, b) => (a.last === b.last ? 0 : b.last > a.last ? 1 : -1))
    .map(({ name, count }) => ({ name, count }));
}

/** What the search found: "נמצאה הודעה אחת", "נמצאו 3 הודעות". */
export function messageSearchCount(n: number): string {
  return n === 1 ? 'נמצאה הודעה אחת' : `נמצאו ${n} הודעות`;
}

// ---------------------------------------------------------------------------
// A teacher's message in one line (W6-8)

export interface MessageSummary {
  /** The day it is about, as `dateMentionIn` reads it from the day it was sent. */
  date: DateStr | null;
  /** "15:15", or a range "17:00–20:00". */
  time: string | null;
  /** What to bring: "חלוק, משקפי מגן ומחשבון". */
  bring: string | null;
}

/** A clock time, and an optional end: "16:00-17:30", "בין 17:00 ל־20:00". */
const TIME_IN_TEXT = /(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?:\s*[-–]\s*|\s+ל[־-]?\s*)?(?:([01]?\d|2[0-3]):([0-5]\d))?(?![\d:])/;
/** "להביא …", "להגיע עם …", up to the end of its sentence. */
const BRING_IN_TEXT = /(?<![א-ת])(?:להביא|להגיע עם|מגיעים עם|לבוא עם)\s+([^.!?\n]+)/;
/** "עד", alone: a sentence naming a deadline, whose date is no meeting with a time. */
const DEADLINE_WORD = /(?<![א-ת])עד(?![א-ת])/;
/** Room for "להביא: …" on the summary line. */
const BRING_MAX = 50;

function timeIn(sentence: string): string | null {
  const m = TIME_IN_TEXT.exec(sentence);
  if (!m) return null;
  const start = `${m[1]!.padStart(2, '0')}:${m[2]}`;
  return m[3] ? `${start}–${m[3].padStart(2, '0')}:${m[4]}` : start;
}

/**
 * The few facts a teacher's message carries (W6-8, Daniel: "a wall of grey
 * text"): the day it is about, a time, and what to bring — for a bold line
 * over the body. The day is the first one the title or a sentence names; the
 * time the first one anywhere, except that a deadline's ("עד 15.10") takes
 * only a time in its own sentence — "המפגשים ב־15:30" is not the deadline's
 * hour. `null` when the message has none of the three.
 */
export function messageSummary(msg: { title: string; body: string; date: Instant }, today: DateStr): MessageSummary | null {
  const sent = instantDate(msg.date) ?? today;
  const sentences = [cleanText(msg.title), ...cleanText(msg.body).split(/(?<=[.!?])\s+|\n+/)].filter(Boolean);
  let date: DateStr | null = null;
  let time: string | null = null;
  for (const sentence of sentences) {
    const mention = dateMentionIn(sentence, sent);
    if (!mention) continue;
    date = mention.date;
    if (DEADLINE_WORD.test(sentence)) time = timeIn(sentence);
    else time = sentences.map(timeIn).find(Boolean) ?? null;
    break;
  }
  if (!date) time = sentences.map(timeIn).find(Boolean) ?? null;
  const bringMatch = BRING_IN_TEXT.exec(sentences.join('\n'));
  const bringText = bringMatch?.[1]?.replace(/[\s,;:]+$/, '').trim() ?? '';
  const bring = bringText ? fitTitle(bringText, 0, BRING_MAX) : null;
  if (!date && !time && !bring) return null;
  return { date, time, bring };
}

/** "יום ו׳ 16.10, 07:30, להביא: מים וכובע" — the summary as one plain string, for a screen reader and the tests. */
export function messageSummaryText(summary: MessageSummary): string {
  return [
    summary.date ? `${shortWeekday(summary.date)} ${formatShortDate(summary.date)}` : null,
    summary.time,
    summary.bring ? `להביא: ${summary.bring}` : null,
  ].filter(Boolean).join(', ');
}

/**
 * The toast after "להוסיף למשימות שלי": "נוסף למשימות, ליום רביעי 14.10"
 * ("ליום רביעי הבא, 14.10" for the next such weekday, `next`), or
 * "נוסף למשימות" for a task with no date (plan §16.2: it says what happened,
 * without a tick). The date is wrapped in the isolate pair, as `Ltr` would: a
 * toast is one plain string.
 */
export function addedToTasksLabel(due: DateStr | null | undefined, next = false): string {
  if (!due) return 'נוסף למשימות';
  return `נוסף למשימות, ל${weekdayName(due)}${next ? ' הבא,' : ''} ⁦${formatShortDate(due)}⁩`;
}

/**
 * Homework is in "משימות" already (W6-4: Daniel, Maya and Noa each asked
 * what "הוסף למשימות שלי" added). What is left is a copy in Google Tasks,
 * named for what it is, in the homework's own sheet — never on every row.
 */
export const COPY_TO_GOOGLE_TASKS = 'להעתיק ל־Google Tasks';

/**
 * Whether a homework sheet offers "להעתיק ל־Google Tasks": homework with no
 * copy yet, outside the demo, and only with a Google to copy to.
 */
export function canCopyToGoogle(item: { linkedTaskId?: string | null }, demo: boolean, google: boolean): boolean {
  return !item.linkedTaskId && !demo && google;
}

/** Under the homework in its sheet: why there is nothing to add, and what the copy is. */
export const HOMEWORK_IN_TASKS = 'שיעורי הבית כבר מופיעים במשימות. אפשר גם להעתיק אותם ל־Google Tasks, כדי לראות אותם גם שם.';

/** In place of the button, once the homework has its copy (the sheet draws a tick icon beside it). */
export const HOMEWORK_COPIED = 'הועתק ל־Google Tasks';

/** The toast after "להעתיק ל־Google Tasks": "הועתק ל־Google Tasks, ליום רביעי 14.10", the date pinned as `addedToTasksLabel` pins it. */
export function copiedToTasksLabel(due: DateStr | null | undefined): string {
  if (!due) return HOMEWORK_COPIED;
  return `הועתק ל־Google Tasks, ל${weekdayName(due)} ⁦${formatShortDate(due)}⁩`;
}

// ---------------------------------------------------------------------------
// Exams

/**
 * Full subject names, found anywhere in an exam title ("י״ב- מתכונת
 * באנגלית" → אנגלית). The server fills `ExamOption.subjectKey`; this is the
 * fallback while it does not, and it names subjects the way a group header
 * should — in full, not `shortSubject`'s "אנג׳".
 */
const SUBJECT_NAMES: readonly [RegExp, string][] = [
  [/חינוך גופני|חנ["״]ג/, 'חינוך גופני'],
  [/תנ["״]ך/, 'תנ״ך'],
  [/מדעי ה?מחשב|מדמ["״]ח/, 'מדעי המחשב'],
  [/שי?רותי רשת/, 'שירותי רשת'],
  [/מערכות רפואיות/, 'מערכות רפואיות'],
  [/עולם הערבים|תולדות הערבים/, 'עולם הערבים'],
  [/מחשבת ישראל/, 'מחשבת ישראל'],
  [/מתמטיקה|מתימטיקה/, 'מתמטיקה'],
  [/אנגלית/, 'אנגלית'],
  [/היסטוריה/, 'היסטוריה'],
  [/פיזיקה|פיסיקה/, 'פיזיקה'],
  [/ביולוגיה|(?:^|[\s\-–])ב?ביו(?![א-ת])/, 'ביולוגיה'],
  [/גיאוגרפיה|גאוגרפיה/, 'גיאוגרפיה'],
  [/כימיה/, 'כימיה'],
  [/אזרחות/, 'אזרחות'],
  [/ספרות/, 'ספרות'],
  [/מוזיקה|מוסיקה/, 'מוזיקה'],
  [/אמנות|אומנות/, 'אמנות'],
  [/פסיכולוגיה/, 'פסיכולוגיה'],
  [/כלכלה/, 'כלכלה'],
  [/ערבית/, 'ערבית'],
  [/עברית/, 'עברית'],
  [/לשון/, 'לשון'],
];

/** A block exam: one sitting, a different subject per student ("מבחן בגוש א'"). */
const BLOCK = /גוש\s*([אב])(?:['׳]|(?![א-ת]))/;

/** The group for exams whose title names no subject ("מועד ב", "טורניר כספות"). */
export const OTHER_EXAMS = 'אחר';

/**
 * The server's name for a block exam whose details list its subjects (plan
 * R-3): "גוש ב׳: פיזיקה, ביולוגיה, …" — the owner's own subject first. It is
 * the exam's `subjectKey`, and its `match.reason` when it is not theirs.
 */
const BLOCK_LABEL = /^(גוש(?:\s*[א-ת]['׳])?)\s*:\s*(.+)$/;

/** "גוש ב׳: פיזיקה, ביולוגיה" → block "גוש ב׳", subjects "פיזיקה, ביולוגיה"; anything else → `null`. */
export function parseBlockLabel(text: string | null | undefined): { block: string; subjects: string } | null {
  const m = BLOCK_LABEL.exec((text ?? '').trim());
  if (!m) return null;
  return { block: m[1]!.replace(/'/g, '׳').replace(/\s+/g, ' '), subjects: m[2]!.trim() };
}

/**
 * The subject an exam title is about, in full ("בגרות באנגלית - G" →
 * "אנגלית", "מבחן בגוש ב - פיזיקה, אמנות ומוזיקה" → "גוש ב׳"), or `''` when
 * it names none. Whatever appears first in the title wins.
 */
export function subjectFromTitle(title: string): string {
  const block = BLOCK.exec(title);
  let best: { at: number; name: string } | null = block ? { at: block.index, name: `גוש ${block[1]}׳` } : null;
  for (const [re, name] of SUBJECT_NAMES) {
    const m = re.exec(title);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, name };
  }
  return best?.name ?? '';
}

/** What an exam option looks like to the grouping — `subjectKey` and `match` may be missing on an older server. */
export interface ExamLike {
  naturalKey: string;
  date: DateStr;
  /** The name it is shown under: the student's own when they gave it one. */
  subject: string;
  /** The source's name, when the student renamed the exam (`local/examPrefs.ts`): what it is matched and grouped by. */
  originalSubject?: string;
  /**
   * Set with `originalSubject` when the name came from the subject's own name, not the exam's (`Exam.subjectName`):
   * no name of the exam's own, so a bagrut exam is still titled by the table (`examNaming`).
   */
  subjectName?: string;
  subjectKey?: string;
  match?: ExamMatch | null;
  /** A bagrut exam from Mashov's own list (plan §14.9): always the owner's (`examMine`), with its hours. */
  kind?: 'bagrut' | 'manual';
  startTime?: string | null;
  endTime?: string | null;
  /**
   * The owner said "שלי" where the server could not tell (W6-2): set by
   * `withConfirmed`, and only on a `mine === null` exam. It clears the "?"
   * and nothing else — `match.mine` stays `null`, so a block exam is not read
   * as matched to its first listed subject.
   */
  confirmed?: boolean;
}

/**
 * Whether an exam is the owner's: always for a bagrut exam from Mashov's own
 * list (plan §14.9) — the student is registered for it, whatever its title
 * looks like to the server's matcher ("אנגלית ז׳ - G" reads as a subject and
 * a teacher) — and otherwise the server's `match.mine`. Every "?", reason and
 * count reads it, so a bagrut exam is never unsure and never "not mine".
 */
export function examMine(exam: Pick<ExamLike, 'kind' | 'match'>): boolean | null {
  // A bagrut registration, or an exam the student added: theirs by definition.
  if (exam.kind === 'bagrut' || exam.kind === 'manual') return true;
  return exam.match?.mine ?? null;
}

/**
 * The exam as every screen shows it once the owner's "שלי" answers are
 * known (`useConfirmedExams`): `confirmed` on an unsure exam they confirmed.
 * A key for an exam the server did place either way changes nothing.
 */
export function resolveConfirmed<E extends ExamLike>(exam: E, confirmed: ReadonlySet<string>): Confirmable<E> {
  const sure = examMine(exam) === null && confirmed.has(exam.naturalKey);
  if (sure === Boolean(exam.confirmed)) return exam;
  return { ...exam, confirmed: sure };
}

/** An exam option (`ExamOption`, say) that may carry the owner's answer. */
export type Confirmable<E> = E & { confirmed?: boolean };

/** `resolveConfirmed` over a list: what onboarding, "המבחנים שלי", School and the exam sheet each read. */
export function withConfirmed<E extends ExamLike>(exams: readonly E[], confirmed: ReadonlySet<string>): Confirmable<E>[] {
  return exams.map((exam) => resolveConfirmed(exam, confirmed));
}

/**
 * The group an exam belongs to: the server's `subjectKey`, else derived from
 * the title, else "אחר". Every exam of one block is one group, "גוש ב׳",
 * whichever subjects its details list — those show on the exam's own row.
 */
export function examGroupKey(exam: ExamLike): string {
  const key = exam.subjectKey?.trim();
  if (key) return parseBlockLabel(key)?.block ?? key;
  // By the source's name: a name of the student's own never moves an exam to another group.
  return subjectFromTitle(exam.originalSubject ?? exam.subject) || OTHER_EXAMS;
}

/** A group of block exams ("גוש א׳"), as opposed to a subject. */
export function isBlockGroup(key: string): boolean {
  return /^גוש(?![א-ת])/.test(key);
}

/** The subjects a block exam covers, "פיזיקה, ביולוגיה, …", when the server named them; `null` otherwise. */
export function blockSubjects(exam: ExamLike): string | null {
  return parseBlockLabel(exam.subjectKey)?.subjects ?? parseBlockLabel(exam.match?.reason)?.subjects ?? null;
}

/**
 * Why an exam is not the owner's, as a tag: "רק למשפרים", "לא במערכת שלך".
 * `null` when it may be theirs, and for a block exam's list of subjects — the
 * row shows that list already, and the tag would only repeat it.
 */
export function examReason(exam: ExamLike): string | null {
  if (examMine(exam) !== false) return null;
  const reason = exam.match?.reason?.trim();
  if (!reason || parseBlockLabel(reason)) return null;
  return reason;
}

/**
 * One sentence for a word on a tag the owner may not know (R-16). Each one
 * explains the word without leaning on it: Maya read "מועד למי שרוצה לשפר
 * ציון" and still did not know who "משפרים" are, nor whether a block was
 * hers (W5-9).
 */
export const BLOCK_EXPLAINER = 'בגוש נבחנים בכמה מקצועות באותה שעה. אם אחד מהם הוא שלך, המבחן נוגע לך';
export const IMPROVERS_EXPLAINER = 'מבחן חוזר למי שכבר נבחנו ורוצים לנסות לקבל ציון גבוה יותר. מי שנבחנים בפעם הראשונה לא צריכים אותו';
export const RESIT_EXPLAINER = 'מועד נוסף, רק לתלמידים שנרשמו אליו';
/** "יח״ל" in a subject's name ("אנגלית 5 יח״ל"), in the words of a ninth-grader (W5-7, Maya). */
export const UNITS_EXPLAINER = 'יח״ל הן יחידות לימוד: הרמה של הבגרות במקצוע. 5 יח״ל היא רמה גבוהה יותר מ־3';
/** "מגמה", in onboarding's class step and in a subject's name (W5-7, Maya). */
export const MAJOR_EXPLAINER = 'מגמה היא מקצוע שבוחרים ללמוד לעומק, עם שיעורים ובגרות משלו';
/** "מתכונת", in onboarding's exam step (W6-8, Maya: "I did not know what a מתכונת is"). */
export const MOCK_EXAM_EXPLAINER = 'מתכונת היא מבחן לקראת הבגרות, שבנוי כמו הבגרות עצמה';

/** What "גוש", "רק למשפרים" or "מועד ב׳" on a tag or a group title means; `null` for anything self-explanatory. */
export function tagExplainer(label: string): string | null {
  if (/גוש(?![א-ת])/.test(label)) return BLOCK_EXPLAINER;
  if (/משפרים/.test(label)) return IMPROVERS_EXPLAINER;
  if (/מועד\s*ב(?:['׳]|(?![א-ת]))/.test(label)) return RESIT_EXPLAINER;
  return null;
}

/** "5 יח״ל", "3 יח"ל", "יחידות" — study units. */
const UNITS_WORD = /(?:^|[^א-ת])יח(?:["״׳']?ל|ידות)(?![א-ת])/;
/** "מגמה", "מגמת ביולוגיה", "מגמות". */
const MAJOR_WORD = /(?:^|[^א-ת])מגמ(?:ה|ת|ות)(?![א-ת])/;

/**
 * What a school word in a name or a sentence means — "יח״ל", "מגמה", and
 * the exam tags `tagExplainer` knows — for a tap-to-explain "?" beside it;
 * `null` when it holds none of them.
 */
export function termExplainer(text: string): string | null {
  if (UNITS_WORD.test(text)) return UNITS_EXPLAINER;
  if (MAJOR_WORD.test(text)) return MAJOR_EXPLAINER;
  return tagExplainer(text);
}

/**
 * The server could not tell whether the exam is the owner's (`match.mine ===
 * null`, or no match at all), and the owner has not said "שלי" (W6-2).
 */
export function isUnsure(exam: Pick<ExamLike, 'match' | 'confirmed' | 'kind'>): boolean {
  return examMine(exam) === null && !exam.confirmed;
}

/**
 * Why an unsure exam is unsure, in a few words beside its "?" (W4-4). The
 * server gives no reason for `mine: null`, but the cases are few: a block
 * exam that does not say which subjects sit it, a title that names no
 * subject, and — most often — a subject the owner has, under another
 * teacher's name ("מתכונת באנגלית וויקה"). `null` when the exam is not unsure.
 */
export function unsureReason(exam: ExamLike): string | null {
  if (!isUnsure(exam)) return null;
  const key = examGroupKey(exam);
  if (isBlockGroup(key)) return blockSubjects(exam) ? 'לא ברור אם המקצוע שלך בגוש' : 'לא כתוב אילו מקצועות בגוש';
  if (key === OTHER_EXAMS) return 'לא כתוב באיזה מקצוע';
  return 'לא ברור אם זו הקבוצה שלך';
}

/**
 * What to do about an unsure exam, after its `unsureReason`: nothing is
 * lost by leaving it, confirming it clears the "?" (W6-2), and hiding it is
 * one tap. The exam sheet says it; so does onboarding's "?".
 */
export const UNSURE_ADVICE = 'השארנו אותו מסומן כשלך, ליתר ביטחון. אם הוא שלך, אפשר לאשר. אם לא, אפשר להסתיר אותו.';

// ---------------------------------------------------------------------------
// The deciding fact beside a "?" (plan §14.7, run 6: Noa)

/**
 * Words in an exam title that say what kind of exam, which part or level,
 * which class — anything but a person. The server's reader skips the same
 * words (server/src/lib/exam-match.ts).
 */
const NOT_A_NAME = new Set([
  'מבחן', 'מבחני', 'בוחן', 'בחינה', 'בחינת', 'בחינות', 'בגרות', 'בגרויות', 'מתכונת', 'מבדק', 'מבדקי', 'הדמיה',
  'ממוחשבת', 'ממוחשב', 'תאריך', 'הגשת', 'הגשה', 'עבודת', 'עבודה', 'מועד', 'תיקון', 'סיום', 'מעבדה', 'במעבדה',
  'חקר', 'מעשי', 'מעשית', 'עיוני', 'עיונית', 'בעל', 'פה', 'בעפ', 'שאלון', 'שאלונים', 'פרק', 'פרקים', 'חלק', 'מסכם',
  'מסכמת', 'סופי', 'סופית', 'אמצע', 'שליש', 'מחצית', 'ראשון', 'ראשונה', 'שני', 'שנייה', 'משותף', 'ארצי', 'פנימי',
  'חיצוני', 'תרגול', 'חזרה', 'בקיאות', 'השלמה', 'השלמות', 'של', 'עם', 'על', 'את', 'כל', 'לכל', 'השכבה', 'שכבה',
  'שכבתי', 'כיתה', 'כיתות', 'קבוצה', 'קבוצת', 'הקבצה', 'רק', 'למשפרים', 'משפרים', 'לא', 'יתקיים', 'נדחה', 'מיוחד',
  'מיוחדת', 'חדש', 'יחל', 'יחידות', 'מוגבר', 'מורחב', 'גוש', 'בגוש', 'אצל', 'המורה', 'מורה',
]);

/** "י"ב2", "יא", "יב3+", "ח'4": a class or a grade, which the title only repeats. */
const CLASS_WORD = /^(?:י["״]?[אבגד]?|[זחט]['׳]?)\d*\+?$/;

/** One of `NOT_A_NAME`, alone or with "ה" or "ו" before it ("הקבוצה", "ושל") — not "ב", which makes "ברק" "רק". */
function notAName(word: string): boolean {
  const bare = word.replace(/["'״׳]/g, '');
  return NOT_A_NAME.has(bare) || (/^[הו]/.test(bare) && NOT_A_NAME.has(bare.slice(1)));
}

/** A name's words of three letters and more, without quote marks: what two spellings of one teacher share. */
function nameTokens(name: string): string[] {
  return name.replace(/[״׳"'`.,]/g, '').split(/[\s\-–]+/).filter((t) => t.length >= 3);
}

/** Whether two names share a word — "יוסי" and "שגיא יוסי" are one teacher, as the server reads them. */
function sameTeacher(a: string, b: string): boolean {
  const left = new Set(nameTokens(a));
  return nameTokens(b).some((t) => left.has(t));
}

/**
 * The words after the subject in an exam title, when they may name a person:
 * "מתכונת באנגלית וויקה" → ["וויקה"]. Kinds, parts, levels, classes, numbers
 * and other subjects ("במוזיקה ובאמנות") are not names. Empty when the title
 * does not name `subject`, or nothing is left after it.
 */
export function titleNameWords(title: string, subject: string): string[] {
  const clean = cleanText(title).replace(/\n/g, ' ');
  const canonical = subjectFromTitle(subject) || subject;
  const patterns = SUBJECT_NAMES.filter(([, name]) => name === canonical).map(([re]) => re);
  let end = -1;
  for (const re of patterns) {
    const m = re.exec(clean);
    if (m && (end < 0 || m.index < end)) end = m.index + m[0].length;
  }
  if (end < 0 && subject.length > 1 && clean.includes(subject)) end = clean.indexOf(subject) + subject.length;
  if (end < 0) return [];
  // The rest of the word the subject ends in ("באנגלית" ends "…ית") is not a name either.
  const after = clean.slice(end).replace(/^[^\s\-–—:;,.()/+]*/, '');
  return after
    .split(/[\s\-–—:;,.()/+]+/)
    .map((w) => w.replace(/^["'״׳]+|["'״׳]+$/g, ''))
    .filter((w) => /^[א-ת]+(?:["'״׳][א-ת]+)?$/.test(w) && w.length >= 2)
    .filter((w) => !notAName(w) && !CLASS_WORD.test(w) && !subjectFromTitle(w));
}

/** What the owner's timetable says about an unsure exam's teacher. */
export interface TeacherFact {
  /** "אנגלית". */
  subject: string;
  /** The owner's teacher of that subject: "יוסי שגיא". */
  own: string;
  /** The name the exam's title gives: "וויקה". */
  exam: string;
}

/**
 * The fact that decides an unsure exam (plan §14.7, Noa: "you know my English
 * teacher is יוסי שגיא, so why ask about וויקה's exam without saying so?"):
 * its title names someone after the subject, the owner keeps exactly one
 * teacher of that subject — Mashov's, when Mashov lists one — and the two are
 * not the same person. `null` whenever any of that is unclear: the exam is
 * not unsure, a block or "אחר", no or several own teachers, a title with no
 * name or more words than a name.
 */
export function teacherFact(
  exam: ExamLike,
  lessons: readonly LessonOptionLike[],
  hiddenSubjects: Iterable<string>,
): TeacherFact | null {
  if (!isUnsure(exam)) return null;
  const subject = examGroupKey(exam);
  if (subject === OTHER_EXAMS || isBlockGroup(subject)) return null;
  const hidden = new Set(hiddenSubjects);
  const kept = groupLessonOptions(lessons.filter((l) => l.teacher && mentionsSubject(l.name, subject)))
    .filter((row) => lessonGroupState(row, hidden) !== false);
  const own = kept.some((row) => row.inMashov) ? kept.filter((row) => row.inMashov) : kept;
  const teachers: string[] = [];
  for (const row of own) {
    const name = cleanText(row.teacher).replace(/\n/g, ' ');
    if (name && !teachers.some((t) => sameTeacher(t, name))) teachers.push(name);
  }
  if (teachers.length !== 1) return null;
  const words = titleNameWords(exam.originalSubject ?? exam.subject, subject);
  if (words.length === 0 || words.length > 2) return null;
  const named = words.join(' ');
  if (sameTeacher(teachers[0]!, named)) return null;
  return { subject, own: teachers[0]!, exam: named };
}

/** "המורה שלך באנגלית: יוסי שגיא. המבחן הזה: וויקה". */
export function teacherFactText(fact: TeacherFact): string {
  return `המורה שלך ב${fact.subject}: ${fact.own}. המבחן הזה: ${fact.exam}`;
}

/** Under a teacher fact: the recommendation, "לא שלי" — said, not done. */
export const FACT_ADVICE = 'כנראה לא שלך';

/**
 * The few words beside an exam card's "?": the recommendation when the
 * teachers decide it ("כנראה לא שלך"), else why it is unsure. `null` when it
 * is not unsure. The card's sheet says the whole fact.
 */
export function unsureNote(exam: ExamLike, lessons: readonly LessonOptionLike[], hiddenSubjects: Iterable<string>): string | null {
  if (!isUnsure(exam)) return null;
  return teacherFact(exam, lessons, hiddenSubjects) ? FACT_ADVICE : unsureReason(exam);
}

/** A title that is only a block's name, in any of the site's spellings ("מבחן בגוש ב", "גוש ב'"). */
const BLOCK_ONLY_TITLE = /^(?:מבחן\s+)?ב?גוש\s*([אב])(?:['׳])?$/;

/**
 * An exam's title as a card shows it: the site's, cleaned, on one line — and
 * a block exam under one name, "מבחן גוש ב׳", however the site spelled it
 * that time (Noa saw "מבחן גוש ב'" and "גוש ב'" side by side).
 */
export function examDisplayTitle(subject: string): string {
  const clean = cleanText(subject).replace(/\n/g, ' ');
  const block = BLOCK_ONLY_TITLE.exec(clean);
  return block ? `מבחן גוש ${block[1]}׳` : clean;
}

/**
 * A block exam's subjects, each once (Daniel saw them twice): the owner's
 * own first, when the server matched it (it lists that one first), and the
 * block's others after it. `null` when the server named no subjects.
 */
export function blockSubjectsParts(exam: ExamLike): { own: string | null; others: string | null } | null {
  const list = blockSubjects(exam);
  if (!list) return null;
  if (examMine(exam) !== true) return { own: null, others: list };
  const [first, ...rest] = list.split(',').map((s) => s.trim()).filter(Boolean);
  if (!first || first === '…') return { own: null, others: list };
  return { own: first, others: rest.length > 0 ? rest.join(', ') : null };
}

/**
 * Where an exam was published: a short tag, the full name for its details,
 * and `meta` — the words at the end of a row's quiet meta line, "מתוך לוח
 * המבחנים" (W5-9: Daniel did not know what a "לוח מבחנים" chip told him).
 *
 * An exam of the exam schedule (`school_site`) is a board's: the class's
 * (a file, a sheet link, a page of the site, a calendar someone brought: all
 * kept alike, so none can be told to be the school's site's), or the
 * person's own, kept on the phone (`fromOwnBoard`, `isOwnBoardExam`) (V-2).
 */
export function examSource(source: Source | string, fromOwnBoard = false): { tag: string; full: string; meta: string } {
  switch (source) {
    case 'school_site': return { tag: 'לוח מבחנים', full: fromOwnBoard ? 'לוח המבחנים שלך' : 'לוח המבחנים של הכיתה', meta: 'מתוך לוח המבחנים' };
    case 'shahaf': return { tag: 'אתר בית הספר', full: 'אתר בית הספר', meta: 'מאתר בית הספר' };
    case 'mashov': return { tag: 'משוב', full: 'משוב', meta: 'ממשוב' };
    case 'google_calendar': return { tag: 'יומן Google', full: 'יומן Google', meta: 'מיומן Google' };
    // Not a source the server knows: an exam the student added (`kind: 'manual'`).
    case 'manual': return { tag: 'הוספת', full: 'הוספת אותו בעצמך', meta: 'הוספת בעצמך' };
    default: return { tag: source, full: source, meta: source };
  }
}

export type ExamStatus = 'recommended' | 'unsure' | 'not_mine';

/**
 * The one status an exam row shows (W5-9): "מומלץ לך" (`mine: true`), "לא
 * בטוח" (`mine: null`), or why it is not the owner's (`mine: false`, when the
 * server says why and it is not only a block's list of subjects). The three
 * cannot meet; the countdown and the source are plain text beside the date.
 * An unsure exam the owner confirmed has none: the "?" is gone (W6-2).
 */
export function examStatus(exam: ExamLike): ExamStatus | null {
  if (isUnsure(exam)) return 'unsure';
  if (examMine(exam) === true) return 'recommended';
  return examReason(exam) ? 'not_mine' : null;
}

/**
 * The subjects an exam is about, in full: the server's key, the owner's own
 * subject in a block exam they sit (else every subject it lists), or the one
 * the title names. Empty for "מועד ב׳" or a block that lists none.
 */
export function examSubjects(exam: ExamLike): string[] {
  const parts = blockSubjectsParts(exam);
  if (parts) {
    if (parts.own) return [parts.own];
    return (parts.others ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== '…');
  }
  const key = examGroupKey(exam);
  return key === OTHER_EXAMS || isBlockGroup(key) ? [] : [key];
}

/** Whether a text names `subject` — in any of its spellings ("פיסיקה", "מדמ״ח"), not only the one given. */
export function mentionsSubject(text: string, subject: string): boolean {
  const canonical = subjectFromTitle(subject) || subject;
  const patterns = SUBJECT_NAMES.filter(([, name]) => name === canonical).map(([re]) => re);
  if (patterns.length > 0) return patterns.some((re) => re.test(text));
  return subject.length > 1 && text.includes(subject);
}

/** A message about an exam says so. */
const EXAM_WORDS = /מבחן|בוחן|בגרות|מתכונת/;

/** How long before an exam a teacher's message about it may come (W4-5). */
export const MATERIAL_DAYS = 21;

/**
 * The teacher's messages about an exam (W4-5, "חומר למבחן"): the same
 * subject, a word for an exam in the title or the body, sent in the
 * `MATERIAL_DAYS` before it (or on the day). Newest first.
 */
export function examMaterial<M extends { title: string; body: string; date: Instant }>(exam: ExamLike, messages: readonly M[]): M[] {
  const subjects = examSubjects(exam);
  if (subjects.length === 0) return [];
  const from = addDays(exam.date, -MATERIAL_DAYS);
  return messages
    .filter((msg) => {
      const sent = instantDate(msg.date);
      if (!sent || sent < from || sent > exam.date) return false;
      const text = `${msg.title}\n${msg.body}`;
      return EXAM_WORDS.test(text) && subjects.some((s) => mentionsSubject(text, s));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// When in the day (W6-3)

/** Which periods an exam takes and when the first starts, as the school published that day. */
export interface ExamSlot {
  /** "שיעור" for one period, "שיעורים" for more. */
  lead: string;
  /** "1–2", "3", or "1, 4" — rendered in `Ltr`. */
  periods: string;
  /** The first period's start, "08:00"; `null` when the site gave none. */
  time: string | null;
}

/** Said where the time would be, until the school publishes the exam's day: a fact, not a promise (Wave 9 re-rate). */
export const EXAM_TIME_PENDING = 'השעה עוד לא פורסמה';

/**
 * When an exam sits (W6-3, Noa: "must"): the lessons of its day that the
 * school marked as an exam (`status: 'exam'`) in its subject — by
 * `mentionsSubject`, on the lesson's name or its note, so "אנגלית 5 יח״ל
 * (יב2)" and "מבחן במתמטיקה" both count. Periods 1 and 2 are "שיעורים 1–2"
 * from 1's start. `null` while there is nothing to go on: no day yet, a day
 * projected from the fixed timetable, no subject to match (a block that lists
 * none, "מועד ב׳"), or no such lesson — the site publishes the exam into the
 * day only shortly before.
 */
export function examSlot(
  exam: ExamLike,
  day: Pick<DayView, 'date' | 'timeline' | 'projected'> | null | undefined,
): ExamSlot | null {
  if (!day || day.projected || day.date !== exam.date) return null;
  const subjects = examSubjects(exam);
  if (subjects.length === 0) return null;
  const lessons = day.timeline
    .flatMap((item) => (item.kind === 'lesson' ? [item.lesson] : []))
    // By the lesson's source name: the exam's subjects are the school's.
    .filter((l) => l.status === 'exam' && subjects.some((s) => mentionsSubject(`${l.originalSubject ?? l.subject}\n${l.note ?? ''}`, s)))
    .sort((a, b) => a.hourIndex - b.hourIndex);
  const first = lessons[0];
  if (!first) return null;
  const hours = [...new Set(lessons.map((l) => l.hourIndex))];
  const contiguous = hours.every((h, i) => i === 0 || h === hours[i - 1]! + 1);
  const periods = hours.length === 1 ? String(hours[0]) : contiguous ? `${hours[0]}–${hours[hours.length - 1]}` : hours.join(', ');
  return { lead: hours.length === 1 ? 'שיעור' : 'שיעורים', periods, time: first.startTime };
}

/** "שיעורים 1–2, 08:00", "שיעור 3" — the slot as one plain string, for a screen reader. */
export function examSlotText(slot: ExamSlot): string {
  return [`${slot.lead} ${slot.periods}`, slot.time].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Bagrut exams (plan §14.9)

/** What a bagrut exam is called on its card and in its sheet. */
export const BAGRUT_EXAM = 'בחינת בגרות';

/** "9:00", "09:00:00" → "09:00"; anything that is not a clock time → `null`. */
function clockTime(text: string | null | undefined): string | null {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)(?::\d\d)?\s*$/.exec(text ?? '');
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

/** An exam's own hours, "14:00–15:45" or "14:00"; `null` when it carries none (the grade's schedule never does). */
export function examHours(exam: Pick<ExamLike, 'startTime' | 'endTime'>): string | null {
  const start = clockTime(exam.startTime);
  if (!start) return null;
  const end = clockTime(exam.endTime);
  return end && end !== start ? `${start}–${end}` : start;
}

/**
 * What kind of exam it is, when that is worth a line: a bagrut exam reads
 * "בחינת בגרות, 14:00–15:45" — the hours rendered in `Ltr`. `null` for an
 * exam from the grade's schedule.
 */
export function examKind(exam: Pick<ExamLike, 'kind' | 'startTime' | 'endTime'>): { label: string; time: string | null } | null {
  if (exam.kind !== 'bagrut') return null;
  return { label: BAGRUT_EXAM, time: examHours(exam) };
}

/** "בחינת בגרות, 14:00–15:45" as one plain string, for a screen reader and the tests. */
export function examKindText(kind: { label: string; time: string | null }): string {
  return [kind.label, kind.time].filter(Boolean).join(', ');
}

export interface ExamGroup<E extends ExamLike = ExamLike> {
  key: string;
  exams: E[];
  /** The group's nearest exam date. */
  firstDate: DateStr;
  /** Some exam in it matches the owner's lessons (`match.mine === true`). */
  recommended: boolean;
}

/**
 * Exams by subject, each group in date order, groups by their nearest exam;
 * "אחר" always last.
 */
export function groupExamsBySubject<E extends ExamLike>(exams: readonly E[]): ExamGroup<E>[] {
  const byKey = new Map<string, E[]>();
  for (const exam of exams) {
    const key = examGroupKey(exam);
    const list = byKey.get(key);
    if (list) list.push(exam);
    else byKey.set(key, [exam]);
  }
  const groups: ExamGroup<E>[] = [...byKey.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    return {
      key,
      exams: sorted,
      firstDate: sorted[0]!.date,
      recommended: sorted.some((e) => examMine(e) === true),
    };
  });
  return groups.sort((a, b) => {
    if (a.key === OTHER_EXAMS) return 1;
    if (b.key === OTHER_EXAMS) return -1;
    return a.firstDate.localeCompare(b.firstDate) || a.key.localeCompare(b.key, 'he');
  });
}

/** How many of a group's exams are shown (not on the hide-list). */
export function groupShown(group: ExamGroup, hidden: ReadonlySet<string>): { shown: number; total: number } {
  return { shown: group.exams.filter((e) => !hidden.has(e.naturalKey)).length, total: group.exams.length };
}

export type GroupSwitchState = 'on' | 'off' | 'partial';

/**
 * A subject's switch: on when all its exams are marked, off when none is, and
 * — when only some are — partial, labelled "2 מתוך 3" rather than drawn as a
 * switch that is plainly on (R-16).
 */
export function groupSwitch(group: ExamGroup, hidden: ReadonlySet<string>): { state: GroupSwitchState; shown: number; total: number; label: string | null } {
  const { shown, total } = groupShown(group, hidden);
  if (shown === 0) return { state: 'off', shown, total, label: null };
  if (shown === total) return { state: 'on', shown, total, label: null };
  return { state: 'partial', shown, total, label: `${shown} מתוך ${total}` };
}

/**
 * The new hide-list after switching `keys` on (`show`) or off. Edits the
 * list in place of rebuilding it: it may hold keys of exams (or lessons) no
 * longer listed, and those must survive.
 */
export function setKeysShown(hiddenKeys: readonly string[], keys: readonly string[], show: boolean): string[] {
  const target = new Set(keys);
  if (show) return hiddenKeys.filter((k) => !target.has(k));
  const out = [...hiddenKeys];
  const have = new Set(hiddenKeys);
  for (const k of keys) if (!have.has(k)) { out.push(k); have.add(k); }
  return out;
}

/** `setKeysShown` for the exams' hide-list. */
export const setExamsShown = setKeysShown;

/**
 * The reason a whole subject is not the owner's, when every exam in it says
 * the same ("רק למשפרים"); `null` when any exam is theirs, unknown, or the
 * reasons differ — then each exam shows its own.
 */
export function groupReason(group: ExamGroup): string | null {
  const reasons = new Set(group.exams.map(examReason));
  if (reasons.size !== 1) return null;
  return [...reasons][0] ?? null;
}

/**
 * The one count every screen shows (R-16): how many exams are marked as the
 * owner's, how many of those the server could not place either way
 * (`mine: null` — "לא בטוח שהם שלך") and the owner has not confirmed
 * (`confirmed`, W6-2: "שלי" counts as theirs), and the recommended ones
 * (`mine: true`, or confirmed) that are switched off — the keys "לסמן את
 * המומלצים" turns on: after "להסתיר הכול" it brought back 11 of 14, without
 * the ones the owner had said were theirs (Daniel, run 6). Every caller passes the same `useConfirmedExams()` set, so onboarding,
 * "המבחנים שלי" and School never disagree (the 11/17 gap).
 */
export function examCounts(
  exams: readonly ExamLike[],
  hidden: ReadonlySet<string>,
  confirmed: ReadonlySet<string>,
): { chosen: number; unsure: number; recommendedOff: string[] } {
  let chosen = 0;
  let unsure = 0;
  const recommendedOff: string[] = [];
  for (const exam of exams) {
    const shown = !hidden.has(exam.naturalKey);
    const mine = examMine(exam);
    const answered = mine === null && (Boolean(exam.confirmed) || Boolean(confirmed?.has(exam.naturalKey)));
    if (shown) {
      chosen += 1;
      if (mine === null && !answered) unsure += 1;
    } else if (mine === true || answered) {
      recommendedOff.push(exam.naturalKey);
    }
  }
  return { chosen, unsure, recommendedOff };
}

export type ExamEmpty = 'none_chosen' | 'none_published';

/**
 * Why the School screen's exam list is empty: the grade has upcoming exams
 * and none is marked as the owner's, or there are none at all. `allUpcoming`
 * is `null` while the picker's list is still loading.
 */
export function examEmptyState(allUpcoming: number | null): ExamEmpty {
  return allUpcoming === 0 ? 'none_published' : 'none_chosen';
}

// ---------------------------------------------------------------------------
// Grades

/**
 * The one line under a subject's average (plan §15, W8), when it is not a
 * plain mean: "ממוצע משוקלל לפי סוג", or "ממוצע משוקלל" when only grades
 * with weights of their own count. Its "?" opens `averageSharesText`. It
 * replaces "הממוצע לפי מבחנים ששווים 35% מהציון", which three run-7 testers
 * could not read. `null` for a plain mean — the line would not be true —
 * unless it is a mean over weights that are only part of the grade (two
 * grades at 20% each): its "?" says how much (Noa, W6-8).
 */
export function averageNote(average: Pick<SubjectAverage, 'weighted' | 'byType' | 'parts'> | null): string | null {
  if (!average) return null;
  const partial = average.parts.reduce((s, part) => s + part.share, 0) < 100 - 1e-6;
  if (!average.weighted && !partial) return null;
  return average.byType ? 'ממוצע משוקלל לפי סוג' : 'ממוצע משוקלל';
}

/**
 * What each part of a subject's average counts, as a percent of the
 * subject's grade — "מבחן 45%, עבודה 15%, ציון בודד 40%" — shown when the
 * subject is open. A type at 0% says "0%": its grades do not count. Grades
 * with weights of their own come last; on their own they say how much of the
 * grade they are ("2 ציונים בודדים 35%", Noa's question in W6-8). Commas,
 * not a chain of "·" (plan §16.2).
 */
export function averageSharesText(average: Pick<SubjectAverage, 'parts'>): string {
  const types = average.parts.filter((part) => part.label !== null);
  const own = average.parts.filter((part) => part.label === null);
  return [
    ...types.map((part) => `${part.label} ${formatAverage(part.share)}%`),
    ...own.map((part) => `${plural(part.count, 'ציון בודד', 'ציונים בודדים')} ${formatAverage(part.share)}%`),
  ].join(', ');
}

/**
 * The grades tab's one help (plan §16.2: once, not under every average), as a
 * question in a text button at the top of the tab: a "?" beside the words
 * "ממוצע משוקלל" read as a heading missing its number (the Wave 9 re-rate).
 */
export const AVERAGE_HELP = 'איך מחשבים את הממוצע?';

/**
 * What `AVERAGE_HELP` opens: how a subject's average is made. Each open
 * subject then says its own parts (`averageSharesText`).
 */
export const WEIGHTED_AVERAGE_EXPLAINER =
  'בכל מקצוע, כל סוג ציון (מבחן, בוחן, עבודה) נספר באחוז משלו, וציון עם משקל משלו נספר לפי המשקל הזה. ״משקלים״ במקצוע פתוח משנים את האחוזים, ולחיצה על ציון משנה את הסוג או את המשקל שלו.';

/**
 * The weights sheet's sum line: "סה״כ 100%", or with a sum that is not 100 a
 * word on what happens then — the types that have grades share the average
 * by their proportions. The number goes through `Ltr`.
 */
export function percentSumParts(sum: number): { lead: string; value: string; note: string | null } {
  const rounded = Math.round(sum * 10) / 10;
  return { lead: 'סה״כ ', value: `${formatAverage(rounded)}%`, note: rounded === 100 ? null : 'הממוצע לפי היחס ביניהם' };
}

/** A grade row's mark when the owner changed its type or weight. */
export const CHANGED_WORD = 'שינית';

/** "87", "86.5" — one decimal at most, none when it is whole. */
export function formatAverage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** From here up a grade is "מצוין". */
export const HIGH_GRADE = 90;

/**
 * The one mark a grade may carry (R-19): a high grade gets "מצוין", with a
 * quiet highlight to go with the word. Every other grade is shown as it is —
 * a word or a colour on a lower one read as the app passing judgement.
 */
export function gradeHighlight(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value >= HIGH_GRADE ? 'מצוין' : null;
}

/**
 * What a subject's number is called: "ציון" when the subject has one grade,
 * "ממוצע" when it has more — the same word whether or not they were
 * weighted, and counting a grade in words ("הוגש") too: the line under the
 * subject says "2 ציונים", so the number over it must not say "ציון"
 * (Daniel). The average itself is of the numeric ones.
 */
export function averageLabel(grades: number): string {
  return grades === 1 ? 'ציון' : 'ממוצע';
}

/** The name of a grade's assessment ("מבחן פרק 3"), when Mashov gives one. */
export function assessmentName(grade: Pick<Grade, 'notes'>): string | null {
  return cleanText(grade.notes).replace(/\n/g, ' ') || null;
}

/**
 * "10% מהציון במקצוע" for a weight; `null` when there is none. "מהציון"
 * alone left Maya asking which grade — the report card's?
 */
export function weightLabel(weight: number | null): string | null {
  return typeof weight === 'number' && weight > 0 ? `${formatAverage(weight)}% מהציון במקצוע` : null;
}

export interface GradeGroup<G extends Grade = Grade> {
  /** The subject as the tab shows it: a name the student gave, as typed; else Mashov's without its group. */
  subject: string;
  /**
   * With a name of the student's own in `subject`: Mashov's subject without
   * its group, what the group is keyed by (its weights, its Classroom work,
   * what a friend gets). Absent otherwise, `subject` being that already.
   */
  originalSubject?: string;
  /** Newest first. */
  grades: G[];
  /** By the subject's types and weights (`lib/gradeWeights.ts`); `null` with no numeric grade. */
  average: SubjectAverage | null;
  latestDate: DateStr;
}

/**
 * Grades by subject (`stripGroup` of Mashov's name, whatever name the student
 * gave it), newest first inside a group, the group with the newest grade
 * first; each with its average by the owner's weights, kept under Mashov's
 * name, so a name given later loses none of them.
 */
export function groupGradesBySubject<G extends Grade>(grades: readonly G[], weights: GradeWeightsPrefs = EMPTY_WEIGHTS): GradeGroup<G>[] {
  const bySubject = new Map<string, G[]>();
  for (const g of grades) {
    const key = stripGroup(g.originalSubject ?? g.subject);
    const list = bySubject.get(key);
    if (list) list.push(g);
    else bySubject.set(key, [g]);
  }
  return [...bySubject.entries()]
    .map(([key, list]): GradeGroup<G> => {
      const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
      const group: GradeGroup<G> = { subject: key, grades: sorted, average: subjectAverage(sorted, key, weights), latestDate: sorted[0]!.date };
      // The name the student gave, as typed, from the newest of its grades that has one.
      const named = sorted.find((g) => g.originalSubject !== undefined);
      return named ? { ...group, subject: named.subject, originalSubject: key } : group;
    })
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.subject.localeCompare(b.subject, 'he'));
}

// ---------------------------------------------------------------------------
// Google Classroom in School (plan §14.5)

/** Two names of one subject: the same without group and level ("אנגלית 5 יח״ל (יב2)", "אנגלית"), or one subject in the table. */
export function sameSubject(a: string, b: string): boolean {
  const left = stripGroup(cleanText(a));
  const right = stripGroup(cleanText(b));
  if (!left || !right) return false;
  if (left === right) return true;
  const subject = subjectFromTitle(left);
  return subject !== '' && !isBlockGroup(subject) && subject === subjectFromTitle(right);
}

/** "87/100", "9.5/10" — a Classroom grade on its own scale; "87" when the assignment has no maximum. */
export function classroomGradeText(grade: number, maxPoints: number | null): string {
  return typeof maxPoints === 'number' && maxPoints > 0 ? `${formatAverage(grade)}/${formatAverage(maxPoints)}` : formatAverage(grade);
}

/** What the grades tab needs of a Classroom assignment (`ClassroomWork`). */
export type ClassroomWorkLike = Pick<ClassroomWork, 'naturalKey' | 'courseName' | 'subject' | 'title' | 'link' | 'grade' | 'maxPoints' | 'updatedAt'>;

/** One Classroom grade in the grades tab: "Classroom", "87/100". */
export interface ClassroomGradeRow {
  naturalKey: string;
  title: string;
  /** The day Classroom last changed it — near enough the day it came back graded. */
  date: DateStr | null;
  /** `classroomGradeText`: "87/100". */
  value: string;
  /** Opens it in Classroom. */
  link: string;
}

/** A subject's grades with Classroom's beside Mashov's. */
export interface SchoolGradeGroup<G extends Grade = Grade> extends GradeGroup<G> {
  /**
   * Classroom grades of the subject, newest first. Never in `average`: Mashov
   * grades out of 100 and an assignment out of its own points are different
   * scales. A subject only Classroom grades has no Mashov `grades` at all.
   */
  classroom: ClassroomGradeRow[];
}

/**
 * Mashov's subjects with Classroom's grades in them (plan §14.5): an
 * assignment with a grade joins the subject its course matched
 * (`ClassroomWork.subject`, by `sameSubject`), or a group of its own — the
 * subject, else the course's name — when no Mashov subject is it. Groups
 * stay newest first, a Classroom grade counting for its subject's date.
 */
export function withClassroomGrades<G extends Grade>(
  groups: readonly GradeGroup<G>[],
  work: readonly ClassroomWorkLike[],
): SchoolGradeGroup<G>[] {
  const out: SchoolGradeGroup<G>[] = groups.map((g) => ({ ...g, classroom: [] }));
  const graded = work
    .filter((w) => typeof w.grade === 'number' && Number.isFinite(w.grade))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  for (const w of graded) {
    const row: ClassroomGradeRow = {
      naturalKey: w.naturalKey,
      title: cleanText(w.title).replace(/\n/g, ' ') || cleanText(w.courseName),
      date: instantDate(w.updatedAt),
      value: classroomGradeText(w.grade as number, w.maxPoints),
      link: w.link,
    };
    const name = w.subject ? stripGroup(cleanText(w.subject)) : cleanText(w.courseName);
    // By Mashov's name: a name the student gave the subject is not Classroom's.
    const into = (w.subject ? out.find((g) => sameSubject(g.originalSubject ?? g.subject, w.subject!)) : undefined)
      ?? out.find((g) => g.grades.length === 0 && g.subject === name);
    if (into) {
      into.classroom.push(row);
      if (row.date && row.date > into.latestDate) into.latestDate = row.date;
    } else {
      out.push({ subject: name || 'Classroom', grades: [], average: null, latestDate: row.date ?? '', classroom: [row] });
    }
  }
  return out.sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.subject.localeCompare(b.subject, 'he'));
}

/** Classroom's study materials of one subject. */
export interface MaterialGroup<M> {
  /** The subject without its group, else the course's name. */
  subject: string;
  /** Newest first. */
  items: M[];
}

/**
 * Classroom's study materials by subject (plan §14.5), for the folded
 * "חומרי לימוד" in the homework tab: the subject the course matched, else
 * the course's name; the subject with the newest material first.
 */
export function materialsBySubject<M extends Pick<ClassroomMaterial, 'subject' | 'courseName' | 'updatedAt'>>(
  materials: readonly M[],
): MaterialGroup<M>[] {
  const at = (m: M): number => Date.parse(m.updatedAt) || 0;
  const groups: MaterialGroup<M>[] = [];
  for (const m of [...materials].sort((a, b) => at(b) - at(a))) {
    const name = (m.subject ? stripGroup(cleanText(m.subject)) : '') || cleanText(m.courseName) || 'Classroom';
    const group = groups.find((g) => g.subject === name || (m.subject !== null && sameSubject(g.subject, name)));
    if (group) group.items.push(m);
    else groups.push({ subject: name, items: [m] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Homework

/** Open, and its due date is before `today`. Done homework is never overdue. */
export function isOverdue(hw: Pick<Homework, 'dueDate'> & { done?: boolean }, today: DateStr): boolean {
  return !hw.done && hw.dueDate !== null && hw.dueDate < today;
}

/** "להגשה עד יום ו׳" and "9.10" — the date goes through `Ltr` on its own. */
export function dueParts(date: DateStr): { prefix: string; date: string } {
  return { prefix: `להגשה עד ${shortWeekday(date)}`, date: formatShortDate(date) };
}

/** Past this many days, unfinished homework moves to "קודמים" rather than shouting "באיחור". */
export const HOMEWORK_RECENT_DAYS = 14;

export interface HomeworkSections<H> {
  /** Open: overdue (recent) first, then by due date, undated last. */
  open: H[];
  /** Ticked off, due date newest first. */
  done: H[];
  /** Due more than `HOMEWORK_RECENT_DAYS` ago and never ticked off — kept, folded away. */
  older: H[];
}

export function homeworkSections<H extends Pick<Homework, 'dueDate'> & { done: boolean }>(
  items: readonly H[],
  today: DateStr,
): HomeworkSections<H> {
  const cutoff = addDays(today, -HOMEWORK_RECENT_DAYS);
  const open: H[] = [];
  const done: H[] = [];
  const older: H[] = [];
  for (const hw of items) {
    if (hw.done) done.push(hw);
    else if (hw.dueDate !== null && hw.dueDate < cutoff) older.push(hw);
    else open.push(hw);
  }
  open.sort((a, b) => {
    if (a.dueDate === b.dueDate) return 0;
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  const newestFirst = (a: H, b: H): number => (b.dueDate ?? '').localeCompare(a.dueDate ?? '');
  done.sort(newestFirst);
  older.sort(newestFirst);
  return { open, done, older };
}

/** Room for a task title on a phone row and in a Google Tasks list. */
export const TASK_TITLE_MAX = 60;

/**
 * "להעתיק ל־Google Tasks" (W6-4): a short title — the subject without its
 * group, and the first line of the assignment, cut at a word — with the full
 * text as notes whenever the title does not already carry all of it.
 */
export function homeworkTaskTitle(hw: Pick<Homework, 'subject' | 'originalSubject' | 'text'>): { title: string; notes: string | null } {
  const subject = shownSubject(hw);
  const text = cleanText(hw.text);
  const firstLine = text.split('\n')[0] ?? '';
  const title = fitTitle(firstLine ? `${subject}: ${firstLine}` : subject, subject.length + 2);
  const complete = !title.endsWith('…') && text === firstLine;
  return { title, notes: complete || !text ? null : text };
}

/**
 * A title cut to `max` (`TASK_TITLE_MAX`) with "…", at a word when there is
 * one past `keep` characters (so "היסטוריה: " is never cut in half).
 */
export function fitTitle(title: string, keep = 0, max = TASK_TITLE_MAX): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > keep ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Room for a message in a task's notes; Google Tasks takes 8192 characters. */
const TASK_NOTES_MAX = 4000;

/**
 * "להוסיף למשימות שלי" on a message (R-21): the message's title as the task,
 * and as notes whatever the title leaves out — the full title when it was
 * cut, the body, and who sent it.
 */
export function messageTaskTitle(msg: { title: string; body: string; from: string | null }): { title: string; notes: string | null } {
  const full = cleanText(msg.title).replace(/\n/g, ' ');
  const body = cleanText(msg.body);
  const title = fitTitle(full || (body.split('\n')[0] ?? '') || 'הודעה מבית הספר');
  const parts: string[] = [];
  if (full && title !== full) parts.push(full);
  if (body && body !== full) parts.push(body);
  const from = senderName(msg.from);
  if (from) parts.push(`מאת ${from}`);
  const notes = parts.join('\n\n');
  if (!notes) return { title, notes: null };
  return { title, notes: notes.length > TASK_NOTES_MAX ? `${notes.slice(0, TASK_NOTES_MAX - 1)}…` : notes };
}

/** A study task is due this many days before its exam (R-20). */
export const STUDY_LEAD_DAYS = 2;

/** Two days before the exam — or today, when that has already passed. */
export function studyTaskDue(examDate: DateStr, today: DateStr): DateStr {
  const due = addDays(examDate, -STUDY_LEAD_DAYS);
  return due < today ? today : due;
}

export interface StudyTask {
  title: string;
  notes: string;
  due: DateStr;
}

type StudyExam = { date: DateStr; subject: string; originalSubject?: string; subjectKey?: string; match?: ExamMatch | null; kind?: 'bagrut' | 'manual' };

/**
 * "להוסיף משימת לימוד" (R-20): "ללמוד למבחן במתמטיקה, 20.10", due two days
 * before. The subject is the server's `subjectKey`, else read from the
 * title. A block exam is the owner's own subject when the server matched it
 * (listed first); otherwise "ללמוד למבחן בגוש ב׳". A bagrut exam is "ללמוד
 * לבגרות באנגלית, 21.1". The notes say which exam and when.
 */
export function studyTask(exam: StudyExam, today: DateStr): StudyTask {
  const due = studyTaskDue(exam.date, today);
  const notes = `${cleanText(exam.subject).replace(/\n/g, ' ')}\n${dayDateLabel(exam.date)}`;
  const lead = exam.kind === 'bagrut' ? 'ללמוד לבגרות' : 'ללמוד למבחן';
  const subject = studySubject(exam);
  const title = subject ? `${lead} ב${subject}` : `${lead}: ${cleanText(exam.originalSubject ?? exam.subject).replace(/\n/g, ' ')}`;
  // The exam's date belongs in the title: two English exams made one plan
  // look like the other's ("כבר במשימות שלך" on 20.10 after planning 1.11,
  // Daniel, run 5), and Google Tasks shows the title alone. After a comma
  // (Wave 9 re-rate: no "·"); `isStudyTaskTitle` still knows the old " · ".
  const when = `, ${formatShortDate(exam.date)}`;
  return { title: `${fitTitle(title, 0, TASK_TITLE_MAX - when.length)}${when}`, notes, due };
}

/**
 * The subject a study task is for, as its title names it: the owner's own
 * subject of a block exam the server matched, else the block ("גוש ב׳");
 * the server's `subjectKey`, else the subject read from the exam's title.
 * `null` when there is none to read.
 */
export function studySubject(exam: StudyExam): string | null {
  const key = exam.subjectKey?.trim() ?? '';
  const block = parseBlockLabel(key);
  if (block) {
    const own = examMine(exam) === true ? block.subjects.split(',')[0]?.trim() : '';
    return own && own !== '…' ? own : block.block;
  }
  // The source's name, so a renamed exam's study tasks keep their title (and `isStudyTaskTitle` finds them).
  return key || subjectFromTitle(exam.originalSubject ?? exam.subject) || null;
}

/** What studying is for, after "ללמוד": "לאנגלית", "לגוש ב׳", "לבגרות באנגלית", or "למבחן" without a subject. */
export function studyWhat(exam: StudyExam): string {
  const subject = studySubject(exam);
  if (exam.kind === 'bagrut') return subject ? `לבגרות ב${subject}` : 'לבגרות';
  return subject ? `ל${subject}` : 'למבחן';
}

/**
 * The exam sheet's study plan in words (the Wave 9 re-rate: one plain
 * sentence built from the plan, not the task's title in quotes). One
 * session is the whole sentence, its day included: "נוסיף משימה ללמוד
 * לאנגלית ביום ראשון 18.10" ("… היום"). Several are "נוסיף 3 משימות ללמוד
 * לאנגלית", their days on the rows under it. `date` goes through `Ltr`.
 */
export function studyPlanLine(exam: StudyExam, count: number, due: DateStr, today: DateStr): { text: string; date: string | null } {
  const what = studyWhat(exam);
  if (count > 1) return { text: `נוסיף ${count} משימות ללמוד ${what}`, date: null };
  if (due === today) return { text: `נוסיף משימה ללמוד ${what} היום`, date: null };
  return { text: `נוסיף משימה ללמוד ${what} ב${weekdayName(due)} `, date: formatShortDate(due) };
}

/** How far back from an exam a study plan reaches: two weeks. */
export const STUDY_WINDOW_DAYS = 14;
/** The most sessions a plan offers (W4-5). */
export const STUDY_SESSIONS_MAX = 4;

/**
 * The days a study plan may use, in order: school days (Sunday–Thursday)
 * from today, or `STUDY_WINDOW_DAYS` before the exam if that is later,
 * through the last session — the single study task's day (two days before),
 * moved back off a weekend. Empty once the exam has passed.
 */
export function studyDays(examDate: DateStr, today: DateStr): DateStr[] {
  if (examDate < today) return [];
  let last = studyTaskDue(examDate, today);
  while (last > today && !isSchoolWeekday(last)) last = addDays(last, -1);
  const windowStart = addDays(examDate, -STUDY_WINDOW_DAYS);
  const first = windowStart > today ? windowStart : today;
  const days: DateStr[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (isSchoolWeekday(d) || d === last) days.push(d);
  }
  return days;
}

/** How many sessions a plan for this exam can have: 1 to `STUDY_SESSIONS_MAX`; 0 once it has passed. */
export function studySessionsMax(examDate: DateStr, today: DateStr): number {
  if (examDate < today) return 0;
  return Math.max(1, Math.min(STUDY_SESSIONS_MAX, studyDays(examDate, today).length));
}

/**
 * "תוכנית לימוד" (W4-5): `sessions` study tasks before an exam, "ללמוד
 * למבחן במתמטיקה (1/3)" … "(3/3)", spread evenly over `studyDays` so the
 * last one falls on the single task's day. One session is exactly the single
 * study task (R-20). Fewer come back when there are fewer school days left.
 */
export function studyPlan(exam: StudyExam, today: DateStr, sessions: number): StudyTask[] {
  if (exam.date < today) return [];
  const single = studyTask(exam, today);
  const days = studyDays(exam.date, today);
  const n = Math.min(Math.floor(sessions), STUDY_SESSIONS_MAX, days.length);
  if (n <= 1) return [single];
  return studyPlanOn(exam, today, Array.from({ length: n }, (_, i) => days[Math.round(((i + 1) * days.length) / n) - 1]!));
}

/**
 * A study plan on days the owner picked (W5-10, Noa: "the first session fell
 * on a day I am out all day"): one session per day, numbered in date order —
 * a session moved past the next one swaps numbers with it. One day is the
 * single study task, moved to that day. Empty once the exam has passed.
 */
export function studyPlanOn(exam: StudyExam, today: DateStr, days: readonly DateStr[]): StudyTask[] {
  if (exam.date < today) return [];
  const single = studyTask(exam, today);
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 0) return [single];
  if (sorted.length === 1) return [{ ...single, due: sorted[0]! }];
  const n = sorted.length;
  return sorted.map((due, i) => {
    const suffix = ` (${i + 1}/${n})`;
    return {
      title: `${fitTitle(single.title, 0, TASK_TITLE_MAX - suffix.length)}${suffix}`,
      notes: `${single.notes}\nמפגש ${i + 1} מתוך ${n}`,
      due,
    };
  });
}

/**
 * The plan's days after moving session `index` to `day`: in date order, and
 * unchanged when `day` is already another session's (the picker offers it
 * disabled) or `index` is out of range.
 */
export function moveStudySession(days: readonly DateStr[], index: number, day: DateStr): DateStr[] {
  if (index < 0 || index >= days.length) return [...days];
  if (days.some((d, i) => i !== index && d === day)) return [...days];
  return days.map((d, i) => (i === index ? day : d)).sort();
}

/**
 * Whether a task is this exam's study task, or one session of its plan ("…
 * (2/3)"). A task made before the Wave 9 re-rate has " · " where the title
 * now has ", " before the date ("ללמוד למבחן באנגלית · 20.10"): it is still
 * the same plan, so the sheet does not offer it a second time.
 */
export function isStudyTaskTitle(title: string, single: string): boolean {
  const given = title.replace(/ · /g, ', ');
  if (given === single) return true;
  const head = /^(.+) \(\d+\/\d+\)$/.exec(given)?.[1];
  if (!head) return false;
  // A long title was cut to leave room for the "(2/3)".
  return head === single || (head.endsWith('…') && single.startsWith(head.slice(0, -1)));
}

/** The Google Tasks list homework goes to: the one called "בית ספר", if there is one. */
export function findSchoolList(lists: readonly TaskListOption[] | undefined): TaskListOption | null {
  const norm = (s: string): string => s.replace(/["״׳'\s\-־]/g, '');
  return (lists ?? []).find((l) => ['ביתספר', 'ביתהספר'].includes(norm(l.title))) ?? null;
}

// ---------------------------------------------------------------------------
// Mashov not connected (F8)

export type MashovLink =
  | { connected: true }
  | { connected: false; reason: 'not_configured' | 'needs_reauth'; lastOkAt: Instant | null };

/**
 * Whether Mashov — the source of grades, homework and half the messages — is
 * connected. Unknown (status still loading, or failed) counts as connected:
 * a list must never flash "not connected" on its way in.
 */
export function mashovLink(sources: readonly SourceStatus[] | undefined): MashovLink {
  const mashov = sources?.find((s) => s.source === 'mashov');
  if (!mashov) return { connected: true };
  if (!mashov.configured) return { connected: false, reason: 'not_configured', lastOkAt: mashov.lastOkAt };
  if (mashov.needsReauth) return { connected: false, reason: 'needs_reauth', lastOkAt: mashov.lastOkAt };
  return { connected: true };
}

/**
 * What a Mashov-fed list shows:
 * - `list` — the items;
 * - `stale` — the items, under a banner saying Mashov is not connected;
 * - `empty` — nothing, and Mashov is fine;
 * - `disconnected` — nothing *because* Mashov is not connected: say so and
 *   offer to connect, never a bare "אין …".
 */
export type FeedState = 'list' | 'stale' | 'empty' | 'disconnected';

export function feedState(count: number, link: MashovLink): FeedState {
  if (count > 0) return link.connected ? 'list' : 'stale';
  return link.connected ? 'empty' : 'disconnected';
}

export type MashovFeed = 'grades' | 'homework' | 'messages' | 'attendance';

const FEED_NOUN: Record<MashovFeed, string> = { grades: 'ציונים', homework: 'שיעורי בית', messages: 'הודעות ממשוב', attendance: 'חיסורים' };

/** "משוב לא מחובר, לכן אין כאן ציונים להצגה". */
export function disconnectedText(feed: MashovFeed, link: MashovLink): string {
  const why = !link.connected && link.reason === 'needs_reauth' ? 'משוב ניתק את החיבור' : 'משוב לא מחובר';
  return `${why}, לכן אין כאן ${FEED_NOUN[feed]} להצגה`;
}

/** The connect action's label. */
export function connectLabel(link: MashovLink): string {
  return !link.connected && link.reason === 'needs_reauth' ? 'להתחבר שוב למשוב' : 'התחברות למשוב';
}

/**
 * The banner over stale data: "המידע מ־" + the date (rendered in `Ltr`) +
 * ", משוב לא מחובר". Messages also come from the school site, which still
 * updates, so theirs says only Mashov's part is stuck.
 */
export function staleBanner(feed: MashovFeed, link: MashovLink): { lead: string; date: string | null; tail: string } {
  const why = !link.connected && link.reason === 'needs_reauth' ? 'משוב ניתק את החיבור' : 'משוב לא מחובר';
  const date = link.connected ? null : instantShortDate(link.lastOkAt);
  if (feed === 'messages') {
    return date
      ? { lead: 'הודעות ממשוב עד ', date, tail: `, ${why}` }
      : { lead: `הודעות ממשוב לא מתעדכנות, ${why}`, date: null, tail: '' };
  }
  return date ? { lead: 'המידע מ־', date, tail: `, ${why}` } : { lead: `המידע לא מתעדכן, ${why}`, date: null, tail: '' };
}

// ---------------------------------------------------------------------------
// My lessons (W5-7)

/** One published line of the class timetable, as `SubjectOption` has it. */
export interface LessonOptionLike {
  /** What `hiddenSubjects` holds to hide this line. */
  key: string;
  name: string;
  teacher: string | null;
  inMashov: boolean;
  count: number;
}

/**
 * One row of "השיעורים שלי": every published line of one subject with one
 * teacher. The site publishes "אזרחות" and "אזרחות (יב2)" for the same
 * lessons of the same teacher (the real grid does); they are one row, and its
 * switch moves every key in it — hiding only one of them hid half the lessons.
 */
export interface LessonGroup<O extends LessonOptionLike = LessonOptionLike> {
  /** `stripGroup(name)` and the teacher: what makes two lines one row. */
  id: string;
  /** The row's title: the site's name, without a class group the lines disagree on. */
  name: string;
  teacher: string | null;
  /** Every line's hide key, each once. */
  keys: string[];
  /** The site's names, each once, in the order given. */
  names: string[];
  /** Lessons across all its lines. */
  count: number;
  /** Mashov lists any of its lines — then the student has this subject with this teacher. */
  inMashov: boolean;
  /** Rows of the same subject under other teachers: parallel groups, one of which is the student's. */
  parallel: number;
  options: O[];
}

/** A name without its bracketed remarks: "אנגלית 5 יח״ל (יב2)" → "אנגלית 5 יח״ל". */
function withoutBrackets(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || name.trim();
}

/**
 * The timetable's lines as rows: lines with the same subject (`stripGroup`)
 * and the same teacher are one row. A row of one line keeps the site's name
 * as it is; a merged row is called by what its names share — "אזרחות" for
 * "אזרחות" and "אזרחות (יב2)", "פיזיקה מורחב" for the class and its lab —
 * or by the bare subject when even that differs. Rows of one subject sit
 * together, by teacher.
 */
export function groupLessonOptions<O extends LessonOptionLike>(options: readonly O[]): LessonGroup<O>[] {
  const byId = new Map<string, O[]>();
  for (const option of options) {
    const id = `${stripGroup(option.name)} | ${option.teacher?.trim() ?? ''}`;
    const list = byId.get(id);
    if (list) list.push(option);
    else byId.set(id, [option]);
  }
  const groups = [...byId.entries()].map(([id, list]): LessonGroup<O> => {
    const names = [...new Set(list.map((o) => o.name))];
    const bare = [...new Set(names.map(withoutBrackets))];
    const name = names.length === 1 ? names[0]! : bare.length === 1 ? bare[0]! : stripGroup(names[0]!);
    return {
      id,
      name,
      teacher: list[0]!.teacher,
      keys: [...new Set(list.map((o) => o.key))],
      names,
      count: list.reduce((sum, o) => sum + o.count, 0),
      inMashov: list.some((o) => o.inMashov),
      parallel: 0,
      options: list,
    };
  });
  const perSubject = new Map<string, number>();
  for (const g of groups) {
    const subject = stripGroup(g.name);
    perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
  }
  for (const g of groups) g.parallel = (perSubject.get(stripGroup(g.name)) ?? 1) - 1;
  return groups.sort((a, b) =>
    stripGroup(a.name).localeCompare(stripGroup(b.name), 'he')
    || a.name.localeCompare(b.name, 'he')
    || (a.teacher ?? '').localeCompare(b.teacher ?? '', 'he'));
}

/** A row's switch: on when all its lines are shown, off when none is, and `'mixed'` in between. */
export function lessonGroupState(group: Pick<LessonGroup, 'keys'>, hidden: ReadonlySet<string>): boolean | 'mixed' {
  const off = group.keys.filter((k) => hidden.has(k)).length;
  if (off === 0) return true;
  if (off === group.keys.length) return false;
  return 'mixed';
}

/**
 * "להשאיר רק מה שבמשוב": the hide-list that shows every row Mashov lists and
 * hides every row it does not — whole rows, so none is left half on.
 */
export function mashovOnlyHidden(groups: readonly Pick<LessonGroup, 'keys' | 'inMashov'>[]): string[] {
  return groups.filter((g) => !g.inMashov).flatMap((g) => g.keys);
}

/** The hide-list already is exactly what "להשאיר רק מה שבמשוב" would make it (rows Mashov does not list off, the rest on). */
export function isMashovOnly(groups: readonly Pick<LessonGroup, 'keys' | 'inMashov'>[], hidden: ReadonlySet<string>): boolean {
  return groups.every((g) => lessonGroupState(g, hidden) === g.inMashov);
}

/**
 * The lessons from Mashov, which lists only the student's own timetable (on a
 * parent's phone, docs/parents-plan.md, the child's, from the parent's Mashov).
 * What "להשאיר רק מה שבמשוב" would make the hide-list, while nothing is hidden
 * yet; `null` while there is nothing to go on, or the list was changed. Nobody
 * pressed anything, so it holds back when fewer than half of the class's rows
 * are in Mashov: that reads as names that did not match, not as the student's
 * lessons. `[]`: every row is the student's, and nothing needs hiding.
 *
 * Once (`LessonsBridge`), which remembers it did: for each child on a
 * parent's phone, and only when the child's invite link did not fill the
 * list first.
 */
export function lessonsFromMashov(input: {
  mashovKnown: boolean;
  subjects: readonly LessonOptionLike[];
  hidden: readonly string[];
}): string[] | null {
  if (!input.mashovKnown || input.hidden.length > 0) return null;
  const groups = groupLessonOptions(input.subjects);
  if (groups.length === 0) return null;
  if (groups.filter((g) => g.inMashov).length * 2 < groups.length) return null;
  return mashovOnlyHidden(groups);
}

/**
 * The words of "השיעורים שלי" and of "זה לא השיעור שלי": a student's own, and
 * on a parent's phone the lessons shown, which are the child's.
 */
export const LESSONS_COPY = {
  student: {
    title: 'השיעורים שלי',
    notMine: 'זה לא השיעור שלי',
    mashovKnown: 'במשוב מופיעים רק השיעורים שלך.',
    mashovUnknown: 'אחרי שמתחברים למשוב אפשר לבחור לפיו בלחיצה אחת. במשוב מופיעים רק השיעורים שלך.',
    parallel: (n: number) => `יש ${n} קבוצות במקצוע הזה. להשאיר את זו של המורה שלך`,
    /** Once Mashov filled the list (`lessonsFromMashov`). */
    fromMashov: 'מעכשיו מוצגים רק השיעורים שבמשוב שלך',
  },
  parent: {
    title: 'השיעורים שמוצגים',
    notMine: 'זה לא השיעור של הילד או הילדה',
    mashovKnown: 'במשוב של ההורה מופיעים רק השיעורים של הילד או הילדה.',
    mashovUnknown: 'אחרי שמתחברים למשוב כהורה אפשר לבחור לפיו בלחיצה אחת. במשוב מופיעים רק השיעורים של הילד או הילדה.',
    parallel: (n: number) => `יש ${n} קבוצות במקצוע הזה. להשאיר את זו של הילד או הילדה`,
    /** Once the parent's Mashov filled the list (`lessonsFromMashov`). */
    fromMashov: 'מעכשיו מוצגים רק השיעורים שבמשוב של הילד או הילדה',
    /** Once the child's invite link filled it (`lib/invite.ts`). */
    fromLink: 'מעכשיו מוצגים רק השיעורים של הילד או הילדה, כמו באפליקציה שלהם',
  },
} as const;

// ---------------------------------------------------------------------------
// Sub-tabs (W5-8)

/**
 * Where to scroll a horizontal row of tabs so the selected one sits in the
 * middle — or as near as the row's ends allow — and is never cut off at a
 * large text size (Daniel saw "הוד" of "הודעות"). `tab` is its `onLayout`
 * box in the row's content (physical pixels from the left, as both Android
 * and the web report it); `viewport` and `content` are the row's widths.
 *
 * Android takes the offset from the left edge whatever the direction. A
 * browser in right-to-left counts from the right edge, 0 down to negative
 * (`negativeRtl`).
 */
export function tabScrollOffset(
  tab: { x: number; width: number },
  viewport: number,
  content: number,
  negativeRtl = false,
): number {
  const max = Math.max(0, content - viewport);
  const left = Math.min(max, Math.max(0, tab.x + tab.width / 2 - viewport / 2));
  return negativeRtl ? left - max : left;
}

/**
 * Whether a right-to-left tab row is scrolled to its end — its left edge,
 * where the last tab sits — given the offset its `onScroll` reported, in
 * `tabScrollOffset`'s terms: Android counts from the left edge (the end is
 * 0, the start `max`, where an RTL row opens), a browser from the right (the
 * start is 0, the end `-max`). A row that fits is always at its end.
 */
export function tabRowAtEnd(x: number, viewport: number, content: number, negativeRtl = false): boolean {
  const max = content - viewport;
  if (max <= 1) return true;
  return Math.abs(x - (negativeRtl ? -max : 0)) < 2;
}

/**
 * The School screen's tab row (`UnderlineTabs` in components/notebook, plan
 * §16.1), measured the way the Tasks chip row was (W6-9): five tabs, each
 * its label at `type.label` (15) in `bodySemi` with `chipPadding` on each
 * side and no outline (`border` 0: the chosen tab is underlined, not boxed),
 * `gap` between them, the row's padding at both ends. At the usual text size
 * that is about 340 points, so all five fit a 360-point phone and "הודעות"
 * is never cut at the edge (run 7: Itai, Daniel). `paddingStart` plus
 * `chipPadding` lines the first label up with the page under the row. At a
 * larger size the row overflows; then its end fades, `fade` wide, with a
 * chevron on it, and `paddingEnd` grows to `fade` so the last tab ends clear
 * of it. Each tab stays wider than `MIN_TOUCH`. The key names are the pill
 * row's, kept so the screen that still draws pills compiles.
 */
export const SCHOOL_TAB_ROW = { paddingStart: 9, paddingEnd: 8, gap: 0, chipPadding: 11, border: 0, fade: 44 } as const;

/** The School screen's sub-tabs, in the row's order: what `SCHOOL_TAB_ROW` is measured with. */
export const SCHOOL_TABS: readonly { key: SchoolTab; label: string }[] = [
  { key: 'exams', label: 'מבחנים' },
  { key: 'homework', label: 'שיעורי בית' },
  { key: 'grades', label: 'ציונים' },
  { key: 'bagrut', label: 'בגרות' },
  { key: 'messages', label: 'הודעות' },
  { key: 'attendance', label: 'חיסורים' },
];

/**
 * The sub-tabs on this phone: no bagrut tab for a grade that sits none, and
 * for a parent only what the class's site publishes, exams and messages
 * (docs/parents-plan.md): grades, homework, bagrut and absences are Mashov's.
 * A parent whose Mashov was read (`mashov`, stage 3) has them all, as a
 * student does.
 */
export function schoolTabsFor(opts: { bagrut: boolean; audience?: Audience; mashov?: boolean }): readonly { key: SchoolTab; label: string }[] {
  if (opts.audience === 'parent' && !opts.mashov) return SCHOOL_TABS.filter((t) => t.key === 'exams' || t.key === 'messages');
  return SCHOOL_TABS.filter((t) => opts.bagrut || t.key !== 'bagrut');
}

// ---------------------------------------------------------------------------
// Counts

/**
 * "10 מקצועות שלך מוצגים" — lead with what is there, not with what is
 * hidden; and a line of the timetable is a subject, not one lesson (R-25).
 */
export function lessonsShownLabel(shown: number): string {
  return plural(shown, 'מקצוע אחד שלך מוצג', 'מקצועות שלך מוצגים');
}

/** "12 מבחנים מסומנים כשלך" — the one exam count, wherever it is shown (`examCounts().chosen`). */
export function examsChosenLabel(chosen: number): string {
  return plural(chosen, 'מבחן אחד מסומן כשלך', 'מבחנים מסומנים כשלך');
}

/**
 * The one exam count, with the guesswork inside it (W4-4): "15 מבחנים
 * מסומנים כשלך (מתוכם 4 לבדוק)" — `examCounts().chosen` and `.unsure`.
 * Onboarding's line counts the same "?" exams in the same word, "15 מבחנים ·
 * 4 לבדוק" (run 7: Maya read "לא בטוחים" as something wrong with the exam).
 */
export function examsCountLabel(chosen: number, unsure: number): string {
  const head = examsChosenLabel(chosen);
  if (unsure <= 0 || chosen <= 0) return head;
  if (chosen === 1) return `${head} (לבדוק)`;
  if (unsure >= chosen) return `${head} (כולם לבדוק)`;
  return `${head} (מתוכם ${unsure === 1 ? 'אחד' : unsure} לבדוק)`;
}

/**
 * The same count, short, on School's "המבחנים שלי" row (plan §16): "19
 * מבחנים שלך, 4 לבדוק". The row's title already says what the list is, so
 * the line under it is only the numbers.
 */
export function examsMineLabel(chosen: number, unsure: number): string {
  const head = plural(chosen, 'מבחן אחד שלך', 'מבחנים שלך');
  if (unsure <= 0 || chosen <= 0) return head;
  if (chosen === 1) return `${head}, לבדוק`;
  if (unsure >= chosen) return `${head}, כולם לבדוק`;
  return `${head}, ${unsure === 1 ? 'אחד' : unsure} לבדוק`;
}

/**
 * How far an exam is, for the School list's end and the next exam's hero
 * number (plan §16.1): `value` in the display face, `unit` small beside it.
 * "היום", "מחר", "יומיים", then "24" + "ימים"; a past day as `countdownLabel`
 * says it.
 */
export function daysLeft(days: number): { value: string; unit: string | null } {
  if (days === 0) return { value: 'היום', unit: null };
  if (days === 1) return { value: 'מחר', unit: null };
  if (days === 2) return { value: 'יומיים', unit: null };
  if (days > 2) return { value: String(days), unit: 'ימים' };
  return { value: countdownLabel(days), unit: null };
}

/** `daysLeft` on one line: "24 ימים", "מחר". */
export function daysLeftLabel(days: number): string {
  const { value, unit } = daysLeft(days);
  return unit ? `${value} ${unit}` : value;
}
