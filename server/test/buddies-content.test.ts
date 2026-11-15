/**
 * What a student shares with a friend, built on their own phone (app/src/buddies/content.ts),
 * and the phone's state about friends (app/src/buddies/store.ts), over a Map.
 */
import { describe, expect, it } from 'vitest';
import type { AttendanceResponse, AttendanceSubject, BuddyBoxContent, ClassFeed, DayView, Exam, Lesson } from '@sederyom/shared';
import { BUDDY_EXAM_DAYS, BUDDY_INVITE_TTL_DAYS, BUDDY_PAIR_CIPHERTEXT_MAX, DEFAULT_SETTINGS } from '@sederyom/shared';
import { examSubjectKey } from '@sederyom/shared/logic/exam-match';
import { addDays } from '@sederyom/shared/logic/time';
import { boxHash, fitBox, myBoxContent, type MyBoxInput } from '../../app/src/buddies/content';
import { keyOf, newSecret, openSealed, seal } from '../../app/src/buddies/crypto';
import { withSchoolDates } from '../../app/src/buddies/days';
import { BUDDY_KEYS, buddyFeedKey, keepIncomingInvite, readBuddies, saveBuddies, takeIncomingInvite } from '../../app/src/buddies/store';
import { readBoxContent } from '../../app/src/buddies/validate';
import { buildLocalDays, type LocalSources } from '../../app/src/local/days';
import { NO_EXAM_PREFS, type ExamPrefs } from '../../app/src/local/examPrefs';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

// Tuesday 1.9.2026, 10:00 in Jerusalem: this week's Sunday is 30.8, the next week's Saturday 12.9.
const NOW = new Date('2026-09-01T10:00:00+03:00');
const TODAY = '2026-09-01';
const THIS_SUNDAY = '2026-08-30';

function lesson(date: string, hourIndex: number, subject: string, over: Partial<Lesson> = {}): Lesson {
  return {
    date, hourIndex, startTime: '08:00', endTime: '08:45', subject, teacher: 'לוי', room: null, status: 'regular',
    substitute: null, note: null, source: 'shahaf', changeSeenAt: null, ...over,
  };
}

function exam(date: string, subject: string, over: Partial<Exam> = {}): Exam {
  return { naturalKey: `shahaf-exam|${date}|${subject}`, date, subject, details: null, source: 'shahaf', ...over };
}

function day(date: string, lessons: Lesson[] = [], exams: Exam[] = []): DayView {
  return {
    date, weekdayName: '', hebrewDate: '', isSchoolDay: true, holidayName: null,
    timeline: lessons.map((l) => ({ kind: 'lesson' as const, sortKey: `${l.date}|${l.hourIndex}`, lesson: l })),
    examsToday: exams, examsTomorrow: [], changeCount: 0, events: [], homework: [], nextExam: null, projected: false,
    generatedAt: NOW.toISOString(),
  };
}

/** One day for each date from this week's Sunday to `until`, with `lessons` and `exams` on their own days. */
function days(until: string, lessons: Lesson[] = [], exams: Exam[] = []): DayView[] {
  const out: DayView[] = [];
  for (let d = THIS_SUNDAY; d <= until; d = addDays(d, 1)) {
    out.push(day(d, lessons.filter((l) => l.date === d), exams.filter((e) => e.date === d)));
  }
  return out;
}

function subject(over: Partial<AttendanceSubject>): AttendanceSubject {
  return {
    groupId: 'g1', subject: 'מתמטיקה', held: 20, remaining: 40, remainingFrom: 'grid', weeklyHours: 5, absences: 0, lates: 0,
    justifiedAbsences: 0, justifiedLates: 0, events: [], ...over,
  };
}

function attendance(subjects: AttendanceSubject[]): AttendanceResponse {
  return {
    semesterStart: '2026-09-01', semesterEnd: '2027-01-31', limit: 0.15, latesPerAbsence: 3, subjects, daysOffAhead: [],
    fetchedAt: NOW.toISOString(),
  };
}

function input(over: Partial<MyBoxInput> = {}): MyBoxInput {
  return {
    name: 'נועה', shares: { timetable: true, absences: true }, days: days(addDays(TODAY, BUDDY_EXAM_DAYS)), attendance: null,
    siteUrl: 'https://school-g.shahaf.site', classId: '7', className: 'יב2', hiddenSubjects: [], mashovSchool: '123456',
    readAt: '2026-09-01T06:30:00.000Z', now: NOW, ...over,
  };
}

