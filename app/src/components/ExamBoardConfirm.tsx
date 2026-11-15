/**
 * The sheet of everything after a link or a file was read: "איזה יומן?", "איזו עמודה?" and "לבדוק לפני שמירה", where
 * a student sees what the server found and confirms it before anything is saved (design doc, "באפליקציה" and "שני
 * צעדים"). Opened by `ExamBoard` with the first answer of the server (`first`).
 *
 * It is ONE sheet for the whole flow: a Modal is mounted once, and the steps change its title and its body. Never a
 * Modal for each step: on iOS a Modal that is mounted while another is still being dismissed is not presented, and
 * the student would be left on a screen with nothing on it.
 * - several calendars: pick one (then the confirm step for that calendar);
 * - an Excel table with a column for each class and none of them the student's: pick a column (the same link or file
 *   is read again with it, and the answer is a step again);
 * - confirm, a Google calendar: its name, how many exams it has and the first ones ahead;
 * - confirm, rows: the exams ticked at the top, "אירועים אחרים" folded and not ticked, "N שורות לא נקראו" folded,
 *   where a line can be given a date to come in. A tap on a row's date opens `MonthCalendar` under the row.
 * A confirm step reached through a choice has the way back to it under the title ("לבחור יומן אחר", "לבחור עמודה
 * אחרת"), with nothing read again that was read (V-13); a picked file's name is under the title on every step (V-18).
 *
 * What it decides is in `lib/examBoard.ts` (the selection and its transitions, what is saved, whether the button is
 * on, when closing asks), tested without a screen. This file draws it and makes the calls.
 *
 * A board may hold up to 2,000 rows, a real one about 360, so the rows are a virtualised list (the sheet's
 * `body="list"` on that step only: a list nested in the sheet's ScrollView would draw them all), and a tick must not
 * draw them all again: a row is a `memo` component whose props are strings, numbers and booleans and callbacks that
 * never change, so ticking one draws that one.
 *
 * A save that fails leaves the sheet open, everything as it was, and says why above the button (`saveFailed`); a
 * save for the class the lock refused becomes one for the person alone, every tick kept, and the line says so, alone in
 * the footer; from then on the sheet knows the class has a board, and offers the class no more (`confirmFooter`).
 * A tap beside the sheet does nothing once the student has changed something; the close button, Android's back and
 * "ביטול" then ask "לסגור בלי לשמור?" in the sheet, and the way back to the choice asks "לחזור בלי לשמור את השינויים?"
 * (`leaveQuestion`), since it drops the step's ticks and dates too. While a save or a read is under way nothing closes it.
 *
 * Where it saves: for the class (`saveExamBoard`, or `setExamCalendar` for a calendar), or for the phone alone,
 * which is `onSaveOwn`'s to do.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, View, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import type { BoardRow, BoardSkipped, CalendarPreview, DateStr, DeviceResponse, SaveExamBoardBody } from '@sederyom/shared';
import { previewExamBoard, saveExamBoard, setExamCalendar } from '../device/v2';
import { userSettings } from '../local/userSettings';
import {
  OUT_OF_YEAR_PICK, backLabel, backdropCloses, boardSourceName, calendarExamCount, fileNameLine, chooseTarget, chosenCount, clearMarks, closeAction, closeOffset, confirmFooter, confirmItems,
  foldsAtStart, inSchoolYear, initialSelection, leaveQuestion, markExams, markExamsLabel, pastExamsLine, previewProblem, previewStep, revealOffset, rowsToSave, saveFailed, saveVerdict,
  selectionChanged, setRowDate, setSkippedDate, skippedParts, skippedReason, spareTargetLine, startTarget, toggleRow,
  type BoardChoice, type BoardSource, type BoardStep, type ConfirmItem,
} from '../lib/examBoard';
import { dayDateLabel, formatShortDate, isolateRanges, plural, todayStr } from '../lib/format';
import { mePageTitle } from '../lib/onboarding';
import { marginWeekday } from '../lib/school';
import { storage } from '../widget/feedCache';
import { font, space, type } from '../theme';
import { useAnnounceOnIos } from './announce';
import { AppIcon } from './AppIcon';
import { MonthCalendar } from './MonthCalendar';
import { Checkbox, FilterChip } from './notebook';
import { Sheet } from './Sheet';
import { Button, Ltr, MIN_TOUCH, Text, usePalette } from './ui';

/** What the phone keeps for itself when a board is saved "רק אצלי": the rows, or the calendar. */
export type ChosenBoard =
  | { kind: 'rows'; rows: SaveExamBoardBody['rows'] }
  | { kind: 'calendar'; calendarId: string; name: string | null };

