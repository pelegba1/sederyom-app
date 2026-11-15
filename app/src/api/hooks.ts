import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  AGENDA_DEFAULT_DAYS,
  type AgendaItem, type AgendaView, type AttendanceResponse, type BagrutResponse, type BuddyShares, type ChatShares, type ClassOption, type CreateTaskBody, type DayView, type HomeworkItem,
  type DateStr, type NotificationLogEntry,
  type SaveExamBoardBody, type SchoolFeeds, type SettingsPatch, type SettingsResponse, type SettingsUpdateResponse, type StatusResponse,
  type Task, type TasksResponse, type TeachersResponse, type UpdateTaskBody, type WeekView, type Exam, type ExamOption,
} from '@sederyom/shared';
import {
  getConfirmedExamKeys, getNotificationsSeenAt, getTodayLessonsApart, getTodaySchoolOnly, setConfirmedExamKeys, setNotificationsSeenAt, setTodayLessonsApart, setTodaySchoolOnly,
} from '../lib/prefs';
import type { JoinTarget } from '../lib/invite';
import { countUnread } from '../lib/unread';
import { cacheWidgetFeed, storage } from '../widget/feedCache';
import { markHomeworkDone } from '../local/homeworkState';
import { addManualExam, manualAsExam, readManualExams, removeManualExam, restoreManualExam, type ManualExam } from '../local/manualExams';
import { ownExams, readExamPrefs, setExamInCalendar, setExamName, type ExamPrefs } from '../local/examPrefs';
import { moveExamOnPhone } from '../lib/examDate';
import { markMirrorDue } from '../google/mirror';
import { isDemo } from '../demo/phone';
import { OwnBoardError } from '../lib/examBoard';
import {
  OwnCalendarUnreadError, keepOwnCalendarRead, keepOwnRows, keepWithoutClassBoard, readOwnBoard, removeOwnBoard, type OwnBoard,
} from '../local/ownBoard';
import { markSettingsDue, settingsChangeOf, type SettingsChange } from './settingsChange';
import { withSubjectName } from '@sederyom/shared/logic/ownNames';
import { todayStr } from '@sederyom/shared/logic/time';
import { forgetDevicePass } from '../mashov/device';
import { appApi } from '../demo/api';
import { refreshLocalSources, rescheduleSummariesSoon } from '../local/source';
import {
  addChildFromInvite, addChildHere, childrenView, onlyChildNameNow, removeChildNow, renameChildNow, setOnlyChildNameNow, showChild, showChildOfClass,
  type ChildrenView,
} from '../local/phoneChildren';
import { userSettings } from '../local/userSettings';
import { isWithoutSite, keepsExamCalendar } from '../local/schoolSite';
import { googleAccount } from '../google/phone';
import { TIMEZONE } from '../config';
import { requestWidgetUpdate } from '../widget/update';
import {
  acceptBuddyInvite, buddiesView, buddyPage, buddyTodayLines, cancelBuddyInvites, checkBuddyInvite, createBuddyInvite, markBuddiesSeen, markBuddyGradesSeen,
  myHasBagrut, removeBuddyNow, renameBuddy, setBuddyShares, setMyBuddyName, turnOnBuddyGrades,
} from '../buddies/run';
import type { BuddiesView, BuddyPage, TodayLine } from '../buddies/view';
import { approveChat, chatScreen, cutAllChats, cutChat, makeChatCode, setChatShares } from '../chat/run';
import type { ChatScreenView } from '../chat/view';

export const keys = {
  day: (date?: string) => ['day', date ?? 'today'] as const,
  week: (offset: number) => ['week', offset] as const,
  agenda: (days: number) => ['agenda', days] as const,
  status: ['status'] as const,
  settings: ['settings'] as const,
  notifications: ['notifications'] as const,
  notificationsSeenAt: ['notificationsSeenAt'] as const,
  confirmedExams: ['confirmedExamKeys'] as const,
  todaySchoolOnly: ['todaySchoolOnly'] as const,
  todayLessonsApart: ['todayLessonsApart'] as const,
  school: ['school'] as const,
  bagrut: ['bagrut'] as const,
  attendance: ['attendance'] as const,
  teachers: ['teachers'] as const,
  tasks: ['tasks'] as const,
  examPrefs: ['examPrefs'] as const,
  /** The phone's own exam board (`local/ownBoard.ts`). */
  ownBoard: ['ownBoard'] as const,
  children: ['children'] as const,
  /** The only child's name; under `children`, so every change to the children refetches it. */
  onlyChildName: ['children', 'onlyName'] as const,
  buddies: ['buddies'] as const,
  /** Today's lines about friends on a date; under `buddies`, so every change to friends refetches them. */
  buddyToday: (date: string) => ['buddies', 'today', date] as const,
  buddyInvite: (secret: string | null) => ['buddyInvite', secret] as const,
  /** A friend's page on a date; `'default'` is the day it opens on (`buddyPageDate`). */
  buddyPage: (id: string, date?: string) => ['buddyPage', id, date ?? 'default'] as const,
  myHasBagrut: ['myHasBagrut'] as const,
  /** The chat connection page's model (`chat/run.ts`); every change to chats invalidates it. */
  chat: ['chat'] as const,
};

/**
 * Everything here is answered by the phone itself (`local/phoneApi.ts`), or,
 * while the demo is on, by its made-up student (`demo/api.ts`).
 */
const api = appApi;

/** `enabled: false` asks nothing (the sheet of a moved exam, whose school's day is not the student's date); a day already read still comes back. */
export function useDay(date?: string, enabled = true): UseQueryResult<DayView> {
  return useQuery({ queryKey: keys.day(date), queryFn: () => api.day(date), enabled });
}

