/**
 * The day card's markup (chat connection spec 2.3, direction א of the sketch): one school day as
 * HTML, drawn inside the chat's frame from the result of `get_day`.
 *
 * This file is bundled into the card's page and runs in a browser frame, so it imports no Node,
 * Fastify or Luxon, and nothing from `@sederyom/shared` that is not a type, apart from
 * `subjectsMatch` (`logic/subjects.ts`, which imports nothing) and `parseExamTitle`
 * (`logic/exam-match.ts`, whose only runtime import is `./subjects`). The zone comes from `Intl`.
 *
 * An exam's `subject` is the school's own title ("מבחן באנגלית", "שכבתי במתמטיקה", "בגרות במתמטיקה - רק
 * למשפרים", "מעבדה"), or a bare subject ("מתמטיקה"). The banner follows the phone (`examDisplayTitle`
 * and `examSlot` in `app/src/lib/school.ts`): a title stands as written, and the card adds a word only
 * to a bare subject we recognise, "מבחן ב" before it ("בגרות ב" for a bagrut exam). The hour is the exam's own start
 * time, else the lessons the school marked as an exam (`status: 'exam'`) whose name, the change text
 * ("מבחן בהיסטוריה שיכבה יא"), is the exam's subject, on a day that is not projected, else none. A regular
 * lesson is never taken for the exam.
 *
 * "Tomorrow" and "updated today" are worked out from `now` when the card is drawn, never when the
 * tool ran: a chat redraws an old card from its stored result, and yesterday's "tomorrow" would be
 * wrong. The result carries dates only.
 *
 * Everything that comes from outside (subject, teacher, room, note, holiday, exam, event, the
 * weekday name) goes through `escapeHtml`. The copy rules hold here too: no middle dot (parts sit
 * in their own elements, or take a comma or a colon), no long dash, no emoji, no check mark.
 *
 * Class names are the sketch's: `hd` (the header), `banner` (an exam), `row` with `n` (the hour),
 * `s` (the subject and its tags) and `m` (teacher and room), `tag` with `t-ex`, `t-cx` and `t-ch`,
 * `cx`, `ex` and `ch` on a row that is cancelled, has an exam, or changed, `foot`; plus `line` (a
 * sentence under the lessons), `note` (a lesson's note, inside its row) and `plain` (a text answer).
 *
 * Pure: no clock but `now`, no I/O.
 */
import type { DateStr, Exam, Lesson, SchoolEvent } from '@sederyom/shared';
import { parseExamTitle } from '@sederyom/shared/logic/exam-match';
import { subjectKey, subjectsMatch } from '@sederyom/shared/logic/subjects';

/** `get_day`'s `structuredContent` for a day the copy has (`dayData` in `answers.ts`, with `finish`'s two fields). */
export interface DayCardData {
  date: DateStr;
  found: true;
  weekdayName: string;
  isSchoolDay: boolean;
  holidayName: string | null;
  projected: boolean;
  exams: Exam[];
  lessons: Lesson[];
  events: SchoolEvent[];
  updatedAt: string;
  old: boolean;
}

const ZONE = 'Asia/Jerusalem';
const DAY_MS = 86_400_000;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// ---- Escaping and checking ----------------------------------------------------------------------------------

/** Text as text: the five characters that can open a tag or close an attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `escapeHtml` for anything a result may hold: what is not text shows as nothing. */
const esc = (text: unknown): string => (typeof text === 'string' ? escapeHtml(text) : '');

