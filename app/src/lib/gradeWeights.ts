/**
 * Weights for regular grades (plan §15, W8). The owner: "אי אפשר לקבוע
 * משקלים בציונים רגילים", and asked for weights "לפי סוג, ואפשר לשנות ציון
 * בודד": per subject, a percent for each type of assessment (מבחנים 60%,
 * בוחנים 20%, עבודות 20%), and a weight of its own for any single grade.
 *
 * Mashov sends no type and, at this school, no weight (`weight: 0`), so:
 * - the type is guessed from the assessment's name (`guessType`), and the
 *   owner can change it;
 * - a positive Mashov weight is Mashov's own percent of the subject, and
 *   counts like a weight the owner set on that grade.
 *
 * The average (`subjectAverage`):
 * - a grade with a weight of its own counts with exactly that weight;
 * - the types share what is left, each by the plain mean of its grades,
 *   in proportion to their percents — over the types that have grades, so a
 *   set that does not add up to 100 (or a type with no grades yet) is
 *   normalised rather than counted as zero;
 * - types whose grades all sit at 0% (only "אחר", say) share it equally, so a
 *   subject with grades always has an average.
 *
 * Pure: the store (`gradeWeightsStore.ts`) and the grades tab share it.
 */
import { stripGroup } from './format';

/** The four types every subject has; the owner may add more of their own. */
export type BuiltinTypeId = 'exam' | 'quiz' | 'work' | 'other';

export interface GradeType {
  /** `exam`, `quiz`, `work`, `other`, or `c1`, `c2`… for one the owner added. */
  id: string;
  /** "מבחן" — one word, as a grade row shows it. */
  label: string;
  /** Its percent of the subject's grade, 0–100. */
  percent: number;
}

/** The default set (the owner's example): מבחן 60, בוחן 20, עבודה 20, אחר 0. */
export const DEFAULT_TYPES: readonly GradeType[] = Object.freeze([
  Object.freeze({ id: 'exam', label: 'מבחן', percent: 60 }),
  Object.freeze({ id: 'quiz', label: 'בוחן', percent: 20 }),
  Object.freeze({ id: 'work', label: 'עבודה', percent: 20 }),
  Object.freeze({ id: 'other', label: 'אחר', percent: 0 }),
]);

export const BUILTIN_IDS: readonly BuiltinTypeId[] = ['exam', 'quiz', 'work', 'other'];

export function isBuiltinType(id: string): id is BuiltinTypeId {
  return (BUILTIN_IDS as readonly string[]).includes(id);
}

/** A subject's own set of types, when it is not the default. */
export interface SubjectWeights {
  types: GradeType[];
}

/** What the owner changed on one grade. */
export interface GradeOverride {
  /** A type id of the grade's subject; otherwise the guess stands. */
  type?: string;
  /**
   * Its own weight, % of the subject. 0 means "none": the grade counts in its
   * type even when Mashov gave it a weight.
   */
  weight?: number;
}

/** Everything the owner set, kept on the phone (`gradeWeightsStore.ts`). */
export interface GradeWeightsPrefs {
  /** By `subjectKey`: "פיזיקה" and "פיזיקה (יב3)" share one. */
  subjects: Record<string, SubjectWeights>;
  /** By the grade's `naturalKey`. */
  grades: Record<string, GradeOverride>;
}

export const EMPTY_WEIGHTS: GradeWeightsPrefs = Object.freeze({ subjects: {}, grades: {} }) as GradeWeightsPrefs;

/** The subject without its group and level, as the grades tab names it: the key its setup is kept under. */
export function subjectKey(subject: string): string {
  return stripGroup(subject.replace(/\s+/g, ' ').trim());
}

/** A subject's types: the owner's set, else the default. */
export function subjectTypes(prefs: GradeWeightsPrefs, subject: string): readonly GradeType[] {
  return prefs.subjects[subjectKey(subject)]?.types ?? DEFAULT_TYPES;
}

