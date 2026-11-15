/**
 * How /status reads to a person (plan F2, F7). The verdict comes from what
 * the server says in words — `configured`, `needsReauth` and the Hebrew
 * `message` — not from the runner's `state`, so one failed poll that the
 * server does not think worth mentioning never paints a card red.
 *
 * Pure, with type-only imports, so app/test can load it without React Native.
 */
import type { Source, SourceStatus } from '@sederyom/shared';

/**
 * - `off`: nothing to connect with — never connected, or disconnected.
 * - `ok`: connected, and the server has nothing to say.
 * - `reauth`: the person has to connect again.
 * - `pending`: connected, not checked yet.
 * - `trouble`: connected, and something is wrong that `message` explains.
 */
export type SourceKind = 'off' | 'ok' | 'reauth' | 'pending' | 'trouble';

/** Said when an older server sends no `message` but its state is not ok. */
export const FALLBACK_MESSAGE = 'יש תקלה בחיבור. ננסה שוב בעוד כמה דקות';

/** The Hebrew line to show for a source; `null` when all is well. */
export function sourceMessage(source: SourceStatus): string | null {
  if (source.message !== undefined) return source.message;
  return source.state === 'ok' && !source.needsReauth ? null : FALLBACK_MESSAGE;
}

export function sourceKind(source: SourceStatus): SourceKind {
  if (!source.configured) return 'off';
  if (source.needsReauth) return 'reauth';
  if (sourceMessage(source) === null) return 'ok';
  if (source.lastOkAt === null && source.consecutiveFailures === 0) return 'pending';
  return 'trouble';
}

/**
 * Where the tasks live, from the tasks source alone (tasks without Google):
 * - `unknown`: the status has not come, or does not list the source.
 * - `phone`: no Google behind them, so they are kept on this phone.
 * - `google`: connected.
 * - `reauth`: connected, and Google wants the person to sign in again.
 */
export type TasksHome = 'unknown' | 'phone' | 'google' | 'reauth';

export function tasksHome(source: SourceStatus | undefined): TasksHome {
  if (!source) return 'unknown';
  if (!source.configured) return 'phone';
  return source.needsReauth ? 'reauth' : 'google';
}

/**
 * Connected for the purpose of a setup step: credentials are held and not
 * rejected. Right after Google's consent the first check has not run yet, and
 * the step must already read as done.
 */
export function isConnected(source: SourceStatus | null | undefined): boolean {
  return Boolean(source && source.configured && !source.needsReauth);
}

/**
 * Whether a Mashov read has worked on this phone: on a parent's, what brings
 * School's Mashov tabs (stage 3). Not `configured`, which a phone that never
 * logged in also is, once a read found no login.
 */
export function mashovWasRead(sources: readonly SourceStatus[] | undefined): boolean {
  const mashov = sources?.find((s) => s.source === 'mashov');
  return Boolean(mashov && mashov.lastOkAt !== null);
}

export const KIND_LABELS: Record<SourceKind, string> = {
  off: 'לא מחובר',
  ok: 'מחובר',
  reauth: 'צריך להתחבר שוב',
  pending: 'עוד לא נבדק',
  trouble: 'יש תקלה',
};

/** Calendar and Tasks share one Google account; the screen shows them as one card. */
export function mergeGoogle(calendar: SourceStatus | undefined, tasks: SourceStatus | undefined): SourceStatus | null {
  if (!calendar && !tasks) return null;
  const a = calendar ?? tasks!;
  const b = tasks ?? calendar!;
  const rank = { ok: 0, degraded: 1, broken: 2 } as const;
  return {
    source: 'google_calendar',
    state: rank[a.state] >= rank[b.state] ? a.state : b.state,
    // The older of the two that have one: "בדקנו" never claims more than both.
    lastOkAt: [a.lastOkAt, b.lastOkAt].filter((t): t is string => t !== null).sort()[0] ?? null,
    consecutiveFailures: Math.max(a.consecutiveFailures, b.consecutiveFailures),
    degradedSince: a.degradedSince ?? b.degradedSince,
    lastError: a.lastError ?? b.lastError,
    message: sourceMessage(a) ?? sourceMessage(b),
    account: a.account ?? b.account,
    sourceFreshness: null,
    needsReauth: a.needsReauth || b.needsReauth,
    configured: a.configured && b.configured,
  };
}

export type CardId = 'google' | 'mashov' | 'shahaf' | 'school_site';

