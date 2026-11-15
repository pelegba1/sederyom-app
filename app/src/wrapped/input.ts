/**
 * What the year in review is calculated from (`shared/logic/wrapped`), taken
 * from what the phone already holds: the class history it keeps, Mashov's
 * entities, the tasks, the homework ticks and the student's settings. Nothing
 * is read from the network here.
 */
import { DateTime } from 'luxon';
import type { ClassHistory } from '@sederyom/shared';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';
import type { AttendancePayload, LessonCountPayload } from '@sederyom/shared/logic/mashov/attendance';
import type { MashovGrade } from '@sederyom/shared/logic/mashov/normalize';
import { toDateStr } from '@sederyom/shared/logic/time';
import type { WrappedInput } from '@sederyom/shared/logic/wrapped/index';
import type { LocalSources } from '../local/days';

const ofKind = <T>(list: readonly { kind: string; payload: unknown }[], kind: string): T[] =>
  list.filter((e) => e.kind === kind).map((e) => e.payload as T);

export function wrappedInput(src: LocalSources, history: ClassHistory | null): WrappedInput {
  const homeworkSubject = new Map(
    src.mashov.filter((e) => e.kind === 'homework').map((e) => [e.naturalKey, (e.payload as { subject?: string | null }).subject ?? null]),
  );
  const homework: WrappedInput['homework'][number][] = [];
  for (const [key, state] of Object.entries(src.homeworkState ?? {})) {
    // A tick from before the moment was kept has no day to be counted on.
    if (state.done && state.doneAt) homework.push({ subject: homeworkSubject.get(key) ?? null, doneAt: state.doneAt });
  }
  return {
    today: toDateStr(DateTime.fromJSDate(src.now).setZone(src.zone)),
    zone: src.zone,
    history,
    hiddenSubjects: src.settings.lessons.hiddenSubjects,
    subjectNames: src.settings.lessons.subjectNames ?? {},
    examNames: src.examPrefs?.renames ?? {},
    hiddenExamKeys: src.settings.exams.hiddenKeys,
    ownDaysOff: src.settings.attendance.daysOff,
    manualExams: (src.manualExams ?? []).map(({ naturalKey, date, subject }) => ({ naturalKey, date, subject })),
    mashov: src.mashov.length === 0 ? null : {
      counts: ofKind<LessonCountPayload>(src.mashov, 'lesson_count'),
      attendance: ofKind<AttendancePayload>(src.mashov, 'attendance'),
      grades: ofKind<MashovGrade>(src.mashov, 'grade'),
    },
    tasks: ofKind<NormalizedTask>(src.google, 'task'),
    homework,
  };
}
