/**
 * The phone's side of the exam board (design doc, "לוח משלי, כשלכיתה כבר יש לוח" and "באפליקציה"): the two calls to
 * `/v2/device/exam-board` (app/src/device/v2.ts) and the pure functions the screens decide by
 * (app/src/lib/examBoard.ts). No screen here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAM_BOARD_ERRORS, type BoardRow, type BoardSkipped, type CalendarPreview, type ClassExam, type DateStr, type DeviceClass, type ExamBoardInfo } from '@sederyom/shared';
import {
  BOARD_FILE_MAX_BYTES, CANCEL_LABEL, OWN_HIDDEN_TOAST, OwnBoardError, SAVE_ROWS_MAX, afterClassSave, backLabel, backdropCloses, blockActions, blockQuestion, boardActions, boardFileProblem, boardOwner, boardProblem, boardStatusLine,
  bringTarget, calendarExamCount, chooseTarget, chosenCount, classHasBoard, classSavedToast, clearMarks, closeAction, confirmedRows, confirmItems, examStepOffersBoard, examsTabSourceLine, fileProblemSentence, fixedSkipped,
  foldsAtStart, holdsOwnBoard, inSchoolYear, initialSelection, isOwnBoardExam, leaveQuestion, previewProblem, boardSourceName, closeOffset, fileNameLine,
  markExams, markExamsLabel, ownRemovedToast, ownSavedToast, pastExamsLine, pickClassFirst, previewSelection, previewStep, removalFailed, replacesOwnBoard, revealOffset, rowsToSave, saveFailed, saveTarget, saveVerdict, selectionChanged, setRowDate, setSkippedDate,
  confirmFooter, shownOwnBoard, skippedParts, skippedReason, sourceLine, spareTargetLine, startTarget, targetLine, toggleRow, type BoardOwner, type ConfirmSelection,
} from '../../app/src/lib/examBoard';
import { OwnCalendarUnreadError, type OwnBoard } from '../../app/src/local/ownBoard';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { DEVICE_KEYS, V2Error, previewExamBoard, saveExamBoard, storedIdentity } = await import('../../app/src/device/v2');

afterEach(() => {
  vi.useRealTimers();
});

function memoryKv(withDevice = true) {
  const map = new Map<string, string>();
  if (withDevice) map.set(DEVICE_KEYS.identity, JSON.stringify({ deviceId: 'd1', token: 't1' }));
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

interface Call {
  method: string;
  path: string;
  token: string | null;
  contentType: string | null;
  rawBody: string | null;
}

/** A `/v2` that answers the board's two routes with `answer` and records what it was sent. */
function fakeServer(answer: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const auth = headers.authorization ?? null;
    calls.push({
      method: init.method ?? 'GET',
      path: url.replace(/^.*?(\/v2)/, '$1'),
      token: auth ? auth.slice('Bearer '.length) : null,
      contentType: headers['content-type'] ?? null,
      rawBody: typeof init.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** A `/v2` that never answers; the signal it was given is how a test sees the timeout. */
function hangingServer() {
  const seen: { signal: AbortSignal | null } = { signal: null };
  const fetchImpl = ((_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => {
      seen.signal = init.signal ?? null;
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    })) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const ROWS = [
  { date: '2026-12-01' as const, title: 'מתמטיקה', details: 'פרקים 1–3' },
  { date: '2026-12-03' as const, title: 'ספרות', details: null },
];

const CLASS_BASE: DeviceClass = { siteUrl: 'https://school-g.shahaf.site', classId: '7', className: 'יב2' };
/** The day the confirm screen is opened on, in the tests of what it starts with ticked: before every row of `ROWS_IN`. */
const TODAY: DateStr = '2026-11-11';
const info = (over: Partial<ExamBoardInfo> = {}): ExamBoardInfo => ({ kind: 'upload', setAt: '2026-11-01T08:00:00.000Z', count: 12, mine: false, mayChange: false, ...over });

describe('previewExamBoard', () => {
  it('posts the link as it was given, with the device token', async () => {
    const preview = { kind: 'columns' as const, columns: ['יב1', 'יב2'] };
    const server = fakeServer({ status: 200, body: preview });
    const got = await previewExamBoard(memoryKv(), { link: 'https://example.org/exams' }, server.fetchImpl);
    expect(got).toEqual(preview);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ method: 'POST', path: '/v2/device/exam-board/preview', token: 't1', contentType: 'application/json' });
    expect(JSON.parse(server.calls[0]!.rawBody!)).toEqual({ link: 'https://example.org/exams' });
  });

  it('posts a file and the column picked, and passes the base64 on as it is', async () => {
    const base64 = 'UEsDBBQAAAAIAA==';
    const server = fakeServer({ status: 200, body: { kind: 'rows', layout: 'grid', rows: [], skipped: [] } });
    await previewExamBoard(memoryKv(), { file: { name: 'exams.xlsx', base64 }, column: 'יב2' }, server.fetchImpl);
    const sent = JSON.parse(server.calls[0]!.rawBody!);
    expect(sent).toEqual({ file: { name: 'exams.xlsx', base64 }, column: 'יב2' });
    expect(sent.file.base64).not.toMatch(/\s/);
  });

  it('waits 30 seconds, not the 20 of the other calls', async () => {
    vi.useFakeTimers();
    const server = hangingServer();
    const call = previewExamBoard(memoryKv(), { link: 'https://example.org/exams' }, server.fetchImpl);
    const failure = call.then(() => null, (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(server.seen.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.seen.signal?.aborted).toBe(true);
    const err = await failure;
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('throws the server\'s code, its status and its sentence', async () => {
    const server = fakeServer({ status: 422, body: { error: 'private_sheet', message: 'הגיליון הזה לא משותף לכולם.' } });
    const err = await previewExamBoard(memoryKv(), { link: 'https://docs.google.com/spreadsheets/d/x' }, server.fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect(err).toMatchObject({ status: 422, code: 'private_sheet', message: 'הגיליון הזה לא משותף לכולם.' });
  });

  it('carries the code of a refusal that has none of its own in the message', async () => {
    const server = fakeServer({ status: 429, body: { error: 'rate_limited', message: 'ניסית יותר מדי פעמים בשעה האחרונה, אפשר לנסות שוב בעוד קצת.' } });
    const err = await previewExamBoard(memoryKv(), { link: 'https://example.org/exams' }, server.fetchImpl).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('is a 409 no_class, with no request, for a phone with no device', async () => {
    const server = fakeServer({ status: 200, body: {} });
    const err = await previewExamBoard(memoryKv(false), { link: 'https://example.org/exams' }, server.fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect(err).toMatchObject({ status: 409, code: 'no_class' });
    expect(server.calls).toEqual([]);
  });

  it('forgets a device the server no longer knows, and says the same', async () => {
    const kv = memoryKv();
    const server = fakeServer({ status: 401, body: { error: 'unauthorized', message: 'missing or invalid device token' } });
    const err = await previewExamBoard(kv, { link: 'https://example.org/exams' }, server.fetchImpl).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: 'no_class' });
    expect(storedIdentity(kv)).toBeNull();
    expect(server.calls).toHaveLength(1);
  });
});

describe('saveExamBoard', () => {
  it('puts the rows and gives back the device', async () => {
    const device = { deviceId: 'd1', platform: 'android', hasPushToken: false, prefs: {}, class: { ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) } };
    const server = fakeServer({ status: 200, body: device });
    const got = await saveExamBoard(memoryKv(), ROWS, server.fetchImpl);
    expect(got).toEqual(device);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ method: 'PUT', path: '/v2/device/exam-board', token: 't1', contentType: 'application/json' });
    expect(JSON.parse(server.calls[0]!.rawBody!)).toEqual({ rows: ROWS });
  });

  it('waits the default 20 seconds', async () => {
    vi.useFakeTimers();
    const server = hangingServer();
    const failure = saveExamBoard(memoryKv(), ROWS, server.fetchImpl).then(() => null, (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(server.seen.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.seen.signal?.aborted).toBe(true);
    expect(((await failure) as DOMException).name).toBe('AbortError');
  });

  it('throws calendar_locked with its 403', async () => {
    const server = fakeServer({ status: 403, body: { error: 'calendar_locked', message: 'ללוח המבחנים של הכיתה כבר יש קישור, ורק מי שהוסיף אותו יכול להחליף או להסיר אותו.' } });
    const err = await saveExamBoard(memoryKv(), ROWS, server.fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2Error);
    expect(err).toMatchObject({ status: 403, code: 'calendar_locked' });
  });

  it('throws bad_rows and too_big with their 422', async () => {
    for (const code of ['bad_rows', 'too_big'] as const) {
      const server = fakeServer({ status: 422, body: { error: code, message: 'x' } });
      const err = await saveExamBoard(memoryKv(), ROWS, server.fetchImpl).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 422, code });
    }
  });

  it('is a 409 no_class, with no request, for a phone with no device', async () => {
    const server = fakeServer({ status: 200, body: {} });
    const err = await saveExamBoard(memoryKv(false), ROWS, server.fetchImpl).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: 'no_class' });
    expect(server.calls).toEqual([]);
  });
});

describe('boardOwner', () => {
  it('is none for no class, a class with no board, and a class an older server sent no board for', () => {
    expect(boardOwner(null, null)).toBe('none');
    expect(boardOwner(undefined, null)).toBe('none');
    expect(boardOwner(CLASS_BASE, null)).toBe('none');
    expect(boardOwner({ ...CLASS_BASE, examCalendarId: null, examBoard: null }, null)).toBe('none');
  });

  it('is class-mine for the board this device brought', () => {
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) }, null)).toBe('class-mine');
    // Not allowed to replace it now (it follows another class), and still the one that brought it.
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: true, mayChange: false }) }, null)).toBe('class-mine');
  });

  it('is class-open when the one who brought the board has left and this device may replace it', () => {
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: false, mayChange: true }) }, null)).toBe('class-open');
  });

  it('is class-other for a board another device brought and this one may not replace', () => {
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: false, mayChange: false }) }, null)).toBe('class-other');
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ kind: 'calendar', setAt: null, count: 0 }) }, null)).toBe('class-other');
  });

  it('is class-other for a calendar id with no board info (an older server)', () => {
    expect(boardOwner({ ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, null)).toBe('class-other');
  });

  it('is own for a board of the phone\'s own, whatever the class has', () => {
    for (const kind of ['rows', 'calendar'] as const) {
      expect(boardOwner(null, { kind })).toBe('own');
      expect(boardOwner(CLASS_BASE, { kind })).toBe('own');
      expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) }, { kind })).toBe('own');
      expect(boardOwner({ ...CLASS_BASE, examCalendarId: 'abc' }, { kind })).toBe('own');
    }
  });

  it('is own-none when the person turned the class\'s board off for themselves, over a class that has one', () => {
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: false, mayChange: false }) }, { kind: 'none' })).toBe('own-none');
    expect(boardOwner({ ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) }, { kind: 'none' })).toBe('own-none');
    expect(boardOwner({ ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, { kind: 'none' })).toBe('own-none');
  });

  it('is what a class with no board is when the class\'s board is turned off over a class that has none (A-M5)', () => {
    expect(boardOwner(CLASS_BASE, { kind: 'none' })).toBe('none');
    expect(boardOwner(null, { kind: 'none' })).toBe('none');
    expect(shownOwnBoard(CLASS_BASE, { kind: 'none' })).toBeNull();
    // every other board of the phone's own stays what it is
    expect(shownOwnBoard(CLASS_BASE, { kind: 'rows' })).toEqual({ kind: 'rows' });
    const withBoard = { ...CLASS_BASE, examBoard: info() };
    expect(shownOwnBoard(withBoard, { kind: 'none' })).toEqual({ kind: 'none' });
    // and a board brought then goes to the class, as where there is no board
    expect(bringTarget(CLASS_BASE, { kind: 'none' })).toEqual({ target: 'class', choice: false });
    expect(blockActions(boardOwner(CLASS_BASE, { kind: 'none' }), null)).toEqual([]);
  });
});

describe('saveTarget', () => {
  const OPEN = info({ mine: false, mayChange: true });
  const MINE_MAY = info({ mine: true, mayChange: true });
  const MINE_LOCKED = info({ mine: true, mayChange: false });
  const OTHER = info();

  it('saves for the class when there is no board, with nothing to choose', () => {
    expect(saveTarget('none', null)).toEqual({ target: 'class', choice: false });
  });

  it('saves for the class by default when the board is mine and may be changed, and lets the person keep it to themselves', () => {
    expect(saveTarget('class-mine', MINE_MAY)).toEqual({ target: 'class', choice: true });
  });

  it('keeps it on the phone when the board is mine and may not be changed now', () => {
    expect(saveTarget('class-mine', MINE_LOCKED)).toEqual({ target: 'own', choice: false });
    expect(saveTarget('class-mine', null)).toEqual({ target: 'own', choice: false });
  });

  it('defaults to a board of their own on an open board, and lets them update the class\'s', () => {
    expect(saveTarget('class-open', OPEN)).toEqual({ target: 'own', choice: true });
  });

  it('is the person\'s own, with no choice, in every other state', () => {
    expect(saveTarget('class-other', OTHER)).toEqual({ target: 'own', choice: false });
    expect(saveTarget('own', null)).toEqual({ target: 'own', choice: false });
    expect(saveTarget('own', MINE_MAY)).toEqual({ target: 'own', choice: false });
    expect(saveTarget('own-none', OTHER)).toEqual({ target: 'own', choice: false });
  });
});

