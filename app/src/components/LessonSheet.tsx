/**
 * A lesson's details (F4): what happened to it in plain Hebrew, the site's own
 * note, when the change was first seen, who teaches it and where it came from.
 * Opened by tapping a lesson on "היום שלי"; `LessonDetails` is also the detail
 * view inside ChangesSheet. "לשנות שם" gives the subject a name of the
 * student's own, in place (`NameEditor`); "שם מקורי" then says the site's.
 *
 *   <LessonSheet visible={open} lesson={lesson} classId={classId} onClose={close} />
 *
 * On the sheet as on the page (plan §16.1): no box inside it. "שיעור רגיל,
 * בלי שינויים." is a plain line, a change has its word on the highlighter;
 * each detail is a ruled row, the label muted at the start and the value at
 * the end. One main button; the rest are text buttons.
 *
 * The room row appears only when a room is known: the school site publishes
 * none, so an empty "חדר" would promise something that never comes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { Lesson } from '@sederyom/shared';
import { SUBJECT_NAME_MAX } from '@sederyom/shared/logic/ownNames';
import { useRenameSubject, useSettings } from '../api/hooks';
import { isDemo } from '../demo/phone';
import { isolateRanges, relativeTime, shortDateTime, shownSubject, stripGroup, todayStr } from '../lib/format';
import { PACK_TEXT_MAX, packTextFor, setPackText } from '../local/packList';
import { rescheduleSummaries } from '../local/source';
import { lessonNameTarget, lessonWithName, nameOfDraft } from '../local/subjectNames';
import { storage } from '../widget/feedCache';
import { fieldLook } from './fieldLook';
import { LESSONS_COPY } from '../lib/school';
import { blockTimeParts, detailLabel, hideLessonQuestion, lessonSiteUrl, sourceLabel, statusExplanation, subjectNotes, type Part } from '../lib/today';
import { font, space, statusStyle, type } from '../theme';
import { AppIcon } from './AppIcon';
import { NameEditor, SUBJECT_NAME_NOTE } from './NameEditor';
import { Mark, ROW_MIN_HEIGHT, ROW_PADDING } from './notebook';
import { PartsText } from './timeline';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Ltr, MIN_TOUCH, Text, TextInput, usePalette } from './ui';

/**
 * A label and its value as a ruled row (plan §16.1): the label muted at the
 * start, the value at the end; the value may carry LTR parts (times) and
 * wraps when it is long. One item for a screen reader, "שעה: …".
 */
export function DetailRow({ label, value }: { label: string; value: string | Part[] }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[styles.detailRow, { borderBottomColor: p.border }]} accessible accessibilityLabel={detailLabel(label, value)}>
      <Text style={[styles.detailLabel, { color: p.textMuted }]}>{label}</Text>
      {typeof value === 'string'
        ? <Text style={[styles.detailValue, { color: p.text }]}>{value}</Text>
        : <PartsText parts={value} style={[styles.detailValue, { color: p.text }]} />}
    </View>
  );
}

