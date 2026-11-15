import './random';
/**
 * Friends on the phone (docs/superpowers/specs/2026-10-29-friends-design.md,
 * 3.2, 4.4 and 4.5): the refresh step, the screens' models over what the phone
 * keeps, and every change a screen asks for.
 *
 * - `refreshBuddies`, a step of `refreshLocalSources` after the Mashov read
 *   and the class feed: my boxes and theirs (`syncBuddies`), then each
 *   friend's class feed, read once per class. With no friend, no invite and
 *   no answer pending it writes nothing, and the device goes when the phone
 *   follows no class and has no chat linked, or code waiting for one, either (3.2).
 * - `buddiesView`, `buddyPage`, `buddyTodayLines`: `view.ts` over what is
 *   kept, or over the demo's made-up friend (`demo/buddies.ts`).
 * - The changes: an invite, an answer, a removal, what I share, a name, and
 *   every box gone for ״למחוק את הנתונים שלי״.
 * - Grades (docs/superpowers/specs/2026-10-30-buddies-grades-design.md): my
 *   grades box is built here from what the phone holds (`myGrades`) for the
 *   refresh and for an accepted link, and again, whole, for the page that sets
 *   it beside a friend's (`inputFor`); turning them off deletes the box in the
 *   same action (2.5), then refreshes, so my main box says off at once; the
 *   tab's button turns them on and refreshes (2.2),
 *   and opening the tab answers the dot (2.4).
 *
 * One at a time: each waits for the one before (a single queue), so a
 * removal never races a write still on its way. A failure says
 * ״לא הצלחנו להתחבר. כדאי לנסות שוב.״ (`BUDDY_COPY.failed`), never the
 * protocol's words. Nothing at all for a parent; in the demo nothing reaches
 * the network, and a change says ״בהדגמה זה לא נשמר״.
 *
 * The import above installs the random source tweetnacl needs on the phone
 * (`random.ts`): the background task and the widget reach this file without
 * the app's entry.
 */
import type { BagrutExam, BuddyBoxContent, BuddyGradesContent, BuddyShares, ClassFeed, DateStr } from '@sederyom/shared';
import { BUDDY_EXAM_DAYS } from '@sederyom/shared';
import type { MashovGrade } from '@sederyom/shared/logic/mashov/normalize';
import { AUTH_COOKIE, parseMashovToken } from '@sederyom/shared/logic/mashov/session';
import { addDays, weekStart } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { chatHoldsDevice } from '../chat/store';
import { TIMEZONE } from '../config';
import { demoBuddies } from '../demo/buddies';
import { DEMO_COPY } from '../demo/mode';
import { isDemo, todaysDemo } from '../demo/phone';
import { DEVICE_PLATFORM } from '../device/platform';
import { buddyServer, dropIdleDevice, readFeedOf, storedFeed } from '../device/v2';
import { realGrade } from '../lib/bagrut';
import { readGradeWeights } from '../lib/gradeWeightsStore';
import { buildLocalDays, type LocalSources } from '../local/days';
import { classReads, isWithoutSite, pastedSite } from '../local/schoolSite';
import { loadLocalSources } from '../local/source';
import { userSettings } from '../local/userSettings';
import { readMashovJar } from '../mashov/phone';
import { localBagrut, localRead } from '../mashov/sync';
import { storage } from '../widget/feedCache';
import { myBoxContent } from './content';
import { BUDDY_COPY } from './copy';
import { attendanceOf, withSchoolDates } from './days';
import { myGradesContent } from './grades';
import {
  acceptInvite, cancelInvites, createInvite, dropAllBoxes, isAnsweredHere, isOwnInvite, readInvite, removeBuddy, stopGrades, syncBuddies, type MyGrades,
} from './protocol';
import { BUDDY_KEYS, buddyFeedKey, keptShares, readBuddies, saveBuddies, type BuddiesState } from './store';
import { cleanBuddyName, isBuddyName } from './validate';
import {
  buddiesModel, emptyBuddiesView, buddyPageModel, todayLinesModel, type BuddiesInput, type BuddiesView, type BuddyPage, type TodayLine,
} from './view';

// ---------------------------------------------------------------------------
// One at a time
// ---------------------------------------------------------------------------

