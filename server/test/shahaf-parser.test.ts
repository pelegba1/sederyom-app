import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseChanges, parseClassOptions, parseDatedList, parseFreshness, parseLooseDate,
  parseMessages, parseTimetable,
} from '../src/adapters/shahaf/parser.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'shahaf');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

describe('class picker', () => {
  it('reads classes by option value, not position', () => {
    const classes = parseClassOptions(fixture('root-classlist.html'));
    expect(classes.length).toBeGreaterThan(20);

    const yod_bet_2 = classes.find((c) => c.name === 'יב2');
    expect(yod_bet_2).toBeDefined();
    // Spike 2: the design doc guessed ~21 by position; the real value is 36.
    expect(yod_bet_2!.id).toBe('36');
    expect(classes.indexOf(yod_bet_2!)).not.toBe(Number(yod_bet_2!.id));
  });
});

describe('freshness footer', () => {
  it('parses "מעודכן ל: DD.MM.YYYY, שעה: HH:mm"', () => {
    const at = parseFreshness(fixture('changestable-cls36.html'));
    expect(at).toBeInstanceOf(Date);
    expect(at!.toISOString()).toBe(new Date('2026-08-11T19:52:00.000Z').toISOString());
  });

  it('returns null when the footer is missing', () => {
    expect(parseFreshness('<html><body>nothing</body></html>')).toBeNull();
  });
});

describe('timetable (empty summer fixture)', () => {
  it('resolves the week header dates and finds no lessons', () => {
    const warnings: string[] = [];
    const parsed = parseTimetable(fixture('changestable-cls36.html'), '2026-08-30', {
      onWarn: (m) => warnings.push(m),
    });
    expect(parsed.days).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    ]);
    expect(parsed.lessons).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('crosses the month boundary using the site header, not the anchor', () => {
    // Anchor deliberately wrong by a week: header must win and be reported.
    const warnings: string[] = [];
    const parsed = parseTimetable(fixture('changestable-cls36.html'), '2026-09-06', {
      onWarn: (m) => warnings.push(m),
    });
    expect(parsed.days[0]).toBe('2026-08-30');
    expect(warnings.length).toBe(6);
  });

  it('warns instead of silently returning nothing when the table is gone', () => {
    const warnings: string[] = [];
    const parsed = parseTimetable('<html><body><p>hi</p></body></html>', '2026-08-30', {
      onWarn: (m) => warnings.push(m),
    });
    expect(parsed.lessons).toEqual([]);
    expect(warnings).toContain('no table.TTTable on page');
  });
});

/**
 * Synthetic filled-cell fixtures. The live site was empty all summer, so these
 * encode the shape implied by the site stylesheet (TTLesson / TTChange plus the
 * Table*Change colour classes). TODO(verify-live): re-check in September.
 */
const FILLED_WEEK = `
<table class="TTTable" dir="rtl">
  <tr>
    <td class="CName"></td>
    <td class="CTitle" data-day="0">יום ראשון 30.08</td>
    <td class="CTitle" data-day="1">יום שני 31.08</td>
    <td class="CTitle" data-day="2">יום שלישי 01.09</td>
  </tr>
  <tr>
    <td class="CName"><b>2<br/><span class="hour-time">08:45</span><br/><span class="hour-time">09:30</span></b></td>
    <td class="TTCell" data-day="0"><div class="TTLesson">אנגלית<br/>שרון<br/>חדר 108</div></td>
    <td class="TTCell" data-day="1"><div class="TTLesson">פיזיקה<br/>לוי<br/>מעבדה 2</div><div class="TTChange TableFillChange">מ״מ: כהן</div></td>
    <td class="TTCell" data-day="2"><div class="TTLesson">היסטוריה<br/>שגיא<br/>חדר 211</div><div class="TTChange TableFreeChange">השיעור מבוטל</div></td>
  </tr>
  <tr>
    <td class="CName"><b>6<br/><span class="hour-time">12:15</span><br/><span class="hour-time">13:00</span></b></td>
    <td class="TTCell" data-day="0"><div class="TTChange TableExamChange">מבחן במתמטיקה</div></td>
    <td class="TTCell" data-day="1"></td>
    <td class="TTCell" data-day="2"><div class="TTLesson">ספורט<br/>דנה</div><div class="TTChange TableRemoteChange">למידה מרחוק</div></td>
  </tr>
</table>
<div class="UpdateDate">מעודכן ל: 30.08.2026, שעה: 07:15</div>
`;

