/**
 * The copy of a student's school day that a chat reads
 * (docs/superpowers/specs/2026-11-04-chat-connection-design.md, 4.2): the
 * phone builds it after each read, seals it (`sealChat`) and puts it on the
 * server, which only ever opens it while it answers a chat that holds the key.
 * The server builds it too, over the made-up student, for the reviewers' demo.
 *
 * What goes in follows what the student shares (`ChatShares`), and only that:
 *
 * | Part       | When          | What                                                                    |
 * |------------|---------------|-------------------------------------------------------------------------|
 * | `days`     | always        | yesterday through today + 13: the lessons of the timeline, the exams    |
 * |            |               | and the school's events of the day                                      |
 * | `exams`    | always        | from today to the semester's end, under the student's names, less those |
 * |            |               | they hid, with those they added                                         |
 * | `homework` | `homework`    | the open items, and those due in the last 7 days, with `done`           |
 * | `grades`   | `grades`      | this school year's (from 1 September)                                   |
 * | `averages` | `grades`      | each subject's, by the student's weights, over the whole year (no trim) |
 * | `bagrut`   | `bagrut`      | as the bagrut screen has them                                           |
 * | `absences` | `absences`    | each subject's count, allowance and level (`standing`): no dates        |
 * | `messages` | `messages`    | the newest 50, each body cut to 2,000 characters                        |
 *
 * A part whose share is off is not a key of the snapshot, not an empty one.
 *
 * Nothing from Google is in it, whatever the student has connected: not a
 * calendar event, not a task, not a switch for them, and not the id of the
 * Google Task a homework item was made into (`linkedTaskId`). Google's Workspace
 * data policy forbids using Google user data to develop, improve or train AI
 * models, and the app's Google verification covers on-phone use only, so what the
 * phone reads from Google stays on the phone (the timeline's events and tasks are
 * left out of `days`, and `localOpenTasks` is not read). A copy that carries any
 * (a development build from before 2026-11-05) is read without it (`readChatSnapshot`).
 *
 * The same builders as the screens give each part (`local/schoolFeeds.ts`,
 * `local/days.ts`), so a chat reads what the student sees. What the phone keeps
 * on the side comes in as `feeds`: when it first saw each grade, and when it
 * last read Mashov.
 *
 * Every snapshot is made here, with its keys in one order, since `chatHash`
 * hashes them in the order they were written: the phone skips a write when
 * the hash is the same as the last one's.
 *
 * The format only grows, as the friends' box does: a later version ADDS optional
 * fields, never changes what a field means, and a value of an enum this version
 * does not know (a lesson status, an absence level) is read as its plainest
 * kind. So a snapshot with `v` above 1 is read as version 1 (`readChatSnapshot`).
 *
 * Pure, so the server can load it with no phone: no storage, no config, no
 * native modules, directly or through what it imports (the purity test in
 * server/test/chat-school-feeds.test.ts walks it).
 */
import type {
  BagrutExam, ChatAbsence, ChatAverage, ChatDay, ChatHomeworkItem, ChatMessage, ChatShares, ChatSnapshot, ChatTrimmed, DateStr, DayView, Exam, Grade,
  Instant, Lesson, LessonStatus, SchoolEvent, Source,
} from '@sederyom/shared';
import {
  CHAT_DAYS_AHEAD, CHAT_DAYS_BACK, CHAT_MESSAGES_MAX, CHAT_MESSAGE_BODY_MAX, CHAT_SNAPSHOT_JSON_MAX, LESSON_STATUSES, SOURCES, currentSemester,
} from '@sederyom/shared';
import { filterExams } from '@sederyom/shared/logic/filters';
import { mergeSettings } from '@sederyom/shared/logic/options';
import { addDays, todayStr } from '@sederyom/shared/logic/time';
import { standing } from '../lib/attendance';
import { EMPTY_WEIGHTS, type GradeWeightsPrefs } from '../lib/gradeWeights';
import { groupGradesBySubject } from '../lib/school';
import { buildLocalDays, localExamsFrom, type LocalSources } from '../local/days';
import { attendanceFrom, gradesOf, homeworkOf, messagesOf } from '../local/schoolFeeds';
import type { FirstSeen } from '../mashov/gradeFirstSeen';

