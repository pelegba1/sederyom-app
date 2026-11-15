/**
 * Mashov mail (plan §14.1, §14.9). Shapes confirmed against real answers,
 * de-identified in `server/test/fixtures/mashov-w7/`:
 *
 * - `GET /api/mail/inbox/conversations` — the inbox, 20 a page (`skip`). Each
 *   conversation has a `sendTime`, and `messages[]` (newest first), each with
 *   its own `sendTime` and `senderName`. No body.
 * - `GET /api/mail/conversations/{conversationId}` — one conversation, the
 *   same plus each message's `body` (HTML) and `files[]`, and `recipients`/`cc`
 *   listing the whole grade. Only the body is read from it.
 *
 * `sendTime` is a naive ISO string in Israel time: a message Mashov shows at
 * 12:27 arrives as `…T12:27:32`. It is read in the server's zone.
 */
import { DateTime } from 'luxon';
import { htmlToText } from './html';

export interface MashovMessage {
  naturalKey: string;
  /**
   * When the newest message of the conversation was sent, ISO with the zone's
   * offset. Null when Mashov gave no time at all: the projection then dates it
   * by when the server first saw it, and says so (`dateIsFirstSeen`).
   */
  date: string | null;
  title: string;
  /** Plain text of the newest message; `''` until its conversation is read. */
  body: string;
  from: string | null;
  /**
   * The conversation's `sendTime` the body was read at (`''` for a
   * conversation with no time), or null while it was never read. A different
   * `sendTime` means a reply came in, and the body is read again.
   */
  bodyFor: string | null;
}

/** Detail reads per poll: a long backlog fills in over a few polls, not one heavy one. */
export const MESSAGE_BODY_READS_PER_POLL = 5;

/** Mashov's page: `take=20` is the SPA's own request, the only size seen to work. */
export const MAIL_PAGE_SIZE = 20;
/** Pages read a poll: the 100 newest conversations. */
export const MAIL_MAX_PAGES = 5;

interface Row {
  [key: string]: unknown;
}

function isRow(v: unknown): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function instant(raw: string | null, zone: string): DateTime | null {
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { zone });
  return dt.isValid ? dt : null;
}

/** The messages of a conversation, newest first: by `sendTime`, else as Mashov listed them. */
function newestMessage(row: Row, zone: string): Row | null {
  const list = Array.isArray(row.messages) ? row.messages.filter(isRow) : [];
  let best: { row: Row; at: number } | null = null;
  for (const message of list) {
    const at = instant(text(message.sendTime), zone)?.toMillis();
    if (at !== undefined && (best === null || at > best.at)) best = { row: message, at };
  }
  return best?.row ?? list[0] ?? null;
}

/**
 * "מורים/מורה 1" → "מורה 1". Mashov puts the sender's role before a
 * slash; the name is what a student recognises.
 */
export function senderName(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^[^/\s]+\/\s*(\S.*)$/.exec(raw);
  return (m ? m[1]! : raw).trim() || null;
}

/** One inbox conversation, before its body is known. */
export interface ConversationHead {
  conversationId: string | null;
  /** The raw `sendTime` the date was read from, or null when there was none. */
  sendTime: string | null;
  message: MashovMessage;
}

/**
 * Reads one inbox conversation. The date is the conversation's `sendTime`,
 * else the newest message's — never "now": a message re-dated on every poll
 * was the bug (plan §14.1). The sender is the newest message's.
 */
export function readConversation(raw: unknown, zone: string): ConversationHead | null {
  if (!isRow(raw)) return null;
  const newest = newestMessage(raw, zone);
  const id = text(raw.conversationId) ?? text(raw.id) ?? text(newest?.conversationId);
  const title = text(raw.subject) ?? text(raw.title) ?? text(newest?.subject);
  if (!id && !title) return null;

  const candidates = [text(raw.sendTime), text(newest?.sendTime), text(raw.lastSendTime)];
  let sendTime: string | null = null;
  let date: DateTime | null = null;
  for (const candidate of candidates) {
    date = instant(candidate, zone);
    if (date) {
      sendTime = candidate;
      break;
    }
  }

  // A list row never carries a body; an older or different shape might.
  const inline = text(raw.body) ?? text(newest?.body);
  return {
    conversationId: id,
    sendTime,
    message: {
      naturalKey: `mashov-msg|${id ?? `${sendTime ?? ''}|${title ?? ''}`}`,
      date: date ? date.toISO() : null,
      title: title ?? '(ללא נושא)',
      body: inline ? htmlToText(inline) : '',
      from: senderName(text(newest?.senderName) ?? text(raw.senderName) ?? text(raw.from) ?? text(raw.sender)),
      bodyFor: inline ? (sendTime ?? '') : null,
    },
  };
}

