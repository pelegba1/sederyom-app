/**
 * An exam's details (plan W4-5), opened from "המבחן הבא" and from every exam
 * on the School screen:
 * - when: the countdown, the day and date, and a time only when the site
 *   wrote one in the details — no field is made up;
 * - what: the subject (for a block exam, the owner's own subject and the
 *   block's others, each once), the details as the site wrote them, and
 *   where it was published;
 * - "?" for an exam the server could not place, with why, "זה שלי" (W6-2:
 *   the "?" goes on every screen, `useConfirmedExams`) and a way to hide it;
 * - "לשנות תאריך" (`ExamDateControls`, `lib/examDate.ts`): the student's own
 *   date for the exam, theirs alone. The sheet shows it, with the school's
 *   date in a muted line under it; the school's day (periods, "השעה עוד לא
 *   פורסמה") belongs to the school's date and is not said of the student's;
 * - "חומר למבחן": the teacher's messages about it (`examMaterial`);
 * - "תוכנית לימוד": 1–4 study sessions, each a task on a school day before
 *   it (`studyPlan`), added together under one toast whose "לבטל" removes
 *   them all. One session is the single study task of R-20. Any session can
 *   move to another school day before the exam (W5-10: Noa's first session
 *   fell on a day she is out; `moveStudySession`, `studyPlanOn`).
 *
 * Wave 9 (plan §16): no boxes inside the sheet. The countdown is the sheet's
 * hero number, in the display face, the date muted under it; the sections
 * sit on the sheet with ruled lines between their rows; the number of
 * sessions and their days are filter chips; one primary button, at the foot.
 *
 *   const [exam, setExam] = useState<Exam | null>(null);
 *   <ExamSheet exam={exam} onClose={() => setExam(null)} />
 *
 * Self-contained: the exam's match, the messages and the task lists come
 * from the cached queries, so any screen can open it. The last exam stays
 * drawn while the sheet slides away.
 *
 * Also home to what the School screen shares with it: `useAddSchoolTask`
 * (the one path a school item becomes a task by), `ExamWhen` and `UnsureMark`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CreateTaskBody, DateStr, Exam, SchoolMessage, Task } from '@sederyom/shared';
import { SUBJECT_NAME_MAX } from '@sederyom/shared/logic/ownNames';
import {
  phoneKeepsExamCalendar, useConfirmedExams, useCreateTask, useDay, useDeleteTask, useExamInCalendar, useExamPrefs, useOwnBoard, useRemoveManualExam,
  useRenameExam, useRenameSubject, useSaveSettings, useSchool, useSettings, useTasks,
} from '../api/hooks';
import { isOwnBoardExam } from '../lib/examBoard';
import { examNaming } from '../lib/bagrut';
import { CATALOG } from '../lib/bagrutCatalog';
import { asksSchoolDay, EXAM_DATE_COPY, examDateArea, examShownTime, isPlannedStudyTitle, studyTitlesFor } from '../lib/examDate';
import { countdownLabel, dayDateLabel, dayDateParts, daysUntil, formatShortDate, isolateRanges, plural, todayStr, weekdayName } from '../lib/format';
import { cleanExamName, EXAM_NAME_MAX, isExamInCalendar, nameToKeep, ownExam } from '../local/examPrefs';
import { examNameOriginals, examNameTarget, examTitleIsSubject, examWithNames, nameOfDraft } from '../local/subjectNames';
import {
  BLOCK_EXPLAINER, blockSubjectsParts, cleanText, examGroupKey, examKind, examKindText, examMaterial, examReason, examSource,
  EXAM_TIME_PENDING, examSlot, examSlotText, findSchoolList, isBlockGroup, isUnsure, messageDateLabel,
  FACT_ADVICE, moveStudySession, OTHER_EXAMS, resolveConfirmed, senderName, setExamsShown, shortWeekday, splitExamDetails, studyDays,
  STUDY_SESSIONS_MAX, studyPlan, studyPlanLine, studyPlanOn, studySessionsMax, tagExplainer, teacherFact, teacherFactText, UNSURE_ADVICE,
  unsureReason, type ExamLike, type ExamSlot,
} from '../lib/school';
import { font, radius, space, type } from '../theme';
import { AppIcon } from './AppIcon';
import { ExamDateControls } from './ExamDateControls';
import { NameEditor, SUBJECT_NAME_NOTE } from './NameEditor';
import { FilterChip, SectionHeading } from './notebook';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Ltr, MIN_TOUCH, Switch, Text, TextInput, touchSlop, usePalette } from './ui';

// ---------------------------------------------------------------------------
// Adding school items to the owner's tasks

type NewTask = Omit<CreateTaskBody, 'listId'>;

export interface SchoolTaskAdder {
  /** Creates the task in the "בית ספר" list when there is one; the toast's "לבטל" deletes it again. */
  add: (body: NewTask, confirm: string) => void;
  /** Several at once — a study plan: one toast, and its "לבטל" deletes every one of them. */
  addMany: (bodies: NewTask[], confirm: string) => void;
  /** An open task with this exact title is already on the owner's list. */
  hasOpen: (title: string) => boolean;
  /** Some open task's title passes `test` — a study task of an exam, in any of its sessions. */
  hasOpenWhere: (test: (title: string) => boolean) => boolean;
  /** What is being added right now by `add`, if anything. */
  pending: CreateTaskBody | undefined;
  /** `addMany` is still saving. */
  busy: boolean;
}

