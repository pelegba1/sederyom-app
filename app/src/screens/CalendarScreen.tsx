/**
 * תכנון (F11, formerly "היומן שלי"): everything planned, found from one date
 * navigator. The month grid marks each day that has an exam, homework due, a
 * task or an event; under it, the chosen day; under that, "ב־14 הימים הקרובים" — the
 * next 14 days of exams with a countdown, homework with a done check, tasks
 * and events (R4, R8).
 *
 * The 14-day list never repeats the chosen day, which is right above it, and
 * "רק בית ספר" takes the Google Calendar's events out of it (R-28).
 *
 * Wave 4: exams and homework stand out in the grid (W4-10); paging the
 * grid's months does not change the chosen day (W4-12c); the chosen day
 * offers "להוספת משימה ליום הזה" (Itai), and an exam opens its details.
 *
 * Wave 5:
 * - Every exam of the owner's is marked, in any month (W5-15, Noa): the
 *   marks take `/settings`'s exams as well as the agenda's 31 days.
 * - On an exam day the exam comes before the timetable row, and the
 *   explanatory sentences are gone (W5-16, Itai).
 * - Calendar events have no mark in the grid; the chosen day lists them
 *   (W5-16, Daniel).
 *
 * Wave 6 (W6-9):
 * - The list is "ב־14 הימים הקרובים"; "הקרוב אליי" read as a place (Maya).
 * - Under the chosen day one action stands out, "להוספת משימה ליום הזה",
 *   and Google Calendar's two are quiet links (Daniel).
 *
 * One `/agenda` request covers the month grid's homework and task marks and
 * the 14-day list. A day the agenda does not reach (the past, a later month)
 * is read from `/day`, which carries the same items.
 *
 * Run 7:
 * - Classroom work joined the agenda like homework; the phone reads no
 *   Classroom (plan 2f), so none does now.
 * - "רק בית ספר", Today's words, keeps the school's own events and takes out
 *   only the calendar's (Noa: the class trip went with the filter).
 *
 * Wave 9 (plan §16, the notebook): the month is written on the page, not in
 * a card (MonthCalendar). The chosen day is a heading and ruled rows with the
 * red margin line, the time (or "כל היום") in the margin; its timetable is a
 * plain row, "מערכת השעות" with "3 שיעורים, 4 שינויים" muted under it and
 * "לפתוח ביום שלי" at its end. The 14 days are one ruled list, each day's
 * date in the margin of its heading row. No side bars, no tinted pills:
 * an exam is its name on the yellow highlighter, and a kind is said in words.
 * "רק בית ספר" is a `FilterChip`, as on Today.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, type CompositeNavigationProp, type RouteProp } from '@react-navigation/native';
import type { MaterialTopTabNavigationProp } from '@react-navigation/material-top-tabs';
import {
  AGENDA_DEFAULT_DAYS, AGENDA_MAX_DAYS, type CalendarEvent, type Exam, type HomeworkItem, type SchoolEvent, type Task,
} from '@sederyom/shared';
import { useAgenda, useDay, useSetHomeworkDone, useSettings, useStatus, useSyncNow } from '../api/hooks';
import { AppIcon, type IconName } from '../components/AppIcon';
import { ComposeTaskSheet } from '../components/ComposeTaskSheet';
import { ExamSheet } from '../components/ExamSheet';
import { MarkLegend, MonthCalendar } from '../components/MonthCalendar';
import { FilterChip, Mark, MarginList, MarginRow, Row, SectionHeading, useFabListClearance } from '../components/notebook';
import { TabHeader } from '../components/TabHeader';
import { calendarLabel } from '../components/timeline';
import { CheckTarget, TaskRow, useSheetPressGuard, useTaskToggle } from '../components/TaskRow';
import { useToast } from '../components/Toast';
import { Button, EmptyState, ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { isDemo } from '../demo/phone';
import { countdownLabel, formatShortDate, isolateRanges, shownSubject, timeOf, todayStr } from '../lib/format';
import {
  SCHOOL_ONLY_LABEL, SHOWN_ABOVE, UPCOMING_TITLE, agendaDay, agendaItemKey, dayAgendaItems,
  dayTitleParts, hiddenEventsNote, lessonsRowCopy, marksEndInView, marksEndNote, monthMarks, relativeDayName, splitDayItems,
  upcomingEmptyText, upcomingList, type PlanItem,
} from '../lib/planning';
import { monthDates, monthOf } from '../lib/planner';
import { isWithoutSite } from '../local/schoolSite';
import { storage } from '../widget/feedCache';
import { font, space, type } from '../theme';
import type { RootNavigation, TabsParamList } from '../navigation/types';

type PlanningNavigation = CompositeNavigationProp<MaterialTopTabNavigationProp<TabsParamList, 'Calendar'>, RootNavigation>;

/**
 * "רק בית ספר", remembered while the app runs: leaving the tab and coming
 * back keeps it, a fresh start shows everything again.
 */
