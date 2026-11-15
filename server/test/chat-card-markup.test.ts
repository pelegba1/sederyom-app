/**
 * The day card's markup (chat day card plan, Task 1): one school day as HTML, drawn inside the chat's
 * frame. Pure: the clock is `now`, passed in. The fixture is Tuesday 10.11.2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Exam, Lesson, SchoolEvent } from '@sederyom/shared';
import { parseExamTitle } from '@sederyom/shared/logic/exam-match';
import { subjectKey } from '@sederyom/shared/logic/subjects';
import { parseIcs } from '../src/adapters/school-site/ics.js';
import { examTitle } from '../src/adapters/school-site/index.js';
import { dayCardMarkup, escapeHtml, isDayCardData, plainCardMarkup, type DayCardData } from '../src/chat/card/markup.js';

const DATE = '2026-11-10';
/** 20:00 in Israel on Monday 9.11.2026, the day before. */
const NOW = new Date('2026-11-09T18:00:00Z');
/** 16:40 in Israel on the same Monday (UTC+2). */
const UPDATED = '2026-11-09T14:40:00Z';
const XSS = '<img src=x onerror=alert(1)>';

const TIMES: [string, string][] = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['09:50', '10:35'], ['10:40', '11:25'], ['11:45', '12:30'], ['12:35', '13:20'], ['13:30', '14:15'],
];

const lesson = (hourIndex: number, subject: string, over: Partial<Lesson> = {}): Lesson => ({
  date: DATE,
  hourIndex,
  startTime: null,
  endTime: null,
  subject,
  teacher: null,
  room: null,
  status: 'regular',
  substitute: null,
  note: null,
  source: 'shahaf',
  changeSeenAt: null,
  ...over,
});

const exam = (subject: string, over: Partial<Exam> = {}): Exam => ({
  naturalKey: `exam-${subject}`,
  date: DATE,
  subject,
  details: null,
  source: 'shahaf',
  ...over,
});

const event = (title: string, over: Partial<SchoolEvent> = {}): SchoolEvent => ({
  naturalKey: `event-${title}`,
  date: DATE,
  title,
  details: null,
  source: 'school_site',
  ...over,
});

/** The sketch's day: seven lessons, the fourth cancelled, hours 8:00 to 14:15. */
function sketchLessons(): Lesson[] {
  const subjects: [string, string | null, string | null][] = [
    ['מתמטיקה', 'כהן', '12'], ['מתמטיקה', 'כהן', '12'], ['אנגלית', 'לוי', '8'], ['היסטוריה', null, null],
    ['ספרות', 'אברהם', '21'], ['פיזיקה', 'דהן', 'מעבדה'], ['חינוך', 'שגב', '12'],
  ];
  return subjects.map(([subject, teacher, room], i) =>
    lesson(i + 1, subject, { teacher, room, startTime: TIMES[i]![0], endTime: TIMES[i]![1], status: i === 3 ? 'cancelled' : 'regular' }));
}

const day = (over: Partial<DayCardData> = {}): DayCardData => ({
  date: DATE,
  found: true,
  weekdayName: 'יום שלישי',
  isSchoolDay: true,
  holidayName: null,
  projected: false,
  exams: [],
  lessons: sketchLessons(),
  events: [],
  updatedAt: UPDATED,
  old: false,
  ...over,
});

/** The card as the page draws it. */
const card = (over: Partial<DayCardData> = {}, now: Date = NOW): string => dayCardMarkup(day(over), now);

/** Every row: its opening tag and its markup up to the next row, the lines under the lessons or the footer. */
function rows(html: string): { open: string; html: string; classes: string[] }[] {
  return html.split('<div class="row').slice(1).map((chunk) => {
    const ends = ['<div class="line"', '<div class="foot"'].map((tag) => chunk.indexOf(tag)).filter((at) => at >= 0);
    const whole = `<div class="row${ends.length ? chunk.slice(0, Math.min(...ends)) : chunk}`;
    const open = whole.slice(0, whole.indexOf('>') + 1);
    return { open, html: whole, classes: /class="([^"]*)"/.exec(open)![1]!.split(' ') };
  });
}
/** The row of lesson `hour`. */
const rowOf = (html: string, hour: number) => {
  const found = rows(html).find((r) => r.html.includes(`<span class="n">${hour}</span>`));
  if (!found) throw new Error(`no row for hour ${hour}`);
  return found;
};
const count = (html: string, part: string) => html.split(part).length - 1;
const header = (html: string) => /<div class="hd">.*?<\/div>/.exec(html)![0];

/** A day with every part on it: the fixture for the whole-card rules. */
function full(): DayCardData {
  const lessons = [
    lesson(1, 'מתמטיקה', { teacher: 'כהן', room: '12', startTime: '08:00', endTime: '08:45', note: 'הועבר משיעור 7' }),
    lesson(2, 'אנגלית', { teacher: 'לוי', room: '8', startTime: '08:50', endTime: '09:35', status: 'exam' }),
    lesson(3, 'היסטוריה', { status: 'cancelled', startTime: '09:50', endTime: '10:35' }),
    lesson(4, 'ספרות', { status: 'substitution', substitute: 'אברהם', startTime: '10:40', endTime: '11:25' }),
    lesson(5, 'פיזיקה', { status: 'moved', startTime: '11:45', endTime: '12:30' }),
    lesson(6, 'חינוך', { status: 'remote', startTime: '12:35', endTime: '13:20' }),
  ];
  return day({
    lessons,
    exams: [exam('אנגלית', { details: 'פרקים 3 עד 5' })],
    events: [event('טיול', { details: 'יציאה ב־8:00' })],
    holidayName: 'חנוכה',
    projected: true,
    old: true,
  });
}

