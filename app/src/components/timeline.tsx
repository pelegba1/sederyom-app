/**
 * The timeline's rows on the ruled page (plan §16.1): each is a `MarginRow`
 * — the time in the margin, the subject on the line, no card around it —
 * meant to sit in a `MarginList`, whose red margin line runs past them all.
 * Outside one (the week's day detail) they still draw, without the line.
 *
 * Lesson and event rows open their details when given `onPress` ("היום שלי");
 * without it they stay plain rows. `CancelledRunRow` is a run of cancelled
 * lessons folded into one line (R-9): the periods struck in the red pen,
 * "בוטלו" beside them; `FullDayEventRows`, a day's lessons folded under a trip
 * or a sports day (W5-3); `CalendarFoldRow`, the day's calendar events folded
 * by "רק בית ספר" (W6-6); `NowIndicator`, the dashed "now" line.
 *
 * A lesson's margin holds its start time over its period ("08:00" / "1–3"):
 * the period in words, "שיעורים 1–3" (W6-7, Maya: a bare "1–3" beside the
 * subject read as a grade or a date), is too wide for the margin, so the
 * margin keeps the number under the time and a screen reader says it in full.
 * The subject's colour is an 8-point dot before its name (plan §16.1), never
 * a stripe along a side.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import type { CalendarEvent, Lesson, SchoolEvent, Task, TimelineItem } from '@sederyom/shared';
import { font, space, statusStyle, type } from '../theme';
import { isolateRanges, shownSubject, timeOf } from '../lib/format';
import { calendarFoldLabel, cancelledRunPeriods, partsText, periodsLabel, subjectNotes, type Part } from '../lib/today';
import { AppIcon } from './AppIcon';
import { MarginRow, Mark } from './notebook';
import { TaskRow } from './TaskRow';
import { Ltr, Text, usePalette } from './ui';

/**
 * A line built from `Part`s (lib/today.ts): the `ltr` runs — times, ranges —
 * isolated through `Ltr`; a `strong` run in the strong text colour and
 * weight, an `alert` one in the cancel colour. Without a `style` it takes the
 * look of the `Text` it sits in.
 */
export function PartsText({
  parts, style, numberOfLines, onLayout, onTextLayout,
}: {
  parts: Part[];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  onLayout?: TextProps['onLayout'];
  onTextLayout?: TextProps['onTextLayout'];
}): React.JSX.Element {
  const p = usePalette();
  const toneStyle = (tone: Part['tone']): TextStyle | undefined => {
    if (tone === 'strong') return { fontFamily: font.bodySemi, color: p.textStrong };
    if (tone === 'alert') return { fontFamily: font.bodySemi, color: p.cancel };
    return undefined;
  };
  return (
    <Text style={style} numberOfLines={numberOfLines} onLayout={onLayout} onTextLayout={onTextLayout}>
      {parts.map((part, i) => {
        const tone = toneStyle(part.tone);
        if (part.ltr) return <Ltr key={i} style={tone}>{part.text}</Ltr>;
        return tone ? <Text key={i} style={tone}>{part.text}</Text> : <React.Fragment key={i}>{part.text}</React.Fragment>;
      })}
    </Text>
  );
}

/** What a screen reader says for a lesson row: period(s), subject, time, status, and whether it is over. */
function lessonA11y(lessons: Lesson[], statusLabel: string, past: boolean): string {
  const first = lessons[0]!;
  const last = lessons[lessons.length - 1]!;
  const periods = lessons.length > 1 ? `שיעורים ${first.hourIndex} עד ${last.hourIndex}` : `שיעור ${first.hourIndex}`;
  const time = first.startTime && last.endTime ? `${first.startTime} עד ${last.endTime}` : null;
  return [periods, shownSubject(first), time, statusLabel || null, past ? 'הסתיים' : null].filter(Boolean).join(', ');
}

/**
 * A lesson's margin: its start time over its period, "08:00" / "1–3"; the
 * period alone when the time is unknown. Capped at 1.15 of the text size, so
 * "08:00" stays on one line in the 56-point margin.
 */
