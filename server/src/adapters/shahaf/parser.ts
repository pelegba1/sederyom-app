/**
 * Parsers for the Shahaf timetable sites, `<school>.shahaf.site` (design-doc §6.1).
 *
 * Structure notes captured from the live site on 2026-08-28 (Spike 2):
 *   - class picker: `select[name=cls] > option[value]`  (יב2 = "36" — read the value, never the position)
 *   - timetable:    `table.TTTable`, header `td.CTitle[data-day]`, row label `td.CName`
 *                   (period number + two `span.hour-time`), cells `td.TTCell[data-day]`
 *   - change kinds are carried as cell classes: TableFreeChange / TableFillChange /
 *     TableRemoteChange / TableExamChange / TableEventChange (from the site stylesheet)
 *   - list tabs render `.EmptyList` when empty, `.ChangesDate` / `.ChangesInfo` / `.MsgCell` when not
 *   - every page ends with `.UpdateDate` — "מעודכן ל: DD.MM.YYYY, שעה: HH:mm"
 *
 * Verified against live data on 2026-09-01, the first school day
 * (`fixtures/shahaf/live-2026-09-01/`, covered by `test/shahaf-live.test.ts`).
 * What real data corrected, none of which the synthetic fixtures could have
 * caught:
 *   - a normal cell is `<b>subject</b><br/>teacher`; a *changed* cell often has
 *     no `.TTLesson` at all and describes the lesson inside the change text as
 *     `<verb> <subject>, <teacher>[ לשעה N]`
 *   - the school paints a moved lesson `TableFillChange` — the substitute
 *     colour — so the written verb outranks the class
 *   - `tab=changes` is a flat `li.ChangesInfo` list with the date inside each
 *     line, not a `.ChangesDate` heading with rows beneath it
 *
 * Checked against seven other schools' sites on 2026-10-28 (ideas ל2):
 *   - `tab=exams` and `tab=events` are the same flat list, the title in bold:
 *     `04.11.2026, <b>מבחן בתנ"ך שכבה י"א</b> משיעור 5 עד שיעור 6 לכיתות: …`.
 *     The fixtures of the first school had none, so the list parser had only
 *     ever met an empty page, and read every real one as empty.
 *   - one exam is one line per group, the title the same on each
 *   - a substitute is written "מילוי מקום", and a lesson that ends the day
 *     early "הביתה"
 *   - one site answers `tab=messages` with its timetable page
 *
 * Two more on 2026-11-04 (`fixtures/shahaf/school-b-2026-11-04/`):
 *   - a change can be an arrow from the teacher whose lesson it is, with no
 *     subject: `נקש מלכה <- פרנקו יונתן חדר אמנות מלכה` is a substitute,
 *     `אשכול יהודית -> חדר: מעבדת מחשבים 4` a new room (`parseArrowChange`)
 *   - the change can come *before* the `.TTLesson` blocks in the cell, and the
 *     group it changes has none: only `tab=timetable` still names its subject
 *
 * Still unverified, because none of the eight schools had any by then:
 * TODO(verify-live) general messages.
 */
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ClassOption, DateStr, LessonStatus, ScheduleChange } from '@sederyom/shared';
import { addDays, parseDateStr } from '../../lib/time.js';
import { subjectKey, subjectsMatch } from '../../lib/subjects.js';

export interface ParsedLesson {
  date: DateStr;
  hourIndex: number;
  startTime: string | null;
  endTime: string | null;
  subject: string;
  teacher: string | null;
  room: string | null;
  status: LessonStatus;
  substitute: string | null;
  note: string | null;
}

export interface ParsedTimetable {
  /** Sunday..Friday dates of the rendered week, resolved to full ISO dates. */
  days: DateStr[];
  lessons: ParsedLesson[];
  freshness: Date | null;
  /**
   * Arrow changes whose lesson neither the cell nor the regular week named:
   * read as "השיעור של <teacher>". The adapter fetches `tab=timetable` when
   * there are any and parses again.
   */
  unresolvedArrows: number;
}

export interface ParsedListItem {
  naturalKey: string;
  date: DateStr | null;
  title: string;
  details: string | null;
}

