/**
 * The universities' bagrut bonuses (plan §14.3): for each institution, the
 * points a subject's grade gets for its units, the lowest grade that earns
 * them, any cap, and which subjects its average keeps — with the page they
 * come from and its year.
 *
 * Nothing here is written from memory. A value no source states is `null`
 * (that subject then stays out of the institution's average, and the average
 * says so), and the owner approves this table before a release.
 *
 * `node test/bagrut-bonus.test.cjs --list` prints it with its sources.
 */

export const INSTITUTION_IDS = ['tau', 'huji', 'technion', 'bgu', 'biu', 'haifa'] as const;

export type InstitutionId = (typeof INSTITUTION_IDS)[number];

export function isInstitutionId(value: unknown): value is InstitutionId {
  return typeof value === 'string' && (INSTITUTION_IDS as readonly string[]).includes(value);
}

export interface BonusRule {
  /** Catalog subject ids (`lib/bagrutCatalog.ts`), or `'any'`. */
  subjects: readonly string[] | 'any';
  /** The subject's units must be at least this. */
  units: number;
  /** Points added to the subject's grade; `null` when the institution's pages do not say. */
  bonus: number | null;
}

/** The Technion's bonus for a science-and-technology certificate. */
export interface ComboBonus {
  /** Math at this many units or more… */
  mathUnits: number;
  /** …and two of these at `units` or more, at least one a science. */
  sciences: readonly string[];
  technology: readonly string[];
  units: number;
  /** Each of those subjects gets this instead of its regular bonus. */
  bonus: number;
}

export interface BonusRules {
  /** A subject's grade earns its bonus at this grade or above… */
  minGrade: number;
  /** …or only above it (BGU: "גבוה מ־60"). */
  minGradeExclusive?: boolean;
  /** The first rule that matches a subject gives its bonus; none matching, no bonus. */
  bonuses: readonly BonusRule[];
  combo?: ComboBonus;
  /** The most the average can be; `null` for no cap. */
  averageCap: number | null;
  /**
   * Subjects always in the average. Every other subject is in only when it
   * raises the average, as long as `minUnits` remain. `null`: every subject
   * is in.
   */
  compulsory: readonly string[] | null;
  minUnits: number;
  /** A subject's units count this many times (the Technion: math twice). */
  unitFactor?: Readonly<Record<string, number>>;
}

export interface BonusSource {
  url: string;
  /** For "לפי כללי {מוסד} לשנת {שנה}". */
  year: string;
}

export interface Institution {
  id: InstitutionId;
  /** "אוניברסיטת תל אביב" */
  name: string;
  /** "ת״א": on the picker and next to the average. */
  short: string;
  source: BonusSource;
  /** What the owner should know before approving: what is not verified. */
  notes: readonly string[];
  rules: BonusRules;
}

// Subject groups as the institutions name them.
const SCIENCES = ['physics', 'chemistry', 'biology'] as const;

const TAU: Institution = {
  id: 'tau',
  name: 'אוניברסיטת תל אביב',
  short: 'ת״א',
  source: { url: 'https://go.tau.ac.il/he/ba/how-to-calculate', year: 'תשפ״ז' },
  notes: [
    'Read 9.10.2026. The site is for תשפ״ז applicants; the page body still names תשפ״ב, and the rules carry no year.',
    'Physics, chemistry, biology, literature, history and Bible at 4 units: +10 is read from the table (only English and math have a 4-unit row of their own).',
    'Not modelled: 3-unit Hebrew counted as 2 when better; +2 for external exams; final projects (+20 in a 25-point subject).',
    'The 117 cap applies to the admission score, not to the average.',
  ],
  rules: {
    minGrade: 60,
    bonuses: [
      { subjects: ['math'], units: 5, bonus: 35 },
      { subjects: ['english', ...SCIENCES, 'literature', 'history', 'bible'], units: 5, bonus: 25 },
      { subjects: ['civics', 'hebrew', 'geography', 'cs', 'jewish_thought', 'arabic'], units: 5, bonus: 20 },
      { subjects: ['english', 'math'], units: 4, bonus: 12.5 },
      { subjects: [...SCIENCES, 'literature', 'history', 'bible', 'civics', 'hebrew', 'geography', 'cs', 'jewish_thought'], units: 4, bonus: 10 },
    ],
    averageCap: null,
    compulsory: ['hebrew', 'english', 'math', 'history', 'civics'],
    minUnits: 20,
  },
};

