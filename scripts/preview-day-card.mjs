/**
 * An offline host for the day card (chat connection spec 2.3, "offline render"): writes
 * `.scratch/day-card/index.html`, a plain page that opens the real card, `DAY_CARD_HTML`, in a
 * sandboxed `<iframe sandbox="allow-scripts" srcdoc=...>` once for every case, in light and dark, at
 * 320 px and 480 px wide, and plays the chat's part of the MCP Apps handshake for each frame:
 *
 *   card   ui/initialize                  -> the page answers { protocolVersion, hostInfo, hostCapabilities, hostContext: { theme } }
 *   card   ui/notifications/initialized   -> the page sends ui/notifications/tool-input, then ui/notifications/tool-result
 *   card   ui/notifications/size-changed  -> the page sets that frame's height
 *
 * A message is matched to its frame by `event.source`. Each frame sits in a wrapper with `data-case`
 * (the case's name), `data-theme`, `data-width` and `data-state` (waiting, initialized, result sent);
 * the wrapper's background is the chat's, since the card itself is transparent. In the page,
 * `__preview.report()` lists every frame with the height it asked for.
 *
 * Each frame's page also carries a strict Content-Security-Policy meta (`withPolicy`: inline script and
 * style only), so anything the card asks from outside is a console error here. The meta is the preview's;
 * the shipped page has none.
 *
 * The card's page is read from `buildDayCard()` (scripts/build-day-card.mjs), so this runs under plain
 * `node` and shows the source as it stands, not `dayCard.generated.ts`. Dates are worked out from today
 * in Israel, so "מחר" shows whenever it is run. Run it as `node scripts/preview-day-card.mjs`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildDayCard } from './build-day-card.mjs';

const OUT_DIR = fileURLToPath(new URL('../.scratch/day-card/', import.meta.url));
const OUT_FILE = `${OUT_DIR}index.html`;

// ---- Dates ---------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ZONE = 'Asia/Jerusalem';
const IN_ZONE = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' });

/** `YYYY-MM-DD` of an instant, in Israel. */
function dateOf(at) {
  const part = {};
  for (const p of IN_ZONE.formatToParts(at)) part[p.type] = p.value;
  return `${part.year}-${part.month}-${part.day}`;
}

