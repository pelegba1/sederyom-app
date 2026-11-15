/**
 * "לוח המבחנים" (design doc, "באפליקציה" and "לוח משלי, כשלכיתה כבר יש לוח"), on "המבחנים שלי". It
 * replaces `ExamCalendarLink`, which took a Google calendar's link only.
 *
 * A school's exam schedule is brought from a link (a page of the school's site, a Google calendar or a Google sheet)
 * or from an Excel file. Nothing is saved from here: the server reads it (`previewExamBoard`) and says what it found,
 * and the student goes on in `ExamBoardConfirm`, one sheet for the rest of the flow: a choice when the server found
 * several calendars, or an Excel table with a column for each class and none of them the student's, and then the
 * confirm step. This component only opens that sheet, with the first answer, and closes it.
 *
 * Without a board the block is the form. With one (the class's, or the phone's own, `lib/examBoard.ts`) it says
 * whose the board is and what it is, and offers what the person may do (`blockActions`): bring a newer one, take the
 * class's away for everyone, bring one for themselves only, turn the class's off for themselves ("בלי הלוח של
 * הכיתה"), and take their own away or turn the class's back on. Who may do what is `boardOwner`, `bringTarget` and
 * `blockActions`'s to say. What changes the class (a save, a removal) asks the server; what stays on the phone does
 * not (`useOwnBoardActions`), and the class's board is back at once when the phone's own is taken away.
 *
 * Reading a link can take half a minute: while it does, the controls are off and a line says so. The demo has no
 * server to read for, so every control answers "בהדגמה זה לא נשמר" and does nothing else.
 *
 * It sits on "המבחנים שלי", and in onboarding's exams step when the class has no exams and no board (`examStepOffersBoard`):
 * there without its heading (`showHeading`), and the step reads its exams again after a save (`onSaved`).
 *
 * The phone's own board comes in as `own` (`useOwnBoard`, from the screen that holds this block, which also needs it).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { DeviceClass, DeviceResponse } from '@sederyom/shared';
import { useOwnBoardActions, useSettings } from '../api/hooks';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { previewExamBoard, refreshFeed, setExamCalendar, storedFeed } from '../device/v2';
import {
  CANCEL_LABEL, FILE_UNREADABLE, OWN_HIDDEN_TOAST, afterClassSave, blockActions, blockQuestion, boardOwner, boardProblem, boardSourceName, boardStatusLine, bringTarget, classHasBoard, fileProblemSentence,
  holdsOwnBoard,
  ownRemovedToast, ownSavedToast, previewProblem, previewStep, removalFailed, sourceLine,
  type BlockActionId, type BlockQuestion, type BoardSource, type BoardStep,
} from '../lib/examBoard';
import { pickBoardFile } from '../lib/pickBoardFile';
import type { OwnBoard } from '../local/ownBoard';
import { storage } from '../widget/feedCache';
import { font, radius, space, type } from '../theme';
import { Checking, ExamBoardConfirm, mePage, type ChosenBoard } from './ExamBoardConfirm';
import { useToast } from './Toast';
import { Button, MIN_TOUCH, Text, TextInput, usePalette } from './ui';

/** The sheet that is open: what was read, and the step the server's first answer led to. A new flow is a new sheet. */
interface Flow {
  id: number;
  source: BoardSource;
  first: BoardStep;
}

const INTRO = 'יש לך את לוח המבחנים? אפשר להדביק קישור אליו, גם לדף באתר בית הספר, או לבחור קובץ אקסל. כל הכיתה תראה אותו.';

interface ExamBoardProps {
  /** The phone's own board (`useOwnBoard`), when it keeps one: a board of its own, or the class's board turned off. */
  own?: OwnBoard | null;
  /**
   * A board was saved for the class (not one kept on the phone alone). Called as the sheet closes, right after the block
   * starts reading the class's feed and invalidating every query (`settle`): that carries on behind the call and is not
   * done when this is called. A screen that holds state of its own and needs the new exams reads them itself, feed first.
   */
  onSaved?: () => void;
  /** `false` leaves the block's heading out, for a screen whose own words already say what the block is for (onboarding's exams step). */
  showHeading?: boolean;
}