/** `readConversation`'s message alone. */
export function normalizeMessage(raw: unknown, zone: string): MashovMessage | null {
  return readConversation(raw, zone)?.message ?? null;
}

/**
 * The newest message's body from a conversation answer, as plain text. Only
 * `body` is read: `recipients`, `cc` and `files` never leave this function.
 */
export function conversationBody(detail: unknown, zone: string): string {
  if (!isRow(detail)) return '';
  const html = text(newestMessage(detail, zone)?.body);
  return html ? htmlToText(html) : '';
}

export interface InboxRead {
  rows: unknown[];
  /** Pages Mashov answered, the first included. */
  pages: number;
  /**
   * False when a later page failed: the inbox is cut short, and the caller
   * should not take what is missing for deleted. Stopping at `MAIL_MAX_PAGES`
   * is not a failure, so it stays true.
   */
  complete: boolean;
}

/**
 * The inbox past its first page. Asks for the next page while the last was
 * full, up to `MAIL_MAX_PAGES`, and keeps only the conversations not seen yet:
 * a page with none new ends the read, as when Mashov ignores `skip` and
 * answers the first page again. A page that fails ends it too, with what was
 * read so far.
 */
export async function readInbox(
  first: readonly unknown[],
  page: (skip: number) => Promise<unknown[]>,
  zone: string,
  onError?: (skip: number, error: Error) => void,
): Promise<InboxRead> {
  // The key `readConversation` stores a row under, so "seen" means the same as "the same message".
  const keyOf = (raw: unknown) => readConversation(raw, zone)?.message.naturalKey ?? null;
  const rows = [...first];
  const seen = new Set<string>();
  for (const raw of rows) {
    const key = keyOf(raw);
    if (key) seen.add(key);
  }
  let pages = 1;
  let last = first.length;
  let complete = true;
  while (pages < MAIL_MAX_PAGES && last === MAIL_PAGE_SIZE) {
    const skip = pages * MAIL_PAGE_SIZE;
    let answer: unknown[];
    try {
      answer = await page(skip);
    } catch (err) {
      onError?.(skip, err instanceof Error ? err : new Error(String(err)));
      complete = false;
      break;
    }
    pages += 1;
    last = answer.length;
    // A row `readConversation` cannot read has no key to match, so it always counts.
    const fresh = answer.filter((raw) => {
      const key = keyOf(raw);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) break;
    rows.push(...fresh);
  }
  return { rows, pages, complete };
}

/** What the adapter knows of a stored message: its last payload. */
export type StoredMessage = Partial<Pick<MashovMessage, 'body' | 'bodyFor'>>;

export interface ReadMessagesOptions {
  zone: string;
  /**
   * The stored payloads by natural key. Null when the adapter cannot see the
   * store: then no body is read, since without it every poll would read the
   * same few again.
   */
  stored: ReadonlyMap<string, StoredMessage> | null;
  /** `MashovClient.conversation`. */
  detail: (conversationId: string) => Promise<unknown>;
  /** At most this many detail reads; `MESSAGE_BODY_READS_PER_POLL` by default. */
  limit?: number;
  onError?: (conversationId: string, error: Error) => void;
}

/**
 * The inbox, with bodies. A conversation's detail is read only when it is new
 * or its `sendTime` moved since its body was read (`bodyFor`), newest first,
 * at most `limit` a poll. Every other conversation keeps the body it has, so
 * a payload never flips back to empty. A detail that fails keeps the old body
 * too, and is tried again next poll.
 */
export async function readMessages(rows: readonly unknown[], opts: ReadMessagesOptions): Promise<{ messages: MashovMessage[]; reads: number }> {
  const limit = opts.limit ?? MESSAGE_BODY_READS_PER_POLL;
  const messages: MashovMessage[] = [];
  let reads = 0;
  for (const raw of rows) {
    const head = readConversation(raw, opts.zone);
    if (!head) continue;
    const { message, conversationId } = head;
    const want = head.sendTime ?? '';
    const before = opts.stored?.get(message.naturalKey);

    if (message.bodyFor === null && before && typeof before.body === 'string') {
      message.body = before.body;
      message.bodyFor = before.bodyFor ?? null;
    }
    const stale = message.bodyFor !== want;
    if (opts.stored && stale && conversationId && reads < limit) {
      reads += 1;
      try {
        message.body = conversationBody(await opts.detail(conversationId), opts.zone);
        message.bodyFor = want;
      } catch (err) {
        opts.onError?.(conversationId, err instanceof Error ? err : new Error(String(err)));
      }
    }
    messages.push(message);
  }
  return { messages, reads };
}