function LessonMargin({ lessons, color }: { lessons: Lesson[]; color: string }): React.JSX.Element {
  const p = usePalette();
  const start = lessons[0]?.startTime ?? null;
  const period = periodsLabel(lessons);
  return (
    <View style={styles.marginStack}>
      {start ? (
        <Text maxScale={1.15} numberOfLines={1} style={[styles.marginTime, { color }]}><Ltr>{start}</Ltr></Text>
      ) : null}
      <Text maxScale={1.15} numberOfLines={1} style={start ? [styles.marginPeriod, { color: p.textMuted }] : [styles.marginTime, { color }]}>
        <Ltr>{period}</Ltr>
      </Text>
    </View>
  );
}

/** The margin's words for something without a clock time: "כל היום". */
function MarginWords({ children, color }: { children: string; color: string }): React.JSX.Element {
  return <Text maxScale={1.15} style={[styles.marginWords, { color }]}>{children}</Text>;
}

/** The status at a changed lesson's end, as a mark (plan §16.1) — never a pill. */
function LessonStatus({ status }: { status: Lesson['status'] }): React.JSX.Element | null {
  const p = usePalette();
  const s = statusStyle(status, p);
  if (!s.label) return null;
  if (status === 'cancelled') return <Text style={[styles.word, { color: p.cancel }]}>{s.label}</Text>;
  return <Mark kind={status === 'exam' ? 'exam' : status === 'event' ? 'mark' : 'change'} color={s.color}>{s.label}</Mark>;
}

export function LessonRow({
  lesson,
  block,
  compact = false,
  past = false,
  subjectColor,
  onPress,
}: {
  lesson: Lesson;
  /**
   * The lessons this row stands for when it is a block of one subject in a
   * row — "שיעורים 1–3 · פיזיקה" (`dayEntries`, lib/today.ts); `lesson` is the first.
   */
  block?: Lesson[];
  /** The week's day detail: a smaller title and one line under it. */
  compact?: boolean;
  /** Over already (today): drawn in the muted colour, never faded (W4-8). */
  past?: boolean;
  /**
   * The subject's colour (`useSubjectColor`, W6-F): an 8-point dot before its
   * name. A second cue beside the name — never the text's colour. Without it, no dot.
   */
  subjectColor?: string;
  /** Opens the lesson's details (LessonSheet), with the block when there is one; without it the row is not pressable. */
  onPress?: (lesson: Lesson, block?: Lesson[]) => void;
}): React.JSX.Element {
  const p = usePalette();
  const s = statusStyle(lesson.status, p);
  const cancelled = lesson.status === 'cancelled';
  const isChanged = lesson.status !== 'regular';
  const lessons = block && block.length > 1 ? block : [lesson];
  const many = lessons.length > 1;
  // "אנגלית 5 יח״ל (יב3)" reads "אנגלית"; the group is in the lesson's sheet. A name the student gave reads as typed.
  const subject = shownSubject(lesson);
  // Who and where, with a comma (plan §16.2, no "·"): the substitute in place of the teacher. The place is the site's.
  const room = lesson.room ?? subjectNotes(lesson.originalSubject ?? lesson.subject).place;
  const detail = [lesson.substitute ? `מ״מ: ${lesson.substitute}` : lesson.teacher, room].filter(Boolean).join(', ') || null;
  // A note that only repeats the detail line ("מ״מ: רונית") is not shown twice.
  const note = isChanged && lesson.note && !(detail ?? '').includes(lesson.note) ? isolateRanges(lesson.note) : null;
  // The compact row (week detail) keeps one line under the subject, and the note wins it.
  const lines = (compact ? [note ?? detail] : [detail, note]).filter((line): line is string => Boolean(line));
  const titleColor = cancelled ? p.cancel : past ? p.textMuted : p.text;

  return (
    <MarginRow
      margin={<LessonMargin lessons={lessons} color={cancelled ? p.cancel : p.textMuted} />}
      tone={cancelled ? 'cancelled' : 'normal'}
      end={isChanged ? <LessonStatus status={lesson.status} /> : undefined}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={lessonA11y(lessons, s.label, past)}
      accessibilityHint={onPress ? 'פותח את פרטי השיעור' : undefined}
      onPress={onPress ? () => onPress(lesson, many ? lessons : undefined) : undefined}
    >
      <View style={styles.titleRow}>
        {subjectColor ? <View style={[styles.dot, { backgroundColor: subjectColor }]} /> : null}
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            compact ? styles.titleCompact : null,
            { color: titleColor },
            // Struck in the red pen (plan §16.1); the title is `cancel` too, as Android ignores the strike's colour.
            cancelled ? { textDecorationLine: 'line-through', textDecorationColor: p.cancel } : null,
          ]}
        >
          {subject}
        </Text>
      </View>
      {lines.map((line, i) => (
        <Text key={i} numberOfLines={1} style={[styles.subtitle, { color: p.textMuted }]}>{line}</Text>
      ))}
    </MarginRow>
  );
}

