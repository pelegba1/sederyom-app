/**
 * שבוע (design panel 02): Sunday-to-Friday grid, Sunday on the right, one row
 * per period, one short word per cell. Tapping a lesson opens its details
 * (LessonSheet, R-27) and picks its day; tapping a day header picks the day.
 * The picked day is shown in full underneath — the same rows the Today screen
 * shows, in the same time order (B12).
 *
 * The header names the week by its dates ("18–23.10") and says where it
 * stands ("בעוד שבועיים"). A week the school site has not published yet is
 * filled in from the fixed Mashov timetable and drawn as "לפי המערכת
 * הקבועה" (R-29): dashed, muted cells, a legend entry and a one-line note.
 *
 * Wave 4 (W4-9, Daniel and Itai):
 * - The period column shows when each period starts ("1" over "08:00").
 * - A Friday without lessons or exams is left out of the grid.
 * - Every subject has one label, the same in its cells and its exam tag:
 *   whole names when they all fit, else the short forms for all.
 * - A day with homework due has a small square in its header.
 * - The lesson sheet offers "משימה לשיעור הבא", and an exam in the day
 *   under the grid opens its details.
 *
 * Every label in the grid is measured against its column before it is drawn
 * (`gridLabels`, `fitGridLabel`): 14 points when the whole grid fits (run 8),
 * else 13, else 12, and a word too long even then is shortened with a geresh.
 * Never smaller.
 * The grid's text grows with the phone's text size to 1.3 and with the app's
 * own to 1.15, and the measure counts both.
 *
 * Wave 5 (W5-17):
 * - Once the week's school is over (Thursday after the last lesson, and to
 *   Saturday) the tab opens on next week (`opensOnNextWeek`, Itai). A link,
 *   or a week paged to, wins; tapping the tab again goes back to automatic.
 * - Tapping a day in the grid scrolls to its detail (Daniel: the colour
 *   changed and nothing else seemed to happen).
 * - The day detail joins lessons in a row as "היום שלי" does ("1–2 אנגלית",
 *   `dayEntries`), and names the homework due.
 * - At "גדול מאוד" (the phone's size times the app's at 1.3 or more) the week
 *   is a list of days, every lesson whole, instead of a grid of short forms
 *   that stayed small (`weekListMode`, Daniel).
 *
 * Run 5 (Noa), in the grid and the list alike:
 * - Homework turned into a task still counts as due (`hasHomeworkDue`): the
 *   day view leaves it out once the task stands for it (R-5).
 * - The title ends on the last day shown (`shownWeekEnd`), not on a Friday
 *   left out. A left-out Friday with a school event — the class trip — gets a
 *   strip under the grid, or after the list's last day, that opens the day
 *   (`weekShown`). The day detail lists the school's events, and calls a
 *   Friday without lessons a day without school, as "היום שלי" does.
 *
 * Wave 6 (W6-5, Daniel: "I don't need to solve a puzzle to know what I have
 * third period"):
 * - Each cell is washed in its subject's colour (`useSubjectColor`,
 *   `subjectCellColors`); the name is written on it in the text's colour.
 * - Each subject is written whole when its name fits its column, and only
 *   the others take a short form (`gridLabels`).
 * - A changed cell says what happened on a second line ("מ״מ", "הועבר"), and
 *   a cancelled one shows ⊘ beside "בוטל" (`cellStatusLine`): not colour alone.
 * - The legend draws small cells, in the body's size.
 * - A week without lessons says why inside the grid: "חופשת סוכות · אין
 *   לימודים השבוע" (`emptyWeek`).
 * - A line says when the week is a list because the text is large (Daniel).
 * - "4 שינויים" under the grid opens the day's changes, as on "היום שלי".
 *
 * Run 7 (Noa): homework due puts the square in its day's header, and a
 * Friday left out of the grid with work due gets a strip, as one with a
 * school event does. (Classroom work counted too; the phone reads no
 * Classroom, plan 2f.)
 *
 * Wave 9 (plan §16, the notebook):
 * - The title is the week's range in the display face, "שבוע הבא" its
 *   subtitle; the line "הלימודים השבוע נגמרו, אז מוצג השבוע הבא" is gone.
 *   Run 8 (two testers thought their week was skipped): when the tab opens on next
 *   week by itself, the subtitle says why, "שבוע הבא. השבוע נגמר".
 *   Previous, this week and next are text buttons with chevrons, not pills.
 * - The grid stays dense, on the page rather than in a card: each cell is its
 *   subject's colour as a soft fill over the page, radius 6, no border; a
 *   cancelled lesson is struck in the red pen on its pink tint, a changed one
 *   on the change's highlighter, an exam's tag on the exam's. Only a cell
 *   filled in from the fixed timetable keeps an edge, dashed: that is its sign.
 *   Every size the labels are measured with (`WEEK_GRID`) is unchanged.
 * - The key is `Legend` (MonthCalendar), the same shapes Planning's key uses.
 * - A left-out Friday is a ruled row with its day and date in the margin,
 *   and the school's own words, punctuation and all, as its title.
 * - The chosen day under the grid is a heading and ruled rows in a
 *   `MarginList` (the timeline's rows are Today's, drawn as margin rows).
 *   Its "להגשה" line is homework's amber square and plain words, as in the
 *   key, not a change's tint; a run of cancelled lessons says what the gap
 *   means ("חופשי מ־10:30"), as on "היום שלי".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions, type TextStyle,
} from 'react-native';
import { useFocusEffect, type CompositeNavigationProp, type RouteProp } from '@react-navigation/native';
import type { MaterialTopTabNavigationProp } from '@react-navigation/material-top-tabs';
import type { DayView, Exam, Lesson, SchoolEvent, Task } from '@sederyom/shared';
import { useSettings, useSyncNow, useWeek } from '../api/hooks';
import { AppIcon } from '../components/AppIcon';
import { ChangesSheet } from '../components/ChangesSheet';
import { ComposeTaskSheet } from '../components/ComposeTaskSheet';
import { ExamSheet } from '../components/ExamSheet';
import { LessonSheet } from '../components/LessonSheet';
import { Legend, MarkShape, markColor, type LegendKind } from '../components/MonthCalendar';
import { Mark, MarginList, MarginRow, SectionHeading, markFill, markInk, useFabListClearance } from '../components/notebook';
import { TabHeader } from '../components/TabHeader';
import { ChildSwitcher } from '../components/ChildSwitcher';
import { CancelledRunRow, EventRow, LessonRow, useOpenRuns } from '../components/timeline';
import { DueMargin, TaskRow, useSheetPressGuard, useTaskToggle } from '../components/TaskRow';
import { Chip, ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette, useScheme, useTextScale } from '../components/ui';
import { movedMark } from '../lib/examDate';
import { formatShortDate, isolateRanges, plural, todayStr } from '../lib/format';
import { lessonTaskTitle } from '../lib/planner';
import {
  CELL_ICON, CELL_STATUS_SIZE, HOUR_TIME_SIZE, PROJECTED_LABEL, WEEK_GRID, WEEK_LIST_NOTE, cellStatusLine,
  dayLetter, dayTitleParts, emptyWeek, examTag, examTagMore, gridFontScale, gridLabels, gridTextWidth, hasHomeworkDue,
  homeworkDueLabel, hourColumnWidth, nextLessonTaskLabel, opensOnNextWeek, periodStartTimes, projectedNote, shownWeekEnd, subjectCellColors,
  timelineInOrder, weekBounds, weekHeading, weekListMode, weekOffsetOf, weekShown, type EmptyWeek, type HiddenDayStrip,
} from '../lib/planning';
import { changedLessons, changesLabel, dayEntries, expandRuns, nextLessonDate, noSchoolDay } from '../lib/today';
import { useSubjectColor } from '../lib/useSubjectColor';
import { isWithoutSite } from '../local/schoolSite';
import { storage } from '../widget/feedCache';
import { font, radius, space, statusStyle, type } from '../theme';
import type { RootNavigation, TabsParamList } from '../navigation/types';

type WeekNavigation = CompositeNavigationProp<MaterialTopTabNavigationProp<TabsParamList, 'Week'>, RootNavigation>;

/** The left-to-right isolates `Ltr` uses, for a title that has to be a plain string. */
const LRI = '⁦';
const PDI = '⁩';
/**
 * A right-to-left mark before the title: the dates inside the isolates do
 * not count when the line picks its direction, so a title of dates alone
 * read as left to right and sat on the left (Daniel, run 3).
 */
