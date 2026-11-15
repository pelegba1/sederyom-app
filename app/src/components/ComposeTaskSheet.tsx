/**
 * The compose / edit sheet for a Google task: title, notes, a due date and,
 * for a new task, the list. It owns its create / update / delete calls, so
 * any screen can open it:
 *
 *   <ComposeTaskSheet visible={open} initialDate={day} onClose={close} />
 *   <ComposeTaskSheet visible={open} initialDate={day} initialTitle="שיעורי בית בפיזיקה" onClose={close} />
 *   <ComposeTaskSheet visible={open} task={task} onClose={close} />
 *
 * The due-date chips are the days people pick (R-13): "היום", "מחר", "יום
 * הלימודים הבא" (when tomorrow is a Friday or a Saturday), "בעוד שבוע", "ללא
 * תאריך", and "תאריך אחר", which opens a month grid. The chip shows a date
 * only once a day is picked in the grid ("תאריך אחר · 18.10"), and paging
 * the grid's months picks nothing (W4-12c, Noa). Exam days are marked in the
 * grid. Editing selects the chip the task's date belongs to (B9). A new
 * task whose title names a day ("מחר לסיים דוח", "עד ה־12.10") is offered
 * that day in one tap, never set behind the student's back (Daniel).
 *
 * The sheet is built on `Sheet`: the fields scroll, and the save button stays
 * pinned under them, month grid open or not. Enter in the title saves too.
 * Deleting closes the sheet at once and says "נמחקה" with "החזרה", which
 * creates the task again (W4, Daniel: the sheet stayed up for seconds).
 *
 * Editing offers the list too (W5-19, Maya and Daniel): another list moves
 * the task — created there with the edits, then deleted from the old list,
 * as "החזרה" after a delete brings one back (`movedTaskBody`).
 *
 * Wave 9 (plan §16.1): the fields are underlined (the page's light fill, a
 * rule under them that turns blue while typing), the date and list choices
 * are `FilterChip`s, the date offered from the title is a text button, and
 * the footer has one primary button with "ביטול" as text beside it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { DateStr, Task, TasksResponse } from '@sederyom/shared';
import { keys, useCreateTask, useDeleteTask, useSchool, useTasks, useUpdateTask } from '../api/hooks';
import { AppIcon } from './AppIcon';
import { MarkLegend, MonthCalendar } from './MonthCalendar';
import { FilterChip } from './notebook';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Ltr, MIN_TOUCH, Text, TextInput, usePalette } from './ui';
import { formatShortDate, todayStr, weekdayName } from '../lib/format';
import { examDayMarks } from '../lib/planning';
import { dateInText } from '../lib/school';
import {
  canSubmitTask, composeDue, dueChoiceFor, dueOptions, movedTaskBody, movesTask, restoreTaskBody, rtlPlaceholder, taskToastText, type DueChoice,
} from '../lib/planner';
import { font, radius, space, type } from '../theme';

export interface ComposeTaskSheetProps {
  /** Defaults to true, so the sheet can also be shown by mounting it. */
  visible?: boolean;
  /** A new task's due date; omitted or null starts on "ללא תאריך". Ignored when editing. */
  initialDate?: DateStr | null;
  /** A new task's title to start from ("שיעורי בית בפיזיקה"); empty when omitted. Ignored when editing. */
  initialTitle?: string | null;
  /** The task to edit; omitted or null composes a new one. */
  task?: Task | null;
  /** Called on cancel, after a successful save, and at once on delete. */
  onClose: () => void;
}

/** The preset chips' names; each but "ללא תאריך" is followed by its date. */
const PRESET_LABELS: Record<Exclude<DueChoice, 'custom'>, string> = {
  today: 'היום',
  tomorrow: 'מחר',
  nextSchoolDay: 'יום הלימודים הבא',
  nextWeek: 'בעוד שבוע',
  none: 'ללא תאריך',
};

const TITLE_PLACEHOLDER = rtlPlaceholder('מה צריך לעשות?');
const NOTES_PLACEHOLDER = rtlPlaceholder('פרטים, קישורים או תזכורת לעצמך');

/**
 * The left-to-right isolates `Ltr` draws (U+2066 … U+2069), for a date inside
 * a chip's label, which is a plain string: "מחר, 11.10" keeps its date whole.
 */
const LRI = '⁦';
const PDI = '⁩';

/** "מחר, 11.10": a due chip's name and its date, the date pinned left to right. */
function chipLabel(name: string, date: DateStr): string {
  return `${name}, ${LRI}${formatShortDate(date)}${PDI}`;
}