let schoolOnlyThisSession = false;

/** A homework row's kind, in words under its title, as on the task list. */
const HOMEWORK_KIND = 'שיעורי בית';
/** A school event's kind, in words under its title. */
const SCHOOL_EVENT_KIND = 'אירוע בית ספר';

export function CalendarScreen({ navigation, route }: { navigation: PlanningNavigation; route: RouteProp<TabsParamList, 'Calendar'> }): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const paramDate = route.params?.date;
  const [date, setDate] = useState(paramDate ?? today);
  // The month the grid shows, which paging moves without choosing a day (W4-12c).
  const [shownMonth, setShownMonth] = useState(() => monthOf(paramDate ?? today));
  const [schoolOnly, setSchoolOnlyState] = useState(() => schoolOnlyThisSession);
  // "להוספת משימה": the new task's date, or null for none; undefined while the sheet is closed.
  const [composeDate, setComposeDate] = useState<string | null | undefined>(undefined);
  const [exam, setExam] = useState<Exam | null>(null);
  const press = useSheetPressGuard();
  // Room under the last row for a toast after a tick (R-30), at the text size in use.
  const clearance = useFabListClearance();
  const setSchoolOnly = useCallback((next: boolean) => {
    schoolOnlyThisSession = next;
    setSchoolOnlyState(next);
  }, []);
  // A deep link ("planning" pushes, the notification log) opens its day. The
  // param is applied once on focus and then cleared, like Today and School
  // do, so the same date sent again after moving away lands again.
  useFocusEffect(
    useCallback(() => {
      if (!paramDate) return;
      setDate(paramDate);
      navigation.setParams({ date: undefined });
    }, [paramDate, navigation]),
  );

  const agenda = useAgenda(AGENDA_MAX_DAYS);
  const day = useDay(date);
  const settings = useSettings();
  const status = useStatus();
  const sync = useSyncNow();
  const onToggleTask = press.guard(useTaskToggle());
  const onToggleHomework = press.guard(useHomeworkToggle());
  const openExam = press.guard((e: Exam) => setExam(e));

  // The marks, the chosen day and the 14-day list read the one agenda alike.
  const plan = agenda.data;

  // Exams in every month (W5-15): the hide-list as it is now, which "המבחנים שלי" updates in the cache.
  const marks = useMemo(
    () => monthMarks(plan, settings.data?.exams ?? [], settings.data?.settings.exams.hiddenKeys),
    [plan, settings.data],
  );
  const upcoming = useMemo(
    () => (plan ? upcomingList(plan, { days: AGENDA_DEFAULT_DAYS, selected: date, schoolOnly }) : null),
    [plan, date, schoolOnly],
  );
  const hiddenNote = schoolOnly && upcoming ? hiddenEventsNote(upcoming.hidden) : null;
  // The chosen day's items: from the agenda when it covers the day (instant,
  // and the same list the marks came from), otherwise from the day view.
  const covered = agendaDay(plan, date);
  const items: PlanItem[] | null = covered
    ? covered.items
    : day.data ? dayAgendaItems(day.data, today) : null;
  // Its exams go above the timetable row, the rest under it (W5-16).
  const parts = items ? splitDayItems(items) : null;
  // Homework and task marks reach the agenda's last day; past it only exams are marked, and the grid says so.
  const marksEnd = marksEndInView(plan ?? null, monthDates(shownMonth));

  const google = status.data?.sources.find((s) => s.source === 'google_calendar');
  const googleMissing = google !== undefined && (!google.configured || google.needsReauth);

  const openGoogle = () => {
    const [y, m, d] = date.split('-').map(Number);
    void Linking.openURL(`https://calendar.google.com/calendar/u/0/r/day/${y}/${m}/${d}`)
      .catch(() => Alert.alert('לא ניתן לפתוח', 'לא נמצא דפדפן לפתיחת Google Calendar.'));
  };
  const closeCompose = () => {
    setComposeDate(undefined);
    press.sheetClosed();
  };

  const renderItem = (item: PlanItem) => (
    <AgendaRow
      key={agendaItemKey(item)}
      item={item}
      onToggleTask={onToggleTask}
      onToggleHomework={onToggleHomework}
      onOpenExam={openExam}
    />
  );
  const title = dayTitleParts(date);
  // Without a site the note does not wait for one (plan Phase 3).
  const lessonsRow = day.data ? lessonsRowCopy(day.data, isWithoutSite(storage)) : null;
  const googleTitle = google?.needsReauth ? 'החיבור ל־Google נותק' : 'יומן Google לא מחובר';
  const googleNote = 'האירועים מהיומן לא מופיעים כאן';

  return <Screen>
    <TabHeader title="תכנון" />
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      refreshControl={<RefreshControl refreshing={sync.isPending} onRefresh={() => sync.mutate()} tintColor={p.accent} />}
    >
      {/* The month on the page, its key under it (plan §16.1: no card). */}
      <View style={styles.month}>
        <MonthCalendar date={date} onChange={setDate} onMonthChange={setShownMonth} marks={marks} onToday={() => setDate(today)} />
        <MarkLegend />
        {marksEnd ? (
          <Text style={[styles.footnote, { color: p.textMuted }]}>
            {marksEndNote(marksEnd).lead}<Ltr>{marksEndNote(marksEnd).date}</Ltr>{marksEndNote(marksEnd).rest}
          </Text>
        ) : null}
      </View>

      {sync.isError ? (
        <Text accessibilityRole="alert" style={[styles.gutter, { fontFamily: font.body, fontSize: type.small, color: p.cancel, marginTop: space.md }]}>
          {sync.error.message}
        </Text>
      ) : null}

      {/* The chosen day, right under the grid (B4): its exams first, then the timetable, then the rest (W5-16). */}
      <View style={styles.section}>
        <View style={styles.gutter}>
          <SectionHeading>{title.name}{', '}<Ltr>{title.date}</Ltr></SectionHeading>
        </View>
        <View style={[styles.ruled, { borderTopColor: p.border }]}>
          {parts && parts.exams.length > 0 ? <MarginList>{parts.exams.map(renderItem)}</MarginList> : null}
          {lessonsRow ? (
            // It leads to another tab, and says so before the tap (R-28). The sentence on why a
            // day reads "לפי המערכת הקבועה" stays in its label; on screen it pushed the exam down (W5-16).
            <Row
              title={lessonsRow.title}
              subtitle={lessonsRow.summary}
              end={<Text style={[styles.rowAction, { color: p.accent }]}>{lessonsRow.action}</Text>}
              accessibilityLabel={lessonsRow.label}
              onPress={() => navigation.navigate('Tabs', { screen: 'Today', params: { date } })}
            />
          ) : null}
          {parts === null ? (
            day.isError ? <ErrorState message={day.error.message} onRetry={() => void day.refetch()} /> : <Loading />
          ) : parts.exams.length + parts.rest.length === 0 ? (
            <Text style={[styles.gutter, styles.empty, { color: p.textMuted }]}>אין ביום הזה מבחנים, הגשות, משימות או אירועים</Text>
          ) : parts.rest.length > 0 ? (
            <MarginList>{parts.rest.map(renderItem)}</MarginList>
          ) : null}
        </View>
        {/* One action stands out, the rest are quiet links (W6-9, Daniel: three outlined buttons
            stacked alike "looked like a form, not an app"). */}
        <View style={[styles.gutter, styles.dayActions]}>
          {/* A task for the chosen day, straight from the grid (Itai). Not for a day gone by. */}
          {date >= today ? (
            <Button title="להוספת משימה ליום הזה" onPress={press.guard(() => setComposeDate(date))} />
          ) : null}
          <View style={styles.links}>
            {/* The demo's events are made up, not in anyone's Google Calendar (`demo/mode.ts`). */}
            {isDemo() ? null : <LinkButton icon="link" title="להוספה או עריכה ב־Google Calendar" onPress={openGoogle} />}
            {/* Which Google calendars show here: was a button beside a sentence over the grid (W5-16). */}
            <LinkButton icon="settings" title="לבחירת היומנים מ־Google" onPress={() => navigation.navigate('Calendars')} />
          </View>
        </View>
      </View>

      {googleMissing ? (
        <View style={[styles.ruled, styles.googleRow, { borderTopColor: p.border }]}>
          <Row
            title={googleTitle}
            subtitle={googleNote}
            end={<Text style={[styles.rowAction, { color: p.accent }]}>לחיבורים</Text>}
            accessibilityLabel={`${googleTitle}. ${googleNote}. לחיבורים`}
            onPress={() => navigation.navigate('Connections')}
          />
        </View>
      ) : null}

      {/* "ב־14 הימים הקרובים": the next 14 days, by day (R4), without the chosen day above (R-28). */}
      <View style={styles.section}>
        <View style={styles.gutter}>
          <SectionHeading
            end={(
              <FilterChip
                label={SCHOOL_ONLY_LABEL}
                selected={schoolOnly}
                onPress={() => setSchoolOnly(!schoolOnly)}
                accessibilityLabel={`${SCHOOL_ONLY_LABEL}: בלי אירועי היומן`}
              />
            )}
          >
            {UPCOMING_TITLE.lead}<Ltr>{String(AGENDA_DEFAULT_DAYS)}</Ltr>{UPCOMING_TITLE.rest}
          </SectionHeading>
        </View>
        {hiddenNote ? <Text style={[styles.gutter, styles.hiddenNote, { color: p.textMuted }]}>{hiddenNote}</Text> : null}
        {agenda.isLoading ? <Loading /> : agenda.isError ? (
          <ErrorState message={agenda.error.message} onRetry={() => void agenda.refetch()} />
        ) : !upcoming || upcoming.groups.length === 0 ? (
          <View style={styles.gutter}>
            <EmptyState
              icon="calendar"
              text={upcomingEmptyText(upcoming?.todayAbove ?? false)}
              action={{ label: 'להוספת משימה', onPress: () => setComposeDate(null) }}
            />
          </View>
        ) : (
          // One ruled list: each day opens with its date in the margin and its name, then its rows.
          <MarginList style={[styles.ruled, { borderTopColor: p.border }]}>
            {upcoming.groups.map((g) => {
              const name = relativeDayName(g.date, agenda.data?.from ?? today);
              return (
                <React.Fragment key={g.date}>
                  <MarginRow
                    margin={formatShortDate(g.date)}
                    title={name}
                    titleStyle={styles.dayName}
                    end={g.shownAbove ? <Text style={[styles.shownAbove, { color: p.textMuted }]}>{SHOWN_ABOVE}</Text> : null}
                    accessible
                    accessibilityRole="header"
                    accessibilityLabel={[`${name} ${formatShortDate(g.date)}`, g.shownAbove ? SHOWN_ABOVE : null].filter(Boolean).join(', ')}
                  />
                  {g.shownAbove ? null : g.items.map(renderItem)}
                </React.Fragment>
              );
            })}
          </MarginList>
        )}
      </View>
    </ScrollView>
    <ExamSheet
      exam={exam}
      onClose={() => {
        setExam(null);
        press.sheetClosed();
      }}
    />
    {/* Mounted only while open: it loads the task lists while mounted. */}
    {composeDate !== undefined ? <ComposeTaskSheet initialDate={composeDate} onClose={closeCompose} /> : null}
  </Screen>;
}