export const CARD_NAMES: Record<CardId, string> = {
  google: 'Google',
  mashov: 'משוב',
  shahaf: 'אתר בית הספר',
  school_site: 'לוח המבחנים',
};

/** A source the server did not list: nothing connected, nothing wrong. */
export function notConnected(source: Source): SourceStatus {
  return {
    source, state: 'ok', lastOkAt: null, consecutiveFailures: 0, degradedSince: null, lastError: null, message: null,
    account: null, sourceFreshness: null, needsReauth: false, configured: false,
  };
}

/**
 * The cards of "מצב חיבורים", in screen order, each with its status. No
 * Classroom card (plan 2f): the phone reads no Classroom, and a source with
 * no card is left out.
 */
export function connectionCards(sources: readonly SourceStatus[]): { id: CardId; source: SourceStatus }[] {
  const by = new Map<Source, SourceStatus>(sources.map((s) => [s.source, s]));
  const google = mergeGoogle(by.get('google_calendar'), by.get('google_tasks'));
  const out: { id: CardId; source: SourceStatus }[] = [];
  if (google) out.push({ id: 'google', source: google });
  for (const id of ['mashov', 'shahaf', 'school_site'] as const) {
    const source = by.get(id);
    if (source) out.push({ id, source });
  }
  return out;
}

/**
 * "בדקנו לפני 5 דקות": when a source was last read, in whole words — Daniel
 * could not read "דק׳" and "שע׳". Empty for a time that does not parse.
 */
export function checkedAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'בדקנו עכשיו';
  if (minutes < 60) return minutes === 1 ? 'בדקנו לפני דקה' : `בדקנו לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'בדקנו לפני שעה' : hours === 2 ? 'בדקנו לפני שעתיים' : `בדקנו לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'בדקנו אתמול';
  if (days === 2) return 'בדקנו לפני יומיים';
  return `בדקנו לפני ${days} ימים`;
}

/**
 * How many messages the last Mashov read brought, and from how many pages,
 * for the technical details. `null` for a read kept from before pages were
 * counted: it has nothing to say.
 */
export function mailReadLine(counts: { mail: number; mailPages?: number } | null | undefined): string | null {
  if (!counts || counts.mailPages === undefined) return null;
  return `הודעות בקריאה האחרונה: ${counts.mail}, ${counts.mailPages === 1 ? 'מעמוד אחד' : `מ־${counts.mailPages} עמודים`}`;
}

/**
 * The words around connecting and disconnecting, in a ninth grader's words
 * (Maya): no "יפוג", and "מה שכבר הגיע" rather than "מה שכבר נקרא" — she
 * asked who read what.
 */
export const CONNECTION_COPY = {
  /**
   * What each account brings, in one short line under its name (plan §16:
   * at most one muted line per connection, on onboarding's connect step and
   * on מצב חיבורים alike).
   */
  googleUse: 'היומן והמשימות שלך, והמבחנים ביומן נפרד בשם ״בית ספר״.',
  /** The same, while "המבחנים שלך ביומן Google" is off, on Settings' Google page ("Google"). */
  googleUseNoExams: 'היומן והמשימות שלך. הוספת המבחנים כבויה בהגדרות, ב״Google״.',
  mashovUse: 'המערכת האישית, שיעורי הבית והציונים מגיעים ממשוב.',
  /** Under a connected Mashov: what happens when Mashov ends the connection. */
  mashovDrops: 'אם משוב ינתק את החיבור, נשלח התראה.',
  googleDisconnect: 'היומן והמשימות מ־Google יפסיקו להתעדכן כאן, ומה שהגיע מ־Google יימחק מהטלפון. אפשר להתחבר שוב בכל רגע.',
  mashovDisconnect: 'המערכת האישית, שיעורי הבית והציונים יפסיקו להתעדכן ממשוב. מה שכבר הגיע לאפליקציה יישאר, ואפשר להתחבר שוב בכל רגע.',
  googleDisconnected: 'Google נותק. מה שהגיע ממנו נמחק מהטלפון',
  mashovDisconnected: 'משוב נותק. מה שכבר הגיע נשאר',
  /** After a Mashov login that worked. */
  mashovVerified: 'אם משוב ינתק את החיבור, נשלח התראה, וההתחברות מחדש לוקחת דקה.',
  mashovArrived: 'המערכת, שיעורי הבית והציונים כבר הגיעו ממשוב.',
  googleNeedsLogin: 'צריך להתחבר שוב ל-Google.',
  /** Google's reads keep failing, though the sign-in is fine (`googleReadMessage`). */
  googleNotRead: 'היומן והמשימות לא מתעדכנים כרגע. ננסה שוב לבד, ואפשר גם ללחוץ על ״לבדוק עכשיו״.',
  /** Under the tasks, while no Google is connected: where they are kept, and what connecting adds. */
  tasksOnPhone: 'המשימות נשמרות רק בטלפון הזה. אפשר לחבר Google כדי לשמור אותן גם שם',
  /** The button under that line. */
  tasksConnect: 'לחבר Google',
} as const;