describe('sourceLine', () => {
  it('says whose the board is, in words a parent may read too (strings, rows 6 to 8)', () => {
    expect(sourceLine('class-other', true)).toBe('מישהו מהכיתה הוסיף את הלוח הזה, והוא משותף לכל הכיתה');
    expect(sourceLine('class-open', true)).toBe('מישהו מהכיתה הוסיף את הלוח הזה, והוא משותף לכל הכיתה');
    expect(sourceLine('class-mine', true)).toBe('הוספת את הלוח הזה, והוא משותף לכל הכיתה');
    expect(sourceLine('own-none', true)).toBe('הלוח של הכיתה מוסתר אצלך');
  });

  it('says a board of the person\'s own is shown in place of the class\'s, when the class has one', () => {
    expect(sourceLine('own', true)).toBe('הלוח הזה שלך בלבד, ומוצג אצלך במקום הלוח של הכיתה');
    expect(sourceLine('own', false)).toBe('הלוח הזה שלך בלבד');
  });

  it('is nothing when there is no board', () => {
    expect(sourceLine('none', false)).toBeNull();
  });

  it('never says a name, a student, or asks anyone to join a class', () => {
    const owners: BoardOwner[] = ['none', 'class-mine', 'class-open', 'class-other', 'own', 'own-none'];
    for (const owner of owners) {
      for (const has of [true, false]) {
        expect(sourceLine(owner, has) ?? '').not.toMatch(/להצטרף/);
        expect(sourceLine(owner, has) ?? '').not.toMatch(/תלמיד|הכיתה שלך/);
      }
    }
  });
});

describe('examStepOffersBoard', () => {
  const OWNERS: BoardOwner[] = ['none', 'class-mine', 'class-open', 'class-other', 'own', 'own-none'];

  it('offers to bring a board when the class has no exams and no board', () => {
    expect(examStepOffersBoard(0, 'none')).toBe(true);
  });

  it('does not offer once the class has any exam, whoever the board is', () => {
    for (const owner of OWNERS) {
      expect(examStepOffersBoard(1, owner)).toBe(false);
      expect(examStepOffersBoard(23, owner)).toBe(false);
    }
  });

  it('does not offer where there is a board, even one with no exams in it (the step says whose it is instead)', () => {
    for (const owner of OWNERS.filter((o) => o !== 'none')) expect(examStepOffersBoard(0, owner)).toBe(false);
  });

  it('is what the step shows the form by: the owner is read from the class and the phone\'s own board', () => {
    expect(examStepOffersBoard(0, boardOwner(CLASS_BASE, null))).toBe(true);
    // A phone with a board of its own, or with the class's board turned off, is not offered another one.
    expect(examStepOffersBoard(0, boardOwner(CLASS_BASE, { kind: 'rows' }))).toBe(false);
    expect(examStepOffersBoard(0, boardOwner(CLASS_BASE, { kind: 'calendar' }))).toBe(false);
    expect(examStepOffersBoard(0, boardOwner({ ...CLASS_BASE, examBoard: info() }, { kind: 'none' }))).toBe(false);
    // The class's board turned off over a class that has none is no board (A-M5): the step offers one.
    expect(examStepOffersBoard(0, boardOwner(CLASS_BASE, { kind: 'none' }))).toBe(true);
    // No class at all is `none` too: the function cannot tell it from a class whose feed is not read yet, so the screen
    // offers a board only to a phone that has a class (app/test/onboarding-exam-board.test.cjs).
    expect(examStepOffersBoard(0, boardOwner(null, null))).toBe(true);
    expect(examStepOffersBoard(0, boardOwner({ ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) }, null))).toBe(false);
    expect(examStepOffersBoard(0, boardOwner({ ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, null))).toBe(false);
  });
});

describe('previewSelection', () => {
  it('selects the rows that look like exams, in order', () => {
    const rows: BoardRow[] = [
      { date: '2026-12-01', title: 'מתמטיקה', details: null, isExam: true },
      { date: '2026-12-02', title: 'טיול שנתי', details: null, isExam: false },
      { date: '2026-12-03', title: 'ספרות', details: 'שיר', isExam: true },
    ];
    expect(previewSelection(rows, TODAY)).toEqual([true, false, true]);
    expect(previewSelection([], TODAY)).toEqual([]);
  });

  it('does not tick an exam whose date is before today, and ticks one on today and after (V-11)', () => {
    const rows: BoardRow[] = [
      { date: '2026-09-10', title: 'מבחן בתנ"ך', details: null, isExam: true },
      { date: '2026-11-10', title: 'מבחן באנגלית', details: null, isExam: true },
      { date: '2026-11-11', title: 'מבחן במתמטיקה', details: null, isExam: true },
      { date: '2026-11-12', title: 'מבחן בספרות', details: null, isExam: true },
      { date: '2026-09-11', title: 'טיול שנתי', details: null, isExam: false },
    ];
    expect(previewSelection(rows, TODAY)).toEqual([false, false, true, true, false]);
  });

  it('starts the confirm screen so, and counts only what is ticked; the person can tick a past exam (V-11)', () => {
    const rows: BoardRow[] = [
      row('2026-10-01', 'מבחן בתנ"ך'),
      row('2026-12-01', 'מבחן במתמטיקה'),
      row('2026-12-03', 'מבחן בספרות'),
    ];
    const sel = initialSelection(rows, [], 'class', TODAY);
    expect(sel.picked).toEqual([false, true, true]);
    expect(chosenCount(sel)).toBe(2);
    const ticked = toggleRow(sel, 0);
    expect(ticked.picked).toEqual([true, true, true]);
    expect(chosenCount(ticked)).toBe(3);
  });

  it('leaves the ticks as they are when a date is corrected, to today or after or before (V-11)', () => {
    const rows: BoardRow[] = [row('2026-10-01', 'מבחן בתנ"ך'), row('2026-12-01', 'מבחן במתמטיקה')];
    const sel = initialSelection(rows, [], 'class', TODAY);
    const later = setRowDate(sel, 0, '2026-12-20', rows[0]!.date);
    expect(later.picked).toBe(sel.picked);
    expect(later.picked).toEqual([false, true]);
    expect(setRowDate(sel, 1, '2026-09-20', rows[1]!.date).picked).toBe(sel.picked);
  });

  it('ticks again what the screen opened with on "לסמן את המבחנים שעוד לא עברו": not a past exam (V-11)', () => {
    const rows: BoardRow[] = [row('2026-10-01', 'מבחן בתנ"ך'), row('2026-12-01', 'מבחן במתמטיקה')];
    const sel = initialSelection(rows, [], 'class', TODAY);
    expect(markExams(clearMarks(toggleRow(sel, 0)), rows, TODAY).picked).toEqual([false, true]);
    expect(selectionChanged(sel, markExams(clearMarks(sel), rows, TODAY))).toBe(false);
  });
});

describe('the bulk tick and the line over a list of past exams (round 3)', () => {
  const ALL = 'לסמן את כל המבחנים';
  const AHEAD = 'לסמן את המבחנים שעוד לא עברו';
  const ALL_PAST = 'כל המבחנים בלוח כבר עברו, אז הם לא סומנו מראש. אפשר לסמן אותם ביד.';
  /** No date corrected: each row's date is the one that was read. */
  const asRead = (rows: readonly BoardRow[]) => rows.map(() => null);

  it('says "all" while it ticks them all: a list with no exam before today', () => {
    const rows = [row('2026-11-11', 'מבחן במתמטיקה'), row('2026-12-01', 'מבחן בספרות'), row('2026-09-01', 'טיול שנתי', { isExam: false })];
    expect(markExamsLabel(rows, asRead(rows), TODAY)).toBe(ALL);
    // a row that is no exam does not count, even before today
    expect(markExamsLabel([row('2026-09-01', 'טיול שנתי', { isExam: false })], [null], TODAY)).toBe(ALL);
    expect(markExamsLabel([], [], TODAY)).toBe(ALL);
  });

  it('says it ticks the ones still ahead once the list holds an exam before today, which it does not tick', () => {
    const rows = [row('2026-11-10', 'מבחן בתנ"ך'), row('2026-12-01', 'מבחן במתמטיקה')];
    expect(markExamsLabel(rows, asRead(rows), TODAY)).toBe(AHEAD);
    // the label is what the action does
    expect(markExams(clearMarks(initialSelection(rows, [], 'class', TODAY)), rows, TODAY).picked).toEqual([false, true]);
    // every exam past is still "the ones ahead": none, so the action ticks nothing
    expect(markExamsLabel([row('2026-10-01', 'מבחן בתנ"ך')], [null], TODAY)).toBe(AHEAD);
  });

  it('says why nothing is ticked when every exam in the list is past, and only then', () => {
    const past = [row('2026-10-01', 'מבחן בתנ"ך'), row('2026-11-10', 'מבחן באנגלית'), row('2026-12-01', 'טיול שנתי', { isExam: false })];
    expect(pastExamsLine(past, asRead(past), TODAY)).toBe(ALL_PAST);
    // the sheet opens with nothing ticked, which the line explains
    expect(initialSelection(past, [], 'class', TODAY).picked.some(Boolean)).toBe(false);
    // one exam on today or after: no line
    const more = [...past, row('2026-11-11', 'מבחן במתמטיקה')];
    expect(pastExamsLine(more, asRead(more), TODAY)).toBeNull();
    // no exam at all is not "every exam is past": the others' fold opens for that list (`foldsAtStart`)
    expect(pastExamsLine([row('2026-10-01', 'טיול שנתי', { isExam: false })], [null], TODAY)).toBeNull();
    expect(pastExamsLine([], [], TODAY)).toBeNull();
  });
});

describe('the bulk tick and its words read the date the person corrected, as a save does (round 4)', () => {
  const ALL = 'לסמן את כל המבחנים';
  const AHEAD = 'לסמן את המבחנים שעוד לא עברו';
  const ALL_PAST = 'כל המבחנים בלוח כבר עברו, אז הם לא סומנו מראש. אפשר לסמן אותם ביד.';

  it('ticks an exam corrected from a past day to one ahead, and says it ticks them all', () => {
    const rows = [row('2026-10-01', 'מבחן בתנ"ך'), row('2026-12-01', 'מבחן במתמטיקה')];
    const opened = initialSelection(rows, [], 'class', TODAY);
    expect(opened.picked).toEqual([false, true]);
    const corrected = setRowDate(opened, 0, '2026-12-20', rows[0]!.date);
    // the correction itself ticks nothing (V-11)
    expect(corrected.picked).toEqual([false, true]);
    // the bulk tick does, as the save would carry it on the 20th
    expect(markExams(corrected, rows, TODAY).picked).toEqual([true, true]);
    expect(markExams(clearMarks(corrected), rows, TODAY).picked).toEqual([true, true]);
    expect(rowsToSave(rows, [], markExams(corrected, rows, TODAY))[0]!.date).toBe('2026-12-20');
    expect(markExamsLabel(rows, corrected.dates, TODAY)).toBe(ALL);
  });

  it('takes a board of past exams with one corrected ahead as not all past', () => {
    const past = [row('2026-10-01', 'מבחן בתנ"ך'), row('2026-11-10', 'מבחן באנגלית')];
    const one = setRowDate(initialSelection(past, [], 'class', TODAY), 1, '2026-11-25', past[1]!.date);
    expect(pastExamsLine(past, one.dates, TODAY)).toBeNull();
    expect(markExamsLabel(past, one.dates, TODAY)).toBe(AHEAD);
    expect(markExams(one, past, TODAY).picked).toEqual([false, true]);
  });

  it('leaves an exam corrected from a day ahead into the past, and says it ticks the ones still ahead', () => {
    const rows = [row('2026-12-01', 'מבחן במתמטיקה'), row('2026-12-03', 'מבחן בספרות')];
    const opened = initialSelection(rows, [], 'class', TODAY);
    const corrected = setRowDate(opened, 0, '2026-10-20', rows[0]!.date);
    // the correction itself unticks nothing (V-11)
    expect(corrected.picked).toEqual([true, true]);
    expect(markExams(corrected, rows, TODAY).picked).toEqual([false, true]);
    expect(markExams(clearMarks(corrected), rows, TODAY).picked).toEqual([false, true]);
    expect(markExamsLabel(rows, corrected.dates, TODAY)).toBe(AHEAD);
    expect(pastExamsLine(rows, corrected.dates, TODAY)).toBeNull();
    // every exam corrected into the past: the line over the list says so
    const both = setRowDate(corrected, 1, '2026-11-01', rows[1]!.date);
    expect(pastExamsLine(rows, both.dates, TODAY)).toBe(ALL_PAST);
    expect(markExams(both, rows, TODAY).picked).toEqual([false, false]);
  });

  it('reads a correction taken back as the date on the board again', () => {
    const rows = [row('2026-10-01', 'מבחן בתנ"ך')];
    const back = setRowDate(setRowDate(initialSelection(rows, [], 'class', TODAY), 0, '2026-12-20', rows[0]!.date), 0, null);
    expect(markExams(back, rows, TODAY).picked).toEqual([false]);
    expect(markExamsLabel(rows, back.dates, TODAY)).toBe(AHEAD);
    expect(pastExamsLine(rows, back.dates, TODAY)).toBe(ALL_PAST);
  });
});

