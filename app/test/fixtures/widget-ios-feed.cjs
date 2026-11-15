/** The day on the design's artboards, as the iPhone widget tests and `scripts/widget-ios-harness.cjs` see it. */
function lesson(hourIndex, subject, startTime, endTime, status = 'regular', detail = null) {
  return { hourIndex, subject, startTime, endTime, status, detail };
}
function day(date, weekdayName, lessons = [], extra = {}) {
  return {
    date, weekdayName, hebrewDate: 'י׳ בחשוון', isSchoolDay: true, holidayName: null,
    lessons, events: [], tasksDue: [], exams: [], changeCount: 0, ...extra,
  };
}

// Sunday 1.11.2026, the day on the design's artboards.
const sunday = [
  lesson(1, 'מתמטיקה', '08:00', '08:45'),
  lesson(2, 'אנגלית', '08:50', '09:35'),
  lesson(3, 'היסטוריה', '09:45', '10:30', 'cancelled', 'מבוטל'),
  lesson(4, 'ספרות', '10:40', '11:25', 'substitution', 'מ״מ: מר כהן'),
  lesson(5, 'פיזיקה', '11:30', '12:15', 'exam'),
  lesson(6, 'חינוך גופני', '12:20', '13:05'),
  lesson(7, 'ביולוגיה', '13:10', '13:55', 'regular', 'חדר 214'),
];
const exam = { subject: 'פיזיקה', date: '2026-11-01', daysAway: 0 };
const feed = {
  date: '2026-11-01',
  weekdayName: 'יום ראשון',
  hebrewDate: 'כ׳ בחשוון',
  lessons: sunday,
  nextEvent: null,
  tasksDueToday: [],
  openTasks: [
    { id: 't1', title: 'עבודה בהיסטוריה', due: '2026-10-30', listTitle: null },
    { id: 't2', title: 'לקרוא פרק 3', due: '2026-11-01', listTitle: null },
    { id: 't3', title: 'מצגת באנגלית', due: '2026-11-05', listTitle: null },
  ],
  openTaskCount: 3,
  nextExam: exam,
  upcomingExams: [exam, { subject: 'אנגלית', date: '2026-11-04', daysAway: 3 }],
  homeworkDue: [
    { key: 'h1', subject: 'מתמטיקה', text: 'תרגילים 1-5', due: '2026-11-02' },
    { key: 'h2', subject: 'אנגלית', text: 'Unit 4', due: '2026-11-02' },
  ],
  changeCount: 2,
  days: [
    day('2026-10-30', 'יום שישי'),
    day('2026-10-31', 'שבת', [], { isSchoolDay: false }),
    day('2026-11-01', 'יום ראשון', sunday, {
      exams: [exam], changeCount: 2,
      events: [{ summary: 'כדורסל', start: '2026-11-01T17:00:00+02:00', end: '2026-11-01T18:00:00+02:00', allDay: false }],
    }),
    day('2026-11-02', 'יום שני', [lesson(1, 'כימיה', '08:00', '08:45'), lesson(2, 'ערבית', '08:50', '09:35')]),
    day('2026-11-03', 'יום שלישי', [lesson(1, 'תנ״ך', '08:00', '08:45')]),
  ],
  generatedAt: '2026-11-01T07:12:00.000Z',
};

// Israel is UTC+2 in November; the tests build local times, so they hold in any zone.
const at = (date, hhmm) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0);
};

module.exports = { feed, sunday, at, now: at('2026-11-01', '09:00') };
