/**
 * Everything the screens ask for, answered by the phone itself (plan Phase 2,
 * 2f): from what the phone reads, in the shapes the screens were built for.
 *
 * - Days, weeks, the agenda and the widget: `local/views.ts`.
 * - Settings: kept on the phone (`userSettings.ts`); the class follows on `/v2`.
 * - School: grades, homework, messages and exams from the phone's Mashov read.
 * - Absences: the shared arithmetic over the same read.
 * - Tasks: Google, through the phone's own sign-in; kept on the phone without it.
 * - The notification log: kept on the phone (`notify/log.ts`).
 */
import type {
  AgendaView, AttendanceResponse, BagrutResponse, ClassOption, CreateTaskBody, DayView, DisconnectResponse, Exam, HiddenEventOption,
  NotificationLogEntry, SchoolFeeds, SchoolSiteState, SetHomeworkDoneResponse, SettingsPatch, SettingsResponse,
  SettingsUpdateResponse, SourceStatus, StatusResponse, Task, TasksResponse, TeachersResponse, UpdateTaskBody, UserSettings, WeekView, WidgetFeed,
} from '@sederyom/shared';
import { filterExams } from '@sederyom/shared/logic/filters';
import { calendarOptions, ownerLessons, subjectOptions, applySettingsPatch, type SlotLine } from '@sederyom/shared/logic/options';
import type { NormalizedCalendar, NormalizedCalendarEvent } from '@sederyom/shared/logic/google/calendar';
import { shahafSiteOf } from '@sederyom/shared/logic/shahaf-site';
import { todayStr } from '@sederyom/shared/logic/time';
import { ApiError } from '../api/client';
import { TIMEZONE } from '../config';
import { DEVICE_PLATFORM } from '../device/platform';
import { followClass, forgetFeed, listClasses, readTeachers, refreshFeed, sendDeviceDetails, storedFeed, syncDevicePrefs } from '../device/v2';
import { mirrorState } from '../google/mirror';
import { googleAccount, phoneGoogleRequester, signOutOfGoogle } from '../google/phone';
import { GOOGLE_KEYS, googleStatus } from '../google/sync';
import { createTaskRouted, deleteTaskRouted, tasksOnThisPhone, updateTaskRouted, type PhoneTasksDeps, type TaskRoute } from '../google/tasks';
import { clearJar } from '../mashov/cookieJar';
import { readFirstSeen } from '../mashov/gradeFirstSeen';
import { forgetParentLogin, isParentReadError } from '../mashov/parents';
import { parentSchools } from '../mashov/parentSchools';
import { mashovCoolSite } from '../mashov/phone';
import { KEYS as MASHOV_KEYS, localBagrut, localRead, localStatus, readMashovSoon } from '../mashov/sync';
import { googleReadMessage } from '../lib/connections';
import { INVITE_COPY, SCHOOL_SITE_COPY } from '../lib/onboarding';
import type { JoinTarget } from '../lib/invite';
import { readNotificationLog } from '../notify/log';
import { storage } from '../widget/feedCache';
import { SCHOOL_CALENDAR_NAME, examCalendarIds, examOptionsAsPublished, localExamsFrom, localHomework, type LocalSources } from './days';
import { childrenNow, keepLinkLessons, sameClassNames, syncShownChild } from './children';
import { dropLinkOffClass } from './childrenFromMashov';
import { markHomeworkDone } from './homeworkState';
import { dropKeptCopies } from './examPrefs';
import { dropOwnBoardOnClassChange } from './ownBoard';
import { attendanceFrom, gradesOf, homeworkOf, messagesOf } from './schoolFeeds';
import { chooseSchoolSite, isWithoutSite, pastedSite, savePastedSite, setWithoutSite, type KnownSites } from './schoolSite';
import { loadLocalSources, parentsChildren, refreshLocalSources, rescheduleSummariesSoon } from './source';
import { saveSchoolClasses, saveUserSettings, schoolClasses, userSettings } from './userSettings';
import { localAgenda, localDay, localWeek, localWidgetFeed } from './views';

/** The absence tracker is built in `schoolFeeds.ts` (pure, so the chat snapshot shares it); it is still asked for here. */
export { attendanceFrom };

