/**
 * Notification engine (design-doc §5.1, §7).
 *
 * Plans which pushes a batch of change events owes one reader, given that
 * reader's settings: the fanout (`fanout.ts`) runs it once per device over its
 * class's `class_change_event` rows, sends, and dedupes per device.
 *
 * Quiet hours *defer* rather than drop: an unnotified event stays unnotified
 * and is picked up by the first run after the window closes. Losing a schedule
 * change because it landed at 23:05 would be a silent failure.
 */
import type { ClassLesson, DateStr, NotificationType, PushPayload, UserSettings } from '@sederyom/shared';
import { isHiddenExam, isHiddenLesson, type TimetableLine } from '@sederyom/shared/logic/filters';
import { type NameContext, examTitle, lessonName, mashovName, nameContext } from '@sederyom/shared/logic/ownNames';
import { plainSubject } from '@sederyom/shared/logic/subjects';
import { isEnabled } from '@sederyom/shared/logic/summaries';
import { minutesOf } from '@sederyom/shared/logic/time';
import type { OutgoingPush } from './push.js';
import { sundayIndex } from '../lib/time.js';

export interface PendingChange {
  id: number;
  source: string;
  kind: string;
  naturalKey: string;
  change: 'created' | 'updated' | 'deleted';
  payload: { before: unknown; after: unknown; partition: string | null; initial?: boolean };
  /** Set by `pairRekeyed`: the deleted half of one lesson read under two keys, accounted for with this event. */
  rekeyedFrom?: number;
}

export interface PlannedNotification {
  type: NotificationType;
  dedupeKey: string;
  push: OutgoingPush;
  /** change_event ids this notification accounts for. */
  eventIds: number[];
}

/** A lesson of today, for when the school day ends. */
export type DayLesson = Pick<ClassLesson, 'subject' | 'teacher' | 'status' | 'endTime'>;

export interface PlanContext {
  settings: UserSettings;
  today: DateStr;
  tomorrow: DateStr;
  /** Current wall time in Asia/Jerusalem, `HH:mm`. */
  nowTime: string;
  /**
   * The class site's lines, for the reader's own names for subjects (an exam
   * named by its block needs to know which lines are of that block). Not read
   * when the reader has no names.
   */
  lines?: readonly TimetableLine[];
  /**
   * The class's lessons of today as they stand now, for whether the reader's
   * school day is over. Without them nothing says it is, and a change to today
   * is told.
   */
  todayLessons?: readonly DayLesson[];
  /** The class the events are of, for the key of a push that is about the class itself (`boardPush`). */
  classId?: string;
}

const SCHOOL_SOURCES = new Set(['shahaf', 'mashov', 'school_site']);

// Moved to shared (plan Phase 2): the phone schedules its own summaries by the same rules.
export { isEnabled, isSuppressedByQuietHours } from '@sederyom/shared/logic/summaries';

/**
 * Turns raw change events into the notifications that should go out now.
 * Pure — the caller owns the DB, the clock and the sending.
 */
