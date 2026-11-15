/**
 * The phone's own exam board (design doc, "לוח משלי, כשלכיתה כבר יש לוח"; app/src/local/ownBoard.ts): kept on the
 * phone only, laid over the class's feed wherever the phone reads exams, read from a Google calendar by the phone
 * itself, and kept per child on a parent's phone.
 *
 * What cannot run here: the refresh and the stored sources (app/src/local/source.ts) need the phone's storage. Their
 * wiring is checked by reading the source at the end of this file, and on a phone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BagrutExam, ClassExam, ClassFeed, SaveExamBoardBody, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import { calendarExams, examCalendarIcsUrl } from '@sederyom/shared/logic/exam-board/calendar';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { splitSiteTwins } from '@sederyom/shared/logic/exam-match';
import { bagrutKey } from '@sederyom/shared/logic/mashov/bagrut';
import { calendarOptions } from '@sederyom/shared/logic/options';
import { buildLocalDays, deviceCalendars, examCalendarIds, localExamsFrom } from '../../app/src/local/days';
import { boardOwner } from '../../app/src/lib/examBoard';
import { addManualExam, readManualExams } from '../../app/src/local/manualExams';
import {
  OWN_BOARD_KEY, OWN_BOARD_READ_FAILED, OWN_BOARD_TRIED_KEY, OWN_CALENDAR_EVERY_MS, OWN_CALENDAR_LIMIT_MS, OWN_CALENDAR_MAX_CHARS, OWN_ROWS_MAX, OwnCalendarUnreadError,
  dropNoneOverNoBoard, dropOwnBoardOnClassChange, keepOwnCalendar, keepOwnCalendarRead, keepOwnRows, keepWithoutClassBoard,
  readOwnBoard, refreshOwnBoard, refreshOwnBoardRead, removeOwnBoard, withOwnBoard, type OwnBoard,
} from '../../app/src/local/ownBoard';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { CHILD_KEYS, addChild, childFeed, removeChild, stashKey, stashedChild, switchChild, syncShownChild } = await import('../../app/src/local/children');
const { DEVICE_KEYS } = await import('../../app/src/device/v2');

const ZONE = 'Asia/Jerusalem';
const SITE = 'https://school.shahaf.site';
const CLASS_CAL = 'class-board@group.calendar.google.com';
const OWN_CAL = 'my-own-board@group.calendar.google.com';
const ICS = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'school-site', 'exams-yb.ics'), 'utf8');
// Inside the school year 2025-26, which the fixture's calendar has exams in.
const TODAY = '2026-02-01';
const NOW = new Date('2026-02-01T08:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}

const shahaf = (date: string, subject: string): ClassExam => ({ naturalKey: `shahaf-exam|${date}|${subject}`, date, subject, details: null, source: 'shahaf' });
const classBoard = (date: string, subject: string): ClassExam => ({ naturalKey: `site-exam|${date}|${subject}`, date, subject, details: null, source: 'school_site' });

function feedOf(exams: ClassExam[], classId = '7', examCalendarId: string | null = CLASS_CAL): ClassFeed {
  return {
    class: { siteUrl: SITE, classId, className: 'יב2', examCalendarId },
    lastOkAt: NOW.toISOString(),
    freshness: 'עודכן',
    lessons: [],
    changes: [],
    exams,
    events: [{ naturalKey: 'shahaf-event|trip', date: '2026-11-30', title: 'טיול', details: null }],
    messages: [],
  };
}

const FEED = feedOf([shahaf('2026-11-16', 'מבחן במתמטיקה שכבה יב'), classBoard('2026-11-17', 'אנגלית'), classBoard('2026-11-18', 'היסטוריה')]);
const ROWS: SaveExamBoardBody['rows'] = [{ date: '2026-11-20', title: 'ספרות', details: 'פרקים 1 עד 3' }];
const keys = (exams: readonly { naturalKey: string }[]) => exams.map((e) => e.naturalKey);

/** A `fetch` that answers with `body`, and the addresses it was asked for. */
function fetching(body: string | (() => string), status = 200) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    asked.push(String(url));
    return new Response(typeof body === 'function' ? body() : body, { status });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe('withOwnBoard', () => {
  it("takes the class's board's exams out and puts the own board's in, and leaves the site's own", () => {
    const own = keepOwnRows(memoryKv(), ROWS, NOW);
    const shown = withOwnBoard(FEED, own)!;
    expect(keys(shown.exams)).toEqual(['shahaf-exam|2026-11-16|מבחן במתמטיקה שכבה יב', uploadedExamKey('2026-11-20', 'ספרות')]);
    expect(shown.exams[1]).toEqual({ naturalKey: uploadedExamKey('2026-11-20', 'ספרות'), date: '2026-11-20', subject: 'ספרות', details: 'פרקים 1 עד 3', source: 'school_site' });
  });

  it("changes only the feed's exams, and never the feed it was given", () => {
    const before = JSON.stringify(FEED);
    const shown = withOwnBoard(FEED, keepOwnRows(memoryKv(), ROWS, NOW))!;
    expect(shown).not.toBe(FEED);
    expect(shown.class).toBe(FEED.class);
    expect(shown.class.examCalendarId).toBe(CLASS_CAL);
    expect(shown.lessons).toBe(FEED.lessons);
    expect(shown.changes).toBe(FEED.changes);
    expect(shown.events).toBe(FEED.events);
    expect(shown.messages).toBe(FEED.messages);
    expect(shown.lastOkAt).toBe(FEED.lastOkAt);
    expect(JSON.stringify(FEED)).toBe(before);
  });

  it("turned off for the student (none) leaves only the site's own exams", () => {
    const shown = withOwnBoard(FEED, keepWithoutClassBoard(memoryKv(), NOW))!;
    expect(keys(shown.exams)).toEqual(['shahaf-exam|2026-11-16|מבחן במתמטיקה שכבה יב']);
  });

  it("a calendar board stands in with the exams it read; before the first read the class's board is not shown either", () => {
    const kv = memoryKv();
    const unread = keepOwnCalendar(kv, OWN_CAL, 'היומן שלי', NOW);
    expect(keys(withOwnBoard(FEED, unread)!.exams)).toEqual(['shahaf-exam|2026-11-16|מבחן במתמטיקה שכבה יב']);
    const read: OwnBoard = { ...unread, exams: [{ ...classBoard('2026-12-01', 'פיזיקה'), naturalKey: 'site-exam|uid-1' }], readAt: NOW.toISOString() };
    expect(keys(withOwnBoard(FEED, read)!.exams)).toEqual(['shahaf-exam|2026-11-16|מבחן במתמטיקה שכבה יב', 'site-exam|uid-1']);
  });

  it('is the very same feed without an own board, and no feed with none, whatever the board', () => {
    expect(withOwnBoard(FEED, null)).toBe(FEED);
    expect(withOwnBoard(null, null)).toBeNull();
    expect(withOwnBoard(null, keepOwnRows(memoryKv(), ROWS, NOW))).toBeNull();
  });

  it('keeps an exam with no source as the site\'s own (an older server)', () => {
    const old: ClassExam = { naturalKey: 'shahaf-exam|old', date: '2026-11-16', subject: 'ביולוגיה', details: null };
    const shown = withOwnBoard(feedOf([old, classBoard('2026-11-17', 'אנגלית')]), keepWithoutClassBoard(memoryKv(), NOW))!;
    expect(keys(shown.exams)).toEqual(['shahaf-exam|old']);
  });

  it('copes with a stored feed that has no exams list, as the days do', () => {
    const old = { ...feedOf([]), exams: undefined } as unknown as ClassFeed;
    expect(withOwnBoard(old, keepOwnRows(memoryKv(), ROWS, NOW))!.exams.map((e) => e.subject)).toEqual(['ספרות']);
  });

  it('gives the same object for the same feed and board, so what is built from it is kept', () => {
    const own = keepOwnRows(memoryKv(), ROWS, NOW);
    expect(withOwnBoard(FEED, own)).toBe(withOwnBoard(FEED, own));
    expect(withOwnBoard(FEED, keepWithoutClassBoard(memoryKv(), NOW))).not.toBe(withOwnBoard(FEED, own));
    expect(withOwnBoard(feedOf([]), own)).not.toBe(withOwnBoard(FEED, own));
  });
});

