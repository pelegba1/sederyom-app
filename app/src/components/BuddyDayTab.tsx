/**
 * ״מערכת״ on a friend's page (friends spec 2.4, sketch 1-layout.html, option
 * 1): the week's days א׳ to ו׳ between the week arrows, then the day's summary
 * (the end, the shared window on the highlighter, the start), then the day
 * hour by hour in two columns, ״שלך״ and the friend's.
 *
 * The table is `tableLines`: a lesson sat together is one line across both
 * columns with ״ביחד״, a shared window one yellow line (`mark`) however many
 * periods it spans, the lessons cancelled in it struck under its name. Two
 * windows of a day are two lines. An empty cell says ״עוד לא״ or ״סיימו״ (״סיימת״ in mine)
 * in `textFaint`; one between two lessons stays blank. A cancelled lesson is
 * struck in the red pen and a changed one says so in its own ink, as the
 * timeline does. By period (one school) the margin is the period over its
 * start; by the clock (two schools) the start alone, since a period of one
 * school is not an hour of the other.
 *
 * Instead of all that, one line: the friend shares no timetable
 * (״זה לא משותף איתך.״), their first update has not come, the week is not
 * published, or one of the two timetables has no times (`noTimes`).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { DateStr } from '@sederyom/shared';
import type { CompareLesson } from '@sederyom/shared/logic/buddies-compare';
import { BUDDY_COPY } from '../buddies/copy';
import { tableLines, type BuddyPage, type BuddyTableLine, type EmptyCell } from '../buddies/view';
import { addDays, dayLabel, formatShortDate, stripGroup, todayStr, weekdayName } from '../lib/format';
import { font, space, statusStyle, type, type Palette } from '../theme';
import { AppIcon } from './AppIcon';
import { Mark, MARGIN_LINE, MARGIN_WIDTH, MarginList, PenCircle, ROW_GUTTER } from './notebook';
import { Ltr, MIN_TOUCH, Text, usePalette } from './ui';

/** Sunday to Friday: the days a friend's page compares (2.4). */
const LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];

export function BuddyDayTab({ page, onPick }: { page: BuddyPage; onPick: (date: DateStr) => void }): React.JSX.Element {
  if (page.updatedAt === null) return <BuddyTabNote>{BUDDY_COPY.waitingFirst}</BuddyTabNote>;
  // No timetable in their box: they share none (`exams` is there exactly when it is).
  if (page.exams === null) return <BuddyTabNote>{BUDDY_COPY.notShared}</BuddyTabNote>;
  return (
    <View style={styles.fill}>
      <DayStrip date={page.date} onChange={onPick} />
      <ScrollView contentContainerStyle={styles.content}>
        <DayBody page={page} />
      </ScrollView>
    </View>
  );
}

/** A tab's one line in place of its content: not shared, not here yet, nothing to show. */
export function BuddyTabNote({ children }: { children: string }): React.JSX.Element {
  const p = usePalette();
  return <Text style={[styles.note, { color: p.textMuted }]}>{children}</Text>;
}

/** A day one of the two (or both) has no school: the summary is empty then, and this says why. */
function noSchoolLine(page: BuddyPage): string | null {
  const c = page.compare;
  if (!c || (c.mine && c.theirs)) return null;
  if (!c.mine && !c.theirs) return BUDDY_COPY.noSchoolDay;
  return c.theirs ? BUDDY_COPY.noSchoolMine : BUDDY_COPY.noSchoolTheirs(page.name);
}

