/**
 * A student's own names for subjects (design 2026-11-05): the school writes
 * "גוש ב׳", the student knows it is physics, and wants to read "פיזיקה" in
 * the day, the week, the exam list, Mashov's items and the pushes the server
 * sends. The phone and the server both decide a name here and nowhere else,
 * so one lesson never has two names on two screens.
 *
 * A name is stored under keys, in one map per followed class:
 *
 *  - a line of the timetable: its hide-list entry (`lessonHideKey`), so the
 *    name follows the same published line the hiding does;
 *  - a block, `block:ב`, for a block exam when no line of that block exists;
 *  - a subject, `subject:<canonical>`, for an exam or a Mashov item whose
 *    subject has no line, say a bagrut from a subject that ended last year.
 *
 * What is *kept* decides who matches whom: the class site's lines minus the
 * hide list, and nothing from Mashov's grid (`siteLines`, `nameContext`). The
 * server cannot see Mashov, and both sides have to give the same answer.
 *
 * Everything that matches or identifies (hiding, colours, exam matching,
 * dedupe) keeps reading the source's name; this module only says what to
 * *show*. A name is shown as the student typed it, so none of it goes through
 * `plainSubject` and the like.
 */
import { parseExamTitle } from './exam-match';
import { isHiddenLesson, lessonHideKey, type TimetableLine } from './filters';
import { canonicalSubject, subjectsMatch, teachersMatch } from './subjects';

/** Key → the student's name. */
export type SubjectNames = Readonly<Record<string, string>>;

/** The longest name, on one line. */
export const SUBJECT_NAME_MAX = 40;
/** The most names one map holds. */
export const SUBJECT_NAMES_MAX = 200;
/** The longest key; a hide-list entry is a subject and a teacher, far below it. */
export const SUBJECT_NAME_KEY_MAX = 200;

/** The key of a block, from its letter: `'ב'` (or `"ב'"`) → `'block:ב'`. */
export function blockNameKey(block: string): string {
  return `block:${block.replace(/["'׳״]/g, '').trim()}`;
}

/** The key of a subject by its canonical name: "חנ״ג" and "חינוך גופני" share one. */
export function subjectNameKey(subject: string): string {
  return `subject:${canonicalSubject(subject)}`;
}

/** A name as stored: whitespace collapsed to single spaces, trimmed, at most `SUBJECT_NAME_MAX` characters. */
export function cleanSubjectName(name: string | null | undefined): string {
  let out = (name ?? '').replace(/\s+/g, ' ').trim();
  if (out.length > SUBJECT_NAME_MAX) {
    out = out.slice(0, SUBJECT_NAME_MAX);
    // Never end on half of a pair (an emoji), nor on the space the cut left.
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
    out = out.trimEnd();
  }
  return out;
}

function usableKey(key: string): boolean {
  return key.length > 0 && key.length <= SUBJECT_NAME_KEY_MAX;
}

/**
 * The map out of whatever was stored or sent: strings only, names cleaned,
 * empty ones and over-long keys dropped, at most `SUBJECT_NAMES_MAX` entries.
 * Never throws.
 */
export function subjectNamesOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out = new Map<string, string>();
  for (const [key, raw] of Object.entries(value)) {
    if (out.size >= SUBJECT_NAMES_MAX) break;
    if (typeof raw !== 'string' || !usableKey(key)) continue;
    const name = cleanSubjectName(raw);
    if (name !== '') out.set(key, name);
  }
  // `fromEntries` defines own properties, so a key of "__proto__" stays a key.
  return Object.fromEntries(out);
}

/**
 * `names` with `name` written under every one of `keys`, as a new map. An
 * empty name, or one equal to any of `originals` (after cleaning) is no name:
 * it deletes those keys. Keys new beyond `SUBJECT_NAMES_MAX` are not added;
 * the ones already there can always change.
 */
export function withSubjectName(
  names: SubjectNames,
  keys: readonly string[],
  name: string | null,
  originals: readonly string[],
): Record<string, string> {
  const next = new Map(Object.entries(names));
  const cleaned = cleanSubjectName(name);
  const removing = cleaned === '' || originals.some((original) => cleanSubjectName(original) === cleaned);
  for (const key of keys) {
    if (removing) next.delete(key);
    else if (next.has(key) || (usableKey(key) && next.size < SUBJECT_NAMES_MAX)) next.set(key, cleaned);
  }
  return Object.fromEntries(next);
}

