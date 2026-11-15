/**
 * Home-screen widgets (design-doc §4). They render from the MMKV feed only —
 * never from the network — and always state their own freshness.
 *
 * Three widgets, one feed:
 *   - Today      ("מערכת")  — one day's lessons, paged to any day in the feed's window
 *   - TasksExams ("משימות") — homework due today/tomorrow on top, then every open
 *                              task, the late and the due-today first
 *   - Overview   ("סדר יום") — the day at a glance: lessons beside the homework
 *                              due, the next exam, the tasks due and the calendar
 *                              (`overviewSideLayout` decides what fits)
 *
 * The provider names `Today` and `TasksExams` predate this file and must stay:
 * the native provider class is derived from the name, and renaming it makes
 * every placed copy of the widget vanish on update.
 *
 * Wave 9 (plan §16): a widget is a piece of the notebook page — the page's
 * colour (white, or ink), no pill or card inside it, a ruled line under each
 * lesson with the subject's colour as a dot before its name, a cancelled
 * lesson in the red pen with "בוטל", marks (a highlighter, radius 3) for a
 * change or an exam, commas and no "·" between a line's parts (the re-rate).
 * The text is the system face:
 * the widget library draws a custom font only once the app's config bundles
 * it for the widget (`fonts` in the plugin's options), and it has no
 * strike-through.
 *
 * Direction: the widget tree is laid out by Android views that are never
 * attached to a window, and such a view cannot resolve an inherited layout
 * direction — it falls back to left-to-right whatever the locale. The
 * library is patched (`patches/react-native-android-widget+*.patch`) to set
 * RTL on the root, so a row's first child sits at the right edge and text
 * aligns right by default. Its margins, though, are absolute, so the gaps
 * inside a row are fixed-width spacers (`Gap`), which mean the same on
 * either side.
 */
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import type { WidgetDay, WidgetFeed, WidgetHomework, WidgetLesson, WidgetTask } from '@sederyom/shared';
import { dark, light, type Palette } from '../theme';
import { isolateRanges } from '../lib/format';
import { readSubjectSlots } from '../lib/subjectColorStore';
import { isStale, updatedLabel } from './feedCache';
import {
  OVERVIEW_ROWS, SCHEDULE_ROWS, TASK_ROWS, changeBadge, clockNow, clockOf, currentLessonIndex, dayDateTitle, dayHeaderLine,
  dueCounts, dueLabel, emptyDayText, eventLine, examRow, homeworkFocus, homeworkInView, homeworkLine, lessonColorKey, lessonStatusWord, lessonTitle, moreLine,
  nextBucketLabel, nextExamLine, nextSchoolDate, orderTasks, overviewDay, overviewSideLayout, overviewSideLines, resolveDay, sectionHeading,
  tasksSummary, tasksWidgetRows, visibleRows, weekdayShort, widgetSubjectColor, type DayCursor, type DueTone, type SummaryTone,
} from './model';

/** Click actions the task handler answers (`widget-task.tsx`). */
export const CLICK = {
  prev: 'DAY_PREV',
  next: 'DAY_NEXT',
  today: 'DAY_TODAY',
} as const;

export type Scheme = 'light' | 'dark';

/**
 * The paging chevrons. `‹` and `›` are bidi-mirrored glyphs — inside a Hebrew
 * line the shaper flips them — so each sits in an explicit left-to-right
 * override (U+202D … U+202C) and always points the way it reads here: right
 * for "previous", at the start (right) edge, left for "next".
 */
const PREV_CHEVRON = '‭›‬';
const NEXT_CHEVRON = '‭‹‬';

/** The theme tokens, typed the way the widget library wants them. */
function colors(scheme: Scheme) {
  const p: Record<keyof Palette, string> = scheme === 'dark' ? dark : light;
  const c = (v: string) => v as ColorProp;
  return {
    bg: c(p.bg),
    border: c(p.border),
    text: c(p.text),
    textStrong: c(p.textStrong),
    textMuted: c(p.textMuted),
    accent: c(p.accent),
    change: c(p.change),
    changeSoft: c(p.changeSoft),
    cancel: c(p.cancel),
    exam: c(p.exam),
    // An exam is marked on the yellow highlighter, as in the app (`markFill`).
    mark: c(p.mark),
    onMark: c(p.onMark),
    ok: c(p.ok),
  };
}
type Colors = ReturnType<typeof colors>;

