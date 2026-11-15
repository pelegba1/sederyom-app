/**
 * The friends feature (docs/superpowers/specs/2026-10-29-friends-design.md):
 * the numbers the spec names, and the pure comparison of two people's days.
 */
import { describe, expect, it } from 'vitest';
import {
  BUDDY_BOX_ID,
  BUDDY_BOX_STALE_DAYS,
  BUDDY_EXAM_DAYS,
  BUDDY_INVITE_CIPHERTEXT_MAX,
  BUDDY_INVITE_TTL_DAYS,
  BUDDY_PAIR_CIPHERTEXT_MAX,
  BUDDY_REWRITE_MINUTES,
  DEFAULT_BUDDY_SHARES,
  MAX_BUDDIES,
  TOGETHER_MINUTES,
  WINDOW_MIN_MINUTES,
} from '@sederyom/shared';
import {
  compareDays,
  compareExams,
  examsWithBuddies,
  namesList,
  todayBuddyLines,
  type CompareLesson,
  type DayCompare,
} from '@sederyom/shared/logic/buddies-compare';
import type { BuddyExam } from '@sederyom/shared';

describe('the friends feature numbers', () => {
  it('fixes the numbers the spec names', () => {
    expect(MAX_BUDDIES).toBe(20);
    expect(TOGETHER_MINUTES).toBe(10);
    expect(WINDOW_MIN_MINUTES).toBe(30);
    expect(BUDDY_INVITE_TTL_DAYS).toBe(7);
    // Past a summer without opening the app (about 70 days), so it does not end every friendship (R24).
    expect(BUDDY_BOX_STALE_DAYS).toBe(120);
    // Per kind (R23): an invite or a reply holds a name and a key; a pair box two weeks of lessons.
    expect(BUDDY_INVITE_CIPHERTEXT_MAX).toBe(4_096);
    expect(BUDDY_PAIR_CIPHERTEXT_MAX).toBe(32_768);
    expect(BUDDY_REWRITE_MINUTES).toBe(60);
    expect(BUDDY_EXAM_DAYS).toBe(14);
    expect(DEFAULT_BUDDY_SHARES).toEqual({ timetable: true, absences: true });
    expect(BUDDY_BOX_ID.test('a'.repeat(22))).toBe(true);
    expect(BUDDY_BOX_ID.test('a'.repeat(21))).toBe(false);
  });
});

/** One lesson of the day compared: regular, with the teacher left out unless named. */
function L(
  hour: number,
  start: string | null,
  end: string | null,
  subject: string,
  teacher: string | null = null,
): CompareLesson {
  return { hourIndex: hour, start, end, subject, teacher, status: 'regular' };
}

const cancelled = (lesson: CompareLesson): CompareLesson => ({ ...lesson, status: 'cancelled' });

/** The spec's Monday (§4.6): the two timetables the section's examples come from. */
function mondayMine(): CompareLesson[] {
  return [
    L(1, '08:00', '08:45', 'ביולוגיה'),
    L(2, '08:45', '09:30', 'ביולוגיה'),
    L(3, '09:45', '10:30', 'מתמטיקה', 'אסנת קליין'),
    L(4, '10:30', '11:15', 'אנגלית'),
    L(6, '12:20', '13:05', 'אזרחות'),
    L(7, '13:15', '14:00', 'ספרות'),
  ];
}

function mondayTheirs(): CompareLesson[] {
  return [
    L(2, '08:45', '09:30', 'כימיה'),
    L(3, '09:45', '10:30', 'מתמטיקה', 'אסנת קליין'),
    L(4, '10:30', '11:15', 'אנגלית'),
    L(6, '12:20', '13:05', 'היסטוריה'),
    L(7, '13:15', '14:00', 'תנ״ך'),
  ];
}

const clock = { samePeriods: false };