/** The names two maps agree on: keys both have, under the same name. */
export function intersectNames(a: SubjectNames, b: SubjectNames): Record<string, string> {
  const same = Object.entries(a).filter(([key, name]) => nameAt(b, key) === name);
  return Object.fromEntries(same);
}

/** The name stored under `key`; an inherited property ("constructor") is not one. */
function nameAt(names: SubjectNames, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(names, key)) return undefined;
  const name = names[key];
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * The class site's lines, once each, from its lessons: an exam row is not a
 * lesson. The phone passes `feed.lessons`, the server the class snapshot's
 * lessons dated from a week back, which is what the feed carries.
 */
export function siteLines(lessons: readonly { subject: string; teacher: string | null; status?: string }[]): TimetableLine[] {
  const seen = new Map<string, TimetableLine>();
  for (const lesson of lessons) {
    if (lesson.status === 'exam') continue;
    const id = `${lesson.subject}\u0000${lesson.teacher ?? ''}`;
    if (!seen.has(id)) seen.set(id, { subject: lesson.subject, teacher: lesson.teacher });
  }
  return [...seen.values()];
}

/** What deciding a name needs: the map, and the lines the student keeps. */
export interface NameContext {
  names: SubjectNames;
  /** The site's lines minus the hide list. */
  kept: readonly TimetableLine[];
}

/** The context for one student and class; `null` when there are no names, so callers can skip the work. */
export function nameContext(
  names: SubjectNames | undefined,
  lines: readonly TimetableLine[],
  hidden: readonly string[],
): NameContext | null {
  if (!names || Object.keys(names).length === 0) return null;
  return { names, kept: lines.filter((line) => !isHiddenLesson(hidden, line)) };
}

const blocks = new Map<string, string | null>();

/** The block a timetable line is of: `'גוש ב׳ (יב)'`, `'כימיה- גוש ב'` → `'ב'`; `null` for a line that is no block's. */
export function lineBlock(subject: string): string | null {
  const kept = blocks.get(subject);
  if (kept !== undefined) return kept;
  const { block } = parseExamTitle(subject);
  // Many lines are asked again for every lesson of every day; a full memo starts over.
  if (blocks.size >= 4096) blocks.clear();
  const found = block === null || block === '' ? null : block;
  blocks.set(subject, found);
  return found;
}

/** A line's own name: its key with its teacher, else its key alone. */
function lineName(names: SubjectNames, line: TimetableLine): string | undefined {
  return nameAt(names, lessonHideKey(line, true)) ?? nameAt(names, lessonHideKey(line, false));
}

/**
 * One name out of the lines' names: the only one they give, said once however
 * many lines give it. Two different names are no name (`null`), and the
 * fallback is for lines that give none.
 */
function oneName(found: readonly (string | undefined)[], fallback: string | undefined): string | null {
  const distinct = new Set(found.filter((name): name is string => name !== undefined));
  if (distinct.size === 0) return fallback ?? null;
  return distinct.size === 1 ? [...distinct][0]! : null;
}

/**
 * The name to show for a lesson of the day or week, or `null` for none.
 *
 * - A lesson from Mashov's grid is an item from Mashov.
 * - A lesson of the site: its line's own name; else, for a line of a block,
 *   the block's name; else the subject's. A block never takes the subject's.
 */
export function lessonName(
  ctx: NameContext,
  lesson: { subject: string; teacher: string | null; source?: string },
): string | null {
  if (lesson.source === 'mashov') return mashovName(ctx, lesson);
  const own = lineName(ctx.names, lesson);
  if (own !== undefined) return own;
  const block = lineBlock(lesson.subject);
  if (block !== null) return nameAt(ctx.names, blockNameKey(block)) ?? null;
  return nameAt(ctx.names, subjectNameKey(lesson.subject)) ?? null;
}

/**
 * The name to show for an item Mashov names (homework, a grade, an absence, an
 * exam): the one name of the kept lines of that subject, a teacher it rules
 * out not counting; two names, none; no line named, the subject's name.
 * "חינוך" never reaches "חינוך גופני": `subjectsMatch` tells them apart.
 */
