const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * Loads a module of app/src through Babel; its relative imports (planning →
 * format, planning → ../theme) load the same way, resolved from its folder.
 */
function loadSrc(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(file, module);
  const requireSrc = (id) => (id.startsWith('.') ? loadSrc(path.resolve(path.dirname(file), `${id}.ts`), cache) : require(id));
  new Function('module', 'exports', 'require', code)(module, module.exports, requireSrc);
  return module.exports;
}

const cache = new Map();
const pl = loadSrc(path.join(__dirname, '../src/lib/planning.ts'), cache);
const fmt = loadSrc(path.join(__dirname, '../src/lib/format.ts'), cache);
const theme = loadSrc(path.join(__dirname, '../src/theme.ts'), cache);

const exam = (date, subject, key = `${date}:${subject}`) => ({ naturalKey: key, date, subject, details: null, source: 'school_site' });
const homework = (dueDate, subject, done = false, key = `${dueDate}:${subject}`) => ({ naturalKey: key, dueDate, subject, text: 'לקרוא פרק 3', linkedTaskId: null, done });
const task = (id, due, completed = false, title = `משימה ${id}`) => ({ id, listId: 'l', listTitle: null, title, notes: null, due, completed, updated: null, linkedHomeworkKey: null });
const schoolEvent = (date, title) => ({ naturalKey: `${date}:${title}`, date, title, details: null, source: 'shahaf' });
const gcal = (id, start, allDay = false) => ({ id, calendarId: 'c', calendarName: null, seriesId: null, summary: `אירוע ${id}`, location: null, start, end: start, allDay });
const lesson = (hourIndex, startTime, subject = 'אנגלית') => ({ date: '2026-10-20', hourIndex, startTime, endTime: null, subject, teacher: null, room: null, status: 'regular', substitute: null, note: null, source: 'shahaf', changeSeenAt: null });

test('agendaMarks: one mark per kind per day; calendar events and empty days have none (W5-16)', () => {
  const agenda = {
    from: '2026-10-08',
    days: [
      { date: '2026-10-08', weekdayName: 'יום חמישי', items: [] },
      {
        date: '2026-10-09', weekdayName: 'יום שישי', items: [
          { kind: 'homework', homework: homework('2026-10-09', 'אנגלית') },
          { kind: 'homework', homework: homework('2026-10-09', 'היסטוריה') },
          { kind: 'task', task: task('t1', '2026-10-09') },
        ],
      },
      {
        date: '2026-10-20', weekdayName: 'יום שלישי', items: [
          // Out of the canonical order on purpose: the marks come back in MARK_KINDS order.
          { kind: 'calendar', event: gcal('g1', '2026-10-20T16:00:00+03:00') },
          { kind: 'event', event: schoolEvent('2026-10-20', 'טיול שנתי') },
          { kind: 'exam', exam: exam('2026-10-20', 'מבחן באנגלית'), daysAway: 12 },
        ],
      },
      { date: '2026-10-21', weekdayName: 'יום רביעי', items: [{ kind: 'event', event: schoolEvent('2026-10-21', 'יום ספורט') }] },
    ],
  };
  assert.deepEqual(pl.agendaMarks(agenda), {
    '2026-10-09': ['homework', 'task'],
    '2026-10-20': ['exam'],
  });
  assert.deepEqual(pl.agendaMarks(undefined), {});
});

test('agendaMarks: done homework and completed tasks leave no mark; an exam always does', () => {
  const agenda = {
    from: '2026-10-08',
    days: [
      { date: '2026-10-12', weekdayName: 'יום שני', items: [
        { kind: 'homework', homework: homework('2026-10-12', 'אנגלית', true) },
        { kind: 'task', task: task('t2', '2026-10-12', true) },
      ] },
      { date: '2026-10-13', weekdayName: 'יום שלישי', items: [
        { kind: 'task', task: task('t3', '2026-10-13', true) },
        { kind: 'exam', exam: exam('2026-10-13', 'מתמטיקה'), daysAway: 5 },
      ] },
    ],
  };
  assert.deepEqual(pl.agendaMarks(agenda), { '2026-10-13': ['exam'] });
  assert.deepEqual(pl.MARK_KINDS.map((k) => pl.MARK_LABELS[k]), ['מבחן', 'הגשה', 'משימה']);
});

/** `GET /settings` exams: every upcoming one, the hidden ones in it. */
const examOption = (date, subject, hidden = false) => ({ ...exam(date, subject), hidden, subjectKey: subject, match: { mine: true, reason: null } });

test('W5-15 (Noa): the month grid marks every exam of mine in any month, not only the agenda\'s 31 days', () => {
  const agenda = {
    from: '2026-10-08',
    days: [
      { date: '2026-10-09', weekdayName: 'יום שישי', items: [{ kind: 'homework', homework: homework('2026-10-09', 'אנגלית') }] },
      { date: '2026-10-20', weekdayName: 'יום שלישי', items: [
        { kind: 'task', task: task('t1', '2026-10-20') },
        { kind: 'exam', exam: exam('2026-10-20', 'אנגלית'), daysAway: 12 },
      ] },
    ],
  };
  const exams = [
    examOption('2026-10-20', 'אנגלית'),
    examOption('2026-10-21', 'פיזיקה'),
    examOption('2026-11-09', 'מתמטיקה'),
    examOption('2026-11-22', 'אנגלית'),
    examOption('2026-11-29', 'אזרחות', true),
  ];
  const marks = pl.monthMarks(agenda, exams);
  assert.deepEqual(marks, {
    '2026-10-09': ['homework'],
    // In the agenda already: the exam once, in the drawn order.
    '2026-10-20': ['exam', 'task'],
    '2026-10-21': ['exam'],
    // Past the agenda's last day (7.11): exams still marked.
    '2026-11-09': ['exam'],
    '2026-11-22': ['exam'],
  });
  // A homework day that also has an exam (outside the agenda's exams) gets it first.
  assert.deepEqual(pl.monthMarks(agenda, [examOption('2026-10-09', 'היסטוריה')])['2026-10-09'], ['exam', 'homework']);
  // The live hide-list wins over the flags the list was read with.
  assert.deepEqual(Object.keys(pl.monthMarks(undefined, exams, ['2026-11-09:מתמטיקה'])), ['2026-10-20', '2026-10-21', '2026-11-22', '2026-11-29']);
  assert.deepEqual(pl.monthMarks(undefined, []), {});
});

test('W5-15: the note under the grid only when it shows days past the agenda — the past does not count', () => {
  const span = { to: '2026-11-07' };
  assert.equal(pl.marksEndInView(span, ['2026-09-27', '2026-10-08', '2026-10-31']), null);
  assert.equal(pl.marksEndInView(span, ['2026-11-01', '2026-11-07']), null);
  assert.equal(pl.marksEndInView(span, ['2026-11-01', '2026-11-08']), '2026-11-07');
  assert.equal(pl.marksEndInView(null, ['2026-12-01']), null);
  const note = pl.marksEndNote('2026-11-07');
  assert.equal(`${note.lead}${note.date}${note.rest}`, 'אחרי 7.11 מסומנים רק מבחנים');
});

test('W5-16 (Itai): on the chosen day, its exams come before the timetable row', () => {
  const items = [
    { kind: 'exam', exam: exam('2026-10-20', 'אנגלית'), daysAway: 12 },
    { kind: 'homework', homework: homework('2026-10-20', 'פיזיקה') },
    { kind: 'calendar', event: gcal('gym', '2026-10-20T17:00:00+03:00') },
  ];
  const parts = pl.splitDayItems(items);
  assert.deepEqual(parts.exams.map((i) => i.kind), ['exam']);
  assert.deepEqual(parts.rest.map((i) => i.kind), ['homework', 'calendar']);
  assert.deepEqual(pl.splitDayItems([]), { exams: [], rest: [] });
});

test('weekSubtitle: words, never "שבוע +2"', () => {
  assert.equal(pl.weekSubtitle(0), 'השבוע');
  assert.equal(pl.weekSubtitle(1), 'שבוע הבא');
  assert.equal(pl.weekSubtitle(2), 'בעוד שבועיים');
  assert.equal(pl.weekSubtitle(3), 'בעוד 3 שבועות');
  assert.equal(pl.weekSubtitle(-1), 'שבוע שעבר');
  assert.equal(pl.weekSubtitle(-2), 'לפני שבועיים');
  assert.equal(pl.weekSubtitle(-4), 'לפני 4 שבועות');
});

test('weekHeading: the dates as the title, where the week stands (and its exams) as the subtitle', () => {
  assert.deepEqual(pl.weekHeading(1, '2026-10-18', '2026-10-23'), { title: '18–23.10', subtitle: 'שבוע הבא' });
  assert.deepEqual(pl.weekHeading(0, '2026-10-25', '2026-10-30', [{ examsToday: [] }]), { title: '25–30.10', subtitle: 'השבוע' });
  // Across a month boundary, with one exam and then two.
  assert.deepEqual(
    pl.weekHeading(2, '2026-11-29', '2026-12-04', [{ examsToday: [exam('2026-12-01', 'אנגלית')] }, { examsToday: [] }]),
    { title: '29.11–4.12', subtitle: 'בעוד שבועיים, מבחן אחד' },
  );
  assert.equal(
    pl.weekHeading(2, '2026-11-29', '2026-12-04', [{ examsToday: [exam('2026-12-01', 'אנגלית')] }, { examsToday: [exam('2026-12-02', 'פיזיקה')] }]).subtitle,
    'בעוד שבועיים, 2 מבחנים',
  );
});

test('run 8: a week the tab opened on by itself says why, and only then', () => {
  // This week's school is over: the tab shows next week, and says so in the same line.
  assert.deepEqual(pl.weekHeading(1, '2026-10-11', '2026-10-16', [], true), { title: '11–16.10', subtitle: 'שבוע הבא. השבוע נגמר' });
  assert.equal(
    pl.weekHeading(1, '2026-10-11', '2026-10-16', [{ examsToday: [exam('2026-10-13', 'אנגלית')] }], true).subtitle,
    'שבוע הבא, מבחן אחד. השבוע נגמר',
  );
  // Paged to by hand, or any other week: as before.
  assert.equal(pl.weekHeading(1, '2026-10-11', '2026-10-16', [], false).subtitle, 'שבוע הבא');
  assert.equal(pl.weekHeading(0, '2026-10-04', '2026-10-09', [], true).subtitle, 'השבוע');
});