/** What the screens ask the app for. */
export interface AppApi {
  day(date?: string): Promise<DayView>;
  week(offset: number): Promise<WeekView>;
  /** What is planned from today on, `days` days long (the "תכנון" tab). */
  agenda(days?: number): Promise<AgendaView>;
  widgetFeed(): Promise<WidgetFeed>;
  status(): Promise<StatusResponse>;
  settings(): Promise<SettingsResponse>;
  saveSettings(patch: SettingsPatch): Promise<SettingsUpdateResponse>;
  notifications(): Promise<{ items: NotificationLogEntry[] }>;
  school(): Promise<SchoolFeeds>;
  /** Bagrut questionnaires and sittings from Mashov (plan §14.2). */
  bagrut(): Promise<BagrutResponse>;
  /** The absence tracker (חיסורים): Mashov's attendance against the semester's lessons. */
  attendance(): Promise<AttendanceResponse>;
  /** Ticks a Mashov homework item off in the app (or back on); Mashov itself is not written to. */
  setHomeworkDone(key: string, done: boolean): Promise<SetHomeworkDoneResponse>;
  tasks(): Promise<TasksResponse>;
  createTask(body: CreateTaskBody): Promise<Task>;
  updateTask(id: string, body: UpdateTaskBody): Promise<Task>;
  deleteTask(id: string): Promise<{ ok: boolean }>;
  /**
   * The school's Shahaf address, pasted by the student when Mashov names none:
   * its classes are read, and both are kept. Throws in Hebrew when it is not a
   * Shahaf address, or the site did not answer with its classes.
   */
  lookUpSchoolSite(address: string): Promise<{ classes: ClassOption[] }>;
  /**
   * "איפה המורה?": today's day of every teacher at the school, as the server
   * read its site; `null` without a class, `'unsupported'` from an older server.
   */
  teachers(): Promise<TeachersResponse | null | 'unsupported'>;
  /** Goes on without a site: the days from Mashov alone, and no class to follow. */
  goWithoutSite(): Promise<{ ok: boolean }>;
  /**
   * Follows the class an invite link names (ideas ה2), at the link's school
   * whatever the phone followed before. Throws in Hebrew when the site did not
   * answer, or no longer lists the class.
   */
  joinClass(target: JoinTarget): Promise<{ className: string }>;
  /** Reads every source again now. */
  sync(): Promise<{ ok: boolean; at?: string; message?: string }>;
  /** Forgets the Mashov login on the phone ("ניתוק"). */
  disconnectMashov(): Promise<DisconnectResponse>;
  /** Signs the phone out of Google and forgets what it read ("ניתוק"). */
  disconnectGoogle(): Promise<DisconnectResponse>;
}

/** The sites the phone knows without asking Mashov: the followed class's, and the pasted one. */
const knownSites = (): KnownSites => ({ feed: storedFeed(storage)?.class.siteUrl, pasted: pastedSite(storage) });

/**
 * The class the student picked, followed on `/v2` so the server reads its
 * site: the followed class's, else the address the student pasted, else the
 * one Mashov names (`chooseSchoolSite`). A class picked is a site had: the
 * student is no longer "without" one. Following is what registers the phone,
 * so its prefs and push address go right after, to the device it now has.
 */
async function followPickedClass(classId: string, settings: UserSettings): Promise<void> {
  const site = await chooseSchoolSite(knownSites(), () => mashovCoolSite());
  if (!site.url) throw new ApiError(0, SCHOOL_SITE_COPY.noSiteToFollow(userSettings().audience === 'parent'));
  await followClass(storage, DEVICE_PLATFORM, site.url, classId);
  setWithoutSite(storage, false);
  // A parent's child on screen is in the class just picked: its siblings are the children there,
  // as the list will have it once `syncShownChild` has run (after this).
  const children = parentsChildren();
  const siblings = sameClassNames(children && { ...children, list: childrenNow(children, settings, site.url, false) });
  // The next refresh sends them again if this fails.
  void sendDeviceDetails(storage, settings, siblings).catch(() => undefined);
}

const sources = (): LocalSources => loadLocalSources();

const ofKind = <T>(list: readonly { kind: string; payload: unknown }[], kind: string): T[] =>
  list.filter((e) => e.kind === kind).map((e) => e.payload as T);

function slotLines(src: LocalSources): SlotLine[] {
  return ofKind<SlotLine>(src.mashov, 'timetable_slot');
}

/** The "בית ספר" calendar the phone keeps exams in, if it made one. */
function schoolCalendarId(calendars: readonly NormalizedCalendar[]): string | null {
  return mirrorState(storage).calendarId ?? calendars.find((c) => c.summary === SCHOOL_CALENDAR_NAME)?.id ?? null;
}

function hiddenEvents(src: LocalSources, ids: readonly string[]): HiddenEventOption[] {
  const events = ofKind<NormalizedCalendarEvent>(src.google, 'calendar_event');
  return ids.map((id) => {
    const exact = events.find((e) => e.googleId === id);
    const instance = events.find((e) => e.googleId.startsWith(`${id}_`));
    return { id, summary: (exact ?? instance)?.summary ?? '(אירוע שכבר לא ביומן)', series: exact === undefined && instance !== undefined };
  });
}

