/**
 * What a notification opens, and how it reads in the notifications log (plan
 * A6, F12). A tapped push and a tapped log row go to the same place: both ask
 * `routeForPayload`, and `push/handlers.ts` turns the answer into navigation.
 *
 * Pure on purpose, so `node --test` can load it: only *type* imports from
 * `@sederyom/shared`, whose runtime entry is TypeScript source node can't run.
 * For the same reason the type labels live here and not in
 * `NOTIFICATION_LABELS` — and that one says "תקלת סנכרון", which the UI may
 * not (copy guide, appendix א).
 */
import type { DateStr, NotificationLogEntry, NotificationType, SchoolTab, Source, SourceStatus } from '@sederyom/shared';
import type { IconName } from '../components/AppIcon';
import { connectionCards, isConnected, sourceKind, type CardId } from './connections';
import { addDays, dayLabel, isolateRanges, toDateStr, weekdayName } from './format';

/** A tab inside the bottom bar, with the param it opens on. */
export type TabRoute =
  | { screen: 'Today'; params?: { date: DateStr } }
  | { screen: 'Week'; params?: { date: DateStr } }
  /** The "תכנון" tab; the route keeps its old name. */
  | { screen: 'Calendar'; params?: { date: DateStr } }
  | { screen: 'School'; params?: { tab: SchoolTab } }
  | { screen: 'Tasks' };

/**
 * What "היום שלי" opens once it shows the day: `changes` is the day's
 * timetable changes — the changed lesson's sheet, or the list of them
 * (lib/todayFocus.ts).
 */
export type TodayFocus = 'changes';

/**
 * Where a notification leads, in the shape `navigation.navigate(name, params)`
 * takes, and — for a timetable change — what to open on the day (`focus`).
 */
export type PushRoute =
  | { name: 'Tabs'; params: TabRoute; focus?: TodayFocus }
  | { name: 'Notifications' | 'MashovLogin' | 'SettingsNotifications' | 'Connections' };

/** What the payload alone may not say: a log entry's own type and send time. */
export interface RouteHints {
  type?: NotificationType;
  /** When it was sent (`Instant`): dates the day of an old payload that named none. */
  sentAt?: string;
}

