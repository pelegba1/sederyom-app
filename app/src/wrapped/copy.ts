/**
 * The year in review's words: what each card says around its one number, the
 * rows "מאיפה המספר" lists, and when Today offers the review.
 *
 * Nothing here counts: every number comes from the card (`shared/logic/wrapped`).
 * A sentence that has nothing behind it is left out, never filled in. A subject
 * is never the subject of a verb, since the words cannot know its gender.
 */
import type { DateStr } from '@sederyom/shared';
import { schoolYearStart, type WrappedCard, type WrappedRecord } from '@sederyom/shared/logic/wrapped/types';
import { formatShortDate, plural } from '../lib/format';

/** A part of a card's line; `bold` parts are the numbers the line is about. */
export interface Segment {
  text: string;
  bold?: boolean;
}

export interface CardCopy {
  /** The small line at the top: what the card is about. */
  kicker: string;
  /** The big one: a number, or a word (a subject's name, the closing). */
  hero: string;
  heroKind: 'number' | 'word';
  /** Behind the hero: the highlighter, the teacher's red pen around it, or nothing. */
  pen: 'mark' | 'red' | 'none';
  unit: string | null;
  line: Segment[] | null;
  /** The quiet last line: since when it is counted, or a second fact. */
  since: string | null;
  /** "מאיפה המספר": the sheet's title and how the number was counted. None on the closing. */
  source: { title: string; note: string } | null;
}

export const WRAPPED_COPY = {
  settingsRow: 'סיכום השנה עד עכשיו',
  settingsLine: 'המספרים של השנה שלך, מהמערכת, מהמשימות וממשוב',
  entryTitle: 'סיכום השנה שלך מוכן',
  open: 'לפתוח',
  source: 'מאיפה המספר',
  own: 'נשאר אצלך',
  share: 'שיתוף',
  shareFailed: 'לא הצלחנו לשתף. אפשר לנסות שוב',
  shareUnavailable: 'אי אפשר לשתף מהטלפון הזה',
  again: 'לראות שוב',
  close: 'סגירה',
  entryClose: 'להסתיר את סיכום השנה',
  next: 'הכרטיס הבא',
  back: 'הכרטיס הקודם',
  loading: 'אוספים את השנה שלך…',
  /** The class history could not be read now, and what the phone kept is shown. */
  kept: 'אין חיבור כרגע. מוצג מה שנשמר בטלפון.',
  /** The class history could not be read, and the phone has none: the cards from the timetable are missing. */
  missing: 'אין חיבור כרגע, אז חסרים הכרטיסים של המערכת.',
  noRows: 'אין שורות להציג לכרטיס הזה.',
} as const;

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'] as const;
const SHORT_WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

/** "1 בספטמבר". */
export function dayMonthHe(date: DateStr): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ב${MONTHS[(m ?? 1) - 1]}`;
}

/** "יום א׳ 25.10". */
function shortDay(date: DateStr): string {
  return `יום ${SHORT_WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]} ${formatShortDate(date)}`;
}

function hoursHe(hours: number): string {
  return hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`;
}

/**
 * Minutes as people say them: "שעתיים וחצי", "3 שעות ו־20 דקות". From three
 * quarters of an hour on it is "כמעט" the next hour; the rows behind the card
 * keep the minutes.
 */
export function durationHe(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest >= 45) return `כמעט ${hoursHe(hours + 1)}`;
  if (hours === 0) return `${rest} דקות`;
  if (rest === 0) return hoursHe(hours);
  if (rest === 30) return `${hoursHe(hours)} וחצי`;
  return `${hoursHe(hours)} ו־${rest} דקות`;
}

const b = (text: string | number): Segment => ({ text: String(text), bold: true });
const t = (text: string): Segment => ({ text });
const num = (card: WrappedCard, key: string): number => (typeof card.params[key] === 'number' ? (card.params[key] as number) : 0);
const str = (card: WrappedCard, key: string): string | null => (typeof card.params[key] === 'string' ? (card.params[key] as string) : null);
const sinceFrom = (card: WrappedCard): string | null => (card.from ? `מאז ${dayMonthHe(card.from)}.` : null);
/** "בלי שיעור אחד שאין לו שעה במערכת."; null when every one has a time. */
const withoutTime = (count: number, one: string, many: string): string | null => (
  count === 0 ? null : count === 1 ? `בלי ${one} שאין לו שעה במערכת.` : `בלי ${count} ${many} שאין להם שעה במערכת.`
);
const sentences = (...parts: (string | null)[]): string | null => parts.filter(Boolean).join(' ') || null;

