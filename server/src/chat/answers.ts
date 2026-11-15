/**
 * What a chat reads (chat connection spec 4.3): the student's snapshot, told in
 * Hebrew, one answer per read tool of `/mcp` (`routes/mcp.ts`). Each answer is
 * the text the chat reads and the same facts as data (`structured`, MCP's
 * `structuredContent`).
 *
 * The snapshot is whatever the phone wrote, read by `readChatSnapshot`, which
 * keeps a part whatever `shares` says. So every optional part is gated here: a
 * part is told only when its switch is on AND it is there; otherwise the chat is
 * told that the student did not share it (`NOT_SHARED`).
 *
 * Nothing from Google is told: the copy has none (Google's data stays on the phone),
 * and `readChatSnapshot` drops it from a copy of a development build that had some.
 *
 * Every text but the fixed lines ends with when the copy was made ("עודכן …"),
 * and a copy older than `CHAT_OLD_AFTER_MS` says so before it, so the chat can
 * tell the student. "Today" is `now`'s date in the student's zone, never the
 * server's clock or UTC's.
 *
 * Pure: no clock, no I/O, nothing logged.
 */
import { DateTime } from 'luxon';
import {
  CHAT_OLD_AFTER_MS, type ChatAbsence, type ChatAverage, type ChatDay, type ChatMessage, type ChatShares, type ChatSnapshot, type DateStr, type Exam, type Lesson,
} from '@sederyom/shared';
import { TZ, addDays, sundayIndex, weekStart, weekdayNameHe } from '../lib/time.js';

export interface Answer {
  text: string;
  structured: Record<string, unknown>;
}

const SETTINGS_PATH = "סדר יום ← הגדרות ← חיבור לצ'אט";
const notShared = (what: string) => `התלמיד לא שיתף ${what}. אפשר להפעיל את זה ב${SETTINGS_PATH}.`;

/** What a chat is told when it asks for a part the student did not share. */
export const NOT_SHARED: Record<keyof ChatShares, string> = {
  homework: notShared('שיעורי בית'),
  grades: notShared('ציונים'),
  bagrut: notShared('ציוני בגרות'),
  absences: notShared('חיסורים'),
  messages: notShared('הודעות'),
};
export const NO_COPY = 'אין עדיין מידע מהטלפון. כדאי לפתוח את סדר יום.';
export const NOT_APPROVED = `צריך לאשר את החיבור ב${SETTINGS_PATH}.`;
export const CANNOT_OPEN = "המידע מהטלפון לא נפתח. כדאי לנתק את הצ'אט באפליקציה ולחבר אותו שוב.";

/** The names of the parts, as `get_status` lists what is shared. */
const PART_NAMES: Record<keyof ChatShares, string> = {
  homework: 'שיעורי בית',
  grades: 'ציונים',
  bagrut: 'ציוני בגרות',
  absences: 'חיסורים',
  messages: 'הודעות',
};
const PARTS = Object.keys(PART_NAMES) as (keyof ChatShares)[];

/** A fixed line as an answer. */
const fixed = (text: string, structured: Record<string, unknown>): Answer => ({ text, structured });

// ---- Dates ---------------------------------------------------------------------------------------------------

/** `5.11` for `2026-11-05`: day and month, no zeros. */
const dm = (date: DateStr): string => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
/** `now`'s date in `zone`. */
const todayIn = (now: Date, zone: string): DateStr => DateTime.fromJSDate(now).setZone(zone).toISODate()!;
/** An instant in `zone`. */
const inZone = (instant: string, zone: string): DateTime => DateTime.fromJSDate(new Date(instant)).setZone(zone);
/** `יום חמישי 5.11`. */
const dayTitle = (date: DateStr, zone: string): string => `${weekdayNameHe(date, zone)} ${dm(date)}`;

const HOUR_MS = 3_600_000;

