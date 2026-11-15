/**
 * The phone's own exam board (design doc, "לוח משלי, כשלכיתה כבר יש לוח"): a board kept only on the phone, which
 * stands in, for this one student, for the class's exams from the school's exam schedule (`school_site`).
 *
 * - `rows`: the list the student confirmed from a file or a page, kept as it was confirmed;
 * - `calendar`: a public Google calendar, read by the phone itself on every refresh (`refreshOwnBoard`);
 * - `none`: the class's board turned off for this student ("בלי הלוח של הכיתה"), the same mechanism with no exams.
 *
 * Nothing about it is sent to the server. The class's feed, as the server sent it, stays as it is under
 * `DEVICE_KEYS.feed`; `withOwnBoard` lays the board over it wherever the phone reads exams (`local/source.ts`), so
 * taking the board away brings the class's back at once, with no network.
 *
 * Its exams are `school_site` ones with the keys the class's board would give them (`uploadedExamKey` for rows, the
 * calendar's own for a calendar), so the names, hidden exams and Google choices the student kept by key hold when
 * the same board is brought again, and `withoutSiteTwins` still treats them as the schedule that decides a twin.
 *
 * A parent's board is kept per child (`CHILD_KEYS` in `children.ts`).
 *
 * Pure on purpose, like `manualExams.ts` (a key-value store in, plain data out; the one thing it does on its own is
 * `fetch`, which is passed in), so the server's tests can load it without React Native.
 */
import type { ClassExam, ClassFeed, DateStr, DeviceClass, SaveExamBoardBody } from '@sederyom/shared';
import { calendarExams, examCalendarIcsUrl } from '@sederyom/shared/logic/exam-board/calendar';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { BOARD_DETAILS_MAX, BOARD_ROWS_MAX, BOARD_TITLE_MAX, isBoardDay } from '@sederyom/shared/logic/exam-board/rows';
import { cleanText } from '@sederyom/shared/logic/exam-board/text';
import type { KV } from './manualExams';

export const OWN_BOARD_KEY = 'exams.ownBoard';

export interface OwnRowsBoard {
  kind: 'rows';
  exams: ClassExam[];
  savedAt: string;
}

export interface OwnCalendarBoard {
  kind: 'calendar';
  calendarId: string;
  /** Google's name for the calendar, once it was read. */
  name: string | null;
  /** What the last read found; none before the first one. */
  exams: ClassExam[];
  /**
   * When a read last found something new in it (its first read, a new name or other exams); `null` before the first
   * one. A read that finds it as it was writes nothing, so this is not the time of the last read; the time of the last
   * try is kept apart (`OWN_BOARD_TRIED_KEY`).
   */
  readAt: string | null;
  savedAt: string;
}

export interface OwnNoBoard {
  kind: 'none';
  savedAt: string;
}

export type OwnBoard = OwnRowsBoard | OwnCalendarBoard | OwnNoBoard;

/** As many rows as the server keeps for a class, and the lengths it allows them (`exam-board/rows`, one copy for both). */
export const OWN_ROWS_MAX = BOARD_ROWS_MAX;

/** How long the phone waits for the calendar, and the longest body it reads (in characters). */
export const OWN_CALENDAR_LIMIT_MS = 15_000;
export const OWN_CALENDAR_MAX_CHARS = 2_000_000;

/**
 * How often the phone reads its own calendar by itself, at most: once an hour. A whole calendar is downloaded and
 * parsed each time, which a refresh on every foreground cannot pay. A read the person asked for (pull to refresh), the
 * one right after a calendar is kept, and the read of a calendar never read are not held to it.
 */
export const OWN_CALENDAR_EVERY_MS = 60 * 60 * 1000;

/**
 * When the phone last tried to read a calendar of its own, and which one (`{ calendarId, at }`): kept apart from the
 * board, so a read that finds the calendar as it was writes nothing to the board, and what is built from it is kept.
 * By calendar, so a parent's other child (or another calendar kept in its place) is not held back by this one's try.
 */
export const OWN_BOARD_TRIED_KEY = 'exams.ownBoard.triedAt';

