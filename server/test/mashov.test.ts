/**
 * Mashov normalizers. The endpoint paths are confirmed live (Spike 1 round 2);
 * the response *shapes* are not, so these tests pin the two things that must
 * hold whatever the field names turn out to be: a row that cannot be understood
 * is dropped rather than half-parsed, and a row that can is joined correctly to
 * its group and its bell.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBellIndex, buildGroupIndex, normalizeBell, normalizeGrade,
  normalizeGroup, normalizeHomework, normalizeSlot,
} from '@sederyom/shared/logic/mashov/normalize';
import { clockTime } from '@sederyom/shared/logic/mashov/fields';
import { normalizeMessage } from '@sederyom/shared/logic/mashov/messages';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';
import { readMashov } from '@sederyom/shared/logic/mashov/read';
import { cookieValue, parseMashovToken } from '@sederyom/shared/logic/mashov/session';
import { parseTimetable } from '../src/adapters/shahaf/parser.js';

const ZONE = 'Asia/Jerusalem';

/** A real /api/bells body, captured 2026-08-28. */
const REAL_BELLS = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'mashov', 'bells.json'), 'utf8'),
) as unknown[];

describe('bell schedule', () => {
  it('accepts the clock formats a school API might use', () => {
    expect(clockTime('08:00')).toBe('08:00');
    expect(clockTime('8:00')).toBe('08:00');
    expect(clockTime('0800')).toBe('08:00');
    expect(clockTime('2026-09-01T08:00:00')).toBe('08:00');
    expect(clockTime('')).toBeNull();
    expect(clockTime(null)).toBeNull();
    expect(clockTime('morning')).toBeNull();
  });

  it('indexes bells by period number', () => {
    const index = buildBellIndex([
      { bell: 1, startTime: '08:00', endTime: '08:45' },
      { bell: 2, startTime: '08:45', endTime: '09:30' },
    ]);
    expect(index.get(2)).toEqual({ hourIndex: 2, startTime: '08:45', endTime: '09:30' });
  });

  it('reads the real /api/bells body — the field is lessonNumber', () => {
    const index = buildBellIndex(REAL_BELLS);
    expect(index.size).toBe(11);
    expect(index.get(1)).toEqual({ hourIndex: 1, startTime: '08:00', endTime: '08:45' });
    expect(index.get(7)).toEqual({ hourIndex: 7, startTime: '13:25', endTime: '14:10' });
    // "08:00:00" must not become "08:00:00" or leak the seconds into the UI.
    for (const bell of index.values()) {
      expect(bell.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(bell.endTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  /**
   * Two independent sources publish the same bell schedule. Asserting they agree
   * validates both parsers at once — and if the school ever changes the times,
   * this is where the disagreement surfaces.
   */
  it('agrees with the period times the Shahaf site publishes', () => {
    const html = readFileSync(
      join(import.meta.dirname, '..', 'fixtures', 'shahaf', 'changestable-cls36.html'),
      'utf8',
    );
    const shahafRows = new Map<number, { start: string | null; end: string | null }>();
    // The Shahaf grid has no lessons over the summer, but its row labels carry
    // the period times regardless — parse them out of the same fixture.
    for (const match of html.matchAll(
      /<b>(\d+)<br\/><span class="hour-time">(\d{2}:\d{2})<\/span><br\/><span class="hour-time">(\d{2}:\d{2})<\/span><\/b>/g,
    )) {
      shahafRows.set(Number(match[1]), { start: match[2]!, end: match[3]! });
    }
    expect(shahafRows.size).toBeGreaterThan(8);
    void parseTimetable(html, '2026-08-30', { zone: ZONE });

    const bells = buildBellIndex(REAL_BELLS);
    let compared = 0;
    for (const [period, times] of shahafRows) {
      const bell = bells.get(period);
      if (!bell) continue; // Shahaf shows a period 0 placeholder that Mashov has no bell for
      expect({ period, ...times }).toEqual({ period, start: bell.startTime, end: bell.endTime });
      compared += 1;
    }
    expect(compared).toBe(10);
  });

  it('drops a bell with no period number instead of inventing one', () => {
    expect(normalizeBell({ startTime: '08:00' })).toBeNull();
    expect(normalizeBell(null)).toBeNull();
  });
});

describe('timetable slots', () => {
  const groups = buildGroupIndex([
    { groupId: '77', subjectName: 'פיזיקה', groupTeachers: [{ teacherName: 'לוי' }] },
    { groupId: '78', groupName: 'אנגלית מוגבר', groupTeachers: [{ teacherName: 'שרון' }, { teacherName: 'כהן' }] },
  ]);
  const bells = buildBellIndex([{ bell: 3, startTime: '09:45', endTime: '10:30' }]);

  it('joins a row to its group and its bell', () => {
    const slot = normalizeSlot({ timeTable: { day: 3, lesson: 3, roomNum: 'מעבדה 2' }, groupId: '77' }, groups, bells);
    expect(slot).toEqual({
      dayOfWeek: 2, // Mashov's 1=Sunday becomes 0=Sunday
      hourIndex: 3,
      subject: 'פיזיקה',
      teacher: 'לוי',
      room: 'מעבדה 2',
      groupName: null,
      startTime: '09:45',
      endTime: '10:30',
      // Kept for Mashov's timetable changes, which name a lesson by its group.
      groupId: '77',
    });
  });

  it('converts Mashov Sunday=1 to Sunday=0 across the whole week', () => {
    const days = [1, 2, 3, 4, 5, 6].map(
      (day) => normalizeSlot({ day, lesson: 1, subjectName: 'x' })!.dayOfWeek,
    );
    expect(days).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('prefers the row over the group when both name a subject', () => {
    const slot = normalizeSlot({ day: 1, lesson: 3, subjectName: 'מתמטיקה', groupId: '77' }, groups, bells);
    expect(slot!.subject).toBe('מתמטיקה');
  });

  it('falls back to the group name when nothing names a subject', () => {
    const slot = normalizeSlot({ day: 1, lesson: 1, groupId: '78' }, groups, bells);
    expect(slot!.subject).toBe('אנגלית מוגבר');
  });

  it('joins multiple teachers rather than silently keeping one', () => {
    expect(normalizeGroup({ groupId: '78', groupTeachers: [{ teacherName: 'שרון' }, { teacherName: 'כהן' }] })!.teacher)
      .toBe('שרון, כהן');
  });

  it('leaves times null when the school publishes no bell for that period', () => {
    const slot = normalizeSlot({ day: 1, lesson: 9, subjectName: 'ספורט' }, groups, bells);
    expect(slot).toMatchObject({ startTime: null, endTime: null });
  });

  it('drops a row with no day, no period or no subject', () => {
    expect(normalizeSlot({ lesson: 1, subjectName: 'x' })).toBeNull();
    expect(normalizeSlot({ day: 1, subjectName: 'x' })).toBeNull();
    expect(normalizeSlot({ day: 1, lesson: 1 })).toBeNull();
  });
});

describe('homework, grades and mail', () => {
  it('keys homework by its id when there is one', () => {
    expect(normalizeHomework({ homeworkId: 91, lessonDate: '2026-09-02T00:00:00', subjectName: 'אנגלית', homework: 'תרגיל 4' }, ZONE))
      .toEqual({ naturalKey: 'mashov-hw|91', dueDate: '2026-09-02', dueExplicit: false, subject: 'אנגלית', text: 'תרגיל 4' });
  });

  it('falls back to a content key when there is no id, so nothing is lost', () => {
    const hw = normalizeHomework({ lessonDate: '2026-09-02T00:00:00', subjectName: 'אנגלית', homework: 'תרגיל 4' }, ZONE);
    expect(hw!.naturalKey).toBe('mashov-hw|2026-09-02|אנגלית|תרגיל 4');
  });

  /**
   * `lessonDate` is when the homework was given; "due today" (S1) needs when it
   * is due. A due field wins whenever Mashov sends one.
   */
  it('dates homework by its due date, not by the lesson it was given in', () => {
    const hw = normalizeHomework(
      { homeworkId: 92, lessonDate: '2026-09-02T00:00:00', dueDate: '2026-09-06T00:00:00', subjectName: 'אנגלית', homework: 'חיבור' },
      ZONE,
    );
    expect(hw).toEqual({ naturalKey: 'mashov-hw|92', dueDate: '2026-09-06', dueExplicit: true, subject: 'אנגלית', text: 'חיבור' });
  });

  it('falls back to the lesson date only when there is no due date — and says so', () => {
    expect(normalizeHomework({ homeworkId: 93, lessonDate: '2026-09-02T00:00:00', dueDate: null, homework: 'x' }, ZONE))
      .toMatchObject({ dueDate: '2026-09-02', dueExplicit: false });
    expect(normalizeHomework({ homeworkId: 94, homework: 'x' }, ZONE)).toMatchObject({ dueDate: null, dueExplicit: false });
  });

  /** S1 derives a due date (the next lesson of the subject) only when this is false. */
  it('marks every explicit due field as explicit, whichever alias carries it', () => {
    for (const field of ['dueDate', 'submissionDate', 'submitDate']) {
      expect(normalizeHomework({ homeworkId: 95, lessonDate: '2026-09-02T00:00:00', [field]: '2026-09-07T00:00:00', homework: 'x' }, ZONE))
        .toMatchObject({ dueDate: '2026-09-07', dueExplicit: true });
    }
  });

  it('keeps the content key on the lesson date, so nothing stored is re-keyed', () => {
    const hw = normalizeHomework(
      { lessonDate: '2026-09-02T00:00:00', dueDate: '2026-09-06T00:00:00', subjectName: 'אנגלית', homework: 'תרגיל 4' },
      ZONE,
    );
    expect(hw).toMatchObject({ naturalKey: 'mashov-hw|2026-09-02|אנגלית|תרגיל 4', dueDate: '2026-09-06' });
  });

  it('drops homework with no text', () => {
    expect(normalizeHomework({ homeworkId: 1, subjectName: 'אנגלית' }, ZONE)).toBeNull();
  });

  it('recognises an exam grade', () => {
    const grade = normalizeGrade(
      { gradeId: 5, gradingEventDate: '2026-09-03T00:00:00', subjectName: 'מתמטיקה', grade: 94, gradingEvent: 'מבחן', rate: 30 },
      ZONE,
    );
    expect(grade).toMatchObject({ date: '2026-09-03', value: 94, weight: 30, isExam: true });
  });

  it('keeps a textual grade as text rather than forcing a number', () => {
    const grade = normalizeGrade(
      { gradeId: 6, gradingEventDate: '2026-09-03T00:00:00', subjectName: 'ספורט', grade: 'עבר', gradingEvent: 'בוחן' },
      ZONE,
    );
    expect(grade).toMatchObject({ value: null, valueText: 'עבר', isExam: false });
  });

  it('dates a grade by eventDate when there is no gradingEventDate, and keeps the name as notes', () => {
    // The assessment's name in `gradingEvent` must not be read as its date.
    const grade = normalizeGrade(
      { id: 8, eventDate: '2026-10-06T00:00:00', subjectName: 'אנגלית', grade: 88, gradingEvent: 'בוחן אוצר מילים', rate: 10 },
      ZONE,
    );
    expect(grade).toMatchObject({ naturalKey: 'mashov-grade|8', date: '2026-10-06', value: 88, notes: 'בוחן אוצר מילים', isExam: false });
  });

  it('falls back to the timestamp when a grade carries no event date', () => {
    const grade = normalizeGrade({ id: 9, timestamp: '2026-10-07T13:20:00', subjectName: 'אזרחות', grade: 90, gradingEvent: 'עבודה' }, ZONE);
    expect(grade).toMatchObject({ date: '2026-10-07', notes: 'עבודה' });
  });

  it('drops a grade with no date or no subject', () => {
    expect(normalizeGrade({ gradeId: 7, grade: 90 }, ZONE)).toBeNull();
  });

  it('reads an exam\'s grade as a grade, never as an exam on the day it was given', async () => {
    // Saturday 14.11.2026: a physics grade came out that evening, and the read listed "an exam today". The date a
    // graded row carries can be the day the grade came out, not the day the exam was sat.
    const empty = async () => [];
    const api = {
      timetable: empty, timetableChanges: async () => ({ isEnabled: true, changes: [], cancellations: [] }), homework: empty,
      grades: async () => [{ gradeId: 11, eventDate: '2026-11-14T00:00:00', subjectName: 'פיזיקה', grade: 92, gradingEvent: 'מבחן אלקטרוסטטיקה' }],
      behave: empty, lessonsCount: empty, groups: empty, bells: empty, mail: empty, conversation: async () => ({}),
      bagrutGrades: empty, bagrutSheelonim: empty,
    } as unknown as MashovApi;
    const read = await readMashov(api, { zone: ZONE, storedMessages: null, readBagrut: false, now: new Date('2026-11-14T21:35:00+02:00') });
    expect(read.entities.filter((e) => e.kind === 'grade').map((e) => e.payload)).toMatchObject([{ date: '2026-11-14', subject: 'פיזיקה', value: 92, isExam: true }]);
    expect(read.entities.filter((e) => e.kind === 'exam')).toEqual([]);
  });

  // The real shape is in mashov-messages.test.ts; this is the minimum a conversation needs.
  it('normalizes a mail conversation', () => {
    const msg = normalizeMessage(
      { conversationId: 'c1', subject: 'עדכון', sendTime: '2026-09-01T09:15:00', messages: [{ senderName: 'מחנכת', sendTime: '2026-09-01T09:15:00' }] },
      ZONE,
    );
    expect(msg).toMatchObject({ naturalKey: 'mashov-msg|c1', title: 'עדכון', from: 'מחנכת', body: '' });
    expect(msg!.date).toBe('2026-09-01T09:15:00.000+03:00');
  });

  it('never throws on a row it cannot understand', () => {
    for (const junk of [null, undefined, 42, 'string', [], {}]) {
      expect(normalizeSlot(junk)).toBeNull();
      expect(normalizeHomework(junk, ZONE)).toBeNull();
      expect(normalizeGrade(junk, ZONE)).toBeNull();
      expect(normalizeMessage(junk, ZONE)).toBeNull();
      expect(normalizeBell(junk)).toBeNull();
      expect(normalizeGroup(junk)).toBeNull();
    }
  });
});

/**
 * The auth cookie is a JWT that describes its own session. Reading it is how the
 * phone learns the student id, the school and — critically — the expiry, which
 * Spike 1 measured at exactly 60 minutes.
 */
describe('auth cookie', () => {
  // Payload assembled here rather than pasted: a real token carries the
  // student's national ID and name, and neither belongs in a repository.
  const payload = {
    SessionId: '5f1a2b3c-0000-0000-0000-000000000000',
    Semel: '123456',
    Year: '2027',
    UserId: 'd4e5f6a7-0000-0000-0000-000000000000',
    IdNumber: '000000000',
    DisplayName: 'תלמיד בדיקה',
    LoginTime: '1787935536',
    iat: 1787935537,
    exp: 1787939137,
  };
  const jwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature-not-verified-by-us',
  ].join('.');
  const header = `_ga=GA1.2.x; MashovAuthToken=${jwt}; Csrf-Token=0a1b2c3d; uniquId=9b-cc`;

  it('picks one cookie out of a Cookie header', () => {
    expect(cookieValue(header, 'Csrf-Token')).toBe('0a1b2c3d');
    expect(cookieValue(header, 'nope')).toBeNull();
  });

  it('reads the identity and expiry the phone needs', () => {
    const info = parseMashovToken(header)!;
    expect(info.userId).toBe('d4e5f6a7-0000-0000-0000-000000000000');
    expect(info.schoolId).toBe('123456');
    expect(info.year).toBe('2027');
    expect(info.expiresAt!.getTime() - info.issuedAt!.getTime()).toBe(60 * 60 * 1000);
    // The login itself, which the hourly renewals keep: the 8-hour cap counts from it.
    expect(info.loginAt?.toISOString()).toBe(new Date(1787935536 * 1000).toISOString());
  });

  it('reads nothing it does not need — no national ID, no name', () => {
    const info = parseMashovToken(header)!;
    expect(Object.keys(info).sort()).toEqual(['expiresAt', 'issuedAt', 'loginAt', 'schoolId', 'userId', 'year']);
    expect(JSON.stringify(info)).not.toContain('תלמיד בדיקה');
  });

  it('returns null rather than throwing on a jar with no token', () => {
    expect(parseMashovToken('_ga=GA1.2.x')).toBeNull();
    expect(parseMashovToken('MashovAuthToken=not-a-jwt')).toBeNull();
    expect(parseMashovToken('')).toBeNull();
  });
});