/** A school item becomes a task: homework's copy, a message, an exam's study plan (R-20, R-21, W4-5, W6-4). */
export function useAddSchoolTask(): SchoolTaskAdder {
  const toast = useToast();
  const tasks = useTasks();
  const create = useCreateTask();
  const remove = useDeleteTask();
  // Between the save and the refetched task list, a title is known added only here.
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const remember = (titles: string[], on: boolean): void =>
    setAdded((prev) => {
      const next = new Set(prev);
      for (const t of titles) {
        if (on) next.add(t);
        else next.delete(t);
      }
      return next;
    });

  const open = (): string[] => [...added, ...(tasks.data?.items ?? []).filter((t) => !t.completed).map((t) => t.title)];

  return {
    add: (body, confirm) => {
      const list = findSchoolList(tasks.data?.lists);
      // The promise, not `mutate`'s own callbacks: TanStack skips those once the
      // caller's observer has no listener, and Noa got no toast from homework
      // (W5-10). A promise always settles — the study plan's path, whose toast
      // she did see — and the toast lives above every screen.
      create.mutateAsync({ ...body, listId: list?.id }).then(
        (task) => {
          remember([body.title], true);
          toast.show(confirm, {
            onAction: () => {
              remember([body.title], false);
              remove.mutate(task.id, { onError: () => toast.show('לא הצלחנו להחזיר. אפשר לנסות שוב') });
            },
          });
        },
        (err: Error) => toast.show(`לא הצלחנו להוסיף למשימות: ${err.message}`),
      );
    },
    addMany: (bodies, confirm) => {
      const listId = findSchoolList(tasks.data?.lists)?.id;
      setBusy(true);
      void (async () => {
        // One after the other: a handful of requests, and the list keeps their order.
        const made: Task[] = [];
        for (const body of bodies) {
          try {
            made.push(await create.mutateAsync({ ...body, listId }));
          } catch {
            // Counted below; the ones that did save stay undoable.
          }
        }
        setBusy(false);
        remember(made.map((t) => t.title), true);
        const undo = (): void => {
          remember(made.map((t) => t.title), false);
          void Promise.allSettled(made.map((t) => remove.mutateAsync(t.id))).then((results) => {
            if (results.some((r) => r.status === 'rejected')) toast.show('לא הצלחנו להחזיר הכול. אפשר לנסות שוב');
          });
        };
        if (made.length === bodies.length) toast.show(confirm, { onAction: undo });
        else if (made.length === 0) toast.show('לא הצלחנו להוסיף למשימות. אפשר לנסות שוב');
        else toast.show(`נוספו ${made.length} מתוך ${bodies.length} משימות. אפשר לנסות שוב`, { onAction: undo });
      })();
    },
    hasOpen: (title) => open().includes(title),
    hasOpenWhere: (test) => open().some(test),
    pending: create.isPending && !busy ? create.variables : undefined,
    busy,
  };
}

// ---------------------------------------------------------------------------
// Shared bits

/**
 * "יום שלישי 20.10, 13:00": the weekday, the date and — when the details
 * carry one — the time, with commas between them (plan §16.2: no chain of
 * "·"). The date in the one form an exam's date is written in, on School,
 * in the sheet and on Today (`dayDateParts`). With a `slot` (W6-3), the
 * periods the school published come before the time: "יום שלישי 20.10,
 * שיעורים 1–2, 08:00". A `note` closes the line: "יום חמישי 19.11, הוזז
 * אצלך" (`movedMark`).
 */
export function ExamWhen({
  date, time, color, size = type.small, slot = null, note = null,
}: { date: string; time: string | null; color: string; size?: number; slot?: ExamSlot | null; note?: string | null }): React.JSX.Element {
  const ltr = { fontFamily: font.bodySemi, fontSize: size, color } as const;
  const when = dayDateParts(date);
  return (
    <Text style={{ fontFamily: font.body, fontSize: size, color }}>
      {`${when.weekday} `}
      <Ltr style={ltr}>{when.date}</Ltr>
      {slot ? (
        <>
          {`, ${slot.lead} `}
          <Ltr style={ltr}>{slot.periods}</Ltr>
        </>
      ) : null}
      {time ? (
        <>
          {', '}
          <Ltr style={ltr}>{time}</Ltr>
        </>
      ) : null}
      {note ? `, ${note}` : null}
    </Text>
  );
}

/**
 * "בחינת בגרות, 14:00–15:45" (plan §14.9): a bagrut exam from Mashov's own
 * list says what it is and its hours, the hours in `Ltr`.
 */
export function ExamKindLine({
  kind, color, size = type.small,
}: { kind: { label: string; time: string | null }; color: string; size?: number }): React.JSX.Element {
  return (
    <Text accessibilityLabel={examKindText(kind)} style={{ fontFamily: font.bodySemi, fontSize: size, color }}>
      {kind.label}
      {kind.time ? (
        <>
          {', '}
          <Ltr style={{ fontFamily: font.bodySemi, fontSize: size, color }}>{kind.time}</Ltr>
        </>
      ) : null}
    </Text>
  );
}

/**
 * The "?" on an exam the server could not place (W4-4): a "?" icon and "לא
 * בטוח" in the change ink, and why, in a few muted words. No tag around it
 * (plan §16.1). Read as one element.
 */