/** What a refresh says when the calendar could not be read; the exams shown are the ones read last. */
export const OWN_BOARD_READ_FAILED = 'לא הצלחנו לקרוא את לוח המבחנים שלך. ננסה שוב עוד מעט.';

type Store = Pick<KV, 'getString'>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDay = isBoardDay;

/** The exams of a stored list that are fit to show, as `school_site` exams, one to a key (the first stays). */
function cleanExams(list: readonly unknown[]): ClassExam[] {
  const kept = new Map<string, ClassExam>();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const { naturalKey, date, subject, details } = item;
    if (typeof naturalKey !== 'string' || naturalKey === '' || typeof date !== 'string' || !isDay(date)) continue;
    if (typeof subject !== 'string' || subject.trim() === '') continue;
    if (details !== undefined && details !== null && typeof details !== 'string') continue;
    if (!kept.has(naturalKey)) kept.set(naturalKey, { naturalKey, date, subject, details: details ?? null, source: 'school_site' });
  }
  return [...kept.values()];
}

function parsedBoard(value: unknown): OwnBoard | null {
  if (!isRecord(value) || typeof value.savedAt !== 'string') return null;
  const { savedAt } = value;
  if (value.kind === 'none') return { kind: 'none', savedAt };
  if (!Array.isArray(value.exams)) return null;
  if (value.kind === 'rows') return { kind: 'rows', exams: cleanExams(value.exams), savedAt };
  if (value.kind !== 'calendar') return null;
  const { calendarId, name, readAt } = value;
  if (typeof calendarId !== 'string' || calendarId === '') return null;
  if (name !== null && typeof name !== 'string') return null;
  if (readAt !== null && typeof readAt !== 'string') return null;
  return { kind: 'calendar', calendarId, name, exams: cleanExams(value.exams), readAt, savedAt };
}

/**
 * The phone's own board, or `null` when it has none. A value that does not parse or has the wrong shape is none,
 * and so is an empty string, which is what `switchChild` leaves for a child that had none.
 */