/** One failed read says nothing: a phone off the network for a morning is not a fault. */
export const GOOGLE_QUIET_HOURS = 12;

/**
 * What Google's card says on the phone. A read failing for longer than
 * `GOOGLE_QUIET_HOURS` is said out loud: `null` here is what makes the card
 * read "מחובר" (`sourceKind`).
 */
export function googleReadMessage(
  status: { lastOkAt: string | null; lastError: string | null; needsLogin: boolean },
  now: Date = new Date(),
): string | null {
  if (status.needsLogin) return CONNECTION_COPY.googleNeedsLogin;
  if (!status.lastError) return null;
  const quietUntil = status.lastOkAt ? Date.parse(status.lastOkAt) + GOOGLE_QUIET_HOURS * 3_600_000 : 0;
  return now.getTime() < quietUntil ? null : CONNECTION_COPY.googleNotRead;
}

/**
 * The toast after connecting Google, when tasks kept on the phone went in:
 * "Google" and not the name of its task app, which read as another app (Maya).
 */
export function movedToGoogleLabel(count: number): string {
  return count === 1 ? 'משימה אחת עברה ל־Google' : `${count} משימות עברו ל־Google`;
}

/**
 * Google on a parent's phone (docs/parents-plan.md), if the parent wants it:
 * the parent's own account, with every child's exams in "בית ספר"
 * (`runPhoneMirror`), and the planning and tasks tabs.
 */
export const PARENT_GOOGLE_COPY = {
  use: 'אם רוצים: המבחנים של הילדים ביומן נפרד בשם ״בית ספר״, והיומן והמשימות של ההורה באפליקציה.',
  examsLabel: 'המבחנים ביומן Google',
  examsHint: 'נוסיף את המבחנים של הילדים ליומן נפרד בשם ״בית ספר״',
} as const;

/**
 * Mashov on a parent's phone (parents mode, stage 3): the parent logs in with
 * the parent's own details, and the check tells how Mashov answered. The
 * report it shares holds no names, grades, ID numbers or ids.
 */
export const PARENT_MASHOV_COPY = {
  /** Settings, until a parent's login was read. */
  connectRow: 'להתחבר למשוב כהורה',
  connectRowHint: 'הציונים, שיעורי הבית והחיסורים של הילדים, עם הפרטים של ההורה במשוב',
  /** Settings, once it was. */
  row: 'משוב להורים',
  rowHint: 'מחובר. בדיקת החיבור והדוח נמצאים במצב חיבורים',
  /** The Mashov section of מצב חיבורים. */
  use: 'הציונים, שיעורי הבית והחיסורים של הילדים, עם הפרטים של ההורה במשוב.',
  connect: 'להתחבר למשוב כהורה',
  /** The login screen. */
  loginTitle: 'התחברות למשוב כהורה',
  loginLead: 'מתחברים עם שם המשתמש והסיסמה של ההורה במשוב, או עם קוד חד־פעמי. הזדהות משרד החינוך מתאימה רק לתלמידים. הסיסמה נשארת באתר של משוב ולא נשמרת אצלנו.',
  arrived: 'הציונים, שיעורי הבית והחיסורים מגיעים עכשיו ממשוב.',
  /** The children Mashov listed, by first name; on the phone only. */
  found: (names: readonly string[]) => `ברשימה של משוב: ${names.join(', ')}`,
  /** The check, on the login screen and in מצב חיבורים. */
  checkTitle: 'בדיקה להורים',
  checkLead: 'הבדיקה עוברת על החיבור למשוב ומכינה דוח קצר. אין בו שמות, ציונים, מספרי זהות או מזהים. יש בו רק שמות של שדות, קודים של תשובות, וכמה פריטים הגיעו בכל תשובה.',
  checkRun: 'להריץ את הבדיקה',
  checkAgain: 'לבדוק שוב',
  checkRunning: 'בודקים…',
  checkShare: 'לשלוח את הדוח',
  checkShow: 'להציג את הדוח',
  checkHide: 'להסתיר את הדוח',
  checkAt: (when: string) => `הבדיקה האחרונה: ${when}`,
  checkFailed: 'הבדיקה לא הצליחה. אפשר לנסות שוב',
  /** Under the login page, for a login that never shows up: what the page saw is reported all the same. */
  reportNow: 'לשלוח דוח בדיקה',
} as const;