export function UnsureMark({ reason }: { reason: string | null }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.unsureRow} accessible accessibilityLabel={['לא בטוח שזה שלך', reason].filter(Boolean).join(': ')}>
      <View style={styles.unsureWord}>
        <AppIcon name="help" color={p.change} size={16} />
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.change }}>לא בטוח</Text>
      </View>
      {reason ? <Text style={{ flexShrink: 1, fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{reason}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The sheet

export function ExamSheet({ exam, onClose }: { exam: Exam | null; onClose: () => void }): React.JSX.Element | null {
  const last = useRef<Exam | null>(exam);
  if (exam) last.current = exam;
  const shown = exam ?? last.current;
  if (!shown) return null;
  // Keyed by the exam, so the chosen number of sessions starts afresh for the next one.
  return <ExamSheetFor key={shown.naturalKey} exam={shown} visible={exam !== null} onClose={onClose} />;
}

/** The isolate pair `Ltr` puts around a date, for a chip's plain-string label. */
const LTR_START = '⁦';
const LTR_END = '⁩';

function ExamSheetFor({ exam: held, visible, onClose }: { exam: Exam; visible: boolean; onClose: () => void }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const settings = useSettings();
  // An exam the student added and moved from here: the date is stored on it, and the screen's copy (`held`) keeps the
  // old one until the lists are built again. (An exam from a source takes its new date from the prefs, below.)
  const [manualMove, setManualMove] = useState<{ from: DateStr; to: DateStr } | null>(null);
  const opened = useMemo(() => (manualMove && manualMove.from === held.date ? { ...held, date: manualMove.to } : held), [held, manualMove]);
  // Under the student's names and on their date as they are now, whatever the screen held when it opened the
  // sheet, so a name or a date given or taken away here shows at once. Their name for its subject first, worked
  // out from the school's title the way the lists work it out (`examWithNames`); then the exam's own name and
  // date, which win (`ownExam`, `examPrefs.ts`).
  const prefs = useExamPrefs();
  const subjectNames = settings.data?.settings.lessons.subjectNames;
  const hiddenLessons = settings.data?.settings.lessons.hiddenSubjects;
  const lines = settings.data?.subjects;
  const underlying = useMemo(
    () => (lines ? examWithNames(opened, subjectNames, lines, hiddenLessons ?? []) : opened),
    [opened, subjectNames, lines, hiddenLessons],
  );
  const exam = ownExam(underlying, prefs);
  // Whose board an exam of the exam schedule is: the person's own, when it holds the exam, else the class's (V-2).
  const ownBoard = useOwnBoard();
  const fromOwnBoard = isOwnBoardExam(exam, ownBoard);
  const school = useSchool();
  const save = useSaveSettings();
  const tasks = useAddSchoolTask();
  const { confirmed, setConfirmed } = useConfirmedExams();
  const [sessions, setSessions] = useState(1);
  // Days the owner picked for the sessions; `null` is the plan's own spread.
  const [pickedDays, setPickedDays] = useState<DateStr[] | null>(null);
  // The session whose day is being changed.
  const [moving, setMoving] = useState<number | null>(null);
  const [explained, setExplained] = useState(false);
  // An undo runs seconds later, against whatever the hide-list is by then.
  const hiddenKeys = settings.data?.settings.exams.hiddenKeys ?? [];
  const latestHidden = useRef(hiddenKeys);
  latestHidden.current = hiddenKeys;

  const today = todayStr();
  const listed = settings.data?.exams.find((e) => e.naturalKey === exam.naturalKey) ?? null;
  // With the owner's "זה שלי", which clears the "?" here as on every screen (W6-2).
  const option = listed ? resolveConfirmed(listed, confirmed) : null;
  const like: ExamLike = {
    naturalKey: exam.naturalKey, date: exam.date, subject: exam.subject, originalSubject: exam.originalSubject,
    subjectKey: option?.subjectKey, match: option?.match, kind: exam.kind, startTime: exam.startTime, endTime: exam.endTime,
  };
  const days = daysUntil(exam.date);
  const details = splitExamDetails(exam.details);
  const text = details.text;
  // A bagrut exam carries its own hours (plan §14.9): "בחינת בגרות · 14:00–15:45", never "?" nor "not mine".
  // Named for what it is when the table knows its code (run 7, Noa): its hours then go on the date's
  // line, and Mashov's own name stays below, under "פרטים".
  const bagrut = examKind(exam) !== null;
  const naming = examNaming(exam, CATALOG);
  const kind = naming.kind;
  // The periods and the time the school published for that day (W6-3, Noa); else the details' own time.
  // Not for a moved exam: what the school publishes, for a day or in its details, is for the school's date, not for
  // the student's, so no time is said of the student's date: neither the periods, nor the details' time, nor "השעה עוד
  // לא פורסמה" (`examShownTime`). The details text itself is shown as it is.
  const asksDay = asksSchoolDay(exam);
  const day = useDay(exam.date, asksDay);
  const slot = bagrut || !asksDay ? null : examSlot(like, day.data);
  const time = examShownTime(exam, { bagrut: kind?.time ?? naming.hours, slot: slot?.time ?? null, details: details.time });
  const timePending = !time && !bagrut && asksDay;
  const area = examDateArea(exam, today);
  const group = examGroupKey(like);
  const block = isBlockGroup(group);
  const parts = option ? blockSubjectsParts(option) : null;
  // Only an exam the picker lists can be called unsure; one it does not know (yet) is just shown.
  // The exam itself says whether it is a bagrut exam, whatever the picker's copy of it carries.
  const unsure = !bagrut && option !== null && isUnsure(option);
  const notMine = option && !bagrut ? examReason(option) : null;
  // What decides it, when the timetable knows (plan §14.7, Noa): her teacher, and the one the title names.
  const fact = unsure && option
    ? teacherFact(option, settings.data?.subjects ?? [], settings.data?.settings.lessons.hiddenSubjects ?? [])
    : null;
  const material = examMaterial(like, school.data?.messages ?? []);

  const maxSessions = studySessionsMax(exam.date, today);
  const n = Math.min(sessions, maxSessions);
  const plan = pickedDays ? studyPlanOn(like, today, pickedDays) : studyPlan(like, today, n);
  const dayChoices = studyDays(exam.date, today);
  const pickSessions = (k: number): void => {
    setSessions(k);
    setPickedDays(null);
    setMoving(null);
  };
  const moveTo = (index: number, day: DateStr): void => {
    setPickedDays(moveStudySession(plan.map((t) => t.due), index, day));
    setMoving(null);
  };
  // A plan made before the exam was moved has the school's date in its title: found by either date, so no second one is offered.
  const singles = studyTitlesFor(like, exam.originalDate, today);
  const planned = tasks.hasOpenWhere((title) => isPlannedStudyTitle(title, singles));
  const canPlan = maxSessions > 0 && !planned;

  const addPlan = (): void => {
    onClose();
    const bodies = plan.map((t) => ({ title: t.title, notes: t.notes, due: t.due }));
    tasks.addMany(bodies, bodies.length === 1 ? 'נוספה משימת לימוד' : `נוספו ${bodies.length} משימות לימוד`);
  };

  // "לא המבחן שלי" takes back an earlier "זה שלי" too; its "לבטל" gives both back.
  const hide = (): void => {
    const key = exam.naturalKey;
    const wasConfirmed = option?.confirmed === true;
    onClose();
    if (wasConfirmed) setConfirmed(key, false);
    save.mutate({ exams: { hiddenKeys: setExamsShown(latestHidden.current, [key], false) } }, {
      onSuccess: () => toast.show('המבחן הוסתר מהמבחנים שלך', {
        onAction: () => {
          if (wasConfirmed) setConfirmed(key, true);
          save.mutate(
            { exams: { hiddenKeys: setExamsShown(latestHidden.current, [key], true) } },
            { onError: () => toast.show('לא הצלחנו להחזיר. אפשר לנסות שוב') },
          );
        },
      }),
      onError: (err) => {
        if (wasConfirmed) setConfirmed(key, true);
        toast.show(`לא הצלחנו להסתיר: ${err.message}`);
      },
    });
  };

  // "זה שלי" (W6-2, Daniel and Noa): the "?" goes here, in "המבחנים שלי", on School and in the counts.
  // The sheet stays open, and its own line says so with "לבטל את הבחירה": a
  // toast would sit under the sheet's window, unseen.
  const confirm = (on: boolean): void => setConfirmed(exam.naturalKey, on);

  // A text button: the sheet's one primary button is the study plan's, at its foot (plan §16).
  const hideButton = <Button title="לא המבחן שלי, להסתיר" variant="ghost" disabled={save.isPending} onPress={hide} />;

  // An exam the student added is theirs to take away again, with an undo.
  const manual = exam.kind === 'manual';
  const manualExams = useRemoveManualExam();
  const removeManual = (): void => {
    const gone = manualExams.remove(exam.naturalKey);
    onClose();
    if (gone) toast.show('המבחן נמחק', { onAction: () => manualExams.restore(gone) });
  };

  // "לשנות שם": any exam, a name of the student's own, everywhere the phone shows it and in its
  // Google calendar. An empty name gives the source's back. The sheet's own title shows the change.
  const renameExam = useRenameExam();
  const original = exam.originalSubject ?? exam.subject;
  // A name of this exam's own: `originalSubject` set and no `subjectName`. A name that came from the subject's is not one.
  const renamed = exam.originalSubject !== undefined && exam.subjectName === undefined;
  // The name the student saw before renaming it: the sheet's title then, a bagrut exam's from the table.
  const originalTitle = examNaming({ ...exam, subject: original, originalSubject: undefined, subjectName: undefined }, CATALOG).title;
  // The name the sheet's title shows now, which the field starts with: the exam's own, else the one the exam is called
  // (the school's title, or the table's, or with the subject's name in it).
  const shownName = renamed ? exam.subject : naming.title;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  // "לשנות את שם המקצוע" / "לשנות את השם של גוש ב׳": a name for the subject or block the title reads, which every
  // exam and lesson of it takes, and the pushes (`useRenameSubject`). Not before the settings are read: a name
  // written then would have nothing to join.
  const renameSubject = useRenameSubject();
  // An exam from Mashov's own list is named by its whole subject, as the lists name it (`namedExam`).
  const wholeName = examTitleIsSubject(exam);
  const target = useMemo(
    () => (lines ? examNameTarget(original, lines, hiddenLessons ?? [], wholeName) : null),
    [original, lines, hiddenLessons, wholeName],
  );
  // The words of the title the name replaces (all of it, for an exam from Mashov's own list): the field shows them
  // while it is empty, and typed back they are no name.
  const subjectOriginals = useMemo(
    () => (lines ? examNameOriginals(original, lines, hiddenLessons ?? [], wholeName) : []),
    [original, lines, hiddenLessons, wholeName],
  );
  // The name the subject has now, also under an exam's own name, which hides it from the title.
  const subjectNameNow = underlying.subjectName;
  const [renamingSubject, setRenamingSubject] = useState(false);
  const [subjectTyped, setSubjectTyped] = useState(false);
  // The sheet stays mounted once closed (`ExamSheet`): a rename left open must not greet the next opening.
  useEffect(() => {
    if (!visible) {
      setEditing(false);
      setNameFocused(false);
      setRenamingSubject(false);
    }
  }, [visible]);
  const nameChanged = editing && cleanExamName(draft) !== cleanExamName(shownName);
  const startRename = (): void => {
    setDraft(shownName);
    setEditing(true);
  };
  const saveName = (): void => {
    setEditing(false);
    // The original name typed back, under either spelling, is no name of their own; the same name again changes
    // nothing (for an exam named by its subject's name too: that is not a name of its own to keep).
    const name = nameToKeep(draft, [original, originalTitle]);
    if (name === (renamed ? exam.subject : null) || cleanExamName(draft) === cleanExamName(shownName)) return;
    renameExam(exam.naturalKey, name, original);
  };
  const restoreName = (): void => {
    renameExam(exam.naturalKey, null, original);
    setEditing(false);
  };
  const giveSubjectName = (name: string | null): void => {
    setRenamingSubject(false);
    if (!target) return;
    // The same name again changes nothing.
    if (name === (subjectNameNow ?? null)) return;
    // No name clears every key that could still name the subject, so the school's name really comes back.
    renameSubject(name === null ? target.clear : target.keys, name, subjectOriginals);
  };

  // "להציג ביומן Google": only where the phone itself keeps the "בית ספר" calendar, the student
  // wants exams there, and the calendar would carry this one (`mirrorItems`: from today on, not
  // hidden). Off leaves the exam in the app; "לא המבחן שלי" is what hides it.
  const setInCalendar = useExamInCalendar();
  const calendarChoice = settings.data?.settings.examsToCalendar === true && phoneKeepsExamCalendar()
    && exam.date >= today && !hiddenKeys.includes(exam.naturalKey);
  const inCalendar = isExamInCalendar(prefs, exam.naturalKey);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      // A name typed and not saved is not lost to a tap on the backdrop, as in "+ מבחן".
      dismissable={!nameChanged && !subjectTyped}
      title={naming.title}
      footer={canPlan ? (
        <Button
          title={plan.length === 1 ? 'להוסיף משימת לימוד' : `להוסיף ${plan.length} משימות לימוד`}
          disabled={tasks.busy || plan.length === 0}
          onPress={addPlan}
        />
      ) : undefined}
    >
      <View style={styles.sections}>
        {/* When: the countdown first — it is what the sheet is opened for — as the sheet's hero number. */}
        <View>
          <View
            accessible
            accessibilityLabel={[
              countdownLabel(days), dayDateLabel(exam.date),
              kind ? examKindText(kind) : time ? `בשעה ${time}` : timePending ? EXAM_TIME_PENDING : null,
            ].filter(Boolean).join(', ')}
          >
            <Text style={[styles.hero, { color: p.text }]}>{countdownLabel(days)}</Text>
            <ExamWhen date={exam.date} time={kind ? null : time} color={p.textMuted} size={type.body} />
            {kind ? <ExamKindLine kind={kind} color={p.textMuted} size={type.body} /> : null}
            {/* No time from anywhere yet: say when there will be one, rather than leave a gap (W6-3). */}
            {timePending && !day.isLoading ? (
              <Text style={[styles.paragraph, { color: p.textMuted, marginTop: 2 }]}>{EXAM_TIME_PENDING}</Text>
            ) : null}
          </View>
          {/* A moved exam says whose date this is: the school's stays on its list, the student's is theirs alone. */}
          {area.schoolDate ? <SchoolDateLine date={area.schoolDate} /> : null}
        </View>

        {unsure && fact ? (
          // The fact and the recommendation, and "לא שלי" first (plan §14.7).
          <View style={styles.block}>
            <UnsureMark reason={null} />
            <Text style={[styles.paragraph, { fontFamily: font.bodySemi, fontSize: type.body, color: p.text }]}>{teacherFactText(fact)}</Text>
            <Text style={[styles.paragraph, { color: p.textMuted }]}>{FACT_ADVICE}</Text>
            <View style={styles.buttons}>
              {hideButton}
              <Button title="זה שלי" variant="ghost" onPress={() => confirm(true)} />
            </View>
          </View>
        ) : unsure ? (
          <View style={styles.block}>
            <UnsureMark reason={unsureReason(option!)} />
            <Text style={[styles.paragraph, { color: p.text }]}>{UNSURE_ADVICE}</Text>
            <View style={styles.buttons}>
              <Button title="זה שלי" variant="ghost" onPress={() => confirm(true)} />
              {hideButton}
            </View>
          </View>
        ) : null}
        {option?.confirmed ? (
          <View style={styles.confirmed}>
            <AppIcon name="check" color={p.ok} size={18} />
            <Text style={[styles.paragraph, { flex: 1, color: p.textMuted }]}>בחרת שהמבחן הזה שלך</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="לבטל את הבחירה שהמבחן שלך"
              hitSlop={touchSlop(20)}
              onPress={() => confirm(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>לבטל את הבחירה</Text>
            </Pressable>
          </View>
        ) : null}

        <View>
          {block ? (
            <>
              <DetailRow label="גוש">
                <View style={styles.inline}>
                  <Text style={[styles.value, { color: p.text }]}>{group}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: explained }}
                    accessibilityLabel="מה זה גוש?"
                    hitSlop={13}
                    onPress={() => setExplained((v) => !v)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <AppIcon name="help" color={p.accent} size={18} />
                  </Pressable>
                </View>
                {explained ? (
                  <Text accessibilityLiveRegion="polite" style={[styles.paragraph, { color: p.textMuted, marginTop: 2 }]}>
                    {BLOCK_EXPLAINER}
                  </Text>
                ) : null}
              </DetailRow>
              {parts?.own ? <DetailRow label="המקצוע שלך" value={parts.own} strong /> : null}
              {parts?.others ? <DetailRow label={parts.own ? 'בגוש גם' : 'מקצועות'} value={parts.others} /> : null}
            </>
          ) : group !== OTHER_EXAMS ? (
            <DetailRow label="מקצוע" value={group} strong />
          ) : null}
          {slot ? (
            <DetailRow label="שעה" a11y={examSlotText({ ...slot, time })}>
              <Text style={[styles.value, { color: p.text }]}>
                {`${slot.lead} `}
                <Ltr style={[styles.value, { color: p.text }]}>{slot.periods}</Ltr>
                {time ? (
                  <>
                    {', '}
                    <Ltr style={[styles.value, { color: p.text }]}>{time}</Ltr>
                  </>
                ) : null}
              </Text>
            </DetailRow>
          ) : time ? (
            <DetailRow label="שעה">
              <Ltr style={[styles.value, { color: p.text }]}>{time}</Ltr>
            </DetailRow>
          ) : null}
          {text ? <DetailRow label="פרטים" value={isolateRanges(text)} /> : null}
          {notMine ? <DetailRow label="הערה" value={[notMine, tagExplainer(notMine)].filter(Boolean).join('. ')} /> : null}
          {exam.originalSubject !== undefined ? <DetailRow label="שם מקורי" value={isolateRanges(originalTitle)} /> : null}
          <DetailRow label="מקור" value={examSource(exam.kind === 'manual' ? 'manual' : exam.source, fromOwnBoard).full} />
        </View>

        {/* The student's own word on the exam: its name, and whether Google's calendar carries it. */}
        <View style={styles.block}>
          {editing ? (
            <>
              <TextInput
                accessibilityLabel="שם המבחן"
                // Only a name of this exam's own goes when emptied; one from its subject's stays.
                accessibilityHint={renamed ? 'שם ריק מחזיר את השם המקורי' : undefined}
                value={draft}
                onChangeText={setDraft}
                autoFocus
                maxLength={EXAM_NAME_MAX}
                returnKeyType="done"
                onSubmitEditing={saveName}
                placeholder={originalTitle}
                placeholderTextColor={p.textFaint}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                style={[
                  styles.input,
                  { color: p.text, backgroundColor: p.surfaceAlt, borderBottomColor: nameFocused ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 },
                  nameFocused ? styles.inputFocused : null,
                ]}
              />
              <Text style={[styles.paragraph, { color: p.textMuted }]}>
                {renamed
                  ? `השם המקורי: ${isolateRanges(originalTitle)}. אפשר להשאיר ריק כדי לחזור אליו.`
                  : `השם המקורי: ${isolateRanges(originalTitle)}`}
              </Text>
              <View style={styles.buttons}>
                <Button title="לשמור" variant="ghost" onPress={saveName} />
                <Button title="ביטול" variant="ghost" onPress={() => setEditing(false)} />
              </View>
            </>
          ) : renamingSubject && target ? (
            <NameEditor
              label="שם המקצוע"
              initial={subjectNameNow ?? ''}
              original={subjectOriginals[0] ?? ''}
              note={SUBJECT_NAME_NOTE}
              maxLength={SUBJECT_NAME_MAX}
              onSave={(typed) => giveSubjectName(nameOfDraft(typed, subjectOriginals))}
              onCancel={() => setRenamingSubject(false)}
              onDirty={setSubjectTyped}
            />
          ) : (
            <>
              <View style={styles.buttons}>
                <Button title="לשנות שם" variant="ghost" onPress={startRename} />
                {/* The way back is the name that shows: the exam's own, else its subject's. An exam with both shows its own. */}
                {renamed ? (
                  <Button title="להחזיר את השם המקורי" variant="ghost" onPress={restoreName} />
                ) : exam.subjectName !== undefined && target ? (
                  <Button title="להחזיר את השם המקורי" variant="ghost" onPress={() => giveSubjectName(null)} />
                ) : null}
              </View>
              {target ? (
                <View style={styles.buttons}>
                  <Button title={target.label} variant="ghost" onPress={() => setRenamingSubject(true)} />
                </View>
              ) : null}
            </>
          )}
          <ExamDateControls
            exam={exam}
            area={area}
            today={today}
            visible={visible}
            onManualMoved={(to) => setManualMove({ from: held.date, to })}
            onClose={onClose}
          />
          {calendarChoice ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: inCalendar }}
              accessibilityLabel="להציג ביומן Google"
              accessibilityHint={inCalendar ? 'המבחן מופיע ביומן ״בית ספר״' : 'המבחן נשאר באפליקציה, רק לא ביומן'}
              onPress={() => setInCalendar(exam.naturalKey, !inCalendar)}
              style={({ pressed }) => [styles.switchRow, { borderBottomColor: p.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.value, { color: p.text }]}>להציג ביומן Google</Text>
                <Text style={[styles.paragraph, { color: p.textMuted }]}>
                  {inCalendar ? 'המבחן מופיע ביומן ״בית ספר״' : 'המבחן נשאר באפליקציה, רק לא ביומן'}
                </Text>
              </View>
              <Switch value={inCalendar} />
            </Pressable>
          ) : null}
        </View>

        <View>
          <SectionHeading>חומר למבחן</SectionHeading>
          {material.length > 0 ? (
            material.map((msg) => <MaterialItem key={msg.naturalKey} msg={msg} />)
          ) : (
            <Text style={[styles.paragraph, { color: p.textMuted }]}>עוד אין הודעה מהמורה על המבחן הזה.</Text>
          )}
        </View>

        {maxSessions > 0 ? (
          <View>
            <SectionHeading>תוכנית לימוד</SectionHeading>
            {planned ? (
              <View style={styles.doneLine}>
                <AppIcon name="check" color={p.ok} size={18} />
                <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.ok }}>משימות הלימוד כבר במשימות שלך</Text>
              </View>
            ) : (
              <View style={{ gap: space.sm }}>
                <Text style={{ fontFamily: font.body, fontSize: type.body, color: p.text }}>כמה מפגשי לימוד?</Text>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {Array.from({ length: STUDY_SESSIONS_MAX }, (_, i) => i + 1).map((k) => (
                    <FilterChip
                      key={k}
                      role="radio"
                      label={String(k)}
                      selected={k === n}
                      disabled={k > maxSessions}
                      accessibilityLabel={plural(k, 'מפגש אחד', 'מפגשים')}
                      onPress={() => pickSessions(k)}
                    />
                  ))}
                </View>
                {maxSessions < STUDY_SESSIONS_MAX ? (
                  <Text style={[styles.paragraph, { color: p.textMuted }]}>
                    {maxSessions === 1 ? 'עד המבחן נשאר זמן למפגש אחד' : `עד המבחן נשאר זמן ל־${maxSessions} מפגשים`}
                  </Text>
                ) : null}
                <View>
                  {/* One plain sentence (Wave 9 re-rate): one session's own row says it with its day;
                      several say how many here, and each row its day. */}
                  {plan.length > 1 ? (
                    <Text style={[styles.paragraph, { color: p.textMuted }]}>{studyPlanLine(like, plan.length, plan[0]!.due, today).text}</Text>
                  ) : null}
                  {plan.map((t, i) => (
                    <PlanSession
                      key={t.due}
                      label={plan.length === 1 ? studyPlanLine(like, 1, t.due, today) : sessionLabel(i, t.due, today)}
                      due={t.due}
                      today={today}
                      open={moving === i}
                      choices={dayChoices}
                      taken={plan.filter((_, j) => j !== i).map((o) => o.due)}
                      onToggle={() => setMoving((m) => (m === i ? null : i))}
                      onPick={(day) => moveTo(i, day)}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        ) : null}

        {/* A bagrut exam is always the owner's: no "not mine" (plan §14.9). One they added is deleted instead. */}
        {manual ? (
          <View style={{ alignItems: 'flex-start' }}><Button title="למחוק את המבחן" variant="danger" onPress={removeManual} /></View>
        ) : unsure || bagrut ? null : <View style={{ alignItems: 'flex-start' }}>{hideButton}</View>}
      </View>
    </Sheet>
  );
}

/** "בלוח של בית הספר: יום שני 9.11": the school's date of an exam the student moved, one muted line under theirs. */
function SchoolDateLine({ date }: { date: DateStr }): React.JSX.Element {
  const p = usePalette();
  const when = dayDateParts(date);
  const ink = { fontFamily: font.body, fontSize: type.small, color: p.textMuted } as const;
  return (
    <Text accessibilityLiveRegion="polite" accessibilityLabel={`${EXAM_DATE_COPY.schoolLead}${dayDateLabel(date)}`} style={[ink, { marginTop: 2 }]}>
      {`${EXAM_DATE_COPY.schoolLead}${when.weekday} `}
      <Ltr style={{ ...ink, fontFamily: font.bodySemi }}>{when.date}</Ltr>
    </Text>
  );
}

/** "מפגש 2: יום שלישי 13.10" (or "מפגש 1: היום"), one session of several. */
function sessionLabel(index: number, due: DateStr, today: DateStr): { text: string; date: string | null } {
  const lead = `מפגש ${index + 1}: `;
  if (due === today) return { text: `${lead}היום`, date: null };
  return { text: `${lead}${weekdayName(due)} `, date: formatShortDate(due) };
}

/**
 * One session of the plan, a ruled line — its words (`label`: the whole
 * sentence for a single session, `studyPlanLine`) and "לשנות יום": the school
 * days before the exam open under it as chips, another session's day
 * disabled (W5-10, Noa and Itai).
 */
function PlanSession({
  label, due, today, open, choices, taken, onToggle, onPick,
}: {
  label: { text: string; date: string | null };
  due: DateStr;
  today: DateStr;
  open: boolean;
  choices: DateStr[];
  taken: DateStr[];
  onToggle: () => void;
  onPick: (day: DateStr) => void;
}): React.JSX.Element {
  const p = usePalette();
  const { text: head, date } = label;
  return (
    <View style={[styles.session, { borderBottomColor: p.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${head}${date ?? ''}. לשנות יום`}
        onPress={onToggle}
        style={({ pressed }) => [styles.sessionHead, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.body, color: p.text, lineHeight: 23 }}>
          {head}
          {date ? <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{date}</Ltr> : null}
        </Text>
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>{open ? 'סגירה' : 'לשנות יום'}</Text>
      </Pressable>
      {open ? (
        <View style={[styles.chips, styles.days]} accessibilityRole="radiogroup">
          {choices.map((day) => {
            const selected = day === due;
            const disabled = taken.includes(day);
            return (
              <FilterChip
                key={day}
                role="radio"
                // A chip's label is one plain string: the date pinned left-to-right as `Ltr` pins it.
                label={day === today ? 'היום' : `${shortWeekday(day)} ${LTR_START}${formatShortDate(day)}${LTR_END}`}
                selected={selected}
                disabled={disabled}
                accessibilityLabel={`${weekdayName(day)} ${formatShortDate(day)}${disabled ? ', כבר יש בו מפגש' : ''}`}
                onPress={() => {
                  if (!selected) onPick(day);
                }}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A label and its value on a ruled line; `children` replaces a plain value,
 * and `a11y` reads them as one element.
 */
function DetailRow({
  label, value, strong = false, a11y, children,
}: { label: string; value?: string; strong?: boolean; a11y?: string; children?: React.ReactNode }): React.JSX.Element {
  const p = usePalette();
  const spoken = value ?? a11y;
  return (
    <View
      style={[styles.row, { borderBottomColor: p.border }]}
      accessible={spoken !== undefined}
      accessibilityLabel={spoken !== undefined ? `${label}: ${spoken}` : undefined}
    >
      <Text style={[styles.label, { color: p.textMuted }]}>{label}</Text>
      <View style={{ flex: 1 }}>
        {value !== undefined ? <Text style={[styles.value, { color: p.text }, strong ? { fontFamily: font.bodySemi } : null]}>{value}</Text> : children}
      </View>
    </View>
  );
}

/** Long enough to fold: more than four lines' worth. */
function isLong(text: string): boolean {
  return text.length > 200 || text.split('\n').length > 4;
}

/** One teacher's message about the exam, on the sheet: its title, who and when, and the body — folded when long. */
function MaterialItem({ msg }: { msg: SchoolMessage }): React.JSX.Element {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const title = cleanText(msg.title);
  const body = cleanText(msg.body);
  const showBody = body.length > 0 && body !== title;
  const foldable = showBody && isLong(body);
  // As the messages tab says it (plan §14.1): "דנה כהן, נשלחה 8.10".
  const sent = messageDateLabel(msg);
  const from = senderName(msg.from);

  const content = (
    <>
      <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{isolateRanges(title)}</Text>
      {from || sent ? (
        <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>
          {from ? `${isolateRanges(from)}${sent ? ', ' : ''}` : ''}
          {sent ? `${sent.lead} ` : ''}
          {sent ? <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>{sent.date}</Ltr> : null}
        </Text>
      ) : null}
      {showBody ? (
        <Text
          numberOfLines={foldable && !open ? 4 : undefined}
          style={{ fontFamily: font.body, fontSize: type.body, color: p.text, marginTop: space.xs, lineHeight: 23 }}
        >
          {isolateRanges(body)}
        </Text>
      ) : null}
      {foldable ? (
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent, marginTop: space.xs }}>{open ? 'פחות' : 'עוד'}</Text>
      ) : null}
    </>
  );

  const style = [styles.material, { borderBottomColor: p.border }];
  if (!foldable) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint={open ? 'מקפל את ההודעה' : 'פותח את ההודעה המלאה'}
      onPress={() => setOpen((v) => !v)}
      style={({ pressed }) => [...style, { opacity: pressed ? 0.85 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sections: { gap: space.xl },
  hero: { fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.3) },
  paragraph: { fontFamily: font.body, fontSize: type.small, lineHeight: 21 },
  block: { gap: space.sm },
  unsureRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.sm, rowGap: 2 },
  unsureWord: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginStart: -space.md },
  confirmed: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, minHeight: MIN_TOUCH },
  doneLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1 },
  // A column of labels; at a large text size a long one wraps rather than pushing its value.
  label: { fontFamily: font.bodyMedium, fontSize: type.small, width: 92 },
  value: { fontFamily: font.body, fontSize: type.body, lineHeight: 23 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  session: { borderBottomWidth: 1 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH + space.sm },
  days: { paddingBottom: space.md },
  material: { paddingVertical: space.md, borderBottomWidth: 1, gap: 2 },
  // The underlined field of the task sheet (plan §16.1), as "+ מבחן" has it.
  input: {
    borderBottomWidth: 1, borderTopStartRadius: radius.sm, borderTopEndRadius: radius.sm,
    paddingTop: 12, paddingBottom: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, textAlign: 'right', writingDirection: 'rtl',
  },
  inputFocused: { borderBottomWidth: 2, paddingBottom: 11 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH + space.sm, paddingVertical: space.sm, borderBottomWidth: 1 },
});
