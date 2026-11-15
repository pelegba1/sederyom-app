/**
 * A class name, read into its grade, number and track. In a file of its own
 * so that what has no screen of its own can read class names too: a parent's
 * Mashov matches the child's class by it (`mashov/parents.ts`), and the
 * server's tests build no React components. `lib/onboarding.ts` re-exports it.
 *
 * Pure, with no imports.
 */

/**
 * A class name as the school site lists it: "יב2", "יא 7", "י״א 3",
 * "יב3מוסיקה", "י 8 ערבית", and with a dash, "ז-1", "ט' - 1", "י' 2- טכנולוגי".
 * Grade (י / י + א–ד, with or without quote marks), then an optional dash and
 * number, then whatever track follows, after another dash or none. The grade must not run on into a word
 * ("טיול" is not grade ט).
 */
const CLASS_NAME = /^\s*(?:י\s*["'׳״]?\s*([אבגד])|([זחטי]))(?![א-ת])\s*["'׳״]?\s*(?:[-–־]\s*(?=\d))?(\d+)?\s*(?:[-–־]\s*)?(.*)$/;

export interface ParsedClassName {
  /** `'י'`, `'יא'`, `'יב'`… or `null` when the name carries no grade ("מרחב למידה"). */
  grade: string | null;
  number: number | null;
  /** The track after the number, spaces collapsed: "מוזיקה", "ביו רפואה", or `''`. */
  rest: string;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseClassName(name: string): ParsedClassName {
  const m = CLASS_NAME.exec(name);
  if (!m) return { grade: null, number: null, rest: collapse(name) };
  const grade = m[1] ? `י${m[1]}` : (m[2] ?? '');
  return { grade, number: m[3] ? Number(m[3]) : null, rest: collapse(m[4] ?? '') };
}
