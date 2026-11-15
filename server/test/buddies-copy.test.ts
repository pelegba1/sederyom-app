/**
 * The friends screens' words (app/src/buddies/copy.ts): every string, and
 * every line its functions make, keeps the app's copy rules and the spec's
 * (§1.3): nothing gendered, nothing about a friend's class, no "·", no
 * spaced long dash, and ranges set left to right.
 */
import { describe, expect, it } from 'vitest';
import type { BuddyShares } from '@sederyom/shared';
import { BUDDY_COPY, buddyNames, edgeNames } from '../../app/src/buddies/copy';
import { BUDDY_NOTES } from '../../app/src/buddies/protocol';
import { isolateRanges } from '../../app/src/lib/format';

/** The first-strong isolate a name is set in, and its end. */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const iso = (name: string) => `${FSI}${name}${PDI}`;

/** What each function is called with: names, times, a range, a count and periods, whatever it reads. */
const SAMPLES: readonly unknown[][] = [
  ['נועה'], ['14:00'], ['11:15–12:20'], [1], [2], [0], ['https://sederyom.example/b#x'],
  ['נועה', '11:15–12:20'], ['14:00', 'נועה, יואב'], ['נועה', 'מערכת וחיסורים'], [6, 'נועה'], ['נועה', 'לפני 20 דקות'],
  ['נועה', '12:20', '14:00'], ['נועה', 4, 5], ['נועה', 4, 4], [{ timetable: true, absences: false }], [{ timetable: false, absences: false }],
  ['נועה', '1.9'], [{ timetable: true, absences: true, grades: true, bagrut: true }],
];

/** Every line the copy can say: its strings, and its functions over the samples that suit their arity. */
function lines(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    return SAMPLES.filter((args) => args.length === value.length).flatMap((args) => {
      const out = (value as (...a: unknown[]) => unknown)(...args);
      return typeof out === 'string' ? [out] : [];
    });
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap(lines);
  return [];
}

