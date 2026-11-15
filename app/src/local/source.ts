/**
 * Everything the phone builds its days from (plan Phase 2e), in one place:
 * refreshing it, and reading it back from storage.
 *
 * Refreshing reads Mashov and Google on the phone, makes sure the device
 * follows the student's class, reads the class feed and notes any change
 * seen for the first time, on the class's site or in Mashov. Then the
 * friends' boxes and their classes' feeds (`buddies/run.ts`), and the sealed
 * copy a linked chat reads (`chat/run.ts`). Each step that
 * fails is reported and the rest go on: an old feed or yesterday's Mashov
 * read still makes a better day than none. One refresh at a time, and none
 * while "מחק את הנתונים שלי" runs (`holdForDelete`).
 *
 * Reading never touches the network, so the screens and the widget can build
 * from it at any time.
 *
 * The class feed is kept as the server sent it (`DEVICE_KEYS.feed`); the phone's
 * own exam board (`ownBoard.ts`), when it has one, is laid over it as the
 * sources are read (`storedSources`, and each other child's in `keptChildSources`),
 * so every screen, the widget, the mirror, the summaries, the friends and the
 * chat see the same exams, and taking the board away needs no network.
 *
 * On a parent's phone with more than one child (`children.ts`) the refresh
 * reads the child on screen as a student's class, then has the server follow
 * the other children's classes and keeps their feeds aside; the summaries
 * speak of every child.
 *
 * In the demo (`demo/mode.ts`) nothing is refreshed and nothing scheduled, and
 * reading gives the demo's made-up sources of today.
 */
import type { ClassFeed } from '@sederyom/shared';
import { todayStr } from '@sederyom/shared/logic/time';
import { BUDDY_COPY } from '../buddies/copy';
import { refreshBuddies } from '../buddies/run';
import { CHAT_COPY } from '../chat/copy';
import { refreshChat } from '../chat/run';
import { TIMEZONE } from '../config';
import { DEVICE_PLATFORM } from '../device/platform';
import { DEVICE_KEYS, followClass, readDevice, readFeedOf, refreshFeed, sendDeviceDetails, storedFeed, syncOtherClasses, V2Error } from '../device/v2';
import { syncGoogleNow } from '../google/run';
import { googleAccount, phoneGoogleRequester } from '../google/phone';
import { MIRROR_KEY, mirrorState, runPhoneMirror } from '../google/mirror';
import { GOOGLE_KEYS, googleKept } from '../google/sync';
import { mashovCoolSite } from '../mashov/phone';
import { syncMashovNow } from '../mashov/run';
import { KEYS as MASHOV_KEYS, localBagrut, localRead } from '../mashov/sync';
import { demoLocalSources, isDemo } from '../demo/phone';
import { childName, hasBagrut } from '../lib/onboarding';
import { syncSummaries } from '../notify/local';
import type { SummaryChild } from '../notify/summaries';
import { storage } from '../widget/feedCache';
import { CHANGE_SIGHTINGS_KEY, recordChanges, type ChangeSightings } from './changes';
import { childFeed, keepChildFeed, otherFollows, readChildren, sameClassNames, stashedChild, type Child, type StashedChild } from './children';
import { deviceCalendars, listedExamKeys, localExamsFrom, localLessonRows, type LocalCalendars, type LocalSources } from './days';
import { HOMEWORK_STATE_KEY, readHomeworkStates } from './homeworkState';
import { EXAM_PREFS_KEY, examSourcesRead, forgetAbsentCopies, isFeedObserved, ownBoardObserved, pruneExamDates, readExamPrefs } from './examPrefs';
import { SETTINGS_KEYS } from './keyMigrations';
import { MANUAL_EXAMS_KEY, readManualExams } from './manualExams';
import { OWN_BOARD_KEY, OWN_BOARD_READ_FAILED, dropNoneOverNoBoard, readOwnBoard, refreshOwnBoardRead, withOwnBoard } from './ownBoard';
import { PACK_LIST_KEY, readPackList } from './packList';
import { PHONE_TASKS_KEY, readPhoneTasks, withPhoneTasks } from './phoneTasks';
import { refreshSchoolCalendar } from './schoolCalendar';
import { chooseSchoolSite, classReads, isWithoutSite, keepsExamCalendar, pastedSite } from './schoolSite';
import { saveUserSettings, userSettings } from './userSettings';