export interface ExamBoardConfirmProps {
  /** What was read, so that a column pick can read it again. */
  source: BoardSource;
  /** The step the first answer of the server led to: a choice, or the confirm screen. */
  first: BoardStep;
  /** Where the board goes by default (`saveTarget`), and whether the person may choose the other place. */
  target: { target: 'class' | 'own'; choice: boolean };
  /** The class has a board already: the line above the button says so when this one is saved for the person alone. */
  classHasBoard: boolean;
  /** The person holds a board of their own: a save for the class ends it, and the line above the button says so (`replacesOwnBoard`). */
  holdsOwnBoard?: boolean;
  /** The board is saved: `'class'` or `'own'`, and the device the server answered with for the class (its `class` has the new board). */
  onDone: (saved: 'class' | 'own', device?: DeviceResponse) => void;
  onClose: () => void;
  /** Keeps the board on the phone alone; throws when it could not (the sheet stays, and says why). */
  onSaveOwn: (chosen: ChosenBoard) => Promise<void>;
}

/** The title of the settings page where a class is picked, for the sentences that send the person there: a parent's page is another one. */
export function mePage(): string {
  return mePageTitle(userSettings().audience === 'parent');
}

const NO_ROWS: BoardRow[] = [];
const NO_SKIPPED: BoardSkipped[] = [];
const keyOf = (item: ConfirmItem): string => item.key;
/** How many of a calendar's upcoming exams are listed. */
const UPCOMING_SHOWN = 5;

const TITLES = { 'pick-calendar': 'איזה יומן?', 'pick-column': 'איזו עמודה?', confirm: 'לבדוק לפני שמירה' } as const;

