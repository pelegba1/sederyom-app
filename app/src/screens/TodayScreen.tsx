/**
 * "היום שלי" (plans A1, R2, W4). Fixed at the top: the tab header and the
 * day stepper. Everything else is one ruled page that scrolls (Wave 9, plan
 * §16): the week strip; on today the "now" row, which sticks under the
 * stepper once the strip scrolls away, so the scroll to "now" never takes it
 * off the screen (R-8); what is late, what is due, what is due on the next
 * school day; the day's changes and the next exam, a row each; and the
 * timeline, "מהלך היום" — where a run of cancelled lessons is one row, lessons
 * of one subject in a row are one row, events are quiet lines, a "now" line
 * marks the time and what is over draws muted. Today opens scrolled to "now"
 * — unless something is overdue, which is what gets forgotten: then it stays
 * at the top, where that is.
 *
 * Wave 5: on a day without school it opens on the next school day, with a
 * line saying why and "להיום"; the stepper names that day ("יום ראשון"); the
 * "now" row ends in the word for what a tap does; a trip day folds its
 * lessons under the event; a line says when Mashov is not connected; the "+"
 * steps aside while reading down.
 *
 * V2 (run 5): "זה לא השיעור שלי" asks in the sheet before it hides a subject
 * from every day, and Today then says "הסתרת את פיזיקה" with "להחזיר" for the
 * rest of that day; with lessons hidden the day line never says "כל השיעורים
 * בוטלו"; on another day the exam row says its date, not a count.
 *
 * Wave 6: "רק בית ספר" beside "מהלך היום" folds the calendar's events into
 * one row, "3 אירועים ביומן"; study tasks ("ללמוד…") are apart from what is
 * handed in — their own section; the stepper's next school day has its date
 * ("ראשון 11.10"); the "now" row says "קפיצה לעכשיו"; the next exam leads
 * with its title, so it never reads "מבחן הבא: מבחן באנגלית".
 *
 * Wave 7: the next exam carries one number — the countdown on today, the date
 * on any other day, never a count from both. What is due on a day without
 * school before the next school day waits for it: on a Thursday Friday's task
 * is under "ליום ראשון להגשה" with its own date in the margin, and on Sunday
 * under "להגשה עד יום ראשון". The "+" comes back only after a row's worth
 * of scrolling up. A timetable change's notification opens the change.
 * (Classroom work joined these lists too; the phone reads no Classroom, plan 2f.)
 *
 * Wave 9 (plan §16): the page is a notebook. No cards and no pills: rows on
 * ruled lines (`Row`, `MarginRow` in components/notebook), the date or time
 * in the red margin, a box (`Checkbox`) at a row's start, right after the
 * margin, marks (`Mark`) for an exam or a change, and the "+ משימה" button
 * (`Fab`) at the end side, where it covers no box.
 *
 * The decisions (now/next, the day line, what is overdue, the timeline's
 * entries, days without school, the next school day, where today lands) live
 * in lib/today.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle,
} from 'react-native';
import { useFocusEffect, useIsFocused, type CompositeNavigationProp, type RouteProp } from '@react-navigation/native';
import type { MaterialTopTabNavigationProp } from '@react-navigation/material-top-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarEvent, DayView, HomeworkItem, Lesson, SchoolFeeds, Task, TasksResponse, TimelineItem, WeekView,
} from '@sederyom/shared';
import {
  keys, useCreateTask, useDay, useDeleteTask, useGoogleConnected, useHideEvent, useSaveSettings, useSetHomeworkDone, useSettings, useStatus,
  useSyncNow, useTodayLessonsApart, useTodaySchoolOnly, useUpdateTask,
} from '../api/hooks';
// Through the demo's switch, as every hook asks (`api/hooks.ts`): the phone's own answers
// gave the demo an empty task list, which the משימות tab then showed.
import { appApi as api } from '../demo/api';
import { isWithoutSite } from '../local/schoolSite';
import { storage } from '../widget/feedCache';
import { CalendarFoldRow, CancelledRunRow, FullDayEventRows, LessonRow, NowIndicator, PartsText, TimelineRow, useOpenRuns } from '../components/timeline';
import { DayStepper, WeekStrip } from '../components/DayPicker';
import { AppIcon } from '../components/AppIcon';
import { BuddyTodayLines } from '../components/BuddyTodayLines';
import { WrappedEntry } from '../components/WrappedEntry';
import { ChangesSheet } from '../components/ChangesSheet';
import { ComposeTaskSheet } from '../components/ComposeTaskSheet';
import { EventSheet } from '../components/EventSheet';
import { DetailRow, LessonSheet } from '../components/LessonSheet';
import { Checkbox, Fab, FilterChip, MarginList, MarginRow, Mark, Row, SectionHeading, useFabListClearance } from '../components/notebook';
import { DayLineRow, NowRow, type NowNextCardAction } from '../components/NowNextCard';
import { Sheet } from '../components/Sheet';
import { TabHeader } from '../components/TabHeader';
import { ChildSwitcher } from '../components/ChildSwitcher';
import { useToast } from '../components/Toast';
import { Button, EmptyState, ErrorState, Loading, Ltr, Screen, Text, touchSlop, usePalette } from '../components/ui';
import { isDemo } from '../demo/phone';
import {
  addDays, dayDateLabel, formatDate, formatShortDate, groupOf, isolateRanges, shortDateTime, shownSubject, timeOf, toDateStr, todayStr, weekdayName,
} from '../lib/format';
import { homeworkTaskBody, lessonTaskTitle, schoolListId, taskDueText } from '../lib/planner';
import { nextLessonTaskLabel } from '../lib/planning';
import { requestMashovRenew } from '../lib/mashovRenew';
import { canCopyToGoogle, mashovLink, setKeysShown } from '../lib/school';
import { movedMark } from '../lib/examDate';
import { changesTarget, takeTodayFocus } from '../lib/todayFocus';
import { useSubjectColor } from '../lib/useSubjectColor';
import {
  carriedDueParts, carryRange, changedLessons, changesDayWord, changesLabel, dayEntries, dayLine, dayMarks, daySummary, dueEntries, dueSectionTitle, entryIsPast, examStrip, expandRuns,
  fabAfterScroll, firstLessonStart, foldedLessonsLabel, fullDayEvent, fullDayNowNext, addHiddenNote, forgetHiddenKeys, hiddenFromSheetNotes, hiddenNoteText,
  homeworkDueParts, knownDay, landingDate, landingNote, lessonHideKeys, lessonsOf, mashovStrip, nextDayWord, nextDueTitle, nextShortcut, nextLessonDate,
  nextSchoolDay, nextStudyTitle, noSchoolDay, nowCardAction, nowEntryIndex, nowNext, openDueCount, overdueItems,
  partsText, studyEntries, studySectionTitle, todayHasSchool, weekdayDateParts, weekOffset,
  type DayEntry, type DueEntry, type HiddenFromSheet, type KnownDay, type NoSchool, type OverdueItem, type Part,
} from '../lib/today';
import { font, space, type } from '../theme';
import type { RootNavigation, TabsParamList } from '../navigation/types';

type TodayNavigation = CompositeNavigationProp<MaterialTopTabNavigationProp<TabsParamList, 'Today'>, RootNavigation>;

/**
 * The time, refreshed on every minute boundary while the screen is focused
 * and whenever the app comes back to the foreground.
 */
function useMinuteClock(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    const tick = (): void => setNow(new Date());
    tick();
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [active]);
  return now;
}

/** Where the scroll view's pieces are, each tagged with the date it was measured for. */
interface Measured {
  viewport: number;
  section: [string, number] | null;
  list: [string, number] | null;
  now: [string, number] | null;
}

/**
 * A scroll waiting for the timeline to be measured. 'auto' is landing on
 * today: "now", or the top when something is overdue. 'now' is "קפיצה
 * לעכשיו" tapped: "now", whatever else is on the day.
 */
type PendingScroll = 'auto' | 'now' | null;

/** The next school day's lists, on today (W4-1, Wave 7): what is handed in then, and what to study. */
interface NextLists {
  date: string;
  due: DueEntry[];
  study: Task[];
}

