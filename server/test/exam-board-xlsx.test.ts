/**
 * The exam board's xlsx reader (plan: exam-board-sources, task 2). It takes bytes from an anonymous
 * device, so half of this file is about what it refuses and how early it stops.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { BoardError } from '../src/exam-board/errors';
import { MAX_CELLS, MAX_FILE_BYTES, MAX_INFLATED_BYTES, MAX_TEXT_CHARS, readXlsx, unzipLimited } from '../src/exam-board/xlsx';

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'exam-board', name)));
const MB = 1024 * 1024;

/** The code a refusal carries; anything that is not a BoardError shows up as `other: ...`, which fails the test. */
function refusal(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BoardError ? e.code : `other: ${String(e)}`;
  }
  return undefined;
}

// ---- small hand-made workbooks ---------------------------------------------------------------

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

function pack(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])), { level: 9 });
}

const sheetOf = (rows: string, tail = '') => `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData>${tail}</worksheet>`;
const row = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
const text = (ref: string, s: string) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`;
const num = (ref: string, v: string | number, style?: number) => `<c r="${ref}"${style === undefined ? '' : ` s="${style}"`}><v>${v}</v></c>`;
const colName = (n: number): string => {
  let s = '';
  for (let c = n; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};

/** One workbook: the sheets in the order of `workbook.xml`, plus any extra parts (styles, shared strings, comments...). */
function book(sheets: { xml: string; state?: string }[], extra: Record<string, string | Uint8Array> = {}, workbookPr = ''): Uint8Array {
  const files: Record<string, string | Uint8Array> = {
    'xl/workbook.xml':
      `<workbook xmlns="${MAIN}" xmlns:r="${REL}">${workbookPr}<sheets>` +
      sheets.map((s, i) => `<sheet name="S${i + 1}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      `<Relationships xmlns="${PKG}">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      '</Relationships>',
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = s.xml));
  return pack({ ...files, ...extra });
}

const read1 = (rows: string, extra: Record<string, string | Uint8Array> = {}, tail = '', pr = '') =>
  readXlsx(book([{ xml: sheetOf(rows, tail) }], extra, pr));

// ---- the two real samples --------------------------------------------------------------------

describe('readXlsx on the grade 9 list (text dates, shared strings, no merges)', () => {
  const cells = readXlsx(fixture('grade9-list.xlsx'));

  it('reads the board title and the header row', () => {
    expect(cells[0]![0]).toBe("לוח ארועים שכבת ט' תשפז מחצית א");
    expect(cells[1]!.slice(0, 4)).toEqual(['תאריך הארוע', 'יום בשבוע', 'תיאור הארוע', 'הערות']);
  });

  it('keeps a typo of a date as the text it is, and the description in the third column', () => {
    const r = cells.find((x) => x[0] === '22.11..26');
    expect(r?.[2]).toBe("מבחן במדעים ט'");
  });

  it('decodes XML entities, and a name in a cell is already replaced', () => {
    expect(cells.find((x) => x[0] === '12.11.26')?.[2]).toBe('הצגה "בלי עין הרע"');
    expect(cells.find((x) => x[0] === '31.12.26')?.[2]).toBe('הרצאה מעוררת השראה מרצה');
  });

  it('is a rectangle of trimmed text, with no empty row at the end', () => {
    const width = cells[0]!.length;
    expect(width).toBeGreaterThanOrEqual(4);
    for (const r of cells) {
      expect(r).toHaveLength(width);
      for (const c of r) expect(c).toBe(c.trim());
    }
    expect(cells[cells.length - 1]!.some((c) => c !== '')).toBe(true);
    expect(cells.find((x) => x[0] === '28.1.27')?.[2]).toBe("חלוקת תעודות מחצית א'");
  });

  it('keeps the empty cells between months as empty text', () => {
    expect(cells.some((r) => r.every((c) => c === ''))).toBe(true);
  });
});