/** What the phone keeps on the side of the sources (`phoneApi.ts` passes both to the screens). */
export interface ChatFeeds {
  /** When the phone first saw each grade (`mashov/gradeFirstSeen.ts`): the grades tab's "חדש". */
  firstSeen?: FirstSeen | null;
  /** When the phone last read Mashov: the date of a message Mashov gave none (`messagesOf`). */
  readAt?: string;
  /** The student's grade weights (`gradeWeightsStore.ts`): the averages go by them. None, or `null`, is the default types, as the grades tab shows before anything is set. */
  weights?: GradeWeightsPrefs | null;
}

/** Homework that is done stays this long after it was due: "did I do Tuesday's?" is a question. */
const HOMEWORK_DONE_DAYS = 7;
/** A grade older than this goes first when the snapshot is too big (`fitChatSnapshot`). */
const OLD_GRADE_DAYS = 90;
/** The days kept past today when the snapshot is too big: today + 1 through today + 7. */
const LATER_DAYS_KEPT = 7;

/** A day as a chat reads it: the lessons of its timeline, and nothing else the timeline holds (its events and tasks are Google's). */
function chatDay(day: DayView): ChatDay {
  return {
    date: day.date,
    weekdayName: day.weekdayName,
    isSchoolDay: day.isSchoolDay,
    holidayName: day.holidayName,
    projected: day.projected,
    lessons: day.timeline.flatMap((item) => (item.kind === 'lesson' ? [item.lesson] : [])),
    examsToday: day.examsToday,
    events: day.events,
  };
}

/** The exams from `today` to the end of the semester it is in, as "המבחנים שלי" has them: under the student's names, less those they hid. */
function examsOf(src: LocalSources, today: DateStr): Exam[] {
  const until = currentSemester(today).semesterEnd;
  return filterExams(localExamsFrom(src, today, today), src.settings).filter((e) => e.date <= until);
}

/**
 * The open homework, and what was due in the last 7 days (a week ago through today) whether it is done or not.
 * A done item due later than today is neither, and is left out.
 */
function homeworkIn(src: LocalSources, today: DateStr): ChatHomeworkItem[] {
  const from = addDays(today, -HOMEWORK_DONE_DAYS, src.zone);
  return homeworkOf(src)
    .filter((h) => !h.done || (h.dueDate !== null && h.dueDate >= from && h.dueDate <= today))
    .map(({ naturalKey, dueDate, subject, text, done }): ChatHomeworkItem => ({ naturalKey, dueDate, subject, text, done }));
}

/** The grades of the school year `today` is in, which began on 1 September (January to August: the September before). */
function gradesIn(src: LocalSources, today: DateStr, firstSeen: FirstSeen | null): Grade[] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const from = `${month >= 9 ? year : year - 1}-09-01`;
  return gradesOf(src, firstSeen).filter((g) => g.date >= from);
}

/**
 * Each subject's average as the grades tab has it (`groupGradesBySubject`), by the student's own weights, to one decimal.
 * Over all of `grades`, the year's, so it is made before any trim cuts the old ones. A subject with no numeric grade has
 * none. `uncounted` (grades that sit in a type at 0%) is there only when it is more than none.
 */
function averagesIn(grades: Grade[], weights: GradeWeightsPrefs): ChatAverage[] {
  return groupGradesBySubject(grades, weights).flatMap((group): ChatAverage[] => {
    if (group.average === null) return [];
    const average: ChatAverage = { subject: group.subject, average: Math.round(group.average.value * 10) / 10 };
    if (group.average.uncounted > 0) average.uncounted = group.average.uncounted;
    return [average];
  });
}

/**
 * Each subject as `standing` sees it, by the student's own limit; as the friends' box has it (`buddies/content.ts`).
 * The semester the tracker counts is the one `today` is in: the phone's settings have it filled in already
 * (`mergeSettings`), the demo's do not, and without it no absence falls inside the semester.
 */
function absencesIn(src: LocalSources, today: DateStr, at: Instant): ChatAbsence[] {
  const attendance = attendanceFrom({ ...src, settings: mergeSettings(src.settings, today) }, at);
  return attendance.subjects.map((s): ChatAbsence => {
    const st = standing(s, attendance.limit, attendance.latesPerAbsence);
    return { subject: s.subject, counted: st.counted, allowed: st.allowed, level: st.level };
  });
}