/** The subject as the site names it, minus the bracketed group — "אנגלית 5 יח״ל". */
function nameWithoutGroup(subject: string): string {
  return subject.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A change's word as it reads on the page: the red pen for "בוטל", the highlighter for the rest. */
function StatusWord({ status }: { status: Lesson['status'] }): React.JSX.Element | null {
  const p = usePalette();
  const s = statusStyle(status, p);
  if (!s.label) return null;
  if (status === 'cancelled') return <Text style={[styles.statusWord, { color: p.cancel }]}>{s.label}</Text>;
  return (
    <Mark kind={status === 'exam' ? 'exam' : status === 'event' ? 'mark' : 'change'} color={s.color} style={styles.statusWord}>
      {s.label}
    </Mark>
  );
}

export function LessonDetails({
  lesson, lessons, projected = false,
}: {
  lesson: Lesson;
  /** The periods the row stood for, when it was a block of one subject ("1–3 פיזיקה"). */
  lessons?: Lesson[];
  projected?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const s = statusStyle(lesson.status, p);
  const changed = lesson.status !== 'regular';
  const title = shownSubject(lesson);
  // The site's name says the rest: its level, its place and its group. A name the student gave is the title alone.
  const source = lesson.originalSubject ?? lesson.subject;
  const renamed = lesson.originalSubject !== undefined;
  const fullName = renamed ? title : nameWithoutGroup(source);
  // "(מעבדת פיזיקה)" is where the lesson is, "(יב3)" who it is for — each under its own label.
  const { group, place } = subjectNotes(source);
  const seenAt = lesson.changeSeenAt ?? null;
  const block = lessons && lessons.length > 1 ? lessons : [lesson];

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.status} accessible accessibilityLabel={[s.label, statusExplanation(lesson.status)].filter(Boolean).join('. ')}>
        {changed ? <StatusWord status={lesson.status} /> : null}
        <Text style={[styles.statusText, { color: p.text }]}>{statusExplanation(lesson.status)}</Text>
      </View>

      {lesson.note ? (
        <View style={styles.note}>
          <Text style={[styles.noteLabel, { color: p.textMuted }]}>{lesson.source === 'shahaf' ? 'מה כתוב באתר' : 'הערה'}</Text>
          <Text style={[styles.noteText, { color: p.textStrong }]}>{isolateRanges(lesson.note)}</Text>
        </View>
      ) : null}

      {seenAt ? (
        <Text style={[styles.seen, { color: p.textMuted }]}>
          {'השינוי פורסם ב־'}
          <Ltr>{shortDateTime(seenAt)}</Ltr>
          {` (${relativeTime(seenAt)})`}
        </Text>
      ) : null}

      <View>
        <DetailRow label="שעה" value={blockTimeParts(block)} />
        {renamed ? <DetailRow label="שם מקורי" value={isolateRanges(nameWithoutGroup(source))} /> : null}
        {fullName !== title ? <DetailRow label="מקצוע" value={fullName} /> : null}
        {place ? <DetailRow label="מקום" value={place} /> : null}
        {group ? <DetailRow label="קבוצה" value={group} /> : null}
        {lesson.teacher ? <DetailRow label="מורה" value={lesson.teacher} /> : null}
        {lesson.substitute ? <DetailRow label="מילוי מקום" value={lesson.substitute} /> : null}
        {lesson.room ? <DetailRow label="חדר" value={lesson.room} /> : null}
        <DetailRow label="מקור" value={projected ? `${sourceLabel(lesson.source)}, לפי המערכת הקבועה` : sourceLabel(lesson.source)} />
      </View>
    </View>
  );
}

/** "לפתוח באתר בית הספר" — the footer's text button wherever a lesson can be checked on the site. */
export function SiteButton({ url }: { url: string }): React.JSX.Element {
  const toast = useToast();
  return (
    <Button
      title="לפתוח באתר בית הספר"
      variant="ghost"
      onPress={() => {
        void Linking.openURL(url).catch(() => toast.show('לא הצלחנו לפתוח את האתר'));
      }}
    />
  );
}

export interface LessonSheetProps {
  visible: boolean;
  /** Kept after closing, so the sheet does not empty while it slides away. */
  lesson: Lesson | null;
  /** The periods of a block row ("1–3 פיזיקה"), `lesson` first; the time row then spans them all. */
  lessons?: Lesson[];
  onClose: () => void;
  /** The class on the school site, for "לפתוח באתר"; without it the button is left out. */
  classId?: string | null;
  /** The day is projected from the fixed timetable: there is nothing on the site to open yet. */
  projected?: boolean;
  /**
   * "משימה לשיעור של ראשון": a task due the next time the subject is taught
   * (W4, Itai; `nextLessonTaskLabel`) — the screen knows when that is
   * (`nextLessonDate`) and opens the new-task sheet on it. Without it there
   * is no such button.
   */
  addTask?: { label: string; onPress: () => void } | null;
  /**
   * "זה לא השיעור שלי" (W5-5, Noa): hides the lesson's whole row of "השיעורים
   * שלי" (`lessonHideKeys`); the screen saves it and offers "לבטל". Called
   * only once the question in the sheet is answered "להסתיר" (V2, Maya, run
   * 5): the button speaks of one lesson, and the subject goes from every day,
   * its homework too. Without it there is no such button — on the week tab,
   * or when the lesson matches no line there.
   */
  onNotMine?: (() => void) | null;
}

