/**
 * What the chat page shows (docs/superpowers/specs/2026-11-04-chat-connection-design.md,
 * 4.5): a row for each chat linked, with the line that says whether it has used
 * the copy or is waiting for the student's word, whether another chat can be
 * added, and when the phone last sent its copy.
 *
 * Pure: the server's status, what the student shares, the clock and the zone
 * in; plain data out, so `run.ts` (which needs the phone's natives) is not
 * needed to try it. Days and times go by `zone`, never by the machine's.
 */
import type { ChatLinkView, ChatShares, ChatStatusResponse } from '@sederyom/shared';
import { CHAT_GRANTS_PER_DEVICE } from '@sederyom/shared';
import { DateTime } from 'luxon';
import { formatShortDate } from '../lib/format';
import { CHAT_COPY } from './copy';

/** One chat linked, as the page lists it. */
export interface ChatRowView {
  id: string;
  /** The name the chat gave itself (text from outside: the screen sets it as a name, `isolateName`), or its host when it gave none. */
  title: string;
  /** The row's one line under the title. */
  line: string;
  /** The student has not confirmed it yet: the row offers ״לחבר״ as well as ״לנתק״. */
  needsApproval: boolean;
  host: string;
  /** The host is one of `CHAT_KNOWN_HOSTS`. */
  known: boolean;
}

export interface ChatScreenView {
  /** What the student lets a chat read; the page's switches. */
  shares: ChatShares;
  chats: ChatRowView[];
  /** Another chat can be linked: the device has fewer than `CHAT_GRANTS_PER_DEVICE`. */
  canAdd: boolean;
  /** ״המידע נשלח לאחרונה …״; `null` before the phone has written a copy. */
  updatedLine: string | null;
}

/** `iso` as a moment in `zone`; `null` for text that is not a time. */
function momentIn(iso: string | null, zone: string): DateTime | null {
  if (iso === null) return null;
  const moment = DateTime.fromISO(iso).setZone(zone);
  return moment.isValid ? moment : null;
}

/** The hour and minute of `iso` in `zone` (״17:40״), for the moment a code stops being good; `''` for text that is not a time. */
export function timeIn(iso: string, zone: string): string {
  return momentIn(iso, zone)?.toFormat('HH:mm') ?? '';
}

/**
 * What became of a code on the screen, from the chats the page lists now and
 * the ids of those it listed when the code was made (a chat cut meanwhile is
 * simply gone from `chats`, so the next one to come still counts):
 * - `'waiting'`: no chat has come; the code stays.
 * - `'linked'`: a chat came and at least one of those that came can read the
 *   copy now; the code is spent and the page says ״הצ׳אט מחובר״.
 * - `'approval'`: every chat that came waits for the student's word (spec 2.1:
 *   no access until then); the code is spent, and the row's question is the
 *   message, so the page says nothing more.
 */
export function codeOutcome(idsThen: readonly string[], chats: readonly ChatRowView[]): 'waiting' | 'linked' | 'approval' {
  const came = chats.filter((row) => !idsThen.includes(row.id));
  if (came.length === 0) return 'waiting';
  return came.some((row) => !row.needsApproval) ? 'linked' : 'approval';
}

/** ״היום 17:20״, ״אתמול 09:05״, or for an older day ״ב־2.11״: the day and the time as `zone` has them at `now`. */
function whenLabel(moment: DateTime, now: DateTime): string {
  const day = moment.toISODate()!;
  const time = moment.toFormat('HH:mm');
  if (day === now.toISODate()) return `${CHAT_COPY.today} ${time}`;
  if (day === now.minus({ days: 1 }).toISODate()) return `${CHAT_COPY.yesterday} ${time}`;
  return CHAT_COPY.onDate(formatShortDate(day));
}

function rowOf(chat: ChatLinkView, now: DateTime, zone: string): ChatRowView {
  const needsApproval = !chat.approved;
  const lastUsed = momentIn(chat.lastUsedAt, zone);
  let line: string;
  if (needsApproval) line = CHAT_COPY.rowWaiting(chat.host);
  else line = lastUsed ? CHAT_COPY.rowUsed(whenLabel(lastUsed, now)) : CHAT_COPY.rowNeverUsed;
  return { id: chat.id, title: chat.name || chat.host, line, needsApproval, host: chat.host, known: chat.known };
}

/** The page over the status the server gave (`null`: the phone has no device, or the server forgot it; the same as no chats). */
export function chatScreenModel(status: ChatStatusResponse | null, shares: ChatShares, now: Date, zone: string): ChatScreenView {
  const local = DateTime.fromJSDate(now).setZone(zone);
  const chats = (status?.chats ?? []).map((chat) => rowOf(chat, local, zone));
  const written = momentIn(status?.snapshotAt ?? null, zone);
  return {
    shares,
    chats,
    canAdd: chats.length < CHAT_GRANTS_PER_DEVICE,
    updatedLine: written ? CHAT_COPY.sentLast(whenLabel(written, local)) : null,
  };
}