describe('the title', () => {
  it('says tomorrow', () => {
    expect(card()).toContain('מחר, יום שלישי 10.11');
  });
  it('says today', () => {
    expect(card({}, new Date('2026-11-10T08:00:00Z'))).toContain('היום, יום שלישי 10.11');
  });
  it('says yesterday', () => {
    expect(card({}, new Date('2026-11-11T08:00:00Z'))).toContain('אתמול, יום שלישי 10.11');
  });
  it('names only the day when it is further off', () => {
    const html = card({}, new Date('2026-11-20T08:00:00Z'));
    expect(html).toContain('יום שלישי 10.11');
    for (const word of ['מחר', 'היום', 'אתמול']) expect(html).not.toContain(word);
  });
  it('turns the day at Israeli midnight, not UTC midnight', () => {
    // 00:30 on the 10th in Israel, still the 9th in UTC
    expect(card({}, new Date('2026-11-09T22:30:00Z'))).toContain('היום,');
    // 23:30 on the 9th in Israel
    expect(card({}, new Date('2026-11-09T21:30:00Z'))).toContain('מחר,');
  });
  it('escapes the weekday name', () => {
    expect(card({ weekdayName: XSS })).toContain('&lt;img');
  });
});

describe('the header count and hours', () => {
  it('counts the lessons that are not cancelled, and spans their hours', () => {
    const head = header(card());
    expect(head).toContain('6 שיעורים');
    expect(head).toContain('8:00–14:15');
  });
  it('keeps the hours left to right', () => {
    expect(card()).toContain('<bdi>8:00–14:15</bdi>');
  });
  it('says one lesson in words', () => {
    const head = header(card({ lessons: [lesson(1, 'מתמטיקה')] }));
    expect(head).toContain('שיעור אחד');
    expect(head).not.toContain('1 שיעורים');
  });
  it('has no range when no times are known', () => {
    const html = card({ lessons: [lesson(1, 'מתמטיקה'), lesson(2, 'אנגלית')] });
    expect(header(html)).toContain('2 שיעורים');
    expect(html).not.toContain('–');
  });
  it('has no range when only one end is known', () => {
    expect(card({ lessons: [lesson(1, 'מתמטיקה', { startTime: '08:00' })] })).not.toContain('–');
  });
  it('lets a cancelled first lesson move the start of the day', () => {
    const lessons = sketchLessons();
    lessons[0] = { ...lessons[0]!, status: 'cancelled' };
    expect(header(card({ lessons }))).toContain('8:50–14:15');
  });
  it('says no count when every lesson is cancelled', () => {
    const html = card({ lessons: [lesson(1, 'מתמטיקה', { status: 'cancelled', startTime: '08:00', endTime: '08:45' })] });
    expect(header(html)).not.toContain('שיעור');
    expect(html).not.toContain('–');
  });
});

describe('a lesson row', () => {
  it('holds the hour, the subject, the teacher and the room, each in its own element', () => {
    const row = rowOf(card(), 1);
    expect(row.html).toContain('<span class="n">1</span>');
    expect(row.html).toContain('<span class="s">מתמטיקה</span>');
    expect(row.html).toContain('<span>כהן</span>');
    expect(row.html).toContain('<span>12</span>');
    expect(row.classes).toEqual(['row']);
  });
  it('leaves out a teacher or a room it does not have', () => {
    const row = rowOf(card({ lessons: [lesson(1, 'מתמטיקה', { teacher: 'כהן' })] }), 1);
    expect(row.html).toContain('<span>כהן</span>');
    expect(count(row.html, '<span>')).toBe(1);
    expect(rowOf(card({ lessons: [lesson(1, 'מתמטיקה')] }), 1).html).not.toContain('class="m"');
  });
  it('sorts the lessons by hour', () => {
    const lessons = [lesson(3, 'אנגלית'), lesson(1, 'מתמטיקה'), lesson(2, 'היסטוריה')];
    const html = card({ lessons });
    expect(rows(html).map((r) => /<span class="n">(\d+)<\/span>/.exec(r.html)![1])).toEqual(['1', '2', '3']);
    // the caller's array stays as it was
    expect(lessons.map((l) => l.hourIndex)).toEqual([3, 1, 2]);
  });
  it('draws a cancelled lesson with cx and the tag בוטל', () => {
    const row = rowOf(card(), 4);
    expect(row.classes).toContain('cx');
    expect(row.html).toContain('<span class="tag t-cx">בוטל</span>');
    expect(rowOf(card(), 1).classes).not.toContain('cx');
  });
  it('puts the cancelled tag beside the subject, not inside it, so the strike-through stops at the subject', () => {
    const row = rowOf(card(), 4);
    expect(row.html).toContain('<span class="s">היסטוריה</span><span class="tag t-cx">בוטל</span>');
    // the other tags stay inside the subject
    const lessons = [lesson(1, 'ספרות', { status: 'substitution', substitute: 'אברהם' })];
    expect(rowOf(card({ lessons }), 1).html).toContain('<span class="s">ספרות<span class="tag t-ch">מחליף/ה: אברהם</span></span>');
  });
  it('keeps the teacher and room after the cancelled tag', () => {
    const lessons = [lesson(1, 'היסטוריה', { status: 'cancelled', teacher: 'כהן' })];
    const html = rowOf(card({ lessons }), 1).html;
    expect(html.indexOf('t-cx')).toBeLessThan(html.indexOf('<span class="m">'));
  });
  it('tells a substitute by name', () => {
    const lessons = [lesson(1, 'ספרות', { status: 'substitution', substitute: 'אברהם' })];
    const row = rowOf(card({ lessons }), 1);
    expect(row.html).toContain('<span class="tag t-ch">מחליף/ה: אברהם</span>');
    expect(row.classes).toContain('ch');
  });
  it('tells a substitute with no name', () => {
    const lessons = [lesson(1, 'ספרות', { status: 'substitution' })];
    expect(rowOf(card({ lessons }), 1).html).toContain('<span class="tag t-ch">מחליף/ה</span>');
  });
  it('tells a lesson that moved, and one that is remote', () => {
    const lessons = [lesson(1, 'פיזיקה', { status: 'moved' }), lesson(2, 'חינוך', { status: 'remote' })];
    const html = card({ lessons });
    expect(rowOf(html, 1).html).toContain('<span class="tag t-ch">הועבר</span>');
    expect(rowOf(html, 1).classes).toContain('ch');
    expect(rowOf(html, 2).html).toContain('<span class="tag t-ch">מרחוק</span>');
    expect(rowOf(html, 2).classes).toContain('ch');
  });
  it('shows a note under the row, escaped', () => {
    const lessons = [lesson(1, 'מתמטיקה', { note: 'הועבר משיעור 7 <b>' })];
    const row = rowOf(card({ lessons }), 1);
    expect(row.html).toContain('<div class="note">הועבר משיעור 7 &lt;b&gt;</div>');
    expect(row.html.indexOf('class="note"')).toBeGreaterThan(row.html.indexOf('class="s"'));
  });
});