const SCHOOL_DAY = 'ימים שהיה בהם לפחות שיעור אחד שלך במערכת של הכיתה. בלי חגים, חופשות וימי חופש שסימנת.';
const SEEN_CHANGES = 'שינויים שהאפליקציה ראתה באתר של בית הספר לפני שהשיעור התחיל. מה שקרה לפני שהיא התחילה לעקוב לא נספר.';

export function cardCopy(card: WrappedCard): CardCopy {
  const number = { hero: String(card.value), heroKind: 'number', pen: 'mark' } as const;
  switch (card.id) {
    case 'intro': {
      const source = { title: plural(card.value, 'יום לימודים אחד', 'ימי לימודים'), note: SCHOOL_DAY };
      if (!card.from || !card.to || card.value === 0) {
        return {
          kicker: 'השנה שלך עד עכשיו', hero: 'עוד מעט', heroKind: 'word', pen: 'none', unit: null,
          line: [t('עוד לא נשמרו ימים מהמערכת של הכיתה.')], since: null, source,
        };
      }
      const observedFrom = str(card, 'observedFrom');
      return {
        kicker: 'השנה שלך עד עכשיו', ...number, unit: card.value === 1 ? 'יום לימודים' : 'ימי לימודים',
        line: [t(`מ־${dayMonthHe(card.from)} עד ${dayMonthHe(card.to)}.`)],
        since: observedFrom ? `השינויים נספרים מ־${dayMonthHe(observedFrom)}.` : null,
        source,
      };
    }
    case 'hours': {
      const untimed = num(card, 'untimed');
      return {
        kicker: 'שעות במערכת', ...number, unit: 'שעות של שיעורים',
        line: [b(num(card, 'lessons')), t(' שיעורים ב־'), b(num(card, 'days')), t(' ימים.')],
        since: withoutTime(untimed, 'שיעור אחד', 'שיעורים'),
        source: {
          title: `${card.value} שעות של שיעורים`,
          note: 'השיעורים שלך כפי שפורסמו במערכת, לפי שעת ההתחלה והסיום של כל אחד. גם שיעור שבוטל נספר, כי הוא היה במערכת.',
        },
      };
    }
    case 'held': {
      const top = str(card, 'top');
      return {
        kicker: 'שיעורים במשוב', ...number, unit: 'שיעורים נרשמו במשוב',
        line: [t('ב־'), b(num(card, 'subjects')), t(' מקצועות.'), ...(top ? [t(' הכי הרבה: '), b(top), t(`, ${num(card, 'topHeld')}.`)] : [])],
        since: null,
        source: { title: `${card.value} שיעורים במשוב`, note: 'המספר שמשוב עצמו מציג לכל מקצוע שלך. הוא סופר רק שיעורים שהמורה רשם.' },
      };
    }
    case 'cancelled': {
      const minutes = num(card, 'minutes');
      const free = minutes === 0 ? null : durationHe(minutes);
      return {
        kicker: 'שיעורים שבוטלו', hero: String(card.value), heroKind: 'number', pen: 'red', unit: 'שיעורים בוטלו',
        // "שעה חופשית" and "כמעט שעה חופשית"; "שעתיים חופשיות", "20 דקות חופשיות".
        line: free ? [b(free), t(free.endsWith('שעה') ? ' חופשית.' : ' חופשיות.')] : null,
        since: sentences(sinceFrom(card), free ? withoutTime(num(card, 'untimed'), 'שיעור אחד', 'שיעורים') : null),
        source: { title: `${card.value} שיעורים שבוטלו`, note: SEEN_CHANGES },
      };
    }
    case 'cancelledTop': {
      const weekday = str(card, 'weekday');
      return {
        kicker: 'הכי הרבה ביטולים', hero: str(card, 'subject') ?? '', heroKind: 'word', pen: 'mark',
        unit: `${card.value} ביטולים מתוך ${num(card, 'total')}`,
        line: weekday ? [t('בכל המקצועות ביחד, הכי הרבה ביטולים ב'), b(weekday), t('.')] : null,
        since: sinceFrom(card),
        source: { title: `הביטולים של ${str(card, 'subject') ?? ''}`, note: `${SEEN_CHANGES} כשיש תיקו בין מקצועות או בין ימים, לא מוצג שם.` },
      };
    }
    case 'sleep': {
      const minutes = num(card, 'minutes');
      return {
        kicker: 'שיעור ראשון שבוטל', ...number, unit: 'בקרים של שינה',
        line: minutes > 0 ? [t('ביחד '), b(durationHe(minutes)), t(' עד השיעור הראשון שהתקיים.')] : null,
        since: sentences(sinceFrom(card), minutes > 0 ? withoutTime(num(card, 'untimed'), 'בוקר אחד', 'בקרים') : null),
        source: {
          title: `${card.value} בקרים של שינה`,
          note: 'ימים שהשיעור הראשון שלך בוטל והיה שיעור אחר כך. הזמן הוא מתחילת השיעור שבוטל עד תחילת השיעור הראשון שהתקיים.',
        },
      };
    }
    case 'substitutes': {
      const substitutions = num(card, 'substitutions');
      const moved = num(card, 'moved');
      return {
        kicker: 'שינויים במערכת', ...number, unit: 'שיעורים השתנו',
        line: moved === 0 ? [t('כולם עם מילוי מקום.')]
          : substitutions === 0 ? [t('כולם הוזזו או השתנו.')]
            : [b(substitutions), t(' עם מילוי מקום ו־'), b(moved), t(' שהוזזו או השתנו.')],
        since: sinceFrom(card),
        source: { title: `${card.value} שיעורים שהשתנו`, note: `${SEEN_CHANGES} שיעור שהוזז נספר פעם אחת. שינוי של חדר לא נספר.` },
      };
    }
    case 'days': {
      const date = str(card, 'longestDate');
      const day = date ? `${str(card, 'longestWeekday') ?? ''} ${formatShortDate(date)}` : '';
      const start = str(card, 'longestStart');
      const end = str(card, 'longestEnd');
      const many = num(card, 'longestDays');
      const shortest = num(card, 'shortestLessons');
      const shortDate = str(card, 'shortestDate');
      return {
        kicker: 'היום הכי ארוך', ...number, unit: 'שיעורים ביום אחד',
        line: many > 1
          ? [t('היו '), b(many), t(` ימים כאלה. הראשון: ${day}.`)]
          : [b(day), t(start && end ? `, מ־${start} עד ${end}.` : '.')],
        since: shortest < card.value && shortDate
          ? `הכי קצר: ${plural(shortest, 'שיעור אחד', 'שיעורים')}, ${str(card, 'shortestWeekday') ?? ''} ${formatShortDate(shortDate)}.`
          : null,
        source: { title: 'היום הכי ארוך והכי קצר', note: 'לפי מספר השיעורים שלך שפורסמו במערכת לאותו יום. מבין ימים שווים, מוצג הראשון.' },
      };
    }
    case 'exams': {
      const week = str(card, 'weekStart');
      return {
        kicker: 'מבחנים', ...number, unit: 'מבחנים מאחוריך',
        line: week ? [t('השבוע הכי עמוס: '), b(num(card, 'weekCount')), t(` מבחנים, בשבוע של ${formatShortDate(week)}.`)] : null,
        since: sinceFrom(card),
        source: { title: `${card.value} מבחנים`, note: 'מבחנים מלוח המבחנים שהתאריך שלהם עבר, ומבחנים שהוספת. בלי מבחנים שסימנת שאינם שלך.' },
      };
    }
    case 'tasks': {
      const withDue = num(card, 'withDue');
      const streak = num(card, 'streak');
      return {
        kicker: 'משימות', ...number, unit: 'משימות סומנו',
        line: withDue > 0 ? [b(`${num(card, 'beforeDue')} מתוך ${withDue}`), t(' עד המועד.')] : null,
        since: streak > 0 ? `הרצף הכי ארוך: ${streak} ימים.` : null,
        source: {
          title: `${card.value} משימות שסומנו`,
          note: 'משימות ושיעורי בית שסימנת, לפי היום שבו סומנו. מה שסומן לפני שהאפליקציה התחילה לשמור את הרגע לא נספר.',
        },
      };
    }
    case 'attendance': {
      const absences = num(card, 'absences');
      const lates = num(card, 'lates');
      const justified = num(card, 'justified');
      const parts = [
        ...(absences > 0 ? [plural(absences, 'חיסור אחד', 'חיסורים')] : []),
        ...(lates > 0 ? [plural(lates, 'איחור אחד', 'איחורים')] : []),
      ];
      return {
        kicker: 'נוכחות', ...number, unit: 'רישומים במשוב',
        line: [t(`${parts.join(' ו־')}.`)],
        since: justified === 0 ? null : justified === 1 ? 'אחד מהם מוצדק.' : `${justified} מהם מוצדקים.`,
        source: { title: `${card.value} רישומי נוכחות`, note: 'חיסורים ואיחורים מתחילת שנת הלימודים, כמו שהם רשומים במשוב.' },
      };
    }
    case 'grades': {
      const best = str(card, 'best');
      const trend = card.params.trend;
      const points = (n: number): string => (n === 1 ? 'בנקודה' : `ב־${n} נקודות`);
      return {
        kicker: 'ציונים', ...number, unit: 'הממוצע שלך',
        line: [t('ב־'), b(num(card, 'count')), t(' ציונים.'), ...(best ? [t(' הכי חזק: '), b(best), t('.')] : [])],
        since: typeof trend !== 'number' ? 'ממוצע פשוט, בלי משקלים.'
          : trend === 0 ? 'שני החצאים יצאו אותו דבר.'
            : `החצי השני ${trend > 0 ? 'גבוה' : 'נמוך'} ${points(Math.abs(trend))} מהראשון.`,
        source: {
          title: `ממוצע ${card.value}`,
          note: 'ממוצע פשוט של הציונים במספרים מהשנה הזאת, בלי משקלים. החצאים: עד אמצע התקופה ואחריו.',
        },
      };
    }
    case 'outro':
      return {
        kicker: 'סיום', hero: 'זהו,\nעד עכשיו.', heroKind: 'word', pen: 'none', unit: null,
        line: [t('הסיכום מתעדכן כל יום, ונמצא בהגדרות.')], since: null, source: null,
      };
  }
}