const HUJI: Institution = {
  id: 'huji',
  name: 'האוניברסיטה העברית',
  short: 'העברית',
  source: { url: 'https://info.huji.ac.il/reception-components/Bagrut', year: 'תשפ״ז' },
  notes: [
    'Read 9.10.2026 (the page carries תשפ״ז news; the rules carry no year). Subject list: https://info.huji.ac.il/reception-components/bagrut-bonus',
    'No cap and no rounding rule found. HUJI divides the average by 10 at the end; the app shows it on the 100 scale.',
  ],
  rules: {
    minGrade: 60,
    bonuses: [
      { subjects: ['math'], units: 5, bonus: 35 },
      { subjects: ['english', 'cs', ...SCIENCES, 'history', 'arabic', 'civics', 'literature', 'bible', 'jewish_thought'], units: 5, bonus: 25 },
      { subjects: ['hebrew', 'geography'], units: 5, bonus: 20 },
      { subjects: ['math', 'english', 'cs', ...SCIENCES, 'history', 'arabic', 'civics', 'literature', 'bible', 'jewish_thought'], units: 4, bonus: 15 },
      { subjects: ['hebrew', 'geography'], units: 4, bonus: 10 },
    ],
    averageCap: null,
    compulsory: ['english', 'math', 'history', 'civics', 'hebrew'],
    minUnits: 20,
  },
};

const TECHNION: Institution = {
  id: 'technion',
  name: 'הטכניון',
  short: 'הטכניון',
  source: { url: 'https://admissions.technion.ac.il/calculation-of-the-median-grade/', year: 'תשפ״ז' },
  notes: [
    'Read 9.10.2026; the rules carry no year. Average and weighting: https://admissions.technion.ac.il/kizad-mehasvim/ and the worked example at https://admissions.technion.ac.il/summary-score-calculation-table/',
    'The 4-unit bonus for math, English, the sciences, CS, literature, Bible and history is not on the Technion pages: such a subject stays out of the Technion average.',
    'Math counts twice except in architecture and landscape architecture (not modelled). מחשבת ישראל may be dropped when there are 2 units of literature (not modelled: it is treated as an elective).',
  ],
  rules: {
    minGrade: 60,
    bonuses: [
      { subjects: ['math'], units: 5, bonus: 30 },
      { subjects: [...SCIENCES, 'cs', 'literature', 'bible', 'history', 'english', 'arabic'], units: 5, bonus: 25 },
      { subjects: ['civics', 'geography', 'jewish_thought'], units: 5, bonus: 20 },
      { subjects: ['civics', 'geography', 'jewish_thought'], units: 4, bonus: 10 },
      { subjects: ['math', 'english', ...SCIENCES, 'cs', 'literature', 'bible', 'history'], units: 4, bonus: null },
    ],
    combo: { mathUnits: 5, sciences: SCIENCES, technology: ['cs'], units: 5, bonus: 30 },
    averageCap: 119,
    compulsory: ['civics', 'english', 'math', 'hebrew', 'literature', 'bible', 'history'],
    minUnits: 20,
    unitFactor: { math: 2 },
  },
};