/**
 * A quiet action under the chosen day (W6-9): an icon and words in the
 * accent colour, no frame — the day's one filled action is "להוספת משימה".
 * A full touch target, and its words free to wrap.
 */
function LinkButton({ icon, title, onPress }: { icon: IconName; title: string; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppIcon name={icon} color={p.accent} size={18} />
      <Text style={{ flexShrink: 1, fontFamily: font.bodySemi, fontSize: type.label, color: p.accent }}>{title}</Text>
    </Pressable>
  );
}

/**
 * Ticks a homework item off ("עשיתי"), or back on, with "החזרה" — the same
 * pattern as `useTaskToggle`, and the same words as the Tasks tab. The flip
 * is optimistic everywhere the item is cached; "החזרה" waits for the first
 * request, so the two cannot land out of order.
 */
function useHomeworkToggle(): (item: HomeworkItem) => void {
  const { mutateAsync, mutate } = useSetHomeworkDone();
  const toast = useToast();
  return useCallback((item: HomeworkItem) => {
    const was = item.done;
    const first = mutateAsync({ key: item.naturalKey, done: !was });
    first.catch(() => toast.show('לא הצלחנו לעדכן. אפשר לנסות שוב'));
    toast.show(was ? 'הוחזר לשיעורי הבית הפתוחים' : 'סומן אצלך. המורה לא רואה את זה.', {
      // No label: an undo reads `UNDO_LABEL`, "החזרה".
      onAction: () => {
        first.then(
          () => mutate(
            { key: item.naturalKey, done: was },
            { onError: () => toast.show('לא הצלחנו לבטל. אפשר לנסות שוב') },
          ),
          () => undefined,
        );
      },
    });
  }, [mutateAsync, mutate, toast]);
}

