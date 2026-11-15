/**
 * What the grades tab keeps on the phone, and only there (plan §15, W8): each
 * subject's types and percents, by `subjectKey`, and each grade's type and
 * weight, by its `naturalKey`. Never sent to the server.
 *
 * The updates are pure (`prefs` in, new `prefs` out), so the tab and the
 * tests share them; an entry that is back to the default is dropped.
 * `readGradeWeights` / `writeGradeWeights` are the store, like
 * `lib/bagrutStore.ts`.
 */
import { storage } from '../widget/feedCache';
import {
  DEFAULT_TYPES, EMPTY_WEIGHTS, guessType, isBuiltinType, subjectKey, subjectTypes,
  type GradeOverride, type GradeType, type GradeWeightsPrefs, type SubjectWeights,
} from './gradeWeights';

const KEY = 'grades.weights';

/** A type's name the owner typed: short, one line. */
export const TYPE_LABEL_MAX = 16;

/** A percent: 0–100. */
export function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CUSTOM_ID = /^c\d{1,4}$/;

function cleanLabel(label: unknown): string {
  return typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, TYPE_LABEL_MAX) : '';
}

/** A stored set of types: the four built-in ones always there, under their own names; custom ones with a name. */
function parseTypes(value: unknown): GradeType[] | null {
  if (!Array.isArray(value)) return null;
  const out: GradeType[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || seen.has(item.id) || !isPercent(item.percent)) continue;
    if (isBuiltinType(item.id)) {
      out.push({ id: item.id, label: DEFAULT_TYPES.find((t) => t.id === item.id)!.label, percent: item.percent });
    } else if (CUSTOM_ID.test(item.id) && cleanLabel(item.label)) {
      out.push({ id: item.id, label: cleanLabel(item.label), percent: item.percent });
    } else {
      continue;
    }
    seen.add(item.id);
  }
  for (const t of DEFAULT_TYPES) if (!seen.has(t.id)) out.push({ ...t });
  return out;
}

function parseOverride(value: unknown): GradeOverride | null {
  if (!isRecord(value)) return null;
  const out: GradeOverride = {};
  if (typeof value.type === 'string' && (isBuiltinType(value.type) || CUSTOM_ID.test(value.type))) out.type = value.type;
  if (isPercent(value.weight)) out.weight = value.weight;
  return Object.keys(out).length > 0 ? out : null;
}

/** What was stored, keeping only what still makes sense; anything unreadable is a fresh start. */
export function parseGradeWeights(raw: string | null | undefined): GradeWeightsPrefs {
  if (!raw) return EMPTY_WEIGHTS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_WEIGHTS;
  }
  if (!isRecord(data)) return EMPTY_WEIGHTS;
  const subjects: Record<string, SubjectWeights> = {};
  if (isRecord(data.subjects)) {
    for (const [key, value] of Object.entries(data.subjects)) {
      const types = isRecord(value) ? parseTypes(value.types) : null;
      if (key && types && !isDefault(types)) subjects[key] = { types };
    }
  }
  const grades: Record<string, GradeOverride> = {};
  if (isRecord(data.grades)) {
    for (const [key, value] of Object.entries(data.grades)) {
      const o = parseOverride(value);
      if (key && o) grades[key] = o;
    }
  }
  return { subjects, grades };
}

export function readGradeWeights(): GradeWeightsPrefs {
  return parseGradeWeights(storage.getString(KEY));
}

export function writeGradeWeights(prefs: GradeWeightsPrefs): void {
  storage.set(KEY, JSON.stringify(prefs));
}

// ---------------------------------------------------------------------------
// A subject's types

function isDefault(types: readonly GradeType[]): boolean {
  return types.length === DEFAULT_TYPES.length
    && types.every((t, i) => t.id === DEFAULT_TYPES[i]!.id && t.percent === DEFAULT_TYPES[i]!.percent);
}

