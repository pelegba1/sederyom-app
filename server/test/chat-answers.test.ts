/**
 * What a chat reads (server/src/chat/answers.ts): a student's snapshot told in
 * Hebrew, one answer per read tool. Built over the made-up student at a fixed
 * clock, so the lines these tests pin are the demo's.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ChatShares, type ChatSnapshot } from '@sederyom/shared';
import {
  CANNOT_OPEN, NOT_APPROVED, NOT_SHARED, NO_COPY, absencesAnswer, bagrutAnswer, dayAnswer, examsAnswer, gradesAnswer, homeworkAnswer, messagesAnswer,
  statusAnswer, weekAnswer,
} from '../src/chat/answers.js';

const ZONE = 'Asia/Jerusalem';
/** 01:30 on Thursday 5.11.2026 in Jerusalem, and still the 4th in UTC (Review Focus 2). */
const NOW = new Date('2026-11-04T23:30:00Z');
const TODAY = '2026-11-05';
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

const { demoData, demoSettings, DEMO_SUBSTITUTE } = await import('../../app/src/demo/data');
const { demoSourcesFrom } = await import('../../app/src/demo/sources');
const { buildChatSnapshot } = await import('../../app/src/chat/snapshot');

const ALL: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };
const NONE: ChatShares = { homework: false, grades: false, bagrut: false, absences: false, messages: false };
/** The demo student's copy: its days from `from`, written at `at`. */
const build = (shares: ChatShares = ALL, at: Date = NOW, from: Date = NOW): ChatSnapshot =>
  buildChatSnapshot(
    demoSourcesFrom(demoData(from, ZONE), demoSettings(DEFAULT_SETTINGS), from, ZONE),
    shares,
    { name: 'בית ספר להדגמה', className: 'יא2' },
    at.toISOString(),
  );
const S = build();
/** A grade as a chat gets it: without the app's bookkeeping. */
const bare = ({ naturalKey: _key, firstSeen: _seen, ...grade }: NonNullable<ChatSnapshot['grades']>[number]) => grade;
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const lines = (text: string) => text.split('\n');
/** `5.11` for `2026-11-05`. */
const dm = (date: string) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;

