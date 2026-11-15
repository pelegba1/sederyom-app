/**
 * The authorize page (chat connection spec 4.1): the one page of the server a
 * student sees. A chat sends them here; they type the code the app shows them,
 * and the chat is linked. It is Hebrew, right to left, in the app's notebook
 * colours (light, `app/src/theme.ts`), with no script of its own.
 *
 * What is on it came from a chat (its name, the host it sends the student back
 * to, the OAuth parameters carried in the form), so every value written into the
 * markup goes through `escapeHtml`, in text and in attributes alike.
 */
import { CHAT_GRANTS_PER_DEVICE } from '@sederyom/shared';

/** The notebook's light page (`app/src/theme.ts`, `light`). */
const C = {
  bg: '#FFFFFF',
  bgDeep: '#F1F3F8',
  border: '#D6E0EE',
  text: '#1A2347',
  textStrong: '#0F1636',
  textMuted: '#4A5472',
  accentFill: '#2347C5',
  onAccentFill: '#FFFFFF',
  focus: '#2347C5',
  cancel: '#B3261A',
  cancelSoft: 'rgba(232,80,91,.10)',
  cancelBorder: 'rgba(179,38,26,.30)',
  exam: '#5E4A00',
  examSoft: 'rgba(255,210,0,.38)',
  examBorder: 'rgba(200,160,0,.55)',
  ok: '#1E7346',
  okSoft: 'rgba(60,190,110,.14)',
  okBorder: 'rgba(30,115,70,.28)',
  margin: 'rgba(232,80,91,.55)',
} as const;

export const PAGE_COPY = {
  title: 'חיבור לסדר יום',
  line: (name: string, host: string) => `‏${name} (${host}) מבקש לקרוא את המידע שבחרת לשתף בסדר יום.`,
  unknownHost: "זה לא ChatGPT, Claude או Gemini. מתחברים רק אם הוספת את סדר יום לצ'אט הזה בעצמך.",
  label: 'הקוד מהאפליקציה',
  help: "פותחים את סדר יום ← הגדרות ← חיבור לצ'אט ← להתחבר לצ'אט",
  age: 'מלאו לי 13',
  /** The box left empty: the chats are for 13 and over, and this says so without counting as a wrong code. */
  ageNeeded: "החיבור לצ'אט מיועד למי שמלאו לו 13. כדי להמשיך צריך לסמן שמלאו לך 13.",
  button: 'לאשר',
  wrongCode: 'הקוד לא נכון או שפג תוקפו. אפשר ליצור קוד חדש באפליקציה.',
  locked: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 10 דקות.',
  tooMany: `כבר מחוברים ${CHAT_GRANTS_PER_DEVICE} צ'אטים. אפשר לנתק אחד באפליקציה.`,
  badRequest: "הקישור לחיבור לא תקין. כדאי לחזור לצ'אט ולנסות להתחבר שוב.",
  /** The chat came back with a `client_id` the server no longer has. */
  unknownClient: "הצ'אט הזה כבר לא רשום אצלנו. מסירים את סדר יום מהצ'אט ומוסיפים אותו שוב.",
} as const;

/** The chat a known host belongs to, as the page names it. */
const KNOWN_LABELS: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'claude.com': 'Claude',
  'gemini.google.com': 'Gemini',
};

/** Text made safe for HTML, between tags and inside a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
*{box-sizing:border-box}
html{background:${C.bgDeep}}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Hebrew",Arial,sans-serif;color:${C.text}}
main{width:100%;max-width:420px;background:${C.bg};border:1px solid ${C.border};border-radius:14px;
padding:28px 28px 24px 24px;border-inline-start:3px solid ${C.margin};
background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 31px,${C.border} 31px,${C.border} 32px);
background-position:0 12px}
h1{margin:0 0 12px;font-size:22px;line-height:1.4;color:${C.textStrong}}
p{margin:0 0 12px}
.known{display:inline-block;padding:2px 10px;border-radius:999px;background:${C.okSoft};border:1px solid ${C.okBorder};color:${C.ok};font-weight:600}
.warn{padding:10px 12px;border-radius:10px;background:${C.examSoft};border:1px solid ${C.examBorder};color:${C.exam}}
.error{padding:10px 12px;border-radius:10px;background:${C.cancelSoft};border:1px solid ${C.cancelBorder};color:${C.cancel};font-weight:600}
label{display:block;margin:16px 0 6px;font-weight:600;color:${C.textStrong}}
input[type=text]{width:100%;padding:10px 12px;font-size:22px;letter-spacing:.12em;text-align:center;
border:1px solid ${C.border};border-radius:10px;background:${C.bg};color:${C.textStrong};font-family:ui-monospace,Menlo,Consolas,monospace}
input[type=text]:focus,input[type=checkbox]:focus,button:focus{outline:3px solid ${C.focus};outline-offset:2px}
label.age{display:flex;align-items:center;gap:10px;margin-top:16px;font-weight:400}
input[type=checkbox]{width:20px;height:20px;margin:0;accent-color:${C.accentFill}}
.help{margin:6px 0 0;font-size:14px;color:${C.textMuted}}
button{margin-top:18px;width:100%;padding:12px;font-size:17px;font-weight:600;border:0;border-radius:10px;
background:${C.accentFill};color:${C.onAccentFill};cursor:pointer}
`;

function document(body: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(PAGE_COPY.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export interface AuthorizePageInput {
  /** Where the form posts: the authorize endpoint, from `PUBLIC_URL`. */
  action: string;
  /** The name the chat registered. */
  name: string;
  /** The host of the `redirect_uri` this request goes back to. */
  host: string;
  /** Whether that address is a known chat's (https, and one of the known hosts). */
  known: boolean;
  /** The OAuth parameters, carried in the form as hidden fields. */
  fields: Record<string, string>;
  /** What went wrong with the last try, if anything did. */
  error?: string;
}

/** The page with the code field. */
export function renderAuthorizePage(input: AuthorizePageInput): string {
  const label = input.known ? KNOWN_LABELS[input.host.toLowerCase()] ?? input.host : null;
  const hidden = Object.entries(input.fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n');
  return document(`<h1>${escapeHtml(PAGE_COPY.title)}</h1>
<p>${escapeHtml(PAGE_COPY.line(input.name, input.host))}</p>
${label ? `<p><span class="known">${escapeHtml(`✓ ${label}`)}</span></p>` : `<p class="warn">${escapeHtml(PAGE_COPY.unknownHost)}</p>`}
${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ''}
<form method="post" action="${escapeHtml(input.action)}">
${hidden}
<label for="code">${escapeHtml(PAGE_COPY.label)}</label>
<input type="text" id="code" name="code" dir="ltr" required autofocus maxlength="16" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX">
<p class="help">${escapeHtml(PAGE_COPY.help)}</p>
<label class="age"><input type="checkbox" name="age13" value="yes" required>${escapeHtml(PAGE_COPY.age)}</label>
<button type="submit">${escapeHtml(PAGE_COPY.button)}</button>
</form>`);
}

/** A page that only says what is wrong: a request the server will not take, with nothing to send back. */
export function renderErrorPage(message: string): string {
  return document(`<h1>${escapeHtml(PAGE_COPY.title)}</h1>
<p class="error" role="alert">${escapeHtml(message)}</p>`);
}
