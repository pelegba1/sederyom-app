/**
 * "שליחה לקבוצה" (ideas ה1, app/src/lib/share.ts): a day's changes and the
 * exams ahead as text for the class's group, with the link at the end.
 */
import { describe, expect, it } from 'vitest';
import type { Exam, Lesson } from '@sederyom/shared';
import { changesShareText, examsShareText, STORE_URL } from '../../app/src/lib/share';

const LINK = 'https://api.example/join?s=school-a&c=36';
const ctx = { className: 'י״א 2', link: LINK };
/** The text as read, without the marks that pin ranges and dashed words left to right. */
const plain = (text: string) => text.replace(/[⁦-⁩⁠]/g, '');

const lesson = (over: Partial<Lesson>): Lesson => ({
  date: '2026-11-02', hourIndex: 1, startTime: null, endTime: null, subject: 'מתמטיקה', teacher: null, room: null,
  status: 'cancelled', substitute: null, note: null, source: 'shahaf', changeSeenAt: null, ...over,
});

const exam = (date: string, subject: string, details: string | null = null): Exam => ({
  naturalKey: `${date}:${subject}`, date, subject, details, source: 'shahaf',
});

describe('a day\'s changes', () => {
  it('lists each changed lesson in the day\'s order, and ends with the link', () => {
    const text = changesShareText([
      lesson({ hourIndex: 5, subject: 'אנגלית 5 יח"ל (יא2)', status: 'substitution', substitute: 'דנה כהן' }),
      lesson({ hourIndex: 3, startTime: '09:40', endTime: '10:25' }),
    ], '2026-11-02', ctx);
    expect(plain(text)).toBe([
      'שינויים במערכת של י״א 2, יום שני 2.11:',
      'שיעור 3 (09:40–10:25) מתמטיקה: בוטל',
      'שיעור 5 אנגלית: מילוי מקום, דנה כהן',
      '',
      `נשלח מסדר יום: ${LINK}`,
    ].join('\n'));
    // The range stays left to right in a right-to-left line, and the link is left alone.
    expect(text).toMatch(/⁦09:40⁠?–⁠?10:25⁩/);
    expect(text.endsWith(LINK)).toBe(true);
  });

  it('keeps the site\'s note, and needs no class', () => {
    const text = changesShareText([lesson({ status: 'moved', note: 'הועבר לשיעור 8' })], '2026-11-02', { className: '', link: STORE_URL });
    expect(plain(text).split('\n').slice(0, 2)).toEqual(['שינויים במערכת, יום שני 2.11:', 'שיעור 1 מתמטיקה: הוזז. הועבר לשיעור 8']);
  });
});

describe('the exams ahead', () => {
  it('lists the next two weeks\' exams by date, with their details', () => {
    const text = examsShareText([
      exam('2026-11-04', 'מתכונת באנגלית', 'שאלון 016582'),
      exam('2026-11-02', 'מבחן במתמטיקה'),
      exam('2026-11-30', 'מבחן בהיסטוריה'),
      exam('2026-10-20', 'מבחן שעבר'),
    ], '2026-11-01', ctx);
    expect(plain(text!).split('\n')).toEqual([
      'המבחנים בשבועיים הקרובים, י״א 2:',
      'יום שני 2.11: מבחן במתמטיקה',
      'יום רביעי 4.11: מתכונת באנגלית (שאלון 016582)',
      '',
      `נשלח מסדר יום: ${LINK}`,
    ]);
  });

  it('names the next few when none is two weeks close, and nothing without any', () => {
    const text = examsShareText([exam('2026-12-20', 'מבחן בפיזיקה')], '2026-11-01', ctx);
    expect(plain(text!).split('\n')[0]).toBe('המבחנים הקרובים, י״א 2:');
    expect(examsShareText([exam('2026-10-20', 'מבחן שעבר')], '2026-11-01', ctx)).toBeNull();
  });

  it('tells the group the school\'s date of an exam the student moved for themselves, in the list and in the order', () => {
    // On the phone the student's date is `date` and the school's `originalDate`; what goes to the class is the school's.
    const later = { ...exam('2026-11-02', 'מבחן במתמטיקה'), date: '2026-11-25', originalDate: '2026-11-02' };
    const earlier = { ...exam('2026-11-12', 'מבחן בפיזיקה'), date: '2026-11-03', originalDate: '2026-11-12' };
    const text = examsShareText([later, earlier, exam('2026-11-04', 'מתכונת באנגלית')], '2026-11-01', ctx);
    expect(plain(text!).split('\n')).toEqual([
      'המבחנים בשבועיים הקרובים, י״א 2:',
      'יום שני 2.11: מבחן במתמטיקה',
      'יום רביעי 4.11: מתכונת באנגלית',
      'יום חמישי 12.11: מבחן בפיזיקה',
      '',
      `נשלח מסדר יום: ${LINK}`,
    ]);
    // Behind the school's date, it is behind, wherever the student put it; ahead on the school's, it is ahead.
    const gone = { ...exam('2026-10-20', 'מבחן שעבר'), date: '2026-11-20', originalDate: '2026-10-20' };
    expect(examsShareText([gone], '2026-11-01', ctx)).toBeNull();
    const far = { ...exam('2026-12-20', 'מבחן בפיזיקה'), date: '2026-11-03', originalDate: '2026-12-20' };
    expect(plain(examsShareText([far], '2026-11-01', ctx)!).split('\n').slice(0, 2)).toEqual(['המבחנים הקרובים, י״א 2:', 'יום ראשון 20.12: מבחן בפיזיקה']);
  });

  it('keeps the copy rules', () => {
    const text = examsShareText([exam('2026-11-02', 'מבחן במתמטיקה')], '2026-11-01', ctx)!;
    expect(text).not.toMatch(/·| — /);
  });
});
