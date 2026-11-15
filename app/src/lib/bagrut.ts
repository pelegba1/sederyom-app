/**
 * The bagrut tab's arithmetic (plan §14.2–14.4, §15), all pure:
 * - `buildSubjects`: Mashov's questionnaires, one row per sitting, grouped
 *   into subjects, with the table's units, weights and splits
 *   (`lib/bagrutCatalog.ts`), and the owner's own entries on top
 *   (`lib/bagrutStore.ts`): a school grade (הגשה) and an exam grade (בגרות)
 *   for any questionnaire, units, weights, splits, subjects and questionnaires
 *   of their own;
 * - `subjectFinal`, `plainAverage`, `weightedAverage`;
 * - `requiredExamGrade`: "how much do I need", by binary search over 0–100
 *   with the same rounding as the real grade.
 *
 * What the owner enters always wins, and says so in one word: "שינית" over
 * what Mashov or the table says, "משוער" where Mashov has nothing yet and the
 * sitting is ahead, "שלך" where it is behind. Nothing is guessed: a subject
 * missing a unit count or a weight stays out of the average and says what is
 * missing, and the average says how many units it is out of.
 */
import type { BagrutExam, DateStr } from '@sederyom/shared';
import type { BonusRules, InstitutionId } from './bagrutBonus';
import {
  entryLevels, isSchoolAssessed, normalizeHebrew, type Catalog, type CatalogEntry, type CatalogSource,
} from './bagrutCatalog';
import { examDisplayTitle, examKind, type ExamLike, type MashovLink } from './school';

// ---------------------------------------------------------------------------
// The owner's entries (kept on the phone by lib/bagrutStore.ts)

/** A subject's entries that change what the table says, by subject key. */
export interface SubjectOverride {
  units?: number;
  /** Percent of the subject's grade, by questionnaire id; 0 takes it out of the subject. */
  weights?: Record<string, number>;
  /** The school grade's percent of the questionnaire's grade (the split), by id: 100 is school-assessed, 0 the exam alone. */
  shares?: Record<string, number>;
  /** The whole subject out of the average ("לא נספר בממוצע"), or back in. */
  excluded?: boolean;
}

/** A questionnaire's grades as the owner entered them: הגשה (the school's annual grade, the מגן) and בגרות. */
export interface GradeEntry {
  school?: number;
  exam?: number;
}

/** A questionnaire the owner added to a subject: a Ministry code (`id` is its digits), or a name of their own (`id` is `x1`, `x2`…). */
export interface AddedRow {
  id: string;
  /** The owner's name for it; empty for a code. */
  name: string;
}

export interface BagrutPrefs {
  /** By subject key (`Subject.key`). */
  subjects: Record<string, SubjectOverride>;
  /** By questionnaire id (`Questionnaire.id`: the code, or the owner's own id). */
  grades: Record<string, GradeEntry>;
  /** Subjects the owner added ("להוסיף מקצוע"), by key: a catalog id, or `own:{name}`. */
  added: Record<string, { name: string }>;
  /** Questionnaires the owner added ("+ שאלון"), by subject key, in the order added. */
  rows: Record<string, AddedRow[]>;
  institution: InstitutionId | null;
}

export const EMPTY_PREFS: BagrutPrefs = { subjects: {}, grades: {}, added: {}, rows: {}, institution: null };

/** The key of a subject the owner named, where the table has no subject by that name. */
export const OWN_PREFIX = 'own:';

/** A questionnaire id that is a Ministry code. */
export function isCodeId(id: string): boolean {
  return /^\d+$/.test(id);
}

// ---------------------------------------------------------------------------
// The model

/** Where a grade came from. Mashov's own says nothing; the owner's always says which. */
export type GradeOrigin = 'mashov' | 'override' | 'estimate' | 'own';
/** Where a unit count or a weight came from: the table, the owner over the table, or the owner where the table has none. */
export type TableOrigin = 'table' | 'override' | 'own';
/** Where a split came from; `mashov`: Mashov says this student's questionnaire is school-assessed. */
export type ShareOrigin = 'table' | 'mashov' | 'override' | 'own';

/** The words next to a number: always a word, never colour alone. */
export const ORIGIN_WORD = {
  /** "ממשוב", not "משוב": under a grade, alone, Daniel read "משוב" as "feedback" (run 7). */
  mashov: 'ממשוב',
  table: 'טבלה',
  override: 'שינית',
  estimate: 'משוער',
  own: 'שלך',
  added: 'הוספת',
} as const;

export interface GradeValue {
  value: number | null;
  origin: GradeOrigin | null;
}

export interface Questionnaire {
  /** The code as a string, or the owner's own id. */
  id: string;
  semel: number | null;
  /** The table's first column: the code, or the owner's name for it. */
  label: string;
  /** The catalog's short name for a part of the subject: E, F, G, COBE. */
  part: string | null;
  /** Mashov's name without "(הערכה חיצונית)", the subject's, or the owner's: for a screen reader. */
  name: string;
  /** Mashov's rows for it, oldest sitting first. */
  sittings: BagrutExam[];
  /** The sitting its grades are from: the best one, or else the one to come. */
  sitting: BagrutExam | null;
  /** The sitting still to come, or still without a grade. */
  next: BagrutExam | null;
  /** `graded`: Mashov has its grade; `open`: listed, no grade yet; `missing`: the subject's level needs it and nobody lists it; `added`: the owner listed it. */
  status: 'graded' | 'open' | 'missing' | 'added';
  /** No grade yet and the sitting is ahead (or not known): what the owner enters for it is "משוער". */
  future: boolean;
  /** הגשה: the school's annual grade (the מגן). */
  school: GradeValue;
  /** בגרות: the exam. */
  exam: GradeValue;
  /** The school grade's percent of the questionnaire's grade; `null`: not known, worked out 50/50. */
  share: number | null;
  shareOrigin: ShareOrigin | null;
  final: { value: number | null; estimated: boolean };
  /** Percent of the subject's grade. */
  weight: number | null;
  weightOrigin: TableOrigin | null;
  counts: boolean;
  /** The code is in the table. */
  known: boolean;
  source: CatalogSource | null;
  /** The owner added it ("+ שאלון"), so it can be removed. */
  added: boolean;
}