export function ExamBoard({ own = null, onSaved, showHeading = true }: ExamBoardProps): React.JSX.Element {
  const p = usePalette();
  const qc = useQueryClient();
  const toast = useToast();

  // The class as the phone last read it; `answered` is the class as the server just said it after a save or a
  // removal, until the next read of the feed is in (so the line that says what the board is is right at once). Read
  // again whenever /settings has been read again, since every refresh of the feed ends in one: a block that stays
  // mounted across a refresh would otherwise go on showing whose the board was (and a classmate's save after it).
  const settings = useSettings();
  const [version, setVersion] = useState(0);
  const [answered, setAnswered] = useState<DeviceClass | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the read time is the signal: the feed is not state.
  const stored = useMemo(() => storedFeed(storage)?.class ?? null, [version, settings.dataUpdatedAt]);
  const cls = answered ?? stored;

  const owner = boardOwner(cls, own);
  const info = cls?.examBoard ?? null;
  const hasBoard = classHasBoard(cls);
  const whose = sourceLine(owner, hasBoard);
  const status = boardStatusLine(owner, cls, own);
  const actions = blockActions(owner, info);
  // Where a board brought now goes: by the class as it is under the phone's own board, which the board in hand does not change.
  const saveTo = bringTarget(cls, own);
  const ownActions = useOwnBoardActions();

  const [link, setLink] = useState('');
  const [focused, setFocused] = useState(false);
  // `pick`: the system's file picker is open, or the file just picked is being read; `check`: the server is reading.
  const [busy, setBusy] = useState<'pick' | 'check' | 'remove' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The name of the file the server is reading, under "בודקים את הלוח…" (V-18); `null` for a link, which is in its field.
  const [readingFile, setReadingFile] = useState<string | null>(null);
  // With a board the form is closed until "להעלות לוח מעודכן" and the like open it.
  const [adding, setAdding] = useState(false);
  // The one question that is open (`blockQuestion`): never two at once.
  const [asking, setAsking] = useState<BlockQuestion | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const flows = useRef(0);

  const showForm = owner === 'none' || adding;
  const checking = busy === 'check';

  /** Asks the server what is at the link or in the file; what it found opens the sheet that goes on from there. */
  const runPreview = async (source: BoardSource): Promise<void> => {
    if (isDemo()) {
      setBusy(null);
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    // The keyboard of the link field would stay up under the sheet that opens after the wait.
    Keyboard.dismiss();
    setBusy('check');
    setReadingFile(boardSourceName(source));
    setProblem(null);
    try {
      const next = previewStep(await previewExamBoard(storage, source));
      if (next.step === 'problem') {
        setProblem(next.problem);
      } else {
        flows.current += 1;
        setFlow({ id: flows.current, source, first: next });
      }
    } catch (err) {
      // A link that leads to a file that cannot be read is said of the link, not as a file that was picked (V-12).
      setProblem(previewProblem(err, source, mePage()));
    } finally {
      setBusy(null);
      setReadingFile(null);
    }
  };

  const checkLink = (): void => {
    const typed = link.trim();
    if (busy !== null || typed.length === 0) return;
    void runPreview({ link: typed });
  };

  const chooseFile = async (): Promise<void> => {
    if (busy !== null) return;
    // The demo has no server to send a file to: not even the picker opens.
    if (isDemo()) {
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    // Busy from the moment the picker opens: a second tap would open a second picker, which fails, and a file that was
    // fine would be reported as unreadable.
    setBusy('pick');
    setProblem(null);
    let picked: Awaited<ReturnType<typeof pickBoardFile>>;
    try {
      picked = await pickBoardFile();
    } catch {
      setBusy(null);
      setProblem(FILE_UNREADABLE);
      return;
    }
    if (picked === null) {
      // Cancelled: nothing went wrong, and no sentence from before stays on the screen.
      setBusy(null);
      setProblem(null);
      return;
    }
    if (picked === 'too_big' || picked === 'unsupported') {
      setBusy(null);
      setProblem(fileProblemSentence(picked));
      return;
    }
    await runPreview({ file: picked });
  };

  const closeFlow = (): void => {
    setFlow(null);
    setProblem(null);
  };

  /**
   * A board was saved: the sheets close. For the class, the class is read again so that the lists have the new exams (and a
   * board of the person's own, which would hide them, is removed once that read is in: `settle`); for the phone alone the
   * screens were told already, as it was kept (`saveOwn`), and nothing is asked of the server.
   */
  const done = (saved: 'class' | 'own', device?: DeviceResponse): void => {
    setFlow(null);
    setAdding(false);
    setLink('');
    setProblem(null);
    if (saved === 'own') {
      toast.show(ownSavedToast());
      return;
    }
    // A save that failed never gets here.
    void settle(device?.class ?? null, own);
    onSaved?.();
  };

  /**
   * The class's feed read again, and whether it was: what the server just said of the class (`answer`) shows at once,
   * until the read is in.
   */
  const readClassAgain = async (answer: DeviceClass | null): Promise<boolean> => {
    if (answer) setAnswered(answer);
    const fresh = await refreshFeed(storage).catch(() => null);
    if (fresh) {
      setAnswered(null);
      setVersion((v) => v + 1);
    }
    return fresh !== null;
  };

  /**
   * After a save for the class: the class's feed, then every query that is made of it. The person's own board hides the
   * class's on their phone: it goes only once the class's feed was read again, so the lists are never left with neither
   * board; a read that fails leaves it (`afterClassSave`, which says which in the toast). So does "בלי הלוח של הכיתה" left
   * from a class with no board, which would hide the board just saved (R1).
   */
  const settle = async (answer: DeviceClass | null, ownBefore: OwnBoard | null): Promise<void> => {
    await afterClassSave(ownBefore, {
      readFeed: () => readClassAgain(answer),
      removeOwn: ownActions.removeOwn,
      toast: toast.show,
    });
    void qc.invalidateQueries();
  };

  /**
   * "רק אצלי": the confirmed board stays on the phone, with no request to the server. A calendar is read at once, and a
   * first read that fails is a save that failed: the board before is back, and the sheet says so and stays as it was,
   * every tick kept. So does a phone that could not write.
   */
  const saveOwn = async (chosen: ChosenBoard): Promise<void> => {
    if (chosen.kind === 'rows') ownActions.keepRows(chosen.rows);
    else await ownActions.keepCalendar(chosen.calendarId, chosen.name);
  };

  const remove = async (): Promise<void> => {
    if (busy !== null) return;
    if (isDemo()) {
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    setBusy('remove');
    setProblem(null);
    try {
      const device = await setExamCalendar(storage, null);
      setAsking(null);
      toast.show('הלוח הוסר');
      void readClassAgain(device.class).then(() => qc.invalidateQueries());
    } catch (err) {
      // Refused by the lock: someone has replaced the board since this phone read it. The class is read again, so that the
      // block stops offering a removal it cannot make, and the question goes with it (R2).
      const failed = removalFailed(err, mePage());
      setProblem(failed.problem);
      if (failed.readAgain) {
        setAsking(null);
        void readClassAgain(null).then(() => qc.invalidateQueries());
      }
    } finally {
      setBusy(null);
    }
  };

  /** A change that stays on the phone: the demo keeps nothing, and a phone that could not write says so and the board is as it was. */
  const changeOwn = (change: () => void, toastText: string): void => {
    if (isDemo()) {
      setAsking(null);
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    try {
      change();
    } catch (err) {
      setProblem(boardProblem(err, mePage()));
      return;
    }
    setAsking(null);
    setProblem(null);
    toast.show(toastText);
  };

  /** A tap on one of the block's actions: a form to open, a question to ask, or (the class's board back on) a change to make. */
  const act = (id: BlockActionId): void => {
    setProblem(null);
    if (id === 'add') setAdding(true);
    else if (id === 'restore-class') changeOwn(ownActions.removeOwn, ownRemovedToast('none', hasBoard));
    else setAsking(id);
  };

  /** "כן" to the question that is open. */
  const answerYes = (): void => {
    if (asking === 'remove-class') void remove();
    else if (asking === 'hide-class') changeOwn(ownActions.hideClassBoard, OWN_HIDDEN_TOAST);
    else if (asking === 'remove-own') changeOwn(ownActions.removeOwn, ownRemovedToast(own?.kind ?? 'rows', hasBoard));
  };

  const question = asking ? blockQuestion(asking, hasBoard) : null;
  const quiet = actions.filter((a) => a.quiet);
  const main = actions.filter((a) => !a.quiet);
  // "לא מתאים?" before "להביא לוח רק לעצמי": a muted line, not words on the button.
  const lead = main.find((a) => a.lead)?.lead ?? null;

  const line = { fontFamily: font.body, fontSize: type.small, lineHeight: 21 } as const;

  return (
    <View style={styles.block}>
      {showHeading ? (
        <Text accessibilityRole="header" style={{ fontFamily: font.headingSemi, fontSize: type.title, color: p.text }}>
          לוח המבחנים
        </Text>
      ) : null}

      {owner === 'none' ? (
        <Text style={[line, { color: p.textMuted }]}>{INTRO}</Text>
      ) : (
        <View style={styles.whose}>
          {whose ? <Text style={[line, { color: p.text }]}>{whose}</Text> : null}
          {status ? <Text style={[line, { color: p.textMuted }]}>{status}</Text> : null}
        </View>
      )}

      {owner !== 'none' && !adding && question === null && actions.length > 0 ? (
        <View style={styles.block}>
          {lead ? <Text style={[line, { color: p.textMuted }]}>{lead}</Text> : null}
          {main.length > 0 ? (
            <View style={styles.actions}>
              {main.map((a) => <Button key={a.id} title={a.label} variant="ghost" disabled={busy !== null} onPress={() => act(a.id)} />)}
            </View>
          ) : null}
          {quiet.map((a) => <QuietAction key={a.id} title={a.label} disabled={busy !== null} onPress={() => act(a.id)} />)}
        </View>
      ) : null}

      {question ? (
        <View style={styles.block}>
          <Text style={[line, { color: p.text }]}>{question.line}</Text>
          <View style={styles.actions}>
            <Button
              title={busy === 'remove' ? 'מסירים…' : question.confirm}
              variant={asking === 'hide-class' ? 'ghost' : 'danger'}
              disabled={busy !== null}
              onPress={answerYes}
            />
            <Button title={CANCEL_LABEL} variant="ghost" disabled={busy !== null} onPress={() => { setAsking(null); setProblem(null); }} />
          </View>
        </View>
      ) : null}

      {showForm ? (
        <View style={styles.block}>
          <TextInput
            accessibilityLabel="קישור ללוח המבחנים"
            value={link}
            onChangeText={setLink}
            placeholder="להדביק קישור ללוח"
            placeholderTextColor={p.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2000}
            returnKeyType="go"
            editable={busy === null}
            onSubmitEditing={checkLink}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[
              styles.input,
              { color: p.text, backgroundColor: p.surfaceAlt, borderBottomColor: focused ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 },
              focused ? styles.inputFocused : null,
            ]}
          />
          {/* Led by the filled button, which lines up with the link field's edge: not pulled back as a row of text buttons is (V-4). */}
          <View style={styles.formActions}>
            <Button title="לבדוק" disabled={busy !== null || link.trim().length === 0} onPress={checkLink} />
            <Button title="לבחור קובץ אקסל" variant="ghost" disabled={busy !== null} onPress={() => void chooseFile()} />
            {owner !== 'none' ? (
              <Button title="ביטול" variant="ghost" disabled={busy !== null} onPress={() => { setAdding(false); setLink(''); setProblem(null); }} />
            ) : null}
          </View>
        </View>
      ) : null}

      {checking ? <Checking file={readingFile} /> : null}
      {problem ? <Text accessibilityRole="alert" style={[line, { color: p.cancel }]}>{problem}</Text> : null}

      {flow ? (
        <ExamBoardConfirm
          key={flow.id}
          source={flow.source}
          first={flow.first}
          target={saveTo}
          classHasBoard={hasBoard}
          holdsOwnBoard={holdsOwnBoard(own)}
          onDone={done}
          onClose={closeFlow}
          onSaveOwn={saveOwn}
        />
      ) : null}
    </View>
  );
}

/** A secondary action beside the block's others: small, in the muted ink and underlined, so it is there to find and not asking to be tapped. */
function QuietAction({ title, disabled, onPress }: { title: string; disabled: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.quiet, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, textDecorationLine: 'underline' }}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  whose: { gap: 2 },
  // Text buttons carry their own side padding: pulled back so that their words line up with the lines above.
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginStart: -space.md },
  // A row that starts with a filled button: its edge is the content's, as the link field's is, so nothing is pulled back.
  formActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  quiet: { alignSelf: 'flex-start', minHeight: MIN_TOUCH, justifyContent: 'center' },
  input: {
    borderBottomWidth: 1, borderTopStartRadius: radius.sm, borderTopEndRadius: radius.sm,
    paddingTop: 12, paddingBottom: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, textAlign: 'left', writingDirection: 'ltr',
  },
  inputFocused: { borderBottomWidth: 2, paddingBottom: 11 },
});