function statusColor(status: WidgetLesson['status'], C: Colors): ColorProp {
  switch (status) {
    case 'cancelled': return C.cancel;
    case 'substitution':
    case 'moved':
    case 'remote': return C.change;
    case 'exam': return C.exam;
    case 'event': return C.accent;
    default: return C.text;
  }
}

function toneColor(tone: DueTone, C: Colors): ColorProp {
  switch (tone) {
    case 'overdue': return C.cancel;
    case 'today': return C.change;
    case 'soon': return C.accent;
    default: return C.textMuted;
  }
}

export interface WidgetProps {
  feed: WidgetFeed | null;
  scheme: Scheme;
  /** Widget height in dp, from `WidgetInfo`; decides how many rows fit. */
  heightDp: number;
  /** Local wall-clock `HH:mm`; the current lesson is marked against it. */
  now?: string;
}

/** The smallest text on a widget (plan §1.8: nothing under 12). */
const SMALL = 12;

// ---- shared pieces ----

function Shell({ C, children, clickAction = 'OPEN_APP' }: { C: Colors; children: React.ReactNode; clickAction?: string }): React.JSX.Element {
  return (
    <FlexWidget
      clickAction={clickAction}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: C.bg,
        borderRadius: 20,
        padding: 14,
      }}
    >
      {children}
    </FlexWidget>
  );
}

function Footer({ feed, C }: { feed: WidgetFeed; C: Colors }): React.JSX.Element {
  const stale = isStale(feed);
  return (
    <TextWidget
      text={stale ? `${updatedLabel(feed)}, לא עדכני` : updatedLabel(feed)}
      maxLines={1}
      style={{ fontSize: SMALL, color: stale ? C.change : C.textMuted, marginTop: 6 }}
    />
  );
}

function NoFeed({ title, C }: { title: string; C: Colors }): React.JSX.Element {
  return (
    <Shell C={C}>
      <TextWidget text={title} style={{ fontSize: 15, fontWeight: 'bold', color: C.textStrong }} />
      <TextWidget text="אפשר לפתוח את האפליקציה כדי לטעון נתונים" style={{ fontSize: SMALL, color: C.textMuted, marginTop: 6 }} />
    </Shell>
  );
}

function Spacer(): React.JSX.Element {
  return <FlexWidget style={{ flex: 1 }} />;
}

/** A fixed gap between two things in a row: the same on either side, where the library's margins are not. */
function Gap({ size }: { size: number }): React.JSX.Element {
  return <FlexWidget style={{ width: size, height: 1 }} />;
}

/** Words on the highlighter (plan §16.1 `Mark`): a fill of radius 3 behind them, no border. */
function MarkText({ text, color, fill }: { text: string; color: ColorProp; fill: ColorProp }): React.JSX.Element {
  return (
    <FlexWidget style={{ backgroundColor: fill, borderRadius: 3, paddingHorizontal: 4 }}>
      <TextWidget text={text} maxLines={1} truncate="END" style={{ fontSize: SMALL, color }} />
    </FlexWidget>
  );
}

/** The day's changes: "2 שינויים" on the highlighter, or "ללא שינויים" in the muted ink. */
function ChangeMark({ day, C }: { day: WidgetDay; C: Colors }): React.JSX.Element {
  const badge = changeBadge(day);
  return badge.changed
    ? <MarkText text={badge.text} color={C.change} fill={C.changeSoft} />
    : <TextWidget text={badge.text} maxLines={1} style={{ fontSize: SMALL, color: C.textMuted }} />;
}

/** A paging control: a chevron and the weekday as plain words; an empty space at either end of the window. */
function PageControl({ text, clickAction, C }: { text: string | null; clickAction: string; C: Colors }): React.JSX.Element {
  return (
    <FlexWidget clickAction={text ? clickAction : undefined} style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
      <TextWidget text={text ?? ' '} maxLines={1} style={{ fontSize: 13, color: C.accent }} />
    </FlexWidget>
  );
}

/**
 * One lesson on a ruled line: its start (in blue ink while it is on), the
 * subject's dot, its name — in the red pen when cancelled, with "בוטל" at the
 * end — and who or where at the end otherwise.
 */
