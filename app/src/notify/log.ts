/**
 * The notification log, kept on the phone (plan 2f): every notification this
 * phone showed, its own and the class's pushes, newest first, for the bell's
 * count and the log screen (`NotificationsScreen`). The server kept one while
 * it sent every push; now the phone shows most of them itself.
 *
 * Every way the app learns of a notification ends in `appendDeliveries`
 * (the expo-notifications side is in `local.ts` and `push/handlers.ts`):
 * - a local note shown at once (`showLocalNotes` without a time), when it is
 *   shown: the background reads' notes are logged even if swiped away unseen;
 * - anything that arrives while the app is open, local or pushed (the
 *   "received" listener), when it arrives;
 * - a tap on one (the response), with the time it carries;
 * - whatever is in the tray on start, on each return to the app and in the
 *   background refresh (`unloggedDeliveries`), with the time it was posted:
 *   what came with the app closed, the morning summary, the evening
 *   reminder, a note held for the end of the quiet hours, the class's pushes.
 *
 * So one delivery is often seen two or three times, each time with a slightly
 * different time: expo-notifications gives the listener the moment the
 * notification was made (a push: when it was sent), the tray the moment it was
 * posted. Two sightings are the same delivery when they carry the same request
 * identifier, or the same title and body, less than `SAME_DELIVERY_MS` apart;
 * the first one's time stays. Every identifier is one delivery's, apart from
 * "משוב התנתק" (`RELOGIN_NOTE_ID`, at most once an outage): two outages less
 * than the window apart are logged once.
 *
 * A sighting whose kind cannot be told is left out: a push the system drew by
 * itself with the app closed comes back from the tray without its data, so
 * its kind is read off its title (`typeFromTitle`), and an unknown title is
 * not guessed at.
 *
 * Kept for `MAX_AGE_DAYS`, at most `MAX_ENTRIES`. Pure: the storage is passed
 * in (MMKV in the app, a Map in tests).
 */
import { NOTIFICATION_TYPES, type NotificationLogEntry, type NotificationType } from '@sederyom/shared';