describe('the box a student shares', () => {
  it('shares nothing that was not chosen', () => {
    const content = myBoxContent(input({
      shares: { timetable: false, absences: false },
      days: days(addDays(TODAY, BUDDY_EXAM_DAYS), [lesson(TODAY, 1, 'פיזיקה')], [exam(TODAY, 'מבחן בהיסטוריה')]),
      attendance: attendance([subject({ subject: 'מתמטיקה', absences: 2 })]),
      hiddenSubjects: ['ספרות'], siteUrl: null,
    }));
    expect(content.timetable).toBeUndefined();
    expect(content.absences).toBeUndefined();
    expect(content).toEqual({ v: 1, at: '2026-09-01T06:30:00.000Z', name: 'נועה', shares: { timetable: false, absences: false } });
    const text = JSON.stringify(content);
    for (const word of ['פיזיקה', 'היסטוריה', 'מתמטיקה', 'ספרות', 'יב2', '123456']) expect(text).not.toContain(word);
  });

  it('shares each category on its own', () => {
    const onlyTimetable = myBoxContent(input({ shares: { timetable: true, absences: false }, attendance: attendance([subject({})]) }));
    expect(onlyTimetable.timetable).toBeDefined();
    expect(onlyTimetable.absences).toBeUndefined();
    const onlyAbsences = myBoxContent(input({ shares: { timetable: false, absences: true }, attendance: attendance([subject({})]) }));
    expect(onlyAbsences.timetable).toBeUndefined();
    expect(onlyAbsences.absences?.subjects).toHaveLength(1);
  });

  it('names the class and what is hidden', () => {
    const content = myBoxContent(input({ hiddenSubjects: ['ספרות', 'ערבית'] }));
    expect(content.timetable).toMatchObject({ siteUrl: 'https://school-g.shahaf.site', classId: '7', className: 'יב2', hiddenSubjects: ['ספרות', 'ערבית'] });
  });

  it('sends lessons only without a site', () => {
    const lessons = [lesson(TODAY, 2, 'פיזיקה', { startTime: '09:00', endTime: '09:45' }), lesson(addDays(TODAY, 1), 3, 'אנגלית', { status: 'cancelled', teacher: null })];
    const withSite = myBoxContent(input({ days: days(addDays(TODAY, BUDDY_EXAM_DAYS), lessons) }));
    expect(withSite.timetable!.lessons).toBeUndefined();
    expect(withSite.timetable).not.toHaveProperty('mashovSchool');
    expect(JSON.stringify(withSite)).not.toContain('פיזיקה');

    const without = myBoxContent(input({ siteUrl: null, days: days(addDays(TODAY, BUDDY_EXAM_DAYS), lessons) }));
    expect(without.timetable!.siteUrl).toBeNull();
    expect(without.timetable!.mashovSchool).toBe('123456');
    expect(without.timetable!.lessons).toEqual([
      { date: TODAY, hourIndex: 2, start: '09:00', end: '09:45', subject: 'פיזיקה', teacher: 'לוי', status: 'regular' },
      { date: addDays(TODAY, 1), hourIndex: 3, start: '08:00', end: '08:45', subject: 'אנגלית', teacher: null, status: 'cancelled' },
    ]);
  });

  it('sends a lesson with no times as null, and a school with no Mashov id as null', () => {
    const content = myBoxContent(input({
      siteUrl: null, mashovSchool: null,
      days: days(addDays(TODAY, BUDDY_EXAM_DAYS), [lesson(TODAY, 1, 'פיזיקה', { startTime: null, endTime: null })]),
    }));
    expect(content.timetable!.lessons![0]).toMatchObject({ hourIndex: 1, start: null, end: null });
    expect(content.timetable!.mashovSchool).toBeNull();
  });

  it('sends lessons of this week and the next only, the days before today included', () => {
    const lessons = [
      lesson('2026-08-29', 1, 'שבת שעברה'), lesson(THIS_SUNDAY, 1, 'ראשון'), lesson(TODAY, 1, 'שלישי'),
      lesson('2026-09-12', 1, 'שבת הבאה'), lesson('2026-09-13', 1, 'שבוע אחריו'),
    ];
    const content = myBoxContent(input({ siteUrl: null, days: [day('2026-08-29', [lessons[0]!]), ...days('2026-09-13', lessons)] }));
    expect(content.timetable!.lessons!.map((l) => l.subject)).toEqual(['ראשון', 'שלישי', 'שבת הבאה']);
  });

  it('weeks run Sunday to Saturday, by the date in Jerusalem', () => {
    // 21:30 UTC on Saturday 5.9 is half past midnight on Sunday 6.9 in Jerusalem: the week is 6.9 to 19.9.
    const now = new Date('2026-09-05T21:30:00Z');
    const lessons = [lesson('2026-09-05', 1, 'שבת'), lesson('2026-09-06', 1, 'ראשון'), lesson('2026-09-19', 1, 'שבת בעוד שבועיים'), lesson('2026-09-20', 1, 'מאוחר')];
    const all: DayView[] = [];
    for (let d = '2026-09-05'; d <= '2026-09-21'; d = addDays(d, 1)) all.push(day(d, lessons.filter((l) => l.date === d)));
    const content = myBoxContent(input({ siteUrl: null, now, days: all }));
    expect(content.timetable!.lessons!.map((l) => l.subject)).toEqual(['ראשון', 'שבת בעוד שבועיים']);
  });

  it('sends exams as shown, two weeks ahead', () => {
    const renamed = exam(addDays(TODAY, 3), 'ההיסטוריה שלי', { originalSubject: 'מבחן בהיסטוריה', kind: 'manual' });
    const plain = exam(addDays(TODAY, 1), 'מבחן באנגלית');
    const dayThirteen = exam(addDays(TODAY, 13), 'מבחן בפיזיקה');
    const today = exam(TODAY, 'מבחן בתנ״ך');
    const fifteen = exam(addDays(TODAY, 15), 'מבחן בכימיה');
    const fourteen = exam(addDays(TODAY, 14), 'מבחן בביולוגיה');
    const yesterday = exam(addDays(TODAY, -1), 'מבחן בגאוגרפיה');
    const content = myBoxContent(input({
      days: days(addDays(TODAY, 15), [], [renamed, plain, dayThirteen, today, fifteen, fourteen, yesterday]),
    }));
    expect(content.timetable!.exams).toEqual([
      { date: TODAY, subject: examSubjectKey('מבחן בתנ״ך'), title: 'מבחן בתנ״ך' },
      { date: addDays(TODAY, 1), subject: examSubjectKey('מבחן באנגלית'), title: 'מבחן באנגלית' },
      // As the sharer shows it, and keyed by the name its source gave it. (A name given to a subject is the exception: own-names-phone.)
      { date: addDays(TODAY, 3), subject: examSubjectKey('מבחן בהיסטוריה'), title: 'ההיסטוריה שלי' },
      { date: addDays(TODAY, 13), subject: examSubjectKey('מבחן בפיזיקה'), title: 'מבחן בפיזיקה' },
    ]);
    const text = JSON.stringify(content);
    for (const word of ['כימיה', 'ביולוגיה', 'גאוגרפיה']) expect(text).not.toContain(word);
  });

  it('counts today in Jerusalem when asking which exams are left', () => {
    const now = new Date('2026-09-05T21:30:00Z'); // 6.9 in Jerusalem
    const all: DayView[] = [];
    for (let d = '2026-09-05'; d <= '2026-09-21'; d = addDays(d, 1)) all.push(day(d, [], [exam(d, `מבחן ${d}`)]));
    const content = myBoxContent(input({ now, days: all }));
    const dates = content.timetable!.exams.map((e) => e.date);
    expect(dates[0]).toBe('2026-09-06');
    expect(dates[dates.length - 1]).toBe('2026-09-19');
  });

  it('sends absence counts, never dates', () => {
    const events = [
      { date: '2026-09-02', hour: 3, kind: 'absence' as const, justified: false, justification: null },
      { date: '2026-09-09', hour: 1, kind: 'absence' as const, justified: false, justification: null },
      { date: '2026-09-10', hour: 2, kind: 'late' as const, justified: true, justification: 'אישור רפואי' },
    ];
    const att = attendance([
      subject({ subject: 'מתמטיקה', held: 20, remaining: 40, absences: 2, lates: 3, events }),
      subject({ groupId: 'g2', subject: 'אנגלית', held: 20, remaining: 40, absences: 0, lates: 0 }),
      subject({ groupId: 'g3', subject: 'ספרות', held: 20, remaining: 0, absences: 6 }),
    ]);
    const content = myBoxContent(input({ attendance: att }));
    expect(content.absences).toEqual({
      semesterStart: '2026-09-01',
      semesterEnd: '2027-01-31',
      subjects: [
        // 2 absences and 3 lates at 3 lates to an absence: 3 count, out of 15% of 60 lessons: 9.
        { subject: 'מתמטיקה', counted: 3, allowed: 9, level: 'ok' },
        { subject: 'אנגלית', counted: 0, allowed: 9, level: 'ok' },
        // 6 of 15% of 20 lessons: 3.
        { subject: 'ספרות', counted: 6, allowed: 3, level: 'over' },
      ],
    });
    const text = JSON.stringify(content);
    expect(text).not.toContain('events');
    for (const date of ['2026-09-02', '2026-09-09', '2026-09-10']) expect(text).not.toContain(date);
    expect(text).not.toContain('אישור רפואי');
  });

  it('reads absences by the sharer\'s own rule for lates', () => {
    const att = { ...attendance([subject({ absences: 2, lates: 3 })]), latesPerAbsence: 1, limit: 0.1 };
    const content = myBoxContent(input({ attendance: att }));
    expect(content.absences!.subjects).toEqual([{ subject: 'מתמטיקה', counted: 5, allowed: 6, level: 'close' }]);
  });

  it('leaves absences out until the phone has them', () => {
    const content = myBoxContent(input({ attendance: null }));
    expect(content.absences).toBeUndefined();
    expect(content.shares.absences).toBe(true);
  });

  /**
   * The box is how a friend's phone learns that I share grades (grades spec 4.1): once it has read my box, it goes by
   * the box's `shares` and no longer by my invite or reply. So the switches must be in it when on.
   */
  it('says in the box that grades, and the bagrut, are shared, when they are', () => {
    const grades = myBoxContent(input({ shares: { timetable: true, absences: false, grades: true } }));
    expect(grades.shares).toEqual({ timetable: true, absences: false, grades: true });
    expect(grades.shares).not.toHaveProperty('bagrut');
    const both = myBoxContent(input({ shares: { timetable: false, absences: false, grades: true, bagrut: true } }));
    expect(both.shares).toEqual({ timetable: false, absences: false, grades: true, bagrut: true });
    // And the friend's phone reads them back, sealed and opened.
    const key = keyOf(newSecret());
    expect(readBoxContent(openSealed<unknown>(seal(both, key), key))!.shares).toEqual({ timetable: false, absences: false, grades: true, bagrut: true });
  });

  it('says nothing of grades when they are off, so the box is the very one it was before grades', () => {
    for (const shares of [
      { timetable: true, absences: false }, { timetable: true, absences: false, grades: false, bagrut: false },
      // The bagrut counts only along with the grades.
      { timetable: true, absences: false, bagrut: true }, { timetable: true, absences: false, grades: false, bagrut: true },
    ]) {
      const content = myBoxContent(input({ shares }));
      expect(content.shares, JSON.stringify(shares)).not.toHaveProperty('grades');
      expect(content.shares, JSON.stringify(shares)).not.toHaveProperty('bagrut');
      // Byte for byte the box written before grades: a friend with grades off sees no change, and nothing is written again for it.
      expect(JSON.stringify(content.shares)).toBe('{"timetable":true,"absences":false}');
      expect(JSON.stringify(content)).toBe(JSON.stringify({ v: 1, at: content.at, name: 'נועה', shares: { timetable: true, absences: false }, timetable: content.timetable }));
      expect(boxHash(content)).toBe(boxHash(myBoxContent(input({ shares: { timetable: true, absences: false } }))));
    }
  });

  it('dates the box by the Mashov read, else by now', () => {
    expect(myBoxContent(input({ readAt: '2026-08-31T05:00:00.000Z' })).at).toBe('2026-08-31T05:00:00.000Z');
    expect(myBoxContent(input({ readAt: null })).at).toBe(NOW.toISOString());
  });

  it('hashes the same content the same at another time', () => {
    const a = myBoxContent(input({ readAt: '2026-09-01T06:30:00.000Z' }));
    const b = myBoxContent(input({ readAt: '2026-09-01T09:45:00.000Z' }));
    expect(a.at).not.toBe(b.at);
    expect(boxHash(a)).toBe(boxHash(b));
    expect(boxHash(a)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('hashes the same whatever order the shares were written in', () => {
    const a = myBoxContent(input({ shares: { timetable: true, absences: false } }));
    const b = myBoxContent(input({ shares: { absences: false, timetable: true } }));
    expect(boxHash(a)).toBe(boxHash(b));
  });

  it('hashes different content differently', () => {
    const base = input({ siteUrl: null, days: days(addDays(TODAY, BUDDY_EXAM_DAYS), [lesson(TODAY, 1, 'פיזיקה')]) });
    const changed = input({ siteUrl: null, days: days(addDays(TODAY, BUDDY_EXAM_DAYS), [lesson(TODAY, 1, 'פיזיקה', { status: 'cancelled' })]) });
    expect(boxHash(myBoxContent(base))).not.toBe(boxHash(myBoxContent(changed)));
    expect(boxHash(myBoxContent(base))).not.toBe(boxHash(myBoxContent({ ...base, name: 'דנה' })));
    expect(boxHash(myBoxContent(base))).not.toBe(boxHash(myBoxContent({ ...base, shares: { timetable: true, absences: false } })));
  });

  it('does not touch what it was given', () => {
    const hidden = ['ספרות'];
    const content = myBoxContent(input({ hiddenSubjects: hidden }));
    content.timetable!.hiddenSubjects.push('ערבית');
    expect(hidden).toEqual(['ספרות']);
    const v: BuddyBoxContent['v'] = content.v;
    expect(v).toBe(1);
  });
});

/**
 * A school without a Shahaf site, two full weeks of it: ten periods a day,
 * Sunday to Thursday, six on Friday, long subject and teacher names, some
 * without times, a cancellation and a substitute; a bagrut exam, one the
 * student added and renamed, a class exam; absences with lates. As much as a
 * real box holds, and more.
 */
function heavyInput(): MyBoxInput {
  const subjects = ['מתמטיקה 5 יחידות', 'אנגלית 5 יחידות', 'היסטוריה', 'ספרות', 'פיזיקה', 'כימיה', 'ביולוגיה', 'תנ״ך', 'לשון והבעה', 'חינוך גופני'];
  const teachers = ['ד״ר רחל כהן-לוי', 'יעקב אברהמי', 'מיכל שטרנברג', 'אורית בן-דוד'];
  const lessons: Lesson[] = [];
  for (let d = THIS_SUNDAY; d < addDays(THIS_SUNDAY, 14); d = addDays(d, 1)) {
    const weekday = (Date.parse(`${d}T00:00:00Z`) / 86_400_000 + 4) % 7; // 0 on Sunday: 1.1.1970 was a Thursday
    if (weekday === 6) continue;
    const periods = weekday === 5 ? 6 : 10;
    for (let h = 1; h <= periods; h += 1) {
      const start = `${String(7 + h).padStart(2, '0')}:00`;
      const end = `${String(7 + h).padStart(2, '0')}:45`;
      lessons.push(lesson(d, h, subjects[(h + weekday) % subjects.length]!, {
        startTime: h === 10 ? null : start, endTime: h === 10 ? null : end, teacher: teachers[h % teachers.length]!,
        status: d === TODAY && h === 3 ? 'cancelled' : d === addDays(TODAY, 1) && h === 2 ? 'substitution' : 'regular',
      }));
    }
  }
  const exams = [
    exam(addDays(TODAY, 2), 'בגרות במתמטיקה שאלון 581', { kind: 'bagrut', source: 'mashov', startTime: '09:00', endTime: '12:00' }),
    exam(addDays(TODAY, 4), 'הבוחן שלי בכימיה', { kind: 'manual', originalSubject: 'בוחן בכימיה', source: 'mashov' }),
    exam(addDays(TODAY, 6), 'מבחן בהיסטוריה'),
  ];
  const events = [
    { date: '2026-09-02', hour: 3, kind: 'absence' as const, justified: false, justification: null },
    { date: '2026-09-03', hour: 1, kind: 'late' as const, justified: false, justification: null },
  ];
  return input({
    siteUrl: null,
    days: days(addDays(TODAY, BUDDY_EXAM_DAYS), lessons, exams),
    hiddenSubjects: ['ערבית', 'אמנות'],
    attendance: attendance([
      subject({ subject: 'מתמטיקה', absences: 2, lates: 4, events }),
      subject({ groupId: 'g2', subject: 'אנגלית', absences: 1, lates: 2 }),
      subject({ groupId: 'g3', subject: 'ספרות', held: 20, remaining: 0, absences: 6 }),
    ]),
  });
}

describe('a box as its friend reads it', () => {
  it('reads back exactly as it was built, and through the seal too', () => {
    const content = myBoxContent(heavyInput());
    // What the fixture is meant to hold, so the round trip covers each kind of thing a box carries.
    expect(content.timetable!.lessons!.length).toBeGreaterThan(100);
    expect(content.timetable!.lessons!.some((l) => l.start === null)).toBe(true);
    expect(new Set(content.timetable!.lessons!.map((l) => l.status))).toEqual(new Set(['regular', 'cancelled', 'substitution']));
    expect(content.timetable!.exams.map((e) => e.title)).toEqual(['בגרות במתמטיקה שאלון 581', 'הבוחן שלי בכימיה', 'מבחן בהיסטוריה']);
    expect(content.absences!.subjects.map((s) => s.level)).toContain('over');

    expect(readBoxContent(content)).toEqual(content);
    const key = keyOf(newSecret());
    expect(readBoxContent(openSealed(seal(content, key), key))).toEqual(content);
  });

  it('fits a real box whole, under the pair box\'s cap', () => {
    const content = myBoxContent(heavyInput());
    expect(seal(content, keyOf(newSecret())).length).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);
    expect(fitBox(content, NOW)).toEqual(content);
  });

  it('trims a box that would not fit: this week\'s lessons, then none', () => {
    const content = myBoxContent(heavyInput());
    const lessons = content.timetable!.lessons!;
    // Long names in every lesson, so two weeks do not fit and one does.
    const bloat = (by: number): BuddyBoxContent => ({
      ...content,
      timetable: { ...content.timetable!, lessons: lessons.map((l) => ({ ...l, teacher: `${l.teacher} ${'א'.repeat(by)}` })) },
    });
    const twoWeeks = bloat(60);
    expect(seal(twoWeeks, keyOf(newSecret())).length).toBeGreaterThan(BUDDY_PAIR_CIPHERTEXT_MAX);
    const fitted = fitBox(twoWeeks, NOW)!;
    expect(seal(fitted, keyOf(newSecret())).length).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);
    expect(fitted.timetable!.lessonsTrimmed).toBe(true);
    expect(new Set(fitted.timetable!.lessons!.map((l) => l.date < addDays(THIS_SUNDAY, 7)))).toEqual(new Set([true]));
    expect(fitted.timetable!.lessons!.length).toBe(lessons.filter((l) => l.date < addDays(THIS_SUNDAY, 7)).length);
    // The rest of the box is as it was.
    expect({ ...fitted, timetable: { ...fitted.timetable!, lessons: undefined, lessonsTrimmed: undefined } })
      .toEqual({ ...twoWeeks, timetable: { ...twoWeeks.timetable!, lessons: undefined, lessonsTrimmed: undefined } });
    expect(readBoxContent(fitted)).toEqual(fitted);

    // Not even one week: no lessons at all.
    const huge = bloat(260);
    const bare = fitBox(huge, NOW)!;
    expect(bare.timetable!.lessons).toBeUndefined();
    expect(bare.timetable!.exams).toEqual(content.timetable!.exams);
    expect(seal(bare, keyOf(newSecret())).length).toBeLessThanOrEqual(BUDDY_PAIR_CIPHERTEXT_MAX);

    // And a box that cannot be made to fit is none.
    const absurd: BuddyBoxContent = { ...content, timetable: { ...content.timetable!, hiddenSubjects: ['א'.repeat(40_000)] } };
    expect(fitBox(absurd, NOW)).toBeNull();
  });
});

describe('the phone\'s state about friends', () => {
  it('reads an empty state when there is none, or it is not JSON', () => {
    const kv = memoryKv();
    const empty = { myName: '', buddies: [], invites: [], answers: [], unseen: false, notes: [] };
    expect(readBuddies(kv)).toEqual(empty);
    kv.set(BUDDY_KEYS.state, '{not json');
    expect(readBuddies(kv)).toEqual(empty);
    kv.set(BUDDY_KEYS.state, '[1,2]');
    expect(readBuddies(kv)).toEqual(empty);
    kv.set(BUDDY_KEYS.state, 'null');
    expect(readBuddies(kv)).toEqual(empty);
  });

  it('keeps what was saved', () => {
    const kv = memoryKv();
    const state = {
      myName: 'נועה',
      buddies: [{
        id: 'b1', role: 'inviter' as const, secret: 's'.repeat(43), name: 'דנה', label: '', shares: { timetable: true, absences: false },
        theirs: null, readAt: null, everRead: false, written: { hash: 'h', at: '2026-09-01T07:00:00.000Z' },
        theirGrades: null, gradesWritten: null, gradesDot: false, addedAt: '2026-09-01T07:00:00.000Z',
      }],
      invites: [
        { secret: 'k'.repeat(43), secretKey: 'x'.repeat(43), shares: { timetable: true, absences: true }, createdAt: '2026-09-01T07:00:00.000Z' },
        { secret: 'j'.repeat(43), secretKey: 'y'.repeat(43), shares: { timetable: false, absences: true }, createdAt: '2026-09-01T07:00:00.000Z', unsent: true as const },
      ],
      answers: [{ replyId: 'r'.repeat(22), inviteId: 'i'.repeat(22), secret: 'p'.repeat(43), name: 'פלג', shares: { timetable: true, absences: false }, offered: { timetable: true, absences: true }, ciphertext: 'c'.repeat(80) }],
      unseen: true,
      notes: ['דנה הצטרפה'],
    };
    saveBuddies(kv, state);
    expect(readBuddies(kv)).toEqual(state);
  });

  it('fills what a saved state lacks, and drops what is not a friend or an invite', () => {
    const kv = memoryKv();
    kv.set(BUDDY_KEYS.state, JSON.stringify({ myName: 7, buddies: [null, 'x', { id: 'b1' }, { id: 'b2', secret: 's', role: 'invitee' }, { id: 'b3', secret: 's', role: 'other' }], invites: [{}, { secret: 'k', secretKey: 'x' }], answers: [{}, { replyId: 'r', inviteId: 'i', secret: 's', name: 'פלג', ciphertext: 'c' }, { replyId: 'r' }] }));
    const state = readBuddies(kv);
    expect(state.myName).toBe('');
    expect(state.unseen).toBe(false);
    expect(state.notes).toEqual([]);
    expect(state.buddies.map((b) => b.id)).toEqual(['b2']);
    // Nothing is shared that the record does not say is.
    expect(state.buddies[0]!.shares).toEqual({ timetable: false, absences: false });
    expect(state.invites.map((i) => i.secret)).toEqual(['k']);
    expect(state.invites[0]!.unsent).toBeUndefined();
    expect(state.answers.map((a) => a.replyId)).toEqual(['r']);
    expect(state.answers[0]!.shares).toEqual({ timetable: false, absences: false });
  });

  it('keeps an incoming invite for a week', () => {
    const kv = memoryKv();
    const day0 = new Date('2026-09-01T10:00:00Z');
    const at = (days: number) => new Date(day0.getTime() + days * 24 * 3_600_000);
    expect(takeIncomingInvite(kv, day0)).toBeNull();

    keepIncomingInvite(kv, 'S'.repeat(43), day0);
    expect(takeIncomingInvite(kv, at(BUDDY_INVITE_TTL_DAYS - 1))).toBe('S'.repeat(43));
    expect(takeIncomingInvite(kv, at(BUDDY_INVITE_TTL_DAYS - 1))).toBeNull();

    keepIncomingInvite(kv, 'T'.repeat(43), day0);
    expect(takeIncomingInvite(kv, at(BUDDY_INVITE_TTL_DAYS + 1))).toBeNull();
    expect(takeIncomingInvite(kv, day0)).toBeNull();
  });

  it('keeps the latest incoming invite', () => {
    const kv = memoryKv();
    const now = new Date('2026-09-01T10:00:00Z');
    keepIncomingInvite(kv, 'A'.repeat(43), now);
    keepIncomingInvite(kv, 'B'.repeat(43), now);
    expect(takeIncomingInvite(kv, now)).toBe('B'.repeat(43));
  });

  it('forgets an incoming invite that is not readable', () => {
    const kv = memoryKv();
    kv.set(BUDDY_KEYS.incoming, '{nope');
    expect(takeIncomingInvite(kv, new Date())).toBeNull();
    kv.set(BUDDY_KEYS.incoming, JSON.stringify({ secret: 5, at: 'x' }));
    expect(takeIncomingInvite(kv, new Date())).toBeNull();
  });

  it('keys a followed class\'s feed by its site and class', () => {
    expect(buddyFeedKey('https://school-g.shahaf.site', '7')).toBe(`${BUDDY_KEYS.feedPrefix}https://school-g.shahaf.site|7`);
    expect(buddyFeedKey('https://school-g.shahaf.site', '7')).not.toBe(buddyFeedKey('https://school-g.shahaf.site', '8'));
    expect(buddyFeedKey('https://a.shahaf.site', '7')).not.toBe(buddyFeedKey('https://b.shahaf.site', '7'));
    expect(BUDDY_KEYS).toEqual({ state: 'buddies.state', incoming: 'buddies.incoming', feedPrefix: 'buddies.feed|', school: 'buddies.school' });
  });
});

describe('the exams a friend gets, when the student moved one for themselves', () => {
  const KEY = (name: string) => `school_site|${name}`;
  const site = (name: string, date: string, subject: string): ClassFeed['exams'][number] => ({ naturalKey: KEY(name), date, subject, details: null, source: 'school_site' });
  const feed: ClassFeed = {
    class: { siteUrl: 'https://school-g.shahaf.site', classId: '7', className: 'יב2' },
    lastOkAt: NOW.toISOString(),
    freshness: null,
    lessons: [],
    changes: [],
    exams: [
      site('english', '2026-09-03', 'מבחן באנגלית'),
      site('physics', '2026-09-10', 'מבחן בפיזיקה'),
      site('far', '2026-10-20', 'מבחן בספרות'),
      site('near', '2026-09-08', 'מבחן בכימיה'),
    ],
    events: [],
    messages: [],
  };
  const moved = (...entries: [name: string, date: string][]): ExamPrefs => ({
    ...NO_EXAM_PREFS,
    dates: Object.fromEntries(entries.map(([name, date]) => [KEY(name), { date, sourceDate: feed.exams.find((e) => e.naturalKey === KEY(name))!.date! }])),
  });
  const phone = (examPrefs: ExamPrefs): LocalSources => ({
    feed, mashov: [], bagrut: [], google: [], settings: { ...DEFAULT_SETTINGS, classId: '7', className: 'יב2' }, examPrefs, zone: 'Asia/Jerusalem', now: NOW,
  });
  /** The dates `buddies/run.ts` builds a box's days over: this week's Sunday through today + `BUDDY_EXAM_DAYS`. */
  const BOX_DATES = Array.from({ length: 17 }, (_v, i) => addDays(THIS_SUNDAY, i));
  const sent = (daysOf: DayView[]) => myBoxContent(input({ days: daysOf })).timetable!.exams.map((e) => [e.date, e.title]);
  const SCHOOLS = [['2026-09-03', 'מבחן באנגלית'], ['2026-09-08', 'מבחן בכימיה'], ['2026-09-10', 'מבחן בפיזיקה']];

  it('is the school\'s date, in the days the phone builds for the box', () => {
    expect(BOX_DATES[BOX_DATES.length - 1]).toBe(addDays(TODAY, BUDDY_EXAM_DAYS));
    // Moved later (and out of the two weeks), earlier, and into the two weeks from far off: the friend still gets what the school says.
    const prefs = moved(['english', '2026-09-25'], ['near', '2026-09-02'], ['far', '2026-09-05']);
    expect(sent(buildLocalDays(withSchoolDates(phone(prefs)), BOX_DATES))).toEqual(SCHOOLS);
    // The same box as an exam that was never moved: nothing a friend sees has changed, so the box is not written again.
    const never = myBoxContent(input({ days: buildLocalDays(phone(NO_EXAM_PREFS), BOX_DATES) }));
    const own = myBoxContent(input({ days: buildLocalDays(withSchoolDates(phone(prefs)), BOX_DATES) }));
    expect(boxHash(own)).toBe(boxHash(never));
  });

  it('is the school\'s date even from days that were built on the student\'s own', () => {
    // Moved within the days built: the exam is on another day of them, and the box says the school's.
    const prefs = moved(['english', '2026-09-05'], ['physics', '2026-09-12'], ['far', '2026-09-06']);
    const days = buildLocalDays(phone(prefs), BOX_DATES);
    expect(days.find((d) => d.date === '2026-09-05')!.examsToday.map((e) => e.naturalKey)).toEqual([KEY('english')]);
    // An exam the student moved in from far off is not among the school's two weeks, and is not sent.
    expect(sent(days)).toEqual(SCHOOLS);
    expect(JSON.stringify(myBoxContent(input({ days })))).not.toContain('2026-09-05');
    expect(JSON.stringify(myBoxContent(input({ days })))).not.toContain('2026-09-12');
  });

  it('keeps the name the student gave it, and the key by the name its source gave it', () => {
    const prefs: ExamPrefs = { ...moved(['english', '2026-09-05']), renames: { [KEY('english')]: 'האנגלית שלי' } };
    const exams = myBoxContent(input({ days: buildLocalDays(withSchoolDates(phone(prefs)), BOX_DATES) })).timetable!.exams;
    expect(exams[0]).toEqual({ date: '2026-09-03', subject: examSubjectKey('מבחן באנגלית'), title: 'האנגלית שלי' });
  });

  it('leaves the student\'s own prefs alone: their days are still on their dates', () => {
    const prefs = moved(['english', '2026-09-05']);
    const src = phone(prefs);
    withSchoolDates(src);
    expect(src.examPrefs).toBe(prefs);
    expect(buildLocalDays(src, BOX_DATES).find((d) => d.date === '2026-09-05')!.examsToday.map((e) => e.naturalKey)).toEqual([KEY('english')]);
    // And a phone with no prefs at all is as it was.
    expect(withSchoolDates({ ...src, examPrefs: undefined }).examPrefs).toBeUndefined();
  });
});