describe('readXlsx on the grade 12 grid (date cells, formula results, merges, two sheets)', () => {
  const cells = readXlsx(fixture('grade12-grid.xlsx'));
  const header = cells[0]!;
  const col = (name: string) => header.indexOf(name);
  const rowOf = (date: string) => {
    const r = cells.find((x) => x[0] === date);
    if (!r) throw new Error(`no row for ${date}`);
    return r;
  };

  it('reads the header, formula results included', () => {
    expect(header.slice(0, 7)).toEqual([
      'תאריך',
      'יום',
      'אירועים חט"ע',
      'בחינות שכבתיות/ מתכונות/ בגרויות',
      'אירועים שכבתיים / הערות',
      'י"ב1',
      'י"ב2',
    ]);
    expect(header.slice(5)).toEqual(['י"ב1', 'י"ב2', 'י"ב3', 'י"ב4', 'י"ב5', 'י"ב6', 'י"ב7', 'י"ב8 מחשבים', 'י"ב8 מופ"ת', 'י"ב9']);
  });

  it('turns a date cell into yyyy-mm-dd, and takes the weekday formula from its stored value', () => {
    expect(cells[1]![0]).toBe('2026-08-16');
    expect(cells[1]![1]).toBe('Sunday');
    expect(cells[2]![0]).toBe('2026-08-17');
  });

  it('reads one row a day: the header and then 349 days, all different', () => {
    const dates = cells.slice(1).map((r) => r[0]!);
    expect(cells).toHaveLength(350);
    expect(new Set(dates).size).toBe(349);
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it('reads a shared string in a class column', () => {
    expect(rowOf('2026-10-05')[col('י"ב2')]).toBe('מבחן בינה מלאכותית');
  });

  it('fills a merged range across the class columns (F72:O72)', () => {
    const r = rowOf('2026-10-25');
    expect(r[col('י"ב9')]).toBe('מבחן במתמטיקה');
    for (let c = col('י"ב1'); c <= col('י"ב9'); c++) expect(r[c]).toBe('מבחן במתמטיקה');
    expect(r[col('אירועים שכבתיים / הערות')]).not.toBe('מבחן במתמטיקה');
  });

  it('fills a merged range down several rows (F81:O83)', () => {
    for (const d of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      const r = rowOf(d);
      for (let c = col('י"ב1'); c <= col('י"ב9'); c++) expect(r[c]).toBe('טיול שנתי - אילת');
    }
    expect(rowOf('2026-11-02')[col('י"ב1')]).not.toBe('טיול שנתי - אילת');
    expect(rowOf('2026-11-06')[col('י"ב1')]).not.toBe('טיול שנתי - אילת');
  });

  it('fills only the merged part of a row (G79:L79) and keeps the line break of a cell', () => {
    const r = rowOf('2026-11-01');
    expect(r[col('י"ב1')]).toBe('מבחן באופטיקה 252\nשעורים 1-2');
    for (let c = col('י"ב2'); c <= col('י"ב7'); c++) expect(r[c]).toBe('מבחן מתמטיקה רק להקבצה של מורה ב');
    expect(r[col('י"ב8 מחשבים')]).not.toBe('מבחן מתמטיקה רק להקבצה של מורה ב');
  });

  it('keeps the teacher placeholders, and reads the first sheet only, without comments', () => {
    expect(cells.flat().some((c) => c.includes('הקבצה של מורה א'))).toBe(true);
    expect(cells.flat().some((c) => c.includes('שינוי מערכת'))).toBe(false);
  });

  it('has far less text than the limit on the text of a grid allows', () => {
    expect(cells.flat().join('').length).toBeLessThan(MAX_TEXT_CHARS / 10);
  });

  it('is a rectangle of trimmed text', () => {
    const width = header.length;
    for (const r of cells) {
      expect(r).toHaveLength(width);
      for (const c of r) expect(c).toBe(c.trim());
    }
  });
});

// ---- what a cell can hold --------------------------------------------------------------------

describe('readXlsx cell types', () => {
  it('reads inline strings, formula strings, shared strings (rich text, phonetic runs) and numbers', () => {
    const sst =
      `<sst xmlns="${MAIN}">` +
      '<si><t>plain</t></si>' +
      '<si><r><t xml:space="preserve">rich </t></r><r><rPr><b/></rPr><t>text</t></r></si>' +
      '<si><t>base</t><rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si>' +
      '<si><t xml:space="preserve">  padded  </t></si>' +
      '</sst>';
    const rows =
      row(1, text('A1', 'inline') + `<c r="B1" t="str"><f>A1&amp;"!"</f><v>cached</v></c>` + `<c r="C1" t="s"><v>0</v></c>` + `<c r="D1" t="s"><v>1</v></c>`) +
      row(2, `<c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>99</v></c>` + num('D2', '5.0') + num('E2', '0.25'));
    const cells = read1(rows, { 'xl/sharedStrings.xml': sst });
    expect(cells).toEqual([
      ['inline', 'cached', 'plain', 'rich text', ''],
      ['base', 'padded', '', '5', '0.25'],
    ]);
  });

  it('does not evaluate a formula that has no stored value', () => {
    expect(read1(row(1, '<c r="A1"><f>1+1</f></c>' + `<c r="B1"><f>1+1</f><v>7</v></c>`))).toEqual([['', '7']]);
  });

  it('turns booleans into TRUE and FALSE and leaves an error cell empty', () => {
    const cells = read1(row(1, `<c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#N/A</v></c>` + text('D1', 'x')));
    expect(cells).toEqual([['TRUE', 'FALSE', '', 'x']]);
  });

  it('keeps a line break as \\n, whatever wrote it, and trims the ends only', () => {
    const cells = read1(row(1, text('A1', '  one\r\ntwo\rthree&#10;four_x000D_five  ') + text('B1', 'a&#13;&#10;b')));
    expect(cells).toEqual([['one\ntwo\nthree\nfour\nfive', 'a\nb']]);
  });

  it('reads an ISO date cell (t="d")', () => {
    expect(read1(row(1, '<c r="A1" t="d"><v>2026-08-16T00:00:00</v></c>'))).toEqual([['2026-08-16']]);
  });

  it('reads a sheet written with a namespace prefix on every element', () => {
    const xml = `<x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>pre</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
    expect(readXlsx(book([{ xml }]))).toEqual([['pre']]);
  });
});

describe('readXlsx date cells', () => {
  const STYLES =
    `<styleSheet xmlns="${MAIN}"><numFmts count="4">` +
    '<numFmt numFmtId="164" formatCode="d/m/yy"/>' +
    '<numFmt numFmtId="165" formatCode="h:mm"/>' +
    '<numFmt numFmtId="166" formatCode="0.0&quot;m&quot;"/>' +
    '<numFmt numFmtId="167" formatCode="[$-409]mmmm\\ yyyy"/>' +
    '</numFmts><cellXfs count="8">' +
    '<xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="22"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="46"/><xf numFmtId="167"/>' +
    '</cellXfs></styleSheet>';

  it('knows a date by the built-in format id, or by a custom code that has a day, a month or a year', () => {
    const cells = read1(
      row(1, num('A1', '46250.0', 1) + num('B1', 46250.75, 2) + num('C1', 46250, 3) + num('D1', 46250.5, 6) + num('E1', 46250, 7)),
      { 'xl/styles.xml': STYLES },
    );
    expect(cells).toEqual([Array(5).fill('2026-08-16')]);
  });

  it('leaves a number alone when its format has no date in it, even with an m between quotes', () => {
    const cells = read1(row(1, num('A1', 46250, 0) + num('B1', 46250, 5)), { 'xl/styles.xml': STYLES });
    expect(cells).toEqual([['46250', '46250']]);
  });

  it('shows a time of day as hh:mm', () => {
    expect(read1(row(1, num('A1', 0.375, 4) + num('B1', 0.99, 1)), { 'xl/styles.xml': STYLES })).toEqual([['09:00', '23:46']]);
  });

  it('counts from 1904 when the workbook says so', () => {
    const pr = '<workbookPr date1904="1"/>';
    expect(read1(row(1, num('A1', 44788, 1)), { 'xl/styles.xml': STYLES }, '', pr)).toEqual([['2026-08-16']]);
  });

  it('leaves a number that is not a day of this calendar as it is', () => {
    expect(read1(row(1, num('A1', 99999999, 1) + num('B1', -5, 1)), { 'xl/styles.xml': STYLES })).toEqual([['99999999', '-5']]);
  });

  it('leaves a number alone when the workbook has no styles part at all', () => {
    expect(read1(row(1, num('A1', 46250, 1)))).toEqual([['46250']]);
  });
});

// ---- shape of the grid -----------------------------------------------------------------------

describe('readXlsx grid', () => {
  it('pads the rows and columns that the file leaves out, and drops the empty ones at the end', () => {
    const rows = row(2, text('B2', 'x')) + row(4, text('C4', 'y') + text('F4', '   ')) + row(9, '<c r="A9" s="3"/>');
    expect(read1(rows)).toEqual([
      ['', '', ''],
      ['', 'x', ''],
      ['', '', ''],
      ['', '', 'y'],
    ]);
  });

  it('numbers the rows and cells that have no r attribute one after the other', () => {
    const rows = '<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c t="inlineStr"><is><t>c</t></is></c></row>';
    expect(read1(rows)).toEqual([['a', 'b'], ['c', '']]);
  });

  it('gives an empty sheet no rows', () => {
    expect(read1('')).toEqual([]);
    expect(read1(row(1, '<c r="A1"/>'))).toEqual([]);
  });

  it('fills a merged range, down and across, with the top-left value', () => {
    const rows = row(1, text('A1', 'x')) + row(3, text('D3', 'z'));
    const merges = '<mergeCells count="2"><mergeCell ref="A1:C2"/><mergeCell ref="D3"/></mergeCells>';
    expect(read1(rows, {}, merges)).toEqual([
      ['x', 'x', 'x', ''],
      ['x', 'x', 'x', ''],
      ['', '', '', 'z'],
    ]);
  });

  it('cuts a merge that is wider or taller than the table to the table', () => {
    const rows = row(1, text('A1', 'title')) + row(2, text('A2', 'a') + text('B2', 'b'));
    expect(read1(rows, {}, '<mergeCells count="1"><mergeCell ref="A1:Z40"/></mergeCells>')).toEqual([
      ['title', 'title'],
      ['title', 'title'],
    ]);
  });

  it('does not fill a merge whose top-left cell is empty', () => {
    const rows = row(1, text('B1', 'x'));
    expect(read1(rows, {}, '<mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>')).toEqual([['', 'x']]);
  });
});

describe('readXlsx sheet choice', () => {
  it('reads the first visible sheet of workbook.xml: hidden and very hidden ones are skipped', () => {
    const hidden = { xml: sheetOf(row(1, text('A1', 'hidden'))), state: 'hidden' };
    const veryHidden = { xml: sheetOf(row(1, text('A1', 'very hidden'))), state: 'veryHidden' };
    const first = { xml: sheetOf(row(1, text('A1', 'the board'))), state: 'visible' };
    const other = { xml: sheetOf(row(1, text('A1', 'helper data'))) };
    expect(readXlsx(book([hidden, veryHidden, first, other]))).toEqual([['the board']]);
  });

  it('follows the relationship target, relative or absolute: the first sheet of the workbook is not the first part of the zip', () => {
    const files = {
      'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="a" sheetId="1" r:id="rIdB"/><sheet name="b" sheetId="2" r:id="rIdA"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':
        `<Relationships xmlns="${PKG}"><Relationship Id="rIdA" Type="${REL}/worksheet" Target="worksheets/second.xml"/>` +
        `<Relationship Id="rIdB" Type="${REL}/worksheet" Target="/xl/worksheets/first.xml"/></Relationships>`,
      'xl/worksheets/second.xml': sheetOf(row(1, text('A1', 'second'))),
      'xl/worksheets/first.xml': sheetOf(row(1, text('A1', 'first'))),
    };
    expect(readXlsx(pack(files))).toEqual([['first']]);
  });

  it('skips a chart sheet that comes first', () => {
    const files = {
      'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="c" sheetId="1" r:id="rId1"/><sheet name="d" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':
        `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/chartsheet" Target="chartsheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/chartsheets/sheet1.xml': `<chartsheet xmlns="${MAIN}"/>`,
      'xl/worksheets/sheet1.xml': sheetOf(row(1, text('A1', 'data'))),
    };
    expect(readXlsx(pack(files))).toEqual([['data']]);
  });

  it('does not read comments, drawings or macros', () => {
    const cells = read1(row(1, text('A1', 'cell')), {
      'xl/comments1.xml': '<comments><commentList><comment ref="A1"><text><t>SECRET-COMMENT</t></text></comment></commentList></comments>',
      'xl/drawings/drawing1.xml': '<drawing>SECRET-DRAWING</drawing>',
      'xl/vbaProject.bin': strToU8('SECRET-MACRO'),
    });
    expect(cells).toEqual([['cell']]);
  });
});

// ---- what it refuses -------------------------------------------------------------------------

describe('readXlsx refuses what is not an xlsx', () => {
  const unsupported = (bytes: Uint8Array) => expect(refusal(() => readXlsx(bytes))).toBe('unsupported_file');

  it('a PDF', () => unsupported(strToU8('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')));
  it('a csv', () => unsupported(strToU8('תאריך,יום,תיאור\n2026-11-09,שני,מבחן בערבית\n')));
  it('an old xls (a compound file)', () => unsupported(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(512).fill(0)])));
  it('an image', () => unsupported(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(7)])));
  it('nothing at all', () => unsupported(new Uint8Array(0)));
  it('a file of exactly the size limit that is not a zip', () => unsupported(new Uint8Array(MAX_FILE_BYTES)));
  it('a valid zip without xl/workbook.xml', () => unsupported(pack({ 'hello.txt': 'hi', 'word/document.xml': '<w:document/>' })));
  it('a zip that starts like an xlsx and is cut in the middle', () => unsupported(fixture('grade12-grid.xlsx').slice(0, 9000)));
  it('PK and then garbage', () => unsupported(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(200).fill(0xff)])));
  it('a workbook.xml that is not XML', () => unsupported(pack({ 'xl/workbook.xml': 'not xml at all' })));
  it('a workbook with no visible sheet', () => unsupported(book([{ xml: sheetOf(''), state: 'hidden' }])));
  it('a workbook whose sheet part is missing', () => {
    unsupported(
      pack({
        'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/gone.xml"/></Relationships>`,
      }),
    );
  });

  it('always with a BoardError that carries the code', () => {
    const e = (() => {
      try {
        readXlsx(strToU8('%PDF-'));
      } catch (err) {
        return err;
      }
    })();
    expect(e).toBeInstanceOf(BoardError);
    expect(e).toBeInstanceOf(Error);
    expect((e as BoardError).code).toBe('unsupported_file');
  });
});

