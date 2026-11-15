/**
 * Subject names across the two school sources.
 *
 * The Shahaf grid prints what the school typed into it — "אנגלית 5 יח"ל",
 * "מתמטיקה 3 יח"ל (יא1)" — while Mashov names the *group* the student is in,
 * often shorter and sometimes abbreviated ("חנ״ג" for חינוך גופני). Neither is
 * wrong; they just never agree character for character.
 *
 * Two different questions live here, and they need different strictness:
 *
 *  - `subjectKey` — is this the *same published line*? Exact, apart from
 *    whitespace and the two spellings of the Hebrew quote mark. The hide list
 *    stores these keys, and the live grid shows why it must be exact: it
 *    carries both "היסטוריה" and "היסטוריה (יא1)", with different teachers.
 *  - `subjectsMatch` — does a Shahaf line mean the *same subject* as a Mashov
 *    group? Fuzzy, but conservative: a false match hides a lesson the student
 *    attends, which is the worse failure, so the rules prefer "no match" and
 *    let the user flip the switch by hand.
 */

/** Words that describe a level or a group, not a subject. */
const NOISE = /(^| )(יח|יחל|יחידות|יחידה|מוגבר|מורחב|מואץ|מצומצם|רגיל|בסיסי|הקבצה|קבוצה|קב|כיתה|מגמה|מגמת|שכבה|שכבתי)(?= |$)/g;

/** Canonical name → every spelling and abbreviation seen for it. */
const ALIASES: Record<string, string[]> = {
  'חינוך גופני': ['חנג', 'חג', 'ספורט', 'חינוך גופני'],
  'תנך': ['תנך', 'מקרא'],
  'מתמטיקה': ['מתמטיקה', 'מתמ', 'חשבון', 'מתימטיקה'],
  'אנגלית': ['אנגלית', 'אנג'],
  'היסטוריה': ['היסטוריה', 'היסט'],
  'פיזיקה': ['פיזיקה', 'פיז', 'פיסיקה'],
  'לשון': ['לשון', 'עברית', 'לשון והבעה', 'הבעה'],
  'ביולוגיה': ['ביולוגיה', 'ביו'],
  'מדעי המחשב': ['מדעי המחשב', 'מדמח', 'מחשבים', 'תכנות'],
  'גיאוגרפיה': ['גיאוגרפיה', 'גאוגרפיה', 'גיאו'],
  'אמנות': ['אמנות', 'אומנות'],
  'מוזיקה': ['מוזיקה', 'מוסיקה'],
  'תיאטרון': ['תיאטרון', 'תאטרון'],
  'תושבע': ['תושבע', 'תורה שבעל פה'],
  'מחשבת ישראל': ['מחשבת ישראל', 'מחשבת'],
  'שלח': ['שלח', 'שדה לאום חברה'],
  'חינוך': ['חינוך', 'שעת חינוך', 'שיעור חינוך', 'מחנך', 'מחנכת'],
  'עולם הערבים והאסלאם': ['עולם הערבים והאסלאם', 'עולם הערבים והאסלם', 'ערבים ואסלאם'],
};

const KNOWN = new Set(Object.keys(ALIASES));
const CANONICAL = new Map<string, string>();
for (const [canonical, spellings] of Object.entries(ALIASES)) {
  for (const spelling of spellings) CANONICAL.set(spelling, canonical);
}