test('weekOffsetOf / weekBounds: Sunday to Sunday, so a Friday still calls next Tuesday "next week"', () => {
  // Thursday 8.10.2026 is in the week of Sunday 4.10.
  assert.equal(pl.sundayOf('2026-10-08'), '2026-10-04');
  assert.equal(pl.sundayOf('2026-10-04'), '2026-10-04');
  assert.equal(pl.sundayOf('2026-10-10'), '2026-10-04');
  assert.equal(pl.weekOffsetOf('2026-10-08', '2026-10-08'), 0);
  assert.equal(pl.weekOffsetOf('2026-10-13', '2026-10-09'), 1);
  assert.equal(pl.weekOffsetOf('2026-10-20', '2026-10-08'), 2);
  assert.equal(pl.weekOffsetOf('2026-10-01', '2026-10-08'), -1);
  assert.equal(pl.weekOffsetOf('2027-01-05', '2026-12-30'), 1);
  assert.deepEqual(pl.weekBounds(0, '2026-10-08'), { startDate: '2026-10-04', endDate: '2026-10-09' });
  assert.deepEqual(pl.weekBounds(2, '2026-10-08'), { startDate: '2026-10-18', endDate: '2026-10-23' });
});

test('examTag: "מבחן" and the subject read out of the exam title, never "מבחן מבחן"', () => {
  assert.equal(pl.examTag([]), null);
  assert.deepEqual(pl.examTag([exam('2026-10-20', 'מבחן באנגלית')]), {
    text: 'מבחן אנג׳', subject: 'אנג׳', more: 0, label: 'מבחן: מבחן באנגלית',
  });
  assert.equal(pl.examTag([exam('2026-10-20', 'אנגלית 5 יח״ל (יב2)')]).text, 'מבחן אנג׳');
  assert.equal(pl.examTag([exam('2026-10-20', 'שרותי רשת (מעבדת מחשבים 1)')]).text, 'מבחן רשתות');
  assert.equal(pl.examTag([exam('2026-10-20', "מבחן גוש א'")]).text, 'מבחן גוש א׳');
  const two = pl.examTag([exam('2026-10-20', 'מתכונת במתמטיקה'), exam('2026-10-20', 'ביולוגיה')]);
  assert.equal(two.text, 'מבחן מתמ׳');
  assert.equal(two.more, 1);
  assert.equal(two.label, '2 מבחנים: מתכונת במתמטיקה, ביולוגיה');
});

test('timelineInOrder: lessons and events interleaved by time, all-day first, tasks last (B12)', () => {
  const rows = [
    { kind: 'lesson', sortKey: '08:00|1|01', lesson: lesson(1, '08:00') },
    { kind: 'lesson', sortKey: '08:50|1|02', lesson: lesson(2, '08:50') },
    { kind: 'lesson', sortKey: '10:15|1|03', lesson: lesson(3, '10:15') },
    { kind: 'task', sortKey: '23:59|3|', task: task('a', '2026-10-20') },
    { kind: 'task', sortKey: '23:59|3|', task: task('b', '2026-10-20') },
    { kind: 'event', sortKey: '09:30|2|', event: gcal('e930', '2026-10-20T09:30:00+03:00') },
    { kind: 'event', sortKey: '00:00|0|', event: gcal('allday', '2026-10-20', true) },
  ];
  const order = pl.timelineInOrder(rows).map((r) => (r.kind === 'lesson' ? `L${r.lesson.hourIndex}` : r.kind === 'event' ? r.event.id : r.task.id));
  assert.deepEqual(order, ['allday', 'L1', 'L2', 'e930', 'L3', 'a', 'b']);
  // A lesson and an event at the same minute: the lesson first, as on "היום שלי".
  const tie = pl.timelineInOrder([
    { kind: 'event', sortKey: '08:00|2|', event: gcal('e8', '2026-10-20T08:00:00+03:00') },
    { kind: 'lesson', sortKey: '08:00|1|01', lesson: lesson(1, '08:00') },
  ]);
  assert.deepEqual(tie.map((r) => r.kind), ['lesson', 'event']);
});

test('dayAgendaItems: the agenda order for a day the agenda does not cover; daysAway from today', () => {
  const day = {
    examsToday: [exam('2026-11-20', 'פיזיקה'), exam('2026-11-20', 'אנגלית')],
    homework: [homework('2026-11-20', 'היסטוריה')],
    events: [schoolEvent('2026-11-20', 'טיול')],
    timeline: [
      { kind: 'task', sortKey: '23:59|3|', task: task('t', '2026-11-20') },
      { kind: 'event', sortKey: '14:00|2|', event: gcal('late', '2026-11-20T14:00:00+02:00') },
      { kind: 'lesson', sortKey: '08:00|1|01', lesson: lesson(1, '08:00') },
      { kind: 'event', sortKey: '00:00|0|', event: gcal('allday', '2026-11-20', true) },
    ],
  };
  const items = pl.dayAgendaItems(day, '2026-10-08');
  assert.deepEqual(items.map(pl.agendaItemKey), [
    'exam:2026-11-20:אנגלית', 'exam:2026-11-20:פיזיקה', 'homework:2026-11-20:היסטוריה', 'task:t',
    'event:2026-11-20:טיול', 'calendar:c:allday', 'calendar:c:late',
  ]);
  assert.equal(items[0].daysAway, 43);
});

test('upcomingDays and agendaDay: 14 days from today, empty days skipped', () => {
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10);
    return { date, weekdayName: '', items: i % 5 === 0 ? [{ kind: 'task', task: task(`t${i}`, date) }] : [] };
  });
  const agenda = { from: '2026-10-08', to: '2026-11-07', days };
  assert.deepEqual(pl.upcomingDays(agenda, 14).map((d) => d.date), ['2026-10-08', '2026-10-13', '2026-10-18']);
  assert.equal(pl.agendaDay(agenda, '2026-10-13').items.length, 1);
  assert.equal(pl.agendaDay(agenda, '2026-11-20'), null);
  assert.equal(pl.agendaDay(undefined, '2026-10-13'), null);
});

test('relativeDayName, dayTitleParts, lessonSummary', () => {
  assert.equal(pl.relativeDayName('2026-10-08', '2026-10-08'), 'היום');
  assert.equal(pl.relativeDayName('2026-10-09', '2026-10-08'), 'מחר');
  assert.equal(pl.relativeDayName('2026-10-20', '2026-10-08'), 'יום שלישי');
  assert.deepEqual(pl.dayTitleParts('2026-10-20'), { name: 'יום שלישי', date: '20.10.2026' });

  const base = { isSchoolDay: true, holidayName: null, changeCount: 0, projected: false };
  const cancelled = { ...lesson(2, '08:50'), status: 'cancelled' };
  const timeline = [
    { kind: 'lesson', sortKey: '1', lesson: lesson(1, '08:00') },
    { kind: 'lesson', sortKey: '2', lesson: cancelled },
    { kind: 'lesson', sortKey: '3', lesson: lesson(3, '10:15') },
  ];
  // Plan §16.2: commas, not a chain of "·".
  assert.equal(pl.lessonSummary({ ...base, timeline, changeCount: 1 }), '2 שיעורים, שינוי אחד');
  assert.equal(pl.lessonSummary({ ...base, timeline: timeline.slice(0, 1), projected: true }), 'שיעור אחד, לפי המערכת הקבועה');
  assert.equal(pl.lessonSummary({ ...base, timeline, changeCount: 4, projected: true }), '2 שיעורים, 4 שינויים, לפי המערכת הקבועה');
  assert.equal(pl.lessonSummary({ ...base, timeline: [] }), 'אין עדיין מערכת ליום הזה');
  assert.equal(pl.lessonSummary({ ...base, isSchoolDay: false, holidayName: 'סוכות', timeline: [] }), 'סוכות');
  assert.equal(pl.lessonSummary({ ...base, isSchoolDay: false, timeline: [] }), 'אין לימודים');
});

// ---------------------------------------------------------------------------
// R-29, R-28: copy
// ---------------------------------------------------------------------------

test('R-29: a projected week reads "לפי המערכת הקבועה" and says why, never "צפוי"', () => {
  assert.equal(pl.PROJECTED_LABEL, 'לפי המערכת הקבועה');
  // Two facts, not the screen explaining itself ("אז מוצגת…", plan §16.2).
  assert.equal(pl.PROJECTED_NOTE, 'האתר עוד לא פרסם את השבוע הזה. השיעורים לפי המערכת הקבועה.');
  assert.ok(!pl.PROJECTED_NOTE.includes('אז מוצג'));
  const six = Array.from({ length: 6 }, (_, i) => ({ kind: 'lesson', sortKey: String(i), lesson: lesson(i + 1, null) }));
  assert.equal(
    pl.lessonSummary({ isSchoolDay: true, holidayName: null, changeCount: 0, projected: true, timeline: six }),
    '6 שיעורים, לפי המערכת הקבועה',
  );
});

test('R-28: the timetable row says it opens "היום שלי"', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ kind: 'lesson', sortKey: String(i), lesson: lesson(i + 1, null) }));
  const day = { isSchoolDay: true, holidayName: null, changeCount: 0, projected: false, timeline: six };
  // Plan §16.2: "ב" + "היום שלי" is "ביום שלי", with no ׳…׳ around the tab's name; sentences, not a dash.
  assert.deepEqual(pl.lessonsRowCopy(day), {
    title: 'מערכת השעות',
    summary: '6 שיעורים',
    note: null,
    action: 'לפתוח ביום שלי',
    label: 'מערכת השעות: 6 שיעורים. לפתוח ביום שלי',
  });
  assert.equal(pl.lessonsRowCopy({ ...day, isSchoolDay: false, holidayName: 'סוכות', timeline: [] }).label, 'מערכת השעות: סוכות. לפתוח ביום שלי');
  for (const text of [pl.OPEN_IN_TODAY, pl.lessonsRowCopy(day).label]) {
    assert.ok(!/[׳'"]/.test(text) && !text.includes('—') && !text.includes('·'), text);
  }
});

test('W4 (Maya): a projected day in planning says why it reads "לפי המערכת הקבועה"', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ kind: 'lesson', sortKey: String(i), lesson: lesson(i + 1, null) }));
  const day = { isSchoolDay: true, holidayName: null, changeCount: 0, projected: true, timeline: six };
  const copy = pl.lessonsRowCopy(day);
  assert.equal(copy.summary, '6 שיעורים, לפי המערכת הקבועה');
  assert.equal(copy.note, pl.PROJECTED_NOTE);
  assert.equal(copy.label, 'מערכת השעות: 6 שיעורים, לפי המערכת הקבועה. האתר עוד לא פרסם את השבוע הזה. השיעורים לפי המערכת הקבועה. לפתוח ביום שלי');
  // Without a site (plan Phase 3) every week is projected and no site is waited for: none is mentioned.
  assert.equal(pl.projectedNote(false), pl.PROJECTED_NOTE);
  assert.equal(pl.projectedNote(true), 'השיעורים לפי המערכת הקבועה ממשוב.');
  assert.equal(pl.lessonsRowCopy(day, true).note, 'השיעורים לפי המערכת הקבועה ממשוב.');
  assert.ok(!pl.lessonsRowCopy(day, true).label.includes('האתר'));
  // Nothing to explain on a day without lessons.
  assert.equal(pl.lessonsRowCopy({ ...day, timeline: [] }).note, null);
  assert.equal(pl.lessonsRowCopy({ ...day, isSchoolDay: false, holidayName: 'סוכות', timeline: [] }).note, null);
});