export function readOwnBoard(kv: Store): OwnBoard | null {
  try {
    const raw = kv.getString(OWN_BOARD_KEY);
    return raw ? parsedBoard(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write<B extends OwnBoard>(kv: Pick<KV, 'set'>, board: B): B {
  kv.set(OWN_BOARD_KEY, JSON.stringify(board));
  return board;
}

/** `text` cut to `max` characters, never between the two halves of a character, with no space left at its end. */
function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const high = text.charCodeAt(max - 1);
  return text.slice(0, high >= 0xd800 && high <= 0xdbff ? max - 1 : max).trim();
}

/**
 * Keeps the confirmed rows as the phone's own board, in place of whatever board it had. The rows are cleaned as the
 * server cleans a class's (`cleanText`: one line, no control, no bidi mark, no zero-width character; details left empty
 * are `null`), so the same file saved for the class and for oneself gives the same names and keys. At most
 * `OWN_ROWS_MAX` of them, one to a key (the first stays); a row with no title once cleaned, or no real day, is left out,
 * and a title or details longer than a save takes are cut to it. Never throws.
 */
export function keepOwnRows(kv: KV, rows: SaveExamBoardBody['rows'], now: Date = new Date()): OwnRowsBoard {
  const exams = new Map<string, ClassExam>();
  for (const row of rows) {
    const title = cutTo(cleanText(typeof row.title === 'string' ? row.title : ''), BOARD_TITLE_MAX);
    const details = cutTo(cleanText(typeof row.details === 'string' ? row.details : ''), BOARD_DETAILS_MAX) || null;
    if (title === '' || typeof row.date !== 'string' || !isDay(row.date)) continue;
    const naturalKey = uploadedExamKey(row.date, title);
    if (!exams.has(naturalKey)) exams.set(naturalKey, { naturalKey, date: row.date, subject: title, details, source: 'school_site' });
  }
  return write(kv, { kind: 'rows', exams: [...exams.values()].slice(0, OWN_ROWS_MAX), savedAt: now.toISOString() });
}

/**
 * Keeps a public Google calendar as the phone's own board, to be read by the next `refreshOwnBoard`. The same
 * calendar kept again keeps what was read from it, so the exams do not disappear until the next read.
 */
export function keepOwnCalendar(kv: KV, calendarId: string, name: string | null, now: Date = new Date()): OwnCalendarBoard {
  const before = readOwnBoard(kv);
  const same = before?.kind === 'calendar' && before.calendarId === calendarId ? before : null;
  return write(kv, {
    kind: 'calendar',
    calendarId,
    name,
    exams: same?.exams ?? [],
    readAt: same?.readAt ?? null,
    savedAt: now.toISOString(),
  });
}

/** "בלי הלוח של הכיתה": the class's board is off for this student, and they have no other. */
export function keepWithoutClassBoard(kv: KV, now: Date = new Date()): OwnNoBoard {
  return write(kv, { kind: 'none', savedAt: now.toISOString() });
}

/** "להסיר את הלוח שלי": the class's board is the phone's again. */
export function removeOwnBoard(kv: KV & { remove(key: string): void }): void {
  kv.remove(OWN_BOARD_KEY);
}

/** `feed` with each board it was last given, so the same two give the same object. */
const applied = new WeakMap<ClassFeed, WeakMap<OwnBoard, ClassFeed>>();

/** Every feed `withOwnBoard` made: a feed with a board of the phone's own laid over the class's (`isOwnBoardFeed`). */
const laid = new WeakSet<ClassFeed>();

/**
 * Whether `feed` is a class's feed with a board of the phone's own laid over it (`withOwnBoard`), the class's board
 * hidden in it: then a copy kept of one of the class board's exams is not shown either (`keptExams`). The feed as the
 * server sent it, or none, is not.
 */
export function isOwnBoardFeed(feed: ClassFeed | null | undefined): boolean {
  return feed != null && laid.has(feed);
}

/**
 * The feed as the phone sees it: the class's exams from the school's exam schedule (`school_site`) go, and the
 * own board's come in their place. The class's own site's exams (`shahaf`) stay, and everything else in the feed
 * is the very same. Without an own board it is the very same object, and a feed that is not there stays not
 * there (the own board has no class to be laid over). With one, the same feed and board give the same result
 * object, so what is built from the feed is kept (`local/source.ts`, `local/days.ts`). The feed it is given is
 * never changed.
 *
 * The server does not send the site's exams that the class's board also lists (`withoutSiteTwins`), so a board of
 * the student's own would otherwise hide them for good: it sends them apart, in `feed.siteTwins`, and they come
 * back here with the site's own. The phone's `withoutSiteTwins` (`examRows`) then decides which of them the own
 * board lists. A feed from a server from before `siteTwins` has none to put back: the exams are then the site's
 * that the class's board does not list, as that server sent them (the server is deployed before the app).
 */
export function withOwnBoard(feed: ClassFeed | null, own: OwnBoard | null): ClassFeed | null {
  if (own === null || feed === null) return feed;
  const byBoard = applied.get(feed) ?? new WeakMap<OwnBoard, ClassFeed>();
  applied.set(feed, byBoard);
  const kept = byBoard.get(own);
  if (kept) return kept;
  const ownExams = own.kind === 'none' ? [] : own.exams;
  const site = (feed.exams ?? []).filter((e) => (e.source ?? 'shahaf') !== 'school_site');
  const have = new Set(site.map((e) => e.naturalKey));
  const twins = (feed.siteTwins ?? []).filter((e) => !have.has(e.naturalKey)).map((e): ClassExam => ({ ...e, source: 'shahaf' }));
  const shown: ClassFeed = { ...feed, exams: [...site, ...twins, ...ownExams] };
  byBoard.set(own, shown);
  laid.add(shown);
  return shown;
}

/**
 * "בלי הלוח של הכיתה" (`none`) over a class that a refresh saw with no board at all (its setter removed it): there is
 * nothing for it to hide, so it goes, and a board brought to the class later is seen at once. Any other board of the
 * phone's own, and a class with a board, keep it. Returns whether it was removed.
 */
export function dropNoneOverNoBoard(kv: KV & { remove(key: string): void }, cls: DeviceClass): boolean {
  if (readOwnBoard(kv)?.kind !== 'none' || cls.examBoard || cls.examCalendarId) return false;
  removeOwnBoard(kv);
  return true;
}

/** A class the phone follows, as far as its own board is concerned. Sites are compared only when both are known. */
export interface FollowedClass {
  classId: string;
  siteUrl?: string | null;
}

/**
 * The student (or the child on screen) follows another class: a board made for the old one is not the new one's,
 * and with `none` it would hide a class board the student never saw. Gone, then, when the class changed; kept when
 * the same class is saved again. Switching between a parent's children is not a change of class (each child's
 * board goes aside with it, `CHILD_KEYS`). Returns whether the board was removed.
 */
export function dropOwnBoardOnClassChange(kv: KV & { remove(key: string): void }, before: FollowedClass, after: FollowedClass): boolean {
  const sameSite = !before.siteUrl || !after.siteUrl || before.siteUrl === after.siteUrl;
  if (before.classId === after.classId && sameSite) return false;
  removeOwnBoard(kv);
  return true;
}

/** `text` when it is a calendar the phone may read: not too long, and an iCalendar feed. Throws otherwise. */
function calendarText(text: string): string {
  if (text.length > OWN_CALENDAR_MAX_CHARS) throw new Error('calendar is too big');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an iCalendar feed');
  return text;
}

/** The calendar's ICS at Google's fixed public address, within `OWN_CALENDAR_LIMIT_MS`. Throws on any failure. */
async function fetchCalendar(calendarId: string, fetchImpl: typeof fetch): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The signal ends a fetch that listens to it; the race ends one that does not.
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('calendar read timed out'));
    }, OWN_CALENDAR_LIMIT_MS);
  });
  const read = (async () => {
    const res = await fetchImpl(examCalendarIcsUrl(calendarId), { signal: controller.signal });
    if (!res.ok) throw new Error(`calendar answered ${res.status}`);
    // The header counts bytes, and a character is at most three of them: this refuses only what the text check would.
    const bytes = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(bytes) && bytes > 3 * OWN_CALENDAR_MAX_CHARS) throw new Error('calendar is too big');
    return calendarText(await res.text());
  })();
  read.catch(() => undefined);
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface OwnBoardRead {
  /** The board the phone has after the read (read again from the store, not the one it began with). */
  board: OwnBoard | null;
  /** The board is a calendar and it could not be read: the exams are the ones read before. */
  failed: boolean;
}

