/**
 * What the bagrut tab keeps on the phone, and only there (plan §14.4, §15):
 * the owner's grades (הגשה and בגרות) for any questionnaire, their units,
 * weights, splits and "not in the average" per subject, the subjects and
 * questionnaires they added, and the chosen institution. Never sent to the
 * server.
 *
 * The updates are pure (`prefs` in, new `prefs` out), so the tab and the
 * tests share them; `readBagrutPrefs` / `writeBagrutPrefs` are the store.
 *
 * Version 1 (1.6.0) kept estimates by code and a "counts" switch per
 * questionnaire: `parseBagrutPrefs` reads it into this shape — an estimate
 * becomes the exam grade (the school grade, for a school-assessed code), and
 * "does not count" becomes a weight of 0.
 */
import { storage } from '../widget/feedCache';
import {
  EMPTY_PREFS, isCodeId, type AddedRow, type BagrutPrefs, type GradeEntry, type GradeField, type SubjectOverride, type TableChanges,
} from './bagrut';
import { isInstitutionId, type InstitutionId } from './bagrutBonus';
import { isSchoolAssessed } from './bagrutCatalog';

const KEY = 'bagrut.prefs';
const VERSION = 2;

/** Units of a subject: more than 0, at most 10 (a few programmes go past 5). */
export function isUnits(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10;
}

/** A grade or a percent: 0–100. */
export function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick<T>(value: unknown, ok: (v: unknown) => v is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) if (ok(v)) out[k] = v;
  return out;
}

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function parseOverride(value: unknown, v1: boolean): SubjectOverride | null {
  if (!isRecord(value)) return null;
  const out: SubjectOverride = {};
  if (isUnits(value.units)) out.units = value.units;
  if (isBoolean(value.excluded)) out.excluded = value.excluded;
  const weights = pick(value.weights, isPercent);
  // Version 1's "does not count in the subject" is a weight of 0.
  if (v1) for (const [id, counts] of Object.entries(pick(value.counts, isBoolean))) if (!counts) weights[id] = 0;
  if (Object.keys(weights).length > 0) out.weights = weights;
  const shares = pick(value.shares, isPercent);
  if (Object.keys(shares).length > 0) out.shares = shares;
  return Object.keys(out).length > 0 ? out : null;
}

function parseGrade(value: unknown): GradeEntry | null {
  if (!isRecord(value)) return null;
  const out: GradeEntry = {};
  if (isPercent(value.school)) out.school = value.school;
  if (isPercent(value.exam)) out.exam = value.exam;
  return Object.keys(out).length > 0 ? out : null;
}

function parseRows(value: unknown): AddedRow[] {
  if (!Array.isArray(value)) return [];
  const out: AddedRow[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || !/^(\d+|x\d+)$/.test(row.id)) continue;
    if (out.some((r) => r.id === row.id)) continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!isCodeId(row.id) && !name) continue;
    out.push({ id: row.id, name });
  }
  return out;
}

/** What was stored, keeping only what still makes sense; anything unreadable is a fresh start. */
export function parseBagrutPrefs(raw: string | null | undefined): BagrutPrefs {
  if (!raw) return EMPTY_PREFS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_PREFS;
  }
  if (!isRecord(data)) return EMPTY_PREFS;
  const v1 = data.version !== VERSION;

  const subjects: Record<string, SubjectOverride> = {};
  if (isRecord(data.subjects)) {
    for (const [key, value] of Object.entries(data.subjects)) {
      const o = parseOverride(value, v1);
      if (o) subjects[key] = o;
    }
  }

  const grades: Record<string, GradeEntry> = {};
  if (isRecord(data.grades)) {
    for (const [id, value] of Object.entries(data.grades)) {
      const g = parseGrade(value);
      if (g) grades[id] = g;
    }
  }
  // Version 1's estimate: the exam's grade, or the school grade where the school alone grades it.
  if (v1) {
    for (const [id, grade] of Object.entries(pick(data.estimates, isPercent))) {
      const field: GradeField = isCodeId(id) && isSchoolAssessed(Number(id)) ? 'school' : 'exam';
      grades[id] = { ...grades[id], [field]: grade };
    }
  }

  const added: Record<string, { name: string }> = {};
  if (isRecord(data.added)) {
    for (const [key, value] of Object.entries(data.added)) {
      if (isRecord(value) && isName(value.name)) added[key] = { name: value.name.trim() };
    }
  }

  const rows: Record<string, AddedRow[]> = {};
  if (isRecord(data.rows)) {
    for (const [key, value] of Object.entries(data.rows)) {
      const list = parseRows(value);
      if (list.length > 0) rows[key] = list;
    }
  }

  return {
    subjects,
    grades,
    added,
    rows,
    institution: isInstitutionId(data.institution) ? data.institution : null,
  };
}

