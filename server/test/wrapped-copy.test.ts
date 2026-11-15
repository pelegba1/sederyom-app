/**
 * The year in review's words (year wrapped, part 3): what each card says
 * around its number, the rows of "מאיפה המספר", and when Today offers it.
 */
import { describe, expect, it } from 'vitest';
import type { WrappedCard, WrappedRecord } from '@sederyom/shared/logic/wrapped/index';
import {
  cardCopy, closeOnce, dayMonthHe, durationHe, entryReady, entryShown, entrySummary, inEntryWindow, recordRow,
} from '../../app/src/wrapped/copy';
import { SHARE_IMAGE, canShare, captureSize, shareCard } from '../../app/src/wrapped/share';

const card = (over: Partial<WrappedCard> & Pick<WrappedCard, 'id'>): WrappedCard => ({
  value: 0, params: {}, from: '2026-10-20', to: '2026-11-10', shareable: true, records: [], ...over,
});
const record = (over: Partial<WrappedRecord> & Pick<WrappedRecord, 'kind'>): WrappedRecord => ({
  date: '2026-10-25', hour: 1, subject: 'מתמטיקה', title: null, amount: null, ...over,
});
const plain = (c: WrappedCard): string | null => cardCopy(c).line?.map((s) => s.text).join('') ?? null;
const bold = (c: WrappedCard): string[] => (cardCopy(c).line ?? []).filter((s) => s.bold).map((s) => s.text);

describe('dates and durations in words', () => {
  it('a day and its month', () => {
    expect(dayMonthHe('2026-09-01')).toBe('1 בספטמבר');
    expect(dayMonthHe('2027-06-20')).toBe('20 ביוני');
  });

  it('a duration reads as people say it', () => {
    expect(durationHe(20)).toBe('20 דקות');
    expect(durationHe(60)).toBe('שעה');
    expect(durationHe(90)).toBe('שעה וחצי');
    expect(durationHe(120)).toBe('שעתיים');
    expect(durationHe(150)).toBe('שעתיים וחצי');
    expect(durationHe(180)).toBe('3 שעות');
    expect(durationHe(200)).toBe('3 שעות ו־20 דקות');
    expect(durationHe(210)).toBe('3 שעות וחצי');
    // From three quarters on it is "almost" the next hour; the rows behind the card have the minutes.
    expect(durationHe(225)).toBe('כמעט 4 שעות');
    expect(durationHe(50)).toBe('כמעט שעה');
    expect(durationHe(105)).toBe('כמעט שעתיים');
  });
});