/**
 * Which calendar an event comes from, said as a calendar: "יומן ״אחר
 * הצהריים״" — the bare name next to a time read as a time of day (W4, Maya).
 */
export function calendarLabel(event: Pick<CalendarEvent, 'calendarName'>): string {
  return event.calendarName ? `יומן ״${event.calendarName}״` : 'יומן Google';
}

/**
 * A calendar event: its start in the margin ("כל היום" for a day-long one),
 * the calendar icon and its title in the muted colour, so the lessons stay
 * what the eye finds (W4, Itai). `slim` is one line: an event in school hours,
 * or all day, on a school day; otherwise the calendar and the place go under it.
 */
export function EventRow({
  event,
  onLongPress,
  onPress,
  slim = false,
  past = false,
}: {
  event: CalendarEvent;
  /** Long press hides the event (Today screen); absent where hiding makes no sense. */
  onLongPress?: (event: CalendarEvent) => void;
  /** Opens the event's details (Today screen). */
  onPress?: (event: CalendarEvent) => void;
  /** One line only: no calendar or place under the title. */
  slim?: boolean;
  /** Over already (today): drawn in the faint colour (W4-8). */
  past?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const interactive = Boolean(onPress || onLongPress);
  const spoken = event.allDay ? 'כל היום' : [timeOf(event.start), timeOf(event.end)].filter(Boolean).join(' עד ');
  const detail = slim ? null : [calendarLabel(event), event.location ? isolateRanges(event.location) : null].filter(Boolean).join(', ');
  const color = past ? p.textFaint : p.textMuted;
  return (
    <MarginRow
      margin={event.allDay ? <MarginWords color={p.textMuted}>כל היום</MarginWords> : timeOf(event.start)}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={[event.summary, spoken, calendarLabel(event), past ? 'הסתיים' : null].filter(Boolean).join(', ')}
      accessibilityHint={onPress ? 'פותח את פרטי האירוע' : onLongPress ? 'לחיצה ארוכה מסתירה את האירוע' : undefined}
      // A row is pressable only with `onPress`; a long press alone still needs one.
      onPress={onPress ? () => onPress(event) : onLongPress ? () => undefined : undefined}
      onLongPress={onLongPress ? () => onLongPress(event) : undefined}
      delayLongPress={400}
    >
      <View style={styles.titleRow}>
        <AppIcon name="calendar" color={color} size={16} />
        <Text numberOfLines={slim ? 1 : 2} style={[styles.eventTitle, { color }]}>{isolateRanges(event.summary)}</Text>
      </View>
      {detail ? <Text numberOfLines={1} style={[styles.subtitle, { color: p.textMuted }]}>{detail}</Text> : null}
    </MarginRow>
  );
}

export function TimelineRow({
  item,
  past = false,
  slim = false,
  colorOf,
  onToggleTask,
  onLongPressEvent,
  onPressEvent,
  onPressLesson,
}: {
  item: TimelineItem;
  /** Over already: lessons and events draw muted (W4-8). */
  past?: boolean;
  /** An event drawn as one line (`EventRow` `slim`). */
  slim?: boolean;
  /** A lesson's subject colour, for its dot (`LessonRow` `subjectColor`). */
  colorOf?: (subject: string) => string;
  onToggleTask?: (task: Task) => void;
  onLongPressEvent?: (event: CalendarEvent) => void;
  onPressEvent?: (event: CalendarEvent) => void;
  onPressLesson?: (lesson: Lesson) => void;
}): React.JSX.Element {
  if (item.kind === 'lesson') {
    return <LessonRow lesson={item.lesson} past={past} subjectColor={colorOf?.(item.lesson.originalSubject ?? item.lesson.subject)} onPress={onPressLesson} />;
  }
  if (item.kind === 'event') {
    return <EventRow event={item.event} slim={slim} past={past} onLongPress={onLongPressEvent} onPress={onPressEvent} />;
  }
  // A task on the timeline (none on Today, which lists them apart). A Google task has a date and no
  // time (`Task.due`; the server sorts it last), so in a column of times its margin stays empty
  // rather than saying "היום".
  return <TaskRow task={item.task} onToggle={onToggleTask} margin={null} />;
}

/** A chevron that turns over while what it opens is open. */
function FoldChevron({ open }: { open: boolean }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={open ? styles.flip : null}>
      <AppIcon name="chevronDown" color={p.textMuted} size={18} />
    </View>
  );
}