/** The last operation asked for, done or failed; the next one waits for it. */
let queue: Promise<unknown> = Promise.resolve();

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

const failed = (): never => {
  throw new Error(BUDDY_COPY.failed);
};

/** A change a screen asks for: in turn, and in Hebrew when it fails; refused in the demo. */
function action<T>(work: () => Promise<T>): Promise<T> {
  if (isDemo()) return Promise.reject(new Error(DEMO_COPY.notSaved));
  return inTurn(work).catch(failed);
}

/** The state as it is now, changed by `edit` and saved. */
function change(edit: (state: BuddiesState) => void): void {
  const state = readBuddies(storage);
  edit(state);
  saveBuddies(storage, state);
}

const server = () => buddyServer(storage, DEVICE_PLATFORM);

// ---------------------------------------------------------------------------
// What I share
// ---------------------------------------------------------------------------

const dateOf = (now: Date): DateStr => DateTime.fromJSDate(now).setZone(TIMEZONE).toISODate()!;

/** From this week's Sunday to `BUDDY_EXAM_DAYS` ahead (what my box covers), and the week of `also`. */
function myDates(now: Date, also?: DateStr): DateStr[] {
  const today = dateOf(now);
  let from = weekStart(today, 0, TIMEZONE);
  let to = addDays(today, BUDDY_EXAM_DAYS, TIMEZONE);
  if (also) {
    const sunday = weekStart(also, 0, TIMEZONE);
    if (sunday < from) from = sunday;
    if (addDays(sunday, 6, TIMEZONE) > to) to = addDays(sunday, 6, TIMEZONE);
  }
  const dates: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1, TIMEZONE)) dates.push(d);
  return dates;
}

/** My school's Shahaf site: the followed class's, else the one pasted; none for a school without one. */
function mySite(src: LocalSources): string | null {
  return isWithoutSite(storage) ? null : (src.feed?.class.siteUrl ?? pastedSite(storage));
}

/** Mashov's id of my school (`Semel`), from the session the phone holds, and kept for the screens; else as last kept. */
async function mashovSchool(): Promise<string | null> {
  const jar = await readMashovJar();
  const token = jar[AUTH_COOKIE] ? parseMashovToken(`${AUTH_COOKIE}=${jar[AUTH_COOKIE]}`) : null;
  if (token?.schoolId) storage.set(BUDDY_KEYS.school, token.schoolId);
  return token?.schoolId ?? (storage.getString(BUDDY_KEYS.school) || null);
}

/** My box for a friend, from what the phone has now: my days, my absences, my class and my picks. */
async function myContent(now: Date): Promise<(shares: BuddyShares) => BuddyBoxContent> {
  const school = await mashovSchool();
  const src = loadLocalSources(now);
  // On the school's dates for exams, not on any the student set for themselves: a friend is told the school's.
  const days = buildLocalDays(withSchoolDates(src), myDates(now));
  const readAt = localRead(storage)?.at ?? null;
  const attendance = readAt ? attendanceOf(src, readAt) : null;
  const siteUrl = mySite(src);
  const { classId, className, lessons } = src.settings;
  return (shares) =>
    myBoxContent({
      name: readBuddies(storage).myName, shares, days, attendance, siteUrl, classId, className,
      hiddenSubjects: lessons.hiddenSubjects, mashovSchool: school, readAt, now,
    });
}

/**
 * My grades box for a friend, from what the phone has now: Mashov's grades
 * (not Classroom's) with my own weights, the bagrut rows when `withBagrut`, as
 * of the last Mashov read; `null` before there was one (`MyGrades`). Read when
 * the protocol asks, which is only while some friend and I both share grades.
 */
function myGrades(now: Date): MyGrades {
  return (withBagrut) => gradesBox(loadLocalSources(now), withBagrut);
}

/** `myGrades` over sources already loaded. The demo's are made up, not read: its grades are as of now. */
function gradesBox(src: LocalSources, withBagrut: boolean): BuddyGradesContent | null {
  const readAt = isDemo() ? src.now.toISOString() : (localRead(storage)?.at ?? null);
  if (readAt === null) return null;
  const grades = src.mashov.filter((e) => e.kind === 'grade').map((e) => e.payload as MashovGrade);
  return myGradesContent({ grades, weights: readGradeWeights(), bagrut: src.bagrut, withBagrut, readAt });
}

