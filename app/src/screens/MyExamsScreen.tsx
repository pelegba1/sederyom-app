/**
 * "המבחנים שלי". The school site's exam schedule covers the whole grade — a
 * block exam names six subjects of which a student sits one — so the owner
 * marks which exams are theirs. Exams are grouped by subject: one checkbox
 * marks a whole subject, and a group opens to a checkbox per exam. What is
 * not marked leaves the day, the week, the home screen, the morning summary
 * and the "בית ספר" Google calendar alike; the server updates the calendar
 * as soon as a mark is saved.
 *
 * One count, the same as on the School screen: "N מבחנים מסומנים כשלך", and
 * how many of those are a guess (R-16). The server may recommend ("מומלץ לך",
 * `match.mine`) and explain why an exam looks like someone else's
 * (`match.reason`); it never changes the marks by itself. A recommended exam
 * that is off is called out at the top, with "לסמן את המומלצים (N)" — which
 * turns those on and touches nothing else.
 *
 * Wave 4 (W4-4): an exam the server could not place carries a "?" and why,
 * on its row and, folded, on its subject; the count says how many of the
 * marked ones are unsure; "להסתיר הכול" (Maya read "להוריד" as downloading).
 *
 * Wave 5 (W5-9): one status per row — "מומלץ לך", "לא בטוח" or why it is not
 * the owner's, which `match.mine` makes exclusive (`examStatus`). The
 * countdown and the source are plain words on the row's quiet line (Daniel
 * counted four chip styles in a row). A word in a title ("משפרים", "מועד
 * ב׳") has its "?" when no status carries one.
 *
 * Wave 6 (W6-2): an unsure exam the owner confirmed ("שלי" in onboarding,
 * "זה שלי" in the exam sheet) has no "?", and the count says so. A mark only
 * shows or hides; it does not take the answer back.
 *
 * Wave 9 (plan §16): rows on the page, not cards; an exam's date in the
 * margin. A subject's mark is the notebook's checkbox, which can say
 * "partly" (`'mixed'`; pressing it marks them all), where the three-state
 * switch could not. "מומלץ לך" is a highlighter, a reason is quiet words,
 * and the screen says what it is in one line, with the rest behind one "?".
 * The re-rate: that "?" is the screen's only one. What "גוש", "משפרים" or
 * "מועד ב׳" means is behind it too, not beside every row (five "רק למשפרים
 * ?"), and each row still reads its own sentence aloud. A row's checkbox is
 * at its start, as on every list.
 */
import { AddExamSheet } from '../components/AddExamSheet';
import { ExamBoard } from '../components/ExamBoard';
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { ExamOption, SubjectOption } from '@sederyom/shared';
import { useConfirmedExams, useOwnBoard, useSaveSettings, useSettings } from '../api/hooks';
import { AppIcon } from '../components/AppIcon';
import { UnsureMark } from '../components/ExamSheet';
import { Checkbox, MarginList, MarginRow, Mark, Row, ROW_END, ROW_GUTTER } from '../components/notebook';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, touchSlop, usePalette } from '../components/ui';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { examNaming } from '../lib/bagrut';
import { CATALOG } from '../lib/bagrutCatalog';
import { countdownLabel, dayDateLabel, daysUntil, formatShortDate, isolateRanges, plural } from '../lib/format';
import {
  BLOCK_EXPLAINER, blockSubjects, examCounts, examKind, examReason, examsCountLabel, examSource, examStatus,
  FACT_ADVICE, groupExamsBySubject, groupReason, groupSwitch, isUnsure, marginWeekday, setExamsShown, splitExamDetails,
  tagExplainer, teacherFact, teacherFactText, unsureReason, withConfirmed, type ExamGroup,
} from '../lib/school';
import { font, space, type } from '../theme';
import { ExamsToCalendarSwitch } from './settings/ExamsToCalendarSwitch';

/** Behind the screen's one "?" (plan §16.2): what a hidden exam leaves. */
const HIDDEN_EXPLAINER = 'מבחן מוסתר לא יופיע ביום, בשבוע, במסך הבית של הטלפון ובסיכום הבוקר.';