export type FinalResult =
  | { kind: 'ok'; value: number; estimated: boolean }
  /** Nothing in the subject counts. */
  | { kind: 'empty' }
  /** These counted questionnaires have no weight. */
  | { kind: 'unknown'; ids: string[] }
  /** The weights are known but do not add up to 100. */
  | { kind: 'weights'; total: number }
  /** These counted questionnaires have no grade yet. */
  | { kind: 'open'; ids: string[] };

export interface Subject {
  /** The table's subject id, `code:{semel}` for a code it does not know, or `own:{name}` for one the owner named. */
  key: string;
  name: string;
  units: number | null;
  unitsOrigin: TableOrigin | null;
  /** Out of the average: by the table (חינוך תעבורתי) or by the owner. */
  excluded: boolean;
  excludedOrigin: 'table' | 'override' | null;
  questionnaires: Questionnaire[];
  final: FinalResult;
  /** At least one of its codes is in the table. */
  known: boolean;
  /** The owner added it and Mashov does not list it: "הוספת", and it can be removed. */
  added: boolean;
}

// ---------------------------------------------------------------------------
// Grades

/** Half up, as the grade sheets round: 84.5 → 85. The epsilon keeps 0.7 × 85 + 0.3 × 95 at 88. */
export function roundGrade(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}

/** A questionnaire's grade from its school grade and its exam, `schoolShare` percent to the school grade. */
export function questionnaireGrade(schoolGrade: number, examGrade: number, schoolShare: number): number {
  return roundGrade((schoolGrade * schoolShare + examGrade * (100 - schoolShare)) / 100);
}

/**
 * A grade, or `null` for anything off the 0–100 scale: the Ministry reports
 * statuses as grades (333 minimum in math, 666 blocked, 777 integrity, 888
 * withheld, 999 disqualified).
 */
export function realGrade(value: number | null): number | null {
  return value !== null && value >= 0 && value <= 100 ? value : null;
}

/** The split used when nobody knows it. */
export const UNKNOWN_SHARE = 50;

/**
 * A questionnaire's grade from its two parts: the school grade alone when it
 * is school-assessed (`share` 100), the exam alone at 0, else both by
 * `share`. With only the exam in, the exam stands for the whole ("[ ] [90] →
 * 90"); with only the school grade, there is no grade until the exam.
 */
export function combineGrades(school: number | null, exam: number | null, share: number): number | null {
  if (share >= 100) return school;
  if (share <= 0) return exam;
  if (exam === null) return null;
  if (school === null) return exam;
  return questionnaireGrade(school, exam, share);
}

/** Whether `combineGrades` has every part it uses. */
function complete(school: number | null, exam: number | null, share: number): boolean {
  if (share >= 100) return school !== null;
  if (share <= 0) return exam !== null;
  return school !== null && exam !== null;
}

/**
 * One sitting's grade as Mashov has it. Mashov's own final wins whenever it
 * has one: it is the official grade, and it carries what the parts cannot
 * show, such as the Ministry's moderation (1261: 30% of 100 and 70% of 92 is
 * 94, the certificate says 95). Only where Mashov has no final are the parts
 * combined: by the split when it is known and both are in, else at 50/50.
 * The owner's own entries go through `ownerFinal`, never through here.
 */
export function sittingFinal(sitting: BagrutExam, share: number | null): number | null {
  const final = realGrade(sitting.finalGrade);
  if (final !== null) return final;
  const school = realGrade(sitting.schoolGrade);
  const exam = realGrade(sitting.examGrade);
  if (share !== null && complete(school, exam, share)) return combineGrades(school, exam, share);
  return combineGrades(school, exam, share ?? UNKNOWN_SHARE);
}

const OWNER_ORIGINS: ReadonlySet<GradeOrigin | null> = new Set<GradeOrigin | null>(['override', 'estimate', 'own']);

/** The grade the owner's entries make: the parts by the split, `estimated` when a part used is "משוער". */
export function ownerFinal(school: GradeValue, exam: GradeValue, share: number | null): { value: number | null; estimated: boolean } {
  const s = share ?? UNKNOWN_SHARE;
  const value = combineGrades(school.value, exam.value, s);
  if (value === null) return { value, estimated: false };
  const usesSchool = s > 0 && school.value !== null;
  const usesExam = s < 100 && exam.value !== null;
  return { value, estimated: (usesSchool && school.origin === 'estimate') || (usesExam && exam.origin === 'estimate') };
}

/** The grade "how much do I need" moves: the exam, or the school grade of a school-assessed questionnaire. */
function decidingPart(q: Questionnaire): GradeValue {
  return (q.share ?? UNKNOWN_SHARE) >= 100 ? q.school : q.exam;
}

/**
 * A questionnaire the "how much do I need" search fills in: it counts, Mashov
 * has no grade for it, and its deciding grade is empty or "משוער" — not one
 * the owner says they already have.
 */
export function isVariable(q: Questionnaire): boolean {
  if (!q.counts || q.status === 'graded') return false;
  const part = decidingPart(q);
  return part.origin === null || part.origin === 'estimate';
}

/** A questionnaire's grade; with `uniform`, that grade in place of its deciding one when it `isVariable`. */
export function questionnaireFinal(q: Questionnaire, uniform?: number): { value: number | null; estimated: boolean } {
  if (uniform === undefined || !isVariable(q)) return q.final;
  const share = q.share ?? UNKNOWN_SHARE;
  if (share >= 100) return { value: uniform, estimated: true };
  return { value: combineGrades(q.school.value, uniform, share), estimated: true };
}