const NOW = new Date();
const TODAY = dateOf(NOW);
/** The date `days` after (or, negative, before) today. */
const inDays = (days) => {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
/** `יום שלישי`, as the server's `weekdayName` has it. */
const weekdayOf = (date) => WEEKDAY.format(new Date(`${date}T00:00:00Z`));
/** The instant `minutes` ago. */
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const daysAgo = (days) => ago(days * (DAY_MS / 60_000));

// ---- The data: what `get_day` returns (DayCardData), in plain Hebrew -----------------------------------------

const lesson = (date, hourIndex, startTime, endTime, subject, extra = {}) => ({
  date, hourIndex, startTime, endTime, subject,
  teacher: null, room: null, status: 'regular', substitute: null, note: null,
  source: 'shahaf', changeSeenAt: null,
  ...extra,
});

const exam = (date, subject, extra = {}) => ({ naturalKey: `preview-exam-${subject}`, date, subject, details: null, source: 'shahaf', ...extra });
const event = (date, title, extra = {}) => ({ naturalKey: `preview-event-${title}`, date, title, details: null, source: 'school_site', ...extra });

const day = (date, parts = {}) => ({
  date,
  found: true,
  weekdayName: weekdayOf(date),
  isSchoolDay: true,
  holidayName: null,
  projected: false,
  exams: [],
  lessons: [],
  events: [],
  updatedAt: ago(20),
  old: false,
  ...parts,
});

/** A tool result for a day in the copy: the card draws `structuredContent`; `content` is the text a plain client gets. */
const dayResult = (data) => ({
  content: [{ type: 'text', text: `סדר יום: ${data.weekdayName} ${data.date}` }],
  structuredContent: data,
});

const TOMORROW = inDays(1);
const LONG_SUBJECT = 'מבוא למדעי המחשב ולמערכות מידע מתקדמות בהתמחות בינה מלאכותית';
const LONG_NOTE =
  'לא לשכוח להביא מחשב נייד טעון, מטען ואת המחברת של המעבדה מהשבוע שעבר. מי שלא הגיש את דוח הניסוי הראשון מתבקש לגשת למורה לפני השיעור.';
const OUTSIDE_DATE = inDays(40);
const OUTSIDE_TEXT = `אין לי מידע על ${weekdayOf(OUTSIDE_DATE)} ${Number(OUTSIDE_DATE.slice(8))}.${Number(OUTSIDE_DATE.slice(5, 7))}: העותק של סדר יום מכסה רק את השבועות הקרובים.`;

/** The cases, in the order of the page: `name`, what it shows, the tool's arguments and its result. */
const CASES = [
  {
    name: 'full',
    about: 'A full day (tomorrow): an exam, a cancellation, a substitute with a note, a moved lesson, an event.',
    date: TOMORROW,
    result: dayResult(
      day(TOMORROW, {
        // The school's own title, and the lesson it marked as the exam.
        exams: [exam(TOMORROW, 'מבחן באנגלית', { details: 'יחידה 4' })],
        lessons: [
          lesson(TOMORROW, 1, '08:00', '08:45', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(TOMORROW, 2, '08:50', '09:35', 'היסטוריה', { teacher: 'יוסי לוי', room: '112', status: 'cancelled' }),
          lesson(TOMORROW, 3, '09:50', '10:35', 'מבחן באנגלית', { teacher: 'דנה שמיר', room: '305', status: 'exam' }),
          lesson(TOMORROW, 4, '10:40', '11:25', 'ספרות', {
            teacher: 'מיכל אברהם', room: '210', status: 'substitution', substitute: 'אורי פרץ', note: 'לפתוח את הספר בעמוד 87',
          }),
          lesson(TOMORROW, 5, '11:45', '12:30', 'פיזיקה', { teacher: 'אלון ברק', room: 'מעבדה 2', status: 'moved', note: 'הועבר משיעור 7' }),
        ],
        events: [event(TOMORROW, 'יום ספורט', { details: 'כל הכיתות, ליד אולם הספורט' })],
      }),
    ),
  },
  {
    name: 'exam-titles',
    about:
      'Exams as the school writes them (tomorrow): English in hours 2 and 5, the school marking hour 5 as the exam (named by the change text), so only that row is yellow and the banner says "שעה 5"; ' +
      'a bare subject takes "מבחן ב", every other title stands as written ("שכבתי במתמטיקה", no "מבחן בשכבתי"); a block exam under one name with no hour.',
    date: TOMORROW,
    result: dayResult(
      day(TOMORROW, {
        exams: [
          exam(TOMORROW, 'מבחן באנגלית'),
          exam(TOMORROW, 'מתמטיקה'),
          exam(TOMORROW, 'שכבתי במתמטיקה'),
          exam(TOMORROW, 'בוחן בפיזיקה', { details: 'פרקים 3 עד 5' }),
          exam(TOMORROW, 'הדמיה ממוחשבת בביולוגיה'),
          exam(TOMORROW, "גוש א'"),
        ],
        lessons: [
          lesson(TOMORROW, 1, '08:00', '08:45', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(TOMORROW, 2, '08:50', '09:35', 'אנגלית', { teacher: 'דנה שמיר', room: '305' }),
          lesson(TOMORROW, 3, '09:50', '10:35', 'פיזיקה', { teacher: 'אלון ברק', room: 'מעבדה 2' }),
          lesson(TOMORROW, 4, '10:40', '11:25', 'היסטוריה', { teacher: 'יוסי לוי', room: '112' }),
          lesson(TOMORROW, 5, '11:45', '12:30', 'בוחן באנגלית', { teacher: 'דנה שמיר', room: '305', status: 'exam' }),
          lesson(TOMORROW, 6, '12:35', '13:20', 'מבחן במתמטיקה', { teacher: 'רונית כהן', room: '204', status: 'exam' }),
        ],
      }),
    ),
  },
  {
    name: 'exam-bagrut',
    about:
      'A bagrut exam (tomorrow) is a bare subject with its own hours: "בגרות במתמטיקה, ב־14:00", although the day has a regular maths lesson in hour 2, which stays unmarked; ' +
      'an exam in two lessons in a row says "שעות 4–5", the range left to right; a lesson the school marked as an exam is yellow whatever the entries say.',
    date: TOMORROW,
    result: dayResult(
      day(TOMORROW, {
        exams: [
          exam(TOMORROW, 'מתמטיקה', { kind: 'bagrut', source: 'mashov', startTime: '14:00', endTime: '15:45', details: 'מתמטיקה' }),
          exam(TOMORROW, 'בגרות באנגלית - רק למשפרים'),
          exam(TOMORROW, 'מבחן בהיסטוריה'),
          // ספרות is a subject the card does not know, but the day has its lesson, so it takes the word; a title that is no subject stands
          exam(TOMORROW, 'ספרות'),
          exam(TOMORROW, 'פירוק תערוכה'),
        ],
        lessons: [
          lesson(TOMORROW, 1, '08:00', '08:45', 'אנגלית', { teacher: 'דנה שמיר', room: '305' }),
          lesson(TOMORROW, 2, '08:50', '09:35', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(TOMORROW, 3, '09:50', '10:35', 'ספרות', { teacher: 'מיכל אברהם', room: '210' }),
          lesson(TOMORROW, 4, '10:40', '11:25', 'מבחן בהיסטוריה שיכבה יא', { teacher: 'יוסי לוי', room: '112', status: 'exam' }),
          lesson(TOMORROW, 5, '11:45', '12:30', 'מבחן בהיסטוריה שיכבה יא', { teacher: 'יוסי לוי', room: '112', status: 'exam' }),
          lesson(TOMORROW, 6, '12:35', '13:20', 'מבחן באנגלית', { teacher: 'דנה שמיר', room: '305', status: 'exam' }),
        ],
      }),
    ),
  },
  {
    name: 'exam-projected',
    about: 'An exam on a day projected from the fixed timetable (tomorrow): no hour is named, no lesson is marked, and the "fixed timetable" line says why.',
    date: TOMORROW,
    result: dayResult(
      day(TOMORROW, {
        projected: true,
        exams: [exam(TOMORROW, 'מבחן באנגלית')],
        lessons: [
          lesson(TOMORROW, 1, '08:00', '08:45', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(TOMORROW, 2, '08:50', '09:35', 'אנגלית', { teacher: 'דנה שמיר', room: '305' }),
          lesson(TOMORROW, 3, '09:50', '10:35', 'היסטוריה', { teacher: 'יוסי לוי', room: '112' }),
        ],
      }),
    ),
  },
  {
    name: 'holiday',
    about: 'A day with no school (tomorrow): the holiday in the header, no lessons.',
    date: TOMORROW,
    result: dayResult(day(TOMORROW, { isSchoolDay: false, holidayName: 'חנוכה' })),
  },
  {
    name: 'outside',
    about: 'A day out of the copy: text only (found: false).',
    date: OUTSIDE_DATE,
    result: { content: [{ type: 'text', text: OUTSIDE_TEXT }], structuredContent: { found: false, text: OUTSIDE_TEXT } },
  },
  {
    name: 'long',
    about: 'A subject of about 60 characters with a long note, a long teacher and room, and its exam banner (in two days).',
    date: inDays(2),
    result: dayResult(
      day(inDays(2), {
        exams: [exam(inDays(2), LONG_SUBJECT, { details: 'מועד א׳, כל החומר מתחילת השנה' })],
        lessons: [
          lesson(inDays(2), 1, '08:00', '08:45', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(inDays(2), 2, '08:50', '09:35', LONG_SUBJECT, {
            teacher: 'ד״ר יהודית בן־עמי וינשטיין', room: 'מעבדת מחשבים, קומה שלישית, אגף מזרחי', note: LONG_NOTE, status: 'exam',
          }),
          lesson(inDays(2), 3, '09:50', '10:35', 'אנגלית', { teacher: 'דנה שמיר', room: '305' }),
        ],
      }),
    ),
  },
  {
    name: 'old',
    about: 'An old copy (nine days): the timetable as set, the "not up to date" line, and the footer with a date.',
    date: TODAY,
    result: dayResult(
      day(TODAY, {
        projected: true,
        old: true,
        updatedAt: daysAgo(9),
        lessons: [
          lesson(TODAY, 1, '08:00', '08:45', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(TODAY, 2, '08:50', '09:35', 'היסטוריה', { teacher: 'יוסי לוי', room: '112' }),
          lesson(TODAY, 3, '09:50', '10:35', 'אנגלית', { teacher: 'דנה שמיר', room: '305' }),
          lesson(TODAY, 4, '10:40', '11:25', 'ספרות', { teacher: 'מיכל אברהם', room: '210' }),
        ],
      }),
    ),
  },
  {
    name: 'other-day',
    about: 'A copy made three days ago, not old: the footer shows the date.',
    date: TOMORROW,
    result: dayResult(
      day(TOMORROW, {
        updatedAt: daysAgo(3),
        lessons: [
          lesson(TOMORROW, 1, '08:00', '08:45', 'מתמטיקה', { teacher: 'רונית כהן', room: '204' }),
          lesson(TOMORROW, 2, '08:50', '09:35', 'אנגלית', { teacher: 'דנה שמיר', room: '305' }),
          lesson(TOMORROW, 3, '09:50', '10:35', 'ספרות', { teacher: 'מיכל אברהם', room: '210' }),
        ],
      }),
    ),
  },
];

// ---- The page ------------------------------------------------------------------------------------------------

/** The chat's background in each theme, which the card shows through. */
const THEMES = [
  { name: 'light', background: '#f4f4f6' },
  { name: 'dark', background: '#212121' },
];
const WIDTHS = [320, 480];

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Text for a double-quoted attribute: the card's page has quotes and ampersands in it. */
const attr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** JSON that can sit in a <script> element. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

/**
 * The host's script. It runs in the page, not here: this function is written into the page as text
 * (`runHost.toString()`), so it may use nothing of this file but its argument.
 */
function runHost(cases) {
  const PROTOCOL_VERSION = '2026-01-26';
  const METHOD_NOT_FOUND = -32601;

  const frames = () => Array.from(document.querySelectorAll('iframe'));
  const frameOf = (source) => frames().find((frame) => frame.contentWindow === source) || null;
  const send = (frame, message) => frame.contentWindow.postMessage(message, '*');
  const labelOf = (wrap) => wrap.dataset.case + ' / ' + wrap.dataset.theme + ' / ' + wrap.dataset.width;
  const request = (message) => message.method !== undefined && (typeof message.id === 'number' || typeof message.id === 'string');

  window.addEventListener('message', (event) => {
    const frame = frameOf(event.source);
    if (!frame) return;
    const wrap = frame.closest('[data-case]');
    const test = cases[wrap.dataset.case];
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') {
      console.warn('[host] not JSON-RPC, from ' + labelOf(wrap), message);
      return;
    }

    if (message.method === 'ui/initialize' && request(message)) {
      wrap.dataset.state = 'initialized';
      send(frame, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: { name: 'preview', version: '1' },
          hostCapabilities: {},
          hostContext: { theme: wrap.dataset.theme },
        },
      });
    } else if (message.method === 'ui/notifications/initialized') {
      send(frame, { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { date: test.date } } });
      send(frame, { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: test.result });
      wrap.dataset.state = 'result sent';
    } else if (message.method === 'ui/notifications/size-changed') {
      const height = message.params && message.params.height;
      if (typeof height !== 'number' || !(height >= 0)) {
        console.warn('[host] size-changed without a height, from ' + labelOf(wrap), message);
        return;
      }
      frame.style.height = height + 'px';
      wrap.dataset.height = String(height);
      const dims = wrap.closest('figure').querySelector('.dims');
      if (dims) dims.textContent = wrap.dataset.width + ' x ' + height;
    } else if (request(message)) {
      console.warn('[host] a request it does not answer, from ' + labelOf(wrap), message.method);
      send(frame, { jsonrpc: '2.0', id: message.id, error: { code: METHOD_NOT_FOUND, message: 'Method not found: ' + message.method } });
    } else {
      console.log('[host] ignored, from ' + labelOf(wrap), message.method);
    }
  });

  window.__preview = {
    /** Every frame: its case, theme and width, the state of its handshake, and the height it asked for. */
    report: () =>
      frames().map((frame) => {
        const wrap = frame.closest('[data-case]');
        const { case: name, theme, width, state, height } = wrap.dataset;
        return { case: name, theme, width: Number(width), state, height: height === undefined ? null : Number(height) };
      }),
  };
}

const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; min-width: 900px; font: 14px/1.45 system-ui, sans-serif; background: #d4d4da; color: #1b1b1f; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .lead { margin: 0 0 28px; color: #4a4a52; }
  section { margin: 0 0 36px; }
  h2 { margin: 0; font-size: 16px; }
  .about { margin: 2px 0 12px; color: #4a4a52; font-size: 13px; }
  .grid { display: grid; grid-template-columns: max-content max-content; gap: 14px 18px; justify-content: start; align-items: start; }
  figure { margin: 0; }
  figcaption { margin: 0 0 4px; color: #4a4a52; font-size: 12px; }
  .dims { margin-inline-start: 8px; font-variant-numeric: tabular-nums; }
  .wrap { overflow: visible; }
  .wrap[data-state=waiting] { outline: 2px dashed #b3261e; }
  iframe { display: block; width: 100%; height: 24px; border: 0; }
`;

function figureOf(name, theme, width, srcdoc) {
  return (
    `<figure class="cell"><figcaption>${escapeHtml(theme.name)}, ${width} px<span class="dims"></span></figcaption>` +
    `<div class="wrap" data-case="${escapeHtml(name)}" data-theme="${theme.name}" data-width="${width}" data-state="waiting" ` +
    `style="width:${width}px;background:${theme.background}">` +
    `<iframe sandbox="allow-scripts" title="${escapeHtml(`${name}, ${theme.name}, ${width}`)}" srcdoc="${attr(srcdoc)}"></iframe>` +
    '</div></figure>'
  );
}

/**
 * What a chat's frame would allow the card: its own script and styles and nothing else, so a font, an
 * image or a request the card makes shows in the console as a CSP error. Added here, in the preview, and
 * not to the shipped page (the real host sets its own policy). Placed after the charset meta.
 */
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";
const CHARSET_META = '<meta charset="utf-8">';
function withPolicy(cardHtml) {
  if (!cardHtml.includes(CHARSET_META)) throw new Error('the card page has no charset meta to put the policy after');
  return cardHtml.replace(CHARSET_META, `${CHARSET_META}<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
}

function pageOf(cardHtml) {
  const framed = withPolicy(cardHtml);
  const sections = CASES.map(
    ({ name, about }) =>
      `<section><h2>${escapeHtml(name)}</h2><p class="about">${escapeHtml(about)}</p><div class="grid">` +
      THEMES.flatMap((theme) => WIDTHS.map((width) => figureOf(name, theme, width, framed))).join('') +
      '</div></section>',
  ).join('');
  const byName = Object.fromEntries(CASES.map(({ name, date, result }) => [name, { date, result }]));
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Day card, offline host</title>' +
    `<style>${PAGE_CSS}</style>` +
    // The listener is in the head, so it is there before the first frame starts.
    `<script>(${runHost.toString()})(${scriptJson(byName)});</script>` +
    '</head><body>' +
    '<h1>Day card, offline host</h1>' +
    `<p class="lead">Made ${escapeHtml(NOW.toISOString())} (today in Israel is ${TODAY}). Every frame is the card, in a sandboxed iframe under a strict CSP, answered by this page. ` +
    'Each frame\'s height is the one the card asked for; a dashed red outline means the handshake never started.</p>' +
    sections +
    '</body></html>'
  );
}

const html = pageOf(await buildDayCard());
await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, html, 'utf8');
console.log(`${OUT_FILE}: ${html.length} characters, ${CASES.length} cases, ${CASES.length * THEMES.length * WIDTHS.length} frames`);