describe('the store', () => {
  it('reads no board from nothing, from an empty string, from garbage or from the wrong shape', () => {
    const kv = memoryKv();
    expect(readOwnBoard(kv)).toBeNull();
    for (const bad of [
      '', '{not json', 'null', '7', '[]', '"rows"', '{}',
      JSON.stringify({ kind: 'rows', exams: [] }),
      JSON.stringify({ kind: 'rows', exams: 'x', savedAt: 'z' }),
      JSON.stringify({ kind: 'other', savedAt: 'z' }),
      JSON.stringify({ kind: 'calendar', calendarId: '', name: null, exams: [], readAt: null, savedAt: 'z' }),
      JSON.stringify({ kind: 'calendar', calendarId: 'c', name: 5, exams: [], readAt: null, savedAt: 'z' }),
      JSON.stringify({ kind: 'calendar', calendarId: 'c', name: null, exams: [], readAt: 5, savedAt: 'z' }),
      JSON.stringify({ kind: 'calendar', calendarId: 'c', name: null, exams: {}, readAt: null, savedAt: 'z' }),
    ]) {
      kv.set(OWN_BOARD_KEY, bad);
      expect(readOwnBoard(kv), bad).toBeNull();
    }
  });

  it('reads back each board as it was kept', () => {
    const kv = memoryKv();
    const rows = keepOwnRows(kv, ROWS, NOW);
    expect(readOwnBoard(kv)).toEqual(rows);
    const calendar = keepOwnCalendar(kv, OWN_CAL, 'לוח י״ב', NOW);
    expect(readOwnBoard(kv)).toEqual(calendar);
    expect(calendar).toEqual({ kind: 'calendar', calendarId: OWN_CAL, name: 'לוח י״ב', exams: [], readAt: null, savedAt: NOW.toISOString() });
    const none = keepWithoutClassBoard(kv, NOW);
    expect(readOwnBoard(kv)).toEqual({ kind: 'none', savedAt: NOW.toISOString() });
    expect(none).toEqual(readOwnBoard(kv));
  });

  it('drops the exams of a stored board that are not fit to show, and shows the rest', () => {
    const kv = memoryKv();
    const good = { naturalKey: 'k1', date: '2026-11-20', subject: 'ספרות', details: null, source: 'shahaf' };
    kv.set(OWN_BOARD_KEY, JSON.stringify({
      kind: 'rows',
      savedAt: NOW.toISOString(),
      exams: [good, { ...good, naturalKey: 'k2', date: '2026-02-30' }, { ...good, naturalKey: '' }, { ...good, naturalKey: 'k3', subject: '  ' }, { ...good, naturalKey: 'k4', details: 5 }, 'x', null, { ...good, subject: 'שוב' }],
    }));
    // Every one is the board's own whatever its stored source says; the first of a key stays.
    expect(readOwnBoard(kv)).toEqual({ kind: 'rows', savedAt: NOW.toISOString(), exams: [{ ...good, source: 'school_site' }] });
  });

  it('keeps the same rows kept twice under the same keys', () => {
    const rows: SaveExamBoardBody['rows'] = [
      { date: '2026-11-20', title: 'ספרות', details: null },
      { date: '2026-11-22', title: 'מבחן "מתמטיקה"', details: 'שלוש יחידות' },
    ];
    const again = rows.map((r) => ({ ...r }));
    expect(keys(keepOwnRows(memoryKv(), rows, NOW).exams)).toEqual(keys(keepOwnRows(memoryKv(), again, new Date('2026-03-01T00:00:00Z')).exams));
    expect(keys(keepOwnRows(memoryKv(), rows, NOW).exams)).toEqual([uploadedExamKey('2026-11-20', 'ספרות'), uploadedExamKey('2026-11-22', 'מבחן "מתמטיקה"')]);
  });

  it('cleans a row as the server cleans a class\'s, so the same file gives the same name and key either way', () => {
    const [exam] = keepOwnRows(memoryKv(), [{ date: '2026-11-20', title: '  מבחן   ב"ספרות"\n ', details: '   ' }, { date: '2026-11-21', title: 'מבחן', details: '  פרקים\t1   עד 3 ' }], NOW).exams;
    expect(exam).toEqual({ naturalKey: uploadedExamKey('2026-11-20', 'מבחן ב"ספרות"'), date: '2026-11-20', subject: 'מבחן ב"ספרות"', details: null, source: 'school_site' });
    expect(keepOwnRows(memoryKv(), [{ date: '2026-11-21', title: 'מבחן', details: '  פרקים\t1   עד 3 ' }], NOW).exams[0]!.details).toBe('פרקים 1 עד 3');
  });

  it('keeps the first of two rows with one key (the same day and title, quote marks aside)', () => {
    const board = keepOwnRows(memoryKv(), [
      { date: '2026-11-20', title: 'מבחן ב"ספרות"', details: 'הראשון' },
      { date: '2026-11-20', title: 'מבחן   בספרות', details: 'השני' },
      { date: '2026-11-21', title: 'מבחן בספרות', details: null },
    ], NOW);
    expect(board.kind === 'rows' && board.exams.map((e) => [e.date, e.details])).toEqual([['2026-11-20', 'הראשון'], ['2026-11-21', null]]);
  });

  it('keeps at most 400 rows, and leaves out a row with no title or no real day', () => {
    const many = Array.from({ length: OWN_ROWS_MAX + 25 }, (_v, i) => ({ date: '2026-11-20' as const, title: `מבחן ${i}`, details: null }));
    const board = keepOwnRows(memoryKv(), [...many, { date: '2026-11-20', title: 'אחרי', details: null }], NOW);
    expect(board.kind === 'rows' && board.exams).toHaveLength(OWN_ROWS_MAX);
    expect(board.kind === 'rows' && board.exams[0]!.subject).toBe('מבחן 0');
    const clean = keepOwnRows(memoryKv(), [
      { date: '2026-11-20', title: '   ', details: null },
      { date: '2026-02-30' as never, title: 'לא יום', details: null },
      { date: '20.11' as never, title: 'לא תאריך', details: null },
      { date: '2026-11-20', title: 'טוב', details: null },
    ], NOW);
    expect(clean.kind === 'rows' && clean.exams.map((e) => e.subject)).toEqual(['טוב']);
  });

  it('keeps no control, bidi mark or zero-width character, and leaves out a row of nothing else, as the server does (S-M1)', () => {
    const board = keepOwnRows(memoryKv(), [
      { date: '2026-11-20', title: '‏מבחן\u0000 ב‮ספרות​', details: 'פרק\u0007 א\uD800' },
      { date: '2026-11-21', title: '​‏﻿', details: null },
    ], NOW);
    expect(board.exams).toEqual([{ naturalKey: uploadedExamKey('2026-11-20', 'מבחן בספרות'), date: '2026-11-20', subject: 'מבחן בספרות', details: 'פרק א', source: 'school_site' }]);
  });

  it('cuts a title and details to the lengths the server keeps', () => {
    const [exam] = (keepOwnRows(memoryKv(), [{ date: '2026-11-20', title: 'א'.repeat(300), details: 'ב'.repeat(900) }], NOW) as Extract<OwnBoard, { kind: 'rows' }>).exams;
    expect(exam!.subject).toHaveLength(200);
    expect(exam!.details).toHaveLength(500);
  });

  it('is one board at a time: a new one replaces the one before, and removing it leaves none', () => {
    const kv = memoryKv();
    keepOwnRows(kv, ROWS, NOW);
    keepOwnCalendar(kv, OWN_CAL, null, NOW);
    expect(readOwnBoard(kv)?.kind).toBe('calendar');
    keepWithoutClassBoard(kv, NOW);
    expect(readOwnBoard(kv)?.kind).toBe('none');
    removeOwnBoard(kv);
    expect(readOwnBoard(kv)).toBeNull();
    expect(kv.map.has(OWN_BOARD_KEY)).toBe(false);
  });

  it('keeps what a calendar read when the same calendar is kept again, and nothing of another', () => {
    const kv = memoryKv();
    keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
    kv.set(OWN_BOARD_KEY, JSON.stringify({ ...readOwnBoard(kv), exams: [classBoard('2026-12-01', 'פיזיקה')], readAt: NOW.toISOString() }));
    const again = keepOwnCalendar(kv, OWN_CAL, 'לוח', new Date('2026-02-02T00:00:00Z'));
    expect(again).toMatchObject({ readAt: NOW.toISOString(), savedAt: '2026-02-02T00:00:00.000Z' });
    expect(again.kind === 'calendar' && again.exams).toHaveLength(1);
    const other = keepOwnCalendar(kv, 'another@group.calendar.google.com', null, NOW);
    expect(other).toMatchObject({ exams: [], readAt: null });
  });
});

