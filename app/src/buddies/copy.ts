/**
 * Every word the friends screens say (docs/superpowers/specs/2026-10-29-friends-design.md,
 * 2.2 to 2.7). Gender-neutral, since the app never knows a friend's gender
 * ("מסיימים", "סוף היום: נועה"), and about a friend's timetable, never their
 * class. A line with a range in it goes through `isolateRanges`, so
 * "11:15–12:20" keeps its order inside a Hebrew line.
 *
 * A name is a person's choice in any script, so every name a line sets is in
 * an isolate (`isolateName`): "Noa" or "נועה B." never turns the Hebrew
 * around it. A function that takes `name` isolates it; one that takes
 * `names` takes a list made by `buddyNames` or `edgeNames`, which isolate
 * each name in it.
 */
import type { BuddyShares } from '@sederyom/shared';
import { MAX_BUDDIES } from '@sederyom/shared';
import { namesList } from '@sederyom/shared/logic/buddies-compare';
import { isolateName, isolateRanges } from '../lib/format';
import { BUDDY_NOTES } from './protocol';

const who = isolateName;

/** Friends' names in a line, each isolated, as Hebrew lists them: ״נועה ויואב״, from three on ״נועה ועוד 2״. */
export function buddyNames(names: readonly string[]): string {
  return namesList(names.map(isolateName));
}

/** Names at an edge of the day, as the spec writes them: up to three by name, ״נועה, יואב, דנה״; past three, ״נועה ועוד 3״. */
export function edgeNames(names: readonly string[]): string {
  return names.length <= 3 ? names.map(isolateName).join(', ') : buddyNames(names);
}

