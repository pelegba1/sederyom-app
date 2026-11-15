/**
 * The exam board's extractor (plan: exam-board-sources, task 3): a grid of text cells in, dated rows out.
 * The two real boards are the main tests; the hand-made grids below them pin the rules that the boards
 * only touch once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardRow } from '@sederyom/shared';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { BoardError } from '../src/exam-board/errors';
import {
  extractBoard,
  isExamTitle,
  MAX_DETAILS,
  MAX_ROWS,
  MAX_SUFFIX,
  MAX_TITLE,
  parseBoardDates,
  sameClass,
  type BoardExtract,
} from '../src/exam-board/extract';
import { readXlsx } from '../src/exam-board/xlsx';

const TODAY = '2026-11-10';
const fixture = (name: string) => readXlsx(new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'exam-board', name))));

type Rows = Extract<BoardExtract, { kind: 'rows' }>;
function rowsOf(cells: string[][], className: string, column?: string): Rows {
  const got = extractBoard(cells, { className, today: TODAY, ...(column === undefined ? {} : { column }) });
  if (got.kind !== 'rows') throw new Error(`expected rows, got ${JSON.stringify(got)}`);
  return got;
}

/** The code a refusal carries; anything that is not a BoardError shows up as `other: ...`, which fails the test. */
function refusal(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BoardError ? e.code : `other: ${String(e)}`;
  }
  return undefined;
}

const on = (rows: BoardRow[], date: string) => rows.filter((r) => r.date === date);