/** `text` cut to `max` characters, counted as characters and not as UTF-16 units, so no emoji is left in half. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : Array.from(text).slice(0, max).join('');
}

function messagesIn(src: LocalSources, readAt: string | undefined): ChatMessage[] {
  return messagesOf(src, readAt)
    .slice(0, CHAT_MESSAGES_MAX)
    .map((m): ChatMessage => ({ date: m.date, from: m.from, title: m.title, body: cut(m.body, CHAT_MESSAGE_BODY_MAX) }));
}

/**
 * The snapshot of `src` for a chat that may read `shares`, as of the Mashov
 * read at `at`. "Today" is the clock's date in the sources' zone (`todayStr`),
 * the one `buildLocalDays` and the tracker go by.
 */
export function buildChatSnapshot(src: LocalSources, shares: ChatShares, school: ChatSnapshot['school'], at: Instant, feeds: ChatFeeds = {}): ChatSnapshot {
  const { zone } = src;
  const today = todayStr(zone);
  const dates = Array.from({ length: CHAT_DAYS_BACK + 1 + CHAT_DAYS_AHEAD }, (_v, i) => addDays(today, i - CHAT_DAYS_BACK, zone));
  const snapshot: ChatSnapshot = {
    v: 1,
    at,
    shares: { homework: shares.homework, grades: shares.grades, bagrut: shares.bagrut, absences: shares.absences, messages: shares.messages },
    school: { name: school.name, className: school.className },
    days: buildLocalDays(src, dates).map(chatDay),
    exams: examsOf(src, today),
    trimmed: [],
  };
  if (shares.homework) snapshot.homework = homeworkIn(src, today);
  if (shares.grades) {
    snapshot.grades = gradesIn(src, today, feeds.firstSeen ?? null);
    // Right after `grades`: the keys are hashed in the order they are written.
    snapshot.averages = averagesIn(snapshot.grades, feeds.weights ?? EMPTY_WEIGHTS);
  }
  if (shares.bagrut) snapshot.bagrut = [...src.bagrut];
  if (shares.absences) snapshot.absences = absencesIn(src, today, at);
  if (shares.messages) snapshot.messages = messagesIn(src, feeds.readAt);
  return snapshot;
}

/** The size the snapshot is sealed at: its JSON in bytes, which a Hebrew letter makes two of. */
const sizeOf = (snapshot: ChatSnapshot): number => new TextEncoder().encode(JSON.stringify(snapshot)).length;

/** The date the snapshot calls today: the day after yesterday's; else the day of `at`. */
const todayOf = (s: ChatSnapshot): DateStr => s.days[CHAT_DAYS_BACK]?.date ?? new Date(s.at).toISOString().slice(0, 10);

/**
 * What `fitChatSnapshot` cuts, in the order it cuts it. Each gives the snapshot
 * with that part cut, or `null` when there is nothing in it to cut. They spread
 * over the snapshot, so every key stays where it was.
 */
const TRIMS: readonly [ChatTrimmed, (s: ChatSnapshot) => ChatSnapshot | null][] = [
  ['messageBodies', (s) => (s.messages?.some((m) => m.body !== '') ? { ...s, messages: s.messages.map((m) => ({ ...m, body: '' })) } : null)],
  [
    'laterDays',
    (s) => {
      const last = addDays(todayOf(s), LATER_DAYS_KEPT);
      return s.days.some((d) => d.date > last) ? { ...s, days: s.days.filter((d) => d.date <= last) } : null;
    },
  ],
  [
    'oldGrades',
    (s) => {
      const first = addDays(todayOf(s), -OLD_GRADE_DAYS);
      return s.grades?.some((g) => g.date < first) ? { ...s, grades: s.grades.filter((g) => g.date >= first) } : null;
    },
  ],
];

/**
 * `snapshot` as it fits once sealed (`CHAT_SNAPSHOT_JSON_MAX`; the server
 * refuses one over its cap): whole, as a real one is, or else cut in the
 * order the spec gives, until it fits: the message bodies, then the days after
 * today + 7, then the grades older than 90 days. What was cut is in `trimmed`,
 * so a chat can say it does not have it. Only what there was to cut is marked.
 *
 * A snapshot that is too big for all three is returned as far as they got:
 * nothing else is cut (a real one, with 50 messages, never needs them), and the
 * caller sees the size.
 */
