/**
 * One colour per subject (plan W6-F, Daniel: "I'd recognise מתמטיקה without
 * reading the abbreviation"). A secondary cue only: the subject's name is
 * always written beside it, so the colour never carries meaning alone. It
 * shows as an 8-point dot or as the fill of a week-grid cell, never as a
 * stripe along a side (plan §16.1).
 *
 * Seven hues: slots 1–7 of the validated categorical palette (dataviz skill,
 * CVD-checked for the light and the dark page), without its red, which means
 * "בוטל" here. They are handed out over the student's own subjects: the
 * class's lines minus the hidden ones, by how many lessons each has in the
 * fetched weeks, most first, then by name. So the seven subjects the
 * student meets most never share a colour, and a hidden subject takes none.
 *
 * Run 8 (Noa, who "lives by the colours"): hiding one subject recoloured the
 * whole week, since the order moved under every subject after it. Once a
 * subject has a colour it keeps it: the phone stores each subject's slot
 * (`SubjectSlots`, lib/subjectColorStore.ts), a new subject takes the first
 * slot no stored subject holds, in the order above (`assignSubjectSlots`),
 * and a hidden subject keeps its slot reserved for when it comes back.
 */
import { stripGroup } from './format';
import type { ColorScheme } from '../theme';

export const SUBJECT_COLORS: Readonly<Record<ColorScheme, readonly string[]>> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
};

/** One published line of the class timetable, as settings lists it (`SubjectOption`). */
export interface SubjectLine {
  /** The subject as the site prints it. */
  name: string;
  /** Lessons on this line across the fetched weeks. */
  count?: number;
  /** What `hiddenSubjects` stores to hide this line; the name when absent. */
  key?: string;
}

/** The subject as one key: "אזרחות (יב2)" and "אזרחות" are one subject. */
export function subjectColorKey(name: string): string {
  return stripGroup(name).trim();
}

/**
 * The order colours are handed out in: the student's subjects (`lines`
 * without the ones whose key is in `hidden`), one per key, by lesson count
 * summed over its lines, most first, then by name. A bare name counts no
 * lessons, so a list of names is ordered by name alone. The order of `lines`
 * does not matter, so every screen that knows the same list agrees.
 */
export function subjectOrder(lines: readonly (string | SubjectLine)[], hidden: readonly string[] = []): string[] {
  const hide = new Set(hidden);
  const counts = new Map<string, number>();
  for (const entry of lines) {
    const line: SubjectLine = typeof entry === 'string' ? { name: entry } : entry;
    if (hide.has(line.key ?? line.name)) continue;
    const key = subjectColorKey(line.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + (line.count ?? 0));
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
    .map(([key]) => key);
}

/** A small, stable number for a key: the same subject lands on the same colour on every screen. */
function keyHash(key: string): number {
  let h = 5381;
  for (const ch of key) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h;
}

/**
 * Each subject's colour slot, by its key (`subjectColorKey`): an index into
 * `SUBJECT_COLORS[scheme]`, the same slot in both schemes. What the phone
 * stores, so a subject keeps its colour.
 */
export type SubjectSlots = Readonly<Record<string, number>>;

/** How many colours there are to hand out: seven. */
const SLOT_COUNT = SUBJECT_COLORS.light.length;

function slotOf(slots: SubjectSlots, key: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(slots, key) ? slots[key] : undefined;
}

/**
 * `stored` with every subject of `order` that has no slot yet given one, in
 * the order's order: the first slot no subject holds, or, once all seven are
 * held, the next one round (the eighth subject shares the first colour, as
 * the order alone gave it). A subject already in `stored` keeps its slot, in
 * the order or not (hidden: reserved). Returns `stored` itself when nothing
 * is new, so a caller can tell whether there is anything to save.
 */
export function assignSubjectSlots(order: readonly string[], stored: SubjectSlots): SubjectSlots {
  let next: Record<string, number> | null = null;
  const held = new Set(Object.values(stored));
  for (const key of order) {
    if (slotOf(next ?? stored, key) !== undefined) continue;
    next ??= { ...stored };
    let slot = -1;
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      if (!held.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) slot = Object.keys(next).length % SLOT_COUNT;
    next[key] = slot;
    held.add(slot);
  }
  return next ?? stored;
}

/**
 * The colour of each subject, given the order (`subjectOrder`), the scheme
 * and the slots the phone keeps (`slots`, none by default). A subject with a
 * stored slot takes its colour; each other subject in the order takes a slot
 * as `assignSubjectSlots` would give it. With nothing stored that is its
 * place's colour, wrapping after seven. One outside both (named in a way the
 * class list lacks) takes one of the colours no subject holds, by its name,
 * or any when none is free.
 */
export function subjectColorOf(order: readonly string[], scheme: ColorScheme, slots: SubjectSlots = {}): (subject: string) => string {
  const palette = SUBJECT_COLORS[scheme];
  const assigned = assignSubjectSlots(order, slots);
  const held = new Set(Object.values(assigned));
  const free = palette.map((_c, i) => i).filter((i) => !held.has(i));
  return (subject) => {
    const key = subjectColorKey(subject);
    const slot = slotOf(assigned, key);
    const index = slot !== undefined ? slot : free.length > 0 ? free[keyHash(key) % free.length]! : keyHash(key);
    return palette[index % palette.length]!;
  };
}

/** The colour for `subject`, given the class's subject lines, what is hidden, and the stored slots. */
export function subjectColor(
  subject: string,
  lines: readonly (string | SubjectLine)[],
  scheme: ColorScheme,
  hidden: readonly string[] = [],
  slots: SubjectSlots = {},
): string {
  return subjectColorOf(subjectOrder(lines, hidden), scheme, slots)(subject);
}

/** What the phone keeps: the slots, and the class they were handed out in. */
export interface StoredSubjectSlots {
  classId: string | null;
  slots: SubjectSlots;
}

/** The stored mapping from its JSON; anything broken or unknown reads as nothing stored. */
export function parseSubjectSlots(raw: string | null | undefined): StoredSubjectSlots {
  const empty: StoredSubjectSlots = { classId: null, slots: {} };
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!data || typeof data !== 'object') return empty;
  const { classId, slots } = data as { classId?: unknown; slots?: unknown };
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return empty;
  const clean: Record<string, number> = {};
  for (const [key, slot] of Object.entries(slots)) {
    if (key && Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < SLOT_COUNT) clean[key] = slot as number;
  }
  return { classId: typeof classId === 'string' ? classId : null, slots: clean };
}

/**
 * The stored slots that hold for `classId`: all of them, unless the student
 * has moved to another class, whose subjects start afresh (a new year's
 * class would otherwise find every colour held by last year's subjects).
 * While the class is not known yet (`null`), the stored ones hold.
 */
export function slotsForClass(stored: StoredSubjectSlots, classId: string | null): SubjectSlots {
  return classId !== null && stored.classId !== null && stored.classId !== classId ? {} : stored.slots;
}