function AgendaRow({
  item, onToggleTask, onToggleHomework, onOpenExam,
}: {
  item: PlanItem;
  onToggleTask: (task: Task) => void;
  onToggleHomework: (item: HomeworkItem) => void;
  onOpenExam: (exam: Exam) => void;
}): React.JSX.Element | null {
  switch (item.kind) {
    case 'exam': return <ExamRow exam={item.exam} daysAway={item.daysAway} onPress={() => onOpenExam(item.exam)} />;
    case 'homework': return <HomeworkRow item={item.homework} onToggle={onToggleHomework} />;
    // The planning lib still knows Classroom rows; the phone reads no Classroom, so none reaches here (plan 2f).
    case 'classroom': return null;
    // The day is the list's heading: the task's margin stays empty.
    case 'task': return <TaskRow task={item.task} onToggle={onToggleTask} margin={null} />;
    case 'event': return <SchoolEventRow event={item.event} />;
    default: return <CalendarEventRow event={item.event} />;
  }
}

/** A struck, muted title: a row that is done (ticked a moment ago). */
function doneTitle(p: ReturnType<typeof usePalette>) {
  return { color: p.textFaint, textDecorationLine: 'line-through' } as const;
}

/**
 * Words in the margin ("כל היום"): the margin's type, without `Ltr`, which
 * is for numbers.
 */