export interface OwnBoardReadOptions {
  /** A read the person asked for (pull to refresh), or the one right after a calendar is kept: not held to the hour. */
  force?: boolean;
  /** The time of the try, for a test; now otherwise. */
  now?: Date;
}

/** The last try (`OWN_BOARD_TRIED_KEY`), or `null` when there is none that reads. */
function lastTry(kv: Pick<KV, 'getString'>): { calendarId: string; at: number } | null {
  try {
    const raw = JSON.parse(kv.getString(OWN_BOARD_TRIED_KEY) ?? 'null') as unknown;
    if (!isRecord(raw) || typeof raw.calendarId !== 'string' || typeof raw.at !== 'string') return null;
    const at = Date.parse(raw.at);
    return Number.isNaN(at) ? null : { calendarId: raw.calendarId, at };
  } catch {
    return null;
  }
}

/** Whether two lists of exams say the same, exam by exam. */
function sameExams(a: readonly ClassExam[], b: readonly ClassExam[]): boolean {
  return a.length === b.length && a.every((e, i) => {
    const o = b[i]!;
    return e.naturalKey === o.naturalKey && e.date === o.date && e.subject === o.subject && (e.details ?? null) === (o.details ?? null) && e.source === o.source;
  });
}

/**
 * Reads the phone's own calendar, when its own board is one, and keeps what it says; says whether that failed
 * (`refreshOwnBoard` without the word). Any failure (no network, an answer that is not 2xx or not a calendar, a body
 * that is too long, a calendar that does not parse or gives more exams than a board holds) keeps the exams and the
 * `readAt` of the read before. The result is dropped, too, when the board was taken away or replaced while the
 * calendar was on its way. Never throws.
 *
 * By itself it asks Google at most once an hour (`OWN_CALENDAR_EVERY_MS`, from the last try, which failed or not):
 * held back, it reads nothing and answers with the board as it is, not failed. `opts.force` (the person asked; a
 * calendar just kept) and a calendar never read are always read. A read that changes neither the name nor the exams
 * writes nothing to the board, so the screens' sources and the days built from them stay as they are.
 */
