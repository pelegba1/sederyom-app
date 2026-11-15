/**
 * The box a student shares with a friend, built on their own phone
 * (docs/superpowers/specs/2026-10-29-friends-design.md, 4.2).
 *
 * What goes in follows what they chose to share (`shares`), and only that:
 *
 * | Category    | Box part                                                                  |
 * |-------------|---------------------------------------------------------------------------|
 * | `timetable` | the class, what is hidden from it, the exams, and, for a school without a |
 * |             | Shahaf site, the lessons of this week and the next                        |
 * | `absences`  | each subject's count, what is allowed and how close that is: no dates     |
 *
 * The exams come from the sharer's phone, not the class feed: their hidden
 * exams, the names they gave exams and the exams they added by hand are only
 * kept there, so a friend sees exactly what they see. The lessons are the
 * timeline's, so a school's own changes and the sharer's own filter are in.
 * A name the sharer gave a subject is the exception (own names, 2026-11-05):
 * it stays on their phone, and the lessons, the exams it named and the
 * absences go under the source's names, so "פיזיקה" of mine never sits on a
 * friend's biology.
 *
 * The format only grows, since a friend's phone may run an older app: a later
 * version ADDS optional fields that an older reader can leave out, never
 * changes what a field means, and a new value of an enum (a lesson status, an
 * absence level) is read by an older phone as its plainest kind (`validate.ts`).
 * So what this version writes is `v: 1`, and so is anything added later.
 *
 * A box must fit the server's cap for a pair box once sealed: `fitBox` trims
 * one that would not, which a real box never needs.
 *
 * Pure, so the tests run it as is: the caller builds `days` and reads the
 * attendance, and gives `now`. "Today" is the date of `now` in Jerusalem, and
 * a week runs from Sunday to Saturday.
 */
import type { AttendanceResponse, BuddyAbsence, BuddyBoxContent, BuddyExam, BuddyLesson, BuddyShares, BuddyTimetable, DayView, Instant } from '@sederyom/shared';
import { BUDDY_EXAM_DAYS, BUDDY_PAIR_CIPHERTEXT_MAX } from '@sederyom/shared';
import { examSubjectKey } from '@sederyom/shared/logic/exam-match';
import { TZ, addDays, weekStart } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { standing } from '../lib/attendance';
import { sentExamTitle } from '../lib/format';
import { contentHash, sealedLength } from './crypto';
import { keptShares } from './store';

/** What `myBoxContent` is built from. */
export interface MyBoxInput {
  /** The name the friend sees for me. */
  name: string;
  shares: BuddyShares;
  /**
   * My days, from this week's Sunday through today + `BUDDY_EXAM_DAYS` (the caller builds them with
   * `buildLocalDays`, over `withSchoolDates`): the exams are taken from them, and the lessons too when there is no site.
   */
  days: readonly DayView[];
  /** The attendance as read from Mashov; `null` before the first read. */
  attendance: AttendanceResponse | null;
  /** The class's Shahaf site; `null` for a school without one. */
  siteUrl: string | null;
  classId: string;
  className: string;
  /** The class's lines that are not mine (`LessonFilter.hiddenSubjects`). */
  hiddenSubjects: readonly string[];
  /** Mashov's school id, told to friends only along with the lessons. */
  mashovSchool: string | null;
  /** The last Mashov read (`localRead(storage)?.at`): the box says when it was, not when it was written. */
  readAt: Instant | null;
  now: Date;
}

/**
 * My exams from today up to, not including, `BUDDY_EXAM_DAYS` ahead: under
 * the names I gave them (`sentExamTitle`: a subject's name is not one of
 * them), keyed by the name their source gave them, and on the date their
 * source gave them (`originalDate`): a date I set for an exam is mine alone,
 * and a friend is told the school's. The caller builds `days` over the
 * school's dates (`withSchoolDates`), so an exam I moved out of the days is
 * still among them; this reads the school's date of one that is not. Also my
 * side of the friends screens.
 */