export function useWeek(offset: number): UseQueryResult<WeekView> {
  return useQuery({ queryKey: keys.week(offset), queryFn: () => api.week(offset) });
}

/** "הקרוב אליי": what is planned from today on. */
export function useAgenda(days: number = AGENDA_DEFAULT_DAYS): UseQueryResult<AgendaView> {
  return useQuery({ queryKey: keys.agenda(days), queryFn: () => api.agenda(days) });
}

export function useStatus(): UseQueryResult<StatusResponse> {
  return useQuery({ queryKey: keys.status, queryFn: api.status, refetchInterval: 5 * 60_000 });
}

/**
 * Whether the phone is signed in to Google, as the status says: one boolean,
 * so what needs only that (a parent's tabs, docs/parents-plan.md) renders
 * again when it changes, not at every refetch. A sign-in Google wants renewed
 * still counts: it is there, and asks to be renewed.
 */
export function useGoogleConnected(): boolean {
  const { data } = useQuery({
    queryKey: keys.status,
    queryFn: api.status,
    refetchInterval: 5 * 60_000,
    select: (s: StatusResponse) => s.sources.some((x) => (x.source === 'google_calendar' || x.source === 'google_tasks') && x.configured),
  });
  return data ?? false;
}

/** Exams the student added by hand that a list does not have yet (by key). */
function manualExamsMissingFrom(list: readonly { naturalKey: string }[], from?: string): Exam[] {
  const have = new Set(list.map((e) => e.naturalKey));
  return readManualExams(storage).map(manualAsExam).filter((e) => !have.has(e.naturalKey) && (!from || e.date >= from));
}

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function useSettings(): UseQueryResult<SettingsResponse> {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => {
      const res = await api.settings();
      // "המבחנים שלי" lists upcoming exams; one added by hand is the student's own.
      const added = manualExamsMissingFrom(res.exams, todayStr(TIMEZONE)).map((e): ExamOption => ({
        ...e, hidden: res.settings.exams.hiddenKeys.includes(e.naturalKey), subjectKey: e.subject, match: { mine: true, reason: null },
      }));
      const exams = added.length > 0 ? [...res.exams, ...added].sort(byDate) : res.exams;
      // Under the student's names and dates for them; the match and the group stay the source's (`subjectKey`).
      return { ...res, exams: ownExams(exams, readExamPrefs(storage)) };
    },
  });
}

export function useNotificationLog(): UseQueryResult<{ items: NotificationLogEntry[] }> {
  return useQuery({ queryKey: keys.notifications, queryFn: () => api.notifications() });
}

/** When the log was last opened, kept on the phone; one copy shared by every bell. */
function useNotificationsSeenAt(): string {
  const { data } = useQuery({
    queryKey: keys.notificationsSeenAt,
    queryFn: () => getNotificationsSeenAt(),
    initialData: () => getNotificationsSeenAt(),
    staleTime: Infinity,
  });
  return data;
}

/** Notifications that arrived since the log was last opened: the bell's badge (W5-F). */
export function useUnreadNotifications(): number {
  const log = useNotificationLog();
  const seenAt = useNotificationsSeenAt();
  return countUnread(log.data?.items ?? [], seenAt);
}

/**
 * Marks everything in the log as seen; the notifications screen calls it when
 * it opens, and every bell's badge clears at once.
 *
 *   const markSeen = useMarkNotificationsSeen();
 *   useFocusEffect(useCallback(() => markSeen(), [markSeen]));
 */
/**
 * Exams the owner confirmed as theirs ("שלי") where the match was unsure
 * (W6-F). Kept on the phone; one copy shared by every screen, so the "?"
 * clears everywhere at once.
 *
 *   const { confirmed, setConfirmed } = useConfirmedExams();
 *   examCounts(exams, hidden, confirmed);
 *   setConfirmed(exam.naturalKey, true);
 */
export function useConfirmedExams(): { confirmed: ReadonlySet<string>; setConfirmed: (key: string, on: boolean) => void } {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: keys.confirmedExams,
    queryFn: () => getConfirmedExamKeys(),
    initialData: () => getConfirmedExamKeys(),
    staleTime: Infinity,
  });
  const setConfirmed = useCallback((key: string, on: boolean) => {
    const current = new Set(getConfirmedExamKeys());
    if (on) current.add(key);
    else current.delete(key);
    const next = [...current];
    setConfirmedExamKeys(next);
    qc.setQueryData(keys.confirmedExams, next);
  }, [qc]);
  return { confirmed: new Set(data), setConfirmed };
}

/** "רק בית ספר" on Today (W6-F, Itai): `[on, setOn]`, saved on the phone. */
export function useTodaySchoolOnly(): [boolean, (on: boolean) => void] {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: keys.todaySchoolOnly,
    queryFn: () => getTodaySchoolOnly(),
    initialData: () => getTodaySchoolOnly(),
    staleTime: Infinity,
  });
  const setOn = useCallback((on: boolean) => {
    setTodaySchoolOnly(on);
    qc.setQueryData(keys.todaySchoolOnly, on);
  }, [qc]);
  return [data, setOn];
}

/** Today's timeline with a row for each period (`dayEntries`), from the setting under "מראה". */
export function useTodayLessonsApart(): [boolean, (on: boolean) => void] {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: keys.todayLessonsApart,
    queryFn: () => getTodayLessonsApart(),
    initialData: () => getTodayLessonsApart(),
    staleTime: Infinity,
  });
  const setOn = useCallback((on: boolean) => {
    setTodayLessonsApart(on);
    qc.setQueryData(keys.todayLessonsApart, on);
  }, [qc]);
  return [data, setOn];
}

