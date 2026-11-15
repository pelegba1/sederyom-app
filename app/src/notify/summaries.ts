/**
 * The morning summary and the evening reminder (plan Phase 2): the phone
 * builds its own days, so it schedules them itself, from those days, with the
 * words and rules the server used (`@sederyom/shared/logic/summaries`).
 *
 * Each day's has its own notification, under an identifier with its date
 * (`sederyom-morning-summary|2026-10-08`), and the next `SUMMARY_DAYS` days of
 * each are pending at once: a day that gets none (Friday, Shabbat, a holiday,
 * the switch off, "חופש", the evening's time inside the quiet hours, nothing
 * due) never leaves the next school day without one, whether or not the phone
 * refreshes in between. Every refresh plans them all again from what the phone
 * has now: each one still ahead is scheduled in place of its own, or cancelled
 * when its day gets none.
 *
 * One whose time is near or past is never touched (`keep`). The app does not
 * ask for exact alarms, so Android delivers these late, minutes and sometimes
 * more; replacing or cancelling one still on its way would lose it, and a
 * trigger already past when it reaches the system removes the one pending.
 *
 * Known limit: the text is what the phone knew at its last refresh (opening
 * the app, the background task, a change made on the phone, a change push
 * received while the app is open), not what it knows at the minute it goes
 * out, as the server's is. A timetable change published overnight while the
 * phone sat idle reaches the morning summary only if a refresh ran after it.
 *
 * Pure (sources in, what to do out), so tests can run it; the phone's
 * notification system is in `local.ts`.
 */
import type { DateStr, DayView, TimeStr } from '@sederyom/shared';
import { NEXT_SCHOOL_DAY_WITHIN } from '@sederyom/shared/logic/build';
import {
  childrenEveningReminder, childrenMorningSummary, linkedHomeworkKeys, planEveningReminder, planMorningSummary, type LinkedHomework,
  type SummaryPush,
} from '@sederyom/shared/logic/summaries';
import { addDays, atTime, toDateStr } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { isolateRanges } from '../lib/format';
import { buildLocalDays, localHomework, type LocalSources } from '../local/days';
import { namedHomework, namesOfSources } from '../local/subjectNames';
import type { LocalNote } from './mashovNotes';

export type SummaryKind = 'morning' | 'evening';

const KINDS: readonly SummaryKind[] = ['morning', 'evening'];

/** Each kind's identifiers start with this, then `|` and the day's date. */
export const SUMMARY_ID_BASE: Record<SummaryKind, string> = {
  morning: 'sederyom-morning-summary',
  evening: 'sederyom-evening-reminder',
};

/**
 * How many days of each are pending at once, today's included: a week and a
 * day, so a week-long break still leaves the evening and the morning it ends
 * on pending.
 */
export const SUMMARY_DAYS = NEXT_SCHOOL_DAY_WITHIN + 1;

/** A time this close, or already past, is left alone: it may be on its way. */
export const SETTLE_MS = 60_000;

export function summaryId(kind: SummaryKind, date: DateStr): string {
  return `${SUMMARY_ID_BASE[kind]}|${date}`;
}

/**
 * What to do with one day's notification: `schedule` its `note` at `at` (in
 * place of the one pending under its identifier), `cancel` the one pending,
 * or `keep` whatever is pending (its time came, or is about to).
 */
export interface SummaryAction {
  identifier: string;
  kind: SummaryKind;
  date: DateStr;
  /** When the day's goes out by the settings; null when nothing is planned (no sources). */
  at: Date | null;
  action: 'schedule' | 'cancel' | 'keep';
  note: LocalNote | null;
}

/**
 * The homework behind tasks, by key, as the server reads it off its table:
 * every item Mashov has, hidden lessons' and ticked ones included (`done`
 * says which). Named as the day's homework is (`namedHomework`), so the
 * evening says a subject the way the student named it.
 */
export function linkedHomework(src: LocalSources): Map<string, LinkedHomework> {
  const names = namesOfSources(src);
  return new Map(localHomework(src).map((item) => {
    const h = namedHomework(item, names);
    const linked: LinkedHomework = { subject: h.subject, text: h.text, done: h.done };
    if (h.originalSubject !== undefined) linked.originalSubject = h.originalSubject;
    return [h.naturalKey, linked];
  }));
}

/** As the server sends it (`isolatePush`): every range pinned left to right, so "08:00–10:30" does not turn around. */
function toNote(push: SummaryPush): LocalNote {
  return { title: isolateRanges(push.title), body: isolateRanges(push.body), data: push.payload };
}

function hasLessons(day: DayView): boolean {
  return day.timeline.some((i) => i.kind === 'lesson');
}

/** One of a parent's children (`local/children.ts`), as the summaries read it: its name, and what its days are built from. */
export interface SummaryChild {
  label: string;
  src: LocalSources;
}