/** The subject's grade: its counted questionnaires by weight, rounded like the real one. */
export function subjectFinal(questionnaires: readonly Questionnaire[], uniform?: number): FinalResult {
  const counted = questionnaires.filter((q) => q.counts);
  if (counted.length === 0) return { kind: 'empty' };
  const unknown = counted.filter((q) => q.weight === null).map((q) => q.id);
  if (unknown.length > 0) return { kind: 'unknown', ids: unknown };
  const total = counted.reduce((sum, q) => sum + (q.weight ?? 0), 0);
  if (Math.abs(total - 100) > 0.01) return { kind: 'weights', total };
  const parts = counted.map((q) => ({ q, ...questionnaireFinal(q, uniform) }));
  const open = parts.filter((p) => p.value === null).map((p) => p.q.id);
  if (open.length > 0) return { kind: 'open', ids: open };
  const sum = parts.reduce((acc, p) => acc + (p.value ?? 0) * (p.q.weight ?? 0), 0);
  return { kind: 'ok', value: roundGrade(sum / 100), estimated: parts.some((p) => p.estimated) };
}

// ---------------------------------------------------------------------------
// From Mashov to subjects

const METHOD_SUFFIX = /\s*\((?:הערכה|היבחנות)[^)]*\)\s*$/;

/** "תנ"ך - כללי (הערכה חיצונית)" → "תנ״ך - כללי". */
export function cleanName(name: string): string {
  return normalizeHebrew(name.replace(METHOD_SUFFIX, ''));
}

/** The table's subject whose name a Mashov name begins with (the longest such), for a code the table does not know. */
export function matchSubject(name: string, catalog: Catalog): string | null {
  const clean = cleanName(name);
  let best: { id: string; length: number } | null = null;
  for (const subject of Object.values(catalog.subjects)) {
    for (const alias of [subject.name, ...subject.aliases]) {
      const a = normalizeHebrew(alias);
      if (a && clean.startsWith(a) && (!best || a.length > best.length)) best = { id: subject.id, length: a.length };
    }
  }
  return best?.id ?? null;
}

/**
 * The key for a subject the owner names: the table's subject called exactly
 * that ("ערבית"), so Mashov's rows for it join it later; else `own:{name}`.
 * Exactly, not by its start: "היסטוריה של האמנות" is not history.
 */
export function subjectKeyFor(name: string, catalog: Catalog): string {
  const clean = normalizeHebrew(name);
  for (const subject of Object.values(catalog.subjects)) {
    if ([subject.name, ...subject.aliases].some((a) => normalizeHebrew(a) === clean)) return subject.id;
  }
  return `${OWN_PREFIX}${clean}`;
}

/** Whether Mashov's name for a subject is the one the owner typed: the same, or it followed by more words. */
function namesMatch(mashov: string, owner: string): boolean {
  const m = normalizeHebrew(mashov);
  const o = normalizeHebrew(owner);
  return m === o || (m.startsWith(o) && /^[\s\-–]/.test(m.slice(o.length)));
}

/**
 * The one level all of a subject's known codes belong to, or `null` — also
 * when they fit more than one: 35571 alone is 3, 4 or 5 units, and only the
 * owner knows which.
 */
function tableUnits(entries: readonly (CatalogEntry | null)[]): number | null {
  let common: Set<number> | null = null;
  for (const e of entries) {
    const levels = e ? entryLevels(e) : [];
    if (levels.length === 0) continue;
    common = common === null ? new Set(levels) : new Set(levels.filter((u) => common!.has(u)));
  }
  return common !== null && common.size === 1 ? [...common][0]! : null;
}

/**
 * The codes a subject still needs at `units` that nobody lists: those every
 * set of the level that fits the listed codes asks for. Physics with only
 * mechanics fits three tracks that share nothing else, so none.
 */
export function missingCodes(listed: readonly number[], units: number, catalog: Catalog, subject: string): number[] {
  const sets = catalog.subjects[subject]?.levels[units] ?? [];
  const atLevel = listed.filter((c) => catalog.entries[c]?.weights[units] !== undefined);
  const fitting = sets.filter((set) => atLevel.every((c) => set.includes(c)));
  if (fitting.length === 0) return [];
  return fitting[0]!.filter((c) => !listed.includes(c) && fitting.every((set) => set.includes(c)));
}

/**
 * A value the owner may change: unchanged, it is the base's (`baseOrigin`,
 * or nothing); changed, it is "override" over a base, "own" where there is
 * none. Entering the base's own value changes nothing.
 */
function layered<B extends string>(stored: number | undefined, base: number | null, baseOrigin: B): { value: number | null; origin: B | 'override' | 'own' | null } {
  if (stored === undefined) return { value: base, origin: base === null ? null : baseOrigin };
  if (base === null) return { value: stored, origin: 'own' };
  return { value: stored, origin: stored === base ? baseOrigin : 'override' };
}

/** A grade: Mashov's, the owner's over it ("שינית"), or the owner's where Mashov has none ("משוער" ahead, "שלך" behind). */
function gradeValue(stored: number | undefined, mashov: number | null, future: boolean): GradeValue {
  if (stored === undefined) return { value: mashov, origin: mashov === null ? null : 'mashov' };
  if (mashov !== null) return { value: stored, origin: stored === mashov ? 'mashov' : 'override' };
  return { value: stored, origin: future ? 'estimate' : 'own' };
}

/**
 * The part of its subject a questionnaire is, where Mashov's name says it
 * unclearly ("אנגלית-דבו' והב' הנש"): the English modules, as the
 * inspectorate's 5-unit handbook names them (`ENGLISH_5` in bagrutCatalog).
 */