describe('readXlsx limits', () => {
  it('refuses a file over 1MB as too big, before anything is opened', () => {
    expect(MAX_FILE_BYTES).toBe(MB);
    expect(refusal(() => readXlsx(new Uint8Array(MB + 1)))).toBe('too_big');
    expect(refusal(() => readXlsx(new Uint8Array(MB + 1).fill(0x50)))).toBe('too_big');
  });

  it('refuses a zip that inflates past 10MB, wherever the bulk sits', () => {
    expect(MAX_INFLATED_BYTES).toBe(10 * MB);
    const zeros = new Uint8Array(12 * MB);
    const inSheet = pack({ 'xl/workbook.xml': '<workbook/>', 'xl/worksheets/sheet1.xml': zeros });
    const elsewhere = pack({ 'xl/media/image1.bin': zeros });
    expect(inSheet.length).toBeLessThan(MB);
    expect(refusal(() => readXlsx(inSheet))).toBe('too_big');
    expect(refusal(() => readXlsx(elsewhere))).toBe('too_big');
  });

  it('stops inflating once the running total passes the limit, instead of inflating it all and then checking', () => {
    const bomb = pack({ 'xl/worksheets/sheet1.xml': new Uint8Array(64 * MB) });
    expect(bomb.length).toBeLessThan(MB);
    const progress = { fed: 0, inflated: 0 };
    expect(refusal(() => unzipLimited(bomb, 10 * MB, progress))).toBe('too_big');
    expect(progress.inflated).toBeGreaterThan(10 * MB);
    expect(progress.inflated).toBeLessThan(20 * MB); // 64MB would be inflated by a check at the end
    expect(progress.fed).toBeLessThan(bomb.length);
  });

  it('stops at the limit it is given, whatever the zip says about its own size', () => {
    const bomb = pack({ 'a.bin': new Uint8Array(MB) });
    expect(refusal(() => unzipLimited(bomb, 4096))).toBe('too_big');
    expect(unzipLimited(bomb, 2 * MB).size).toBe(0);
  });

  it('is too big before it is broken: a bomb cut in the middle still says too_big', () => {
    const bomb = pack({ 'xl/worksheets/sheet1.xml': new Uint8Array(64 * MB) });
    expect(refusal(() => readXlsx(bomb.slice(0, Math.floor(bomb.length * 0.9))))).toBe('too_big');
  });

  it('refuses a sheet of more than 20,000 cells, and takes 20,000', () => {
    expect(MAX_CELLS).toBe(20_000);
    const grid = (n: number) => {
      const rows: string[] = [];
      for (let r = 1; r <= Math.ceil(n / 100); r++) {
        const cells: string[] = [];
        for (let c = 1; c <= 100 && (r - 1) * 100 + c <= n; c++) cells.push(text(`${colName(c)}${r}`, 'x'));
        rows.push(row(r, cells.join('')));
      }
      return rows.join('');
    };
    expect(read1(grid(20_000))).toHaveLength(200);
    expect(refusal(() => read1(grid(20_001)))).toBe('too_big');
  });

  it('does not count a cell that only carries a style', () => {
    const styled = Array.from({ length: 300 }, (_, r) => row(r + 1, Array.from({ length: 100 }, (_, c) => `<c r="${colName(c + 1)}${r + 1}" s="1"/>`).join(''))).join('');
    expect(read1(styled + row(301, text('A301', 'end')))).toHaveLength(301);
  });

  it('refuses elements nested deeper than any sheet is, which the XML parser would take minutes over', () => {
    const nested = '<a>'.repeat(100_000); // a few KB zipped
    expect(refusal(() => read1(row(1, nested)))).toBe('too_big');
    expect(refusal(() => read1(row(1, '<a>'.repeat(65))))).toBe('too_big');
    expect(read1(row(1, text('A1', 'x')))).toEqual([['x']]);
  });

  it('refuses a sheet of more than 500,000 elements, even when none of them holds a value', () => {
    const empties = '<c r="A1" s="1"/>'.repeat(500_001); // about 8MB of XML, 20KB zipped
    expect(refusal(() => read1(row(1, empties)))).toBe('too_big');
  });

  it('counts the elements of every part it reads together: four parts of 499,000 each are too big (S-I4)', () => {
    const N = 499_000;
    const pad = '<a/>'.repeat(N); // about 2MB of XML a part, 8MB in all: under the 10MB the archive may inflate to
    const workbook =
      `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets><x>${pad}</x></workbook>`;
    const rels = `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><x>${pad}</x></Relationships>`;
    const styles = `<styleSheet xmlns="${MAIN}"><x>${pad}</x></styleSheet>`;
    const strings = `<sst xmlns="${MAIN}"><x>${pad}</x></sst>`;
    const bytes = pack({
      'xl/workbook.xml': workbook,
      'xl/_rels/workbook.xml.rels': rels,
      'xl/styles.xml': styles,
      'xl/sharedStrings.xml': strings,
      'xl/worksheets/sheet1.xml': sheetOf(row(1, text('A1', 'x'))),
    });
    expect(refusal(() => readXlsx(bytes))).toBe('too_big');
    // One such part, under the limit on its own, is read.
    expect(readXlsx(pack({ 'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': rels.replace(`<x>${pad}</x>`, ''), 'xl/worksheets/sheet1.xml': sheetOf(row(1, text('A1', 'x'))) }))).toEqual([['x']]);
  }, 30_000);

  describe('the text of the grid it returns', () => {
    const sst = (text: string) => `<sst xmlns="${MAIN}"><si><t>${text}</t></si></sst>`;
    /** n cells in a row that all show shared string 0 */
    const shows = (n: number) => row(1, Array.from({ length: n }, (_, i) => `<c r="${colName(i + 1)}1" t="s"><v>0</v></c>`).join(''));

    it('is at most 2,000,000 characters, counted once for every cell that shows a shared string', () => {
      expect(MAX_TEXT_CHARS).toBe(2_000_000);
      const extra = { 'xl/sharedStrings.xml': sst('x'.repeat(500_000)) };
      expect(read1(shows(4), extra)[0]).toHaveLength(4);
      expect(refusal(() => read1(shows(5), extra))).toBe('too_big');
    });

    it('is at most 2,000,000 characters in one cell too', () => {
      expect(read1(row(1, text('A1', 'x'.repeat(MAX_TEXT_CHARS))))[0]![0]).toHaveLength(MAX_TEXT_CHARS);
      expect(refusal(() => read1(row(1, text('A1', 'x'.repeat(MAX_TEXT_CHARS + 1)))))).toBe('too_big');
    });

    it('counts a merged cell once for every cell it fills', () => {
      const merge = '<mergeCells count="1"><mergeCell ref="A1:J10"/></mergeCells>'; // 100 cells
      const rows = (n: number) => row(1, text('A1', 'x'.repeat(n))) + row(10, text('J10', 'y'));
      // exactly 2,000,000 with 20,000 characters: the top-left cell is counted once, and the 'y' it overwrites not at all
      const ok = read1(rows(20_000), {}, merge);
      expect(ok.flat()).toHaveLength(100);
      expect(ok.flat().every((c) => c.length === 20_000)).toBe(true);
      expect(refusal(() => read1(rows(20_001), {}, merge))).toBe('too_big');
    });

    // the probes of the review: they took 24 seconds, and a fatal out-of-memory abort of the process, before
    it('refuses a 9MB shared string used by a thousand cells at once, not after minutes', { timeout: 20_000 }, () => {
      const started = performance.now();
      expect(refusal(() => read1(shows(1000), { 'xl/sharedStrings.xml': sst('x'.repeat(9 * MB)) }))).toBe('too_big');
      expect(performance.now() - started).toBeLessThan(5000); // about half a second; it was 13 to 24 seconds
    });

    it('does not copy a shared string with a line break in it for every cell either', { timeout: 20_000 }, () => {
      const started = performance.now();
      const big = '\r\n' + 'x'.repeat(4 * MB);
      expect(refusal(() => read1(shows(2000), { 'xl/sharedStrings.xml': sst(big) }))).toBe('too_big');
      expect(performance.now() - started).toBeLessThan(5000);
    });

    it('still cleans a shared string, once: a line break, an escape and the ends', () => {
      const extra = { 'xl/sharedStrings.xml': sst('  a\r\nb_x000D_c  ') };
      expect(read1(shows(3), extra)).toEqual([['a\nb\nc', 'a\nb\nc', 'a\nb\nc']]);
    });
  });

  it('refuses a cell far away instead of building a grid out to it', () => {
    expect(refusal(() => read1(row(1048576, text('A1048576', 'x'))))).toBe('too_big');
    expect(refusal(() => read1(row(1, text('XFD1', 'x'))))).toBe('too_big');
    expect(read1(row(10_000, text('A10000', 'x')))).toHaveLength(10_000);
  });

  it('refuses a sheet whose merges would fill more than a million cells', () => {
    const rows = row(1, text('A1', 'x')) + row(200, text('GR200', 'y'));
    const merge = '<mergeCell ref="A1:GR200"/>'; // 200 x 200 cells, 40,000 a time
    expect(read1(rows, {}, `<mergeCells count="25">${merge.repeat(25)}</mergeCells>`)).toHaveLength(200);
    expect(refusal(() => read1(rows, {}, `<mergeCells count="26">${merge.repeat(26)}</mergeCells>`))).toBe('too_big');
  });

  it('does not build a grid out to the end of the sheet for a merge that spans it', () => {
    const rows = row(1, text('A1', 'x')) + row(3, text('B3', 'y'));
    const cells = read1(rows, {}, '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>');
    expect(cells).toEqual([['x', 'x'], ['x', 'x'], ['x', 'x']]);
  });
});