test('W4: the next lesson\'s task names its day, "משימה לשיעור של רביעי" (Wave 9 re-rate: no "·")', () => {
  assert.equal(pl.nextLessonTaskLabel('2026-10-09', '2026-10-08'), 'משימה לשיעור של מחר');
  assert.equal(pl.nextLessonTaskLabel('2026-10-11', '2026-10-08'), 'משימה לשיעור של ראשון');
  assert.equal(pl.nextLessonTaskLabel('2026-10-14', '2026-10-08'), 'משימה לשיעור של רביעי');
  assert.equal(pl.nextLessonTaskLabel('2026-10-08', '2026-10-08'), 'משימה לשיעור של היום');
  assert.equal(pl.nextLessonTaskLabel('2026-10-10', '2026-10-08'), 'משימה לשיעור של שבת');
});

test('new copy: plain words, counted with plural, no system words', () => {
  assert.equal(pl.hiddenEventsNote(0), null);
  assert.equal(pl.hiddenEventsNote(1), 'אירוע אחד לא מוצג');
  assert.equal(pl.hiddenEventsNote(4), '4 אירועים לא מוצגים');
  assert.equal(pl.upcomingEmptyText(false), 'אין מבחנים, הגשות או משימות בשבועיים הקרובים');
  assert.equal(pl.upcomingEmptyText(true), 'אין עוד מבחנים, הגשות או משימות בשבועיים הקרובים');
  assert.equal(pl.SHOWN_ABOVE, 'מוצג למעלה');
  const copy = [
    pl.PROJECTED_LABEL, pl.PROJECTED_NOTE, pl.OPEN_IN_TODAY, pl.SHOWN_ABOVE,
    pl.hiddenEventsNote(1), pl.hiddenEventsNote(2), pl.upcomingEmptyText(true), pl.upcomingEmptyText(false),
  ];
  for (const text of copy) {
    for (const banned of ['צפוי', 'שרת', 'סשן', 'סנכרון']) assert.ok(!text.includes(banned), `"${text}" says "${banned}"`);
  }
});

