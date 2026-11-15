/**
 * Notifications from the phone's own Mashov reads (plan Phase 2, step 3): a
 * new grade, new homework, a new message. The server no longer sees any of
 * them, so the phone tells the student itself, from whichever read first saw
 * the item, the background ones included.
 *
 * Pure (data in, the notifications to show out), so tests can run it; the
 * phone's notification system is in `local.ts`.
 */
import type { ClassFeed, NotificationType, PushPayload, UserSettings } from '@sederyom/shared';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import { mashovName, type NameContext } from '@sederyom/shared/logic/ownNames';
import { plainSubject } from '@sederyom/shared/logic/subjects';
import { isInQuietHours } from '@sederyom/shared/logic/time';
import { namesOfSources } from '../local/subjectNames';
import { messageTime } from '../mashov/sync';

export interface LocalNote {
  title: string;
  body: string;
  /** What a tap opens, as a push's payload does (`push/handlers.ts`). */
  data: PushPayload;
  /** Shown under this name, so it can be taken back (`withdrawLocalNote`); none for most. */
  identifier?: string;
}

const TYPE_OF: Record<string, NotificationType> = { grade: 'new_grade', homework: 'new_homework', message: 'teacher_message' };

/** More new items than this in one read (after a long gap) become one summary. */
export const MAX_NOTES = 4;

/**
 * Items of the notified kinds in `after` that `before` did not have. Nothing on
 * a first read: everything would be "new". Nor a message older than the newest
 * one `before` had: a deeper inbox read brought it in, and the student has long
 * seen it on Mashov.
 */
export function addedItems(before: readonly NormalizedEntity[] | null, after: readonly NormalizedEntity[]): NormalizedEntity[] {
  if (!before) return [];
  const known = new Set(before.map((e) => `${e.kind}\u0000${e.naturalKey}`));
  const times = before.filter((e) => e.kind === 'message').map(messageTime).filter((t): t is number => t !== null);
  const newest = times.length ? Math.max(...times) : null;
  return after.filter((e) => {
    if (!(e.kind in TYPE_OF) || known.has(`${e.kind}\u0000${e.naturalKey}`)) return false;
    // A message Mashov gave no date stays "new": nothing says it is old.
    const time = e.kind === 'message' ? messageTime(e) : null;
    return newest === null || time === null || time >= newest;
  });
}