const BAGRUT_PARTS: Readonly<Record<number, { title: string; short: string }>> = {
  16471: { title: 'מודול E', short: 'E' },
  16583: { title: 'מודול F', short: 'F' },
  16582: { title: 'מודול G', short: 'G' },
  16586: { title: 'בעל פה (COBE)', short: 'COBE' },
};

interface QuestionnaireInput {
  id: string;
  rows: readonly BagrutExam[];
  entry: CatalogEntry | null;
  /** The owner's name for a questionnaire of their own. */
  ownName: string;
  subjectName: string;
  units: number | null;
  override: SubjectOverride;
  grades: GradeEntry;
  added: boolean;
  /** The table says the school alone grades it. */
  schoolAssessed: boolean;
  today: DateStr;
}

function buildQuestionnaire(input: QuestionnaireInput): Questionnaire {
  const { id, entry, override, today } = input;
  const semel = isCodeId(id) ? Number(id) : null;
  const sittings = [...input.rows].sort((a, b) => a.moed.localeCompare(b.moed));

  // The split: the owner's; else Mashov's word that this student's questionnaire is school-assessed; else the table's.
  const methodSchool = sittings.length > 0 && sittings[sittings.length - 1]!.method === 'school';
  const tableShare = entry?.schoolShare ?? (input.schoolAssessed ? 100 : null);
  const share = layered<'table' | 'mashov'>(
    override.shares?.[id], methodSchool ? 100 : tableShare, methodSchool ? 'mashov' : 'table',
  );

  // The best sitting is the one that counts; with none graded, the one to come.
  let best: number | null = null;
  let graded: BagrutExam | null = null;
  for (const s of sittings) {
    const f = sittingFinal(s, share.value);
    if (f !== null && (best === null || f >= best)) {
      best = f;
      graded = s;
    }
  }
  const pending = sittings.filter((s) => sittingFinal(s, share.value) === null);
  const next = pending.find((s) => s.examDate === null || s.examDate >= today) ?? (best === null ? pending[pending.length - 1] ?? null : null);
  const sitting = graded ?? next ?? sittings[sittings.length - 1] ?? null;
  const status = best !== null ? 'graded' : sittings.length > 0 ? 'open' : input.added ? 'added' : 'missing';
  const future = status !== 'graded' && (next === null || next.examDate === null || next.examDate >= today);

  const school = gradeValue(input.grades.school, realGrade(sitting?.schoolGrade ?? null), future);
  const exam = gradeValue(input.grades.exam, realGrade(sitting?.examGrade ?? null), future);
  const touched = OWNER_ORIGINS.has(school.origin) || OWNER_ORIGINS.has(exam.origin);
  const final = touched ? ownerFinal(school, exam, share.value) : { value: best, estimated: false };

  // The table's weight is for one level: it waits for the subject's units.
  const tableWeight = input.units !== null ? entry?.weights[input.units] ?? null : null;
  const storedWeight = override.weights?.[id];
  const weight = layered(storedWeight, tableWeight, 'table' as const);
  const part = semel !== null ? BAGRUT_PARTS[semel] ?? null : null;

  return {
    id,
    semel,
    label: semel !== null ? id : input.ownName,
    part: part?.short ?? null,
    name: sittings[0] ? cleanName(sittings[0].name) : input.ownName || input.subjectName,
    sittings,
    sitting,
    next,
    status,
    future,
    school,
    exam,
    share: share.value,
    shareOrigin: share.origin,
    final,
    weight: weight.value,
    weightOrigin: weight.origin,
    // A weight the owner entered decides; 0 takes it out of the subject.
    counts: storedWeight !== undefined ? storedWeight > 0 : entry?.counts ?? true,
    known: entry !== null,
    source: entry?.source ?? null,
    added: input.added,
  };
}

/** Numeric ids first, by code; the owner's own after them, in the order added. */
function byId(a: string, b: string): number {
  const ca = isCodeId(a);
  const cb = isCodeId(b);
  if (ca && cb) return Number(a) - Number(b);
  return ca ? -1 : cb ? 1 : 0;
}

/**
 * Mashov's rows and the owner's own subjects and questionnaires as subjects:
 * Mashov's order, the owner's after them, the ones out of the average last.
 * A subject the owner added that Mashov lists later is one subject, with
 * Mashov's grades and the owner's entries on top; a code both list is one
 * row. `today` decides which sittings are still to come.
 */