export function mashovName(ctx: NameContext, item: { subject: string; teacher?: string | null }): string | null {
  const teacher = item.teacher ?? null;
  const found = ctx.kept
    .filter((line) => subjectsMatch(item.subject, line.subject) && teachersMatch(teacher, line.teacher) !== false)
    .map((line) => lineName(ctx.names, line));
  return oneName(found, nameAt(ctx.names, subjectNameKey(item.subject)));
}

/** Characters `parseExamTitle` splits a title on; between two of its words, any run of them stands. */
const SEPARATORS = '\\s\\-–—:;,.()/+';
/** Quote marks around a word, which its tokens drop. */
const QUOTES = '\'"׳״‘’“”`';

/** A character of a word as it matches in a title: a quote mark stands for its whole family. */
function charPattern(char: string): string {
  if (char === "'") return "['׳‘’`]";
  if (char === '"') return '["״“”]';
  return char.replace(/[.*+?^${}()|[\]\\\-/]/g, '\\$&');
}

/**
 * `title` with `name` in place of the first place that reads `words`
 * (space-joined tokens, quote marks unified): at a word's start or just after
 * a ב that starts it ("באנגלית" holds "אנגלית"), to a word's end, any
 * separators between the words. `null` when it is not there; the title is then
 * left alone, never cut in the wrong place.
 *
 * Quote marks around the words are the title's own: a pair stays ("ב"אנגלית""
 * → "ב"English""); one mark alone ("גוש ב״", where ׳ was meant) is noise and
 * goes, so no lone mark is left behind.
 */
function replaceWords(title: string, words: string, name: string): string | null {
  // The ב of `ב"אנגלית` was dropped and left the mark first: it is a mark, not part of the word.
  const bare = words.replace(/^['"]+/, '');
  if (bare === '') return null;
  const body = bare.split(' ').map((word) => Array.from(word, charPattern).join('')).join(`[${SEPARATORS}]+`);
  const marks = `[${QUOTES}]*`;
  const found = new RegExp(`(^|[${SEPARATORS}])(${marks})(ב?)(${marks})(${body})(${marks})(?=$|[${SEPARATORS}])`).exec(title);
  if (!found) return null;
  const text = (group: number) => found[group] ?? '';
  const whole = text(0), separator = text(1), outer = text(2), preposition = text(3), inner = text(4), after = text(6);
  const pair = outer + inner !== '' && after !== '';
  const head = title.slice(0, found.index) + separator + (pair ? outer : '') + preposition + (pair ? inner : '');
  return head + name + (pair ? after : '') + title.slice(found.index + whole.length);
}

/**
 * An exam's title with the student's name where it reads the subject: "מבחן
 * גוש ב׳" → "מבחן פיזיקה", "מתכונת באנגלית וויקה" → "מתכונת בEnglish וויקה".
 * Only those words change; "מבחן", "בגרות", "מועד ב׳" and the ב before them stay.
 *
 * - An exam whose title reads a subject is named by its subject, also when
 *   the title reads a block too ("כימיה- גוש ב"): the one name of the kept
 *   lines that match, else the subject's. A block holds other subjects, so its
 *   name would land on theirs.
 * - A block exam that reads no subject ("מבחן גוש ב׳") by its block: the one
 *   name of the kept lines of that block, else the block's. A title with no
 *   block letter has no name.
 *
 * `null` when no name applies, when the title would not change, and when the
 * words it read are not there as one run (a bare title like "כימיה חקר
 * אזרחות" reads "כימיה אזרחות").
 */
export function examTitle(ctx: NameContext, title: string): { title: string; name: string } | null {
  const parsed = parseExamTitle(title, ctx.kept);
  let words: string | null;
  let name: string | null;
  if (parsed.subject !== '') {
    words = parsed.subjectWords;
    const same = ctx.kept.filter((line) => subjectsMatch(parsed.subject, line.subject));
    name = oneName(same.map((line) => lineName(ctx.names, line)), nameAt(ctx.names, subjectNameKey(parsed.subject)));
  } else if (parsed.block !== null && parsed.block !== '') {
    words = parsed.blockWords;
    const same = ctx.kept.filter((line) => lineBlock(line.subject) === parsed.block);
    name = oneName(same.map((line) => lineName(ctx.names, line)), nameAt(ctx.names, blockNameKey(parsed.block)));
  } else {
    return null;
  }
  if (name === null || words === null) return null;
  const named = replaceWords(title, words, name);
  return named === null || named === title ? null : { title: named, name };
}