/** The copy's age, said, when it is past `CHAT_OLD_AFTER_MS`: hours below two days, days from two. */
function staleLine(at: string, now: Date): string | null {
  const age = now.getTime() - new Date(at).getTime();
  if (!(age > CHAT_OLD_AFTER_MS)) return null;
  const hours = Math.floor(age / HOUR_MS);
  const ago = hours >= 48 ? `${Math.floor(hours / 24)} ימים` : `${hours} שעות`;
  return `המידע עודכן לאחרונה לפני ${ago}. כדאי לפתוח את סדר יום כדי לעדכן.`;
}

/** The last line of every answer: when the copy was made, in the student's zone. */
function updatedLine(at: string, zone: string): string {
  const when = inZone(at, zone);
  const date = when.toISODate();
  if (!date) return 'עודכן';
  return `עודכן ${dayTitle(date, zone)} בשעה ${when.toFormat('HH:mm')}`;
}

/** The app's own bookkeeping on the copy's items: of no use to a chat, so it never reaches one. */
const INTERNAL_FIELDS = new Set(['naturalKey', 'changeSeenAt', 'firstSeen']);

/** `value` with the bookkeeping taken out, however deep it sits. */
function withoutInternals<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutInternals) as T;
  if (typeof value !== 'object' || value === null || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !INTERNAL_FIELDS.has(key)).map(([key, inner]) => [key, withoutInternals(inner)]),
  ) as T;
}

/** `body`, then the staleness line when the copy is old, then when it was made. */
function finish(s: ChatSnapshot, body: string[], structured: Record<string, unknown>, now: Date, zone: string): Answer {
  const stale = staleLine(s.at, now);
  return {
    text: [...body, ...(stale ? [stale] : []), updatedLine(s.at, zone)].join('\n'),
    structured: { ...withoutInternals(structured), updatedAt: s.at, old: stale !== null },
  };
}

/** Whether any of `texts` has `query` in it, ignoring case and the spaces around it; no query matches all. */
function matches(query: string | undefined, ...texts: (string | null | undefined)[]): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return texts.some((text) => (text ?? '').toLowerCase().includes(q));
}

/** A part the student shares, and that the copy has; `null` otherwise. */
function part<K extends keyof ChatShares & keyof ChatSnapshot>(s: ChatSnapshot, key: K): NonNullable<ChatSnapshot[K]> | null {
  const value = s[key];
  return s.shares[key] === true && value !== undefined && value !== null ? (value as NonNullable<ChatSnapshot[K]>) : null;
}

const notSharedAnswer = (key: keyof ChatShares): Answer => fixed(NOT_SHARED[key], { shared: false, part: key });

// ---- Days ----------------------------------------------------------------------------------------------------

/** ` · {details}`, unless there are none or they only say the subject again (a bagrut exam's do). */
const detailsOf = (e: Exam): string => (e.details && e.details !== e.subject ? ` · ${e.details}` : '');

function examLine(e: Exam): string {
  return `מבחן: ${e.subject}${detailsOf(e)}`;
}

function lessonLine(l: Lesson): string {
  const known = [l.teacher, l.room].filter((x): x is string => !!x);
  let line = `${l.hourIndex} ${l.subject}${known.length ? ` (${known.join(', ')})` : ''}`;
  if (l.status === 'cancelled') line += ' — בוטל';
  else if (l.status === 'substitution') line += l.substitute ? ` — מחליף/ה: ${l.substitute}` : ' — מחליף/ה';
  else if (l.status === 'moved') line += ' — הועבר';
  else if (l.status === 'remote') line += ' — מרחוק';
  if (l.note) line += ` · ${l.note}`;
  return line;
}

/** "Not in the copy", and which days are. */
function missingLine(s: ChatSnapshot, date: DateStr): string {
  const first = s.days[0]?.date;
  const last = s.days.at(-1)?.date;
  return first && last ? `אין לי את ${dm(date)}. יש לי מ־${dm(first)} עד ${dm(last)}.` : `אין לי את ${dm(date)}.`;
}