export const BUDDY_COPY = {
  title: 'חברים',
  /** The header's button with its dot: a friend arrived since the screen was last open (2.1). */
  titleUnseen: 'חברים, יש חבר חדש',
  add: 'להוסיף חבר',
  /** Above the add row while there is no friend and no invite yet. */
  emptyLead: 'כאן רואים מתי מסיימים יחד עם חברים, ומתי יש חלון משותף.',
  /** The greyed row of my links still open; `waiting` under it (2.3). */
  invitesSent: (n: number) => (n === 1 ? 'הזמנה אחת ששלחת' : `${n} הזמנות ששלחת`),
  /** Beside the count of my links still open: more friends can still answer them, also after the first has (2.3). */
  waiting: (n: number) => (n === 1 ? 'הקישור עדיין פתוח' : 'הקישורים עדיין פתוחים'),
  /** A tap on that row asks first, in a sheet: the links close, and the friends who already answered them stay. */
  cancelInvitesTitle: (n: number) => (n === 1 ? 'לסגור את הקישור?' : 'לסגור את הקישורים?'),
  cancelInvitesWhat: (n: number) => (n === 1 ? 'החברים שכבר אישרו נשארים. הקישור לא יהיה בתוקף יותר.' : 'החברים שכבר אישרו נשארים. הקישורים לא יהיו בתוקף יותר.'),
  cancelInvitesYes: (n: number) => (n === 1 ? 'לסגור את הקישור' : 'לסגור את הקישורים'),
  cancelInvitesKeep: 'להשאיר',
  /** A friend who approved, whose first box has not come yet (4.5). */
  waitingFirst: 'מחכים לעדכון ראשון',
  noSchool: 'היום בלי לימודים',
  full: `אפשר עד ${MAX_BUDDIES} חברים`,

  // Adding a friend (2.6).
  myName: 'השם שלך אצל חברים',
  shareTimetable: 'המערכת והמבחנים שלך',
  shareTimetableSub: 'כולל השינויים של היום',
  shareAbsences: 'החיסורים שלך',
  shareAbsencesSub: 'לכל מקצוע, כמה עוד מותר',
  sendLink: 'לשלוח קישור',
  /** Under that button: one link can go to several friends, and whoever answers it sees what was chosen here. */
  linkForMany: 'אפשר לשלוח את הקישור לכמה חברים. כל מי שיאשר אותו בשבוע הקרוב יראה את מה שבחרת.',
  /** The phone's share sheet did not open (as `ShareToGroup` says it). */
  shareFailed: 'לא הצלחנו לפתוח את השיתוף',
  inviteMessage: (url: string) => `בואו נהיה חברים בסדר יום, ככה נראה מתי מסיימים יחד ומתי יש חלון משותף:\n${url}`,

  // The sheet that answers a link.
  acceptTitle: (name: string) => `${who(name)} רוצה להיות חברים בסדר יום`,
  acceptLead: 'ככה תראו מתי מתחילים ומסיימים יחד, ומתי יש לכם חלון משותף.',
  nameThere: (name: string) => `השם שלך אצל ${who(name)}`,
  /** No maqaf, as in the sketch's ״השיתוף מפלג״. */
  fromThem: (name: string, parts: string) => `השיתוף מ${who(name)}: ${parts}`,
  /** What `fromThem` says is shared, as a Hebrew list in the order of the switches; the bagrut only along with the grades. */
  shareParts: (shares: BuddyShares) => {
    const parts = [
      shares.timetable && 'מערכת', shares.absences && 'חיסורים', shares.grades && 'השוואת ציונים', shares.grades && shares.bagrut && 'ציוני בגרות',
    ].filter((part): part is string => typeof part === 'string');
    const last = parts.pop();
    if (last === undefined) return 'כלום בינתיים';
    return parts.length === 0 ? last : `${parts.join(', ')} ו${last}`;
  },
  lock: 'אפשר לשנות את זה או להפסיק בכל רגע. מה שמשתפים עובר מוצפן, ורק החברים שלך יכולים לקרוא אותו.',
  accept: 'להיות חברים',
  later: 'לא עכשיו',
  used: 'הקישור הזה כבר מלא',
  gone: 'הקישור הזה כבר לא בתוקף',
  own: 'זה הקישור ששלחת. צריך לשלוח אותו לחבר.',
  accepted: BUDDY_NOTES.accepted,
  /** A link this phone had answered before, opened again: the answer is finished, or found done; whose it was is not known here. */
  alreadyAccepted: 'כבר אישרת את הקישור הזה',
  ended: BUDDY_NOTES.ended,
  incomplete: BUDDY_NOTES.incomplete,
  /** Any failure to reach the server: what a screen says in place of the error. */
  failed: 'לא הצלחנו להתחבר. כדאי לנסות שוב.',

  // A friend's page (2.4) and settings (2.7).
  share: 'שיתוף',
  tabs: { timetable: 'מערכת', exams: 'מבחנים', absences: 'חיסורים', grades: 'ציונים' },
  notShared: 'זה לא משותף איתך.',
  updated: (name: string, ago: string) => `עודכן אצל ${who(name)} ${ago}`,
  noTimes: (name: string) => `במערכת של ${who(name)} אין שעות, אז אי אפשר להשוות שעות`,
  noTimesMine: 'במערכת שלך אין שעות, אז אי אפשר להשוות שעות',
  /** The list's line for a friend whose day cannot be set against mine (no times, two schools). */
  cannotCompare: 'אי אפשר להשוות שעות',
  notPublished: 'המערכת לשבוע הזה עוד לא פורסמה',
  stop: 'להפסיק להיות חברים',
  yours: 'שלך',
  together: 'ביחד',
  window: 'חלון משותף',
  notYet: 'עוד לא',
  done: 'סיימו',
  /** `done` in my own column: the same in writing for any reader. */
  doneMine: 'סיימת',
  /** The week arrows around the day strip, said aloud. */
  prevWeek: 'שבוע קודם',
  nextWeek: 'שבוע הבא',
  /** A line of the table said aloud: its periods, and an empty cell between two lessons (drawn blank). */
  periodsSaid: (from: number, to: number) => (from === to ? `שיעור ${from}` : `שיעורים ${from} עד ${to}`),
  noLesson: 'אין שיעור',
  /** After the lessons cancelled in a shared window, struck under ״חלון משותף״. */
  cancelledWord: (n: number) => (n === 1 ? 'בוטל' : 'בוטלו'),
  /** A day with no table and no summary: nobody has school, or one of the two has none. */
  noSchoolDay: 'אין לימודים ביום הזה',
  noSchoolTheirs: (name: string) => `ל${who(name)} אין לימודים ביום הזה`,
  noSchoolMine: 'לך אין לימודים ביום הזה',
  /** Under the name on the exams and absences tabs, as the sketch has it. */
  examsSpan: 'מבחנים בשבועיים הקרובים',
  absencesSpan: 'חיסורים במחצית הזאת',

  // The settings of a friend (2.7), from the ״שיתוף״ chip.
  shareWith: (name: string) => `השיתוף עם ${who(name)}`,
  /** My own name for them: only on this phone. */
  nameHere: (name: string) => `השם של ${who(name)} אצלך`,
  save: 'לשמור',
  settingsNote: (name: string) => `שינוי במה שמשתפים מגיע ל${who(name)} בעדכון הבא. השם נשאר רק אצלך.`,
  stopTitle: (name: string) => `להפסיק להיות חברים עם ${who(name)}?`,
  stopWhat: 'מה ששיתפתם יימחק משני הצדדים. כדי להיות שוב חברים צריך קישור חדש.',
  /** After `stopWhat`, for a friend who came by a link of mine still open: it closes with them. */
  stopClosesLink: 'גם הקישור ששלחת ייסגר, וחברים שעוד לא אישרו יצטרכו קישור חדש.',
  stopYes: 'להפסיק',
  stopKeep: 'ביטול',

  // The list's line and the page's summary.
  endTogether: (t: string) => `מסיימים יחד ב־${t}`,
  startTogether: (t: string) => `מתחילים יחד ב־${t}`,
  /** `t` is a time ("11:15"), a range, or periods ("בשיעור 5"). */
  windowAt: (t: string) => isolateRanges(`חלון משותף ${t}`),
  ends: (name: string, theirs: string, mine: string) => `סוף היום: ${who(name)} ${theirs}, שלך ${mine}`,
  starts: (name: string, theirs: string, mine: string) => `התחלה: שלך ${mine}, ${who(name)} ${theirs}`,
  /** By period, at one school whose timetable has no times (4.1). */
  endAfter: (h: number) => `מסיימים יחד אחרי שיעור ${h}`,
  startAt: (h: number) => `מתחילים יחד בשיעור ${h}`,
  /** One side's edge of the day by period, for `ends` and `starts`. */
  afterPeriod: (h: number) => `אחרי שיעור ${h}`,
  atPeriod: (h: number) => `שיעור ${h}`,
  /** A window by period, for `windowAt`. */
  periods: (from: number, to: number) => (from === to ? `בשיעור ${from}` : isolateRanges(`בשיעורים ${from}–${to}`)),

  // Today, by the clock. `names` from `edgeNames` (the end and the start) or `buddyNames` (a window).
  todayEnd: (t: string, names: string) => `מסיימים איתך ב־${t}: ${names}`,
  todayStart: (t: string, names: string) => `מתחילים איתך ב־${t}: ${names}`,
  todayWindow: (names: string, range: string) => isolateRanges(`חלון משותף עם ${names} ${range}`),
  // Today, by period.
  todayEndAfter: (h: number, names: string) => `מסיימים איתך אחרי שיעור ${h}: ${names}`,
  todayStartAt: (h: number, names: string) => `מתחילים איתך בשיעור ${h}: ${names}`,
  todayWindowPeriods: (names: string, from: number, to: number) =>
    from === to ? `חלון משותף עם ${names} בשיעור ${from}` : isolateRanges(`חלון משותף עם ${names} בשיעורים ${from}–${to}`),

  // Exams. `names` from `buddyNames`.
  examsTitle: 'מבחנים עם חברים',
  alsoTogether: (names: string) => `גם ${names}`,
  alsoOtherDay: (names: string) => `גם ${names}, ביום אחר`,
  examTag: { together: 'ביחד', same_subject: 'אותו מקצוע', mine: 'לך' },
  /** No line when nothing is shared. */
  examLead: (n: number): string | null => (n === 0 ? null : n === 1 ? 'מבחן אחד משותף' : `${n} מבחנים משותפים`),
  /** After `examLead`, when the first shared one is (`countdownLabel`): ״מבחן אחד משותף, מחר״. */
  examWhen: (n: number, when: string) => (n === 1 ? when : `הראשון ${when}`),
  noExams: 'אין מבחנים בשבועיים הקרובים',
  /** The line under an exam on a friend's page, by how it pairs. */
  examBoth: 'לשניכם, באותו יום',
  examOnlyTheirs: (name: string) => `רק ל${who(name)}`,
  examOnlyMine: 'רק לך',
  /**
   * The same subject in the same week, on another day, `day` being the other
   * exam's (״יום חמישי 12.11״): under my exam, theirs is on that day; under
   * theirs, mine is.
   */
  examTheirDay: (name: string, day: string) => `לשניכם, ${who(name)} ב${day}`,
  examMyDay: (day: string) => `לשניכם, אצלך ב${day}`,

  // Absences.
  absencesShared: 'במקצועות ששניכם לומדים',
  absencesOthers: (name: string) => `שאר המקצועות של ${who(name)}`,
  absencesNote: 'המספר הראשון: חיסורים שנחשבים. השני: כמה מותר עד סוף המחצית. כתום: נשארו שניים או פחות.',
  /** A bar said aloud: ״נועה: 4 מתוך 6״. */
  absenceSaid: (whose: string, counted: number, allowed: number) => `${who(whose)}: ${counted} מתוך ${allowed}`,
  /** What an orange bar means, said with it (not by its colour alone). */
  absenceLevel: { close: 'נשארו שניים או פחות', over: 'מעל המותר' },
  noAbsences: 'עוד אין כאן מקצועות',

  // Grades (docs/superpowers/specs/2026-10-30-buddies-grades-design.md, 2.1 to 2.3): shared only while both turn them on,
  // so the tab says what has to happen for there to be any, and never ״לא משתפים איתך את זה״.
  /** Under the name on the grades tab. */
  gradesSpan: 'ציונים מתחילת השנה',
  /** Neither side has them on; the button turns mine on (2.2). */
  gradesNeither: 'ציונים משווים רק כששניכם מדליקים.',
  turnOnMine: 'להדליק אצלי',
  /** Only mine is on. */
  gradesMine: (name: string) => `הציונים יופיעו כשגם אצל ${who(name)} זה יהיה דלוק.`,
  /** Only theirs is on; the button is `turnOnToo`. */
  gradesTheirs: (name: string) => `${who(name)} רוצה להשוות איתך ציונים.`,
  turnOnToo: 'להדליק גם אצלי',
  /** Both are on, and their phone read Mashov: a box with no grades in it. */
  gradesEmpty: (name: string) => `ל${who(name)} עוד אין ציונים.`,
  /** The bagrut part's own versions of the two states above (2.3). */
  bagrutTheirs: (name: string) => `${who(name)} רוצה להשוות איתך גם ציוני בגרות.`,
  bagrutMine: (name: string) => `ציוני הבגרות יופיעו כשגם אצל ${who(name)} זה יהיה דלוק.`,
  /** The list: the subjects only they have grades in, a grade only one of us has, a subject with no number to average. */
  gradesOthers: (name: string) => `שאר המקצועות של ${who(name)}`,
  onlyMine: 'רק לך',
  onlyTheirs: (name: string) => `רק ל${who(name)}`,
  /** An open subject's line for a grade Mashov gave no name, as the School screen calls it. */
  gradeUnnamed: 'ציון',
  noAverage: 'אין ממוצע',
  bagrutHead: 'בגרות',
  /** The school's grade, and the exam's (the final one is the row's). */
  bagrutSchool: 'מגן',
  bagrutExam: 'בחינה',
  /** Under the list: the averages are each by their own weights. */
  gradesWeights: (name: string) => `הממוצע שלך מחושב לפי המשקלים שלך, ושל ${who(name)} לפי המשקלים של ${who(name)}.`,
  /**
   * Under an open subject whose average leaves grades out (a type at 0%, as אחר is by default): whose,
   * how many, and why, so 98.3 beside grades of 80 and 70 reads. Where to change it only for mine.
   */
  gradesUncounted: (mine: number, theirs: number, name: string) => {
    const count = (n: number) => (n === 1 ? 'ציון אחד' : `${n} ציונים`);
    const mineText = mine > 0 ? `${count(mine)} שלך` : null;
    const theirsText = theirs > 0 ? `${mine > 0 && theirs > 1 ? theirs : count(theirs)} של ${who(name)}` : null;
    // ״ו־3״ before a number, ״וציון״ before a word.
    const whose = mineText && theirsText ? `${mineText} ${/^\d/.test(theirsText) ? 'ו־' : 'ו'}${theirsText}` : mineText ?? theirsText ?? '';
    const where = mine > 0 ? ' את המשקלים שלך משנים בבית ספר, ב״משקלים״ של המקצוע.' : '';
    return `מחוץ לממוצע, כי המשקל ${mine + theirs === 1 ? 'שלו' : 'שלהם'} 0%: ${whose}.${where}`;
  },
  /** When their box leaves out older grades; `date` as ״1.9״. */
  gradesFrom: (name: string, date: string) => `הציונים של ${who(name)} מלפני ${date} לא נכנסו.`,
  // The switches (2.1), next to ״המערכת והמבחנים שלך״ and ״החיסורים שלך״.
  shareGrades: 'הציונים שלך',
  shareGradesSub: 'רק כששניכם מדליקים. הממוצע בכל מקצוע וכל הציונים מתחילת השנה.',
  shareBagrut: 'גם ציוני בגרות',
  shareBagrutSub: 'רק כששניכם מדליקים.',
} as const;