const RLM = String.fromCharCode(0x200f);

/** A lesson open in the sheet, with whether its day is filled in from the fixed timetable. */
interface OpenLesson {
  lesson: Lesson;
  /** The periods of a joined card ("1–2 אנגלית"), `lesson` first; the sheet's time row spans them. */
  block?: Lesson[];
  projected: boolean;
}

/** Minutes since midnight, on the phone's clock. */
function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** A new task from "משימה לשיעור הבא": its date and the title it starts with. */
interface NewTask {
  date: string | null;
  title: string | null;
}

export function WeekScreen({ navigation, route }: { navigation: WeekNavigation; route: RouteProp<TabsParamList, 'Week'> }): React.JSX.Element {
  const p = usePalette();
  const paramDate = route.params?.date;
  // The week the student chose (a link, the arrows); `null` lets the screen pick (W5-17).
  const [chosen, setChosen] = useState<number | null>(() => (paramDate ? weekOffsetOf(paramDate, todayStr()) : null));
  const [selected, setSelected] = useState<string | null>(paramDate ?? null);
  // The lesson stays after the sheet closes, so the sheet does not empty while it slides away.
  const [open, setOpen] = useState<OpenLesson | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [exam, setExam] = useState<Exam | null>(null);
  const [compose, setCompose] = useState<NewTask | null>(null);
  // The day whose "4 שינויים" chip was tapped: its changes sheet, as on "היום שלי" (Daniel, run 5).
  const [changesDay, setChangesDay] = useState<DayView | null>(null);
  const changed = useMemo(() => (changesDay ? changedLessons(changesDay.timeline) : []), [changesDay]);
  // The clock the automatic week reads, taken each time the tab comes into view.
  const [now, setNow] = useState(() => new Date());
  // This week, to tell whether its school is over; the same query as the grid's while it shows this week.
  const current = useWeek(0);
  const auto = opensOnNextWeek(current.data?.days ?? null, todayStr(now), minutesOfDay(now)) ? 1 : 0;
  const offset = chosen ?? auto;
  const week = useWeek(offset);
  // The next week too, for "משימה לשיעור הבא" from the week's last lessons — and it makes "שבוע הבא" instant.
  const nextWeek = useWeek(offset + 1);
  const settings = useSettings();
  const sync = useSyncNow();
  const onToggleTask = useTaskToggle();
  const press = useSheetPressGuard();
  const { fontScale } = useWindowDimensions();
  const listMode = weekListMode(fontScale, useTextScale());
  // Room under the last row for a toast after a tick (R-30), at the text size in use.
  const clearance = useFabListClearance();

  // Scrolling to the day detail when a day is tapped in the grid (W5-17). The
  // detail's top does not move with the day shown (the grid above it stays),
  // so the scroll can start with the tap; before the first layout, the
  // detail's `onLayout` does it. In the list each day has its own place
  // (`listY`): a day a strip opens is drawn only then, and its `onLayout` scrolls.
  const scrollRef = useRef<ScrollView>(null);
  const detailY = useRef<number | null>(null);
  const listY = useRef(new Map<string, number>());
  const scrollToDetail = useRef(false);
  const revealDetail = useCallback(() => {
    if (!scrollToDetail.current || detailY.current === null) return;
    scrollToDetail.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, detailY.current - space.sm), animated: true });
  }, []);
  const pickDay = useCallback((date: string) => {
    scrollToDetail.current = true;
    if (listMode) detailY.current = listY.current.get(date) ?? null;
    setSelected(date);
    revealDetail();
  }, [revealDetail, listMode]);

  useFocusEffect(useCallback(() => setNow(new Date()), []));

  // A deep link (a push about a change, a row in the notification log) opens
  // the week that holds its day, with that day selected. The param is applied
  // once on focus and then cleared, like Today and School do: the same date
  // sent again after paging away is a new param, so it lands again.
  useFocusEffect(
    useCallback(() => {
      if (!paramDate) return;
      setChosen(weekOffsetOf(paramDate, todayStr()));
      setSelected(paramDate);
      navigation.setParams({ date: undefined });
    }, [paramDate, navigation]),
  );

  // Tapping the tab while on it: back to the week the screen picks, as on Today.
  useEffect(() => navigation.addListener('tabPress', () => {
    if (!navigation.isFocused()) return;
    setNow(new Date());
    setChosen(null);
    setSelected(null);
  }), [navigation]);

  // A lesson tapped in the grid or in the day under it: its details, and its
  // day underneath for when the sheet closes (R-27). A joined card brings its periods.
  const openLesson = useCallback((lesson: Lesson, day: DayView, block?: Lesson[]) => {
    setSelected(day.date);
    setOpen({ lesson, block, projected: day.projected });
    setSheetVisible(true);
  }, []);

  const view = week.data;
  const today = todayStr();
  const selectedDay = useMemo<DayView | null>(() => {
    if (!view) return null;
    return view.days.find((d) => d.date === selected) ?? view.days.find((d) => d.date === today) ?? view.days[0] ?? null;
  }, [view, selected, today]);

  // "משימה לשיעור הבא": the next day the open lesson's subject is taught, in this week or the next.
  const nextLesson = useMemo(
    () => (open ? nextLessonDate(open.lesson, open.lesson.date, [...(view?.days ?? []), ...(nextWeek.data?.days ?? [])]) : null),
    [open, view, nextWeek.data],
  );
  const addTask = open && nextLesson ? {
    label: nextLessonTaskLabel(nextLesson, today),
    onPress: () => {
      setSheetVisible(false);
      setCompose({ date: nextLesson, title: lessonTaskTitle(open.lesson) });
    },
  } : null;

  // A chosen Friday stays in the grid; the default day (today) does not bring an empty one back.
  // A Friday left out that has a school event — the class trip — or work due is a strip under
  // the grid (Noa, runs 5 and 7); opened, it stays one in the grid and takes its place in the list.
  // `?? []`: a server older than the contract sends no events.
  const shown = view ? weekShown(view.days, selected, view.schoolEvents ?? [], listMode) : null;
  const gridDays = shown?.days ?? [];
  const strips = shown?.strips ?? [];
  // Until the week arrives, name it from the device's own calendar. Then the title ends on
  // the last day shown, not on a Friday left out of the grid (Noa, run 5: "11–16.10" over א׳–ה׳).
  const bounds = view ?? weekBounds(offset, today);
  // Opened on next week by itself (this week's school is over): the subtitle says why (run 8).
  const heading = weekHeading(offset, bounds.startDate, shownWeekEnd(gridDays, bounds.endDate), view?.days, chosen === null && auto === 1);
  const go = (to: number) => { setChosen(to); setSelected(null); };

  const header = (
    <>
      <TabHeader buddies title={`${RLM}${LRI}${heading.title}${PDI}`} subtitle={heading.subtitle} />
      <ChildSwitcher />
      <View style={[styles.navBar, { borderBottomColor: p.border }]}>
        {/* RTL: "previous" sits on the right and points right, matching the site's own arrows. */}
        <Pressable accessibilityRole="button" onPress={() => go(offset - 1)} style={styles.navButton}>
          <AppIcon name="chevronRight" color={p.accent} size={18} />
          <Text style={[styles.navLabel, { color: p.accent }]}>שבוע קודם</Text>
        </Pressable>
        {offset !== 0 ? (
          // A text button between the two arrows, not a pill (plan §16.1).
          <Pressable
            accessibilityRole="button"
            onPress={() => go(0)}
            style={({ pressed }) => [styles.nowButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.navLabel, { color: p.accent, textAlign: 'center' }]}>לשבוע הנוכחי</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => go(offset + 1)} style={styles.navButton}>
          <Text style={[styles.navLabel, { color: p.accent }]}>שבוע הבא</Text>
          <AppIcon name="chevronLeft" color={p.accent} size={18} />
        </Pressable>
      </View>
    </>
  );

  if (week.isLoading) return <Screen>{header}<Loading /></Screen>;
  if (week.isError || !view) {
    return (
      <Screen>
        {header}
        <ErrorState message={(week.error as Error | undefined)?.message ?? 'שגיאה'} onRetry={() => void week.refetch()} />
      </Screen>
    );
  }

  const projected = view.days.some((d) => d.projected);
  // Without a site every week is projected, and no site is waited for (plan Phase 3).
  const projectedLine = projectedNote(isWithoutSite(storage));
  const homeworkDue = gridDays.some((d) => hasHomeworkDue(d));
  // A week without a lesson: a holiday ("חופשת סוכות · אין לימודים השבוע") or no timetable yet (W6-5).
  const empty = emptyWeek(view.days);
  const dayHandlers = (day: DayView) => ({
    onToggleTask: press.guard(onToggleTask),
    onOpenLesson: press.guard((lesson: Lesson, block?: Lesson[]) => openLesson(lesson, day, block)),
    onOpenExam: press.guard((e: Exam) => setExam(e)),
    onOpenChanges: press.guard(() => setChangesDay(day)),
  });
  // The list in place of the grid says so (W6-5, Daniel: "the grid disappeared without a word").
  // The week the tab chose by itself says why in the subtitle, not in a line here (run 8).
  const notes = listMode ? [WEEK_LIST_NOTE] : [];

  return (
    <Screen>
      {header}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={<RefreshControl refreshing={sync.isPending} onRefresh={() => sync.mutate()} tintColor={p.accent} />}
      >
        {notes.map((note) => <Text key={note} style={[styles.topNote, { color: p.textMuted }]}>{note}</Text>)}
        {listMode ? (
          // At "גדול מאוד": every day in full, one under the other (W5-17).
          <>
            {empty ? <EmptyWeekNote empty={empty} /> : null}
            {projected ? <Text style={[styles.note, styles.listNote, { color: p.textMuted }]}>{projectedLine}</Text> : null}
            {gridDays.map((day, i) => (
              <View
                key={day.date}
                style={i > 0 ? [styles.listDay, { borderTopColor: p.border }] : null}
                onLayout={(e) => {
                  listY.current.set(day.date, e.nativeEvent.layout.y);
                  if (day.date !== selectedDay?.date) return;
                  detailY.current = e.nativeEvent.layout.y;
                  revealDetail();
                }}
              >
                <DayDetail day={day} isToday={day.date === today} first={i === 0} {...dayHandlers(day)} />
              </View>
            ))}
            {/* Where the left-out Friday would be: after the last day. */}
            {strips.length > 0 ? (
              <MarginList style={[styles.bleed, styles.stripAfterList, { borderTopColor: p.border }]}>
                {strips.map((strip) => <HiddenDayRow key={strip.date} strip={strip} onPress={pickDay} />)}
              </MarginList>
            ) : null}
          </>
        ) : (
          <>
            <Grid
              days={gridDays}
              times={periodStartTimes(view.days)}
              today={today}
              selected={selectedDay?.date ?? null}
              empty={empty}
              onSelect={pickDay}
              onOpenLesson={openLesson}
            />
            {strips.length > 0 ? (
              <MarginList style={[styles.bleed, styles.stripUnderGrid, { borderTopColor: p.border }]}>
                {strips.map((strip) => (
                  <HiddenDayRow key={strip.date} strip={strip} selected={strip.date === selectedDay?.date} onPress={pickDay} />
                ))}
              </MarginList>
            ) : null}

            {/* The key: the shapes Planning's key draws (the review: they changed between screens), at the
                size the grid draws them (W6-5, Daniel: "dots of a few pixels"). A week without lessons has
                nothing in its cells to explain. */}
            {!empty || homeworkDue ? <Legend items={legendItems(!empty, homeworkDue, projected)} /> : null}
            {projected ? <Text style={[styles.note, { color: p.textMuted }]}>{projectedLine}</Text> : null}

            {selectedDay ? (
              <View
                onLayout={(e) => {
                  detailY.current = e.nativeEvent.layout.y;
                  revealDetail();
                }}
              >
                <DayDetail day={selectedDay} isToday={selectedDay.date === today} {...dayHandlers(selectedDay)} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <LessonSheet
        visible={sheetVisible}
        lesson={open?.lesson ?? null}
        lessons={open?.block}
        projected={open?.projected ?? false}
        classId={settings.data?.settings.classId ?? null}
        addTask={addTask}
        onClose={() => {
          setSheetVisible(false);
          press.sheetClosed();
        }}
      />
      <ExamSheet
        exam={exam}
        onClose={() => {
          setExam(null);
          press.sheetClosed();
        }}
      />
      <ChangesSheet
        visible={changesDay !== null}
        lessons={changed}
        classId={settings.data?.settings.classId ?? null}
        projected={changesDay?.projected ?? false}
        onClose={() => {
          setChangesDay(null);
          press.sheetClosed();
        }}
      />
      {/* Mounted only while open: it loads the task lists while mounted. */}
      {compose ? (
        <ComposeTaskSheet
          initialDate={compose.date}
          initialTitle={compose.title}
          onClose={() => {
            setCompose(null);
            press.sheetClosed();
          }}
        />
      ) : null}
    </Screen>
  );
}

function lessonsOf(day: DayView): Lesson[] {
  return day.timeline.flatMap((i) => (i.kind === 'lesson' ? [i.lesson] : []));
}

/**
 * Text inside the grid: one line, and no larger than `WEEK_GRID.maxFontScale`
 * times its size however large the phone's text is, and `maxAppScale` times
 * however large the app's — the columns hold one short word each, and the
 * labels were measured for that.
 */
function GridText({ children, style }: { children: React.ReactNode; style: TextStyle }): React.JSX.Element {
  return (
    <Text numberOfLines={1} maxScale={WEEK_GRID.maxAppScale} maxFontSizeMultiplier={WEEK_GRID.maxFontScale} style={style}>
      {children}
    </Text>
  );
}

function Grid({
  days, times, today, selected, empty, onSelect, onOpenLesson,
}: {
  days: DayView[];
  /** When each period starts, by period number (`periodStartTimes`). */
  times: Readonly<Record<number, string>>;
  today: string;
  selected: string | null;
  /** A week without lessons: its days stay on top, and this says why in place of the periods (`emptyWeek`). */
  empty: EmptyWeek | null;
  onSelect: (date: string) => void;
  onOpenLesson: (lesson: Lesson, day: DayView) => void;
}): React.JSX.Element {
  const p = usePalette();
  const scheme = useScheme();
  const colorOf = useSubjectColor();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const appScale = useTextScale();
  const byDay = days.map(lessonsOf);
  const maxHour = Math.max(8, ...byDay.flat().map((l) => l.hourIndex));
  const minHour = Math.min(1, ...byDay.flat().map((l) => l.hourIndex));
  const hours = Array.from({ length: maxHour - minHour + 1 }, (_v, i) => minHour + i);
  const tags = days.map((d) => examTag(d.examsToday));

  // The period column fits its times; the day columns share the rest, and
  // every label is chosen together so they all fit their column.
  const scale = gridFontScale(fontScale, appScale);
  const hourColumn = hourColumnWidth(hours.flatMap((h) => (times[h] ? [times[h]] : [])), scale);
  const width = gridTextWidth(windowWidth, days.length, hourColumn);
  // A name the student gave is written as typed, never in a short form (`gridLabels`' `own`); an exam named by its
  // subject's name goes by that name, as its lessons do.
  const examName = (e: Exam): string => e.subjectName ?? e.subject;
  const firstExams = days.flatMap((d) => d.examsToday.slice(0, 1));
  const own = new Set([
    ...byDay.flat().filter((l) => l.originalSubject !== undefined).map((l) => l.subject),
    ...firstExams.filter((e) => e.originalSubject !== undefined).map(examName),
  ]);
  const labels = gridLabels(byDay.flat().map((l) => l.subject), firstExams.map(examName), width, scale, own);
  const fontSize = labels.fontSize;
  const lineHeight = Math.round(fontSize * 1.35);

  return (
    // On the page, not in a card (plan §16.1); the border is in the measure (`WEEK_GRID.border`) and drawn clear.
    <View style={styles.grid}>
      <View style={styles.gridRow}>
        <View style={[styles.hourCell, { width: hourColumn }]} />
        {days.map((day, i) => {
          const isToday = day.date === today;
          const isSelected = day.date === selected;
          const tag = tags[i] ?? null;
          const more = tag ? examTagMore(tag, fontSize, width, scale) : null;
          // Homework due, or a task made from it (Noa, run 5: the square went once it was added to the tasks).
          const homework = hasHomeworkDue(day);
          const label = [
            `${day.weekdayName} ${formatShortDate(day.date)}`,
            tag?.label,
            homework ? 'יש הגשה' : null,
            day.projected ? PROJECTED_LABEL : null,
          ].filter(Boolean).join(', ');
          // On the exam's yellow highlighter (`markFill`, as every exam mark), in its ink, `onMark`.
          const tagText: TextStyle = { fontFamily: font.bodyMedium, fontSize, lineHeight, color: markInk('exam', p), textAlign: 'center' };
          return (
            <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(day.date)}
              // The chosen day is underlined in pen, as the day strip circles it. Not the yellow:
              // that is an exam's, and an empty Sunday read as an exam day (run 8).
              style={styles.dayHeader}
            >
              <GridText style={{ fontFamily: font.headingSemi, fontSize: type.small, color: isToday ? p.accent : p.textStrong }}>
                {dayLetter(day.date)}
              </GridText>
              <GridText style={{ fontFamily: font.headingMedium, fontSize: type.caption, color: isToday ? p.accent : isSelected ? p.text : p.textMuted, marginTop: 1 }}>
                {`${LRI}${formatShortDate(day.date)}${PDI}`}
              </GridText>
              <View style={[styles.dayChosen, { backgroundColor: isSelected ? p.accent : 'transparent' }]} />
              {homework ? (
                // Homework due that day (Itai): the planning tab's square, in the header's corner, the key's colour always.
                <View style={styles.homeworkMark}><MarkShape kind="homework" color={markColor('homework', p)} /></View>
              ) : null}
              {tag ? (
                // "מבחן" over the subject: two short lines fit a day column, one
                // line of "מבחן אנג׳" does not. A second exam is "+1" after
                // "מבחן", or on a line of its own when that is too wide. On the
                // exam's highlighter, no border.
                <View style={[styles.examTag, { backgroundColor: markFill('exam', p) }]}>
                  <GridText style={tagText}>
                    {'מבחן'}
                    {more?.more && more.inline ? ` ${LRI}${more.more}${PDI}` : ''}
                  </GridText>
                  <GridText style={{ ...tagText, fontFamily: font.bodySemi }}>
                    {labels.label(day.examsToday[0] ? examName(day.examsToday[0]) : tag.subject)}
                  </GridText>
                  {more?.more && !more.inline ? <GridText style={tagText}>{`${LRI}${more.more}${PDI}`}</GridText> : null}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {empty ? (
        // A holiday week: its days stay on top (each opens its day), and this in place of the empty periods.
        <View accessible accessibilityLabel={empty.text} style={[styles.emptyWeek, { borderTopColor: p.borderSoft }]}>
          <AppIcon name={empty.kind === 'holiday' ? 'calendar' : 'week'} color={p.textMuted} size={28} />
          <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text, textAlign: 'center' }}>{empty.text}</Text>
        </View>
      ) : hours.map((hour) => (
        <View key={hour} style={[styles.gridRow, { borderTopColor: p.borderSoft }]}>
          <View style={[styles.hourCell, { width: hourColumn }]}>
            <GridText style={{ fontFamily: font.headingMedium, fontSize: type.caption, color: p.textStrong }}>{`${LRI}${hour}${PDI}`}</GridText>
            {times[hour] ? (
              <GridText style={{ fontFamily: font.bodyMedium, fontSize: HOUR_TIME_SIZE, color: p.textMuted }}>{`${LRI}${times[hour]}${PDI}`}</GridText>
            ) : null}
          </View>
          {days.map((day, i) => {
            const at = byDay[i]!.filter((l) => l.hourIndex === hour);
            const lesson = at[0];
            if (!lesson) return <View key={day.date} style={styles.cell} />;
            const s = statusStyle(lesson.status, p);
            const changed = lesson.status !== 'regular';
            const guess = day.projected && !changed;
            // The subject's colour as a soft wash over the page (W6-F, plan §16): the name is written on it
            // in the text's own colour. A changed lesson takes its status's highlighter instead.
            const tint = subjectCellColors(colorOf(lesson.originalSubject ?? lesson.subject), p.bg, scheme);
            // A changed lesson says what happened in a word, and a cancelled one shows ⊘ (W6-5): never colour alone.
            const status = changed ? cellStatusLine(s.label, s.strike, width, scale) : null;
            const label = [
              `${day.weekdayName}, שיעור ${hour}${times[hour] ? ` ב־${times[hour]}` : ''}: ${lesson.subject}`,
              s.label || null,
              at.length > 1 ? `ועוד ${at.length - 1}` : null,
              guess ? PROJECTED_LABEL : null,
            ].filter(Boolean).join(', ');
            return (
              <Pressable
                key={day.date}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint="פותח את פרטי השיעור"
                onPress={() => onOpenLesson(lesson, day)}
                style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.7 : 1 }]}
              >
                <View
                  style={[
                    styles.cellInner,
                    { backgroundColor: changed ? s.soft : tint.fill },
                    // Filled in from the fixed timetable: a dashed edge is its sign (R-29), the one edge a cell has.
                    guess ? [styles.cellGuess, { borderColor: p.textFaint }] : null,
                  ]}
                >
                  {/* Cancelled: struck in the red pen (written in it too, since Android strikes in the text's colour). */}
                  <GridText
                    style={{
                      fontFamily: font.bodyMedium,
                      fontSize,
                      color: s.strike ? p.cancel : guess ? p.textMuted : p.text,
                      textDecorationLine: s.strike ? 'line-through' : 'none',
                    }}
                  >
                    {labels.label(lesson.subject)}
                  </GridText>
                  {status ? (
                    <View style={styles.cellStatus}>
                      {status.icon ? <AppIcon name="cancel" color={s.color} size={CELL_ICON.size} /> : null}
                      {status.text ? (
                        <GridText style={{ fontFamily: font.bodySemi, fontSize: CELL_STATUS_SIZE, color: s.color }}>{status.text}</GridText>
                      ) : null}
                    </View>
                  ) : null}
                  {at.length > 1 ? (
                    <GridText style={{ fontFamily: font.bodyMedium, fontSize, color: p.textMuted }}>{`${LRI}+${at.length - 1}${PDI}`}</GridText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** A week without lessons, over the list of its days (`emptyWeek`): its icon and its words on the page. */
function EmptyWeekNote({ empty }: { empty: EmptyWeek }): React.JSX.Element {
  const p = usePalette();
  return (
    <View accessible accessibilityLabel={empty.text} style={styles.emptyWeekList}>
      <AppIcon name={empty.kind === 'holiday' ? 'calendar' : 'week'} color={p.textMuted} size={24} />
      <Text style={{ flex: 1, fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{empty.text}</Text>
    </View>
  );
}

/**
 * The week's key (`Legend`): what its cells show, and the homework square and
 * the fixed timetable's dashed edge when the week has them.
 */
function legendItems(cells: boolean, homework: boolean, projected: boolean): { kind: LegendKind; label: string }[] {
  const items: { kind: LegendKind; label: string }[] = [];
  if (cells) items.push({ kind: 'change', label: 'שינוי' }, { kind: 'cancelled', label: 'בוטל' }, { kind: 'exam', label: 'מבחן' });
  if (homework) items.push({ kind: 'homework', label: 'הגשה' });
  if (projected) items.push({ kind: 'projected', label: PROJECTED_LABEL });
  return items;
}

/**
 * One day in full: its exams, changes and homework due as marks, then its
 * rows in time order as "היום שלי" draws them (W5-17, Daniel) — lessons of
 * one subject in a row as one row ("1–2 אנגלית"), cancelled ones in a row
 * folded into one line, an event in school hours as a quiet line — and its
 * tasks last, all ruled rows of one `MarginList` under the day's heading.
 */
function DayDetail({
  day, isToday, first = true, onToggleTask, onOpenLesson, onOpenExam, onOpenChanges,
}: {
  day: DayView;
  isToday: boolean;
  /** The top day: under the grid, or first in the list. A later day in the list sits closer. */
  first?: boolean;
  onToggleTask: (task: Task) => void;
  onOpenLesson: (lesson: Lesson, block?: Lesson[]) => void;
  onOpenExam: (exam: Exam) => void;
  /** The day's changes, in the sheet "היום שלי" opens from the same chip. */
  onOpenChanges: () => void;
}): React.JSX.Element {
  const p = usePalette();
  // The subject's colour as a dot before each lesson's name, as on "היום שלי" (W6-F).
  const colorOf = useSubjectColor();
  // A cancelled run opened shows its lessons among the day's rows by the clock (run 8, `expandRuns`).
  const runs = useOpenRuns(day.date);
  const rows = timelineInOrder(day.timeline);
  const lessonCount = rows.filter((r) => r.kind === 'lesson').length;
  const entries = expandRuns(dayEntries(rows.filter((r) => r.kind !== 'task'), day.date), runs.open);
  const tasks = rows.flatMap((r) => (r.kind === 'task' ? [r.task] : []));
  const title = dayTitleParts(day.date);
  const due = homeworkDueLabel(day);
  // `?? []`: a server older than the contract sends none.
  const events = day.events ?? [];
  // A Friday without lessons is a day without school, as on "היום שלי" — not one whose timetable is late.
  const noSchool = day.isSchoolDay ? noSchoolDay(day, lessonCount) : null;

  return (
    <View style={first ? styles.detail : styles.detailNext}>
      {/* "יום ראשון, 11.10.2026", and "היום" at the heading's end: a comma, no "·" (plan §16.2). */}
      <SectionHeading end={isToday ? <Text style={[styles.todayWord, { color: p.accent }]}>היום</Text> : undefined}>
        {title.name}
        {', '}
        <Ltr>{title.date}</Ltr>
      </SectionHeading>
      {day.changeCount > 0 || day.examsToday.length > 0 || day.projected || due ? (
        <View style={styles.chips}>
          {day.changeCount > 0 ? (
            // Opens the day's changes, as the same chip does on "היום שלי" (Daniel, run 5: tapped twice, nothing).
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={changesLabel(day.changeCount, day.date, todayStr())}
              accessibilityHint="פותח את רשימת השינויים"
              onPress={onOpenChanges}
              style={({ pressed }) => [styles.chipControl, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Chip label={plural(day.changeCount, 'שינוי אחד', 'שינויים')} color={p.change} soft={p.changeSoft} border={p.changeBorder} />
            </Pressable>
          ) : null}
          {due ? (
            // Homework's own look, as in the key and the day's header: the amber square and plain
            // words. Not a change's tint and dot: nothing changed.
            <View style={styles.dueLine}>
              <MarkShape kind="homework" color={markColor('homework', p)} />
              <Text style={[styles.dueText, { color: p.text }]}>{isolateRanges(due)}</Text>
            </View>
          ) : null}
          {day.examsToday.map((e) => {
            // "הוזז אצלך" beside an exam the person moved to this day, on this phone (V-6). The grid's tag has no room for it.
            const moved = movedMark(e);
            return (
              // An exam opens its details: when, what, the teacher's material (Noa: the chip did nothing).
              <Pressable
                key={e.naturalKey}
                accessibilityRole="button"
                accessibilityLabel={moved ? `מבחן: ${e.subject}, ${moved}` : `מבחן: ${e.subject}`}
                accessibilityHint="פותח את פרטי המבחן"
                onPress={() => onOpenExam(e)}
                style={({ pressed }) => [styles.examChip, { opacity: pressed ? 0.7 : 1 }]}
              >
                {/* On the exam's yellow highlighter, as in the grid and the key (run 8). */}
                <Mark kind="exam" containerStyle={styles.examMark}>{`מבחן: ${isolateRanges(e.subject)}`}</Mark>
                {moved ? <Text style={[styles.movedText, { color: p.textMuted }]}>{moved}</Text> : null}
              </Pressable>
            );
          })}
          {day.projected ? <Chip label={PROJECTED_LABEL} dot={false} /> : null}
        </View>
      ) : null}

      {lessonCount === 0 ? (
        <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, paddingVertical: space.sm }}>
          {!day.isSchoolDay ? (day.holidayName ?? 'אין לימודים') : noSchool ? noSchool.title : 'אין עדיין מערכת ליום הזה'}
        </Text>
      ) : null}

      {events.length > 0 || rows.length > 0 ? (
        // Ruled rows from edge to edge, with the red margin line; the day's school events first
        // (the trip a strip under the grid opens, Noa, run 5).
        <MarginList style={[styles.dayList, { borderTopColor: p.border }]}>
          {events.map((e) => <SchoolEventRow key={e.naturalKey} event={e} />)}
          {entries.map((entry, i) => {
            if (entry.kind === 'lessons') {
              return (
                <LessonRow
                  key={entry.key}
                  lesson={entry.lessons[0]!}
                  block={entry.lessons}
                  compact
                  subjectColor={colorOf(entry.lessons[0]!.originalSubject ?? entry.lessons[0]!.subject)}
                  onPress={onOpenLesson}
                />
              );
            }
            if (entry.kind === 'cancelledRun') {
              return (
                <CancelledRunRow
                  key={`${day.date}-${entry.key}`}
                  lessons={entry.lessons}
                  label={entry.label}
                  free={entry.free}
                  open={runs.open.has(entry.key)}
                  onToggle={() => runs.toggle(entry.key)}
                />
              );
            }
            if (entry.kind !== 'item') return null;
            const { item } = entry;
            if (item.kind === 'lesson') {
              return (
                <LessonRow
                  key={`l-${item.lesson.hourIndex}-${i}`}
                  lesson={item.lesson}
                  compact
                  subjectColor={colorOf(item.lesson.originalSubject ?? item.lesson.subject)}
                  onPress={onOpenLesson}
                />
              );
            }
            if (item.kind === 'event') {
              return <EventRow key={`e-${item.event.calendarId}-${item.event.id}`} event={item.event} slim={entry.slim} />;
            }
            return null;
          })}
          {/* The day is the heading: a task's margin stays empty. */}
          {tasks.map((task) => <TaskRow key={`t-${task.id}`} task={task} onToggle={onToggleTask} margin={null} />)}
        </MarginList>
      ) : null}
    </View>
  );
}

/**
 * A day the grid leaves out that has a school event (Noa, run 5), under the
 * grid or after the list's last day; or work due (run 7). A ruled row: the
 * day and date in its margin ("שישי" over "16.10"), the school's titles as
 * they wrote them ("טיול שנתי — שכבת י״ב"), and what is due under them.
 * Tapping it opens the day, as tapping a day in the grid does: under the grid
 * the row stays, in the pen like a chosen day's header, and the
 * day is shown in full below; in the list the day takes its place
 * (`weekShown`).
 */
function HiddenDayRow({
  strip, selected = false, onPress,
}: {
  strip: HiddenDayStrip;
  selected?: boolean;
  onPress: (date: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const hasTitles = strip.titles.length > 0;
  const title = hasTitles ? strip.titles.join(', ') : strip.due ?? '';
  return (
    <MarginRow
      // Chosen: in the pen, as a chosen day's header is underlined in it; the yellow is an exam's (run 8).
      margin={<DueMargin text={strip.weekday} note={strip.shortDate} color={selected ? p.accent : undefined} />}
      title={isolateRanges(title)}
      titleStyle={selected ? { color: p.accent } : undefined}
      subtitle={hasTitles && strip.due ? isolateRanges(strip.due) : undefined}
      chevron
      accessibilityRole="button"
      accessibilityLabel={strip.label}
      accessibilityHint="פותח את היום"
      accessibilityState={{ selected }}
      onPress={() => onPress(strip.date)}
    />
  );
}

/**
 * A school event in the day detail — a trip, a ceremony: its title, and
 * "אירוע בית ספר" with its details muted under it, as in planning.
 */
function SchoolEventRow({ event }: { event: SchoolEvent }): React.JSX.Element {
  const details = event.details?.trim() || null;
  return (
    <MarginRow
      margin={null}
      title={isolateRanges(event.title)}
      subtitle={details ? `${SCHOOL_EVENT_KIND}, ${isolateRanges(details)}` : SCHOOL_EVENT_KIND}
      accessible
      accessibilityLabel={[event.title, details].filter(Boolean).join('. ')}
    />
  );
}

/** A school event's kind, in words under its title. */
const SCHOOL_EVENT_KIND = 'אירוע בית ספר';

/** How far a ruled list reaches past the content's side padding and the day's, to the screen's edges. */
const BLEED = WEEK_GRID.sidePadding + space.xs;

// The horizontal sizes below add up to `WEEK_GRID`, which the labels are measured against.
const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
  },
  navButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 4, minHeight: MIN_TOUCH },
  navLabel: { fontFamily: font.bodySemi, fontSize: type.label },
  // It shows on Thursday evening to Saturday too (W5-17): at the largest text the three do not fit
  // a 360-point row, so this one gives way and its words wrap.
  nowButton: { flexShrink: 1, minHeight: MIN_TOUCH, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: WEEK_GRID.sidePadding, paddingTop: space.lg },
  // The border is in the measure and drawn clear: the grid is on the page, not in a card.
  grid: { borderWidth: WEEK_GRID.border, borderColor: 'transparent', padding: WEEK_GRID.padding },
  gridRow: { flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: 'transparent' },
  // Its width is set from the times it holds (`hourColumnWidth`).
  hourCell: { alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  // Margin 1 + the tag's border 1 + its padding 1 = `WEEK_GRID.columnInset`.
  dayHeader: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 0,
    margin: 1,
    borderRadius: radius.sm,
  },
  homeworkMark: { position: 'absolute', top: 4, insetInlineEnd: 3 },
  // The chosen day's pen line under its date (run 8), as wide as a date; every day keeps its room, so none shifts.
  dayChosen: { width: 24, height: 3, borderRadius: 1.5, marginTop: 2 },
  // The day header's margin 1 + the tag's padding 2 = `WEEK_GRID.columnInset` (the tag has no border now).
  examTag: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderRadius: 6,
  },
  // Padding 1 + the inner padding 2 = `WEEK_GRID.columnInset` (no border). A cell opens its
  // lesson, so it is a full touch target.
  cell: { flex: 1, padding: 1, minHeight: MIN_TOUCH },
  cellInner: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  // The fixed timetable's dashed edge: border 1 + padding 1 keep the same inset.
  cellGuess: { borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 1 },
  // A changed cell's second line: ⊘ and "בוטל", or "מ״מ" (`cellStatusLine`). On its own line, so the
  // subject's line keeps the whole column the labels were measured for.
  cellStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: CELL_ICON.gap },
  // A week without lessons, in place of its periods (W6-5).
  emptyWeek: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg, borderTopWidth: 1 },
  emptyWeekList: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.xs, marginBottom: space.sm },
  note: { fontFamily: font.body, fontSize: type.small, textAlign: 'center', marginTop: space.sm },
  // A line over the week that says why it looks as it does (W6-5).
  topNote: { fontFamily: font.body, fontSize: type.small, textAlign: 'center', marginBottom: space.sm },
  listNote: { marginTop: 0, marginBottom: space.xs },
  // A later day in the list: a rule above it, and less room than under the grid.
  listDay: { marginTop: space.xl, borderTopWidth: 1 },
  detail: { marginTop: space.xl, paddingHorizontal: space.xs },
  detailNext: { marginTop: space.lg, paddingHorizontal: space.xs },
  todayWord: { fontFamily: font.bodySemi, fontSize: type.small },
  chips: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: -space.xs, flexWrap: 'wrap' },
  // The mark is about 22 points tall; the control around it reaches 44.
  // A moved exam's "הוזז אצלך" sits beside its mark, in the row's own line (`movedText`).
  // `alignContent` keeps the wrapped line in the control's middle on a phone, where it defaults to the top.
  examChip: { minHeight: MIN_TOUCH, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', columnGap: space.sm },
  // A mark hangs from the top by default; in this row it sits on the line's middle, beside "הוזז אצלך".
  examMark: { alignSelf: 'center' },
  // The changes chip's control: a single chip, centred in its 44 points.
  chipControl: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  movedText: { fontFamily: font.body, fontSize: type.small },
  // "להגשה: …": wraps under its square's line when the subjects run long.
  dueLine: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  dueText: { flexShrink: 1, fontFamily: font.bodyMedium, fontSize: type.small },
  // The day's ruled rows reach the screen's edges, past the content's and the day's padding.
  dayList: { marginHorizontal: -BLEED, marginTop: space.sm, borderTopWidth: 1 },
  // The left-out days' rows, likewise, from under the grid's own padding.
  bleed: { marginHorizontal: -WEEK_GRID.sidePadding, borderTopWidth: 1 },
  stripUnderGrid: { marginTop: space.md },
  stripAfterList: { marginTop: space.xl },
});