const BGU: Institution = {
  id: 'bgu',
  name: 'אוניברסיטת בן־גוריון',
  short: 'בן־גוריון',
  source: { url: 'https://ummedia.bgu.ac.il/media/0p3ppz0n/ידיעון-תואר-ראשון.pdf', year: 'תשפ״ז' },
  notes: [
    'The ידיעון for תשפ״ז, updated 1.1.2026, pages 10–11: the only source of the six that names תשפ״ז.',
    'A grade of exactly 60 earns no bonus: the ידיעון says "גבוה מ־60".',
    'No worked example and no rounding rule.',
  ],
  rules: {
    minGrade: 60,
    minGradeExclusive: true,
    bonuses: [
      { subjects: ['math'], units: 5, bonus: 35 },
      { subjects: [...SCIENCES, 'literature', 'bible', 'history', 'english', 'cs', 'arabic'], units: 5, bonus: 25 },
      { subjects: 'any', units: 5, bonus: 20 },
      { subjects: ['math'], units: 4, bonus: 20 },
      { subjects: ['english'], units: 4, bonus: 15 },
      { subjects: 'any', units: 4, bonus: 10 },
    ],
    averageCap: 120,
    compulsory: ['english', 'math', 'history', 'civics', 'hebrew'],
    minUnits: 20,
  },
};

const BIU: Institution = {
  id: 'biu',
  name: 'אוניברסיטת בר־אילן',
  short: 'בר־אילן',
  source: { url: 'https://www.biu.ac.il/sites/default/files/inline-files/yedion.pdf', year: 'תשפ״ב' },
  notes: [
    'Only the תשפ״ב (2021–22) ידיעון could be read. The current page sits behind a CAPTCHA: https://www.biu.ac.il/registration-and-admission/information/general-admission-req/matriculation-calculation (compare before approving).',
    'Which subjects the average keeps is not in the ידיעון: every subject counts here.',
    'The ידיעון uses a 10-point scale (×10 here).',
  ],
  rules: {
    minGrade: 60,
    bonuses: [
      { subjects: ['math'], units: 5, bonus: 35 },
      { subjects: ['bible', 'jewish_thought', 'history', 'civics', 'literature', ...SCIENCES, 'english', 'cs'], units: 5, bonus: 25 },
      { subjects: ['geography', 'hebrew'], units: 5, bonus: 20 },
      { subjects: ['math'], units: 4, bonus: 15 },
      { subjects: ['bible', 'jewish_thought', 'history', 'civics', 'literature', ...SCIENCES, 'english', 'cs'], units: 4, bonus: 12.5 },
      { subjects: ['geography', 'hebrew'], units: 4, bonus: 10 },
    ],
    averageCap: null,
    compulsory: null,
    minUnits: 20,
  },
};

const HAIFA: Institution = {
  id: 'haifa',
  name: 'אוניברסיטת חיפה',
  short: 'חיפה',
  source: { url: 'https://www.haifa.ac.il/חישוב-ציון-קבלה-סכם/', year: 'תשפ״ד' },
  notes: [
    'The page names three years (תשפ״ב, תשפ״ג, תשפ״ד; bonuses "from תשע״ט"): the latest published version, not confirmed for תשפ״ז.',
    'No cap and no rounding rule found. The compulsory subjects are those of the certificate composition the page lists.',
  ],
  rules: {
    minGrade: 60,
    bonuses: [
      { subjects: ['math'], units: 5, bonus: 35 },
      { subjects: ['english', ...SCIENCES, 'bible', 'history', 'literature', 'arabic'], units: 5, bonus: 25 },
      { subjects: ['civics', 'hebrew', 'geography', 'cs', 'jewish_thought'], units: 5, bonus: 20 },
      { subjects: ['math', 'english', ...SCIENCES, 'bible', 'history', 'literature', 'arabic'], units: 4, bonus: 20 },
      { subjects: ['civics', 'hebrew', 'geography', 'cs', 'jewish_thought'], units: 4, bonus: 10 },
    ],
    averageCap: null,
    compulsory: ['bible', 'hebrew', 'literature', 'history', 'civics', 'math', 'english'],
    minUnits: 20,
  },
};

export const INSTITUTIONS: readonly Institution[] = [TAU, HUJI, TECHNION, BGU, BIU, HAIFA];

export function institution(id: InstitutionId | null): Institution | null {
  return INSTITUTIONS.find((i) => i.id === id) ?? null;
}