describe('compareDays', () => {
  it('finds the spec\'s Monday', () => {
    const day = compareDays(mondayMine(), mondayTheirs(), clock);
    expect(day.by).toBe('clock');
    expect(day.mine).toEqual({ start: '08:00', end: '14:00', firstHour: 1, lastHour: 7 });
    expect(day.theirs).toEqual({ start: '08:45', end: '14:00', firstHour: 2, lastHour: 7 });
    expect(day.startTogether).toBe(false);
    expect(day.endTogether).toBe(true);
    expect(day.windows).toEqual([{ by: 'clock', from: '11:15', to: '12:20' }]);
    expect(day.together.map((t) => t.subject)).toEqual(['מתמטיקה', 'אנגלית']);
    expect(day.together.map((t) => [t.hourIndex, t.start])).toEqual([[3, '09:45'], [4, '10:30']]);
  });

  it('says together under 10 minutes, not at 10', () => {
    const ends = (a: string, b: string) =>
      compareDays([L(1, '08:00', a, 'מתמטיקה')], [L(1, '08:00', b, 'מתמטיקה')], clock);
    expect(ends('14:00', '14:05').endTogether).toBe(true);
    expect(ends('14:00', '14:09').endTogether).toBe(true);
    expect(ends('14:00', '14:10').endTogether).toBe(false);
    // The same rule for starts, and in the other direction.
    const starts = compareDays([L(1, '08:00', '14:00', 'מתמטיקה')], [L(1, '07:51', '14:00', 'מתמטיקה')], clock);
    expect(starts.startTogether).toBe(true);
    expect(compareDays([L(1, '08:00', '14:00', 'מתמטיקה')], [L(1, '07:50', '14:00', 'מתמטיקה')], clock).startTogether)
      .toBe(false);
  });

  it('does not count a 20-minute break as a window', () => {
    const day = [L(1, '10:30', '11:15', 'אנגלית'), L(2, '11:35', '12:20', 'מתמטיקה')];
    expect(compareDays(day, day, clock).windows).toEqual([]);
  });

  it('counts a gap of exactly 30 minutes as a window', () => {
    const day = [L(1, '10:30', '11:15', 'אנגלית'), L(2, '11:45', '12:20', 'מתמטיקה')];
    expect(compareDays(day, day, clock).windows).toEqual([{ by: 'clock', from: '11:15', to: '11:45' }]);
  });

  it('finds windows in the union of both days, not in mine alone', () => {
    const mine = [L(1, '08:00', '09:00', 'מתמטיקה'), L(2, '11:00', '12:00', 'אנגלית')];
    const theirs = [L(1, '08:00', '09:00', 'מתמטיקה'), L(2, '09:30', '10:00', 'ספרות'), L(3, '11:00', '12:00', 'אנגלית')];
    // Alone, I am free from 09:00 to 11:00; their 09:30–10:00 lesson splits that into two windows.
    expect(compareDays(mine, theirs, clock).windows).toEqual([
      { by: 'clock', from: '09:00', to: '09:30' },
      { by: 'clock', from: '10:00', to: '11:00' },
    ]);
  });

  it('keeps the later end when one lesson runs past the next', () => {
    const mine = [L(1, '08:00', '09:30', 'מתמטיקה'), L(2, '11:00', '11:45', 'אנגלית')];
    const theirs = [L(1, '08:00', '08:45', 'מתמטיקה'), L(2, '10:00', '10:45', 'ספרות')];
    // My 08:00–09:30 lesson covers their 08:00–08:45 one, so the first gap starts at 09:30, not 08:45.
    expect(compareDays(mine, theirs, clock).windows).toEqual([{ by: 'clock', from: '09:30', to: '10:00' }]);
  });

  it('ignores cancelled lessons', () => {
    const mine = mondayMine();
    mine[mine.length - 1] = cancelled(mine[mine.length - 1]!);
    const day = compareDays(mine, mondayTheirs(), clock);
    expect(day.mine).toEqual({ start: '08:00', end: '13:05', firstHour: 1, lastHour: 6 });
    expect(day.endTogether).toBe(false); // 13:05 against 14:00
  });

  it('frees the hour for both when one side cancels it', () => {
    const shared = [L(1, '08:00', '09:30', 'מתמטיקה'), L(3, '11:30', '12:15', 'אנגלית')];
    const mine = [shared[0]!, cancelled(L(2, '09:30', '11:30', 'ספרות')), shared[1]!];
    expect(compareDays(mine, shared, clock).windows).toEqual([{ by: 'clock', from: '09:30', to: '11:30' }]);
  });

  it('has nothing together on a day off', () => {
    const day = compareDays(mondayMine(), [], clock);
    expect(day.mine).not.toBeNull();
    expect(day.theirs).toBeNull();
    expect(day.startTogether).toBe(false);
    expect(day.endTogether).toBe(false);
    expect(day.windows).toEqual([]);
    expect(day.together).toEqual([]);
    const both = compareDays([], [], clock);
    expect([both.mine, both.theirs]).toEqual([null, null]);
    // A side whose every lesson is cancelled is a day off too.
    expect(compareDays([cancelled(L(1, '08:00', '08:45', 'מתמטיקה'))], mondayTheirs(), clock).mine).toBeNull();
  });

  it('does not call a gap outside both days a window', () => {
    const mine = [L(1, '08:00', '08:45', 'אנגלית'), L(2, '10:00', '10:45', 'מתמטיקה')];
    const theirs = [L(1, '10:00', '10:45', 'מתמטיקה'), L(2, '12:00', '12:45', 'ספרות')];
    // 08:45–10:00 is before theirs starts, 10:45–12:00 after mine ends.
    expect(compareDays(mine, theirs, clock).windows).toEqual([]);
  });

  it('compares by period when times are missing at one school', () => {
    const mine = [1, 2, 3, 5, 6].map((h) => L(h, null, null, h === 2 ? 'אנגלית' : 'ספרות'));
    const theirs = [2, 3, 5, 6].map((h) => L(h, null, null, h === 2 ? 'אנגלית' : 'תנ״ך'));
    const day = compareDays(mine, theirs, { samePeriods: true });
    expect(day.by).toBe('period');
    expect(day.mine).toEqual({ start: null, end: null, firstHour: 1, lastHour: 6 });
    expect(day.theirs).toEqual({ start: null, end: null, firstHour: 2, lastHour: 6 });
    expect(day.startTogether).toBe(false);
    expect(day.endTogether).toBe(true);
    expect(day.windows).toEqual([{ by: 'period', from: 4, to: 4 }]);
    expect(day.together).toEqual([{ hourIndex: 2, start: null, subject: 'אנגלית' }]);
  });

  it('finds a run of free periods, and none outside both days', () => {
    const mine = [1, 2, 6, 7].map((h) => L(h, null, null, 'ספרות'));
    const theirs = [3, 6, 7].map((h) => L(h, null, null, 'תנ״ך'));
    const day = compareDays(mine, theirs, { samePeriods: true });
    // Both are in school from period 3 to period 7, and neither has 4 or 5; 1 and 2 are before theirs starts.
    expect(day.windows).toEqual([{ by: 'period', from: 4, to: 5 }]);
  });

  it('cannot compare without times at two schools', () => {
    const mine = [1, 2, 3, 5, 6].map((h) => L(h, null, null, 'ספרות'));
    const theirs = [2, 3, 5, 6].map((h) => L(h, null, null, 'ספרות'));
    const day = compareDays(mine, theirs, { samePeriods: false });
    expect(day.by).toBe('none');
    expect(day.windows).toEqual([]);
    expect(day.together).toEqual([]);
    expect(day.startTogether).toBe(false);
    expect(day.endTogether).toBe(false);
    // The two days are still described, as far as they can be.
    expect(day.mine).toEqual({ start: null, end: null, firstHour: 1, lastHour: 6 });
    expect(day.theirs).toEqual({ start: null, end: null, firstHour: 2, lastHour: 6 });
  });

  it('compares by period when only some lessons have times', () => {
    const mine = [L(1, '08:00', '08:45', 'אנגלית'), L(2, null, null, 'מתמטיקה')];
    const theirs = [L(1, '08:05', '08:50', 'אנגלית'), L(2, '08:50', '09:35', 'מתמטיקה')];
    const day = compareDays(mine, theirs, { samePeriods: true });
    expect(day.by).toBe('period');
    expect(day.startTogether).toBe(true);
    expect(day.endTogether).toBe(true);
    expect(day.mine).toEqual({ start: '08:00', end: null, firstHour: 1, lastHour: 2 });
    expect(day.together.map((t) => t.subject)).toEqual(['אנגלית', 'מתמטיקה']);
  });

  it('does not call two groups with different teachers together', () => {
    const mine = [L(1, '09:45', '10:30', 'מתמטיקה', 'אסנת קליין')];
    const theirs = [L(1, '09:45', '10:30', 'מתמטיקה', 'רון לוי')];
    expect(compareDays(mine, theirs, clock).together).toEqual([]);
  });

  it('calls a lesson together when a teacher is missing, but not another subject', () => {
    const mine = [L(1, '09:45', '10:30', 'מתמטיקה', 'אסנת קליין'), L(2, '10:30', '11:15', 'אנגלית')];
    const theirs = [L(1, '09:45', '10:30', 'מתמטיקה'), L(2, '10:30', '11:15', 'ספרות')];
    expect(compareDays(mine, theirs, clock).together.map((t) => t.subject)).toEqual(['מתמטיקה']);
  });

  it('does not count the same subject at another hour as together', () => {
    const mine = [L(1, '08:00', '08:45', 'מתמטיקה')];
    const theirs = [L(1, '09:00', '09:45', 'מתמטיקה')];
    expect(compareDays(mine, theirs, clock).together).toEqual([]);
  });
});