/**
 * The school's classes, read once from its Shahaf site through the server,
 * then kept; and where the site stands, for the class step and the picker
 * when there is no list. Mashov is asked for the site only while no list is
 * kept and no site is known.
 */
async function classesOf(settings: UserSettings): Promise<{ classes: ClassOption[]; site: SchoolSiteState }> {
  const withoutSite = isWithoutSite(storage);
  const kept = schoolClasses();
  if (kept.length > 0) return { classes: kept, site: { ...(await chooseSchoolSite(knownSites())), withoutSite } };
  const site = { ...(await chooseSchoolSite(knownSites(), () => mashovCoolSite())), withoutSite };
  if (site.url) {
    try {
      const { classes } = await listClasses(storage, site.url);
      saveSchoolClasses(classes);
      return { classes, site };
    } catch {
      // The site is down: the stored class at least.
    }
  }
  return { classes: settings.classId ? [{ id: settings.classId, name: settings.className }] : [], site };
}

/** "לחפש את הכיתות": the pasted address, kept only once its site answered with its classes. */
async function lookUpSchoolSite(address: string): Promise<{ classes: ClassOption[] }> {
  const site = shahafSiteOf(address);
  if (!site) throw new ApiError(400, SCHOOL_SITE_COPY.notShahaf);
  let classes: ClassOption[];
  try {
    ({ classes } = await listClasses(storage, site));
  } catch {
    throw new ApiError(502, SCHOOL_SITE_COPY.noAnswer);
  }
  if (classes.length === 0) throw new ApiError(502, SCHOOL_SITE_COPY.noAnswer);
  savePastedSite(storage, site);
  saveSchoolClasses(classes);
  return { classes };
}

/**
 * An invite's class: the link's site is read for its classes, like a pasted
 * address, and the class is followed there directly. The followed class's
 * site comes first wherever the app looks for one (`chooseSchoolSite`), so
 * the old class's feed goes before the class is saved: a link to another
 * school must not have its class followed at the old school's site.
 */
async function joinClass(target: JoinTarget): Promise<{ className: string }> {
  const site = shahafSiteOf(target.siteUrl);
  if (!site) throw new ApiError(400, SCHOOL_SITE_COPY.notShahaf);
  let classes: ClassOption[];
  try {
    ({ classes } = await listClasses(storage, site));
  } catch {
    throw new ApiError(502, SCHOOL_SITE_COPY.noAnswer);
  }
  const option = classes.find((c) => c.id === target.classId);
  if (!option) throw new ApiError(404, INVITE_COPY.classGone(userSettings().audience === 'parent'));
  // A student's invite to a parent, on a phone that follows no class yet: the app opens as a
  // parent's (docs/parents-plan.md). A phone already set up keeps who it is for.
  const asParent = target.parent === true && !userSettings().classId;
  // The class (and its school) the phone follows now, before the link's replaces it.
  const was = { classId: userSettings().classId, siteUrl: storedFeed(storage)?.class.siteUrl ?? pastedSite(storage) };
  savePastedSite(storage, site);
  saveSchoolClasses(classes);
  await followClass(storage, DEVICE_PLATFORM, site, option.id);
  // A class followed is a site had, even when its `cls` is the one saved before and nothing else is followed again.
  setWithoutSite(storage, false);
  forgetFeed(storage);
  // The own exam board goes with the class it was made for, as the feed does; the same class again keeps it. So do the
  // copies kept with the dates the student set for exams (the dates stay): an exam of the old class is not the new one's.
  if (dropOwnBoardOnClassChange(storage, was, { classId: option.id, siteUrl: site })) dropKeptCopies(storage);
  // The new class's feed, when the server has it; the next refresh reads it otherwise.
  await refreshFeed(storage).catch(() => null);
  await saveSettings({ classId: option.id, className: option.name, ...(asParent ? { audience: 'parent' as const } : {}) });
  // A parent's list keeps the class on screen as it is now: the link's, at the link's school.
  syncShownChild(storage, userSettings(), site);
  // A parent's phone shows the child's lessons: the link's codes, read once the lines are here.
  if (target.lessons?.length && userSettings().audience === 'parent') keepLinkLessons(storage, target.lessons);
  return { className: option.name };
}

/** Where the class picker's list comes from: the school's site, or the demo's own (`demo/api.ts`). */
export type ClassesOf = (settings: UserSettings) => Promise<{ classes: ClassOption[]; site: SchoolSiteState }>;