export function planNotifications(events: PendingChange[], ctx: PlanContext): {
  planned: PlannedNotification[];
  /** Events that will never produce a notification and can be marked handled. */
  discardedIds: number[];
} {
  const planned: PlannedNotification[] = [];
  const discarded: number[] = [];
  const scheduleBuckets = new Map<DateStr, { ids: number[]; changes: PendingChange[]; type: NotificationType }>();
  // The reader's own names, decided once; `null` (no names) leaves every text as it was.
  const names = nameContext(ctx.settings.lessons.subjectNames, ctx.lines ?? [], ctx.settings.lessons.hiddenSubjects);
  const dayOver = schoolDayOver(events, ctx);

  for (const event of pairRekeyed(events)) {
    const ids = idsOf(event);
    if (ctx.settings.vacationMode && SCHOOL_SOURCES.has(event.source)) {
      discarded.push(...ids);
      continue;
    }

    const type = classify(event, ctx, dayOver);
    // 'defer' means "not yet, but do not lose it" — the event stays unnotified
    // and the next run reconsiders it. Discarding it here would be exactly the
    // silent failure the design forbids.
    if (type === 'defer') continue;
    if (type === null) {
      discarded.push(...ids);
      continue;
    }
    if (!isEnabled(ctx.settings, type)) {
      discarded.push(...ids);
      continue;
    }

    if (type === 'schedule_change_today' || type === 'schedule_change_tomorrow') {
      const day = event.payload.partition ?? ctx.today;
      const bucket = scheduleBuckets.get(day) ?? { ids: [], changes: [], type };
      bucket.ids.push(...ids);
      bucket.changes.push(event);
      scheduleBuckets.set(day, bucket);
      continue;
    }

    // The class's board has one natural key for every board the class ever has: the event's id is what tells
    // this board's push from the next one's, after the board is removed and another brought. The class is
    // the fanout's (`ctx.classId`); a plan made without one still keys by the event.
    planned.push(
      event.kind === 'exam_board'
        ? { type, dedupeKey: `exam-board|${ctx.classId ?? ''}|${event.id}`, eventIds: ids, push: boardPush() }
        : { type, dedupeKey: `${type}|${event.naturalKey}`, eventIds: ids, push: itemPush(type, event, names) },
    );
  }

  // One push per (day, batch of changes) — never one per lesson.
  for (const [day, bucket] of scheduleBuckets) {
    planned.push({
      type: bucket.type,
      // Dedupe by day *and* by which change events the push carries, so a later
      // change on the same day still notifies while the same batch planned again
      // does not. The event's id is what tells two changes of one lesson apart: its
      // natural key has no status, so "מ״מ" and then "מבוטל" read alike without it.
      dedupeKey: `${bucket.type}|${day}|${bucket.changes.map((c) => `${c.naturalKey}:${c.change}:${c.id}`).sort().join(',')}`,
      eventIds: bucket.ids,
      push: schedulePush(bucket.type, day, bucket.changes, ctx, names),
    });
  }

  return { planned, discardedIds: discarded };
}

const SCHEDULE_CHANGE_TODAY_FROM = '06:00';

function idsOf(event: PendingChange): number[] {
  return event.rekeyedFrom === undefined ? [event.id] : [event.id, event.rekeyedFrom];
}

/**
 * One lesson read under two keys: a lesson's key holds its teacher, and the
 * site re-writing that line ("מפגש לקראת מסיבת הסיום" gaining ", ספריה", a
 * name re-spelled) reads as the old lesson deleted and a new one created. Said
 * as it was, a lesson that never left is "ירד מהמערכת". A deleted lesson and a
 * created one of the same day, period and subject are therefore one lesson
 * updated, the deleted one's id carried along so both are accounted for.
 */
function pairRekeyed(events: PendingChange[]): PendingChange[] {
  const lessonOf = (e: PendingChange, side: 'before' | 'after') => (e.kind === 'lesson' ? (e.payload[side] as LessonPayload | null) : null);
  // The same printed line, wherever the parser put the teacher: on 4.11.2026 the site
  // glued it onto the subject ("היסטוריה (יב2)אוחנה אביגיל"), and the parser fix split it off again.
  const line = (l: LessonPayload) => `${l.subject ?? ''}${l.teacher ?? ''}`.replace(/\s+/g, '');
  const sameSlot = (a: LessonPayload, b: LessonPayload) =>
    a.hourIndex === b.hourIndex &&
    (plainSubject(a.subject ?? '') === plainSubject(b.subject ?? '') || line(a) === line(b) || misreadArrow(a, b));
  const used = new Set<number>();
  const merged = new Map<number, PendingChange>();
  for (const created of events) {
    const after = created.change === 'created' ? lessonOf(created, 'after') : null;
    if (!after) continue;
    const deleted = events.find((d) => {
      const before = d.change === 'deleted' && !used.has(d.id) ? lessonOf(d, 'before') : null;
      return before !== null && d.payload.partition === created.payload.partition && sameSlot(before, after);
    });
    if (!deleted) continue;
    used.add(deleted.id);
    merged.set(created.id, {
      ...created,
      change: 'updated',
      payload: { ...created.payload, before: deleted.payload.before },
      rekeyedFrom: deleted.id,
    });
  }
  return events.filter((e) => !used.has(e.id)).map((e) => merged.get(e.id) ?? e);
}