export function TodayScreen({ navigation, route }: { navigation: TodayNavigation; route: RouteProp<TabsParamList, 'Today'> }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const focused = useIsFocused();
  const now = useMinuteClock(focused);
  const today = todayStr(now);
  const [selectedDate, setSelectedDate] = useState(route.params?.date ?? today);
  const isToday = selectedDate === today;

  // ---- Sheets ---------------------------------------------------------------
  const [composeOpen, setComposeOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  // A new task's date when it is not the shown day: "משימה לשיעור הבא" from a lesson's sheet.
  const [composeDate, setComposeDate] = useState<string | null>(null);
  // A task for the next lesson starts with "שיעורי בית ב…" (T5's ComposeTaskSheet initialTitle).
  const [composeTitle, setComposeTitle] = useState<string | null>(null);
  // The lessons of the row that was tapped: one, or a block of the same subject ("1–3 פיזיקה").
  const [lessonBlock, setLessonBlock] = useState<Lesson[]>([]);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  // Kept after closing, like `lesson`, so the sheet does not empty while it slides away.
  const [homework, setHomework] = useState<HomeworkItem | null>(null);
  const [homeworkOpen, setHomeworkOpen] = useState(false);

  const day = useDay(selectedDate);
  const tomorrowDate = addDays(today, 1);
  const status = useStatus();
  const settings = useSettings();
  const sync = useSyncNow();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const hideEvent = useHideEvent();
  const setHomeworkDone = useSetHomeworkDone();
  const saveSettings = useSaveSettings();
  const queryClient = useQueryClient();
  // The hide list as it is now — read when "לבטל" is pressed, after the save came back.
  const hiddenNow = useRef<string[]>([]);
  hiddenNow.current = settings.data?.settings.lessons.hiddenSubjects ?? [];
  // Lessons are hidden, so the day views come without some of them: the day line then never says
  // "כל השיעורים בוטלו" (V2, Maya). Until the settings are in, the count — true either way.
  const hidesLessons = settings.data ? settings.data.settings.lessons.hiddenSubjects.length > 0 : true;
  // What "זה לא השיעור שלי" hid today, for the line that says so and brings it back (V2, Maya).
  // Kept here: the tab stays mounted, and the line is for the rest of the day only.
  const [hiddenFromSheet, setHiddenFromSheet] = useState<HiddenFromSheet[]>([]);
  const hiddenNotes = useMemo(
    () => hiddenFromSheetNotes(hiddenFromSheet, settings.data?.settings.lessons.hiddenSubjects ?? [], today),
    [hiddenFromSheet, settings.data, today],
  );

  // ---- What the day says ----------------------------------------------------
  const view = day.data && day.data.date === selectedDate ? day.data : undefined;
  const timeline = useMemo<TimelineItem[]>(() => view?.timeline ?? [], [view]);
  // A trip or a sports day takes the whole day (W5-3): its lessons fold away, and the day line
  // says nothing of a timetable that is not kept.
  const fullDay = view ? fullDayEvent(view) : null;
  const summary = useMemo(() => daySummary(fullDay ? [] : timeline), [fullDay, timeline]);
  const noSchool = view ? noSchoolDay(view, lessonsOf(timeline).length) : null;

  // The next school day after the shown one, from the week of the shown day and the next as the
  // server describes them: "ליום הלימודים הבא" on a day without school, and on today what is due
  // then and when it starts — Sunday's, on a Thursday (W4-1).
  const offset = weekOffset(selectedDate, today);
  // Also while a lesson's sheet is open: its "משימה לשיעור הבא" looks for the subject's next lesson there.
  const needWeeks = noSchool !== null || isToday || lessonOpen;
  // The shown week always: its days give the week strip its marks (W5-6).
  const thisWeek = useQuery<WeekView>({ queryKey: keys.week(offset), queryFn: () => api.week(offset) });
  const marks = useMemo(
    () => (thisWeek.data ? Object.fromEntries(thisWeek.data.days.map((d) => [d.date, dayMarks(d)])) : undefined),
    [thisWeek.data],
  );
  const nextWeek = useQuery<WeekView>({ queryKey: keys.week(offset + 1), queryFn: () => api.week(offset + 1), enabled: needWeeks });
  const upcoming = useMemo(() => {
    if (!thisWeek.data || !nextWeek.data) return null;
    return nextSchoolDay(selectedDate, [...thisWeek.data.days, ...nextWeek.data.days].map(knownDay));
  }, [thisWeek.data, nextWeek.data, selectedDate]);
  const nextDay = noSchool ? upcoming : null;
  // On today: that day, once known. Until the weeks are in nothing is said, so a Thursday never
  // flashes "מחר" before "ביום ראשון"; if they cannot load, tomorrow — as before W4-1.
  const weeksFailed = thisWeek.isError || nextWeek.isError;
  const nextDate = isToday ? (upcoming ?? (weeksFailed ? tomorrowDate : null)) : null;
  const nextQuery = useQuery<DayView>({
    queryKey: keys.day(nextDate ?? tomorrowDate),
    queryFn: () => api.day(nextDate ?? tomorrowDate),
    enabled: nextDate !== null,
  });
  const nextView = nextDate && nextQuery.data?.date === nextDate ? nextQuery.data : undefined;

  // ---- Where today lands, and the stepper's next school day (W5-2) -----------
  // This week and the next as seen from today, whatever day is shown — the same queries as above
  // on today, so they cost nothing more there. Today's own view joins them, so a school day
  // decides as soon as it is in, without waiting for the weeks.
  const homeWeek = useQuery<WeekView>({ queryKey: keys.week(0), queryFn: () => api.week(0) });
  const homeNextWeek = useQuery<WeekView>({ queryKey: keys.week(1), queryFn: () => api.week(1) });
  const homeKnown = useMemo<KnownDay[]>(() => {
    const days = [...(homeWeek.data?.days ?? []), ...(homeNextWeek.data?.days ?? [])].map(knownDay);
    const own = day.data?.date === today ? knownDay(day.data) : null;
    return own ? [own, ...days.filter((d) => d.date !== today)] : days;
  }, [homeWeek.data, homeNextWeek.data, day.data, today]);
  // The week views carry no Shabbat: on a Saturday only today's own view says it is not a school
  // day, so the landing waits for it too.
  const homeSettled = !homeWeek.isPending && !homeNextWeek.isPending && !day.isPending;
  const stepperNext = useMemo(() => nextShortcut(today, homeKnown), [today, homeKnown]);
  // Set by a landing on today (the tab, a tap on the tab, midnight) until it is decided; any day
  // picked by hand clears it. `landed` is the day it moved to instead, and why — the note on top.
  const [landing, setLanding] = useState(() => !route.params?.date);
  const [landed, setLanded] = useState<{ from: string; to: string; note: string } | null>(null);
  const landTo = landing && isToday ? landingDate(today, homeKnown, homeSettled) : null;
  // Until it is decided, a day without school is not drawn — it would flash before the move.
  const holding = landing && isToday && landTo !== today;

  // ---- What is due: the day's own, and what waits for the next school day (Wave 7) ----------
  // Friday's and Saturday's work waits for Sunday (Itai, run 6): on today it joins the list
  // "ליום ראשון להגשה", on Sunday its list — and today's too, when today has no school.
  const homeNext = useMemo(() => nextSchoolDay(today, homeKnown), [today, homeKnown]);
  const todayIsSchoolDay = todayHasSchool(today, homeKnown);
  const carryNext = isToday ? nextDate : homeNext;
  const carry = useMemo(
    () => carryRange(today, selectedDate, carryNext, todayIsSchoolDay),
    [today, selectedDate, carryNext, todayIsSchoolDay],
  );
  // "באיחור" draws on the whole homework feed and every task — on today only — and so does
  // what waits for the next school day. The tasks also give "להעתיק ל־Google Tasks" its "בית
  // ספר" list, so they load while a homework sheet is open on any day.
  const school = useQuery<SchoolFeeds>({ queryKey: keys.school, queryFn: api.school, enabled: isToday || carry !== null });
  const tasks = useQuery<TasksResponse>({ queryKey: keys.tasks, queryFn: () => api.tasks(), enabled: isToday || homeworkOpen || carry !== null });

  // "באיחור" by the task list's rule, so both screens give one number (run 7).
  const overdue = useMemo<OverdueItem[]>(
    () => (isToday ? overdueItems(school.data?.homework, tasks.data?.items, today) : []),
    [isToday, school.data, tasks.data, today],
  );
  // Settled, with data or with an error (Mashov or Google not connected).
  const overdueReady = !school.isPending && !tasks.isPending;
  // On today the carried days go to the next school day's list, not into today's own list.
  const dayCarry = isToday ? null : carry;
  const ownTasks = useMemo(() => timeline.flatMap((i) => (i.kind === 'task' ? [i.task] : [])), [timeline]);
  const dueList = useMemo<DueEntry[]>(
    () => (view
      ? dueEntries(view.date, { homework: view.homework ?? [], tasks: ownTasks }, {
        range: dayCarry, homework: school.data?.homework, tasks: tasks.data?.items,
      })
      : []),
    [view, ownTasks, dayCarry, school.data, tasks.data],
  );
  const studyList = useMemo(() => studyEntries(ownTasks, { range: dayCarry, tasks: tasks.data?.items }), [ownTasks, dayCarry, tasks.data]);
  // The day's lessons in one line (plan §16.2): "3 שיעורים, 4 בוטלו".
  const line = view && !noSchool ? dayLine(summary, hidesLessons) : null;
  // On today, the next school day's lists: "ליום ראשון להגשה" with what waits for it, then "ללמוד".
  const nextLists = useMemo<NextLists | null>(() => {
    if (!nextDate || !nextView) return null;
    const range = isToday ? carry : null;
    const own = nextView.timeline.flatMap((i) => (i.kind === 'task' ? [i.task] : []));
    const due = dueEntries(nextDate, { homework: nextView.homework ?? [], tasks: own }, {
      range, homework: school.data?.homework, tasks: tasks.data?.items,
    });
    return { date: nextDate, due, study: studyEntries(own, { range, tasks: tasks.data?.items }) };
  }, [nextDate, nextView, isToday, carry, school.data, tasks.data]);

  // ---- Scrolling to "now" -------------------------------------------------
  const scrollRef = useRef<ScrollView>(null);
  const measured = useRef<Measured>({ viewport: 0, section: null, list: null, now: null });
  const selectedRef = useRef(selectedDate);
  selectedRef.current = selectedDate;
  /** Set when the screen should scroll once the timeline is measured; cleared after one scroll. */
  const pendingScroll = useRef<PendingScroll>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether today's overdue lists are in, and how long they are — read by the landing scroll. */
  const overdueGate = useRef({ ready: false, count: 0 });
  overdueGate.current = { ready: overdueReady, count: overdue.length };

  const scheduleScroll = useCallback(() => {
    if (!pendingScroll.current) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    // Layout events arrive one by one; act on the last of a burst.
    scrollTimer.current = setTimeout(() => {
      const mode = pendingScroll.current;
      const date = selectedRef.current;
      const { viewport, section, list, now: nowRow } = measured.current;
      if (!mode || viewport <= 0 || date !== todayStr()) return;
      if (mode === 'auto') {
        const { ready, count } = overdueGate.current;
        // Tried again when the lists are in.
        if (!ready) return;
        if (count > 0) {
          // Stay at the top, where "באיחור" is (R-7); the "now" row says what is on now.
          pendingScroll.current = null;
          scrollRef.current?.scrollTo({ y: 0, animated: true });
          return;
        }
      }
      if (section?.[0] !== date || list?.[0] !== date || nowRow?.[0] !== date) return;
      pendingScroll.current = null;
      const y = section[1] + list[1] + nowRow[1];
      // In the upper part of the screen already: stay at the top, where the overview is.
      const target = y < viewport * 0.6 ? 0 : y - viewport * 0.3;
      scrollRef.current?.scrollTo({ y: Math.max(0, target), animated: true });
    }, 120);
  }, []);

  useEffect(() => () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

  useEffect(() => {
    scheduleScroll();
  }, [overdueReady, overdue.length, scheduleScroll]);

  // ---- The "+" and the fixed part's edge, as the page moves (W5-6) -----------
  const fabClearance = useFabListClearance();
  const [fabShown, setFabShown] = useState(true);
  const fabState = useRef({ shown: true, fromY: 0 });
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  // Where the sticky "now" row sits in the page, the week strip's bottom (null until measured), and
  // whether it is stuck. Measured on the strip: a sticky child's own onLayout never fires on the
  // phone (the sticky header drops it) and reads 0 inside the web's sticky wrapper.
  const stripEnd = useRef<number | null>(null);
  const [stuck, setStuck] = useState(false);
  const stuckRef = useRef(false);
  const setFab = useCallback((shown: boolean) => {
    if (fabState.current.shown === shown) return;
    fabState.current.shown = shown;
    setFabShown(shown);
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const y = contentOffset.y;
    const next = fabAfterScroll(fabState.current, { y, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height });
    // Measured from where the page last turned, so a slow drag adds up (`setFab` sets `shown`).
    fabState.current.fromY = next.fromY;
    setFab(next.shown);
    const isScrolled = y > 2;
    if (isScrolled !== scrolledRef.current) {
      scrolledRef.current = isScrolled;
      setScrolled(isScrolled);
    }
    // The "now" row is stuck once the page has scrolled past where it sits.
    const isStuck = stripEnd.current !== null && y > stripEnd.current + 1;
    if (isStuck !== stuckRef.current) {
      stuckRef.current = isStuck;
      setStuck(isStuck);
    }
  }, [setFab]);

  // A trip day has no "now" line to land on (W5-3): stay at the top, and never jump later when
  // the folded lessons are opened.
  const fullDayKey = fullDay?.naturalKey ?? null;
  useEffect(() => {
    if (fullDayKey) pendingScroll.current = null;
  }, [fullDayKey, selectedDate]);

  const measure = useCallback((key: 'section' | 'list' | 'now', date: string) => (e: LayoutChangeEvent) => {
    measured.current[key] = [date, e.nativeEvent.layout.y];
    scheduleScroll();
  }, [scheduleScroll]);

  /**
   * Shows `date`, exactly that day — a pick by hand, a push's `date`. On today it lands on "now"
   * once that is measured, elsewhere it starts at the top.
   */
  const changeDate = useCallback((date: string) => {
    if (date !== selectedRef.current) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      fabState.current.fromY = 0;
      setFab(true);
    }
    selectedRef.current = date;
    setSelectedDate(date);
    setLanding(false);
    setLanded(null);
    pendingScroll.current = date === todayStr() ? 'auto' : null;
    scheduleScroll();
  }, [scheduleScroll, setFab]);

  /** Opens on today — or, on a day without school, on the next school day once that is known (W5-2). */
  const landOnToday = useCallback(() => {
    changeDate(todayStr());
    setLanding(true);
  }, [changeDate]);

  // The landing decided: stay, or move to the next school day and say why.
  const todayHoliday = homeKnown.find((d) => d.date === today)?.holidayName ?? null;
  useEffect(() => {
    if (!landing || landTo === null) return;
    if (landTo === today) {
      setLanding(false);
      return;
    }
    changeDate(landTo);
    setLanded({ from: today, to: landTo, note: landingNote(today, landTo, todayHoliday) });
  }, [landing, landTo, today, todayHoliday, changeDate]);

  // Coming back to the tab lands on today, unless the visit carries a `date`
  // (a push, "למערכת של היום הזה"), which always wins. The param is consumed,
  // so the next return lands again; clearing it re-runs this effect once, which is skipped.
  const paramDate = route.params?.date;
  const consumedParam = useRef(false);
  // A timetable change's notification (Wave 7): the change to open once its day is in, fetched
  // after the tap (`at`), so a day cached from before the change never answers for it.
  const [focusChanges, setFocusChanges] = useState<{ date: string; at: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (paramDate) {
        consumedParam.current = true;
        changeDate(paramDate);
        if (takeTodayFocus(paramDate) === 'changes') {
          setFocusChanges({ date: paramDate, at: Date.now() });
          void queryClient.invalidateQueries({ queryKey: keys.day(paramDate) });
        }
        navigation.setParams({ date: undefined });
        return;
      }
      if (consumedParam.current) {
        consumedParam.current = false;
        return;
      }
      landOnToday();
      // `navigation` and `queryClient` are stable; `changeDate` and `landOnToday` too.
    }, [paramDate, changeDate, landOnToday, navigation, queryClient]),
  );

  // Tapping the tab while on it: back to today (or its next school day), back to "now".
  useEffect(() => navigation.addListener('tabPress', () => {
    if (navigation.isFocused()) landOnToday();
  }), [navigation, landOnToday]);

  // Past midnight with today on screen, follow the date.
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current !== today && selectedRef.current === lastToday.current) landOnToday();
    lastToday.current = today;
  }, [today, landOnToday]);

  const scrollToNow = useCallback(() => {
    pendingScroll.current = 'now';
    scheduleScroll();
  }, [scheduleScroll]);

  const openLesson = useCallback((l: Lesson, block?: Lesson[]) => {
    setLessonBlock(block && block.length > 0 ? block : [l]);
    setLessonOpen(true);
  }, []);
  const openEvent = useCallback((e: CalendarEvent) => {
    setEvent(e);
    setEventOpen(true);
  }, []);
  const openHomework = useCallback((h: HomeworkItem) => {
    setHomework(h);
    setHomeworkOpen(true);
  }, []);
  const openCompose = useCallback(() => {
    setEditTask(null);
    setComposeDate(null);
    setComposeOpen(true);
  }, []);
  const openEditTask = useCallback((t: Task) => {
    setEditTask(t);
    setComposeOpen(true);
  }, []);

  // ---- Actions --------------------------------------------------------------
  const onRefresh = useCallback(() => {
    sync.mutate(undefined, { onError: () => toast.show('לא הצלחנו לרענן עכשיו. אפשר לנסות שוב בעוד רגע') });
  }, [sync, toast]);

  const onToggleTask = useCallback((task: Task) => {
    const completed = !task.completed;
    updateTask.mutate({ id: task.id, body: { completed } }, { onError: () => toast.show('לא הצלחנו לעדכן את המשימה') });
    if (completed) {
      toast.show(`הושלמה: ${task.title}`, {
        onAction: () => updateTask.mutate({ id: task.id, body: { completed: false } }),
      });
    }
  }, [updateTask, toast]);

  /** The box (or the sheet's button): ticks the homework off for the student only — nothing goes to the teacher (R-6). */
  const onToggleHomework = useCallback((item: HomeworkItem) => {
    const done = !item.done;
    setHomeworkDone.mutate({ key: item.naturalKey, done }, { onError: () => toast.show('לא הצלחנו לסמן. אפשר לנסות שוב') });
    if (done) {
      toast.show('סומן אצלך. המורה לא רואה את זה.', {
        onAction: () => setHomeworkDone.mutate({ key: item.naturalKey, done: false }),
      });
    }
  }, [setHomeworkDone, toast]);

  /** "להעתיק ל־Google Tasks" (F16, W6-4): into "בית ספר" when there is such a list; the task then stands for the homework. */
  const onAddHomework = useCallback((item: HomeworkItem) => {
    createTask.mutate(homeworkTaskBody(item, schoolListId(tasks.data?.lists ?? [])), {
      onSuccess: (created) => {
        setHomeworkOpen(false);
        toast.show('נוסף למשימות', {
          onAction: () => deleteTask.mutate(created.id, {
            onError: () => toast.show('לא הצלחנו לבטל. אפשר למחוק את המשימה מהרשימה'),
          }),
        });
      },
      onError: () => toast.show('לא הצלחנו להוסיף למשימות. אפשר לנסות שוב'),
    });
  }, [createTask, deleteTask, tasks.data, toast]);

  /** Hide a calendar event: this occurrence, or the whole series. */
  const confirmHide = useCallback((e: CalendarEvent) => {
    const hide = (id: string): void => hideEvent.mutate(id, { onError: () => toast.show('לא הצלחנו להסתיר את האירוע') });
    Alert.alert(e.summary, 'להסתיר את האירוע מהאפליקציה? אפשר להחזיר אותו מההגדרות, ב״Google״, תחת ״יומן Google״.', [
      { text: 'ביטול', style: 'cancel' },
      ...(e.seriesId ? [{ text: 'את כל הסדרה', onPress: () => hide(e.seriesId!) }] : []),
      { text: e.seriesId ? 'רק את הפעם הזאת' : 'להסתיר', style: 'destructive' as const, onPress: () => hide(e.id) },
    ]);
  }, [hideEvent, toast]);

  // Mashov not connected gets its own line (W5-4), so the line for the other connections
  // never says the same thing a second time. A parent has no Mashov to connect, nor Google
  // (docs/parents-plan.md): neither line, only the class's site.
  const parent = settings.data?.settings.audience === 'parent';
  const mashov = parent ? null : mashovStrip(mashovLink(status.data?.sources));
  const degraded = useMemo(
    () => (status.data?.sources ?? []).filter((s) => s.configured && s.message !== null && !(s.source === 'mashov' && s.needsReauth)
      && !(parent && (s.source === 'mashov' || s.source.startsWith('google')))),
    [status.data, parent],
  );

  const nextStart = nextView?.isSchoolDay ? firstLessonStart(nextView.timeline) : null;
  const nowNextModel = !view || !isToday ? null
    : fullDay ? fullDayNowNext(fullDay)
      : nowNext(timeline, view.date, now, nextStart, nextDate ? nextDayWord(nextDate, today) : 'מחר');
  // What a tap on the "now" row does — said in words at its end, never a bare "⌄" (W5-6).
  const rowAction = view && isToday && !fullDay ? nowCardAction(timeline, view.date, now, nextDate) : null;
  const nowAction: NowNextCardAction | null = !rowAction ? null : rowAction.kind === 'now'
    ? { label: rowAction.label, hint: 'מגלגל אל השעה הנוכחית במהלך היום', onPress: scrollToNow }
    : {
      label: rowAction.label,
      hint: `מציג את ${rowAction.date === tomorrowDate ? 'מחר' : weekdayName(rowAction.date)}`,
      onPress: () => changeDate(rowAction.date),
    };
  const changed = useMemo(() => changedLessons(timeline), [timeline]);

  // The notification's change, opened once its day is in from after the tap: one changed lesson
  // opens its sheet, several the list of changes (Noa, Maya, run 6). Another day picked meanwhile
  // drops it; so does a day that could not load.
  const dayUpdatedAt = day.dataUpdatedAt;
  const dayErrorAt = day.errorUpdatedAt;
  useEffect(() => {
    if (!focusChanges) return;
    if (selectedDate !== focusChanges.date) {
      setFocusChanges(null);
      return;
    }
    const failed = dayErrorAt >= focusChanges.at;
    if (!view) {
      if (failed) setFocusChanges(null);
      return;
    }
    if (dayUpdatedAt < focusChanges.at && !failed) return;
    setFocusChanges(null);
    const target = changesTarget(changed);
    if (target?.kind === 'lesson') openLesson(target.lesson);
    else if (target?.kind === 'list') setChangesOpen(true);
  }, [focusChanges, selectedDate, view, dayUpdatedAt, dayErrorAt, changed, openLesson]);
  // The open lesson's subject, next time it is taught — in the weeks the screen has (W4, Itai).
  const sheetLesson = lessonBlock[0] ?? null;
  const nextLesson = useMemo(
    () => (sheetLesson
      ? nextLessonDate(sheetLesson, sheetLesson.date, [...(thisWeek.data?.days ?? []), ...(nextWeek.data?.days ?? [])])
      : null),
    [sheetLesson, thisWeek.data, nextWeek.data],
  );
  const addLessonTask = nextLesson ? {
    label: nextLessonTaskLabel(nextLesson, today),
    onPress: () => {
      setLessonOpen(false);
      setEditTask(null);
      setComposeDate(nextLesson);
      setComposeTitle(sheetLesson ? lessonTaskTitle(sheetLesson) : null);
      setComposeOpen(true);
    },
  } : null;
  // "זה לא השיעור שלי" (W5-5): every key of the lesson's row in "השיעורים שלי"; none, no button.
  const hideKeys = useMemo(
    () => (sheetLesson && settings.data ? lessonHideKeys(sheetLesson, settings.data.subjects) : []),
    [sheetLesson, settings.data],
  );
  /** Puts back what one hide from the sheet added: "לבטל" on its toast, or "להחזיר" on its line. */
  const restoreHidden = useCallback((note: HiddenFromSheet, said: boolean) => {
    saveSettings.mutate({ lessons: { hiddenSubjects: setKeysShown(hiddenNow.current, note.keys, true) } }, {
      onSuccess: () => {
        setHiddenFromSheet((notes) => forgetHiddenKeys(notes, note.subject, note.keys));
        // "באיחור" reads the school feed, which comes without hidden subjects.
        void queryClient.invalidateQueries({ queryKey: keys.school });
        if (said) toast.show(`החזרנו את ${note.subject}`);
      },
      onError: () => toast.show('לא הצלחנו להחזיר. אפשר להחזיר ב״השיעורים שלי״'),
    });
  }, [saveSettings, queryClient, toast]);

  // Called once the sheet's question is answered "להסתיר" (V2): the whole row of "השיעורים שלי".
  const onNotMine = useCallback(() => {
    if (!sheetLesson) return;
    setLessonOpen(false);
    const before = hiddenNow.current;
    // "לבטל" and "להחזיר" bring back only what this hid — a key already hidden stays hidden.
    const added = hideKeys.filter((k) => !before.includes(k));
    if (added.length === 0) return;
    const note: HiddenFromSheet = { subject: shownSubject(sheetLesson), keys: added, date: today };
    saveSettings.mutate({ lessons: { hiddenSubjects: setKeysShown(before, hideKeys, false) } }, {
      onSuccess: () => {
        setHiddenFromSheet((notes) => addHiddenNote(notes, note));
        void queryClient.invalidateQueries({ queryKey: keys.school });
        toast.show(`הסתרנו את ${note.subject}`, { onAction: () => restoreHidden(note, false) });
      },
      onError: () => toast.show('לא הצלחנו להסתיר את השיעור. אפשר לנסות שוב'),
    });
  }, [sheetLesson, hideKeys, today, saveSettings, queryClient, toast, restoreHidden]);
  const classId = settings.data?.settings.classId ?? null;
  const projected = view?.projected ?? false;
  const adding = createTask.isPending && createTask.variables?.fromHomeworkKey === homework?.naturalKey;

  const fabLabel = isToday ? 'משימה חדשה להיום' : selectedDate === tomorrowDate ? 'משימה חדשה למחר' : `משימה חדשה ל־${formatShortDate(selectedDate)}`;

  // The "now" row on today; another day, or today with nothing timed, has the day line instead.
  // It is the scroll's second child, and on today it sticks under the stepper once the strip has
  // scrolled away (R-8: what is on now stays on screen).
  const nowShown = isToday && !holding && nowNextModel !== null;
  const lineShown = !holding && !nowShown && line !== null;
  // Gone (another day, the day over): nothing is stuck any more.
  useEffect(() => {
    if (nowShown) return;
    if (stuckRef.current) {
      stuckRef.current = false;
      setStuck(false);
    }
  }, [nowShown]);

  return (
    <Screen>
      <TabHeader
        buddies
        title={weekdayName(selectedDate)}
        // Tighter than the other tabs: everything above the scroll stays on screen (W4-8).
        style={styles.header}
        subtitle={(
          <Text numberOfLines={1} style={[styles.headerSub, { color: p.textMuted }]}>
            <Ltr style={[styles.headerDate, { color: p.text }]}>{formatDate(selectedDate)}</Ltr>
            {view?.hebrewDate ? `, ${view.hebrewDate}` : ''}
          </Text>
        )}
      />
      <ChildSwitcher />
      <DayStepper date={selectedDate} onChange={changeDate} next={stepperNext} style={styles.stepper} />
      {/* A clean edge under the fixed part once the page moves under it (Daniel, run 4). */}
      <View style={[styles.edge, { backgroundColor: scrolled ? p.border : 'transparent' }]} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: fabClearance }}
        stickyHeaderIndices={nowShown ? [1] : undefined}
        onLayout={(e) => {
          measured.current.viewport = e.nativeEvent.layout.height;
          scheduleScroll();
        }}
        // Once the user scrolls, a late measurement never moves the page under them.
        onScrollBeginDrag={() => {
          pendingScroll.current = null;
        }}
        onScroll={onScroll}
        scrollEventThrottle={32}
        refreshControl={<RefreshControl refreshing={sync.isPending} onRefresh={onRefresh} tintColor={p.accent} colors={[p.accent]} />}
      >
        <View onLayout={(e) => { stripEnd.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          <WeekStrip date={selectedDate} onChange={changeDate} marks={marks} style={styles.strip} />
        </View>

        {nowShown && nowNextModel ? (
          // On the page's margin line like the lists under it; filled with the page, so what scrolls
          // under it is hidden, and once stuck a soft shadow under its dashed rule (run 8).
          <View style={{ backgroundColor: p.bg }}>
            <MarginList opaque raised={stuck}>
              <NowRow model={nowNextModel} now={now} lessons={line?.lessons ?? null} action={nowAction} />
            </MarginList>
          </View>
        ) : lineShown && line ? (
          <MarginList><DayLineRow line={line} /></MarginList>
        ) : null}

        {/* Who shares the day with me: a window both are free in, who ends and who starts with me (friends 2.2). */}
        {isToday && !holding && !parent ? <BuddyTodayLines date={today} /> : null}

        {/* The year in review, in the last school week and the weeks after it; the student's own. */}
        {isToday && !parent ? <WrappedEntry today={today} /> : null}

        {landed && landed.from === today && landed.to === selectedDate ? (
          // Why this is not today, and the way back to it (W5-2).
          <Row
            title={landed.note}
            titleStyle={styles.noteTitle}
            end={(
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="להציג את היום"
                hitSlop={touchSlop(32)}
                onPress={() => changeDate(today)}
                style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.actionText, { color: p.accent }]}>להיום</Text>
              </Pressable>
            )}
          />
        ) : null}

        {mashov ? (
          // Homework comes from Mashov: without it the lists below stop updating (W5-4, Maya). A
          // dropped connection reconnects in the app's sheet, over this screen (W6-1); the full
          // login screen stays for a first login, and under מצב חיבורים.
          <Row
            accessibilityRole="button"
            accessibilityLabel={`${mashov.text}. ${mashov.action}`}
            onPress={() => (mashov.renew ? requestMashovRenew('push') : navigation.navigate('MashovLogin'))}
            title={<Mark kind="change" inline>{mashov.text}</Mark>}
            titleStyle={styles.noteTitle}
            end={<Text style={[styles.actionText, { color: p.accent }]}>{mashov.action}</Text>}
            chevron
          />
        ) : null}

        {hiddenNotes.map((note) => (
          // What the lesson sheet hid today, and the way back in one tap (V2, Maya, run 5), so a
          // subject that went is never read as lessons the school cancelled.
          <Row
            key={note.subject}
            accessibilityRole="button"
            accessibilityLabel={`${hiddenNoteText(note.subject)}. להחזיר את ${note.subject}`}
            disabled={saveSettings.isPending}
            onPress={() => restoreHidden(note, true)}
            title={hiddenNoteText(note.subject)}
            titleStyle={styles.noteTitle}
            end={<Text style={[styles.actionText, { color: p.accent }]}>להחזיר</Text>}
          />
        ))}

        {view && !holding ? (
          <DayBody
            view={view}
            timeline={timeline}
            today={today}
            now={now}
            overdue={overdue}
            noSchool={noSchool}
            nextDay={nextDay}
            vacationMode={settings.data?.settings.vacationMode ?? false}
            due={dueList}
            study={studyList}
            next={nextLists}
            degradedMessage={degraded.length === 0 ? null : degraded.length === 1 ? (degraded[0]!.message ?? 'חיבור אחד צריך בדיקה') : `${degraded.length} חיבורים צריכים בדיקה`}
            updatedAt={status.data?.sources.find((s) => s.source === 'shahaf' && s.lastOkAt)?.lastOkAt ?? view.generatedAt}
            refreshing={sync.isPending}
            onRefresh={onRefresh}
            measure={measure}
            onOpenChanges={() => setChangesOpen(true)}
            onOpenLesson={openLesson}
            onOpenEvent={openEvent}
            onLongPressEvent={confirmHide}
            onToggleTask={onToggleTask}
            onEditTask={openEditTask}
            onToggleHomework={onToggleHomework}
            onOpenHomework={openHomework}
            onCompose={openCompose}
            onShowDate={changeDate}
            navigation={navigation}
          />
        ) : day.isError ? (
          <View style={styles.placeholder}>
            <ErrorState message="אפשר לבדוק את החיבור לאינטרנט ולנסות שוב." onRetry={() => void day.refetch()} />
          </View>
        ) : (
          <View style={styles.placeholder}><Loading /></View>
        )}
      </ScrollView>

      {/* At the end side; steps aside while reading down the page, back on the way up and at either end (W5-6). */}
      <Fab accessibilityLabel={fabLabel} onPress={openCompose} shown={fabShown} />

      {/* Mounted only while open: it loads the task lists while mounted. */}
      {composeOpen ? (
        <ComposeTaskSheet
          initialDate={composeDate ?? selectedDate}
          initialTitle={composeTitle}
          task={editTask}
          onClose={() => {
            setComposeOpen(false);
            setEditTask(null);
            setComposeDate(null);
            setComposeTitle(null);
          }}
        />
      ) : null}
      <LessonSheet
        visible={lessonOpen}
        lesson={lessonBlock[0] ?? null}
        lessons={lessonBlock}
        classId={classId}
        projected={projected}
        addTask={addLessonTask}
        onNotMine={hideKeys.length > 0 ? onNotMine : null}
        onClose={() => setLessonOpen(false)}
      />
      <ChangesSheet visible={changesOpen} lessons={changed} classId={classId} projected={projected} onClose={() => setChangesOpen(false)} />
      <EventSheet
        visible={eventOpen}
        event={event}
        onClose={() => setEventOpen(false)}
        onHide={(e) => {
          setEventOpen(false);
          confirmHide(e);
        }}
      />
      <HomeworkSheet
        visible={homeworkOpen}
        item={homework}
        today={today}
        adding={adding}
        onClose={() => setHomeworkOpen(false)}
        onToggle={(h) => {
          setHomeworkOpen(false);
          onToggleHomework(h);
        }}
        onAdd={onAddHomework}
      />
    </Screen>
  );
}