export async function settingsResponse(classesFor: ClassesOf = classesOf): Promise<SettingsResponse> {
  const src = sources();
  const settings = src.settings;
  const today = todayStr(TIMEZONE);
  const lessons = (src.feed?.lessons ?? []).filter((l) => l.status !== 'exam');
  const { subjects, mashovKnown } = subjectOptions(lessons, slotLines(src));
  const calendars = ofKind<NormalizedCalendar>(src.google, 'calendar');
  const { classes, site } = await classesFor(settings);
  return {
    settings,
    classes,
    subjects,
    mashovKnown,
    // The exam calendars: the class's, and the one the phone's own board reads if it is a calendar (`deviceCalendars`).
    calendars: calendarOptions(calendars, schoolCalendarId(calendars), src.calendars ? examCalendarIds(src.calendars) : (src.feed?.class.examCalendarId ?? null)),
    hiddenEvents: hiddenEvents(src, settings.calendars.hiddenEventIds),
    // Matched by the names and dates the sources gave them, shown under the student's own names and on their dates.
    exams: examOptionsAsPublished(localExamsFrom(src, today, today), ownerLessons(lessons, slotLines(src), settings), settings),
    schoolSiteUrl: src.feed?.class.siteUrl ?? null,
    site,
  };
}

async function saveSettings(patch: SettingsPatch): Promise<SettingsUpdateResponse> {
  const before = userSettings();
  const settings = applySettingsPatch(before, patch, todayStr(TIMEZONE));
  const follows = Boolean(settings.classId) && settings.classId !== before.classId;
  if (follows) await followPickedClass(settings.classId, settings);
  saveUserSettings(settings);
  // The own exam board was made for the class the student had (or the child on screen has): another class, no board, and
  // no copy of an exam of the old class kept with a date the student set (the dates stay).
  if (dropOwnBoardOnClassChange(storage, { classId: before.classId }, { classId: settings.classId })) dropKeptCopies(storage);
  // A parent's list keeps the class on screen as it is now.
  if (follows) syncShownChild(storage, settings, storedFeed(storage)?.class.siteUrl ?? pastedSite(storage));
  // And its Mashov link only while the class is still its Mashov child's: the next scan links it again.
  if (follows && settings.audience === 'parent') dropLinkOffClass(storage, settings.className, parentSchools(storage));
  // A parent's Mashov finds the child by the class: another class, so the next refresh matches again
  // rather than ten minutes on (picked in onboarding or Settings, or from an invite).
  if (follows && settings.audience === 'parent') readMashovSoon(storage);
  // The server filters this phone's pushes by them: "חופש" or a quiet hour takes effect at once.
  // A class just followed sent them already; before one is, there is no device to send them to.
  if (!follows) void syncDevicePrefs(storage, settings, sameClassNames(parentsChildren())).catch(() => undefined);
  // And the phone's own summaries: a new time, a switch, "חופש" or the quiet hours, not at the next refresh.
  rescheduleSummariesSoon();
  return { settings };
}

function school(): SchoolFeeds {
  const src = sources();
  const exams: Exam[] = localExamsFrom(src, '0000-00-00', todayStr(TIMEZONE));
  return {
    // With when the phone first saw each grade (`mashov/gradeFirstSeen.ts`): the grades tab's "חדש".
    grades: gradesOf(src, readFirstSeen(storage)),
    homework: homeworkOf(src),
    messages: messagesOf(src, localRead(storage)?.at ?? new Date().toISOString()),
    exams: filterExams(exams, src.settings),
  };
}

function attendance(): AttendanceResponse {
  return attendanceFrom(sources(), localRead(storage)?.at ?? null);
}

function bagrut(): BagrutResponse {
  const kept = localBagrut(storage);
  return { exams: kept?.exams ?? [], fetchedAt: kept?.readAt ?? null };
}

function source(partial: Pick<SourceStatus, 'source' | 'configured'> & Partial<SourceStatus>): SourceStatus {
  return {
    state: 'ok', lastOkAt: null, consecutiveFailures: 0, degradedSince: null, lastError: null, message: null,
    account: null, sourceFreshness: null, needsReauth: false, ...partial,
  };
}