export function examsOf(days: readonly DayView[], today: string): BuddyExam[] {
  const until = addDays(today, BUDDY_EXAM_DAYS);
  const found: BuddyExam[] = [];
  for (const day of days) {
    for (const exam of day.examsToday) {
      const date = exam.originalDate ?? exam.date;
      if (date < today || date >= until) continue;
      found.push({ date, subject: examSubjectKey(exam.originalSubject ?? exam.subject), title: sentExamTitle(exam) });
    }
  }
  return found.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

/** My lessons of the Sunday-to-Saturday week `today` is in and the next, by date and hour. */
function lessonsOf(days: readonly DayView[], today: string): BuddyLesson[] {
  const from = weekStart(today);
  const until = addDays(from, 14);
  const found: BuddyLesson[] = [];
  for (const day of days) {
    for (const item of day.timeline) {
      if (item.kind !== 'lesson') continue;
      const l = item.lesson;
      if (l.date < from || l.date >= until) continue;
      found.push({
        date: l.date, hourIndex: l.hourIndex, start: l.startTime, end: l.endTime, subject: l.originalSubject ?? l.subject, teacher: l.teacher, status: l.status,
      });
    }
  }
  return found.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.hourIndex - b.hourIndex));
}

function timetableOf(input: MyBoxInput): BuddyTimetable {
  const today = DateTime.fromJSDate(input.now, { zone: TZ }).toISODate()!;
  const timetable: BuddyTimetable = {
    siteUrl: input.siteUrl,
    classId: input.classId,
    className: input.className,
    hiddenSubjects: [...input.hiddenSubjects],
    exams: examsOf(input.days, today),
  };
  if (input.siteUrl === null) {
    timetable.lessons = lessonsOf(input.days, today);
    timetable.mashovSchool = input.mashovSchool;
  }
  return timetable;
}

/**
 * Each subject as `standing` sees it by my own limit and my own count of
 * lates; no events, so no dates. Also my side of a friend's absences. By
 * Mashov's name (`originalSubject`), never one I gave the subject.
 */
export function absencesOf(attendance: AttendanceResponse): NonNullable<BuddyBoxContent['absences']> {
  const subjects = attendance.subjects.map((s): BuddyAbsence => {
    const st = standing(s, attendance.limit, attendance.latesPerAbsence);
    return { subject: s.originalSubject ?? s.subject, counted: st.counted, allowed: st.allowed, level: st.level };
  });
  return { semesterStart: attendance.semesterStart, semesterEnd: attendance.semesterEnd, subjects };
}

/**
 * The box for one friend: `timetable` only when it is shared, `absences` only
 * when it is shared and the attendance has been read. `at` is the Mashov
 * read's time (`readAt`), else `now`, so "updated N ago" says when this phone
 * last read Mashov (4.2).
 *
 * `shares` says what I share, the grades switches with it (`keptShares`):
 * once a friend's phone has read this box it goes by it, so a friend learns
 * here that I turned grades (or the bagrut) on, before any grade is sent
 * (grades spec 4.1). They are written only when on, so the box of a friend
 * with grades off is the same as before grades, and its hash too.
 */
export function myBoxContent(input: MyBoxInput): BuddyBoxContent {
  const content: BuddyBoxContent = { v: 1, at: input.readAt ?? input.now.toISOString(), name: input.name, shares: keptShares(input.shares) };
  if (input.shares.timetable) content.timetable = timetableOf(input);
  if (input.shares.absences && input.attendance) content.absences = absencesOf(input.attendance);
  return content;
}

/**
 * `content` as it fits a pair box once sealed (`BUDDY_PAIR_CIPHERTEXT_MAX`;
 * the server refuses a box over it): whole, as a real box is; else with the
 * lessons of the week `now` is in only (`lessonsTrimmed`, so its friend knows
 * the next week is not in it); else with no lessons at all. `null` when not
 * even that fits.
 */
export function fitBox(content: BuddyBoxContent, now: Date): BuddyBoxContent | null {
  const fits = (box: BuddyBoxContent) => sealedLength(box) <= BUDDY_PAIR_CIPHERTEXT_MAX;
  if (fits(content)) return content;
  const timetable = content.timetable;
  if (!timetable?.lessons) return null;
  const nextWeek = addDays(weekStart(DateTime.fromJSDate(now, { zone: TZ }).toISODate()!), 7);
  const thisWeek: BuddyBoxContent = {
    ...content,
    timetable: { ...timetable, lessons: timetable.lessons.filter((l) => l.date < nextWeek), lessonsTrimmed: true },
  };
  if (fits(thisWeek)) return thisWeek;
  const { lessons: _lessons, lessonsTrimmed: _trimmed, ...noLessons } = timetable;
  const bare: BuddyBoxContent = { ...content, timetable: noLessons };
  return fits(bare) ? bare : null;
}

/** A fingerprint of the box without its `at`: equal while nothing a friend sees has changed, so the write can be skipped (4.2). */
export function boxHash(content: BuddyBoxContent): string {
  const { at: _at, ...rest } = content;
  return contentHash(rest);
}