describe('dayAnswer', () => {
  it("takes today in the student's zone, not UTC's", () => {
    expect(dayAnswer(S, undefined, NOW, ZONE).structured.date).toBe(TODAY);
  });

  it('starts with the weekday and the date, and ends with when the copy was made', () => {
    const { text } = dayAnswer(S, TODAY, NOW, ZONE);
    expect(lines(text)[0]).toBe(`יום חמישי ${dm(TODAY)}`);
    expect(lines(text).at(-1)).toBe('עודכן יום חמישי 5.11 בשעה 01:30');
  });

  it('writes a lesson as its period and subject, with the teacher and room it has', () => {
    const day = S.days.find((d) => d.lessons.some((l) => l.status === 'regular' && l.teacher && l.room))!;
    const lesson = day.lessons.find((l) => l.status === 'regular' && l.teacher && l.room)!;
    expect(lines(dayAnswer(S, day.date, NOW, ZONE).text)).toContain(`${lesson.hourIndex} ${lesson.subject} (${lesson.teacher}, ${lesson.room})`);
  });

  it('marks a cancelled lesson', () => {
    const day = S.days.find((d) => d.lessons.some((l) => l.status === 'cancelled'))!;
    const lesson = day.lessons.find((l) => l.status === 'cancelled')!;
    const line = lines(dayAnswer(S, day.date, NOW, ZONE).text).find((l) => l.startsWith(`${lesson.hourIndex} ${lesson.subject}`))!;
    expect(line.endsWith(' — בוטל')).toBe(true);
  });

  it('names the substitute', () => {
    const day = S.days.find((d) => d.lessons.some((l) => l.status === 'substitution'))!;
    const lesson = day.lessons.find((l) => l.status === 'substitution')!;
    const line = lines(dayAnswer(S, day.date, NOW, ZONE).text).find((l) => l.startsWith(`${lesson.hourIndex} ${lesson.subject}`))!;
    expect(line).toContain(`מחליף/ה: ${DEMO_SUBSTITUTE}`);
  });

  it("puts the day's exams before its lessons", () => {
    const day = S.days.find((d) => d.examsToday.length > 0 && d.lessons.length > 0)!;
    const exam = day.examsToday[0]!;
    const body = lines(dayAnswer(S, day.date, NOW, ZONE).text);
    expect(body[1]).toBe(`מבחן: ${exam.subject}${exam.details ? ` · ${exam.details}` : ''}`);
    const firstLesson = body.findIndex((l) => /^\d+ /.test(l));
    expect(firstLesson).toBeGreaterThan(1);
  });

  it('says when there is no school', () => {
    const day = S.days.find((d) => !d.isSchoolDay)!;
    expect(lines(dayAnswer(S, day.date, NOW, ZONE).text)[1]).toBe(`אין לימודים${day.holidayName ? ` · ${day.holidayName}` : ''}`);
  });

  it('says which days it has when asked for one it has not', () => {
    const { text, structured } = dayAnswer(S, '2026-11-25', NOW, ZONE);
    expect(lines(text)[0]).toBe(`אין לי את 25.11. יש לי מ־${dm(S.days[0]!.date)} עד ${dm(S.days.at(-1)!.date)}.`);
    expect(structured.found).toBe(false);
  });

  it("tells a copy older than a day by its age, and asks to open the app", () => {
    const old = dayAnswer(build(ALL, hoursAgo(50)), TODAY, NOW, ZONE).text;
    expect(old).toContain('לפני 2 ימים');
    expect(old).toContain('כדאי לפתוח את סדר יום');
    expect(lines(old).at(-1)!.startsWith('עודכן ')).toBe(true);
    const hours = dayAnswer(build(ALL, hoursAgo(30)), TODAY, NOW, ZONE).text;
    expect(hours).toContain('לפני 30 שעות');
    const fresh = dayAnswer(build(ALL, hoursAgo(2)), TODAY, NOW, ZONE).text;
    expect(fresh).not.toContain('כדאי לפתוח את סדר יום');
  });

  it('tells no Google Task id of a homework item, whatever a copy carries', () => {
    const stray = { ...S, homework: S.homework!.map((h) => ({ ...h, linkedTaskId: 'google-task-id-ZZZ' })) } as unknown as ChatSnapshot;
    for (const answer of [homeworkAnswer(stray, { includeDone: true }, NOW), homeworkAnswer(stray, {}, NOW)]) {
      expect(answer.text).not.toContain('google-task-id');
      const homework = answer.structured.homework as Record<string, unknown>[];
      expect(homework.length).toBeGreaterThan(0);
      expect(homework.every((h) => !('linkedTaskId' in h))).toBe(true);
      expect(JSON.stringify(answer.structured)).not.toContain('google-task-id');
    }
  });

  it('tells nothing from Google: not a calendar event, whatever a copy carries', () => {
    const day = S.days.find((d) => d.date === TODAY)!;
    // A copy that was not read through `readChatSnapshot` (it always is), with the Google parts of a development build from before 2026-11-05.
    const event = { id: 'e1', calendarId: 'c1', calendarName: null, seriesId: null, summary: 'אימון כדורסל', location: 'מרכז הספורט', start: '2026-11-05T17:00:00+02:00', end: '2026-11-05T18:30:00+02:00', allDay: false };
    const stray = { ...S, shares: { ...S.shares, google: true }, days: S.days.map((d) => (d === day ? { ...d, calendar: [event] } : d)), tasks: [] } as unknown as ChatSnapshot;
    for (const answer of [dayAnswer(stray, TODAY, NOW, ZONE), weekAnswer(stray, 0, NOW, ZONE)]) {
      expect(answer.text).not.toContain('אימון כדורסל');
      expect(answer.text).not.toContain('ביומן');
      expect(JSON.stringify(answer.structured)).not.toContain('אימון כדורסל');
      expect(JSON.stringify(answer.structured)).not.toContain('calendar');
    }
  });
});