/**
 * Every day's morning summary and evening reminder from today through
 * `SUMMARY_DAYS` days, from the phone's own days as they are now. On a
 * parent's phone with more than one child (`children`, the one on screen
 * among them with `src` itself), each speaks of every child
 * (`childrenMorningSummary`, `childrenEveningReminder`).
 */
export function planLocalSummaries(src: LocalSources | null, now: Date, zone: string, children: readonly SummaryChild[] = []): SummaryAction[] {
  const today = toDateStr(DateTime.fromJSDate(now).setZone(zone));
  const dates = Array.from({ length: SUMMARY_DAYS }, (_v, i) => addDays(today, i, zone));

  // Nothing to build them from.
  if (!src) {
    return KINDS.flatMap((kind) => dates.map((date): SummaryAction => ({
      identifier: summaryId(kind, date), kind, date, at: null, action: 'cancel', note: null,
    })));
  }

  const { settings } = src;
  const timeOf: Record<SummaryKind, TimeStr> = { morning: settings.morningSummaryTime, evening: settings.eveningReminderTime };
  const planned = KINDS.flatMap((kind) => dates.map((date) => ({ kind, date, at: atTime(date, timeOf[kind], zone).toJSDate() })));
  const open = planned.filter((p) => p.at.getTime() > now.getTime() + SETTLE_MS);

  const notes = new Map<string, LocalNote | null>();
  // Before a class is picked (setup not done) there is no timetable: every morning would say there are no lessons.
  if (settings.classId && open.length > 0) {
    // Each evening reads the week after it (the next school day may be past a break): one build for all.
    const span = Array.from({ length: SUMMARY_DAYS + NEXT_SCHOOL_DAY_WITHIN }, (_v, i) => addDays(today, i, zone));
    // The phone's class, or a parent's every child's: each built the same way, from its own sources.
    const classes = (children.length > 1 ? children : [{ label: '', src }]).map((child) => {
      const byDate = new Map<DateStr, DayView>(buildLocalDays(child.src, span).map((d) => [d.date, d]));
      const dayOf = (date: DateStr): DayView => byDate.get(date)!;
      // With Mashov's grid the days are built as the server built the owner's (the grid fills the weeks
      // the site has not published). Without it only the class feed has lessons, and a day it has none
      // for (not read yet, or past its weeks) would read as a day without lessons. The Week screen says
      // ״אין עדיין מערכת״ for such a day; the summary says nothing. A day whose lessons were all
      // cancelled still has them, as cancelled, and still goes out.
      const grid = child.src.mashov.some((e) => e.kind === 'timetable_slot');
      return {
        label: child.label,
        src: child.src,
        dayOf,
        grid,
        // Which day is next, for the evening, needs a timetable from somewhere.
        timetable: grid || Boolean(child.src.feed?.lastOkAt),
        // Only when a task on these days was made from homework is the homework read again.
        linked: linkedHomeworkKeys(span.map(dayOf)).length > 0 ? linkedHomework(child.src) : undefined,
      };
    });

    for (const { kind, date } of open) {
      let push: SummaryPush | null = null;
      if (kind === 'morning') {
        const mornings = classes.map((c) => {
          const day = c.dayOf(date);
          return { label: c.label, day, push: c.grid || hasLessons(day) ? planMorningSummary(day, c.src.settings, zone) : null };
        });
        push = classes.length > 1
          ? childrenMorningSummary(mornings.flatMap((m) => (m.push ? [{ ...m, push: m.push }] : [])))
          : mornings[0]!.push;
      } else {
        const evenings = classes.map((c) => {
          if (!c.timetable) return { label: c.label, push: null };
          const ahead = Array.from({ length: NEXT_SCHOOL_DAY_WITHIN }, (_v, i) => c.dayOf(addDays(date, i + 1, zone)));
          const options = { zone, time: settings.eveningReminderTime, linked: c.linked, pack: c.src.pack };
          return { label: c.label, push: planEveningReminder(c.dayOf(date), ahead, c.src.settings, options) };
        });
        push = classes.length > 1
          ? childrenEveningReminder(evenings.flatMap((e) => (e.push ? [{ label: e.label, push: e.push }] : [])))
          : evenings[0]!.push;
      }
      notes.set(summaryId(kind, date), push ? toNote(push) : null);
    }
  }

  return planned.map(({ kind, date, at }): SummaryAction => {
    const identifier = summaryId(kind, date);
    if (at.getTime() <= now.getTime() + SETTLE_MS) return { identifier, kind, date, at, action: 'keep', note: null };
    const note = notes.get(identifier) ?? null;
    return { identifier, kind, date, at, action: note ? 'schedule' : 'cancel', note };
  });
}
