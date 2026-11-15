/**
 * `/v2/device/exam-board`: a class's exam schedule brought from a link or an Excel file (design doc,
 * "שני צעדים"). This is step 1, the preview: what the server found, and nothing saved.
 *
 * It takes input from anonymous devices and makes the server read what they point at, so its limits are part
 * of the feature:
 * - the body is up to 1.5MB (a 1MB file in base64 and the JSON around it), the file up to 1MB, a link up to
 *   2,000 characters;
 * - a device gets 10 previews in an hour, counted before the work (`takePreviewTurn`); a refused call is not
 *   counted, so it does not move the window;
 * - the work as a whole is held to 25 seconds (`PREVIEW_DEADLINE_MS`), on top of the 10 seconds of each get
 *   and the 2MB of each body the link reader keeps;
 * - the only thing written to the database is the counter. The file is read in memory and never stored.
 *
 * Nothing the device sent and nothing the pages and files held is logged, and none of it is in an answer: a
 * refusal carries a code (`EXAM_BOARD_ERRORS`) and a fixed sentence, and a failure that is not a refusal logs
 * the name of the error only.
 *
 * `PUT /v2/device/exam-board` is step 2, the save: the rows the student confirmed become the class's board.
 * Every row is checked again here (the phone's copy of the rules is not the server's), the lock is the one a
 * calendar has (`changeBoard`), and the whole is one write: the board, its setter and its exams change together
 * or not at all.
 */
import type { PrismaClient } from '@prisma/client';
import type { ClassExam, DateStr, DeviceResponse, ExamBoardError, ExamBoardPreview } from '@sederyom/shared';
import { schoolYearOf } from '@sederyom/shared/logic/exam-board/calendar';
import { uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { BOARD_DETAILS_MAX, BOARD_ROWS_MAX, BOARD_TITLE_MAX, isBoardDay } from '@sederyom/shared/logic/exam-board/rows';
import { cleanText } from '@sederyom/shared/logic/exam-board/text';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { BoardError } from '../exam-board/errors.js';
import { previewBoard } from '../exam-board/preview.js';
import { BOARD_LOCKED, announceAgain, announceUploadedBoard, changeBoard, examsColumns } from '../exam-board/store.js';
import { todayStr } from '../lib/time.js';
import { loadDevice, toResponse } from './devices.js';

/** 1.5MB: a file of 1MB is 1.33MB of base64, and the JSON around it is a few hundred bytes. */
const BODY_LIMIT = 1.5 * 1024 * 1024;
export const PREVIEWS_PER_WINDOW = 10;
const WINDOW_MS = 60 * 60 * 1000;
/**
 * 700KB. 400 ordinary rows (a day, a title of a few words, a line of details) are about 60KB of JSON; 400 rows each
 * at the limits of a title (200) and of details (500), all Hebrew at two bytes a character, are about 580KB, and
 * must fit: the body limit is the room for the largest board the row rules allow, not a second rule on rows.
 */
const SAVE_BODY_LIMIT = 700 * 1024;
/** The whole preview, after which the answer is `unreachable`; each get inside it has its own 10 seconds. */
export const PREVIEW_DEADLINE_MS = 25_000;

/** What each code says to the student. The app has its own copy of these; they are the fallback. */
export const BOARD_ERROR_MESSAGES: Record<ExamBoardError, string> = {
  no_class: 'עוד לא נבחרה כיתה.',
  unreachable: 'לא הצלחנו לפתוח את הקישור.',
  no_board: 'לא מצאנו לוח מבחנים בדף הזה.',
  private_sheet: 'הגיליון הזה לא משותף לכולם.',
  unsupported_file: 'אפשר להעלות רק קובץ Excel מסוג xlsx.',
  too_big: 'הקובץ גדול מדי.',
  unknown_layout: 'לא זיהינו בקובץ מבנה מוכר של לוח מבחנים.',
  rate_limited: 'ניסית יותר מדי פעמים בשעה האחרונה, אפשר לנסות שוב בעוד קצת.',
  bad_rows: 'חלק מהשורות לא תקינות.',
};

/** A code's status: the state of the device (409), the counter (429), or the input (422). */
const STATUS: Partial<Record<ExamBoardError, number>> = { no_class: 409, rate_limited: 429 };

const previewBody = z
  .object({
    link: z.string().min(1).max(2000).optional(),
    file: z.object({ name: z.string().max(255), base64: z.string().max(BODY_LIMIT) }).optional(),
    column: z.string().max(100).optional(),
  })
  .refine((body) => (body.link === undefined) !== (body.file === undefined), 'expected exactly one of link and file');

/** The shape of a save, and no more: what is in each row is `cleanRows`'s to say, with `bad_rows`. */
const saveBody = z.object({
  rows: z.array(z.object({ date: z.string(), title: z.string(), details: z.string().nullish() })),
});

function refuse(reply: FastifyReply, code: ExamBoardError) {
  void reply.code(STATUS[code] ?? 422);
  return { error: code, message: BOARD_ERROR_MESSAGES[code] };
}

/**
 * A body over the limit is not read. It is answered as the file that is too big, which is what it is, in the
 * shape the phone reads; any other error goes on to the app's own handler.
 */
function tooBigOnly(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    void reply.send(refuse(reply, 'too_big'));
    return;
  }
  void reply.send(error);
}

/**
 * The rows as the class will keep them, or `null` when any of them is not fit to keep: 1 to 400 rows, each a day
 * of the school year `today` is in, a title of 1 to 200 characters and details of up to 500, once cleaned
 * (`cleanText`: one line, no control, no bidi mark, no zero-width character; details left empty are `null`). A title
 * of nothing but such characters is empty, and refuses the save. One bad row refuses all of them: a list that was
 * confirmed row by row is not saved with some of it missing. A row with the key of an earlier one (the same
 * day and the same title, quote marks aside) is that exam again, and the first stays.
 */
