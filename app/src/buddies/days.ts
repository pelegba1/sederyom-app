/**
 * A friend's lessons, day by day, as this phone rebuilds them (friends spec
 * 4.1), and my own attendance for the box I share.
 *
 * - A school with a Shahaf site: the friend's class feed, through the phone's
 *   own `buildLocalDays`, with the friend's picks (`hiddenSubjects`) in place
 *   of mine, as a parent's other child is built (`summaryChildren` in
 *   `local/source.ts`), and the school's names, never my own for subjects. No
 *   Mashov: the friend's Mashov is not on this phone, so a week the site has
 *   not published is not there at all.
 * - A school without one: the lessons the friend's box carries, this week's
 *   and next week's (this week's only in a box two would not fit, and none
 *   in one not even a week fit: a week not carried is not known).
 * - A friend who does not share their timetable: nothing.
 *
 * Pure: the sources in, the days out.
 */
import type { AttendanceResponse, BuddyBoxContent, ClassFeed, DateStr, DayView } from '@sederyom/shared';
import { buildAttendance, type SlotLike } from '@sederyom/shared/logic/attendance';
import type { CompareLesson } from '@sederyom/shared/logic/buddies-compare';
import type { AttendancePayload, LessonCountPayload } from '@sederyom/shared/logic/mashov/attendance';
import { addDays, todayStr, weekStart } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { buildLocalDays, type LocalSources } from '../local/days';

/**
 * `src` with the dates the student set for exams left out, for the days built
 * for a friend: what a friend is told, and the comparison with their exams,
 * go by the school's date, not by one the student chose for themselves
 * (`examPrefs.ts`). The days are built over the school's dates, so an exam
 * moved out of them is still there, and one moved in from far off is not. The
 * names the student gave exams stay: a friend sees those (`buddies/content.ts`).
 */
export function withSchoolDates(src: LocalSources): LocalSources {
  return src.examPrefs ? { ...src, examPrefs: { ...src.examPrefs, dates: {} } } : src;
}

/**
 * A day's lessons as the comparison reads them, cancelled ones included, by
 * the school's names (`originalSubject`): my days carry the names I gave
 * subjects, a friend's never do, and the two are set side by side.
 */
export function lessonsOfDay(day: DayView): CompareLesson[] {
  return day.timeline.flatMap((item) =>
    item.kind === 'lesson'
      ? [{
        hourIndex: item.lesson.hourIndex, start: item.lesson.startTime, end: item.lesson.endTime,
        subject: item.lesson.originalSubject ?? item.lesson.subject, teacher: item.lesson.teacher, status: item.lesson.status,
      }]
      : [],
  );
}

/**
 * The friend's lessons on each of `dates`, or `null` when they share no
 * timetable. A date whose week the friend's source does not cover is left out
 * of the map: a week the site has not published, or, from a box, a week other
 * than the two it carries. A date in a covered week with no lessons is there,
 * empty: a day without school.
 */
export function buddyLessons(
  content: BuddyBoxContent,
  feed: ClassFeed | null,
  base: LocalSources,
  dates: readonly DateStr[],
): Map<DateStr, CompareLesson[]> | null {
  const timetable = content.timetable;
  if (!timetable) return null;
  const out = new Map<DateStr, CompareLesson[]>();
  const weekOf = (date: DateStr) => weekStart(date, 0, base.zone);

  if (timetable.siteUrl !== null) {
    if (!feed) return out;
    const published = new Set(feed.lessons.map((l) => weekOf(l.date)));
    const shown = dates.filter((date) => published.has(weekOf(date)));
    if (shown.length === 0) return out;
    const days = buildLocalDays(
      {
        ...base,
        feed,
        mashov: [],
        bagrut: [],
        google: [],
        manualExams: [],
        examPrefs: undefined,
        homeworkState: {},
        // My own "חופש" is not theirs, and neither are my names for subjects: their days are in the school's.
        settings: {
          ...base.settings,
          vacationMode: false,
          classId: timetable.classId,
          className: timetable.className,
          lessons: { ...base.settings.lessons, hiddenSubjects: timetable.hiddenSubjects, subjectNames: {} },
        },
      },
      shown,
    );
    for (const day of days) out.set(day.date, lessonsOfDay(day));
    return out;
  }

  // The box carries the week its sharer was in when they read Mashov, and the next one; only the
  // first when two would not fit (`lessonsTrimmed`), and none when not even one would.
  const carried = timetable.lessons;
  if (!carried) return out;
  const boxWeek = weekOf(DateTime.fromISO(content.at, { zone: base.zone }).toISODate() ?? todayStr(base.zone));
  const covered = new Set([boxWeek, ...(timetable.lessonsTrimmed ? [] : [addDays(boxWeek, 7, base.zone)]), ...carried.map((l) => weekOf(l.date))]);
  for (const date of dates) {
    if (!covered.has(weekOf(date))) continue;
    const lessons = carried.filter((l) => l.date === date).sort((a, b) => a.hourIndex - b.hourIndex);
    out.set(date, lessons.map(({ hourIndex, start, end, subject, teacher, status }) => ({ hourIndex, start, end, subject, teacher, status })));
  }
  return out;
}

const ofKind = <T>(src: LocalSources, kind: string): T[] => src.mashov.filter((e) => e.kind === kind).map((e) => e.payload as T);

/** My absence tracker over the Mashov read in `src` (as `attendanceFrom` in `local/phoneApi.ts`), for the box and my side of the page. */
export function attendanceOf(src: LocalSources, fetchedAt: string | null): AttendanceResponse {
  return buildAttendance({
    counts: ofKind<LessonCountPayload>(src, 'lesson_count'),
    events: ofKind<AttendancePayload>(src, 'attendance'),
    slots: ofKind<SlotLike>(src, 'timetable_slot'),
    settings: src.settings.attendance,
    today: todayStr(src.zone),
    zone: src.zone,
    fetchedAt,
  });
}