describe('reading the phone\'s own calendar', () => {
  it('fills the exams, the name and when it was read', async () => {
    const kv = memoryKv();
    keepOwnCalendar(kv, OWN_CAL, 'שם ישן', NOW);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-02-01T09:30:00Z') });
    const { asked, fetchImpl } = fetching(ICS);

    const board = await refreshOwnBoard(kv, TODAY, ZONE, fetchImpl);

    const expected = calendarExams(ICS, TODAY, ZONE);
    expect(expected.exams.length).toBeGreaterThan(10);
    expect(board).toMatchObject({ kind: 'calendar', calendarId: OWN_CAL, name: 'לוח מבחנים שכבת י"ב', readAt: '2026-02-01T09:30:00.000Z', savedAt: NOW.toISOString() });
    expect(board?.kind === 'calendar' && board.exams).toEqual(expected.exams);
    expect(readOwnBoard(kv)).toEqual(board);
    // Google's fixed address for that calendar, once, and nothing else.
    expect(asked).toEqual([examCalendarIcsUrl(OWN_CAL)]);
  });

  it('keeps the exams and the time of the read before when the network, the answer or the body is wrong', async () => {
    const reads = [
      ['no network', (async () => { throw new TypeError('Network request failed'); }) as typeof fetch],
      ['404', fetching('not found', 404).fetchImpl],
      ['500', fetching('oops', 500).fetchImpl],
      ['a page, not a calendar', fetching('<html><body>Sign in</body></html>').fetchImpl],
      ['an empty body', fetching('').fetchImpl],
      ['too long', fetching(`BEGIN:VCALENDAR\n${'x'.repeat(OWN_CALENDAR_MAX_CHARS)}`).fetchImpl],
      ['too long, by its header', (async () => new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', { headers: { 'content-length': String(3 * OWN_CALENDAR_MAX_CHARS + 1) } })) as typeof fetch],
      // S-C1: a calendar of more exams than a board holds is refused as the server refuses it
      ['more exams than a board holds', fetching(() => [
        'BEGIN:VCALENDAR',
        ...Array.from({ length: 2001 }, (_, i) => {
          const day = new Date(Date.UTC(2025, 8, 1 + (i % 360))).toISOString().slice(0, 10).replace(/-/g, '');
          return `BEGIN:VEVENT\r\nUID:e${i}\r\nDTSTART;VALUE=DATE:${day}\r\nSUMMARY:מבחן ${i}\r\nEND:VEVENT`;
        }),
        'END:VCALENDAR',
      ].join('\r\n')).fetchImpl],
    ] as const;
    for (const [what, fetchImpl] of reads) {
      const kv = memoryKv();
      keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
      const first = await refreshOwnBoard(kv, TODAY, ZONE, fetching(ICS).fetchImpl);
      const stored = kv.map.get(OWN_BOARD_KEY);

      // asked for, as a pull to refresh is: a read right after the last one is not held back (A-I1)
      const read = await refreshOwnBoardRead(kv, TODAY, ZONE, fetchImpl, { force: true });

      expect(read.failed, what).toBe(true);
      expect(read.board, what).toEqual(first);
      expect(kv.map.get(OWN_BOARD_KEY), what).toBe(stored);
      expect(await refreshOwnBoard(kv, TODAY, ZONE, fetchImpl, { force: true }), what).toEqual(first);
    }
  });

  it('gives up after 15 seconds, on a fetch that hears the abort and on one that does not', async () => {
    expect(OWN_CALENDAR_LIMIT_MS).toBe(15_000);
    vi.useFakeTimers();
    for (const hears of [true, false]) {
      const kv = memoryKv();
      keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
      const before = kv.map.get(OWN_BOARD_KEY);
      const hanging = ((_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (hears) init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch;
      let result: Awaited<ReturnType<typeof refreshOwnBoardRead>> | null = null;
      void refreshOwnBoardRead(kv, TODAY, ZONE, hanging).then((r) => { result = r; });

      await vi.advanceTimersByTimeAsync(OWN_CALENDAR_LIMIT_MS - 1);
      expect(result).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toMatchObject({ failed: true });
      expect(kv.map.get(OWN_BOARD_KEY)).toBe(before);
    }
  });

  it('reads nothing for a board that is not a calendar, or for none', async () => {
    const never = vi.fn(async () => new Response(ICS));
    const kv = memoryKv();
    expect(await refreshOwnBoardRead(kv, TODAY, ZONE, never as typeof fetch)).toEqual({ board: null, failed: false });
    const rows = keepOwnRows(kv, ROWS, NOW);
    expect(await refreshOwnBoardRead(kv, TODAY, ZONE, never as typeof fetch)).toEqual({ board: rows, failed: false });
    const none = keepWithoutClassBoard(kv, NOW);
    expect(await refreshOwnBoard(kv, TODAY, ZONE, never as typeof fetch)).toEqual(none);
    expect(never).not.toHaveBeenCalled();
  });

  it('does not bring a board back that was taken away, or replaced, while the calendar was on its way', async () => {
    let answer: (res: Response) => void = () => undefined;
    const slow = (() => new Promise<Response>((resolve) => { answer = resolve; })) as typeof fetch;

    const removed = memoryKv();
    keepOwnCalendar(removed, OWN_CAL, 'לוח', NOW);
    const readRemoved = refreshOwnBoardRead(removed, TODAY, ZONE, slow);
    removeOwnBoard(removed);
    answer(new Response(ICS));
    expect(await readRemoved).toEqual({ board: null, failed: false });
    expect(removed.map.has(OWN_BOARD_KEY)).toBe(false);

    const replaced = memoryKv();
    keepOwnCalendar(replaced, OWN_CAL, 'לוח', NOW);
    const readReplaced = refreshOwnBoardRead(replaced, TODAY, ZONE, slow);
    keepOwnCalendar(replaced, 'other@group.calendar.google.com', 'אחר', new Date('2026-02-01T08:05:00Z'));
    answer(new Response(ICS));
    const { board } = await readReplaced;
    expect(board).toMatchObject({ calendarId: 'other@group.calendar.google.com', exams: [], readAt: null });

    const turnedOff = memoryKv();
    keepOwnCalendar(turnedOff, OWN_CAL, 'לוח', NOW);
    const readOff = refreshOwnBoardRead(turnedOff, TODAY, ZONE, slow);
    keepWithoutClassBoard(turnedOff, NOW);
    answer(new Response(ICS));
    expect((await readOff).board).toMatchObject({ kind: 'none' });
  });

  it('never throws, whatever the storage does', async () => {
    const kv = memoryKv();
    keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
    const full = { ...kv, set: () => { throw new Error('storage is full'); } };
    expect(await refreshOwnBoardRead(full, TODAY, ZONE, fetching(ICS).fetchImpl)).toMatchObject({ failed: true });
    const broken = { ...kv, getString: () => { throw new Error('storage is gone'); } };
    expect(await refreshOwnBoardRead(broken, TODAY, ZONE, fetching(ICS).fetchImpl)).toEqual({ board: null, failed: false });
  });

  it('has one sentence for a read that failed', () => {
    expect(OWN_BOARD_READ_FAILED).toBe('לא הצלחנו לקרוא את לוח המבחנים שלך. ננסה שוב עוד מעט.');
  });
});

describe('reading the phone\'s own calendar at most once an hour (A-I1)', () => {
  const MIN = 60_000;
  /** A store whose writes to the board are counted. */
  function countingKv() {
    const kv = memoryKv();
    const writes = { board: 0 };
    return { ...kv, writes, set: (k: string, v: string) => { if (k === OWN_BOARD_KEY) writes.board += 1; kv.set(k, v); } };
  }
  const read = (kv: ReturnType<typeof countingKv>, fetchImpl: typeof fetch, at: Date, force = false) =>
    refreshOwnBoardRead(kv, TODAY, ZONE, fetchImpl, { force, now: at });

  it('asks Google once an hour by itself, and whenever the person asks or the calendar was never read', async () => {
    expect(OWN_CALENDAR_EVERY_MS).toBe(60 * MIN);
    const kv = countingKv();
    keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
    const { asked, fetchImpl } = fetching(ICS);
    // never read: read whatever the hour
    await read(kv, fetchImpl, NOW);
    expect(asked).toHaveLength(1);
    // ten minutes later, by itself: not asked
    expect(await read(kv, fetchImpl, new Date(NOW.getTime() + 10 * MIN))).toEqual({ board: readOwnBoard(kv), failed: false });
    expect(asked).toHaveLength(1);
    // asked for (pull to refresh, or a calendar just kept): asked
    await read(kv, fetchImpl, new Date(NOW.getTime() + 11 * MIN), true);
    expect(asked).toHaveLength(2);
    // 59 minutes after the last try, by itself: not asked; an hour after it: asked again
    await read(kv, fetchImpl, new Date(NOW.getTime() + 70 * MIN));
    expect(asked).toHaveLength(2);
    await read(kv, fetchImpl, new Date(NOW.getTime() + 71 * MIN));
    expect(asked).toHaveLength(3);
  });

  it('counts a try that failed as a try: a calendar that cannot be read is tried again an hour later', async () => {
    const kv = countingKv();
    keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
    await read(kv, fetching(ICS).fetchImpl, NOW);
    const failing = fetching('oops', 500);
    expect((await read(kv, failing.fetchImpl, new Date(NOW.getTime() + 61 * MIN))).failed).toBe(true);
    expect((await read(kv, failing.fetchImpl, new Date(NOW.getTime() + 62 * MIN))).failed).toBe(false);
    expect(failing.asked).toHaveLength(1);
  });

  it('writes nothing to the board when a read changes neither the name nor the exams, and keeps the time of the try apart', async () => {
    const kv = countingKv();
    keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
    await read(kv, fetching(ICS).fetchImpl, NOW);
    const first = kv.map.get(OWN_BOARD_KEY);
    const writes = kv.writes.board;
    const again = await read(kv, fetching(ICS).fetchImpl, new Date(NOW.getTime() + 61 * MIN));
    expect(again.failed).toBe(false);
    expect(kv.writes.board).toBe(writes);
    expect(kv.map.get(OWN_BOARD_KEY)).toBe(first);
    expect(JSON.parse(kv.map.get(OWN_BOARD_TRIED_KEY)!)).toEqual({ calendarId: OWN_CAL, at: new Date(NOW.getTime() + 61 * MIN).toISOString() });
    // a calendar that says something new is written
    // the first event of the fixture is on 22 February 2026, in this school year
    const changed = ICS.replace('SUMMARY: י"ב- מבחן בגוש ב \r\n', 'SUMMARY: י"ב- מבחן בגוש ג\r\n').replace('SUMMARY: י"ב- מבחן בגוש ב \n', 'SUMMARY: י"ב- מבחן בגוש ג\n');
    expect(changed).not.toBe(ICS);
    await read(kv, fetching(changed).fetchImpl, new Date(NOW.getTime() + 130 * MIN));
    expect(kv.writes.board).toBe(writes + 1);
  });

  it("holds a calendar to its own last try, not another's (a parent's second child, or a calendar kept in its place)", async () => {
    const kv = countingKv();
    keepOwnCalendar(kv, OWN_CAL, 'לוח', NOW);
    await read(kv, fetching(ICS).fetchImpl, NOW);
    keepOwnCalendar(kv, 'another@group.calendar.google.com', 'אחר', NOW);
    const other = fetching(ICS);
    await read(kv, other.fetchImpl, new Date(NOW.getTime() + 5 * MIN));
    expect(other.asked).toEqual([examCalendarIcsUrl('another@group.calendar.google.com')]);
  });
});

describe('keeping a calendar and reading it at once (A-I2)', () => {
  it('is the board once its first read worked', async () => {
    const kv = memoryKv();
    const board = await keepOwnCalendarRead(kv, OWN_CAL, 'לוח', TODAY, ZONE, fetching(ICS).fetchImpl, NOW);
    expect(board).toMatchObject({ kind: 'calendar', calendarId: OWN_CAL, readAt: NOW.toISOString() });
    expect(readOwnBoard(kv)).toEqual(board);
  });

  it('puts back the board that was there when the first read fails, and throws OwnCalendarUnreadError', async () => {
    for (const before of [null, 'rows', 'none'] as const) {
      const kv = memoryKv();
      if (before === 'rows') keepOwnRows(kv, ROWS, NOW);
      if (before === 'none') keepWithoutClassBoard(kv, NOW);
      const stored = kv.map.get(OWN_BOARD_KEY);
      let thrown: unknown;
      await keepOwnCalendarRead(kv, OWN_CAL, 'לוח', TODAY, ZONE, fetching('oops', 500).fetchImpl, NOW).catch((err: unknown) => { thrown = err; });
      expect([before, thrown]).toEqual([before, expect.any(OwnCalendarUnreadError)]);
      expect((thrown as Error).name).toBe('OwnCalendarUnreadError');
      expect([before, kv.map.get(OWN_BOARD_KEY)]).toEqual([before, stored]);
      expect([before, kv.map.has(OWN_BOARD_KEY)]).toEqual([before, stored !== undefined]);
    }
  });

  it('keeps the read before when the same calendar, read before, is kept again and this read fails', async () => {
    const kv = memoryKv();
    const first = await keepOwnCalendarRead(kv, OWN_CAL, 'לוח', TODAY, ZONE, fetching(ICS).fetchImpl, NOW);
    const later = new Date('2026-02-02T08:00:00Z');
    const again = await keepOwnCalendarRead(kv, OWN_CAL, 'לוח', TODAY, ZONE, fetching('oops', 500).fetchImpl, later);
    expect(again).toMatchObject({ kind: 'calendar', readAt: NOW.toISOString(), savedAt: later.toISOString() });
    const examsOf = (b: OwnBoard | null) => (b?.kind === 'calendar' ? b.exams : null);
    expect(examsOf(again)!.length).toBeGreaterThan(0);
    expect(examsOf(again)).toEqual(examsOf(first));
  });
});

describe("a parent's children", () => {
  const SHOWN: UserSettings = { ...DEFAULT_SETTINGS, audience: 'parent', classId: '12144', className: "יא' 4" };
  let n = 0;
  const newId = () => `c${++n}`;

  function twoChildren() {
    n = 0;
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE, { siteUrl: SITE, classId: '13900', className: "ז' 2" }, newId);
    return kv;
  }

  it('keeps the board with the child it was brought for', () => {
    expect(CHILD_KEYS).toContain(OWN_BOARD_KEY);
    const kv = twoChildren();
    const first = keepOwnRows(kv, ROWS, NOW);

    const second = switchChild(kv, SHOWN, 'c2', SITE)!;
    // The second child has none, and the first's is aside, as it was.
    expect(readOwnBoard(kv)).toBeNull();
    expect(stashedChild(kv, 'c1').ownBoard).toEqual(first);
    expect(stashedChild(kv, 'c2').ownBoard).toBeNull();
    const calendar = keepOwnCalendar(kv, OWN_CAL, 'היומן של ז', NOW);

    switchChild(kv, second, 'c1', SITE);
    expect(readOwnBoard(kv)).toEqual(first);
    expect(stashedChild(kv, 'c2').ownBoard).toEqual(calendar);

    // A child that never had one comes back with none, not with the other's.
    n = 0;
    const plain = twoChildren();
    switchChild(plain, SHOWN, 'c2', SITE);
    expect(readOwnBoard(plain)).toBeNull();
  });

  it('takes the board of a child off the list with the rest of what was kept for it', () => {
    const kv = twoChildren();
    const onScreen = switchChild(kv, SHOWN, 'c2', SITE)!;
    keepOwnRows(kv, ROWS, NOW);
    switchChild(kv, onScreen, 'c1', SITE);
    expect(stashedChild(kv, 'c2').ownBoard).not.toBeNull();

    removeChild(kv, SHOWN, 'c2', SITE);
    expect(stashedChild(kv, 'c2').ownBoard).toBeNull();
    expect(kv.getString(stashKey('c2', OWN_BOARD_KEY))).toBe('');
  });

  it("lays each child's own board over its own feed, and the board of the child on screen over no other", () => {
    const own = keepOwnRows(memoryKv(), ROWS, NOW);
    const shownFeed = feedOf([classBoard('2026-11-17', 'אנגלית')], '12144');
    const otherFeed = feedOf([classBoard('2026-11-19', 'ביולוגיה')], '13900');
    const shown = { siteUrl: SITE, classId: '12144', feed: shownFeed };

    // A child in another class: its kept feed, under its own board.
    expect(keys(childFeed({ siteUrl: SITE, classId: '13900' }, { feed: otherFeed, ownBoard: null }, shown)!.exams)).toEqual(['site-exam|2026-11-19|ביולוגיה']);
    expect(keys(childFeed({ siteUrl: SITE, classId: '13900' }, { feed: otherFeed, ownBoard: own }, shown)!.exams)).toEqual([uploadedExamKey('2026-11-20', 'ספרות')]);
    // A twin of the child on screen reads the class's feed on screen, under the twin's own board: here none, so
    // the very feed, with the class's board in it. The child on screen's board is never the twin's.
    expect(childFeed({ siteUrl: SITE, classId: '12144' }, { feed: null, ownBoard: null }, shown)).toBe(shownFeed);
    expect(keys(childFeed({ siteUrl: SITE, classId: '12144' }, { feed: null, ownBoard: own }, shown)!.exams)).toEqual([uploadedExamKey('2026-11-20', 'ספרות')]);
    // No feed kept for the child yet: none.
    expect(childFeed({ siteUrl: SITE, classId: '13900' }, { feed: null, ownBoard: own }, shown)).toBeNull();
  });
});

/**
 * The feed as the server really sends it: an exam of the class's site that the class's board also lists is not in
 * `exams` (`withoutSiteTwins`), it is in `siteTwins` (`splitSiteTwins`, the one rule the route runs).
 */
describe('a feed as the server sends it', () => {
  function sentFeed(site: ClassExam[], board: ClassExam[]): ClassFeed {
    const { kept, twins } = splitSiteTwins([...site, ...board]);
    return { ...feedOf(kept), ...(twins.length > 0 ? { siteTwins: twins } : {}) };
  }
  const ENGLISH = shahaf('2026-11-16', 'מבחן באנגלית שכבה יא');
  const MATH = shahaf('2026-11-18', 'מבחן במתמטיקה שכבה יא');
  const CHEMISTRY = shahaf('2026-11-19', 'מבחן בכימיה שכבה יא');
  const SENT = sentFeed([ENGLISH, MATH, CHEMISTRY], [classBoard('2026-11-16', 'י"ב מבחן באנגלית'), classBoard('2026-11-18', 'י"ב מבחן במתמטיקה')]);
  const examsOf = (feed: ClassFeed | null) => localExamsFrom({ feed, mashov: [], bagrut: [], settings: DEFAULT_SETTINGS }, '2026-11-01', '2026-11-01');

  it('has the twins apart, as the route sends them', () => {
    expect(keys(SENT.exams)).toEqual([CHEMISTRY.naturalKey, 'site-exam|2026-11-16|י"ב מבחן באנגלית', 'site-exam|2026-11-18|י"ב מבחן במתמטיקה']);
    expect(SENT.siteTwins).toEqual([ENGLISH, MATH]);
  });

  it("shows every one of the site's exams when the class's board is turned off", () => {
    const shown = withOwnBoard(SENT, keepWithoutClassBoard(memoryKv(), NOW))!;
    expect(keys(shown.exams).sort()).toEqual([ENGLISH, MATH, CHEMISTRY].map((e) => e.naturalKey).sort());
    expect(keys(examsOf(shown))).toEqual([ENGLISH, MATH, CHEMISTRY].map((e) => e.naturalKey));
  });

  it("shows an exam of the site's that the own board lists once, and the others as the site has them", () => {
    const own = keepOwnRows(memoryKv(), [{ date: '2026-11-16', title: 'מבחן באנגלית', details: null }], NOW);
    expect(keys(examsOf(withOwnBoard(SENT, own)))).toEqual([uploadedExamKey('2026-11-16', 'מבחן באנגלית'), MATH.naturalKey, CHEMISTRY.naturalKey]);
  });

  it("shows all of the site's exams beside an own board that lists none of them", () => {
    const own = keepOwnRows(memoryKv(), [{ date: '2026-11-25', title: 'ספרות', details: null }], NOW);
    expect(keys(examsOf(withOwnBoard(SENT, own)))).toEqual([ENGLISH.naturalKey, MATH.naturalKey, CHEMISTRY.naturalKey, uploadedExamKey('2026-11-25', 'ספרות')]);
    const calendar: OwnBoard = { ...keepOwnCalendar(memoryKv(), OWN_CAL, null, NOW), exams: [{ ...classBoard('2026-11-25', 'ספרות'), naturalKey: 'site-exam|uid-9' }], readAt: NOW.toISOString() };
    expect(keys(examsOf(withOwnBoard(SENT, calendar)))).toEqual([ENGLISH.naturalKey, MATH.naturalKey, CHEMISTRY.naturalKey, 'site-exam|uid-9']);
  });

  it('is exactly what it is today without an own board', () => {
    expect(withOwnBoard(SENT, null)).toBe(SENT);
    expect(keys(examsOf(SENT))).toEqual(['site-exam|2026-11-16|י"ב מבחן באנגלית', 'site-exam|2026-11-18|י"ב מבחן במתמטיקה', CHEMISTRY.naturalKey]);
  });

  it("leaves the twins on the feed as they were, and puts them back as the site's, once", () => {
    const before = JSON.stringify(SENT);
    const shown = withOwnBoard(SENT, keepWithoutClassBoard(memoryKv(), NOW))!;
    expect(shown.siteTwins).toBe(SENT.siteTwins);
    expect(JSON.stringify(SENT)).toBe(before);
    expect(shown.exams.every((e) => e.source === 'shahaf')).toBe(true);
    // A twin already among the exams (a server that sent both) is not doubled.
    const both: ClassFeed = { ...SENT, exams: [...SENT.exams, ENGLISH] };
    expect(keys(withOwnBoard(both, keepWithoutClassBoard(memoryKv(), NOW))!.exams).filter((k) => k === ENGLISH.naturalKey)).toHaveLength(1);
  });

  it("copes with a feed from a server that does not send twins: the site's exams are then the ones it sent", () => {
    const older: ClassFeed = { ...SENT };
    delete older.siteTwins;
    expect(keys(withOwnBoard(older, keepWithoutClassBoard(memoryKv(), NOW))!.exams)).toEqual([CHEMISTRY.naturalKey]);
  });
});

describe('the exams the phone builds', () => {
  const sources = (feed: ClassFeed | null, over: Partial<Parameters<typeof localExamsFrom>[0]> = {}) => ({
    feed, mashov: [], bagrut: [], settings: DEFAULT_SETTINGS, ...over,
  });
  const examsOf = (feed: ClassFeed | null, over?: Partial<Parameters<typeof localExamsFrom>[0]>) => localExamsFrom(sources(feed, over), '2026-11-01', '2026-11-01');

  it("shows an own exam that twins a site exam once, as the class's board's would be", () => {
    const feed = feedOf([shahaf('2026-11-16', 'מבחן באנגלית שכבה יא')]);
    const own = keepOwnRows(memoryKv(), [{ date: '2026-11-16', title: 'י"ב מבחן באנגלית', details: null }], NOW);
    const exams = examsOf(withOwnBoard(feed, own));
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({ naturalKey: uploadedExamKey('2026-11-16', 'י"ב מבחן באנגלית'), source: 'school_site' });
  });

  it("leaves Mashov's exams, bagrut and the ones added by hand alone", () => {
    const kv = memoryKv();
    const manual = addManualExam(kv, { date: '2026-11-22', subject: 'ספרות פרטי' }, NOW);
    const mashov: NormalizedEntity[] = [{ source: 'mashov', kind: 'exam', naturalKey: 'mashov-exam|1', payload: { date: '2026-11-23', subject: 'כימיה', details: null } }];
    const bagrut: BagrutExam[] = [{
      naturalKey: bagrutKey(35571, '2026-11'), semel: 35571, name: 'אזרחות', moed: '2026-11', method: 'external', schoolGrade: null, examGrade: null,
      finalGrade: null, acceptedGrade: null, registered: true, examDate: '2026-11-24', startTime: '09:00', endTime: '12:00',
    }];
    const feed = feedOf([shahaf('2026-11-16', 'מבחן במתמטיקה שכבה יב'), classBoard('2026-11-17', 'אנגלית')]);
    const mine = keepOwnRows(memoryKv(), [{ date: '2026-11-25', title: 'היסטוריה', details: null }], NOW);

    const without = examsOf(feed, { mashov, bagrut, manualExams: readManualExams(kv) });
    const withBoard = examsOf(withOwnBoard(feed, mine), { mashov, bagrut, manualExams: readManualExams(kv) });
    const kept = (list: { naturalKey: string }[]) => keys(list).filter((k) => !k.startsWith('site-exam|'));
    expect(kept(withBoard)).toEqual(kept(without));
    expect(kept(withBoard)).toContain(manual.naturalKey);
    expect(kept(withBoard)).toContain('mashov-exam|1');
    expect(kept(withBoard)).toContain(bagrutKey(35571, '2026-11'));
    expect(keys(withBoard).filter((k) => k.startsWith('site-exam|'))).toEqual([uploadedExamKey('2026-11-25', 'היסטוריה')]);
  });

  it('keeps the student\'s name for an exam when the same board is brought again', () => {
    const key = uploadedExamKey('2026-11-20', 'ספרות');
    const prefs = { renames: { [key]: 'ספרות, פרקים 1 עד 3' }, calendarSkip: [], dates: {} };
    const feed = feedOf([]);
    const kv = memoryKv();
    expect(examsOf(withOwnBoard(feed, keepOwnRows(kv, ROWS, NOW)), { examPrefs: prefs })[0]).toMatchObject({ naturalKey: key, subject: 'ספרות, פרקים 1 עד 3', originalSubject: 'ספרות' });
    expect(examsOf(withOwnBoard(feed, keepOwnRows(kv, ROWS, new Date('2026-03-01T00:00:00Z'))), { examPrefs: prefs })[0]).toMatchObject({ naturalKey: key, subject: 'ספרות, פרקים 1 עד 3' });
  });
});

describe('the exam calendars the timeline leaves out', () => {
  const calendar = keepOwnCalendar(memoryKv(), OWN_CAL, null, NOW);
  const rows = keepOwnRows(memoryKv(), ROWS, NOW);

  it("are the class's, and the own board's when that is a calendar", () => {
    expect(deviceCalendars('mirror-id', FEED)).toEqual({ school: 'mirror-id', exam: CLASS_CAL });
    expect(deviceCalendars('mirror-id', FEED, null)).toEqual({ school: 'mirror-id', exam: CLASS_CAL });
    expect(deviceCalendars('mirror-id', FEED, calendar)).toEqual({ school: 'mirror-id', exam: CLASS_CAL, ownExam: OWN_CAL });
    // Rows and none: the class's calendar stays off the timeline as before, and there is no other.
    expect(deviceCalendars(null, FEED, rows)).toEqual({ school: null, exam: CLASS_CAL });
    expect(deviceCalendars(null, FEED, keepWithoutClassBoard(memoryKv(), NOW))).toEqual({ school: null, exam: CLASS_CAL });
    expect(deviceCalendars(null, feedOf([], '7', null), keepWithoutClassBoard(memoryKv(), NOW))).toEqual({ school: null, exam: null });
    expect(deviceCalendars(null, null, calendar)).toEqual({ school: null, exam: null, ownExam: OWN_CAL });
    expect(deviceCalendars(null, null)).toEqual({ school: null, exam: null });
  });

  it('are listed together, each once', () => {
    expect(examCalendarIds(undefined)).toEqual([]);
    expect(examCalendarIds({ school: null, exam: null })).toEqual([]);
    expect(examCalendarIds({ school: 's', exam: CLASS_CAL })).toEqual([CLASS_CAL]);
    expect(examCalendarIds(deviceCalendars(null, FEED, calendar))).toEqual([CLASS_CAL, OWN_CAL]);
    expect(examCalendarIds({ school: null, exam: null, ownExam: OWN_CAL })).toEqual([OWN_CAL]);
  });

  it("keep the events of both off the timeline, and the class's whatever the own board is", () => {
    const calendarEvent = (calendarId: string, summary: string) => ({
      kind: 'calendar_event' as const, naturalKey: `${calendarId}|e`, partition: calendarId,
      payload: { googleId: summary, calendarId, calendarSummary: calendarId, summary, location: null, start: '2026-02-03T17:00:00+02:00', end: '2026-02-03T18:00:00+02:00', allDay: false, cancelled: false },
    });
    const google = [calendarEvent('personal', 'חוג'), calendarEvent(CLASS_CAL, 'אירוע מיומן הכיתה'), calendarEvent(OWN_CAL, 'אירוע מהיומן שלי')];
    const events = (own: OwnBoard | null) =>
      buildLocalDays({
        feed: FEED, mashov: [], bagrut: [], google, settings: DEFAULT_SETTINGS, calendars: deviceCalendars(null, FEED, own), zone: ZONE, now: NOW,
      }, ['2026-02-03'])[0]!.timeline.flatMap((i) => (i.kind === 'event' ? [i.event.summary] : []));

    // An own calendar and the class's: both off.
    expect(events(calendar)).toEqual(['חוג']);
    // Own rows, or none: the class's off as today, the own calendar is just a calendar of theirs.
    expect(events(rows)).toEqual(['חוג', 'אירוע מהיומן שלי']);
    expect(events(keepWithoutClassBoard(memoryKv(), NOW))).toEqual(['חוג', 'אירוע מהיומן שלי']);
    // No own board: today's.
    expect(events(null)).toEqual(['חוג', 'אירוע מהיומן שלי']);
  });

  it('are all marked as exam calendars in the list of calendars', () => {
    const list = [CLASS_CAL, OWN_CAL, 'personal'].map((id) => ({ id, summary: id, primary: id === 'personal' }));
    const marked = (exam: string | null | readonly string[]) => calendarOptions(list, null, exam).filter((c) => c.isExamCalendar).map((c) => c.id).sort();
    expect(marked(null)).toEqual([]);
    expect(marked(CLASS_CAL)).toEqual([CLASS_CAL]);
    expect(marked(examCalendarIds(deviceCalendars(null, FEED, calendar)))).toEqual([CLASS_CAL, OWN_CAL].sort());
    expect(marked([])).toEqual([]);
  });
});

describe('the class board turned off over a class that has none (A-M5)', () => {
  it('is removed when a refresh sees the class with no board, and every other own board, or a class with a board, keeps it', () => {
    const noBoard = feedOf([], '7', null).class;
    const uploaded = { ...noBoard, examBoard: { kind: 'upload' as const, setAt: null, count: 3, mine: false, mayChange: false } };
    const none = () => {
      const kv = memoryKv();
      keepWithoutClassBoard(kv, NOW);
      return kv;
    };
    const gone = none();
    expect(dropNoneOverNoBoard(gone, noBoard)).toBe(true);
    expect(readOwnBoard(gone)).toBeNull();
    for (const cls of [FEED.class, uploaded]) {
      const kv = none();
      expect(dropNoneOverNoBoard(kv, cls)).toBe(false);
      expect(readOwnBoard(kv)?.kind).toBe('none');
    }
    const rows = memoryKv();
    keepOwnRows(rows, ROWS, NOW);
    expect(dropNoneOverNoBoard(rows, noBoard)).toBe(false);
    expect(readOwnBoard(rows)?.kind).toBe('rows');
    expect(dropNoneOverNoBoard(memoryKv(), noBoard)).toBe(false);
  });
});

describe("the exam board screens' view of it", () => {
  it('reads an own board as the owner of the board', () => {
    const cls = FEED.class;
    expect(boardOwner(cls, null)).toBe('class-other');
    expect(boardOwner(cls, keepOwnRows(memoryKv(), ROWS, NOW))).toBe('own');
    expect(boardOwner(cls, keepOwnCalendar(memoryKv(), OWN_CAL, null, NOW))).toBe('own');
    expect(boardOwner(cls, keepWithoutClassBoard(memoryKv(), NOW))).toBe('own-none');
  });
});

describe('when the class changes', () => {
  const was = { classId: '7', siteUrl: SITE };

  it('drops a board made for the class before, and keeps it when the same class is saved again', () => {
    for (const board of [(kv: ReturnType<typeof memoryKv>) => keepOwnRows(kv, ROWS, NOW), (kv: ReturnType<typeof memoryKv>) => keepWithoutClassBoard(kv, NOW)]) {
      const kv = memoryKv();
      const own = board(kv);
      expect(dropOwnBoardOnClassChange(kv, was, { ...was })).toBe(false);
      expect(dropOwnBoardOnClassChange(kv, { classId: '7' }, { classId: '7' })).toBe(false);
      expect(dropOwnBoardOnClassChange(kv, { classId: '7', siteUrl: SITE }, { classId: '7', siteUrl: null })).toBe(false);
      expect(readOwnBoard(kv)).toEqual(own);

      expect(dropOwnBoardOnClassChange(kv, was, { classId: '8', siteUrl: SITE })).toBe(true);
      expect(readOwnBoard(kv)).toBeNull();
      expect(kv.map.has(OWN_BOARD_KEY)).toBe(false);
    }
  });

  it('drops it for the same class number at another school, and for no class at all', () => {
    for (const after of [{ classId: '7', siteUrl: 'https://other.shahaf.site' }, { classId: '' }]) {
      const kv = memoryKv();
      keepWithoutClassBoard(kv, NOW);
      expect(dropOwnBoardOnClassChange(kv, was, after), JSON.stringify(after)).toBe(true);
      expect(readOwnBoard(kv)).toBeNull();
    }
  });

  it("with none, shows the new class's board again, which the student never saw hidden", () => {
    const kv = memoryKv();
    keepWithoutClassBoard(kv, NOW);
    const newClass = feedOf([classBoard('2026-11-17', 'אנגלית')], '8');
    expect(withOwnBoard(newClass, readOwnBoard(kv))!.exams).toEqual([]);
    dropOwnBoardOnClassChange(kv, was, { classId: '8', siteUrl: SITE });
    expect(withOwnBoard(newClass, readOwnBoard(kv))).toBe(newClass);
  });

  it("takes the board of the child on screen, and no other's; switching between children takes none", () => {
    let n = 0;
    const newId = () => `c${++n}`;
    const kv = memoryKv();
    const shown: UserSettings = { ...DEFAULT_SETTINGS, audience: 'parent', classId: '12144', className: "יא' 4" };
    addChild(kv, shown, SITE, { siteUrl: SITE, classId: '13900', className: "ז' 2" }, newId);
    const first = keepOwnRows(kv, ROWS, NOW);
    const second = switchChild(kv, shown, 'c2', SITE)!;
    const secondsBoard = keepWithoutClassBoard(kv, NOW);
    // Back and forth: both boards are where they were.
    const back = switchChild(kv, second, 'c1', SITE)!;
    expect(readOwnBoard(kv)).toEqual(first);
    expect(stashedChild(kv, 'c2').ownBoard).toEqual(secondsBoard);

    // The child on screen is picked into another class (`saveSettings`): its board goes, the other child's stays.
    const moved: UserSettings = { ...back, classId: '12150', className: "יא' 5" };
    expect(dropOwnBoardOnClassChange(kv, { classId: back.classId }, { classId: moved.classId })).toBe(true);
    syncShownChild(kv, moved, SITE);
    expect(readOwnBoard(kv)).toBeNull();
    expect(stashedChild(kv, 'c2').ownBoard).toEqual(secondsBoard);
    const toSecond = switchChild(kv, moved, 'c2', SITE)!;
    expect(readOwnBoard(kv)).toEqual(secondsBoard);
    expect(stashedChild(kv, 'c1').ownBoard).toBeNull();
    switchChild(kv, toSecond, 'c1', SITE);
    expect(readOwnBoard(kv)).toBeNull();
    expect(stashedChild(kv, 'c2').ownBoard).toEqual(secondsBoard);
  });

  it('is done where the app saves another class and where an invite follows one (read from the source)', () => {
    const api = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'local', 'phoneApi.ts'), 'utf8');
    const save = /async function saveSettings[\s\S]*?\n\}\n/.exec(api)?.[0] ?? '';
    // After the class was followed and the settings kept, so a pick that failed leaves the board.
    expect(save.indexOf('await followPickedClass(')).toBeGreaterThan(-1);
    expect(save.indexOf('saveUserSettings(settings)')).toBeGreaterThan(save.indexOf('await followPickedClass('));
    expect(save.indexOf('dropOwnBoardOnClassChange(storage, { classId: before.classId }, { classId: settings.classId })')).toBeGreaterThan(save.indexOf('saveUserSettings(settings)'));
    const invite = /async function joinClass[\s\S]*?\n\}\n/.exec(api)?.[0] ?? '';
    // The class the phone had is taken before the link's site is saved; the board goes with the old feed.
    expect(invite.indexOf('const was = ')).toBeGreaterThan(-1);
    expect(invite.indexOf('const was = ')).toBeLessThan(invite.indexOf('savePastedSite(storage, site)'));
    expect(invite.indexOf('forgetFeed(storage)')).toBeGreaterThan(invite.indexOf('await followClass('));
    expect(invite.indexOf('dropOwnBoardOnClassChange(storage, was, { classId: option.id, siteUrl: site })')).toBeGreaterThan(invite.indexOf('forgetFeed(storage)'));
  });

  it('forgets the copies kept with the exams the student moved in the same two places, when the class did change', () => {
    const api = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'local', 'phoneApi.ts'), 'utf8');
    const save = /async function saveSettings[\s\S]*?\n\}\n/.exec(api)?.[0] ?? '';
    const invite = /async function joinClass[\s\S]*?\n\}\n/.exec(api)?.[0] ?? '';
    expect(save).toMatch(/if \(dropOwnBoardOnClassChange\(storage, \{ classId: before\.classId \}, \{ classId: settings\.classId \}\)\) dropKeptCopies\(storage\);/);
    expect(invite).toMatch(/if \(dropOwnBoardOnClassChange\(storage, was, \{ classId: option\.id, siteUrl: site \}\)\) dropKeptCopies\(storage\);/);
    expect(api).toMatch(/import \{ dropKeptCopies \} from '\.\/examPrefs';/);
  });
});