/**
 * Whether the phone has a bagrut questionnaire with a grade of Mashov's own to share (a status code is none): the switch ״גם ציוני בגרות״ is offered only then (2.1).
 * The demo's bagrut is made up and not kept, so it is the demo's own that counts there.
 */
export function myHasBagrut(): boolean {
  return hasBagrutGrade(isDemo() ? todaysDemo().bagrut : (localBagrut(storage)?.exams ?? []));
}

const hasBagrutGrade = (exams: readonly BagrutExam[]): boolean => exams.some((e) => [e.schoolGrade, e.examGrade, e.finalGrade].some((g) => realGrade(g) !== null));

// ---------------------------------------------------------------------------
// The refresh step
// ---------------------------------------------------------------------------

/** Friends, invites or answers pending: anything the device is kept for besides a class. */
const busy = (s: BuddiesState): boolean => s.buddies.length + s.invites.length + s.answers.length > 0;

/**
 * Drops the device once nothing needs it: no friend, invite or answer, no class
 * followed (3.2), and no chat linked or code waiting for one (chat connection
 * spec 4.5): the device's deletion takes every chat with it, so a linked chat, or
 * a code waiting for its chat, keeps the device. A code nobody used lets it go
 * once it has expired (`chat/run.ts`).
 */
function dropWhenIdle(): Promise<boolean> {
  const follows = classReads(userSettings().classId, isWithoutSite(storage)).follow;
  return dropIdleDevice(storage, !busy(readBuddies(storage)) && !follows && !chatHoldsDevice(storage));
}

/**
 * Each friend's class feed, once per class, kept under `buddyFeedKey`. A
 * friend in my own class reads mine, and one who shares no timetable, or has
 * no site, has none. One class failing keeps what was kept for it (a class
 * nobody follows any more is refused), and the others are still read.
 */
async function readBuddyFeeds(): Promise<void> {
  const own = storedFeed(storage)?.class;
  const classes = new Map<string, { siteUrl: string; classId: string }>();
  for (const buddy of readBuddies(storage).buddies) {
    const t = buddy.theirs?.timetable;
    if (!t?.siteUrl || (own?.siteUrl === t.siteUrl && own.classId === t.classId)) continue;
    classes.set(buddyFeedKey(t.siteUrl, t.classId), { siteUrl: t.siteUrl, classId: t.classId });
  }
  for (const [key, { siteUrl, classId }] of classes) {
    const feed = await readFeedOf(storage, siteUrl, classId).catch(() => null);
    if (feed) storage.set(key, JSON.stringify(feed));
  }
}

const isParent = (): boolean => userSettings().audience === 'parent';

async function refreshNow(): Promise<void> {
  if (isParent()) return;
  if (!busy(readBuddies(storage))) {
    await dropWhenIdle();
    return;
  }
  const now = new Date();
  await syncBuddies(storage, server(), await myContent(now), now, myGrades(now));
  await readBuddyFeeds();
  // The last friend may have ended it in this sync.
  await dropWhenIdle();
}

/** The friends' part of a refresh (4.4); nothing in the demo. */
export function refreshBuddies(): Promise<void> {
  if (isDemo()) return Promise.resolve();
  return inTurn(refreshNow).catch(failed);
}

// ---------------------------------------------------------------------------
// The screens' models
// ---------------------------------------------------------------------------

/** The friends' class feeds as kept; one that does not read is none. */
function keptFeeds(state: BuddiesState): Map<string, ClassFeed> {
  const feeds = new Map<string, ClassFeed>();
  for (const buddy of state.buddies) {
    const t = buddy.theirs?.timetable;
    if (!t?.siteUrl) continue;
    const key = buddyFeedKey(t.siteUrl, t.classId);
    try {
      const raw = storage.getString(key);
      if (raw && !feeds.has(key)) feeds.set(key, JSON.parse(raw) as ClassFeed);
    } catch {
      // Not a feed: as if none were kept.
    }
  }
  return feeds;
}

