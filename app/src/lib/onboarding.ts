/**
 * The logic behind the setup screens (plan A4, R5): the onboarding steps
 * (R-22), the grouped class picker (F18), the "המבחנים שלך" recommendation
 * (F5, R-23), the counts Settings shows (R-25), the appearance labels (R-26)
 * and the five-tab tour (F17).
 *
 * Pure: type-only imports plus `./format`, so app/test can load it without
 * React Native.
 */
import type { Audience, ClassOption, ExamMatch, NotificationType, SchoolSiteState } from '@sederyom/shared';
import type { IconName } from '../components/AppIcon';
import type { TextScale, ThemePreference } from '../theme';
import { parseClassName, type ParsedClassName } from './className';
import { plural } from './format';
import {
  BLOCK_EXPLAINER, examCounts, examGroupKey, examMine, groupExamsBySubject, groupLessonOptions, isBlockGroup, lessonGroupState,
  MOCK_EXAM_EXPLAINER, setExamsShown, type ExamGroup, type LessonOptionLike,
} from './school';

// ---------------------------------------------------------------------------
// Onboarding steps (R-22)
// ---------------------------------------------------------------------------

/**
 * Five steps, one decision each: Google and Mashov share one "connect" step,
 * and the tab tour is an optional link on the last step, not a step.
 */