/** One row of "מאיפה המספר". */
export interface RecordRow {
  /** The row's start: its day (and hour), or a subject for Mashov's count. */
  lead: string;
  text: string;
  /** At the row's end: an amount or what kind of row it is. */
  end: string | null;
  /** A cancelled lesson's subject is struck through, as on Today. */
  struck: boolean;
}

export function recordRow(r: WrappedRecord): RecordRow {
  const day = r.date ? shortDay(r.date) : '';
  const dayHour = r.hour !== null && day ? `${day}, שעה ${r.hour}` : day;
  const subject = r.subject ?? '';
  switch (r.kind) {
    case 'cancelled': return { lead: dayHour, text: subject, end: null, struck: true };
    case 'sleep': return { lead: day, text: subject, end: r.amount !== null ? `${r.amount} דקות` : null, struck: true };
    case 'substitution': return { lead: dayHour, text: subject, end: 'מילוי מקום', struck: false };
    case 'moved': return { lead: dayHour, text: subject, end: 'שינוי', struck: false };
    case 'day': return { lead: day, text: plural(r.amount ?? 0, 'שיעור אחד', 'שיעורים'), end: null, struck: false };
    case 'held': return { lead: subject, text: '', end: String(r.amount ?? 0), struck: false };
    case 'exam': return { lead: day, text: subject, end: null, struck: false };
    case 'task': return { lead: day, text: r.title ?? '', end: null, struck: false };
    case 'homework': return { lead: day, text: subject ? `שיעורי בית, ${subject}` : 'שיעורי בית', end: null, struck: false };
    case 'absence': return { lead: dayHour, text: subject, end: 'חיסור', struck: false };
    case 'late': return { lead: dayHour, text: subject, end: 'איחור', struck: false };
    case 'grade': return { lead: day, text: subject, end: r.amount !== null ? String(r.amount) : null, struck: false };
  }
}

