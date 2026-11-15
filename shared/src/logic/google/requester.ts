/**
 * What reading Google needs from whoever holds the account: one authorized
 * JSON request. The server's `GoogleTokenProvider` refreshes a stored token;
 * the phone asks its native Google sign-in (plan Phase 2d).
 */
export interface GoogleRequester {
  request<T>(url: string, init?: RequestInit): Promise<T>;
}

/**
 * What the phone asks Google for: read every calendar, manage only the
 * calendar the app makes ("בית ספר"), and tasks. Narrower than the server's
 * `auth/calendar`, which could also delete any calendar.
 */
export const PHONE_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/tasks',
] as const;
