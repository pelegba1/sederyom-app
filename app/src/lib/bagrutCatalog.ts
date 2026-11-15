/**
 * The bagrut questionnaire table (plan §14.9): for each Ministry code, its
 * subject, the units of the subject it belongs to, its weight in the subject's
 * grade, and whether it counts toward the average. Mashov gives none of these.
 *
 * Every value comes from a source with a year. A value no source states is
 * `null`, and the app asks for it rather than guessing; the owner's own entry
 * (`lib/bagrutStore.ts`) always wins over this table, because exemptions and
 * recent changes are not always in any table.
 *
 * `node test/bagrut-catalog.test.cjs --list` prints the table with its sources.
 */

/** Where a value comes from. */
export interface CatalogSource {
  url: string;
  /** The school year or sitting the source applies to, e.g. "תשפ״ו". */
  year: string;
  /** `official`: the Ministry or its subject inspectorate. `secondary`: anything else, used only where no official page says it. */
  kind: 'official' | 'secondary';
}

export interface CatalogEntry {
  semel: number;
  /** A key of `Catalog.subjects`. */
  subject: string;
  /**
   * Its percent of the subject's grade at each level (units) it belongs to:
   * 35571 is `{ 3: 100, 4: 65, 5: 60 }`. `null` for a level it belongs to
   * whose weight no source states; empty when no level is known.
   */
  weights: Readonly<Record<number, number | null>>;
  /** Whether it counts toward the bagrut average at all. */
  counts: boolean;
  /**
   * When the questionnaire has both a school grade (מגן) and an exam: the
   * school grade's percent of the questionnaire's grade. `null` when no source
   * says, and then an estimate is of the questionnaire's grade, not the exam's.
   */
  schoolShare: number | null;
  /** Where `schoolShare` comes from, when it is not `null`: often a different page from the weights'. */
  shareSource?: CatalogSource;
  /** Where the weights and `counts` come from. */
  source: CatalogSource | null;
  /** A short note for the report, not shown in the app. */
  note?: string;
}

export interface CatalogSubject {
  id: string;
  /** As the app shows it. */
  name: string;
  /**
   * How a Mashov name may begin ("מתמטיקה - תכנית חדשה"), to place a code
   * the table does not know under its subject. Matched after `normalizeHebrew`.
   */
  aliases: readonly string[];
  /**
   * The questionnaires that make up the subject at each level, as the
   * alternative sets the Ministry allows (physics has three tracks). A code
   * that every set still open to the student needs, and that Mashov does not
   * list, shows as missing ("subject incomplete", as opposed to "code unknown").
   */
  levels: Readonly<Record<number, readonly (readonly number[])[]>>;
}

/** The levels (units) a code belongs to. */
export function entryLevels(entry: CatalogEntry): number[] {
  return Object.keys(entry.weights).map(Number);
}

export interface Catalog {
  subjects: Readonly<Record<string, CatalogSubject>>;
  entries: Readonly<Record<number, CatalogEntry>>;
  /** Codes graded by the school alone, with no exam (`isSchoolAssessed`). */
  schoolAssessed?: ReadonlySet<number>;
}

