/**
 * "לשנות תאריך" in an exam's sheet: the student moves the exam to another day for themselves alone, and puts it back.
 * The buttons sit with the student's other words on the exam (its name, the Google calendar), "לשנות תאריך" opens a
 * month calendar on the exam's date, and a moved exam also has the way back. What each state shows and does is decided
 * by `lib/examDate.ts`; this draws it and keeps the little state a sheet needs (calendar open, the question asked).
 * What it tells the student after a move ("המבחן עבר ל…, רק אצלך") is a line here, not a toast: the sheet is a native
 * Modal, and a toast under its window is never seen.
 *
 *   <ExamDateControls exam={exam} area={examDateArea(exam, today)} today={today} visible={visible}
 *     onManualMoved={…} onClose={onClose} />
 *
 * The date itself, and the line that says the school's, are the sheet's own, which shows the new date at once.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DateStr, Exam } from '@sederyom/shared';
import { useSetExamDate } from '../api/hooks';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { chooseExamDate, EXAM_DATE_COPY, movedToastText, type ExamDateArea } from '../lib/examDate';
import { font, space, type } from '../theme';
import { useAnnounceOnIos } from './announce';
import { MonthCalendar } from './MonthCalendar';
import { Button, Text, usePalette } from './ui';

export interface ExamDateControlsProps {
  /** The exam as the sheet shows it: under the student's name and on their date. */
  exam: Exam;
  area: ExamDateArea;
  today: DateStr;
  /** The sheet stays mounted once closed: a calendar left open must not greet the next opening. */
  visible: boolean;
  /** An exam added by hand was moved: the sheet's copy of it is the screen's, which does not know. */
  onManualMoved: (to: DateStr) => void;
  /** The sheet is no longer about this exam: it was put back to a date the school's list has let go. */
  onClose: () => void;
}

/** A question asked before the write, in place of the buttons: its words, the answer that goes ahead, and what it does (`date`: the day to move to anyway; `null`: put the exam back). */
interface Asking {
  text: string;
  yes: string;
  date: DateStr | null;
}

export function ExamDateControls({ exam, area, today, visible, onManualMoved, onClose }: ExamDateControlsProps): React.JSX.Element | null {
  const p = usePalette();
  const setDate = useSetExamDate();
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  // What the student is told after a move, and that the demo writes nothing: lines in the sheet, since a toast
  // would sit under the sheet's window, unseen.
  const [moved, setMoved] = useState<DateStr | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  useEffect(() => {
    if (!visible) {
      setPicking(false);
      setAsking(null);
      setMoved(null);
      setNotSaved(false);
    }
  }, [visible]);
  // The line that tells of a move, while it is about the date the sheet shows.
  const movedLine = moved !== null && moved === exam.date ? movedToastText(moved) : null;
  // VoiceOver has no live regions: what Android says of the question and of the move as they appear, iOS is told.
  useAnnounceOnIos(asking?.text ?? null);
  useAnnounceOnIos(movedLine);

  if (!area.canMove) return null;

  const start = (): void => {
    setMoved(null);
    if (isDemo()) {
      setNotSaved(true);
      return;
    }
    setPicking(true);
  };
  const ask = (question: Asking): void => {
    setMoved(null);
    setPicking(false);
    setAsking(question);
  };
  const putBack = (): void => {
    const gone = area.putBack?.ask != null;
    setPicking(false);
    setAsking(null);
    setMoved(null);
    if (setDate(exam, null) && gone) onClose();
  };
  const moveTo = (date: DateStr): void => {
    setPicking(false);
    setAsking(null);
    if (!setDate(exam, date)) return;
    if (exam.kind === 'manual') onManualMoved(date);
    setMoved(date);
  };
  const choose = (picked: DateStr): void => {
    const choice = chooseExamDate(exam, picked, today);
    if (choice.do === 'nothing') return;
    if (choice.do === 'putBack') {
      if (choice.ask) ask({ text: choice.ask, yes: EXAM_DATE_COPY.removeYes, date: null });
      else putBack();
      return;
    }
    if (choice.ask) ask({ text: choice.ask, yes: EXAM_DATE_COPY.moveAnyway, date: choice.date });
    else moveTo(choice.date);
  };

  if (asking) {
    return (
      <View style={styles.wrap}>
        <Text accessibilityLiveRegion="polite" style={[styles.paragraph, { color: p.text }]}>{asking.text}</Text>
        <View style={styles.buttons}>
          <Button title={asking.yes} variant="danger" onPress={() => (asking.date === null ? putBack() : moveTo(asking.date))} />
          <Button title={EXAM_DATE_COPY.cancel} variant="ghost" onPress={() => setAsking(null)} />
        </View>
      </View>
    );
  }
  if (picking) {
    return (
      <View style={styles.wrap}>
        <MonthCalendar date={exam.date} initialMonth={exam.date} onChange={choose} />
        <View style={styles.buttons}>
          <Button title={EXAM_DATE_COPY.cancel} variant="ghost" onPress={() => setPicking(false)} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.buttons}>
        <Button title={EXAM_DATE_COPY.move} variant="ghost" onPress={start} />
        {area.putBack ? (
          <Button
            title={area.putBack.label}
            variant="ghost"
            onPress={() => {
              if (area.putBack?.ask) ask({ text: area.putBack.ask, yes: EXAM_DATE_COPY.removeYes, date: null });
              else putBack();
            }}
          />
        ) : null}
      </View>
      {movedLine ? (
        <Text accessibilityLiveRegion="polite" style={[styles.paragraph, { color: p.textMuted }]}>{movedLine}</Text>
      ) : null}
      {notSaved ? (
        <Text accessibilityLiveRegion="polite" style={[styles.paragraph, { color: p.textMuted }]}>{DEMO_COPY.notSaved}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  paragraph: { fontFamily: font.body, fontSize: type.small, lineHeight: 21 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginStart: -space.md },
});
