/**
 * The week, the planning list and the widget feed, built on the phone (plan
 * Phase 2e) the way the server's `loadWeekView`, `loadAgendaView` and
 * `loadWidgetFeed` build them, from the days `buildLocalDays` assembles.
 */
import type { AgendaView, DateStr, DayView, WeekView, WidgetFeed } from '@sederyom/shared';
import { AGENDA_DEFAULT_DAYS, AGENDA_MAX_DAYS, WIDGET_DAYS_AHEAD, WIDGET_DAYS_BACK } from '@sederyom/shared';
import { buildAgendaView, buildWeekView, buildWidgetFeed } from '@sederyom/shared/logic/build';
import { filterExams } from '@sederyom/shared/logic/filters';
import { addDays, todayStr, weekStart } from '@sederyom/shared/logic/time';
import { buildLocalDays, localExamsFrom, localOpenTasks, type LocalSources } from './days';

const datesFrom = (from: DateStr, count: number, zone: string): DateStr[] => Array.from({ length: count }, (_v, i) => addDays(from, i, zone));

export function localDay(src: LocalSources, date?: DateStr): DayView {
  return buildLocalDays(src, [date ?? todayStr(src.zone)])[0]!;
}

export function localWeek(src: LocalSources, offset: number): WeekView {
  const start = weekStart(todayStr(src.zone), offset, src.zone);
  const days = buildLocalDays(src, datesFrom(start, 6, src.zone));
  return buildWeekView({
    offset,
    startDate: start,
    zone: src.zone,
    now: src.now,
    days,
    // Read off the days, so a chip on a day and the week's list are the same exams.
    exams: days.flatMap((d) => d.examsToday),
    schoolEvents: days.flatMap((d) => d.events),
  });
}

export function localAgenda(src: LocalSources, days: number = AGENDA_DEFAULT_DAYS): AgendaView {
  const count = Math.min(AGENDA_MAX_DAYS, Math.max(1, Math.trunc(Number.isFinite(days) ? days : AGENDA_DEFAULT_DAYS)));
  const from = todayStr(src.zone);
  return buildAgendaView({ from, days: buildLocalDays(src, datesFrom(from, count, src.zone)), zone: src.zone, now: src.now });
}

export function localWidgetFeed(src: LocalSources): WidgetFeed {
  const today = todayStr(src.zone);
  const dates = datesFrom(addDays(today, -WIDGET_DAYS_BACK, src.zone), WIDGET_DAYS_BACK + WIDGET_DAYS_AHEAD + 1, src.zone);
  const days = buildLocalDays(src, dates);
  return buildWidgetFeed({
    day: days[WIDGET_DAYS_BACK]!,
    days,
    zone: src.zone,
    now: src.now,
    openTasks: localOpenTasks(src),
    upcomingExams: filterExams(localExamsFrom(src, today, today), src.settings),
  });
}
