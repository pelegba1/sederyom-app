/**
 * What a lesson was when it began, read from the class's change events
 * (docs/superpowers/specs/2026-11-10-year-wrapped-design.md §1).
 *
 * The snapshot cannot say: the site drops a change once its day has passed, and
 * a week that leaves the site's window is marked deleted. The events can, since
 * each carries the moment the server saw it. So the rule is one: **a lesson's
 * state is the last one recorded at or before its start.** A cancellation taken
 * back before the lesson is not a cancellation; whatever was recorded after the
 * lesson began says nothing about it.
 *
 * Pure: the day and its events in, the day's rows out.
 */
import type { ClassLesson, DateStr, LessonStatus } from '@sederyom/shared';
import { DateTime } from 'luxon';

/** One `class_change_event` row of kind `lesson`. */
export interface LessonEvent {
  naturalKey: string;
  change: 'created' | 'updated' | 'deleted';
  /** The lesson as the event left it; null for a `deleted`. */
  after: ClassLesson | null;
  createdAt: Date;
}

/** A stretch of time whose events are not history (a parser bug that rewrote every lesson). */
export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface HistoryLesson {
  date: DateStr;
  hourIndex: number;
  subject: string;
  teacher: string | null;
  room: string | null;
  startTime: string | null;
  endTime: string | null;
  /** null: the lesson had no start time and none could be taken from its period; it counts in no change card. */
  status: LessonStatus | null;
  substitute: string | null;
  note: string | null;
  /** When the state the row holds was first seen (ISO, UTC), for a status other than `regular`. */
  changeSeenAt: string | null;
}

export interface FreezeOptions {
  zone: string;
  ignore: readonly TimeWindow[];
}

function instant(date: DateStr, time: string, zone: string): number | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

/** The rows of one day, from every lesson event whose key is of that day. */
export function freezeDay(date: DateStr, events: readonly LessonEvent[], opts: FreezeOptions): HistoryLesson[] {
  const ignored = (at: number) => opts.ignore.some((w) => at >= w.from.getTime() && at <= w.to.getTime());
  const prefix = `${date}|`;
  const byKey = new Map<string, LessonEvent[]>();
  for (const event of events) {
    if (!event.naturalKey.startsWith(prefix) || ignored(event.createdAt.getTime())) continue;
    const list = byKey.get(event.naturalKey);
    if (list) list.push(event);
    else byKey.set(event.naturalKey, [event]);
  }
  for (const list of byKey.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // When each period begins, for a lesson that does not say: the earliest time any lesson of the period carries.
  const periodStart = new Map<number, string>();
  for (const list of byKey.values()) {
    for (const { after } of list) {
      if (!after?.startTime) continue;
      const known = periodStart.get(after.hourIndex);
      if (!known || after.startTime < known) periodStart.set(after.hourIndex, after.startTime);
    }
  }
  const dayEnd = DateTime.fromISO(date, { zone: opts.zone }).endOf('day').toMillis();

  const rows: HistoryLesson[] = [];
  for (const list of byKey.values()) {
    const named = [...list].reverse().find((e) => e.after)?.after;
    if (!named) continue;
    const time = named.startTime ?? periodStart.get(named.hourIndex) ?? null;
    const start = time ? instant(date, time, opts.zone) : null;
    const until = start ?? dayEnd;
    const before = list.filter((e) => e.createdAt.getTime() <= until);
    const last = before[before.length - 1];
    if (!last?.after) continue;

    const lesson = last.after;
    const status = start === null ? null : lesson.status;
    let seen: Date | null = null;
    if (status && status !== 'regular') {
      for (let i = before.length - 1; i >= 0 && before[i]!.after?.status === status; i -= 1) seen = before[i]!.createdAt;
    }
    rows.push({
      date,
      hourIndex: lesson.hourIndex,
      subject: lesson.subject,
      teacher: lesson.teacher,
      room: lesson.room,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      status,
      substitute: lesson.substitute,
      note: lesson.note,
      changeSeenAt: seen ? seen.toISOString() : null,
    });
  }
  return rows.sort(
    (a, b) => a.hourIndex - b.hourIndex || a.subject.localeCompare(b.subject, 'he') || (a.teacher ?? '').localeCompare(b.teacher ?? '', 'he'),
  );
}
