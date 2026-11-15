/**
 * Which of the grade's exams look like the owner's (plan F5).
 *
 * The school publishes one exam calendar for the whole grade — "מבחן באנגלית",
 * "בגרות במתמטיקה - רק למשפרים", "מבחן גוש א" — and each student sits some of
 * it. This reads an exam's title, names the subject it is about, and compares
 * that subject with the lessons the owner keeps. The answer is a
 * recommendation only: nothing here touches the hide-list.
 *
 * The rules are conservative in the same direction as `subjects.ts`: "not
 * yours" needs evidence (the title says so — "רק למשפרים", "מועד ב׳" — or the
 * subject is plainly absent from the timetable), and anything unclear — a
 * block exam whose details list no subject, a title naming a teacher who is
 * not the owner's — stays `null` for the owner to decide.
 */
import type { ExamMatch } from '../index';
import { canonicalSubject, isKnownSubject, normalizeSubject, subjectsMatch, teachersMatch } from './subjects';

export interface LessonLine {
  subject: string;
  teacher: string | null;
}

export interface OwnerLessons {
  /** Lines the owner keeps: their timetable minus the hide-list. */
  kept: LessonLine[];
  /** Lines the owner switched off as not theirs. */
  hidden: LessonLine[];
}

export interface ExamTitle {
  /** The subject as the title words it, readable; `''` when the title names none. */
  subject: string;
  /** `גוש א` → `'א'`; `'גוש'` alone → `''`; `null` when it is not a block exam. */
  block: string | null;
  /** "רק למשפרים": a resit for students improving an existing grade. */
  improversOnly: boolean;
  /** "מועד ב׳", "מועד תיקון", "מועד מיוחד": a later round, sat only by those who need it. */
  resit: boolean;
  /**
   * The title's own words that read as the subject, space-joined as `tokens`
   * has them: the stripped form when the ב of "באנגלית" was dropped, so
   * "אנגלית". `null` exactly when `subject` is `''`. A student's own name for
   * the subject replaces these words and no others.
   */
  subjectWords: string | null;
  /**
   * The words that read as the block, as written: "גוש ב'" or "בגוש א" ("גוש"
   * alone when no letter follows). `null` exactly when `block` is `null`.
   */
  blockWords: string | null;
  /** Words after the subject this reader could not place — often a teacher's name. */
  rest: string[];
  /** Whether `subject` is a subject for certain (alias table or timetable), not just the word after "מבחן ב". */
  known: boolean;
}

export const REASON_IMPROVERS = 'רק למשפרים';
export const REASON_NOT_IN_TIMETABLE = 'לא במערכת שלך';
export const REASON_RESIT = 'מועד ב׳ — רק למי שניגש';

export function blockReason(block: string): string {
  return block ? `גוש ${block}׳ — מקצוע אחר` : 'גוש — מקצוע אחר';
}

/** How many of a block's subjects its label names before "…". */
const BLOCK_SUBJECTS_SHOWN = 3;

/**
 * "גוש ב׳: פיזיקה, ביולוגיה" — a block exam by the subjects its details list.
 * `more` adds "…" for lines of the list that did not read as a subject.
 */
export function blockLabel(block: string, subjects: readonly string[], more = false): string {
  const head = block ? `גוש ${block}׳` : 'גוש';
  const shown = subjects.slice(0, BLOCK_SUBJECTS_SHOWN);
  const tail = more || subjects.length > shown.length ? ', …' : '';
  return `${head}: ${shown.join(', ')}${tail}`;
}

/** What kind of assessment, or when — never the subject. */
const KIND_WORDS = new Set([
  'מבחן', 'מבחני', 'בוחן', 'בחינה', 'בחינת', 'בחינות', 'בגרות', 'בגרויות', 'מתכונת', 'מבדק', 'מבדקי',
  'הדמיה', 'ממוחשבת', 'ממוחשב', 'תאריך', 'הגשת', 'הגשה', 'עבודת', 'עבודה', 'מועד', 'תיקון', 'סיום',
]);

