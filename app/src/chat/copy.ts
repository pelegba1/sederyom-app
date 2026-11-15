/**
 * Every word the chat connection says on the phone (docs/superpowers/specs/2026-11-04-chat-connection-design.md).
 * A failure says one of these, never the server's message, and never a word of
 * what it was sent: K, a code, the copy and its ciphertext stay out of every
 * message, toast and log.
 */
import { CHAT_GRANTS_PER_DEVICE } from '@sederyom/shared';

export const CHAT_COPY = {
  /** Any failure of a call to the server, or of the write: the same words as the friends' (`BUDDY_COPY.failed`). */
  failed: 'לא הצלחנו להתחבר. כדאי לנסות שוב.',
  /** The copy of the school day is over the size the server takes, even cut down as far as it is cut. */
  tooLarge: 'המידע גדול מדי לשליחה לצ׳אט.',

  // The page's rows and its last line (`chat/view.ts`). A day is named only as the student would: today and yesterday with the time, an older one by its date.
  today: 'היום',
  yesterday: 'אתמול',
  onDate: (date: string) => `ב־${date}`,
  /** A chat that is linked and has read the copy: `when` is the day, and for today or yesterday the time as well. */
  rowUsed: (when: string) => `מחובר, השתמש לאחרונה ${when}`,
  rowNeverUsed: 'מחובר, עוד לא השתמש',
  /** A chat from a host the app does not know, until the student confirms it. */
  rowWaiting: (host: string) => `מחכה לאישור שלך, מ־${host}`,
  /** The phone's last write of the copy. */
  sentLast: (when: string) => `המידע נשלח לאחרונה ${when}`,

  // The page (`screens/ChatScreen.tsx`) and its row in Settings → אני. A chat's own name is set by the screen with `isolateName` before it goes into `approvePrompt` or `cutConfirm`.
  title: 'חיבור לצ׳אט',
  row: 'חיבור לצ׳אט',
  rowHint: 'לשאול את ChatGPT על המערכת והמבחנים',
  rowLinked: (n: number) => (n === 1 ? 'צ׳אט אחד מחובר' : `${n} צ׳אטים מחוברים`),
  intro: 'הצ׳אט שלך (ChatGPT, Claude ועוד) יוכל לענות על שאלות על המערכת, המבחנים, ומה שבחרת לשתף.',
  connect: 'להתחבר לצ׳אט',
  codeHint: 'מוסיפים את סדר יום בצ׳אט עם הכתובת שלמטה, ובדף שנפתח מקלידים את הקוד הזה.',
  /** Where a chat adds the connection, until ChatGPT lists סדר יום in its own directory. */
  addressHint: 'ב־ChatGPT: בהגדרות, ב״Developer mode״. ב־Claude: בהגדרות, ב״Add custom connector״.',
  copyAddress: 'להעתיק את הכתובת',
  addressCopied: 'הכתובת הועתקה',
  /** `time` is the hour and minute the code stops being good, in the app's zone (`timeIn`). */
  codeValid: (time: string) => `הקוד תקף עד ${time}`,
  codeExpired: 'תוקף הקוד עבר. אפשר ליצור קוד חדש.',
  copy: 'להעתיק',
  copied: 'הקוד הועתק',
  /** The phone did not take the code onto its clipboard; it is still on the screen to be typed. */
  copyFailed: 'לא הצלחנו להעתיק את הקוד.',
  linkedToast: 'הצ׳אט מחובר',
  /** A chat came with the code but waits for the student's word (an unknown host): its row, below the fold, asks. The code goes, so this says why. */
  waitingToast: 'צ׳אט חדש מחכה לאישור שלך.',
  full: `אפשר לחבר עד ${CHAT_GRANTS_PER_DEVICE} צ׳אטים. כדאי לנתק אחד מהם קודם.`,
  sharesTitle: 'מה לשתף',
  timetable: 'מערכת ומבחנים',
  timetableHint: 'תמיד. בלי זה אין חיבור.',
  /** One label for each switch, in the order of `DEFAULT_CHAT_SHARES`. */
  shares: {
    homework: 'שיעורי בית',
    grades: 'ציונים וממוצעים',
    bagrut: 'ציוני בגרות',
    absences: 'חיסורים',
    messages: 'הודעות ממשוב',
  },
  chatsTitle: 'צ׳אטים מחוברים',
  approvePrompt: (name: string, host: string) =>
    `${name} מבקש להתחבר מ־${host}. זה לא ChatGPT, Claude או Gemini. כדאי לחבר רק אם הוספת את סדר יום לצ׳אט הזה בעצמך.`,
  approve: 'לחבר',
  cut: 'לנתק',
  cutAll: 'לנתק הכול',
  cutConfirm: (name: string) => `לנתק את ${name}?`,
  cutAllConfirm: 'לנתק את כל הצ׳אטים? המידע שנשמר בשבילם יימחק.',
  footer: 'מה שמשתפים נשלח לחברה שמפעילה את הצ׳אט (OpenAI, Anthropic, Google). סדר יום שומר עותק מוצפן כל עוד יש צ׳אט מחובר.',
  privacy: 'מדיניות הפרטיות',
} as const;