function DayBody({ page }: { page: BuddyPage }): React.JSX.Element {
  const p = usePalette();
  if (page.unpublished) return <BuddyTabNote>{BUDDY_COPY.notPublished}</BuddyTabNote>;
  if (page.noTimes) return <BuddyTabNote>{page.noTimes === 'mine' ? BUDDY_COPY.noTimesMine : BUDDY_COPY.noTimes(page.name)}</BuddyTabNote>;
  const lines = tableLines(page);
  // With a side without school the summary is empty, or today's ״היום בלי לימודים״ even when only they have none: this says whose.
  const noSchool = noSchoolLine(page);
  const summary = noSchool ? [noSchool] : page.summary;
  return (
    <>
      {summary.length > 0 ? (
        <View style={styles.summary}>
          {summary.map((line) => (
            // The shared window on the highlighter, as the sketch draws it.
            line.startsWith(BUDDY_COPY.window)
              ? <Mark key={line} style={styles.summaryLine}>{line}</Mark>
              : <Text key={line} style={[styles.summaryLine, { color: p.text }]}>{line}</Text>
          ))}
        </View>
      ) : null}
      {lines.length > 0 ? <Table page={page} lines={lines} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The days of the week
// ---------------------------------------------------------------------------

/**
 * The week of `date`, Sunday to Friday, as `WeekStrip` writes it (the letter
 * over the number, the shown day circled in pen, today in blue ink), between
 * the arrows to the week before and after. A new week keeps the weekday.
 */
function DayStrip({ date, onChange }: { date: DateStr; onChange: (date: DateStr) => void }): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const sunday = addDays(date, -weekday);
  // A Saturday shown (no school day ahead) moves to the Friday of the week it goes to.
  const week = (step: number) => onChange(addDays(sunday, step * 7 + Math.min(weekday, LETTERS.length - 1)));
  return (
    <View style={styles.strip}>
      {/* First in the row, so at the right edge: "previous" points right, as on ״שבוע״. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={BUDDY_COPY.prevWeek}
        onPress={() => week(-1)}
        style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppIcon name="chevronRight" color={p.accent} size={22} />
      </Pressable>
      {LETTERS.map((letter, i) => {
        const d = addDays(sunday, i);
        const active = d === date;
        const isToday = d === today;
        return (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityLabel={`${weekdayName(d)} ${formatShortDate(d)}${isToday ? `, ${dayLabel(d)}` : ''}`}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(d)}
            style={({ pressed }) => [styles.day, { opacity: pressed ? 0.6 : 1 }]}
          >
            <PenCircle active={active}>
              <View style={styles.dayFace}>
                <Text maxScale={1.15} style={[styles.dayLetter, { color: isToday ? p.accent : p.textMuted }]}>{letter}</Text>
                <Text maxScale={1.15} style={[styles.dayNumber, { color: isToday ? p.accent : p.text }]}>{String(Number(d.slice(-2)))}</Text>
              </View>
            </PenCircle>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={BUDDY_COPY.nextWeek}
        onPress={() => week(1)}
        style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppIcon name="chevronLeft" color={p.accent} size={22} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function Table({ page, lines }: { page: BuddyPage; lines: BuddyTableLine[] }): React.JSX.Element {
  const p = usePalette();
  return (
    <MarginList style={styles.table}>
      <View style={[styles.line, styles.head, { borderBottomColor: p.border }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.margin} />
        <View style={styles.cells}>
          <Text numberOfLines={1} style={[styles.headText, { color: p.textMuted }]}>{BUDDY_COPY.yours}</Text>
          <Text numberOfLines={1} style={[styles.headText, { color: p.textMuted }]}>{page.name}</Text>
        </View>
      </View>
      {lines.map((line, i) => <TableLine key={`${line.from}|${line.start ?? ''}|${i}`} line={line} page={page} />)}
    </MarginList>
  );
}

/** Whether the margin names the line's periods: by period, and not for a window that is only a break (no period of its own). */
const showsPeriods = (line: BuddyTableLine, byHour: boolean): boolean => byHour && line.from <= line.to;

/** The margin: the period (or periods) over the start, by period; the start alone by the clock. */
function LineMargin({ line, byHour }: { line: BuddyTableLine; byHour: boolean }): React.JSX.Element {
  const p = usePalette();
  const periods = line.from === line.to ? String(line.from) : `${line.from}–${line.to}`;
  const named = showsPeriods(line, byHour);
  return (
    <View style={styles.margin}>
      {named ? <Text maxScale={1.15} numberOfLines={1} style={[styles.marginMain, { color: p.accent }]}><Ltr>{periods}</Ltr></Text> : null}
      {line.start ? (
        <Text maxScale={1.15} numberOfLines={1} style={named ? [styles.marginTime, { color: p.textMuted }] : [styles.marginMain, { color: p.accent }]}>
          <Ltr>{line.start}</Ltr>
        </Text>
      ) : null}
    </View>
  );
}

/** A lesson's status in a cell, as the timeline marks it: ״בוטל״ in the red pen, a change on its highlighter. */
function CellStatus({ lesson }: { lesson: CompareLesson }): React.JSX.Element | null {
  const p = usePalette();
  const s = statusStyle(lesson.status, p);
  if (!s.label) return null;
  if (lesson.status === 'cancelled') return <Text style={[styles.cellSub, { color: p.cancel }]}>{s.label}</Text>;
  const kind = lesson.status === 'exam' ? 'exam' : lesson.status === 'event' ? 'mark' : 'change';
  return <Mark kind={kind} color={s.color} style={styles.cellSub} containerStyle={styles.cellMark}>{s.label}</Mark>;
}

const emptyWord = (empty: EmptyCell, mine: boolean): string =>
  (empty === 'notYet' ? BUDDY_COPY.notYet : empty === 'done' ? (mine ? BUDDY_COPY.doneMine : BUDDY_COPY.done) : '');

/** One side's cell: its lesson, or what its emptiness says. */
function Cell({ lesson, empty, mine }: { lesson: CompareLesson | null; empty: EmptyCell; mine: boolean }): React.JSX.Element {
  const p = usePalette();
  if (!lesson) {
    return (
      <View style={styles.cell}>
        <Text style={[styles.cellText, styles.cellEmpty, { color: p.textFaint }]}>{emptyWord(empty, mine)}</Text>
      </View>
    );
  }
  const cancelled = lesson.status === 'cancelled';
  return (
    <View style={styles.cell}>
      <Text
        numberOfLines={2}
        // Struck in the red pen, and written in it: Android ignores the strike's own colour.
        style={[styles.cellText, { color: cancelled ? p.cancel : p.text }, cancelled ? { textDecorationLine: 'line-through', textDecorationColor: p.cancel } : null]}
      >
        {stripGroup(lesson.subject)}
      </Text>
      <CellStatus lesson={lesson} />
    </View>
  );
}

/** What a side's cell says aloud: the subject and its status, or what its emptiness says. */
function cellSaid(lesson: CompareLesson | null, empty: EmptyCell, mine: boolean, p: Palette): string {
  if (!lesson) return emptyWord(empty, mine) || BUDDY_COPY.noLesson;
  const { label } = statusStyle(lesson.status, p);
  return label ? `${stripGroup(lesson.subject)}, ${label}` : stripGroup(lesson.subject);
}

/** The lessons cancelled in a window, as one line: the subjects, then ״בוטל״ or ״בוטלו״. */
const cancelledWords = (lessons: readonly CompareLesson[]): { subjects: string; word: string } => ({
  subjects: lessons.map((l) => stripGroup(l.subject)).join(', '),
  word: BUDDY_COPY.cancelledWord(lessons.length),
});

function lineSaid(line: BuddyTableLine, page: BuddyPage, p: Palette): string {
  const when = [showsPeriods(line, page.byHour) ? BUDDY_COPY.periodsSaid(line.from, line.to) : null, line.start].filter(Boolean).join(', ');
  if (line.kind === 'window') {
    if (line.cancelled.length === 0) return `${when}: ${BUDDY_COPY.window}`;
    const { subjects, word } = cancelledWords(line.cancelled);
    return `${when}: ${BUDDY_COPY.window}, ${subjects} ${word}`;
  }
  if (line.kind === 'together') return `${when}: ${cellSaid(line.mine, null, true, p)}, ${BUDDY_COPY.together}`;
  const mine = cellSaid(line.mine, line.mineEmpty, true, p);
  return `${when}: ${BUDDY_COPY.yours} ${mine}, ${page.name} ${cellSaid(line.theirs, line.theirsEmpty, false, p)}`;
}

/**
 * What made a window, under its name: the cancelled lessons struck in the red
 * pen, ״בוטל״ beside them, on a scrap of the page: the red pen does not read
 * on the yellow of the ink page.
 */
function WindowCancelled({ lessons }: { lessons: readonly CompareLesson[] }): React.JSX.Element {
  const p = usePalette();
  const { subjects, word } = cancelledWords(lessons);
  return (
    <View style={[styles.windowCancelled, { backgroundColor: p.bg }]}>
      <Text numberOfLines={2} style={[styles.cellSub, { color: p.cancel }]}>
        <Text style={{ textDecorationLine: 'line-through', textDecorationColor: p.cancel }}>{subjects}</Text>
        {` ${word}`}
      </Text>
    </View>
  );
}

function TableLine({ line, page }: { line: BuddyTableLine; page: BuddyPage }): React.JSX.Element {
  const p = usePalette();
  const frame = [styles.line, { borderBottomColor: p.borderSoft }];
  let cells: React.ReactNode;
  if (line.kind === 'window') {
    cells = (
      <View style={[styles.joined, { backgroundColor: p.mark }]}>
        <Text style={[styles.cellText, { color: p.onMark }]}>{BUDDY_COPY.window}</Text>
        {line.cancelled.length > 0 ? <WindowCancelled lessons={line.cancelled} /> : null}
      </View>
    );
  } else if (line.kind === 'together' && line.mine) {
    cells = (
      <View style={[styles.joined, { backgroundColor: p.accentSoft }]}>
        <Text numberOfLines={2} style={[styles.cellText, { color: p.text }]}>{stripGroup(line.mine.subject)}</Text>
        <View style={styles.togetherSub}>
          <Text style={[styles.cellSub, { color: p.accent }]}>{BUDDY_COPY.together}</Text>
          <CellStatus lesson={line.mine} />
        </View>
      </View>
    );
  } else {
    cells = (
      <>
        <Cell lesson={line.mine} empty={line.mineEmpty} mine />
        <Cell lesson={line.theirs} empty={line.theirsEmpty} mine={false} />
      </>
    );
  }
  return (
    <View style={frame} accessible accessibilityLabel={lineSaid(line, page, p)}>
      <LineMargin line={line} byHour={page.byHour} />
      <View style={styles.cells}>{cells}</View>
    </View>
  );
}

/** The day strip's day: as wide as `WeekStrip`'s, the pen ring round its letter and number. */
const DAY_FACE = 40;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: space.xxl },
  note: { fontFamily: font.body, fontSize: type.body, lineHeight: 24, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg },
  strip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingBottom: space.sm },
  arrow: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  day: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', paddingTop: space.xs },
  dayFace: { width: DAY_FACE, alignItems: 'center' },
  dayLetter: { fontFamily: font.body, fontSize: type.caption, lineHeight: 18 },
  dayNumber: { fontFamily: font.bodySemi, fontSize: type.title, lineHeight: 24, fontVariant: ['tabular-nums'] },
  summary: { paddingHorizontal: ROW_GUTTER, paddingTop: space.sm, paddingBottom: space.md, gap: space.xs },
  summaryLine: { fontFamily: font.body, fontSize: type.body, lineHeight: 24 },
  table: { marginTop: space.xs },
  line: { flexDirection: 'row', alignItems: 'stretch', minHeight: MIN_TOUCH + space.xs, borderBottomWidth: 1 },
  head: { minHeight: 0 },
  headText: { flex: 1, fontFamily: font.bodySemi, fontSize: type.caption, textAlign: 'center', paddingVertical: space.xs },
  margin: { width: MARGIN_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xs },
  marginMain: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  marginTime: { fontFamily: font.body, fontSize: type.caption, fontVariant: ['tabular-nums'] },
  cells: { flex: 1, flexDirection: 'row', paddingStart: MARGIN_LINE, paddingEnd: space.sm },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xs, paddingHorizontal: space.xs, gap: 2 },
  joined: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xs, paddingHorizontal: space.sm, gap: 2 },
  cellText: { fontFamily: font.bodySemi, fontSize: type.small, textAlign: 'center' },
  cellEmpty: { fontFamily: font.body },
  cellSub: { fontFamily: font.bodySemi, fontSize: type.caption },
  cellMark: { alignSelf: 'center' },
  togetherSub: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  windowCancelled: { borderRadius: 3, paddingHorizontal: space.xs },
});