describe('parseBoardDates', () => {
  it('reads the shapes a school writes', () => {
    expect(parseBoardDates('4.10.26', TODAY)).toEqual(['2026-10-04']);
    expect(parseBoardDates('4/10/26', TODAY)).toEqual(['2026-10-04']);
    expect(parseBoardDates('16/8/2026', TODAY)).toEqual(['2026-08-16']);
    expect(parseBoardDates('2026-08-16', TODAY)).toEqual(['2026-08-16']);
    expect(parseBoardDates('  4.10.26 ', TODAY)).toEqual(['2026-10-04']);
  });

  it('forgives a doubled separator', () => {
    expect(parseBoardDates('22.11..26', TODAY)).toEqual(['2026-11-22']);
    expect(parseBoardDates('22//11/26', TODAY)).toEqual(['2026-11-22']);
  });

  it('gives every day of a range inside one month', () => {
    expect(parseBoardDates('19-20.10.26', TODAY)).toEqual(['2026-10-19', '2026-10-20']);
    expect(parseBoardDates('29-31.12.26', TODAY)).toEqual(['2026-12-29', '2026-12-30', '2026-12-31']);
  });

  it('puts a date without a year in the school year that holds it', () => {
    expect(parseBoardDates('3.1', TODAY)).toEqual(['2027-01-03']);
    expect(parseBoardDates('3.10', TODAY)).toEqual(['2026-10-03']);
    expect(parseBoardDates('15.8', TODAY)).toEqual(['2027-08-15']);
    // The same text means the other year once the school year turns.
    expect(parseBoardDates('3.1', '2027-09-05')).toEqual(['2028-01-03']);
    expect(parseBoardDates('3.1', '2027-03-05')).toEqual(['2027-01-03']);
    expect(parseBoardDates('3.10-5.10', TODAY)).toBeNull();
    expect(parseBoardDates('3-5.10', TODAY)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
  });

  it('does not guess', () => {
    expect(parseBoardDates('6-12.26', TODAY)).toBeNull(); // month 26
    expect(parseBoardDates('א', TODAY)).toBeNull();
    expect(parseBoardDates('', TODAY)).toBeNull();
    expect(parseBoardDates('31.4.26', TODAY)).toBeNull(); // April has 30
    expect(parseBoardDates('29.2.27', TODAY)).toBeNull(); // 2027 is not a leap year
    expect(parseBoardDates('29.2.28', TODAY)).toEqual(['2028-02-29']);
    expect(parseBoardDates('29.2', TODAY)).toBeNull(); // Feb 2027
    expect(parseBoardDates('0.10.26', TODAY)).toBeNull();
    expect(parseBoardDates('4.13.26', TODAY)).toBeNull();
    expect(parseBoardDates('24-23.12.26', TODAY)).toBeNull(); // backwards
    expect(parseBoardDates('30-35.12.26', TODAY)).toBeNull(); // a day December does not have
    expect(parseBoardDates('4.10.2', TODAY)).toBeNull(); // a one-digit year
    expect(parseBoardDates('4.10.226', TODAY)).toBeNull();
    expect(parseBoardDates('4.10.26 א', TODAY)).toBeNull(); // text around it
    expect(parseBoardDates('חנוכה 4.10.26', TODAY)).toBeNull();
    expect(parseBoardDates('4...10.26', TODAY)).toBeNull(); // three in a row is not a typo of two
    expect(parseBoardDates('2026-13-01', TODAY)).toBeNull();
    expect(parseBoardDates('2026-02-30', TODAY)).toBeNull();
  });
});

describe('isExamTitle and sameClass', () => {
  it('knows the words of an exam', () => {
    for (const t of ['מבחן בערבית', 'בוחן בפיסיקה', 'בחינה בעל פה', 'מתכונת בלשון', 'בגרות במתמטיקה', "מועד ב' אנגלית", 'מועד ב רבי מלל', 'מסכם בתנך']) {
      expect(isExamTitle(t), t).toBe(true);
    }
    for (const t of ['הגשת עבודה בהסטוריה', 'סיור ט׳2', 'חופשת חנוכה', 'ה.חלופית בערבית', 'אופציה בגרויות פרויקטים']) {
      expect(isExamTitle(t), t).toBe(false);
    }
  });

  it('compares classes without quotes and spaces', () => {
    expect(sameClass('יב3', 'י"ב 3')).toBe(true);
    expect(sameClass('יב3', 'י״ב3')).toBe(true);
    expect(sameClass("ט1", "ט'1")).toBe(true);
    expect(sameClass("ט1", 'ט׳ 1')).toBe(true);
    expect(sameClass('יב3', 'יב4')).toBe(false);
    expect(sameClass('י3', 'יב3')).toBe(false);
  });
});

describe('the grade 9 list', () => {
  const cells = fixture('grade9-list.xlsx');
  const got = rowsOf(cells, 'ט2');

  it('is read as a list, one row per day of every event', () => {
    expect(got.layout).toBe('list');
    expect(got.rows).toHaveLength(45);
    expect(got.rows.filter((r) => r.isExam)).toHaveLength(17);
  });

  it('skips the one date it cannot read, and says what it was', () => {
    expect(got.skipped).toHaveLength(1);
    expect(got.skipped[0]!.reason).toBe('date');
    expect(got.skipped[0]!.text).toBe('6-12.26 חופשת חנוכה');
  });

  it('keeps an exam of another class of the grade as it is written', () => {
    expect(got.rows).toContainEqual(expect.objectContaining({ date: '2026-11-09', title: 'מבחן בערבית ט1-3', isExam: true }));
    expect(got.rows).toContainEqual(expect.objectContaining({ date: '2026-10-29', title: "מבחן במתמטיקה ט'5", isExam: true }));
  });

  it('cleans a title of a doubled space', () => {
    expect(on(got.rows, '2026-11-10').map((r) => r.title)).toEqual(['מבחן בערבית ט4,5']);
  });

  it('takes the notes column as details', () => {
    const b = on(got.rows, '2027-01-04');
    expect(b).toHaveLength(1);
    expect(b[0]!.title).toBe('מועד ב רבי מלל');
    expect(b[0]!.details!.startsWith('כולל:')).toBe(true);
    expect(b[0]!.isExam).toBe(true);
    expect(on(got.rows, '2026-10-19')[0]).toEqual({ date: '2026-10-19', title: 'ה.חלופית בערבית', details: 'במהלך השיעור', isExam: false });
  });

  it('gives details null when there are none, and marks an assignment as not an exam', () => {
    expect(on(got.rows, '2026-10-04')).toEqual([{ date: '2026-10-04', title: 'הגשת עבודה בהסטוריה', details: null, isExam: false }]);
  });

  it('gives a row to each day of a range', () => {
    expect(on(got.rows, '2026-12-23').map((r) => r.title)).toEqual(['טיול שנתי']);
    expect(on(got.rows, '2026-12-24').map((r) => r.title)).toEqual(['טיול שנתי']);
    expect(on(got.rows, '2026-10-20').map((r) => r.title)).toEqual(['ה.חלופית בערבית']);
  });

  it('keeps two different events of the same day, and reads a date with a doubled dot', () => {
    expect(on(got.rows, '2026-12-02').map((r) => r.title)).toEqual(["סיור ט'6", 'יום הורים']);
    expect(on(got.rows, '2026-11-22').map((r) => r.title)).toEqual(["מבחן במדעים ט'"]);
  });

  it('ignores the class it is given', () => {
    expect(rowsOf(cells, 'י"ב7').rows).toEqual(got.rows);
  });

  it('never gives two rows one key', () => {
    const keys = got.rows.map((r) => uploadedExamKey(r.date, r.title));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the grade 12 grid', () => {
  const cells = fixture('grade12-grid.xlsx');
  const got = rowsOf(cells, 'יב2');

  it('is read as a grid', () => {
    expect(got.layout).toBe('grid');
  });

  it('takes the exams of the class column', () => {
    expect(got.rows).toContainEqual({ date: '2026-10-05', title: 'מבחן בינה מלאכותית', details: null, isExam: true });
    expect(got.rows).toContainEqual({ date: '2026-12-28', title: 'מבחן במתמטיקה', details: null, isExam: true });
  });

  it('takes the second line of a cell as details', () => {
    expect(got.rows).toContainEqual({ date: '2026-10-11', title: 'בוחן במתמטיקה', details: '5 יח הקבצה של מורה א', isExam: true });
    expect(on(got.rows, '2026-10-18').find((r) => r.title === 'בוחן במתמטיקה')!.details).toBe('5 יח׳ הקבצה מורה א');
  });

  it('takes the grade-wide exams as they are written, with the classes in the title', () => {
    expect(got.rows).toContainEqual({
      date: '2026-12-28',
      title: 'מתכונת 2 במתמטיקה (יא1, יא2, י"ב משלימים)',
      details: null,
      isExam: true,
    });
    expect(got.rows).toContainEqual(expect.objectContaining({ date: '2026-12-17', title: 'מתכונת בלשון (יב1, יב8, יב9 + שכבת י"ב משלימים)', isExam: true }));
    expect(got.rows).toContainEqual(expect.objectContaining({ date: '2027-01-04', title: 'בגרות בלשון (יב1, יב8, יב9 + משלימי יב)', isExam: true }));
  });

  it('takes the events columns as other events', () => {
    expect(got.rows).toContainEqual({ date: '2026-09-17', title: 'מעבר בכיתות של הרב ותקיעת שופר', details: null, isExam: false });
  });

  it('splits a cell with separators into events, the first line being the title', () => {
    const day = on(got.rows, '2026-10-13').map((r) => [r.title, r.details]);
    expect(day).toContainEqual(['מרצה- הרצאה באודיטוריום למורים', null]);
    expect(day).toContainEqual(['סדנת מרצה', '1-2 י1\n3-4 יא1']);
    // A cell that starts with a separator has no event before it.
    expect(on(got.rows, '2026-11-11').map((r) => r.title)).toEqual(['בית רותר י2 8-10']);
  });

  it('leaves out what is only in the column of another class', () => {
    expect(got.rows.some((r) => r.title.includes('באופטיקה'))).toBe(false);
    expect(on(got.rows, '2026-11-01').some((r) => r.isExam && r.title.startsWith('מבחן'))).toBe(true); // the maths exam of the class
    expect(on(got.rows, '2026-10-15').some((r) => r.title === 'מבחן בתנך')).toBe(false); // columns 3, 4 and 6 only
    expect(on(got.rows, '2026-10-16').some((r) => r.title === 'מבחן באזרחות')).toBe(true); // this class
  });

  it('keeps a holiday written in two columns once a day, and not as an exam', () => {
    const sukkot = got.rows.filter((r) => r.title === 'חופשת סוכות');
    expect(sukkot.map((r) => r.date)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(sukkot.every((r) => !r.isExam)).toBe(true);
  });

  it('puts a date outside the school year in the skipped, with what was written there', () => {
    const outside = got.skipped.filter((s) => s.reason === 'out_of_year');
    expect(outside.map((s) => s.text.split(' ')[0])).toEqual(['2026-08-27', '2026-08-30']);
    expect(outside[0]!.text).toContain('יום הערכות הנהלה');
    expect(got.skipped).toHaveLength(2);
  });

  it('never gives two rows one key', () => {
    const keys = got.rows.map((r) => uploadedExamKey(r.date, r.title));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('takes both columns of a class that has two, and the name of each in the title', () => {
    const b = rowsOf(cells, 'יב8');
    expect(b.layout).toBe('grid');
    expect(on(b.rows, '2026-10-19').map((r) => r.title)).toEqual(['מבחן בלשון (מחשבים)', 'מבחן בלשון (מופ"ת)']);
    expect(b.rows).toContainEqual(expect.objectContaining({ date: '2026-10-11', title: 'בוחן במתמטיקה (מחשבים)', details: '5 יח הקבצה של מורה א', isExam: true }));
    // A cell merged over all the class columns shows once for each of the two.
    expect(on(b.rows, '2026-10-25').filter((r) => r.title.startsWith('מבחן במתמטיקה')).map((r) => r.title)).toEqual([
      'מבחן במתמטיקה (מחשבים)',
      'מבחן במתמטיקה (מופ"ת)',
    ]);
    // Neither of them is a column of the class יב2.
    expect(got.rows.some((r) => r.title.includes('(מופ"ת)'))).toBe(false);
    const keys = b.rows.map((r) => uploadedExamKey(r.date, r.title));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tells the columns of the grade when the class has none, and reads the one the student picks', () => {
    const asked = extractBoard(cells, { className: 'י3', today: TODAY });
    expect(asked.kind).toBe('columns');
    if (asked.kind !== 'columns') return;
    expect(asked.columns).toHaveLength(10);
    expect(asked.columns).toContain('י"ב1');
    expect(asked.columns).toContain('י"ב8 מחשבים');
    expect(asked.columns).toContain('י"ב8 מופ"ת');
    expect(asked.columns).toContain('י"ב9');
    // Every one of them names itself, so each can be handed back.
    for (const name of asked.columns) expect(rowsOf(cells, 'י3', name).layout).toBe('grid');

    const picked = rowsOf(cells, 'י3', 'י"ב9');
    expect(picked.rows).toContainEqual(expect.objectContaining({ date: '2026-10-18', title: 'מבחן בלשון', isExam: true }));
    expect(on(picked.rows, '2026-10-19').some((r) => r.title.startsWith('מבחן בלשון'))).toBe(false); // only columns 12 and 13
    expect(picked.rows.some((r) => r.title.includes('באופטיקה'))).toBe(false);
    // The grade-wide columns come with whichever class column was picked.
    expect(picked.rows).toContainEqual(expect.objectContaining({ date: '2026-12-28', title: 'מתכונת 2 במתמטיקה (יא1, יא2, י"ב משלימים)' }));
    // A name that is not a column gives the question again, not an empty answer.
    expect(extractBoard(cells, { className: 'י3', today: TODAY, column: 'י"ב11' }).kind).toBe('columns');
  });

  it('takes one column of a class that has two when the student names it', () => {
    const only = rowsOf(cells, 'יב8', 'י"ב8 מופ"ת');
    expect(on(only.rows, '2026-10-19').map((r) => r.title)).toEqual(['מבחן בלשון (מופ"ת)']);
  });
});

describe('a grid of hand-made cells', () => {

  it('takes two identical rows once', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['4.10.26', 'מבחן X'], ['4.10.26', 'מבחן X']], 'ט1');
    expect(got.rows).toEqual([{ date: '2026-10-04', title: 'מבחן X', details: null, isExam: true }]);
  });

  it('takes two rows that differ only by quote marks and spaces once, as the key of a row does', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['4.10.26', "מבחן ט'1"], ['4.10.26', 'מבחן  ט1'], ['4.10.26', 'מבחן ט״1']], 'ט1');
    expect(got.rows).toHaveLength(1);
    expect(got.rows[0]!.title).toBe("מבחן ט'1");
  });

  it('keeps the details of the first of two rows that are one', () => {
    const got = rowsOf([['תאריך', 'תיאור', 'הערות'], ['4.10.26', 'מבחן X', 'שעה 3'], ['4.10.26', 'מבחן X', 'שעה 5']], 'ט1');
    expect(got.rows).toEqual([{ date: '2026-10-04', title: 'מבחן X', details: 'שעה 3', isExam: true }]);
  });

  it('finds the header in the fourth row, and not in the eleventh', () => {
    const body = [['4.10.26', 'מבחן X']];
    expect(rowsOf([['לוח מבחנים'], [''], ['עודכן'], ['תאריך', 'תיאור'], ...body], 'ט1').rows).toHaveLength(1);
    const late = [...Array.from({ length: 10 }, () => ['x']), ['תאריך', 'תיאור'], ...body];
    expect(refusal(() => extractBoard(late, { className: 'ט1', today: TODAY }))).toBe('unknown_layout');
  });

  it('does not take a row above the header for the header', () => {
    const got = rowsOf([['תאריך עדכון: 1.1.26 אירועים'], ['תאריך', 'תיאור'], ['4.10.26', 'מבחן X']], 'ט1');
    expect(got.rows).toHaveLength(1);
  });

  it('refuses what it does not recognise', () => {
    expect(refusal(() => extractBoard([['שלום', 'עולם']], { className: 'ט1', today: TODAY }))).toBe('unknown_layout');
    expect(refusal(() => extractBoard([], { className: 'ט1', today: TODAY }))).toBe('unknown_layout');
    expect(refusal(() => extractBoard([['תאריך', 'יום']], { className: 'ט1', today: TODAY }))).toBe('unknown_layout'); // no description
    expect(refusal(() => extractBoard([['תאריך', 'ט1']], { className: 'ט1', today: TODAY }))).toBe('unknown_layout'); // one class is not a grid
  });

  it('reads the description by its word, whichever column it is in, and never the date column', () => {
    const a = rowsOf([['יום', 'תאריך הארוע', 'הערות', 'ארוע'], ['', '4.10.26', 'שעה 3', 'מבחן X']], 'ט1');
    expect(a.rows).toEqual([{ date: '2026-10-04', title: 'מבחן X', details: 'שעה 3', isExam: true }]);
    const b = rowsOf([['תאריך הארוע', 'נושא'], ['4.10.26', 'מבחן X']], 'ט1');
    expect(b.rows).toHaveLength(1);
    // "תיאור" wins over the other words.
    const c = rowsOf([['תאריך', 'נושא', 'תיאור'], ['4.10.26', 'נושא Y', 'מבחן X']], 'ט1');
    expect(c.rows[0]!.title).toBe('מבחן X');
  });

  it('puts the lines after the first, then the notes, into details', () => {
    const got = rowsOf([['תאריך', 'תיאור', 'הערות'], ['4.10.26', 'מבחן X\nפרק 3\n\nעמוד 5', 'להביא מחשבון']], 'ט1');
    expect(got.rows[0]!.details).toBe('פרק 3\nעמוד 5\nלהביא מחשבון');
  });

  it('splits a cell of the list into events too', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['4.10.26', 'מבחן X\n פרק 3\n_____\nסיור Y\n---\n\n---\n']], 'ט1');
    expect(got.rows).toEqual([
      { date: '2026-10-04', title: 'מבחן X', details: 'פרק 3', isExam: true },
      { date: '2026-10-04', title: 'סיור Y', details: null, isExam: false },
    ]);
    // Two dashes are text.
    expect(rowsOf([['תאריך', 'תיאור'], ['4.10.26', '--\nמבחן']], 'ט1').rows[0]!.title).toBe('--');
  });

  it('skips a row whose date is not read, and counts it, but not an empty row', () => {
    const got = rowsOf(
      [['תאריך', 'תיאור'], ['6-12.26', 'חופשת חנוכה'], ['', ''], ['בקרוב', ''], ['', 'מבחן בלי תאריך'], ['5.10.26', 'מבחן X']],
      'ט1',
    );
    expect(got.rows.map((r) => r.title)).toEqual(['מבחן X']);
    expect(got.skipped).toEqual([
      { text: '6-12.26 חופשת חנוכה', reason: 'date' },
      { text: 'מבחן בלי תאריך', reason: 'date' },
    ]);
  });

  it('skips a date outside the school year, and says so', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['4.10.25', 'מבחן ישן'], ['1.9.26', 'מבחן ראשון'], ['31.8.27', 'מבחן אחרון'], ['1.9.27', 'מבחן הבא'], ['2025-09-01', 'x']], 'ט1');
    expect(got.rows.map((r) => r.date)).toEqual(['2026-09-01', '2027-08-31']);
    expect(got.skipped.map((s) => s.reason)).toEqual(['out_of_year', 'out_of_year', 'out_of_year']);
    expect(got.skipped[0]!.text).toBe('4.10.25 מבחן ישן');
  });

  it('puts the days of a range in one skip when the range is out of the year', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['19-20.10.25', 'חלופית']], 'ט1');
    expect(got.rows).toEqual([]);
    expect(got.skipped).toEqual([{ text: '19-20.10.25 חלופית', reason: 'out_of_year' }]);
  });

  it('reads real date cells', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['2026-10-04', 'מבחן X']], 'ט1');
    expect(got.rows[0]!.date).toBe('2026-10-04');
  });

  it('tolerates a ragged grid and cells with spaces around them', () => {
    const got = rowsOf([['  תאריך ', ' תיאור '], [' 4.10.26 '], ['5.10.26', '  מבחן X  ']], 'ט1');
    expect(got.rows).toEqual([{ date: '2026-10-05', title: 'מבחן X', details: null, isExam: true }]);
    expect(got.skipped).toEqual([]);
  });

  describe('as a grid', () => {
    const head = ['תאריך', 'יום', 'אירועים', "ט'1", 'ט 2', 'ט"2 מופת', 'ט10', '', 'הערות'];
    const grid = (...body: string[][]) => [head, ...body];

    it('takes the columns of the class and of the grade, and only those', () => {
      const got = rowsOf(
        grid(
          ['4.10.26', 'א', 'סיור שכבתי', 'מבחן א', 'מבחן ב', 'מבחן ג', 'מבחן ד', 'ריק', 'הערה'],
        ),
        'ט2',
      );
      expect(got.layout).toBe('grid');
      expect(got.rows.map((r) => [r.title, r.isExam])).toEqual([
        ['סיור שכבתי', false],
        ['מבחן ב', true],
        ['מבחן ג (מופת)', true],
        ['הערה', false],
      ]);
    });

    it('does not take a class whose number only starts with the same digits', () => {
      const t1 = rowsOf(grid(['4.10.26', '', '', 'מבחן א', '', '', 'מבחן ד', '', '']), 'ט1');
      expect(t1.rows.map((r) => r.title)).toEqual(['מבחן א']);
      const t10 = rowsOf(grid(['4.10.26', '', '', 'מבחן א', '', '', 'מבחן ד', '', '']), 'ט10');
      expect(t10.rows.map((r) => r.title)).toEqual(['מבחן ד']);
    });

    it('does not take the day column or a column with no name', () => {
      const got = rowsOf(grid(['4.10.26', 'יום ראשון', '', 'מבחן א', '', '', '', 'בלי שם', '']), 'ט1');
      expect(got.rows.map((r) => r.title)).toEqual(['מבחן א']);
    });

    it('asks for a column when the class has none', () => {
      expect(extractBoard(grid(['4.10.26', '', '', 'מבחן א']), { className: 'ט3', today: TODAY })).toEqual({
        kind: 'columns',
        columns: ["ט'1", 'ט 2', 'ט"2 מופת', 'ט10'],
      });
    });

    it('takes a merged cell for every class it covers, once', () => {
      const got = rowsOf(grid(['4.10.26', '', '', 'מבחן א', 'מבחן א', 'מבחן א', 'מבחן א', '', '']), 'ט2');
      expect(got.rows.map((r) => r.title)).toEqual(['מבחן א', 'מבחן א (מופת)']);
    });

    it('keeps the suffix out of the title when it is already in parentheses', () => {
      const cells = [['תאריך', 'י"ב1 (מופת)', 'י"ב2'], ['4.10.26', 'מבחן א', 'מבחן ב']];
      expect(rowsOf(cells, 'יב1').rows.map((r) => r.title)).toEqual(['מבחן א (מופת)']);
    });

    it('skips a date that is not read, with what the row said', () => {
      const got = rowsOf(grid(['בקרוב', '', 'סיור', 'מבחן א', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '']), 'ט1');
      expect(got.rows).toEqual([]);
      expect(got.skipped).toEqual([{ text: 'בקרוב סיור | מבחן א', reason: 'date' }]);
    });

    it('lets a date be written as a range in a grid too', () => {
      const got = rowsOf(grid(['19-20.10.26', '', '', 'מבחן א', '', '', '', '', '']), 'ט1');
      expect(got.rows.map((r) => r.date)).toEqual(['2026-10-19', '2026-10-20']);
    });

    it('needs a date cell and two class headers in the same row', () => {
      expect(refusal(() => extractBoard([['תאריך', "ט'1"], ['', "ט'2"]], { className: 'ט1', today: TODAY }))).toBe('unknown_layout');
      const ok = rowsOf([['', "ט'1", "ט'2"], ['תאריך', 'x'], ['תאריך', "ט'1", "ט'2"], ['4.10.26', 'מבחן א', 'מבחן ב']], 'ט2');
      expect(ok.rows.map((r) => r.title)).toEqual(['מבחן ב']);
    });
  });

  describe('on a board of the limit size', () => {
    it('reads 20,000 cells without trouble', () => {
      const header = ['תאריך', 'יום', 'אירועים', ...Array.from({ length: 7 }, (_, i) => `י"ב${i + 1}`)];
      const rows: string[][] = [header];
      // 2000 lines of 10 cells on 224 days of the school year, a few different events a day: under the limit of rows.
      for (let i = 0; i < 2000; i += 1) {
        const n = i % 224;
        const day = 1 + (n % 28);
        const month = 1 + Math.floor(n / 28);
        rows.push([`${day}.${month}.27`, 'x', `אירוע ${i % 3}`, ...Array.from({ length: 7 }, (_, c) => `מבחן ${i % 5} ${c}`)]);
      }
      const t0 = performance.now();
      const got = rowsOf(rows, 'יב3');
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(got.rows.length).toBeGreaterThan(500);
      expect(got.rows.length).toBeLessThanOrEqual(MAX_ROWS);
    });

    it('reads a cell of a hundred thousand separators with one event in it as one row', () => {
      const cell = Array.from({ length: 100_000 }, (_, i) => (i % 2 ? '----' : 'אירוע')).join('\n');
      const t0 = performance.now();
      const got = rowsOf([['תאריך', 'תיאור'], ['4.10.26', cell]], 'ט1');
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(got.rows).toHaveLength(1);
    });

    it('reads the same row repeated ten thousand times as one row', () => {
      const rows = [['תאריך', 'תיאור'], ...Array.from({ length: 10_000 }, () => ['4.10.26', 'מבחן X'])];
      const t0 = performance.now();
      expect(rowsOf(rows, 'ט1').rows).toHaveLength(1);
      expect(performance.now() - t0).toBeLessThan(3000);
    });
  });

  describe('against input made to be expensive', () => {
    const LIST = ['תאריך', 'תיאור', 'הערות'];
    const events = (n: number) => Array.from({ length: n }, (_, i) => `אירוע ${i}`).join('\n---\n');
    const noteLines = (n: number) => Array.from({ length: n }, (_, i) => `הערה ${i}`).join('\n');

    it('puts the notes of a row into the details once, cut to the limit, not once per line per event', () => {
      const t0 = performance.now();
      const got = rowsOf([LIST, ['4.10.26', events(1900), noteLines(4000)]], 'ט1');
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(got.rows).toHaveLength(1900);
      for (const r of got.rows) {
        expect(r.details!.length).toBe(MAX_DETAILS);
        expect(r.details!.startsWith('הערה 0\nהערה 1\n')).toBe(true);
      }
    });

    it('refuses 4,000 events with 4,000 lines of notes, in a moment', () => {
      const t0 = performance.now();
      expect(refusal(() => extractBoard([LIST, ['4.10.26', events(4000), noteLines(4000)]], { className: 'ט1', today: TODAY }))).toBe('too_big');
      expect(performance.now() - t0).toBeLessThan(3000);
    });

    it('keeps the suffix of a class header to its limit in every title, and the title to its own', () => {
      const long = 'x'.repeat(20_000);
      const grid = [['תאריך', `י"ב1 ${long}`, 'י"ב2']];
      for (let i = 0; i < 1500; i += 1) grid.push([`${1 + (i % 28)}.${1 + Math.floor(i / 28) % 8}.27`, `מבחן ${i}`, '']);
      const t0 = performance.now();
      const got = rowsOf(grid, 'יב1');
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(got.rows.length).toBeGreaterThan(1000);
      for (const r of got.rows) {
        expect(r.title.length).toBeLessThanOrEqual(MAX_TITLE);
        expect(r.title.endsWith(` (${'x'.repeat(MAX_SUFFIX)})`)).toBe(true);
      }
    });

    it('refuses 4,000 rows under a header with a suffix of 20,000 characters, in a moment', () => {
      const grid = [['תאריך', `י"ב1 ${'x'.repeat(20_000)}`, 'י"ב2']];
      for (let i = 0; i < 4000; i += 1) grid.push([`${1 + (i % 28)}.${1 + Math.floor(i / 28) % 8}.27`, `מבחן ${i}`, '']);
      const t0 = performance.now();
      expect(refusal(() => extractBoard(grid, { className: 'יב1', today: TODAY }))).toBe('too_big');
      expect(performance.now() - t0).toBeLessThan(3000);
    });

    it('cuts a suffix in parentheses to its limit and keeps the parentheses', () => {
      const grid = [['תאריך', `י"ב1 (${'x'.repeat(100)})`, 'י"ב2'], ['4.10.26', 'מבחן א', '']];
      expect(rowsOf(grid, 'יב1').rows[0]!.title).toBe(`מבחן א (${'x'.repeat(MAX_SUFFIX)})`);
    });

    it('cuts a title to 200 characters and details to 500', () => {
      const got = rowsOf([LIST, ['4.10.26', `${'א'.repeat(5000)}\n${'ב'.repeat(2000)}\n${'ג'.repeat(2000)}`, '']], 'ט1');
      expect(got.rows).toHaveLength(1);
      expect(got.rows[0]!.title).toBe('א'.repeat(MAX_TITLE));
      expect(got.rows[0]!.details).toBe('ב'.repeat(MAX_DETAILS));
    });

    it('cuts the details at the limit when the lines are short too, and adds nothing past it', () => {
      const got = rowsOf([LIST, ['4.10.26', `מבחן\n${noteLines(5000)}`, 'עוד']], 'ט1');
      expect(got.rows[0]!.details).toHaveLength(MAX_DETAILS);
      expect(got.rows[0]!.details!.endsWith('עוד')).toBe(false);
    });

    it('does not cut a character in two', () => {
      const emoji = '\u{1F4DD}';
      const got = rowsOf([LIST, ['4.10.26', `${'א'.repeat(MAX_TITLE - 1)}${emoji}\n${'ב'.repeat(MAX_DETAILS - 1)}${emoji}`, '']], 'ט1');
      expect(got.rows[0]!.title).toBe('א'.repeat(MAX_TITLE - 1));
      expect(got.rows[0]!.details).toBe('ב'.repeat(MAX_DETAILS - 1));
    });

    it('takes two titles that differ only after the cut as one row, so that no two rows have one key', () => {
      const a = 'מבחן '.repeat(40);
      const got = rowsOf([LIST, ['4.10.26', `${a}1`, 'א'], ['4.10.26', `${a}2`, 'ב']], 'ט1');
      expect(got.rows).toHaveLength(1);
      expect(got.rows[0]!.title).toBe(a);
      expect(got.rows[0]!.details).toBe('א');
      const keys = got.rows.map((r) => uploadedExamKey(r.date, r.title));
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('keeps the suffix visible when a title of a class column is long', () => {
      const grid = [['תאריך', 'י"ב1 מופת', 'י"ב2'], ['4.10.26', 'מבחן '.repeat(100), '']];
      const [row] = rowsOf(grid, 'יב1').rows;
      expect(row!.title.length).toBeLessThanOrEqual(MAX_TITLE);
      expect(row!.title.endsWith(' (מופת)')).toBe(true);
    });

    it('allows exactly 2,000 rows and refuses the 2,001st, skipped lines counted with the rows', () => {
      const list = (n: number, bad = 0) => [
        ['תאריך', 'תיאור'],
        ...Array.from({ length: n }, (_, i) => [`${1 + (i % 28)}.${1 + Math.floor(i / 28) % 8}.27`, `מבחן ${i}`]),
        ...Array.from({ length: bad }, (_, i) => ['?', `בלי תאריך ${i}`]),
      ];
      const ok = rowsOf(list(MAX_ROWS), 'ט1');
      expect(ok.rows).toHaveLength(MAX_ROWS);
      expect(refusal(() => extractBoard(list(MAX_ROWS + 1), { className: 'ט1', today: TODAY }))).toBe('too_big');
      const mixed = rowsOf(list(MAX_ROWS - 1000, 1000), 'ט1');
      expect(mixed.rows.length + mixed.skipped.length).toBe(MAX_ROWS);
      expect(refusal(() => extractBoard(list(MAX_ROWS - 1000, 1001), { className: 'ט1', today: TODAY }))).toBe('too_big');
    });

    it('counts every day of a range as a row against the limit', () => {
      const cell = events(100);
      expect(refusal(() => extractBoard([LIST, ['1-31.10.26', cell, '']], { className: 'ט1', today: TODAY }))).toBe('too_big'); // 3,100
      expect(rowsOf([LIST, ['1-31.10.26', events(60), '']], 'ט1').rows).toHaveLength(1860);
    });

    it('cuts what a skipped line says to 300 characters (S-M6)', () => {
      const got = rowsOf([LIST, ['בקרוב', `מבחן ${'א'.repeat(5000)}\n${'ב'.repeat(5000)}`, 'ג'.repeat(5000)]], 'ט1');
      expect(got.skipped).toHaveLength(1);
      expect(got.skipped[0]!.text.length).toBeLessThanOrEqual(300);
      expect(got.skipped[0]!.text.startsWith('בקרוב מבחן אאא')).toBe(true);
      // and never between the two halves of a character
      const emoji = '\u{1F4DD}';
      const edge = rowsOf([LIST, ['בקרוב', `${'א'.repeat(299 - 'בקרוב '.length)}${emoji}`, '']], 'ט1').skipped[0]!.text;
      expect(edge).toBe(`בקרוב ${'א'.repeat(299 - 'בקרוב '.length)}`);
    });

    it('works through a cell of one event repeated as often for a range of a month as for one day (ledger L71)', () => {
      const same = Array.from({ length: 60_000 }, () => 'אירוע').join('\n---\n');
      const time = (date: string) => {
        let best = Infinity;
        for (let i = 0; i < 2; i += 1) {
          const t0 = performance.now();
          const got = rowsOf([LIST, [date, same, '']], 'ט1');
          best = Math.min(best, performance.now() - t0);
          expect(got.rows).toHaveLength(date === '4.10.26' ? 1 : 31);
        }
        return best;
      };
      const day = time('4.10.26');
      const month = time('1-31.10.26');
      // The keys of the row are made and told apart once; each day of the range then costs one key. (Before, a month cost
      // about five days' worth; the bound leaves room for a pause on a busy machine.)
      expect(month).toBeLessThan(day * 3 + 100);
    }, 30_000);
  });
});

describe('the text of a row (S-M1)', () => {
  it('keeps no control, bidi mark or zero-width character in a title, its details or a skipped line', () => {
    const got = rowsOf([
      ['תאריך', 'תיאור', 'הערות'],
      ['4.10.26', '‏מבחן\u0000 ב‮מתמטיקה​\nפרק\u0007 א⁦', 'שעה\u00853'],
      ['בקרוב', '‮מבחן​ בלי תאריך', ''],
    ], 'ט1');
    expect(got.rows).toEqual([{ date: '2026-10-04', title: 'מבחן במתמטיקה', details: 'פרק א\nשעה 3', isExam: true }]);
    expect(got.skipped).toEqual([{ text: 'בקרוב מבחן בלי תאריך', reason: 'date' }]);
  });

  it('takes a title with marks and the same title without them as one row, as their key is one', () => {
    const got = rowsOf([['תאריך', 'תיאור'], ['4.10.26', 'מבחן‏ X'], ['4.10.26', 'מבחן X']], 'ט1');
    expect(got.rows).toHaveLength(1);
    expect(uploadedExamKey('2026-10-04', got.rows[0]!.title)).toBe(uploadedExamKey('2026-10-04', 'מבחן X'));
  });
});