/** The label of a type id among `types`; the id itself if it is not there. */
export function typeLabel(types: readonly GradeType[], id: string): string {
  return types.find((t) => t.id === id)?.label ?? DEFAULT_TYPES.find((t) => t.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// The guess

/**
 * The keywords of each type, with the forms a name uses: "מבחנים",
 * "בחינת", "עבודות", "מטלת", "מעבדה". Quote marks are dropped first, so
 * "דו״ח", "דו"ח" and "דוח" are one word.
 */
const KEYWORDS: readonly [BuiltinTypeId, RegExp][] = [
  ['exam', /מבח[ןנ]|בחינ[הות]|מתכונת/],
  ['quiz', /בוח[ןנ]/],
  ['work', /עבוד[הות]|פרוי?יקט|מטל[הות]|חקר|ניסוי|דוח|מעבד[הות]|שאלות/],
];

/**
 * The type an assessment's name suggests: "ניסוי חקר מטוטלת קונית" →
 * עבודה, "בוחן פרק 2" → בוחן, "מתכונת" → מבחן, "חוק קולון" → אחר. When the
 * name has words of two types, the first one wins: a Hebrew name leads with
 * what it is ("מבחן מעבדה" is an exam, "עבודה לקראת המבחן" is work).
 */
export function guessType(name: string | null | undefined): BuiltinTypeId {
  const text = (name ?? '').replace(/["'״׳`]/g, '');
  let best: { at: number; id: BuiltinTypeId } | null = null;
  for (const [id, re] of KEYWORDS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, id };
  }
  return best?.id ?? 'other';
}

// ---------------------------------------------------------------------------
// One grade

/** What the average needs of a grade (`Grade` has it all). */
export interface WeightedGradeLike {
  naturalKey: string;
  value: number | null;
  weight: number | null;
  notes: string | null;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** A grade as it counts: its type, its own weight, and whether that is the owner's doing. */
export interface ResolvedGrade {
  /** A type id of the subject. */
  type: string;
  /** What the name suggests. */
  guess: BuiltinTypeId;
  /** Its own weight (the owner's, else Mashov's positive one); `null` counts it in its type. */
  weight: number | null;
  /** Mashov's own weight, when positive. */
  mashovWeight: number | null;
  /** The owner set a type other than the guess, or a weight other than Mashov's: the row says "שינית". */
  changed: boolean;
}

export function resolveGrade(
  grade: Pick<WeightedGradeLike, 'notes' | 'weight'>,
  types: readonly GradeType[],
  override: GradeOverride | undefined,
): ResolvedGrade {
  const guess = guessType(grade.notes);
  const type = override?.type !== undefined && types.some((t) => t.id === override.type) ? override.type : guess;
  const mashovWeight = positive(grade.weight);
  const weight = override?.weight !== undefined ? positive(override.weight) : mashovWeight;
  return { type, guess, weight, mashovWeight, changed: type !== guess || weight !== mashovWeight };
}

// ---------------------------------------------------------------------------
// The subject's average

/** One part of an average: a type's grades, or the grades with weights of their own. */
export interface AveragePart {
  /** A type id, or `own` for the grades with a weight of their own. */
  id: string;
  /** "מבחן"; `own` has none — the wording is the screen's. */
  label: string | null;
  /** Numeric grades in it. */
  count: number;
  /** A type's plain mean; the own grades' mean by their weights. */
  mean: number;
  /** Its percent of the subject's grade, as counted: 0 when it does not count. */
  share: number;
}

export interface SubjectAverage {
  value: number;
  /** Numeric grades that count (a 0% type's do not). */
  count: number;
  /** Numeric grades left out: in a type at 0%, or in types left nothing by own weights of 100% and more. */
  uncounted: number;
  /** Not a plain mean of all the numeric grades: some count more than others, or not at all. */
  weighted: boolean;
  /** A type's share is in it — "ממוצע משוקלל לפי סוג". */
  byType: boolean;
  /** Own weights first, then the types with grades in the subject's order. */
  parts: AveragePart[];
}

const OWN = 'own';

/**
 * The subject's average over its numeric grades (a grade in words, "הוגש",
 * is not a number), `null` when it has none. See the module's comment for
 * the rules; `prefs` gives the subject's types and the grades' overrides.
 */
export function subjectAverage(
  grades: readonly WeightedGradeLike[],
  subject: string,
  prefs: GradeWeightsPrefs = EMPTY_WEIGHTS,
): SubjectAverage | null {
  const numeric = grades.filter((g): g is WeightedGradeLike & { value: number } => typeof g.value === 'number' && Number.isFinite(g.value));
  if (numeric.length === 0) return null;
  const types = subjectTypes(prefs, subject);

  const own: { value: number; weight: number }[] = [];
  const byType = new Map<string, number[]>();
  for (const g of numeric) {
    const r = resolveGrade(g, types, prefs.grades[g.naturalKey]);
    if (r.weight !== null) own.push({ value: g.value, weight: r.weight });
    else {
      const list = byType.get(r.type);
      if (list) list.push(g.value);
      else byType.set(r.type, [g.value]);
    }
  }

  // Own weights count as they are; past 100% together they are scaled down to it.
  const ownTotal = own.reduce((s, x) => s + x.weight, 0);
  const ownShare = Math.min(ownTotal, 100);
  const left = 100 - ownShare;

  const parts: AveragePart[] = [];
  const perGrade: number[] = [];
  if (own.length > 0) {
    const mean = own.reduce((s, x) => s + x.value * x.weight, 0) / ownTotal;
    parts.push({ id: OWN, label: null, count: own.length, mean, share: ownShare });
    for (const x of own) perGrade.push((x.weight * ownShare) / ownTotal);
  }

  const present = types.filter((t) => byType.has(t.id));
  const percents = present.reduce((s, t) => s + t.percent, 0);
  for (const t of present) {
    const values = byType.get(t.id)!;
    const share = left <= 0 ? 0 : percents > 0 ? (left * t.percent) / percents : left / present.length;
    parts.push({ id: t.id, label: t.label, count: values.length, mean: values.reduce((s, v) => s + v, 0) / values.length, share });
    for (let i = 0; i < values.length; i++) perGrade.push(share / values.length);
  }

  const total = parts.reduce((s, part) => s + part.share, 0);
  const value = parts.reduce((s, part) => s + part.mean * part.share, 0) / total;
  const counted = perGrade.filter((w) => w > 0).length;
  const first = perGrade[0]!;
  const weighted = perGrade.some((w) => Math.abs(w - first) > 1e-9 * Math.max(1, first));
  return {
    value,
    count: counted,
    uncounted: numeric.length - counted,
    weighted,
    byType: parts.some((part) => part.id !== OWN && part.share > 0),
    parts,
  };
}

/** The sum of a set's percents. */
export function percentSum(types: readonly GradeType[]): number {
  return types.reduce((s, t) => s + t.percent, 0);
}

// ---------------------------------------------------------------------------
// Typing a number

/**
 * A percent typed by the owner: "60", "12.5", "12,5", "60%" → the number;
 * empty → `null`; anything else, or outside 0–100, → `undefined` (keep what
 * was there).
 */
export function parsePercent(text: string): number | null | undefined {
  const trimmed = text.replace(/[%\s]/g, '').replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : undefined;
}
