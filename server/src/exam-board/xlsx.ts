/**
 * Reads the first visible sheet of an xlsx into a rectangle of text. It is the one door a file from an
 * anonymous device comes through, so it is small on purpose and it refuses early:
 *
 * - at most 1MB of file, at most 10MB once inflated (counted while inflating: the archive stops being read
 *   the moment the running total passes the limit), at most 20,000 cells with a value, and at most
 *   2,000,000 characters of text in the grid it returns (a shared string used by many cells, or a merge,
 *   counts once for every cell that shows it);
 * - formulas are not evaluated (the value the file stored is taken), and comments, drawings and macros are
 *   never parsed: only the workbook, its relationships, the styles, the shared strings and the sheets are.
 *
 * Anything that is not an xlsx (a PDF, a csv, an old xls, another zip) is `unsupported_file`.
 */
import * as cheerio from 'cheerio';
import type { AnyNode, CDATA, Element, Text } from 'domhandler';
import { Unzip, UnzipInflate } from 'fflate';
import { Parser } from 'htmlparser2';
import { BoardError } from './errors';

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_INFLATED_BYTES = 10 * 1024 * 1024;
export const MAX_CELLS = 20_000;
/**
 * Characters of text in the returned grid, summed over its cells (a merged cell counts once per cell it fills).
 * A real board is tens of thousands. Checked while the grid is built, so the work stops at the limit.
 */
export const MAX_TEXT_CHARS = 2_000_000;
/** How far from A1 a cell may be, so one stray cell cannot make a grid out to row 1,048,576. */
const MAX_ROWS = 10_000;
const MAX_COLS = 256;
/**
 * Elements in all the parts that are read, together: their trees are alive at the same time. A DOM costs a few
 * hundred bytes an element, so this keeps 10MB of empty elements from becoming half a gigabyte, however they are
 * spread over the parts. A real board has a tenth of it.
 */
const MAX_ELEMENTS = 500_000;

/** The elements counted so far in the parts of one file (`MAX_ELEMENTS`). */
interface ElementBudget {
  used: number;
}
/** How deep elements may nest. A sheet is seven deep; the XML parser takes time in the square of the depth. */
const MAX_DEPTH = 64;
/** Cells a merge may fill, over all the merges of the sheet. */
const MAX_MERGE_FILL = 1_000_000;
/**
 * The compressed bytes handed to the inflater at a time. Deflate cannot expand more than about 1000 times,
 * so one step can never produce more than a few MB beyond what was already counted.
 */
const CHUNK = 4096;

/** The parts that are read; every other part is inflated for the count and thrown away. */
const READ = /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/;

const unsupported = () => new BoardError('unsupported_file');

/** What `unzipLimited` has done so far; only for a test that has to see that it stopped early. */
export interface UnzipProgress {
  /** Compressed bytes handed to the inflater. */
  fed: number;
  /** Bytes inflated, counted in every part of the archive. */
  inflated: number;
}

/**
 * Unzips with a running total: once more than `maxInflated` bytes have come out of all the parts together it
 * throws `too_big` and reads no further. Returns the parts that `readXlsx` reads (name -> bytes).
 * The sizes the archive declares about itself are never used.
 */