export const ONBOARDING_STEPS = ['welcome', 'connect', 'class', 'exams', 'notifications'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * A parent's steps are a student's again (docs/superpowers/specs/2026-11-02-parents-other-schools-design.md
 * §4.3א): Mashov before the class. The class used to come first, since each
 * child Mashov lists was matched to the phone's class (`parentRead`); now the
 * children come from Mashov, at any school, and the class step shows them
 * instead of asking for one. A parent who skips Mashov still gets the invite
 * link and the address on that step.
 */
const PARENT_STEPS: readonly OnboardingStep[] = ['welcome', 'connect', 'class', 'exams', 'notifications'];

/** The steps on this phone, in its order. */
export function onboardingSteps(audience: Audience = 'student'): readonly OnboardingStep[] {
  return audience === 'parent' ? PARENT_STEPS : ONBOARDING_STEPS;
}

/** Where a step sits in `steps`; one outside it, as many of its steps as come before it in the full list. */
function placeOf(step: OnboardingStep, steps: readonly OnboardingStep[]): number {
  const i = steps.indexOf(step);
  if (i >= 0) return i;
  // Not this audience's: as many of its steps as come before it in the full list.
  const full = ONBOARDING_STEPS.indexOf(step);
  return steps.filter((s) => ONBOARDING_STEPS.indexOf(s) < full).length - 0.5;
}

/** The step before, or `null` on the first — where back leaves onboarding to the system. */
export function stepBack(step: OnboardingStep, audience: Audience = 'student'): OnboardingStep | null {
  const steps = onboardingSteps(audience);
  const i = Math.ceil(placeOf(step, steps)) - 1;
  return i >= 0 ? steps[i]! : null;
}

/** The step after, or `null` on the last — where the button finishes instead. */
export function stepForward(step: OnboardingStep, audience: Audience = 'student'): OnboardingStep | null {
  const steps = onboardingSteps(audience);
  const i = Math.floor(placeOf(step, steps)) + 1;
  return i < steps.length ? steps[i]! : null;
}

/** "שלב 2 מתוך 5". */
export function stepLabel(step: OnboardingStep, audience: Audience = 'student'): string {
  const steps = onboardingSteps(audience);
  return `שלב ${Math.max(0, Math.round(placeOf(step, steps))) + 1} מתוך ${steps.length}`;
}

/**
 * Who the app is for on this phone (docs/parents-plan.md): the choice on the
 * welcome step and in Settings, and what a parent's class step says.
 */
export const AUDIENCE_COPY = {
  question: 'בשביל מי האפליקציה בטלפון הזה?',
  student: 'לתלמידים',
  parent: 'להורים',
  parentLine: 'המערכת של הכיתה, השינויים בה והמבחנים, ובבוקר מתי מסיימים. מתחברים למשוב עם הפרטים של ההורה, והילדים מגיעים משם.',
  /** A parent's connect step: the parent's own Mashov first (`PARENT_STEPS`), and Google if wanted. */
  connectTitle: 'מחברים את משוב, ו־Google אם רוצים',
  connectLead: 'כל חיבור לוקח דקה, ואפשר גם לדלג ולחבר אחר כך מההגדרות.',
  settingsLabel: 'מצב הורים',
  settingsHint: 'בלי משימות ותכנון, ובסיכום הבוקר השעה שבה מסיימים',
  toParent: 'עכשיו בתצוגה להורים',
  toStudent: 'עכשיו בתצוגה לתלמידים',
  classTitle: 'הכיתה',
  /** A parent whose Mashov brought children: the class step lists them (`classStepPage`'s `children`). */
  childrenTitle: 'הילדים שלך',
  childrenLead: 'אלה הילדים שמשוב רשם. אפשר לשנות את הרשימה אחר כך בהגדרות, ב״אני והילדים״.',
  /** A child's row when its school has no timetable site: the class is not followed. Settings' class row says the same (`SCHOOL_SITE_COPY.withoutRow`). */
  withoutSite: 'בלי אתר מערכת, המערכת ממשוב',
  /** Mashov was connected and listed no child who can be added here; above the way of today. */
  noneFromMashov: 'משוב לא רשם ילדים שאפשר להוסיף כאן.',
  classLead: 'הכי פשוט: הילד או הילדה שולחים קישור מהאפליקציה שלהם, במסך החברים, ב״להזמין הורה״. אפשר גם להדביק כאן את הכתובת של אתר המערכת של בית הספר.',
  examsTitle: 'המבחנים של הכיתה',
  examsSwitch: 'מבחנים חדשים',
} as const;

/**
 * A parent's children (parents mode, stage 2): up to six classes on one
 * phone. A child's name stays on the phone; until one is set, the class's
 * name stands for it (`childName`).
 */
export const CHILDREN_COPY = {
  heading: 'הילדים',
  /** The switcher above the days, for screen readers. */
  switcher: 'הכיתה שמוצגת',
  add: 'להוסיף ילד או ילדה',
  addHint: 'כיתה נוספת מאותו בית ספר. מבית ספר אחר: דרך קישור ״להזמין הורה״ מהאפליקציה של הילד או הילדה.',
  added: (name: string) => `הכיתה ${name} נוספה. בראש ״היום בכיתה״ אפשר לעבור בין הכיתות.`,
  already: 'הכיתה הזאת כבר ברשימה',
  full: 'אפשר לעקוב אחרי שש כיתות לכל היותר. אפשר להסיר אחת, ואז להוסיף.',
  noSite: 'כדי להוסיף כיתה צריך קודם כיתה אחת עם אתר מערכת.',
  nameLabel: 'השם בטלפון הזה',
  namePlaceholder: 'למשל, השם של הילד או הילדה',
  nameHint: 'השם נשמר רק בטלפון הזה, ולא נשלח לשום מקום.',
  remove: 'להסיר מהרשימה',
  save: 'שמירה',
  cancel: 'ביטול',
  shownNow: 'מוצגת עכשיו',
  /** The server has no route for more than one class yet (`syncOtherClasses`). */
  unsupported: 'ההתראות על שינויים מגיעות בינתיים רק על הכיתה שמוצגת עכשיו.',
  /** An invite link's class, on a parent's phone that has a class already. */
  inviteTitle: 'להוסיף את הכיתה מהקישור?',
  inviteBody: (current: string) => `הכיתה ${current} נשארת, ואפשר לעבור ביניהן בראש ״היום בכיתה״. אפשר גם להחליף אותה בכיתה מהקישור.`,
  inviteAdd: 'להוסיף',
  inviteReplace: 'להחליף',
  /** An invite to a class already on the list: it is put on screen. */
  inviteShown: (name: string) => `עכשיו מוצגת כאן הכיתה ${name}`,
} as const;

/** A child as the screens and the summaries name it: the parent's name for it, else its class's. */
export function childName(child: { label: string; className: string }): string {
  return child.label.trim() || displayClassName(child.className);
}

/**
 * The welcome step's one sentence: what the app gives, in a student's words
 * (the Wave 9 re-rate, after a list of the app's parts). No number of steps:
 * "ארבעה צעדים" under "שלב 1 מתוך 5" read as a mistake (Itai).
 */
export const WELCOME_LEAD = 'מה יש מחר, מה בוטל ומה צריך להגיש, בלי להיכנס למשוב.';

/**
 * The class step's one sentence. "מגמה" is a word a ninth grader may not know
 * (Maya): the step explains it beside the sentence, with lib/school's
 * `termExplainer` — the same words "השיעורים שלי" uses.
 */
export const CLASS_LEAD = 'המערכת והשינויים יוצגו לפי הכיתה, וכיתה עם מגמה (כמו ״8 ערבית״) היא מערכת נפרדת.';

// ---------------------------------------------------------------------------
// A school without a timetable site (plan Phase 3)
// ---------------------------------------------------------------------------

/**
 * The class step's page: the classes (`list`); or, with none, the way to them.
 * `connect`: Mashov is not connected, and the list comes through it. `site`:
 * Mashov is connected and no site is known, whether it named none or could
 * not say (an error, no network), so the student may paste the address or go
 * on without one. A site that is known (the class's, the pasted one or
 * Mashov's) but whose list did not come is `list`, which says the list has
 * not come yet; so is a step whose settings have not loaded.
 */
export type ClassStepPage = 'list' | 'connect' | 'site' | 'parent' | 'children';

const KNOWN_SITE: readonly SchoolSiteState['from'][] = ['class', 'pasted', 'mashov'];

/**
 * `children`: a parent whose Mashov brought `fromMashov` children (the phone's children with a Mashov link,
 * `mashovChildrenCount`): they are shown, and no class is asked for. It comes before every other rule.
 * `parent`: a parent with no list yet, whose way to it is the child's invite link or the site's address.
 */
export function classStepPage(
  classCount: number, mashovOk: boolean, site: Pick<SchoolSiteState, 'from'> | undefined, audience: Audience = 'student',
  fromMashov = 0,
): ClassStepPage {
  if (audience === 'parent' && fromMashov > 0) return 'children';
  if (classCount > 0) return 'list';
  if (audience === 'parent') return 'parent';
  if (!mashovOk) return 'connect';
  if (!site) return 'list';
  return KNOWN_SITE.includes(site.from) ? 'list' : 'site';
}

/**
 * The words for a school whose Mashov names no timetable site, on the class
 * step and in Settings' class picker. Mashov gives the address of the
 * school's timetable site, and the site the classes; many schools have none,
 * and their days come from Mashov's fixed timetable and the changes the
 * school enters there. In the student's words: "אתר המערכת", not "שחף".
 */
/**
 * An invite link (ideas ה2, `lib/invite.ts`): what the app says as it follows the link's class, and the rows that share one.
 * A student's words are about the people and their timetable, never a class to join: that the app reads a
 * class's data is how it works, not what it is for. A parent's phone shows a child's class, so there the
 * class is named.
 */
export const INVITE_COPY = {
  classGone: (parent: boolean) => `הקישור הזה כבר לא עובד. אפשר לבחור כיתה בהגדרות, ב״${mePageTitle(parent)}״.`,
  switchTitle: 'לעבור למערכת מהקישור?',
  switchBody: (current: string) => `עכשיו מופיעה כאן המערכת של ${current}. אחרי המעבר תופיע במקומה המערכת מהקישור.`,
  switchYes: 'לעבור',
  switchNo: 'ביטול',
  already: 'המערכת מהקישור כבר מופיעה כאן',
  joining: 'מכינים את המערכת…',
  /** On a parent's phone, which names the child's class. */
  joined: (name: string) => `עכשיו מופיעה כאן הכיתה ${name}`,
  joinedYours: 'המערכת שלך מוכנה',
  demo: 'בהדגמה אי אפשר לפתוח קישור הזמנה',
  row: 'לשלוח את סדר יום לחברים',
  rowHint: 'למי שעוד אין לו: הקישור פותח אצלו את סדר יום מוכנה',
  /** A student's invite to a parent, or a parent's to another (docs/parents-plan.md): the app opens as a parent's. */
  parentRow: 'להזמין הורה',
  parentRowHint: 'קישור שמראה להורה את המערכת, השינויים והמבחנים שלך, בלי משוב',
  otherParentRowHint: 'קישור שמראה להורה נוסף את מה שמופיע כאן, בלי משוב',
} as const;

export const SCHOOL_SITE_COPY = {
  /** Mashov not connected: nobody has asked it for the site yet. */
  connectLead: 'רשימת הכיתות מגיעה דרך משוב, אז היא תופיע כאן אחרי שמתחברים אליו.',
  connectButton: 'להתחבר למשוב',
  /** Mashov answered, and named no site. */
  noSiteLead: 'משוב לא נתן לנו את הכתובת של אתר המערכת של בית הספר, ובלי הכתובת אין רשימת כיתות.',
  /** Over the field, around the end of the address, which is drawn left to right between them. */
  pasteBefore: 'אם הכתובת של אתר המערכת נגמרת ב־',
  pasteAfter: ', אפשר להדביק אותה כאן.',
  fieldLabel: 'הכתובת של אתר המערכת',
  placeholder: 'להדביק את הכתובת',
  lookUp: 'לחפש את הכיתות',
  lookingUp: 'מחפשים…',
  notShahaf: 'זו לא נראית כמו כתובת של אתר מערכת. אפשר להעתיק אותה מהדפדפן, כשהמערכת של בית הספר פתוחה בו.',
  noAnswer: 'האתר לא ענה. כדאי לבדוק שהכתובת נכונה ולנסות שוב בעוד רגע.',
  withoutButton: 'להמשיך בלי אתר',
  /** What going on without a site means, beside its button. */
  withoutLine: 'המערכת תגיע ממשוב: המערכת הקבועה, עם השינויים שבית הספר מכניס למשוב. בלי אתר אין התראות על שינויים כשהאפליקציה סגורה.',
  /** The same in Settings, once there is no list: as it is now. */
  withoutNow: 'המערכת מגיעה ממשוב: המערכת הקבועה, עם השינויים שבית הספר מכניס למשוב. בלי אתר אין התראות על שינויים כשהאפליקציה סגורה.',
  /** Settings' class row, for a student who went on without a site. */
  withoutRow: AUDIENCE_COPY.withoutSite,
  /** A site is known, and its list did not come. */
  listNotYet: 'רשימת הכיתות עוד לא הגיעה מאתר בית הספר. אפשר לנסות שוב בעוד רגע.',
  /** A class picked with no site to follow it at (said only if Mashov went away in between). */
  noSiteToFollow: (parent: boolean) => `לא ידוע מה אתר המערכת של בית הספר. אפשר להדביק את הכתובת שלו בהגדרות, ב״${mePageTitle(parent)}״, תחת ״כיתה״.`,
} as const;

// ---------------------------------------------------------------------------
// Classes (F18)
// ---------------------------------------------------------------------------

/**
 * Grades in order, spelled as the school site spells them without punctuation.
 * יג and יד are the technological colleges' 13th and 14th years.
 */
const GRADE_ORDER = ['ז', 'ח', 'ט', 'י', 'יא', 'יב', 'יג', 'יד'] as const;

/** How a grade is written: a geresh after one letter, gershayim inside two. */
const GRADE_LABELS: Record<string, string> = {
  ז: 'ז׳', ח: 'ח׳', ט: 'ט׳', י: 'י׳', יא: 'י״א', יב: 'י״ב', יג: 'י״ג', יד: 'י״ד',
};

// How a class name reads, grade, number and track: `./className`.
export { parseClassName, type ParsedClassName } from './className';

/**
 * Whether the class sits bagrut exams: not in middle school (ז–ט). A class
 * name with no grade, or no class yet, counts as one that does, so nothing
 * is hidden from a student the app cannot place.
 */
export function hasBagrut(className: string | null | undefined): boolean {
  if (!className) return true;
  const { grade } = parseClassName(className);
  return grade !== 'ז' && grade !== 'ח' && grade !== 'ט';
}

/** "יב3מוסיקה" → "י״ב 3 מוסיקה", "יא 7" → "י״א 7", "י1" → "י׳ 1". Display only; ids and stored names stay as the site has them. */
export function displayClassName(name: string): string {
  const { grade, number, rest } = parseClassName(name);
  if (grade === null) return rest;
  return [GRADE_LABELS[grade] ?? grade, number !== null ? String(number) : '', rest].filter(Boolean).join(' ');
}

export interface ClassItem {
  id: string;
  /** As the site lists it — what is saved. */
  name: string;
  /** The full display form: "י״א 3 מוזיקה". */
  display: string;
  /** What the chip shows under its grade header: "3 מוזיקה". */
  short: string;
}

export interface ClassGroup {
  /** The grade (`'יא'`) or `''` for the classes with none. */
  grade: string;
  /** "שכבה י״א", or "אחר". */
  label: string;
  items: ClassItem[];
}

/**
 * The class list in grade groups, low grade first, classes with no grade last.
 * Inside a group: by number, the plain class before its tracks ("3" before
 * "3 מוזיקה").
 */
export function groupClasses(classes: readonly ClassOption[]): ClassGroup[] {
  const byGrade = new Map<string, { item: ClassItem; parsed: ParsedClassName; index: number }[]>();
  classes.forEach((option, index) => {
    const parsed = parseClassName(option.name);
    const key = parsed.grade ?? '';
    const display = displayClassName(option.name) || option.name;
    const short = parsed.grade === null
      ? display
      : [parsed.number !== null ? String(parsed.number) : '', parsed.rest].filter(Boolean).join(' ') || display;
    const list = byGrade.get(key) ?? [];
    list.push({ item: { id: option.id, name: option.name, display, short }, parsed, index });
    byGrade.set(key, list);
  });

  const rank = (grade: string): number => {
    const i = (GRADE_ORDER as readonly string[]).indexOf(grade);
    return grade === '' ? 1000 : i === -1 ? 999 : i;
  };
  return [...byGrade.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([grade, list]) => ({
      grade,
      label: grade === '' ? 'אחר' : `שכבה ${GRADE_LABELS[grade] ?? grade}`,
      items: list
        .sort((x, y) =>
          (x.parsed.number ?? Infinity) - (y.parsed.number ?? Infinity)
          || (x.parsed.rest === '' ? 0 : 1) - (y.parsed.rest === '' ? 0 : 1)
          || x.index - y.index)
        .map((entry) => entry.item),
    }));
}

// ---------------------------------------------------------------------------
// Exams (F5)
// ---------------------------------------------------------------------------

/**
 * What the recommendation needs of an exam (an `ExamOption` is one).
 * `confirmed` is lib/school's: the screen passes its exams through
 * `withConfirmed` once, and every function here reads the same answers.
 */
export interface RecommendableExam {
  naturalKey: string;
  date: string;
  subject: string;
  subjectKey: string;
  match: ExamMatch;
  confirmed?: boolean;
  /** A bagrut exam from Mashov's own list (plan §14.9): always the owner's (`examMine`). */
  kind?: 'bagrut' | 'manual';
}

/**
 * The exam is the owner's as far as the step can tell: the server matched it
 * (`mine === true`) or it is a bagrut exam (`examMine`), or it could not and
 * the owner said "שלי" (W6-2) — then it is one of "N נראים שלך", not one more "?".
 */
export function looksMine(exam: Pick<RecommendableExam, 'match' | 'confirmed' | 'kind'>): boolean {
  const mine = examMine(exam);
  return mine === true || (mine === null && exam.confirmed === true);
}

/**
 * The recommendation on its own: exams that look like the owner's
 * (`looksMine`) are shown, exams that plainly are not are hidden, and the
 * unsure ones (`mine === null`) stay exactly as they were — as does every key
 * that is not in `exams` at all (a past exam, one the site dropped).
 *
 * It decides whether the step still has something to offer (`examStepView`):
 * a hide-list it leaves unchanged is applied already, and a second run from
 * Settings does not offer again — nor undo an unsure exam hidden on purpose.
 * What "המשך" saves is `examStepOffer`.
 */
export function applyExamRecommendation(exams: readonly RecommendableExam[], hiddenKeys: readonly string[]): string[] {
  const mine = new Set(exams.filter(looksMine).map((e) => e.naturalKey));
  const out = hiddenKeys.filter((key) => !mine.has(key));
  const present = new Set(out);
  for (const exam of exams) {
    if (examMine(exam) !== false || mine.has(exam.naturalKey) || present.has(exam.naturalKey)) continue;
    out.push(exam.naturalKey);
    present.add(exam.naturalKey);
  }
  return out;
}

/** Whether two hide-lists hide the same exams, in whatever order. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/**
 * An exam the server cannot place either way (`mine === null`) and the owner
 * has not confirmed: listed with "?" (plan W4-4, W6-2). Never a bagrut exam.
 */
export function isUnsureExam(exam: Pick<RecommendableExam, 'match' | 'confirmed' | 'kind'>): boolean {
  return examMine(exam) === null && exam.confirmed !== true;
}

/**
 * What the step's "המשך" saves (run 7): the recommendation, with every exam
 * the server could not place kept — with its "?" — unless the owner said
 * "לא שלי" to it on this step (`hiddenHere`). The same reason gets the same
 * start, and an exam is never silently lost: gush א׳ started hidden and gush
 * ב׳ kept, both "לא כתוב אילו מקצועות בגוש" (Noa).
 */
export function examStepOffer(
  exams: readonly RecommendableExam[],
  hiddenKeys: readonly string[],
  hiddenHere: readonly string[] = [],
): string[] {
  const here = new Set(hiddenHere);
  const unsure = exams.filter((e) => examMine(e) === null);
  const keep = unsure.filter((e) => !here.has(e.naturalKey)).map((e) => e.naturalKey);
  const drop = unsure.filter((e) => here.has(e.naturalKey) && !looksMine(e)).map((e) => e.naturalKey);
  return setExamsShown(setExamsShown(applyExamRecommendation(exams, hiddenKeys), keep, true), drop, false);
}

/**
 * What the exam step shows (plan W5-11):
 * - `none`: no exam looks like the owner's, so there is nothing to
 *   recommend; marking is done in "המבחנים שלי". The count is what is marked now.
 * - `offer`: the recommendation, not applied yet — the step's count is what
 *   its "המשך" will mark (`examStepOffer`).
 * - `marked`: applied here, or already so. From then on the step counts only
 *   what is marked now — after "המבחנים שלי", whatever was changed there —
 *   and never the recommendation's numbers again.
 */
export type ExamStepPhase = 'none' | 'offer' | 'marked';

export interface ExamStepView {
  phase: ExamStepPhase;
  /**
   * The step's one number. `offer`: what will be marked after "המשך".
   * Otherwise: what is marked now — `examCounts().chosen`, the number "המבחנים שלי" shows.
   */
  total: number;
  /**
   * How many of `total` are still "?" — unsure, and not answered: exactly the
   * rows "לבדוק עכשיו" shows with a "?" (`examStepRowState`), and
   * `examCounts().unsure` once marked.
   */
  unsure: number;
  /** `offer` only: how many of `total` look like the owner's. */
  mine: number;
  /**
   * The hide-list the step's rows and numbers read: `examStepOffer`'s while
   * offering — the list "המשך" saves — else the one saved now.
   */
  hidden: string[];
}

/**
 * The exam step under the live hide-list. `appliedHere`: the recommendation
 * was applied in this onboarding, by "המשך" — it stays `marked` however
 * "המבחנים שלי" changes the marks after that. `hiddenHere`: the exams the
 * owner said "לא שלי" to on this step.
 */
export function examStepView(
  exams: readonly RecommendableExam[],
  hiddenKeys: readonly string[],
  appliedHere: boolean,
  hiddenHere: readonly string[] = [],
): ExamStepView {
  const count = (hidden: string[], phase: ExamStepPhase, mine: number): ExamStepView => {
    const counts = examCounts(exams, new Set(hidden), new Set());
    return { phase, total: counts.chosen, unsure: counts.unsure, mine, hidden };
  };
  if (!exams.some(looksMine)) return count([...hiddenKeys], 'none', 0);
  if (appliedHere || sameKeys(applyExamRecommendation(exams, hiddenKeys), hiddenKeys)) return count([...hiddenKeys], 'marked', 0);
  return count(examStepOffer(exams, hiddenKeys, hiddenHere), 'offer', exams.filter(looksMine).length);
}

/**
 * One row of "לבדוק עכשיו" has one state (run 7: "לא שלי" left a row with "?"
 * and "לא מסומן"): hidden ("הוסתר"), the owner's ("שלי", with a drawn tick),
 * or not decided yet ("?"). `hidden` is `examStepView().hidden`, so a row
 * says what "המשך" will leave.
 */
export type ExamRowState = 'mine' | 'hidden' | 'open';

export function examStepRowState(exam: Pick<RecommendableExam, 'naturalKey' | 'confirmed'>, hidden: ReadonlySet<string>): ExamRowState {
  if (hidden.has(exam.naturalKey)) return 'hidden';
  return exam.confirmed === true ? 'mine' : 'open';
}

/**
 * What a row's state reads as, at its end. No tick in the words (plan §16.2):
 * the screen draws one beside "שלי".
 */
export const EXAM_ROW_LABELS: Readonly<Record<ExamRowState, string>> = { mine: 'שלי', hidden: 'הוסתר', open: '?' };

/** "15 מבחנים מסומנים כשלך" — the words "המבחנים שלי" counts with (plan R-16). */
export function examsMarkedLabel(n: number): string {
  if (n === 0) return 'אין מבחנים שסומנו כשלך';
  return plural(n, 'מבחן אחד מסומן כשלך', 'מבחנים מסומנים כשלך');
}

/**
 * The step's count line (plan §14.7: Itai did not read the step, Maya was
 * anxious), under the title "המבחנים שלך". The count is `examStepView`'s, so
 * it is "המבחנים שלי"'s once marked; `published` is how many exams the
 * grade's schedule has at all.
 *
 * While some are "?" it is the number alone, "15 מבחנים", the same before
 * and after "המשך"; the "?" ones get the line under it (`examStepLeaveLine`),
 * not a chain of details after a "·" (plan §16.2).
 */
export function examStepLine(view: Pick<ExamStepView, 'phase' | 'total' | 'unsure'>, published: number): string {
  if (published === 0) return 'עוד אין מבחנים בלוח של השכבה';
  if (view.total === 0) return 'אין מבחנים שסומנו כשלך, ואפשר לסמן אחר כך';
  if (view.unsure > 0) return view.total === 1 ? 'מבחן אחד' : `${view.total} מבחנים`;
  return view.phase === 'offer' ? plural(view.total, 'מבחן אחד נראה שלך', 'מבחנים נראים שלך') : examsMarkedLabel(view.total);
}

/**
 * The count line while the step reads the class again (`reason`): after a class was picked, and after a board was saved
 * from the step. Each says what the person did, in words about them.
 */
export function examStepCheckingLine(reason: 'class' | 'board'): string {
  return reason === 'board' ? 'בודקים אילו מבחנים מהלוח מתאימים לך…' : 'בודקים אילו מבחנים מתאימים לכיתה שבחרת…';
}

/**
 * Under the count, while some exams are still "?": how many, and that
 * checking them can wait (plan §16.2's words; run 7: "המשך" turned them into
 * "16 מבחנים מסומנים כשלך", and Daniel and Itai read it as deciding for
 * them). The number is exactly the rows "לבדוק עכשיו" shows with a "?".
 * `null` when none is left.
 */
export function examStepLeaveLine(open: number): string | null {
  if (open <= 0) return null;
  return open === 1
    ? 'על מבחן אחד אנחנו לא בטוחים. אפשר לעבור עליו עכשיו או אחר כך.'
    : `על ${open} מבחנים אנחנו לא בטוחים. אפשר לעבור עליהם עכשיו או אחר כך.`;
}

/**
 * The toast after "המשך": what was marked, and how many of them are worth a
 * look — "סימנו 19 מבחנים שלך. על 6 כדאי להציץ." In words, not "6 עם ״?״"
 * (the Wave 9 re-rate).
 */
export function examStepDoneToast(view: Pick<ExamStepView, 'total' | 'unsure'>): string {
  if (view.total === 0) return examsMarkedLabel(0);
  const marked = `סימנו ${plural(view.total, 'מבחן אחד', 'מבחנים')} שלך.`;
  if (view.unsure <= 0) return marked;
  return `${marked} על ${view.unsure === 1 ? 'אחד' : view.unsure} כדאי להציץ.`;
}

/**
 * That toast's action: it says what it undoes (run 8, Noa: "לבטל" alone did
 * not say what it would take back). It puts the hidden exams back as they were.
 */
export const EXAM_STEP_UNDO = 'לבטל את הסימון';

/**
 * The step's "לבדוק עכשיו": every exam the server could not place, decided
 * or not — each with its one state (`examStepRowState`), so "לא שלי" and
 * "שלי" leave the row where it was, as "הוסתר" or "שלי ✓" (run 7) — in
 * "המבחנים שלי"'s own groups (`groupExamsBySubject`): "גוש ב׳" is one group
 * whether or not the site listed its subjects, never "מבחני גוש" in one place
 * and "אחר" in another.
 */
export function examStepUnsure<E extends RecommendableExam>(exams: readonly E[]): ExamGroup<E>[] {
  return groupExamsBySubject(exams.filter((exam) => examMine(exam) === null));
}

/** A school word on the exam step, and the sentence that explains it. */
export interface ExamStepTerm {
  key: 'block' | 'mock';
  /** The link: "מה זה גוש?". */
  question: string;
  answer: string;
}

/**
 * "מה זה גוש?" and "מה זה מתכונת?" (W6-8, Maya: "the exam step was full of
 * words I did not know"), each only while an exam the step lists holds the
 * word — a block's group, or the word in a title.
 */
export function examStepTerms(exams: readonly Pick<RecommendableExam, 'naturalKey' | 'date' | 'subject' | 'subjectKey' | 'match'>[]): ExamStepTerm[] {
  const terms: ExamStepTerm[] = [];
  if (exams.some((e) => isBlockGroup(examGroupKey(e)) || /גוש(?![א-ת])/.test(e.subject))) {
    terms.push({ key: 'block', question: 'מה זה גוש?', answer: BLOCK_EXPLAINER });
  }
  if (exams.some((e) => /מתכונת/.test(e.subject))) terms.push({ key: 'mock', question: 'מה זה מתכונת?', answer: MOCK_EXAM_EXPLAINER });
  return terms;
}

// ---------------------------------------------------------------------------
// The footer (Daniel: the toast covered "המשך")
// ---------------------------------------------------------------------------

/**
 * The onboarding footer, top to bottom: padding, one row of buttons, the step
 * dots (44-point targets: a hitSlop could not reach past their row), and
 * padding over the phone's own bottom inset. One row of buttons and no more —
 * a step's other choices sit in the page above it — so the whole footer stays
 * under the line a toast floats at (`toastBottom` in components/Toast), and
 * the toast that confirms one step never covers the next step's "המשך".
 */
export const FOOTER = { paddingTop: 12, dotsGap: 4, dots: 44, paddingBottom: 12 } as const;

/** The footer's height with a button row `rowHeight` tall, over `bottomInset`. */
export function footerHeight(rowHeight: number, bottomInset: number, withDots = true): number {
  return FOOTER.paddingTop + rowHeight + (withDots ? FOOTER.dotsGap + FOOTER.dots : 0) + FOOTER.paddingBottom + bottomInset;
}

/**
 * Whether the step dots fit under the toast line too. At the largest fonts the
 * button row grows; the dots — a shortcut, the back button and "המשך" do the
 * same — give way before the buttons would.
 */
export function stepDotsFit(rowHeight: number, bottomInset: number, toastLine: number): boolean {
  return footerHeight(rowHeight, bottomInset) <= toastLine;
}

// ---------------------------------------------------------------------------
// Settings counts (R-25)
// ---------------------------------------------------------------------------

/** "10 מקצועות שלך מוצגים" — it counts subjects, not lessons a week. */
export function subjectsShownLabel(n: number): string {
  if (n === 0) return 'אף מקצוע לא מוצג';
  return plural(n, 'מקצוע אחד שלך מוצג', 'מקצועות שלך מוצגים');
}

export function calendarsShownLabel(n: number): string {
  if (n === 0) return 'אף יומן לא מוצג';
  return plural(n, 'יומן אחד מוצג', 'יומנים מוצגים');
}

/**
 * The titles of Settings' pages, one per group on the main screen. Here and not
 * in settingsSummary so the pages and the lines under the groups say the same
 * words without an import cycle.
 */
export const SETTINGS_PAGE_TITLES = {
  notifications: 'התראות וזמנים',
  me: 'אני ובית הספר',
  meParent: 'אני והילדים',
  google: 'Google',
  shown: 'מה מוצג',
  appearance: 'מראה',
} as const;

/** The title of the page about the person: a parent's is about the children too. */
export function mePageTitle(parent: boolean): string {
  return parent ? SETTINGS_PAGE_TITLES.meParent : SETTINGS_PAGE_TITLES.me;
}

/** Said beside the calendar count: which calendars these are. */
export const CALENDARS_HINT = 'יומנים מחשבון ה־Google שלך (אישי, משפחה, חוגים…)';

/** What Settings needs of `/settings` to count; a `SettingsResponse` is one. */
export interface CountableSettings {
  subjects: readonly LessonOptionLike[];
  exams: readonly { naturalKey: string }[];
  calendars: readonly { id: string; isSchoolCalendar?: boolean; isExamCalendar?: boolean }[];
  settings: {
    lessons: { hiddenSubjects: readonly string[] };
    exams: { hiddenKeys: readonly string[] };
    calendars: { hiddenCalendarIds: readonly string[] };
  };
}

/**
 * The three numbers on Settings' links, said the positive way, as the screens
 * behind them say it: subjects shown, exams marked (the number "המבחנים שלי"
 * shows), calendars shown — not counting the two calendars the app reads as
 * exams or writes the exams to, which are never shown on their own.
 */
export function settingsCounts(data: CountableSettings): { subjects: number; exams: number; calendars: number } {
  const hiddenSubjects = new Set(data.settings.lessons.hiddenSubjects);
  const hiddenExams = new Set(data.settings.exams.hiddenKeys);
  const hiddenCalendars = new Set(data.settings.calendars.hiddenCalendarIds);
  return {
    // Rows, as "השיעורים שלי" counts them: one per subject and teacher, a row
    // shown while any of its lines is (run 5: Settings said 11 and the screen 8).
    subjects: groupLessonOptions(data.subjects).filter((g) => lessonGroupState(g, hiddenSubjects) !== false).length,
    exams: data.exams.filter((x) => !hiddenExams.has(x.naturalKey)).length,
    calendars: data.calendars.filter((c) => !c.isSchoolCalendar && !c.isExamCalendar && !hiddenCalendars.has(c.id)).length,
  };
}

/**
 * Under "שעות שקטות", the one line that says what they do — it replaced a
 * hint and a paragraph saying it twice (Itai did not read them).
 */
export const QUIET_HOURS_HINT = 'התראות יחכו לסוף השעות השקטות, וסיכום הבוקר יגיע בכל מקרה';

/**
 * The notification switches' names where shared's `NOTIFICATION_LABELS` says
 * more than is true: the evening reminder looks at the next school day (plan
 * W4-1) — on a Thursday that is Sunday, not "מחר".
 */
export const NOTIFICATION_SWITCH_LABELS: Partial<Readonly<Record<NotificationType, string>>> = {
  evening_homework: 'תזכורת ערב: מה להגיש ומה להביא',
};

// ---------------------------------------------------------------------------
// Appearance (R-26)
// ---------------------------------------------------------------------------

export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  light: 'בהיר',
  dark: 'כהה',
  system: 'לפי הטלפון',
};