function status(): StatusResponse {
  const mashov = localStatus(storage);
  // A parent's login that worked, though the child on screen is not in Mashov's list (`parents.ts`).
  const parentMissing = !mashov.needsLogin && isParentReadError(mashov.lastError);
  const google = googleStatus(storage);
  const account = googleAccount();
  const feed = storedFeed(storage);
  const googleSource = (name: 'google_calendar' | 'google_tasks') => source({
    source: name,
    configured: account !== null,
    account,
    lastOkAt: google.lastOkAt,
    lastError: google.lastError,
    state: google.needsLogin ? 'broken' : google.lastError ? 'degraded' : 'ok',
    needsReauth: google.needsLogin,
    message: googleReadMessage(google),
  });
  // A student who went on without a site has no site to connect: no card for it, and nothing to fix.
  const site = isWithoutSite(storage) ? [] : [source({
    source: 'shahaf',
    configured: feed !== null,
    lastOkAt: feed?.lastOkAt ?? null,
    sourceFreshness: feed?.freshness ?? null,
    message: feed === null ? 'עוד לא נבחרה כיתה.' : null,
  })];
  return {
    serverTime: new Date().toISOString(),
    sources: [
      ...site,
      source({
        source: 'mashov',
        configured: mashov.lastOkAt !== null || mashov.needsLogin || parentMissing,
        lastOkAt: mashov.lastOkAt,
        lastError: mashov.lastError,
        state: mashov.needsLogin ? 'broken' : mashov.lastError ? 'degraded' : 'ok',
        needsReauth: mashov.needsLogin,
        consecutiveFailures: parentMissing ? 1 : 0,
        message: mashov.needsLogin ? 'משוב ניתק את החיבור. צריך להתחבר שוב (לוקח דקה).' : parentMissing ? mashov.lastError : null,
        // The outage's start: what the reconnect sheet counts its one try against (`renewKey`).
        degradedSince: mashov.failedAt ?? null,
        session: { capturedAt: mashov.loginAt ?? null, lastOkAt: mashov.lastOkAt, failedAt: mashov.failedAt ?? null, rotatedAt: null },
      }),
      googleSource('google_calendar'),
      googleSource('google_tasks'),
    ],
  };
}

/** Google Tasks through the phone's own sign-in. */
const googleTasksDeps = (): PhoneTasksDeps => ({ kv: storage, requester: phoneGoogleRequester(), zone: TIMEZONE });

/** Where a task write goes: Google with an account, else this phone. */
const taskRoute = (): TaskRoute => ({ kv: storage, account: googleAccount(), audience: userSettings().audience, google: googleTasksDeps });

function tasks(): TasksResponse {
  return tasksOnThisPhone(storage, googleAccount() !== null);
}

function setHomeworkDone(key: string, done: boolean): SetHomeworkDoneResponse {
  markHomeworkDone(storage, key, done);
  // The evening reminder pending names what is still open: not this any more.
  rescheduleSummariesSoon();
  const item = localHomework(sources()).find((h) => h.naturalKey === key);
  if (!item) throw new ApiError(404, 'שיעורי הבית האלה כבר לא במשוב.');
  return item;
}

async function disconnectMashov(): Promise<DisconnectResponse> {
  await clearJar();
  storage.remove(MASHOV_KEYS.status);
  // A parent's list of children goes with the login.
  forgetParentLogin(storage);
  return { ok: true };
}

async function disconnectGoogle(): Promise<DisconnectResponse> {
  await signOutOfGoogle().catch(() => undefined);
  storage.remove(GOOGLE_KEYS.kept);
  storage.remove(GOOGLE_KEYS.status);
  return { ok: true };
}

function notifications(): { items: NotificationLogEntry[] } {
  return { items: readNotificationLog(storage) };
}

export const phoneApi: AppApi = {
  day: async (date) => localDay(sources(), date),
  week: async (offset) => localWeek(sources(), offset),
  agenda: async (days) => localAgenda(sources(), days),
  widgetFeed: async () => localWidgetFeed(sources()),
  status: async () => status(),
  settings: () => settingsResponse(),
  saveSettings,
  notifications: async () => notifications(),
  school: async () => school(),
  bagrut: async () => bagrut(),
  attendance: async () => attendance(),
  setHomeworkDone: async (key, done) => setHomeworkDone(key, done),
  tasks: async () => tasks(),
  createTask: async (body) => createTaskRouted(taskRoute(), body),
  updateTask: async (id, body) => updateTaskRouted(taskRoute(), id, body),
  deleteTask: async (id) => {
    await deleteTaskRouted(taskRoute(), id);
    return { ok: true };
  },
  lookUpSchoolSite,
  teachers: () => readTeachers(storage),
  goWithoutSite: async () => {
    setWithoutSite(storage, true);
    return { ok: true };
  },
  joinClass,
  sync: async () => {
    await refreshLocalSources({ force: true });
    return { ok: true, at: new Date().toISOString() };
  },
  disconnectMashov,
  disconnectGoogle,
};
