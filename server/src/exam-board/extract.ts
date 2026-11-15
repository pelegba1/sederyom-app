/**
 * The exam board's extractor (design doc, "איך קוראים קובץ"): a rectangle of text cells in, dated rows out.
 * It is a pure function with no model in it, so every saved board is a test. The one rule that decides how it
 * is written: a wrong date saved for a whole class is the worst outcome, so a date that is not read with
 * certainty never becomes a row. The row is skipped and reported, and the student sees it.
 *
 * Two layouts are recognised, in this order:
 * - a grid: a date column and several class columns (`י"ב1`, `י"ב8 מופ"ת`), plus grade-wide columns (events,
 *   layer exams) that belong to every class. Only the columns of the device's class and the grade-wide ones
 *   are read;
 * - a list: a date column, a description column and, perhaps, a notes column. Every row is read, whichever
 *   class it names: the phone marks which are the student's own.
 *
 * It takes what an anonymous device sent, so the rows it makes cannot be made large by the way the grid is built:
 * - a row's title is cut to `MAX_TITLE` characters and its details to `MAX_DETAILS` (the limits of a save), and
 *   the suffix a class header adds to a title to `MAX_SUFFIX`. Each line is cut as it is read and a string that
 *   is full takes nothing more, so a title or details never grows past its limit. The notes of a row are made
 *   into one string once, and the events of the row share it;
 * - more than `MAX_ROWS` rows and skipped lines together is `BoardError('too_big')`. A real board is under 400;
 * - a cell, a row and a column are each read once and a set holds the rows already seen, so the time and the
 *   memory are in the size of what was read (the reader allows at most 20,000 cells with a value, and 2M
 *   characters). The events of a line are told apart once, before its days: a range of days costs a key a day for
 *   each different event, not for each event the cell repeats.
 * What a skipped line says (`text`) is the row as it was written, cut to `MAX_SKIPPED_TEXT`.
 *
 * Every line of text it reads is cleaned as a board's text is (`cleanText`: no control, no bidi mark, no zero-width
 * character), and two titles are one when their key is (`normTitle`).
 */
import type { BoardRow, BoardSkipped, DateStr } from '@sederyom/shared';
import { schoolYearOf } from '@sederyom/shared/logic/exam-board/calendar';
import { normTitle } from '@sederyom/shared/logic/exam-board/keys';
import { BOARD_DETAILS_MAX, BOARD_TITLE_MAX } from '@sederyom/shared/logic/exam-board/rows';
import { cleanText } from '@sederyom/shared/logic/exam-board/text';
import { BoardError } from './errors';

export type BoardExtract =
  | { kind: 'rows'; layout: 'list' | 'grid'; rows: BoardRow[]; skipped: BoardSkipped[] }
  | { kind: 'columns'; columns: string[] };

/** The header is looked for in this many rows from the top; a board has a title or two above it. */
const HEADER_ROWS = 10;
/** What a description column is called, in the order they are tried. */
const DESCRIPTION_WORDS = ['תיאור', 'אירוע', 'ארוע', 'מבחן', 'נושא'];
const EXAM_WORDS = ['מבחן', 'בוחן', 'בחינה', 'מתכונת', 'בגרות', 'מועד ב', 'מסכם'];

/** A title is 1 to 200 characters, and details at most 500, when a board is saved: a row is cut to that here. */
export const MAX_TITLE = BOARD_TITLE_MAX;
export const MAX_DETAILS = BOARD_DETAILS_MAX;
/** What a class header adds after the title (`מופ"ת`), without its parentheses. */
export const MAX_SUFFIX = 30;
/** Rows and skipped lines together; past it the board is `too_big`. A day of a range is a row. */
export const MAX_ROWS = 2000;
/** What a skipped line says, for the student to know it by: a line, not the whole of a long cell. */
export const MAX_SKIPPED_TEXT = 300;

// ---- names ------------------------------------------------------------------------------------

