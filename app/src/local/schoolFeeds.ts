/**
 * The school's feeds, built from `LocalSources`: grades, homework and messages
 * as the "בית ספר" tab shows them, and the absence tracker over the same Mashov
 * read. `local/phoneApi.ts` answers the screens with them, and the chat
 * connection's snapshot (`shared/src/chat.ts`) is built from the same ones, so
 * a chat reads what the student sees.
 *
 * Pure, so the server can run it over the demo's sources: no storage, no
 * config, nothing that needs a phone. What the phone keeps on the side comes in
 * as an argument: when it first saw each grade, and when it last read Mashov.
 * The zone is the sources' own (`src.zone`).
 *
 * Grades, homework and absences come under the student's names for subjects
 * (`subjectNames.ts`), Mashov's kept in `originalSubject`: after everything
 * that sorts and hides them by Mashov's names.
 */
import type { AttendanceResponse, Grade, HomeworkItem, SchoolMessage } from '@sederyom/shared';
import { buildAttendance, type SlotLike } from '@sederyom/shared/logic/attendance';
import { filterHiddenHomework } from '@sederyom/shared/logic/filters';
import type { AttendancePayload, LessonCountPayload } from '@sederyom/shared/logic/mashov/attendance';
import type { MashovGrade } from '@sederyom/shared/logic/mashov/normalize';
import type { MashovMessage } from '@sederyom/shared/logic/mashov/messages';
import { todayStr } from '@sederyom/shared/logic/time';
import { withFirstSeen, type FirstSeen } from '../mashov/gradeFirstSeen';
import { localHomework, localTimetableLines, type LocalSources } from './days';
import { namedAttendanceSubject, namedGrade, namedHomework, namesOfSources } from './subjectNames';

const ofKind = <T>(list: readonly { kind: string; payload: unknown }[], kind: string): T[] =>
  list.filter((e) => e.kind === kind).map((e) => e.payload as T);

/**
 * The Mashov messages, newest first. A message Mashov gave no date to is dated
 * `readAt`, the read that brought it (the phone's last read; the moment of the
 * sources when none is passed).
 */
export function messagesOf(src: LocalSources, readAt: string = src.now.toISOString()): SchoolMessage[] {
  return src.mashov
    .filter((e) => e.kind === 'message')
    .map((e) => {
      const m = e.payload as MashovMessage;
      const sent = m.date ? new Date(m.date) : null;
      const dated = sent !== null && !Number.isNaN(sent.getTime());
      return {
        naturalKey: e.naturalKey,
        source: 'mashov' as const,
        date: dated ? sent.toISOString() : readAt,
        title: m.title,
        body: m.body,
        from: m.from,
        dateIsFirstSeen: !dated,
        bodyPending: m.bodyFor === null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 200);
}

/**
 * The Mashov grades, newest first, with when the phone first saw each one
 * (`mashov/gradeFirstSeen.ts`, the grades tab's "חדש"); `firstSeen` is `null`
 * for all of them without that map.
 */
export function gradesOf(src: LocalSources, firstSeen: FirstSeen | null = null): Grade[] {
  const plain = ofKind<MashovGrade>(src.mashov, 'grade').map(({ isExam: _isExam, ...g }) => g);
  const grades = withFirstSeen(plain, firstSeen)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 200);
  const names = namesOfSources(src);
  return names === null ? grades : grades.map((grade) => namedGrade(grade, names));
}

/** The homework, soonest due first, without the subjects the student hides, under the student's names for them. */
export function homeworkOf(src: LocalSources): HomeworkItem[] {
  const due = (d: string | null) => d ?? '9999-12-31';
  const items = localHomework(src).sort((a, b) => due(a.dueDate).localeCompare(due(b.dueDate)) || a.naturalKey.localeCompare(b.naturalKey));
  // Hidden by Mashov's names, then named.
  const kept = src.settings.lessons.hiddenSubjects.length === 0 ? items : filterHiddenHomework(items, src.settings, localTimetableLines(src));
  const names = namesOfSources(src);
  return names === null ? kept : kept.map((item) => namedHomework(item, names));
}

/** The absence tracker over `src`'s Mashov read, read at `fetchedAt`, each subject under the student's name for it. */
export function attendanceFrom(src: LocalSources, fetchedAt: string | null): AttendanceResponse {
  const attendance = buildAttendance({
    counts: ofKind<LessonCountPayload>(src.mashov, 'lesson_count'),
    events: ofKind<AttendancePayload>(src.mashov, 'attendance'),
    slots: ofKind<SlotLike>(src.mashov, 'timetable_slot'),
    settings: src.settings.attendance,
    today: todayStr(src.zone),
    zone: src.zone,
    fetchedAt,
  });
  const names = namesOfSources(src);
  return names === null ? attendance : { ...attendance, subjects: attendance.subjects.map((s) => namedAttendanceSubject(s, names)) };
}