const SCHOOL_TABS: readonly SchoolTab[] = ['exams', 'grades', 'homework', 'messages'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The School sub-tab each item notification belongs on. */
const TAB_FOR_TYPE: Partial<Record<NotificationType, SchoolTab>> = {
  new_exam: 'exams',
  new_homework: 'homework',
  new_grade: 'grades',
  teacher_message: 'messages',
};

/** Connection trouble: Google's arrives as `settings`, and either one lands on מצב חיבורים. */
function isConnectionProblem(type: NotificationType | undefined): boolean {
  return type === 'sync_broken' || type === 'relogin_needed';
}

function day(screen: 'Today' | 'Week' | 'Calendar', date: DateStr | undefined): PushRoute {
  return { name: 'Tabs', params: date ? { screen, params: { date } } : { screen } };
}

function school(tab: SchoolTab | undefined): PushRoute {
  return { name: 'Tabs', params: tab ? { screen: 'School', params: { tab } } : { screen: 'School' } };
}

/**
 * The day an undated, link-less notification was about: its own day for a
 * change today or a morning summary, the next one for a change tomorrow or an
 * evening reminder. Device-local, like every date in the app.
 */
function dayOfSending(type: NotificationType | undefined, sentAt: string | undefined): DateStr | undefined {
  if (!sentAt) return undefined;
  const sent = new Date(sentAt);
  if (Number.isNaN(sent.getTime())) return undefined;
  switch (type) {
    case 'schedule_change_today':
    case 'morning_summary':
      return toDateStr(sent);
    case 'schedule_change_tomorrow':
    case 'evening_homework':
      return addDays(toDateStr(sent), 1);
    default:
      return undefined;
  }
}

/** For a payload with no deep link (an old log entry): where its type belongs. */
function routeForType(type: NotificationType | undefined, date: DateStr | undefined): PushRoute {
  switch (type) {
    case 'schedule_change_tomorrow':
      return day('Week', date);
    case 'new_exam':
    case 'new_homework':
    case 'new_grade':
    case 'teacher_message':
      return school(TAB_FOR_TYPE[type]);
    case 'sync_broken':
    case 'relogin_needed':
      // Without the link there is no telling Mashov from Google; מצב חיבורים offers both.
      return { name: 'Connections' };
    default:
      // Schedule changes today, the morning summary, the evening reminder, and anything unknown.
      return day('Today', date);
  }
}

/**
 * Where a push or a log entry opens. Takes the payload as it arrives (`unknown`:
 * the push's `data`, or a log row's `payload` column, possibly `null` or from an
 * older server) and trusts only fields of the right shape — an unknown `tab`
 * never reaches the School screen.
 *
 * - `today` / `week` / `planning` → that tab, on `date` when there is one.
 * - `school` → School on `tab`; a payload from before tabs were sent gets the
 *   tab its type belongs on.
 * - `settings` about a broken connection → מצב חיבורים; otherwise הגדרות.
 * - no deep link → by type (`routeForType`), dated from `hints.sentAt` if needed.
 * - a timetable change, today's or tomorrow's, with its day known → that day
 *   on "היום שלי" with the change open (`onTheChange`).
 */
export function routeForPayload(payload: unknown, hints: RouteHints = {}): PushRoute {
  const raw: Record<string, unknown> = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const type = hints.type ?? (typeof raw.type === 'string' ? (raw.type as NotificationType) : undefined);
  const route = linkedRoute(raw, type, hints);
  return type === 'schedule_change_today' || type === 'schedule_change_tomorrow' ? onTheChange(route) : route;
}

/**
 * "שינוי במערכת של היום · שיעור 7 היסטוריה מבוטל" opened "היום שלי" at its
 * top, and the lesson had to be found by hand (Noa, Maya, run 6). A
 * timetable change now lands on the change itself: its day on "היום שלי" —
 * tomorrow's too, rather than the week ("פותחת את היום של מחר", plan A6) —
 * with `focus: 'changes'`. A change whose day is unknown goes where it went.
 */
function onTheChange(route: PushRoute): PushRoute {
  if (route.name !== 'Tabs') return route;
  const { params } = route;
  const date = params.screen === 'Today' || params.screen === 'Week' ? params.params?.date : undefined;
  return date ? { name: 'Tabs', params: { screen: 'Today', params: { date } }, focus: 'changes' } : route;
}

/** Where the payload's own deep link leads, before a timetable change is taken to the change itself. */
function linkedRoute(raw: Record<string, unknown>, type: NotificationType | undefined, hints: RouteHints): PushRoute {
  const date = typeof raw.date === 'string' && DATE.test(raw.date) ? raw.date : undefined;
  const tab = SCHOOL_TABS.find((t) => t === raw.tab);

  switch (raw.deepLink) {
    case 'today':
      return day('Today', date);
    case 'week':
      return day('Week', date);
    case 'planning':
      return day('Calendar', date);
    case 'school':
      return school(tab ?? (type ? TAB_FOR_TYPE[type] : undefined));
    case 'tasks':
      return { name: 'Tabs', params: { screen: 'Tasks' } };
    case 'notifications':
      return { name: 'Notifications' };
    case 'mashov-login':
      return { name: 'MashovLogin' };
    case 'settings':
      return { name: isConnectionProblem(type) ? 'Connections' : 'SettingsNotifications' };
    default:
      return routeForType(type, date ?? dayOfSending(type, hints.sentAt));
  }
}

/**
 * A log entry's destination: its payload, with the entry's type and time as
 * fallbacks. With what /status says now (`sources`), a connection problem
 * that is settled (`isSettled`) opens מצב חיבורים instead: an old "צריך
 * להתחבר שוב למשוב" opened Mashov's login while Mashov was connected, and
 * Maya asked "so am I connected or not?" (run 7).
 */
export function routeForLogEntry(
  entry: Pick<NotificationLogEntry, 'type' | 'title' | 'body' | 'payload' | 'sentAt'>,
  sources?: readonly SourceStatus[] | null,
): PushRoute {
  if (isSettled(entry, sources)) return { name: 'Connections' };
  return routeForPayload(entry.payload, { type: entry.type, sentAt: entry.sentAt });
}

// ── A connection problem that is over ───────────────────────────────────────

/** The card of מצב חיבורים each source is on; Classroom has none (plan 2f). */
const CARD_OF_SOURCE: Record<Source, CardId | null> = {
  google_calendar: 'google',
  google_tasks: 'google',
  google_classroom: null,
  mashov: 'mashov',
  shahaf: 'shahaf',
  school_site: 'school_site',
};

/**
 * How the server's titles name the source ("צריך להתחבר שוב למשוב",
 * "נדרשת התחברות מחדש · Google Classroom", "אין עדכונים מיומן Google").
 * Classroom before Google: its name has "Google" in it, and it has no card.
 */
const CONNECTION_WORDS: readonly [CardId | null, RegExp][] = [
  [null, /Classroom/],
  ['mashov', /משוב/],
  ['google', /Google/],
  ['shahaf', /אתר בית הספר/],
  ['school_site', /לוח המבחנים/],
];

/**
 * Which connection a "צריך להתחבר שוב" or "אין עדכונים מ…" entry is about: a
 * `source` in the payload, Mashov's own login link, else the name in its
 * title (or its body). `null` for any other entry, or one that does not say.
 */
export function connectionOf(entry: Pick<NotificationLogEntry, 'type' | 'title' | 'body' | 'payload'>): CardId | null {
  if (!isConnectionProblem(entry.type)) return null;
  const raw = entry.payload ?? {};
  if (typeof raw.source === 'string' && raw.source in CARD_OF_SOURCE) return CARD_OF_SOURCE[raw.source as Source];
  if (raw.deepLink === 'mashov-login') return 'mashov';
  for (const text of [entry.title, entry.body ?? '']) {
    const found = CONNECTION_WORDS.find(([, words]) => words.test(text));
    if (found) return found[0];
  }
  return null;
}

/**
 * Whether a connection problem in the log is over by now: "צריך להתחבר שוב"
 * once that connection is connected again, "אין עדכונים מ…" once it is fine
 * (`sourceKind` 'ok'). The row says "סודר" and opens מצב חיבורים, not a
 * login. Unknown — no status yet, or an entry that does not say which
 * connection — is never settled.
 */
export function isSettled(
  entry: Pick<NotificationLogEntry, 'type' | 'title' | 'body' | 'payload'>,
  sources: readonly SourceStatus[] | null | undefined,
): boolean {
  if (!sources || sources.length === 0) return false;
  const id = connectionOf(entry);
  if (!id) return false;
  const card = connectionCards(sources).find((c) => c.id === id);
  if (!card) return false;
  return entry.type === 'relogin_needed' ? isConnected(card.source) : sourceKind(card.source) === 'ok';
}

/** The word on a settled row (run 7, Maya: "כבר סודר"). No tick in it: the screen draws one (plan §16.2). */
export const SETTLED_WORD = 'סודר';

// ── How a log row looks ─────────────────────────────────────────────────────

/** Palette families; the screen maps each one to its colour, soft fill and border. */
export type Tone = 'change' | 'cancel' | 'exam' | 'accent' | 'ok' | 'neutral';

export interface NotificationLook {
  icon: IconName;
  tone: Tone;
  /** A small type label under the text, or `null` when the title already says it. */
  label: string | null;
}

/** Short names for the kinds of notification — gender-neutral, nothing about how the app is built. */
export const TYPE_LABELS: Record<NotificationType, string> = {
  schedule_change_today: 'שינוי במערכת של היום',
  schedule_change_tomorrow: 'שינוי במערכת של מחר',
  new_exam: 'מבחן חדש',
  new_homework: 'שיעורי בית חדשים',
  new_grade: 'ציון חדש',
  teacher_message: 'הודעה ממורה',
  morning_summary: 'סיכום בוקר',
  evening_homework: 'תזכורת ערב',
  next_lesson: 'השיעור הבא',
  sync_broken: 'בעיה בחיבור',
  relogin_needed: 'צריך להתחבר שוב',
};

/**
 * Words that, in a title, already name the kind of notification. Taken from
 * the titles the server sends: "שינוי במערכת של מחר", "3 שינויים במערכת של
 * היום", "מבחן חדש", "שיעורי בית · היסטוריה", "ציון חדש · מתמטיקה", "הודעה
 * מכהן", "מחר להגיש: היסטוריה" / "מחר מבחן באנגלית", "אין עדכונים מ…", "צריך
 * להתחבר שוב למשוב" / "נדרשת התחברות מחדש · Google". The morning summary's
 * title is the date ("יום שלישי · כ״ה בתשרי"), so it keeps "סיכום בוקר".
 */
const TITLE_SAYS: Record<NotificationType, readonly string[]> = {
  schedule_change_today: ['שינוי', 'מערכת'],
  schedule_change_tomorrow: ['שינוי', 'מערכת'],
  new_exam: ['מבחן', 'בגרות', 'מתכונת', 'בוחן'],
  new_homework: ['שיעורי בית', 'להגיש', 'הגשה'],
  new_grade: ['ציון'],
  teacher_message: ['הודעה'],
  morning_summary: ['סיכום'],
  evening_homework: ['להגיש', 'מחר'],
  next_lesson: ['הבא'],
  sync_broken: ['עדכונים', 'חיבור', 'תקלה'],
  relogin_needed: ['להתחבר', 'התחברות', 'חיבור'],
};

const CANCELLED = /בוטל|ירד מהמערכת/;

/**
 * Whether every change a schedule push lists is a cancellation. The body is
 * "שיעור 3 מתמטיקה מבוטל · שיעור 4 אנגלית ירד מהמערכת"; a substitute ("· מ״מ:
 * כהן"), a move, an exam, a hidden rest ("ועוד 2") or a bare "עודכנה" each
 * make a piece that is not one, and the row keeps the general change icon.
 */
function onlyCancellations(body: string): boolean {
  const pieces = body.split(/\s·\s|\n/).map((s) => s.trim()).filter(Boolean);
  return pieces.length > 0 && pieces.every((piece) => CANCELLED.test(piece));
}

function iconAndTone(type: NotificationType, body: string): { icon: IconName; tone: Tone } {
  switch (type) {
    case 'schedule_change_today':
    case 'schedule_change_tomorrow':
      return onlyCancellations(body) ? { icon: 'cancel', tone: 'cancel' } : { icon: 'change', tone: 'change' };
    case 'new_exam':
      return { icon: 'exam', tone: 'exam' };
    case 'new_homework':
    case 'evening_homework':
      return { icon: 'homework', tone: 'accent' };
    case 'new_grade':
      return { icon: 'grade', tone: 'ok' };
    case 'teacher_message':
      return { icon: 'message', tone: 'neutral' };
    case 'morning_summary':
      return { icon: 'summary', tone: 'accent' };
    case 'next_lesson':
      // The day's page, as on the "היום שלי" tab: these notes never reach the log, but a type draws as itself.
      return { icon: 'day', tone: 'neutral' };
    case 'sync_broken':
    case 'relogin_needed':
      // No warning glyph in the set; two chain links read as "the connection".
      return { icon: 'link', tone: 'cancel' };
    default:
      return { icon: 'bell', tone: 'neutral' };
  }
}

/**
 * A log row's title and body as drawn: the server's free text, with every
 * numeric range pinned left to right — "08:00–10:30", "שאלות 1–5" — so the
 * bell never shows "10:30–08:00" (Daniel, Wave 4). A text that already carries
 * the isolate marks is left as it came.
 */
export function logRowText(entry: Pick<NotificationLogEntry, 'title' | 'body'>): { title: string; body: string } {
  return { title: isolateRanges(entry.title), body: isolateRanges(entry.body ?? '') };
}

/** Icon, colour family and (only when the title doesn't say it) a type label for one log row. */
export function notificationLook(entry: Pick<NotificationLogEntry, 'type' | 'title' | 'body'>): NotificationLook {
  const words = TITLE_SAYS[entry.type] ?? [];
  const known = (TYPE_LABELS as Partial<Record<string, string>>)[entry.type];
  const said = words.some((w) => entry.title.includes(w));
  return { ...iconAndTone(entry.type, entry.body), label: known && !said ? known : null };
}

/**
 * Whether a log row arrived after `seenAt` — when the log was last opened
 * before this visit — and is drawn "חדש". The bell's badge counts by the same
 * rule (`countUnread` in lib/unread.ts), so the rows marked here are the ones
 * it counted. `null` (not read yet) marks nothing.
 */
export function isNewSince(entry: Pick<NotificationLogEntry, 'sentAt'>, seenAt: string | null): boolean {
  if (seenAt === null) return false;
  const seen = Date.parse(seenAt);
  const sent = Date.parse(entry.sentAt);
  return !Number.isNaN(seen) && !Number.isNaN(sent) && sent > seen;
}

// ── Grouping by day ─────────────────────────────────────────────────────────

export interface LogDay {
  date: DateStr;
  /** "היום" / "אתמול" / "יום שלישי". */
  label: string;
  items: NotificationLogEntry[];
}

/** The log by device-local day, newest day first; entries keep the order they came in. */
export function groupLogByDay(items: NotificationLogEntry[], now: Date = new Date()): LogDay[] {
  const groups = new Map<DateStr, LogDay>();
  for (const item of items) {
    const sent = new Date(item.sentAt);
    if (Number.isNaN(sent.getTime())) continue;
    const date = toDateStr(sent);
    let group = groups.get(date);
    if (!group) {
      const near = dayLabel(date, now);
      group = { date, label: near === 'היום' || near === 'אתמול' ? near : weekdayName(date), items: [] };
      groups.set(date, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
