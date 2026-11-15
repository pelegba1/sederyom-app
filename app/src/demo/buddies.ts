/**
 * The demo's made-up friend (friends spec 7): ״נועה״, in a made-up ״יא3״ at
 * the demo's school, sharing her timetable, her absences, her grades and her
 * bagrut (and the student shares the same with her), so the friends screen, a
 * friend's page with its grades tab and the line on Today all show in the demo
 * and in the store's pictures.
 *
 * Her class's feed is the demo's own (`demo/data.ts`) with the first lesson
 * gone on her first two school days from today, so she starts later on them
 * and still ends with the student, and one lesson with a substitute on the
 * third. Its free periods are the student's, on Monday (the fourth) and on
 * Wednesday (the fifth), so on those days the two share a window, and on a
 * Monday morning Today says ״חלון משותף עם נועה 10:30–11:35״. Her box has the
 * demo's math exam on the same day and an exam of her own, and was written
 * twenty minutes ago.
 *
 * Her grades box (`theirGrades`) is made by the same function as a real one
 * (`myGradesContent`) from a few grades of hers, set beside the demo's own:
 * two of its math assessments and one of its physics, on the same days and
 * under the same names, so each is one row with a grade of each; one more
 * grade of hers in each of those two subjects, and two in English on days the
 * student has none, so those are hers alone; and a subject only she has
 * (civics). Her bagrut has two questionnaires the student sat too and one only
 * she did. Her marks are close to the student's, higher on some and lower on
 * others. Her other dates are school days back from today, as the demo's own are.
 *
 * Built for the day it is asked for and never stored, like the rest of the
 * demo. Pure: the clock and the zone in, plain data out. Her secret is no
 * secret, and nothing of this is ever sent: the demo reaches no server.
 */
import type { BuddyAbsence, BuddyBagrutRow, BuddyBoxContent, BuddyExam, BuddyGradesContent, BuddyShares, ClassFeed } from '@sederyom/shared';
import { currentSemester } from '@sederyom/shared';
import { examSubjectKey } from '@sederyom/shared/logic/exam-match';
import type { MashovGrade } from '@sederyom/shared/logic/mashov/normalize';
import { myGradesContent, type GradeLike } from '../buddies/grades';
import { buddyFeedKey, type Buddy, type BuddiesState } from '../buddies/store';
import { EMPTY_WEIGHTS } from '../lib/gradeWeights';
import { DEMO_SITE, DEMO_SUBSTITUTE, demoData, demoToday, type DemoData } from './data';

/** Her class, as the demo's school site would list it. */
export const DEMO_BUDDY_CLASS = { id: 'demo-class-3', name: 'יא3' } as const;