export function useMarkNotificationsSeen(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    const iso = new Date().toISOString();
    setNotificationsSeenAt(iso);
    qc.setQueryData(keys.notificationsSeenAt, iso);
  }, [qc]);
}

export function useSchool(): UseQueryResult<SchoolFeeds> {
  return useQuery({
    queryKey: keys.school,
    queryFn: async () => {
      const res = await api.school();
      const added = manualExamsMissingFrom(res.exams);
      const exams = added.length > 0 ? [...res.exams, ...added].sort(byDate) : res.exams;
      return { ...res, exams: ownExams(exams, readExamPrefs(storage)) };
    },
  });
}

/**
 * A task or an exam the phone itself wrote: the morning summaries and evening
 * reminders pending were built before it, so they are built again, a moment
 * later (`rescheduleSummariesSoon`).
 */
function afterPhoneDaysChange(): void {
  rescheduleSummariesSoon();
}

/**
 * Everything an exam added or deleted by hand changes: every view of exams, the widget, and the summaries pending.
 * Not waited for: the sheet's button would stay "שומר…" until every screen was built again.
 */
function afterManualExams(qc: QueryClient): void {
  afterPhoneDaysChange();
  for (const queryKey of [keys.settings, keys.school, ['day'], ['week'], ['agenda']]) void qc.invalidateQueries({ queryKey });
  refreshWidgetSoon();
}

/** "+ מבחן": an exam the school did not publish where the app can read it. */
export function useAddManualExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { date: string; subject: string; details?: string | null }) => addManualExam(storage, input),
    onSuccess: () => afterManualExams(qc),
  });
}

/** Deletes an exam added by hand; `restore` puts it back (the toast's undo). */
export function useRemoveManualExam(): { remove: (key: string) => ManualExam | null; restore: (exam: ManualExam) => void } {
  const qc = useQueryClient();
  return {
    remove: useCallback((key: string) => {
      const gone = removeManualExam(storage, key);
      void afterManualExams(qc);
      return gone;
    }, [qc]),
    restore: useCallback((exam: ManualExam) => {
      restoreManualExam(storage, exam);
      void afterManualExams(qc);
    }, [qc]),
  };
}

/**
 * The student's own word on each exam (`local/examPrefs.ts`): their name for
 * it, their date for it, and whether the Google calendar carries it. Kept on
 * the phone; one copy shared by every screen, so an open exam sheet shows a
 * new name or date at once.
 *
 *   const prefs = useExamPrefs();
 *   const shown = ownExam(exam, prefs);
 */
export function useExamPrefs(): ExamPrefs {
  const { data } = useQuery({
    queryKey: keys.examPrefs,
    queryFn: () => readExamPrefs(storage),
    initialData: () => readExamPrefs(storage),
    staleTime: Infinity,
  });
  return data;
}

/**
 * Everything a new name or date for an exam changes (`ownExams`): the lists
 * already loaded take it in place (the match stays the source's), the days the
 * phone builds, the widget, the summaries pending, and the Google calendar at
 * the next refresh. The lists are read again too: an exam whose own name is
 * gone takes its subject's name back (`subjectNames.ts`), which only building
 * them gives, and one moved to another date takes its place among the dates.
 */
function afterExamPrefs(qc: QueryClient, prefs: ExamPrefs): void {
  qc.setQueryData(keys.examPrefs, prefs);
  qc.setQueryData<SettingsResponse>(keys.settings, (previous) => (previous ? { ...previous, exams: ownExams(previous.exams, prefs) } : previous));
  qc.setQueryData<SchoolFeeds>(keys.school, (previous) => (previous ? { ...previous, exams: ownExams(previous.exams, prefs) } : previous));
  markMirrorDue(storage);
  afterPhoneDaysChange();
  for (const queryKey of [keys.settings, keys.school, ['day'], ['week'], ['agenda']]) void qc.invalidateQueries({ queryKey });
  refreshWidgetSoon();
}

/**
 * "לשנות שם": the student's own name for an exam, shown wherever the phone
 * shows it and in the Google calendar it keeps. `null` or an empty name, or
 * the source's own (`original`), gives the exam its source's name back.
 */
export function useRenameExam(): (naturalKey: string, name: string | null, original: string) => void {
  const qc = useQueryClient();
  return useCallback((naturalKey: string, name: string | null, original: string) => {
    afterExamPrefs(qc, setExamName(storage, naturalKey, name, original));
  }, [qc]);
}

/**
 * "לשנות תאריך": the student moves an exam to another day for themselves alone (`date`), or puts it back (`null`).
 * Takes the exam as the sheet holds it, under the student's name and on their date: what is kept is the exam as its
 * source gave it (`moveExamOnPhone`). The student's date shows wherever the phone shows the exam, and the Google
 * calendar takes it at the next refresh: what a new name triggers (`afterExamPrefs`). The demo writes nothing.
 * Returns whether anything was written.
 */
export function useSetExamDate(): (exam: Exam, date: DateStr | null) => boolean {
  const qc = useQueryClient();
  return useCallback((exam: Exam, date: DateStr | null) => {
    if (isDemo() || !moveExamOnPhone(storage, exam, date)) return false;
    afterExamPrefs(qc, readExamPrefs(storage));
    return true;
  }, [qc]);
}

/**
 * "להציג ביומן Google": off keeps the exam out of the "בית ספר" calendar the
 * phone keeps, and nothing else. The exam stays in the app ("לא המבחן שלי"
 * is the one that hides it); the next refresh takes it out of Google.
 */