describe('an exam', () => {
  /** English at hours 2 and 5; the school marked the fifth as the exam, and the grid names it by the change's own text. */
  const lessons = (): Lesson[] => [
    lesson(1, 'מתמטיקה'), lesson(2, 'אנגלית'), lesson(3, 'היסטוריה'), lesson(4, 'ספרות'), lesson(5, 'בוחן באנגלית', { status: 'exam' }),
  ];
  const banners = (html: string) => [...html.matchAll(/<div class="banner">(.*?)<\/div>/g)].map((m) => m[1]);
  /** The one banner of a day with this exam on it. */
  const bannerOf = (e: Exam, over: Partial<DayCardData> = {}) => {
    const found = banners(card({ exams: [e], lessons: lessons(), ...over }));
    expect(found).toHaveLength(1);
    return found[0];
  };
  const marked = (html: string) => rows(html).filter((r) => r.classes.includes('ex')).map((r) => /<span class="n">(\d*)<\/span>/.exec(r.html)![1]);

  describe('the words of the banner', () => {
    it('leaves a title that already says what it is as the school wrote it', () => {
      for (const title of ['מבחן במתמטיקה', 'בוחן באנגלית', 'בגרות במתמטיקה - רק למשפרים', 'בחינת בגרות באנגלית', 'מבחן באנגלית 5 יחידות', 'מתכונת בפיזיקה', 'מבחנים באנגלית ובפיזיקה', 'מבחני סיום']) {
        expect(banners(card({ exams: [exam(title)], lessons: [] })), title).toEqual([title]);
      }
    });
    it('leaves every title that is more than a bare subject as written, whatever its words', () => {
      const titles = [
        'שכבתי במתמטיקה', 'הדמיה ממוחשבת בביולוגיה', 'בע"פ ערבית', '3 אקדמיזציה', '2- הערכת פרויקט שירותי רשת',
        'פתיחת תערוכה - מגמת אמנות', 'עבודות בהיסטוריה', 'מעבדה', 'הדמיה ממוחשבת', '17:00', 'מועד ב׳', 'English', 'אנגלית 5 יח"ל',
      ];
      for (const title of titles) expect(banners(card({ exams: [exam(title)], lessons: [] })), title).toEqual([escapeHtml(title)]);
    });
    it('never says מבחן twice, or before a word that is not a subject', () => {
      const html = card({
        exams: ['מבחן במתמטיקה', 'בוחן באנגלית', 'בגרות במתמטיקה - רק למשפרים', 'שכבתי במתמטיקה', 'הדמיה ממוחשבת בביולוגיה', 'בע"פ ערבית'].map((t) => exam(t)),
        lessons: [],
      });
      for (const wrong of ['מבחן במבחן', 'מבחן בבוחן', 'מבחן בבגרות', 'מבחן בשכבתי', 'מבחן בהדמיה', 'מבחן בבע"פ', 'מבחן בבע&quot;פ']) expect(html, wrong).not.toContain(wrong);
    });
    it('gives a bare subject the words מבחן ב', () => {
      const bare = ['אנגלית', 'מתמטיקה', 'תנ״ך', 'מוסיקה', 'עברית'];
      expect(banners(card({ exams: bare.map((t) => exam(t)), lessons: [] }))).toEqual(bare.map((t) => `מבחן ב${t}`));
    });
    it('knows a bare subject by either quote mark', () => {
      expect(banners(card({ exams: [exam('תנ"ך')], lessons: [] }))).toEqual(['מבחן בתנ&quot;ך']);
    });
    it('leaves a title that is the whole title but no subject we know as written', () => {
      for (const title of ['פירוק תערוכה', 'טורניר כספות']) {
        expect(banners(card({ exams: [exam(title)], lessons: [] })), title).toEqual([title]);
        // not even on a day with other lessons
        expect(banners(card({ exams: [exam(title)], lessons: [lesson(1, 'מתמטיקה'), lesson(2, 'ספרות')] })), title).toEqual([title]);
      }
    });
    it('gives a subject we do not know the words when a lesson of the day has it', () => {
      // ספרות is not in the alias table
      expect(banners(card({ exams: [exam('ספרות')], lessons: [] }))).toEqual(['ספרות']);
      expect(banners(card({ exams: [exam('ספרות')], lessons: [lesson(1, 'מתמטיקה'), lesson(4, 'ספרות')] }))).toEqual(['מבחן בספרות']);
      // the lesson may be named by its group, or be the marked one with the change text for a name
      expect(banners(card({ exams: [exam('ספרות')], lessons: [lesson(4, 'ספרות מורחב (יב2)')] }))).toEqual(['מבחן בספרות']);
      expect(banners(card({ exams: [exam('ספרות')], lessons: [lesson(4, 'מבחן בספרות', { status: 'exam' })] }))).toEqual(['מבחן בספרות, שעה 4']);
      // another subject's lesson is not it
      expect(banners(card({ exams: [exam('אזרחות')], lessons: [lesson(4, 'ספרות')] }))).toEqual(['אזרחות']);
    });
    it('always gives the words to a Mashov exam or a bagrut exam with a bare title, since those sources give only subjects', () => {
      expect(banners(card({ exams: [exam('ספרות', { source: 'mashov' })], lessons: [] }))).toEqual(['מבחן בספרות']);
      expect(banners(card({ exams: [exam('ספרות', { kind: 'bagrut' })], lessons: [] }))).toEqual(['בגרות בספרות']);
      // a title that is more than a subject still stands
      expect(banners(card({ exams: [exam('שכבתי במתמטיקה', { source: 'mashov' })], lessons: [] }))).toEqual(['שכבתי במתמטיקה']);
    });
    it('names a block exam one way, however the school wrote it', () => {
      for (const title of ['מבחן גוש א', 'מבחן בגוש א', 'גוש א׳', "גוש א'", 'בגוש א']) {
        expect(banners(card({ exams: [exam(title)], lessons: [] })), title).toEqual(['מבחן גוש א׳']);
      }
      expect(banners(card({ exams: [exam("גוש ב'")], lessons: [] }))).toEqual(['מבחן גוש ב׳']);
    });
    it('leaves a block title of another shape as written, without מבחן ב before it', () => {
      expect(banners(card({ exams: [exam('גוש א - פיזיקה, ביולוגיה')], lessons: [] }))).toEqual(['גוש א - פיזיקה, ביולוגיה']);
    });
    it('puts the title on one line, with single spaces', () => {
      expect(banners(card({ exams: [exam('  מבחן   באנגלית\n(מועד א) ')], lessons: [] }))).toEqual(['מבחן באנגלית (מועד א)']);
    });
    it('goes by the school\'s title when the student gave the exam a name of their own', () => {
      // the school wrote a bare subject: the words are added to the student's name
      expect(banners(card({ exams: [exam('English', { originalSubject: 'אנגלית' })], lessons: [] }))).toEqual(['מבחן ב־English']);
      // the school wrote a full title: the student's name stands as it is
      expect(banners(card({ exams: [exam('הבוחן הנורא', { originalSubject: 'בוחן באנגלית' })], lessons: [] }))).toEqual(['הבוחן הנורא']);
    });
    it('adds the details after the title and the hour, with a comma', () => {
      expect(bannerOf(exam('מבחן באנגלית', { details: 'פרק 4' }))).toBe('מבחן באנגלית, שעה 5, פרק 4');
    });
    it('leaves the details out when they only say the title again', () => {
      expect(bannerOf(exam('מבחן באנגלית', { details: 'מבחן באנגלית' }))).toBe('מבחן באנגלית, שעה 5');
      expect(bannerOf(exam('מתמטיקה', { kind: 'bagrut', details: 'מתמטיקה' }))).toBe('בגרות במתמטיקה');
    });
    it('calls a bagrut exam with a bare subject בגרות, and any other bare subject מבחן', () => {
      expect(banners(card({ exams: [exam('מתמטיקה', { kind: 'bagrut' })], lessons: [] }))).toEqual(['בגרות במתמטיקה']);
      // only a bare subject takes a word, and a Latin name is not one the reader knows
      expect(banners(card({ exams: [exam('English', { kind: 'bagrut' })], lessons: [] }))).toEqual(['English']);
      expect(banners(card({ exams: [exam('מתמטיקה', { kind: 'manual' })], lessons: [] }))).toEqual(['מבחן במתמטיקה']);
      expect(banners(card({ exams: [exam('מתמטיקה')], lessons: [] }))).toEqual(['מבחן במתמטיקה']);
    });
    it('leaves the title of a bagrut exam that already says what it is as written', () => {
      expect(banners(card({ exams: [exam('בגרות במתמטיקה - רק למשפרים', { kind: 'bagrut' }), exam('מבחן באנגלית', { kind: 'bagrut' })], lessons: [] })))
        .toEqual(['בגרות במתמטיקה - רק למשפרים', 'מבחן באנגלית']);
    });
    it('keeps the student\'s name for a bagrut exam, with בגרות before a bare one', () => {
      expect(banners(card({ exams: [exam('English', { kind: 'bagrut', originalSubject: 'אנגלית' })], lessons: [] }))).toEqual(['בגרות ב־English']);
    });
    it('escapes the title', () => {
      expect(banners(card({ exams: [exam(`מבחן ${XSS}`)], lessons: [] }))).toEqual(['מבחן &lt;img src=x onerror=alert(1)&gt;']);
    });
    it('has a banner for each of two exams, above the lessons', () => {
      const html = card({ exams: [exam('מבחן באנגלית'), exam('בוחן בפיזיקה')], lessons: lessons() });
      expect(count(html, 'class="banner"')).toBe(2);
      expect(html.lastIndexOf('class="banner"')).toBeLessThan(html.indexOf('class="row'));
    });
  });

  describe('the hour', () => {
    it('is the lesson the school marked as the exam, not another lesson of the subject', () => {
      const html = card({ exams: [exam('מבחן באנגלית')], lessons: lessons() });
      expect(banners(html)).toEqual(['מבחן באנגלית, שעה 5']);
      expect(marked(html)).toEqual(['5']);
      expect(rowOf(html, 5).html).toContain('<span class="s">בוחן באנגלית<span class="tag t-ex">מבחן</span></span>');
      expect(rowOf(html, 2).classes).toEqual(['row']);
      expect(rowOf(html, 2).html).not.toContain('class="tag');
    });
    it('is found for a title in each of the school\'s words', () => {
      for (const title of ['מבחן באנגלית', 'בוחן באנגלית', 'בגרות באנגלית - רק למשפרים', 'אנגלית']) {
        expect(bannerOf(exam(title)), title).toMatch(/, שעה 5(,|$)/);
      }
    });
    it('is found by the change text the grid names a marked lesson with', () => {
      const real = [
        lesson(1, 'מתמטיקה'),
        lesson(2, 'מבחן בהיסטוריה שיכבה יא', { status: 'exam' }),
        lesson(3, 'מבחן עברית ט שכבתי', { status: 'exam' }),
        lesson(4, 'מבחן במתמטיקה', { status: 'exam' }),
        lesson(5, 'בוחן באנגלית', { status: 'exam' }),
      ];
      // a bare subject, and the school's own titles
      expect(bannerOf(exam('מתמטיקה'), { lessons: real })).toBe('מבחן במתמטיקה, שעה 4');
      expect(bannerOf(exam('מבחן בהיסטוריה'), { lessons: real })).toBe('מבחן בהיסטוריה, שעה 2');
      expect(bannerOf(exam('מבחן עברית'), { lessons: real })).toBe('מבחן עברית, שעה 3');
      expect(bannerOf(exam('בוחן באנגלית'), { lessons: real })).toBe('בוחן באנגלית, שעה 5');
      expect(bannerOf(exam('מבחן במתמטיקה'), { lessons: real })).toBe('מבחן במתמטיקה, שעה 4');
      expect(marked(card({ exams: [exam('מתמטיקה')], lessons: real }))).toEqual(['2', '3', '4', '5']);
    });
    it('is found when the exam and the lesson have the same title, though it names no subject', () => {
      const same = [lesson(1, 'מתמטיקה'), lesson(3, 'מבחן גוש א', { status: 'exam' })];
      expect(bannerOf(exam('מבחן גוש א'), { lessons: same })).toBe('מבחן גוש א׳, שעה 3');
      expect(bannerOf(exam('מבחן בגוש א'), { lessons: same })).toBe('מבחן גוש א׳, שעה 3');
      // another block is another exam
      expect(bannerOf(exam('מבחן גוש ב'), { lessons: same })).toBe('מבחן גוש ב׳');
    });
    it('is never a regular lesson\'s: with no lesson marked there is none', () => {
      const regular = lessons().map((l) => ({ ...l, status: 'regular' as const }));
      const html = card({ exams: [exam('מבחן באנגלית')], lessons: regular });
      expect(banners(html)).toEqual(['מבחן באנגלית']);
      expect(marked(html)).toEqual([]);
    });
    it('is the exam\'s own time when it has one, a bagrut exam\'s for one', () => {
      const bagrut = exam('מתמטיקה', { kind: 'bagrut', startTime: '14:00', endTime: '15:45' });
      const html = card({ exams: [bagrut], lessons: [lesson(1, 'אנגלית'), lesson(2, 'מתמטיקה'), lesson(3, 'היסטוריה')] });
      expect(banners(html)).toEqual(['בגרות במתמטיקה, ב־14:00']);
      // the regular maths lesson of the day is not the exam
      expect(marked(html)).toEqual([]);
    });
    it('is the exam\'s own time before the lesson marked, which stays marked', () => {
      const html = card({ exams: [exam('מבחן באנגלית', { startTime: '09:00' })], lessons: lessons() });
      expect(banners(html)).toEqual(['מבחן באנגלית, ב־9:00']);
      expect(marked(html)).toEqual(['5']);
    });
    it('reads a time as the phone does, and passes over what is not a time', () => {
      expect(bannerOf(exam('מבחן באנגלית', { startTime: '09:00:00' }))).toBe('מבחן באנגלית, ב־9:00');
      expect(bannerOf(exam('מבחן באנגלית', { startTime: '9:05' }))).toBe('מבחן באנגלית, ב־9:05');
      expect(bannerOf(exam('מבחן באנגלית', { startTime: 'בבוקר' }))).toBe('מבחן באנגלית, שעה 5');
      expect(bannerOf(exam('מבחן באנגלית', { startTime: '25:00' }))).toBe('מבחן באנגלית, שעה 5');
      expect(bannerOf(exam('מבחן באנגלית', { startTime: null }))).toBe('מבחן באנגלית, שעה 5');
    });
    it('says שעות for lessons in a row', () => {
      const two = [lesson(1, 'מתמטיקה'), lesson(5, 'מבחן באנגלית', { status: 'exam' }), lesson(6, 'מבחן באנגלית', { status: 'exam' })];
      const html = card({ exams: [exam('מבחן באנגלית')], lessons: two });
      // the range reads left to right, whatever the paragraph's direction (it would show as 6–5 otherwise)
      expect(banners(html)).toEqual(['מבחן באנגלית, שעות <bdi>5–6</bdi>']);
      expect(marked(html)).toEqual(['5', '6']);
    });
    it('names each hour when the lessons are apart', () => {
      const apart = [lesson(1, 'מבחן באנגלית', { status: 'exam' }), lesson(2, 'מתמטיקה'), lesson(4, 'בוחן באנגלית', { status: 'exam' })];
      expect(banners(card({ exams: [exam('מבחן באנגלית')], lessons: apart }))).toEqual(['מבחן באנגלית, שעות 1 ו־4']);
      const three = [...apart, lesson(6, 'מבחן באנגלית', { status: 'exam' })];
      expect(banners(card({ exams: [exam('מבחן באנגלית')], lessons: three }))).toEqual(['מבחן באנגלית, שעות 1, 4 ו־6']);
    });
    it('is not taken from a lesson that is cancelled', () => {
      const html = card({ exams: [exam('מבחן באנגלית')], lessons: [lesson(1, 'מתמטיקה'), lesson(3, 'אנגלית', { status: 'cancelled' })] });
      expect(banners(html)).toEqual(['מבחן באנגלית']);
      expect(marked(html)).toEqual([]);
      expect(rowOf(html, 3).classes).toEqual(['row', 'cx']);
    });
    it('is not named on a day projected from the fixed timetable', () => {
      const html = card({ projected: true, exams: [exam('מבחן באנגלית')], lessons: lessons() });
      expect(banners(html)).toEqual(['מבחן באנגלית']);
      expect(html).not.toContain('שעה');
    });
    it('is still the exam\'s own time on a projected day', () => {
      const html = card({ projected: true, exams: [exam('מבחן באנגלית', { startTime: '10:30' })], lessons: lessons() });
      expect(banners(html)).toEqual(['מבחן באנגלית, ב־10:30']);
    });
    it('is none for a block exam, which names no subject', () => {
      const html = card({ exams: [exam('מבחן גוש א')], lessons: lessons() });
      expect(banners(html)).toEqual(['מבחן גוש א׳']);
    });
    it('is none for a title that names no subject at all', () => {
      expect(banners(card({ exams: [exam('מועד ב׳')], lessons: lessons() }))).toEqual(['מועד ב׳']);
    });
    it('is matched to the lesson the way the app matches subjects', () => {
      const long = [lesson(3, 'אנגלית 5 יח״ל (יב2)', { status: 'exam' }), lesson(4, 'פיזיקה')];
      expect(bannerOf(exam('מבחן באנג'), { lessons: long })).toBe('מבחן באנג, שעה 3');
      expect(bannerOf(exam('בוחן בפיזיקה'), { lessons: long })).toBe('בוחן בפיזיקה');
    });
    it('is matched through the name the source gave, when the student renamed the subject', () => {
      const renamed = [lesson(2, 'האנגלית שלי', { originalSubject: 'אנגלית', status: 'exam' })];
      expect(bannerOf(exam('מבחן באנגלית'), { lessons: renamed })).toBe('מבחן באנגלית, שעה 2');
    });
    it('is matched through the school\'s title when the student named the exam', () => {
      const mine = exam('הבוחן הנורא', { originalSubject: 'בוחן באנגלית' });
      expect(bannerOf(mine)).toBe('הבוחן הנורא, שעה 5');
    });
    it('ignores an original subject that is not text, on a lesson or on an exam', () => {
      const odd = (value: unknown) => value as string;
      const strange = [lesson(1, 'מתמטיקה', { originalSubject: odd(5) }), lesson(2, 'היסטוריה', { originalSubject: odd({}) }), lesson(3, 'אנגלית', { status: 'exam' })];
      expect(() => card({ exams: [exam('מבחן באנגלית')], lessons: strange })).not.toThrow();
      expect(bannerOf(exam('מבחן באנגלית'), { lessons: strange })).toBe('מבחן באנגלית, שעה 3');
      expect(bannerOf({ ...exam('מבחן באנגלית'), originalSubject: odd(['x']) }, { lessons: strange })).toBe('מבחן באנגלית, שעה 3');
    });
  });

  describe('the rows', () => {
    it('marks a lesson the school marked as an exam, with or without an exam entry', () => {
      const html = card({ exams: [], lessons: lessons() });
      expect(count(html, 'class="banner"')).toBe(0);
      expect(marked(html)).toEqual(['5']);
      expect(rowOf(html, 5).html).toContain('<span class="s">בוחן באנגלית<span class="tag t-ex">מבחן</span></span>');
    });
    it('marks it whatever the entry says about its subject', () => {
      expect(marked(card({ exams: [exam('בוחן בפיזיקה')], lessons: lessons() }))).toEqual(['5']);
    });
    it('never marks a regular lesson because of an exam entry', () => {
      const html = card({ exams: [exam('מבחן במתמטיקה'), exam('אנגלית')], lessons: [lesson(1, 'מתמטיקה'), lesson(2, 'אנגלית')] });
      expect(marked(html)).toEqual([]);
      expect(html).not.toContain('t-ex');
    });
    it('never marks a changed lesson because of an exam entry either', () => {
      const html = card({ exams: [exam('מבחן באנגלית')], lessons: [lesson(1, 'אנגלית', { status: 'substitution', substitute: 'אברהם' }), lesson(2, 'אנגלית', { status: 'moved' })] });
      expect(marked(html)).toEqual([]);
    });
    it('draws a lesson whose status is event as a regular row', () => {
      const html = card({ lessons: [lesson(1, 'טיול', { status: 'event' })] });
      expect(rowOf(html, 1).classes).toEqual(['row']);
      expect(rowOf(html, 1).html).not.toContain('class="tag');
    });
  });
});