export function LessonSheet({
  visible, lesson: opened, lessons, onClose, classId = null, projected = false, addTask = null, onNotMine = null,
}: LessonSheetProps): React.JSX.Element {
  const p = usePalette();
  // "זה לא השיעור שלי" asks first, and "לשנות שם" opens its field in place. The sheet keeps `lesson`
  // after it closes, so closing it, or another lesson, starts over at the plain links — a reopened
  // sheet never lands on the question, nor on a field left open.
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // A name typed and not saved is not lost to a tap on the backdrop, as in the exam sheet.
  const [nameTyped, setNameTyped] = useState(false);
  useEffect(() => {
    setConfirming(false);
    setRenaming(false);
  }, [visible, opened]);
  const settings = useSettings().data;
  const rename = useRenameSubject();
  // A name given here shows at once: the screen keeps the lesson it opened the sheet with, and the
  // days it was taken from change a moment later. It is kept by the lesson it was given to, not
  // dropped when the sheet closes, so the title does not turn back while the sheet slides away.
  const [named, setNamed] = useState<{ base: Lesson; shown: Lesson } | null>(null);
  const lesson = opened && named?.base === opened ? named.shown : opened;
  // On a parent's phone, the lessons shown are the child's (`LESSONS_COPY`).
  const parent = settings?.settings.audience === 'parent';
  const question = lesson ? hideLessonQuestion(shownSubject(lesson), parent) : null;
  const siteUrl = settings?.schoolSiteUrl ?? null;
  const url = lesson && !projected ? lessonSiteUrl(lesson, siteUrl, classId, todayStr()) : null;
  const footer = url || addTask ? (
    <View style={styles.footer}>
      {addTask ? <Button title={addTask.label} onPress={addTask.onPress} /> : null}
      {url ? <SiteButton url={url} /> : null}
    </View>
  ) : undefined;

  // "לשנות שם": where the name is saved is the lesson's row of "השיעורים שלי" (`lessonNameTarget`).
  // Not before the settings are read: a name written then would have nothing to join.
  const target = useMemo(
    () => (lesson && settings ? lessonNameTarget(lesson, settings.subjects) : null),
    [lesson, settings],
  );
  const source = lesson ? lesson.originalSubject ?? lesson.subject : '';
  const siteName = nameWithoutGroup(source);
  // The site's name, under any of the spellings the sheet showed it in, is no name of the student's.
  const originals = [...new Set([source, stripGroup(source), siteName])];
  const renamed = lesson?.originalSubject !== undefined;
  const giveName = (name: string | null): void => {
    setRenaming(false);
    if (!opened || !lesson || !target) return;
    // The same name again changes nothing.
    if (name === (renamed ? lesson.subject : null)) return;
    // No name clears every key that could still name the lesson, so the site's name really comes back.
    rename(name === null ? target.clear : target.keys, name, originals);
    setNamed({ base: opened, shown: lessonWithName(lesson, name) });
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      dismissable={!nameTyped}
      title={lesson ? shownSubject(lesson) : ''}
      footer={footer}
    >
      {lesson ? <LessonDetails lesson={lesson} lessons={lessons} projected={projected} /> : null}
      {lesson && target ? (
        renaming ? (
          <View style={styles.rename}>
            <NameEditor
              label="שם המקצוע"
              initial={renamed ? lesson.subject : ''}
              original={siteName}
              note={SUBJECT_NAME_NOTE}
              maxLength={SUBJECT_NAME_MAX}
              onSave={(draft) => giveName(nameOfDraft(draft, originals))}
              onCancel={() => setRenaming(false)}
              onDirty={setNameTyped}
            />
          </View>
        ) : (
          <View style={[styles.rename, styles.renameButtons]}>
            <Button title="לשנות שם" variant="ghost" onPress={() => setRenaming(true)} />
            {renamed ? <Button title="להחזיר את השם המקורי" variant="ghost" onPress={() => giveName(null)} /> : null}
          </View>
        )
      ) : null}
      {/* Not in the demo: its subjects are made up, and what is written here stays on the phone. */}
      {lesson && !isDemo() ? <PackField subject={lesson.originalSubject ?? lesson.subject} shown={shownSubject(lesson)} /> : null}
      {lesson && onNotMine && question ? (
        confirming ? (
          // The question in place of the link (V2): what goes, for how long, and where it comes back.
          <View accessibilityLiveRegion="polite" style={styles.confirm}>
            <Text style={[styles.confirmTitle, { color: p.textStrong }]}>{question.title}</Text>
            <Text style={[styles.confirmDetail, { color: p.textMuted }]}>{question.detail}</Text>
            <View style={styles.confirmActions}>
              <Button title="להסתיר" variant="danger" onPress={onNotMine} />
              <Button title="ביטול" variant="ghost" onPress={() => setConfirming(false)} />
            </View>
          </View>
        ) : (
          // A quiet text button under the details, not a third footer button: it is the rare way
          // out, and the footer keeps what the sheet is for.
          <Pressable
            accessibilityRole="button"
            accessibilityHint="שואל לפני שמסתיר את המקצוע בכל הימים"
            onPress={() => setConfirming(true)}
            style={({ pressed }) => [styles.notMine, { opacity: pressed ? 0.6 : 1 }]}
          >
            <AppIcon name="close" color={p.textMuted} size={16} />
            <Text style={[styles.notMineText, { color: p.text }]}>{LESSONS_COPY[parent ? 'parent' : 'student'].notMine}</Text>
          </Pressable>
        )
      ) : null}
    </Sheet>
  );
}