export async function refreshOwnBoardRead(
  kv: KV,
  today: DateStr,
  zone: string,
  fetchImpl: typeof fetch = fetch,
  opts: OwnBoardReadOptions = {},
): Promise<OwnBoardRead> {
  const before = readOwnBoard(kv);
  if (before?.kind !== 'calendar') return { board: before, failed: false };
  const at = opts.now ?? new Date();
  const tried = lastTry(kv);
  const recent = tried !== null && tried.calendarId === before.calendarId && at.getTime() - tried.at < OWN_CALENDAR_EVERY_MS;
  if (!opts.force && before.readAt !== null && recent) return { board: before, failed: false };
  try {
    // the try is noted before the calendar is asked for: one that hangs or fails counts as one
    kv.set(OWN_BOARD_TRIED_KEY, JSON.stringify({ calendarId: before.calendarId, at: at.toISOString() }));
  } catch {
    // a store that cannot note it reads on: the hour is not held, nothing else is lost
  }
  let failed = false;
  try {
    const { name, exams } = calendarExams(await fetchCalendar(before.calendarId, fetchImpl), today, zone);
    const now = readOwnBoard(kv);
    // Still the board the read began with: not removed, not replaced by another calendar, not kept again.
    if (now?.kind === 'calendar' && now.calendarId === before.calendarId && now.savedAt === before.savedAt) {
      const read = cleanExams(exams);
      const named = name ?? now.name;
      if (now.readAt === null || named !== now.name || !sameExams(read, now.exams)) {
        write(kv, { ...now, name: named, exams: read, readAt: at.toISOString() });
      }
    }
  } catch {
    failed = true;
  }
  return { board: readOwnBoard(kv), failed };
}

/** Reads the phone's own calendar and keeps what it says; a failure keeps the read before and returns the same board. */
export async function refreshOwnBoard(
  kv: KV,
  today: DateStr,
  zone: string,
  fetchImpl: typeof fetch = fetch,
  opts: OwnBoardReadOptions = {},
): Promise<OwnBoard | null> {
  return (await refreshOwnBoardRead(kv, today, zone, fetchImpl, opts)).board;
}

/**
 * The first read of a calendar kept as the phone's own board could not be done: the board that was there before is
 * back, and the person is told so where they kept it. Told by its name, as a `V2Error` is (`boardProblem`).
 */
export class OwnCalendarUnreadError extends Error {
  constructor() {
    super('the calendar could not be read from the phone');
    this.name = 'OwnCalendarUnreadError';
  }
}

/**
 * "רק אצלי" for a calendar: keeps it as the phone's own board and reads it at once (not held to the hour). A first read
 * that fails is a keep that failed: a calendar that was never read would stand for the class's board with no exam in
 * it, everywhere the phone shows exams. So the board that was there before (or none) is put back as it was stored, and
 * this throws `OwnCalendarUnreadError`. The same calendar kept again, read before, keeps that read when this one fails
 * (`keepOwnCalendar`), and is the board. A store that cannot be written throws what it threw.
 */
export async function keepOwnCalendarRead(
  kv: KV & { remove(key: string): void },
  calendarId: string,
  name: string | null,
  today: DateStr,
  zone: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<OwnBoard | null> {
  const stored = kv.getString(OWN_BOARD_KEY);
  keepOwnCalendar(kv, calendarId, name, now);
  const { board } = await refreshOwnBoardRead(kv, today, zone, fetchImpl, { force: true, now });
  if (board?.kind === 'calendar' && board.calendarId === calendarId && board.readAt === null) {
    if (stored === undefined) kv.remove(OWN_BOARD_KEY);
    else kv.set(OWN_BOARD_KEY, stored);
    throw new OwnCalendarUnreadError();
  }
  return board;
}