export function MyExamsScreen(): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const settings = useSettings();
  const save = useSaveSettings();
  // The phone's own exam board, when it has one: the block below says whose board the list is made of (`ExamBoard`).
  const ownBoard = useOwnBoard();
  // "שלי" answers from onboarding and the exam sheet: those exams lose their "?" here too (W6-2).
  // The hook hands out a new Set each render; its contents are what the lists depend on.
  const { confirmed } = useConfirmedExams();
  const confirmedKey = [...confirmed].sort().join('\n');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [about, setAbout] = useState(false);
  const [adding, setAdding] = useState(false);

  const hiddenKeys = useMemo(() => settings.data?.settings.exams.hiddenKeys ?? [], [settings.data]);
  const hidden = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const resolved = useMemo(() => withConfirmed(settings.data?.exams ?? [], confirmed), [settings.data, confirmedKey]);
  const groups = useMemo(() => groupExamsBySubject(resolved), [resolved]);
  // The words on the list that need a sentence ("גוש", "משפרים", "מועד ב׳"): behind the screen's one "?".
  const terms = useMemo(() => screenTerms(groups), [groups]);
  // An undo runs seconds later, against whatever the list is by then.
  const latestHidden = useRef(hiddenKeys);
  latestHidden.current = hiddenKeys;

  if (settings.isLoading) return <Screen><Loading /></Screen>;
  if (settings.isError || !settings.data) {
    return (
      <Screen>
        <ErrorState message={(settings.error as Error | undefined)?.message ?? 'שגיאה'} onRetry={() => void settings.refetch()} />
      </Screen>
    );
  }

  const exams = resolved;
  const allKeys = exams.map((e) => e.naturalKey);
  const counts = examCounts(exams, hidden, confirmed);
  const mirrored = settings.data.settings.examsToCalendar;
  // The owner's teachers, for the fact beside an unsure exam's "?" (plan §14.7).
  const lessons: OwnLessons = { subjects: settings.data.subjects, hidden: settings.data.settings.lessons.hiddenSubjects };
  // The subjects to offer when adding an exam: the student's own lessons, each once.
  const mySubjects = [...new Set(settings.data.subjects.filter((s) => !lessons.hidden.includes(s.key)).map((s) => s.name))];

  const saveHidden = (next: string[]): void => save.mutate({ exams: { hiddenKeys: next } });
  const setShown = (keys: string[], show: boolean): void => saveHidden(setExamsShown(hiddenKeys, keys, show));
  const toggleOpen = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const markRecommended = (): void => {
    const keys = counts.recommendedOff;
    save.mutate({ exams: { hiddenKeys: setExamsShown(hiddenKeys, keys, true) } }, {
      onSuccess: () => toast.show(plural(keys.length, 'מבחן מומלץ אחד סומן', 'מבחנים מומלצים סומנו'), {
        onAction: () => saveHidden(setExamsShown(latestHidden.current, keys, false)),
      }),
    });
  };

  // Every mark at once: an undo puts back the very list from before. "להסתיר הכול" had none,
  // and "לסמן את המומלצים" brought back only part of what it hid (Daniel, run 6).
  const setAll = (show: boolean): void => {
    const before = [...hiddenKeys];
    save.mutate({ exams: { hiddenKeys: setExamsShown(hiddenKeys, allKeys, show) } }, {
      onSuccess: () => toast.show(show ? 'כל המבחנים סומנו כשלך' : 'כל המבחנים הוסתרו', { onAction: () => saveHidden(before) }),
    });
  };

  return (
    <Screen>
      {/* "handled": with the board link field open, the first tap on a row is the row's, not the keyboard's. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* What the screen is, in one line (plan §16.2); the rest behind one "?". */}
        <View style={[styles.page, styles.intro]}>
          <Text style={[styles.introText, { color: p.text }]}>כל מבחני השכבה. מה שמסומן מופיע אצלך.</Text>
          <HelpButton label="מה עוד כדאי לדעת" open={about} onPress={() => setAbout((v) => !v)} />
        </View>
        {/* Also in Settings → Google (settings spec §4.3): the switch sits where the exams are marked, outside the fold. */}
        <ExamsToCalendarSwitch />
        {about ? (
          <View style={styles.page}>
            <Explainer text={HIDDEN_EXPLAINER} />
            {/* The switch above says when it is off; the explainer only says what on means (and that the demo writes nothing). */}
            {isDemo() ? (
              // The demo writes nothing to Google, and its setting stays off (`demoSettings`).
              <Explainer text={DEMO_COPY.noGoogle} />
            ) : mirrored ? (
              <Explainer text="המבחנים המסומנים מופיעים גם ביומן ״בית ספר״ ב־Google, ומבחן שמסתירים כאן ייעלם גם משם." />
            ) : null}
            {/* What a word on the list means: once here, not a "?" beside every "רק למשפרים" (the re-rate). */}
            {terms.map((term) => <Explainer key={term} text={term} />)}
          </View>
        ) : null}

        {counts.recommendedOff.length > 0 ? (
          // The screen's one raised surface: what is worth doing first.
          <View style={[styles.page, styles.block]}>
            <Card style={styles.recommended}>
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text, lineHeight: 23 }}>
                {plural(counts.recommendedOff.length, 'מבחן אחד שמתאים למערכת שלך מוסתר', 'מבחנים שמתאימים למערכת שלך מוסתרים')}
              </Text>
              <View style={{ alignItems: 'flex-start' }}>
                <Button
                  title={`לסמן את המומלצים (${counts.recommendedOff.length})`}
                  disabled={save.isPending}
                  onPress={markRecommended}
                />
              </View>
            </Card>
          </View>
        ) : null}

        <View style={[styles.page, styles.block]}>
          <Text accessibilityRole="header" style={{ fontFamily: font.headingSemi, fontSize: type.title, color: p.text }}>
            {examsCountLabel(counts.chosen, counts.unsure)}
          </Text>
          <View style={styles.actions}>
            <Button title="לסמן הכול" variant="ghost" disabled={counts.chosen === exams.length || save.isPending} onPress={() => setAll(true)} />
            <Button title="להסתיר הכול" variant="ghost" disabled={counts.chosen === 0 || save.isPending} onPress={() => setAll(false)} />
            {/* Not every school publishes its exams where the app can read them. */}
            <Button title="+ מבחן" variant="ghost" onPress={() => setAdding(true)} />
          </View>
        </View>

        {exams.length === 0 ? (
          <View style={styles.page}>
            <EmptyState icon="exam" text="עדיין אין מבחנים בלוח של השכבה" />
          </View>
        ) : (
          <View style={[styles.groups, { borderTopColor: p.border }]}>
            {groups.map((group) => (
              <SubjectGroup
                key={group.key}
                group={group}
                lessons={lessons}
                hidden={hidden}
                open={expanded.has(group.key)}
                busy={save.isPending}
                onToggleOpen={() => toggleOpen(group.key)}
                onSetShown={setShown}
              />
            ))}
          </View>
        )}

        <View style={[styles.page, styles.block]}>
          <ExamBoard own={ownBoard} />
        </View>

        {save.isError ? (
          <View style={[styles.page, styles.block]}>
            <Text accessibilityRole="alert" style={{ fontFamily: font.body, fontSize: type.small, color: p.cancel }}>
              {`לא הצלחנו לשמור: ${(save.error as Error).message}`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <AddExamSheet visible={adding} onClose={() => setAdding(false)} subjects={mySubjects} />
    </Screen>
  );
}

/**
 * A reason ("רק למשפרים") in quiet words, not a tag, and no "?" of its own:
 * what a word in it means is behind the screen's one "?" (`screenTerms`),
 * and read with the row (the Wave 9 re-rate: five "רק למשפרים ?").
 */
function ReasonWords({ label }: { label: string }): React.JSX.Element {
  const p = usePalette();
  return <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{label}</Text>;
}

/**
 * The sentences behind the screen's one "?" for the words on its list —
 * "גוש" in a group's name, "משפרים" or "מועד ב׳" in a reason or a title —
 * each once, in the list's order.
 */
function screenTerms(groups: readonly ExamGroup<ExamOption>[]): string[] {
  const out = new Set<string>();
  const add = (text: string | null): void => {
    const sentence = text ? tagExplainer(text) : null;
    if (sentence) out.add(sentence);
  };
  for (const group of groups) {
    add(group.key);
    add(groupReason(group));
    for (const exam of group.exams) {
      add(examReason(exam));
      add(examNaming(exam, CATALOG).title);
    }
  }
  return [...out];
}

/** The screen's one "?", by its first line; its sentences open under that line. */
function HelpButton({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={label}
      hitSlop={touchSlop(18)}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <AppIcon name="help" color={open ? p.accent : p.textMuted} size={18} />
    </Pressable>
  );
}

/** The sentence a "?" opened. */
function Explainer({ text }: { text: string }): React.JSX.Element {
  const p = usePalette();
  return (
    <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.body, fontSize: type.small, color: p.text, lineHeight: 21, marginTop: 6 }}>
      {text}
    </Text>
  );
}