/**
 * A parent's children at more than one school (docs/superpowers/specs/2026-11-02-parents-other-schools-design.md
 * §4.4). The child's name is what the parent calls it, and the school's is Mashov's; either may be `''`,
 * and the words still read. Never a family name.
 */
export const PARENT_SCHOOLS_COPY = {
  /** A read's switch to the child's school answered `BindNotFound`. */
  bindGone: (name: string) => `משוב כבר לא מקשר אליך את ${name || 'הילד או הילדה שעל המסך'}. אפשר לקשר שוב באתר של משוב.`,
  /** A read's switch answered `ChangePass`. */
  changePass: (school: string) => `משוב מבקש להחליף סיסמה ב${school || 'בית הספר'}. אפשר להיכנס לאתר של משוב ולהחליף שם.`,
  /** Any other refusal of a read's switch, with Mashov's code when it gave one. */
  refused: (school: string, code?: string) => `משוב לא העביר את החיבור ל${school || 'בית הספר'}${code ? ` (${code})` : ''}.`,
  /** A child Mashov lists whom the parent's login cannot read yet: it is bound in Mashov first. */
  unbound: (name: string, school: string) => `${name || 'ילד או ילדה'} ב${school || 'בית הספר'}: צריך לקשר במשוב, ואז להתחבר שוב`,
  /** The login screen, after a scan that added `n` children (at least one). */
  added: (n: number) => (n === 1 ? 'נוסף ילד אחד ממשוב' : `נוספו ${n} ילדים ממשוב`),
  /** The scan found more children than the phone follows (`MAX_FOLLOWED_CLASSES`, six). */
  full: 'יש כבר שישה ילדים באפליקציה, אז ילדים נוספים שמשוב רשם לא נוספו',
  /** The scan left `n` children (at least one) for the next one: a class or a school's class list not known yet. */
  later: (n: number) => (n === 1 ? 'עוד ילד אחד שמשוב רשם יתווסף בחיבור הבא למשוב' : `עוד ${n} ילדים שמשוב רשם יתווספו בחיבור הבא למשוב`),
  /** The question over a phone child Mashov may list as more than one child: `className` is the phone child's. */
  whoIs: (className: string) => (className ? `מי מהם לומד בכיתה ${className}?` : 'מי מהם הילד או הילדה שעל המסך?'),
  /** A read's error: a scan exists, and Mashov's list holds no child the child on screen is linked to. About the child, not the class; the next step is a login, whose scan looks again. */
  notFound: 'משוב לא מצא את הילד או הילדה שעל המסך ברשימה שלו. אפשר להתחבר שוב למשוב, והאפליקציה תחפש שוב',
} as const;

/**
 * The one line Settings shows about all connections: "הכול מחובר",
 * "משוב: צריך להתחבר שוב", or "2 חיבורים צריכים תשומת לב". A source that is
 * only waiting for its first check is not a problem; one not connected is,
 * so "הכול" is said only when everything listed inside is connected (run 7,
 * Maya: "הכול מחובר" here, a card "לא מחובר" inside: "אז מה נכון?").
 */
export function connectionSummary(sources: readonly SourceStatus[]): { text: string; tone: 'ok' | 'attention' | 'neutral' } {
  if (sources.length === 0) return { text: 'בודקים…', tone: 'neutral' };
  const cards = connectionCards(sources).map((card) => ({ ...card, kind: sourceKind(card.source) }));
  if (cards.length === 0) return { text: 'בודקים…', tone: 'neutral' };
  const attention = cards.filter((card) => card.kind === 'off' || card.kind === 'reauth' || card.kind === 'trouble');
  if (attention.length === 0) return { text: 'הכול מחובר', tone: 'ok' };
  if (attention.length === 1) {
    const only = attention[0]!;
    return { text: `${CARD_NAMES[only.id]}: ${KIND_LABELS[only.kind]}`, tone: 'attention' };
  }
  return { text: `${attention.length} חיבורים צריכים תשומת לב`, tone: 'attention' };
}