export const LOG_KEY = 'notify.log';
export const MAX_ENTRIES = 200;
export const MAX_AGE_DAYS = 30;
/** Two sightings of one identifier (or one text) this close are one delivery. */
export const SAME_DELIVERY_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** The storage this needs: MMKV in the app, a Map in tests. */
export interface LogKv {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

/** One sighting of a notification, in plain values (`local.ts` reads them off expo-notifications). */
export interface Delivery {
  /** The notification request's identifier. */
  identifier: string;
  /** When it reached the phone, as well as the sighting tells (ms since the epoch). */
  at: number;
  title: string | null | undefined;
  body: string | null | undefined;
  /** The notification's data: the payload of a push or of a local note. */
  data: unknown;
}

interface StoredEntry extends NotificationLogEntry {
  identifier: string;
}

interface StoredLog {
  nextId: number;
  items: StoredEntry[];
}

const TYPES: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

function isEntry(e: unknown): e is StoredEntry {
  const x = e as Partial<StoredEntry> | null;
  return x !== null && typeof x === 'object' && typeof x.id === 'number' && typeof x.identifier === 'string'
    && typeof x.type === 'string' && typeof x.title === 'string' && typeof x.body === 'string' && typeof x.sentAt === 'string';
}

function load(kv: LogKv): StoredLog {
  try {
    const raw = kv.getString(LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredLog>) : null;
    const items = Array.isArray(parsed?.items) ? parsed.items.filter(isEntry) : [];
    const top = items.reduce((max, e) => Math.max(max, e.id), 0);
    const nextId = typeof parsed?.nextId === 'number' && parsed.nextId > top ? parsed.nextId : top + 1;
    return { nextId, items };
  } catch {
    return { nextId: 1, items: [] };
  }
}

/**
 * The kind of a push the system drew by itself (its data is not in the tray),
 * from the titles the server sends (`server/src/notify/engine.ts`) and the
 * phone's own; `null` for any other.
 */
export function typeFromTitle(title: string): NotificationType | null {
  if (/במערכת של מחר/.test(title)) return 'schedule_change_tomorrow';
  if (/במערכת של היום/.test(title)) return 'schedule_change_today';
  if (/^מבחן חדש/.test(title)) return 'new_exam';
  if (/^ציון חדש/.test(title)) return 'new_grade';
  if (/^שיעורי בית/.test(title)) return 'new_homework';
  if (/^הודע/.test(title)) return 'teacher_message';
  if (/^משוב התנתק|^צריך להתחבר|^נדרשת התחברות/.test(title)) return 'relogin_needed';
  if (/^אין עדכונים/.test(title)) return 'sync_broken';
  return null;
}

function dataType(data: unknown): NotificationType | null {
  const type = (data as { type?: unknown } | null)?.type;
  return typeof type === 'string' && TYPES.has(type) ? (type as NotificationType) : null;
}

/** A sighting's kind: its payload's `type`, else what its title says (`typeFromTitle`). */
export function typeOfDelivery(d: Pick<Delivery, 'title' | 'data'>): NotificationType | null {
  return dataType(d.data) ?? typeFromTitle((d.title ?? '').trim());
}

/** The time a sighting is logged at: its own, never later than now; now when it has none. */
function timeOf(d: Delivery, now: Date): number {
  return Number.isFinite(d.at) && d.at > 0 ? Math.min(d.at, now.getTime()) : now.getTime();
}

type Sighting = Pick<StoredEntry, 'identifier' | 'title' | 'body' | 'sentAt'>;

/** Whether two sightings are one delivery (see the header). */
export function isSameDelivery(a: Sighting, b: Sighting): boolean {
  const apart = Math.abs(Date.parse(a.sentAt) - Date.parse(b.sentAt));
  if (!(apart < SAME_DELIVERY_MS)) return false;
  return a.identifier === b.identifier || (a.title === b.title && a.body === b.body);
}

/** A sighting as a log entry (without its id), or `null` when it is not logged: no kind, no text, too old. */
function entryOf(d: Delivery, now: Date): Omit<StoredEntry, 'id'> | null {
  const type = typeOfDelivery(d);
  const title = (d.title ?? '').trim();
  const body = (d.body ?? '').trim();
  const at = timeOf(d, now);
  if (!type || (!title && !body) || at <= now.getTime() - MAX_AGE_DAYS * DAY_MS) return null;
  // The next lesson on the lock screen (ideas פ1) is a sign, not news: eight a day would bury the log.
  if (type === 'next_lesson') return null;
  // The payload only when the kind came from it: a tray's copy without data holds Android's own fields.
  const payload = dataType(d.data) && typeof d.data === 'object' && !Array.isArray(d.data) ? (d.data as Record<string, unknown>) : null;
  return { identifier: d.identifier, type, title, body, payload, sentAt: new Date(at).toISOString() };
}

/**
 * The reconciliation: of `seen` (what the tray holds, or any other
 * sightings), the deliveries `logged` does not have yet, each once, as the
 * entries they would be (without ids). Pure.
 */
export function unloggedDeliveries(logged: readonly Sighting[], seen: readonly Delivery[], now: Date = new Date()): Omit<StoredEntry, 'id'>[] {
  const fresh: Omit<StoredEntry, 'id'>[] = [];
  for (const d of seen) {
    const entry = entryOf(d, now);
    if (!entry) continue;
    if (logged.some((e) => isSameDelivery(e, entry)) || fresh.some((e) => isSameDelivery(e, entry))) continue;
    fresh.push(entry);
  }
  return fresh;
}

/** Newest first; by id among the same moment. */
function byNewest(a: StoredEntry, b: StoredEntry): number {
  return a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : b.id - a.id;
}

function kept(items: readonly StoredEntry[], now: Date): StoredEntry[] {
  const oldest = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS).toISOString();
  return items.filter((e) => e.sentAt > oldest).sort(byNewest).slice(0, MAX_ENTRIES);
}

function strip({ identifier: _identifier, ...entry }: StoredEntry): NotificationLogEntry {
  return entry;
}

/** The log, newest first, as the screens take it. */
export function readNotificationLog(kv: LogKv, now: Date = new Date()): NotificationLogEntry[] {
  return kept(load(kv).items, now).map(strip);
}

/**
 * Logs every delivery in `seen` that is not logged yet, and returns the new
 * entries (none: nothing was written, unless old ones were dropped).
 */
export function appendDeliveries(kv: LogKv, seen: readonly Delivery[], now: Date = new Date()): NotificationLogEntry[] {
  const log = load(kv);
  const fresh = unloggedDeliveries(log.items, seen, now);
  let nextId = log.nextId;
  const added = fresh.map((e): StoredEntry => ({ id: nextId++, ...e }));
  const items = kept([...log.items, ...added], now);
  if (added.length > 0 || items.length !== log.items.length) kv.set(LOG_KEY, JSON.stringify({ nextId, items } satisfies StoredLog));
  const stays = new Set(items.map((e) => e.id));
  return added.filter((e) => stays.has(e.id)).map(strip);
}