export function buildSubjects(exams: readonly BagrutExam[], prefs: BagrutPrefs, catalog: Catalog, today: DateStr): Subject[] {
  const bySemel = new Map<number, BagrutExam[]>();
  for (const exam of exams) {
    const rows = bySemel.get(exam.semel);
    if (rows) rows.push(exam);
    else bySemel.set(exam.semel, [exam]);
  }

  const groups: { key: string; name: string; semels: number[] }[] = [];
  for (const [semel, rows] of bySemel) {
    const entry = catalog.entries[semel] ?? null;
    const key = entry?.subject ?? matchSubject(rows[0]!.name, catalog) ?? `code:${semel}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.semels.push(semel);
    else groups.push({ key, name: catalog.subjects[key]?.name ?? cleanName(rows[0]!.name), semels: [semel] });
  }

  // The owner's subjects: one Mashov lists under a name the table does not know takes the owner's key and name.
  for (const [key, added] of Object.entries(prefs.added)) {
    if (groups.some((g) => g.key === key)) continue;
    const named = key.startsWith(OWN_PREFIX) ? groups.find((g) => g.key.startsWith('code:') && namesMatch(g.name, added.name)) : undefined;
    if (named) {
      named.key = key;
      named.name = added.name;
    } else {
      groups.push({ key, name: catalog.subjects[key]?.name ?? added.name, semels: [] });
    }
  }

  const subjects: Subject[] = [];
  for (const group of groups) {
    const { key } = group;
    const override = prefs.subjects[key] ?? {};
    // A code Mashov lists anywhere is Mashov's row, not a second one.
    const rows = (prefs.rows[key] ?? []).filter((r) => !(isCodeId(r.id) && bySemel.has(Number(r.id))));
    const rowIds = new Set(rows.map((r) => r.id));
    const listed = [...group.semels, ...rows.filter((r) => isCodeId(r.id)).map((r) => Number(r.id))];
    const present = listed.map((s) => catalog.entries[s] ?? null);
    const units = layered(override.units, tableUnits(present), 'table' as const);
    // A code of the subject's level that nobody lists yet: the subject is incomplete.
    const missing = units.value !== null ? missingCodes(listed, units.value, catalog, key) : [];
    const ids = [...listed.map(String), ...missing.map(String)].sort(byId);
    const ownRows = rows.filter((r) => !isCodeId(r.id));
    const questionnaires = [...ids, ...ownRows.map((r) => r.id)].map((id) => buildQuestionnaire({
      id,
      rows: isCodeId(id) ? bySemel.get(Number(id)) ?? [] : [],
      entry: isCodeId(id) ? catalog.entries[Number(id)] ?? null : null,
      ownName: ownRows.find((r) => r.id === id)?.name ?? '',
      subjectName: group.name,
      units: units.value,
      override,
      grades: prefs.grades[id] ?? {},
      added: rowIds.has(id),
      schoolAssessed: isCodeId(id) && isSchoolAssessed(Number(id), catalog),
      today,
    }));
    const tableExcluded = present.length > 0 && present.every((e) => e !== null && !e.counts);
    const excluded = override.excluded ?? tableExcluded;
    subjects.push({
      key,
      name: group.name,
      units: units.value,
      unitsOrigin: units.origin,
      excluded,
      excludedOrigin: excluded !== tableExcluded ? 'override' : tableExcluded ? 'table' : null,
      questionnaires,
      final: subjectFinal(questionnaires),
      known: present.some((e) => e !== null),
      added: key in prefs.added && group.semels.length === 0,
    });
  }
  return [...subjects.filter((s) => !s.excluded), ...subjects.filter((s) => s.excluded)];
}

// ---------------------------------------------------------------------------
// What the owner changed, for the ways back

export type GradeField = 'school' | 'exam';

/** The grades in a subject that change what Mashov says: "לחזור למשוב" takes them back. */
export function changedGrades(subject: Subject): { id: string; field: GradeField }[] {
  const out: { id: string; field: GradeField }[] = [];
  for (const q of subject.questionnaires) {
    if (q.school.origin === 'override') out.push({ id: q.id, field: 'school' });
    if (q.exam.origin === 'override') out.push({ id: q.id, field: 'exam' });
  }
  return out;
}

/** Every "משוער" grade, for "לנקות את המשוערים". */
export function estimatedGrades(subjects: readonly Subject[]): { id: string; field: GradeField }[] {
  const out: { id: string; field: GradeField }[] = [];
  for (const q of subjects.flatMap((s) => s.questionnaires)) {
    if (q.school.origin === 'estimate') out.push({ id: q.id, field: 'school' });
    if (q.exam.origin === 'estimate') out.push({ id: q.id, field: 'exam' });
  }
  return out;
}

/** What "לחזור לטבלה" takes back in a subject: what the owner changed over the table; `null` when nothing. */
export interface TableChanges {
  units: boolean;
  excluded: boolean;
  weights: string[];
  shares: string[];
}

export function tableChanges(subject: Subject): TableChanges | null {
  const changes: TableChanges = {
    units: subject.unitsOrigin === 'override',
    excluded: subject.excludedOrigin === 'override',
    weights: subject.questionnaires.filter((q) => q.weightOrigin === 'override').map((q) => q.id),
    shares: subject.questionnaires.filter((q) => q.shareOrigin === 'override').map((q) => q.id),
  };
  const any = changes.units || changes.excluded || changes.weights.length > 0 || changes.shares.length > 0;
  return any ? changes : null;
}

// ---------------------------------------------------------------------------
// Adding a subject

/** A subject of the table the owner can add: not already shown, and a bagrut subject (not חינוך תעבורתי). */
export function addableSubjects(catalog: Catalog, shown: ReadonlySet<string>): { id: string; name: string }[] {
  const entries = Object.values(catalog.entries);
  return Object.values(catalog.subjects)
    .filter((s) => !shown.has(s.id))
    .filter((s) => {
      const own = entries.filter((e) => e.subject === s.id);
      return own.length === 0 || own.some((e) => e.counts);
    })
    .map((s) => ({ id: s.id, name: s.name }));
}

/** The units a table subject comes in, and at each the sets of questionnaires it may be made of. */
export function subjectLevels(catalog: Catalog, id: string): { units: number; sets: readonly (readonly number[])[] }[] {
  const levels = catalog.subjects[id]?.levels ?? {};
  return Object.keys(levels).map(Number).sort((a, b) => a - b).map((units) => ({ units, sets: levels[units] ?? [] }));
}

// ---------------------------------------------------------------------------
// Averages

export interface AverageResult {
  /** `null` while no subject has both a grade and its units. */
  value: number | null;
  /** Units in the average. */
  units: number;
  /** Units of every subject that counts and has a known unit count. */
  totalUnits: number;
  /** Subjects that count but are not in the average yet. */
  missing: number;
  /** A grade in it rests on an estimate. */
  estimated: boolean;
}

/** What the averages read of a subject: `bagrut-bonus.test.cjs` builds these by hand. */
type Averageable = Pick<Subject, 'key' | 'units' | 'excluded' | 'final'>;
type Ready = Averageable & { units: number; final: { kind: 'ok'; value: number; estimated: boolean } };

/** Subjects in the average: those that count and have both a grade and units. */
function averageable(subjects: readonly Averageable[]): { ready: Ready[]; totalUnits: number; missing: number } {
  const ready: Ready[] = [];
  let totalUnits = 0;
  let missing = 0;
  for (const s of subjects) {
    if (s.excluded) continue;
    if (s.units !== null && s.units > 0) totalUnits += s.units;
    if (s.final.kind !== 'ok' || s.units === null || s.units <= 0) {
      missing += 1;
      continue;
    }
    ready.push(s as Ready);
  }
  return { ready, totalUnits, missing };
}

/** Σ(grade × units) / Σunits over the subjects that count and have both. */
export function plainAverage(subjects: readonly Averageable[]): AverageResult {
  const { ready, totalUnits, missing } = averageable(subjects);
  const units = ready.reduce((sum, s) => sum + s.units, 0);
  const sum = ready.reduce((acc, s) => acc + s.final.value * s.units, 0);
  return { value: units > 0 ? sum / units : null, units, totalUnits, missing, estimated: ready.some((s) => s.final.estimated) };
}

/** The Technion's combination: math at its level, and two sciences or a science and a technology subject at theirs. */
export function comboApplies(subjects: readonly { key: string; units: number | null }[], rules: BonusRules): boolean {
  const combo = rules.combo;
  if (!combo) return false;
  const at = (keys: readonly string[], units: number): number => subjects.filter((s) => keys.includes(s.key) && (s.units ?? 0) >= units).length;
  const sciences = at(combo.sciences, combo.units);
  return at(['math'], combo.mathUnits) > 0 && sciences >= 1 && sciences + at(combo.technology, combo.units) >= 2;
}

/**
 * The points a subject's grade gets under `rules`: the first rule that fits
 * its subject and units, the combination bonus where it applies, nothing
 * under the minimum grade. `null`: the institution does not say.
 */
export function bonusFor(subjectKey: string, units: number, grade: number, rules: BonusRules, combo = false): number | null {
  const passes = rules.minGradeExclusive ? grade > rules.minGrade : grade >= rules.minGrade;
  if (!passes) return 0;
  const rule = rules.bonuses.find((r) => units >= r.units && (r.subjects === 'any' || r.subjects.includes(subjectKey)));
  let bonus = rule ? rule.bonus : 0;
  const c = rules.combo;
  if (combo && c && units >= c.units && (c.sciences.includes(subjectKey) || c.technology.includes(subjectKey))) {
    bonus = Math.max(bonus ?? 0, c.bonus);
  }
  return bonus;
}

interface Weighed {
  units: number;
  /** Units times the institution's factor. */
  weight: number;
  value: number;
  estimated: boolean;
  compulsory: boolean;
}

/** The subsets of electives tried one by one up to this many; past it, best first. */
const MAX_EXHAUSTIVE = 16;

/**
 * The electives that give the highest average with the compulsory subjects,
 * keeping at least `minUnits` (all of them when even that is short of it).
 * A subject is in or out whole.
 */
function bestSelection(items: readonly Weighed[], minUnits: number): Weighed[] {
  const must = items.filter((i) => i.compulsory);
  const optional = items.filter((i) => !i.compulsory);
  const allUnits = items.reduce((s, i) => s + i.units, 0);
  if (allUnits < minUnits) return [...items];
  const score = (set: readonly Weighed[]): number => {
    const w = set.reduce((s, i) => s + i.weight, 0);
    return w > 0 ? set.reduce((s, i) => s + i.value * i.weight, 0) / w : -Infinity;
  };
  const units = (set: readonly Weighed[]): number => set.reduce((s, i) => s + i.units, 0);
  if (optional.length <= MAX_EXHAUSTIVE) {
    let best: Weighed[] | null = null;
    let bestScore = -Infinity;
    for (let mask = 0; mask < 1 << optional.length; mask++) {
      const set = [...must, ...optional.filter((_, i) => mask & (1 << i))];
      if (units(set) < minUnits) continue;
      const sc = score(set);
      if (sc > bestScore + 1e-12) {
        best = set;
        bestScore = sc;
      }
    }
    return best ?? [...items];
  }
  // Best first: take electives while short of the minimum, or while one raises the average.
  const set = [...must];
  for (const item of [...optional].sort((a, b) => b.value - a.value)) {
    if (units(set) < minUnits || item.value > score(set)) set.push(item);
  }
  return set;
}

/**
 * An institution's average: each grade with its bonus, the units weighed as
 * it weighs them, the compulsory subjects always and the others only when
 * they raise it (at least `minUnits` kept), and its cap. A subject whose
 * bonus the institution does not state stays out and counts as missing.
 */
export function weightedAverage(subjects: readonly Averageable[], rules: BonusRules): AverageResult {
  const { ready, totalUnits, missing: notReady } = averageable(subjects);
  const combo = comboApplies(ready, rules);
  let missing = notReady;
  const items: Weighed[] = [];
  for (const s of ready) {
    const bonus = bonusFor(s.key, s.units, s.final.value, rules, combo);
    if (bonus === null) {
      missing += 1;
      continue;
    }
    items.push({
      units: s.units,
      weight: s.units * (rules.unitFactor?.[s.key] ?? 1),
      value: s.final.value + bonus,
      estimated: s.final.estimated,
      compulsory: rules.compulsory === null || rules.compulsory.includes(s.key),
    });
  }
  const chosen = rules.compulsory === null ? items : bestSelection(items, rules.minUnits);
  const weight = chosen.reduce((sum, i) => sum + i.weight, 0);
  const raw = weight > 0 ? chosen.reduce((sum, i) => sum + i.value * i.weight, 0) / weight : null;
  const value = raw === null ? null : rules.averageCap === null ? raw : Math.min(raw, rules.averageCap);
  return {
    value,
    units: chosen.reduce((sum, i) => sum + i.units, 0),
    totalUnits,
    missing,
    estimated: chosen.some((i) => i.estimated),
  };
}

// ---------------------------------------------------------------------------
// "How much do I need"

export type Goal =
  | { kind: 'subject'; key: string }
  | { kind: 'plain' }
  | { kind: 'weighted'; rules: BonusRules };

export type Need =
  /** Met whatever the open questionnaires get. */
  | { kind: 'reached' }
  /** At least `grade` in every one of `labels`; `exam`: it is the exam's grade in all of them. */
  | { kind: 'need'; grade: number; labels: string[]; exam: boolean }
  /** Out of reach: `best` is where 100 in all of them gets. */
  | { kind: 'impossible'; best: number }
  /** A unit count or a weight is missing, so there is nothing to work it out from. */
  | { kind: 'unknown' };

/** Every subject's grade with each open questionnaire at `uniform` (or as it is when `undefined`). */
function withUniform(subjects: readonly Subject[], uniform: number | undefined): Subject[] {
  return subjects.map((s) => ({ ...s, final: subjectFinal(s.questionnaires, uniform) }));
}

function goalValue(goal: Goal, subjects: readonly Subject[], uniform?: number): number | null {
  if (goal.kind === 'subject') {
    const subject = subjects.find((s) => s.key === goal.key);
    if (!subject) return null;
    const final = subjectFinal(subject.questionnaires, uniform);
    return final.kind === 'ok' ? final.value : null;
  }
  const all = withUniform(subjects, uniform);
  return (goal.kind === 'plain' ? plainAverage(all) : weightedAverage(all, goal.rules)).value;
}

/**
 * The questionnaires the goal's answer is about: those `isVariable`, in a
 * subject whose grade 100 in all of them would settle. A grade the owner
 * entered as their own is not one of them, so the answer shrinks to the
 * rows still empty or "משוער".
 */
function openFor(goal: Goal, subjects: readonly Subject[]): Questionnaire[] {
  const scope = goal.kind === 'subject'
    ? subjects.filter((s) => s.key === goal.key)
    : subjects.filter((s) => !s.excluded && s.units !== null && s.units > 0);
  return scope
    .filter((s) => subjectFinal(s.questionnaires, 100).kind === 'ok')
    .flatMap((s) => s.questionnaires.filter(isVariable));
}

const EPSILON = 1e-9;

/**
 * The lowest grade that, given in every open questionnaire alike, reaches
 * `target` — a subject's grade, the plain average or an institution's.
 * Binary search over 0–100: every grade on the way is rounded as the real
 * one is, so the answer is a grade that really gets there.
 */
export function requiredExamGrade(target: number, goal: Goal, subjects: readonly Subject[]): Need {
  const open = openFor(goal, subjects);
  if (open.length === 0) {
    const now = goalValue(goal, subjects);
    if (now === null) return { kind: 'unknown' };
    return now >= target - EPSILON ? { kind: 'reached' } : { kind: 'impossible', best: now };
  }
  const top = goalValue(goal, subjects, 100);
  if (top === null) return { kind: 'unknown' };
  if (top < target - EPSILON) return { kind: 'impossible', best: top };
  const bottom = goalValue(goal, subjects, 0);
  if (bottom !== null && bottom >= target - EPSILON) return { kind: 'reached' };
  let lo = 0;
  let hi = 100;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const v = goalValue(goal, subjects, mid);
    if (v !== null && v >= target - EPSILON) hi = mid;
    else lo = mid;
  }
  // "בבחינה": the exam, next to a school grade that is already in.
  const exam = open.every((q) => (q.share ?? UNKNOWN_SHARE) < 100 && q.school.value !== null);
  return { kind: 'need', grade: hi, labels: open.map((q) => q.label), exam };
}

// ---------------------------------------------------------------------------
// Words

/** A line with numbers in it: the strings as they are, `{ ltr }` through `Ltr`. */
export type Parts = (string | { ltr: string })[];

export function partsText(parts: Parts): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.ltr)).join('');
}

/** "96.4", "112.35": two decimals at most, none when whole. */
export function formatAverage(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/**
 * The units under the average: "16 יח״ל", or "11 מתוך 25 יח״ל" while some
 * subjects are not in it (plan §16.2: "מתוך 11 מ־25 יח״ל" read backwards).
 */
export function averageUnitsParts(avg: AverageResult): Parts {
  if (avg.totalUnits > avg.units) return [{ ltr: String(avg.units) }, ' מתוך ', { ltr: String(avg.totalUnits) }, ' יח״ל'];
  return [{ ltr: String(avg.units) }, ' יח״ל'];
}

/**
 * The one mark for "nothing here" in the bagrut table, the averages and the
 * weights sheets (plan §16): an en dash, drawn in `textFaint`. The table had
 * three (a thin dash, a heavy one, and a blank).
 */
export const EMPTY_MARK = '–';

/** A questionnaire's label in a line: a code through `Ltr`, a name as it is. */
function labelPart(label: string): string | { ltr: string } {
  return isCodeId(label) ? { ltr: label } : label;
}

/**
 * The one line a "how much do I need" answers with. Out of reach, it says
 * how high one can get — "הכי גבוה שאפשר: 88.1" — not that the goal is
 * impossible (run 7: Noa read "היעד לא אפשרי" as harsh).
 */
export function needParts(need: Need): Parts {
  switch (need.kind) {
    case 'reached':
      return ['היעד כבר הושג'];
    case 'unknown':
      return ['חסרים יח״ל או משקל כדי לחשב'];
    case 'impossible':
      return ['הכי גבוה שאפשר: ', { ltr: formatAverage(need.best) }];
    case 'need': {
      const what = need.exam ? 'בבחינה ' : '';
      if (need.labels.length === 1) {
        return ['צריך לפחות ', { ltr: String(need.grade) }, ` ${what}בשאלון `, labelPart(need.labels[0]!)];
      }
      return ['צריך לפחות ', { ltr: String(need.grade) }, ` ${what}בכל `, { ltr: String(need.labels.length) }, ' השאלונים הפתוחים'];
    }
  }
}

/** The word under a grade the owner entered; `null` for Mashov's own. */
export function gradeWord(origin: GradeOrigin | null): string | null {
  if (origin === 'override') return ORIGIN_WORD.override;
  if (origin === 'estimate') return ORIGIN_WORD.estimate;
  if (origin === 'own') return ORIGIN_WORD.own;
  return null;
}

/** The questionnaire code in a bagrut exam's key, `bagrut|{semel}|{moed}`; `null` for any other key. */
export function bagrutSemel(naturalKey: string): number | null {
  const m = /^bagrut\|(\d+)\|/.exec(naturalKey);
  return m ? Number(m[1]) : null;
}

/**
 * A bagrut exam's name where the table knows its code: "בגרות באנגלית,
 * מודול G", "בגרות באנגלית, בעל פה (COBE)", "בגרות במתמטיקה, שאלון 35571"
 * (a comma, no "·": the Wave 9 re-rate)
 * — not Mashov's "אנגלית ז - G (הערכה חיצונית)" (run 7: Noa could not tell
 * her English bagruts apart). Mashov's name stays in the exam sheet's
 * details. `null` for an exam that is not a bagrut one, a code the table does
 * not know, or a questionnaire that is not a bagrut exam at all (חינוך
 * תעבורתי): then the exam keeps the name it has.
 *
 * `subjectName` is the name the student gave the subject (`Exam.subjectName`):
 * it stands for the subject's name in the title, "בגרות בEnglish, מודול G";
 * the part's title is the table's and stays.
 */
export function bagrutExamTitle(exam: { naturalKey: string }, catalog: Catalog, subjectName?: string): string | null {
  const semel = bagrutSemel(exam.naturalKey);
  if (semel === null) return null;
  const entry = catalog.entries[semel];
  const subject = entry ? catalog.subjects[entry.subject] : undefined;
  if (!entry || !entry.counts || !subject) return null;
  return `בגרות ב${subjectName ?? subject.name}, ${BAGRUT_PARTS[semel]?.title ?? `שאלון ${semel}`}`;
}

/** An exam's name, and the kind line under it. */
export interface ExamNaming {
  title: string;
  /** "בחינת בגרות, 14:00–15:45", for a bagrut exam the table cannot name. */
  kind: { label: string; time: string | null } | null;
  /** A named bagrut exam's own hours, "14:00–15:45", for the date's line. */
  hours: string | null;
}

/**
 * An exam's name on a card, a row or the sheet's title, and the "בחינת
 * בגרות · 14:00–15:45" line under it (`examKind`). A bagrut exam the table
 * knows is named for what it is (`bagrutExamTitle`), so that line would only
 * say "בגרות" again: its hours go on the date's line instead. Any other exam
 * keeps the site's title (`examDisplayTitle`), and a bagrut exam the table
 * does not know keeps the line. An exam the student gave a name of its own
 * (`originalSubject` and no `subjectName`) is named their way, a bagrut one
 * with its line. A name given to its subject (`subjectName`) is no name of
 * the exam's own: the table still names it, with the subject's name in it.
 */
export function examNaming(
  exam: Pick<ExamLike, 'naturalKey' | 'subject' | 'originalSubject' | 'subjectName' | 'kind' | 'startTime' | 'endTime'>,
  catalog: Catalog,
): ExamNaming {
  const kind = examKind(exam);
  const ownName = exam.originalSubject !== undefined && exam.subjectName === undefined;
  const named = kind && !ownName ? bagrutExamTitle(exam, catalog, exam.subjectName) : null;
  if (named) return { title: named, kind: null, hours: kind?.time ?? null };
  return { title: examDisplayTitle(exam.subject), kind, hours: null };
}

/** "21.1.2027" — a date of Mashov's, as the app writes dates. */
function dateLabel(date: DateStr): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

/** "21.1.2027 14:00" — the date of a sitting to come, with its hour when known. */
export function sittingWhen(sitting: BagrutExam): string | null {
  if (!sitting.examDate) return null;
  const date = dateLabel(sitting.examDate);
  return sitting.startTime ? `${date} ${sitting.startTime}` : date;
}

/** Under a questionnaire's code: the date of its sitting to come, "21.1.2027"; `null` once it has a grade or the date is past. */
export function upcomingDate(q: Questionnaire, today: DateStr): string | null {
  const date = q.status !== 'graded' ? q.next?.examDate ?? null : null;
  return date !== null && date >= today ? dateLabel(date) : null;
}

/** The one short line a subject's card says when its grade cannot be worked out, or `null`. */
export function subjectGap(subject: Subject): Parts | null {
  if (subject.excluded) return ['לא נספר בממוצע'];
  if (subject.units === null) return ['חסר יח״ל'];
  const f = subject.final;
  if (f.kind === 'unknown') return ['חסר משקל'];
  if (f.kind === 'weights') return ['המשקלים: ', { ltr: `${formatAverage(f.total)}%` }, ' מ־', { ltr: '100%' }];
  if (f.kind === 'empty') return ['אין שאלונים שנספרים'];
  return null;
}

/** The empty tab while Mashov is not connected: one line, the way to connect under it. */
export function disconnectedLine(link: MashovLink): string {
  const why = !link.connected && link.reason === 'needs_reauth' ? 'משוב ניתק את החיבור' : 'משוב לא מחובר';
  return `${why}, לכן אין כאן ציוני בגרות`;
}

/**
 * The tab with nothing in it yet, in one line that says when there will be
 * something (run 7: Maya, in 9th grade, did not know what a bagrut is or when
 * it comes).
 */
export const NO_BAGRUT_YET = 'ציוני בגרות יופיעו כאן אחרי הבחינה הראשונה, בדרך כלל מכיתה י׳';