export function readBagrutPrefs(): BagrutPrefs {
  return parseBagrutPrefs(storage.getString(KEY));
}

export function writeBagrutPrefs(prefs: BagrutPrefs): void {
  storage.set(KEY, JSON.stringify({ version: VERSION, ...prefs }));
}

// ---------------------------------------------------------------------------
// Updates. `null` takes the owner's entry away: back to Mashov or the table.

function withSubject(prefs: BagrutPrefs, key: string, change: (o: SubjectOverride) => SubjectOverride): BagrutPrefs {
  const next = change({ ...(prefs.subjects[key] ?? {}) });
  const subjects = { ...prefs.subjects };
  if (next.weights && Object.keys(next.weights).length === 0) delete next.weights;
  if (next.shares && Object.keys(next.shares).length === 0) delete next.shares;
  if (Object.keys(next).length === 0) delete subjects[key];
  else subjects[key] = next;
  return { ...prefs, subjects };
}

export function setSubjectUnits(prefs: BagrutPrefs, key: string, units: number | null): BagrutPrefs {
  return withSubject(prefs, key, (o) => {
    if (isUnits(units)) o.units = units;
    else delete o.units;
    return o;
  });
}

export function setSubjectExcluded(prefs: BagrutPrefs, key: string, excluded: boolean | null): BagrutPrefs {
  return withSubject(prefs, key, (o) => {
    if (excluded === null) delete o.excluded;
    else o.excluded = excluded;
    return o;
  });
}

/** A questionnaire's percent of its subject; 0 takes it out of the subject. */
export function setQuestionnaireWeight(prefs: BagrutPrefs, key: string, id: string, weight: number | null): BagrutPrefs {
  return withSubject(prefs, key, (o) => {
    const weights = { ...(o.weights ?? {}) };
    if (isPercent(weight)) weights[id] = weight;
    else delete weights[id];
    return { ...o, weights };
  });
}

/** A questionnaire's split: the school grade's percent of its grade. */
export function setQuestionnaireShare(prefs: BagrutPrefs, key: string, id: string, share: number | null): BagrutPrefs {
  return withSubject(prefs, key, (o) => {
    const shares = { ...(o.shares ?? {}) };
    if (isPercent(share)) shares[id] = share;
    else delete shares[id];
    return { ...o, shares };
  });
}

/** "לחזור לטבלה": what the owner changed over the table in a subject (`tableChanges`) goes. */
export function resetToTable(prefs: BagrutPrefs, key: string, changes: TableChanges): BagrutPrefs {
  return withSubject(prefs, key, (o) => {
    if (changes.units) delete o.units;
    if (changes.excluded) delete o.excluded;
    const weights = { ...(o.weights ?? {}) };
    for (const id of changes.weights) delete weights[id];
    const shares = { ...(o.shares ?? {}) };
    for (const id of changes.shares) delete shares[id];
    return { ...o, weights, shares };
  });
}

/** A grade the owner enters, הגשה or בגרות; `null` gives the field back to Mashov. */
export function setGrade(prefs: BagrutPrefs, id: string, field: GradeField, grade: number | null): BagrutPrefs {
  const entry: GradeEntry = { ...(prefs.grades[id] ?? {}) };
  if (isPercent(grade)) entry[field] = grade;
  else delete entry[field];
  const grades = { ...prefs.grades };
  if (Object.keys(entry).length === 0) delete grades[id];
  else grades[id] = entry;
  return { ...prefs, grades };
}

/** "לחזור למשוב" and "לנקות את המשוערים": these grades go back to Mashov's. */
export function clearGrades(prefs: BagrutPrefs, fields: readonly { id: string; field: GradeField }[]): BagrutPrefs {
  if (fields.length === 0) return prefs;
  return fields.reduce((p, f) => setGrade(p, f.id, f.field, null), prefs);
}

/** A row the owner adds: a code ("35572"), or a name, with its weight and split when they give one. */
export interface NewRow {
  name: string;
  weight: number | null;
  share: number | null;
}