/** Bracketed remarks: the class group "(יב2)", or the lab "(מעבדת מחשבים 1)". */
const BRACKETS = /\([^)]*\)/g;
/** Study units — "5 יח"ל", "3 יח׳", "5 יחידות" — and level words; they describe the course, not the subject. */
const LEVEL = /(?:^|\s)(?:(?:\d+\s*)?יח(?:["״׳']?ל|ידות|['׳])|מורחב|מוגבר|מואץ|מצומצם)(?![א-ת])/g;

/**
 * A subject as the app shows it (`stripGroup` in app/src/lib/format.ts):
 * "אנגלית 5 יח"ל (יב2)" → "אנגלית", "פיזיקה מורחב (מעבדת פיסיקה)" →
 * "פיזיקה". The bracketed group and the level go; the school's own word
 * stays — "ספורט" is not renamed "חינוך גופני", as `canonicalSubject` would
 * for matching. Quote marks inside a word read as Hebrew ("תנ״ך"). Falls
 * back to the input when nothing would be left.
 */
export function plainSubject(raw: string): string {
  const out = raw
    .replace(BRACKETS, ' ')
    .replace(LEVEL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–·,]+|[\s\-–·,]+$/g, '')
    .trim();
  return hebrewQuotes(out || raw.replace(/\s+/g, ' ').trim());
}

/** "תנ"ך" → "תנ״ך", "מתמ'" → "מתמ׳": an ASCII quote after a Hebrew letter is gershayim or geresh. */
function hebrewQuotes(text: string): string {
  return text.replace(/(?<=[א-ת])"(?=[א-ת])/g, '״').replace(/(?<=[א-ת])'/g, '׳');
}

/** `plainSubject` names, one per subject (`canonicalSubject` decides), in first-seen order. */
export function plainSubjects(raw: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of raw) {
    const key = canonicalSubject(name) || name;
    if (!seen.has(key)) seen.set(key, plainSubject(name));
  }
  return [...seen.values()];
}

/** Exact identity of a published line: whitespace collapsed, quote marks unified. */
export function subjectKey(raw: string): string {
  return raw.replace(/[״"]/g, '"').replace(/[׳']/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Strips everything that is not the subject: quote marks used in abbreviations,
 * level and group words, digits, bracketed remarks.
 */
export function normalizeSubject(raw: string): string {
  return raw
    .replace(/[״׳"'`]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-–—/.,:;·]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Kept answers of `canonicalSubject` and `subjectsMatch`: both are pure, and
 * every day built asks them again for the same few names, for each lesson,
 * homework item and exam. A full one starts again rather than grow.
 */
function remember<V>(kept: Map<string, V>, key: string, value: V): V {
  if (kept.size >= 4096) kept.clear();
  kept.set(key, value);
  return value;
}

const canonical = new Map<string, string>();

/** The alias table's name for a subject, or its normalized form when unlisted. */
export function canonicalSubject(raw: string): string {
  const kept = canonical.get(raw);
  if (kept !== undefined) return kept;
  const norm = normalizeSubject(raw);
  return remember(canonical, raw, CANONICAL.get(norm) ?? norm);
}

/**
 * Whether `raw` is a spelling the alias table lists — a subject for certain,
 * not merely a word that might be one ("ביו", "תנ"ך", "מדעי המחשב").
 */
export function isKnownSubject(raw: string): boolean {
  return CANONICAL.has(normalizeSubject(raw));
}

const GENERIC_FIRST_WORDS = new Set(['מדעי', 'לימודי', 'תולדות', 'שיעור', 'שעת', 'סדנת', 'סדנה', 'מבוא', 'עולם']);

const matches = new Map<string, boolean>();

/** Whether two subject names, from any source, mean the same subject. */
export function subjectsMatch(a: string, b: string): boolean {
  const key = `${a}\u0000${b}`;
  const kept = matches.get(key);
  return kept ?? remember(matches, key, namesMatch(a, b));
}

function namesMatch(a: string, b: string): boolean {
  const ca = canonicalSubject(a);
  const cb = canonicalSubject(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // Two names the alias table both knows, and knows apart — "חינוך" and
  // "חינוך גופני" — are different subjects however much text they share.
  if (KNOWN.has(ca) && KNOWN.has(cb)) return false;
  // "אנגלית" against "אנגלית דוברי" — the shorter name is a whole word of the longer.
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (short.length >= 3 && new RegExp(`(^| )${escapeRe(short)}( |$)`).test(long)) return true;
  // First words agree and are specific ("מדעי המחשב" vs "מדעי הסביבה" fail here).
  const fa = firstWord(ca);
  const fb = firstWord(cb);
  return fa.length >= 4 && fa === fb && !GENERIC_FIRST_WORDS.has(fa);
}

/**
 * Teacher names come as "נקש ירדנה" on the site and, in Mashov, either the
 * same or first-name-first. Sharing one name token of three or more letters is
 * enough to say "same person" once the subject already agrees. Null when either
 * side names nobody — the caller decides what unknown means.
 */
export function teachersMatch(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  const ta = new Set(nameTokens(a));
  for (const t of nameTokens(b)) if (ta.has(t)) return true;
  return false;
}

function nameTokens(name: string): string[] {
  return name
    .replace(/[״׳"'`.,]/g, '')
    .split(/[\s\-–]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export interface MashovGroupLike {
  subject: string | null;
  groupName: string | null;
  teacher: string | null;
}

/**
 * Whether a published Shahaf line has a counterpart in the student's own Mashov
 * groups. The subject must agree; when both sides name a teacher, the teacher
 * must agree too — that is what separates two parallel groups of one subject.
 */
export function lessonInMashov(
  lesson: { subject: string; teacher: string | null },
  groups: readonly MashovGroupLike[],
): boolean {
  return groups.some((g) => {
    const names = [g.subject, g.groupName].filter((n): n is string => Boolean(n));
    if (!names.some((n) => subjectsMatch(lesson.subject, n))) return false;
    return teachersMatch(lesson.teacher, g.teacher) !== false;
  });
}

function firstWord(s: string): string {
  return s.split(' ')[0] ?? '';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