/**
 * Until 4.11.2026 an arrow change ("נקש מלכה <- פרנקו יונתן חדר אמנות מלכה")
 * was read as a lesson named after the sentence. The same change read right
 * names the teacher before the arrow: one lesson, not one gone and one new.
 */
const RE_ARROW_SUBJECT = /^(.+?)\s*(?:<-|->|←|→)/;
function misreadArrow(before: LessonPayload, after: LessonPayload): boolean {
  const teacher = RE_ARROW_SUBJECT.exec(before.subject ?? '')?.[1]?.trim();
  return Boolean(teacher) && teacher === (after.teacher ?? '').trim();
}

/** A lesson read under a new key with nothing a student reads changed: its status, subject and substitute the same. */
function sameAsBefore(event: PendingChange): boolean {
  if (event.rekeyedFrom === undefined) return false;
  const before = (event.payload.before ?? {}) as LessonPayload;
  const after = (event.payload.after ?? {}) as LessonPayload;
  // The misread row already told the student of the change: its reading, corrected, is not news.
  if (misreadArrow(before, after)) return before.status === after.status || after.status === 'regular';
  return before.status === after.status && (before.substitute ?? null) === (after.substitute ?? null);
}

/**
 * Whether the reader's last lesson of today has ended. After it, what the site
 * does with today is not news: the day's changes cleared off the grid in the
 * afternoon would each read "שיעור 3 ספורט ירד מהמערכת".
 *
 * A lesson counts as it stands now and as the changes in hand found it: one
 * taken off or cancelled before it began no longer stands, and is exactly what
 * the student must hear. A cancelled lesson does not extend the day, and a line
 * the student does not attend is not their day. Not known (no lessons read, a
 * lesson with no end time) is not over: a needless push beats a lost one.
 */
function schoolDayOver(events: PendingChange[], ctx: PlanContext): boolean {
  if (!ctx.todayLessons) return false;
  const changed = events
    .filter((e) => e.kind === 'lesson' && e.payload.partition === ctx.today)
    .flatMap((e) => [e.payload.before, e.payload.after] as (LessonPayload | null)[])
    .filter((l): l is LessonPayload => l !== null);
  const hidden = ctx.settings.lessons.hiddenSubjects;
  let last = -1;
  for (const lesson of [...ctx.todayLessons, ...changed]) {
    if (lesson.status === 'cancelled' || isHiddenLesson(hidden, { subject: lesson.subject ?? '', teacher: lesson.teacher ?? null })) continue;
    if (!lesson.endTime) return false;
    last = Math.max(last, minutesOf(lesson.endTime));
  }
  // By the minutes: the site may write "9:30", which as text sorts after "13:00".
  return last >= 0 && minutesOf(ctx.nowTime) >= last;
}

