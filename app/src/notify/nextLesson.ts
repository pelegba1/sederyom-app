/**
 * The next lesson on the lock screen (ideas פ1): during the school day, a
 * silent notification that answers "where now?" without opening the app:
 *
 *   הבא: מתמטיקה, חדר 214
 *   10:15–11:00, מ״מ דנה כהן
 *
 * The day's lessons that take place (the student's own, after the changes)
 * are grouped by their start. The first one's note goes out half an hour
 * before it; every other's goes out as the lesson before it starts, so it is
 * on the lock screen by the break even when Android delivers it late (the app
 * asks for no exact alarms, and a delivery minutes late is common). Each
 * note takes itself back as its own lesson starts (`timeoutAfterMs` in its
 * data, which the patched expo-notifications hands to Android:
 * `patches/expo-notifications+57.0.15.patch`), so one shows at a time. Every
 * refresh also takes back any that stayed past their lesson's start
 * (`staleNextLessonIds`), for a phone the patch does not reach.
 *
 * Identifiers are the day's date and the note's place in it
 * (`sederyom-next-lesson|2026-10-29|3`). Every refresh plans today and the
 * next two days again, each note in place of the one pending under its
 * identifier, and cancels the places a day no longer fills: a lesson
 * cancelled since, the switch turned off, "חופש". A note whose time is near
 * or past is left alone, as the summaries' are.
 *
 * Off until the student turns `next_lesson` on. Pure (sources in, what to do
 * out), so tests can run it; the phone's notification system is in `local.ts`.
 */
import type { DateStr, DayView, Lesson } from '@sederyom/shared';
import { addDays, atTime, toDateStr } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { isolateRanges, shownSubject } from '../lib/format';
import { buildLocalDays, type LocalSources } from '../local/days';
import type { LocalNote } from './mashovNotes';

export const NEXT_LESSON_ID_BASE = 'sederyom-next-lesson';
/** The notes' channel: silent, and shown in full on the lock screen (`local.ts`). */
export const NEXT_LESSON_CHANNEL = 'next-lesson';
/** Days planned at once, today's included. */
export const NEXT_LESSON_DAYS = 3;
/** The most notes a day gets; every place up to it is cancelled when the day no longer fills it. */
export const NEXT_LESSON_PLACES = 14;
/** How long before the day's first lesson its note goes out. */
const FIRST_NOTE_BEFORE_MIN = 30;
/** A time this close, or already past, is left alone: it may be on its way. */
const SETTLE_MS = 60_000;

export function nextLessonId(date: DateStr, place: number): string {
  return `${NEXT_LESSON_ID_BASE}|${date}|${place}`;
}

/** What to do with one place of a day: `schedule` its note at `at`, `cancel` the one pending, or `keep` it. */
export interface NextLessonAction {
  identifier: string;
  action: 'schedule' | 'cancel' | 'keep';
  at: Date | null;
  note: LocalNote | null;
  /** When the note's lesson starts, and the note goes: epoch milliseconds, 0 without a note. */
  until: number;
}

/** The lessons that start together: one place on the lock screen. */
interface Slot {
  start: string;
  end: string | null;
  lessons: Lesson[];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/** The day's lessons that take place and have a time, by their start. */
function slotsOf(day: DayView): Slot[] {
  const slots = new Map<string, Slot>();
  for (const item of day.timeline) {
    if (item.kind !== 'lesson') continue;
    const lesson = item.lesson;
    if (lesson.status === 'cancelled' || !lesson.startTime) continue;
    const slot = slots.get(lesson.startTime) ?? { start: lesson.startTime, end: lesson.endTime, lessons: [] };
    slot.lessons.push(lesson);
    if (lesson.endTime && (!slot.end || lesson.endTime > slot.end)) slot.end = lesson.endTime;
    slots.set(lesson.startTime, slot);
  }
  return [...slots.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** "הבא: מתמטיקה, חדר 214" and "10:15–11:00, מ״מ דנה כהן"; two groups at once are both named. */
export function nextLessonNote(slot: Slot, date: DateStr): LocalNote {
  const subjects = unique(slot.lessons.map(shownSubject)).join(' או ');
  const rooms = unique(slot.lessons.map((l) => l.room?.trim() ?? '').filter(Boolean));
  const title = `הבא: ${subjects}${rooms.length > 0 ? `, חדר ${rooms.join(' או ')}` : ''}`;
  const changes = unique(slot.lessons.flatMap((l) => {
    if (l.status === 'substitution') return [l.substitute ? `מ״מ ${l.substitute}` : 'מילוי מקום'];
    if (l.status === 'remote') return ['מרחוק'];
    if (l.status === 'exam') return ['מבחן'];
    if (l.status === 'moved') return [l.note ? l.note.replace(/\s+/g, ' ').trim() : 'הוזז'];
    return [];
  }));
  const time = slot.end ? `${slot.start}–${slot.end}` : slot.start;
  return {
    title: isolateRanges(title),
    body: isolateRanges([time, ...changes].join(', ')),
    data: { type: 'next_lesson', deepLink: 'today', date, refreshWidget: true },
  };
}

/** The day's notes, in order: when each goes out, until when it stays, and what it says. */
function notesOf(day: DayView, zone: string): { at: Date; until: number; note: LocalNote }[] {
  const slots = slotsOf(day);
  return slots.map((slot, k) => {
    const starts = atTime(day.date, slot.start, zone);
    const at = k === 0 ? starts.minus({ minutes: FIRST_NOTE_BEFORE_MIN }) : atTime(day.date, slots[k - 1]!.start, zone);
    return { at: at.toJSDate(), until: starts.toMillis(), note: nextLessonNote(slot, day.date) };
  });
}

/** Whether the student wants the notes now: the switch on, and no "חופש". */
export function nextLessonsOn(src: LocalSources | null): src is LocalSources {
  return src !== null && src.settings.notifications.next_lesson === true && !src.settings.vacationMode;
}

/** Every place of today and the next days: what to do with it, from the phone's own days as they are now. */
export function planNextLessons(src: LocalSources | null, now: Date, zone: string): NextLessonAction[] {
  const today = toDateStr(DateTime.fromJSDate(now).setZone(zone));
  const dates = Array.from({ length: NEXT_LESSON_DAYS }, (_v, i) => addDays(today, i, zone));
  const days = nextLessonsOn(src) ? new Map(buildLocalDays(src, dates).map((d) => [d.date, d])) : new Map<DateStr, DayView>();
  const actions: NextLessonAction[] = [];
  for (const date of dates) {
    const day = days.get(date);
    const notes = day ? notesOf(day, zone) : [];
    for (let place = 0; place < NEXT_LESSON_PLACES; place += 1) {
      const identifier = nextLessonId(date, place);
      const planned = notes[place];
      if (!planned) actions.push({ identifier, action: 'cancel', at: null, note: null, until: 0 });
      else if (planned.at.getTime() <= now.getTime() + SETTLE_MS) actions.push({ identifier, action: 'keep', at: planned.at, note: null, until: planned.until });
      else actions.push({ identifier, action: 'schedule', at: planned.at, note: planned.note, until: planned.until });
    }
  }
  return actions;
}

/** Of the notes shown, the ones whose lesson has started: what a refresh takes back. */
export function staleNextLessonIds(shown: readonly { identifier: string; data: unknown }[], now: number): string[] {
  return shown
    .filter((n) => n.identifier.startsWith(`${NEXT_LESSON_ID_BASE}|`))
    .filter((n) => {
      const until = Number((n.data as { until?: unknown } | null)?.until);
      return Number.isFinite(until) && until <= now;
    })
    .map((n) => n.identifier);
}