describe('the exams of the demo copy', () => {
  it('draw no banner with מבחן twice, on any day of the copy', async () => {
    const now = new Date('2026-11-04T08:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'], now });
    try {
      const { DEFAULT_SETTINGS } = await import('@sederyom/shared');
      const { demoData, demoSettings } = await import('../../app/src/demo/data');
      const { demoSourcesFrom } = await import('../../app/src/demo/sources');
      const { buildChatSnapshot } = await import('../../app/src/chat/snapshot');
      const { dayAnswer } = await import('../src/chat/answers.js');
      const shares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };
      const snapshot = buildChatSnapshot(
        demoSourcesFrom(demoData(now, 'Asia/Jerusalem'), demoSettings(DEFAULT_SETTINGS), now, 'Asia/Jerusalem'),
        shares,
        { name: 'x', className: 'יא2' },
        now.toISOString(),
      );
      const examDays = snapshot.days.filter((d) => d.examsToday.length > 0);
      // the demo has exams in its two weeks; an empty loop would prove nothing
      expect(examDays.length).toBeGreaterThanOrEqual(2);
      for (const d of examDays) {
        const structured = JSON.parse(JSON.stringify(dayAnswer(snapshot, d.date, now, 'Asia/Jerusalem').structured));
        expect(isDayCardData(structured), d.date).toBe(true);
        const html = dayCardMarkup(structured, now);
        const found = [...html.matchAll(/<div class="banner">(.*?)<\/div>/g)].map((m) => m[1]!);
        expect(found.length, d.date).toBe(d.examsToday.length);
        for (const banner of found) {
          for (const doubled of ['מבחן במבחן', 'מבחן בבוחן', 'מבחן בבגרות']) expect(banner, `${d.date}: ${banner}`).not.toContain(doubled);
        }
        // each banner is the school's own title
        for (const e of d.examsToday) expect(found.some((b) => b.startsWith(e.subject)), `${d.date}: ${e.subject}`).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the exam titles of the school calendar', () => {
  /** Every distinct title of the real feed, read the way production reads it (`examTitle`). */
  const titles = (): string[] => {
    const ics = readFileSync(fileURLToPath(new URL('../fixtures/school-site/exams-yb.ics', import.meta.url)), 'utf8');
    return [...new Set(parseIcs(ics, { zone: 'Asia/Jerusalem' }).events.map((e) => examTitle(e.summary)).filter(Boolean))];
  };
  const bannerFor = (title: string): string => /<div class="banner">(.*?)<\/div>/.exec(card({ exams: [exam(title)], lessons: [] }))![1]!;
  const BLOCK = /^(?:מבחן\s+)?ב?גוש\s*([אב])['׳]?$/;

  it('has the 124 titles of the capture', () => {
    expect(titles()).toHaveLength(124);
  });
  it('puts a word before a bare subject and before nothing else', () => {
    let bare = 0;
    let stood = 0;
    for (const title of titles()) {
      const block = BLOCK.exec(title);
      // bare: the reader finds exactly the title as the subject, and a subject it knows (the day has no lessons here)
      const read = parseExamTitle(title);
      const isBare = !block && read.known && subjectKey(read.subject) === subjectKey(title);
      const expected = block ? `מבחן גוש ${block[1]}׳` : isBare ? `מבחן ב${title}` : title;
      expect(bannerFor(title), title).toBe(escapeHtml(expected));
      if (isBare) bare++;
      else stood++;
    }
    // neither side is empty, so the loop proves something
    expect(bare).toBeGreaterThanOrEqual(1);
    expect(stood).toBeGreaterThan(50);
    // the one subject the calendar lists by itself
    expect(titles()).toContain('מוסיקה');
    expect(bannerFor('מוסיקה')).toBe('מבחן במוסיקה');
  });
  it('never says מבחן twice, or before a word that is not a subject', () => {
    const all = titles().map(bannerFor).join('\n');
    for (const wrong of ['מבחן במבחן', 'מבחן בבוחן', 'מבחן בבגרות', 'מבחן בשכבתי', 'מבחן בהדמיה', 'מבחן בבע"פ', 'מבחן בבע&quot;פ', 'מבחן בפירוק', 'מבחן בטורניר']) expect(all, wrong).not.toContain(wrong);
  });
  it('draws each title in a whole card, with no tag or middle dot of its own', () => {
    for (const title of titles()) {
      const html = card({ exams: [exam(title)], lessons: [] });
      expect(count(html, 'class="banner"'), title).toBe(1);
      expect(html, title).not.toContain('·');
    }
  });
});

describe('a day with no school', () => {
  it('says so with the holiday, tomorrow', () => {
    const html = card({ isSchoolDay: false, holidayName: 'חנוכה', lessons: [] });
    expect(html).toContain('מחר אין לימודים: חנוכה');
    expect(rows(html)).toHaveLength(0);
  });
  it('says so without a holiday', () => {
    const html = card({ isSchoolDay: false, lessons: [] });
    expect(html).toContain('מחר אין לימודים');
    expect(html).not.toContain('מחר אין לימודים:');
    expect(rows(html)).toHaveLength(0);
  });
  it('names the day when it is further off', () => {
    const html = card({ isSchoolDay: false, lessons: [] }, new Date('2026-11-20T08:00:00Z'));
    expect(html).toContain('אין לימודים ביום שלישי 10.11');
    expect(html).not.toContain('מחר');
  });
  it('names the holiday when it is further off', () => {
    expect(card({ isSchoolDay: false, holidayName: 'חנוכה', lessons: [] }, new Date('2026-11-20T08:00:00Z'))).toContain('אין לימודים ביום שלישי 10.11: חנוכה');
  });
  it('says today and yesterday the same way', () => {
    expect(card({ isSchoolDay: false, lessons: [] }, new Date('2026-11-10T08:00:00Z'))).toContain('היום אין לימודים');
    expect(card({ isSchoolDay: false, lessons: [] }, new Date('2026-11-11T08:00:00Z'))).toContain('אתמול אין לימודים');
  });
  it('escapes the holiday', () => {
    const html = card({ isSchoolDay: false, holidayName: XSS, lessons: [] });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('still shows what the day holds', () => {
    const html = card({ isSchoolDay: false, lessons: [], exams: [exam('אנגלית', { startTime: '09:00' })], events: [event('טיול')] });
    expect(html).toContain('מבחן באנגלית');
    expect(html).toContain('אירוע: טיול');
  });
});

describe('an event', () => {
  it('is a row, "אירוע" and the title', () => {
    const html = card({ events: [event('טיול')] });
    expect(html).toContain('<span class="s">אירוע: טיול</span>');
    const last = rows(html).at(-1)!;
    expect(last.html).toContain('אירוע: טיול');
    // it sits after the lessons
    expect(rows(html)).toHaveLength(8);
  });
  it('adds the details after a comma, so the row never holds two colons', () => {
    const html = card({ events: [event('טיול', { details: 'יציאה ב־8:00' })] });
    expect(html).toContain('<span class="s">אירוע: טיול, יציאה ב־8:00</span>');
    expect(html).not.toContain('טיול:');
  });
  it('does not count as a lesson', () => {
    expect(header(card({ events: [event('טיול')] }))).toContain('6 שיעורים');
  });
});

describe('a school day with nothing on it', () => {
  const NONE = '<div class="line">אין שיעורים ביום הזה.</div>';

  it('says so in one line, between the header and the footer', () => {
    const html = card({ lessons: [], exams: [], events: [] });
    expect(html).toContain(NONE);
    expect(html.indexOf(NONE)).toBeGreaterThan(html.indexOf('class="hd"'));
    expect(html.indexOf(NONE)).toBeLessThan(html.indexOf('class="foot"'));
    expect(count(html, 'אין שיעורים')).toBe(1);
  });
  it('says nothing when there are lessons', () => {
    expect(card()).not.toContain('אין שיעורים');
  });
  it('says nothing when an exam or an event fills the day', () => {
    expect(card({ lessons: [], exams: [exam('אנגלית', { startTime: '09:00' })] })).not.toContain('אין שיעורים');
    expect(card({ lessons: [], events: [event('טיול')] })).not.toContain('אין שיעורים');
  });
  it('says nothing on a day with no school, where the header already says it', () => {
    expect(card({ isSchoolDay: false, holidayName: 'חנוכה', lessons: [] })).not.toContain('אין שיעורים');
  });
  it('comes before the old-copy line', () => {
    const html = card({ lessons: [], old: true });
    expect(html.indexOf('אין שיעורים')).toBeLessThan(html.indexOf('לא עדכני'));
  });
});

describe('the lines under the lessons', () => {
  const PROJECTED = 'השיעורים לפי המערכת הקבועה: בית הספר עוד לא פרסם את השבוע.';
  const OLD = 'המידע לא עדכני. כדאי לפתוח את סדר יום כדי לעדכן.';

  it('says a week is projected, when there are lessons', () => {
    expect(card({ projected: true })).toContain(`<div class="line">${PROJECTED}</div>`);
  });
  it('does not say it when there are no lessons', () => {
    expect(card({ projected: true, lessons: [] })).not.toContain('המערכת הקבועה');
  });
  it('does not say it for a published week', () => {
    expect(card()).not.toContain('המערכת הקבועה');
  });
  it('says a copy is old', () => {
    expect(card({ old: true })).toContain(`<div class="line">${OLD}</div>`);
  });
  it('does not say it for a fresh copy', () => {
    expect(card()).not.toContain('לא עדכני');
  });
  it('puts them after the lessons and before the footer', () => {
    const html = card({ projected: true, old: true });
    const lastRow = html.lastIndexOf('class="row');
    expect(html.indexOf(PROJECTED)).toBeGreaterThan(lastRow);
    expect(html.indexOf(OLD)).toBeGreaterThan(lastRow);
    expect(html.indexOf(OLD)).toBeLessThan(html.indexOf('class="foot"'));
  });
});

describe('the footer', () => {
  it('names the app and says today, with the time in Israel', () => {
    expect(card()).toContain('<div class="foot"><span>סדר יום</span><span>עודכן היום ב־16:40</span></div>');
  });
  it('reads the day of the update in Israel, not in UTC', () => {
    // 00:30 on the 9th in Israel, still the 8th in UTC
    expect(card({ updatedAt: '2026-11-08T22:30:00Z' })).toContain('עודכן היום ב־0:30');
  });
  it('says yesterday', () => {
    expect(card({ updatedAt: '2026-11-08T14:40:00Z' })).toContain('עודכן אתמול ב־16:40');
  });
  it('gives the date when it is older', () => {
    const html = card({ updatedAt: '2026-11-05T14:40:00Z' });
    expect(html).toContain('עודכן ב־5.11 ב־16:40');
    expect(html).not.toContain('עודכן היום');
    expect(html).not.toContain('עודכן אתמול');
  });
  it('compares with the day it is drawn, so a reopened card ages', () => {
    expect(card({}, new Date('2026-11-10T08:00:00Z'))).toContain('עודכן אתמול ב־16:40');
    expect(card({}, new Date('2026-11-12T08:00:00Z'))).toContain('עודכן ב־9.11 ב־16:40');
  });
  it('gives the date for an update that is ahead of the clock', () => {
    expect(card({ updatedAt: '2026-11-12T14:40:00Z' })).toContain('עודכן ב־12.11 ב־16:40');
  });
  it('stands with only the app name when the time cannot be read', () => {
    expect(card({ updatedAt: 'not a time' })).toContain('<div class="foot"><span>סדר יום</span></div>');
  });
});

describe('the whole card', () => {
  it('has no middle dot, no long dash, no check mark and no emoji', () => {
    const html = dayCardMarkup(full(), NOW);
    expect(html).not.toContain('·');
    expect(html).not.toContain(' — ');
    expect(html).not.toContain('—');
    expect(html).not.toContain('✓');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    // the full fixture really shows each part
    for (const part of ['class="banner"', 't-cx', 't-ch', 't-ex', 'class="note"', 'אירוע: טיול', 'המערכת הקבועה', 'לא עדכני', 'class="foot"']) {
      expect(html).toContain(part);
    }
  });
  it('has no middle dot on a day with no school either', () => {
    expect(dayCardMarkup(day({ isSchoolDay: false, holidayName: 'חנוכה', lessons: [] }), NOW)).not.toContain('·');
  });
  it('never lets text from outside become markup', () => {
    const evil = day({
      weekdayName: XSS,
      holidayName: XSS,
      lessons: [lesson(1, XSS, { teacher: XSS, room: XSS, note: XSS, substitute: XSS, status: 'substitution' })],
      exams: [exam(XSS, { details: XSS })],
      events: [event(XSS, { details: XSS })],
    });
    const html = dayCardMarkup(evil, NOW);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const away = dayCardMarkup({ ...evil, isSchoolDay: false }, NOW);
    expect(away).not.toContain('<img');
  });
  it('uses no method the page\'s build target (es2020) does not have', () => {
    // `Array.prototype.at` is ES2022: a chat's older web view would stop drawing at the first call
    const source = readFileSync(fileURLToPath(new URL('../src/chat/card/markup.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/\.at\(/);
  });
  it('survives a day with nothing on it', () => {
    const html = card({ lessons: [], exams: [], events: [] });
    expect(html).toContain('מחר, יום שלישי 10.11');
    expect(html).toContain('class="foot"');
    expect(rows(html)).toHaveLength(0);
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that can open a tag or an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('leaves Hebrew and numbers as they are', () => {
    expect(escapeHtml('מתמטיקה 5 יח״ל')).toBe('מתמטיקה 5 יח״ל');
  });
});

describe('plainCardMarkup', () => {
  it('escapes the text', () => {
    const html = plainCardMarkup(XSS);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('keeps the line breaks, in an element of class plain', () => {
    const html = plainCardMarkup('שורה א\nשורה ב\r\nשורה ג');
    expect(html).toMatch(/^<div class="plain">.*<\/div>$/s);
    expect(html).toContain('שורה א<br>שורה ב<br>שורה ג');
    expect(html).not.toMatch(/[\r\n]/);
  });
});

describe('isDayCardData', () => {
  it('accepts a day', () => {
    expect(isDayCardData(day())).toBe(true);
    expect(isDayCardData(full())).toBe(true);
    // what travels over the wire
    expect(isDayCardData(JSON.parse(JSON.stringify(day())))).toBe(true);
  });
  it('accepts a holiday with a name', () => {
    expect(isDayCardData(day({ isSchoolDay: false, holidayName: 'חנוכה', lessons: [] }))).toBe(true);
  });
  it('refuses what is not a day', () => {
    expect(isDayCardData({ status: 'no_copy' })).toBe(false);
    expect(isDayCardData({ found: false })).toBe(false);
    expect(isDayCardData({ date: DATE, found: false, first: null, last: null, updatedAt: UPDATED, old: false })).toBe(false);
    expect(isDayCardData(null)).toBe(false);
    expect(isDayCardData(undefined)).toBe(false);
    expect(isDayCardData('day')).toBe(false);
    expect(isDayCardData([])).toBe(false);
  });
  it('refuses a day whose lists are not lists', () => {
    for (const key of ['lessons', 'exams', 'events'] as const) {
      expect(isDayCardData({ ...day(), [key]: 'x' })).toBe(false);
      expect(isDayCardData({ ...day(), [key]: null })).toBe(false);
      expect(isDayCardData({ ...day(), [key]: {} })).toBe(false);
    }
  });
  it('refuses a day missing a field the card reads', () => {
    for (const key of ['date', 'weekdayName', 'isSchoolDay', 'holidayName', 'projected', 'updatedAt', 'old'] as const) {
      const { [key]: _gone, ...rest } = day();
      expect(isDayCardData(rest)).toBe(false);
    }
  });
  it('refuses a date that is not a date', () => {
    expect(isDayCardData({ ...day(), date: 'tomorrow' })).toBe(false);
    expect(isDayCardData({ ...day(), date: '2026-11-10T00:00:00Z' })).toBe(false);
  });
  it('refuses a list with something else in it', () => {
    expect(isDayCardData({ ...day(), lessons: [null] })).toBe(false);
    expect(isDayCardData({ ...day(), lessons: [{ subject: 'x' }] })).toBe(false);
    expect(isDayCardData({ ...day(), exams: [{ date: DATE }] })).toBe(false);
    expect(isDayCardData({ ...day(), events: [42] })).toBe(false);
  });
});