function withTypes(prefs: GradeWeightsPrefs, subject: string, change: (types: GradeType[]) => GradeType[]): GradeWeightsPrefs {
  const key = subjectKey(subject);
  const next = change(subjectTypes(prefs, subject).map((t) => ({ ...t })));
  const subjects = { ...prefs.subjects };
  if (isDefault(next)) delete subjects[key];
  else subjects[key] = { types: next };
  return { ...prefs, subjects };
}

/** A type's percent; `null` (an emptied field) is 0. */
export function setTypePercent(prefs: GradeWeightsPrefs, subject: string, id: string, percent: number | null): GradeWeightsPrefs {
  const value = percent === null ? 0 : percent;
  if (!isPercent(value)) return prefs;
  return withTypes(prefs, subject, (types) => types.map((t) => (t.id === id ? { ...t, percent: value } : t)));
}

/** A type of the owner's own, at 0% until given a percent. Returns the new prefs and the type's id (`null` if the name is empty). */
export function addType(prefs: GradeWeightsPrefs, subject: string, label: string): { prefs: GradeWeightsPrefs; id: string | null } {
  const name = cleanLabel(label);
  if (!name) return { prefs, id: null };
  const types = subjectTypes(prefs, subject);
  const same = types.find((t) => t.label === name);
  if (same) return { prefs, id: same.id };
  const used = types.map((t) => (CUSTOM_ID.test(t.id) ? Number(t.id.slice(1)) : 0));
  const id = `c${Math.max(0, ...used) + 1}`;
  return { prefs: withTypes(prefs, subject, (list) => [...list, { id, label: name, percent: 0 }]), id };
}

/** A type the owner added, gone; its grades go back to their guess. The four built-in ones stay. */
export function removeType(prefs: GradeWeightsPrefs, subject: string, id: string): GradeWeightsPrefs {
  if (isBuiltinType(id)) return prefs;
  return withTypes(prefs, subject, (types) => types.filter((t) => t.id !== id));
}

/** "לחזור לברירת המחדל": the subject's types and percents back to the default set. Grades keep what was set on them. */
export function resetSubject(prefs: GradeWeightsPrefs, subject: string): GradeWeightsPrefs {
  const key = subjectKey(subject);
  if (!(key in prefs.subjects)) return prefs;
  const subjects = { ...prefs.subjects };
  delete subjects[key];
  return { ...prefs, subjects };
}

// ---------------------------------------------------------------------------
// One grade

function withGrade(prefs: GradeWeightsPrefs, key: string, change: (o: GradeOverride) => GradeOverride): GradeWeightsPrefs {
  const next = change({ ...(prefs.grades[key] ?? {}) });
  const grades = { ...prefs.grades };
  if (Object.keys(next).length === 0) delete grades[key];
  else grades[key] = next;
  return { ...prefs, grades };
}

/** A grade's type; its name's guess (or `null`) takes the owner's choice away. */
export function setGradeType(
  prefs: GradeWeightsPrefs, grade: { naturalKey: string; notes: string | null }, type: string | null,
): GradeWeightsPrefs {
  return withGrade(prefs, grade.naturalKey, (o) => {
    if (type === null || type === guessType(grade.notes)) delete o.type;
    else o.type = type;
    return o;
  });
}

/**
 * A grade's own weight, % of the subject; `null` (an emptied field) counts it
 * in its type. Back to Mashov's own weight (or to none, when Mashov has none)
 * takes the owner's entry away.
 */
export function setGradeWeight(
  prefs: GradeWeightsPrefs, grade: { naturalKey: string; weight: number | null }, weight: number | null,
): GradeWeightsPrefs {
  const value = weight === null ? 0 : weight;
  if (!isPercent(value)) return prefs;
  const mashov = typeof grade.weight === 'number' && grade.weight > 0 ? grade.weight : 0;
  return withGrade(prefs, grade.naturalKey, (o) => {
    if (value === mashov) delete o.weight;
    else o.weight = value;
    return o;
  });
}

/** Everything the owner set on a grade, gone. */
export function resetGrade(prefs: GradeWeightsPrefs, key: string): GradeWeightsPrefs {
  if (!(key in prefs.grades)) return prefs;
  const grades = { ...prefs.grades };
  delete grades[key];
  return { ...prefs, grades };
}
