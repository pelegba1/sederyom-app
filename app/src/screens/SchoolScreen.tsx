/**
 * בית ספר (design panel 04): the next exam and the ones after it, homework
 * with "עשיתי", grades by subject, and messages from
 * both school sources. Grades, homework and Mashov's messages all come from
 * Mashov; while it is not connected each list says so and offers to connect,
 * rather than claiming there is nothing (F8).
 *
 * Wave 3 (R4): a tick on homework can be taken back from its toast (R-17);
 * each sub-tab opens at its top (R-18); a grade is never judged, only a high
 * one is marked "מצוין" (R-19); the next exam offers a study task (R-20) and a
 * message can become a task (R-21).
 *
 * Wave 4 (T3): every exam opens its details, material and study plan
 * (`ExamSheet`, W4-5); an exam the server could not place carries a "?"
 * (W4-4); a block exam names its subjects once; a task from a message takes
 * the day the message names (W4-6); every grade row names its assessment
 * (W4-7), and a grade in words ("הוגש") is not drawn as a number.
 *
 * Wave 6: "שלי" clears an exam's "?" everywhere (W6-2); "המבחן הבא" names its
 * periods once the school publishes its day (W6-3); homework is in "משימות"
 * already, so a row has no task action — its sheet offers "להעתיק ל־Google
 * Tasks" (W6-4).
 *
 * Wave 9 (plan §16): the notebook. The five tabs are underlined, not pills;
 * the lists sit on the page in ruled rows, with dates in the red margin for
 * exams and homework. The next exam is the screen's one raised surface, its
 * name under the yellow highlighter. A grade's average is a number at the
 * row's end, and the weighted average is explained once, behind "איך מחשבים
 * את הממוצע?" at the top of the tab. A message is a section of the page.
 *
 * Plan §17: a sixth tab, "חיסורים" (components/AttendanceTab), after "הודעות";
 * on a 360-point phone the row scrolls to it.
 *
 * "איפה המורה?" (docs/superpowers/specs/2026-11-04-teacher-search-design.md):
 * a line under the header opens the teacher search, where the school has a
 * Shahaf site (its class timetables are what it reads).
 *
 * Message search (docs/superpowers/plans/2026-10-29-message-search.md): the
 * phone reads up to 100 conversations, so "הודעות" opens with Tasks' search
 * row, the words and the teacher as a menu beside them; results open while
 * you type.
 */
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { MaterialTopTabScreenProps } from '@react-navigation/material-top-tabs';
import type {
  Exam, ExamOption, Grade, HomeworkItem, SchoolMessage, SchoolTab, SubjectOption,
} from '@sederyom/shared';
import { useConfirmedExams, useDay, useGoogleConnected, useOwnBoard, useSchool, useSetHomeworkDone, useSettings, useStatus, useSyncNow } from '../api/hooks';
import { storedFeed } from '../device/v2';
import { examsTabSourceLine } from '../lib/examBoard';
import { AttendanceTab } from '../components/AttendanceTab';
import { mashovWasRead } from '../lib/connections';
import { hasBagrut } from '../lib/onboarding';
import { BagrutTab } from '../components/BagrutTab';
import { AppIcon, type IconName } from '../components/AppIcon';
import { ExamKindLine, ExamSheet, ExamWhen, UnsureMark, useAddSchoolTask, type SchoolTaskAdder } from '../components/ExamSheet';
import {
  Checkbox, MarginList, MarginRow, Mark, Row, ROW_END, ROW_GUTTER, ROW_MIN_HEIGHT, SectionHeading, UnderlineTabs, type UnderlineTab,
} from '../components/notebook';
import { SearchField } from '../components/SearchField';
import { ShareToGroup } from '../components/ShareToGroup';
import { Sheet } from '../components/Sheet';
import { TabHeader } from '../components/TabHeader';
import { useSheetPressGuard, type SheetPressGuard } from '../components/TaskRow';
import { examsShareText } from '../lib/share';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { bagrutExamTitle, EMPTY_MARK, examNaming } from '../lib/bagrut';
import { CATALOG } from '../lib/bagrutCatalog';
import { asksSchoolDay, examShownTime, examsToShare, isPlannedStudyTitle, movedMark, studyTitlesFor } from '../lib/examDate';
import { countdownLabel, daysUntil, formatShortDate, isolateRanges, plural, shownSubject, todayStr, weekdayName } from '../lib/format';
import { rtlPlaceholder } from '../lib/planner';
import { TEACHER_SEARCH_COPY } from '../lib/teacherSearch';
import {
  addedToTasksLabel, assessmentName, averageLabel, blockSubjectsParts, canCopyToGoogle, cleanText, connectLabel, COPY_TO_GOOGLE_TASKS,
  copiedToTasksLabel, daysLeft, daysLeftLabel, disconnectedText, dueParts, HOMEWORK_COPIED, HOMEWORK_IN_TASKS,
  examCounts, examEmptyState, examKindText, examSlot, examSlotText, examsMineLabel, feedState,
  formatAverage, gradeHighlight, groupGradesBySubject, HOMEWORK_RECENT_DAYS, homeworkSections, homeworkTaskTitle,
  isOverdue, LESSONS_COPY, marginWeekday, mashovLink, messageDateLabel, messagesNewestFirst, messageSummary, messageSummaryText,
  messageTaskDay, messageTaskDayLead, messageTaskTitle, schoolTabsFor, senderName, shortWeekday, splitExamDetails, staleBanner,
  unsureNote, weightLabel, withConfirmed, averageNote, averageSharesText, CHANGED_WORD,
  WEIGHTED_AVERAGE_EXPLAINER, AVERAGE_HELP,
  ALL_SENDERS, CLEAR_MESSAGE_SEARCH, MESSAGE_BODIES_PENDING, MESSAGE_SEARCH_LABEL, MESSAGES_NO_MATCH, SENDER_MENU_TITLE,
  messageSearchCount, messageSenders, selectMessages,
  type ExamLike, type MashovFeed, type MashovLink, type MessageSummary,
} from '../lib/school';
import { resolveGrade, subjectTypes, typeLabel, type GradeWeightsPrefs, type ResolvedGrade } from '../lib/gradeWeights';
import { readGradeWeights, writeGradeWeights } from '../lib/gradeWeightsStore';
import { GradeSheet, SubjectWeightsSheet, type WeightsUpdate } from '../components/GradeWeightsSheets';
import { storage } from '../widget/feedCache';
import { font, space, type } from '../theme';
import type { RootNavigation, TabsParamList } from '../navigation/types';

/** When the grades tab was last left; a grade the phone first saw after that is "new" (`mashov/gradeFirstSeen.ts`). */
const GRADES_SEEN_KEY = 'school.grades.seenAt';

/** One empty list, so a memo over it does not rerun. */
const NONE: never[] = [];