describe('how the app wires it (read from the source: the modules need a phone)', () => {
  const app = (...parts: string[]) => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', ...parts), 'utf8');
  const source = app('local', 'source.ts');

  it("reads the stored feed raw and lays the phone's board over it for every reader of the sources", () => {
    expect(source).toMatch(/return sameOrRead\(DEVICE_KEYS\.feed, \(\) => storedFeed\(storage\)\)/);
    expect(source).toMatch(/const classFeed = classFeedNow\(\)/);
    expect(source).toMatch(/const ownBoard = sameOrRead\(OWN_BOARD_KEY, \(\) => readOwnBoard\(storage\)\)/);
    expect(source).toMatch(/const feed = withOwnBoard\(classFeed, ownBoard\)/);
    expect(source).toMatch(/deviceCalendars\(mirrorCalendar, feed, ownBoard\)/);
    // The server's feed is never written back with the board in it.
    expect(source).not.toMatch(/DEVICE_KEYS\.feed,\s*JSON\.stringify/);
  });

  it('reads the own calendar after the class feed, in the same step, and says once when it failed', () => {
    const step = /if \(reads\.feed\) \{[\s\S]*?\n  \}\n/.exec(source)?.[0] ?? '';
    expect(step).toBeTruthy();
    expect(step.indexOf('refreshFeed(storage)')).toBeGreaterThan(-1);
    expect(step.indexOf('refreshOwnBoardRead(')).toBeGreaterThan(step.indexOf('refreshFeed(storage)'));
    expect(step.indexOf('refreshOtherChildren()')).toBeGreaterThan(step.indexOf('refreshOwnBoardRead('));
    expect(step.match(/OWN_BOARD_READ_FAILED/g)).toHaveLength(1);
  });

  it('says the class board was read only as the refresh read it: the fresh feed of the class on screen, the own board as observed (A-I5, L234)', () => {
    const step = /if \(reads\.feed\) \{[\s\S]*?\n  \}\n/.exec(source)?.[0] ?? '';
    expect(step).toMatch(/feedRead = isFeedObserved\(fresh, shownClass\(settings\.classId\)\);/);
    // A-M5: a class board turned off over a class seen to have none is removed, after the feed is read
    expect(step).toMatch(/if \(feedRead && fresh\) dropNoneOverNoBoard\(storage, fresh\.class\);/);
    expect(step.indexOf('dropNoneOverNoBoard(')).toBeGreaterThan(step.indexOf('refreshFeed(storage)'));
    expect(source).toMatch(/ownReadFailed = ownRead\.failed;/);
    expect(source).toMatch(
      /examSourcesRead\(\{ feed: feedRead, mashov: mashovRead, ownBoard: ownBoardObserved\(readOwnBoard\(storage\), src\.feed !== null, ownReadFailed\) \}\)/,
    );
  });

  it('reads the own calendar by itself at most hourly, and at once on a refresh the person asked for (A-I1)', () => {
    // `force` is what a pull to refresh sets (`sync` in phoneApi.ts); a foreground, a push and the background task do not.
    expect(source).toMatch(/refreshOwnBoardRead\(storage, todayStr\(TIMEZONE\), TIMEZONE, undefined, \{ force: opts\.force === true \}\)/);
    expect(app('local', 'phoneApi.ts')).toMatch(/sync: async \(\) => \{\s*await refreshLocalSources\(\{ force: true \}\);/);
  });

  it("lays each other child's own board over its feed, and a twin reads the class's feed as the server sent it", () => {
    expect(source).toMatch(/const feed = childFeed\(child, kept, shown\)/);
    expect(source).toMatch(/deviceCalendars\(null, feed, kept\.ownBoard\)/);
    expect(source.match(/feed: classFeedNow\(\)/g)).toHaveLength(2);
    expect(source).not.toMatch(/feed: src\.feed \}/);
  });

  it('is wiped with the rest by "מחק את הנתונים שלי": the whole store, every child\'s stash with it', () => {
    expect(app('local', 'deleteMyDataRun.ts')).toMatch(/function wipeStorage\(\): void \{\s*storage\.clearAll\(\);/);
  });

  it('is not read in the demo, which builds its sources from its own made-up feed', () => {
    expect(app('demo', 'phone.ts')).not.toMatch(/from '..\/local\/ownBoard'/);
    expect(app('demo', 'sources.ts')).not.toMatch(/ownBoard/i);
    expect(source).toMatch(/if \(isDemo\(\)\) return demoLocalSources\(now\)/);
    expect(DEVICE_KEYS.feed).toBe('device.feed');
  });
});