/** Today offers the review from the last school week (schools end on 20 June) to the end of July. */
export function inEntryWindow(today: DateStr): boolean {
  const monthDay = today.slice(5);
  return monthDay >= '06-14' && monthDay <= '07-31';
}

/** Whether Today offers it: in the window, and not closed for this school year (`dismissed` is the year's 1 September). */
export function entryShown(today: DateStr, dismissed: string | null): boolean {
  return inEntryWindow(today) && dismissed !== schoolYearStart(today);
}

/** The line under Today's card: "39 ימי לימודים, 5 ביטולים, 11 משימות."; null with no days to speak of. */
export function entrySummary(cards: readonly WrappedCard[]): string | null {
  const value = (id: WrappedCard['id']): number => cards.find((c) => c.id === id)?.value ?? 0;
  const days = value('intro');
  if (days === 0) return null;
  const parts = [
    plural(days, 'יום לימודים אחד', 'ימי לימודים'),
    ...(value('cancelled') > 0 ? [`${value('cancelled')} ביטולים`] : []),
    ...(value('tasks') > 0 ? [`${value('tasks')} משימות`] : []),
  ];
  return `${parts.join(', ')}.`;
}

/**
 * Whether Today's row has anything to open: a school day that was counted, or
 * a card of the phone's own (tasks, grades). Until the cards are known it has not.
 */
export function entryReady(cards: readonly WrappedCard[] | null): boolean {
  if (!cards) return false;
  return cards.some((c) => (c.id === 'intro' ? c.value > 0 : c.id !== 'outro'));
}

/** A close that happens once: a second tap before the screen left must not close the one under it. */
export function closeOnce(close: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    close();
  };
}