const QUOTES = /["״'׳]/g;

/** A class as two spellings of it agree on: no quote marks, no spaces (`י"ב 3` and `יב3`). */
function classKey(name: string): string {
  return name.replace(QUOTES, '').replace(/\s+/g, '');
}

export function sameClass(a: string, b: string): boolean {
  return classKey(a) === classKey(b);
}

/**
 * A column header that names a class: a grade letter (ז to י), maybe the second letter of י"א / י"ב, quote
 * marks, and the class number. What follows the number is the suffix (`מופ"ת`). The number is read whole, so
 * `יב1` is not `יב10`.
 */
const CLASS_HEADER = /^([ז-י]["״']?[א-ב]?['׳]?\s?\d+)([\s\S]*)$/;
/** A weekday column: `יום`, `יום בשבוע`. Its cells are never read. */
const DAY_HEADER = /^יום(?:\s|$)/;

// ---- exams ------------------------------------------------------------------------------------

export function isExamTitle(title: string): boolean {
  const t = title.replace(/\s+/g, ' ');
  return EXAM_WORDS.some((w) => t.includes(w));
}

// ---- dates ------------------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1]!);
const two = (n: number) => String(n).padStart(2, '0');

const ISO = /^((?:19|20)\d{2})-(\d{2})-(\d{2})$/;
/** `d.m.yy`, `d/m/yy`, a four-digit year, no year, and `a-b.m[.yy]`. A separator may be doubled (`22.11..26`). */
const DMY = /^(\d{1,2})(?:[-–](\d{1,2}))?(?:\.{1,2}|\/{1,2})(\d{1,2})(?:(?:\.{1,2}|\/{1,2})(\d{2}|(?:19|20)\d{2}))?$/;

/**
 * The days a date cell says, or `null` when it is not read with certainty: `6-12.26` is no month, `31.4` is no
 * day, `חופשת חנוכה` is no date. A date without a year is the one inside the school year of `today`. Whether
 * the days are inside that year is for the caller; a date with a year is returned as it is written.
 */
export function parseBoardDates(text: string, today: DateStr): DateStr[] | null {
  const t = text.trim();
  const iso = ISO.exec(t);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? [`${iso[1]}-${two(m)}-${two(d)}`] : null;
  }

  const hit = DMY.exec(t);
  if (!hit) return null;
  const from = Number(hit[1]);
  const to = hit[2] === undefined ? from : Number(hit[2]);
  const month = Number(hit[3]);
  if (month < 1 || month > 12) return null;
  if (hit[2] !== undefined && from >= to) return null;

  let year: number;
  if (hit[4] === undefined) {
    const startYear = Number(schoolYearOf(today).start.slice(0, 4));
    year = month >= 9 ? startYear : startYear + 1;
  } else {
    year = hit[4].length === 2 ? 2000 + Number(hit[4]) : Number(hit[4]);
  }
  if (from < 1 || to > daysIn(year, month)) return null;

  const days: DateStr[] = [];
  for (let d = from; d <= to; d += 1) days.push(`${year}-${two(month)}-${two(d)}`);
  return days;
}

// ---- cells ------------------------------------------------------------------------------------

const cellAt = (row: string[] | undefined, col: number): string => (row?.[col] ?? '').trim();
/** One line of a cell, as a board keeps text (`cleanText`); a cell is split into its lines before this. */
const oneLine = (text: string): string => cleanText(text);

/** `text` cut to `max` characters, never between the two halves of a character. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const highHalf = (code: number) => code >= 0xd800 && code <= 0xdbff;
  return text.slice(0, highHalf(text.charCodeAt(max - 1)) ? max - 1 : max);
}

/** `acc` with `line` on a new line, the whole cut to `max`. Once `acc` is full nothing is added, so no long string is built. */
function appendCapped(acc: string | null, line: string, max: number): string | null {
  if (acc === null) return cut(line, max);
  const room = max - acc.length - 1;
  if (room <= 0) return acc;
  const part = cut(line, room);
  return part === '' ? acc : `${acc}\n${part}`;
}

/** One event of a cell: the first line is the title, the lines after it are details. Both are already cut. */
interface Event {
  title: string;
  details: string | null;
}

const SEPARATOR = /^[-_]{3,}$/;

/**
 * A cell holds several events when a line of three or more `-` or `_` stands between them. In each event the
 * first line that is not empty is the title and the rest are details. A separator at the start or the end, or
 * two in a row, makes no empty event. The title is cut to `MAX_TITLE` and the details to `MAX_DETAILS` as they
 * are read.
 */
function eventsOf(text: string): Event[] {
  const events: Event[] = [];
  let title: string | null = null;
  let details: string | null = null;
  const close = () => {
    if (title !== null) events.push({ title, details });
    title = null;
    details = null;
  };
  for (const raw of text.split('\n')) {
    const line = oneLine(raw);
    if (SEPARATOR.test(line)) close();
    else if (line === '') continue;
    else if (title === null) title = cut(line, MAX_TITLE);
    else details = appendCapped(details, line, MAX_DETAILS);
  }
  close();
  return events;
}

/** The lines of a notes cell as details: one string for the whole row, made once, cut to `MAX_DETAILS`. */
function notesOf(text: string): string | null {
  let notes: string | null = null;
  for (const raw of text.split('\n')) {
    if (notes !== null && notes.length >= MAX_DETAILS) break;
    const line = oneLine(raw);
    if (line !== '' && !SEPARATOR.test(line)) notes = appendCapped(notes, line, MAX_DETAILS);
  }
  return notes;
}

/** The details of an event, then the notes of its row after them. */
function withNotes(details: string | null, notes: string | null): string | null {
  if (notes === null) return details;
  return details === null ? notes : appendCapped(details, notes, MAX_DETAILS);
}

// ---- the header -------------------------------------------------------------------------------

interface ClassColumn {
  col: number;
  header: string;
  token: string;
  suffix: string;
}

interface GridHeader {
  layout: 'grid';
  row: number;
  dateCol: number;
  classCols: ClassColumn[];
  /** Columns of the whole grade: events and layer exams, which every class takes. */
  gradeCols: number[];
}

interface ListHeader {
  layout: 'list';
  row: number;
  dateCol: number;
  descCol: number;
  noteCol: number;
}

/**
 * What a header says after the class number, to be put after a title in parentheses: `מופ"ת` and `(מופ"ת)` both
 * give `מופ"ת`. Cut to `MAX_SUFFIX`, so that a long header cannot make every title long.
 */
function cleanSuffix(rest: string): string {
  const s = oneLine(rest.replace(/^[\s\-–:,]+/, ''));
  const inner = s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1).trim() : s;
  return cut(inner, MAX_SUFFIX).trimEnd();
}

function gridHeader(row: number, heads: string[], dateCol: number): GridHeader | null {
  const classCols: ClassColumn[] = [];
  const gradeCols: number[] = [];
  for (let col = 0; col < heads.length; col += 1) {
    const header = heads[col]!;
    if (header === '' || col === dateCol) continue;
    const hit = CLASS_HEADER.exec(header);
    if (hit) classCols.push({ col, header, token: hit[1]!, suffix: cleanSuffix(hit[2]!) });
    else if (!DAY_HEADER.test(header) && !header.includes('תאריך')) gradeCols.push(col);
  }
  return classCols.length >= 2 ? { layout: 'grid', row, dateCol, classCols, gradeCols } : null;
}

function listHeader(row: number, heads: string[], dateCol: number): ListHeader | null {
  let descCol = -1;
  for (const word of DESCRIPTION_WORDS) {
    descCol = heads.findIndex((h, col) => col !== dateCol && h.includes(word));
    if (descCol >= 0) break;
  }
  if (descCol < 0) return null;
  const noteCol = heads.findIndex((h, col) => col !== dateCol && col !== descCol && h.includes('הערות'));
  return { layout: 'list', row, dateCol, descCol, noteCol };
}

/** The first row, in the top rows, that has a date column and is either a grid's header or a list's. */
function findHeader(cells: string[][]): GridHeader | ListHeader | null {
  for (let row = 0; row < Math.min(cells.length, HEADER_ROWS); row += 1) {
    const heads = (cells[row] ?? []).map(oneLine);
    const dateCol = heads.findIndex((h) => h.includes('תאריך'));
    if (dateCol < 0) continue;
    // A grid first: its columns of events and notes read like a list's description.
    const found = gridHeader(row, heads, dateCol) ?? listHeader(row, heads, dateCol);
    if (found) return found;
  }
  return null;
}

// ---- collecting rows --------------------------------------------------------------------------

interface Found {
  title: string;
  details: string | null;
}

class Collector {
  readonly rows: BoardRow[] = [];
  readonly skipped: BoardSkipped[] = [];
  private readonly seen = new Set<string>();
  private readonly year: { start: DateStr; end: DateStr };

  constructor(private readonly today: DateStr) {
    this.year = schoolYearOf(today);
  }

  /**
   * One line of the board: the date as written, what was found on it, and what it said (for a person to read
   * if it is skipped). A date that is not read, or not inside the school year, skips the whole line.
   */
  add(dateText: string, found: Found[], said: string): void {
    if (found.length === 0) return;
    const dates = parseBoardDates(dateText, this.today);
    if (dates === null || dates.some((d) => d < this.year.start || d > this.year.end)) {
      // what the line said, as far as a person reads it: cut, never between the two halves of a character
      const text = cut(`${oneLine(dateText)} ${said}`.trim(), MAX_SKIPPED_TEXT).trimEnd();
      this.push(this.skipped, { text, reason: dates === null ? 'date' : 'out_of_year' });
      return;
    }
    // The key is of the title as it is returned, which is already cut: two titles that differ only after the cut
    // are one row, so no two rows share a key. The line's events are told apart here, once: the first of a key
    // stays, and a range of days then goes through each different event once a day.
    const distinct = new Map<string, Found>();
    for (const f of found) {
      const key = normTitle(f.title);
      if (!distinct.has(key)) distinct.set(key, f);
    }
    for (const date of dates) {
      for (const [title, f] of distinct) {
        const key = `${date}|${title}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        this.push(this.rows, { date, title: f.title, details: f.details, isExam: isExamTitle(f.title) });
      }
    }
  }

  private push<T>(list: T[], item: T): void {
    if (this.rows.length + this.skipped.length >= MAX_ROWS) throw new BoardError('too_big');
    list.push(item);
  }
}

function readList(cells: string[][], h: ListHeader, today: DateStr): BoardExtract {
  const out = new Collector(today);
  for (let r = h.row + 1; r < cells.length; r += 1) {
    const row = cells[r]!;
    const desc = cellAt(row, h.descCol);
    if (desc === '') continue;
    const notes = h.noteCol >= 0 ? notesOf(cellAt(row, h.noteCol)) : null;
    const found = eventsOf(desc).map((e) => ({ title: e.title, details: withNotes(e.details, notes) }));
    out.add(cellAt(row, h.dateCol), found, oneLine(desc));
  }
  return { kind: 'rows', layout: 'list', rows: out.rows, skipped: out.skipped };
}

function readGrid(cells: string[][], h: GridHeader, today: DateStr, target: string): BoardExtract {
  const mine = h.classCols.filter((c) => sameClass(c.token, target) || sameClass(c.header, target));
  if (mine.length === 0) return { kind: 'columns', columns: [...new Set(h.classCols.map((c) => c.header))] };

  // In the order of the sheet, so that of two columns that say the same the first one's details are kept.
  // `after` is what a class column puts after a title, made once for the column and not for each event.
  const after = (suffix: string) => (suffix === '' ? '' : ` (${suffix})`);
  const taken = [...h.gradeCols.map((col) => ({ col, after: '' })), ...mine.map((c) => ({ col: c.col, after: after(c.suffix) }))].sort(
    (a, b) => a.col - b.col,
  );
  const out = new Collector(today);
  for (let r = h.row + 1; r < cells.length; r += 1) {
    const row = cells[r]!;
    const found: Found[] = [];
    const said: string[] = [];
    const saidSeen = new Set<string>();
    for (const { col, after: tail } of taken) {
      const text = cellAt(row, col);
      if (text === '') continue;
      const one = oneLine(text);
      if (!saidSeen.has(one)) {
        saidSeen.add(one);
        said.push(one);
      }
      for (const e of eventsOf(text)) {
        // The room for the suffix is kept, so a long title is cut and the suffix still tells the columns apart.
        const title = tail === '' ? e.title : cut(e.title, MAX_TITLE - tail.length).trimEnd() + tail;
        found.push({ title, details: e.details });
      }
    }
    out.add(cellAt(row, h.dateCol), found, said.join(' | '));
  }
  return { kind: 'rows', layout: 'grid', rows: out.rows, skipped: out.skipped };
}

/**
 * Reads a board. A grid with no column for the class (and none named in `opts.column`) answers with the names of
 * its class columns for the student to pick from. Anything that is neither a grid nor a list throws
 * `BoardError('unknown_layout')`, and a board of more than `MAX_ROWS` rows and skipped lines `BoardError('too_big')`.
 */
export function extractBoard(cells: string[][], opts: { className: string; today: DateStr; column?: string }): BoardExtract {
  const header = findHeader(cells);
  if (!header) throw new BoardError('unknown_layout');
  if (header.layout === 'list') return readList(cells, header, opts.today);
  const column = opts.column?.trim();
  return readGrid(cells, header, opts.today, column ? column : opts.className);
}