export function fitChatSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
  if (sizeOf(snapshot) <= CHAT_SNAPSHOT_JSON_MAX) return snapshot;
  let fit = snapshot;
  for (const [what, trim] of TRIMS) {
    const trimmed = trim(fit);
    if (trimmed === null) continue;
    fit = { ...trimmed, trimmed: fit.trimmed.includes(what) ? fit.trimmed : [...fit.trimmed, what] };
    if (sizeOf(fit) <= CHAT_SNAPSHOT_JSON_MAX) break;
  }
  return fit;
}

// ---- Reading --------------------------------------------------------------------------------------------------

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
/** `YYYY-MM-DD`, as every date in a snapshot is written. */
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** A time a date reads from, as `Instant`s are written. */
const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
/** `HH:mm`: the shape only, as the Mashov reader leaves it, not a range. */
const isTime = (value: unknown): value is string => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
/** Version 1 or later: a later one only adds fields. */
const isVersion = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 1;

/** A field that may be `null`: `null` and a field left out (a writer that dropped it) both count as `null`, and are read with `?? null`. */
const orNull =
  <T>(is: (value: unknown) => value is T) =>
  (value: unknown): value is T | null | undefined =>
    value === undefined || value === null || is(value);
const textOrNull = orNull(isText);
const numberOrNull = orNull(isNumber);
const dateOrNull = orNull(isDate);
const instantOrNull = orNull(isInstant);
const timeOrNull = orNull(isTime);

/** A status this version knows; any other is a later version's, read as a plain lesson. */
const statusOf = (value: unknown): LessonStatus => ((LESSON_STATUSES as readonly unknown[]).includes(value) ? (value as LessonStatus) : 'regular');
/** A source this version knows; any other is read as the school's own data. */
const sourceOf = (value: unknown): Source => ((SOURCES as readonly unknown[]).includes(value) ? (value as Source) : 'mashov');
/** A level this version knows; any other is read as nothing to warn of. */
const levelOf = (value: unknown): ChatAbsence['level'] => (value === 'close' || value === 'over' ? value : 'ok');
const methodOf = (value: unknown): BagrutExam['method'] => (value === 'external' || value === 'school' ? value : null);

/** Each item through `read`, those that read; `null` when `value` is no list at all. */
function itemsOf<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(read).filter((item): item is T => item !== null);
}

/** An optional part: absent (or `null`, or no list) when it does not read as a list; the items that read otherwise. */
function partOf<T>(value: unknown, read: (item: unknown) => T | null): T[] | undefined {
  return itemsOf(value, read) ?? undefined;
}

function lessonOf(value: unknown): Lesson | null {
  if (!isRecord(value) || !isDate(value.date) || !isNumber(value.hourIndex) || !isText(value.subject)) return null;
  if (!timeOrNull(value.startTime) || !timeOrNull(value.endTime) || !textOrNull(value.teacher) || !textOrNull(value.room)) return null;
  if (!textOrNull(value.substitute) || !textOrNull(value.note) || !instantOrNull(value.changeSeenAt)) return null;
  const lesson: Lesson = {
    date: value.date,
    hourIndex: value.hourIndex,
    startTime: value.startTime ?? null,
    endTime: value.endTime ?? null,
    subject: value.subject,
    teacher: value.teacher ?? null,
    room: value.room ?? null,
    status: statusOf(value.status),
    substitute: value.substitute ?? null,
    note: value.note ?? null,
    source: sourceOf(value.source),
    changeSeenAt: value.changeSeenAt ?? null,
  };
  // A subject the student renamed: the day card finds its exam by the name the school gave it.
  if (isText(value.originalSubject)) lesson.originalSubject = value.originalSubject;
  return lesson;
}