describe('what each card says', () => {
  it('the opening names the period, and the day changes are counted from', () => {
    const c = card({ id: 'intro', value: 39, params: { observedFrom: '2026-10-20' }, from: '2026-09-01', to: '2026-11-10' });
    expect(cardCopy(c)).toMatchObject({
      kicker: 'השנה שלך עד עכשיו', hero: '39', heroKind: 'number', pen: 'mark', unit: 'ימי לימודים',
      since: 'השינויים נספרים מ־20 באוקטובר.',
    });
    expect(plain(c)).toBe('מ־1 בספטמבר עד 10 בנובמבר.');
  });

  it('the opening with nothing kept says so and shows no number of days', () => {
    const c = card({ id: 'intro', value: 0, params: { observedFrom: null }, from: null, to: null });
    expect(cardCopy(c)).toMatchObject({ hero: 'עוד מעט', heroKind: 'word', unit: null, since: null });
    expect(plain(c)).toBe('עוד לא נשמרו ימים מהמערכת של הכיתה.');
  });

  it('one school day is not "1 ימי לימודים"', () => {
    expect(cardCopy(card({ id: 'intro', value: 1, params: { observedFrom: null }, from: '2026-09-01', to: '2026-09-01' })).unit).toBe('יום לימודים');
  });

  it('hours: the lessons and the days, and the lessons with no time when there are any', () => {
    const c = card({ id: 'hours', value: 88, params: { lessons: 117, days: 39, minutes: 5265, untimed: 0 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'שעות במערכת', hero: '88', unit: 'שעות של שיעורים', since: null });
    expect(plain(c)).toBe('117 שיעורים ב־39 ימים.');
    expect(bold(c)).toEqual(['117', '39']);
    expect(cardCopy(card({ id: 'hours', value: 88, params: { lessons: 117, days: 39, minutes: 5265, untimed: 2 } })).since)
      .toBe('בלי 2 שיעורים שאין להם שעה במערכת.');
  });

  it('hours: the note says a cancelled lesson is counted, as the calculation counts it', () => {
    const note = cardCopy(card({ id: 'hours', value: 88, params: { lessons: 117, days: 39, minutes: 5265, untimed: 0 } })).source?.note ?? '';
    expect(note).toContain('גם שיעור שבוטל נספר');
    expect(note).not.toContain('לא נספר כאן');
  });

  it('exams: says from which day they are counted', () => {
    const c = card({ id: 'exams', value: 4, params: { weekStart: null, weekCount: null }, from: '2026-10-20', to: '2026-11-09' });
    expect(cardCopy(c).since).toBe('מאז 20 באוקטובר.');
  });

  it('cancelled: the red pen, the free time, and since when', () => {
    const c = card({ id: 'cancelled', value: 5, params: { minutes: 225, hours: 3.8, untimed: 0 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'שיעורים שבוטלו', hero: '5', pen: 'red', unit: 'שיעורים בוטלו', since: 'מאז 20 באוקטובר.' });
    expect(plain(c)).toBe('כמעט 4 שעות חופשיות.');
    expect(bold(c)).toEqual(['כמעט 4 שעות']);
    // One hour is "שעה חופשית".
    expect(plain(card({ id: 'cancelled', value: 5, params: { minutes: 60, untimed: 0 } }))).toBe('שעה חופשית.');
    expect(plain(card({ id: 'cancelled', value: 5, params: { minutes: 50, untimed: 0 } }))).toBe('כמעט שעה חופשית.');
    // No times at all: no sentence about time.
    expect(cardCopy(card({ id: 'cancelled', value: 5, params: { minutes: 0, untimed: 5 } })).line).toBeNull();
  });

  it('the subject cancelled most is the hero, with no word that needs its gender', () => {
    const c = card({ id: 'cancelledTop', value: 3, params: { subject: 'מתמטיקה', weekday: 'יום ראשון', weekdayCount: 3, total: 5 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'הכי הרבה ביטולים', hero: 'מתמטיקה', heroKind: 'word', unit: '3 ביטולים מתוך 5' });
    expect(plain(c)).toBe('בכל המקצועות ביחד, הכי הרבה ביטולים ביום ראשון.');
    expect(cardCopy(card({ id: 'cancelledTop', value: 3, params: { subject: 'מתמטיקה', weekday: null, weekdayCount: null, total: 5 } })).line).toBeNull();
  });

  it('sleep: the mornings and the time together', () => {
    const c = card({ id: 'sleep', value: 3, params: { minutes: 150, untimed: 0 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'שיעור ראשון שבוטל', hero: '3', unit: 'בקרים של שינה', since: 'מאז 20 באוקטובר.' });
    expect(plain(c)).toBe('ביחד שעתיים וחצי עד השיעור הראשון שהתקיים.');
  });

  it('changes: substitutes and moved lessons, each only when there are any', () => {
    expect(plain(card({ id: 'substitutes', value: 5, params: { substitutions: 3, moved: 2 } }))).toBe('3 עם מילוי מקום ו־2 שהוזזו או השתנו.');
    expect(plain(card({ id: 'substitutes', value: 3, params: { substitutions: 3, moved: 0 } }))).toBe('כולם עם מילוי מקום.');
    expect(plain(card({ id: 'substitutes', value: 3, params: { substitutions: 0, moved: 3 } }))).toBe('כולם הוזזו או השתנו.');
    expect(cardCopy(card({ id: 'substitutes', value: 5, params: { substitutions: 3, moved: 2 } })))
      .toMatchObject({ kicker: 'שינויים במערכת', unit: 'שיעורים השתנו', since: 'מאז 20 באוקטובר.' });
  });

  it('the longest day: one day with its hours, or how many such days', () => {
    const params = {
      longestDate: '2026-09-02', longestWeekday: 'יום רביעי', longestDays: 1, longestStart: '08:00', longestEnd: '15:25',
      shortestLessons: 2, shortestDate: '2026-09-04', shortestWeekday: 'יום שישי',
    };
    const one = card({ id: 'days', value: 8, params });
    expect(cardCopy(one)).toMatchObject({ kicker: 'היום הכי ארוך', hero: '8', unit: 'שיעורים ביום אחד', since: 'הכי קצר: 2 שיעורים, יום שישי 4.9.' });
    expect(plain(one)).toBe('יום רביעי 2.9, מ־08:00 עד 15:25.');
    expect(plain(card({ id: 'days', value: 8, params: { ...params, longestDays: 8 } }))).toBe('היו 8 ימים כאלה. הראשון: יום רביעי 2.9.');
    // Every day the same length: no shortest day to name.
    expect(cardCopy(card({ id: 'days', value: 8, params: { ...params, shortestLessons: 8 } })).since).toBeNull();
  });

  it('exams: the busiest week when one stands out', () => {
    const c = card({ id: 'exams', value: 4, params: { weekStart: '2026-10-25', weekCount: 3 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'מבחנים', hero: '4', unit: 'מבחנים מאחוריך' });
    expect(plain(c)).toBe('השבוע הכי עמוס: 3 מבחנים, בשבוע של 25.10.');
    expect(cardCopy(card({ id: 'exams', value: 4, params: { weekStart: null, weekCount: null } })).line).toBeNull();
  });

  it('tasks: on time out of those with a date, and the streak', () => {
    const c = card({ id: 'tasks', value: 11, params: { tasks: 9, homework: 2, withDue: 6, beforeDue: 4, streak: 5 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'משימות', hero: '11', unit: 'משימות סומנו', since: 'הרצף הכי ארוך: 5 ימים.' });
    expect(plain(c)).toBe('4 מתוך 6 עד המועד.');
    const bare = cardCopy(card({ id: 'tasks', value: 11, params: { tasks: 11, homework: 0, withDue: 0, beforeDue: 0, streak: null } }));
    expect(bare.line).toBeNull();
    expect(bare.since).toBeNull();
  });

  it('lessons held, as Mashov lists them', () => {
    const c = card({ id: 'held', value: 82, params: { subjects: 4, top: 'אנגלית', topHeld: 30 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'שיעורים במשוב', hero: '82', unit: 'שיעורים נרשמו במשוב' });
    expect(plain(c)).toBe('ב־4 מקצועות. הכי הרבה: אנגלית, 30.');
    expect(plain(card({ id: 'held', value: 82, params: { subjects: 4, top: null, topHeld: null } }))).toBe('ב־4 מקצועות.');
  });

  it('attendance: absences and lates, each when there are any', () => {
    const c = card({ id: 'attendance', value: 3, shareable: false, params: { absences: 1, lates: 2, justified: 1 } });
    expect(cardCopy(c)).toMatchObject({ kicker: 'נוכחות', hero: '3', unit: 'רישומים במשוב', since: 'אחד מהם מוצדק.' });
    expect(plain(c)).toBe('חיסור אחד ו־2 איחורים.');
    expect(plain(card({ id: 'attendance', value: 2, shareable: false, params: { absences: 0, lates: 2, justified: 0 } }))).toBe('2 איחורים.');
    expect(cardCopy(card({ id: 'attendance', value: 4, shareable: false, params: { absences: 4, lates: 0, justified: 3 } })).since).toBe('3 מהם מוצדקים.');
    expect(cardCopy(card({ id: 'attendance', value: 2, shareable: false, params: { absences: 0, lates: 2, justified: 0 } })).since).toBeNull();
  });

  it('grades: the average, the strongest subject, and the two halves', () => {
    const params = { count: 6, best: 'מתמטיקה', bestAverage: 88.3, trend: 10, middle: '2026-10-06' };
    const c = card({ id: 'grades', value: 85, shareable: false, params });
    expect(cardCopy(c)).toMatchObject({ kicker: 'ציונים', hero: '85', unit: 'הממוצע שלך', since: 'החצי השני גבוה ב־10 נקודות מהראשון.' });
    expect(plain(c)).toBe('ב־6 ציונים. הכי חזק: מתמטיקה.');
    const since = (trend: number | null) => cardCopy(card({ id: 'grades', value: 85.4, shareable: false, params: { ...params, trend } })).since;
    expect(since(-2.5)).toBe('החצי השני נמוך ב־2.5 נקודות מהראשון.');
    expect(since(1)).toBe('החצי השני גבוה בנקודה מהראשון.');
    expect(since(0)).toBe('שני החצאים יצאו אותו דבר.');
    expect(since(null)).toBe('ממוצע פשוט, בלי משקלים.');
    expect(cardCopy(card({ id: 'grades', value: 85.4, shareable: false, params: { ...params, best: null } })).hero).toBe('85.4');
    expect(plain(card({ id: 'grades', value: 85.4, shareable: false, params: { ...params, best: null } }))).toBe('ב־6 ציונים.');
  });

  it('the closing', () => {
    expect(cardCopy(card({ id: 'outro', from: null, to: null }))).toMatchObject({
      kicker: 'סיום', hero: 'זהו,\nעד עכשיו.', heroKind: 'word', pen: 'none', unit: null, source: null,
    });
  });

  it('every card but the closing says where its number is from', () => {
    for (const id of ['intro', 'hours', 'held', 'cancelled', 'cancelledTop', 'sleep', 'substitutes', 'days', 'exams', 'tasks', 'attendance', 'grades'] as const) {
      const source = cardCopy(card({ id, value: 5, params: { subject: 'מתמטיקה' } })).source;
      expect(source?.title, id).toBeTruthy();
      expect(source?.note, id).toBeTruthy();
    }
  });
});

describe('the rows behind a number', () => {
  it('a cancelled lesson: its day and hour, and the subject struck through', () => {
    expect(recordRow(record({ kind: 'cancelled', amount: 45 }))).toEqual({ lead: 'יום א׳ 25.10, שעה 1', text: 'מתמטיקה', end: null, struck: true });
  });

  it('a morning of sleep: the time until the first lesson held', () => {
    expect(recordRow(record({ kind: 'sleep', amount: 50 }))).toEqual({ lead: 'יום א׳ 25.10', text: 'מתמטיקה', end: '50 דקות', struck: true });
  });

  it('a change says which', () => {
    expect(recordRow(record({ kind: 'substitution' })).end).toBe('מילוי מקום');
    expect(recordRow(record({ kind: 'moved' })).end).toBe('שינוי');
  });

  it('a day, a subject in Mashov, an exam, a task, homework, attendance, a grade', () => {
    expect(recordRow(record({ kind: 'day', hour: null, subject: null, amount: 8 }))).toEqual({ lead: 'יום א׳ 25.10', text: '8 שיעורים', end: null, struck: false });
    expect(recordRow(record({ kind: 'held', date: null, hour: null, subject: 'אנגלית', amount: 30 }))).toEqual({ lead: 'אנגלית', text: '', end: '30', struck: false });
    expect(recordRow(record({ kind: 'exam', hour: null }))).toEqual({ lead: 'יום א׳ 25.10', text: 'מתמטיקה', end: null, struck: false });
    expect(recordRow(record({ kind: 'task', hour: null, subject: null, title: 'לקרוא פרק 3' }))).toEqual({ lead: 'יום א׳ 25.10', text: 'לקרוא פרק 3', end: null, struck: false });
    expect(recordRow(record({ kind: 'homework', hour: null }))).toEqual({ lead: 'יום א׳ 25.10', text: 'שיעורי בית, מתמטיקה', end: null, struck: false });
    expect(recordRow(record({ kind: 'homework', hour: null, subject: null })).text).toBe('שיעורי בית');
    expect(recordRow(record({ kind: 'late' }))).toEqual({ lead: 'יום א׳ 25.10, שעה 1', text: 'מתמטיקה', end: 'איחור', struck: false });
    expect(recordRow(record({ kind: 'absence', hour: null, subject: null }))).toEqual({ lead: 'יום א׳ 25.10', text: '', end: 'חיסור', struck: false });
    expect(recordRow(record({ kind: 'grade', hour: null, amount: 92 }))).toEqual({ lead: 'יום א׳ 25.10', text: 'מתמטיקה', end: '92', struck: false });
  });
});

describe('the card on Today', () => {
  it('shows from 14 June to 31 July', () => {
    expect(inEntryWindow('2027-06-13')).toBe(false);
    expect(inEntryWindow('2027-06-14')).toBe(true);
    expect(inEntryWindow('2027-07-31')).toBe(true);
    expect(inEntryWindow('2027-08-01')).toBe(false);
    expect(inEntryWindow('2026-11-11')).toBe(false);
  });

  it('once closed it stays closed for that school year, and comes back the next', () => {
    expect(entryShown('2027-06-20', null)).toBe(true);
    expect(entryShown('2027-06-20', '2026-09-01')).toBe(false);
    expect(entryShown('2027-07-15', '2026-09-01')).toBe(false);
    expect(entryShown('2028-06-20', '2026-09-01')).toBe(true);
    expect(entryShown('2027-05-20', null)).toBe(false);
  });

  it('its line is the days, the cancellations and the tasks that have a card', () => {
    const cards = [
      card({ id: 'intro', value: 39 }), card({ id: 'cancelled', value: 5 }), card({ id: 'tasks', value: 11 }), card({ id: 'outro' }),
    ];
    expect(entrySummary(cards)).toBe('39 ימי לימודים, 5 ביטולים, 11 משימות.');
    expect(entrySummary([card({ id: 'intro', value: 39 }), card({ id: 'outro' })])).toBe('39 ימי לימודים.');
    expect(entrySummary([card({ id: 'intro', value: 0 }), card({ id: 'outro' })])).toBeNull();
  });
});

describe('sharing a card as an image', () => {
  const sharing = (available = true) => {
    const sent: { url: string; options: unknown }[] = [];
    return { sent, isAvailableAsync: async () => available, shareAsync: async (url: string, options?: unknown) => void sent.push({ url, options }) };
  };

  it('grades and attendance are never shared, and the closing has nothing to share', () => {
    expect(canShare(card({ id: 'cancelled', value: 5 }))).toBe(true);
    expect(canShare(card({ id: 'grades', value: 85, shareable: false }))).toBe(false);
    expect(canShare(card({ id: 'attendance', value: 3, shareable: false }))).toBe(false);
    expect(canShare(card({ id: 'outro' }))).toBe(false);
  });

  it('a private card is refused before any image is made', async () => {
    const s = sharing();
    let captured = 0;
    const got = await shareCard(card({ id: 'grades', value: 85, shareable: false }), async () => { captured += 1; return 'file:///x.png'; }, s);
    expect(got).toBe('refused');
    expect(captured).toBe(0);
    expect(s.sent).toEqual([]);
  });

  it('a card that may be shared goes out as a PNG through the share sheet', async () => {
    const s = sharing();
    const got = await shareCard(card({ id: 'sleep', value: 3 }), async () => 'file:///tmp/card.png', s);
    expect(got).toBe('shared');
    expect(s.sent).toEqual([{ url: 'file:///tmp/card.png', options: { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'שיתוף' } }]);
  });

  it('a path with no scheme gets one, since the share sheet takes a file URL', async () => {
    const s = sharing();
    await shareCard(card({ id: 'sleep', value: 3 }), async () => '/data/cache/card.png', s);
    expect(s.sent[0]?.url).toBe('file:///data/cache/card.png');
  });

  it('a phone that cannot share makes no image', async () => {
    let captured = 0;
    const got = await shareCard(card({ id: 'sleep', value: 3 }), async () => { captured += 1; return 'file:///x.png'; }, sharing(false));
    expect(got).toBe('unavailable');
    expect(captured).toBe(0);
  });

  it('the image is a story: 1080 by 1920', () => {
    expect(SHARE_IMAGE).toMatchObject({ width: 1080, height: 1920 });
    expect(SHARE_IMAGE.width / SHARE_IMAGE.points.width).toBe(SHARE_IMAGE.height / SHARE_IMAGE.points.height);
  });
});

describe('what the independent review found in the words', () => {
  it('the weekday of the cancellations is said to be of all subjects, not of the one named', () => {
    const c = card({ id: 'cancelledTop', value: 3, params: { subject: 'מתמטיקה', weekday: 'יום ראשון', weekdayCount: 3, total: 5 } });
    expect(plain(c)).toBe('בכל המקצועות ביחד, הכי הרבה ביטולים ביום ראשון.');
  });

  it('free time that leaves lessons out says how many', () => {
    const cancelled = cardCopy(card({ id: 'cancelled', value: 5, params: { minutes: 180, untimed: 1 } }));
    expect(cancelled.since).toBe('מאז 20 באוקטובר. בלי שיעור אחד שאין לו שעה במערכת.');
    const sleep = cardCopy(card({ id: 'sleep', value: 3, params: { minutes: 100, untimed: 2 } }));
    expect(sleep.since).toBe('מאז 20 באוקטובר. בלי 2 בקרים שאין להם שעה במערכת.');
    expect(cardCopy(card({ id: 'sleep', value: 3, params: { minutes: 150, untimed: 0 } })).since).toBe('מאז 20 באוקטובר.');
  });

  it('a task done on its day is "by the date", which is what is counted', () => {
    const c = card({ id: 'tasks', value: 11, params: { tasks: 9, homework: 2, withDue: 6, beforeDue: 4, streak: null } });
    expect(plain(c)).toBe('4 מתוך 6 עד המועד.');
  });

  it('a lesson the site marked without saying how is a change, not a move', () => {
    expect(plain(card({ id: 'substitutes', value: 5, params: { substitutions: 3, moved: 2 } }))).toBe('3 עם מילוי מקום ו־2 שהוזזו או השתנו.');
    expect(plain(card({ id: 'substitutes', value: 3, params: { substitutions: 0, moved: 3 } }))).toBe('כולם הוזזו או השתנו.');
    expect(recordRow(record({ kind: 'moved' })).end).toBe('שינוי');
  });

  it('the image is asked for in the units each platform reads, and comes out 1080 by 1920', () => {
    expect(captureSize('android', 2.75)).toEqual({ width: 1080, height: 1920 });
    // iOS reads points and draws at the screen's scale.
    expect(captureSize('ios', 3)).toEqual({ width: 360, height: 640 });
    expect(captureSize('ios', 2)).toEqual({ width: 540, height: 960 });
  });

  it('the image file is let go once the sheet closed, and when sharing failed', async () => {
    const released: string[] = [];
    const sheet = { isAvailableAsync: async () => true, shareAsync: async () => undefined };
    await shareCard(card({ id: 'sleep', value: 3 }), async () => 'file:///tmp/a.png', sheet, (file) => released.push(file));
    const failing = { isAvailableAsync: async () => true, shareAsync: async () => { throw new Error('closed'); } };
    await expect(shareCard(card({ id: 'sleep', value: 3 }), async () => 'file:///tmp/b.png', failing, (file) => released.push(file))).rejects.toThrow();
    expect(released).toEqual(['file:///tmp/a.png', 'file:///tmp/b.png']);
  });
});

describe('the two small things the review left', () => {
  it('Today offers the review only once there is something behind it', () => {
    expect(entryReady(null)).toBe(false);
    expect(entryReady([card({ id: 'intro', value: 0 }), card({ id: 'outro' })])).toBe(false);
    expect(entryReady([card({ id: 'intro', value: 39 }), card({ id: 'outro' })])).toBe(true);
    // No school days kept, but the phone's own tasks have a card.
    expect(entryReady([card({ id: 'intro', value: 0 }), card({ id: 'tasks', value: 11 }), card({ id: 'outro' })])).toBe(true);
  });

  it('a second tap on the last card does not close a second screen', () => {
    let closed = 0;
    const close = closeOnce(() => { closed += 1; });
    close();
    close();
    expect(closed).toBe(1);
  });
});