export function useExamInCalendar(): (naturalKey: string, on: boolean) => void {
  const qc = useQueryClient();
  return useCallback((naturalKey: string, on: boolean) => {
    qc.setQueryData(keys.examPrefs, setExamInCalendar(storage, naturalKey, on));
    markMirrorDue(storage);
  }, [qc]);
}

/**
 * The phone's own exam board (`local/ownBoard.ts`), or `null` when it has none: read from the phone's storage and kept
 * in the query cache, so that every write below (`useOwnBoardActions`) puts the new board in it and everything that
 * depends on it draws again. Read again whenever a screen mounts, and when the settings are saved (a class changed
 * drops the board, `dropOwnBoardOnClassChange`). The demo has none: its exams are made up.
 */
export function useOwnBoard(): OwnBoard | null {
  const { data } = useQuery({
    queryKey: keys.ownBoard,
    queryFn: () => readOwnBoard(storage),
    initialData: () => readOwnBoard(storage),
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
  return isDemo() ? null : data;
}

/**
 * Everything a change to the phone's own board changes, as for any exam the phone keeps (`afterManualExams`: every view
 * of exams, the widget, the summaries pending) and more: the board is in the query that holds it, and the exams it
 * brings or takes away are the ones the "בית ספר" calendar carries, so it is mirrored at the next refresh and not an
 * hour after the last. The phone's days read the board from storage (`local/source.ts`), so nothing else is told.
 */
function afterOwnBoard(qc: QueryClient, board: OwnBoard | null): void {
  qc.setQueryData(keys.ownBoard, board);
  markMirrorDue(storage);
  afterManualExams(qc);
}

/** `write`, or an `OwnBoardError` when the phone's storage threw: nothing was sent anywhere, and the board is as it was. */
function kept<T>(write: () => T): T {
  try {
    return write();
  } catch {
    throw new OwnBoardError();
  }
}

export interface OwnBoardActions {
  /** Keeps the confirmed rows as the phone's own board. Throws `OwnBoardError` when the phone could not keep them. */
  keepRows: (rows: SaveExamBoardBody['rows']) => void;
  /**
   * Keeps a public Google calendar as the phone's own board and reads it at once (`keepOwnCalendarRead`). A first read
   * that fails is a keep that failed: the board that was there before is back, and it throws `OwnCalendarUnreadError`.
   * Throws `OwnBoardError` when the phone could not keep it.
   */
  keepCalendar: (calendarId: string, name: string | null) => Promise<void>;
  /** "בלי הלוח של הכיתה": the class's board is off on this phone. */
  hideClassBoard: () => void;
  /** The phone's own board, or the class's board turned off, is taken away: the class's board is the phone's again, at once, with no network. */
  removeOwn: () => void;
}

/** What a student does with the exam board that stays on the phone alone; each write is followed by `afterOwnBoard`. */
export function useOwnBoardActions(): OwnBoardActions {
  const qc = useQueryClient();
  return useMemo((): OwnBoardActions => ({
    keepRows: (rows) => afterOwnBoard(qc, kept(() => keepOwnRows(storage, rows))),
    keepCalendar: async (calendarId, name) => {
      let board: OwnBoard | null;
      try {
        board = await keepOwnCalendarRead(storage, calendarId, name, todayStr(TIMEZONE), TIMEZONE);
      } catch (err) {
        // The board before is back (a first read that failed), or the phone could not write: either way the screens
        // were not told of anything, and have nothing to be told.
        if (err instanceof OwnCalendarUnreadError) throw err;
        throw new OwnBoardError();
      }
      // The screens are told once, after the read: before it there is nothing of the calendar to show.
      afterOwnBoard(qc, board);
    },
    hideClassBoard: () => afterOwnBoard(qc, kept(() => keepWithoutClassBoard(storage))),
    removeOwn: () => {
      kept(() => removeOwnBoard(storage));
      afterOwnBoard(qc, null);
    },
  }), [qc]);
}

/**
 * Whether this phone keeps the "בית ספר" calendar: a class is picked, or the
 * student went on without a site (`keepsExamCalendar`, the rule
 * `refreshLocalSources` mirrors by), and the phone is signed in to Google.
 */
export function phoneKeepsExamCalendar(): boolean {
  return keepsExamCalendar(userSettings().classId, isWithoutSite(storage)) && googleAccount() !== null;
}

/** Bagrut grades change a few times a year; the phone reads them with Mashov (plan §14.2). */
export function useBagrut(): UseQueryResult<BagrutResponse> {
  return useQuery({ queryKey: keys.bagrut, queryFn: api.bagrut, staleTime: 60 * 60_000 });
}

/** Absences against the semester's lessons. Mashov is read with every refresh; the days off are settings. */
export function useAttendance(): UseQueryResult<AttendanceResponse> {
  return useQuery({ queryKey: keys.attendance, queryFn: api.attendance, staleTime: 10 * 60_000 });
}

/**
 * "איפה המורה?": today's teachers at the school. The server keeps its read half
 * an hour; the phone asks again after five minutes, so a change published
 * mid-morning reaches the screen without a pull.
 */
export function useTeachers(enabled = true): UseQueryResult<TeachersResponse | null | 'unsupported'> {
  return useQuery({ queryKey: keys.teachers, queryFn: () => api.teachers(), staleTime: 5 * 60_000, enabled });
}

/** Tasks from Google through the phone's own sign-in (plan Phase 2e); none before it signs in. */
export function useTasks(): UseQueryResult<TasksResponse> {
  return useQuery({ queryKey: keys.tasks, queryFn: () => api.tasks() });
}

/**
 * Settings decide what every day looks like — which lessons are mine, which
 * calendars show — and the widget renders the same truth, so a saved setting
 * refreshes all of them.
 */
function afterSettingsChange(qc: QueryClient, data: SettingsUpdateResponse, changed: SettingsChange): void {
  // Merge, never replace: the class list, the subject list and the calendar
  // list came with the full response, and the update response carries only
  // the settings. The full answer may read the school site for the class list,
  // so it is built again only when what it resolves actually changed — the
  // hidden-event titles, or the names "המבחנים שלי" shows its exams under —
  // never for a toggled switch.
  qc.setQueryData<SettingsResponse>(keys.settings, (previous) =>
    previous ? { ...previous, settings: data.settings } : undefined,
  );
  if (changed.resolveHiddenEvents || changed.subjectNames) void qc.invalidateQueries({ queryKey: keys.settings });
  // The school screen's exam list is the filtered one, and its homework drops
  // a hidden subject's (Today's "באיחור" reads it too, run 5).
  if (changed.exams || changed.lessons) void qc.invalidateQueries({ queryKey: keys.school });
  // The days off and the semester are the input to the lessons still ahead; the subjects are under the student's names.
  if (changed.attendance || changed.subjectNames) void qc.invalidateQueries({ queryKey: keys.attendance });
  // The "בית ספר" calendar's exams take new names at the next refresh.
  markSettingsDue(storage, changed);
  void qc.invalidateQueries({ queryKey: ['day'] });
  void qc.invalidateQueries({ queryKey: ['week'] });
  void qc.invalidateQueries({ queryKey: ['agenda'] });
  // A parent's list shows the class on screen as the settings have it.
  void qc.invalidateQueries({ queryKey: keys.children });
  // A class saved here drops the phone's own exam board, which was made for the class before.
  void qc.invalidateQueries({ queryKey: keys.ownBoard });
  refreshWidgetSoon();
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.saveSettings(patch),
    onSuccess: (data: SettingsUpdateResponse, patch) => afterSettingsChange(qc, data, settingsChangeOf(patch)),
  });
}