/** A source file with its comments taken out: what it says on screen, roughly. */
function codeOf(file) {
  return fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('R6 screens: no "צפוי", no system words, and no font set under the 12-point floor', () => {
  for (const file of ['screens/WeekScreen.tsx', 'screens/CalendarScreen.tsx', 'components/MonthCalendar.tsx', 'lib/planning.ts', 'screens/TasksScreen.tsx', 'components/TaskRow.tsx', 'components/ComposeTaskSheet.tsx', 'lib/planner.ts']) {
    const code = codeOf(file);
    for (const banned of ['צפוי', 'שרת', 'סשן', 'סנכרון']) assert.ok(!code.includes(banned), `${file} says "${banned}"`);
    for (const m of code.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)) {
      assert.ok(Number(m[1]) >= theme.MIN_FONT_SIZE, `${file}: fontSize ${m[1]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// R-28: "הקרוב אליי"
// ---------------------------------------------------------------------------

/** 8.10 (today) to 7.11; the 14-day window ends on 21.10. */
function planningAgenda() {
  const items = {
    '2026-10-08': [
      { kind: 'exam', exam: exam('2026-10-08', 'אנגלית'), daysAway: 0 },
      { kind: 'calendar', event: gcal('gym', '2026-10-08T17:00:00+03:00') },
    ],
    '2026-10-09': [{ kind: 'homework', homework: homework('2026-10-09', 'היסטוריה') }],
    '2026-10-10': [{ kind: 'event', event: schoolEvent('2026-10-10', 'צופים') }],
    '2026-10-13': [
      { kind: 'task', task: task('t13', '2026-10-13') },
      { kind: 'calendar', event: gcal('guitar', '2026-10-13T18:00:00+03:00') },
    ],
    '2026-10-21': [{ kind: 'exam', exam: exam('2026-10-21', 'פיזיקה'), daysAway: 13 }],
    '2026-10-22': [{ kind: 'task', task: task('t22', '2026-10-22') }],
  };
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10);
    return { date, weekdayName: '', items: items[date] ?? [] };
  });
  return { from: '2026-10-08', to: '2026-11-07', days };
}
const shape = (list) => list.groups.map((g) => `${g.date.slice(5)}${g.shownAbove ? '^' : ''}:${g.items.length}`);

test('upcomingList: today chosen — its items are above, so the list starts tomorrow; the window stays today + 13', () => {
  const list = pl.upcomingList(planningAgenda(), { days: 14, selected: '2026-10-08' });
  assert.deepEqual(shape(list), ['10-09:1', '10-10:1', '10-13:2', '10-21:1']);
  assert.equal(list.todayAbove, true);
  assert.equal(list.hidden, 0);
  // An empty today is not "above": nothing is repeated, and nothing is said about it.
  const quiet = planningAgenda();
  quiet.days[0].items = [];
  assert.equal(pl.upcomingList(quiet, { days: 14, selected: '2026-10-08' }).todayAbove, false);
});

test('upcomingList: a later chosen day keeps its heading as "shown above", not a second copy', () => {
  const list = pl.upcomingList(planningAgenda(), { days: 14, selected: '2026-10-13' });
  assert.deepEqual(shape(list), ['10-08:2', '10-09:1', '10-10:1', '10-13^:0', '10-21:1']);
  assert.equal(list.todayAbove, false);
  // A chosen day outside the window changes nothing: the same days as before R-28.
  const far = pl.upcomingList(planningAgenda(), { days: 14, selected: '2026-11-20' });
  assert.deepEqual(far.groups.map((g) => g.date), pl.upcomingDays(planningAgenda(), 14).map((d) => d.date));
  assert.ok(far.groups.every((g) => !g.shownAbove));
});

test('upcomingList: "רק בית ספר" hides only the calendar\'s events — the school\'s own stay (run 7, Noa)', () => {
  assert.deepEqual(
    ['exam', 'homework', 'classroom', 'task', 'event', 'calendar'].map((kind) => pl.isSchoolItem({ kind })),
    [true, true, true, true, true, false],
  );
  const list = pl.upcomingList(planningAgenda(), { days: 14, selected: '2026-10-08', schoolOnly: true });
  // 10.10's school event stays (the class trip and the parents' evening went with the filter in run 7).
  // 13.10 keeps the task, not the guitar.
  assert.deepEqual(shape(list), ['10-09:1', '10-10:1', '10-13:1', '10-21:1']);
  assert.ok(list.groups.flatMap((g) => g.items).every(pl.isSchoolItem));
  assert.ok(list.groups.flatMap((g) => g.items).some((i) => i.kind === 'event'));
  // The guitar; today's gym is above, with today, and not counted.
  assert.equal(list.hidden, 1);
  // A chosen day with only calendar events left after the filter has nothing above to point to.
  const agenda = planningAgenda();
  agenda.days[5].items = [{ kind: 'calendar', event: gcal('gym2', '2026-10-13T17:00:00+03:00') }];
  const eventsOnly = pl.upcomingList(agenda, { days: 14, selected: '2026-10-13', schoolOnly: true });
  assert.deepEqual(shape(eventsOnly), ['10-08:1', '10-09:1', '10-10:1', '10-21:1']);
  assert.equal(eventsOnly.hidden, 1);
});

test('run 7 (Daniel): the switch has Today\'s words', () => {
  assert.equal(pl.SCHOOL_ONLY_LABEL, 'רק בית ספר');
});

// ---------------------------------------------------------------------------
// Week grid: every label fits its cell, at 13 or 12 points, never smaller
// ---------------------------------------------------------------------------

/** Advance widths (thousandths of an em) straight from a TrueType font's cmap and hmtx tables. */
function fontAdvances(file, chars) {
  const buf = fs.readFileSync(file);
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i += 1) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const unitsPerEm = buf.readUInt16BE(tables.head + 18);
  const metrics = buf.readUInt16BE(tables.hhea + 34);
  let sub = null;
  for (let i = 0; i < buf.readUInt16BE(tables.cmap + 2); i += 1) {
    const off = tables.cmap + buf.readUInt32BE(tables.cmap + 8 + i * 8);
    if (buf.readUInt16BE(off) === 4) { sub = off; break; }
  }
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const glyph = (cp) => {
    for (let s = 0; s < segX2 / 2; s += 1) {
      if (cp > buf.readUInt16BE(ends + s * 2)) continue;
      const start = buf.readUInt16BE(starts + s * 2);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltas + s * 2);
      const range = buf.readUInt16BE(ranges + s * 2);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + s * 2 + range + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const out = {};
  for (const ch of chars) {
    const g = Math.min(glyph(ch.codePointAt(0)), metrics - 1);
    out[ch] = Math.round((buf.readUInt16BE(tables.hmtx + g * 4) * 1000) / unitsPerEm);
  }
  return out;
}

test('textWidth: the width table is the Assistant the app ships, letter for letter (plan §16)', () => {
  const assistant = path.dirname(require.resolve('@expo-google-fonts/assistant'));
  const chars = [...'אבגדהוזחטיךכלםמןנסעףפץצקרשת׳״ +\'"-.,·():0123456789'];
  const fonts = { medium: '500Medium/Assistant_500Medium.ttf', semi: '600SemiBold/Assistant_600SemiBold.ttf' };
  for (const [weight, file] of Object.entries(fonts)) {
    const font = fontAdvances(path.join(assistant, file), chars);
    for (const ch of chars) assert.equal(pl.textWidth(ch, 1000, weight), font[ch], `${weight} "${ch}"`);
  }
  // The script that prints the tables reads the same files the same way.
  const script = require('../scripts/font-widths.cjs');
  assert.deepEqual(new Set(script.CHARS), new Set(chars));
  assert.deepEqual(script.fontAdvances(path.join(assistant, fonts.semi)), fontAdvances(path.join(assistant, fonts.semi), chars));
  // Isolates draw nothing; an unknown letter is measured wide, never narrow.
  assert.equal(pl.textWidth('⁦+1⁩', 1000), pl.textWidth('+1', 1000));
  assert.ok(pl.textWidth('W', 1000) >= 650);
});

/** The real names behind every short form `shortSubject` knows, and the block exams. */
const KNOWN_SUBJECTS = [
  'חינוך גופני', 'תנ"ך', 'מדעי המחשב', 'שרותי רשת (מעבדת מחשבים 1)', 'מערכות רפואיות', 'עולם הערבים', 'כישורי חיים',
  'מחשבת ישראל', 'מתמטיקה', 'אנגלית 5 יח״ל (יב2)', 'היסטוריה', 'פיזיקה מורחב (מעבדת פיסיקה)', 'ביולוגיה', 'גיאוגרפיה',
  'כימיה', 'אזרחות', 'ספרות', 'מוזיקה', 'אמנות', 'ערבית', 'עברית', 'לשון', 'חינוך', "מבחן גוש א'", "מבחן גוש ב'",
];
/** First words that are no known subject, as they come from the site. */
const OTHER_SUBJECTS = ['תקשורת חזותית', 'אקדמיזציה (יב)', '3 אקדמיזציה'];

test('week grid on a 360-point phone: every known short form fits whole at 12, so nothing is cut', () => {
  // The grid's usual size is the type scale's caption (run 8: 13 was the app's smallest text),
  // then one step down, then the floor.
  assert.equal(pl.GRID_FONT_SIZE, 14);
  assert.equal(pl.GRID_FONT_SIZE, theme.type.caption);
  assert.deepEqual(pl.GRID_FONT_SIZES, [pl.GRID_FONT_SIZE, 13, theme.MIN_FONT_SIZE]);
  assert.ok(pl.GRID_FONT_SIZES.every((size) => size >= theme.MIN_FONT_SIZE));
  const width = pl.gridTextWidth(360);
  assert.ok(Math.abs(width - (302 / 6 - 7)) < 1e-9, `text width ${width}`);
  for (const name of KNOWN_SUBJECTS) {
    const short = fmt.shortSubject(name);
    for (const weight of ['medium', 'semi']) {
      assert.ok(pl.fitsWidth(short, theme.MIN_FONT_SIZE, width, 1, weight), `${short} (${weight}) is ${pl.textWidth(short, 12, weight).toFixed(1)}`);
      assert.equal(pl.fitGridLabel(short, theme.MIN_FONT_SIZE, width, 1, weight), short);
    }
  }
});

test('week grid: one size for the grid — 14 when every label fits, else 13, else 12, never below', () => {
  const narrow = pl.gridTextWidth(360);
  const wide = pl.gridTextWidth(412);
  const labels = (names) => names.map((n) => ({ text: fmt.shortSubject(n) }));
  // R7's flagged cases: "כישורים" and "תקשורת" were clipped at 13 in a 360-point column in Heebo.
  // Assistant's narrower letters (plan §16) fit "כישורים" whole at 14, and "תקשורת" at 13.
  assert.equal(pl.gridFontSize(labels(['כישורי חיים', 'אנגלית']), narrow), 14);
  assert.equal(pl.gridFontSize(labels(['תקשורת חזותית']), narrow), 13);
  assert.equal(pl.fitGridLabel('כישורים', 13, narrow), 'כישורים');
  assert.equal(pl.fitGridLabel('תקשורת', 13, narrow), 'תקשורת');
  // A word that fits only at 12 takes the whole grid to 12.
  assert.ok(!pl.fitsWidth('היסטוריה', 13, narrow) && pl.fitsWidth('היסטוריה', 12, narrow));
  assert.equal(pl.gridFontSize([{ text: 'כישורים' }, { text: 'היסטוריה' }], narrow), 12);
  // "מחשבת" in an exam tag (semibold) fits at 14, so a grid of short words stays at 14.
  assert.equal(pl.gridFontSize([{ text: 'מחשבת', weight: 'semi' }, { text: 'אנג׳' }], narrow), 14);
  // A wider phone draws everything at 14.
  assert.equal(pl.gridFontSize(labels([...KNOWN_SUBJECTS, 'תקשורת חזותית']), wide), 14);
  // Nothing that is too wide pushes the size under the floor.
  assert.equal(pl.gridFontSize([{ text: 'אקדמיזציה' }], narrow), theme.MIN_FONT_SIZE);
  assert.equal(pl.gridFontSize([{ text: 'אקדמיזציה' }], 5), theme.MIN_FONT_SIZE);
});

test('week grid: a word too long even at 12 is cut after whole letters and marked with a geresh', () => {
  const width = pl.gridTextWidth(360);
  const cut = pl.fitGridLabel(fmt.shortSubject('3 אקדמיזציה'), 12, width);
  assert.ok(cut.startsWith('אקדמ') && cut.endsWith('׳'), cut);
  assert.ok(pl.fitsWidth(cut, 12, width), cut);
  // As long as fits: one more letter would not.
  assert.ok(!pl.fitsWidth(`${'אקדמיזציה'.slice(0, cut.length)}׳`, 12, width));
  // Never down to one letter.
  assert.equal(pl.fitGridLabel('אקדמיזציה', 12, 1), 'אק׳');
});

test('week grid: with the phone\'s text made larger, labels still fit (capped at 1.3×)', () => {
  assert.equal(pl.gridFontScale(0.85), 1);
  assert.equal(pl.gridFontScale(1.15), 1.15);
  assert.equal(pl.gridFontScale(2), pl.WEEK_GRID.maxFontScale);
  const width = pl.gridTextWidth(360);
  const scale = pl.gridFontScale(2);
  for (const name of [...KNOWN_SUBJECTS, ...OTHER_SUBJECTS]) {
    const label = pl.fitGridLabel(fmt.shortSubject(name), 12, width, scale);
    assert.ok(pl.fitsWidth(label, 12, width, scale), `${name} → ${label}`);
  }
  // Cut after whole letters: one letter more than Heebo's "כישור׳" fits in Assistant.
  assert.equal(pl.fitGridLabel('כישורים', 12, width, scale), 'כישורי׳');
});

test('week grid: the exam tag fits — "מבחן +9" on one line at 12, "+9" on its own line when it does not', () => {
  const width = pl.gridTextWidth(360);
  assert.deepEqual(pl.examTagMore({ more: 0 }, 13, width), { more: null, inline: true });
  assert.deepEqual(pl.examTagMore({ more: 9 }, 12, width), { more: '+9', inline: true });
  // Assistant fits "מבחן +9" at 13 too (Heebo did not); a larger text size does not.
  assert.deepEqual(pl.examTagMore({ more: 9 }, 13, width), { more: '+9', inline: true });
  assert.deepEqual(pl.examTagMore({ more: 9 }, 13, width, 1.15), { more: '+9', inline: false });
  assert.ok(pl.fitsWidth('מבחן', 13, width, 1.15) && pl.fitsWidth('+9', 13, width, 1.15));
  // The tag's subject line is measured in its own (semibold) weight.
  for (const name of KNOWN_SUBJECTS) {
    const tag = pl.examTag([exam('2026-10-20', name)]);
    assert.ok(pl.fitsWidth(pl.fitGridLabel(tag.subject, 12, width, 1, 'semi'), 12, width, 1, 'semi'), tag.subject);
  }
});

// ---------------------------------------------------------------------------
// R-28: the month grid's marks
// ---------------------------------------------------------------------------

test('month marks: at least 8 points, and exam, homework and task fit one row of a day on a 360-point phone', () => {
  assert.ok(pl.MARK_SIZE >= 8);
  for (const kind of pl.MARK_KINDS) {
    const box = pl.markBox(kind);
    assert.ok(box.width >= 8, `${kind} is ${box.width} wide`);
    assert.ok(box.height >= 8, `${kind} is ${box.height} tall`);
  }
  // Planning tab since Wave 9: the month on the page with 16-point margins, seven days side by
  // side, no card and no tiles. Every day is still a full touch target, and the pen's ring
  // (`PEN_OUTSET` past a 28-point number) fits it. The exam is now the number's highlighter, but all
  // three marks still fit one row.
  const cell = (360 - 2 * 16) / 7;
  assert.ok(cell >= 44, `a day is ${cell.toFixed(1)} wide`);
  assert.ok(28 + 2 * 9 <= cell, 'the pen ring fits a day');
  assert.ok(pl.marksRowWidth(pl.MARK_KINDS) <= cell, `${pl.marksRowWidth(pl.MARK_KINDS)} in ${cell.toFixed(1)}`);
  assert.equal(pl.marksRowWidth([]), 0);
});

test('W4-10: exams and homework stand out, larger than a task; W5-16: no event mark at all', () => {
  const exam = pl.markBox('exam');
  const hw = pl.markBox('homework');
  const taskMark = pl.markBox('task');
  assert.ok(exam.width > taskMark.width && exam.height > taskMark.height);
  assert.ok(hw.width > taskMark.width && hw.height > taskMark.height);
  assert.ok(exam.width >= hw.width, 'the exam is the largest');
  // Drawn side by side, in order.
  assert.deepEqual(pl.markLayout(['task', 'exam']), ['exam', 'task']);
  assert.deepEqual(pl.markLayout(['homework']), ['homework']);
  assert.deepEqual(pl.markLayout([]), []);
  assert.ok(!pl.MARK_KINDS.includes('event'));
  assert.equal(pl.markOf({ kind: 'calendar', event: gcal('gym', '2026-10-20T17:00:00+03:00') }), null);
  assert.equal(pl.markOf({ kind: 'event', event: schoolEvent('2026-10-21', 'יום ספורט') }), null);
});

test('W4 (Noa): the date picker marks the exam days', () => {
  assert.deepEqual(pl.examDayMarks([exam('2026-11-09', 'מתמטיקה'), exam('2026-11-09', 'פיזיקה'), exam('2026-10-20', 'אנגלית')]), {
    '2026-11-09': ['exam'],
    '2026-10-20': ['exam'],
  });
  assert.deepEqual(pl.examDayMarks([]), {});
});

// ---------------------------------------------------------------------------
// W4-9: the week grid's period column, its days and its labels
// ---------------------------------------------------------------------------

const lessonOn = (date, hourIndex, startTime, subject = 'אנגלית') => ({ ...lesson(hourIndex, startTime, subject), date });
const dayOf = (date, lessons, extra = {}) => ({
  date,
  examsToday: [],
  timeline: lessons.map((l, i) => ({ kind: 'lesson', sortKey: String(i), lesson: l })),
  ...extra,
});

test('W4-9: each period shows the start time most of its lessons have', () => {
  const days = [
    dayOf('2026-10-18', [lessonOn('2026-10-18', 1, '08:00'), lessonOn('2026-10-18', 2, '08:45')]),
    dayOf('2026-10-19', [lessonOn('2026-10-19', 1, '8:00'), lessonOn('2026-10-19', 2, '08:45:00')]),
    // A shorter Friday does not move the week's times.
    dayOf('2026-10-23', [lessonOn('2026-10-23', 1, '08:10'), lessonOn('2026-10-23', 3, null)]),
  ];
  assert.deepEqual(pl.periodStartTimes(days), { 1: '08:00', 2: '08:45' });
  // A tie goes to the earlier time.
  assert.deepEqual(pl.periodStartTimes([dayOf('2026-10-18', [lessonOn('2026-10-18', 4, '10:30'), lessonOn('2026-10-18', 4, '10:15')])]), { 4: '10:15' });
  assert.deepEqual(pl.periodStartTimes([]), {});
});

test('W4-9: the period column grows to fit its times, and the day columns share what is left', () => {
  assert.equal(pl.hourColumnWidth([]), pl.WEEK_GRID.hourColumn);
  const width = pl.hourColumnWidth(['08:00', '14:10']);
  assert.ok(width >= pl.textWidth('08:00', pl.HOUR_TIME_SIZE) + 2 * pl.WEEK_GRID.hourPadding);
  assert.ok(pl.hourColumnWidth(['08:00'], 1.495) > width, 'larger text, wider column');
  // The colon is measured from the font too (see the width-table test).
  assert.equal(pl.textWidth(':', 1000), 253);
  assert.equal(pl.textWidth(':', 1000, 'semi'), 264);
  // A wider period column narrows the day columns; five days are wider than six.
  assert.ok(pl.gridTextWidth(360, 6, width) < pl.gridTextWidth(360, 6));
  assert.ok(pl.gridTextWidth(360, 5, width) > pl.gridTextWidth(360, 6));
});

test('W4-9: a Friday without lessons or exams is left out of the grid, unless it is the chosen day', () => {
  const week = [
    dayOf('2026-10-18', [lessonOn('2026-10-18', 1, '08:00')]),
    dayOf('2026-10-19', []),
    dayOf('2026-10-23', []),
  ];
  assert.deepEqual(pl.weekGridDays(week).map((d) => d.date), ['2026-10-18', '2026-10-19']);
  assert.deepEqual(pl.weekGridDays(week, '2026-10-23').map((d) => d.date), ['2026-10-18', '2026-10-19', '2026-10-23']);
  const fridayLessons = [...week.slice(0, 2), dayOf('2026-10-23', [lessonOn('2026-10-23', 1, '08:00')])];
  assert.equal(pl.weekGridDays(fridayLessons).length, 3);
  const fridayExam = [...week.slice(0, 2), dayOf('2026-10-23', [], { examsToday: [exam('2026-10-23', 'אנגלית')] })];
  assert.equal(pl.weekGridDays(fridayExam).length, 3);
  // The column's letter comes from its date, not its place.
  assert.deepEqual(['2026-10-18', '2026-10-22', '2026-10-23'].map(pl.dayLetter), ['א׳', 'ה׳', 'ו׳']);
});

test('W6-5: one label per subject — whole when its own name fits the column, the short form only for the others', () => {
  const wide = pl.gridTextWidth(412, 5);
  const narrow = pl.gridTextWidth(360, 6, pl.hourColumnWidth(['08:00']));
  // Short words only: whole names fit, and an exam reads like its subject's lessons.
  const plain = pl.gridLabels(['אנגלית 5 יח״ל (יב2)', 'פיזיקה מורחב (מעבדת פיסיקה)', 'אזרחות'], ['מבחן באנגלית'], wide);
  assert.equal(plain.full, true);
  assert.equal(plain.label('אנגלית 5 יח״ל (יב2)'), 'אנגלית');
  assert.equal(plain.label('מבחן באנגלית'), 'אנגלית');
  assert.equal(plain.label('פיזיקה מורחב (מעבדת פיסיקה)'), 'פיזיקה');
  // Six days on a 360-point phone: "אזרחות" still fits whole; "מתמטיקה" and "שרותי רשת" do not.
  // Until W6 the one long name sent every subject to its short form (Daniel, run 5: "מתמ׳, אנג׳, פיז׳, היסט׳…").
  const mixed = pl.gridLabels(['מתמטיקה', 'שרותי רשת (מעבדת מחשבים 1)', 'אזרחות'], ['בגרות במתמטיקה'], narrow);
  assert.equal(mixed.full, false);
  assert.equal(mixed.label('אזרחות'), 'אזרחות');
  assert.equal(mixed.label('מתמטיקה'), 'מתמ׳');
  assert.equal(mixed.label('בגרות במתמטיקה'), 'מתמ׳', 'an exam reads like its lessons');
  assert.equal(mixed.label('שרותי רשת (מעבדת מחשבים 1)'), 'רשתות');
  // The usual week, five days on a 393-point phone: "מתמטיקה" is whole, and in Assistant (plan §16)
  // "שרותי רשת" too; "מערכות רפואיות" alone is short.
  const usualNames = ['מתמטיקה 5 יח"ל (יב2)', 'שרותי רשת (מעבדת מחשבים 1)', 'מערכות רפואיות', 'היסטוריה'];
  const usual = pl.gridLabels(usualNames, [], pl.gridTextWidth(393, 5, pl.hourColumnWidth(['08:00'])));
  // 13, not the usual 14 (run 8): at 14 "שרותי רשת" would be cut, and a whole word wins over a size.
  assert.equal(usual.fontSize, 13);
  // Short words on a wide phone take the usual 14.
  assert.equal(plain.fontSize, 14);
  assert.deepEqual(usualNames.map(usual.label), ['מתמטיקה', 'שרותי רשת', 'רפואה', 'היסטוריה']);
  // A whole word at 12 reads better than a short form at 13: five days on 360 points.
  // (Heebo's case was "מתמטיקה", which Assistant fits whole at 13.)
  const smaller = pl.gridLabels(['שרותי רשת (מעבדת מחשבים 1)', 'אנגלית'], [], pl.gridTextWidth(360, 5, pl.hourColumnWidth(['08:00'])));
  assert.equal(smaller.fontSize, 12);
  assert.equal(smaller.label('שרותי רשת (מעבדת מחשבים 1)'), 'שרותי רשת');
  // Whatever the mode, the size is one of the grid's.
  for (const labels of [plain, mixed, usual, smaller]) {
    assert.ok(pl.GRID_FONT_SIZES.includes(labels.fontSize));
  }
  for (const name of KNOWN_SUBJECTS) {
    const labels = pl.gridLabels([name], [], narrow, pl.gridFontScale(1.3, 1.3));
    assert.ok(pl.fitsWidth(labels.label(name), labels.fontSize, narrow, pl.gridFontScale(1.3, 1.3), 'semi'), `${name} → ${labels.label(name)}`);
  }
});

test('own names in the grid: written as typed when they fit, else cut there with a geresh, never put to a short form', () => {
  const wide = pl.gridTextWidth(412, 5);
  const narrow = pl.gridTextWidth(360, 6, pl.hourColumnWidth(['08:00']));
  const own = new Set(['פיזיקה (ב)', 'בוחן פתע']);
  const labels = pl.gridLabels(['פיזיקה (ב)', 'אנגלית 5 יח״ל (יב2)'], ['בוחן פתע', 'מבחן באנגלית'], wide, 1, own);
  assert.equal(labels.label('פיזיקה (ב)'), 'פיזיקה (ב)');
  assert.equal(labels.label('בוחן פתע'), 'בוחן פתע');
  // The school's names as ever.
  assert.equal(labels.label('אנגלית 5 יח״ל (יב2)'), 'אנגלית');
  assert.equal(labels.label('מבחן באנגלית'), 'אנגלית');
  // Too long for the column: cut where it ends, with a geresh, as `fitGridLabel` cuts — not "פיז׳".
  const long = 'פיזיקה של המעבדה הגדולה';
  const tight = pl.gridLabels([long], [], narrow, 1, new Set([long]));
  const cut = tight.label(long);
  assert.notEqual(cut, long);
  assert.ok(long.startsWith(cut.slice(0, -1)), cut);
  assert.ok(cut.endsWith('׳'), cut);
  assert.ok(pl.fitsWidth(cut, tight.fontSize, narrow, 1, 'semi'), cut);
  // Without the set, nothing changes for anyone.
  assert.equal(pl.gridLabels(['פיזיקה (ב)'], [], wide).label('פיזיקה (ב)'), 'פיזיקה');
});

test('W4-9: the grid grows with the app\'s text size only to 1.15, on top of the phone\'s to 1.3', () => {
  assert.equal(pl.gridFontScale(1, 1), 1);
  assert.equal(pl.gridFontScale(1, 1.3), pl.WEEK_GRID.maxAppScale);
  assert.ok(Math.abs(pl.gridFontScale(2, 1.3) - pl.WEEK_GRID.maxFontScale * pl.WEEK_GRID.maxAppScale) < 1e-9);
  assert.equal(pl.WEEK_GRID.maxAppScale, 1.15);
});

// ---------------------------------------------------------------------------
// W5-17: the week tab
// ---------------------------------------------------------------------------

/** A lesson of this week (4–9.10) that ends at `endTime`. */
const held = (date, hourIndex, endTime, status = 'regular') => ({ ...lesson(hourIndex, null), date, endTime, status });
const weekOf = (lessonsByDate) => ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
  .map((date) => dayOf(date, lessonsByDate[date] ?? []));
const at = (h, m = 0) => h * 60 + m;

test('W5-17 (Itai): the week tab opens on next week once Thursday\'s last lesson is over, and through Saturday', () => {
  const week = weekOf({
    '2026-10-04': [held('2026-10-04', 1, '08:45'), held('2026-10-04', 6, '13:45')],
    '2026-10-08': [held('2026-10-08', 1, '08:45'), held('2026-10-08', 5, '12:30'), held('2026-10-08', 6, '13:15', 'cancelled')],
  });
  // Sunday to Wednesday: this week.
  assert.equal(pl.opensOnNextWeek(week, '2026-10-04', at(21)), false);
  assert.equal(pl.opensOnNextWeek(week, '2026-10-07', at(21)), false);
  // Thursday: until the last lesson that takes place ends (the cancelled 6th does not count).
  assert.equal(pl.opensOnNextWeek(week, '2026-10-08', at(12, 29)), false);
  assert.equal(pl.opensOnNextWeek(week, '2026-10-08', at(12, 30)), true);
  assert.equal(pl.opensOnNextWeek(week, '2026-10-08', at(21)), true);
  // Friday and Saturday: next week, with or without the week in hand.
  assert.equal(pl.opensOnNextWeek(week, '2026-10-09', at(9)), true);
  assert.equal(pl.opensOnNextWeek(null, '2026-10-09', at(9)), true);
  assert.equal(pl.opensOnNextWeek(null, '2026-10-10', at(9)), true);
  // Before the week arrives, Thursday stays put.
  assert.equal(pl.opensOnNextWeek(null, '2026-10-08', at(21)), false);
});

test('W5-17: a Friday with lessons, lessons without times ("8:00:00" too), and a week without lessons', () => {
  const friday = weekOf({
    '2026-10-08': [held('2026-10-08', 6, '13:45')],
    '2026-10-09': [held('2026-10-09', 1, '8:45:00'), held('2026-10-09', 3, '10:30:00')],
  });
  assert.equal(pl.opensOnNextWeek(friday, '2026-10-08', at(21)), false, 'Friday still has school');
  assert.equal(pl.opensOnNextWeek(friday, '2026-10-09', at(10, 29)), false);
  assert.equal(pl.opensOnNextWeek(friday, '2026-10-09', at(10, 30)), true);
  const untimed = weekOf({ '2026-10-08': [held('2026-10-08', 1, null)] });
  assert.equal(pl.opensOnNextWeek(untimed, '2026-10-08', pl.SCHOOL_OVER_FALLBACK - 1), false);
  assert.equal(pl.opensOnNextWeek(untimed, '2026-10-08', pl.SCHOOL_OVER_FALLBACK), true);
  // Every lesson of Thursday cancelled: Wednesday's were the week's last.
  const cancelled = weekOf({
    '2026-10-07': [held('2026-10-07', 1, '08:45')],
    '2026-10-08': [held('2026-10-08', 1, '08:45', 'cancelled')],
  });
  assert.equal(pl.opensOnNextWeek(cancelled, '2026-10-08', at(7)), true);
  const holiday = weekOf({});
  assert.equal(pl.opensOnNextWeek(holiday, '2026-10-07', at(21)), false);
  assert.equal(pl.opensOnNextWeek(holiday, '2026-10-08', at(7)), true);
});

test('W5-17 (Daniel): at "גדול מאוד" the week is a list of days; below it, the grid', () => {
  assert.equal(pl.weekListMode(1, 1), false);
  assert.equal(pl.weekListMode(1, 1.15), false);
  assert.equal(pl.weekListMode(1.15, 1), false);
  assert.equal(pl.weekListMode(1, 1.3), true);
  assert.equal(pl.weekListMode(1.3, 1), true);
  assert.equal(pl.weekListMode(1.15, 1.15), true);
  assert.equal(pl.weekListMode(0.85, 1.3), true);
  // Below the list's size the grid draws every subject on a 360-point phone, the period column
  // with its times, Friday left out (the usual week): whole where the name fits (W6-5), else its
  // known short form whole — never cut.
  const scale = pl.gridFontScale(1, 1.15);
  const width = pl.gridTextWidth(360, 5, pl.hourColumnWidth(['08:00', '13:45'], scale));
  const blocks = KNOWN_SUBJECTS.filter((name) => name.includes('גוש'));
  const lessons = KNOWN_SUBJECTS.filter((name) => !blocks.includes(name));
  const labels = pl.gridLabels(lessons, blocks, width, scale);
  for (const name of lessons) {
    const whole = fmt.stripGroup(name);
    const expected = pl.fitsWidth(whole, labels.fontSize, width, scale, 'semi') ? whole : fmt.shortSubject(name);
    assert.equal(labels.label(name), expected, name);
  }
  for (const name of blocks) assert.equal(labels.label(name), fmt.shortSubject(name), name);
  assert.ok(lessons.some((name) => labels.label(name) === fmt.stripGroup(name) && fmt.stripGroup(name) !== fmt.shortSubject(name)), 'some subject is whole');
});

test('W5-17: the day detail names the homework due and still open', () => {
  assert.equal(pl.homeworkDueLabel({ homework: [homework('2026-10-08', 'פיזיקה מורחב (יב2)'), homework('2026-10-08', 'אנגלית')] }), 'להגשה: פיזיקה, אנגלית');
  assert.equal(pl.homeworkDueLabel({ homework: [homework('2026-10-08', 'אנגלית', true)] }), null);
  assert.equal(pl.homeworkDueLabel({ homework: [homework('2026-10-08', 'אנגלית'), homework('2026-10-08', 'אנגלית', false, 'k2')] }), 'להגשה: אנגלית');
  assert.equal(pl.homeworkDueLabel({}), null);
});

// ---------------------------------------------------------------------------
// Run 5 (Noa): the week after "הוסף למשימות שלי", and the hidden Friday
// ---------------------------------------------------------------------------

/** A task row of a day's timeline; `linked` is the homework it was made from. */
const taskItem = (id, title, { linked = null, completed = false } = {}) => (
  { kind: 'task', sortKey: `23:59|${id}`, task: { ...task(id, '2026-10-11', completed, title), linkedHomeworkKey: linked } }
);

test('run 5 (Noa): homework turned into a task still counts as due — the square and "להגשה" stay', () => {
  // The day view leaves the English homework out once it is a task (R-5); the task stands for it.
  const sunday = {
    homework: [homework('2026-10-11', 'שרותי רשת (מעבדת מחשבים 1)')],
    timeline: [taskItem('t-en', 'אנגלית: לקרוא את הטקסט ביחידה 3', { linked: 'hw-en' })],
  };
  assert.deepEqual(pl.homeworkDueNames(sunday), ['שרותי רשת', 'אנגלית']);
  assert.equal(pl.hasHomeworkDue(sunday), true);
  assert.equal(pl.homeworkDueLabel(sunday), 'להגשה: שרותי רשת, אנגלית');
  // The task alone, with the other homework hidden: still due.
  const onlyTask = { homework: [], timeline: sunday.timeline };
  assert.equal(pl.hasHomeworkDue(onlyTask), true);
  assert.equal(pl.homeworkDueLabel(onlyTask), 'להגשה: אנגלית');
});

test('run 5: only open tasks made from homework count; each subject once', () => {
  const done = { homework: [], timeline: [taskItem('t1', 'אנגלית: יחידה 3', { linked: 'hw-en', completed: true })] };
  assert.equal(pl.hasHomeworkDue(done), false);
  assert.equal(pl.homeworkDueLabel(done), null);
  // A task of the student's own is not homework due.
  const own = { homework: [], timeline: [taskItem('t2', 'להביא אישור לטיול')] };
  assert.equal(pl.hasHomeworkDue(own), false);
  // English as homework and as a task made from other English homework: named once, homework first.
  const both = {
    homework: [homework('2026-10-11', 'אנגלית 5 יח״ל (יב2)')],
    timeline: [taskItem('t3', 'אנגלית: חיבור', { linked: 'hw-en-2' }), taskItem('t4', 'פיזיקה: שאלות 10–14', { linked: 'hw-ph' })],
  };
  assert.deepEqual(pl.homeworkDueNames(both), ['אנגלית', 'פיזיקה']);
  // A server older than the contract: no homework, no timeline.
  assert.deepEqual(pl.homeworkDueNames({}), []);
  assert.equal(pl.hasHomeworkDue({ homework: [homework('2026-10-11', 'אנגלית', true)] }), false);
});

test('run 5: a task made from homework is named by the subject its title starts with', () => {
  assert.equal(pl.linkedTaskSubject('אנגלית: לקרוא את הטקסט ביחידה 3'), 'אנגלית');
  assert.equal(pl.linkedTaskSubject('  היסטוריה:  פרק 2 '), 'היסטוריה');
  // The subject alone (homework without text), or a title renamed since: the title itself.
  assert.equal(pl.linkedTaskSubject('אזרחות'), 'אזרחות');
  assert.equal(pl.linkedTaskSubject('בשעה 08:00 להביא'), 'בשעה 08:00 להביא');
  const long = pl.linkedTaskSubject('לסיים את העבודה על המהפכה הצרפתית ולהגיש אותה בזמן');
  assert.ok(long.length <= 30 && long.endsWith('…'), long);
});

/** 11–16.10: lessons Sunday to Thursday, Friday empty — the week Noa saw. */
const noaWeek = () => [
  ...['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((date) => dayOf(date, [lessonOn(date, 1, '08:00')])),
  dayOf('2026-10-16', []),
];
const TRIP = 'טיול שנתי — שכבת י״ב';

test('run 5 (Noa): the title ends on the last day shown, not on a Friday left out', () => {
  const week = noaWeek();
  const shown = pl.weekGridDays(week);
  assert.equal(pl.shownWeekEnd(shown, '2026-10-16'), '2026-10-15');
  assert.equal(pl.weekHeading(1, '2026-10-11', pl.shownWeekEnd(shown, '2026-10-16'), shown).title, '11–15.10');
  // Friday chosen (a link): it is in the grid, and in the title.
  assert.equal(pl.shownWeekEnd(pl.weekGridDays(week, '2026-10-16'), '2026-10-16'), '2026-10-16');
  // A Friday with lessons is always shown.
  const withFriday = [...week.slice(0, 5), dayOf('2026-10-16', [lessonOn('2026-10-16', 1, '08:00')])];
  assert.equal(pl.shownWeekEnd(pl.weekGridDays(withFriday), '2026-10-16'), '2026-10-16');
  // Across two months, and nothing shown yet (the week still loading): the fallback.
  assert.equal(fmt.weekRangeLabel('2026-10-25', pl.shownWeekEnd([{ date: '2026-10-29' }], '2026-10-30')), '25–29.10');
  assert.equal(pl.shownWeekEnd([], '2026-10-16'), '2026-10-16');
});

test('run 5 (Noa): a Friday left out with a school event gets a strip under the grid', () => {
  const week = noaWeek();
  const events = [schoolEvent('2026-10-13', 'יום הורים'), schoolEvent('2026-10-16', TRIP)];
  const strips = pl.hiddenDayStrips(week, pl.weekGridDays(week), events);
  assert.equal(strips.length, 1);
  const [strip] = strips;
  assert.equal(strip.date, '2026-10-16');
  // Wave 9: the row writes the day and date in its margin and the title as the school wrote it, so
  // there is no one-line "שישי 16.10 · …" any more; the label still says it all.
  assert.equal(strip.weekday, 'שישי');
  assert.equal(strip.shortDate, '16.10');
  assert.deepEqual(strip.titles, [TRIP]);
  assert.equal(strip.label, `יום שישי 16.10: ${TRIP}`);
  // Two events that day: both named.
  const two = pl.hiddenDayStrips(week, pl.weekGridDays(week), [...events, schoolEvent('2026-10-16', 'מסיבת סוכות')]);
  assert.deepEqual(two[0].titles, [TRIP, 'מסיבת סוכות']);
  assert.equal(two[0].label, `יום שישי 16.10: ${TRIP}, מסיבת סוכות`);
});

test('run 5: no strip for a Friday in the grid, or one without events', () => {
  const week = noaWeek();
  const events = [schoolEvent('2026-10-16', TRIP)];
  // Friday in the grid (chosen by a link): the strip makes way.
  assert.deepEqual(pl.hiddenDayStrips(week, pl.weekGridDays(week, '2026-10-16'), events), []);
  // A Friday with lessons is in the grid.
  const withFriday = [...week.slice(0, 5), dayOf('2026-10-16', [lessonOn('2026-10-16', 1, '08:00')])];
  assert.deepEqual(pl.hiddenDayStrips(withFriday, pl.weekGridDays(withFriday), events), []);
  // An empty Friday with nothing on it, and an event on a day that is shown.
  assert.deepEqual(pl.hiddenDayStrips(week, pl.weekGridDays(week), []), []);
  assert.deepEqual(pl.hiddenDayStrips(week, pl.weekGridDays(week), [schoolEvent('2026-10-12', 'יום ספורט')]), []);
  // A blank title says nothing.
  assert.deepEqual(pl.hiddenDayStrips(week, pl.weekGridDays(week), [schoolEvent('2026-10-16', '  ')]), []);
});

test('run 5: the strip opens Friday — it stays a strip over the grid, and takes its place in the list', () => {
  const week = noaWeek();
  const events = [schoolEvent('2026-10-16', TRIP)];
  const dates = (shown) => shown.days.map((d) => d.date.slice(8));
  // Nothing chosen, or Thursday: א׳–ה׳ and the strip, in either mode.
  for (const listMode of [false, true]) {
    for (const selected of [null, '2026-10-15']) {
      const shown = pl.weekShown(week, selected, events, listMode);
      assert.deepEqual(dates(shown), ['11', '12', '13', '14', '15']);
      assert.deepEqual(shown.strips.map((s) => s.date), ['2026-10-16']);
    }
  }
  // Friday opened from the strip, in the grid: the grid does not move, the strip stays (chosen).
  const grid = pl.weekShown(week, '2026-10-16', events, false);
  assert.deepEqual(dates(grid), ['11', '12', '13', '14', '15']);
  assert.deepEqual(grid.strips.map((s) => s.date), ['2026-10-16']);
  assert.equal(pl.shownWeekEnd(grid.days, '2026-10-16'), '2026-10-15');
  // In the list: Friday is drawn in full after Thursday, where the strip was, and the title reaches it.
  const list = pl.weekShown(week, '2026-10-16', events, true);
  assert.deepEqual(dates(list), ['11', '12', '13', '14', '15', '16']);
  assert.deepEqual(list.strips, []);
  assert.equal(pl.shownWeekEnd(list.days, '2026-10-16'), '2026-10-16');
  // An empty Friday without events, opened by a link: in the grid, as before.
  assert.deepEqual(dates(pl.weekShown(week, '2026-10-16', [], false)), ['11', '12', '13', '14', '15', '16']);
});

// ---------------------------------------------------------------------------
// W6-5: the week grid — subject colours, changed cells, empty weeks, notes
// ---------------------------------------------------------------------------

const colors = loadSrc(path.join(__dirname, '../src/lib/subjectColors.ts'), cache);

/** WCAG 2 contrast of two "#rrggbb" colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('W6-5: a colour blended over another is one solid colour', () => {
  assert.equal(pl.blendColor('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(pl.blendColor('#141920', '#3987e5', 0), '#141920');
  assert.equal(pl.blendColor('#141920', '#3987e5', 1), '#3987e5');
  assert.equal(pl.blendColor('#fff', '#000', 0), '#ffffff');
  assert.match(pl.subjectCellColors('#2a78d6', '#FFFFFF', 'light').fill, /^#[0-9a-f]{6}$/);
});

test('W6-5: on every subject tint, in both schemes, a cell\'s text keeps AA — the name, and a projected cell\'s muted one', () => {
  for (const scheme of ['light', 'dark']) {
    const p = theme.paletteFor(scheme);
    for (const color of colors.SUBJECT_COLORS[scheme]) {
      // Wave 9: the grid sits on the page (`bg`), not on a card's `surface`; in light the two are one colour.
      const { fill, edge } = pl.subjectCellColors(color, p.bg, scheme);
      assert.ok(contrast(p.text, fill) >= 7, `${scheme} ${color}: text ${contrast(p.text, fill).toFixed(2)}`);
      assert.ok(contrast(p.textMuted, fill) >= 4.5, `${scheme} ${color}: muted ${contrast(p.textMuted, fill).toFixed(2)}`);
      // A wash, not a block of colour: the fill stays close to the page, the edge shows the hue.
      assert.ok(contrast(fill, p.bg) < 1.6, `${scheme} ${color}: fill is soft`);
      assert.notEqual(edge, fill);
    }
  }
});

test('W6-5: a changed cell says what happened in a word, and a cancelled one shows ⊘ — with "בוטל" when it fits', () => {
  const narrow = pl.gridTextWidth(360, 6, pl.hourColumnWidth(['08:00']));
  assert.equal(pl.cellStatusLine('', false, narrow), null);
  // Six days on a 360-point phone: "בוטל" fits beside the ⊘.
  assert.deepEqual(pl.cellStatusLine('בוטל', true, narrow), { icon: true, text: 'בוטל' });
  // Too narrow for both: the ⊘ alone, never a cut "בו׳".
  assert.deepEqual(pl.cellStatusLine('בוטל', true, 20), { icon: true, text: null });
  for (const word of ['מ״מ', 'הועבר', 'מרחוק', 'מבחן', 'אירוע']) {
    assert.deepEqual(pl.cellStatusLine(word, false, narrow), { icon: false, text: word });
    assert.deepEqual(pl.cellStatusLine(word, false, narrow, pl.gridFontScale(1.15, 1)), { icon: false, text: word }, `${word} at 1.15`);
  }
  assert.ok(pl.CELL_STATUS_SIZE >= theme.MIN_FONT_SIZE);
});

/** A day of a week without lessons. */
const offDay = (date, holidayName, isSchoolDay = false) => ({ date, isSchoolDay, holidayName, timeline: [] });

test('W6-5: a holiday\'s name as a student says it — no points, no bracket, no day or year', () => {
  assert.equal(pl.holidayBaseName('סוּכּוֹת ב׳ (חוה״מ)'), 'סוכות');
  assert.equal(pl.holidayBaseName('סוּכּוֹת ז׳ (הוֹשַׁעְנָא רַבָּה)'), 'סוכות');
  assert.equal(pl.holidayBaseName('פֶּסַח ג׳ (חוה״מ)'), 'פסח');
  assert.equal(pl.holidayBaseName('רֹאשׁ הַשָּׁנָה 5787'), 'ראש השנה');
  assert.equal(pl.holidayBaseName('יוֹם כִּפּוּר'), 'יום כפור');
  assert.equal(pl.holidayBaseName('חופשת הקיץ'), 'חופשת הקיץ');
});

test('W6-5 (Daniel): Sukkot\'s week says so inside the grid, not an empty grid', () => {
  // The harness's week of 27.9–2.10 (fixtures, offset -1), as the server names its days.
  const sukkot = [
    offDay('2026-09-27', 'סוּכּוֹת ב׳ (חוה״מ)'), offDay('2026-09-28', 'סוּכּוֹת ג׳ (חוה״מ)'), offDay('2026-09-29', 'סוּכּוֹת ד׳ (חוה״מ)'),
    offDay('2026-09-30', 'סוּכּוֹת ה׳ (חוה״מ)'), offDay('2026-10-01', 'סוּכּוֹת ו׳ (חוה״מ)'), offDay('2026-10-02', 'סוּכּוֹת ז׳ (הוֹשַׁעְנָא רַבָּה)'),
  ];
  assert.deepEqual(pl.emptyWeek(sukkot), { kind: 'holiday', text: 'חופשת סוכות, אין לימודים השבוע' });
  // The summer, and the owner's own "חופש".
  const summer = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'].map((d) => offDay(d, 'חופשת הקיץ'));
  assert.equal(pl.emptyWeek(summer).text, 'חופשת הקיץ, אין לימודים השבוע');
  const vacation = sukkot.map((d) => ({ ...d, holidayName: 'חופש' }));
  assert.deepEqual(pl.emptyWeek(vacation), { kind: 'holiday', text: 'אין לימודים השבוע' });
  // Most of the days name it: one other holiday in the week does not.
  const mixed = [offDay('2026-09-27', 'שְׁמִינִי עֲצֶרֶת'), ...sukkot.slice(1)];
  assert.equal(pl.emptyWeek(mixed).text, 'חופשת סוכות, אין לימודים השבוע');
});

test('W6-5: a week without lessons that is not a holiday has no timetable yet; a lesson makes it a week', () => {
  // Yom Kippur on Monday, and no lessons on the school days around it: not a holiday week.
  const week = [
    offDay('2026-09-20', null, true), offDay('2026-09-21', 'יוֹם כִּפּוּר'), offDay('2026-09-22', null, true),
    offDay('2026-09-23', null, true), offDay('2026-09-24', null, true), offDay('2026-09-25', null, true),
  ];
  assert.deepEqual(pl.emptyWeek(week), { kind: 'noTimetable', text: pl.NO_TIMETABLE_WEEK });
  assert.equal(pl.NO_TIMETABLE_WEEK, 'אין עדיין מערכת לשבוע הזה');
  const taught = week.map((d, i) => (i === 0 ? dayOf(d.date, [lessonOn(d.date, 1, '08:00')], { isSchoolDay: true, holidayName: null }) : d));
  assert.equal(pl.emptyWeek(taught), null);
  assert.equal(pl.emptyWeek([]), null);
});

test('W6-5, W6-9: the lines that explain the week and the planning list', () => {
  assert.equal(pl.WEEK_LIST_NOTE, 'בטקסט גדול השבוע מוצג כרשימה');
  // Plan §16.2 (Wave 9): the line over a week the tab opened on by itself is gone; its title,
  // "שבוע הבא", says it.
  assert.equal(pl.NEXT_WEEK_NOTE, undefined);
  // Not "הקרוב אליי", which Maya read as a place (run 5).
  assert.equal(`${pl.UPCOMING_TITLE.lead}14${pl.UPCOMING_TITLE.rest}`, 'ב־14 הימים הקרובים');
});

// ---------------------------------------------------------------------------
// Run 7 (Noa, Daniel): Classroom work in planning and in the week
// ---------------------------------------------------------------------------

const TODAY7 = '2026-10-08'; // a Thursday
const noMarks = new Set();
const cwork = (naturalKey, dueDate, over = {}) => ({
  naturalKey, courseId: 'c-math', courseName: 'מתמטיקה יב', subject: 'מתמטיקה', title: `מטלה ${naturalKey}`, description: null,
  dueDate, dueTime: dueDate ? '23:59' : null, link: `https://classroom.google.com/c/c-math/a/${naturalKey}`, state: 'CREATED', late: false,
  grade: null, maxPoints: 100, updatedAt: '2026-10-01T08:00:00.000Z', ...over,
});
/** Due tomorrow (a Friday), due Tuesday, two days late, handed in, returned, and undated. */
const classroomFeed = () => [
  cwork('w1', '2026-10-09', { title: 'תרגיל בית 3 · וקטורים' }),
  cwork('w2', '2026-10-13', { title: 'Essay: The Road Not Taken', subject: 'אנגלית', courseName: 'English 5 pts', dueTime: '20:00' }),
  cwork('w3', '2026-10-06', { subject: 'פיזיקה', late: true }),
  cwork('w4', '2026-10-07', { subject: 'היסטוריה', state: 'TURNED_IN' }),
  cwork('w5', '2026-10-02', { state: 'RETURNED', grade: 92 }),
  cwork('w6', null, { subject: 'אנגלית' }),
];
const workKeys = (list) => list.map((w) => w.naturalKey);

test('run 7: planning shows Classroom work that is dated, not handed in and not marked done', () => {
  assert.deepEqual(workKeys(pl.classroomDueWork(classroomFeed(), TODAY7, noMarks)), ['w3', 'w1', 'w2']);
  // "עשיתי" on the phone takes it out, as handing it in does.
  assert.deepEqual(workKeys(pl.classroomDueWork(classroomFeed(), TODAY7, new Set(['w1']))), ['w3', 'w2']);
  // Ticked a moment ago on this screen: it stays, in its place.
  assert.deepEqual(workKeys(pl.classroomDueWork(classroomFeed(), TODAY7, new Set(['w1']), new Set(['w1']))), ['w3', 'w1', 'w2']);
  // Classroom not connected, or not loaded yet.
  assert.deepEqual(pl.classroomDueWork(null, TODAY7, noMarks), []);
  assert.deepEqual(pl.classroomDueWork(undefined, TODAY7, noMarks), []);
  // Late work older than Classroom's own window is left to Classroom.
  assert.deepEqual(pl.classroomDueWork([cwork('old', '2026-09-01')], TODAY7, noMarks), []);
});

test('run 7 (Noa, Daniel): Classroom work joins the agenda on its day, after the homework, and is marked as homework', () => {
  const agenda = planningAgenda();
  const merged = pl.agendaWithClassroom(agenda, pl.classroomDueWork(classroomFeed(), TODAY7, noMarks), noMarks);
  assert.equal(merged.from, agenda.from);
  assert.equal(merged.to, agenda.to);
  const kinds = (m, date) => pl.agendaDay(m, date).items.map((i) => i.kind);
  // 9.10: the history homework, then the vectors exercise.
  assert.deepEqual(kinds(merged, '2026-10-09'), ['homework', 'classroom']);
  assert.equal(pl.agendaDay(merged, '2026-10-09').items[1].work.title, 'תרגיל בית 3 · וקטורים');
  // 13.10: the essay before the task and the guitar.
  assert.deepEqual(kinds(merged, '2026-10-13'), ['classroom', 'task', 'calendar']);
  // On an exam day, after the exam.
  assert.deepEqual(kinds(pl.agendaWithClassroom(agenda, [cwork('t', TODAY7)], noMarks), TODAY7), ['exam', 'classroom', 'calendar']);
  // A day without work is the agenda's own; late work (6.10) is before the agenda, as late homework is.
  assert.equal(pl.agendaDay(merged, '2026-10-21'), agenda.days.find((d) => d.date === '2026-10-21'));
  assert.ok(merged.days.flatMap((d) => d.items).every((i) => i.kind !== 'classroom' || i.work.naturalKey !== 'w3'));
  // The month: a square on 13.10, which had only a task's ring (Daniel: "no orange square on 9").
  assert.deepEqual(pl.monthMarks(merged, [])['2026-10-13'], ['homework', 'task']);
  assert.deepEqual(pl.monthMarks(agenda, [])['2026-10-13'], ['task']);
  const fridayOnly = pl.agendaWithClassroom({ days: [{ date: '2026-10-09', weekdayName: '', items: [] }] }, [cwork('w1', '2026-10-09')], noMarks);
  assert.deepEqual(pl.agendaMarks(fridayOnly), { '2026-10-09': ['homework'] });
});

test('run 7: Classroom work ticked here stays in the list, ticked, but loses its mark', () => {
  const done = new Set(['w1']);
  const merged = pl.agendaWithClassroom(planningAgenda(), pl.classroomDueWork(classroomFeed(), TODAY7, done, done), done);
  const item = pl.agendaDay(merged, '2026-10-09').items.find((i) => i.kind === 'classroom');
  assert.equal(item.done, true);
  assert.equal(pl.markOf(item), null);
  assert.equal(pl.markOf({ kind: 'classroom', work: cwork('x', '2026-10-09'), done: false }), 'homework');
  const only = pl.agendaWithClassroom({ days: [{ date: '2026-10-30', weekdayName: '', items: [] }] }, [cwork('y', '2026-10-30')], new Set(['y']));
  assert.deepEqual(pl.agendaMarks(only), {});
});

test('run 7: "ב־14 הימים הקרובים" lists Classroom work, with "רק בית ספר" on too', () => {
  const merged = pl.agendaWithClassroom(planningAgenda(), pl.classroomDueWork(classroomFeed(), TODAY7, noMarks), noMarks);
  for (const schoolOnly of [false, true]) {
    const list = pl.upcomingList(merged, { days: 14, selected: TODAY7, schoolOnly });
    assert.deepEqual(list.groups.find((g) => g.date === '2026-10-09').items.map((i) => i.kind), ['homework', 'classroom']);
    assert.ok(list.groups.find((g) => g.date === '2026-10-13').items.some((i) => i.kind === 'classroom'));
  }
  assert.equal(pl.agendaItemKey({ kind: 'classroom', work: cwork('w1', '2026-10-09'), done: false }), 'classroom:w1');
});

test('run 7: a day the agenda does not reach lists its Classroom work after the homework', () => {
  const day = {
    date: '2026-10-06',
    examsToday: [exam('2026-10-06', 'אזרחות')],
    homework: [homework('2026-10-06', 'אנגלית')],
    events: [schoolEvent('2026-10-06', 'יום ספורט')],
    timeline: [{ kind: 'task', sortKey: 'x', task: task('t6', '2026-10-06') }],
  };
  const due = pl.classroomDueWork(classroomFeed(), TODAY7, noMarks);
  assert.deepEqual(pl.dayAgendaItems(day, TODAY7, due, noMarks).map((i) => i.kind), ['exam', 'homework', 'classroom', 'task', 'event']);
  // Without Classroom, as before.
  assert.deepEqual(pl.dayAgendaItems(day, TODAY7).map((i) => i.kind), ['exam', 'homework', 'task', 'event']);
});

test('run 7 (Noa): the week names Classroom work due on a day by its subject, with the homework', () => {
  const due = pl.classroomDueWork(classroomFeed(), TODAY7, noMarks);
  const tuesday = { date: '2026-10-13', homework: [homework('2026-10-13', 'אזרחות')], timeline: [] };
  assert.equal(pl.homeworkDueLabel(tuesday, due), 'להגשה: אזרחות, אנגלית');
  // A course that matched no subject goes by its own name.
  assert.equal(pl.homeworkDueLabel({ date: '2026-10-13', homework: [] }, [cwork('u', '2026-10-13', { subject: null, courseName: 'English 5 pts' })]), 'להגשה: English 5 pts');
  // English homework and English work on one day: named once.
  assert.deepEqual(pl.homeworkDueNames({ date: '2026-10-13', homework: [homework('2026-10-13', 'אנגלית 5 יח״ל (יב2)')] }, due), ['אנגלית']);
  // A day with only Classroom work has its square; another day, or no Classroom, has none.
  assert.equal(pl.hasHomeworkDue({ date: '2026-10-09', homework: [] }, due), true);
  assert.equal(pl.hasHomeworkDue({ date: '2026-10-12', homework: [] }, due), false);
  assert.equal(pl.hasHomeworkDue({ date: '2026-10-09', homework: [] }), false);
  // Marked done on the phone: not due any more.
  assert.equal(pl.hasHomeworkDue({ date: '2026-10-09', homework: [] }, pl.classroomDueWork(classroomFeed(), TODAY7, new Set(['w1']))), false);
});

test('run 7: a Friday left out of the grid with work due gets a strip, as the class trip does', () => {
  // 4–9.10: lessons Sunday to Thursday, Friday empty; the vectors exercise is due on Friday.
  const week = [
    ...['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((date) => dayOf(date, [lessonOn(date, 1, '08:00')])),
    dayOf('2026-10-09', [], { homework: [] }),
  ];
  const due = pl.classroomDueWork(classroomFeed(), TODAY7, noMarks);
  const strips = pl.hiddenDayStrips(week, pl.weekGridDays(week), [], due);
  assert.equal(strips.length, 1);
  assert.equal(strips[0].date, '2026-10-09');
  assert.deepEqual(strips[0].titles, []);
  assert.equal(strips[0].due, 'להגשה: מתמטיקה');
  assert.equal(strips[0].label, 'יום שישי 9.10: להגשה: מתמטיקה');
  // Mashov homework due that Friday gets one too.
  const withHomework = [...week.slice(0, 5), dayOf('2026-10-09', [], { homework: [homework('2026-10-09', 'היסטוריה')] })];
  assert.equal(pl.hiddenDayStrips(withHomework, pl.weekGridDays(withHomework), [])[0].due, 'להגשה: היסטוריה');
  // An event and work due: both, the event first. Events alone keep `due` null.
  const both = pl.hiddenDayStrips(week, pl.weekGridDays(week), [schoolEvent('2026-10-09', TRIP)], due);
  assert.deepEqual([both[0].titles, both[0].due], [[TRIP], 'להגשה: מתמטיקה']);
  assert.equal(both[0].label, `יום שישי 9.10: ${TRIP}. להגשה: מתמטיקה`);
  assert.equal(pl.hiddenDayStrips(week, pl.weekGridDays(week), [schoolEvent('2026-10-09', TRIP)])[0].due, null);
  // Without Classroom, and with the work marked done: no strip.
  assert.deepEqual(pl.hiddenDayStrips(week, pl.weekGridDays(week), []), []);
  assert.deepEqual(pl.hiddenDayStrips(week, pl.weekGridDays(week), [], pl.classroomDueWork(classroomFeed(), TODAY7, new Set(['w1']))), []);
  // The strip opens Friday, as the trip's does: the grid stays, the strip is chosen.
  const grid = pl.weekShown(week, '2026-10-09', [], false, due);
  assert.deepEqual(grid.days.map((d) => d.date.slice(8)), ['04', '05', '06', '07', '08']);
  assert.deepEqual(grid.strips.map((s) => s.date), ['2026-10-09']);
  assert.deepEqual(pl.weekShown(week, '2026-10-09', [], true, due).days.map((d) => d.date.slice(8)), ['04', '05', '06', '07', '08', '09']);
});
