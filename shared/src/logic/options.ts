/**
 * The pickers' lists (`GET /settings`), as pure functions over what the
 * server reads from its snapshots and the phone keeps in MMKV: the subjects
 * the class grid names, the Google calendars, and the upcoming exams with
 * whether each looks like the student's. Plus the settings merge itself.
 */
import type { CalendarOption, DateStr, Exam, ExamOption, SettingsPatch, SubjectOption, UserSettings } from '../index';
import { DEFAULT_SETTINGS, currentSemester } from '../index';
import { matchExam, type LessonLine, type OwnerLessons } from './exam-match';
import { isHiddenLesson, lessonHideKey } from './filters';
import { lessonInMashov, subjectKey } from './subjects';
import { addDays, todayStr } from './time';

/** A Mashov timetable slot's part the pickers read. */
export interface SlotLine {
  subject: string;
  groupName: string | null;
  teacher: string | null;
}

/**
 * Every line the school site publishes for the class, grouped by subject and
 * teacher, each flagged with whether the student's own Mashov timetable has a
 * matching group.
 */
export function subjectOptions(
  lessons: readonly { subject: string; teacher: string | null }[],
  slots: readonly SlotLine[],
): { subjects: SubjectOption[]; mashovKnown: boolean } {
  const groups = slots.map((s) => ({ subject: s.subject, groupName: s.groupName, teacher: s.teacher }));
  const lines = new Map<string, { name: string; teacher: string | null; count: number }>();
  const teachersBySubject = new Map<string, Set<string>>();
  for (const lesson of lessons) {
    const name = subjectKey(lesson.subject);
    const teacher = lesson.teacher ? subjectKey(lesson.teacher) : null;
    const id = `${name} ${teacher ?? ''}`;
    const line = lines.get(id) ?? { name, teacher, count: 0 };
    line.count += 1;
    lines.set(id, line);
    if (teacher) {
      const set = teachersBySubject.get(name) ?? new Set<string>();
      set.add(teacher);
      teachersBySubject.set(name, set);
    }
  }

  const subjects = [...lines.values()]
    .map((line): SubjectOption => {
      // Two teachers under one subject name means the key must name the teacher,
      // or hiding one group would hide both.
      const ambiguous = (teachersBySubject.get(line.name)?.size ?? 0) > 1;
      return {
        key: lessonHideKey({ subject: line.name, teacher: line.teacher }, ambiguous),
        name: line.name,
        teacher: line.teacher,
        inMashov: groups.length > 0 && lessonInMashov({ subject: line.name, teacher: line.teacher }, groups),
        count: line.count,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'he') || (a.teacher ?? '').localeCompare(b.teacher ?? '', 'he'));

  return { subjects, mashovKnown: groups.length > 0 };
}

/**
 * The Google calendars, primary first, with the school mirror and the grade's exam calendar marked: one id, or
 * several (the class's and a student's own, on a phone).
 */
export function calendarOptions(
  calendars: readonly { id: string; summary: string; primary: boolean }[],
  schoolCalendarId: string | null,
  examCalendarId: string | null | readonly string[],
): CalendarOption[] {
  const examIds = examCalendarId === null ? [] : typeof examCalendarId === 'string' ? [examCalendarId] : examCalendarId;
  return calendars
    .map((c): CalendarOption => ({
      id: c.id,
      name: c.summary,
      primary: c.primary,
      isSchoolCalendar: c.id === schoolCalendarId,
      isExamCalendar: examIds.includes(c.id),
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, 'he'));
}

/**
 * The lessons an exam is compared against: the class grid's subjects and the
 * student's own Mashov groups, split by the hide-list, because a lesson the
 * student switched off is evidence too.
 */
export function ownerLessons(
  lessons: readonly LessonLine[],
  slots: readonly SlotLine[],
  settings: Pick<UserSettings, 'lessons'>,
): OwnerLessons {
  const lines: LessonLine[] = [
    ...lessons,
    ...slots
      .map((s) => ({ subject: s.subject || s.groupName || '', teacher: s.teacher }))
      .filter((l) => l.subject !== ''),
  ];
  const hidden = settings.lessons.hiddenSubjects;
  return {
    kept: lines.filter((l) => !isHiddenLesson(hidden, l)),
    hidden: lines.filter((l) => isHiddenLesson(hidden, l)),
  };
}

/** Upcoming exams, hidden ones included, each with its subject and whether it looks like the student's. */
export function examOptions(exams: readonly Exam[], owner: OwnerLessons, settings: UserSettings): ExamOption[] {
  const hidden = new Set(settings.exams.hiddenKeys);
  return exams.map((exam) => {
    // A bagrut exam is the student's own registration (plan 14.9), and one they added is theirs too:
    // never "?", grouped under its subject.
    const match = exam.kind === 'bagrut' || exam.kind === 'manual' ? { subjectKey: exam.subject, match: { mine: true, reason: null } } : matchExam(exam, owner);
    return { ...exam, hidden: hidden.has(exam.naturalKey), ...match };
  });
}

/** The school year's last day, where the second semester ends (`currentSemester` has the same). */
const SCHOOL_YEAR_END = '06-20';

/**
 * The semester `today` is in: two a year, the first from September into the
 * winter, the second from the day after it to the end of the school year.
 *
 * The stored one counts while it lasts, whether the student set it or it was
 * saved along with another setting (every save stores the semester it reads).
 * Once it is over, the next one: after a first semester the second, to the
 * end of that school year; after the second, the summer keeps it, and from
 * September the calendar's usual one (`currentSemester`). Without this, the
 * tracker stayed on the first semester all year: from February it counted
 * none of the absences and none of the lessons ahead.
 */
export function semesterOn(
  stored: { semesterStart: DateStr; semesterEnd: DateStr },
  today: DateStr,
): { semesterStart: DateStr; semesterEnd: DateStr } {
  const usual = currentSemester(today);
  const start = stored.semesterStart || usual.semesterStart;
  const end = stored.semesterEnd || usual.semesterEnd;
  if (today <= end) return { semesterStart: start, semesterEnd: end };

  const [y, m] = end.split('-').map(Number) as [number, number];
  // A first semester ends in the winter.
  if (m >= 9 || m <= 4) {
    const yearEnd = `${m >= 9 ? y + 1 : y}-${SCHOOL_YEAR_END}`;
    if (today <= yearEnd) return { semesterStart: addDays(end, 1), semesterEnd: yearEnd };
  } else if (today < `${y}-09-01`) {
    // A second semester that ended: its count is the one to see until the new year.
    return { semesterStart: start, semesterEnd: end };
  }
  return usual;
}

/**
 * Stored settings over the defaults, so a new toggle never reads undefined.
 * The semester is the one `today` is in (`semesterOn`).
 */
export function mergeSettings(stored: unknown, today: DateStr = todayStr()): UserSettings {
  const s = (stored ?? {}) as Partial<UserSettings>;
  const attendance = { ...DEFAULT_SETTINGS.attendance, ...(s.attendance ?? {}) };
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(s.notifications ?? {}) },
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(s.quietHours ?? {}) },
    lessons: { ...DEFAULT_SETTINGS.lessons, ...(s.lessons ?? {}) },
    calendars: { ...DEFAULT_SETTINGS.calendars, ...(s.calendars ?? {}) },
    exams: { ...DEFAULT_SETTINGS.exams, ...(s.exams ?? {}) },
    attendance: { ...attendance, ...semesterOn(attendance, today) },
  };
}

/** A patch over the current settings, each group merged on its own. */
export function applySettingsPatch(current: UserSettings, patch: SettingsPatch, today?: DateStr): UserSettings {
  return mergeSettings({
    ...current,
    ...patch,
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    quietHours: { ...current.quietHours, ...(patch.quietHours ?? {}) },
    lessons: { ...current.lessons, ...(patch.lessons ?? {}) },
    calendars: { ...current.calendars, ...(patch.calendars ?? {}) },
    exams: { ...current.exams, ...(patch.exams ?? {}) },
    attendance: { ...current.attendance, ...(patch.attendance ?? {}) },
  }, today);
}