const ago = (now: Date, minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();

/** Her absences, as her own phone counted them: one subject close to its limit. */
const ABSENCES: readonly BuddyAbsence[] = [
  { subject: 'מתמטיקה', counted: 2, allowed: 6, level: 'ok' },
  { subject: 'אנגלית', counted: 1, allowed: 5, level: 'ok' },
  { subject: 'פיזיקה', counted: 3, allowed: 5, level: 'close' },
  { subject: 'היסטוריה', counted: 0, allowed: 3, level: 'ok' },
  { subject: 'ביולוגיה', counted: 1, allowed: 6, level: 'ok' },
];

/** What both of them share in the demo: everything. */
const SHARES: BuddyShares = { timetable: true, absences: true, grades: true, bagrut: true };

/**
 * Her grades box (see above): built as her phone would, over grades of hers.
 * An assessment she shares with the student is his grade's own (by its key in
 * `demoData`): the same day, the same name, with her mark; one the demo no
 * longer has is left out.
 */
function herGrades(demo: DemoData, readAt: string): BuddyGradesContent {
  const own = demo.mashov.filter((e) => e.kind === 'grade').map((e) => e.payload as MashovGrade);
  const sameExam = (key: string, value: number): GradeLike[] => {
    const g = own.find((o) => o.naturalKey === `mashov-grade|${key}`);
    return g ? [{ naturalKey: `demo-noa|${key}`, date: g.date, subject: g.subject, value, valueText: null, weight: null, notes: g.notes }] : [];
  };
  // Hers alone, on the school day `n` back from today (`demo.pastDays`, the days the student's own grades fall on). Each is on a day the student has no grade
  // of the subject: with one grade of each side left on a date, `compareGrades` makes a pair of them whatever their names.
  const hers = (subject: string, n: number, notes: string, value: number): GradeLike[] => {
    const date = demo.pastDays[n];
    return date ? [{ naturalKey: `demo-noa|${subject}|${date}`, date, subject, value, valueText: null, weight: null, notes }] : [];
  };
  const grades: GradeLike[] = [
    // Math: the exam on equations (the student 92) and the quiz on the quadratic function (85).
    ...sameExam('demo-1', 84),
    ...sameExam('demo-7', 90),
    ...hers('מתמטיקה', 10, 'עבודה בגיאומטריה', 87),
    // Physics: the quiz on kinematics (82).
    ...sameExam('demo-10', 80),
    ...hers('פיזיקה', 2, 'דוח על חוק ניוטון', 85),
    // English: she is ahead of the student here (his 88 and 91).
    ...hers('אנגלית', 5, 'הבנת הנקרא', 90),
    ...hers('אנגלית', 8, 'הצגה בעל פה', 94),
    ...hers('אזרחות', 4, 'בוחן בזכויות האזרח', 83),
    ...hers('אזרחות', 11, 'עבודה על מערכת המשפט', 92),
  ];
  // The student's questionnaires, by code, in the same sitting, with her marks (the final between the school's and the exam's).
  const moed = demo.bagrut.find((b) => b.semel === 11251)?.moed;
  const bagrut: BuddyBagrutRow[] = moed === undefined ? [] : [
    { semel: 1261, name: 'תנ״ך', moed, school: 83, exam: 85, final: 84 },
    { semel: 11251, name: 'עברית: הבעה ולשון', moed, school: 82, exam: 76, final: 79 },
    // Assessed at school, as the student's second Tanakh questionnaire is.
    { semel: 34281, name: 'אזרחות', moed, school: 88, final: 88 },
  ];
  return { ...myGradesContent({ grades, weights: EMPTY_WEIGHTS, bagrut: [], withBagrut: false, readAt }), bagrut };
}

export function demoBuddies(now: Date, zone: string): { state: BuddiesState; feeds: Record<string, ClassFeed> } {
  const today = demoToday(now, zone);
  const demo = demoData(now, zone);
  const ahead = [...new Set(demo.feed.lessons.map((l) => l.date))].filter((d) => d >= today).sort();
  const late = new Set(ahead.slice(0, 2));
  const changedOn = ahead[2];
  const feed: ClassFeed = {
    ...demo.feed,
    class: { ...demo.feed.class, classId: DEMO_BUDDY_CLASS.id, className: DEMO_BUDDY_CLASS.name },
    lessons: demo.feed.lessons
      .filter((l) => !(late.has(l.date) && l.hourIndex === 1))
      .map((l) => (l.date === changedOn && l.hourIndex === 2 ? { ...l, status: 'substitution' as const, substitute: DEMO_SUBSTITUTE } : l)),
  };

  const exam = (date: string | undefined, title: string): BuddyExam[] => (date ? [{ date, subject: examSubjectKey(title), title }] : []);
  const math = demo.feed.exams.find((e) => e.naturalKey === 'demo-exam|math');
  const exams = [...exam(math?.date ?? undefined, math?.subject ?? ''), ...exam(ahead[5] ?? ahead.at(-1), 'בוחן בביולוגיה')]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const { semesterStart, semesterEnd } = currentSemester(today);
  const box: BuddyBoxContent = {
    v: 1,
    at: ago(now, 20),
    name: 'נועה',
    shares: { ...SHARES },
    timetable: { siteUrl: DEMO_SITE, classId: DEMO_BUDDY_CLASS.id, className: DEMO_BUDDY_CLASS.name, hiddenSubjects: [], exams },
    absences: { semesterStart, semesterEnd, subjects: [...ABSENCES] },
  };
  const noa: Buddy = {
    id: 'demo-noa',
    role: 'inviter',
    secret: 'demo',
    name: 'נועה',
    label: '',
    shares: { ...SHARES },
    theirs: box,
    readAt: box.at,
    everRead: true,
    written: null,
    theirGrades: herGrades(demo, box.at),
    gradesWritten: null,
    gradesDot: false,
    addedAt: ago(now, 3 * 24 * 60),
  };
  return {
    state: { myName: '', buddies: [noa], invites: [], answers: [], unseen: false, notes: [] },
    feeds: { [buddyFeedKey(DEMO_SITE, DEMO_BUDDY_CLASS.id)]: feed },
  };
}
