/**
 * One Google task as a ruled row of a `MarginList` (plan §16.1): the due date
 * in the margin ("היום", "מחר", "6.10"), the checkbox right after it (the
 * row's `lead`, clear of the "+" at the end), the title, and a muted line
 * under it. Used on the timeline, the week's day detail, the
 * planning tab and the task list; put it in a `MarginList` (components/notebook)
 * with the rows around it, and the list draws the red margin line.
 *
 * A late task is late the same way everywhere (the review: one of two late
 * tasks had a red frame, the other none): its date in the red pen, and
 * "באיחור" under it in the margin. Under a "באיחור" heading (`underLate`,
 * Today's late section) the word is not said twice; the muted line says how
 * late instead ("לפני 3 ימים"). A completed task is struck through and muted.
 *
 * The task list also passes `onPress` (the whole row opens the task for
 * editing), `showList`, `showNotes` and `showCompletedDate`; a list that names
 * its day already (planning's chosen day, the week's day) passes `margin={null}`.
 * `useTaskToggle` is the tick with a "החזרה" toast (F9), for any screen that
 * wants it: `<TaskRow task={t} onToggle={useTaskToggle()} />`.
 *
 * The box is F's `Checkbox` in a 48-point control (W4, Itai: "small, easy to
 * miss on the bus"), `CheckTarget`, which the homework and Classroom rows use
 * too. `useSheetPressGuard` keeps the tap that closes a sheet from also
 * landing on the row under it (Maya).
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Task } from '@sederyom/shared';
import { useUpdateTask } from '../api/hooks';
import { font, type } from '../theme';
import { countdownLabel, daysUntil, isolateRanges, todayStr } from '../lib/format';
import { completedLabel, completedText, dueMarginText, isLate, pressAllowed, taskDueText, toggleToastText } from '../lib/planner';
import { partsText, type Part } from '../lib/today';
import { Checkbox, CHECKBOX_SIZE, MarginRow } from './notebook';
import { useToast } from './Toast';
import { Ltr, Text, usePalette } from './ui';

/** The control around the 20-point box, past `MIN_TOUCH`. */
export const CHECKBOX_TARGET = 48;

/**
 * The box at a row's start (its `lead`) with its 48-point control
 * (`CHECKBOX_TARGET`): role `checkbox`, its state, and a label that names the
 * item ("עשיתי: שיעורי בית באנגלית"). The control reaches 14 points past the
 * box on each side, into the slot's gaps, so the box itself sits `LEAD_GAP`
 * from the margin line and from the title, and the row is no taller for it.
 */