describe('timetable (synthetic filled fixture)', () => {
  const parsed = parseTimetable(FILLED_WEEK, '2026-08-30');

  it('reads period number and both hour times from the row label', () => {
    const english = parsed.lessons.find((l) => l.subject === 'אנגלית')!;
    expect(english).toMatchObject({
      date: '2026-08-30', hourIndex: 2, startTime: '08:45', endTime: '09:30',
      teacher: 'שרון', room: 'חדר 108', status: 'regular',
    });
  });

  it('folds a substitution change onto the lesson it replaces', () => {
    const physics = parsed.lessons.find((l) => l.subject === 'פיזיקה')!;
    expect(physics.status).toBe('substitution');
    expect(physics.substitute).toBe('כהן');
    expect(physics.teacher).toBe('לוי');
  });

  it('marks a cancelled lesson cancelled while keeping its identity', () => {
    const history = parsed.lessons.find((l) => l.subject === 'היסטוריה')!;
    expect(history.status).toBe('cancelled');
    expect(history.note).toBe('השיעור מבוטל');
  });

  it('keeps a change with no base lesson as its own entry', () => {
    const exam = parsed.lessons.find((l) => l.subject === 'מבחן במתמטיקה')!;
    expect(exam.status).toBe('exam');
    expect(exam.hourIndex).toBe(6);
  });

  it('maps remote learning', () => {
    expect(parsed.lessons.find((l) => l.subject === 'ספורט')!.status).toBe('remote');
  });

  it('never invents a lesson in an empty cell', () => {
    expect(parsed.lessons.filter((l) => l.date === '2026-08-31' && l.hourIndex === 6)).toEqual([]);
  });
});

describe('list tabs (empty summer fixtures)', () => {
  it('returns nothing for the EmptyList state rather than a bogus row', () => {
    expect(parseChanges(fixture('changes-cls36.html'))).toEqual([]);
    expect(parseDatedList(fixture('exams-cls36.html'), 'shahaf-exam')).toEqual([]);
    expect(parseDatedList(fixture('events-cls36.html'), 'shahaf-event')).toEqual([]);
    expect(parseMessages(fixture('messages-cls36.html'))).toEqual([]);
  });
});

describe('list tabs (synthetic filled fixtures)', () => {
  it('parses a table-shaped exams list', () => {
    const html = `<div class="tt-module"><table>
      <tr><th>תאריך</th><th>מקצוע</th><th>פרטים</th></tr>
      <tr><td>03.09.2026</td><td>מתמטיקה</td><td>פרק 3</td></tr>
      <tr><td>10.09.2026</td><td>אנגלית</td><td></td></tr>
    </table></div>`;
    expect(parseDatedList(html, 'shahaf-exam')).toEqual([
      { naturalKey: 'shahaf-exam|2026-09-03|מתמטיקה', date: '2026-09-03', title: 'מתמטיקה', details: 'פרק 3' },
      { naturalKey: 'shahaf-exam|2026-09-10|אנגלית', date: '2026-09-10', title: 'אנגלית', details: null },
    ]);
  });

  /**
   * Verb first, colour second. This test used to assert the opposite, which
   * only held while the fixtures were ones I had written myself — the live site
   * paints a *moved* lesson with the same class it uses for a substitute.
   */
  it('classifies changes by the verb written, falling back to the colour', () => {
    const html = `<div class="tt-module">
      <div class="ChangesDate">01.09.2026</div>
      <div class="ChangesInfo TableFreeChange">שיעור 3 מבוטל</div>
      <div class="ChangesInfo">שיעור 5 הועבר משיעור 7</div>
      <div class="ChangesDate">02.09.2026</div>
      <div class="ChangesInfo TableFillChange">שיעור 1 ממלא מקום כהן</div>
    </div>`;
    const changes = parseChanges(html);
    expect(changes.map((c) => [c.date, c.hourIndex, c.kind])).toEqual([
      ['2026-09-01', 3, 'cancelled'],
      ['2026-09-01', 5, 'moved'],
      ['2026-09-02', 1, 'substitution'],
    ]);
  });

  it('parses general messages', () => {
    const html = `<div class="tt-module">
      <div class="ChangesDate">01.09.2026</div>
      <div class="MsgCell">פתיחת שנה. ההתכנסות בשעה 8:00 בחצר.</div>
    </div>`;
    expect(parseMessages(html)).toEqual([
      {
        naturalKey: 'shahaf-msg|2026-09-01|פתיחת שנה. ההתכנסות בשעה 8:00 בחצר.',
        date: '2026-09-01',
        title: 'פתיחת שנה',
        details: 'פתיחת שנה. ההתכנסות בשעה 8:00 בחצר.',
      },
    ]);
  });
});

describe('loose date parsing', () => {
  it('fills the year when the site omits it', () => {
    expect(parseLooseDate('יום שלישי 01.09', { year: 2026 })).toBe('2026-09-01');
  });
  it('accepts two-digit years and slashes', () => {
    expect(parseLooseDate('3/9/26')).toBe('2026-09-03');
  });
  it('rejects nonsense rather than guessing', () => {
    expect(parseLooseDate('אין שינויים')).toBeNull();
    expect(parseLooseDate('45.99.2026')).toBeNull();
  });
});
