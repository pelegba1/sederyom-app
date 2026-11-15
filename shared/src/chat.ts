/**
 * The chat connection's contract: what a student's phone seals into a snapshot,
 * what the server and the phone say to each other about a chat's link, and the
 * numbers both sides keep to (docs/superpowers/specs/2026-11-04-chat-connection-design.md,
 * 4.1, 4.2 and 7). Pure types and constants, so the phone, the server and the
 * tests read one copy; `node:` is never imported here, because this also runs on
 * Hermes.
 */
import type { DateStr, Exam, Grade, Instant, Lesson, SchoolEvent } from './domain';
import type { BagrutExam, HomeworkItem } from './api';

/** The characters of a link code: no 0, 1, I or O, which look like one another. */
export const CHAT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CHAT_CODE_LENGTH = 8;
/** How long a code can be used after the phone made it. */
export const CHAT_CODE_TTL_MS = 600_000;
/** Wrong tries from one address within CHAT_CODE_TTL_MS before it is locked. */
export const CHAT_CODE_TRIES = 5;
export const CHAT_CODE_LOCK_MS = 600_000;
/** The authorization code the page gives a chat, and the tokens it trades for it. */
export const CHAT_AUTH_CODE_TTL_MS = 60_000;
export const CHAT_ACCESS_TTL_MS = 3_600_000;
export const CHAT_REFRESH_TTL_MS = 90 * 86_400_000;
/**
 * A refresh token presented again within this long of its use is a chat's own
 * requests that refreshed at once: refused, and the chat stays linked. Later, it
 * was copied, and the chat is cut.
 */
export const CHAT_REFRESH_REUSE_GRACE_MS = 60_000;
/** How many chats one device can have linked at once. */
export const CHAT_GRANTS_PER_DEVICE = 5;
/** A snapshot's JSON before sealing, and the sealed text the server keeps. */
export const CHAT_SNAPSHOT_JSON_MAX = 512 * 1024;
export const CHAT_SNAPSHOT_CIPHERTEXT_MAX = 700 * 1024;
/** A snapshot nobody wrote for this long is deleted. */
export const CHAT_SNAPSHOT_STALE_DAYS = 30;
/** Days in the snapshot: yesterday through today + 13. */
export const CHAT_DAYS_BACK = 1;
export const CHAT_DAYS_AHEAD = 13;
/** Messages in the snapshot: the last 50, each body cut to 2,000 characters. */
export const CHAT_MESSAGES_MAX = 50;
export const CHAT_MESSAGE_BODY_MAX = 2000;
/** A copy older than this adds the staleness line to what a chat reads. */
export const CHAT_OLD_AFTER_MS = 86_400_000;

/**
 * The hosts of the chats we know. A `redirect_uri` on one of these needs no
 * warning and no approval in the app; any other host does. Exact match.
 */
export const CHAT_KNOWN_HOSTS: readonly string[] = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'claude.com',
  'gemini.google.com',
];

/**
 * What the student lets a chat read; homework is on from the start. Nothing from
 * Google is among them and never will be: Google's Workspace data policy forbids
 * using Google user data to develop, improve or train AI models, and the app's
 * Google verification covers on-phone use only, so it stays on the phone. A student
 * who wants their chat to see Google connects Google to the chat directly.
 */
export interface ChatShares {
  homework: boolean;
  grades: boolean;
  bagrut: boolean;
  absences: boolean;
  messages: boolean;
}

export const DEFAULT_CHAT_SHARES: ChatShares = {
  homework: true,
  grades: false,
  bagrut: false,
  absences: false,
  messages: false,
};

/** One school day as a chat sees it. */
export interface ChatDay {
  date: DateStr;
  weekdayName: string;
  isSchoolDay: boolean;
  holidayName: string | null;
  /** The lessons are the usual week's, not yet the school's published ones. */
  projected: boolean;
  lessons: Lesson[];
  examsToday: Exam[];
  events: SchoolEvent[];
}

/** One subject's absences: how many count, how many are allowed, and where that stands. */
export interface ChatAbsence {
  subject: string;
  counted: number;
  allowed: number;
  level: 'ok' | 'close' | 'over';
}

/**
 * A homework item as a chat has it: the app's own, without `linkedTaskId`. That is the id of the Google Task the
 * student made from the item, so it comes from Google and stays on the phone with the rest of Google.
 */
export type ChatHomeworkItem = Omit<HomeworkItem, 'linkedTaskId'>;

export interface ChatMessage {
  date: Instant;
  from: string | null;
  title: string;
  body: string;
}

/**
 * One subject's average of the school year's grades, by the student's own weights (computed on the phone,
 * where the weights live). Rounded to one decimal; `uncounted` is how many numeric grades do not count in it,
 * and is left out when none is.
 */
export interface ChatAverage {
  subject: string;
  average: number;
  uncounted?: number;
}

/** What the phone cut so the snapshot fits CHAT_SNAPSHOT_JSON_MAX, in the order it cuts. */
export type ChatTrimmed = 'messageBodies' | 'laterDays' | 'oldGrades';

/** What the phone seals (v1) and puts at `PUT /v2/chat/snapshot`; the server never opens it. */
export interface ChatSnapshot {
  v: 1;
  at: Instant;
  shares: ChatShares;
  school: { name: string | null; className: string | null };
  days: ChatDay[];
  exams: Exam[];
  trimmed: ChatTrimmed[];
  homework?: ChatHomeworkItem[];
  grades?: Grade[];
  /** Only with `grades`, written right after it (the key order is what `chatHash` hashes), and over the whole year, never cut by a trim. */
  averages?: ChatAverage[];
  bagrut?: BagrutExam[];
  absences?: ChatAbsence[];
  messages?: ChatMessage[];
}

/** `POST /v2/chat/codes`: `key` is K, 32 bytes as base64url (43 characters). */
export interface CreateChatCodeBody {
  key: string;
}

/** `code` as XXXX-XXXX. */
export interface CreateChatCodeResponse {
  code: string;
  expiresAt: Instant;
}

export interface PutChatSnapshotBody {
  ciphertext: string;
}

/** One linked chat as the app lists it. */
export interface ChatLinkView {
  id: string;
  name: string;
  host: string;
  known: boolean;
  approved: boolean;
  createdAt: Instant;
  lastUsedAt: Instant | null;
}

export interface ChatStatusResponse {
  chats: ChatLinkView[];
  snapshotAt: Instant | null;
}

const CODE_CHARS = new Set(CHAT_CODE_ALPHABET);

/**
 * A code as the server keeps it: spaces and hyphens dropped, upper-cased; `null`
 * unless it is exactly CHAT_CODE_LENGTH characters of the alphabet.
 */
export function normalizeChatCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const bare = input.replace(/[\s-]+/g, '');
  // ASCII first: some letters upper-case to others ('ſ' to 'S') or to two ('ß' to 'SS').
  if (!/^[A-Za-z0-9]+$/.test(bare)) return null;
  const code = bare.toUpperCase();
  if (code.length !== CHAT_CODE_LENGTH) return null;
  for (const c of code) if (!CODE_CHARS.has(c)) return null;
  return code;
}

/** A normalized code as shown to the student: 'K7QM2XPA' to 'K7QM-2XPA'. */
export function formatChatCode(code: string): string {
  const half = CHAT_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** Whether `host` (as `new URL(...).hostname` gives it) is exactly one of CHAT_KNOWN_HOSTS. */
export function isKnownChatHost(host: string): boolean {
  return typeof host === 'string' && CHAT_KNOWN_HOSTS.includes(host.toLowerCase());
}