export function CheckTarget({
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
      onPress={onPress}
      style={({ pressed }) => [styles.checkTarget, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Checkbox value={checked} />
    </Pressable>
  );
}

/**
 * What a dated row writes in its margin (`dueMarginText`): "היום", "מחר" or
 * the date, muted, or in the red pen when the row is late, with "באיחור"
 * under it (`sayLate`). `note` is a second line of its own (a Classroom
 * hour). `color` writes it in another ink (`onMark`, on a chosen row). Nothing
 * for an undated row.
 */
export function DueMargin({
  text, late = false, sayLate = true, note, color: ink,
}: {
  text: string | null;
  late?: boolean;
  sayLate?: boolean;
  note?: string | null;
  color?: string;
}): React.JSX.Element | null {
  const p = usePalette();
  if (!text) return null;
  const color = ink ?? (late ? p.cancel : p.textMuted);
  const second = late && sayLate ? LATE_WORD : late ? null : note ?? null;
  // A number goes through `Ltr`, which takes the line's size and colour from around it.
  const content = (value: string) => (/\d/.test(value) ? <Ltr>{value}</Ltr> : value);
  return (
    <View style={styles.margin}>
      <Text style={[styles.marginText, { color }]}>{content(text)}</Text>
      {second ? (
        // The margin is 56 points wide whatever the text size: its longest word, "באיחור", grows
        // only so far that it still fits at the phone's largest font scale too.
        <Text maxScale={MARGIN_NOTE_MAX_SCALE} maxFontSizeMultiplier={1.3} style={[styles.marginNote, { color }]}>
          {content(second)}
        </Text>
      ) : null}
    </View>
  );
}

/** How far the in-app text size grows the margin's second line (`DueMargin`). */
const MARGIN_NOTE_MAX_SCALE = 1.15;

/** Under a late row's date in the margin, in the red pen. */
export const LATE_WORD = 'באיחור';

export interface TaskRowProps {
  task: Task;
  onToggle?: (task: Task) => void;
  /** Tapping the row, anywhere but the checkbox: opens the task for editing. */
  onPress?: (task: Task) => void;
  /** Adds the task's list ("בית ספר") to the line under the title. */
  showList?: boolean;
  /** Adds the first line of the task's notes under the title. */
  showNotes?: boolean;
  /**
   * A completed task says when it was completed — "הושלמה ב־8.10" — under
   * its title (R-15).
   */
  showCompletedDate?: boolean;
  /**
   * The row sits under a "באיחור" heading (Today's late section): the margin
   * does not say "באיחור" again, and the line under the title says how late —
   * "לפני 3 ימים", or "אתמול" — in the red pen (`taskDueText`).
   */
  underLate?: boolean;
  /**
   * The line under the title, for a task carried to another day's list: it
   * names its own day and date, "להגשה ביום ו׳ 9.10" (`carriedDueParts`): its
   * own words said "מחר" under "להגשה עד יום ראשון" (run 7).
   */
  dueParts?: Part[] | null;
  /**
   * What the margin says in place of the due date. `null` leaves it empty: a
   * list that already names the day (planning's chosen day, the week's day).
   */
  margin?: React.ReactNode;
}

export function TaskRow({
  task, onToggle, onPress, showList = false, showNotes = false, showCompletedDate = false, underLate = false, dueParts = null, margin,
}: TaskRowProps): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const done = showCompletedDate && task.completed ? completedLabel(task.updated, today) : null;
  const due = task.due && !done && !dueParts ? taskDueText(task.due, { completed: task.completed, underLate }) : null;
  const carried = !done && dueParts && dueParts.length > 0 ? dueParts : null;
  const late = isLate(task.due, today, task.completed);
  const howLate = late && underLate && !carried && task.due ? countdownLabel(daysUntil(task.due)) : null;
  const list = showList && task.listTitle ? task.listTitle : null;
  const notes = showNotes && task.notes ? firstLine(task.notes) : null;

  const lead = done ? (
    <Text>
      {done.lead}
      {done.date ? <Ltr>{done.date}</Ltr> : null}
    </Text>
  ) : carried ? (
    <Text>{carried.map((part, i) => (part.ltr ? <Ltr key={i}>{part.text}</Ltr> : <Text key={i}>{part.text}</Text>))}</Text>
  ) : howLate ? (
    <Text style={{ color: p.cancel }}>{howLate}</Text>
  ) : null;

  const meta = lead || list ? (
    <Text numberOfLines={1} style={[styles.muted, { color: p.textMuted }]}>
      {lead}
      {lead && list ? ', ' : null}
      {list}
    </Text>
  ) : null;

  const marginNode = margin !== undefined
    ? margin
    : <DueMargin text={dueMarginText(task.due, today)} late={late} sayLate={!underLate} />;

  const box = (
    <CheckTarget
      checked={task.completed}
      label={`${task.completed ? 'ביטול הסימון' : 'סימון כבוצע'}: ${task.title}`}
      onPress={() => onToggle?.(task)}
    />
  );

  return (
    <MarginRow
      margin={marginNode}
      title={isolateRanges(task.title)}
      titleLines={2}
      titleStyle={task.completed ? { color: p.textFaint, textDecorationLine: 'line-through' } : null}
      lead={box}
      {...(onPress
        ? {
          onPress: () => onPress(task),
          accessibilityLabel: [task.title, done ? completedText(done) : carried ? partsText(carried) : due?.text, list].filter(Boolean).join(', '),
          accessibilityHint: 'לעריכת המשימה',
        }
        : {})}
    >
      {notes ? (
        <Text numberOfLines={1} style={[styles.muted, { color: p.textMuted }]}>{isolateRanges(notes)}</Text>
      ) : null}
      {meta}
    </MarginRow>
  );
}

function firstLine(notes: string): string | null {
  return notes.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

/**
 * Ticks a task off, or back on, and shows "הושלמה: <the task> · החזרה" (F9;
 * W4, Daniel: "הושלמה" alone did not say which). The update is optimistic,
 * so a ticked task leaves an "open" list at once; "החזרה" waits for the
 * first PATCH and sends the opposite one, which brings it back.
 */
export function useTaskToggle(): (task: Task) => void {
  const { mutateAsync, mutate } = useUpdateTask();
  const toast = useToast();
  return useCallback((task: Task) => {
    const was = task.completed;
    const first = mutateAsync({ id: task.id, body: { completed: !was } });
    first.catch(() => toast.show('לא הצלחנו לעדכן את המשימה. אפשר לנסות שוב'));
    toast.show(toggleToastText(task), {
      onAction: () => {
        first.then(
          () => mutate(
            { id: task.id, body: { completed: was } },
            { onError: () => toast.show('לא הצלחנו לבטל. אפשר לנסות שוב') },
          ),
          () => undefined,
        );
      },
    });
  }, [mutateAsync, mutate, toast]);
}

export interface SheetPressGuard {
  /** Call when a sheet over the list closes (its X, "ביטול", a save, a delete). */
  sheetClosed: () => void;
  /** `fn`, but ignored for `SHEET_CLOSE_GUARD_MS` after a sheet closed. */
  guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
}

/**
 * Keeps the tap that closes a sheet from also pressing what was under it: the
 * X of "עריכת משימה" closed the sheet and opened the task row beneath the X,
 * twice in a row (Maya, run 3). Rows and checkboxes on a screen that opens a
 * sheet go through `guard`; the sheet's `onClose` calls `sheetClosed`.
 */
export function useSheetPressGuard(): SheetPressGuard {
  const closedAt = useRef<number | null>(null);
  return useMemo<SheetPressGuard>(() => ({
    sheetClosed: () => {
      closedAt.current = Date.now();
    },
    guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A): void => {
      if (pressAllowed(Date.now(), closedAt.current)) fn(...args);
    },
  }), []);
}

const styles = StyleSheet.create({
  // A 48-point control around the 20-point box. As wide as the box in the row's layout: the rest
  // reaches into the lead slot's gaps, so the box sits 12 from the margin line and 12 from the title.
  checkTarget: {
    width: CHECKBOX_TARGET,
    height: CHECKBOX_TARGET,
    marginHorizontal: -(CHECKBOX_TARGET - CHECKBOX_SIZE) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  margin: { alignItems: 'center', gap: 1 },
  // The margin's own type (MarginRow): `bodySemi` at `small`, tabular numerals.
  marginText: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'], textAlign: 'center' },
  marginNote: { fontFamily: font.bodySemi, fontSize: type.caption, fontVariant: ['tabular-nums'], textAlign: 'center' },
  muted: { fontFamily: font.body, fontSize: type.small },
});