/** One day: the header, no school, the exams, the lessons, the school's events. Nothing from Google: the copy has none. */
function dayLines(day: ChatDay): string[] {
  const out = [`${day.weekdayName} ${dm(day.date)}`];
  if (!day.isSchoolDay) out.push(`אין לימודים${day.holidayName ? ` · ${day.holidayName}` : ''}`);
  for (const e of day.examsToday) out.push(examLine(e));
  for (const l of day.lessons) out.push(lessonLine(l));
  for (const e of day.events) out.push(`אירוע: ${e.title}${e.details ? ` · ${e.details}` : ''}`);
  if (day.projected && day.lessons.length > 0) out.push('השיעורים לפי המערכת הקבועה: בית הספר עוד לא פרסם את השבוע.');
  return out;
}

function dayData(day: ChatDay): Record<string, unknown> {
  return {
    date: day.date,
    found: true,
    weekdayName: day.weekdayName,
    isSchoolDay: day.isSchoolDay,
    holidayName: day.holidayName,
    projected: day.projected,
    exams: day.examsToday,
    lessons: day.lessons,
    events: day.events,
  };
}

/** One day of the copy; today when `date` is not given. */
export function dayAnswer(s: ChatSnapshot, date: DateStr | undefined, now: Date, zone: string): Answer {
  const want = date ?? todayIn(now, zone);
  const day = s.days.find((d) => d.date === want);
  if (!day) {
    return finish(s, [missingLine(s, want)], { date: want, found: false, first: s.days[0]?.date ?? null, last: s.days.at(-1)?.date ?? null }, now, zone);
  }
  return finish(s, dayLines(day), dayData(day), now, zone);
}

/** Sunday to Friday. */
const SCHOOL_WEEK_DAYS = 6;
/** `sundayIndex` of a Saturday. */
const SATURDAY = 6;

/**
 * The school week `offset` weeks from this one: 0 is this week, 1 the next. On a Saturday this week
 * is over (the school week ends on Friday), and a student who asks for it means the one that starts
 * tomorrow, so there 0 is the coming week and 1 the one after it. `structured.offset` is the offset
 * that was asked; `structured.weekStart` says which Sunday it came to.
 */
export function weekAnswer(s: ChatSnapshot, offset: number, now: Date, zone: string): Answer {
  const today = todayIn(now, zone);
  const start = weekStart(today, offset + (sundayIndex(today, zone) === SATURDAY ? 1 : 0), zone);
  const body: string[] = [];
  const days: Record<string, unknown>[] = [];
  const missing: DateStr[] = [];
  for (let i = 0; i < SCHOOL_WEEK_DAYS; i++) {
    const date = addDays(start, i, zone);
    const day = s.days.find((d) => d.date === date);
    if (i > 0) body.push('');
    if (day) {
      body.push(...dayLines(day));
      days.push(dayData(day));
    } else {
      body.push(missingLine(s, date));
      missing.push(date);
    }
  }
  return finish(s, body, { weekStart: start, offset, days, missing }, now, zone);
}

// ---- Exams ---------------------------------------------------------------------------------------------------

export function examsAnswer(s: ChatSnapshot, q: { from?: DateStr; to?: DateStr; subject?: string }, now: Date, zone: string): Answer {
  const from = q.from ?? todayIn(now, zone);
  const exams = s.exams
    .filter((e) => e.date >= from && (!q.to || e.date <= q.to) && matches(q.subject, e.subject, e.originalSubject))
    .sort((a, b) => a.date.localeCompare(b.date));
  const body = exams.length
    ? exams.map((e) => {
      const time = e.startTime ? ` · ${e.startTime}${e.endTime ? `–${e.endTime}` : ''}` : '';
      return `${dayTitle(e.date, zone)}: ${e.subject}${detailsOf(e)}${time}`;
    })
    : [`לא מצאתי מבחנים${q.subject?.trim() ? ` ב${q.subject.trim()}` : ''} מ־${dm(from)}${q.to ? ` עד ${dm(q.to)}` : ''}.`];
  return finish(s, body, { from, to: q.to ?? null, subject: q.subject ?? null, exams }, now, zone);
}