/**
 * Cancelled lessons in a row, folded into one line (R-9): the periods struck
 * through in the red pen, "בוטלו" beside them, and under them what the gap
 * means, "חופשי מ־10:30" (`free`, from `dayEntries`). The whole line,
 * `label`, is what a screen reader hears. Tapping it opens the lessons in
 * place, each one still a row that opens its details; tapping it again folds
 * them back. The list holds the open state (`open`, `onToggle`) and draws
 * the opened lessons itself, among the day's other rows in the order of the
 * clock (`expandRuns` in lib/today.ts, run 8): an event at 13:00 sits between
 * the 12:15 and the 13:25 lessons, not after them all.
 */
export function CancelledRunRow({
  lessons,
  label,
  free = null,
  open,
  onToggle,
}: {
  lessons: Lesson[];
  label: Part[];
  /** What the gap means, under the periods (`DayEntry.free`); none without it. */
  free?: Part[] | null;
  /** Whether its lessons are shown, under it, by the list. */
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const single = new Set(lessons.map((l) => l.hourIndex)).size === 1;
  return (
    <View>
      <MarginRow
        margin={lessons[0]?.startTime ?? undefined}
        tone="cancelled"
        title={<PartsText parts={cancelledRunPeriods(lessons)} />}
        subtitle={free ? <PartsText parts={free} style={[styles.subtitle, { color: p.textMuted }]} /> : undefined}
        end={(
          <View style={styles.endRow}>
            <Text style={[styles.word, { color: p.cancel }]}>{single ? 'בוטל' : 'בוטלו'}</Text>
            <FoldChevron open={open} />
          </View>
        )}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={partsText(label)}
        accessibilityHint={open ? 'מקפל את השיעורים שבוטלו' : 'מציג את השיעורים שבוטלו'}
        onPress={onToggle}
      />
    </View>
  );
}

/**
 * Which cancelled runs are open in a list (`CancelledRunRow`, `expandRuns`):
 * their keys, and the toggle. They all close when `day` changes, so a run
 * opened on one day is not open on the next.
 */
export function useOpenRuns(day: string): { open: ReadonlySet<string>; toggle: (key: string) => void } {
  const [state, setState] = useState<{ day: string; keys: ReadonlySet<string> }>({ day, keys: new Set() });
  const keys = state.day === day ? state.keys : EMPTY_KEYS;
  const toggle = useCallback((key: string) => {
    setState((prev) => {
      const next = new Set(prev.day === day ? prev.keys : EMPTY_KEYS);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { day, keys: next };
    });
  }, [day]);
  return { open: keys, toggle };
}

const EMPTY_KEYS: ReadonlySet<string> = new Set();

/**
 * "רק בית ספר" on (W6-6, Itai: "on the bus I only want school"): the day's
 * calendar events folded into one row at the end of the timeline, "3
 * אירועים ביומן", with "להציג" at its end. A tap opens them in place, under
 * the row, and the word becomes "לקפל"; `children` are the event rows. Like
 * `CancelledRunRow`, the open state is the row's own: give it a key that
 * changes with the day.
 */
export function CalendarFoldRow({ count, children }: { count: number; children: React.ReactNode }): React.JSX.Element {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const label = calendarFoldLabel(count);
  const action = open ? 'לקפל' : 'להציג';
  return (
    <View>
      <MarginRow
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}. ${action}`}
        accessibilityHint={open ? 'מקפל את אירועי היומן' : 'מציג את אירועי היומן של היום הזה'}
        onPress={() => setOpen((v) => !v)}
        end={(
          <View style={styles.endRow}>
            <Text style={[styles.word, { color: p.accent }]}>{action}</Text>
            <FoldChevron open={open} />
          </View>
        )}
      >
        <View style={styles.titleRow}>
          <AppIcon name="calendar" color={p.textMuted} size={16} />
          <Text numberOfLines={2} style={[styles.eventTitle, { color: p.textMuted }]}>{label}</Text>
        </View>
      </MarginRow>
      {open ? children : null}
    </View>
  );
}

/**
 * A school event that takes the whole day — a trip, a sports day (W5-3,
 * `fullDayEvent`): a row named by it, "כל היום" in the margin, and under it
 * the day's lessons folded into one row ("לפי המערכת: 7 שיעורים") that opens
 * them in place and folds them back. `children` are the lesson rows. Like
 * `CancelledRunRow`, the open state is the row's own: give it a key that
 * changes with the day.
 */
export function FullDayEventRows({
  event, label, children,
}: {
  event: SchoolEvent;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const details = event.details?.trim() || null;
  return (
    <View>
      <MarginRow
        margin={<MarginWords color={p.accent}>כל היום</MarginWords>}
        accessible
        accessibilityLabel={[event.title, details, 'כל היום'].filter(Boolean).join('. ')}
        title={isolateRanges(event.title)}
        subtitle={details ? isolateRanges(details) : undefined}
        end={<AppIcon name="school" color={p.accent} size={22} />}
      />
      <MarginRow
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        accessibilityHint={open ? 'מקפל את השיעורים' : 'מציג את השיעורים לפי המערכת'}
        onPress={() => setOpen((v) => !v)}
        end={<FoldChevron open={open} />}
      >
        <View style={styles.titleRow}>
          <AppIcon name="day" color={p.textMuted} size={16} />
          <Text numberOfLines={2} style={[styles.eventTitle, { color: p.textMuted }]}>{label}</Text>
        </View>
      </MarginRow>
      {open ? children : null}
    </View>
  );
}

/**
 * The "now" line, between the rows it falls between (W4-8): the time in the
 * margin in blue ink and a dashed blue rule across (`tone="now"`, plan
 * §16.1). `now` comes from the screen's minute tick.
 */
export function NowIndicator({ now = new Date() }: { now?: Date }): React.JSX.Element {
  const p = usePalette();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <MarginRow
      margin={time}
      tone="now"
      accessible
      accessibilityLabel={`עכשיו ${time}`}
      title="עכשיו"
      titleStyle={[styles.nowTitle, { color: p.accent }]}
      style={styles.nowRow}
    />
  );
}

const styles = StyleSheet.create({
  marginStack: { alignItems: 'center', gap: 1 },
  marginTime: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  marginPeriod: { fontFamily: font.body, fontSize: type.caption, fontVariant: ['tabular-nums'] },
  marginWords: { fontFamily: font.bodySemi, fontSize: type.caption, textAlign: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flexShrink: 1, fontFamily: font.bodySemi, fontSize: type.title },
  titleCompact: { fontSize: type.body },
  subtitle: { fontFamily: font.body, fontSize: type.small },
  eventTitle: { flexShrink: 1, fontFamily: font.body, fontSize: type.body },
  word: { fontFamily: font.bodySemi, fontSize: type.small },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flip: { transform: [{ rotate: '180deg' }] },
  nowRow: { minHeight: 40 },
  nowTitle: { fontFamily: font.bodySemi, fontSize: type.small },
});