/** One exam as a box carries it: the subject is the key of the title. */
function E(date: string, subject: string, title = `מבחן ב${subject}`): BuddyExam {
  return { date, subject, title };
}

describe('compareExams', () => {
  it('pairs exams as the sketch shows', () => {
    const mine = [E('2026-11-05', 'מתמטיקה'), E('2026-11-10', 'ספרות'), E('2026-11-11', 'אנגלית')];
    const theirs = [E('2026-11-05', 'מתמטיקה'), E('2026-11-08', 'כימיה'), E('2026-11-12', 'אנגלית')];
    expect(compareExams(mine, theirs, '2026-11-02', 'Asia/Jerusalem')).toEqual([
      { date: '2026-11-05', title: 'מבחן במתמטיקה', who: 'together', otherDate: null, owner: 'mine' },
      { date: '2026-11-08', title: 'מבחן בכימיה', who: 'theirs', otherDate: null, owner: 'theirs' },
      { date: '2026-11-10', title: 'מבחן בספרות', who: 'mine', otherDate: null, owner: 'mine' },
      { date: '2026-11-11', title: 'מבחן באנגלית', who: 'same_subject', otherDate: '2026-11-12', owner: 'mine' },
      { date: '2026-11-12', title: 'מבחן באנגלית', who: 'same_subject', otherDate: '2026-11-11', owner: 'theirs' },
    ]);
  });

  it("says whose each row of the same subject is, when theirs comes first", () => {
    const rows = compareExams([E('2026-11-12', 'אנגלית')], [E('2026-11-11', 'אנגלית')], '2026-11-02', 'Asia/Jerusalem');
    expect(rows.map((r) => [r.date, r.who, r.otherDate, r.owner])).toEqual([
      ['2026-11-11', 'same_subject', '2026-11-12', 'theirs'],
      ['2026-11-12', 'same_subject', '2026-11-11', 'mine'],
    ]);
  });

  it('leaves out exams past 14 days', () => {
    const mine = [E('2026-11-01', 'מתמטיקה'), E('2026-11-02', 'ספרות'), E('2026-11-15', 'אנגלית'), E('2026-11-16', 'כימיה')];
    const theirs = [E('2026-11-16', 'כימיה'), E('2026-11-15', 'היסטוריה')];
    const rows = compareExams(mine, theirs, '2026-11-02', 'Asia/Jerusalem');
    // Day 0 is in, day 13 is in, day 14 is out, and so is anything before today.
    expect(rows.map((r) => [r.date, r.who])).toEqual([
      ['2026-11-02', 'mine'],
      ['2026-11-15', 'mine'],
      ['2026-11-15', 'theirs'],
    ]);
  });

  it('counts a week from Sunday to Saturday', () => {
    const rows = compareExams(
      [E('2026-11-07', 'מתמטיקה'), E('2026-11-08', 'אנגלית')],
      [E('2026-11-08', 'מתמטיקה'), E('2026-11-07', 'אנגלית')],
      '2026-11-02',
      'Asia/Jerusalem',
    );
    // Saturday the 7th ends one week and Sunday the 8th starts the next.
    expect(rows.map((r) => r.who)).toEqual(['mine', 'theirs', 'mine', 'theirs']);
    const week = compareExams([E('2026-11-01', 'מתמטיקה')], [E('2026-11-07', 'מתמטיקה')], '2026-11-01', 'Asia/Jerusalem');
    expect(week.map((r) => [r.who, r.otherDate])).toEqual([
      ['same_subject', '2026-11-07'],
      ['same_subject', '2026-11-01'],
    ]);
  });

  it('matches the subject by name, and reads the title when the subject is empty', () => {
    const rows = compareExams(
      [E('2026-11-05', 'אנגלית דוברי')],
      [{ date: '2026-11-05', subject: '', title: 'מבחן באנגלית' }],
      '2026-11-02',
      'Asia/Jerusalem',
    );
    expect(rows.map((r) => r.who)).toEqual(['together']);
    // No subject to read at all: it matches nothing, not even another such exam.
    const none = compareExams(
      [{ date: '2026-11-05', subject: '', title: '' }],
      [{ date: '2026-11-05', subject: '', title: '' }],
      '2026-11-02',
      'Asia/Jerusalem',
    );
    expect(none.map((r) => r.who)).toEqual(['mine', 'theirs']);
  });

  it('pairs two exams of the same block on one day: a block exam names a slot, not a subject', () => {
    const block = (date: string, title: string): BuddyExam => ({ date, subject: '', title });
    const rows = compareExams([block('2026-11-04', "מבחן גוש ב'")], [block('2026-11-04', "מבחן גוש ב'")], '2026-11-01', 'Asia/Jerusalem');
    expect(rows.map((r) => r.who)).toEqual(['together']);
    // The same block, spelled another way on the other phone.
    const spelled = compareExams([block('2026-11-04', "מבחן גוש ב'")], [block('2026-11-04', 'מבחן בגוש ב׳')], '2026-11-01', 'Asia/Jerusalem');
    expect(spelled.map((r) => r.who)).toEqual(['together']);
    // Another block is another sitting.
    const other = compareExams([block('2026-11-04', "מבחן גוש א'")], [block('2026-11-04', "מבחן גוש ב'")], '2026-11-01', 'Asia/Jerusalem');
    expect(other.map((r) => r.who)).toEqual(['mine', 'theirs']);
    // A block with no letter says nothing about which sitting it is.
    const bare = compareExams([block('2026-11-04', 'מבחן גוש')], [block('2026-11-04', "מבחן גוש ב'")], '2026-11-01', 'Asia/Jerusalem');
    expect(bare.map((r) => r.who)).toEqual(['mine', 'theirs']);
    // A block exam beside a subject's exam on the same day is not the same exam.
    const subject = compareExams([block('2026-11-04', "מבחן גוש ב'")], [E('2026-11-04', 'מתמטיקה')], '2026-11-01', 'Asia/Jerusalem');
    expect(subject.map((r) => r.who)).toEqual(['mine', 'theirs']);
    // The list of my exams says the friend sits it too.
    expect(examsWithBuddies([block('2026-11-04', "מבחן גוש ב'")], [{ name: 'יהל', exams: [block('2026-11-04', "מבחן גוש ב'")] }], '2026-11-01', 'Asia/Jerusalem'))
      .toMatchObject([{ date: '2026-11-04', together: ['יהל'] }]);
  });

  it('skips an exam whose date does not read', () => {
    const rows = compareExams([E('2026-11-99', 'מתמטיקה'), E('soon', 'ספרות')], [E('2026-11-05', 'כימיה')], '2026-11-02', 'Asia/Jerusalem');
    expect(rows.map((r) => r.who)).toEqual(['theirs']);
  });
});