function inputFor(now: Date, dates: readonly DateStr[]): BuddiesInput {
  const base = loadLocalSources(now);
  const audience = base.settings.audience;
  const demo = isDemo() ? demoBuddies(now, TIMEZONE) : null;
  const state = demo?.state ?? readBuddies(storage);
  return {
    state,
    feeds: demo ? new Map(Object.entries(demo.feeds)) : keptFeeds(state),
    base,
    // A parent is shown none of it: no days are built for nothing.
    // On the school's dates for exams too: my side of the comparison is set beside a friend's, which are the school's.
    mine: audience === 'parent' ? [] : buildLocalDays(withSchoolDates(base), dates),
    audience,
    now,
    zone: TIMEZONE,
    mySchool: { siteUrl: mySite(base), mashovSchool: storage.getString(BUDDY_KEYS.school) || null },
    // Only the grades tab reads these, and it shows a friend's grades only when some are kept, so none are built before that.
    myGrades: state.buddies.some((b) => b.theirGrades !== null) ? gradesBox(base, true) : null,
    myHasBagrut: hasBagrutGrade(base.bagrut),
  };
}

/**
 * What is kept, when there is no friend in it: then the models need none of
 * my days, and neither the days are built nor the sources read (most phones
 * have no friend, and the list and Today ask often). The demo has its friend.
 */
function noBuddiesKept(): BuddiesState | null {
  if (isDemo()) return null;
  const state = readBuddies(storage);
  return state.buddies.length === 0 ? state : null;
}

export function buddiesView(now: Date): BuddiesView {
  const idle = noBuddiesKept();
  return idle ? emptyBuddiesView(idle, userSettings().audience) : buddiesModel(inputFor(now, myDates(now)));
}

/** A friend's page on `date`, or on the day it opens on when `date` is not given (`buddyPageDate`). */
export function buddyPage(id: string, date: DateStr | undefined, now: Date): BuddyPage | null {
  if (noBuddiesKept()) return null;
  return buddyPageModel(inputFor(now, myDates(now, date)), id, date);
}