describe('weekAnswer', () => {
  it('gives Sunday to Friday of this week, and notes the days it does not have', () => {
    const { text, structured } = weekAnswer(S, 0, NOW, ZONE);
    expect(structured.weekStart).toBe('2026-11-01');
    // Sunday 1.11 to Tuesday 3.11 are before yesterday.
    expect(text).toContain(`אין לי את 1.11. יש לי מ־${dm(S.days[0]!.date)} עד ${dm(S.days.at(-1)!.date)}.`);
    expect(text).toContain('יום חמישי 5.11');
    expect(text).toContain('יום שישי 6.11');
    expect(text).not.toContain('שבת 7.11');
  });

  it('gives next week from its Sunday', () => {
    const { text, structured } = weekAnswer(S, 1, NOW, ZONE);
    expect(structured.weekStart).toBe('2026-11-08');
    expect(lines(text)[0]).toBe('יום ראשון 8.11');
  });

  // Ruling N: on a Saturday the week is over, and "this week" is the one that starts tomorrow.
  describe('on a Saturday', () => {
    const SATURDAY = new Date('2026-11-07T10:00:00Z');
    const onSaturday = build(ALL, SATURDAY, SATURDAY);

    it('answers the coming week for offset 0, and the one after it for offset 1', () => {
      const now = weekAnswer(onSaturday, 0, SATURDAY, ZONE);
      expect(now.structured.weekStart).toBe('2026-11-08');
      expect(lines(now.text)[0]).toBe('יום ראשון 8.11');
      expect(lines(now.text)).toContain('יום שישי 13.11');
      expect(now.text).not.toContain('אין לי את');
      const next = weekAnswer(onSaturday, 1, SATURDAY, ZONE);
      expect(next.structured.weekStart).toBe('2026-11-15');
      expect(lines(next.text)[0]).toBe('יום ראשון 15.11');
    });

    it('keeps the offset the chat asked for in the data', () => {
      expect(weekAnswer(onSaturday, 0, SATURDAY, ZONE).structured.offset).toBe(0);
      expect(weekAnswer(onSaturday, 1, SATURDAY, ZONE).structured.offset).toBe(1);
    });

    it("goes by the student's zone: it is Saturday at 00:30 there while it is still Friday in UTC", () => {
      const justAfterMidnight = new Date('2026-11-06T22:30:00Z');
      expect(weekAnswer(onSaturday, 0, justAfterMidnight, ZONE).structured.weekStart).toBe('2026-11-08');
      // And it stops being Saturday there at midnight: Sunday's offset 0 is its own week.
      const sunday = new Date('2026-11-07T22:30:00Z');
      expect(weekAnswer(onSaturday, 0, sunday, ZONE).structured.weekStart).toBe('2026-11-08');
      expect(weekAnswer(onSaturday, 1, sunday, ZONE).structured.weekStart).toBe('2026-11-15');
    });

    it('does not move on the other days: Friday evening is still this week', () => {
      for (const at of ['2026-11-06T10:00:00Z', '2026-11-06T21:30:00Z']) {
        const friday = new Date(at);
        expect(weekAnswer(onSaturday, 0, friday, ZONE).structured.weekStart, at).toBe('2026-11-01');
        expect(weekAnswer(onSaturday, 1, friday, ZONE).structured.weekStart, at).toBe('2026-11-08');
      }
    });
  });
});

describe('examsAnswer', () => {
  it("lists the exams from today on, and filters by subject", () => {
    const all = examsAnswer(S, {}, NOW, ZONE);
    expect((all.structured.exams as unknown[]).length).toBe(S.exams.length);
    const one = S.exams[0]!;
    expect(all.text).toContain(one.subject);
    const math = examsAnswer(S, { subject: 'מתמטיקה' }, NOW, ZONE);
    expect((math.structured.exams as { subject: string }[]).every((e) => e.subject.includes('מתמטיקה'))).toBe(true);
    expect(examsAnswer(S, { subject: 'אין כזה מקצוע' }, NOW, ZONE).text).toContain('לא מצאתי מבחנים');
  });
});