/**
 * A section's title on the page, at the page's gutter, with an optional `end` (a word, a filter).
 * With `onPress` (an `end` that is an action) the whole row takes the tap (`SectionHeading`).
 */
function Heading({ children, end, color, onPress }: {
  children: string;
  end?: React.ReactNode;
  color?: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.heading}>
      <SectionHeading end={end} onPress={onPress}>{color ? <Text style={{ color }}>{children}</Text> : children}</SectionHeading>
    </View>
  );
}

interface DayBodyProps {
  view: DayView;
  timeline: TimelineItem[];
  today: string;
  now: Date;
  /** Today's "באיחור"; empty on other days. */
  overdue: OverdueItem[];
  noSchool: NoSchool | null;
  /** "ליום הלימודים הבא"; `null` while unknown, and then there is no button. */
  nextDay: string | null;
  vacationMode: boolean;
  /** The day's "להגשה" list (`dueEntries`): its own, and on the next school day what waits for it. */
  due: DueEntry[];
  /** The day's study tasks (`studyEntries`), carried ones first. */
  study: Task[];
  /** On today, the next school day's lists: "ליום ראשון להגשה", "ביום ראשון ללמוד". */
  next: NextLists | null;
  degradedMessage: string | null;
  updatedAt: string;
  /** "לבדוק עכשיו" beside "עודכן ב־": the pull-to-refresh, one tap away (Itai, Noa, Maya, run 4). */
  refreshing: boolean;
  onRefresh: () => void;
  measure: (key: 'section' | 'list' | 'now', date: string) => (e: LayoutChangeEvent) => void;
  onOpenChanges: () => void;
  onOpenLesson: (lesson: Lesson, block?: Lesson[]) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onLongPressEvent: (event: CalendarEvent) => void;
  onToggleTask: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onToggleHomework: (item: HomeworkItem) => void;
  onOpenHomework: (item: HomeworkItem) => void;
  onCompose: () => void;
  onShowDate: (date: string) => void;
  navigation: TodayNavigation;
}

