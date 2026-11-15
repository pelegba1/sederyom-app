/**
 * משימות (design panel 03): the tasks are kept on the phone until Google is
 * connected, and in Google after (`tasksHome`); Mashov homework sits
 * underneath. The compose sheet offers the due dates that matter most and a
 * list picker.
 *
 * Ticking a task offers "החזרה" (F9); tapping a row opens it for editing, and
 * the FAB is the one way to add (F15). The status chips filter the homework
 * too, by due date (B11).
 *
 * Wave 3: one empty state per filter for tasks and homework together (R-12);
 * a homework row is School's — "עשיתי" ticks it off, with "החזרה", and only
 * the box toggles (R-14); "הושלמו" says when each task was completed, and
 * the list ends clear of the FAB (R-15).
 *
 * Wave 4:
 * - One row of status chips, and the list as a menu beside the search, so
 *   the tasks start on the first screen (Itai; Daniel: two rows of chips,
 *   each selected in its own style).
 * - Homework here has no "הוסף למשימות שלי": it is already on this screen
 *   (Itai). Since W6-4 School's rows offer it nowhere; its homework sheet
 *   has "להעתיק ל־Google Tasks", which makes a linked task.
 * - A tap that closes a sheet does not also open the row under it (Maya).
 *
 * Wave 5:
 * - One list (W5-18, Itai, the third run in a row): open homework sits among
 *   the tasks by due date, its kind "שיעורי בית" in words, with "עשיתי" on
 *   its box; the header counts both. Run 4 served the homework all along (the
 *   evening reminder named it): it sat in its own section under all ten
 *   tasks, and the header counted the tasks alone.
 * - A ticked row stays a moment, ticked and struck through, then fades out
 *   (W5-19, Daniel: "it just vanishes").
 *
 * Undated rows sit under "בלי תאריך". (Wave 7 listed Google Classroom work
 * here too; the phone reads no Classroom, plan 2f.)
 *
 * Wave 9 (plan §16, the notebook): the list is ruled rows on the page with
 * the red margin line, not cards with tinted pills. The margin holds the due
 * date ("היום", "מחר", "6.10"), in the red pen with "באיחור" under it for
 * every late row alike (the review: one of two late tasks had a red frame).
 * The row's title is the work itself; the muted line under it names the list,
 * or the subject and the kind, in words. The box is at the row's start,
 * right after the margin (its `lead`), so the "+" at the end side never
 * covers the last row's box. The search is an underlined field, the list
 * picker a text button, the filters `FilterChip`s, and the "+" the extended
 * "+ משימה".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { RouteProp } from '@react-navigation/native';
import type { HomeworkItem, Task, TaskListOption } from '@sederyom/shared';
import { useSchool, useSetHomeworkDone, useStatus, useSyncNow, useTasks } from '../api/hooks';
import { AppIcon } from '../components/AppIcon';
import { CheckTarget, DueMargin, TaskRow, useSheetPressGuard, useTaskToggle } from '../components/TaskRow';
import { ComposeTaskSheet } from '../components/ComposeTaskSheet';
import { Fab, FilterChip, MarginList, MarginRow, Row, useFabListClearance } from '../components/notebook';
import { SearchField } from '../components/SearchField';
import { Sheet } from '../components/Sheet';
import { TabHeader } from '../components/TabHeader';
import { useToast } from '../components/Toast';
import { Button, EmptyState, ErrorState, Loading, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { isDemo } from '../demo/phone';
import { CONNECTION_COPY, tasksHome } from '../lib/connections';
import { isolateRanges, shownSubject, todayStr } from '../lib/format';
import {
  COUNT_SEPARATOR, TICK_LINGER_MS, counterLine, dueMarginText, isLate, rtlPlaceholder, schoolListId, scrollEndOffset, selectHomework,
  selectTasks, tasksEmptyState, todoCounter, todoEntries, type TaskFilter, type TodoEntry,
} from '../lib/planner';
import { UNDATED_HEADING, undatedHeadingAt } from '../lib/classroom';
import { cleanText, isOverdue } from '../lib/school';
import { homeworkDueParts, partsText } from '../lib/today';
import { font, space, type } from '../theme';
import type { RootNavigation, TabsParamList } from '../navigation/types';

const TITLE = 'המשימות שלי';

const FILTERS: readonly { key: TaskFilter; label: string }[] = [
  { key: 'open', label: 'פתוחות' },
  { key: 'today', label: 'היום' },
  { key: 'tomorrow', label: 'מחר' },
  { key: 'overdue', label: 'באיחור' },
  { key: 'completed', label: 'הושלמו' },
];

const ALL_LISTS = 'כל הרשימות';
const SEARCH_PLACEHOLDER = rtlPlaceholder('חיפוש בכותרות ובהערות…');
/** A homework row's kind, in words under its title (W5-18: it was a tinted pill). */
const HOMEWORK_KIND = 'שיעורי בית';

