/**
 * The absence tracker (חיסורים): pure arithmetic over `GET /school/attendance`,
 * so plain node can test it (app/test/attendance.test.cjs).
 *
 * The rule: up to and including 15% of a subject's lessons in the semester
 * may be missed. What counts is an unjustified absence, and every
 * `latesPerAbsence` unjustified lates (3 by default, in Settings) count as one
 * more. The semester's lessons are those Mashov says were held, plus those
 * still ahead until the semester ends — the weekly timetable, minus holidays,
 * the Ministry's vacations and the owner's own days off.
 */
import type { AttendanceDayOff, AttendanceSubject, DateStr } from '@sederyom/shared';
import { formatShortDate } from './format';

export type AttendanceLevel = 'ok' | 'close' | 'over';

export interface SubjectStanding {
  /** Absences that count, lates folded in. */
  counted: number;
  /** Lessons in the whole semester: held + ahead. */
  total: number;
  /** The most that may count by the end, inclusive. */
  allowed: number;
  /** How many more lessons may still be missed; 0 when none. */
  safe: number;
  /** How many more lates may still come, with no further absence; 0 when none. */
  safeLates: number;
  /** counted / held, now. Null before the first lesson. */
  nowShare: number | null;
  /** counted / total: the end of the semester, if nothing more is missed. */
  endShare: number | null;
  /** The end of the semester at the current pace: `counted` grown in step with the lessons. */
  paceCount: number | null;
  paceShare: number | null;
  /** At the current pace, the semester would end over the limit. */
  paceOver: boolean;
  /** `close`: two or fewer left to miss, or over the limit at the current pace. */
  level: AttendanceLevel;
}

/** "Close" is two lessons or fewer left to miss: about one week of a two-hour subject. */
export const CLOSE_AT = 2;

/** `limit` of `total`, rounded down: "up to and including 15%" of 21 is 3 (3.15). */
export function allowedOf(total: number, limit: number): number {
  // In hundredths, so 15% of 20 is exactly 3 and not 2.9999….
  return Math.floor((total * Math.round(limit * 100)) / 100);
}

export function standing(s: AttendanceSubject, limit: number, latesPerAbsence: number): SubjectStanding {
  const per = Math.max(1, Math.floor(latesPerAbsence));
  const counted = s.absences + Math.floor(s.lates / per);
  const total = s.held + s.remaining;
  const allowed = allowedOf(total, limit);
  const safe = Math.max(0, allowed - counted);
  // The most lates L with absences + ⌊(lates + L) / per⌋ ≤ allowed.
  const safeLates = allowed >= s.absences ? Math.max(0, (allowed - s.absences + 1) * per - 1 - s.lates) : 0;
  const paceCount = s.held > 0 ? Math.round((counted * total) / s.held) : null;
  const paceOver = paceCount !== null && paceCount > allowed;
  return {
    counted,
    total,
    allowed,
    safe,
    safeLates,
    nowShare: s.held > 0 ? counted / s.held : null,
    endShare: total > 0 ? counted / total : null,
    paceCount,
    paceShare: paceCount !== null && total > 0 ? paceCount / total : null,
    paceOver,
    level: counted > allowed ? 'over' : safe <= CLOSE_AT || paceOver ? 'close' : 'ok',
  };
}

/** Most at risk first: over the limit, then over it at the current pace, then the fewest left to miss, then by name. */
export function byRisk(a: { subject: AttendanceSubject; standing: SubjectStanding }, b: { subject: AttendanceSubject; standing: SubjectStanding }): number {
  const over = Number(b.standing.level === 'over') - Number(a.standing.level === 'over');
  if (over !== 0) return over;
  const pace = Number(b.standing.paceOver) - Number(a.standing.paceOver);
  if (pace !== 0) return pace;
  if (a.standing.safe !== b.standing.safe) return a.standing.safe - b.standing.safe;
  return a.subject.subject.localeCompare(b.subject.subject, 'he');
}

const LTR = (s: string | number): string => `⁦${s}⁩`;

