import { storage } from '../widget/feedCache';
import { isTextScale, isThemePreference, type TextScale, type ThemePreference } from '../theme';

export type { TextScale, ThemePreference } from '../theme';

const ONBOARDED_KEY = 'onboarded';
const THEME_KEY = 'themePreference';
const TEXT_SCALE_KEY = 'textScale';
const NOTIFICATIONS_SEEN_KEY = 'notificationsSeenAt';
const CONFIRMED_EXAMS_KEY = 'confirmedExamKeys';
const TODAY_SCHOOL_ONLY_KEY = 'todaySchoolOnly';
const TODAY_LESSONS_APART_KEY = 'todayLessonsApart';
const WRAPPED_ENTRY_CLOSED_KEY = 'wrappedEntryClosed';

export function hasOnboarded(): boolean {
  return storage.getBoolean(ONBOARDED_KEY) === true;
}

export function markOnboarded(): void {
  storage.set(ONBOARDED_KEY, true);
}

/** Light, dark, or the phone's setting (the default, and the fallback for anything unreadable). */
export function getThemePreference(): ThemePreference {
  const stored = storage.getString(THEME_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

export function setThemePreference(preference: ThemePreference): void {
  storage.set(THEME_KEY, preference);
}

/** The in-app text size; `'normal'` until one is chosen, and for anything unreadable. */
export function getTextScale(): TextScale {
  const stored = storage.getString(TEXT_SCALE_KEY);
  return isTextScale(stored) ? stored : 'normal';
}

export function setTextScale(scale: TextScale): void {
  storage.set(TEXT_SCALE_KEY, scale);
}

/**
 * When the notifications log was last opened (ISO). The first read saves
 * "now", so a fresh install, or the update that brings the badge, starts with
 * nothing new rather than a badge for every notification ever logged.
 */
export function getNotificationsSeenAt(now: Date = new Date()): string {
  const stored = storage.getString(NOTIFICATIONS_SEEN_KEY);
  if (stored) return stored;
  const iso = now.toISOString();
  storage.set(NOTIFICATIONS_SEEN_KEY, iso);
  return iso;
}

export function setNotificationsSeenAt(iso: string): void {
  storage.set(NOTIFICATIONS_SEEN_KEY, iso);
}

/**
 * Exams the owner said are theirs ("שלי") where the match was unsure (W6-F).
 * Kept on this phone only: a reinstall or a second phone asks again, which is
 * the safe direction — the exam stays marked either way.
 */
export function getConfirmedExamKeys(): string[] {
  const raw = storage.getString(CONFIRMED_EXAMS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function setConfirmedExamKeys(keys: readonly string[]): void {
  storage.set(CONFIRMED_EXAMS_KEY, JSON.stringify([...new Set(keys)]));
}

/** "רק בית ספר" on Today: calendar events folded away (W6-F, Itai). Off by default. */
export function getTodaySchoolOnly(): boolean {
  return storage.getBoolean(TODAY_SCHOOL_ONLY_KEY) === true;
}

export function setTodaySchoolOnly(on: boolean): void {
  storage.set(TODAY_SCHOOL_ONLY_KEY, on);
}

/** Today's timeline with a row for each period, not one row for lessons in a row. Off by default. */
export function getTodayLessonsApart(): boolean {
  return storage.getBoolean(TODAY_LESSONS_APART_KEY) === true;
}

export function setTodayLessonsApart(on: boolean): void {
  storage.set(TODAY_LESSONS_APART_KEY, on);
}

/** The school year (its 1 September) whose year-in-review row on Today was closed; null when none was. */
export function getWrappedEntryClosed(): string | null {
  return storage.getString(WRAPPED_ENTRY_CLOSED_KEY) ?? null;
}

export function setWrappedEntryClosed(yearStart: string): void {
  storage.set(WRAPPED_ENTRY_CLOSED_KEY, yearStart);
}