describe('the parts a student shares', () => {
  it('answers NOT_SHARED for a part whose share is off, or that is not there', () => {
    const none = build(NONE);
    expect(gradesAnswer(none, {}, NOW).text).toBe(NOT_SHARED.grades);
    expect(homeworkAnswer(none, {}, NOW).text).toBe(NOT_SHARED.homework);
    expect(bagrutAnswer(none, NOW).text).toBe(NOT_SHARED.bagrut);
    expect(absencesAnswer(none, NOW).text).toBe(NOT_SHARED.absences);
    expect(messagesAnswer(none, {}, NOW).text).toBe(NOT_SHARED.messages);
    // The switch on but the part missing, and the part there but the switch off.
    expect(gradesAnswer({ ...none, shares: ALL }, {}, NOW).text).toBe(NOT_SHARED.grades);
    expect(gradesAnswer({ ...S, shares: NONE }, {}, NOW).text).toBe(NOT_SHARED.grades);
  });

  it('gives the shared parts', () => {
    const grade = S.grades![0]!;
    expect(gradesAnswer(S, {}, NOW).text).toContain(grade.subject);
    expect(gradesAnswer(S, { subject: grade.subject }, NOW).structured.grades).toEqual(S.grades!.filter((g) => g.subject.includes(grade.subject)).map(bare));
    const open = S.homework!.filter((h) => !h.done);
    expect((homeworkAnswer(S, {}, NOW).structured.homework as unknown[]).length).toBe(open.length);
    expect((homeworkAnswer(S, { includeDone: true }, NOW).structured.homework as unknown[]).length).toBe(S.homework!.length);
    expect(bagrutAnswer(S, NOW).text).toContain(S.bagrut![0]!.name);
    expect(absencesAnswer(S, NOW).text).toContain(S.absences![0]!.subject);
    const message = S.messages![0]!;
    expect(messagesAnswer(S, {}, NOW).text).toContain(message.title);
    expect((messagesAnswer(S, { query: 'מחשבון' }, NOW).structured.messages as unknown[]).length).toBe(1);
  });

  it('ends every answer with when the copy was made', () => {
    for (const answer of [
      gradesAnswer(S, {}, NOW), homeworkAnswer(S, {}, NOW), bagrutAnswer(S, NOW), absencesAnswer(S, NOW), messagesAnswer(S, {}, NOW),
      examsAnswer(S, {}, NOW, ZONE), weekAnswer(S, 0, NOW, ZONE), statusAnswer(S, NOW),
    ]) {
      expect(lines(answer.text).at(-1)).toBe('עודכן יום חמישי 5.11 בשעה 01:30');
    }
  });
});

describe('gradesAnswer', () => {
  const math = { subject: 'מתמטיקה', average: 87.5, uncounted: 2 };
  const physics = { subject: 'פיזיקה', average: 90 };

  it("lists each subject's average", () => {
    const averages = [math];
    const answer = gradesAnswer({ ...S, averages }, {}, NOW);
    expect(lines(answer.text)).toContain('ממוצע במתמטיקה: 87.5 (2 ציונים לא נספרים בממוצע)');
    expect(answer.structured.averages).toEqual(averages);
    expect(answer.structured.grades).toEqual(S.grades!.map(bare));
  });

  it('writes the averages before the grades, a subject without uncounted grades with no note', () => {
    const body = lines(gradesAnswer({ ...S, averages: [math, physics] }, {}, NOW).text);
    expect(body).toContain('ממוצע בפיזיקה: 90');
    const lastAverage = Math.max(body.indexOf('ממוצע במתמטיקה: 87.5 (2 ציונים לא נספרים בממוצע)'), body.indexOf('ממוצע בפיזיקה: 90'));
    const firstGrade = body.findIndex((l) => /^\d+\.\d+ /.test(l));
    expect(lastAverage).toBeGreaterThanOrEqual(0);
    expect(firstGrade).toBeGreaterThan(lastAverage);
    // One grade reads as one grade; two or more by their count.
    expect(lines(gradesAnswer({ ...S, averages: [{ ...math, uncounted: 1 }] }, {}, NOW).text)).toContain('ממוצע במתמטיקה: 87.5 (ציון אחד לא נספר בממוצע)');
    // And a count of none is no note at all.
    expect(lines(gradesAnswer({ ...S, averages: [{ ...math, uncounted: 0 }] }, {}, NOW).text)).toContain('ממוצע במתמטיקה: 87.5');
  });

  it("lists only the asked subject's average", () => {
    const answer = gradesAnswer({ ...S, averages: [math, physics] }, { subject: 'מתמטיקה' }, NOW);
    expect(lines(answer.text)).toContain('ממוצע במתמטיקה: 87.5 (2 ציונים לא נספרים בממוצע)');
    expect(answer.text).not.toContain('ממוצע בפיזיקה');
    expect(answer.structured.averages).toEqual([math]);
    expect(answer.structured.grades).toEqual(S.grades!.filter((g) => g.subject.includes('מתמטיקה')).map(bare));
  });

  it('has no average line, and no averages in the data, for a copy from a phone that sends none', () => {
    const { averages: _averages, ...older } = S;
    expect('averages' in older).toBe(false);
    const answer = gradesAnswer(older, {}, NOW);
    expect(answer.text).not.toContain('ממוצע');
    expect(answer.structured.averages).toBeUndefined();
    expect('averages' in answer.structured).toBe(false);
    expect(answer.structured.grades).toEqual(S.grades!.map(bare));
  });

  it("tells the demo student's real averages, from the phone's builder", () => {
    expect(S.averages!.length).toBeGreaterThan(0);
    const answer = gradesAnswer(S, {}, NOW);
    for (const a of S.averages!) expect(answer.text).toContain(`ממוצע ב${a.subject}: ${a.average}`);
  });

  it('does not tell the averages of a student who shares no grades', () => {
    const answer = gradesAnswer({ ...S, shares: NONE }, {}, NOW);
    expect(answer.text).toBe(NOT_SHARED.grades);
    expect('averages' in answer.structured).toBe(false);
  });

  it('keeps the averages when the old grades were cut, and still says they were', () => {
    const answer = gradesAnswer({ ...S, grades: [], averages: [math], trimmed: ['oldGrades'] }, {}, NOW);
    expect(lines(answer.text)).toContain('ממוצע במתמטיקה: 87.5 (2 ציונים לא נספרים בממוצע)');
    expect(answer.text).toContain('ציונים מלפני יותר מ־90 יום לא נשמרו');
    expect(answer.text).not.toContain('אין ציונים');
  });

  it('still says there are no grades when there are neither grades nor averages', () => {
    const answer = gradesAnswer({ ...S, grades: [], averages: [] }, {}, NOW);
    expect(answer.text).toContain('אין ציונים');
    expect(answer.structured.averages).toEqual([]);
  });
});