function LessonRow({
  lesson, C, current, compact, colorOf,
}: {
  lesson: WidgetLesson;
  C: Colors;
  current: boolean;
  compact?: boolean;
  colorOf: (subject: string) => string;
}): React.JSX.Element {
  const color = statusColor(lesson.status, C);
  const word = lessonStatusWord(lesson);
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width: 'match_parent',
        // 22 dp a row with the rule, as `SCHEDULE_ROWS` counts them.
        paddingTop: 2,
        paddingBottom: 1,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <TextWidget
        text={lesson.startTime ?? String(lesson.hourIndex)}
        maxLines={1}
        style={{ fontSize: SMALL, color: current ? C.accent : C.textMuted, fontWeight: current ? 'bold' : 'normal', width: 40 }}
      />
      <FlexWidget style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colorOf(lessonColorKey(lesson)) as ColorProp }} />
      <Gap size={6} />
      <TextWidget
        text={lessonTitle(lesson)}
        maxLines={1}
        truncate="END"
        style={{ fontSize: compact ? 12.5 : 13, color, fontWeight: current ? 'bold' : 'normal' }}
      />
      <Spacer />
      {word ? (
        <TextWidget text={word} maxLines={1} style={{ fontSize: SMALL, color: C.cancel, fontWeight: 'bold' }} />
      ) : lesson.detail && !compact ? (
        <TextWidget text={isolateRanges(lesson.detail)} maxLines={1} truncate="END" style={{ fontSize: SMALL, color: C.textMuted }} />
      ) : null}
      <Gap size={4} />
    </FlexWidget>
  );
}

function LessonList({
  day, rows, C, now, compact, colorOf,
}: {
  day: WidgetDay;
  rows: number;
  C: Colors;
  now: string | null;
  compact?: boolean;
  colorOf: (subject: string) => string;
}): React.JSX.Element {
  if (day.lessons.length === 0) {
    return <TextWidget text={emptyDayText(day)} style={{ fontSize: 12.5, color: C.textMuted, marginTop: 8 }} />;
  }
  const current = now === null ? -1 : currentLessonIndex(day, now);
  const shown = day.lessons.slice(0, rows);
  const hidden = day.lessons.length - shown.length;
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      {shown.map((lesson, i) => (
        <LessonRow key={`${lesson.hourIndex}-${i}`} lesson={lesson} C={C} current={i === current} compact={compact} colorOf={colorOf} />
      ))}
      {hidden > 0 ? (
        <TextWidget text={`ועוד ${hidden} שיעורים`} style={{ fontSize: SMALL, color: C.textMuted, marginTop: 4 }} />
      ) : null}
    </FlexWidget>
  );
}

function TaskRow({ task, today, nextSchool, C }: { task: WidgetTask; today: string; nextSchool: string | null; C: Colors }): React.JSX.Element {
  const due = dueLabel(task, today, nextSchool);
  const color = toneColor(due.tone, C);
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 5 }}>
      <FlexWidget style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: due.tone === 'none' ? C.border : color }} />
      <Gap size={8} />
      <TextWidget text={isolateRanges(task.title)} maxLines={1} truncate="END" style={{ fontSize: 12.5, color: C.text }} />
      <Spacer />
      {due.text ? <TextWidget text={due.text} maxLines={1} style={{ fontSize: SMALL, color }} /> : null}
      <Gap size={4} />
    </FlexWidget>
  );
}

/**
 * Mashov homework in the task list: the same row as a task, with "ש״ב" in
 * blue ink where the task's dot is, so the two never read as one another.
 */
function HomeworkRow({ item, today, nextSchool, C }: { item: WidgetHomework; today: string; nextSchool: string | null; C: Colors }): React.JSX.Element {
  const due = dueLabel(item, today, nextSchool);
  const color = toneColor(due.tone, C);
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 5 }}>
      <TextWidget text="ש״ב" maxLines={1} style={{ fontSize: SMALL, color: C.accent, fontWeight: 'bold' }} />
      <Gap size={6} />
      <TextWidget text={homeworkLine(item)} maxLines={1} truncate="END" style={{ fontSize: 12.5, color: C.text }} />
      <Spacer />
      {due.text ? <TextWidget text={due.text} maxLines={1} style={{ fontSize: SMALL, color }} /> : null}
      <Gap size={4} />
    </FlexWidget>
  );
}

