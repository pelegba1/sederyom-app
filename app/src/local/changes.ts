/**
 * When the phone first saw each change on the class's site, or in Mashov's
 * own timetable changes (plan Phase 2e).
 *
 * The server knows when a change first appeared from its change events; the
 * phone has no history, so it keeps its own: the first time a changed lesson
 * (cancelled, a substitute, moved…) is in the feed, or in Mashov's changes to
 * the weeks its grid fills, its moment is noted, and the lesson carries it as
 * `changeSeenAt` from then on, which is what marks a change as new on the
 * timeline. A different change to the same lesson is a new sighting. Days
 * long past are forgotten.
 */
import type { DateStr, Instant } from '@sederyom/shared';
import type { LessonRow } from '@sederyom/shared/logic/merge';
import { addDays } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';

export const CHANGE_SIGHTINGS_KEY = 'local.changeSeen';
/** Sightings of days older than this are dropped. */
const KEEP_DAYS = 14;

/** Change key → when the phone first saw it. */
export type ChangeSightings = Record<string, Instant>;

/** What a change is told by: a feed's lesson and a lesson row both have it. */
type ChangedLesson = Pick<LessonRow, 'date' | 'hourIndex' | 'subject' | 'teacher' | 'status'>;

/** The lesson's identity, as the server keys it (`lessonNaturalKey`), plus what changed. */
export function changeKey(l: ChangedLesson): string {
  return `${l.date}|${l.hourIndex}|${l.subject}|${l.teacher ?? ''}|${l.status}`;
}

/** The sightings after this feed: new changes noted at `now`, old days forgotten. Pure. */
export function recordChanges(lessons: readonly ChangedLesson[], seen: ChangeSightings, now: Date, zone: string, today: DateStr): ChangeSightings {
  const at = DateTime.fromJSDate(now).setZone(zone).toISO()!;
  const oldest = addDays(today, -KEEP_DAYS, zone);
  const next: ChangeSightings = {};
  for (const [key, value] of Object.entries(seen)) {
    if (key.slice(0, 10) >= oldest) next[key] = value;
  }
  for (const lesson of lessons) {
    if (lesson.status === 'regular') continue;
    const key = changeKey(lesson);
    next[key] ??= at;
  }
  return next;
}
