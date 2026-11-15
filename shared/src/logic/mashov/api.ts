/**
 * Mashov's endpoints, as one interface the server and the phone both
 * implement over their own transport: the server replays a stored cookie
 * header, the phone lets its native cookie jar send the login's cookies
 * (plan Phase 2c; the on-phone spike, 2026-10-19).
 *
 * Every path was observed on the live SPA (server/src/adapters/mashov/client.ts),
 * except `timetableChanges`, read off the student site's code.
 */
import type { DateStr } from '../../index';

export interface MashovApi {
  timetable(): Promise<unknown[]>;
  /**
   * The changes to the weekly grid between two calendar days (`YYYY-MM-DD`):
   * one object, `{ isEnabled, changes, cancellations }`, as its site reads it.
   */
  timetableChanges(start: DateStr, end: DateStr): Promise<unknown>;
  homework(): Promise<unknown[]>;
  grades(): Promise<unknown[]>;
  /** Strict: absences (61) and lates (62) among every behaviour event of the year. */
  behave(): Promise<unknown[]>;
  /** Strict: per group, the lessons held so far and `weeklyHours`. */
  lessonsCount(): Promise<unknown[]>;
  groups(): Promise<unknown[]>;
  bells(): Promise<unknown[]>;
  /** A page of 20 threads, newest first, without bodies: the 20 newest, or those after the first `skip`. */
  mail(skip?: number): Promise<unknown[]>;
  conversation(conversationId: string): Promise<unknown>;
  /** Strict. */
  bagrutGrades(): Promise<unknown[]>;
  /** Strict. */
  bagrutSheelonim(): Promise<unknown[]>;
}

export const MASHOV_PATHS = {
  timetable: (userId: string) => `/api/students/${userId}/timetable`,
  /**
   * The site sends full ISO moments (`2026-10-25T00:00:00+03:00`). Bare days
   * say the same calendar days without an offset a server could move them by.
   */
  timetableChanges: (userId: string, start: DateStr, end: DateStr) =>
    `/api/students/${userId}/timetable/changes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  homework: (userId: string) => `/api/students/${userId}/homework`,
  grades: (userId: string) => `/api/students/${userId}/grades`,
  behave: (userId: string) => `/api/students/${userId}/behave`,
  lessonsCount: (userId: string) => `/api/students/${userId}/lessonsCount`,
  groups: (userId: string) => `/api/students/${userId}/groups`,
  bells: () => '/api/bells',
  /** Only `skip` varies: `take=20` is the site's own request, the one size seen to work. */
  mail: (skip = 0) => `/api/mail/inbox/conversations?skip=${skip}&take=20`,
  conversation: (conversationId: string) => `/api/mail/conversations/${encodeURIComponent(conversationId)}`,
  bagrutGrades: (userId: string) => `/api/students/${userId}/bagrut/grades`,
  bagrutSheelonim: (userId: string) => `/api/students/${userId}/bagrut/sheelonim`,
  /** The school's Shahaf site, as a JSON string. */
  coolSite: () => '/api/shahaf/coolSite',
} as const;

/**
 * A `MashovApi` over any `get(path)` that answers parsed JSON (or throws).
 * A list read that is not a list is an empty list, except the strict ones:
 * they are stored as complete scopes, so "not a list" must fail rather than
 * read as "none" and prune everything stored.
 */
export function mashovApi(get: (path: string) => Promise<unknown>, userId: string): MashovApi {
  const list = async (path: string): Promise<unknown[]> => {
    const v = await get(path);
    return Array.isArray(v) ? v : [];
  };
  const strictList = async (path: string): Promise<unknown[]> => {
    const v = await get(path);
    if (!Array.isArray(v)) throw new Error(`Mashov ${path} did not answer with a list`);
    return v;
  };
  return {
    timetable: () => list(MASHOV_PATHS.timetable(userId)),
    timetableChanges: (start, end) => get(MASHOV_PATHS.timetableChanges(userId, start, end)),
    homework: () => list(MASHOV_PATHS.homework(userId)),
    grades: () => list(MASHOV_PATHS.grades(userId)),
    behave: () => strictList(MASHOV_PATHS.behave(userId)),
    lessonsCount: () => strictList(MASHOV_PATHS.lessonsCount(userId)),
    groups: () => list(MASHOV_PATHS.groups(userId)),
    bells: () => list(MASHOV_PATHS.bells()),
    mail: (skip) => list(MASHOV_PATHS.mail(skip)),
    conversation: (id) => get(MASHOV_PATHS.conversation(id)),
    bagrutGrades: () => strictList(MASHOV_PATHS.bagrutGrades(userId)),
    bagrutSheelonim: () => strictList(MASHOV_PATHS.bagrutSheelonim(userId)),
  };
}