/** A word in an exam title that needs a sentence — "משפרים", "מועד ב׳" — but not "גוש", which its group says. */
function titleExplainer(title: string): string | null {
  const explainer = tagExplainer(title);
  return explainer === BLOCK_EXPLAINER ? null : explainer;
}

/** The timetable's lines and the hide-list: who teaches the owner what. */
interface OwnLessons {
  subjects: readonly SubjectOption[];
  hidden: readonly string[];
}

/**
 * One subject, a ruled row: the checkbox at its start (its `lead`, where
 * every list draws it) marks them all, and says "partly" when only some
 * are; a tap on its name opens its exams under it. The two are siblings, so
 * a screen reader reaches each.
 */
function SubjectGroup({
  group, lessons, hidden, open, busy, onToggleOpen, onSetShown,
}: {
  group: ExamGroup<ExamOption>;
  lessons: OwnLessons;
  hidden: ReadonlySet<string>;
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onSetShown: (keys: string[], show: boolean) => void;
}): React.JSX.Element {
  const p = usePalette();
  const control = groupSwitch(group, hidden);
  const on = control.state !== 'off';
  const reason = groupReason(group);
  const keyExplainer = tagExplainer(group.key);
  const nextDays = daysUntil(group.firstDate);
  // The subject's numbers in one quiet line, with commas (plan §16.2: not a chain of "·").
  const meta = [
    plural(control.total, 'מבחן אחד', 'מבחנים'), control.label ? `${control.label} מסומנים` : null, `הקרוב ${countdownLabel(nextDays)}`,
  ].filter(Boolean).join(', ');
  const keys = group.exams.map((e) => e.naturalKey);
  // Folded, the subject still shows that some of it is guesswork (Maya: "לא מסומן אילו").
  const unsure = group.exams.filter(isUnsure);
  const unsureReasons = new Set(unsure.map(unsureReason));
  const unsureLine = unsure.length === 0
    ? null
    : unsure.length < group.exams.length
      ? `${unsure.length} מתוך ${group.exams.length}`
      : unsureReasons.size === 1 ? [...unsureReasons][0] ?? null : null;
  // One status for the subject too: recommended, else the reason they all share, else "לא בטוח".
  // Unsure exams under a recommended subject are words on the quiet line, not a second status.
  const status = group.recommended ? 'recommended' : reason ? 'not_mine' : unsure.length > 0 ? 'unsure' : null;
  const unsureText = unsure.length > 0 && status !== 'unsure'
    ? `${unsure.length === 1 ? 'אחד' : unsure.length} מתוך ${group.exams.length} לבדוק`
    : null;

  return (
    <View>
      <Row
        style={styles.groupRow}
        // One checkbox for the subject, at the row's start: only some marked is "mixed", a bar, and a tap marks them all.
        lead={(
          <Checkbox
            accessibilityLabel={control.label ? `כל המבחנים ב${group.key}, ${control.label} מסומנים` : `כל המבחנים ב${group.key}`}
            value={control.state === 'partial' ? 'mixed' : on}
            disabled={busy}
            onValueChange={(value) => onSetShown(keys, value)}
          />
        )}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          // What a word in it means ("גוש", "משפרים") is read here; on screen it is behind the one "?" at the top.
          accessibilityLabel={[
            `${group.key}: ${meta}`, keyExplainer, status === 'recommended' ? 'מומלץ לך' : null,
            status === 'not_mine' ? reason : null, status === 'not_mine' && reason ? tagExplainer(reason) : null,
            unsure.length > 0 ? `לא בטוח שהם שלך${unsureLine ? `: ${unsureLine}` : ''}` : null,
          ].filter(Boolean).join(', ')}
          accessibilityHint={open ? 'מקפל את המבחנים' : 'פותח את המבחנים אחד אחד'}
          onPress={onToggleOpen}
          style={({ pressed }) => [styles.groupHead, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.titleRow}>
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.title, color: on ? p.text : p.textMuted }}>{group.key}</Text>
              {status === 'recommended' ? <Mark kind="ok" containerStyle={styles.markInRow}>מומלץ לך</Mark> : null}
              {status === 'not_mine' && reason ? <ReasonWords label={reason} /> : null}
            </View>
            <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{meta}</Text>
            {unsureText ? (
              <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{unsureText}</Text>
            ) : null}
            {status === 'unsure' ? <View style={{ marginTop: 2 }}><UnsureMark reason={unsureLine} /></View> : null}
          </View>
          <View style={[styles.groupArrow, open ? styles.flip : null]}>
            <AppIcon name="chevronDown" color={p.textMuted} size={18} />
          </View>
        </Pressable>
      </Row>

      {open ? (
        <MarginList>
          {group.exams.map((exam) => (
            <ExamRow
              key={exam.naturalKey}
              exam={exam}
              lessons={lessons}
              shown={!hidden.has(exam.naturalKey)}
              busy={busy}
              onSet={(show) => onSetShown([exam.naturalKey], show)}
              showReason={reason === null}
            />
          ))}
        </MarginList>
      ) : null}
    </View>
  );
}