/** Words that qualify an exam without naming a subject or a person. */
const QUALIFIERS = new Set([
  'מעבדה', 'במעבדה', 'חקר', 'מעשי', 'מעשית', 'עיוני', 'עיונית', 'בעל', 'פה', 'בעפ', 'שאלון', 'שאלונים',
  'פרק', 'פרקים', 'חלק', 'מסכם', 'מסכמת', 'סופי', 'סופית', 'אמצע', 'שליש', 'מחצית', 'ראשון', 'ראשונה',
  'שני', 'שנייה', 'משותף', 'ארצי', 'פנימי', 'חיצוני', 'תרגול', 'חזרה', 'בקיאות', 'השלמה', 'השלמות',
  'של', 'עם', 'על', 'את', 'כל', 'לכל', 'השכבה', 'שכבה', 'שכבתי', 'כיתה', 'כיתות', 'קבוצה', 'הקבצה',
  'רק', 'למשפרים', 'משפרים', 'לא', 'יתקיים', 'נדחה', 'מיוחד', 'מיוחדת', 'חדש',
]);

/** The word after "מועד" that makes it a later round — not "מועד חדש", which is a new date. */
const RESIT_ROUND = new Set(['ב', "ב'", 'תיקון', 'מיוחד']);

/** "י"ב2+", "יב", "יא1", "ט3": the class or grade, which the app already knows. */
const CLASS_TOKEN = /^(?:י"?[אבגד]?|[זחט]'?)\d*\+?$/;
/** A lone Hebrew letter, "א" or "ב'": a block, a resit round, a part. */
const LETTER_TOKEN = /^[א-ת]'?$/;

/** Quote marks unified to ASCII, so `'` and `"` can be matched once. */
function unifyQuotes(text: string): string {
  return text.replace(/[״“”]/g, '"').replace(/[׳‘’`]/g, "'");
}

function tokens(text: string): string[] {
  return unifyQuotes(text)
    .split(/[\s\-–—:;,.()/+]+/)
    // Quotes around a word go; the geresh of "ב'" stays, it is part of the letter.
    .map((t) => t.replace(/^['"]+/, '').replace(/"+$/, ''))
    .filter(Boolean);
}

type Lines = readonly LessonLine[];

/** Whether a phrase names a subject: the alias table knows it, or a timetable line is exactly it. */
function isSubjectPhrase(phrase: string, lines: Lines): boolean {
  if (isKnownSubject(phrase)) return true;
  const norm = normalizeSubject(phrase);
  return norm.length >= 3 && lines.some((l) => normalizeSubject(l.subject) === norm);
}

/** Drops the ב of "מבחן באנגלית" — only when what is left is the subject and the word itself is not. */
function withoutPreposition(word: string, lines: Lines): string | null {
  if (!word.startsWith('ב') || word.length < 3) return null;
  if (isSubjectPhrase(word, lines)) return null;
  return word.slice(1);
}

function isNoise(token: string): boolean {
  if (KIND_WORDS.has(token) || QUALIFIERS.has(token.replace(/["']/g, ''))) return true;
  if (CLASS_TOKEN.test(token) || LETTER_TOKEN.test(token)) return true;
  if (/^[a-z]+$/i.test(token) || /\d/.test(token)) return true;
  // Level words — "יח"ל", "מוגבר" — normalize to nothing.
  return normalizeSubject(token) === '';
}

/**
 * Reads an exam title. `lines` lets a subject the alias table does not list
 * ("אזרחות", "ספרות") still be recognised when the timetable has it.
 */
export function parseExamTitle(title: string, lines: Lines = []): ExamTitle {
  const written = tokens(title);
  // "מבחן בגוש א" is "מבחן גוש א" with a preposition.
  const words = written.map((w) => (w === 'בגוש' ? 'גוש' : w));
  const improversOnly = /משפרים/.test(title);
  const resit = words.some((w, i) => (w === 'מועד' || w === 'מועדי') && RESIT_ROUND.has(words[i + 1] ?? ''));

  let block: string | null = null;
  let blockWords: string | null = null;
  const blockAt = words.indexOf('גוש');
  if (blockAt >= 0) {
    const next = words[blockAt + 1] ?? '';
    block = LETTER_TOKEN.test(next) ? next.replace("'", '') : '';
    // The words as the title wrote them: "בגוש", not the "גוש" it is read as.
    blockWords = block ? `${written[blockAt]} ${next}` : written[blockAt]!;
  }

  const candidates = words.map((w, i) => ({ w, i })).filter(({ w, i }) => w !== 'גוש' && !(block && i === blockAt + 1));

  // 1. A known subject anywhere — the longest phrase first, so "מדעי המחשב"
  //    wins over "מדעי" and "עולם הערבים והאסלאם" over "עולם".
  for (let k = 0; k < candidates.length; k++) {
    const start = candidates[k]!;
    if (isNoise(start.w)) continue;
    for (let len = Math.min(4, candidates.length - k); len >= 1; len--) {
      const span = candidates.slice(k, k + len);
      // A phrase must be contiguous in the title and free of noise words inside it.
      if (span.some((s, j) => s.i !== start.i + j || (j > 0 && isNoise(s.w)))) continue;
      const asWritten = span.map((s) => s.w).join(' ');
      const stripped = withoutPreposition(span[0]!.w, lines);
      const options = [asWritten, ...(stripped ? [[stripped, ...span.slice(1).map((s) => s.w)].join(' ')] : [])];
      const found = options.find((o) => isSubjectPhrase(o, lines));
      if (found) {
        const rest = candidates.slice(k + len).map((c) => c.w).filter((w) => !isNoise(w));
        return { subject: displaySubject(found), subjectWords: found, block, blockWords, improversOnly, resit, rest, known: true };
      }
    }
  }

  // 2. Nothing known. "מבחן ב<word>" still names a subject, just one this
  //    server has never heard of; a bare title ("כימיה", as the timetable site
  //    lists exams) is the subject. Anything else names none.
  const unknown = (subjectWords: string | null, rest: string[]): ExamTitle => ({
    subject: subjectWords === null ? '' : displaySubject(subjectWords),
    subjectWords, block, blockWords, improversOnly, resit, rest, known: false,
  });
  const kindAt = words.findIndex((w) => KIND_WORDS.has(w));
  const open = candidates.filter((c) => !isNoise(c.w));
  if (open.length === 0) return unknown(null, []);
  if (kindAt < 0) return unknown(open.map((c) => c.w).join(' '), []);
  const first = open[0]!;
  if (first.i > kindAt && KIND_WORDS.has(words[first.i - 1] ?? '')) {
    const word = first.w.startsWith('ב') && first.w.length > 3 ? first.w.slice(1) : first.w;
    return unknown(word, open.slice(1).map((c) => c.w));
  }
  return unknown(null, open.map((c) => c.w));
}

/** Canonical spellings that need their quote mark back to be readable. */
const DISPLAY: Record<string, string> = { 'תנך': 'תנ״ך', 'תושבע': 'תושב״ע', 'שלח': 'של״ח' };

/**
 * The school's own word for the subject ("עברית", not the alias key "לשון"),
 * except where it is an abbreviation ("ביו" → "ביולוגיה").
 */
function displaySubject(phrase: string): string {
  const tidy = phrase.replace(/\s+/g, ' ').trim();
  if (isKnownSubject(tidy)) {
    const canonical = canonicalSubject(tidy);
    if (normalizeSubject(tidy).length < canonical.length) return DISPLAY[canonical] ?? canonical;
  }
  return tidy.replace(/"/g, '״').replace(/'/g, '׳');
}

/**
 * A timetable line or a homework group as a student says it: "פיזיקה מורחב
 * (מעבדת פיסיקה)" → "פיזיקה", "אנגלית 5 יח"ל (יב2)" → "אנגלית", "תנ"ך (יא1)"
 * → "תנ״ך". Level and group words go (`normalizeSubject`); an abbreviation
 * reads in full, as `displaySubject` has it. Lists dedupe on `canonicalSubject`.
 */
export function readableSubject(raw: string): string {
  const norm = normalizeSubject(raw);
  if (!norm) return raw.replace(/\s+/g, ' ').trim();
  const display = DISPLAY[canonicalSubject(norm)];
  return display ?? displaySubject(norm);
}

/** Readable names, one per subject, in first-seen order. */
export function uniqueSubjects(raw: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of raw) {
    const key = canonicalSubject(name) || name;
    if (!seen.has(key)) seen.set(key, readableSubject(name));
  }
  return [...seen.values()];
}

/** The readable subject an exam is about — `ExamOption.subjectKey`. */
export function examSubjectKey(title: string, lines: Lines = []): string {
  return parseExamTitle(title, lines).subject;
}

/**
 * One entry per exam both the class's site and the grade's exam calendar
 * list. The site's exams were read as empty until 2026-10-28 (ideas ל2), so
 * the two never met; now a class with both would see each exam twice, and
 * the phone would mirror both into Google. The calendar's stays: the
 * student's choices are kept under its key ("שלי", hidden, a name of their
 * own), and so is what the phone already mirrored. The site's goes when its
 * date is the same and its title names the same subject, or the same block.
 * The site's own exams the calendar does not have stay, as does everything
 * from any other source, and an exam without a date. The server's class feed
 * runs it too, for phones from before 1.9.16 that keep both.
 */
export function withoutSiteTwins<T extends { date: string | null; subject: string; source?: string }>(exams: readonly T[]): T[] {
  return splitSiteTwins(exams).kept;
}

/**
 * `withoutSiteTwins` and what it takes out: the site's exams that the exam calendar also lists. One rule for both, so
 * that whoever needs the exams the calendar covered (the server hands them to a phone that lays another board over
 * the class's, `ClassFeed.siteTwins`) never matches them a second way. `kept` is exactly `withoutSiteTwins`'s result.
 */
export function splitSiteTwins<T extends { date: string | null; subject: string; source?: string }>(exams: readonly T[]): { kept: T[]; twins: T[] } {
  const calendar = exams.filter((e) => e.source === 'school_site').map((e) => ({ date: e.date, ...parseExamTitle(e.subject) }));
  if (calendar.length === 0) return { kept: [...exams], twins: [] };
  const kept: T[] = [];
  const twins: T[] = [];
  for (const exam of exams) {
    if (exam.source !== 'shahaf' || exam.date === null) {
      kept.push(exam);
      continue;
    }
    const site = parseExamTitle(exam.subject);
    const twin = calendar.some((c) => c.date === exam.date && (
      (site.subject !== '' && c.subject !== '' && subjectsMatch(site.subject, c.subject))
      || (site.block !== null && site.block !== '' && site.block === c.block)
    ));
    (twin ? twins : kept).push(exam);
  }
  return { kept, twins };
}

/**
 * Whether an exam is the owner's. `details` is read only for a block exam
 * whose title names no subject, where it sometimes lists the subjects.
 */
export function matchExam(exam: { subject: string; details: string | null }, owner: OwnerLessons): { subjectKey: string; match: ExamMatch } {
  const all = [...owner.kept, ...owner.hidden];
  const title = parseExamTitle(exam.subject, all);
  const answer = (mine: boolean | null, reason: string | null = null, subjectKey = title.subject) => ({ subjectKey, match: { mine, reason } });

  // What the title itself says holds with or without a timetable.
  if (title.improversOnly) return answer(false, REASON_IMPROVERS);
  if (title.resit) return answer(false, REASON_RESIT);

  if (!title.subject && title.block !== null) {
    // A block exam: each student sits their own elective. Only a list of
    // subjects in the details can say whose — and it names the block either way.
    const { subjects: listed, unplaced } = subjectsIn(exam.details ?? '', all);
    if (listed.length > 0) {
      const isKept = (s: string) => owner.kept.some((l) => subjectsMatch(s, l.subject));
      // The owner's own subject first, so the label never hides it behind "…".
      const ordered = [...listed.filter(isKept), ...listed.filter((s) => !isKept(s))];
      const label = blockLabel(title.block, ordered, unplaced);
      if (all.length === 0) return answer(null, null, label);
      if (ordered.some(isKept)) return answer(true, null, label);
      return answer(false, label, label);
    }
  }

  // Nothing to compare with: no timetable has been read yet.
  if (all.length === 0) return answer(null);

  // No subject — a block exam whose details list none, or a title this reader
  // cannot place: too little to tell.
  if (!title.subject) return answer(null);

  const kept = owner.kept.filter((l) => subjectsMatch(title.subject, l.subject));
  const hidden = owner.hidden.filter((l) => subjectsMatch(title.subject, l.subject));

  if (title.rest.length > 0) {
    // "מתכונת באנגלית וויקה": usually one group's teacher. Theirs → yours;
    // a group the owner hid → not; anyone else → too little to tell.
    const names = title.rest.join(' ');
    if (kept.some((l) => teachersMatch(names, l.teacher) === true)) return answer(true);
    if (hidden.some((l) => teachersMatch(names, l.teacher) === true)) return answer(false, REASON_NOT_IN_TIMETABLE);
    if (kept.length > 0) return answer(null);
  }

  if (kept.length > 0) return answer(true);
  if (title.block !== null) return answer(false, blockReason(title.block));
  return answer(false, REASON_NOT_IN_TIMETABLE);
}

/**
 * Subjects a free text names for certain. Free text is not a title, so only
 * a known subject counts — "בחדר 12" must not read as a subject called "חדר".
 * `unplaced` says whether some line read as a word this reader cannot place
 * ("כימיה-דינה" without a chemistry lesson, or a teacher's name).
 */
function subjectsIn(text: string, lines: Lines): { subjects: string[]; unplaced: boolean } {
  const parts = text.split(/[\n,;•·]+/).map((part) => parseExamTitle(part, lines)).filter((t) => t.subject);
  return {
    subjects: uniqueSubjects(parts.filter((t) => t.known).map((t) => t.subject)),
    unplaced: parts.some((t) => !t.known),
  };
}