/**
 * "מה להביא לשיעור" (ideas פ2): what the student brings to the lesson's
 * subject, written once for every lesson of it (`packList.ts`); the evening
 * reminder lists it before a day the subject is taught. Kept when the field
 * is left or the keyboard's "done" is pressed, and the reminders are planned
 * again with it, tonight's included. Kept under the source's name (`subject`),
 * so a name the student gives the subject later loses none of it; `shown` is
 * the name the line says.
 */
function PackField({ subject, shown }: { subject: string; shown: string }): React.JSX.Element {
  const p = usePalette();
  const [text, setText] = useState(() => packTextFor(storage, subject));
  const [focused, setFocused] = useState(false);
  // What is typed, for a sheet that closes with the field still focused (no blur may come).
  const typed = useRef({ subject, text });
  typed.current = { subject, text };
  useEffect(() => {
    setText(packTextFor(storage, subject));
  }, [subject]);
  const keep = (): void => {
    const now = typed.current;
    if (now.text.replace(/\s+/g, ' ').trim() === packTextFor(storage, now.subject)) return;
    setPackText(storage, now.subject, now.text);
    void rescheduleSummaries().catch(() => undefined);
  };
  useEffect(() => () => keep(), []);
  return (
    <View style={styles.pack}>
      <Text style={[styles.noteLabel, { color: p.textMuted }]}>מה להביא לשיעור</Text>
      <TextInput
        accessibilityLabel={`מה להביא לשיעור ${shown}`}
        value={text}
        onChangeText={setText}
        placeholder="למשל מחשבון, בגדי ספורט"
        placeholderTextColor={p.textFaint}
        maxLength={PACK_TEXT_MAX}
        returnKeyType="done"
        onSubmitEditing={keep}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          keep();
        }}
        style={[styles.packInput, { color: p.text, outlineColor: 'transparent', outlineWidth: 0 }, fieldLook(p, { focused })]}
      />
      <Text style={[styles.seen, { color: p.textMuted }]}>מופיע בתזכורת הערב, לפני כל יום עם השיעור הזה</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // "לשנות שם": under the details; its ghost buttons start at the text's edge, as the field's do.
  rename: { marginTop: space.md },
  renameButtons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginStart: -space.md, marginTop: space.xs },
  pack: { gap: space.xs, marginTop: space.md },
  packInput: { paddingVertical: 10, paddingHorizontal: space.md, fontFamily: font.body, fontSize: type.body },
  status: { gap: space.xs, alignItems: 'flex-start' },
  statusWord: { fontFamily: font.bodySemi, fontSize: type.body },
  statusText: { fontFamily: font.body, fontSize: type.body },
  note: { gap: 2 },
  noteLabel: { fontFamily: font.bodyMedium, fontSize: type.small },
  noteText: { fontFamily: font.body, fontSize: type.body },
  seen: { fontFamily: font.body, fontSize: type.small },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md,
    minHeight: ROW_MIN_HEIGHT, paddingVertical: ROW_PADDING, borderBottomWidth: 1,
  },
  detailLabel: { flexShrink: 0, fontFamily: font.body, fontSize: type.small },
  detailValue: { flexShrink: 1, fontFamily: font.bodyMedium, fontSize: type.body },
  footer: { gap: space.xs },
  notMine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', minHeight: MIN_TOUCH, marginTop: space.sm },
  notMineText: { fontFamily: font.bodySemi, fontSize: type.small },
  confirm: { gap: space.sm, marginTop: space.md },
  confirmTitle: { fontFamily: font.bodySemi, fontSize: type.body },
  confirmDetail: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  confirmActions: { flexDirection: 'row', gap: space.sm },
});