describe('statusAnswer', () => {
  it('says what the chat can read', () => {
    const { structured } = statusAnswer(build({ ...NONE, homework: true }), NOW);
    expect(structured.shares).toEqual({ ...NONE, homework: true });
    expect(structured.hasCopy).toBe(true);
  });

  it('says there is no copy yet', () => {
    expect(statusAnswer(null, NOW).text).toBe(NO_COPY);
  });

  it('lists the five parts a student can share, and never names Google among them', () => {
    expect(Object.keys(NOT_SHARED)).toEqual(['homework', 'grades', 'bagrut', 'absences', 'messages']);
    for (const shares of [ALL, NONE]) {
      const answer = statusAnswer(build(shares), NOW);
      expect(answer.text).not.toMatch(/google|יומן|משימות/i);
      expect(Object.keys(answer.structured.shares as object)).toEqual(['homework', 'grades', 'bagrut', 'absences', 'messages']);
    }
  });
});

describe('the fixed lines', () => {
  it('are the words the spec gives', () => {
    expect(NOT_SHARED.grades).toBe("התלמיד לא שיתף ציונים. אפשר להפעיל את זה בסדר יום ← הגדרות ← חיבור לצ'אט.");
    expect(NO_COPY).toBe('אין עדיין מידע מהטלפון. כדאי לפתוח את סדר יום.');
    expect(NOT_APPROVED).toBe("צריך לאשר את החיבור בסדר יום ← הגדרות ← חיבור לצ'אט.");
    expect(CANNOT_OPEN).toBe("המידע מהטלפון לא נפתח. כדאי לנתק את הצ'אט באפליקציה ולחבר אותו שוב.");
  });
});

describe('what a chat is handed', () => {
  it("carries none of the app's bookkeeping, in any answer, however deep", () => {
    const today = S.days[1]!.date;
    const answers = [
      dayAnswer(S, today, NOW, ZONE), weekAnswer(S, 0, NOW, ZONE), examsAnswer(S, {}, NOW, ZONE), homeworkAnswer(S, {}, NOW, ZONE),
      gradesAnswer(S, {}, NOW, ZONE), bagrutAnswer(S, NOW, ZONE), absencesAnswer(S, NOW, ZONE), messagesAnswer(S, {}, NOW, ZONE), statusAnswer(S, NOW, ZONE),
    ];
    for (const answer of answers) expect(JSON.stringify(answer.structured)).not.toMatch(/naturalKey|changeSeenAt|firstSeen/);
    // The items themselves stay: only their bookkeeping went.
    expect((answers[3]!.structured as { homework: unknown[] }).homework.length).toBeGreaterThan(0);
  });
});