function cleanRows(rows: { date: string; title: string; details?: string | null }[], today: DateStr): ClassExam[] | null {
  if (rows.length < 1 || rows.length > BOARD_ROWS_MAX) return null;
  const year = schoolYearOf(today);
  const kept = new Map<string, ClassExam>();
  for (const row of rows) {
    const title = cleanText(row.title);
    const details = cleanText(row.details ?? '') || null;
    if (!isBoardDay(row.date) || row.date < year.start || row.date > year.end) return null;
    if (title.length < 1 || title.length > BOARD_TITLE_MAX || (details !== null && details.length > BOARD_DETAILS_MAX)) return null;
    const naturalKey = uploadedExamKey(row.date, title);
    if (!kept.has(naturalKey)) kept.set(naturalKey, { naturalKey, date: row.date, subject: title, details });
  }
  return [...kept.values()];
}

/**
 * Takes one of the device's ten previews of this hour, and says whether there was one. The window is the hour
 * from the first call counted in it. Each step is one `UPDATE ... WHERE`, decided on the rows it changed and not
 * on a copy read before it, so two calls at the same moment cannot both take the last place; a refused call
 * writes nothing.
 */
async function takePreviewTurn(prisma: PrismaClient, deviceId: string, now: Date): Promise<boolean> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const inWindow = async () =>
    (
      await prisma.device.updateMany({
        where: { id: deviceId, boardPreviewWindowAt: { gt: windowStart }, boardPreviewCount: { lt: PREVIEWS_PER_WINDOW } },
        data: { boardPreviewCount: { increment: 1 } },
      })
    ).count === 1;
  const newWindow = async () =>
    (
      await prisma.device.updateMany({
        where: { id: deviceId, OR: [{ boardPreviewWindowAt: null }, { boardPreviewWindowAt: { lte: windowStart } }] },
        data: { boardPreviewCount: 1, boardPreviewWindowAt: now },
      })
    ).count === 1;
  if (await inWindow()) return true;
  if (await newWindow()) return true;
  // The window was opened by a call at the same moment as this one: there may be a place left in it.
  return inWindow();
}

/** The work, or `unreachable` when it has not ended in `PREVIEW_DEADLINE_MS`. The work is not stopped, only left. */
async function withinDeadline<T>(start: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BoardError('unreachable')), PREVIEW_DEADLINE_MS);
  });
  try {
    return await Promise.race([start(), late]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerExamBoardRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { services } = deps;
  const { prisma } = services;

  app.post(
    '/v2/device/exam-board/preview',
    {
      bodyLimit: BODY_LIMIT,
      errorHandler: tooBigOnly,
    },
    async (request, reply): Promise<ExamBoardPreview | { error: string; message: string }> => {
      const parsed = previewBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        void reply.code(400);
        return { error: 'invalid_preview', message: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}` };
      }

      const device = request.device!;
      const cls = device.classId ? await prisma.schoolClass.findUnique({ where: { id: device.classId }, select: { name: true } }) : null;
      if (!cls) return refuse(reply, 'no_class');
      if (!(await takePreviewTurn(prisma, device.id, new Date()))) return refuse(reply, 'rate_limited');

      try {
        return await withinDeadline(() =>
          previewBoard(parsed.data, {
            className: cls.name,
            today: todayStr(services.env.TIMEZONE),
            zone: services.env.TIMEZONE,
            link: services.link,
            fetchIcs: services.fetchIcs,
          }),
        );
      } catch (err) {
        if (err instanceof BoardError) return refuse(reply, err.code);
        // What went wrong may quote what was read; the log gets the name of the error and nothing else.
        request.log.error({ err: { name: err instanceof Error ? err.name : typeof err } }, 'exam board preview failed');
        void reply.code(500);
        return { error: 'preview_failed', message: 'משהו השתבש, כדאי לנסות שוב.' };
      }
    },
  );

  app.put(
    '/v2/device/exam-board',
    { bodyLimit: SAVE_BODY_LIMIT, errorHandler: tooBigOnly },
    async (request, reply): Promise<DeviceResponse | { error: string; message: string }> => {
      const parsed = saveBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        void reply.code(400);
        return { error: 'invalid_exam_board', message: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}` };
      }

      // The device's own class: a parent's phone does not set a board on a class it only follows.
      const device = request.device!;
      if (!device.classId) return refuse(reply, 'no_class');
      const exams = cleanRows(parsed.data.rows, todayStr(services.env.TIMEZONE));
      if (!exams) return refuse(reply, 'bad_rows');

      const now = new Date();
      const changed = await changeBoard(prisma, device.classId, device.id, (current) => ({
        examCalendarId: null,
        examBoardKind: 'upload',
        examBoardSetAt: now,
        examCalendarSetBy: device.id,
        ...examsColumns(exams, now),
        // a board where there was none tells the class, unless it was told within the last 30 days
        ...announceAgain(current, now),
      }));
      if (changed === 'no_class') return refuse(reply, 'no_class');
      if (changed === 'locked') {
        void reply.code(403);
        return BOARD_LOCKED;
      }
      // The class's first board (or its first in 30 days): its followers are told, but for this device. A replaced board tells no one.
      await announceUploadedBoard(prisma, device.classId, device.id, now, request.log);
      return toResponse(prisma, (await loadDevice(prisma, device.id))!);
    },
  );
}