export function ExamBoardConfirm({ source, first, target, classHasBoard, holdsOwnBoard = false, onDone, onClose, onSaveOwn }: ExamBoardConfirmProps): React.JSX.Element {
  const p = usePalette();
  const [step, setStep] = useState<BoardStep>(first);
  const choice = step.step === 'confirm' ? step.choice : null;
  const rows = choice?.kind === 'rows' ? choice.rows : NO_ROWS;
  const skipped = choice?.kind === 'rows' ? choice.skipped : NO_SKIPPED;

  // What the confirm step opened with. A transition that changes nothing hands back the object it was given, and
  // `selectionChanged` compares what is in them: it is what tells "the student has worked on this" from not. An exam
  // whose day is gone starts unticked (`previewSelection`).
  const [opened, setOpened] = useState(() => initialSelection(rows, skipped, target.target, todayStr()));
  const [selection, setSelection] = useState(opened);
  const [folds, setFolds] = useState(() => foldsAtStart(rows, skipped));
  // The row whose calendar is open (an item's key): one at a time.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A column was picked and the server is reading the link or the file again.
  const [checking, setChecking] = useState(false);
  // A question about leaving with changes is being asked: "לסגור בלי לשמור?", or "לחזור בלי לשמור את השינויים?" on the
  // way back to the choice (`leaveQuestion`).
  const [asking, setAsking] = useState<'close' | 'back' | null>(null);
  // What went wrong, until the person changes something; `refusal`: a class save the lock refused (`saveFailed`).
  const [problem, setProblem] = useState<{ text: string; refusal: boolean } | null>(null);
  // A class save was refused by the lock: the class has a board the phone did not know of, for as long as the sheet is
  // open (V-8), through the way back to the choice and whatever is picked after it (`startTarget`, V-13).
  const [refused, setRefused] = useState(false);
  // The choice the person came to the check step through ("איזה יומן?", "איזו עמודה?"), which the way back returns to
  // as it was; `null` when the link or the file led straight to the check step (V-13).
  const [back, setBack] = useState<Exclude<BoardStep, { step: 'confirm' }> | null>(null);
  // What each column read gave, so that the way back and the same column again ask the server nothing (a read counts
  // against the hourly limit). A column that failed is not kept: picking it again reads it again.
  const columnReads = useRef(new Map<string, BoardStep>());
  // The question in the footer; VoiceOver is told it as Android's live region says it.
  const question = choice && asking ? leaveQuestion(asking) : null;
  useAnnounceOnIos(question?.line ?? null);

  /**
   * The confirm step for `next`, from its start: nothing of an earlier step is carried over, but that the class has a
   * board when the lock refused a class save (`startTarget`). `from`: the choice it was reached through.
   */
  const enterConfirm = (next: BoardChoice, from: Exclude<BoardStep, { step: 'confirm' }>): void => {
    const nextRows = next.kind === 'rows' ? next.rows : NO_ROWS;
    const nextSkipped = next.kind === 'rows' ? next.skipped : NO_SKIPPED;
    const start = initialSelection(nextRows, nextSkipped, startTarget(target.target, refused), todayStr());
    setOpened(start);
    setSelection(start);
    setFolds(foldsAtStart(nextRows, nextSkipped));
    setOpenKey(null);
    setAsking(null);
    setProblem(null);
    setBack(from);
    setStep({ step: 'confirm', choice: next });
  };

  /** A step that a column read led to: the check step, or (rarely) another choice. */
  const goTo = (next: BoardStep, from: Exclude<BoardStep, { step: 'confirm' }>): void => {
    if (next.step === 'confirm') enterConfirm(next.choice, from);
    else setStep(next);
  };

  const pickColumn = async (column: string): Promise<void> => {
    if (checking || step.step !== 'pick-column') return;
    const from = step;
    const read = columnReads.current.get(column);
    if (read) {
      goTo(read, from);
      return;
    }
    setChecking(true);
    setProblem(null);
    try {
      const next = previewStep(await previewExamBoard(storage, { ...source, column }));
      if (next.step === 'problem') {
        setProblem({ text: next.problem, refusal: false });
      } else {
        columnReads.current.set(column, next);
        goTo(next, from);
      }
    } catch (err) {
      setProblem({ text: previewProblem(err, source, mePage()), refusal: false });
    } finally {
      setChecking(false);
    }
  };

  /**
   * Back to the choice as it was, with nothing asked of the server (`goBack`, or "לחזור" in its question). The ticks and
   * dates of this step go; what went wrong goes with the step it was said on (a refused class save is still known: `refused`).
   */
  const backToChoice = (): void => {
    if (back === null || saving || checking) return;
    setOpenKey(null);
    setAsking(null);
    setProblem(null);
    setStep(back);
  };

  // The handlers never change, so a row that is not the one ticked is not drawn again. Each one that changes the
  // selection takes the sentence of what went wrong away (after a refused class save, the footer then says where the
  // board goes in its ordinary words, `confirmFooter`); opening or closing a calendar changes nothing.
  const toggle = useCallback((index: number) => {
    setProblem(null);
    setSelection((s) => toggleRow(s, index));
  }, []);
  const openDate = useCallback((key: string) => setOpenKey((k) => (k === key ? null : key)), []);
  const closeDate = useCallback(() => setOpenKey(null), []);
  const pickRowDate = useCallback((index: number, date: DateStr) => {
    setProblem(null);
    setSelection((s) => setRowDate(s, index, date, rows[index]?.date ?? null));
    setOpenKey(null);
  }, [rows]);
  const resetRowDate = useCallback((index: number) => {
    setProblem(null);
    setSelection((s) => setRowDate(s, index, null));
    setOpenKey(null);
  }, []);
  const pickSkippedDate = useCallback((index: number, date: DateStr) => {
    setProblem(null);
    setSelection((s) => setSkippedDate(s, index, date));
    setOpenKey(null);
  }, []);
  const clearSkipped = useCallback((index: number) => {
    setProblem(null);
    setSelection((s) => setSkippedDate(s, index, null));
    setOpenKey(null);
  }, []);
  const clearAll = useCallback(() => {
    setProblem(null);
    setSelection((s) => clearMarks(s));
    setOpenKey(null);
  }, []);
  const markAllExams = useCallback(() => {
    setProblem(null);
    setSelection((s) => markExams(s, rows, todayStr()));
    setOpenKey(null);
  }, [rows]);
  const toggleFold = useCallback((fold: 'others' | 'skipped') => setFolds((f) => ({ ...f, [fold]: !f[fold] })), []);
  const chooseWhere = (where: 'class' | 'own'): void => {
    setProblem(null);
    setSelection((s) => chooseTarget(s, where));
  };

  // Closing: nothing while a save or a read is under way; with changes, the backdrop is ignored and the other ways
  // (the close button, Android's back, "ביטול") ask first; with none, all of them close at once.
  const busy = saving || checking;
  const changed = choice !== null && selectionChanged(opened, selection);
  const requestClose = (): void => {
    const action = closeAction(changed, busy);
    if (action === 'ask') setAsking('close');
    else if (action === 'close') onClose();
  };

  /**
   * "לבחור יומן אחר" / "לבחור עמודה אחרת": by the same rule as closing (`closeAction`), since it drops the same ticks and
   * dates: with changes it asks "לחזור בלי לשמור את השינויים?" first; with none it goes back at once. Off while a
   * question is asked.
   */
  const goBack = (): void => {
    if (back === null || asking !== null) return;
    const action = closeAction(changed, busy);
    if (action === 'ask') setAsking('back');
    else if (action === 'close') backToChoice();
  };

  const count = choice?.kind === 'rows' ? chosenCount(selection) : null;
  const verdict = saveVerdict(count);
  const forClass = selection.target === 'class';

  const save = async (): Promise<void> => {
    if (saving || !choice || !verdict.enabled) return;
    setSaving(true);
    setProblem(null);
    let device: DeviceResponse | undefined;
    try {
      if (choice.kind === 'rows') {
        const chosen = rowsToSave(rows, skipped, selection);
        if (!forClass) await onSaveOwn({ kind: 'rows', rows: chosen });
        else device = await saveExamBoard(storage, chosen);
      } else if (!forClass) {
        await onSaveOwn({ kind: 'calendar', calendarId: choice.calendar.calendarId, name: choice.calendar.name });
      } else {
        device = await setExamCalendar(storage, choice.calendar.calendarId);
      }
    } catch (err) {
      // The sheet stays, and every tick and every corrected date is kept for the next try. A class save the lock refused
      // becomes one for the person alone, the line says so (`saveFailed`), and the sheet knows the class has a board (V-8).
      const failed = saveFailed(selection, err, mePage());
      setSelection(failed.selection);
      setProblem({ text: failed.problem, refusal: failed.refused });
      if (failed.refused) setRefused(true);
      setSaving(false);
      return;
    }
    setSaving(false);
    onDone(selection.target, device);
  };

  const saveTitle = saving ? 'שומר…' : `${forClass ? 'לשמור לכיתה' : 'לשמור אצלי'}${count === null ? '' : ` (${count})`}`;
  const line = { fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted } as const;
  let footer: React.ReactNode;
  if (question) {
    footer = (
      <View style={styles.footer}>
        <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{question.line}</Text>
        <View style={styles.footerActions}>
          <Button title={question.confirm} variant="danger" onPress={asking === 'back' ? backToChoice : onClose} />
          <Button title="להמשיך לערוך" variant="ghost" onPress={() => setAsking(null)} />
        </View>
      </View>
    );
  } else if (choice) {
    // Where the board goes and what went wrong, in one sentence each, never two that say the same (`confirmFooter`, V-8).
    const facts = { target: selection.target, choice: target.choice, classHasBoard, holdsOwn: holdsOwnBoard, refused, problem };
    const shown = confirmFooter(facts);
    // While the two places are offered, the line keeps room for the other place's line too, so that the footer does not
    // grow or shrink under the chips (`spareTargetLine`, V-17).
    const spare = spareTargetLine(facts);
    footer = (
      <View style={styles.footer}>
        {shown.chips ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="איפה לשמור את הלוח" style={styles.chips}>
            <FilterChip role="radio" label="לכל הכיתה" selected={forClass} disabled={saving} onPress={() => chooseWhere('class')} />
            <FilterChip role="radio" label="רק אצלי" selected={!forClass} disabled={saving} onPress={() => chooseWhere('own')} />
          </View>
        ) : null}
        {shown.targetLine && spare ? (
          // Side by side, each as wide as the footer: the row is as tall as the taller one, and the other is out of view.
          <View style={styles.reserve}>
            <Text style={[line, styles.reserveLine]}>{shown.targetLine}</Text>
            <View style={styles.reserveLine} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={[line, styles.spare]}>{spare}</Text>
            </View>
          </View>
        ) : shown.targetLine ? <Text style={line}>{shown.targetLine}</Text> : null}
        {verdict.line ? <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, lineHeight: 21, color: p.text }}>{verdict.line}</Text> : null}
        {shown.problem ? <Text accessibilityRole="alert" style={[line, { color: p.cancel }]}>{shown.problem}</Text> : null}
        <View style={styles.footerActions}>
          <View style={{ flex: 1 }}>
            <Button title={saveTitle} disabled={!verdict.enabled || saving} onPress={() => void save()} />
          </View>
          <Button title="ביטול" variant="ghost" disabled={saving} onPress={requestClose} />
        </View>
      </View>
    );
  }

  let content: React.ReactNode;
  if (step.step === 'pick-calendar') {
    content = (
      <View style={styles.choiceBody}>
        <Text style={line}>מצאנו בדף כמה יומנים. איזה מהם הוא לוח המבחנים?</Text>
        <View>
          {step.calendars.map((calendar) => (
            <CalendarOption key={calendar.calendarId} calendar={calendar} onPress={() => enterConfirm({ kind: 'calendar', calendar }, step)} />
          ))}
        </View>
      </View>
    );
  } else if (step.step === 'pick-column') {
    content = (
      <View style={styles.choiceBody}>
        <Text style={line}>בלוח יש עמודה לכל כיתה, ולא מצאנו בו את הכיתה. איזו עמודה לבחור?</Text>
        <View>
          {step.columns.map((column) => (
            <ChoiceRow key={column} label={column} spoken={column} disabled={checking} onPress={() => void pickColumn(column)} />
          ))}
        </View>
        {checking ? <Checking /> : null}
        {problem ? <Text accessibilityRole="alert" style={[line, { color: p.cancel }]}>{problem.text}</Text> : null}
      </View>
    );
  } else if (step.choice.kind === 'calendar') {
    content = <CalendarBody calendar={step.choice.calendar} />;
  } else {
    content = (
      <RowsList
        rows={rows}
        skipped={skipped}
        picked={selection.picked}
        dates={selection.dates}
        skippedDates={selection.skippedDates}
        folds={folds}
        openKey={openKey}
        locked={saving || asking !== null}
        onToggle={toggle}
        onOpenDate={openDate}
        onCloseDate={closeDate}
        onPickRowDate={pickRowDate}
        onResetRowDate={resetRowDate}
        onPickSkippedDate={pickSkippedDate}
        onClearSkipped={clearSkipped}
        onToggleFold={toggleFold}
        onClearMarks={clearAll}
        onMarkExams={markAllExams}
      />
    );
  }

  // Under the title: the file being checked (V-18), on every step, and on the check step the way back to the choice it
  // was reached through (V-13), off while a save or a read is under way and while a question is asked. A link is in the
  // field the person typed it in; a file had no name shown anywhere.
  const fileName = boardSourceName(source);
  const backTitle = choice ? backLabel(back) : null;
  const subheader = fileName || backTitle ? (
    <View style={styles.subheader}>
      {fileName ? (
        <Text numberOfLines={1} ellipsizeMode="middle" style={{ fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted }}>
          {fileNameLine(fileName)}
        </Text>
      ) : null}
      {backTitle ? (
        <View style={styles.back}>
          <Button title={backTitle} variant="ghost" disabled={busy || asking !== null} onPress={goBack} />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <Sheet
      visible
      onClose={requestClose}
      dismissable={!busy}
      backdropDismiss={backdropCloses(changed, busy)}
      title={TITLES[step.step]}
      subheader={subheader}
      footer={footer}
      // The list body is for the step that shows the rows list; the other steps scroll as every sheet does.
      body={choice?.kind === 'rows' ? 'list' : 'scroll'}
    >
      {content}
    </Sheet>
  );
}

/** "בודקים את הלוח…", while the server reads: up to half a minute. `file`: the name of the file being read (V-18), on one line under it. */
export function Checking({ file = null }: { file?: string | null }): React.JSX.Element {
  const p = usePalette();
  return (
    <View accessibilityLiveRegion="polite" style={styles.checking}>
      <ActivityIndicator color={p.accent} />
      <View style={styles.checkingText}>
        <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>בודקים את הלוח…</Text>
        {file ? (
          <Text numberOfLines={1} ellipsizeMode="middle" style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>
            {fileNameLine(file)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A row of a choice, ruled: what it is called and, under it, what else is worth knowing. */
function ChoiceRow({ label, spoken, disabled, onPress, children }: {
  label: string;
  /** What a screen reader says of the whole row. */
  spoken: string;
  disabled?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { borderBottomColor: p.border, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{label}</Text>
        {children}
      </View>
      <AppIcon name="chevronLeft" color={p.textMuted} size={18} />
    </Pressable>
  );
}

/** One of several calendars a page led to: its name, how many exams it has and the first one ahead, to know it by. */
function CalendarOption({ calendar, onPress }: { calendar: CalendarPreview; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const name = calendar.name ?? 'יומן Google';
  // A calendar with none yet says so in words, as the confirm step does (V-14).
  const count = calendarExamCount(calendar.count);
  const next = calendar.upcoming[0];
  const muted = { fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted } as const;
  return (
    <ChoiceRow label={name} spoken={[name, count, next ? `הקרוב ${next.subject}` : null].filter(Boolean).join(', ')} onPress={onPress}>
      <Text style={muted}>{count}</Text>
      {next ? (
        <Text numberOfLines={1} style={muted}>
          {'הקרוב: '}
          <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>{formatShortDate(next.date)}</Ltr>
          {` ${isolateRanges(next.subject)}`}
        </Text>
      ) : null}
    </ChoiceRow>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// A calendar

function CalendarBody({ calendar }: { calendar: CalendarPreview }): React.JSX.Element {
  const p = usePalette();
  const soon = calendar.upcoming.slice(0, UPCOMING_SHOWN);
  return (
    <View style={styles.calendarBody}>
      <Text style={{ fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted }}>
        מצאנו יומן Google. אם זה לא לוח המבחנים, אפשר לסגור ולנסות קישור אחר.
      </Text>
      <Text accessibilityRole="header" style={{ fontFamily: font.headingSemi, fontSize: type.title, color: p.text }}>
        {calendar.name ?? 'יומן Google'}
      </Text>
      <Text style={{ fontFamily: font.body, fontSize: type.body, color: p.text }}>
        {calendar.count > 0 ? `${plural(calendar.count, 'מבחן אחד', 'מבחנים')} בשנת הלימודים` : 'עוד אין בו מבחנים בשנת הלימודים'}
      </Text>
      {soon.length > 0 ? (
        <View>
          <Text style={{ fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted, marginBottom: space.xs }}>המבחנים הקרובים</Text>
          {soon.map((exam, i) => (
            <View
              key={`${exam.date}|${i}`}
              accessible
              accessibilityLabel={`${dayDateLabel(exam.date)}, ${exam.subject}`}
              style={[styles.upcoming, { borderBottomColor: p.border }]}
            >
              <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.textMuted }}>{formatShortDate(exam.date)}</Ltr>
              <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.body, color: p.text }}>{isolateRanges(exam.subject)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows

interface RowsListProps {
  rows: readonly BoardRow[];
  skipped: readonly BoardSkipped[];
  picked: readonly boolean[];
  dates: readonly (DateStr | null)[];
  skippedDates: readonly (DateStr | null)[];
  folds: { others: boolean; skipped: boolean };
  openKey: string | null;
  /** A save is under way: nothing on the list can be touched. */
  locked: boolean;
  onToggle: (index: number) => void;
  onOpenDate: (key: string) => void;
  onCloseDate: () => void;
  onPickRowDate: (index: number, date: DateStr) => void;
  onResetRowDate: (index: number) => void;
  onPickSkippedDate: (index: number, date: DateStr) => void;
  onClearSkipped: (index: number) => void;
  onToggleFold: (fold: 'others' | 'skipped') => void;
  onClearMarks: () => void;
  onMarkExams: () => void;
}

function RowsList(props: RowsListProps): React.JSX.Element {
  const { rows, skipped, picked, dates, skippedDates, folds, openKey, locked } = props;
  const { onToggle, onOpenDate, onCloseDate, onPickRowDate, onResetRowDate, onPickSkippedDate, onClearSkipped, onToggleFold, onClearMarks, onMarkExams } = props;
  const p = usePalette();
  // A calendar opened under a row in the lower half of the list would open under the footer: once it is laid out, the
  // list scrolls until it is all in view (`revealOffset`, V-3). The list's frame is what shows above the footer (the
  // sheet puts the footer under the list body), and how far it is scrolled is noted as it scrolls. Neither view that is
  // measured may be flattened away on Android (`collapsable={false}`), or it would have nothing to measure.
  const listRef = useRef<FlatList<ConfirmItem>>(null);
  const frameRef = useRef<View>(null);
  const scrolled = useRef(0);
  // Where the list was when the open calendar was brought into view, and where it went: closing it goes back there, if
  // the person has not scrolled since (`closeOffset`, V-17). `null`: it did not scroll.
  const revealed = useRef<{ before: number; to: number } | null>(null);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolled.current = e.nativeEvent.contentOffset.y;
  }, []);
  const reveal = useCallback((picker: View) => {
    frameRef.current?.measureInWindow((_vx, viewTop, _vw, viewHeight) => {
      picker.measureInWindow((_x, top, _w, height) => {
        const to = revealOffset({ top, bottom: top + height }, { top: viewTop, bottom: viewTop + viewHeight }, scrolled.current, space.sm);
        revealed.current = to === null ? null : { before: scrolled.current, to };
        if (to !== null) listRef.current?.scrollToOffset({ offset: to, animated: true });
      });
    });
  }, []);
  // A calendar closed (a day picked, "סגירה", the date taken back): the list goes back to where it was before it opened.
  const lastOpen = useRef(openKey);
  useEffect(() => {
    if (openKey === lastOpen.current) return;
    if (openKey === null) {
      const back = closeOffset(revealed.current?.before ?? null, revealed.current?.to ?? null, scrolled.current);
      if (back !== null) listRef.current?.scrollToOffset({ offset: back, animated: true });
    }
    // Another row's calendar measures for itself once it is laid out.
    revealed.current = null;
    lastOpen.current = openKey;
  }, [openKey]);
  // The data does not depend on what is ticked: only on the rows and on which folds are open.
  const items = useMemo(() => confirmItems(rows, skipped, folds), [rows, skipped, folds]);
  // What the rows say of themselves: the words of the action that ticks the exams, which says "all" only while it ticks
  // them all, and the line for a board whose exams are all past, which opens with nothing ticked (`markExamsLabel`,
  // `pastExamsLine`). By the rows, so that the rows of another column or calendar say their own, and by the dates the
  // person corrected, which the bulk tick goes by as a save does (a tick leaves `dates` as it was: no new words for it).
  const head = useMemo(() => ({ mark: markExamsLabel(rows, dates, todayStr()), allPast: pastExamsLine(rows, dates, todayStr()) }), [rows, dates]);
  // The same element until the palette or the rows change, so that a save under way does not have the list look at its
  // header again. The two actions are the way out of a board that opens with more rows ticked than a save takes (400).
  const header = useMemo(() => (
    <View style={styles.listHeader}>
      {head.allPast ? (
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, lineHeight: 21, color: p.text, marginBottom: space.xs }}>{head.allPast}</Text>
      ) : null}
      <Text style={{ fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted }}>
        מה שמסומן יישמר. אפשר ללחוץ על תאריך כדי לתקן אותו.
      </Text>
      <View style={styles.bulk}>
        <Button title="לבטל את כל הסימונים" variant="ghost" onPress={onClearMarks} />
        <Button title={head.mark} variant="ghost" onPress={onMarkExams} />
      </View>
    </View>
  ), [p.text, p.textMuted, head, onClearMarks, onMarkExams]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ConfirmItem>): React.JSX.Element | null => {
    if (item.type === 'fold') {
      const label = item.fold === 'others'
        ? `אירועים אחרים (${item.count})`
        : item.count === 1 ? 'שורה אחת לא נקראה' : `${item.count} שורות לא נקראו`;
      return <FoldHeading fold={item.fold} label={label} open={item.open} onToggle={onToggleFold} />;
    }
    if (item.type === 'row') {
      const row = rows[item.index];
      if (!row) return null;
      const corrected = dates[item.index] ?? null;
      return (
        <ConfirmRow
          index={item.index}
          rowKey={item.key}
          title={row.title}
          details={row.details}
          date={corrected ?? row.date}
          corrected={corrected !== null}
          picked={picked[item.index] === true}
          open={openKey === item.key}
          onToggle={onToggle}
          onOpenDate={onOpenDate}
          onCloseDate={onCloseDate}
          onPickDate={onPickRowDate}
          onResetDate={onResetRowDate}
          onShown={reveal}
        />
      );
    }
    const line = skipped[item.index];
    if (!line) return null;
    const { when, title } = skippedParts(line.text);
    return (
      <SkippedRow
        index={item.index}
        rowKey={item.key}
        title={title}
        reason={`${skippedReason(line.reason)}${when ? `: ${when}` : ''}`}
        date={skippedDates[item.index] ?? null}
        open={openKey === item.key}
        onOpenDate={onOpenDate}
        onCloseDate={onCloseDate}
        onPickDate={onPickSkippedDate}
        onClear={onClearSkipped}
        onShown={reveal}
      />
    );
  }, [rows, skipped, picked, dates, skippedDates, openKey, onToggle, onOpenDate, onCloseDate, onPickRowDate, onResetRowDate, onPickSkippedDate, onClearSkipped, onToggleFold, reveal]);

  return (
    <View ref={frameRef} collapsable={false} style={styles.list} pointerEvents={locked ? 'none' : 'auto'}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        initialNumToRender={14}
        maxToRenderPerBatch={14}
        windowSize={9}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />
    </View>
  );
}

/** A fold's heading: "אירועים אחרים (8)", "3 שורות לא נקראו"; a tap opens or closes what is under it. */
const FoldHeading = memo(function FoldHeading({ fold, label, open, onToggle }: {
  fold: 'others' | 'skipped';
  label: string;
  open: boolean;
  onToggle: (fold: 'others' | 'skipped') => void;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={label}
      accessibilityHint={open ? 'מקפל את הרשימה' : 'פותח את הרשימה'}
      onPress={() => onToggle(fold)}
      style={({ pressed }) => [styles.fold, { borderBottomColor: p.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={{ flex: 1, fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{label}</Text>
      <View style={open ? styles.flip : null}>
        <AppIcon name="chevronDown" color={p.textMuted} size={18} />
      </View>
    </Pressable>
  );
});

/**
 * One row of the preview: the box and the words are one control (tick), and the date at the end is another (correct
 * it): siblings, so that a screen reader reaches each. Only strings, numbers, booleans and the list's own stable
 * callbacks come in, so `memo` skips every row but the one that changed.
 */
const ConfirmRow = memo(function ConfirmRow({
  index, rowKey, title, details, date, corrected, picked, open, onToggle, onOpenDate, onCloseDate, onPickDate, onResetDate, onShown,
}: {
  index: number;
  rowKey: string;
  title: string;
  details: string | null;
  date: DateStr;
  corrected: boolean;
  picked: boolean;
  open: boolean;
  onToggle: (index: number) => void;
  onOpenDate: (key: string) => void;
  onCloseDate: () => void;
  onPickDate: (index: number, date: DateStr) => void;
  onResetDate: (index: number) => void;
  /** The calendar under the row was opened and laid out: the list brings it into view. */
  onShown: (picker: View) => void;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[styles.row, { borderBottomColor: p.border }]}>
      <View style={styles.rowLine}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: picked }}
          accessibilityLabel={[title, dayDateLabel(date), corrected ? 'התאריך תוקן' : null].filter(Boolean).join(', ')}
          onPress={() => onToggle(index)}
          style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Checkbox value={picked} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: picked ? p.text : p.textMuted }}>{isolateRanges(title)}</Text>
            {details ? (
              <Text numberOfLines={2} style={{ fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted }}>{isolateRanges(details)}</Text>
            ) : null}
          </View>
        </Pressable>
        <DateButton date={date} corrected={corrected} open={open} onPress={() => onOpenDate(rowKey)} />
      </View>
      {open ? (
        <DatePicker
          date={date}
          resetLabel={corrected ? 'להחזיר את התאריך מהלוח' : null}
          onPick={(d) => onPickDate(index, d)}
          onReset={() => onResetDate(index)}
          onClose={onCloseDate}
          onShown={onShown}
        />
      ) : null}
    </View>
  );
});

/**
 * A line the server could not make a row of: its words, why, and a date to give it. With a date it is chosen (the box
 * is ticked) and goes in with the rest; a tap on the box takes it out again.
 */
const SkippedRow = memo(function SkippedRow({
  index, rowKey, title, reason, date, open, onOpenDate, onCloseDate, onPickDate, onClear, onShown,
}: {
  index: number;
  rowKey: string;
  title: string;
  reason: string;
  date: DateStr | null;
  open: boolean;
  onOpenDate: (key: string) => void;
  onCloseDate: () => void;
  onPickDate: (index: number, date: DateStr) => void;
  onClear: (index: number) => void;
  /** The calendar under the line was opened and laid out: the list brings it into view. */
  onShown: (picker: View) => void;
}): React.JSX.Element {
  const p = usePalette();
  const chosen = date !== null;
  return (
    <View style={[styles.row, { borderBottomColor: p.border }]}>
      <View style={styles.rowLine}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: chosen }}
          accessibilityLabel={`${title}, ${reason}`}
          accessibilityHint={chosen ? 'מוציא את השורה מהלוח' : 'כדי להכניס את השורה צריך לתת לה תאריך'}
          onPress={() => (chosen ? onClear(index) : onOpenDate(rowKey))}
          style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Checkbox value={chosen} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: chosen ? p.text : p.textMuted }}>{isolateRanges(title)}</Text>
            <Text style={{ fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.textMuted }}>{isolateRanges(reason)}</Text>
          </View>
        </Pressable>
        {date ? (
          <DateButton date={date} corrected open={open} onPress={() => onOpenDate(rowKey)} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel="לתת תאריך"
            onPress={() => onOpenDate(rowKey)}
            style={({ pressed }) => [styles.dateButton, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent, textAlign: 'center' }}>לתת תאריך</Text>
          </Pressable>
        )}
      </View>
      {open ? (
        <DatePicker
          date={date}
          resetLabel={chosen ? 'להוציא את השורה' : null}
          onPick={(d) => onPickDate(index, d)}
          onReset={() => onClear(index)}
          onClose={onCloseDate}
          onShown={onShown}
        />
      ) : null}
    </View>
  );
});

/** A date at the end of a row, the day under it; a tap opens the calendar. A date the student gave is in the pen's colour. */
function DateButton({ date, corrected, open, onPress }: { date: DateStr; corrected: boolean; open: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const ink = corrected ? p.accent : p.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`תאריך ${dayDateLabel(date)}, לתקן`}
      onPress={onPress}
      style={({ pressed }) => [styles.dateButton, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: ink, fontVariant: ['tabular-nums'] }}>{formatShortDate(date)}</Ltr>
      <Text style={{ fontFamily: font.body, fontSize: type.caption, color: ink }}>{marginWeekday(date)}</Text>
    </Pressable>
  );
}

/**
 * The month calendar under a row. A day outside the school year is not taken: a row outside it would refuse the
 * whole save, so the student is told here, at the day they tapped.
 *
 * Mounted when it opens: its first layout tells the list (`onShown`), which brings it into view. Only the first: a
 * month of six weeks after one of five changes its height, and the list does not move under the person's finger then.
 */
function DatePicker({ date, resetLabel, onPick, onReset, onClose, onShown }: {
  date: DateStr | null;
  /** The button that takes the date back (or the row out), or `null` when there is nothing to take back. */
  resetLabel: string | null;
  onPick: (date: DateStr) => void;
  onReset: () => void;
  onClose: () => void;
  onShown: (picker: View) => void;
}): React.JSX.Element {
  const p = usePalette();
  const [outside, setOutside] = useState(false);
  const self = useRef<View>(null);
  const shown = useRef(false);
  const laidOut = (): void => {
    if (shown.current || !self.current) return;
    shown.current = true;
    onShown(self.current);
  };
  return (
    <View ref={self} collapsable={false} style={styles.picker} onLayout={laidOut}>
      <MonthCalendar
        date={date}
        initialMonth={date ?? todayStr()}
        onChange={(day) => {
          if (inSchoolYear(day as DateStr, todayStr())) onPick(day as DateStr);
          else setOutside(true);
        }}
      />
      {outside ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.body, fontSize: type.small, lineHeight: 21, color: p.cancel, textAlign: 'center' }}>
          {OUT_OF_YEAR_PICK}
        </Text>
      ) : null}
      <View style={styles.pickerActions}>
        {resetLabel ? <Button title={resetLabel} variant="ghost" onPress={onReset} /> : null}
        <Button title="סגירה" variant="ghost" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  reserve: { flexDirection: 'row', overflow: 'hidden' },
  reserveLine: { width: '100%', flexShrink: 0 },
  spare: { opacity: 0 },
  subheader: { gap: 2, paddingBottom: space.xs },
  // A text button carries its own side padding: pulled back so that its words line up with the title above.
  back: { alignSelf: 'flex-start', marginStart: -space.md },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  calendarBody: { gap: space.md },
  choiceBody: { gap: space.md },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH + space.md, paddingVertical: space.sm, borderBottomWidth: 1 },
  checking: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  checkingText: { flexShrink: 1 },
  listHeader: { marginBottom: space.xs },
  // Text buttons carry their own side padding: pulled back so that their words line up with the line above.
  bulk: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, marginStart: -space.md },
  upcoming: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.xl, paddingBottom: space.md },
  fold: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH + space.sm, borderBottomWidth: 1 },
  // A fold's chevron points down when closed and up when open, as every disclosure does.
  flip: { transform: [{ rotate: '180deg' }] },
  row: { borderBottomWidth: 1 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md, minHeight: MIN_TOUCH + space.sm },
  dateButton: { minWidth: 56, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  picker: { paddingBottom: space.sm },
  pickerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
});