function MarginWord({ children }: { children: string }): React.JSX.Element {
  const p = usePalette();
  return <Text style={[styles.marginWord, { color: p.textMuted }]}>{children}</Text>;
}

/**
 * An exam: its name on the exam's yellow highlighter (a mark, not a tinted
 * card), its details muted under it, the countdown at the row's end, and its
 * hour in the margin when it has one (a bagrut). Opens the exam's details.
 */
function ExamRow({ exam, daysAway, onPress }: { exam: Exam; daysAway: number; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const countdown = countdownLabel(daysAway);
  return (
    <MarginRow
      margin={exam.startTime ?? null}
      title={<Mark kind="exam" inline>{isolateRanges(exam.subject)}</Mark>}
      subtitle={exam.details ? isolateRanges(exam.details) : undefined}
      end={<Text style={[styles.countdown, { color: p.text }]}>{countdown}</Text>}
      accessibilityLabel={`מבחן: ${exam.subject}, ${countdown}`}
      accessibilityHint="פותח את פרטי המבחן"
      onPress={onPress}
    />
  );
}

/**
 * Homework due on the day, as on the task list: the box at the row's start,
 * the assignment as the title, the subject and "שיעורי בית" muted under it.
 */
function HomeworkRow({ item, onToggle }: { item: HomeworkItem; onToggle: (item: HomeworkItem) => void }): React.JSX.Element {
  const p = usePalette();
  const subject = shownSubject(item);
  const text = item.text.trim();
  return (
    <MarginRow
      margin={null}
      title={text ? isolateRanges(text) : subject}
      titleLines={2}
      titleStyle={item.done ? doneTitle(p) : null}
      subtitle={text ? `${subject}, ${HOMEWORK_KIND}` : HOMEWORK_KIND}
      lead={(
        <CheckTarget
          checked={item.done}
          label={`${item.done ? 'ביטול הסימון' : 'סימון כבוצע'}: שיעורי בית ב${subject}`}
          onPress={() => onToggle(item)}
        />
      )}
    />
  );
}

/** A school event (a trip, a ceremony): its title, and "אירוע בית ספר" with its details muted under it. */
function SchoolEventRow({ event }: { event: SchoolEvent }): React.JSX.Element {
  const details = event.details?.trim() || null;
  return (
    <MarginRow
      margin={null}
      title={isolateRanges(event.title)}
      subtitle={details ? `${SCHOOL_EVENT_KIND}, ${isolateRanges(details)}` : SCHOOL_EVENT_KIND}
    />
  );
}

/**
 * A Google Calendar event: its time in the margin ("כל היום" for a day-long
 * one), its title, and the calendar it is in muted under it. No side bar
 * (plan §16.1).
 */
function CalendarEventRow({ event }: { event: CalendarEvent }): React.JSX.Element {
  const time = event.allDay ? null : timeOf(event.start);
  const spoken = event.allDay ? 'כל היום' : [timeOf(event.start), timeOf(event.end)].filter(Boolean).join(' עד ');
  return (
    <MarginRow
      margin={event.allDay ? <MarginWord>כל היום</MarginWord> : time || null}
      title={isolateRanges(event.summary)}
      subtitle={[calendarLabel(event), event.location ? isolateRanges(event.location) : null].filter(Boolean).join(', ')}
      accessible
      accessibilityLabel={[event.summary, spoken, calendarLabel(event)].filter(Boolean).join(', ')}
    />
  );
}

const styles = StyleSheet.create({
  // Ruled lists run edge to edge (their rows bring their own padding); everything else keeps the page's gutter.
  content: { paddingTop: space.sm },
  gutter: { paddingHorizontal: space.xl },
  month: { paddingHorizontal: space.lg },
  // A block of ruled rows, with the rule over its first row too.
  ruled: { borderTopWidth: 1 },
  footnote: { fontFamily: font.body, fontSize: type.small, textAlign: 'center', marginTop: space.sm },
  section: { marginTop: space.xl },
  dayActions: { marginTop: space.lg, gap: space.xs },
  links: { alignItems: 'flex-start' },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH, paddingVertical: space.xs },
  googleRow: { marginTop: space.xl },
  rowAction: { fontFamily: font.bodySemi, fontSize: type.small },
  hiddenNote: { fontFamily: font.body, fontSize: type.small, marginTop: -space.sm, marginBottom: space.sm },
  empty: { fontFamily: font.body, fontSize: type.small, paddingVertical: space.md },
  dayName: { fontFamily: font.headingSemi },
  shownAbove: { fontFamily: font.body, fontSize: type.small },
  countdown: { fontFamily: font.headingSemi, fontSize: type.body },
  // The margin's type (MarginRow), for words.
  marginWord: { fontFamily: font.bodySemi, fontSize: type.caption, textAlign: 'center' },
});