/** 0.0667 → "6.7%", 0.15 → "15%", one decimal at most, isolated for a Hebrew line. */
export function percent(share: number): string {
  const v = Math.round(share * 1000) / 10;
  return LTR(`${Number.isInteger(v) ? v : v.toFixed(1)}%`);
}

/** The subject row's end: what may still be missed. */
export function safeLine(st: SubjectStanding): string {
  if (st.level === 'over') return `${LTR(st.counted - st.allowed)} מעל הגבול`;
  if (st.safe === 0) return 'בדיוק על הגבול';
  return st.safe === 1 ? 'עוד חיסור אחד' : `עוד ${LTR(st.safe)} חיסורים`;
}

/** "עכשיו: 6 מתוך 21 שיעורים, 28.6%" */
export function nowLine(s: AttendanceSubject, st: SubjectStanding): string {
  if (st.nowShare === null) return 'עוד לא היו שיעורים';
  const missed = st.counted === 1 ? 'חיסור אחד' : `${LTR(st.counted)} חיסורים`;
  return `עכשיו: ${missed} מתוך ${LTR(s.held)} שיעורים, ${percent(st.nowShare)}`;
}

/** "בסוף המחצית, בלי עוד חיסורים: 6.5% מתוך 92 שיעורים. מותר עד 13." */
export function endLine(st: SubjectStanding): string {
  if (st.endShare === null) return '';
  return `בסוף המחצית, בלי עוד חיסורים: ${percent(st.endShare)} מתוך ${LTR(st.total)} שיעורים. מותר עד ${LTR(st.allowed)}.`;
}

/** At the current pace — only worth saying when it differs from "no more". */
export function paceLine(st: SubjectStanding): string | null {
  if (st.paceCount === null || st.paceShare === null || st.paceCount === st.counted) return null;
  return `בקצב הנוכחי: ${LTR(st.paceCount)} חיסורים, ${percent(st.paceShare)}${st.paceCount > st.allowed ? ', מעל הגבול' : ''}`;
}

/** What else is on the record: lates that count, and what was justified and does not. */
export function extrasLine(s: AttendanceSubject, latesPerAbsence: number, st: SubjectStanding): string | null {
  const parts: string[] = [];
  if (s.lates > 0) {
    const lates = s.lates === 1 ? 'איחור אחד' : `${LTR(s.lates)} איחורים`;
    parts.push(`${lates} (כל ${LTR(latesPerAbsence)} הם חיסור)`);
  }
  const justified = s.justifiedAbsences + s.justifiedLates;
  if (justified > 0) parts.push(justified === 1 ? 'אחד מוצדק, לא נספר' : `${LTR(justified)} מוצדקים, לא נספרים`);
  if (st.level !== 'over' && s.lates > 0) parts.push(`עוד ${LTR(st.safeLates)} איחורים בלי לעבור`);
  return parts.length > 0 ? parts.join('. ') : null;
}

/** The days off ahead, consecutive days of one name as one range: "6.12–11.12 חופשת חנוכה". */
export function dayOffRanges(days: AttendanceDayOff[]): { from: DateStr; to: DateStr; name: string; own: boolean }[] {
  const out: { from: DateStr; to: DateStr; name: string; own: boolean }[] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && last.name === d.name && last.own === d.own && !d.own && nextDay(last.to) === d.date) last.to = d.date;
    else out.push({ from: d.date, to: d.date, name: d.name, own: d.own });
  }
  return out;
}

/**
 * A right-to-left mark first: a line that starts with a number would otherwise be read
 * as a left-to-right paragraph and sit at the left edge (as WeekScreen's heading does).
 */
export const RLM = String.fromCharCode(0x200f);

/** "6.12–11.12", for a line of its own. */
export function rangeLabel(r: { from: DateStr; to: DateStr }): string {
  return RLM + (r.from === r.to ? LTR(formatShortDate(r.from)) : LTR(`${formatShortDate(r.from)}–${formatShortDate(r.to)}`));
}

function nextDay(date: DateStr): DateStr {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** Adds a day off, or takes one away: the list stays sorted and unique. */
export function toggleDayOff(days: readonly DateStr[], date: DateStr): DateStr[] {
  return days.includes(date) ? days.filter((d) => d !== date) : [...days, date].sort();
}