function classify(event: PendingChange, ctx: PlanContext, dayOver: boolean): NotificationType | 'defer' | null {
  // The first poll of a source publishes the backlog; it does not discover it.
  // Lessons are the exception: one that arrives already cancelled is news
  // whether or not the timetable existed before.
  if (event.payload.initial && event.kind !== 'lesson') return null;

  switch (event.kind) {
    case 'lesson': {
      // A lesson the student does not attend is not the student's change.
      const lesson = (event.change === 'deleted' ? event.payload.before : event.payload.after) as LessonPayload | null;
      if (lesson?.subject && isHiddenLesson(ctx.settings.lessons.hiddenSubjects, { subject: lesson.subject, teacher: lesson.teacher ?? null })) {
        return null;
      }
      const day = event.payload.partition;
      // A plain lesson appearing for the first time is the timetable being
      // published, not a change — otherwise the first sync of a week would
      // announce every single lesson as news. A lesson that appears already
      // cancelled or with a substitute *is* news and still notifies.
      if (event.change === 'created' && (event.payload.after as LessonPayload | null)?.status === 'regular') return null;
      if (sameAsBefore(event)) return null;
      if (day === ctx.tomorrow) return 'schedule_change_tomorrow';
      if (day !== ctx.today) return null;
      if (dayOver) return null;
      // "after 06:00" — a change published overnight waits for the morning
      // rather than firing at 03:00, but it is never dropped.
      return ctx.nowTime >= SCHEDULE_CHANGE_TODAY_FROM ? 'schedule_change_today' : 'defer';
    }
    case 'exam':
      if (event.change !== 'created') return null;
      // The grade's schedule lists every exam of every group; one the student
      // switched off in "my exams" is not theirs, new or not.
      if (isHiddenExam(ctx.settings.exams.hiddenKeys, { naturalKey: event.naturalKey })) return null;
      return 'new_exam';
    case 'exam_board':
      // The class got an exam schedule (`announceBoard`): the new-exam switch decides, and no exam rule applies.
      return event.change === 'created' ? 'new_exam' : null;
    case 'homework':
      return event.change === 'created' ? 'new_homework' : null;
    case 'grade':
      return event.change === 'created' ? 'new_grade' : null;
    case 'message':
      return event.change === 'created' ? 'teacher_message' : null;
    default:
      return null;
  }
}

function schedulePush(
  type: NotificationType,
  day: DateStr,
  changes: PendingChange[],
  ctx: PlanContext,
  names: NameContext | null,
): OutgoingPush {
  const when = type === 'schedule_change_tomorrow' ? 'מחר' : 'היום';
  const lines = changes.slice(0, 4).map((change) => describeLessonChange(change, names)).filter(Boolean);
  const more = changes.length - lines.length;
  const body = [...lines, more > 0 ? `ועוד ${more}` : null].filter(Boolean).join(' · ');
  return {
    title: changes.length === 1 ? `שינוי במערכת של ${when}` : `${changes.length} שינויים במערכת של ${when}`,
    body: body || `המערכת של ${when} עודכנה`,
    payload: {
      type,
      deepLink: type === 'schedule_change_tomorrow' && day !== ctx.today ? 'week' : 'today',
      date: day,
      refreshWidget: true,
    },
  };
}

interface LessonPayload {
  hourIndex?: number;
  subject?: string;
  teacher?: string | null;
  status?: string;
  substitute?: string | null;
  endTime?: string | null;
}

function describeLessonChange(event: PendingChange, names: NameContext | null): string {
  const after = (event.payload.after ?? {}) as LessonPayload;
  const before = (event.payload.before ?? {}) as LessonPayload;
  const lesson = event.change === 'deleted' ? before : after;
  const hour = lesson.hourIndex !== undefined ? `שיעור ${lesson.hourIndex}` : '';
  // The student's own name for the line, as typed; else "פיזיקה", not the grid's "פיזיקה מורחב (מעבדת פיסיקה)".
  const own = names && lessonName(names, { subject: lesson.subject ?? '', teacher: lesson.teacher ?? null });
  const subject = own ?? plainSubject(lesson.subject ?? '');
  if (event.change === 'deleted') return `${hour} ${subject} ירד מהמערכת`.trim();
  switch (lesson.status) {
    case 'cancelled':
      return `${hour} ${subject} מבוטל`.trim();
    case 'substitution':
      return `${hour} ${subject} · מ״מ${lesson.substitute ? `: ${lesson.substitute}` : ''}`.trim();
    case 'moved':
      return `${hour} ${subject} הועבר`.trim();
    case 'remote':
      return `${hour} ${subject} מרחוק`.trim();
    case 'exam':
      return `${hour} ${subject} · מבחן`.trim();
    default:
      // A school event ("מפגש לקראת מסיבת הסיום") that appeared: its name alone says nothing happened.
      return `${hour} ${subject}${event.change === 'created' ? ' נוסף למערכת' : ''}`.trim();
  }
}