/**
 * Gives a subject a name of the student's own (design 2026-11-05): `name`
 * under every one of `lineKeys` (`lessonNameTarget`, `examNameTarget`), over
 * the names the settings hold *now*, so two sheets never write over each
 * other's. An empty name, or one equal to any of `originals`, deletes those
 * keys (`withSubjectName`). It is an ordinary settings save, so the lists, the
 * attendance, the widget and the "בית ספר" calendar take the name the way they
 * take any other setting.
 */
export function useRenameSubject(): (lineKeys: readonly string[], name: string | null, originals: readonly string[]) => void {
  const qc = useQueryClient();
  const { mutate } = useSaveSettings();
  return useCallback((lineKeys: readonly string[], name: string | null, originals: readonly string[]) => {
    const current = qc.getQueryData<SettingsResponse>(keys.settings);
    // Settings not read yet: writing over `{}` would erase every name there is.
    if (!current) return;
    mutate({ lessons: { subjectNames: withSubjectName(current.settings.lessons.subjectNames ?? {}, lineKeys, name, originals) } });
  }, [qc, mutate]);
}

/** Long-press on a calendar event: hide this occurrence, or the whole series. */
export function useHideEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<SettingsUpdateResponse> => {
      const current = (qc.getQueryData<SettingsResponse>(keys.settings) ?? (await api.settings())).settings;
      const ids = current.calendars.hiddenEventIds;
      if (ids.includes(id)) return { settings: current };
      return api.saveSettings({ calendars: { hiddenEventIds: [...ids, id] } });
    },
    onSuccess: (data) => afterSettingsChange(qc, data, { resolveHiddenEvents: true }),
  });
}

/**
 * "לחפש את הכיתות": the school's timetable site, pasted when Mashov names none.
 * Its classes come back with `/settings` read again; an error's message is
 * ready for the screen.
 */
export function useLookUpSchoolSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (address: string) => api.lookUpSchoolSite(address),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

/** An invite link's class (ideas ה2): a new class changes every screen, so everything is read again. */
export function useJoinClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: JoinTarget) => api.joinClass(target),
    onSuccess: async () => {
      await qc.invalidateQueries();
      refreshWidgetSoon();
    },
  });
}

/** "להמשיך בלי אתר": the days from Mashov alone, and the class picker says so. */
export function useGoWithoutSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.goWithoutSite(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

/** Everything a fresh Mashov session changes: status, and every feed it fills. */
export function useAfterMashovLogin(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.status }),
      qc.invalidateQueries({ queryKey: keys.settings }),
      qc.invalidateQueries({ queryKey: keys.school }),
      qc.invalidateQueries({ queryKey: ['day'] }),
      qc.invalidateQueries({ queryKey: ['week'] }),
      qc.invalidateQueries({ queryKey: ['agenda'] }),
    ]);
    refreshWidgetSoon();
  }, [qc]);
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => api.createTask(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.tasks });
      void qc.invalidateQueries({ queryKey: keys.school });
      void qc.invalidateQueries({ queryKey: ['day'] });
      void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      refreshWidgetSoon();
      afterPhoneDaysChange();
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskBody }) => api.updateTask(id, body),
    // Optimistic: ticking a checkbox must feel instant even on a slow link.
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: keys.tasks });
      const previous = qc.getQueryData<TasksResponse>(keys.tasks);
      if (previous) {
        qc.setQueryData<TasksResponse>(keys.tasks, {
          ...previous,
          items: previous.items.map((t) => (t.id === id ? { ...t, ...body } : t)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.tasks, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.tasks });
      void qc.invalidateQueries({ queryKey: ['day'] });
      void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      refreshWidgetSoon();
      afterPhoneDaysChange();
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    // Not waited for, as for a new task: the delete is done once Google said so.
    onSuccess: () => {
      for (const queryKey of [keys.tasks, keys.school, ['day'], ['week'], ['agenda']]) void qc.invalidateQueries({ queryKey });
      afterPhoneDaysChange();
      refreshWidgetSoon();
    },
  });
}