function text(payload: unknown, key: string): string {
  const v = (payload as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function cut(s: string, max = 140): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * "באנגלית": the subject after the preposition, under the student's own name
 * for it as they typed it (`mashovName`, as the app's lists and the server's
 * pushes name it), else as the app names Mashov's.
 */
function inSubject(raw: string, names: NameContext | null): string {
  const own = raw !== '' && names !== null ? mashovName(names, { subject: raw }) : null;
  const subject = own ?? plainSubject(raw);
  return subject ? ` ב${subject}` : '';
}

function noteFor(type: NotificationType, payload: unknown, names: NameContext | null): LocalNote {
  switch (type) {
    case 'new_grade': {
      const value = text(payload, 'value') || text(payload, 'valueText');
      return {
        title: `ציון חדש${inSubject(text(payload, 'subject'), names)}`,
        body: [value, text(payload, 'notes')].filter(Boolean).join(', ') || 'ציון חדש במשוב',
        data: { type, deepLink: 'school', tab: 'grades', refreshWidget: true },
      };
    }
    case 'new_homework':
      return {
        title: `שיעורי בית${inSubject(text(payload, 'subject'), names)}`,
        body: cut(text(payload, 'text')) || 'שיעורי בית חדשים במשוב',
        data: { type, deepLink: 'school', tab: 'homework', refreshWidget: true },
      };
    default: {
      const from = text(payload, 'from');
      return {
        title: from ? `הודעה מ${from}` : 'הודעה חדשה',
        body: cut(text(payload, 'title') || text(payload, 'body')) || 'הודעה חדשה במשוב',
        data: { type: 'teacher_message', deepLink: 'school', tab: 'messages', refreshWidget: true },
      };
    }
  }
}

/**
 * What to show for these new items: one note each, by the student's switches;
 * none during "חופש"; one summary when a long gap brought many. A subject is
 * named by the student's names in `settings`, against the class `feed`'s
 * lines, as the days are (`namesOfSources`); `null` before the phone has one.
 */
export function planMashovNotes(added: readonly NormalizedEntity[], settings: UserSettings, feed: ClassFeed | null): LocalNote[] {
  if (settings.vacationMode) return [];
  const names = namesOfSources({ feed, settings });
  const notes = added
    .map((e) => ({ type: TYPE_OF[e.kind]!, payload: e.payload }))
    .filter(({ type }) => settings.notifications[type])
    .map(({ type, payload }) => noteFor(type, payload, names));
  if (notes.length <= MAX_NOTES) return notes;
  const count = (t: NotificationType) => notes.filter((n) => n.data.type === t).length;
  const parts = [
    count('new_grade') ? `${count('new_grade')} ציונים` : '',
    count('new_homework') ? `${count('new_homework')} שיעורי בית` : '',
    count('teacher_message') ? `${count('teacher_message')} הודעות` : '',
  ].filter(Boolean);
  return [{ title: 'עדכונים חדשים ממשוב', body: parts.join(', '), data: { type: notes[0]!.data.type, deepLink: 'school', refreshWidget: true } }];
}

/** The outage (`failedAt`) the student was last told of, so each is told once. */
export const RELOGIN_NOTED_KEY = 'mashov.reloginNotedFor';
/** The name "משוב התנתק" is shown under: one at a time, and taken back once Mashov reads again. */
export const RELOGIN_NOTE_ID = 'mashov.relogin';

/** What `planReloginNote` reads of `mashov.status` (`mashov/sync.ts`). */
export interface ReloginStatus {
  needsLogin: boolean;
  failedAt?: string | null;
  /** The last read that worked: kept through failures, gone after "ניתוק" and on a new install. */
  lastOkAt?: string | null;
}

/**
 * "משוב התנתק": Mashov refused the session and the phone could not log in
 * again by itself, so nothing new arrives until the student does. Once per
 * outage (`failedAt`, when it began; `notedFor`, the outage already told of),
 * whatever the switches and "חופש" say: a connection problem is always told
 * (`UNDISABLEABLE`). A tap opens the Mashov login, as the server's push did.
 *
 * Only for a session that once worked (`lastOkAt`): a phone that never
 * connected Mashov, or whose student just pressed "ניתוק", has nothing that
 * broke.
 */
export function planReloginNote(status: ReloginStatus, notedFor: string | null): LocalNote | null {
  if (!status.needsLogin || !status.failedAt || !status.lastOkAt || status.failedAt === notedFor) return null;
  return {
    title: 'משוב התנתק',
    body: 'ציונים ושיעורי בית לא מתעדכנים עד שמתחברים שוב. אפשר להתחבר בלחיצה (לוקח דקה)',
    data: { type: 'relogin_needed', deepLink: 'mashov-login', refreshWidget: true },
    identifier: RELOGIN_NOTE_ID,
  };
}

export interface ReloginDeps {
  kv: { getString(key: string): string | undefined; set(key: string, value: string): void; remove(key: string): void };
  /** `mashov.status` as the read just left it. */
  status: () => ReloginStatus;
  /** Shows the note at `at`, or now; throws when it could not. */
  show: (note: LocalNote, at: Date | null) => Promise<void>;
  /** Takes back a note shown or waiting under this name. */
  withdraw: (identifier: string) => Promise<void>;
  settings: () => UserSettings;
  now: Date;
  zone: string;
}

/**
 * After each Mashov read on the phone: "משוב התנתק" once per outage when the
 * read still needs a login after the pass was tried, recorded only once
 * shown, so a failed one is tried again on the next read. A read that works
 * takes back a note still held for the end of the quiet hours (or still in
 * the tray).
 */
export async function noteRelogin(outcome: 'ok' | 'needs-login' | 'failed' | 'skipped', deps: ReloginDeps): Promise<void> {
  if (outcome === 'ok') {
    if (deps.kv.getString(RELOGIN_NOTED_KEY) === undefined) return;
    await deps.withdraw(RELOGIN_NOTE_ID).catch(() => undefined);
    deps.kv.remove(RELOGIN_NOTED_KEY);
    return;
  }
  if (outcome !== 'needs-login') return;
  const status = deps.status();
  const note = planReloginNote(status, deps.kv.getString(RELOGIN_NOTED_KEY) ?? null);
  if (!note || !status.failedAt) return;
  try {
    // The quiet hours hold it back like any other note.
    await deps.show(note, deliverAt(deps.settings(), deps.now, deps.zone));
    deps.kv.set(RELOGIN_NOTED_KEY, status.failedAt);
  } catch {
    // Not shown: the next read tries again.
  }
}

/** "HH:mm" in the zone, for the quiet-hours check. */
function clock(now: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(now);
}

/**
 * When to show them: now, or, inside the student's quiet hours, when those end
 * (the same day's end, or the next day's when it is already past it).
 */
export function deliverAt(settings: UserSettings, now: Date, zone: string): Date | null {
  const { enabled, from, to } = settings.quietHours;
  const time = clock(now, zone);
  if (!enabled || !isInQuietHours(time, from, to)) return null;
  const [nh, nm] = time.split(':').map(Number) as [number, number];
  const [th, tm] = to.split(':').map(Number) as [number, number];
  let minutes = th * 60 + tm - (nh * 60 + nm);
  if (minutes <= 0) minutes += 24 * 60;
  return new Date(now.getTime() + minutes * 60_000);
}