// ---- The shared parts ----------------------------------------------------------------------------------------

export function homeworkAnswer(s: ChatSnapshot, q: { subject?: string; includeDone?: boolean }, now: Date, zone: string = TZ): Answer {
  const all = part(s, 'homework');
  if (!all) return notSharedAnswer('homework');
  // Item by item, the fields a chat is told: a copy's item never carries the id of a Google Task, and none is passed on if one slipped in.
  const homework = all
    .filter((h) => (q.includeDone === true || !h.done) && matches(q.subject, h.subject))
    .map(({ naturalKey, dueDate, subject, text, done }) => ({ naturalKey, dueDate, subject, text, done }))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const subject = q.subject?.trim() ? ` ב${q.subject.trim()}` : '';
  const body = homework.length
    ? homework.map((h) => `${h.subject}: ${h.text}${h.dueDate ? ` — להגשה ב${dayTitle(h.dueDate, zone)}` : ''}${h.done ? ' (בוצע)' : ''}`)
    : [q.includeDone === true ? `אין שיעורי בית${subject}.` : `אין שיעורי בית פתוחים${subject}.`];
  return finish(s, body, { homework }, now, zone);
}

/** `ממוצע במתמטיקה: 87.5`, and how many grades the student's weights leave out of it, when some (״ציון אחד״ for one). */
function averageLine(a: ChatAverage): string {
  const left = a.uncounted === 1 ? ' (ציון אחד לא נספר בממוצע)' : a.uncounted ? ` (${a.uncounted} ציונים לא נספרים בממוצע)` : '';
  return `ממוצע ב${a.subject}: ${a.average}${left}`;
}

/**
 * The year's grades, each subject's average first (the phone computes them by the student's weights; a copy from
 * an older phone has none, and then there is no average line and no `averages` in the data).
 */
export function gradesAnswer(s: ChatSnapshot, q: { subject?: string }, now: Date, zone: string = TZ): Answer {
  const all = part(s, 'grades');
  if (!all) return notSharedAnswer('grades');
  const grades = all.filter((g) => matches(q.subject, g.subject));
  const averages = s.averages?.filter((a) => matches(q.subject, a.subject));
  const body = (averages ?? []).map(averageLine);
  if (grades.length) body.push(...grades.map((g) => `${dm(g.date)} ${g.subject}: ${g.value ?? g.valueText ?? 'ללא ציון'}${g.notes ? ` · ${g.notes}` : ''}`));
  // Averages with no grades left in the list (the old ones were cut) are an answer too.
  else if (body.length === 0) body.push(`אין ציונים${q.subject?.trim() ? ` ב${q.subject.trim()}` : ''} מהשנה הזאת.`);
  if (s.trimmed.includes('oldGrades')) body.push('ציונים מלפני יותר מ־90 יום לא נשמרו, כי המידע היה גדול מדי.');
  return finish(s, body, averages ? { grades, averages } : { grades }, now, zone);
}

/** `6/2026` for a sitting of `2026-06`. */
const moedOf = (moed: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(moed);
  return m ? `${Number(m[2])}/${m[1]}` : moed;
};

export function bagrutAnswer(s: ChatSnapshot, now: Date, zone: string = TZ): Answer {
  const bagrut = part(s, 'bagrut');
  if (!bagrut) return notSharedAnswer('bagrut');
  const body = bagrut.length
    ? bagrut.map((b) => {
      const bits = [`${b.name} (${b.semel}), מועד ${moedOf(b.moed)}`];
      if (b.schoolGrade !== null) bits.push(`ציון שנתי ${b.schoolGrade}`);
      if (b.examGrade !== null) bits.push(`בחינה ${b.examGrade}`);
      if (b.finalGrade !== null) bits.push(`סופי ${b.finalGrade}`);
      if (b.examDate) bits.push(`נבחנים ב${dayTitle(b.examDate, zone)}${b.startTime ? ` בשעה ${b.startTime}` : ''}`);
      if (b.registered) bits.push('רשום/ה');
      return bits.join(' · ');
    })
    : ['אין ציוני בגרות.'];
  return finish(s, body, { bagrut }, now, zone);
}