/** Sets `done` on one homework item wherever a cached view carries it. */
function patchHomework(items: HomeworkItem[] | undefined, key: string, done: boolean): HomeworkItem[] | undefined {
  // `?.`: a server older than the contract sends no `homework` at all.
  return items?.map((h) => (h.naturalKey === key ? { ...h, done } : h));
}

function patchDay(day: DayView, key: string, done: boolean): DayView {
  return { ...day, homework: patchHomework(day.homework, key, done) ?? day.homework };
}

/**
 * Ticks a Mashov homework item off ("עשיתי"), or back on. Optimistic: every
 * cached day, week, agenda and the school feed flip at once — the "להגשה"
 * counter included — and roll back if the tick could not be kept.
 */
export function useSetHomeworkDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, done }: { key: string; done: boolean }) => api.setHomeworkDone(key, done),
    onMutate: async ({ key, done }) => {
      // The phone's copy too, so a day it rebuilds shows the tick at once.
      markHomeworkDone(storage, key, done);
      const scopes = [['day'], ['week'], ['agenda'], keys.school] as const;
      await Promise.all(scopes.map((queryKey) => qc.cancelQueries({ queryKey })));
      const snapshot = scopes.flatMap((queryKey) => qc.getQueriesData({ queryKey }));
      qc.setQueriesData<DayView>({ queryKey: ['day'] }, (d) => (d ? patchDay(d, key, done) : d));
      qc.setQueriesData<WeekView>({ queryKey: ['week'] }, (w) => (w ? { ...w, days: w.days.map((d) => patchDay(d, key, done)) } : w));
      qc.setQueriesData<AgendaView>({ queryKey: ['agenda'] }, (a) => (a ? {
        ...a,
        days: a.days.map((d) => ({
          ...d,
          items: d.items.map((i): AgendaItem => (i.kind === 'homework' && i.homework.naturalKey === key ? { ...i, homework: { ...i.homework, done } } : i)),
        })),
      } : a));
      qc.setQueryData<SchoolFeeds>(keys.school, (s) => (s ? { ...s, homework: patchHomework(s.homework, key, done) ?? s.homework } : s));
      return { snapshot };
    },
    onError: (_err, { key, done }, context) => {
      markHomeworkDone(storage, key, !done);
      for (const [queryKey, data] of context?.snapshot ?? []) qc.setQueryData(queryKey, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['day'] });
      void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      void qc.invalidateQueries({ queryKey: keys.school });
      // The widgets list open homework due today and tomorrow.
      refreshWidgetSoon();
    },
  });
}

/** Everything a source going away changes: its status, and every view it fed. */
async function afterDisconnect(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries();
  refreshWidgetSoon();
}

/** "ניתוק" for Mashov: the phone forgets its login. */
export function useDisconnectMashov() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      // The "personal device" pass is a login too: it goes with the rest.
      forgetDevicePass(storage);
      return api.disconnectMashov();
    },
    onSuccess: () => afterDisconnect(qc),
  });
}

/** "ניתוק" for Google: the phone signs out and forgets what it read. */
export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.disconnectGoogle, onSuccess: () => afterDisconnect(qc) });
}

/** Pull-to-refresh: read every source again, then refetch everything. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.sync,
    // The spinner stops on the screens built from what was read; the widget comes a moment after.
    onSettled: async () => {
      await qc.invalidateQueries();
      refreshWidgetSoon();
    },
  });
}

// ---------------------------------------------------------------------------
// A parent's children (parents mode, stage 2; local/children.ts)
// ---------------------------------------------------------------------------

/** The children on this phone; `null` with fewer than two. */
export function useChildren(): UseQueryResult<ChildrenView | null> {
  return useQuery({ queryKey: keys.children, queryFn: async () => childrenView() });
}

/**
 * After the children changed: every screen and the widget show the child on
 * screen, and a refresh has the server follow the classes as they are now,
 * reads the feeds and plans the summaries again. Not waited for: the switcher
 * would stay disabled until every screen was built again.
 */
export function afterChildrenChange(qc: QueryClient): void {
  void qc.invalidateQueries();
  refreshWidgetSoon();
  void refreshLocalSources()
    .then(() => qc.invalidateQueries())
    .then(refreshWidgetSoon)
    .catch(() => undefined);
}

/** The switcher above the days: another child on screen. */
export function useShowChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => showChild(id),
    onSuccess: (changed) => (changed ? afterChildrenChange(qc) : undefined),
  });
}

/** A tapped push about a child not on screen: that child goes there. Never throws. */
export function showChildForPush(qc: QueryClient, cls: { siteUrl: string; classId: string }): void {
  void showChildOfClass(cls).then((changed) => (changed ? afterChildrenChange(qc) : undefined)).catch(() => undefined);
}

/** Settings: a child in another class of the school on screen. */
export function useAddChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (option: ClassOption) => addChildHere(option),
    onSuccess: (result) => (result === 'added' ? afterChildrenChange(qc) : undefined),
  });
}