/** One exam, a ruled row with its date in the margin and its box after it; the whole row is its checkbox. */
function ExamRow({
  exam, lessons, shown, busy, onSet, showReason,
}: {
  exam: ExamOption;
  lessons: OwnLessons;
  shown: boolean;
  busy: boolean;
  onSet: (show: boolean) => void;
  /** Off when the group already names one reason for all its exams. */
  showReason: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const days = daysUntil(exam.date);
  // One status at most: `match.mine` makes the three exclusive (W5-9). A bagrut exam is
  // always the owner's, and its mark says what it is (plan §14.9).
  const status = examStatus(exam);
  // A bagrut exam the table knows is named for what it is, "בגרות באנגלית · מודול G" (run 7,
  // Noa): no "בחינת בגרות" mark to say it again, and Mashov's own name only in the exam sheet.
  const bagrut = examKind(exam) !== null;
  const { title, kind, hours } = examNaming(exam, CATALOG);
  const reason = status === 'not_mine' && showReason ? examReason(exam) : null;
  // The deciding fact, when the timetable has it (plan §14.7): her teacher, and the one the title names.
  const fact = status === 'unsure' ? teacherFact(exam, lessons.subjects, lessons.hidden) : null;
  const unsure = status !== 'unsure' ? null : fact ? `${teacherFactText(fact)}. ${FACT_ADVICE}` : unsureReason(exam);
  const subjects = blockSubjects(exam);
  // A block exam's details only list its subjects again (Daniel saw them twice); the line above names them.
  const details = splitExamDetails(exam.details);
  const time = bagrut ? kind?.time ?? hours : details.time;
  const text = subjects || (bagrut && !kind) ? null : details.text;
  // "…למשפרים" in the title itself, unless the reason — here or on the group — already explains it.
  const reasonHelp = status === 'not_mine' ? tagExplainer(examReason(exam) ?? '') : null;
  const titleWord = titleExplainer(title);
  const titleHelp = titleWord && titleWord !== reasonHelp ? titleWord : null;
  const source = examSource(exam.kind === 'manual' ? 'manual' : exam.source).meta;
  const muted = p.textMuted;
  return (
    <MarginRow
      margin={(
        <View style={styles.dateMargin}>
          <Ltr style={[styles.marginDate, { color: muted }]}>{formatShortDate(exam.date)}</Ltr>
          <Text style={[styles.marginDay, { color: muted }]}>{marginWeekday(exam.date)}</Text>
        </View>
      )}
      // The whole row is the checkbox's target, not just the box.
      accessibilityRole="checkbox"
      accessibilityState={{ checked: shown, disabled: busy }}
      accessibilityLabel={[
        title, subjects ? `מקצועות: ${subjects}` : null, dayDateLabel(exam.date), time, countdownLabel(days), source,
        kind ? kind.label : status === 'recommended' && !bagrut ? 'מומלץ לך' : null, unsure ? `לא בטוח שזה שלך: ${unsure}` : null, reason,
        reason ? tagExplainer(reason) : null,
        titleHelp,
      ].filter(Boolean).join(', ')}
      disabled={busy}
      onPress={() => onSet(!shown)}
      // At the row's start, as on every list. Drawn only: the row is the checkbox and takes every tap, so one tap is one save.
      lead={<Checkbox value={shown} disabled={busy} />}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: shown ? p.text : p.textMuted }}>{isolateRanges(title)}</Text>
      {/* A block exam: which subjects sit it, so "פיזיקה" can be found under "גוש ב׳". */}
      {subjects ? (
        <Text style={{ fontFamily: font.body, fontSize: type.small, color: shown ? p.text : p.textMuted }}>
          {`מקצועות: ${subjects}`}
        </Text>
      ) : null}
      {/* When and where from: words on one quiet line, commas between them, the date in the margin. */}
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: muted, lineHeight: 21 }}>
        {time ? (
          <>
            <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: muted }}>{time}</Ltr>
            {', '}
          </>
        ) : null}
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.text }}>{countdownLabel(days)}</Text>
        {`, ${source}`}
      </Text>
      {kind ? (
        <Mark kind="exam" containerStyle={styles.markLine}>{kind.label}</Mark>
      ) : status === 'recommended' && !bagrut ? (
        <Mark kind="ok" containerStyle={styles.markLine}>מומלץ לך</Mark>
      ) : null}
      {reason ? (
        <View style={styles.metaRow}><ReasonWords label={reason} /></View>
      ) : null}
      {unsure ? <View style={{ marginTop: 4 }}><UnsureMark reason={unsure} /></View> : null}
      {text ? (
        <Text numberOfLines={4} style={{ fontFamily: font.body, fontSize: type.small, color: muted, lineHeight: 21 }}>
          {isolateRanges(text)}
        </Text>
      ) : null}
    </MarginRow>
  );
}