/** ASCII quotes as Hebrew gershayim and geresh: Mashov writes תנ"ך, the app תנ״ך. */
export function normalizeHebrew(text: string): string {
  return text.replace(/"/g, '״').replace(/'/g, '׳').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sources

const official = (url: string, year: string): CatalogSource => ({ url, year, kind: 'official' });

/** The math inspectorate: the combinations allowed at each level, with each code's percent. */
const MATH_COMBINATIONS = official(
  'https://meyda.education.gov.il/files/Pop/0files/matmatika/Chativa-Elyona/tashpav/PossibleCombinationsMathExams2025.pdf',
  'יוני 2025',
);
/** The Exams Division, summer 2026: "בכלל השאלונים במתמטיקה בהם הציון השנתי וציון הבחינה מהווים 50% כל אחד". */
const EXAMS_SUMMER_2026 = official('https://meyda.education.gov.il/files/Exams/FinalInsrtuctionsMoedSumExams16042026.pdf', 'אפריל 2026');
/** The physics inspectorate: grade 11–12 bagrut structure, tracks A and B. */
const PHYSICS_TRACKS = official('https://meyda.education.gov.il/files/Mazkirut_Pedagogit/phizika/2019/Matriculation-11-12.pdf', 'תשפ״ז');
/** The physics inspectorate: the projects track. */
const PHYSICS_PROJECTS = official('https://meyda.education.gov.il/files/Mazkirut_Pedagogit/phizika/2019/Matriculation-11-12-projects.pdf', 'תשפ״ז');
/** CS inspectorate, 2024: the 3-unit exam (899371) and the performance task (899373), and their annual-grade shares. */
const CS_2024 = official('https://meyda.education.gov.il/files/CSIT/newExamsStructure.pdf', 'נובמבר 2024');
/** CS inspectorate, 2022: the 3 units are 60% of the 5-unit grade, the 2 completing units (899271) 40%. */
const CS_2022 = official('https://meyda.education.gov.il/files/CSIT//CS_new_Matriculations.pdf', 'יוני 2022');
/** Director-General's directive 0230, §3.2.6: "מבוא למדעים" grades appear "ללא אזכור יחידות הלימוד". */
const DIRECTIVE_0230 = official('https://apps.education.gov.il/Mankal/horaa.aspx?siduri=285', '2019');
/** The externals' regulations, Sept 2025: each questionnaire's "משקל בצירוף לציון סופי במקצוע". */
const EXTERNALS_2025 = official('https://meyda.education.gov.il/files/Exams/TakanonExterni092025NEW.pdf', 'ספטמבר 2025');
/** The reform's organisation document: an external exam is 70% exam and 30% annual grade. */
const REFORM_2015 = official('https://meyda.education.gov.il/files/HighSchool/irgunhalimudim_d_dash91_site.pdf', 'דצמבר 2015');
/** The Exams Division's annual circular for תשפ״ו: the new track's 35% exam has no annual grade. */
const YEAR_CIRCULAR_2026 = official('https://meyda.education.gov.il/files/Exams/HozerYearTashpav2026.pdf', 'תשפ״ו');
const BIBLE_2027 = official('https://meyda.education.gov.il/files/Mazkirut_Pedagogit/tanach/tanach2027/KOLEL2027.PDF', 'תשפ״ז');
const LITERATURE = official('https://meyda.education.gov.il/files/Mazkirut_Pedagogit/sifrut/simlai_sheelonim_sifrut.pdf', 'מאי 2024');
/** "סמסטר ראשון בתיכון": 30% school, 35% the academic course, 35% the shortened exam. */
const HEBREW_ACADEMY = official('https://meyda.education.gov.il/files/Pop/0files/academy-points/hebrew-tashpaz.pdf', 'פברואר 2026');
/** The English inspectorate's 5-unit handbook: E 27%, F 26%, G 27%, COBE 20%; each exam 70% and annual grade 30%. */
const ENGLISH_5 = official('https://meyda.education.gov.il/files/pop/0files/english/Chativa-Elyona/Bagrut/updates/5pointsbooklet2025.pdf', 'פברואר 2025');
/** History, the flexible track (cluster 2): exam 35%, task 1 17%, task 2 18%, alternative assessment 30%. */
const HISTORY_FLEX = official('https://meyda.education.gov.il/files/Pop/0files/historya/Chativa-Elyona/bagrut-gamish.pdf', 'תשפ״ז');
const CIVICS = official('https://pop.education.gov.il/tchumey_daat/citizenship/citizenship-high-school/citizenship-pedagogy/bagrut-exam/', 'תשפ״ז');
/** "בחינת התיאוריה אינה מהווה מבחן בגרות". */
const TRAFFIC = official('https://meyda.education.gov.il/files/PortalShaar/theory-test-traffi-educ.pdf', 'פברואר 2026');
const CHEMISTRY_EXAMS = official('https://pop.education.gov.il/tchumey_daat/chemistry/high-school/pedagogy/matriculation-exams/', 'תשפ״ו');
const BIOLOGY_EXAMS = official(
  'https://pop.education.gov.il/tchumey_daat/biologya/chativa-elyona/biology-pedagogy/matriculation-exams-biology-glossary/',
  'תשפ״ו',
);

// ---------------------------------------------------------------------------
// Subjects

const SUBJECTS: Record<string, CatalogSubject> = {
  bible: { id: 'bible', name: 'תנ״ך', aliases: ['תנך'], levels: { 2: [[1261, 1263]] } },
  literature: { id: 'literature', name: 'ספרות', aliases: [], levels: { 2: [[8281, 8283]] } },
  // The academic class ("סמסטר ראשון בתיכון"); the regular class's 70% exam is not in the table yet.
  hebrew: { id: 'hebrew', name: 'עברית', aliases: ['הבעה', 'לשון'], levels: { 2: [[11251, 11261, 11283]] } },
  english: { id: 'english', name: 'אנגלית', aliases: [], levels: { 5: [[16471, 16583, 16582, 16586]] } },
  history: { id: 'history', name: 'היסטוריה', aliases: [], levels: { 2: [[22221, 22222, 22225, 22283]] } },
  civics: { id: 'civics', name: 'אזרחות', aliases: [], levels: { 2: [[34271, 34263]] } },
  math: {
    id: 'math', name: 'מתמטיקה', aliases: [],
    levels: { 3: [[35571]], 4: [[35571, 35472]], 5: [[35571, 35572]] },
  },
  physics: {
    id: 'physics', name: 'פיזיקה', aliases: ['פיסיקה'],
    levels: {
      5: [
        [36361, 36371, 36386, 36283], // track A
        [36361, 36351, 36356, 36283], // track B
        [36361, 36371, 36286, 36288], // projects
      ],
    },
  },
  chemistry: {
    id: 'chemistry', name: 'כימיה', aliases: [],
    levels: { 5: [[37381, 37388, 37283], [37381, 37376, 37283], [37387, 37388, 37283], [37387, 37376, 37283]] },
  },
  biology: {
    id: 'biology', name: 'ביולוגיה', aliases: [],
    levels: { 5: [[43381, 43386, 43283], [43387, 43386, 43283]] },
  },
  cs: {
    id: 'cs', name: 'מדעי המחשב', aliases: [],
    levels: { 3: [[899371, 899373]], 5: [[899371, 899373, 899271]] },
  },
  science_intro: {
    id: 'science_intro', name: 'מבוא למדעים', aliases: ['מבוא לפיזיקה', 'מבוא לפיסיקה', 'מבוא לכימיה', 'מבוא לביולוגיה'], levels: {},
  },
  // In the institutions' bonus lists; no questionnaire of theirs is in the table yet.
  geography: { id: 'geography', name: 'גאוגרפיה', aliases: ['גיאוגרפיה'], levels: {} },
  arabic: { id: 'arabic', name: 'ערבית', aliases: [], levels: {} },
  jewish_thought: { id: 'jewish_thought', name: 'מחשבת ישראל', aliases: [], levels: {} },
  general: { id: 'general', name: 'השכלה כללית', aliases: [], levels: {} },
  traffic: { id: 'traffic', name: 'חינוך תעבורתי', aliases: [], levels: {} },
};

// ---------------------------------------------------------------------------
// Questionnaires

function entry(
  semel: number, subject: string, weights: Record<number, number | null>, source: CatalogSource | null,
  extra: Partial<Omit<CatalogEntry, 'semel' | 'subject' | 'weights' | 'source'>> = {},
): CatalogEntry {
  return { semel, subject, weights, counts: true, schoolShare: null, source, ...extra };
}

const MATH_SHARE = { schoolShare: 50, shareSource: EXAMS_SUMMER_2026 };
const EXAM_70_30 = { schoolShare: 30, shareSource: REFORM_2015 };
const ENGLISH_SHARE = { schoolShare: 30, shareSource: ENGLISH_5 };

const HUMANITIES: CatalogEntry[] = [
  entry(1261, 'bible', { 2: 70 }, EXTERNALS_2025, EXAM_70_30),
  entry(1263, 'bible', { 2: 30 }, BIBLE_2027, { note: 'school-assessed' }),
  entry(8281, 'literature', { 2: 70 }, LITERATURE, EXAM_70_30),
  entry(8283, 'literature', { 2: 30 }, LITERATURE, { note: 'alternative assessment, school-assessed' }),
  entry(11251, 'hebrew', { 2: 35 }, HEBREW_ACADEMY, {
    note: 'the academic course (+ a Ministry bonus); the code is placed by its Mashov name ״עברית באקדמיה״: no official list names it',
  }),
  entry(11261, 'hebrew', { 2: 35 }, HEBREW_ACADEMY, { note: 'the shortened exam, academic class only; its annual-grade share is not stated for it' }),
  entry(11283, 'hebrew', { 2: 30 }, HEBREW_ACADEMY, { note: 'school grade (reporting code per the Hebrew inspectorate, Aug 2023)' }),
  entry(16471, 'english', { 5: 27 }, ENGLISH_5, { ...ENGLISH_SHARE, note: 'Module E; replaced 16481 from winter 2025' }),
  entry(16583, 'english', { 5: 26 }, ENGLISH_5, { note: 'Module F: school grade' }),
  entry(16582, 'english', { 5: 27 }, ENGLISH_5, { ...ENGLISH_SHARE, note: 'Module G' }),
  entry(16586, 'english', { 5: 20 }, ENGLISH_5, { ...ENGLISH_SHARE, note: 'COBE, the oral exam' }),
  entry(22225, 'history', { 2: 35 }, HISTORY_FLEX, {
    schoolShare: 0, shareSource: YEAR_CIRCULAR_2026, note: 'the external exam, cluster 2: no annual grade',
  }),
  entry(22221, 'history', { 2: 17 }, HISTORY_FLEX, { note: 'task 1, teacher-graded' }),
  entry(22222, 'history', { 2: 18 }, HISTORY_FLEX, { note: 'task 2, teacher-graded' }),
  entry(22283, 'history', { 2: 30 }, HISTORY_FLEX, { note: 'alternative assessment, school-assessed' }),
  entry(34271, 'civics', { 2: 70 }, CIVICS, { ...EXAM_70_30, note: 'the external exam' }),
  entry(34263, 'civics', { 2: 30 }, CIVICS, { note: 'internal performance task (Mashov labels it external)' }),

  // Conditions for the certificate, not bagrut subjects.
  entry(84073, 'general', {}, REFORM_2015, { counts: false, note: 'השכלה כללית: internal only, no units; the code itself is in no official list' }),
  entry(84083, 'general', {}, REFORM_2015, { counts: false, note: 'השכלה כללית, the second subject' }),
  entry(700181, 'traffic', {}, TRAFFIC, { counts: false, note: 'the 10th-grade theory test, pass at 80: not a bagrut exam' }),
];

const STEM: CatalogEntry[] = [
  entry(35571, 'math', { 3: 100, 4: 65, 5: 60 }, MATH_COMBINATIONS, { ...MATH_SHARE, note: 'one code at three levels: the owner says which' }),
  entry(35472, 'math', { 4: 35 }, MATH_COMBINATIONS, MATH_SHARE),
  entry(35572, 'math', { 5: 40 }, MATH_COMBINATIONS, MATH_SHARE),

  entry(36361, 'physics', { 5: 30 }, PHYSICS_TRACKS, { note: 'every track; the annual/exam split is not in the physics documents' }),
  entry(36371, 'physics', { 5: 25 }, PHYSICS_TRACKS, { note: 'track A and projects' }),
  entry(36386, 'physics', { 5: 15 }, PHYSICS_TRACKS, { note: 'track A: written lab' }),
  entry(36283, 'physics', { 5: 30 }, PHYSICS_TRACKS, { note: 'tracks A and B: school-assessed' }),
  entry(36351, 'physics', { 5: 30 }, PHYSICS_TRACKS, { note: 'track B' }),
  entry(36356, 'physics', { 5: 10 }, PHYSICS_TRACKS, { note: 'track B: oral lab' }),
  entry(36286, 'physics', { 5: 15 }, PHYSICS_PROJECTS, { note: 'projects track' }),
  entry(36288, 'physics', { 5: 30 }, PHYSICS_PROJECTS, { note: 'projects track: school-assessed' }),

  entry(37381, 'chemistry', { 5: 55 }, CHEMISTRY_EXAMS, { note: 'or 37387' }),
  entry(37387, 'chemistry', { 5: 55 }, CHEMISTRY_EXAMS, { note: 'or 37381' }),
  entry(37388, 'chemistry', { 5: 15 }, CHEMISTRY_EXAMS, { note: 'or 37376' }),
  entry(37376, 'chemistry', { 5: 15 }, CHEMISTRY_EXAMS, { note: 'or 37388' }),
  entry(37283, 'chemistry', { 5: 30 }, CHEMISTRY_EXAMS, { note: 'school-assessed' }),

  entry(43381, 'biology', { 5: 55 }, BIOLOGY_EXAMS, { note: 'or 43387' }),
  entry(43387, 'biology', { 5: 55 }, BIOLOGY_EXAMS, { note: 'or 43381' }),
  entry(43386, 'biology', { 5: 15 }, BIOLOGY_EXAMS),
  entry(43283, 'biology', { 5: 30 }, BIOLOGY_EXAMS, { note: 'school-assessed' }),

  entry(899371, 'cs', { 3: 60, 5: 36 }, CS_2024, {
    schoolShare: 30, shareSource: CS_2024,
    note: '60% of the 3 units (2024); 5 units: 60% × 60% = 36% (the 60/40 split is from 2022)',
  }),
  entry(899373, 'cs', { 3: 40, 5: 24 }, CS_2024, { note: 'performance task, school-assessed; 5 units: 60% × 40% = 24%' }),
  entry(899271, 'cs', { 5: 40 }, CS_2022, {
    schoolShare: 40, shareSource: CS_2024,
    note: 'the 2 completing units; an exam below 55 keeps the 3-unit grade (not modelled)',
  }),

  // "מבוא למדעים": one science for a year, reported without units, so out of a unit-weighted average.
  entry(36183, 'science_intro', {}, DIRECTIVE_0230, { counts: false, note: 'מבוא לפיזיקה; not part of 5-unit physics (physics circular 3/תשפ״א)' }),
  entry(37183, 'science_intro', {}, DIRECTIVE_0230, { counts: false, note: 'מבוא לכימיה: 100% internal (chemistry exams page)' }),
  entry(43183, 'science_intro', {}, DIRECTIVE_0230, { counts: false, note: 'מבוא לביולוגיה (biology curriculum page)' }),
];

const ENTRIES: Record<number, CatalogEntry> = Object.fromEntries([...HUMANITIES, ...STEM].map((e) => [e.semel, e]));

/**
 * The codes above graded by the school alone, with no exam — the school
 * grade is the questionnaire's grade. As their notes say (school-assessed,
 * teacher-graded, a school grade, an internal task); the same sources.
 */
const SCHOOL_ASSESSED: ReadonlySet<number> = new Set([
  1263, 8283, 11283, 16583, 22221, 22222, 22283, 34263, 36283, 36288, 37283, 43283, 899373,
]);

export const CATALOG: Catalog = { subjects: SUBJECTS, entries: ENTRIES, schoolAssessed: SCHOOL_ASSESSED };

/** Whether a code is graded by the school alone, with no exam. */
export function isSchoolAssessed(semel: number, catalog: Catalog = CATALOG): boolean {
  return catalog.schoolAssessed?.has(semel) ?? false;
}