describe('boardProblem', () => {
  const refusal = (status: number, code: string) => new V2Error(status, 'משפט של השרת', code);
  const SENTENCES = new Map<string, string>();

  it('says something different, in Hebrew, for each code the server refuses with', () => {
    for (const code of EXAM_BOARD_ERRORS) {
      const status = code === 'no_class' ? 409 : code === 'rate_limited' ? 429 : 422;
      const text = boardProblem(refusal(status, code));
      expect(text, code).toMatch(/[֐-׿]/);
      expect(text, code).not.toBe('משפט של השרת');
      SENTENCES.set(code, text);
    }
    expect(new Set(SENTENCES.values()).size).toBe(SENTENCES.size);
  });

  it('tells a private sheet to be downloaded as an Excel file and picked as a file, in the button\'s words (strings, row 17)', () => {
    const text = boardProblem(refusal(422, 'private_sheet'));
    expect(text).toBe('הגיליון הזה לא משותף לכולם, אפשר להוריד אותו כקובץ אקסל ולבחור את הקובץ.');
    expect(boardProblem(refusal(422, 'no_board'))).toBe('לא מצאנו לוח מבחנים בדף הזה, אפשר לנסות קישור אחר או לבחור קובץ אקסל.');
  });

  it('says only an Excel (xlsx) file is read', () => {
    const text = boardProblem(refusal(422, 'unsupported_file'));
    expect(text).toBe('אפשר לבחור רק קובץ אקסל מסוג xlsx.');
    // the button says "לבחור קובץ אקסל": no sentence of the board says Excel or upload any more
    for (const code of ['private_sheet', 'no_board', 'unsupported_file']) {
      expect(boardProblem(refusal(422, code))).not.toMatch(/Excel|להעלות/);
    }
  });

  it('says a pasted link leads to a file that cannot be read, and the picked file\'s sentence for a picked file (V-12)', () => {
    const unsupported = refusal(422, 'unsupported_file');
    const link = { link: 'https://school.example/notes.pdf' };
    const file = { file: { name: 'exams.xlsx', base64: 'UEsDBA==' } };
    expect(previewProblem(unsupported, link)).toBe('הקישור מוביל לקובץ שאי אפשר לקרוא. אפשר לבחור קובץ אקסל מסוג xlsx.');
    expect(previewProblem(unsupported, file)).toBe('אפשר לבחור רק קובץ אקסל מסוג xlsx.');
    // the file the picker refused before anything was sent keeps its sentence
    expect(fileProblemSentence('unsupported')).toBe('אפשר לבחור רק קובץ אקסל מסוג xlsx.');
    // every other answer is boardProblem's, for a link as for a file
    for (const err of [refusal(422, 'no_board'), refusal(422, 'too_big'), refusal(429, 'rate_limited'), new TypeError('Network request failed')]) {
      expect(previewProblem(err, link)).toBe(boardProblem(err));
      expect(previewProblem(err, file)).toBe(boardProblem(err));
    }
    expect(previewProblem(refusal(409, 'no_class'), link, 'אני והילדים')).toBe(pickClassFirst('אני והילדים'));
  });

  it('says which two shapes of file are read', () => {
    const text = boardProblem(refusal(422, 'unknown_layout'));
    expect(text).toMatch(/שורה לכל מבחן/);
    expect(text).toMatch(/תאריך/);
    expect(text).toMatch(/שורה לכל תאריך/);
    expect(text).toMatch(/עמודה לכל כיתה/);
  });

  it('shares the wording of "no class" with the exam calendar link, down to the settings page', () => {
    // The sentence ExamCalendarLink said before, for a student and for a parent (`mePageTitle`).
    expect(pickClassFirst('אני ובית הספר')).toBe('קודם צריך לבחור כיתה בהגדרות, ב״אני ובית הספר״.');
    expect(pickClassFirst('אני והילדים')).toBe('קודם צריך לבחור כיתה בהגדרות, ב״אני והילדים״.');
    expect(boardProblem(refusal(409, 'no_class'), 'אני ובית הספר')).toBe(pickClassFirst('אני ובית הספר'));
    expect(boardProblem(refusal(409, 'no_class'), 'אני והילדים')).toBe(pickClassFirst('אני והילדים'));
    // A caller that has no page to name still gets a sentence.
    expect(boardProblem(refusal(409, 'no_class'))).toBe('קודם צריך לבחור כיתה בהגדרות.');
  });

  it('is the lock\'s sentence for a 403, with its code or without', () => {
    const locked = boardProblem(refusal(403, 'calendar_locked'));
    // A-I3: the sheet then saves for the person alone (`saveFailed`), and the sentence says so.
    expect(locked).toBe('לכיתה כבר יש לוח, אז הלוח הזה יישמר רק אצלך.');
    expect(boardProblem(new V2Error(403, 'forbidden'))).toBe(locked);
  });

  it('says it is not available yet for a 404, whatever the old server put in its answer', () => {
    const text = boardProblem(new V2Error(404, 'Route POST:/v2/device/exam-board/preview not found', 'Not Found'));
    expect(text).toMatch(/עוד לא זמין/);
    expect(text).toMatch(/כמה ימים/);
    // The phone is new and the server old: nothing here asks for an update of the app.
    expect(text).not.toMatch(/לעדכן/);
    expect(boardProblem(new V2Error(404, 'x'))).toBe(text);
  });

  it('says a board is too big without a figure or a noun that may not be the thing that was big', () => {
    // The server refuses a linked page, a file over its size, too many rows and too many cells with one code.
    const text = boardProblem(refusal(422, 'too_big'));
    expect(text).toBe('הלוח גדול מדי ולא הצלחנו לקרוא אותו. אפשר לנסות קובץ קטן יותר.');
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('מגה');
  });

  it('tells a person who asked too often to try again later, by the status or by the code', () => {
    const text = boardProblem(refusal(429, 'rate_limited'));
    expect(text).toMatch(/יותר מדי/);
    expect(boardProblem(new V2Error(429, 'x'))).toBe(text);
  });

  it('says something went wrong for a 500 and for anything it does not know', () => {
    const text = boardProblem(refusal(500, 'preview_failed'));
    expect(text).toMatch(/[֐-׿]/);
    expect(boardProblem(new V2Error(502, 'Bad Gateway'))).toBe(text);
    expect(boardProblem(refusal(400, 'invalid_preview'))).toBe(text);
    expect(boardProblem(refusal(422, 'a_code_from_a_newer_server'))).toBe(text);
    expect(boardProblem(refusal(500, 'internal'))).toBe(text);
  });

  it('is about the connection for a network failure, and about waiting for one that timed out', () => {
    const network = boardProblem(new TypeError('Network request failed'));
    expect(network).toMatch(/חיבור/);
    const timeout = boardProblem(new DOMException('The operation was aborted.', 'AbortError'));
    expect(timeout).toMatch(/[֐-׿]/);
    expect(timeout).not.toBe(network);
    // Nothing else is known about it, and it is still a sentence.
    expect(boardProblem('x')).toBe(network);
    expect(boardProblem(null)).toBe(network);
    expect(boardProblem(new SyntaxError('Unexpected token < in JSON'))).toBe(network);
  });

  it('never asks anyone to join a class and never prints what the server said', () => {
    const all = [
      ...EXAM_BOARD_ERRORS.map((code) => boardProblem(refusal(code === 'no_class' ? 409 : code === 'rate_limited' ? 429 : 422, code))),
      boardProblem(refusal(403, 'calendar_locked')),
      boardProblem(refusal(404, 'Not Found')),
      boardProblem(refusal(500, 'preview_failed')),
      boardProblem(new TypeError('Network request failed')),
      boardProblem(new DOMException('x', 'AbortError')),
    ];
    for (const text of all) {
      expect(text).not.toMatch(/להצטרף/);
      expect(text).not.toContain('משפט של השרת');
      expect(text.length).toBeLessThan(160);
    }
  });
});

// ---- the confirm screen: what it decides, with no screen --------------------------------------------------------------------

const row = (date: DateStr, title: string, over: Partial<BoardRow> = {}): BoardRow => ({ date, title, details: null, isExam: true, ...over });
const ROWS_IN: BoardRow[] = [
  row('2026-12-01', 'מתמטיקה', { details: 'פרקים 1 עד 3' }),
  row('2026-12-02', 'טיול שנתי', { isExam: false }),
  row('2026-12-03', 'ספרות'),
];
const SKIPPED_IN: BoardSkipped[] = [
  { text: '6-12.26 חופשת חנוכה', reason: 'date' },
  { text: '4.10.25 מבחן ישן', reason: 'out_of_year' },
];

describe('confirmedRows', () => {
  it('keeps only the ticked rows, in order, as a date, a title and details', () => {
    expect(confirmedRows(ROWS_IN, [true, false, true], [null, null, null])).toEqual([
      { date: '2026-12-01', title: 'מתמטיקה', details: 'פרקים 1 עד 3' },
      { date: '2026-12-03', title: 'ספרות', details: null },
    ]);
  });

  it('puts the corrected date in the place of the date that was read, and keeps the rest', () => {
    const got = confirmedRows(ROWS_IN, [true, true, true], ['2026-12-10', null, '2026-12-11']);
    expect(got.map((r) => r.date)).toEqual(['2026-12-10', '2026-12-02', '2026-12-11']);
    expect(got.map((r) => r.title)).toEqual(['מתמטיקה', 'טיול שנתי', 'ספרות']);
  });

  it('ignores the date of a row that is not ticked', () => {
    expect(confirmedRows(ROWS_IN, [false, false, true], ['2026-12-10', '2026-12-10', null])).toEqual([
      { date: '2026-12-03', title: 'ספרות', details: null },
    ]);
  });

  it('is empty when nothing is ticked', () => {
    expect(confirmedRows(ROWS_IN, [false, false, false], [null, null, null])).toEqual([]);
    expect(confirmedRows([], [], [])).toEqual([]);
  });

  it('never sends isExam, or anything else the server did not ask for', () => {
    for (const saved of confirmedRows(ROWS_IN, [true, true, true], [null, null, null])) {
      expect(Object.keys(saved).sort()).toEqual(['date', 'details', 'title']);
    }
  });

  it('does not change the rows it was given', () => {
    const before = JSON.stringify(ROWS_IN);
    confirmedRows(ROWS_IN, [true, true, true], ['2026-12-10', null, null]);
    expect(JSON.stringify(ROWS_IN)).toBe(before);
  });
});

describe('fixedSkipped', () => {
  it('takes in only the skipped rows that were given a date', () => {
    expect(fixedSkipped(SKIPPED_IN, [null, null])).toEqual([]);
    expect(fixedSkipped(SKIPPED_IN, ['2026-12-06', null])).toEqual([{ date: '2026-12-06', title: 'חופשת חנוכה', details: null }]);
    expect(fixedSkipped(SKIPPED_IN, ['2026-12-06', '2026-10-04'])).toEqual([
      { date: '2026-12-06', title: 'חופשת חנוכה', details: null },
      { date: '2026-10-04', title: 'מבחן ישן', details: null },
    ]);
  });

  it('makes the title the text without the date as it was written', () => {
    const title = (text: string) => skippedParts(text).title;
    expect(title('6-12.26 חופשת חנוכה')).toBe('חופשת חנוכה');
    expect(title('19-20.10.25 חלופית')).toBe('חלופית');
    expect(title('22.11..26 מבחן במתמטיקה | שיר')).toBe('מבחן במתמטיקה | שיר');
    // A date written with spaces round a dash is still the date.
    expect(title('1.12.26 - 5.12.26 סיור')).toBe('סיור');
    expect(title('19 - 20.10.26 סיור')).toBe('סיור');
  });

  it('strips one number at the start, and not a number that is the start of the title', () => {
    expect(skippedParts('3.12.26 11 מתמטיקה').title).toBe('11 מתמטיקה');
    expect(skippedParts('12 מבחן').title).toBe('מבחן');
  });

  it('keeps a date written in words, since only the part that looks like a date can be told from the title', () => {
    expect(skippedParts('בקרוב סיור | מבחן א').title).toBe('בקרוב סיור | מבחן א');
    // A row with no date cell at all is only its title: nothing of it is a date.
    expect(skippedParts('מבחן במתמטיקה').title).toBe('מבחן במתמטיקה');
  });

  it('says what was stripped, for the row to show beside its reason', () => {
    expect(skippedParts('6-12.26 חופשת חנוכה')).toEqual({ when: '6-12.26', title: 'חופשת חנוכה' });
    expect(skippedParts('מבחן במתמטיקה')).toEqual({ when: null, title: 'מבחן במתמטיקה' });
  });

  it('falls back to the whole text when the date is all there is', () => {
    expect(skippedParts('6-12.26').title).toBe('6-12.26');
    expect(skippedParts('  6-12.26  ').title).toBe('6-12.26');
  });

  it('cuts a long title to what a save takes, never in the middle of a character, and leaves no space at its end', () => {
    const long = `6-12.26 ${'א'.repeat(199)} ${'ב'.repeat(50)}`;
    const [saved] = fixedSkipped([{ text: long, reason: 'date' }], ['2026-12-06']);
    expect(saved!.title.length).toBeLessThanOrEqual(200);
    expect(saved!.title.endsWith(' ')).toBe(false);
    expect(saved!.title).toBe('א'.repeat(199));
    // 100 emoji are 200 UTF-16 units; the 101st would need a lone half of one.
    const emoji = fixedSkipped([{ text: `1.1.26 ${'😀'.repeat(150)}`, reason: 'date' }], ['2026-12-06'])[0]!.title;
    expect(emoji.length).toBe(200);
    expect(emoji).toBe('😀'.repeat(100));
  });

  it('never makes an empty title: the server refuses the whole save for one', () => {
    expect(fixedSkipped([{ text: '', reason: 'date' }], ['2026-12-06'])).toEqual([]);
    expect(fixedSkipped([{ text: '   ', reason: 'date' }], ['2026-12-06'])).toEqual([]);
  });
});