const LEVEL: Record<ChatAbsence['level'], string> = { ok: '', close: ' — קרוב למכסה', over: ' — עבר את המכסה' };

export function absencesAnswer(s: ChatSnapshot, now: Date, zone: string = TZ): Answer {
  const absences = part(s, 'absences');
  if (!absences) return notSharedAnswer('absences');
  const body = absences.length
    ? ['חיסורים לפי מקצוע (נספרו מתוך המותר):', ...absences.map((a) => `${a.subject}: ${a.counted} מתוך ${a.allowed}${LEVEL[a.level]}`)]
    : ['אין חיסורים.'];
  return finish(s, body, { absences }, now, zone);
}

/** The messages the text shows in full; the rest are in `structured`, and the chat can search for them. */
const MESSAGES_SHOWN = 20;

export function messagesAnswer(s: ChatSnapshot, q: { query?: string }, now: Date, zone: string = TZ): Answer {
  const all = part(s, 'messages');
  if (!all) return notSharedAnswer('messages');
  const messages = all.filter((m) => matches(q.query, m.title, m.body, m.from));
  const body: string[] = [];
  messages.slice(0, MESSAGES_SHOWN).forEach((m: ChatMessage, i) => {
    if (i > 0) body.push('');
    const date = inZone(m.date, zone).toISODate();
    body.push(`${date ? `${dm(date)} ` : ''}${m.from ? `${m.from}: ` : ''}${m.title}`);
    if (m.body) body.push(m.body);
  });
  if (messages.length > MESSAGES_SHOWN) body.push('', `ועוד ${messages.length - MESSAGES_SHOWN} הודעות. אפשר לחפש לפי מילה.`);
  if (!messages.length) body.push(q.query?.trim() ? `לא מצאתי הודעות עם "${q.query.trim()}".` : 'אין הודעות.');
  if (s.trimmed.includes('messageBodies')) body.push('תוכן ההודעות לא נשמר, רק הכותרות, כי המידע היה גדול מדי.');
  return finish(s, body, { query: q.query ?? null, messages }, now, zone);
}

// ---- Status --------------------------------------------------------------------------------------------------

/** What the chat can read: the school, the days the copy has, and what the student shares. */
export function statusAnswer(s: ChatSnapshot | null, now: Date, zone: string = TZ): Answer {
  if (!s) return fixed(NO_COPY, { hasCopy: false });
  const body: string[] = [];
  if (s.school.name || s.school.className) body.push([s.school.name, s.school.className].filter(Boolean).join(', '));
  const first = s.days[0]?.date ?? null;
  const last = s.days.at(-1)?.date ?? null;
  if (first && last) body.push(`יש לי את המערכת מ־${dm(first)} עד ${dm(last)}, ואת המבחנים עד סוף המחצית.`);
  const on = PARTS.filter((key) => s.shares[key] === true);
  const off = PARTS.filter((key) => s.shares[key] !== true);
  body.push(on.length ? `התלמיד משתף גם: ${on.map((key) => PART_NAMES[key]).join(', ')}.` : 'התלמיד לא משתף דבר מלבד המערכת והמבחנים.');
  if (off.length) body.push(`לא משותף: ${off.map((key) => PART_NAMES[key]).join(', ')}. אפשר להפעיל ב${SETTINGS_PATH}.`);
  if (s.trimmed.length) body.push('חלק מהמידע לא נשמר כי הוא היה גדול מדי.');
  return finish(s, body, { hasCopy: true, school: s.school, first, last, shares: s.shares, trimmed: s.trimmed }, now, zone);
}