function DayBody({
  view, timeline, today, now, overdue, noSchool, nextDay, vacationMode, due, study, next, degradedMessage, updatedAt,
  refreshing, onRefresh, measure, onOpenChanges, onOpenLesson, onOpenEvent, onLongPressEvent, onToggleTask, onEditTask, onToggleHomework,
  onOpenHomework, onCompose, onShowDate, navigation,
}: DayBodyProps): React.JSX.Element {
  const p = usePalette();
  const colorOf = useSubjectColor();
  const [schoolOnly, setSchoolOnly] = useTodaySchoolOnly();
  const [lessonsApart] = useTodayLessonsApart();
  // A cancelled run opened shows its lessons among the day's rows by the clock (run 8, `expandRuns`).
  const runs = useOpenRuns(view.date);
  const isToday = view.date === today;
  const summary = daySummary(timeline);
  // Rows from a day without school before this one (Wave 7) say their own date; the heading says "עד".
  const dueCarried = due.some((e) => e.due !== view.date);
  const studyCarried = study.some((t) => t.due !== null && t.due !== view.date);
  const allItems = timeline.filter((i) => i.kind !== 'task');
  // "רק בית ספר" (W6-6, Itai): the calendar's events leave the timeline for one row at its end.
  const calendar = allItems.filter((i) => i.kind === 'event');
  const foldCalendar = schoolOnly && calendar.length > 0;
  const items = foldCalendar ? allItems.filter((i) => i.kind !== 'event') : allItems;
  // A trip or a sports day (W5-3): the lessons fold into one row under the event's row, and
  // what is not a lesson (a calendar event) stays out in the open. No "now" line on such a day.
  const fullDay = fullDayEvent(view);
  const entries = expandRuns(dayEntries(fullDay ? items.filter((i) => i.kind !== 'lesson') : items, view.date, { lessonsApart }), runs.open);
  const folded = fullDay ? expandRuns(dayEntries(allItems.filter((i) => i.kind === 'lesson'), view.date, { lessonsApart }), runs.open) : [];
  // With nothing left but the folded calendar, a "now" line has nothing to stand between.
  const nowIndex = isToday && !fullDay && (entries.length > 0 || !foldCalendar) ? nowEntryIndex(entries, now) : -1;
  const calendarEntries = foldCalendar ? dayEntries(calendar, view.date) : [];
  const nextExam = view.nextExam ?? null;
  // One number: the countdown on today, the date on any other day (Wave 7).
  const exam = nextExam ? examStrip(nextExam, today, view.date) : null;
  // "הוזז אצלך" after the next exam's date, for an exam the person moved on this phone (V-6).
  const examMoved = nextExam ? movedMark(nextExam.exam) : null;
  // Everything due that day is ticked off: say so, rather than let the list just go quiet (Itai).
  const allHandedIn = due.length > 0 && openDueCount(due, NOTHING_DONE) === 0;
  const updated = toDateStr(new Date(updatedAt)) === today ? timeOf(updatedAt) : shortDateTime(updatedAt);
  const otherExams = [
    ...view.examsToday.filter((e) => e.naturalKey !== nextExam?.exam.naturalKey).map((e) => ({ exam: e, when: 'ביום הזה' })),
    ...view.examsTomorrow.filter((e) => e.naturalKey !== nextExam?.exam.naturalKey).map((e) => ({ exam: e, when: 'ביום שאחריו' })),
  ];
  const nextName = next ? (next.date === addDays(today, 1) ? 'מחר' : weekdayName(next.date)) : '';

  const nowRow = (
    <View key="now" onLayout={measure('now', view.date)}>
      <NowIndicator now={now} />
    </View>
  );
  const schoolEvents = view.events.filter((e) => e.naturalKey !== fullDay?.naturalKey);
  // Every calendar event in one style, the quiet line (run 5, Daniel: a card for some and a line
  // for others had no logic he could see). Which calendar it is from is in its sheet.
  const renderEntry = (entry: DayEntry, past: boolean): React.JSX.Element => (
    entry.kind === 'cancelledRun' ? (
      <CancelledRunRow lessons={entry.lessons} label={entry.label} free={entry.free} open={runs.open.has(entry.key)} onToggle={() => runs.toggle(entry.key)} />
    ) : entry.kind === 'lessons' ? (
      <LessonRow lesson={entry.lessons[0]!} block={entry.lessons} past={past} subjectColor={colorOf(entry.lessons[0]!.originalSubject ?? entry.lessons[0]!.subject)} onPress={onOpenLesson} />
    ) : (
      <TimelineRow
        item={entry.item}
        past={past}
        slim
        colorOf={colorOf}
        onPressLesson={onOpenLesson}
        onPressEvent={onOpenEvent}
        onLongPressEvent={onLongPressEvent}
      />
    )
  );
  /** One row of a "להגשה" list whose day is `listDate`; a row due on another day says its own date. */
  const renderDue = (entry: DueEntry, listDate: string): React.JSX.Element | null => {
    const carried = entry.due !== listDate;
    if (entry.kind === 'homework') {
      return (
        <HomeworkRow
          key={`hw-${entry.homework.naturalKey}`}
          item={entry.homework}
          due={entry.due}
          today={today}
          dueParts={carried ? carriedDueParts(entry.due) : null}
          onOpen={onOpenHomework}
          onToggle={onToggleHomework}
        />
      );
    }
    // The lib still knows Classroom rows; the phone reads no Classroom, so none reaches here (plan 2f).
    if (entry.kind === 'classroom') return null;
    // A task carried from Friday says its own day, as the rows above do (run 7).
    return (
      <TaskDueRow
        key={`task-${entry.task.id}`}
        task={entry.task}
        due={entry.due}
        dueParts={carried ? carriedDueParts(entry.due) : null}
        onToggle={onToggleTask}
        onEdit={onEditTask}
      />
    );
  };
  // "להציג" at the heading's end, and the whole heading row (run 8: the "+" sat on the word itself).
  const showNextDay = next ? () => onShowDate(next.date) : undefined;
  const showNext = next ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`להצגת ${nextName}`}
      hitSlop={touchSlop(28)}
      onPress={showNextDay}
      style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.actionText, { color: p.accent }]}>להציג</Text>
      <AppIcon name="chevronLeft" color={p.accent} size={16} />
    </Pressable>
  ) : null;

  return (
    <>
      {isProjected(view) ? (
        // Without a site every day is projected, and no site is waited for (plan Phase 3).
        <Text style={[styles.projected, { color: p.textMuted }]}>
          {isWithoutSite(storage) ? 'לפי המערכת הקבועה ממשוב.' : 'לפי המערכת הקבועה. האתר עוד לא פרסם את השבוע הזה.'}
        </Text>
      ) : null}

      {degradedMessage ? (
        <Row
          accessibilityRole="button"
          accessibilityLabel={`${degradedMessage}. למצב החיבורים`}
          onPress={() => navigation.navigate('Connections')}
          title={degradedMessage}
          titleStyle={[styles.noteTitle, { color: p.cancel }]}
          subtitle="למצב החיבורים"
          chevron
        />
      ) : null}

      {noSchool ? (
        // The day's one message, on the page (plan §16.1: no card for it).
        <View style={styles.noSchool}>
          <Text style={[styles.noSchoolTitle, { color: p.text }]}>{noSchool.title}</Text>
          {noSchool.detail ? <Text style={[styles.noSchoolLine, { color: p.textMuted }]}>{noSchool.detail}</Text> : null}
          {vacationMode ? (
            <Text style={[styles.noSchoolLine, { color: p.textMuted }]}>
              התראות בית הספר מושתקות עד סוף החופש. היומן והמשימות ממשיכים כרגיל.
            </Text>
          ) : null}
          {nextDay ? (
            <Button
              title={`ליום הלימודים הבא, ${nextDay === addDays(today, 1) ? 'מחר' : weekdayName(nextDay)}`}
              variant="ghost"
              onPress={() => onShowDate(nextDay)}
            />
          ) : null}
        </View>
      ) : null}

      {overdue.length > 0 ? (
        <>
          <Heading color={p.cancel}>באיחור</Heading>
          <MarginList>
            {overdue.map((o) => (o.kind === 'homework' ? (
              <HomeworkRow
                key={`hw-${o.homework.naturalKey}`}
                item={o.homework}
                due={o.due}
                today={today}
                late
                onOpen={onOpenHomework}
                onToggle={onToggleHomework}
              />
            ) : o.kind === 'classroom' ? null : (
              <TaskDueRow key={`task-${o.task.id}`} task={o.task} due={o.due} late onToggle={onToggleTask} onEdit={onEditTask} />
            )))}
          </MarginList>
        </>
      ) : null}

      {due.length > 0 ? (
        <>
          <Heading
            end={allHandedIn ? <Text style={[styles.actionText, { color: p.ok }]}>הכול סומן כבוצע</Text> : undefined}
          >
            {dueSectionTitle(view.date, today, dueCarried)}
          </Heading>
          <MarginList>{due.map((entry) => renderDue(entry, view.date))}</MarginList>
        </>
      ) : null}

      {study.length > 0 ? (
        // Study sessions are not handed in (W6-6, Noa: "you don't hand in studying"): a section of their own.
        <>
          <Heading>{studySectionTitle(view.date, today, studyCarried)}</Heading>
          <MarginList>
            {study.map((t) => (
              <TaskDueRow
                key={t.id}
                task={t}
                due={t.due ?? view.date}
                dueParts={t.due && t.due !== view.date ? carriedDueParts(t.due) : null}
                onToggle={onToggleTask}
                onEdit={onEditTask}
              />
            ))}
          </MarginList>
        </>
      ) : null}

      {next && next.due.length > 0 ? (
        // The next school day: "מחר להגשה", or on a Thursday "ליום ראשון להגשה" (W4-1), with
        // Friday's work in it under its own date (run 7).
        <>
          <Heading end={showNext} onPress={showNextDay}>{nextDueTitle(next.date, today, next.due.some((e) => e.due !== next.date))}</Heading>
          <MarginList>{next.due.map((entry) => renderDue(entry, next.date))}</MarginList>
        </>
      ) : null}
      {next && next.study.length > 0 ? (
        // And what to study then, apart (W6-6, Noa).
        <>
          <Heading end={next.due.length === 0 ? showNext : undefined} onPress={next.due.length === 0 ? showNextDay : undefined}>
            {nextStudyTitle(next.date, today)}
          </Heading>
          <MarginList>
            {next.study.map((t) => (
              <TaskDueRow key={t.id} task={t} due={t.due ?? next.date} dueParts={t.due && t.due !== next.date ? carriedDueParts(t.due) : null} onToggle={onToggleTask} onEdit={onEditTask} />
            ))}
          </MarginList>
        </>
      ) : null}

      <View style={styles.block}>
        {vacationMode ? (
          <Row title={<Mark kind="ok" inline>מצב חופש פעיל</Mark>} titleStyle={styles.noteTitle} />
        ) : view.isSchoolDay && !noSchool ? (
          view.changeCount > 0 ? (
            <Row
              accessibilityRole="button"
              accessibilityLabel={`${changesLabel(view.changeCount, view.date, today)}, לפירוט`}
              onPress={onOpenChanges}
              // The mark's own thin spaces part it from the words around it; then the day, "היום".
              title={view.changeCount === 1 ? (
                <><Mark kind="change" inline>שינוי אחד</Mark>{changesDayWord(view.date, today)}</>
              ) : (
                <><Mark kind="change" inline><Ltr>{String(view.changeCount)}</Ltr>{' שינויים'}</Mark>{changesDayWord(view.date, today)}</>
              )}
              chevron
            />
          ) : summary.total > 0 && !isProjected(view) ? (
            <Row title={`אין שינויים ${changesDayWord(view.date, today)}`} titleStyle={[styles.noteTitle, { color: p.textMuted }]} />
          ) : null
        ) : null}
        {otherExams.map(({ exam: e, when }) => (
          // The exam's own title says what it is ("מבחן באנגלית"): never "מבחן ביום הזה · מבחן באנגלית" (run 5, Daniel).
          // A name of the student's own is shown as they wrote it, brackets and all.
          <Row
            key={e.naturalKey}
            title={<><Mark kind="exam" inline>{isolateRanges(shownSubject(e))}</Mark>{when}</>}
            titleStyle={styles.noteTitle}
          />
        ))}

        {nextExam && exam ? (
          // The exam's title leads, on the highlighter, and "המבחן הבא" moves under it with the date:
          // "מבחן הבא: מבחן באנגלית" said "מבחן" twice (run 5, Daniel). On today the days left are
          // the row's end value; on another day the date alone (Wave 7: one number, never two).
          <Row
            accessibilityRole="button"
            accessibilityLabel={`המבחן הבא: ${exam.subject}, ${exam.dated ? '' : `${partsText(exam.when)}, `}${dayDateLabel(nextExam.exam.date)}${examMoved ? `, ${examMoved}` : ''}. לרשימת המבחנים`}
            onPress={() => navigation.navigate('School', { tab: 'exams' })}
            title={<Mark kind="exam" inline>{isolateRanges(exam.subject)}</Mark>}
            titleLines={2}
            end={exam.days !== null ? <DaysLeft days={exam.days} /> : undefined}
            chevron
          >
            <PartsText
              parts={[{ text: 'המבחן הבא, ' }, ...weekdayDateParts(nextExam.exam.date), ...(examMoved ? [{ text: `, ${examMoved}` }] : [])]}
              style={[styles.rowLine, { color: p.textMuted }]}
            />
          </Row>
        ) : null}
      </View>

      {/* The day's own event heads the timeline instead (W5-3); the rest are listed here. */}
      {schoolEvents.length > 0 ? (
        <>
          <Heading>אירועי בית ספר</Heading>
          {schoolEvents.map((e) => (
            <Row key={e.naturalKey} title={isolateRanges(e.title)} titleStyle={styles.noteTitle} />
          ))}
        </>
      ) : null}

      {/* A day without school and nothing on it: the lines above have said it all. */}
      {noSchool && allItems.length === 0 ? null : (
        <View key={view.date} onLayout={fullDay ? undefined : measure('section', view.date)}>
          <Heading
            end={calendar.length > 0 ? (
              <FilterChip
                label="רק בית ספר"
                selected={schoolOnly}
                onPress={() => setSchoolOnly(!schoolOnly)}
                accessibilityLabel="רק בית ספר: אירועי היומן בשורה אחת בסוף היום"
              />
            ) : undefined}
          >
            מהלך היום
          </Heading>
          {allItems.length === 0 ? (
            <EmptyState
              icon="day"
              text="אין שיעורים או אירועים ביום הזה"
              action={{ label: 'להוסיף משימה', onPress: onCompose }}
            />
          ) : (
            // On such a day nothing is measured: the page stays at the top, where the event is.
            <View onLayout={fullDay ? undefined : measure('list', view.date)}>
              <MarginList>
                {fullDay ? (
                  <FullDayEventRows key={view.date} event={fullDay} label={foldedLessonsLabel(lessonsOf(allItems).length)}>
                    {folded.map((entry, index) => (
                      <React.Fragment key={entryKey(entry, index)}>{renderEntry(entry, false)}</React.Fragment>
                    ))}
                  </FullDayEventRows>
                ) : null}
                {entries.map((entry, index) => (
                  <React.Fragment key={entryKey(entry, index)}>
                    {index === nowIndex ? nowRow : null}
                    {/* On today what is over draws in the muted colour, still at AA — never by opacity (W4-8). */}
                    {renderEntry(entry, isToday && entryIsPast(entry, view.date, now))}
                  </React.Fragment>
                ))}
                {nowIndex === entries.length ? nowRow : null}
                {foldCalendar ? (
                  <CalendarFoldRow key={`calendar-${view.date}`} count={calendarEntries.length}>
                    {calendarEntries.map((entry, index) => (
                      <React.Fragment key={entryKey(entry, index)}>
                        {renderEntry(entry, isToday && entryIsPast(entry, view.date, now))}
                      </React.Fragment>
                    ))}
                  </CalendarFoldRow>
                ) : null}
              </MarginList>
            </View>
          )}
        </View>
      )}

      {/* When it was last checked, and a way to check now without pulling or going to settings. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={refreshing ? 'בודקים עכשיו' : `עודכן ב־${updated}. לבדוק עכשיו`}
        accessibilityState={{ busy: refreshing }}
        disabled={refreshing}
        onPress={onRefresh}
        style={({ pressed }) => [styles.updated, { opacity: pressed ? 0.6 : 1 }]}
      >
        {refreshing ? (
          <Text style={[styles.updatedText, { color: p.textMuted }]}>בודקים עכשיו…</Text>
        ) : (
          <>
            <Text style={[styles.updatedText, { color: p.textMuted }]}>
              {'עודכן ב־'}
              <Ltr>{updated}</Ltr>
            </Text>
            <Text style={[styles.actionText, { color: p.accent }]}>לבדוק עכשיו</Text>
          </>
        )}
      </Pressable>
    </>
  );
}

/** The days to the next exam, the row's end value: the number in the display face (plan §16.1), or "מחר" / "היום". */
function DaysLeft({ days }: { days: number }): React.JSX.Element {
  const p = usePalette();
  if (days <= 1) return <Text style={[styles.daysWord, { color: p.text }]}>{days === 1 ? 'מחר' : 'היום'}</Text>;
  return (
    <View style={styles.daysLeft}>
      <Text maxScale={1.15} style={[styles.daysNumber, { color: p.text }]}><Ltr>{String(days)}</Ltr></Text>
      <Text maxScale={1.15} style={[styles.daysUnit, { color: p.textMuted }]}>ימים</Text>
    </View>
  );
}

function isProjected(view: DayView): boolean {
  // `?? false`: a server older than the contract sends no `projected`.
  return view.projected ?? false;
}

/** A row's title once it is done: muted and struck through. */
function doneTitle(done: boolean, color: string): TextStyle | undefined {
  return done ? { color, textDecorationLine: 'line-through' } : undefined;
}

/**
 * The box at a row's start, its `lead` (plan §16.1 `Checkbox`), drawn here
 * and made its own control here, so it keeps its label and its hint ("רק
 * אצלך"); 44 points to tap. The row around it opens the item.
 */
function CheckControl({
  checked, label, hint, onPress,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={touchSlop(CHECK_SIZE)}
      onPress={onPress}
      style={styles.check}
    >
      <Checkbox value={checked} />
    </Pressable>
  );
}

/** The drawn box (`Checkbox`); `touchSlop` grows its target to 44. */
const CHECK_SIZE = 20;

/** What `openDueCount` counts as ticked besides each row's own state: nothing, without Classroom (plan 2f). */
const NOTHING_DONE: ReadonlySet<string> = new Set();

/**
 * One Mashov homework item (R-6), a row of a "להגשה" list: the due date in
 * the margin (in red under "באיחור"), the box after it, the subject, and the
 * assignment under it. Tapping the row opens its details; only the box ticks
 * it off, and that stays on the phone — nothing is sent to the teacher.
 * `dueParts`: it is due on another day than the list's — a Friday's, on
 * Sunday's list (Wave 7) — so a screen reader hears when, by its own day and
 * date: "להגשה ביום ו׳ 9.10" (`carriedDueParts`); the margin shows the date.
 */
function HomeworkRow({
  item, due, today, late = false, dueParts = null, onOpen, onToggle,
}: {
  item: HomeworkItem;
  /** Its due date, the margin's. */
  due: string;
  today: string;
  late?: boolean;
  dueParts?: Part[] | null;
  onOpen: (item: HomeworkItem) => void;
  onToggle: (item: HomeworkItem) => void;
}): React.JSX.Element {
  const p = usePalette();
  const subject = shownSubject(item);
  // Under the "באיחור" heading: how long ago, not "באיחור" a second time (run 5, Daniel).
  const dueLine = late ? homeworkDueParts(item, today, true) : dueParts;
  const text = item.text.trim();
  return (
    <MarginRow
      margin={formatShortDate(due)}
      tone={late ? 'late' : 'normal'}
      accessibilityRole="button"
      accessibilityLabel={`שיעורי בית ב${subject}: ${item.text}${dueLine ? `. ${partsText(dueLine)}` : ''}`}
      accessibilityHint="פותח את הפרטים"
      onPress={() => onOpen(item)}
      title={subject}
      titleStyle={doneTitle(item.done, p.textMuted)}
      lead={(
        <CheckControl
          checked={item.done}
          label={`סימון כבוצע: ${subject}`}
          hint={item.done ? 'מבטל את הסימון' : 'מסמן כבוצע'}
          onPress={() => onToggle(item)}
        />
      )}
    >
      {text ? <Text numberOfLines={2} style={[styles.rowLine, { color: p.textMuted }]}>{isolateRanges(text)}</Text> : null}
    </MarginRow>
  );
}

/**
 * A Google task on a day's list, a row like homework's: the due date in the
 * margin, the box after it, the title. The row opens the task for editing,
 * the box ticks it. `late` is "באיחור"; `dueParts` a task carried from Friday
 * (run 7), which a screen reader hears by its own day and date.
 */
function TaskDueRow({
  task, due, late = false, dueParts = null, onToggle, onEdit,
}: {
  task: Task;
  /** Its due date, the margin's. */
  due: string;
  late?: boolean;
  dueParts?: Part[] | null;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
}): React.JSX.Element {
  const p = usePalette();
  const carried = dueParts && dueParts.length > 0 ? dueParts : null;
  const dueText = task.due && !carried ? taskDueText(task.due, { completed: task.completed, underLate: late }) : null;
  return (
    <MarginRow
      margin={formatShortDate(due)}
      tone={late ? 'late' : 'normal'}
      accessibilityRole="button"
      accessibilityLabel={[task.title, carried ? partsText(carried) : dueText?.text].filter(Boolean).join(', ')}
      accessibilityHint="לעריכת המשימה"
      onPress={() => onEdit(task)}
      title={isolateRanges(task.title)}
      titleLines={2}
      titleStyle={doneTitle(task.completed, p.textMuted)}
      lead={(
        <CheckControl
          checked={task.completed}
          label={`${task.completed ? 'ביטול הסימון' : 'סימון כבוצע'}: ${task.title}`}
          onPress={() => onToggle(task)}
        />
      )}
    />
  );
}

/**
 * A homework item's details (R-6): the subject, the whole assignment, when it
 * is due. "להעתיק ל־Google Tasks" copies it into a Google task; "סימון כבוצע"
 * ticks it off here, and the sheet says plainly that the mark stays on the
 * phone.
 */
function HomeworkSheet({
  visible, item, today, adding, onClose, onToggle, onAdd,
}: {
  visible: boolean;
  item: HomeworkItem | null;
  today: string;
  adding: boolean;
  onClose: () => void;
  onToggle: (item: HomeworkItem) => void;
  onAdd: (item: HomeworkItem) => void;
}): React.JSX.Element {
  const p = usePalette();
  const google = useGoogleConnected();
  // The group Mashov's name holds ("(יב2)"), whatever name the student gave the subject.
  const group = item ? groupOf(item.originalSubject ?? item.subject) : null;
  const text = item?.text.trim() ?? '';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? `שיעורי בית ב${shownSubject(item)}` : ''}
      footer={item ? (
        <View style={styles.sheetActions}>
          {/* The demo has no Google Tasks to copy to (`demo/mode.ts`), nor has a phone with no Google connected. */}
          {canCopyToGoogle(item, isDemo(), google) ? (
            <Button title={adding ? 'מעתיק…' : 'להעתיק ל־Google Tasks'} disabled={adding} onPress={() => onAdd(item)} />
          ) : null}
          <Button title={item.done ? 'ביטול הסימון' : 'סימון כבוצע'} variant="ghost" onPress={() => onToggle(item)} />
        </View>
      ) : undefined}
    >
      {item ? (
        <View style={{ gap: space.md }}>
          <PartsText parts={homeworkDueParts(item, today)} style={[styles.sheetDue, { color: p.text }]} />
          <Text selectable style={[styles.sheetText, { color: p.textStrong }]}>
            {text ? isolateRanges(text) : 'אין פירוט במשוב'}
          </Text>
          <View>
            {group ? <DetailRow label="קבוצה" value={group} /> : null}
            <DetailRow label="מקור" value="משוב" />
            {item.linkedTaskId ? <DetailRow label="משימות" value="כבר במשימות שלך" /> : null}
            <DetailRow label="מצב" value={item.done ? 'סומן כבוצע' : 'עוד לא סומן'} />
          </View>
          <Text style={[styles.sheetNote, { color: p.textMuted }]}>
            הסימון לא נשלח למורה, והעבודה לא מוגשת.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

function entryKey(entry: DayEntry, index: number): string {
  if (entry.kind !== 'item') return entry.key;
  const { item } = entry;
  if (item.kind === 'lesson') return `l-${item.lesson.hourIndex}-${item.lesson.subject}-${index}`;
  if (item.kind === 'event') return `e-${item.event.id}`;
  return `t-${item.task.id}`;
}

const styles = StyleSheet.create({
  header: { paddingTop: space.md, paddingBottom: space.xs },
  headerSub: { fontFamily: font.body, fontSize: type.small },
  headerDate: { fontFamily: font.bodySemi },
  stepper: { paddingHorizontal: space.xs },
  strip: { paddingHorizontal: space.sm, paddingBottom: space.sm },
  placeholder: { minHeight: 260 },
  heading: { paddingHorizontal: space.xl, marginTop: space.xl },
  block: { marginTop: space.lg },
  noteTitle: { fontFamily: font.body, fontSize: type.body },
  rowLine: { fontFamily: font.body, fontSize: type.small },
  textAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, justifyContent: 'center' },
  actionText: { fontFamily: font.bodySemi, fontSize: type.small },
  projected: { fontFamily: font.body, fontSize: type.small, marginTop: space.sm, paddingHorizontal: space.xl },
  noSchool: { alignItems: 'center', gap: space.xs, paddingHorizontal: space.xl, paddingVertical: space.xl },
  noSchoolTitle: { fontFamily: font.headingSemi, fontSize: type.heading, textAlign: 'center' },
  noSchoolLine: { fontFamily: font.body, fontSize: type.small, textAlign: 'center' },
  daysLeft: { alignItems: 'center' },
  daysNumber: { fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.2) },
  daysUnit: { fontFamily: font.body, fontSize: type.caption },
  daysWord: { fontFamily: font.headingSemi, fontSize: type.title },
  check: { width: CHECK_SIZE, height: CHECK_SIZE, alignItems: 'center', justifyContent: 'center' },
  sheetActions: { gap: space.xs },
  sheetDue: { fontFamily: font.bodySemi, fontSize: type.label },
  sheetText: { fontFamily: font.body, fontSize: type.body, lineHeight: 22 },
  sheetNote: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  edge: { height: StyleSheet.hairlineWidth },
  updated: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: space.md,
    minHeight: 44, alignSelf: 'center', marginTop: space.md, paddingHorizontal: space.md,
  },
  updatedText: { fontFamily: font.body, fontSize: type.small },
});