function summaryColor(tone: SummaryTone, C: Colors): ColorProp {
  switch (tone) {
    case 'overdue': return C.cancel;
    case 'today': return C.change;
    case 'soon': return C.accent;
    case 'open': return C.textMuted;
    default: return C.ok;
  }
}

// ---- 1. מערכת — one day, paged ----

export interface ScheduleProps extends WidgetProps {
  cursor: DayCursor | null;
}

export function ScheduleWidget({ feed, scheme, heightDp, cursor, now }: ScheduleProps): React.JSX.Element {
  const C = colors(scheme);
  if (!feed) return <NoFeed title="מערכת" C={C} />;

  const { day, offset, hasPrev, hasNext } = resolveDay(feed, cursor);
  const rows = visibleRows(heightDp, SCHEDULE_ROWS);
  const clock = offset === 0 ? (now ?? clockNow()) : null;
  const colorOf = widgetSubjectColor(feed, scheme, readSubjectSlots());
  const index = feedIndex(feed, day);

  return (
    <Shell C={C}>
      {/* Header: the day, and the two paging controls. The first child sits
          at the start edge — the right, under RTL — so "previous" is on the
          right and "next" on the left, the way a Hebrew reader pages. */}
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <PageControl
          text={hasPrev ? `${PREV_CHEVRON} ${weekdayShort(feed.days?.[index - 1]?.weekdayName ?? '')}`.trim() : null}
          clickAction={CLICK.prev}
          C={C}
        />
        <FlexWidget clickAction={offset === 0 ? 'OPEN_APP' : CLICK.today} style={{ flex: 1, flexDirection: 'column', alignItems: 'center', paddingHorizontal: 6 }}>
          <TextWidget
            text={dayDateTitle(day, offset)}
            maxLines={1}
            style={{ fontSize: 14.5, fontWeight: 'bold', color: C.textStrong, textAlign: 'center' }}
          />
          {/* "08:00–10:30, 4 בוטלו": the day as it really is, cancellations out (W4, Itai). */}
          <TextWidget
            text={dayHeaderLine(day)}
            maxLines={1}
            style={{ fontSize: SMALL, color: C.textMuted, textAlign: 'center', marginTop: 1 }}
          />
        </FlexWidget>
        <PageControl
          text={hasNext ? `${weekdayShort(feed.days?.[index + 1]?.weekdayName ?? '')} ${NEXT_CHEVRON}`.trim() : null}
          clickAction={CLICK.next}
          C={C}
        />
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 6 }}>
        {day.lessons.length > 0 ? <ChangeMark day={day} C={C} /> : null}
        {day.exams.length > 0 ? (
          <FlexWidget style={{ flexDirection: 'row' }}>
            <Gap size={6} />
            <MarkText text={`מבחן: ${day.exams.map((e) => e.subject).join(', ')}`} color={C.onMark} fill={C.mark} />
          </FlexWidget>
        ) : null}
        <Spacer />
        {offset !== 0 ? (
          <FlexWidget clickAction={CLICK.today} style={{ paddingHorizontal: 4 }}>
            <TextWidget text="להיום" maxLines={1} style={{ fontSize: 13, color: C.accent, fontWeight: 'bold' }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>

      <LessonList day={day} rows={rows} C={C} now={clock} colorOf={colorOf} />

      <Spacer />
      <Footer feed={feed} C={C} />
    </Shell>
  );
}

function feedIndex(feed: WidgetFeed, day: WidgetDay): number {
  return (feed.days ?? []).findIndex((d) => d.date === day.date);
}

// ---- 2. משימות ----

/**
 * Open homework due today (while school is on) and tomorrow on top, then
 * every open task, the late and the due-today first. One row budget for both.
 */
export function TasksWidget({ feed, scheme, heightDp, now }: WidgetProps): React.JSX.Element {
  const C = colors(scheme);
  if (!feed) return <NoFeed title="משימות" C={C} />;

  const homework = homeworkInView(feed, now ?? clockNow());
  const tasks = orderTasks(feed.openTasks ?? [], feed.date);
  // On a Thursday what is due Sunday reads "יום ראשון", and the count counts it as next (W4-1).
  const nextSchool = nextSchoolDate(feed);
  const total = feed.openTaskCount ?? tasks.length;
  const split = tasksWidgetRows(visibleRows(heightDp, TASK_ROWS), homework.length, tasks.length);
  const shownHomework = homework.slice(0, split.homework);
  const shownTasks = tasks.slice(0, split.tasks);
  const more = moreLine(homework.length - shownHomework.length, tasks.length - shownTasks.length);
  const summary = tasksSummary(
    { ...dueCounts([...homework, ...tasks], feed.date, nextSchool), open: total + homework.length },
    nextBucketLabel(feed.date, nextSchool),
  );

  return (
    <Shell C={C}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <TextWidget text="משימות" style={{ fontSize: 15, fontWeight: 'bold', color: C.textStrong }} />
        <Spacer />
        <TextWidget text={summary.text} maxLines={1} style={{ fontSize: 13, color: summaryColor(summary.tone, C), fontWeight: 'bold' }} />
        <Gap size={4} />
      </FlexWidget>

      {shownHomework.length + shownTasks.length === 0 ? (
        <TextWidget text="אין משימות פתוחות" style={{ fontSize: 12.5, color: C.textMuted, marginTop: 8 }} />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 4 }}>
          {shownHomework.map((item, i) => <HomeworkRow key={`hw-${item.key}-${i}`} item={item} today={feed.date} nextSchool={nextSchool} C={C} />)}
          {shownTasks.map((task) => <TaskRow key={task.id} task={task} today={feed.date} nextSchool={nextSchool} C={C} />)}
          {more ? (
            <TextWidget text={more} style={{ fontSize: SMALL, color: C.textMuted, marginTop: 5 }} />
          ) : null}
        </FlexWidget>
      )}

      <Spacer />
      <Footer feed={feed} C={C} />
    </Shell>
  );
}