function examOf(value: unknown): Exam | null {
  if (!isRecord(value) || !isText(value.naturalKey) || !isDate(value.date) || !isText(value.subject) || !textOrNull(value.details)) return null;
  const exam: Exam = { naturalKey: value.naturalKey, date: value.date, subject: value.subject, details: value.details ?? null, source: sourceOf(value.source) };
  // The optional fields: one of the wrong kind is left out, not held against the exam.
  if (value.kind === 'bagrut' || value.kind === 'manual') exam.kind = value.kind;
  if (value.startTime === null || isTime(value.startTime)) exam.startTime = value.startTime;
  if (value.endTime === null || isTime(value.endTime)) exam.endTime = value.endTime;
  if (isText(value.originalSubject)) exam.originalSubject = value.originalSubject;
  return exam;
}

function schoolEventOf(value: unknown): SchoolEvent | null {
  if (!isRecord(value) || !isText(value.naturalKey) || !isDate(value.date) || !isText(value.title) || !textOrNull(value.details)) return null;
  return { naturalKey: value.naturalKey, date: value.date, title: value.title, details: value.details ?? null, source: sourceOf(value.source) };
}

/**
 * A day, or `null` when its own fields or any of its lists do not read as what they are (a lesson of it that does not is only dropped).
 * A `calendar` on it (Google events from a development build from before 2026-11-05) is not read: nothing from Google is in what a chat is told.
 */
function dayOf(value: unknown): ChatDay | null {
  if (!isRecord(value) || !isDate(value.date) || !isText(value.weekdayName) || !isBool(value.isSchoolDay) || !textOrNull(value.holidayName) || !isBool(value.projected)) {
    return null;
  }
  const lessons = itemsOf(value.lessons, lessonOf);
  const examsToday = itemsOf(value.examsToday, examOf);
  const events = itemsOf(value.events, schoolEventOf);
  if (!lessons || !examsToday || !events) return null;
  return {
    date: value.date, weekdayName: value.weekdayName, isSchoolDay: value.isSchoolDay, holidayName: value.holidayName ?? null, projected: value.projected,
    lessons, examsToday, events,
  };
}

/** A homework item; its `linkedTaskId` (a Google Task id, in a copy from a development build from before 2026-11-05) is not read, of whatever kind it is. */
function homeworkItemOf(value: unknown): ChatHomeworkItem | null {
  if (!isRecord(value) || !isText(value.naturalKey) || !dateOrNull(value.dueDate) || !isText(value.subject) || !isText(value.text) || !isBool(value.done)) return null;
  return { naturalKey: value.naturalKey, dueDate: value.dueDate ?? null, subject: value.subject, text: value.text, done: value.done };
}

function gradeOf(value: unknown): Grade | null {
  if (!isRecord(value) || !isText(value.naturalKey) || !isDate(value.date) || !isText(value.subject)) return null;
  if (!numberOrNull(value.value) || !textOrNull(value.valueText) || !numberOrNull(value.weight) || !textOrNull(value.notes) || !instantOrNull(value.firstSeen)) return null;
  return {
    naturalKey: value.naturalKey, date: value.date, subject: value.subject, value: value.value ?? null, valueText: value.valueText ?? null,
    weight: value.weight ?? null, notes: value.notes ?? null, firstSeen: value.firstSeen ?? null,
  };
}

/** An average: a named subject and a number; an `uncounted` that is no count is left out, not held against the entry. */
function averageOf(value: unknown): ChatAverage | null {
  if (!isRecord(value) || !isText(value.subject) || value.subject.trim() === '' || !isNumber(value.average)) return null;
  const average: ChatAverage = { subject: value.subject, average: value.average };
  if (isNumber(value.uncounted) && Number.isInteger(value.uncounted) && value.uncounted >= 0) average.uncounted = value.uncounted;
  return average;
}

function bagrutOf(value: unknown): BagrutExam | null {
  if (!isRecord(value) || !isText(value.naturalKey) || !isNumber(value.semel) || !isText(value.name) || !isText(value.moed) || !isBool(value.registered)) return null;
  if (!numberOrNull(value.schoolGrade) || !numberOrNull(value.examGrade) || !numberOrNull(value.finalGrade) || !numberOrNull(value.acceptedGrade)) return null;
  if (!dateOrNull(value.examDate) || !timeOrNull(value.startTime) || !timeOrNull(value.endTime)) return null;
  return {
    naturalKey: value.naturalKey, semel: value.semel, name: value.name, moed: value.moed, method: methodOf(value.method),
    schoolGrade: value.schoolGrade ?? null, examGrade: value.examGrade ?? null, finalGrade: value.finalGrade ?? null, acceptedGrade: value.acceptedGrade ?? null,
    registered: value.registered, examDate: value.examDate ?? null, startTime: value.startTime ?? null, endTime: value.endTime ?? null,
  };
}