const CHANGE_CLASS_TO_STATUS: Record<string, LessonStatus> = {
  TableFreeChange: 'cancelled',
  TableFillChange: 'substitution',
  TableRemoteChange: 'remote',
  TableExamChange: 'exam',
  TableEventChange: 'event',
};

const RE_SUBSTITUTE = /(?:ממלא\s*מקום|מילוי\s*מקום|מחליף[הא]?|מ["״'׳]?מ)\s*[:־-]?\s*(.+)/;

/**
 * The verb the school writes is more reliable than the colour it paints.
 *
 * Confirmed on the first real school day: a *moved* lesson is published as
 * `TableFillChange`, the same lime class used for a substitute teacher. Reading
 * the class alone reports "מ״מ" for a lesson that simply changed hour. The verb
 * therefore wins, and the class is only consulted when no verb is present.
 */
const VERBS: [RegExp, ScheduleChange['kind']][] = [
  // "הביתה": the class goes home, so the lesson is not held (2026-10-28).
  [/ביטול|מבוטל|בוטל|שוחרר|חופשי|הביתה/, 'cancelled'],
  [/הזזת|הזזה|הועבר|העברה|נדחה|מוקדם/, 'moved'],
  [/ממלא\s*מקום|מילוי\s*מקום|מחליף|מ["״'׳]מ/, 'substitution'],
  [/מרחוק|זום/, 'remote'],
  [/מבחן|בוחן/, 'exam'],
  [/אירוע|טיול|טקס/, 'event'],
];

function verbOf(text: string): ScheduleChange['kind'] | null {
  for (const [re, kind] of VERBS) if (re.test(text)) return kind;
  return null;
}

/** Leading verb, so it can be stripped before subject/teacher are read. */
const RE_LEADING_VERB = /^\s*(ביטול|הזזת|הזזה|הועבר|מ["״'׳]מ|ממלא\s*מקום)\s*:?\s*/;
/** "… לשעה 4" / "… לשיעור 4" — where a moved lesson lands. */
const RE_TARGET_HOUR = /\s*ל(?:שעה|שיעור)\s*(\d{1,2})\s*$/;

export interface ParsedChangeCell {
  kind: ScheduleChange['kind'];
  subject: string | null;
  teacher: string | null;
  targetHour: number | null;
}

/**
 * A cell holding only a change carries no `.TTLesson`; the whole lesson is
 * described inside the change text as `<verb> <subject>, <teacher>`, optionally
 * followed by `לשעה N`. Without splitting it, the entire sentence ends up in
 * the subject field and the UI shows "ביטול אנגלית 5 יח״ל, נקש ירדנה" as a
 * lesson name.
 */
export function parseChangeCellText(text: string, classAttr = ''): ParsedChangeCell {
  const kind = verbOf(text) ?? kindFromClasses(classAttr) ?? 'other';
  let rest = text.replace(RE_LEADING_VERB, '');

  let targetHour: number | null = null;
  const target = RE_TARGET_HOUR.exec(rest);
  if (target) {
    targetHour = Number(target[1]);
    rest = rest.slice(0, target.index);
  }

  const comma = rest.indexOf(',');
  const subject = collapse(comma >= 0 ? rest.slice(0, comma) : rest) || null;
  const teacher = comma >= 0 ? collapse(rest.slice(comma + 1)) || null : null;
  return { kind, subject, teacher, targetHour };
}

export interface ArrowChange {
  /** Whose lesson it is. */
  teacher: string;
  /** Who gives it instead; null when only the room changed. */
  substitute: string | null;
  room: string | null;
}

const RE_ARROW = /^(.+?)\s*(?:<-|->|←|→)\s*(.*)$/;
/** Where a room begins after the substitute's name: "חדר אמנות מלכה", "מעבדה 2", "אולם ספורט". */
const RE_ROOM_START = /(?:^|\s)(?=(?:חדר|מעבדה|מעבדת|אולם|כיתה)(?:\s|:|$))/;
/** A class's own room, alone at the end: "ז5", "יא6", "י״ב 2". */
const RE_CLASS_ROOM = /\s+([א-ת]{1,2}["״'׳]?[א-ת]?\s?\d{1,2})$/;

/**
 * `<teacher> <- <substitute> <room>` or `<teacher> -> חדר: <room>`, the two
 * arrows read on the sites so far (see the file note). The arrow points either
 * way; what follows says which change it is. `knownRoom`, when the lesson's
 * room is known, is what splits it from the substitute's name.
 */
export function parseArrowChange(text: string, knownRoom: string | null = null): ArrowChange | null {
  const m = RE_ARROW.exec(collapse(text));
  if (!m) return null;
  const teacher = collapse(m[1]!);
  let right = collapse(m[2]!);
  if (!teacher) return null;

  const roomOnly = /^חדר\s*:\s*(.*)$/.exec(right);
  if (roomOnly) return { teacher, substitute: null, room: collapse(roomOnly[1]!) || null };

  let room: string | null = null;
  if (knownRoom && right.endsWith(knownRoom) && right.length > knownRoom.length) {
    room = knownRoom;
    right = right.slice(0, -knownRoom.length);
  } else {
    const start = RE_ROOM_START.exec(right);
    const tail = RE_CLASS_ROOM.exec(right);
    if (start) {
      room = right.slice(start.index);
      right = right.slice(0, start.index);
    } else if (tail) {
      room = tail[1]!;
      right = right.slice(0, tail.index);
    }
  }
  room = room ? collapse(room.replace(/^חדר\s*:\s*/, '')) || null : null;
  return { teacher, substitute: collapse(right) || null, room };
}

export function parseClassOptions(html: string): ClassOption[] {
  const $ = cheerio.load(html);
  const options: ClassOption[] = [];
  $('select[name="cls"] option').each((_i, el) => {
    const id = $(el).attr('value')?.trim();
    const name = collapse($(el).text());
    if (id && name) options.push({ id, name });
  });
  return options;
}

/** Parses "מעודכן ל: 11.08.2026, שעה: 22:52" from the page footer. */
export function parseFreshness(html: string, zone?: string): Date | null {
  const $ = cheerio.load(html);
  const text = collapse($('.UpdateDate').first().text());
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})\D+(\d{1,2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [, d, mo, y, h, min] = m;
  const dt = parseDateStr(`${y}-${pad(mo!)}-${pad(d!)}`, zone).set({
    hour: Number(h),
    minute: Number(min),
  });
  return dt.isValid ? dt.toJSDate() : null;
}

/**
 * Parses `tab=changestable` (or `tab=timetable`, same markup).
 * `anchorSunday` is the Sunday we asked for; header cells only carry DD.MM, so the
 * year comes from the anchor and a mismatch is reported rather than guessed.
 */
export function parseTimetable(
  html: string,
  anchorSunday: DateStr,
  opts: {
    zone?: string;
    onWarn?: (msg: string) => void;
    /**
     * The class's regular week (`tab=timetable`, parsed): where a change has
     * dropped the lesson it changes, the only place its subject is still
     * written. Matched by weekday, so any week's grid serves every week.
     */
    regular?: readonly ParsedLesson[];
  } = {},
): ParsedTimetable {
  const $ = cheerio.load(html);
  const table = $('table.TTTable').first();
  const freshness = parseFreshness(html, opts.zone);
  if (table.length === 0) {
    opts.onWarn?.('no table.TTTable on page');
    return { days: [], lessons: [], freshness, unresolvedArrows: 0 };
  }
  const regularByWeekday = new Map<number, ParsedLesson[]>();
  for (const lesson of opts.regular ?? []) {
    const day = weekdayOf(lesson.date);
    regularByWeekday.set(day, [...(regularByWeekday.get(day) ?? []), lesson]);
  }
  const counts = { unresolvedArrows: 0 };

  const days: DateStr[] = [];
  table.find('td.CTitle[data-day]').each((_i, el) => {
    const dayIndex = Number($(el).attr('data-day'));
    if (!Number.isInteger(dayIndex)) return;
    const expected = addDays(anchorSunday, dayIndex, opts.zone);
    days[dayIndex] = reconcileHeaderDate(collapse($(el).text()), expected, opts.zone, opts.onWarn);
  });
  if (days.length === 0) opts.onWarn?.('TTTable has no CTitle header cells');

  const lessons: ParsedLesson[] = [];
  table.find('tr').each((_i, row) => {
    const label = $(row).find('td.CName').first();
    if (label.length === 0) return;
    const slot = parseHourLabel($, label[0]!);
    if (slot === null) return;

    $(row)
      .find('td.TTCell[data-day]')
      .each((_j, cell) => {
        const dayIndex = Number($(cell).attr('data-day'));
        const date = days[dayIndex];
        if (!date) return;
        const regularDay = regularByWeekday.get(weekdayOf(date)) ?? [];
        for (const parsed of parseCell($, cell, date, slot, regularDay, counts)) lessons.push(parsed);
      });
  });

  return { days: days.filter(Boolean), lessons, freshness, unresolvedArrows: counts.unresolvedArrows };
}

/** 0 = Sunday. A calendar date has one weekday wherever it is read. */
function weekdayOf(date: DateStr): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

interface HourSlot {
  hourIndex: number;
  startTime: string | null;
  endTime: string | null;
}

function parseHourLabel($: cheerio.CheerioAPI, el: AnyNode): HourSlot | null {
  const node = $(el);
  const times = node
    .find('span.hour-time')
    .map((_i, s) => collapse($(s).text()))
    .get()
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t));
  const label = collapse(node.clone().find('span.hour-time').remove().end().text());
  const m = /(\d+)/.exec(label);
  if (!m) return null;
  return {
    hourIndex: Number(m[1]),
    startTime: times[0] ?? null,
    endTime: times[1] ?? null,
  };
}

function parseCell(
  $: cheerio.CheerioAPI,
  cell: AnyNode,
  date: DateStr,
  slot: HourSlot,
  regularDay: readonly ParsedLesson[],
  counts: { unresolvedArrows: number },
): ParsedLesson[] {
  const node = $(cell);
  if (collapse(node.text()) === '') return [];

  const blocks = node.find('.TTLesson, .TTChange');
  const out: ParsedLesson[] = [];

  if (blocks.length === 0) {
    // Cell holds bare text (older markup) — treat the whole cell as one lesson.
    const lesson = lessonFromLines(textLines($, cell), date, slot, 'regular', null);
    if (lesson) out.push(lesson);
    return out;
  }

  // One cell can hold several `.TTLesson` blocks: the class grid stacks the
  // parallel groups of one period on top of each other — two history teachers,
  // chemistry beside physics, two network-services groups. Every block is a
  // lesson of its own; keeping only the first silently dropped whichever group
  // the site happened to print second, which for this student was physics.
  //
  // A `.TTChange` under them belongs to the group it names. Folded onto the
  // wrong one, a cancellation of the other group cancels the lesson the
  // student actually has.
  //
  // The order is meaningful: a change printed above the lessons is about a
  // group the cell no longer lists (two schools' fixtures, `shahaf-schools`),
  // so it is matched only against the lessons above it. An arrow names its
  // teacher exactly and is matched by that alone, after the whole cell is read.
  const bases: ParsedLesson[] = [];
  const arrows: string[] = [];
  blocks.each((_i, block) => {
    const isChange = $(block).hasClass('TTChange');
    const lines = isChange ? textLines($, block) : lessonLines($, block);
    if (!isChange) {
      const lesson = lessonFromLines(lines, date, slot, 'regular', null);
      if (lesson) bases.push(lesson);
      return;
    }
    const changeText = lines.join(' · ');
    if (RE_ARROW.test(changeText)) {
      arrows.push(changeText);
      return;
    }
    const classAttr = `${$(block).attr('class') ?? ''} ${$(cell).attr('class') ?? ''}`;
    const parsed = parseChangeCellText(changeText, classAttr);

    const target = changeTarget(bases, parsed);
    if (target) {
      target.status = kindToStatus(parsed.kind);
      target.note = changeText || target.note;
      if (target.status === 'substitution') target.substitute = extractSubstitute(lines) ?? target.substitute;
      return;
    }

    // No base lesson to attach to: the change text *is* the lesson description.
    if (!parsed.subject) return;

    const leaving = parsed.targetHour !== null && parsed.targetHour !== slot.hourIndex;
    out.push({
      date,
      hourIndex: slot.hourIndex,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subject: parsed.subject,
      teacher: parsed.teacher,
      room: null,
      status: kindToStatus(parsed.kind),
      substitute: parsed.kind === 'substitution' ? parsed.teacher : null,
      // Only worth saying when it adds something the status does not: where the
      // lesson went. In the slot it moved *into*, the hour is already correct.
      note: leaving ? `הועבר לשעה ${parsed.targetHour}` : null,
    });
  });
  for (const text of arrows) {
    const added = applyArrowChange(text, bases, regularDay, date, slot, counts);
    if (added) out.push(added);
  }
  return [...bases, ...out];
}

/**
 * An arrow change (`parseArrowChange`) applied to the lesson of the teacher it
 * names: the cell's own when it still lists it, else the regular week's at
 * that hour (or that day's nearest, for a period the regular week lacks). That
 * lesson keeps its subject and teacher, so it keeps its identity, and gets the
 * substitute and the new room. Returns the lesson to add when it is not one of
 * the cell's. With neither, it is named after the teacher, never the sentence.
 */
function applyArrowChange(
  text: string,
  bases: ParsedLesson[],
  regularDay: readonly ParsedLesson[],
  date: DateStr,
  slot: HourSlot,
  counts: { unresolvedArrows: number },
): ParsedLesson | null {
  const named = parseArrowChange(text);
  if (!named) return null;
  const key = subjectKey(named.teacher);
  const theirs = (l: ParsedLesson) => l.teacher !== null && subjectKey(l.teacher) === key;

  const base = bases.find(theirs) ?? null;
  const regular = base
    ? null
    : (regularDay
        .filter(theirs)
        .sort((a, b) => Math.abs(a.hourIndex - slot.hourIndex) - Math.abs(b.hourIndex - slot.hourIndex))[0] ?? null);
  const known = base ?? regular;
  if (!known) counts.unresolvedArrows += 1;

  const place = known ? (known.room ?? placeOf(known.subject)) : null;
  const change = parseArrowChange(text, place)!;
  const lesson: ParsedLesson = base ?? {
    date,
    hourIndex: slot.hourIndex,
    startTime: slot.startTime,
    endTime: slot.endTime,
    subject: regular?.subject ?? `השיעור של ${change.teacher}`,
    teacher: regular?.teacher ?? change.teacher,
    room: regular?.room ?? null,
    status: 'regular',
    substitute: null,
    note: null,
  };
  if (change.substitute) {
    lesson.status = 'substitution';
    lesson.substitute = change.substitute;
  }
  if (change.room && change.room !== place) lesson.room = change.room;
  return base ? null : lesson;
}

/** The group's place printed after the subject: "אמנות (חדר אמנות מלכה)" → "חדר אמנות מלכה". */
function placeOf(subject: string): string | null {
  return /\(([^()]+)\)\s*$/.exec(subject)?.[1]?.trim() || null;
}

/**
 * Which of a cell's lessons a change describes.
 *
 * The teacher decides first, and exactly: two groups of one subject differ
 * only by teacher, and the fuzzy `teachersMatch` would call "מורה א" and
 * "מורה ב" the same person. The subject is consulted only when it singles out
 * one group. A cell with a single lesson keeps the old behaviour — whatever
 * the change says ("השיעור מבוטל", "מ״מ: כהן"), it is about that lesson.
 */
function changeTarget(bases: ParsedLesson[], change: ParsedChangeCell): ParsedLesson | null {
  if (bases.length === 0) return null;
  if (change.teacher) {
    const key = subjectKey(change.teacher);
    const byTeacher = bases.filter((b) => b.teacher !== null && subjectKey(b.teacher) === key);
    if (byTeacher.length === 1) return byTeacher[0]!;
  }
  if (change.subject) {
    const subject = change.subject;
    const bySubject = bases.filter((b) => subjectsMatch(b.subject, subject));
    if (bySubject.length === 1) return bySubject[0]!;
  }
  return bases.length === 1 ? bases[0]! : null;
}

function statusFromClasses(...classAttrs: string[]): LessonStatus {
  for (const attr of classAttrs) {
    for (const cls of attr.split(/\s+/)) {
      const mapped = CHANGE_CLASS_TO_STATUS[cls];
      if (mapped) return mapped;
    }
  }
  return 'moved';
}

function kindToStatus(kind: ScheduleChange['kind']): LessonStatus {
  return kind === 'other' ? 'moved' : kind;
}

/** Null when the colour says nothing — the caller decides what that means. */
function kindFromClasses(classAttr: string): ScheduleChange['kind'] | null {
  for (const cls of classAttr.split(/\s+/)) {
    const mapped = CHANGE_CLASS_TO_STATUS[cls];
    if (mapped && mapped !== 'regular') return mapped as ScheduleChange['kind'];
  }
  return null;
}

function lessonFromLines(
  lines: string[],
  date: DateStr,
  slot: HourSlot,
  status: LessonStatus,
  note: string | null,
): ParsedLesson | null {
  const [subject, teacher, ...rest] = lines;
  if (!subject) return null;
  return {
    date,
    hourIndex: slot.hourIndex,
    startTime: slot.startTime,
    endTime: slot.endTime,
    subject,
    teacher: teacher ?? null,
    room: rest.find((r) => /חדר|כיתה|מעבדה|אולם/.test(r)) ?? rest[0] ?? null,
    status,
    substitute: null,
    note,
  };
}

/** "מ״מ: כהן" / "ממלא מקום כהן" → "כהן". */
function extractSubstitute(lines: string[]): string | null {
  for (const line of lines) {
    const m = RE_SUBSTITUTE.exec(line);
    if (m?.[1]) return collapse(m[1]);
  }
  return null;
}

/** Parses `tab=changes` — the flat list of published changes. */
/**
 * Parses `tab=changes`.
 *
 * The real markup, confirmed 2026-09-01, is a flat list — one `li.ChangesInfo`
 * per change, carrying everything in a single comma-separated line:
 *
 *   `02.09.2026, שיעור 1, נקש ירדנה, ביטול שעור`
 *   `02.09.2026, שיעור 7, הזזת שיעור : שחם בועז, כישורי חיים לשיעור 4`
 *
 * There is no `.ChangesDate` element grouping them, which the previous parser
 * assumed; it walked siblings of a node that does not exist and always returned
 * nothing, on a tab that was not empty.
 */
export function parseChanges(html: string, opts: { zone?: string; year?: number } = {}): ScheduleChange[] {
  const $ = cheerio.load(html);
  if (isEmptyList($)) return [];
  const out: ScheduleChange[] = [];

  $('li.ChangesInfo, .ChangesInfo').each((_i, el) => {
    const text = collapse($(el).text());
    if (!text) return;
    // Each item carries its own date in the flat shape. When it does not, this
    // is the grouped shape and the heading below owns the date instead.
    const date = parseLooseDate(text, opts);
    if (!date) return;
    out.push(makeChange(date, text, $(el).attr('class') ?? ''));
  });

  if (out.length === 0) {
    // Grouped variant: a date heading followed by its rows.
    $('.ChangesDate').each((_i, el) => {
      const date = parseLooseDate(collapse($(el).text()), opts);
      let cursor = $(el).next();
      while (cursor.length > 0 && !cursor.hasClass('ChangesDate')) {
        const text = collapse(cursor.text());
        if (text) out.push(makeChange(date, text, cursor.attr('class') ?? ''));
        cursor = cursor.next();
      }
    });
  }

  if (out.length === 0) {
    // Table-shaped variant: one row per change, first cell the date.
    $('table tr').each((_i, row) => {
      const cells = $(row).find('td').map((_j, c) => collapse($(c).text())).get();
      if (cells.length < 2) return;
      const date = parseLooseDate(cells[0]!, opts);
      if (!date) return;
      out.push(makeChange(date, cells.slice(1).filter(Boolean).join(' · '), $(row).attr('class') ?? ''));
    });
  }
  return out;
}

function makeChange(date: DateStr | null, text: string, classAttr: string): ScheduleChange {
  const hourIndex = extractHourIndex(text);
  return {
    naturalKey: `change|${date ?? 'unknown'}|${hourIndex ?? '-'}|${text}`,
    date: date ?? '',
    hourIndex,
    kind: changeKindOf(text, classAttr),
    subject: null,
    text,
  };
}

/** Verb first, colour second — see the note on VERBS. */
function changeKindOf(text: string, classAttr: string): ScheduleChange['kind'] {
  return verbOf(text) ?? kindFromClasses(classAttr) ?? 'other';
}

function extractHourIndex(text: string): number | null {
  // The *first* "שיעור N" is the slot the change applies to; a "לשיעור M"
  // suffix names where a moved lesson lands and must not be read as the slot.
  const m = /שיעור\s*(\d{1,2})/.exec(text);
  return m ? Number(m[1]) : null;
}

/** Parses `tab=exams` / `tab=events` — same list shape, different semantics. */
export function parseDatedList(
  html: string,
  prefix: string,
  opts: { zone?: string; year?: number } = {},
): ParsedListItem[] {
  const $ = cheerio.load(html);
  if (isEmptyList($) || isTimetablePage($)) return [];
  const out: ParsedListItem[] = [];

  // The real shape (2026-10-28, seven schools): the changes tab's flat list, the date leading
  // each line and the title in bold. An exam a grade sits in groups is a line per group, the
  // title the same on each: one item, its groups' details a line each.
  const byKey = new Map<string, ParsedListItem>();
  $('li.ChangesInfo, .ChangesInfo').each((_i, el) => {
    const text = collapse($(el).text());
    const date = parseLooseDate(text, opts);
    if (!date) return;
    const bold = collapse($(el).find('b').first().text());
    const title = bold || collapse(text.replace(RE_LEADING_DATE, ''));
    if (!title) return;
    const after = bold ? text.slice(text.indexOf(bold) + bold.length) : '';
    const details = collapse(after.replace(/^[\s,·:]+/, '')) || null;
    const naturalKey = `${prefix}|${date}|${title}`;
    const known = byKey.get(naturalKey);
    if (known) {
      if (details && !(known.details ?? '').split('\n').includes(details)) known.details = known.details ? `${known.details}\n${details}` : details;
      return;
    }
    const item: ParsedListItem = { naturalKey, date, title, details };
    byKey.set(naturalKey, item);
    out.push(item);
  });
  if (out.length > 0) return out;

  $('table tr').each((_i, row) => {
    const cells = $(row).find('td').map((_j, c) => collapse($(c).text())).get().filter(Boolean);
    if (cells.length === 0) return;
    const date = parseLooseDate(cells[0]!, opts);
    if (!date) return;
    const title = cells[1] ?? '';
    const details = cells.slice(2).join(' · ') || null;
    out.push({ naturalKey: `${prefix}|${date}|${title}`, date, title, details });
  });

  if (out.length === 0) {
    $('.ChangesDate').each((_i, el) => {
      const date = parseLooseDate(collapse($(el).text()), opts);
      const body = collapse($(el).next().text());
      if (!date || !body) return;
      out.push({ naturalKey: `${prefix}|${date}|${body}`, date, title: body, details: null });
    });
  }
  return out;
}

/** Parses `tab=messages` — general school messages, often undated. */
export function parseMessages(html: string, opts: { zone?: string; year?: number } = {}): ParsedListItem[] {
  const $ = cheerio.load(html);
  // One site answers the messages tab with its timetable (2026-10-28): its rows are no messages.
  if (isEmptyList($) || isTimetablePage($)) return [];
  const out: ParsedListItem[] = [];
  $('.MsgCell').each((_i, el) => {
    const text = collapse($(el).text());
    if (!text) return;
    const date = parseLooseDate(collapse($(el).prev('.ChangesDate').text()), opts);
    out.push({ naturalKey: `shahaf-msg|${date ?? ''}|${text.slice(0, 120)}`, date, title: firstLine(text), details: text });
  });
  if (out.length === 0) {
    $('table tr').each((_i, row) => {
      const cells = $(row).find('td').map((_j, c) => collapse($(c).text())).get().filter(Boolean);
      if (cells.length === 0) return;
      const text = cells.join(' · ');
      out.push({ naturalKey: `shahaf-msg|${text.slice(0, 120)}`, date: null, title: firstLine(cells[0]!), details: text });
    });
  }
  return out;
}

export function isEmptyList($: cheerio.CheerioAPI): boolean {
  return $('.EmptyList').length > 0;
}

/** A list tab answered with the timetable's grid instead: nothing on it is a list item. */
function isTimetablePage($: cheerio.CheerioAPI): boolean {
  return $('table.TTTable').length > 0;
}

/** The date a list line starts with, and the comma after it: "04.11.2026, ". */
const RE_LEADING_DATE = /^\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s*,?\s*/;

/** Accepts "30.08", "30.08.2026", "30/08/26" and Hebrew-prefixed variants. */
export function parseLooseDate(
  text: string,
  opts: { zone?: string; year?: number } = {},
): DateStr | null {
  const m = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : (opts.year ?? new Date().getFullYear());
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(String(month))}-${pad(String(day))}`;
}

function reconcileHeaderDate(
  headerText: string,
  expected: DateStr,
  zone: string | undefined,
  onWarn?: (msg: string) => void,
): DateStr {
  const m = /(\d{1,2})\.(\d{1,2})/.exec(headerText);
  if (!m) return expected;
  const exp = parseDateStr(expected, zone);
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (exp.day === day && exp.month === month) return expected;
  // Header disagrees with the week we asked for: trust the header, keep the
  // year from the expected date but roll it if the month wrapped.
  let year = exp.year;
  if (exp.month === 12 && month === 1) year += 1;
  if (exp.month === 1 && month === 12) year -= 1;
  const resolved = `${year}-${pad(String(month))}-${pad(String(day))}`;
  onWarn?.(`timetable header "${headerText}" != expected ${expected}; using ${resolved}`);
  return resolved;
}

function textLines($: cheerio.CheerioAPI, el: AnyNode): string[] {
  const html = $(el).html() ?? '';
  return html
    .split(/<br\s*\/?>/i)
    .map((chunk) => collapse(cheerio.load(`<div>${chunk}</div>`)('div').text()))
    .filter(Boolean);
}

/**
 * A `.TTLesson` as `[subject, teacher]`. Until 4.11.2026 the site broke the
 * line before the teacher — `<b>אזרחות</b>&nbsp;&nbsp;(יב2)<br/>נחמיאס משה` —
 * and since then it does not: `<b>אזרחות</b>&nbsp;&nbsp;(יב2)נחמיאס משה`, or
 * `<b>חינוך גופני</b>ברגמן עומר` with no group. Read as one line, the teacher
 * joins the subject and every lesson gets a new natural key, which the delta
 * reads as the whole timetable deleted. So the bold subject and the bracketed
 * group after it are the subject, as they were, and whatever follows is the teacher.
 */
function lessonLines($: cheerio.CheerioAPI, block: AnyNode): string[] {
  const lines = textLines($, block);
  const bold = $(block).children('b').first();
  if (lines.length !== 1 || bold.length === 0) return lines;
  const head = collapse(bold.text());
  if (!head || !lines[0]!.startsWith(head)) return lines;
  const tail = collapse(lines[0]!.slice(head.length));
  const group = /^\([^)]*\)/.exec(tail)?.[0] ?? '';
  const teacher = collapse(tail.slice(group.length));
  const subject = collapse(`${head} ${group}`);
  return teacher ? [subject, teacher] : [subject];
}

function firstLine(text: string): string {
  return text.split(/[.·\n]/)[0]!.trim() || text;
}

function collapse(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function pad(v: string): string {
  return v.padStart(2, '0');
}