describe('the selection on the confirm screen', () => {
  const start = () => initialSelection(ROWS_IN, SKIPPED_IN, 'class', TODAY);

  it('starts with the rows that look like exams ticked, nothing corrected and no skipped row taken in', () => {
    const sel = start();
    expect(sel.picked).toEqual(previewSelection(ROWS_IN, TODAY));
    expect(sel.picked).toEqual([true, false, true]);
    expect(sel.dates).toEqual([null, null, null]);
    expect(sel.skippedDates).toEqual([null, null]);
    expect(sel.target).toBe('class');
    expect(chosenCount(sel)).toBe(2);
  });

  it('starts on the target it is given', () => {
    expect(initialSelection(ROWS_IN, [], 'own', TODAY).target).toBe('own');
  });

  it('ticks and unticks one row and leaves the others, without changing the selection it started from', () => {
    const a = start();
    const b = toggleRow(a, 1);
    expect(b).not.toBe(a);
    expect(b.picked).toEqual([true, true, true]);
    expect(a.picked).toEqual([true, false, true]);
    expect(toggleRow(b, 0).picked).toEqual([false, true, true]);
    expect(b.dates).toBe(a.dates);
    expect(b.skippedDates).toBe(a.skippedDates);
  });

  it('flips exactly one place of a large board', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => row('2026-12-01', `מבחן ${i}`, { isExam: i % 2 === 0 }));
    const a = initialSelection(rows, [], 'class', TODAY);
    const b = toggleRow(a, 1234);
    const differing = b.picked.flatMap((v, i) => (v !== a.picked[i] ? [i] : []));
    expect(differing).toEqual([1234]);
  });

  it('leaves the selection as it is for a row that is not there', () => {
    const a = start();
    expect(toggleRow(a, 3)).toBe(a);
    expect(toggleRow(a, -1)).toBe(a);
    expect(setRowDate(a, 9, '2026-12-10')).toBe(a);
    expect(setSkippedDate(a, 2, '2026-12-10')).toBe(a);
  });

  it('sets the corrected date of a row, and takes it back', () => {
    const a = start();
    const b = setRowDate(a, 0, '2026-12-10');
    expect(b.dates).toEqual(['2026-12-10', null, null]);
    expect(a.dates).toEqual([null, null, null]);
    expect(setRowDate(b, 0, null).dates).toEqual([null, null, null]);
    // The same date, or the date that was read, is no correction.
    expect(setRowDate(b, 0, '2026-12-10')).toBe(b);
    expect(setRowDate(a, 0, '2026-12-01', '2026-12-01')).toBe(a);
    expect(setRowDate(b, 0, '2026-12-01', '2026-12-01').dates).toEqual([null, null, null]);
  });

  it('counts a skipped row as chosen as soon as it has a date, and not before', () => {
    const a = start();
    const b = setSkippedDate(a, 0, '2026-12-06');
    expect(b.skippedDates).toEqual(['2026-12-06', null]);
    expect(chosenCount(b)).toBe(3);
    // Giving it a date ticks nothing among the rows.
    expect(b.picked).toBe(a.picked);
    const c = setSkippedDate(b, 1, '2026-10-04');
    expect(chosenCount(c)).toBe(4);
    const d = setSkippedDate(c, 0, null);
    expect(d.skippedDates).toEqual([null, '2026-10-04']);
    expect(chosenCount(d)).toBe(3);
  });

  it('counts ticked rows and dated skipped rows together, and unticking lowers it', () => {
    let sel = start();
    sel = toggleRow(sel, 1);
    sel = setSkippedDate(sel, 0, '2026-12-06');
    expect(chosenCount(sel)).toBe(4);
    sel = toggleRow(toggleRow(toggleRow(sel, 0), 1), 2);
    expect(chosenCount(sel)).toBe(1);
  });

  it('chooses where the board goes, and the same choice again is the same selection', () => {
    const a = start();
    const b = chooseTarget(a, 'own');
    expect(b.target).toBe('own');
    expect(a.target).toBe('class');
    expect(b.picked).toBe(a.picked);
    expect(chooseTarget(b, 'own')).toBe(b);
    expect(chooseTarget(b, 'class').target).toBe('class');
  });

  it('saves the ticked rows with their corrections, then the skipped rows that were given a date', () => {
    let sel = start();
    sel = setRowDate(sel, 0, '2026-12-10');
    sel = setSkippedDate(sel, 0, '2026-12-06');
    expect(rowsToSave(ROWS_IN, SKIPPED_IN, sel)).toEqual([
      { date: '2026-12-10', title: 'מתמטיקה', details: 'פרקים 1 עד 3' },
      { date: '2026-12-03', title: 'ספרות', details: null },
      { date: '2026-12-06', title: 'חופשת חנוכה', details: null },
    ]);
    expect(rowsToSave(ROWS_IN, SKIPPED_IN, sel)).toHaveLength(chosenCount(sel));
  });
});

describe('confirmItems', () => {
  const rows = [
    row('2026-12-01', 'מתמטיקה'),
    row('2026-12-02', 'טיול שנתי', { isExam: false }),
    row('2026-12-03', 'ספרות'),
    row('2026-12-04', 'הגשת עבודה', { isExam: false }),
  ];
  const keys = (items: ReturnType<typeof confirmItems>) => items.map((i) => i.key);

  it('puts the exams first, then "other events" folded, then the skipped lines folded', () => {
    const items = confirmItems(rows, SKIPPED_IN, { others: false, skipped: false });
    expect(items).toEqual([
      { key: 'r0', type: 'row', index: 0 },
      { key: 'r2', type: 'row', index: 2 },
      { key: 'fold-others', type: 'fold', fold: 'others', count: 2, open: false },
      { key: 'fold-skipped', type: 'fold', fold: 'skipped', count: 2, open: false },
    ]);
  });

  it('opens each fold on its own, the other events after the exams and the skipped lines last', () => {
    expect(keys(confirmItems(rows, SKIPPED_IN, { others: true, skipped: false }))).toEqual(['r0', 'r2', 'fold-others', 'r1', 'r3', 'fold-skipped']);
    expect(keys(confirmItems(rows, SKIPPED_IN, { others: false, skipped: true }))).toEqual(['r0', 'r2', 'fold-others', 'fold-skipped', 's0', 's1']);
    expect(keys(confirmItems(rows, SKIPPED_IN, { others: true, skipped: true }))).toEqual(['r0', 'r2', 'fold-others', 'r1', 'r3', 'fold-skipped', 's0', 's1']);
  });

  it('has no fold for what is not there', () => {
    expect(keys(confirmItems([row('2026-12-01', 'מתמטיקה')], [], { others: true, skipped: true }))).toEqual(['r0']);
    expect(confirmItems([], [], { others: true, skipped: true })).toEqual([]);
  });

  it('gives every item a key of its own, over a large board', () => {
    const big = Array.from({ length: 2000 }, (_, i) => row('2026-12-01', `מבחן ${i}`, { isExam: i % 3 === 0 }));
    const items = confirmItems(big, SKIPPED_IN, { others: true, skipped: true });
    expect(new Set(keys(items)).size).toBe(items.length);
    expect(items).toHaveLength(2000 + 2 + 2);
  });

  it('opens the fold that is all there is to see: other events when no row looks like an exam, skipped lines when no row was read', () => {
    expect(foldsAtStart(rows, SKIPPED_IN)).toEqual({ others: false, skipped: false });
    expect(foldsAtStart([row('2026-12-02', 'טיול שנתי', { isExam: false })], SKIPPED_IN)).toEqual({ others: true, skipped: false });
    expect(foldsAtStart([], SKIPPED_IN)).toEqual({ others: false, skipped: true });
    expect(foldsAtStart([], [])).toEqual({ others: false, skipped: false });
  });
});

describe('calendarExamCount (V-14)', () => {
  it('says how many exams a calendar of the choice has, and that it has none yet in words', () => {
    expect(calendarExamCount(12)).toBe('12 מבחנים');
    expect(calendarExamCount(1)).toBe('מבחן אחד');
    expect(calendarExamCount(0)).toBe('עוד אין בו מבחנים');
    expect(calendarExamCount(0)).not.toMatch(/\d/);
  });
});

describe('isOwnBoardExam: whose board an exam on the sheet comes from (V-2)', () => {
  const exam = (naturalKey: string, source: string = 'school_site') => ({ naturalKey, source });
  const ownRowsBoard: OwnBoard = {
    kind: 'rows', savedAt: '2026-11-10T12:00:00.000Z',
    exams: [{ naturalKey: 'site-exam|up|0000abcd', date: '2026-12-01', subject: 'מתמטיקה', details: null, source: 'school_site' }],
  };
  const ownCalendarBoard: OwnBoard = {
    kind: 'calendar', calendarId: 'mine@group.calendar.google.com', name: null, readAt: '2026-11-10T12:00:00.000Z', savedAt: '2026-11-10T12:00:00.000Z',
    exams: [{ naturalKey: 'site-exam|uid-1@google.com', date: '2026-12-01', subject: 'ספרות', details: null, source: 'school_site' }],
  };

  it('is the person\'s own board for an exam it holds, by its key, of either kind', () => {
    expect(isOwnBoardExam(exam('site-exam|up|0000abcd'), ownRowsBoard)).toBe(true);
    expect(isOwnBoardExam(exam('site-exam|uid-1@google.com'), ownCalendarBoard)).toBe(true);
  });

  it('is not for an exam the own board does not hold, for none, or for one from elsewhere', () => {
    // an uploaded key that is not the own board's: the class's board
    expect(isOwnBoardExam(exam('site-exam|up|ffff0000'), ownRowsBoard)).toBe(false);
    expect(isOwnBoardExam(exam('site-exam|up|0000abcd'), null)).toBe(false);
    expect(isOwnBoardExam(exam('site-exam|up|0000abcd'), { kind: 'none', savedAt: '2026-11-10T12:00:00.000Z' })).toBe(false);
    // the site's own exams and Mashov's are never a board's
    expect(isOwnBoardExam(exam('site-exam|up|0000abcd', 'shahaf'), ownRowsBoard)).toBe(false);
    expect(isOwnBoardExam(exam('site-exam|up|0000abcd', 'mashov'), ownRowsBoard)).toBe(false);
  });
});

describe('revealOffset: an opened calendar scrolled fully into view above the footer (V-3)', () => {
  // The list's view in the window: from 100 to 600 (the footer starts at 600). The list is scrolled 300 down.
  const VIEW = { top: 100, bottom: 600 };

  it('scrolls nothing when the calendar is in view already', () => {
    expect(revealOffset({ top: 200, bottom: 560 }, VIEW, 300, 8)).toBeNull();
    expect(revealOffset({ top: 108, bottom: 592 }, VIEW, 300, 8)).toBeNull();
  });

  it('brings the calendar\'s bottom up above the footer, with the margin, when it opens under it', () => {
    // a row in the lower half: its calendar runs to 850, 250 under the footer
    expect(revealOffset({ top: 480, bottom: 850 }, VIEW, 300, 8)).toBe(300 + 250 + 8);
    // from the top of the list too
    expect(revealOffset({ top: 480, bottom: 850 }, VIEW, 0, 8)).toBe(258);
  });

  it('brings it down when its top is above the list\'s view', () => {
    expect(revealOffset({ top: 40, bottom: 400 }, VIEW, 300, 8)).toBe(300 - 60 - 8);
    // never above the list's start
    expect(revealOffset({ top: 40, bottom: 400 }, VIEW, 20, 8)).toBe(0);
  });

  it('shows a calendar taller than the view from its top: at the largest text on a small phone', () => {
    // 640 tall in a view of 500: its top goes to the top of the view, wherever it was
    expect(revealOffset({ top: 450, bottom: 1090 }, VIEW, 300, 8)).toBe(300 + 350 - 8);
    expect(revealOffset({ top: 20, bottom: 660 }, VIEW, 300, 8)).toBe(300 - 80 - 8);
    // already there: nothing to do
    expect(revealOffset({ top: 108, bottom: 748 }, VIEW, 300, 8)).toBeNull();
  });

  it('does not move for less than a pixel, which is a rounding of the measure', () => {
    expect(revealOffset({ top: 108.4, bottom: 748.4 }, VIEW, 300, 8)).toBeNull();
    expect(revealOffset({ top: 200, bottom: 600.5 }, VIEW, 300)).toBeNull();
  });
});

describe('skippedReason', () => {
  it('says in a few words why a line was not read, to a person', () => {
    expect(skippedReason('date')).toBe('לא הצלחנו לקרוא את התאריך');
    expect(skippedReason('out_of_year')).toBe('התאריך לא בשנת הלימודים הנוכחית');
  });
});

describe('selectionChanged', () => {
  const start = () => initialSelection(ROWS_IN, SKIPPED_IN, 'class', TODAY);

  it('is false for the selection the screen opened with', () => {
    const a = start();
    expect(selectionChanged(a, a)).toBe(false);
    // The same content in another object is no change either.
    expect(selectionChanged(a, start())).toBe(false);
  });

  it('is true once a row is ticked, corrected, a skipped line is given a date, or the board goes elsewhere', () => {
    const a = start();
    expect(selectionChanged(a, toggleRow(a, 1))).toBe(true);
    expect(selectionChanged(a, toggleRow(a, 0))).toBe(true);
    expect(selectionChanged(a, setRowDate(a, 0, '2026-12-10'))).toBe(true);
    expect(selectionChanged(a, setSkippedDate(a, 0, '2026-12-06'))).toBe(true);
    expect(selectionChanged(a, chooseTarget(a, 'own'))).toBe(true);
  });

  it('is false again when the student puts everything back, by whatever way', () => {
    const a = start();
    expect(selectionChanged(a, toggleRow(toggleRow(a, 1), 1))).toBe(false);
    expect(selectionChanged(a, setRowDate(setRowDate(a, 0, '2026-12-10'), 0, null))).toBe(false);
    expect(selectionChanged(a, setSkippedDate(setSkippedDate(a, 0, '2026-12-06'), 0, null))).toBe(false);
    expect(selectionChanged(a, chooseTarget(chooseTarget(a, 'own'), 'class'))).toBe(false);
    expect(selectionChanged(a, markExams(clearMarks(toggleRow(a, 1)), ROWS_IN, TODAY))).toBe(false);
  });
});