describe('examsWithBuddies', () => {
  it('lists my exams with the friends who share them', () => {
    const mine = [E('2026-11-05', 'מתמטיקה'), E('2026-11-10', 'ספרות')];
    const buddies = [
      { name: 'נועה', exams: [E('2026-11-05', 'מתמטיקה'), E('2026-11-08', 'כימיה')] },
      { name: 'יואב', exams: [E('2026-11-05', 'מתמטיקה')] },
    ];
    expect(examsWithBuddies(mine, buddies, '2026-11-02', 'Asia/Jerusalem')).toEqual([
      { date: '2026-11-05', title: 'מבחן במתמטיקה', together: ['נועה', 'יואב'], sameSubject: [] },
    ]);
  });

  it('tells the friends on another day apart from those on the same day', () => {
    const mine = [E('2026-11-11', 'אנגלית'), E('2026-11-03', 'ביולוגיה')];
    const buddies = [
      { name: 'נועה', exams: [E('2026-11-12', 'אנגלית')] },
      { name: 'יואב', exams: [E('2026-11-11', 'אנגלית')] },
      { name: 'שירה', exams: [E('2026-11-19', 'אנגלית')] },
    ];
    expect(examsWithBuddies(mine, buddies, '2026-11-02', 'Asia/Jerusalem')).toEqual([
      { date: '2026-11-11', title: 'מבחן באנגלית', together: ['יואב'], sameSubject: ['נועה'] },
    ]);
  });

  it('is empty when nobody shares an exam', () => {
    expect(examsWithBuddies([E('2026-11-05', 'מתמטיקה')], [], '2026-11-02', 'Asia/Jerusalem')).toEqual([]);
  });
});