function absenceOf(value: unknown): ChatAbsence | null {
  if (!isRecord(value) || !isText(value.subject) || !isNumber(value.counted) || !isNumber(value.allowed)) return null;
  return { subject: value.subject, counted: value.counted, allowed: value.allowed, level: levelOf(value.level) };
}

function messageOf(value: unknown): ChatMessage | null {
  if (!isRecord(value) || !isInstant(value.date) || !textOrNull(value.from) || !isText(value.title) || !isText(value.body)) return null;
  return { date: value.date, from: value.from ?? null, title: value.title, body: value.body };
}

/**
 * The five switches: all or nothing, since they are what a chat may be shown (the shares gate every part). A copy from
 * a development build from before 2026-11-05 has a sixth, for Google; it is read past, with or without it, and never handed on.
 */
function sharesOf(value: unknown): ChatShares | null {
  if (!isRecord(value)) return null;
  const { homework, grades, bagrut, absences, messages } = value;
  if (!isBool(homework) || !isBool(grades) || !isBool(bagrut) || !isBool(absences) || !isBool(messages)) return null;
  return { homework, grades, bagrut, absences, messages };
}

const TRIMMED: readonly unknown[] = TRIMS.map(([what]) => what);

/**
 * A snapshot as the server's reader gets it (`buildChatSnapshot` writes it, JSON
 * carries it), read as the header says. Nothing in what a phone wrote can be
 * trusted to be what this version wrote: the phone may run another version, and
 * a chat's answer is built from it. So the guards take it as `unknown`, and give
 * back the snapshot with the fields this version knows, each of its documented
 * type and nothing else; or `null` when it is no snapshot.
 *
 * How much one mistake costs. `v`, `at` and `shares` are all or nothing: without
 * them nothing in it can be trusted. Below them each item is read on its own: a
 * day, a lesson, an exam, a grade or a message that does not read is dropped
 * and its neighbours kept; an optional part that is no list is left out; the
 * school, if it does not read, is nothing known. An enum value this version
 * does not know is read as its plainest kind (`statusOf`, `levelOf`); a field of
 * the wrong kind makes its item not read. A message's text is kept as it is:
 * it is not a name, and holds line breaks.
 *
 * Which parts are there is not held against `shares`: whoever answers goes by `shares`.
 */
export function readChatSnapshot(value: unknown): ChatSnapshot | null {
  if (!isRecord(value) || !isVersion(value.v) || !isInstant(value.at)) return null;
  const shares = sharesOf(value.shares);
  if (!shares) return null;
  const school = isRecord(value.school) ? value.school : {};
  const snapshot: ChatSnapshot = {
    v: 1,
    at: value.at,
    shares,
    school: { name: isText(school.name) ? school.name : null, className: isText(school.className) ? school.className : null },
    days: itemsOf(value.days, dayOf) ?? [],
    exams: itemsOf(value.exams, examOf) ?? [],
    trimmed: Array.isArray(value.trimmed) ? value.trimmed.filter((t): t is ChatTrimmed => TRIMMED.includes(t)) : [],
  };
  const homework = partOf(value.homework, homeworkItemOf);
  if (homework) snapshot.homework = homework;
  const grades = partOf(value.grades, gradeOf);
  if (grades) snapshot.grades = grades;
  // Right after the grades, as the builder writes it; a copy from a phone that sends none has none.
  const averages = partOf(value.averages, averageOf);
  if (averages) snapshot.averages = averages;
  const bagrut = partOf(value.bagrut, bagrutOf);
  if (bagrut) snapshot.bagrut = bagrut;
  const absences = partOf(value.absences, absenceOf);
  if (absences) snapshot.absences = absences;
  const messages = partOf(value.messages, messageOf);
  if (messages) snapshot.messages = messages;
  // No `tasks` and no Google events: see the header.
  return snapshot;
}