describe('the friends copy', () => {
  it('says nothing gendered or about classes', () => {
    const all = lines(BUDDY_COPY);
    expect(all.length).toBeGreaterThan(60);
    for (const line of all) {
      for (const banned of ['הכיתה של', 'לכיתה', 'היא ', 'הוא ', 'החבר ', 'אצלו', '·', ' — ']) {
        expect(line, line).not.toContain(banned);
      }
      // Quotes are ״…״ only.
      expect(line, line).not.toMatch(/"[א-ת]|[א-ת]"|“|”/);
    }
  });

  it('sets ranges left to right', () => {
    const isolated = (line: string) => expect(line).toMatch(/⁦[^⁩]*–[^⁩]*⁩/);
    expect(BUDDY_COPY.todayWindow('נועה', '11:15–12:20')).toBe(isolateRanges('חלון משותף עם נועה 11:15–12:20'));
    isolated(BUDDY_COPY.todayWindow('נועה', '11:15–12:20'));
    expect(BUDDY_COPY.todayWindowPeriods('נועה', 4, 5)).toBe(isolateRanges('חלון משותף עם נועה בשיעורים 4–5'));
    isolated(BUDDY_COPY.todayWindowPeriods('נועה', 4, 5));
    expect(BUDDY_COPY.todayWindowPeriods('נועה', 4, 4)).toBe('חלון משותף עם נועה בשיעור 4');
    isolated(BUDDY_COPY.windowAt('11:15–12:20'));
    isolated(BUDDY_COPY.windowAt(BUDDY_COPY.periods(4, 5)));
  });

  it('says the words the spec gives', () => {
    expect(BUDDY_COPY.inviteMessage('https://x/b#s')).toBe('בואו נהיה חברים בסדר יום, ככה נראה מתי מסיימים יחד ומתי יש חלון משותף:\nhttps://x/b#s');
    expect(BUDDY_COPY.fromThem('פלג', BUDDY_COPY.shareParts({ timetable: true, absences: true }))).toBe(`השיתוף מ${iso('פלג')}: מערכת וחיסורים`);
    expect(['מערכת וחיסורים', 'מערכת', 'חיסורים', 'כלום בינתיים']).toEqual([
      BUDDY_COPY.shareParts({ timetable: true, absences: true }), BUDDY_COPY.shareParts({ timetable: true, absences: false }),
      BUDDY_COPY.shareParts({ timetable: false, absences: true }), BUDDY_COPY.shareParts({ timetable: false, absences: false }),
    ]);
    expect(BUDDY_COPY.full).toBe('אפשר עד 20 חברים');
    expect([BUDDY_COPY.examLead(0), BUDDY_COPY.examLead(1), BUDDY_COPY.examLead(2)]).toEqual([null, 'מבחן אחד משותף', '2 מבחנים משותפים']);
    expect(BUDDY_COPY.ends('שירה', '12:20', '14:00')).toBe(`סוף היום: ${iso('שירה')} 12:20, שלך 14:00`);
    expect(BUDDY_COPY.todayEnd('14:00', edgeNames(['נועה', 'יואב']))).toBe(`מסיימים איתך ב־14:00: ${iso('נועה')}, ${iso('יואב')}`);
    expect(BUDDY_COPY.failed).toBe('לא הצלחנו להתחבר. כדאי לנסות שוב.');
    expect(BUDDY_COPY.own).toBe('זה הקישור ששלחת. צריך לשלוח אותו לחבר.');
    expect(BUDDY_COPY.noTimesMine).toBe('במערכת שלך אין שעות, אז אי אפשר להשוות שעות');
    expect([BUDDY_COPY.waiting(1), BUDDY_COPY.waiting(2)]).toEqual(['הקישור עדיין פתוח', 'הקישורים עדיין פתוחים']);
    expect(BUDDY_COPY.waitingFirst).toBe('מחכים לעדכון ראשון');
    expect(BUDDY_COPY.cannotCompare).toBe('אי אפשר להשוות שעות');
  });

  /** What `fromThem` says is shared: every choice, in the order of the switches, as a Hebrew list. */
  it('lists what is shared, whatever the combination, and says the first two as it always did', () => {
    const shares = (timetable: boolean, absences: boolean, grades: boolean, bagrut: boolean): BuddyShares => ({ timetable, absences, grades, bagrut });
    const said = (...flags: [boolean, boolean, boolean, boolean]) => BUDDY_COPY.shareParts(shares(...flags));
    // Without the two later choices, nothing is changed, and a missing field reads as off.
    expect(BUDDY_COPY.shareParts({ timetable: true, absences: true })).toBe('מערכת וחיסורים');
    expect(BUDDY_COPY.shareParts({ timetable: true, absences: false })).toBe('מערכת');
    expect(BUDDY_COPY.shareParts({ timetable: false, absences: true })).toBe('חיסורים');
    expect(BUDDY_COPY.shareParts({ timetable: false, absences: false })).toBe('כלום בינתיים');
    expect(said(true, true, false, false)).toBe('מערכת וחיסורים');
    // One, two, three and four things.
    expect(said(false, false, true, false)).toBe('השוואת ציונים');
    expect(said(true, false, true, false)).toBe('מערכת והשוואת ציונים');
    expect(said(false, true, true, false)).toBe('חיסורים והשוואת ציונים');
    expect(said(true, true, true, false)).toBe('מערכת, חיסורים והשוואת ציונים');
    expect(said(false, false, true, true)).toBe('השוואת ציונים וציוני בגרות');
    expect(said(true, false, true, true)).toBe('מערכת, השוואת ציונים וציוני בגרות');
    expect(said(false, true, true, true)).toBe('חיסורים, השוואת ציונים וציוני בגרות');
    expect(said(true, true, true, true)).toBe('מערכת, חיסורים, השוואת ציונים וציוני בגרות');
    // The bagrut is an addition to the grades: with no grades, it is not offered.
    expect(said(false, false, false, true)).toBe('כלום בינתיים');
    expect(said(true, true, false, true)).toBe('מערכת וחיסורים');
  });

  /** The words of the grades tab and the switches, as the spec gives them (grades spec 2.1 to 2.3). */
  it('says the grades words the spec gives', () => {
    expect(BUDDY_COPY.tabs).toEqual({ timetable: 'מערכת', exams: 'מבחנים', absences: 'חיסורים', grades: 'ציונים' });
    expect(BUDDY_COPY.gradesSpan).toBe('ציונים מתחילת השנה');
    expect(BUDDY_COPY.gradesNeither).toBe('ציונים משווים רק כששניכם מדליקים.');
    expect(BUDDY_COPY.turnOnMine).toBe('להדליק אצלי');
    expect(BUDDY_COPY.gradesMine('נועה')).toBe(`הציונים יופיעו כשגם אצל ${iso('נועה')} זה יהיה דלוק.`);
    expect(BUDDY_COPY.gradesTheirs('נועה')).toBe(`${iso('נועה')} רוצה להשוות איתך ציונים.`);
    expect(BUDDY_COPY.turnOnToo).toBe('להדליק גם אצלי');
    expect(BUDDY_COPY.gradesEmpty('נועה')).toBe(`ל${iso('נועה')} עוד אין ציונים.`);
    expect(BUDDY_COPY.bagrutTheirs('נועה')).toBe(`${iso('נועה')} רוצה להשוות איתך גם ציוני בגרות.`);
    expect(BUDDY_COPY.bagrutMine('נועה')).toBe(`ציוני הבגרות יופיעו כשגם אצל ${iso('נועה')} זה יהיה דלוק.`);
    expect(BUDDY_COPY.gradesOthers('נועה')).toBe(`שאר המקצועות של ${iso('נועה')}`);
    expect(BUDDY_COPY.onlyMine).toBe('רק לך');
    expect(BUDDY_COPY.onlyTheirs('נועה')).toBe(`רק ל${iso('נועה')}`);
    expect(BUDDY_COPY.noAverage).toBe('אין ממוצע');
    expect([BUDDY_COPY.bagrutHead, BUDDY_COPY.bagrutSchool, BUDDY_COPY.bagrutExam]).toEqual(['בגרות', 'מגן', 'בחינה']);
    expect(BUDDY_COPY.gradesWeights('נועה')).toBe(`הממוצע שלך מחושב לפי המשקלים שלך, ושל ${iso('נועה')} לפי המשקלים של ${iso('נועה')}.`);
    expect(BUDDY_COPY.gradesFrom('נועה', '1.9')).toBe(`הציונים של ${iso('נועה')} מלפני 1.9 לא נכנסו.`);
    // Under an open subject whose average leaves grades out: whose, how many, and why.
    expect(BUDDY_COPY.gradesUncounted(3, 3, 'נועה')).toBe(`מחוץ לממוצע, כי המשקל שלהם 0%: 3 ציונים שלך ו־3 של ${iso('נועה')}. את המשקלים שלך משנים בבית ספר, ב״משקלים״ של המקצוע.`);
    expect(BUDDY_COPY.gradesUncounted(1, 0, 'נועה')).toBe('מחוץ לממוצע, כי המשקל שלו 0%: ציון אחד שלך. את המשקלים שלך משנים בבית ספר, ב״משקלים״ של המקצוע.');
    expect(BUDDY_COPY.gradesUncounted(0, 2, 'נועה')).toBe(`מחוץ לממוצע, כי המשקל שלהם 0%: 2 ציונים של ${iso('נועה')}.`);
    expect(BUDDY_COPY.shareGrades).toBe('הציונים שלך');
    // Nothing that assumes who the friend is (spec 1.3): both of you, never ״החבר״.
    expect(BUDDY_COPY.shareGradesSub).toBe('רק כששניכם מדליקים. הממוצע בכל מקצוע וכל הציונים מתחילת השנה.');
    expect(BUDDY_COPY.shareBagrut).toBe('גם ציוני בגרות');
    expect(BUDDY_COPY.shareBagrutSub).toBe('רק כששניכם מדליקים.');
  });

  /**
   * A friend's name is text from another phone, in any script. Set bare in a
   * Hebrew line, a Latin or mixed name pulls the words next to it into its own
   * direction; in a first-strong isolate (U+2068 … U+2069) it is one unit
   * whose order the line keeps.
   */
  it('isolates every name it sets, so a Latin or mixed name keeps the Hebrew order around it', () => {
    expect(BUDDY_COPY.ends('Noa', '12:20', '14:00')).toBe(`סוף היום: ${iso('Noa')} 12:20, שלך 14:00`);
    expect(BUDDY_COPY.ends('Noa', '12:20', '14:00')).toContain(FSI);
    expect(BUDDY_COPY.ends('Noa', '12:20', '14:00')).toContain(PDI);
    // Every function that takes a name (`name`, or `whose`) names them inside an isolate. A list of names
    // (`names`) comes made by `buddyNames` or `edgeNames`, which isolate each name (below).
    const named = SAMPLES.map((args) => args.map((a) => (a === 'נועה' ? 'Noa B.' : a)));
    let checked = 0;
    for (const [key, value] of Object.entries(BUDDY_COPY)) {
      if (typeof value !== 'function' || !/^\(?\s*(name|whose)\b/.test(String(value))) continue;
      for (const args of named.filter((a) => a.length === value.length && a[0] === 'Noa B.')) {
        const out = (value as (...a: unknown[]) => unknown)(...args);
        if (typeof out !== 'string' || !out.includes('Noa B.')) continue;
        expect(out, key).toContain(iso('Noa B.'));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(15);
    // Lists of names: each name on its own.
    expect(buddyNames(['Noa', 'יואב'])).toBe(`${iso('Noa')} ו${iso('יואב')}`);
    expect(buddyNames(['Noa', 'יואב', 'Dana'])).toBe(`${iso('Noa')} ועוד 2`);
    expect(edgeNames(['Noa', 'יואב', 'Dana'])).toBe(`${iso('Noa')}, ${iso('יואב')}, ${iso('Dana')}`);
    expect(edgeNames(['א', 'ב', 'ג', 'ד'])).toBe(`${iso('א')} ועוד 3`);
    expect(BUDDY_COPY.alsoTogether(buddyNames(['Noa']))).toBe(`גם ${iso('Noa')}`);
    // The notes, too: they are kept and shown later.
    expect(BUDDY_NOTES.ended('Noa')).toBe(`${iso('Noa')}: כבר לא חברים`);
    expect(BUDDY_NOTES.accepted('Noa')).toBe(`${iso('Noa')} עכשיו ברשימת החברים שלך`);
    expect(BUDDY_NOTES.incomplete('Noa')).toBe(`${iso('Noa')}: החיבור לא הושלם`);
  });
});