/** The in-app text sizes (plan W4-2), in the order the settings row shows them. */
export const TEXT_SCALE_ORDER: readonly TextScale[] = ['normal', 'large', 'xlarge'];

/** Under the text-size choice: the phone's own font size still applies, on top of it. */
export const TEXT_SIZE_NOTE = 'גם גודל הגופן שבהגדרות הטלפון חל כאן, בנוסף לגודל שבוחרים פה.';

/**
 * The line drawn at the chosen size: calm, and about nothing the owner might
 * take for real news — "מחר מבחן באנגלית" startled Maya (W5-12).
 */
export const TEXT_SIZE_SAMPLE = 'מחר יום ראשון';

/** How Today draws lessons of one subject in a row: as one row ("1–4"), or a row for each period. */
export type LessonRows = 'together' | 'apart';

export const LESSON_ROWS_ORDER: readonly LessonRows[] = ['together', 'apart'];

export const LESSON_ROWS_LABELS: Readonly<Record<LessonRows, string>> = {
  together: 'שורה אחת',
  apart: 'שורה לכל שיעור',
};

export const LESSON_ROWS_TITLE = 'שיעורים רצופים באותו מקצוע';

/** Under the choice: the week stays as it is. */
export function lessonRowsNote(audience: Audience = 'student'): string {
  return `רק במסך ״${todayTabTitle(audience)}״.`;
}