/**
 * The class has an exam schedule now. It says who brought it as "someone from the class", never by name (the
 * server knows none) and never "a student" or "your class" (a parent can bring one too, and on a parent's phone the
 * class is the child's), opens the exams list, and carries no exam: which of them are the reader's is the phone's.
 */
function boardPush(): OutgoingPush {
  return {
    title: 'לוח מבחנים חדש',
    body: 'מישהו מהכיתה הוסיף לוח מבחנים. כדאי לבדוק אילו מבחנים שלך.',
    payload: { type: 'new_exam', deepLink: 'school', tab: 'exams', refreshWidget: true },
  };
}

/**
 * One push per school item. Each one opens where the item is (plan F12): the
 * School screen on the right sub-tab, an exam scrolled into view by its key —
 * not the School screen's first tab for everything.
 */
function itemPush(type: NotificationType, event: PendingChange, names: NameContext | null): OutgoingPush {
  const after = (event.payload.after ?? {}) as Record<string, unknown>;
  const s = (key: string): string => (typeof after[key] === 'string' ? (after[key] as string) : '');
  // Mashov names the group, "מתמטיקה 5 יח"ל (יב2)"; a push names the subject, as the app does,
  // or by the student's own name for it, as typed.
  const subjectName = (): string => (names && mashovName(names, { subject: s('subject') })) ?? plainSubject(s('subject'));

  switch (type) {
    case 'new_exam':
      return {
        title: 'מבחן חדש',
        // The exam's title as the school wrote it, with the student's name where it reads the subject.
        body: [(names && examTitle(names, s('subject'))?.title) ?? s('subject'), shortDateHe(s('date')), s('details')].filter(Boolean).join(' · '),
        payload: { type, deepLink: 'school', tab: 'exams', examKey: event.naturalKey, date: s('date') || undefined, refreshWidget: true },
      };
    case 'new_homework':
      // No date: the snapshot's `dueDate` is the lesson the homework was
      // given in (Mashov sends nothing else); the real due date is derived
      // only when the homework table is projected.
      return {
        title: `שיעורי בית · ${subjectName() || 'כללי'}`,
        body: truncate(s('text'), 140),
        payload: { type, deepLink: 'school', tab: 'homework', refreshWidget: true },
      };
    case 'new_grade': {
      const subject = subjectName();
      const value = typeof after.value === 'number' ? String(after.value) : s('valueText');
      return {
        title: subject ? `ציון חדש · ${subject}` : 'ציון חדש',
        body: [value, s('notes')].filter(Boolean).join(' · '),
        payload: { type, deepLink: 'school', tab: 'grades', refreshWidget: true },
      };
    }
    case 'teacher_message':
      return {
        title: s('from') ? `הודעה מ${s('from')}` : 'הודעה חדשה',
        body: truncate(s('title') || s('body'), 140),
        payload: { type, deepLink: 'school', tab: 'messages', refreshWidget: true },
      };
    default:
      return {
        title: 'עדכון',
        body: event.naturalKey,
        payload: { type, deepLink: 'today', refreshWidget: true },
      };
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Sunday-first, as the app abbreviates them (`lib/school.ts` `shortWeekday`). */
const SHORT_WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];

/**
 * "יום א׳ 1.11" for `2026-11-01` — a date the way the app writes it, never
 * the ISO string (R-2). Anything that is not a valid date passes through.
 */
export function shortDateHe(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  try {
    return `${SHORT_WEEKDAYS[sundayIndex(date)]} ${Number(m[2])}.${Number(m[1])}`;
  } catch {
    return date;
  }
}

export function buildPushPayload(type: NotificationType, deepLink: PushPayload['deepLink'], date?: DateStr): PushPayload {
  return { type, deepLink, date, refreshWidget: true };
}
