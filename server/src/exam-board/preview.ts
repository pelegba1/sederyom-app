/**
 * What the exam board's preview finds (design doc, "שני צעדים"): a link or a file in, the exam schedule it holds
 * out, nothing saved. This is the one function the preview route calls; it joins the pieces that each have their
 * own limits (the link reader, the xlsx reader, the extractor) and adds the few that belong between them:
 *
 * - a file is the base64 of an xlsx. It is decoded strictly (a character outside the alphabet is refused, and
 *   the size it will have is counted from the text before a byte is made), its name is looked at for its
 *   extension and nothing else, and it is read in memory. Nothing is stored, logged or echoed;
 * - the grid the reader returns is counted before the extractor sees it (`MAX_GRID_CELLS`): a merge fills far
 *   more cells than the reader allows to be stored, and the extractor's work follows the grid;
 * - a link that leads to calendars is read calendar by calendar, all at once, and one that cannot be read is
 *   left out (a `BoardError`; any other failure is a bug and is not hidden); only when none can be read is the
 *   preview `unreachable`, or `too_big` when one of them gave more exams than a board holds (`CalendarTooBigError`).
 *
 * Every refusal is a `BoardError`; the route turns its code into the answer.
 */
import type { CalendarPreview, DateStr, ExamBoardPreview, ExamBoardPreviewBody } from '@sederyom/shared';
import { calendarExams, examCalendarIcsUrl, isCalendarTooBig } from '@sederyom/shared/logic/exam-board/calendar';
import { BoardError } from './errors';
import { extractBoard, MAX_TITLE } from './extract';
import { resolveLink, safeGet, type LinkDeps } from './link';
import { MAX_FILE_BYTES, readXlsx } from './xlsx';

/**
 * Cells with text in the grid the reader returns, past which the preview is `too_big`. The reader stores at most
 * 20,000 cells, but a merged cell shows its value in every cell of its range, so a grid can hold a great many
 * more than were stored.
 */
export const MAX_GRID_CELLS = 20_000;
/** The exams of a calendar shown to recognise it by. */
const UPCOMING = 5;
/** A calendar's name is its owner's choice; the phone shows a line of it. */
const MAX_CALENDAR_NAME = 100;

export interface PreviewContext {
  /** The name of the device's class, to find its columns in a grid. */
  className: string;
  today: DateStr;
  zone: string;
  link: LinkDeps;
  /** A public calendar's ICS by its id; rejects when it cannot be read. */
  fetchIcs(calendarId: string): Promise<string>;
}

export async function previewBoard(body: ExamBoardPreviewBody, ctx: PreviewContext): Promise<ExamBoardPreview> {
  let bytes: Uint8Array;
  if (body.file) {
    bytes = decodeFile(body.file);
  } else {
    const found = await resolveLink(body.link ?? '', ctx.link);
    if (found.kind === 'calendar') return previewCalendars(found.calendarIds, ctx);
    bytes = found.bytes;
  }

  const cells = readXlsx(bytes);
  let filled = 0;
  for (const row of cells) {
    for (const cell of row) if (cell !== '' && ++filled > MAX_GRID_CELLS) throw new BoardError('too_big');
  }
  return extractBoard(cells, { className: ctx.className, today: ctx.today, ...(body.column === undefined ? {} : { column: body.column }) });
}

// ---- a file -------------------------------------------------------------------------------------------

/** Standard base64, with no line breaks, spaces or other characters, and its padding (if any) last. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const XLSX_NAME = /\.xlsx$/i;

/**
 * The bytes of an xlsx file from its name and its base64. `unsupported_file` for another extension or text
 * that is not base64, `too_big` for a file that would be over 1MB; the size is counted from the text, so a
 * file that is too big is never made. The name is used for its extension only.
 */
function decodeFile(file: { name: string; base64: string }): Uint8Array {
  if (!XLSX_NAME.test(file.name)) throw new BoardError('unsupported_file');
  const text = file.base64;
  if (!BASE64.test(text)) throw new BoardError('unsupported_file');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const digits = text.length - padding;
  // a padded text is a whole number of groups of four; one digit left over decodes to nothing
  if (digits % 4 === 1 || (padding > 0 && text.length % 4 !== 0)) throw new BoardError('unsupported_file');
  if (Math.floor((digits * 3) / 4) > MAX_FILE_BYTES) throw new BoardError('too_big');
  return Buffer.from(text, 'base64');
}

// ---- calendars ----------------------------------------------------------------------------------------

async function previewCalendars(ids: string[], ctx: PreviewContext): Promise<ExamBoardPreview> {
  // at once: ten calendars one after the other would not fit the route's time
  const read = await Promise.allSettled(ids.map((id) => previewCalendar(id, ctx)));
  const calendars: CalendarPreview[] = [];
  let tooBig = false;
  for (const r of read) {
    if (r.status === 'fulfilled') calendars.push(r.value);
    // A calendar of more exams than a board holds is left out, and is what the answer says when it was the only one.
    else if (isCalendarTooBig(r.reason)) tooBig = true;
    // A calendar that could not be read (a `BoardError`) is left out. Anything else is a bug in reading it, and
    // is not hidden as a calendar that quietly goes missing: it goes up to the route, which logs its name.
    else if (!(r.reason instanceof BoardError)) throw r.reason;
  }
  if (calendars.length === 0) throw new BoardError(tooBig ? 'too_big' : 'unreachable');
  return { kind: 'calendar', calendars };
}

type Upcoming = { date: DateStr; subject: string };

/** Whether `a` comes before `b` among the exams ahead: by day, then by title. */
const sooner = (a: Upcoming, b: Upcoming): boolean => (a.date === b.date ? a.subject < b.subject : a.date < b.date);

async function previewCalendar(calendarId: string, ctx: PreviewContext): Promise<CalendarPreview> {
  const { name, exams } = calendarExams(await ctx.fetchIcs(calendarId), ctx.today, ctx.zone);
  // The first `UPCOMING` from today on, in one pass and never more than that many held: the feed lists them in the
  // calendar's order, and the whole list is not sorted for five of it.
  const ahead: Upcoming[] = [];
  for (const e of exams) {
    if (e.date === null || e.date < ctx.today) continue;
    const exam = { date: e.date, subject: e.subject };
    if (ahead.length === UPCOMING && !sooner(exam, ahead[UPCOMING - 1]!)) continue;
    let at = ahead.length;
    while (at > 0 && sooner(exam, ahead[at - 1]!)) at -= 1;
    ahead.splice(at, 0, exam);
    if (ahead.length > UPCOMING) ahead.pop();
  }
  return {
    calendarId,
    name: name === null ? null : clip(name, MAX_CALENDAR_NAME),
    count: exams.length,
    // what goes back to the phone is cut: a stranger's title may be of any length
    upcoming: ahead.map((e) => ({ date: e.date, subject: clip(e.subject, MAX_TITLE) })),
  };
}

/** A calendar is a stranger's text of any length; what goes back to a phone is cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // not half of a character outside the BMP
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * The real `fetchIcs`: a public Google calendar's feed from its fixed address, through the link reader's own
 * `safeGet` (https only, a public address, 10 seconds, 2MB, at most 3 redirects). What comes back has to be an
 * iCalendar feed, as it has to be for the hourly read.
 */
export function icsFetcher(link: LinkDeps): (calendarId: string) => Promise<string> {
  return async (calendarId) => {
    const got = await safeGet(examCalendarIcsUrl(calendarId), link);
    const text = new TextDecoder('utf-8').decode(got.bytes);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new BoardError('unreachable');
    return text;
  };
}