/** An invite link's class, added beside the class a parent's phone has. */
export function useAddChildFromInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: JoinTarget) => addChildFromInvite(target),
    onSuccess: ({ result }) => (result === 'added' || result === 'shown' ? afterChildrenChange(qc) : undefined),
  });
}

export function useRenameChild(): (id: string, label: string) => void {
  const qc = useQueryClient();
  return useCallback((id: string, label: string) => {
    renameChildNow(id, label);
    void qc.invalidateQueries({ queryKey: keys.children });
    // The summaries name the child.
    rescheduleSummariesSoon();
  }, [qc]);
}

/**
 * What a parent calls the only child (fewer than two children, so no list): the
 * name kept, and a setter that saves it. `quiet` writes it to the phone and
 * tells no screen: the field writes as the parent types, since `addChild`
 * reads the name when a second child is added, and tells the screens once the
 * field is left. The name stays on the phone, and the summaries do not speak
 * of one child by name, so nothing is rescheduled.
 */
export function useOnlyChildName(): [string, (name: string, options?: { quiet?: boolean }) => void] {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: keys.onlyChildName, queryFn: async () => onlyChildNameNow() });
  const save = useCallback((name: string, options?: { quiet?: boolean }) => {
    setOnlyChildNameNow(name);
    if (!options?.quiet) void qc.invalidateQueries({ queryKey: keys.onlyChildName });
  }, [qc]);
  return [data ?? '', save];
}

export function useRemoveChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeChildNow(id),
    onSuccess: () => afterChildrenChange(qc),
  });
}

// ---------------------------------------------------------------------------
// Friends (docs/superpowers/specs/2026-10-29-friends-design.md; buddies/run.ts)
// ---------------------------------------------------------------------------

/** The friends screen's model; empty for a parent, the made-up friend in the demo. */
export function useBuddies(): UseQueryResult<BuddiesView> {
  // A minute at most between rebuilds: every change and the refresh invalidate it anyway.
  return useQuery({ queryKey: keys.buddies, queryFn: async () => buddiesView(new Date()), staleTime: 60_000 });
}

/** After a change to friends: the friends screen, its header button, a friend's page, and Today's lines about friends. */
function afterBuddiesChange(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: keys.buddies });
  void qc.invalidateQueries({ queryKey: ['buddyPage'] });
  void qc.invalidateQueries({ queryKey: ['day'] });
}

/**
 * A friend's page on `date`, or on the day it opens on; `null` for a friend
 * not on this phone (just removed) or a parent. The page before stays shown
 * while another date is built, so the day strip does not blink.
 */
export function useBuddyPage(id: string, date?: string): UseQueryResult<BuddyPage | null> {
  return useQuery({
    queryKey: keys.buddyPage(id, date),
    queryFn: async () => buddyPage(id, date, new Date()),
    // Another date of the same friend only: never one friend's page under another's name.
    placeholderData: (previous, query) => (query?.queryKey[1] === id ? previous : undefined),
  });
}

/**
 * The lines about friends under Today's "now" card for `date` (2.2): at most
 * two, none for a parent. Built over my days and theirs, so not on every
 * render: a minute old at the most (the window ends and the day ends by the
 * clock), and again whenever friends change (`keys.buddyToday` is under
 * `keys.buddies`). `enabled` turns it off (another day than today, a screen
 * not in view, no friends), and nothing is built then.
 */
export function useBuddyTodayLines(date: string, enabled = true): UseQueryResult<TodayLine[]> {
  return useQuery({
    queryKey: keys.buddyToday(date),
    queryFn: async () => buddyTodayLines(date, new Date()),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** ״להפסיק להיות חברים״ (2.7). */
export function useRemoveBuddy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeBuddyNow(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.buddies });
      void qc.invalidateQueries({ queryKey: ['day'] });
      // The page being left keeps what it shows while it slides away; any other is read anew when opened.
      void qc.invalidateQueries({ queryKey: ['buddyPage'], refetchType: 'none' });
    },
    // A failed removal may still have gone part of the way.
    onError: () => afterBuddiesChange(qc),
  });
}

/** What a friend sees from me; it reaches them with the next refresh. */
export function useSetBuddyShares() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, shares }: { id: string; shares: BuddyShares }) => setBuddyShares(id, shares),
    onSuccess: () => afterBuddiesChange(qc),
  });
}

/**
 * The button on a friend's grades tab (grades 2.2): `'grades'` turns my grades
 * on for this friend, `'bagrut'` the bagrut with them. A failure may still have
 * turned it on, so the screens are read again either way.
 */
export function useTurnOnBuddyGrades() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, which }: { id: string; which: 'grades' | 'bagrut' }) => turnOnBuddyGrades(id, which),
    onSettled: () => afterBuddiesChange(qc),
  });
}

/**
 * The grades tab of friend `id` was opened: its dot goes, on the page and in
 * the list. Never throws.
 *
 *   const markSeen = useMarkBuddyGradesSeen();
 *   useEffect(() => markSeen(id), [markSeen, id]);
 */
export function useMarkBuddyGradesSeen(): (id: string) => void {
  const qc = useQueryClient();
  return useCallback(
    (id: string) => {
      void markBuddyGradesSeen(id)
        .then(() => {
          void qc.invalidateQueries({ queryKey: keys.buddies });
          void qc.invalidateQueries({ queryKey: ['buddyPage'] });
        })
        .catch(() => undefined);
    },
    [qc],
  );
}