/**
 * Rows just ticked or unticked, which stay in place for `TICK_LINGER_MS`
 * (W5-19): the set of their ids, and the call that adds one.
 */
function useLinger(): [ReadonlySet<string>, (id: string) => void] {
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
  }, []);
  const linger = useCallback((id: string) => {
    setKept((prev) => new Set(prev).add(id));
    const running = timers.current.get(id);
    if (running) clearTimeout(running);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setKept((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, TICK_LINGER_MS));
  }, []);
  return [kept, linger];
}

export function TasksScreen({ route, navigation }: { route: RouteProp<TabsParamList, 'Tasks'>; navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const tasks = useTasks();
  const school = useSchool();
  const sync = useSyncNow();
  const toggle = useTaskToggle();
  const toggleHomework = useHomeworkToggle();
  const status = useStatus();
  const press = useSheetPressGuard();
  const [keptTasks, lingerTask] = useLinger();
  const [keptHomework, lingerHomework] = useLinger();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [listFilter, setListFilter] = useState<string | null>(null);
  const [listMenu, setListMenu] = useState(false);
  const [search, setSearch] = useState('');
  // Room under the last row for the "+" and a toast over it (R-15), at the text size in use.
  const clearance = useFabListClearance();
  const today = todayStr();

  // The FAB on Today deep-links here with `compose: true`.
  useEffect(() => {
    if (route.params?.compose) {
      setEditing(null);
      setComposing(true);
      // Consume the request so the home FAB works again after closing the sheet.
      navigation.navigate('Tabs', { screen: 'Tasks', params: { compose: false } });
    }
  }, [route.params?.compose]);

  if (tasks.isLoading) return <Screen><TabHeader title={TITLE} /><Loading /></Screen>;
  if (tasks.isError) {
    return (
      <Screen>
        <TabHeader title={TITLE} />
        <ErrorState message={(tasks.error as Error).message} onRetry={() => void tasks.refetch()} />
      </Screen>
    );
  }

  const allItems = tasks.data?.items ?? [];
  const lists = tasks.data?.lists ?? [];
  const items = selectTasks(allItems, { today, filter, listId: listFilter, search, keep: keptTasks });
  const open = allItems.filter(t => !t.completed);
  const home = tasksHome(status.data?.sources.find(s => s.source === 'google_tasks'));
  const mashov = status.data?.sources.find(s => s.source === 'mashov');
  const allHomework = school.data?.homework ?? [];
  const taskIds = tasks.data ? new Set(allItems.map(t => t.id)) : null;
  const listTitle = lists.find(l => l.id === listFilter)?.title ?? ALL_LISTS;
  // Why the homework cannot be listed yet, or 'ready'.
  const homeworkFeed: 'disconnected' | 'error' | 'loading' | 'ready' =
    mashov && !mashov.configured && allHomework.length === 0 ? 'disconnected'
      : school.isError && allHomework.length === 0 ? 'error'
        : school.isLoading ? 'loading'
          : 'ready';
  // Homework is school work: listed with all the lists, or with the "בית ספר" one.
  const homeworkInList = listFilter === null || listFilter === schoolListId(lists);
  const homework = homeworkFeed === 'ready' && homeworkInList
    ? selectHomework(allHomework, { today, filter, search, taskIds, keep: keptHomework })
    : [];
  const entries = todoEntries(items, homework, filter);
  const undatedAt = undatedHeadingAt(entries, filter);
  const empty = tasksEmptyState({
    filter,
    search: search.trim() !== '',
    tasks: items.length,
    // Another list than school's: the message is about its tasks alone.
    homework: homeworkFeed === 'ready' && homeworkInList ? homework.length : null,
  });
  // The header counts what is open of both, whatever the filters below (W5-18).
  const openHomework = homeworkFeed === 'ready' ? selectHomework(allHomework, { today, filter: 'open', search: '', taskIds }) : null;
  const count = todoCounter({
    tasks: open.length,
    homework: openHomework === null ? null : openHomework.length,
    overdue: open.filter(t => t.due && t.due < today).length + (openHomework ?? []).filter(h => isOverdue(h, today)).length,
  });

  const compose = (): void => {
    setEditing(null);
    setComposing(true);
  };
  const edit = press.guard((task: Task): void => {
    setEditing(task);
    setComposing(true);
  });
  const closeSheet = (): void => {
    setComposing(false);
    press.sheetClosed();
  };
  // A tick keeps the row a moment, ticked, before it leaves the filter (W5-19).
  const tickTask = press.guard((task: Task): void => {
    lingerTask(task.id);
    toggle(task);
  });
  const tickHomework = press.guard((hw: HomeworkItem): void => {
    lingerHomework(hw.naturalKey);
    toggleHomework(hw);
  });
  /** Whether a kept row no longer belongs under the filter: it is on its way out. */
  const leaving = (done: boolean): boolean => (filter === 'completed' ? !done : done);

  // "21 פתוחות" (one count, run 8) and then, in the red pen, "2 באיחור" (plan §16.2: no chain of "·").
  // Free to wrap to a second line, but only after a comma: "אחת באיחור" is never cut (W6-9; it
  // read "10 משימות · 9 שיעורי בית · אחת באי…", Maya and Daniel, run 5).
  const line = counterLine(count);
  const counter = (
    <Text numberOfLines={2} style={{ flexShrink: 1, fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>
      {line.text}
      {line.overdue ? (
        <>
          {COUNT_SEPARATOR}
          <Text style={{ color: p.cancel }}>{line.overdue.slice(COUNT_SEPARATOR.length)}</Text>
        </>
      ) : null}
    </Text>
  );

  return (
    <Screen>
      <TabHeader title={TITLE} subtitle={counter} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={sync.isPending} onRefresh={() => sync.mutate()} tintColor={p.accent} />}
      >
        {home === 'reauth' ? (
          <View style={[styles.gutter, { alignItems: 'flex-start', marginBottom: space.sm }]}>
            <Button title="להתחבר ל־Google Tasks" variant="ghost" onPress={() => navigation.navigate('Connections')} />
          </View>
        ) : null}
        <View style={[styles.gutter, styles.searchRow]}>
          <SearchField label="חיפוש במשימות ובשיעורי הבית" placeholder={SEARCH_PLACEHOLDER} value={search} onChangeText={setSearch} />
          {lists.length > 1 ? (
            // The list picker as a text button (Daniel: "a separate menu for the lists").
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`רשימה: ${listTitle}`}
              accessibilityHint="לבחירת רשימה"
              onPress={() => setListMenu(true)}
              style={({ pressed }) => [styles.listButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text numberOfLines={1} style={[styles.listButtonText, { color: p.accent, fontFamily: listFilter ? font.bodySemi : font.bodyMedium }]}>
                {listTitle}
              </Text>
              <AppIcon name="chevronDown" color={p.accent} size={16} />
            </Pressable>
          ) : null}
        </View>
        <ChipRow fadeId="status">
          {FILTERS.map(f => (
            <FilterChip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ChipRow>
        {sync.isError ? (
          <Text accessibilityRole="alert" style={[styles.gutter, { fontFamily: font.body, fontSize: type.small, color: p.cancel, marginBottom: space.md }]}>
            לא הצלחנו לרענן עכשיו. מוצגות המשימות האחרונות שנשמרו.
          </Text>
        ) : null}

        {empty.text ? (
          <View style={styles.gutter}><EmptyState text={empty.text} /></View>
        ) : entries.length > 0 ? (
          // Tasks and homework in one ruled list, by due date (W5-18).
          <MarginList style={[styles.list, { borderTopColor: p.border }]}>
            {entries.map((entry, i) => (
              <React.Fragment key={entryKey(entry)}>
                {i === undatedAt ? (
                  // "בלי תאריך": a quiet heading row over the undated rows, its margin empty.
                  <MarginRow
                    accessible
                    accessibilityRole="header"
                    accessibilityLabel={UNDATED_HEADING}
                    title={UNDATED_HEADING}
                    titleStyle={[styles.heading, { color: p.textMuted }]}
                  />
                ) : null}
                {entry.kind === 'task' ? (
                  <RowFade leaving={keptTasks.has(entry.task.id) && leaving(entry.task.completed)}>
                    <TaskRow
                      task={entry.task}
                      onToggle={tickTask}
                      onPress={edit}
                      showList={lists.length > 1 && listFilter === null}
                      showNotes
                      showCompletedDate
                    />
                  </RowFade>
                ) : (
                  <RowFade leaving={keptHomework.has(entry.homework.naturalKey) && leaving(entry.homework.done)}>
                    <HomeworkRow hw={entry.homework} today={today} onToggle={tickHomework} />
                  </RowFade>
                )}
              </React.Fragment>
            ))}
          </MarginList>
        ) : null}

        {/* Homework that cannot be listed yet says why, under the tasks. */}
        {empty.homeworkNote && homeworkInList ? (
          <View style={[styles.gutter, { marginTop: entries.length > 0 || empty.text ? space.lg : 0 }]}>
            {homeworkFeed === 'disconnected' ? (
              <EmptyState
                text="שיעורי הבית ממשוב יופיעו כאן אחרי חיבור למשוב"
                action={{ label: 'להתחבר למשוב', onPress: () => navigation.navigate('Connections') }}
              />
            ) : homeworkFeed === 'error' ? (
              <Text style={[styles.note, { color: p.textMuted }]}>לא הצלחנו לטעון את שיעורי הבית. אפשר למשוך למטה כדי לנסות שוב.</Text>
            ) : (
              <Text style={[styles.note, { color: p.textMuted }]}>טוענים את שיעורי הבית…</Text>
            )}
          </View>
        ) : null}

        {/* The demo's tasks are its own copy, never Google's (`demo/mode.ts`): neither line shows there. */}
        {isDemo() ? null : home === 'phone' ? (
          <View style={[styles.gutter, styles.phoneNote]}>
            <Text style={[styles.footnote, { color: p.textMuted }]}>{CONNECTION_COPY.tasksOnPhone}</Text>
            <Button title={CONNECTION_COPY.tasksConnect} variant="ghost" onPress={() => navigation.navigate('Connections')} />
          </View>
        ) : home === 'google' || home === 'reauth' ? (
          <Text style={[styles.gutter, styles.footnote, { color: p.textMuted }]}>המשימות נשארות ב־Google Tasks, ואפשר לערוך אותן גם שם</Text>
        ) : null}
      </ScrollView>

      <Fab accessibilityLabel="משימה חדשה" onPress={compose} />

      <ComposeTaskSheet
        key={editing?.id ?? 'new'}
        task={editing}
        visible={composing}
        onClose={closeSheet}
      />
      <ListMenu
        visible={listMenu}
        lists={lists}
        selected={listFilter}
        onSelect={(id) => setListFilter(id)}
        onClose={() => {
          setListMenu(false);
          press.sheetClosed();
        }}
      />
    </Screen>
  );
}

/**
 * The task lists, one to show or all of them (Daniel: "a separate menu for
 * the lists"), as ruled rows; the chosen one carries a drawn tick. Choosing
 * one closes the menu.
 */
function ListMenu({ visible, lists, selected, onSelect, onClose }: {
  visible: boolean;
  lists: readonly TaskListOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const options: { id: string | null; title: string }[] = [{ id: null, title: ALL_LISTS }, ...lists];
  return (
    <Sheet visible={visible} onClose={onClose} title="איזו רשימה להציג">
      <View>
        {options.map((l) => {
          const active = selected === l.id;
          return (
            <Row
              key={l.id ?? 'all'}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={l.title}
              title={l.title}
              titleStyle={active ? { color: p.accent } : { fontFamily: font.body }}
              end={active ? <AppIcon name="check" color={p.accent} size={20} /> : null}
              onPress={() => {
                onSelect(l.id);
                onClose();
              }}
              style={styles.menuRow}
            />
          );
        })}
      </View>
    </Sheet>
  );
}

/**
 * "עשיתי" on a homework row (R-14): ticks it off, or back on, with "החזרה" —
 * the pattern of `useTaskToggle`. The flip is optimistic in the school feed
 * this screen reads, so the row leaves "פתוחות" at once; "החזרה" waits for
 * the first request, so the two cannot land out of order. The mark stays in
 * the app: nothing is sent to Mashov or the teacher.
 */
function useHomeworkToggle(): (item: HomeworkItem) => void {
  const { mutateAsync, mutate } = useSetHomeworkDone();
  const toast = useToast();
  return useCallback((item: HomeworkItem) => {
    const was = item.done;
    const first = mutateAsync({ key: item.naturalKey, done: !was });
    first.catch(() => toast.show('לא הצלחנו לשמור את הסימון. אפשר לנסות שוב'));
    toast.show(was ? 'הוחזר לשיעורי הבית הפתוחים' : 'סומן אצלך. המורה לא רואה את זה.', {
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

/** A struck, muted title: a row that is done (ticked a moment ago, or under "הושלמו"). */
function doneTitle(p: ReturnType<typeof usePalette>) {
  return { color: p.textFaint, textDecorationLine: 'line-through' } as const;
}

/**
 * One homework item among the tasks (W5-18), a task row's shape so the list
 * reads as one: its due date in the margin, the box after it, the assignment
 * as its title, and the subject and "שיעורי בית" muted under it. The box's
 * label says "עשיתי" (R-14: the tick stays in the app, nothing is sent to the
 * teacher). No "הוסף למשימות שלי": it is on this list already (W4, Itai).
 * Tapping the row shows the whole assignment; only the box ticks it off.
 */
function HomeworkRow({ hw, today, onToggle }: {
  hw: HomeworkItem;
  today: string;
  onToggle: (hw: HomeworkItem) => void;
}): React.JSX.Element {
  const p = usePalette();
  const [expanded, setExpanded] = useState(false);
  const subject = shownSubject(hw);
  const text = cleanText(hw.text);
  const due = homeworkDueParts(hw, today);
  return (
    <MarginRow
      margin={<DueMargin text={dueMarginText(hw.dueDate, today)} late={isLate(hw.dueDate, today, hw.done)} />}
      title={text ? isolateRanges(text) : subject}
      titleLines={expanded ? undefined : 2}
      titleStyle={hw.done ? doneTitle(p) : null}
      subtitle={text ? `${subject}, ${HOMEWORK_KIND}` : HOMEWORK_KIND}
      lead={(
        <CheckTarget
          checked={hw.done}
          label={`עשיתי: שיעורי בית ב${subject}`}
          hint="הסימון לא נשלח למורה"
          onPress={() => onToggle(hw)}
        />
      )}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`שיעורי בית ב${subject}: ${text}. ${partsText(due)}`}
      accessibilityHint={expanded ? 'מקצר את הטקסט' : 'מציג את כל הטקסט'}
      onPress={() => setExpanded((v) => !v)}
    />
  );
}

/** A row's React key: unique across both kinds. */
function entryKey(entry: TodoEntry): string {
  return entry.kind === 'task' ? `t-${entry.task.id}` : `h-${entry.homework.naturalKey}`;
}

/**
 * A row of the list, faded out at the end of its stay once it is ticked
 * (W5-19): the tick and the strike-through show first, then the row goes.
 * Back to full the moment it belongs again ("החזרה", or a second tap).
 */
function RowFade({ leaving, children }: { leaving: boolean; children: React.ReactNode }): React.JSX.Element {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!leaving) {
      opacity.setValue(1);
      return undefined;
    }
    const fade = Animated.timing(opacity, { toValue: 0, duration: FADE_MS, delay: TICK_LINGER_MS - FADE_MS, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [leaving, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/** How long a ticked row takes to fade, at the end of `TICK_LINGER_MS`. */
const FADE_MS = 300;

/** How far the chip row's fade reaches in from the edge. */
const FADE = 44;

/**
 * A horizontal row of `FilterChip`s that may not fit the screen. It runs to
 * the screen's edges. When it overflows (a larger text size, and the chosen
 * chip's tick), the far end (the left, in RTL) fades out over the chip it
 * cuts, with a "‹" on the fade, so it reads as "there is more this way" (F15)
 * — the fade alone read as a word cut short, "הושל…" (Maya, run 5, W6-9).
 * Once the last chip is in view, both go. The trailing padding equals the
 * fade, so the last chip ends clear of it. `flexGrow: 0`: a horizontal
 * ScrollView inside the vertical one would otherwise grow to fill it.
 */
function ChipRow({ children, fadeId }: { children: React.ReactNode; fadeId: string }): React.JSX.Element {
  const p = usePalette();
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  // Where the scroll ends, read off the first move (`scrollEndOffset`): platforms count a right-to-left row differently.
  const end = useRef<number | null>(null);
  const overflow = viewport > 0 && content > viewport + 1;
  const gradient = `chipFade-${fadeId}`;
  const onScroll = (x: number): void => {
    const max = content - viewport;
    if (max <= 0) return;
    if (end.current === null) {
      // A report at rest (0) before any move says nothing about the direction.
      if (Math.abs(x) < 1) return;
      end.current = scrollEndOffset(x, max);
    }
    setAtEnd(Math.abs(x - end.current) < 2);
  };
  return (
    <View style={styles.chipRow}>
      <ScrollView
        horizontal
        // While a field has the keyboard, a tap on a chip is the chip's.
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        scrollEventThrottle={32}
        onScroll={(e) => onScroll(e.nativeEvent.contentOffset.x)}
        onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContent(width)}
        contentContainerStyle={[styles.chips, { paddingEnd: overflow ? FADE : space.xl }]}
      >
        {children}
      </ScrollView>
      {overflow && !atEnd ? (
        <View pointerEvents="none" style={styles.fade}>
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={p.bg} stopOpacity={1} />
                <Stop offset="0.45" stopColor={p.bg} stopOpacity={0.9} />
                <Stop offset="1" stopColor={p.bg} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradient})`} />
          </Svg>
          <View style={styles.fadeArrow}>
            <AppIcon name="chevronLeft" color={p.textMuted} size={20} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The ruled list runs edge to edge (its rows bring their own padding); everything else keeps the page's gutter.
  content: { paddingTop: space.sm },
  gutter: { paddingHorizontal: space.xl },
  // The list's first rule, so its top row is ruled above as well as under.
  list: { borderTopWidth: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  listButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: MIN_TOUCH, maxWidth: '45%', paddingHorizontal: space.xs },
  listButtonText: { flexShrink: 1, fontSize: type.label },
  // The sheet brings its own side padding.
  menuRow: { paddingStart: 0, paddingEnd: 0 },
  chipRow: { marginBottom: space.md },
  chips: { flexDirection: 'row', gap: 6, paddingStart: space.xl },
  // The row's end edge: the left, since the app lays out right to left. The "‹" sits on its outer half.
  // Logical, not physical: lib/rtl.ts swaps the physical sides under RTL.
  fade: { position: 'absolute', top: 0, bottom: 0, insetInlineEnd: 0, width: FADE },
  fadeArrow: { position: 'absolute', top: 0, bottom: 0, insetInlineEnd: 4, justifyContent: 'center' },
  note: { fontFamily: font.body, fontSize: type.label, paddingVertical: space.md },
  // "בלי תאריך": a quiet label over the undated rows, not a title.
  heading: { fontFamily: font.bodySemi, fontSize: type.small },
  footnote: { fontFamily: font.body, fontSize: type.small, textAlign: 'center', marginTop: space.xxl },
  // The phone note and its button, centered like the footnote.
  phoneNote: { alignItems: 'center' },
});