const styles = StyleSheet.create({
  // Rows go edge to edge and bring their own gutter; everything else sits in `page`.
  content: { paddingTop: space.lg, paddingBottom: 80 },
  page: { paddingHorizontal: ROW_GUTTER },
  intro: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  introText: { flex: 1, fontFamily: font.bodySemi, fontSize: type.body, lineHeight: 23 },
  block: { marginTop: space.lg },
  recommended: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs, marginStart: -space.md, flexWrap: 'wrap' },
  groups: { marginTop: space.sm, borderTopWidth: 1 },
  // A subject's row (`Row`, with its checkbox as the lead): its head fills the body, the row's padding round it.
  groupRow: { paddingEnd: ROW_END + space.xs },
  // Hangs from the top, so its name sits on the checkbox's line; the arrow in the middle.
  groupHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, minHeight: MIN_TOUCH },
  groupArrow: { alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  markInRow: { alignSelf: 'center' },
  markLine: { marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4, flexWrap: 'wrap' },
  dateMargin: { alignItems: 'center' },
  marginDate: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  marginDay: { fontFamily: font.body, fontSize: type.caption },
  // A fold's chevron points down when closed and up when open, as every
  // disclosure does; a left chevron only ever means "another screen".
  flip: { transform: [{ rotate: '180deg' }] },
});