// ---- 3. סדר יום — everything at a glance ----

export function OverviewWidget({ feed, scheme, heightDp, now }: WidgetProps): React.JSX.Element {
  const C = colors(scheme);
  if (!feed) return <NoFeed title="סדר יום" C={C} />;

  const clock = now ?? clockNow();
  const lead = overviewDay(feed, clock);
  const nextSchool = nextSchoolDate(feed);
  const rows = visibleRows(heightDp, OVERVIEW_ROWS);
  const colorOf = widgetSubjectColor(feed, scheme, readSubjectSlots());

  const allEvents = lead.day.events.filter((e) => e.allDay || lead.offset !== 0 || clockOf(e.end) > clock);
  const allExams = feed.upcomingExams ?? (feed.nextExam ? [feed.nextExam] : []);
  const allTasks = orderTasks(feed.openTasks ?? [], feed.date).filter((t) => {
    const tone = dueLabel(t, feed.date).tone;
    return tone === 'overdue' || tone === 'today' || tone === 'soon';
  });
  const homework = homeworkFocus(feed, clock);
  const side = overviewSideLayout(overviewSideLines(heightDp), {
    homework: homework?.subjects.length ?? 0, events: allEvents.length, exams: allExams.length, tasks: allTasks.length,
  });
  const subjects = homework ? homework.subjects.slice(0, side.homework) : [];
  const nextExam = side.examLine ? allExams[0] : undefined;
  const events = allEvents.slice(0, side.events);
  const exams = allExams.slice(0, side.exams);
  const tasks = allTasks.slice(0, side.tasks);
  // Each section after the first opens with a gap; the lone exam line with a smaller one.
  const shows = [subjects.length > 0, nextExam !== undefined, exams.length > 0, tasks.length > 0 || side.noTasksLine, events.length > 0];
  const gap = (section: number, size = 6): number => (shows.slice(0, section).some(Boolean) ? size : 0);

  return (
    <Shell C={C}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget
            text={dayDateTitle(lead.day, lead.offset)}
            maxLines={1}
            style={{ fontSize: 15, fontWeight: 'bold', color: C.textStrong }}
          />
          <TextWidget
            text={dayHeaderLine(lead.day)}
            maxLines={1}
            style={{ fontSize: SMALL, color: C.textMuted, marginTop: 1 }}
          />
        </FlexWidget>
        <Spacer />
        {lead.day.lessons.length > 0 ? <ChangeMark day={lead.day} C={C} /> : null}
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginTop: 6, flex: 1 }}>
        {/* Start edge (right under RTL): the lessons. */}
        <FlexWidget style={{ flex: 5, flexDirection: 'column' }}>
          {lead.offset !== 0 && lead.day.lessons.length > 0 ? (
            <TextWidget text={`המערכת של ${lead.label}`} style={{ fontSize: SMALL, color: C.accent }} />
          ) : null}
          <LessonList day={lead.day} rows={rows} C={C} now={lead.offset === 0 ? clock : null} compact colorOf={colorOf} />
        </FlexWidget>

        {/* The page's rule between the two columns. */}
        <Gap size={10} />
        <FlexWidget style={{ width: 1, height: 'match_parent', backgroundColor: C.border }} />
        <Gap size={10} />

        {/* End edge (left under RTL): what surrounds the lessons, in the
            priority order `overviewSideLayout` spends its lines in. */}
        <FlexWidget style={{ flex: 4, flexDirection: 'column' }}>
          {homework && subjects.length > 0 ? (
            <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
              <TextWidget
                text={sectionHeading(homework.label, homework.count, subjects.length)}
                maxLines={1}
                style={{ fontSize: SMALL, color: C.textMuted }}
              />
              {subjects.map((s) => (
                <TextWidget key={s} text={s} maxLines={1} truncate="END" style={{ fontSize: SMALL, color: C.text, marginTop: 2 }} />
              ))}
            </FlexWidget>
          ) : null}

          {nextExam ? (
            <FlexWidget style={{ flexDirection: 'row', marginTop: gap(1, 4) }}>
              <MarkText text={nextExamLine(nextExam)} color={C.onMark} fill={C.mark} />
            </FlexWidget>
          ) : null}

          {exams.length > 0 ? (
            <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: gap(2) }}>
              <TextWidget text="מבחנים" style={{ fontSize: SMALL, color: C.textMuted }} />
              {exams.map((e) => (
                <TextWidget
                  key={`${e.date}-${e.subject}`}
                  text={examRow(e)}
                  maxLines={1}
                  truncate="END"
                  style={{ fontSize: SMALL, color: C.exam, marginTop: 2 }}
                />
              ))}
            </FlexWidget>
          ) : null}

          {tasks.length > 0 ? (
            <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: gap(3) }}>
              <TextWidget
                text={sectionHeading('משימות', allTasks.length, tasks.length)}
                maxLines={1}
                style={{ fontSize: SMALL, color: C.textMuted }}
              />
              {tasks.map((t) => {
                const due = dueLabel(t, feed.date, nextSchool);
                return (
                  <FlexWidget key={t.id} style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 2 }}>
                    <TextWidget text={isolateRanges(t.title)} maxLines={1} truncate="END" style={{ fontSize: SMALL, color: C.text }} />
                    <Spacer />
                    <TextWidget text={due.text} maxLines={1} style={{ fontSize: SMALL, color: toneColor(due.tone, C) }} />
                    <Gap size={4} />
                  </FlexWidget>
                );
              })}
            </FlexWidget>
          ) : side.noTasksLine ? (
            <TextWidget text="אין משימות דחופות" maxLines={1} style={{ fontSize: SMALL, color: C.ok, marginTop: gap(3) }} />
          ) : null}

          {events.length > 0 ? (
            <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: gap(4) }}>
              <TextWidget text="ביומן" style={{ fontSize: SMALL, color: C.textMuted }} />
              {events.map((e, i) => (
                <TextWidget
                  key={`${e.start}-${i}`}
                  text={eventLine(e)}
                  maxLines={1}
                  truncate="END"
                  style={{ fontSize: SMALL, color: C.textMuted, marginTop: 2 }}
                />
              ))}
            </FlexWidget>
          ) : null}
        </FlexWidget>
      </FlexWidget>

      <Footer feed={feed} C={C} />
    </Shell>
  );
}

// Kept for the older import path; the two-widget names still route here.
export const TodayWidget = ScheduleWidget;
export const TasksExamsWidget = TasksWidget;