/** A text answer, for a result with no day in it: escaped, and its line breaks kept. */
export function plainCardMarkup(text: string): string {
  return `<div class="plain">${escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>')}</div>`;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isList = (value: unknown, item: (entry: unknown) => boolean): boolean => Array.isArray(value) && value.every(item);
const isLessonLike = (e: unknown): boolean => isObject(e) && Number.isFinite(e.hourIndex) && typeof e.subject === 'string' && typeof e.status === 'string';
const isExamLike = (e: unknown): boolean => isObject(e) && typeof e.subject === 'string';
const isEventLike = (e: unknown): boolean => isObject(e) && typeof e.title === 'string';

/** Whether a tool result is a day the card can draw: what `get_day` returns for a day in the copy. */
export function isDayCardData(value: unknown): value is DayCardData {
  if (!isObject(value) || value.found !== true) return false;
  return (
    typeof value.date === 'string' && DATE_FORMAT.test(value.date) &&
    typeof value.weekdayName === 'string' &&
    typeof value.isSchoolDay === 'boolean' &&
    (value.holidayName === null || typeof value.holidayName === 'string') &&
    typeof value.projected === 'boolean' &&
    typeof value.updatedAt === 'string' &&
    typeof value.old === 'boolean' &&
    isList(value.lessons, isLessonLike) &&
    isList(value.exams, isExamLike) &&
    isList(value.events, isEventLike)
  );
}

// ---- Dates and times ----------------------------------------------------------------------------------------

/** An instant's date and time of day in Israel. Hours are 00 to 23, never 24. */
const IN_ZONE = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function inZone(at: Date): { date: DateStr; time: string } | null {
  if (Number.isNaN(at.getTime())) return null;
  const part: Record<string, string> = {};
  for (const p of IN_ZONE.formatToParts(at)) part[p.type] = p.value;
  return { date: `${part.year}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}` };
}

/** Whole days since the epoch of a `YYYY-MM-DD`, so two dates subtract to a distance in days. */
const dayNumber = (date: DateStr): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
/** How many days `date` is after `from`. */
const daysAfter = (date: DateStr, from: DateStr): number => Math.round(dayNumber(date) - dayNumber(from));

/** `10.11` for `2026-11-10`: day and month, no zeros. */
const dm = (date: DateStr): string => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
/** `8:00` for `08:00`: the hour without its zero. */
const hm = (time: string): string => time.replace(/^0(\d:)/, '$1');

const RELATIVE = new Map<number, string>([[0, 'היום'], [1, 'מחר'], [-1, 'אתמול']]);

const nonEmpty = (text: unknown): text is string => typeof text === 'string' && text.trim() !== '';

// ---- The parts ----------------------------------------------------------------------------------------------

/** `מחר, יום שלישי 10.11`; from the third day away just `יום שלישי 10.11`. */
function titleOf(data: DayCardData, relative: string | undefined): string {
  const day = `${data.weekdayName} ${dm(data.date)}`;
  return relative ? `${relative}, ${day}` : day;
}

/** `מחר אין לימודים: חנוכה`, or `אין לימודים ביום שלישי 10.11` when the day is not near. */
function noSchoolOf(data: DayCardData, relative: string | undefined): string {
  const said = relative ? `${relative} אין לימודים` : `אין לימודים ב${data.weekdayName} ${dm(data.date)}`;
  return nonEmpty(data.holidayName) ? `${said}: ${data.holidayName}` : said;
}

/** The header's small print: how many lessons stand, and the hours they span (a cancelled lesson moves neither). */
function summaryOf(standing: Lesson[]): string {
  const parts: string[] = [];
  if (standing.length === 1) parts.push('<span>שיעור אחד</span>');
  else if (standing.length > 1) parts.push(`<span>${standing.length} שיעורים</span>`);
  const starts = standing.map((l) => l.startTime).filter(nonEmpty).sort();
  const ends = standing.map((l) => l.endTime).filter(nonEmpty).sort();
  const first = starts[0];
  const last = ends[ends.length - 1];
  if (first && last) parts.push(`<span><bdi>${esc(hm(first))}–${esc(hm(last))}</bdi></span>`);
  return parts.length ? `<small>${parts.join('')}</small>` : '';
}

/** A block exam under one name however the school wrote it (`BLOCK_ONLY_TITLE` in the phone's `lib/school.ts`). */
const BLOCK_ONLY_TITLE = /^(?:מבחן\s+)?ב?גוש\s*([אב])(?:['׳])?$/;

/**
 * An exam's title as the phone shows it (`examDisplayTitle`): on one line, with single spaces, and a block
 * exam as "מבחן גוש ב׳". Empty when the school gave none.
 */
function examTitleOf(subject: unknown): string {
  const clean = typeof subject === 'string' ? subject.replace(/\s+/g, ' ').trim() : '';
  const block = BLOCK_ONLY_TITLE.exec(clean);
  return block ? `מבחן גוש ${block[1]}׳` : clean;
}

/** The name a lesson goes by at the school (not the student's own): for a marked lesson, the change text itself. */
const schoolNameOf = (lesson: Lesson): string => examTitleOf(nonEmpty(lesson.originalSubject) ? lesson.originalSubject : lesson.subject);

/** Whether a lesson's name is `subject`'s: the name as it stands, or the subject the reader finds in it ("מבחן בספרות"). */
function lessonNamed(lesson: Lesson, subject: string): boolean {
  const name = schoolNameOf(lesson);
  return name !== '' && subject !== '' && (subjectsMatch(subject, name) || subjectsMatch(subject, parseExamTitle(name).subject));
}

/**
 * Whether a title is a bare subject ("מתמטיקה", "תנ״ך", "מוסיקה"): the reader finds exactly the title as its
 * subject, and it is a subject we recognise: one the reader knows, one a lesson of the day has, or one that
 * comes from Mashov or is a bagrut exam, whose sources give only subjects. Only then does the card add a word
 * before it. Any other title stands as written: "שכבתי במתמטיקה", "הדמיה ממוחשבת בביולוגיה", "בע"פ ערבית",
 * "3 אקדמיזציה", "מעבדה", "פירוק תערוכה", a block exam.
 */
function isBareSubject(exam: Exam, title: string, lessons: Lesson[]): boolean {
  if (title === '') return false;
  const read = parseExamTitle(title);
  if (subjectKey(read.subject) !== subjectKey(title)) return false;
  return read.known || exam.kind === 'bagrut' || exam.source === 'mashov' || lessons.some((l) => lessonNamed(l, read.subject));
}

/**
 * `שעה 5`; `שעות 5–6` for lessons in a row, the range in a `<bdi>` so it reads left to right as the header's does (it would
 * show as 6–5); `שעות 1 ו־4` and `שעות 1, 4 ו־6` when they are apart. `hours` is sorted and not empty. Markup, with numbers only.
 */
function hoursText(hours: number[]): string {
  if (hours.length === 1) return `שעה ${hours[0]}`;
  const last = hours[hours.length - 1];
  if (hours.every((h, i) => i === 0 || h === hours[i - 1]! + 1)) return `שעות <bdi>${hours[0]}–${last}</bdi>`;
  return `שעות ${hours.slice(0, -1).join(', ')} ו־${last}`;
}

/** "9:00", "09:00:00" → "9:00"; what is not a clock time → `null` (`clockTime` in the phone's `lib/school.ts`). */
function clockTime(text: unknown): string | null {
  const m = typeof text === 'string' ? /^\s*([01]?\d|2[0-3]):([0-5]\d)(?::\d\d)?\s*$/.exec(text) : null;
  return m ? `${Number(m[1])}:${m[2]}` : null;
}

/**
 * Whether a lesson the school marked as an exam is this exam's. Its name is the change text itself
 * ("מבחן בהיסטוריה שיכבה יא", "מבחן עברית ט שכבתי", "בוחן באנגלית"), so it matches when the exam's subject is
 * the name's, or the subject the reader finds in the name; or when the two titles are the same, though they
 * name no subject (a block).
 */
function isTheExam(lesson: Lesson, title: string, subject: string): boolean {
  const name = schoolNameOf(lesson);
  return name !== '' && ((title !== '' && subjectKey(name) === subjectKey(title)) || lessonNamed(lesson, subject));
}

/**
 * When an exam sits, as the phone says it (`examSlot`), as markup: its own start time; else the lessons the
 * school marked as an exam (`status: 'exam'`) that are this exam's, on a day that is not projected from the
 * fixed timetable; else nothing. The title is the school's own (`originalSubject`), not the student's name
 * for it.
 */
function whenOf(exam: Exam, lessons: Lesson[], projected: boolean): string {
  const time = clockTime(exam.startTime);
  if (time) return `ב־${time}`;
  if (projected) return '';
  const title = examTitleOf(nonEmpty(exam.originalSubject) ? exam.originalSubject : exam.subject);
  const subject = parseExamTitle(title).subject;
  const hours = lessons.filter((l) => l.status === 'exam' && isTheExam(l, title, subject)).map((l) => l.hourIndex);
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  return sorted.length > 0 ? hoursText(sorted) : '';
}

/** `מבחן באנגלית, שעה 5`: the title (a bare subject gets "מבחן ב", a bagrut exam's "בגרות ב"), when, and the details after commas. */
function bannerOf(exam: Exam, lessons: Lesson[], projected: boolean): string {
  const shown = examTitleOf(exam.subject);
  // The words of the school's title decide whether it is bare, not a student's own name for it.
  const school = nonEmpty(exam.originalSubject) ? examTitleOf(exam.originalSubject) : shown;
  const kind = exam.kind === 'bagrut' ? 'בגרות' : 'מבחן';
  const title = !shown ? kind : isBareSubject(exam, school, lessons) ? `${kind} ${/^[א-ת]/.test(shown) ? 'ב' : 'ב־'}${shown}` : shown;
  const when = whenOf(exam, lessons, projected);
  const details = typeof exam.details === 'string' ? exam.details.trim() : '';
  const more = details && details !== shown && details !== exam.subject ? details : '';
  return `<div class="banner">${esc(title)}${when ? `, ${when}` : ''}${more ? `, ${esc(more)}` : ''}</div>`;
}

const tag = (kind: 't-ex' | 't-cx' | 't-ch', text: string): string => `<span class="tag ${kind}">${esc(text)}</span>`;

/**
 * The tag a changed status gets, inside the subject. `exam` (its own tag, `rowOf`) and `event` are regular
 * lessons here, and a cancelled lesson's tag stands beside the subject instead (`rowOf`), outside its strike-through.
 */
function statusTag(l: Lesson): string {
  switch (l.status) {
    case 'substitution': return tag('t-ch', nonEmpty(l.substitute) ? `מחליף/ה: ${l.substitute}` : 'מחליף/ה');
    case 'moved': return tag('t-ch', 'הועבר');
    case 'remote': return tag('t-ch', 'מרחוק');
    default: return '';
  }
}

const CHANGED = new Set<Lesson['status']>(['substitution', 'moved', 'remote']);

/**
 * A lesson the school marked as an exam is yellow and tagged, with or without an exam entry for it; no
 * other lesson is, whatever an entry says. A lesson has one status, so a row is never both exam and
 * changed; the styles still put `.row.ex` after `.row.ch`, so it would stay yellow (spec 2.3).
 */
function rowOf(l: Lesson): string {
  const isExam = l.status === 'exam';
  const classes = ['row'];
  if (l.status === 'cancelled') classes.push('cx');
  if (isExam) classes.push('ex');
  if (CHANGED.has(l.status)) classes.push('ch');
  const who = [l.teacher, l.room].filter(nonEmpty).map((x) => `<span>${esc(x)}</span>`).join('');
  const note = nonEmpty(l.note) ? `<div class="note">${esc(l.note.trim())}</div>` : '';
  return (
    `<div class="${classes.join(' ')}"><span class="n">${l.hourIndex}</span>` +
    `<span class="s">${esc(l.subject)}${isExam ? tag('t-ex', 'מבחן') : ''}${statusTag(l)}</span>` +
    `${l.status === 'cancelled' ? tag('t-cx', 'בוטל') : ''}` +
    `${who ? `<span class="m">${who}</span>` : ''}${note}</div>`
  );
}

/** A school event, in the hour column's place: `אירוע: טיול`, and its details after a comma (never a second colon). */
function eventRowOf(e: SchoolEvent): string {
  const details = nonEmpty(e.details) ? `, ${e.details.trim()}` : '';
  return `<div class="row"><span class="n"></span><span class="s">${esc(`אירוע: ${e.title}${details}`)}</span></div>`;
}

const line = (text: string): string => `<div class="line">${esc(text)}</div>`;

/** `סדר יום`, and when the copy was made: today, yesterday or the date, with the time in Israel. */
function footerOf(updatedAt: string, today: DateStr | null): string {
  const made = inZone(new Date(updatedAt));
  let when = '';
  if (made && today) {
    const ago = daysAfter(today, made.date);
    const time = hm(made.time);
    when = ago === 0 ? `עודכן היום ב־${time}` : ago === 1 ? `עודכן אתמול ב־${time}` : `עודכן ב־${dm(made.date)} ב־${time}`;
  }
  return `<div class="foot"><span>סדר יום</span>${when ? `<span>${esc(when)}</span>` : ''}</div>`;
}

// ---- The card -----------------------------------------------------------------------------------------------

/**
 * One day as the card draws it: the header, a banner for each exam, a row for each lesson (by hour),
 * a row for each school event, the lines that qualify the lessons, and the footer. A day with no
 * school says so in the header and has no lessons.
 */
export function dayCardMarkup(data: DayCardData, now: Date): string {
  const today = inZone(now)?.date ?? null;
  const relative = today ? RELATIVE.get(daysAfter(data.date, today)) : undefined;

  const lessons = [...data.lessons].sort((a, b) => a.hourIndex - b.hourIndex);
  const standing = lessons.filter((l) => l.status !== 'cancelled');

  const head = `<div class="hd"><b>${esc(data.isSchoolDay ? titleOf(data, relative) : noSchoolOf(data, relative))}</b>${summaryOf(standing)}</div>`;
  const out = [head, ...data.exams.map((exam) => bannerOf(exam, lessons, data.projected)), ...lessons.map(rowOf), ...data.events.map(eventRowOf)];
  if (data.isSchoolDay && lessons.length === 0 && data.exams.length === 0 && data.events.length === 0) out.push(line('אין שיעורים ביום הזה.'));
  if (data.projected && lessons.length > 0) out.push(line('השיעורים לפי המערכת הקבועה: בית הספר עוד לא פרסם את השבוע.'));
  if (data.old) out.push(line('המידע לא עדכני. כדאי לפתוח את סדר יום כדי לעדכן.'));
  out.push(footerOf(data.updatedAt, today));
  return out.join('');
}