describe('closing the confirm sheet', () => {
  it('closes at once when nothing was changed', () => {
    expect(closeAction(false, false)).toBe('close');
  });

  it('asks first when the student changed something', () => {
    expect(closeAction(true, false)).toBe('ask');
  });

  it('does nothing while a save is under way, changed or not', () => {
    expect(closeAction(false, true)).toBe('ignore');
    expect(closeAction(true, true)).toBe('ignore');
  });

  it('lets a tap beside the sheet close it only when there is nothing to lose', () => {
    expect(backdropCloses(false, false)).toBe(true);
    expect(backdropCloses(true, false)).toBe(false);
    expect(backdropCloses(false, true)).toBe(false);
    expect(backdropCloses(true, true)).toBe(false);
  });
});

describe('leaving the check step with changes (round 4)', () => {
  const start = () => initialSelection(ROWS_IN, SKIPPED_IN, 'class', TODAY);

  it('asks before the way back to the choice drops a tick, a corrected date or a date given to a skipped line, as closing does', () => {
    // The way back ("לבחור יומן אחר", "לבחור עמודה אחרת") throws this step's selection away, as closing does: the same rule.
    const a = start();
    for (const now of [toggleRow(a, 1), setRowDate(a, 0, '2026-12-10'), setSkippedDate(a, 0, '2026-12-06')]) {
      expect(closeAction(selectionChanged(a, now), false)).toBe('ask');
    }
    // nothing changed, or changed and put back: back at once
    expect(closeAction(selectionChanged(a, a), false)).toBe('close');
    expect(closeAction(selectionChanged(a, toggleRow(toggleRow(a, 1), 1)), false)).toBe('close');
    // while a save or a read is under way: nothing
    expect(closeAction(selectionChanged(a, toggleRow(a, 1)), true)).toBe('ignore');
  });

  it('asks each in its own words, with the button that leaves', () => {
    expect(leaveQuestion('close')).toEqual({ line: 'לסגור בלי לשמור?', confirm: 'לסגור' });
    expect(leaveQuestion('back')).toEqual({ line: 'לחזור בלי לשמור את השינויים?', confirm: 'לחזור' });
  });
});

describe('clearing and restoring the ticks', () => {
  const start = () => initialSelection(ROWS_IN, SKIPPED_IN, 'class', TODAY);

  it('takes every tick away, and the skipped lines that were given a date, and keeps the dates the student corrected', () => {
    let sel = toggleRow(start(), 1);
    sel = setRowDate(sel, 0, '2026-12-10');
    sel = setSkippedDate(sel, 1, '2026-10-04');
    expect(chosenCount(sel)).toBe(4);
    const cleared = clearMarks(sel);
    expect(cleared.picked).toEqual([false, false, false]);
    expect(cleared.skippedDates).toEqual([null, null]);
    expect(chosenCount(cleared)).toBe(0);
    expect(cleared.dates).toBe(sel.dates);
    expect(cleared.target).toBe(sel.target);
    expect(rowsToSave(ROWS_IN, SKIPPED_IN, cleared)).toEqual([]);
  });

  it('is the same selection when nothing is ticked', () => {
    const cleared = clearMarks(start());
    expect(clearMarks(cleared)).toBe(cleared);
  });

  it('ticks the rows that look like exams and only them, as the screen opened', () => {
    const a = start();
    const cleared = clearMarks(a);
    const back = markExams(cleared, ROWS_IN, TODAY);
    expect(back.picked).toEqual([true, false, true]);
    expect(back.picked).toEqual(a.picked);
    // Another event the student had ticked is not kept.
    expect(markExams(toggleRow(a, 1), ROWS_IN, TODAY).picked).toEqual([true, false, true]);
  });

  it('is the same selection when the exams are the ticked rows already', () => {
    const a = start();
    expect(markExams(a, ROWS_IN, TODAY)).toBe(a);
  });

  it('leaves the skipped lines and the corrected dates as they are', () => {
    let sel = setSkippedDate(setRowDate(start(), 0, '2026-12-10'), 0, '2026-12-06');
    sel = markExams(clearMarks(sel), ROWS_IN, TODAY);
    // Clearing took the skipped line out; restoring the exams does not bring it back.
    expect(sel.skippedDates).toEqual([null, null]);
    expect(sel.dates).toEqual(['2026-12-10', null, null]);
  });

  it('is the way out of a board that opens with more than 400 rows ticked', () => {
    const big = Array.from({ length: 500 }, (_, i) => row('2026-12-01', `מבחן ${i}`));
    const opened = initialSelection(big, [], 'class', TODAY);
    expect(chosenCount(opened)).toBe(500);
    expect(saveVerdict(chosenCount(opened)).enabled).toBe(false);
    const cleared = clearMarks(opened);
    expect(chosenCount(cleared)).toBe(0);
    // Then a few can be ticked, one by one.
    expect(saveVerdict(chosenCount(toggleRow(cleared, 7)))).toEqual({ enabled: true, line: null });
    expect(chosenCount(markExams(cleared, big, TODAY))).toBe(500);
  });
});

describe('saveVerdict', () => {
  // The sheet always has the save that stays on the phone (`onSaveOwn` is required): no "soon" line any more (strings, row 19).
  it('lets a save of a few rows through, with nothing to say', () => {
    expect(saveVerdict(23)).toEqual({ enabled: true, line: null });
    expect(saveVerdict(1)).toEqual({ enabled: true, line: null });
  });

  it('refuses a save of no rows, and says nothing: the button shows the 0', () => {
    expect(saveVerdict(0)).toEqual({ enabled: false, line: null });
  });

  it('allows 400 rows and refuses 401, and says why', () => {
    expect(SAVE_ROWS_MAX).toBe(400);
    expect(saveVerdict(400)).toEqual({ enabled: true, line: null });
    expect(saveVerdict(401)).toEqual({ enabled: false, line: 'אפשר לשמור עד 400 שורות בבת אחת.' });
    expect(saveVerdict(2000)).toEqual({ enabled: false, line: 'אפשר לשמור עד 400 שורות בבת אחת.' });
  });

  it('is one answer for a calendar, which has no rows to count', () => {
    expect(saveVerdict(null)).toEqual({ enabled: true, line: null });
  });
});

describe('a save that fails', () => {
  const pick = (): ConfirmSelection => setSkippedDate(setRowDate(toggleRow(initialSelection(ROWS_IN, SKIPPED_IN, 'class', TODAY), 1), 0, '2026-12-10'), 0, '2026-12-06');

  it('leaves the selection exactly as it was and says what went wrong', () => {
    const before = pick();
    const snapshot = JSON.stringify(before);
    for (const err of [new V2Error(404, 'Not Found'), new V2Error(422, 'x', 'bad_rows'), new TypeError('Network request failed'), new DOMException('x', 'AbortError')]) {
      const after = saveFailed(before, err);
      expect(after.selection).toBe(before);
      expect(after.problem).toBe(boardProblem(err));
      expect(after.problem).toMatch(/[֐-׿]/);
      expect(after.refused).toBe(false);
    }
    // The ticks, the corrected date and the skipped row's date are all still there.
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(before.picked).toEqual([true, true, true]);
    expect(before.dates[0]).toBe('2026-12-10');
    expect(before.skippedDates[0]).toBe('2026-12-06');
  });

  it('names the settings page for a phone with no class, as the other board sentences do', () => {
    const err = new V2Error(409, 'x', 'no_class');
    expect(saveFailed(pick(), err, 'אני והילדים').problem).toBe(pickClassFirst('אני והילדים'));
  });

  it('turns a class save the lock refused into one for the person alone, every tick and date kept (A-I3)', () => {
    const before = pick();
    for (const err of [new V2Error(403, 'x', 'calendar_locked'), new V2Error(403, 'forbidden'), new V2Error(409, 'x', 'calendar_locked')]) {
      const after = saveFailed(before, err);
      expect(after.selection).toEqual({ ...before, target: 'own' });
      expect(after.problem).toBe('לכיתה כבר יש לוח, אז הלוח הזה יישמר רק אצלך.');
      expect(after.refused).toBe(true);
      // the ticks, the corrected date and the skipped line's date go with it
      expect(after.selection.picked).toBe(before.picked);
      expect(after.selection.dates).toBe(before.dates);
      expect(after.selection.skippedDates).toBe(before.skippedDates);
    }
    // a save for the person alone that failed is not turned anywhere
    const own = chooseTarget(before, 'own');
    expect(saveFailed(own, new V2Error(403, 'x', 'calendar_locked')).selection).toBe(own);
    expect(saveFailed(own, new V2Error(403, 'x', 'calendar_locked')).refused).toBe(false);
  });
});

describe('the confirm sheet\'s footer, before and after a class save the lock refused (V-8)', () => {
  const LOCKED_LINE = 'לכיתה כבר יש לוח, אז הלוח הזה יישמר רק אצלך.';
  const OWN_OVER_BOARD = 'לכיתה כבר יש לוח. הלוח הזה יחליף אותו רק אצלך, ואפשר לחזור ללוח של הכיתה בכל רגע.';
  const opened = { choice: true, classHasBoard: false, holdsOwn: false, refused: false } as const;

  it('shows where the board goes, with the two places to choose from, before anything went wrong', () => {
    expect(confirmFooter({ ...opened, target: 'class', problem: null })).toEqual({
      chips: true, targetLine: targetLine('class', false), problem: null,
    });
  });

  it('shows the refusal alone: no grey target line beside it, and no "לכל הכיתה" any more', () => {
    const failed = saveFailed(initialSelection(ROWS_IN, [], 'class', TODAY), new V2Error(403, 'x', 'calendar_locked'));
    const footer = confirmFooter({
      ...opened, target: failed.selection.target, refused: failed.refused, problem: { text: failed.problem, refusal: failed.refused },
    });
    expect(footer).toEqual({ chips: false, targetLine: null, problem: LOCKED_LINE });
  });

  it('goes back to the own-target line for a class that has a board once the person changes anything, and the chips stay away', () => {
    expect(confirmFooter({ ...opened, target: 'own', refused: true, problem: null })).toEqual({ chips: false, targetLine: OWN_OVER_BOARD, problem: null });
    // the same with a board of the person's own
    expect(confirmFooter({ ...opened, holdsOwn: true, target: 'own', refused: true, problem: null }).targetLine).toBe(OWN_OVER_BOARD);
  });

  it('shows any other problem under the target line, and keeps the choice', () => {
    const failed = saveFailed(initialSelection(ROWS_IN, [], 'class', TODAY), new TypeError('Network request failed'));
    expect(confirmFooter({ ...opened, target: failed.selection.target, refused: failed.refused, problem: { text: failed.problem, refusal: failed.refused } })).toEqual({
      chips: true, targetLine: targetLine('class', false), problem: boardProblem(new TypeError('Network request failed')),
    });
    // a sheet with no choice to give has none to take away
    expect(confirmFooter({ ...opened, choice: false, target: 'class', problem: null }).chips).toBe(false);
  });
});

describe('the way back from the check step to the choice (V-13)', () => {
  const calendars: CalendarPreview[] = [
    { calendarId: 'a@group.calendar.google.com', name: 'ט׳', count: 3, upcoming: [] },
    { calendarId: 'b@group.calendar.google.com', name: 'י׳', count: 2, upcoming: [] },
  ];

  it('is offered, in its own words, only to a check step the person reached through a choice', () => {
    expect(backLabel({ step: 'pick-calendar', calendars })).toBe('לבחור יומן אחר');
    expect(backLabel({ step: 'pick-column', columns: ['ט1', 'ט2'] })).toBe('לבחור עמודה אחרת');
    // a link or a file that led straight to the check step has no choice to go back to
    expect(backLabel(null)).toBeNull();
  });

  it('starts the next check step where the board can go: for the person alone once the lock refused a class save', () => {
    expect(startTarget('class', false)).toBe('class');
    expect(startTarget('own', false)).toBe('own');
    expect(startTarget('class', true)).toBe('own');
    expect(startTarget('own', true)).toBe('own');
  });

  it('keeps knowing the class has a board after the lock refused a save, through the way back and another column', () => {
    const OWN_OVER_BOARD = 'לכיתה כבר יש לוח. הלוח הזה יחליף אותו רק אצלך, ואפשר לחזור ללוח של הכיתה בכל רגע.';
    const opened = { choice: true, classHasBoard: false, holdsOwn: false } as const;
    // the first column, saved for the class: refused by the lock
    const failed = saveFailed(initialSelection(ROWS_IN, [], 'class', TODAY), new V2Error(403, 'x', 'calendar_locked'));
    expect(failed.refused).toBe(true);
    // back to "איזו עמודה?", and another column: the sheet was opened for the class, but the class has a board now
    const next = initialSelection([row('2026-12-02', 'מבחן בספרות')], [], startTarget('class', failed.refused), TODAY);
    expect(next.target).toBe('own');
    // the sentence of the refusal is gone with the step it was said on; the footer says where this board goes
    expect(confirmFooter({ ...opened, target: next.target, refused: failed.refused, problem: null })).toEqual({
      chips: false, targetLine: OWN_OVER_BOARD, problem: null,
    });
    // without a refusal the next column starts for the class, with the choice, as the sheet opened
    const fresh = initialSelection([row('2026-12-02', 'מבחן בספרות')], [], startTarget('class', false), TODAY);
    expect(confirmFooter({ ...opened, target: fresh.target, refused: false, problem: null }).chips).toBe(true);
    expect(fresh.target).toBe('class');
  });
});