export function buddyTodayLines(date: DateStr, now: Date): TodayLine[] {
  if (noBuddiesKept()) return [];
  return todayLinesModel(inputFor(now, [date]), date);
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** A new invite's secret, for the link (`buddyUrl`), or `'full'`. */
export function createBuddyInvite(shares: BuddyShares): Promise<string | 'full'> {
  return action(() => createInvite(storage, server(), shares, new Date()));
}

/**
 * What a link opened here is, before asking to accept it: my own invite
 * (`'own'`), one this phone answered already (`'answered'`, `acceptBuddyInvite`
 * finishes it), or who invites and what they offer, `'used'` or `'gone'`.
 */
export function checkBuddyInvite(secret: string): Promise<'own' | 'answered' | { name: string; shares: BuddyShares } | 'used' | 'gone'> {
  return action(async () => {
    if (isOwnInvite(storage, secret)) return 'own';
    if (isAnsweredHere(storage, secret)) return 'answered';
    return readInvite(server(), secret);
  });
}

export function acceptBuddyInvite(secret: string, shares: BuddyShares): Promise<'ok' | 'used' | 'gone' | 'full' | 'own'> {
  return action(async () => {
    const now = new Date();
    return acceptInvite(storage, server(), secret, shares, await myContent(now), now, myGrades(now));
  });
}

/** Ends a friendship from my side (4.5); the device goes with the last friend when there is no class and no chat linked or code waiting for one. */
export function removeBuddyNow(id: string): Promise<void> {
  return action(async () => {
    await removeBuddy(storage, server(), id);
    // The friend is gone either way: a device left behind goes on the next refresh.
    await dropWhenIdle().catch(() => undefined);
  });
}

/**
 * Withdraws the invites nobody answered yet (״לבטל את ההזמנות שעוד לא אושרו?״):
 * their links read gone from now on (`cancelInvites`). The device goes when
 * nothing else needs it, as after the last friend.
 */
export function cancelBuddyInvites(): Promise<void> {
  return action(async () => {
    await cancelInvites(storage, server());
    await dropWhenIdle().catch(() => undefined);
  });
}

/**
 * What I share with a friend; it reaches them with the next refresh (2.7),
 * but for the grades turned off (grades 2.5, 4.4): then their grades leave the
 * phone and my grades box leaves the server in this same action, and then the
 * friends are refreshed, so my main box says off now and the friend stops
 * writing their grades to me. A failure of either is let go: the choice is
 * kept, and the next sync deletes the box, the rule no longer holding. The
 * same goes for the bagrut turned off alone: their bagrut leaves the phone at
 * once, and a refresh has my box rewritten without it now, not at the next
 * one. A parent has no friends: nothing is changed.
 */
export function setBuddyShares(id: string, shares: BuddyShares): Promise<void> {
  return action(async () => {
    if (isParent()) return;
    const before = readBuddies(storage).buddies.find((b) => b.id === id)?.shares;
    const kept = keptShares(shares);
    change((s) => {
      const buddy = s.buddies.find((b) => b.id === id);
      if (buddy) buddy.shares = kept;
    });
    if (!before) return;
    if (before.grades && !kept.grades) {
      await stopGrades(storage, server(), id).catch(() => undefined);
      await refreshNow().catch(() => undefined);
    } else if (before.bagrut && !kept.bagrut) {
      change((s) => {
        delete s.buddies.find((b) => b.id === id)?.theirGrades?.bagrut;
      });
      await refreshNow().catch(() => undefined);
    }
  });
}

/**
 * The button on the grades tab (grades 2.2): turns on my grades for this
 * friend, or the bagrut along with them (`'bagrut'`, which needs the grades),
 * answers the dot, and refreshes the friends, so what they shared arrives now
 * and mine goes. A failed refresh says so, and what was turned on stays on.
 */
export function turnOnBuddyGrades(id: string, which: 'grades' | 'bagrut'): Promise<void> {
  return action(async () => {
    if (isParent()) return;
    change((s) => {
      const buddy = s.buddies.find((b) => b.id === id);
      if (!buddy) return;
      buddy.shares = keptShares({ ...buddy.shares, grades: true, bagrut: buddy.shares.bagrut === true || which === 'bagrut' });
      buddy.gradesDot = false;
    });
    await refreshNow();
  });
}

/** The grades tab was opened: its dot goes (grades 2.4). */
export function markBuddyGradesSeen(id: string): Promise<void> {
  // The demo's friend is made up anew each time: nothing to mark.
  if (isDemo()) return Promise.resolve();
  return action(async () => {
    if (isParent()) return;
    change((s) => {
      const buddy = s.buddies.find((b) => b.id === id);
      if (buddy) buddy.gradesDot = false;
    });
  });
}

/**
 * My own name for a friend, without the marks nobody sees (`cleanBuddyName`);
 * `''`, or nothing but such marks, goes back to theirs. `false` for a name
 * that is not one (`isBuddyName`).
 */
export function renameBuddy(id: string, label: string): Promise<boolean> {
  const name = cleanBuddyName(label);
  if (name !== '' && !isBuddyName(name)) return Promise.resolve(false);
  return action(async () => {
    change((s) => {
      const buddy = s.buddies.find((b) => b.id === id);
      if (buddy) buddy.label = name;
    });
    return true;
  });
}

/** The name friends see for me, without the marks nobody sees (`cleanBuddyName`); `false` for one that is not a name. */
export function setMyBuddyName(name: string): Promise<boolean> {
  const mine = cleanBuddyName(name);
  if (!isBuddyName(mine)) return Promise.resolve(false);
  return action(async () => {
    change((s) => {
      s.myName = mine;
    });
    return true;
  });
}

/** The friends screen was seen: the dot on its button goes, and the one-time notes with it. */
export function markBuddiesSeen(): Promise<void> {
  // The demo's friend is made up anew each time: nothing to mark.
  if (isDemo()) return Promise.resolve();
  return action(async () =>
    change((s) => {
      s.unseen = false;
      s.notes = [];
    }));
}

/**
 * Every box this phone wrote, deleted, for ״למחוק את הנתונים שלי״ before the
 * device goes (4.5). Never registers to do it: a phone without a device has
 * no boxes. Throws when the server could not be reached; the state stays.
 */
export function deleteBuddyBoxesNow(): Promise<void> {
  if (isDemo()) return Promise.resolve();
  return inTurn(() => dropAllBoxes(storage, buddyServer(storage, DEVICE_PLATFORM, undefined, false))).catch(failed);
}