export function ComposeTaskSheet({
  visible = true, initialDate = null, initialTitle = null, task = null, onClose,
}: ComposeTaskSheetProps): React.JSX.Element {
  const p = usePalette();
  const qc = useQueryClient();
  const toast = useToast();
  const tasks = useTasks();
  const school = useSchool();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const lists = tasks.data?.lists ?? [];
  const pending = createTask.isPending || updateTask.isPending;
  // Editing can create too: a move to another list.
  const error = (createTask.error ?? (task ? updateTask.error : null))?.message ?? null;

  const [title, setTitle] = useState('');
  const [choice, setChoice] = useState<DueChoice>('none');
  // The day picked in the month grid; '' until one is.
  const [custom, setCustom] = useState('');
  // The month the grid opens on while no day is picked.
  const [pickerMonth, setPickerMonth] = useState(() => todayStr());
  const [listId, setListId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  // The field being typed in: its rule in the app's blue, never the platform's own ring — an
  // orange one on the title "looked like an error" (Daniel, run 5). The ring is cleared, not
  // coloured: drawn around an underlined field it would be a frame again.
  const [focused, setFocused] = useState<'title' | 'notes' | null>(null);
  const frame = (field: 'title' | 'notes') => {
    const on = focused === field;
    return [{ borderBottomColor: on ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 }, on ? styles.inputFocused : null];
  };

  useEffect(() => {
    if (visible) {
      // A fresh sheet shows no error left over from the last attempt.
      createTask.reset();
      updateTask.reset();
      setTitle(task?.title ?? initialTitle ?? '');
      setNotes(task?.notes ?? '');
      const date = task ? task.due : initialDate;
      const first = dueChoiceFor(date, todayStr());
      setChoice(first);
      // A date of the task's own counts as picked; a preset's date does not.
      setCustom(first === 'custom' && date ? date : '');
      setPickerMonth(date ?? todayStr());
      setListId(task?.listId ?? null);
    }
    // Runs on opening only; the mutation objects are deliberately not deps.
  }, [visible, task, initialDate, initialTitle]);

  const today = todayStr();
  const presets = useMemo(() => dueOptions(today), [today]);
  // The chip's date, or the day picked under "תאריך אחר"; both save through the same `submit`.
  const { due } = composeDue(choice, custom, today);
  const customDate = choice === 'custom' ? due : null;
  const selectedList = listId ?? lists[0]?.id ?? null;
  // "תאריך אחר" without a day picked yet has nothing to save.
  const canSubmit = canSubmitTask({ title, choice, custom, pending, today });
  const examMarks = useMemo(() => examDayMarks(school.data?.exams ?? []), [school.data]);
  const hasExamMarks = Object.keys(examMarks).length > 0;
  // A new task whose title names a day ("מחר לסיים דוח", "עד ה־12.10") is offered that day in one tap (Daniel).
  const mentioned = task ? null : dateInText(title, today);
  const suggested = mentioned && mentioned >= today && mentioned !== due ? mentioned : null;

  const dueChips: { key: DueChoice; label: string; a11y: string }[] = [
    ...presets.map((option) => {
      const name = PRESET_LABELS[option.key];
      return option.date
        ? {
          key: option.key,
          label: chipLabel(name, option.date),
          a11y: `${name}, ${weekdayName(option.date)} ${formatShortDate(option.date)}`,
        }
        : { key: option.key, label: name, a11y: name };
    }),
    {
      key: 'custom',
      label: customDate ? chipLabel('תאריך אחר', customDate) : 'תאריך אחר',
      a11y: customDate ? `תאריך אחר, ${weekdayName(customDate)} ${formatShortDate(customDate)}` : 'תאריך אחר, בחירה מלוח החודש',
    },
  ];

  /** Sets the due date to `date`: its preset chip, or "תאריך אחר" with the day picked. */
  const applyDate = (date: DateStr): void => {
    const key = dueChoiceFor(date, today);
    if (key === 'custom') {
      setCustom(date);
      setPickerMonth(date);
    }
    setChoice(key);
  };

  const pickDue = (key: DueChoice): void => {
    if (key === 'custom' && choice !== 'custom') {
      // The month grid needs the room the keyboard takes, and opens on the month of the date chosen so far.
      Keyboard.dismiss();
      setPickerMonth(due ?? today);
    }
    setChoice(key);
  };

  const submit = (): void => {
    if (!canSubmit) return;
    const cleanTitle = title.trim();
    const cleanNotes = notes.trim() || null;
    if (task && movesTask(task, listId)) {
      move(task, listId, { title: cleanTitle, notes: cleanNotes, due });
    } else if (task) {
      updateTask.mutate({ id: task.id, body: { title: cleanTitle, due, notes: cleanNotes } }, { onSuccess: onClose });
    } else {
      createTask.mutate(
        { title: cleanTitle, due, notes: cleanNotes, ...(selectedList ? { listId: selectedList } : {}) },
        { onSuccess: () => { onClose(); toast.show('המשימה נוספה'); } },
      );
    }
  };

  /**
   * Moves the task to `target` (W5-19). Google Tasks cannot move a task: it is
   * created in the new list with the edits — the sheet stays open, "שומר…",
   * until that is done, and shows the error if it fails, the old task
   * untouched — then the old one is deleted. A completed task stays
   * completed. Promises, not `mutate` callbacks: the screen may unmount the
   * sheet once it closes.
   */
  const move = (moving: Task, target: string, edits: Pick<Task, 'title' | 'notes' | 'due'>): void => {
    const listTitle = lists.find((l) => l.id === target)?.title ?? null;
    createTask.mutateAsync(movedTaskBody(moving, edits, target)).then((created) => {
      onClose();
      void qc.cancelQueries({ queryKey: keys.tasks });
      qc.setQueryData<TasksResponse>(keys.tasks, (prev) => (prev
        ? { ...prev, items: [...prev.items.filter((t) => t.id !== moving.id && t.id !== created.id), { ...created, completed: moving.completed }] }
        : prev));
      toast.show(taskToastText(listTitle ? `הועברה ל״${listTitle}״` : 'הועברה', created.title));
      deleteTask.mutateAsync(moving.id).catch(() => {
        void qc.invalidateQueries({ queryKey: keys.tasks });
        toast.show('המשימה נוספה לרשימה החדשה, אבל לא נמחקה מהקודמת. אפשר למחוק אותה שם');
      });
      if (moving.completed) updateTask.mutateAsync({ id: created.id, body: { completed: true } }).catch(() => undefined);
    }, () => undefined);
  };

  /**
   * Closes at once and takes the task off the list; "החזרה" creates it again
   * once the delete has gone through. Promises, not `mutate` callbacks: the
   * screen may unmount this sheet as soon as it closes.
   */
  const remove = (): void => {
    if (!task) return;
    const removed = task;
    onClose();
    // A refetch already on its way would land with the task still in it.
    void qc.cancelQueries({ queryKey: keys.tasks });
    qc.setQueryData<TasksResponse>(keys.tasks, (prev) => (prev ? { ...prev, items: prev.items.filter((t) => t.id !== removed.id) } : prev));
    const gone = deleteTask.mutateAsync(removed.id);
    gone.catch(() => {
      void qc.invalidateQueries({ queryKey: keys.tasks });
      toast.show('לא הצלחנו למחוק את המשימה. אפשר לנסות שוב');
    });
    toast.show(taskToastText('נמחקה', removed.title), {
      onAction: () => {
        gone
          .then(async () => {
            const created = await createTask.mutateAsync(restoreTaskBody(removed));
            qc.setQueryData<TasksResponse>(keys.tasks, (prev) => (prev && !prev.items.some((t) => t.id === created.id)
              ? { ...prev, items: [...prev.items, created] }
              : prev));
            if (removed.completed) await updateTask.mutateAsync({ id: created.id, body: { completed: true } });
          }, () => undefined)
          .catch(() => toast.show('לא הצלחנו להחזיר את המשימה. אפשר להוסיף אותה שוב'));
      },
    });
  };

  const footer = (
    <View>
      {error ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.body, fontSize: type.small, color: p.cancel, marginBottom: space.sm }}>{error}</Text>
      ) : null}
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button title={pending ? 'שומר…' : task ? 'לשמור שינויים' : 'להוסיף משימה'} disabled={!canSubmit} onPress={submit} />
        </View>
        <Button title="ביטול" variant="ghost" disabled={pending} onPress={onClose} />
      </View>
    </View>
  );

  return (
    // A stray tap outside must not throw away a title the student already typed;
    // the footer's "ביטול" still closes it.
    <Sheet visible={visible} onClose={onClose} dismissable={!pending && (Boolean(task) || title.trim().length === 0)} title={task ? 'עריכת משימה' : 'משימה חדשה'} footer={footer}>
      <Text style={fieldLabel(p)}>כותרת</Text>
      <TextInput
        accessibilityLabel="כותרת המשימה"
        value={title}
        onChangeText={setTitle}
        placeholder={TITLE_PLACEHOLDER}
        placeholderTextColor={p.textFaint}
        autoFocus
        returnKeyType="done"
        // Enter saves when there is a title; without one it does nothing and the keyboard stays.
        submitBehavior="submit"
        onSubmitEditing={() => {
          if (!canSubmit) return;
          Keyboard.dismiss();
          submit();
        }}
        onFocus={() => setFocused('title')}
        onBlur={() => setFocused((f) => (f === 'title' ? null : f))}
        style={[styles.input, { color: p.text, backgroundColor: p.surfaceAlt }, frame('title')]}
      />
      {suggested ? (
        // A text button with its icon, not a framed pill (plan §16.1).
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`תאריך יעד לפי הכותרת: ${weekdayName(suggested)} ${formatShortDate(suggested)}`}
          onPress={() => applyDate(suggested)}
          style={({ pressed }) => [styles.suggest, { opacity: pressed ? 0.6 : 1 }]}
        >
          <AppIcon name="calendar" color={p.accent} size={18} />
          <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>
            {`לקבוע ל${weekdayName(suggested)} `}<Ltr>{formatShortDate(suggested)}</Ltr>
          </Text>
        </Pressable>
      ) : null}

      <Text style={fieldLabel(p)}>הערות</Text>
      <TextInput
        accessibilityLabel="הערות למשימה"
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder={NOTES_PLACEHOLDER}
        placeholderTextColor={p.textFaint}
        onFocus={() => setFocused('notes')}
        onBlur={() => setFocused((f) => (f === 'notes' ? null : f))}
        style={[styles.input, { minHeight: 75, textAlignVertical: 'top', color: p.text, backgroundColor: p.surfaceAlt }, frame('notes')]}
      />

      <Text style={fieldLabel(p)}>תאריך יעד</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="תאריך יעד">
        {dueChips.map((chip) => (
          <FilterChip
            key={chip.key}
            role="radio"
            label={chip.label}
            accessibilityLabel={chip.a11y}
            selected={chip.key === choice}
            onPress={() => pickDue(chip.key)}
          />
        ))}
      </View>
      {choice === 'custom' ? (
        <View style={{ marginBottom: space.md }}>
          <MonthCalendar
            date={customDate}
            initialMonth={pickerMonth}
            onChange={setCustom}
            marks={hasExamMarks ? examMarks : undefined}
          />
          {hasExamMarks ? <MarkLegend kinds={['exam']} /> : null}
          {customDate ? null : (
            <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, textAlign: 'center', marginTop: space.sm }}>
              צריך לבחור יום בלוח
            </Text>
          )}
        </View>
      ) : null}

      {lists.length > 1 ? (
        // Editing too: another list moves the task there (W5-19).
        <>
          <Text style={fieldLabel(p)}>רשימה</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="רשימה">
            {lists.map((list) => (
              <FilterChip key={list.id} role="radio" label={list.title} selected={list.id === selectedList} onPress={() => setListId(list.id)} />
            ))}
          </View>
        </>
      ) : null}

      {task ? (
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button title="למחוק את המשימה" variant="danger" disabled={pending} onPress={remove} />
        </View>
      ) : null}
    </Sheet>
  );
}

function fieldLabel(p: ReturnType<typeof usePalette>) {
  return { fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted, marginBottom: 6 } as const;
}

const styles = StyleSheet.create({
  // An underlined field (plan §16.1): the page's light fill, a rule under it, round at the top only.
  // Right to left, placeholder included: "מה צריך לעשות?" ends on the left (Daniel, run 3).
  input: {
    borderBottomWidth: 1, borderTopStartRadius: radius.sm, borderTopEndRadius: radius.sm,
    paddingTop: 12, paddingBottom: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, marginBottom: space.md, textAlign: 'right', writingDirection: 'rtl',
  },
  // Typing: the rule turns blue and thickens, and the text does not move.
  inputFocused: { borderBottomWidth: 2, paddingBottom: 11 },
  // Between two chips, and between two rows of them: their 44-point targets meet, never overlap.
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm, rowGap: space.sm, marginBottom: space.md },
  suggest: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: MIN_TOUCH,
    marginTop: -space.sm, marginBottom: space.sm,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