describe('the confirm sheet keeps still (V-17)', () => {
  it('puts the list back where it was when a calendar the list scrolled to closes, if the person has not scrolled since', () => {
    // opened at 120, the list scrolled to 380 to show the calendar; it closes with the list still at 380
    expect(closeOffset(120, 380, 380)).toBe(120);
    expect(closeOffset(120, 380, 380.4)).toBe(120);
    // the person scrolled on their own since: the list stays where they took it
    expect(closeOffset(120, 380, 300)).toBeNull();
    // the calendar was in view already, so nothing scrolled: nothing to put back
    expect(closeOffset(null, null, 120)).toBeNull();
    expect(closeOffset(120, null, 120)).toBeNull();
  });

  it('keeps room in the footer for the longer of the two lines while the two places are offered', () => {
    const opened = { choice: true, classHasBoard: false, holdsOwn: false, refused: false, problem: null } as const;
    expect(spareTargetLine({ ...opened, target: 'class' })).toBe(targetLine('own', false));
    expect(spareTargetLine({ ...opened, target: 'own' })).toBe(targetLine('class', false));
    expect(spareTargetLine({ ...opened, classHasBoard: true, holdsOwn: true, target: 'own' })).toBe(targetLine('class', true, true));
    // no choice, or none any more after a refused class save: one line, nothing to keep room for
    expect(spareTargetLine({ ...opened, choice: false, target: 'class' })).toBeNull();
    expect(spareTargetLine({ ...opened, refused: true, target: 'own' })).toBeNull();
    // while the refusal is said in place of the line, there is no line to keep room for
    expect(spareTargetLine({ ...opened, target: 'own', problem: { text: 'x', refusal: true } })).toBeNull();
  });
});

describe('the picked file\'s name (V-18)', () => {
  it('is the name of a file that was picked, and nothing for a link', () => {
    expect(boardSourceName({ file: { name: 'לוח מבחנים ט.xlsx', base64: 'AA==' } })).toBe('לוח מבחנים ט.xlsx');
    expect(boardSourceName({ file: { name: 'grade9-list.xlsx', base64: 'AA==' } })).toBe('grade9-list.xlsx');
    expect(boardSourceName({ link: 'https://school.example/board.xlsx' })).toBeNull();
  });

  it('is said after "הקובץ:", in a first-strong isolate: the line is Hebrew whatever the name, and a Latin name keeps its order', () => {
    expect(fileNameLine('grade9-list.xlsx')).toBe('הקובץ: ⁨grade9-list.xlsx⁩');
    expect(fileNameLine('לוח מבחנים ט.xlsx')).toBe('הקובץ: ⁨לוח מבחנים ט.xlsx⁩');
  });
});

describe('a removal of the class\'s board that is refused (R2)', () => {
  it('says the class\'s board was replaced in the meantime, and reads the class again, for a 403 with its code or without', () => {
    for (const err of [new V2Error(403, 'x', 'calendar_locked'), new V2Error(403, 'forbidden'), new V2Error(409, 'x', 'calendar_locked')]) {
      expect(removalFailed(err)).toEqual({ problem: 'הלוח של הכיתה הוחלף בינתיים, אז אי אפשר להסיר אותו.', readAgain: true });
    }
  });

  it('says what boardProblem says of anything else, and reads nothing again', () => {
    for (const err of [new TypeError('Network request failed'), new V2Error(500, 'x', 'internal'), new V2Error(404, 'x'), new DOMException('x', 'AbortError')]) {
      expect(removalFailed(err)).toEqual({ problem: boardProblem(err), readAgain: false });
    }
    expect(removalFailed(new V2Error(409, 'x', 'no_class'), 'אני והילדים').problem).toBe(pickClassFirst('אני והילדים'));
  });

  it('never says the refused save\'s sentence, which is for saves only', () => {
    expect(removalFailed(new V2Error(403, 'x', 'calendar_locked')).problem).not.toBe(boardProblem(new V2Error(403, 'x', 'calendar_locked')));
  });
});

describe('previewStep', () => {
  const cal = (calendarId: string, count = 3): CalendarPreview => ({ calendarId, name: `יומן ${calendarId}`, count, upcoming: [{ date: '2026-12-01', subject: 'מתמטיקה' }] });
  const noBoard = boardProblem(new V2Error(422, 'x', 'no_board'));

  it('goes straight to the confirm screen for one calendar', () => {
    const a = cal('a@group.calendar.google.com');
    expect(previewStep({ kind: 'calendar', calendars: [a] })).toEqual({ step: 'confirm', choice: { kind: 'calendar', calendar: a } });
  });

  it('lets the student pick when the page had several calendars, in the order the server gave them', () => {
    const calendars = [cal('a'), cal('b'), cal('c')];
    expect(previewStep({ kind: 'calendar', calendars })).toEqual({ step: 'pick-calendar', calendars });
  });

  it('asks which column when the file had several and none was the class', () => {
    expect(previewStep({ kind: 'columns', columns: ['יב1', 'יב2'] })).toEqual({ step: 'pick-column', columns: ['יב1', 'יב2'] });
  });

  it('goes to the confirm screen for rows, and for a board whose every line was skipped', () => {
    const rows = { kind: 'rows' as const, layout: 'list' as const, rows: ROWS_IN, skipped: [] };
    expect(previewStep(rows)).toEqual({ step: 'confirm', choice: rows });
    const skippedOnly = { kind: 'rows' as const, layout: 'grid' as const, rows: [], skipped: SKIPPED_IN };
    expect(previewStep(skippedOnly)).toEqual({ step: 'confirm', choice: skippedOnly });
  });

  it('treats nothing found as no board: no calendars, no columns, no rows and no skipped lines', () => {
    expect(previewStep({ kind: 'calendar', calendars: [] })).toEqual({ step: 'problem', problem: noBoard });
    expect(previewStep({ kind: 'columns', columns: [] })).toEqual({ step: 'problem', problem: noBoard });
    expect(previewStep({ kind: 'rows', layout: 'list', rows: [], skipped: [] })).toEqual({ step: 'problem', problem: noBoard });
    expect(noBoard).toMatch(/לא מצאנו לוח/);
  });
});

describe('boardFileProblem', () => {
  it('takes an xlsx file of any case, up to 1 MB', () => {
    expect(BOARD_FILE_MAX_BYTES).toBe(1_048_576);
    expect(boardFileProblem('exams.xlsx', 2000)).toBeNull();
    expect(boardFileProblem('לוח מבחנים.XLSX', 2000)).toBeNull();
    expect(boardFileProblem('exams.XlSx', 0)).toBeNull();
    expect(boardFileProblem('exams.xlsx', 1_048_576)).toBeNull();
  });

  it('refuses a file over 1 MB as too big', () => {
    expect(boardFileProblem('exams.xlsx', 1_048_577)).toBe('too_big');
    expect(boardFileProblem('exams.xlsx', 50_000_000)).toBe('too_big');
  });

  it('refuses anything that is not an xlsx file by its name', () => {
    for (const name of ['exams.xls', 'exams.pdf', 'exams.xlsm', 'exams.csv', 'exams', 'xlsx', 'exams.xlsx.pdf', 'exams.xlsx ', '']) {
      expect(boardFileProblem(name, 1000), name).toBe('unsupported');
    }
  });

  it('says it is the wrong kind of file before it says the file is big', () => {
    expect(boardFileProblem('scan.pdf', 5_000_000)).toBe('unsupported');
  });
});

describe('targetLine', () => {
  it('says the board goes to the whole class: seen by everyone in it, maybe with a push, or updated for them (strings, rows 3 and 4)', () => {
    expect(targetLine('class', false)).toBe('כל מי שבכיתה יראה את הלוח הזה, ועשויה להישלח להם התראה שנוסף לוח מבחנים.');
    expect(targetLine('class', true)).toBe('הלוח יתעדכן אצל כל מי שבכיתה.');
  });

  it('says the class already has a board when it does, and that this one replaces it for the person alone (strings, row 5)', () => {
    expect(targetLine('own', true)).toBe('לכיתה כבר יש לוח. הלוח הזה יחליף אותו רק אצלך, ואפשר לחזור ללוח של הכיתה בכל רגע.');
  });

  it('does not say the class has a board when it has none', () => {
    expect(targetLine('own', false)).toBe('הלוח הזה יישמר רק אצלך.');
  });

  it('never asks anyone to join a class', () => {
    for (const text of [targetLine('class', true), targetLine('own', true), targetLine('own', false)]) expect(text).not.toMatch(/להצטרף/);
  });
});