/**
 * Whether the phone has bagrut grades a friend could be shown: the switch
 * ״גם ציוני בגרות״ is offered only then (grades 2.1). Read from the phone at
 * once, and again whenever the query is invalidated or mounted anew.
 */
export function useMyHasBagrut(): boolean {
  const { data } = useQuery({
    queryKey: keys.myHasBagrut,
    queryFn: async () => myHasBagrut(),
    initialData: () => myHasBagrut(),
  });
  return data;
}

/** My own name for a friend; `''` goes back to theirs. `false` for one that is not a name. */
export function useRenameBuddy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => renameBuddy(id, label),
    onSuccess: (saved) => (saved ? afterBuddiesChange(qc) : undefined),
  });
}

/** What a link opened here is (`checkBuddyInvite`). */
export type BuddyInviteCheck = Awaited<ReturnType<typeof checkBuddyInvite>>;

/**
 * What the invite in a link is, asked once for each link that arrives
 * (`BuddyBridge`): nothing while `secret` is `null`. Never retried, and never
 * kept once nobody asks: the same link opened again is asked about again.
 */
export function useReadBuddyInvite(secret: string | null): UseQueryResult<BuddyInviteCheck> {
  return useQuery({
    queryKey: keys.buddyInvite(secret),
    queryFn: () => checkBuddyInvite(secret ?? ''),
    enabled: secret !== null,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** ״לשלוח קישור״: a new invite's secret, or `'full'`. */
export function useCreateBuddyInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shares: BuddyShares) => createBuddyInvite(shares),
    // A failed write may still leave an invite to take back; the count shows sent ones only.
    onSettled: () => afterBuddiesChange(qc),
  });
}

/** ״לבטל את ההזמנות שעוד לא אושרו?״: my invites nobody answered, withdrawn. */
export function useCancelBuddyInvites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelBuddyInvites(),
    // A failure may still have withdrawn some of them.
    onSettled: () => afterBuddiesChange(qc),
  });
}

/** ״להיות חברים״: the answer to a link. */
export function useAcceptBuddyInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ secret, shares }: { secret: string; shares: BuddyShares }) => acceptBuddyInvite(secret, shares),
    onSettled: () => afterBuddiesChange(qc),
  });
}

/** The name friends see for me; `false` for one that is not a name. */
export function useSetMyBuddyName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => setMyBuddyName(name),
    onSuccess: (saved) => (saved ? afterBuddiesChange(qc) : undefined),
  });
}

/** The friends screen was seen: the dot on the header's button goes, and the one-time notes. Never throws. */
export function useMarkBuddiesSeen(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    void markBuddiesSeen()
      .then(() => qc.invalidateQueries({ queryKey: keys.buddies }))
      .catch(() => undefined);
  }, [qc]);
}

// ---------------------------------------------------------------------------
// The chat connection (docs/superpowers/specs/2026-11-04-chat-connection-design.md; chat/run.ts)
// ---------------------------------------------------------------------------

/**
 * The chat page's model: the chats linked, what is shared, when the copy was last
 * sent. Empty for a parent and in the demo (no network). `polling` reads it every
 * three seconds, for the moments a chat is expected (a code is on screen); the
 * first read of a chat that came links it and writes the copy (`chatScreen`).
 */
export function useChat({ polling }: { polling: boolean }): UseQueryResult<ChatScreenView> {
  return useQuery({
    queryKey: keys.chat,
    queryFn: () => chatScreen(new Date()),
    refetchInterval: polling ? 3000 : false,
    staleTime: 30_000,
  });
}

/** ״להתחבר לצ׳אט״: a new code (with its expiry), or `'full'`. A failed one may still have made K, so the page is read again either way. */
export function useMakeChatCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => makeChatCode(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.chat }),
  });
}

/** What the chats may read; it reaches a linked chat at once. */
export function useSetChatShares() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shares: ChatShares) => setChatShares(shares),
    // A failed write has still kept the choice.
    onSettled: () => qc.invalidateQueries({ queryKey: keys.chat }),
  });
}

/** ״לחבר״: confirms a chat from a host the app does not know. */
export function useApproveChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveChat(id),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.chat }),
  });
}

/** ״לנתק״: cuts one chat. */
export function useCutChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cutChat(id),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.chat }),
  });
}

/** ״לנתק הכול״: cuts every chat. */
export function useCutAllChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cutAllChats(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.chat }),
  });
}

/**
 * How long a change on the phone waits before the widget is built again for
 * it. In the same turn as the tap, building it (two weeks of days, then every
 * widget drawn) held the JS thread: the press showed late, and people tapped
 * again.
 */
export const WIDGET_AFTER_CHANGE_MS = 600;

let widgetSoon: ReturnType<typeof setTimeout> | null = null;

/**
 * The widget's feed built again and the widgets drawn from it, a moment from
 * now (`WIDGET_AFTER_CHANGE_MS`): the tap shows first, and changes close
 * together share one build.
 */
export function refreshWidgetSoon(): void {
  if (widgetSoon !== null) clearTimeout(widgetSoon);
  widgetSoon = setTimeout(() => {
    widgetSoon = null;
    void refreshWidgetFeed().then(requestWidgetUpdate).catch(() => undefined);
  }, WIDGET_AFTER_CHANGE_MS);
}

/** Pulls the widget feed and writes it to the store the widgets render from. */
export async function refreshWidgetFeed(): Promise<void> {
  try {
    cacheWidgetFeed(await api.widgetFeed());
  } catch {
    // Leaving the previous feed in place is correct: the widget shows its own
    // "עודכן HH:MM" and turns the footer amber once it is stale.
  }
}

export type { Task };