export function SchoolScreen({ route, navigation }: MaterialTopTabScreenProps<TabsParamList, 'School'>): React.JSX.Element {
  const p = usePalette();
  const root = useNavigation<RootNavigation>();
  const school = useSchool();
  const settings = useSettings();
  const status = useStatus();
  const sync = useSyncNow();
  const [tab, setTab] = useState<SchoolTab>(route.params?.tab ?? 'exams');
  // Read once per visit, so the markers do not vanish while you are looking at them.
  const seenAt = useRef<string | null>(storage.getString(GRADES_SEEN_KEY) ?? null);
  const content = useRef<ScrollView>(null);

  // Each sub-tab opens at its top, not where the last one was scrolled to (R-18).
  useEffect(() => {
    content.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);

  // A push or a link may name a sub-tab ("מבחן חדש" → מבחנים). Take it on
  // every focus and on every new link while focused, then drop it, so coming
  // back by the tab bar keeps the sub-tab you were on.
  useFocusEffect(
    useCallback(() => {
      const wanted = route.params?.tab;
      if (!wanted) return;
      setTab(wanted);
      navigation.setParams({ tab: undefined });
    }, [route.params, navigation]),
  );

  // Whose the exam board is, once at the top of the exams tab, where the class's push about a new board lands (A-I6):
  // the class as the phone last read it, read again whenever /settings is (every refresh of the feed ends in one).
  const ownBoard = useOwnBoard();
  const boardLine = useMemo(
    () => examsTabSourceLine(storedFeed(storage)?.class ?? null, ownBoard),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the read time is the signal: the feed is not state.
    [ownBoard, settings.dataUpdatedAt],
  );

  // Leaving the grades tab (or the screen) is what counts as having seen them.
  useEffect(() => {
    if (tab !== 'grades') return undefined;
    return () => storage.set(GRADES_SEEN_KEY, new Date().toISOString());
  }, [tab]);

  const header = <TabHeader title="בית ספר" />;

  // Wait for Mashov's state too: an empty list must not say "אין …" for a
  // beat before it learns that Mashov is not connected (F8).
  if (school.isLoading || (status.isLoading && !status.data)) return <Screen>{header}<Loading /></Screen>;
  if (school.isError || !school.data) {
    return (
      <Screen>
        {header}
        <ErrorState message={(school.error as Error | undefined)?.message ?? 'שגיאה'} onRetry={() => void school.refetch()} />
      </Screen>
    );
  }

  const data = school.data;
  const newGrades = data.grades.filter((g) => isNew(g, seenAt.current)).length;
  const link = mashovLink(status.data?.sources);
  const connect = (): void => root.navigate('MashovLogin');
  // Underlined tabs (plan §16.1). `UnderlineTabs` scrolls the row when it does not fit (a larger
  // text size, the badge) and keeps the chosen tab in view (W5-8), as this screen's own row did.
  // Middle school sits no bagrut: no tab for it, and a link to it opens the exams.
  const bagrut = hasBagrut(settings.data?.settings.className);
  // A parent sees only what the class's site publishes (docs/parents-plan.md), and Mashov's tabs
  // too once the parent's Mashov was read (stage 3).
  const parent = settings.data?.settings.audience === 'parent';
  const allowed = schoolTabsFor({ bagrut, audience: parent ? 'parent' : 'student', mashov: mashovWasRead(status.data?.sources) });
  const shown: SchoolTab = allowed.some((t) => t.key === tab) ? tab : 'exams';
  const tabs: UnderlineTab<SchoolTab>[] = allowed.map((t) => {
    const badge = t.key === 'grades' ? newGrades : 0;
    return {
      key: t.key,
      label: t.label,
      badge,
      accessibilityLabel: badge > 0 ? `${t.label}, ${plural(badge, 'ציון חדש אחד', 'ציונים חדשים')}` : undefined,
    };
  });

  // "איפה המורה?" reads the school's Shahaf site: only where there is one (and in the demo, from its class).
  const teacherSearch = isDemo() || Boolean(settings.data?.schoolSiteUrl);

  return (
    <Screen>
      {header}
      {teacherSearch ? (
        <Row
          title={TEACHER_SEARCH_COPY.entry}
          subtitle={TEACHER_SEARCH_COPY.entryHint}
          chevron
          accessibilityRole="button"
          accessibilityLabel={`${TEACHER_SEARCH_COPY.entry} ${TEACHER_SEARCH_COPY.entryHint}`}
          onPress={() => root.navigate('TeacherSearch')}
        />
      ) : null}
      <UnderlineTabs tabs={tabs} selected={shown} onSelect={setTab} />

      <ScrollView
        ref={content}
        // The bagrut table and the weights sheets have fields one under the other: a tap on the
        // next field moves there at once, rather than first only closing the keyboard.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={sync.isPending} onRefresh={() => sync.mutate()} tintColor={p.accent} />}
      >
        {shown === 'exams' ? (
          <ExamList
            boardLine={boardLine}
            items={data.exams}
            options={settings.data?.exams ?? null}
            lessons={{ subjects: settings.data?.subjects ?? [], hidden: settings.data?.settings.lessons.hiddenSubjects ?? [] }}
            hiddenKeys={settings.data?.settings.exams.hiddenKeys ?? null}
            toCalendar={settings.data?.settings.examsToCalendar ?? false}
            onPick={() => root.navigate('MyExams')}
            onLessons={() => root.navigate('MyLessons')}
            parent={parent}
          />
        ) : null}
        {shown === 'homework' ? (
          <HomeworkList items={data.homework ?? []} link={link} onConnect={connect} />
        ) : null}
        {shown === 'grades' ? (
          <GradeList items={data.grades} seenAt={seenAt.current} link={link} onConnect={connect} />
        ) : null}
        {shown === 'messages' ? <MessageList items={data.messages} link={link} onConnect={connect} parent={parent} /> : null}
        {shown === 'bagrut' ? <View style={styles.page}><BagrutTab link={link} onConnect={connect} /></View> : null}
        {shown === 'attendance' ? <AttendanceTab link={link} onConnect={connect} /> : null}
      </ScrollView>
    </Screen>
  );
}

function isNew(grade: Grade, seenAt: string | null): boolean {
  if (!grade.firstSeen) return false;
  if (!seenAt) return false;
  return grade.firstSeen > seenAt;
}

// ---------------------------------------------------------------------------
// Shared bits

/** Over data Mashov can no longer refresh: how old it is, and the way back. A ruled line, not a box. */
function MashovBanner({ feed, link, onConnect }: { feed: MashovFeed; link: MashovLink; onConnect: () => void }): React.JSX.Element {
  const p = usePalette();
  const b = staleBanner(feed, link);
  const action = connectLabel(link);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${b.lead}${b.date ?? ''}${b.tail}. ${action}`}
      onPress={onConnect}
      style={({ pressed }) => [styles.banner, { borderBottomColor: p.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <Text style={[styles.line, { flex: 1, color: p.text }]}>
        {b.lead}
        {b.date ? <Ltr style={[styles.line, { fontFamily: font.bodySemi, color: p.text }]}>{b.date}</Ltr> : null}
        {b.tail}
      </Text>
      <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.accent }]}>{action}</Text>
      <AppIcon name="chevronLeft" color={p.accent} size={16} />
    </Pressable>
  );
}

/** What a Mashov-fed list shows when it has nothing: why, and — when Mashov is the reason — the way to connect. */
function FeedEmpty({
  feed, link, icon, emptyText, onConnect,
}: { feed: MashovFeed; link: MashovLink; icon: IconName; emptyText: string; onConnect: () => void }): React.JSX.Element {
  if (!link.connected) {
    return (
      <View style={styles.page}>
        <EmptyState icon={icon} text={disconnectedText(feed, link)} action={{ label: connectLabel(link), onPress: onConnect }} />
      </View>
    );
  }
  return <View style={styles.page}><EmptyState icon={icon} text={emptyText} /></View>;
}

/** A folded section ("עשיתי (4)"): a ruled row that opens and closes. */
function Fold({ title, count, open, onToggle }: { title: string; count: number; open: boolean; onToggle: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}, ${count}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.fold, { borderBottomColor: p.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={{ flex: 1, fontFamily: font.bodySemi, fontSize: type.body, color: p.textMuted }}>
        {`${title} (${count})`}
      </Text>
      <View style={open ? styles.flip : null}>
        <AppIcon name="chevronDown" color={p.textMuted} size={18} />
      </View>
    </Pressable>
  );
}

/** A date in a list's margin (plan §16.1), its weekday under it; `color` writes it in the red pen. */
function DateMargin({ date, color }: { date: string; color?: string }): React.JSX.Element {
  const p = usePalette();
  const ink = color ?? p.textMuted;
  return (
    <View style={styles.dateMargin}>
      <Ltr style={[styles.marginDate, { color: ink }]}>{formatShortDate(date)}</Ltr>
      <Text style={[styles.marginDay, { color: ink }]}>{marginWeekday(date)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Exams

function ExamList({
  boardLine, items, options, lessons, hiddenKeys, toCalendar, onPick, onLessons, parent,
}: {
  /** Whose the exam board is (`examsTabSourceLine`), for the line at the top; `null` when there is none. */
  boardLine: string | null;
  /** The owner's exams — the server already left out the hidden ones. */
  items: Exam[];
  /** The whole grade's upcoming exams, for the counts; `null` while loading. */
  options: ExamOption[] | null;
  lessons: OwnLessons;
  hiddenKeys: string[] | null;
  toCalendar: boolean;
  onPick: () => void;
  /** Opens "השיעורים שלי", also in Settings → מה מוצג (settings spec §4.3). */
  onLessons: () => void;
  /** A parent's phone names the lessons as the child's (`LESSONS_COPY`). */
  parent: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const upcoming = items.filter((e) => daysUntil(e.date) >= 0);
  // "שלי" answers (W6-2): the count and the rows drop the "?" the moment one is given.
  const { confirmed } = useConfirmedExams();
  const resolved = options ? withConfirmed(options, confirmed) : null;
  const counts = resolved ? examCounts(resolved, new Set(hiddenKeys ?? []), confirmed) : null;
  // The picker's entry for an exam: its subject and match, and for a block exam which subjects sit it.
  const optionOf = new Map((resolved ?? []).map((o) => [o.naturalKey, o]));
  // The exam whose details are open (W4-5).
  const [opened, setOpened] = useState<Exam | null>(null);

  // The grade's schedule is everyone's; this row is the way to say which exams are mine. Its
  // line is only the count (plan §16.2: no sentence about what the list is), the same number
  // as in "המבחנים שלי" and onboarding (W4-4).
  const countLine = counts ? examsMineLabel(counts.chosen, counts.unsure) : null;
  const offLine = counts && counts.recommendedOff.length > 0
    ? plural(counts.recommendedOff.length, 'מבחן מומלץ אחד מוסתר', 'מבחנים מומלצים מוסתרים')
    : null;
  // The two rows that set up this list travel together, so no branch below can show one without the other.
  const picker = (
    <>
      <Row
        title="המבחנים שלי"
        subtitle={countLine}
        chevron
        onPress={onPick}
        accessibilityLabel={['המבחנים שלי', countLine, offLine].filter(Boolean).join('. ')}
      >
        {offLine ? <Text style={[styles.line, { color: p.ok }]}>{offLine}</Text> : null}
      </Row>
      <Row title={LESSONS_COPY[parent ? 'parent' : 'student'].title} chevron onPress={onLessons} />
    </>
  );

  // Once, at the top: where the exam board came from, in the muted line "המבחנים שלי" says it in.
  const whose = boardLine ? (
    <View style={[styles.page, styles.boardLine]}>
      <Text style={[styles.line, { color: p.textMuted, lineHeight: 21 }]}>{boardLine}</Text>
    </View>
  ) : null;

  if (upcoming.length === 0) {
    const why = examEmptyState(options ? options.length : null);
    return (
      <View>
        {whose}
        {picker}
        <View style={styles.page}>
          {why === 'none_chosen' ? (
            <EmptyState icon="exam" text="לא בחרת עדיין מבחנים" action={{ label: 'לבחירת המבחנים', onPress: onPick }} />
          ) : (
            <EmptyState icon="exam" text="בלוח של השכבה עוד לא פורסמו מבחנים קרובים" />
          )}
        </View>
      </View>
    );
  }

  const [next, ...rest] = upcoming as [Exam, ...Exam[]];
  return (
    <View>
      {whose}
      <View style={styles.page}>
        <NextExamCard exam={next} option={optionOf.get(next.naturalKey) ?? null} lessons={lessons} onOpen={() => setOpened(next)} />
      </View>
      <View style={styles.afterCard}>{picker}</View>
      {rest.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.page}><SectionHeading>אחר כך</SectionHeading></View>
          <MarginList>
            {rest.map((exam) => (
              <ExamRow key={exam.naturalKey} exam={exam} option={optionOf.get(exam.naturalKey) ?? null} lessons={lessons} onOpen={() => setOpened(exam)} />
            ))}
          </MarginList>
        </View>
      ) : null}
      {/* The exams ahead, to the class's group (ideas ה1). */}
      <View style={[styles.page, styles.footNote]}>
        <ShareToGroup text={(ctx) => examsShareText(examsToShare(items, todayStr()), todayStr(), ctx)} />
      </View>
      {toCalendar ? (
        <View style={[styles.page, styles.footNote]}>
          <Text style={[styles.line, { color: p.textMuted, textAlign: 'center' }]}>המבחנים שלך מופיעים גם ביומן ״בית ספר״ ב־Google</Text>
        </View>
      ) : null}
      <ExamSheet exam={opened} onClose={() => setOpened(null)} />
    </View>
  );
}

/**
 * Which subjects a block exam is: on a card, only the owner's own when the
 * server matched it ("המקצוע שלך: פיזיקה"), else the list — once, with the
 * site's details (which list them again) left for the sheet.
 */
function blockLine(option: ExamOption | null): string | null {
  const parts = option ? blockSubjectsParts(option) : null;
  if (!parts) return null;
  return parts.own ? `המקצוע שלך: ${parts.own}` : `מקצועות: ${parts.others ?? ''}`;
}

/**
 * What an exam says under its name: the site's details — unless they only
 * list a block's subjects again, or are Mashov's name for a bagrut exam the
 * row already names (`examNaming`): that one stays in the sheet.
 */
function cardDetails(exam: Exam, option: ExamOption | null): { time: string | null; text: string | null } {
  const { time, text } = splitExamDetails(exam.details);
  // A bagrut exam the student gave a name of its own is not titled by the table (`examNaming`): its details then say
  // which questionnaire it is. A name given to its subject (`subjectName`) is no name of the exam's own.
  const ownName = exam.originalSubject !== undefined && exam.subjectName === undefined;
  const repeated = (option && blockSubjectsParts(option))
    || (exam.kind === 'bagrut' && !ownName && bagrutExamTitle(exam, CATALOG));
  return { time, text: repeated ? null : text };
}

/** The exam as the pure helpers read it: the picker's subject and match, and the exam's own kind and hours. */
function examLike(exam: Exam, option: ExamOption | null): ExamLike {
  return {
    naturalKey: exam.naturalKey, date: exam.date, subject: exam.subject, originalSubject: exam.originalSubject,
    subjectKey: option?.subjectKey, match: option?.match, kind: exam.kind, startTime: exam.startTime, endTime: exam.endTime,
  };
}

/** The owner's lessons, for the teacher beside a "?" (plan §14.7): the timetable's lines and the hide-list. */
interface OwnLessons {
  subjects: readonly SubjectOption[];
  hidden: readonly string[];
}

/** How far the next exam is, as a hero number (plan §16.1): the display face, its unit small under it. */
function DaysLeftHero({ days }: { days: number }): React.JSX.Element {
  const p = usePalette();
  const { value, unit } = daysLeft(days);
  return (
    <View style={styles.hero}>
      {unit ? (
        <Ltr style={[styles.heroValue, { color: p.text }]}>{value}</Ltr>
      ) : (
        <Text style={[styles.heroValue, { color: p.text }]}>{value}</Text>
      )}
      {unit ? <Text style={[styles.line, { color: p.textMuted }]}>{unit}</Text> : null}
    </View>
  );
}

/**
 * "המבחן הבא": the one to prepare for, the screen's one raised surface (plan
 * §16.1), its name under the exam highlighter and the days to it in the
 * display face. A tap opens its details, material and study plan (W4-5);
 * the foot says whether its study tasks are already in.
 */
function NextExamCard({
  exam, option, lessons, onOpen,
}: { exam: Exam; option: ExamOption | null; lessons: OwnLessons; onOpen: () => void }): React.JSX.Element {
  const p = usePalette();
  const tasks = useAddSchoolTask();
  const days = daysUntil(exam.date);
  const details = cardDetails(exam, option);
  const text = details.text;
  const like = examLike(exam, option);
  // A bagrut exam says so, with its own hours (plan §14.9); it has no periods and is never unsure.
  // Named for what it is when the table knows it, its hours on the date's line (run 7, Noa).
  const bagrut = exam.kind === 'bagrut';
  const { title, kind, hours } = examNaming(exam, CATALOG);
  // The periods and the time, once the school puts the exam into its day (W6-3, Noa).
  // Not for an exam the student moved: the school's day and the time in its details are for the school's date, not theirs
  // (`asksSchoolDay`, `examShownTime`).
  const asksDay = asksSchoolDay(exam);
  const day = useDay(exam.date, asksDay);
  const slot = bagrut || !asksDay ? null : examSlot(like, day.data);
  const time = examShownTime(exam, { bagrut: hours, slot: slot?.time ?? null, details: details.time });
  const block = blockLine(option);
  const unsure = bagrut || !option ? null : unsureNote(option, lessons.subjects, lessons.hidden);
  // A plan made before the exam was moved has the school's date in its title (as the sheet looks for it).
  const singles = studyTitlesFor(like, exam.originalDate, todayStr());
  const planned = tasks.hasOpenWhere((t) => isPlannedStudyTitle(t, singles));
  const foot = planned ? p.ok : p.accent;
  // "הוזז אצלך" after the date, for an exam the person moved on this phone (V-6).
  const moved = movedMark(exam);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        `המבחן הבא: ${title}`, block, countdownLabel(days), moved, kind ? examKindText(kind) : null,
        slot ? examSlotText({ ...slot, time }) : time ? `בשעה ${time}` : null,
        unsure ? `לא בטוח שזה שלך: ${unsure}` : null, planned ? 'משימות הלימוד כבר במשימות שלך' : null,
      ].filter(Boolean).join(', ')}
      accessibilityHint="פותח את פרטי המבחן, החומר ותוכנית לימוד"
      onPress={onOpen}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={styles.nextCard}>
        <View style={styles.nextTop}>
          <View style={styles.nextWhat}>
            <Text style={[styles.line, { color: p.textMuted }]}>המבחן הבא</Text>
            <Mark kind="exam" style={styles.nextTitle} containerStyle={styles.nextMark}>{isolateRanges(title)}</Mark>
            {block ? <Text style={[styles.line, { color: p.text }]}>{block}</Text> : null}
            {kind ? <ExamKindLine kind={kind} color={p.text} /> : null}
            <ExamWhen date={exam.date} time={time} color={p.textMuted} slot={slot} note={moved} />
          </View>
          <DaysLeftHero days={days} />
        </View>
        {unsure ? <UnsureMark reason={unsure} /> : null}
        {text ? <Text style={[styles.paragraph, { color: p.textMuted }]}>{isolateRanges(text)}</Text> : null}
        {/* Drawn as a text button; the whole card is the one button, so a screen reader reaches it. */}
        <View style={styles.nextFoot}>
          <AppIcon name={planned ? 'check' : 'tasks'} color={foot} size={18} />
          <Text style={[styles.footText, { color: foot }]}>{planned ? 'משימות הלימוד כבר במשימות שלך' : 'פרטים, חומר ותוכנית לימוד'}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

/** An exam after the next one: a ruled row, its date in the margin and the days to it at the end; a tap opens the same details (W4-5). */
function ExamRow({
  exam, option, lessons, onOpen,
}: { exam: Exam; option: ExamOption | null; lessons: OwnLessons; onOpen: () => void }): React.JSX.Element {
  const p = usePalette();
  const days = daysUntil(exam.date);
  const details = cardDetails(exam, option);
  const bagrut = exam.kind === 'bagrut';
  const { title, kind, hours } = examNaming(exam, CATALOG);
  // No time for an exam the student moved: the details' is the school's, for the school's date (`examShownTime`).
  const time = examShownTime(exam, { bagrut: hours, slot: null, details: details.time });
  const text = details.text;
  const block = blockLine(option);
  const unsure = bagrut || !option ? null : unsureNote(option, lessons.subjects, lessons.hidden);
  // The margin holds only the date and its day: "הוזז אצלך" is a line under the title (V-6).
  const moved = movedMark(exam);
  return (
    <MarginRow
      margin={<DateMargin date={exam.date} />}
      title={isolateRanges(title)}
      subtitle={block}
      end={(
        <Text style={[styles.endWord, { color: days <= 2 ? p.text : p.textMuted }]}>{daysLeftLabel(days)}</Text>
      )}
      onPress={onOpen}
      accessibilityLabel={[
        title, block, countdownLabel(days), moved, kind ? examKindText(kind) : time ? `בשעה ${time}` : null, unsure ? `לא בטוח שזה שלך: ${unsure}` : null,
      ].filter(Boolean).join(', ')}
      accessibilityHint="פותח את פרטי המבחן ותוכנית לימוד"
    >
      {moved ? <Text style={[styles.line, { color: p.textMuted }]}>{moved}</Text> : null}
      {kind ? (
        <ExamKindLine kind={kind} color={p.textMuted} />
      ) : time ? (
        <Ltr style={[styles.line, { color: p.textMuted }]}>{time}</Ltr>
      ) : null}
      {unsure ? <View style={styles.rowExtra}><UnsureMark reason={unsure} /></View> : null}
      {text ? <Text numberOfLines={3} style={[styles.paragraph, { color: p.textMuted }]}>{isolateRanges(text)}</Text> : null}
    </MarginRow>
  );
}

// ---------------------------------------------------------------------------
// Homework

function HomeworkList({
  items, link, onConnect,
}: { items: HomeworkItem[]; link: MashovLink; onConnect: () => void }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const tasks = useAddSchoolTask();
  const setDone = useSetHomeworkDone();
  const [showDone, setShowDone] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  // The homework whose sheet is open, by key: the sheet reads the live item (its tick, its copy).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const today = todayStr();
  const sections = useMemo(() => homeworkSections(items, today), [items, today]);
  const state = feedState(items.length, link);

  if (state === 'disconnected' || state === 'empty') {
    return <FeedEmpty feed="homework" link={link} icon="homework" emptyText="אין כרגע שיעורי בית ממשוב" onConnect={onConnect} />;
  }

  // A ticked row folds away under "עשיתי", so the tick says what it did and
  // can be taken back from the toast (R-17). Only the box ticks; the row does not.
  const toggleDone = (hw: HomeworkItem): void => {
    const was = hw.done;
    const first = setDone.mutateAsync({ key: hw.naturalKey, done: !was });
    first.catch(() => toast.show('לא הצלחנו לשמור את הסימון. אפשר לנסות שוב'));
    toast.show(was ? 'הוחזר לשיעורי הבית הפתוחים' : 'סומן אצלך. המורה לא רואה את זה.', {
      onAction: () => {
        first.then(
          () => setDone.mutate(
            { key: hw.naturalKey, done: was },
            { onError: () => toast.show('לא הצלחנו להחזיר. אפשר לנסות שוב') },
          ),
          () => undefined,
        );
      },
    });
  };

  // The homework's own sheet is the one place a copy to Google Tasks is offered
  // (W6-4): it is in "משימות" already. The linked task still marks the week
  // and the evening reminder, as before.
  const copyToTasks = (hw: HomeworkItem): void => {
    setOpenKey(null);
    const { title, notes } = homeworkTaskTitle(hw);
    tasks.add({ title, notes, due: hw.dueDate, fromHomeworkKey: hw.naturalKey }, copiedToTasksLabel(hw.dueDate));
  };
  const opened = openKey ? items.find((hw) => hw.naturalKey === openKey) ?? null : null;

  const row = (hw: HomeworkItem): React.JSX.Element => (
    <HomeworkRow key={hw.naturalKey} hw={hw} today={today} onToggleDone={() => toggleDone(hw)} onOpen={() => setOpenKey(hw.naturalKey)} />
  );

  return (
    <View>
      <HomeworkSheet
        hw={opened}
        today={today}
        copying={opened !== null && tasks.pending?.fromHomeworkKey === opened.naturalKey}
        onClose={() => setOpenKey(null)}
        onCopy={copyToTasks}
      />
      {state === 'stale' ? <MashovBanner feed="homework" link={link} onConnect={onConnect} /> : null}

      <View style={styles.page}><SectionHeading>להגשה</SectionHeading></View>
      {sections.open.length === 0 ? (
        <View style={styles.page}>
          <Text style={{ fontFamily: font.body, fontSize: type.body, color: p.textMuted }}>הכול מסומן כעשוי</Text>
        </View>
      ) : (
        <MarginList>{sections.open.map(row)}</MarginList>
      )}

      {sections.done.length > 0 ? (
        <>
          <Fold title="עשיתי" count={sections.done.length} open={showDone} onToggle={() => setShowDone((v) => !v)} />
          {showDone ? <MarginList>{sections.done.map(row)}</MarginList> : null}
        </>
      ) : null}

      {sections.older.length > 0 ? (
        <>
          <Fold title="מלפני יותר משבועיים" count={sections.older.length} open={showOlder} onToggle={() => setShowOlder((v) => !v)} />
          {showOlder ? <MarginList>{sections.older.map(row)}</MarginList> : null}
        </>
      ) : null}
    </View>
  );
}

/** "להגשה עד יום ו׳ 9.10", or "בלי תאריך הגשה" — the date in `Ltr`. */
function DueLine({ hw, color }: { hw: HomeworkItem; color: string }): React.JSX.Element {
  const due = hw.dueDate ? dueParts(hw.dueDate) : null;
  return (
    <Text style={{ fontFamily: font.bodyMedium, fontSize: type.small, color }}>
      {due ? (
        <>
          {`${due.prefix} `}
          <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color }}>{due.date}</Ltr>
        </>
      ) : 'בלי תאריך הגשה'}
    </Text>
  );
}

/**
 * One homework item, a ruled row (plan §16.1): its due date in the margin,
 * in the red pen once it is late; "עשיתי" as the checkbox right after it, at
 * the row's start; the subject and the assignment. A tap on the rest opens its
 * sheet — the whole text, and the copy to Google Tasks (W6-4). No task
 * action on the row: the homework is in "משימות" already.
 */
function HomeworkRow({
  hw, today, onToggleDone, onOpen,
}: {
  hw: HomeworkItem;
  today: string;
  onToggleDone: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const subject = shownSubject(hw);
  const overdue = isOverdue(hw, today);
  const days = hw.dueDate ? daysUntil(hw.dueDate) : null;
  const due = hw.dueDate ? dueParts(hw.dueDate) : null;
  const text = cleanText(hw.text);
  // Long overdue homework sits folded under "מלפני יותר משבועיים"; it keeps its date but not the alarm.
  const loud = overdue && days !== null && days >= -HOMEWORK_RECENT_DAYS;
  const badge = hw.done ? null : loud ? 'באיחור' : days === 0 ? 'היום' : days === 1 ? 'מחר' : null;

  return (
    // The row itself is no button: the text and the box are two siblings, since a button
    // inside a button is lost to a screen reader.
    <MarginRow
      margin={hw.dueDate ? <DateMargin date={hw.dueDate} color={loud ? p.cancel : undefined} /> : null}
      lead={<Checkbox value={hw.done} onValueChange={() => onToggleDone()} accessibilityLabel={`עשיתי: ${subject}`} />}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          subject, badge, due ? `${due.prefix} ${due.date}` : 'בלי תאריך הגשה', text || null, hw.done ? 'סומן כבוצע' : null,
        ].filter(Boolean).join(', ')}
        accessibilityHint="פותח את שיעורי הבית"
        onPress={onOpen}
        style={({ pressed }) => [styles.rowButton, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.titleLine}>
          <Text style={[styles.rowTitle, { flexShrink: 1, color: hw.done ? p.textMuted : p.text }]}>{subject}</Text>
          {/* Late is the red pen (plan §16.1); today and tomorrow are words, not tags. */}
          {badge ? <Text style={[styles.badgeWord, { color: badge === 'באיחור' ? p.cancel : p.text }]}>{badge}</Text> : null}
        </View>
        {text ? (
          <Text
            numberOfLines={3}
            style={[styles.paragraph, { color: p.textMuted, textDecorationLine: hw.done ? 'line-through' : 'none' }]}
          >
            {isolateRanges(text)}
          </Text>
        ) : null}
        {hw.dueDate ? null : <Text style={[styles.line, { color: p.textMuted }]}>בלי תאריך הגשה</Text>}
        {/* Words, not a button: the copy is made in the sheet. */}
        {hw.linkedTaskId ? <Text style={[styles.line, { color: p.textMuted }]}>גם ב־Google Tasks</Text> : null}
      </Pressable>
    </MarginRow>
  );
}

/**
 * A homework item's sheet (W6-4): when it is due, the whole assignment, and
 * "להעתיק ל־Google Tasks" — the one place it is offered, since the homework is
 * in "משימות" already. The last item stays drawn while the sheet slides away.
 */
function HomeworkSheet({
  hw, today, copying, onClose, onCopy,
}: {
  hw: HomeworkItem | null;
  today: string;
  copying: boolean;
  onClose: () => void;
  onCopy: (hw: HomeworkItem) => void;
}): React.JSX.Element {
  const p = usePalette();
  const last = useRef<HomeworkItem | null>(hw);
  if (hw) last.current = hw;
  const shown = hw ?? last.current;
  const text = shown ? cleanText(shown.text) : '';
  const loud = shown ? isOverdue(shown, today) && daysUntil(shown.dueDate ?? today) >= -HOMEWORK_RECENT_DAYS : false;
  // The demo has no Google Tasks to copy to (`demo/mode.ts`), nor has a phone with no Google connected.
  const demo = isDemo();
  const google = useGoogleConnected();
  const canCopy = canCopyToGoogle({ linkedTaskId: null }, demo, google);
  return (
    <Sheet
      visible={hw !== null}
      onClose={onClose}
      title={shown ? `שיעורי בית ב${shownSubject(shown)}` : ''}
      footer={shown && canCopyToGoogle(shown, demo, google) ? (
        <Button title={COPY_TO_GOOGLE_TASKS} variant="ghost" disabled={copying} onPress={() => onCopy(shown)} />
      ) : undefined}
    >
      {shown ? (
        <View style={{ gap: space.md }}>
          <DueLine hw={shown} color={loud ? p.cancel : p.text} />
          <Text selectable style={{ fontFamily: font.body, fontSize: type.body, lineHeight: 23, color: p.text }}>
            {text ? isolateRanges(text) : 'אין פירוט במשוב'}
          </Text>
          {shown.linkedTaskId ? (
            <View style={styles.doneLine}>
              <AppIcon name="check" color={p.ok} size={18} />
              <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.ok }]}>{HOMEWORK_COPIED}</Text>
            </View>
          ) : (
            <Text style={[styles.paragraph, { color: p.textMuted }]}>{canCopy ? HOMEWORK_IN_TASKS : DEMO_COPY.homeworkInTasks}</Text>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Grades

/**
 * A grade at a row's end, neutral (R-19): a high one is written in green
 * with its word, "מצוין", under it. No box around it.
 */
function GradeValue({ value, text, size }: { value: number | null; text: string; size: number }): React.JSX.Element {
  const p = usePalette();
  const high = gradeHighlight(value);
  return (
    <View style={styles.gradeValue}>
      <Ltr style={{ fontFamily: font.headingSemi, fontSize: size, color: high ? p.ok : p.text }}>{text}</Ltr>
      {high ? <Text style={{ fontFamily: font.bodySemi, fontSize: type.caption, color: p.ok }}>{high}</Text> : null}
    </View>
  );
}

/** The owner's weights for regular grades (plan §15), read once and kept on the phone on every change. */
function useGradeWeights(): [GradeWeightsPrefs, WeightsUpdate] {
  const [prefs, setPrefs] = useState<GradeWeightsPrefs>(readGradeWeights);
  const update = useCallback<WeightsUpdate>((change) => {
    setPrefs((prev) => {
      const next = change(prev);
      if (next !== prev) writeGradeWeights(next);
      return next;
    });
  }, []);
  return [prefs, update];
}

/**
 * Grades by subject, a ruled row each. Each subject's average counts by type
 * (plan §15, W8): מבחן, בוחן, עבודה, אחר — guessed from the assessment's
 * name — at the subject's percents, set from its "משקלים"; a grade's own
 * type and weight from a tap on its row. How that works is said once, behind
 * the question at the top of the tab (plan §16.2); an open subject says its
 * parts. A subject with one grade says that grade's date in its muted line.
 */
function GradeList({
  items, seenAt, link, onConnect,
}: {
  items: Grade[];
  seenAt: string | null;
  link: MashovLink;
  onConnect: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const [weights, updateWeights] = useGradeWeights();
  const groups = useMemo(() => groupGradesBySubject(items, weights), [items, weights]);
  const fresh = useMemo(() => items.filter((g) => isNew(g, seenAt)).length, [items, seenAt]);
  // A subject with a new grade opens by itself; any other waits for a tap.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // The one help at the top, "איך מחשבים את הממוצע?": how a weighted average is made.
  const [explained, setExplained] = useState(false);
  const [weightsFor, setWeightsFor] = useState<string | null>(null);
  const [gradeKey, setGradeKey] = useState<string | null>(null);
  const state = feedState(items.length, link);

  if (state === 'disconnected' || state === 'empty') {
    return <FeedEmpty feed="grades" link={link} icon="grade" emptyText="עוד לא התקבלו ציונים ממשוב" onConnect={onConnect} />;
  }

  // A subject is kept by Mashov's name (`originalSubject`): its weights and whether it is open stay when the student names it.
  const weightsGroup = weightsFor ? groups.find((g) => (g.originalSubject ?? g.subject) === weightsFor) ?? null : null;
  const openGrade = gradeKey ? items.find((g) => g.naturalKey === gradeKey) ?? null : null;
  const weighted = groups.some((g) => averageNote(g.average) !== null);

  return (
    <View>
      {state === 'stale' ? <MashovBanner feed="grades" link={link} onConnect={onConnect} /> : null}
      {fresh > 0 || weighted ? (
        <View style={[styles.page, styles.gradesTop]}>
          {fresh > 0 ? (
            <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.accent }]}>
              {`${plural(fresh, 'ציון חדש אחד', 'ציונים חדשים')} מאז הביקור האחרון`}
            </Text>
          ) : null}
          {/* Help, said as a question in a text button (the re-rate: a lone "ממוצע משוקלל ?" read as a heading missing its number). */}
          {weighted ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: explained }}
              accessibilityLabel={AVERAGE_HELP}
              hitSlop={{ top: 8, bottom: 8 }}
              onPress={() => setExplained((v) => !v)}
              style={({ pressed }) => [styles.helpButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.accent }]}>{AVERAGE_HELP}</Text>
              <View style={explained ? styles.flip : null}>
                <AppIcon name="chevronDown" color={p.accent} size={16} />
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {weighted && explained ? (
        <View style={[styles.page, styles.explainer]}>
          <Text accessibilityLiveRegion="polite" style={[styles.paragraph, { color: p.text }]}>{WEIGHTED_AVERAGE_EXPLAINER}</Text>
        </View>
      ) : null}
      {groups.map((group) => {
        const key = group.originalSubject ?? group.subject;
        const hasFresh = group.grades.some((g) => isNew(g, seenAt));
        const open = toggled[key] ?? hasFresh;
        const avg = group.average;
        const avgLabel = avg ? averageLabel(group.grades.length) : null;
        const high = avg ? gradeHighlight(avg.value) : null;
        // What the row says under the subject (plan §16.2): the latest assessment, then the count.
        const latest = group.grades[0];
        const latestName = latest ? assessmentName(latest) : null;
        const single = group.grades.length === 1;
        const count = plural(group.grades.length, 'ציון אחד', 'ציונים');
        const lead = !latest ? null : single ? (latestName ?? count) : latestName ? `אחרון: ${latestName}` : null;
        const tally = latest && !single ? count : null;
        const note = averageNote(avg);
        const shares = note && avg ? averageSharesText(avg) : null;
        const canWeigh = open && group.grades.length > 0;
        const types = subjectTypes(weights, key);
        // One grade: its date is part of the muted line, after what it was for ("עבודה: רשתות
        // מקומיות, 22.9"), never a bare date on a line of its own under the value (the re-rate).
        const subtitle = single && latest ? (
          <Text style={[styles.line, { flexShrink: 1, color: p.textMuted }]}>
            {lead ? `${isolateRanges(lead)}, ` : null}
            <Ltr style={[styles.line, { color: p.textMuted }]}>{formatShortDate(latest.date)}</Ltr>
          </Text>
        ) : lead ? isolateRanges(lead) : null;
        return (
          <View key={key}>
            <Row
              title={(
                <>
                  {group.subject}
                  {hasFresh ? <>{' '}<Mark kind="mark" inline style={styles.inlineMark}>חדש</Mark></> : null}
                </>
              )}
              subtitle={subtitle}
              end={(
                <View style={styles.gradeEnd}>
                  {avg ? <GradeValue value={avg.value} text={formatAverage(avg.value)} size={type.heading} /> : null}
                  <View style={open ? styles.flip : null}>
                    <AppIcon name="chevronDown" color={p.textMuted} size={18} />
                  </View>
                </View>
              )}
              onPress={() => setToggled((t) => ({ ...t, [key]: !open }))}
              accessibilityState={{ expanded: open }}
              accessibilityLabel={[
                group.subject, lead, single && latest ? formatShortDate(latest.date) : null, tally,
                avg && avgLabel ? `${avgLabel} ${formatAverage(avg.value)}` : null, note, high,
              ].filter(Boolean).join(', ')}
            >
              {tally ? <Text style={[styles.line, { color: p.textMuted }]}>{tally}</Text> : null}
            </Row>
            {/* An open subject: its parts, "משקלים", and its grades under it. */}
            {canWeigh || (open && shares) ? (
              <View style={[styles.weightsRow, { borderBottomColor: p.border }]}>
                <Text style={[styles.line, { flex: 1, color: p.textMuted }]}>{shares ?? ''}</Text>
                {canWeigh ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`משקלים, ${group.subject}`}
                    hitSlop={{ top: 8, bottom: 8 }}
                    onPress={() => setWeightsFor(key)}
                    style={({ pressed }) => [styles.helpButton, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.accent }]}>משקלים</Text>
                    <AppIcon name="chevronLeft" color={p.accent} size={16} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {open ? group.grades.map((grade) => {
              const resolved = resolveGrade(grade, types, weights.grades[grade.naturalKey]);
              return (
                <GradeRow
                  key={grade.naturalKey}
                  grade={grade}
                  fresh={isNew(grade, seenAt)}
                  resolved={resolved}
                  typeWord={typeLabel(types, resolved.type)}
                  onPress={() => setGradeKey(grade.naturalKey)}
                />
              );
            }) : null}
          </View>
        );
      })}
      <SubjectWeightsSheet
        subject={weightsGroup ? (weightsGroup.originalSubject ?? weightsGroup.subject) : null}
        name={weightsGroup?.subject ?? null}
        grades={weightsGroup?.grades ?? NONE}
        average={weightsGroup?.average ?? null}
        prefs={weights}
        update={updateWeights}
        onClose={() => setWeightsFor(null)}
      />
      <GradeSheet grade={openGrade} prefs={weights} update={updateWeights} onClose={() => setGradeKey(null)} />
    </View>
  );
}

/**
 * One grade, a ruled row under its subject: what it was for — the assessment
 * Mashov names ("מבחן פרק 3", W4-7) — its date and type, its own weight, and
 * the grade at the end. A grade in words ("הוגש") is quiet text, not a number
 * in the grade's place (Maya). A tap sets its type or weight (plan §15);
 * "שינית" marks a change.
 */
function GradeRow({
  grade, fresh, resolved, typeWord, onPress,
}: {
  grade: Grade;
  fresh: boolean;
  /** Its type and weight as they count. */
  resolved: ResolvedGrade;
  /** "מבחן". */
  typeWord: string;
  onPress: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const weight = weightLabel(resolved.weight);
  const name = assessmentName(grade);
  const words = grade.value === null ? cleanText(grade.valueText) || EMPTY_MARK : null;
  return (
    <Row
      title={(
        <>
          {name ? isolateRanges(name) : 'ציון'}
          {fresh ? <>{' '}<Mark kind="mark" inline style={styles.inlineMark}>חדש</Mark></> : null}
        </>
      )}
      titleStyle={styles.childTitle}
      // The date leads the line, so it sits in the same place with or without a weight.
      subtitle={(
        <Text style={[styles.line, { color: p.textMuted }]}>
          <Ltr style={[styles.line, { color: p.textMuted }]}>{formatShortDate(grade.date)}</Ltr>
          {`, ${typeWord}`}
        </Text>
      )}
      end={words !== null ? (
        <Text style={[styles.line, { fontFamily: font.bodySemi, color: words === EMPTY_MARK ? p.textFaint : p.textMuted }]}>{words}</Text>
      ) : (
        <GradeValue value={grade.value} text={String(grade.value)} size={type.title} />
      )}
      onPress={onPress}
      accessibilityLabel={[
        name ?? 'ציון', fresh ? 'חדש' : null, formatShortDate(grade.date), typeWord, weight, resolved.changed ? CHANGED_WORD : null,
        words ?? String(grade.value), gradeHighlight(grade.value),
      ].filter(Boolean).join(', ')}
      accessibilityHint="אפשר לשנות סוג ומשקל"
      style={styles.childRow}
    >
      {weight || resolved.changed ? (
        <View style={styles.titleLine}>
          {weight ? <Text style={[styles.line, { color: p.textMuted }]}>{weight}</Text> : null}
          {resolved.changed ? <Mark kind="change" style={styles.inlineMark}>{CHANGED_WORD}</Mark> : null}
        </View>
      ) : null}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Messages

/** Long enough to fold: more than four lines' worth. */
function isLong(text: string): boolean {
  return text.length > 190 || text.split('\n').length > 4;
}

const MESSAGE_SEARCH_PLACEHOLDER = rtlPlaceholder('חיפוש בהודעות…');

function MessageList({
  items, link, onConnect, parent = false,
}: { items: SchoolMessage[]; link: MashovLink; onConnect: () => void; parent?: boolean }): React.JSX.Element {
  const p = usePalette();
  const tasks = useAddSchoolTask();
  // The tap that closes the teacher sheet must not also press what is under it (Maya, run 3).
  const press = useSheetPressGuard();
  // By the day each was sent, now that Mashov says it (plan §14.1).
  const sorted = useMemo(() => messagesNewestFirst(items), [items]);
  // Every hook sits above the early returns below.
  const [search, setSearch] = useState('');
  const [sender, setSender] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // The field keeps up with the thumb; the list, the unfolding and the notes follow a render behind, so 100 messages do not hold a key up.
  const deferred = useDeferredValue(search);
  // Both read every title and body: they rerun for a new list or a new search, not for any other render.
  const senders = useMemo(() => messageSenders(sorted), [sorted]);
  const shown = useMemo(() => selectMessages(sorted, { search: deferred, sender }), [sorted, deferred, sender]);
  // Whether a message not yet read still hides a word, among those the teacher filter leaves.
  const bodiesPending = useMemo(
    () => sorted.some((m) => m.bodyPending && (sender === null || senderName(m.from) === sender)),
    [sorted, sender],
  );
  const state = feedState(items.length, link);
  // Words typed open the results, since a match may sit in the folded part; a teacher alone only narrows the list.
  const searching = deferred.trim() !== '';
  const narrowed = searching || sender !== null;
  const clear = (): void => {
    setSearch('');
    setSender(null);
  };

  // The search row, the results and what they leave out. A parent has no tasks to add a message to.
  const searchable = (adder: SchoolTaskAdder | null): React.JSX.Element => (
    <>
      <View style={[styles.page, styles.searchRow]}>
        <SearchField label={MESSAGE_SEARCH_LABEL} placeholder={MESSAGE_SEARCH_PLACEHOLDER} value={search} onChangeText={setSearch} />
        {senders.length >= 2 || sender !== null ? (
          // The teacher as a text button beside the search, as Tasks' list is. It stays while one is chosen, so the choice can be changed.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`מורה: ${sender ?? ALL_SENDERS}`}
            accessibilityHint="לבחירת מורה"
            onPress={() => setMenu(true)}
            style={({ pressed }) => [styles.senderButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text numberOfLines={1} style={[styles.senderButtonText, { color: p.accent, fontFamily: sender ? font.bodySemi : font.bodyMedium }]}>
              {sender ?? ALL_SENDERS}
            </Text>
            <AppIcon name="chevronDown" color={p.accent} size={16} />
          </Pressable>
        ) : null}
      </View>
      {narrowed && shown.length > 0 ? (
        <Text style={[styles.line, styles.searchNote, { color: p.textMuted }]}>{messageSearchCount(shown.length)}</Text>
      ) : null}
      {shown.length === 0 ? (
        <View style={styles.page}>
          <EmptyState text={MESSAGES_NO_MATCH} action={{ label: CLEAR_MESSAGE_SEARCH, onPress: clear }} />
        </View>
      ) : (
        shown.map((msg) => <MessageSection key={msg.naturalKey} msg={msg} tasks={adder} searching={searching} guard={press.guard} />)
      )}
      {/* Said wherever the words are, empty results included: that is when a missing body matters most. */}
      {searching && bodiesPending ? (
        <Text style={[styles.line, styles.searchNote, { color: p.textMuted, paddingTop: space.md }]}>{MESSAGE_BODIES_PENDING}</Text>
      ) : null}
      <SenderMenu
        visible={menu}
        senders={senders}
        selected={sender}
        onSelect={setSender}
        onClose={() => {
          setMenu(false);
          press.sheetClosed();
        }}
      />
    </>
  );

  // A parent has the site's messages and no Mashov to connect, nor tasks to add them to.
  if (parent) {
    if (sorted.length === 0) return <View style={styles.page}><EmptyState icon="message" text="אין הודעות מבית הספר" /></View>;
    return <View>{searchable(null)}</View>;
  }
  if (state === 'disconnected' || state === 'empty') {
    return <FeedEmpty feed="messages" link={link} icon="message" emptyText="אין הודעות חדשות" onConnect={onConnect} />;
  }
  return (
    <View>
      {state === 'stale' ? <MashovBanner feed="messages" link={link} onConnect={onConnect} /> : null}
      {searchable(tasks)}
    </View>
  );
}

/**
 * The teachers who wrote, newest first, one to show or all of them, as ruled
 * rows with how many each wrote; the chosen one carries a drawn tick. A copy
 * of Tasks' list menu. Choosing one closes the menu.
 */
function SenderMenu({ visible, senders, selected, onSelect, onClose }: {
  visible: boolean;
  senders: readonly { name: string; count: number }[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const p = usePalette();
  // The count in brackets is for the eye; a screen reader says it as a number of messages, not "דנה כהן (3)".
  const options: { name: string | null; title: string; label: string }[] = [
    { name: null, title: ALL_SENDERS, label: ALL_SENDERS },
    ...senders.map((s) => ({
      name: s.name,
      title: `${s.name} (${s.count})`,
      label: `${s.name}, ${plural(s.count, 'הודעה אחת', 'הודעות')}`,
    })),
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={SENDER_MENU_TITLE}>
      <View>
        {options.map((o) => {
          const active = selected === o.name;
          return (
            <Row
              key={o.name ?? 'all'}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={o.label}
              title={o.title}
              titleStyle={active ? { color: p.accent } : { fontFamily: font.body }}
              end={active ? <AppIcon name="check" color={p.accent} size={20} /> : null}
              onPress={() => {
                onSelect(o.name);
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
 * The day, the time and what to bring, bold over the body (W6-8): the day and
 * the time on one line, "להביא:" on its own (plan §16.2: not a chain of "·").
 * Read as one element, in `messageSummaryText`'s words.
 */
function SummaryLines({ summary }: { summary: MessageSummary }): React.JSX.Element {
  const p = usePalette();
  const style = { fontFamily: font.bodySemi, fontSize: type.body, color: p.text } as const;
  const when = summary.date !== null || summary.time !== null;
  return (
    <View accessible accessibilityLabel={messageSummaryText(summary)} style={styles.summary}>
      {when ? (
        <Text style={style}>
          {summary.date ? (
            <>
              {`${shortWeekday(summary.date)} `}
              <Ltr style={style}>{formatShortDate(summary.date)}</Ltr>
            </>
          ) : null}
          {summary.date && summary.time ? ', ' : null}
          {summary.time ? <Ltr style={style}>{summary.time}</Ltr> : null}
        </Text>
      ) : null}
      {summary.bring ? <Text style={[style, { lineHeight: 23 }]}>{`להביא: ${isolateRanges(summary.bring)}`}</Text> : null}
    </View>
  );
}

/**
 * One message, a section of the page (plan §16.1): its title, who sent it and
 * when, the bold line of what it asks, the body, and "להוסיף למשימות שלי".
 * Where it came from is a quiet word beside the title, not a tag.
 */
function MessageSection({ msg, tasks, searching, guard }: {
  msg: SchoolMessage;
  tasks: SchoolTaskAdder | null;
  searching: boolean;
  /** Ignores a press just after the teacher sheet closed (`useSheetPressGuard`). */
  guard: SheetPressGuard['guard'];
}): React.JSX.Element {
  const p = usePalette();
  // Open while searching, folded again when the search clears; the reader can still toggle in between.
  // Set during the render the search changes in, not in an effect after it: no frame paints folded first.
  const [open, setOpen] = useState(searching);
  const [wasSearching, setWasSearching] = useState(searching);
  if (searching !== wasSearching) {
    setWasSearching(searching);
    setOpen(searching);
  }
  // What the message says is read from its text, and the text does not change with a keystroke: once per message.
  // (`useAddSchoolTask` hands back a new object every render, so `memo` on the section would not help.)
  const today = todayStr();
  const read = useMemo(() => {
    const title = cleanText(msg.title);
    const body = cleanText(msg.body);
    const showBody = body.length > 0 && body !== title;
    // "להוסיף למשימות שלי" (W6-4: a verb, as everywhere else in the app): the
    // message's title becomes the task (R-21), due on the day the message names
    // — "ביום רביעי, 14.10" — when it names one (W4-6).
    return {
      showBody,
      foldable: showBody && isLong(body),
      titleShown: isolateRanges(title),
      bodyShown: isolateRanges(body),
      // "דנה כהן, נשלחה 8.10" — the name without Mashov's group, and "התקבלה" when Mashov gave no send time (plan §14.1).
      from: senderName(msg.from),
      sent: messageDateLabel(msg),
      task: messageTaskTitle(msg),
      // The day the message named, or the next such weekday once it has passed: "ליום רביעי הבא, 14.10" (run 8).
      day: messageTaskDay(msg, today),
      // The day, the time and what to bring, in bold over the body (W6-8, Daniel: "a wall of grey text").
      summary: messageSummary(msg, today),
    };
  }, [msg, today]);
  const { showBody, foldable, from, sent, task, day, summary } = read;
  const source = msg.source === 'mashov' ? 'משוב' : 'אתר בית הספר';
  const due = day?.date ?? null;
  const added = tasks?.hasOpen(task.title) ?? false;
  const adding = tasks?.pending?.title === task.title;

  // No tasks (a parent): the message alone.
  const action = !tasks ? null : added ? (
    <View style={styles.action}>
      <AppIcon name="check" color={p.ok} size={18} />
      <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.ok }]}>כבר במשימות שלך</Text>
    </View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`להוסיף למשימות שלי: ${task.title}${day ? `, ל${weekdayName(day.date)}${day.next ? ' הבא,' : ''} ${formatShortDate(day.date)}` : ''}`}
      disabled={adding}
      onPress={guard(() => tasks?.add({ title: task.title, notes: task.notes, due }, addedToTasksLabel(due, day?.next ?? false)))}
      style={({ pressed }) => [styles.action, { flexShrink: 1, opacity: adding ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      <AppIcon name="tasks" color={p.accent} size={18} />
      <Text style={[styles.line, { flexShrink: 1, fontFamily: font.bodySemi, color: p.accent }]}>
        להוסיף למשימות שלי
        {/* The day it will be due, read from the message, said before the tap. */}
        {day ? (
          <Text style={{ fontFamily: font.body, color: p.textMuted }}>
            {`, ל${messageTaskDayLead(day)}`}
            <Ltr style={[styles.line, { color: p.textMuted }]}>{formatShortDate(day.date)}</Ltr>
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );

  const content = (
    <>
      <View style={styles.messageHead}>
        <Text style={[styles.rowTitle, { flex: 1, color: p.text }]} numberOfLines={open ? undefined : 2}>
          {read.titleShown}
        </Text>
        {/* Source is always named: Mashov and the school site say different things. */}
        <Text style={[styles.line, { color: p.textMuted }]}>{source}</Text>
      </View>
      {/* Blue is for what can be tapped; the sender is only text (Daniel). */}
      {from || sent ? (
        <Text style={[styles.line, { color: p.textMuted }]}>
          {from ? `${isolateRanges(from)}${sent ? ', ' : ''}` : ''}
          {sent ? `${sent.lead} ` : ''}
          {sent ? <Ltr style={[styles.line, { color: p.textMuted }]}>{sent.date}</Ltr> : null}
        </Text>
      ) : null}
      {summary ? <SummaryLines summary={summary} /> : null}
      {showBody ? (
        <Text
          numberOfLines={foldable && !open ? 4 : undefined}
          style={[styles.body, { color: p.text }]}
        >
          {read.bodyShown}
        </Text>
      ) : null}
      {/* A few lines, and "עוד" for the rest (plan §14.1): Mashov's whole message can be long. */}
      {foldable ? (
        <View style={styles.more}>
          <Text style={[styles.line, { fontFamily: font.bodySemi, color: p.accent }]}>{open ? 'פחות' : 'עוד'}</Text>
          <View style={open ? styles.flip : null}>
            <AppIcon name="chevronDown" color={p.accent} size={16} />
          </View>
        </View>
      ) : null}
    </>
  );

  // The fold toggle and the task action are siblings: a button nested in a
  // pressable section is one element to a screen reader, and the inner one is lost.
  return (
    <View style={[styles.message, { borderBottomColor: p.border }]}>
      {foldable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint={open ? 'מקפל את ההודעה' : 'פותח את ההודעה המלאה'}
          onPress={guard(() => setOpen((v) => !v))}
          style={({ pressed }) => [styles.messageContent, { opacity: pressed ? 0.85 : 1 }]}
        >
          {content}
        </Pressable>
      ) : (
        <View style={styles.messageContent}>{content}</View>
      )}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  // Rows go edge to edge and bring their own gutter; everything else sits in `page`.
  content: { paddingTop: space.lg, paddingBottom: 100 },
  page: { paddingHorizontal: ROW_GUTTER },
  boardLine: { marginBottom: space.md },
  section: { marginTop: space.xl },
  afterCard: { marginTop: space.md },
  footNote: { marginTop: space.lg },
  line: { fontFamily: font.body, fontSize: type.small },
  paragraph: { fontFamily: font.body, fontSize: type.small, lineHeight: 21 },
  body: { fontFamily: font.body, fontSize: type.body, lineHeight: 23 },
  rowTitle: { fontFamily: font.bodySemi, fontSize: type.title },
  titleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  badgeWord: { fontFamily: font.bodySemi, fontSize: type.small },
  rowButton: { gap: 2 },
  rowExtra: { marginTop: 2 },
  endWord: { fontFamily: font.headingSemi, fontSize: type.body },
  // A row under another (a grade under its subject, a material under its fold): set in from the page's gutter.
  childRow: { paddingStart: ROW_GUTTER + space.lg },
  childTitle: { fontSize: type.body },
  inlineMark: { fontFamily: font.bodySemi, fontSize: type.small },
  dateMargin: { alignItems: 'center' },
  marginDate: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  marginDay: { fontFamily: font.body, fontSize: type.caption },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: ROW_MIN_HEIGHT,
    paddingStart: ROW_GUTTER, paddingEnd: ROW_END, paddingVertical: space.sm, borderBottomWidth: 1, marginBottom: space.sm,
  },
  fold: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: ROW_MIN_HEIGHT,
    paddingStart: ROW_GUTTER, paddingEnd: ROW_END, borderBottomWidth: 1,
  },
  // A fold's chevron points down when closed and up when open, as every
  // disclosure does; a left chevron only ever means "another screen".
  flip: { transform: [{ rotate: '180deg' }] },
  nextCard: { gap: space.sm },
  nextTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  nextWhat: { flex: 1, gap: 4 },
  nextMark: { marginVertical: 2 },
  nextTitle: { fontFamily: font.headingSemi, fontSize: type.heading },
  nextFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  footText: { flexShrink: 1, fontFamily: font.bodySemi, fontSize: type.body },
  hero: { alignItems: 'center', minWidth: 56 },
  heroValue: { fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.3) },
  doneLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The new grades' line, and under it the help as a text button at the line's start.
  gradesTop: { alignItems: 'flex-start', gap: 2 },
  explainer: { paddingBottom: space.md },
  helpButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: MIN_TOUCH },
  gradeEnd: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gradeValue: { alignItems: 'center', minWidth: 44 },
  // Under an open subject: its parts and "משקלים", set in like its grades.
  weightsRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH,
    paddingStart: ROW_GUTTER + space.lg, paddingEnd: ROW_END, borderBottomWidth: 1,
  },
  summary: { gap: 2, marginTop: 4 },
  message: { paddingStart: ROW_GUTTER, paddingEnd: ROW_END, paddingTop: space.lg, paddingBottom: space.xs, borderBottomWidth: 1 },
  messageContent: { gap: 4 },
  messageHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  // "הודעות" search: Tasks' row (field, teacher button, sheet row), on this page's gutter.
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  senderButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: MIN_TOUCH, maxWidth: '45%', paddingHorizontal: space.xs },
  senderButtonText: { flexShrink: 1, fontSize: type.label },
  menuRow: { paddingStart: 0, paddingEnd: 0 },
  searchNote: { paddingStart: ROW_GUTTER, paddingEnd: ROW_END },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
});