/** A comparison of one day, by the clock and with nothing in common, to adjust. */
function dayWith(over: Partial<DayCompare> = {}): DayCompare {
  return {
    by: 'clock',
    mine: { start: '08:00', end: '14:00', firstHour: 1, lastHour: 7 },
    theirs: { start: '08:00', end: '14:00', firstHour: 1, lastHour: 7 },
    startTogether: false,
    endTogether: false,
    windows: [],
    together: [],
    ...over,
  };
}

const window1115 = { by: 'clock', from: '11:15', to: '12:20' } as const;

describe('todayBuddyLines', () => {
  it('puts the coming window first, then the end', () => {
    const days = [
      { id: 'n', name: 'נועה', compare: dayWith({ startTogether: true, endTogether: true, windows: [window1115] }) },
      { id: 'y', name: 'יואב', compare: dayWith({ startTogether: true, endTogether: true }) },
    ];
    expect(todayBuddyLines(days, '09:20')).toEqual([
      { kind: 'window', span: window1115, names: ['נועה'], ids: ['n'] },
      { kind: 'end', at: '14:00', names: ['נועה', 'יואב'], ids: ['n', 'y'] },
    ]);
    // The window is over by 12:30, and the day has started, so no start line either.
    expect(todayBuddyLines(days, '12:30')).toEqual([{ kind: 'end', at: '14:00', names: ['נועה', 'יואב'], ids: ['n', 'y'] }]);
  });

  it('says the start only before the day starts, and never more than two lines', () => {
    const days = [
      { id: 'n', name: 'נועה', compare: dayWith({ startTogether: true }) },
      { id: 'y', name: 'יואב', compare: dayWith({ startTogether: true, endTogether: true }) },
    ];
    expect(todayBuddyLines(days, '07:30')).toEqual([
      { kind: 'end', at: '14:00', names: ['יואב'], ids: ['y'] },
      { kind: 'start', at: '08:00', names: ['נועה', 'יואב'], ids: ['n', 'y'] },
    ]);
    expect(todayBuddyLines(days, '08:00')).toEqual([{ kind: 'end', at: '14:00', names: ['יואב'], ids: ['y'] }]);
    const crowded = [{ id: 'n', name: 'נועה', compare: dayWith({ startTogether: true, endTogether: true, windows: [window1115] }) }];
    expect(todayBuddyLines(crowded, '07:30').map((l) => l.kind)).toEqual(['window', 'end']);
  });

  it('names every friend with the earliest window still ahead, and its exact span', () => {
    const early = { by: 'clock', from: '09:30', to: '10:10' } as const;
    const days = [
      { id: 'n', name: 'נועה', compare: dayWith({ windows: [early, window1115] }) },
      { id: 'y', name: 'יואב', compare: dayWith({ windows: [window1115] }) },
      { id: 's', name: 'שירה', compare: dayWith({ windows: [{ by: 'clock', from: '11:20', to: '12:00' }] }) },
    ];
    expect(todayBuddyLines(days, '09:45')).toEqual([{ kind: 'window', span: early, names: ['נועה'], ids: ['n'] }]);
    // Once the early one is over, the next is the 11:15 one, and the friend with 11:20 to 12:00 does not share it.
    expect(todayBuddyLines(days, '10:10')).toEqual([{ kind: 'window', span: window1115, names: ['נועה', 'יואב'], ids: ['n', 'y'] }]);
    // Windows that begin together: the one that ends first comes first.
    const tie = [
      { id: 'n', name: 'נועה', compare: dayWith({ windows: [window1115] }) },
      { id: 's', name: 'שירה', compare: dayWith({ windows: [{ by: 'clock', from: '11:15', to: '12:00' }] }) },
    ];
    expect(todayBuddyLines(tie, '10:10')).toEqual([
      { kind: 'window', span: { by: 'clock', from: '11:15', to: '12:00' }, names: ['שירה'], ids: ['s'] },
    ]);
    // A window that ends at 12:20 is over at 12:20, not before.
    expect(todayBuddyLines(days, '12:19').map((l) => l.kind)).toEqual(['window']);
    expect(todayBuddyLines(days, '12:20')).toEqual([]);
  });

  it('reads the periods when the days are compared by period', () => {
    const period = (over: Partial<DayCompare> = {}) =>
      dayWith({
        by: 'period',
        mine: { start: null, end: null, firstHour: 2, lastHour: 8 },
        theirs: { start: null, end: null, firstHour: 1, lastHour: 8 },
        ...over,
      });
    const days = [
      { id: 'n', name: 'נועה', compare: period({ endTogether: true, startTogether: true, windows: [{ by: 'period', from: 4, to: 5 }] }) },
      { id: 'y', name: 'יואב', compare: period({ endTogether: true }) },
    ];
    expect(todayBuddyLines(days, '07:00')).toEqual([
      { kind: 'window', span: { by: 'period', from: 4, to: 5 }, names: ['נועה'], ids: ['n'] },
      { kind: 'end', at: 8, names: ['נועה', 'יואב'], ids: ['n', 'y'] },
    ]);
    // A period window cannot be told from the clock, so it stays however late it is.
    expect(todayBuddyLines(days, '23:00').map((l) => l.kind)).toEqual(['window', 'end']);
  });

  it('gives nothing for a friend that could not be compared or has no day', () => {
    const days = [
      { id: 'n', name: 'נועה', compare: dayWith({ by: 'none', endTogether: true, startTogether: true, windows: [window1115] }) },
      { id: 'y', name: 'יואב', compare: dayWith({ theirs: null, endTogether: true, windows: [window1115] }) },
      { id: 's', name: 'שירה', compare: dayWith({ mine: null, endTogether: true, windows: [window1115] }) },
    ];
    expect(todayBuddyLines(days, '07:00')).toEqual([]);
    expect(todayBuddyLines([], '07:00')).toEqual([]);
  });

  it('keeps each friend\'s id beside their name, so two friends of one name are still two', () => {
    const days = [
      { id: 'n1', name: 'נועה', compare: dayWith({ endTogether: true, windows: [window1115] }) },
      { id: 'n2', name: 'נועה', compare: dayWith({ endTogether: true, windows: [window1115] }) },
    ];
    expect(todayBuddyLines(days, '09:00')).toEqual([
      { kind: 'window', span: window1115, names: ['נועה', 'נועה'], ids: ['n1', 'n2'] },
      { kind: 'end', at: '14:00', names: ['נועה', 'נועה'], ids: ['n1', 'n2'] },
    ]);
  });
});

describe('namesList', () => {
  it('says names as Hebrew lists them', () => {
    expect(namesList(['נועה'])).toBe('נועה');
    expect(namesList(['נועה', 'יואב'])).toBe('נועה ויואב');
    expect(namesList(['נועה', 'יואב', 'שירה'])).toBe('נועה ועוד 2');
    expect(namesList(['נועה', 'יואב', 'שירה', 'אורי', 'דנה'])).toBe('נועה ועוד 4');
    expect(namesList([])).toBe('');
  });
});