// ---------------------------------------------------------------------------
// The tabs (F17): the onboarding tour and the help screen say the same thing.
// ---------------------------------------------------------------------------

export interface TabGuideEntry {
  icon: IconName;
  title: string;
  body: string;
}

/**
 * The two buttons at the top of every tab, said once in the tour and in help:
 * the bell now carries how many notifications are new, and the gear the dot
 * for a connection to check (Wave 5 foundation).
 */
export const HEADER_GUIDE = 'בראש כל מסך, הפעמון פותח את ההתראות שהגיעו, ומספר עליו אומר כמה מהן חדשות. גלגל השיניים פותח את ההגדרות ואת העזרה, ונקודה עליו אומרת שחיבור צריך בדיקה.';

export const TAB_GUIDE: readonly TabGuideEntry[] = [
  { icon: 'day', title: 'היום שלי', body: 'מה יש היום: השיעורים לפי הסדר, מה בוטל או השתנה, מה להגיש ומתי המבחן הבא.' },
  { icon: 'week', title: 'שבוע', body: 'כל השבוע במבט אחד, עם ביטולים, שינויים ומבחנים.' },
  { icon: 'plan', title: 'תכנון', body: 'לוח חודשי ומה מתוכנן בשבועיים הקרובים: מבחנים, הגשות, משימות ויומן Google.' },
  // Not "Google Tasks": Maya took it for one more app to install.
  { icon: 'tasks', title: 'משימות', body: 'להוסיף משימות ולסמן מה בוצע, בלי אפליקציה נוספת. אפשר גם לשמור אותן בחשבון ה־Google שלך.' },
  { icon: 'school', title: 'בית ספר', body: 'מבחנים, ציונים, שיעורי בית והודעות ממורים, כמו שהם מופיעים במשוב.' },
];

/** A parent's tour (docs/parents-plan.md): the three tabs a parent has, in a parent's words. */
const PARENT_TAB_GUIDE: readonly TabGuideEntry[] = [
  { icon: 'day', title: 'היום בכיתה', body: 'מה יש היום בכיתה: השיעורים לפי הסדר, מה בוטל או השתנה, ומתי מסיימים.' },
  { icon: 'week', title: 'שבוע', body: 'כל השבוע במבט אחד, עם ביטולים, שינויים ומבחנים.' },
  { icon: 'school', title: 'בית ספר', body: 'המבחנים וההודעות שבית הספר מפרסם באתר המערכת. אחרי התחברות למשוב כהורה, גם הציונים, שיעורי הבית והחיסורים.' },
];

export function tabGuide(audience: Audience = 'student'): readonly TabGuideEntry[] {
  return audience === 'parent' ? PARENT_TAB_GUIDE : TAB_GUIDE;
}

/** The first tab's name: a parent's day is the class's. */
export function todayTabTitle(audience: Audience = 'student'): string {
  return audience === 'parent' ? 'היום בכיתה' : 'היום שלי';
}