/** The next id for a questionnaire of the owner's own: `x1`, `x2`… never one in use. */
export function nextRowId(prefs: BagrutPrefs): string {
  let max = 0;
  for (const list of Object.values(prefs.rows)) {
    for (const r of list) {
      const m = /^x(\d+)$/.exec(r.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `x${max + 1}`;
}

function appendRows(prefs: BagrutPrefs, key: string, rows: readonly NewRow[]): BagrutPrefs {
  let next = prefs;
  for (const row of rows) {
    const text = row.name.trim();
    if (!text) continue;
    const code = /^\d+$/.test(text);
    const id = code ? String(Number(text)) : nextRowId(next);
    const list = next.rows[key] ?? [];
    if (list.some((r) => r.id === id)) continue;
    next = { ...next, rows: { ...next.rows, [key]: [...list, { id, name: code ? '' : text }] } };
    if (row.weight !== null) next = setQuestionnaireWeight(next, key, id, row.weight);
    if (row.share !== null) next = setQuestionnaireShare(next, key, id, row.share);
  }
  return next;
}

/** "+ שאלון": a questionnaire added to any subject. */
export function addRow(prefs: BagrutPrefs, key: string, row: NewRow): BagrutPrefs {
  return appendRows(prefs, key, [row]);
}

/** A questionnaire the owner added goes, with everything entered for it. */
export function removeRow(prefs: BagrutPrefs, key: string, id: string): BagrutPrefs {
  const list = prefs.rows[key];
  if (!list || !list.some((r) => r.id === id)) return prefs;
  const rows = { ...prefs.rows };
  const left = list.filter((r) => r.id !== id);
  if (left.length > 0) rows[key] = left;
  else delete rows[key];
  let next: BagrutPrefs = { ...prefs, rows };
  next = setQuestionnaireWeight(next, key, id, null);
  next = setQuestionnaireShare(next, key, id, null);
  const grades = { ...next.grades };
  delete grades[id];
  return { ...next, grades };
}

/**
 * "להוסיף מקצוע": a subject Mashov does not list yet, under `key`
 * (`subjectKeyFor`, or a table subject's id), with its units and rows. A key
 * already added is left as it is.
 */
export function addSubject(prefs: BagrutPrefs, key: string, name: string, units: number | null, rows: readonly NewRow[]): BagrutPrefs {
  if (key in prefs.added || !name.trim()) return prefs;
  let next: BagrutPrefs = { ...prefs, added: { ...prefs.added, [key]: { name: name.trim() } } };
  if (units !== null) next = setSubjectUnits(next, key, units);
  return appendRows(next, key, rows);
}

/** A subject the owner added goes, with everything entered for it. (The tab offers "לבטל" with the prefs from before.) */
export function removeSubject(prefs: BagrutPrefs, key: string): BagrutPrefs {
  if (!(key in prefs.added)) return prefs;
  const added = { ...prefs.added };
  delete added[key];
  const grades = { ...prefs.grades };
  for (const r of prefs.rows[key] ?? []) delete grades[r.id];
  const rows = { ...prefs.rows };
  delete rows[key];
  const subjects = { ...prefs.subjects };
  delete subjects[key];
  return { ...prefs, added, rows, subjects, grades };
}

/**
 * "לבטל" after `removeSubject`: the subject as it was in `before`, put back
 * into `prefs` — whatever else changed since stays.
 */
export function restoreSubject(prefs: BagrutPrefs, before: BagrutPrefs, key: string): BagrutPrefs {
  const added = before.added[key];
  if (!added) return prefs;
  const rows = before.rows[key];
  const subject = before.subjects[key];
  const grades = { ...prefs.grades };
  for (const r of rows ?? []) {
    const g = before.grades[r.id];
    if (g) grades[r.id] = g;
  }
  return {
    ...prefs,
    added: { ...prefs.added, [key]: added },
    rows: rows ? { ...prefs.rows, [key]: rows } : prefs.rows,
    subjects: subject ? { ...prefs.subjects, [key]: subject } : prefs.subjects,
    grades,
  };
}

/** "לבטל" after `removeRow`: the row back in its place, with its weight, split and grades from `before`. */
export function restoreRow(prefs: BagrutPrefs, before: BagrutPrefs, key: string, id: string): BagrutPrefs {
  const list = before.rows[key] ?? [];
  const at = list.findIndex((r) => r.id === id);
  if (at < 0) return prefs;
  const current = (prefs.rows[key] ?? []).filter((r) => r.id !== id);
  const rows = { ...prefs.rows, [key]: [...current.slice(0, at), list[at]!, ...current.slice(at)] };
  let next: BagrutPrefs = { ...prefs, rows };
  const weight = before.subjects[key]?.weights?.[id];
  const share = before.subjects[key]?.shares?.[id];
  if (weight !== undefined) next = setQuestionnaireWeight(next, key, id, weight);
  if (share !== undefined) next = setQuestionnaireShare(next, key, id, share);
  const g = before.grades[id];
  return g ? { ...next, grades: { ...next.grades, [id]: g } } : next;
}

export function setInstitution(prefs: BagrutPrefs, institution: InstitutionId | null): BagrutPrefs {
  return { ...prefs, institution };
}

/**
 * A number typed into a field: digits, with a dot or a comma for a fraction.
 * Empty, or anything else, is `null` — the field is cleared, not zero.
 */
export function parseNumberInput(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}