describe('boardStatusLine', () => {
  // Midday in UTC, so the same day on any clock between Hawaii and New Zealand.
  const SET = '2026-11-10T12:00:00.000Z';
  const READ = '2026-11-10T12:30:00.000Z';
  const classWith = (examBoard: ExamBoardInfo | null, over: Partial<DeviceClass> = {}): DeviceClass => ({ ...CLASS_BASE, examBoard, ...over });
  const examsOf = (n: number): ClassExam[] =>
    Array.from({ length: n }, (_, i) => ({ naturalKey: `site-exam|${i}`, date: '2026-12-01', subject: `מבחן ${i}`, details: null, source: 'school_site' as const }));
  const ownRows = (n: number): OwnBoard => ({ kind: 'rows', exams: examsOf(n), savedAt: SET });
  const ownCalendar = (n: number, readAt: string | null): OwnBoard => ({ kind: 'calendar', calendarId: 'mine@group.calendar.google.com', name: null, exams: examsOf(n), readAt, savedAt: SET });

  it('says when a board of rows was brought and how many exams it has, and not that it came from a file: a sheet link is kept the same way (V-10)', () => {
    const cls = classWith(info({ kind: 'upload', setAt: SET, count: 23 }));
    expect(boardStatusLine('class-other', cls, null)).toBe('הלוח נוסף ב־10.11, 23 מבחנים');
    expect(boardStatusLine('class-mine', classWith(info({ kind: 'upload', setAt: SET, count: 23, mine: true, mayChange: true })), null)).toBe('הלוח נוסף ב־10.11, 23 מבחנים');
  });

  it('says one exam in words', () => {
    expect(boardStatusLine('class-other', classWith(info({ setAt: SET, count: 1 })), null)).toBe('הלוח נוסף ב־10.11, מבחן אחד');
  });

  it('leaves the date out when the board has none, and says nothing when it has neither a date nor an exam', () => {
    expect(boardStatusLine('class-other', classWith(info({ kind: 'upload', setAt: null, count: 23 })), null)).toBe('23 מבחנים');
    expect(boardStatusLine('class-other', classWith(info({ kind: 'upload', setAt: null, count: 0 })), null)).toBeNull();
    expect(boardStatusLine('class-other', classWith(info({ kind: 'upload', setAt: SET, count: 0 })), null)).toBe('הלוח נוסף ב־10.11');
  });

  it('says a calendar board is from a Google calendar, with the exams it has', () => {
    expect(boardStatusLine('class-other', classWith(info({ kind: 'calendar', setAt: null, count: 23 })), null)).toBe('מיומן Google, 23 מבחנים');
    expect(boardStatusLine('class-other', classWith(info({ kind: 'calendar', setAt: SET, count: 23 })), null)).toBe('מיומן Google, 23 מבחנים');
  });

  it('does not say a calendar has no exams when it is only not read yet', () => {
    expect(boardStatusLine('class-other', classWith(info({ kind: 'calendar', setAt: null, count: 0 })), null)).toBe('מיומן Google');
  });

  it('only says there is a board for a class an older server described', () => {
    expect(boardStatusLine('class-other', { ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, null)).toBe('יש לכיתה לוח מבחנים.');
  });

  it('says nothing when there is no board', () => {
    expect(boardStatusLine('none', CLASS_BASE, null)).toBeNull();
    expect(boardStatusLine('none', null, null)).toBeNull();
  });

  it('says what the phone\'s own board is made of, with the exams it has, and nothing when the class\'s board is off', () => {
    expect(boardStatusLine('own', CLASS_BASE, ownRows(3))).toBe('הלוח נוסף ב־10.11, 3 מבחנים');
    expect(boardStatusLine('own', CLASS_BASE, ownCalendar(12, READ))).toBe('מיומן Google, 12 מבחנים');
    expect(boardStatusLine('own-none', classWith(info()), { kind: 'none' })).toBeNull();
  });

  it('says one exam in words, and leaves the count out when there is none, as the class\'s board does', () => {
    expect(boardStatusLine('own', CLASS_BASE, ownRows(1))).toBe('הלוח נוסף ב־10.11, מבחן אחד');
    expect(boardStatusLine('own', CLASS_BASE, ownRows(0))).toBe('הלוח נוסף ב־10.11');
    expect(boardStatusLine('own', CLASS_BASE, ownCalendar(1, READ))).toBe('מיומן Google, מבחן אחד');
    expect(boardStatusLine('own', CLASS_BASE, ownCalendar(0, READ))).toBe('מיומן Google');
  });

  it('counts the own board\'s exams, never the class\'s', () => {
    const cls = classWith(info({ kind: 'upload', count: 23, mine: true, mayChange: true }));
    expect(boardStatusLine('own', cls, ownRows(2))).toBe('הלוח נוסף ב־10.11, 2 מבחנים');
  });

  it('says a calendar has not been read yet, with no date to work out: its last read is none, and no middle dot (the copy rule)', () => {
    expect(boardStatusLine('own', CLASS_BASE, ownCalendar(0, null))).toBe('מיומן Google, עוד לא נקרא');
    // Whatever it holds is shown with it.
    expect(boardStatusLine('own', CLASS_BASE, ownCalendar(2, null))).toBe('מיומן Google, 2 מבחנים, עוד לא נקרא');
  });

  it('never says "not read" of a file board, which has no read to wait for', () => {
    expect(boardStatusLine('own', CLASS_BASE, ownRows(0))).not.toMatch(/עוד לא נקרא/);
  });

  it('never says "from a file", of the class\'s board or the phone\'s own (V-10)', () => {
    const lines = [
      boardStatusLine('class-other', classWith(info({ kind: 'upload', setAt: SET, count: 3 })), null),
      boardStatusLine('class-other', classWith(info({ kind: 'upload', setAt: null, count: 3 })), null),
      boardStatusLine('class-mine', classWith(info({ kind: 'upload', setAt: SET, count: 0, mine: true, mayChange: true })), null),
      boardStatusLine('own', CLASS_BASE, ownRows(3)),
      boardStatusLine('own', CLASS_BASE, ownRows(0)),
    ];
    for (const line of lines) expect(line ?? '').not.toMatch(/מקובץ|הועלה/);
  });

  it('leaves the day out of the phone\'s own board when its time does not read, and is nothing when nothing is left', () => {
    expect(boardStatusLine('own', CLASS_BASE, { kind: 'rows', exams: examsOf(2), savedAt: 'not a time' })).toBe('2 מבחנים');
    expect(boardStatusLine('own', CLASS_BASE, { kind: 'rows', exams: [], savedAt: 'not a time' })).toBeNull();
  });
});

describe('boardActions', () => {
  it('lets the one who brought the board update it or remove it', () => {
    expect(boardActions('class-mine', info({ mine: true, mayChange: true }))).toEqual({ add: 'update', remove: true });
  });

  it('offers a board of their own to the one who brought it and may no longer change it (it follows another class now)', () => {
    expect(boardActions('class-mine', info({ mine: true, mayChange: false }))).toEqual({ add: 'other', remove: false });
    expect(boardActions('class-mine', null)).toEqual({ add: 'other', remove: false });
  });

  it('offers a board of their own beside a board that may not be replaced, and no removal of the class\'s', () => {
    expect(boardActions('class-other', info())).toEqual({ add: 'other', remove: false });
  });

  it('offers a new board where the one who brought the class\'s has gone, and no removal of it (V-7)', () => {
    expect(boardActions('class-open', info({ mayChange: true }))).toEqual({ add: 'replace', remove: false });
  });

  it('offers to bring another board to a person who has one of their own or turned the class\'s off', () => {
    expect(boardActions('own', null)).toEqual({ add: 'again', remove: false });
    expect(boardActions('own-none', info())).toEqual({ add: 'again', remove: false });
  });

  it('has nothing to offer where there is no board, since the form is there already', () => {
    expect(boardActions('none', null)).toEqual({ add: null, remove: false });
  });
});

describe('blockActions', () => {
  const ids = (owner: BoardOwner, board: ExamBoardInfo | null = null) => blockActions(owner, board).map((a) => a.id);
  const labels = (owner: BoardOwner, board: ExamBoardInfo | null = null) => blockActions(owner, board).map((a) => a.label);
  const MINE = info({ mine: true, mayChange: true });

  it('has none where there is no board: the form is open already', () => {
    expect(blockActions('none', null)).toEqual([]);
  });

  it('gives the one who brought the class\'s board a newer one, the removal for everyone, and a way to turn it off for themselves', () => {
    expect(labels('class-mine', MINE)).toEqual(['להעלות לוח מעודכן', 'להסיר את הלוח', 'בלי הלוח של הכיתה']);
    expect(ids('class-mine', MINE)).toEqual(['add', 'remove-class', 'hide-class']);
  });

  it('gives the one who brought it and may no longer change it a board of their own, and no removal for everyone', () => {
    expect(ids('class-mine', info({ mine: true, mayChange: false }))).toEqual(['add', 'hide-class']);
    expect(ids('class-mine', null)).toEqual(['add', 'hide-class']);
    expect(labels('class-mine', info({ mine: true, mayChange: false }))[0]).toBe('להביא לוח רק לעצמי');
  });

  it('gives a person beside a board they may not replace a board of their own, after a muted "לא מתאים?", and a way to turn the class\'s off for themselves (strings, row 13)', () => {
    const actions = blockActions('class-other', info());
    expect(actions.map((a) => a.label)).toEqual(['להביא לוח רק לעצמי', 'בלי הלוח של הכיתה']);
    expect(actions.map((a) => a.lead ?? null)).toEqual(['לא מתאים?', null]);
    // only that one has a line before it
    for (const owner of ['class-mine', 'class-open', 'own', 'own-none'] as const) {
      expect(blockActions(owner, MINE).every((a) => a.lead === undefined), owner).toBe(true);
    }
  });

  it('does not read as locked where the one who brought the class\'s board has gone: a new board, no "לא מתאים?", not "רק לעצמי" (V-7)', () => {
    const actions = blockActions('class-open', info({ mayChange: true }));
    expect(actions.map((a) => a.label)).toEqual(['להביא לוח חדש', 'בלי הלוח של הכיתה']);
    expect(actions.map((a) => a.id)).toEqual(['add', 'hide-class']);
    expect(actions.every((a) => a.lead === undefined)).toBe(true);
    expect(actions.map((a) => a.label).join(' ')).not.toMatch(/רק לעצמי/);
    // and the sheet it opens still offers both places, the person's own first
    expect(bringTarget({ ...CLASS_BASE, examBoard: info({ mayChange: true }) }, null)).toEqual({ target: 'own', choice: true });
  });

  it('gives a board of the phone\'s own its removal and another board, and does not offer to turn off the class\'s, which is replaced already', () => {
    expect(labels('own')).toEqual(['להסיר את הלוח שלי', 'להביא לוח אחר']);
    expect(ids('own')).toEqual(['remove-own', 'add']);
  });

  it('gives a person who turned the class\'s board off a way to turn it back on, and a board for themselves alone', () => {
    expect(labels('own-none', info())).toEqual(['להחזיר את הלוח של הכיתה', 'להביא לוח רק לעצמי']);
    expect(ids('own-none', info())).toEqual(['restore-class', 'add']);
  });

  it('shows "בלי הלוח של הכיתה" as a quiet action, the only one, and only where the class\'s board is what is shown', () => {
    const withHide: BoardOwner[] = ['class-mine', 'class-open', 'class-other'];
    const owners: BoardOwner[] = ['none', 'class-mine', 'class-open', 'class-other', 'own', 'own-none'];
    for (const owner of owners) {
      const actions = blockActions(owner, info({ mine: owner === 'class-mine', mayChange: owner !== 'class-other' }));
      expect(actions.some((a) => a.id === 'hide-class'), owner).toBe(withHide.includes(owner));
      expect(actions.filter((a) => a.quiet).map((a) => a.id), owner).toEqual(withHide.includes(owner) ? ['hide-class'] : []);
    }
  });

  it('removes the class\'s board for everyone only where the device may, and the person\'s own only where there is one', () => {
    const owners: BoardOwner[] = ['none', 'class-mine', 'class-open', 'class-other', 'own', 'own-none'];
    for (const owner of owners) {
      const here = ids(owner, MINE);
      expect(here.includes('remove-class'), owner).toBe(owner === 'class-mine');
      expect(here.includes('remove-own'), owner).toBe(owner === 'own');
      expect(here.includes('restore-class'), owner).toBe(owner === 'own-none');
    }
  });

  it('never says a name or asks anyone to join a class', () => {
    const owners: BoardOwner[] = ['class-mine', 'class-open', 'class-other', 'own', 'own-none'];
    for (const owner of owners) for (const label of labels(owner, MINE)) expect(label).not.toMatch(/להצטרף/);
  });
});

describe('blockQuestion', () => {
  it('asks once before the class\'s board goes for the whole class', () => {
    expect(blockQuestion('remove-class', true)).toEqual({ line: 'הלוח יוסר לכל הכיתה.', confirm: 'להסיר' });
  });

  it('asks once before the class\'s board is hidden, and says it can be brought back at any moment', () => {
    expect(blockQuestion('hide-class', true)).toEqual({ line: 'המבחנים מהלוח של הכיתה לא יוצגו אצלך. אפשר להחזיר בכל רגע.', confirm: 'להסתיר אצלי' });
  });

  it('asks once before the person\'s own board goes, and says the class\'s comes back only when the class has one', () => {
    expect(blockQuestion('remove-own', true)).toEqual({ line: 'הלוח שלך יוסר, והלוח של הכיתה יחזור.', confirm: 'להסיר' });
    expect(blockQuestion('remove-own', false)).toEqual({ line: 'הלוח שלך יוסר.', confirm: 'להסיר' });
  });

  it('has one word for the way out', () => {
    expect(CANCEL_LABEL).toBe('ביטול');
  });

  it('never asks anyone to join a class', () => {
    for (const ask of ['remove-class', 'hide-class', 'remove-own'] as const) {
      expect(blockQuestion(ask, true).line).not.toMatch(/להצטרף/);
    }
  });
});

describe('bringTarget', () => {
  const MINE_MAY = info({ mine: true, mayChange: true });
  const MINE_LOCKED = info({ mine: true, mayChange: false });
  const OPEN = info({ mine: false, mayChange: true });
  const OTHER = info();
  const onClass = (examBoard: ExamBoardInfo | null): DeviceClass => ({ ...CLASS_BASE, examBoard });
  const KINDS = [{ kind: 'rows' }, { kind: 'calendar' }] as const;

  it('is the class\'s own rule for a phone with no board of its own, as it was', () => {
    expect(bringTarget(CLASS_BASE, null)).toEqual({ target: 'class', choice: false });
    expect(bringTarget(onClass(MINE_MAY), null)).toEqual({ target: 'class', choice: true });
    expect(bringTarget(onClass(MINE_LOCKED), null)).toEqual({ target: 'own', choice: false });
    expect(bringTarget(onClass(OPEN), null)).toEqual({ target: 'own', choice: true });
    expect(bringTarget(onClass(OTHER), null)).toEqual({ target: 'own', choice: false });
    expect(bringTarget(null, null)).toEqual({ target: 'class', choice: false });
  });

  it('keeps another board for the person alone when they have one already, with the choice the class underneath gives', () => {
    for (const own of KINDS) {
      // Someone who brought the class's board, or may replace it, can still choose to update it for everyone.
      expect(bringTarget(onClass(MINE_MAY), own)).toEqual({ target: 'own', choice: true });
      expect(bringTarget(onClass(OPEN), own)).toEqual({ target: 'own', choice: true });
      expect(bringTarget(onClass(MINE_LOCKED), own)).toEqual({ target: 'own', choice: false });
      expect(bringTarget(onClass(OTHER), own)).toEqual({ target: 'own', choice: false });
      // A class with no board (its board was removed while the person held their own) can be given a first one: theirs by
      // default, with the choice. A phone with no class read has nothing to give a board to.
      expect(bringTarget(CLASS_BASE, own)).toEqual({ target: 'own', choice: true });
      expect(bringTarget({ ...CLASS_BASE, examBoard: null, examCalendarId: null }, own)).toEqual({ target: 'own', choice: true });
      expect(bringTarget(null, own)).toEqual({ target: 'own', choice: false });
    }
  });

  it('offers the class exactly where the class may be changed, for either kind of own board', () => {
    const cases: [string, DeviceClass | null, boolean][] = [
      ['no class read', null, false],
      ['a class with no board', CLASS_BASE, true],
      ['a class an older server described by its calendar', { ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, false],
      ['the board this device brought, may change', onClass(MINE_MAY), true],
      ['the board this device brought, locked', onClass(MINE_LOCKED), false],
      ['a board that may be replaced', onClass(OPEN), true],
      ['a board that may not be replaced', onClass(OTHER), false],
    ];
    for (const own of KINDS) {
      for (const [name, cls, choice] of cases) expect(bringTarget(cls, own), `${name}, ${own.kind}`).toEqual({ target: 'own', choice });
    }
  });

  it('is a board for the person alone, with no choice, when they turned the class\'s board off', () => {
    const none = { kind: 'none' } as const;
    for (const examBoard of [MINE_MAY, OPEN, MINE_LOCKED, OTHER]) {
      expect(bringTarget(onClass(examBoard), none)).toEqual({ target: 'own', choice: false });
    }
    // Over a class that has no board it hides nothing, and is no board of the person's own (A-M5): the class's rule.
    expect(bringTarget(onClass(null), none)).toEqual({ target: 'class', choice: false });
  });

  it('never saves for the class by default once the person has chosen to keep a board to themselves', () => {
    const boards = [null, MINE_MAY, MINE_LOCKED, OPEN, OTHER];
    for (const examBoard of boards) {
      for (const own of KINDS) expect(bringTarget(onClass(examBoard), own).target).toBe('own');
    }
    // the class's board turned off is a choice about a board the class has (A-M5)
    for (const examBoard of boards.filter((b) => b !== null)) expect(bringTarget(onClass(examBoard), { kind: 'none' }).target).toBe('own');
  });
});

describe('what a save for the class does to a board of the phone\'s own', () => {
  it('holds a board of its own for the two kinds of board, and not for the class\'s board turned off or for none', () => {
    expect(holdsOwnBoard({ kind: 'rows' })).toBe(true);
    expect(holdsOwnBoard({ kind: 'calendar' })).toBe(true);
    expect(holdsOwnBoard({ kind: 'none' })).toBe(false);
    expect(holdsOwnBoard(null)).toBe(false);
  });

  it('ends the own board after a save for the class, so the person sees what they saved, and after no other save', () => {
    expect(replacesOwnBoard('class', { kind: 'rows' })).toBe(true);
    expect(replacesOwnBoard('class', { kind: 'calendar' })).toBe(true);
    expect(replacesOwnBoard('class', { kind: 'none' })).toBe(false);
    expect(replacesOwnBoard('class', null)).toBe(false);
    for (const own of [{ kind: 'rows' }, { kind: 'calendar' }, { kind: 'none' }, null] as const) expect(replacesOwnBoard('own', own)).toBe(false);
  });

  it('says so above the button: the ordinary class line, and that the board of their own goes (V-1, R3)', () => {
    expect(targetLine('class', true, true)).toBe('הלוח יתעדכן אצל כל מי שבכיתה. הלוח שלך יוסר.');
    expect(targetLine('class', false, true)).toBe('כל מי שבכיתה יראה את הלוח הזה, ועשויה להישלח להם התראה שנוסף לוח מבחנים. הלוח שלך יוסר.');
  });

  it('never says "הכיתה שלך", which on a parent\'s phone is the child\'s class, nor asks anyone to join it (V-1, R3)', () => {
    for (const target of ['class', 'own'] as const) {
      for (const has of [true, false]) {
        for (const holds of [true, false]) {
          expect(targetLine(target, has, holds)).not.toMatch(/הכיתה שלך|להצטרף/);
        }
      }
    }
  });

  it('says nothing of it for a person with no board of their own, or for a board that stays with them', () => {
    expect(targetLine('class', true, false)).toBe('הלוח יתעדכן אצל כל מי שבכיתה.');
    expect(targetLine('class', true)).toBe('הלוח יתעדכן אצל כל מי שבכיתה.');
    expect(targetLine('own', true, true)).toBe('לכיתה כבר יש לוח. הלוח הזה יחליף אותו רק אצלך, ואפשר לחזור ללוח של הכיתה בכל רגע.');
    expect(targetLine('own', false, true)).toBe('הלוח הזה יישמר רק אצלך.');
  });

  it('has a toast for it, and the usual one when nothing else changed (strings, row 14)', () => {
    expect(classSavedToast(false)).toBe('הלוח נשמר לכל הכיתה');
    expect(classSavedToast(true)).toBe('הלוח נשמר לכיתה, והלוח שלך הוסר');
    for (const text of [classSavedToast(false), classSavedToast(true), targetLine('class', true, true)]) expect(text).not.toMatch(/להצטרף/);
  });
});

describe('what follows a save for the class (A-I4)', () => {
  /** The steps as `afterClassSave` takes them, each noted in `log` when it runs. */
  function steps(read: boolean | Error, removeThrows = false) {
    const log: string[] = [];
    let answer: (ok: boolean) => void = () => undefined;
    const io = {
      readFeed: () => {
        log.push('read');
        if (read instanceof Error) return Promise.reject(read);
        return new Promise<boolean>((resolve) => {
          answer = resolve;
        });
      },
      removeOwn: () => {
        log.push('remove');
        if (removeThrows) throw new Error('storage');
      },
      toast: (text: string) => void log.push(`toast:${text}`),
    };
    return { log, io, answer: (ok: boolean = read === true) => answer(ok) };
  }
  /** A board of the person's own, which a save for the class ends; the kind does not matter to what follows. */
  const OWN = { kind: 'rows' } as const;

  it('removes a board of the person\'s own only once the class\'s feed was read again, then says so', async () => {
    const s = steps(true);
    const done = afterClassSave(OWN, s.io);
    await Promise.resolve();
    // the read is under way: nothing removed, nothing said
    expect(s.log).toEqual(['read']);
    s.answer(true);
    await done;
    expect(s.log).toEqual(['read', 'remove', `toast:${classSavedToast(true)}`]);
  });

  it('keeps the board of the person\'s own when the read fails, and says the plain thing', async () => {
    const failed = steps(false);
    const one = afterClassSave(OWN, failed.io);
    failed.answer(false);
    await one;
    expect(failed.log).toEqual(['read', `toast:${classSavedToast(false)}`]);

    const threw = steps(new TypeError('Network request failed'));
    await afterClassSave(OWN, threw.io);
    expect(threw.log).toEqual(['read', `toast:${classSavedToast(false)}`]);
  });

  it('says the plain thing when the board of the person\'s own could not be removed: the class has the board all the same', async () => {
    const s = steps(true, true);
    const done = afterClassSave(OWN, s.io);
    s.answer(true);
    await done;
    expect(s.log).toEqual(['read', 'remove', `toast:${classSavedToast(false)}`]);
  });

  it('says it at once, and reads the feed behind it, for a person with no board of their own', async () => {
    const s = steps(true);
    const done = afterClassSave(null, s.io);
    expect(s.log).toEqual([`toast:${classSavedToast(false)}`, 'read']);
    s.answer(true);
    await done;
    expect(s.log).toEqual([`toast:${classSavedToast(false)}`, 'read']);
    // and a read that fails is nobody's to hear
    await expect(afterClassSave(null, steps(new TypeError('x')).io)).resolves.toBeUndefined();
  });

  it('ends "בלי הלוח של הכיתה" too, quietly, once the class\'s feed was read again: it would hide the board just saved (R1)', async () => {
    const s = steps(true);
    const done = afterClassSave({ kind: 'none' }, s.io);
    // said at once, in the plain words: the person held no board of their own
    expect(s.log).toEqual([`toast:${classSavedToast(false)}`, 'read']);
    s.answer(true);
    await done;
    expect(s.log).toEqual([`toast:${classSavedToast(false)}`, 'read', 'remove']);
  });

  it('leaves "בלי הלוח של הכיתה" when the read fails or throws, and never throws when it cannot be removed (R1)', async () => {
    const failed = steps(false);
    const one = afterClassSave({ kind: 'none' }, failed.io);
    failed.answer(false);
    await one;
    expect(failed.log).toEqual([`toast:${classSavedToast(false)}`, 'read']);

    const threw = steps(new TypeError('Network request failed'));
    await afterClassSave({ kind: 'none' }, threw.io);
    expect(threw.log).toEqual([`toast:${classSavedToast(false)}`, 'read']);

    const stuck = steps(true, true);
    const two = afterClassSave({ kind: 'none' }, stuck.io);
    stuck.answer(true);
    await expect(two).resolves.toBeUndefined();
    expect(stuck.log).toEqual([`toast:${classSavedToast(false)}`, 'read', 'remove']);
  });
});

describe('the line over the School screen\'s exams (A-I6, V-5)', () => {
  it('says where the board came from when the class has one or the phone has one of its own, and nothing else', () => {
    expect(examsTabSourceLine(CLASS_BASE, null)).toBeNull();
    expect(examsTabSourceLine(null, null)).toBeNull();
    expect(examsTabSourceLine({ ...CLASS_BASE, examBoard: info() }, null)).toBe('מישהו מהכיתה הוסיף לוח מבחנים, והוא משותף לכל הכיתה');
    expect(examsTabSourceLine({ ...CLASS_BASE, examBoard: info({ mayChange: true }) }, null)).toBe('מישהו מהכיתה הוסיף לוח מבחנים, והוא משותף לכל הכיתה');
    expect(examsTabSourceLine({ ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) }, null)).toBe('לוח המבחנים שהוספת משותף לכל הכיתה');
    expect(examsTabSourceLine({ ...CLASS_BASE, examBoard: info() }, { kind: 'rows' })).toBe('מוצג כאן לוח מבחנים שלך בלבד, במקום הלוח של הכיתה');
    expect(examsTabSourceLine(CLASS_BASE, { kind: 'rows' })).toBe('מוצג כאן לוח מבחנים שלך בלבד');
    expect(examsTabSourceLine(CLASS_BASE, { kind: 'calendar' })).toBe('מוצג כאן לוח מבחנים שלך בלבד');
    expect(examsTabSourceLine({ ...CLASS_BASE, examBoard: info() }, { kind: 'none' })).toBe('הלוח של הכיתה מוסתר אצלך');
    // a class an older server described by its calendar has a board too
    expect(examsTabSourceLine({ ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, { kind: 'rows' })).toBe('מוצג כאן לוח מבחנים שלך בלבד, במקום הלוח של הכיתה');
    expect(examsTabSourceLine({ ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' }, null)).toBe('מישהו מהכיתה הוסיף לוח מבחנים, והוא משותף לכל הכיתה');
    // the class's board turned off over a class that has none: nothing to say (A-M5)
    expect(examsTabSourceLine(CLASS_BASE, { kind: 'none' })).toBeNull();
  });

  it('never points at "this board": the tab shows a list, which may hold the site\'s own exams too (V-5)', () => {
    const classes: (DeviceClass | null)[] = [
      null, CLASS_BASE, { ...CLASS_BASE, examBoard: info() }, { ...CLASS_BASE, examBoard: info({ mayChange: true }) },
      { ...CLASS_BASE, examBoard: info({ mine: true, mayChange: true }) }, { ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' },
    ];
    for (const cls of classes) {
      for (const own of [null, { kind: 'rows' }, { kind: 'calendar' }, { kind: 'none' }] as const) {
        expect(examsTabSourceLine(cls, own) ?? '').not.toMatch(/הלוח הזה|הכיתה שלך|להצטרף|תלמיד/);
      }
    }
  });

  it('leaves the line inside "המבחנים שלי", where the board is on screen, as it was', () => {
    expect(sourceLine('class-mine', true)).toBe('הוספת את הלוח הזה, והוא משותף לכל הכיתה');
    expect(sourceLine('own', true)).toBe('הלוח הזה שלך בלבד, ומוצג אצלך במקום הלוח של הכיתה');
  });
});

describe('classHasBoard', () => {
  it('is true for a class with a board, and for one an older server described by its calendar', () => {
    expect(classHasBoard({ ...CLASS_BASE, examBoard: info() })).toBe(true);
    expect(classHasBoard({ ...CLASS_BASE, examCalendarId: 'abc@group.calendar.google.com' })).toBe(true);
  });

  it('is false for a class with none, and for no class', () => {
    expect(classHasBoard(CLASS_BASE)).toBe(false);
    expect(classHasBoard({ ...CLASS_BASE, examBoard: null, examCalendarId: null })).toBe(false);
    expect(classHasBoard(null)).toBe(false);
    expect(classHasBoard(undefined)).toBe(false);
  });
});

describe('what the toasts say of the board kept on the phone', () => {
  it('says a board was kept: a calendar whose first read failed was not kept (A-I2)', () => {
    expect(ownSavedToast()).toBe('הלוח נשמר אצלך');
  });

  it('says what was removed, and that the class\'s board is back only when the class has one', () => {
    expect(ownRemovedToast('rows', true)).toBe('הלוח שלך הוסר, והלוח של הכיתה חזר');
    expect(ownRemovedToast('calendar', true)).toBe('הלוח שלך הוסר, והלוח של הכיתה חזר');
    expect(ownRemovedToast('rows', false)).toBe('הלוח שלך הוסר');
    expect(ownRemovedToast('none', true)).toBe('הלוח של הכיתה חזר');
    // (strings, row 10; with A-M5 the block no longer offers the way back over a class with no board)
    expect(ownRemovedToast('none', false)).toBe('לכיתה אין עכשיו לוח מבחנים');
  });

  it('says the class\'s board is hidden on this phone', () => {
    expect(OWN_HIDDEN_TOAST).toBe('הלוח של הכיתה הוסתר אצלך');
  });

  it('never asks anyone to join a class', () => {
    const all = [
      ownSavedToast(), ownRemovedToast('rows', true), ownRemovedToast('rows', false), ownRemovedToast('none', true), ownRemovedToast('none', false), OWN_HIDDEN_TOAST,
    ];
    for (const text of all) expect(text).not.toMatch(/להצטרף/);
  });
});

describe('a calendar the phone could not read when it was kept (A-I2)', () => {
  it('is said as a read from the phone that may be tried again in a moment, whatever else is wrong', () => {
    const unread = new OwnCalendarUnreadError();
    expect(boardProblem(unread)).toBe('לא הצלחנו לקרוא את היומן מהטלפון. אפשר לנסות שוב בעוד רגע.');
    // told by its name, as an error that crossed a module boundary is
    expect(boardProblem(Object.assign(new Error('x'), { name: 'OwnCalendarUnreadError' }))).toBe(boardProblem(unread));
    // and a failed save keeps the selection, so the sheet stays as it was
    const sel = initialSelection(ROWS_IN, [], 'own', TODAY);
    expect(saveFailed(sel, unread)).toEqual({ selection: sel, problem: boardProblem(unread), refused: false });
  });
});

describe('a board the phone could not keep', () => {
  it('is said as something that went wrong, never as a failed connection: nothing was sent', () => {
    const went = boardProblem(new OwnBoardError());
    expect(went).toBe(boardProblem(new V2Error(500, 'x', 'internal')));
    expect(went).not.toMatch(/חיבור/);
    expect(went).not.toMatch(/אינטרנט/);
  });

  it('is told by the error\'s name, as the server\'s are, and goes through a failed save with the selection as it was', () => {
    const error = new OwnBoardError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('OwnBoardError');
    const sel = initialSelection(ROWS_IN, [], 'own', TODAY);
    const failed = saveFailed(sel, error);
    expect(failed.selection).toBe(sel);
    expect(failed.problem).toBe(boardProblem(error));
  });
});

describe('inSchoolYear', () => {
  it('is the school year of the day it is asked on: 1 September to 31 August', () => {
    expect(inSchoolYear('2026-09-01', '2026-11-10')).toBe(true);
    expect(inSchoolYear('2027-08-31', '2026-11-10')).toBe(true);
    expect(inSchoolYear('2026-08-31', '2026-11-10')).toBe(false);
    expect(inSchoolYear('2027-09-01', '2026-11-10')).toBe(false);
    // In the spring the year began the autumn before.
    expect(inSchoolYear('2026-09-01', '2027-03-01')).toBe(true);
    expect(inSchoolYear('2026-08-31', '2027-03-01')).toBe(false);
    expect(inSchoolYear('2027-09-01', '2027-03-01')).toBe(false);
  });
});