export function unzipLimited(bytes: Uint8Array, maxInflated = MAX_INFLATED_BYTES, progress?: UnzipProgress): Map<string, Uint8Array> {
  const parts = new Map<string, Uint8Array>();
  let failure: BoardError | undefined;
  let total = 0;

  const unzip = new Unzip((file) => {
    if (failure) return;
    const name = file.name.replace(/\\/g, '/').replace(/^(?:\.?\/)+/, '');
    const keep = READ.test(name);
    const pieces: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err || !chunk) {
        failure = unsupported();
        return;
      }
      total += chunk.length;
      if (progress) progress.inflated = total;
      if (total > maxInflated) {
        failure = new BoardError('too_big');
        return;
      }
      if (keep) pieces.push(chunk);
      if (final && keep) parts.set(name, join(pieces));
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  try {
    for (let at = 0; at < bytes.length && !failure; at += CHUNK) {
      const end = Math.min(at + CHUNK, bytes.length);
      unzip.push(bytes.subarray(at, end), end === bytes.length);
      if (progress) progress.fed = end;
    }
  } catch {
    // fflate throws on a broken or cut archive, and on a compression it does not know
    throw failure ?? unsupported();
  }
  if (failure) throw failure;
  return parts;
}

function join(pieces: Uint8Array[]): Uint8Array {
  if (pieces.length === 1) return pieces[0]!;
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The cells of the first visible sheet: rows of trimmed text, all the same length, an empty cell is `''`. */
export function readXlsx(bytes: Uint8Array): string[][] {
  if (bytes.length > MAX_FILE_BYTES) throw new BoardError('too_big');
  // PK\x03\x04: a PDF, a csv, an old xls (a compound file) and an image all stop here
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw unsupported();
  try {
    return readParts(unzipLimited(bytes));
  } catch (e) {
    if (e instanceof BoardError) throw e;
    throw unsupported();
  }
}

// ---- the parts -------------------------------------------------------------------------------

function readParts(parts: Map<string, Uint8Array>): string[][] {
  // one count of elements for every part: their trees are held together
  const budget: ElementBudget = { used: 0 };
  const rootOf = (bytes: Uint8Array | undefined) => partRoot(bytes, budget);
  const workbook = rootOf(parts.get('xl/workbook.xml'));
  if (!workbook) throw unsupported();
  const rels = relationships(rootOf(parts.get('xl/_rels/workbook.xml.rels')));

  const sheet = kids(workbook, 'sheets').flatMap((s) => kids(s, 'sheet')).find((s) => {
    const state = s.attribs.state;
    const rel = rels.get(relId(s) ?? '');
    return state !== 'hidden' && state !== 'veryHidden' && rel !== undefined && /\/worksheet$/.test(rel.type);
  });
  if (!sheet) throw unsupported();
  const sheetXml = parts.get(partPath(rels.get(relId(sheet) ?? '')!.target));
  if (!sheetXml) throw unsupported();

  const date1904 = ['1', 'true'].includes(kid(workbook, 'workbookPr')?.attribs.date1904 ?? '');
  const strings = sharedStrings(rootOf(parts.get('xl/sharedStrings.xml')));
  const isDate = dateStyles(rootOf(parts.get('xl/styles.xml')));
  const worksheet = rootOf(sheetXml);
  if (!worksheet) throw unsupported();
  return grid(worksheet, strings, isDate, date1904);
}

function partRoot(bytes: Uint8Array | undefined, budget: ElementBudget): Element | undefined {
  if (!bytes) return undefined;
  const xml = new TextDecoder('utf-8').decode(bytes);
  checkShape(xml, budget);
  const $ = cheerio.load(xml, { xmlMode: true });
  return $.root().get(0)?.children.find(isElement);
}

/**
 * Before the tree is built: too many elements (counted in `budget`, over every part of the file), or elements nested
 * too deep, are refused. It runs the same tokenizer as the tree does, without keeping anything, and stops at the first
 * element past a limit, so a document made to be slow or large is refused after a few thousand elements and not after
 * all of them.
 */
function checkShape(xml: string, budget: ElementBudget): void {
  let depth = 0;
  const parser = new Parser(
    {
      onopentagname() {
        if (++budget.used > MAX_ELEMENTS || ++depth > MAX_DEPTH) throw new BoardError('too_big');
      },
      onclosetag() {
        depth--;
      },
    },
    { xmlMode: true },
  );
  parser.write(xml);
  parser.end();
}

/** The relationships of the workbook: id -> type and target. */
function relationships(root: Element | undefined): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  for (const r of root ? kids(root, 'Relationship') : []) {
    const { Id, Type, Target } = r.attribs;
    if (Id && Type && Target) out.set(Id, { type: Type, target: Target });
  }
  return out;
}

/** The path of a part from the target of a relationship, which is relative to `xl/` unless it starts with a slash. */
function partPath(target: string): string {
  const t = target.replace(/\\/g, '/');
  const out: string[] = [];
  for (const seg of (t.startsWith('/') ? t.slice(1) : `xl/${t}`).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function sharedStrings(root: Element | undefined): (index: number) => string {
  const items = root ? kids(root, 'si') : [];
  const cache = new Map<number, string>();
  return (i) => {
    const item = items[i];
    if (!item) return '';
    let s = cache.get(i);
    // cleaned here, once, and not once per cell that shows it
    if (s === undefined) cache.set(i, (s = clean(richText(item))));
    return s;
  };
}

/** The text of a shared or inline string: its plain text, or every run of it; never the phonetic runs. */
function richText(el: Element): string {
  let s = '';
  for (const child of el.children) {
    if (!isElement(child)) continue;
    const name = local(child);
    if (name === 't') s += textOf(child);
    else if (name === 'r') for (const t of kids(child, 't')) s += textOf(t);
  }
  return s;
}

// ---- dates -----------------------------------------------------------------------------------

/** Which cell styles (indexes into `cellXfs`) show a date or a time. */
function dateStyles(root: Element | undefined): (style: number) => boolean {
  if (!root) return () => false;
  const codes = new Map<number, string>();
  for (const f of kids(root, 'numFmts').flatMap((n) => kids(n, 'numFmt'))) {
    const id = Number(f.attribs.numFmtId);
    if (Number.isInteger(id) && f.attribs.formatCode !== undefined) codes.set(id, f.attribs.formatCode);
  }
  const xfs = kids(root, 'cellXfs').flatMap((n) => kids(n, 'xf'));
  const cache = new Map<number, boolean>();
  return (style) => {
    let known = cache.get(style);
    if (known === undefined) {
      const id = Number(xfs[style]?.attribs.numFmtId);
      known = (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || codeShowsDate(codes.get(id));
      cache.set(style, known);
    }
    return known;
  };
}

/** A custom format code with a day, a month, a year or a time in it, once quotes, escapes and [..] parts are out. */
function codeShowsDate(code: string | undefined): boolean {
  if (!code) return false;
  const bare = code.replace(/"[^"]*"/g, '').replace(/[\\_*]./g, '').replace(/\[[^\]]*\]/g, '');
  return !/^\s*(?:general|standard)\s*$/i.test(bare) && /[dmyhs]/i.test(bare);
}

const DAY = 86_400_000;
/** 31 December 9999, the last day a spreadsheet can show. */
const LAST_SERIAL = 2_958_465;

/** A serial number as `yyyy-mm-dd`, or as `hh:mm` when it is less than a day; null when it is no date of this calendar. */
function serialText(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > LAST_SERIAL) return null;
  const days = Math.floor(serial);
  if (days === 0) {
    const minutes = Math.round((serial - days) * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  // the 1900 system counts a 29 February 1900 that never was: from serial 61 on, day 0 is 30 December 1899
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : days < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(epoch + days * DAY).toISOString().slice(0, 10);
}

// ---- the sheet -------------------------------------------------------------------------------

function grid(worksheet: Element, strings: (i: number) => string, isDate: (style: number) => boolean, date1904: boolean): string[][] {
  const cells: { row: number; col: number; text: string }[] = [];
  let rows = 0;
  let cols = 0;
  let counted = 0;
  let used = 0;

  let rowNo = 0;
  for (const rowEl of kids(worksheet, 'sheetData').flatMap((d) => kids(d, 'row'))) {
    rowNo = positive(rowEl.attribs.r) ?? rowNo + 1;
    let colNo = 0;
    for (const c of kids(rowEl, 'c')) {
      const at = parseRef(c.attribs.r);
      const row = at?.row ?? rowNo;
      const col = at?.col ?? colNo + 1;
      colNo = col;
      // a cell that only carries a style is nothing; the others are counted before they are read
      if (!kid(c, 'v') && !kid(c, 'is')) continue;
      if (++counted > MAX_CELLS) throw new BoardError('too_big');
      // a shared string comes back clean from its cache; any other text is the cell's own
      const text = c.attribs.t === 's' ? cellText(c, strings, isDate, date1904) : clean(cellText(c, strings, isDate, date1904));
      if (text === '') continue;
      if (row > MAX_ROWS || col > MAX_COLS) throw new BoardError('too_big');
      if ((used += text.length) > MAX_TEXT_CHARS) throw new BoardError('too_big');
      cells.push({ row, col, text });
      if (row > rows) rows = row;
      if (col > cols) cols = col;
    }
  }

  const out = Array.from({ length: rows }, () => new Array<string>(cols).fill(''));
  for (const { row, col, text } of cells) out[row - 1]![col - 1] = text;

  // a merged range shows its top-left value in every cell; a range is cut to the table, so one merge
  // across the whole sheet adds neither rows nor columns
  let filled = 0;
  for (const m of kids(worksheet, 'mergeCells').flatMap((n) => kids(n, 'mergeCell'))) {
    const [from, to] = (m.attribs.ref ?? '').split(':');
    const a = parseRef(from);
    const b = parseRef(to);
    if (!a || !b) continue;
    const value = out[a.row - 1]?.[a.col - 1];
    if (!value) continue;
    const lastRow = Math.min(Math.max(a.row, b.row), rows);
    const lastCol = Math.min(Math.max(a.col, b.col), cols);
    for (let r = Math.min(a.row, b.row); r <= lastRow; r++) {
      for (let c = Math.min(a.col, b.col); c <= lastCol; c++) {
        if (++filled > MAX_MERGE_FILL) throw new BoardError('too_big');
        const row = out[r - 1]!;
        // the text of the cell that is overwritten leaves the grid and the value comes in; the top-left cell adds nothing
        if ((used += value.length - row[c - 1]!.length) > MAX_TEXT_CHARS) throw new BoardError('too_big');
        row[c - 1] = value;
      }
    }
  }
  return out;
}

/** The text of one cell, as the file stored it. */
function cellText(c: Element, strings: (i: number) => string, isDate: (style: number) => boolean, date1904: boolean): string {
  const type = c.attribs.t;
  if (type === 'inlineStr') {
    const inline = kid(c, 'is');
    return inline ? richText(inline) : '';
  }
  const v = kid(c, 'v');
  if (!v) return '';
  const raw = textOf(v).trim();
  switch (type) {
    case 's':
      return strings(Number(raw));
    case 'str':
      return textOf(v);
    case 'b':
      return raw === '1' || raw.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
    case 'e':
      return '';
    case 'd':
      return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
    default: {
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n)) return raw;
      return (isDate(Number(c.attribs.s ?? 0)) ? serialText(n, date1904) : null) ?? String(n);
    }
  }
}

/** Escapes for characters XML cannot hold (`_x000D_`), one kind of line break, and trimmed ends. */
function clean(s: string): string {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\r\n?/g, '\n')
    .trim();
}

function positive(s: string | undefined): number | undefined {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** `F72` -> row 72, column 6. */
function parseRef(ref: string | undefined): { row: number; col: number } | undefined {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(ref ?? '');
  if (!m) return undefined;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]), col };
}

// ---- walking the XML, whatever prefix the elements carry ---------------------------------------

function isElement(n: AnyNode): n is Element {
  return 'attribs' in n && 'name' in n;
}

function local(el: Element): string {
  return el.name.slice(el.name.lastIndexOf(':') + 1);
}

function kids(el: Element, name: string): Element[] {
  return el.children.filter((n): n is Element => isElement(n) && local(n) === name);
}

function kid(el: Element, name: string): Element | undefined {
  return kids(el, name)[0];
}

function textOf(n: AnyNode): string {
  if (n.nodeType === 3) return (n as Text).data;
  if (n.nodeType === 1 || n.nodeType === 4) return (n as Element | CDATA).children.map(textOf).join('');
  return '';
}

/** The id that ties a `<sheet>` to its relationship, written `r:id` or with another prefix. */
function relId(sheet: Element): string | undefined {
  return sheet.attribs['r:id'] ?? Object.entries(sheet.attribs).find(([k]) => k.endsWith(':id'))?.[1];
}