const REFRESHED_AT_KEY = 'local.refreshedAt';

/** When `refreshLocalSources` last finished, from any caller. */
export function lastLocalRefresh(): Date | null {
  const raw = storage.getString(REFRESHED_AT_KEY);
  return raw ? new Date(raw) : null;
}

export interface RefreshOutcome {
  /** Each step that failed, in Hebrew. */
  problems: string[];
  device: { deviceId: string | null; className: string | null; siteUrl: string | null };
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** How long the friends' step of a refresh is waited for. */
export const BUDDIES_STEP_MS = 45_000;

/** How long the chat's step of a refresh (the sealed copy a linked chat reads) is waited for. */
export const CHAT_STEP_MS = 30_000;

/**
 * `work`, or `failure()` once `ms` have passed without it. `work` is not
 * stopped: it goes on, and a failure of its after that is nobody's to hear.
 */
function withinTime<T>(work: Promise<T>, ms: number, failure: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(failure()), ms);
  });
  work.catch(() => undefined);
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

function load<T>(key: string): T | null {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const NO_DEVICE: RefreshOutcome['device'] = { deviceId: null, className: null, siteUrl: null };

/** The refresh running now, if one is: a second call while it runs gets the same promise. */
let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * "מחק את הנתונים שלי" is running (`holdForDelete`): no refresh and no
 * summaries start, so nothing writes back what the delete wipes, registers
 * the phone again, or schedules what it cancelled.
 */
let deleting = false;

/**
 * Before "מחק את הנתונים שלי" deletes anything: no new refresh or summaries
 * start, and the ones running finish (the refresh, a Mashov or Google read
 * begun elsewhere, the summaries queued), so the delete finds the device and
 * the storage as they end up. `releaseAfterDelete` lets them run again.
 */
export async function holdForDelete(running: readonly (Promise<unknown> | null)[] = []): Promise<void> {
  deleting = true;
  if (summariesSoon !== null) clearTimeout(summariesSoon);
  summariesSoon = null;
  await Promise.all([refreshing, rescheduling, ...running].map((p) => p?.catch(() => undefined)));
}

/** After the delete, done or failed: refreshes and summaries run again. */
export function releaseAfterDelete(): void {
  deleting = false;
}

export function refreshLocalSources(opts: { force?: boolean } = {}): Promise<RefreshOutcome> {
  // The demo reads nothing: no Mashov, no Google, no device, no class feed, no exam calendar.
  if (deleting || isDemo()) return Promise.resolve({ problems: [], device: NO_DEVICE });
  refreshing ??= refreshOnce(opts).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshOnce(opts: { force?: boolean }): Promise<RefreshOutcome> {
  const problems: string[] = [];
  const now = new Date();

  // The class the phone already knows decides whether bagrut is read at all.
  // What this refresh read, for the exams the school may have taken off its list (`forgetAbsentCopies`): only a read that
  // worked now is an observation. A stored list from an earlier refresh, a failed read and one that was skipped are not.
  let mashovRead = false;
  await syncMashovNow({ ...opts, bagrut: hasBagrut(userSettings().className) })
    .then((outcome) => {
      mashovRead = outcome.kind === 'ok';
    })
    .catch((err) => problems.push(`משוב: ${message(err)}`));
  await syncGoogleNow(opts).catch((err) => problems.push(`Google: ${message(err)}`));

  const settings = userSettings();
  // "Without a site" (plan Phase 3): no class to follow or read, and nothing said about a missing site.
  const reads = classReads(settings.classId, isWithoutSite(storage));
  let device = NO_DEVICE;
  if (reads.follow) {
    try {
      // No device yet (or the server forgot it): following the class is what registers one.
      let current = await readDevice(storage);
      // A parent's child on screen is followed at its own school: two children's classes can share a
      // `cls` at two schools. Its site is its feed's, else the one the switch left (`switchChild`).
      const shownSite = parentsChildren() ? (storedFeed(storage)?.class.siteUrl ?? pastedSite(storage)) : null;
      if (current?.class?.classId !== settings.classId || (shownSite !== null && current.class.siteUrl !== shownSite)) {
        // The followed class's site, else the pasted one, else Mashov's.
        const site = await chooseSchoolSite({ feed: storedFeed(storage)?.class.siteUrl, pasted: pastedSite(storage) }, () => mashovCoolSite());
        if (!site.url) throw new Error('משוב לא החזיר את אתר שחף של בית הספר');
        current = await followClass(storage, DEVICE_PLATFORM, site.url, settings.classId);
      }
      device = { deviceId: current.deviceId, className: current.class?.className ?? null, siteUrl: current.class?.siteUrl ?? null };
    } catch (err) {
      problems.push(`רישום המכשיר: ${err instanceof V2Error ? `${err.status} ${err.message}` : message(err)}`);
    }
  }

  // What the server filters this phone's pushes by, and where it sends them, when either changed.
  // Only to a device the phone has: it has one only while it follows a class.
  await sendDeviceDetails(storage, settings, sameClassNames(parentsChildren())).catch((err) => problems.push(`העדפות התראות: ${message(err)}`));

  let feed = storedFeed(storage);
  let feedRead = false;
  let ownReadFailed = false;
  if (reads.feed) {
    try {
      // `null` before a class is followed: nothing to read yet, and nothing wrong. A read of the class on screen only
      // (`isFeedObserved`): a feed of the class the device still follows, when following this one failed, is no read of it.
      const fresh = await refreshFeed(storage);
      feed = fresh ?? feed;
      feedRead = isFeedObserved(fresh, shownClass(settings.classId));
      // "בלי הלוח של הכיתה" over a class seen to have no board hides nothing: it goes (A-M5).
      if (feedRead && fresh) dropNoneOverNoBoard(storage, fresh.class);
    } catch (err) {
      problems.push(`הפיד של הכיתה: ${message(err)}`);
    }
    if (feed && feed.lastOkAt === null) problems.push('אתר הכיתה עוד לא נקרא. זה קורה בתוך רבע שעה מהרישום.');
    // The phone's own exam calendar, when its board is one: read by the phone itself, after the class's feed, at most once
    // an hour unless the person asked for this refresh (`force`: pull to refresh). A read that fails keeps the last one
    // and is said once (`refreshOwnBoardRead` does not throw).
    const ownRead = await refreshOwnBoardRead(storage, todayStr(TIMEZONE), TIMEZONE, undefined, { force: opts.force === true });
    ownReadFailed = ownRead.failed;
    if (ownRead.failed) problems.push(OWN_BOARD_READ_FAILED);
    await refreshOtherChildren().catch((err) => problems.push(`הכיתות של שאר הילדים: ${message(err)}`));
  }

  // The Ministry's vacations as the server has them, at most once a day, before the days below are
  // built. Not a problem when it fails: the list the phone has stays.
  await refreshSchoolCalendar(storage);

  // The feed's changes, and Mashov's own on the days its grid fills, are noted the same way.
  const src = loadLocalSources(now);
  const fromMashov = localLessonRows(src).filter((row) => row.source === 'mashov');
  const seen = recordChanges([...(feed?.lessons ?? []), ...fromMashov], src.changeSeen ?? {}, now, TIMEZONE, todayStr(TIMEZONE));
  storage.set(CHANGE_SIGHTINGS_KEY, JSON.stringify(seen));

  // The dates the student set for exams are kept up the same way. A copy of an exam goes when this refresh read its source
  // and the exam is not there while the school's date is recent (the school took it off its list, or re-dated it under
  // another key); then a date the school has contradicted, or that is long past, goes. For the student (or the child) on
  // screen, whose keys these are; a parent's other children are aside, and are left as they are. By the sources' own
  // dates, as they are listed now. A phone not refreshed between the removal and the day the date ages out of the feed
  // has seen nothing, and keeps the copy: that limit is accepted. With a board of the student's own, the class board's
  // exams are observed only as that board was (`ownBoardObserved`): rows over a feed, a calendar read in good order, and
  // never the class board turned off.
  const today = todayStr(TIMEZONE);
  forgetAbsentCopies(
    storage,
    listedExamKeys(src, today),
    today,
    examSourcesRead({ feed: feedRead, mashov: mashovRead, ownBoard: ownBoardObserved(readOwnBoard(storage), src.feed !== null, ownReadFailed) }),
  );
  pruneExamDates(storage, localExamsFrom(src, '0000-00-00', today), today);

  // The exam calendar is the phone's once a class is picked, or the student went on without a site.
  if (keepsExamCalendar(settings.classId, isWithoutSite(storage)) && googleAccount()) {
    // A parent's calendar holds every child's exams (`mirrorChildren`); a student's, their own.
    const mirrored = await runPhoneMirror({ kv: storage, requester: phoneGoogleRequester(), src, others: mirrorChildren(src), now });
    if (mirrored.lastError) problems.push(`יומן המבחנים: ${mirrored.lastError}`);
  }

  // My boxes for my friends, from the Mashov read and the feed above, then theirs and their classes' feeds.
  // A server that never answers must not hold the refresh (and the summaries after it): past
  // `BUDDIES_STEP_MS` the refresh goes on without it, and the step finishes, or not, on its own.
  await withinTime(refreshBuddies(), BUDDIES_STEP_MS, () => new Error(BUDDY_COPY.failed)).catch((err) => problems.push(`חברים: ${message(err)}`));

  // The sealed copy of the school day for a linked chat, after the Mashov read and the feed above; nothing
  // while no chat is linked. Held no longer than `CHAT_STEP_MS`, as the friends' step is.
  await withinTime(refreshChat(), CHAT_STEP_MS, () => new Error(CHAT_COPY.failed)).catch((err) => problems.push(`צ׳אט: ${message(err)}`));

  // The morning summary and the evening reminder, from the days as they are now, again on every
  // refresh. From what is stored when it runs, not `src` above: a setting saved during the network
  // calls above must not be undone by this.
  try {
    await rescheduleSummaries();
  } catch (err) {
    problems.push(`סיכום הבוקר ותזכורת הערב: ${message(err)}`);
  }

  storage.set(REFRESHED_AT_KEY, now.toISOString());
  return { problems, device };
}

/**
 * A parent's other children (`children.ts`): the server follows their classes
 * besides the device's own, and their feeds are kept aside, for the summaries
 * and for the switch. A server from before stage 2 has no route for them
 * (`unsupported`): only the child on screen is followed, and Settings says so.
 */
async function refreshOtherChildren(): Promise<void> {
  const children = parentsChildren();
  const sync = await syncOtherClasses(storage, otherFollows(children));
  if (!children || sync === 'unsupported' || sync === 'none') return;
  for (const child of children.list) {
    if (child.id === children.activeId) continue;
    // One child's feed failing keeps what was kept for it, and the others are still read.
    const feed = await readFeedOf(storage, child.siteUrl, child.classId).catch(() => null);
    if (feed) keepChildFeed(storage, child.id, feed);
  }
}

/**
 * The class on screen, as a fresh feed is held to (`isFeedObserved`): the student's, or the child's on a parent's
 * phone, with that child's school's site; a student's site is not known here, and is not compared.
 */
function shownClass(classId: string): { classId: string; siteUrl: string | null } {
  const children = parentsChildren();
  const active = children?.list.find((child) => child.id === children.activeId);
  return { classId, siteUrl: active?.siteUrl || null };
}

/**
 * The children list, while the phone is a parent's: switched to a student's, the
 * list is kept, and nothing reads it until it is a parent's again.
 */
export function parentsChildren(): ReturnType<typeof readChildren> {
  return userSettings().audience === 'parent' ? readChildren(storage) : null;
}

/**
 * Runs `change` once no refresh is running: one that began before read the
 * settings of the child on screen then, and would keep what it reads under
 * that child's keys after `change` put another one there.
 */
export async function betweenRefreshes<T>(change: () => T): Promise<T> {
  while (refreshing) await refreshing.catch(() => undefined);
  return change();
}

/**
 * A parent's children, in their order, as the summaries read them: the one on
 * screen from `src`, the others from what is kept aside for them. None on a
 * phone with fewer than two.
 */
function summaryChildren(src: LocalSources): SummaryChild[] {
  const children = parentsChildren();
  if (!children) return [];
  const shown = { siteUrl: src.feed?.class.siteUrl ?? pastedSite(storage), classId: src.settings.classId, feed: classFeedNow() };
  return children.list.map((child): SummaryChild => {
    if (child.id === children.activeId) return { label: childName({ ...child, className: src.settings.className }), src };
    return { label: childName(child), src: keptChildSources(src, child, stashedChild(storage, child.id), shown) };
  });
}

/**
 * A child kept aside, as its own sources. Mashov and Google are read for the
 * child on screen only, so here each child has the class's site and its own
 * lists, as the summaries speak of it, and its own exam board over the class's
 * (a calendar board is read for the child on screen only, as Mashov is).
 * `shown.feed` is the feed on screen as the server sent it (`classFeedNow`).
 */
function keptChildSources(
  src: LocalSources,
  child: Child,
  kept: StashedChild,
  shown: { siteUrl: string | null; classId: string; feed: LocalSources['feed'] },
): LocalSources {
  const feed = childFeed(child, kept, shown);
  return {
    ...src,
    feed,
    mashov: [],
    bagrut: [],
    google: [],
    homeworkState: {},
    manualExams: kept.manualExams,
    examPrefs: kept.examPrefs,
    pack: kept.pack,
    changeSeen: kept.changeSeen,
    calendars: deviceCalendars(null, feed, kept.ownBoard),
    settings: {
      ...src.settings,
      classId: child.classId,
      className: child.className,
      // The child's own picks and names, never the child on screen's.
      lessons: { ...src.settings.lessons, hiddenSubjects: child.hiddenSubjects, subjectNames: child.subjectNames ?? {} },
    },
  };
}

/**
 * A parent's other children, as the "בית ספר" calendar holds them
 * (`runPhoneMirror`): each one's exams, the site's and those of the Mashov read
 * kept with it, so a switch of the child on screen takes none of them out.
 */
function mirrorChildren(src: LocalSources): { src: LocalSources; className: string }[] {
  const children = parentsChildren();
  if (!children) return [];
  const shown = { siteUrl: src.feed?.class.siteUrl ?? pastedSite(storage), classId: src.settings.classId, feed: classFeedNow() };
  return children.list
    .filter((child) => child.id !== children.activeId)
    .map((child) => {
      const kept = stashedChild(storage, child.id);
      return { src: { ...keptChildSources(src, child, kept, shown), mashov: kept.mashov, bagrut: kept.bagrut }, className: child.className };
    });
}

/** Saves the settings a change of child gives back (`switchChild`, `removeChild`). */
export function saveChildSettings(settings: ReturnType<typeof userSettings> | null): boolean {
  if (!settings) return false;
  saveUserSettings(settings);
  return true;
}

/** The last `rescheduleSummaries` asked for; each waits for the one before. */
let rescheduling: Promise<void> = Promise.resolve();

/**
 * The phone's own morning summaries and evening reminders, scheduled again
 * from what it has now (`notify/summaries.ts`): after a refresh, a changed
 * setting, a homework tick, a task.
 *
 * One at a time, each reading the sources and the settings when its turn
 * comes, so the last one asked for decides what is pending: a refresh that
 * began before a setting changed cannot bring back what the change
 * cancelled. Throws on failure; callers outside a refresh ignore it.
 *
 * While "מחק את הנתונים שלי" runs, nothing is scheduled: not one asked for
 * now, nor one already waiting its turn. Nor in the demo, whose days are made up.
 */
export function rescheduleSummaries(): Promise<void> {
  if (deleting || isDemo()) return Promise.resolve();
  const run = rescheduling.then(() => {
    if (deleting || isDemo()) return undefined;
    const src = loadLocalSources();
    return syncSummaries(src, TIMEZONE, summaryChildren(src));
  });
  rescheduling = run.catch(() => undefined);
  return run;
}

/**
 * How long a change on the phone waits before the summaries are scheduled
 * again for it. In the same turn as the tap, building them held the JS
 * thread: the press showed late, and people tapped again.
 */
export const SUMMARIES_AFTER_CHANGE_MS = 600;

let summariesSoon: ReturnType<typeof setTimeout> | null = null;

/**
 * `rescheduleSummaries` a moment from now (`SUMMARIES_AFTER_CHANGE_MS`), for
 * a tick, a task, a saved setting: the tap shows first, and changes close
 * together share one. Failures are nobody's to hear, as before.
 */
export function rescheduleSummariesSoon(): void {
  if (summariesSoon !== null) clearTimeout(summariesSoon);
  summariesSoon = setTimeout(() => {
    summariesSoon = null;
    void rescheduleSummaries().catch(() => undefined);
  }, SUMMARIES_AFTER_CHANGE_MS);
}

/** What the phone has now. */
export function loadLocalSources(now: Date = new Date()): LocalSources {
  if (isDemo()) return demoLocalSources(now);
  return { ...storedSources(), zone: TIMEZONE, now };
}

type StoredSources = Omit<LocalSources, 'zone' | 'now'>;

/**
 * What `loadLocalSources` read from each store: the string the store held,
 * and what it became. Every screen asks for the sources, Today some ten times
 * after each refresh, and each time every store was parsed again; now only a
 * store whose string changed is. The strings are compared each time, so a
 * write from anywhere counts at once (the background task's, a test's). What
 * did not change stays the very same object, so what is built from it is kept
 * too (`local/days.ts`). Nothing that reads the sources may change them.
 */
const reads = new Map<string, { raw: string | undefined; also: string; value: unknown }>();

/** The sources last put together. */
let kept: StoredSources | null = null;

/** `read()`, or what it gave last while `key` held the same string; `also` is anything else the value depends on. */
function sameOrRead<T>(key: string, read: () => T, also = ''): T {
  const raw = storage.getString(key);
  const before = reads.get(key);
  if (before && before.raw === raw && before.also === also) return before.value as T;
  const value = read();
  reads.set(key, { raw, also, value });
  return value;
}

/** The class feed on screen as the server sent it, without the phone's own exam board over it. */
function classFeedNow(): ClassFeed | null {
  return sameOrRead(DEVICE_KEYS.feed, () => storedFeed(storage));
}

/** `fresh`, or the very object `before` is when it says the same: what is built from it is kept. */
function sameCalendars(before: LocalCalendars | undefined, fresh: LocalCalendars): LocalCalendars {
  return before && before.school === fresh.school && before.exam === fresh.exam && before.ownExam === fresh.ownExam ? before : fresh;
}

function storedSources(): StoredSources {
  // The settings are merged over defaults that depend on the day.
  const today = todayStr(TIMEZONE);
  const classFeed = classFeedNow();
  const ownBoard = sameOrRead(OWN_BOARD_KEY, () => readOwnBoard(storage));
  // The class's feed under the phone's own exam board: the same object while neither the feed nor the board changed.
  const feed = withOwnBoard(classFeed, ownBoard);
  const mirrorCalendar = sameOrRead(MIRROR_KEY, () => mirrorState(storage).calendarId);
  const before = kept;
  const read: StoredSources = {
    feed,
    mashov: sameOrRead(MASHOV_KEYS.read, () => localRead(storage)?.entities ?? []),
    bagrut: sameOrRead(MASHOV_KEYS.bagrut, () => localBagrut(storage)?.exams ?? []),
    manualExams: sameOrRead(MANUAL_EXAMS_KEY, () => readManualExams(storage)),
    examPrefs: sameOrRead(EXAM_PREFS_KEY, () => readExamPrefs(storage)),
    // The tasks kept on the phone alone are laid over what Google kept; their own string is what else the read depends on.
    google: sameOrRead(GOOGLE_KEYS.kept, () => withPhoneTasks(googleKept(storage), readPhoneTasks(storage)), storage.getString(PHONE_TASKS_KEY) ?? ''),
    settings: sameOrRead(SETTINGS_KEYS.user, () => userSettings(), today),
    calendars: sameCalendars(before?.calendars, deviceCalendars(mirrorCalendar, feed, ownBoard)),
    changeSeen: sameOrRead(CHANGE_SIGHTINGS_KEY, () => load<ChangeSightings>(CHANGE_SIGHTINGS_KEY) ?? {}),
    homeworkState: sameOrRead(HOMEWORK_STATE_KEY, () => readHomeworkStates(storage)),
    pack: sameOrRead(PACK_LIST_KEY, () => readPackList(storage)),
  };
  // Nothing changed: the sources as they were, the same object.
  if (before && (Object.keys(read) as (keyof StoredSources)[]).every((k) => read[k] === before[k])) return before;
  kept = read;
  return read;
}
